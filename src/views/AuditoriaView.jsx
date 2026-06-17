// src/views/AuditoriaView.jsx
// Historial de actividad del sistema — solo supervisor
// Vista mejorada con agrupación por fecha, resumen, búsqueda y filtros rápidos
import { useState, useEffect, useMemo } from 'react'
import {
  ClipboardList, RefreshCw, ChevronLeft, ChevronRight, Filter,
  FileText, Users, Package, UserCog, ArrowRightLeft, Settings,
  Send, Ban, CheckCircle, XCircle, PenLine, PlusCircle, Trash2,
  Eye, GitBranch, Clock, ChevronDown, ChevronUp, DollarSign,
  User, Calendar, Hash, Info, Loader2, Search, TrendingUp,
  Activity, CalendarDays, X, Copy, Check
} from 'lucide-react'
import { useAuditoria }  from '../hooks/useAuditoria'
import { useUsuarios }   from '../hooks/useUsuarios'
import supabase from '../services/supabase/client'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs, removeAccents } from '../utils/format'
import { useTasaCambio } from '../hooks/useTasaCambio'
import CustomSelect from '../components/ui/CustomSelect'
import Skeleton from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'
import { showToast } from '../components/ui/Toast'

// ─── Configuración de categorías ────────────────────────────────────────────
const CATEGORIA_CONFIG = {
  cotizacion:     { icon: FileText,       bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   dot: 'bg-amber-400',   label: 'Cotización',     color: '#d97706' },
  cliente:        { icon: Users,          bg: 'bg-blue-50',    text: 'text-blue-600',     border: 'border-blue-200',    dot: 'bg-blue-400',    label: 'Cliente',        color: '#2563eb' },
  inventario:     { icon: Package,        bg: 'bg-emerald-50', text: 'text-emerald-600',  border: 'border-emerald-200', dot: 'bg-emerald-400', label: 'Inventario',     color: '#059669' },
  usuario:        { icon: UserCog,        bg: 'bg-purple-50',  text: 'text-purple-600',   border: 'border-purple-200',  dot: 'bg-purple-400',  label: 'Usuario',        color: '#9333ea' },
  reasignacion:   { icon: ArrowRightLeft, bg: 'bg-orange-50',  text: 'text-orange-600',   border: 'border-orange-200',  dot: 'bg-orange-400',  label: 'Reasignación',   color: '#ea580c' },
  configuracion:  { icon: Settings,       bg: 'bg-indigo-50',  text: 'text-indigo-600',   border: 'border-indigo-200',  dot: 'bg-indigo-400',  label: 'Configuración',  color: '#4f46e5' },
  auth:           { icon: Eye,            bg: 'bg-cyan-50',    text: 'text-cyan-600',     border: 'border-cyan-200',    dot: 'bg-cyan-400',    label: 'Autenticación',  color: '#0891b2' },
  sistema:        { icon: Settings,       bg: 'bg-slate-100',  text: 'text-slate-500',    border: 'border-slate-200',   dot: 'bg-slate-400',   label: 'Sistema',        color: '#64748b' },
}

const CATEGORIAS_FILTRO = [
  { valor: '', label: 'Todas las categorías' },
  { valor: 'cotizacion',    label: 'Cotizaciones' },
  { valor: 'cliente',       label: 'Clientes' },
  { valor: 'inventario',    label: 'Inventario' },
  { valor: 'usuario',       label: 'Usuarios' },
  { valor: 'reasignacion',  label: 'Reasignaciones' },
  { valor: 'configuracion', label: 'Configuración' },
  { valor: 'auth',          label: 'Autenticación' },
]

// ─── Mapeo de acciones a texto legible ──────────────────────────────────────
const ACCION_LABEL = {
  CREAR_COTIZACION:     'Creó una cotización',
  ENVIAR_COTIZACION:    'Envió una cotización',
  ANULAR_COTIZACION:    'Anuló una cotización',
  ACEPTAR_COTIZACION:   'Aceptó una cotización',
  RECHAZAR_COTIZACION:  'Rechazó una cotización',
  VERSIONAR_COTIZACION: 'Creó nueva versión de cotización',
  EDITAR_COTIZACION:    'Editó una cotización',
  CREAR_CLIENTE:        'Registró un nuevo cliente',
  EDITAR_CLIENTE:       'Editó datos de un cliente',
  DESACTIVAR_CLIENTE:   'Desactivó un cliente',
  CREAR_PRODUCTO:       'Agregó un nuevo producto',
  EDITAR_PRODUCTO:      'Editó un producto',
  DESACTIVAR_PRODUCTO:  'Desactivó un producto',
  CREAR_USUARIO:        'Creó un nuevo usuario',
  EDITAR_USUARIO:       'Editó un usuario',
  DESACTIVAR_USUARIO:   'Desactivó un usuario',
  REASIGNAR_CLIENTE:    'Reasignó un cliente',
  REASIGNAR_CARTERA:    'Reasignó cartera de clientes',
  LOGIN:                'Inició sesión',
  LOGOUT:               'Cerró sesión',
  CAMBIAR_CONFIG:       'Modificó configuración del negocio',
  PAGAR_COMISION:       'Marcó comisión como pagada',
  CREAR_DESPACHO:       'Creó una nota de despacho',
  ACTUALIZAR_DESPACHO:  'Actualizó estado de despacho',
}

const ACCION_ICON = {
  CREAR_COTIZACION:     PlusCircle,
  ENVIAR_COTIZACION:    Send,
  ANULAR_COTIZACION:    Ban,
  ACEPTAR_COTIZACION:   CheckCircle,
  RECHAZAR_COTIZACION:  XCircle,
  VERSIONAR_COTIZACION: GitBranch,
  EDITAR_COTIZACION:    PenLine,
  CREAR_CLIENTE:        PlusCircle,
  EDITAR_CLIENTE:       PenLine,
  DESACTIVAR_CLIENTE:   Trash2,
  CREAR_PRODUCTO:       PlusCircle,
  EDITAR_PRODUCTO:      PenLine,
  DESACTIVAR_PRODUCTO:  Trash2,
  CREAR_USUARIO:        PlusCircle,
  EDITAR_USUARIO:       PenLine,
  DESACTIVAR_USUARIO:   Trash2,
  REASIGNAR_CLIENTE:    ArrowRightLeft,
  REASIGNAR_CARTERA:    ArrowRightLeft,
  LOGIN:                Eye,
  LOGOUT:               Eye,
  CAMBIAR_CONFIG:       Settings,
  PAGAR_COMISION:       DollarSign,
  CREAR_DESPACHO:       PlusCircle,
  ACTUALIZAR_DESPACHO:  CheckCircle,
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  desarrollador:  { label: 'Desarrollador', short: 'DEV', bg: 'bg-purple-100 text-purple-700 border border-purple-200' },
  jefe:           { label: 'Jefe',          short: 'JEFE', bg: 'bg-amber-100 text-amber-700 border border-amber-200' },
  supervisor:     { label: 'Jefe de Ventas',short: 'J.VENTAS', bg: 'bg-sky-100 text-sky-700 border border-sky-200' },
  administracion: { label: 'Administración',short: 'ADMIN', bg: 'bg-blue-100 text-blue-700 border border-blue-200' },
  logistica:      { label: 'Logística',     short: 'LOG', bg: 'bg-slate-100 text-slate-700 border border-slate-200' },
  vendedor:       { label: 'Vendedor',      short: 'VEN', bg: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
}

function getRoleBadge(rol, isShort = false) {
  if (!rol) return null
  const cleanRol = String(rol).toLowerCase()
  const conf = ROLE_CONFIG[cleanRol] || {
    label: rol.toUpperCase(),
    short: rol.substring(0, 3).toUpperCase(),
    bg: 'bg-slate-100 text-slate-700 border border-slate-200'
  }

  return (
    <span className={`${isShort ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} font-bold rounded-full leading-none shrink-0 ${conf.bg}`}>
      {isShort ? conf.short : conf.label}
    </span>
  )
}

function getCatKey(cat) {
  return (cat || 'sistema').toLowerCase()
}

function fmtFechaRelativa(f) {
  if (!f) return '—'
  const d = new Date(f)
  const ahora = new Date()
  const diffMs = ahora - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'Ahora'
  if (diffMin < 60) return `${diffMin}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`

  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

function fmtHora(f) {
  if (!f) return ''
  return new Date(f).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

function getDateGroupLabel(dateStr) {
  const d = new Date(dateStr)
  const hoy = new Date()
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)

  if (d.toDateString() === hoy.toDateString()) return 'Hoy'
  if (d.toDateString() === ayer.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function getDateKey(dateStr) {
  return new Date(dateStr).toDateString()
}

// ─── Renderizar meta data legible ───────────────────────────────────────────
function MetaDisplay({ meta }) {
  if (!meta || typeof meta !== 'object' || Object.keys(meta).length === 0) return null

  const LABEL_MAP = {
    numero: 'Nº', version: 'Versión', estado: 'Estado', total_usd: 'Total USD',
    cliente_nombre: 'Cliente', vendedor_nombre: 'Vendedor', estado_anterior: 'Estado anterior',
    estado_nuevo: 'Nuevo estado', total_comision: 'Comisión', motivo: 'Motivo',
    nombre: 'Nombre', rol: 'Rol', cantidad: 'Cantidad', codigo: 'Código',
    categoria: 'Categoría', precio_usd: 'Precio USD', de_vendedor: 'De vendedor',
    a_vendedor: 'A vendedor', clientes_afectados: 'Clientes afectados',
    cotizacion_id: null, despacho_id: null, vendedor_id: null, producto_id: null, cliente_id: null,
  }

  const entries = Object.entries(meta).filter(([k, v]) => {
    if (LABEL_MAP[k] === null) return false // skip IDs
    if (v === null || v === undefined || v === '') return false
    return true
  })

  if (entries.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {entries.map(([k, v]) => {
        const label = LABEL_MAP[k] || k.replace(/_/g, ' ')
        let display = v
        if (typeof v === 'number' && (k.includes('usd') || k.includes('comision') || k.includes('precio')))
          display = fmtUsd(v)
        else if (typeof v === 'boolean')
          display = v ? 'Sí' : 'No'

        return (
          <span key={k} className="text-xs text-slate-500">
            <span className="text-slate-400 capitalize">{label}:</span>{' '}
            <span className="font-medium text-slate-700">{String(display)}</span>
          </span>
        )
      })}
    </div>
  )
}

// ─── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonAuditoria() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 p-3.5 flex gap-3 items-center">
          <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
          <Skeleton className="h-3 w-12 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Detalle de entidad (se muestra al expandir) ────────────────────────────
function DetalleEntidad({ tipo, id, tasa = 0 }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!tipo || !id) { setLoading(false); return }

    async function cargar() {
      try {
        let result = null

        if (tipo === 'cotizacion') {
          const { data: cot, error: e } = await supabase
            .from('cotizaciones')
            .select('id, numero, version, estado, total_usd, creado_en, cliente_id, notas_cliente')
            .eq('id', id)
            .single()
          if (e) throw e

          let clienteNombre = null
          if (cot.cliente_id) {
            const { data: cli } = await supabase.from('clientes').select('nombre').eq('id', cot.cliente_id).single()
            clienteNombre = cli?.nombre
          }
          result = { ...cot, _tipo: 'cotizacion', _clienteNombre: clienteNombre }

        } else if (tipo === 'cliente') {
          const { data: cli, error: e } = await supabase
            .from('clientes')
            .select('id, nombre, rif_cedula, telefono, tipo_cliente, activo')
            .eq('id', id)
            .single()
          if (e) throw e
          result = { ...cli, _tipo: 'cliente' }

        } else if (tipo === 'producto') {
          const { data: prod, error: e } = await supabase
            .from('productos')
            .select('id, nombre, codigo, precio_usd, categoria, activo')
            .eq('id', id)
            .single()
          if (e) throw e
          result = { ...prod, _tipo: 'producto' }

        } else if (tipo === 'usuario') {
          const { data: usr, error: e } = await supabase
            .from('usuarios')
            .select('id, nombre, rol, activo')
            .eq('id', id)
            .single()
          if (e) throw e
          result = { ...usr, _tipo: 'usuario' }
        }

        setData(result)
      } catch (err) {
        setError('No se pudo cargar el detalle')
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [tipo, id])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
        <Loader2 size={12} className="animate-spin" /> Cargando...
      </div>
    )
  }

  if (error || !data) return null

  const ESTADO_COLORS = {
    borrador:  'bg-slate-100 text-slate-600',
    enviada:   'bg-blue-50 text-blue-700',
    aceptada:  'bg-emerald-50 text-emerald-700',
    rechazada: 'bg-red-50 text-red-700',
    vencida:   'bg-orange-50 text-orange-700',
    anulada:   'bg-slate-100 text-slate-400',
  }

  const ESTADO_LABELS = {
    borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada',
    rechazada: 'Rechazada', vencida: 'Vencida', anulada: 'Anulada',
  }

  if (data._tipo === 'cotizacion') {
    const numDisplay = `#${data.numero}`

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 font-mono text-xs">{numDisplay}</span>
            <span className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${ESTADO_COLORS[data.estado] ?? 'bg-slate-100 text-slate-500'}`}>
              {ESTADO_LABELS[data.estado] ?? data.estado}
            </span>
          </div>
          <div className="text-right">
            <span className="font-black text-slate-800 text-xs">{fmtUsd(data.total_usd)}</span>
            {tasa > 0 && data.total_usd > 0 && (
              <span className="text-[11px] text-slate-400 ml-1">({fmtBs(usdToBs(data.total_usd, tasa))})</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
          {data._clienteNombre && (
            <span className="flex items-center gap-1">
              <User size={10} className="text-slate-400" />
              {data._clienteNombre}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar size={10} className="text-slate-400" />
            {fmtFecha(data.creado_en)}
          </span>
        </div>
      </div>
    )
  }

  if (data._tipo === 'cliente') {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-xs">{data.nombre}</span>
          {data.rif_cedula && <span className="text-[10px] text-slate-400 font-mono">{data.rif_cedula}</span>}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
          {data.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>
    )
  }

  if (data._tipo === 'producto') {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-xs">{data.nombre}</span>
          {data.codigo && <span className="text-[10px] font-mono bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">{data.codigo}</span>}
        </div>
        <span className="font-bold text-xs text-slate-700">{fmtUsd(data.precio_usd)}</span>
      </div>
    )
  }

  if (data._tipo === 'usuario') {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 text-xs">{data.nombre}</span>
          {getRoleBadge(data.rol, false)}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${data.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
          {data.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>
    )
  }

  return null
}

// ─── Tarjeta de actividad compacta ──────────────────────────────────────────
function ActividadCard({ registro, tasa }) {
  const [expandido, setExpandido] = useState(false)

  const catKey = getCatKey(registro.categoria)
  const cat = CATEGORIA_CONFIG[catKey] ?? CATEGORIA_CONFIG.sistema
  const CatIcon = cat.icon
  const AccIcon = ACCION_ICON[registro.accion] ?? Clock
  const accionLabel = ACCION_LABEL[registro.accion] ?? registro.accion?.replace(/_/g, ' ').toLowerCase()
  const usuario = registro.usuario?.nombre ?? registro.usuario_nombre ?? 'Sistema'
  const rol = registro.usuario?.rol ?? registro.usuario_rol
  const tieneEntidad = registro.entidad_tipo && registro.entidad_id
  const tieneMeta = registro.meta && typeof registro.meta === 'object' && Object.keys(registro.meta).length > 0
  const tieneDetalle = tieneEntidad || tieneMeta || registro.descripcion

  return (
    <div className={`bg-white rounded-xl border transition-all duration-200 ${expandido ? 'shadow-md border-slate-300' : 'border-slate-200 hover:border-slate-300'}`}>
      <button
        onClick={() => tieneDetalle && setExpandido(!expandido)}
        className={`w-full flex items-center gap-3 p-3 sm:p-3.5 text-left ${tieneDetalle ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* Icono circular con color de categoría */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 relative"
          style={{ background: cat.color + '12', color: cat.color }}>
          <CatIcon size={16} />
        </div>

        {/* Contenido principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-slate-800 truncate">{usuario}</span>
            {rol && getRoleBadge(rol, true)}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <AccIcon size={11} className="text-slate-400 shrink-0" />
            <span className="text-xs text-slate-600 truncate">{accionLabel}</span>
          </div>
        </div>

        {/* Hora + indicador */}
        <div className="shrink-0 flex items-center gap-2">
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">{fmtHora(registro.ts)}</p>
            <p className="text-[10px] text-slate-300 hidden sm:block">{fmtFechaRelativa(registro.ts)}</p>
          </div>
          {tieneDetalle && (
            <div className="w-5 h-5 rounded-md flex items-center justify-center transition-colors"
              style={expandido
                ? { background: cat.color + '15', color: cat.color }
                : { color: '#cbd5e1' }}>
              {expandido ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </div>
          )}
        </div>
      </button>

      {/* Panel expandible */}
      {expandido && (
        <div className="px-3.5 pb-3.5 pt-0 space-y-2.5 animate-fade-in">
          <div className="border-t border-slate-100 pt-2.5 space-y-2.5">

            {/* Descripción */}
            {registro.descripcion && (
              <div className="rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed"
                style={{ background: cat.color + '06', border: `1px solid ${cat.color}15` }}>
                {registro.descripcion}
              </div>
            )}

            {/* Meta data */}
            {tieneMeta && (
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <MetaDisplay meta={registro.meta} />
              </div>
            )}

            {/* Detalle de la entidad */}
            {tieneEntidad && (
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <DetalleEntidad tipo={registro.entidad_tipo} id={registro.entidad_id} tasa={tasa} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Resumen cards ──────────────────────────────────────────────────────────
function ResumenCard({ icon: Icon, label, value, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-3.5 flex items-center gap-3"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'rgba(255,255,255,0.15)' }}>
        <Icon size={16} className="text-white" />
      </div>
      <div>
        <p className="text-lg font-black leading-tight text-white">{value}</p>
        <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
      </div>
    </div>
  )
}

// ─── Filtros rápidos de fecha ───────────────────────────────────────────────
const FILTROS_FECHA = [
  { id: '', label: 'Todo' },
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
]

// ─── Vista principal ────────────────────────────────────────────────────────
const POR_PAGINA = 50

export default function AuditoriaView() {
  const [pagina,       setPagina]       = useState(0)
  const [usuarioId,    setUsuarioId]    = useState('')
  const [categoria,    setCategoria]    = useState('')
  const [busqueda,     setBusqueda]     = useState('')
  const [filtroFecha,  setFiltroFecha]  = useState('')
  const [copiado,      setCopiado]      = useState(false)

  const { data, isLoading, isError, refetch } = useAuditoria({ pagina, porPagina: POR_PAGINA, usuarioId, categoria })
  const { data: usuarios = [] } = useUsuarios()
  const { tasaEfectiva } = useTasaCambio()

  const registros = data?.registros ?? []
  const total     = data?.total ?? 0
  const totalPags = Math.max(1, Math.ceil(total / POR_PAGINA))

  // Filtrar por búsqueda de texto y fecha (client-side sobre la página actual)
  const registrosFiltrados = useMemo(() => {
    let filtered = registros

    // Filtro de búsqueda
    if (busqueda.trim()) {
      const q = removeAccents(busqueda.toLowerCase())
      filtered = filtered.filter(r => {
        const usuario = removeAccents(r.usuario?.nombre ?? r.usuario_nombre ?? '').toLowerCase()
        const accion = removeAccents(ACCION_LABEL[r.accion] ?? r.accion ?? '').toLowerCase()
        const desc = removeAccents(r.descripcion ?? '').toLowerCase()
        return usuario.includes(q) || accion.includes(q) || desc.includes(q)
      })
    }

    // Filtro de fecha
    if (filtroFecha) {
      const ahora = new Date()
      filtered = filtered.filter(r => {
        const d = new Date(r.ts)
        if (filtroFecha === 'hoy') return d.toDateString() === ahora.toDateString()
        if (filtroFecha === 'semana') {
          const inicioSemana = new Date(ahora)
          inicioSemana.setDate(ahora.getDate() - ahora.getDay())
          inicioSemana.setHours(0, 0, 0, 0)
          return d >= inicioSemana
        }
        if (filtroFecha === 'mes') {
          return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear()
        }
        return true
      })
    }

    return filtered
  }, [registros, busqueda, filtroFecha])

  // Agrupar por fecha
  const grupos = useMemo(() => {
    const map = new Map()
    for (const r of registrosFiltrados) {
      const key = getDateKey(r.ts)
      if (!map.has(key)) map.set(key, { label: getDateGroupLabel(r.ts), registros: [] })
      map.get(key).registros.push(r)
    }
    return Array.from(map.values())
  }, [registrosFiltrados])

  // Contar registros de hoy (del total recibido)
  const hoyStr = new Date().toDateString()
  const countHoy = registros.filter(r => new Date(r.ts).toDateString() === hoyStr).length

  function cambiarFiltro(fn) {
    fn()
    setPagina(0)
  }

  const handleCopiarLogs = () => {
    if (registrosFiltrados.length === 0) {
      showToast('No hay registros para copiar', 'warning')
      return
    }

    const texto = registrosFiltrados.map(r => {
      const fecha = new Date(r.ts).toLocaleString('es-VE')
      const usuario = r.usuario?.nombre ?? r.usuario_nombre ?? 'Sistema'
      const rol = r.usuario?.rol ?? r.usuario_rol ?? 'SISTEMA'
      const accion = ACCION_LABEL[r.accion] ?? r.accion?.replace(/_/g, ' ')
      const desc = r.descripcion ? ` - Detalle: ${r.descripcion}` : ''
      const metaStr = r.meta && Object.keys(r.meta).length > 0 ? ` - Meta: ${JSON.stringify(r.meta)}` : ''
      return `[${fecha}] [${rol.toUpperCase()}] ${usuario}: ${accion}${desc}${metaStr}`
    }).join('\n')

    navigator.clipboard.writeText(texto)
      .then(() => {
        setCopiado(true)
        showToast('Logs copiados al portapapeles', 'ok')
        setTimeout(() => setCopiado(false), 2000)
      })
      .catch(() => {
        showToast('Error al copiar logs', 'error')
      })
  }

  const hayFiltros = categoria || usuarioId || busqueda || filtroFecha

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4">

      {/* Encabezado */}
      <PageHeader
        icon={ClipboardList}
        title="Auditoría"
        subtitle={isLoading ? 'Cargando...' : `${total.toLocaleString()} registros de actividad`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={handleCopiarLogs} disabled={isLoading || registrosFiltrados.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none select-none"
              title="Copiar logs al portapapeles">
              {copiado ? <Check size={13} className="text-emerald-600 animate-scale-up" /> : <Copy size={13} className="text-slate-500" />}
              <span>{copiado ? '¡Copiado!' : 'Copiar logs'}</span>
            </button>
            <button onClick={() => refetch()}
              className="p-2 rounded-xl transition-colors text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="Actualizar">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {/* Resumen rápido */}
      <div className="grid grid-cols-3 gap-3">
        <ResumenCard
          icon={Activity}
          label="Total registros"
          value={total.toLocaleString()}
          gradient="linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)"
          border="rgba(255,255,255,0.07)"
        />
        <ResumenCard
          icon={CalendarDays}
          label="Hoy"
          value={countHoy}
          gradient="linear-gradient(135deg, #0891b2 0%, #0e7490 100%)"
          border="rgba(255,255,255,0.10)"
        />
        <ResumenCard
          icon={TrendingUp}
          label="Esta página"
          value={registrosFiltrados.length}
          gradient="linear-gradient(135deg, #059669 0%, #047857 100%)"
          border="rgba(255,255,255,0.10)"
        />
      </div>

      {/* Búsqueda + Filtros */}
      <div className="space-y-3">
        {/* Barra de búsqueda */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por usuario, acción o descripción..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors placeholder:text-slate-400"
          />
          {busqueda && (
            <button onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filtros rápidos de fecha + selectores */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Chips de fecha */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {FILTROS_FECHA.map(f => (
              <button key={f.id}
                onClick={() => cambiarFiltro(() => setFiltroFecha(f.id))}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                  filtroFecha === f.id
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-200 hidden sm:block" />

          {/* Select de categoría */}
          <div className="min-w-[160px]">
            <CustomSelect
              options={CATEGORIAS_FILTRO.map(({ valor, label }) => ({ value: valor, label }))}
              value={categoria}
              onChange={val => cambiarFiltro(() => setCategoria(val))}
              placeholder="Categoría"
              searchable={false}
            />
          </div>

          {/* Select de usuario */}
          <div className="min-w-[160px]">
            <CustomSelect
              options={[
                { value: '', label: 'Todos los usuarios' },
                ...usuarios.map(u => ({ value: u.id, label: u.nombre })),
              ]}
              value={usuarioId}
              onChange={val => cambiarFiltro(() => setUsuarioId(val))}
              placeholder="Usuario"
            />
          </div>

          {hayFiltros && (
            <button onClick={() => { setCategoria(''); setUsuarioId(''); setBusqueda(''); setFiltroFecha(''); setPagina(0) }}
              className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 transition-colors">
              <X size={12} /> Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Timeline agrupado por fecha */}
      {isLoading ? (
        <SkeletonAuditoria />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-700">
          <p className="font-semibold text-sm">Error al cargar registros</p>
          <button onClick={() => refetch()} className="mt-2 text-xs underline">Intentar de nuevo</button>
        </div>
      ) : registrosFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
          <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">Sin actividad</p>
          <p className="text-xs mt-1">No hay registros que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map(grupo => (
            <div key={grupo.label}>
              {/* Separador de fecha */}
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  {grupo.label}
                </span>
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] text-slate-400 font-medium">
                  {grupo.registros.length} registro{grupo.registros.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Cards del grupo */}
              <div className="space-y-2">
                {grupo.registros.map(r => (
                  <ActividadCard key={r.id} registro={r} tasa={tasaEfectiva} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      {!isLoading && totalPags > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-2.5">
          <span className="text-xs text-slate-500">
            Pág. <strong>{pagina + 1}</strong> / <strong>{totalPags}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setPagina(p => p - 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={pagina === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
              <ChevronLeft size={12} /> Ant.
            </button>
            <button onClick={() => { setPagina(p => p + 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} disabled={pagina >= totalPags - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30 transition-colors">
              Sig. <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
