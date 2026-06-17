// src/views/ReportesView.jsx
// Vista profesional de reportes administrativos con tabs
import { useState, useMemo, useCallback } from 'react'
import {
  BarChart3, CreditCard, RefreshCw, Download,
  FileText, DollarSign, AlertTriangle,
  Clock, Users, Percent, ArrowUpCircle, Loader2, Briefcase,
  ChevronDown, Globe, UserCheck, Printer, CheckCircle
} from 'lucide-react'
import { useReporteVentas } from '../hooks/useReporteVentas'
import { useReporteExternos } from '../hooks/useReporteExternos'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import { useComisiones, useComisionesResumen, useMarcarComisionPagada } from '../hooks/useComisiones'
import ConfirmModal from '../components/ui/ConfirmModal'
import { useResumenCxC } from '../hooks/useCuentasCobrar'
import { useProveedores } from '../hooks/useProveedores'
import { getDayRange, getWeekRange, getMonthRange } from '../utils/dateHelpers'
import { fmtUsd, fmtBs, removeAccents } from '../utils/format'
import useAuthStore from '../store/useAuthStore'
import Skeleton from '../components/ui/Skeleton'
import { useTasaCambio } from '../hooks/useTasaCambio'
import EmptyState from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import DateRangeSelector from '../components/reportes/DateRangeSelector'
import CustomSelect from '../components/ui/CustomSelect'
import KpiCards from '../components/reportes/KpiCards'
import TablaVendedores from '../components/reportes/TablaVendedores'
import TablaProductos from '../components/reportes/TablaProductos'
import TablaClientes from '../components/reportes/TablaClientes'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'


// ─── Tabs Definition ──────────────────────────────────────────────────────
const TABS = [
  { id: 'comisiones', label: 'Comisiones', short: 'Comis.', icon: Percent },
  { id: 'credito', label: 'Crédito', short: 'Créd.', icon: CreditCard },
  { id: 'ventas', label: 'Ventas', short: 'Ventas', icon: BarChart3 },
  { id: 'externos', label: 'Artículos Externos', short: 'Extern.', icon: Globe },
]

// ─── Skeleton ──────────────────────────────────────────────────────────────
function SkeletonReporte() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-2xl p-4 bg-slate-200/50 space-y-3">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-8 w-1/2 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <Skeleton className="h-4 w-1/3 rounded" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}

// ─── KPI Card (reusable) ──────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, gradient, border, light = false }) {
  if (light) {
    return (
      <div className="relative overflow-hidden rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 flex flex-col gap-1 sm:gap-2 min-w-0 bg-white border border-slate-200"
        style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
        <div className="flex items-start gap-1.5 relative z-10 min-w-0">
          <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-100">
            <Icon size={12} className="text-slate-600 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs font-medium leading-tight truncate text-slate-500">{label}</p>
          </div>
        </div>
        <p className="text-base sm:text-xl md:text-2xl font-black leading-tight text-slate-900 relative z-10 truncate">{value}</p>
        {sub && <p className="text-[11px] sm:text-xs relative z-10 truncate text-slate-400">{sub}</p>}
      </div>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-xl sm:rounded-2xl p-2.5 sm:p-3 md:p-4 flex flex-col gap-1 sm:gap-2 min-w-0"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      <div className="absolute -bottom-4 -right-4 w-16 sm:w-20 h-16 sm:h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-start gap-1.5 relative z-10 min-w-0">
        <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={12} className="text-white sm:w-3.5 sm:h-3.5 md:w-4 md:h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs font-medium leading-tight truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</p>
        </div>
      </div>
      <p className="text-base sm:text-xl md:text-2xl font-black leading-tight text-white relative z-10 truncate">{value}</p>
      {sub && <p className="text-[11px] sm:text-xs relative z-10 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</p>}
    </div>
  )
}

// ─── Forma de Pago Section ────────────────────────────────────────────────
function FormaPagoSection({ data = [], kpis }) {
  if (data.length === 0) return null
  const total = data.reduce((s, fp) => s + fp.totalUsd, 0)

  const fpCxc = data.find(fp => fp.formaPago === 'Cta por cobrar')
  const fpCod = data.find(fp => fp.formaPago === 'Cobro a destino')
  const totalCxc = (fpCxc ? fpCxc.totalUsd : 0) + (fpCod ? fpCod.totalUsd : 0)
  const fpDonacion = data.find(fp => fp.formaPago === 'Donación')
  const totalDonacion = fpDonacion ? fpDonacion.totalUsd : 0
  const totalDeducciones = totalCxc + totalDonacion
  const ventasSinCxc = total - totalDeducciones
  const COLORS = {
    'Efectivo $': '#10b981',
    'Efectivo Bs': '#22c55e',
    'Zelle': '#3b82f6',
    'Transf. / Pago Móvil': '#14b8a6',
    'USDT': '#f59e0b',
    'Punto de Venta': '#06b6d4',
    'Cruce': '#ec4899',
    'Donación': '#a855f7',
    'Préstamo': '#eab308',
    'Prestamo': '#eab308',
    'Cta por cobrar': '#ef4444',
    'Sin especificar': '#94a3b8'
  }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <CreditCard size={14} className="text-slate-500 sm:w-4 sm:h-4" />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">Formas de pago</h3>
      </div>
      <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
        {data.map(fp => {
          const pct = total > 0 ? (Math.max(0, fp.totalUsd) / total) * 100 : 0
          const color = COLORS[fp.formaPago] || '#64748b'
          return (
            <div key={fp.formaPago} className="space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="font-semibold text-slate-700 truncate">{fp.formaPago}</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold shrink-0">{fp.count}</span>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <span className="text-[10px] sm:text-xs text-slate-400">{pct.toFixed(0)}%</span>
                    <span className="font-bold text-slate-800 text-xs sm:text-sm">{fmtUsd(fp.totalUsd)}</span>
                  </div>
                  {['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && (
                    <span className="text-[9.5px] sm:text-[10px] text-indigo-600 font-semibold mt-0.5">
                      {fmtBs(fp.pagos?.reduce((s, p) => s + (Number(p.montoBs) || 0), 0) || 0)}
                    </span>
                  )}
                </div>
              </div>
              <div className="h-2 sm:h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
              </div>
              {Array.isArray(fp.pagos) && fp.pagos.length > 0 && (
                <div className="pl-4 pt-1 space-y-0.5">
                  {fp.pagos.map((p, pIdx) => (
                    <div key={pIdx} className="flex justify-between text-[9px] sm:text-[10px] text-slate-500 font-medium bg-slate-50/50 hover:bg-slate-50 px-1.5 py-0.5 rounded border border-transparent hover:border-slate-100">
                      <span className="truncate max-w-[200px] sm:max-w-[280px]">
                        {p.es_reembolso ? (
                          <span className="text-rose-600 font-bold">
                            [REEMBOLSO] {p.descripcion} · {p.cliente}
                          </span>
                        ) : (
                          `Doc #${p.numero || 'S/N'}${p.referencia ? ` · Ref: ${p.referencia}` : ''} · ${p.cliente}`
                        )}
                      </span>
                      <span className={`font-bold shrink-0 ${p.es_reembolso ? 'text-rose-600' : 'text-slate-700'}`}>
                        {p.es_reembolso ? '-' : ''}{fmtUsd(Math.abs(p.monto))}
                        {!p.es_reembolso && ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && p.montoBs && (
                          <span className="text-[8.5px] text-indigo-600 font-semibold ml-1.5" title={`Tasa: ${p.tasa} Bs.`}>
                            ({fmtBs(p.montoBs)})
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Fila de Total */}
        <div className="pt-2.5 border-t border-slate-200 mt-2 space-y-2">
          <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-slate-800">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-extrabold">TOTAL RECAUDADO</span>
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold">({data.reduce((s, fp) => s + (fp.count || 0), 0)} desp.)</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-[10px] sm:text-xs text-slate-500">100%</span>
              <span className="font-black text-slate-900 text-xs sm:text-sm">{fmtUsd(total)}</span>
            </div>
          </div>

          {/* Desglose por Monedas solicitado */}
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] sm:text-xs text-slate-600 font-semibold">
              <span>Total en Divisas (Efectivo $, Zelle, USDT)</span>
              <span className="font-bold text-slate-800">
                {fmtUsd(data.filter(fp => ['Efectivo $', 'Zelle', 'USDT'].includes(fp.formaPago)).reduce((s, fp) => s + fp.totalUsd, 0))}
              </span>
            </div>
            <div className="flex justify-between items-center text-[10px] sm:text-xs text-indigo-600 font-semibold">
              <span>Total en Bolívares (Efectivo Bs, Transf, P. Venta)</span>
              <span className="font-bold text-indigo-700">
                {fmtBs(
                  data
                    .filter(fp => ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago))
                    .reduce((s, fp) => s + (fp.pagos?.reduce((sum, p) => sum + (Number(p.montoBs) || 0), 0) || 0), 0)
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Desglose explicativo */}
        {kpis && (
          <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-1.5 text-[10px] sm:text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl">
            <p className="font-extrabold text-slate-700 uppercase tracking-wider text-[8px] sm:text-[9px] mb-1">
              Desglose de la Diferencia (Recaudación vs Ventas Netas):
            </p>
            <div className="flex justify-between items-center">
              <span>Ventas Netas (Mercancía)</span>
              <span className="font-bold text-slate-700">{fmtUsd(kpis.totalVentas)}</span>
            </div>
            {kpis.totalFlete > 0 && (
              <div className="flex justify-between items-center">
                <span>Fletes / Envío Cobrado</span>
                <span className="font-bold text-emerald-600">+{fmtUsd(kpis.totalFlete)}</span>
              </div>
            )}
            {kpis.totalDevoluciones > 0 && (
              <div className="flex justify-between items-center">
                <span>Devolución de Saldo a Favor</span>
                <span className="font-bold text-rose-600">-{fmtUsd(kpis.totalDevoluciones)}</span>
              </div>
            )}
            <div className="border-t border-slate-200 pt-1 mt-1 flex justify-between items-center font-black text-slate-800 text-[11px] sm:text-xs">
              <span>Total Recaudado</span>
              <span>{fmtUsd(total)}</span>
            </div>

            {(totalCxc > 0 || totalDonacion > 0) && (
              <div className="pt-1.5 border-t border-slate-200/60 mt-1.5 space-y-1.5">
                {totalCxc > 0 && (
                  <div className="flex justify-between items-center text-slate-500">
                    <span>CxC y COD Pendientes</span>
                    <span className="font-bold text-red-500">-{fmtUsd(totalCxc)}</span>
                  </div>
                )}
                {totalDonacion > 0 && (
                  <div className="flex justify-between items-center text-slate-500">
                    <span>Donaciones</span>
                    <span className="font-bold text-purple-500">-{fmtUsd(totalDonacion)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center font-extrabold text-slate-800 bg-slate-200/40 p-1.5 rounded-lg text-[10.5px] sm:text-[11.5px]">
                  <span>Ventas Líquidas (Recaudación Real)</span>
                  <span className="font-black text-slate-900">{fmtUsd(ventasSinCxc)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Estado Badge ─────────────────────────────────────────────────────────
const ESTADO_STYLES = {
  borrador: 'bg-slate-100 text-slate-600',
  enviada: 'bg-blue-100 text-blue-700',
  aceptada: 'bg-emerald-100 text-emerald-700',
  rechazada: 'bg-red-100 text-red-700',
  vencida: 'bg-amber-100 text-amber-700',
  anulada: 'bg-gray-100 text-gray-500',
  pendiente: 'bg-amber-100 text-amber-700',
  despachada: 'bg-blue-100 text-blue-700',
  entregada: 'bg-emerald-100 text-emerald-700',
  pagada: 'bg-emerald-100 text-emerald-700',
}

// ─── Tabla genérica admin ─────────────────────────────────────────────────
function AdminTable({ icon: Icon, iconColor, title, headers, rows, emptyText }) {
  if (rows.length === 0) return null
  const visibleHeaders = headers.filter(h => !h.hidden)
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={14} className={`${iconColor} sm:w-4 sm:h-4`} />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
              {visibleHeaders.map((h, i) => (
                <th key={i} className={`px-2 sm:px-4 py-2 font-semibold ${h.align || 'text-left'}`}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                {row.filter(cell => !cell.hidden).map((cell, j) => (
                  <td key={j} className={`px-2 sm:px-4 py-2 sm:py-2.5 ${cell.className || ''}`}>{cell.content}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Bar section ──────────────────────────────────────────────────────────
function BarSection({ icon: Icon, iconColor, title, data, labelKey, countKey, countSuffix, valueKey }) {
  if (!data || data.length === 0) return null
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0)

  const ESTADO_BAR_COLORS = {
    borrador: '#94a3b8', enviada: '#3b82f6', aceptada: '#10b981',
    rechazada: '#ef4444', vencida: '#f59e0b', anulada: '#6b7280',
    pendiente: '#f59e0b', despachada: '#3b82f6', entregada: '#10b981',
  }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={14} className={`${iconColor} sm:w-4 sm:h-4`} />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
        {data.filter(d => d[countKey] > 0).map((d, i) => {
          const pct = total > 0 ? (d[valueKey] / total) * 100 : 0
          const color = ESTADO_BAR_COLORS[d[labelKey]] || '#64748b'
          const label = d[labelKey].charAt(0).toUpperCase() + d[labelKey].slice(1)
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="font-semibold text-slate-700 truncate">{label}</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold shrink-0">{d[countKey]} {countSuffix}</span>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <span className="text-[10px] sm:text-xs text-slate-400">{pct.toFixed(0)}%</span>
                  <span className="font-bold text-slate-800 text-xs sm:text-sm">{fmtUsd(d[valueKey])}</span>
                </div>
              </div>
              <div className="h-2 sm:h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(pct, 1)}%`, background: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Aging Table ──────────────────────────────────────────────────────────
function AgingSection({ title, data, countLabel }) {
  if (!data || data.every(a => a.count === 0)) return null
  const agingColors = ['text-emerald-600', 'text-amber-600', 'text-amber-600', 'text-red-600']
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
        <Clock size={14} className="text-amber-500 sm:w-4 sm:h-4" />
        <h3 className="text-xs sm:text-sm font-black text-slate-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
              <th className="text-left px-2 sm:px-4 py-2 font-semibold">Rango</th>
              <th className="text-center px-2 sm:px-4 py-2 font-semibold">{countLabel}</th>
              <th className="text-right px-2 sm:px-4 py-2 font-semibold">Monto USD</th>
            </tr>
          </thead>
          <tbody>
            {data.filter(a => a.count > 0).map((a, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="px-2 sm:px-4 py-2 font-medium text-slate-700">{a.rango}</td>
                <td className="px-2 sm:px-4 py-2 text-center text-slate-600">{a.count}</td>
                <td className={`px-2 sm:px-4 py-2 text-right font-bold ${agingColors[i] || 'text-slate-800'}`}>{fmtUsd(a.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper to filter sales report data for PDF generation
function filtrarReporteVentas(reporte, tipoFiltro) {
  if (tipoFiltro === 'todos') return reporte

  const esExterno = (v) => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)

  // 1. Filtrar porVendedor
  const filteredPorVendedor = (reporte.porVendedor || []).filter(v => {
    const check = esExterno(v)
    return tipoFiltro === 'externos' ? check : !check
  })

  const sellerIds = new Set(filteredPorVendedor.map(v => v.id))

  // 2. Filtrar despachos
  const filteredDespachos = (reporte.despachos || []).filter(d => {
    const vid = d.asesor_id || 'unassigned'
    return sellerIds.has(vid)
  })

  // 3. Recalcular KPIs
  const totalVentas = filteredDespachos.reduce((s, d) => s + Number(d.venta_neta_usd || 0), 0)
  const totalFlete = filteredDespachos.reduce((s, d) => s + Number(d.flete_usd || 0), 0)
  const totalDescuentos = filteredDespachos.reduce((s, d) => s + Number(d.descuento_usd || 0), 0)
  const numDespachos = filteredDespachos.length
  const ticketPromedio = numDespachos > 0 ? totalVentas / numDespachos : 0

  const totalComisiones = filteredPorVendedor.reduce((s, v) => s + Number(v.comision || 0), 0)
  const comisionesPagadas = 0
  const comisionesPendientes = totalComisiones
  const comisionCabilla2 = filteredPorVendedor.reduce((s, v) => s + Number(v.comisionCabilla2 || 0), 0)
  const comisionCabilla3 = filteredPorVendedor.reduce((s, v) => s + Number(v.comisionCabilla3 || 0), 0)
  const comisionOtros = filteredPorVendedor.reduce((s, v) => s + Number(v.comisionOtros || 0), 0)

  // 4. Recalcular Formas de Pago
  const formaPagoMap = {}
  filteredDespachos.forEach(d => {
    const formas = Array.isArray(d.forma_pago) ? d.forma_pago : []
    const tasaDespacho = Number(d.tasa)
    const tasaValida = tasaDespacho > 0 ? tasaDespacho : null

    if (formas.length === 0) {
      const fallback = 'Pendiente'
      if (!formaPagoMap[fallback]) formaPagoMap[fallback] = { formaPago: fallback, count: 0, totalUsd: 0, pagos: [] }
      formaPagoMap[fallback].count++
      formaPagoMap[fallback].totalUsd += Number(d.venta_neta_usd || 0)
      formaPagoMap[fallback].pagos.push({
        cliente: d.cliente_nombre || 'Sin cliente',
        numero: d.despacho_numero || d.despacho_id?.slice(0, 8),
        monto: Number(d.venta_neta_usd || 0),
        tasa: tasaValida,
        montoBs: tasaValida ? Number(d.venta_neta_usd || 0) * tasaValida : null,
        referencia: null,
        es_prestamo_puro: d.es_prestamo_puro,
        es_prestamo_mixto: d.es_prestamo_mixto
      })
    } else {
      formas.forEach(f => {
        const nombre = f.metodo || 'Sin especificar'
        const monto = Number(f.monto) || 0
        if (!formaPagoMap[nombre]) formaPagoMap[nombre] = { formaPago: nombre, count: 0, totalUsd: 0, pagos: [] }
        formaPagoMap[nombre].count++
        formaPagoMap[nombre].totalUsd += monto
        formaPagoMap[nombre].pagos.push({
          cliente: d.cliente_nombre || 'Sin cliente',
          numero: d.despacho_numero || d.despacho_id?.slice(0, 8),
          monto: monto,
          tasa: tasaValida,
          montoBs: tasaValida ? monto * tasaValida : null,
          referencia: f.referencia || null,
          es_prestamo_puro: d.es_prestamo_puro,
          es_prestamo_mixto: d.es_prestamo_mixto
        })
      })
    }
  })
  const porFormaPago = Object.values(formaPagoMap).sort((a, b) => b.totalUsd - a.totalUsd)

  return {
    ...reporte,
    kpis: {
      totalVentas,
      totalFlete,
      totalDescuentos,
      numDespachos,
      ticketPromedio,
      totalComisiones,
      comisionesPagadas,
      comisionesPendientes,
      comisionCabilla2,
      comisionCabilla3,
      comisionOtros,
      prevTotalVentas: 0,
      prevNumDespachos: 0,
      prevTicketPromedio: 0,
      prevTotalComisiones: 0,
    },
    porVendedor: filteredPorVendedor,
    porFormaPago,
    despachos: filteredDespachos,
  }
}

// ─── Tab Ventas ───────────────────────────────────────────────────────────────
function TabVentas({ configNeg }) {
  const [rango, setRango] = useState(() => {
    const actual = getDayRange(0)
    const anterior = getDayRange(-1)
    return { from: actual.from, to: actual.to, prevFrom: anterior.from, prevTo: anterior.to }
  })
  const [exportando, setExportando] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)

  const { data: reporte, isLoading, isError, refetch } = useReporteVentas({
    from: rango.from,
    to: rango.to,
    prevFrom: rango.prevFrom,
    prevTo: rango.prevTo,
  })

  async function exportarPDF(tipoFiltro = 'todos', accion = 'descargar') {
    if (!reporte) return
    setExportando(true)
    try {
      const { generarReporteVentasPDF } = await import('../services/pdf/comisionesPDF')
      
      const reporteFiltrado = filtrarReporteVentas(reporte, tipoFiltro)

      const reportePDF = {
        ...reporteFiltrado,
        tipoFiltro,
        porVendedor: (reporteFiltrado.porVendedor || []).map(v => ({
          ...v,
          vendedor: v.nombre,
          vendedorColor: v.color,
          count: v.despachos,
        })),
        porCliente: (reporteFiltrado.porCliente || []).map(c => ({
          ...c,
          cliente: c.nombre,
          count: c.despachos,
        })),
      }
      await generarReporteVentasPDF({ 
        reporte: reportePDF, 
        rango, 
        config: configNeg, 
        action: accion === 'imprimir' ? 'print' : 'download'
      })
    } catch (e) {
      console.error('Error generando reporte de ventas:', e)
    } finally {
      setExportando(false)
    }
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />
  if (!reporte) return null

  const { kpis, porVendedor, porCliente, porProducto, porCategoria, porFormaPago, despachos, devoluciones = [] } = reporte
  const rangoLabel = `${new Date(`${rango.from}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })} - ${new Date(`${rango.to}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`

  const METODO_PAGOS_STYLES = {
    'Efectivo $': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'Efectivo Bs': 'bg-green-50 text-green-700 border-green-100',
    'Zelle': 'bg-blue-50 text-blue-700 border-blue-100',
    'Transf. / Pago Móvil': 'bg-teal-50 text-teal-700 border-teal-100',
    'USDT': 'bg-amber-50 text-amber-700 border-amber-100',
    'Punto de Venta': 'bg-cyan-50 text-cyan-700 border-cyan-100',
    'Cruce': 'bg-pink-50 text-pink-700 border-pink-100',
    'Donación': 'bg-purple-50 text-purple-700 border-purple-100',
    'Préstamo': 'bg-amber-50 text-amber-700 border-amber-100',
    'Prestamo': 'bg-amber-50 text-amber-700 border-amber-100',
    'Cta por cobrar': 'bg-red-50 text-red-700 border-red-100',
    'Saldo a Favor': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'Sin especificar': 'bg-slate-50 text-slate-600 border-slate-100',
  }

  const ESTADO_STYLES = {
    despachada: 'bg-blue-100 text-blue-700',
    entregada: 'bg-emerald-100 text-emerald-700',
    pagada: 'bg-emerald-100 text-emerald-700',
    pendiente: 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="space-y-4">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-6">
          <div className="w-full">
            <div className="flex items-center gap-2 ml-1 mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Periodo de ventas</label>
              <span className="hidden sm:inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                {rangoLabel}
              </span>
            </div>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>
          
          <div className="flex justify-end items-center gap-3 border-t border-slate-50 pt-4 relative">
            
            {/* BOTÓN IMPRIMIR PDF */}
            <div className="relative">
              <button
                onClick={() => setShowPrintMenu(!showPrintMenu)}
                disabled={exportando || !despachos.length}
                className="flex items-center gap-2 text-xs font-black px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
              >
                <Printer size={13} className="text-slate-500" />
                {exportando ? 'Generando...' : 'Imprimir PDF'}
                <ChevronDown size={13} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
              </button>

              {showPrintMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)} />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <button
                      onClick={() => {
                        setShowPrintMenu(false)
                        exportarPDF('todos', 'imprimir')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                    >
                      <FileText size={14} className="text-slate-400" />
                      Imprimir PDF Completo
                    </button>
                    <button
                      onClick={() => {
                        setShowPrintMenu(false)
                        exportarPDF('internos', 'imprimir')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <UserCheck size={14} className="text-indigo-500" />
                      Imprimir Solo Internos
                    </button>
                    <button
                      onClick={() => {
                        setShowPrintMenu(false)
                        exportarPDF('externos', 'imprimir')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <Globe size={14} className="text-amber-500" />
                      Imprimir Solo Externos
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* BOTÓN DESCARGAR PDF */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={exportando || !despachos.length}
                className="flex items-center gap-2 text-xs font-black px-5 py-2.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-indigo-100/40"
                style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
              >
                <Download size={13} />
                {exportando ? 'Generando...' : 'Descargar PDF'}
                <ChevronDown size={13} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
              </button>

              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <button
                      onClick={() => {
                        setShowExportMenu(false)
                        exportarPDF('todos', 'descargar')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                    >
                      <FileText size={14} className="text-slate-400" />
                      Descargar PDF Completo
                    </button>
                    <button
                      onClick={() => {
                        setShowExportMenu(false)
                        exportarPDF('internos', 'descargar')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <UserCheck size={14} className="text-indigo-500" />
                      Descargar Solo Internos
                    </button>
                    <button
                      onClick={() => {
                        setShowExportMenu(false)
                        exportarPDF('externos', 'descargar')
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-50"
                    >
                      <Globe size={14} className="text-amber-500" />
                      Descargar Solo Externos
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      </div>

      {despachos.length === 0 ? (
        <EmptyState icon={BarChart3} title="Sin ventas procesadas" description="No hay despachos aprobados o entregados en el periodo seleccionado." />
      ) : (
        <>
          <KpiCards kpis={kpis} />

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-4">
            <TablaVendedores data={porVendedor} />
            <FormaPagoSection data={porFormaPago} kpis={kpis} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <TablaProductos porProducto={porProducto} porCategoria={porCategoria} />
            <TablaClientes data={porCliente} />
          </div>

          {/* Tabla de Despachos Premium */}
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-3 sm:px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-slate-500" />
                <h3 className="text-sm font-black text-slate-800">Últimos despachos procesados</h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="text-[10px] sm:text-xs text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                    <th className="px-3 py-2.5 font-semibold text-center w-12">#</th>
                    <th className="px-3 py-2.5 font-semibold text-center w-24">Estado</th>
                    <th className="px-3 py-2.5 font-semibold text-left">Cliente</th>
                    <th className="px-3 py-2.5 font-semibold text-left">Asesor</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Fecha</th>
                    <th className="px-3 py-2.5 font-semibold text-left">Forma de Pago</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Total USD</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Total Bs</th>
                  </tr>
                </thead>
                <tbody>
                  {despachos.slice(0, 15).map((d, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-0.5 justify-center">
                          <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-md font-mono font-bold text-[11px]">
                            {d.despacho_numero || '—'}
                          </span>
                          {d.es_prestamo_puro && (
                            <span className="text-[8px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded uppercase tracking-wide leading-none">
                              Préstamo
                            </span>
                          )}
                          {d.es_prestamo_mixto && (
                            <span className="text-[8px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 py-0.2 rounded uppercase tracking-wide leading-none">
                              Mixto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${ESTADO_STYLES[d.estado] || 'bg-slate-100 text-slate-600'}`}>
                          {d.estado === 'despachada' ? 'Aprobada' : d.estado === 'entregada' ? 'Entregada' : d.estado}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-800 truncate max-w-[150px]">
                        {d.cliente_nombre || 'Sin cliente'}
                        {d.cliente_tipo_cliente === 'personal' && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 rounded">
                            Personal
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: d.asesor_color || '#64748b' }} />
                          <span className="font-semibold text-slate-600 truncate max-w-[100px]">{d.asesor_nombre || 'Sin asesor'}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center font-medium text-slate-500">
                        {d.fecha ? new Date(d.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {Array.isArray(d.forma_pago) && d.forma_pago.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {d.forma_pago.map((fp, idx) => {
                              const tasa = Number(d.tasa)
                              const montoBs = tasa > 0 ? Number(fp.monto) * tasa : null
                              return (
                                <span key={idx} className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide border ${METODO_PAGOS_STYLES[fp.metodo] || METODO_PAGOS_STYLES['Sin especificar']}`}>
                                  {fp.metodo}: ${Number(fp.monto).toLocaleString('es-VE', { maximumFractionDigits: 2 })}{fp.referencia ? ` (Ref: ${fp.referencia})` : ''}
                                  {['Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.metodo) && montoBs !== null && (
                                    <span className="opacity-80 font-bold ml-1">
                                      (Bs {montoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                    </span>
                                  )}
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400">Pendiente</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-black text-slate-800">
                        {fmtUsd(d.venta_neta_usd)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-indigo-600 text-xs">
                        {fmtBs(d.total_bs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Resumen de totales inferior */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-semibold text-slate-500 shadow-inner">
              <div className="flex items-center gap-1.5">
                <span>Total procesados:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-700 font-bold">{despachos.length}</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span>Aprobados:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 font-bold">
                  {despachos.filter(d => d.estado === 'despachada').length}
                </span>
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span>Entregados:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-bold">
                  {despachos.filter(d => d.estado === 'entregada').length}
                </span>
              </div>
              <div className="flex items-center gap-1.5 sm:ml-auto mt-1 sm:mt-0">
                <span className="uppercase tracking-wider text-[10px] font-bold text-slate-400">Facturado Neto:</span>
                <span className="text-sm font-black text-slate-800">{fmtUsd(kpis.totalVentas)}</span>
              </div>
            </div>
          </div>

          {/* Tabla de Devoluciones de Saldo a Favor */}
          {devoluciones.length > 0 && (
            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-3 sm:px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpCircle size={16} className="text-rose-500 shrink-0" />
                  <h3 className="text-sm font-black text-slate-800">Devoluciones de Saldo a Favor (Reembolsos a Clientes)</h3>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-[10px] sm:text-xs text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                      <th className="px-3 py-2.5 font-semibold text-left">Cliente</th>
                      <th className="px-3 py-2.5 font-semibold text-left">Asesor</th>
                      <th className="px-3 py-2.5 font-semibold text-center">Fecha</th>
                      <th className="px-3 py-2.5 font-semibold text-left">Forma de Pago</th>
                      <th className="px-3 py-2.5 font-semibold text-left">Referencia</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Monto Devuelto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devoluciones.map((dev, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-slate-800 truncate max-w-[180px]">
                          {dev.cliente_nombre || 'Sin cliente'}
                          {dev.cliente_tipo_cliente === 'personal' && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 rounded">
                              Personal
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: dev.vendedor_color || '#64748b' }} />
                            <span className="font-semibold text-slate-600 truncate max-w-[120px]">{dev.vendedor_nombre}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center font-medium text-slate-500">
                          {dev.creado_en ? new Date(dev.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide border ${METODO_PAGOS_STYLES[dev.forma_pago_abono] || 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                            {dev.forma_pago_abono || 'Sin especificar'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-500 truncate max-w-[150px]">
                          {dev.referencia || dev.descripcion || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-black text-rose-600">
                          -{fmtUsd(dev.monto_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Modal Detalle Vendedor ──────────────────────────────────────────────────
function ModalDetalleVendedor({ vendedor, rango, isOpen, onClose, configNeg, ajustesManuales = {} }) {
  const { data: comisionesRes, isLoading } = useComisiones({
    desde: rango?.from,
    hasta: rango?.to,
    vendedorId: vendedor?.id,
    pageSize: 1000
  })
  const detalle = comisionesRes?.data ?? []

  const marcar = useMarcarComisionPagada()
  const { perfil } = useAuthStore()
  const { tasaEuro } = useTasaCambio()
  const esAdmin = perfil?.rol === 'administracion'
  const esJefe = perfil?.rol === 'jefe'
  const esDev = perfil?.rol === 'desarrollador'
  const puedePagarComisiones = esAdmin || esJefe || esDev

  const catPrincipal = configNeg?.comision_categoria_cabilla || 'Cabilla'
  const esExterno = !!vendedor?.es_externo || (vendedor?.markup_pct != null && Number(vendedor.markup_pct) > 0)
  const pctCabilla = esExterno ? (configNeg?.comision_ext_pct_cabilla || 2) : (configNeg?.comision_pct_cabilla || 2)
  const labelCabillaHeader = esExterno ? `Cemento (${pctCabilla}%)` : `${catPrincipal} (${pctCabilla}%)`

  const [comisionAPagar, setComisionAPagar] = useState(null)
  const [pagoMasivoData, setPagoMasivoData] = useState(null)
  const [pagandoMasivo, setPagandoMasivo] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())

  const comisionesPendientes = useMemo(() => {
    return detalle.filter(c => c.estado !== 'pagada')
  }, [detalle])

  const comisionesSoloPendientes = useMemo(() => {
    return detalle.filter(c => c.estado === 'pendiente')
  }, [detalle])

  const montoPendiente = useMemo(() => {
    return comisionesPendientes.reduce((acc, c) => {
      return acc + Math.max(0, Number(c.totalcomision || 0) - Number(c.montopagado || 0))
    }, 0)
  }, [comisionesPendientes])

  const montoSoloPendiente = useMemo(() => {
    return comisionesSoloPendientes.reduce((acc, c) => {
      return acc + Math.max(0, Number(c.totalcomision || 0) - Number(c.montopagado || 0))
    }, 0)
  }, [comisionesSoloPendientes])

  // Derived: selected pending commissions and their total
  const selectedPendientes = useMemo(() => {
    return comisionesPendientes.filter(c => selectedIds.has(c.id))
  }, [comisionesPendientes, selectedIds])

  const montoSeleccionado = useMemo(() => {
    return selectedPendientes.reduce((acc, c) => {
      return acc + Math.max(0, Number(c.totalcomision || 0) - Number(c.montopagado || 0))
    }, 0)
  }, [selectedPendientes])

  const allPendienteIds = useMemo(() => comisionesPendientes.map(c => c.id), [comisionesPendientes])
  const allSelected = allPendienteIds.length > 0 && allPendienteIds.every(id => selectedIds.has(id))
  const someSelected = allPendienteIds.some(id => selectedIds.has(id))

  const toggleId = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allPendienteIds))
    }
  }

  const tasaComision = (item) => tasaEuro?.precio || Number(item.despacho?.tasa_snapshot || item.cotizacion?.tasa_bcv_snapshot || 0)

  // Calcular totales del detalle
  const totales = detalle.reduce((acc, item) => {
    const total = Number(item.totalcomision || 0)
    acc.totalUsd += total
    acc.comBs += total * tasaComision(item)
    return acc
  }, { totalUsd: 0, comBs: 0 })

  const [exportando, setExportando] = useState(false)
  const [formatoReporte, setFormatoReporte] = useState('detallado') // 'detallado', 'resumido'

  const totalConAjustes = useMemo(() => {
    if (!vendedor) return totales;
    const aj = ajustesManuales[vendedor.id] || { cxc: '', descuentoCarro: '' };
    const cxcVal = Number(aj.cxc) || 0;
    const descVal = Number(aj.descuentoCarro) || 0;
    const rate = tasaEuro?.precio || 0;

    if (formatoReporte === 'resumido') {
      const adjustedUsd = totales.totalUsd + cxcVal - descVal;
      const adjustedBs = adjustedUsd * rate;
      return { totalUsd: adjustedUsd, comBs: adjustedBs };
    }
    return totales;
  }, [totales, vendedor, ajustesManuales, formatoReporte, tasaEuro])

  async function exportarPDF(action = 'download') {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')

      let query = supabase
        .from('comision_liberaciones')
        .select(`
          id,
          comision_id,
          despacho_id,
          vendedor_id,
          cuenta_id,
          monto,
          tipo,
          cxc_id,
          creado_en,
          comisiones:comisiones!inner(
            id,
            totalcomision,
            comisioncabilla,
            comisionotros,
            pctcabilla,
            pctotros,
            estado,
            montopagado,
            cotizacionid,
            vendedor:usuarios(id, nombre, color, markup_pct, rol, es_externo),
            despacho:notas_despacho(
              id,
              numero,
              total_usd,
              tasa_snapshot,
              cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre, tipo_cliente),
              productos:notas_despacho_items(nombre_snap)
            )
          )
        `)
        .order('creado_en', { ascending: false })

      if (rango?.from) {
        query = query.gte('creado_en', `${rango.from}T00:00:00-04:00`)
      }
      if (rango?.to) {
        query = query.lte('creado_en', `${rango.to}T23:59:59-04:00`)
      }
      if (vendedor?.id) {
        query = query.eq('vendedor_id', vendedor.id)
      }

      const { data: rawEvents, error: errEvents } = await query

      if (errEvents) {
        console.error('Error fetching events:', errEvents)
        alert('❌ Error al obtener las liberaciones de comisión: ' + errEvents.message)
        return
      }

      if (!rawEvents || rawEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay liberaciones de comisiones para ${vendedor?.nombre || 'este vendedor'} en el periodo seleccionado.`)
        return
      }

      // Fetch cotizaciones
      const cotizacionIds = [...new Set(rawEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
      let cotizacionesMap = {}
      if (cotizacionIds.length > 0) {
        const { data: cotList, error: cotErr } = await supabase
          .from('cotizaciones')
          .select('id, numero, tasa_bcv_snapshot, cliente:clientes(id, nombre)')
          .in('id', cotizacionIds)
        if (!cotErr && cotList) {
          cotizacionesMap = Object.fromEntries(cotList.map(c => [c.id, c]))
        }
      }

      const comisionesParaPDF = rawEvents.map(r => {
        const com = r.comisiones || {};
        const desp = com.despacho || {};
        const cot = cotizacionesMap[com.cotizacionid];
        return {
          id: r.id,
          monto: Number(r.monto || 0),
          tipo: r.tipo,
          creado_en: r.creado_en,
          comisiones: {
            id: com.id,
            totalcomision: Number(com.totalcomision || 0),
            comisioncabilla: Number(com.comisioncabilla || 0),
            comisionotros: Number(com.comisionotros || 0),
            pctcabilla: Number(com.pctcabilla || 0),
            pctotros: Number(com.pctotros || 0),
            estado: com.estado,
            montopagado: Number(com.montopagado || 0),
            cotizacionid: com.cotizacionid,
            despacho: desp ? {
              id: desp.id,
              numero: desp.numero,
              totalusd: desp.total_usd,
              tasa_snapshot: desp.tasa_snapshot,
              cliente: desp.cliente,
              productos: desp.productos || []
            } : null,
            cotizacion: cot ? {
              id: cot.id,
              numero: cot.numero,
              tasa_bcv_snapshot: cot.tasa_bcv_snapshot,
              cliente_nombre: cot.cliente?.nombre || null
            } : null
          },
          vendedor: r.vendedor || com.vendedor || {
            id: vendedor?.id,
            nombre: vendedor?.nombre,
            color: vendedor?.color,
            markup_pct: vendedor?.markup_pct,
            es_externo: vendedor?.es_externo
          }
        };
      });

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: { nombre: vendedor?.nombre, color: vendedor?.color, markup_pct: vendedor?.markup_pct, es_externo: vendedor?.es_externo },
        rango,
        config: configNeg ?? {},
        action,
        formato: formatoReporte,
        tasaEuro: tasaEuro?.precio || 0,
        ajustesManuales
      })
    } catch (e) {
      console.error('Error generando PDF individual:', e)
      alert('❌ Error al generar el PDF: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <span>Detalle de Comisiones - {vendedor?.nombre || 'Vendedor'}</span>
          {vendedor && (!!vendedor.es_externo || (vendedor.markup_pct != null && Number(vendedor.markup_pct) > 0)) && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.5">
              💼 {vendedor.markup_pct ? `Externo (+${vendedor.markup_pct}%)` : 'Externo'}
            </span>
          )}
        </div>
      }
      className="max-w-6xl"
    >
      {isLoading ? <SkeletonReporte /> : (
        <div className="space-y-4">
          {/* Fila 1: KPIs - siempre en ancho completo */}
          <div className="grid grid-cols-2 gap-4">
            <KpiCard icon={DollarSign} label="Total Comisión USD" value={fmtUsd(totalConAjustes.totalUsd)} gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={Percent} label="Total Comisión Bs" value={fmtBs(totalConAjustes.comBs)} gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
          </div>

          {/* Fila 2: Acciones */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={(e) => { e.stopPropagation(); exportarPDF('download'); }}
              disabled={exportando}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-all duration-200 border border-slate-700 shadow-md active:scale-95 disabled:opacity-50 group font-bold text-xs tracking-wide"
              title="Descargar Reporte PDF"
            >
              {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} className="group-hover:translate-y-0.5 transition-transform" />}
              <span>Descargar PDF</span>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); exportarPDF('print'); }}
              disabled={exportando}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-900/10 hover:bg-blue-900/20 text-blue-900 transition-all duration-200 border border-blue-900/20 shadow-md active:scale-95 disabled:opacity-50 group font-bold text-xs tracking-wide"
              title="Imprimir Reporte PDF"
            >
              {exportando ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} className="group-hover:scale-110 transition-transform" />}
              <span>Imprimir</span>
            </button>

            <div className="flex p-0.5 bg-slate-100 rounded-xl h-9 min-w-[180px] border border-slate-200 ml-auto">
              <button
                type="button"
                onClick={() => setFormatoReporte('detallado')}
                className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'detallado' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >Detallado</button>
              <button
                type="button"
                onClick={() => setFormatoReporte('resumido')}
                className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'resumido' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >Resumido</button>
            </div>

            {/* Pagar seleccionadas (cuando hay selección) */}
            {puedePagarComisiones && someSelected && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPagoMasivoData({
                    pendientes: selectedPendientes,
                    montoPendiente: montoSeleccionado,
                    vendedor,
                    title: `Pagar ${selectedPendientes.length} comisión(es) seleccionada(s)`,
                    desc: `${selectedPendientes.length} comisiones marcadas manualmente`
                  });
                }}
                disabled={marcar.isPending || pagandoMasivo}
                className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-700 hover:from-violet-500 hover:to-purple-600 text-white transition-all duration-200 shadow-md shadow-violet-600/15 border border-violet-500/20 active:scale-95 disabled:opacity-50 group"
                title={`Pagar ${selectedPendientes.length} comisiones seleccionadas`}
              >
                <CheckCircle size={15} className="group-hover:scale-110 transition-transform text-violet-200 shrink-0" />
                <div className="flex flex-col items-start leading-tight">
                  <span className="font-black text-xs tracking-wide">{fmtUsd(montoSeleccionado)}</span>
                  <span className="text-[10px] font-medium text-violet-200 whitespace-nowrap">{selectedPendientes.length} seleccionada{selectedPendientes.length !== 1 ? 's' : ''}</span>
                </div>
              </button>
            )}

            {/* Separador + botones globales cuando NO hay selección */}
            {!someSelected && (
              <>
                {puedePagarComisiones && comisionesSoloPendientes.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPagoMasivoData({
                        pendientes: comisionesSoloPendientes,
                        montoPendiente: montoSoloPendiente,
                        vendedor,
                        title: "Pagar Solo Comisiones (Sin CxC)",
                        desc: "solo comisiones pendientes, excluyendo cuentas por cobrar"
                      });
                    }}
                    disabled={marcar.isPending || pagandoMasivo}
                    className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white transition-all duration-200 shadow-md shadow-indigo-600/10 border border-indigo-500/20 active:scale-95 disabled:opacity-50 group"
                    title="Pagar solo las comisiones sin incluir cuentas por cobrar"
                  >
                    <CreditCard size={15} className="group-hover:scale-110 transition-transform text-indigo-200 shrink-0" />
                    <div className="flex flex-col items-start leading-tight">
                      <span className="font-black text-xs tracking-wide">{fmtUsd(montoSoloPendiente)}</span>
                      <span className="text-[10px] font-medium text-indigo-200 whitespace-nowrap">Solo comis. <span className="opacity-75">(sin CxC)</span></span>
                    </div>
                  </button>
                )}

                {puedePagarComisiones && comisionesPendientes.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPagoMasivoData({
                        pendientes: comisionesPendientes,
                        montoPendiente,
                        vendedor,
                        title: "Pagar Todo (Comisiones + CxC)",
                        desc: "todas las comisiones pendientes, incluyendo cuentas por cobrar"
                      });
                    }}
                    disabled={marcar.isPending || pagandoMasivo}
                    className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition-all duration-200 shadow-md shadow-emerald-600/10 border border-emerald-500/20 active:scale-95 disabled:opacity-50 group"
                    title="Pagar todas las comisiones pendientes de este vendedor"
                  >
                    <CheckCircle size={15} className="group-hover:scale-110 transition-transform text-emerald-200 shrink-0" />
                    <div className="flex flex-col items-start leading-tight">
                      <span className="font-black text-xs tracking-wide">{fmtUsd(montoPendiente)}</span>
                      <span className="text-[10px] font-medium text-emerald-200 whitespace-nowrap">Comis. + CxC <span className="opacity-75">(todo)</span></span>
                    </div>
                  </button>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-100 flex items-center gap-2">
              <FileText size={14} className="text-indigo-500 sm:w-4 sm:h-4" />
              <h3 className="text-xs sm:text-sm font-black text-slate-800 flex-1">Comisiones generadas</h3>
              {puedePagarComisiones && someSelected && (
                <span className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                  {selectedIds.size} seleccionada{selectedIds.size !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="text-[10px] sm:text-xs text-slate-400 uppercase border-b border-slate-100">
                    {puedePagarComisiones && (
                      <th className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                          onChange={toggleAll}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-violet-600 cursor-pointer accent-violet-600"
                          title={allSelected ? 'Deseleccionar todas' : 'Seleccionar todas las pendientes'}
                        />
                      </th>
                    )}
                    <th className="px-2 sm:px-4 py-2 font-semibold text-left">Fecha</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-left">Correlativo</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Venta ($)</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">{labelCabillaHeader}</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Otros</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Com. ($)</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Tasa Euro</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-right">Com. (Bs)</th>
                    <th className="px-2 sm:px-4 py-2 font-semibold text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((d, i) => {
                    const total = Number(d.totalcomision || 0)
                    const tasa = tasaComision(d)
                    const comBs = total * tasa
                    const valCabilla = Number(d.comisioncabilla || 0)
                    const valOtros = Number(d.comisionotros || 0)
                    const isPendiente = d.estado !== 'pagada'
                    const isSelected = selectedIds.has(d.id)

                    let badgeClass = 'bg-amber-50 text-amber-700 border border-amber-200'
                    let label = d.estado
                    if (d.estado === 'pagada') {
                      badgeClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    } else if (d.estado === 'cta_cobrar') {
                      badgeClass = 'bg-rose-50 text-rose-700 border border-rose-200'
                      label = 'cta x cobrar'
                    }

                    return (
                      <tr
                        key={d.id || i}
                        className={`border-b border-slate-50 transition-colors duration-150 ${
                          isSelected
                            ? 'bg-violet-50/60 hover:bg-violet-50'
                            : 'hover:bg-slate-50/50'
                        }`}
                        onClick={() => isPendiente && puedePagarComisiones && toggleId(d.id)}
                        style={{ cursor: isPendiente && puedePagarComisiones ? 'pointer' : 'default' }}
                      >
                        {puedePagarComisiones && (
                          <td className="px-3 py-2 w-8">
                            {isPendiente ? (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleId(d.id)}
                                onClick={e => e.stopPropagation()}
                                className="w-3.5 h-3.5 rounded border-slate-300 cursor-pointer accent-violet-600"
                              />
                            ) : (
                              <span className="block w-3.5 h-3.5" />
                            )}
                          </td>
                        )}
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5">
                          <span className="font-bold text-slate-700">{new Date(d.creadoen).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</span>
                        </td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5">
                          <div className="text-[10px] leading-tight font-mono font-bold space-y-1.5 my-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[8px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-sans uppercase tracking-wider">Desp</span>
                              <span className="text-slate-700">#{d.despacho?.numero || '—'}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[8px] bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded font-sans uppercase tracking-wider">Cot</span>
                              <span className="text-slate-700">#{d.cotizacion?.numero || '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-medium text-slate-500">{fmtUsd(d.despacho?.totalusd || 0)}</td>
                        <td className={`px-2 sm:px-4 py-2 sm:py-2.5 text-right font-semibold ${valCabilla === 0 ? 'text-slate-300 font-normal' : 'text-slate-800'}`}>{fmtUsd(valCabilla)}</td>
                        <td className={`px-2 sm:px-4 py-2 sm:py-2.5 text-right font-semibold ${valOtros === 0 ? 'text-slate-300 font-normal' : 'text-slate-800'}`}>{fmtUsd(valOtros)}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-black text-slate-900 bg-slate-50/50">{fmtUsd(total)}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right text-[11px] text-slate-500 font-semibold">{tasa > 0 ? `Bs ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '—'}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-right font-black text-indigo-600 bg-indigo-50/20">{fmtBs(comBs)}</td>
                        <td className="px-2 sm:px-4 py-2 sm:py-2.5 text-center">
                          <div className="flex flex-col items-center gap-1.5 py-0.5">
                            <div className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${badgeClass}`}>
                              {d.estado === 'pagada' && <CheckCircle size={9} className="text-emerald-600" />}
                              {label}
                            </div>
                            {puedePagarComisiones && d.estado !== 'pagada' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setComisionAPagar(d); }}
                                className="px-2 py-0.5 rounded-md text-[9.5px] font-extrabold text-emerald-700 bg-emerald-50 hover:bg-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-500 transition-all duration-200 active:scale-95 uppercase tracking-wider shadow-sm flex items-center justify-center gap-1 mx-auto"
                              >
                                <CreditCard size={9} />
                                Pagar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modales de Confirmación de Pago */}
      <ConfirmModal
        isOpen={!!comisionAPagar}
        onConfirm={() => {
          if (!comisionAPagar) return
          const saldo = Math.max(0, Number(comisionAPagar.totalcomision || 0) - Number(comisionAPagar.montopagado || 0))
          marcar.mutate({ comisionid: comisionAPagar.id, montopagado: saldo })
          setComisionAPagar(null)
        }}
        onClose={() => setComisionAPagar(null)}
        title="Registrar Pago de Comisión"
        message={comisionAPagar ? `Se registrará el pago de ${fmtUsd(Math.max(0, Number(comisionAPagar.totalcomision || 0) - Number(comisionAPagar.montopagado || 0)))}. Esta acción es atómica y final.` : ''}
        confirmText="Confirmar Pago"
        variant="success"
      />

      <ConfirmModal
        isOpen={!!pagoMasivoData}
        onConfirm={async () => {
          if (!pagoMasivoData) return
          setPagandoMasivo(true)
          const { pendientes: items } = pagoMasivoData
          for (const c of items) {
            const saldo = Math.max(0, Number(c.totalcomision || 0) - Number(c.montopagado || 0))
            if (saldo > 0) {
              try {
                await marcar.mutateAsync({ comisionid: c.id, montopagado: saldo })
              } catch (e) {
                console.error('Error pagando comisión', c.id, e)
              }
            }
          }
          setPagandoMasivo(false)
          setPagoMasivoData(null)
        }}
        onClose={() => setPagoMasivoData(null)}
        title={pagoMasivoData?.title || "Pagar Comisiones"}
        message={
          pagoMasivoData 
            ? `Se registrará el pago de ${pagoMasivoData.pendientes.length} comisiones (${pagoMasivoData.desc}) de ${pagoMasivoData.vendedor?.nombre || 'este vendedor'} por un total de ${fmtUsd(pagoMasivoData.montoPendiente)}. Esta acción es secuencial y final.` 
            : ''
        }
        confirmText="Confirmar Pago"
        variant="success"
      />
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: COMISIONES
// ═══════════════════════════════════════════════════════════════════════════
function TabComisiones({ configNeg }) {
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'jefe' || perfil?.rol === 'desarrollador'
  const esJefe = perfil?.rol === 'jefe'
  const esDev = perfil?.rol === 'desarrollador'
  const puedePagarComisiones = esAdmin || esJefe || esDev

  const marcar = useMarcarComisionPagada()
  const [pagoMasivoData, setPagoMasivoData] = useState(null)
  const [pagandoMasivo, setPagandoMasivo] = useState(false)

  const [rango, setRango] = useState(() => {
    const r = getWeekRange(0)
    return { from: r.from, to: r.to }
  })
  const [filtroEstado, setFiltroEstado] = useState('pendiente') // Inicializado con 'pendiente'
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [formatoReporte, setFormatoReporte] = useState('detallado') // 'detallado', 'resumido'
  const { tasaEuro } = useTasaCambio()
  const [exportando, setExportando] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  // ajustesManuales: { [vendedorId]: { cxc: string, descuentoCarro: string } }
  const [ajustesManuales, setAjustesManuales] = useState({})

  const [vendedorSeleccionado, setVendedorSeleccionado] = useState(null)

  const setAjuste = (vId, campo, valor) => {
    setAjustesManuales(prev => ({
      ...prev,
      [vId]: { ...(prev[vId] || { cxc: '', descuentoCarro: '' }), [campo]: valor }
    }))
  }

  const { data: comisionesRes, isLoading: comisionesLoading, isError, refetch } = useComisiones({
    estado: filtroEstado,
    vendedorId: filtroVendedor,
    desde: rango.from,
    hasta: rango.to,
    pageSize: 1000
  })
  const comisiones = comisionesRes?.data ?? []

  const handlePagarTodoVendedor = useCallback((v, conCxc = true) => {
    const pendientes = comisiones.filter(c => {
      const vId = c.vendedor?.id || '00000000-0000-0000-0000-000000000000'
      const matchEstado = conCxc ? c.estado !== 'pagada' : c.estado === 'pendiente'
      return vId === v.id && matchEstado
    })
    if (pendientes.length === 0) return
    setPagoMasivoData({
      pendientes,
      montoPendiente: conCxc ? v.pendUsd : v.pendSoloComisUsd,
      vendedor: v,
      title: conCxc ? "Pagar Todo (Comisiones + CxC)" : "Pagar Solo Comisiones (Sin CxC)",
      desc: conCxc ? "todas las comisiones pendientes, incluyendo cuentas por cobrar" : "solo comisiones pendientes, excluyendo cuentas por cobrar"
    })
  }, [comisiones])

  // Segunda llamada SIN filtro de vendedor, solo para construir el dropdown
  // de forma que siempre muestre los vendedores con comisiones en el rango
  const { data: comisionesDropdownRes } = useComisiones({
    desde: rango.from,
    hasta: rango.to,
    pageSize: 2000
  })
  const comisionesParaDropdown = comisionesDropdownRes?.data ?? []

  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen({
    vendedorId: filtroVendedor,
    desde: rango.from,
    hasta: rango.to,
    estado: filtroEstado
  })

  // Agrupar por vendedor para la vista Maestro (Resumen)
  const vendedoresAgrupados = useMemo(() => {
    const map = {}
    const UUID_HUERFANO = '00000000-0000-0000-0000-000000000000'
    comisiones.forEach(c => {
      const vId = c.vendedor?.id || UUID_HUERFANO
      if (!map[vId]) {
        map[vId] = {
          id: vId,
          nombre: c.vendedor?.nombre || 'Sin Asignar',
          color: c.vendedor?.color || '#cbd5e1',
          markup_pct: c.vendedor?.markup_pct ?? null,
          es_externo: !!c.vendedor?.es_externo,
          rol: c.vendedor?.rol,
          totalUsd: 0,
          totalBs: 0,
          pendUsd: 0,
          pendSoloComisUsd: 0,
          pagUsd: 0,
          cantidad: 0
        }
      }
      const m = Number(c.totalcomision || 0)
      const tasa = tasaEuro?.precio || Number(c.despacho?.tasa_snapshot || c.cotizacion?.tasa_bcv_snapshot || 0)
      const mBs = m * tasa

      map[vId].totalUsd += m
      map[vId].totalBs += mBs
      map[vId].cantidad++
      if (['pendiente', 'cta_cobrar'].includes(c.estado)) {
        map[vId].pendUsd += m
        if (c.estado === 'pendiente') {
          map[vId].pendSoloComisUsd += m
        }
      } else {
        map[vId].pagUsd += m
      }
    })
    return Object.values(map)
      .filter(v => v.rol !== 'desarrollador' && v.rol !== 'administracion' && v.rol !== 'logistica')
      .sort((a, b) => b.totalUsd - a.totalUsd)
  }, [comisiones])

  // Obtener lista única de vendedores para el select (desde el dataset sin filtro de vendedor)
  const vendedoresDisponibles = useMemo(() => {
    if (!esAdmin) return []
    const map = {}
    const UUID_HUERFANO = '00000000-0000-0000-0000-000000000000'
    comisionesParaDropdown.forEach(c => {
      const vId = c.vendedor?.id || UUID_HUERFANO
      const rol = c.vendedor?.rol
      if (rol === 'desarrollador' || rol === 'administracion' || rol === 'logistica') return
      if (!map[vId]) {
        map[vId] = { id: vId, nombre: c.vendedor?.nombre || 'Sin Asignar' }
      }
    })
    return Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [comisionesParaDropdown, esAdmin])

  async function exportarPDF(tipoFiltro = 'todos', accion = 'descargar') {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')

      const params = new URLSearchParams()
      params.set('vista', 'eventos')
      params.set('page', '1')
      params.set('pageSize', '500')
      if (rango.from) params.set('desde', rango.from)
      if (rango.to) params.set('hasta', rango.to)
      if (filtroVendedor) params.set('vendedorId', filtroVendedor)

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const resJson = await res.json()
      const rawEvents = resJson.data || []

      if (!rawEvents || rawEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay liberaciones de comisiones entre ${rango.from} y ${rango.to}.`)
        return
      }

      let filteredEvents = rawEvents

      if (tipoFiltro === 'internos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || r.comisiones?.vendedor
          const esExterno = !!v?.es_externo || (v?.markup_pct != null && Number(v.markup_pct) > 0)
          return !esExterno
        })
      } else if (tipoFiltro === 'externos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || r.comisiones?.vendedor
          const esExterno = !!v?.es_externo || (v?.markup_pct != null && Number(v.markup_pct) > 0)
          return esExterno
        })
      }

      if (filteredEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay comisiones registradas para el grupo de vendedores seleccionado en este rango.`);
        return;
      }

      // Fetch cotizaciones
      const cotizacionIds = [...new Set(filteredEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
      let cotizacionesMap = {}
      if (cotizacionIds.length > 0) {
        const { data: cotList, error: cotErr } = await supabase
          .from('cotizaciones')
          .select('id, numero, tasa_bcv_snapshot, cliente:clientes(id, nombre)')
          .in('id', cotizacionIds)
        if (!cotErr && cotList) {
          cotizacionesMap = Object.fromEntries(cotList.map(c => [c.id, c]))
        }
      }

      const vendedorInfo = filtroVendedor
        ? vendedoresAgrupados.find(v => v.id === filtroVendedor)
        : null

      const comisionesParaPDF = filteredEvents.map(r => {
        const com = r.comisiones || {};
        const desp = com.despacho || {};
        const cot = cotizacionesMap[com.cotizacionid] || com.cotizacion;
        return {
          id: r.id,
          monto: Number(r.monto || 0),
          tipo: r.tipo,
          creado_en: r.creado_en,
          comisiones: {
            id: com.id,
            totalcomision: Number(com.totalcomision || 0),
            comisioncabilla: Number(com.comisioncabilla || 0),
            comisionotros: Number(com.comisionotros || 0),
            pctcabilla: Number(com.pctcabilla || 0),
            pctotros: Number(com.pctotros || 0),
            estado: com.estado,
            montopagado: Number(com.montopagado || 0),
            cotizacionid: com.cotizacionid,
            despacho: desp ? {
              id: desp.id,
              numero: desp.numero,
              totalusd: desp.totalusd !== undefined ? desp.totalusd : desp.total_usd,
              tasa_snapshot: desp.tasa_snapshot,
              cliente: desp.cliente,
              productos: desp.productos || []
            } : null,
            cotizacion: cot ? {
              id: cot.id,
              numero: cot.numero,
              tasa_bcv_snapshot: cot.tasa_bcv_snapshot,
              cliente_nombre: cot.cliente_nombre || cot.cliente?.nombre || null
            } : null
          },
          vendedor: r.vendedor || com.vendedor || (vendedorInfo ? {
            id: vendedorInfo.id,
            nombre: vendedorInfo.nombre,
            color: vendedorInfo.color,
            markup_pct: vendedorInfo.markup_pct,
            es_externo: vendedorInfo.es_externo
          } : null)
        };
      });

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: vendedorInfo ? { nombre: vendedorInfo.nombre, color: vendedorInfo.color, markup_pct: vendedorInfo.markup_pct, es_externo: vendedorInfo.es_externo } : null,
        tipoVendedor: tipoFiltro === 'todos' ? null : tipoFiltro,
        rango,
        config: configNeg ?? {},
        action: accion === 'imprimir' ? 'print' : 'download',
        formato: formatoReporte,
        tasaEuro: tasaEuro?.precio || 0,
        ajustesManuales
      })
    } catch (e) {
      console.error('Error generando PDF general:', e)
      alert('❌ Error al generar reporte general: ' + e.message)
    } finally {
      setExportando(false)
    }
  }

  async function exportarIndividualPDF(vendedor) {
    setExportando(true)
    try {
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')

      let query = supabase
        .from('comision_liberaciones')
        .select(`
          id,
          comision_id,
          despacho_id,
          vendedor_id,
          cuenta_id,
          monto,
          tipo,
          cxc_id,
          creado_en,
          comisiones:comisiones!inner(
            id,
            totalcomision,
            comisioncabilla,
            comisionotros,
            pctcabilla,
            pctotros,
            estado,
            montopagado,
            cotizacionid,
            vendedor:usuarios(id, nombre, color, markup_pct, rol, es_externo),
            despacho:notas_despacho(
              id,
              numero,
              total_usd,
              tasa_snapshot,
              cliente:clientes!notas_despacho_cliente_id_fkey(id, nombre, tipo_cliente),
              productos:notas_despacho_items(nombre_snap)
            )
          )
        `)
        .order('creado_en', { ascending: false })

      if (rango.from) {
        query = query.gte('creado_en', `${rango.from}T00:00:00-04:00`)
      }
      if (rango.to) {
        query = query.lte('creado_en', `${rango.to}T23:59:59-04:00`)
      }
      if (vendedor.id) {
        query = query.eq('vendedor_id', vendedor.id)
      }

      const { data: rawEvents, error: errEvents } = await query

      if (errEvents) {
        console.error('Error fetching events:', errEvents)
        alert('❌ Error al obtener las liberaciones de comisión: ' + errEvents.message)
        return
      }

      if (!rawEvents || rawEvents.length === 0) {
        alert(`🔍 SIN DATOS: No hay registros para ${vendedor.nombre} en este rango.`)
        return
      }

      // Fetch cotizaciones
      const cotizacionIds = [...new Set(rawEvents.map(r => r.comisiones?.cotizacionid).filter(Boolean))]
      let cotizacionesMap = {}
      if (cotizacionIds.length > 0) {
        const { data: cotList, error: cotErr } = await supabase
          .from('cotizaciones')
          .select('id, numero, tasa_bcv_snapshot, cliente:clientes(id, nombre)')
          .in('id', cotizacionIds)
        if (!cotErr && cotList) {
          cotizacionesMap = Object.fromEntries(cotList.map(c => [c.id, c]))
        }
      }

      const comisionesParaPDF = rawEvents.map(r => {
        const com = r.comisiones || {};
        const desp = com.despacho || {};
        const cot = cotizacionesMap[com.cotizacionid];
        return {
          id: r.id,
          monto: Number(r.monto || 0),
          tipo: r.tipo,
          creado_en: r.creado_en,
          comisiones: {
            id: com.id,
            totalcomision: Number(com.totalcomision || 0),
            comisioncabilla: Number(com.comisioncabilla || 0),
            comisionotros: Number(com.comisionotros || 0),
            pctcabilla: Number(com.pctcabilla || 0),
            pctotros: Number(com.pctotros || 0),
            estado: com.estado,
            montopagado: Number(com.montopagado || 0),
            cotizacionid: com.cotizacionid,
            despacho: desp ? {
              id: desp.id,
              numero: desp.numero,
              totalusd: desp.total_usd,
              tasa_snapshot: desp.tasa_snapshot,
              cliente: desp.cliente,
              productos: desp.productos || []
            } : null,
            cotizacion: cot ? {
              id: cot.id,
              numero: cot.numero,
              tasa_bcv_snapshot: cot.tasa_bcv_snapshot,
              cliente_nombre: cot.cliente?.nombre || null
            } : null
          },
          vendedor: r.vendedor || com.vendedor || {
            id: vendedor.id,
            nombre: vendedor.nombre,
            color: vendedor.color,
            markup_pct: vendedor.markup_pct,
            es_externo: vendedor.es_externo
          }
        };
      });

      await generarComisionesPDF({
        comisiones: comisionesParaPDF,
        vendedor: { nombre: vendedor.nombre, color: vendedor.color, markup_pct: vendedor.markup_pct, es_externo: vendedor.es_externo },
        rango,
        config: configNeg ?? {},
        formato: formatoReporte,
        tasaEuro: tasaEuro?.precio || 0,
        ajustesManuales
      })
    } catch (e) {
      console.error('Error generating PDF individual:', e)
      alert('❌ Error al generar PDF de ' + vendedor.nombre + ': ' + e.message)
    } finally {
      setExportando(false)
    }
  }


  // El bloque de KPIs ya no usa stats locales sino useComisionesResumen (resumen)

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-3.5">
          {/* Fila Superior: Periodo (con mucho espacio) */}
          <div className="w-full">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Rango de Periodo</label>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>

          {/* Fila Inferior: Otros Filtros y Acciones */}
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-50 pt-3 w-full justify-between">
            {/* Grupo de Filtros */}
            <div className="flex flex-wrap items-end gap-3">
              {esAdmin && (
                <div className="w-52">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Vendedor</label>
                  <CustomSelect
                    options={[
                      { value: '', label: 'Todos los Asesores' },
                      ...vendedoresDisponibles.map(v => ({ value: v.id, label: v.nombre }))
                    ]}
                    value={filtroVendedor}
                    onChange={setFiltroVendedor}
                    placeholder="Todos los Asesores"
                  />
                </div>
              )}

              <div className="w-60">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Estado de Comisión</label>
                <div className="flex p-0.5 bg-slate-100/80 rounded-xl h-9">
                  <button
                    onClick={() => setFiltroEstado('')}
                    className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${!filtroEstado ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >Todas</button>
                  <button
                    onClick={() => setFiltroEstado('pendiente')}
                    className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${filtroEstado === 'pendiente' ? 'bg-white shadow-md text-amber-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >Pendientes</button>
                  <button
                    onClick={() => setFiltroEstado('pagada')}
                    className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${filtroEstado === 'pagada' ? 'bg-white shadow-md text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >Pagadas</button>
                </div>
              </div>

              <div className="w-44">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Formato Reporte</label>
                <div className="flex p-0.5 bg-slate-100/80 rounded-xl h-9">
                  <button
                    type="button"
                    onClick={() => setFormatoReporte('detallado')}
                    className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'detallado' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >Detallado</button>
                  <button
                    type="button"
                    onClick={() => setFormatoReporte('resumido')}
                    className={`flex-1 text-[11px] font-bold rounded-lg transition-all ${formatoReporte === 'resumido' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >Resumido</button>
                </div>
              </div>
            </div>

            {/* Grupo de Acciones y Tasa Euro */}
            <div className="flex flex-wrap items-center gap-2.5 ml-auto shrink-0 self-end">
              {tasaEuro?.precio > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-800 text-[11px] font-bold shrink-0 h-9">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                  <span>Tasa Euro BCV: <b>{fmtBs(tasaEuro.precio)}</b></span>
                </div>
              )}

              <div className="flex items-center gap-1.5 relative shrink-0">
                {/* BOTÓN IMPRIMIR PDF */}
                <div className="relative">
                  {filtroVendedor ? (
                    <button
                      onClick={() => exportarPDF('todos', 'imprimir')}
                      disabled={exportando || comisiones.length === 0}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
                    >
                      <Printer size={12} className="text-slate-500" />
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowPrintMenu(!showPrintMenu)}
                        disabled={exportando || comisiones.length === 0}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
                      >
                        <Printer size={12} className="text-slate-500" />
                        <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
                      </button>

                      {showPrintMenu && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)} />
                          <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                            <button
                              onClick={() => {
                                setShowPrintMenu(false)
                                exportarPDF('todos', 'imprimir')
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                            >
                              <FileText size={13} className="text-slate-400" />
                              Imprimir PDF Completo
                            </button>
                            <button
                              onClick={() => {
                                setShowPrintMenu(false)
                                exportarPDF('internos', 'imprimir')
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                            >
                              <UserCheck size={13} className="text-indigo-500" />
                              Imprimir Solo Internos
                            </button>
                            <button
                              onClick={() => {
                                setShowPrintMenu(false)
                                exportarPDF('externos', 'imprimir')
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                            >
                              <Globe size={13} className="text-amber-500" />
                              Imprimir Solo Externos
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* BOTÓN DESCARGAR PDF */}
                <div className="relative">
                  {filtroVendedor ? (
                    <button
                      onClick={() => exportarPDF('todos', 'descargar')}
                      disabled={exportando || comisiones.length === 0}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                      style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                    >
                      <Download size={12} />
                      <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        disabled={exportando || comisiones.length === 0}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                        style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
                      >
                        <Download size={12} />
                        <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
                      </button>

                      {showExportMenu && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                          <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-20 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                            <button
                              onClick={() => {
                                setShowExportMenu(false)
                                exportarPDF('todos', 'descargar')
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                            >
                              <FileText size={13} className="text-slate-400" />
                              Descargar PDF Completo
                            </button>
                            <button
                              onClick={() => {
                                setShowExportMenu(false)
                                exportarPDF('internos', 'descargar')
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                            >
                              <UserCheck size={13} className="text-indigo-500" />
                              Descargar Solo Internos
                            </button>
                            <button
                              onClick={() => {
                                setShowExportMenu(false)
                                exportarPDF('externos', 'descargar')
                              }}
                              className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-t border-slate-50"
                            >
                              <Globe size={13} className="text-amber-500" />
                              Descargar Solo Externos
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Panel de Ajustes Manuales para Reporte Resumido */}
      {formatoReporte === 'resumido' && !comisionesLoading && !isError && vendedoresAgrupados.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <span className="text-base">✏️</span>
            <div>
              <p className="text-xs font-black text-amber-800 uppercase tracking-wide">Ajustes Manuales — Reporte Resumido</p>
              <p className="text-[10px] text-amber-600 font-medium">Ingresa los montos de Comisión CxC y Descuento Carro por vendedor antes de generar el PDF.</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {vendedoresAgrupados.map(v => {
              const aj = ajustesManuales[v.id] || { cxc: '', descuentoCarro: '' }
              const comisionGen = v.totalUsd || 0
              const cxcVal = Number(aj.cxc) || 0
              const descVal = Number(aj.descuentoCarro) || 0
              const totalPagar = comisionGen + cxcVal - descVal
              const tasa = tasaEuro?.precio || 0
              return (
                <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  {/* Nombre vendedor */}
                  <div className="flex items-center gap-2 w-40 shrink-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: v.color }}>
                      {v.nombre.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold text-slate-800 truncate">{v.nombre}</span>
                  </div>
                  {/* Comisión periodo (solo lectura) */}
                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wide mb-0.5">Comisión Periodo</label>
                    <span className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">${comisionGen.toFixed(2)}</span>
                  </div>
                  {/* CxC input */}
                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-amber-600 uppercase tracking-wide mb-0.5">Comisión CxC ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={aj.cxc}
                      onChange={e => setAjuste(v.id, 'cxc', e.target.value)}
                      className="w-28 h-8 px-2 text-xs font-bold border border-amber-200 bg-amber-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 text-amber-800 placeholder-amber-300"
                    />
                  </div>
                  {/* Descuento Carro input */}
                  <div className="flex flex-col items-start">
                    <label className="text-[9px] font-black text-red-600 uppercase tracking-wide mb-0.5">Descuento Carro ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={aj.descuentoCarro}
                      onChange={e => setAjuste(v.id, 'descuentoCarro', e.target.value)}
                      className="w-28 h-8 px-2 text-xs font-bold border border-red-200 bg-red-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 text-red-800 placeholder-red-300"
                    />
                  </div>
                  {/* Total a pagar calculado */}
                  <div className="flex flex-col items-start ml-auto">
                    <label className="text-[9px] font-black text-indigo-500 uppercase tracking-wide mb-0.5">Total a Pagar</label>
                    <span className="text-sm font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1">${totalPagar.toFixed(2)}</span>
                  </div>
                  {tasa > 0 && (
                    <div className="flex flex-col items-start">
                      <label className="text-[9px] font-black text-emerald-600 uppercase tracking-wide mb-0.5">Total en Bs</label>
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">Bs {(totalPagar * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {comisionesLoading || resumenLoading ? (
        <SkeletonReporte />
      ) : isError ? (
        <ErrorMsg onRetry={refetch} />
      ) : (
        <>
          {/* KPIs (Fuente de verdad SQL) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard icon={DollarSign} label="Total Periodo" value={fmtUsd(resumen?.total || 0)}
              sub="Bruto histórico"
              gradient="linear-gradient(135deg, #1e293b, #0f172a)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={Clock} label="Pendiente USD" value={fmtUsd(resumen?.pendiente || 0)}
              sub={`${resumen?.countPendiente || 0} comisiones`}
              gradient="linear-gradient(135deg, #92400e, #78350f)" border="rgba(255,255,255,0.05)" />
            <KpiCard icon={ArrowUpCircle} label="Total Pagado" value={fmtUsd(resumen?.pagado || 0)}
              sub={`${resumen?.countPagado || 0} liquidadas`}
              gradient="linear-gradient(135deg, #065f46, #064e3b)" border="rgba(255,255,255,0.05)" />
          </div>

          {/* Tarjetas de Vendedores (Resumen Separado) */}
          {(() => {
            const vendedoresInternos = vendedoresAgrupados.filter(v => !(v.es_externo || v.markup_pct > 0))
            const vendedoresExternos = vendedoresAgrupados.filter(v => !!v.es_externo || v.markup_pct > 0)
            return (
              <div className="space-y-6">
                {/* 1. ASESORES INTERNOS */}
                {vendedoresInternos.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                      <Users size={16} className="text-slate-500" />
                      <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendedores Internos ({vendedoresInternos.length})</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {vendedoresInternos.map(v => (
                        <div
                          key={v.id}
                          onClick={() => setVendedorSeleccionado(v)}
                          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-400 hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col gap-3 group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-inner" style={{ backgroundColor: v.color }}>
                              {v.nombre.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors">{v.nombre}</h4>
                              <p className="text-xs text-slate-500 font-medium">{v.cantidad} despachos procesados</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); exportarIndividualPDF(v); }}
                              title="Descargar reporte individual"
                              className="p-2 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl border border-slate-100 hover:border-indigo-200 transition-all active:scale-95 duration-200"
                            >
                              <Download size={14} />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Total USD</p>
                              <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
                            </div>
                            <div className="bg-amber-50/50 rounded-xl p-2.5 text-center border border-amber-100/50">
                              <p className="text-[10px] text-amber-600/70 font-bold uppercase mb-0.5">Pendiente</p>
                              <p className="font-bold text-amber-600">{fmtUsd(v.pendUsd)}</p>
                            </div>
                          </div>

                          <div className="flex justify-between items-center px-1 pt-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Equiv. Bs</span>
                            <span className="text-xs font-bold text-indigo-600">{fmtBs(v.totalBs)}</span>
                          </div>

                          {puedePagarComisiones && v.pendUsd > 0 && (
                            <div className="flex flex-col gap-2 mt-3">
                              {v.pendSoloComisUsd > 0 && v.pendSoloComisUsd < v.pendUsd ? (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePagarTodoVendedor(v, false);
                                    }}
                                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-black text-xs flex items-center justify-center gap-1.5 transition-all duration-300 shadow-sm active:scale-[0.98] border border-indigo-500/20"
                                  >
                                    <CreditCard size={13} className="text-indigo-200" />
                                    <span>Solo Comis. ({fmtUsd(v.pendSoloComisUsd)})</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePagarTodoVendedor(v, true);
                                    }}
                                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs flex items-center justify-center gap-1.5 transition-all duration-300 shadow-md hover:shadow-emerald-600/20 active:scale-[0.98] border border-emerald-500/20"
                                  >
                                    <CheckCircle size={14} className="text-white" />
                                    <span>Comis. + CxC ({fmtUsd(v.pendUsd)})</span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePagarTodoVendedor(v, true);
                                  }}
                                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs flex items-center justify-center gap-1.5 transition-all duration-300 shadow-md hover:shadow-emerald-600/20 active:scale-[0.98] border border-emerald-500/20"
                                >
                                  <CheckCircle size={14} className="text-white" />
                                  <span>Pagar Todo ({fmtUsd(v.pendUsd)})</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. VENDEDORES EXTERNOS */}
                {vendedoresExternos.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center gap-2 px-1">
                      <Briefcase size={16} className="text-amber-600 animate-pulse" />
                      <h4 className="text-xs font-black text-amber-700 uppercase tracking-wider">Vendedores Externos ({vendedoresExternos.length})</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {vendedoresExternos.map(v => (
                        <div
                          key={v.id}
                          onClick={() => setVendedorSeleccionado(v)}
                          className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm cursor-pointer hover:border-amber-400 hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col gap-3 group bg-amber-50/5"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-inner" style={{ backgroundColor: '#D97706' }}>
                              {v.nombre.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-slate-800 truncate group-hover:text-amber-600 transition-colors">{v.nombre}</h4>
                              <div className="flex flex-col gap-0.5 mt-0.5">
                                <span className="text-xs text-slate-500 font-medium">{v.cantidad} despachos procesados</span>
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.5 w-fit">
                                  💼 Externo (+{v.markup_pct}%)
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); exportarIndividualPDF(v); }}
                              title="Descargar reporte individual"
                              className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-700 rounded-xl border border-amber-100 hover:border-amber-200 transition-all active:scale-95 duration-200"
                            >
                              <Download size={14} />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Total USD</p>
                              <p className="font-bold text-slate-900">{fmtUsd(v.totalUsd)}</p>
                            </div>
                            <div className="bg-amber-50/50 rounded-xl p-2.5 text-center border border-amber-100/50">
                              <p className="text-[10px] text-amber-600/70 font-bold uppercase mb-0.5">Pendiente</p>
                              <p className="font-bold text-amber-600">{fmtUsd(v.pendUsd)}</p>
                            </div>
                          </div>

                          <div className="flex justify-between items-center px-1 pt-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Equiv. Bs</span>
                            <span className="text-xs font-bold text-indigo-600">{fmtBs(v.totalBs)}</span>
                          </div>

                          {puedePagarComisiones && v.pendUsd > 0 && (
                            <div className="flex flex-col gap-2 mt-3">
                              {v.pendSoloComisUsd > 0 && v.pendSoloComisUsd < v.pendUsd ? (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePagarTodoVendedor(v, false);
                                    }}
                                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-black text-xs flex items-center justify-center gap-1.5 transition-all duration-300 shadow-sm active:scale-[0.98] border border-indigo-500/20"
                                  >
                                    <CreditCard size={13} className="text-indigo-200" />
                                    <span>Solo Comis. ({fmtUsd(v.pendSoloComisUsd)})</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePagarTodoVendedor(v, true);
                                    }}
                                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs flex items-center justify-center gap-1.5 transition-all duration-300 shadow-md hover:shadow-emerald-600/20 active:scale-[0.98] border border-emerald-500/20"
                                  >
                                    <CheckCircle size={14} className="text-white" />
                                    <span>Comis. + CxC ({fmtUsd(v.pendUsd)})</span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePagarTodoVendedor(v, true);
                                  }}
                                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs flex items-center justify-center gap-1.5 transition-all duration-300 shadow-md hover:shadow-emerald-600/20 active:scale-[0.98] border border-emerald-500/20"
                                >
                                  <CheckCircle size={14} className="text-white" />
                                  <span>Pagar Todo ({fmtUsd(v.pendUsd)})</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          <ModalDetalleVendedor
            isOpen={!!vendedorSeleccionado}
            onClose={() => setVendedorSeleccionado(null)}
            vendedor={vendedorSeleccionado}
            rango={rango}
            configNeg={configNeg}
            ajustesManuales={ajustesManuales}
          />

          {comisiones.length === 0 && (
            <EmptyState icon={Percent} title="Sin comisiones" description="No hay comisiones en el periodo seleccionado." />
          )}

          {/* Confirmar Pago Masivo desde Tarjeta del Dashboard */}
          <ConfirmModal
            isOpen={!!pagoMasivoData}
            onConfirm={async () => {
              if (!pagoMasivoData) return
              setPagandoMasivo(true)
              const { pendientes: items } = pagoMasivoData
              for (const c of items) {
                const saldo = Math.max(0, Number(c.totalcomision || 0) - Number(c.montopagado || 0))
                if (saldo > 0) {
                  try {
                    await marcar.mutateAsync({ comisionid: c.id, montopagado: saldo })
                  } catch (e) {
                    console.error('Error pagando comisión', c.id, e)
                  }
                }
              }
              setPagandoMasivo(false)
              setPagoMasivoData(null)
              refetch() // Refrescar los datos para actualizar el pendUsd en las tarjetas
            }}
            onClose={() => setPagoMasivoData(null)}
            title={pagoMasivoData?.title || "Pagar Todas las Comisiones"}
            message={
              pagoMasivoData 
                ? `Se registrará el pago de ${pagoMasivoData.pendientes.length} comisiones (${pagoMasivoData.desc || 'pendientes'}) de ${pagoMasivoData.vendedor?.nombre || 'este vendedor'} por un total de ${fmtUsd(pagoMasivoData.montoPendiente)}. Esta acción es secuencial y final.` 
                : ''
            }
            confirmText={pagoMasivoData?.confirmText || "Confirmar Pago Total"}
            variant="success"
          />
        </>
      )}
    </div>
  )
}

// ─── Shared Components ────────────────────────────────────────────────────
function ExportButton({ onClick, loading, disabled }) {
  return (
    <button onClick={onClick} disabled={loading || disabled}
      className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-sm font-bold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md"
      style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}>
      <Download size={12} className="sm:w-3.5 sm:h-3.5" />
      {loading ? 'Generando...' : 'Descargar PDF'}
    </button>
  )
}

function ErrorMsg({ onRetry }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
      <p className="font-semibold">Error al cargar el reporte</p>
      <button onClick={onRetry} className="mt-3 text-sm underline">Intentar de nuevo</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: CRÉDITO
// ═══════════════════════════════════════════════════════════════════════════

// Colores de riesgo por días sin pago
function riesgoCliente(dias) {
  if (dias <= 30) return { label: 'Al día', color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', bar: '#10b981' }
  if (dias <= 60) return { label: 'Moderado', color: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', bar: '#f59e0b' }
  if (dias <= 90) return { label: 'Alto', color: '#ef4444', bg: 'bg-red-50', text: 'text-red-700', bar: '#ef4444' }
  return { label: 'Crítico', color: '#7c3aed', bg: 'bg-purple-50', text: 'text-purple-700', bar: '#7c3aed' }
}

// Aging mejorado con barras visuales
function AgingBars({ aging }) {
  const maxUsd = Math.max(...aging.map(a => a.totalUsd), 1)
  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#7c3aed']
  const totalUsd = aging.reduce((s, a) => s + a.totalUsd, 0)

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-slate-500" />
          <h3 className="text-xs sm:text-sm font-black text-slate-800">Antigüedad de deuda</h3>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">Total: ${totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div className="p-4 space-y-4">
        {aging.map((a, i) => {
          const pct = maxUsd > 0 ? (a.totalUsd / maxUsd) * 100 : 0
          const pctTotal = totalUsd > 0 ? (a.totalUsd / totalUsd) * 100 : 0
          return (
            <div key={a.rango} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i] }} />
                  <span className="text-xs font-semibold text-slate-700">{a.rango}</span>
                  <span className="text-[10px] text-slate-400 font-medium">{a.count} cargo{a.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-400">{pctTotal.toFixed(0)}%</span>
                  <span className="text-xs font-bold text-slate-800">
                    ${a.totalUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: COLORS[i] }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TabCredito() {
  const { data: cxcData, isLoading: cxcLoading, isError: cxcError, refetch: refetchCxc } = useResumenCxC()
  const { data: proveedores = [], isLoading: provLoading, isError: provError, refetch: refetchProv } = useProveedores()

  const [seccionCredito, setSeccionCredito] = useState('cxc') // 'cxc' | 'cxp'
  const [sortBy, setSortBy] = useState('saldo') // 'saldo' | 'dias' | 'diasRestantes'
  const [sortDir, setSortDir] = useState('desc')
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador' || perfil?.rol === 'jefe'

  const [exportandoCxC, setExportandoCxC] = useState(false)
  const { data: configNeg = {} } = useConfigNegocio()

  const isLoading = cxcLoading || provLoading
  const isError = cxcError || provError

  const refetch = () => {
    refetchCxc()
    refetchProv()
  }

  async function exportarCxCPDF(tipoReporte = 'detallado', accion = 'descargar') {
    setExportandoCxC(true)
    try {
      const { generarReporteCxCPDF } = await import('../services/pdf/cxcPDF')
      await generarReporteCxCPDF({
        data: cxcData,
        config: configNeg,
        action: accion === 'imprimir' ? 'print' : 'download',
        tipo: tipoReporte
      })
    } catch (e) {
      console.error('Error generando reporte de CxC:', e)
    } finally {
      setExportandoCxC(false)
    }
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir(col === 'diasRestantes' ? 'asc' : 'desc') }
  }

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />

  // Normalizar datos de CxC
  const kpis = cxcData?.kpis || { totalDeuda: 0, numClientesConDeuda: 0, promedioDeuda: 0, diasMasAntiguo: 0, numCargos: 0 }
  const clientesConDeuda = cxcData?.clientesConDeuda || []
  const aging = cxcData?.aging || []
  const alertasVencimiento = cxcData?.alertasVencimiento || []
  const abonos = cxcData?.abonos || []

  // Calcular métricas de CxP (Proveedores)
  const proveedoresConDeuda = proveedores.filter(p => Number(p.saldo_pendiente || 0) > 0)
  const totalCxC = Number(kpis.totalDeuda || 0)
  const totalCxP = proveedores.reduce((sum, p) => sum + (p.activo ? Number(p.saldo_pendiente || 0) : 0), 0)
  const balanceNeto = totalCxC - totalCxP

  if (totalCxC === 0 && proveedoresConDeuda.length === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        title="Sin saldos pendientes"
        description="No hay deudas de clientes (CxC) ni cuentas por pagar a proveedores (CxP) actualmente."
      />
    )
  }

  const clientesOrdenados = [...clientesConDeuda].sort((a, b) => {
    let va, vb
    if (sortBy === 'saldo') {
      va = Number(a.saldo_pendiente)
      vb = Number(b.saldo_pendiente)
    } else if (sortBy === 'diasRestantes') {
      va = a.diasRestantes !== null ? a.diasRestantes : (sortDir === 'desc' ? -99999 : 99999)
      vb = b.diasRestantes !== null ? b.diasRestantes : (sortDir === 'desc' ? -99999 : 99999)
    } else {
      va = a.diasSinPago ?? 0
      vb = b.diasSinPago ?? 0
    }
    return sortDir === 'desc' ? vb - va : va - vb
  })

  const proveedoresOrdenados = [...proveedoresConDeuda].sort((a, b) => {
    const sa = Number(a.saldo_pendiente)
    const sb = Number(b.saldo_pendiente)
    return sb - sa // Mayor deuda primero
  })

  const maxSaldo = Math.max(...clientesConDeuda.map(c => Number(c.saldo_pendiente)), 1)

  const SortBtn = ({ col, label }) => (
    <button
      onClick={() => toggleSort(col)}
      className={`flex items-center gap-0.5 hover:text-slate-700 transition-colors ${sortBy === col ? 'text-slate-800 font-black' : 'text-slate-400 font-semibold'}`}
    >
      {label}
      <span className="text-[9px] ml-0.5">{sortBy === col ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Alertas de Vencimiento para Admin */}
      {esAdmin && alertasVencimiento?.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-orange-600" size={18} />
            <h3 className="text-sm font-bold text-orange-900">Alertas de Vencimiento de Crédito</h3>
            <span className="bg-orange-200 text-orange-800 text-[10px] px-2 py-0.5 rounded-full font-bold">
              {alertasVencimiento.length}
            </span>
          </div>
          <div className="space-y-2">
            {alertasVencimiento.map(alerta => (
              <div key={alerta.id} className="flex items-center justify-between bg-white border border-orange-100 rounded-lg p-2.5">
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="text-xs font-bold text-slate-800">{alerta.cliente_nombre}</div>
                    {alerta.metodo_pago === 'cod' && (
                      <span className="bg-blue-100 text-blue-800 text-[8px] font-black px-1.5 py-0.5 rounded uppercase border border-blue-200 shrink-0">
                        COD
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Cargo: {new Date(alerta.creado_en).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-orange-600">
                    {fmtUsd(alerta.saldo_usd)}
                  </div>
                  <div className="text-[10px] font-semibold text-orange-500">
                    {alerta.diasRestantes < 0 
                      ? `Vencido hace ${Math.abs(alerta.diasRestantes)} días` 
                      : alerta.diasRestantes === 0 
                        ? 'Vence hoy' 
                        : `Vence en ${alerta.diasRestantes} días`
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPIs — 4 tarjetas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={DollarSign} label="Total por cobrar (CxC)"
          value={fmtUsd(totalCxC)}
          sub={`${kpis.numClientesConDeuda} clientes con deuda`}
          gradient="linear-gradient(135deg, #991b1b, #b91c1c)" border="rgba(255,255,255,0.10)"
        />
        <KpiCard
          icon={Briefcase} label="Total por pagar (CxP)"
          value={fmtUsd(totalCxP)}
          sub={`${proveedoresConDeuda.length} proveedores con deuda`}
          gradient="linear-gradient(135deg, #7c3aed, #6d28d9)" border="rgba(255,255,255,0.10)"
        />
        <KpiCard
          icon={DollarSign} label="Balance Neto (CxC - CxP)"
          value={fmtUsd(balanceNeto)}
          sub={balanceNeto >= 0 ? "Superávit de cartera" : "Déficit de cartera"}
          gradient={balanceNeto >= 0 ? "linear-gradient(135deg, #065f46, #047857)" : "linear-gradient(135deg, #b45309, #92400e)"} border="rgba(255,255,255,0.10)"
        />
        <KpiCard
          icon={Clock} label="Deuda más antigua"
          value={`${kpis.diasMasAntiguo || 0}d`}
          sub="días transcurridos"
          gradient="linear-gradient(135deg, #1e3a5f, #1B365D)" border="rgba(255,255,255,0.07)"
        />
      </div>

      {/* Selector de Sección: CxC Clientes vs CxP Proveedores */}
      <div className="flex p-0.5 bg-slate-100/80 rounded-xl max-w-md h-9">
        <button
          onClick={() => setSeccionCredito('cxc')}
          className={`flex-1 text-xs font-bold rounded-lg transition-all ${seccionCredito === 'cxc' ? 'bg-white shadow-md text-primary font-black' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Clientes (CxC)
        </button>
        <button
          onClick={() => setSeccionCredito('cxp')}
          className={`flex-1 text-xs font-bold rounded-lg transition-all ${seccionCredito === 'cxp' ? 'bg-white shadow-md text-primary font-black' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Proveedores (CxP)
        </button>
      </div>

      {seccionCredito === 'cxc' ? (
        <>
          {/* Aging con barras */}
          <AgingBars aging={aging} />

          {/* Tabla de clientes mejorada */}
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-red-500" />
                <h3 className="text-xs sm:text-sm font-black text-slate-800">Clientes con saldo pendiente</h3>
                <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">{clientesConDeuda.length}</span>
              </div>

              <div className="flex items-center gap-2">
                {/* BOTÓN IMPRIMIR */}
                <button
                  onClick={() => exportarCxCPDF('detallado', 'imprimir')}
                  disabled={exportandoCxC}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all text-xs font-bold active:scale-[0.98] disabled:opacity-50 shadow-sm"
                  title="Imprimir Reporte CxC"
                >
                  <Printer size={13} className="text-slate-500" />
                  <span className="hidden sm:inline">Imprimir</span>
                </button>

                {/* BOTÓN DESCARGAR */}
                <button
                  onClick={() => exportarCxCPDF('detallado', 'descargar')}
                  disabled={exportandoCxC}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all text-xs font-bold active:scale-[0.98] disabled:opacity-50 shadow-sm"
                  title="Descargar Reporte CxC"
                >
                  {exportandoCxC ? (
                    <Loader2 size={13} className="animate-spin text-white" />
                  ) : (
                    <Download size={13} className="text-white" />
                  )}
                  <span className="hidden sm:inline">{exportandoCxC ? 'Generando...' : 'Descargar'}</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Vendedor</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Riesgo</th>
                    <th className="px-3 py-2.5 text-center">
                      <SortBtn col="dias" label="Antigüedad" />
                    </th>
                    <th className="px-3 py-2.5 text-center">
                      <SortBtn col="diasRestantes" label="Días Restantes" />
                    </th>
                    <th className="px-3 py-2.5 text-right">
                      <SortBtn col="saldo" label="Saldo USD" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clientesOrdenados.map((c, i) => {
                    const saldo = Number(c.saldo_pendiente)
                    const dias = c.diasSinPago ?? 0
                    const riesgo = riesgoCliente(dias)
                    const barPct = Math.min((saldo / maxSaldo) * 100, 100)

                    return (
                      <tr key={c.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                        {/* Cliente */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-bold text-slate-800 leading-tight">{c.nombre}</p>
                            {c.cargosActivos && c.cargosActivos.some(car => car.metodo_pago === 'cod') && (
                              <span className="bg-blue-100 text-blue-800 text-[8px] font-black px-1.5 py-0.5 rounded border border-blue-200 shrink-0">
                                COD
                              </span>
                            )}
                          </div>
                          {c.rif_cedula && <p className="text-[10px] text-slate-400 font-mono mt-0.5">{c.rif_cedula}</p>}
                          {/* Mini barra de saldo relativo */}
                          <div className="mt-1.5 h-1 rounded-full bg-slate-100 w-24 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: riesgo.bar }} />
                          </div>
                        </td>
                        {/* Vendedor */}
                        <td className="px-3 py-3">
                          {c.vendedor ? (
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.vendedor.color || '#64748b' }} />
                              <span className="text-slate-600 font-medium">{c.vendedor.nombre}</span>
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        {/* Riesgo badge */}
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${riesgo.bg} ${riesgo.text}`}>
                            {riesgo.label}
                          </span>
                        </td>
                        {/* Antigüedad */}
                        <td className="px-3 py-3 text-center">
                          <span className={`font-black text-sm ${dias > 60 ? 'text-red-600' : dias > 30 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {dias}d
                          </span>
                        </td>
                        {/* Días Restantes */}
                        <td className="px-3 py-3 text-center">
                          {c.diasRestantes === null ? (
                            <span className="text-slate-300">—</span>
                          ) : c.diasRestantes < 0 ? (
                            <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-red-100 text-red-700">
                              Vencido ({Math.abs(c.diasRestantes)}d)
                            </span>
                          ) : c.diasRestantes === 0 ? (
                            <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">
                              Vence hoy
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                              {c.diasRestantes}d restantes
                            </span>
                          )}
                        </td>
                        {/* Saldo */}
                        <td className="px-3 py-3 text-right">
                          <span className="font-black text-red-600 text-sm">
                            {fmtUsd(saldo)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer resumen */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">{clientesConDeuda.length} cliente{clientesConDeuda.length !== 1 ? 's' : ''} con deuda activa</span>
              <span className="text-xs font-black text-red-600">
                Total por cobrar: {fmtUsd(totalCxC)}
              </span>
            </div>
          </div>

          {/* Tabla de Abonos Recientes */}
          {abonos && abonos.length > 0 && (
            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-sm mt-4">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-emerald-500" />
                  <h3 className="text-xs sm:text-sm font-black text-slate-800">Historial de Cobranza (Abonos Recientes)</h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold">{abonos.length}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                      <th className="px-4 py-2.5 text-left font-semibold">Fecha</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Método</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Ref / Descripción</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Despacho</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abonos.map((a) => {
                      const numDes = a.despacho?.numero 
                        ? `DES-${String(a.despacho.numero).padStart(5, '0')}` 
                        : (a.despacho?.cotizacion?.numero 
                            ? `COT-${String(a.despacho.cotizacion.numero).padStart(5, '0')}` 
                            : '—')

                      return (
                        <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2.5 text-slate-500 font-medium">
                            {new Date(a.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-3 py-2.5 font-bold text-slate-700">
                            {a.cliente?.nombre || 'Desconocido'}
                          </td>
                          <td className="px-3 py-2.5 text-center font-semibold text-slate-600">
                            {a.metodo_pago || a.forma_pago_abono || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 italic max-w-xs truncate" title={a.descripcion}>
                            {a.referencia ? `Ref: ${a.referencia} · ` : ''}{a.descripcion || 'Sin descripción'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {numDes !== '—' ? (
                              <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono font-bold text-[10px]">
                                {numDes}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-black text-emerald-600 text-sm">
                            +{fmtUsd(a.monto_usd)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Tabla de Proveedores con Cuentas por Pagar (CxP) */
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-sm animate-in fade-in duration-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase size={14} className="text-purple-500" />
              <h3 className="text-xs sm:text-sm font-black text-slate-800">Proveedores con saldo pendiente (CxP)</h3>
              <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 text-[10px] font-bold">{proveedoresConDeuda.length}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2.5 text-left font-semibold">Proveedor</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Tipo</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Contacto</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Ubicación</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Saldo USD (CxP)</th>
                </tr>
              </thead>
              <tbody>
                {proveedoresOrdenados.map((p, i) => {
                  const saldo = Number(p.saldo_pendiente)
                  return (
                    <tr key={p.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/20'}`}>
                      {/* Proveedor */}
                      <td className="px-4 py-3 font-bold text-slate-800">
                        <p>{p.nombre}</p>
                        {p.rif_cedula && <p className="text-[10px] text-slate-400 font-mono mt-0.5">{p.rif_cedula}</p>}
                      </td>
                      {/* Tipo */}
                      <td className="px-3 py-3 capitalize text-slate-600 font-medium">
                        {p.tipo_proveedor}
                      </td>
                      {/* Contacto */}
                      <td className="px-3 py-3 text-slate-500">
                        {p.telefono && <p>{p.telefono}</p>}
                        {p.email && <p className="text-[10px]">{p.email}</p>}
                      </td>
                      {/* Ubicación */}
                      <td className="px-3 py-3 text-slate-500">
                        {p.ciudad ? `${p.ciudad}, ${p.estado}` : '—'}
                      </td>
                      {/* Saldo */}
                      <td className="px-4 py-3 text-right">
                        <span className="font-black text-purple-600 text-sm">
                          {fmtUsd(saldo)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer resumen */}
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">{proveedoresConDeuda.length} proveedor{proveedoresConDeuda.length !== 1 ? 'es' : ''} con saldo pendiente</span>
            <span className="text-xs font-black text-purple-600">
              Total por pagar: {fmtUsd(totalCxP)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab Artículos Externos ──────────────────────────────────────────────────
function TabArticulosExternos({ configNeg }) {
  const [rango, setRango] = useState(() => {
    const actual = getDayRange(0)
    const anterior = getDayRange(-1)
    return { from: actual.from, to: actual.to, prevFrom: anterior.from, prevTo: anterior.to }
  })
  const [exportando, setExportando] = useState(false)
  const [filtroAsesor, setFiltroAsesor] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const { data: items = [], isLoading, isError, refetch } = useReporteExternos({
    from: rango.from,
    to: rango.to
  })

  const asesores = useMemo(() => {
    const map = {}
    items.forEach(item => {
      if (item.asesor_nombre) {
        map[item.asesor_nombre] = { nombre: item.asesor_nombre, color: item.asesor_color }
      }
    })
    return Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [items])

  const itemsFiltrados = useMemo(() => {
    return items.filter(item => {
      const matchAsesor = !filtroAsesor || item.asesor_nombre === filtroAsesor
      
      const q = removeAccents(busqueda.toLowerCase().trim())
      const matchBusqueda = !q ||
        removeAccents(item.articulo_nombre || '').toLowerCase().includes(q) ||
        removeAccents(item.articulo_codigo || '').toLowerCase().includes(q) ||
        removeAccents(item.cliente_nombre || '').toLowerCase().includes(q) ||
        removeAccents(item.cliente_rif || '').toLowerCase().includes(q) ||
        String(item.despacho_numero || '').includes(q)
      
      return matchAsesor && matchBusqueda
    })
  }, [items, filtroAsesor, busqueda])

  const kpis = useMemo(() => {
    const totalVentas = itemsFiltrados.reduce((sum, item) => sum + Number(item.total_usd || 0), 0)
    const cantidadTotal = itemsFiltrados.reduce((sum, item) => sum + Number(item.cantidad || 0), 0)
    const pedidosUnicos = new Set(itemsFiltrados.map(item => item.despacho_id)).size
    const clientesUnicos = new Set(itemsFiltrados.map(item => item.cliente_rif)).size

    return {
      totalVentas,
      cantidadTotal,
      pedidosUnicos,
      clientesUnicos
    }
  }, [itemsFiltrados])

  const exportarPDF = async (accion = 'descargar') => {
    if (!itemsFiltrados.length) return
    setExportando(true)
    try {
      const { generarArticulosExternosPDF } = await import('../services/pdf/articulosExternosPDF')
      await generarArticulosExternosPDF({
        items: itemsFiltrados,
        rango,
        kpis,
        config: configNeg,
        action: accion === 'imprimir' ? 'print' : 'download'
      })
    } catch (e) {
      console.error('Error generando PDF de artículos externos:', e)
    } finally {
      setExportando(false)
    }
  }

  const rangoLabel = `${new Date(`${rango.from}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })} - ${new Date(`${rango.to}T00:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`

  if (isLoading) return <SkeletonReporte />
  if (isError) return <ErrorMsg onRetry={refetch} />

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-3.5">
          {/* Fila Superior: Periodo (con mucho espacio) */}
          <div className="w-full">
            <div className="flex items-center gap-2 ml-1 mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Periodo</label>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                {rangoLabel}
              </span>
            </div>
            <DateRangeSelector value={rango} onChange={setRango} />
          </div>

          {/* Fila Inferior: Otros Filtros y Acciones */}
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-50 pt-3 w-full justify-between">
            {/* Grupo de Filtros */}
            <div className="flex flex-wrap items-end gap-3">
              {/* Selector de Asesor */}
              <div className="w-52">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Asesor (Vendedor)</label>
                <select
                  value={filtroAsesor}
                  onChange={e => setFiltroAsesor(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 text-xs font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none bg-slate-50/50 appearance-none cursor-pointer hover:border-indigo-300 transition-all"
                >
                  <option value="">Todos los asesores</option>
                  {asesores.map(a => (
                    <option key={a.nombre} value={a.nombre}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Búsqueda */}
              <div className="w-60">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1 mb-1 block tracking-wider">Buscar</label>
                <input
                  type="text"
                  placeholder="Buscar por artículo o cliente..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 text-xs font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none bg-slate-50/50 hover:border-indigo-300 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Grupo de Acciones */}
            <div className="flex items-center gap-1.5 ml-auto shrink-0 self-end">
              <button
                onClick={() => exportarPDF('imprimir')}
                disabled={exportando || !itemsFiltrados.length}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm h-9"
              >
                <Printer size={12} className="text-slate-500" />
                <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Imprimir PDF'}</span>
              </button>

              <button
                onClick={() => exportarPDF('descargar')}
                disabled={exportando || !itemsFiltrados.length}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 sm:px-3.5 rounded-xl text-white transition-all active:scale-[0.98] disabled:opacity-50 shadow-md h-9"
                style={{ background: 'linear-gradient(135deg, #1B365D, #0d1f3c)' }}
              >
                <Download size={12} />
                <span className="hidden sm:inline">{exportando ? 'Generando...' : 'Descargar PDF'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          icon={DollarSign}
          label="Total Ventas Externas"
          value={fmtUsd(kpis.totalVentas)}
          gradient="linear-gradient(135deg, #1B365D, #0d1f3c)"
          border="rgba(255,255,255,0.05)"
        />
        <KpiCard
          icon={Briefcase}
          label="Cant. Total Vendida"
          value={Number(kpis.cantidadTotal).toFixed(0)}
          sub="Unidades vendidas"
          gradient="linear-gradient(135deg, #1e293b, #0f172a)"
          border="rgba(255,255,255,0.05)"
        />
        <KpiCard
          icon={FileText}
          label="Pedidos Afectados"
          value={String(kpis.pedidosUnicos)}
          sub="Despachos únicos"
          gradient="linear-gradient(135deg, #0369a1, #0c4a6e)"
          border="rgba(255,255,255,0.05)"
        />
        <KpiCard
          icon={Users}
          label="Clientes Compradores"
          value={String(kpis.clientesUnicos)}
          sub="Clientes distintos"
          gradient="linear-gradient(135deg, #0d5c3a, #064026)"
          border="rgba(255,255,255,0.05)"
        />
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Fecha</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Despacho</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Código</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Artículo</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider">Cant.</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider">P. Unit. ($)</th>
                <th className="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider">Total ($)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Cliente</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Asesor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {itemsFiltrados.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-4 py-8 text-center text-slate-400 font-medium">
                    No se encontraron artículos externos vendidos en el periodo seleccionado.
                  </td>
                </tr>
              ) : (
                itemsFiltrados.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-semibold">
                      {new Date(item.fecha).toLocaleDateString('es-VE')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-slate-900">
                      #{item.despacho_numero}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-medium">
                      {item.articulo_codigo || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-semibold">
                      {item.articulo_nombre}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-600">
                      {Number(item.cantidad || 0) % 1 === 0 ? Number(item.cantidad || 0).toFixed(0) : Number(item.cantidad || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-500">
                      {fmtUsd(item.precio_unit_usd)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-950">
                      {fmtUsd(item.total_usd)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{item.cliente_nombre}</div>
                      <div className="text-[10px] text-slate-400 font-bold">{item.cliente_rif}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.asesor_color }} />
                        <span className="font-bold text-slate-700">{item.asesor_nombre}</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════
export default function ReportesView() {
  const [activeTab, setActiveTab] = useState('comisiones')
  const { data: configNeg = {} } = useConfigNegocio()

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* ── Header compacto mobile ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pb-2 sm:pb-4" style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="w-1 self-stretch rounded-full shrink-0 hidden sm:block"
            style={{ background: 'linear-gradient(180deg, #B8860B 0%, #1B365D 100%)', minHeight: '36px' }} />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08) 0%, rgba(184,134,11,0.08) 100%)', border: '1px solid rgba(27,54,93,0.12)' }}>
            <BarChart3 size={16} style={{ color: '#1B365D' }} className="sm:w-[18px] sm:h-[18px]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-black text-slate-800 leading-tight tracking-tight">Reportes</h1>
            <p className="text-[10px] sm:text-xs font-medium text-slate-400 mt-0.5 truncate">
              Reportes Administrativos
            </p>
          </div>
        </div>
        <button onClick={() => window.location.reload()}
          className="p-1.5 sm:p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg sm:rounded-xl transition-colors shrink-0">
          <RefreshCw size={14} className="sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* ── Tabs scrollable ────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-hide">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${isActive
                  ? 'bg-primary text-white border-primary shadow-md'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}>
              <Icon size={12} className="sm:w-3.5 sm:h-3.5" />
              <span className="sm:hidden">{tab.short}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'comisiones' && <TabComisiones configNeg={configNeg} />}
      {activeTab === 'credito' && <TabCredito />}
      {activeTab === 'ventas' && <TabVentas configNeg={configNeg} />}
      {activeTab === 'externos' && <TabArticulosExternos configNeg={configNeg} />}
    </div>
  )
}
