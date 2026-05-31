// src/hooks/useDespachos.js
// Queries y mutations para notas de despacho
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { get as getIdbValue } from 'idb-keyval'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'
import { notifyDespachoCreado, notifyStockBajo, notifyDespachoEnRuta, notifyDespachoEntregado, notifyDespachoCancelado } from '../services/notificationService'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'
import { dequeuePending, enqueue } from '../lib/mutationQueue'
import { getLocalDespachos, getLocalClientes, getLocalUsuarios, getLocalTransportistas } from '../lib/offlineSnapshots'
import { getOfflineEntity, listOfflineEntities, makeLocalId, saveOfflineEntity, updateOfflineEntity } from '../lib/offlineEntities'
import { getOfflineDocument, saveOfflineDocument } from '../lib/offlineDocuments'
import { round2 } from '../utils/dinero'

export const DESPACHOS_KEY = ['despachos']

function normalizeLocalDespacho(row) {
  return {
    ...row.data,
    _queued: row.syncStatus !== 'synced',
    _local: true,
  }
}

function buildPendingEstadoPatch(mutation) {
  const nuevoEstado = mutation.payload?.nuevoEstado
  if (!nuevoEstado) return null
  const updatedIso = new Date(mutation.snapshotAt || mutation.createdAt || Date.now()).toISOString()
  return {
    estado: nuevoEstado,
    actualizado_en: updatedIso,
    ...(nuevoEstado === 'despachada' ? { despachada_en: updatedIso } : {}),
    ...(nuevoEstado === 'entregada' ? { entregada_en: updatedIso } : {}),
    _queued: true,
    _local: true,
  }
}

function normalizeQueuedDespachoItems(items = []) {
  return (items || []).map((item, index) => {
    const cantidad = Number(item.cantidad) || 0
    const precio = Number(item.precio_unit_usd ?? item.precioUnitUsd) || 0
    return {
      id: item.id || `local_item_${index}`,
      producto_id: item.producto_id || item.productoId || null,
      codigo_snap: item.codigo_snap || item.codigoSnap || item.codigo || '',
      nombre_snap: item.nombre_snap || item.nombreSnap || item.nombre || item.descripcion || 'Producto',
      unidad_snap: item.unidad_snap || item.unidadSnap || item.unidad || 'und',
      cantidad,
      precio_unit_usd: precio,
      total_linea_usd: Number(item.total_linea_usd ?? item.totalLineaUsd) || round2(cantidad * precio),
      orden: item.orden ?? index,
      es_prestamo: !!item.es_prestamo,
      origen: item.origen || (item.producto_id || item.productoId ? 'inventario' : 'externo'),
    }
  })
}

function reconstructDespachoFromVentaRapida(m, perfil) {
  const payload = m.payload
  const queuedItems = normalizeQueuedDespachoItems(payload.items)
  const vendedorId = payload.vendedorId || perfil?.id
  const vendedor = vendedorId
    ? { id: vendedorId, nombre: payload.vendedorNombre || (vendedorId === perfil?.id ? perfil?.nombre : null) || 'Vendedor' }
    : null
  const cliente = payload.clienteId
    ? { id: payload.clienteId, nombre: payload.clienteNombre || 'Cliente' }
    : null
  return {
    id: m.id, // mutation queue id as temporary id
    numero: 'PENDIENTE',
    cotizacion_id: null,
    estado: 'pendiente',
    tiene_prestamos: queuedItems.some(it => it.es_prestamo),
    total_usd: (queuedItems.reduce((s, it) => s + (it.es_prestamo ? 0 : it.total_linea_usd), 0) || 0) + (payload.fleteUsd || 0) + (payload.corteUsd || 0),
    flete_usd: payload.fleteUsd || 0,
    corte_usd: payload.corteUsd || 0,
    descuento_total_usd: 0,
    notas: payload.notas || null,
    forma_pago: payload.formaPago || null,
    forma_pago_cliente: payload.formaPagoCliente || payload.formaPago || null,
    referencia_pago: payload.referenciaPago || null,
    creado_en: new Date(m.createdAt).toISOString(),
    actualizado_en: new Date(m.createdAt).toISOString(),
    despachada_en: null,
    entregada_en: null,
    aprobado_por_nombre: null,
    cliente_id: payload.clienteId,
    cliente_factura_id: payload.clienteId,
    vendedor_id: vendedorId,
    transportista_id: payload.transportistaId || null,
    items_count: queuedItems.length,
    items: queuedItems,
    transportista: null,
    cotizacion: null,
    seguimiento: null,
    cliente,
    cliente_factura: cliente,
    vendedor,
    _queued: true
  }
}

// ─── Lista de despachos ─────────────────────────────────────────────────────
export function useDespachos({ estado = '', veTodos: veTodosParam = false, busqueda = '', esHoy = false } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const offline = useAuthStore(useCallback(s => s.offline, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esLogistica = perfil?.rol === 'logistica'
  const esAdmin = perfil?.rol === 'administracion'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  // Admin siempre ve todos; logística siempre ve todos; supervisor/dev solo si toggle activo
  const veTodos = esAdmin || esLogistica || ((esSupervisor || esDesarrollador) && veTodosParam)

  return useQuery({
    queryKey: [...DESPACHOS_KEY, estado, veTodos, perfil?.id, busqueda, esHoy, offline],
    queryFn: async () => {
      if (offline) {
        const localDespachos = await getLocalDespachos()
        const localDespachoEntities = await listOfflineEntities('despacho')
        const pendingMutations = await dequeuePending()
        const pendingEstadoByDespacho = new Map()
        pendingMutations
          .filter(m => m.type?.startsWith('MARCAR_DESPACHO_') && m.payload?.despachoId)
          .forEach(m => {
            const patch = buildPendingEstadoPatch(m)
            if (patch) pendingEstadoByDespacho.set(m.payload.despachoId, patch)
          })

        // Filter and map VENTA_RAPIDA mutations
        const localQuickSales = pendingMutations
          .filter(m => m.type === 'VENTA_RAPIDA')
          .map(m => reconstructDespachoFromVentaRapida(m, perfil))

        const materialized = localDespachoEntities.map(normalizeLocalDespacho)
        const seenLocal = new Set(materialized.map(d => d.id))
        let combined = [
          ...materialized,
          ...localQuickSales.filter(d => !seenLocal.has(d.id)),
          ...localDespachos.filter(d => !seenLocal.has(d.id)),
        ].map(d => pendingEstadoByDespacho.has(d.id) ? { ...d, ...pendingEstadoByDespacho.get(d.id) } : d)

        const localClientes = await getLocalClientes()
        const localUsuarios = await getLocalUsuarios()
        const localTransportistas = await getLocalTransportistas()

        const clientesMap = Object.fromEntries(localClientes.map(c => [c.id, c]))
        const usuariosMap = Object.fromEntries(localUsuarios.map(u => [u.id, u]))
        const transportistasMap = Object.fromEntries(localTransportistas.map(t => [t.id, t]))

        combined = combined.map(d => {
          const clienteBase = clientesMap[d.cliente_id] || d.cliente || null
          const vendedorId = d.vendedor_id || clienteBase?.vendedor_id || clienteBase?.vendedor?.id || d.vendedor?.id
          const vendedor = usuariosMap[vendedorId] || d.vendedor || clienteBase?.vendedor || (vendedorId === perfil?.id ? perfil : null)
          const cliente = clienteBase && vendedor && !clienteBase.vendedor
            ? { ...clienteBase, vendedor }
            : clienteBase
          return {
            ...d,
            vendedor_id: vendedorId || d.vendedor_id,
            cliente,
            cliente_factura: clientesMap[d.cliente_factura_id] || d.cliente_factura || null,
            vendedor,
            transportista: transportistasMap[d.transportista_id] || d.transportista || null,
          }
        })

        if (estado) {
          combined = combined.filter(d => d.estado === estado)
        }

        if (!veTodos) {
          combined = combined.filter(d => d.vendedor_id === perfil?.id)
        }

        if (esHoy) {
          const start = new Date()
          start.setHours(0, 0, 0, 0)
          const end = new Date()
          end.setHours(23, 59, 59, 999)
          combined = combined.filter(d => {
            const date = new Date(d.creado_en)
            return date >= start && date <= end
          })
        }

        if (busqueda && busqueda.trim()) {
          const q = busqueda.trim().toLowerCase()
          combined = combined.filter(d => {
            const num = String(d.numero || '').toLowerCase()
            const note = (d.notas || '').toLowerCase()
            const ref = (d.referencia_pago || '').toLowerCase()
            
            const cli = d.cliente || clientesMap[d.cliente_id]
            const cliName = (cli?.nombre || '').toLowerCase()
            const cliRif = (cli?.rif_cedula || '').toLowerCase()

            const vend = d.vendedor || usuariosMap[d.vendedor_id] || (d.vendedor_id === perfil?.id ? perfil : null)
            const vendName = (vend?.nombre || '').toLowerCase()

            return (
              num.includes(q) || 
              note.includes(q) || 
              ref.includes(q) || 
              cliName.includes(q) || 
              cliRif.includes(q) ||
              vendName.includes(q)
            )
          })
        }

        return combined
      }

      let matchedIds = null

      if (busqueda && busqueda.trim()) {
        const q = busqueda.trim()
        const promises = []

        // 1. Search by dispatch/quotation numbers
        const numberClean = q.replace(/^(des|cot|dsp|odc)[.\s-]*/i, '').replace(/^0+/g, '')
        const isNum = numberClean && !isNaN(numberClean)
        const numVal = isNum ? parseInt(numberClean, 10) : null

        if (isNum) {
          promises.push(
            supabase.from('notas_despacho').select('id').eq('numero', numVal).then(r => r.data?.map(d => d.id) || [])
          )
          promises.push(
            supabase.from('cotizaciones').select('id').eq('numero', numVal).then(async r => {
              const cotIds = r.data?.map(c => c.id) || []
              if (cotIds.length === 0) return []
              const despRes = await supabase.from('notas_despacho').select('id').in('cotizacion_id', cotIds)
              return despRes.data?.map(d => d.id) || []
            })
          )
        }

        // 2. Search by client via lookup
        const sessionRes = await supabase.auth.getSession()
        const session = sessionRes.data?.session
        if (session?.access_token) {
          promises.push(
            fetch(apiUrl(`/api/clientes?busqueda=${encodeURIComponent(q)}`), {
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
            })
            .then(r => r.ok ? r.json() : [])
            .then(async clients => {
              const clientIds = clients.map(c => c.id).filter(Boolean)
              if (clientIds.length === 0) return []
              const despRes = await supabase.from('notas_despacho')
                .select('id')
                .or(`cliente_id.in.(${clientIds.join(',')}),cliente_factura_id.in.(${clientIds.join(',')})`)
              return despRes.data?.map(d => d.id) || []
            })
            .catch(err => {
              console.error('Error fetching clients in search:', err)
              return []
            })
          )
        }

        // 3. Search by vendor
        promises.push(
          supabase.from('usuarios').select('id').ilike('nombre', `%${q}%`).then(async r => {
            const uIds = r.data?.map(u => u.id) || []
            if (uIds.length === 0) return []
            const despRes = await supabase.from('notas_despacho').select('id').in('vendedor_id', uIds)
            return despRes.data?.map(d => d.id) || []
          })
        )

        // 4. Match in notes/references
        promises.push(
          supabase.from('notas_despacho').select('id').or(`notas.ilike.%${q}%,referencia_pago.ilike.%${q}%`).then(r => r.data?.map(d => d.id) || [])
        )

        const results = await Promise.all(promises)
        matchedIds = [...new Set(results.flat())]
      }

      if (matchedIds !== null && matchedIds.length === 0) {
        return []
      }

      let query = supabase
        .from('notas_despacho')
        .select(`
          id, numero, cotizacion_id, estado, tiene_prestamos,
          total_usd, flete_usd, corte_usd, descuento_total_usd, notas, forma_pago,
          referencia_pago, forma_pago_cliente,
          creado_en, actualizado_en, despachada_en, entregada_en, aprobado_por_nombre,
          cliente_id, cliente_factura_id, vendedor_id, transportista_id,
          items_count:notas_despacho_items(count),
          transportista:transportistas!notas_despacho_transportista_id_fkey(id, nombre, rif, telefono, color, vehiculo, placa_chuto, placa_batea),
          cotizacion:cotizaciones!notas_despacho_cotizacion_id_fkey(id, numero, version),
          seguimiento:seguimiento_operativo(id, prioridad, fijada)
        `)
        .order(estado ? 'actualizado_en' : 'numero', { ascending: false })

      if (matchedIds !== null) {
        query = query.in('id', matchedIds)
      }

      if (esHoy) {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        const end = new Date()
        end.setHours(23, 59, 59, 999)
        query = query.gte('creado_en', start.toISOString()).lte('creado_en', end.toISOString())
      }

      if (matchedIds === null && !esHoy) {
        query = query.limit(200)
      }

      if (estado) query = query.eq('estado', estado)

      // Logística solo ve despachos aprobados (despachada/entregada), NO pendientes
      if (esLogistica && !estado) query = query.in('estado', ['despachada', 'entregada'])

      // Vendedores solo ven sus propios despachos; logística/admin/supervisor ven todos
      if (!veTodos) query = query.eq('vendedor_id', perfil.id)

      const { data, error } = await query
      if (error) throw error
      if (!data?.length) return []

      // Fetch clientes via Worker API (service key, bypasses RLS)
      const clienteIds = [...new Set([
        ...data.map(r => r.cliente_id),
        ...data.map(r => r.cliente_factura_id),
      ].filter(Boolean))]
      // Siempre cargar vendedores por separado (el join puede fallar por RLS)
      const vendedorIds = [...new Set(data.map(r => r.vendedor_id).filter(Boolean))]

      const session = (await supabase.auth.getSession()).data.session

      // 1. Cargar clientes primero
      const clientesData = clienteIds.length
        ? await fetch(apiUrl('/api/clientes/lookup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
            body: JSON.stringify({ ids: clienteIds }),
          }).then(r => r.ok ? r.json() : [])
        : []

      // 2. Extraer todos los IDs de vendedores (de los despachos Y de los clientes)
      const allVendedorIds = [...new Set([
        ...data.map(r => r.vendedor_id),
        ...clientesData.map(c => c.vendedor_id || c.vendedor?.id)
      ].filter(Boolean))]

      // 3. Cargar todos los vendedores necesarios (incluyendo teléfonos)
      const vendedoresRes = allVendedorIds.length
        ? await supabase.from('usuarios').select('id, nombre, color, telefono, rol, markup_pct, comision_pct, comision_pct_cabilla, es_externo').in('id', allVendedorIds)
        : { data: [] }

      const vendedoresMap = Object.fromEntries((vendedoresRes.error ? [] : vendedoresRes.data ?? []).map(v => [v.id, v]))

      // 4. Hidratar el vendedor dentro de cada cliente
      const clientesMap = Object.fromEntries((clientesData ?? []).map(c => {
        const vId = c.vendedor_id || c.vendedor?.id
        if (vId) {
          c.vendedor = vendedoresMap[vId] || c.vendedor
        }
        return [c.id, c]
      }))

      return data.map(r => ({
        ...r,
        cliente: clientesMap[r.cliente_id] ?? null,
        cliente_factura: clientesMap[r.cliente_factura_id] ?? null,
        vendedor: vendedoresMap[r.vendedor_id] ?? r.vendedor ?? null,
      }))
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Crear nota de despacho (via Worker API) ───────────────────────────────
export function useCrearDespacho() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol
  const usuarioNombre = perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ cotizacionId, cotizacionSnapshot = null, notas = null, formaPago = null, transportistaId = null, fleteUsd = 0, corteUsd = 0, referenciaPago = null, formaPagoCliente = null, clienteFacturaId = null, numeroCotizacion, clienteNombre }) => {
      const offline = useAuthStore.getState().offline
      if (offline || String(cotizacionId).startsWith('local_')) {
        const localId = makeLocalId('local_des')
        const nowIso = new Date().toISOString()
        const cotDoc = await getOfflineDocument('cotizacion', cotizacionId)
        const cachedCot = cotDoc ? null : await getIdbValue(`cot_detail_${cotizacionId}`).catch(() => null)
        const cachedItems = cachedCot?.data?.items || cachedCot?.items || []
        const cot = cotizacionSnapshot || cotDoc?.cotizacion || {}
        const documentItems = cotDoc?.items?.length ? cotDoc.items : (cachedItems.length ? cachedItems : (cot.items || []))
        const totalUsd = Number(cot.total_usd || cotDoc?.cotizacion?.total_usd || 0)
        const despachoLocal = {
          id: localId,
          numero: 'LOCAL',
          cotizacion_id: cotizacionId,
          estado: 'pendiente',
          tiene_prestamos: false,
          total_usd: totalUsd + Number(fleteUsd || 0) + Number(corteUsd || 0),
          flete_usd: Number(fleteUsd) || 0,
          corte_usd: Number(corteUsd) || 0,
          descuento_total_usd: 0,
          notas,
          forma_pago: formaPago,
          forma_pago_cliente: formaPagoCliente || formaPago,
          referencia_pago: referenciaPago,
          creado_en: nowIso,
          actualizado_en: nowIso,
          despachada_en: null,
          entregada_en: null,
          aprobado_por_nombre: perfil?.nombre || null,
          cliente_id: cot.cliente_id || cot.cliente?.id || null,
          cliente_factura_id: clienteFacturaId || cot.cliente_id || cot.cliente?.id || null,
          vendedor_id: cot.vendedor_id || perfil?.id,
          transportista_id: transportistaId || null,
          items_count: documentItems.length || cot.items_count || 0,
          cotizacion: cotizacionSnapshot ? { id: cotizacionId, numero: numeroCotizacion, version: cotizacionSnapshot.version } : { id: cotizacionId, numero: numeroCotizacion },
          cliente: cot.cliente || null,
          vendedor: cot.vendedor || perfil || null,
          transportista: null,
          _queued: true,
          _local: true,
        }

        await saveOfflineEntity('despacho', localId, despachoLocal)
        await saveOfflineDocument('despacho', localId, {
          despacho: despachoLocal,
          cotizacion: cot,
          items: documentItems,
          syncStatus: 'pending',
        })
        await enqueue('CREAR_DESPACHO', {
          despachoId: localId,
          cotizacionId,
          notas,
          formaPago,
          transportistaId,
          fleteUsd: Number(fleteUsd) || 0,
          corteUsd: Number(corteUsd) || 0,
          referenciaPago,
          formaPagoCliente,
          clienteFacturaId,
        }, {
          entity: 'despacho',
          localEntityId: localId,
          dependsOn: String(cotizacionId).startsWith('local_') ? [cotizacionId] : [],
          operationLabel: 'Crear despacho',
        })
        return { id: localId, numeroCotizacion, clienteNombre, _queued: true }
      }

      const res = await authFetch('/api/despachos/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cotizacionId, notas: notas || null, formaPago: formaPago || null, transportistaId: transportistaId || null, fleteUsd: Number(fleteUsd) || 0, corteUsd: Number(corteUsd) || 0, referenciaPago: referenciaPago || null, formaPagoCliente: formaPagoCliente || null, clienteFacturaId: clienteFacturaId || null }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear despacho')

      const despachoId = result.id

      return {
        id: despachoId,
        numeroCotizacion: result.numeroCotizacion || numeroCotizacion,
        clienteNombre: result.clienteNombre || clienteNombre
      }
    },
    onSuccess: async (data, variables) => {
      const id = data?.id
      if (!id) return
      if (data?._queued) {
        qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
        qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
        showToast('Despacho guardado localmente. Se sincronizará al reconectar.', 'warning')
        return
      }

      const numCot = data?.numeroCotizacion || variables?.numeroCotizacion
      const cliNom = data?.clienteNombre || variables?.clienteNombre

      const displayNum = numCot ? (typeof numCot === 'number' ? String(numCot).padStart(5, '0') : String(numCot).replace(/^(COT-|DES-)/i, '')) : '—'
      const displayCliente = cliNom || 'cliente'

      let esCod = false
      try {
        const fp = typeof variables?.formaPago === 'string' ? JSON.parse(variables.formaPago) : (variables?.formaPago || [])
        if (Array.isArray(fp)) {
          esCod = fp.some(f => f.metodo === 'Cobro a destino')
        }
      } catch {
        // Mantener esCod en false si la forma de pago no es JSON valido.
      }

      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
      qc.invalidateQueries({ queryKey: ['comisiones'], exact: false })
      qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] })
      showToast('Nota de despacho creada', 'success')
      notifyDespachoCreado(displayNum, displayCliente, usuarioNombre, rol, perfil?.id, esCod)
      sendPushNotification({
        title: `🚚 Orden de Despacho Creada${esCod ? ' [COD]' : ''}`,
        message: `Despacho para cotización #${displayNum} — ${displayCliente}${esCod ? ' (Cobro a Destino)' : ''}`,
        tag: `despacho-${displayNum}`,
        url: '/despachos',
        targetRole: 'supervisor,administracion,jefe',
      })
    },
  })
}

// ─── Actualizar estado de despacho (via Worker API) ────────────────────────
const ESTADO_LABELS = { pendiente: 'Pendiente', despachada: 'Despachada', entregada: 'Entregada', anulada: 'Anulada' }

function assertCanQueueEstadoDespacho({ perfil, nuevoEstado, vendedorId }) {
  const rol = perfil?.rol
  if (nuevoEstado === 'despachada' && !['administracion', 'jefe', 'desarrollador'].includes(rol)) {
    throw new Error('Solo administración, jefe o desarrollador pueden aprobar despachos')
  }
  if (nuevoEstado === 'entregada' && !['logistica', 'jefe', 'desarrollador'].includes(rol)) {
    throw new Error('Solo logística, jefe o desarrollador pueden confirmar entregas')
  }
  if (nuevoEstado === 'anulada') {
    const esVendedorPropio = ['vendedor', 'vendedor_sin_comision'].includes(rol) && perfil?.id === vendedorId
    if (!['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(rol) && !esVendedorPropio) {
      throw new Error('No tiene permiso para anular despachos')
    }
  }
}

export function useActualizarEstadoDespacho() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol
  const usuarioNombre = perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ despachoId, nuevoEstado, numeroCotizacion, clienteNombre, vendedorId = null, motivoDevolucion = null, motivoAnulacion = null, tasaBcv = null }) => {
      const offline = useAuthStore.getState().offline
      if (offline || String(despachoId).startsWith('local_') || String(despachoId).startsWith('mq_')) {
        assertCanQueueEstadoDespacho({ perfil, nuevoEstado, vendedorId })
        const nowIso = new Date().toISOString()
        const patch = {
          estado: nuevoEstado,
          actualizado_en: nowIso,
          ...(nuevoEstado === 'despachada' ? { despachada_en: nowIso } : {}),
          ...(nuevoEstado === 'entregada' ? { entregada_en: nowIso } : {}),
        }
        const currentLocal = await getOfflineEntity('despacho', despachoId)
        const snapshotDespacho = (await getLocalDespachos()).find(d => d.id === despachoId)
        let baseDespacho = currentLocal?.data?.id
          ? currentLocal.data
          : snapshotDespacho

        if (!baseDespacho && String(despachoId).startsWith('mq_')) {
          const pending = await dequeuePending()
          const matchingVr = pending.find(m => m.id === despachoId && m.type === 'VENTA_RAPIDA')
          if (matchingVr) {
            baseDespacho = reconstructDespachoFromVentaRapida(matchingVr, perfil)
          }
        }

        if (!baseDespacho) {
          baseDespacho = { id: despachoId, vendedor_id: vendedorId }
        }

        await saveOfflineEntity('despacho', despachoId, { ...baseDespacho, ...patch })
        await enqueue(`MARCAR_DESPACHO_${String(nuevoEstado).toUpperCase()}`, {
          despachoId,
          nuevoEstado,
          motivoDevolucion,
          motivoAnulacion,
          tasaBcv,
        }, {
          entity: 'despacho',
          localEntityId: despachoId,
          dependsOn: (String(despachoId).startsWith('local_') || String(despachoId).startsWith('mq_')) ? [despachoId] : [],
          operationLabel: `Marcar despacho como ${ESTADO_LABELS[nuevoEstado] || nuevoEstado}`,
        })
        return { nuevoEstado, numeroCotizacion, clienteNombre, vendedorId, _queued: true }
      }

      const body = { despachoId, nuevoEstado }
      if (motivoDevolucion) body.motivo_devolucion = motivoDevolucion
      if (motivoAnulacion) body.motivo_anulacion = motivoAnulacion
      if (tasaBcv && Number(tasaBcv) > 0) body.tasaBcv = Number(tasaBcv)

      const res = await authFetch('/api/despachos/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al cambiar estado del despacho')
      return { nuevoEstado, numeroCotizacion, clienteNombre, vendedorId }
    },
    // Optimistic update: reflect state change immediately in UI
    onMutate: async ({ despachoId, nuevoEstado }) => {
      await qc.cancelQueries({ queryKey: DESPACHOS_KEY })
      const previousQueries = qc.getQueriesData({ queryKey: DESPACHOS_KEY })
      qc.setQueriesData({ queryKey: DESPACHOS_KEY }, (old) => {
        if (!Array.isArray(old)) return old
        return old.map(d => d.id === despachoId ? {
          ...d,
          estado: nuevoEstado,
          ...(nuevoEstado === 'despachada' ? { despachada_en: new Date().toISOString() } : {}),
          ...(nuevoEstado === 'entregada' ? { despachada_en: d.despachada_en || new Date().toISOString(), entregada_en: new Date().toISOString() } : {}),
        } : d)
      })
      return { previousQueries }
    },
    onError: (error, _vars, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([key, data]) => qc.setQueryData(key, data))
      }
      showToast(error.message || 'Error al cambiar estado del despacho', 'error')
    },
    onSuccess: ({ nuevoEstado, numeroCotizacion, clienteNombre, vendedorId }) => {
      showToast(`Despacho marcado como ${ESTADO_LABELS[nuevoEstado] || nuevoEstado}`, 'success')

      const num = numeroCotizacion ? (typeof numeroCotizacion === 'number' ? String(numeroCotizacion).padStart(5, '0') : String(numeroCotizacion).replace(/^(COT-|DES-)/i, '')) : '—'
      const cliente = clienteNombre || 'cliente'

      if (nuevoEstado === 'despachada') {
        notifyDespachoEnRuta(num, cliente, usuarioNombre, rol, perfil?.id, vendedorId)
        sendPushNotification({
          title: '🚚 Despacho en Ruta',
          message: `Despacho #${num} — ${cliente} despachado por ${usuarioNombre}`,
          tag: `despacho-ruta-${num}`,
          url: '/despachos',
          targetRole: 'vendedor,logistica',
        })
      } else if (nuevoEstado === 'entregada') {
        notifyDespachoEntregado(num, cliente, usuarioNombre, rol, perfil?.id, vendedorId)
        sendPushNotification({
          title: '✅ Despacho Entregado',
          message: `Despacho #${num} — ${cliente} entregado (marcado por ${usuarioNombre})`,
          tag: `despacho-entregado-${num}`,
          url: '/despachos',
          targetRole: 'vendedor',
        })
      } else if (nuevoEstado === 'anulada') {
        notifyDespachoCancelado(num, cliente, usuarioNombre, rol, perfil?.id)
        sendPushNotification({
          title: '❌ Despacho Cancelado',
          message: `Despacho #${num} — ${cliente} cancelado por ${usuarioNombre}`,
          tag: `despacho-cancelado-${num}`,
          url: '/despachos',
        })
      }
    },
    onSettled: () => {
      // Pequeño delay para que el Worker haya comprometido el cambio de estado
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
        qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
        qc.invalidateQueries({ queryKey: ['comisiones'], exact: false })
        qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
        qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
        qc.invalidateQueries({ queryKey: ['reporte-ventas'] })
        qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
        qc.invalidateQueries({ queryKey: ['clientes'], exact: false })
        qc.invalidateQueries({ queryKey: ['cuentas-cobrar'], exact: false })
      }, 400)
    },
  })
}

// ─── Editar despacho pendiente (pago, transportista, notas) ─────────────────
export function useEditarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId }) => {
      const offline = useAuthStore.getState().offline
      if (offline || String(despachoId).startsWith('local_')) {
        const patch = {
          forma_pago: formaPago,
          forma_pago_cliente: formaPagoCliente || formaPago,
          referencia_pago: referenciaPago || null,
          transportista_id: transportistaId || null,
          flete_usd: Number(fleteUsd) || 0,
          corte_usd: Number(corteUsd) || 0,
          notas: notas || null,
          cliente_id: clienteId || null,
          actualizado_en: new Date().toISOString(),
        }
        await updateOfflineEntity('despacho', despachoId, patch)
        await enqueue('EDITAR_DESPACHO', {
          despachoId,
          formaPago,
          formaPagoCliente,
          referenciaPago,
          transportistaId,
          fleteUsd,
          corteUsd,
          notas,
          clienteId,
        }, {
          entity: 'despacho',
          localEntityId: despachoId,
          dependsOn: String(despachoId).startsWith('local_') ? [despachoId] : [],
          operationLabel: 'Editar despacho',
        })
        return { _queued: true }
      }

      const res = await authFetch('/api/despachos/editar-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al editar despacho')
      return result
    },
    onSuccess: async () => {
      showToast(useAuthStore.getState().offline ? 'Despacho actualizado localmente' : 'Despacho actualizado', useAuthStore.getState().offline ? 'warning' : 'success')
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['reporte-ventas'] })
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
      qc.invalidateQueries({ queryKey: ['clientes'], exact: false })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'], exact: false })
    },
    onError: (error) => {
      showToast(error.message || 'Error al editar despacho', 'error')
    },
  })
}

// ─── Editar ítems de despacho a profundidad (administracion) ────────────────
export function useEditarItemsDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ despachoId, items, pagos }) => {
      const res = await authFetch('/api/despachos/editar-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId, items, pagos }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al editar ítems del despacho')
      return result
    },
    onSuccess: async () => {
      showToast('Ítems del despacho actualizados con éxito', 'success')
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventario'], exact: false })
      qc.invalidateQueries({ queryKey: ['stock_comprometido'] })
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] })
      qc.invalidateQueries({ queryKey: ['clientes'], exact: false })
      qc.invalidateQueries({ queryKey: ['cuentas-cobrar'], exact: false })
    },
    onError: (error) => {
      showToast(error.message || 'Error al editar ítems', 'error')
    },
  })
}

// ─── Reciclar despacho anulado → cotización borrador (via Worker API) ────────
export function useReciclarDespacho() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (despachoId) => {
      const res = await authFetch('/api/despachos/reciclar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despachoId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al reciclar despacho')
      return result.id
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['despachos'], exact: false })
      qc.invalidateQueries({ queryKey: ['cotizaciones'], exact: false })
    },
  })
}
