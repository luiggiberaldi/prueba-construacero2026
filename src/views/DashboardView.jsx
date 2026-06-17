// src/views/DashboardView.jsx
// Panel de inicio — dashboard específico por rol
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useMemo, useCallback } from 'react'
import {
  LayoutDashboard, FileText, Users, DollarSign, TrendingUp, Clock,
  Plus, UserCog, ClipboardList, ArrowRight, Package, UserRound,
  BarChart2, AlertCircle, Truck, PackageCheck, AlertTriangle, MapPin, Calendar, Zap,
} from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import supabase     from '../services/supabase/client'
import { fmtUsd, fmtBs, usdToBs } from '../utils/format'
import { useTasaCambio } from '../hooks/useTasaCambio'
import { useComisionesResumen } from '../hooks/useComisiones'
import { useResumenCxC } from '../hooks/useCuentasCobrar'
import { useDashboardMetrics } from '../hooks/useDashboardMetrics'
import MetricCard   from '../components/ui/MetricCard'
import Skeleton     from '../components/ui/Skeleton'
import PageHeader  from '../components/ui/PageHeader'
import EmptyState  from '../components/ui/EmptyState'
import OnboardingTip from '../components/ui/OnboardingTooltip'

// ─── Colores de estado ────────────────────────────────────────────────────────
const ESTADO_COLOR = {
  borrador:  { bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400'   },
  enviada:   { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500'    },
  aceptada:  { bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  rechazada: { bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500'     },
  vencida:   { bg: 'bg-orange-50',   text: 'text-orange-700',  dot: 'bg-orange-500'  },
  anulada:   { bg: 'bg-slate-100',   text: 'text-slate-400',   dot: 'bg-slate-300'   },
}

const ESTADO_LABEL = {
  borrador: 'Borradores', enviada: 'Enviadas', aceptada: 'Aceptadas',
  rechazada: 'Rechazadas', vencida: 'Vencidas', anulada: 'Anuladas',
}

// ─── Hook de métricas de cotizaciones (vendedor + supervisor) ────────────────
function useMetricas() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esPrivilegiado = esSupervisor || perfil?.rol === 'administracion' || esDesarrollador

  return useQuery({
    queryKey: ['dashboard_metricas', perfil?.id, esPrivilegiado],
    queryFn: async () => {
      const tabla = 'cotizaciones'
      const ahora     = new Date()
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()
      const inicioMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).toISOString()
      const finMesAnt    = new Date(ahora.getFullYear(), ahora.getMonth(), 0, 23, 59, 59).toISOString()

      let q = supabase.from(tabla).select('id, estado, total_usd, creado_en')
        .gte('creado_en', inicioMesAnt).limit(500)
      if (!esPrivilegiado) q = q.eq('vendedor_id', perfil.id)

      let dq = supabase.from('notas_despacho')
        .select('cotizacion_id, estado, entregada_en, total_usd')
        .eq('estado', 'entregada')
        .gte('entregada_en', inicioMesAnt)
        .limit(500)

      // Parallel fetch — both queries run at the same time
      const [cotRes, despRes] = await Promise.all([q, dq])
      if (cotRes.error) throw cotRes.error
      const todas = cotRes.data ?? []
      const despachos = despRes.data ?? []

      const entregadosMesIds = new Set(
        (despachos ?? []).filter(d => d.entregada_en >= inicioMes).map(d => d.cotizacion_id)
      )
      const entregadosMesAntIds = new Set(
        (despachos ?? []).filter(d => d.entregada_en >= inicioMesAnt && d.entregada_en <= finMesAnt).map(d => d.cotizacion_id)
      )

      const delMes    = todas.filter(c => c.creado_en >= inicioMes)
      const porEstado = {}
      todas.forEach(c => {
        if (!porEstado[c.estado]) porEstado[c.estado] = { count: 0, total: 0 }
        porEstado[c.estado].count  += 1
        porEstado[c.estado].total  += Number(c.total_usd || 0)
      })

      const totalMesUsd = todas
        .filter(c => entregadosMesIds.has(c.id))
        .reduce((s, c) => s + Number(c.total_usd || 0), 0)
      const totalMesAntUsd = todas
        .filter(c => entregadosMesAntIds.has(c.id))
        .reduce((s, c) => s + Number(c.total_usd || 0), 0)
      const pendientesRespuesta = todas.filter(c => c.estado === 'enviada').length
      const aceptadas  = todas.filter(c => c.estado === 'aceptada').length
      const rechazadas = todas.filter(c => c.estado === 'rechazada').length
      const tasaAceptacion = (aceptadas + rechazadas) > 0
        ? Math.round((aceptadas / (aceptadas + rechazadas)) * 100)
        : null

      return {
        total: todas.length, porEstado, totalMesUsd, totalMesAntUsd,
        delMesCount: delMes.length, pendientesRespuesta, tasaAceptacion,
      }
    },
    enabled: !!perfil && (perfil.rol === 'vendedor' || perfil.rol === 'vendedor_sin_comision' || perfil.rol === 'supervisor' || perfil.rol === 'jefe' || perfil.rol === 'desarrollador'),
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Skeleton cards ──────────────────────────────────────────────────────────
function SkeletonCards({ count = 4 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
            <Skeleton className="h-3 w-2/3 rounded" />
          </div>
          <Skeleton className="h-6 w-1/2 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Formato fecha relativa ──────────────────────────────────────────────────
function fmtRelativo(fecha) {
  if (!fecha) return '—'
  const d = new Date(fecha)
  const ahora = new Date()
  const diffDias = Math.floor((ahora - d) / (1000 * 60 * 60 * 24))
  if (diffDias === 0) return 'Hoy'
  if (diffDias === 1) return 'Ayer'
  if (diffDias < 7) return `Hace ${diffDias} días`
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function DashboardView() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esJefe = perfil?.rol === 'jefe'
  const esSupervisor = perfil?.rol === 'supervisor'
  const esAdministracion = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esLogistica = perfil?.rol === 'logistica'
  const esVendedor = perfil?.rol === 'vendedor' || perfil?.rol === 'vendedor_sin_comision'
  const esPrivilegiado = esSupervisor || esAdministracion || esDesarrollador || esJefe

  const { data: m, isLoading } = useMetricas()
  const { data: dm, isLoading: dmLoading } = useDashboardMetrics()
  const { data: comResumen } = useComisionesResumen()
  const { data: cxcResumen } = useResumenCxC()
  const { tasaEfectiva } = useTasaCambio()
  const navigate = useNavigate()

  const mesActual = new Date().toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })

  const variacionMes = useMemo(() => m && m.totalMesAntUsd > 0
    ? Math.round(((m.totalMesUsd - m.totalMesAntUsd) / m.totalMesAntUsd) * 100)
    : null, [m?.totalMesUsd, m?.totalMesAntUsd])

  // Subtítulo según rol
  const subtitle = esLogistica
    ? `Centro de entregas · ${mesActual}`
    : esAdministracion
      ? `Panel de administración · ${mesActual}`
      : esJefe
        ? `Panel Ejecutivo (C-Level) · ${mesActual}`
        : `Bienvenido, ${perfil?.nombre?.split(' ')[0] ?? 'usuario'} · ${mesActual}`

  const loading = isLoading || dmLoading

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* Tip de onboarding — solo vendedor/supervisor */}
      {(esVendedor || esSupervisor || esDesarrollador) && !esJefe && (
        <OnboardingTip tipId="dashboard_intro">
          ¡Bienvenido! Usa el botón <strong>"Rápida"</strong> para crear cotizaciones al instante, o <strong>"Nueva"</strong> para el asistente paso a paso. En móvil, el botón dorado flotante ⚡ te lleva directo a cotizar.
        </OnboardingTip>
      )}

      {/* Encabezado */}
      <PageHeader
        icon={LayoutDashboard}
        title="Inicio"
        subtitle={subtitle}
        action={!esAdministracion && !esLogistica ? (
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/venta-rapida')}
              className="flex items-center gap-1.5 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Zap size={15} strokeWidth={2.5} />Rápida
            </button>
            <button onClick={() => navigate('/cotizaciones?nueva=1')}
              className="flex items-center gap-1.5 font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow active:scale-[0.98] border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              <FileText size={15} strokeWidth={2} />Cotizar
            </button>
          </div>
        ) : null}
      />

      {/* ══════════ METRIC CARDS POR ROL ══════════ */}
      {loading ? <SkeletonCards count={esLogistica ? 2 : 4} /> : (
        <>
          {/* ── VENDEDOR ── */}
          {esVendedor && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              <MetricCard
                icon={DollarSign}
                label={`Facturado en ${new Date().toLocaleDateString('es-VE',{month:'long'})}`}
                value={fmtUsd(m?.totalMesUsd ?? 0)}
                sub={tasaEfectiva > 0 ? fmtBs(usdToBs(m?.totalMesUsd ?? 0, tasaEfectiva)) : undefined}
                color="emerald"
              />
              <MetricCard
                icon={Clock}
                label="Esperando respuesta"
                value={m?.pendientesRespuesta ?? 0}
                sub="cotizaciones enviadas"
                color="blue"
              />
              <MetricCard
                icon={ClipboardList}
                label="Pendientes de aprobación"
                value={dm?.despachosPendientes ?? 0}
                sub="despachos en espera"
                color="gold"
                onClick={() => navigate('/despachos')}
              />
              <MetricCard
                icon={DollarSign}
                label="Comisiones pendientes"
                value={fmtUsd(comResumen?.pendiente ?? 0)}
                sub={comResumen?.countPendiente ? `${comResumen.countPendiente} por pagar` : undefined}
                color="primary"
                onClick={() => navigate('/comisiones')}
              />
              <MetricCard
                icon={Users}
                label="Clientes con deuda"
                value={cxcResumen?.kpis?.numClientesConDeuda ?? 0}
                sub={cxcResumen?.kpis?.totalDeuda > 0 ? fmtUsd(cxcResumen.kpis.totalDeuda) : undefined}
                color="red"
              />
            </div>
          )}

          {/* ── ADMINISTRACIÓN ── */}
          {esAdministracion && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <MetricCard
                icon={ClipboardList}
                label="Despachos por aprobar"
                value={dm?.despachosPendientes ?? 0}
                sub="acción requerida"
                color="gold"
                onClick={() => navigate('/cotizaciones')}
              />
              <MetricCard
                icon={AlertCircle}
                label="Cuentas por cobrar"
                value={fmtUsd(cxcResumen?.kpis?.totalDeuda ?? 0)}
                sub={`${cxcResumen?.kpis?.numClientesConDeuda ?? 0} clientes con deuda`}
                color="red"
              />
              <MetricCard
                icon={Package}
                label="Inventario bajo stock"
                value={dm?.stockBajoCount ?? 0}
                sub="productos por reabastecer"
                color={dm?.stockBajoCount > 0 ? 'red' : 'primary'}
                onClick={() => navigate('/inventario?filtro=stock_bajo')}
              />
              <MetricCard
                icon={DollarSign}
                label="Ventas del día"
                value={fmtUsd(dm?.ventasDia ?? 0)}
                sub={`Semana: ${fmtUsd(dm?.ventasSemana ?? 0)}`}
                color="emerald"
              />
            </div>
          )}

          {/* ── LOGÍSTICA ── */}
          {esLogistica && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <MetricCard
                icon={Truck}
                label="Entregas pendientes"
                value={dm?.despachosDespachados ?? 0}
                sub="por entregar"
                color="blue"
                onClick={() => navigate('/despachos')}
              />
              <MetricCard
                icon={PackageCheck}
                label="Entregadas hoy"
                value={dm?.entregasHoy ?? 0}
                sub="completadas"
                color="emerald"
              />
            </div>
          )}

          {/* ── JEFE (C-LEVEL) ── */}
          {esJefe && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <MetricCard
                icon={DollarSign}
                label={`Facturación Global ${new Date().toLocaleDateString('es-VE',{month:'long'})}`}
                value={fmtUsd(m?.totalMesUsd ?? 0)}
                sub={tasaEfectiva > 0
                  ? fmtBs(usdToBs(m?.totalMesUsd ?? 0, tasaEfectiva))
                  : variacionMes !== null
                    ? `${variacionMes >= 0 ? '+' : ''}${variacionMes}% vs mes anterior`
                    : undefined}
                color="gold"
              />
              <MetricCard
                icon={AlertCircle}
                label="Cuentas por cobrar"
                value={fmtUsd(cxcResumen?.kpis?.totalDeuda ?? 0)}
                sub={`${cxcResumen?.kpis?.numClientesConDeuda ?? 0} clientes con deuda`}
                color="red"
              />
              <MetricCard
                icon={ClipboardList}
                label="Flujo de despachos"
                value={dm?.despachosPendientes ?? 0}
                sub="despachos pendientes de revisión"
                color="gold"
                onClick={() => navigate('/despachos')}
              />
              <MetricCard
                icon={TrendingUp}
                label="Efectividad general"
                value={m?.tasaAceptacion !== null ? `${m?.tasaAceptacion}%` : '—'}
                sub={m?.tasaAceptacion !== null ? 'tasa de aceptación de cotizaciones' : 'sin datos'}
                color="primary"
              />
            </div>
          )}

          {/* ── SUPERVISOR ── */}
          {(esSupervisor || esDesarrollador) && !esJefe && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <MetricCard
                icon={DollarSign}
                label={`Facturado en ${new Date().toLocaleDateString('es-VE',{month:'long'})}`}
                value={fmtUsd(m?.totalMesUsd ?? 0)}
                sub={tasaEfectiva > 0
                  ? fmtBs(usdToBs(m?.totalMesUsd ?? 0, tasaEfectiva))
                  : variacionMes !== null
                    ? `${variacionMes >= 0 ? '+' : ''}${variacionMes}% vs mes anterior`
                    : undefined}
                color="emerald"
              />
              <MetricCard
                icon={Clock}
                label="Esperando respuesta"
                value={m?.pendientesRespuesta ?? 0}
                sub="cotizaciones enviadas"
                color="blue"
              />
              <MetricCard
                icon={ClipboardList}
                label="Despachos por aprobar"
                value={dm?.despachosPendientes ?? 0}
                sub="pendientes de revisión"
                color="gold"
                onClick={() => navigate('/despachos')}
              />
              <MetricCard
                icon={TrendingUp}
                label="Tasa de aceptación"
                value={m?.tasaAceptacion !== null ? `${m?.tasaAceptacion}%` : '—'}
                sub={m?.tasaAceptacion !== null ? 'aceptadas vs rechazadas' : 'sin datos'}
                color="primary"
              />
              {cxcResumen?.kpis?.totalDeuda > 0 && (
                <MetricCard
                  icon={AlertCircle}
                  label="Cuentas por cobrar"
                  value={fmtUsd(cxcResumen.kpis.totalDeuda)}
                  sub={`${cxcResumen.kpis.numClientesConDeuda ?? 0} clientes con deuda`}
                  color="red"
                />
              )}
            </div>
          )}
        </>
      )}

      {/* ══════════ SECCIONES DE CONTENIDO POR ROL ══════════ */}

      {/* ── JEFE (C-LEVEL): Accesos Rápidos y Pulso de Ventas ── */}
      {esJefe && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0f1f3c] text-white rounded-2xl border border-white/10 p-5 space-y-4 shadow-xl">
            <h2 className="font-bold text-[13px] uppercase tracking-wider flex items-center gap-2" style={{ color: '#D4AF37' }}>
              <Zap size={15} /> Pulso de Ventas
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-[11px] text-white/50 uppercase tracking-widest font-bold mb-1">Ventas del Día</p>
                <p className="text-2xl font-black">{fmtUsd(dm?.ventasDia ?? 0)}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-[11px] text-white/50 uppercase tracking-widest font-bold mb-1">Esta Semana</p>
                <p className="text-2xl font-black">{fmtUsd(dm?.ventasSemana ?? 0)}</p>
              </div>
            </div>
            {variacionMes !== null && (
              <div className="bg-white/5 rounded-xl p-3 flex items-center justify-between">
                <span className="text-sm font-medium text-white/70">Progreso mensual</span>
                <div className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${variacionMes >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {variacionMes >= 0 ? '↑' : '↓'} {Math.abs(variacionMes)}% vs anterior
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-3">
            <h2 className="font-bold text-slate-700 text-[13px] uppercase tracking-wider flex items-center gap-2">
              <LayoutDashboard size={15} className="text-amber-600" /> Control Mando
            </h2>
            <div className="grid grid-cols-2 gap-3 flex-1">
              {[
                { label: 'Cotizaciones', icon: FileText, path: '/cotizaciones', color: 'slate' },
                { label: 'Despachos',    icon: Truck,    path: '/despachos',    color: 'blue' },
                { label: 'Comisiones',   icon: DollarSign, path: '/comisiones', color: 'emerald' },
                { label: 'Reportes',     icon: BarChart2, path: '/reportes',    color: 'purple' },
              ].map((b, i) => (
                <button key={i} onClick={() => navigate(b.path)} className="flex flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 border border-slate-100 hover:border-amber-200 hover:bg-amber-50/50 transition-all p-3 active:scale-95 group">
                  <b.icon size={20} className="text-slate-400 group-hover:text-amber-600 transition-colors" />
                  <span className="text-xs font-semibold text-slate-600 group-hover:text-amber-700 transition-colors">{b.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── JEFE (C-LEVEL): Top Rendimiento del Equipo ── */}
      {esJefe && !loading && dm?.comisionesSemana?.vendedores && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <Users size={15} className="text-sky-600" /> Rendimiento del Equipo (Semana)
            </h2>
          </div>
          {dm.comisionesSemana.vendedores.length === 0 ? (
            <p className="text-sm text-slate-400">No hay ventas registradas esta semana.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left p-3 text-slate-500 font-semibold">Vendedor</th>
                    <th className="text-center p-3 text-slate-500 font-semibold">Ventas</th>
                    <th className="text-right p-3 text-slate-500 font-semibold">Comisiones (Total)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dm.comisionesSemana.vendedores.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: v.color }} />
                          <span className="font-bold text-slate-700">{v.nombre}</span>
                        </div>
                      </td>
                      <td className="p-3 text-center text-slate-500 font-medium">{v.count}</td>
                      <td className="p-3 text-right font-black text-slate-800">{fmtUsd(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── LOGÍSTICA: Próximas entregas ── */}
      {esLogistica && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <Truck size={14} />Próximas entregas
            </h2>
            <button onClick={() => navigate('/despachos')}
              className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors">
              Ver todas <ArrowRight size={12} />
            </button>
          </div>

          {(dm?.proximasEntregas?.length ?? 0) === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="Sin entregas pendientes"
              description="No hay despachos listos para entregar en este momento."
            />
          ) : (
            <div className="space-y-2">
              {dm.proximasEntregas.map(d => (
                <button
                  key={d.id}
                  onClick={() => navigate('/despachos')}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all text-left active:scale-[0.99]"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)' }}>
                    <Package size={18} className="text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800 font-mono">
                        DES-{String(d.numero).padStart(5, '0')}
                      </span>
                      {d.items_count?.[0] && (
                        <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Package size={10} />
                          {d.items_count[0].count}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">{fmtRelativo(d.creado_en)}</span>
                    </div>
                    {d.cliente && (
                      <p className="text-xs truncate mt-0.5" style={{ color: d.cliente.vendedor?.color || '#64748b' }}>
                        {d.cliente.nombre}
                        {(d.cliente.ciudad || d.cliente.estado) && (
                          <span className="text-slate-400"> · {[d.cliente.ciudad, d.cliente.estado].filter(Boolean).join(', ')}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-bold text-slate-700">{fmtUsd(d.total_usd)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ADMIN/JEFE: Despachos por aprobar (posición prominente) ── */}
      {(esAdministracion || esJefe) && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <Clock size={14} className="text-amber-500" />Despachos por aprobar
            </h2>
            <button onClick={() => navigate('/despachos?estado=pendiente')}
              className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors">
              Ver todos <ArrowRight size={12} />
            </button>
          </div>

          {(dm?.pendientesList?.length ?? 0) === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Sin despachos pendientes"
              description="Todo está al día. No hay despachos esperando aprobación."
            />
          ) : (
            <div className="space-y-2">
              {dm.pendientesList.map(d => (
                <button
                  key={d.id}
                  onClick={() => navigate('/despachos')}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all text-left active:scale-[0.99]"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                    <ClipboardList size={18} className="text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800 font-mono">
                        DES-{String(d.numero).padStart(5, '0')}
                      </span>
                      {d.items_count?.[0] && (
                        <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <PackageCheck size={10} />
                          {d.items_count[0].count}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">{fmtRelativo(d.creado_en)}</span>
                    </div>
                    {d.cliente && (
                      <p className="text-xs truncate mt-0.5" style={{ color: d.cliente.vendedor?.color || '#64748b' }}>
                        {d.cliente.nombre}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-bold text-slate-700">{fmtUsd(d.total_usd)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ADMIN/JEFE: Accesos rápidos ── */}
      {(esAdministracion || esJefe) && !loading && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
            <Zap size={12} />Accesos rápidos
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Despachos',  icon: ClipboardList, path: '/despachos',  colors: ['#92400e', '#B8860B'] },
              { label: 'Inventario', icon: Package,       path: '/inventario', colors: ['#065f46', '#10b981'] },
              { label: 'Comisiones', icon: DollarSign,    path: '/comisiones', colors: ['#1B365D', '#3b82f6'] },
              { label: 'Reportes',   icon: BarChart2,     path: '/reportes',   colors: ['#7c3aed', '#a78bfa'] },
            ].map(({ label, icon: Icon, path, colors }) => (
              <button key={path} onClick={() => navigate(path)}
                className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all group/btn hover:shadow-md"
                style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.06), rgba(184,134,11,0.06))', border: '1px solid rgba(27,54,93,0.12)' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}>
                    <Icon size={13} className="text-white" />
                  </div>
                  <span className="text-slate-700">{label}</span>
                </div>
                <ArrowRight size={14} className="text-slate-400 group-hover/btn:translate-x-0.5 transition-transform" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ADMIN/JEFE: Comisiones de la semana ── */}
      {(esAdministracion || esJefe) && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-500" />Comisiones semana
              {dm?.comisionesSemana && (
                <span className="text-[10px] font-normal text-slate-400 normal-case">
                  {dm.comisionesSemana.lunes} – {dm.comisionesSemana.sabado}
                </span>
              )}
            </h2>
            <button onClick={() => navigate('/comisiones')}
              className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors">
              Ver todas <ArrowRight size={12} />
            </button>
          </div>

          {(!dm?.comisionesSemana?.vendedores?.length) ? (
            <EmptyState
              icon={DollarSign}
              title="Sin comisiones esta semana"
              description="No se han registrado comisiones del lunes al sábado."
            />
          ) : (
            <>
              {/* Totalizador */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 rounded-xl p-2.5 text-center">
                  <p className="text-[10px] text-slate-400 font-medium">Total semana</p>
                  <p className="text-sm font-black text-slate-800">{fmtUsd(dm.comisionesSemana.total)}</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-2.5 text-center">
                  <p className="text-[10px] text-amber-600 font-medium">Pendiente</p>
                  <p className="text-sm font-black text-amber-700">{fmtUsd(dm.comisionesSemana.vendedores.reduce((s,v) => s+v.pendiente,0))}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-2.5 text-center">
                  <p className="text-[10px] text-emerald-600 font-medium">Pagado</p>
                  <p className="text-sm font-black text-emerald-700">{fmtUsd(dm.comisionesSemana.vendedores.reduce((s,v) => s+v.pagado,0))}</p>
                </div>
              </div>

              {/* Tabla por vendedor */}
              <div className="overflow-hidden rounded-xl border border-slate-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-3 py-2 text-slate-500 font-semibold">Vendedor</th>
                      <th className="text-center px-2 py-2 text-slate-500 font-semibold">Coms.</th>
                      <th className="text-right px-3 py-2 text-amber-600 font-semibold">Pendiente</th>
                      <th className="text-right px-3 py-2 text-emerald-600 font-semibold">Pagado</th>
                      <th className="text-right px-3 py-2 text-slate-700 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dm.comisionesSemana.vendedores.map((v, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: v.color }} />
                            <span className="font-medium text-slate-700 truncate max-w-[100px]">{v.nombre}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center text-slate-500">{v.count}</td>
                        <td className="px-3 py-2 text-right text-amber-600 font-medium">{fmtUsd(v.pendiente)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600 font-medium">{fmtUsd(v.pagado)}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-800">{fmtUsd(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}



      {/* ── VENDEDOR / SUPERVISOR / JEFE: Desglose por estado ── */}
      {(esVendedor || esSupervisor || esDesarrollador || esJefe) && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
            Cotizaciones por estado — histórico
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-3 w-3 rounded-full" />
                    <Skeleton className="h-3 flex-1 rounded" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-2.5 w-full rounded-full ml-6" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {['enviada','borrador','aceptada','rechazada','vencida','anulada']
                .filter(e => m?.porEstado?.[e])
                .map(estado => {
                  const { count, total } = m.porEstado[estado]
                  const pct = m.total > 0 ? Math.round((count / m.total) * 100) : 0
                  const col = ESTADO_COLOR[estado]
                  const gradients = {
                    aceptada:  'linear-gradient(90deg, #10b981, #059669)',
                    enviada:   'linear-gradient(90deg, #3b82f6, #2563eb)',
                    borrador:  'linear-gradient(90deg, #94a3b8, #64748b)',
                    rechazada: 'linear-gradient(90deg, #ef4444, #dc2626)',
                    vencida:   'linear-gradient(90deg, #f97316, #ea580c)',
                    anulada:   'linear-gradient(90deg, #cbd5e1, #94a3b8)',
                  }
                  return (
                    <div key={estado}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.dot}`} />
                          <span className="text-sm font-medium text-slate-700">{ESTADO_LABEL[estado]}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.bg} ${col.text}`}>{count}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
                          <span className="truncate max-w-[100px] sm:max-w-none">{fmtUsd(total)}{tasaEfectiva > 0 && <span className="ml-1 text-slate-300 hidden sm:inline">({fmtBs(usdToBs(total, tasaEfectiva))})</span>}</span>
                          <span className="font-semibold text-slate-500 w-8 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: gradients[estado] ?? gradients.borrador }} />
                      </div>
                    </div>
                  )
                })}
              {m?.total === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No hay cotizaciones aún.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── VENDEDOR / SUPERVISOR / JEFE: Actividad del mes + accesos rápidos ── */}
      {(esVendedor || esSupervisor || esDesarrollador || esJefe) && !isLoading && m && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Este mes */}
          <div className="relative overflow-hidden rounded-2xl p-5"
            style={{ background: 'linear-gradient(135deg, #1B365D 0%, #0d1f3c 100%)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>Este mes</p>
            <p className="text-2xl sm:text-3xl md:text-4xl font-black text-white leading-none">{m.delMesCount}</p>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>cotizaciones generadas</p>
            {variacionMes !== null && (
              <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: variacionMes >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                  color: variacionMes >= 0 ? '#34d399' : '#f87171',
                }}>
                {variacionMes >= 0 ? '↑' : '↓'} {Math.abs(variacionMes)}% vs mes anterior
              </div>
            )}
          </div>

          {/* Accesos rápidos (supervisor/jefe) */}
          {(esSupervisor || esDesarrollador || esJefe) && !esJefe ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Users size={12} />Accesos rápidos
              </p>
              {[
                { label: 'Gestionar usuarios', icon: UserCog, path: '/usuarios', colors: ['#1B365D', '#B8860B'] },
                { label: 'Clientes',           icon: UserRound, path: '/clientes', colors: ['#0369a1', '#0ea5e9'] },
                { label: 'Inventario',         icon: Package,  path: '/inventario', colors: ['#065f46', '#10b981'] },
                { label: 'Reportes',           icon: BarChart2, path: '/reportes', colors: ['#7c3aed', '#a78bfa'] },
              ].map(({ label, icon: Icon, path, colors }) => (
                <button key={path} onClick={() => navigate(path)}
                  className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all group/btn hover:shadow-md"
                  style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.06), rgba(184,134,11,0.06))', border: '1px solid rgba(27,54,93,0.12)' }}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}>
                      <Icon size={13} className="text-white" />
                    </div>
                    <span className="text-slate-700">{label}</span>
                  </div>
                  <ArrowRight size={14} className="text-slate-400 group-hover/btn:translate-x-0.5 transition-transform" />
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex items-center justify-center">
              <p className="text-sm text-slate-400 text-center">Contacta a tu supervisor para ver más detalles del equipo.</p>
            </div>
          )}
        </div>
      )}

      {/* ── VENDEDOR / SUPERVISOR / JEFE: Resumen de comisiones ── */}
      {(esVendedor || esSupervisor || esDesarrollador || esJefe) && !isLoading && comResumen && comResumen.total > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
              <DollarSign size={14} />Comisiones
            </h2>
            <button onClick={() => navigate('/comisiones')}
              className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors">
              Ver todas <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="bg-slate-50 rounded-xl p-2.5 sm:p-3">
              <p className="text-[10px] sm:text-xs text-slate-400 font-medium">Acumulado</p>
              <p className="text-base sm:text-lg font-black text-slate-800">{fmtUsd(comResumen.total)}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-2.5 sm:p-3">
              <p className="text-[10px] sm:text-xs text-amber-600 font-medium">Pendiente</p>
              <p className="text-base sm:text-lg font-black text-amber-700">{fmtUsd(comResumen.pendiente)}</p>
              <p className="text-[10px] sm:text-xs text-amber-500">{comResumen.countPendiente} por pagar</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-2.5 sm:p-3">
              <p className="text-[10px] sm:text-xs text-emerald-600 font-medium">Pagado</p>
              <p className="text-base sm:text-lg font-black text-emerald-700">{fmtUsd(comResumen.pagado)}</p>
              <p className="text-[10px] sm:text-xs text-emerald-500">{comResumen.countPagado} pagadas</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
