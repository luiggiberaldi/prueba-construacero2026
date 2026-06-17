// src/hooks/useVentaRapida.js
// Mutation para crear venta rápida (cotización + despacho atómico)
import { useMutation, useQueryClient } from '@tanstack/react-query'
import supabase from '../services/supabase/client'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import useAuthStore from '../store/useAuthStore'
import { DESPACHOS_KEY } from './useDespachos'
import { INVENTARIO_KEY } from './useInventario'
import { COTIZACIONES_KEY } from './useCotizaciones'
import { COMISIONES_KEY } from './useComisiones'
import { STOCK_COMPROMETIDO_KEY } from './useStockComprometido'
import { CXC_KEY } from './useCuentasCobrar'
import { showToast } from '../components/ui/Toast'
import { sendPushNotification } from './usePushNotifications'
import { notifyClienteAjeno, notifyDespachoClienteAjeno, notifyDespachoCreado } from '../services/notificationService'
import { enqueue } from '../lib/mutationQueue'

export function useVentaRapida() {
  const qc = useQueryClient()
  const perfil = useAuthStore.getState().perfil
  const rol = perfil?.rol

  return useMutation({
    mutationFn: async ({
      clienteId, clienteNombre, transportistaId, fleteUsd, corteUsd,
      formaPago, formaPagoCliente, referenciaPago,
      notas, notasCliente, items, costoEnvioUsd, tasaBcv,
    }) => {
      const payload = {
        clienteId, transportistaId: transportistaId || null,
        fleteUsd: Number(fleteUsd) || 0,
        corteUsd: Number(corteUsd) || 0,
        formaPago, formaPagoCliente: formaPagoCliente || null,
        referenciaPago: referenciaPago || null,
        notas: notas || null, notasCliente: notasCliente || null,
        items, descuentoGlobalPct: 0,
        costoEnvioUsd: Number(costoEnvioUsd) || 0,
        tasaBcv,
      }

      // ─── Intento online ────────────────────────────────────────────────────
      let res, result
      try {
        const headers = await getAuthHeaders()
        res = await fetch(apiUrl('/api/ventas-rapidas/crear'), {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })
        result = await res.json()
      } catch (netErr) {
        // Error de red (fetch lanzó excepción) → encolar offline
        await enqueue('VENTA_RAPIDA', payload)

        // Intentar registrar Background Sync (fallback: 'online' event en useMutationQueue)
        if ('serviceWorker' in navigator) {
          try {
            const reg = await navigator.serviceWorker.ready
            if ('SyncManager' in window) await reg.sync.register('sync-mutations')
          } catch { /* ignorar */ }
        }

        // Señal especial para onSuccess — no es un error, es una venta encolada
        return { _queued: true, clienteNombre }
      }

      if (!res.ok) throw new Error(result.error || 'Error al crear venta rápida')

      // Verificar si el cliente es ajeno
      let esClienteAjeno = false
      let clienteVendedorNombre = null
      if (clienteId) {
        try {
          const session = (await supabase.auth.getSession()).data.session
          const cRes = await fetch(apiUrl('/api/clientes/lookup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
            body: JSON.stringify({ ids: [clienteId] }),
          })
          if (cRes.ok) {
            const cData = await cRes.json()
            const clienteVendedorId = cData?.[0]?.vendedor_id
            clienteVendedorNombre = cData?.[0]?.vendedor?.nombre || null
            esClienteAjeno = clienteVendedorId && perfil?.id && clienteVendedorId !== perfil.id
          }
        } catch { /* ignore */ }
      }

      return { ...result, clienteNombre, esClienteAjeno, clienteVendedorNombre }
    },
    onSuccess: async ({ id, numero, clienteNombre, esClienteAjeno, clienteVendedorNombre, _queued }, variables) => {
      // ─── Caso offline: venta encolada (stock NO se descuenta localmente) ──
      if (_queued) {
        showToast(
          '📦 Sin conexión — venta guardada. Se enviará al reconectar. El stock se descontará al sincronizar.',
          'warning',
          8000,
        )
        return
      }

      // ─── Caso online: venta confirmada ────────────────────────────────────
      // Guard: si no hay ID, algo falló en la persistencia real (evitar Ghost Toast)
      if (!id) return

      let esCod = false
      try {
        const fp = typeof variables?.formaPago === 'string' ? JSON.parse(variables.formaPago) : (variables?.formaPago || [])
        if (Array.isArray(fp)) {
          esCod = fp.some(f => f.metodo === 'Cobro a destino')
        }
      } catch {}

      await qc.cancelQueries({ queryKey: DESPACHOS_KEY })
      await qc.cancelQueries({ queryKey: COTIZACIONES_KEY })
      qc.invalidateQueries({ queryKey: DESPACHOS_KEY, exact: false })
      qc.invalidateQueries({ queryKey: INVENTARIO_KEY, exact: false })
      qc.invalidateQueries({ queryKey: COMISIONES_KEY, exact: false })
      qc.invalidateQueries({ queryKey: COTIZACIONES_KEY, exact: false })
      qc.invalidateQueries({ queryKey: STOCK_COMPROMETIDO_KEY })
      qc.invalidateQueries({ queryKey: CXC_KEY })
      showToast(`Venta rápida #${numero ?? '—'} creada`, 'success')
      const displayNum = String(numero || '').padStart(5, '0')
      notifyDespachoCreado(displayNum, clienteNombre || 'cliente', perfil?.nombre || 'vendedor', rol, perfil?.id, esCod)
      sendPushNotification({
        title: `Venta Rápida Creada${esCod ? ' [COD]' : ''}`,
        message: `Despacho #${numero ?? '—'} — ${clienteNombre ?? 'cliente'}${esCod ? ' (Cobro a Destino)' : ''}`,
        tag: `venta-rapida-${numero}`,
        url: '/despachos',
        targetRole: 'supervisor,administracion,jefe',
      })
      if (esClienteAjeno) {
        const vendedorNombre = perfil?.nombre || 'vendedor'
        notifyClienteAjeno({ tipo: 'venta_rapida', numero: String(numero).padStart(5, '0'), vendedorNombre, clienteNombre, vendedorDueño: clienteVendedorNombre || 'otro vendedor', currentRole: rol })
        notifyDespachoClienteAjeno({ numero: String(numero).padStart(5, '0'), vendedorNombre, clienteNombre, vendedorDueño: clienteVendedorNombre || 'otro vendedor', currentRole: rol })
        sendPushNotification({
          title: 'Venta rápida con cliente ajeno',
          message: `${vendedorNombre} vendió a "${clienteNombre}" (de ${clienteVendedorNombre || 'otro vendedor'}) — VR-${numero}`,
          tag: `cliente-ajeno-vr-${numero}`,
          url: '/despachos',
          targetRole: 'supervisor',
        })
      }
    },
    onError: (err) => {
      showToast(err.message || 'Error al crear venta rápida', 'error')
    },
  })
}
