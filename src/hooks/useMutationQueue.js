// src/hooks/useMutationQueue.js
// Hook para leer el estado de la cola de mutaciones offline y procesarla.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  countAll,
  dequeueFailed,
  dequeuePending,
  discardFailed,
  processQueue,
  retryFailed,
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
import { CLIENTES_KEY } from './useClientes'
import { clearLocalClientesOffline } from '../lib/offlineSnapshots'
import { removeOfflineEntity } from '../lib/offlineEntities'
import useAuthStore from '../store/useAuthStore'

async function dispatchItem(item, idMap = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sin sesion - posponer sync')

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
  const operatorId = item.operatorId || useAuthStore.getState().perfil?.id
  if (operatorId) headers['X-Operator-Id'] = operatorId
  const mapId = (id) => idMap[id] || id

  if (item.type === 'VENTA_RAPIDA' || item.type === 'GUARDAR_COTIZACION') {
    const tempClient = item.payload.clienteId || item.payload.headerData?.cliente_id
    if (tempClient && String(tempClient).startsWith('local_cli_')) {
      const realId = idMap[tempClient]
      if (!realId) throw new Error('El cliente temporal asociado no pudo ser creado en el servidor.')
      if (item.payload.clienteId) item.payload.clienteId = realId
      if (item.payload.headerData) item.payload.headerData.cliente_id = realId
    }
  }

  if (item.type === 'CREAR_CLIENTE') {
    const res = await fetch(apiUrl('/api/clientes/crear'), {
      method: 'POST',
      headers,
      body: JSON.stringify(item.payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al crear cliente offline')
    return result
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
    const payload = { ...item.payload }
    if (payload.cotizacionId?.startsWith?.('local_')) payload.cotizacionId = null
    const res = await fetch(apiUrl('/api/cotizaciones/guardar'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al sincronizar cotizacion')
    if (item.localEntityId) removeOfflineEntity('cotizacion', item.localEntityId).catch(() => {})

    if (payload.sendAfterSave && result.id) {
      const sendRes = await fetch(apiUrl('/api/cotizaciones/enviar'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ cotizacionId: result.id, tasaBcv: Number(payload.tasaBcv) || 0 }),
      })
      const sendResult = await sendRes.json()
      if (!sendRes.ok) throw new Error(sendResult.error || 'Error al enviar cotizacion sincronizada')
      return { ...result, ...sendResult }
    }

    return result
  }

  if (item.type === 'ACTUALIZAR_COTIZACION_ESTADO') {
    const cotizacionId = mapId(item.payload.cotizacionId)
    const { error } = await supabase
      .from('cotizaciones')
      .update({ estado: item.payload.estado })
      .eq('id', cotizacionId)
    if (error) throw new Error(error.message || 'Error al actualizar cotizacion')
    return { id: cotizacionId }
  }

  if (item.type === 'CREAR_DESPACHO') {
    const payload = { ...item.payload, cotizacionId: mapId(item.payload.cotizacionId) }
    delete payload.despachoId
    const res = await fetch(apiUrl('/api/despachos/crear'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al crear despacho offline')
    if (item.localEntityId) removeOfflineEntity('despacho', item.localEntityId).catch(() => {})
    return result
  }

  if (item.type === 'EDITAR_DESPACHO') {
    const res = await fetch(apiUrl('/api/despachos/editar-pago'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...item.payload, despachoId: mapId(item.payload.despachoId) }),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al editar despacho offline')
    return { id: mapId(item.payload.despachoId) }
  }

  if (item.type?.startsWith('MARCAR_DESPACHO_')) {
    const res = await fetch(apiUrl('/api/despachos/estado'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        despachoId: mapId(item.payload.despachoId),
        nuevoEstado: item.payload.nuevoEstado,
        motivoDevolucion: item.payload.motivoDevolucion,
        motivoAnulacion: item.payload.motivoAnulacion,
        tasaBcv: item.payload.tasaBcv,
      }),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al cambiar estado de despacho offline')
    return { id: mapId(item.payload.despachoId) }
  }

  throw new Error(`Tipo de mutacion desconocido: ${item.type}`)
}

export function useMutationQueue() {
  const qc = useQueryClient()
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState([])
  const [syncing, setSyncing] = useState(false)
  const processingRef = useRef(false)

  const refresh = useCallback(async () => {
    const [p, f] = await Promise.all([dequeuePending(), dequeueFailed()])
    setPending(p.length)
    setFailed(f)
  }, [])

  const invalidateOfflineQueries = useCallback(() => {
    qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
    qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
    qc.invalidateQueries({ queryKey: COMISIONES_KEY })
    qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
    qc.invalidateQueries({ queryKey: CLIENTES_KEY })
    qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
    qc.invalidateQueries({ queryKey: CXC_KEY })
  }, [qc])

  const sync = useCallback(async ({ silent = false } = {}) => {
    if (processingRef.current) return
    const total = await countAll()
    if (total === 0) return

    processingRef.current = true
    setSyncing(true)

    try {
      const { done, failed: failedCount } = await processQueue(dispatchItem)

      if (done > 0) {
        invalidateOfflineQueries()
        const [pendingNow, failedNow] = await Promise.all([dequeuePending(), dequeueFailed()])
        const hasOfflineClients = [...pendingNow, ...failedNow].some((item) => item.type === 'CREAR_CLIENTE')
        if (!hasOfflineClients) await clearLocalClientesOffline()
        if (!silent) showToast(`${done} registro${done > 1 ? 's' : ''} sincronizado${done > 1 ? 's' : ''}`, 'success')
      }

      if (failedCount > 0 && !silent) {
        showToast(`${failedCount} registro${failedCount > 1 ? 's' : ''} no pudo${failedCount > 1 ? 'ron' : ''} sincronizarse`, 'error')
      }
    } finally {
      processingRef.current = false
      setSyncing(false)
      await refresh()
    }
  }, [invalidateOfflineQueries, refresh])

  const retry = useCallback(async (id) => {
    await retryFailed(id)
    await refresh()
    await sync()
  }, [refresh, sync])

  const discard = useCallback(async (id) => {
    await discardFailed(id)
    await refresh()
  }, [refresh])

  useEffect(() => {
    refresh()

    function handleOnline() {
      sync({ silent: false })
    }

    window.addEventListener('online', handleOnline)

    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.sync.register('sync-mutations').catch(() => {})
      })
    }

    function handleSWMessage(e) {
      if (e.data?.type === 'MUTATION_QUEUE_SYNCED') {
        refresh()
        invalidateOfflineQueries()
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSWMessage)

    return () => {
      window.removeEventListener('online', handleOnline)
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage)
    }
  }, [invalidateOfflineQueries, refresh, sync])

  useEffect(() => {
    const interval = setInterval(refresh, 10_000)
    return () => clearInterval(interval)
  }, [refresh])

  return { pending, failed, syncing, sync, retry, discard, refresh }
}
