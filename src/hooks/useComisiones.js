// src/hooks/useComisiones.js
// Queries y mutations para el sistema de comisiones
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { showToast } from '../components/ui/Toast'
import { broadcastEntidad } from '../services/supabase/realtimeBus'

export const COMISIONES_KEY = ['comisiones']

/**
 * Hook para obtener la lista de comisiones (Paginada)
 */
export function useComisiones({ 
  estado = '', 
  vendedorId = '', 
  desde = '', 
  hasta = '',
  page = 1,
  pageSize = 100,
  vista = ''
} = {}) {
  const perfil = useAuthStore(s => s.perfil)
  const esAdmin = perfil?.rol === 'administracion'

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'lista', perfil?.id, estado, vendedorId, esAdmin, desde, hasta, page, pageSize, vista],
    queryFn: async () => {
      if (!perfil?.id) {
        throw new Error('Perfil de operador no disponible para cargar lista de comisiones')
      }

      try {
        const params = new URLSearchParams()
        
        // Normalización de parámetros
        const vId = vendedorId || null
        if (vId) params.set('vendedorId', vId)
        if (estado) params.set('estado', estado)
        if (desde) params.set('desde', desde)
        if (hasta) params.set('hasta', hasta)
        if (vista) params.set('vista', vista)
        
        // Paginación
        params.set('page', page.toString())
        params.set('pageSize', pageSize.toString())

        const headers = await getAuthHeaders()
        const res = await fetch(apiUrl(`/api/comisiones/lista?${params}`), {
          headers
        })

        
        const text = await res.text()
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text}`)
        }
        
        const data = JSON.parse(text)

        // ── DEBUG TEMPORAL ──────────────────────────────────────────────
        const items = data?.data ?? []
        console.log('[useComisiones] WORKER RESPONSE total:', data?.total, '| items count:', items.length)
        console.log('[useComisiones] PRIMER ITEM RAW:', JSON.stringify(items?.[0] ?? null))
        // ───────────────────────────────────────────────────────────────
        
        const mappedItems = items.map(c => {
          if (c.comisiones && c.monto !== undefined) {
            // Si es un objeto de tipo evento de liberación
            return c
          }
          return {
            id: c.id,
            despachoid: c.despachoid,
            vendedorid: c.vendedorid,
            cotizacionid: c.cotizacionid,
            cuentaid: c.cuentaid,
            totalcomision: Number(c.totalcomision || 0),
            comisioncabilla: Number(c.comisioncabilla || 0),
            comisionotros: Number(c.comisionotros || 0),
            pctcabilla: Number(c.pctcabilla || 0),
            pctotros: Number(c.pctotros || 0),
            montopagado: Number(c.montopagado || 0),
            comision_liberada: Number(c.comision_liberada || 0),
            comision_retenida: Number(c.comision_retenida || 0),
            estado: c.estado,
            pagadaen: c.pagadaen,
            pagadapor: c.pagadapor,
            creadoen: c.creadoen,
            vendedor: c.vendedor,
            despacho: c.despacho,
            cotizacion: c.cotizacion,
          }
        })

        return {
          ...(data ?? { total: 0, page, pageSize, totalPages: 0 }),
          data: mappedItems,
        }
      } catch (e) {
        console.error('Error useComisiones:', e.message)
        throw e
      }
    },
    enabled: !!perfil?.id,
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

/**
 * Hook para el resumen de comisiones (KPIs superiores - Exacto vía RPC)
 */
export function useComisionesResumen({ vendedorId = '', desde = '', hasta = '', estado = '' } = {}) {
  const perfil = useAuthStore(s => s.perfil)

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'resumen', perfil?.id, vendedorId, desde, hasta, estado],
    queryFn: async () => {
      if (!perfil?.id) {
        throw new Error('Perfil de operador no disponible para cargar resumen')
      }

      try {
        const params = new URLSearchParams()
        if (vendedorId) params.set('vendedorId', vendedorId)
        if (desde) params.set('desde', desde)
        if (hasta) params.set('hasta', hasta)
        if (estado) params.set('estado', estado)

        const headers = await getAuthHeaders()
        const res = await fetch(apiUrl(`/api/comisiones/resumen?${params}`), {
          headers
        })

        const text = await res.text()
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text}`)
        }
        
        const data = JSON.parse(text)
        return {
          // Claves alineadas con ReportesView.jsx y TabLiquidacion.jsx
          total:          Number(data.totalAcumulado || 0),
          pendiente:      Number(data.pendientePago  || 0),
          pagado:         Number(data.yaPagado       || 0),
          retenida:       0, // v2 no tiene campo retenida separado
          countPendiente: Number(data.numPendientes  || 0),
          countPagado:    Number(data.numPagadas     || 0),
          // Campos originales también disponibles por compatibilidad
          totalAcumulado: Number(data.totalAcumulado || 0),
          pendientePago:  Number(data.pendientePago  || 0),
          yaPagado:       Number(data.yaPagado       || 0),
          numPendientes:  Number(data.numPendientes  || 0),
          numPagadas:     Number(data.numPagadas     || 0),
          totalRegistros: Number(data.total          || 0),
          // Desglose de pendientes
          pendienteRegular: Number(data.pendienteRegular || 0),
          pendienteCxc:     Number(data.pendienteCxc || 0),
        }
      } catch (e) {
        console.error('Error useComisionesResumen:', e.message)
        throw e
      }
    },
    enabled: !!perfil?.id,
    retry: 1,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

/**
 * Mutación para pagar comisiones (Atómica vía RPC)
 */
export function useMarcarComisionPagada() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ comisionid, montopagado }) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/comisiones/pagar'), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comisionid, montopagado }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || result.message || 'Error al procesar pago')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMISIONES_KEY })
      broadcastEntidad('comisiones')
      showToast('Comisión procesada correctamente', 'success')
    },
  })
}

/**
 * Reporte Detallado de Ventas y Comisiones (RPC)
 */
export function useReporteVentasComisiones({ desde, hasta, vendedorId } = {}) {
  const perfil = useAuthStore(s => s.perfil)

  return useQuery({
    queryKey: [...COMISIONES_KEY, 'detalle_ventas', perfil?.id, desde, hasta, vendedorId],
    queryFn: async () => {
      if (!perfil?.id) return []

      const p_fecha_inicio = desde ? `${desde}T00:00:00-04:00` : null
      const p_fecha_fin = hasta ? `${hasta}T23:59:59-04:00` : null
      const vId = vendedorId || null

      const { data, error } = await supabase.rpc('obtener_reporte_ventas_comisiones', {
        p_fecha_inicio,
        p_fecha_fin,
        p_vendedor_id: vId
      })

      if (error) {
        console.error('Error RPC Reporte:', error)
        throw error
      }
      return data ?? []
    },
    enabled: !!perfil?.id && !!vendedorId,
  })
}
