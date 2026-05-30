// src/lib/offlineDocuments.js
// Snapshots completos para imprimir/descargar documentos sin consultar red.
import { del, get, set } from 'idb-keyval'

const DOCUMENT_PREFIX = 'offline_document_'

function documentKey(type, entityId) {
  return `${DOCUMENT_PREFIX}${type}_${entityId}`
}

export async function saveOfflineDocument(type, entityId, snapshot) {
  const row = {
    ...snapshot,
    type,
    entityId,
    syncStatus: snapshot.syncStatus || 'pending',
    updatedAt: Date.now(),
  }
  await set(documentKey(type, entityId), row)
  return row
}

export async function getOfflineDocument(type, entityId) {
  return (await get(documentKey(type, entityId))) || null
}

export async function removeOfflineDocument(type, entityId) {
  await del(documentKey(type, entityId))
}
