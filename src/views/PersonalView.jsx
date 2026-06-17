// src/views/PersonalView.jsx
// Vista principal del módulo de Personal (Trabajadores de la empresa)
// — Guarda a los empleados como clientes de tipo_cliente = 'personal'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Plus, Search, RefreshCw, X, LayoutGrid, List, Filter, ChevronDown, Check, AlertCircle, Trash2, UserCheck, FileText, Printer, Handshake, DollarSign } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useClientes, useVendedores, useBorrarCliente, useActivarCliente } from '../hooks/useClientes'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import ClienteCard       from '../components/clientes/ClienteCard'
import ClienteRow        from '../components/clientes/ClienteRow'
import ClienteForm       from '../components/clientes/ClienteForm'
import ReasignacionModal from '../components/clientes/ReasignacionModal'
import FichaClienteModal from '../components/clientes/FichaClienteModal'
import { Modal }         from '../components/ui/Modal'
import ConfirmModal      from '../components/ui/ConfirmModal'
import EmptyState        from '../components/ui/EmptyState'
import Skeleton          from '../components/ui/Skeleton'
import Pagination        from '../components/ui/Pagination'
import PageHeader        from '../components/ui/PageHeader'

const ITEMS_POR_PAGINA = 12

// ─── Dropdown custom (reemplaza <select> nativo) ────────────────────────────
function Dropdown({ value, onChange, placeholder, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 text-sm font-semibold border rounded-xl pl-3 pr-2.5 py-2 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary ${
          value ? 'bg-primary-light border-primary/30 text-primary' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 min-w-[180px] bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-200/50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false) }}
            className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 transition-colors ${
              !value ? 'bg-primary-light text-primary font-semibold' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {!value && <Check size={14} className="text-primary" />}
            <span className={!value ? '' : 'pl-[22px]'}>{placeholder}</span>
          </button>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 transition-colors ${
                value === opt.value ? 'bg-primary-light text-primary font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {value === opt.value && <Check size={14} className="text-primary" />}
              <span className={value === opt.value ? '' : 'pl-[22px]'}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton de carga ────────────────────────────────────────────────────────
function SkeletonClientes() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-5 w-3/4 rounded-lg" />
          <Skeleton className="h-3.5 w-1/2 rounded-lg" />
          <Skeleton className="h-3.5 w-2/3 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function PersonalView() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const navigate = useNavigate()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esAdministracion = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esExterno = ['vendedor', 'vendedor_sin_comision'].includes(perfil?.rol) && Number(perfil?.markup_pct || 0) > 0
  const puedeGestionarPersonal = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)

  // Búsqueda y filtros
  const [busqueda, setBusqueda] = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [filtroConDeuda, setFiltroConDeuda] = useState(false)
  const [filtroConPrestamo, setFiltroConPrestamo] = useState(false)
  const [filtroSaldoFavor, setFiltroSaldoFavor] = useState(false)
  const [filtroEstado, setFiltroEstado]     = useState('activos')
  const [vistaMode, setVistaMode] = useState(() => {
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const key = businessId ? `personal_vista-${businessId}` : 'personal_vista'
    return localStorage.getItem(key) || (window.innerWidth < 768 ? 'list' : 'grid')
  })
  const [pagina, setPagina] = useState(1)

  // Estados de modales
  const [modalFormOpen,    setModalFormOpen]    = useState(false)
  const [clienteEditando,  setClienteEditando]  = useState(null)
  const [clienteReasig,    setClienteReasig]    = useState(null)
  const [modalReasigOpen,  setModalReasigOpen]  = useState(false)

  const [clienteFicha,     setClienteFicha]     = useState(null)
  const [fichaOpen,        setFichaOpen]        = useState(false)

  const [clienteBorrando,  setClienteBorrando]  = useState(null)
  const [confirmBorrarOpen, setConfirmBorrarOpen] = useState(false)

  // Data + mutations (filters in memory or we pass empty search query if we filter frontend)
  const { data: clientes = [], isLoading, isError, refetch } = useClientes(busqueda)
  const { data: vendedores = [] } = useVendedores()
  const empresaUser = vendedores.find(v => v.nombre?.toUpperCase() === 'EMPRESA')
  const forzarVendedorId = empresaUser?.id || null
  const categoriasExistentes = useMemo(() => {
    const cats = clientes
      .filter(c => c.tipo_cliente === 'personal' && c.categoria)
      .map(c => c.categoria)
    return Array.from(new Set(cats))
  }, [clientes])
  const borrarCliente = useBorrarCliente()
  const activarCliente = useActivarCliente()
  const { data: config = {} } = useConfigNegocio()
  const [exportandoPDF, setExportandoPDF] = useState(false)
  const [imprimiendoPDF, setImprimiendoPDF] = useState(false)

  async function exportarClientesPDF(accion = 'download') {
    if (accion === 'print') setImprimiendoPDF(true)
    else setExportandoPDF(true)
    try {
      const { generarClientesPDF } = await import('../services/pdf/clientesPDF')
      await generarClientesPDF({ items: clientesFiltrados, config, action: accion, title: 'Reporte de Personal' })
    } catch (err) {
      import('../components/ui/Toast').then(({ showToast }) =>
        showToast('Error al generar el PDF: ' + err.message, 'error')
      )
    } finally {
      setExportandoPDF(false)
      setImprimiendoPDF(false)
    }
  }

  // Filtrado local y ordenamiento (clientes con deuda o préstamos activos primero)
  const clientesFiltrados = useMemo(() => {
    const list = clientes.filter(c => {
      // SOLO incluir personal
      if (c.tipo_cliente !== 'personal') return false
      if (filtroConDeuda && !(Number(c.saldo_pendiente || 0) > 0)) return false
      if (filtroConPrestamo && !c.tiene_prestamos_activos) return false
      if (filtroSaldoFavor && !(Number(c.saldo_a_favor || 0) > 0)) return false
      
      if (filtroEstado === 'activos' && !c.activo) return false
      if (filtroEstado === 'desactivados' && c.activo) return false
      
      return true
    })

    // Ordenar: Trabajadores con deuda o préstamos activos primero, luego orden alfabético
    return [...list].sort((a, b) => {
      const deudaA = Number(a.saldo_pendiente || 0)
      const deudaB = Number(b.saldo_pendiente || 0)
      const prestamoA = !!a.tiene_prestamos_activos
      const prestamoB = !!b.tiene_prestamos_activos

      const esDeudorA = deudaA > 0 || prestamoA
      const esDeudorB = deudaB > 0 || prestamoB

      if (esDeudorA && !esDeudorB) return -1
      if (!esDeudorA && esDeudorB) return 1

      if (esDeudorA && esDeudorB) {
        // Priorizar por mayor deuda de dinero
        if (deudaA !== deudaB) {
          return deudaB - deudaA
        }
        // Desempatar poniendo primero al que tiene préstamos
        if (prestamoA && !prestamoB) return -1
        if (!prestamoA && prestamoB) return 1
      }

      return (a.nombre || '').localeCompare(b.nombre || '')
    })
  }, [clientes, filtroConDeuda, filtroConPrestamo, filtroSaldoFavor, filtroEstado])

  const hayFiltros = filtroConDeuda || filtroConPrestamo || filtroSaldoFavor || filtroEstado !== 'activos'

  function limpiarFiltros() {
    setFiltroConDeuda(false)
    setFiltroConPrestamo(false)
    setFiltroSaldoFavor(false)
    setFiltroEstado('activos')
    setPagina(1)
  }

  // Paginación (sobre clientes filtrados)
  const totalPaginas = Math.max(1, Math.ceil(clientesFiltrados.length / ITEMS_POR_PAGINA))
  const clientesPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return clientesFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [clientesFiltrados, pagina])

  // Debounce: actualizar búsqueda real 300ms después de dejar de teclear
  useEffect(() => {
    const timer = setTimeout(() => {
      setBusqueda(textoBusqueda)
      setPagina(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [textoBusqueda])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function limpiarBusqueda() {
    setTextoBusqueda('')
    setBusqueda('')
    setPagina(1)
  }

  function cambiarVista(modo) {
    setVistaMode(modo)
    const businessId = perfil?.cuenta_id
    const key = businessId ? `personal_vista-${businessId}` : 'personal_vista'
    localStorage.setItem(key, modo)
  }

  function abrirCrear() {
    setClienteEditando(null)
    setModalFormOpen(true)
  }

  function abrirEditar(cliente) {
    setClienteEditando(cliente)
    setModalFormOpen(true)
  }

  function abrirReasignar(cliente) {
    setClienteReasig(cliente)
    setModalReasigOpen(true)
  }

  function abrirFicha(cliente) {
    setClienteFicha(cliente)
    setFichaOpen(true)
  }

  function cotizarCliente(cliente) {
    navigate(`/cotizaciones?nueva=1&cliente=${cliente.id}`)
  }

  function abrirBorrar(cliente) {
    setClienteBorrando(cliente)
    setConfirmBorrarOpen(true)
  }

  async function handleBorrar() {
    if (!clienteBorrando) return
    try {
      const result = await borrarCliente.mutateAsync(clienteBorrando.id)
      if (result.accion === 'eliminado') {
        import('../components/ui/Toast').then(({ showToast }) =>
          showToast(`"${result.nombre}" eliminado permanentemente`, 'success')
        )
      } else {
        import('../components/ui/Toast').then(({ showToast }) =>
          showToast(`"${result.nombre}" desactivado (tiene historial)`, 'warning')
        )
      }
    } catch (err) {
      import('../components/ui/Toast').then(({ showToast }) =>
        showToast(err.message, 'error')
      )
    } finally {
      setConfirmBorrarOpen(false)
      setClienteBorrando(null)
    }
  }

  async function handleActivar(cliente) {
    try {
      await activarCliente.mutateAsync(cliente.id)
      import('../components/ui/Toast').then(({ showToast }) =>
        showToast(`"${cliente.nombre}" activado con éxito`, 'success')
      )
    } catch (err) {
      import('../components/ui/Toast').then(({ showToast }) =>
        showToast(err.message, 'error')
      )
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Briefcase}
        title="Personal"
        subtitle={isLoading ? 'Cargando...' : `${clientesFiltrados.length} trabajador${clientesFiltrados.length !== 1 ? 'es' : ''}`}
        action={
          <div className="flex items-center gap-2">
            {(perfil?.rol === 'administracion' || perfil?.rol === 'jefe' || perfil?.rol === 'desarrollador') && (
              <>
                <button 
                  onClick={() => exportarClientesPDF('print')} 
                  disabled={imprimiendoPDF || exportandoPDF || isLoading}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
                >
                  <Printer size={16} />
                  {imprimiendoPDF ? 'Imprimiendo...' : 'Imprimir'}
                </button>
                <button 
                  onClick={() => exportarClientesPDF('download')} 
                  disabled={imprimiendoPDF || exportandoPDF || isLoading}
                  className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
                >
                  <FileText size={16} />
                  {exportandoPDF ? 'Generando...' : 'Descargar PDF'}
                </button>
              </>
            )}
            {puedeGestionarPersonal && (
              <button onClick={abrirCrear} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #4338ca)' }}>
                <Plus size={16} />Nuevo trabajador
              </button>
            )}
          </div>
        }
      />

      {/* ── Barra de búsqueda ──────────────────────────────────────────────── */}
      <form onSubmit={e => { e.preventDefault(); setBusqueda(textoBusqueda); setPagina(1) }} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={textoBusqueda}
            onChange={e => setTextoBusqueda(e.target.value)}
            placeholder="Buscar trabajador por nombre, código o RIF..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
          />
          {textoBusqueda && (
            <button
              type="button"
              onClick={limpiarBusqueda}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          title="Actualizar lista"
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>

        {/* Toggle cuadrícula / lista */}
        <div className="flex bg-slate-100 rounded-xl p-0.5">
          <button
            type="button"
            onClick={() => cambiarVista('grid')}
            title="Vista cuadrícula"
            className={`p-2 rounded-lg transition-colors ${vistaMode === 'grid' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            type="button"
            onClick={() => cambiarVista('list')}
            title="Vista lista"
            className={`p-2 rounded-lg transition-colors ${vistaMode === 'list' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <List size={16} />
          </button>
        </div>
      </form>

      {/* Chip de búsqueda activa */}
      {busqueda && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-light text-primary text-xs font-semibold border border-primary/20">
            Buscando: "{busqueda}"
            <button onClick={limpiarBusqueda} className="hover:text-primary/70 transition-colors">
              <X size={12} />
            </button>
          </span>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
          <Filter size={13} />
          Filtros:
        </div>

        {/* Estado */}
        <Dropdown
          value={filtroEstado}
          onChange={v => { setFiltroEstado(v); setPagina(1) }}
          placeholder="Todos los estados"
          options={[
            { value: 'activos', label: 'Solo activos' },
            { value: 'desactivados', label: 'Solo desactivados' },
          ]}
        />

        {/* Con deuda */}
        <button
          onClick={() => {
            setFiltroConDeuda(v => {
              const next = !v;
              if (next) {
                setFiltroConPrestamo(false);
                setFiltroSaldoFavor(false);
              }
              return next;
            });
            setPagina(1);
          }}
          className={`flex items-center gap-1.5 text-xs font-bold rounded-xl px-3 py-2.5 transition-all min-h-[44px] border ${
            filtroConDeuda
              ? 'bg-red-500 text-white border-red-500 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-red-300 hover:text-red-600'
          }`}
        >
          <AlertCircle size={12} />
          Con deuda
        </button>

        {/* Con préstamo */}
        <button
          onClick={() => {
            setFiltroConPrestamo(v => {
              const next = !v;
              if (next) {
                setFiltroConDeuda(false);
                setFiltroSaldoFavor(false);
              }
              return next;
            });
            setPagina(1);
          }}
          className={`flex items-center gap-1.5 text-xs font-bold rounded-xl px-3 py-2.5 transition-all min-h-[44px] border ${
            filtroConPrestamo
              ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:text-amber-600'
          }`}
        >
          <Handshake size={12} />
          Con préstamo
        </button>

        {/* Saldo a Favor */}
        <button
          onClick={() => {
            setFiltroSaldoFavor(v => {
              const next = !v;
              if (next) {
                setFiltroConDeuda(false);
                setFiltroConPrestamo(false);
              }
              return next;
            });
            setPagina(1);
          }}
          className={`flex items-center gap-1.5 text-xs font-bold rounded-xl px-3 py-2.5 transition-all min-h-[44px] border ${
            filtroSaldoFavor
              ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
          }`}
        >
          <DollarSign size={12} />
          Saldo a Favor
        </button>

        {/* Limpiar filtros */}
        {hayFiltros && (
          <button
            onClick={limpiarFiltros}
            className="flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-white border border-red-200 hover:border-red-500 rounded-xl px-3 py-2.5 bg-red-50 hover:bg-red-500 transition-all min-h-[44px]"
          >
            <X size={12} />
            Limpiar
          </button>
        )}
      </div>

      {/* ── Contenido principal ────────────────────────────────────────────── */}
      {isLoading ? (
        <SkeletonClientes />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar el personal</p>
          <button
            onClick={() => refetch()}
            className="mt-3 text-sm underline text-red-600 hover:text-red-800"
          >
            Intentar de nuevo
          </button>
        </div>
      ) : clientesFiltrados.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={busqueda ? 'Sin resultados' : 'No hay personal registrado aún'}
          description={
            busqueda
              ? `No se encontraron trabajadores con "${busqueda}".`
              : puedeGestionarPersonal ? 'Registra al primer trabajador con el botón "Nuevo trabajador".' : 'No hay personal registrado.'
          }
          actionLabel={busqueda ? 'Limpiar búsqueda' : puedeGestionarPersonal ? 'Nuevo trabajador' : undefined}
          onAction={busqueda ? limpiarBusqueda : puedeGestionarPersonal ? abrirCrear : undefined}
        />
      ) : (
        vistaMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {clientesPaginados.map(cliente => (
              <ClienteCard
                key={cliente.id}
                cliente={cliente}
                onEditar={abrirEditar}
                onReasignar={null}
                onCotizar={cotizarCliente}
                onVerFicha={abrirFicha}
                onBorrar={abrirBorrar}
                onActivar={handleActivar}
                esPersonalSection={true}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {clientesPaginados.map(cliente => (
              <ClienteRow
                key={cliente.id}
                cliente={cliente}
                onEditar={abrirEditar}
                onReasignar={null}
                onCotizar={cotizarCliente}
                onVerFicha={abrirFicha}
                onBorrar={abrirBorrar}
                onActivar={handleActivar}
                esPersonalSection={true}
              />
            ))}
          </div>
        )
      )}

      {/* ── Paginación ───────────────────────────────────────────────────────── */}
      {!isLoading && clientesFiltrados.length > ITEMS_POR_PAGINA && (
        <Pagination
          paginaActual={pagina}
          totalPaginas={totalPaginas}
          onCambiarPagina={setPagina}
        />
      )}

      {/* ── Modal: Crear / Editar trabajador ───────────────────────────────── */}
      <Modal
        isOpen={modalFormOpen}
        onClose={() => setModalFormOpen(false)}
        title={clienteEditando ? 'Editar trabajador' : 'Registrar personal'}
      >
        <ClienteForm
          cliente={clienteEditando}
          onSuccess={() => setModalFormOpen(false)}
          onCancel={() => setModalFormOpen(false)}
          forzarTipoCliente="personal"
          forzarVendedorId={forzarVendedorId}
          categoriasExistentes={categoriasExistentes}
        />
      </Modal>

      {/* ── Modal: Reasignar (solo supervisor) ─────────────────────────────── */}
      <ReasignacionModal
        cliente={clienteReasig}
        isOpen={modalReasigOpen}
        onClose={() => { setModalReasigOpen(false); setClienteReasig(null) }}
      />

      {/* ── Modal: Ficha del cliente ─────────────────────────────────────── */}
      <FichaClienteModal
        cliente={clienteFicha}
        isOpen={fichaOpen}
        onClose={() => { setFichaOpen(false); setClienteFicha(null) }}
      />

      {/* ── Modal: Confirmar borrado ──────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmBorrarOpen}
        onClose={() => { setConfirmBorrarOpen(false); setClienteBorrando(null) }}
        onConfirm={handleBorrar}
        loading={borrarCliente.isPending}
        title="Eliminar trabajador"
        message={
          clienteBorrando
            ? Number(clienteBorrando.saldo_pendiente || 0) > 0
              ? `"${clienteBorrando.nombre}" tiene deuda activa y no puede eliminarse.`
              : `¿Eliminar a "${clienteBorrando.nombre}" de la lista de personal? Si tiene historial de cotizaciones o despachos, quedará desactivado. Si no tiene historial, se borrará permanentemente.`
            : ''
        }
        confirmLabel="Eliminar"
        confirmVariant="danger"
      />

    </div>
  )
}
