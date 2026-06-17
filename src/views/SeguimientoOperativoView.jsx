// src/views/SeguimientoOperativoView.jsx
// Panel de Control Operativo - Módulo de Administración/Supervisión
import { useState, useMemo, useEffect, useCallback } from 'react'
import { 
  ClipboardList, Search, RefreshCw, Filter, X, Calendar, 
  MessageSquare, AlertCircle, FileText, Image as ImageIcon, 
  Pin, CheckCircle2, User, AlertTriangle, ChevronRight,
  TrendingUp, Clock, Eye, AlertOctagon, Download
} from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useSeguimiento, useActualizarSeguimiento, useBorrarSeguimiento } from '../hooks/useSeguimiento'
import supabase from '../services/supabase/client'
import { showToast } from '../components/ui/Toast'
import { removeAccents } from '../utils/format'

// Modales Compartidos
import FichaClienteModal from '../components/clientes/FichaClienteModal'
import DetalleModal from '../components/ui/DetalleModal'
import Skeleton from '../components/ui/Skeleton'

const TIPO_CONFIG = {
  nota: { label: 'Nota', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: MessageSquare },
  incidencia: { label: 'Incidencia', color: 'bg-rose-50 text-rose-700 border-rose-200', icon: AlertCircle },
  aclaratoria: { label: 'Aclaratoria', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: FileText },
  seguimiento: { label: 'Seguimiento', color: 'bg-sky-50 text-sky-700 border-sky-200', icon: CheckCircle2 },
  evidencia: { label: 'Evidencia', color: 'bg-amber-55 text-amber-700 border-amber-200', icon: ImageIcon },
  resolucion: { label: 'Resolución', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
}

const PRIORIDAD_CONFIG = {
  informativa: { label: 'Informativa', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
  pendiente: { label: 'Pendiente', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  resuelta: { label: 'Resuelta', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  urgente: { label: 'Urgente', badge: 'bg-rose-100 text-rose-800 border-rose-200' },
}

export default function SeguimientoOperativoView() {
  const { perfil } = useAuthStore()
  
  // Búsqueda y filtros
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroPrioridad, setFiltroPrioridad] = useState('')
  const [filtroOrigen, setFiltroOrigen] = useState('') // 'cliente', 'cotizacion', 'despacho'

  // Collapsible entries state
  const [expandedEntries, setExpandedEntries] = useState({})
  
  const toggleExpand = (id) => {
    setExpandedEntries(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Mutations for resolver and delete actions
  const resolverMutation = useActualizarSeguimiento()
  const borrarMutation = useBorrarSeguimiento()

  const handleResolver = async (entry) => {
    try {
      await resolverMutation.mutateAsync({
        id: entry.id,
        prioridad: 'resuelta',
        tipo: 'resolucion'
      })
      showToast.success('Seguimiento marcado como resuelto.')
    } catch (err) {
      showToast.error(err.message || 'Error al resolver el seguimiento')
    }
  }

  const handleBorrar = async (id) => {
    if (!window.confirm('¿Confirmas que deseas eliminar permanentemente esta entrada de seguimiento?')) return
    try {
      await borrarMutation.mutateAsync(id)
      showToast.success('Entrada de seguimiento eliminada.')
    } catch (err) {
      showToast.error(err.message || 'Error al eliminar el seguimiento')
    }
  }

  // Query global (sin filtrar por IDs específicos para cargarlo todo)
  const { data: entradas = [], isLoading, isError, refetch } = useSeguimiento()

  // Estados de Modales e Hidratación
  const [modalRegistro, setModalRegistro] = useState(null)
  const [modalTipo, setModalTipo] = useState('cotizacion')
  const [modalOpen, setModalOpen] = useState(false)
  
  const [modalCliente, setModalCliente] = useState(null)
  const [fichaOpen, setFichaOpen] = useState(false)
  
  const [cargandoModal, setCargandoModal] = useState(false)
  const [activeImage, setActiveImage] = useState(null)

  const handleDownload = async (url) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      const filename = url.substring(url.lastIndexOf('/') + 1).split('?')[0] || 'evidencia.webp'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      showToast.success('Imagen descargada con éxito')
    } catch (err) {
      console.error('Error al descargar:', err)
      window.open(url, '_blank')
    }
  }

  // ── Helpers de Hidratación y Apertura en 1-Clic ──────────────────────
  const abrirDetalle = async (id, tipo) => {
    if (cargandoModal) return
    setCargandoModal(true)
    try {
      const table = tipo === 'cotizacion' ? 'cotizaciones' : 'notas_despacho'
      const selectQuery = tipo === 'cotizacion'
        ? '*, vendedor:usuarios(id, nombre, color, rol)'
        : '*, vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color, rol)'
      const { data, error } = await supabase
        .from(table)
        .select(selectQuery)
        .eq('id', id)
        .single()
      
      if (error) throw error
      if (data) {
        setModalRegistro(data)
        setModalTipo(tipo)
        setModalOpen(true)
      } else {
        showToast.warning('No se encontró el registro original.')
      }
    } catch (err) {
      console.error('Error al cargar detalle:', err)
      showToast.error('Error al cargar el detalle del registro')
    } finally {
      setCargandoModal(false)
    }
  }

  const abrirFichaCliente = async (id) => {
    if (cargandoModal) return
    setCargandoModal(true)
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*, vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color, rol)')
        .eq('id', id)
        .single()
      
      if (error) throw error
      if (data) {
        setModalCliente(data)
        setFichaOpen(true)
      } else {
        showToast.warning('No se encontró la ficha de cliente.')
      }
    } catch (err) {
      console.error('Error al cargar ficha de cliente:', err)
      showToast.error('Error al cargar los datos del cliente')
    } finally {
      setCargandoModal(false)
    }
  }

  // Realtime refetch invalidation listener (campanita/broadcast de notificaciones)
  useEffect(() => {
    const handleNotification = () => refetch()
    window.addEventListener('listopos-notification', handleNotification)
    return () => window.removeEventListener('listopos-notification', handleNotification)
  }, [refetch])

  // ── Estadísticas ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = entradas.length
    const urgentes = entradas.filter(e => e.prioridad === 'urgente').length
    const pendientes = entradas.filter(e => e.prioridad === 'pendiente').length
    const resoluciones = entradas.filter(e => e.tipo === 'resolucion').length
    const fijados = entradas.filter(e => e.fijada).length

    return { total, urgentes, pendientes, resoluciones, fijados }
  }, [entradas])

  // ── Filtrado Local ────────────────────────────────────────────────
  const entradasFiltradas = useMemo(() => {
    return entradas.filter(entry => {
      // Búsqueda por texto
      if (busqueda.trim()) {
        const text = removeAccents(busqueda.toLowerCase())
        const matchContenido = removeAccents(entry.contenido || '').toLowerCase().includes(text)
        const matchTitulo = removeAccents(entry.titulo || '').toLowerCase().includes(text)
        const matchUsuario = removeAccents(entry.usuario?.nombre || '').toLowerCase().includes(text)
        const matchCliente = removeAccents(entry.cliente?.nombre || '').toLowerCase().includes(text)
        const matchCotizacion = entry.cotizacion?.numero?.toString().includes(text)
        const matchDespacho = entry.despacho?.numero?.toString().includes(text)

        if (!matchContenido && !matchTitulo && !matchUsuario && !matchCliente && !matchCotizacion && !matchDespacho) {
          return false
        }
      }

      // Filtro de tipo
      if (filtroTipo && entry.tipo !== filtroTipo) return false

      // Filtro de prioridad
      if (filtroPrioridad && entry.prioridad !== filtroPrioridad) return false

      // Filtro de origen
      if (filtroOrigen) {
        if (filtroOrigen === 'cliente' && !entry.cliente_id) return false
        if (filtroOrigen === 'cotizacion' && !entry.cotizacion_id) return false
        if (filtroOrigen === 'despacho' && !entry.despacho_id) return false
      }

      return true
    })
  }, [entradas, busqueda, filtroTipo, filtroPrioridad, filtroOrigen])

  const limpiarFiltros = () => {
    setBusqueda('')
    setFiltroTipo('')
    setFiltroPrioridad('')
    setFiltroOrigen('')
  }

  const hayFiltrosActivos = busqueda || filtroTipo || filtroPrioridad || filtroOrigen

  return (
    <div className="p-4 sm:p-5 md:p-6 space-y-4 md:space-y-6">
      
      {/* ── Encabezado y Titulo ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md shadow-indigo-600/10"
            style={{ background: 'linear-gradient(135deg, #1B365D, #4A607A)' }}>
            <ClipboardList size={22} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-tight">Seguimiento Operativo</h1>
            <p className="text-xs font-semibold text-slate-400 mt-0.5">Centro de Control de Novedades e Incidencias en Tiempo Real</p>
          </div>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="self-start sm:self-center flex items-center justify-center gap-2 text-xs font-bold px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all shadow-sm active:scale-[0.98] disabled:opacity-50"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refrescar Feed
        </button>
      </div>

      {/* ── Tarjetas de Indicadores Estadísticos (Premium Grid) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Total Novedades */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm hover:shadow-md transition-all duration-300">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
            <Clock size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Feed</p>
            <p className="text-lg font-black text-slate-800 leading-tight mt-0.5">{isLoading ? '...' : stats.total}</p>
          </div>
        </div>

        {/* Alertas Urgentes (Rojo Glow) */}
        <div className={`border rounded-2xl p-4 flex items-center gap-3.5 shadow-sm transition-all duration-300 ${
          stats.urgentes > 0 
            ? 'bg-rose-50/50 border-rose-200 shadow-rose-100/30' 
            : 'bg-white border-slate-200/80'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            stats.urgentes > 0 ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-100 text-slate-500'
          }`}>
            <AlertOctagon size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Urgentes</p>
            <p className={`text-lg font-black leading-tight mt-0.5 ${stats.urgentes > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
              {isLoading ? '...' : stats.urgentes}
            </p>
          </div>
        </div>

        {/* Pendientes Operativas */}
        <div className={`border rounded-2xl p-4 flex items-center gap-3.5 shadow-sm transition-all duration-300 ${
          stats.pendientes > 0 
            ? 'bg-amber-50/50 border-amber-200 shadow-amber-100/30' 
            : 'bg-white border-slate-200/80'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            stats.pendientes > 0 ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'
          }`}>
            <AlertCircle size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pendientes</p>
            <p className={`text-lg font-black leading-tight mt-0.5 ${stats.pendientes > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
              {isLoading ? '...' : stats.pendientes}
            </p>
          </div>
        </div>

        {/* Soluciones Integradas */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm hover:shadow-md transition-all duration-300">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
            <CheckCircle2 size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Resoluciones</p>
            <p className="text-lg font-black text-slate-800 leading-tight mt-0.5">{isLoading ? '...' : stats.resoluciones}</p>
          </div>
        </div>

      </div>

      {/* ── Barra de Filtros Inteligentes (Alineado con el UX principal) ── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 space-y-3.5 shadow-sm">
        
        {/* Busqueda textual */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por contenido, operador, cliente, cotización, despacho..."
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400 transition-all"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Dropdowns de Filtros */}
        <div className="flex flex-wrap gap-2.5 items-center justify-between">
          <div className="flex flex-wrap gap-2.5 items-center">
            
            {/* Filter icon label */}
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider pr-1">
              <Filter size={12} /> Filtros:
            </div>

            {/* Tipo */}
            <select
              value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value)}
              className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 cursor-pointer focus:outline-none hover:border-slate-300 transition-colors"
            >
              <option value="">Todos los tipos</option>
              <option value="nota">Notas</option>
              <option value="incidencia">Incidencias</option>
              <option value="aclaratoria">Aclaratorias</option>
              <option value="seguimiento">Seguimientos</option>
              <option value="evidencia">Evidencias visuales</option>
              <option value="resolucion">Resoluciones</option>
            </select>

            {/* Prioridad */}
            <select
              value={filtroPrioridad}
              onChange={e => setFiltroPrioridad(e.target.value)}
              className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 cursor-pointer focus:outline-none hover:border-slate-300 transition-colors"
            >
              <option value="">Todas las prioridades</option>
              <option value="informativa">Informativas</option>
              <option value="pendiente">Pendientes</option>
              <option value="urgente">Urgentes</option>
              <option value="resuelta">Resueltas</option>
            </select>

            {/* Origen */}
            <select
              value={filtroOrigen}
              onChange={e => setFiltroOrigen(e.target.value)}
              className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 cursor-pointer focus:outline-none hover:border-slate-300 transition-colors"
            >
              <option value="">Cualquier origen</option>
              <option value="cliente">Asociado a Cliente</option>
              <option value="cotizacion">Asociado a Cotización</option>
              <option value="despacho">Asociado a Despacho</option>
            </select>

          </div>

          {/* Reset button */}
          {hayFiltrosActivos && (
            <button
              onClick={limpiarFiltros}
              className="flex items-center gap-1 text-[11px] font-bold text-red-500 bg-red-50 hover:bg-red-500 hover:text-white border border-red-200 hover:border-red-500 rounded-xl px-3.5 py-2 transition-all active:scale-95"
            >
              <X size={11} /> Limpiar Filtros
            </button>
          )}
        </div>

      </div>

      {/* ── Feed Global (Listado de Tarjetas) ── */}
      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-slate-200/60 rounded-2xl p-5 space-y-3.5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-4 w-32 rounded-lg" />
              </div>
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-4 w-1/3 rounded-lg" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center max-w-xl mx-auto">
          <AlertCircle className="mx-auto text-red-500 mb-3" size={32} />
          <h3 className="text-sm font-bold text-red-800">Error al cargar feed de seguimiento</h3>
          <p className="text-xs text-red-700/80 mt-1 leading-relaxed">No se pudo establecer comunicación con el backend para recuperar las entradas en tiempo real.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-all"
          >
            Reintentar Conexión
          </button>
        </div>
      ) : entradasFiltradas.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-12 text-center max-w-lg mx-auto">
          <ClipboardList className="mx-auto text-slate-300 mb-3" size={36} />
          <h3 className="text-sm font-bold text-slate-700">Sin entradas de seguimiento</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            {hayFiltrosActivos 
              ? 'No hay registros que coincidan con los criterios de búsqueda o filtros seleccionados.' 
              : 'El timeline global de seguimiento operativo se encuentra vacío en este momento.'}
          </p>
          {hayFiltrosActivos && (
            <button
              onClick={limpiarFiltros}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-all"
            >
              Restablecer Filtros
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {entradasFiltradas.map(entry => {
            const Config = TIPO_CONFIG[entry.tipo] || TIPO_CONFIG.nota
            const Pri = PRIORIDAD_CONFIG[entry.prioridad] || PRIORIDAD_CONFIG.informativa
            const Icon = Config.icon
            const userColor = entry.usuario?.color || '#64748b'

            const esUrgente = entry.prioridad === 'urgente'

            return (
              <div 
                key={entry.id} 
                className={`relative group bg-white rounded-2xl border transition-all duration-300 shadow-sm hover:shadow-md ${
                  entry.fijada 
                    ? 'border-amber-200 bg-gradient-to-br from-white to-amber-50/10' 
                    : esUrgente 
                      ? 'border-red-200/90 shadow-red-50/20 bg-gradient-to-br from-white to-red-50/5 ring-1 ring-red-100/50' 
                      : 'border-slate-100 hover:border-slate-200'
                }`}
              >
                {/* Indicador izquierdo de urgencia */}
                {esUrgente && (
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl bg-rose-500 animate-pulse" />
                )}

                <div className="p-4 sm:p-5">
                  {/* Fila 1: Badges y fijados */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      
                      {/* Icono del tipo */}
                      <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs border ${Config.color}`}>
                        <Icon size={12} />
                      </span>
                      
                      <span className={`text-[9px] font-extrabold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${Config.color}`}>
                        {Config.label}
                      </span>
                      
                      <span className={`text-[9px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${Pri.badge}`}>
                        {Pri.label}
                      </span>

                      {entry.fijada && (
                        <span className="text-[9px] font-extrabold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full flex items-center gap-0.5 animate-pulse">
                          <Pin size={9} className="fill-amber-500" /> FIJADO
                        </span>
                      )}

                    </div>

                    {/* Fecha de registro */}
                    <span className="text-[10px] font-semibold text-slate-400">
                      {new Date(entry.creado_en).toLocaleString('es-VE', { 
                        day: '2-digit', month: 'short', year: 'numeric', 
                        hour: '2-digit', minute: '2-digit' 
                      })}
                    </span>
                  </div>

                  {/* Fila 2: Título (opcional) y Contenido */}
                  <div className="mt-3">
                    {entry.titulo && (
                      <h4 className="text-xs font-bold text-slate-800 tracking-tight leading-tight mb-1">{entry.titulo}</h4>
                    )}
                    <p className="text-xs font-medium text-slate-650 leading-relaxed whitespace-pre-line">{entry.contenido}</p>
                  </div>                  {/* Evidencias visuales adjuntas (Lightbox Premium) */}
                  {entry.imagenes && entry.imagenes.length > 0 && (
                    <div className="mt-3.5 flex flex-wrap gap-2">
                      {entry.imagenes.map((imgUrl, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveImage(imgUrl)}
                          className="w-16 h-16 rounded-xl border border-slate-200/70 overflow-hidden bg-slate-50 hover:scale-105 hover:border-indigo-400 active:scale-95 transition-all shadow-sm cursor-pointer"
                        >
                          <img src={imgUrl} alt="Adjunto de novedad" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Fila 3: Entidades Relacionadas (Fichas Detalladas Collapsibles) */}
                  {(entry.cliente_id || entry.cotizacion_id || entry.despacho_id) && (
                    <div className="mt-3.5 p-3.5 bg-slate-50/60 border border-slate-200/50 rounded-2xl">
                      {!expandedEntries[entry.id] ? (
                        /* ── Vista Compacta (Colapsada) ── */
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded shrink-0">
                              Relacionados
                            </span>
                            
                            {entry.cliente && (
                              <button
                                type="button"
                                onClick={() => abrirFichaCliente(entry.cliente_id)}
                                className="inline-flex items-center gap-1.5 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 font-extrabold px-2.5 py-1 rounded-xl border border-indigo-100 shadow-sm transition-all active:scale-95 text-[11px]"
                              >
                                <User size={11} className="shrink-0" />
                                <span className="truncate max-w-[130px] sm:max-w-[200px]" title={entry.cliente.nombre}>
                                  {entry.cliente.nombre}
                                </span>
                              </button>
                            )}
                            
                            {entry.despacho && (
                              <button
                                type="button"
                                onClick={() => abrirDetalle(entry.despacho_id, 'despacho')}
                                className="inline-flex items-center gap-1 bg-sky-50/80 hover:bg-sky-100 text-sky-700 font-extrabold px-2.5 py-1 rounded-xl border border-sky-100 shadow-sm transition-all active:scale-95 font-mono text-[11px]"
                              >
                                <span>DES-{String(entry.despacho.numero).padStart(5, '0')}</span>
                                <span className="text-[9px] px-1.5 py-0.2 bg-sky-200/50 text-sky-850 rounded font-black uppercase ml-1">
                                  {entry.despacho.estado === 'despachada' ? 'En Ruta' : entry.despacho.estado === 'entregada' ? 'Entregada' : entry.despacho.estado}
                                </span>
                              </button>
                            )}
                            
                            {entry.cotizacion && !entry.despacho && (
                              <button
                                type="button"
                                onClick={() => abrirDetalle(entry.cotizacion_id, 'cotizacion')}
                                className="inline-flex items-center gap-1 bg-slate-100/80 hover:bg-slate-200/80 text-slate-700 font-extrabold px-2.5 py-1 rounded-xl border border-slate-250 shadow-sm transition-all active:scale-95 font-mono text-[11px]"
                              >
                                <FileText size={11} className="shrink-0" />
                                <span>COT-{String(entry.cotizacion.numero).padStart(5, '0')}</span>
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleExpand(entry.id)}
                            className="text-[10px] font-black text-indigo-650 hover:text-indigo-800 bg-indigo-50 border border-indigo-100 hover:border-indigo-200 px-3 py-1.5 rounded-xl transition-all shadow-sm active:scale-95 shrink-0 self-end sm:self-center ml-auto"
                          >
                            Expandir detalles
                          </button>
                        </div>
                      ) : (
                        /* ── Vista Expandida (Fichas Completas) ── */
                        <div className="space-y-3.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-3 rounded bg-indigo-500"></span>
                              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Registros Relacionados</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleExpand(entry.id)}
                              className="text-[10px] font-black text-slate-500 hover:text-slate-750 bg-white border border-slate-200 hover:border-slate-350 px-3 py-1.5 rounded-xl transition-all shadow-sm active:scale-95 shrink-0"
                            >
                              Contraer detalles
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Ficha Detallada de Cliente */}
                            {entry.cliente && (
                              <div className="bg-white border border-slate-150 hover:border-indigo-200 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/client relative overflow-hidden">
                                <div>
                                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-655 shrink-0">
                                        <User size={14} />
                                      </div>
                                      <div className="min-w-0">
                                        <h5 className="text-[11px] font-black text-slate-800 leading-tight truncate" title={entry.cliente.nombre}>
                                          {entry.cliente.nombre}
                                        </h5>
                                        <span className="text-[9px] font-bold text-slate-400">Cliente Registrado</span>
                                      </div>
                                    </div>
                                    {entry.cliente.codigo_cliente && (
                                      <span className="text-[9px] font-bold bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-mono shrink-0">
                                        {entry.cliente.codigo_cliente}
                                      </span>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">RIF / Cédula</span>
                                      <span className="text-slate-700 font-bold mt-1 block">{entry.cliente.rif_cedula || '—'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">Teléfono</span>
                                      <span className="text-slate-700 font-bold mt-1 block">{entry.cliente.telefono || '—'}</span>
                                    </div>
                                    <div className="col-span-2">
                                      <span className="text-slate-400 font-semibold block leading-none">Ubicación</span>
                                      <span className="text-slate-700 font-bold mt-1 block truncate">
                                        {entry.cliente.ciudad || entry.cliente.estado 
                                          ? `${entry.cliente.ciudad || ''}${entry.cliente.ciudad && entry.cliente.estado ? ', ' : ''}${entry.cliente.estado || ''}`
                                          : entry.cliente.direccion || '—'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">Vendedor</span>
                                      <span className="text-slate-700 font-bold mt-1 flex items-center gap-1.5">
                                        <span 
                                          className="w-1.5 h-1.5 rounded-full shrink-0" 
                                          style={{ backgroundColor: entry.cliente.vendedor?.color || '#94a3b8' }}
                                        />
                                        <span className="truncate">{entry.cliente.vendedor?.nombre || 'No asignado'}</span>
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">Estado de Cuenta</span>
                                      <span className="mt-1 block">
                                        {Number(entry.cliente.saldo_pendiente || 0) > 0 ? (
                                          <span className="inline-flex text-[9px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                            Deuda: ${Number(entry.cliente.saldo_pendiente).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                          </span>
                                        ) : (
                                          <span className="inline-flex text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-250 px-1.5 py-0.5 rounded">
                                            Al día ✓
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => abrirFichaCliente(entry.cliente_id)}
                                  className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-indigo-650 bg-indigo-50/40 hover:bg-indigo-50 border border-indigo-100 hover:border-indigo-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                                >
                                  <span>Ver Ficha de Cliente</span>
                                  <ChevronRight size={12} className="text-indigo-500" />
                                </button>
                              </div>
                            )}

                            {/* Ficha Detallada de Despacho */}
                            {entry.despacho && (
                              <div className="bg-white border border-slate-150 hover:border-sky-200 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/dispatch relative overflow-hidden">
                                <div>
                                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600 shrink-0">
                                        <ImageIcon size={14} />
                                      </div>
                                      <div className="min-w-0">
                                        <h5 className="text-[11px] font-black text-slate-800 leading-tight font-mono">
                                          DES-{String(entry.despacho.numero).padStart(5, '0')}
                                        </h5>
                                        <span className="text-[9px] font-bold text-slate-400">Orden de Despacho</span>
                                      </div>
                                    </div>
                                    {(() => {
                                      const config = {
                                        pendiente: 'bg-amber-55 text-amber-800 border-amber-200',
                                        despachada: 'bg-blue-50 text-blue-800 border-blue-200',
                                        entregada: 'bg-emerald-50 text-emerald-850 border-emerald-250',
                                        anulada: 'bg-rose-50 text-rose-800 border-rose-200'
                                      }[entry.despacho.estado] || 'bg-slate-50 text-slate-700 border-slate-200'

                                      const label = {
                                        pendiente: 'Pendiente',
                                        despachada: 'En Ruta',
                                        entregada: 'Entregada',
                                        anulada: 'Anulada'
                                      }[entry.despacho.estado] || entry.despacho.estado

                                      return (
                                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border uppercase tracking-wider ${config}`}>
                                          {label}
                                        </span>
                                      )
                                    })()}
                                  </div>

                                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">Monto Total</span>
                                      <span className="text-slate-900 font-black mt-1 block">
                                        ${Number(entry.despacho.total_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">Flete / Corte</span>
                                      <span className="text-slate-700 font-bold mt-1 block">
                                        F: ${Number(entry.despacho.flete_usd || 0).toFixed(1)} | C: ${Number(entry.despacho.corte_usd || 0).toFixed(1)}
                                      </span>
                                    </div>
                                    <div className="col-span-2">
                                      <span className="text-slate-400 font-semibold block leading-none">Forma de Pago</span>
                                      <span className="text-slate-700 font-bold mt-1 block truncate" title={(() => {
                                        if (!entry.despacho.forma_pago) return 'No especificada'
                                        try {
                                          const parsed = typeof entry.despacho.forma_pago === 'string' 
                                            ? JSON.parse(entry.despacho.forma_pago) 
                                            : entry.despacho.forma_pago
                                          if (Array.isArray(parsed)) {
                                            return parsed.map(f => `${f.metodo}: $${Number(f.monto || 0).toFixed(1)}`).join(' | ')
                                          }
                                        } catch {}
                                        return String(entry.despacho.forma_pago)
                                      })()}>
                                        {(() => {
                                          if (!entry.despacho.forma_pago) return 'No especificada'
                                          try {
                                            const parsed = typeof entry.despacho.forma_pago === 'string' 
                                              ? JSON.parse(entry.despacho.forma_pago) 
                                              : entry.despacho.forma_pago
                                            if (Array.isArray(parsed)) {
                                              return parsed.map(f => `${f.metodo}: $${Number(f.monto || 0).toFixed(0)}`).join(', ')
                                            }
                                          } catch {}
                                          return String(entry.despacho.forma_pago)
                                        })()}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">Vendedor</span>
                                      <span className="text-slate-700 font-bold mt-1 flex items-center gap-1.5">
                                        <span 
                                          className="w-1.5 h-1.5 rounded-full shrink-0" 
                                          style={{ backgroundColor: entry.despacho.vendedor?.color || '#94a3b8' }}
                                        />
                                        <span className="truncate">{entry.despacho.vendedor?.nombre || '—'}</span>
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 font-semibold block leading-none">Fecha de Creación</span>
                                      <span className="text-slate-700 font-bold mt-1 block">
                                        {new Date(entry.despacho.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => abrirDetalle(entry.despacho_id, 'despacho')}
                                  className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-sky-700 bg-sky-50/40 hover:bg-sky-50 border border-sky-100 hover:border-sky-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                                >
                                  <span>Ver Detalle de Despacho</span>
                                  <ChevronRight size={12} className="text-sky-655" />
                                </button>
                              </div>
                            )}

                            {/* Ficha de Cotización (Borrador/Historial - solo si no hay despacho activo que la remplace) */}
                            {entry.cotizacion && !entry.despacho && (
                              <div className="bg-white border border-slate-150 hover:border-indigo-200 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between transition-all duration-300 group/cotizacion relative overflow-hidden col-span-1">
                                <div>
                                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                                    <div className="flex items-center gap-2">
                                      <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-750">
                                        <FileText size={14} />
                                      </div>
                                      <div>
                                        <h5 className="text-[11px] font-black text-slate-800 leading-none font-mono">
                                          COT-{String(entry.cotizacion.numero).padStart(5, '0')}
                                        </h5>
                                        <span className="text-[9px] font-bold text-slate-400">Documento de Cotización</span>
                                      </div>
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                    Esta novedad está vinculada a una cotización de origen. Pulse el botón inferior para abrir la vista interactiva con el desglose de productos y versiones.
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => abrirDetalle(entry.cotizacion_id, 'cotizacion')}
                                  className="mt-3.5 w-full flex items-center justify-between text-[10px] font-black text-indigo-650 bg-indigo-50/40 hover:bg-indigo-50 border border-indigo-100 hover:border-indigo-200 px-3 py-2 rounded-xl transition-all shadow-sm active:scale-[0.98]"
                                >
                                  <span>Ver Detalle de Cotización</span>
                                  <ChevronRight size={12} className="text-indigo-500" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fila 4: Autor de la Nota y Acciones de Administración */}
                  <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between text-[10px] flex-wrap gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] text-white font-extrabold shadow-sm shrink-0" style={{ backgroundColor: userColor }}>
                        {entry.usuario?.nombre?.substring(0, 1).toUpperCase() || 'S'}
                      </span>
                      <span className="font-extrabold" style={{ color: userColor }}>
                        {entry.usuario?.nombre || 'Sistema'}
                      </span>
                      <span className="opacity-70 bg-slate-100 font-semibold px-2 py-0.2 rounded uppercase tracking-wide">
                        {entry.usuario?.rol || 'operador'}
                      </span>
                    </span>

                    {/* Acciones para Administración */}
                    {['supervisor', 'administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) && (
                      <div className="flex items-center gap-2">
                        {entry.prioridad !== 'resuelta' && (
                          <button
                            type="button"
                            onClick={() => handleResolver(entry)}
                            disabled={resolverMutation.isPending}
                            className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 border border-emerald-250 hover:border-emerald-600 px-2.5 py-1 rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-50"
                          >
                            <CheckCircle2 size={11} className="shrink-0" />
                            Aceptar / Resolver
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleBorrar(entry.id)}
                          disabled={borrarMutation.isPending}
                          className="inline-flex items-center gap-1 text-[10px] font-black text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 px-2.5 py-1 rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-50"
                        >
                          <X size={11} className="shrink-0" />
                          Eliminar
                        </button>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modales Compartidos e Hidratados del Sistema ── */}
      
      {/* Detalle de Cotización / Despacho */}
      {modalOpen && modalRegistro && (
        <DetalleModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setModalRegistro(null); }}
          tipo={modalTipo}
          registro={modalRegistro}
        />
      )}

      {/* Ficha de Cliente */}
      {fichaOpen && modalCliente && (
        <FichaClienteModal
          cliente={modalCliente}
          isOpen={fichaOpen}
          onClose={() => { setFichaOpen(false); setModalCliente(null); }}
        />
      )}

      {/* Lightbox / Visor de Imagen Ampliada */}
      {activeImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fade-in">
          <div className="relative max-w-4xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                <ImageIcon size={14} className="text-slate-500" />
                Evidencia Adjunta Ampliada
              </span>
              <button
                onClick={() => setActiveImage(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="bg-slate-950 flex items-center justify-center p-2 overflow-auto" style={{ minHeight: '350px' }}>
              <img src={activeImage} alt="Evidencia ampliada" className="max-w-full max-h-[75vh] object-contain rounded-lg" />
            </div>
            
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 shrink-0">
              <button
                onClick={() => handleDownload(activeImage)}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-xs font-bold rounded-lg text-white transition-all flex items-center gap-1.5 active:scale-95 shadow-sm shadow-indigo-600/10"
              >
                <Download size={13} />
                Descargar Imagen
              </button>
              <a
                href={activeImage}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-1.5 bg-white border border-slate-200 text-xs font-bold rounded-lg text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-1"
              >
                Abrir en nueva pestaña
              </a>
              <button
                onClick={() => setActiveImage(null)}
                className="px-4 py-1.5 bg-slate-800 text-xs font-bold rounded-lg text-white hover:bg-slate-900 transition-all"
              >
                Cerrar Visor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cargando Overlay */}
      {cargandoModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/20 backdrop-blur-[1px]">
          <div className="bg-white px-5 py-3.5 rounded-2xl border border-slate-100 shadow-xl flex items-center gap-3">
            <RefreshCw size={16} className="animate-spin text-indigo-600" />
            <span className="text-xs font-black text-slate-700">Cargando detalles...</span>
          </div>
        </div>
      )}

    </div>
  )
}
