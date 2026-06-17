// src/components/cotizaciones/ProductosRecientes.jsx
// Chips de productos usados recientemente para acceso rápido
import { Package, Clock, Plus } from 'lucide-react'

import useAuthStore from '../../store/useAuthStore'

const STORAGE_KEY = 'listopos_productos_recientes_'
const MAX_RECIENTES = 10

// Obtener sufijo de negocio para aislamiento total
function getStorageKey(operatorId) {
  const businessId = useAuthStore.getState().user?.id
  const suffix = businessId ? `-${businessId}` : ''
  return `${STORAGE_KEY}${operatorId}${suffix}`
}

// Guardar un producto al historial de recientes
export function guardarProductoReciente(operatorId, producto) {
  if (!operatorId || !producto?.id) return
  const key = getStorageKey(operatorId)
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]')
    const filtered = stored.filter(p => p.id !== producto.id)
    const updated = [
      { id: producto.id, nombre: producto.nombre, codigo: producto.codigo, precio_usd: producto.precio_usd },
      ...filtered,
    ].slice(0, MAX_RECIENTES)
    localStorage.setItem(key, JSON.stringify(updated))
  } catch { /* ignore storage errors */ }
}

// Obtener productos recientes
export function getProductosRecientes(operatorId) {
  if (!operatorId) return []
  const key = getStorageKey(operatorId)
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch { return [] }
}

// Componente visual de chips de recientes
export default function ProductosRecientes({ userId, productosCompletos = [], onAgregar, idsAgregados = new Set() }) {
  const recientes = getProductosRecientes(userId)
  if (recientes.length === 0) return null

  // Enriquecer con datos completos del inventario (para tener stock actualizado)
  const recientesEnriquecidos = recientes
    .map(r => productosCompletos.find(p => p.id === r.id) || r)
    .filter(p => p.precio_usd && Number(p.precio_usd) > 0)

  if (recientesEnriquecidos.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <Clock size={12} className="text-slate-400" />
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Recientes</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {recientesEnriquecidos.slice(0, 8).map(p => {
          const yaAgregado = idsAgregados.has(p.id)
          const sinStock = p.stock_actual != null && p.stock_actual <= 0
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => !sinStock && onAgregar(p)}
              disabled={sinStock}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
                sinStock ? 'bg-slate-50 text-slate-300 cursor-not-allowed' :
                yaAgregado ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                'bg-white border border-slate-200 text-slate-600 hover:border-primary/40 hover:text-primary'
              }`}
            >
              <Package size={11} />
              <span className="max-w-[120px] truncate">{p.nombre}</span>
              {!sinStock && !yaAgregado && <Plus size={11} className="text-slate-400" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
