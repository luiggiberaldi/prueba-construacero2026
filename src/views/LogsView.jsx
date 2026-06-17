// src/views/LogsView.jsx
// Panel de logs del sistema + análisis AI + Auditoría + Tests/Health (desarrollador)
import { useState, useEffect } from 'react'
import {
  AlertCircle, AlertTriangle, Info, Download, Trash2, Bot, RefreshCw,
  Filter, ChevronLeft, ChevronRight, Shield, Zap, Bug, Clock,
  Monitor, Server, Database, CheckCircle2, XCircle, Activity, FlaskConical,
  Users, FileText, ShoppingCart, Settings, LogIn, TrendingUp, BarChart3,
  Search, Calendar, MessageSquare,
} from 'lucide-react'
import { useLogs, useLogStats, useLogAnalysis, useLogPurge } from '../hooks/useLogs'
import { useBuzonAdmin, useMarcarBuzon, useEliminarBuzon } from '../hooks/useBuzon'
import { adminAPI, devAPI } from '../services/supabase/adminClient'
import useAuthStore from '../store/useAuthStore'
import CustomSelect from '../components/ui/CustomSelect'
import PageHeader from '../components/ui/PageHeader'
import ConfirmModal from '../components/ui/ConfirmModal'
import { showToast } from '../components/ui/Toast'

// ── Config ──────────────────────────────────────────────────────────────
const TABS_BASE = [
  { id: 'logs', label: 'Logs', icon: AlertCircle },
  { id: 'ai',   label: 'Análisis AI', icon: Bot },
]

const TABS_DEV = [
  { id: 'audit', label: 'Auditoría', icon: Shield },
  { id: 'tests',  label: 'Tests', icon: FlaskConical },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'buzon',  label: 'Buzón', icon: MessageSquare },
]

const NIVELES = [
  { value: '', label: 'Todos' },
  { value: 'error', label: 'Error', color: '#ef4444' },
  { value: 'warn', label: 'Warning', color: '#f59e0b' },
  { value: 'info', label: 'Info', color: '#3b82f6' },
]

const ORIGENES = [
  { value: '', label: 'Todos' },
  { value: 'frontend', label: 'Frontend', icon: Monitor },
  { value: 'worker', label: 'Worker', icon: Server },
  { value: 'supabase', label: 'Supabase', icon: Database },
]

const NIVEL_CONFIG = {
  error: { icon: AlertCircle, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
  warn:  { icon: AlertTriangle, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  info:  { icon: Info, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
}

const AI_AGENTS = [
  {
    tipo: 'errores',
    label: 'Análisis de Errores',
    desc: 'Agrupa errores por causa raíz, identifica patrones y sugiere soluciones',
    icon: Bug,
    gradient: 'from-red-500 to-rose-600',
  },
  {
    tipo: 'mejoras',
    label: 'Recomendaciones de Mejora',
    desc: 'Identifica cuellos de botella y sugiere optimizaciones de UX/rendimiento',
    icon: Zap,
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    tipo: 'seguridad',
    label: 'Auditoría de Seguridad',
    desc: 'Detecta accesos sospechosos y evalúa vulnerabilidades',
    icon: Shield,
    gradient: 'from-blue-500 to-indigo-600',
  },
]

// ── Audit Config ─────────────────────────────────────────────────────
const CATEGORIA_ICONS = {
  AUTH: LogIn, COTIZACION: FileText, USUARIO: Users, FINANZAS: TrendingUp,
  INVENTARIO: ShoppingCart, CONFIG: Settings, DESPACHO: FileText, CLIENTE: Users,
}
const CATEGORIA_COLORS = {
  AUTH: '#8b5cf6', COTIZACION: '#3b82f6', USUARIO: '#06b6d4', FINANZAS: '#10b981',
  INVENTARIO: '#f59e0b', CONFIG: '#64748b', DESPACHO: '#ec4899', CLIENTE: '#6366f1',
}

// ── Componentes ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
          <Icon size={18} style={{ color }} />
        </div>
        <div>
          <p className="text-2xl font-black text-slate-800">{value ?? '—'}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  )
}

function LogRow({ log }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = NIVEL_CONFIG[log.nivel] || NIVEL_CONFIG.info
  const Icon = cfg.icon
  const ts = new Date(log.ts)
  const fecha = ts.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })
  const hora = ts.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className={`${cfg.bg} border ${cfg.border} rounded-lg p-3 cursor-pointer transition-all hover:shadow-sm`} onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-2">
        <Icon size={16} className={`${cfg.text} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>{log.nivel.toUpperCase()}</span>
            {log.categoria && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{log.categoria}</span>}
            <span className="text-xs text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{log.origen}</span>
          </div>
          <p className={`text-sm font-medium ${cfg.text} mt-1 break-words`}>{log.mensaje}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
            <span>{fecha} {hora}</span>
            {log.usuario_nombre && <span>• {log.usuario_nombre}</span>}
            {log.endpoint && <span className="truncate max-w-[200px]">• {log.endpoint}</span>}
          </div>
        </div>
      </div>
      {expanded && log.stack && (
        <pre className="mt-2 text-xs text-slate-600 bg-white/60 border border-slate-200 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">{log.stack}</pre>
      )}
      {expanded && log.meta && Object.keys(log.meta).length > 0 && (
        <pre className="mt-1 text-xs text-slate-500 bg-white/40 border border-slate-100 p-2 rounded overflow-auto max-h-32">{JSON.stringify(log.meta, null, 2)}</pre>
      )}
    </div>
  )
}

function AIAnalysisCard({ agent, onRun, result, isLoading }) {
  const Icon = agent.icon
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className={`bg-gradient-to-r ${agent.gradient} p-4`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <Icon size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">{agent.label}</h3>
            <p className="text-white/80 text-xs">{agent.desc}</p>
          </div>
        </div>
      </div>
      <div className="p-4">
        {!result && !isLoading && (
          <button
            onClick={() => onRun(agent.tipo)}
            className="w-full py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
          >
            <Bot size={14} className="inline mr-1.5 -mt-0.5" />
            Ejecutar Análisis
          </button>
        )}
        {isLoading && (
          <div className="flex items-center gap-2 justify-center py-4 text-slate-500">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Analizando con Groq AI...</span>
          </div>
        )}
        {result && !isLoading && (
          <div className="prose prose-sm max-w-none text-slate-700">
            <div className="text-xs text-slate-400 mb-2 flex items-center gap-2">
              <Clock size={12} />
              {result.logs_count} logs analizados • {result.modelo}
            </div>
            <div
              className="text-sm leading-relaxed whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: formatMarkdown(result.resultado) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function TestSuiteRow({ name, passed, failed, total, tests }) {
  const [expanded, setExpanded] = useState(false)
  const allPassed = failed === 0
  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${allPassed ? 'border-green-100' : 'border-red-200'}`}>
      <div className="p-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(!expanded)}>
        {allPassed ? <CheckCircle2 size={16} className="text-green-500 shrink-0" /> : <XCircle size={16} className="text-red-500 shrink-0" />}
        <span className="text-sm font-medium text-slate-700 flex-1 truncate">{name}</span>
        <span className="text-xs text-slate-400">{passed}/{total}</span>
      </div>
      {expanded && (
        <div className="border-t border-slate-100 px-3 py-2 space-y-1 max-h-60 overflow-auto">
          {tests.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {t.status === 'passed'
                ? <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                : <XCircle size={12} className="text-red-400 shrink-0" />}
              <span className={`${t.status === 'passed' ? 'text-slate-600' : 'text-red-700 font-medium'}`}>{t.title}</span>
              {t.duration != null && <span className="text-slate-400 ml-auto shrink-0">{t.duration.toFixed(1)}ms</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Conversión básica de markdown a HTML
function AuditRow({ registro }) {
  const [expanded, setExpanded] = useState(false)
  const cat = registro.categoria || 'OTRO'
  const Icon = CATEGORIA_ICONS[cat] || FileText
  const color = CATEGORIA_COLORS[cat] || '#64748b'
  const ts = new Date(registro.ts)
  const fecha = ts.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })
  const hora = ts.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="bg-white border border-slate-100 rounded-lg p-3 cursor-pointer transition-all hover:shadow-sm hover:border-slate-200" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${color}15` }}>
          <Icon size={14} style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color }}>{cat}</span>
            <span className="text-xs font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{registro.accion?.replace(/_/g, ' ')}</span>
          </div>
          {registro.descripcion && <p className="text-sm text-slate-700 mt-1 break-words">{registro.descripcion}</p>}
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
            <span>{fecha} {hora}</span>
            <span>• {registro.usuario_nombre || '—'}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500">{registro.usuario_rol}</span>
          </div>
        </div>
      </div>
      {expanded && registro.meta && Object.keys(registro.meta).length > 0 && (
        <pre className="mt-2 text-xs text-slate-500 bg-slate-50 border border-slate-100 p-2 rounded overflow-auto max-h-32">{JSON.stringify(registro.meta, null, 2)}</pre>
      )}
    </div>
  )
}

function AuditStatsBar({ stats }) {
  if (!stats) return null
  const maxCount = Math.max(...(stats.topCategorias?.map(c => c.count) || [1]))
  return (
    <div className="space-y-4 mb-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total registros" value={stats.total} icon={Database} color="#64748b" />
        <StatCard label="Acciones hoy" value={stats.accionesHoy} icon={Activity} color="#3b82f6" />
        <StatCard label="Esta semana" value={stats.accionesSemana} icon={BarChart3} color="#10b981" />
        <StatCard label="Logins fallidos (7d)" value={stats.loginsFallidos} icon={Shield} color={stats.loginsFallidos > 5 ? '#ef4444' : '#f59e0b'} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Top categorías */}
        {stats.topCategorias?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-500 mb-3">Actividad por categoría (30d)</h3>
            <div className="space-y-2">
              {stats.topCategorias.map(({ categoria: cat, count }) => {
                const color = CATEGORIA_COLORS[cat] || '#64748b'
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600 w-24 truncate">{cat}</span>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(5, (count / maxCount) * 100)}%`, background: color }} />
                    </div>
                    <span className="text-xs font-bold text-slate-700 w-8 text-right">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top usuarios */}
        {stats.topUsuarios?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-500 mb-3">Usuarios más activos (30d)</h3>
            <div className="space-y-2">
              {stats.topUsuarios.map(u => (
                <div key={u.nombre} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">{u.nombre[0]}</div>
                  <span className="text-xs font-medium text-slate-700 flex-1 truncate">{u.nombre}</span>
                  <span className="text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{u.rol}</span>
                  <span className="text-xs font-bold text-slate-700">{u.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top acciones */}
      {stats.topAcciones?.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <h3 className="text-xs font-bold text-slate-500 mb-3">Acciones más frecuentes (30d)</h3>
          <div className="flex flex-wrap gap-2">
            {stats.topAcciones.map(({ accion, count }) => (
              <span key={accion} className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-600">
                {accion.replace(/_/g, ' ')} <strong className="text-slate-800">{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4 class="font-bold text-slate-800 mt-3 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-bold text-slate-800 text-base mt-4 mb-1">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="font-black text-slate-900 text-lg mt-4 mb-2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-700 px-1 rounded text-xs">$1</code>')
    .replace(/\n/g, '<br/>')
}

const PURGE_OPTIONS = [
  { dias: 90, label: 'Más de 90 días' },
  { dias: 30, label: 'Más de 30 días' },
  { dias: 7,  label: 'Más de 7 días' },
  { dias: 1,  label: 'Más de 1 día' },
  { dias: 0,  label: 'Todos los logs', danger: true },
]

function PurgeModal({ onConfirm, onClose }) {
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    if (selected === null) return
    setLoading(true)
    try {
      await onConfirm(selected)
    } catch (e) {
      showToast(e.message || 'Error purgando', 'error')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="relative h-20 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #fca5a5, #ef4444)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.25)', border: '1.5px solid rgba(255,255,255,0.5)' }}>
            <Trash2 size={22} color="white" />
          </div>
        </div>
        <div className="px-5 pt-4 pb-5">
          <h3 className="text-lg font-black text-slate-800 text-center mb-1">Purgar logs</h3>
          <p className="text-xs text-slate-500 text-center mb-4">Selecciona qué logs eliminar</p>
          <div className="space-y-2 mb-4">
            {PURGE_OPTIONS.map(opt => (
              <button
                key={opt.dias}
                onClick={() => setSelected(opt.dias)}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  selected === opt.dias
                    ? opt.danger
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt.label}
                {opt.danger && selected === opt.dias && (
                  <span className="block text-[10px] text-red-500 mt-0.5">Se borrarán TODOS los registros</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={loading}
              className="flex-1 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl border border-slate-100">
              Cancelar
            </button>
            <button onClick={handleConfirm} disabled={selected === null || loading}
              className="flex-1 py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
              {loading && <RefreshCw size={12} className="animate-spin" />}
              Purgar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Vista Principal ──────────────────────────────────────────────────────

export default function LogsView() {
  const { perfil } = useAuthStore()
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const TABS = esDesarrollador ? [...TABS_BASE, ...TABS_DEV] : TABS_BASE

  const [tab, setTab] = useState('logs')
  const [page, setPage] = useState(1)
  const [nivel, setNivel] = useState('')
  const [origen, setOrigen] = useState('')
  const [categoria, setCategoria] = useState('')
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [aiResults, setAiResults] = useState({})
  const [aiLoading, setAiLoading] = useState({})

  // Dev state
  const [testResults, setTestResults] = useState(null)
  const [testsLoading, setTestsLoading] = useState(false)
  const [healthData, setHealthData] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)

  // Audit state
  const [auditData, setAuditData] = useState(null)
  const [auditStats, setAuditStats] = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditStatsLoading, setAuditStatsLoading] = useState(false)
  const [auditPage, setAuditPage] = useState(1)
  const [auditCategoria, setAuditCategoria] = useState('')
  const [auditAnalysis, setAuditAnalysis] = useState(null)
  const [auditAnalyzing, setAuditAnalyzing] = useState(false)

  const { data: logsData, isLoading: logsLoading, refetch, isFetching } = useLogs({ page, limit: 50, nivel: nivel || undefined, origen: origen || undefined, categoria: categoria || undefined })
  const { data: stats, refetch: refetchStats } = useLogStats()
  const purge = useLogPurge()

  // Buzon State & Data
  const [buzonFiltroEstado, setBuzonFiltroEstado] = useState('')
  const [buzonFiltroTipo, setBuzonFiltroTipo] = useState('')
  const [editNotaId, setEditNotaId] = useState(null)
  const [notaText, setNotaText] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const { data: buzonMensajes = [], isLoading: buzonLoading } = useBuzonAdmin()
  const marcarBuzon = useMarcarBuzon()
  const eliminarBuzon = useEliminarBuzon()

  const unreadCount = buzonMensajes.filter(m => m.estado === 'pendiente').length

  const logs = logsData?.logs || []
  const totalPages = logsData?.pages || 1

  async function handleRefresh() {
    await Promise.all([refetch(), refetchStats()])
    showToast('Logs actualizados', 'success')
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      await adminAPI.downloadLogs()
      showToast('Descarga iniciada', 'success')
    } catch (e) { showToast(e.message || 'Error descargando', 'error') }
    setDownloading(false)
  }

  async function handleRunAI(tipo) {
    setAiLoading(prev => ({ ...prev, [tipo]: true }))
    try {
      const result = await adminAPI.analyzeLogs(tipo)
      setAiResults(prev => ({ ...prev, [tipo]: result }))
    } catch (e) {
      setAiResults(prev => ({ ...prev, [tipo]: { resultado: `Error: ${e.message}`, logs_count: 0, modelo: '—' } }))
    }
    setAiLoading(prev => ({ ...prev, [tipo]: false }))
  }

  async function loadTests() {
    setTestsLoading(true)
    try {
      const data = await devAPI.getTestResults()
      setTestResults(data)
    } catch { setTestResults(null) }
    setTestsLoading(false)
  }

  async function runHealthCheck() {
    setHealthLoading(true)
    try {
      const data = await devAPI.healthCheck()
      setHealthData(data)
    } catch (e) {
      setHealthData({ error: e.message })
    }
    setHealthLoading(false)
  }

  async function loadAudit(pg = auditPage) {
    setAuditLoading(true)
    try {
      const data = await adminAPI.getAudit({ page: pg, limit: 30, categoria: auditCategoria || undefined })
      setAuditData(data)
    } catch (e) { showToast(e.message, 'error') }
    setAuditLoading(false)
  }

  async function loadAuditStats() {
    setAuditStatsLoading(true)
    try {
      const data = await adminAPI.getAuditStats()
      setAuditStats(data)
    } catch (e) { showToast(e.message, 'error') }
    setAuditStatsLoading(false)
  }

  async function runAuditAnalysis() {
    setAuditAnalyzing(true)
    try {
      const data = await adminAPI.analyzeAudit()
      setAuditAnalysis(data)
    } catch (e) { setAuditAnalysis({ resultado: `Error: ${e.message}`, registros_count: 0 }) }
    setAuditAnalyzing(false)
  }

  // Auto-load audit data when tab changes
  useEffect(() => {
    if (tab === 'audit' && !auditData && !auditLoading) loadAudit(1)
    if (tab === 'audit' && !auditStats && !auditStatsLoading) loadAuditStats()
  }, [tab])

  useEffect(() => {
    if (tab === 'audit') loadAudit(auditPage)
  }, [auditPage, auditCategoria])

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 pb-24 lg:pb-6 space-y-4">
      <PageHeader
        icon={AlertCircle}
        title="System Logs"
        subtitle="Monitoreo de errores y análisis AI del sistema"
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Total logs" value={stats.total} icon={Database} color="#64748b" />
          <StatCard label="Errores hoy" value={stats.erroresHoy} icon={AlertCircle} color="#ef4444" />
          <StatCard label="Warnings hoy" value={stats.warningsHoy} icon={AlertTriangle} color="#f59e0b" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 rounded-xl p-1">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all relative ${active ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Icon size={14} />
              {t.label}
              {t.id === 'buzon' && unreadCount > 0 && (
                <span className="absolute -top-1 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white shadow-sm border border-white/20 animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab: Logs */}
      {tab === 'logs' && (
        <div>
          {/* Filters + Actions */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Filter size={14} className="text-slate-400" />
            <div className="flex gap-1">
              {NIVELES.map(n => (
                <button key={n.value} type="button"
                  onClick={() => { setNivel(n.value); setPage(1) }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    nivel === n.value
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}>
                  {n.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {ORIGENES.map(o => (
                <button key={o.value} type="button"
                  onClick={() => { setOrigen(o.value); setPage(1) }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1 ${
                    origen === o.value
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}>
                  {o.icon && <o.icon size={11} />}{o.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={categoria}
              onChange={e => { setCategoria(e.target.value.toUpperCase()); setPage(1) }}
              placeholder="Categoría..."
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-28 bg-white"
            />

            <div className="ml-auto flex gap-2">
              <button onClick={handleRefresh} disabled={isFetching} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1.5 border border-slate-200 rounded-lg bg-white disabled:opacity-50">
                <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Actualizar
              </button>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="text-xs text-white flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
              >
                <Download size={12} /> {downloading ? 'Descargando...' : 'Descargar'}
              </button>
              <button
                onClick={() => setConfirmPurge(true)}
                className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 px-2 py-1.5 border border-red-200 rounded-lg bg-red-50"
              >
                <Trash2 size={12} /> Purgar
              </button>
            </div>
          </div>

          {/* Log list */}
          {logsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle size={40} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No hay logs registrados</p>
              <p className="text-xs mt-1">Los errores del sistema aparecerán aquí automáticamente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => <LogRow key={log.id} log={log} />)}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => { setPage(p => Math.max(1, p - 1)); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-slate-600 font-medium">
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => { setPage(p => Math.min(totalPages, p + 1)); const main = document.querySelector('main'); if (main) main.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: AI Analysis */}
      {tab === 'ai' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 mb-2">
            Usa los agentes AI para analizar los logs del sistema. Cada agente se especializa en un área distinta y usa Groq (Llama 3.3 70B) con round-robin de API keys para proteger la cuota.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {AI_AGENTS.map(agent => (
              <AIAnalysisCard
                key={agent.tipo}
                agent={agent}
                onRun={handleRunAI}
                result={aiResults[agent.tipo]}
                isLoading={aiLoading[agent.tipo]}
              />
            ))}
          </div>

          {/* Top categorías */}
          {stats?.topCategorias?.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-3">Top errores por categoría (7 días)</h3>
              <div className="space-y-2">
                {stats.topCategorias.map(({ categoria: cat, count }) => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600 w-32 truncate">{cat}</span>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (count / (stats.topCategorias[0]?.count || 1)) * 100)}%`,
                          background: 'linear-gradient(90deg, #ef4444, #f97316)',
                        }}
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-700 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Auditoría (solo desarrollador) */}
      {tab === 'audit' && esDesarrollador && (
        <div className="space-y-4">
          {/* Stats dashboard */}
          {auditStatsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <AuditStatsBar stats={auditStats} />
          )}

          {/* AI Analysis button */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                  <Bot size={20} className="text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-bold text-sm">Análisis AI de Auditoría</h3>
                  <p className="text-white/80 text-xs">Resumen ejecutivo, alertas de seguridad y recomendaciones de mejora</p>
                </div>
              </div>
            </div>
            <div className="p-4">
              {!auditAnalysis && !auditAnalyzing && (
                <button onClick={runAuditAnalysis}
                  className="w-full py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                  <Bot size={14} className="inline mr-1.5 -mt-0.5" />
                  Generar Informe de Auditoría
                </button>
              )}
              {auditAnalyzing && (
                <div className="flex items-center gap-2 justify-center py-4 text-slate-500">
                  <RefreshCw size={16} className="animate-spin" />
                  <span className="text-sm">Analizando con Groq AI...</span>
                </div>
              )}
              {auditAnalysis && !auditAnalyzing && (
                <div className="prose prose-sm max-w-none text-slate-700">
                  <div className="text-xs text-slate-400 mb-2 flex items-center gap-2">
                    <Clock size={12} />
                    {auditAnalysis.registros_count} registros analizados{auditAnalysis.modelo && ` • ${auditAnalysis.modelo}`}
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: formatMarkdown(auditAnalysis.resultado) }} />
                  <button onClick={() => { setAuditAnalysis(null) }}
                    className="mt-3 text-xs text-slate-400 hover:text-slate-600 underline">
                    Regenerar análisis
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Filters + Audit list */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Filter size={14} className="text-slate-400" />
              <CustomSelect
                value={auditCategoria}
                onChange={v => { setAuditCategoria(v); setAuditPage(1) }}
                placeholder="Todas las categorías"
                clearable
                options={Object.keys(CATEGORIA_ICONS).map(cat => ({
                  value: cat,
                  label: cat,
                }))}
              />
              <button onClick={() => { loadAudit(1); loadAuditStats() }}
                disabled={auditLoading}
                className="ml-auto text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1.5 border border-slate-200 rounded-lg bg-white disabled:opacity-50">
                <RefreshCw size={12} className={auditLoading ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>

            {auditLoading ? (
              <div className="space-y-2">
                {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-slate-50 rounded-lg animate-pulse" />)}
              </div>
            ) : !auditData?.registros?.length ? (
              <div className="text-center py-12 text-slate-400">
                <Shield size={40} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">No hay registros de auditoría</p>
                <p className="text-xs mt-1">Las acciones del sistema aparecerán aquí automáticamente</p>
              </div>
            ) : (
              <div className="space-y-2">
                {auditData.registros.map(r => <AuditRow key={r.id} registro={r} />)}
              </div>
            )}

            {/* Pagination */}
            {auditData && auditData.pages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4">
                <button onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage <= 1}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-slate-600 font-medium">
                  Página {auditPage} de {auditData.pages}
                </span>
                <button onClick={() => setAuditPage(p => Math.min(auditData.pages, p + 1))} disabled={auditPage >= auditData.pages}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Tests (solo desarrollador) */}
      {tab === 'tests' && esDesarrollador && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Resultados de tests automatizados generados en el último build.</p>
            <button
              onClick={loadTests}
              disabled={testsLoading}
              className="text-xs text-white flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
            >
              {testsLoading ? <RefreshCw size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              {testsLoading ? 'Cargando...' : 'Cargar Tests'}
            </button>
          </div>

          {testResults && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-slate-800">{testResults.numTotalTests}</p>
                  <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="bg-white rounded-xl border border-green-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-green-600">{testResults.numPassedTests}</p>
                  <p className="text-xs text-green-600">Pasaron</p>
                </div>
                <div className="bg-white rounded-xl border border-red-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-red-600">{testResults.numFailedTests}</p>
                  <p className="text-xs text-red-600">Fallaron</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-slate-800">{testResults.numTotalTestSuites}</p>
                  <p className="text-xs text-slate-500">Suites</p>
                </div>
              </div>

              {/* Success banner */}
              {testResults.success && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                  <CheckCircle2 size={18} className="text-green-600" />
                  <span className="text-sm font-bold text-green-700">Todos los tests pasaron</span>
                  <span className="text-xs text-green-600 ml-auto">
                    {new Date(testResults.startTime).toLocaleString('es-VE')}
                  </span>
                </div>
              )}

              {/* Test suites */}
              <div className="space-y-2">
                {testResults.testResults?.map((suite, i) => {
                  const name = suite.name?.split('/').pop() || `Suite ${i + 1}`
                  const passed = suite.assertionResults?.filter(t => t.status === 'passed').length || 0
                  const failed = suite.assertionResults?.filter(t => t.status === 'failed').length || 0
                  const total = suite.assertionResults?.length || 0
                  return (
                    <TestSuiteRow key={i} name={name} passed={passed} failed={failed} total={total} tests={suite.assertionResults || []} />
                  )
                })}
              </div>
            </>
          )}

          {!testResults && !testsLoading && (
            <div className="text-center py-12 text-slate-400">
              <FlaskConical size={40} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">Presiona "Cargar Tests" para ver los resultados</p>
              <p className="text-xs mt-1">Los tests se ejecutan automáticamente en cada build</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Health Check (solo desarrollador) */}
      {tab === 'health' && esDesarrollador && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Verifica la conexión y estado de todos los servicios en tiempo real.</p>
            <button
              onClick={runHealthCheck}
              disabled={healthLoading}
              className="text-xs text-white flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
            >
              {healthLoading ? <RefreshCw size={12} className="animate-spin" /> : <Activity size={12} />}
              {healthLoading ? 'Verificando...' : 'Ejecutar Health Check'}
            </button>
          </div>

          {healthData && !healthData.error && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-slate-500">Tiempo total: {healthData.total_ms}ms</span>
              </div>
              <div className="space-y-3">
                {Object.entries(healthData.checks || {}).map(([key, check]) => (
                  <div key={key} className={`rounded-xl border p-4 shadow-sm ${check.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center gap-3">
                      {check.ok ? <CheckCircle2 size={20} className="text-green-600" /> : <XCircle size={20} className="text-red-600" />}
                      <div className="flex-1">
                        <h4 className="text-sm font-bold capitalize">{key.replace(/_/g, ' ')}</h4>
                        <div className="flex flex-wrap gap-3 mt-1">
                          {check.status && <span className="text-xs text-slate-500">Status: {check.status}</span>}
                          <span className="text-xs text-slate-500">{check.ms}ms</span>
                          {check.keys_count && <span className="text-xs text-slate-500">{check.keys_count} keys</span>}
                          {check.total_logs && <span className="text-xs text-slate-500">{check.total_logs} logs</span>}
                          {check.error && <span className="text-xs text-red-600">{check.error}</span>}
                        </div>
                        {check.counts && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {Object.entries(check.counts).map(([table, count]) => (
                              <span key={table} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5">
                                {table}: <strong>{count}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {healthData?.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <XCircle size={24} className="mx-auto mb-2 text-red-500" />
              <p className="text-sm text-red-700 font-medium">{healthData.error}</p>
            </div>
          )}

          {!healthData && !healthLoading && (
            <div className="text-center py-12 text-slate-400">
              <Activity size={40} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">Presiona "Ejecutar Health Check"</p>
              <p className="text-xs mt-1">Verifica Supabase, Groq API, tablas y sistema de logs</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Buzón (solo desarrollador) */}
      {tab === 'buzon' && esDesarrollador && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-left">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-800">📬 Buzón de Sugerencias & Quejas</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">Mensajes recibidos de los operadores para soporte y mejora continua</p>
              </div>
              
              {/* Filtros */}
              <div className="flex gap-2">
                <CustomSelect
                  value={buzonFiltroEstado}
                  onChange={setBuzonFiltroEstado}
                  placeholder="Todos los estados"
                  clearable
                  options={[
                    { value: 'pendiente', label: 'Pendiente 🟡' },
                    { value: 'leido', label: 'Leído 🔵' },
                    { value: 'resuelto', label: 'Resuelto ✅' },
                  ]}
                />
                <CustomSelect
                  value={buzonFiltroTipo}
                  onChange={setBuzonFiltroTipo}
                  placeholder="Todos los tipos"
                  clearable
                  options={[
                    { value: 'sugerencia', label: 'Sugerencia 💡' },
                    { value: 'queja', label: 'Queja ⚠️' },
                    { value: 'error_tecnico', label: 'Error Técnico 🐛' },
                  ]}
                />
              </div>
            </div>

            {buzonLoading ? (
              <div className="space-y-2 py-4">
                {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-50 rounded-xl animate-pulse" />)}
              </div>
            ) : buzonMensajes.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <MessageSquare size={40} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">Buzón vacío</p>
                <p className="text-xs mt-1">No se han recibido sugerencias o quejas todavía.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {buzonMensajes
                  .filter(m => !buzonFiltroEstado || m.estado === buzonFiltroEstado)
                  .filter(m => !buzonFiltroTipo || m.tipo === buzonFiltroTipo)
                  .map(m => {
                    const esEditando = editNotaId === m.id
                    const colorRol = {
                      vendedor: 'text-teal-600 bg-teal-50 border border-teal-100',
                      supervisor: 'text-sky-600 bg-sky-50 border border-sky-100',
                      administracion: 'text-amber-600 bg-amber-50 border border-amber-100',
                      logistica: 'text-purple-600 bg-purple-50 border border-purple-100',
                      jefe: 'text-rose-600 bg-rose-50 border border-rose-100',
                    }[m.usuario?.rol] || 'text-slate-600 bg-slate-50 border border-slate-100'

                    return (
                      <div
                        key={m.id}
                        className={`p-4 border rounded-2xl transition-all shadow-sm ${
                          m.estado === 'pendiente'
                            ? 'bg-amber-50/20 border-amber-200'
                            : 'bg-white border-slate-100'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          {/* Info Usuario */}
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white"
                              style={{ backgroundColor: m.usuario?.color || '#1B365D' }}
                            >
                              {m.usuario?.nombre?.[0] || 'U'}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-black text-slate-700">{m.usuario?.nombre || 'Usuario Desconocido'}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${colorRol}`}>
                                  {m.usuario?.rol === 'vendedor_sin_comision' ? 'vendedor' : m.usuario?.rol}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400">
                                {new Date(m.creado_en).toLocaleString('es-VE')}
                              </span>
                            </div>
                          </div>

                          {/* Tipo & Estado */}
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              {
                                sugerencia: 'bg-amber-100 text-amber-800 border border-amber-200',
                                queja: 'bg-rose-100 text-rose-800 border border-rose-200',
                                error_tecnico: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
                              }[m.tipo]
                            }`}>
                              {m.tipo === 'error_tecnico' ? 'Error Técnico' : m.tipo}
                            </span>

                            {/* Acciones de Estado */}
                            <div className="flex gap-1">
                              {m.estado !== 'leido' && m.estado !== 'resuelto' && (
                                <button
                                  onClick={() => marcarBuzon.mutate({ id: m.id, estado: 'leido' })}
                                  className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 text-[10px] font-black rounded-lg border border-blue-200 transition-colors"
                                >
                                  Leer 🔵
                                </button>
                              )}
                              {m.estado !== 'resuelto' && (
                                <button
                                  onClick={() => {
                                    setEditNotaId(m.id)
                                    setNotaText(m.nota_interna || '')
                                  }}
                                  className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-[10px] font-black rounded-lg border border-emerald-200 transition-colors"
                                >
                                  Resolver ✅
                                </button>
                              )}
                              <button
                                onClick={() => setDeleteConfirmId(m.id)}
                                className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[10px] font-black rounded-lg border border-rose-200 transition-colors flex items-center gap-1"
                              >
                                <Trash2 size={11} /> Eliminar 🗑️
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Mensaje */}
                        <div className="mt-3 text-sm text-slate-700 leading-relaxed font-medium bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                          {m.mensaje}
                        </div>

                        {/* Nota Interna */}
                        {!esEditando && m.nota_interna && (
                          <div className="mt-3 p-3 bg-slate-50 border-l-4 border-slate-400 rounded-r-xl text-xs text-slate-600">
                            <span className="font-bold text-slate-700 block mb-0.5 uppercase tracking-wider text-[9px]">Nota Interna (Desarrollador):</span>
                            {m.nota_interna}
                            <button
                              onClick={() => {
                                setEditNotaId(m.id)
                                setNotaText(m.nota_interna || '')
                              }}
                              className="text-blue-500 hover:underline ml-1 font-bold"
                            >
                              (Editar)
                            </button>
                          </div>
                        )}

                        {esEditando && (
                          <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              Nota Interna o Respuesta al Operador:
                            </label>
                            <textarea
                              value={notaText}
                              onChange={e => setNotaText(e.target.value)}
                              placeholder="Escribe detalles del error, solución aplicada o respuesta..."
                              rows={2}
                              className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-800"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setEditNotaId(null)}
                                className="px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg border border-slate-200 font-medium"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => {
                                  marcarBuzon.mutate(
                                    { id: m.id, estado: 'resuelto', notaInterna: notaText },
                                    {
                                      onSuccess: () => setEditNotaId(null),
                                    }
                                  )
                                }}
                                className="px-3 py-1 text-xs text-white bg-slate-800 hover:bg-slate-700 rounded-lg font-black"
                              >
                                Guardar y Marcar Resuelto
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Purge modal con selección de rango */}
      {confirmPurge && (
        <PurgeModal
          onConfirm={async (dias) => {
            const result = await purge.mutateAsync(dias)
            const label = dias === 0 ? 'todos' : `mayores a ${dias} días`
            showToast(`Purga completada: ${result?.eliminados ?? 0} logs eliminados (${label})`, 'success')
            setConfirmPurge(false)
          }}
          onClose={() => setConfirmPurge(false)}
        />
      )}

      {/* Confirmación de eliminación de sugerencia */}
      <ConfirmModal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={async () => {
          if (deleteConfirmId) {
            await eliminarBuzon.mutateAsync(deleteConfirmId)
          }
        }}
        title="¿Eliminar sugerencia?"
        message="Esta acción eliminará permanentemente la sugerencia de la base de datos y no se puede deshacer."
        confirmText="Sí, eliminar"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  )
}
