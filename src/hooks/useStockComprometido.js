// src/hooks/useStockComprometido.js
// Hook para consultar stock comprometido en cotizaciones activas (Desactivado temporalmente)
import { useQuery } from '@tanstack/react-query'
import useAuthStore from '../store/useAuthStore'

export const STOCK_COMPROMETIDO_KEY = ['stock_comprometido']

// Totales por producto (Desactivado - Retorna mapa vacío para ocultar en UI)
export function useStockComprometido() {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: STOCK_COMPROMETIDO_KEY,
    queryFn: async () => {
      // Retorna mapa vacío para desactivar stock comprometido visualmente
      return {}
    },
    enabled: !!perfil,
    staleTime: Infinity, // No requiere refrescarse
  })
}

// Detalle por producto (Desactivado - Retorna array vacío para ocultar en UI)
export function useStockComprometidoDetalle(productoId) {
  const { perfil } = useAuthStore()

  return useQuery({
    queryKey: [...STOCK_COMPROMETIDO_KEY, 'detalle', productoId],
    queryFn: async () => {
      // Usar productoId para evitar alertas de variable sin usar de ESLint
      if (!productoId) return []
      return []
    },
    enabled: !!perfil && !!productoId,
    staleTime: Infinity,
  })
}
