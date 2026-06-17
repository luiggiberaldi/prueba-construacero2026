// src/views/TransportistasView.jsx
// Gestión de transportistas — solo supervisores pueden crear/editar/desactivar
import { useState, useMemo, useCallback, useEffect } from 'react'
import { Truck, Plus, Pencil, Ban, RefreshCw, ChevronLeft, ChevronRight, MapPin, Scale, FileText, Printer } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import {
  useTransportistas,
  useCrearTransportista,
  useActualizarTransportista,
  useDesactivarTransportista,
} from '../hooks/useTransportistas'
import ConfirmModal from '../components/ui/ConfirmModal'
import Skeleton     from '../components/ui/Skeleton'
import EmptyState   from '../components/ui/EmptyState'
import PageHeader  from '../components/ui/PageHeader'

import { PREFIJOS_RIF, parsearRif as parsearRifTransp, formatearRif as formatearRifTransp } from '../utils/rif'


// ─── Formulario ───────────────────────────────────────────────────────────────
function TransportistaForm({ inicial = {}, onGuardar, onCancelar, cargando }) {
  const { prefijo: rifPrefijoInit, numero: rifNumeroInit } = parsearRifTransp(inicial.rif)
  const [rifPrefijo, setRifPrefijo] = useState(rifPrefijoInit)
  const [campos, setCampos] = useState({
    nombre:          inicial.nombre          ?? '',
    rif:             rifNumeroInit,
    color:           inicial.color           ?? '',
    color_batea:     inicial.color_batea     ?? '',
    vehiculo:        inicial.vehiculo        ?? '',
    placa_chuto:     inicial.placa_chuto     ?? '',
    placa_batea:     inicial.placa_batea     ?? '',
    zona_cobertura:  inicial.zona_cobertura  ?? '',
    capacidad:       inicial.capacidad       ?? '',
  })
  const [error, setError] = useState('')

  function cambiar(campo, valor) {
    const val = campo === 'nombre' ? valor.replace(/(^|\s)\S/g, c => c.toUpperCase()) : valor
    setCampos(prev => ({ ...prev, [campo]: val }))
    setError('')
  }

  function submit(e) {
    e.preventDefault()
    if (!campos.nombre.trim()) { setError('El nombre es obligatorio'); return }
    // RIF ahora es opcional
    onGuardar({ ...campos, rif: formatearRifTransp(rifPrefijo, campos.rif) })
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Nombre *</label>
          <input value={campos.nombre} onChange={e => cambiar('nombre', e.target.value)}
            placeholder="Nombre del transportista" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Cédula / RIF *</label>
          <div className="flex gap-1 mb-1.5">
            {PREFIJOS_RIF.map(p => (
              <button key={p} type="button" disabled={cargando}
                onClick={() => setRifPrefijo(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  rifPrefijo === p ? 'bg-primary text-white shadow-sm scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                } disabled:opacity-50`}>
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <span className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 select-none h-[42px]">
              {rifPrefijo}{rifPrefijo !== 'V' ? '-' : ''}
            </span>
            <input value={campos.rif} onChange={e => {
              if (rifPrefijo === 'V') {
                let val = e.target.value.replace(/\D/g, '').slice(0, 9)
                cambiar('rif', val)
              } else {
                let val = e.target.value.replace(/[^\d-]/g, '')
                if (val.replace(/-/g, '').length > 10) return
                cambiar('rif', val)
              }
            }}
              placeholder={rifPrefijo === 'V' ? '24457713' : '30123456-7'}
              className={`${inputCls} !rounded-l-none`} disabled={cargando} inputMode="numeric" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Color *</label>
          <input value={campos.color} onChange={e => cambiar('color', e.target.value)}
            placeholder="Ej: Rojo, Blanco" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Vehículo *</label>
          <input value={campos.vehiculo} onChange={e => cambiar('vehiculo', e.target.value)}
            placeholder="Ej: Mack Granite 2020" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa chuto</label>
          <input value={campos.placa_chuto} onChange={e => cambiar('placa_chuto', e.target.value)}
            placeholder="Ej: AB123CD" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Placa batea</label>
          <input value={campos.placa_batea} onChange={e => cambiar('placa_batea', e.target.value)}
            placeholder="Ej: XY456ZW" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Color batea</label>
          <input value={campos.color_batea} onChange={e => cambiar('color_batea', e.target.value)}
            placeholder="Ej: Blanco, Amarillo" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Cobertura (Zonas)</label>
          <input value={campos.zona_cobertura} onChange={e => cambiar('zona_cobertura', e.target.value)}
            placeholder="Ej: Centro, Occidente, Caracas" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Capacidad de Carga</label>
          <input value={campos.capacidad} onChange={e => cambiar('capacidad', e.target.value)}
            placeholder="Ej: 30 Toneladas, 350 Sacos" className={inputCls} disabled={cargando} />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-colors disabled:opacity-50">
          {cargando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

// ─── Modal crear/editar ───────────────────────────────────────────────────────
function TransportistaModal({ transportista = null, onClose }) {
  const crear     = useCrearTransportista()
  const actualizar = useActualizarTransportista()
  const esEdicion  = !!transportista
  const [error, setError] = useState('')

  async function guardar(campos) {
    setError('')
    try {
      if (esEdicion) {
        await actualizar.mutateAsync({ id: transportista.id, campos })
      } else {
        await crear.mutateAsync(campos)
      }
      onClose()
    } catch (e) {
      setError(e.message ?? 'Error al guardar')
    }
  }

  const cargando = crear.isPending || actualizar.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary-light rounded-xl flex items-center justify-center">
            <Truck size={18} className="text-primary" />
          </div>
          <h3 className="font-bold text-slate-800 text-lg">
            {esEdicion ? 'Editar transportista' : 'Nuevo transportista'}
          </h3>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <TransportistaForm
          inicial={transportista ?? {}}
          onGuardar={guardar}
          onCancelar={onClose}
          cargando={cargando}
        />
      </div>
    </div>
  )
}

// ─── Color determinista por nombre ────────────────────────────────────────────
function colorTransportista() {
  return '#1B365D' // Azul Oscuro Corporativo
}

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
function TransportistaCard({ transportista, esSupervisor, puedeEditar, onEditar, onDesactivar }) {
  const color = colorTransportista(transportista.nombre)

  return (
    <div className="bg-white rounded-2xl border overflow-hidden flex flex-col hover:shadow-lg transition-all duration-200"
      style={{ borderColor: color + '30', boxShadow: `0 1px 3px ${color}10` }}>

      {/* ── Strip superior con color ── */}
      <div className="relative h-20 shrink-0 flex flex-col items-center justify-center gap-1"
        style={{ background: `linear-gradient(135deg, ${color}ee 0%, ${color}99 100%)` }}>
        {/* Dot pattern */}
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
        {/* Ícono camión */}
        <div className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)', backdropFilter: 'blur(4px)' }}>
          <Truck size={20} color="white" />
        </div>
      </div>

      {/* ── Nombre + RIF ── */}
      <div className="px-4 pt-3 pb-1 text-center">
        <p className="font-black text-slate-800 text-sm leading-tight truncate">{transportista.nombre}</p>
        {transportista.rif && (
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">{transportista.rif}</p>
        )}
      </div>

      {/* ── Detalles ── */}
      <div className="px-4 pb-3 mt-1 space-y-1.5">
        {transportista.color && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-medium text-slate-400">Color:</span>
            <span>{transportista.color}</span>
          </div>
        )}
        {transportista.vehiculo && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Truck size={11} className="text-slate-400 shrink-0" />
            <span>{transportista.vehiculo}</span>
          </div>
        )}
        {(transportista.placa_chuto || transportista.placa_batea) && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
            {transportista.placa_chuto && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">Chuto: {transportista.placa_chuto}</span>}
            {transportista.placa_batea && (
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                Batea: {transportista.placa_batea}{transportista.color_batea ? ` (${transportista.color_batea})` : ''}
              </span>
            )}
          </div>
        )}
        {transportista.zona_cobertura && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <MapPin size={11} className="text-slate-400 shrink-0" />
            <span className="font-medium text-slate-400">Cobertura:</span>
            <span className="truncate">{transportista.zona_cobertura}</span>
          </div>
        )}
        {transportista.capacidad && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Scale size={11} className="text-slate-400 shrink-0" />
            <span className="font-medium text-slate-400">Capacidad:</span>
            <span className="truncate">{transportista.capacidad}</span>
          </div>
        )}
      </div>

      {/* ── Acciones ── */}
      {(puedeEditar || esSupervisor) && (
        <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-1">
          <button onClick={() => onEditar(transportista)} title="Editar"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} />
            Editar
          </button>
          {esSupervisor && (
            <button onClick={() => onDesactivar(transportista)} title="Desactivar"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors ml-auto">
              <Ban size={13} />
              Eliminar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SkeletonTransportistas() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex gap-2.5">
            <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
          <Skeleton className="h-3 w-3/4 rounded" />
          <div className="pt-2 border-t border-slate-100">
            <Skeleton className="h-4 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Motor de búsqueda optimizado ──────────────────────────────────────────
const normalizar = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const purificar  = (s) => (s || '').replace(/[^a-z0-9]/gi, '').toLowerCase()

export default function TransportistasView() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const puedeCrear = esSupervisor || ['vendedor', 'vendedor_sin_comision'].includes(perfil?.rol)

  const [modalAbierto,          setModalAbierto]          = useState(false)
  const [editando,              setEditando]              = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12
  const [desactivandoTransp,    setDesactivandoTransp]    = useState(null)

  const { data: transportistas = [], isLoading, isError, refetch } =
    useTransportistas({ soloActivos: true })
  const desactivar = useDesactivarTransportista()
  const { data: config = {} } = useConfigNegocio()
  const [exportandoPDF, setExportandoPDF] = useState(false)
  const [imprimiendoPDF, setImprimiendoPDF] = useState(false)

  async function exportarTransportistasPDF(accion = 'download') {
    if (accion === 'print') setImprimiendoPDF(true)
    else setExportandoPDF(true)
    try {
      const { generarTransportistasPDF } = await import('../services/pdf/transportistasPDF')
      await generarTransportistasPDF({ items: transportistasFiltrados, config, action: accion })
    } catch (err) {
      import('../components/ui/Toast').then(({ showToast }) =>
        showToast('Error al generar el PDF: ' + err.message, 'error')
      )
    } finally {
      setExportandoPDF(false)
      setImprimiendoPDF(false)
    }
  }

  function abrirNuevo() { setEditando(null); setModalAbierto(true) }
  function abrirEditar(t) { setEditando(t); setModalAbierto(true) }
  function cerrarModal() { setModalAbierto(false); setEditando(null) }

  async function confirmarDesactivar() {
    if (!desactivandoTransp) return
    try {
      await desactivar.mutateAsync(desactivandoTransp.id)
    } finally {
      setDesactivandoTransp(null)
    }
  }


  const transportistasFiltrados = useMemo(() => {
    if (!search.trim()) return transportistas
    const q = normalizar(search)
    const qP = purificar(search)
    
    return transportistas.filter(t => {
      const n = normalizar(t.nombre)
      const r = purificar(t.rif)
      const pC = purificar(t.placa_chuto)
      const pB = purificar(t.placa_batea)
      const cB = normalizar(t.color_batea)
      const v = normalizar(t.vehiculo)
      const cob = normalizar(t.zona_cobertura)
      const cap = normalizar(t.capacidad)
      
      // Coincidencia en nombre, rif, placas, vehículo, cobertura o capacidad
      return n.includes(q) || r.includes(qP) || pC.includes(qP) || pB.includes(qP) || cB.includes(q) || v.includes(q) || cob.includes(q) || cap.includes(q)
    })
  }, [transportistas, search])

  const totalPages = Math.max(1, Math.ceil(transportistasFiltrados.length / PAGE_SIZE))
  const transportistasPaginados = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return transportistasFiltrados.slice(start, start + PAGE_SIZE)
  }, [transportistasFiltrados, page])

  // Reset page on search change
  useEffect(() => { setPage(1) }, [search])

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* Encabezado */}
      <PageHeader
        icon={Truck}
        title="Transportistas"
        subtitle={isLoading ? 'Cargando...' : `${transportistasFiltrados.length} visible${transportistasFiltrados.length !== 1 ? 's' : ''} de ${transportistas.length}`}
        action={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Buscador optimizado */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                <Truck size={14} className="opacity-50" />
              </div>
              <input 
                type="text" 
                value={search} 
                onChange={e => setSearch(e.target.value)}
                placeholder="Nombre, placa, cédula..."
                className="w-full sm:w-64 pl-9 pr-4 py-2 bg-white border border-slate-200 shadow-sm rounded-xl text-sm font-medium text-slate-700 focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all placeholder:text-slate-400"
              />
              {search && (
                <button 
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-red-500 transition-colors"
                >
                  <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => refetch()} className="p-2 rounded-xl transition-colors text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              </button>
              {(perfil?.rol === 'administracion' || perfil?.rol === 'jefe' || perfil?.rol === 'desarrollador') && (
                <>
                  <button 
                    onClick={() => exportarTransportistasPDF('print')}
                    disabled={imprimiendoPDF || exportandoPDF || isLoading}
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                  >
                    <Printer size={16} />
                    {imprimiendoPDF ? 'Imprimiendo...' : 'Imprimir'}
                  </button>
                  <button 
                    onClick={() => exportarTransportistasPDF('download')}
                    disabled={imprimiendoPDF || exportandoPDF || isLoading}
                    className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                  >
                    <FileText size={16} />
                    {exportandoPDF ? 'Generando...' : 'Descargar PDF'}
                  </button>
                </>
              )}
              {puedeCrear && perfil?.rol !== 'administracion' && (
                <button onClick={abrirNuevo} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                  <Plus size={16} />Nuevo
                </button>
              )}
            </div>
          </div>
        }
      />

      {/* Contenido */}
      {isLoading ? (
        <SkeletonTransportistas />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar transportistas</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : transportistas.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No hay transportistas registrados"
          description={puedeCrear ? 'Agrega el primer transportista.' : 'Aún no se han registrado transportistas.'}
          actionLabel={puedeCrear ? 'Nuevo transportista' : undefined}
          onAction={puedeCrear ? abrirNuevo : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {transportistasPaginados.map(t => (
              <TransportistaCard
                key={t.id}
                transportista={t}
                esSupervisor={esSupervisor}
                puedeEditar={puedeCrear}
                onEditar={abrirEditar}
                onDesactivar={setDesactivandoTransp}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <button disabled={page === 1} onClick={() => { setPage(p => p - 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronLeft size={20} />
              </button>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-400">Página</span>
                <span className="text-sm font-black text-slate-800">{page}</span>
                <span className="text-sm font-bold text-slate-400">de</span>
                <span className="text-sm font-black text-slate-800">{totalPages}</span>
              </div>
              <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal crear/editar */}
      {modalAbierto && (
        <TransportistaModal
          transportista={editando}
          onClose={cerrarModal}
        />
      )}

      {/* Confirm desactivar */}
      <ConfirmModal
        isOpen={!!desactivandoTransp}
        onClose={() => setDesactivandoTransp(null)}
        onConfirm={confirmarDesactivar}
        title="¿Desactivar transportista?"
        message={`"${desactivandoTransp?.nombre}" dejará de aparecer en nuevas cotizaciones.\nEsta acción se puede revertir manualmente desde la base de datos.`}
        confirmText="Sí, desactivar"
        variant="danger"
      />
    </div>
  )
}
