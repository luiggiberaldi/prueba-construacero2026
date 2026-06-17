// src/components/cotizaciones/CotizacionClienteSelector.jsx
// Selector de cliente personalizado con búsqueda inteligente y confirmación de cliente ajeno
import { useState, useRef, useEffect, useMemo } from 'react'
import { User, Search, X, Hash, Phone, MapPin, AlertCircle, ChevronDown, CheckCircle } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { buscarClientes } from '../../utils/clienteSearch'

const TIPO_COLORS = {
  natural:  'bg-slate-100 text-slate-600',
  juridico: 'bg-violet-100 text-violet-700',
  personal: 'bg-indigo-100 text-indigo-700',
}
const TIPO_LABELS_SHORT = {
  natural: 'Natural', juridico: 'Jurídico', personal: 'Personal',
}

export default function ClienteSelector({ clientes, clienteId, onSelect }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [confirmAjeno, setConfirmAjeno] = useState(null)
  const ref = useRef(null)
  const { perfil } = useAuthStore()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    if (abierto) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [abierto])

  const clientesActivos = useMemo(() => {
    const filtradosActivos = clientes.filter(c => c.activo !== false || c.id === clienteId)
    return [...filtradosActivos].sort((a, b) => {
      const aEsMio = a.vendedor_id === perfil?.id ? 1 : 0
      const bEsMio = b.vendedor_id === perfil?.id ? 1 : 0
      return bEsMio - aEsMio
    })
  }, [clientes, clienteId, perfil?.id])

  const seleccionado = clientesActivos.find(c => c.id === clienteId) || clientes.find(c => c.id === clienteId)
  const filtrados = busqueda.trim()
    ? buscarClientes(clientesActivos, busqueda)
    : clientesActivos

  function elegir(c) {
    // Si es vendedor y el cliente pertenece a otro vendedor, pedir confirmación
    if (!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id) {
      setConfirmAjeno(c)
      return
    }
    onSelect(c.id)
    setAbierto(false)
    setBusqueda('')
  }

  function confirmarClienteAjeno() {
    if (confirmAjeno) {
      onSelect(confirmAjeno.id)
      setAbierto(false)
      setBusqueda('')
      setConfirmAjeno(null)
    }
  }

  function limpiar(e) {
    e.stopPropagation()
    onSelect('')
    setBusqueda('')
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setAbierto(!abierto)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAbierto(!abierto) } }}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all cursor-pointer ${
          abierto
            ? 'border-primary ring-2 ring-primary-focus bg-white'
            : seleccionado
              ? 'border-primary/30 bg-primary-light/20 hover:border-primary/50'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        }`}
      >
        {seleccionado ? (
          <>
            <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
              <User size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800 text-sm truncate">{seleccionado.nombre}</p>
              <p className="text-xs text-slate-500 truncate">
                {seleccionado.rif_cedula ?? ''}{seleccionado.rif_cedula && seleccionado.telefono ? ' · ' : ''}{seleccionado.telefono ?? ''}
              </p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[seleccionado.tipo_cliente] ?? TIPO_COLORS.natural}`}>
              {TIPO_LABELS_SHORT[seleccionado.tipo_cliente] ?? 'Particular'}
            </span>
            <button type="button" onClick={limpiar}
              className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <User size={16} className="text-slate-400" />
            </div>
            <span className="flex-1 text-sm text-slate-400">Seleccionar cliente...</span>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
          </>
        )}
      </div>

      {/* Dropdown */}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
          {/* Buscador */}
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, RIF, código o teléfono..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-100 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
                autoFocus
              />
            </div>
          </div>

          {/* Lista */}
          <div className="max-h-60 overflow-y-auto">
            {filtrados.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">
                {busqueda ? 'Sin resultados' : 'No hay clientes'}
              </p>
            ) : (
              filtrados.map(c => {
                const esAjeno = !esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id
                const vendedorColor = c.vendedor?.color || null
                return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegir(c)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    c.id === clienteId ? 'bg-primary-light/30' : ''
                  }`}
                  style={vendedorColor ? { borderLeft: `3px solid ${vendedorColor}` } : undefined}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={vendedorColor ? { backgroundColor: vendedorColor + '20' } : { backgroundColor: '#f1f5f9' }}>
                    <User size={14} style={vendedorColor ? { color: vendedorColor } : undefined} className={!vendedorColor ? 'text-slate-500' : ''} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{c.nombre}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {[c.codigo_cliente, c.rif_cedula, c.telefono].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                    </p>
                  </div>
                  {esAjeno && c.vendedor && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 shrink-0 whitespace-nowrap">
                      {c.vendedor.nombre}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${TIPO_COLORS[c.tipo_cliente] ?? TIPO_COLORS.natural}`}>
                    {TIPO_LABELS_SHORT[c.tipo_cliente] ?? 'Particular'}
                  </span>
                  {c.id === clienteId && (
                    <CheckCircle size={14} className="text-primary shrink-0" />
                  )}
                </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Modal confirmación cliente ajeno */}
      {confirmAjeno && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmAjeno(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-[calc(100vw-1.5rem)] sm:max-w-sm w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-amber-700 flex items-center gap-2">
              <AlertCircle size={16} /> Cliente de otro vendedor
            </p>
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-800">{confirmAjeno.nombre}</p>
              <p className="text-xs text-slate-500">
                Pertenece a: <span className="font-medium text-slate-700">{confirmAjeno.vendedor?.nombre || 'otro vendedor'}</span>
              </p>
              <p className="text-xs text-amber-600 font-medium">
                La comisión se le asignará a él.
              </p>
            </div>
            <p className="text-sm text-slate-600">
              Puedes usar este cliente. ¿Deseas continuar?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAjeno(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarClienteAjeno}
                className="px-4 py-2 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors">
                Sí, usar cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
