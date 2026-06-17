// src/hooks/useCotizaciones.js
// Queries y mutations para cotizaciones + items
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { calcTotales } from '../utils/calcTotales'
import { round2 } from '../utils/dinero'
import {
  notifyCotizacionEnviada,
  notifyCotizacionAnulada,
  notifyCotizacionAceptadaDespacho,
  notifyClienteAjeno,
} from '../services/notificationService'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'
import { STOCK_COMPROMETIDO_KEY } from './useStockComprometido'
import { enqueue } from '../lib/mutationQueue'
import { broadcastEntidad } from '../services/supabase/realtimeBus'

export const COTIZACIONES_KEY = ['cotizaciones']

// ─── Lista de cotizaciones ────────────────────────────────────────────────────
export function useCotizaciones({ estado = '', clienteId = '', veTodos = false } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esAdmin = perfil?.rol === 'administracion'
  // Admin siempre ve todos; supervisor/dev solo si toggle activo
  const esPrivilegiado = esAdmin || esSupervisor || esDesarrollador
  const verTodosEfectivo = esAdmin || ((esSupervisor || esDesarrollador) && veTodos)

  return useQuery({
    queryKey: [...COTIZACIONES_KEY, estado, clienteId, esPrivilegiado, verTodosEfectivo, perfil?.id],
    queryFn: async () => {
      // Query cotizaciones (RLS and our logic will filter by vendedor_id)
      const tabla = 'cotizaciones'
      const selectCols = esPrivilegiado
        ? 'id, numero, version, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, corte_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, creado_en, actualizado_en, enviada_en, notas_cliente, cliente_id, vendedor_id, notas_internas, items_count:cotizacion_items(count), despacho:notas_despacho!notas_despacho_cotizacion_id_fkey(id, estado), seguimiento:seguimiento_operativo(id, prioridad, fijada)'
        : 'id, numero, version, cliente_id, vendedor_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, corte_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, notas_cliente, creado_en, actualizado_en, enviada_en, items_count:cotizacion_items(count), despacho:notas_despacho!notas_despacho_cotizacion_id_fkey(id, estado), seguimiento:seguimiento_operativo(id, prioridad, fijada)'

      let query = supabase
        .from(tabla)
        .select(selectCols)
        .order('actualizado_en', { ascending: false })
        .limit(200)

      if (!verTodosEfectivo) query = query.eq('vendedor_id', perfil.id)
      if (estado) query = query.eq('estado', estado)
      if (clienteId) query = query.eq('cliente_id', clienteId)

      const { data: rows, error } = await query
      if (error) throw error
      if (!rows?.length) return []

      // Fetch clientes via Worker API (service key, bypasses RLS)
      const clienteIds  = [...new Set(rows.map(r => r.cliente_id).filter(Boolean))]
      // Siempre cargar vendedores por separado (el join de Supabase puede fallar por RLS)
      const vendedorIds = [...new Set(rows.map(r => r.vendedor_id).filter(Boolean))]

      const session = (await supabase.auth.getSession()).data.session

      // 1. Cargar clientes primero
      const clientesData = clienteIds.length
        ? await fetch(apiUrl('/api/clientes/lookup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
            body: JSON.stringify({ ids: clienteIds }),
          }).then(r => r.ok ? r.json() : [])
        : []

      // 2. Extraer todos los IDs de vendedores (de las cotizaciones Y de los clientes)
      const allVendedorIds = [...new Set([
        ...rows.map(r => r.vendedor_id),
        ...clientesData.map(c => c.vendedor_id || c.vendedor?.id)
      ].filter(Boolean))]

      // 3. Cargar todos los vendedores necesarios (incluyendo teléfonos)
      const vendedoresRes = allVendedorIds.length
        ? await supabase.from('usuarios').select('id, nombre, color, telefono, rol, markup_pct, es_externo').in('id', allVendedorIds)
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

      return rows.map(r => ({
        ...r,
        cliente: clientesMap[r.cliente_id] ?? r.cliente ?? null,
        vendedor: vendedoresMap[r.vendedor_id] ?? r.vendedor ?? null,
      }))
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Cotización individual con items ─────────────────────────────────────────
export function useCotizacion(id) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')

  return useQuery({
    queryKey: [...COTIZACIONES_KEY, id],
    queryFn: async () => {
      const tabla = 'cotizaciones'

      // Columnas planas (sin FK joins — cliente y vendedor se buscan por separado)
      const selectFields = 'id, numero, version, cotizacion_raiz_id, cliente_id, vendedor_id, transportista_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, corte_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, notas_cliente, creado_en, actualizado_en, enviada_en, exportada_en'

      const [cotRes, itemsRes] = await Promise.all([
        supabase
          .from(tabla)
          .select(selectFields)
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('cotizacion_items')
          .select('producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden, origen')
          .eq('cotizacion_id', id)
          .order('orden'),
      ])
      if (cotRes.error) throw cotRes.error
      if (itemsRes.error) throw itemsRes.error

      let cot = cotRes.data

      // Fetch cliente y vendedor por separado (evita problemas de RLS con joins)
      const session = (await supabase.auth.getSession()).data.session
      const lookups = await Promise.all([
        cot.cliente_id
          ? fetch(apiUrl('/api/clientes/lookup'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
              body: JSON.stringify({ ids: [cot.cliente_id] }),
            }).then(r => r.ok ? r.json() : [])
          : [],
        cot.vendedor_id
          ? supabase.from('usuarios').select('id, nombre, color, telefono, rol, markup_pct, es_externo').eq('id', cot.vendedor_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const clienteRaw = lookups[0]?.[0] ?? null
      let vendedorCliente = clienteRaw?.vendedor || null

      // Si el cliente tiene vendedor pero no tiene teléfono/rol en el objeto anidado, lo hidratamos
      const vId = clienteRaw?.vendedor_id || clienteRaw?.vendedor?.id
      if (vId && !vendedorCliente?.telefono) {
        const { data: vData } = await supabase
          .from('usuarios')
          .select('id, nombre, color, telefono, rol')
          .eq('id', vId)
          .maybeSingle()
        if (vData) vendedorCliente = vData
      }

      cot = {
        ...cot,
        cliente: clienteRaw ? { ...clienteRaw, vendedor: vendedorCliente } : null,
        vendedor: lookups[1]?.data ?? null,
      }

      return { 
        ...cot, 
        items: (itemsRes.data ?? []).map(it => ({
          ...it,
          origen: it.producto_id ? (it.origen || 'inventario') : 'externo'
        }))
      }
    },
    enabled: !!id && !!perfil,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  })
}

// ─── Guardar borrador (crear o actualizar) ────────────────────────────────────
// Si cotizacionId es null → crea nueva. Si tiene ID → actualiza.
// Si no hay red → encola en IDB y devuelve un ID local temporal (local_XXXX)
export function useGuardarBorrador() {
  const qc = useQueryClient()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))

  return useMutation({
    mutationFn: async ({ cotizacionId = null, campos, items }) => {
      // Calcular totales
      const { subtotal, descuentoUsd, totalUsd } = calcTotales(
        items, campos.descuentoGlobalPct, campos.costoEnvioUsd, campos.corteUsd
      )

      const headerData = {
        cliente_id:           campos.clienteId,
        transportista_id:     campos.transportistaId || null,
        vendedor_id:          campos.vendedorId || perfil.id,
        notas_cliente:        campos.notasCliente?.trim()  || null,
        notas_internas:       campos.notasInternas?.trim() || null,
        descuento_global_pct: 0,
        costo_envio_usd:      round2(Number(campos.costoEnvioUsd)      || 0),
        corte_usd:            round2(Number(campos.corteUsd)           || 0),
        subtotal_usd:         subtotal,
        descuento_usd:        0,
        total_usd:            totalUsd,
        canal_venta:          campos.canal_venta || 'interno',
      }

      const itemRows = items.map((it, idx) => ({
        producto_id:     it.productoId || null,
        codigo_snap:     it.codigoSnap || null,
        nombre_snap:     it.nombreSnap,
        unidad_snap:     it.unidadSnap  || 'und',
        cantidad:        it.cantidad,
        precio_unit_usd: it.precioUnitUsd,
        descuento_pct:   0,
        total_linea_usd: round2(it.cantidad * it.precioUnitUsd),
        orden:           idx,
        origen:          it.productoId ? (it.origen || 'inventario') : 'externo', // Fix: usar productoId (camelCase)
      }))

      const payload = { cotizacionId, headerData, items: itemRows }

      // ─── Intento online ────────────────────────────────────────────────────
      let res, data
      try {
        if (!navigator.onLine) throw new TypeError('Offline')

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)

        const headers = await getAuthHeaders()
        console.log('payload cotizacion (hook)', payload)
        res = await fetch(apiUrl('/api/cotizaciones/guardar'), {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        })
        clearTimeout(timeoutId)

        // Si el servidor está caído (500+), tratamos como si estuviera offline
        if (res.status >= 500) throw new Error('Error de servidor (5xx)')

        data = await res.json()
        if (!res.ok) {
          console.error('[BACKEND ERROR 400]:', data)
        }
      } catch (err) {
        // Error de red, timeout, o server caído → encolar en IDB con ID local temporal
        const localId = cotizacionId ?? `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        await enqueue('GUARDAR_COTIZACION', { ...payload, cotizacionId: localId })

        if ('serviceWorker' in navigator) {
          // No usamos await aquí porque en desarrollo (localhost) si el SW no está activo,
          // la promesa de .ready nunca se resuelve y cuelga la UI para siempre.
          navigator.serviceWorker.ready.then(reg => {
            if ('SyncManager' in window) {
              reg.sync.register('sync-mutations').catch(() => {})
            }
          }).catch(() => {})
        }

        return { _queued: true, localId }
      }

      if (!res.ok) throw new Error(data.error || 'Error al guardar cotización')
      return { id: data.id }
    },
    onSuccess: async ({ id, _queued, localId }) => {
      if (_queued) {
        showToast(
          '📋 Sin conexión — cotización guardada localmente. Se sincronizará al reconectar.',
          'warning',
          7000,
        )
        qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
        return localId
      }
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
      return id
    },
  })
}

// ─── Enviar cotización (via Worker API) ──────────────────────────────────────
export function useEnviarCotizacion() {
  const qc = useQueryClient()
  const rol = useAuthStore.getState().perfil?.rol

  return useMutation({
    mutationFn: async ({ cotizacionId, tasaBcv }) => {
      if (!navigator.onLine || String(cotizacionId).startsWith('local_')) {
        throw new Error('Estás offline. La cotización se guardó como borrador local y podrás enviarla al recuperar la conexión.')
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      const headers = await getAuthHeaders()

      try {
        const res = await fetch(apiUrl('/api/cotizaciones/enviar'), {
          method: 'POST',
          headers,
          body: JSON.stringify({ cotizacionId, tasaBcv: Number(tasaBcv) }),
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || 'Error al enviar cotización')
      } catch (e) {
        clearTimeout(timeoutId)
        if (e.name === 'AbortError' || e.message === 'Failed to fetch') {
          throw new Error('Sin conexión. La cotización se guardó localmente, reintenta enviarla luego.')
        }
        throw e
      }

      // Obtener número, vendedor y total para notificación
      const { data: cot } = await supabase
        .from('cotizaciones')
        .select('numero, version, total_usd, cliente_id, vendedor_id, vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombre)')
        .eq('id', cotizacionId)
        .maybeSingle()

      // Cliente via Worker API (bypasses RLS)
      let clienteNombre = 'cliente'
      let clienteVendedorId = null
      let clienteVendedorNombre = null
      if (cot?.cliente_id) {
        const session2 = (await supabase.auth.getSession()).data.session
        try {
          const cRes = await fetch(apiUrl('/api/clientes/lookup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session2?.access_token}` },
            body: JSON.stringify({ ids: [cot.cliente_id] }),
          })
          if (cRes.ok) {
            const cData = await cRes.json()
            clienteNombre = cData?.[0]?.nombre ?? 'cliente'
            clienteVendedorId = cData?.[0]?.vendedor_id ?? null
            clienteVendedorNombre = cData?.[0]?.vendedor?.nombre ?? null
          }
        } catch { /* fallback */ }
      }

      const numero        = cot?.numero ? String(cot.numero).padStart(5, '0') : '—'
      const vendedorNombre = cot?.vendedor?.nombre ?? 'vendedor'
      const totalUsd      = Number(cot?.total_usd || 0).toFixed(2)
      const esClienteAjeno = clienteVendedorId && cot?.vendedor_id && clienteVendedorId !== cot.vendedor_id
      return { numero, clienteNombre, vendedorNombre, totalUsd, esClienteAjeno, clienteVendedorNombre }
    },
    onSuccess: async ({ numero, clienteNombre, vendedorNombre, totalUsd, esClienteAjeno, clienteVendedorNombre }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      // Guard: si no hay numero, algo falló (evitar Ghost Toast)
      if (!numero || numero === '—') return
      showToast(`Cotización #${numero} enviada`, 'success')
      if (esClienteAjeno) {
        notifyClienteAjeno({ tipo: 'cotizacion', numero, vendedorNombre, clienteNombre, vendedorDueño: clienteVendedorNombre || 'otro vendedor', currentRole: rol })
        sendPushNotification({
          title: 'Cotización con cliente ajeno',
          message: `${vendedorNombre} cotizó con "${clienteNombre}" (de ${clienteVendedorNombre || 'otro vendedor'}) — COT-${numero}`,
          tag: `cliente-ajeno-cot-${numero}`,
          url: '/cotizaciones',
          targetRole: 'supervisor',
        })
      }
    },
  })
}

// ─── Anular cotización ────────────────────────────────────────────────────────
export function useAnularCotizacion() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol
  const usuarioNombre = perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ id, numero }) => {
      const { error } = await supabase
        .from('cotizaciones')
        .update({ estado: 'anulada' })
        .eq('id', id)
        .select('id')
        .single()
      if (error) throw new Error('No se pudo cancelar la cotización. Puede que ya haya sido procesada.')
      return { numero }
    },
    onSuccess: async ({ numero }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      showToast(`Cotización #${numero} anulada`, 'warning')
      notifyCotizacionAnulada(numero, usuarioNombre, rol)
      // Push al otro rol
      sendPushNotification({
        title: '🚫 Cotización Anulada',
        message: `Cotización #${numero} fue anulada`,
        tag: `cotizacion-anulada-${numero}`,
        url: '/cotizaciones',
        targetRole: rol === 'supervisor' ? 'vendedor' : 'supervisor',
      })
    },
  })
}

// ─── Actualizar estado (supervisor) ──────────────────────────────────────────
export function useActualizarEstado() {
  const qc = useQueryClient()
  const usuarioNombre = useAuthStore.getState().perfil?.nombre ?? 'usuario'

  return useMutation({
    mutationFn: async ({ id, estado, numero, clienteNombre, totalUsd, vendedorId }) => {
      const { error } = await supabase
        .from('cotizaciones')
        .update({ estado })
        .eq('id', id)
        .select('id')
        .single()
      if (error) throw new Error(`No se pudo actualizar el estado a ${estado}. Puede que la cotización haya cambiado.`)
      return { estado, numero, clienteNombre, totalUsd, vendedorId }
    },
    onSuccess: async ({ estado, numero, clienteNombre, totalUsd, vendedorId }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      // Guard: si no hay numero, algo falló (evitar Ghost Toast)
      if (!numero) return
      showToast(`Cotización #${numero} → ${estado}`, 'success')

      if (estado === 'aceptada' && clienteNombre) {
        notifyCotizacionAceptadaDespacho(numero, clienteNombre, usuarioNombre, 'supervisor')
        sendPushNotification({
          title: '✅ Cotización Aceptada — Lista para Despacho',
          message: `COT-${numero} — ${clienteNombre} lista para crear nota de despacho`,
          tag: `cot-aceptada-despacho-${numero}`,
          url: '/cotizaciones',
          targetRole: 'supervisor',
        })
      }
    },
  })
}

// ─── Crear nueva versión de cotización enviada (via Worker API) ────────────────
// 1. Crea un borrador nuevo con version = anterior + 1
// 2. Copia todos los items de la versión anterior
// 3. Devuelve el ID del nuevo borrador
export function useCrearVersion() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (cotizacionId) => {
      const headers = await getAuthHeaders()

      const res = await fetch(apiUrl('/api/cotizaciones/crear-version'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ cotizacionId }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear versión')

      return result.id
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
    },
  })
}

// ─── Reabrir cotización para edición (estado → borrador, sin crear versión) ──
export function useReabrirCotizacion() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (cotizacionId) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/cotizaciones/reabrir'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ cotizacionId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al reabrir cotización')
      return result
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
    },
  })
}

// ─── Reciclar cotización (supervisor: rechazada/anulada/vencida → borrador) ──
export function useReciclarCotizacion() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ cotizacionId, vendedorDestinoId }) => {
      const headers = await getAuthHeaders()

      const res = await fetch(apiUrl('/api/cotizaciones/reciclar'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ cotizacionId, vendedorDestinoId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al reciclar cotización')
      }
      return await res.json()
    },
    onSuccess: async ({ id, numero, vendedorDestino }) => {
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      broadcastEntidad('cotizaciones')
      // Guard: si no hay ID, algo falló (evitar Ghost Toast)
      if (!id) return
      const numPad = String(numero).padStart(5, '0')
      showToast(`Cotización reciclada → COT-${numPad} asignada a ${vendedorDestino}`, 'success')
    },
  })
}
