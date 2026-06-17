// src/views/OrdenCompraView.jsx
// Módulo de Orden de Compra (Exclusivo para supervisor, desarrollador y jefe)
// Diseñado con estética premium corporativa en tonos azul institucional (#1B365D) y bronce (#B8860B)
import { useState, useMemo, useEffect, useCallback, useRef, memo, Fragment } from 'react'
import {
  ShoppingCart, Plus, Search, Trash2, Download, Check, X, ArrowLeft,
  AlertTriangle, FileText, CheckCircle2, XCircle, Clock, Sparkles,
  User, Mail, Phone, MapPin, CreditCard, HelpCircle, Loader2, Calendar, FileQuestion,
  UserPlus, ChevronLeft, ChevronRight, MoreVertical, Pencil, RefreshCw
} from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import {
  useOrdenesCompra,
  useOrdenCompraItems,
  useCrearOrdenCompra,
  useActualizarEstadoOrdenCompra,
  useActualizarOrdenCompra,
  useEliminarOrdenCompra
} from '../hooks/useOrdenesCompra'
import { useClientes } from '../hooks/useClientes'
import ClienteForm from '../components/clientes/ClienteForm'
import { showToast } from '../components/ui/Toast'
import PageHeader from '../components/ui/PageHeader'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import ConfirmModal from '../components/ui/ConfirmModal'
import { Modal } from '../components/ui/Modal'
import { fmtFecha, fmtPrecio } from '../services/pdf/pdfShared'
import { removeAccents } from '../utils/format'
import supabase from '../services/supabase/client'

// ─── Helper compartido de badges de estado ──────────────────────────────────
export function getStatusBadge(estado) {
  const maps = {
    pendiente: { label: 'PENDIENTE', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
    aprobada:  { label: 'APROBADA',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
    anulada:   { label: 'ANULADA',   color: 'bg-red-50 text-red-700 border-red-200', icon: XCircle },
  }
  const match = maps[estado] || { label: String(estado).toUpperCase(), color: 'bg-slate-50 text-slate-650 border-slate-200', icon: Clock }
  const Icon = match.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-bold ${match.color}`}>
      <Icon size={12} />
      {match.label}
    </span>
  )
}


// ─── Componente de Tarjeta de Orden de Compra con Menú Kebab ──────────────────
const OrdenCompraCard = memo(({ orden, onVerDetalle, onDescargarPdf, onEditar, onAprobar, onEliminar }) => {
  const [showMenu, setShowMenu] = useState(false)
  const btnRef = useRef(null)

  const canEdit = orden.estado === 'pendiente'
  const canAprobar = orden.estado === 'pendiente'
  const canEliminar = true // Se puede eliminar en cualquier estado

  const menuActions = useMemo(() => {
    const actions = [
      { label: 'Ver Detalles', icon: FileText, onClick: () => onVerDetalle(orden) },
      { label: 'Descargar PDF', icon: Download, onClick: () => onDescargarPdf(orden) },
    ]
    if (canEdit) {
      actions.push({ label: 'Editar Orden', icon: Pencil, onClick: () => onEditar(orden), textColor: 'text-[#B8860B]' })
    }
    if (canAprobar) {
      actions.push({ label: 'Aprobar Orden', icon: Check, onClick: () => onAprobar(orden), textColor: 'text-emerald-600' })
    }
    if (canEliminar) {
      actions.push({ label: 'Eliminar Orden', icon: Trash2, onClick: () => onEliminar(orden), danger: true })
    }
    return actions
  }, [orden, canEdit, canAprobar, canEliminar, onVerDetalle, onDescargarPdf, onEditar, onAprobar, onEliminar])

  return (
    <div
      className="rounded-2xl p-5 border border-slate-200 bg-white hover:bg-slate-50/50 transition-all flex flex-col justify-between hover:shadow-lg hover:shadow-[#1B365D]/5 group relative"
    >
      <div>
        <div className="flex justify-between items-start mb-3">
          <span className="text-[#1B365D] font-black text-sm tracking-wider uppercase font-mono">
            OC-{String(orden.numero).padStart(5, '0')}
          </span>
          <div className="flex items-center gap-1.5">
            {getStatusBadge(orden.estado)}
            <button
              ref={btnRef}
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowMenu(v => !v) }}
              className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              title="Más opciones"
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>

        <h3 className="font-black text-base text-slate-800 group-hover:text-[#B8860B] transition-colors uppercase leading-tight line-clamp-1 pr-6">
          {orden.proveedor_nombre}
        </h3>
        <p className="text-xs text-slate-500 font-mono mt-0.5">RIF: {orden.proveedor_rif}</p>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
          <div>
            <span className="text-slate-400 block font-medium">Condición:</span>
            <span className="font-bold uppercase line-clamp-1 text-slate-700">{orden.condicion_pago}</span>
          </div>
          <div>
            <span className="text-slate-400 block font-medium">Emisión:</span>
            <span className="font-bold text-slate-700">{fmtFecha(orden.fecha_emision)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-3 flex justify-between items-center">
        <div>
          <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Monto Total</span>
          <span className="text-lg font-black text-[#1B365D] font-mono">{fmtPrecio(orden.total_usd, '$', 0, 0)}</span>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onVerDetalle(orden)}
            title="Ver detalles"
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-750 transition-colors cursor-pointer"
          >
            <FileText size={15} />
          </button>

          <button
            type="button"
            onClick={() => onDescargarPdf(orden)}
            title="Descargar PDF"
            className="p-2 rounded-xl bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent transition-colors cursor-pointer"
          >
            <Download size={15} />
          </button>
        </div>
      </div>

      {showMenu && (() => {
        const rect = btnRef.current?.getBoundingClientRect()
        const style = rect
          ? { position: 'fixed', right: window.innerWidth - rect.right, top: rect.bottom + 6, zIndex: 9999 }
          : { position: 'fixed', right: 16, top: 60, zIndex: 9999 }
        return (
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setShowMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1 font-sans">
              {menuActions.map((act, idx) => (
                <Fragment key={idx}>
                  {act.danger && <div className="border-t border-slate-100 my-1" />}
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { act.onClick(); setShowMenu(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                      act.danger ? 'text-red-650 hover:bg-red-50 font-semibold' :
                      act.textColor ? `${act.textColor} hover:bg-slate-50 font-semibold` :
                      'text-slate-700 hover:bg-slate-50 font-medium'
                    }`}
                  >
                    {act.icon && <act.icon size={14} />} {act.label}
                  </button>
                </Fragment>
              ))}
            </div>
          </>
        )
      })()}
    </div>
  )
})

// ─── Componente de Detalle de Orden de Compra ──────────────────────────────────
function DetalleOrdenModal({ orden, isOpen, onClose }) {
  const { data: items = [], isLoading } = useOrdenCompraItems(orden?.id)
  const [downloading, setDownloading] = useState(false)
  const { perfil } = useAuthStore()

  const handleDownload = async () => {
    if (!orden) return
    setDownloading(true)
    try {
      const { generarOrdenCompraPDF } = await import('../services/pdf/ordenCompraPDF')
      await generarOrdenCompraPDF({ orden, items, config: { supervisorNombre: perfil?.nombre } })
      showToast('PDF descargado con éxito', 'success')
    } catch (err) {
      console.error(err)
      showToast('Error al generar el PDF', 'error')
    } finally {
      setDownloading(false)
    }
  }

  if (!orden) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Detalle de Orden: OC-${String(orden.numero).padStart(5, '0')}`} className="sm:max-w-2xl">
      <div className="space-y-6 text-slate-800">
        {/* Info del Proveedor */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
          <h3 className="text-sm font-bold text-[#1B365D] mb-3 uppercase tracking-wider flex items-center gap-2">
            <User size={15} className="text-[#B8860B]" /> Datos del Proveedor
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-700">
            <div>
              <p className="text-xs text-slate-400 font-medium">Proveedor / Razón Social:</p>
              <p className="font-bold text-slate-800">{orden.proveedor_nombre}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">R.I.F. / C.I.:</p>
              <p className="font-bold text-slate-800 font-mono">{orden.proveedor_rif}</p>
            </div>
            {orden.proveedor_telefono && (
              <div>
                <p className="text-xs text-slate-400 font-medium">Teléfono:</p>
                <p className="font-semibold text-slate-800">{orden.proveedor_telefono}</p>
              </div>
            )}
            {orden.proveedor_correo && (
              <div>
                <p className="text-xs text-slate-400 font-medium">Correo Electrónico:</p>
                <p className="font-semibold text-slate-800">{orden.proveedor_correo}</p>
              </div>
            )}
            {orden.proveedor_contacto && (
              <div>
                <p className="text-xs text-slate-400 font-medium">Persona de Contacto:</p>
                <p className="font-semibold text-slate-800">{orden.proveedor_contacto}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400 font-medium">Condición de Pago:</p>
              <p className="font-semibold text-slate-800 uppercase">{orden.condicion_pago}</p>
            </div>
            {orden.proveedor_direccion && (
              <div className="md:col-span-2">
                <p className="text-xs text-slate-400 font-medium">Dirección:</p>
                <p className="font-semibold text-slate-800 whitespace-pre-wrap">{orden.proveedor_direccion}</p>
              </div>
            )}
          </div>
        </div>

        {/* Metadatos de la Orden */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center">
            <p className="text-xs text-slate-400 font-medium">Fecha de Emisión</p>
            <p className="font-bold text-slate-800 mt-1 flex items-center justify-center gap-1.5 font-mono">
              <Calendar size={14} className="text-[#B8860B]" />
              {fmtFecha(orden.fecha_emision)}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center flex flex-col items-center justify-center">
            <p className="text-xs text-slate-400 font-medium mb-1">Estado de la Orden</p>
            <div>{getStatusBadge(orden.estado)}</div>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center">
            <p className="text-xs text-slate-400 font-medium">Monto Total</p>
            <p className="font-black text-xl text-[#1B365D] mt-0.5 font-mono">
              {fmtPrecio(orden.total_usd, '$', 0, 0)}
            </p>
          </div>
        </div>

        {/* Items del Carrito */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-[#1B365D] uppercase tracking-wider flex items-center gap-2">
            <ShoppingCart size={15} className="text-[#B8860B]" /> Productos a Adquirir
          </h3>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No hay ítems registrados en esta orden.</p>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-xs sm:text-sm">
                      <th className="p-3 text-center w-12 sm:w-16">Cant.</th>
                      <th className="p-3">Descripción</th>
                      <th className="p-3 text-center w-14 sm:w-20">Unid.</th>
                      <th className="p-3 text-right w-24 sm:w-28">Precio ($)</th>
                      <th className="p-3 text-right w-24 sm:w-32">Total ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item.id || idx} className="border-b border-slate-100 hover:bg-slate-50 text-slate-700">
                        <td className="p-3 text-center font-bold text-[#1B365D] font-mono">{item.cantidad}</td>
                        <td className="p-3 font-semibold uppercase">{item.descripcion}</td>
                        <td className="p-3 text-center uppercase text-slate-500 font-medium">{item.unidad}</td>
                        <td className="p-3 text-right font-mono">{fmtPrecio(item.precio_unit_usd, '$', 0, 0)}</td>
                        <td className="p-3 text-right font-bold text-[#1B365D] font-mono">{fmtPrecio(item.total_usd, '$', 0, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Notas */}
        {orden.notas && (
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <p className="text-xs text-slate-400 font-bold mb-1 font-sans">NOTAS / TÉRMINOS:</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{orden.notas}</p>
          </div>
        )}

        {/* Acciones */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {downloading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            Descargar PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Draft (retomar) helpers ──────────────────────────────────────────────────
const OC_DRAFT_KEY = 'listopos_orden_compra_draft'

function getDraftKey(userId) {
  const state = useAuthStore.getState()
  const businessId = state.perfil?.cuenta_id
  const suffix = businessId ? `-${businessId}` : ''
  if (!userId) return `${OC_DRAFT_KEY}${suffix}`
  return `${OC_DRAFT_KEY}_${userId}${suffix}`
}

function saveDraft(state, userId) {
  try {
    localStorage.setItem(getDraftKey(userId), JSON.stringify({ ...state, _ts: Date.now(), _userId: userId }))
  } catch { /* ignorar */ }
}

function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(getDraftKey(userId))
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (Date.now() - draft._ts > 24 * 60 * 60 * 1000) { localStorage.removeItem(getDraftKey(userId)); return null }
    if (draft._userId && draft._userId !== userId) { localStorage.removeItem(getDraftKey(userId)); return null }
    return draft
  } catch { return null }
}

function clearDraft(userId) {
  try { localStorage.removeItem(getDraftKey(userId)) } catch { /* ignorar */ }
}

// ─── Vista Principal del Módulo ────────────────────────────────────────────────
export default function OrdenCompraView() {
  const { data: ordenes = [], isLoading, error, refetch } = useOrdenesCompra()
  const crearOrden = useCrearOrdenCompra()
  const actualizarOrden = useActualizarOrdenCompra()
  const actualizarEstado = useActualizarEstadoOrdenCompra()
  const eliminarOrden = useEliminarOrdenCompra()
  const isSaving = crearOrden.isPending || actualizarOrden.isPending

  // Estados de control
  const [modoCrear, setModoCrear] = useState(false)
  const [step, setStep] = useState(0)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [editandoId, setEditandoId] = useState(null)
  const [loadingEdit, setLoadingEdit] = useState(false)

  // Modales
  const [ordenSeleccionada, setOrdenSeleccionada] = useState(null)
  const [confirmEstado, setConfirmEstado] = useState(null) // { id, estado, titulo, mensaje }

  // Formulario Proveedor (Mapeado de Clientes del sistema)
  const { data: clientes = [] } = useClientes()
  const [clienteId, setClienteId] = useState('')
  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [clienteOpen, setClienteOpen] = useState(false)
  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const clienteRef = useRef(null)

  const [proveedorNombre, setProveedorNombre] = useState('')
  const [proveedorRif, setProveedorRif] = useState('')
  const [proveedorTelefono, setProveedorTelefono] = useState('')
  const [proveedorCorreo, setProveedorCorreo] = useState('')
  const [proveedorContacto, setProveedorContacto] = useState('')
  const [proveedorDireccion, setProveedorDireccion] = useState('')
  const [condicionPago, setCondicionPago] = useState('Contado')
  const [condicionPagoOtro, setCondicionPagoOtro] = useState('')
  const [notas, setNotas] = useState('')

  // Constructor de productos
  const [cestaItems, setCestaItems] = useState([])
  const [nuevoItemDesc, setNuevoItemDesc] = useState('')
  const [nuevoItemCant, setNuevoItemCant] = useState('1')
  const [nuevoItemUnid, setNuevoItemUnid] = useState('und')
  const [nuevoItemPrecio, setNuevoItemPrecio] = useState('0')

  // ─── Lógica de Borrador (Retomar) ──────────────────────────────────────────
  const { perfil } = useAuthStore()
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const draftRef = useRef(null)

  // Restaurar borrador al montar
  useEffect(() => {
    const draft = loadDraft(perfil?.id)
    if (draft && (draft.cestaItems?.length > 0 || draft.clienteId || draft.proveedorNombre)) {
      draftRef.current = draft
      setShowDraftBanner(true)
    }
  }, [perfil?.id])

  function restoreDraft() {
    const d = draftRef.current
    if (!d) return
    
    if (d.clienteId) setClienteId(d.clienteId)
    if (d.proveedorNombre) setProveedorNombre(d.proveedorNombre)
    if (d.proveedorRif) setProveedorRif(d.proveedorRif)
    if (d.proveedorTelefono) setProveedorTelefono(d.proveedorTelefono)
    if (d.proveedorCorreo) setProveedorCorreo(d.proveedorCorreo)
    if (d.proveedorContacto) setProveedorContacto(d.proveedorContacto)
    if (d.proveedorDireccion) setProveedorDireccion(d.proveedorDireccion)
    if (d.condicionPago) setCondicionPago(d.condicionPago)
    if (d.condicionPagoOtro) setCondicionPagoOtro(d.condicionPagoOtro)
    if (d.notas) setNotas(d.notas)
    if (d.cestaItems?.length > 0) setCestaItems(d.cestaItems)
    if (d.step != null && d.step >= 0 && d.step <= 2) setStep(d.step)
    
    setModoCrear(true)
    setShowDraftBanner(false)
    draftRef.current = null
    showToast('Borrador de orden de compra retomado', 'success')
  }

  function discardDraft() {
    clearDraft(perfil?.id)
    setShowDraftBanner(false)
    draftRef.current = null
    showToast('Borrador descartado', 'info')
  }

  // Auto-guardado debounced 1.5s
  useEffect(() => {
    if (crearOrden.isPending || !modoCrear || editandoId) return
    const timer = setTimeout(() => {
      if (cestaItems.length > 0 || clienteId || proveedorNombre || proveedorRif || notas) {
        saveDraft({
          step,
          clienteId,
          proveedorNombre,
          proveedorRif,
          proveedorTelefono,
          proveedorCorreo,
          proveedorContacto,
          proveedorDireccion,
          condicionPago,
          condicionPagoOtro,
          notas,
          cestaItems
        }, perfil?.id)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [
    step,
    clienteId,
    proveedorNombre,
    proveedorRif,
    proveedorTelefono,
    proveedorCorreo,
    proveedorContacto,
    proveedorDireccion,
    condicionPago,
    condicionPagoOtro,
    notas,
    cestaItems,
    crearOrden.isPending,
    modoCrear,
    perfil?.id,
    editandoId
  ])


  // Manejo de dropdown de clientes (clics fuera)
  useEffect(() => {
    function handleClickOutside(e) {
      if (clienteRef.current && !clienteRef.current.contains(e.target)) {
        setClienteOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Seleccionar proveedor desde clientes creados
  const elegirCliente = useCallback((c) => {
    setClienteId(c.id)
    setProveedorNombre(c.nombre || '')
    setProveedorRif(c.rif_cedula || '')
    setProveedorTelefono(c.telefono || '')
    setProveedorCorreo(c.correo || '')
    const addressParts = [c.direccion, c.ciudad, c.estado].filter(Boolean).join(', ')
    setProveedorDireccion(addressParts || '')
    setProveedorContacto(c.contacto_nombre || '')
    setClienteBusqueda('')
    setClienteOpen(false)
  }, [])

  // Limpiar seleccion de proveedor
  const handleLimpiarCliente = () => {
    setClienteId('')
    setProveedorNombre('')
    setProveedorRif('')
    setProveedorTelefono('')
    setProveedorCorreo('')
    setProveedorDireccion('')
    setProveedorContacto('')
  }

  // Filtrar clientes (excluir inactivos, preservando el seleccionado)
  const clientesFiltrados = useMemo(() => {
    const activos = clientes.filter(c => c.activo !== false || c.id === clienteId)
    if (!clienteBusqueda.trim()) return activos.slice(0, 8)
    const term = removeAccents(clienteBusqueda.toLowerCase())
    return activos.filter(c =>
      removeAccents(c.nombre || '').toLowerCase().includes(term) ||
      removeAccents(c.rif_cedula || '').toLowerCase().includes(term) ||
      (c.telefono || '').includes(term)
    ).slice(0, 8)
  }, [clientes, clienteBusqueda, clienteId])

  // Detectar si la tabla no existe en BD (Migración no aplicada)
  const dbMigracionFaltante = useMemo(() => {
    if (!error) return false
    return (
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      (error.message?.includes('relation') && error.message?.includes('does not exist')) ||
      error.message?.includes("Could not find the table")
    )
  }, [error])

  // Copiar el script SQL al portapapeles
  const handleCopiarSql = async () => {
    try {
      const response = await fetch('/supabase/migrations/146_ordenes_compra.sql')
      if (response.ok) {
        const sqlText = await response.text()
        await navigator.clipboard.writeText(sqlText)
        showToast('SQL copiado al portapapeles. Pégalo en Supabase SQL Editor.', 'success')
      } else {
        const fallbackSql = `-- Migración básica de órdenes de compra
-- Ejecuta la migración 146_ordenes_compra.sql completa en el dashboard`
        await navigator.clipboard.writeText(fallbackSql)
        showToast('Copia la migración 146_ordenes_compra.sql desde la carpeta supabase/migrations/', 'info')
      }
    } catch (_) {
      showToast('Error al copiar el código SQL', 'error')
    }
  }

  // Filtrado de órdenes en el listado
  const ordenesFiltradas = useMemo(() => {
    const q = removeAccents(busqueda.toLowerCase())
    return ordenes.filter(o => {
      const matchBusqueda =
        removeAccents(o.proveedor_nombre || '').toLowerCase().includes(q) ||
        removeAccents(o.proveedor_rif || '').toLowerCase().includes(q) ||
        `oc-${String(o.numero).padStart(5, '0')}`.includes(q)

      const matchEstado = filtroEstado === 'todos' || o.estado === filtroEstado
      return matchBusqueda && matchEstado
    })
  }, [ordenes, busqueda, filtroEstado])

  // Cálculos de totales
  const subtotalCesta = useMemo(() => {
    return cestaItems.reduce((acc, item) => acc + (Number(item.cantidad) * Number(item.precio_unit_usd)), 0)
  }, [cestaItems])

  const totalCesta = subtotalCesta // Sin IVA

  // Añadir ítem a la cesta
  const handleAgregarItem = (e) => {
    e.preventDefault()
    if (!nuevoItemDesc.trim()) {
      showToast('Escribe una descripción para el producto', 'warning')
      return
    }
    const cant = Number(nuevoItemCant)
    if (isNaN(cant) || cant <= 0) {
      showToast('La cantidad debe ser mayor a 0', 'warning')
      return
    }
    const precio = Number(nuevoItemPrecio)
    if (isNaN(precio) || precio < 0) {
      showToast('El precio no puede ser negativo', 'warning')
      return
    }

    const itemTotal = cant * precio
    const nuevoItem = {
      id: crypto.randomUUID(),
      descripcion: nuevoItemDesc.trim().toUpperCase(),
      cantidad: cant,
      unidad: nuevoItemUnid,
      precio_unit_usd: precio,
      total_usd: itemTotal
    }

    setCestaItems(prev => [...prev, nuevoItem])

    // Limpiar campos de item (manteniendo unidad preferida)
    setNuevoItemDesc('')
    setNuevoItemCant('1')
    setNuevoItemPrecio('0')
    showToast('Producto agregado a la cesta', 'success')
  }

  // Eliminar ítem de la cesta
  const handleEliminarItem = (itemId) => {
    setCestaItems(prev => prev.filter(item => item.id !== itemId))
  }

  // Modificar cantidad o precio de forma directa
  const handleModificarCestaItem = (itemId, campo, valor) => {
    setCestaItems(prev => prev.map(item => {
      if (item.id !== itemId) return item
      const editado = { ...item, [campo]: valor }
      editado.total_usd = Number(editado.cantidad) * Number(editado.precio_unit_usd)
      return editado
    }))
  }

  // Limpiar formulario completo
  const handleLimpiarForm = () => {
    setProveedorNombre('')
    setProveedorRif('')
    setProveedorTelefono('')
    setProveedorCorreo('')
    setProveedorContacto('')
    setProveedorDireccion('')
    setCondicionPago('Contado')
    setCondicionPagoOtro('')
    setNotas('')
    setCestaItems([])
    setClienteId('')
    setClienteBusqueda('')
    setClienteOpen(false)
    setStep(0)
    setEditandoId(null)
    clearDraft(perfil?.id)
  }

  // Editar Orden de Compra
  const handleEditarOrden = async (orden) => {
    setLoadingEdit(true)
    try {
      const { data: items, error: itemsError } = await supabase
        .from('orden_compra_items')
        .select('*')
        .eq('orden_compra_id', orden.id)
        .order('orden', { ascending: true })

      if (itemsError) throw itemsError

      // Hydrate supplier info
      setProveedorNombre(orden.proveedor_nombre || '')
      setProveedorRif(orden.proveedor_rif || '')
      setProveedorTelefono(orden.proveedor_telefono || '')
      setProveedorCorreo(orden.proveedor_correo || '')
      setProveedorContacto(orden.proveedor_contacto || '')
      setProveedorDireccion(orden.proveedor_direccion || '')

      // Condicion de pago
      const cond = orden.condicion_pago || 'Contado'
      if (['Contado', 'Crédito 7 días', 'Crédito 15 días', 'Crédito 30 días'].includes(cond)) {
        setCondicionPago(cond)
        setCondicionPagoOtro('')
      } else {
        setCondicionPago('Otro')
        setCondicionPagoOtro(cond)
      }

      setNotas(orden.notas || '')

      // Hydrate items
      const cesta = (items || []).map(item => ({
        id: item.id || crypto.randomUUID(),
        descripcion: item.descripcion.toUpperCase(),
        cantidad: item.cantidad,
        unidad: item.unidad || 'und',
        precio_unit_usd: item.precio_unit_usd,
        total_usd: item.total_usd
      }))
      setCestaItems(cesta)

      // Match supplier in clients dropdown list if possible
      const matchCliente = (clientes || []).find(c =>
        (c.rif_cedula && c.rif_cedula.toUpperCase() === orden.proveedor_rif?.toUpperCase()) ||
        (c.nombre && c.nombre.toUpperCase() === orden.proveedor_nombre?.toUpperCase())
      )
      if (matchCliente) {
        setClienteId(matchCliente.id)
      } else {
        setClienteId('')
      }

      setEditandoId(orden.id)
      setModoCrear(true)
      setStep(0)
      showToast(`Editando Orden de Compra OC-${String(orden.numero).padStart(5, '0')}`, 'info')
    } catch (err) {
      console.error(err)
      showToast('Error al cargar los ítems de la orden', 'error')
    } finally {
      setLoadingEdit(false)
    }
  }

  // Enviar / Guardar Orden de Compra
  const handleGuardarOrden = async (e) => {
    e.preventDefault()

    if (!proveedorNombre.trim()) {
      showToast('Ingresa la Razón Social del Proveedor', 'warning')
      return
    }
    if (!proveedorRif.trim()) {
      showToast('Ingresa el RIF del Proveedor', 'warning')
      return
    }
    if (cestaItems.length === 0) {
      showToast('Debes agregar al menos un producto a la cesta', 'warning')
      return
    }

    const finalCondicion = condicionPago === 'Otro' ? condicionPagoOtro.trim() : condicionPago
    if (!finalCondicion) {
      showToast('Ingresa la Condición de Pago', 'warning')
      return
    }

    const payload = {
      orden: {
        proveedor_nombre: proveedorNombre.trim().toUpperCase(),
        proveedor_rif: proveedorRif.trim().toUpperCase(),
        proveedor_direccion: proveedorDireccion.trim().toUpperCase(),
        proveedor_telefono: proveedorTelefono.trim(),
        proveedor_correo: proveedorCorreo.trim().toLowerCase(),
        proveedor_contacto: proveedorContacto.trim().toUpperCase(),
        condicion_pago: finalCondicion,
        subtotal_usd: subtotalCesta,
        total_usd: totalCesta,
        notas: notas.trim().toUpperCase()
      },
      items: cestaItems
    }

    try {
      let res
      if (editandoId) {
        res = await actualizarOrden.mutateAsync({
          id: editandoId,
          orden: payload.orden,
          items: payload.items
        })
        showToast('Orden de Compra actualizada con éxito', 'success')
      } else {
        res = await crearOrden.mutateAsync(payload)
        showToast('Orden de Compra creada en base de datos', 'success')
      }

      // Intentar generar y descargar PDF inmediatamente
      try {
        const { generarOrdenCompraPDF } = await import('../services/pdf/ordenCompraPDF')
        await generarOrdenCompraPDF({
          orden: res.orden,
          items: res.items,
          config: { supervisorNombre: perfil?.nombre }
        })
        showToast('PDF de la orden descargado', 'success')
      } catch (pdfErr) {
        console.error(pdfErr)
        showToast('Orden guardada, pero falló la descarga automática del PDF', 'warning')
      }

      handleLimpiarForm()
      setModoCrear(false)
      refetch()
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Error al guardar la orden de compra', 'error')
    }
  }

  // Confirmar y cambiar estado o eliminar
  const handleConfirmarEstado = async () => {
    if (!confirmEstado) return
    try {
      if (confirmEstado.estado === 'eliminar') {
        await eliminarOrden.mutateAsync(confirmEstado.id)
        showToast('Orden de compra eliminada de forma permanente', 'success')
      } else {
        await actualizarEstado.mutateAsync({
          id: confirmEstado.id,
          estado: confirmEstado.estado
        })
        showToast(`Orden de compra marcada como: ${confirmEstado.estado}`, 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('Error al procesar la orden', 'error')
    } finally {
      setConfirmEstado(null)
    }
  }

  // Wizard steps config
  const steps = [
    { label: 'Proveedor y Cesta', icon: UserPlus },
    { label: 'Condiciones de Pago', icon: CreditCard },
    { label: 'Confirmación', icon: CheckCircle2 }
  ]

  const step1Valid = proveedorNombre.trim() !== '' && proveedorRif.trim() !== '' && cestaItems.length > 0
  const step2Valid = (condicionPago !== 'Otro' || condicionPagoOtro.trim() !== '')

  return (
    <div className={`text-slate-800 transition-all duration-300 ${modoCrear ? 'flex flex-col h-[calc(100vh-68px)] md:h-[calc(100vh-16px)] min-h-0 overflow-hidden' : 'p-3 sm:p-4 md:p-5 lg:p-6 space-y-4 sm:space-y-5'}`}>
      {/* Page Header */}
      <div className={modoCrear ? 'p-4 md:p-5 pb-2 shrink-0' : ''}>
        <PageHeader
          icon={ShoppingCart}
          title="Orden de Compra"
          subtitle={modoCrear ? 'Construir nueva solicitud de adquisición' : `${ordenesFiltradas.length} ordenes registradas`}
          action={
            !dbMigracionFaltante && (
              <button
                onClick={() => {
                  if (modoCrear) {
                    handleLimpiarForm()
                    setModoCrear(false)
                  } else {
                    setModoCrear(true)
                  }
                }}
                className={`flex items-center gap-2 font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-95 border-2 cursor-pointer ${
                  modoCrear
                    ? 'bg-white hover:bg-slate-50 text-[#1B365D] border-[#1B365D] shadow-sm font-black'
                    : 'bg-primary hover:bg-primary-hover text-white border-primary'
                }`}
              >
                {modoCrear ? (
                  <>
                    <ArrowLeft size={16} /> Volver a la Lista
                  </>
                ) : (
                  <>
                    <Plus size={16} /> Nueva Orden de Compra
                  </>
                )}
              </button>
            )
          }
        />
      </div>

      {/* ── ALERTA BORRADOR PENDIENTE ────────────────────────────────────────── */}
      {showDraftBanner && !dbMigracionFaltante && (
        <div className={modoCrear ? 'px-4 md:px-5 mb-1 shrink-0' : ''}>
          <div className="p-4 rounded-2xl bg-amber-50/90 backdrop-blur-sm border border-amber-200 shadow-sm flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-xl bg-amber-100/80 text-amber-700 shrink-0">
                <ShoppingCart size={18} />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-amber-900 leading-tight">Borrador de Orden de Compra Pendiente</h4>
                <p className="text-xs text-amber-750 mt-0.5 font-medium">Tienes una orden de compra iniciada sin guardar. ¿Deseas recuperarla?</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={restoreDraft}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                Retomar
              </button>
              <button
                type="button"
                onClick={discardDraft}
                className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ALERTA MIGRACIÓN FALTANTE ────────────────────────────────────────── */}
      {dbMigracionFaltante && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-amber-500/30 shadow-2xl space-y-4 max-w-4xl mx-auto">
          <div className="flex gap-4 items-start">
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-amber-400 font-sans">Migración de Base de Datos Requerida</h2>
              <p className="text-sm text-slate-300 mt-1 leading-relaxed font-sans">
                El módulo de Órdenes de Compra requiere una estructura dedicada en Supabase (`146_ordenes_compra.sql`).
                Actualmente las tablas no existen en la base de datos de producción.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={handleCopiarSql}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl transition-all shadow-lg shadow-amber-400/20 active:scale-95"
                >
                  Copiar Código SQL de Migración
                </button>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors border border-white/10"
                >
                  Abrir Supabase Dashboard
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODO LISTADO ──────────────────────────────────────────────────────── */}
      {!modoCrear && !dbMigracionFaltante && (
        <div className="space-y-4">
          {/* Barra de Filtros */}
          <div className="flex flex-col md:flex-row gap-3">
            {/* Buscador Inteligente */}
            <div className="relative flex-1">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por Proveedor, RIF o número OC..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full pl-11 pr-10 py-2.5 rounded-2xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-[#1B365D]/10 focus:border-[#1B365D] transition-all shadow-sm"
              />
              {busqueda && (
                <button onClick={() => setBusqueda('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-1 rounded-full transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Selector de Estado y Botón Recargar */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 self-start">
              <button
                onClick={() => refetch()}
                className="p-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-[#1B365D] rounded-xl transition-all shadow-sm shrink-0 mr-1"
                title="Recargar órdenes"
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin text-[#1B365D]' : ''} />
              </button>
              {['todos', 'pendiente', 'aprobada', 'anulada'].map(est => (
                <button
                  key={est}
                  onClick={() => setFiltroEstado(est)}
                  className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all border whitespace-nowrap uppercase ${
                    filtroEstado === est
                      ? 'bg-[#1B365D] text-white border-[#1B365D] shadow-sm font-bold'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-[#1B365D]/40'
                  }`}
                >
                  {est === 'todos' ? 'Ver Todos' : est}
                </button>
              ))}
            </div>
          </div>

          {/* Listado Principal */}
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-2xl" />
              <Skeleton className="h-16 w-full rounded-2xl" />
              <Skeleton className="h-16 w-full rounded-2xl" />
            </div>
          ) : ordenesFiltradas.length === 0 ? (
            <EmptyState
              icon={FileQuestion}
              title={busqueda || filtroEstado !== 'todos' ? 'Sin Coincidencias' : 'Sin Órdenes de Compra'}
              description={
                busqueda || filtroEstado !== 'todos'
                  ? 'Intenta cambiar tus parámetros de búsqueda o limpiar el filtro de estado.'
                  : 'Empieza a planificar tus compras y adquiere productos externos con el botón de creación.'
              }
              actionLabel={busqueda || filtroEstado !== 'todos' ? 'Limpiar filtros' : 'Nueva Orden'}
              onAction={
                busqueda || filtroEstado !== 'todos'
                  ? () => { setBusqueda(''); setFiltroEstado('todos') }
                  : () => setModoCrear(true)
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ordenesFiltradas.map((o) => (
                <OrdenCompraCard
                  key={o.id}
                  orden={o}
                  onVerDetalle={setOrdenSeleccionada}
                  onDescargarPdf={async (orden) => {
                    try {
                      const { data: itms } = await supabase.from('orden_compra_items').select('*').eq('orden_compra_id', orden.id).order('orden')
                      const { generarOrdenCompraPDF } = await import('../services/pdf/ordenCompraPDF')
                      await generarOrdenCompraPDF({ orden, items: itms, config: { supervisorNombre: perfil?.nombre } })
                      showToast('PDF generado correctamente', 'success')
                    } catch (err) {
                      showToast('Error al descargar PDF', 'error')
                    }
                  }}
                  onEditar={handleEditarOrden}
                  onAprobar={(orden) => setConfirmEstado({
                    id: orden.id,
                    estado: 'aprobada',
                    titulo: 'Aprobar Orden de Compra',
                    mensaje: `¿Aprobar formalmente la Orden de Compra OC-${String(orden.numero).padStart(5, '0')} para "${orden.proveedor_nombre}"?`
                  })}
                  onEliminar={(orden) => setConfirmEstado({
                    id: orden.id,
                    estado: 'eliminar',
                    titulo: 'Eliminar Orden de Compra',
                    mensaje: `¿Estás completamente seguro que deseas ELIMINAR la Orden de Compra OC-${String(orden.numero).padStart(5, '0')}? Esta acción la borrará de la base de datos permanentemente.`
                  })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODO CREACIÓN: WIZARD DE 3 PASOS ────────────────────────────────────────────── */}
      {modoCrear && !dbMigracionFaltante && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden space-y-4">
          
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200/80 rounded-2xl shrink-0">
            {steps.map((s, i) => {
              const Icon = s.icon
              const active = i === step
              const done = i < step
              return (
                <div key={i} className="flex items-center gap-2">
                  {i > 0 && <div className={`w-8 sm:w-16 h-0.5 ${done ? 'bg-accent' : 'bg-slate-200'}`} />}
                  <button
                    type="button"
                    onClick={() => { if (done) setStep(i) }}
                    disabled={!done && !active}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all ${
                      active ? 'bg-primary/10 text-primary ring-2 ring-primary/20' :
                      done ? 'bg-accent/10 text-accent cursor-pointer hover:bg-accent/20' :
                      'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <Icon size={14} />
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                </div>
              )
            })}
          </div>

          <form
            onSubmit={handleGuardarOrden}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {/* Contenedor con scroll propio para evitar doble scroll */}
            <div className="flex-1 overflow-y-auto px-1 py-1 space-y-6 scrollbar-thin">
              
              {/* ── PASO 1: PROVEEDOR Y CESTA ────────────────────────────────────────── */}
              {step === 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
                
                {/* Columna Izquierda: Proveedor */}
                <div className="lg:col-span-1 space-y-4">
                  <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5 text-slate-800 space-y-4">
                    <h3 className="text-sm font-bold text-[#1B365D] uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2 mb-3">
                      <User size={16} className="text-[#B8860B]" />
                      Datos del Proveedor
                    </h3>

                    {/* Selector de Cliente / Proveedor */}
                    {clienteId ? (
                      <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50">
                        <User size={16} className="shrink-0 text-[#1B365D]" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-[#1B365D] truncate">{proveedorNombre}</p>
                          {proveedorRif && <span className="text-xs text-slate-500 font-mono">RIF: {proveedorRif}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={handleLimpiarCliente}
                          className="p-1 rounded-lg hover:bg-slate-200/50 text-slate-400 hover:text-slate-600 transition-colors"
                          title="Quitar proveedor seleccionado"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div ref={clienteRef} className="relative space-y-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Buscar Proveedor / Cliente *</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Escribe para buscar..."
                              value={clienteBusqueda}
                              onChange={e => { setClienteBusqueda(e.target.value); setClienteOpen(true) }}
                              onFocus={() => setClienteOpen(true)}
                              className="w-full pl-10 pr-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all"
                            />
                            {clienteOpen && clientesFiltrados.length > 0 && (
                              <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
                                  {clientesFiltrados.map(c => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => elegirCliente(c)}
                                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 rounded-xl text-sm flex items-center justify-between transition-all group"
                                    >
                                      <div className="min-w-0">
                                        <span className="font-semibold text-slate-700 block truncate group-hover:text-primary transition-colors">{c.nombre}</span>
                                        {c.rif_cedula && <span className="text-xs text-slate-400 font-mono">{c.rif_cedula}</span>}
                                      </div>
                                      <ChevronRight size={14} className="text-slate-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {clienteOpen && clienteBusqueda && clientesFiltrados.length === 0 && (
                              <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/50 p-4 text-center text-xs text-slate-500 animate-in fade-in slide-in-from-top-2 duration-150">
                                Sin coincidencias. Créalo usando "+".
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowNuevoCliente(true)}
                            className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors flex items-center justify-center shrink-0"
                            title="Crear nuevo cliente"
                          >
                            <UserPlus size={18} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Razón Social */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Razón Social o Proveedor *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. ACEROS DE VENEZUELA S.A."
                        value={proveedorNombre}
                        onChange={e => setProveedorNombre(e.target.value.toUpperCase())}
                        className="w-full uppercase px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-semibold"
                      />
                    </div>

                    {/* RIF */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">R.I.F. / C.I. *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. J-12345678-9"
                        value={proveedorRif}
                        onChange={e => setProveedorRif(e.target.value.toUpperCase())}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-mono uppercase"
                      />
                    </div>

                    {/* Teléfono */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Teléfono de Contacto</label>
                      <input
                        type="text"
                        placeholder="Ej. +58 412 1234567"
                        value={proveedorTelefono}
                        onChange={e => setProveedorTelefono(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all"
                      />
                    </div>

                    {/* Correo */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Correo Electrónico</label>
                      <input
                        type="email"
                        placeholder="Ej. ventas@proveedor.com"
                        value={proveedorCorreo}
                        onChange={e => setProveedorCorreo(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-mono"
                      />
                    </div>

                    {/* Contacto */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Atención a (Persona de Contacto)</label>
                      <input
                        type="text"
                        placeholder="Ej. Ing. Carlos Pérez"
                        value={proveedorContacto}
                        onChange={e => setProveedorContacto(e.target.value.toUpperCase())}
                        className="w-full uppercase px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-semibold"
                      />
                    </div>

                    {/* Dirección Fiscal */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dirección Fiscal / Despacho</label>
                      <textarea
                        rows={2}
                        placeholder="Dirección del almacén del proveedor..."
                        value={proveedorDireccion}
                        onChange={e => setProveedorDireccion(e.target.value.toUpperCase())}
                        className="w-full uppercase px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-semibold"
                      />
                    </div>
                  </div>
                </div>

                {/* Columna Derecha: Constructor y Cesta */}
                <div className="lg:col-span-2 space-y-4">
                  
                  {/* Constructor de Productos */}
                  <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5 text-slate-800 space-y-4">
                    <h3 className="text-sm font-bold text-[#1B365D] uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2 mb-3">
                      <Sparkles size={16} className="text-[#B8860B]" />
                      Constructor de Productos Externos
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      {/* Descripción */}
                      <div className="md:col-span-6 space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Descripción del Producto *</label>
                        <input
                          type="text"
                          placeholder="Ej. CABILLA ESTRIADA 1/2 X 12 MTS"
                          value={nuevoItemDesc}
                          onChange={e => setNuevoItemDesc(e.target.value.toUpperCase())}
                          className="w-full uppercase px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all"
                        />
                      </div>

                      {/* Cantidad */}
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cantidad *</label>
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          placeholder="1"
                          value={nuevoItemCant}
                          onChange={e => setNuevoItemCant(e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-center placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-mono"
                        />
                      </div>

                      {/* Unidad */}
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Unidad</label>
                        <select
                          value={nuevoItemUnid}
                          onChange={e => setNuevoItemUnid(e.target.value)}
                          className="w-full px-2 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all"
                        >
                          <option value="und">UND</option>
                          <option value="mts">MTS</option>
                          <option value="kg">KG</option>
                          <option value="tn">TN</option>
                          <option value="pza">PZA</option>
                        </select>
                      </div>

                      {/* Costo Unitario */}
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Costo Unit. ($) *</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={nuevoItemPrecio}
                          onChange={e => setNuevoItemPrecio(e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-right placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={handleAgregarItem}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#1B365D]/10 hover:bg-[#1B365D]/20 text-[#1B365D] border border-[#1B365D]/10 transition-colors"
                      >
                        <Plus size={14} />
                        Agregar a la Cesta
                      </button>
                    </div>
                  </div>

                  {/* Cesta */}
                  <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5 text-slate-800 space-y-4">
                    <h3 className="text-sm font-bold text-[#1B365D] uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2 mb-3">
                      <ShoppingCart size={16} className="text-[#B8860B]" />
                      Datos de Producto a Adquirir (Cesta)
                    </h3>

                    {cestaItems.length === 0 ? (
                      <div className="text-center py-10 text-slate-500 space-y-2 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                        <ShoppingCart size={24} className="mx-auto text-slate-400" />
                        <p className="text-sm font-semibold text-slate-700">Cesta vacía</p>
                        <p className="text-xs max-w-sm mx-auto text-slate-400">
                          Usa el constructor de productos externos arriba para añadir los artículos que deseas adquirir.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-sm">
                              <thead>
                                <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold">
                                  <th className="p-3 text-center w-24">Cant.</th>
                                  <th className="p-3">Descripción</th>
                                  <th className="p-3 text-center w-24">Unid.</th>
                                  <th className="p-3 text-right w-32">Precio Unit. ($)</th>
                                  <th className="p-3 text-right w-36">Total ($)</th>
                                  <th className="p-3 text-center w-16"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {cestaItems.map((item) => (
                                  <tr key={item.id} className="border-b border-slate-200/60 hover:bg-slate-200/20 text-slate-700 transition-colors">
                                    {/* Cantidad editable */}
                                    <td className="p-2 text-center">
                                      <input
                                        type="number"
                                        step="any"
                                        value={item.cantidad}
                                        onChange={e => handleModificarCestaItem(item.id, 'cantidad', e.target.value)}
                                        className="w-16 px-2 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 text-center font-bold font-mono focus:ring-1 focus:ring-[#1B365D]"
                                      />
                                    </td>
                                    {/* Descripción */}
                                    <td className="p-3 font-semibold uppercase text-slate-850">{item.descripcion}</td>
                                    {/* Unidad */}
                                    <td className="p-3 text-center uppercase text-slate-500 font-medium">{item.unidad}</td>
                                    {/* Precio unitario editable */}
                                    <td className="p-2 text-right">
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={item.precio_unit_usd}
                                        onChange={e => handleModificarCestaItem(item.id, 'precio_unit_usd', e.target.value)}
                                        className="w-24 px-2 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 text-right font-semibold font-mono focus:ring-1 focus:ring-[#1B365D]"
                                      />
                                    </td>
                                    {/* Total */}
                                    <td className="p-3 text-right font-bold text-[#1B365D] font-mono">
                                      {fmtPrecio(item.total_usd, '$', 0, 0)}
                                    </td>
                                    {/* Eliminar */}
                                    <td className="p-3 text-center">
                                      <button
                                        type="button"
                                        onClick={() => handleEliminarItem(item.id)}
                                        className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-slate-100"
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Panel de Totales */}
                        <div className="flex justify-end pt-2">
                          <div className="w-full md:w-80 p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col space-y-2.5">
                            <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                              <span>Subtotal:</span>
                              <span className="font-bold text-slate-700 font-mono">{fmtPrecio(subtotalCesta, '$', 0, 0)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-slate-500 font-medium border-b border-slate-200/60 pb-2">
                              <span>I.V.A. (Exento / Sin IVA):</span>
                              <span className="font-bold text-slate-400 font-mono">$0.00</span>
                            </div>
                            <div className="flex justify-between items-center text-sm font-black text-slate-800">
                              <span>Total General:</span>
                              <span className="text-lg text-[#1B365D] font-black font-mono">{fmtPrecio(totalCesta, '$', 0, 0)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── PASO 2: CONDICIONES Y PAGO ────────────────────────────────────── */}
            {step === 1 && (
              <div className="max-w-xl mx-auto space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200 text-slate-800">
                <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-6 space-y-5">
                  <h3 className="text-base font-bold text-[#1B365D] uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2 mb-3">
                    <CreditCard size={18} className="text-[#B8860B]" />
                    Condición de Pago y Términos
                  </h3>

                  {/* Condición de Pago */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Condición de Pago *</label>
                    <select
                      value={condicionPago}
                      onChange={e => setCondicionPago(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all"
                    >
                      <option value="Contado">Contado</option>
                      <option value="Crédito 7 días">Crédito 7 días</option>
                      <option value="Crédito 15 días">Crédito 15 días</option>
                      <option value="Crédito 30 días">Crédito 30 días</option>
                      <option value="Otro">Otro (Especificar)</option>
                    </select>
                    {condicionPago === 'Otro' && (
                      <input
                        type="text"
                        required
                        placeholder="Especificar condición de pago..."
                        value={condicionPagoOtro}
                        onChange={e => setCondicionPagoOtro(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all animate-in fade-in slide-in-from-top-1 duration-150"
                      />
                    )}
                  </div>

                  {/* Notas / Términos de Calidad */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notas / Términos de Calidad</label>
                    <textarea
                      rows={4}
                      placeholder="Ej. Toda entrega debe venir acompañada de su Certificado de Calidad del Acero..."
                      value={notas}
                      onChange={e => setNotas(e.target.value.toUpperCase())}
                      className="w-full uppercase px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D] focus:bg-white transition-all font-semibold"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── PASO 3: CONFIRMACIÓN ─────────────────────────────────────────── */}
            {step === 2 && (
              <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200 text-slate-800">
                <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5 md:p-6 space-y-6">
                  <h3 className="text-base font-bold text-[#1B365D] uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2 mb-3">
                    <CheckCircle2 size={18} className="text-[#B8860B]" />
                    Confirmación de la Orden de Compra
                  </h3>

                  {/* Datos Generales */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 rounded-xl border border-slate-100 bg-slate-50">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Proveedor / Razón Social</p>
                      <p className="font-bold text-slate-800 text-sm">{proveedorNombre}</p>
                      {proveedorRif && <p className="text-xs text-slate-500 font-mono mt-0.5">RIF: {proveedorRif}</p>}
                      {proveedorTelefono && <p className="text-xs text-slate-500 mt-0.5">Tel: {proveedorTelefono}</p>}
                      {proveedorCorreo && <p className="text-xs text-slate-500 mt-0.5">Correo: {proveedorCorreo}</p>}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Detalles de Entrega & Pago</p>
                      <p className="font-semibold text-slate-800 text-sm mt-1 flex items-center gap-1.5">
                        <CreditCard size={14} className="text-[#B8860B]" />
                        Condición: <span className="uppercase">{condicionPago === 'Otro' ? condicionPagoOtro : condicionPago}</span>
                      </p>
                      {proveedorContacto && (
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                          <User size={12} />
                          Atención: <span className="font-medium text-slate-700">{proveedorContacto}</span>
                        </p>
                      )}
                      {proveedorDireccion && (
                        <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap flex items-start gap-1">
                          <MapPin size={12} className="shrink-0 mt-0.5" />
                          <span>Dirección: {proveedorDireccion}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Ítems a adquirir */}
                  <div className="space-y-2.5">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Productos a Adquirir</p>
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                      <table className="w-full text-left border-collapse text-xs md:text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                            <th className="p-3 text-center w-16">Cant.</th>
                            <th className="p-3">Descripción</th>
                            <th className="p-3 text-center w-20">Unid.</th>
                            <th className="p-3 text-right w-28">Precio Unit. ($)</th>
                            <th className="p-3 text-right w-32">Total ($)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cestaItems.map((item, idx) => (
                            <tr key={item.id || idx} className="border-b border-slate-100 hover:bg-slate-50 text-slate-700">
                              <td className="p-3 text-center font-bold text-[#1B365D] font-mono">{item.cantidad}</td>
                              <td className="p-3 font-semibold uppercase text-slate-800">{item.descripcion}</td>
                              <td className="p-3 text-center uppercase text-slate-500 font-medium">{item.unidad}</td>
                              <td className="p-3 text-right font-mono">{fmtPrecio(item.precio_unit_usd, '$', 0, 0)}</td>
                              <td className="p-3 text-right font-bold text-[#1B365D] font-mono">{fmtPrecio(item.total_usd, '$', 0, 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Notas y Totales */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 border-t border-slate-100 pt-4">
                    {/* Notas */}
                    <div className="md:col-span-7 space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Notas / Términos de Calidad</p>
                      <div className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-slate-600 text-xs whitespace-pre-wrap min-h-16 leading-relaxed">
                        {notas.trim() ? notas.trim() : 'Sin observaciones o términos adicionales de calidad.'}
                      </div>
                    </div>

                    {/* Totales */}
                    <div className="md:col-span-5 p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-center space-y-2">
                      <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                        <span>Subtotal exento:</span>
                        <span className="font-bold text-slate-700 font-mono">{fmtPrecio(subtotalCesta, '$', 0, 0)}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-slate-500 font-medium border-b border-slate-200/60 pb-2">
                        <span>I.V.A. (Exento / Sin IVA):</span>
                        <span className="font-bold text-slate-400 font-mono">$0.00</span>
                      </div>
                      <div className="flex justify-between items-center text-base font-black text-slate-800">
                        <span>Total General:</span>
                        <span className="text-xl text-[#1B365D] font-black font-mono">{fmtPrecio(totalCesta, '$', 0, 0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            </div>

            {/* Sticky Bottom Navigation Bar */}
            <div
              className="shrink-0 bg-white border-t border-slate-200 px-4 py-3.5 flex items-center justify-between gap-3 z-30"
              style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom, 0px))' }}
            >
              {step === 0 ? (
                <button
                  type="button"
                  onClick={() => { handleLimpiarForm(); setModoCrear(false) }}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-650 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  <ArrowLeft size={16} /> Atrás
                </button>
              )}

              {step < 2 ? (
                <button
                  type="button"
                  onClick={() => setStep(step + 1)}
                  disabled={!step1Valid}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSaving || !step2Valid}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Guardando...
                    </>
                  ) : (
                    <>
                      <Check size={16} /> Confirmar y Descargar PDF
                    </>
                  )}
                </button>
              )}
            </div>

          </form>
        </div>
      )}

      {/* ── MODAL: REGISTRAR NUEVO CLIENTE (PROVEEDOR) ────────────────────────────────── */}
      {showNuevoCliente && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[80vh] sm:max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b shrink-0 border-slate-100">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 text-base">
                <UserPlus size={18} className="text-[#1B365D]" />
                Registrar Nuevo Proveedor (Cliente)
              </h3>
              <button
                type="button"
                onClick={() => setShowNuevoCliente(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0 text-slate-800">
              <ClienteForm
                onSuccess={(nuevo) => {
                  elegirCliente(nuevo)
                  setShowNuevoCliente(false)
                  showToast('Proveedor registrado y seleccionado', 'success')
                }}
                onCancel={() => setShowNuevoCliente(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: VER DETALLE DE ORDEN ───────────────────────────────────────── */}
      <DetalleOrdenModal
        orden={ordenSeleccionada}
        isOpen={!!ordenSeleccionada}
        onClose={() => setOrdenSeleccionada(null)}
      />

      {/* ── MODAL: CONFIRMAR ESTADO ───────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={!!confirmEstado}
        onClose={() => setConfirmEstado(null)}
        onConfirm={handleConfirmarEstado}
        loading={actualizarEstado.isPending}
        title={confirmEstado?.titulo || ''}
        message={confirmEstado?.mensaje || ''}
        confirmLabel={confirmEstado?.estado === 'aprobada' ? 'Aprobar' : 'Anular'}
      />

      {loadingEdit && (
        <div className="fixed inset-0 z-[110] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center gap-3 border border-slate-100 max-w-xs text-center">
            <Loader2 className="animate-spin text-[#1B365D]" size={32} />
            <p className="text-sm font-bold text-slate-700">Cargando datos de la orden...</p>
          </div>
        </div>
      )}
    </div>
  )
}
