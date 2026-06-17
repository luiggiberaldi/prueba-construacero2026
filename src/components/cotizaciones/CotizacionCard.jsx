// src/components/cotizaciones/CotizacionCard.jsx
import { useState, useRef, memo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, User, Calendar, Pencil, Ban, XCircle, FileDown, MessageCircle, Loader2, Truck, ChevronDown, DollarSign, RefreshCw, Eye, Clock, PackageCheck, MoreHorizontal, MoreVertical, AlertTriangle, Printer, Check, Download, Mail } from 'lucide-react'
import EstadoBadge from './EstadoBadge'

import useAuthStore from '../../store/useAuthStore'
import supabase from '../../services/supabase/client'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtFechaHora, fmtBs, usdToBs } from '../../utils/format'
import { getAction, PRIMARY_ACTION_COLORS } from '../../utils/cotizacionActions'
import { apiUrl } from '../../services/apiBase'
import DetalleModal from '../ui/DetalleModal'
import { showToast } from '../ui/Toast'

// Helper: fetch cliente via Worker API (bypasses RLS)
async function fetchClienteViaAPI(clienteId) {
  if (!clienteId) return null
  try {
    const session = (await supabase.auth.getSession()).data.session
    const res = await fetch(apiUrl('/api/clientes/lookup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ ids: [clienteId] }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const clienteRaw = data?.[0] ?? null
    
    // Si el cliente tiene vendedor pero no tiene teléfono en el objeto anidado, lo hidratamos
    const vId = clienteRaw?.vendedor_id || clienteRaw?.vendedor?.id
    if (vId && !clienteRaw?.vendedor?.telefono) {
      const { data: vData } = await supabase
        .from('usuarios')
        .select('id, nombre, color, telefono, rol, markup_pct, es_externo')
        .eq('id', vId)
        .maybeSingle()
      if (vData) clienteRaw.vendedor = vData
    }
    return clienteRaw
  } catch { return null }
}

export default memo(function CotizacionCard({ cotizacion, onEditar, onAnular, onCambiarEstado, onDespachar, onReciclar, onClonar, onCambiarEstadoDespacho, tasa = 0 }) {
  const navigate = useNavigate()
  const { perfil } = useAuthStore()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esAdministracion = perfil?.rol === 'administracion'
  const rol = perfil?.rol || 'vendedor'
  const esBorrador = cotizacion.estado === 'borrador'
  const esEnviada  = cotizacion.estado === 'enviada'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [printLoading, setPrintLoading] = useState(false)
  const [waLoading, setWaLoading]     = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showWhatsAppMenu, setShowWhatsAppMenu] = useState(false)
  const [showAdminMenu, setShowAdminMenu] = useState(false)
  const [monedaPdf, setMonedaPdf] = useState(() => localStorage.getItem('listopos_moneda_pdf') || '$')
  const [conIva, setConIva] = useState(() => localStorage.getItem('listopos_con_iva') === 'true')
  const { data: config = {} } = useConfigNegocio()
  const { tasaBcv, tasaUsdt } = useTasaCambio()
  const printBtnRef = useRef(null)
  const downloadBtnRef = useRef(null)
  const whatsappBtnRef = useRef(null)
  const adminBtnRef = useRef(null)

  const numDisplay = `COT-${String(cotizacion.numero).padStart(5, '0')}`

  function seleccionarMoneda(moneda) {
    setMonedaPdf(moneda)
    localStorage.setItem('listopos_moneda_pdf', moneda)
  }

  const MONEDA_OPTIONS = [
    { key: '$', icon: <DollarSign size={14} className="text-emerald-500" />, label: 'USDT ($)' },
    { key: 'bcv', icon: <span className="text-sm font-bold text-teal-500 w-[14px] text-center">$</span>, label: 'Dólar BCV' },
    { key: 'bs', icon: <span className="text-sm font-bold text-blue-500 w-[14px] text-center">Bs</span>, label: 'Bolívares' },
  ]

  const monedaLabel = MONEDA_OPTIONS.find(o => o.key === monedaPdf)?.label || 'USDT ($)'

  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarPDF }, itemsRes, clienteData, vendedorRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacion.id).order('orden'),
        fetchClienteViaAPI(cotizacion.cliente_id),
        cotizacion.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono, markup_pct, es_externo').eq('id', cotizacion.vendedor_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const cotConDatos = {
        ...cotizacion,
        cliente: clienteData || cotizacion.cliente,
        vendedor: vendedorRes.data || cotizacion.vendedor,
      }
      await generarPDF({ cotizacion: cotConDatos, items: itemsRes.data ?? [], config, monedaPDF: monedaPdf, tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio, conIVA: conIva })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  function printOrDownloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob)
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) {
      const w = window.open(url, '_blank')
      if (!w) {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } else {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = 'none'
      iframe.src = url
      document.body.appendChild(iframe)
      iframe.onload = () => {
        try { iframe.contentWindow.print() } catch { window.open(url) }
        setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url) }, 60000)
      }
    }
  }

  async function imprimirCotizacion() {
    setPrintLoading(true)
    try {
      const [{ generarPDF }, itemsRes, clienteData, vendedorRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacion.id).order('orden'),
        fetchClienteViaAPI(cotizacion.cliente_id),
        cotizacion.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono, markup_pct, es_externo').eq('id', cotizacion.vendedor_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const cotConDatos = {
        ...cotizacion,
        cliente: clienteData || cotizacion.cliente,
        vendedor: vendedorRes.data || cotizacion.vendedor,
      }
      const blob = await generarPDF({ cotizacion: cotConDatos, items: itemsRes.data ?? [], config, monedaPDF: monedaPdf, tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio, returnBlob: true, conIVA: conIva })
      printOrDownloadPdf(blob, `${numDisplay.replace(/\s+/g, '_')}.pdf`)
    } catch (err) {
      showToast('Error al imprimir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function handleWhatsApp() {
    setWaLoading(true)
    try {
      const [{ generarPDF }, itemsRes, clienteData, vendedorRes] = await Promise.all([
        import('../../services/pdf/cotizacionPDF'),
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacion.id).order('orden'),
        fetchClienteViaAPI(cotizacion.cliente_id),
        cotizacion.vendedor_id ? supabase.from('usuarios').select('id, nombre, color, telefono, markup_pct, es_externo').eq('id', cotizacion.vendedor_id).single() : Promise.resolve({ data: null }),
      ])
      if (itemsRes.error) throw itemsRes.error
      const cliente = clienteData || cotizacion.cliente
      const vendedor = vendedorRes.data || cotizacion.vendedor
      const cotConDatos = { ...cotizacion, cliente, vendedor }
      const pdfBlob = await generarPDF({ cotizacion: cotConDatos, items: itemsRes.data ?? [], config, returnBlob: true, monedaPDF: monedaPdf, tasa, tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio, conIVA: conIva })
      const totalConIva = conIva 
        ? (cotizacion.total_usd + (cotizacion.subtotal_usd - cotizacion.descuento_usd) * 0.16)
        : cotizacion.total_usd
      const mensajeParams = {
        nombreNegocio: config.nombre_negocio,
        nombreCliente: cliente?.nombre,
        nombreVendedor: vendedor?.nombre,
        numDisplay,
        totalUsd: totalConIva,
        items: itemsRes.data ?? [],
      }
      const mensaje = generarMensaje(mensajeParams)
      await compartirPorWhatsApp({
        pdfBlob,
        pdfFilename: `${numDisplay.replace(/\s+/g, '_')}.pdf`,
        telefono: cliente?.telefono,
        mensaje,
        mensajeParams,
      })
    } catch (err) {
      const totalConIva = conIva 
        ? (cotizacion.total_usd + (cotizacion.subtotal_usd - cotizacion.descuento_usd) * 0.16)
        : cotizacion.total_usd
      const texto = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: cotizacion.cliente?.nombre,
        numDisplay,
        totalUsd: totalConIva,
      })
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
    } finally {
      setWaLoading(false)
    }
  }

  const esVendedorExterno = !!cotizacion.vendedor?.es_externo || (cotizacion.vendedor?.markup_pct != null && Number(cotizacion.vendedor.markup_pct) > 0)
  const vendedorColor = esVendedorExterno ? '#D97706' : (cotizacion.vendedor?.color || '#64748b')
  const despacho = cotizacion.despacho
  const despachoAnulado = despacho?.estado === 'anulada'
  const esPropietario = cotizacion.vendedor_id === perfil?.id
  const canEdit = (esBorrador || esEnviada) && !despacho && esPropietario
  const clienteAjeno = cotizacion.cliente?.vendedor_id && cotizacion.cliente.vendedor_id !== cotizacion.vendedor_id
  const canPdf = cotizacion.estado !== 'borrador' && cotizacion.estado !== 'anulada'
  const canWhatsApp = !despachoAnulado && (cotizacion.estado === 'enviada' || cotizacion.estado === 'aceptada')
  const canDespachar = (esSupervisor || esPropietario) && ['enviada', 'aceptada'].includes(cotizacion.estado) && onDespachar && !despacho
  const canAnular = !despachoAnulado && cotizacion.estado !== 'anulada' && cotizacion.estado !== 'vencida' && cotizacion.estado !== 'rechazada' && (esBorrador || (esEnviada && (esSupervisor || esPropietario)) || (cotizacion.estado === 'aceptada' && !despacho && esSupervisor))
  const canReciclar = esSupervisor && esPropietario && (despachoAnulado || ['rechazada', 'anulada', 'vencida'].includes(cotizacion.estado))

  // ── Acción primaria ──
  function getPrimaryAction() {
    if (esBorrador && canEdit)
      return { key: 'editar', label: getAction('editar', rol).label || 'Editar', icon: Pencil, action: () => onEditar(cotizacion) }
    if (canDespachar)
      return { key: 'despachar', label: getAction('despachar', rol).label || 'Despachar', icon: Truck, action: () => onDespachar(cotizacion) }
    if (canWhatsApp)
      return { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, action: handleWhatsApp, loading: waLoading }
    if (canReciclar)
      return { key: 'reciclar', label: getAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCw, action: () => onReciclar(cotizacion) }
    return null
  }

  const primaryAction = getPrimaryAction()
  const pColors = primaryAction ? PRIMARY_ACTION_COLORS[primaryAction.key] || PRIMARY_ACTION_COLORS.ver : {}
  const moreActions = getMoreActions()

  // ── Acciones para Más (móvil bottom sheet + desktop dropdown) ──
  function getMoreActions() {
    const actions = []
    if (canEdit && primaryAction?.key !== 'editar')
      actions.push({ label: getAction('editar', rol).label || 'Editar', icon: Pencil, onClick: () => onEditar(cotizacion), textColor: 'text-sky-600' })
    if (canWhatsApp && primaryAction?.key !== 'whatsapp')
      actions.push({ label: 'WhatsApp', icon: MessageCircle, onClick: handleWhatsApp, disabled: waLoading, textColor: 'text-emerald-600' })
    if (canDespachar && primaryAction?.key !== 'despachar')
      actions.push({ label: getAction('despachar', rol).label || 'Despachar', icon: Truck, onClick: () => onDespachar(cotizacion), textColor: 'text-indigo-600' })
    if (canReciclar && primaryAction?.key !== 'reciclar')
      actions.push({ label: getAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCw, onClick: () => onReciclar(cotizacion), textColor: 'text-teal-600' })
    if (canAnular)
      actions.push({ label: getAction('anular', rol).label || 'Anular', icon: Ban, onClick: () => onAnular(cotizacion), danger: true })
    if (onClonar)
      actions.push({ label: 'Clonar', icon: RefreshCw, onClick: () => onClonar(cotizacion), textColor: 'text-indigo-600' })
    return actions
  }

  // Moneda selector dropdown content (shared between print & download)
  function MonedaSelector({ onSelect, onClose }) {
    return (
      <div className="border-b border-slate-100 pb-1 mb-1">
        {MONEDA_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => { seleccionarMoneda(opt.key); onSelect(opt.key) }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left whitespace-nowrap ${monedaPdf === opt.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
            {opt.icon} {opt.label}
            {monedaPdf === opt.key && <Check size={14} className="ml-auto text-emerald-500" />}
          </button>
        ))}
        <div className="border-t border-slate-100 mt-1 pt-1 px-3 py-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-600 cursor-pointer flex items-center gap-2 select-none w-full">
            <input type="checkbox" checked={conIva} onChange={e => {
              setConIva(e.target.checked)
              localStorage.setItem('listopos_con_iva', e.target.checked ? 'true' : 'false')
            }} className="rounded text-primary focus:ring-primary h-3.5 w-3.5 border-slate-300" />
            Incluir IVA (16%)
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 flex flex-col">

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative shrink-0 px-3 py-2 rounded-t-2xl"
        title={cotizacion.vendedor?.nombre ? `Vendedor: ${cotizacion.vendedor.nombre}` : undefined}
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        <div className="absolute inset-0 opacity-10 overflow-hidden rounded-t-2xl"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        <div className="relative z-10 space-y-1">
          {/* Fila 1: ID y Kebab */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="font-black text-white font-mono leading-none drop-shadow text-base">{numDisplay}</p>
            </div>
            {moreActions.length > 0 && (
              <button
                ref={adminBtnRef}
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowAdminMenu(v => !v) }}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-white/80 hover:bg-white text-slate-800 shadow-md border border-white/20 transition-all active:scale-95 hover:shadow-lg shrink-0"
                title="Más opciones"
              >
                <MoreVertical size={18} className="drop-shadow-sm font-bold" />
              </button>
            )}
          </div>
          {/* Fila 2: Badges */}
          <div className="flex items-center justify-end gap-1.5 flex-wrap pt-0.5">
            <EstadoBadge estado={cotizacion.estado} />
            {despacho && (
              <button
                onClick={(e) => { e.stopPropagation(); navigate('/despachos') }}
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${
                despacho.estado === 'entregada' ? 'bg-emerald-500 text-white' :
                despacho.estado === 'despachada' ? 'bg-blue-500 text-white' :
                despacho.estado === 'anulada' ? 'bg-red-400 text-white' :
                'bg-indigo-500 text-white'
              }`}>
                {despacho.estado === 'pendiente' ? <><Clock size={10} /> Despacho pendiente</> :
                 despacho.estado === 'despachada' ? <><Truck size={10} /> En camino</> :
                 despacho.estado === 'entregada' ? <><PackageCheck size={10} /> Entregada</> :
                 despacho.estado === 'anulada' ? <><XCircle size={10} /> Despacho anulado</> : despacho.estado}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Fecha + Cliente + Vendedor ── */}
      <div className="px-3 pt-2 pb-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Calendar size={11} />
          {fmtFechaHora(cotizacion.actualizado_en || cotizacion.creado_en)}
        </div>
        {cotizacion.cliente?.nombre && (
          <div className="space-y-1">
            <p className="text-sm font-bold leading-snug"
              style={{ color: cotizacion.cliente.vendedor?.color || '#334155' }}>
              {cotizacion.cliente.nombre}
            </p>
            {(esSupervisor || esAdministracion) && cotizacion.vendedor && (
              esVendedorExterno ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#FEF3C7', color: '#B45309', border: '1px solid #FDE68A' }}>
                  💼 {cotizacion.vendedor.nombre} <span className="text-[9px] px-1 py-0.2 bg-[#B45309] text-white rounded font-extrabold uppercase">Ext</span>
                </span>
              ) : (
                <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }}>
                  {cotizacion.vendedor.nombre}
                </span>
              )
            )}
          </div>
        )}
      </div>

      {clienteAjeno && (
        <div className="mx-3 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle size={12} className="shrink-0" />
          Cliente de otro vendedor
        </div>
      )}

      {/* ── Total ── */}
      <div className="mx-3 mb-2 bg-slate-50 rounded-xl px-3 py-2 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Total</span>
          {cotizacion.items_count?.[0] && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowDetalle(true); }}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 mt-0.5 cursor-pointer hover:text-indigo-600 hover:underline transition-all"
            >
              <PackageCheck size={11} />
              {cotizacion.items_count[0].count} {cotizacion.items_count[0].count === 1 ? 'Ítem' : 'Ítems'}
            </button>
          )}
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-slate-800">{fmtUsd(cotizacion.total_usd)}</span>
          {tasa > 0 && cotizacion.total_usd > 0 && (
            <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(cotizacion.total_usd, tasa))}</div>
          )}
        </div>
      </div>

      {/* ══════════ ADMIN DESPACHO ACTIONS ══════════ */}
      {esAdministracion && despacho && onCambiarEstadoDespacho && (
        <div className="mt-auto border-t border-slate-100 px-3 py-2 flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setShowDetalle(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light transition-colors">
            <Eye size={13} /> Ver
          </button>
          {despacho.estado === 'pendiente' && (
            <button onClick={() => onCambiarEstadoDespacho(despacho.id, 'despachada', cotizacion.numero, cotizacion.cliente_nombre || cotizacion.cliente?.nombre, cotizacion.vendedor_id)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition-colors ml-auto">
              <Check size={13} /> Aprobar despacho
            </button>
          )}
          {despacho.estado === 'despachada' && (perfil?.rol === 'logistica' || perfil?.rol === 'desarrollador') && (
            <button onClick={() => onCambiarEstadoDespacho(despacho.id, 'entregada', cotizacion.numero, cotizacion.cliente_nombre || cotizacion.cliente?.nombre, cotizacion.vendedor_id)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 transition-colors ml-auto">
              <PackageCheck size={13} /> Marcar entregada
            </button>
          )}
          {['pendiente', 'despachada'].includes(despacho.estado) && (
            <button onClick={() => onCambiarEstadoDespacho(despacho.id, 'anulada', cotizacion.numero, cotizacion.cliente_nombre || cotizacion.cliente?.nombre, cotizacion.vendedor_id)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
              <Ban size={13} /> Anular
            </button>
          )}
        </div>
      )}

      {/* ══════════ MOBILE ACTIONS (< md) ══════════ */}
      {!esAdministracion && (
      <div className="md:hidden mt-auto border-t border-slate-100 p-2.5">
        {/* Botón primario — si es WhatsApp, incluye dropdown de moneda */}
        {primaryAction?.key === 'whatsapp' ? (
          <div className="relative">
            <button
              ref={whatsappBtnRef}
              onClick={() => { setShowWhatsAppMenu(v => !v); setShowPrintMenu(false); setShowDownloadMenu(false) }}
              disabled={waLoading}
              className={`w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${pColors.bg} ${pColors.text} ${pColors.active}`}
            >
              {waLoading
                ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <MessageCircle size={16} />
              }
              WhatsApp <ChevronDown size={11} />
            </button>
          </div>
        ) : primaryAction ? (
          <button
            onClick={primaryAction.action}
            disabled={primaryAction.loading}
            className={`w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${pColors.bg} ${pColors.text} ${pColors.active}`}
          >
            {primaryAction.loading
              ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <primaryAction.icon size={16} />
            }
            {primaryAction.label}
          </button>
        ) : null}

        {/* Fila: Imprimir + Descargar */}
        <div className="flex items-center gap-1 mt-2">
          {canPdf && (
            <>
              {/* Imprimir */}
              <button ref={printBtnRef} onClick={() => { setShowPrintMenu(v => !v); setShowDownloadMenu(false); setShowWhatsAppMenu(false) }}
                disabled={printLoading}
                className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
                {printLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Printer size={13} />}
                Imprimir <ChevronDown size={9} />
              </button>

              {/* Descargar */}
              <button ref={downloadBtnRef} onClick={() => { setShowDownloadMenu(v => !v); setShowPrintMenu(false); setShowWhatsAppMenu(false) }}
                disabled={pdfLoading}
                className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
                {pdfLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Download size={13} />}
                Descargar <ChevronDown size={9} />
              </button>
            </>
          )}
        </div>

        {/* Popover WhatsApp — fixed posicionado sobre el botón */}
        {showWhatsAppMenu && (() => {
          const r = whatsappBtnRef.current?.getBoundingClientRect()
          const popW = 208
          let left = r ? r.left : 16
          if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8
          if (left < 8) left = 8
          const style = r ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 4, zIndex: 50 } : { position: 'fixed', left: 16, bottom: 80, zIndex: 50 }
          return <>
            <div className="fixed inset-0 z-40" onClick={() => setShowWhatsAppMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
              <MonedaSelector onSelect={() => {}} onClose={() => setShowWhatsAppMenu(false)} />
              <button onClick={() => { handleWhatsApp(); setShowWhatsAppMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 text-left font-medium">
                <MessageCircle size={14} /> Enviar por WhatsApp
              </button>
            </div>
          </>
        })()}

        {/* Popover Imprimir — fixed posicionado sobre el botón */}
        {showPrintMenu && (() => {
          const r = printBtnRef.current?.getBoundingClientRect()
          const popW = 208
          let left = r ? r.left : 16
          if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8
          if (left < 8) left = 8
          const style = r ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 4, zIndex: 50 } : { position: 'fixed', left: 16, bottom: 80, zIndex: 50 }
          return <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPrintMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
              <MonedaSelector onSelect={() => {}} onClose={() => setShowPrintMenu(false)} />
              <button onClick={() => { imprimirCotizacion(); setShowPrintMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                <Printer size={14} /> Imprimir cotización
              </button>
            </div>
          </>
        })()}

        {/* Popover Descargar — fixed posicionado sobre el botón */}
        {showDownloadMenu && (() => {
          const r = downloadBtnRef.current?.getBoundingClientRect()
          const popW = 208
          let left = r ? r.left : 16
          if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8
          if (left < 8) left = 8
          const style = r ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 4, zIndex: 50 } : { position: 'fixed', left: 16, bottom: 80, zIndex: 50 }
          return <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDownloadMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
              <MonedaSelector onSelect={() => {}} onClose={() => setShowDownloadMenu(false)} />
              <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                <Download size={14} /> Descargar PDF
              </button>
            </div>
          </>
        })()}


      </div>
      )}

      {/* ══════════ DESKTOP ACTIONS (md+) ══════════ */}
      {!esAdministracion && (
      <div className="hidden md:flex mt-auto border-t border-slate-100 px-3 py-2 items-center gap-1 flex-wrap">
        {/* Botón primario — si es WhatsApp, incluye dropdown de moneda */}
        {primaryAction?.key === 'whatsapp' ? (
          <div className="relative">
            <button onClick={() => setShowWhatsAppMenu(v => !v)}
              onBlur={() => setTimeout(() => setShowWhatsAppMenu(false), 200)}
              disabled={waLoading}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 whitespace-nowrap ${pColors.bg} ${pColors.text} ${pColors.active}`}>
              {waLoading ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />}
              WhatsApp <ChevronDown size={9} />
            </button>
            {showWhatsAppMenu && (
              <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                onMouseDown={e => e.preventDefault()}>
                <MonedaSelector onSelect={() => {}} onClose={() => setShowWhatsAppMenu(false)} />
                <button onClick={() => { handleWhatsApp(); setShowWhatsAppMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 text-left font-medium">
                  <MessageCircle size={14} /> Enviar por WhatsApp
                </button>
              </div>
            )}
          </div>
        ) : primaryAction ? (
          <button onClick={primaryAction.action}
            disabled={primaryAction.loading}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 whitespace-nowrap ${pColors.bg} ${pColors.text} ${pColors.active}`}>
            {primaryAction.loading ? <Loader2 size={12} className="animate-spin" /> : <primaryAction.icon size={12} />}
            {primaryAction.label}
          </button>
        ) : null}

        {canPdf && (
          <>
            {/* Imprimir dropdown con moneda */}
            <div className="relative">
              <button onClick={() => setShowPrintMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowPrintMenu(false), 200)}
                disabled={printLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
                {printLoading ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                Imprimir <ChevronDown size={9} />
              </button>
              {showPrintMenu && (
                <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                  onMouseDown={e => e.preventDefault()}>
                  <MonedaSelector onSelect={() => {}} onClose={() => setShowPrintMenu(false)} />
                  <button onClick={() => { imprimirCotizacion(); setShowPrintMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                    <Printer size={14} /> Imprimir cotización
                  </button>
                </div>
              )}
            </div>

            {/* Descargar dropdown con moneda */}
            <div className="relative">
              <button onClick={() => setShowDownloadMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowDownloadMenu(false), 200)}
                disabled={pdfLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
                {pdfLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Descargar <ChevronDown size={9} />
              </button>
              {showDownloadMenu && (
                <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                  onMouseDown={e => e.preventDefault()}>
                  <MonedaSelector onSelect={() => {}} onClose={() => setShowDownloadMenu(false)} />
                  <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium">
                    <Download size={14} /> Descargar PDF
                  </button>
                </div>
              )}
            </div>
          </>
        )}


      </div>
      )}

      <DetalleModal
        isOpen={showDetalle}
        onClose={() => setShowDetalle(false)}
        tipo="cotizacion"
        registro={cotizacion}
        tasa={tasa}
      />



      {/* ── Menú kebab ⋮ — nivel raíz, fixed para escapar overflow:hidden ── */}
      {showAdminMenu && moreActions.length > 0 && (() => {
        const r = adminBtnRef.current?.getBoundingClientRect()
        const style = r
          ? { position: 'fixed', right: window.innerWidth - r.right, top: r.bottom + 6, zIndex: 9999 }
          : { position: 'fixed', right: 16, top: 60, zIndex: 9999 }
        return <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowAdminMenu(false)} />
          <div style={style} className="w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1">
            {moreActions.map((act, i) => (
              <Fragment key={i}>
                {act.danger && <div className="border-t border-slate-100 my-1" />}
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { act.onClick(); setShowAdminMenu(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left ${
                    act.danger ? 'text-red-500 hover:bg-red-50' :
                    act.textColor ? `${act.textColor} hover:bg-slate-50` :
                    'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {act.icon && <act.icon size={14} />} {act.label}
                </button>
              </Fragment>
            ))}
          </div>
        </>
      })()}
    </div>
  )
})
