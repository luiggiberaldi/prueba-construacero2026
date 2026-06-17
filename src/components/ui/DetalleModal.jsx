import { useEffect, useState } from 'react'
import { X, Package, Loader2, Calendar, User, FileText, CreditCard, Hash, Truck, DollarSign, Pencil, AlertTriangle, Clock, MessageSquare, Handshake } from 'lucide-react'
import EditarItemsDespachoModal from '../despachos/EditarItemsDespachoModal'
import supabase from '../../services/supabase/client'
import SeguimientoTimeline from './SeguimientoTimeline'
import { apiUrl } from '../../services/apiBase'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtBs, usdToBs } from '../../utils/format'
import useAuthStore from '../../store/useAuthStore'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import { getComisionPctForItem } from '../../utils/comisionUtils'

function calcDescMonto(desc, totalLinea, cantidad) {
  if (!desc) return 0
  const v = Number(desc.valor)
  if (!v || v <= 0) return 0
  if (desc.tipo === 'porcentaje') return Math.round(totalLinea * v / 100 * 10000) / 10000
  return Math.round(Math.min(v * Number(cantidad), totalLinea) * 10000) / 10000
}

function ItemRow({ item, descuento, fmt, config, tipo, perfil, vendedorPerfil }) {
  const cant     = Number(item.cantidad || 1)
  const precio   = Number(item.precio_unit_usd || 0)
  const total    = Number(item.total_linea_usd || cant * precio)
  const descMonto = calcDescMonto(descuento, total, cant)
  const totalFinal = total - descMonto
  const esExterno = item.origen === 'externo' || !item.producto_id || String(item.producto_id).startsWith('manual-') || String(item.codigo_snap).startsWith('EXT')
  const sinStock = !item.cotizacion_id && !esExterno && cant > (item.producto?.stock_actual || 0)

  const showComision = tipo === 'despacho' && ['administracion', 'jefe', 'desarrollador', 'vendedor'].includes(perfil?.rol)
  // Usar el perfil del vendedor dueño del cliente (no el usuario logueado) para detectar es_externo
  const pct = showComision ? getComisionPctForItem(item, config, vendedorPerfil ?? null) : 0

  return (
    <tr className={`border-b border-slate-100 last:border-0 ${item.es_prestamo ? 'bg-emerald-50/60' : ''} ${descMonto > 0 ? 'bg-amber-50/70' : ''} ${sinStock ? 'bg-red-50/60' : ''}`}>
      <td className="py-3 pr-3">
        <p className="text-sm font-medium text-slate-800 leading-tight">{item.nombre_snap}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.codigo_snap && <p className="text-[11px] text-slate-400 font-mono">{item.codigo_snap}</p>}
          {showComision && (
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-0.5" title="Comisión estimada">
              <DollarSign size={10} className="text-emerald-500" />{pct}%
            </span>
          )}
        </div>
        {descMonto > 0 && (
          <p className="text-[11px] text-amber-600 mt-0.5 font-medium">
            Desc: {descuento.tipo === 'porcentaje' ? `${descuento.valor}%` : `${fmt(descuento.valor)}/u`} = -{fmt(descMonto)}
          </p>
        )}
        {sinStock && (
          <p className="text-[10px] text-red-600 font-black mt-1 flex items-center gap-1">
            <AlertTriangle size={10} /> Stock insuficiente ({item.producto?.stock_actual || 0} disp.)
          </p>
        )}
        {item.es_prestamo && (
          <span className="inline-flex items-center gap-1 mt-1 text-[9px] uppercase tracking-wider font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md">
            <Handshake size={9} /> Préstamo
          </span>
        )}
      </td>
      <td className="py-3 px-3 text-center text-sm text-slate-600 whitespace-nowrap">
        {cant} <span className="text-slate-400 text-[11px]">{item.unidad_snap || 'und'}</span>
      </td>
      <td className="py-3 px-3 text-right text-sm text-slate-600 whitespace-nowrap">
        {descMonto > 0 ? (
          <span>
            <span className="line-through text-slate-400">{fmt(precio)}</span>
            <br /><span className="text-amber-700 font-medium">{fmt(cant > 0 ? totalFinal / cant : 0)}</span>
          </span>
        ) : fmt(precio)}
      </td>
      <td className="py-3 pl-3 text-right text-sm font-bold whitespace-nowrap">
        {item.es_prestamo ? (
          <span className="text-emerald-600">$0,00</span>
        ) : descMonto > 0 ? (
          <span>
            <span className="line-through text-slate-400 font-normal text-xs">{fmt(total)}</span>
            <br /><span className="text-amber-700">{fmt(totalFinal)}</span>
          </span>
        ) : <span className="text-slate-800">{fmt(total)}</span>}
      </td>
    </tr>
  )
}

function ItemCard({ item, descuento, fmt, config, tipo, perfil, vendedorPerfil }) {
  const cant     = Number(item.cantidad || 1)
  const precio   = Number(item.precio_unit_usd || 0)
  const total    = Number(item.total_linea_usd || cant * precio)
  const descMonto = calcDescMonto(descuento, total, cant)
  const totalFinal = total - descMonto
  const esExterno = item.origen === 'externo' || !item.producto_id || String(item.producto_id).startsWith('manual-') || String(item.codigo_snap).startsWith('EXT')
  const sinStock = !item.cotizacion_id && !esExterno && cant > (item.producto?.stock_actual || 0)

  const showComision = tipo === 'despacho' && ['administracion', 'jefe', 'desarrollador', 'vendedor'].includes(perfil?.rol)
  // Usar el perfil del vendedor dueño del cliente (no el usuario logueado) para detectar es_externo
  const pct = showComision ? getComisionPctForItem(item, config, vendedorPerfil ?? null) : 0

  return (
    <div className={`py-3 border-b border-slate-100 last:border-0 ${item.es_prestamo ? 'bg-emerald-50/60 -mx-3 px-3 rounded-lg my-0.5' : ''} ${descMonto > 0 ? 'bg-amber-50/70 -mx-3 px-3 rounded-lg' : ''} ${sinStock ? 'bg-red-50/60 -mx-3 px-3 rounded-lg' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 leading-tight">{item.nombre_snap}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {item.codigo_snap && <p className="text-[11px] text-slate-400 font-mono">{item.codigo_snap}</p>}
            {showComision && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-0.5" title="Comisión estimada">
                <DollarSign size={10} className="text-emerald-500" />{pct}%
              </span>
            )}
          </div>
          {sinStock && (
            <p className="text-[10px] text-red-600 font-black mt-1 flex items-center gap-1">
              <AlertTriangle size={10} /> Stock insuficiente ({item.producto?.stock_actual || 0} disp.)
            </p>
          )}
          {item.es_prestamo && (
            <span className="inline-flex items-center gap-1 mt-1 text-[9px] uppercase tracking-wider font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md">
              <Handshake size={9} /> Préstamo
            </span>
          )}
        </div>
        {descMonto > 0 ? (
          <div className="text-right shrink-0">
            <span className="text-xs text-slate-400 line-through">{fmt(total)}</span>
            <p className="text-sm font-bold text-amber-700">{fmt(totalFinal)}</p>
          </div>
        ) : item.es_prestamo ? (
          <span className="text-sm font-bold text-emerald-600 shrink-0">$0,00</span>
        ) : (
          <span className="text-sm font-bold text-slate-800 shrink-0">{fmt(total)}</span>
        )}
      </div>
      <div className="flex gap-3 mt-1 text-xs text-slate-500">
        <span>{cant} {item.unidad_snap || 'und'}</span>
        <span>× {fmt(precio)}</span>
      </div>
      {descMonto > 0 && (
        <p className="text-[11px] text-amber-600 mt-1 font-medium">
          Desc: {descuento.tipo === 'porcentaje' ? `${descuento.valor}%` : `${fmt(descuento.valor)}/u`} = -{fmt(descMonto)}
        </p>
      )}
    </div>
  )
}

export default function DetalleModal({ isOpen, onClose, tipo = 'cotizacion', registro, tasa = 0 }) {
  const [items, setItems]       = useState([])
  const [corteDesdeItems, setCorteDesdeItems] = useState(0) // suma de items tipo 'corte'
  const [showEditItems, setShowEditItems] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [descuentos, setDescuentos] = useState({}) // { item_id: { tipo, valor } }
  const { perfil } = useAuthStore()
  const { tasaBcv, tasaUsdt } = useTasaCambio()
  const { data: config = {} } = useConfigNegocio()

  // Leer moneda seleccionada del PDF (compartida via localStorage)
  const monedaPdf = typeof window !== 'undefined'
    ? (localStorage.getItem('listopos_moneda_pdf') || '$')
    : '$'

  // Función de formato según moneda seleccionada (solo para cotizaciones)
  const esCot = tipo === 'cotizacion'
  const factorBcv = tasaBcv.precio > 0 && tasaUsdt.precio > 0
    ? tasaUsdt.precio / tasaBcv.precio
    : 0
  const fmt = esCot && monedaPdf === 'bcv' && factorBcv > 0
    ? (n) => `$${(Number(n || 0) * factorBcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : esCot && monedaPdf === 'bs' && tasa > 0
      ? (n) => fmtBs(Number(n || 0) * tasa)
      : fmtUsd
  const monedaTag = esCot && monedaPdf === 'bcv' ? 'BCV' : esCot && monedaPdf === 'bs' ? 'Bs' : null

  useEffect(() => {
    if (!isOpen || !registro?.id) return

    async function fetchItems() {
      setCargando(true)
      const tableName = tipo === 'cotizacion' ? 'cotizacion_items' : 'notas_despacho_items'
      const filterCol = tipo === 'cotizacion' ? 'cotizacion_id' : 'despacho_id'
      
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('*, producto:productos(id, stock_actual, categoria)')
          .eq(filterCol, registro.id)
          .order('orden')

        if (error) throw error
        let allItems = data || []

        // Si el usuario tiene RLS restrictivo (vendedor), obtener el stock real mediante la RPC segura
        const productIds = allItems.map(it => it.producto_id).filter(Boolean)
        if (productIds.length > 0) {
          try {
            const { data: stockData } = await supabase.rpc('obtener_stock_productos', { p_ids: productIds })
            if (stockData) {
              const stockMap = {}
              stockData.forEach(s => { stockMap[s.id] = Number(s.stock_actual) })
              allItems = allItems.map(it => {
                if (it.producto_id && stockMap[it.producto_id] !== undefined) {
                  return {
                    ...it,
                    producto: {
                      ...it.producto,
                      id: it.producto_id,
                      stock_actual: stockMap[it.producto_id]
                    }
                  }
                }
                return it
              })
            }
          } catch (err) {
            console.error('Error fetching stock via RPC:', err)
          }
        }

        // Separar ítems de corte para mostrarlos aparte (como flete)
        const esCorte = (it) => it.nombre_snap?.toLowerCase().startsWith('corte')
        const sumaCorte = allItems.filter(esCorte).reduce((s, it) => s + (Number(it.total_linea_usd) || 0), 0)
        setCorteDesdeItems(sumaCorte)
        setItems(allItems.filter(it => !esCorte(it)))
      } catch (err) {
        console.error('Error fetching items:', err)
      } finally {
        setCargando(false)
      }
    }

    fetchItems()

    // Cargar descuentos especiales de cotización (si existen en el backend anterior)
    if (esCot) {
      // Logic for old cotizacion discounts if still needed, 
      // but for simplicity we use the snapshots in the items
      setDescuentos({})
    }

  }, [isOpen, registro?.id, tipo])

  if (!isOpen || !registro) return null

  const tienePrestamos = tipo === 'despacho' && (() => {
    let isPrestamo = !!registro?.tiene_prestamos
    try {
      const fp = typeof registro?.forma_pago === 'string' ? JSON.parse(registro.forma_pago) : (registro?.forma_pago || [])
      if (Array.isArray(fp) && fp.some(f => f.metodo === 'Préstamo' || f.metodo === 'Prestamo')) {
        isPrestamo = true
      }
    } catch (e) {}
    // Fallback: revisar si algún ítem ya cargado tiene es_prestamo
    if (!isPrestamo && items.some(x => x.es_prestamo)) isPrestamo = true
    return isPrestamo
  })()

  // Si tienePrestamos=true pero los items aún no tienen es_prestamo, marcarlos todos
  const itemsConFallback = tipo === 'despacho' && tienePrestamos && items.length > 0 && !items.some(x => x.es_prestamo)
    ? items.map(it => ({ ...it, es_prestamo: true }))
    : items

  const numDisplay = esCot
    ? `COT-${String(registro.numero).padStart(5, '0')}`
    : `DES-${String(registro.numero).padStart(5, '0')}`

  const vendedorColor = registro.vendedor?.color || '#64748b'
  const envio     = Number(registro.costo_envio_usd || 0)
  const corte     = Number(registro.corte_usd || 0)
  const total     = Number(registro.total_usd     || 0)
  const notas     = registro.notas_cliente || registro.observaciones || ''

  // Parse formas de pago para despachos
  let formasDisplay = []
  if (!esCot && registro.forma_pago) {
    try {
      const parsed = JSON.parse(registro.forma_pago)
      if (Array.isArray(parsed)) formasDisplay = parsed
    } catch { formasDisplay = [{ metodo: registro.forma_pago, monto: null }] }
  }

  const tieneChofer = !esCot && registro.transportista?.nombre
  const tienePago = !esCot && (formasDisplay.length > 0 || registro.referencia_pago)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] sm:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">

        {/* Header */}
        <div className="relative h-16 shrink-0 flex items-end justify-between px-5 pb-3"
          style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
          <div className="relative z-10">
            <p className="font-black text-white text-base font-mono leading-tight drop-shadow">{numDisplay}</p>
          </div>
          <button onClick={onClose}
            className="relative z-10 p-1.5 rounded-lg transition-colors"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* ── Info general ── */}
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Calendar size={12} className="text-slate-400" /> {fmtFecha(registro.creado_en)}</span>
          {registro.vendedor?.nombre && (
            <span className="inline-flex items-center gap-1"><User size={12} className="text-slate-400" /> <strong style={{ color: vendedorColor }}>{registro.vendedor.nombre}</strong></span>
          )}
          {!esCot && registro.cotizacion && (
            <span className="inline-flex items-center gap-1"><FileText size={12} className="text-slate-400" /> <strong className="font-mono text-slate-700">
              COT-{String(registro.cotizacion.numero).padStart(5, '0')}
            </strong></span>
          )}
        </div>

        {/* ── Bloque Pago (solo despachos) ── */}
        {tienePago && (
          <div className="mx-5 mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard size={11} /> Pago
            </p>
            <div className="flex flex-wrap gap-1.5">
              {formasDisplay.map((fp, i) => {
                let textVencimiento = null
                if (fp.metodo === 'Cta por cobrar' && fp.diasVencimiento > 0) {
                  const fCreacion = new Date(registro.creado_en)
                  const fVenc = new Date(fCreacion.getTime() + fp.diasVencimiento * 24 * 60 * 60 * 1000)
                  const hoy = new Date()
                  const restantes = Math.ceil((fVenc - hoy) / (1000 * 60 * 60 * 24))
                  const vencido = restantes < 0
                  textVencimiento = (
                    <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1 ${vencido ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      <Clock size={10} />
                      {fp.diasVencimiento} días ({vencido ? `Vencido hace ${Math.abs(restantes)}d` : `${restantes}d restantes`})
                    </span>
                  )
                }

                return (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700">
                    {fp.metodo}
                    {fp.monto != null && <span className="text-emerald-600 font-bold">${Number(fp.monto).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                    {textVencimiento}
                  </span>
                )
              })}
            </div>
            {registro.referencia_pago && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <Hash size={10} className="text-slate-400" /> Ref: <span className="font-mono font-medium text-slate-700">{registro.referencia_pago}</span>
              </p>
            )}
          </div>
        )}

        {/* ── Bloque Transporte (solo despachos, si hay transportista) ── */}
        {tieneChofer && (
          <div className="mx-5 mt-2 rounded-xl bg-blue-50/60 border border-blue-200 p-3">
            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
              <Truck size={11} /> Transporte
            </p>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{registro.transportista.nombre}</p>
                {(registro.transportista.vehiculo || registro.transportista.placa_chuto) && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {[registro.transportista.vehiculo, registro.transportista.placa_chuto, registro.transportista.placa_batea].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Cliente ── */}
        {(registro.cliente_factura || registro.cliente)?.nombre && (
          <div className="px-5 py-2.5 mt-1 border-b border-slate-100">
            {registro.cliente_factura && registro.cliente && registro.cliente_factura.id !== registro.cliente.id ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide">Cotizó</span>
                  <span className="text-xs font-medium truncate max-w-[250px]" style={{ color: registro.cliente.vendedor?.color || '#475569' }}>{registro.cliente.nombre}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-amber-500 uppercase tracking-wide font-semibold">Facturó</span>
                  <span className="text-xs font-bold truncate max-w-[250px]"
                    style={{ color: registro.cliente_factura.vendedor?.color || vendedorColor }}>
                    {registro.cliente_factura.nombre}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Cliente</span>
                <span className="text-xs font-semibold truncate max-w-[300px]"
                  style={{ color: (registro.cliente_factura || registro.cliente)?.vendedor?.color || vendedorColor }}>
                  {(registro.cliente_factura || registro.cliente).nombre}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tabla de productos */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Loan banner — shown when despacho tiene prestamos (flag OR items) */}
          {tipo === 'despacho' && tienePrestamos && (() => {
            const itemsPrestamo = itemsConFallback.filter(it => it.es_prestamo);
            const todosPrestamo = itemsPrestamo.length > 0 && itemsPrestamo.length === itemsConFallback.length;
            const aunCargando = cargando || (items.length === 0 && tienePrestamos);
            return (
              <div className={`mb-3 rounded-xl border p-3 flex items-start gap-3 ${
                todosPrestamo
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-teal-50 border-teal-200'
              }`}>
                <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${
                  todosPrestamo ? 'bg-emerald-100 text-emerald-700' : 'bg-teal-100 text-teal-700'
                }`}>
                  <Handshake size={14} />
                </div>
                <div className="min-w-0">
                  <p className={`text-[11px] font-black uppercase tracking-wider ${
                    todosPrestamo ? 'text-emerald-700' : 'text-teal-700'
                  }`}>
                    {aunCargando
                      ? 'Despacho con Préstamos'
                      : todosPrestamo
                        ? 'Préstamo Puro'
                        : `Despacho Mixto · ${itemsPrestamo.length} artículo${itemsPrestamo.length !== 1 ? 's' : ''} en préstamo`
                    }
                  </p>
                  <p className={`text-[10px] mt-0.5 leading-snug ${
                    todosPrestamo ? 'text-emerald-600' : 'text-teal-600'
                  }`}>
                    {aunCargando
                      ? 'Este despacho contiene artículos en préstamo.'
                      : todosPrestamo
                        ? 'Todos los artículos son de préstamo. El total financiero es $0,00.'
                        : 'Los artículos marcados con el icono préstamo fueron prestados al cliente y deben ser retornados o facturados.'
                    }
                  </p>
                  {!aunCargando && itemsPrestamo.length > 0 && !todosPrestamo && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {itemsPrestamo.map(it => (
                        <span key={it.id} className="inline-flex items-center gap-1 text-[9px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md">
                          <Handshake size={8} /> {it.nombre_snap} ({it.cantidad} {it.unidad_snap || 'und'})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Package size={12} />Productos
            </p>
            {tipo === 'despacho' && ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) && registro.estado !== 'anulada' && registro.estado !== 'entregada' && (
              <button 
                onClick={() => setShowEditItems(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg text-[11px] font-bold transition-colors">
                <Pencil size={12} />
                Editar Ítems (Admin)
              </button>
            )}
          </div>

          {cargando ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" />Cargando productos...
            </div>
          ) : itemsConFallback.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Sin productos registrados</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="overflow-x-auto hidden sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      <th className="pb-2 text-left pr-3">Producto</th>
                      <th className="pb-2 text-center px-3">Cant.</th>
                      <th className="pb-2 text-right px-3">Precio</th>
                      <th className="pb-2 text-right pl-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsConFallback.map(it => <ItemRow key={it.id} item={it} descuento={descuentos[it.id]} fmt={fmt} config={config} tipo={tipo} perfil={perfil} vendedorPerfil={registro.vendedor} />)}
                  </tbody>
                </table>
              </div>
              {/* Mobile card layout */}
              <div className="sm:hidden">
                {itemsConFallback.map(it => <ItemCard key={it.id} item={it} descuento={descuentos[it.id]} fmt={fmt} config={config} tipo={tipo} perfil={perfil} vendedorPerfil={registro.vendedor} />)}
              </div>
            </>
          )}

          {/* Notas */}
          {notas && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
              <p className="text-[11px] font-bold text-amber-500 uppercase tracking-wider mb-1">Notas</p>
              {notas}
            </div>
          )}

          {/* ── Sección de Seguimiento Operativo (Solo en Despachos) ── */}
          {tipo === 'despacho' && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <MessageSquare size={12} className="text-slate-400" /> Seguimiento Operativo
              </h3>
              <SeguimientoTimeline 
                despachoId={registro.id}
                clienteId={registro.cliente_id || registro.cliente?.id || registro.cliente_factura?.id} 
              />
            </div>
          )}
        </div>

        {/* Totales */}
        {esCot && (
          <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 space-y-1.5 shrink-0">
            {monedaTag && (
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${monedaPdf === 'bcv' ? 'bg-teal-100 text-teal-700' : 'bg-blue-100 text-blue-700'}`}>
                  {monedaTag}
                </span>
                <span className="text-[10px] text-slate-400">
                  {monedaPdf === 'bcv' ? `Factor: ${factorBcv.toFixed(2)}` : `Tasa: ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/$`}
                </span>
              </div>
            )}
            {envio > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Flete / Envío</span><span>{fmt(envio)}</span>
              </div>
            )}
            {corte > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Corte de material</span><span>{fmt(corte)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-slate-800 text-base pt-1 border-t border-slate-200">
              <span>Total</span><span>{fmt(total)}</span>
            </div>
            {monedaPdf !== 'bs' && tasa > 0 && (
              <div className="flex justify-end text-xs text-slate-400">
                <span>{fmtBs(usdToBs(total, tasa))}</span>
              </div>
            )}
          </div>
        )}
        {!esCot && (() => {
          const isPrestamoPuro = itemsConFallback.length > 0 && itemsConFallback.every(it => it.es_prestamo)
          const flete = isPrestamoPuro ? 0 : Number(registro.flete_usd || 0)
          // Usar corte_usd del registro si existe, o sumar ítems detectados como corte
          const corteDesc = isPrestamoPuro ? 0 : (Number(registro.corte_usd || 0) || corteDesdeItems)
          const descuento = isPrestamoPuro ? 0 : Number(registro.descuento_total_usd || 0)
          const totalConServicios = isPrestamoPuro ? 0 : total // total_usd ya incluye el flete y corte
          const subtotal = isPrestamoPuro ? 0 : total - flete - corteDesc // total de productos sin flete ni corte

          const clienteObj = registro.cliente_factura || registro.cliente
          const esPersonal = clienteObj?.tipo_cliente === 'personal'
          const descPersonalPct = esPersonal ? (config.descuento_personal_pct ?? 10.0) : 0

          let subtotalOriginal = subtotal
          let descuentoPersonal = 0

          if (esPersonal && descPersonalPct > 0) {
            let sumOriginal = 0
            itemsConFallback.forEach(it => {
              if (!it.es_prestamo) {
                const cant = Number(it.cantidad || 0)
                const precio = Number(it.precio_unit_usd || 0)
                const precioOrig = Math.round((precio / (1 - descPersonalPct / 100)) * 100) / 100
                sumOriginal += precioOrig * cant
              }
            })
            subtotalOriginal = sumOriginal
            descuentoPersonal = Math.max(0, subtotalOriginal - subtotal)
          }

          const totalFinal = isPrestamoPuro ? 0 : totalConServicios - descuento
          const hayDesglose = !isPrestamoPuro && (descuento > 0 || flete > 0 || corteDesc > 0 || descuentoPersonal > 0)

          return (
          <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 shrink-0 space-y-1.5">
            {hayDesglose && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Subtotal</span><span>{fmtUsd(subtotalOriginal)}</span>
              </div>
            )}
            {descuentoPersonal > 0 && (
              <div className="flex justify-between text-xs text-amber-600">
                <span>Descuento Personal ({descPersonalPct}%)</span><span>-{fmtUsd(descuentoPersonal)}</span>
              </div>
            )}
            {descuento > 0 && (
              <div className="flex justify-between text-xs text-amber-600">
                <span>Descuento</span><span>-{fmtUsd(descuento)}</span>
              </div>
            )}
            {flete > 0 && (
              <div className="flex justify-between text-xs text-emerald-600">
                <span>Flete</span><span>+{fmtUsd(flete)}</span>
              </div>
            )}
            {corteDesc > 0 && (
              <div className="flex justify-between text-xs text-emerald-600">
                <span>Corte</span><span>+{fmtUsd(corteDesc)}</span>
              </div>
            )}
            <div className={`flex justify-between font-black text-slate-800 text-base ${hayDesglose ? 'pt-1 border-t border-slate-200' : ''}`}>
              <span>Total</span><span>{fmtUsd(totalFinal)}</span>
            </div>
            {tasa > 0 && (
              <div className="flex justify-end text-xs text-slate-400">
                <span>{fmtBs(usdToBs(totalFinal, tasa))}</span>
              </div>
            )}
          </div>
          )
        })()}
      </div>

      {tipo === 'despacho' && (
        <EditarItemsDespachoModal 
          isOpen={showEditItems}
          onClose={() => setShowEditItems(false)}
          despacho={registro}
        />
      )}
    </div>
  )
}
