// src/components/ui/SyncModal.jsx
// Modal interactivo de sincronización offline con barra de progreso, mapeo de IDs y resolución de conflictos.
import { useState, useEffect, useRef } from 'react'
import { 
  Cloud, RefreshCw, AlertTriangle, CheckCircle2, X, Loader2,
  UserPlus, ShoppingCart, FileText, ArrowRight, Trash2, SkipForward
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import useAuthStore from '../../store/useAuthStore'
import { dequeuePending, markDone, markFailed, replaceQueuedDespachoId } from '../../lib/mutationQueue'
import { clearLocalClientesOffline } from '../../lib/offlineSnapshots'
import { removeOfflineEntity } from '../../lib/offlineEntities'
import supabase from '../../services/supabase/client'
import { apiUrl } from '../../services/apiBase'
import { showToast } from './Toast'

// Queries a invalidar
import { DESPACHOS_KEY } from '../../hooks/useDespachos'
import { INVENTARIO_KEY } from '../../hooks/useInventario'
import { COTIZACIONES_KEY } from '../../hooks/useCotizaciones'
import { COMISIONES_KEY } from '../../hooks/useComisiones'
import { CXC_KEY } from '../../hooks/useCuentasCobrar'
import { STOCK_COMPROMETIDO_KEY } from '../../hooks/useStockComprometido'
import { CLIENTES_KEY } from '../../hooks/useClientes'

// Dispatcher de red para sincronizar items
async function dispatchItem(item, idMap) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sin sesión activa — por favor inicia sesión')

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
  const operadorActivoId = useAuthStore.getState().perfil?.id
  if (operadorActivoId) headers['X-Operator-Id'] = operadorActivoId
  const mapId = (id) => idMap[id] || id

  // 1. Mapeo relacional de IDs temporales de clientes
  if (item.type === 'VENTA_RAPIDA' || item.type === 'GUARDAR_COTIZACION') {
    const tempClient = item.payload.clienteId || item.payload.headerData?.cliente_id
    if (tempClient && String(tempClient).startsWith('local_cli_')) {
      const realId = idMap[tempClient]
      if (realId) {
        if (item.payload.clienteId) item.payload.clienteId = realId
        if (item.payload.headerData) item.payload.headerData.cliente_id = realId
      } else {
        throw new Error('El cliente temporal asociado a esta operación no pudo ser creado en el servidor.')
      }
    }
  }

  // 2. Ejecutar petición real según tipo de item
  if (item.type === 'CREAR_CLIENTE') {
    const res = await fetch(apiUrl('/api/clientes/crear'), {
      method: 'POST',
      headers,
      body: JSON.stringify(item.payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al crear cliente offline')
    return result // Retorna { id, ... } para el mapeo
  }

  if (item.type === 'VENTA_RAPIDA') {
    const res = await fetch(apiUrl('/api/ventas-rapidas/crear'), {
      method: 'POST',
      headers,
      body: JSON.stringify(item.payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al procesar venta rápida')
    return result
  }

  if (item.type === 'GUARDAR_COTIZACION') {
    const payload = { ...item.payload }
    if (payload.cotizacionId?.startsWith('local_')) {
      payload.cotizacionId = null
    }
    const res = await fetch(apiUrl('/api/cotizaciones/guardar'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error al guardar cotización')

    if (payload.sendAfterSave && result.id) {
      const sendRes = await fetch(apiUrl('/api/cotizaciones/enviar'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          cotizacionId: result.id,
          tasaBcv: Number(payload.tasaBcv) || 0
        }),
      })
      const sendResult = await sendRes.json()
      if (!sendRes.ok) throw new Error(sendResult.error || 'Error al enviar cotización sincronizada')
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

  throw new Error(`Tipo de mutación no soportado: ${item.type}`)
}

export default function SyncModal({ isOpen, onClose }) {
  const qc = useQueryClient()
  const setOfflineManual = useAuthStore(s => s.setOfflineManual)
  
  const [items, setItems] = useState([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [statusMap, setStatusMap] = useState({}) // item.id -> 'pending' | 'syncing' | 'done' | 'failed'
  const [errorMap, setErrorMap] = useState({})
  const [syncState, setSyncState] = useState('idle') // 'idle' | 'syncing' | 'paused' | 'success' | 'finished_with_errors'
  const [conflict, setConflict] = useState(null)
  
  const idMapRef = useRef({}) // local_cli_XXXX -> real_uuid
  const itemsRef = useRef([])
  const currentIndexRef = useRef(-1)

  // Cargar registros al montar
  useEffect(() => {
    async function load() {
      const pending = await dequeuePending()
      setItems(pending)
      itemsRef.current = pending
    }
    if (isOpen) load()
  }, [isOpen])

  // Iniciar el procesamiento secuencial
  const startSync = async () => {
    if (items.length === 0) {
      setOfflineManual(false)
      showToast('Volviendo a modo online', 'success')
      onClose()
      return
    }
    setSyncState('syncing')
    setConflict(null)
    
    // Si reiniciamos tras pausa, retomar desde donde quedamos
    const startIndex = currentIndexRef.current === -1 ? 0 : currentIndexRef.current
    
    for (let i = startIndex; i < items.length; i++) {
      const item = items[i]
      currentIndexRef.current = i
      setCurrentIndex(i)
      
      setStatusMap(prev => ({ ...prev, [item.id]: 'syncing' }))

      try {
        const result = await dispatchItem(item, idMapRef.current)
        
        // Si creamos un cliente nuevo offline, guardar mapeo de ID
        if (item.type === 'CREAR_CLIENTE' && item.payload.localId && result?.id) {
          idMapRef.current[item.payload.localId] = result.id
        }
        if (item.type === 'VENTA_RAPIDA' && result?.id) {
          idMapRef.current[item.id] = result.id
          await replaceQueuedDespachoId(item.id, result.id)
        }
        if (item.localEntityId && result?.id) {
          idMapRef.current[item.localEntityId] = result.id
          await replaceQueuedDespachoId(item.localEntityId, result.id)
        }
        if (result?.idMap) {
          idMapRef.current = { ...idMapRef.current, ...result.idMap }
        }

        await markDone(item.id)
        setStatusMap(prev => ({ ...prev, [item.id]: 'done' }))
      } catch (err) {
        console.error('[SYNC] Error en item:', item.id, err)
        setStatusMap(prev => ({ ...prev, [item.id]: 'failed' }))
        setErrorMap(prev => ({ ...prev, [item.id]: err.message }))
        
        // Pausar sincronización y mostrar panel de conflicto
        setSyncState('paused')
        setConflict({ item, index: i, error: err.message })
        return // Romper ciclo para resolver
      }
    }

    // Finalización exitosa del lote
    handleSyncFinished()
  }

  const handleSyncFinished = async () => {
    // Verificar si quedan fallidas
    const pendingNow = await dequeuePending()
    
    // Invalidar caches afectadas
    qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
    qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
    qc.invalidateQueries({ queryKey: COMISIONES_KEY })
    qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
    qc.invalidateQueries({ queryKey: CLIENTES_KEY })
    qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
    qc.invalidateQueries({ queryKey: CXC_KEY })
    
    if (pendingNow.length === 0) {
      setSyncState('success')
      await clearLocalClientesOffline() // Limpiar clientes offline
      showToast('Sincronización completada exitosamente', 'success')
      // Desactivar modo offline manual automáticamente al completar
      setOfflineManual(false)
      setTimeout(onClose, 2500)
    } else {
      setSyncState('finished_with_errors')
    }
  }

  // Resolver conflicto: Descartar item actual
  const handleDiscardConflict = async () => {
    if (!conflict) return
    const { item, index } = conflict
    
    await markDone(item.id) // Borrar del IDB
    setStatusMap(prev => ({ ...prev, [item.id]: 'failed' }))
    setErrorMap(prev => ({ ...prev, [item.id]: 'Descartado por el usuario' }))
    
    // Avanzar índice
    currentIndexRef.current = index + 1
    startSync()
  }

  // Resolver conflicto: Omitir e ir al siguiente
  const handleSkipConflict = async () => {
    if (!conflict) return
    const { item, index, error } = conflict
    
    await markFailed(item.id, error) // Marcar como fallido permanente en IDB
    
    // Avanzar índice
    currentIndexRef.current = index + 1
    startSync()
  }

  if (!isOpen) return null

  const progressPct = items.length > 0 
    ? Math.round(((currentIndexRef.current === -1 ? 0 : currentIndexRef.current + (syncState === 'success' ? 1 : 0)) / items.length) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div 
        className="w-full max-w-lg border border-slate-700/60 rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: 'linear-gradient(135deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.98) 100%)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Cloud size={16} className="text-emerald-400" />
            </div>
            <span className="text-sm font-bold text-white uppercase tracking-wider">Sincronización de registros</span>
          </div>
          {syncState !== 'syncing' && (
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-6">
          {/* Barra de Progreso */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-slate-400">
              <span>PROGRESO GENERAL</span>
              <span className="text-emerald-400">{progressPct}%</span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Estado Informativo */}
          {syncState === 'idle' && (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-slate-300">Tienes <strong>{items.length}</strong> registro(s) guardados localmente esperando ser subidos a la nube.</p>
              <button
                onClick={startSync}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 active:scale-95 transition-all"
              >
                Comenzar Sincronización
              </button>
            </div>
          )}

          {/* Listado de items procesándose */}
          {syncState !== 'idle' && (
            <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
              {items.map((item, idx) => {
                const status = statusMap[item.id] || 'pending'
                const errorMsg = errorMap[item.id]
                
                let icon = <Loader2 size={13} className="animate-spin text-sky-400" />
                let rowStyle = 'border-slate-800/40 text-slate-400'
                if (status === 'pending') {
                  icon = <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                } else if (status === 'done') {
                  icon = <CheckCircle2 size={13} className="text-emerald-400" />
                  rowStyle = 'border-emerald-500/20 text-slate-300 bg-emerald-950/5'
                } else if (status === 'failed') {
                  icon = <AlertTriangle size={13} className="text-rose-400" />
                  rowStyle = 'border-rose-500/20 text-rose-300 bg-rose-950/10'
                }

                return (
                  <div key={item.id} className={`flex items-center justify-between p-3 border rounded-xl transition-all ${rowStyle}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">{icon}</div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white">
                          {item.type === 'CREAR_CLIENTE' && '👤 Crear Cliente'}
                          {item.type === 'VENTA_RAPIDA' && '📦 Registrar Venta'}
                          {item.type === 'GUARDAR_COTIZACION' && '📋 Guardar Cotización'}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">
                          {item.type === 'CREAR_CLIENTE' && item.payload.nombre}
                          {item.type === 'VENTA_RAPIDA' && `Cliente: ${item.payload.clienteNombre || 'Sin especificar'}`}
                          {item.type === 'GUARDAR_COTIZACION' && `ID: ${item.payload.cotizacionId || 'Local'}`}
                        </p>
                        {errorMsg && <p className="text-[10px] text-rose-400 font-semibold mt-1">{errorMsg}</p>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Panel de Conflicto / Pausa */}
          {syncState === 'paused' && conflict && (
            <div className="p-4 border border-amber-500/30 rounded-2xl bg-amber-500/5 space-y-4 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-amber-400">CONFLICTO AL SINCRONIZAR</p>
                  <p className="text-xs text-slate-300">{conflict.error}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-700/30 justify-end">
                <button
                  onClick={handleDiscardConflict}
                  className="flex items-center gap-1 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 rounded-lg text-[10px] font-bold transition-all active:scale-95"
                >
                  <Trash2 size={11} />
                  Descartar Venta
                </button>
                <button
                  onClick={handleSkipConflict}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-700/40 hover:bg-slate-700/60 text-slate-300 rounded-lg text-[10px] font-bold transition-all active:scale-95"
                >
                  <SkipForward size={11} />
                  Omitir por ahora
                </button>
                <button
                  onClick={startSync}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold transition-all active:scale-95 shadow-sm"
                >
                  <RefreshCw size={11} />
                  Reintentar
                </button>
              </div>
            </div>
          )}

          {/* Resultados Finales */}
          {syncState === 'success' && (
            <div className="text-center py-4 text-emerald-400 font-bold text-sm animate-bounce">
              ✓ Sincronización exitosa. Conectado a la nube.
            </div>
          )}

          {syncState === 'finished_with_errors' && (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-rose-400 font-bold">La sincronización terminó con algunos errores permanentes.</p>
              <button
                onClick={onClose}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-750 text-white rounded-xl text-xs font-bold transition-all"
              >
                Cerrar Panel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
