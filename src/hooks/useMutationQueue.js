// src/hooks/useMutationQueue.js
// Hook para leer el estado de la cola de mutaciones offline y procesarla.
// Muestra badge de "N ventas pendientes" y permite reintentar fallidas.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  dequeuePending,
  dequeueFailed,
  retryFailed,
  discardFailed,
  processQueue,
  countAll,
} from '../lib/mutationQueue'
import { apiUrl } from '../services/apiBase'
import supabase from '../services/supabase/client'
import { showToast } from '../components/ui/Toast'
import { DESPACHOS_KEY } from './useDespachos'
import { INVENTARIO_KEY } from './useInventario'
import { COTIZACIONES_KEY } from './useCotizaciones'
import { COMISIONES_KEY } from './useComisiones'
import { CXC_KEY } from './useCuentasCobrar'
import { STOCK_COMPROMETIDO_KEY } from './useStockComprometido'

// ─── Dispatcher: convierte un item de la cola en un fetch real ────────────────
async function dispatchItem(item) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sin sesión — posponer sync')

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }

  if (item.type === 'VENTA_RAPIDA') {
    const res = await fetch(apiUrl('/api/ventas-rapidas/crear'), {
      method: 'POST',
      headers,
      body: JSON.stringify(item.payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al sincronizar venta')
    return result
  }

  if (item.type === 'GUARDAR_COTIZACION') {
    // Si el cotizacionId es local_ → crear nueva (sin ID)
    const payload = { ...item.payload }
    if (payload.cotizacionId?.startsWith?.('local_')) {
      payload.cotizacionId = null
    }
    const res = await fetch(apiUrl('/api/cotizaciones/guardar'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al sincronizar cotización')
    return result
  }

  throw new Error(`Tipo de mutación desconocido: ${item.type}`)
}

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useMutationQueue() {
  const qc = useQueryClient()
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState([])
  const [syncing, setSyncing] = useState(false)
  const processingRef = useRef(false)

  // Refrescar contadores
  const refresh = useCallback(async () => {
    const [p, f] = await Promise.all([dequeuePending(), dequeueFailed()])
    setPending(p.length)
    setFailed(f)
  }, [])

  // Procesar la cola (se llama al detectar 'online' o desde Background Sync)
  const sync = useCallback(async ({ silent = false } = {}) => {
    if (processingRef.current) return
    const total = await countAll()
    if (total === 0) return

    processingRef.current = true
    setSyncing(true)

    try {
      const { done, failed: failedCount } = await processQueue(dispatchItem)

      if (done > 0) {
        // Invalidar queries afectadas
        qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: COMISIONES_KEY })
        qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
        qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
        qc.invalidateQueries({ queryKey: CXC_KEY })
        if (!silent) showToast(`${done} venta${done > 1 ? 's' : ''} sincronizada${done > 1 ? 's' : ''}`, 'success')
      }

      if (failedCount > 0 && !silent) {
        showToast(`${failedCount} venta${failedCount > 1 ? 's' : ''} no pudo${failedCount > 1 ? 'ron' : ''} sincronizarse`, 'error')
      }
    } finally {
      processingRef.current = false
      setSyncing(false)
      await refresh()
    }
  }, [qc, refresh])

  // Reintentar un item fallido
  const retry = useCallback(async (id) => {
    await retryFailed(id)
    await refresh()
    await sync()
  }, [refresh, sync])

  // Descartar un item fallido
  const discard = useCallback(async (id) => {
    await discardFailed(id)
    await refresh()
  }, [refresh])

  // Escuchar reconexión → procesar automáticamente
  useEffect(() => {
    refresh()

    function handleOnline() {
      sync({ silent: false })
    }

    window.addEventListener('online', handleOnline)

    // Registrar Background Sync si el SW lo soporta
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.sync.register('sync-mutations').catch(() => {
          // Browser no soporta BG Sync (iOS) — el 'online' event ya cubre este caso
        })
      })
    }

    return () => window.removeEventListener('online', handleOnline)
  }, [refresh, sync])

  // Polling liviano (cada 10s) para mantener badge actualizado
  useEffect(() => {
    const interval = setInterval(refresh, 10_000)
    return () => clearInterval(interval)
  }, [refresh])

  return { pending, failed, syncing, sync, retry, discard, refresh }
}
