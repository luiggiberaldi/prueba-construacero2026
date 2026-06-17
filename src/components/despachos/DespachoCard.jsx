import { useState, useRef, useEffect, memo, Fragment } from 'react'
import { FileText, Calendar, Truck, CheckCircle, Ban, RefreshCcw, RefreshCw, Download, Loader2, Eye, MoreHorizontal, MoreVertical, ChevronDown, Printer, Tag, Pencil, RotateCcw, AlertTriangle, Clock, CreditCard, DollarSign, Check, PackageCheck, Mail, Handshake, PackageX } from 'lucide-react'
import EstadoBadge from '../cotizaciones/EstadoBadge'
import MobileActionSheet from '../cotizaciones/MobileActionSheet'
import ConfirmModal from '../ui/ConfirmModal'
import useAuthStore from '../../store/useAuthStore'
import { useEditarDespacho } from '../../hooks/useDespachos'
import { getDespachoAction, PRIMARY_ACTION_COLORS } from '../../utils/despachoActions'
import { fmtUsdSimple as fmtUsd, fmtFecha, fmtFechaHora, fmtBs, usdToBs } from '../../utils/format'
import supabase from '../../services/supabase/client'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'
import DetalleModal from '../ui/DetalleModal'
import { Modal } from '../ui/Modal'
import DescuentoModal from './DescuentoModal'
import EditDespachoModal from './EditDespachoModal'
import DevolverAnularModal from './DevolverAnularModal'
import CambiarTransportistaModal from './CambiarTransportistaModal'
import ConciliarCodModal from './ConciliarCodModal'
import FacturaModal from './FacturaModal'
import DevolucionParcialModal from './DevolucionParcialModal'
import { showToast } from '../ui/Toast'
import { MessageCircle } from 'lucide-react'
import SeguimientoFijadoModal from '../ui/SeguimientoFijadoModal'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'
import { calcComisionEstimada } from '../../utils/comisionUtils'

export default memo(function DespachoCard({ despacho, onCambiarEstado, onAnular, onReciclar, tasa = 0, config = {}, estadoCambiando = false }) {
  const { data: configNegocio } = useConfigNegocio()
  const pctCabilla = Number(configNegocio?.comision_pct_cabilla ?? 0)
  const pctOtros   = Number(configNegocio?.comision_pct_otros   ?? 0)
  const catCabilla = (configNegocio?.comision_categoria_cabilla || 'Cabilla').toLowerCase()
  const { perfil } = useAuthStore()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esAdministracion = perfil?.rol === 'administracion'
  const esPrivilegiado = esSupervisor || esAdministracion || esDesarrollador
  const rol = perfil?.rol || 'vendedor'
  const [pdfLoading, setPdfLoading]   = useState(false)
  const [ordenLoading, setOrdenLoading] = useState(false)
  const [guiaLoading, setGuiaLoading]   = useState(false)
  const [printLoading, setPrintLoading] = useState(false)
  const [showDetalle, setShowDetalle] = useState(false)
  const [showFijadoModal, setShowFijadoModal] = useState(false)
  const [showDescuento, setShowDescuento] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showSheet, setShowSheet]     = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showAdminMenu, setShowAdminMenu] = useState(false)
  const [accionPendiente, setAccionPendiente] = useState(null) // { id, estado, actionConfig }
  const printBtnRef = useRef(null)
  const downloadBtnRef = useRef(null)
  const adminBtnRef = useRef(null)
  const [monedaPdf, setMonedaPdf] = useState(() => localStorage.getItem('listopos_moneda_pdf') || '$')
  const [tasaPersonalizada, setTasaPersonalizada] = useState('')
  const [porcentajePdf, setPorcentajePdf] = useState('')
  const [showCambiarTransportista, setShowCambiarTransportista] = useState(false)
  const [showConciliarCod, setShowConciliarCod] = useState(false)
  const [showFacturaModal, setShowFacturaModal] = useState(false)
  const [showDevolucionParcial, setShowDevolucionParcial] = useState(false)
  const [facturaActionType, setFacturaActionType] = useState('download')
  const esLogistica = perfil?.rol === 'logistica' || perfil?.rol === 'jefe' || perfil?.rol === 'desarrollador'
  const puedeAjustarPorcentaje = ['administracion', 'logistica', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const { tasaBcv, tasaUsdt } = useTasaCambio()

  const editarDespacho = useEditarDespacho()
  const [showNotaModal, setShowNotaModal] = useState(false)
  const [nuevaNota, setNuevaNota] = useState('')

  async function handleGuardarNota() {
    try {
      await editarDespacho.mutateAsync({
        despachoId: despacho.id,
        notas: nuevaNota || null
      })
      setShowNotaModal(false)
    } catch (err) {
      // useEditarDespacho handles its own toast error display
    }
  }

  async function handleEliminarNota() {
    try {
      await editarDespacho.mutateAsync({
        despachoId: despacho.id,
        notas: null
      })
      setShowNotaModal(false)
    } catch (err) {
      // useEditarDespacho handles its own toast error display
    }
  }

  const tasaImpresion = (esLogistica && (monedaPdf === 'bs' || monedaPdf === 'bcv') && Number(tasaPersonalizada) > 0)
    ? Number(tasaPersonalizada)
    : tasa

  const parsePorcentaje = (input) => {
    if (!input) return 100
    let clean = String(input).trim().replace(/%/g, '').replace(/,/g, '.')
    let num = parseFloat(clean)
    if (isNaN(num)) return 100
    const hasSign = String(input).trim().startsWith('+') || String(input).trim().startsWith('-')
    if (hasSign) {
      return 100 + num
    }
    // Si no tiene signo y es un valor pequeño (entre 0 y 50, ej: 10, 15), se asume que es suma (ej: +10%)
    if (num > 0 && num <= 50) {
      return 100 + num
    }
    return num
  }

  function seleccionarMoneda(moneda) {
    setMonedaPdf(moneda)
    localStorage.setItem('listopos_moneda_pdf', moneda)
  }

  const MONEDA_OPTIONS = [
    { key: '$', icon: <DollarSign size={14} className="text-emerald-500" />, label: 'USDT ($)' },
    { key: 'bcv', icon: <span className="text-sm font-bold text-teal-500 w-[14px] text-center">$</span>, label: 'Dólar BCV' },
    { key: 'bs', icon: <span className="text-sm font-bold text-blue-500 w-[14px] text-center">Bs</span>, label: 'Bolívares' },
  ]

  function renderMonedaSelector() {
    return (
      <div className="border-b border-slate-100 pb-1 mb-1">
        {MONEDA_OPTIONS.map(opt => (
          <button key={opt.key} onClick={() => seleccionarMoneda(opt.key)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left whitespace-nowrap ${monedaPdf === opt.key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
            {opt.icon} {opt.label}
            {monedaPdf === opt.key && <Check size={14} className="ml-auto text-emerald-500" />}
          </button>
        ))}
        {esLogistica && (monedaPdf === 'bs' || monedaPdf === 'bcv') && (
          <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex flex-col gap-1 mt-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Tasa PDF (Bs/$)</span>
            <input
              type="number"
              step="0.01"
              value={tasaPersonalizada}
              placeholder={tasa > 0 ? String(tasa) : "Tasa..."}
              onChange={e => setTasaPersonalizada(e.target.value)}
              className="w-full text-xs px-2 py-1 border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
            />
          </div>
        )}
        {puedeAjustarPorcentaje && (
          <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex flex-col gap-1 mt-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Ajuste Porcentual (%)</span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={porcentajePdf}
                placeholder="100% (Base)"
                onChange={e => {
                  const val = e.target.value
                  if (val === '' || /^[+-]?\d*([.,]\d*)?%?$/.test(val)) {
                    setPorcentajePdf(val)
                  }
                }}
                className="w-full text-xs px-2 py-1 border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
              />
              {porcentajePdf && (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 whitespace-nowrap">
                  {parsePorcentaje(porcentajePdf)}%
                </span>
              )}
            </div>
            <span className="text-[9px] text-slate-400">Ej: 10% (aumento del 10%), 90% (precio al 90%), -15%</span>
          </div>
        )}
      </div>
    )
  }

  // Cerrar modal de confirmación si el despacho cambió de estado (ej: anulado por otro usuario)
  useEffect(() => {
    if (accionPendiente && despacho.estado !== 'pendiente' && accionPendiente.estado === 'despachada') {
      setAccionPendiente(null)
    }
  }, [despacho.estado, accionPendiente])

  let tienePrestamos = !!despacho.tiene_prestamos
  try {
    const fp = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : (despacho.forma_pago || [])
    if (Array.isArray(fp) && fp.some(f => f.metodo === 'Préstamo' || f.metodo === 'Prestamo')) {
      tienePrestamos = true
    }
  } catch (e) {
    if (typeof despacho.forma_pago === 'string' && (despacho.forma_pago === 'Préstamo' || despacho.forma_pago === 'Prestamo')) {
      tienePrestamos = true
    }
  }

  // Verificar stock insuficiente para Admin
  const [itemsFaltantes, setItemsFaltantes] = useState([])
  const [comisionEst, setComisionEst] = useState(null)
  const [corteUsdDesdeItems, setCorteUsdDesdeItems] = useState(0) // corte como items (cuando corte_usd=0)
  const hayFaltaStock = itemsFaltantes.length > 0
  
  // Para mostrar items en modal de entrega
  const [itemsDespacho, setItemsDespacho] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemsDelDespacho, setItemsDelDespacho] = useState([])

  useEffect(() => {
    if (['pendiente', 'despachada'].includes(despacho.estado) && esPrivilegiado) {
      async function checkStock() {
        try {
          const items = await fetchItemsDespacho()
          setItemsDelDespacho(items || [])
          const ids = items.map(it => it.producto_id).filter(Boolean)
          if (ids.length === 0) return
          
          const { data: prods } = await supabase.from('productos').select('id, stock_actual, categoria').in('id', ids)
          
          // Mapear categorías y calcular faltantes
          const itemsConCat = items.map(it => {
            const esExterno = it.origen === 'externo' || !it.producto_id || String(it.producto_id).startsWith('manual-') || String(it.codigo_snap).startsWith('EXT')
            let categoria = 'otros'
            
            if (!esExterno) {
              const p = prods?.find(x => x.id === it.producto_id)
              if (p?.categoria) categoria = p.categoria
            } else if (it.nombre_snap && it.nombre_snap.toLowerCase().includes(catCabilla)) {
              categoria = catCabilla
            }
            
            return { ...it, categoria, total_linea_usd: Number(it.total_linea_usd) || (Number(it.cantidad) * Number(it.precio_unit_usd)) || 0 }
          })

          // Separar cortes del resto para que NO entren en la base de comisión
          const esCorteItem = (it) => it.nombre_snap?.toLowerCase().startsWith('corte')
          const itemsSinCorte = itemsConCat.filter(it => !esCorteItem(it))
          const sumaCorteItems = itemsConCat
            .filter(esCorteItem)
            .reduce((s, it) => s + (Number(it.total_linea_usd) || 0), 0)
          setCorteUsdDesdeItems(sumaCorteItems)

          const faltantes = itemsSinCorte.filter(it => {
            const esExterno = it.origen === 'externo' || !it.producto_id || String(it.producto_id).startsWith('manual-') || String(it.codigo_snap).startsWith('EXT')
            if (esExterno) return false
            const p = prods?.find(x => x.id === it.producto_id)
            return it.cantidad > (p?.stock_actual || 0)
          })
          setItemsFaltantes(faltantes)
          
          // Calcular comisión solo sobre productos reales (sin cortes)
          const est = calcComisionEstimada(itemsSinCorte, configNegocio, despacho.vendedor)
          setComisionEst(est)
        } catch (err) {
          console.error('Error verificando stock:', err)
        }
      }
      checkStock()
    } else {
      setItemsFaltantes([])
      setComisionEst(null)
      setCorteUsdDesdeItems(0)
    }
  }, [despacho.id, despacho.estado, pctCabilla, pctOtros, catCabilla])

  useEffect(() => {
    if (accionPendiente && (accionPendiente.estado === 'despachada' || accionPendiente.estado === 'entregada')) {
      setLoadingItems(true)
      fetchItemsDespacho()
        .then(data => {
          // Excluir cortes, fletes y servicios que no forman parte del inventario físico
          const itemsFiltrados = (data ?? []).filter(it => {
            const esCorte = it.nombre_snap?.toLowerCase().includes('corte') || it.codigo_snap?.toUpperCase().startsWith('CRT')
            const esFlete = it.nombre_snap?.toLowerCase().includes('flete') || it.codigo_snap?.toUpperCase().startsWith('FTL')
            if (esCorte || esFlete) return false
            
            // Si el item es un préstamo o el despacho en general maneja préstamos, conservamos el material real
            if (it.es_prestamo || tienePrestamos) return true
            
            const esExterno = !it.producto_id || String(it.producto_id).startsWith('manual-') || String(it.codigo_snap).startsWith('EXT')
            return !esExterno
          })
          
          // Aplicar fallback si el despacho tiene_prestamos pero ningún item tiene es_prestamo = true
          const hasAnyPrestamoItem = itemsFiltrados.some(it => it.es_prestamo)
          const itemsConFallback = tienePrestamos && !hasAnyPrestamoItem && itemsFiltrados.length > 0
            ? itemsFiltrados.map(it => ({ ...it, es_prestamo: true }))
            : itemsFiltrados

          setItemsDespacho(itemsConFallback)
          setItemsDelDespacho(data || [])
        })
        .catch(err => console.error('Error fetching items:', err))
        .finally(() => setLoadingItems(false))
    }
  }, [accionPendiente, tienePrestamos])

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`
  const tieneSeguimientoActivo = despacho.seguimiento?.some(s => s.prioridad === 'pendiente' || s.prioridad === 'urgente' || s.fijada)
  const tieneSeguimientoFijado = despacho.seguimiento?.some(s => s.fijada)
  const esVendedorExterno = !!despacho.vendedor?.es_externo || (despacho.vendedor?.markup_pct != null && Number(despacho.vendedor.markup_pct) > 0)
  const vendedorColor = esVendedorExterno ? '#D97706' : (despacho.vendedor?.color || '#64748b')
  const esVendedorSinComision = (despacho.cliente_factura || despacho.cliente)?.vendedor?.rol === 'vendedor_sin_comision'

  const cotNum = despacho.cotizacion
    ? `COT-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : '—'

  const canDespachar = (esAdministracion || esDesarrollador || rol === 'jefe') && despacho.estado === 'pendiente'
  const canEntregar = (perfil?.rol === 'logistica' || perfil?.rol === 'jefe' || esDesarrollador) && despacho.estado === 'despachada'
  const esVendedorPropio = perfil?.id === despacho.vendedor_id
  const canAnular = despacho.estado === 'pendiente' && (esDesarrollador || esAdministracion || esSupervisor || esVendedorPropio)
  const canDevolver = (despacho.estado === 'despachada' || despacho.estado === 'entregada') && ['logistica', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const canDevolucionParcial = despacho.estado === 'entregada' && ['administracion', 'logistica', 'desarrollador', 'jefe'].includes(perfil?.rol)
  const canReciclar = ((esSupervisor || esDesarrollador) && despacho.estado === 'anulada' && onReciclar)
    || (['vendedor', 'vendedor_sin_comision'].includes(rol) && despacho.estado === 'anulada' && esVendedorPropio && onReciclar)
  const canDescuento = (esAdministracion || esDesarrollador || perfil?.rol === 'jefe') && ['pendiente', 'despachada'].includes(despacho.estado)
  const canEditar = despacho.estado === 'pendiente' && (esPrivilegiado || perfil?.rol === 'logistica' || despacho.vendedor_id === perfil?.id)
  const descuentoTotal = Number(despacho.descuento_total_usd || 0)
  const fleteUsd = Number(despacho.flete_usd || 0)
  // corteUsd: usa el campo del despacho si está seteado, sino suma los ítems detectados como corte
  const corteUsd = Number(despacho.corte_usd || 0) || corteUsdDesdeItems
  const totalBruto = Number(despacho.total_usd || 0) // ya incluye flete y corte
  const subtotalProductos = totalBruto - fleteUsd - corteUsd // solo productos sin servicios
  const totalFinal = totalBruto - descuentoTotal // total con flete+corte, menos descuento

  const clienteObj = despacho.cliente_factura || despacho.cliente
  const esPersonal = clienteObj?.tipo_cliente === 'personal'

  const [personalItems, setPersonalItems] = useState([])
  useEffect(() => {
    if (esPersonal) {
      fetchItemsDespacho()
        .then(data => setPersonalItems(data || []))
        .catch(err => console.error('Error fetching personal items:', err))
    }
  }, [despacho.id, esPersonal])

  const descPersonalPct = esPersonal ? (configNegocio?.descuento_personal_pct ?? 10.0) : 0
  let subtotalOriginal = subtotalProductos
  let descuentoPersonal = 0

  if (esPersonal && descPersonalPct > 0 && personalItems.length > 0) {
    let sumOriginal = 0
    personalItems.forEach(it => {
      if (!it.es_prestamo) {
        const cant = Number(it.cantidad || 0)
        const precio = Number(it.precio_unit_usd || 0)
        const precioOrig = Math.round((precio / (1 - descPersonalPct / 100)) * 100) / 100
        sumOriginal += precioOrig * cant
      }
    })
    subtotalOriginal = sumOriginal
    descuentoPersonal = Math.max(0, subtotalOriginal - subtotalProductos)
  }

  const totalOriginal = totalBruto + descuentoPersonal

  // tienePrestamos is already declared at the top of the component
  const itemsDelDespachoConFallback = tienePrestamos && !itemsDelDespacho.some(x => x.es_prestamo)
    ? itemsDelDespacho.map(it => ({ ...it, es_prestamo: true }))
    : itemsDelDespacho

  let isCtaPorCobrar = false
  let isMixtoCxc = false
  let textVencimiento = null
  let numMetodos = 0
  let isCodUnpaid = false
  let isCodPaid = false
  let metodosPagoList = []
  try {
    const fp = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : (despacho.forma_pago || [])
    if (Array.isArray(fp)) {
      if (fp.some(f => f.metodo === 'Préstamo' || f.metodo === 'Prestamo')) {
        tienePrestamos = true
      }
      numMetodos = fp.length
      metodosPagoList = fp.map(f => f.metodo === 'Cta por cobrar' ? 'Cta. por cobrar' : f.metodo)
      const cta = fp.find(f => f.metodo === 'Cta por cobrar')
      if (cta && cta.diasVencimiento > 0) {
        isCtaPorCobrar = true
        const fCreacion = new Date(despacho.creado_en)
        const fVenc = new Date(fCreacion.getTime() + cta.diasVencimiento * 24 * 60 * 60 * 1000)
        const hoy = new Date()
        const restantes = Math.ceil((fVenc - hoy) / (1000 * 60 * 60 * 24))
        const vencido = restantes < 0
        textVencimiento = `${cta.diasVencimiento} días (${vencido ? `Vencido hace ${Math.abs(restantes)}d` : `${restantes}d restantes`})`
      } else if (cta) {
        isCtaPorCobrar = true
      }
      if (isCtaPorCobrar && numMetodos > 1) {
        isMixtoCxc = true
      }

      const cod = fp.find(f => f.metodo === 'Cobro a destino')
      if (cod) {
        if (!cod.cobro_destino_pagado) {
          isCodUnpaid = true
        } else {
          isCodPaid = true
        }
      }
    } else if (typeof despacho.forma_pago === 'string' && despacho.forma_pago) {
      metodosPagoList = [despacho.forma_pago === 'Cta por cobrar' ? 'Cta. por cobrar' : despacho.forma_pago]
      if (despacho.forma_pago === 'Cta por cobrar') {
        isCtaPorCobrar = true
      }
    }
  } catch (e) {
    if (typeof despacho.forma_pago === 'string' && despacho.forma_pago) {
      metodosPagoList = [despacho.forma_pago === 'Cta por cobrar' ? 'Cta. por cobrar' : despacho.forma_pago]
      if (despacho.forma_pago === 'Cta por cobrar') {
        isCtaPorCobrar = true
      }
    }
  }
  // Helper: fetch notas_despacho_items con fallback offline
  async function fetchItemsDespacho() {
    const res = await supabase
      .from('notas_despacho_items')
      .select('id, producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden, es_prestamo, productos(categoria)')
      .eq('despacho_id', despacho.id)
      .order('orden')
    if (res.error) throw new Error(res.error.message || 'Sin items en caché — conecta a internet al menos una vez para imprimir offline')
    return (res.data ?? []).map(item => ({
      ...item,
      categoria: item.productos?.categoria || ''
    }))
  }

  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const [{ generarDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        fetchItemsDespacho(),
      ])
      await generarDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa: tasaImpresion,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        porcentaje: parsePorcentaje(porcentajePdf),
      })
    } catch (err) {
      showToast('Error al generar PDF: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  async function descargarOrdenDespacho() {
    setOrdenLoading(true)
    try {
      const [{ generarOrdenDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        fetchItemsDespacho(),
      ])
      await generarOrdenDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa: tasaImpresion,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        porcentaje: parsePorcentaje(porcentajePdf),
      })
    } catch (err) {
      showToast('Error al generar Orden de Despacho: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setOrdenLoading(false)
    }
  }

  async function descargarGuiaDespacho() {
    setGuiaLoading(true)
    try {
      const [{ generarGuiaDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/guiaDespachoPDF'),
        fetchItemsDespacho(),
      ])
      await generarGuiaDespachoPDF({
        despacho, items: itemsFinal, config
      })
    } catch (err) {
      showToast('Error al generar Guía de Despacho: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setGuiaLoading(false)
    }
  }

  // Helper: imprimir PDF blob (abre diálogo de impresión en PC y móvil)
  function printOrDownloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob)
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) {
      // Abrir PDF en nueva pestaña — el visor nativo permite imprimir/compartir
      const w = window.open(url, '_blank')
      if (!w) {
        // Si el popup fue bloqueado, descargar como fallback
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

  function abrirFacturaModal(type) {
    setFacturaActionType(type)
    setShowFacturaModal(true)
  }

  async function generarFacturaConDatos(nroFactura, nroControl) {
    setShowFacturaModal(false)
    if (facturaActionType === 'print') {
      setPrintLoading(true)
    } else {
      setPdfLoading(true)
    }
    try {
      const [{ generarFacturaPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/facturaPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarFacturaPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa: tasaImpresion,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
        nroFactura, nroControl,
        porcentaje: parsePorcentaje(porcentajePdf),
      })
      if (facturaActionType === 'print') {
        printOrDownloadPdf(blob, filename)
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      showToast('Error al generar factura: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
      setPdfLoading(false)
    }
  }

  async function imprimirDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa: tasaImpresion,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
        porcentaje: parsePorcentaje(porcentajePdf),
      })
      printOrDownloadPdf(blob, filename)
    } catch (err) {
      showToast('Error al imprimir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function compartirDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/despachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: 'bs', tasa: tasaImpresion,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
        porcentaje: parsePorcentaje(porcentajePdf),
      })

      const clienteObj = despacho.cliente_factura || despacho.cliente
      const mensaje = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteObj?.nombre,
        numDisplay,
        totalUsd: totalFinal,
        nombreVendedor: despacho.vendedor?.nombre,
        tipo: 'Nota de Entrega'
      })

      await compartirPorWhatsApp({
        pdfBlob: blob,
        pdfFilename: filename,
        telefono: clienteObj?.telefono,
        mensaje,
        mensajeParams: {
          nombreNegocio: config.nombre_negocio,
          nombreCliente: clienteObj?.nombre,
          numDisplay,
          totalUsd: totalFinal,
          nombreVendedor: despacho.vendedor?.nombre,
          tipo: 'Nota de Entrega'
        }
      })
    } catch (err) {
      showToast('Error al compartir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function imprimirOrdenDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarOrdenDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarOrdenDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa: tasaImpresion,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
        porcentaje: parsePorcentaje(porcentajePdf),
      })
      printOrDownloadPdf(blob, filename)
    } catch (err) {
      showToast('Error al imprimir orden: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function imprimirGuiaDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarGuiaDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/guiaDespachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarGuiaDespachoPDF({
        despacho, items: itemsFinal, config,
        returnBlob: true,
      })
      printOrDownloadPdf(blob, filename)
    } catch (err) {
      showToast('Error al imprimir Guía de Despacho: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function compartirOrdenDespacho() {
    setPrintLoading(true)
    setShowPrintMenu(false)
    try {
      const [{ generarOrdenDespachoPDF }, itemsFinal] = await Promise.all([
        import('../../services/pdf/ordenDespachoPDF'),
        fetchItemsDespacho(),
      ])
      const { blob, filename } = await generarOrdenDespachoPDF({
        despacho, items: itemsFinal, config,
        formaPago: despacho.forma_pago || '',
        monedaPDF: monedaPdf, tasa: tasaImpresion,
        tasaUsdt: tasaUsdt.precio, tasaBcv: tasaBcv.precio,
        returnBlob: true,
        porcentaje: parsePorcentaje(porcentajePdf),
      })

      const clienteObj = despacho.cliente_factura || despacho.cliente
      const mensaje = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteObj?.nombre,
        numDisplay,
        totalUsd: totalFinal,
        nombreVendedor: despacho.vendedor?.nombre,
        tipo: 'Orden de Despacho'
      })

      await compartirPorWhatsApp({
        pdfBlob: blob,
        pdfFilename: filename,
        telefono: clienteObj?.telefono,
        mensaje,
        mensajeParams: {
          nombreNegocio: config.nombre_negocio,
          nombreCliente: clienteObj?.nombre,
          numDisplay,
          totalUsd: totalFinal,
          nombreVendedor: despacho.vendedor?.nombre,
          tipo: 'Orden de Despacho'
        }
      })
    } catch (err) {
      showToast('Error al compartir orden: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  // ── Acción primaria para móvil ──
  function getPrimaryAction() {
    if (canDespachar) {
      const cfg = getDespachoAction('despachar', rol)
      return { key: 'despachar', label: cfg.label || 'Aprobar despacho', icon: Truck, action: () => setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }) }
    }
    if (canEntregar) {
      const cfg = getDespachoAction('entregar', rol)
      return { key: 'entregar', label: cfg?.label || 'Marcar entregada', icon: CheckCircle, action: () => setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg || { label: 'Marcar entregada', confirm: '¿Confirmar entrega realizada?', color: 'emerald' } }) }
    }
    if (canReciclar) {
      const cfg = getDespachoAction('reciclar', rol)
      return { key: 'reciclar', label: cfg.label || 'Reutilizar', icon: RefreshCcw, action: () => onReciclar(despacho) }
    }
    return null
  }

  const primaryAction = getPrimaryAction()
  const pColors = primaryAction ? PRIMARY_ACTION_COLORS[primaryAction.key] || PRIMARY_ACTION_COLORS.ver : {}

  // ── Acciones para Más (bottom sheet móvil + dropdown desktop) ──
  function getMoreActions() {
    const actions = []
    // if (canDescuento)
    //   actions.push({ label: `Descuento${descuentoTotal > 0 ? ' ✓' : ''}`, icon: Tag, onClick: () => setShowDescuento(true), textColor: 'text-amber-600' })
    if (canDespachar && primaryAction?.key !== 'despachar') {
      const cfg = getDespachoAction('despachar', rol)
      actions.push({ label: cfg.label || 'Aprobar despacho', icon: Truck, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'despachada', actionConfig: cfg }), textColor: 'text-blue-600' })
    }
    if (canEntregar && primaryAction?.key !== 'entregar') {
      const cfg = getDespachoAction('entregar', rol)
      actions.push({ label: cfg?.label || 'Marcar entregada', icon: CheckCircle, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'entregada', actionConfig: cfg || { label: 'Marcar entregada', confirm: '¿Confirmar entrega realizada?', color: 'emerald' } }), textColor: 'text-emerald-600' })
    }
    if (canDevolver) {
      const baseCfg = getDespachoAction('devolver', rol)
      const cfg = despacho.estado === 'entregada' ? {
        ...baseCfg,
        label: 'Reabrir despacho',
        confirmTitle: '¿Reabrir despacho entregado?',
        confirmMessage: 'El despacho regresará al estado "Por Aprobar" (pendiente) y se reversarán el stock, comisiones y CxC.',
        confirmDetails: 'Deberás proporcionar el motivo de la reapertura.',
        confirmText: 'Sí, reabrir despacho',
      } : baseCfg
      actions.push({ label: cfg.label || 'No entregado', icon: RotateCcw, onClick: () => setAccionPendiente({ id: despacho.id, estado: 'pendiente', isDevolver: true, actionConfig: cfg }), textColor: 'text-amber-600' })
    }
    if (canReciclar && primaryAction?.key !== 'reciclar')
      actions.push({ label: getDespachoAction('reciclar', rol).label || 'Reutilizar', icon: RefreshCcw, onClick: () => onReciclar(despacho), textColor: 'text-teal-600' })
    
    const canCambiarTransportista = esLogistica && ['pendiente', 'despachada', 'entregada'].includes(despacho.estado)
    if (canCambiarTransportista) {
      const tieneTransportista = !!despacho?.transportista_id
      actions.push({
        label: tieneTransportista ? 'Cambiar Transportista' : 'Agregar Transportista',
        icon: Truck,
        onClick: () => setShowCambiarTransportista(true),
        textColor: 'text-indigo-600'
      })
    }

    // Conciliación de Cobro a destino (solo Admin o Dev)

    const esAdminConciliador = ['administracion', 'desarrollador', 'supervisor', 'jefe'].includes(rol)
    const canConciliarCod = esAdminConciliador && isCodUnpaid && ['despachada', 'entregada'].includes(despacho.estado)
    if (canConciliarCod) {
      actions.push({
        label: 'Marcar COD como pagado',
        icon: DollarSign,
        onClick: () => setShowConciliarCod(true),
        textColor: 'text-rose-600 font-bold'
      })
    }

    if (canDevolucionParcial) {
      actions.push({
        label: 'Devolución Parcial',
        icon: PackageX,
        onClick: () => setShowDevolucionParcial(true),
        textColor: 'text-amber-600 font-medium'
      })
    }

    if (perfil?.rol === 'logistica' || perfil?.rol === 'desarrollador' || perfil?.rol === 'jefe') {
      const tieneNota = !!despacho.notes?.trim() || !!despacho.notas?.trim()
      actions.push({
        label: tieneNota ? 'Editar/Eliminar observación' : 'Agregar observación',
        icon: MessageCircle,
        onClick: () => {
          setNuevaNota(despacho.notas || '')
          setShowNotaModal(true)
        },
        textColor: 'text-slate-700'
      })
    }

    return actions
  }

  const moreActions = getMoreActions()
  const bottomActions = moreActions.filter(act => 
    act.label !== 'Reabrir despacho' && 
    act.label !== 'No entregado' && 
    act.label !== 'No entregado / Devolver' &&
    act.label !== 'Cambiar Transportista' &&
    act.label !== 'Agregar Transportista' &&
    act.label !== 'Marcar COD como pagado' &&
    act.label !== 'Devolución Parcial' &&
    !act.label.includes('observación')
  )

  // Resolver config del confirm modal
  const confirmConfig = accionPendiente?.actionConfig || {}

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 flex flex-col">

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative shrink-0 flex flex-col gap-1.5 px-3 py-2 rounded-t-2xl overflow-hidden"
        title={despacho.vendedor?.nombre ? `Vendedor: ${despacho.vendedor.nombre}` : undefined}
        style={{ background: `linear-gradient(135deg, ${vendedorColor}ee 0%, ${vendedorColor}99 100%)` }}>
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />
        
        {/* Fila 1: ID y Kebab */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="font-black text-white font-mono leading-none drop-shadow text-sm sm:text-base">{numDisplay}</p>
            {tieneSeguimientoActivo && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (esAdministracion && tieneSeguimientoFijado) {
                    setShowFijadoModal(true);
                  } else {
                    setShowDetalle(true);
                  }
                }}
                className="cursor-pointer text-rose-500 hover:text-rose-600 bg-white shrink-0 transition-transform active:scale-95 flex items-center justify-center h-6 w-6 rounded-full shadow-sm hover:shadow-md ml-1"
                title="Seguimiento activo o fijado (Ver detalle)"
              >
                <Mail className="animate-envelope-vibrate" size={14} strokeWidth={2} />
              </button>
            )}
            {isCodUnpaid && (
              <span className="bg-rose-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded border border-rose-400/50 shadow-sm uppercase tracking-wider animate-pulse leading-none shrink-0 select-none">
                COD
              </span>
            )}
            {isCodPaid && (
              <span className="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded border border-emerald-400/50 shadow-sm uppercase tracking-wider leading-none shrink-0 select-none">
                COD ✓
              </span>
            )}
            {tienePrestamos && (
              totalFinal <= 0.015 ? (
                <span className="inline-flex items-center gap-1 bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded border border-emerald-400/50 shadow-sm uppercase tracking-wider leading-none shrink-0 select-none" title="Todos los materiales son de préstamo">
                  <Handshake size={10} /> Préstamo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-teal-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded border border-teal-400/50 shadow-sm uppercase tracking-wider leading-none shrink-0 select-none" title="Contiene artículos vendidos y artículos prestados">
                  <Handshake size={10} /> Mixto
                </span>
              )
            )}
            {despacho.tiene_devoluciones && (
              <span className="inline-flex items-center gap-1 bg-amber-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded border border-amber-400/50 shadow-sm uppercase tracking-wider leading-none shrink-0 select-none" title="Este despacho tiene devoluciones parciales registradas">
                Devolución
              </span>
            )}
          </div>
          {/* Kebab ⋮ — acciones secundarias */}
          {(moreActions.length > 0 || canAnular) && (
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

        {/* Fila 2: EstadoBadge */}
        <div className="relative z-10 flex items-center">
          <EstadoBadge estado={despacho.estado} rol={rol} />
        </div>
      </div>

      {/* Banner de Cobro a destino (Pendiente) */}
      {isCodUnpaid && (
        <div className="bg-rose-50/90 border-b border-rose-100 px-3 py-2 flex items-center justify-between animate-fade-in duration-200">
          <div className="flex items-center gap-1.5 text-rose-600 font-extrabold text-[11px] uppercase tracking-wider">
            <Truck size={14} className="shrink-0 text-rose-500 animate-bounce" style={{ animationDuration: '2s' }} />
            <span>Cobro a Destino (Pendiente)</span>
          </div>
          <span className="text-[9px] bg-rose-500 text-white font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shadow-sm shadow-rose-500/10">
            COD
          </span>
        </div>
      )}

      {/* Banner de Cobro a destino (Pagado) */}
      {isCodPaid && (
        <div className="bg-emerald-50/95 border-b border-emerald-100 px-3 py-2 flex items-center justify-between animate-fade-in duration-200">
          <div className="flex items-center gap-1.5 text-emerald-600 font-extrabold text-[11px] uppercase tracking-wider">
            <CheckCircle size={14} className="shrink-0 text-emerald-500" />
            <span>Cobro a Destino (Pagado ✓)</span>
          </div>
          <span className="text-[9px] bg-emerald-500 text-white font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shadow-sm shadow-emerald-500/10">
            PAGADO
          </span>
        </div>
      )}

      {/* ── Fecha relevante + Cliente ── */}
      <div className="px-3 pt-2 pb-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Calendar size={11} />
          {despacho.estado === 'entregada' && despacho.entregada_en
            ? <span className="text-teal-500 font-medium">Entregada {fmtFechaHora(despacho.entregada_en)}</span>
            : despacho.estado === 'despachada' && despacho.despachada_en
              ? <span className="text-indigo-400 font-medium">Despachada {fmtFechaHora(despacho.despachada_en)}</span>
              : <span>{fmtFechaHora(despacho.creado_en)}</span>
          }
        </div>
        {(despacho.cliente_factura || despacho.cliente)?.nombre && (
          <div className="space-y-1">
            <p className="text-sm font-bold leading-snug"
              style={{ color: (despacho.cliente_factura || despacho.cliente).vendedor?.color || '#334155' }}>
              {(despacho.cliente_factura || despacho.cliente).nombre}
            </p>
            {esPrivilegiado && despacho.vendedor && (
              esVendedorExterno ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#FEF3C7', color: '#B45309', border: '1px solid #FDE68A' }}>
                  💼 {despacho.vendedor.nombre} <span className="text-[9px] px-1 py-0.2 bg-[#B45309] text-white rounded font-extrabold uppercase">Ext</span>
                </span>
              ) : (
                <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: vendedorColor + '18', color: vendedorColor, border: `1px solid ${vendedorColor}40` }}>
                  {despacho.vendedor.nombre}
                </span>
              )
            )}
          </div>
        )}
        {despacho.transportista?.nombre && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Truck size={11} className="shrink-0" />
            <span className="truncate">{despacho.transportista.nombre}</span>
          </div>
        )}
        {isCtaPorCobrar && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 font-medium mt-0.5">
            <CreditCard size={11} className="shrink-0" />
            <span>
              {isMixtoCxc 
                ? `Mixto (${metodosPagoList.join(' + ')})` 
                : 'Cta. por cobrar'
              }
              {textVencimiento ? ` - ${textVencimiento}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* ── Total + Flete + Corte ── */}
      <div className="mx-3 mb-2 bg-slate-50 rounded-xl px-3 py-2 space-y-1">
        {(fleteUsd > 0 || corteUsd > 0 || descuentoPersonal > 0) && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">Subtotal</span>
              <span className="text-xs font-semibold text-slate-500">{fmtUsd(subtotalOriginal)}</span>
            </div>
            {descuentoPersonal > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-amber-600">Desc. Personal ({descPersonalPct}%)</span>
                <span className="text-xs font-semibold text-amber-700">-{fmtUsd(descuentoPersonal)}</span>
              </div>
            )}
            {fleteUsd > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400">Flete</span>
                <span className="text-xs font-semibold text-emerald-600">+{fmtUsd(fleteUsd)}</span>
              </div>
            )}
            {corteUsd > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400">Corte</span>
                <span className="text-xs font-semibold text-emerald-600">+{fmtUsd(corteUsd)}</span>
              </div>
            )}
          </>
        )}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Total</span>
            {despacho.items_count?.[0] && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowDetalle(true); }}
                className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 mt-0.5 cursor-pointer hover:text-indigo-600 hover:underline transition-all"
              >
                <PackageCheck size={11} />
                {despacho.items_count[0].count} {despacho.items_count[0].count === 1 ? 'Ítem' : 'Ítems'}
              </button>
            )}
          </div>
          <div className="text-right">
            {(descuentoTotal > 0 || descuentoPersonal > 0) ? (
              <>
                <span className="text-xs text-slate-400 line-through mr-1.5">{fmtUsd(totalOriginal)}</span>
                <span className="text-lg font-bold text-amber-700">{fmtUsd(totalFinal)}</span>
                {tasa > 0 && totalFinal > 0 && (
                  <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(totalFinal, tasa))}</div>
                )}
              </>
            ) : (
              <>
                <span className="text-lg font-bold text-slate-800">{fmtUsd(totalBruto)}</span>
                {tasa > 0 && totalBruto > 0 && (
                  <div className="text-[11px] text-slate-400">{fmtBs(usdToBs(totalBruto, tasa))}</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Banner Advertencia Stock (Admin) */}
      {hayFaltaStock && ['pendiente', 'despachada'].includes(despacho.estado) && esPrivilegiado && (
        <div className="mx-3 mb-2 p-2 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-700 animate-in slide-in-from-top-2 duration-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-[10px] font-black uppercase leading-tight">Stock insuficiente en {itemsFaltantes.length} ítem(s)</span>
        </div>
      )}

      {/* ══════════ MOBILE ACTIONS (< md) ══════════ */}
      <div className="md:hidden mt-auto border-t border-slate-100 p-2.5">
        {/* Botón primario — full width */}
        {primaryAction && (
          <button
            onClick={primaryAction.action}
            disabled={estadoCambiando}
            className={`w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${pColors.bg} ${pColors.text} ${pColors.active}`}
          >
            {estadoCambiando
              ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <primaryAction.icon size={16} />
            }
            {primaryAction.label}
          </button>
        )}

        {/* Fila de acciones: Imprimir + Descargar + Editar + Más */}
        <div className="flex items-center gap-0.5 mt-2 flex-wrap -mx-1 px-1">
          {/* Imprimir */}
          <button ref={printBtnRef} onClick={() => { setShowPrintMenu(v => !v); setShowDownloadMenu(false) }}
            disabled={printLoading}
            className="flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 shrink-0">
            {printLoading ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Printer size={13} />}
            Imprimir <ChevronDown size={9} />
          </button>

          {/* Descargar */}
          <button ref={downloadBtnRef} onClick={() => { setShowDownloadMenu(v => !v); setShowPrintMenu(false) }}
            disabled={pdfLoading || ordenLoading || guiaLoading}
            className="flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 shrink-0">
            {(pdfLoading || ordenLoading || guiaLoading) ? <div className="w-3 h-3 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Download size={13} />}
            Descargar <ChevronDown size={9} />
          </button>

          {canEditar && (
            <button onClick={() => setShowEdit(true)}
              className="flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0">
              <Pencil size={13} /> Editar
            </button>
          )}

          {bottomActions.length === 1 ? (
            <button onClick={bottomActions[0].onClick}
              className="ml-auto flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors shrink-0">
              {bottomActions[0].icon && (() => { const Icon = bottomActions[0].icon; return <Icon size={13} />; })()} {bottomActions[0].label}
            </button>
          ) : bottomActions.length > 1 ? (
            <button onClick={() => setShowSheet(true)}
              className="ml-auto flex items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 active:bg-slate-100 transition-colors shrink-0">
              <MoreHorizontal size={13} /> Más
            </button>
          ) : null}
        </div>

        {/* Popover Imprimir — fixed posicionado sobre el botón */}
        {showPrintMenu && (() => {
          const r = printBtnRef.current?.getBoundingClientRect()
          const style = r ? { position: 'fixed', left: r.left, bottom: window.innerHeight - r.top + 4, zIndex: 50 } : { position: 'fixed', left: 16, bottom: 80, zIndex: 50 }
          return <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPrintMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
              {renderMonedaSelector()}
              <button onClick={imprimirDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Printer size={14} className="text-slate-400" /> Nota de Entrega
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
              </button>
              <button onClick={imprimirOrdenDespacho}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Printer size={14} className="text-slate-400" /> Orden de Despacho
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
              </button>
              {esLogistica && (
                <>
                  <button onClick={() => { setShowPrintMenu(false); abrirFacturaModal('print') }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 active:bg-slate-100 text-left border-t border-slate-100">
                    <Printer size={14} className="text-slate-400" /> Factura
                    <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                      {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                    </span>
                  </button>
                  <button onClick={imprimirGuiaDespacho}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 active:bg-slate-100 text-left border-t border-slate-100">
                    <Printer size={14} className="text-slate-400" /> Guía de Despacho
                  </button>
                </>
              )}
            </div>
          </>
        })()}

        {/* Popover Descargar — fixed posicionado sobre el botón */}
        {showDownloadMenu && (() => {
          const r = downloadBtnRef.current?.getBoundingClientRect()
          const style = r ? { position: 'fixed', left: r.left, bottom: window.innerHeight - r.top + 4, zIndex: 50 } : { position: 'fixed', left: 16, bottom: 80, zIndex: 50 }
          return <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDownloadMenu(false)} />
            <div style={style} className="w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1">
              {renderMonedaSelector()}
              <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Download size={14} /> Nota de Entrega
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
              </button>
              <button onClick={() => { descargarOrdenDespacho(); setShowDownloadMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 text-left">
                <Download size={14} /> Orden de Despacho
                <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                  {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                </span>
              </button>
              {esLogistica && (
                <>
                  <button onClick={() => { setShowDownloadMenu(false); abrirFacturaModal('download') }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 text-left border-t border-slate-100">
                    <Download size={14} /> Factura
                    <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                      {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                    </span>
                  </button>
                  <button onClick={() => { descargarGuiaDespacho(); setShowDownloadMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 text-left border-t border-slate-100">
                    <Download size={14} /> Guía de Despacho
                  </button>
                </>
              )}
            </div>
          </>
        })()}

        {bottomActions.length > 1 && (
        <MobileActionSheet
          isOpen={showSheet}
          onClose={() => setShowSheet(false)}
          actions={bottomActions}
        />
        )}
      </div>

      {/* ══════════ DESKTOP ACTIONS (md+) ══════════ */}
      <div className="hidden md:flex mt-auto border-t border-slate-100 px-3 py-2 items-center gap-1 flex-wrap">
        {/* Botón primario */}
        {primaryAction && (
          <button onClick={primaryAction.action}
            disabled={estadoCambiando}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 whitespace-nowrap ${pColors.bg} ${pColors.text} ${pColors.active}`}>
            {estadoCambiando ? <Loader2 size={12} className="animate-spin" /> : <primaryAction.icon size={12} />}
            {primaryAction.label}
          </button>
        )}

        {/* Imprimir dropdown */}
        <div className="relative">
          <button onClick={() => { setShowPrintMenu(v => !v); setShowDownloadMenu(false) }}
            disabled={printLoading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
            {printLoading ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
            Imprimir <ChevronDown size={9} />
          </button>
          {showPrintMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPrintMenu(false)} />
              <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20">
                {renderMonedaSelector()}
                <button onClick={imprimirDespacho}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Printer size={14} className="text-slate-400" /> Nota de Entrega
                  <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                    {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                  </span>
                </button>
                <button onClick={imprimirOrdenDespacho}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Printer size={14} className="text-slate-400" /> Orden de Despacho
                  <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                    {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                  </span>
                </button>
                {esLogistica && (
                  <>
                    <button onClick={() => { setShowPrintMenu(false); abrirFacturaModal('print') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                      <Printer size={14} className="text-slate-400" /> Factura
                      <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                        {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                      </span>
                    </button>
                    <button onClick={imprimirGuiaDespacho}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                      <Printer size={14} className="text-slate-400" /> Guía de Despacho
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Descargar dropdown */}
        <div className="relative">
          <button onClick={() => { setShowDownloadMenu(v => !v); setShowPrintMenu(false) }}
            disabled={pdfLoading || ordenLoading || guiaLoading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 whitespace-nowrap">
            {(pdfLoading || ordenLoading || guiaLoading) ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Descargar <ChevronDown size={9} />
          </button>
          {showDownloadMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowDownloadMenu(false)} />
              <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20">
                {renderMonedaSelector()}
                <button onClick={() => { descargarPDF(); setShowDownloadMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Download size={14} /> Nota de Entrega
                  <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                    {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                  </span>
                </button>
                <button onClick={() => { descargarOrdenDespacho(); setShowDownloadMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left">
                  <Download size={14} /> Orden de Despacho
                  <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                    {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                  </span>
                </button>
                {esLogistica && (
                  <>
                    <button onClick={() => { setShowDownloadMenu(false); abrirFacturaModal('download') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                      <Download size={14} /> Factura
                      <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded leading-none ${monedaPdf === 'bs' ? 'text-blue-600 bg-blue-50 border border-blue-200' : monedaPdf === 'bcv' ? 'text-teal-600 bg-teal-50 border border-teal-200' : 'text-emerald-600 bg-emerald-50 border border-emerald-200'}`}>
                        {monedaPdf === 'bs' ? 'Bs' : monedaPdf === 'bcv' ? 'BCV' : '$'}
                      </span>
                    </button>
                    <button onClick={() => { descargarGuiaDespacho(); setShowDownloadMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100">
                      <Download size={14} /> Guía de Despacho
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {canEditar && (
          <button onClick={() => setShowEdit(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors whitespace-nowrap">
            <Pencil size={12} /> Editar
          </button>
        )}

        {/* Más (···) dropdown desktop — o botón directo si solo hay 1 acción */}
        {bottomActions.length === 1 ? (
          <button onClick={bottomActions[0].onClick}
            className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 transition-colors whitespace-nowrap">
            {bottomActions[0].icon && (() => { const Icon = bottomActions[0].icon; return <Icon size={12} />; })()} {bottomActions[0].label}
          </button>
        ) : bottomActions.length > 1 ? (
          <div className="relative ml-auto">
            <button onClick={() => setShowMoreMenu(v => !v)}
              onBlur={() => setTimeout(() => setShowMoreMenu(false), 200)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:bg-slate-50 transition-colors whitespace-nowrap">
              <MoreHorizontal size={12} /> Más
            </button>
            {showMoreMenu && (
              <div className="absolute right-0 bottom-full mb-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20"
                onMouseDown={e => e.preventDefault()}>
                {bottomActions.map((act, i) => (
                  <Fragment key={i}>
                    {act.danger && <div className="border-t border-slate-100 my-1" />}
                    <button onClick={() => { act.onClick(); setShowMoreMenu(false) }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${act.danger ? 'text-red-500 hover:bg-red-50' : act.textColor ? `${act.textColor} hover:bg-slate-50` : 'text-slate-700 hover:bg-slate-50'}`}>
                      {act.icon && <act.icon size={14} />} {act.label}
                    </button>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Confirm despachar / entregada — con detalles de consecuencias */}
      <ConfirmModal
        isOpen={!!accionPendiente && !accionPendiente.isDevolver && !accionPendiente.isAnular}
        onClose={() => setAccionPendiente(null)}
        onConfirm={async () => {
          if (!accionPendiente) return
          await onCambiarEstado(accionPendiente.id, accionPendiente.estado)
          setAccionPendiente(null)
        }}
        title={confirmConfig.confirmTitle || (accionPendiente?.estado === 'despachada' ? '¿Marcar como despachada?' : '¿Marcar como entregada?')}
        message={
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-center">
              {esVendedorSinComision ? (
                <span className="inline-flex items-center justify-center gap-1.5 bg-slate-100/70 border border-slate-200 px-3 py-1 rounded-full text-[11px] font-bold text-slate-500 shadow-sm">
                  🏢 Venta directa de la empresa. No genera comisiones.
                </span>
              ) : (
                confirmConfig.confirmMessage || `El despacho ${numDisplay} cambiará de estado.`
              )}
            </p>
            
            {accionPendiente?.estado === 'despachada' && (() => {
              const isPrestamoPuroAccion = itemsDespacho.length > 0 && itemsDespacho.every(it => it.es_prestamo)
              const hasPrestamos = itemsDespacho.some(it => it.es_prestamo)
              
              // Ajustar valores si es préstamo puro
              const subtotalAjustado = isPrestamoPuroAccion ? 0 : subtotalProductos
              const fleteAjustado = isPrestamoPuroAccion ? 0 : fleteUsd
              const corteAjustado = isPrestamoPuroAccion ? 0 : corteUsd
              const descuentoAjustado = isPrestamoPuroAccion ? 0 : descuentoTotal
              const totalAjustado = isPrestamoPuroAccion ? 0 : totalFinal

              return (
                <>
                  <div className="w-full text-left bg-slate-50 p-3 rounded-xl text-sm border border-slate-200 mt-2 shadow-sm">
                    <h4 className="font-bold text-slate-700 border-b border-slate-200 pb-1.5 mb-2">Resumen de la Operación</h4>
                    
                    {hasPrestamos && (() => {
                      const todosPrestamo = itemsDespacho.every(it => it.es_prestamo);
                      const itemsPrestamo = itemsDespacho.filter(it => it.es_prestamo);
                      return (
                        <div className={`mb-3 p-2.5 rounded-xl border flex flex-col gap-1.5 ${
                          todosPrestamo ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-teal-50 border-teal-200 text-teal-800'
                        }`}>
                          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-[10px]">
                            <Handshake size={14} className={todosPrestamo ? 'text-emerald-600' : 'text-teal-600'} />
                            <span>{todosPrestamo ? 'Préstamo Puro' : 'Tiene Productos a Préstamo'}</span>
                          </div>
                          <p className={`text-[10px] leading-snug ${todosPrestamo ? 'text-emerald-700' : 'text-teal-700'}`}>
                            {todosPrestamo
                              ? 'Este despacho consiste enteramente en préstamos de materiales.'
                              : 'Este despacho contiene los siguientes materiales en préstamo:'
                            }
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1 max-h-24 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200/60">
                            {itemsPrestamo.map((it, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[9px] font-bold px-1.5 py-0.5 rounded">
                                <Handshake size={8} /> {it.nombre_snap} ({it.cantidad} {it.unidad_snap || 'und'})
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                      <span className="text-slate-500">Cliente:</span>
                      <span className="font-semibold text-slate-800 text-right line-clamp-2">{(despacho.cliente_factura || despacho.cliente)?.nombre || 'N/A'}</span>
                      
                      <span className="text-slate-500">Vendedor:</span>
                      <span className="font-semibold text-slate-800 text-right truncate">{despacho.vendedor?.nombre || 'N/A'}</span>

                      {despacho.transportista?.nombre && (
                        <>
                          <span className="text-slate-500">Transporte:</span>
                          <span className="font-semibold text-slate-800 text-right truncate">{despacho.transportista.nombre}</span>
                        </>
                      )}

                      <span className="col-span-2 border-t border-slate-200 my-0.5"></span>

                      <span className="text-slate-500">Subtotal:</span>
                      <span className="font-medium text-slate-700 text-right">{fmtUsd(subtotalAjustado)}</span>
                      
                      {fleteAjustado > 0 && (
                        <>
                          <span className="text-slate-500">Flete:</span>
                          <span className="font-medium text-emerald-600 text-right">+{fmtUsd(fleteAjustado)}</span>
                        </>
                      )}
                      
                      {corteAjustado > 0 && (
                        <>
                          <span className="text-slate-500">Corte:</span>
                          <span className="font-medium text-emerald-600 text-right">+{fmtUsd(corteAjustado)}</span>
                        </>
                      )}

                      {descuentoAjustado > 0 && (
                        <>
                          <span className="text-slate-500">Descuento:</span>
                          <span className="font-medium text-amber-600 text-right">-{fmtUsd(descuentoAjustado)}</span>
                        </>
                      )}

                      <span className="col-span-2 border-t border-slate-200 my-0.5"></span>

                      <span className="font-bold text-slate-700 text-[13px] pt-0.5">Total USD:</span>
                      <span className="font-black text-slate-800 text-right text-[14px]">{fmtUsd(totalAjustado)}</span>
                    </div>
                  </div>

                  <div className="w-full text-left bg-slate-50 p-3 rounded-xl text-sm border border-slate-200 mt-2 shadow-sm">
                    <h4 className="font-bold text-slate-700 border-b border-slate-200 pb-1.5 mb-2">
                      Advertencias antes de {accionPendiente?.estado === 'despachada' ? 'aprobar' : 'entregar'}
                    </h4>
                    <div className="space-y-2 text-xs">
                      {accionPendiente?.estado === 'entregada' && (
                        <div className="flex items-start gap-2">
                          <PackageCheck size={14} className="text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-slate-600"><strong>Inventario:</strong> Los productos se descontarán definitivamente del stock.</p>
                        </div>
                      )}
                      {accionPendiente?.estado === 'despachada' && (
                        <div className="flex items-start gap-2">
                          <PackageCheck size={14} className="text-blue-500 shrink-0 mt-0.5" />
                          <p className="text-slate-600"><strong>Estado:</strong> El despacho se marcará como aprobado y listo para entregar.</p>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <DollarSign size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                        <p className="text-slate-600"><strong>Comisiones:</strong> La comisión del vendedor se consolidará para pago.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                        <p className="text-slate-600"><strong>Irreversible:</strong> No se podrán hacer cambios después de {accionPendiente?.estado === 'despachada' ? 'aprobar' : 'entregar'}.</p>
                      </div>
                    </div>
                    
                    <h4 className="font-bold text-slate-700 border-b border-slate-200 pb-1.5 mb-2 mt-4">
                      {accionPendiente?.estado === 'despachada' ? 'Productos a Despachar' : 'Productos a Descontar'}
                    </h4>
                    {loadingItems ? (
                      <p className="text-xs text-slate-400">Cargando ítems...</p>
                    ) : (
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {itemsDespacho.map((it, idx) => (
                          <div key={idx} className="flex justify-between text-xs text-slate-600">
                            <span className="truncate max-w-[200px]">{it.nombre_snap}</span>
                            <span className="font-bold">{it.cantidad} {it.unidad_snap || 'und'}</span>
                          </div>
                        ))}
                        {itemsDespacho.length === 0 && (
                          <p className="text-xs text-slate-400">No hay ítems registrados.</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )
            })()}

            {isCtaPorCobrar && accionPendiente?.estado === 'despachada' && (
              <div className="w-full p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 font-bold text-xs flex items-center gap-2 mt-1">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="text-left">Este despacho generará una Cuenta por Cobrar.</span>
              </div>
            )}

            {hayFaltaStock && accionPendiente?.estado === 'despachada' && (
              <div className="w-full p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-600 font-bold text-xs flex items-center gap-2 mt-1">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="text-left">Hay productos sin stock suficiente. ¿Aprobar de todas formas?</span>
              </div>
            )}
          </div>
        }
        details={confirmConfig.confirmDetails || ''}
        confirmText={confirmConfig.confirmText || 'Confirmar'}
        variant={hayFaltaStock && accionPendiente?.estado === 'despachada' ? 'warning' : (confirmConfig.variant || 'default')}
      />

      {/* Modal especial para Devolver o Anular desde "despachada" */}
      <DevolverAnularModal
        isOpen={!!accionPendiente && (accionPendiente.isDevolver || accionPendiente.isAnular)}
        onClose={() => setAccionPendiente(null)}
        onConfirm={async (estadoDestino, motivo) => {
          if (!accionPendiente) return
          if (accionPendiente.isDevolver) {
            await onCambiarEstado(accionPendiente.id, estadoDestino, motivo, null)
          } else {
            await onCambiarEstado(accionPendiente.id, estadoDestino, null, motivo)
          }
          setAccionPendiente(null)
        }}
        accion={accionPendiente}
        despachoNum={numDisplay}
        isLoading={estadoCambiando}
      />

      <DetalleModal
        isOpen={showDetalle}
        onClose={() => setShowDetalle(false)}
        tipo="despacho"
        registro={despacho}
        tasa={tasa}
      />

      <SeguimientoFijadoModal
        isOpen={showFijadoModal}
        onClose={() => setShowFijadoModal(false)}
        despachoId={despacho.id}
        clienteId={despacho.cliente_id}
        entradas={despacho.seguimiento || []}
      />

      <DescuentoModal
        isOpen={showDescuento}
        onClose={() => setShowDescuento(false)}
        despacho={despacho}
      />

      <EditDespachoModal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        despacho={despacho}
      />

      <CambiarTransportistaModal
        isOpen={showCambiarTransportista}
        onClose={() => setShowCambiarTransportista(false)}
        despacho={despacho}
      />

      <ConciliarCodModal
        isOpen={showConciliarCod}
        onClose={() => setShowConciliarCod(false)}
        despacho={despacho}
      />

      <FacturaModal
        isOpen={showFacturaModal}
        onClose={() => setShowFacturaModal(false)}
        onConfirm={generarFacturaConDatos}
        actionType={facturaActionType}
        loading={pdfLoading || printLoading}
      />

      <DevolucionParcialModal
        isOpen={showDevolucionParcial}
        onClose={() => setShowDevolucionParcial(false)}
        despacho={despacho}
      />

      {/* Modal para agregar/editar observación (Solo Logística) */}
      <Modal
        isOpen={showNotaModal}
        onClose={() => setShowNotaModal(false)}
        title={`${despacho?.notas ? 'Editar/Eliminar' : 'Agregar'} observación — Despacho #${despacho?.numero}`}
        className="sm:max-w-md"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Observación / Nota interna:
            </p>
            <textarea
              value={nuevaNota}
              onChange={e => setNuevaNota(e.target.value)}
              placeholder="Escribe la observación para esta nota de entrega..."
              rows={4}
              disabled={editarDespacho.isPending}
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium resize-none"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 shrink-0">
            {despacho.notas ? (
              <button
                type="button"
                onClick={handleEliminarNota}
                disabled={editarDespacho.isPending}
                className="px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Eliminar Nota
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNotaModal(false)}
                disabled={editarDespacho.isPending}
                className="px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGuardarNota}
                disabled={editarDespacho.isPending}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 rounded-lg transition-all"
              >
                {editarDespacho.isPending ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Guardar Observación'
                )}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Menú kebab ⋮ — nivel raíz, fixed para escapar overflow:hidden ── */}
      {showAdminMenu && (moreActions.length > 0 || canAnular) && (() => {
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
            {canAnular && (
              <>
                {moreActions.length > 0 && <div className="border-t border-slate-100 my-1" />}
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setShowAdminMenu(false)
                    onAnular(despacho)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 text-left"
                >
                  <Ban size={14} /> Anular despacho
                </button>
              </>
            )}
          </div>
        </>
      })()}
    </div>
  )
})
