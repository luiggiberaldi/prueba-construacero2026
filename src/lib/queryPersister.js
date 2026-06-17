// src/lib/queryPersister.js
// Persists React Query cache to IndexedDB via idb-keyval
import { get, set, del } from 'idb-keyval'

const IDB_KEY = 'LISTOPOS_RQ_CACHE'

export const indexedDbPersister = {
  persistClient: async (client) => { await set(IDB_KEY, client) },
  restoreClient: async () => await get(IDB_KEY),
  removeClient: async () => { await del(IDB_KEY) },
}

// Build hash — invalidates persisted cache on each deploy
export const CACHE_BUSTER = __APP_VERSION__
