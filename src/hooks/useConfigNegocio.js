// src/hooks/useConfigNegocio.js
// Configuración del negocio para header del PDF y ajustes globales
// — select explícito SIN gate_password_hash
// — gate se valida server-side vía RPCs SECURITY DEFINER
import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { broadcastEntidad } from '../services/supabase/realtimeBus'

const KEY = ['config_negocio']

export function useConfigNegocio() {
  const qc = useQueryClient()

  useEffect(() => {
    const channelName = `config_negocio_changes_${Date.now()}_${Math.random()}`
    const sub = supabase.channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'configuracion_negocio' },
        (payload) => {
          if (payload.new) {
            qc.setQueryData(KEY, (old) => {
              if (!old) return payload.new
              return { ...old, ...payload.new }
            })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(sub) }
  }, [qc])

  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/config'), { headers })
      if (!res.ok) {
        throw new Error('Error al obtener la configuración')
      }
      const data = await res.json()
      return data ?? {}
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000, // config rarely changes, keep in cache 30 min
  })
}

// ─── Guardar configuración (vía Worker backend — bypass RLS) ─────────────────
export function useActualizarConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/admin/config'), {
        method: 'PUT',
        headers,
        body: JSON.stringify(campos),
      })
      if (!res.ok) {
        const text = await res.text()
        let data = {}
        try { data = JSON.parse(text) } catch {}
        throw new Error(data.error || text || `Error ${res.status}`)
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); broadcastEntidad('config') },
  })
}

// ─── Validar gate de acceso (server-side via RPC) ──────────────────────────────
// El hash NUNCA sale de la BD — se compara server-side

async function hashSHA256(text) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function validarGate(emailInput, passwordInput) {
  const inputHash = await hashSHA256(passwordInput)
  const { data, error } = await supabase.rpc('validar_gate_acceso', {
    p_email: emailInput.trim(),
    p_password_hash: inputHash,
  })

  if (error) {
    return { ok: false, error: 'No se pudo verificar el acceso' }
  }

  // data es boolean: true = acceso permitido
  if (!data) {
    return { ok: false, error: 'Correo o contraseña incorrectos' }
  }

  return { ok: true }
}

export async function tieneGateConfigurado() {
  const { data, error } = await supabase.rpc('tiene_gate_configurado')
  if (error) return false
  return !!data
}

export { hashSHA256 }
