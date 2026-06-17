// src/sw.js — Service Worker
// Precachea el app shell (HTML/JS/CSS) para carga rápida.
// El caché de datos de Supabase fue eliminado para evitar datos stale tras mutaciones.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { get, set, del, keys } from 'idb-keyval'

// ─── Precache: app shell (HTML, JS, CSS, images) ────────────────────────────
// __WB_MANIFEST es reemplazado en build por la lista de assets compilados
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ─── Activar nuevo SW inmediatamente al instalar ────────────────────────────
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  // Limpiar caches viejos (de versiones anteriores del SW) al activar
  event.waitUntil(self.clients.claim())
})
// ═══════════════════════════════════════════════════════════════════════════════
// Background Sync — procesa cola de mutaciones offline al recuperar conexión
// ═══════════════════════════════════════════════════════════════════════════════

const QUEUE_PREFIX = 'mq_'
const MAX_ATTEMPTS = 3
const OFFLINE_AUTH_TOKEN_KEY = 'offline_auth_access_token'

// Procesa todos los items pendientes en la cola IDB
async function processMutationQueueInSW() {
  const allKeys = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX))
  const items = (await Promise.all(allKeys.map((k) => get(k))))
    .filter((i) => i?.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)

  let done = 0
  let failed = 0
  const idMap = {}

  for (const item of items) {
    try {
      // Leer JWT del IndexedDB de Supabase (clave estándar de supabase-js)
      const authRaw = await get(OFFLINE_AUTH_TOKEN_KEY)
      const accessToken = authRaw?.accessToken

      if (!accessToken) {
        // Sin token — posponer, el usuario necesita iniciar sesión
        failed++
        continue
      }

      // Headers base dinámicos con soporte de operador offline
      const requestHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      }
      if (item.operatorId) {
        requestHeaders['X-Operator-Id'] = item.operatorId
      }

      // 1. Mapeo relacional de IDs temporales de clientes
      if (item.type === 'VENTA_RAPIDA' || item.type === 'GUARDAR_COTIZACION') {
        const tempClient = item.payload.clienteId || item.payload.headerData?.cliente_id
        if (tempClient && String(tempClient).startsWith('local_cli_')) {
          const realId = idMap[tempClient]
          if (realId) {
            if (item.payload.clienteId) item.payload.clienteId = realId
            if (item.payload.headerData) item.payload.headerData.cliente_id = realId
          } else {
            throw new Error('El cliente temporal asociado no pudo ser creado en el servidor.')
          }
        }
      }

      // 2. Ejecutar petición real según tipo de item
      if (item.type === 'CREAR_CLIENTE') {
        const res = await fetch('/api/clientes/crear', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(item.payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }

        const result = await res.json().catch(() => ({}))
        if (item.localEntityId && result?.id) {
          idMap[item.localEntityId] = result.id
        }
        if (item.payload.localId && result?.id) {
          idMap[item.payload.localId] = result.id
        }

        await del(item.id)
        done++
      }

      if (item.type === 'ACTUALIZAR_COTIZACION_ESTADO') {
        const cotizacionId = idMap[item.payload.cotizacionId] || item.payload.cotizacionId
        const res = await fetch(`/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
          method: 'PATCH',
          headers: {
            ...requestHeaders,
            apikey: accessToken,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ estado: item.payload.estado }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} (estado cotizacion)`)
        await del(item.id)
        done++
      }

      if (item.type === 'CREAR_DESPACHO') {
        const payload = {
          ...item.payload,
          cotizacionId: idMap[item.payload.cotizacionId] || item.payload.cotizacionId,
        }
        delete payload.despachoId
        const res = await fetch('/api/despachos/crear', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const result = await res.json().catch(() => ({}))
        if (item.localEntityId && result?.id) {
          idMap[item.localEntityId] = result.id
          await del(`offline_entity_despacho_${item.localEntityId}`)
        }
        await del(item.id)
        done++
      }

      if (item.type === 'EDITAR_DESPACHO') {
        const res = await fetch('/api/despachos/editar-pago', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({
            ...item.payload,
            despachoId: idMap[item.payload.despachoId] || item.payload.despachoId,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        await del(item.id)
        done++
      }

      if (item.type?.startsWith('MARCAR_DESPACHO_')) {
        const res = await fetch('/api/despachos/estado', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({
            despachoId: idMap[item.payload.despachoId] || item.payload.despachoId,
            nuevoEstado: item.payload.nuevoEstado,
            motivoDevolucion: item.payload.motivoDevolucion,
            motivoAnulacion: item.payload.motivoAnulacion,
            tasaBcv: item.payload.tasaBcv,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        await del(item.id)
        done++
      }

      if (item.type === 'VENTA_RAPIDA') {
        const res = await fetch('/api/ventas-rapidas/crear', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(item.payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }

        const result = await res.json().catch(() => ({}))
        if (result?.id) {
          idMap[item.id] = result.id
          // Reemplazar ID temporal en las mutaciones siguientes que dependan de esta
          for (const other of items) {
            if (other.payload && other.payload.despachoId === item.id) {
              other.payload.despachoId = result.id
            }
          }
        }

        await del(item.id)
        done++
      }

      if (item.type === 'GUARDAR_COTIZACION') {
        const payload = { ...item.payload }
        if (payload.cotizacionId?.startsWith?.('local_')) payload.cotizacionId = null

        const res = await fetch('/api/cotizaciones/guardar', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }

        const result = await res.json().catch(() => ({}))
        if (item.localEntityId && result?.id) {
          idMap[item.localEntityId] = result.id
          await del(`offline_entity_cotizacion_${item.localEntityId}`)
        }

        if (payload.sendAfterSave && result.id) {
          const sendRes = await fetch('/api/cotizaciones/enviar', {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify({ cotizacionId: result.id, tasaBcv: Number(payload.tasaBcv) || 0 }),
          })
          if (!sendRes.ok) {
            const sendData = await sendRes.json().catch(() => ({}))
            throw new Error(sendData.error || `HTTP ${sendRes.status} (enviar)`)
          }
        }

        await del(item.id)
        done++
      }
    } catch (err) {
      const attempts = (item.attempts || 0) + 1
      await set(item.id, {
        ...item,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: err.message,
        attempts,
        lastAttemptAt: Date.now(),
      })
      failed++
    }
  }

  // Notificar a los clientes abiertos para que refresquen su UI
  if (done > 0) {
    const clients = await self.clients.matchAll({ type: 'window' })
    clients.forEach((client) =>
      client.postMessage({ type: 'MUTATION_QUEUE_SYNCED', done, failed })
    )
  }

  return { done, failed }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-mutations') {
    event.waitUntil(processMutationQueueInSW())
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Push Notification handlers (preserved from original public/sw.js)
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Listo POS', body: event.data.text() }
  }

  const options = {
    body: payload.body || '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: payload.tag || 'listo-notif',
    data: payload.url || '/',
    requireInteraction: payload.requireInteraction || false,
    vibrate: [100, 50, 100],
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si la app ya está abierta y enfocada (en primer plano), silenciar la push
      // para evitar notificaciones duplicadas (el frontend en vivo ya la procesa).
      const hasFocusedClient = clientList.some(client => client.focused)
      if (hasFocusedClient) {
        console.log('[SW] Push ignorada porque la app está activa en primer plano.')
        return
      }
      return self.registration.showNotification(payload.title || 'Listo POS', options)
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
