// src/hooks/useProveedores.js
// Queries y mutations para proveedores y cuentas por pagar (CxP)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import useAuthStore from '../store/useAuthStore'
import { authFetch } from '../services/authFetch'

export const PROVEEDORES_KEY = ['proveedores']
export const CXP_KEY = ['cuentas-por-pagar']

// ─── Query: Listar proveedores ────────────────────────────────────────────────
export function useProveedores(busqueda = '') {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))

  return useQuery({
    queryKey: [...PROVEEDORES_KEY, perfil?.id || '', busqueda],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (busqueda.trim()) params.set('busqueda', busqueda.trim())

      const res = await authFetch(`/api/proveedores?${params}`)
      if (!res.ok) throw new Error('Error al cargar proveedores')
      return await res.json()
    },
    enabled: !!perfil,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  })
}

// ─── Mutation: Crear proveedor ────────────────────────────────────────────────
export function useCrearProveedor() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (campos) => {
      const res = await authFetch('/api/proveedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: campos.nombre.trim(),
          rif_cedula: campos.rif_cedula?.trim() || null,
          telefono: campos.telefono?.trim() || null,
          email: campos.email?.trim() || null,
          direccion: campos.direccion?.trim() || null,
          estado: campos.estado?.trim() || null,
          ciudad: campos.ciudad?.trim() || null,
          notas: campos.notas?.trim() || null,
          tipo_proveedor: campos.tipo_proveedor || 'juridico',
        })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al crear proveedor')
      return result
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: PROVEEDORES_KEY })
      qc.invalidateQueries({ queryKey: PROVEEDORES_KEY, exact: false })
    },
  })
}

// ─── Mutation: Actualizar proveedor ───────────────────────────────────────────
export function useActualizarProveedor() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, campos }) => {
      const res = await authFetch('/api/proveedores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          nombre: campos.nombre.trim(),
          rif_cedula: campos.rif_cedula?.trim() || null,
          telefono: campos.telefono?.trim() || null,
          email: campos.email?.trim() || null,
          direccion: campos.direccion?.trim() || null,
          estado: campos.estado?.trim() || null,
          ciudad: campos.ciudad?.trim() || null,
          notas: campos.notas?.trim() || null,
          tipo_proveedor: campos.tipo_proveedor || 'juridico',
        })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al actualizar proveedor')
      return result
    },
    onSuccess: async (data, variables) => {
      await qc.cancelQueries({ queryKey: PROVEEDORES_KEY })
      qc.invalidateQueries({ queryKey: PROVEEDORES_KEY, exact: false })
      // También invalidamos el historial de transacciones de este proveedor por si acaso
      qc.invalidateQueries({ queryKey: [...CXP_KEY, variables.id] })
    },
  })
}

// ─── Mutation: Borrar proveedor ──────────────────────────────────────────────
export function useBorrarProveedor() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const res = await authFetch('/api/proveedores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al eliminar proveedor')
      return result // { accion: 'eliminado' | 'desactivado', nombre }
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: PROVEEDORES_KEY })
      qc.invalidateQueries({ queryKey: PROVEEDORES_KEY, exact: false })
    },
  })
}

// ─── Query: Obtener cuentas por pagar (historial de transacciones) ────────────
export function useCuentasPorPagar(proveedorId) {
  return useQuery({
    queryKey: [...CXP_KEY, proveedorId],
    queryFn: async () => {
      const res = await authFetch(`/api/cuentas-por-pagar?proveedorId=${proveedorId}`)
      if (!res.ok) throw new Error('Error al cargar movimientos de cuentas por pagar')
      return await res.json()
    },
    enabled: !!proveedorId,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  })
}

// ─── Mutation: Registrar transacción de CxP ───────────────────────────────────
export function useRegistrarTransaccionCxP() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ proveedorId, tipo, monto, formaPago, referencia, descripcion, diasVencimiento }) => {
      const res = await authFetch('/api/cuentas-por-pagar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedorId,
          tipo,
          monto,
          formaPago,
          referencia,
          descripcion,
          diasVencimiento,
        })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al registrar transacción')
      return result
    },
    onSuccess: async (data, variables) => {
      // Invalidamos lista de proveedores para reflejar el cambio de saldo_pendiente
      await qc.cancelQueries({ queryKey: PROVEEDORES_KEY })
      qc.invalidateQueries({ queryKey: PROVEEDORES_KEY, exact: false })

      // Invalidamos historial de CxP para el proveedor específico
      await qc.cancelQueries({ queryKey: [...CXP_KEY, variables.proveedorId] })
      qc.invalidateQueries({ queryKey: [...CXP_KEY, variables.proveedorId], exact: true })
    },
  })
}

// ─── Mutation: Actualizar transacción de CxP ──────────────────────────────────
export function useActualizarTransaccionCxP() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, proveedorId, monto, descripcion, fechaVencimiento, formaPago, referencia }) => {
      const res = await authFetch('/api/cuentas-por-pagar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          monto,
          descripcion,
          fechaVencimiento,
          formaPago,
          referencia,
        })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al actualizar transacción')
      return result
    },
    onSuccess: async (data, variables) => {
      // Invalidamos lista de proveedores para reflejar el cambio de saldo_pendiente
      await qc.cancelQueries({ queryKey: PROVEEDORES_KEY })
      qc.invalidateQueries({ queryKey: PROVEEDORES_KEY, exact: false })

      // Invalidamos historial de CxP para el proveedor específico
      await qc.cancelQueries({ queryKey: [...CXP_KEY, variables.proveedorId] })
      qc.invalidateQueries({ queryKey: [...CXP_KEY, variables.proveedorId], exact: true })
    },
  })
}

