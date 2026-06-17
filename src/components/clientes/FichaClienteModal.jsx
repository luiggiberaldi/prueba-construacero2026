// src/components/clientes/FichaClienteModal.jsx
// Modal ficha del cliente: historial de crédito + formulario de abono
import { useState, useEffect } from 'react'
import { X, CreditCard, ArrowUpCircle, ArrowDownCircle, AlertCircle, RefreshCw, DollarSign, Hash, Phone, FileText, ChevronRight, MessageSquare, Handshake, RotateCcw, ShoppingBag, ChevronDown, Briefcase } from 'lucide-react'
import { useCuentasCobrar, useRegistrarAbono, useRevertirAbono, useRegistrarSaldoFavor, useRegistrarDevolucionCredito } from '../../hooks/useCuentasCobrar'
import { useVentasCliente } from '../../hooks/useClientes'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import SeguimientoTimeline from '../ui/SeguimientoTimeline'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, removeAccents } from '../../utils/format'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import { showToast } from '../ui/Toast'
import { apiUrl } from '../../services/apiBase'
import { authFetch } from '../../services/authFetch'
import ConfirmModal from '../ui/ConfirmModal'

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

const METODOS = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT', 'Cruce']

function FormAbono({ clienteId, saldo, onSuccess }) {
  // Cada línea de pago: { metodo, monto, referencia }
  const [lineas, setLineas] = useState([{ metodo: 'Efectivo $', monto: '', referencia: '' }])
  const [descripcion, setDescripcion] = useState('')
  const registrar = useRegistrarAbono()

  // Total acumulado de todas las líneas
  const totalIngresado = lineas.reduce((acc, l) => acc + (parseFloat(l.monto) || 0), 0)
  const excede = saldo > 0 && totalIngresado > saldo + 0.001
  const sinMonto = totalIngresado <= 0

  function actualizarLinea(idx, campo, valor) {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, [campo]: valor } : l))
  }

  function agregarLinea() {
    setLineas(prev => [...prev, { metodo: 'Efectivo $', monto: '', referencia: '' }])
  }

  function quitarLinea(idx) {
    setLineas(prev => prev.filter((_, i) => i !== idx))
  }

  function ponerTotal() {
    if (lineas.length === 1) {
      setLineas([{ ...lineas[0], monto: saldo.toFixed(2) }])
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (excede || sinMonto) return

    // Enviar como JSON array de formas de pago (igual que despachos)
    const formasPagoJson = JSON.stringify(lineas.map(l => ({
      metodo: l.metodo,
      monto: parseFloat(l.monto) || 0,
      referencia: l.referencia || '',
    })))

    await registrar.mutateAsync({
      clienteId,
      monto: totalIngresado,
      formaPago: formasPagoJson,
      referencia: lineas[0]?.referencia || '',
      descripcion: descripcion || 'Abono recibido',
    })
    setLineas([{ metodo: 'Efectivo $', monto: '', referencia: '' }])
    setDescripcion('')
    onSuccess?.(totalIngresado)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-emerald-800 flex items-center gap-2">
        <ArrowDownCircle size={15} className="text-emerald-600" />
        Registrar abono
      </h4>

      {/* Líneas de pago */}
      <div className="space-y-2">
        {lineas.map((linea, idx) => (
          <div key={idx} className="bg-white border border-emerald-100 rounded-xl p-3 space-y-2">
            {/* Fila: monto + botón total + quitar */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto USD</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={linea.monto}
                    onChange={e => actualizarLinea(idx, 'monto', e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                  {/* Botón Total solo en primera línea cuando hay 1 sola */}
                  {lineas.length === 1 && saldo > 0 && (
                    <button
                      type="button"
                      onClick={ponerTotal}
                      className="px-3 py-2 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold hover:bg-emerald-200 transition-colors whitespace-nowrap"
                    >
                      Total
                    </button>
                  )}
                </div>
              </div>
              {lineas.length > 1 && (
                <button
                  type="button"
                  onClick={() => quitarLinea(idx)}
                  className="mt-4 p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Quitar"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Métodos de pago */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forma de pago</label>
              <div className="flex flex-wrap gap-1">
                {METODOS.map(m => (
                  <button key={m} type="button"
                    onClick={() => actualizarLinea(idx, 'metodo', m)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      linea.metodo === m
                        ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Referencia por línea */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Referencia (opcional)</label>
              <input
                type="text"
                value={linea.referencia}
                onChange={e => actualizarLinea(idx, 'referencia', e.target.value)}
                placeholder="Nº de confirmación, comprobante..."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Descripción */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción (opcional)</label>
        <input
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Ej: Pago parcial factura #123"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
        />
      </div>

      {/* Resumen total + error */}
      {totalIngresado > 0 && (
        <div className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm font-bold ${
          excede ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-100 text-emerald-800'
        }`}>
          <span>Total a abonar:</span>
          <span>${totalIngresado.toFixed(2)}</span>
        </div>
      )}
      {excede && (
        <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
          <AlertCircle size={12} />
          El monto supera la deuda ({fmtUsd(saldo)}). Reduce el abono.
        </p>
      )}

      <button
        type="submit"
        disabled={registrar.isPending || sinMonto || excede}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrar.isPending ? 'Registrando...' : 'Confirmar abono'}
      </button>
    </form>
  )
}

function FormSaldoFavor({ clienteId, onSuccess }) {
  const [monto, setMonto] = useState('')
  const [formaPago, setFormaPago] = useState('Efectivo $')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const registrarSaldoFavor = useRegistrarSaldoFavor()

  const sinMonto = !monto || parseFloat(monto) <= 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (sinMonto) return

    await registrarSaldoFavor.mutateAsync({
      clienteId,
      monto: parseFloat(monto),
      formaPago,
      referencia: referencia || null,
      descripcion: descripcion || 'Crédito / Saldo a favor recibido',
    })
    setMonto('')
    setReferencia('')
    setDescripcion('')
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-blue-800 flex items-center gap-2">
        <ArrowDownCircle size={15} className="text-blue-600" />
        Cargar saldo a favor
      </h4>

      <div className="bg-white border border-blue-100 rounded-xl p-3 space-y-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto USD</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={monto}
            onChange={e => setMonto(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forma de pago</label>
          <div className="flex flex-wrap gap-1">
            {METODOS.filter(m => m !== 'Cruce').map(m => (
              <button key={m} type="button"
                onClick={() => setFormaPago(m)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                  formaPago === m
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Referencia (opcional)</label>
          <input
            type="text"
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            placeholder="Nº de confirmación, comprobante..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción (opcional)</label>
        <input
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Ej: Anticipo para futuros despachos"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      <button
        type="submit"
        disabled={registrarSaldoFavor.isPending || sinMonto}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrarSaldoFavor.isPending ? 'Cargando...' : 'Confirmar saldo a favor'}
      </button>
    </form>
  )
}

function FormDevolucionCredito({ clienteId, saldoFavor, onSuccess }) {
  const [monto, setMonto] = useState('')
  const [formaPago, setFormaPago] = useState('Efectivo $')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const registrarDevolucion = useRegistrarDevolucionCredito()

  const sinMonto = !monto || parseFloat(monto) <= 0
  const excede = saldoFavor > 0 && parseFloat(monto) > saldoFavor + 0.001

  function ponerTotal() {
    setMonto(saldoFavor.toFixed(2))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (sinMonto || excede) return

    await registrarDevolucion.mutateAsync({
      clienteId,
      monto: parseFloat(monto),
      formaPago,
      referencia: referencia || null,
      descripcion: descripcion || 'Devolución de saldo a favor registrada',
    })
    setMonto('')
    setReferencia('')
    setDescripcion('')
    onSuccess?.(parseFloat(monto))
  }

  return (
    <form onSubmit={handleSubmit} className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-amber-800 flex items-center gap-2">
        <ArrowUpCircle size={15} className="text-amber-600" />
        Devolver saldo a favor (Reembolso)
      </h4>

      <div className="bg-white border border-amber-100 rounded-xl p-3 space-y-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto USD</label>
          <div className="flex gap-1">
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={saldoFavor}
              value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder="0.00"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
            {saldoFavor > 0 && (
              <button
                type="button"
                onClick={ponerTotal}
                className="px-3 py-2 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold hover:bg-amber-200 transition-colors whitespace-nowrap"
              >
                Total
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forma de devolución</label>
          <div className="flex flex-wrap gap-1">
            {METODOS.filter(m => m !== 'Cruce').map(m => (
              <button key={m} type="button"
                onClick={() => setFormaPago(m)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                  formaPago === m
                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:text-amber-600'
                }`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Referencia (opcional)</label>
          <input
            type="text"
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            placeholder="Nº de confirmación, comprobante..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción (opcional)</label>
        <input
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Ej: Devolución por excedente de pago"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
      </div>

      {excede && (
        <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
          <AlertCircle size={12} />
          El monto supera el saldo a favor disponible ({fmtUsd(saldoFavor)}). Reduce el monto.
        </p>
      )}

      <button
        type="submit"
        disabled={registrarDevolucion.isPending || sinMonto || excede}
        className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
      >
        {registrarDevolucion.isPending ? 'Procesando...' : 'Confirmar devolución'}
      </button>
    </form>
  )
}


// ─── Historial de Ventas Aprobadas con Acordeón ──────────────────────────────
function HistorialVentas({ clienteId }) {
  const { data: ventas = [], isLoading } = useVentasCliente(clienteId)
  const [expandedId, setExpandedId] = useState(null)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1,2,3].map(i => (
          <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (ventas.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-2xl">
        <ShoppingBag size={28} className="mx-auto mb-2 opacity-30 text-slate-300" />
        <p className="text-sm">Sin ventas aprobadas registradas</p>
      </div>
    )
  }

  function toggleExpand(id) {
    setExpandedId(prev => prev === id ? null : id)
  }

  return (
    <div className="space-y-2">
      {ventas.map(v => {
        const totalFinal = Number(v.total_usd || 0) - Number(v.descuento_total_usd || 0)
        const totalItems = v.items?.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0) || 0
        const displayNum = `DES-${String(v.numero).padStart(5, '0')}`
        const isExpanded = expandedId === v.id

        // Detección robusta de préstamos del despacho
        let tienePrestamos = false
        try {
          const fp = typeof v.forma_pago === 'string' ? JSON.parse(v.forma_pago) : (v.forma_pago || [])
          if (Array.isArray(fp) && fp.some(f => f.metodo === 'Préstamo' || f.metodo === 'Prestamo')) {
            tienePrestamos = true
          }
        } catch (e) {
          if (typeof v.forma_pago === 'string' && (v.forma_pago === 'Préstamo' || v.forma_pago === 'Prestamo')) {
            tienePrestamos = true
          }
        }

        // Aplicar fallback si el despacho completo es de tipo préstamo pero los ítems individuales no lo tienen marcado
        const itemsConFallback = tienePrestamos && !v.items?.some(x => x.es_prestamo)
          ? v.items?.map(it => ({ ...it, es_prestamo: true }))
          : v.items

        return (
          <div key={v.id} className="border border-slate-100 rounded-xl bg-slate-50 overflow-hidden transition-all shadow-sm">
            {/* Header del Item / Botón de Toggle */}
            <button
              onClick={() => toggleExpand(v.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-100/70 transition-colors text-left focus:outline-none"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <ShoppingBag size={14} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800 font-mono">{displayNum}</span>
                  <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase shrink-0 ${
                    v.estado === 'entregada'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200/50'
                      : 'bg-blue-100 text-blue-800 border border-blue-200/50'
                  }`}>
                    {v.estado}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 animate-fade-in duration-100">
                  {new Date(v.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {v.vendedor?.nombre ? ` · ${v.vendedor.nombre}` : ''}
                  {` · ${v.items?.length || 0} arts (${totalItems} unds)`}
                </p>
              </div>
              <div className="text-right shrink-0 flex items-center gap-2">
                <span className="text-sm font-black text-slate-700">${totalFinal.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {/* Contenido Desplegable (Artículos) */}
            {isExpanded && (
              <div className="bg-white border-t border-slate-100 px-4 py-3 animate-fade-in duration-150">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                  Detalle de Artículos
                </div>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {itemsConFallback?.map(it => (
                    <div key={it.id} className="flex justify-between items-center text-xs py-1 border-b border-slate-50 last:border-0 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-800 uppercase leading-snug break-words">
                          <span>{it.nombre_snap || 'Artículo sin nombre'}</span>
                          {it.es_prestamo && (
                            <span className="inline-flex items-center ml-2 bg-amber-100 text-amber-800 text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 border border-amber-200 select-none">
                              Préstamo
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] font-mono text-slate-400 mt-0.5">Cód: {it.codigo_snap || 'S/C'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-slate-700">
                          {it.cantidad} {it.unidad_snap?.toLowerCase()} x ${Number(it.precio_unit_usd || 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold">${Number(it.total_linea_usd || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Modal principal ─────────────────────────────────────────────────────────
export default function FichaClienteModal({ cliente, isOpen, onClose }) {
  const { perfil } = useAuthStore()
  const { data: config = {} } = useConfigNegocio()
  const puedeRegistrarAbono = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const puedeRevertirAbono = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const { data: movimientos = [], isLoading, refetch } = useCuentasCobrar(isOpen ? cliente?.id : null)

  const [activeTab, setActiveTab] = useState('cuenta')
  const [abonoARevertir, setAbonoARevertir] = useState(null)
  const revertirMutation = useRevertirAbono()
  const [prestamos, setPrestamos] = useState([])
  const [cargandoPrestamos, setCargandoPrestamos] = useState(false)
  const [busquedaPrestamos, setBusquedaPrestamos] = useState('')
  const [activeAction, setActiveAction] = useState(null)
  const [actionQty, setActionQty] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const [cargadoUnaVez, setCargadoUnaVez] = useState(false)

  const fetchPrestamos = async () => {
    if (!cliente?.id) return
    setCargandoPrestamos(true)
    try {
      const res = await authFetch(`/api/clientes/prestamos?clienteId=${cliente.id}`)
      if (res.ok) {
        const data = await res.json()
        setPrestamos(data || [])
        setCargadoUnaVez(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCargandoPrestamos(false)
    }
  }

  useEffect(() => {
    if (isOpen && cliente?.id) {
      fetchPrestamos()
    } else if (!isOpen) {
      setCargadoUnaVez(false)
      setPrestamos([])
    }
  }, [isOpen, cliente?.id])

  const handleActionSubmit = async (prestamo, type) => {
    const qty = Number(actionQty)
    if (isNaN(qty) || qty <= 0) {
      showToast('Cantidad inválida', 'error')
      return
    }
    setActionLoading(true)
    try {
      const url = type === 'devolver' ? '/api/clientes/prestamos/devolver' : '/api/clientes/prestamos/facturar'
      const res = await authFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prestamoId: prestamo.id,
          cantidad: qty
        })
      })
      const result = await res.json()
      if (!res.ok) {
        showToast(result.error || 'Error al procesar la acción', 'error')
      } else {
        showToast(type === 'devolver' ? 'Devolución física registrada con éxito ✓' : 'Conversión a venta registrada con éxito ✓', 'success')
        setActiveAction(null)
        setActionQty('')
        fetchPrestamos()
        refetch()
      }
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const prestamosFiltrados = prestamos.filter(p => {
    const term = removeAccents(busquedaPrestamos.toLowerCase())
    const pName = removeAccents(p.producto?.nombre || '').toLowerCase()
    const pCode = removeAccents(p.producto?.codigo || '').toLowerCase()
    return pName.includes(term) || pCode.includes(term)
  })

  // Saldo local para actualización inmediata tras abonar (sin esperar cache del padre)
  const [saldoLocal, setSaldoLocal] = useState(null)
  const [saldoFavorLocal, setSaldoFavorLocal] = useState(null)
  const [cxcAction, setCxcAction] = useState('abono')
  const [prevClienteId, setPrevClienteId] = useState(null)

  // Sincronizar cuando el prop cambia (al abrir el modal o cuando el padre refresca)
  useEffect(() => {
    const pDeuda = Number(cliente?.saldo_pendiente || 0);
    const pFavor = Number(cliente?.saldo_a_favor || 0);
    setSaldoLocal(pDeuda)
    setSaldoFavorLocal(pFavor)

    // Solo cambiar acción si es un cliente distinto
    if (cliente?.id !== prevClienteId) {
      setPrevClienteId(cliente?.id)
      if (pDeuda > 0) {
        setCxcAction('abono')
      } else {
        setCxcAction('saldo_favor')
      }
    } else {
      // Si el mismo cliente actualizó saldos, verificar validez de la acción actual
      if (cxcAction === 'abono' && pDeuda <= 0) {
        setCxcAction('saldo_favor')
      } else if (cxcAction === 'devolucion_credito' && pFavor <= 0) {
        setCxcAction(pDeuda > 0 ? 'abono' : 'saldo_favor')
      }
    }
  }, [cliente?.id, cliente?.saldo_pendiente, cliente?.saldo_a_favor, cxcAction, prevClienteId])

  if (!isOpen || !cliente) return null

  const saldo = saldoLocal ?? Number(cliente.saldo_pendiente || 0)
  const saldoFavor = saldoFavorLocal ?? Number(cliente.saldo_a_favor || 0)
  const color = cliente.vendedor?.color || '#64748b'

  const tienePrestamosActivos = cargadoUnaVez
    ? prestamos.some(p => p.estado === 'pendiente' || p.estado === 'devuelto_parcial')
    : !!cliente.tiene_prestamos_activos

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="relative px-5 py-4 shrink-0" style={{ background: `linear-gradient(135deg, ${color}dd, ${color}88)` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                style={{ background: 'rgba(255,255,255,0.25)', color: 'white', border: '2px solid rgba(255,255,255,0.4)' }}>
                {cliente.nombre?.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-black text-white text-base leading-tight truncate">{cliente.nombre}</h2>
                  {cliente.tipo_cliente === 'personal' && (
                    <span className="inline-flex items-center gap-1 bg-[#FEF3C7] text-[#B45309] text-[11px] font-black px-2 py-0.5 rounded-lg border border-[#FDE68A] shrink-0 uppercase tracking-wider shadow-sm">
                      Personal (Desc. {config.descuento_personal_pct ?? 10}%)
                    </span>
                  )}
                  {cliente.codigo_cliente && (
                    <span 
                      className="bg-white text-slate-900 font-mono font-black text-[11px] px-2 py-0.5 rounded-lg shadow-md border border-white/80 shrink-0 select-all cursor-pointer transition-all active:scale-95 hover:bg-slate-100" 
                      title="Código de cliente (haz clic para copiar)"
                      onClick={() => {
                        navigator.clipboard.writeText(cliente.codigo_cliente);
                      }}
                    >
                      #{cliente.codigo_cliente}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {cliente.rif_cedula && (
                    <span className="flex items-center gap-1 text-xs text-white/70"><Hash size={10} />{cliente.rif_cedula}</span>
                  )}
                  {cliente.telefono && (
                    <span className="flex items-center gap-1 text-xs text-white/70"><Phone size={10} />{cliente.telefono}</span>
                  )}
                  {cliente.tipo_cliente === 'personal' && cliente.categoria && (
                    <span className="inline-flex items-center gap-1 bg-white/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-lg border border-white/30 shrink-0 uppercase tracking-wider">
                      <Briefcase size={10} className="text-white/80" />
                      {cliente.categoria}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors shrink-0">
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Saldo y Préstamos */}
          <div className="flex gap-2 flex-wrap mt-3">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black ${
              saldo > 0 ? 'bg-red-500/30 text-white border border-red-300/40' : 'bg-white/20 text-white border border-white/30'
            }`}>
              {saldo > 0 ? <AlertCircle size={14} /> : <DollarSign size={14} />}
              {saldo > 0 ? `Deuda: ${fmtUsd(saldo)}` : 'Sin deuda pendiente'}
            </div>
            {saldoFavor > 0 && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black bg-emerald-500/30 text-white border border-emerald-300/40">
                <DollarSign size={14} className="text-emerald-200" />
                Saldo a Favor: {fmtUsd(saldoFavor)}
              </div>
            )}
            {tienePrestamosActivos && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black bg-amber-500/30 text-white border border-amber-300/40 animate-pulse">
                <Handshake size={14} className="text-amber-200" />
                Tiene préstamos activos
              </div>
            )}
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-slate-100 bg-slate-50/50 p-1 gap-1 shrink-0">
          <button
            onClick={() => setActiveTab('cuenta')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'cuenta'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
            }`}
          >
            <CreditCard size={13} />
            Cuenta
          </button>
          <button
            onClick={() => setActiveTab('ventas')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'ventas'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
            }`}
          >
            <ShoppingBag size={13} />
            Ventas
          </button>
          <button
            onClick={() => setActiveTab('prestamos')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'prestamos'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            <Handshake size={13} />
            Préstamos
          </button>
          <button
            onClick={() => setActiveTab('seguimiento')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'seguimiento'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
            }`}
          >
            <MessageSquare size={13} />
            Bitácora
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          
          {/* PESTAÑA: CUENTA Y MOVIMIENTOS */}
          {activeTab === 'cuenta' && (
            <div className="space-y-4">
              {/* Selector de Acción CxC */}
              {puedeRegistrarAbono && (
                <div className="flex gap-1 p-1 bg-slate-100 rounded-xl text-xs shrink-0 select-none">
                  <button
                    type="button"
                    onClick={() => setCxcAction('abono')}
                    disabled={saldo <= 0}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      cxcAction === 'abono'
                        ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                        : 'text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent'
                    }`}
                  >
                    Abonar Deuda
                  </button>
                  <button
                    type="button"
                    onClick={() => setCxcAction('saldo_favor')}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      cxcAction === 'saldo_favor'
                        ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Cargar Crédito
                  </button>
                  {saldoFavor > 0 && (
                    <button
                      type="button"
                      onClick={() => setCxcAction('devolucion_credito')}
                      className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                        cxcAction === 'devolucion_credito'
                          ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Devolver Crédito
                    </button>
                  )}
                </div>
              )}

              {/* Formulario según acción seleccionada */}
              {puedeRegistrarAbono && cxcAction === 'abono' && saldo > 0 && (
                <FormAbono
                  clienteId={cliente.id}
                  saldo={saldo}
                  onSuccess={(montoAbonado) => {
                    setSaldoLocal(prev => Math.max(0, (prev ?? saldo) - montoAbonado))
                    refetch()
                  }}
                />
              )}

              {puedeRegistrarAbono && cxcAction === 'saldo_favor' && (
                <FormSaldoFavor
                  clienteId={cliente.id}
                  onSuccess={() => {
                    refetch()
                  }}
                />
              )}

              {puedeRegistrarAbono && cxcAction === 'devolucion_credito' && saldoFavor > 0 && (
                <FormDevolucionCredito
                  clienteId={cliente.id}
                  saldoFavor={saldoFavor}
                  onSuccess={(montoDevuelto) => {
                    setSaldoFavorLocal(prev => Math.max(0, (prev ?? saldoFavor) - montoDevuelto))
                    refetch()
                  }}
                />
              )}

              {/* Historial */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                    <CreditCard size={14} className="text-slate-500" />
                    Historial de cuenta
                  </h3>
                  <button onClick={refetch} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                    <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                  </button>
                </div>

                {isLoading ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : movimientos.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <CreditCard size={28} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Sin movimientos registrados</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {movimientos.map(mov => (
                      <div key={mov.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${
                        mov.tipo === 'cargo'
                          ? 'bg-red-50 border-red-100'
                          : mov.tipo === 'credito'
                          ? 'bg-blue-50 border-blue-100'
                          : mov.tipo === 'devolucion_credito'
                          ? 'bg-amber-50 border-amber-100'
                          : 'bg-emerald-50 border-emerald-100'
                      }`}>
                        {mov.tipo === 'cargo' ? (
                          <ArrowUpCircle size={18} className="text-red-500 shrink-0" />
                        ) : mov.tipo === 'credito' ? (
                          <ArrowDownCircle size={18} className="text-blue-500 shrink-0" />
                        ) : mov.tipo === 'devolucion_credito' ? (
                          <ArrowUpCircle size={18} className="text-amber-500 shrink-0" />
                        ) : (
                          <ArrowDownCircle size={18} className="text-emerald-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-slate-700 truncate">{mov.descripcion}</p>
                            {mov.metodo_pago === 'cod' && (
                              <span className="bg-blue-100 text-blue-800 text-[8.5px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 border border-blue-200">
                                COD
                              </span>
                            )}
                            {mov.tipo === 'abono' && mov.forma_pago_abono === 'Saldo a favor' && (
                              <span className="bg-purple-100 text-purple-800 text-[8.5px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 border border-purple-200">
                                {mov.referencia?.startsWith('Despacho')
                                  ? `Compra ${mov.referencia.replace('Despacho ', '')}`
                                  : 'Compra'}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400">{fmtFecha(mov.creado_en)}</p>
                          {mov.referencia && (
                            <p className="text-[10px] text-slate-400">Ref: {mov.referencia}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <div>
                            <p className={`text-sm font-black ${
                              mov.tipo === 'cargo' 
                                ? 'text-red-600' 
                                : mov.tipo === 'credito' 
                                ? 'text-blue-600' 
                                : mov.tipo === 'devolucion_credito'
                                ? 'text-amber-600'
                                : 'text-emerald-600'
                            }`}>
                              {mov.tipo === 'cargo' || mov.tipo === 'devolucion_credito' ? '+' : '-'}{fmtUsd(mov.monto_usd)}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {(mov.tipo === 'credito' || mov.tipo === 'devolucion_credito') ? 'Crédito' : 'Saldo'}: {fmtUsd(mov.saldo_usd)}
                            </p>
                          </div>
                          {(mov.tipo === 'abono' || mov.tipo === 'credito' || mov.tipo === 'devolucion_credito') && puedeRevertirAbono && (
                            <button
                              type="button"
                              onClick={() => setAbonoARevertir(mov)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                              title={mov.tipo === 'credito' ? "Revertir saldo a favor" : mov.tipo === 'devolucion_credito' ? "Revertir devolución" : "Revertir abono"}
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PESTAÑA: HISTORIAL DE VENTAS */}
          {activeTab === 'ventas' && (
            <div>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
                <ShoppingBag size={14} className="text-slate-500" />
                Historial de Ventas Aprobadas
              </h3>
              <HistorialVentas clienteId={cliente.id} />
            </div>
          )}

          {/* PESTAÑA: SEGUIMIENTO / TIMELINE */}
          {activeTab === 'seguimiento' && (
            <div>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
                <MessageSquare size={14} className="text-slate-500" />
                Seguimiento Operativo
              </h3>
              <SeguimientoTimeline clienteId={cliente.id} />
            </div>
          )}

          {/* PESTAÑA: PRÉSTAMOS (NUEVA) */}
          {activeTab === 'prestamos' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Handshake size={14} className="text-emerald-600 animate-pulse" />
                  Artículos en Préstamo
                </h3>
                <button 
                  onClick={fetchPrestamos} 
                  disabled={cargandoPrestamos}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <RefreshCw size={13} className={cargandoPrestamos ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Buscador local */}
              <input
                type="text"
                placeholder="Buscar artículo en préstamo..."
                value={busquedaPrestamos}
                onChange={e => setBusquedaPrestamos(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:border-emerald-400 focus:bg-white transition-all focus:ring-2 focus:ring-emerald-50"
              />

              {cargandoPrestamos ? (
                <div className="space-y-2">
                  {[1,2].map(i => (
                    <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : prestamosFiltrados.length === 0 ? (
                <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                  <RefreshCw size={28} className="mx-auto mb-2 opacity-30 text-slate-300" />
                  <p className="text-xs">No se encontraron artículos en préstamo</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {prestamosFiltrados.map(p => {
                    const cantPrestada = Number(p.cantidad_prestada)
                    const cantDevuelta = Number(p.cantidad_devuelta || 0)
                    const cantFacturada = Number(p.cantidad_facturada || 0)
                    const restante = Math.max(0, cantPrestada - cantDevuelta - cantFacturada)
                    
                    const isActionActive = activeAction?.id === p.id
                    const isDevolver = activeAction?.type === 'devolver'
                    const isFacturar = activeAction?.type === 'facturar'

                    return (
                      <div 
                        key={p.id} 
                        className={`p-3.5 rounded-xl border transition-all ${
                          p.estado === 'pendiente' 
                            ? 'bg-white border-slate-200 shadow-sm'
                            : p.estado === 'devuelto_parcial'
                            ? 'bg-amber-50/20 border-amber-200'
                            : p.estado === 'facturado'
                            ? 'bg-sky-50/10 border-sky-100'
                            : 'bg-emerald-50/20 border-emerald-100 opacity-80'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-black text-slate-800 leading-snug">
                              {p.producto?.nombre || 'Producto sin nombre'}
                            </h4>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                              Cód: {p.producto?.codigo || 'S/C'} · F. Préstamo: {new Date(p.creado_en).toLocaleDateString('es-VE')}
                            </p>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] font-bold text-slate-500">
                              <span>Préstamo: <strong className="text-slate-700">{cantPrestada} {p.producto?.unidad || 'und'}</strong></span>
                              {cantDevuelta > 0 && <span className="text-emerald-600">Devuelto: <strong>{cantDevuelta}</strong></span>}
                              {cantFacturada > 0 && <span className="text-sky-600">Facturado: <strong>{cantFacturada}</strong></span>}
                              {restante > 0 && <span className="text-rose-500">Pendiente: <strong>{restante}</strong></span>}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                              Despacho: <span className="font-mono text-slate-600">DES-{String(p.despacho?.numero || '').padStart(5, '0')}</span> · Valor ref: ${p.producto?.precio_usd ? (restante * p.producto.precio_usd).toFixed(2) : '0.00'}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase shrink-0 ${
                            p.estado === 'pendiente'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : p.estado === 'devuelto_parcial'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : p.estado === 'facturado'
                              ? 'bg-sky-100 text-sky-800 border border-sky-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {p.estado === 'pendiente' ? 'Pendiente' : p.estado === 'devuelto_parcial' ? 'Parcial' : p.estado === 'facturado' ? 'Facturado' : 'Devuelto'}
                          </span>
                        </div>

                        {/* Botones de acción inline */}
                        {restante > 0 && !isActionActive && puedeRegistrarAbono && (
                          <div className="flex gap-2 mt-3 pt-2.5 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveAction({ id: p.id, type: 'devolver' })
                                setActionQty(String(restante))
                              }}
                              className="flex-1 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold transition-all active:scale-[0.98]"
                            >
                              Devolver
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveAction({ id: p.id, type: 'facturar' })
                                setActionQty(String(restante))
                              }}
                              className="flex-1 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[10px] font-bold transition-all active:scale-[0.98]"
                            >
                              Facturar
                            </button>
                          </div>
                        )}

                        {/* Formulario de Acción Inline */}
                        {isActionActive && (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2 animate-in slide-in-from-top-1 duration-150">
                            <div className="flex items-center justify-between text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              <span>{isDevolver ? 'Registrar devolución física' : 'Facturar a cuenta del cliente'}</span>
                              <span className="text-slate-500 font-mono">Max: {restante}</span>
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                step="any"
                                min="0.0001"
                                max={restante}
                                value={actionQty}
                                onChange={e => setActionQty(e.target.value)}
                                placeholder="0.00"
                                className="w-20 px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => setActiveAction(null)}
                                className="px-2.5 py-1 text-[10px] text-slate-500 hover:text-slate-700 font-bold transition-all"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleActionSubmit(p, activeAction.type)}
                                disabled={actionLoading}
                                className={`flex-1 py-1 text-[10px] font-black text-white rounded-lg transition-all flex items-center justify-center gap-1 shadow-sm active:scale-95 ${
                                  isDevolver 
                                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' 
                                    : 'bg-sky-600 hover:bg-sky-700 shadow-sky-100'
                                }`}
                              >
                                {actionLoading ? '...' : isDevolver ? 'Devolver ✓' : 'Facturar 💳'}
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
          )}

        </div>
      </div>

      <ConfirmModal
        isOpen={!!abonoARevertir}
        onClose={() => setAbonoARevertir(null)}
        onConfirm={async () => {
          if (!abonoARevertir) return
          try {
            await revertirMutation.mutateAsync({ abonoId: abonoARevertir.id })
            if (abonoARevertir.tipo === 'credito') {
              setSaldoFavorLocal(prev => Math.max(0, (prev ?? Number(cliente.saldo_a_favor || 0)) - Number(abonoARevertir.monto_usd)))
            } else if (abonoARevertir.tipo === 'devolucion_credito') {
              setSaldoFavorLocal(prev => (prev ?? Number(cliente.saldo_a_favor || 0)) + Number(abonoARevertir.monto_usd))
            } else {
              setSaldoLocal(prev => (prev ?? Number(cliente.saldo_pendiente || 0)) + Number(abonoARevertir.monto_usd))
            }
          } catch (err) {
            // Error handling if mutateAsync fails (usually handled inside the hook or via global toast)
          }
          setAbonoARevertir(null)
        }}
        title={abonoARevertir?.tipo === 'credito' ? "¿Revertir saldo a favor?" : abonoARevertir?.tipo === 'devolucion_credito' ? "¿Revertir devolución?" : "¿Revertir abono?"}
        message={
          abonoARevertir?.tipo === 'credito'
            ? `¿Estás seguro de que deseas revertir esta carga de crédito por valor de ${fmtUsd(abonoARevertir?.monto_usd)}?`
            : abonoARevertir?.tipo === 'devolucion_credito'
            ? `¿Estás seguro de que deseas revertir esta devolución de saldo a favor por valor de ${fmtUsd(abonoARevertir?.monto_usd)}?`
            : `¿Estás seguro de que deseas revertir este abono por valor de ${fmtUsd(abonoARevertir?.monto_usd)}?`
        }
        details={
          abonoARevertir?.tipo === 'credito'
            ? "Esta acción eliminará el crédito de la cuenta del cliente."
            : abonoARevertir?.tipo === 'devolucion_credito'
            ? "Esta acción devolverá el monto al saldo a favor del cliente."
            : "Esta acción eliminará el abono y aumentará la deuda del cliente."
        }
        confirmText="Revertir"
        variant="danger"
      />
    </div>
  )
}
