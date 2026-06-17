// src/lib/mutationQueue.js
// Cola de mutaciones offline persistida en IndexedDB (idb-keyval)
// Cada item: { id, type, payload, createdAt, attempts, status, error?, dependsOn?, localEntityId? }
//
// REGLA DE INVENTARIO: El stock NO se descuenta localmente cuando la venta está en cola.
// El usuario ve un warning claro. El stock se descuenta al sincronizar con el worker.
import { get, set, del, keys } from 'idb-keyval'

const QUEUE_PREFIX = 'mq_'
const MAX_ATTEMPTS = 3

// ─── Encolar una nueva mutación ───────────────────────────────────────────────
export async function enqueue(type, payload, meta = {}) {
  // Para evitar duplicación de cotizaciones/clientes en la cola al guardar varias veces offline
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = await Promise.all(allKeys.map((k) => get(k)))
  const pending = items.filter((i) => i?.status === 'pending')

  let existingItem = null

  if (type === 'GUARDAR_COTIZACION' && payload.cotizacionId) {
    existingItem = pending.find(
      (i) => i.type === 'GUARDAR_COTIZACION' && i.payload?.cotizacionId === payload.cotizacionId
    )
  } else if (type === 'CREAR_CLIENTE' && payload.localId) {
    existingItem = pending.find(
      (i) => i.type === 'CREAR_CLIENTE' && i.payload?.localId === payload.localId
    )
  } else if (type?.startsWith('MARCAR_DESPACHO_') && payload.despachoId) {
    existingItem = pending.find(
      (i) => i.type?.startsWith('MARCAR_DESPACHO_') && i.payload?.despachoId === payload.despachoId
    )
  }

  const activeOperatorId = meta.operatorId || (typeof localStorage !== 'undefined' ? localStorage.getItem('listo_active_operator_id') : null);

  if (existingItem) {
    const updatedItem = {
      ...existingItem,
      payload,
      ...meta,
      snapshotAt: Date.now(),
      error: null,
      attempts: 0,
      status: 'pending',
      operatorId: activeOperatorId || existingItem.operatorId || null,
    }
    await set(existingItem.id, updatedItem)
    return existingItem.id
  }

  const id = `${QUEUE_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const item = {
    id,
    type,
    payload,
    createdAt: Date.now(),
    snapshotAt: Date.now(), // para detectar conflictos en Fase 3
    attempts: 0,
    status: 'pending', // 'pending' | 'failed'
    error: null,
    dependsOn: meta.dependsOn || [],
    localEntityId: meta.localEntityId || null,
    entity: meta.entity || null,
    operationLabel: meta.operationLabel || null,
    operatorId: activeOperatorId || null,
  }
  await set(id, item)
  return id
}

// ─── Leer todos los items pendientes ordenados por fecha ──────────────────────
export async function dequeuePending() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = await Promise.all(allKeys.map((k) => get(k)))
  return items
    .filter((i) => i?.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)
}

// ─── Leer todos los items fallidos ────────────────────────────────────────────
export async function dequeueFailed() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = await Promise.all(allKeys.map((k) => get(k)))
  return items.filter((i) => i?.status === 'failed').sort((a, b) => a.createdAt - b.createdAt)
}

// ─── Contar todos los items (pending + failed) ────────────────────────────────
export async function countAll() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  return allKeys.length
}

// ─── Marcar como procesado (eliminar) ─────────────────────────────────────────
export async function markDone(id) {
  await del(id)
}

// ─── Marcar como fallido ──────────────────────────────────────────────────────
export async function markFailed(id, errorMsg) {
  const item = await get(id)
  if (!item) return
  const attempts = (item.attempts || 0) + 1
  await set(id, {
    ...item,
    status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    error: errorMsg,
    attempts,
    lastAttemptAt: Date.now(),
  })
}

// ─── Reintentar un item fallido (volver a pending) ────────────────────────────
export async function retryFailed(id) {
  const item = await get(id)
  if (!item) return
  await set(id, { ...item, status: 'pending', attempts: 0, error: null, lastAttemptAt: null })
}

export async function replaceQueuedDespachoId(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = await Promise.all(allKeys.map(async (key) => ({ key, item: await get(key) })))

  await Promise.all(items.map(async ({ key, item }) => {
    if (!item?.payload || item.payload.despachoId !== oldId) return
    await set(key, {
      ...item,
      payload: { ...item.payload, despachoId: newId },
      dependsOn: (item.dependsOn || []).map(dep => dep === oldId ? newId : dep),
    })
  }))
}

// ─── Eliminar un item fallido (descartar) ─────────────────────────────────────
export async function discardFailed(id) {
  await del(id)
}

// ─── Procesador principal: llamado por SW (Background Sync) o por online event ─
// Recibe una función `dispatch(item, idMap) => Promise<any>` que hace el fetch real
export async function processQueue(dispatch) {
  const pending = await dequeuePending()
  const results = { done: 0, failed: 0 }
  const idMap = {}
  const remaining = [...pending]
  const blocked = new Set()

  while (remaining.length > 0) {
    const index = remaining.findIndex((item) => {
      const deps = item.dependsOn || []
      return deps.every((dep) => {
        const isLocal = String(dep).startsWith('local_') || String(dep).startsWith('mq_')
        return idMap[dep] || !isLocal
      })
    })

    if (index === -1) {
      break
    }

    const [item] = remaining.splice(index, 1)
    try {
      const result = await dispatch(item, idMap)
      if (item.type === 'CREAR_CLIENTE' && item.payload?.localId && result?.id) {
        idMap[item.payload.localId] = result.id
      }
      if (item.type === 'CREAR_TRANSPORTISTA' && item.payload?.localId && result?.id) {
        idMap[item.payload.localId] = result.id
      }
      if (item.type === 'VENTA_RAPIDA' && result?.id) {
        idMap[item.id] = result.id
        await replaceQueuedDespachoId(item.id, result.id)
      }
      if (item.localEntityId && result?.id) {
        idMap[item.localEntityId] = result.id
        await replaceQueuedDespachoId(item.localEntityId, result.id)
      }
      if (result?.idMap && typeof result.idMap === 'object') {
        Object.assign(idMap, result.idMap)
      }
      await markDone(item.id)
      results.done++
    } catch (err) {
      blocked.add(item.localEntityId)
      await markFailed(item.id, err?.message || 'Error desconocido')
      results.failed++
    }
  }

  for (const item of remaining) {
    const deps = item.dependsOn || []
    if (deps.some((dep) => blocked.has(dep))) {
      await markFailed(item.id, 'No se pudo sincronizar porque falló una operación previa.')
      results.failed++
    }
  }

  return results
}
