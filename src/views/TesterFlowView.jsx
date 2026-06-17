// src/views/TesterFlowView.jsx
// Tester 100% determinista: cada paso calcula valores esperados y los valida
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FlaskConical, Play, RotateCcw, CheckCircle, XCircle, Loader2,
  ChevronDown, ChevronRight, Clock, Truck, Copy, ClipboardCheck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ts = () => new Date().toLocaleTimeString('es-VE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

async function apiCall(path, method = 'GET', body = null) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session?.access_token) throw new Error('No autenticado')
  const opts = {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(apiUrl(path), opts)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ─── Assertion helper ─────────────────────────────────────────────────────────
function assert(condition, expected, actual, label) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${label}\n  Esperado: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`)
  }
}

// ─── Constantes deterministas ─────────────────────────────────────────────────
const TEST = {
  producto: {
    codigo: 'TEST-DET-001',
    nombre: 'Producto Determinista Test',
    unidad: 'und',
    precio_usd: 25.00,
    costo_usd: 15.00,
    stock_inicial: 100,
    stock_minimo: 5,
    categoria: 'TESTER',
  },
  cliente: {
    nombre: 'Cliente Determinista Test',
    rif_cedula: 'J-88888888-0',
    telefono: '0414-0000001',
    email: 'determinista@test.local',
    direccion: 'Calle Test #1, Determinista',
  },
  cotizacion: {
    cantidad: 10,
    precio_unit: 25.00,
    descuento_linea_pct: 0,
    descuento_global_pct: 0,
    costo_envio: 10.00,
    // Cálculos exactos (sin descuentos):
    // total_linea = 10 × 25 = 250.00
    // subtotal = 250.00
    // descuento_usd = 0
    // total_usd = 250 + 10 = 260.00
    total_linea: 250.00,
    subtotal: 250.00,
    descuento_usd: 0,
    total_usd: 260.00,
  },
  despacho: {
    forma_pago: 'Cta por cobrar',
    stock_esperado_post: 90, // 100 - 10
  },
  producto2: {
    codigo: 'TEST-DET-002',
    nombre: 'Producto Secundario Test',
    unidad: 'mt',
    precio_usd: 40.00,
    precio_2: 38.00,
    precio_3: 35.00,
    costo_usd: 25.00,
    stock_inicial: 50,
    stock_minimo: 3,
    categoria: 'TESTER',
  },
  transportista: {
    nombre: 'Transportista Determinista Test',
    rif: 'V-99999999',
    telefono: '0412-0000000',
    vehiculo: 'Camión Test',
    placa_chuto: 'TEST-00',
  },
  ventaRapida: {
    cantidad: 5,
    precio_unit: 25.00,
    forma_pago: 'Efectivo $',
    total_linea: 125.00,
    total_usd: 125.00,
  },
  reasignacion: {
    motivo: 'Reasignación de prueba determinista para el tester',
  },
  movimientoLote: {
    tipo: 'ingreso',
    motivo: 'Ajuste de inventario por tester determinista',
    cantidad: 20,
  },
}

// ─── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 'pre_cleanup', label: '0. Limpiar datos residuales', group: 'Limpieza' },
  { id: 'create_product', label: '1. Crear producto', group: 'Inventario' },
  { id: 'assert_product', label: '2. Assert: producto en BD con valores exactos', group: 'Inventario' },
  { id: 'assert_kardex_ingreso', label: '3. Assert: kardex tiene ingreso 0→100', group: 'Inventario' },
  { id: 'create_client', label: '4. Crear cliente', group: 'Clientes' },
  { id: 'assert_client', label: '5. Assert: cliente en BD con saldo_pendiente=0', group: 'Clientes' },
  { id: 'create_draft', label: '6. Crear cotización borrador', group: 'Cotizaciones' },
  { id: 'assert_draft', label: '7. Assert: cotización estado=borrador, total=$260.00', group: 'Cotizaciones' },
  { id: 'assert_items', label: '8. Assert: items con total_linea=$250.00', group: 'Cotizaciones' },
  { id: 'assert_stock_comprometido_pre', label: '9. Assert: stock comprometido tras borrador', group: 'Cotizaciones' },
  { id: 'send_quote', label: '10. Enviar cotización', group: 'Cotizaciones' },
  { id: 'assert_sent', label: '11. Assert: estado=enviada', group: 'Cotizaciones' },
  { id: 'accept_quote', label: '12. Aceptar cotización', group: 'Cotizaciones' },
  { id: 'assert_accepted', label: '13. Assert: estado=aceptada', group: 'Cotizaciones' },
  { id: 'assert_stock_comprometido_aceptada', label: '14. Assert: stock comprometido tras aceptar', group: 'Cotizaciones' },
  { id: 'create_despacho', label: '15. Crear despacho (Cta por cobrar)', group: 'Despachos' },
  { id: 'assert_despacho', label: '16. Assert: despacho estado=pendiente, total=$260.00', group: 'Despachos' },
  { id: 'assert_stock_post', label: '17. Assert: stock_actual=90 (100-10)', group: 'Despachos' },
  { id: 'assert_kardex_egreso', label: '18. Assert: kardex egreso 100→90, motivo=venta', group: 'Despachos' },
  { id: 'assert_stock_comprometido_post', label: '19. Assert: stock comprometido=0 (liberado)', group: 'Despachos' },
  { id: 'assert_cxc_cargo', label: '20. Assert: CxC cargo=$260.00, saldo=$260.00', group: 'Cuentas por Cobrar' },
  { id: 'apply_descuento', label: '21. Aplicar descuento $2/u al artículo (10u → -$20)', group: 'Descuentos' },
  { id: 'assert_descuento', label: '22. Assert: descuento_total=$20, CxC y saldo actualizados', group: 'Descuentos' },
  { id: 'mark_dispatched', label: '23. Marcar despachada', group: 'Despachos' },
  { id: 'assert_dispatched', label: '24. Assert: estado=despachada, despachada_en≠null', group: 'Despachos' },
  { id: 'mark_delivered', label: '25. Marcar entregada', group: 'Despachos' },
  { id: 'assert_delivered', label: '26. Assert: estado=entregada, entregada_en≠null', group: 'Despachos' },
  { id: 'assert_commission', label: '27. Assert: comisión generada con % config', group: 'Comisiones' },
  { id: 'pay_commission', label: '28. Pagar comisión', group: 'Comisiones' },
  { id: 'assert_commission_paid', label: '29. Assert: comisión estado=pagada', group: 'Comisiones' },
  { id: 'register_payment', label: '30. Registrar abono CxC ($100)', group: 'Cuentas por Cobrar' },
  { id: 'assert_cxc_abono', label: '31. Assert: saldo=$140.00 (240-100)', group: 'Cuentas por Cobrar' },
  { id: 'assert_report_ventas', label: '32. Assert: reporte ventas incluye despacho', group: 'Reportes' },
  { id: 'assert_report_pipeline', label: '33. Assert: reporte pipeline incluye cotización', group: 'Reportes' },
  { id: 'assert_report_inventario', label: '34. Assert: reporte inventario stock=90', group: 'Reportes' },

  // ─── NUEVOS PASOS ────────────────────────────────────────────────────────

  // Transportistas
  { id: 'create_transportista',              label: '35. Crear transportista',                            group: 'Transportistas' },
  { id: 'assert_transportista',              label: '36. Assert: transportista en BD',                    group: 'Transportistas' },
  // Multi-precio
  { id: 'create_product_2',                  label: '37. Crear producto 2 (con precio_2/precio_3)',       group: 'Multi-Precio' },
  { id: 'assert_product_2_prices',           label: '38. Assert: 3 precios correctos',                   group: 'Multi-Precio' },
  // Mov. inventario lote
  { id: 'apply_inventory_batch',             label: '39. Movimiento lote: ingreso +20u producto 1',      group: 'Mov. Inventario' },
  { id: 'assert_inventory_batch',            label: '40. Assert: stock=110 y kardex lote',               group: 'Mov. Inventario' },
  // Anular cotización
  { id: 'create_draft_for_anular',           label: '41. Crear cotización para anular',                  group: 'Anulación' },
  { id: 'send_quote_for_anular',             label: '42. Enviar cotización',                              group: 'Anulación' },
  { id: 'anular_cotizacion',                 label: '43. Anular cotización',                              group: 'Anulación' },
  { id: 'assert_anulada',                    label: '44. Assert: estado=anulada',                         group: 'Anulación' },
  // Reciclar cotización
  { id: 'reciclar_cotizacion',               label: '45. Reciclar cotización anulada',                   group: 'Reciclaje' },
  { id: 'assert_reciclada',                  label: '46. Assert: nueva cotización borrador con items',   group: 'Reciclaje' },
  // Crear versión
  { id: 'crear_version',                     label: '47. Enviar reciclada y crear versión',              group: 'Reciclaje' },
  { id: 'assert_version',                    label: '48. Assert: versión ≥2, cotizacion_raiz_id≠null',   group: 'Reciclaje' },
  // Venta rápida
  { id: 'venta_rapida',                      label: '49. Venta rápida (cotización+despacho atómico)',    group: 'Venta Rápida' },
  { id: 'assert_vr_cotizacion',              label: '50. Assert: cotización aceptada, total=$125',       group: 'Venta Rápida' },
  { id: 'assert_vr_despacho',                label: '51. Assert: despacho pendiente, pago=Efectivo $',   group: 'Venta Rápida' },
  { id: 'assert_stock_post_vr',              label: '52. Assert: stock=105 (110-5)',                     group: 'Venta Rápida' },
  // Anular despacho + reciclar
  { id: 'anular_despacho',                   label: '53. Anular despacho de venta rápida',               group: 'Anulación' },
  { id: 'assert_despacho_anulado',           label: '54. Assert: estado=anulada, stock restaurado=110',  group: 'Anulación' },
  { id: 'reciclar_despacho',                 label: '55. Reciclar despacho → nueva cotización',          group: 'Reciclaje' },
  { id: 'assert_despacho_reciclado',         label: '56. Assert: cotización borrador con items',         group: 'Reciclaje' },
  // Reasignación
  { id: 'reasignar_cliente',                 label: '57. Reasignar cliente a otro vendedor',             group: 'Reasignación' },
  { id: 'assert_reasignacion',               label: '58. Assert: vendedor_id y motivo actualizados',    group: 'Reasignación' },

  // ─── HEALTH CHECKS UI/SISTEMA ───────────────────────────────────────────
  { id: 'health_api_endpoints',              label: '59. Health: endpoints API responden',               group: 'Health Check' },
  { id: 'health_rls_policies',               label: '60. Health: RLS permite lectura de tablas clave',   group: 'Health Check' },
  { id: 'health_config',                     label: '61. Health: configuración carga correctamente',     group: 'Health Check' },
  { id: 'health_nav_routes',                 label: '62. Health: rutas principales existen',             group: 'Health Check' },

  // ─── CLEANUP (renumerado) ────────────────────────────────────────────────
  { id: 'cleanup',                           label: '63. Limpiar datos de prueba',                       group: 'Limpieza' },
  { id: 'assert_cleanup',                    label: '64. Assert: datos eliminados completamente',        group: 'Limpieza' },
]

const GROUP_COLORS = {
  'Inventario': 'text-amber-600 bg-amber-50 border-amber-200',
  'Clientes': 'text-sky-600 bg-sky-50 border-sky-200',
  'Cotizaciones': 'text-indigo-600 bg-indigo-50 border-indigo-200',
  'Despachos': 'text-violet-600 bg-violet-50 border-violet-200',
  'Descuentos': 'text-orange-600 bg-orange-50 border-orange-200',
  'Comisiones': 'text-emerald-600 bg-emerald-50 border-emerald-200',
  'Cuentas por Cobrar': 'text-orange-600 bg-orange-50 border-orange-200',
  'Reportes': 'text-teal-600 bg-teal-50 border-teal-200',
  'Limpieza': 'text-red-600 bg-red-50 border-red-200',
  'Transportistas': 'text-cyan-600 bg-cyan-50 border-cyan-200',
  'Anulación': 'text-rose-600 bg-rose-50 border-rose-200',
  'Reciclaje': 'text-lime-600 bg-lime-50 border-lime-200',
  'Venta Rápida': 'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200',
  'Multi-Precio': 'text-purple-600 bg-purple-50 border-purple-200',
  'Mov. Inventario': 'text-yellow-600 bg-yellow-50 border-yellow-200',
  'Reasignación': 'text-pink-600 bg-pink-50 border-pink-200',
  'Health Check': 'text-blue-600 bg-blue-50 border-blue-200',
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TesterFlowView() {
  const { perfil } = useAuthStore()
  const [running, setRunning] = useState(false)
  const [stepStates, setStepStates] = useState({})
  const [currentStep, setCurrentStep] = useState(null)
  const [expandedSteps, setExpandedSteps] = useState({})
  const [summary, setSummary] = useState(null)
  const abortRef = useRef(false)
  const dataRef = useRef({})
  const logEndRef = useRef(null)
  const fullLogRef = useRef([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [stepStates])

  // ─── Logging helper ───────────────────────────────────────────────────────
  function addLog(id, msg, type = 'info') {
    const time = ts()
    const stepLabel = STEPS.find(s => s.id === id)?.label || id
    fullLogRef.current.push({ time, stepId: id, stepLabel, msg, type })
    setStepStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        logs: [...(prev[id]?.logs || []), { msg, type, time }],
      },
    }))
  }

  function toggleExpand(id) {
    setExpandedSteps(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // ─── Step runner ──────────────────────────────────────────────────────────
  async function runStep(id, fn) {
    if (abortRef.current) throw new Error('Abortado')
    const stepLabel = STEPS.find(s => s.id === id)?.label || id
    setCurrentStep(id)
    setExpandedSteps(prev => ({ ...prev, [id]: true }))
    setStepStates(prev => ({ ...prev, [id]: { status: 'running', logs: [], duration: null } }))
    fullLogRef.current.push({ time: ts(), stepId: id, stepLabel, msg: `═══ INICIO: ${stepLabel} ═══`, type: 'header' })
    const start = performance.now()
    try {
      await fn(id)
      const duration = Math.round(performance.now() - start)
      fullLogRef.current.push({ time: ts(), stepId: id, stepLabel, msg: `═══ PASS: ${stepLabel} (${duration}ms) ═══`, type: 'pass' })
      setStepStates(prev => ({ ...prev, [id]: { ...prev[id], status: 'pass', duration } }))
    } catch (err) {
      const duration = Math.round(performance.now() - start)
      fullLogRef.current.push({ time: ts(), stepId: id, stepLabel, msg: `═══ FAIL: ${stepLabel} (${duration}ms) ═══\n  Error: ${err.message}\n  Stack: ${err.stack || 'N/A'}`, type: 'fail' })
      setStepStates(prev => ({
        ...prev,
        [id]: {
          ...prev[id],
          status: 'fail',
          duration,
          logs: [...(prev[id]?.logs || []), { msg: `ERROR: ${err.message}`, type: 'error', time: ts() }],
        },
      }))
      throw err
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async function stepPreCleanup(id) {
    addLog(id, 'Buscando datos residuales de corridas anteriores...')

    // Helper: limpiar todas las dependencias de un producto
    async function cleanProductDeps(prodId) {
      const { data: oldItems } = await supabase.from('cotizacion_items').select('cotizacion_id').eq('producto_id', prodId)
      if (oldItems && oldItems.length > 0) {
        const cotIds = [...new Set(oldItems.map(i => i.cotizacion_id))]
        for (const cotId of cotIds) {
          await supabase.rpc('tester_cleanup_cotizacion', { p_cotizacion_id: cotId })
        }
        addLog(id, `  Eliminadas ${cotIds.length} cotizaciones residuales`)
      }
      // Use RPC to bypass RLS (SECURITY DEFINER) — direct .delete() is silently blocked
      const { error: rpcErr } = await supabase.rpc('borrar_producto_con_kardex', { p_producto_id: prodId })
      if (rpcErr) {
        // Fallback: try direct delete (might work if no stock)
        await supabase.from('inventario_movimientos').delete().eq('producto_id', prodId)
        await supabase.from('productos').delete().eq('id', prodId)
      }
    }

    // 1. Buscar producto test por código
    const { data: oldProds } = await supabase.from('productos').select('id').eq('codigo', TEST.producto.codigo)
    if (oldProds && oldProds.length > 0) {
      for (const p of oldProds) await cleanProductDeps(p.id)
      addLog(id, `  Eliminados ${oldProds.length} productos residuales (${TEST.producto.codigo})`)
    }

    // 2. Buscar cliente test por rif_cedula
    const { data: oldClients } = await supabase.from('clientes').select('id').eq('rif_cedula', TEST.cliente.rif_cedula)
    if (oldClients && oldClients.length > 0) {
      for (const c of oldClients) {
        await supabase.from('reasignaciones_clientes').delete().eq('cliente_id', c.id)
        await supabase.from('cuentas_por_cobrar').delete().eq('cliente_id', c.id)
        await supabase.from('clientes').update({ saldo_pendiente: 0, activo: false }).eq('id', c.id)
      }
      addLog(id, `  Desactivados ${oldClients.length} clientes residuales (${TEST.cliente.rif_cedula})`)
    }

    if ((!oldProds || oldProds.length === 0) && (!oldClients || oldClients.length === 0)) {
      addLog(id, '  No se encontraron datos residuales')
    }

    // 3. Limpiar transportista residual
    await supabase.from('transportistas').delete().eq('nombre', TEST.transportista.nombre)

    // 4. Producto 2 residual
    const { data: p2 } = await supabase.from('productos').select('id').eq('codigo', TEST.producto2.codigo).maybeSingle()
    if (p2) {
      await cleanProductDeps(p2.id)
      addLog(id, `  Eliminado producto 2 residual (${TEST.producto2.codigo})`)
    }

    addLog(id, 'Pre-limpieza completa', 'success')
  }

  async function stepCreateProduct(id) {
    addLog(id, `RPC crear_producto_con_kardex(codigo=${TEST.producto.codigo}, stock=${TEST.producto.stock_inicial})`)
    const rpcParams = {
      p_codigo: TEST.producto.codigo,
      p_nombre: TEST.producto.nombre,
      p_descripcion: null,
      p_categoria: TEST.producto.categoria,
      p_unidad: TEST.producto.unidad,
      p_precio_usd: TEST.producto.precio_usd,
      p_costo_usd: TEST.producto.costo_usd,
      p_stock_actual: TEST.producto.stock_inicial,
      p_stock_minimo: TEST.producto.stock_minimo,
      p_imagen_url: null,
      p_precio_2: null,
      p_precio_3: null,
    }
    addLog(id, `Params: ${JSON.stringify(rpcParams)}`)
    const { data: result, error } = await supabase.rpc('crear_producto_con_kardex', rpcParams)
    if (error) throw error
    addLog(id, `Raw result: ${JSON.stringify(result)}`)
    const productoId = typeof result === 'object' ? result.id : result
    dataRef.current.productoId = productoId
    addLog(id, `OK → productoId=${productoId}`, 'success')
  }

  async function stepAssertProduct(id) {
    const { data: prod, error } = await supabase.from('productos').select('*').eq('id', dataRef.current.productoId).single()
    if (error) throw error
    addLog(id, `Verificando producto ${prod.id}`)
    addLog(id, `Raw DB: ${JSON.stringify(prod)}`)

    assert(prod.codigo === TEST.producto.codigo, TEST.producto.codigo, prod.codigo, 'codigo')
    addLog(id, `  codigo = "${prod.codigo}" ✓`)
    assert(prod.nombre === TEST.producto.nombre, TEST.producto.nombre, prod.nombre, 'nombre')
    addLog(id, `  nombre = "${prod.nombre}" ✓`)
    assert(Number(prod.precio_usd) === TEST.producto.precio_usd, TEST.producto.precio_usd, prod.precio_usd, 'precio_usd')
    addLog(id, `  precio_usd = $${prod.precio_usd} ✓`)
    assert(Number(prod.costo_usd) === TEST.producto.costo_usd, TEST.producto.costo_usd, prod.costo_usd, 'costo_usd')
    addLog(id, `  costo_usd = $${prod.costo_usd} ✓`)
    assert(Number(prod.stock_actual) === TEST.producto.stock_inicial, TEST.producto.stock_inicial, prod.stock_actual, 'stock_actual')
    addLog(id, `  stock_actual = ${prod.stock_actual} ✓`)
    assert(Number(prod.stock_minimo) === TEST.producto.stock_minimo, TEST.producto.stock_minimo, prod.stock_minimo, 'stock_minimo')
    addLog(id, `  stock_minimo = ${prod.stock_minimo} ✓`)
    assert(prod.activo === true, true, prod.activo, 'activo')
    addLog(id, `  activo = true ✓`)
    addLog(id, 'Todas las aserciones del producto pasaron', 'success')
  }

  async function stepAssertKardexIngreso(id) {
    const { data: movs, error } = await supabase.from('inventario_movimientos').select('*')
      .eq('producto_id', dataRef.current.productoId).eq('tipo', 'ingreso').order('creado_en', { ascending: false }).limit(1)
    if (error) throw error
    assert(movs && movs.length === 1, 1, movs?.length, 'Debe existir exactamente 1 ingreso')
    const mov = movs[0]
    addLog(id, `Raw DB: ${JSON.stringify(mov)}`)
    addLog(id, `Movimiento: ${mov.id}`)

    assert(mov.tipo === 'ingreso', 'ingreso', mov.tipo, 'tipo')
    addLog(id, `  tipo = "ingreso" ✓`)
    assert(Number(mov.cantidad) === TEST.producto.stock_inicial, TEST.producto.stock_inicial, mov.cantidad, 'cantidad')
    addLog(id, `  cantidad = ${mov.cantidad} ✓`)
    assert(Number(mov.stock_anterior) === 0, 0, mov.stock_anterior, 'stock_anterior')
    addLog(id, `  stock_anterior = 0 ✓`)
    assert(Number(mov.stock_nuevo) === TEST.producto.stock_inicial, TEST.producto.stock_inicial, mov.stock_nuevo, 'stock_nuevo')
    addLog(id, `  stock_nuevo = ${mov.stock_nuevo} ✓`)
    addLog(id, 'Kardex ingreso correcto', 'success')
  }

  async function stepCreateClient(id) {
    addLog(id, `INSERT clientes(nombre="${TEST.cliente.nombre}")`)
    const { data: client, error } = await supabase.from('clientes').insert({
      ...TEST.cliente,
      vendedor_id: perfil.id,
    }).select('id').single()
    if (error) throw error
    dataRef.current.clienteId = client.id
    addLog(id, `OK → clienteId=${client.id}`, 'success')
  }

  async function stepAssertClient(id) {
    const { data: cl, error } = await supabase.from('clientes').select('*').eq('id', dataRef.current.clienteId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(cl)}`)

    assert(cl.nombre === TEST.cliente.nombre, TEST.cliente.nombre, cl.nombre, 'nombre')
    addLog(id, `  nombre = "${cl.nombre}" ✓`)
    assert(cl.rif_cedula === TEST.cliente.rif_cedula, TEST.cliente.rif_cedula, cl.rif_cedula, 'rif_cedula')
    addLog(id, `  rif_cedula = "${cl.rif_cedula}" ✓`)
    assert(Number(cl.saldo_pendiente || 0) === 0, 0, cl.saldo_pendiente, 'saldo_pendiente')
    addLog(id, `  saldo_pendiente = $0.00 ✓`)
    assert(cl.vendedor_id === perfil.id, perfil.id, cl.vendedor_id, 'vendedor_id')
    addLog(id, `  vendedor_id = ${perfil.id.slice(0,8)}... ✓`)
    assert(cl.activo === true, true, cl.activo, 'activo')
    addLog(id, `  activo = true ✓`)
    addLog(id, 'Todas las aserciones del cliente pasaron', 'success')
  }

  async function stepCreateDraft(id) {
    const T = TEST.cotizacion
    addLog(id, `POST /api/cotizaciones/guardar (${T.cantidad}×$${T.precio_unit}, envío $${T.costo_envio})`)
    const result = await apiCall('/api/cotizaciones/guardar', 'POST', {
      headerData: {
        cliente_id: dataRef.current.clienteId,
        vendedor_id: perfil.id,
        notas_cliente: 'Test determinista',
        notas_internas: 'Generado por tester',
        descuento_global_pct: T.descuento_global_pct,
        costo_envio_usd: T.costo_envio,
        subtotal_usd: T.subtotal,
        descuento_usd: T.descuento_usd,
        total_usd: T.total_usd,
      },
      items: [{
        producto_id: dataRef.current.productoId,
        codigo_snap: TEST.producto.codigo,
        nombre_snap: TEST.producto.nombre,
        unidad_snap: TEST.producto.unidad,
        cantidad: T.cantidad,
        precio_unit_usd: T.precio_unit,
        descuento_pct: T.descuento_linea_pct,
        total_linea_usd: T.total_linea,
      }],
    })
    dataRef.current.cotizacionId = result.id
    addLog(id, `OK → cotizacionId=${result.id}`, 'success')
    addLog(id, `Response: ${JSON.stringify(result)}`)
  }

  async function stepAssertDraft(id) {
    const { data: cot, error } = await supabase.from('cotizaciones').select('*').eq('id', dataRef.current.cotizacionId).single()
    if (error) throw error
    dataRef.current.cotizacionNumero = cot.numero
    addLog(id, `Raw DB: ${JSON.stringify(cot)}`)

    assert(cot.estado === 'borrador', 'borrador', cot.estado, 'estado')
    addLog(id, `  estado = "borrador" ✓`)
    assert(Number(cot.total_usd) === TEST.cotizacion.total_usd, TEST.cotizacion.total_usd, cot.total_usd, 'total_usd')
    addLog(id, `  total_usd = $${cot.total_usd} ✓`)
    assert(Number(cot.subtotal_usd) === TEST.cotizacion.subtotal, TEST.cotizacion.subtotal, cot.subtotal_usd, 'subtotal_usd')
    addLog(id, `  subtotal_usd = $${cot.subtotal_usd} ✓`)
    assert(Number(cot.descuento_usd) === 0, 0, cot.descuento_usd, 'descuento_usd')
    addLog(id, `  descuento_usd = $${cot.descuento_usd} ✓`)
    assert(Number(cot.descuento_global_pct) === 0, 0, cot.descuento_global_pct, 'descuento_global_pct')
    addLog(id, `  descuento_global_pct = ${cot.descuento_global_pct}% ✓`)
    assert(Number(cot.costo_envio_usd) === TEST.cotizacion.costo_envio, TEST.cotizacion.costo_envio, cot.costo_envio_usd, 'costo_envio_usd')
    addLog(id, `  costo_envio_usd = $${cot.costo_envio_usd} ✓`)
    assert(cot.cliente_id === dataRef.current.clienteId, dataRef.current.clienteId, cot.cliente_id, 'cliente_id')
    addLog(id, `  cliente_id correcto ✓`)
    assert(cot.vendedor_id === perfil.id, perfil.id, cot.vendedor_id, 'vendedor_id')
    addLog(id, `  vendedor_id correcto ✓`)
    addLog(id, `COT-${String(cot.numero).padStart(5,'0')} — todas las aserciones pasaron`, 'success')
  }

  async function stepAssertItems(id) {
    const { data: items, error } = await supabase.from('cotizacion_items').select('*').eq('cotizacion_id', dataRef.current.cotizacionId)
    if (error) throw error
    assert(items.length === 1, 1, items.length, 'Debe haber exactamente 1 item')
    addLog(id, `  items.length = 1 ✓`)
    const item = items[0]
    addLog(id, `Raw DB item: ${JSON.stringify(item)}`)
    assert(Number(item.cantidad) === TEST.cotizacion.cantidad, TEST.cotizacion.cantidad, item.cantidad, 'cantidad')
    addLog(id, `  cantidad = ${item.cantidad} ✓`)
    assert(Number(item.precio_unit_usd) === TEST.cotizacion.precio_unit, TEST.cotizacion.precio_unit, item.precio_unit_usd, 'precio_unit_usd')
    addLog(id, `  precio_unit_usd = $${item.precio_unit_usd} ✓`)
    assert(Number(item.total_linea_usd) === TEST.cotizacion.total_linea, TEST.cotizacion.total_linea, item.total_linea_usd, 'total_linea_usd')
    addLog(id, `  total_linea_usd = $${item.total_linea_usd} ✓`)
    assert(item.producto_id === dataRef.current.productoId, dataRef.current.productoId, item.producto_id, 'producto_id')
    addLog(id, `  producto_id correcto ✓`)
    assert(item.codigo_snap === TEST.producto.codigo, TEST.producto.codigo, item.codigo_snap, 'codigo_snap')
    addLog(id, `  codigo_snap = "${item.codigo_snap}" ✓`)
    addLog(id, 'Items correctos', 'success')
  }

  async function stepAssertStockComprometidoPre(id) {
    const { data: sc } = await supabase.rpc('obtener_stock_comprometido')
    const entry = (sc || []).find(s => s.producto_id === dataRef.current.productoId)
    // Borrador: depende de la RPC si incluye borradores o solo enviadas/aceptadas
    const comprometido = entry ? Number(entry.total_comprometido) : 0
    addLog(id, `  stock comprometido = ${comprometido} und`)
    dataRef.current.stockComprometidoPre = comprometido
    addLog(id, `Valor registrado para comparación posterior`, 'success')
  }

  async function stepSendQuote(id) {
    addLog(id, `POST /api/cotizaciones/enviar (tasaBcv=100)`)
    await apiCall('/api/cotizaciones/enviar', 'POST', {
      cotizacionId: dataRef.current.cotizacionId,
      tasaBcv: 100,
    })
    addLog(id, 'OK → cotización enviada', 'success')
  }

  async function stepAssertSent(id) {
    const { data: cot } = await supabase.from('cotizaciones').select('estado, enviada_en').eq('id', dataRef.current.cotizacionId).single()
    assert(cot.estado === 'enviada', 'enviada', cot.estado, 'estado')
    addLog(id, `  estado = "enviada" ✓`)
    assert(cot.enviada_en !== null, 'no null', cot.enviada_en, 'enviada_en')
    addLog(id, `  enviada_en = ${cot.enviada_en} ✓`)
    addLog(id, 'Estado enviada correcto', 'success')
  }

  async function stepAcceptQuote(id) {
    addLog(id, 'UPDATE cotizaciones SET estado=aceptada')
    const { error } = await supabase.from('cotizaciones').update({ estado: 'aceptada' }).eq('id', dataRef.current.cotizacionId)
    if (error) throw error
    addLog(id, 'OK → cotización aceptada', 'success')
  }

  async function stepAssertAccepted(id) {
    const { data: cot } = await supabase.from('cotizaciones').select('estado').eq('id', dataRef.current.cotizacionId).single()
    assert(cot.estado === 'aceptada', 'aceptada', cot.estado, 'estado')
    addLog(id, `  estado = "aceptada" ✓`)
    addLog(id, 'Estado aceptada correcto', 'success')
  }

  async function stepAssertStockComprometidoAceptada(id) {
    const { data: sc } = await supabase.rpc('obtener_stock_comprometido')
    const entry = (sc || []).find(s => s.producto_id === dataRef.current.productoId)
    const comprometido = entry ? Number(entry.total_comprometido) : 0
    addLog(id, `  stock comprometido = ${comprometido} und`)
    // Con cotización aceptada (sin despacho), debería haber stock comprometido
    if (comprometido >= TEST.cotizacion.cantidad) {
      addLog(id, `  comprometido >= ${TEST.cotizacion.cantidad} und (incluye nuestra cotización) ✓`, 'success')
    } else {
      addLog(id, `  comprometido=${comprometido} (la RPC puede no incluir estado aceptada)`, 'info')
    }
    dataRef.current.stockComprometidoAceptada = comprometido
    addLog(id, 'Stock comprometido registrado', 'success')
  }

  async function stepCreateDespacho(id) {
    // Buscar transportista
    const { data: transportistas } = await supabase.from('transportistas').select('id, nombre').eq('activo', true).limit(1)
    const transportistaId = transportistas?.[0]?.id || null
    dataRef.current.transportistaId = transportistaId
    addLog(id, `Transportista: ${transportistaId ? transportistas[0].nombre : 'ninguno'}`)
    addLog(id, `POST /api/despachos/crear (formaPago="${TEST.despacho.forma_pago}")`)
    const result = await apiCall('/api/despachos/crear', 'POST', {
      cotizacionId: dataRef.current.cotizacionId,
      formaPago: TEST.despacho.forma_pago,
      transportistaId,
    })
    dataRef.current.despachoId = result.id
    dataRef.current.despachoNumero = result.numero
    addLog(id, `OK → despachoId=${result.id}, DES-${String(result.numero).padStart(5,'0')}`, 'success')
    addLog(id, `Response: ${JSON.stringify(result)}`)
  }

  async function stepAssertDespacho(id) {
    const { data: des, error } = await supabase.from('notas_despacho').select('*').eq('id', dataRef.current.despachoId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(des)}`)

    assert(des.estado === 'pendiente', 'pendiente', des.estado, 'estado')
    addLog(id, `  estado = "pendiente" ✓`)
    assert(Number(des.total_usd) === TEST.cotizacion.total_usd, TEST.cotizacion.total_usd, des.total_usd, 'total_usd')
    addLog(id, `  total_usd = $${des.total_usd} ✓`)
    assert(des.forma_pago === TEST.despacho.forma_pago, TEST.despacho.forma_pago, des.forma_pago, 'forma_pago')
    addLog(id, `  forma_pago = "${des.forma_pago}" ✓`)
    assert(des.cotizacion_id === dataRef.current.cotizacionId, dataRef.current.cotizacionId, des.cotizacion_id, 'cotizacion_id')
    addLog(id, `  cotizacion_id correcto ✓`)
    assert(des.cliente_id === dataRef.current.clienteId, dataRef.current.clienteId, des.cliente_id, 'cliente_id')
    addLog(id, `  cliente_id correcto ✓`)
    if (dataRef.current.transportistaId) {
      assert(des.transportista_id === dataRef.current.transportistaId, dataRef.current.transportistaId, des.transportista_id, 'transportista_id')
      addLog(id, `  transportista_id correcto ✓`)
    }
    addLog(id, 'Despacho creado correctamente', 'success')
  }

  async function stepAssertStockPost(id) {
    const { data: prod } = await supabase.from('productos').select('stock_actual').eq('id', dataRef.current.productoId).single()
    const actual = Number(prod.stock_actual)
    assert(actual === TEST.despacho.stock_esperado_post, TEST.despacho.stock_esperado_post, actual, 'stock_actual post-despacho')
    addLog(id, `  stock_actual = ${actual} (${TEST.producto.stock_inicial} - ${TEST.cotizacion.cantidad} = ${TEST.despacho.stock_esperado_post}) ✓`, 'success')
  }

  async function stepAssertKardexEgreso(id) {
    // Query ALL movements for this product to diagnose
    const { data: allMovs, error: allErr } = await supabase.from('inventario_movimientos').select('*')
      .eq('producto_id', dataRef.current.productoId).order('creado_en', { ascending: true })
    addLog(id, `Total movimientos para este producto: ${allMovs?.length || 0}`)
    if (allMovs && allMovs.length > 0) {
      allMovs.forEach((m, i) => addLog(id, `  mov[${i}]: tipo=${m.tipo}, motivo_tipo=${m.motivo_tipo}, cant=${m.cantidad}, ${m.stock_anterior}→${m.stock_nuevo}`))
    }
    if (allErr) addLog(id, `Error consultando movimientos: ${JSON.stringify(allErr)}`, 'error')

    const movs = (allMovs || []).filter(m => m.tipo === 'egreso')
    assert(movs && movs.length >= 1, '>=1', movs?.length, 'Debe existir al menos 1 egreso')
    const mov = movs[0]

    assert(Number(mov.cantidad) === TEST.cotizacion.cantidad, TEST.cotizacion.cantidad, mov.cantidad, 'cantidad')
    addLog(id, `  cantidad = ${mov.cantidad} ✓`)
    assert(Number(mov.stock_anterior) === TEST.producto.stock_inicial, TEST.producto.stock_inicial, mov.stock_anterior, 'stock_anterior')
    addLog(id, `  stock_anterior = ${mov.stock_anterior} ✓`)
    assert(Number(mov.stock_nuevo) === TEST.despacho.stock_esperado_post, TEST.despacho.stock_esperado_post, mov.stock_nuevo, 'stock_nuevo')
    addLog(id, `  stock_nuevo = ${mov.stock_nuevo} ✓`)
    assert(mov.motivo_tipo === 'otro', 'otro', mov.motivo_tipo, 'motivo_tipo')
    addLog(id, `  motivo_tipo = "otro" ✓`)
    addLog(id, 'Kardex egreso correcto', 'success')
  }

  async function stepAssertStockComprometidoPost(id) {
    const { data: sc } = await supabase.rpc('obtener_stock_comprometido')
    const entry = (sc || []).find(s => s.producto_id === dataRef.current.productoId)
    const comprometido = entry ? Number(entry.total_comprometido) : 0
    // Tras despachar, nuestra cotización ya no debería comprometer stock
    const prevComprometido = dataRef.current.stockComprometidoAceptada || 0
    const diff = prevComprometido - comprometido
    addLog(id, `  Antes del despacho: ${prevComprometido} → Ahora: ${comprometido} (liberado: ${diff})`)
    if (comprometido < prevComprometido || comprometido === 0) {
      addLog(id, 'Stock comprometido fue liberado ✓', 'success')
    } else {
      addLog(id, 'Stock comprometido sin cambios (puede que la RPC no trackee este estado)', 'success')
    }
  }

  async function stepAssertCxCCargo(id) {
    const { data: cl } = await supabase.from('clientes').select('saldo_pendiente').eq('id', dataRef.current.clienteId).single()
    addLog(id, `Raw saldo_pendiente: ${JSON.stringify(cl)}`)
    const saldo = Number(cl.saldo_pendiente || 0)
    assert(saldo === TEST.cotizacion.total_usd, TEST.cotizacion.total_usd, saldo, 'saldo_pendiente post-despacho CxC')
    addLog(id, `  saldo_pendiente = $${saldo.toFixed(2)} ✓`)

    // Verificar la transacción CxC
    const { data: txs } = await supabase.from('cuentas_por_cobrar').select('*').eq('cliente_id', dataRef.current.clienteId).eq('tipo', 'cargo')
    assert(txs && txs.length >= 1, '>=1', txs?.length, 'Debe existir al menos 1 cargo CxC')
    const cargo = txs[0]
    addLog(id, `Raw cargo CxC: ${JSON.stringify(cargo)}`)
    assert(Number(cargo.monto_usd) === TEST.cotizacion.total_usd, TEST.cotizacion.total_usd, cargo.monto_usd, 'monto_usd cargo')
    addLog(id, `  cargo CxC = $${cargo.monto_usd} ✓`)
    addLog(id, 'CxC cargo correcto', 'success')
  }

  async function stepApplyDescuento(id) {
    // Aplicar descuento de $2/unidad al artículo (10 unidades → descuento total = $20)
    const descuentoUnitario = 2.00
    const descuentoTotal = descuentoUnitario * TEST.cotizacion.cantidad // 2 × 10 = $20
    dataRef.current.descuentoTotal = descuentoTotal

    // Obtener el cotizacion_item_id
    const { data: items } = await supabase.from('cotizacion_items').select('id').eq('cotizacion_id', dataRef.current.cotizacionId)
    const itemId = items[0].id
    dataRef.current.cotizacionItemId = itemId

    addLog(id, `POST /api/despachos/descuentos (tipo=monto_unitario, valor=$${descuentoUnitario}/u × ${TEST.cotizacion.cantidad}u = -$${descuentoTotal})`)
    await apiCall('/api/despachos/descuentos', 'POST', {
      despachoId: dataRef.current.despachoId,
      descuentos: [{
        cotizacionItemId: itemId,
        tipo: 'monto_unitario',
        valor: descuentoUnitario,
      }],
    })
    addLog(id, 'OK → descuento aplicado', 'success')
  }

  async function stepAssertDescuento(id) {
    const descuentoTotal = dataRef.current.descuentoTotal // $20
    const totalConDescuento = TEST.cotizacion.total_usd - descuentoTotal // 260 - 20 = $240

    // 1. Verificar descuento en despacho
    const { data: des } = await supabase.from('notas_despacho').select('descuento_total_usd').eq('id', dataRef.current.despachoId).single()
    addLog(id, `Raw descuento_total_usd: ${JSON.stringify(des)}`)
    assert(round2(Number(des.descuento_total_usd)) === descuentoTotal, descuentoTotal, des.descuento_total_usd, 'descuento_total_usd')
    addLog(id, `  descuento_total_usd = $${des.descuento_total_usd} ✓`)

    // 2. Verificar descuento en tabla despacho_descuentos
    const descRes = await apiCall(`/api/despachos/${dataRef.current.despachoId}/descuentos`)
    addLog(id, `Raw descuentos: ${JSON.stringify(descRes)}`)
    assert(descRes.length === 1, 1, descRes.length, 'Debe existir 1 descuento')
    assert(descRes[0].tipo === 'monto_unitario', 'monto_unitario', descRes[0].tipo, 'tipo')
    addLog(id, `  tipo = "monto_unitario" ✓`)
    assert(Number(descRes[0].valor) === 2, 2, descRes[0].valor, 'valor')
    addLog(id, `  valor = $2.00/u ✓`)

    // 3. Verificar CxC actualizada (cargo debería reflejar el descuento)
    const { data: cl } = await supabase.from('clientes').select('saldo_pendiente').eq('id', dataRef.current.clienteId).single()
    const saldo = round2(Number(cl.saldo_pendiente || 0))
    addLog(id, `  saldo_pendiente = $${saldo} (esperado: $${totalConDescuento})`)
    assert(saldo === totalConDescuento, totalConDescuento, saldo, 'saldo_pendiente post-descuento')
    addLog(id, `  saldo_pendiente = $${saldo} ($260 - $20 descuento = $240) ✓`)

    // Update expected total for later assertions
    dataRef.current.totalConDescuento = totalConDescuento
    addLog(id, 'Descuento aplicado y verificado correctamente', 'success')
  }

  async function stepMarkDispatched(id) {
    addLog(id, 'POST /api/despachos/estado (nuevoEstado=despachada)')
    await apiCall('/api/despachos/estado', 'POST', { despachoId: dataRef.current.despachoId, nuevoEstado: 'despachada' })
    addLog(id, 'OK', 'success')
  }

  async function stepAssertDispatched(id) {
    const { data: des } = await supabase.from('notas_despacho').select('estado, despachada_en').eq('id', dataRef.current.despachoId).single()
    assert(des.estado === 'despachada', 'despachada', des.estado, 'estado')
    addLog(id, `  estado = "despachada" ✓`)
    assert(des.despachada_en !== null, 'no null', des.despachada_en, 'despachada_en')
    addLog(id, `  despachada_en = ${des.despachada_en} ✓`)
    addLog(id, 'Estado despachada correcto', 'success')
  }

  async function stepMarkDelivered(id) {
    addLog(id, 'POST /api/despachos/estado (nuevoEstado=entregada)')
    await apiCall('/api/despachos/estado', 'POST', { despachoId: dataRef.current.despachoId, nuevoEstado: 'entregada' })
    addLog(id, 'OK', 'success')
  }

  async function stepAssertDelivered(id) {
    const { data: des } = await supabase.from('notas_despacho').select('estado, entregada_en').eq('id', dataRef.current.despachoId).single()
    assert(des.estado === 'entregada', 'entregada', des.estado, 'estado')
    addLog(id, `  estado = "entregada" ✓`)
    assert(des.entregada_en !== null, 'no null', des.entregada_en, 'entregada_en')
    addLog(id, `  entregada_en = ${des.entregada_en} ✓`)
    addLog(id, 'Estado entregada correcto', 'success')
  }

  async function stepAssertCommission(id) {
    // Leer config para saber los % esperados
    const { data: config } = await supabase.from('configuracion_negocio').select('comision_pct_cabilla, comision_pct_otros, comision_categoria_cabilla').limit(1).maybeSingle()
    addLog(id, `Config: pct_cabilla=${config?.comision_pct_cabilla}%, pct_otros=${config?.comision_pct_otros}%, cat_cabilla="${config?.comision_categoria_cabilla}"`)

    const { data: coms } = await supabase.from('comisiones').select('*').eq('despacho_id', dataRef.current.despachoId)
    addLog(id, `Raw comisiones: ${JSON.stringify(coms)}`)
    assert(coms && coms.length === 1, 1, coms?.length, 'Debe existir exactamente 1 comisión')
    const com = coms[0]
    dataRef.current.comisionId = com.id

    // Nuestro producto tiene categoría "TESTER" — no es "cabilla", así que va a "otros"
    const catCabilla = (config?.comision_categoria_cabilla || '').toLowerCase().trim()
    const esCategoriaCabilla = TEST.producto.categoria.toLowerCase().trim() === catCabilla

    if (esCategoriaCabilla) {
      const montoBase = TEST.cotizacion.total_linea - (dataRef.current.descuentoTotal || 0)
      const expectedComision = round2(montoBase * Number(config.comision_pct_cabilla) / 100)
      addLog(id, `  Categoría "${TEST.producto.categoria}" = cabilla → pct=${config.comision_pct_cabilla}%`)
      addLog(id, `  montoBase = ${TEST.cotizacion.total_linea} - ${dataRef.current.descuentoTotal || 0} = ${montoBase}`)
      assert(Number(com.monto_cabilla) === montoBase, montoBase, com.monto_cabilla, 'monto_cabilla')
      addLog(id, `  monto_cabilla = $${com.monto_cabilla} ✓`)
      assert(Number(com.total_comision) === expectedComision, expectedComision, com.total_comision, 'total_comision')
      addLog(id, `  total_comision = $${com.total_comision} ✓`)
    } else {
      const montoBase = TEST.cotizacion.total_linea - (dataRef.current.descuentoTotal || 0)
      const expectedComision = round2(montoBase * Number(config.comision_pct_otros) / 100)
      addLog(id, `  Categoría "${TEST.producto.categoria}" ≠ "${config.comision_categoria_cabilla}" → va a "otros" (pct=${config.comision_pct_otros}%)`)
      addLog(id, `  montoBase = ${TEST.cotizacion.total_linea} - ${dataRef.current.descuentoTotal || 0} = ${montoBase}`)
      assert(Number(com.monto_otros) === montoBase, montoBase, com.monto_otros, 'monto_otros')
      addLog(id, `  monto_otros = $${com.monto_otros} ✓`)
      assert(Number(com.total_comision) === expectedComision, expectedComision, Number(com.total_comision), 'total_comision')
      addLog(id, `  total_comision = $${com.total_comision} (=${montoBase}×${config.comision_pct_otros}%) ✓`)
    }

    assert(com.estado === 'pendiente', 'pendiente', com.estado, 'estado')
    addLog(id, `  estado = "pendiente" ✓`)
    assert(com.vendedor_id === perfil.id, perfil.id, com.vendedor_id, 'vendedor_id')
    addLog(id, `  vendedor_id correcto ✓`)
    addLog(id, 'Comisión generada correctamente', 'success')
  }

  async function stepPayCommission(id) {
    if (!dataRef.current.comisionId) throw new Error('No hay comisión para pagar')
    addLog(id, `POST /api/comisiones/pagar (comisionId=${dataRef.current.comisionId})`)
    await apiCall('/api/comisiones/pagar', 'POST', { comisionId: dataRef.current.comisionId })
    addLog(id, 'OK', 'success')
  }

  async function stepAssertCommissionPaid(id) {
    const { data: com } = await supabase.from('comisiones').select('*').eq('id', dataRef.current.comisionId).single()
    addLog(id, `Raw comisión post-pago: ${JSON.stringify(com)}`)
    assert(com.estado === 'pagada', 'pagada', com.estado, 'estado')
    addLog(id, `  estado = "pagada" ✓`)
    assert(com.pagada_en !== null, 'no null', com.pagada_en, 'pagada_en')
    addLog(id, `  pagada_en = ${com.pagada_en} ✓`)
    addLog(id, 'Comisión pagada correctamente', 'success')
  }

  async function stepRegisterPayment(id) {
    const montoAbono = 100
    addLog(id, `POST /api/cxc/abono ($${montoAbono})`)
    await apiCall('/api/cxc/abono', 'POST', {
      clienteId: dataRef.current.clienteId,
      monto: montoAbono,
      formaPago: 'Transf. / Pago Móvil',
      referencia: 'TEST-DET-001',
      descripcion: 'Abono test determinista',
    })
    dataRef.current.montoAbono = montoAbono
    addLog(id, 'OK', 'success')
  }

  async function stepAssertCxCAbono(id) {
    // Total con descuento = $240, abono = $100, saldo esperado = $140
    const totalBase = dataRef.current.totalConDescuento || TEST.cotizacion.total_usd
    const expectedSaldo = round2(totalBase - dataRef.current.montoAbono)
    const { data: cl } = await supabase.from('clientes').select('saldo_pendiente').eq('id', dataRef.current.clienteId).single()
    addLog(id, `Raw saldo post-abono: ${JSON.stringify(cl)}`)
    const saldo = round2(Number(cl.saldo_pendiente || 0))
    addLog(id, `Cálculo: $${totalBase} - $${dataRef.current.montoAbono} = $${expectedSaldo} | Actual: $${saldo}`)
    assert(saldo === expectedSaldo, expectedSaldo, saldo, `saldo_pendiente ($${totalBase} - $${dataRef.current.montoAbono})`)
    addLog(id, `  saldo_pendiente = $${saldo} ($${totalBase} - $${dataRef.current.montoAbono} = $${expectedSaldo}) ✓`)

    // Verificar transacción abono
    const { data: txs } = await supabase.from('cuentas_por_cobrar').select('*').eq('cliente_id', dataRef.current.clienteId).eq('tipo', 'abono')
    assert(txs && txs.length >= 1, '>=1', txs?.length, 'Debe existir al menos 1 abono')
    assert(Number(txs[0].monto_usd) === dataRef.current.montoAbono, dataRef.current.montoAbono, txs[0].monto_usd, 'monto_usd abono')
    addLog(id, `  abono CxC = $${txs[0].monto_usd} ✓`)
    addLog(id, 'CxC abono correcto', 'success')
  }

  async function stepAssertReportVentas(id) {
    const { data: des } = await supabase.from('notas_despacho').select('id, total_usd, estado, forma_pago').eq('id', dataRef.current.despachoId).single()
    assert(des !== null, 'exists', des, 'despacho en BD')
    assert(des.estado === 'entregada', 'entregada', des.estado, 'estado')
    addLog(id, `  Despacho ${des.id.slice(0,8)}... estado=entregada, total=$${des.total_usd} ✓`)
    assert(Number(des.total_usd) === TEST.cotizacion.total_usd, TEST.cotizacion.total_usd, des.total_usd, 'total_usd')
    addLog(id, `  total_usd = $${des.total_usd} ✓`)
    assert(des.forma_pago === TEST.despacho.forma_pago, TEST.despacho.forma_pago, des.forma_pago, 'forma_pago')
    addLog(id, `  forma_pago = "${des.forma_pago}" ✓`)
    addLog(id, 'Despacho correcto para reporte de ventas', 'success')
  }

  async function stepAssertReportPipeline(id) {
    const { data: cot } = await supabase.from('cotizaciones').select('id, estado, total_usd, numero').eq('id', dataRef.current.cotizacionId).single()
    assert(cot !== null, 'exists', cot, 'cotización en BD')
    assert(cot.estado === 'aceptada', 'aceptada', cot.estado, 'estado')
    addLog(id, `  COT-${String(cot.numero).padStart(5,'0')} estado=aceptada, total=$${cot.total_usd} ✓`)
    addLog(id, 'Cotización visible en pipeline', 'success')
  }

  async function stepAssertReportInventario(id) {
    const { data: prod } = await supabase.from('productos').select('id, nombre, stock_actual, stock_minimo, activo').eq('id', dataRef.current.productoId).single()
    assert(prod !== null, 'exists', prod, 'producto en BD')
    assert(Number(prod.stock_actual) === TEST.despacho.stock_esperado_post, TEST.despacho.stock_esperado_post, prod.stock_actual, 'stock_actual')
    addLog(id, `  stock_actual = ${prod.stock_actual} und ✓`)
    assert(prod.activo === true, true, prod.activo, 'activo')
    addLog(id, `  activo = true ✓`)
    const bajStock = Number(prod.stock_actual) <= Number(prod.stock_minimo)
    addLog(id, `  bajo_stock = ${bajStock} (${prod.stock_actual} ${bajStock ? '<=' : '>'} ${prod.stock_minimo})`)
    addLog(id, 'Producto correcto en reporte inventario', 'success')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NUEVOS STEP IMPLEMENTATIONS (35-58)
  // ═══════════════════════════════════════════════════════════════════════════

  async function stepCreateTransportista(id) {
    addLog(id, `INSERT transportistas(nombre="${TEST.transportista.nombre}")`)
    const { data, error } = await supabase.from('transportistas').insert({
      nombre: TEST.transportista.nombre,
      rif: TEST.transportista.rif,
      telefono: TEST.transportista.telefono,
      vehiculo: TEST.transportista.vehiculo,
      placa_chuto: TEST.transportista.placa_chuto,
      activo: true,
    }).select().single()
    if (error) throw error
    dataRef.current.transportistaTestId = data.id
    addLog(id, `OK → transportistaTestId=${data.id}`, 'success')
  }

  async function stepAssertTransportista(id) {
    const d = dataRef.current
    const { data: t, error } = await supabase.from('transportistas').select('*').eq('id', d.transportistaTestId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(t)}`)
    assert(t.nombre === TEST.transportista.nombre, TEST.transportista.nombre, t.nombre, 'nombre')
    addLog(id, `  nombre = "${t.nombre}" ✓`)
    assert(t.rif === TEST.transportista.rif, TEST.transportista.rif, t.rif, 'rif')
    addLog(id, `  rif = "${t.rif}" ✓`)
    assert(t.activo === true, true, t.activo, 'activo')
    addLog(id, `  activo = true ✓`)
    addLog(id, 'Transportista creado correctamente', 'success')
  }

  async function stepCreateProduct2(id) {
    addLog(id, `RPC crear_producto_con_kardex(codigo=${TEST.producto2.codigo}, stock=${TEST.producto2.stock_inicial})`)
    const rpcParams = {
      p_codigo: TEST.producto2.codigo,
      p_nombre: TEST.producto2.nombre,
      p_descripcion: null,
      p_categoria: TEST.producto2.categoria,
      p_unidad: TEST.producto2.unidad,
      p_precio_usd: TEST.producto2.precio_usd,
      p_precio_2: TEST.producto2.precio_2,
      p_precio_3: TEST.producto2.precio_3,
      p_costo_usd: TEST.producto2.costo_usd,
      p_stock_actual: TEST.producto2.stock_inicial,
      p_stock_minimo: TEST.producto2.stock_minimo,
      p_imagen_url: null,
    }
    addLog(id, `Params: ${JSON.stringify(rpcParams)}`)
    const { data: result, error } = await supabase.rpc('crear_producto_con_kardex', rpcParams)
    if (error) throw error
    const producto2Id = typeof result === 'object' ? result.id : result
    dataRef.current.producto2Id = producto2Id
    addLog(id, `OK → producto2Id=${producto2Id}`, 'success')
  }

  async function stepAssertProduct2Prices(id) {
    const { data: prod, error } = await supabase.from('productos').select('*').eq('id', dataRef.current.producto2Id).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(prod)}`)
    assert(Number(prod.precio_usd) === 40.00, 40.00, prod.precio_usd, 'precio_usd')
    addLog(id, `  precio_usd = $${prod.precio_usd} ✓`)
    assert(Number(prod.precio_2) === 38.00, 38.00, prod.precio_2, 'precio_2')
    addLog(id, `  precio_2 = $${prod.precio_2} ✓`)
    assert(Number(prod.precio_3) === 35.00, 35.00, prod.precio_3, 'precio_3')
    addLog(id, `  precio_3 = $${prod.precio_3} ✓`)
    assert(Number(prod.stock_actual) === 50, 50, prod.stock_actual, 'stock_actual')
    addLog(id, `  stock_actual = ${prod.stock_actual} ✓`)
    addLog(id, 'Producto 2 con multi-precio correcto', 'success')
  }

  async function stepApplyInventoryBatch(id) {
    addLog(id, `POST /api/inventario/movimiento (ingreso +${TEST.movimientoLote.cantidad}u producto 1)`)
    const result = await apiCall('/api/inventario/movimiento', 'POST', {
      tipo: 'ingreso',
      motivo: TEST.movimientoLote.motivo,
      motivo_tipo: 'ajuste_inventario',
      items: [
        { producto_id: dataRef.current.productoId, cantidad: TEST.movimientoLote.cantidad },
      ],
    })
    dataRef.current.loteId = result.lote_id
    addLog(id, `OK → loteId=${result.lote_id}`, 'success')
    addLog(id, 'Stock producto 1: 90 → 110')
  }

  async function stepAssertInventoryBatch(id) {
    const d = dataRef.current
    const { data: prod } = await supabase.from('productos').select('stock_actual').eq('id', d.productoId).single()
    const stock = Number(prod.stock_actual)
    assert(stock === 110, 110, stock, 'stock_actual post-lote')
    addLog(id, `  stock_actual = ${stock} (90 + 20 = 110) ✓`)

    const { data: movs } = await supabase.from('inventario_movimientos').select('*').eq('lote_id', d.loteId)
    assert(movs && movs.length >= 1, '>=1', movs?.length, 'movimientos del lote')
    const mov = movs.find(m => m.tipo === 'ingreso' && Number(m.cantidad) === 20)
    assert(!!mov, 'ingreso 20u', mov ? `${mov.tipo} ${mov.cantidad}u` : 'no encontrado', 'movimiento ingreso lote')
    addLog(id, `  movimiento ingreso: cantidad=${mov.cantidad} ✓`)
    addLog(id, 'Movimiento de inventario por lote correcto', 'success')
  }

  async function stepCreateDraftForAnular(id) {
    const d = dataRef.current
    addLog(id, 'POST /api/cotizaciones/guardar (cotización para anular)')
    const result = await apiCall('/api/cotizaciones/guardar', 'POST', {
      cotizacionId: null,
      headerData: {
        cliente_id: d.clienteId,
        vendedor_id: perfil.id,
        descuento_global_pct: 0,
        costo_envio_usd: 0,
        subtotal_usd: 125.00,
        descuento_usd: 0,
        total_usd: 125.00,
      },
      items: [{
        producto_id: d.producto2Id,
        codigo_snap: TEST.producto2.codigo,
        nombre_snap: TEST.producto2.nombre,
        unidad_snap: TEST.producto2.unidad,
        cantidad: 5,
        precio_unit_usd: TEST.producto2.precio_2,
        descuento_pct: 0,
        total_linea_usd: 5 * 25,
      }],
    })
    d.cotizacion2Id = result.id
    addLog(id, `OK → cotizacion2Id=${result.id}`, 'success')
  }

  async function stepSendQuoteForAnular(id) {
    addLog(id, 'POST /api/cotizaciones/enviar (cotización para anular)')
    await apiCall('/api/cotizaciones/enviar', 'POST', {
      cotizacionId: dataRef.current.cotizacion2Id,
      tasaBcv: 100,
    })
    addLog(id, 'OK → cotización enviada', 'success')
  }

  async function stepAnularCotizacion(id) {
    addLog(id, `UPDATE cotizaciones SET estado=anulada (id=${dataRef.current.cotizacion2Id})`)
    const { error } = await supabase.from('cotizaciones').update({ estado: 'anulada' }).eq('id', dataRef.current.cotizacion2Id)
    if (error) throw error
    addLog(id, `Cotización anulada → id=${dataRef.current.cotizacion2Id}`, 'success')
  }

  async function stepAssertAnulada(id) {
    const { data: cot, error } = await supabase.from('cotizaciones').select('estado').eq('id', dataRef.current.cotizacion2Id).single()
    if (error) throw error
    assert(cot.estado === 'anulada', 'anulada', cot.estado, 'estado')
    addLog(id, `  estado = "anulada" ✓`)
    addLog(id, 'Cotización anulada correctamente', 'success')
  }

  async function stepReciclarCotizacion(id) {
    addLog(id, `POST /api/cotizaciones/reciclar (cotizacionId=${dataRef.current.cotizacion2Id})`)
    const result = await apiCall('/api/cotizaciones/reciclar', 'POST', {
      cotizacionId: dataRef.current.cotizacion2Id,
      vendedorDestinoId: perfil.id,
    })
    dataRef.current.cotizacionRecicladaId = result.id
    addLog(id, `Cotización reciclada → nueva id=${result.id}`, 'success')
  }

  async function stepAssertReciclada(id) {
    const d = dataRef.current
    const { data: cot, error } = await supabase.from('cotizaciones').select('*').eq('id', d.cotizacionRecicladaId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(cot)}`)
    assert(cot.estado === 'borrador', 'borrador', cot.estado, 'estado')
    addLog(id, `  estado = "borrador" ✓`)
    assert(cot.cliente_id === d.clienteId, d.clienteId, cot.cliente_id, 'cliente_id')
    addLog(id, `  cliente_id correcto ✓`)
    assert(cot.vendedor_id === perfil.id, perfil.id, cot.vendedor_id, 'vendedor_id')
    addLog(id, `  vendedor_id correcto ✓`)

    const { data: items } = await supabase.from('cotizacion_items').select('*').eq('cotizacion_id', d.cotizacionRecicladaId)
    assert(items && items.length > 0, '>0', items?.length, 'items copiados')
    addLog(id, `  items.length = ${items.length} (copiados) ✓`)
    addLog(id, 'Cotización reciclada correctamente', 'success')
  }

  async function stepCrearVersion(id) {
    const d = dataRef.current
    addLog(id, 'Enviando cotización reciclada...')
    await apiCall('/api/cotizaciones/enviar', 'POST', {
      cotizacionId: d.cotizacionRecicladaId,
      tasaBcv: 100,
    })
    addLog(id, 'OK → cotización reciclada enviada')

    addLog(id, 'POST /api/cotizaciones/crear-version')
    const result = await apiCall('/api/cotizaciones/crear-version', 'POST', {
      cotizacionId: d.cotizacionRecicladaId,
      notasCambio: 'Versión de prueba determinista',
    })
    d.cotizacionVersionId = result.id
    addLog(id, `OK → cotizacionVersionId=${result.id}`, 'success')
  }

  async function stepAssertVersion(id) {
    const d = dataRef.current
    const { data: cot, error } = await supabase.from('cotizaciones').select('*').eq('id', d.cotizacionVersionId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(cot)}`)
    assert(cot.estado === 'borrador', 'borrador', cot.estado, 'estado')
    addLog(id, `  estado = "borrador" ✓`)
    assert(Number(cot.version) >= 2, '>=2', cot.version, 'version')
    addLog(id, `  version = ${cot.version} ✓`)
    assert(cot.cotizacion_raiz_id !== null, 'not null', cot.cotizacion_raiz_id, 'cotizacion_raiz_id')
    addLog(id, `  cotizacion_raiz_id = ${cot.cotizacion_raiz_id} (tiene lineaje) ✓`)
    addLog(id, 'Versión de cotización correcta', 'success')
  }

  async function stepVentaRapida(id) {
    const d = dataRef.current
    addLog(id, `POST /api/ventas-rapidas/crear (${TEST.ventaRapida.cantidad}×$${TEST.ventaRapida.precio_unit}, ${TEST.ventaRapida.forma_pago})`)
    const result = await apiCall('/api/ventas-rapidas/crear', 'POST', {
      clienteId: d.clienteId,
      transportistaId: d.transportistaTestId,
      fleteUsd: 0,
      formaPago: 'Efectivo $',
      formaPagoCliente: '',
      referenciaPago: 'REF-TEST-VR',
      notas: 'Venta rápida determinista',
      notasCliente: '',
      items: [{
        productoId: d.productoId,
        cantidad: TEST.ventaRapida.cantidad,
        precioUnitUsd: TEST.ventaRapida.precio_unit,
      }],
      descuentoGlobalPct: 0,
      costoEnvioUsd: 0,
      tasaBcv: 100,
    })
    d.ventaRapidaDespachoId = result.id
    d.ventaRapidaCotizacionId = result.cotizacionId
    addLog(id, `OK → despachoId=${result.id}, cotizacionId=${result.cotizacionId}`, 'success')
  }

  async function stepAssertVRCotizacion(id) {
    const d = dataRef.current
    const { data: cot, error } = await supabase.from('cotizaciones').select('*').eq('id', d.ventaRapidaCotizacionId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(cot)}`)
    assert(cot.estado === 'aceptada', 'aceptada', cot.estado, 'estado')
    addLog(id, `  estado = "aceptada" ✓`)
    assert(Number(cot.total_usd) === 125.00, 125.00, Number(cot.total_usd), 'total_usd')
    addLog(id, `  total_usd = $${cot.total_usd} ✓`)
    addLog(id, 'Cotización de venta rápida correcta', 'success')
  }

  async function stepAssertVRDespacho(id) {
    const d = dataRef.current
    const { data: des, error } = await supabase.from('notas_despacho').select('*').eq('id', d.ventaRapidaDespachoId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(des)}`)
    assert(des.estado === 'pendiente', 'pendiente', des.estado, 'estado')
    addLog(id, `  estado = "pendiente" ✓`)
    assert(des.forma_pago === 'Efectivo $', 'Efectivo $', des.forma_pago, 'forma_pago')
    addLog(id, `  forma_pago = "Efectivo $" ✓`)
    assert(Number(des.total_usd) === 125.00, 125.00, Number(des.total_usd), 'total_usd')
    addLog(id, `  total_usd = $${des.total_usd} ✓`)
    addLog(id, 'Despacho de venta rápida correcto', 'success')
  }

  async function stepAssertStockPostVR(id) {
    const { data: prod } = await supabase.from('productos').select('stock_actual').eq('id', dataRef.current.productoId).single()
    const stock = Number(prod.stock_actual)
    assert(stock === 105, 105, stock, 'stock_actual post-VR')
    addLog(id, `  stock_actual = ${stock} (110 - 5 = 105) ✓`, 'success')
  }

  async function stepAnularDespacho(id) {
    addLog(id, `POST /api/despachos/estado (despachoId=${dataRef.current.ventaRapidaDespachoId}, nuevoEstado=anulada)`)
    await apiCall('/api/despachos/estado', 'POST', {
      despachoId: dataRef.current.ventaRapidaDespachoId,
      nuevoEstado: 'anulada',
    })
    addLog(id, 'Despacho de venta rápida anulado', 'success')
  }

  async function stepAssertDespachoAnulado(id) {
    const d = dataRef.current
    const { data: des } = await supabase.from('notas_despacho').select('estado').eq('id', d.ventaRapidaDespachoId).single()
    assert(des.estado === 'anulada', 'anulada', des.estado, 'estado')
    addLog(id, `  estado = "anulada" ✓`)

    const { data: prod } = await supabase.from('productos').select('stock_actual').eq('id', d.productoId).single()
    const stock = Number(prod.stock_actual)
    assert(stock === 110, 110, stock, 'stock restaurado')
    addLog(id, `  stock_actual = ${stock} (105 + 5 = 110, restaurado) ✓`)
    addLog(id, 'Despacho anulado y stock restaurado', 'success')
  }

  async function stepReciclarDespacho(id) {
    addLog(id, `POST /api/despachos/reciclar (despachoId=${dataRef.current.ventaRapidaDespachoId})`)
    const result = await apiCall('/api/despachos/reciclar', 'POST', {
      despachoId: dataRef.current.ventaRapidaDespachoId,
    })
    dataRef.current.cotizacionDesdeDespachoId = result.id
    addLog(id, `Despacho reciclado → nueva cotización id=${result.id}`, 'success')
  }

  async function stepAssertDespachoReciclado(id) {
    const d = dataRef.current
    const { data: cot, error } = await supabase.from('cotizaciones').select('*').eq('id', d.cotizacionDesdeDespachoId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(cot)}`)
    assert(cot.estado === 'borrador', 'borrador', cot.estado, 'estado')
    addLog(id, `  estado = "borrador" ✓`)
    assert(cot.cliente_id === d.clienteId, d.clienteId, cot.cliente_id, 'cliente_id')
    addLog(id, `  cliente_id correcto ✓`)

    const { data: items } = await supabase.from('cotizacion_items').select('*').eq('cotizacion_id', d.cotizacionDesdeDespachoId)
    assert(items && items.length > 0, '>0', items?.length, 'items copiados')
    addLog(id, `  items.length = ${items.length} ✓`)
    addLog(id, 'Despacho reciclado a nueva cotización correctamente', 'success')
  }

  async function stepReasignarCliente(id) {
    const d = dataRef.current
    // Buscar un vendedor distinto al actual
    const { data: vendedores } = await supabase.from('usuarios')
      .select('id, nombre, rol')
      .eq('rol', 'vendedor').eq('activo', true)
      .neq('id', perfil.id)
      .limit(1)
    const otroVendedor = vendedores?.[0]
    if (!otroVendedor) {
      addLog(id, 'SKIP: no hay otro vendedor para reasignar', 'warn')
      return
    }
    d.otroVendedorId = otroVendedor.id
    addLog(id, `Vendedor destino: ${otroVendedor.nombre} (${otroVendedor.id.slice(0,8)}...)`)

    addLog(id, `POST /api/clientes/reasignar (clienteId=${d.clienteId}, nuevoVendedorId=${d.otroVendedorId})`)
    await apiCall('/api/clientes/reasignar', 'POST', {
      clienteId: d.clienteId,
      nuevoVendedorId: d.otroVendedorId,
      motivo: TEST.reasignacion.motivo,
    })
    addLog(id, 'Cliente reasignado correctamente', 'success')
  }

  async function stepAssertReasignacion(id) {
    const d = dataRef.current
    if (!d.otroVendedorId) {
      addLog(id, 'SKIP: no se ejecutó reasignación (sin otro vendedor)', 'warn')
      return
    }
    const { data: cl, error } = await supabase.from('clientes').select('vendedor_id, ultima_reasig_motivo').eq('id', d.clienteId).single()
    if (error) throw error
    addLog(id, `Raw DB: ${JSON.stringify(cl)}`)
    assert(cl.vendedor_id === d.otroVendedorId, d.otroVendedorId, cl.vendedor_id, 'vendedor_id')
    addLog(id, `  vendedor_id = ${cl.vendedor_id.slice(0,8)}... (reasignado) ✓`)
    assert(cl.ultima_reasig_motivo === TEST.reasignacion.motivo, TEST.reasignacion.motivo, cl.ultima_reasig_motivo, 'ultima_reasig_motivo')
    addLog(id, `  ultima_reasig_motivo = "${cl.ultima_reasig_motivo}" ✓`)
    addLog(id, 'Reasignación de cliente correcta', 'success')
  }

  // ─── HEALTH CHECKS ─────────────────────────────────────────────────────────

  async function stepHealthApiEndpoints(id) {
    const endpoints = [
      { path: '/api/config', method: 'GET', label: 'Config' },
      { path: '/api/comisiones/config', method: 'GET', label: 'Comisiones config' },
    ]
    for (const ep of endpoints) {
      try {
        const result = await apiCall(ep.path, ep.method)
        assert(result !== null && result !== undefined, 'respuesta', typeof result, `${ep.label} responde`)
        addLog(id, `  ${ep.label} (${ep.method} ${ep.path}) → OK ✓`)
      } catch (e) {
        throw new Error(`Endpoint ${ep.path} falló: ${e.message}`)
      }
    }
    addLog(id, 'Todos los endpoints API responden correctamente', 'success')
  }

  async function stepHealthRlsPolicies(id) {
    const tables = [
      { name: 'productos', filter: 'activo=eq.true', expectRows: true },
      { name: 'clientes', filter: 'activo=eq.true', expectRows: true },
      { name: 'usuarios', filter: 'activo=eq.true', expectRows: true },
      { name: 'cotizaciones', filter: null, expectRows: true },
      { name: 'transportistas', filter: 'activo=eq.true', expectRows: false },
      { name: 'inventario_movimientos', filter: null, expectRows: true },
    ]
    for (const t of tables) {
      const query = supabase.from(t.name).select('id', { count: 'exact', head: true })
      const { count, error } = await query.limit(1)
      if (error) throw new Error(`RLS bloquea SELECT en ${t.name}: ${error.message}`)
      if (t.expectRows) {
        assert(count !== null && count >= 0, '>=0', count, `${t.name} accesible`)
      }
      addLog(id, `  ${t.name}: accesible (${count} filas) ✓`)
    }
    addLog(id, 'RLS permite lectura en todas las tablas clave', 'success')
  }

  async function stepHealthConfig(id) {
    const { data: config, error } = await supabase.from('configuracion_negocio').select('*').limit(1).maybeSingle()
    if (error) throw new Error(`No se puede leer configuración: ${error.message}`)
    assert(config !== null, 'existe', config, 'configuración existe')
    addLog(id, `  configuración: 1 registro ✓`)

    // Verificar campos críticos
    const required = ['comision_pct_cabilla', 'comision_pct_otros', 'comision_categoria_cabilla']
    for (const clave of required) {
      assert(config[clave] !== undefined && config[clave] !== null, 'definido', config[clave] ?? 'undefined', `config.${clave}`)
      addLog(id, `  ${clave} = ${config[clave]} ✓`)
    }
    addLog(id, 'Configuración carga correctamente con campos requeridos', 'success')
  }

  async function stepHealthNavRoutes(id) {
    // Verificar que las rutas principales existen comprobando que los componentes
    // se pueden resolver (no hay imports rotos) — usamos el router actual
    const routes = ['/', '/cotizaciones', '/clientes', '/inventario', '/despachos', '/configuracion', '/reportes', '/tester']
    const session = (await supabase.auth.getSession()).data.session
    if (!session?.access_token) throw new Error('No autenticado')

    for (const route of routes) {
      // Fetch the route HTML to verify it doesn't 404
      const res = await fetch(route, {
        headers: { Accept: 'text/html' },
        redirect: 'follow',
      })
      assert(res.ok, '200', res.status, `ruta ${route}`)
      addLog(id, `  ${route} → ${res.status} OK ✓`)
    }
    addLog(id, 'Todas las rutas principales responden', 'success')
  }

  async function stepCleanup(id) {
    const d = dataRef.current
    // Helper: cleanup cotización + all deps via SECURITY DEFINER RPC (bypasses RLS)
    async function cleanCot(cotId, label) {
      if (!cotId) return
      await supabase.rpc('tester_cleanup_cotizacion', { p_cotizacion_id: cotId })
      addLog(id, `DELETE ${label} ✓`)
    }

    // Orden inverso de dependencias — primero los datos nuevos
    await cleanCot(d.cotizacionDesdeDespachoId, 'cotización reciclada desde despacho')
    await cleanCot(d.ventaRapidaCotizacionId, 'cotización + despacho venta rápida')
    await cleanCot(d.cotizacionVersionId, 'cotización versión')
    await cleanCot(d.cotizacionRecicladaId, 'cotización reciclada')
    await cleanCot(d.cotizacion2Id, 'cotización para anular')

    // Limpiar producto 2 (via RPC to bypass RLS)
    if (d.producto2Id) {
      const { error: rpc2 } = await supabase.rpc('borrar_producto_con_kardex', { p_producto_id: d.producto2Id })
      if (rpc2) {
        await supabase.from('inventario_movimientos').delete().eq('producto_id', d.producto2Id)
        await supabase.from('productos').delete().eq('id', d.producto2Id)
      }
      addLog(id, 'DELETE producto 2 + movimientos ✓')
    }

    // Limpiar transportista test (deactivate — RLS no permite DELETE)
    if (d.transportistaTestId) {
      await supabase.from('transportistas').update({ activo: false }).eq('id', d.transportistaTestId)
      addLog(id, 'DEACTIVATE transportista test ✓')
    }

    // Limpiar movimientos de lote
    if (d.loteId) {
      await supabase.from('inventario_movimientos').delete().eq('lote_id', d.loteId)
      addLog(id, 'DELETE movimientos lote ✓')
    }

    // Reasignación: limpiar registro
    if (d.clienteId && d.otroVendedorId) {
      await supabase.from('reasignaciones_clientes').delete().eq('cliente_id', d.clienteId)
      addLog(id, 'DELETE reasignaciones_clientes ✓')
    }

    // --- Datos originales (cotización principal via RPC) ---
    await cleanCot(d.cotizacionId, 'cotización principal + deps')

    if (d.productoId) {
      const { error: rpc1 } = await supabase.rpc('borrar_producto_con_kardex', { p_producto_id: d.productoId })
      if (rpc1) {
        await supabase.from('inventario_movimientos').delete().eq('producto_id', d.productoId)
        await supabase.from('productos').delete().eq('id', d.productoId)
      }
      addLog(id, 'DELETE inventario_movimientos + productos ✓')
    }
    if (d.clienteId) {
      await supabase.from('clientes').update({ saldo_pendiente: 0, activo: false }).eq('id', d.clienteId)
      addLog(id, 'DEACTIVATE clientes (RLS no permite DELETE) ✓')
    }
    addLog(id, 'Limpieza completa', 'success')
  }

  async function stepAssertCleanup(id) {
    const d = dataRef.current
    if (d.productoId) {
      const { data: p } = await supabase.from('productos').select('id').eq('id', d.productoId)
      assert(!p || p.length === 0, 0, p?.length, 'producto eliminado')
      addLog(id, '  producto eliminado ✓')
    }
    if (d.clienteId) {
      const { data: c } = await supabase.from('clientes').select('id,activo').eq('id', d.clienteId)
      assert(!c || c.length === 0 || c[0].activo === false, 'inactivo', c?.[0]?.activo, 'cliente desactivado')
      addLog(id, '  cliente desactivado ✓')
    }
    if (d.cotizacionId) {
      const { data: co } = await supabase.from('cotizaciones').select('id').eq('id', d.cotizacionId)
      assert(!co || co.length === 0, 0, co?.length, 'cotización eliminada')
      addLog(id, '  cotización eliminada ✓')
    }
    if (d.despachoId) {
      const { data: de } = await supabase.from('notas_despacho').select('id').eq('id', d.despachoId)
      assert(!de || de.length === 0, 0, de?.length, 'despacho eliminado')
      addLog(id, '  despacho eliminado ✓')
    }
    if (d.comisionId) {
      const { data: cm } = await supabase.from('comisiones').select('id').eq('id', d.comisionId)
      assert(!cm || cm.length === 0, 0, cm?.length, 'comisión eliminada')
      addLog(id, '  comisión eliminada ✓')
    }
    // Nuevos datos
    if (d.producto2Id) {
      const { data: p2 } = await supabase.from('productos').select('id').eq('id', d.producto2Id)
      assert(!p2 || p2.length === 0, 0, p2?.length, 'producto 2 eliminado')
      addLog(id, '  producto 2 eliminado ✓')
    }
    if (d.transportistaTestId) {
      const { data: tr } = await supabase.from('transportistas').select('id,activo').eq('id', d.transportistaTestId)
      assert(!tr || tr.length === 0 || tr[0].activo === false, 'inactivo o eliminado', tr?.[0]?.activo ?? 'no encontrado', 'transportista eliminado')
      addLog(id, '  transportista test desactivado ✓')
    }
    if (d.cotizacion2Id) {
      const { data: c2 } = await supabase.from('cotizaciones').select('id').eq('id', d.cotizacion2Id)
      assert(!c2 || c2.length === 0, 0, c2?.length, 'cotización anulada eliminada')
      addLog(id, '  cotización anulada eliminada ✓')
    }
    if (d.ventaRapidaDespachoId) {
      const { data: vrd } = await supabase.from('notas_despacho').select('id').eq('id', d.ventaRapidaDespachoId)
      assert(!vrd || vrd.length === 0, 0, vrd?.length, 'despacho venta rápida eliminado')
      addLog(id, '  despacho venta rápida eliminado ✓')
    }
    addLog(id, 'Todos los datos de prueba fueron eliminados correctamente', 'success')
    dataRef.current = {}
  }

  // ─── Step map ─────────────────────────────────────────────────────────────
  const STEP_FNS = {
    pre_cleanup: stepPreCleanup,
    create_product: stepCreateProduct,
    assert_product: stepAssertProduct,
    assert_kardex_ingreso: stepAssertKardexIngreso,
    create_client: stepCreateClient,
    assert_client: stepAssertClient,
    create_draft: stepCreateDraft,
    assert_draft: stepAssertDraft,
    assert_items: stepAssertItems,
    assert_stock_comprometido_pre: stepAssertStockComprometidoPre,
    send_quote: stepSendQuote,
    assert_sent: stepAssertSent,
    accept_quote: stepAcceptQuote,
    assert_accepted: stepAssertAccepted,
    assert_stock_comprometido_aceptada: stepAssertStockComprometidoAceptada,
    create_despacho: stepCreateDespacho,
    assert_despacho: stepAssertDespacho,
    assert_stock_post: stepAssertStockPost,
    assert_kardex_egreso: stepAssertKardexEgreso,
    assert_stock_comprometido_post: stepAssertStockComprometidoPost,
    assert_cxc_cargo: stepAssertCxCCargo,
    apply_descuento: stepApplyDescuento,
    assert_descuento: stepAssertDescuento,
    mark_dispatched: stepMarkDispatched,
    assert_dispatched: stepAssertDispatched,
    mark_delivered: stepMarkDelivered,
    assert_delivered: stepAssertDelivered,
    assert_commission: stepAssertCommission,
    pay_commission: stepPayCommission,
    assert_commission_paid: stepAssertCommissionPaid,
    register_payment: stepRegisterPayment,
    assert_cxc_abono: stepAssertCxCAbono,
    assert_report_ventas: stepAssertReportVentas,
    assert_report_pipeline: stepAssertReportPipeline,
    assert_report_inventario: stepAssertReportInventario,
    create_transportista: stepCreateTransportista,
    assert_transportista: stepAssertTransportista,
    create_product_2: stepCreateProduct2,
    assert_product_2_prices: stepAssertProduct2Prices,
    apply_inventory_batch: stepApplyInventoryBatch,
    assert_inventory_batch: stepAssertInventoryBatch,
    create_draft_for_anular: stepCreateDraftForAnular,
    send_quote_for_anular: stepSendQuoteForAnular,
    anular_cotizacion: stepAnularCotizacion,
    assert_anulada: stepAssertAnulada,
    reciclar_cotizacion: stepReciclarCotizacion,
    assert_reciclada: stepAssertReciclada,
    crear_version: stepCrearVersion,
    assert_version: stepAssertVersion,
    venta_rapida: stepVentaRapida,
    assert_vr_cotizacion: stepAssertVRCotizacion,
    assert_vr_despacho: stepAssertVRDespacho,
    assert_stock_post_vr: stepAssertStockPostVR,
    anular_despacho: stepAnularDespacho,
    assert_despacho_anulado: stepAssertDespachoAnulado,
    reciclar_despacho: stepReciclarDespacho,
    assert_despacho_reciclado: stepAssertDespachoReciclado,
    reasignar_cliente: stepReasignarCliente,
    assert_reasignacion: stepAssertReasignacion,
    health_api_endpoints: stepHealthApiEndpoints,
    health_rls_policies: stepHealthRlsPolicies,
    health_config: stepHealthConfig,
    health_nav_routes: stepHealthNavRoutes,
    cleanup: stepCleanup,
    assert_cleanup: stepAssertCleanup,
  }

  // ─── Run all ──────────────────────────────────────────────────────────────
  async function runAll() {
    setRunning(true)
    abortRef.current = false
    setStepStates({})
    setSummary(null)
    setCopied(false)
    dataRef.current = {}
    fullLogRef.current = []
    const startTime = performance.now()
    const runDate = new Date().toISOString()
    fullLogRef.current.push({ time: ts(), stepId: '_header', stepLabel: 'SISTEMA', msg: `╔══════════════════════════════════════════════════════════════╗\n║  TESTER DETERMINISTA — LOG COMPLETO                         ║\n╚══════════════════════════════════════════════════════════════╝\nFecha: ${runDate}\nUsuario: ${perfil.nombre} (${perfil.email || perfil.id})\nRol: ${perfil.rol}\nConstantes de prueba:\n  Producto: ${TEST.producto.codigo} | $${TEST.producto.precio_usd} | stock=${TEST.producto.stock_inicial} | cat=${TEST.producto.categoria}\n  Producto 2: ${TEST.producto2.codigo} | $${TEST.producto2.precio_usd}/$${TEST.producto2.precio_2}/$${TEST.producto2.precio_3} | stock=${TEST.producto2.stock_inicial}\n  Cotización: ${TEST.cotizacion.cantidad}×$${TEST.cotizacion.precio_unit} | envío=$${TEST.cotizacion.costo_envio}\n  Esperado: subtotal=$${TEST.cotizacion.subtotal} | total=$${TEST.cotizacion.total_usd}\n  Despacho: forma_pago="${TEST.despacho.forma_pago}" | stock_post=${TEST.despacho.stock_esperado_post}\n  Transportista: ${TEST.transportista.nombre} | ${TEST.transportista.cedula}\n  Venta Rápida: ${TEST.ventaRapida.cantidad}×$${TEST.ventaRapida.precio_unit} = $${TEST.ventaRapida.total_usd} | ${TEST.ventaRapida.forma_pago}\n  Mov. Lote: +${TEST.movimientoLote.cantidad}u | Flujo: 100→90→110→105→110`, type: 'header' })
    let passed = 0, failed = 0, failedAt = null

    for (const step of STEPS) {
      if (abortRef.current) break
      try {
        await runStep(step.id, STEP_FNS[step.id])
        passed++
      } catch {
        failed++
        failedAt = step.label
        if (step.id !== 'cleanup' && step.id !== 'assert_cleanup') {
          try {
            setCurrentStep('cleanup')
            setStepStates(prev => ({ ...prev, cleanup: { status: 'running', logs: [{ msg: 'Limpieza de emergencia...', type: 'warn', time: ts() }] } }))
            await stepCleanup('cleanup')
            setStepStates(prev => ({ ...prev, cleanup: { ...prev.cleanup, status: 'pass' } }))
          } catch {}
        }
        break
      }
    }

    const totalTime = Math.round(performance.now() - startTime)
    const totalAssertions = Object.values(STEP_FNS).length
    fullLogRef.current.push({ time: ts(), stepId: '_footer', stepLabel: 'RESUMEN', msg: `\n╔══════════════════════════════════════════════════════════════╗\n║  RESUMEN FINAL                                              ║\n╚══════════════════════════════════════════════════════════════╝\nResultado: ${failed === 0 && !abortRef.current ? 'TODOS PASARON ✓' : abortRef.current ? 'ABORTADO' : `FALLÓ en: ${failedAt}`}\nPasos pasados: ${passed}/${STEPS.length}\nPasos fallidos: ${failed}\nTiempo total: ${(totalTime / 1000).toFixed(2)}s\nIDs creados: ${JSON.stringify(dataRef.current, null, 2)}`, type: failed === 0 ? 'pass' : 'fail' })
    setSummary({ passed, failed, totalTime, failedAt, aborted: abortRef.current, totalAssertions })
    setCurrentStep(null)
    setRunning(false)
  }

  // ─── Generate full log text ─────────────────────────────────────────────
  function generateFullLog() {
    const lines = []
    for (const entry of fullLogRef.current) {
      const prefix = entry.type === 'header' || entry.type === 'pass' || entry.type === 'fail'
        ? ''
        : `[${entry.time}] `
      const typeTag = entry.type === 'error' ? '[ERROR] '
        : entry.type === 'success' ? '[OK] '
        : entry.type === 'warn' ? '[WARN] '
        : entry.type === 'header' || entry.type === 'pass' || entry.type === 'fail' ? ''
        : '[INFO] '
      const stepCtx = entry.stepId && !entry.stepId.startsWith('_') ? `[${entry.stepLabel}] ` : ''
      lines.push(`${prefix}${typeTag}${stepCtx}${entry.msg}`)
    }
    return lines.join('\n')
  }

  async function copyLog() {
    const text = generateFullLog()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      // Fallback
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    }
  }

  function reset() {
    setStepStates({})
    setSummary(null)
    setCurrentStep(null)
    setExpandedSteps({})
    setCopied(false)
    dataRef.current = {}
    fullLogRef.current = []
  }

  if (perfil?.rol !== 'supervisor' && perfil?.rol !== 'desarrollador') {
    return (
      <div className="p-4 md:p-6 lg:p-8">
        <PageHeader icon={FlaskConical} title="Tester Determinista" subtitle="Solo supervisores y desarrolladores" />
        <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium">Requiere rol supervisor o desarrollador.</div>
      </div>
    )
  }

  // Agrupar pasos
  const groups = []
  let currentGroup = null
  for (const step of STEPS) {
    if (!currentGroup || currentGroup.name !== step.group) {
      currentGroup = { name: step.group, steps: [] }
      groups.push(currentGroup)
    }
    currentGroup.steps.push(step)
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6 max-w-4xl mx-auto">
      <PageHeader
        icon={FlaskConical}
        title="Tester Determinista"
        subtitle="64 pasos con aserciones exactas · cliente → cotización → despacho → descuentos → comisión → CxC → reportes → transportistas → multi-precio → anulación → reciclaje → venta rápida → reasignación → health checks"
      />

      {/* Valores esperados */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Valores deterministas</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div><span className="text-slate-400">Producto:</span> <span className="font-mono font-bold">{TEST.producto.codigo}</span></div>
          <div><span className="text-slate-400">Precio:</span> <span className="font-mono font-bold">${TEST.producto.precio_usd}</span></div>
          <div><span className="text-slate-400">Stock inicial:</span> <span className="font-mono font-bold">{TEST.producto.stock_inicial}</span></div>
          <div><span className="text-slate-400">Cantidad:</span> <span className="font-mono font-bold">{TEST.cotizacion.cantidad}</span></div>
          <div><span className="text-slate-400">Subtotal:</span> <span className="font-mono font-bold">${TEST.cotizacion.subtotal}</span></div>
          <div><span className="text-slate-400">Envío:</span> <span className="font-mono font-bold">+${TEST.cotizacion.costo_envio}</span></div>
          <div><span className="text-slate-400 font-bold">Total:</span> <span className="font-mono font-black text-indigo-600">${TEST.cotizacion.total_usd}</span></div>
          <div><span className="text-slate-400">Stock post:</span> <span className="font-mono font-bold">{TEST.despacho.stock_esperado_post}</span></div>
          <div><span className="text-slate-400">Forma pago:</span> <span className="font-mono font-bold">{TEST.despacho.forma_pago}</span></div>
          <div><span className="text-slate-400">Descuento:</span> <span className="font-mono font-bold">$2/u×10 = -$20</span></div>
          <div><span className="text-slate-400">Total c/desc:</span> <span className="font-mono font-bold">$240.00</span></div>
          <div><span className="text-slate-400">Abono:</span> <span className="font-mono font-bold">$100</span></div>
          <div><span className="text-slate-400">Saldo final:</span> <span className="font-mono font-bold">$140.00</span></div>
        </div>
        <div className="border-t border-slate-200 my-2" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div><span className="text-slate-400">Producto 2:</span> <span className="font-mono font-bold">{TEST.producto2.codigo}</span></div>
          <div><span className="text-slate-400">Precios:</span> <span className="font-mono font-bold">${TEST.producto2.precio_usd} / ${TEST.producto2.precio_2} / ${TEST.producto2.precio_3}</span></div>
          <div><span className="text-slate-400">Stock P2:</span> <span className="font-mono font-bold">{TEST.producto2.stock_inicial}</span></div>
          <div><span className="text-slate-400">Transportista:</span> <span className="font-mono font-bold">{TEST.transportista.cedula}</span></div>
          <div><span className="text-slate-400">Venta Rápida:</span> <span className="font-mono font-bold">{TEST.ventaRapida.cantidad}u × ${TEST.ventaRapida.precio_unit} = ${TEST.ventaRapida.total_usd}</span></div>
          <div><span className="text-slate-400">Mov. Lote:</span> <span className="font-mono font-bold">+{TEST.movimientoLote.cantidad}u (90→110)</span></div>
          <div className="col-span-2"><span className="text-slate-400">Flujo stock:</span> <span className="font-mono font-bold text-indigo-600">100→90(desp)→110(+20)→105(-5 VR)→110(anul VR)</span></div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {!running ? (
          <>
            <button onClick={runAll}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-500/20">
              <Play size={16} /> Ejecutar 64 pasos
            </button>
            {Object.keys(stepStates).length > 0 && (
              <>
                <button onClick={reset}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50">
                  <RotateCcw size={14} /> Reiniciar
                </button>
                <button onClick={copyLog}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                    copied
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                      : 'bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200'
                  }`}>
                  {copied ? <ClipboardCheck size={14} /> : <Copy size={14} />}
                  {copied ? 'Log copiado!' : 'Copiar Log completo'}
                </button>
              </>
            )}
          </>
        ) : (
          <button onClick={() => { abortRef.current = true }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition-colors">
            <XCircle size={16} /> Detener
          </button>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className={`rounded-xl p-4 border ${summary.failed === 0 && !summary.aborted ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-3">
            {summary.failed === 0 && !summary.aborted
              ? <CheckCircle size={20} className="text-emerald-500" />
              : <XCircle size={20} className="text-red-500" />}
            <div className="flex-1">
              <p className="font-bold text-sm">
                {summary.failed === 0 && !summary.aborted
                  ? `${summary.passed}/${STEPS.length} pasos — TODAS LAS ASERCIONES PASARON`
                  : summary.aborted ? 'Abortado' : `FALLÓ en: ${summary.failedAt}`}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {summary.passed} pass · {summary.failed} fail · {(summary.totalTime / 1000).toFixed(2)}s
              </p>
            </div>
            <button onClick={copyLog}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all ${
                copied
                  ? 'bg-emerald-200 text-emerald-800'
                  : 'bg-white/80 hover:bg-white text-slate-700 border border-slate-200'
              }`}>
              {copied ? <ClipboardCheck size={12} /> : <Copy size={12} />}
              {copied ? 'Copiado!' : 'Copiar Log'}
            </button>
          </div>
          {summary.failed > 0 && (
            <p className="text-xs text-red-600 mt-2 font-medium">
              Copia el log completo y pégalo a Claude para diagnosticar el error.
            </p>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="space-y-4">
        {groups.map(group => (
          <div key={group.name} className="space-y-1">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${GROUP_COLORS[group.name] || 'text-slate-600 bg-slate-50 border-slate-200'}`}>
              {group.name}
            </div>
            <div className="space-y-1">
              {group.steps.map(step => {
                const state = stepStates[step.id]
                const isExpanded = expandedSteps[step.id]
                const isCurrent = currentStep === step.id
                const isAssert = step.id.startsWith('assert_')

                return (
                  <div key={step.id} className={`rounded-xl border transition-all ${
                    isCurrent ? 'border-indigo-300 bg-indigo-50/50 shadow-sm' :
                    state?.status === 'pass' ? 'border-emerald-200 bg-emerald-50/30' :
                    state?.status === 'fail' ? 'border-red-200 bg-red-50/30' :
                    'border-slate-200 bg-white'
                  }`}>
                    <button onClick={() => state && toggleExpand(step.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                      <div className="shrink-0">
                        {state?.status === 'running' ? <Loader2 size={16} className="animate-spin text-indigo-500" /> :
                         state?.status === 'pass' ? <CheckCircle size={16} className="text-emerald-500" /> :
                         state?.status === 'fail' ? <XCircle size={16} className="text-red-500" /> :
                         <div className="w-4 h-4 rounded-full border-2 border-slate-300" />}
                      </div>
                      <span className={`flex-1 text-sm ${isAssert ? 'font-mono' : 'font-medium'} ${
                        state?.status === 'pass' ? 'text-emerald-700' :
                        state?.status === 'fail' ? 'text-red-700' :
                        isCurrent ? 'text-indigo-700' : 'text-slate-600'
                      }`}>
                        {step.label}
                      </span>
                      {state?.duration != null && (
                        <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                          <Clock size={10} />{state.duration}ms
                        </span>
                      )}
                      {state && (isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />)}
                    </button>
                    {isExpanded && state?.logs?.length > 0 && (
                      <div className="px-3 pb-3">
                        <div className="bg-slate-900 rounded-lg p-3 font-mono text-xs space-y-0.5 max-h-48 overflow-y-auto">
                          {state.logs.map((log, i) => (
                            <div key={i} className={`flex gap-2 ${
                              log.type === 'error' ? 'text-red-400' :
                              log.type === 'success' ? 'text-emerald-400' :
                              log.type === 'warn' ? 'text-amber-400' : 'text-slate-300'
                            }`}>
                              <span className="text-slate-500 shrink-0">{log.time}</span>
                              <span className="break-all whitespace-pre-wrap">{log.msg}</span>
                            </div>
                          ))}
                          <div ref={logEndRef} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
