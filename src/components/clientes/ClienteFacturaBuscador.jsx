// src/components/clientes/ClienteFacturaBuscador.jsx
// Selector de cliente alterno para facturación — usa modal en vez de dropdown
import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X, Plus, Building2, UserCircle2, Receipt, Check } from 'lucide-react'
import { Modal } from '../ui/Modal'
import ClienteForm from './ClienteForm'
import { buscarClientes } from '../../utils/clienteSearch'

const TIPO_BADGE = {
  natural:  { cls: 'bg-slate-100 text-slate-600', label: 'N' },
  juridico: { cls: 'bg-violet-100 text-violet-700', label: 'J' },
  personal: { cls: 'bg-indigo-100 text-indigo-700', label: 'P' },
}

export default function ClienteFacturaBuscador({ clientes = [], clienteId, onSelect }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [showCrear, setShowCrear] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (abierto) setTimeout(() => inputRef.current?.focus(), 100)
  }, [abierto])

  const clientesActivos = useMemo(() => {
    return clientes.filter(c => c.activo !== false || c.id === clienteId)
  }, [clientes, clienteId])

  const seleccionado = clientesActivos.find(c => c.id === clienteId) || clientes.find(c => c.id === clienteId)
  const resultados = busqueda.trim().length >= 1
    ? buscarClientes(clientesActivos, busqueda)
    : clientesActivos

  function elegir(c) {
    onSelect(c.id)
    setAbierto(false)
    setBusqueda('')
  }

  function limpiar(e) {
    e.stopPropagation()
    onSelect('')
    setBusqueda('')
  }

  function handleClienteCreado(nuevoCliente) {
    setShowCrear(false)
    if (nuevoCliente?.id) {
      onSelect(nuevoCliente.id)
      setAbierto(false)
    }
  }

  return (
    <>
      {/* ── Botón / chip de selección ── */}
      {seleccionado ? (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-violet-300 bg-violet-50 text-left">
            <Receipt size={12} className="text-violet-500 shrink-0" />
            <span className="flex-1 min-w-0 text-xs font-semibold text-violet-800 truncate">
              {seleccionado.nombre}
              {seleccionado.rif_cedula && <span className="font-normal text-violet-500 ml-1">· {seleccionado.rif_cedula}</span>}
            </span>
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${TIPO_BADGE[seleccionado.tipo_cliente]?.cls ?? TIPO_BADGE.natural.cls}`}>
              {TIPO_BADGE[seleccionado.tipo_cliente]?.label ?? 'N'}
            </span>
            <button type="button" onClick={() => setAbierto(true)}
              className="p-0.5 rounded hover:bg-violet-200 text-violet-500 hover:text-violet-700 transition-colors shrink-0 text-[10px] font-medium">
              Cambiar
            </button>
            <button type="button" onClick={limpiar}
              className="p-0.5 rounded hover:bg-violet-200 text-violet-400 hover:text-violet-700 transition-colors shrink-0">
              <X size={12} />
            </button>
          </div>
          <button type="button" onClick={() => setShowCrear(true)}
            className="shrink-0 w-8 h-8 rounded-lg bg-violet-50 hover:bg-violet-100 border border-violet-200 flex items-center justify-center transition-colors active:scale-95"
            title="Nuevo cliente">
            <Plus size={13} className="text-violet-600" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 hover:border-violet-300 hover:text-violet-500 transition-colors"
          >
            <Receipt size={12} />
            <span>Facturar a otro cliente</span>
            <span className="ml-auto text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full font-semibold">Opcional</span>
          </button>
          <button type="button" onClick={() => setShowCrear(true)}
            className="shrink-0 w-8 h-8 rounded-lg bg-violet-50 hover:bg-violet-100 border border-violet-200 flex items-center justify-center transition-colors active:scale-95"
            title="Nuevo cliente">
            <Plus size={13} className="text-violet-600" />
          </button>
        </div>
      )}

      {/* ── Modal selector de cliente ── */}
      {abierto && (
        <Modal isOpen title="Seleccionar cliente para factura" onClose={() => { setAbierto(false); setBusqueda('') }}>
          <div className="flex flex-col gap-3">
            {/* Buscador */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, RIF, código o teléfono..."
                className="w-full pl-9 pr-9 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 placeholder:text-slate-400"
              />
              {busqueda && (
                <button type="button" onClick={() => setBusqueda('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Lista de clientes */}
            <div className="max-h-64 overflow-y-auto overscroll-contain -mx-1 px-1 space-y-1">
              {resultados.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-slate-400">
                    {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay clientes disponibles'}
                  </p>
                </div>
              ) : (
                resultados.map(c => {
                  const TipoIcn = c.tipo_cliente === 'juridico' ? Building2 : UserCircle2
                  const isSelected = c.id === clienteId
                  return (
                    <button key={c.id} type="button" onClick={() => elegir(c)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors active:scale-[0.98] ${
                        isSelected ? 'bg-violet-50 border border-violet-200' : 'hover:bg-slate-50 border border-transparent'
                      }`}>
                      <TipoIcn size={16} className={isSelected ? 'text-violet-500 shrink-0' : 'text-slate-400 shrink-0'} />
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm truncate ${isSelected ? 'text-violet-700' : 'text-slate-700'}`}>{c.nombre}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {[c.codigo_cliente, c.rif_cedula, c.telefono].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${TIPO_BADGE[c.tipo_cliente]?.cls ?? TIPO_BADGE.natural.cls}`}>
                        {TIPO_BADGE[c.tipo_cliente]?.label ?? 'N'}
                      </span>
                      {isSelected && <Check size={14} className="text-violet-500 shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>

            {/* Botón crear nuevo cliente */}
            <button type="button" onClick={() => setShowCrear(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-violet-200 text-sm text-violet-600 font-medium hover:bg-violet-50 transition-colors active:scale-[0.98]">
              <Plus size={14} />
              Crear cliente nuevo
            </button>
          </div>
        </Modal>
      )}

      {/* Modal crear cliente */}
      {showCrear && (
        <Modal isOpen title="Nuevo cliente" onClose={() => setShowCrear(false)}>
          <ClienteForm
            compact
            onSuccess={handleClienteCreado}
            onCancel={() => setShowCrear(false)}
          />
        </Modal>
      )}
    </>
  )
}
