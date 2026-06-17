import { json, jsonError, corsHeaders, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator, getOperatorRole, verifySupervisor } from '../lib/auth.js'
import { registrarAuditoria, logToSystem } from '../lib/audit.js'

// ── Save cotización (service key bypasses RLS for cross-vendor clients) ────
export async function handleGuardarCotizacion(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  if (!user.operator_id) return jsonError('No hay operador seleccionado', 400, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, headerData, items } = body;
  if (!headerData || !items || !Array.isArray(items)) return jsonError('Faltan campos', 400, request);

  // Validate items
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.nombre_snap) return jsonError(`Item ${i + 1}: nombre requerido`, 400, request);
    if (typeof it.cantidad !== 'number' || it.cantidad <= 0) return jsonError(`Item ${i + 1}: cantidad debe ser > 0`, 400, request);
    if (typeof it.precio_unit_usd !== 'number' || it.precio_unit_usd < 0) return jsonError(`Item ${i + 1}: precio inválido`, 400, request);
  }

  // Force vendedor_id to authenticated operator
  headerData.vendedor_id = user.operator_id;

  // Estampar canal_venta (interno o externo) — viene del frontend y se preserva para reportes
  if (!['interno', 'externo'].includes(headerData.canal_venta)) {
    headerData.canal_venta = 'interno'
  }

  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  let id = cotizacionId;

  try {
    if (!id) {
      // Create new cotización
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id`, {
        method: 'POST',
        headers: { ...supaHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ ...headerData, estado: 'borrador' }),
      });
      if (!res.ok) {
        const err = await res.text();
        return jsonError(`Error al crear: ${err}`, 500, request);
      }
      const [row] = await res.json();
      id = row.id;
    } else {
      // Verify ownership + supervisor check in parallel
      const [checkRes, isSupervisor] = await Promise.all([
        fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${id}&select=vendedor_id,estado`, {
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
        }),
        verifySupervisor(user.operator_id, env),
      ]);
      if (!checkRes.ok) return jsonError('Error al verificar cotización', 500, request);
      const [existing] = await checkRes.json();
      if (!existing) return jsonError('Cotización no encontrada', 404, request);
      if (existing.vendedor_id !== user.operator_id && !isSupervisor) {
        return jsonError('No tienes permiso para editar esta cotización', 403, request);
      }
      if (existing.estado !== 'borrador') return jsonError('Solo se pueden editar cotizaciones en borrador', 400, request);

      // Update header + delete old items in parallel
      const [updateRes] = await Promise.all([
        fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${id}`, {
          method: 'PATCH', headers: supaHeaders, body: JSON.stringify(headerData),
        }),
        fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${id}`, {
          method: 'DELETE', headers: supaHeaders,
        }),
      ]);
      if (!updateRes.ok) {
        const err = await updateRes.text();
        return jsonError(`Error al actualizar: ${err}`, 500, request);
      }
    }

    // Insert items
    if (items.length > 0) {
      const rows = items.map((it, idx) => ({ ...it, cotizacion_id: id, orden: idx }));
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST',
        headers: supaHeaders,
        body: JSON.stringify(rows),
      });
      if (!res.ok) {
        const err = await res.text();
        return jsonError(`Error al insertar items: ${err}`, 500, request);
      }
    }

    // Auditoría (fire-and-forget — no bloquear respuesta)
    registrarAuditoria(env, supaHeaders, {
      usuarioId: user.operator_id, usuarioNombre: user.operator_nombre || 'Operador', usuarioRol: user.operator_rol || 'vendedor',
      categoria: 'COTIZACION', accion: cotizacionId ? 'EDITAR_COTIZACION' : 'CREAR_COTIZACION',
      descripcion: cotizacionId ? `Cotización ${id} editada` : `Cotización ${id} creada`,
      entidadTipo: 'cotizacion', entidadId: id, meta: { items_count: items.length, cliente_id: headerData.cliente_id },
      ip: request.headers.get('CF-Connecting-IP') || null,
    }).catch(() => {});

    return new Response(JSON.stringify({ id }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  } catch (e) {
    return jsonError(e.message || 'Error interno', 500, request);
  }
}

// ── Reciclar cotización (supervisor: crea borrador desde rechazada/anulada/vencida) ──
export async function handleReciclarCotizacion(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Solo supervisores
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores pueden reciclar cotizaciones', 403, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, vendedorDestinoId } = body;
  if (!cotizacionId || !vendedorDestinoId) return jsonError('Faltan campos: cotizacionId, vendedorDestinoId', 400, request);
  if (!isValidUuid(cotizacionId) || !isValidUuid(vendedorDestinoId)) return jsonError('IDs inválidos', 400, request);

  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    // 1. Obtener cotización original
    const cotRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`,
      { headers: supaHeaders }
    );
    const [cotOrig] = await cotRes.json();
    if (!cotOrig) return jsonError('Cotización no encontrada', 404, request);

    // 2. Validar estado (Removido para permitir reciclar cualquier cotización, ej: aceptada)
    // if (!['rechazada', 'anulada', 'vencida'].includes(cotOrig.estado)) {
    //   return jsonError('Solo se pueden reciclar cotizaciones rechazadas, anuladas o vencidas', 400, request);
    // }

    // 3. Fetch vendedor destino, vendedor original, and supervisor data in parallel
    const [vendRes, vendOrigRes, supRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorDestinoId}&activo=eq.true&select=id,nombre,rol`, { headers: supaHeaders }),
      fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${cotOrig.vendedor_id}&select=nombre`, { headers: supaHeaders }),
      fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.operator_id}&select=nombre,rol`, { headers: supaHeaders }),
    ]);

    const [vendDest] = await vendRes.json();
    if (!vendDest) return jsonError('Vendedor destino no existe o está inactivo', 400, request);

    const [vendOrig] = await vendOrigRes.json();
    const [supData] = await supRes.json();

    // 4. Registrar auditoría ANTES de la mutación
    const numOrigPad = String(cotOrig.numero).padStart(5, '0');

    // 5. Crear nueva cotización borrador
    const nuevaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST',
      headers: { ...supaHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        version: 1,
        cliente_id: cotOrig.cliente_id,
        vendedor_id: vendedorDestinoId,
        transportista_id: cotOrig.transportista_id,
        estado: 'borrador',
        subtotal_usd: cotOrig.subtotal_usd,
        descuento_global_pct: cotOrig.descuento_global_pct,
        descuento_usd: cotOrig.descuento_usd,
        costo_envio_usd: cotOrig.costo_envio_usd,
        total_usd: cotOrig.total_usd,
        notas_cliente: cotOrig.notas_cliente,
        notas_internas: cotOrig.notas_internas,
      }),
    });
    if (!nuevaRes.ok) {
      const err = await nuevaRes.text();
      return jsonError(`Error al crear cotización: ${err}`, 500, request);
    }
    const [nueva] = await nuevaRes.json();

    // 6. Copiar items
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${cotizacionId}&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden`,
      { headers: supaHeaders }
    );
    const items = await itemsRes.json();

    if (items.length > 0) {
      const nuevosItems = items.map(it => ({ ...it, cotizacion_id: nueva.id }));
      const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST',
        headers: supaHeaders,
        body: JSON.stringify(nuevosItems),
      });
      if (!insRes.ok) {
        const err = await insRes.text();
        return jsonError(`Error al copiar items: ${err}`, 500, request);
      }
    }

    // 7. Registrar auditoría (after mutation since we need nueva.numero, but log even if push fails)
    const numNuevoPad = String(nueva.numero).padStart(5, '0');
    const auditRes = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({
        usuario_id: user.operator_id,
        usuario_nombre: supData?.nombre || 'Supervisor',
        usuario_rol: supData?.rol || 'supervisor',
        categoria: 'COTIZACION',
        accion: 'RECICLAR_COTIZACION',
        descripcion: `Cotización COT-${numOrigPad} reciclada → COT-${numNuevoPad}. Vendedor: ${vendOrig?.nombre || '—'} → ${vendDest.nombre}`,
        entidad_tipo: 'cotizacion',
        entidad_id: nueva.id,
        meta: {
          cotizacion_original_id: cotizacionId,
          cotizacion_original_numero: cotOrig.numero,
          estado_original: cotOrig.estado,
          vendedor_origen_id: cotOrig.vendedor_id,
          vendedor_origen_nombre: vendOrig?.nombre || '—',
          vendedor_destino_id: vendedorDestinoId,
          vendedor_destino_nombre: vendDest.nombre,
          total_usd: cotOrig.total_usd,
          nuevo_numero: nueva.numero,
        },
      }),
    });

    if (!auditRes.ok) {
      console.error('Auditoría falló para reciclar cotización:', await auditRes.text().catch(() => ''));
    }

    return new Response(JSON.stringify({
      id: nueva.id,
      numero: nueva.numero,
      vendedorDestino: vendDest.nombre,
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });
  } catch (e) {
    return jsonError(e.message || 'Error interno al reciclar', 500, request);
  }
}

// ── Reabrir cotización para edición (cambiar estado a borrador, sin crear versión) ──
export async function handleReabrirCotizacion(request, env) {
  try {
    const user = await verifyAuth(request, env);
    if (!user?.id) return jsonError('No autenticado', 401, request);
    if (!user.operator_id) return jsonError('No hay operador seleccionado', 400, request);

    let body;
    try { body = await request.json() } catch { return jsonError('JSON inválido', 400, request) }
    const { cotizacionId } = body || {};
    if (!cotizacionId) return jsonError('cotizacionId requerido', 400, request);

    const SB = env.SUPABASE_URL;
    const SK = env.SUPABASE_SERVICE_KEY;
    const hdrs = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };

    // Verificar que la cotización existe y no tiene despacho
    const cotRes = await fetch(`${SB}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=id,estado,vendedor_id`, { headers: hdrs });
    if (!cotRes.ok) {
      const errText = await cotRes.text();
      console.error('[reabrir] Error fetching cotización:', cotRes.status, errText);
      return jsonError('Error al consultar cotización', 500, request);
    }
    const cots = await cotRes.json();
    if (!cots?.length) return jsonError('Cotización no encontrada', 404, request);
    const cot = cots[0];

    if (cot.estado === 'borrador') return json({ ok: true, message: 'Ya es borrador' }, 200, request);
    if (cot.estado === 'anulada') return jsonError('No se puede reabrir una cotización anulada', 400, request);
    if (cot.estado === 'vencida') return jsonError('No se puede reabrir una cotización vencida', 400, request);

    // Verificar que no tiene despacho asociado
    const desRes = await fetch(`${SB}/rest/v1/notas_despacho?cotizacion_id=eq.${cotizacionId}&select=id`, { headers: hdrs });
    if (!desRes.ok) {
      const errText = await desRes.text();
      console.error('[reabrir] Error fetching despachos:', desRes.status, errText);
      return jsonError('Error al consultar despachos', 500, request);
    }
    const despachos = await desRes.json();
    if (despachos?.length > 0) return jsonError('No se puede editar: ya tiene despacho asociado', 400, request);

    // Cambiar estado a borrador
    const patchRes = await fetch(`${SB}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
      method: 'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'borrador' }),
    });
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      console.error('[reabrir] Error PATCH cotización:', patchRes.status, errText);
      return jsonError('Error al reabrir cotización: ' + (errText || patchRes.status), 500, request);
    }

    return json({ ok: true }, 200, request);
  } catch (err) {
    console.error('[reabrir] Unhandled error:', err.message, err.stack);
    return jsonError('Error interno al reabrir: ' + err.message, 500, request);
  }
}

// ── Crear versión de cotización enviada/rechazada (bypass RLS) ──────────────
export async function handleCrearVersion(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  if (!user.operator_id) return jsonError('No hay operador seleccionado', 400, request);

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { cotizacionId, notasCambio } = body;
  if (!cotizacionId) return jsonError('Falta cotizacionId', 400, request);
  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);

  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    // 1. Obtener operador
    const opRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.operator_id}&activo=eq.true&select=id,nombre,rol`,
      { headers: supaHeaders }
    );
    const [operador] = await opRes.json();
    if (!operador) return jsonError('Operador no encontrado o inactivo', 400, request);

    // 2. Obtener cotización original
    const cotRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`,
      { headers: supaHeaders }
    );
    const [cotOrig] = await cotRes.json();
    if (!cotOrig) return jsonError('Cotización no encontrada', 404, request);

    // 3. Validar estado
    if (!['enviada', 'rechazada'].includes(cotOrig.estado)) {
      return jsonError('Solo se pueden versionar cotizaciones enviadas o rechazadas', 400, request);
    }

    // 4. Validar acceso
    if (cotOrig.vendedor_id !== user.operator_id && !['supervisor', 'jefe', 'administracion'].includes(operador.rol)) {
      return jsonError('No tienes permiso para versionar esta cotización', 403, request);
    }

    // 5. Calcular raíz y nueva versión
    const raizId = cotOrig.cotizacion_raiz_id || cotOrig.id;
    const verRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?or=(cotizacion_raiz_id.eq.${raizId},id.eq.${raizId})&select=version`,
      { headers: supaHeaders }
    );
    const versiones = await verRes.json();
    const nuevaVersion = Math.max(...versiones.map(v => v.version || 0)) + 1;

    // 6. Crear nueva cotización borrador
    const nuevaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST',
      headers: { ...supaHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        version: nuevaVersion,
        cotizacion_raiz_id: raizId,
        cliente_id: cotOrig.cliente_id,
        vendedor_id: cotOrig.vendedor_id,
        transportista_id: cotOrig.transportista_id,
        estado: 'borrador',
        notas_cliente: cotOrig.notas_cliente,
        notas_internas: notasCambio || cotOrig.notas_internas,
      }),
    });
    if (!nuevaRes.ok) {
      const err = await nuevaRes.text();
      return jsonError(`Error al crear versión: ${err}`, 500, request);
    }
    const [nueva] = await nuevaRes.json();

    // 7. Copiar items
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${cotizacionId}&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden`,
      { headers: supaHeaders }
    );
    const items = await itemsRes.json();

    if (items.length > 0) {
      const nuevosItems = items.map(it => ({ ...it, cotizacion_id: nueva.id }));
      const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST',
        headers: supaHeaders,
        body: JSON.stringify(nuevosItems),
      });
      if (!insRes.ok) {
        const err = await insRes.text();
        return jsonError(`Error al copiar items: ${err}`, 500, request);
      }
    }

    // 8. Copiar totales
    await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${nueva.id}`, {
      method: 'PATCH',
      headers: { ...supaHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        subtotal_usd: cotOrig.subtotal_usd,
        descuento_global_pct: cotOrig.descuento_global_pct,
        descuento_usd: cotOrig.descuento_usd,
        costo_envio_usd: cotOrig.costo_envio_usd,
        total_usd: cotOrig.total_usd,
      }),
    });

    // 9. Anular la cotización original
    await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
      method: 'PATCH',
      headers: { ...supaHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'anulada', actualizado_en: new Date().toISOString() }),
    });

    // 10. Auditoría
    const numOrigPad = String(cotOrig.numero).padStart(5, '0');
    const numNuevoPad = String(nueva.numero).padStart(5, '0');
    await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({
        usuario_id: user.operator_id,
        usuario_nombre: operador.nombre,
        usuario_rol: operador.rol,
        categoria: 'COTIZACION',
        accion: 'CREAR_VERSION',
        descripcion: `Versión ${nuevaVersion} creada de COT-${numOrigPad} → COT-${numNuevoPad}`,
        entidad_tipo: 'cotizacion',
        entidad_id: nueva.id,
        meta: {
          cotizacion_origen: cotizacionId,
          nueva_version: nuevaVersion,
        },
      }),
    });

    return json({ id: nueva.id, numero: nueva.numero, version: nuevaVersion }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error interno al crear versión', 500, request);
  }
}

// ── Enviar cotización ──
export async function handleEnviarCotizacion(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  let { cotizacionId, tasaBcv } = body;
  if (!cotizacionId) return jsonError('Falta cotizacionId', 400, request);
  if (tasaBcv === undefined || tasaBcv === null) tasaBcv = 0;
  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);

  try {
    // 1. Obtener cotización
    const cotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`, { headers });
    const [cot] = await cotRes.json();
    if (!cot) return jsonError('Cotización no encontrada', 404, request);

    // 2. Validar acceso
    if (cot.vendedor_id !== user.operator_id && !['supervisor', 'jefe', 'administracion'].includes(operador.rol)) {
      return jsonError('No tienes permiso para enviar esta cotización', 403, request);
    }

    // 3. Validar estado
    if (cot.estado !== 'borrador') return jsonError('Solo se pueden enviar cotizaciones en borrador', 400, request);

    // 4. Validar que tenga items
    const itemsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${cotizacionId}&select=id&limit=1`, { headers });
    const items = await itemsRes.json();
    if (!items || items.length === 0) return jsonError('La cotización no tiene productos', 400, request);

    // 5. Actualizar estado
    const tasa = Number(tasaBcv);
    const totalBs = Number(cot.total_usd) * tasa;
    await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        estado: 'enviada',
        enviada_en: new Date().toISOString(),
        tasa_bcv_snapshot: tasa,
        total_bs_snapshot: totalBs,
        actualizado_en: new Date().toISOString(),
      }),
    });

    // 6. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'ENVIAR_COTIZACION',
      entidadTipo: 'cotizacion', entidadId: cotizacionId,
      meta: { tasa_bcv: tasa }, ip,
    });

    return json({ ok: true }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al enviar cotización', 500, request);
  }
}

// ── Venta Rápida: crea cotización aceptada + despacho en un solo paso ───────
export async function handleVentaRapida(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const {
    clienteId, transportistaId, fleteUsd, corteUsd,
    formaPago, formaPagoCliente, referenciaPago,
    notas, notasCliente, items,
    descuentoGlobalPct, costoEnvioUsd, tasaBcv,
    direccionEnvioDireccion, direccionEnvioCiudad, direccionEnvioEstado,
  } = body;

  if (!clienteId) return jsonError('Falta clienteId', 400, request);
  if (!items || !Array.isArray(items) || items.length === 0) return jsonError('Faltan items', 400, request);

  const flete = Math.max(0, Number(fleteUsd) || 0);
  const corte = Math.max(0, Number(corteUsd) || 0);
  const descPct = Math.max(0, Number(descuentoGlobalPct) || 0);
  const envio = Math.max(0, Number(costoEnvioUsd) || 0);

  // Validate items
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.productoId) return jsonError(`Item ${i + 1}: falta productoId`, 400, request);
    if (typeof it.cantidad !== 'number' || it.cantidad <= 0) return jsonError(`Item ${i + 1}: cantidad debe ser > 0`, 400, request);
    if (typeof it.precioUnitUsd !== 'number' || it.precioUnitUsd < 0) return jsonError(`Item ${i + 1}: precio inválido`, 400, request);
  }

  try {
    // 1. Obtener productos para verificar stock y obtener snapshots
    const validProdIds = items.map(i => i.productoId).filter(id => id && id.length === 36 && id.includes('-'));
    let stockMap = {};
    if (validProdIds.length > 0) {
      const prodRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/productos?id=in.(${validProdIds.join(',')})&activo=eq.true&select=id,nombre,codigo,unidad,stock_actual,precio_usd`,
        { headers }
      );
      const productos = await prodRes.json();
      stockMap = Object.fromEntries(productos.map(p => [p.id, p]));
    }

    // Verify products exist (stock se verifica al confirmar entrega)
    for (const item of items) {
      if (item.productoId && item.productoId.length === 36 && item.productoId.includes('-')) {
        const prod = stockMap[item.productoId];
        if (!prod) return jsonError(`Producto no encontrado o inactivo`, 400, request);
      }
    }

    // 2. Calculate totals
    let subtotal = 0;
    const cotItems = items.map((it, idx) => {
      const prod = stockMap[it.productoId];
      const esPrestamo = !!it.es_prestamo;
      const linea = esPrestamo ? 0.0000 : Number(it.precioUnitUsd) * Number(it.cantidad);
      if (!esPrestamo) subtotal += linea;
      return {
        producto_id: prod?.id || null,
        nombre_snap: prod?.nombre || it.nombre || it.nombreSnap || 'Producto sin nombre',
        codigo_snap: it.codigoSnap || prod?.codigo || it.codigo || null,
        unidad_snap: prod?.unidad || it.unidad || it.unidadSnap || 'und',
        origen:      prod?.id ? 'inventario' : 'externo',
        cantidad:    Number(it.cantidad),
        precio_unit_usd: Number(it.precioUnitUsd),
        descuento_pct: it.descuentoPct || 0,
        total_linea_usd: Number(linea),
        orden: idx,
        es_prestamo: esPrestamo
      };
    });

    const descMonto = subtotal * (descPct / 100);
    const subtotalDesc = subtotal - descMonto;
    const totalUsd = subtotalDesc + envio + flete + corte;

    // 3. Create cotización in estado 'aceptada'
    const cotBody = {
      cliente_id: clienteId,
      vendedor_id: user.operator_id,
      estado: 'aceptada',
      subtotal_usd: subtotal,
      descuento_global_pct: descPct,
      descuento_usd: descMonto,
      costo_envio_usd: flete,
      corte_usd: corte,
      total_usd: totalUsd,
      tasa_bcv_snapshot: tasaBcv || null,
      total_bs_snapshot: tasaBcv ? totalUsd * tasaBcv : null,
      notas_cliente: notasCliente || null,
      notas_internas: notas || null,
      transportista_id: transportistaId || null,
      enviada_en: new Date().toISOString(),
    };
    console.log('[VR] Creating cotización:', JSON.stringify(cotBody));
    const cotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(cotBody),
    });
    if (!cotRes.ok) {
      const err = await cotRes.text();
      console.error('[VR] Cotización error:', err);
      return jsonError(`Error al crear cotización: ${err}`, 500, request);
    }
    const [cot] = await cotRes.json();
    console.log('[VR] Cotización created:', cot?.id, cot?.numero);

    // 4. Insert cotización items (omitir es_prestamo ya que la tabla cotizacion_items no posee esta columna)
    const ciRows = cotItems.map(it => {
      const { es_prestamo, ...rest } = it;
      return { ...rest, cotizacion_id: cot.id };
    });
    console.log('[VR] Inserting items:', ciRows.length);
    const ciRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
      method: 'POST', headers,
      body: JSON.stringify(ciRows),
    });
    if (!ciRes.ok) {
      const err = await ciRes.text();
      console.error('[VR] Items error:', err);
      return jsonError(`Error al insertar items: ${err}`, 500, request);
    }

    // 5. Stock se descuenta al confirmar entrega por logística

    // 6. Create nota de despacho
    const despRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?select=id,numero`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cotizacion_id: cot.id,
        numero: cot.numero,
        cliente_id: clienteId,
        vendedor_id: user.operator_id,
        transportista_id: transportistaId || null,
        estado: 'pendiente',
        total_usd: totalUsd,
        flete_usd: flete,
        corte_usd: corte,
        notas: notas || null,
        forma_pago: formaPago || null,
        forma_pago_cliente: formaPagoCliente || formaPago || null,
        referencia_pago: referenciaPago || null,
        creado_por: user.operator_id,
        direccion_envio_direccion: direccionEnvioDireccion || null,
        direccion_envio_ciudad:    direccionEnvioCiudad || null,
        direccion_envio_estado:    direccionEnvioEstado || null,
      }),
    });
    if (!despRes.ok) {
      const err = await despRes.text();
      console.error('[VR] Despacho error:', err);
      return jsonError(`Error al crear despacho: ${err}`, 500, request);
    }
    const [despacho] = await despRes.json();
    console.log('[VR] Despacho created:', despacho?.id, despacho?.numero);

    // ── Copiar ítems de la cotización al despacho (snapshot inicial) ──────────
    const despItems = cotItems.map((item, i) => ({
      despacho_id:       despacho.id,
      producto_id:       item.producto_id || null,
      codigo_snap:       item.codigo_snap || null,
      nombre_snap:       item.nombre_snap,
      unidad_snap:       item.unidad_snap || 'und',
      origen:            item.origen,
      cantidad_original: Number(item.cantidad),
      precio_original:   Number(item.precio_unit_usd),
      cantidad:          Number(item.cantidad),
      precio_unit_usd:   Number(item.precio_unit_usd),
      descuento_pct:     Number(item.descuento_pct || 0),
      total_linea_usd:   Number(item.total_linea_usd),
      orden:             item.orden ?? i,
      es_prestamo:       item.es_prestamo || false
    }));

    const diRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho_items`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(despItems),
    });
    if (!diRes.ok) {
      const err = await diRes.text();
      console.error('[VR] Despacho items error:', err);
      return jsonError(`Error al insertar ítems del despacho: ${err}`, 500, request);
    }

    // 7. CxC se registra al confirmar entrega (handleActualizarEstadoDespacho)

    // 8. Comisión se calcula al confirmar entrega por logística

    // 9. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'COTIZACION', accion: 'VENTA_RAPIDA',
        descripcion: `Venta rápida: cotización #${cot.numero} + despacho #${despacho.numero}`,
        entidadTipo: 'nota_despacho', entidadId: despacho.id,
        meta: { cotizacion_id: cot.id, total_usd: totalUsd, items_count: items.length }, ip,
      });
    } catch (auditErr) {
      console.error('[VR] Auditoría falló:', auditErr.message);
    }

    return json({ id: despacho.id, numero: despacho.numero, cotizacionId: cot.id }, 200, request);
  } catch (e) {
    console.error('[VR] Uncaught error:', e.message, e.stack);
    return jsonError(e.message || 'Error al crear venta rápida', 500, request);
  }
}

// ── runCleanupCotizaciones (Cron Job diario de limpieza) ──
export async function runCleanupCotizaciones(env) {
  const now = new Date();
  
  // Calcular fechas límite usando el tiempo actual del servidor
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const supaHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };

  const results = {
    success: true,
    anuladas: 0,
    eliminadas: 0,
    errors: []
  };

  try {
    // 1. ANULAR: Cotizaciones > 15 días en estado 'borrador' o 'enviada'
    const cancelRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?creado_en=lt.${fifteenDaysAgo}&estado=in.(borrador,enviada)`,
      {
        method: 'PATCH',
        headers: supaHeaders,
        body: JSON.stringify({
          estado: 'anulada',
          actualizado_en: now.toISOString()
        })
      }
    );

    if (!cancelRes.ok) {
      const errText = await cancelRes.text();
      results.errors.push(`Error al anular cotizaciones: ${errText}`);
      console.error('[CRON CLEANUP] Error al anular:', errText);
    } else {
      const cancelledRows = await cancelRes.json();
      results.anuladas = Array.isArray(cancelledRows) ? cancelledRows.length : 0;
    }

    // 2. ELIMINAR: Cotizaciones > 30 días en estados inactivos o no confirmados
    // NOTA: 'aceptada' NUNCA se elimina para proteger integridad referencial (notas_despacho, comisiones, etc)
    const deleteRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizaciones?creado_en=lt.${thirtyDaysAgo}&estado=in.(borrador,enviada,rechazada,anulada,vencida)`,
      {
        method: 'DELETE',
        headers: supaHeaders
      }
    );

    if (!deleteRes.ok) {
      const errText = await deleteRes.text();
      results.errors.push(`Error al eliminar cotizaciones: ${errText}`);
      console.error('[CRON CLEANUP] Error al eliminar:', errText);
    } else {
      const deletedRows = await deleteRes.json();
      results.eliminadas = Array.isArray(deletedRows) ? deletedRows.length : 0;
    }

    // 3. Registrar Log en el sistema
    await logToSystem(env, {
      nivel: results.errors.length > 0 ? 'warning' : 'info',
      origen: 'worker-cron',
      categoria: 'SISTEMA',
      mensaje: `Limpieza automática de cotizaciones completada. Anuladas (>15 días): ${results.anuladas}. Eliminadas (>30 días): ${results.eliminadas}.`,
      meta: {
        cutoff_15_days: fifteenDaysAgo,
        cutoff_30_days: thirtyDaysAgo,
        anuladas_count: results.anuladas,
        eliminadas_count: results.eliminadas,
        errors: results.errors
      }
    });

  } catch (err) {
    results.success = false;
    results.errors.push(err.message);
    console.error('[CRON CLEANUP ERROR]:', err.message);
    
    await logToSystem(env, {
      nivel: 'error',
      origen: 'worker-cron',
      categoria: 'SISTEMA',
      mensaje: `Error fatal en la limpieza automática de cotizaciones: ${err.message}`,
      stack: err.stack?.slice(0, 3000),
      meta: { error: err.message }
    });
  }

  return results;
}
