// src/components/inventario/MovimientosHistorial.jsx
// Historial profesional de movimientos de inventario
import { useState, useEffect } from 'react'
import {
  ArrowDownToLine, ArrowUpFromLine, Clock, Package,
  Search, X, Calendar, ChevronDown, ChevronUp, User,
} from 'lucide-react'
import { useMovimientosInventario } from '../../hooks/useMovimientosInventario'
import { MOTIVOS_TIPO, formatCorrelativo, getMotivoChipClasses } from '../../utils/motivosTipo'
import Pagination from '../ui/Pagination'

const PAGE_SIZE = 20

export default function MovimientosHistorial() {
  const [page, setPage] = useState(0)
  const [filtroTipo, setFiltroTipo] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [expandedLotes, setExpandedLotes] = useState(new Set())

  // Debounce búsqueda
  useEffect(() => {
    const t = setTimeout(() => { setBusqueda(textoBusqueda); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [textoBusqueda])

  const { data, isLoading } = useMovimientosInventario({
    page, pageSize: PAGE_SIZE, tipo: filtroTipo,
    busqueda, fechaDesde, fechaHasta,
  })
  const movimientos = data?.movimientos ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  function formatFecha(ts) {
    return new Date(ts).toLocaleString('es-VE', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function formatFechaCorta(ts) {
    return new Date(ts).toLocaleString('es-VE', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  }

  function toggleLote(loteId) {
    setExpandedLotes(prev => {
      const next = new Set(prev)
      if (next.has(loteId)) next.delete(loteId)
      else next.add(loteId)
      return next
    })
  }

  function limpiarFiltros() {
    setTextoBusqueda('')
    setBusqueda('')
    setFiltroTipo('')
    setFechaDesde('')
    setFechaHasta('')
    setPage(0)
  }

  const hayFiltros = busqueda || filtroTipo || fechaDesde || fechaHasta

  // Agrupar movimientos por lote_id
  const lotes = []
  const loteMap = new Map()
  movimientos.forEach(m => {
    if (!loteMap.has(m.lote_id)) {
      const lote = {
        id: m.lote_id,
        tipo: m.tipo,
        motivo: m.motivo || '',
        motivo_tipo: m.motivo_tipo || 'otro',
        usuario: m.usuario_nombre || 'Sin usuario',
        usuario_color: m.usuario_color,
        fecha: m.creado_en,
        numero: m.numero,
        items: [],
        esMixto: false,
      }
      loteMap.set(m.lote_id, lote)
      lotes.push(lote)
    }
    const l = loteMap.get(m.lote_id)
    l.items.push(m)
    
    // Detectar si el lote tiene tipos mixtos
    if (m.tipo !== l.tipo) l.esMixto = true

    // Usar el menor numero como correlativo del lote
    if (m.numero && (!l.numero || m.numero < l.numero)) {
      l.numero = m.numero
    }
  })

  return (
    <div className="space-y-4">

      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Búsqueda */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={textoBusqueda}
            onChange={e => setTextoBusqueda(e.target.value)}
            placeholder="Buscar por producto, motivo o usuario..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 placeholder:text-slate-400"
          />
          {textoBusqueda && (
            <button type="button" onClick={() => setTextoBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Fila: tipo + fechas + contador */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtros de tipo */}
          {[
            { val: '', label: 'Todos', color: 'sky' },
            { val: 'ingreso', label: 'Ingresos', color: 'emerald' },
            { val: 'egreso', label: 'Egresos', color: 'red' },
          ].map(t => (
            <button key={t.val} onClick={() => { setFiltroTipo(t.val); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                filtroTipo === t.val
                  ? t.color === 'emerald' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : t.color === 'red' ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-sky-50 text-sky-700 border-sky-200'
                  : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'
              }`}>
              {t.label}
            </button>
          ))}

          {/* Separador */}
          <div className="w-px h-5 bg-slate-200 hidden sm:block" />

          {/* Fecha desde */}
          <div className="flex items-center gap-1">
            <Calendar size={12} className="text-slate-400" />
            <input
              type="date"
              value={fechaDesde}
              onChange={e => { setFechaDesde(e.target.value); setPage(0) }}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-sky-500/30"
            />
          </div>
          <span className="text-xs text-slate-300">—</span>
          <input
            type="date"
            value={fechaHasta}
            onChange={e => { setFechaHasta(e.target.value); setPage(0) }}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-sky-500/30"
          />

          {/* Limpiar filtros */}
          {hayFiltros && (
            <button onClick={limpiarFiltros}
              className="text-xs text-slate-400 hover:text-red-500 underline transition-colors">
              Limpiar
            </button>
          )}

          {/* Contador */}
          <span className="text-xs text-slate-400 ml-auto font-medium">{total} movimiento{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* ── Lista de lotes ──────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-center py-16">
          <div className="w-6 h-6 border-[3px] border-sky-300 border-t-sky-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400 mt-3">Cargando movimientos...</p>
        </div>
      ) : lotes.length === 0 ? (
        <div className="text-center py-16">
          <Package size={36} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-bold text-slate-400">Sin movimientos registrados</p>
          <p className="text-xs text-slate-300 mt-1">
            {hayFiltros ? 'No hay movimientos que coincidan con los filtros' : 'Los ingresos y egresos aparecerán aquí'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {lotes.map(lote => {
            const esIngreso = lote.tipo === 'ingreso'
            const expanded = expandedLotes.has(lote.id)
            const motivoCfg = MOTIVOS_TIPO[lote.motivo_tipo] || MOTIVOS_TIPO.otro
            const motivoColors = getMotivoChipClasses(lote.motivo_tipo)
            const totalCantidad = lote.items.reduce((s, m) => s + Number(m.cantidad), 0)

            return (
              <div key={lote.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-sm transition-shadow">
                {/* Header del lote */}
                <button
                  type="button"
                  onClick={() => toggleLote(lote.id)}
                  className="w-full text-left"
                >
                  <div className={`flex items-center gap-3 px-4 py-3 ${esIngreso ? 'bg-emerald-50/50' : 'bg-red-50/50'}`}>
                    {/* Icono tipo */}
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      lote.esMixto ? 'bg-slate-100' : esIngreso ? 'bg-emerald-100' : 'bg-red-100'
                    }`}>
                      {lote.esMixto ? <ArrowDownToLine size={16} className="text-slate-600 rotate-180" /> :
                       esIngreso
                        ? <ArrowDownToLine size={16} className="text-emerald-600" />
                        : <ArrowUpFromLine size={16} className="text-red-600" />
                      }
                    </div>

                    {/* Info principal */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Correlativo */}
                        <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                          {formatCorrelativo(lote.numero)}
                        </span>

                        {/* Badge tipo */}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          lote.esMixto ? 'bg-slate-200 text-slate-600' :
                          esIngreso ? 'bg-emerald-200/60 text-emerald-700' : 'bg-red-200/60 text-red-700'
                        }`}>
                          {lote.esMixto ? 'MIXTO' : esIngreso ? 'INGRESO' : 'EGRESO'}
                        </span>

                        {/* Chip categoría motivo */}
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${motivoColors.bg} ${motivoColors.text} ${motivoColors.border}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${motivoColors.dot}`} />
                          {motivoCfg.label}
                        </span>
                      </div>

                      {/* Motivo texto + meta */}
                      <div className="flex items-center gap-2 mt-1">
                        <p className={`text-xs text-slate-500 flex-1 ${expanded ? 'break-words whitespace-normal' : 'truncate'}`}>
                          {lote.motivo}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Clock size={10} />
                          {formatFechaCorta(lote.fecha)}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          {lote.usuario_color && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: lote.usuario_color }} />
                          )}
                          <User size={10} />
                          {lote.usuario}
                        </span>
                      </div>
                    </div>

                    {/* Resumen derecha */}
                    <div className="text-right shrink-0 flex items-center gap-3">
                      <div>
                        {!lote.esMixto && (
                          <span className={`text-sm font-bold ${esIngreso ? 'text-emerald-600' : 'text-red-600'}`}>
                            {esIngreso ? '+' : '-'}{totalCantidad.toLocaleString('es-VE')}
                          </span>
                        )}
                        <p className="text-[10px] text-slate-400">{lote.items.length} item{lote.items.length > 1 ? 's' : ''}</p>
                      </div>
                      <div className="text-slate-300">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </div>
                  </div>
                </button>

                {/* Items expandidos */}
                {expanded && (
                  <div className="border-t border-slate-100">
                    {/* Header tabla items */}
                    <div className="grid grid-cols-[1fr_80px_100px] sm:grid-cols-[1fr_80px_100px_80px] gap-1 px-4 py-1.5 bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <span>Producto</span>
                      <span className="text-right">Cantidad</span>
                      <span className="text-right">Saldo</span>
                      <span className="hidden sm:block text-right">Anterior</span>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {lote.items.map(m => (
                        <div key={m.id} className="grid grid-cols-[1fr_80px_100px] sm:grid-cols-[1fr_80px_100px_80px] gap-1 px-4 py-2 hover:bg-slate-50/50 transition-colors items-center">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{m.producto_nombre || 'Producto'}</p>
                            {m.numero && (
                              <span className="text-[10px] text-slate-300 font-mono">{formatCorrelativo(m.numero)}</span>
                            )}
                          </div>
                          <span className={`text-sm font-bold text-right ${m.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>
                            {m.tipo === 'ingreso' ? '+' : '-'}{Number(m.cantidad).toLocaleString('es-VE')}
                          </span>
                          <span className="text-sm font-bold text-slate-700 text-right">
                            {Number(m.stock_nuevo).toLocaleString('es-VE')}
                          </span>
                          <span className="hidden sm:block text-xs text-slate-400 text-right">
                            {Number(m.stock_anterior).toLocaleString('es-VE')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Paginación ──────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <Pagination
          paginaActual={page + 1}
          totalPaginas={totalPages}
          onCambiarPagina={p => setPage(p - 1)}
        />
      )}
    </div>
  )
}
