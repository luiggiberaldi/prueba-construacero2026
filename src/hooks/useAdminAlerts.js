// src/hooks/useAdminAlerts.js
import { useState, useEffect, useCallback } from 'react'
import {
  getUnreadCount,
  getNotifications,
  markAllRead,
  markRead,
  clearNotifications,
} from '../services/notificationService'
import { updateNotificationBadge, initFaviconBadge, clearNotificationBadge } from '../services/faviconBadge'

let _faviconInitialized = false
let _flashInterval = null

function startTitleFlashing(title) {
  if (typeof window === 'undefined') return
  stopTitleFlashing()
  const originalTitle = document.title
  let isAlt = false
  _flashInterval = setInterval(() => {
    document.title = isAlt ? originalTitle : `🚨 ${title} 🚨`
    isAlt = !isAlt
  }, 1000)

  const stopOnFocus = () => {
    stopTitleFlashing()
    window.removeEventListener('focus', stopOnFocus)
    window.removeEventListener('click', stopOnFocus)
  }
  window.addEventListener('focus', stopOnFocus)
  window.addEventListener('click', stopOnFocus)
}

function stopTitleFlashing() {
  if (typeof window === 'undefined') return
  if (_flashInterval) {
    clearInterval(_flashInterval)
    _flashInterval = null
  }
  document.title = "Listo POS"
}

export function useAdminAlerts() {
  const [unreadCount, setUnreadCount] = useState(() => getUnreadCount())
  const [notifications, setNotifications] = useState(() => getNotifications())

  const refresh = useCallback(() => {
    const count = getUnreadCount()
    setUnreadCount(count)
    setNotifications(getNotifications())
    updateNotificationBadge(count)
  }, [])

  const handleNewNotification = useCallback((e) => {
    refresh()
    const notif = e.detail
    if (!notif) return

    // Solo disparar alerta nativa si el documento está en segundo plano o no tiene foco
    const background = typeof document !== 'undefined' && (document.visibilityState === 'hidden' || !document.hasFocus())

    if (background && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      const options = {
        body: notif.body || 'Tienes una nueva alerta en Listo POS.',
        icon: '/logo.png',
        requireInteraction: ['despacho_creado', 'despacho_cancelado', 'stock_critico'].includes(notif.type),
        tag: notif.id,
      }

      const nativeNotif = new Notification(notif.title, options)
      nativeNotif.onclick = () => {
        window.focus()
        const navTarget = {
          'stock_bajo': '/inventario?filtro=stock_bajo',
          'stock_critico': '/inventario?filtro=stock_bajo',
          'stock_reabastecido': '/inventario',
          'cotizacion_aceptada': '/cotizaciones',
          'cotizacion_aceptada_despacho': '/cotizaciones',
          'despacho_creado': '/despachos',
          'despacho_en_ruta': '/despachos',
          'despacho_entregado': '/despachos',
          'despacho_cancelado': '/despachos',
          'despacho_pendiente_mucho': '/despachos',
          'cotizacion_anulada': '/cotizaciones',
          'compromiso_alto': '/inventario',
          'despacho_cliente_ajeno': '/despachos',
          'facturacion_cliente_ajeno': '/despachos',
        }[notif.type]
        if (navTarget) {
          window.dispatchEvent(new CustomEvent('navigate-to', { detail: navTarget }))
        }
      }
    }

    // Parpadeo del título
    if (background) {
      startTitleFlashing(notif.title)
    }
  }, [refresh])

  useEffect(() => {
    // Inicializar favicon badge una sola vez
    if (!_faviconInitialized) {
      initFaviconBadge()
      _faviconInitialized = true
    }
    // Sincronizar badge al montar
    updateNotificationBadge(getUnreadCount())

    // Solicitar permiso de notificaciones nativas en PC
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission()
      }
    }

    window.addEventListener('listopos-notification', handleNewNotification)
    window.addEventListener('listopos-notification-read', refresh)
    return () => {
      window.removeEventListener('listopos-notification', handleNewNotification)
      window.removeEventListener('listopos-notification-read', refresh)
    }
  }, [handleNewNotification, refresh])

  return {
    unreadCount,
    notifications,
    markAllRead: () => { markAllRead(); refresh() },
    markRead: (id) => { markRead(id); refresh() },
    clearAll: () => { clearNotifications(); clearNotificationBadge(); refresh() },
  }
}
