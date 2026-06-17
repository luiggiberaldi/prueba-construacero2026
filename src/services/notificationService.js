// src/services/notificationService.js
// Sistema de alertas internas — Construacero Carabobo
// Notificaciones separadas por usuario (localStorage per-user)
// Realtime broadcast via Supabase para entrega cross-device

import supabase from './supabase/client'

const NOTIF_KEY_BASE = 'listopos_notifications_v2'
const MAX_NOTIFS = 100

// ─── Sonido de notificación (dual: normal + urgente) ─────────────────────────
let _notifAudio = null
let _notifUrgentAudio = null

// Tipos que usan sonido urgente (triple beep agudo)
const URGENT_TYPES = new Set([
  'stock_critico',
  'despacho_creado',
  'compromiso_alto',
  'despacho_en_ruta',
  'seguimiento_urgente',
])

function playNotifSound(type) {
  try {
    if (URGENT_TYPES.has(type)) {
      if (!_notifUrgentAudio) {
        _notifUrgentAudio = new Audio('/notif-urgent.wav')
        _notifUrgentAudio.volume = 0.85
      }
      _notifUrgentAudio.currentTime = 0
      _notifUrgentAudio.play().catch(() => {})
    } else {
      if (!_notifAudio) {
        _notifAudio = new Audio('/notif-sound.wav')
        _notifAudio.volume = 0.7
      }
      _notifAudio.currentTime = 0
      _notifAudio.play().catch(() => {})
    }
  } catch { /* silencioso */ }
}

// ─── userId global para la sesión ─────────────────────────────────────────────
let _currentUserId = null
export function setNotificationUserId(userId) { _currentUserId = userId }

function getKey() {
  if (!_currentUserId) return null
  return `${NOTIF_KEY_BASE}_${_currentUserId}`
}

export const NOTIF_TYPES = {
  STOCK_BAJO:                    'stock_bajo',
  STOCK_CRITICO:                 'stock_critico',
  STOCK_REABASTECIDO:            'stock_reabastecido',
  COTIZACION_ENVIADA:            'cotizacion_enviada',
  COTIZACION_ACEPTADA:           'cotizacion_aceptada',
  COTIZACION_ACEPTADA_DESPACHO:  'cotizacion_aceptada_despacho',
  DESPACHO_CREADO:               'despacho_creado',
  DESPACHO_EN_RUTA:              'despacho_en_ruta',
  DESPACHO_ENTREGADO:            'despacho_entregado',
  DESPACHO_CANCELADO:            'despacho_cancelado',
  DESPACHO_PENDIENTE_MUCHO:      'despacho_pendiente_mucho',
  COTIZACION_ANULADA:            'cotizacion_anulada',
  COTIZACION_SIN_RESPUESTA:      'cotizacion_sin_respuesta',
  COMPROMISO_ALTO:               'compromiso_alto',
  CLIENTE_AJENO:                 'cliente_ajeno',
  DESPACHO_CLIENTE_AJENO:        'despacho_cliente_ajeno',
  FACTURACION_CLIENTE_AJENO:     'facturacion_cliente_ajeno',
  SEGUIMIENTO_CREADO:            'seguimiento_creado',
  SEGUIMIENTO_URGENTE:           'seguimiento_urgente',
}

// ─── Clasificación STATE vs EVENT para deduplicación inteligente ──────────────
// STATE: solo 1 activa por tipo (REPLACE — la nueva reemplaza la anterior)
// EVENT: pueden ser múltiples, pero no en ráfaga (debounce 30s)
const STATE_TYPES = new Set([
  'stock_bajo',
  'stock_critico',
  'compromiso_alto',
  'stock_reabastecido',
])

const EVENT_DEBOUNCE_MS = 30_000 // 30 segundos

// Qué roles ven cada tipo de notificación localmente en la campanita
// Cada tipo mapea a una lista de roles permitidos para recibirla localmente y por realtime.
const NOTIF_TARGET_ROLE = {
  [NOTIF_TYPES.STOCK_BAJO]:                   ['supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.STOCK_CRITICO]:                ['supervisor', 'jefe', 'desarrollador', 'administracion'],
  [NOTIF_TYPES.STOCK_REABASTECIDO]:           ['supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.COTIZACION_ACEPTADA]:          ['vendedor'],
  [NOTIF_TYPES.COTIZACION_ACEPTADA_DESPACHO]: ['supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.DESPACHO_CREADO]:              ['supervisor', 'administracion', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.DESPACHO_EN_RUTA]:             ['logistica', 'vendedor'],
  [NOTIF_TYPES.DESPACHO_ENTREGADO]:           ['vendedor', 'supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.DESPACHO_CANCELADO]:           ['supervisor', 'administracion', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.DESPACHO_PENDIENTE_MUCHO]:     ['supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.COTIZACION_ANULADA]:           ['vendedor', 'supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.COMPROMISO_ALTO]:              ['supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.CLIENTE_AJENO]:                ['supervisor', 'jefe', 'desarrollador'],
  [NOTIF_TYPES.DESPACHO_CLIENTE_AJENO]:       ['supervisor', 'jefe', 'desarrollador', 'administracion'],
  [NOTIF_TYPES.FACTURACION_CLIENTE_AJENO]:    ['supervisor', 'jefe', 'desarrollador', 'administracion'],
  [NOTIF_TYPES.SEGUIMIENTO_CREADO]:           ['supervisor', 'jefe', 'desarrollador', 'administracion'],
  [NOTIF_TYPES.SEGUIMIENTO_URGENTE]:          ['supervisor', 'jefe', 'desarrollador', 'administracion'],
}

function readNotifs() {
  const key = getKey()
  if (!key) return []
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch { return [] }
}

function saveNotifs(notifs) {
  const key = getKey()
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(notifs))
  } catch { /* silencioso */ }
}

/**
 * Crea una notificación solo si el rol actual debe verla.
 * @param {string} type - Tipo de notificación (NOTIF_TYPES)
 * @param {string} title
 * @param {string|null} body
 * @param {object|null} meta
 * @param {string|null} currentRole - Rol del usuario actual ('supervisor'|'vendedor'|'administracion'|'logistica')
 */
export function createNotification(type, title, body, meta = null, currentRole = null) {
  // Desactivar notificaciones redundantes de cotización
  if (type === NOTIF_TYPES.COTIZACION_ENVIADA || type === NOTIF_TYPES.COTIZACION_SIN_RESPUESTA) {
    return null
  }

  const targetRoles = NOTIF_TARGET_ROLE[type]

  if (targetRoles) {
    // Verificar si el rol actual está incluido en el target
    const hasRole = currentRole && targetRoles.includes(currentRole)

    if (currentRole) {
      // Re-transmitir realtime broadcast a todos los roles target (sin filtrar por currentRole,
      // para que a los otros con el mismo rol sí les llegue en tiempo real)
      _broadcastNotification({ type, title, body, meta, targetRole: targetRoles.join(',') })
    }

    // Evitar auto-alertas si esta acción fue originada por mí mismo
    const esMiPropiaAccion = meta && meta.creadorId && meta.creadorId === _currentUserId

    if (hasRole && !esMiPropiaAccion) {
      return _insertLocalNotification(type, title, body, meta)
    }
    return null
  }

  // Comportamiento por defecto
  if (currentRole) {
    const otherRole = currentRole === 'supervisor' ? 'vendedor' : 'supervisor'
    _broadcastNotification({ type, title, body, meta, targetRole: otherRole })
  }

  const esMiPropiaAccion = meta && meta.creadorId && meta.creadorId === _currentUserId
  if (!esMiPropiaAccion) {
    return _insertLocalNotification(type, title, body, meta)
  }
  return null
}

// Crea la notificación localmente (localStorage + evento + sonido)
// Aplica deduplicación inteligente: REPLACE para STATE, debounce para EVENT
function _insertLocalNotification(type, title, body, meta) {
  let notifs = readNotifs()

  if (STATE_TYPES.has(type)) {
    // STATE: eliminar todas las previas del mismo tipo (solo queda la nueva)
    notifs = notifs.filter(n => n.type !== type)
  } else {
    // EVENT: ignorar si ya existe una exactamente idéntica (tipo, título y cuerpo) en los últimos 30s
    // Esto evita duplicar clicks accidentales pero permite acumular eventos distintos (ej. dos despachos diferentes)
    const reciente = notifs.find(n => 
      n.type === type && 
      n.title === title && 
      n.body === body && 
      (Date.now() - n.ts) < EVENT_DEBOUNCE_MS
    )
    if (reciente) return null
  }

  const notif = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    type,
    title,
    body,
    read: false,
    meta,
  }

  notifs = [notif, ...notifs]
  if (notifs.length > MAX_NOTIFS) notifs.length = MAX_NOTIFS
  saveNotifs(notifs)

  window.dispatchEvent(new CustomEvent('listopos-notification', { detail: notif }))
  playNotifSound(type)
  return notif
}

// ─── Supabase Realtime broadcast ──────────────────────────────────────────────
let _realtimeChannel = null

function _broadcastNotification({ type, title, body, meta, targetRole }) {
  try {
    if (!_realtimeChannel || _realtimeChannel.state !== 'joined') return // no hay canal activo o no está unido, se pierde (push lo cubre)
    _realtimeChannel.send({
      type: 'broadcast',
      event: 'new_notification',
      payload: { type, title, body, meta, targetRole, ts: Date.now() },
    })
  } catch { /* silencioso */ }
}

/**
 * Inicia la escucha de notificaciones Realtime.
 * Llamar una vez al montar AppLayout con el rol actual.
 */
export function startRealtimeNotifications(currentRole) {
  stopRealtimeNotifications()

  _realtimeChannel = supabase
    .channel('notificaciones')
    .on('broadcast', { event: 'new_notification' }, ({ payload }) => {
      if (!payload) return
      // targetRole puede contener múltiples roles separados por comas
      if (payload.targetRole) {
        const roles = payload.targetRole.split(',')
        if (!roles.includes(currentRole)) return
      }

      // Ignorar si el broadcast fue originado por mí mismo
      if (payload.meta && payload.meta.creadorId && payload.meta.creadorId === _currentUserId) return

      // Si el rol es 'vendedor' y la notif tiene vendedorId, solo mostrarla al dueño del despacho
      if (currentRole === 'vendedor' && payload.meta?.vendedorId && payload.meta.vendedorId !== _currentUserId) return

      _insertLocalNotification(payload.type, payload.title, payload.body, payload.meta)
    })
    .subscribe()
}

export function stopRealtimeNotifications() {
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel)
    _realtimeChannel = null
  }
}

export function getNotifications() {
  return readNotifs()
}

export function getUnreadCount() {
  return readNotifs().filter(n => !n.read).length
}

export function markAllRead() {
  saveNotifs(readNotifs().map(n => ({ ...n, read: true })))
  window.dispatchEvent(new CustomEvent('listopos-notification-read'))
}

export function markRead(id) {
  saveNotifs(readNotifs().map(n => n.id === id ? { ...n, read: true } : n))
  window.dispatchEvent(new CustomEvent('listopos-notification-read'))
}

export function clearNotifications() {
  saveNotifs([])
  window.dispatchEvent(new CustomEvent('listopos-notification-read'))
}

// ─── Helpers de alto nivel ─────────────────────────────────────────────────────

const STOCK_BAJO_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6 horas

/**
 * Alerta de stock bajo (0 < stock <= stock_minimo). Cooldown 6h.
 * La deduplicación de almacenamiento la maneja _insertLocalNotification (REPLACE por STATE_TYPE).
 */
export function notifyStockBajo(productos, currentRole = null) {
  // Solo productos con stock bajo (NO crítico, es decir stock > 0)
  const bajos = productos.filter(p => p.stock_minimo > 0 && p.stock_actual > 0 && p.stock_actual <= p.stock_minimo)
  if (!bajos.length) return

  // Cooldown de 6h si misma cantidad (evita re-procesar innecesariamente)
  const existing = readNotifs().find(n => n.type === NOTIF_TYPES.STOCK_BAJO)
  if (existing) {
    const mismaCantidad = existing.meta?.total === bajos.length
    const reciente = Date.now() - existing.ts < STOCK_BAJO_COOLDOWN_MS
    if (mismaCantidad && reciente) return
  }

  createNotification(
    NOTIF_TYPES.STOCK_BAJO,
    bajos.length === 1
      ? `Stock Bajo: ${bajos[0].nombre}`
      : `${bajos.length} productos con stock bajo`,
    bajos.length === 1
      ? `Solo ${bajos[0].stock_actual} ${bajos[0].unidad || 'und'} (mín: ${bajos[0].stock_minimo})`
      : null,
    {
      productos: bajos.slice(0, 10).map(p => ({
        nombre: p.nombre,
        stock: p.stock_actual,
        unidad: p.unidad || 'und',
        minimo: p.stock_minimo,
      })),
      total: bajos.length,
    },
    currentRole,
  )
}

/**
 * Alerta de stock CRÍTICO (stock = 0). Sin cooldown — siempre urgente.
 */
export function notifyStockCritico(productos, currentRole = null) {
  const criticos = productos.filter(p => p.stock_actual <= 0)
  if (!criticos.length) return

  createNotification(
    NOTIF_TYPES.STOCK_CRITICO,
    criticos.length === 1
      ? `⚠️ Stock Agotado: ${criticos[0].nombre}`
      : `⚠️ ${criticos.length} productos SIN STOCK`,
    criticos.length === 1
      ? `${criticos[0].nombre} tiene 0 ${criticos[0].unidad || 'und'} disponibles`
      : criticos.slice(0, 5).map(p => p.nombre).join(', '),
    {
      productos: criticos.slice(0, 10).map(p => ({
        nombre: p.nombre,
        stock: p.stock_actual,
        unidad: p.unidad || 'und',
      })),
      total: criticos.length,
    },
    currentRole,
  )
}

/**
 * Notifica que un producto volvió a nivel normal después de un reabastecimiento.
 */
export function notifyStockReabastecido(producto, currentRole = null) {
  createNotification(
    NOTIF_TYPES.STOCK_REABASTECIDO,
    `Stock Reabastecido: ${producto.nombre}`,
    `Ahora tiene ${producto.stock_actual} ${producto.unidad || 'und'} (mín: ${producto.stock_minimo})`,
    { producto_id: producto.id, nombre: producto.nombre, stock: producto.stock_actual },
    currentRole,
  )
}

export function notifyCotizacionEnviada(numero, clienteNombre, vendedorNombre, totalUsd, currentRole = null) {
  const total = totalUsd ? ` — $${Number(totalUsd).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
  const de = vendedorNombre ? ` de ${vendedorNombre}` : ''
  createNotification(
    NOTIF_TYPES.COTIZACION_ENVIADA,
    `COT-${numero} pendiente de aprobación`,
    `${clienteNombre}${total}${de}`,
    null,
    currentRole,
  )
}

export function notifyDespachoCreado(numero, clienteNombre, usuarioNombre, currentRole = null, creadorId = null, esCod = false) {
  const isCodText = esCod ? ' [COBRO A DESTINO]' : ''
  createNotification(
    NOTIF_TYPES.DESPACHO_CREADO,
    `Orden de Despacho Creada${isCodText}`,
    `Despacho para cotización ${numero && numero !== '—' ? '#' + numero : 'borrador'} — ${clienteNombre} (por ${usuarioNombre})${esCod ? ' · Modalidad Cobro a Destino (COD) 🚚' : ''}`,
    { creadorNombre: usuarioNombre, creadorId, esCod },
    currentRole,
  )
}

export function notifyCotizacionAnulada(numero, usuarioNombre, currentRole = null) {
  createNotification(
    NOTIF_TYPES.COTIZACION_ANULADA,
    'Cotización Anulada',
    `Cotización ${numero && numero !== '—' ? '#' + numero : 'borrador'} fue anulada por ${usuarioNombre}`,
    null,
    currentRole,
  )
}

/**
 * Cotización aceptada y lista para crear despacho.
 */
export function notifyCotizacionAceptadaDespacho(numero, clienteNombre, usuarioNombre, currentRole = null) {
  createNotification(
    NOTIF_TYPES.COTIZACION_ACEPTADA_DESPACHO,
    `COT-${numero} aceptada — lista para despacho`,
    `${clienteNombre} — Aprobada por ${usuarioNombre}`,
    { numero, clienteNombre },
    currentRole,
  )
}

/**
 * Despacho marcado como "despachada" (en ruta al cliente).
 */
export function notifyDespachoEnRuta(numero, clienteNombre, usuarioNombre, currentRole = null, creadorId = null, vendedorId = null) {
  createNotification(
    NOTIF_TYPES.DESPACHO_EN_RUTA,
    `Despacho ${numero && numero !== '—' ? '#' + numero : ''} en ruta`,
    `Pedido de ${clienteNombre} despachado por ${usuarioNombre}`,
    { numero, clienteNombre, creadorNombre: usuarioNombre, creadorId, vendedorId },
    currentRole,
  )
}

/**
 * Despacho marcado como "entregada".
 */
export function notifyDespachoEntregado(numero, clienteNombre, usuarioNombre, currentRole = null, creadorId = null, vendedorId = null) {
  createNotification(
    NOTIF_TYPES.DESPACHO_ENTREGADO,
    `Despacho ${numero && numero !== '—' ? '#' + numero : ''} entregado`,
    `Pedido de ${clienteNombre} marcado como entregado por ${usuarioNombre}`,
    { numero, clienteNombre, creadorNombre: usuarioNombre, creadorId, vendedorId },
    currentRole,
  )
}

/**
 * Despacho cancelado — stock restaurado.
 */
export function notifyDespachoCancelado(numero, clienteNombre, usuarioNombre, currentRole = null, creadorId = null) {
  createNotification(
    NOTIF_TYPES.DESPACHO_CANCELADO,
    `Despacho ${numero && numero !== '—' ? '#' + numero : ''} cancelado`,
    `${clienteNombre} — Cancelado por ${usuarioNombre}`,
    { numero, clienteNombre, creadorNombre: usuarioNombre, creadorId },
    currentRole,
  )
}

/**
 * Despacho pendiente demasiado tiempo sin ser despachado.
 */
export function notifyDespachoPendienteMucho(numero, clienteNombre, horas) {
  const key = `despacho_pendiente_${numero}`
  if (hasCooldown(key)) return
  setCooldown(key)
  createNotification(
    NOTIF_TYPES.DESPACHO_PENDIENTE_MUCHO,
    `Despacho #${numero} pendiente hace ${horas}h`,
    `${clienteNombre} — Aún no ha sido despachado`,
    { numero, clienteNombre, horas },
  )
}

/**
 * Stock comprometido supera el 70% del stock real.
 */
export function notifyCompromisoAlto(productos) {
  const key = 'compromiso_alto'
  if (hasCooldown(key)) return
  setCooldown(key)
  createNotification(
    NOTIF_TYPES.COMPROMISO_ALTO,
    productos.length === 1
      ? `Compromiso alto: ${productos[0].nombre}`
      : `${productos.length} productos con compromiso alto`,
    productos.length === 1
      ? `${productos[0].comprometido} de ${productos[0].stock_actual} ${productos[0].unidad || 'und'} comprometidos (${productos[0].porcentaje}%)`
      : productos.slice(0, 5).map(p => `${p.nombre} (${p.porcentaje}%)`).join(', '),
    {
      productos: productos.slice(0, 10).map(p => ({
        nombre: p.nombre,
        stock_actual: p.stock_actual,
        comprometido: p.comprometido,
        porcentaje: p.porcentaje,
        unidad: p.unidad || 'und',
      })),
      total: productos.length,
    },
  )
}

// ─── Recordatorios proactivos (cooldown system) ──────────────────────────────

const RECORDATORIO_COOLDOWN_KEY = 'listopos_recordatorios_v1'
const RECORDATORIO_COOLDOWN_MS  = 1 * 60 * 60 * 1000 // 1 hora por cotización
const DESPACHO_PENDIENTE_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 horas por despacho
const COMPROMISO_ALTO_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6 horas

function readCooldowns() {
  try { return JSON.parse(localStorage.getItem(RECORDATORIO_COOLDOWN_KEY) || '{}') }
  catch { return {} }
}

function saveCooldowns(map) {
  try { localStorage.setItem(RECORDATORIO_COOLDOWN_KEY, JSON.stringify(map)) }
  catch { /* silencioso */ }
}

export function hasCooldown(key) {
  const map = readCooldowns()
  const ts  = map[key]
  if (!ts) return false
  // Usar cooldown apropiado según el tipo de key
  let cooldownMs = RECORDATORIO_COOLDOWN_MS
  if (key.startsWith('despacho_pendiente_')) cooldownMs = DESPACHO_PENDIENTE_COOLDOWN_MS
  if (key === 'compromiso_alto') cooldownMs = COMPROMISO_ALTO_COOLDOWN_MS
  return (Date.now() - ts < cooldownMs)
}

export function setCooldown(key) {
  const map = readCooldowns()
  map[key] = Date.now()
  // Limpiar entradas viejas (> 7 días) para no inflar localStorage
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const k of Object.keys(map)) {
    if (map[k] < cutoff) delete map[k]
  }
  saveCooldowns(map)
}

/**
 * Llamar cuando se detecta una cotización enviada sin respuesta.
 * Genera una notificación máximo una vez cada 1 h por cotización.
 */
export function notifyCotizacionSinRespuesta(numero, clienteNombre, tiempoTexto, vendedorNombre) {
  const key = `sin_respuesta_${numero}`
  if (hasCooldown(key)) return
  setCooldown(key)
  const de = vendedorNombre ? ` — ${vendedorNombre}` : ''
  createNotification(
    NOTIF_TYPES.COTIZACION_SIN_RESPUESTA,
    `COT-${numero} sin respuesta (${tiempoTexto})`,
    `${clienteNombre}${de} — Enviada hace ${tiempoTexto} sin confirmar`,
    { numero, clienteNombre, tiempoTexto },
  )
}

export function notifyClienteAjeno({ tipo, numero, vendedorNombre, clienteNombre, vendedorDueño, currentRole = null }) {
  const tipoLabel = tipo === 'venta_rapida' ? 'Venta rápida' : 'Cotización'
  createNotification(
    NOTIF_TYPES.CLIENTE_AJENO,
    `${tipoLabel} con cliente ajeno`,
    `${vendedorNombre} usó el cliente "${clienteNombre}" (de ${vendedorDueño}) en ${tipoLabel} #${numero}`,
    { tipo, numero, vendedorNombre, clienteNombre, vendedorDueño },
    currentRole,
  )
}

/**
 * Alerta cuando se crea un despacho desde venta rápida con un cliente ajeno.
 */
export function notifyDespachoClienteAjeno({ numero, vendedorNombre, clienteNombre, vendedorDueño, currentRole = null }) {
  createNotification(
    NOTIF_TYPES.DESPACHO_CLIENTE_AJENO,
    'Despacho con cliente ajeno',
    `${vendedorNombre} creó despacho VR-${numero} con "${clienteNombre}" (de ${vendedorDueño})`,
    { numero, vendedorNombre, clienteNombre, vendedorDueño },
    currentRole,
  )
}

/**
 * Alerta cuando se asigna un cliente de facturación diferente al de la cotización.
 */
export function notifyFacturacionClienteAjeno({ numero, clienteCotizacion, clienteFactura, currentRole = null }) {
  createNotification(
    NOTIF_TYPES.FACTURACION_CLIENTE_AJENO,
    'Facturación a cliente diferente',
    `Despacho COT-${numero}: factura a "${clienteFactura}" en lugar de "${clienteCotizacion}"`,
    { numero, clienteCotizacion, clienteFactura },
    currentRole,
  )
}

/**
 * Notificación en tiempo real para nuevo seguimiento o incidencia
 */
export function notifySeguimientoCreado(entrada, usuarioNombre, currentRole = null) {
  const esUrgente = entrada.prioridad === 'urgente'
  const limitedText = entrada.contenido && entrada.contenido.length > 80
    ? entrada.contenido.substring(0, 80) + '...'
    : entrada.contenido || ''

  createNotification(
    esUrgente ? NOTIF_TYPES.SEGUIMIENTO_URGENTE : NOTIF_TYPES.SEGUIMIENTO_CREADO,
    esUrgente ? '🚨 Incidencia URGENTE Reportada' : '💬 Nuevo Seguimiento Registrado',
    `Vendedor ${usuarioNombre} reportó: "${limitedText}"`,
    {
      creadorId: entrada.usuario_id || null,
      creadorNombre: usuarioNombre,
      seguimientoId: entrada.id,
      tipo: entrada.tipo,
      prioridad: entrada.prioridad
    },
    currentRole
  )
}
