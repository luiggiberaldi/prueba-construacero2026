import { dequeuePending } from './mutationQueue'
import { getOfflineDocument } from './offlineDocuments'

/**
 * Calcula las reservas de stock offline acumulando las cantidades
 * de productos comprometidas en VENTA_RAPIDA y CREAR_DESPACHO de la cola.
 * Retorna un mapa de { [producto_id]: cantidad_reservada }
 */
export async function getOfflineStockReservations() {
  const pending = await dequeuePending()
  const reservations = {}

  for (const m of pending) {
    if (m.type === 'VENTA_RAPIDA' && m.payload?.items) {
      for (const it of m.payload.items) {
        const prodId = it.productoId || it.producto_id
        if (prodId) {
          const qty = Number(it.cantidad) || 0
          reservations[prodId] = (reservations[prodId] || 0) + qty
        }
      }
    } else if (m.type === 'CREAR_DESPACHO' && m.localEntityId) {
      try {
        const doc = await getOfflineDocument('despacho', m.localEntityId)
        if (doc?.items) {
          for (const it of doc.items) {
            const prodId = it.productoId || it.producto_id
            if (prodId) {
              const qty = Number(it.cantidad) || 0
              reservations[prodId] = (reservations[prodId] || 0) + qty
            }
          }
        }
      } catch (err) {
        console.error('Error al leer documento de despacho offline para reservas:', err)
      }
    }
  }

  return reservations
}
