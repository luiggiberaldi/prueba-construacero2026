import { useState, useEffect, useRef } from 'react'
import { Modal } from '../ui/Modal'
import { AlertCircle, RotateCcw, FileText, CheckCircle, Package, Trash2, Plus } from 'lucide-react'
import CustomSelect from '../ui/CustomSelect'
import supabase from '../../services/supabase/client'
import { useDevolucionParcialDespacho } from '../../hooks/useDespachos'
import { useInventario } from '../../hooks/useInventario'
import ProductoAutocomplete from '../cotizaciones/ProductoAutocomplete'
import { showToast } from '../ui/Toast'

export default function DevolucionParcialModal({ isOpen, onClose, despacho }) {
  const [loading, setLoading] = useState(false)
  const [itemsList, setItemsList] = useState([])
  const [motivoSelect, setMotivoSelect] = useState('')
  const [motivoText, setMotivoText] = useState('')
  const [generarReemplazo, setGenerarReemplazo] = useState(false)
  const [confirmarKardex, setConfirmarKardex] = useState(false)

  // --- Estados para intercambio de productos ---
  const [realizarIntercambio, setRealizarIntercambio] = useState(false)
  const [exchangeItems, setExchangeItems] = useState([])
  const [clienteInfo, setClienteInfo] = useState(null)

  const lastValuesRef = useRef({})
  const mutation = useDevolucionParcialDespacho()

  // Cargar catálogo de productos localmente para el intercambio
  const { data: catalogoRes } = useInventario({ pageSize: 1500 })
  const productosCatalog = catalogoRes?.productos || []

  useEffect(() => {
    if (isOpen && despacho?.id) {
      setItemsList([])
      setMotivoSelect('')
      setMotivoText('')
      setGenerarReemplazo(false)
      setConfirmarKardex(false)
      setRealizarIntercambio(false)
      setExchangeItems([])
      setClienteInfo(null)
      lastValuesRef.current = {}
      fetchItemsAndDevoluciones()
    }
  }, [isOpen, despacho])

  const fetchItemsAndDevoluciones = async () => {
    setLoading(true)
    try {
      const clienteId = despacho.cliente_factura_id || despacho.cliente_id;
      const [itemsRes, devRes, clRes] = await Promise.all([
        supabase.from('notas_despacho_items').select('*').eq('despacho_id', despacho.id).order('orden', { ascending: true }),
        supabase.from('despacho_devoluciones').select('despacho_item_id, cantidad_devuelta').eq('despacho_id', despacho.id),
        supabase.from('clientes').select('nombre, saldo_pendiente, saldo_a_favor').eq('id', clienteId).maybeSingle()
      ])

      if (itemsRes.error) throw itemsRes.error
      if (devRes.error) throw devRes.error

      if (clRes && !clRes.error && clRes.data) {
        setClienteInfo(clRes.data)
      }

      const itemsData = itemsRes.data || []
      const devData = devRes.data || []

      const returnedQtyMap = {}
      devData.forEach(d => {
        returnedQtyMap[d.despacho_item_id] = (returnedQtyMap[d.despacho_item_id] || 0) + Number(d.cantidad_devuelta)
      })

      const mappedItems = itemsData.map(item => {
        const alreadyReturned = returnedQtyMap[item.id] || 0
        const maxReturnable = Number(item.cantidad) - alreadyReturned
        return {
          ...item,
          alreadyReturned,
          maxReturnable: Math.max(0, maxReturnable),
          cantidad_devolver: '',
          selected: false
        }
      })

      setItemsList(mappedItems)
    } catch (err) {
      console.error('[DEVOLUCION_MODAL] Error al cargar detalles:', err)
      showToast('Error al cargar productos del despacho', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCheckboxChange = (id) => {
    setItemsList(prev => prev.map(item => {
      if (item.id === id) {
        const nextSelected = !item.selected
        const qty = nextSelected ? String(item.maxReturnable) : ''
        if (nextSelected) {
          lastValuesRef.current[id] = qty
        }
        return {
          ...item,
          selected: nextSelected,
          cantidad_devolver: qty
        }
      }
      return item
    }))
  }

  const handleCantidadChange = (id, value) => {
    if (value !== '') {
      lastValuesRef.current[id] = value
    }
    setItemsList(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          cantidad_devolver: value
        }
      }
      return item
    }))
  }

  const saveAndClear = (id, currentVal) => {
    if (currentVal !== undefined && currentVal !== null && String(currentVal).trim() !== '') {
      lastValuesRef.current[id] = String(currentVal)
    }
    handleCantidadChange(id, '')
  }

  const handleBlur = (id, currentVal) => {
    if (String(currentVal).trim() === '') {
      const restored = lastValuesRef.current[id]
      if (restored !== undefined && restored !== null) {
        handleCantidadChange(id, restored)
      }
    }
  }

  // --- Manejadores para productos de intercambio ---
  const handleAddExchangeProduct = (producto) => {
    setExchangeItems(prev => {
      const exists = prev.find(p => p.id === producto.id)
      if (exists) {
        showToast('El producto ya está en la lista de intercambio', 'info')
        return prev
      }
      return [...prev, {
        ...producto,
        cantidad: 1,
        precio_unit_usd: Number(producto.precio_usd || 0)
      }]
    })
  }

  const handleRemoveExchangeProduct = (id) => {
    setExchangeItems(prev => prev.filter(p => p.id !== id))
  }

  const handleUpdateExchangeQty = (id, val) => {
    setExchangeItems(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, cantidad: val }
      }
      return p
    }))
  }

  const handleUpdateExchangePrice = (id, val) => {
    setExchangeItems(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, precio_unit_usd: val }
      }
      return p
    }))
  }

  const selectedItems = itemsList.filter(item => item.selected)
  
  // Calcular el total devuelto estimado
  const totalDevolverUsd = selectedItems.reduce((sum, item) => {
    const qty = Number(item.cantidad_devolver) || 0
    const priceAfterDiscount = Number(item.precio_unit_usd) * (1 - Number(item.descuento_pct || 0) / 100)
    return sum + (priceAfterDiscount * qty)
  }, 0)

  const roundedTotalDevolverUsd = Math.round(totalDevolverUsd * 100) / 100

  // Calcular el total de intercambio
  const totalIntercambioUsd = exchangeItems.reduce((sum, item) => {
    const qty = Number(item.cantidad) || 0
    const price = Number(item.precio_unit_usd) || 0
    return sum + (price * qty)
  }, 0)

  const roundedTotalIntercambioUsd = Math.round(totalIntercambioUsd * 100) / 100
  const balanceNetoUsd = Math.round((totalIntercambioUsd - totalDevolverUsd) * 100) / 100

  // Validaciones
  const hasSelectedItems = selectedItems.length > 0
  const allQtyValid = selectedItems.every(item => {
    const qty = Number(item.cantidad_devolver)
    return !isNaN(qty) && qty > 0 && qty <= item.maxReturnable
  })
  const hasMotivo = motivoSelect !== '' && (motivoSelect !== 'Otro' || motivoText.trim().length > 0)

  const allExchangeValid = !realizarIntercambio || (
    exchangeItems.length > 0 &&
    exchangeItems.every(item => {
      const qty = Number(item.cantidad)
      const price = Number(item.precio_unit_usd)
      return !isNaN(qty) && qty > 0 && !isNaN(price) && price >= 0
    })
  )

  const isFormValid = hasSelectedItems && allQtyValid && hasMotivo && confirmarKardex && allExchangeValid

  const handleConfirm = async () => {
    if (!isFormValid) return

    const itemsPayload = selectedItems.map(item => ({
      despacho_item_id: item.id,
      producto_id: item.producto_id,
      cantidad_devuelta: Number(item.cantidad_devolver)
    }))

    const motivoFinal = motivoSelect === 'Otro' ? motivoText.trim() : motivoSelect

    try {
      await mutation.mutateAsync({
        despachoId: despacho.id,
        items: itemsPayload,
        motivo: motivoFinal,
        generarReemplazo,
        exchangeItems: realizarIntercambio
          ? exchangeItems.map(it => ({
              producto_id: it.id,
              cantidad: Number(it.cantidad),
              precio_unit_usd: Number(it.precio_unit_usd)
            }))
          : []
      })
      onClose()
    } catch (err) {
      console.error('[DEVOLUCION_MODAL] Error al confirmar:', err)
    }
  }

  const opcionesMotivo = [
    'Producto defectuoso',
    'Cantidad incorrecta',
    'Pedido equivocado',
    'Devolución de préstamo',
    'Otro'
  ]

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Registrar Devolución Parcial — Despacho #${String(despacho?.numero).padStart(5, '0')}`}
      className="max-w-6xl w-full"
    >
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        
        {/* Ficha Financiera del Cliente */}
        {clienteInfo && (
          <div className="p-3.5 rounded-2xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs shadow-sm bg-gradient-to-r from-white to-slate-50/50">
            <div>
              <span className="text-slate-400 font-bold uppercase tracking-wider block text-[9px]">Cliente Facturación</span>
              <span className="font-extrabold text-slate-800 text-sm leading-tight block">{clienteInfo.nombre}</span>
            </div>
            <div className="flex gap-6 shrink-0">
              <div className="text-left sm:text-right">
                <span className="text-slate-400 font-bold uppercase tracking-wider block text-[9px]">Deuda Pendiente</span>
                <span className="font-black text-red-600 text-sm">${Number(clienteInfo.saldo_pendiente || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              </div>
              <div className="text-left sm:text-right">
                <span className="text-slate-400 font-bold uppercase tracking-wider block text-[9px]">Saldo a Favor</span>
                <span className="font-black text-emerald-600 text-sm">${Number(clienteInfo.saldo_a_favor || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              </div>
            </div>
          </div>
        )}

        {/* Layout de Dos Columnas en PC */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* COLUMNA IZQUIERDA (Devoluciones) */}
          <div className="lg:col-span-6 space-y-4">
            
            {/* Banner Informativo */}
            <div className="p-2.5 rounded-lg border flex items-center gap-2 text-xs bg-amber-50 border-amber-200 text-amber-900 leading-tight">
              <AlertCircle size={16} className="shrink-0 text-amber-600" />
              <span>
                Registra el retorno de mercancía entregada. Se reintegrará el stock y se calcularán los ajustes en CxC.
              </span>
            </div>

            {/* Lista de Productos del Despacho */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                <Package size={14} className="text-slate-500" />
                Productos a devolver
              </h3>

              {loading ? (
                <div className="py-6 flex justify-center items-center">
                  <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-slate-500 ml-2">Cargando productos...</span>
                </div>
              ) : itemsList.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">No hay productos disponibles para devolver.</p>
              ) : (
                <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50">
                  {itemsList.map(item => {
                    const priceAfterDiscount = Number(item.precio_unit_usd) * (1 - Number(item.descuento_pct || 0) / 100)
                    const isNoReturnable = item.maxReturnable <= 0

                    return (
                      <div
                        key={item.id}
                        className={`py-2 px-3 flex items-center gap-3 transition-colors ${item.selected ? 'bg-amber-50/30' : 'bg-white'} ${isNoReturnable ? 'opacity-65 bg-slate-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          disabled={isNoReturnable}
                          checked={item.selected}
                          onChange={() => handleCheckboxChange(item.id)}
                          className="w-4 h-4 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer disabled:cursor-not-allowed shrink-0"
                        />

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{item.nombre_snap}</p>
                          <div className="flex flex-wrap gap-x-2.5 text-[10px] text-slate-400 mt-0.5">
                            <span>Cód: {item.codigo_snap || 'N/A'}</span>
                            <span>Precio: ${priceAfterDiscount.toFixed(2)}</span>
                            <span>Entregado: {Number(item.cantidad)} {item.unidad_snap}</span>
                            {item.alreadyReturned > 0 && (
                              <span className="text-amber-700 font-medium">Devuelto: {item.alreadyReturned}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!item.selected || Number(item.cantidad_devolver) <= 0 || isNoReturnable}
                              onClick={() => {
                                const current = Number(item.cantidad_devolver) || 0
                                const step = item.unidad_snap === 'und' ? 1 : 0.1
                                handleCantidadChange(item.id, String(Math.max(0, Math.round((current - step) * 100) / 100)))
                              }}
                              className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed select-none text-sm font-bold shadow-sm transition-colors"
                            >
                              -
                            </button>

                            <input
                              type="number"
                              disabled={!item.selected || isNoReturnable}
                              min="0.01"
                              max={item.maxReturnable}
                              step="any"
                              value={item.cantidad_devolver}
                              onChange={e => handleCantidadChange(item.id, e.target.value)}
                              onFocus={() => saveAndClear(item.id, item.cantidad_devolver)}
                              onClick={() => saveAndClear(item.id, item.cantidad_devolver)}
                              onBlur={() => handleBlur(item.id, item.cantidad_devolver)}
                              placeholder="0"
                              className="w-14 text-center py-0.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-50 disabled:text-slate-400 font-extrabold"
                            />

                            <button
                              type="button"
                              disabled={!item.selected || Number(item.cantidad_devolver) >= item.maxReturnable || isNoReturnable}
                              onClick={() => {
                                const current = Number(item.cantidad_devolver) || 0
                                const step = item.unidad_snap === 'und' ? 1 : 0.1
                                handleCantidadChange(item.id, String(Math.min(item.maxReturnable, Math.round((current + step) * 100) / 100)))
                              }}
                              className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed select-none text-sm font-bold shadow-sm transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pr-1">
                            máx: {item.maxReturnable} {item.unidad_snap}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Motivo de Devolución */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">Motivo de devolución <span className="text-red-500">*</span></label>
                <CustomSelect
                  options={opcionesMotivo.map(op => ({ value: op, label: op }))}
                  value={motivoSelect}
                  onChange={val => setMotivoSelect(val)}
                  placeholder="Seleccione un motivo..."
                  searchable={false}
                />
              </div>

              {motivoSelect === 'Otro' && (
                <textarea
                  value={motivoText}
                  onChange={e => setMotivoText(e.target.value)}
                  placeholder="Detalle el motivo..."
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 min-h-[42px] resize-none"
                />
              )}
            </div>
          </div>

          {/* COLUMNA DERECHA (Intercambios) */}
          <div className="lg:col-span-6 space-y-4">
            
            {/* Opción Intercambio */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={realizarIntercambio}
                  onChange={e => {
                    setRealizarIntercambio(e.target.checked)
                    if (!e.target.checked) setExchangeItems([])
                  }}
                  className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer shrink-0"
                />
                <div className="text-xs select-none">
                  <span className="font-bold text-slate-800 block">Realizar intercambio de productos</span>
                  <span className="text-slate-500">Permite entregar productos de reemplazo de forma inmediata.</span>
                </div>
              </label>
            </div>

            {realizarIntercambio && (
              <div className="border border-slate-200 rounded-2xl p-4 bg-white space-y-3 animate-in fade-in duration-200">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                  <Package size={14} className="text-slate-500" />
                  Productos de reemplazo (Intercambio)
                </h3>

                {/* Buscador de productos en catálogo */}
                <ProductoAutocomplete
                  productos={productosCatalog}
                  onAgregar={handleAddExchangeProduct}
                  idsAgregados={new Set(exchangeItems.map(p => p.id))}
                  placeholder="Buscar producto en catálogo..."
                />

                {/* Lista de productos agregados */}
                {exchangeItems.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center italic">No has agregado productos de intercambio.</p>
                ) : (
                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50 max-h-[260px] overflow-y-auto">
                    {exchangeItems.map(item => (
                      <div key={item.id} className="py-2 px-3 flex items-center gap-3 bg-white">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{item.nombre}</p>
                          <div className="flex flex-wrap gap-x-2 text-[10px] text-slate-400 mt-0.5">
                            <span>Cód: {item.codigo || 'N/A'}</span>
                            <span className="text-emerald-600 font-semibold">Stock: {item.stock_actual} {item.unidad}</span>
                          </div>
                        </div>

                        {/* Cantidad */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={Number(item.cantidad) <= 1}
                            onClick={() => handleUpdateExchangeQty(item.id, Math.max(1, Number(item.cantidad) - 1))}
                            className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 select-none text-xs font-bold shadow-sm transition-colors"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.cantidad}
                            onChange={e => handleUpdateExchangeQty(item.id, e.target.value === '' ? '' : (Number(e.target.value) || 1))}
                            onBlur={e => {
                              if (e.target.value === '') handleUpdateExchangeQty(item.id, 1)
                            }}
                            className="w-12 text-center py-0.5 text-xs border border-slate-200 rounded-lg font-extrabold focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 h-6 shadow-sm"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateExchangeQty(item.id, Number(item.cantidad || 1) + 1)}
                            className="w-6 h-6 flex items-center justify-center border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 select-none text-xs font-bold shadow-sm transition-colors"
                          >
                            +
                          </button>
                        </div>

                        {/* Precio editable */}
                        <div className="flex items-center border border-slate-200 rounded-lg bg-white shadow-sm focus-within:ring-1 focus-within:ring-amber-500 focus-within:border-amber-500 overflow-hidden h-6 shrink-0">
                          <span className="pl-2 pr-1 text-[10px] text-slate-400 font-bold select-none">$</span>
                          <input
                            type="number"
                            step="any"
                            value={item.precio_unit_usd}
                            onChange={e => handleUpdateExchangePrice(item.id, Number(e.target.value) || 0)}
                            className="w-16 text-right pr-2 py-0 text-xs font-bold focus:outline-none bg-transparent h-full"
                          />
                        </div>

                        {/* Eliminar */}
                        <button
                          type="button"
                          onClick={() => handleRemoveExchangeProduct(item.id)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                          title="Eliminar"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Checkboxes de Confirmación */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={generarReemplazo}
                  onChange={e => setGenerarReemplazo(e.target.checked)}
                  className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer shrink-0"
                />
                <div className="text-xs select-none">
                  <span className="font-semibold text-slate-700 flex items-center gap-1">
                    <FileText size={12} className="text-slate-500" />
                    Generar cotización de reemplazo tradicional
                  </span>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmarKardex}
                  onChange={e => setConfirmarKardex(e.target.checked)}
                  className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer shrink-0"
                />
                <div className="text-xs select-none">
                  <span className="font-semibold text-slate-700 flex items-center gap-1">
                    <RotateCcw size={12} className="text-slate-500" />
                    Confirmar ingreso de mercancía devuelta a stock <span className="text-red-500">*</span>
                  </span>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Resumen de Balance y Ajustes en Formato Ticket */}
        {hasSelectedItems && (
          <div className="border border-slate-200 rounded-2xl bg-white shadow-sm p-4 space-y-3 relative overflow-hidden text-xs">
            <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
            <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider border-b pb-2 flex items-center justify-between">
              <span>Resumen del Intercambio</span>
              <span className="text-[10px] text-slate-400 font-mono">PRO-FORMA</span>
            </h4>
            
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-slate-600">
                <span>Subtotal Devolución ({selectedItems.length} {selectedItems.length === 1 ? 'producto' : 'productos'})</span>
                <span className="font-bold text-slate-800">${roundedTotalDevolverUsd.toFixed(2)} USD</span>
              </div>
              
              {realizarIntercambio && (
                <div className="flex justify-between items-center text-slate-600">
                  <span>Subtotal Intercambio ({exchangeItems.length} {exchangeItems.length === 1 ? 'producto' : 'productos'})</span>
                  <span className="font-bold text-slate-800">${roundedTotalIntercambioUsd.toFixed(2)} USD</span>
                </div>
              )}
              
              {/* Línea punteada divisoria */}
              <div className="border-t border-dashed border-slate-200 my-2" />
              
              {/* Balance Neto */}
              <div className="flex justify-between items-center text-slate-800 font-bold text-sm">
                <span>Balance Neto</span>
                <span className={`font-black ${balanceNetoUsd > 0 ? 'text-amber-800' : balanceNetoUsd < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                  {balanceNetoUsd > 0 ? '+' : ''}${balanceNetoUsd.toFixed(2)} USD
                </span>
              </div>
            </div>
            
            {/* Caja explicativa de acciones financieras */}
            <div className={`p-2.5 rounded-xl border leading-relaxed flex gap-2.5 ${
              balanceNetoUsd > 0 
                ? 'bg-amber-50 border-amber-200 text-amber-900' 
                : balanceNetoUsd < 0 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <CheckCircle size={15} className={`shrink-0 mt-0.5 ${balanceNetoUsd > 0 ? 'text-amber-600' : balanceNetoUsd < 0 ? 'text-emerald-600' : 'text-slate-500'}`} />
              <div className="space-y-0.5">
                {balanceNetoUsd > 0 ? (
                  <>
                    <p className="font-bold">El cliente debe pagar la diferencia</p>
                    <p className="text-[11px] opacity-90">
                      El total a pagar al cliente es <strong>$0.00 USD</strong>. Se registrará un nuevo <strong>cargo (deuda)</strong> por <strong>${balanceNetoUsd.toFixed(2)} USD</strong> en su cuenta por cobrar.
                    </p>
                  </>
                ) : balanceNetoUsd < 0 ? (
                  <>
                    <p className="font-bold">Saldo a favor del cliente</p>
                    <p className="text-[11px] opacity-90">
                      Se aplicará un <strong>abono</strong> para disminuir su deuda actual o se registrará un crédito de <strong>saldo a favor</strong> de <strong>${Math.abs(balanceNetoUsd).toFixed(2)} USD</strong> para futuras compras.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-bold">Intercambio equivalente</p>
                    <p className="text-[11px] opacity-90">
                      El valor de los productos es el mismo. No se generarán movimientos de cobro ni abonos en la cuenta del cliente.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer Acciones */}
        <div className="flex justify-end gap-2 pt-2.5 border-t border-slate-100">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isFormValid || mutation.isPending}
            className="px-3.5 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 bg-amber-600 hover:bg-amber-700"
          >
            {mutation.isPending ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : null}
            Registrar Devolución
          </button>
        </div>
      </div>
    </Modal>
  )
}
