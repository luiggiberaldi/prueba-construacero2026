// src/hooks/useInventario.js
// Queries y mutations para productos
// — Vendedor usa RPCs SECURITY DEFINER (sin costo_usd)
// — Supervisor usa la tabla productos directa (con costo_usd)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import useAuthStore from '../store/useAuthStore'
import { buildSmartFilter, parseSearchTerms } from '../utils/smartSearch'
import { showToast } from '../components/ui/Toast'
import { MOVIMIENTOS_KEY } from './useMovimientosInventario'
import { broadcastInventarioUpdate } from '../services/supabase/realtimeBus'
import { authFetch } from '../services/authFetch'

export const INVENTARIO_KEY = ['inventario']

// Prefijos que se consolidan en una sola categoría padre
const CATEGORY_GROUPS = [
  'CONEXIONES',
  'ELECTRICIDAD',
  'LAMINAS',
  'PERFILES',
  'BARRAS',
  'TUBERIAS',
  'FERRETERIA',
]


// Dada una categoría raw de la DB, retorna el grupo padre
function getCategoryGroup(cat) {
  if (!cat) return cat
  const upper = cat.toUpperCase().trim()
  for (const prefix of CATEGORY_GROUPS) {
    if (upper.startsWith(prefix) && upper !== prefix) return prefix
  }
  return cat
}

// ─── Lista de productos ───────────────────────────────────────────────────────
export function useInventario({ busqueda = '', categoria = '', page = 0, pageSize = 100 } = {}) {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, busqueda, categoria, esPrivilegiado, page, pageSize],
    queryFn: async () => {
      const isGroup = categoria ? CATEGORY_GROUPS.includes(categoria.toUpperCase().trim()) : false

      // Si hay texto de búsqueda, usamos el worker híbrido
      if (busqueda.trim() !== '') {
        try {
          const res = await authFetch('/api/productos/buscar', {
            method: 'POST',
            body: JSON.stringify({
              busqueda: busqueda.trim(),
              categoria: categoria || '',
              categoria_grupo: isGroup,
              page,
              limit: pageSize
            })
          })
          if (!res.ok) throw new Error('Error en búsqueda híbrida')
          const data = await res.json()
          return { productos: data.productos || [], totalCount: data.totalCount || 0 }
        } catch (error) {
          console.error('Error buscando productos híbrido:', error)
          // Fallback a comportamiento normal si falla
        }
      }

      if (esPrivilegiado) {
        // Supervisor: tabla directa (con costo_usd)
        let query = supabase
          .from('productos')
          .select('id, codigo, nombre, descripcion, categoria, unidad, precio_usd, precio_2, precio_3, precio1_porcentaje, precio2_porcentaje, precio3_porcentaje, costo_usd, stock_actual, stock_minimo, activo, imagen_url, creado_en, actualizado_en', { count: 'exact' })
          .eq('activo', true)

        if (busqueda.trim()) {
          const filters = buildSmartFilter(busqueda)
          if (filters) {
            for (const orClause of filters) {
              query = query.or(orClause)
            }
          }
        }

        if (categoria) {
          if (isGroup) query = query.ilike('categoria', `${categoria}%`)
          else query = query.eq('categoria', categoria)
        }

        query = query.order('nombre', { ascending: true }).range(page * pageSize, (page + 1) * pageSize - 1)

        const { data, error, count } = await query
        if (error) throw error
        return { productos: data ?? [], totalCount: count ?? (data?.length || 0) }
      }

      // Vendedor: RPC segura
      const { data, error } = await supabase.rpc('obtener_productos_vendedor', {
        p_busqueda: busqueda.trim(),
        p_categoria: categoria || '',
        p_categoria_grupo: isGroup,
        p_limit: pageSize,
        p_offset: page * pageSize,
      })
      if (error) throw error
      const rows = data ?? []
      const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0
      const productos = rows.map(({ total_count, ...rest }) => rest)
      return { productos, totalCount }
    },
    enabled: !!perfil,
    staleTime: 1000 * 30,         // 30s — permite refetch al volver de fondo
    gcTime:    1000 * 60 * 10,
  })
}


// Procesa una lista plana de categorías y la convierte en una jerarquía plana para Selects
function processCategoriasHierarchy(rawCats) {
  // Normalizar los nombres (trim) para evitar duplicados como "CAT" y "CAT "
  const cleanedCats = rawCats.map(c => c?.trim()).filter(Boolean)
  const exactCats = [...new Set(cleanedCats)].sort()
  const result = []
  const processedGroups = new Set()

  for (const cat of exactCats) {
    const group = getCategoryGroup(cat)
    if (group !== cat) {
      // Es hija de un grupo
      if (!processedGroups.has(group)) {
        processedGroups.add(group)
        result.push({ value: group, label: `${group} (Todas)` })
      }
      result.push({ value: cat, label: `  ↳ ${cat}` })
    } else {
      // Es categoría independiente
      if (!processedGroups.has(cat)) {
        processedGroups.add(cat)
        result.push({ value: cat, label: cat })
      }
    }
  }
  return result
}

// ─── Categorías únicas (para el filtro) ──────────────────────────────────────
export function useCategorias() {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...INVENTARIO_KEY, 'categorias'],
    queryFn: async () => {
      if (esPrivilegiado) {
        const { data, error } = await supabase
          .from('productos')
          .select('categoria')
          .eq('activo', true)
          .not('categoria', 'is', null)
          .order('categoria', { ascending: true })
        if (error) throw error
        const rawCats = (data ?? []).map(r => r.categoria).filter(Boolean)
        return processCategoriasHierarchy(rawCats)
      }

      // Vendedor: RPC segura (SECURITY DEFINER)
      const { data, error } = await supabase.rpc('obtener_categorias_vendedor')
      if (error) throw error
      const rawCats = (data ?? []).map(r => r.categoria).filter(Boolean)
      return processCategoriasHierarchy(rawCats)
    },
    enabled: !!perfil,
    staleTime: 1000 * 30,         // 30s — misma ventana que productos
  })
}

// Exportar para uso en useInventario
export { getCategoryGroup }

// ─── Mutation: crear producto (solo supervisor) ───────────────────────────────
// Usa RPC que registra stock inicial en kardex automáticamente
export function useCrearProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (campos) => {
      const { data, error } = await supabase.rpc('crear_producto_con_kardex', {
        p_codigo:       campos.codigo?.trim()      || null,
        p_nombre:       campos.nombre.trim(),
        p_descripcion:  campos.descripcion?.trim() || null,
        p_categoria:    campos.categoria?.trim()   || null,
        p_unidad:       campos.unidad?.trim()      || 'und',
        p_precio_usd:   Number(campos.precio_usd)  || 0,
        p_costo_usd:    campos.costo_usd ? Number(campos.costo_usd) : null,
        p_stock_actual: Number(campos.stock_actual) || 0,
        p_stock_minimo: Number(campos.stock_minimo) || 0,
        p_precio_2     : campos.precio_2 !== '' && campos.precio_2 != null ? Number(campos.precio_2) : null,
        p_precio_3     : campos.precio_3 !== '' && campos.precio_3 != null ? Number(campos.precio_3) : null,
        p_precio1_porcentaje: campos.precio1_porcentaje !== '' && campos.precio1_porcentaje != null ? Number(campos.precio1_porcentaje) : null,
        p_precio2_porcentaje: campos.precio2_porcentaje !== '' && campos.precio2_porcentaje != null ? Number(campos.precio2_porcentaje) : null,
        p_precio3_porcentaje: campos.precio3_porcentaje !== '' && campos.precio3_porcentaje != null ? Number(campos.precio3_porcentaje) : null,
      })

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505')
          throw new Error('Ya existe un producto con ese código')
        throw error
      }
      return data
    },
    onSuccess: async () => {
      // Cancelar queries en vuelo para evitar race condition Vercel→Supabase:
      // el RPC puede tardar en ser visible en DB antes que el refetch inmediato complete.
      await qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      await qc.cancelQueries({ queryKey: MOVIMIENTOS_KEY })
      broadcastInventarioUpdate()
      showToast('Producto creado', 'success')
      // Invalidar con delay para dar tiempo al commit de ser visible en Supabase
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      }, 300)
      const { operatorId } = useAuthStore.getState()
      if (operatorId) authFetch('/api/admin/sync-embeddings', { method: 'POST' }).catch(() => {})
    },
  })
}

// ─── Mutation: actualizar producto (solo supervisor) ──────────────────────────
// Usa RPC que registra cambios de stock en kardex automáticamente
export function useActualizarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, campos, imagen_url }) => {
      const { data, error } = await supabase.rpc('actualizar_producto_con_kardex', {
        p_id:           id,
        p_codigo:       campos.codigo?.trim()      || null,
        p_nombre:       campos.nombre.trim(),
        p_descripcion:  campos.descripcion?.trim() || null,
        p_categoria:    campos.categoria?.trim()   || null,
        p_unidad:       campos.unidad?.trim()      || 'und',
        p_precio_usd:   Number(campos.precio_usd)  || 0,
        p_costo_usd:    campos.costo_usd ? Number(campos.costo_usd) : null,
        p_stock_actual: Number(campos.stock_actual) || 0,
        p_stock_minimo: Number(campos.stock_minimo) || 0,
        p_precio_2     : campos.precio_2 !== '' && campos.precio_2 != null ? Number(campos.precio_2) : null,
        p_precio_3     : campos.precio_3 !== '' && campos.precio_3 != null ? Number(campos.precio_3) : null,
        p_precio1_porcentaje: campos.precio1_porcentaje !== '' && campos.precio1_porcentaje != null ? Number(campos.precio1_porcentaje) : null,
        p_precio2_porcentaje: campos.precio2_porcentaje !== '' && campos.precio2_porcentaje != null ? Number(campos.precio2_porcentaje) : null,
        p_precio3_porcentaje: campos.precio3_porcentaje !== '' && campos.precio3_porcentaje != null ? Number(campos.precio3_porcentaje) : null,
        p_imagen_url   : imagen_url ?? null,
      })

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505')
          throw new Error('Ya existe un producto con ese código')
        throw error
      }
      return data
    },
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      await qc.cancelQueries({ queryKey: MOVIMIENTOS_KEY })
      broadcastInventarioUpdate()
      showToast('Producto actualizado', 'success')
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      }, 300)
      const { operatorId } = useAuthStore.getState()
      if (operatorId) authFetch('/api/admin/sync-embeddings', { method: 'POST' }).catch(() => {})
    },
  })
}

// ─── Mutation: borrar producto (hard delete con kardex) ────────────────────────
// Usa RPC que registra egreso del stock restante antes de borrar
export function useBorrarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('borrar_producto_con_kardex', {
        p_producto_id: id,
      })
      if (error) throw error
    },
    onSuccess: (_, id) => {
      // Remover optimísticamente del cache para respuesta inmediata en UI
      qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      qc.setQueriesData({ queryKey: INVENTARIO_KEY }, (old) => {
        if (!old?.productos) return old
        return { ...old, productos: old.productos.filter(p => p.id !== id), totalCount: Math.max((old.totalCount ?? old.productos.length) - 1, 0) }
      })
      broadcastInventarioUpdate()
      showToast('Producto eliminado y registrado en kardex', 'success')
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: INVENTARIO_KEY })
        qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
      }, 300)
    },
    onError: (error) => {
      showToast(error.message || 'Error al borrar producto', 'error')
    },
  })
}

// ─── Mutation: desactivar producto (soft delete) ──────────────────────────────
export function useDesactivarProducto() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('productos')
        .update({ activo: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, id) => {
      qc.cancelQueries({ queryKey: INVENTARIO_KEY })
      qc.setQueriesData({ queryKey: INVENTARIO_KEY }, (old) => {
        if (!old?.productos) return old
        return { ...old, productos: old.productos.filter(p => p.id !== id), totalCount: Math.max((old.totalCount ?? old.productos.length) - 1, 0) }
      })
      setTimeout(() => qc.invalidateQueries({ queryKey: INVENTARIO_KEY }), 300)
    },
  })
}
