// src/views/VentaRapidaView.jsx
// Venta rápida — wizard de 3 pasos: cliente+productos, pago, confirmar
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, User, X, Plus, Minus, Package, ArrowLeft, ArrowRight, Loader2,
  Search, CheckCircle, ShoppingCart, DollarSign, Truck, CreditCard,
  AlertCircle, ChevronRight, ChevronLeft, UserPlus, ChevronUp, Hash, FileText, Trash2, Save,
  Download, Printer, MessageCircle, Clock, Check, Edit2, Handshake, Undo2
} from 'lucide-react'
import { compartirPorWhatsApp, generarMensaje } from '../utils/whatsapp'
import { useClientes } from '../hooks/useClientes'
import ClienteForm from '../components/clientes/ClienteForm'
import { useInventario, useCategorias } from '../hooks/useInventario'
import { useProductSearch } from '../hooks/useProductSearch'
import { useLineItems } from '../hooks/useLineItems'
import { useVentaRapida } from '../hooks/useVentaRapida'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { calcComisionEstimada } from '../utils/comisionUtils'
import { useTransportistas, useCrearTransportista } from '../hooks/useTransportistas'
import { useFormasPago } from '../hooks/useFormasPago'
import { useSaldoFavorOrigen } from '../hooks/useCuentasCobrar'
import CustomSelect from '../components/ui/CustomSelect'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'
import { ESTADOS, getCiudades } from '../data/venezuelaGeo'
import { MapPin, Building } from 'lucide-react'
import { apiUrl } from '../services/apiBase'
import { round2, mulR } from '../utils/dinero'
import { calcTotales } from '../utils/calcTotales'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs, removeAccents } from '../utils/format'
import { guardarProductoReciente, getProductosRecientes } from '../components/cotizaciones/ProductosRecientes'
import { showToast } from '../components/ui/Toast'
import PageHeader from '../components/ui/PageHeader'
import ProductCard from '../components/shared/ProductCard'
import CategoryPills from '../components/shared/CategoryPills'
import { usePrecioVendedor } from '../hooks/usePrecioVendedor'

import { FORMAS_PAGO } from '../constants/formasPago'
import { PREFIJOS_RIF, parsearRif as parsearRifVR, formatearRif as formatearRifVR } from '../utils/rif'


// ─── Modal de venta exitosa ─────────────────────────────────────────────────
function ModalVentaExitosa({ data, onClose, config }) {
  const [pdfLoading, setPdfLoading] = useState(false)
  const [printLoading, setPrintLoading] = useState(false)
  const [showPdfMenu, setShowPdfMenu] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [monedaPdf, setMonedaPdf] = useState(() => localStorage.getItem('listopos_moneda_pdf') || '$')

  const MONEDA_OPTIONS = [
    { key: '$', icon: <DollarSign size={12} className="text-emerald-500" />, label: 'USDT ($)' },
    { key: 'bcv', icon: <span className="text-[10px] font-bold text-teal-500 w-[12px] text-center">$</span>, label: 'Dólar BCV' },
    { key: 'bs', icon: <span className="text-[10px] font-bold text-blue-500 w-[12px] text-center">Bs</span>, label: 'Bolívares' },
  ]

  function MonedaSelector() {
    return (
      <div className="border-b border-slate-100 pb-1 mb-1">
        {MONEDA_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => { setMonedaPdf(opt.key); localStorage.setItem('listopos_moneda_pdf', opt.key) }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-left whitespace-nowrap ${monedaPdf === opt.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
            {opt.icon} {opt.label}
            {monedaPdf === opt.key && <Check size={12} className="ml-auto text-emerald-500" />}
          </button>
        ))}
      </div>
    )
  }

  if (!data) return null

  const { numero, despachoId, cotizacionId, clienteNombre, items, subtotal, totalUsd, totalBs, tasa, formasPago, transportista, flete, corte, notas } = data
  const numDisplay = `VR-${String(numero).padStart(5, '0')}`
  const totalConFlete = (totalUsd || 0) + (Number(flete) || 0) + (Number(corte) || 0)

  function printOrDownloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob)
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) {
      const w = window.open(url, '_blank')
      if (!w) { const a = document.createElement('a'); a.href = url; a.download = filename; a.click() }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } else {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none'
      iframe.src = url
      document.body.appendChild(iframe)
      iframe.onload = () => {
        try { iframe.contentWindow.print() } catch { window.open(url) }
        setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url) }, 60000)
      }
    }
  }

  async function fetchDespachoData(pdfType) {
    const session = (await supabase.auth.getSession()).data.session
    const importFn = pdfType === 'orden'
      ? import('../services/pdf/ordenDespachoPDF')
      : import('../services/pdf/despachoPDF')
    const [pdfModule, itemsRes, clienteData, vendedorRes, transportistaRes] = await Promise.all([
      importFn,
      supabase.from('notas_despacho_items').select('codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden').eq('despacho_id', despachoId).order('orden'),
      fetch(apiUrl('/api/clientes/lookup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ ids: [data.clienteId].filter(Boolean) }),
      }).then(r => r.ok ? r.json() : []),
      supabase.from('usuarios').select('id, nombre, color, telefono').eq('id', data.vendedorId).single(),
      data.transportistaId ? supabase.from('transportistas').select('id, nombre, rif, telefono, vehiculo, placa_chuto, placa_batea, color, color_batea, zona_cobertura, capacidad').eq('id', data.transportistaId).single() : Promise.resolve({ data: null }),
    ])
    if (itemsRes.error) throw itemsRes.error
    const despachoObj = {
      id: despachoId, numero, cotizacion_id: cotizacionId,
      cliente_id: data.clienteId, vendedor_id: data.vendedorId, transportista_id: data.transportistaId,
      forma_pago: JSON.stringify(formasPago), total_usd: totalConFlete, tasa_bcv_snapshot: tasa,
      estado: 'pendiente', costo_envio_usd: 0, flete_usd: flete,
      creado_en: new Date().toISOString(),
      notas: notas || null,
      cliente: clienteData?.[0] || null,
      vendedor: vendedorRes.data || null,
      transportista: transportistaRes.data || null,
    }
    const generarFn = pdfType === 'orden' ? pdfModule.generarOrdenDespachoPDF : pdfModule.generarDespachoPDF
    return { generarFn, despachoObj, items: itemsRes.data ?? [] }
  }

  async function handleDescargar(tipo) {
    setShowPdfMenu(false)
    setPdfLoading(true)
    try {
      const { generarFn, despachoObj, items: pdfItems } = await fetchDespachoData(tipo)
      await generarFn({ despacho: despachoObj, items: pdfItems, config, formaPago: despachoObj.forma_pago || '', monedaPDF: monedaPdf, tasa: data.tasa, tasaUsdt: data.tasaUsdt || 0, tasaBcv: data.tasaBcv || 0 })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error'), 'error')
    } finally { setPdfLoading(false) }
  }

  async function handleCompartir(tipo) {
    setShowPdfMenu(false)
    setPdfLoading(true)
    try {
      const { generarFn, despachoObj, items: pdfItems } = await fetchDespachoData(tipo)
      const { blob, filename } = await generarFn({ despacho: despachoObj, items: pdfItems, config, formaPago: despachoObj.forma_pago || '', monedaPDF: monedaPdf, tasa: data.tasa, tasaUsdt: data.tasaUsdt || 0, tasaBcv: data.tasaBcv || 0, returnBlob: true })
      
      const msg = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: data.clienteNombre,
        numDisplay,
        totalUsd: totalConFlete,
        nombreVendedor: despachoObj.vendedor?.nombre,
        tipo: tipo === 'orden' ? 'Orden de Despacho' : 'Nota de Entrega'
      })

      await compartirPorWhatsApp({
        pdfBlob: blob,
        pdfFilename: filename,
        telefono: despachoObj.cliente?.telefono,
        mensaje: msg,
        mensajeParams: {
          nombreNegocio: config.nombre_negocio,
          nombreCliente: data.clienteNombre,
          numDisplay,
          totalUsd: totalConFlete,
          nombreVendedor: despachoObj.vendedor?.nombre,
          tipo: tipo === 'orden' ? 'Orden de Despacho' : 'Nota de Entrega'
        }
      })
    } catch (err) {
      showToast('Error al compartir: ' + (err.message || 'Error'), 'error')
    } finally { setPdfLoading(false) }
  }

  async function handleImprimir(tipo) {
    setShowPrintMenu(false)
    setPrintLoading(true)
    try {
      const { generarFn, despachoObj, items: pdfItems } = await fetchDespachoData(tipo)
      const { blob, filename } = await generarFn({ despacho: despachoObj, items: pdfItems, config, formaPago: despachoObj.forma_pago || '', monedaPDF: monedaPdf, tasa: data.tasa, tasaUsdt: data.tasaUsdt || 0, tasaBcv: data.tasaBcv || 0, returnBlob: true })
      printOrDownloadPdf(blob, filename)
    } catch (err) {
      showToast('Error al imprimir: ' + (err.message || 'Error'), 'error')
    } finally { setPrintLoading(false) }
  }

  let formasPagoTexto = ''
  try {
    const fp = typeof formasPago === 'string' ? JSON.parse(formasPago) : formasPago
    formasPagoTexto = Array.isArray(fp) ? fp.map(f => f.metodo).join(', ') : ''
  } catch { formasPagoTexto = '' }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm md:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header gradient (estilo cotización) */}
        <div className="relative h-20 flex flex-col items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #1B365D 0%, #2d5a8e 50%, #B8860B 100%)' }}>
          <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
          <div className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center bg-white/20 backdrop-blur-sm border-2 border-white/40 shadow-lg">
            <CheckCircle size={20} color="white" strokeWidth={2.5} />
          </div>
          <p className="relative z-10 text-white/80 text-[10px] font-medium mt-1 tracking-wide uppercase">Venta rápida exitosa</p>
        </div>

        <div className="p-4 space-y-3 text-center">
          {/* Número */}
          <div>
            <h3 className="text-sm font-bold text-slate-800">Despacho creado</h3>
            <p className="font-black text-xl font-mono mt-0.5 tracking-tight" style={{ color: '#1B365D' }}>{numDisplay}</p>
          </div>

          {/* Resumen compacto */}
          <div className="bg-slate-50 rounded-xl p-3 divide-y divide-slate-100 text-left">
            <div className="flex justify-between py-1.5 first:pt-0">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Cliente</span>
              <span className="font-semibold text-xs text-right max-w-[200px] truncate text-slate-800">{clienteNombre || '—'}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Items</span>
              <span className="font-medium text-slate-700 text-xs">{items.length} producto{items.length !== 1 ? 's' : ''}</span>
            </div>
            {flete > 0 && (
              <div className="flex justify-between py-1.5">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Flete</span>
                <span className="font-medium text-slate-600 text-xs">{fmtUsd(flete)}</span>
              </div>
            )}
            {corte > 0 && (
              <div className="flex justify-between py-1.5">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Corte</span>
                <span className="font-medium text-slate-600 text-xs">{fmtUsd(corte)}</span>
              </div>
            )}
            <div className="flex justify-between py-1.5">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Total</span>
              <div className="text-right">
                <span className="font-bold text-slate-900 text-sm">{fmtUsd(totalConFlete || totalUsd)}</span>
                {totalBs > 0 && (
                  <p className="text-[10px] text-slate-400 font-mono">{fmtBs(totalBs)}</p>
                )}
              </div>
            </div>
            {formasPagoTexto && (
              <div className="flex justify-between py-1.5">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Pago</span>
                <span className="font-medium text-slate-700 text-xs">{formasPagoTexto}</span>
              </div>
            )}
            {transportista && (
              <div className="flex justify-between py-1.5 last:pb-0">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Transporte</span>
                <span className="font-medium text-slate-700 text-xs">{transportista}</span>
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="space-y-2">
            <div className="flex gap-2">
              {/* Descargar con opciones */}
              <div className="flex-1 relative">
                <button onClick={() => { setShowPdfMenu(v => !v); setShowPrintMenu(false) }} disabled={pdfLoading}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl transition-all active:scale-[0.98] disabled:opacity-50">
                  {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Descargar
                </button>
                {showPdfMenu && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 overflow-hidden">
                    <MonedaSelector />
                    <button onClick={() => handleDescargar('nota')} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700 flex items-center justify-between">
                      <span><FileText size={12} className="inline mr-1.5 text-slate-400" />Nota de Entrega</span>
                      <span className={`text-[9px] font-bold px-1 rounded ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50' : 'text-emerald-600 bg-emerald-50'}`}>
                        {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                      </span>
                    </button>
                    <button onClick={() => handleDescargar('orden')} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700 flex items-center justify-between border-b border-slate-100">
                      <span><Package size={12} className="inline mr-1.5 text-slate-400" />Orden de Despacho</span>
                      <span className={`text-[9px] font-bold px-1 rounded ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50' : 'text-emerald-600 bg-emerald-50'}`}>
                        {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Imprimir con opciones */}
              <div className="flex-1 relative">
                <button onClick={() => { setShowPrintMenu(v => !v); setShowPdfMenu(false) }} disabled={printLoading}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs rounded-xl transition-all active:scale-[0.98] disabled:opacity-50">
                  {printLoading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                  Imprimir
                </button>
                {showPrintMenu && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
                    <MonedaSelector />
                    <button onClick={() => handleImprimir('nota')} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700 flex items-center justify-between">
                      <span><FileText size={12} className="inline mr-1.5 text-slate-400" />Nota de entrega</span>
                      <span className={`text-[9px] font-bold px-1 rounded ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50' : 'text-emerald-600 bg-emerald-50'}`}>
                        {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                      </span>
                    </button>
                    <button onClick={() => handleImprimir('orden')} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700 flex items-center justify-between border-t border-slate-100">
                      <span><Package size={12} className="inline mr-1.5 text-slate-400" />Orden de despacho</span>
                      <span className={`text-[9px] font-bold px-1 rounded ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50' : 'text-emerald-600 bg-emerald-50'}`}>
                        {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button onClick={onClose}
              className="w-full py-3 text-white font-bold text-xs rounded-xl transition-all shadow-lg hover:shadow-xl active:scale-[0.98] flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <ArrowRight size={14} /> Ir a Despachos
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Draft (retomar) helpers ──────────────────────────────────────────────────
const VR_DRAFT_KEY = 'listopos_venta_rapida_draft'

function getDraftKey(userId) {
  const state = useAuthStore.getState()
  const businessId = state.perfil?.cuenta_id
  const suffix = businessId ? `-${businessId}` : ''
  if (!userId) return `${VR_DRAFT_KEY}${suffix}`
  return `${VR_DRAFT_KEY}_${userId}${suffix}`
}

function saveDraft(state, userId) {
  try {
    const clienteNombre = state._clienteNombre || ''
    const totalUsd = state._totalUsd ?? 0
    const itemsCount = state._itemsCount ?? state.items?.length ?? 0
    localStorage.setItem(getDraftKey(userId), JSON.stringify({
      ...state,
      _ts: Date.now(),
      _userId: userId,
      _clienteNombre: clienteNombre,
      _totalUsd: totalUsd,
      _itemsCount: itemsCount,
    }))
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

function formatRelativeTime(ts) {
  if (!ts) return ''
  const diffMs = Date.now() - ts
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'hace un instante'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH}h`
  return 'hace más de 1 día'
}

export default function VentaRapidaView() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const { aplicarMarkup, esExterno } = usePrecioVendedor()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const navigate = useNavigate()
  const { data: clientes = [] } = useClientes()
  const { data: inventarioData } = useInventario({ pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const { data: categorias = [] } = useCategorias()
  const { data: config = {} } = useConfigNegocio()
  const { data: transportistas = [] } = useTransportistas()
  const tasaHook = useTasaCambio()
  const ventaRapida = useVentaRapida()
  // Step 1: Cliente + Productos
  const [clienteId, setClienteId] = useState('')
  const clienteSeleccionado = clientes.find(c => c.id === clienteId)

  const { data: saldoFavorOrigen } = useSaldoFavorOrigen(clienteId)

  // Wizard step: 0=productos, 1=pago, 2=confirmar
  const [step, setStep] = useState(0)

  const [clienteBusqueda, setClienteBusqueda] = useState('')
  const [clienteOpen, setClienteOpen] = useState(false)
  const [productoBusqueda, setProductoBusqueda] = useState('')
  const [catActiva, setCatActiva] = useState('')
  const { items, setItems, agregarItem: _agregarItem, eliminarPorId: quitarItem, cambiarCantidad, setCantidadDirecta, cambiarPrecio: _cambiarPrecio, togglePrestamo, setStockMap } = useLineItems({ checkStock: true })
  const [editItemIdx, setEditItemIdx] = useState(null)
  const comisionEstimada = useMemo(() => calcComisionEstimada(items, config, perfil), [items, config, perfil])

  const cambiarPrecio = useCallback((productoId, precio) => {
    const precioUnit = parseFloat(String(precio)) || 0
    _cambiarPrecio(productoId, precioUnit, precioUnit)
  }, [_cambiarPrecio])

  const prevClienteIdRef = useRef(clienteId)

  useEffect(() => {
    if (!clientes.length || !config) return

    const prevId = prevClienteIdRef.current
    if (prevId === clienteId) return
    prevClienteIdRef.current = clienteId

    const prevCli = clientes.find(c => c.id === prevId)
    const nextCli = clientes.find(c => c.id === clienteId)
    const prevEsPersonal = prevCli?.tipo_cliente === 'personal'
    const nextEsPersonal = nextCli?.tipo_cliente === 'personal'

    if (prevEsPersonal === nextEsPersonal) return

    showToast(nextEsPersonal ? 'Cliente personal seleccionado: descuento de personal se aplicará en totales' : 'Descuento de personal removido', 'info')
  }, [clienteId, clientes, config])

  // Mantener stock map actualizado para validación de cantidades
  useEffect(() => {
    if (productos.length > 0) {
      const map = {}
      productos.forEach(p => { map[p.id] = Number(p.stock_actual) || 0 })
      setStockMap(map)
    }
  }, [productos, setStockMap])

  // ── Sincronización en tiempo real de precios del carrito ───────────────────
  // Cuando el inventario se actualiza por broadcast (otro usuario cambió un producto),
  // actualizamos el precio de los items del carrito que todavía están al precio base.
  useEffect(() => {
    if (productos.length === 0 || items.length === 0) return
    const prodMap = new Map(productos.map(p => [p.id, p]))
    setItems(prev => {
      let changed = false
      const next = prev.map(it => {
        const prod = prodMap.get(it.productoId)
        if (!prod) return it
        const precioBaseReal = Number(prod.precio_usd) || 0
        const precioBase = aplicarMarkup(precioBaseReal)
        const precio2    = prod.precio_2 != null ? aplicarMarkup(Number(prod.precio_2)) : null
        const precio3    = prod.precio_3 != null ? aplicarMarkup(Number(prod.precio_3)) : null
        // Solo actualizamos si el precio actual coincide con algún nivel de precio del catálogo
        // (el usuario puede haber puesto un precio personalizado que NO tocamos)
        const esPrecioNivel =
          Math.abs(it.precioUnitUsd - precioBase) < 0.001 ||
          (precio2 != null && Math.abs(it.precioUnitUsd - precio2) < 0.001) ||
          (precio3 != null && Math.abs(it.precioUnitUsd - precio3) < 0.001)
        if (!esPrecioNivel) return it  // precio personalizado → no tocar
        // Si el precio base cambió y el item usaba el precio base, actualizarlo
        if (Math.abs(it.precioUnitUsd - precioBase) < 0.001 && precioBase !== it.precioUnitUsd) {
          changed = true
          return { ...it, precioUnitUsd: precioBase, nombreSnap: prod.nombre }
        }
        // Actualizar nombre si cambió (sin cambiar precio)
        if (it.nombreSnap !== prod.nombre) {
          changed = true
          return { ...it, nombreSnap: prod.nombre }
        }
        return it
      })
      return changed ? next : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos])  // solo depende de productos — cuando cambia el inventario

  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [confirmAjeno, setConfirmAjeno] = useState(null)
  const [ventaExitosa, setVentaExitosa] = useState(null)

  // Step 2: Pago + Envío
  const [referenciaPago, setReferenciaPago] = useState('')
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [corteUsd, setCorteUsd] = useState('')
  const [notas, setNotas] = useState('')
  const [esCod, setEsCod] = useState(false)
  const [direccionEnvioActiva, setDireccionEnvioActiva] = useState(false)
  const [direccionEnvioEstado, setDireccionEnvioEstado] = useState('')
  const [direccionEnvioCiudad, setDireccionEnvioCiudad] = useState('')
  const [direccionEnvioDireccion, setDireccionEnvioDireccion] = useState('')
  const [vueltoComoSaldoFavor, setVueltoComoSaldoFavor] = useState(false)

  const clienteRef = useRef(null)
  const productoInputRef = useRef(null)

  // ─── Draft (retomar) ─────────────────────────────────────────────────────────
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [borradorInfo, setBorradorInfo] = useState(null)
  const draftRef = useRef(null)
  const [undoDraft, setUndoDraft] = useState(null)
  const undoTimerRef = useRef(null)

  // Restaurar borrador al montar
  useEffect(() => {
    const draft = loadDraft(perfil?.id)
    if (draft && (draft.items?.length > 0 || draft.clienteId)) {
      draftRef.current = draft
      setBorradorInfo(draft)
      setShowDraftBanner(true)
    }
  }, [])

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current) }
  }, [])

  function restoreDraft() {
    const d = draftRef.current
    if (!d) return
    if (d.clienteId) setClienteId(d.clienteId)
    if (d.items?.length > 0) setItems(d.items)
    if (d.esCod !== undefined) setEsCod(d.esCod)
    if (d.formasPago?.length > 0) {
      const codItem = d.formasPago.find(f => f.metodo === 'Cobro a destino');
      if (codItem) {
        setEsCod(true);
        setPropuestaCod(Array.isArray(codItem.metodo_propuesto) ? codItem.metodo_propuesto : []);
        setPagosInmediatos(d.formasPago.filter(f => f.metodo !== 'Cobro a destino'));
      } else {
        setEsCod(false);
        setPagosInmediatos(d.formasPago);
        setPropuestaCod([]);
      }
    }
    else if (d.formaPago) {
      setPagosInmediatos([{ metodo: d.formaPago, monto: 0 }]);
      setPropuestaCod([]);
    }
    if (d.referenciaPago) setReferenciaPago(d.referenciaPago)
    if (d.transportistaId) setTransportistaId(d.transportistaId)
    if (d.fleteUsd) setFleteUsd(d.fleteUsd)
    if (d.corteUsd) setCorteUsd(d.corteUsd)
    if (d.notas) setNotas(d.notas)
    if (d.step != null && d.step >= 0 && d.step <= 2) setStep(d.step)
    setShowDraftBanner(false)
    setBorradorInfo(null)
    draftRef.current = null
  }

  function discardDraft() {
    // Save draft in memory for undo
    const savedDraft = draftRef.current
    setUndoDraft(savedDraft)
    clearDraft(perfil?.id)
    setShowDraftBanner(false)
    setBorradorInfo(null)
    draftRef.current = null
    // Auto-dismiss undo after 6 seconds
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setUndoDraft(null), 6000)
  }

  function undoDiscard() {
    if (!undoDraft) return
    // Re-save to localStorage and restore banner
    saveDraft(undoDraft, perfil?.id)
    draftRef.current = undoDraft
    setBorradorInfo(undoDraft)
    setShowDraftBanner(true)
    setUndoDraft(null)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }

  const costoEnvioUsd = 0
  const { subtotal, totalUsd: rawTotalUsd } = calcTotales(items, 0, costoEnvioUsd)
  const esPersonal = clienteSeleccionado?.tipo_cliente === 'personal'
  const descPct = config?.descuento_personal_pct ?? 10.00
  const descuentoMonto = esPersonal ? round2(subtotal * (descPct / 100)) : 0
  const totalUsd = esPersonal ? round2(subtotal - descuentoMonto) : rawTotalUsd

  const tasa = tasaHook.tasaEfectiva || 0
  const totalBs = tasa > 0 ? mulR(totalUsd, tasa) : 0
  const flete = Math.max(0, Number(fleteUsd) || 0)
  const corte = Math.max(0, Number(corteUsd) || 0)
  const totalConFlete = round2(totalUsd + flete + corte)
  const totalParaPago = round2(totalUsd + corte)

  const {
    formasPago: pagosInmediatos,
    setFormas: setPagosInmediatos,
    toggleForma: togglePagoInmediato,
    setMontoForma: setMontoPagoInmediato,
    updateForma: updatePagoInmediato,
    resetFormas: resetPagosInmediatos,
    totalAsignado: totalInmediato,
    pagoCuadrado: pagoInmediatoCuadrado,
    hayVuelto: pagosInmediatosHayVuelto,
    diferencia: pagosInmediatosDiferencia,
  } = useFormasPago(totalConFlete)

  // El monto COD requerido es el total restante
  const montoCodRequerido = Math.max(0, round2(totalConFlete - totalInmediato))

  const {
    formasPago: propuestaCod,
    setFormas: setPropuestaCod,
    toggleForma: togglePropuestaCod,
    setMontoForma: setMontoPropuestaCod,
    updateForma: updatePropuestaCod,
    resetFormas: resetPropuestaCod,
    totalAsignado: totalPropuestaCod,
    pagoCuadrado: propuestaCodCuadrado,
  } = useFormasPago(montoCodRequerido)

  const esPrestamoPuro = items.length > 0 && items.every(it => it.esPrestamo);

  const formasPagoFinales = useMemo(() => {
    if (esPrestamoPuro) {
      return [{ metodo: "Préstamo", monto: 0.00, diasVencimiento: 0 }]
    }

    const inyectarVuelto = (fps) => {
      if (pagosInmediatosHayVuelto && vueltoComoSaldoFavor) {
        return fps.map((fp, i) => i === 0 ? { ...fp, vuelto_a_favor: true } : fp)
      }
      return fps
    }

    if (esCod) {
      return [
        ...inyectarVuelto(pagosInmediatos),
        {
          metodo: "Cobro a destino",
          monto: montoCodRequerido,
          diasVencimiento: 0,
          cobro_destino_pagado: false,
          metodo_propuesto: propuestaCod
        }
      ]
    } else {
      return inyectarVuelto(pagosInmediatos)
    }
  }, [esPrestamoPuro, esCod, pagosInmediatos, propuestaCod, totalConFlete, totalInmediato, montoCodRequerido, pagosInmediatosHayVuelto, vueltoComoSaldoFavor])

  const handleToggleCod = () => {
    setEsCod(prev => {
      const next = !prev;
      if (!next) {
        resetPropuestaCod();
      } else {
        resetPropuestaCod();
      }
      return next;
    });
  };

  // Auto-guardado debounced 1.5s
  useEffect(() => {
    if (ventaRapida.isPending) return
    const timer = setTimeout(() => {
      if (items.length > 0 || clienteId) {
        const clienteObj = clientes.find(c => c.id === clienteId)
        saveDraft({
          step, clienteId, items, formasPago: formasPagoFinales, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, esCod,
          _clienteNombre: clienteObj?.nombre || '',
          _totalUsd: totalUsd,
          _itemsCount: items.length,
        }, perfil?.id)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [step, clienteId, items, formasPagoFinales, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, esCod, ventaRapida.isPending])

  const idsAgregados = new Set(items.map(it => it.productoId))

  const preciosMap = useMemo(() => {
    const m = {}
    for (const p of productos) {
      if (p.precio_2 != null || p.precio_3 != null) {
        m[p.id] = { p1: Number(p.precio_usd) || 0, p2: p.precio_2 != null ? Number(p.precio_2) : null, p3: p.precio_3 != null ? Number(p.precio_3) : null }
      }
    }
    return m
  }, [productos])
  const totalItems = items.reduce((s, it) => s + it.cantidad, 0)
  const transportistaSeleccionado = transportistas.find(t => t.id === transportistaId)

  // Validaciones
  const step1Valid = !!clienteId && items.length > 0
  const esVendedorSinComision = 
    clienteSeleccionado?.vendedor?.rol === 'vendedor_sin_comision' ||
    (clienteSeleccionado?.vendedor_id === perfil?.id && perfil?.rol === 'vendedor_sin_comision');


  const cxcItem = pagosInmediatos.find(f => f.metodo === 'Cta por cobrar');
  const cxcVencimientoValido = !cxcItem || (
    cxcItem.diasVencimiento !== undefined &&
    cxcItem.diasVencimiento !== null &&
    !isNaN(cxcItem.diasVencimiento) &&
    Number(cxcItem.diasVencimiento) > 0
  );

  const step2Valid = (esPrestamoPuro || ((esCod
    ? (pagoInmediatoCuadrado || (montoCodRequerido > 0.015 && propuestaCodCuadrado))
    : pagoInmediatoCuadrado) && cxcVencimientoValido)) && (!direccionEnvioActiva || (direccionEnvioEstado && direccionEnvioCiudad));

  // Close cliente dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (clienteRef.current && !clienteRef.current.contains(e.target)) setClienteOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Block scroll when mobile cart is open
  useEffect(() => {
    if (mobileCartOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [mobileCartOpen])

  // Filtrar clientes (excluir inactivos, preservando el seleccionado)
  const clientesFiltrados = useMemo(() => {
    const activos = clientes.filter(c => c.activo !== false || c.id === clienteId)
    
    // Ordenar de modo que los del vendedor actual salgan primero
    const ordenados = [...activos].sort((a, b) => {
      const aEsMio = a.vendedor_id === perfil?.id ? 1 : 0
      const bEsMio = b.vendedor_id === perfil?.id ? 1 : 0
      return bEsMio - aEsMio
    })

    if (!clienteBusqueda.trim()) return ordenados.slice(0, 8)
    const q = removeAccents(clienteBusqueda.toLowerCase())
    return ordenados.filter(c =>
      removeAccents(c.nombre.toLowerCase()).includes(q) ||
      removeAccents((c.rif_cedula ?? '').toLowerCase()).includes(q) ||
      (c.telefono ?? '').includes(clienteBusqueda)
    ).slice(0, 8)
  }, [clientes, clienteBusqueda, clienteId, perfil?.id])

  // Filtrar productos con smart search (ranking por relevancia)
  const productosFiltrados = useProductSearch(productos, productoBusqueda, catActiva)

  const recientes = getProductosRecientes(perfil?.id)
    .map(r => productos.find(p => p.id === r.id))
    .filter(Boolean)
    .slice(0, 6)

  function elegirCliente(c) {
    if (!esSupervisor && c.vendedor_id && c.vendedor_id !== perfil?.id) {
      setConfirmAjeno(c)
      return
    }
    setClienteId(c.id)
    setClienteBusqueda('')
    setClienteOpen(false)
  }

  function agregarProducto(p) {
    guardarProductoReciente(perfil?.id, p)
    const precioBase = aplicarMarkup(Number(p.precio_usd || p.preciousd || 0))

    _agregarItem({
      ...p,
      precio_usd: precioBase,
      preciousd: precioBase,
      precioOriginalUsd: precioBase
    })
  }


  async function handleSubmit() {
    if (!step1Valid || !step2Valid) return
    const fpJson = JSON.stringify(formasPagoFinales)
    
    const esPersonal = clienteSeleccionado?.tipo_cliente === 'personal'
    const descPct = config.descuento_personal_pct ?? 10.00

    ventaRapida.mutate({
      clienteId,
      clienteNombre: clienteSeleccionado?.nombre,
      transportistaId: transportistaId || null,
      fleteUsd: flete,
      corteUsd: corte,
      formaPago: fpJson,
      formaPagoCliente: fpJson,
      referenciaPago: referenciaPago || null,
      notas,
      notasCliente: null,
      items: items.map(it => {
        const precioUnit = it.precioUnitUsd
        const precioFinal = esPersonal ? round2(precioUnit * (1 - descPct / 100)) : precioUnit
        return {
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitUsd: precioFinal,
          descuentoPct: 0,
          nombreSnap: it.nombreSnap,
          unidadSnap: it.unidadSnap,
          codigoSnap: it.codigoSnap,
          origen: it.origen,
          es_prestamo: it.esPrestamo || false,
        }
      }),
      costoEnvioUsd,
      tasaBcv: tasa,
      direccionEnvioDireccion: direccionEnvioActiva ? direccionEnvioDireccion : null,
      direccionEnvioCiudad: direccionEnvioActiva ? direccionEnvioCiudad : null,
      direccionEnvioEstado: direccionEnvioActiva ? direccionEnvioEstado : null,
    }, {
      onSuccess: (result) => {
        clearDraft(perfil?.id)
        // Guardar datos para el modal de éxito
        setVentaExitosa({
          numero: result.numero,
          despachoId: result.id,
          cotizacionId: result.cotizacionId,
          clienteId: clienteId,
          clienteNombre: clienteSeleccionado?.nombre,
          vendedorId: perfil?.id,
          transportistaId: transportistaId || null,
          transportista: transportistaSeleccionado?.nombre || null,
          flete,
          corte,
          items: items.map(it => ({ ...it })),
          subtotal,
          totalUsd,
          totalBs,
          tasa,
          tasaUsdt: tasaHook.tasaUsdt?.precio || 0,
          tasaBcv: tasaHook.tasaBcv?.precio || 0,
          formasPago: formasPagoFinales,
          notas,
        })
        // Reset form
        setStep(0)
        setClienteId('')
        setItems([])
        resetPagosInmediatos()
        resetPropuestaCod()
        setEsCod(false)
        setReferenciaPago('')
        setTransportistaId('')
        setFleteUsd('')
        setCorteUsd('')
        setNotas('')
      },
    })
  }

  // ─── Step indicators ──────────────────────────────────────────────────────
  const steps = [
    { label: 'Productos', icon: Package },
    { label: 'Pago', icon: CreditCard },
    { label: 'Confirmar', icon: CheckCircle },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Venta rápida"
        subtitle="Cotización + despacho en un solo paso"
        icon={Zap}
      />

      {showDraftBanner && borradorInfo && (
        <div className="relative overflow-hidden rounded-2xl border border-white/30 mx-4 mt-3 p-4 animate-in fade-in slide-in-from-top-2 duration-500"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(248,250,252,0.9) 100%)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}>
          {/* Animated accent bar */}
          <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ background: 'linear-gradient(90deg, #f59e0b, #d97706, #b45309)' }} />
          {/* Pulsing indicator */}
          <div className="absolute top-3 right-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Icon + Info */}
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, #fbbf24, #d97706)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' }}>
                <Zap size={18} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">Venta sin terminar</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                  <span className="text-xs text-slate-500 flex items-center gap-1 truncate">
                    <User size={11} className="shrink-0" />
                    {borradorInfo._clienteNombre || 'Cliente sin especificar'}
                  </span>
                  {(borradorInfo._itemsCount || borradorInfo.items?.length > 0) && (
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <ShoppingCart size={11} className="shrink-0" />
                      {borradorInfo._itemsCount || borradorInfo.items?.length} artículo{(borradorInfo._itemsCount || borradorInfo.items?.length) !== 1 ? 's' : ''}
                    </span>
                  )}
                  {borradorInfo._totalUsd > 0 && (
                    <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                      <DollarSign size={11} className="shrink-0" />
                      {fmtUsd(borradorInfo._totalUsd)}
                    </span>
                  )}
                  {borradorInfo._ts && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Clock size={10} className="shrink-0" />
                      {formatRelativeTime(borradorInfo._ts)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0 sm:self-center">
              <button type="button" onClick={restoreDraft}
                className="px-4 py-2 rounded-xl text-white text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #d97706, #b45309)', boxShadow: '0 4px 12px rgba(180,83,9,0.3)' }}>
                Retomar
              </button>
              <button type="button" onClick={discardDraft}
                className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-all">
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo toast — flotante al descartar borrador */}
      {undoDraft && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] animate-in fade-in slide-in-from-bottom-3 duration-300"
          style={{ maxWidth: 'calc(100vw - 2rem)' }}>
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-700/40"
            style={{
              background: 'rgba(15,23,42,0.92)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            }}>
            <Trash2 size={15} className="text-slate-400 shrink-0" />
            <span className="text-sm text-white/90 font-medium whitespace-nowrap">Borrador descartado</span>
            <button onClick={undoDiscard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-all">
              <Undo2 size={13} />
              Deshacer
            </button>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 sm:gap-2 px-4 py-2 bg-white/60 border-b border-slate-200/60">
        {steps.map((s, i) => {
          const Icon = s.icon
          const active = i === step
          const done = i < step
          return (
            <div key={i} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && <div className={`w-6 sm:w-10 h-0.5 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              <button
                onClick={() => { if (done) setStep(i) }}
                disabled={!done && !active}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  active ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-300' :
                  done ? 'bg-emerald-50 text-emerald-700 cursor-pointer hover:bg-emerald-100' :
                  'bg-slate-100 text-slate-400'
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {step === 0 && (
          <Step1Productos
            config={config}
            clienteRef={clienteRef}
            clienteId={clienteId}
            clienteSeleccionado={clienteSeleccionado}
            clienteBusqueda={clienteBusqueda}
            setClienteBusqueda={setClienteBusqueda}
            clienteOpen={clienteOpen}
            setClienteOpen={setClienteOpen}
            clientesFiltrados={clientesFiltrados}
            elegirCliente={elegirCliente}
            setClienteId={setClienteId}
            confirmAjeno={confirmAjeno}
            setConfirmAjeno={setConfirmAjeno}
            esSupervisor={esSupervisor}
            showNuevoCliente={showNuevoCliente}
            setShowNuevoCliente={setShowNuevoCliente}
            clientes={clientes}
            productoBusqueda={productoBusqueda}
            setProductoBusqueda={setProductoBusqueda}
            productoInputRef={productoInputRef}
            categorias={categorias}
            catActiva={catActiva}
            setCatActiva={setCatActiva}
            productosFiltrados={productosFiltrados}
            recientes={recientes}
            idsAgregados={idsAgregados}
            agregarProducto={agregarProducto}
            items={items}
            cambiarCantidad={cambiarCantidad}
            setCantidadDirecta={setCantidadDirecta}
            cambiarPrecio={cambiarPrecio}
            quitarItem={quitarItem}
            preciosMap={preciosMap}
            totalItems={totalItems}
            subtotal={subtotal}
            descuentoMonto={descuentoMonto}
            totalUsd={totalUsd}
            totalBs={totalBs}
            tasa={tasa}
            mobileCartOpen={mobileCartOpen}
            setMobileCartOpen={setMobileCartOpen}
            step1Valid={step1Valid}
            onSiguiente={() => setStep(1)}
            productos={productos}
            setEditItemIdx={setEditItemIdx}
            esVendedorSinComision={esVendedorSinComision}
            togglePrestamo={togglePrestamo}
          />
        )}

        {step === 1 && (
          <Step2Pago
            pagosInmediatos={pagosInmediatos}
            propuestaCod={propuestaCod}
            togglePagoInmediato={togglePagoInmediato}
            setMontoPagoInmediato={setMontoPagoInmediato}
            updatePagoInmediato={updatePagoInmediato}
            resetPagosInmediatos={resetPagosInmediatos}
            togglePropuestaCod={togglePropuestaCod}
            setMontoPropuestaCod={setMontoPropuestaCod}
            updatePropuestaCod={updatePropuestaCod}
            resetPropuestaCod={resetPropuestaCod}
            totalInmediato={totalInmediato}
            totalPropuestaCod={totalPropuestaCod}
            montoCodRequerido={montoCodRequerido}
            pagoInmediatoCuadrado={pagoInmediatoCuadrado}
            propuestaCodCuadrado={propuestaCodCuadrado}
            comisionEstimada={comisionEstimada}
            items={items}
            totalParaPago={totalParaPago}
            referenciaPago={referenciaPago}
            setReferenciaPago={setReferenciaPago}
            transportistas={transportistas}
            transportistaId={transportistaId}
            setTransportistaId={setTransportistaId}
            fleteUsd={fleteUsd}
            setFleteUsd={setFleteUsd}
            corteUsd={corteUsd}
            setCorteUsd={setCorteUsd}
            notas={notas}
            setNotas={setNotas}
            tasa={tasa}
            esCod={esCod}
            setEsCod={handleToggleCod}
            clienteSeleccionado={clienteSeleccionado}
            esPrestamoPuro={esPrestamoPuro}
            direccionEnvioActiva={direccionEnvioActiva}
            setDireccionEnvioActiva={setDireccionEnvioActiva}
            direccionEnvioEstado={direccionEnvioEstado}
            setDireccionEnvioEstado={setDireccionEnvioEstado}
            direccionEnvioCiudad={direccionEnvioCiudad}
            setDireccionEnvioCiudad={setDireccionEnvioCiudad}
            direccionEnvioDireccion={direccionEnvioDireccion}
            setDireccionEnvioDireccion={setDireccionEnvioDireccion}
            saldoFavorOrigen={saldoFavorOrigen}
            vueltoComoSaldoFavor={vueltoComoSaldoFavor}
            pagosInmediatosHayVuelto={pagosInmediatosHayVuelto}
            pagosInmediatosDiferencia={pagosInmediatosDiferencia}
            config={config}
            subtotal={subtotal}
            descuentoMonto={descuentoMonto}
          />
        )}

        {step === 2 && (
          <Step3Confirmar
            config={config}
            clienteSeleccionado={clienteSeleccionado}
            items={items}
            subtotal={subtotal}
            totalUsd={totalUsd}
            flete={flete}
            corte={corte}
            totalConFlete={totalConFlete}
            totalBs={totalBs}
            tasa={tasa}
            formasPago={formasPagoFinales}
            referenciaPago={referenciaPago}
            transportistaSeleccionado={transportistaSeleccionado}
            notas={notas}
            esCod={esCod}
          />
        )}
      </div>

      {/* Bottom bar with nav buttons — hidden on step 0 (use cart FAB instead) */}
      {step > 0 && (
      <div className="fixed bottom-16 left-0 right-0 md:sticky md:bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 z-[96]" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
        <button onClick={() => setStep(step - 1)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
          <ArrowLeft size={16} /> Atrás
        </button>

        {step < 2 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!step2Valid}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Siguiente <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={ventaRapida.isPending || !step1Valid || !step2Valid}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {ventaRapida.isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Crear venta rápida
          </button>
        )}
      </div>
      )}

      {/* Modal de venta exitosa */}
      {ventaExitosa && (
        <ModalVentaExitosa
          data={ventaExitosa}
          config={config}
          onClose={() => { setVentaExitosa(null); navigate('/despachos') }}
        />
      )}

      <ModalEditarExterno 
        isOpen={editItemIdx !== null}
        item={editItemIdx !== null ? items[editItemIdx] : null}
        onClose={() => setEditItemIdx(null)}
        onSave={(idx, nuevosCampos) => {
          setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...nuevosCampos } : it))
          setEditItemIdx(null)
          showToast('Producto actualizado', 'success')
        }}
        idx={editItemIdx}
      />
    </div>
  )
}

const getStockHelper = (prodId, productos = []) => {
  const p = productos.find(x => x.id === prodId)
  return p ? Number(p.stock_actual) || 0 : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Swipe-to-delete wrapper (mobile only)
// ─────────────────────────────────────────────────────────────────────────────
function SwipeToDelete({ children, enabled, onDelete }) {
  const ref = useRef(null)
  const startX = useRef(0)
  const currentX = useRef(0)
  const swiping = useRef(false)

  if (!enabled) return children

  function handleTouchStart(e) {
    startX.current = e.touches[0].clientX
    currentX.current = 0
    swiping.current = false
    if (ref.current) ref.current.style.transition = 'none'
  }

  function handleTouchMove(e) {
    const dx = e.touches[0].clientX - startX.current
    // Only allow swipe left (negative dx)
    const offset = Math.min(0, Math.max(-80, dx))
    currentX.current = offset
    if (offset < -10) swiping.current = true
    if (ref.current) ref.current.style.transform = `translateX(${offset}px)`
  }

  function handleTouchEnd() {
    if (!ref.current) return
    ref.current.style.transition = 'transform 0.25s ease'
    if (currentX.current < -50) {
      // Snap to reveal delete
      ref.current.style.transform = 'translateX(-72px)'
    } else {
      ref.current.style.transform = 'translateX(0)'
    }
  }

  // Prevent click propagation when swiping
  function handleClick(e) {
    if (swiping.current) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Delete button behind */}
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute right-0 top-0 bottom-0 w-[72px] flex items-center justify-center bg-red-500 text-white rounded-r-xl active:bg-red-600 transition-colors">
        <div className="flex flex-col items-center gap-0.5">
          <Trash2 size={16} />
          <span className="text-[9px] font-bold">Quitar</span>
        </div>
      </button>
      {/* Swipeable content */}
      <div ref={ref}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClickCapture={handleClick}
        className="relative z-[1] bg-white rounded-xl"
      >
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Cliente + Productos
// ─────────────────────────────────────────────────────────────────────────────
function Step1Productos({
  config,
  clienteRef, clienteId, clienteSeleccionado, clienteBusqueda, setClienteBusqueda,
  clienteOpen, setClienteOpen, clientesFiltrados, elegirCliente, setClienteId,
  confirmAjeno, setConfirmAjeno, esSupervisor,
  showNuevoCliente, setShowNuevoCliente, clientes,
  productoBusqueda, setProductoBusqueda, productoInputRef,
  categorias, catActiva, setCatActiva,
  productosFiltrados, recientes, idsAgregados, agregarProducto,
  items, cambiarCantidad, setCantidadDirecta, cambiarPrecio, quitarItem,
  totalItems, subtotal, descuentoMonto, totalUsd, totalBs, tasa,
  mobileCartOpen, setMobileCartOpen,
  step1Valid, onSiguiente,
  preciosMap = {},
  productos = [],
  setEditItemIdx,
  esVendedorSinComision,
  togglePrestamo,
}) {
  const { aplicarMarkup, esExterno } = usePrecioVendedor()
  const [sheetState, setSheetState] = useState('closed')
  const sheetOpen = sheetState !== 'closed'
  const setSheetOpen = (v) => setSheetState(v ? 'expanded' : 'closed')
  const sheetRef = useRef(null)
  const handleRef = useRef(null)
  const sheetStateRef = useRef(sheetState)
  sheetStateRef.current = sheetState
  const [editQty, setEditQty] = useState(null) // { productoId, nombre, cantidad }
  const editQtyRef = useRef(null)

  // Estado para producto externo
  const [showExt, setShowExt] = useState(false)
  const [extNombre, setExtNombre] = useState('')
  const [extUnidad, setExtUnidad] = useState('und')
  const [extPrecio, setExtPrecio] = useState('')
  const [extCant, setExtCant] = useState('1')

  // Block scroll when sheet is open
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sheetOpen])

  // Tap en handle → toggle expand/normal
  const handleTapToggle = () => {
    setSheetState(s => s === 'expanded' ? 'normal' : 'expanded')
  }

  // Touch events para swipe en el handle del sheet
  useEffect(() => {
    const el = handleRef.current
    if (!el) return

    let startY = 0
    let moved = false

    const onTouchStart = (e) => {
      startY = e.touches[0].clientY
      moved = false
      if (sheetRef.current) sheetRef.current.style.transition = 'none'
    }

    const onTouchMove = (e) => {
      const dy = e.touches[0].clientY - startY
      if (Math.abs(dy) > 5) moved = true
      if (!moved) return
      e.preventDefault()
      if (!sheetRef.current) return
      const factor = dy < 0 ? 0.4 : 1
      sheetRef.current.style.transform = `translateY(${dy * factor}px)`
    }

    const onTouchEnd = (e) => {
      const dy = e.changedTouches[0].clientY - startY
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 0.3s ease, height 0.3s ease'
        sheetRef.current.style.transform = ''
      }
      if (!moved) return // tap handled by onClick
      const st = sheetStateRef.current
      if (dy < -40) {
        setSheetState('expanded')
      } else if (dy > 80) {
        setSheetState('closed')
      } else if (dy > 40 && st === 'expanded') {
        setSheetState('normal')
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  function handleAgregarExterno(e) {
    e.preventDefault()
    if (!extNombre.trim() || !extPrecio) return

    agregarProducto({
      id: 'ext_' + Date.now(),
      codigo: `EXT${Math.floor(1000000 + Math.random() * 9000000)}`,
      origen: 'externo',
      nombre: extNombre.trim(),
      unidad: extUnidad.trim() || 'und',
      precio_usd: Number(extPrecio),
      stock_actual: Infinity,
      cantidad_inicial: Number(extCant) || 1
    })

    setExtNombre('')
    setExtUnidad('und')
    setExtPrecio('')
    setExtCant('1')
    setShowExt(false)
  }

  // Ordenar: productos con stock primero, luego sin stock
  const productosOrdenados = useMemo(() => {
    return [...productosFiltrados].sort((a, b) => {
      const aStock = (Number(a.stock_actual) || 0) > 0 ? 0 : 1
      const bStock = (Number(b.stock_actual) || 0) > 0 ? 0 : 1
      return aStock - bStock
    })
  }, [productosFiltrados])

  const productosVisibles = productosOrdenados.slice(0, 60)

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 pb-0 lg:p-3 lg:pb-0">
      {/* Nuevo cliente modal */}
      {showNuevoCliente && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[80vh] sm:max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b shrink-0">
              <h3 className="font-semibold text-slate-800">Nuevo cliente</h3>
              <button onClick={() => setShowNuevoCliente(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              <ClienteForm onSuccess={(nuevo) => {
                setClienteId(nuevo.id)
                setShowNuevoCliente(false)
              }} onCancel={() => setShowNuevoCliente(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Confirm ajeno modal */}
      {confirmAjeno && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3">
            <p className="text-sm font-medium text-amber-700 flex items-center gap-2">
              <AlertCircle size={16} /> Este cliente pertenece a otro vendedor
            </p>
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-800">{confirmAjeno.nombre}</p>
              <p className="text-xs text-slate-500">
                Pertenece a: <span className="font-medium text-slate-700">{confirmAjeno.vendedor?.nombre || 'Otro vendedor'}</span>
              </p>
              <p className="text-xs text-amber-600 font-medium">
                La comisión se le asignará a él.
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setConfirmAjeno(null)} className="flex-1 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200">Cancelar</button>
              <button onClick={() => { setClienteId(confirmAjeno.id); setConfirmAjeno(null); setClienteOpen(false) }}
                className="flex-1 py-2 rounded-lg text-sm bg-amber-500 text-white hover:bg-amber-600">Continuar</button>
            </div>
          </div>
        </div>
      )}

      {/* Cliente selector — compact inline */}
      <div ref={clienteRef} className="relative shrink-0 mb-1.5">
        {clienteSeleccionado ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border" style={{ backgroundColor: (clienteSeleccionado.vendedor?.color || '#10b981') + '12', borderColor: (clienteSeleccionado.vendedor?.color || '#10b981') + '40' }}>
            <User size={14} className="shrink-0" style={{ color: clienteSeleccionado.vendedor?.color || '#10b981' }} />
            <p className="font-medium text-sm truncate" style={{ color: clienteSeleccionado.vendedor?.color || '#1e293b' }}>{clienteSeleccionado.nombre}</p>
            {clienteSeleccionado.rif_cedula && <span className="text-xs text-slate-400">{clienteSeleccionado.rif_cedula}</span>}
            {clienteSeleccionado?.tipo_cliente === 'personal' && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                Personal ({config?.descuento_personal_pct ?? 10}%)
              </span>
            )}
            <button onClick={() => setClienteId('')} className="ml-auto p-1 rounded-lg hover:bg-slate-100">
              <X size={14} className="text-slate-400" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-sky-600 uppercase tracking-wider ml-1 flex items-center gap-1.5"><User size={12}/> Cliente</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sky-400" />
                <input
                  type="text" placeholder="Buscar cliente..."
                  value={clienteBusqueda}
                  onChange={e => { setClienteBusqueda(e.target.value); setClienteOpen(true) }}
                  onFocus={() => setClienteOpen(true)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-sky-100 bg-sky-50/50 text-sm focus:ring-1 focus:ring-sky-400/50 focus:border-sky-400 outline-none transition-all"
                />
                {clienteOpen && clientesFiltrados.length > 0 && (
                  <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
                      {clientesFiltrados.map(c => (
                        <button key={c.id} onClick={() => elegirCliente(c)}
                          className="w-full text-left px-3.5 py-2 hover:bg-sky-50 rounded-xl text-sm flex items-center gap-2 transition-all group">
                          <User size={14} className="shrink-0 group-hover:scale-105 transition-transform" style={{ color: c.vendedor?.color || '#94a3b8' }} />
                          <span className="truncate font-medium flex-1 group-hover:text-primary transition-colors" style={{ color: c.vendedor?.color || '#334155' }}>{c.nombre}</span>
                          {c.rif_cedula && <span className="text-xs text-slate-400 shrink-0 font-mono">{c.rif_cedula}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => setShowNuevoCliente(true)}
                className="px-3 py-2 rounded-xl bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-200 transition-colors">
                <UserPlus size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Split: catálogo izquierda + carrito derecha (desktop) ── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-3">
      {/* ── Columna izquierda: Productos ── */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto lg:pr-1">

        {/* ── Barra de búsqueda (estilo Fase 2) ── */}
        <div className="flex flex-col gap-1.5 mb-2 mt-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider ml-1 flex items-center gap-1.5"><Package size={12}/> Catálogo</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input ref={productoInputRef}
                type="text" placeholder="Buscar por nombre o código..."
                value={productoBusqueda}
                onChange={e => setProductoBusqueda(e.target.value)}
                className="w-full pl-10 pr-10 py-2 rounded-xl border border-slate-200 bg-slate-50 shadow-inner text-sm focus:outline-none focus:ring-1 focus:ring-primary-focus/20 focus:border-primary placeholder:text-slate-400 transition-all"
              />
              {productoBusqueda && (
                <button type="button" onClick={() => setProductoBusqueda('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
          <button type="button" onClick={() => setShowExt(!showExt)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all text-xs font-bold ${
              showExt ? 'bg-primary text-white border-primary shadow-sm' : 'text-primary hover:bg-primary/5 border-primary/20 bg-white shadow-sm'
            }`}>
            {showExt ? <Minus size={14} /> : <Plus size={14} />} 
            <span className="hidden sm:inline">Producto externo</span>
            <span className="inline sm:hidden">Externo</span>
          </button>
        </div>
        </div>

        {/* Form externo */}
        {showExt && (
          <form onSubmit={handleAgregarExterno} className="bg-white border-2 border-primary/20 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200 mb-3 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Package size={16} className="text-primary" />
              <h4 className="text-sm font-bold text-slate-700">Agregar producto manual</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                <label className="text-xs font-medium text-slate-500">Nombre del producto *</label>
                <input type="text" value={extNombre} onChange={e => setExtNombre(e.target.value.toUpperCase())} required autoFocus placeholder="Ej: Cemento gris" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Unidad</label>
                <input type="text" value={extUnidad} onChange={e => setExtUnidad(e.target.value.toUpperCase())} placeholder="Ej: und, saco, m" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Precio USD *</label>
                <input type="number" min="0.01" step="0.01" value={extPrecio} onChange={e => setExtPrecio(e.target.value)} required placeholder="0.00" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Cantidad *</label>
                <input type="number" min="0.01" step="0.01" value={extCant} onChange={e => setExtCant(e.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button type="submit" className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-focus transition-colors shadow-sm">
                Agregar al carrito
              </button>
            </div>
          </form>
        )}

        {/* ── Categorías en pills (colapsables en móvil, scroll en desktop) ── */}
        <CategoryPills categorias={categorias} activa={catActiva} onChange={(cat) => setCatActiva(cat)} />

        {/* ── Tarjetas de productos (grid unificado con ProductCard compartido) ── */}
        <div className="grid grid-cols-3 gap-1 md:grid-cols-5 lg:grid-cols-6 md:gap-1.5">
          {productosVisibles.map(p => {
            const added = idsAgregados.has(p.id)
            const itemInCart = added ? items.find(it => it.productoId === p.id) : null
            return (
              <ProductCard
                key={p.id}
                producto={p}
                agregado={added}
                cantidad={itemInCart?.cantidad ?? null}
                tasa={tasa}
                comprometido={0}
                onAgregar={agregarProducto}
                onMas={() => cambiarCantidad(p.id, 1)}
                onMenos={() => itemInCart.cantidad <= 1 ? quitarItem(p.id) : cambiarCantidad(p.id, -1)}
                onCantidadDirecta={(val) => setCantidadDirecta(p.id, val)}
              />
            )
          })}
        </div>

        {productosFiltrados.length === 0 && productoBusqueda && (
          <div className="text-center py-10">
            <Search size={28} className="mx-auto text-slate-200 mb-3" />
            <p className="text-sm font-bold text-slate-400">Sin resultados</p>
            <p className="text-xs text-slate-300 mt-1">Intenta con otro término o categoría</p>
          </div>
        )}
      </div>{/* ── Fin scroll area ── */}
      </div>{/* ── Fin columna izquierda ── */}

      {/* ── Columna derecha: Carrito (desktop) ── */}
      <div className="hidden lg:flex w-72 xl:w-80 shrink-0 bg-white rounded-2xl border border-slate-200 flex-col overflow-hidden shadow-sm">
        <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <ShoppingCart size={18} style={{ color: '#1B365D' }} />
          <h3 className="font-black text-slate-800 text-base">Carrito</h3>
          <span className="ml-auto text-xs font-bold text-slate-400">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
        </div>
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-slate-300">
            <ShoppingCart size={32} className="mb-2 opacity-40" />
            <p className="text-sm font-medium">Carrito vacío</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 divide-y divide-slate-50">
              {items.map(it => {
                const linea = it.esPrestamo ? 0 : round2(it.precioUnitUsd * it.cantidad)
                return (
                  <div key={it.productoId} className={`py-2 px-2 rounded-xl transition-all ${it.esPrestamo ? 'bg-emerald-50/50 border border-emerald-100/60 my-1 shadow-sm' : 'border-b border-slate-50 last:border-0'}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-slate-700 leading-snug">
                          {it.nombreSnap}
                          {it.esPrestamo && (
                            <span className="inline-flex items-center gap-1 ml-1 align-middle text-[8px] uppercase tracking-wider font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md">
                              <Handshake size={10} /> Préstamo
                            </span>
                          )}
                          {it.origen === 'externo' && (
                            <span className="inline-block ml-1 align-middle text-[8px] uppercase tracking-wider font-bold bg-amber-100 text-amber-700 px-1 py-0.5 rounded">
                              Ext - {it.codigoSnap}
                            </span>
                          )}
                        </p>
                        {esVendedorSinComision && (
                          <div className="flex items-center gap-1 mt-1 mb-1.5 bg-slate-100 p-0.5 rounded-full w-fit">
                            <button
                              type="button"
                              onClick={() => it.esPrestamo && togglePrestamo(it.productoId)}
                              className={`px-2 py-0.5 text-[9px] font-bold rounded-full transition-all ${
                                !it.esPrestamo
                                  ? 'bg-white text-slate-800 shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Venta
                            </button>
                            <button
                              type="button"
                              onClick={() => !it.esPrestamo && togglePrestamo(it.productoId)}
                              className={`px-2 py-0.5 text-[9px] font-black rounded-full transition-all flex items-center gap-0.5 ${
                                it.esPrestamo
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-emerald-700'
                              }`}
                            >
                              <Handshake size={10} /> Préstamo
                            </button>
                          </div>
                        )}
                        {(() => {
                          const esExterno = it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-') || String(it.codigoSnap).startsWith('EXT')
                          return !esExterno && it.cantidad > getStockHelper(it.productoId, productos)
                        })() && (
                          <div className="flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200 mt-0.5 w-fit">
                            <AlertCircle size={10} /> Stock insuficiente ({getStockHelper(it.productoId, productos)} disp.)
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] font-black text-slate-800 shrink-0">{fmtUsd(linea)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">{fmtUsd(it.precioUnitUsd)}</span>
                      <div className="flex items-center bg-slate-50 rounded-lg border border-slate-100 overflow-hidden ml-auto">
                        <button type="button"
                          onClick={() => it.cantidad <= 1 ? quitarItem(it.productoId) : cambiarCantidad(it.productoId, -1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90">
                          <Minus size={12} strokeWidth={3} />
                        </button>
                        <input
                          key={`cart-qty-${it.productoId}-${it.cantidad}`}
                          type="text"
                          inputMode="numeric"
                          defaultValue={it.cantidad}
                          onFocus={e => e.target.select()}
                          onClick={e => e.target.select()}
                          onBlur={e => {
                            const num = Math.max(1, parseInt(e.target.value, 10) || 1)
                            setCantidadDirecta(it.productoId, num)
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                          className="w-9 h-7 text-center text-[12px] font-black text-slate-700 bg-white border-x border-slate-100 outline-none focus:bg-sky-50 focus:border-sky-300"
                        />
                        <button type="button"
                          onClick={() => cambiarCantidad(it.productoId, 1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90">
                          <Plus size={12} strokeWidth={3} />
                        </button>
                      </div>
                      {it.origen === 'externo' && (
                        <button type="button" onClick={() => setEditItemIdx(items.findIndex(x => x.productoId === it.productoId))}
                          className="w-7 h-7 rounded-md bg-amber-50 hover:bg-amber-100 flex items-center justify-center shrink-0 transition-colors active:scale-95 border border-amber-200">
                          <Edit2 size={11} className="text-amber-600" />
                        </button>
                      )}
                      <button type="button" onClick={() => quitarItem(it.productoId)}
                        className="w-7 h-7 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors active:scale-95">
                        <Trash2 size={12} className="text-red-400" />
                      </button>
                    </div>
                    {preciosMap[it.productoId] && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {[{ label: 'Detal', value: preciosMap[it.productoId].p1 }, { label: 'Mayor', value: preciosMap[it.productoId].p2 }, { label: 'Especial', value: preciosMap[it.productoId].p3 }]
                          .filter(n => n.value != null && Number(n.value) > 0)
                          .map(n => {
                            const valConMarkup = aplicarMarkup(Number(n.value))
                            const active = Math.abs(Number(it.precioUnitUsd) - valConMarkup) < 0.001
                            return (
                              <button key={n.label} type="button"
                                onClick={() => cambiarPrecio(it.productoId, valConMarkup)}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border transition-colors ${
                                  active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200 hover:border-primary/40'
                                }`}
                                title={esExterno ? `Base: ${fmtUsd(n.value)}` : undefined}>
                                {n.label} {fmtUsd(valConMarkup)}
                              </button>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="shrink-0 border-t border-slate-200 p-3 space-y-2 bg-white">
              {clienteSeleccionado?.tipo_cliente === 'personal' && (
                <p className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                  * Descuento automático de personal ({config?.descuento_personal_pct ?? 10}%) se aplicará en el total.
                </p>
              )}
              <div className="space-y-1.5 px-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Subtotal</span>
                  <span>{fmtUsd(subtotal)}</span>
                </div>
                {clienteSeleccionado?.tipo_cliente === 'personal' && (
                  <div className="flex justify-between text-xs text-amber-700 font-medium">
                    <span>Descuento Personal ({config?.descuento_personal_pct ?? 10}%)</span>
                    <span>-{fmtUsd(descuentoMonto)}</span>
                  </div>
                )}
                <div className="flex justify-between items-end border-t border-slate-100 pt-1.5">
                  <div>
                    <span className="text-[12px] font-black text-slate-600 uppercase tracking-wider">Total</span>
                    {tasa > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(totalBs)}</p>}
                  </div>
                  <span className="text-xl font-black text-slate-800">{fmtUsd(totalUsd)}</span>
                </div>
              </div>
              <button type="button"
                onClick={() => { if (step1Valid) onSiguiente() }}
                disabled={!step1Valid}
                className="w-full flex items-center justify-center gap-2 py-3 text-white font-bold text-sm rounded-xl transition-all active:scale-[0.98] shadow-lg disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                Siguiente <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
      </div>
      </div>{/* ── Fin split layout ── */}

      {/* ── Mobile-only: Modal cantidad, FAB, Bottom Sheet ── */}
      <div className="lg:hidden">
      {/* ── Modal para editar cantidad exacta ── */}
      {editQty && (
        <div className="fixed inset-0 z-[101] bg-black/40 flex items-center justify-center p-4 md:hidden"
          onClick={() => setEditQty(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-[280px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cantidad</p>
            <p className="text-sm font-bold text-slate-700 mb-3">{editQty.nombre}</p>
            <input
              ref={editQtyRef}
              type="text"
              inputMode="numeric"
              autoFocus
              min={1}
              max={editQty.stock || 99999}
              defaultValue={editQty.cantidad}
              onFocus={e => e.target.select()}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = Math.max(1, Math.floor(Number(e.target.value) || 1))
                  setCantidadDirecta(editQty.productoId, val)
                  setEditQty(null)
                }
              }}
              className="w-full text-center text-2xl font-black text-slate-800 py-3 rounded-xl border-2 border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 outline-none"
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEditQty(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-600">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const val = Math.max(1, Math.floor(Number(editQtyRef.current?.value) || 1))
                  setCantidadDirecta(editQty.productoId, val)
                  setEditQty(null)
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700">
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FAB flotante (visible cuando hay items y sheet cerrado) ── */}
      {items.length > 0 && !sheetOpen && (
        <button type="button"
          onClick={() => setSheetOpen(true)}
          className="fixed bottom-[5rem] left-3 right-3 z-[96] p-3 rounded-2xl shadow-xl flex items-center justify-between active:scale-[0.97] transition-all md:bottom-16"
          style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)', boxShadow: '0 8px 30px rgba(27,54,93,0.35)' }}>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <ShoppingCart size={18} className="text-white" />
            </div>
            <div className="text-left">
              <div className="text-[10px] font-bold text-white/70 uppercase tracking-wider">Ver Carrito</div>
              <div className="text-white font-black text-sm">{totalItems} item{totalItems !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-black text-white leading-none">{fmtUsd(totalUsd)}</div>
            {tasa > 0 && <div className="text-[10px] font-bold text-white/70 mt-0.5">{fmtBs(totalBs)}</div>}
          </div>
        </button>
      )}

      {/* ── Bottom Sheet del carrito ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm"
          onClick={() => setSheetOpen(false)}>
          <div ref={sheetRef}
            className="bg-white w-full rounded-t-3xl shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]"
            style={{
              height: sheetState === 'expanded' ? '92vh' : '50vh',
              transition: 'transform 0.3s ease, height 0.3s ease',
            }}
            onClick={e => e.stopPropagation()}>
            {/* Handle + Header - zona de swipe */}
            <div ref={handleRef} className="shrink-0 cursor-grab active:cursor-grabbing select-none"
              onClick={handleTapToggle}
              style={{ touchAction: 'none' }}>
              {/* Handle visual */}
              <div className="flex flex-col items-center pt-3 pb-2 gap-0.5">
                <div className={`w-12 h-1.5 rounded-full transition-colors ${sheetState === 'expanded' ? 'bg-primary' : 'bg-slate-300'}`} />
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                  {sheetState === 'normal' ? '↑ Expandir' : '↓ Reducir'}
                </span>
              </div>
              {/* Header */}
              <div className="px-4 pb-3 flex items-center justify-between border-b border-slate-200">
                <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                  <ShoppingCart size={18} style={{ color: '#1B365D' }} /> Carrito
                </h3>
                <button onClick={(e) => { e.stopPropagation(); setSheetOpen(false) }}
                  className="p-1.5 rounded-lg hover:bg-slate-100">
                  <X size={18} className="text-slate-400" />
                </button>
              </div>
            </div>
            {/* Items list */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 divide-y divide-slate-50" style={{ WebkitOverflowScrolling: 'touch' }}>
              {items.map(it => {
                const linea = it.esPrestamo ? 0 : round2(it.precioUnitUsd * it.cantidad)
                return (
                  <div key={it.productoId} className={`py-2 px-2 rounded-xl transition-all ${it.esPrestamo ? 'bg-emerald-50/50 border border-emerald-100/60 my-1 shadow-sm' : 'border-b border-slate-50 last:border-0'}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-slate-700 leading-snug">
                          {it.nombreSnap}
                          {it.esPrestamo && (
                            <span className="inline-flex items-center gap-1 ml-1 align-middle text-[8px] uppercase tracking-wider font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md">
                              <Handshake size={10} /> Préstamo
                            </span>
                          )}
                          {it.origen === 'externo' && (
                            <span className="inline-block ml-1 align-middle text-[8px] uppercase tracking-wider font-bold bg-amber-100 text-amber-700 px-1 py-0.5 rounded">
                              Ext - {it.codigoSnap}
                            </span>
                          )}
                        </p>
                        {esVendedorSinComision && (
                          <div className="flex items-center gap-1 mt-1 mb-1.5 bg-slate-100 p-0.5 rounded-full w-fit">
                            <button
                              type="button"
                              onClick={() => it.esPrestamo && togglePrestamo(it.productoId)}
                              className={`px-2 py-0.5 text-[9px] font-bold rounded-full transition-all ${
                                !it.esPrestamo
                                  ? 'bg-white text-slate-800 shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Venta
                            </button>
                            <button
                              type="button"
                              onClick={() => !it.esPrestamo && togglePrestamo(it.productoId)}
                              className={`px-2 py-0.5 text-[9px] font-black rounded-full transition-all flex items-center gap-0.5 ${
                                it.esPrestamo
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-emerald-700'
                              }`}
                            >
                              <Handshake size={10} /> Préstamo
                            </button>
                          </div>
                        )}
                        {(() => {
                          const esExterno = it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-') || String(it.codigoSnap).startsWith('EXT')
                          return !esExterno && it.cantidad > getStockHelper(it.productoId, productos)
                        })() && (
                          <div className="flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200 mt-0.5 w-fit">
                            <AlertCircle size={10} /> Stock insuficiente ({getStockHelper(it.productoId, productos)} disp.)
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] font-black text-slate-800 shrink-0">{fmtUsd(linea)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">{fmtUsd(it.precioUnitUsd)}</span>
                      <div className="flex items-center bg-slate-50 rounded-lg border border-slate-100 overflow-hidden ml-auto">
                        <button type="button"
                          onClick={() => it.cantidad <= 1 ? quitarItem(it.productoId) : cambiarCantidad(it.productoId, -1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90">
                          <Minus size={12} strokeWidth={3} />
                        </button>
                        <button type="button"
                          onClick={() => setEditQty({ productoId: it.productoId, nombre: it.nombreSnap, cantidad: it.cantidad, stock: null })}
                          className="w-8 h-7 text-center text-[12px] font-black text-slate-700 bg-white border-x border-slate-100 leading-7 active:bg-sky-50 active:border-sky-300">
                          {it.cantidad}
                        </button>
                        <button type="button"
                          onClick={() => cambiarCantidad(it.productoId, 1)}
                          className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90">
                          <Plus size={12} strokeWidth={3} />
                        </button>
                      </div>
                      {it.origen === 'externo' && (
                        <button type="button" onClick={() => { setSheetOpen(false); setEditItemIdx(items.findIndex(x => x.productoId === it.productoId)) }}
                          className="w-7 h-7 rounded-md bg-amber-50 hover:bg-amber-100 flex items-center justify-center shrink-0 transition-colors active:scale-95 border border-amber-200">
                          <Edit2 size={11} className="text-amber-600" />
                        </button>
                      )}
                      <button type="button" onClick={() => quitarItem(it.productoId)}
                        className="w-7 h-7 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors active:scale-95">
                        <Trash2 size={12} className="text-red-400" />
                      </button>
                    </div>
                    {preciosMap[it.productoId] && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {[{ label: 'Detal', value: preciosMap[it.productoId].p1 }, { label: 'Mayor', value: preciosMap[it.productoId].p2 }, { label: 'Especial', value: preciosMap[it.productoId].p3 }]
                          .filter(n => n.value != null && Number(n.value) > 0)
                          .map(n => {
                            const valConMarkup = aplicarMarkup(Number(n.value))
                            const active = Math.abs(Number(it.precioUnitUsd) - valConMarkup) < 0.001
                            return (
                              <button key={n.label} type="button"
                                onClick={() => cambiarPrecio(it.productoId, valConMarkup)}
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border transition-colors ${
                                  active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200 hover:border-primary/40'
                                }`}
                                title={esExterno ? `Base: ${fmtUsd(n.value)}` : undefined}>
                                {n.label} {fmtUsd(valConMarkup)}
                              </button>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Footer */}
            <div className="border-t border-slate-200 p-3 pb-6 space-y-2 bg-white">
              {clienteSeleccionado?.tipo_cliente === 'personal' && (
                <p className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                  * Descuento automático de personal ({config?.descuento_personal_pct ?? 10}%) se aplicará en el total.
                </p>
              )}
              <div className="space-y-1.5 px-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Subtotal</span>
                  <span>{fmtUsd(subtotal)}</span>
                </div>
                {clienteSeleccionado?.tipo_cliente === 'personal' && (
                  <div className="flex justify-between text-xs text-amber-700 font-medium">
                    <span>Descuento Personal ({config?.descuento_personal_pct ?? 10}%)</span>
                    <span>-{fmtUsd(descuentoMonto)}</span>
                  </div>
                )}
                <div className="flex justify-between items-end border-t border-slate-100 pt-1.5">
                  <div>
                    <span className="text-[12px] font-black text-slate-600 uppercase tracking-wider">Total</span>
                    {tasa > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(totalBs)}</p>}
                  </div>
                  <span className="text-xl font-black text-slate-800">{fmtUsd(totalUsd)}</span>
                </div>
              </div>
              <button type="button"
                onClick={() => { setSheetOpen(false); if (step1Valid) onSiguiente() }}
                disabled={!step1Valid}
                className="w-full flex items-center justify-center gap-2 py-3 text-white font-bold text-sm rounded-xl transition-all active:scale-[0.98] shadow-lg disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                Siguiente <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* ── Fin lg:hidden ── */}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Pago y Envío
// ─────────────────────────────────────────────────────────────────────────────
function Step2Pago({
  pagosInmediatos, togglePagoInmediato, setMontoPagoInmediato, updatePagoInmediato, resetPagosInmediatos,
  propuestaCod, togglePropuestaCod, setMontoPropuestaCod, updatePropuestaCod, resetPropuestaCod,
  totalInmediato, totalPropuestaCod, montoCodRequerido,
  pagoInmediatoCuadrado, propuestaCodCuadrado,
  totalParaPago, comisionEstimada, items = [],
  referenciaPago, setReferenciaPago,
  transportistas, transportistaId, setTransportistaId,
  fleteUsd, setFleteUsd, corteUsd, setCorteUsd, notas, setNotas,
  tasa, esCod, setEsCod,
  clienteSeleccionado,
  esPrestamoPuro,
  direccionEnvioActiva, setDireccionEnvioActiva,
  direccionEnvioEstado, setDireccionEnvioEstado,
  direccionEnvioCiudad, setDireccionEnvioCiudad,
  direccionEnvioDireccion, setDireccionEnvioDireccion,
  saldoFavorOrigen,
  vueltoComoSaldoFavor, setVueltoComoSaldoFavor,
  pagosInmediatosHayVuelto, pagosInmediatosDiferencia,
  config, subtotal, descuentoMonto
}) {
  const esPersonal = clienteSeleccionado?.tipo_cliente === 'personal'
  const descPct = config?.descuento_personal_pct ?? 10.00

  const [showNuevoTransp, setShowNuevoTransp] = useState(false)
  const crearTransp = useCrearTransportista()
  const [transpError, setTranspError] = useState('')

  const perfil = useAuthStore(s => s.perfil)
  const esVendedorSinComision = 
    clienteSeleccionado?.vendedor?.rol === 'vendedor_sin_comision' ||
    (clienteSeleccionado?.vendedor_id === perfil?.id && perfil?.rol === 'vendedor_sin_comision');

  const totalConFlete = totalParaPago + Math.max(0, Number(fleteUsd) || 0)

  const handleTogglePagoInmediato = (metodo) => {
    if (metodo === 'Saldo a Favor') {
      const active = pagosInmediatos.some(f => f.metodo === 'Saldo a Favor')
      if (!active) {
        togglePagoInmediato('Saldo a Favor')
        setTimeout(() => {
          const available = Number(clienteSeleccionado?.saldo_a_favor || 0)
          const actualAsignado = pagosInmediatos.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
          const restante = totalConFlete - actualAsignado
          const montoInicial = Math.min(restante > 0 ? restante : 0, available)
          updatePagoInmediato('Saldo a Favor', {
            monto: Number(montoInicial.toFixed(2)) || '',
            forma_pago_origen: saldoFavorOrigen || 'Crédito'
          })
        }, 50)
        return
      }
    }
    togglePagoInmediato(metodo)
  }

  const handleSetMontoPagoInmediato = (metodo, val) => {
    if (metodo === 'Saldo a Favor') {
      const maxVal = Number(clienteSeleccionado?.saldo_a_favor || 0)
      let numVal = Number(val)
      if (numVal > maxVal) {
        val = String(maxVal)
      }
    }
    if (metodo === 'Cta por cobrar') {
      const sumOthers = pagosInmediatos
        .filter(p => p.metodo !== 'Cta por cobrar')
        .reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
      const maxVal = Math.max(0, totalConFlete - sumOthers)
      let numVal = Number(val)
      if (numVal > maxVal) {
        val = String(maxVal)
      }
    }
    setMontoPagoInmediato(metodo, val)
  }

  async function handleCrearTransportista(campos) {
    setTranspError('')
    try {
      const nuevo = await crearTransp.mutateAsync(campos)
      const idNuevo = nuevo.transportista?.id || nuevo.id
      if (idNuevo) setTransportistaId(idNuevo)
      setShowNuevoTransp(false)
      showToast('Transportista creado y seleccionado', 'success')
    } catch (e) {
      setTranspError(e.message ?? 'Error al crear transportista')
    }
  }

  return (
    <div className="p-4 pb-20 md:pb-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">

      {/* ── 1. Transportista + Flete (primera fila completa) ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-0">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Transportista (opcional)</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <CustomSelect 
                value={transportistaId} 
                onChange={v => { setTransportistaId(v); if (!v) setFleteUsd(''); }} 
                placeholder="— Sin transportista —" 
                clearable 
                icon={Truck}
                showSubInTrigger={false}
                options={transportistas.map(t => ({ 
                  value: t.id, 
                  label: `${t.nombre}${t.rif ? ` (${t.rif})` : ''}`,
                  selectedLabel: t.nombre,
                  sub: [t.vehiculo, t.placa_chuto ? `Placas: ${t.placa_chuto}${t.placa_batea ? `/${t.placa_batea}` : ''}` : '', t.color].filter(Boolean).join(' · ') || undefined
                }))} 
              />
            </div>
            <button type="button" onClick={() => setShowNuevoTransp(!showNuevoTransp)}
              className="shrink-0 w-10 h-10 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 flex items-center justify-center transition-colors active:scale-95" title="Crear nuevo transportista">
              <Plus size={16} className="text-sky-600" />
            </button>
          </div>
        </div>
        {transportistaId && (
          <div className="sm:w-48 shrink-0">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Monto del flete (USD)</label>
            <input type="text" inputMode="decimal" value={fleteUsd}
              onChange={e => { const v = e.target.value; if (/^[0-9]*[.,]?[0-9]*$/.test(v)) setFleteUsd(v) }}
              placeholder="0.00" className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
          </div>
        )}
      </div>

      {/* Modal crear transportista */}
      {showNuevoTransp && (
        <div className="fixed inset-0 z-[110] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Truck size={16} className="text-sky-500" />Nuevo transportista</h3>
              <button onClick={() => { setShowNuevoTransp(false); setTranspError('') }} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="p-4 pb-24">
              {transpError && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700 mb-3">{transpError}</div>}
              <TransportistaFormCompact onGuardar={handleCrearTransportista} onCancelar={() => { setShowNuevoTransp(false); setTranspError('') }} cargando={crearTransp.isPending} />
            </div>
          </div>
        </div>
      )}

      {/* ── 2. Formas de pago (izq) + Resumen + Notas (der) ── */}
      <div className="flex flex-col lg:flex-row lg:gap-6">
        {/* Columna izquierda: Formas de pago */}
        <div className="flex-1 min-w-0">
          {esPrestamoPuro ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-4 max-w-md mx-auto shadow-sm animate-in zoom-in-95 duration-200 my-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100/80 flex items-center justify-center text-emerald-600 shadow-inner">
                <Handshake size={32} />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-base font-black text-emerald-800">Préstamo de Material</h4>
                <p className="text-xs text-emerald-600 font-semibold leading-relaxed">
                  Esta transacción es de tipo <strong>Préstamo Puro</strong> (monto financiero de referencia $0.00). Los productos saldrán del stock físico y se registrarán en la ficha de control del cliente para su posterior retorno o facturación.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100/60 text-emerald-800 font-bold rounded-xl text-xs border border-emerald-200">
                <CheckCircle size={14} className="text-emerald-600" /> Transacción validada
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2">
              {/* Toggle Cobro a destino (COD) */}
              <div className="mb-4 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm max-w-md">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-rose-100 text-rose-600">
                    <Truck size={16} />
                  </span>
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">¿Cobro a destino (COD)?</span>
                    <span className="text-[10px] text-slate-400">El cliente pagará al recibir la mercancía</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={setEsCod}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    esCod ? 'bg-rose-500' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      esCod ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* SECCIÓN 1: PAGO INMEDIATO (ADELANTO) */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  {esCod ? 'Pago Inmediato (Adelanto / Seña)' : 'Formas de pago *'}
                </label>

                {/* Métodos activos — fila con monto inline */}
                <div className="space-y-2">
                  {pagosInmediatos.map(fp => {
                    const restante = totalConFlete - totalInmediato - totalPropuestaCod
                    return (
                      <div key={fp.metodo} className="space-y-2">
                        <div className="flex items-center gap-2 bg-sky-50 border border-sky-300 rounded-xl px-3 py-2">
                          <span className="text-sm font-bold text-sky-700 w-32 shrink-0 truncate">
                            {fp.metodo === 'Saldo a Favor'
                              ? `Saldo a Favor (${(fp.forma_pago_origen || 'Crédito').toUpperCase()})`
                              : fp.metodo}
                          </span>
                          <div className="relative flex-1 flex items-center">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">$</span>
                            <input
                              type="number" min="0" step="0.01"
                              value={fp.monto}
                              onChange={e => handleSetMontoPagoInmediato(fp.metodo, e.target.value)}
                              onFocus={e => e.target.select()}
                              placeholder="0.00"
                              className="w-full pl-6 pr-2 py-1.5 rounded-lg text-sm font-semibold border border-sky-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 text-slate-800"
                            />
                            {restante > 0.01 && (
                              <button type="button"
                                onClick={() => {
                                  let amountToAssign = (Number(fp.monto) || 0) + restante
                                  if (fp.metodo === 'Saldo a Favor') {
                                    const available = Number(clienteSeleccionado?.saldo_a_favor || 0)
                                    if (amountToAssign > available) {
                                      amountToAssign = available
                                    }
                                  }
                                  handleSetMontoPagoInmediato(fp.metodo, Number(amountToAssign.toFixed(2)))
                                }}
                                className="ml-1.5 px-2 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors shrink-0"
                                title={`Completar con $${restante.toFixed(2)} restante`}>
                                Restante
                              </button>
                            )}
                          </div>
                          <button type="button" onClick={() => handleTogglePagoInmediato(fp.metodo)}
                            className="p-1 rounded-lg hover:bg-sky-100 text-sky-400 hover:text-sky-600 transition-colors shrink-0">
                            <X size={14} />
                          </button>
                        </div>

                        {/* Opción de días de vencimiento para CxC */}
                        {fp.metodo === 'Cta por cobrar' && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50/50 border border-amber-200/50 rounded-lg ml-6">
                            <Clock size={12} className="text-amber-500 shrink-0" />
                            <span className="text-[11px] font-medium text-amber-700 whitespace-nowrap">
                              Días de vencimiento (obligatorio) *:
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={fp.diasVencimiento ?? ''}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === '' || /^[0-9]+$/.test(val)) {
                                  updatePagoInmediato(fp.metodo, { diasVencimiento: val ? parseInt(val, 10) : null });
                                }
                              }}
                              placeholder="Obligatorio"
                              className="w-20 px-2 py-1 rounded border border-amber-200 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 text-slate-800 text-center font-bold text-xs"
                            />
                          </div>
                        )}

                        {/* Opción de Referencia para Transferencia y Pago Móvil */}
                        {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(fp.metodo) && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50/50 border border-teal-200/50 rounded-lg ml-6">
                            <span className="text-[11px] font-semibold text-teal-700 whitespace-nowrap">
                              Referencia (opcional):
                            </span>
                            <input
                              type="text"
                              value={fp.referencia ?? ''}
                              onChange={e => updatePagoInmediato(fp.metodo, { referencia: e.target.value })}
                              placeholder="Ej: 12345"
                              className="flex-1 px-2.5 py-1 rounded border border-teal-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300 text-slate-800 text-xs font-medium"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Chips para agregar métodos de pago inmediato */}
                <div className="flex flex-wrap gap-2">
                  {/* Chip especial para Saldo a Favor */}
                  {Number(clienteSeleccionado?.saldo_a_favor || 0) > 0 && !pagosInmediatos.some(f => f.metodo === 'Saldo a Favor') && (
                    <button
                      type="button"
                      onClick={() => handleTogglePagoInmediato('Saldo a Favor')}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-black border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-all duration-200 shadow-sm active:scale-95 flex items-center gap-1"
                    >
                      <DollarSign size={13} />
                      Saldo a Favor (${Number(clienteSeleccionado.saldo_a_favor).toFixed(2)})
                    </button>
                  )}

                  {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && (m !== 'Donación' || perfil?.rol !== 'vendedor'))
                    .filter(m => m !== 'Saldo a Favor')
                    .filter(m => !pagosInmediatos.some(f => f.metodo === m))
                    .map(m => (
                      <button key={m} type="button" onClick={() => handleTogglePagoInmediato(m)}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600 transition-all duration-200 shadow-sm active:scale-95">
                        {m}
                      </button>
                    ))}
                </div>

                {esCod && pagosInmediatos.length === 0 && (
                  <p className="text-xs text-slate-400 italic">No se registraron adelantos inmediatos.</p>
                )}

                {/* Banner de Vuelto / Excedente a Saldo a Favor */}
                {pagosInmediatosHayVuelto && (
                  <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200">
                    <div className="flex items-start gap-2.5">
                      <span className="p-1.5 rounded-lg bg-indigo-100 text-indigo-600 shrink-0 mt-0.5">
                        <DollarSign size={16} />
                      </span>
                      <div>
                        <span className="text-xs font-black text-indigo-900 block">
                          El pago supera el total por ${pagosInmediatosDiferencia.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-indigo-600 font-bold leading-normal">
                          ¿Qué deseas hacer con la diferencia? {tasa > 0 && `(Equivale a ${fmtBs(pagosInmediatosDiferencia * tasa)})`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
                      <span className="text-[11px] font-bold text-slate-500">Vuelto Físico</span>
                      <button
                        type="button"
                        onClick={() => setVueltoComoSaldoFavor(!vueltoComoSaldoFavor)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          vueltoComoSaldoFavor ? 'bg-indigo-600' : 'bg-slate-200'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            vueltoComoSaldoFavor ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span className="text-[11px] font-black text-indigo-700">Saldo a Favor</span>
                    </div>
                  </div>
                )}
              </div>

              {/* SECCIÓN 2: PAGO AL RECIBIR (COD) */}
              {esCod && (
                <div className="mt-5 p-4 bg-rose-50/40 border border-rose-200/50 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between text-xs font-bold text-rose-800">
                    <span>Monto a cobrar al recibir:</span>
                    <span className="text-sm font-black text-rose-600">${montoCodRequerido.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  {montoCodRequerido > 0.015 ? (
                    <div className="space-y-3 border-t border-rose-100/50 pt-3">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                        ¿Cómo pagará al recibir? (Propuesta) *
                      </label>

                      {/* Métodos propuestos activos */}
                      <div className="space-y-2">
                        {propuestaCod.map(fp => {
                          const restanteCod = Math.max(0, round2(montoCodRequerido - totalPropuestaCod))
                          return (
                            <div key={fp.metodo} className="space-y-2">
                              <div className="flex items-center gap-2 bg-rose-50/60 border border-rose-200/80 rounded-xl px-3 py-2">
                                <span className="text-sm font-bold text-rose-700 w-32 shrink-0 truncate">{fp.metodo}</span>
                                <div className="relative flex-1 flex items-center">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-rose-405 text-sm font-medium">$</span>
                                  <input
                                    type="number" min="0" step="0.01"
                                    value={fp.monto}
                                    onChange={e => setMontoPropuestaCod(fp.metodo, e.target.value)}
                                    onFocus={e => e.target.select()}
                                    placeholder="0.00"
                                    className="w-full pl-6 pr-2 py-1.5 rounded-lg text-sm font-semibold border border-rose-200 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 text-slate-800"
                                  />
                                  {restanteCod > 0.01 && (
                                    <button type="button"
                                      onClick={() => setMontoPropuestaCod(fp.metodo, Number(((Number(fp.monto) || 0) + restanteCod).toFixed(2)))}
                                      className="ml-1.5 px-2 py-1 text-[10px] font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 rounded-lg transition-colors shrink-0"
                                      title={`Completar con $${restanteCod.toFixed(2)} restante`}>
                                      Restante
                                    </button>
                                  )}
                                </div>
                                <button type="button" onClick={() => togglePropuestaCod(fp.metodo)}
                                  className="p-1 rounded-lg hover:bg-rose-100 text-rose-400 hover:text-rose-600 transition-colors shrink-0">
                                  <X size={14} />
                                </button>
                              </div>
                              {/* Opción de Referencia para Transferencia y Pago Móvil (COD) */}
                              {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(fp.metodo) && (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50/50 border border-rose-200/50 rounded-lg ml-6 mt-1.5">
                                  <span className="text-[11px] font-semibold text-rose-700 whitespace-nowrap">
                                    Referencia (opcional):
                                  </span>
                                  <input
                                    type="text"
                                    value={fp.referencia ?? ''}
                                    onChange={e => updatePropuestaCod(fp.metodo, { referencia: e.target.value })}
                                    placeholder="Ej: 12345"
                                    className="flex-1 px-2.5 py-1 rounded border border-rose-200 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 text-slate-800 text-xs font-medium"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Chips de propuestaCod */}
                      {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && m !== 'Cta por cobrar' && m !== 'Donación')
                        .some(m => !propuestaCod.some(f => f.metodo === m)) && (
                        <div className="flex flex-wrap gap-2">
                          {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && m !== 'Cta por cobrar' && m !== 'Donación')
                            .filter(m => !propuestaCod.some(f => f.metodo === m))
                            .map(m => (
                              <button key={m} type="button" onClick={() => togglePropuestaCod(m)}
                                className="px-3.5 py-1.5 rounded-xl text-xs font-bold border border-rose-200 bg-white text-rose-600 hover:border-rose-300 hover:text-rose-700 transition-all duration-200 shadow-sm active:scale-95">
                                {m}
                              </button>
                            ))}
                        </div>
                      )}

                      {/* Validador de propuesta COD */}
                      <div className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold border ${
                        propuestaCodCuadrado
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : (totalPropuestaCod - montoCodRequerido > 0.02)
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                      <span>Asignado COD: ${totalPropuestaCod.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      {propuestaCodCuadrado ? (
                        <CheckCircle size={16} className="text-emerald-500" />
                      ) : (totalPropuestaCod - montoCodRequerido > 0.02) ? (
                        <span className="text-xs font-bold text-amber-600">Sobran ${(totalPropuestaCod - montoCodRequerido).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      ) : (
                        <span className="text-xs font-bold text-rose-600">Faltan ${Math.abs(totalPropuestaCod - montoCodRequerido).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 font-medium bg-amber-50 border border-amber-200 p-2.5 rounded-xl">
                    El monto asignado en pagos inmediatos ya cubre el total.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Banner de total general (Inmediato + COD) */}
          <div className="mt-4">
            {!esCod ? (
              pagosInmediatos.length > 0 && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold border ${
                  pagoInmediatoCuadrado
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : (totalInmediato - totalConFlete > 0.02)
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                  <span>Asignado: ${totalInmediato.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span>Total: ${totalConFlete.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  {pagoInmediatoCuadrado ? (
                    <CheckCircle size={16} className="text-emerald-500" />
                  ) : (totalInmediato - totalConFlete > 0.02) ? (
                    <span className="text-xs font-bold text-amber-600">Sobran ${(totalInmediato - totalConFlete).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  ) : (
                    <span className="text-xs font-bold text-red-600">Faltan ${Math.abs(totalInmediato - totalConFlete).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  )}
                </div>
              )
            ) : (
              /* En caso de COD, mostramos un resumen global consolidado */
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl flex items-center justify-between text-xs font-semibold text-slate-700">
                <div className="flex flex-col gap-0.5">
                  <span>Adelanto: <b className="text-slate-900">${totalInmediato.toFixed(2)}</b></span>
                  <span>Al recibir (COD): <b className="text-rose-600">${montoCodRequerido.toFixed(2)}</b></span>
                </div>
                <div className="text-right">
                  <span className="block text-slate-500 font-medium">Total Despacho</span>
                  <span className="text-sm font-extrabold text-slate-900">${totalConFlete.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>{/* Fin columna izquierda */}

      {/* ── Columna derecha: Resumen + Notas ── */}
      <div className="lg:w-80 xl:w-96 shrink-0 flex flex-col gap-4">
        
        {/* Lista de productos (Resumen) */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            Artículos ({items.length})
          </h3>
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
            {items.map(it => (
              <div key={it.productoId || it._key} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <span className="text-slate-700 block font-medium truncate">
                    {it.nombreSnap}
                    {it.esPrestamo && (
                      <span className="inline-flex items-center gap-1 ml-1 align-middle text-[8px] uppercase font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                        <Handshake size={10} /> Préstamo
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-slate-400">{it.cantidad} × {fmtUsd(it.precioUnitUsd)}</span>
                </div>
                <span className="font-bold text-slate-700 shrink-0 ml-2">{fmtUsd(it.esPrestamo ? 0 : it.cantidad * it.precioUnitUsd)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Resumen de totales */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm mb-[-8px]">
          <div className="space-y-2 text-[15px]">
            <div className="flex justify-between items-center text-slate-500">
              <span>Subtotal</span>
              <span className="text-slate-700">${(esPersonal ? subtotal : (totalParaPago - Math.max(0, Number(corteUsd) || 0))).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            {esPersonal && (
              <div className="flex justify-between items-center text-amber-700 font-medium">
                <span>Descuento Personal ({descPct}%)</span>
                <span>-${descuentoMonto.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
          {Number(fleteUsd) > 0 && (
            <div className="flex justify-between items-center text-slate-500">
              <span>Flete</span>
              <span className="text-slate-700">${Number(fleteUsd).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
          {Number(corteUsd) > 0 && (
            <div className="flex justify-between items-center text-slate-500">
              <span>Corte</span>
              <span className="text-slate-700">${Number(corteUsd).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="pt-3 pb-1 mt-2 border-t border-slate-100 flex justify-between items-end">
            <span className="text-[17px] font-bold text-slate-800">Total</span>
            <div className="text-right">
              <span className="text-2xl font-bold tracking-tight text-slate-900">${(totalParaPago + Math.max(0, Number(fleteUsd) || 0)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              {tasa > 0 && (
                <p className="text-[13px] text-slate-400 font-medium mt-0.5">≈ Bs {((totalParaPago + Math.max(0, Number(fleteUsd) || 0)) * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              )}
            </div>
          </div>

          {comisionEstimada && comisionEstimada.monto > 0 && (
            <div className="mt-1 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-emerald-600 font-semibold">
                  Comisión est. {comisionEstimada.mixto ? '(tasas mixtas)' : comisionEstimada.pct ? `(${comisionEstimada.pct}%)` : ''}
                </span>
                <span className="text-xs font-bold text-emerald-600">
                  ${comisionEstimada.monto.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {comisionEstimada.detalle.length > 1 && (
                <div className="text-[10px] text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
                  {comisionEstimada.detalle.map(d => (
                    <span key={d.cat} className="capitalize">{d.cat}: {d.pct}%</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FEATURE_CORTE_HIDDEN */}

      {/* FEATURE_CORTE_HIDDEN: Oculto temporalmente a petición del usuario. Cambiar a true para reactivar. */}
      {false && (
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
          Monto del corte (USD)
        </label>
        <input type="text" inputMode="decimal" value={corteUsd} onChange={e => { const v = e.target.value; if (/^[0-9]*[.,]?[0-9]*$/.test(v)) setCorteUsd(v) }}
          placeholder="0.00"
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
      </div>
      )}

      {/* Dirección de Envío Opcional */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-sky-100 text-sky-600">
              <MapPin size={16} />
            </span>
            <div>
              <span className="text-xs font-bold text-slate-700 block">¿Enviar a otra dirección?</span>
              <span className="text-[10px] text-slate-400">Especificar dirección alternativa de entrega</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDireccionEnvioActiva(!direccionEnvioActiva)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              direccionEnvioActiva ? 'bg-sky-500' : 'bg-slate-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                direccionEnvioActiva ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {direccionEnvioActiva && (
          <div className="space-y-3 border-t border-slate-200/60 pt-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Estado *</label>
                <CustomSelect
                  options={ESTADOS.map(e => ({ value: e, label: e }))}
                  value={direccionEnvioEstado}
                  onChange={val => {
                    setDireccionEnvioEstado(val)
                    setDireccionEnvioCiudad('')
                  }}
                  placeholder="Seleccionar..."
                  icon={MapPin}
                  searchable
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Ciudad *</label>
                <CustomSelect
                  options={(direccionEnvioEstado ? getCiudades(direccionEnvioEstado) : []).map(c => ({ value: c, label: c }))}
                  value={direccionEnvioCiudad}
                  onChange={setDireccionEnvioCiudad}
                  placeholder={direccionEnvioEstado ? 'Seleccionar...' : 'Elige estado'}
                  icon={Building}
                  disabled={!direccionEnvioEstado}
                  searchable
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Dirección (Opcional)</label>
              <input
                type="text"
                value={direccionEnvioDireccion}
                onChange={e => setDireccionEnvioDireccion(e.target.value)}
                placeholder="Ej: Av. Principal, Local 4..."
                className="w-full px-3 py-2 rounded-xl text-xs border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
          </div>
        )}
      </div>

      {/* Notas */}
      <div className="flex flex-col flex-1 min-h-0">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
          Notas (opcional)
        </label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
          placeholder="Observaciones internas..."
          className="flex-1 min-h-[80px] w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none resize-none" />
      </div>
      </div>{/* ── Fin columna derecha ── */}
      </div>{/* ── Fin flex row ── */}
    </div>
  )
}

// Helpers RIF centralizados en src/utils/rif.js


// ─────────────────────────────────────────────────────────────────────────────
// Formulario compacto para crear transportista inline
// ─────────────────────────────────────────────────────────────────────────────
function TransportistaFormCompact({ onGuardar, onCancelar, cargando }) {
  const [rifPrefijo, setRifPrefijo] = useState('V')
  const [rifNumero, setRifNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState('')
  const [vehiculo, setVehiculo] = useState('')
  const [placaChuto, setPlacaChuto] = useState('')
  const [placaBatea, setPlacaBatea] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    onGuardar({
      nombre,
      rif: formatearRifVR(rifPrefijo, rifNumero),
      color,
      vehiculo,
      placa_chuto: placaChuto,
      placa_batea: placaBatea,
    })
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Nombre *</label>
          <input value={nombre} onChange={e => { setNombre(e.target.value.replace(/(^|\s)\S/g, c => c.toUpperCase())); setError('') }}
            placeholder="Nombre del transportista" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Cédula / RIF</label>
          <div className="flex gap-1 mb-1">
            {PREFIJOS_RIF.map(p => (
              <button key={p} type="button" disabled={cargando}
                onClick={() => setRifPrefijo(p)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                  rifPrefijo === p ? 'bg-sky-500 text-white shadow-sm scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                } disabled:opacity-50`}>
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <span className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 select-none h-[42px]">
              {rifPrefijo}{rifPrefijo !== 'V' ? '-' : ''}
            </span>
            <input value={rifNumero} onChange={e => {
              if (rifPrefijo === 'V') {
                setRifNumero(e.target.value.replace(/\D/g, '').slice(0, 9))
              } else {
                const val = e.target.value.replace(/[^\d-]/g, '')
                if (val.replace(/-/g, '').length > 10) return
                setRifNumero(val)
              }
            }}
              placeholder={rifPrefijo === 'V' ? '24457713' : '30123456-7'}
              className={`${inputCls} !rounded-l-none`} disabled={cargando} inputMode="numeric" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Color</label>
          <input value={color} onChange={e => setColor(e.target.value)}
            placeholder="Ej: Rojo, Blanco" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Vehículo</label>
          <input value={vehiculo} onChange={e => setVehiculo(e.target.value)}
            placeholder="Ej: Mack Granite 2020" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa chuto</label>
          <input value={placaChuto} onChange={e => setPlacaChuto(e.target.value.toUpperCase())}
            placeholder="Ej: AB123CD" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa batea</label>
          <input value={placaBatea} onChange={e => setPlacaBatea(e.target.value.toUpperCase())}
            placeholder="Ej: XY456ZW" className={inputCls} disabled={cargando} />
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-3 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-colors disabled:opacity-50">
          {cargando ? 'Creando...' : 'Crear transportista'}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Confirmar
// ─────────────────────────────────────────────────────────────────────────────
function Step3Confirmar({
  clienteSeleccionado, items, subtotal, totalUsd, flete, corte, totalConFlete,
  totalBs, tasa, formasPago, referenciaPago, transportistaSeleccionado, notas,
  esCod, config,
}) {
  const esPersonal = clienteSeleccionado?.tipo_cliente === 'personal'
  const descPct = config?.descuento_personal_pct ?? 10.00
  const descuentoMonto = esPersonal ? round2(subtotal * (descPct / 100)) : 0

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-4 p-4 pb-28 lg:pb-4 overflow-y-auto">
      {/* ── Columna izquierda: Cliente + Productos ── */}
      <div className="min-w-0 flex flex-col gap-3 lg:flex-1">
        {/* Cliente */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 shrink-0">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cliente</h3>
          <div className="flex items-center gap-2">
            <User size={14} className="text-slate-400" />
            <span className="font-medium text-sm text-slate-800">{clienteSeleccionado?.nombre}</span>
            {clienteSeleccionado?.tipo_cliente === 'personal' && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                Personal ({config?.descuento_personal_pct ?? 10}%)
              </span>
            )}
          </div>
          {clienteSeleccionado?.direccion && (
            <p className="text-xs text-slate-400 mt-0.5 ml-5">{clienteSeleccionado.direccion}</p>
          )}
        </div>

        {/* Items */}
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Productos ({items.length})
          </h3>
          <div className="space-y-1.5 max-h-60 lg:max-h-none overflow-y-auto">
            {items.map(it => (
              <div key={it.productoId} className="flex items-center justify-between text-sm py-1">
                <div className="flex-1 min-w-0">
                  <span className="text-slate-700 block text-sm">
                    {it.nombreSnap}
                    {it.esPrestamo && (
                      <span className="inline-flex items-center gap-1 ml-1 align-middle text-[8px] uppercase font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                        <Handshake size={10} /> Préstamo
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-400">{it.cantidad} × {fmtUsd(it.precioUnitUsd)}</span>
                </div>
                <span className="font-semibold text-slate-800 shrink-0 ml-2">{fmtUsd(it.esPrestamo ? 0 : round2(it.cantidad * it.precioUnitUsd))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Columna derecha: Totales + Pago + Transporte + Notas ── */}
      <div className="lg:w-72 xl:w-80 shrink-0 flex flex-col gap-3 mt-3 lg:mt-0">
        {/* Totales */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="text-slate-700">{fmtUsd(subtotal)}</span>
          </div>
          {esPersonal && (
            <div className="flex justify-between text-sm text-amber-700 font-medium">
              <span>Descuento Personal ({config?.descuento_personal_pct ?? 10}%)</span>
              <span>-{fmtUsd(descuentoMonto)}</span>
            </div>
          )}
          {flete > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Flete</span>
              <span className="text-slate-700">{fmtUsd(flete)}</span>
            </div>
          )}
          {corte > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Corte</span>
              <span className="text-slate-700">{fmtUsd(corte)}</span>
            </div>
          )}
          <div className="border-t border-slate-100 pt-1.5 flex justify-between items-end">
            <span className="font-semibold text-slate-800">Total</span>
            <div className="text-right">
              <p className="font-bold text-lg text-slate-800">{fmtUsd(totalConFlete)}</p>
              {tasa > 0 && <p className="text-xs text-slate-400">≈ {fmtBs(totalBs)}</p>}
            </div>
          </div>
        </div>

        {/* Pago */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pago</h3>
            {esCod && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                Cobro a destino (COD)
              </span>
            )}
          </div>
          {formasPago.map(fp => (
            <div key={fp.metodo} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <CreditCard size={12} className="text-slate-400" />
                <span className="text-slate-700">{fp.metodo}</span>
                {fp.metodo === 'Cta por cobrar' && fp.diasVencimiento && (
                  <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded ml-1 border border-amber-200">
                    {fp.diasVencimiento} días
                  </span>
                )}
              </div>
              <span className="font-semibold text-slate-800">{fmtUsd(Number(fp.monto) || 0)}</span>
            </div>
          ))}
        </div>

        {/* Transportista */}
        {transportistaSeleccionado && (
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Transporte</h3>
            <div className="flex items-center gap-2 text-sm">
              <Truck size={12} className="text-slate-400" />
              <span className="text-slate-700">{transportistaSeleccionado.nombre}</span>
              {transportistaSeleccionado.vehiculo && (
                <span className="text-xs text-slate-400">— {transportistaSeleccionado.vehiculo}</span>
              )}
            </div>
          </div>
        )}

        {/* Notas */}
        {notas && (
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notas</h3>
            <p className="text-sm text-slate-600">{notas}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ModalEditarExterno({ isOpen, item, onClose, onSave, idx }) {
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [precio, setPrecio] = useState('')
  const [unidad, setUnidad] = useState('')

  useEffect(() => {
    if (item && isOpen) {
      setNombre(item.nombreSnap || '')
      setCodigo(item.codigoSnap || '')
      setPrecio(item.precioUnitUsd || '')
      setUnidad(item.unidadSnap || '')
    }
  }, [item, isOpen])

  if (!isOpen || !item) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-5 space-y-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
            <Edit2 size={16} className="text-amber-500" /> Editar producto externo
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nombre del producto</label>
            <input 
              type="text" 
              value={nombre} 
              onChange={e => setNombre(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Código</label>
              <input 
                type="text" 
                value={codigo} 
                onChange={e => setCodigo(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unidad</label>
              <input 
                type="text" 
                value={unidad} 
                onChange={e => setUnidad(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Precio Unitario (USD)</label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="number" 
                step="0.01"
                value={precio} 
                onChange={e => setPrecio(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none font-bold text-slate-700"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">
            Cancelar
          </button>
          <button 
            onClick={() => onSave(idx, { nombreSnap: nombre, codigoSnap: codigo, precioUnitUsd: Number(precio), unidadSnap: unidad })}
            className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 active:scale-95 transition-all"
          >
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  )
}
