// src/hooks/useRealtimeSync.js
// Sincronización entre dispositivos de la misma cuenta.
//
// Dos mecanismos complementarios:
//  • "cuenta-{cuentaId}" (broadcast) — sync INSTANTÁNEO (~50-150ms). Las mutations
//    emiten broadcastEntidad(entidad) y aquí invalidamos la query correspondiente
//    sin debounce. Canal con nombre estable por cuenta → lo comparten todos los
//    dispositivos/operadores de la misma cuenta.
//  • "db-changes-N" (postgres_changes) — RESPALDO. Cubre cambios hechos fuera de
//    la app (ediciones directas en DB, clientes que no emiten broadcast). Más
//    lento (WAL + debounce) pero garantiza consistencia eventual.
//
// Resiliencia:
//  • Reconexión automática si el WebSocket se cae (móvil en fondo, cambio de red)
//  • visibilitychange → refetch de inventario al volver de fondo
import { useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { DESPACHOS_KEY } from './useDespachos'
import { COMISIONES_KEY } from './useComisiones'
import {
  REALTIME_EV,
  setRealtimeChannel,
} from '../services/supabase/realtimeBus'

const COTIZACIONES_KEY = ['cotizaciones']
const CLIENTES_KEY     = ['clientes']
const CONFIG_KEY       = ['config_negocio']
const USUARIOS_KEY     = ['usuarios']

// Mapa entidad (broadcast) → query keys a invalidar de inmediato
const ENTIDAD_KEYS = {
  inventario:  [INVENTARIO_KEY],
  despachos:   [DESPACHOS_KEY, INVENTARIO_KEY], // un despacho mueve stock
  cotizaciones:[COTIZACIONES_KEY],
  clientes:    [CLIENTES_KEY],
  comisiones:  [COMISIONES_KEY],
  config:      [CONFIG_KEY],
  cuentas:     [['cuentas-cobrar']],
}

const TABLAS_LAZY = [
  { tabla: 'clientes',   keys: [CLIENTES_KEY],   debounceMs: 500 },
  { tabla: 'comisiones', keys: [COMISIONES_KEY], debounceMs: 500 },
  { tabla: 'usuarios',   keys: [USUARIOS_KEY],   debounceMs: 500 },
]

const TABLAS_INMEDIATAS = [
  { tabla: 'configuracion_negocio', keys: [CONFIG_KEY],                    debounceMs: 500 },
  { tabla: 'cotizaciones',          keys: [COTIZACIONES_KEY],              debounceMs: 500 },
  { tabla: 'notas_despacho',        keys: [DESPACHOS_KEY, INVENTARIO_KEY], debounceMs: 500 },
]

const RECONNECT_DELAY_MS = 3000

// Contador global: garantiza nombre de canal único por reconexión del canal de DB
let _chSeq = 0

export function useRealtimeSync() {
  const qc       = useQueryClient()
  // Una sola cuenta de negocio vive en auth.users; los operadores se distinguen
  // por PIN. Por eso el id de cuenta compartido entre TODOS los dispositivos es
  // user.id (el auth user), no el perfil del operador.
  const cuentaId = useAuthStore(useCallback(s => s.user?.id, []))
  const perfilId = useAuthStore(useCallback(s => s.perfil?.id, []))
  const timers          = useRef({})
  const dbCh            = useRef(null)
  const busCh           = useRef(null)
  const reconnectTimers = useRef({})

  useEffect(() => {
    if (!cuentaId || !perfilId) return

    function debouncedInvalidate(key, queryKeys, refetchType, ms) {
      if (timers.current[key]) clearTimeout(timers.current[key])
      timers.current[key] = setTimeout(() => {
        for (const k of queryKeys) qc.invalidateQueries({ queryKey: k, refetchType })
        delete timers.current[key]
      }, ms)
    }

    function scheduleReconnect(label, createFn) {
      if (reconnectTimers.current[label]) return
      reconnectTimers.current[label] = setTimeout(() => {
        delete reconnectTimers.current[label]
        createFn()
      }, RECONNECT_DELAY_MS)
    }

    // ── Canal 1: postgres_changes (RESPALDO) ─────────────────────────────────
    function createDbChannel() {
      if (dbCh.current) { supabase.removeChannel(dbCh.current); dbCh.current = null }

      const name = `db-changes-${++_chSeq}-${Math.random().toString(36).substring(2, 9)}`
      const ch   = supabase.channel(name)

      for (const { tabla, keys, debounceMs } of TABLAS_LAZY) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla },
          () => debouncedInvalidate(tabla, keys, 'none', debounceMs))
      }
      for (const { tabla, keys, debounceMs } of TABLAS_INMEDIATAS) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla },
          () => debouncedInvalidate(tabla, keys, 'active', debounceMs))
      }

      ch.subscribe((status) => {
        if (ch !== dbCh.current) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect('db', createDbChannel)
        }
      })
      dbCh.current = ch
    }

    // ── Canal 2: broadcast por cuenta (INSTANTÁNEO) ──────────────────────────
    // Nombre estable → todos los dispositivos de la cuenta comparten el canal
    function createBusChannel() {
      if (busCh.current) {
        setRealtimeChannel(null)
        supabase.removeChannel(busCh.current)
        busCh.current = null
      }

      const ch = supabase
        .channel(`cuenta-${cuentaId}`, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: REALTIME_EV }, (msg) => {
          const entidades = msg?.payload?.entidades || []
          // Invalidación inmediata, sin debounce → refresco casi instantáneo
          for (const entidad of entidades) {
            const keys = ENTIDAD_KEYS[entidad]
            if (!keys) continue
            for (const k of keys) qc.invalidateQueries({ queryKey: k, refetchType: 'active' })
          }
        })
        .subscribe((status) => {
          if (ch !== busCh.current) return
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setRealtimeChannel(null)
            scheduleReconnect('bus', createBusChannel)
          }
        })

      busCh.current = ch
      setRealtimeChannel(ch) // registrar para que las mutations puedan emitir
    }

    createDbChannel()
    createBusChannel()

    // Refetch al volver de fondo (cubre caso de móvil en background)
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY, refetchType: 'active' })
        qc.invalidateQueries({ queryKey: DESPACHOS_KEY, refetchType: 'active' })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      Object.values(timers.current).forEach(clearTimeout)
      timers.current = {}
      Object.values(reconnectTimers.current).forEach(clearTimeout)
      reconnectTimers.current = {}
      if (dbCh.current)  { supabase.removeChannel(dbCh.current);  dbCh.current  = null }
      if (busCh.current) {
        setRealtimeChannel(null)
        supabase.removeChannel(busCh.current)
        busCh.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [cuentaId, perfilId, qc])
}
