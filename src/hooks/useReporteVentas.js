// src/hooks/useReporteVentas.js
// Hook principal para datos del reporte de ventas
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { getComisionPctForItem } from '../utils/comisionUtils'

export const REPORTE_KEY = ['reporte-ventas']

/**
 * Obtiene datos de ventas (despachos aprobados y entregados) en un rango de fechas,
 * con desglose por vendedor, cliente, producto y categoría.
 */
export function useReporteVentas({ from, to, prevFrom, prevTo }) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...REPORTE_KEY, from, to, prevFrom, prevTo, esPrivilegiado, perfil?.id],
    queryFn: async () => {
      const rawOffset = new Date().getTimezoneOffset()
      const sign = rawOffset <= 0 ? '+' : '-'
      const absOffset = Math.abs(rawOffset)
      const tzStr = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`

      // ── 1. Despachos entregados y en entrega (vía RPC) ──
      const fetchDespachos = async (f, t) => {
        const { data, error } = await supabase.rpc('obtener_reporte_ventas_operaciones', {
          p_fecha_inicio: f,
          p_fecha_fin: t,
          p_vendedor_id: esPrivilegiado ? null : perfil?.id
        })
        if (error) throw error
        return data ?? []
      }

      // Queries al Worker para comisiones (v2) — evita RLS directo y usa nombres v2
      const fetchComisionesWorker = async (f, t) => {
        const params = new URLSearchParams()
        params.set('desde', f)
        params.set('hasta', t)
        params.set('pageSize', '1000')
        if (!esPrivilegiado && perfil?.id) params.set('vendedorId', perfil.id)
        const headers = await getAuthHeaders()
        const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), { headers })
        if (!res.ok) return []
        const json = await res.json()
        return json?.data ?? []
      }

      // Fetch all users to have correct markup_pct, color and rates
      const fetchUsuarios = async () => {
        const { data } = await supabase
          .from('usuarios')
          .select('id, nombre, color, markup_pct, rol, comision_pct, comision_pct_cabilla, es_externo, activo')
        return data ?? []
      }

      const fetchConfiguracion = async () => {
        const { data } = await supabase
          .from('configuracion_negocio')
          .select('*')
          .eq('id', 1)
          .maybeSingle()
        return data ?? {
          comision_pct_cabilla: 0,
          comision_pct_otros: 0,
          comision_pct_externos: 3,
          comision_categoria_cabilla: 'Cabilla'
        }
      }

      const fetchDevoluciones = async (f, t) => {
        const { data, error } = await supabase
          .from('cuentas_por_cobrar')
          .select(`
            id, cliente_id, monto_usd, forma_pago_abono, referencia, descripcion, creado_en, registrado_por,
            cliente:clientes!cuentas_por_cobrar_cliente_id_fkey(id, nombre, tipo_cliente, vendedor_id)
          `)
          .eq('tipo', 'devolucion_credito')
          .gte('creado_en', `${f}T00:00:00${tzStr}`)
          .lte('creado_en', `${t}T23:59:59.999${tzStr}`)
          .order('creado_en', { ascending: false })

        if (error) throw error

        const filtered = (data ?? []).filter(item => {
          if (!item.cliente) return false
          if (!esPrivilegiado && item.cliente.vendedor_id !== perfil?.id) return false
          return true
        })
        return filtered
      }

      const [despachosRaw, prevDespachosRaw, comisionesRaw, prevComisionesRaw, dbVendedores, config, devolucionesRaw, prevDevolucionesRaw] = await Promise.all([
        fetchDespachos(from, to),
        fetchDespachos(prevFrom, prevTo),
        fetchComisionesWorker(from, to),
        fetchComisionesWorker(prevFrom, prevTo),
        fetchUsuarios(),
        fetchConfiguracion(),
        fetchDevoluciones(from, to),
        fetchDevoluciones(prevFrom, prevTo),
      ])

      const vendorMarkupMap = {}
      const vendorColorMap = {}
      const vendorRolMap = {}
      const vendorEsExternoMap = {}
      if (dbVendedores) {
        dbVendedores.forEach(u => {
          vendorMarkupMap[u.id] = u.markup_pct != null ? Number(u.markup_pct) : null
          vendorColorMap[u.id] = u.color || '#64748b'
          vendorRolMap[u.id] = u.rol
          vendorEsExternoMap[u.id] = !!u.es_externo
        })
      }

      const normalizarFormaPagoDespacho = (d) => {
        const formas = Array.isArray(d.forma_pago) ? d.forma_pago : []
        const processedFormas = []
        if (formas.length > 0) {
          formas.forEach(f => {
            if (f.metodo === 'Cobro a destino') {
              if (f.cobro_destino_pagado) {
                const metodosDefinitivos = Array.isArray(f.metodos_pagados) ? f.metodos_pagados : (Array.isArray(f.metodo_propuesto) ? f.metodo_propuesto : []);
                if (metodosDefinitivos.length > 0) {
                  metodosDefinitivos.forEach(p => {
                    const rawMetodo = p.metodo === 'Efectivo' ? 'Efectivo $' : (p.metodo || 'Efectivo $')
                    const finalMetodo = (rawMetodo === 'Transferencia' || rawMetodo === 'Pago Móvil') ? 'Transf. / Pago Móvil' : rawMetodo
                    processedFormas.push({ metodo: finalMetodo, monto: Number(p.monto) || 0 })
                  })
                } else {
                  processedFormas.push({ metodo: 'Efectivo $', monto: Number(f.monto) || 0 })
                }
              } else {
                processedFormas.push({ metodo: 'Cobro a destino', monto: Number(f.monto) || 0 })
              }
            } else {
              const rawMetodo = f.metodo === 'Efectivo' ? 'Efectivo $' : (f.metodo || 'Sin especificar')
              const metodoNorm = (rawMetodo === 'Transferencia' || rawMetodo === 'Pago Móvil') ? 'Transf. / Pago Móvil' : rawMetodo
              processedFormas.push({ ...f, metodo: metodoNorm })
            }
          })
        } else {
          // Si no tiene formas de pago, no hacer nada o dejar vacío
        }
        return {
          ...d,
          forma_pago: processedFormas
        }
      }

      const despachos = despachosRaw.map(normalizarFormaPagoDespacho).filter(d => {
        const role = vendorRolMap[d.asesor_id || d.vendedor_id]
        return role !== 'desarrollador' && role !== 'administracion' && role !== 'logistica'
      })
      const prevDespachos = prevDespachosRaw.map(normalizarFormaPagoDespacho).filter(d => {
        const role = vendorRolMap[d.asesor_id || d.vendedor_id]
        return role !== 'desarrollador' && role !== 'administracion' && role !== 'logistica'
      })

      const allDispatchIds = [
        ...new Set([
          ...despachos.map(d => d.despacho_id),
          ...prevDespachos.map(d => d.despacho_id)
        ].filter(Boolean))
      ]

      let ndItems = []
      let despachoDescuentos = []

      if (allDispatchIds.length > 0) {
        for (let i = 0; i < allDispatchIds.length; i += 50) {
          const batch = allDispatchIds.slice(i, i + 50)
          const { data: itemsData } = await supabase
            .from('notas_despacho_items')
            .select('despacho_id, producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, origen, es_prestamo')
            .in('despacho_id', batch)
          if (itemsData) ndItems = ndItems.concat(itemsData)

          const { data: descData } = await supabase
            .from('despacho_descuentos')
            .select('despacho_id, cotizacion_item_id, monto_usd')
            .in('despacho_id', batch)
          if (descData) despachoDescuentos = despachoDescuentos.concat(descData)
        }
      }

      // ── 2. Items de las cotizaciones de los despachos ──
      const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
      let items = []
      if (cotIds.length > 0) {
        // Supabase .in() tiene límite, dividir en batches de 50
        for (let i = 0; i < cotIds.length; i += 50) {
          const batch = cotIds.slice(i, i + 50)
          const { data, error } = await supabase
            .from('cotizacion_items')
            .select('id, producto_id, nombre_snap, codigo_snap, cantidad, precio_unit_usd, total_linea_usd, cotizacion_id, origen')
            .in('cotizacion_id', batch)
          if (error) throw error
          items = items.concat(data ?? [])
        }
      }

      // ── 2.5. Unificación e Identificación de Préstamos/Donaciones en Items ──
      const itemsFinales = []
      despachos.forEach(d => {
        const dispatchItems = ndItems.filter(it => it.despacho_id === d.despacho_id)
        const fp = Array.isArray(d.forma_pago) ? d.forma_pago : []
        const tienePrestamoFp = fp.some(f => f.metodo === 'Préstamo' || f.metodo === 'Prestamo')
        const esDonacion = fp.some(f => f.metodo === 'Donación')

        if (dispatchItems.length > 0) {
          dispatchItems.forEach(it => {
            const esItemPrestamo = !!it.es_prestamo || tienePrestamoFp
            itemsFinales.push({
              ...it,
              cotizacion_id: d.cotizacion_id,
              total_linea_usd: esItemPrestamo ? 0 : Number(it.total_linea_usd || 0),
              es_prestamo: esItemPrestamo,
              es_donacion: esDonacion
            })
          })
        } else {
          const cotItems = items.filter(it => it.cotizacion_id === d.cotizacion_id)
          cotItems.forEach(it => {
            const desc = despachoDescuentos.find(dd => dd.despacho_id === d.despacho_id && dd.cotizacion_item_id === it.id)
            const descMonto = desc ? Number(desc.monto_usd || 0) : 0
            const totalNeto = Math.max(Number(it.total_linea_usd || 0) - descMonto, 0)
            const esItemPrestamo = tienePrestamoFp
            itemsFinales.push({
              ...it,
              total_linea_usd: esItemPrestamo ? 0 : totalNeto,
              es_prestamo: esItemPrestamo,
              es_donacion: esDonacion
            })
          })
        }
      })

      // Fetch product categories
      const allProductIds = [
        ...new Set([
          ...itemsFinales.map(i => i.producto_id)
        ].filter(Boolean))
      ]
      const productCategories = {}
      if (allProductIds.length > 0) {
        for (let i = 0; i < allProductIds.length; i += 50) {
          const batch = allProductIds.slice(i, i + 50)
          const { data } = await supabase
            .from('productos')
            .select('id, categoria')
            .in('id', batch)
          if (data) {
            data.forEach(p => {
              productCategories[p.id] = p.categoria || ''
            })
          }
        }
      }

      const calcularComisionDespachoJS = (d, comList) => {
        let esDonacion = false
        const fp = Array.isArray(d.forma_pago) ? d.forma_pago : []
        if (fp.some(f => f.metodo === 'Donación') || d.forma_pago === 'Donación') {
          esDonacion = true
        }

        if (esDonacion) {
          return {
            totalcomision: 0,
            comisioncabilla: 0,
            comisionotros: 0,
            pctcabilla: 0,
            pctotros: 0,
            estado: 'pagada'
          }
        }

        const existing = comList.find(c => c.despachoid === d.despacho_id)
        if (existing) {
          return {
            totalcomision: Number(existing.totalcomision || 0),
            comisioncabilla: Number(existing.comisioncabilla || 0),
            comisionotros: Number(existing.comisionotros || 0),
            pctcabilla: Number(existing.pctcabilla || 0),
            pctotros: Number(existing.pctotros || 0),
            estado: existing.estado || 'pendiente'
          }
        }

        if (d.estado !== 'entregada' && d.estado !== 'despachada') {
          return null
        }

        const seller = dbVendedores.find(u => u.id === d.asesor_id || u.id === d.vendedor_id)
        if (!seller) return null
        const rol = seller.rol

        if (rol === 'vendedor_sin_comision' && !seller.es_externo) {
          return null
        }
        if (['jefe', 'logistica', 'administracion', 'desarrollador'].includes(rol)) {
          return null
        }

        const dispatchItems = ndItems.filter(it => it.despacho_id === d.despacho_id)
        let comisionCabilla = 0
        let comisionOtros = 0

        const processItem = (it, totalNeto) => {
          const nameLower = (it.nombre_snap || '').toLowerCase().trim()
          if (nameLower.startsWith('corte')) return

          const pct = getComisionPctForItem(
            {
              nombre_snap: it.nombre_snap,
              producto_id: it.producto_id,
              codigo_snap: it.codigo_snap,
              origen: it.origen,
              categoria: productCategories[it.producto_id] || ''
            },
            config,
            seller
          )

          const comLinea = Math.round((totalNeto * pct / 100) * 100) / 100

          // Determine if it belongs to cabilla or others
          const catCabillaStr = (config.comision_categoria_cabilla || 'Cabilla').toLowerCase().trim()
          const prodCat = (productCategories[it.producto_id] || '').toLowerCase().trim()
          const es_externo = !!seller.es_externo
          const esCementoVendedorExterno = es_externo && (prodCat === 'cemento' || nameLower.includes('cemento'))
          const esCabilla = prodCat === catCabillaStr

          if (esCabilla || esCementoVendedorExterno) {
            comisionCabilla += comLinea
          } else {
            comisionOtros += comLinea
          }
        }

        if (dispatchItems.length > 0) {
          dispatchItems.forEach(it => {
            processItem(it, Number(it.total_linea_usd || 0))
          })
        } else {
          const cotItems = items.filter(it => it.cotizacion_id === d.cotizacion_id)
          cotItems.forEach(it => {
            const desc = despachoDescuentos.find(dd => dd.despacho_id === d.despacho_id && dd.cotizacion_item_id === it.id)
            const descMonto = desc ? Number(desc.monto_usd || 0) : 0
            const totalNeto = Math.max(Number(it.total_linea_usd || 0) - descMonto, 0)
            processItem(it, totalNeto)
          })
        }

        const totalComision = comisionCabilla + comisionOtros
        const pctCabilla = seller.es_externo
          ? Number(config.comision_ext_pct_cabilla ?? 2)
          : (seller.comision_pct_cabilla != null ? Number(seller.comision_pct_cabilla) : Number(config.comision_pct_cabilla ?? 2))
        const pctOtros = seller.es_externo
          ? Number(config.comision_ext_pct_otros ?? 3)
          : (seller.comision_pct != null ? Number(seller.comision_pct) : Number(config.comision_pct_otros ?? 3))

        return {
          totalcomision: totalComision,
          comisioncabilla: comisionCabilla,
          comisionotros: comisionOtros,
          pctcabilla: pctCabilla,
          pctotros: pctOtros,
          estado: 'pendiente'
        }
      }

      const comisiones = despachos.map(d => {
        const calculated = calcularComisionDespachoJS(d, comisionesRaw)
        if (calculated) {
          const seller = dbVendedores.find(u => u.id === d.asesor_id || u.id === d.vendedor_id)
          return {
            ...calculated,
            vendedorid: d.asesor_id || d.vendedor_id,
            despachoid: d.despacho_id,
            vendedor: seller
          }
        }
        return null
      }).filter(Boolean)

      const prevComisiones = prevDespachos.map(d => {
        const calculated = calcularComisionDespachoJS(d, prevComisionesRaw)
        if (calculated) {
          const seller = dbVendedores.find(u => u.id === d.asesor_id || u.id === d.vendedor_id)
          return {
            ...calculated,
            vendedorid: d.asesor_id || d.vendedor_id,
            despachoid: d.despacho_id,
            vendedor: seller
          }
        }
        return null
      }).filter(Boolean)

      // Map cotizacion_id → despacho para enlazar items con vendedor/cliente
      const cotToDespacho = Object.fromEntries(despachos.map(d => [d.cotizacion_id, d]))

      // ── 3. Agregaciones ──

      // KPIs actuales
      const ventaNeta = (d) => Number(d.venta_neta_usd || 0)
      const totalVentas = despachos.reduce((s, d) => s + ventaNeta(d), 0)
      const totalFlete = despachos.reduce((s, d) => s + Number(d.flete_usd || 0), 0)
      const totalDescuentos = despachos.reduce((s, d) => s + Number(d.descuento_usd || 0), 0)
      const numDespachos = despachos.length
      const ticketPromedio = numDespachos > 0 ? totalVentas / numDespachos : 0
      const totalComisiones = comisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const comisionesPagadas = comisiones.filter(c => c.estado === 'pagada').reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const comisionesPendientes = comisiones.filter(c => c.estado === 'pendiente').reduce((s, c) => s + Number(c.totalcomision || 0), 0)
      const comisionCabilla2 = comisiones.filter(c => Math.round(Number(c.pctcabilla || 0)) === 2).reduce((s, c) => s + Number(c.comisioncabilla || 0), 0)
      const comisionCabilla3 = comisiones.filter(c => Math.round(Number(c.pctcabilla || 0)) === 3).reduce((s, c) => s + Number(c.comisioncabilla || 0), 0)
      const comisionOtros = comisiones.reduce((s, c) => s + Number(c.comisionotros || 0), 0)

      // KPIs anteriores (para comparativo)
      const prevTotalVentas = prevDespachos.reduce((s, d) => s + Number(d.venta_neta_usd || 0), 0)
      const prevNumDespachos = prevDespachos.length
      const prevTicketPromedio = prevNumDespachos > 0 ? prevTotalVentas / prevNumDespachos : 0
      const prevTotalComisiones = prevComisiones.reduce((s, c) => s + Number(c.totalcomision || 0), 0)

      // Por vendedor
      const vendedorMap = {}

      // Pre-populamos todos los vendedores activos para que siempre aparezcan en el reporte
      dbVendedores.forEach(u => {
        const esVendedorActivo = u.activo && (u.rol === 'vendedor' || u.rol === 'vendedor_sin_comision' || !!u.es_externo || (u.markup_pct != null && Number(u.markup_pct) > 0))
        if (esVendedorActivo) {
          vendedorMap[u.id] = {
            id: u.id,
            nombre: u.nombre,
            color: u.color || '#64748b',
            markup_pct: u.markup_pct != null ? Number(u.markup_pct) : null,
            rol: u.rol,
            es_externo: !!u.es_externo,
            despachos: 0,
            totalUsd: 0,
            comision: 0,
            comisionCabilla2: 0,
            comisionCabilla3: 0,
            comisionOtros: 0,
          }
        }
      })

      despachos.forEach(d => {
        const vid = d.asesor_id || 'unassigned'
        if (!vendedorMap[vid]) {
          vendedorMap[vid] = {
            id: vid,
            nombre: d.asesor_nombre ?? 'Sin nombre',
            color: (vendorColorMap[vid] || d.asesor_color) ?? '#64748b',
            markup_pct: vendorMarkupMap[vid] ?? null,
            rol: vendorRolMap[vid],
            es_externo: vendorEsExternoMap[vid] ?? false,
            despachos: 0,
            totalUsd: 0,
            comision: 0,
            comisionCabilla2: 0,
            comisionCabilla3: 0,
            comisionOtros: 0,
          }
        }
        vendedorMap[vid].despachos++
        vendedorMap[vid].totalUsd += ventaNeta(d)
      })
      comisiones.forEach(c => {
        const vid = c.vendedorid || c.vendedor_id || 'unassigned'
        if (!vendedorMap[vid]) {
          vendedorMap[vid] = {
            id: vid,
            nombre: c.vendedor?.nombre || c.vendedornombre || 'Sin nombre',
            color: vendorColorMap[vid] || c.vendedor?.color || c.vendedorcolor || '#64748b',
            markup_pct: vendorMarkupMap[vid] ?? c.vendedor?.markup_pct ?? null,
            rol: vendorRolMap[vid] || c.vendedor?.rol,
            es_externo: vendorEsExternoMap[vid] ?? !!c.vendedor?.es_externo ?? false,
            despachos: 0,
            totalUsd: 0,
            comision: 0,
            comisionCabilla2: 0,
            comisionCabilla3: 0,
            comisionOtros: 0,
          }
        }
        vendedorMap[vid].comision += Number(c.totalcomision || 0)
        const pctCab = Math.round(Number(c.pctcabilla || 0))
        const montoCab = Number(c.comisioncabilla || 0)
        if (pctCab === 2) {
          vendedorMap[vid].comisionCabilla2 = (vendedorMap[vid].comisionCabilla2 || 0) + montoCab
        } else if (pctCab === 3) {
          vendedorMap[vid].comisionCabilla3 = (vendedorMap[vid].comisionCabilla3 || 0) + montoCab
        }
        const montoOtros = Number(c.comisionotros || 0)
        vendedorMap[vid].comisionOtros = (vendedorMap[vid].comisionOtros || 0) + montoOtros
      })
      if (comisiones.length > 0) {
        console.log('[DEBUG] First comision from worker:', comisiones[0])
      }
      const porVendedor = Object.values(vendedorMap)
        .filter(v => {
          if (v.rol === 'desarrollador') return false
          if (v.rol === 'administracion' || v.rol === 'logistica') return false
          
          // Mantener a todos los vendedores, incluidos los "vendedores sin comisión" (como "EMPRESA") en el reporte de ventas, ya que sus despachos representan ventas de la empresa reales
          return true
        })
        .sort((a, b) => b.totalUsd - a.totalUsd)

      // Por cliente
      const clienteMap = {}
      despachos.forEach(d => {
        const cnombre = d.cliente_nombre || 'Sin cliente'
        if (!clienteMap[cnombre]) {
          clienteMap[cnombre] = {
            id: cnombre,
            nombre: cnombre,
            tipo_cliente: d.cliente_tipo_cliente,
            despachos: 0,
            totalUsd: 0,
            vendedor: d.asesor_nombre || '—',
          }
        }
        clienteMap[cnombre].despachos++
        clienteMap[cnombre].totalUsd += ventaNeta(d)
      })
      const porCliente = Object.values(clienteMap).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 10)
      console.log('[DEBUG] Top Clientes generated:', porCliente)

      // Por producto
      const productoMap = {}
      itemsFinales.forEach(it => {
        const key = it.producto_id || it.nombre_snap
        if (!productoMap[key]) {
          productoMap[key] = {
            id: it.producto_id,
            nombre: it.nombre_snap,
            codigo: it.codigo_snap,
            unidades: 0,
            totalUsd: 0,
          }
        }
        productoMap[key].unidades += Number(it.cantidad || 0)
        productoMap[key].totalUsd += Number(it.total_linea_usd || 0)
      })
      const porProducto = Object.values(productoMap)
        .sort((a, b) => {
          if (b.totalUsd !== a.totalUsd) return b.totalUsd - a.totalUsd
          return b.unidades - a.unidades
        })
        .slice(0, 100)

      // Por categoría (necesitamos los nombres de categoría de los productos)
      const productoIds = [...new Set(itemsFinales.map(i => i.producto_id).filter(Boolean))]
      let categoriaMap = {}
      if (productoIds.length > 0) {
        const cats = {}
        for (let i = 0; i < productoIds.length; i += 50) {
          const batch = productoIds.slice(i, i + 50)
          const { data } = await supabase.from('productos').select('id, categoria').in('id', batch)
          if (data) data.forEach(p => { cats[p.id] = p.categoria || 'PRODUCTOS EXTERNOS' })
        }
        itemsFinales.forEach(it => {
          const cat = cats[it.producto_id] || 'PRODUCTOS EXTERNOS'
          if (!categoriaMap[cat]) categoriaMap[cat] = { categoria: cat, unidades: 0, totalUsd: 0 }
          categoriaMap[cat].unidades += Number(it.cantidad || 0)
          categoriaMap[cat].totalUsd += Number(it.total_linea_usd || 0)
        })
      }
       const porCategoria = Object.values(categoriaMap).sort((a, b) => b.totalUsd - a.totalUsd)
 
        // Map dispatch prestamo metadata based on itemsFinales
        const despachosMapeados = despachos.map(d => {
          const dispatchItems = itemsFinales.filter(it => it.despacho_id === d.despacho_id)
          const hasPrestamos = dispatchItems.some(it => it.es_prestamo)
          const esPrestamoPuro = hasPrestamos && Number(d.venta_neta_usd || 0) === 0
          const esPrestamoMixto = hasPrestamos && Number(d.venta_neta_usd || 0) > 0
  
          return {
            ...d,
            tiene_prestamos: hasPrestamos,
            es_prestamo_puro: esPrestamoPuro,
            es_prestamo_mixto: esPrestamoMixto,
            items: dispatchItems
          }
        })
 
       // ── Devoluciones (Mapeo) ──
       const devoluciones = devolucionesRaw.map(dev => {
         const sellerId = dev.cliente?.vendedor_id
         const seller = dbVendedores.find(u => u.id === sellerId)
         return {
           ...dev,
           cliente_nombre: dev.cliente?.nombre || 'Sin cliente',
           cliente_tipo_cliente: dev.cliente?.tipo_cliente || 'regular',
           vendedor_id: sellerId || null,
           vendedor_nombre: seller?.nombre || '—',
           vendedor_color: seller?.color || '#64748b'
         }
       })

       const prevDevoluciones = prevDevolucionesRaw.map(dev => {
         const sellerId = dev.cliente?.vendedor_id
         const seller = dbVendedores.find(u => u.id === sellerId)
         return {
           ...dev,
           cliente_nombre: dev.cliente?.nombre || 'Sin cliente',
           cliente_tipo_cliente: dev.cliente?.tipo_cliente || 'regular',
           vendedor_id: sellerId || null,
           vendedor_nombre: seller?.nombre || '—',
           vendedor_color: seller?.color || '#64748b'
         }
       })

       const totalDevoluciones = devoluciones.reduce((s, d) => s + Number(d.monto_usd || 0), 0)
       const prevTotalDevoluciones = prevDevoluciones.reduce((s, d) => s + Number(d.monto_usd || 0), 0)

       // Forma de pago
       const formaPagoMap = {}
       despachosMapeados.forEach(d => {
         const formas = Array.isArray(d.forma_pago) ? d.forma_pago : []
         const tasaDespacho = Number(d.tasa)
         const tasaValida = tasaDespacho > 0 ? tasaDespacho : null

         if (formas.length === 0) {
           const fallback = 'Pendiente'
           if (!formaPagoMap[fallback]) formaPagoMap[fallback] = { formaPago: fallback, count: 0, totalUsd: 0, pagos: [] }
           formaPagoMap[fallback].count++
           formaPagoMap[fallback].totalUsd += ventaNeta(d)
           formaPagoMap[fallback].pagos.push({
             cliente: d.cliente_nombre || 'Sin cliente',
             numero: d.despacho_numero || d.despacho_id?.slice(0, 8),
             monto: ventaNeta(d),
             tasa: tasaValida,
             montoBs: tasaValida ? ventaNeta(d) * tasaValida : null,
             referencia: null,
             es_prestamo_puro: d.es_prestamo_puro,
             es_prestamo_mixto: d.es_prestamo_mixto
           })
         } else {
           formas.forEach(f => {
             const nombre = f.metodo || 'Sin especificar'
             const monto = Number(f.monto) || 0
             if (!formaPagoMap[nombre]) formaPagoMap[nombre] = { formaPago: nombre, count: 0, totalUsd: 0, pagos: [] }
             formaPagoMap[nombre].count++
             formaPagoMap[nombre].totalUsd += monto
             formaPagoMap[nombre].pagos.push({
               cliente: d.cliente_nombre || 'Sin cliente',
               numero: d.despacho_numero || d.despacho_id?.slice(0, 8),
               monto: monto,
               tasa: tasaValida,
               montoBs: tasaValida ? monto * tasaValida : null,
               referencia: f.referencia || null,
               es_prestamo_puro: d.es_prestamo_puro,
               es_prestamo_mixto: d.es_prestamo_mixto
             })
           })
         }
       })

       // Agregar las devoluciones en la forma de pago correspondiente con signo negativo
       devoluciones.forEach(dev => {
         const nombre = dev.forma_pago_abono || 'Sin especificar'
         const monto = Number(dev.monto_usd) || 0
         if (!formaPagoMap[nombre]) {
           formaPagoMap[nombre] = { formaPago: nombre, count: 0, totalUsd: 0, pagos: [] }
         }
         formaPagoMap[nombre].totalUsd -= monto
         formaPagoMap[nombre].pagos.push({
           cliente: dev.cliente_nombre,
           numero: 'REEMBOLSO',
           monto: -monto,
           tasa: null,
           montoBs: null,
           referencia: dev.referencia || null,
           es_reembolso: true,
           descripcion: dev.descripcion
         })
       })

       const porFormaPago = Object.values(formaPagoMap).sort((a, b) => b.totalUsd - a.totalUsd)
 
       return {
         kpis: {
           totalVentas, totalFlete, totalDescuentos, numDespachos, ticketPromedio, totalComisiones,
           comisionesPagadas, comisionesPendientes, comisionCabilla2, comisionCabilla3, comisionOtros,
           prevTotalVentas, prevNumDespachos, prevTicketPromedio, prevTotalComisiones,
           totalDevoluciones, prevTotalDevoluciones
         },
         porVendedor,
         porCliente,
         porProducto,
         porCategoria,
         porFormaPago,
         despachos: despachosMapeados,
         devoluciones,
       }
    },
    enabled: !!perfil && !!from && !!to,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}
