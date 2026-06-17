// src/views/CotizacionesView.jsx
// Vista principal: lista de cotizaciones + builder integrado
// El builder reemplaza la lista in-page (sin navegación adicional)
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { FileText, Plus, RefreshCw, AlertTriangle, PackageCheck, Loader2, X, AlertCircle, LayoutGrid, List, ChevronDown, Truck, Receipt, MessageSquare, Filter, Search, Clock } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import supabase from '../services/supabase/client'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useCotizaciones, useAnularCotizacion, useActualizarEstado, useReabrirCotizacion, useReciclarCotizacion } from '../hooks/useCotizaciones'
import { useCrearDespacho, useActualizarEstadoDespacho } from '../hooks/useDespachos'
import { useCotizacion } from '../hooks/useCotizaciones'
import { useClientes } from '../hooks/useClientes'
import CotizacionCard    from '../components/cotizaciones/CotizacionCard'
import CotizacionRow     from '../components/cotizaciones/CotizacionRow'
import DetalleModal      from '../components/ui/DetalleModal'
import CotizacionBuilder from '../components/cotizaciones/CotizacionBuilder'
// CotizacionRapida desactivada temporalmente
// import CotizacionRapida  from '../components/cotizaciones/CotizacionRapida'
import ConfirmModal      from '../components/ui/ConfirmModal'
import { Modal }         from '../components/ui/Modal'
import EmptyState        from '../components/ui/EmptyState'
import CustomSelect      from '../components/ui/CustomSelect'
import Skeleton          from '../components/ui/Skeleton'
import { useVendedores } from '../hooks/useClientes'
import { useFormasPago } from '../hooks/useFormasPago'
import { useSaldoFavorOrigen } from '../hooks/useCuentasCobrar'
import { useTransportistas, useCrearTransportista } from '../hooks/useTransportistas'
import VendedorFilterPill from '../components/ui/VendedorFilterPill'
import ToggleVistaPersonal from '../components/ui/ToggleVistaPersonal'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs, removeAccents } from '../utils/format'
import { showToast } from '../components/ui/Toast'
import { round2 } from '../utils/dinero'
import { notifyFacturacionClienteAjeno } from '../services/notificationService'
import PageHeader from '../components/ui/PageHeader'
import Pagination from '../components/ui/Pagination'
import { OnboardingSequence } from '../components/ui/OnboardingTooltip'
import { getAction } from '../utils/cotizacionActions'
import ClienteFacturaBuscador from '../components/clientes/ClienteFacturaBuscador'
import TransportistaFormCompact from '../components/transportistas/TransportistaFormCompact'
import { ESTADOS, getCiudades } from '../data/venezuelaGeo'
import { MapPin, Building, DollarSign } from 'lucide-react'

// ─── Filtros de estado ────────────────────────────────────────────────────────
const ESTADOS_FILTRO = [
  { valor: '',          label: 'Todas' },
  { valor: 'borrador',  label: 'Borradores' },
  { valor: 'enviada',   label: 'Enviadas' },
  { valor: 'aceptada',  label: 'Aprobadas' },
  { valor: 'anulada',   label: 'Canceladas' },
]

const ESTADOS_FILTRO_ADMIN = [
  { valor: '',          label: 'Todos' },
  { valor: 'pendiente', label: 'Por aprobar' },
  { valor: 'despachada', label: 'Aprobados' },
  { valor: 'entregada', label: 'Entregados' },
  { valor: 'anulada',   label: 'Anulados' },
]

function EstadoDropdownCot({ filtros, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const activeLabel = filtros.find(f => f.valor === value)?.label || 'Todas'

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors bg-primary text-white border-primary">
        <Filter size={12} />
        {activeLabel}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
          {filtros.map(({ valor, label }) => (
            <button key={valor} onClick={() => { onChange(valor); setOpen(false) }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                value === valor ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SkeletonCotizaciones() {
  return (
    <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-5 w-3/4 rounded-lg" />
          <Skeleton className="h-3.5 w-1/3 rounded" />
          <div className="pt-2 border-t border-slate-100">
            <Skeleton className="h-5 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Modal de resumen para despachar ────────────────────────────────────────
import { FORMAS_PAGO } from '../constants/formasPago'


function ModalDespachar({ cotizacion, onConfirm, onCancel, cargando, tasa = 0 }) {
  const { data: detalle } = useCotizacion(cotizacion?.id)
  const { data: clientes = [] } = useClientes()
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [corteUsd, setCorteUsd] = useState('')
  const [referenciaPago, setReferenciaPago] = useState('')
  const [showTransportistaMenu, setShowTransportistaMenu] = useState(false)
  const [stockMap, setStockMap] = useState({})
  const [notas, setNotas] = useState('')
  const [showNotas, setShowNotas] = useState(false)
  const [clienteFacturaId, setClienteFacturaId] = useState('')
  const [direccionEnvioActiva, setDireccionEnvioActiva] = useState(false)
  const [direccionEnvioEstado, setDireccionEnvioEstado] = useState('')
  const [direccionEnvioCiudad, setDireccionEnvioCiudad] = useState('')
  const [direccionEnvioDireccion, setDireccionEnvioDireccion] = useState('')
  const { data: transportistas = [] } = useTransportistas()
  const crearTransp = useCrearTransportista()
  const [showNuevoTransp, setShowNuevoTransp] = useState(false)
  const [transpError, setTranspError] = useState('')
  const [esCod, setEsCod] = useState(false)
  const [vueltoComoSaldoFavor, setVueltoComoSaldoFavor] = useState(false)

  const perfil = useAuthStore(useCallback(s => s.perfil, []))

  const billingCliente = useMemo(() => {
    return clienteFacturaId
      ? clientes.find(c => c.id === clienteFacturaId)
      : cotizacion?.cliente
  }, [clienteFacturaId, clientes, cotizacion])

  const esVendedorSinComision = useMemo(() => {
    if (!billingCliente) return false
    return (
      billingCliente.vendedor?.rol === 'vendedor_sin_comision' ||
      (billingCliente.vendedor_id === perfil?.id && perfil?.rol === 'vendedor_sin_comision')
    )
  }, [billingCliente, perfil])

  const items = detalle?.items ?? []

  // Fetch stock for items when they load
  useEffect(() => {
    if (items.length === 0) return
    const productIds = [...new Set(items.map(i => i.producto_id).filter(Boolean))]
    if (productIds.length === 0) return
    let cancelled = false
    supabase.rpc('obtener_stock_productos', { p_ids: productIds })
      .then(({ data }) => {
        if (!cancelled && data) setStockMap(Object.fromEntries(data.map(p => [p.id, p.stock_actual])))
      })
    return () => { cancelled = true }
  }, [detalle])
  const totalSinFlete = Number(cotizacion?.total_usd || 0) - Number(cotizacion?.costo_envio_usd || 0) - Number(cotizacion?.corte_usd || 0)
  const totalConFlete = totalSinFlete + Number(fleteUsd || 0) + Number(corteUsd || 0)

  const { data: saldoFavorOrigen } = useSaldoFavorOrigen(billingCliente?.id)

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

  const handleTogglePagoInmediato = (metodo) => {
    if (metodo === 'Saldo a Favor') {
      const active = pagosInmediatos.some(f => f.metodo === 'Saldo a Favor')
      if (!active) {
        togglePagoInmediato('Saldo a Favor')
        setTimeout(() => {
          const available = Number(billingCliente?.saldo_a_favor || 0)
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
      const maxVal = Number(billingCliente?.saldo_a_favor || 0)
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

  const cxcItem = pagosInmediatos.find(f => f.metodo === 'Cta por cobrar');
  const cxcVencimientoValido = !cxcItem || (
    cxcItem.diasVencimiento !== undefined &&
    cxcItem.diasVencimiento !== null &&
    !isNaN(cxcItem.diasVencimiento) &&
    Number(cxcItem.diasVencimiento) > 0
  );

  const formasPagoFinales = useMemo(() => {
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
  }, [esCod, pagosInmediatos, propuestaCod, totalConFlete, totalInmediato, montoCodRequerido, pagosInmediatosHayVuelto, vueltoComoSaldoFavor])

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

  const handleCerrar = () => {
    resetPagosInmediatos()
    resetPropuestaCod()
    onCancel()
  }

  if (!cotizacion) return null

  const stockIssues = items.filter(i => {
    const esExterno = i.origen === 'externo' || !i.producto_id || String(i.producto_id).startsWith('manual-') || String(i.codigo_snap).startsWith('EXT')
    if (esExterno) return false
    const stock = stockMap[i.producto_id]
    return stock !== undefined && stock < Number(i.cantidad)
  })

  const numDisplay = `COT-${String(cotizacion?.numero || 0).padStart(5, '0')}`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 lg:p-6 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
              <PackageCheck size={18} className="text-indigo-500" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-slate-800 text-base leading-tight">Crear orden de despacho</h3>
              <p className="text-xs text-slate-400 font-mono truncate">{numDisplay} · <span className="font-sans font-semibold text-slate-600">{cotizacion?.cliente?.nombre ?? '—'}</span> · <span className="font-sans font-black text-indigo-600">{fmtUsd(cotizacion?.total_usd || 0)}</span>{tasa > 0 && <span className="font-sans text-slate-400 ml-1">{fmtBs(usdToBs(cotizacion?.total_usd || 0, tasa))}</span>}</p>
            </div>
          </div>
          <button onClick={handleCerrar} disabled={cargando}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* ── Body — 2 columnas en desktop ───────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">

          {/* ── Columna izquierda: resumen del pedido ── */}
          <div className="lg:flex-1 min-h-0 overflow-y-auto p-4 lg:p-5 space-y-3 border-b lg:border-b-0 lg:border-r border-slate-100">

            {/* Lista tipo recibo compacta */}
            {items.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-2">
                {/* Header resumen */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{items.length} producto{items.length > 1 ? 's' : ''}</span>
                  <span className="text-xs font-black text-slate-600">{fmtUsd(totalSinFlete)}</span>
                </div>
                {/* Items */}
                <div className="space-y-2 mt-2">
                  {items.map((item, i) => {
                    const cant = Number(item.cantidad)
                    const stock = stockMap[item.producto_id]
                    const hasStockIssue = stock !== undefined && stock < cant && !(item.origen === 'externo' || !item.producto_id || String(item.producto_id).startsWith('manual-') || String(item.codigo_snap).startsWith('EXT'))
                    return (
                      <div
                        key={item.id || i}
                        className={`flex flex-col gap-1.5 p-3 rounded-xl border transition-all duration-200 ${
                          hasStockIssue
                            ? 'bg-rose-50/60 border-rose-100/75 hover:bg-rose-50 hover:border-rose-200 shadow-sm shadow-rose-100/20'
                            : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50 hover:border-slate-200/80 shadow-sm shadow-slate-100/10'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className={`text-xs font-bold text-slate-700 leading-snug break-words ${hasStockIssue ? 'text-rose-950 font-black' : ''}`}>
                            {item.nombre_snap}
                          </span>
                          <span className={`text-xs font-black shrink-0 select-none ${hasStockIssue ? 'text-rose-700' : 'text-slate-800'}`}>
                            {fmtUsd(item.total_linea_usd)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className={`font-semibold ${hasStockIssue ? 'text-rose-500' : 'text-slate-400'}`}>
                            {cant.toLocaleString('es-VE')} u. × {fmtUsd(item.precio_unit_usd)}
                          </span>
                          {hasStockIssue ? (
                            <span className="text-[9px] text-rose-600 font-bold bg-rose-100/80 px-1.5 py-0.5 rounded-md shrink-0 border border-rose-200/40">
                              Stock disp: {stock ?? 0}
                            </span>
                          ) : (
                            stock !== undefined && (
                              <span className="text-slate-400 font-medium shrink-0 bg-slate-100/50 px-1.5 py-0.5 rounded-md">
                                Stock disp: {stock}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Stock warnings */}
            {stockIssues.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
                <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                  <AlertCircle size={14} className="shrink-0" /> Stock insuficiente
                </div>
                {stockIssues.map((item, idx) => (
                  <p key={item.id || item.producto_id || idx} className="text-xs text-red-600 ml-5">
                    <span className="font-medium">{item.nombre_snap}</span>: necesita {Number(item.cantidad)} — disponible {stockMap[item.producto_id] ?? 0}
                  </p>
                ))}
              </div>
            )}

            {/* Totales */}
            <div className="border-t border-slate-100 pt-2 space-y-0.5">
              {(cotizacion?.descuento_usd || 0) > 0 && (<>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Subtotal</span><span>{fmtUsd(cotizacion?.subtotal_usd || 0)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Descuento ({cotizacion?.descuento_global_pct || 0}%)</span>
                  <span className="text-red-400">-{fmtUsd(cotizacion?.descuento_usd || 0)}</span>
                </div>
              </>)}

              {Number(fleteUsd) > 0 && (
                <div className="flex justify-between text-xs text-indigo-500 font-medium">
                  <span>+ Flete</span>
                  <span>{fmtUsd(Number(fleteUsd))}</span>
                </div>
              )}
              {Number(corteUsd) > 0 && (
                <div className="flex justify-between text-xs text-indigo-500 font-medium">
                  <span>+ Corte</span>
                  <span>{fmtUsd(Number(corteUsd))}</span>
                </div>
              )}
              {(Number(fleteUsd) > 0 || Number(corteUsd) > 0) && (
                <div className="flex justify-between text-xs font-bold text-slate-700 mt-1 pt-1 border-t border-slate-200">
                  <span>Total final</span>
                  <span>{fmtUsd(totalConFlete)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Columna derecha: configuración del despacho ── */}
          <div className="lg:w-[380px] xl:w-[410px] shrink-0 min-h-0 overflow-y-auto p-4 lg:p-5 space-y-3 pb-6">

            {/* Transportista + Flete en una fila */}
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transportista</p>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <CustomSelect
                    value={transportistaId}
                    onChange={(v) => {
                      setTransportistaId(v)
                      if (!v) setFleteUsd('')
                    }}
                    placeholder="Sin transportista"
                    clearable
                    icon={Truck}
                    disabled={cargando}
                    showSubInTrigger={false}
                    options={transportistas.map(t => ({
                      value: t.id,
                      label: `${t.nombre}${t.rif ? ` (${t.rif})` : ''}`,
                      selectedLabel: t.nombre,
                      sub: [t.vehiculo, t.placa_chuto ? `Placas: ${t.placa_chuto}${t.placa_batea ? `/${t.placa_batea}` : ''}` : '', t.color].filter(Boolean).join(' · ') || undefined,
                    }))}
                  />
                </div>
                {transportistaId && (
                  <div className="relative w-24 shrink-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">Flete $</span>
                    <input type="number" min="0" step="0.01" value={fleteUsd}
                      onChange={e => setFleteUsd(e.target.value)} placeholder="0.00"
                      className="w-full pl-12 pr-2 py-1.5 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white"
                      disabled={cargando} />
                  </div>
                )}
                <button type="button" onClick={() => setShowNuevoTransp(true)} disabled={cargando}
                  className="shrink-0 w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
                  title="Nuevo transportista">
                  <Plus size={13} className="text-emerald-600" />
                </button>
              </div>
            </div>


            {/* Formas de pago — chips con input integrado */}
            <div className="space-y-2">
              {/* Toggle Cobro a destino (COD) */}
              <div className="mb-3 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-2.5 shadow-sm max-w-sm">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-lg bg-rose-100 text-rose-600">
                    <Truck size={14} />
                  </span>
                  <div>
                    <span className="text-[11px] font-bold text-slate-700 block">¿Cobro a destino (COD)?</span>
                    <span className="text-[9px] text-slate-400">El cliente pagará al recibir</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleCod}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    esCod ? 'bg-rose-500' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      esCod ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* SECCIÓN 1: PAGO INMEDIATO (ADELANTO) */}
              <div className="space-y-2.5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {esCod ? 'Pago Inmediato (Adelanto / Seña)' : 'Formas de pago *'}
                </p>

                {/* Métodos activos de pagosInmediatos */}
                <div className="space-y-1.5">
                  {pagosInmediatos.map(fp => {
                    const restante = totalConFlete - totalInmediato - totalPropuestaCod
                    return (
                      <div key={fp.metodo} className="flex flex-col gap-1">
                        <div className="flex items-center gap-0 rounded-lg border border-indigo-300 bg-indigo-50 overflow-hidden">
                          <button type="button" onClick={() => handleTogglePagoInmediato(fp.metodo)}
                            className="flex items-center gap-0.5 px-2 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors shrink-0 border-r border-indigo-200">
                            {fp.metodo === 'Saldo a Favor'
                              ? `Saldo a Favor (${(fp.forma_pago_origen || 'Crédito').toUpperCase()})`
                              : fp.metodo} <X size={9} className="ml-0.5" />
                          </button>
                          <div className="relative flex items-center">
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-indigo-400 text-[10px]">$</span>
                            <input type="number" min="0" step="0.01" value={fp.monto}
                              onChange={e => handleSetMontoPagoInmediato(fp.metodo, e.target.value)}
                              onFocus={e => e.target.select()}
                              placeholder="0"
                              className="w-16 pl-4 pr-1 py-1.5 text-xs font-semibold text-indigo-800 bg-transparent focus:outline-none focus:bg-white/60"
                              disabled={cargando} />
                            {restante > 0.01 && (
                              <button type="button"
                                onClick={() => {
                                  let amountToAssign = (Number(fp.monto) || 0) + restante
                                  if (fp.metodo === 'Saldo a Favor') {
                                    const available = Number(billingCliente?.saldo_a_favor || 0)
                                    if (amountToAssign > available) {
                                      amountToAssign = available
                                    }
                                  }
                                  handleSetMontoPagoInmediato(fp.metodo, Number(amountToAssign.toFixed(2)))
                                }}
                                className="mr-1 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded transition-colors shrink-0"
                                title={`Completar con $${restante.toFixed(2)} restante`}>
                                Restante
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Opción de días de vencimiento para CxC */}
                        {fp.metodo === 'Cta por cobrar' && (
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg ml-2">
                            <Clock size={10} className="text-amber-500 shrink-0" />
                            <span className="text-[10px] font-medium text-amber-700 whitespace-nowrap">
                              Días (obligatorio) *:
                            </span>
                            <input
                              type="number" min="0" step="1"
                              value={fp.diasVencimiento ?? ''}
                              onChange={e => updatePagoInmediato(fp.metodo, { diasVencimiento: e.target.value ? parseInt(e.target.value) : null })}
                              placeholder="Obligatorio"
                              className="w-20 px-1 py-0.5 rounded text-[10px] font-semibold border border-amber-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 text-slate-700 text-center"
                            />
                          </div>
                        )}

                        {/* Opción de Referencia para Transferencia y Pago Móvil */}
                        {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(fp.metodo) && (
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-teal-50 border border-teal-200 rounded-lg ml-2">
                            <span className="text-[10px] font-medium text-teal-700 whitespace-nowrap">
                              Referencia (opcional):
                            </span>
                            <input
                              type="text"
                              value={fp.referencia ?? ''}
                              onChange={e => updatePagoInmediato(fp.metodo, { referencia: e.target.value })}
                              placeholder="Ej: 12345"
                              className="w-24 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-teal-200 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 text-slate-700 text-center"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Chips para agregar métodos inmediatos */}
                <div className="flex flex-wrap gap-1.5">
                  {/* Chip especial para Saldo a Favor */}
                  {Number(billingCliente?.saldo_a_favor || 0) > 0 && !pagosInmediatos.some(f => f.metodo === 'Saldo a Favor') && (
                    <button
                      type="button"
                      onClick={() => handleTogglePagoInmediato('Saldo a Favor')}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-all duration-200 shadow-sm active:scale-95 flex items-center gap-0.5"
                    >
                      Saldo a Favor (${Number(billingCliente.saldo_a_favor).toFixed(2)})
                    </button>
                  )}

                  {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && (m !== 'Donación' || perfil?.rol !== 'vendedor'))
                    .filter(m => m !== 'Saldo a Favor')
                    .filter(m => !pagosInmediatos.some(f => f.metodo === m))
                    .map(m => (
                      <button key={m} type="button" onClick={() => handleTogglePagoInmediato(m)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all active:scale-95">
                        {m}
                      </button>
                    ))}
                </div>

                {esCod && pagosInmediatos.length === 0 && (
                  <p className="text-[11px] text-slate-400 italic">No se registraron adelantos inmediatos.</p>
                )}

                {/* Banner de Vuelto / Excedente a Saldo a Favor */}
                {pagosInmediatosHayVuelto && (
                  <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200">
                    <div className="flex items-start gap-2">
                      <span className="p-1 rounded-lg bg-indigo-100 text-indigo-600 shrink-0 mt-0.5">
                        <DollarSign size={14} />
                      </span>
                      <div>
                        <span className="text-[11px] font-black text-indigo-900 block">
                          El pago supera el total por ${pagosInmediatosDiferencia.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-indigo-600 font-bold leading-normal">
                          ¿Qué deseas hacer con la diferencia? {tasa > 0 && `(Equivale a ${fmtBs(pagosInmediatosDiferencia * tasa)})`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <span className="text-[10px] font-bold text-slate-500">Vuelto Físico</span>
                      <button
                        type="button"
                        onClick={() => setVueltoComoSaldoFavor(!vueltoComoSaldoFavor)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          vueltoComoSaldoFavor ? 'bg-indigo-600' : 'bg-slate-200'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            vueltoComoSaldoFavor ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span className="text-[10px] font-black text-indigo-700">Saldo a Favor</span>
                    </div>
                  </div>
                )}
              </div>

              {/* SECCIÓN 2: COBRO AL RECIBIR (COD) */}
              {esCod && (
                <div className="mt-3 p-3 bg-rose-50/50 border border-rose-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-rose-800">
                    <span>Monto a cobrar al recibir:</span>
                    <span className="text-sm font-extrabold text-rose-600">${montoCodRequerido.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  {montoCodRequerido > 0.015 ? (
                    <div className="space-y-2.5 border-t border-rose-100 pt-2.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        ¿Cómo pagará al recibir? (Propuesta) *
                      </label>

                      {/* Métodos activos de propuestaCod */}
                      <div className="space-y-1.5">
                        {propuestaCod.map(fp => {
                          const restanteCod = Math.max(0, round2(montoCodRequerido - totalPropuestaCod));
                          return (
                            <div key={fp.metodo} className="flex flex-col gap-1">
                              <div className="flex items-center gap-0 rounded-lg border border-rose-300 bg-rose-50/50 overflow-hidden">
                                <button type="button" onClick={() => togglePropuestaCod(fp.metodo)}
                                  className="flex items-center gap-0.5 px-2 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition-colors shrink-0 border-r border-rose-200">
                                  {fp.metodo} <X size={9} className="ml-0.5" />
                                </button>
                                <div className="relative flex items-center">
                                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-rose-400 text-[10px]">$</span>
                                  <input type="number" min="0" step="0.01" value={fp.monto}
                                    onChange={e => setMontoPropuestaCod(fp.metodo, e.target.value)}
                                    onFocus={e => e.target.select()}
                                    placeholder="0"
                                    className="w-16 pl-4 pr-1 py-1.5 text-xs font-semibold text-rose-800 bg-transparent focus:outline-none focus:bg-white/60"
                                    disabled={cargando} />
                                  {restanteCod > 0.01 && (
                                    <button type="button"
                                      onClick={() => setMontoPropuestaCod(fp.metodo, Number(((Number(fp.monto) || 0) + restanteCod).toFixed(2)))}
                                      className="mr-1 px-1.5 py-0.5 text-[9px] font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 rounded transition-colors shrink-0"
                                      title={`Completar con $${restanteCod.toFixed(2)} restante`}>
                                      Restante
                                    </button>
                                  )}
                                </div>
                              </div>
                              {/* Opción de Referencia para Transferencia y Pago Móvil COD */}
                              {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(fp.metodo) && (
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 border border-rose-200 rounded-lg ml-2 mt-1">
                                  <span className="text-[10px] font-medium text-rose-700 whitespace-nowrap">
                                    Referencia (opcional):
                                  </span>
                                  <input
                                    type="text"
                                    value={fp.referencia ?? ''}
                                    onChange={e => updatePropuestaCod(fp.metodo, { referencia: e.target.value })}
                                    placeholder="Ej: 12345"
                                    className="w-24 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-rose-200 bg-white focus:outline-none focus:ring-1 focus:ring-rose-400 text-slate-700 text-center"
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
                        <div className="flex flex-wrap gap-1.5">
                          {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && m !== 'Cta por cobrar' && m !== 'Donación')
                            .filter(m => !propuestaCod.some(f => f.metodo === m))
                            .map(m => (
                              <button key={m} type="button" onClick={() => togglePropuestaCod(m)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-all active:scale-95">
                                {m}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-amber-600 font-medium bg-amber-50 border border-amber-200 p-2 rounded-lg">
                      El monto asignado en pagos inmediatos ya cubre el total.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* FEATURE_CORTE_HIDDEN: Oculto temporalmente a petición del usuario. Cambiar a true para reactivar. */}
            {false && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Corte de Material</p>
                <div className="relative w-full">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">Corte $</span>
                  <input type="number" min="0" step="0.01" value={corteUsd}
                    onChange={e => setCorteUsd(e.target.value)} placeholder="0.00"
                    className="w-full pl-16 pr-2 py-1.5 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white"
                    disabled={cargando} />
                </div>
              </div>
            )}

            {/* Notas — colapsable */}
            <div>
              {!showNotas ? (
                <button type="button"
                  onClick={() => setShowNotas(true)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-500 transition-colors">
                  <MessageSquare size={12} />
                  <span>{notas ? `Nota: ${notas.slice(0, 40)}${notas.length > 40 ? '...' : ''}` : 'Agregar nota (opcional)'}</span>
                </button>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notas</p>
                    <button type="button" onClick={() => setShowNotas(false)} className="text-slate-400 hover:text-slate-600 p-0.5">
                      <X size={12} />
                    </button>
                  </div>
                  <textarea value={notas} onChange={e => setNotas(e.target.value)}
                    placeholder="Observaciones internas..."
                    className="w-full px-3 py-1.5 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white transition-colors resize-none"
                    rows={2} disabled={cargando} autoFocus />
                </div>
              )}
            </div>

            {/* Facturar a otro cliente — campo inline directo */}
            <ClienteFacturaBuscador
              clientes={clientes.filter(c => c.id !== cotizacion?.cliente_id)}
              clienteId={clienteFacturaId}
              onSelect={setClienteFacturaId}
            />

            {/* Dirección de Envío Opcional */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                    <MapPin size={15} />
                  </span>
                  <div>
                    <span className="text-[11px] font-bold text-slate-700 block">¿Enviar a otra dirección?</span>
                    <span className="text-[9px] text-slate-400">Especificar dirección alternativa de entrega</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDireccionEnvioActiva(v => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    direccionEnvioActiva ? 'bg-indigo-500' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      direccionEnvioActiva ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {direccionEnvioActiva && (
                <div className="space-y-3 border-t border-slate-200/60 pt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Estado *</label>
                      <CustomSelect
                        options={ESTADOS.map(e => ({ value: e, label: e }))}
                        value={direccionEnvioEstado}
                        onChange={val => {
                          setDireccionEnvioEstado(val)
                          setDireccionEnvioCiudad('')
                        }}
                        placeholder="Elegir..."
                        icon={MapPin}
                        searchable
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Ciudad *</label>
                      <CustomSelect
                        options={(direccionEnvioEstado ? getCiudades(direccionEnvioEstado) : []).map(c => ({ value: c, label: c }))}
                        value={direccionEnvioCiudad}
                        onChange={setDireccionEnvioCiudad}
                        placeholder={direccionEnvioEstado ? 'Elegir...' : 'Falta estado'}
                        icon={Building}
                        disabled={!direccionEnvioEstado}
                        searchable
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Dirección (Opcional)</label>
                    <input
                      type="text"
                      value={direccionEnvioDireccion}
                      onChange={e => setDireccionEnvioDireccion(e.target.value)}
                      placeholder="Ej: Av. Principal, Local 4..."
                      className="w-full px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                </div>
              )}
            </div>

          </div>{/* fin col derecha */}
        </div>{/* fin body */}

        {/* ── Footer — validación + botones ─────────────────────── */}
        <div className="border-t border-slate-100 shrink-0">
          {!esCod ? (
            pagosInmediatos.length > 0 && (
              <div className={`flex items-center justify-between px-5 py-1.5 text-xs font-semibold ${
                pagoInmediatoCuadrado ? 'bg-emerald-50 text-emerald-700'
                : (totalInmediato - totalConFlete > 0.02) ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-600'
              }`}>
                <span>Asignado: {fmtUsd(totalInmediato)}</span>
                <span>Total: {fmtUsd(totalConFlete)}</span>
                {pagoInmediatoCuadrado ? <span>✓</span> : (totalInmediato - totalConFlete > 0.02) ? <span>Sobran {fmtUsd(totalInmediato - totalConFlete)}</span> : <span>Faltan {fmtUsd(Math.abs(totalInmediato - totalConFlete))}</span>}
              </div>
            )
          ) : (
            <div className={`flex items-center justify-between px-5 py-1.5 text-xs font-semibold ${
              propuestaCodCuadrado ? 'bg-emerald-50 text-emerald-700'
              : (totalPropuestaCod - montoCodRequerido > 0.02) ? 'bg-amber-50 text-amber-700'
              : 'bg-red-50 text-red-600'
            }`}>
              <span>Asignado COD: {fmtUsd(totalPropuestaCod)}</span>
              <span>Requerido COD: {fmtUsd(montoCodRequerido)}</span>
              {propuestaCodCuadrado ? <span>✓</span> : (totalPropuestaCod - montoCodRequerido > 0.02) ? <span>Sobran {fmtUsd(totalPropuestaCod - montoCodRequerido)}</span> : <span>Faltan {fmtUsd(Math.abs(totalPropuestaCod - montoCodRequerido))}</span>}
            </div>
          )}
          <div className="flex gap-3 px-5 py-3">
            <button onClick={handleCerrar} disabled={cargando}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
              Cancelar
            </button>
            <button onClick={() => {
                const fpJson = JSON.stringify(formasPagoFinales)
                onConfirm(
                  fpJson,
                  transportistaId || null,
                  Number(fleteUsd) || 0,
                  Number(corteUsd) || 0,
                  referenciaPago,
                  fpJson,
                  notas,
                  clienteFacturaId || null,
                  direccionEnvioActiva ? direccionEnvioDireccion : null,
                  direccionEnvioActiva ? direccionEnvioCiudad : null,
                  direccionEnvioActiva ? direccionEnvioEstado : null
                )
              }} disabled={
                cargando ||
                items.length === 0 ||
                !(esCod ? (montoCodRequerido > 0.015 && propuestaCodCuadrado) : pagoInmediatoCuadrado) ||
                !cxcVencimientoValido ||
                (direccionEnvioActiva && (!direccionEnvioEstado || !direccionEnvioCiudad))
              }
              title={
                !cxcVencimientoValido
                  ? 'Días de vencimiento obligatorios para cuentas por cobrar'
                  : direccionEnvioActiva && (!direccionEnvioEstado || !direccionEnvioCiudad)
                  ? 'Debe seleccionar un Estado y una Ciudad para el envío'
                  : esCod
                  ? (!propuestaCodCuadrado ? 'La propuesta COD no está cuadrada' : undefined)
                  : (!pagoInmediatoCuadrado ? 'Los montos no cuadran con el total' : undefined)
              }
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 whitespace-nowrap">
              {cargando
                ? <><Loader2 size={15} className="animate-spin" />Procesando...</>
                : <><PackageCheck size={15} />Confirmar despacho</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal overlay: nuevo transportista ── */}
      {showNuevoTransp && (
        <div className="fixed inset-0 z-[110] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => { setShowNuevoTransp(false); setTranspError('') }}>
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Truck size={16} className="text-sky-500" />
                Nuevo transportista
              </h3>
              <button onClick={() => { setShowNuevoTransp(false); setTranspError('') }} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">
              {transpError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700 mb-3">
                  {transpError}
                </div>
              )}
              <TransportistaFormCompact
                onGuardar={async (campos) => {
                  setTranspError('')
                  try {
                    const result = await crearTransp.mutateAsync(campos)
                    const idNuevo = result.transportista?.id || result.id
                    if (idNuevo) {
                      setTransportistaId(idNuevo)
                      setShowNuevoTransp(false)
                      showToast('Transportista creado y seleccionado', 'success')
                    }
                  } catch (e) {
                    setTranspError(e.message || 'Error al crear transportista')
                  }
                }}
                onCancelar={() => { setShowNuevoTransp(false); setTranspError('') }}
                cargando={crearTransp.isPending}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista lista ──────────────────────────────────────────────────────────────
function ListaCotizaciones({ onNueva, onEditar, despacharCotizacion }) {
  const navigate = useNavigate()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esAdmin = perfil?.rol === 'administracion'
  const esPrivilegiado = esAdmin || esSupervisor || esDesarrollador
  const { tasaEfectiva } = useTasaCambio()
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [busquedaGlobal, setBusquedaGlobal] = useState('')
  const [verTodos, setVerTodos] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [vistaMode, setVistaMode] = useState(() => {
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const key = businessId ? `cotizaciones_vista-${businessId}` : 'cotizaciones_vista'
    return localStorage.getItem(key) || 'grid'
  })
  const [cotizacionAAnular, setCotizacionAAnular] = useState(null)
  const [cotizacionADespachar, setCotizacionADespachar] = useState(null)
  const [cotizacionAReciclar, setCotizacionAReciclar] = useState(null)
  const [cotizacionDetalle, setCotizacionDetalle] = useState(null)

  // Abrir modal de despacho cuando viene del builder
  useEffect(() => {
    if (despacharCotizacion) {
      setCotizacionADespachar(despacharCotizacion)
    }
  }, [despacharCotizacion])

  const { data: cotizaciones = [], isLoading, isError, refetch } = useCotizaciones({ estado: estadoFiltro, veTodos: verTodos })
  const { data: vendedores = [] } = useVendedores()
  const { data: clientes = [] } = useClientes()

  // Filtrar por vendedor (solo supervisor) y adaptar para admin
  const cotizacionesFiltradas = useMemo(() => {
    let filtered = cotizaciones
    if (vendedorFiltro) filtered = filtered.filter(c => c.vendedor_id === vendedorFiltro)
    if (esAdmin) {
      // Admin solo ve cotizaciones que tienen despacho
      filtered = filtered.filter(c => c.despacho)
      if (estadoFiltro) filtered = filtered.filter(c => c.despacho?.estado === estadoFiltro)
    }

    if (busquedaGlobal) {
      const q = removeAccents(busquedaGlobal.toLowerCase())
      const qClean = q.replace(/[\.\-\s]/g, '')
      filtered = filtered.filter(c => {
        const numStr = `cot-${String(c.numero).padStart(5, '0')}`
        const clienteNombre = removeAccents(c.cliente?.nombre || '').toLowerCase()
        const clienteRif = removeAccents(c.cliente?.rif_cedula || '').toLowerCase()
        const clienteRifClean = clienteRif.replace(/[\.\-\s]/g, '')
        const clienteCodigo = removeAccents(c.cliente?.codigo_cliente || '').toLowerCase()
        const totalStr = String(c.total_usd)
        
        return numStr.includes(q) || 
               String(c.numero).includes(q) ||
               clienteNombre.includes(q) || 
               clienteRif.includes(q) ||
               clienteCodigo.includes(q) ||
               (qClean.length > 2 && clienteRifClean.includes(qClean)) ||
               totalStr.includes(q)
      })
    }

    // Ordenar siempre por fecha de actualización descendente (lo más nuevo arriba)
    filtered = [...filtered].sort((a, b) => {
      const dateA = new Date(a.actualizado_en || a.creado_en || 0).getTime()
      const dateB = new Date(b.actualizado_en || b.creado_en || 0).getTime()
      return dateB - dateA
    })

    return filtered
  }, [cotizaciones, vendedorFiltro, esAdmin, estadoFiltro, busquedaGlobal])

  const ITEMS_POR_PAGINA = 12
  const totalPaginas = Math.max(1, Math.ceil(cotizacionesFiltradas.length / ITEMS_POR_PAGINA))
  const cotizacionesPaginadas = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return cotizacionesFiltradas.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [cotizacionesFiltradas, pagina])

  // Reset página al cambiar filtro
  useEffect(() => { setPagina(1) }, [estadoFiltro, vendedorFiltro, verTodos])

  // Subir al inicio al cambiar de página
  useEffect(() => {
    const mainContainer = document.querySelector('main')
    if (mainContainer) {
      mainContainer.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [pagina])

  const anular        = useAnularCotizacion()
  const cambiarEstado = useActualizarEstado()
  const crearDespacho = useCrearDespacho()
  const reciclar      = useReciclarCotizacion()
  const cambiarEstadoDespacho = useActualizarEstadoDespacho()

  function handleCambiarEstadoDespacho(despachoId, nuevoEstado, numeroCotizacion, clienteNombre, vendedorId = null) {
    cambiarEstadoDespacho.mutate({ despachoId, nuevoEstado, numeroCotizacion, clienteNombre, vendedorId })
  }

  async function confirmarAnular() {
    if (!cotizacionAAnular) return
    await anular.mutateAsync({ id: cotizacionAAnular.id, numero: cotizacionAAnular.numero })
    setCotizacionAAnular(null)
  }

  async function confirmarDespachar(formaPago = '', transportistaId = null, fleteUsd = 0, corteUsd = 0, referenciaPago = '', formaPagoCliente = '', notas = '', clienteFacturaId = null, dirEnvio = null, ciudadEnvio = null, estadoEnvio = null) {
    if (!cotizacionADespachar) return
    try {
      await crearDespacho.mutateAsync({
        cotizacionId: cotizacionADespachar.id,
        numeroCotizacion: cotizacionADespachar.numero,
        clienteNombre: cotizacionADespachar.cliente?.nombre,
        formaPago: formaPago || null,
        transportistaId: transportistaId || null,
        fleteUsd: fleteUsd || 0,
        corteUsd: corteUsd || 0,
        referenciaPago: referenciaPago || null,
        formaPagoCliente: formaPagoCliente || null,
        notas: notas || null,
        clienteFacturaId: clienteFacturaId || null,
        direccionEnvioDireccion: dirEnvio || null,
        direccionEnvioCiudad: ciudadEnvio || null,
        direccionEnvioEstado: estadoEnvio || null,
      })
      // Notificar si se asignó un cliente de facturación diferente al de la cotización
      if (clienteFacturaId && clienteFacturaId !== cotizacionADespachar.cliente_id) {
        const clienteFacturaNombre = clientes.find(c => c.id === clienteFacturaId)?.nombre || 'otro cliente'
        const clienteCotizacionNombre = cotizacionADespachar.cliente?.nombre || 'cliente original'
        notifyFacturacionClienteAjeno({
          numero: cotizacionADespachar.numero,
          clienteCotizacion: clienteCotizacionNombre,
          clienteFactura: clienteFacturaNombre,
          currentRole: perfil?.rol,
        })
      }
      setCotizacionADespachar(null)
      navigate('/despachos')
    } catch (err) {
      showToast(err.message || 'Error al crear despacho', 'error')
    }
  }

  async function confirmarReciclar() {
    if (!cotizacionAReciclar) return
    try {
      await reciclar.mutateAsync({
        cotizacionId: cotizacionAReciclar.id,
        vendedorDestinoId: perfil?.id,
      })
      setCotizacionAReciclar(null)
    } catch (err) {
      showToast(err.message || 'Error al reciclar cotización', 'error')
    }
  }

  function abrirReciclar(cot) {
    setCotizacionAReciclar(cot)
  }

  // Interceptar cambio de estado
  function handleCambiarEstado(id, estado, numero, clienteNombre, totalUsd, vendedorId) {
    cambiarEstado.mutate({ id, estado, numero, clienteNombre, totalUsd, vendedorId })
  }

  function handleEditar(cot) {
    onEditar(cot)
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* Encabezado */}
      <PageHeader
        icon={esAdmin ? PackageCheck : FileText}
        title={esAdmin ? 'Despachos' : 'Cotizaciones'}
        subtitle={isLoading ? 'Cargando...' : `${cotizacionesFiltradas.length} ${esAdmin ? 'despacho' : 'cotización'}${cotizacionesFiltradas.length !== 1 ? (esAdmin ? 's' : 'es') : ''}`}
        action={
          !esAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={onNueva} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Plus size={16} />Nueva
            </button>
          </div>
          )
        }
      />

      {/* Onboarding tips por rol */}
      <OnboardingSequence rol={perfil?.rol} page="/cotizaciones" />

      {/* ── Buscador Inteligente ── */}
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input 
          type="text"
          placeholder="Buscar por cliente, cédula/RIF, código, Nº cotización o monto..."
          value={busquedaGlobal}
          onChange={e => setBusquedaGlobal(e.target.value)}
          className="w-full pl-11 pr-10 py-3 rounded-2xl border-2 border-slate-200 bg-white text-sm focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm"
        />
        {busquedaGlobal && (
          <button onClick={() => setBusquedaGlobal('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-1 rounded-full transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filtros: fila 1 — tabs de estado (scroll horizontal) */}
      <div className="md:hidden">
        <EstadoDropdownCot filtros={esAdmin ? ESTADOS_FILTRO_ADMIN : ESTADOS_FILTRO} value={estadoFiltro} onChange={setEstadoFiltro} />
      </div>
      <div className="hidden md:block overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="flex items-center gap-1.5 w-max pb-0.5">
          {(esAdmin ? ESTADOS_FILTRO_ADMIN : ESTADOS_FILTRO).map(({ valor, label }) => (
            <button key={valor} onClick={() => setEstadoFiltro(valor)}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors border whitespace-nowrap ${
                estadoFiltro === valor
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-primary/40'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros: fila 2 — toggle vista personal + controles de vista */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {(esSupervisor || esDesarrollador) && (
            <ToggleVistaPersonal value={verTodos} onChange={v => { setVerTodos(v); setVendedorFiltro(''); setPagina(1) }} />
          )}
          {/* Vendedor en desktop inline */}
          {(esSupervisor || esDesarrollador) && verTodos && vendedores.length > 1 && (
            <div className="hidden md:block">
              <VendedorFilterPill vendedores={vendedores} value={vendedorFiltro} onChange={setVendedorFiltro} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex bg-slate-100 rounded-xl p-0.5">
            <button type="button" onClick={() => {
              setVistaMode('grid')
              const businessId = perfil?.cuenta_id
              const key = businessId ? `cotizaciones_vista-${businessId}` : 'cotizaciones_vista'
              localStorage.setItem(key, 'grid')
            }} title="Vista cuadrícula"
              className={`p-2 rounded-lg transition-colors ${vistaMode === 'grid' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <LayoutGrid size={16} />
            </button>
            <button type="button" onClick={() => {
              setVistaMode('list')
              const businessId = perfil?.cuenta_id
              const key = businessId ? `cotizaciones_vista-${businessId}` : 'cotizaciones_vista'
              localStorage.setItem(key, 'list')
            }} title="Vista lista"
              className={`p-2 rounded-lg transition-colors ${vistaMode === 'list' ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <List size={16} />
            </button>
          </div>
          <button onClick={() => refetch()} title="Recargar" className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filtro vendedor en móvil — fila separada */}
      {(esSupervisor || esDesarrollador) && verTodos && vendedores.length > 1 && (
        <div className="md:hidden">
          <VendedorFilterPill vendedores={vendedores} value={vendedorFiltro} onChange={setVendedorFiltro} />
        </div>
      )}

      {/* Contenido */}
      {isLoading ? (
        <SkeletonCotizaciones />
      ) : isError && cotizacionesFiltradas.length === 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar cotizaciones</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : cotizacionesFiltradas.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={estadoFiltro || vendedorFiltro ? 'Sin cotizaciones con estos filtros' : '¡Aún no tienes cotizaciones!'}
          description={estadoFiltro || vendedorFiltro ? 'Intenta con otro filtro.' : 'Crea tu primera cotización para empezar a vender.'}
          actionLabel={estadoFiltro || vendedorFiltro ? 'Limpiar filtros' : 'Nueva cotización'}
          onAction={estadoFiltro || vendedorFiltro ? () => { setEstadoFiltro(''); setVendedorFiltro('') } : onNueva}
        />
      ) : (
        <>
        {vistaMode === 'grid' ? (
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {cotizacionesPaginadas.map(c => (
              <CotizacionCard
                key={c.id}
                cotizacion={c}
                onEditar={handleEditar}
                onAnular={setCotizacionAAnular}
                onCambiarEstado={handleCambiarEstado}
                onDespachar={setCotizacionADespachar}
                onReciclar={abrirReciclar}
                onCambiarEstadoDespacho={handleCambiarEstadoDespacho}
                tasa={tasaEfectiva}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {cotizacionesPaginadas.map(c => (
              <CotizacionRow
                key={c.id}
                cotizacion={c}
                onEditar={handleEditar}
                onVer={setCotizacionDetalle}
                tasa={tasaEfectiva}
              />
            ))}
          </div>
        )}
        {totalPaginas > 1 && (
          <Pagination paginaActual={pagina} totalPaginas={totalPaginas} onCambiarPagina={setPagina} />
        )}
        </>
      )}

      {/* Detalle modal para vista lista */}
      <DetalleModal
        isOpen={!!cotizacionDetalle}
        onClose={() => setCotizacionDetalle(null)}
        tipo="cotizacion"
        registro={cotizacionDetalle}
        tasa={tasaEfectiva}
      />

      {/* Confirm anular — mensaje diferente según rol */}
      <ConfirmModal
        isOpen={!!cotizacionAAnular}
        onClose={() => setCotizacionAAnular(null)}
        onConfirm={confirmarAnular}
        title={getAction('anular', perfil?.rol).confirmTitle || '¿Anular cotización?'}
        message={getAction('anular', perfil?.rol).confirmMessage || 'Esta acción no se puede deshacer.'}
        confirmText={getAction('anular', perfil?.rol).confirmText || 'Sí, anular'}
        variant={getAction('anular', perfil?.rol).variant || 'danger'}
      />

      {/* Modal despachar con resumen */}
      <ModalDespachar
        cotizacion={cotizacionADespachar}
        onConfirm={confirmarDespachar}
        onCancel={() => setCotizacionADespachar(null)}
        cargando={crearDespacho.isPending}
        tasa={tasaEfectiva}
      />

      {/* Modal reciclar cotización */}
      <ConfirmModal
        isOpen={!!cotizacionAReciclar}
        onClose={() => setCotizacionAReciclar(null)}
        onConfirm={confirmarReciclar}
        title="¿Reutilizar cotización?"
        message={`Se creará un nuevo borrador con los mismos productos a nombre de ${perfil?.nombre || 'tu usuario'}.`}
        confirmText="Sí, reutilizar"
        variant="default"
      />
    </div>
  )
}

// ─── Vista raíz ───────────────────────────────────────────────────────────────
export default function CotizacionesView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [modo,      setModo]      = useState('lista')           // 'lista' | 'builder'
  const [editandoId, setEditandoId] = useState(null)            // ID del borrador a editar
  const [clientePreseleccionado, setClientePreseleccionado] = useState(null) // cliente_id desde URL
  const [pendienteDespachar, setPendienteDespachar] = useState(null)

  // Si viene ?nueva=1 del dashboard o clientes, abrir wizard directamente
  useEffect(() => {
    if (searchParams.get('nueva') === '1') {
      setEditandoId(null)
      setClientePreseleccionado(searchParams.get('cliente') || null)
      setModo('builder')
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const { data: cotizacionParaEditar } = useCotizacion(editandoId)
  const reabrirCotizacion = useReabrirCotizacion()

  function abrirNueva() {
    setEditandoId(null)
    setClientePreseleccionado(null)
    setModo('builder')
  }

  async function abrirEditar(cot) {
    // Si no es borrador, reabrir primero (cambiar estado a borrador)
    if (cot.estado !== 'borrador') {
      try {
        await reabrirCotizacion.mutateAsync(cot.id)
      } catch (e) {
        showToast(e.message || 'Error al reabrir cotización', 'error')
        return
      }
    }
    setEditandoId(cot.id)
    setModo('builder')
  }

  function volver() {
    setModo('lista')
    setEditandoId(null)
  }

  if (modo === 'builder') {
    // Si es edición, esperar que cargue la cotización con sus items
    if (editandoId && !cotizacionParaEditar) {
      return (
        <div className="flex items-center justify-center min-h-64">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )
    }

    return (
      <CotizacionBuilder
        cotizacionExistente={editandoId ? cotizacionParaEditar : null}
        clientePreseleccionado={clientePreseleccionado}
        onVolver={volver}
        onGuardado={volver}
        onDespachar={(cot) => { setPendienteDespachar(cot); volver() }}
      />
    )
  }

  return (
    <ListaCotizaciones
      onNueva={abrirNueva}
      onEditar={abrirEditar}
      despacharCotizacion={pendienteDespachar}
    />
  )
}

