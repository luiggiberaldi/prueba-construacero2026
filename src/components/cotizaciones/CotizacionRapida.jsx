// src/components/cotizaciones/CotizacionRapida.jsx
// Cotización rápida — totalmente responsiva (mobile-first)
import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Zap, User, X, Plus, Minus, Package, ArrowLeft, Save, Send, Loader2,
  RefreshCw, Search, CheckCircle, ShoppingCart, DollarSign,
  AlertCircle, ChevronRight, UserPlus, ChevronUp,
} from 'lucide-react'
import { useClientes } from '../../hooks/useClientes'
import ClienteForm from '../clientes/ClienteForm'
import { useInventario, useCategorias } from '../../hooks/useInventario'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useLineItems } from '../../hooks/useLineItems'
import { useGuardarBorrador, useEnviarCotizacion } from '../../hooks/useCotizaciones'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import useAuthStore from '../../store/useAuthStore'
import { usePrecioVendedor } from '../../hooks/usePrecioVendedor'
import { round2, mulR } from '../../utils/dinero'
import { calcTotales } from '../../utils/calcTotales'
import { fmtUsdSimple as fmtUsd, fmtBs, removeAccents } from '../../utils/format'
import { guardarProductoReciente, getProductosRecientes } from './ProductosRecientes'
import { showToast } from '../ui/Toast'

export default function CotizacionRapida({ onVolver, onGuardado }) {
  const { perfil } = useAuthStore()
  const { aplicarMarkup, esExterno } = usePrecioVendedor()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const { data: clientes = [] } = useClientes()
  const { data: inventarioData } = useInventario({ pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const { data: categorias = [] } = useCategorias()
  const { data: config = {} } = useConfigNegocio()
  const guardarBorrador = useGuardarBorrador()
  const enviarCotizacion = useEnviarCotizacion()
  const tasaHook = useTasaCambio()

  const [clienteId, setClienteId] = useState('')
  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [clienteOpen, setClienteOpen] = useState(false)
  const [productoBusqueda, setProductoBusqueda] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const { items, setItems, agregarItem: _agregarItem, editarItem: cambiarItem, eliminarItem, limpiar: limpiarItems } = useLineItems({ withDescuento: true, checkStock: true })
  const descuentoGlobalPct = 0
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [lastAdded, setLastAdded] = useState(null)
  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [confirmAjeno, setConfirmAjeno] = useState(null)

  const clienteRef = useRef(null)
  const productoInputRef = useRef(null)

  const { subtotal, descuentoUsd: _descuentoUsd, totalUsd } = calcTotales(items, descuentoGlobalPct, 0)
  const tasa = tasaHook.tasaEfectiva || 0
  const totalBs = tasa > 0 ? mulR(totalUsd, tasa) : 0

  const idsAgregados = new Set(items.map(it => it.productoId))
  const clienteSeleccionado = clientes.find(c => c.id === clienteId)
  const totalItems = items.reduce((s, it) => s + it.cantidad, 0)

  const clienteOk = !!clienteId
  const productosOk = items.length > 0
  const cargando = guardando || enviando

  // Seleccionar cliente con chequeo de vendedor asignado
  function elegirCliente(c) {
    if (!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id) {
      setConfirmAjeno(c)
      return
    }
    setClienteId(c.id)
    setClienteBusqueda('')
    setClienteOpen(false)
    productoInputRef.current?.focus()
  }

  // Cerrar dropdown cliente al click fuera
  useEffect(() => {
    function handleClick(e) {
      if (clienteRef.current && !clienteRef.current.contains(e.target)) setClienteOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Bloquear scroll body cuando el carrito móvil está abierto
  useEffect(() => {
    if (mobileCartOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [mobileCartOpen])

  // Filtrar clientes (excluir inactivos, preservando el seleccionado)
  const clientesFiltrados = useMemo(() => {
    if (!clienteBusqueda.trim()) return []
    const q = removeAccents(clienteBusqueda.toLowerCase())
    return clientes.filter(c =>
      (c.activo !== false || c.id === clienteId) && (
        removeAccents(c.nombre.toLowerCase()).includes(q) ||
        removeAccents((c.rif_cedula ?? '').toLowerCase()).includes(q) ||
        (c.telefono ?? '').includes(clienteBusqueda)
      )
    ).slice(0, 8)
  }, [clientes, clienteBusqueda, clienteId])

  // Filtrar productos
  const productosFiltrados = useProductSearch(productos, productoBusqueda, catActiva)

  // Productos recientes
  const recientes = getProductosRecientes(perfil?.id)
    .map(r => productos.find(p => p.id === r.id))
    .filter(Boolean)
    .slice(0, 6)

  function stockDisponible(productoId) {
    const p = productos.find(x => x.id === productoId)
    return p ? Number(p.stock_actual) || 0 : 0
  }

  function agregarProducto(p) {
    guardarProductoReciente(perfil?.id, p)
    const precioBase = Number(p.precio_usd || p.preciousd || 0)
    const precioConMarkup = aplicarMarkup(precioBase)
    const pConMarkup = {
      ...p,
      precio_usd: precioConMarkup,
      preciousd: precioConMarkup
    }
    _agregarItem(pConMarkup)
    setLastAdded(p.id)
    setTimeout(() => setLastAdded(null), 600)
  }

  async function handleGuardar() {
    if (!clienteId) { setError('Selecciona un cliente'); return }
    if (items.length === 0) { setError('Agrega al menos un producto'); return }
    setError('')
    setGuardando(true)
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.')), 30000))
      await Promise.race([
        guardarBorrador.mutateAsync({
          cotizacionId: null,
          campos: { clienteId, descuentoGlobalPct, costoEnvioUsd: 0 },
          items,
        }),
        timeout,
      ])
      showToast('Borrador guardado exitosamente', 'success')
      onGuardado?.()
    } catch (e) {
      setError(e.message ?? 'Error al guardar')
    } finally { setGuardando(false) }
  }

  async function handleEnviar() {
    if (!clienteId) { setError('Selecciona un cliente'); return }
    if (items.length === 0) { setError('Agrega al menos un producto'); return }
    if (tasa <= 0) { setError('No se pudo obtener la tasa de cambio'); return }
    setError('')
    setEnviando(true)
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.')), 30000))
      const id = await Promise.race([
        guardarBorrador.mutateAsync({
          cotizacionId: null,
          campos: { clienteId, descuentoGlobalPct, costoEnvioUsd: 0 },
          items,
        }),
        timeout,
      ])
      await Promise.race([
        enviarCotizacion.mutateAsync({ cotizacionId: id, tasaBcv: tasa }),
        timeout,
      ])
      showToast('Cotización enviada exitosamente', 'success')


      onGuardado?.()
    } catch (e) {
      setError(e.message ?? 'Error al enviar')
    } finally { setEnviando(false) }
  }

  const fmtRate = n => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  /* ──────────────────────────────────────────────────────────────────────────
   * Componentes de sección reutilizados en ambos layouts
   * ────────────────────────────────────────────────────────────────────────── */

  // ── Sección Cliente ──
  const clienteSection = (
    <div ref={clienteRef} className="relative">
      <div className={`bg-white rounded-2xl border-2 transition-all overflow-hidden ${
        clienteOk ? 'border-emerald-200' : 'border-slate-200'
      }`}>
        <div className="px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shrink-0 ${
            clienteOk ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'
          }`}>
            {clienteOk ? <CheckCircle size={11} /> : <span className="text-[10px] sm:text-xs font-black">1</span>}
          </div>
          <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</span>
        </div>

        <div className="p-2.5 sm:p-3">
          {clienteSeleccionado ? (
            <>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))' }}>
                <User size={14} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-bold truncate" style={{ color: clienteSeleccionado.vendedor?.color || '#1e293b' }}>{clienteSeleccionado.nombre}</p>
                <p className="text-[10px] sm:text-xs text-slate-400 truncate">
                  {[clienteSeleccionado.rif_cedula, clienteSeleccionado.telefono].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button onClick={() => setClienteId('')}
                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors">
                <X size={14} />
              </button>
            </div>
            {/* Alerta: cliente de otro vendedor */}
            {!esSupervisor && clienteSeleccionado.vendedor_id && clienteSeleccionado.vendedor_id !== perfil?.id && (
              <div className="flex items-center gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="text-amber-500 shrink-0" />
                <p className="text-[10px] sm:text-xs text-amber-700">
                  Cliente asignado a <strong>{clienteSeleccionado.vendedor?.nombre || 'otro vendedor'}</strong>. Se notificará al supervisor.
                </p>
              </div>
            )}
            </>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={clienteBusqueda}
                  onChange={e => { setClienteBusqueda(e.target.value); setClienteOpen(true); setShowNuevoCliente(false) }}
                  onFocus={() => { if (clienteBusqueda.trim()) setClienteOpen(true) }}
                  placeholder="Nombre, RIF o teléfono..."
                  className="w-full pl-9 pr-3 py-2 sm:py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
                  autoFocus
                />
              </div>
              <button type="button"
                onClick={() => { setShowNuevoCliente(true); setClienteOpen(false) }}
                className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95"
                title="Crear nuevo cliente">
                <UserPlus size={15} className="text-emerald-600" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Dropdown clientes */}
      {clienteOpen && clienteBusqueda.trim() && !showNuevoCliente && (
        <div className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
            {clientesFiltrados.map(c => (
              <button key={c.id} type="button"
                onClick={() => elegirCliente(c)}
                className="w-full flex items-center gap-2.5 sm:gap-3 px-3 py-2 text-left hover:bg-slate-50 rounded-xl transition-all group">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <User size={13} className="text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors" style={{ color: c.vendedor?.color || '#334155' }}>{c.nombre}</p>
                    {!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id && c.vendedor && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 shrink-0 whitespace-nowrap">
                        {c.vendedor.nombre}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-slate-400 font-mono">{[c.rif_cedula, c.ciudad].filter(Boolean).join(' · ')}</p>
                </div>
              </button>
            ))}
            <button type="button"
              onClick={() => { setShowNuevoCliente(true); setClienteOpen(false) }}
              className="w-full flex items-center gap-2.5 sm:gap-3 px-3 py-2.5 text-left hover:bg-emerald-50/50 text-emerald-700 bg-emerald-50/20 rounded-xl transition-colors border border-emerald-100/50 mt-1">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <UserPlus size={13} className="text-emerald-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold text-emerald-600">Crear nuevo cliente</p>
                <p className="text-[10px] text-slate-400/80">
                  {clienteBusqueda.trim() ? `"${clienteBusqueda.trim()}" no encontrado` : 'Agregar un cliente nuevo'}
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Formulario inline de nuevo cliente */}
      {showNuevoCliente && (
        <div className="mt-2 bg-white rounded-2xl border-2 border-emerald-200 shadow-lg p-3 sm:p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center">
              <UserPlus size={14} className="text-emerald-500" />
            </div>
            <span className="text-sm font-bold text-slate-700">Nuevo cliente</span>
          </div>
          <ClienteForm
            compact
            onSuccess={(nuevoCliente) => {
              setClienteId(nuevoCliente.id)
              setShowNuevoCliente(false)
              setClienteBusqueda('')
              productoInputRef.current?.focus()
              showToast('Cliente creado y seleccionado', 'success')
            }}
            onCancel={() => setShowNuevoCliente(false)}
          />
        </div>
      )}
    </div>
  )

  // ── Sección Catálogo de Productos ──
  const catalogSection = (
    <div className={`bg-white rounded-2xl border-2 transition-all ${
      productosOk ? 'border-emerald-200' : 'border-slate-200'
    }`}>
      <div className="px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <div className="flex items-center gap-2">
          <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shrink-0 ${
            productosOk ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'
          }`}>
            {productosOk ? <CheckCircle size={11} /> : <span className="text-[10px] sm:text-xs font-black">2</span>}
          </div>
          <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Productos</span>
        </div>
        <span className="text-[10px] sm:text-[11px] font-bold text-slate-400">{productosFiltrados.length} disponibles</span>
      </div>

      <div className="p-2.5 sm:p-3 space-y-2.5 sm:space-y-3">
        {/* Búsqueda */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            ref={productoInputRef}
            type="text"
            value={productoBusqueda}
            onChange={e => setProductoBusqueda(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full pl-9 pr-9 py-2 sm:py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
          />
          {productoBusqueda && (
            <button type="button" onClick={() => setProductoBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Categorías — scroll horizontal */}
        {categorias.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 -mx-1 px-1">
            <button type="button" onClick={() => setCatActiva('')}
              className={`px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold transition-all whitespace-nowrap shrink-0 ${
                !catActiva ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}>
              Todos
            </button>
            {categorias.map(cat => (
              <button key={cat.value} type="button" onClick={() => setCatActiva(catActiva === cat.value ? '' : cat.value)}
                className={`px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold transition-all whitespace-nowrap shrink-0 ${
                  catActiva === cat.value ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}>
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {/* Recientes */}
        {!productoBusqueda && !catActiva && recientes.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Recientes</span>
            <div className="flex flex-wrap gap-1 sm:gap-1.5">
              {recientes.map(p => {
                const yaAgregado = idsAgregados.has(p.id)
                const sinStock = p.stock_actual != null && p.stock_actual <= 0
                return (
                  <button key={p.id} type="button"
                    onClick={() => !sinStock && agregarProducto(p)}
                    disabled={sinStock}
                    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-semibold transition-all active:scale-95 ${
                      sinStock ? 'bg-slate-50 text-slate-300 cursor-not-allowed' :
                      yaAgregado ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                      'bg-white border border-slate-200 text-slate-600 hover:border-primary/40 hover:text-primary shadow-sm'
                    }`}>
                    {yaAgregado ? <CheckCircle size={9} /> : <Plus size={9} />}
                    <span className="max-w-[80px] sm:max-w-[100px] truncate">{p.nombre}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Grid de productos */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-1.5 sm:gap-2 max-h-[50vh] sm:max-h-[400px] overflow-y-auto pr-0.5">
          {productosFiltrados.slice(0, 40).map(p => {
            const yaAgregado = idsAgregados.has(p.id)
            const sinStock = p.stock_actual != null && p.stock_actual <= 0
            const sinPrecio = !p.precio_usd || Number(p.precio_usd) <= 0
            const bloqueado = sinStock || sinPrecio
            const justAdded = lastAdded === p.id
            return (
              <button key={p.id} type="button"
                onClick={() => !bloqueado && agregarProducto(p)}
                disabled={bloqueado}
                className={`relative bg-white rounded-xl border p-1.5 sm:p-2 flex flex-col items-center text-center transition-all active:scale-95 min-h-[88px] sm:min-h-0 ${
                  justAdded ? 'ring-2 ring-emerald-400 scale-[1.02]' :
                  bloqueado ? 'opacity-35 cursor-not-allowed border-slate-100' :
                  yaAgregado ? 'border-emerald-300 bg-emerald-50/30' :
                  'border-slate-200 hover:border-primary/40 hover:shadow-sm'
                }`}>
                <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center mb-0.5 sm:mb-1 ${
                  yaAgregado ? 'bg-emerald-50' : 'bg-slate-50'
                }`}>
                  {p.imagen_url
                    ? <img src={p.imagen_url} alt="" className="h-full w-full object-contain" loading="lazy" onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-slate-300"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' }} />
                    : yaAgregado ? <CheckCircle size={14} className="text-emerald-400" /> : <Package size={14} className="text-slate-300" />
                  }
                </div>
                <p className={`text-[9px] sm:text-[11px] font-bold leading-tight mb-0.5 ${
                  yaAgregado ? 'text-emerald-700' : 'text-slate-700'
                }`}>{p.nombre}</p>
                <p className={`text-[10px] sm:text-[11px] font-black ${yaAgregado ? 'text-emerald-600' : 'text-slate-800'}`}>
                  {fmtUsd(aplicarMarkup(p.precio_usd))}
                </p>
                <p className={`text-[8px] sm:text-[9px] font-medium mt-0.5 ${
                  sinStock ? 'text-red-500' :
                  (p.stock_actual <= (p.stock_minimo || 5)) ? 'text-amber-500' : 'text-slate-400'
                }`}>
                  {sinStock ? 'Agotado' : `${p.stock_actual} disp.`}
                </p>
                {yaAgregado && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-emerald-500 rounded-full flex items-center justify-center shadow-sm">
                    <span className="text-[8px] sm:text-[9px] font-black text-white">
                      {items.find(it => it.productoId === p.id)?.cantidad}
                    </span>
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {productosFiltrados.length === 0 && (
          <div className="text-center py-6 sm:py-8">
            <Search size={22} className="mx-auto text-slate-200 mb-2" />
            <p className="text-sm font-bold text-slate-400">Sin resultados</p>
          </div>
        )}
      </div>
    </div>
  )

  // ── Carrito items (shared entre desktop y mobile sheet) ──
  const cartItems = (
    <>
      {items.length === 0 ? (
        <div className="p-6 sm:p-8 text-center">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full mx-auto mb-2 sm:mb-3 flex items-center justify-center"
            style={{ background: 'rgba(27,54,93,0.05)', border: '1.5px dashed rgba(27,54,93,0.15)' }}>
            <ShoppingCart size={20} className="text-slate-300" />
          </div>
          <p className="text-sm font-bold text-slate-400">Carrito vacío</p>
          <p className="text-xs text-slate-300 mt-1">Selecciona productos del catálogo</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50 max-h-[40vh] lg:max-h-[280px] overflow-y-auto">
          {items.map((it, idx) => {
            const linea = mulR(it.cantidad, it.precioUnitUsd)
            return (
              <div key={it._key} className="px-2.5 sm:px-3 py-2 sm:py-2.5 group hover:bg-slate-50/50 transition-colors">
                {/* Fila 1: nombre completo + precio línea */}
                <div className="flex items-start gap-1.5 mb-1">
                  <p className="flex-1 text-[10px] sm:text-[11px] font-bold text-slate-700 leading-snug">{it.nombreSnap}</p>
                  <span className="text-[11px] sm:text-xs font-bold text-slate-800 shrink-0">{fmtUsd(linea)}</span>
                </div>
                {/* Fila 2: precio unitario + controles cantidad */}
                <div className="flex items-center gap-2">
                  <span className="text-[9px] sm:text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1 rounded">{fmtUsd(it.precioUnitUsd)}</span>
                  <span className="text-[8px] text-slate-400">{it.unidadSnap || 'und'}</span>
                  <div className="flex items-center bg-slate-50 rounded-lg border border-slate-100 overflow-hidden ml-auto">
                    <button type="button"
                      onClick={() => it.cantidad <= 1 ? eliminarItem(idx) : cambiarItem(idx, 'cantidad', it.cantidad - 1)}
                      className="w-9 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors active:scale-90">
                      <Minus size={13} strokeWidth={3} />
                    </button>
                    <span className="w-7 text-center text-[11px] font-black text-slate-700 border-x border-slate-100 py-0.5">{it.cantidad}</span>
                    <button type="button"
                      onClick={() => {
                        const max = stockDisponible(it.productoId)
                        if (it.cantidad >= max) { showToast(`Stock máximo: ${max}`, 'error'); return }
                        cambiarItem(idx, 'cantidad', it.cantidad + 1)
                      }}
                      className={`w-9 h-8 flex items-center justify-center transition-colors active:scale-90 ${
                        it.cantidad >= stockDisponible(it.productoId)
                          ? 'text-slate-200 cursor-not-allowed'
                          : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50'
                      }`}>
                      <Plus size={13} strokeWidth={3} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  // ── Totales panel ──
  const totalsPanel = (
    <div className="space-y-2 sm:space-y-2.5">
      <div className="border-t border-slate-100 pt-2 sm:pt-2.5 space-y-1 sm:space-y-1.5">
        {items.length > 0 && (
          <div className="flex justify-between text-[11px] sm:text-xs">
            <span className="text-slate-400">Subtotal ({items.length} prod.)</span>
            <span className="font-semibold text-slate-600">{fmtUsd(subtotal)}</span>
          </div>
        )}

        <div className="flex justify-between items-end pt-1.5 sm:pt-2 border-t border-slate-100">
          <div>
            <span className="text-[10px] sm:text-xs font-black text-slate-500 uppercase tracking-wide">Total</span>
            {tasa > 0 && totalUsd > 0 && (
              <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 font-mono">{fmtBs(totalBs)}</p>
            )}
          </div>
          <span className="text-xl sm:text-2xl font-black text-slate-900">{fmtUsd(totalUsd)}</span>
        </div>

        {tasa > 0 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[9px] sm:text-[10px] text-slate-400 flex items-center gap-1">
              <DollarSign size={8} /> BCV: {fmtRate(tasaHook.tasaBcv?.precio || 0)} Bs/$
              {tasaHook.tasaUsdt?.precio > 0 && (
                <> · <span className="text-indigo-500">USDT: {fmtRate(tasaHook.tasaUsdt.precio)}</span></>
              )}
            </span>
            <button type="button" onClick={tasaHook.refrescar}
              className="p-1 text-slate-300 hover:text-primary transition-colors">
              <RefreshCw size={10} className={tasaHook.cargando ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {!esSupervisor && totalUsd > 0 && config.comision_pct > 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-slate-50">
            <span className="text-[9px] sm:text-[10px] text-emerald-600 font-semibold">Comisión est.</span>
            <span className="text-[9px] sm:text-[10px] font-bold text-emerald-600">~{fmtUsd(round2(totalUsd * (config.comision_pct / 100)))}</span>
          </div>
        )}
      </div>
    </div>
  )

  // ── Botones de acción ──
  const actionButtons = (
    <div className="space-y-2">
      <button onClick={handleEnviar} disabled={cargando || !clienteOk || !productosOk}
        className="w-full flex items-center justify-center gap-2 py-3 sm:py-3.5 text-white font-bold text-sm rounded-xl transition-all disabled:opacity-40 active:scale-[0.98] shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
        {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        Enviar cotización
      </button>
      <button onClick={handleGuardar} disabled={cargando || !clienteOk || !productosOk}
        className="w-full flex items-center justify-center gap-2 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-all disabled:opacity-40 active:scale-95">
        {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        Guardar borrador
      </button>
    </div>
  )

  /* ──────────────────────────────────────────────────────────────────────────
   * Render principal
   * ────────────────────────────────────────────────────────────────────────── */
  return (
    <div className="p-2.5 sm:p-4 md:p-6 max-w-7xl mx-auto pb-36 lg:pb-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={onVolver}
            className="p-1.5 sm:p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors active:scale-90">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shadow-md"
              style={{ background: 'linear-gradient(135deg, #B8860B, #d4a017)' }}>
              <Zap size={15} className="text-white sm:hidden" />
              <Zap size={18} className="text-white hidden sm:block" />
            </div>
            <div>
              <h1 className="text-sm sm:text-lg font-black text-slate-800 leading-tight">Cotización Rápida</h1>
              <p className="text-[10px] sm:text-[11px] text-slate-400 hidden sm:block">Crea y envía en segundos</p>
            </div>
          </div>
        </div>

        {/* Progress pills — solo desktop */}
        <div className="hidden sm:flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
            clienteOk ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-400 border border-slate-200'
          }`}>
            {clienteOk ? <CheckCircle size={12} /> : <User size={12} />}
            Cliente
          </div>
          <ChevronRight size={12} className="text-slate-300" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
            productosOk ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-400 border border-slate-200'
          }`}>
            {productosOk ? <CheckCircle size={12} /> : <Package size={12} />}
            {items.length > 0 ? `${items.length} producto${items.length > 1 ? 's' : ''}` : 'Productos'}
          </div>
        </div>
      </div>

      {/* ── Error (visible en ambos) ── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl mb-3">
          <AlertCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-xs text-red-600 font-medium flex-1">{error}</p>
          <button type="button" onClick={handleGuardar} className="shrink-0 text-xs font-bold text-red-600 hover:text-red-800 px-2 py-1 rounded-lg hover:bg-red-100 transition-colors">
            Reintentar
          </button>
          <button type="button" onClick={() => setError('')} className="shrink-0 text-red-300 hover:text-red-500">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Layout: 2 columnas en desktop, stacked en móvil ── */}
      <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 lg:gap-5 items-start">

        {/* ══ Columna izquierda: Cliente + Catálogo ══ */}
        <div className="w-full lg:flex-1 lg:min-w-0 space-y-3 sm:space-y-4">
          {clienteSection}
          {catalogSection}
        </div>

        {/* ══ Columna derecha: Carrito + Totales — SOLO DESKTOP ══ */}
        <div className="hidden lg:block w-80 xl:w-96 shrink-0 lg:sticky lg:top-[73px] space-y-3">
          {/* Carrito */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-4 py-3 flex items-center justify-between"
              style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.04), rgba(184,134,11,0.04))', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div className="flex items-center gap-2">
                <ShoppingCart size={14} className="text-primary" />
                <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Carrito</span>
              </div>
              {items.length > 0 && (
                <span className="text-[11px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {totalItems} {totalItems === 1 ? 'item' : 'items'}
                </span>
              )}
            </div>
            {cartItems}
          </div>

          {/* Totales */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            {totalsPanel}
          </div>

          {/* Botones */}
          {actionButtons}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
       * MÓVIL: Barra flotante inferior con resumen del carrito
       * ══════════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[100]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>

        {/* Barra resumen — siempre visible */}
        <div className="bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          {/* Fila superior: botón carrito + total + enviar */}
          <div className="px-3 py-2.5 flex items-center gap-2">
            {/* Botón carrito */}
            <button type="button"
              onClick={() => setMobileCartOpen(true)}
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors active:scale-95 shrink-0">
              <ShoppingCart size={16} className="text-slate-600" />
              {totalItems > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-emerald-500 rounded-full flex items-center justify-center">
                  <span className="text-[9px] font-black text-white px-1">{totalItems}</span>
                </span>
              )}
              <ChevronUp size={12} className="text-slate-400" />
            </button>

            {/* Total */}
            <div className="flex-1 min-w-0 text-right">
              <p className="text-lg font-black text-slate-900 leading-none">{fmtUsd(totalUsd)}</p>
              {tasa > 0 && totalUsd > 0 && (
                <p className="text-[10px] text-slate-400 font-mono">{fmtBs(totalBs)}</p>
              )}
            </div>

            {/* Botón enviar */}
            <button onClick={handleEnviar} disabled={cargando || !clienteOk || !productosOk}
              className="flex items-center gap-1.5 px-4 py-2.5 text-white font-bold text-sm rounded-xl transition-all disabled:opacity-40 active:scale-[0.98] shadow-md shrink-0"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span>Enviar</span>
            </button>
          </div>

          {/* Progreso mini — visible cuando falta algo */}
          {(!clienteOk || !productosOk) && (
            <div className="px-3 pb-2 flex items-center gap-2">
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${
                clienteOk ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500 border border-amber-200'
              }`}>
                {clienteOk ? <CheckCircle size={9} /> : <User size={9} />}
                Cliente
              </div>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${
                productosOk ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500 border border-amber-200'
              }`}>
                {productosOk ? <CheckCircle size={9} /> : <Package size={9} />}
                Productos
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
       * MÓVIL: Bottom sheet del carrito
       * ══════════════════════════════════════════════════════════════════════ */}
      {mobileCartOpen && (
        <>
          {/* Backdrop */}
          <div className="lg:hidden fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setMobileCartOpen(false)} />

          {/* Sheet */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[201] rounded-t-3xl bg-white animate-in slide-in-from-bottom duration-300"
            style={{
              maxHeight: '85vh',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            }}>
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="px-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-primary" />
                <span className="text-sm font-black text-slate-700">Carrito</span>
                {totalItems > 0 && (
                  <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {totalItems} {totalItems === 1 ? 'item' : 'items'}
                  </span>
                )}
              </div>
              <button onClick={() => setMobileCartOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Contenido scrollable */}
            <div className="overflow-y-auto px-4" style={{ maxHeight: 'calc(85vh - 200px)' }}>
              {/* Items del carrito */}
              <div className="bg-slate-50 rounded-xl overflow-hidden mb-3">
                {cartItems}
              </div>

              {/* Totales */}
              <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
                {totalsPanel}
              </div>
            </div>

            {/* Botones de acción fijos abajo del sheet */}
            <div className="px-4 pt-2 border-t border-slate-100">
              {actionButtons}
            </div>
          </div>
        </>
      )}

      {/* Modal confirmación cliente de otro vendedor */}
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
            <div className="flex gap-2">
              <button onClick={() => setConfirmAjeno(null)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                Cancelar
              </button>
              <button onClick={() => {
                setClienteId(confirmAjeno.id)
                setClienteBusqueda('')
                setClienteOpen(false)
                setConfirmAjeno(null)
                productoInputRef.current?.focus()
              }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors">
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
