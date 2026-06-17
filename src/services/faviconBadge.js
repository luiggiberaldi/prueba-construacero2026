// src/services/faviconBadge.js
// Favicon dinámico con badge de notificaciones no leídas
// + Title parpadeante cuando el tab no está enfocado
// + navigator.setAppBadge() para PWA instalada

const ORIGINAL_TITLE = 'Listo POS'
let _originalFavicon = null
let _canvas = null
let _blinkInterval = null
let _isBlinking = false
let _currentCount = 0

// ─── Favicon Badge (Canvas) ─────────────────────────────────────────────────

function getCanvas() {
  if (!_canvas) {
    _canvas = document.createElement('canvas')
    _canvas.width = 64
    _canvas.height = 64
  }
  return _canvas
}

function getOriginalFavicon() {
  if (!_originalFavicon) {
    const link = document.querySelector('link[rel="icon"]')
    _originalFavicon = link?.href || '/favicon.ico'
  }
  return _originalFavicon
}

function drawFaviconBadge(count) {
  const canvas = getCanvas()
  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.crossOrigin = 'anonymous'

  img.onload = () => {
    ctx.clearRect(0, 0, 64, 64)
    ctx.drawImage(img, 0, 0, 64, 64)

    if (count > 0) {
      // Circulo rojo
      const badgeSize = count > 9 ? 32 : 28
      ctx.beginPath()
      ctx.arc(64 - badgeSize / 2, badgeSize / 2, badgeSize / 2, 0, 2 * Math.PI)
      ctx.fillStyle = '#EF4444'
      ctx.fill()

      // Borde blanco
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 3
      ctx.stroke()

      // Número
      ctx.fillStyle = '#FFFFFF'
      ctx.font = `bold ${count > 9 ? 16 : 20}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(count > 99 ? '99+' : String(count), 64 - badgeSize / 2, badgeSize / 2 + 1)
    }

    // Aplicar al favicon
    const link = document.querySelector('link[rel="icon"]') || document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/png'
    link.href = canvas.toDataURL('image/png')
    if (!link.parentNode) document.head.appendChild(link)
  }

  img.onerror = () => {
    // Si no se puede cargar el favicon original, dibujar solo el badge
    if (count > 0) {
      ctx.clearRect(0, 0, 64, 64)
      // Fondo gris
      ctx.fillStyle = '#64748B'
      ctx.fillRect(0, 0, 64, 64)
      // Badge
      ctx.beginPath()
      ctx.arc(48, 16, 14, 0, 2 * Math.PI)
      ctx.fillStyle = '#EF4444'
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(count > 99 ? '99+' : String(count), 48, 17)

      const link = document.querySelector('link[rel="icon"]') || document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/png'
      link.href = canvas.toDataURL('image/png')
      if (!link.parentNode) document.head.appendChild(link)
    }
  }

  img.src = getOriginalFavicon()
}

function resetFavicon() {
  const link = document.querySelector('link[rel="icon"]')
  if (link && _originalFavicon) {
    link.href = _originalFavicon
  }
}

// ─── Title Parpadeante ──────────────────────────────────────────────────────

function startTitleBlink(count) {
  if (_isBlinking) return
  _isBlinking = true

  let showNotif = true
  _blinkInterval = setInterval(() => {
    if (showNotif) {
      document.title = `(${count > 99 ? '99+' : count}) 🔔 Nueva notificación`
    } else {
      document.title = ORIGINAL_TITLE
    }
    showNotif = !showNotif
  }, 1500)
}

function stopTitleBlink() {
  if (_blinkInterval) {
    clearInterval(_blinkInterval)
    _blinkInterval = null
  }
  _isBlinking = false
  document.title = ORIGINAL_TITLE
}

// ─── App Badge (PWA) ────────────────────────────────────────────────────────

function updateAppBadge(count) {
  try {
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        navigator.setAppBadge(count)
      } else {
        navigator.clearAppBadge()
      }
    }
  } catch { /* no soportado o sin permisos */ }
}

// ─── API Pública ────────────────────────────────────────────────────────────

/**
 * Actualiza el badge del favicon, title y app badge.
 * Llamar cada vez que cambia el conteo de no leídas.
 */
export function updateNotificationBadge(unreadCount) {
  _currentCount = unreadCount

  // Favicon badge
  drawFaviconBadge(unreadCount)

  // App badge (PWA)
  updateAppBadge(unreadCount)

  // Title blink (solo si tab no está enfocado Y hay no leídas)
  if (unreadCount > 0 && document.hidden) {
    startTitleBlink(unreadCount)
  } else {
    stopTitleBlink()
  }

  // Title con conteo (sin parpadeo si está enfocado)
  if (!document.hidden) {
    document.title = unreadCount > 0
      ? `(${unreadCount > 99 ? '99+' : unreadCount}) ${ORIGINAL_TITLE}`
      : ORIGINAL_TITLE
  }
}

/**
 * Inicializar listeners de visibilidad.
 * Llamar una vez al montar el layout.
 */
export function initFaviconBadge() {
  // Guardar favicon original
  getOriginalFavicon()

  // Cuando el usuario vuelve al tab, dejar de parpadear
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      stopTitleBlink()
      // Restaurar title con conteo pero sin parpadeo
      document.title = _currentCount > 0
        ? `(${_currentCount > 99 ? '99+' : _currentCount}) ${ORIGINAL_TITLE}`
        : ORIGINAL_TITLE
    } else if (_currentCount > 0) {
      startTitleBlink(_currentCount)
    }
  })
}

/**
 * Limpiar todo (al cerrar sesión).
 */
export function clearNotificationBadge() {
  stopTitleBlink()
  resetFavicon()
  updateAppBadge(0)
  document.title = ORIGINAL_TITLE
  _currentCount = 0
}
