// src/hooks/useReporteExternos.js
import { useQuery } from '@tanstack/react-query'
import supabase from '../services/supabase/client'

export function useReporteExternos({ from, to, vendedorId }) {
  return useQuery({
    queryKey: ['reporte-externos', from, to, vendedorId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('obtener_reporte_articulos_externos', {
        p_fecha_inicio: from || null,
        p_fecha_fin: to || null,
        p_vendedor_id: vendedorId || null
      })
      if (error) throw error
      return data ?? []
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15
  })
}
