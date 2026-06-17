// src/hooks/useCuentasCobrar.js
// Queries y mutations para el sistema de cuentas por cobrar
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import { authFetch } from '../services/authFetch'
import useAuthStore from '../store/useAuthStore'
import { CLIENTES_KEY } from './useClientes'
import { showToast } from '../components/ui/Toast'

export const CXC_KEY = ['cuentas-cobrar']

// ─── Historial CxC de un cliente ──────────────────────────────────────────
export function useCuentasCobrar(clienteId) {
  return useQuery({
    queryKey: [...CXC_KEY, clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cuentas_por_cobrar')
        .select(`
          id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, fecha_vencimiento,
          registrado_por, creado_en, metodo_pago
        `)
        .eq('cliente_id', clienteId)
        .order('creado_en', { ascending: false })
        .limit(100)

      if (error) throw error
      return data ?? []
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60 * 2,
  })
}

// ─── Resumen global CxC (para reporte) ────────────────────────────────────
export function useResumenCxC() {
  const { perfil } = useAuthStore()
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'

  return useQuery({
    queryKey: [...CXC_KEY, 'resumen', esPrivilegiado, perfil?.id],
    queryFn: async () => {
      // Obtener clientes con saldo pendiente > 0
      let query = supabase
        .from('clientes')
        .select(`
          id, nombre, rif_cedula, telefono,
          saldo_pendiente,
          vendedor:usuarios!clientes_vendedor_id_fkey(id, nombre, color)
        `)
        .gt('saldo_pendiente', 0)
        .eq('activo', true)
        .order('saldo_pendiente', { ascending: false })

      if (!esPrivilegiado) query = query.eq('vendedor_id', perfil.id)

      const { data: clientesConDeuda, error } = await query
      if (error) throw error

      const clientes = clientesConDeuda ?? []
      const totalDeuda = clientes.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0)
      const promedioDeuda = clientes.length > 0 ? totalDeuda / clientes.length : 0

      // Obtener transacciones (cargos y abonos) para los clientes con deuda activa
      const clienteIds = clientes.map(c => c.id)
      let transacciones = []
      if (clienteIds.length > 0) {
        for (let i = 0; i < clienteIds.length; i += 50) {
          const batch = clienteIds.slice(i, i + 50)
          const { data } = await supabase
            .from('cuentas_por_cobrar')
            .select('id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd, fecha_vencimiento, creado_en, metodo_pago, descripcion')
            .in('tipo', ['cargo', 'abono'])
            .in('cliente_id', batch)
            .order('creado_en', { ascending: true }) // Orden cronológico para aplicar FIFO correctamente
          transacciones = transacciones.concat(data ?? [])
        }
      }

      // Reconstruir los saldos pendientes reales por cargo (FIFO + despacho_id matching)
      const cargosPendientesPorCliente = {}
      clienteIds.forEach(cid => {
        cargosPendientesPorCliente[cid] = []
      })

      // Agrupar transacciones por cliente
      const txsPorCliente = {}
      transacciones.forEach(t => {
        if (!txsPorCliente[t.cliente_id]) {
          txsPorCliente[t.cliente_id] = []
        }
        txsPorCliente[t.cliente_id].push(t)
      })

      Object.keys(txsPorCliente).forEach(cid => {
        const txs = txsPorCliente[cid]
        const clientCargos = []
        const clientAbonos = []

        txs.forEach(t => {
          if (t.tipo === 'cargo') {
            clientCargos.push({
              ...t,
              saldo_pendiente_cargo: Number(t.monto_usd || 0)
            })
          } else if (t.tipo === 'abono') {
            clientAbonos.push({
              ...t,
              monto_restante: Number(t.monto_usd || 0)
            })
          }
        })

        // Fase 1: Aplicar abonos vinculados a un despacho directo
        clientAbonos.forEach(abono => {
          if (abono.despacho_id) {
            const cargo = clientCargos.find(c => c.despacho_id === abono.despacho_id)
            if (cargo && cargo.saldo_pendiente_cargo > 0) {
              const aplicar = Math.min(cargo.saldo_pendiente_cargo, abono.monto_restante)
              cargo.saldo_pendiente_cargo = Math.round((cargo.saldo_pendiente_cargo - aplicar) * 10000) / 10000
              abono.monto_restante = Math.round((abono.monto_restante - aplicar) * 10000) / 10000
            }
          }
        })

        // Fase 2: Aplicar abonos restantes en orden FIFO
        clientAbonos.forEach(abono => {
          if (abono.monto_restante > 0) {
            for (let i = 0; i < clientCargos.length; i++) {
              const cargo = clientCargos[i]
              if (cargo.saldo_pendiente_cargo > 0) {
                const aplicar = Math.min(cargo.saldo_pendiente_cargo, abono.monto_restante)
                cargo.saldo_pendiente_cargo = Math.round((cargo.saldo_pendiente_cargo - aplicar) * 10000) / 10000
                abono.monto_restante = Math.round((abono.monto_restante - aplicar) * 10000) / 10000
                if (abono.monto_restante <= 0) break
              }
            }
          }
        })

        // Mapear saldo recalculado y filtrar cargos saldados
        cargosPendientesPorCliente[cid] = clientCargos
          .filter(c => c.saldo_pendiente_cargo > 0.005)
          .map(c => ({
            ...c,
            saldo_usd: c.saldo_pendiente_cargo
          }))
      })

      const todosCargosActivos = Object.values(cargosPendientesPorCliente).flat()

      // Aging por rangos (usando el saldo real pendiente de cargos activos)
      const now = new Date()
      const aging = [
        { rango: '0 – 30 días', count: 0, totalUsd: 0 },
        { rango: '31 – 60 días', count: 0, totalUsd: 0 },
        { rango: '61 – 90 días', count: 0, totalUsd: 0 },
        { rango: '90+ días', count: 0, totalUsd: 0 },
      ]

      // Dias sin pago por cliente (fecha del cargo más antiguo activo)
      const diasPorCliente = {}
      todosCargosActivos.forEach(c => {
        const dias = Math.floor((now - new Date(c.creado_en)) / (1000 * 60 * 60 * 24))
        if (!diasPorCliente[c.cliente_id] || dias > diasPorCliente[c.cliente_id]) {
          diasPorCliente[c.cliente_id] = dias
        }
      })

      todosCargosActivos.forEach(c => {
        const dias = Math.floor((now - new Date(c.creado_en)) / (1000 * 60 * 60 * 24))
        const bucket = dias <= 30 ? 0 : dias <= 60 ? 1 : dias <= 90 ? 2 : 3
        aging[bucket].count++
        aging[bucket].totalUsd += Number(c.saldo_usd || 0)
      })

      // Deuda más antigua activa
      const cargoMasAntiguo = todosCargosActivos.length > 0
        ? todosCargosActivos.reduce((oldest, c) => new Date(c.creado_en) < new Date(oldest.creado_en) ? c : oldest)
        : null

      const diasMasAntiguo = cargoMasAntiguo
        ? Math.floor((now - new Date(cargoMasAntiguo.creado_en)) / (1000 * 60 * 60 * 24))
        : 0

      // Alertas de vencimiento (solo de cargos activos próximos a vencer o vencidos)
      const alertasVencimiento = todosCargosActivos.filter(c => {
        if (!c.fecha_vencimiento) return false
        const fv = new Date(c.fecha_vencimiento)
        const diffDays = Math.ceil((fv - now) / (1000 * 60 * 60 * 24))
        return diffDays <= 3 // Ya venció o vence en 3 días o menos
      }).map(c => {
        const fv = new Date(c.fecha_vencimiento)
        const diffDays = Math.ceil((fv - now) / (1000 * 60 * 60 * 24))
        const cClient = clientes.find(cli => cli.id === c.cliente_id)
        return {
          ...c,
          cliente_nombre: cClient ? cClient.nombre : 'Desconocido',
          diasRestantes: diffDays
        }
      })

      // Días restantes para el vencimiento más próximo (de cargos activos con saldo_usd > 0)
      const diasRestantesPorCliente = {}
      todosCargosActivos.forEach(c => {
        if (c.fecha_vencimiento) {
          const fv = new Date(c.fecha_vencimiento)
          const diffDays = Math.ceil((fv - now) / (1000 * 60 * 60 * 24))
          if (diasRestantesPorCliente[c.cliente_id] === undefined || diffDays < diasRestantesPorCliente[c.cliente_id]) {
            diasRestantesPorCliente[c.cliente_id] = diffDays
          }
        }
      })

      const clientesEnriquecidos = clientes.map(c => ({
        ...c,
        diasSinPago: diasPorCliente[c.id] ?? 0,
        diasRestantes: diasRestantesPorCliente[c.id] !== undefined ? diasRestantesPorCliente[c.id] : null,
        cargosActivos: cargosPendientesPorCliente[c.id] || []
      }))

      // Obtener abonos recientes
      const { data: abonosRaw, error: abonosError } = await supabase
        .from('cuentas_por_cobrar')
        .select(`
          id, cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, creado_en, metodo_pago,
          cliente:clientes(nombre),
          despacho:notas_despacho(numero, cotizacion:cotizaciones(numero))
        `)
        .eq('tipo', 'abono')
        .order('creado_en', { ascending: false })
        .limit(50)

      if (abonosError) throw abonosError

      return {
        kpis: {
          totalDeuda,
          promedioDeuda,
          numClientesConDeuda: clientes.length,
          diasMasAntiguo,
          numCargos: todosCargosActivos.length,
        },
        clientesConDeuda: clientesEnriquecidos,
        aging,
        alertasVencimiento,
        abonos: abonosRaw || []
      }
    },
    enabled: !!perfil,
    retry: 1,
    staleTime: 1000 * 60 * 3,
  })
}

// ─── Registrar abono (pago del cliente, via Worker API) ─────────────────────
export function useRegistrarAbono() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, monto, formaPago, referencia, descripcion, despachoId }) => {
      const res = await authFetch('/api/cxc/abono', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          monto,
          formaPago: formaPago || null,
          referencia: referencia || null,
          descripcion: descripcion || 'Abono recibido',
          despachoId: despachoId || null
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al registrar abono')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: ['despachos'] })
      showToast('Abono registrado exitosamente', 'success')
    },
  })
}

// ─── Revertir abono (Worker API) ─────────────────────────────────────────────
export function useRevertirAbono() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ abonoId }) => {
      const res = await authFetch('/api/cxc/revertir-abono', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abonoId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al revertir abono')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: ['despachos'] })
      showToast('Abono revertido exitosamente', 'success')
    },
  })
}

// ─── Registrar saldo a favor (Worker API) ──────────────────────────────────
export function useRegistrarSaldoFavor() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, monto, formaPago, referencia, descripcion }) => {
      const res = await authFetch('/api/cxc/saldo-favor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          monto,
          formaPago: formaPago || null,
          referencia: referencia || null,
          descripcion: descripcion || 'Saldo a favor registrado'
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al registrar saldo a favor')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      showToast('Saldo a favor registrado exitosamente', 'success')
    },
  })
}

// ─── Registrar devolución de saldo a favor (Worker API) ────────────────────
export function useRegistrarDevolucionCredito() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, monto, formaPago, referencia, descripcion }) => {
      const res = await authFetch('/api/cxc/devolucion-credito', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          monto,
          formaPago,
          referencia: referencia || null,
          descripcion: descripcion || 'Devolución de saldo a favor registrada'
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al registrar devolución de saldo a favor')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      showToast('Devolución de saldo a favor registrada exitosamente', 'success')
    },
  })
}

// ─── Cruzar saldo a favor contra deudas (Worker API) ─────────────────────────
export function useCruzarSaldoFavor() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ clienteId, monto }) => {
      const res = await authFetch('/api/cxc/cruzar-saldo-favor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          monto
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al cruzar saldo a favor')
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CXC_KEY })
      qc.invalidateQueries({ queryKey: CLIENTES_KEY })
      qc.invalidateQueries({ queryKey: ['despachos'] })
      showToast('Saldo cruzado exitosamente', 'success')
    },
  })
}

// ─── Obtener origen de saldo a favor ──────────────────────────────────────────
export function useSaldoFavorOrigen(clienteId) {
  return useQuery({
    queryKey: [...CXC_KEY, 'origen-saldo-favor', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cuentas_por_cobrar')
        .select('forma_pago_abono')
        .eq('cliente_id', clienteId)
        .eq('tipo', 'credito')
        .order('creado_en', { ascending: false })
        .limit(1)

      if (error) throw error
      return data?.[0]?.forma_pago_abono || 'Crédito'
    },
    enabled: !!clienteId,
    staleTime: 1000 * 60 * 5,
  })
}
