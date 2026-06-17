// src/hooks/useTransportistas.js
// Queries y mutations para transportistas
import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { showToast } from '../components/ui/Toast'

const KEY = ['transportistas']

// ─── Lista (todos o solo activos) ────────────────────────────────────────────
export function useTransportistas({ soloActivos = true } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: [...KEY, soloActivos],
    queryFn: async () => {
      let q = supabase
        .from('transportistas')
        .select('id, nombre, rif, telefono, color, color_batea, vehiculo, placa_chuto, placa_batea, activo, zona_cobertura, capacidad')
        .order('nombre')
      if (soloActivos) q = q.eq('activo', true)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30, // transportistas rarely change
  })
}

// ─── Crear (via Worker API — bypass RLS) ───────────────────────────────────────────────
export function useCrearTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const headers = await getAuthHeaders()
      if (!headers.Authorization?.includes('Bearer ')) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/transportistas/crear'), {
        method: 'POST',
        headers,
        body: JSON.stringify(campos),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: async (nuevo) => {
      const tReal = nuevo.transportista || nuevo
      if (!tReal?.id) return

      // Cancelar cualquier refetch para que no nos pise el update optimístico
      await qc.cancelQueries({ queryKey: KEY })

      // Inyectar en TODAS las variantes de la query ['transportistas'] (activos y todos)
      qc.setQueriesData({ queryKey: KEY, exact: false }, (viejos) => {
        const arr = Array.isArray(viejos) ? viejos : []
        if (arr.some(t => t.id === tReal.id)) return arr
        return [tReal, ...arr].sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''))
      })

      showToast.success('Transportista creado')

      // Invalidación muy diferida para entornos con alta latencia (Vercel)
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },
  })
}

// ─── Actualizar (via Worker API — bypass RLS) ───────────────────────────────────────────
export function useActualizarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const headers = await getAuthHeaders()
      if (!headers.Authorization?.includes('Bearer ')) throw new Error('No autenticado')

      const res = await fetch(apiUrl('/api/transportistas/actualizar'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, ...campos }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }
      return res.json()
    },
    onSuccess: async (nuevo) => {
      const tReal = nuevo.transportista || nuevo
      if (!tReal?.id) return

      await qc.cancelQueries({ queryKey: KEY })

      qc.setQueriesData({ queryKey: KEY, exact: false }, (viejos) => {
        const arr = Array.isArray(viejos) ? viejos : []
        return arr.map(t => t.id === tReal.id ? tReal : t)
      })

      showToast.success('Transportista actualizado')
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },
  })
}

// ─── Desactivar (soft delete) ─────────────────────────────────────────────────
export function useDesactivarTransportista() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('transportistas').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: async (_, id) => {
      await qc.cancelQueries({ queryKey: KEY })

      qc.setQueriesData({ queryKey: KEY, exact: false }, (viejos) => {
        const arr = Array.isArray(viejos) ? viejos : []
        return arr.filter(t => t.id !== id)
      })

      showToast.success('Transportista eliminado')
      qc.invalidateQueries({ queryKey: KEY, exact: false })
    },

  })
}
