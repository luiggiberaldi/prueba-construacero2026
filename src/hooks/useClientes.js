// src/hooks/useClientes.js
// Queries y mutations para la tabla public.clientes
// RLS se encarga del aislamiento: vendedor solo ve sus clientes
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { sanitizePostgrestSearch } from '../utils/format'
import { authFetch } from '../services/authFetch'
import { showToast } from '../components/ui/Toast'
import { enqueue } from '../lib/mutationQueue'
import { getLocalClientes, saveLocalClienteOffline } from '../lib/offlineSnapshots'

// ─── Keys de caché ────────────────────────────────────────────────────────────
export const CLIENTES_KEY = ['clientes']
const CLIENT_SEARCH_CLEAN_RE = new RegExp(String.raw`[.()\s/-]`, 'g')

// ─── Consulta principal: listar clientes ─────────────────────────────────────
// Todos los usuarios ven todos los clientes (via worker API que bypasea RLS)
export function useClientes(busqueda = '') {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const offline = useAuthStore(useCallback(s => s.offline, []))

  return useQuery({
    queryKey: [...CLIENTES_KEY, perfil?.id || '', busqueda, offline],
    queryFn: async () => {
      if (offline) {
        const localData = await getLocalClientes()
        const raw = busqueda.trim().toLowerCase()
        if (!raw) return localData
        const norm = raw.replace(CLIENT_SEARCH_CLEAN_RE, '')

        return localData.filter(c => {
          const nombre = (c.nombre || '').toLowerCase()
          const codigo = (c.codigo_cliente || '').toLowerCase()
          const rif = (c.rif_cedula || '').toLowerCase().replace(CLIENT_SEARCH_CLEAN_RE, '')
          const tel = (c.telefono || '').toLowerCase().replace(CLIENT_SEARCH_CLEAN_RE, '')
          const email = (c.email || '').toLowerCase()

          return (
            nombre.includes(raw) ||
            codigo.includes(raw) ||
            rif.includes(norm) ||
            tel.includes(norm) ||
            email.includes(raw)
          )
        })
      }

      const params = new URLSearchParams()
      if (busqueda.trim()) params.set('busqueda', busqueda.trim())

      const res = await authFetch(`/api/clientes?${params}`)
      if (!res.ok) throw new Error('Error al cargar clientes')
      return await res.json()
    },
    enabled: !!perfil,
    staleTime: offline ? Infinity : 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Consulta: obtener un cliente por ID ──────────────────────────────────────
export function useCliente(id) {
  const offline = useAuthStore(useCallback(s => s.offline, []))
  return useQuery({
    queryKey: [...CLIENTES_KEY, id, offline],
    queryFn: async () => {
      if (offline) {
        const localData = await getLocalClientes()
        const found = localData.find(c => c.id === id)
        if (found) return found
        throw new Error('Cliente no encontrado en local')
      }
      const { data, error } = await supabase
        .from('clientes')
        .select(`
          id, codigo_cliente, nombre, rif_cedula, telefono, email,
          direccion, estado, ciudad, notas, tipo_cliente, activo,
          vendedor_id, asignado_en, saldo_pendiente, creado_en,
          vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, telefono, markup_pct, es_externo)
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!id,
    staleTime: offline ? Infinity : 1000 * 30,
    gcTime: 1000 * 60 * 5,
  })
}

// ─── Mutation: crear cliente ──────────────────────────────────────────────────
// El vendedor_id se auto-asigna al usuario actual (validado también en RLS)
export function useCrearCliente() {
  const qc = useQueryClient()
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const offline = useAuthStore(useCallback(s => s.offline, []))

  return useMutation({
    mutationFn: async (campos) => {
      const payload = {
        nombre:      campos.nombre.trim(),
        rif_cedula:  campos.rif_cedula?.trim() || null,
        telefono:    campos.telefono?.trim() || null,
        email:       campos.email?.trim()     || null,
        direccion:   campos.direccion?.trim() || null,
        estado:      campos.estado?.trim()    || null,
        ciudad:      campos.ciudad?.trim()    || null,
        notas:       campos.notas?.trim()     || null,
        tipo_cliente: campos.tipo_cliente || 'natural',
        vendedor_id: perfil.id,
      }

      if (offline) {
        const localId = `local_cli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const localCli = {
          id: localId,
          ...payload,
          vendedor: { id: perfil.id, nombre: perfil.nombre },
          activo: true,
          creado_en: new Date().toISOString()
        }
        await saveLocalClienteOffline(localCli)
        await enqueue('CREAR_CLIENTE', { ...payload, localId })
        return { _queued: true, cliente: localCli }
      }

      const res = await authFetch('/api/clientes/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear cliente')
      return result
    },
    onSuccess: async (res) => {
      if (res?._queued) {
        showToast('📋 Sin conexión — cliente guardado localmente.', 'warning')
      } else {
        showToast('Cliente creado con éxito', 'success')
      }
      await qc.cancelQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY, exact: false })
    },
  })
}

// ─── Mutation: actualizar cliente ─────────────────────────────────────────────
// Vendedor solo puede editar sus propios clientes (RLS lo valida)
// No puede cambiar vendedor_id — eso es responsabilidad de reasignar_cliente
export function useActualizarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const res = await authFetch('/api/clientes/actualizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          nombre:      campos.nombre.trim(),
          rif_cedula:  campos.rif_cedula?.trim() || null,
          telefono:    campos.telefono?.trim() || null,
          email:       campos.email?.trim()     || null,
          direccion:   campos.direccion?.trim() || null,
          estado:      campos.estado?.trim()    || null,
          ciudad:      campos.ciudad?.trim()    || null,
          notas:       campos.notas?.trim()     || null,
          tipo_cliente: campos.tipo_cliente || 'natural',
        })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al actualizar cliente')
      return result
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY, exact: false })
    },
  })
}

// ─── Mutation: desactivar cliente (soft delete) ───────────────────────────────
export function useDesactivarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('clientes')
        .update({ activo: false })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY, exact: false })
    },
  })
}

// ─── Mutation: borrar cliente (con lógica de 3 niveles en el Worker) ──────────
// Nivel 1 (limpio)     → DELETE físico en DB
// Nivel 2 (historial)  → soft delete (activo = false)
// Nivel 3 (deuda)      → 409 bloqueado
export function useBorrarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const res = await authFetch('/api/clientes/borrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al eliminar cliente')
      return result // { accion: 'eliminado' | 'desactivado', nombre }
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY, exact: false })
    },
  })
}

// ─── Mutation: activar cliente ───────────────────────────────────────────────
export function useActivarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const res = await authFetch('/api/clientes/activar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al activar cliente')
      return result
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY, exact: false })
    },
  })
}


// ─── Mutation: reasignar cliente (solo supervisor, via Worker API) ───────────
export function useReasignarCliente() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, nuevoVendedorId, motivo }) => {
      const res = await authFetch('/api/clientes/reasignar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, nuevoVendedorId, motivo }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al reasignar cliente')
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY, exact: false })
    },
  })
}

// ─── Query: cotizaciones de un cliente (historial) ──────────────────────────
export function useCotizacionesCliente(clienteId) {
  return useQuery({
    queryKey: ['cotizaciones-cliente', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizaciones')
        .select(`
          id, numero, version, cotizacion_raiz_id, estado,
          total_usd, tasa_bcv_snapshot, total_bs_snapshot,
          creado_en, enviada_en,
          vendedor:usuarios!cotizaciones_vendedor_id_fkey(id, nombre)
        `)
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .limit(50)

      if (error) throw error
      return data ?? []
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60 * 5,
  })
}

// ─── Query: lista de vendedores activos (para selector de reasignación) ───────
export function useVendedores() {
  return useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, rol, color, telefono, markup_pct, es_externo')
        .eq('activo', true)
        .order('nombre', { ascending: true })

      if (error) throw error
      // Ocultar cuenta "Super Admin" y usuarios "desarrollador" del sistema
      return (data ?? []).filter(u => u.nombre !== 'Super Admin' && u.rol?.toLowerCase() !== 'desarrollador' && u.nombre?.toLowerCase() !== 'desarrollador')
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  })
}

// ─── Query: ventas/despachos aprobados de un cliente (historial de ventas) ───
export function useVentasCliente(clienteId) {
  return useQuery({
    queryKey: ['ventas-cliente', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notas_despacho')
        .select(`
          id, numero, estado, total_usd, flete_usd, corte_usd, descuento_total_usd, creado_en, forma_pago,
          vendedor:usuarios!notas_despacho_vendedor_id_fkey(id, nombre, color),
          items:notas_despacho_items(
            id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, total_linea_usd, es_prestamo
          )
        `)
        .or(`cliente_id.eq.${clienteId},cliente_factura_id.eq.${clienteId}`)
        .in('estado', ['despachada', 'entregada'])
        .order('creado_en', { ascending: false })
        .limit(50)

      if (error) throw error
      return data ?? []
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60 * 5,
  })
}

