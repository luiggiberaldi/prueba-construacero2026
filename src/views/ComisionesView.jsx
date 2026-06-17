// src/views/ComisionesView.jsx
// Vista de comisiones agrupadas por vendedor con soporte para paginación y resumen SQL
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, CheckCircle, Clock, Filter, TrendingUp, FileText, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Calendar, User, Briefcase } from 'lucide-react'
import { useComisiones, useComisionesResumen, useMarcarComisionPagada } from '../hooks/useComisiones'
import { useVendedores } from '../hooks/useClientes'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import useAuthStore from '../store/useAuthStore'
import { fmtUsd, fmtFecha, fmtBs } from '../utils/format'
import PageHeader    from '../components/ui/PageHeader'
import Skeleton      from '../components/ui/Skeleton'
import EmptyState    from '../components/ui/EmptyState'
import ConfirmModal  from '../components/ui/ConfirmModal'
import { useTasaCambio } from '../hooks/useTasaCambio'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'


// ─── Tarjeta de resumen ───────────────────────────────────────────────────────
function ResumenCard({ icon: Icon, label, value, sub, gradient, border }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-3 cursor-default"
      style={{ background: gradient, border: `1px solid ${border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}>
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.05)' }} />
      <div className="flex items-center gap-2.5 relative z-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon size={18} className="text-white" />
        </div>
        <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>{label}</p>
      </div>
      <div className="relative z-10">
        <p className="text-2xl font-black leading-tight text-white">{value}</p>
        {sub && <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</div>}
      </div>
    </div>
  )
}

// ─── Tarjeta agrupada por vendedor ──────────────────────────────────────────
function VendedorCard({ vendedor, comisiones, esSupervisor, onMarcarPagada, onPagarTodo, marcando, onExportarPDF, config }) {
  const [abierto, setAbierto] = useState(false)
  const [seleccionados, setSeleccionados] = useState([])

  // Cálculos locales para la tarjeta
  const totalGeneral = useMemo(() => comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0), [comisiones])
  const pendientes = useMemo(() => comisiones.filter(c => ['pendiente', 'cta_cobrar'].includes(c.estado) && Math.max(0, Number(c.comision_liberada || 0) - Number(c.montopagado || 0)) > 0.01), [comisiones])
  const montoPendiente = useMemo(() => pendientes.reduce((s, c) => s + Math.max(0, Number(c.comision_liberada || 0) - Number(c.montopagado || 0)), 0), [pendientes])
  
  // Limpiar seleccionados que ya no existen o ya no están pendientes
  useEffect(() => {
    setSeleccionados(prev => prev.filter(id => pendientes.some(p => p.id === id)))
  }, [pendientes])

  const montoSeleccionado = useMemo(() => {
    return pendientes
      .filter(p => seleccionados.includes(p.id))
      .reduce((s, c) => s + Math.max(0, Number(c.comision_liberada || 0) - Number(c.montopagado || 0)), 0);
  }, [pendientes, seleccionados])

  const montoPendienteRegular = useMemo(() => 
    pendientes.filter(c => c.estado !== 'cta_cobrar')
      .reduce((s, c) => s + Math.max(0, Number(c.comision_liberada || 0) - Number(c.montopagado || 0)), 0), 
    [pendientes]
  )
  
  const montoPendienteCxc = useMemo(() => 
    pendientes.filter(c => c.estado === 'cta_cobrar')
      .reduce((s, c) => s + Math.max(0, Number(c.comision_liberada || 0) - Number(c.montopagado || 0)), 0), 
    [pendientes]
  )
  
  const montoPagado = useMemo(() => comisiones.reduce((s, c) => s + Number(c.montopagado || 0), 0), [comisiones])
  
  const esExterno = !!vendedor?.es_externo || (vendedor?.markup_pct != null && Number(vendedor.markup_pct) > 0);

  const catName = useMemo(() => {
    const base = config?.comision_categoria_cabilla || 'Cabilla';
    const pct = esExterno ? (config?.comision_ext_pct_cabilla || 2) : (config?.comision_pct_cabilla || 2);
    return esExterno ? `Cemento (${pct}%)` : `${base} (${pct}%)`;
  }, [config, esExterno]);

  const estadoBadge = (estado) => {
    if (estado === 'pagada') {
      return { 
        label: 'Pagada', 
        cls: 'text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md font-bold' 
      }
    }
    if (estado === 'cta_cobrar') {
      return { 
        label: 'Cta x Cobrar', 
        cls: 'text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md font-black shadow-sm shadow-red-50' 
      }
    }
    return { 
      label: 'Pendiente', 
      cls: 'text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-bold' 
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all duration-200">
      <div 
        onClick={() => setAbierto(!abierto)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50/50 transition-colors cursor-pointer"
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-black shadow-inner"
          style={{ background: esExterno ? '#D97706' : (vendedor?.color || '#1B365D') }}>
          {(vendedor?.nombre || '?')[0].toUpperCase()}
        </div>
        
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold text-slate-800 truncate">
              {vendedor?.nombre ?? 'Vendedor'}
              {esExterno && ' (E)'}
            </h3>
            {esExterno && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded px-1.5 py-0.2" title={vendedor?.markup_pct ? `Markup del ${vendedor.markup_pct}%` : 'Vendedor Externo'}>
                💼 {vendedor?.markup_pct ? `+${vendedor.markup_pct}%` : 'Externo'}
              </span>
            )}
            {onExportarPDF && (
              <button
                onClick={(e) => { e.stopPropagation(); onExportarPDF(vendedor); }}
                className="p-1.5 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100"
                title="Exportar Estado de Cuenta PDF"
              >
                <Download size={14} />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400 font-medium">{comisiones.length} operaciones</p>
          {esSupervisor && pendientes.length > 0 && montoPendiente > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-1">
              {montoPendienteCxc > 0 && montoPendienteRegular > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const regularPendientes = pendientes.filter(c => c.estado !== 'cta_cobrar');
                    onPagarTodo({
                      vendedor,
                      pendientes: regularPendientes,
                      montoPendiente: montoPendienteRegular,
                      esRegular: true
                    });
                  }}
                  disabled={marcando}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-bold px-3 py-1.5 rounded-lg text-[11px] transition-all disabled:opacity-50 shadow-sm active:scale-95 animate-in fade-in duration-200"
                >
                  <CheckCircle size={12} /> Pagar Regular ({fmtUsd(montoPendienteRegular)})
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onPagarTodo({ vendedor, pendientes, montoPendiente }); }}
                disabled={marcando}
                className="inline-flex items-center gap-1.5 bg-slate-700 text-white hover:bg-slate-850 font-bold px-3 py-1.5 rounded-lg text-[11px] transition-all disabled:opacity-50 shadow-sm active:scale-95"
              >
                <CheckCircle size={12} /> Pagar Todo ({fmtUsd(montoPendiente)})
              </button>
              {seleccionados.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const selectedItems = pendientes.filter(p => seleccionados.includes(p.id));
                    onPagarTodo({
                      vendedor,
                      pendientes: selectedItems,
                      montoPendiente: montoSeleccionado,
                      esSeleccion: true
                    });
                  }}
                  disabled={marcando}
                  className="inline-flex items-center gap-1.5 bg-emerald-500 text-white hover:bg-emerald-600 font-bold px-3 py-1.5 rounded-lg text-[11px] transition-all disabled:opacity-50 shadow-sm active:scale-95 animate-in fade-in zoom-in duration-150"
                >
                  <CheckCircle size={12} /> Pagar Seleccionados ({fmtUsd(montoSeleccionado)})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="text-right shrink-0 flex flex-col items-end">
          <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Saldo Pendiente</p>
          <p className="text-lg font-black text-amber-600 leading-none">{fmtUsd(montoPendiente)}</p>
          <div className="flex flex-col items-end gap-1 mt-1.5 text-[9px] font-bold text-slate-400">
            <div className="flex items-center gap-1.5">
              <span>Gen: {fmtUsd(totalGeneral)}</span>
              <span>Pag: {fmtUsd(montoPagado)}</span>
            </div>
            {(montoPendienteRegular > 0 || montoPendienteCxc > 0) && (
              <div className="flex gap-1 items-center mt-0.5">
                <span className="text-amber-600 bg-amber-50/60 px-1 py-0.2 rounded border border-amber-200/50">Reg: {fmtUsd(montoPendienteRegular)}</span>
                <span className="text-red-600 bg-red-50/60 px-1 py-0.2 rounded border border-red-200/50">CxC: {fmtUsd(montoPendienteCxc)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {abierto && (
        <div className="border-t border-slate-100 bg-slate-50/30">
          <div className="overflow-x-hidden">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] text-slate-400 uppercase tracking-wider bg-slate-50/80">
                  {esSupervisor && montoPendiente > 0 && (
                    <th className="w-8 px-1.5 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={pendientes.length > 0 && seleccionados.length === pendientes.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSeleccionados(pendientes.map(p => p.id));
                          } else {
                            setSeleccionados([]);
                          }
                        }}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="px-2 py-2 font-semibold">Operación</th>
                  <th className="px-2 py-2 font-semibold">Cabilla / Otros</th>
                  <th className="px-2 py-2 font-semibold text-right">Comisión (Tot / Lib / Ret)</th>
                  <th className="px-2 py-2 font-semibold text-right">Pagado / Pendiente</th>
                  <th className="px-2 py-2 font-semibold text-center">Estado</th>
                  {esSupervisor && montoPendiente > 0 && <th className="px-1 py-2"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/60">
                {comisiones.map(c => {
                  const puedePagar = ['pendiente', 'cta_cobrar'].includes(c.estado)
                  const saldoPagar = Math.max(0, Number(c.comision_liberada || 0) - Number(c.montopagado || 0))
                  const badge = estadoBadge(c.estado)
                  
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                      {esSupervisor && montoPendiente > 0 && (
                        <td className="w-8 px-1.5 py-2.5 text-center">
                          {puedePagar && saldoPagar > 0.01 ? (
                            <input
                              type="checkbox"
                              checked={seleccionados.includes(c.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSeleccionados(prev => [...prev, c.id]);
                                } else {
                                  setSeleccionados(prev => prev.filter(id => id !== c.id));
                                }
                              }}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          ) : (
                            <span className="inline-block w-4" />
                          )}
                        </td>
                      )}
                      <td className="px-2 py-2.5">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-slate-800 truncate max-w-[140px]" title={c.despacho?.cliente_nombre || c.cotizacion?.cliente_nombre || ''}>
                            {(c.despacho?.cliente_nombre || c.cotizacion?.cliente_nombre || '---').toUpperCase()}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500 mt-0.5">#{c.despacho?.numero ?? '---'}</span>
                          <span className="text-[9px] text-slate-400">{fmtFecha(c.creadoen)}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-col text-[11px]">
                          <span className="text-slate-500">{catName}: <span className="font-semibold text-slate-700">{fmtUsd(c.comisioncabilla)}</span></span>
                          <span className="text-slate-500">Otros: <span className="font-semibold text-slate-700">{fmtUsd(c.comisionotros)}</span></span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-750">{fmtUsd(c.totalcomision)}</span>
                          <div className="flex justify-end gap-1.5 text-[9px] mt-0.5 font-medium">
                            <span className="text-emerald-700 bg-emerald-50/80 px-1.5 py-0.2 rounded border border-emerald-100" title="Liberada">L: {fmtUsd(c.comision_liberada)}</span>
                            {c.comision_retenida > 0.01 && (
                              <span className="text-amber-700 bg-amber-50/80 px-1.5 py-0.2 rounded border border-amber-100" title="Retenida">R: {fmtUsd(c.comision_retenida)}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <div className="flex flex-col">
                          <span className="text-slate-500 font-medium">{c.montopagado > 0 ? `Pagado: ${fmtUsd(c.montopagado)}` : '---'}</span>
                          {saldoPagar > 0.01 && (
                            <span className="text-amber-600 font-bold text-[10px] mt-0.5 bg-amber-50/60 px-1 py-0.2 rounded border border-amber-200/40 inline-block ml-auto">Pend: {fmtUsd(saldoPagar)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <span className={`text-[10px] ${badge.cls}`}>{badge.label}</span>
                      </td>
                      {esSupervisor && montoPendiente > 0 && (
                        <td className="px-1 py-2.5 text-right">
                          {puedePagar && saldoPagar > 0.01 ? (
                            <button
                              onClick={() => onMarcarPagada(c)}
                              disabled={marcando}
                              className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 font-bold px-2 py-1 rounded-lg transition-colors disabled:opacity-50 border border-emerald-200/50 shadow-sm text-[10px]"
                            >
                              <CheckCircle size={10} /> Pagar
                            </button>
                          ) : (
                            <span className="inline-block w-10"></span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Skeleton de comisiones ───────────────────────────────────────────────────
function SkeletonComisiones() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3 rounded" />
              <Skeleton className="h-2.5 w-1/3 rounded" />
            </div>
            <Skeleton className="h-5 w-20 rounded" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Tabla interactiva para reporte resumido ─────────────────────────────────
function TablaLiquidacionInteractiva({ sellers, ajustes, onChange, tasaEuro }) {
  const rate = Number(tasaEuro?.precio || 0)
  
  // Calcular Totales
  const totalPeriodo = sellers.reduce((acc, s) => acc + s.generadoUsd, 0)
  const totalCxC = sellers.reduce((acc, s) => acc + Number(ajustes[s.id]?.cxc || 0), 0)
  const totalDesc = sellers.reduce((acc, s) => acc + Number(ajustes[s.id]?.descuentoCarro || 0), 0)
  const totalGeneralUsd = totalPeriodo + totalCxC - totalDesc
  const totalGeneralBs = totalGeneralUsd * rate

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-200">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 bg-indigo-600 rounded-full" />
          <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">Ajustes de Liquidación de Comisiones</h4>
        </div>
        <p className="text-[10px] text-slate-400 font-bold uppercase">Ingresa los valores manuales para el PDF</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] text-slate-400 uppercase font-black tracking-wider bg-slate-50/30">
              <th className="px-4 py-3 font-black">Vendedor</th>
              <th className="px-4 py-3 text-right font-black">Comisión Periodo ($)</th>
              <th className="px-4 py-3 text-center font-black bg-amber-50/40 text-amber-700 w-44">Comisión CxC ($)</th>
              <th className="px-4 py-3 text-center font-black bg-slate-50/80 w-44">Descuento Carro ($)</th>
              <th className="px-4 py-3 text-right font-black">Total a Pagar ($)</th>
              <th className="px-4 py-3 text-right font-black">Total en Bs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sellers.map((s) => {
              const cxcVal = s.id in ajustes ? ajustes[s.id].cxc : ''
              const descVal = s.id in ajustes ? ajustes[s.id].descuentoCarro : ''
              
              const totalRowUsd = s.generadoUsd + Number(ajustes[s.id]?.cxc || 0) - Number(ajustes[s.id]?.descuentoCarro || 0)
              const totalRowBs = totalRowUsd * rate

              return (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                  {/* Vendedor */}
                  <td className="px-4 py-3 flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-black"
                      style={{ background: s.color || '#1B365D' }}>
                      {s.nombre[0].toUpperCase()}
                    </div>
                    <span className="font-bold text-slate-800">
                      {s.nombre} {s.esExterno && ' (E)'}
                    </span>
                  </td>

                  {/* Comisión Periodo */}
                  <td className="px-4 py-3 text-right font-bold text-slate-700">
                    {fmtUsd(s.generadoUsd)}
                  </td>

                  {/* Comisión CxC (Input) */}
                  <td className="px-4 py-3 bg-amber-55/10 text-center">
                    <div className="inline-flex items-center rounded-lg border border-amber-200 bg-white px-2 py-0.5 focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500 shadow-sm w-36">
                      <span className="text-[10px] font-bold text-amber-600 mr-1">$</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        value={cxcVal}
                        onChange={(e) => onChange(s.id, 'cxc', e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-xs font-black text-amber-700 focus:ring-0 outline-none text-right placeholder-amber-300"
                      />
                    </div>
                  </td>

                  {/* Descuento Carro (Input) */}
                  <td className="px-4 py-3 bg-slate-50/20 text-center">
                    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2 py-0.5 focus-within:ring-2 focus-within:ring-red-500/10 focus-within:border-red-400 shadow-sm w-36">
                      <span className="text-[10px] font-bold text-slate-400 mr-1">$</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        value={descVal}
                        onChange={(e) => onChange(s.id, 'descuentoCarro', e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-xs font-black text-slate-700 focus:ring-0 outline-none text-right placeholder-slate-300"
                      />
                    </div>
                  </td>

                  {/* Total a Pagar */}
                  <td className="px-4 py-3 text-right font-black text-slate-800 text-sm">
                    {fmtUsd(totalRowUsd)}
                  </td>

                  {/* Total Bs */}
                  <td className="px-4 py-3 text-right font-black text-slate-500">
                    {rate > 0 ? fmtBs(totalRowBs) : 'N/D'}
                  </td>
                </tr>
              )
            })}

            {/* Totales */}
            <tr className="bg-slate-50 font-bold border-t-2 border-slate-200 text-slate-850">
              <td className="px-4 py-3 text-left font-black text-indigo-900">
                TOTAL GENERAL
              </td>
              <td className="px-4 py-3 text-right font-black">
                {fmtUsd(totalPeriodo)}
              </td>
              <td className="px-4 py-3 text-center bg-amber-50/20">
                <span className="font-black text-amber-700">{fmtUsd(totalCxC)}</span>
              </td>
              <td className="px-4 py-3 text-center bg-slate-50/45">
                <span className="font-black text-slate-600">{fmtUsd(totalDesc)}</span>
              </td>
              <td className="px-4 py-3 text-right font-black text-slate-900 text-sm">
                {fmtUsd(totalGeneralUsd)}
              </td>
              <td className="px-4 py-3 text-right font-black text-slate-700">
                {rate > 0 ? fmtBs(totalGeneralBs) : 'N/D'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function ComisionesView() {
  const navigate = useNavigate()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const switchOut = useAuthStore(s => s.switchOut)
  const puedeGestionarPagos = ['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const puedePagarComisiones = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)

  const [filtroEstado,   setFiltroEstado]   = useState('pendiente')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [fechaDesde,     setFechaDesde]     = useState('')
  const [fechaHasta,     setFechaHasta]     = useState('')
  const [page,           setPage]           = useState(1)
  const [formatoReporte, setFormatoReporte] = useState('detallado') // 'detallado', 'resumido'
  const { tasaEuro } = useTasaCambio()
  const pageSize = 48 // Agrupamos de a 48 para que la cuadrícula sea simétrica (3 col x 16 filas)

  const [comisionAPagar, setComisionAPagar] = useState(null)
  const [pagoMasivoData, setPagoMasivoData] = useState(null)
  const [pagandoMasivo, setPagandoMasivo] = useState(false)

  const [ajustesManuales, setAjustesManuales] = useState({})

  const handleAjusteChange = useCallback((sellerId, field, val) => {
    setAjustesManuales(prev => ({
      ...prev,
      [sellerId]: {
        ...(prev[sellerId] || { cxc: '', descuentoCarro: '' }),
        [field]: val
      }
    }))
  }, [])

  // Reset de página al cambiar filtros
  useEffect(() => { setPage(1) }, [filtroEstado, filtroVendedor, fechaDesde, fechaHasta])

  const { data: comisionesRes, isLoading } = useComisiones({
    estado:     filtroEstado,
    vendedorId: puedeGestionarPagos ? filtroVendedor : '',
    desde:      fechaDesde,
    hasta:      fechaHasta,
    page,
    pageSize
  })

  const { data: resumen, isLoading: resumenLoading } = useComisionesResumen({
    vendedorId: puedeGestionarPagos ? filtroVendedor : '',
    desde:      fechaDesde,
    hasta:      fechaHasta,
    estado:     filtroEstado
  })

  const { data: vendedores = [] } = useVendedores()
  const { data: configNeg = {} } = useConfigNegocio()
  const marcar = useMarcarComisionPagada()
  const [exportando, setExportando] = useState(false)
  const [menuAbierto, setMenuAbierto] = useState(false)

  const comisiones = comisionesRes?.data ?? []

  // Agrupar comisiones por vendedor
  const comisionesPorVendedor = useMemo(() => {
    const mapa = new Map()
    for (const c of comisiones) {
      const vid = c.vendedorid || '00000000-0000-0000-0000-000000000000'
      const infoVendedor = c.vendedor || { nombre: 'Sin Asignar', color: '#64748b' }
      if (!mapa.has(vid)) mapa.set(vid, { id: vid, vendedor: infoVendedor, items: [] })
      mapa.get(vid).items.push(c)
    }
    return [...mapa.values()]
  }, [comisiones])

  // Resumen de vendedores para la tabla interactiva
  const sellersSummary = useMemo(() => {
    return comisionesPorVendedor.map(g => {
      const vendedor = g.vendedor || { nombre: 'Sin Asignar', color: '#64748b' }
      const esExterno = !!vendedor?.es_externo || (vendedor?.markup_pct != null && Number(vendedor.markup_pct) > 0)
      
      const validItems = g.items.filter(c => c.estado !== 'cta_cobrar')
      const generadoUsd = validItems.reduce((acc, c) => acc + Number(c.totalcomision || 0), 0)
      
      return {
        id: g.id,
        nombre: vendedor.nombre,
        color: vendedor.color,
        esExterno,
        generadoUsd
      }
    }).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [comisionesPorVendedor])

  async function exportarPDF(vendedorFiltro = null, tipoVendedor = null) {
    setExportando(true)
    try {
      const activeVendedor = vendedorFiltro || (filtroVendedor ? vendedores.find(v => v.id === filtroVendedor) : null)
      
      const params = new URLSearchParams()
      params.set('vista', 'eventos')
      params.set('page', '1')
      params.set('pageSize', '500')
      if (fechaDesde) params.set('desde', fechaDesde)
      if (fechaHasta) params.set('hasta', fechaHasta)

      if (activeVendedor) {
        params.set('vendedorId', activeVendedor.id)
      } else if (!puedeGestionarPagos && perfil?.id) {
        params.set('vendedorId', perfil.id)
      }

      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const resJson = await res.json()
      const rawEvents = resJson.data || []

      if (!rawEvents || rawEvents.length === 0) {
        alert('🔍 SIN DATOS: No hay eventos de liberación de comisiones en el periodo seleccionado.')
        setExportando(false)
        return
      }

      let filteredEvents = rawEvents

      if (tipoVendedor === 'internos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || r.comisiones?.vendedor
          const esExt = !!v?.es_externo || (v?.markup_pct != null && Number(v.markup_pct) > 0)
          return !esExt
        })
      } else if (tipoVendedor === 'externos') {
        filteredEvents = rawEvents.filter(r => {
          const v = r.vendedor || r.comisiones?.vendedor
          const esExt = !!v?.es_externo || (v?.markup_pct != null && Number(v.markup_pct) > 0)
          return esExt
        })
      }

      if (filteredEvents.length === 0) {
        alert('🔍 SIN DATOS: No hay eventos de liberación de comisiones en el grupo seleccionado.')
        setExportando(false)
        return
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

      const items = filteredEvents.map(r => {
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
          vendedor: r.vendedor || com.vendedor || (activeVendedor ? {
            id: activeVendedor.id,
            nombre: activeVendedor.nombre,
            color: activeVendedor.color,
            markup_pct: activeVendedor.markup_pct,
            es_externo: activeVendedor.es_externo
          } : null)
        };
      });

      const rango = { from: fechaDesde, to: fechaHasta }
      
      const { generarComisionesPDF } = await import('../services/pdf/comisionesPDF')
      await generarComisionesPDF({ 
        comisiones: items, 
        vendedor: activeVendedor ? { id: activeVendedor.id, nombre: activeVendedor.nombre, color: activeVendedor.color } : null, 
        tipoVendedor,
        rango, 
        config: configNeg ?? {},
        formato: formatoReporte,
        tasaEuro: tasaEuro?.precio || 0,
        ajustesManuales
      })
    } catch (e) { console.error('Error PDF:', e) }
    setExportando(false)
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">
      <PageHeader
        icon={DollarSign}
        title="Comisiones"
        subtitle="Reporte financiero de ventas y liquidaciones"
      />

      {/* KPIs (Fuente de verdad SQL) */}
      {resumenLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ResumenCard
            icon={TrendingUp}
            label="Total General"
            value={fmtUsd(resumen.totalAcumulado)}
            sub="Histórico bruto"
            gradient="linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
            border="rgba(255,255,255,0.05)"
          />
          <ResumenCard
            icon={Clock}
            label="Pendiente Cobro"
            value={fmtUsd(resumen.pendientePago)}
            sub={
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-[10px] text-amber-200 bg-amber-950/40 border border-amber-800/20 px-1.5 py-0.5 rounded font-bold shadow-sm shadow-black/10">
                  Reg: {fmtUsd(resumen.pendienteRegular ?? 0)}
                </span>
                <span className="text-[10px] text-red-200 bg-red-950/40 border border-red-800/20 px-1.5 py-0.5 rounded font-black shadow-sm shadow-black/10">
                  CxC: {fmtUsd(resumen.pendienteCxc ?? 0)}
                </span>
              </div>
            }
            gradient="linear-gradient(135deg, #92400e 0%, #78350f 100%)"
            border="rgba(255,255,255,0.05)"
          />
          <ResumenCard
            icon={DollarSign}
            label="Pagado"
            value={fmtUsd(resumen.yaPagado)}
            sub={`${resumen.numPagadas} pagadas`}
            gradient="linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)"
            border="rgba(255,255,255,0.05)"
          />
          <ResumenCard
            icon={CheckCircle}
            label="Comisiones"
            value={String(resumen.total)}
            sub="Total registros"
            gradient="linear-gradient(135deg, #065f46 0%, #064e3b 100%)"
            border="rgba(255,255,255,0.05)"
          />
        </div>
      )}

      {/* Filtros Avanzados */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1 ml-1">Desde</span>
              <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
                <Calendar size={13} className="text-slate-400 shrink-0" />
                <input type="date" value={fechaDesde} max={fechaHasta || undefined} onChange={e => setFechaDesde(e.target.value)} className="bg-transparent text-xs font-bold focus:outline-none" />
              </div>
            </div>
            <span className="text-slate-300 mt-4">→</span>
            <div className="flex flex-col">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1 ml-1">Hasta</span>
              <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
                <Calendar size={13} className="text-slate-400 shrink-0" />
                <input type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={e => setFechaHasta(e.target.value)} className="bg-transparent text-xs font-bold focus:outline-none" />
              </div>
            </div>
          </div>

          <div className="flex gap-1">
            {[{v:'',l:'Todas'}, {v:'pendiente',l:'Pendientes'}, {v:'cta_cobrar',l:'Cta x Cobrar'}, {v:'pagada',l:'Pagadas'}].map(o => (
              <button key={o.v} onClick={() => setFiltroEstado(o.v)} className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${filtroEstado === o.v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {o.l}
              </button>
            ))}
          </div>

          <div className="flex p-0.5 bg-slate-100 rounded-xl h-9 min-w-[180px] border border-slate-200">
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

          {puedeGestionarPagos && (
            <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 outline-none hover:bg-slate-50 transition-all">
              <option value="">Todos los Vendedores</option>
              <option value="00000000-0000-0000-0000-000000000000">Sin Asignar</option>
              {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          )}

          {tasaEuro?.precio > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-800 text-xs font-bold shrink-0 h-9">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
              <span>Tasa Euro BCV: <b>{fmtBs(tasaEuro.precio)}</b></span>
            </div>
          )}

          {comisiones.length > 0 && (
            <div className="relative ml-auto shrink-0">
              <button 
                onClick={() => setMenuAbierto(!menuAbierto)} 
                disabled={exportando} 
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-slate-200 active:scale-95 transition-all disabled:opacity-50"
              >
                <Download size={14} />
                <span>{exportando ? 'EXPORTANDO...' : 'DESCARGAR PDF'}</span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${menuAbierto ? 'rotate-180' : ''}`} />
              </button>
              
              {menuAbierto && (
                <>
                  {/* Backdrop para cerrar clickeando fuera */}
                  <div className="fixed inset-0 z-40" onClick={() => setMenuAbierto(false)} />
                  
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white border border-slate-100 shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                    <button
                      onClick={() => { setMenuAbierto(false); exportarPDF(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <FileText size={16} className="text-slate-400 shrink-0" />
                      <span>Toda la Página</span>
                    </button>
                    <button
                      onClick={() => { setMenuAbierto(false); exportarPDF(null, 'internos'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <span className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                        <User size={12} className="text-indigo-600" />
                      </span>
                      <span>Solo Vendedores Internos</span>
                    </button>
                    <button
                      onClick={() => { setMenuAbierto(false); exportarPDF(null, 'externos'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <span className="w-5 h-5 rounded-full bg-[#FEF3C7] border border-[#FDE68A] flex items-center justify-center shrink-0">
                        <Briefcase size={12} className="text-[#B45309]" />
                      </span>
                      <span>Solo Vendedores Externos</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lista Paginada */}
      {isLoading ? <SkeletonComisiones /> : comisiones.length === 0 ? (
        <EmptyState icon={DollarSign} title="Sin resultados" description="No se encontraron comisiones con los filtros actuales." />
      ) : (
        <>
          {formatoReporte === 'resumido' ? (
            <TablaLiquidacionInteractiva
              sellers={sellersSummary}
              ajustes={ajustesManuales}
              onChange={handleAjusteChange}
              tasaEuro={tasaEuro}
            />
          ) : (() => {
            const comisionesInternos = comisionesPorVendedor.filter(g => !(!!g.vendedor?.es_externo || (g.vendedor?.markup_pct != null && Number(g.vendedor.markup_pct) > 0)))
            const comisionesExternos = comisionesPorVendedor.filter(g => !!g.vendedor?.es_externo || (g.vendedor?.markup_pct != null && Number(g.vendedor.markup_pct) > 0))
            return (
              <div className="space-y-8">
                {/* 1. ASESORES INTERNOS */}
                {comisionesInternos.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                      <div className="w-1.5 h-4 bg-indigo-600 rounded-full" />
                      <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendedores Internos ({comisionesInternos.length})</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                      {comisionesInternos.map(g => (
                        <VendedorCard 
                          key={g.id} 
                          vendedor={{ id: g.id, ...g.vendedor }} 
                          comisiones={g.items} 
                          esSupervisor={puedePagarComisiones} 
                          onMarcarPagada={setComisionAPagar} 
                          onPagarTodo={setPagoMasivoData}
                          marcando={marcar.isPending || pagandoMasivo} 
                          onExportarPDF={exportarPDF} 
                          config={configNeg}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. VENDEDORES EXTERNOS */}
                {comisionesExternos.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center gap-2 px-1">
                      <div className="w-1.5 h-4 bg-[#D97706] rounded-full" />
                      <h4 className="text-xs font-black text-[#B45309] uppercase tracking-wider">Vendedores Externos ({comisionesExternos.length})</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                      {comisionesExternos.map(g => (
                        <VendedorCard 
                          key={g.id} 
                          vendedor={{ id: g.id, ...g.vendedor }} 
                          comisiones={g.items} 
                          esSupervisor={puedePagarComisiones} 
                          onMarcarPagada={setComisionAPagar} 
                          onPagarTodo={setPagoMasivoData}
                          marcando={marcar.isPending || pagandoMasivo} 
                          onExportarPDF={exportarPDF} 
                          config={configNeg}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Paginación */}
          {comisionesRes?.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <button disabled={page === 1} onClick={() => { setPage(p => p - 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronLeft size={20} />
              </button>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-400">Página</span>
                <span className="text-sm font-black text-slate-800">{page}</span>
                <span className="text-sm font-bold text-slate-400">de</span>
                <span className="text-sm font-black text-slate-800">{comisionesRes.totalPages}</span>
              </div>
              <button disabled={page >= comisionesRes.totalPages} onClick={() => { setPage(p => p + 1); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={!!comisionAPagar}
        onConfirm={() => { marcar.mutate({ comisionid: comisionAPagar.id, montopagado: Number(comisionAPagar.comision_liberada || 0) }); setComisionAPagar(null) }}
        onClose={() => setComisionAPagar(null)}
        title="Registrar Pago de Comisión"
        message={comisionAPagar ? `Se registrará el pago de ${fmtUsd(Math.max(0, Number(comisionAPagar.comision_liberada || 0) - Number(comisionAPagar.montopagado || 0)))}. Esta acción es atómica y final.` : ''}
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
            const saldo = Math.max(0, Number(c.comision_liberada || 0) - Number(c.montopagado || 0))
            if (saldo > 0.01) {
              try {
                await marcar.mutateAsync({ comisionid: c.id, montopagado: Number(c.comision_liberada || 0) })
              } catch (e) {
                console.error('Error pagando comisión', c.id, e)
              }
            }
          }
          setPagandoMasivo(false)
          setPagoMasivoData(null)
        }}
        onClose={() => setPagoMasivoData(null)}
        title={
          pagoMasivoData?.esSeleccion 
            ? "Pagar Comisiones Seleccionadas" 
            : (pagoMasivoData?.esRegular ? "Pagar Comisiones Regulares (no CxC)" : "Pagar Todas las Comisiones")
        }
        message={
          pagoMasivoData 
            ? `Se registrará el pago de ${pagoMasivoData.pendientes.length} comisiones ${
                pagoMasivoData.esSeleccion 
                  ? 'seleccionadas' 
                  : (pagoMasivoData.esRegular ? 'regulares (no CxC)' : 'pendientes')
              } de ${pagoMasivoData.vendedor?.nombre || 'este vendedor'} por un total de ${fmtUsd(pagoMasivoData.montoPendiente)}. Esta acción es secuencial y final.` 
            : ''
        }
        confirmText={
          pagoMasivoData?.esSeleccion 
            ? "Confirmar Pago Seleccionado" 
            : (pagoMasivoData?.esRegular ? "Confirmar Pago Regular" : "Confirmar Pago Total")
        }
        variant="success"
      />
    </div>
  )
}
