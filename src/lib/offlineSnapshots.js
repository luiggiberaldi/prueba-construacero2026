// src/lib/offlineSnapshots.js
// Utilidades para descargar y consultar snapshots locales en IndexedDB para la operación offline
import { get, set } from 'idb-keyval'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'

const SNAPSHOT_CLIENTES_KEY = 'offline_snapshot_clientes'
const SNAPSHOT_PRODUCTOS_KEY = 'offline_snapshot_inventario'
const SNAPSHOT_TRANSPORTISTAS_KEY = 'offline_snapshot_transportistas'
const SNAPSHOT_COTIZACIONES_KEY = 'offline_snapshot_cotizaciones'
const SNAPSHOT_USUARIOS_KEY = 'offline_snapshot_usuarios'
const SNAPSHOT_DESPACHOS_KEY = 'offline_snapshot_despachos'
const OFFLINE_CREATED_CLIENTS_KEY = 'offline_created_clients'
const ACTIVE_OPERATOR_KEY = 'listo_active_operator_id'
const ACTIVE_ACCOUNT_KEY = 'listo_active_account_id'

function readStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function getSnapshotScope(perfil = null) {
  const accountId = perfil?.cuenta_id || readStorage(ACTIVE_ACCOUNT_KEY)
  const operatorId = perfil?.id || readStorage(ACTIVE_OPERATOR_KEY)
  if (!accountId || !operatorId) return null
  return `${accountId}_${operatorId}`
}

function scopedKey(baseKey, perfil = null) {
  const scope = getSnapshotScope(perfil)
  return scope ? `${baseKey}_${scope}` : baseKey
}

async function setSnapshot(baseKey, value, perfil = null) {
  await set(scopedKey(baseKey, perfil), value)
}

async function getSnapshot(baseKey, perfil = null) {
  const scope = getSnapshotScope(perfil)
  const cached = await get(scopedKey(baseKey, perfil))
  if (cached || scope) return cached
  return get(baseKey)
}

function chunkArray(items, size = 50) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/**
 * Descarga masiva de datos desde el backend para almacenarlos en IndexedDB
 * @param {Object} perfil Perfil del operador autenticado
 */
export async function descargarSnapshotsLocales(perfil) {
  if (!perfil) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return

  console.log('[SNAPSHOT] Iniciando descarga de snapshots para uso offline...')

  try {
    // 1. Clientes
    const cliRes = await fetch(apiUrl('/api/clientes'), {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
    if (cliRes.ok) {
      const clientes = await cliRes.json()
      await setSnapshot(SNAPSHOT_CLIENTES_KEY, { data: clientes || [], timestamp: Date.now() }, perfil)
      console.log(`[SNAPSHOT] ${clientes.length} clientes guardados localmente.`)
    }

    // 2. Transportistas
    const { data: transportistas, error: tErr } = await supabase
      .from('transportistas')
      .select('id, nombre, rif, telefono, color, vehiculo, placa_chuto, placa_batea, activo, zona_cobertura, capacidad')
      .order('nombre')
    if (!tErr && transportistas) {
      await setSnapshot(SNAPSHOT_TRANSPORTISTAS_KEY, { data: transportistas || [], timestamp: Date.now() }, perfil)
      console.log(`[SNAPSHOT] ${transportistas.length} transportistas guardados localmente.`)
    }

    // 3. Productos (Inventario)
    const esPrivilegiado = ['supervisor', 'jefe', 'administracion', 'desarrollador'].includes(perfil.rol)
    let productos = []
    
    if (esPrivilegiado) {
      // Supervisor: tabla directa (con costo_usd)
      const { data, error } = await supabase
        .from('productos')
        .select('id, codigo, nombre, descripcion, categoria, unidad, precio_usd, precio_2, precio_3, precio1_porcentaje, precio2_porcentaje, precio3_porcentaje, costo_usd, stock_actual, stock_minimo, activo, imagen_url, creado_en, actualizado_en')
        .eq('activo', true)
        .order('nombre', { ascending: true })
        .limit(10000)
      if (!error && data) productos = data
    } else {
      // Vendedor: RPC segura (sin costo_usd)
      const { data, error } = await supabase.rpc('obtener_productos_vendedor', {
        p_busqueda: '',
        p_categoria: '',
        p_categoria_grupo: false,
        p_limit: 10000,
        p_offset: 0
      })
      if (!error && data) {
        productos = data.map(({ total_count, ...rest }) => rest)
      }
    }

    if (productos.length > 0) {
      await setSnapshot(SNAPSHOT_PRODUCTOS_KEY, { data: productos, timestamp: Date.now() }, perfil)
      console.log(`[SNAPSHOT] ${productos.length} productos guardados localmente.`)
    }

    // 4. Cotizaciones
    const selectCols = esPrivilegiado
      ? 'id, numero, version, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, corte_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, creado_en, actualizado_en, enviada_en, notas_cliente, cliente_id, vendedor_id, notas_internas, items_count:cotizacion_items(count)'
      : 'id, numero, version, cliente_id, vendedor_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, corte_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, notas_cliente, creado_en, actualizado_en, enviada_en, items_count:cotizacion_items(count)'

    let cotQuery = supabase
      .from('cotizaciones')
      .select(selectCols)
      .order('actualizado_en', { ascending: false })
      .limit(200)

    if (!esPrivilegiado) {
      cotQuery = cotQuery.eq('vendedor_id', perfil.id)
    }

    const { data: cotizaciones, error: cotErr } = await cotQuery
    if (!cotErr && cotizaciones) {
      await setSnapshot(SNAPSHOT_COTIZACIONES_KEY, { data: cotizaciones || [], timestamp: Date.now() }, perfil)
      const cotizacionIds = cotizaciones.map(c => c.id).filter(Boolean)
      const itemsByCotizacion = {}
      for (const ids of chunkArray(cotizacionIds)) {
        const { data: cotItems } = await supabase
          .from('cotizacion_items')
          .select('cotizacion_id, producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden, origen')
          .in('cotizacion_id', ids)
          .order('orden', { ascending: true })
        for (const item of cotItems || []) {
          if (!itemsByCotizacion[item.cotizacion_id]) itemsByCotizacion[item.cotizacion_id] = []
          itemsByCotizacion[item.cotizacion_id].push({
            ...item,
            origen: item.producto_id ? (item.origen || 'inventario') : 'externo',
          })
        }
      }
      await Promise.all(cotizaciones.map(cot => set(`cot_detail_${cot.id}`, {
        data: { ...cot, items: itemsByCotizacion[cot.id] || [] },
        timestamp: Date.now(),
      })))
      console.log(`[SNAPSHOT] ${cotizaciones.length} cotizaciones guardadas localmente.`)
    }

    // 5. Usuarios
    const { data: usuarios, error: uErr } = await supabase
      .from('usuarios')
      .select('id, nombre, color, telefono, rol, markup_pct, es_externo')
      .eq('activo', true)
    if (!uErr && usuarios) {
      await setSnapshot(SNAPSHOT_USUARIOS_KEY, { data: usuarios || [], timestamp: Date.now() }, perfil)
      console.log(`[SNAPSHOT] ${usuarios.length} usuarios guardados localmente.`)
    }

    // 6. Despachos
    let despQuery = supabase
      .from('notas_despacho')
      .select(`
        id, numero, cotizacion_id, estado, tiene_prestamos,
        total_usd, flete_usd, corte_usd, descuento_total_usd, notas, forma_pago,
        referencia_pago, forma_pago_cliente,
        creado_en, actualizado_en, despachada_en, entregada_en, aprobado_por_nombre,
        cliente_id, cliente_factura_id, vendedor_id, transportista_id,
        items_count:notas_despacho_items(count)
      `)
      .order('numero', { ascending: false })
      .limit(200)

    if (!esPrivilegiado) {
      despQuery = despQuery.eq('vendedor_id', perfil.id)
    }

    const { data: despachos, error: despErr } = await despQuery
    if (!despErr && despachos) {
      await setSnapshot(SNAPSHOT_DESPACHOS_KEY, { data: despachos || [], timestamp: Date.now() }, perfil)
      const despachoIds = despachos.map(d => d.id).filter(Boolean)
      const itemsByDespacho = {}
      for (const ids of chunkArray(despachoIds)) {
        const { data: despItems } = await supabase
          .from('notas_despacho_items')
          .select('despacho_id, id, producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, orden, es_prestamo')
          .in('despacho_id', ids)
          .order('orden', { ascending: true })
        for (const item of despItems || []) {
          if (!itemsByDespacho[item.despacho_id]) itemsByDespacho[item.despacho_id] = []
          itemsByDespacho[item.despacho_id].push(item)
        }
      }
      await Promise.all(despachos.map(despacho => set(`desp_detail_${despacho.id}`, {
        data: { ...despacho, items: itemsByDespacho[despacho.id] || [] },
        timestamp: Date.now(),
      })))
      console.log(`[SNAPSHOT] ${despachos.length} despachos guardados localmente.`)
    }
  } catch (err) {
    console.error('[SNAPSHOT] Error descargando snapshots:', err)
  }
}

/**
 * Obtiene el snapshot local de cotizaciones
 */
export async function getLocalCotizaciones() {
  const cached = await getSnapshot(SNAPSHOT_COTIZACIONES_KEY)
  return cached?.data || []
}

/**
 * Obtiene el snapshot local de usuarios
 */
export async function getLocalUsuarios() {
  const cached = await getSnapshot(SNAPSHOT_USUARIOS_KEY)
  return cached?.data || []
}

/**
 * Obtiene el snapshot local de despachos
 */
export async function getLocalDespachos() {
  const cached = await getSnapshot(SNAPSHOT_DESPACHOS_KEY)
  return cached?.data || []
}



/**
 * Obtiene el snapshot local de clientes.
 * Combina los clientes descargados con los creados offline que están en la cola.
 */
export async function getLocalClientes() {
  const cached = await getSnapshot(SNAPSHOT_CLIENTES_KEY)
  const base = cached?.data || []

  // Leer clientes creados offline pendientes de sincronizar
  const allKeys = (await get(scopedKey(OFFLINE_CREATED_CLIENTS_KEY))) || []
  return [...allKeys, ...base]
}

/**
 * Agrega un cliente creado offline temporalmente al snapshot local
 */
export async function saveLocalClienteOffline(cliente) {
  try {
    const key = scopedKey(OFFLINE_CREATED_CLIENTS_KEY)
    const list = (await get(key)) || []
    await set(key, [cliente, ...list])
  } catch (err) {
    console.error('[SNAPSHOT] Error guardando cliente offline:', err)
  }
}

/**
 * Limpia los clientes creados offline una vez sincronizados
 */
export async function clearLocalClientesOffline() {
  await set(scopedKey(OFFLINE_CREATED_CLIENTS_KEY), [])
}

/**
 * Obtiene el snapshot local de productos
 */
export async function getLocalProductos() {
  const cached = await getSnapshot(SNAPSHOT_PRODUCTOS_KEY)
  return cached?.data || []
}

/**
 * Obtiene el snapshot local de transportistas
 */
export async function getLocalTransportistas() {
  const cached = await getSnapshot(SNAPSHOT_TRANSPORTISTAS_KEY)
  return cached?.data || []
}
