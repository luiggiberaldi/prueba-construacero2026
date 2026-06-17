// worker.js
// Cloudflare Worker — sirve assets estáticos + API proxy para operaciones admin
// Las operaciones admin (crear/editar/eliminar usuarios) se manejan aquí
// para mantener el service_role key fuera del frontend.

import { 
  json, jsonError, sanitizeSearch, isValidEmail, isValidUuid, 
  corsHeaders, getAllowedOrigin, isRateLimited,
  ALLOWED_ORIGINS, rateLimitMap, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, EMAIL_RE, UUID_RE 
} from './api/lib/utils.js'

import { hashPinPBKDF2, verifyPinPBKDF2, generateSalt } from './api/lib/crypto.js'
import { verifyAuth, getOperatorRole, verifySupervisor, verifyPrivileged, validateOperator, supaServiceHeaders, SUPER_ADMIN_UUID } from './api/lib/auth.js'
import { groqFetch, groqCounters } from './api/lib/groq.js'
import { logToSystem, registrarAuditoria } from './api/lib/audit.js'
import { sendWebPush } from './api/lib/webpush.js'
import { handleListarClientes, handleCheckRif, handleClientesLookup, handleReasignarCliente, handleReasignarClientesBulk, handleCrearCliente, handleActualizarCliente, handleBorrarCliente, handleActivarCliente, handleGetPrestamosCliente, handleDevolverPrestamo, handleFacturarPrestamo } from './api/handlers/clientes.js'
import { handlePush } from './api/handlers/push.js'
import { handleLogFromClient, handleGetLogs, handleGetLogStats, handleDownloadLogs, handleAnalyzeLogs, handlePurgeLogs } from './api/handlers/logs.js'
import { handleGetAudit, handleGetAuditStats, handleAnalyzeAudit } from './api/handlers/audit.js'
import { handleMarcarComisionPagada, handleActualizarEstadoComision, handleGetComisionesConfig, handleGetComisiones, handleGetComisionesResumen } from './api/handlers/comisiones.js'
import { handleRegistrarAbono, handleRevertirAbono, handleRegistrarSaldoFavor, handleCruzarSaldoFavor, handleRegistrarDevolucionCredito } from './api/handlers/cxc.js'
import { handleSwitchOperator, handleClearOperator, handleGetOperators, handleSuperAdmin } from './api/handlers/auth-operators.js'
import { handleBuscarProductosHibrido, handleSyncEmbeddings, handleParseMaterialText, handleScanMaterialList, handleAplicarMovimientoLote, handleBatchIngest, handleTransformacionInventario, handleBatchPriceUpdate, handleClearInventory, handlePdfTemp } from './api/handlers/inventario.js'
import { handleGuardarCotizacion, handleReciclarCotizacion, handleReabrirCotizacion, handleCrearVersion, handleEnviarCotizacion, handleVentaRapida, runCleanupCotizaciones } from './api/handlers/cotizaciones.js'
import { handleCrearDespacho, handleActualizarEstadoDespacho, handleEditarItemsDespacho, handleReciclarDespacho, handleGuardarDescuentos, handleObtenerDescuentos, handleEditarPagoDespacho, handleDevolucionParcialDespacho } from './api/handlers/despachos.js'
import { handleDevTools } from './api/handlers/dev.js'
import { handleAdmin, handleBackup, handleRestore, handleSaveConfig, handleGetConfig, handleResetOperacional, handleTesterClearAll, handleTesterSeedDemo, handleTesterStressSeed, handleCrearTransportista, handleActualizarTransportista } from './api/handlers/admin.js'
import { handleGetSeguimiento, handleCrearSeguimiento, handleActualizarSeguimiento, handleBorrarSeguimiento, runPurgeTrackingImages } from './api/handlers/seguimiento.js'
import {
  handleListarProveedores,
  handleCheckRifProveedor,
  handleCrearProveedor,
  handleActualizarProveedor,
  handleBorrarProveedor,
  handleGetCuentasPorPagar,
  handleRegistrarTransaccionCxP,
  handleActualizarTransaccionCxP
} from './api/handlers/proveedores.js'


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight para requests cross-origin ────
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { headers: corsHeaders(request) });
    }

    // ── API routes (wrapped in error logging) ────
    if (url.pathname.startsWith('/api/')) {
      try {

    // ── API: recibir log del frontend ─────────────────────────────────────
    if (url.pathname === '/api/logs' && request.method === 'POST') {
      return handleLogFromClient(request, env);
    }

    // ── API: ping (verificación de conectividad real desde el frontend) ───
    if (url.pathname === '/api/ping') {
      return new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', ...corsHeaders(request) },
      });
    }

    // ── API: leer configuración del negocio ─────────────────────────────
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return handleGetConfig(request, env);
    }

    // ── API: leer configuración de comisiones ───────────────────────────
    if (url.pathname === '/api/comisiones/config' && request.method === 'GET') {
      return handleGetComisionesConfig(request, env);
    }

    // ── API: listar todos los clientes (bypass RLS para vendedores) ───────
    if (url.pathname === '/api/clientes' && request.method === 'GET') {
      return handleListarClientes(request, env);
    }

    // ── API: check if RIF/cédula already exists ─────────────────────────────
    if (url.pathname === '/api/clientes/check-rif' && request.method === 'GET') {
      return handleCheckRif(request, env);
    }

    // ── API: lookup clientes por IDs (bypass RLS para vendedores) ──────────
    if (url.pathname === '/api/clientes/lookup' && request.method === 'POST') {
      return handleClientesLookup(request, env);
    }

    // ── API: obtener préstamos del cliente ────────────────────────────────
    if (url.pathname === '/api/clientes/prestamos' && request.method === 'GET') {
      return handleGetPrestamosCliente(request, env);
    }

    // ── API: registrar devolución de préstamo ─────────────────────────────
    if (url.pathname === '/api/clientes/prestamos/devolver' && request.method === 'POST') {
      return handleDevolverPrestamo(request, env);
    }

    // ── API: facturar préstamo (convertir a venta) ────────────────────────
    if (url.pathname === '/api/clientes/prestamos/facturar' && request.method === 'POST') {
      return handleFacturarPrestamo(request, env);
    }

    // ── API: guardar cotización (bypass RLS para clientes ajenos) ─────────
    if (url.pathname === '/api/cotizaciones/guardar' && request.method === 'POST') {
      return handleGuardarCotizacion(request, env);
    }

    // ── API: reciclar cotización (supervisor: crea borrador desde rechazada/anulada/vencida) ──
    if (url.pathname === '/api/cotizaciones/reciclar' && request.method === 'POST') {
      return handleReciclarCotizacion(request, env);
    }

    // ── API: crear versión de cotización enviada (bypass RLS) ──────────────
    if (url.pathname === '/api/cotizaciones/crear-version' && request.method === 'POST') {
      return handleCrearVersion(request, env);
    }

    // ── API: reabrir cotización para edición (cambiar estado a borrador) ──
    if (url.pathname === '/api/cotizaciones/reabrir' && request.method === 'POST') {
      return handleReabrirCotizacion(request, env);
    }

    // ── API: enviar cotización (bypass RLS) ─────────────────────────────────
    if (url.pathname === '/api/cotizaciones/enviar' && request.method === 'POST') {
      return handleEnviarCotizacion(request, env);
    }

    // ── API: crear nota de despacho (bypass RLS) ────────────────────────────
    if (url.pathname === '/api/despachos/crear' && request.method === 'POST') {
      return handleCrearDespacho(request, env);
    }

    // ── API: parsear texto de WhatsApp → materiales ─────────────────────────
    if (url.pathname === '/api/parse-material-text' && request.method === 'POST') {
      return handleParseMaterialText(request, env);
    }

    // ── API: escanear fotografía de lista de materiales ─────────────────────
    if (url.pathname === '/api/scan-material-list' && request.method === 'POST') {
      return handleScanMaterialList(request, env);
    }

    // ── API: Búsqueda híbrida de productos ──────────────────────────────────
    if (url.pathname === '/api/productos/buscar' && request.method === 'POST') {
      return handleBuscarProductosHibrido(request, env);
    }

    // ── API: Actualización masiva de precios ────────────────────────────────
    if (url.pathname === '/api/productos/batch-price' && request.method === 'PATCH') {
      return handleBatchPriceUpdate(request, env);
    }

    // ── API: Sincronizar embeddings de productos (admin) ────────────────────
    if (url.pathname === '/api/admin/sync-embeddings' && request.method === 'POST') {
      return handleSyncEmbeddings(request, env);
    }

    // ── API: venta rápida (cotización + despacho atómico) ──────────────────
    if (url.pathname === '/api/ventas-rapidas/crear' && request.method === 'POST') {
      return handleVentaRapida(request, env);
    }

    // ── API: actualizar estado de despacho (bypass RLS) ─────────────────────
    if (url.pathname === '/api/despachos/estado' && request.method === 'POST') {
      return handleActualizarEstadoDespacho(request, env);
    }

    // ── API: editar items de un despacho (administracion) ───────────────────
    if (url.pathname === '/api/despachos/editar-items' && request.method === 'POST') {
      return handleEditarItemsDespacho(request, env);
    }

    // ── API: reciclar despacho anulado (bypass RLS) ─────────────────────────
    if (url.pathname === '/api/despachos/reciclar' && request.method === 'POST') {
      return handleReciclarDespacho(request, env);
    }

    // ── API: guardar descuentos de despacho (administración/desarrollador) ─
    if (url.pathname === '/api/despachos/descuentos' && request.method === 'POST') {
      return handleGuardarDescuentos(request, env);
    }

    // ── API: editar forma de pago del despacho ──────────────────────────
    if (url.pathname === '/api/despachos/editar-pago' && request.method === 'POST') {
      return handleEditarPagoDespacho(request, env);
    }

    // ── API: devolución parcial de despacho (administracion/logistica) ────
    if (url.pathname === '/api/despachos/devolucion-parcial' && request.method === 'POST') {
      return handleDevolucionParcialDespacho(request, env);
    }

    // ── API: obtener descuentos de un despacho ────────────────────────────
    if (url.pathname.startsWith('/api/despachos/') && url.pathname.endsWith('/descuentos') && request.method === 'GET') {
      return handleObtenerDescuentos(request, env, url);
    }

    // ── API: reasignar cliente (bypass RLS) ─────────────────────────────────
    if (url.pathname === '/api/clientes/reasignar' && request.method === 'POST') {
      return handleReasignarCliente(request, env);
    }

    // ── API: reasignar TODOS los clientes de un vendedor (bulk) ─────────────
    if (url.pathname === '/api/clientes/reasignar-bulk' && request.method === 'POST') {
      return handleReasignarClientesBulk(request, env);
    }

    // ── API: borrar cliente (con validación de niveles) ──────────────────────
    if (url.pathname === '/api/clientes/borrar' && request.method === 'POST') {
      return handleBorrarCliente(request, env);
    }

    // ── API: activar cliente ───────────────────────────────────────────────
    if (url.pathname === '/api/clientes/activar' && request.method === 'POST') {
      return handleActivarCliente(request, env);
    }

    // ── API: crear cliente (bypass RLS) ────────────────────────────────────
    if (url.pathname === '/api/clientes/crear' && request.method === 'POST') {
      return handleCrearCliente(request, env);
    }

    // ── API: actualizar cliente (bypass RLS) ───────────────────────────────
    if (url.pathname === '/api/clientes/actualizar' && request.method === 'POST') {
      return handleActualizarCliente(request, env);
    }

    // ── API: Proveedores ───────────────────────────────────────────────────
    if (url.pathname === '/api/proveedores' && request.method === 'GET') {
      return handleListarProveedores(request, env);
    }
    if (url.pathname === '/api/proveedores/check-rif' && request.method === 'GET') {
      return handleCheckRifProveedor(request, env);
    }
    if (url.pathname === '/api/proveedores' && request.method === 'POST') {
      return handleCrearProveedor(request, env);
    }
    if (url.pathname === '/api/proveedores' && request.method === 'PUT') {
      return handleActualizarProveedor(request, env);
    }
    if (url.pathname === '/api/proveedores' && request.method === 'DELETE') {
      return handleBorrarProveedor(request, env);
    }
    if (url.pathname === '/api/cuentas-por-pagar' && request.method === 'GET') {
      return handleGetCuentasPorPagar(request, env);
    }
    if (url.pathname === '/api/cuentas-por-pagar' && request.method === 'POST') {
      return handleRegistrarTransaccionCxP(request, env);
    }
    if (url.pathname === '/api/cuentas-por-pagar' && request.method === 'PUT') {
      return handleActualizarTransaccionCxP(request, env);
    }

    // ── API: registrar abono CxC (bypass RLS) ──────────────────────────────
    if (url.pathname === '/api/cxc/abono' && request.method === 'POST') {
      return handleRegistrarAbono(request, env);
    }

    // ── API: revertir abono CxC (bypass RLS) ──────────────────────────────
    if (url.pathname === '/api/cxc/revertir-abono' && request.method === 'POST') {
      return handleRevertirAbono(request, env);
    }

    // ── API: registrar saldo a favor CxC (bypass RLS) ──────────────────────
    if (url.pathname === '/api/cxc/saldo-favor' && request.method === 'POST') {
      return handleRegistrarSaldoFavor(request, env);
    }

    // ── API: cruzar saldo a favor CxC (bypass RLS) ─────────────────────────
    if (url.pathname === '/api/cxc/cruzar-saldo-favor' && request.method === 'POST') {
      return handleCruzarSaldoFavor(request, env);
    }

    // ── API: registrar devolución de crédito / saldo a favor ─────────────
    if (url.pathname === '/api/cxc/devolucion-credito' && request.method === 'POST') {
      return handleRegistrarDevolucionCredito(request, env);
    }

    // ── API: crear transportista (bypass RLS) ───────────────────────────────
    if (url.pathname === '/api/transportistas/crear' && request.method === 'POST') {
      return handleCrearTransportista(request, env);
    }

    // ── API: actualizar transportista (bypass RLS) ────────────────────────────
    if (url.pathname === '/api/transportistas/actualizar' && request.method === 'POST') {
      return handleActualizarTransportista(request, env);
    }

    // ── API: obtener lista de comisiones (bypass RLS) ──────────────────────
    if (url.pathname === '/api/comisiones/lista' && request.method === 'GET') {
      return handleGetComisiones(request, env);
    }

    // ── API: obtener resumen de comisiones (bypass RLS) ────────────────────
    if (url.pathname === '/api/comisiones/resumen' && request.method === 'GET') {
      return handleGetComisionesResumen(request, env);
    }

    // ── API: marcar comisión pagada (bypass RLS) ────────────────────────────
    if (url.pathname === '/api/comisiones/pagar' && request.method === 'POST') {
      return handleMarcarComisionPagada(request, env);
    }

    if (url.pathname === '/api/comisiones/estado' && request.method === 'POST') {
      return handleActualizarEstadoComision(request, env);
    }

    // ── API: aplicar movimiento de inventario (bypass RLS) ──────────────────
    if (url.pathname === '/api/inventario/movimiento' && request.method === 'POST') {
      return handleAplicarMovimientoLote(request, env);
    }

    // ── API: ingreso masivo por lote (bypass RLS) ───────────────────────────
    if (url.pathname === '/api/inventario/batch-ingest' && request.method === 'POST') {
      return handleBatchIngest(request, env);
    }

    // ── API: transformación de inventario (admin) ──────────────────────────
    if (url.pathname === '/api/inventario/transformacion' && request.method === 'POST') {
      return handleTransformacionInventario(request, env);
    }

    // ── API: admin logs (CRUD + análisis AI) ──────────────────────────────
    if (url.pathname === '/api/admin/logs' && request.method === 'GET') {
      return handleGetLogs(request, env, url);
    }
    if (url.pathname === '/api/admin/logs/stats' && request.method === 'GET') {
      return handleGetLogStats(request, env);
    }
    if (url.pathname === '/api/admin/logs/download' && request.method === 'GET') {
      return handleDownloadLogs(request, env);
    }
    if (url.pathname === '/api/admin/logs/analyze' && request.method === 'POST') {
      return handleAnalyzeLogs(request, env);
    }
    if (url.pathname === '/api/admin/logs/purge' && request.method === 'DELETE') {
      return handlePurgeLogs(request, env);
    }

    // ── API: Auditoría completa ──────────────────────────────────────────
    if (url.pathname === '/api/admin/audit' && request.method === 'GET') {
      return handleGetAudit(request, env, url);
    }
    if (url.pathname === '/api/admin/audit/stats' && request.method === 'GET') {
      return handleGetAuditStats(request, env);
    }
    if (url.pathname === '/api/admin/audit/analyze' && request.method === 'POST') {
      return handleAnalyzeAudit(request, env);
    }

    // ── API: backup completo del sistema ───────────────────────────────────
    if (url.pathname === '/api/admin/backup' && request.method === 'GET') {
      return handleBackup(request, env);
    }
    if (url.pathname === '/api/admin/restore' && request.method === 'POST') {
      return handleRestore(request, env);
    }
    if (url.pathname === '/api/admin/clear-inventory' && request.method === 'DELETE') {
      return handleClearInventory(request, env);
    }
    if (url.pathname === '/api/admin/factory-reset' && request.method === 'DELETE') {
      return handleTesterClearAll(request, env);
    }
    if (url.pathname === '/api/admin/reset-operacional' && request.method === 'DELETE') {
      return handleResetOperacional(request, env);
    }

    // ── API: guardar configuración (bypass RLS) ──────────────────────────
    if (url.pathname === '/api/admin/config' && request.method === 'PUT') {
      return handleSaveConfig(request, env);
    }

    // ── API: tester (seed demo + stress) ─────────────────────────────────
    if (url.pathname === '/api/admin/tester/seed-demo' && request.method === 'POST') {
      return handleTesterSeedDemo(request, env);
    }
    if (url.pathname === '/api/admin/tester/stress-seed' && request.method === 'POST') {
      return handleTesterStressSeed(request, env);
    }
    if (url.pathname === '/api/admin/tester/clear-all' && request.method === 'DELETE') {
      return handleTesterClearAll(request, env);
    }

    // ── API: switch/clear operator (auth con PIN) ────────────────────────
    if (url.pathname === '/api/auth/switch-operator' && request.method === 'POST') {
      return handleSwitchOperator(request, env);
    }
    if (url.pathname === '/api/auth/clear-operator' && request.method === 'POST') {
      return handleClearOperator(request, env);
    }
    if (url.pathname === '/api/auth/operators' && request.method === 'GET') {
      return handleGetOperators(request, env);
    }
    if (url.pathname === '/api/auth/super-admin' && request.method === 'POST') {
      return handleSuperAdmin(request, env);
    }

    // ── API: subir PDF temporal (para WhatsApp) ─────────────────────────
    if (url.pathname === '/api/pdf-temp' && request.method === 'POST') {
      return handlePdfTemp(request, env);
    }

    // ── API: seguimiento operativo ──────────────────────────────────────────
    if (url.pathname === '/api/seguimiento' && request.method === 'GET') {
      return handleGetSeguimiento(request, env);
    }
    if (url.pathname === '/api/seguimiento/crear' && request.method === 'POST') {
      return handleCrearSeguimiento(request, env);
    }
    if (url.pathname === '/api/seguimiento/actualizar' && request.method === 'PATCH') {
      return handleActualizarSeguimiento(request, env);
    }
    if (url.pathname === '/api/seguimiento/borrar' && request.method === 'DELETE') {
      return handleBorrarSeguimiento(request, env);
    }

    // ── API: dev tools (solo desarrollador) ─────────────────────────────
    if (url.pathname.startsWith('/api/dev/')) {
      return handleDevTools(request, env, url);
    }

    // ── API routes para operaciones admin ──────────────────────────────────
    if (url.pathname.startsWith('/api/admin/')) {
      return handleAdmin(request, env, url);
    }

    // ── API routes para push notifications ────────────────────────────────
    if (url.pathname.startsWith('/api/push/')) {
      return handlePush(request, env, url);
    }

    // API route not found
    return jsonError('Ruta API no encontrada', 404, request);

      } catch (e) {
        // Log unhandled API errors to system_logs
        console.error(`[API ERROR] ${request.method} ${url.pathname}:`, e.message, e.stack)
        const user = await verifyAuth(request, env).catch(() => null)
        await logToSystem(env, {
          nivel: 'error',
          origen: 'worker',
          categoria: 'SISTEMA',
          mensaje: `Unhandled: ${e.message}`,
          stack: e.stack?.slice(0, 3000),
          endpoint: `${request.method} ${url.pathname}`,
          usuario_id: user?.operator_id || user?.id || null,
          usuario_nombre: user?.app_metadata?.operator_nombre || user?.email || null,
          meta: { method: request.method, pathname: url.pathname },
        })
        return jsonError('Error interno del servidor', 500, request)
      }
    }

    // ── Security headers para assets estáticos ─────────────────────────────
    const response = await env.ASSETS.fetch(request);

    // SPA fallback: si el asset no existe y no es un archivo estático,
    // servir index.html para que React Router maneje la ruta
    if (response.status === 404) {
      const ext = url.pathname.split('.').pop()
      const isStaticFile = ['js', 'css', 'png', 'jpg', 'jpeg', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'webp', 'gif', 'map'].includes(ext)
      if (!isStaticFile) {
        const fallback = await env.ASSETS.fetch(new Request(new URL('/', url.origin), request))
        const fbHeaders = new Headers(fallback.headers)
        fbHeaders.set('X-Content-Type-Options', 'nosniff')
        fbHeaders.set('X-Frame-Options', 'DENY')
        fbHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin')
        fbHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        fbHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
        fbHeaders.set('Pragma', 'no-cache')
        return new Response(fallback.body, {
          status: 200,
          statusText: 'OK',
          headers: fbHeaders,
        })
      }
    }

    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('X-Frame-Options', 'DENY');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // index.html y sw.js no deben cachearse para que el browser siempre cargue la versión actualizada
    const isHtml = response.headers.get('content-type')?.includes('text/html')
      || url.pathname === '/' || !url.pathname.includes('.')
    const isSW = url.pathname === '/sw.js'
    if (isHtml || isSW) {
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      newHeaders.set('Pragma', 'no-cache')
    } else {
      // Versioned assets (Vite hashed filenames) → immutable 1 year cache
      const isVersionedAsset = /\/assets\/.*-[a-zA-Z0-9]{8,}\.(js|css|woff2?|png|jpg|webp|ico)$/i.test(url.pathname)
      if (isVersionedAsset) {
        newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable')
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([
        runPurgeTrackingImages(env),
        runCleanupCotizaciones(env)
      ]).then(results => {
        results.forEach((res, idx) => {
          const cronName = idx === 0 ? 'PURGE_IMAGES' : 'CLEANUP_COTIZACIONES';
          if (res.status === 'fulfilled') {
            console.log(`[CRON ${cronName}] Completado con éxito:`, res.value);
          } else {
            console.error(`[CRON ${cronName}] Falló con error:`, res.reason);
          }
        });
      })
    );
  },
};
// Hot-reload trigger: picking up es_prestamo fix in cotizaciones.js
