// src/lib/offlineEntities.js
// Entidades locales materializadas para mostrar y avanzar flujos antes de sincronizar.
import { del, get, keys, set } from 'idb-keyval'

const ENTITY_PREFIX = 'offline_entity_'

function entityKey(entity, id) {
  return `${ENTITY_PREFIX}${entity}_${id}`
}

export function makeLocalId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export async function saveOfflineEntity(entity, id, data, meta = {}) {
  const now = Date.now()
  const row = {
    id,
    entity,
    data,
    syncStatus: meta.syncStatus || 'pending',
    createdAt: meta.createdAt || now,
    updatedAt: now,
    ...meta,
  }
  await set(entityKey(entity, id), row)
  return row
}

export async function updateOfflineEntity(entity, id, patch, meta = {}) {
  const current = await getOfflineEntity(entity, id)
  if (!current) return saveOfflineEntity(entity, id, patch, meta)
  const row = {
    ...current,
    data: { ...current.data, ...patch },
    syncStatus: meta.syncStatus || current.syncStatus || 'pending',
    updatedAt: Date.now(),
    ...meta,
  }
  await set(entityKey(entity, id), row)
  return row
}

export async function getOfflineEntity(entity, id) {
  return (await get(entityKey(entity, id))) || null
}

export async function listOfflineEntities(entity) {
  const prefix = `${ENTITY_PREFIX}${entity}_`
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(prefix))
  const rows = await Promise.all(allKeys.map((k) => get(k)))
  return rows
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
}

export async function removeOfflineEntity(entity, id) {
  await del(entityKey(entity, id))
}
