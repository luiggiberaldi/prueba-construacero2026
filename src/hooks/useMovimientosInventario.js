// src/hooks/useMovimientosInventario.js
// Queries y mutations para movimientos de inventario (ingreso/egreso por lotes)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { authFetch } from '../services/authFetch'
import useAuthStore from '../store/useAuthStore'
import { INVENTARIO_KEY } from './useInventario'
import { showToast } from '../components/ui/Toast'
import { notifyStockBajo, notifyStockCritico, notifyStockReabastecido } from '../services/notificationService'
import { formatCorrelativo } from '../utils/motivosTipo'

export const MOVIMIENTOS_KEY = ['inventario_movimientos']
const KARDEX_KEY = ['kardex']

// ─── Listar movimientos (paginado + filtros) ────────────────────────────────
export function useMovimientosInventario({
  page = 0, pageSize = 30, tipo = '',
  busqueda = '', fechaDesde = '', fechaHasta = '',
} = {}) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...MOVIMIENTOS_KEY, page, pageSize, tipo, busqueda, fechaDesde, fechaHasta],
    queryFn: async () => {
      let query = supabase
        .from('inventario_movimientos')
        .select('*', { count: 'exact' })
        .order('creado_en', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (tipo) query = query.eq('tipo', tipo)
      if (busqueda.trim()) {
        query = query.or(`producto_nombre.ilike.%${busqueda.trim()}%,motivo.ilike.%${busqueda.trim()}%,usuario_nombre.ilike.%${busqueda.trim()}%`)
      }
      if (fechaDesde) query = query.gte('creado_en', fechaDesde + 'T00:00:00')
      if (fechaHasta) query = query.lte('creado_en', fechaHasta + 'T23:59:59')

      const { data, error, count } = await query
      if (error) throw error
      return { movimientos: data ?? [], total: count ?? 0 }
    },
    enabled: ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(perfil?.rol),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
  })
}

// ─── Kardex: movimientos de un producto específico ──────────────────────────
export function useKardex(productoId) {
  const { perfil } = useAuthStore()
  return useQuery({
    queryKey: [...KARDEX_KEY, productoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventario_movimientos')
        .select('*')
        .eq('producto_id', productoId)
        .order('creado_en', { ascending: false })
        .order('numero', { ascending: false })

      if (error) throw error
      return data ?? []
    },
    enabled: !!productoId && ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(perfil?.rol),
    staleTime: 1000 * 60 * 2,
  })
}

// ─── Aplicar movimiento por lotes (via Worker API) ──────────────────────────
export function useAplicarMovimientoLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tipo, motivo, motivo_tipo = 'otro', items }) => {
      const res = await authFetch('/api/inventario/movimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, motivo, motivo_tipo, items }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al aplicar movimiento')
      return result // { lote_id, numero }
    },
    onSuccess: async (data, variables) => {
      await qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      await qc.cancelQueries({ queryKey: MOVIMIENTOS_KEY })
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY, exact: false })
        qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY, exact: false })
        qc.invalidateQueries({ queryKey: KARDEX_KEY, exact: false })
      }, 2500)
      const n = variables.items.length
      const label = variables.tipo === 'ingreso' ? 'ingresados' : 'retirados'
      const corr = data?.numero ? formatCorrelativo(data.numero) : ''
      showToast(`${corr ? corr + ' — ' : ''}${n} producto${n > 1 ? 's' : ''} ${label} exitosamente`, 'success')

      // Verificar estado de stock después del movimiento
      try {
        const ids = variables.items.map(i => i.producto_id)
        const { data: productos } = await supabase
          .from('productos')
          .select('id, nombre, stock_actual, stock_minimo, unidad')
          .in('id', ids)
        if (productos) {
          // Stock crítico (agotado)
          const criticos = productos.filter(p => p.stock_actual <= 0)
          if (criticos.length > 0) notifyStockCritico(criticos, 'supervisor')

          // Stock bajo (> 0 pero <= mínimo)
          const bajos = productos.filter(p =>
            p.stock_minimo > 0 && p.stock_actual > 0 && p.stock_actual <= p.stock_minimo
          )
          if (bajos.length > 0) notifyStockBajo(bajos, 'supervisor')

          // Stock reabastecido (solo en ingresos): producto ahora está por encima del mínimo
          if (variables.tipo === 'ingreso') {
            const reabastecidos = productos.filter(p =>
              p.stock_minimo > 0 && p.stock_actual > p.stock_minimo
            )
            // Solo notificar los que probablemente estaban bajos antes (heurística: el ingreso los subió por encima)
            for (const p of reabastecidos) {
              const item = variables.items.find(i => i.producto_id === p.id)
              if (item) {
                const stockAntes = p.stock_actual - item.cantidad
                if (stockAntes <= p.stock_minimo) {
                  notifyStockReabastecido(p, 'supervisor')
                }
              }
            }
          }
        }
      } catch (_) {}
    },
    onError: (error) => {
      showToast(error.message || 'Error al aplicar movimiento', 'error')
    },
  })
}
