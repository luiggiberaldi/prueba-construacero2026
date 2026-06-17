// src/services/supabase/realtimeBus.js
// Bus de realtime por "broadcast" — sincronización instantánea entre los
// dispositivos de una misma cuenta. El canal (por cuenta) lo crea y asigna
// useRealtimeSync; las mutations llaman a broadcastEntidad() en su onSuccess.
//
// — NO crea su propio canal (evita duplicados)
// — Un solo evento genérico ('entity-updated') con la entidad en el payload
export const REALTIME_EV = 'entity-updated'

let _ch = null

/** Registrar el canal de broadcast (llamado por useRealtimeSync al crearlo) */
export function setRealtimeChannel(ch) {
  _ch = ch
}

/**
 * Emitir un cambio de entidad(es) a todos los dispositivos de la cuenta.
 * @param {string|string[]} entidad - 'inventario'|'despachos'|'cotizaciones'|
 *   'clientes'|'comisiones'|'config'|'cuentas' (o un array de ellas)
 */
export function broadcastEntidad(entidad) {
  if (!_ch || _ch.state !== 'joined') return
  const entidades = Array.isArray(entidad) ? entidad : [entidad]
  _ch.send({
    type:    'broadcast',
    event:   REALTIME_EV,
    payload: { entidades, ts: Date.now() },
  }).catch(() => {}) // fail silently — postgres_changes / visibilitychange sirven de fallback
}

/** Compat: las mutations de inventario ya existentes siguen funcionando */
export function broadcastInventarioUpdate() {
  broadcastEntidad('inventario')
}
