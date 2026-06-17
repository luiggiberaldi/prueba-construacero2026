// src/components/despachos/EditarItemsDespachoModal.jsx
import { useState, useEffect, useMemo } from 'react'
import { X, Search, Plus, Minus, Trash2, Loader2, Package, Save, AlertCircle, CreditCard, CheckCircle, Edit2, DollarSign, Copy, Truck, Handshake } from 'lucide-react'
import { useLineItems } from '../../hooks/useLineItems'
import { useInventario } from '../../hooks/useInventario'
import { useProductSearch } from '../../hooks/useProductSearch'
import { useEditarItemsDespacho } from '../../hooks/useDespachos'
import { useFormasPago } from '../../hooks/useFormasPago'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { useSaldoFavorOrigen } from '../../hooks/useCuentasCobrar'
import { FORMAS_PAGO } from '../../constants/formasPago'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'
import { round4, round2 } from '../../utils/dinero'
import { showToast } from '../ui/Toast'
import { useConfigNegocio } from '../../hooks/useConfigNegocio'

export default function EditarItemsDespachoModal({ isOpen, onClose, despacho }) {
  const { perfil } = useAuthStore()
  const esDesarrollador = perfil?.rol === 'desarrollador'

  const billingCliente = despacho?.cliente_factura || despacho?.cliente
  const esVendedorSinComision = 
    billingCliente?.vendedor?.rol === 'vendedor_sin_comision' ||
    (billingCliente?.vendedor_id === perfil?.id && perfil?.rol === 'vendedor_sin_comision')

  const { data: inventarioData, isLoading: loadingInv } = useInventario({ pageSize: 1000 })
  const productos = inventarioData?.productos ?? inventarioData ?? []
  const editarItems = useEditarItemsDespacho()
  const { data: config = {} } = useConfigNegocio()
  const { items, setItems, agregarItem: _agregarItem, eliminarPorId, cambiarCantidad, setCantidadDirecta, cambiarPrecio: _cambiarPrecio, togglePrestamo, setStockMap } = useLineItems({ checkStock: true })

  const agregarItem = (p) => {
    const precioBase = Number(p.precio_usd ?? p.precioUnitUsd ?? 0)

    _agregarItem({
      ...p,
      precio_usd: precioBase,
      precioOriginalUsd: precioBase
    })
  }

  const cambiarPrecio = (productoId, precio) => {
    const precioUnit = parseFloat(String(precio)) || 0
    _cambiarPrecio(productoId, precioUnit, precioUnit)
  }

    const [busqueda, setBusqueda] = useState('')
    const [cargandoItems, setCargandoItems] = useState(false)
    const [error, setError] = useState(null)
  
    // Estado para producto manual
    const [showManual, setShowManual] = useState(false)
    const [manualNombre, setManualNombre] = useState('')
    const [manualUnidad, setManualUnidad] = useState('und')
    const [manualPrecio, setManualPrecio] = useState('')
    const [manualCantidad, setManualCantidad] = useState(1)
  
    // Pagos y COD
    const [esCod, setEsCod] = useState(false)
    const [tabActiva, setTabActiva] = useState('inmediato')
    const [mostrarSelectorInmediato, setMostrarSelectorInmediato] = useState(false)
    const [vueltoComoSaldoFavor, setVueltoComoSaldoFavor] = useState(false)
    const { tasaEfectiva: tasa = 0 } = useTasaCambio()
    const { data: saldoFavorOrigen } = useSaldoFavorOrigen(billingCliente?.id)
    const [mostrarSelectorCod, setMostrarSelectorCod] = useState(false)
  
    // Edición de producto externo
    const [editItemIdx, setEditItemIdx] = useState(null)
  
    function agregarComoExterno(p) {
      const randomId = Math.floor(1000000 + Math.random() * 9000000)
      const nombre = p.nombre || p.nombreSnap || ''
      const unidad = p.unidad || p.unidadSnap || 'und'
      const precio = p.precio_usd ?? p.precioUnitUsd ?? 0
      const cantidad = p.cantidad ?? 1

      const fakeProducto = {
        id: `manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // ID temporal único
        codigo: `EXT${randomId}`,
        nombre: nombre.toUpperCase(),
        unidad: unidad.toUpperCase(),
        precio_usd: Number(precio),
        origen: 'externo',
        cantidad_inicial: Number(cantidad)
      }

      agregarItem(fakeProducto)
      showToast('Copia externa agregada a la cesta', 'success')
    }

    function handleAgregarManual(e) {
      if (e) e.preventDefault()
      if (!manualNombre.trim() || !manualPrecio || !manualCantidad) return
  
      const randomId = Math.floor(1000000 + Math.random() * 9000000)
      const fakeProducto = {
        id: `manual-${Date.now()}`, // ID temporal único
        codigo: `EXT${randomId}`,
        nombre: manualNombre.trim().toUpperCase(),
        unidad: manualUnidad.trim().toUpperCase() || 'und',
        precio_usd: Number(manualPrecio),
        origen: 'externo',
        cantidad_inicial: Number(manualCantidad) // para que el hook sepa cuánto agregar inicialmente
      }
  
      agregarItem(fakeProducto)
  
      // Limpiar y cerrar
      setShowManual(false)
      setManualNombre('')
      setManualUnidad('und')
      setManualPrecio('')
      setManualCantidad(1)
      showToast('Producto manual agregado', 'success')
    }
  
    // 3.5. Calcular total base con flete/corte/descuento de productos para los hooks de pago
    const totalConFlete = useMemo(() => {
      let subtotal = 0
      items.forEach(it => {
        if (it.esPrestamo || it.es_prestamo) return
        subtotal += round4(it.cantidad * it.precioUnitUsd * (1 - (it.descuentoPct || 0) / 100))
      })
      const esPersonal = billingCliente?.tipo_cliente === 'personal'
      const descPct = config.descuento_personal_pct ?? 10.00
      const descuentoMonto = esPersonal ? round2(subtotal * (descPct / 100)) : 0
      const subtotalConDescuento = round2(subtotal - descuentoMonto)

      const flete = Number(despacho?.flete_usd || 0)
      const corte = Number(despacho?.corte_usd || 0)
      const descTotal = Number(despacho?.descuento_total_usd || 0)
      return Math.max(0, subtotalConDescuento + flete + corte - descTotal)
    }, [items, despacho, billingCliente, config])

    // 1. Hook para pagos inmediatos (adelantos / seña)
    const {
      formasPago: pagosInmediatos,
      setFormas: setPagosInmediatos,
      toggleForma: togglePagoInmediato,
      setMontoForma: setMontoPagoInmediato,
      updateForma: updatePagoInmediato,
      resetFormas: resetPagosInmediatos,
      totalAsignado: totalInmediato,
      pagoCuadrado: pagoInmediatoCuadrado,
      hayVuelto: pagosInmediatosHayVuelto,
      diferencia: pagosInmediatosDiferencia,
    } = useFormasPago(totalConFlete)

    const handleTogglePagoInmediato = (metodo) => {
      if (metodo === 'Saldo a Favor') {
        const active = pagosInmediatos.some(f => f.metodo === 'Saldo a Favor')
        if (!active) {
          togglePagoInmediato('Saldo a Favor')
          setTimeout(() => {
            const available = Number(billingCliente?.saldo_a_favor || 0)
            const actualAsignado = pagosInmediatos.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
            const restante = totalConFlete - actualAsignado
            const montoInicial = Math.min(restante > 0 ? restante : 0, available)
            updatePagoInmediato('Saldo a Favor', {
              monto: Number(montoInicial.toFixed(2)) || '',
              forma_pago_origen: saldoFavorOrigen || 'Crédito'
            })
          }, 50)
          return
        }
      }
      togglePagoInmediato(metodo)
    }

    const handleSetMontoPagoInmediato = (metodo, val) => {
      if (metodo === 'Saldo a Favor') {
        const maxVal = Number(billingCliente?.saldo_a_favor || 0)
        let numVal = Number(val)
        if (numVal > maxVal) {
          val = String(maxVal)
        }
      }
      if (metodo === 'Cta por cobrar') {
        const sumOthers = pagosInmediatos
          .filter(p => p.metodo !== 'Cta por cobrar')
          .reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
        const maxVal = Math.max(0, totalConFlete - sumOthers)
        let numVal = Number(val)
        if (numVal > maxVal) {
          val = String(maxVal)
        }
      }
      setMontoPagoInmediato(metodo, val)
    }

    // 2. Monto COD requerido
    const montoCodRequerido = Math.max(0, round2(totalConFlete - totalInmediato))

    // 3. Hook para propuesta de pagos en destino
    const {
      formasPago: propuestaCod,
      setFormas: setPropuestaCod,
      toggleForma: togglePropuestaCod,
      setMontoForma: setMontoPropuestaCod,
      updateForma: updatePropuestaCod,
      resetFormas: resetPropuestaCod,
      totalAsignado: totalPropuestaCod,
      pagoCuadrado: propuestaCodCuadrado,
    } = useFormasPago(montoCodRequerido)

    const handleToggleCod = () => {
      setEsCod(prev => {
        const next = !prev
        if (!next) {
          resetPropuestaCod()
          setTabActiva('inmediato')
        } else {
          resetPropuestaCod()
          setTabActiva('cod')
        }
        return next
      })
    }

    // 1. Cargar items actuales del despacho
    useEffect(() => {
      if (!isOpen || !despacho?.id) return

      async function fetchItems() {
        setCargandoItems(true)
        setError(null)
        try {
          const { data, error: fetchErr } = await (await import('../../services/supabase/client')).default
            .from('notas_despacho_items')
            .select('*')
            .eq('despacho_id', despacho.id)
            .order('orden')

          if (fetchErr) throw fetchErr

          const esPersonal = billingCliente?.tipo_cliente === 'personal'
          const descPct = config.descuento_personal_pct ?? 10.00

          const mapped = (data || []).map(it => {
            const precioBase = Number(it.precio_unit_usd)
            const precioReinflado = esPersonal ? round2(precioBase / (1 - descPct / 100)) : precioBase
            return {
              _key: `existing-${it.id}`,
              productoId: it.producto_id ?? `ext-${it.id}`,
              codigoSnap: it.codigo_snap,
              nombreSnap: it.nombre_snap,
              unidadSnap: it.unidad_snap,
              cantidad: Number(it.cantidad),
              precioUnitUsd: precioReinflado,
              precioOriginalUsd: precioReinflado,
              descuentoPct: Number(it.descuento_pct || 0),
              origen: it.origen ?? 'inventario',
              esPrestamo: !!it.es_prestamo,
              orden: it.orden
            }
          })
          setItems(mapped)
        } catch (err) {
          console.error('Error fetching items:', err)
          setError('No se pudieron cargar los productos del despacho')
        } finally {
          setCargandoItems(false)
        }
      }

      fetchItems()

      // 1.1 Cargar pagos actuales
      if (despacho.forma_pago_cliente || despacho.forma_pago) {
        try {
          const fpRaw = despacho.forma_pago_cliente || despacho.forma_pago
          const parsed = JSON.parse(fpRaw)
          const pagosArray = Array.isArray(parsed) && parsed.length > 0 ? parsed : []
          
          // Mapear cualquier metodo 'Efectivo' viejo a 'Efectivo $'
          const mappedPagos = pagosArray.map(p => ({
            ...p,
            metodo: p.metodo === 'Efectivo' ? 'Efectivo $' : p.metodo
          }))

          const codItem = mappedPagos.find(f => f.metodo === 'Cobro a destino')
          if (codItem) {
            setEsCod(true)
            setPropuestaCod(Array.isArray(codItem.metodo_propuesto) ? codItem.metodo_propuesto : [])
            setPagosInmediatos(mappedPagos.filter(f => f.metodo !== 'Cobro a destino'))
            setTabActiva('inmediato')
          } else {
            setEsCod(false)
            setPagosInmediatos(mappedPagos)
            setPropuestaCod([])
            setTabActiva('inmediato')
          }
        } catch {
          const metodoDb = despacho.forma_pago === 'Efectivo' ? 'Efectivo $' : (despacho.forma_pago || 'Efectivo $')
          setEsCod(false)
          setPagosInmediatos([{ metodo: metodoDb, monto: Number(despacho.total_usd) || 0 }])
          setPropuestaCod([])
          setTabActiva('inmediato')
        }
      } else {
        setEsCod(false)
        setPagosInmediatos([{ metodo: 'Por definir', monto: Number(despacho.total_usd) || 0 }])
        setPropuestaCod([])
        setTabActiva('inmediato')
      }
    }, [isOpen, despacho?.id, despacho?.forma_pago, despacho?.forma_pago_cliente, despacho?.total_usd, setItems, setPagosInmediatos, setPropuestaCod])
  
    // 2. Sincronizar stock map
    useEffect(() => {
      if (productos.length > 0) {
        const map = {}
        productos.forEach(p => { map[p.id] = Number(p.stock_actual) || 0 })
        setStockMap(map)
      }
    }, [productos, setStockMap])
  
    // 3. Filtrar productos
    const productosFiltrados = useProductSearch(productos, busqueda)
  
    // 4. Calcular totales
    const totales = useMemo(() => {
      let subtotal = 0
      items.forEach(it => {
        if (it.esPrestamo || it.es_prestamo) return
        subtotal += round4(it.cantidad * it.precioUnitUsd * (1 - (it.descuentoPct || 0) / 100))
      })
      const total = totalConFlete
      const totalPagos = esCod 
        ? totalInmediato + montoCodRequerido 
        : totalInmediato
      const diferencia = esCod
        ? Math.round((montoCodRequerido - totalPropuestaCod) * 100) / 100
        : Math.round((total - totalInmediato) * 100) / 100
      const estaCuadrado = esCod
        ? (montoCodRequerido <= 0.015 || propuestaCodCuadrado)
        : pagoInmediatoCuadrado
      return { subtotal, total, totalPagos, diferencia, estaCuadrado }
    }, [items, totalConFlete, esCod, totalInmediato, montoCodRequerido, totalPropuestaCod, propuestaCodCuadrado, pagoInmediatoCuadrado])
  
    const cxcItem = pagosInmediatos.find(f => f.metodo === 'Cta por cobrar');
    const cxcVencimientoValido = !cxcItem || esVendedorSinComision || (
      cxcItem.diasVencimiento !== undefined &&
      cxcItem.diasVencimiento !== null &&
      cxcItem.diasVencimiento !== '' &&
      !isNaN(cxcItem.diasVencimiento) &&
      Number(cxcItem.diasVencimiento) > 0
    );
  
    const formasPagoFinales = useMemo(() => {
      const inyectarVuelto = (fps) => {
        if (pagosInmediatosHayVuelto && vueltoComoSaldoFavor) {
          return fps.map((fp, i) => i === 0 ? { ...fp, vuelto_a_favor: true } : fp)
        }
        return fps
      }

      if (esCod) {
        return [
          ...inyectarVuelto(pagosInmediatos),
          {
            metodo: "Cobro a destino",
            monto: montoCodRequerido,
            diasVencimiento: 0,
            cobro_destino_pagado: false,
            metodo_propuesto: propuestaCod
          }
        ]
      } else {
        return inyectarVuelto(pagosInmediatos)
      }
    }, [esCod, pagosInmediatos, propuestaCod, totalConFlete, totalInmediato, montoCodRequerido, pagosInmediatosHayVuelto, vueltoComoSaldoFavor])

    async function handleSave() {
      if (items.length === 0) {
        showToast('El despacho debe tener al menos un producto', 'error')
        return
      }
      if (!cxcVencimientoValido) {
        showToast('Los días de vencimiento son obligatorios para cuentas por cobrar', 'error')
        return
      }
      if (!totales.estaCuadrado) {
        showToast(`Los pagos no cuadran con el total. Diferencia: ${fmtUsd(totales.diferencia)}`, 'error')
        return
      }
      const esPersonal = billingCliente?.tipo_cliente === 'personal'
      const descPct = config.descuento_personal_pct ?? 10.00
      const itemsApi = items.map((it, idx) => {
        const esExterno = it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-') || String(it.productoId).startsWith('ext-')
        const precioUnit = Number(it.precioUnitUsd)
        const precioFinal = esPersonal ? round2(precioUnit * (1 - descPct / 100)) : precioUnit
        return {
          producto_id: esExterno ? null : it.productoId,
          codigo_snap: it.codigoSnap || null,
          nombre_snap: it.nombreSnap,
          unidad_snap: it.unidadSnap || 'und',
          cantidad: Number(it.cantidad),
          precio_unit_usd: precioFinal,
          descuento_pct: Number(it.descuentoPct || 0),
          orden: idx,
          origen: esExterno ? 'externo' : (it.origen || 'inventario'),
          es_prestamo: it.esPrestamo || false
        }
      })
      try {
        await editarItems.mutateAsync({ 
          despachoId: despacho.id, 
          items: itemsApi, 
          pagos: JSON.stringify(formasPagoFinales)
        })
        onClose()
      } catch {
        // El hook ya muestra el toast
      }
    }
  
  // 4.5. Memoizar el catálogo izquierdo para evitar re-renderizados pesados en cada pulsación o cambio de pagos
  const catalogoIzquierdo = useMemo(() => {
    return (
      <div className="w-full md:w-5/12 border-r border-slate-100 flex flex-col bg-slate-50/50">
        <div className="p-4 bg-white border-b border-slate-100 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar producto..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white text-sm transition-all"
              />
            </div>
            <button
              onClick={() => setShowManual(!showManual)}
              className={`shrink-0 p-2.5 rounded-xl border-2 transition-all active:scale-95 flex items-center justify-center ${showManual ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-indigo-100 text-indigo-600 hover:border-indigo-300'}`}
              title="Agregar producto manual"
            >
              <Plus size={18} strokeWidth={3} />
            </button>
          </div>

          {/* Formulario de producto manual */}
          {showManual && (
            <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Plus size={12} className="text-indigo-600" />
                </div>
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Nuevo Producto Manual</span>
              </div>
              
              <input
                type="text"
                placeholder="Nombre del producto *"
                value={manualNombre}
                onChange={e => setManualNombre(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-indigo-400"
                autoFocus
              />
              
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Unidad</label>
                  <input
                    type="text"
                    placeholder="und"
                    value={manualUnidad}
                    onChange={e => setManualUnidad(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs text-center focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Precio $ *</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={manualPrecio}
                    onChange={e => setManualPrecio(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs text-center focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">Cant. *</label>
                  <input
                    type="number"
                    value={manualCantidad}
                    onChange={e => setManualCantidad(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs text-center focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowManual(false)}
                  className="flex-1 py-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
                >
                  CANCELAR
                </button>
                <button
                  onClick={handleAgregarManual}
                  className="flex-1 py-2 bg-indigo-600 text-white text-[10px] font-black rounded-lg hover:bg-indigo-700 shadow-md shadow-indigo-100 transition-all active:scale-95"
                >
                  AGREGAR
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loadingInv ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 size={24} className="animate-spin text-indigo-500" />
              <p className="text-xs text-slate-400">Cargando catálogo...</p>
            </div>
          ) : productosFiltrados.length === 0 ? (
            <p className="text-center py-10 text-xs text-slate-400 italic">No se encontraron productos</p>
          ) : (
            productosFiltrados.map(p => {
              const enCarrito = items.some(it => it.productoId === p.id)
              const stock = Number(p.stock_actual) || 0
              return (
                <div
                  key={p.id}
                  onClick={() => !enCarrito && stock > 0 && agregarItem(p)}
                  className={`group p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${enCarrito ? 'bg-indigo-50 border-indigo-200 opacity-60 cursor-default' :
                      stock <= 0 ? 'bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed' :
                        'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
                    }`}
                >
                  <div className="flex justify-between gap-2">
                    <p className="text-xs font-bold text-slate-700 leading-tight">{p.nombre}</p>
                    <span className="text-xs font-black text-slate-900 shrink-0">{fmtUsd(p.precio_usd)}</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-mono text-slate-400 uppercase">{p.codigo || 'S/C'}</span>
                    <div className="flex items-center gap-1.5">
                      {esDesarrollador && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            agregarComoExterno(p);
                          }}
                          className="px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-[9px] font-black rounded uppercase transition-colors"
                          title="Agregar copia como externo"
                        >
                          + Ext
                        </button>
                      )}
                      <span className={`font-bold ${stock > 5 ? 'text-emerald-500' : stock > 0 ? 'text-amber-500' : 'text-red-500'}`}>
                        Stock: {stock} {p.unidad || 'und'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }, [productosFiltrados, loadingInv, busqueda, showManual, manualNombre, manualUnidad, manualPrecio, manualCantidad, items, esDesarrollador])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {/* Modal — más ancho para dar espacio al contenido */}
      <div className="bg-white w-full max-w-5xl h-full sm:h-[92vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
              <Package size={22} className="text-indigo-600" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg leading-tight">Editar productos</h3>
              <p className="text-xs text-slate-400 font-mono">DES-{String(despacho?.numero).padStart(5, '0')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* ── Columnas: Catálogo + Carrito ── */}
        <div className="flex flex-col md:flex-row min-h-0 flex-1 overflow-hidden">

          {/* Columna Izquierda: Catálogo */}
          {catalogoIzquierdo}

          {/* Columna Derecha: Carrito */}
          <div className="w-full md:w-7/12 flex flex-col bg-white">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Carrito del Despacho</span>
              <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-lg uppercase">
                {items.length} Items
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cargandoItems ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 size={32} className="animate-spin text-slate-300" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-20 text-red-500 gap-2 text-center">
                  <AlertCircle size={32} />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-2">
                  <Package size={48} strokeWidth={1} />
                  <p className="text-sm font-medium">Agrega productos del catálogo</p>
                </div>
              ) : (
                items.map((it) => (
                  <div key={it._key} className={`px-3 py-2.5 rounded-xl border transition-all shadow-sm flex flex-col gap-2 ${it.esPrestamo || it.es_prestamo ? 'bg-emerald-50/50 border-emerald-200/60 my-1' : 'border-slate-100 bg-white'}`}>
                    {/* Nombre + eliminar */}
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 leading-tight">
                          {it.nombreSnap}
                          {(it.esPrestamo || it.es_prestamo) && (
                            <span className="inline-flex items-center gap-1 ml-1.5 align-middle text-[9px] uppercase font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md"><Handshake size={10} /> Préstamo</span>
                          )}
                          {(it.origen === 'externo' || !it.productoId) && (
                            <span className="inline-block ml-1.5 align-middle text-[9px] uppercase font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">EXT</span>
                          )}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono">{it.codigoSnap || 'SIN CÓDIGO'}</p>
                        {['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) && (
                          <div className="flex items-center gap-1 mt-1.5 bg-slate-100 p-0.5 rounded-full w-fit">
                            <button
                              type="button"
                              onClick={() => (it.esPrestamo || it.es_prestamo) && togglePrestamo(it.productoId)}
                              className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full transition-all ${
                                !(it.esPrestamo || it.es_prestamo)
                                  ? 'bg-white text-slate-800 shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Venta
                            </button>
                            <button
                              type="button"
                              onClick={() => !(it.esPrestamo || it.es_prestamo) && togglePrestamo(it.productoId)}
                              className={`px-2.5 py-0.5 text-[10px] font-black rounded-full transition-all flex items-center gap-0.5 ${
                                (it.esPrestamo || it.es_prestamo)
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-emerald-700'
                              }`}
                            >
                              <Handshake size={11} /> Préstamo
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0 self-start">
                        {esDesarrollador && (
                          <button
                            onClick={() => agregarComoExterno(it)}
                            className="text-slate-400 hover:text-indigo-600 p-0.5 transition-colors shrink-0"
                            title="Duplicar como externo"
                          >
                            <Copy size={13} />
                          </button>
                        )}
                        {(it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-')) && (
                          <button onClick={() => setEditItemIdx(items.findIndex(x => x.productoId === it.productoId))} className="text-amber-400 hover:text-amber-500 p-0.5 transition-colors shrink-0" title="Editar detalles">
                            <Edit2 size={14} />
                          </button>
                        )}
                        <button onClick={() => eliminarPorId(it.productoId)} className="text-slate-300 hover:text-red-500 p-0.5 transition-colors shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Controles en una sola fila compacta */}
                    <div className="flex items-center gap-2">
                      {/* Cantidad */}
                      <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                        <button onClick={() => cambiarCantidad(it.productoId, -1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 active:scale-90 transition-transform">
                          <Minus size={11} />
                        </button>
                        <input
                          type="number"
                          value={it.cantidad}
                          onChange={e => setCantidadDirecta(it.productoId, e.target.value)}
                          onBlur={e => { if (!e.target.value || Number(e.target.value) <= 0) setCantidadDirecta(it.productoId, 1) }}
                          className="w-9 text-center bg-transparent text-xs font-black text-slate-800 focus:outline-none"
                        />
                        <button onClick={() => cambiarCantidad(it.productoId, 1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 active:scale-90 transition-transform">
                          <Plus size={11} />
                        </button>
                      </div>
                      {/* Precio */}
                      <div className="relative w-24">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={it.precioUnitUsd}
                          onChange={e => cambiarPrecio(it.productoId, e.target.value)}
                          className="w-full pl-5 pr-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-right text-slate-700 bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-400 transition-all"
                        />
                      </div>
                      {/* Subtotal */}
                      <div className="ml-auto text-right">
                        <p className="text-[9px] text-slate-400 uppercase font-bold tracking-widest leading-none mb-0.5">Subtotal</p>
                        <p className="text-sm font-black text-slate-900">{fmtUsd(it.cantidad * it.precioUnitUsd)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── SECCIÓN PAGOS — franja full-width debajo de las columnas ── */}
        <div className="shrink-0 border-t-2 border-slate-100 bg-gradient-to-b from-slate-50 to-white">

          {/* Header pagos + COD Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 pt-3 pb-2 gap-2 border-b border-slate-100/80 bg-slate-50/50">
            <div className="flex items-center gap-3.5 flex-wrap">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <CreditCard size={13} /> Métodos de Pago
              </span>

              {/* Toggle Cobro a destino (COD) */}
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-sm">
                <span className="p-0.5 rounded bg-rose-50 text-rose-600">
                  <Truck size={12} />
                </span>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-700 leading-tight">¿Cobro a destino (COD)?</span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleCod}
                  className={`relative inline-flex h-4.5 w-8.5 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    esCod ? 'bg-rose-500' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      esCod ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Control Segmentado (Tabs) */}
              {esCod && (
                <div className="flex p-0.5 bg-slate-100 rounded-xl border border-slate-200/50">
                  <button
                    type="button"
                    onClick={() => setTabActiva('inmediato')}
                    className={`px-3 py-1 text-[10px] font-black rounded-lg transition-all ${
                      tabActiva === 'inmediato'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Adelanto (${fmtUsd(totalInmediato)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTabActiva('cod')}
                    className={`px-3 py-1 text-[10px] font-black rounded-lg transition-all ${
                      tabActiva === 'cod'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    En Destino (${fmtUsd(montoCodRequerido)})
                  </button>
                </div>
              )}
            </div>

            {totales.estaCuadrado ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full shrink-0">
                <CheckCircle size={12} /> Pagos cuadrados ✓
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-black px-3 py-1 rounded-full border shrink-0 ${
                totales.diferencia > 0
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-red-50 text-red-600 border-red-200'
              }`}>
                <AlertCircle size={12} />
                {totales.diferencia > 0
                  ? `Pendiente: ${fmtUsd(totales.diferencia)}`
                  : `Exceso: ${fmtUsd(Math.abs(totales.diferencia))}`}
              </span>
            )}
          </div>

          {/* Área de la grilla de pagos (intercambiable) */}
          <div className="px-6 py-4">
            {(!esCod || tabActiva === 'inmediato') ? (
              // VISTA: PAGO INMEDIATO (ADELANTO)
              <div className="space-y-2">
                {esCod && (
                  <p className="text-[10px] font-black text-indigo-500/80 uppercase tracking-widest pl-1">
                    1. Registrar abonos o adelantos inmediatos
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pagosInmediatos.map((p, i) => {
                    const restante = totalConFlete - totalInmediato
                    return (
                      <div key={p.metodo} className="flex flex-col gap-2 bg-white rounded-2xl border border-slate-200 p-3 shadow-sm hover:border-indigo-200 transition-colors group relative">
                        {/* Fila Principal: Método + Monto */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{p.metodo}</p>
                            <div className="flex items-center gap-1">
                              <span className="text-slate-400 text-xs font-bold">$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={p.monto}
                                onChange={e => handleSetMontoPagoInmediato(p.metodo, e.target.value)}
                                onFocus={e => e.target.select()}
                                className="w-full py-1 px-2 rounded-lg border border-slate-100 text-sm font-black text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-all bg-slate-50 focus:bg-white"
                                placeholder="0.00"
                              />
                            </div>
                          </div>

                          {/* Acciones compactas */}
                          <div className="flex flex-col items-end gap-1">
                            <button
                              onClick={() => handleTogglePagoInmediato(p.metodo)}
                              className="text-slate-300 hover:text-red-500 transition-colors p-1"
                              title="Eliminar este método"
                            >
                              <X size={14} />
                            </button>
                            {restante > 0.01 && (
                              <button
                                onClick={() => handleSetMontoPagoInmediato(p.metodo, Number(((Number(p.monto) || 0) + restante).toFixed(2)))}
                                className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 hover:bg-emerald-100 transition-colors whitespace-nowrap"
                              >
                                + RESTO
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Fila Secundaria: Días Vencimiento (si aplica) */}
                        {p.metodo === 'Cta por cobrar' && (
                          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-50">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">
                              Días venc. {esVendedorSinComision ? '(opcional)' : '(obligatorio) *'}:
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={p.diasVencimiento || ''}
                              onChange={e => updatePagoInmediato(p.metodo, { diasVencimiento: e.target.value ? parseInt(e.target.value) : null })}
                              className="flex-1 py-1 px-2 rounded-lg text-[11px] font-bold border border-slate-100 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white transition-all"
                              placeholder={esVendedorSinComision ? 'Opcional' : 'Obligatorio'}
                            />
                          </div>
                        )}

                        {/* Referencia para Transferencia y Pago Móvil */}
                        {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(p.metodo) && (
                          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-50">
                            <span className="text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">
                              Referencia (opcional):
                            </span>
                            <input
                              type="text"
                              value={p.referencia ?? ''}
                              onChange={e => updatePagoInmediato(p.metodo, { referencia: e.target.value })}
                              className="flex-1 py-1 px-2 rounded-lg text-[11px] font-bold border border-slate-100 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white transition-all"
                              placeholder="Ej: 12345"
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Selector / Añadir pago inmediato */}
                  {((!esCod && !pagoInmediatoCuadrado) || (esCod && totalInmediato < totalConFlete)) && (
                    <div className="flex flex-col h-full min-h-[62px]">
                      {mostrarSelectorInmediato ? (
                        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-2.5 h-full flex flex-col justify-center">
                          <div className="flex flex-wrap gap-1">
                            {/* Chip especial para Saldo a Favor */}
                            {Number(billingCliente?.saldo_a_favor || 0) > 0 && !pagosInmediatos.some(f => f.metodo === 'Saldo a Favor') && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleTogglePagoInmediato('Saldo a Favor')
                                  setMostrarSelectorInmediato(false)
                                }}
                                className="px-2 py-1 rounded-lg text-[9px] font-black bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                              >
                                Saldo a Favor (${Number(billingCliente.saldo_a_favor).toFixed(2)})
                              </button>
                            )}

                            {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && (m !== 'Donación' || perfil?.rol !== 'vendedor'))
                              .filter(m => m !== 'Saldo a Favor')
                              .filter(m => !pagosInmediatos.some(f => f.metodo === m))
                              .map(metodo => (
                                <button
                                  key={metodo}
                                  onClick={() => {
                                    handleTogglePagoInmediato(metodo)
                                    setMostrarSelectorInmediato(false)
                                  }}
                                  className="px-2 py-1 rounded-lg text-[9px] font-bold bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                                >
                                  {metodo}
                                </button>
                              ))}
                          </div>
                          <button
                            onClick={() => setMostrarSelectorInmediato(false)}
                            className="mt-1.5 text-[9px] text-indigo-400 hover:text-indigo-600 transition-colors font-bold text-center"
                          >
                            CANCELAR
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setMostrarSelectorInmediato(true)}
                          className="h-full flex items-center justify-center gap-1.5 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-[10px] font-bold hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all p-3"
                        >
                          <Plus size={12} /> AÑADIR PAGO
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Banner de Vuelto / Excedente a Saldo a Favor */}
                {pagosInmediatosHayVuelto && (
                  <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200">
                    <div className="flex items-start gap-2">
                      <span className="p-1 rounded-lg bg-indigo-100 text-indigo-600 shrink-0 mt-0.5">
                        <DollarSign size={14} />
                      </span>
                      <div>
                        <span className="text-[11px] font-black text-indigo-900 block">
                          El pago supera el total por ${pagosInmediatosDiferencia.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-indigo-600 font-bold leading-normal">
                          ¿Qué deseas hacer con la diferencia? {tasa > 0 && `(Equivale a ${fmtBs(pagosInmediatosDiferencia * tasa)})`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <span className="text-[10px] font-bold text-slate-500">Vuelto Físico</span>
                      <button
                        type="button"
                        onClick={() => setVueltoComoSaldoFavor(!vueltoComoSaldoFavor)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          vueltoComoSaldoFavor ? 'bg-indigo-600' : 'bg-slate-200'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            vueltoComoSaldoFavor ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span className="text-[10px] font-black text-indigo-700">Saldo a Favor</span>
                    </div>
                  </div>
                )}

                {esCod && pagosInmediatos.length === 0 && (
                  <p className="text-xs text-slate-400 italic pl-1 pt-1">No se registraron adelantos inmediatos.</p>
                )}
              </div>
            ) : (
              // VISTA: COBRO EN DESTINO (COD PROPUESTA)
              <div className="space-y-2">
                <p className="text-[10px] font-black text-rose-500/80 uppercase tracking-widest pl-1">
                  2. Definir propuesta de cobro al recibir en destino
                </p>
                {montoCodRequerido > 0.015 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {propuestaCod.map((p, i) => {
                      const restanteCod = Math.max(0, round2(montoCodRequerido - totalPropuestaCod))
                      return (
                        <div key={p.metodo} className="flex flex-col gap-2 bg-white rounded-2xl border border-rose-100 p-3 shadow-sm hover:border-rose-200 transition-colors group relative">
                          {/* Fila Principal: Método + Monto */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest leading-none mb-1">{p.metodo}</p>
                              <div className="flex items-center gap-1">
                                <span className="text-rose-400 text-xs font-bold">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={p.monto}
                                  onChange={e => setMontoPropuestaCod(p.metodo, e.target.value)}
                                  onFocus={e => e.target.select()}
                                  className="w-full py-1 px-2 rounded-lg border border-rose-100 text-sm font-black text-slate-800 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-50 transition-all bg-slate-50 focus:bg-white"
                                  placeholder="0.00"
                                />
                              </div>
                            </div>

                            {/* Acciones compactas */}
                            <div className="flex flex-col items-end gap-1">
                              <button
                                onClick={() => togglePropuestaCod(p.metodo)}
                                className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                title="Eliminar esta propuesta"
                              >
                                <X size={14} />
                              </button>
                              {restanteCod > 0.01 && (
                                <button
                                  onClick={() => setMontoPropuestaCod(p.metodo, Number(((Number(p.monto) || 0) + restanteCod).toFixed(2)))}
                                  className="text-[9px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded border border-rose-100 hover:bg-rose-200 transition-colors whitespace-nowrap"
                                >
                                  + RESTO
                                </button>
                              )}
                            </div>
                            {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(p.metodo) && (
                              <div className="flex items-center gap-2 mt-1 pt-1 border-t border-rose-50">
                                <span className="text-[9px] font-bold text-rose-400 uppercase">
                                  Referencia (opcional):
                                </span>
                                <input
                                  type="text"
                                  value={p.referencia ?? ''}
                                  onChange={e => updatePropuestaCod(p.metodo, { referencia: e.target.value })}
                                  className="flex-1 py-1 px-2 rounded-lg text-[11px] font-bold border border-rose-100 bg-slate-50 focus:outline-none focus:border-rose-400 focus:bg-white transition-all"
                                  placeholder="Ej: 12345"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Selector / Añadir propuesta COD */}
                    {!propuestaCodCuadrado && (
                      <div className="flex flex-col h-full min-h-[62px]">
                        {mostrarSelectorCod ? (
                          <div className="bg-rose-50 border border-rose-100 rounded-2xl p-2.5 h-full flex flex-col justify-center">
                            <div className="flex flex-wrap gap-1">
                              {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && m !== 'Cta por cobrar' && m !== 'Donación')
                                .filter(m => !propuestaCod.some(f => f.metodo === m))
                                .map(metodo => (
                                  <button
                                    key={metodo}
                                    onClick={() => {
                                      togglePropuestaCod(metodo)
                                      setMostrarSelectorCod(false)
                                    }}
                                    className="px-2 py-1 rounded-lg text-[9px] font-bold bg-white border border-rose-200 text-rose-700 hover:bg-rose-600 hover:text-white transition-all shadow-sm"
                                  >
                                    {metodo}
                                  </button>
                                ))}
                            </div>
                            <button
                              onClick={() => setMostrarSelectorCod(false)}
                              className="mt-1.5 text-[9px] text-rose-400 hover:text-rose-600 transition-colors font-bold text-center"
                            >
                              CANCELAR
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setMostrarSelectorCod(true)}
                            className="h-full flex items-center justify-center gap-1.5 border-2 border-dashed border-rose-200 rounded-2xl text-rose-400 text-[10px] font-bold hover:border-rose-300 hover:text-rose-500 hover:bg-rose-50/50 transition-all p-3"
                          >
                            <Plus size={12} /> PROPONER PAGO
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-amber-600 font-bold bg-amber-50 border border-amber-200/60 p-2.5 rounded-xl inline-block">
                    El monto asignado en pagos inmediatos ya cubre el total.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer Totales + Botones ── */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 shrink-0">
          <div className="flex items-center justify-between gap-6">
            {/* Desglose de totales */}
            <div className="flex items-center gap-6 text-xs text-slate-500 flex-wrap">
              <span>Subtotal: <strong className="text-slate-700">{fmtUsd(totales.subtotal)}</strong></span>
              {Number(despacho?.flete_usd) > 0 && (
                <span className="text-emerald-600">Flete: <strong>+{fmtUsd(despacho.flete_usd)}</strong></span>
              )}
              {Number(despacho?.corte_usd) > 0 && (
                <span className="text-emerald-600">Corte: <strong>+{fmtUsd(despacho.corte_usd)}</strong></span>
              )}
              {Number(despacho?.descuento_total_usd) > 0 && (
                <span className="text-amber-600">Desc: <strong>-{fmtUsd(despacho.descuento_total_usd)}</strong></span>
              )}
              <span className="text-base font-black text-slate-900">
                Total: {fmtUsd(totales.total)}
              </span>
            </div>

            {/* Botones */}
            <div className="flex gap-3 shrink-0">
              <button
                onClick={onClose}
                disabled={editarItems.isPending}
                className="px-5 py-3 rounded-2xl border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={editarItems.isPending || items.length === 0 || !totales.estaCuadrado || !cxcVencimientoValido}
                title={
                  !cxcVencimientoValido
                    ? 'Días de vencimiento obligatorios para cuentas por cobrar'
                    : esCod
                    ? (!propuestaCodCuadrado ? 'La propuesta COD no está cuadrada' : undefined)
                    : (!pagoInmediatoCuadrado ? 'Los montos no cuadran con el total' : undefined)
                }
                className="px-6 py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {editarItems.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal editar externo */}
      <ModalEditarExterno
        isOpen={editItemIdx !== null}
        item={editItemIdx !== null ? items[editItemIdx] : null}
        idx={editItemIdx}
        onClose={() => setEditItemIdx(null)}
        onSave={(idx, updates) => {
          setItems(prev => prev.map((x, i) => i === idx ? { ...x, ...updates } : x))
          setEditItemIdx(null)
          showToast('Producto actualizado', 'success')
        }}
      />
    </div>
  )
}

function ModalEditarExterno({ isOpen, item, onClose, onSave, idx }) {
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [precio, setPrecio] = useState('')
  const [unidad, setUnidad] = useState('')

  useEffect(() => {
    if (item && isOpen) {
      setNombre(item.nombreSnap || '')
      setCodigo(item.codigoSnap || '')
      setPrecio(item.precioUnitUsd || '')
      setUnidad(item.unidadSnap || '')
    }
  }, [item, isOpen])

  if (!isOpen || !item) return null

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-5 space-y-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
            <Edit2 size={16} className="text-amber-500" /> Editar producto externo
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nombre del producto</label>
            <input 
              type="text" 
              value={nombre} 
              onChange={e => setNombre(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Código</label>
              <input 
                type="text" 
                value={codigo} 
                onChange={e => setCodigo(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unidad</label>
              <input 
                type="text" 
                value={unidad} 
                onChange={e => setUnidad(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Precio Unitario (USD)</label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="number" 
                step="0.01"
                value={precio} 
                onChange={e => setPrecio(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:outline-none font-bold text-slate-700"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">
            Cancelar
          </button>
          <button 
            onClick={() => onSave(idx, { nombreSnap: nombre, codigoSnap: codigo, precioUnitUsd: Number(precio), unidadSnap: unidad })}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 active:scale-95 transition-all"
          >
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  )
}
