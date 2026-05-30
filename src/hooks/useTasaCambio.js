// src/hooks/useTasaCambio.js
// Hook de tasas de cambio — BCV + USDT (Binance P2P) + Manual
// Sincronización en tiempo real via configuracion_negocio + Supabase Realtime
// Construacero Carabobo
import { useState, useEffect, useCallback, useRef } from 'react'
import supabase from '../services/supabase/client'
import { useConfigNegocio, useActualizarConfig } from './useConfigNegocio'
import useAuthStore from '../store/useAuthStore'

const STORAGEKEY = 'construacero_tasa_v1'
const STORAGEKEYUSDT = 'construacero_tasa_usdt_v1'
const STORAGEKEYEURO = 'construacero_tasa_euro_v1'
const STORAGEKEYMODE_BASE = 'construacero_tasa_modo_v2'
const STORAGEKEYMANUAL_BASE = 'construacero_tasa_manual'
const UPDATE_INTERVAL = 5 * 60 * 1000 // 5 minutos
const MIN_REFRESH_INTERVAL = 60 * 1000 // no refrescar más de 1x/min al volver al foco

// ─── Singleton: deduplicar fetches entre múltiples instancias del hook ──────
// Evita ERR_INSUFFICIENT_RESOURCES cuando varios componentes llaman useTasaCambio()
let _inflightBcv = null   // Promise en curso para BCV
let _inflightUsdt = null  // Promise en curso para USDT
let _lastFetchTs = 0      // Timestamp del último fetch completado
let _subscribers = new Set() // Callbacks para notificar a todas las instancias
const MIN_DEDUP_INTERVAL = 5000 // No refetchar si se hizo hace menos de 5s

// Modos válidos: 'bcv' | 'usdt' | 'manual'
const MODOS_VALIDOS = ['bcv', 'usdt', 'manual']

const DEFAULT_RATE = {
  precio: 0,
  fuente: '',
  ultimaActualizacion: null,
}

function parseSafeFloat(val) {
  if (!val) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const clean = val.replace(/[^\d.,]/g, '')
    const lastDot = clean.lastIndexOf('.')
    const lastComma = clean.lastIndexOf(',')
    const lastSep = Math.max(lastDot, lastComma)
    if (lastSep === -1) return parseFloat(clean) || 0
    const integer = clean.slice(0, lastSep).replace(/[.,]/g, '')
    const decimals = clean.slice(lastSep + 1)
    return parseFloat(`${integer}.${decimals}`) || 0
  }
  return 0
}

// ─── Funciones de fetch a nivel de módulo (compartidas entre instancias) ─────

async function fetchConTimeout(url, timeout = 8000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(id)
    if (!res.ok) return null
    return await res.json()
  } catch {
    clearTimeout(id)
    return null
  }
}

async function _fetchBcvRaw() {
  let bcvPrice = null
  let euroPrice = null
  let fuente = 'BCV Oficial'

  // 1. Google Script (Scraper directo bcv.org.ve)
  try {
    const data = await fetchConTimeout('https://script.google.com/macros/s/AKfycbzUmj0Tug-pa3Y6jLEMT8tijNFvYb4_CLWhBZ0vDW7YsuP-QXjAcelOH5r-Mip3FJ-_7A/exec?token=Lvbp1994', 10000)
    if (data?.ok) {
      if (data.bcv?.price) bcvPrice = parseSafeFloat(data.bcv.price)
      if (data.euro?.price) euroPrice = parseSafeFloat(data.euro.price)
      if (bcvPrice > 0) {
        return { usd: bcvPrice, eur: euroPrice || (bcvPrice * 1.165), fuente: 'BCV Oficial (GS)' }
      }
    }
  } catch { /* intenta siguiente fuente */ }

  // 2. DolarAPI (Dólares + Euros en paralelo)
  try {
    const [dataDolar, dataEuro] = await Promise.all([
      fetchConTimeout('https://ve.dolarapi.com/v1/dolares', 8000),
      fetchConTimeout('https://ve.dolarapi.com/v1/euros', 8000)
    ])

    if (dataDolar && Array.isArray(dataDolar)) {
      const oficial = dataDolar.find(d =>
        d.fuente === 'oficial' || d.nombre === 'Oficial' || d.casa === 'oficial'
      )
      if (oficial?.promedio) bcvPrice = parseSafeFloat(oficial.promedio)
    }

    if (dataEuro && Array.isArray(dataEuro)) {
      const oficial = dataEuro.find(d =>
        d.fuente === 'oficial' || d.nombre === 'Oficial' || d.casa === 'oficial'
      )
      if (oficial?.promedio) euroPrice = parseSafeFloat(oficial.promedio)
    }

    if (bcvPrice > 0) {
      return { usd: bcvPrice, eur: euroPrice || (bcvPrice * 1.165), fuente: 'BCV Oficial' }
    }
  } catch { /* intenta siguiente fuente */ }

  // 3. PyDolarVE (Dólares con fallback de Euro cruzado)
  try {
    const data = await fetchConTimeout('https://pydolarve.org/api/v1/dollar?monitor=bcv', 8000)
    const precio = parseSafeFloat(data?.price)
    if (precio > 0) {
      return { usd: precio, eur: precio * 1.165, fuente: 'BCV Oficial' }
    }
  } catch { /* intenta siguiente fuente */ }

  // 4. ExchangeDynamics (Dólares y Euros)
  try {
    const data = await fetchConTimeout('https://api.exchangedynamics.com/rates/VES', 8000)
    const precio = parseSafeFloat(data?.USD)
    const eur = parseSafeFloat(data?.EUR)
    if (precio > 0) {
      return { usd: precio, eur: eur || (precio * 1.165), fuente: 'BCV Oficial' }
    }
  } catch { /* sin más fuentes */ }

  return null
}

async function _fetchUsdtRaw() {
  const result = await fetchConTimeout('https://criptoya.com/api/binancep2p/USDT/VES/1', 10000)
  if (!result) return null

  const avgAsk = typeof result.ask === 'number' ? result.ask
    : (Array.isArray(result.ask) && result.ask.length > 0
      ? result.ask.slice(0, 3).reduce((s, i) => s + (i.price ?? i), 0) / Math.min(3, result.ask.length)
      : 0)
  const avgBid = typeof result.bid === 'number' ? result.bid
    : (Array.isArray(result.bid) && result.bid.length > 0
      ? result.bid.slice(0, 3).reduce((s, i) => s + (i.price ?? i), 0) / Math.min(3, result.bid.length)
      : 0)

  if (avgAsk <= 0 && avgBid <= 0) return null
  const precio = (avgAsk > 0 && avgBid > 0) ? (avgAsk + avgBid) / 2 : (avgAsk || avgBid)
  return { precio, fuente: 'Binance P2P' }
}

// Fetch deduplicado: reutiliza promesas en curso
function fetchBcvDedup() {
  if (_inflightBcv) return _inflightBcv
  _inflightBcv = _fetchBcvRaw().finally(() => { _inflightBcv = null })
  return _inflightBcv
}

function fetchUsdtDedup() {
  if (_inflightUsdt) return _inflightUsdt
  _inflightUsdt = _fetchUsdtRaw().finally(() => { _inflightUsdt = null })
  return _inflightUsdt
}

// Fetch combinado deduplicado — notifica a todos los suscriptores
async function fetchTasaGlobal(esAutoUpdate = false) {
  // Si ya se hizo un fetch hace poco, no repetir
  if (Date.now() - _lastFetchTs < MIN_DEDUP_INTERVAL) return null

  const [bcvData, usdtData] = await Promise.all([fetchBcvDedup(), fetchUsdtDedup()])
  _lastFetchTs = Date.now()

  // Notificar a todos los suscriptores
  _subscribers.forEach(cb => cb({ bcvData, usdtData, esAutoUpdate }))
  return { bcvData, usdtData }
}

export function useTasaCambio() {
  const user = useAuthStore(s => s.user)
  const userId = user?.id
  const suffix = userId ? `-${userId}` : ''
  const STORAGEKEYMODE = `${STORAGEKEYMODE_BASE}${suffix}`
  const STORAGEKEYMANUAL = `${STORAGEKEYMANUAL_BASE}${suffix}`

  // Config de BD (fuente de verdad para modo + tasa manual)
  const { data: config } = useConfigNegocio()
  const actualizarConfig = useActualizarConfig()

  // Tasa BCV
  const [tasaBcv, setTasaBcv] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGEKEY))
      if (saved?.precio > 0) return saved
    } catch {}
    return DEFAULT_RATE
  })

  // Tasa USDT (Binance P2P)
  const [tasaUsdt, setTasaUsdt] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGEKEYUSDT))
      if (saved?.precio > 0) return saved
    } catch {}
    return DEFAULT_RATE
  })

  // Tasa Euro BCV
  const [tasaEuro, setTasaEuro] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGEKEYEURO))
      if (saved?.precio > 0) return saved
    } catch {}
    return DEFAULT_RATE
  })

  // Modo: 'usdt' | 'manual' (bcv se mantiene internamente pero no como modo visible)
  const [modoTasa, setModoTasa] = useState(() => {
    const saved = localStorage.getItem(STORAGEKEYMODE)
    if (saved && MODOS_VALIDOS.includes(saved)) {
      if (saved === 'bcv') {
        localStorage.setItem(STORAGEKEYMODE, 'usdt')
        return 'usdt'
      }
      return saved
    }
    const legacy = localStorage.getItem('construacero_tasa_modo_auto')
    if (legacy !== null) {
      localStorage.removeItem('construacero_tasa_modo_auto')
      return JSON.parse(legacy) ? 'usdt' : 'manual'
    }
    return 'usdt'
  })

  // Tasa manual
  const [tasaManual, setTasaManual] = useState(() => {
    const saved = localStorage.getItem('construacero_tasa_manual') // legacy check
    if (saved && parseFloat(saved) > 0) return saved
    const namespaced = localStorage.getItem(STORAGEKEYMANUAL)
    return namespaced && parseFloat(namespaced) > 0 ? namespaced : ''
  })

  // ─── Sincronizar estado cuando cambia el userId (cambio de cuenta) ──────────
  useEffect(() => {
    if (!userId) return

    const savedModo = localStorage.getItem(STORAGEKEYMODE)
    if (savedModo && MODOS_VALIDOS.includes(savedModo)) {
      setModoTasa(savedModo)
    }

    const savedManual = localStorage.getItem(STORAGEKEYMANUAL)
    if (savedManual && parseFloat(savedManual) > 0) {
      setTasaManual(savedManual)
    }
  }, [userId, STORAGEKEYMODE, STORAGEKEYMANUAL])

  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const tasaRef = useRef(tasaBcv)
  const tasaUsdtRef = useRef(tasaUsdt)
  const tasaEuroRef = useRef(tasaEuro)

  // ID único por pestaña/dispositivo para distinguir eco propio vs cambio ajeno
  const deviceIdRef = useRef(Math.random().toString(36).slice(2, 10))
  // Timestamp del último cambio local (para evitar eco del realtime)
  const localChangeTsRef = useRef(0)

  // ─── Sincronizar desde config BD (fuente de verdad) ──────────────────────────
  // Cuando useRealtimeSync detecta cambio en configuracion_negocio, refetch config,
  // y este effect actualiza modo + tasa manual para TODOS los usuarios en tiempo real
  useEffect(() => {
    if (!config || config.tasa_bcv_manual === undefined) return
    // Ignorar si nosotros mismos hicimos el cambio (evitar eco) — solo 2s ventana
    if (Date.now() - localChangeTsRef.current < 2000) return

    const dbManual = Number(config.tasa_bcv_manual) || 0
    if (dbManual > 0) {
      setModoTasa('manual')
      setTasaManual(String(dbManual))
    } else {
      // Solo cambiar a usdt si estábamos en manual (evitar override al cargar)
      setModoTasa(prev => prev === 'manual' ? 'usdt' : prev)
    }
  }, [config?.tasa_bcv_manual, config?.actualizado_en])

  // Persistir en localStorage (cache rápido para recargas)
  useEffect(() => {
    tasaRef.current = tasaBcv
    if (tasaBcv.precio > 0) localStorage.setItem(STORAGEKEY, JSON.stringify(tasaBcv))
  }, [tasaBcv])

  useEffect(() => {
    tasaUsdtRef.current = tasaUsdt
    if (tasaUsdt.precio > 0) localStorage.setItem(STORAGEKEYUSDT, JSON.stringify(tasaUsdt))
  }, [tasaUsdt])

  useEffect(() => {
    tasaEuroRef.current = tasaEuro
    if (tasaEuro.precio > 0) localStorage.setItem(STORAGEKEYEURO, JSON.stringify(tasaEuro))
  }, [tasaEuro])

  useEffect(() => {
    if (STORAGEKEYMODE) localStorage.setItem(STORAGEKEYMODE, modoTasa)
  }, [modoTasa, STORAGEKEYMODE])

  useEffect(() => {
    if (STORAGEKEYMANUAL) localStorage.setItem(STORAGEKEYMANUAL, tasaManual)
  }, [tasaManual, STORAGEKEYMANUAL])

  // Tasa efectiva según modo seleccionado
  const tasaEfectiva = modoTasa === 'usdt'
    ? (tasaUsdt.precio > 0 ? tasaUsdt.precio : tasaBcv.precio)
    : modoTasa === 'manual'
      ? (parseFloat(tasaManual) > 0 ? parseFloat(tasaManual) : tasaBcv.precio)
      : tasaBcv.precio

  // Backward compat: modoAuto = true cuando NO es manual
  const modoAuto = modoTasa !== 'manual'

  // Helper: procesar resultado de fetch global
  const handleFetchResult = useCallback(({ bcvData, usdtData, esAutoUpdate }) => {
    if (bcvData) {
      const usdVal = bcvData.usd || bcvData.precio || 0
      const eurVal = bcvData.eur || 0

      if (usdVal > 0) {
        setTasaBcv({
          precio: usdVal,
          fuente: bcvData.fuente,
          ultimaActualizacion: new Date().toISOString(),
        })
      }

      if (eurVal > 0) {
        setTasaEuro({
          precio: eurVal,
          fuente: bcvData.fuente,
          ultimaActualizacion: new Date().toISOString(),
        })
      }
    } else if (!esAutoUpdate && tasaRef.current?.precio <= 0) {
      setError('No se pudo obtener la tasa BCV')
    }

    if (usdtData && usdtData.precio > 0) {
      setTasaUsdt({
        precio: Math.ceil(usdtData.precio) + 2,
        fuente: usdtData.fuente,
        ultimaActualizacion: new Date().toISOString(),
      })
    }
  }, [])

  // Fetch wrapper que usa el singleton global
  const fetchTasa = useCallback(async (esAutoUpdate = false) => {
    if (useAuthStore.getState().offline) return
    if (!esAutoUpdate) setCargando(true)
    setError('')

    try {
      const result = await fetchTasaGlobal(esAutoUpdate)
      // Si fetchTasaGlobal fue deduplicado (retornó null), los datos
      // llegarán vía el suscriptor; no hacer nada aquí
      if (result) handleFetchResult({ ...result, esAutoUpdate })
    } catch {
      if (!esAutoUpdate) setError('Error de conexión')
    } finally {
      if (!esAutoUpdate) setCargando(false)
    }
  }, [handleFetchResult])

  // Auto-fetch al montar + intervalo de 5 min + refresco al volver al foco
  useEffect(() => {
    // Registrar suscriptor para recibir resultados de otras instancias
    _subscribers.add(handleFetchResult)

    const lastFetchRef = { ts: 0 }

    const hasCachedRate = tasaRef.current?.precio > 0
    if (!useAuthStore.getState().offline) {
      fetchTasa(hasCachedRate)
    }
    lastFetchRef.ts = Date.now()

    const intervalId = setInterval(() => {
      if (!useAuthStore.getState().offline) {
        fetchTasa(true)
      }
      lastFetchRef.ts = Date.now()
    }, UPDATE_INTERVAL)

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchRef.ts > MIN_REFRESH_INTERVAL) {
        if (!useAuthStore.getState().offline) {
          fetchTasa(true)
        }
        lastFetchRef.ts = Date.now()
      }
    }
    const onFocus = () => {
      if (Date.now() - lastFetchRef.ts > MIN_REFRESH_INTERVAL) {
        if (!useAuthStore.getState().offline) {
          fetchTasa(true)
        }
        lastFetchRef.ts = Date.now()
      }
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return () => {
      _subscribers.delete(handleFetchResult)
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchTasa, handleFetchResult])

  // ─── Realtime sync: broadcast + persistencia en BD ────────────────────────────
  const channelRef = useRef(null)

  // Guardar modo + valor en BD (dispara realtime a todos los clientes)
  const guardarTasaEnBD = useCallback((modo, valorManual) => {
    if (useAuthStore.getState().offline) {
      return
    }
    localChangeTsRef.current = Date.now()
    const tasa_bcv_manual = modo === 'manual' && parseFloat(valorManual) > 0
      ? parseFloat(valorManual)
      : 0
    actualizarConfig.mutate({ tasa_bcv_manual })
  }, [actualizarConfig])

  // Wrappers que persisten en BD + broadcast instantáneo
  const setModoTasaSync = useCallback((modo) => {
    setModoTasa(modo)
    // Guardar en BD (esto dispara realtime para otros usuarios)
    guardarTasaEnBD(modo, modo === 'manual' ? tasaManual : '0')
    // Broadcast instantáneo como backup rápido
    try {
      if (channelRef.current && channelRef.current.state === 'joined') {
        channelRef.current.send({
          type: 'broadcast',
          event: 'tasa_change',
          payload: { modoTasa: modo, tasaManual: modo === 'manual' ? tasaManual : null, ts: Date.now(), deviceId: deviceIdRef.current },
        })
      }
    } catch { /* silencioso */ }
  }, [tasaManual, guardarTasaEnBD])

  const setTasaManualSync = useCallback((val) => {
    setTasaManual(val)
    // Guardar en BD
    guardarTasaEnBD('manual', val)
    // Broadcast instantáneo como backup rápido
    try {
      if (channelRef.current && channelRef.current.state === 'joined') {
        channelRef.current.send({
          type: 'broadcast',
          event: 'tasa_change',
          payload: { modoTasa: 'manual', tasaManual: val, ts: Date.now(), deviceId: deviceIdRef.current },
        })
      }
    } catch { /* silencioso */ }
  }, [guardarTasaEnBD])

  // Escuchar broadcast de otros dispositivos (sync instantáneo)
  useEffect(() => {
    const channel = supabase
      .channel('tasa-sync')
      .on('broadcast', { event: 'tasa_change' }, ({ payload }) => {
        if (!payload) return
        // Ignorar si el broadcast viene de esta misma pestaña
        if (payload.deviceId === deviceIdRef.current) return
        if (payload.modoTasa && MODOS_VALIDOS.includes(payload.modoTasa)) {
          setModoTasa(payload.modoTasa)
          // Persistir en localStorage para que sobreviva recargas
          if (STORAGEKEYMODE) localStorage.setItem(STORAGEKEYMODE, payload.modoTasa)
        }
        if (payload.tasaManual !== null && payload.tasaManual !== undefined) {
          setTasaManual(String(payload.tasaManual))
          // Persistir en localStorage
          if (STORAGEKEYMANUAL) localStorage.setItem(STORAGEKEYMANUAL, String(payload.tasaManual))
        }
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [])

  return {
    tasaBcv,
    tasaUsdt,
    tasaEuro,
    tasaEfectiva,
    modoTasa,
    setModoTasa: setModoTasaSync,
    modoAuto,
    tasaManual,
    setTasaManual: setTasaManualSync,
    cargando,
    error,
    refrescar: () => fetchTasa(false),
  }
}
