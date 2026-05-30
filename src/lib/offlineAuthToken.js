// src/lib/offlineAuthToken.js
// Token compartido con el service worker para sincronizar mutaciones en background.
import { del, set } from 'idb-keyval'

export const OFFLINE_AUTH_TOKEN_KEY = 'offline_auth_access_token'

export async function saveOfflineAuthToken(session) {
  const token = session?.access_token
  if (!token) return
  await set(OFFLINE_AUTH_TOKEN_KEY, {
    accessToken: token,
    expiresAt: session.expires_at || null,
    savedAt: Date.now(),
  })
}

export async function clearOfflineAuthToken() {
  await del(OFFLINE_AUTH_TOKEN_KEY)
}
