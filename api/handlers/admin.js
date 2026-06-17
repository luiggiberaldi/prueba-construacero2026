// api/handlers/admin.js
import { json, jsonError, corsHeaders, isValidUuid, isRateLimited } from '../lib/utils.js'
import { verifyAuth, verifySupervisor, verifyPrivileged, supaServiceHeaders, SUPER_ADMIN_UUID, validateOperator } from '../lib/auth.js'
import { hashPinPBKDF2, verifyPinPBKDF2, generateSalt } from '../lib/crypto.js'
import { registrarAuditoria, logToSystem } from '../lib/audit.js'

export async function handleAdmin(request, env, url) {
  // Solo POST/PUT/DELETE
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) {
    return jsonError('Method not allowed', 405, request);
  }

  // Verificar que las secrets estén configuradas
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError('Server misconfigured: missing Supabase secrets', 500, request);
  }

  // Rate limiting on admin endpoints
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  
  if (isRateLimited(ip)) {
    return jsonError('Demasiadas solicitudes. Intenta en un minuto.', 429, request);
  }

  // Autenticar usuario
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Verificar que es supervisor (usa operator_id del JWT app_metadata)
  const isSupervisor = await verifySupervisor(user.operator_id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  // Parsear body
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const route = url.pathname.replace('/api/admin/', '');

  // ── Crear usuario (solo en tabla usuarios, sin auth.users) ───────────
  if (route === 'users' && request.method === 'POST') {
    const { nombre, rol, pin, color, telefono, es_externo } = body;
    if (!nombre || !rol || !pin) {
      return jsonError('Faltan campos: nombre, rol, pin', 400, request);
    }

    // Validate rol
    if (!['supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion', 'logistica', 'desarrollador', 'jefe'].includes(rol)) {
      return jsonError('Rol inválido: debe ser supervisor, vendedor, vendedor_sin_comision, administracion, logistica, desarrollador o jefe', 400, request);
    }

    // Validate PIN length
    const pinLen = (rol === 'vendedor' || rol === 'vendedor_sin_comision') ? 4 : 6;
    if (!/^\d+$/.test(pin) || pin.length !== pinLen) {
      return jsonError(`El PIN debe ser exactamente ${pinLen} dígitos numéricos`, 400, request);
    }

    // Hash PIN with PBKDF2
    const salt = generateSalt();
    const hash = await hashPinPBKDF2(pin, salt);
    const newId = crypto.randomUUID();

    // Insertar en public.usuarios
    const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: newId,
        nombre: nombre.trim(),
        rol,
        activo: true,
        pin_hash: hash,
        pin_salt: salt,
        cuenta_id: user.id,
        es_externo: !!es_externo,
        ...(color ? { color } : {}),
        ...(telefono ? { telefono: telefono.trim() } : {}),
      }),
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      return jsonError('Error al crear usuario: ' + errText, 500, request);
    }

    // Auditoría
    try {
      await registrarAuditoria(env, { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }, {
        usuarioId: user.operator_id || user.id, usuarioNombre: user.operator_nombre || 'Supervisor', usuarioRol: user.operator_rol || 'supervisor',
        categoria: 'USUARIO', accion: 'CREAR_USUARIO', descripcion: `Usuario "${nombre.trim()}" creado con rol ${rol}`,
        entidadTipo: 'usuario', entidadId: newId, meta: { nombre: nombre.trim(), rol, color }, ip,
      });
    } catch {}

    return json({ id: newId, ok: true }, 201, request);
  }

  // ── Actualizar usuario (nombre, rol, PIN, color) ──────────────────────
  if (route.startsWith('users/') && request.method === 'PUT') {
    const userId = route.replace('users/', '');
    if (!isValidUuid(userId)) return jsonError('ID de usuario inválido', 400, request);
    const { nombre, rol, pin, color, telefono, markup_pct, comision_pct, comision_pct_cabilla, es_externo } = body;

    // Validate rol if provided
    if (rol && !['supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion', 'logistica', 'desarrollador', 'jefe'].includes(rol)) {
      return jsonError('Rol inválido', 400, request);
    }

    // Build update data
    const updateData = {};
    if (nombre) updateData.nombre = nombre.trim();
    if (rol) updateData.rol = rol;
    if (color !== undefined) updateData.color = color;
    if (telefono !== undefined) updateData.telefono = telefono ? telefono.trim() : null;
    if ('es_externo' in body) updateData.es_externo = !!es_externo;
    // Campos de vendedor externo — null los limpia explícitamente (quitar markup)
    if ('markup_pct' in body) updateData.markup_pct = markup_pct != null && markup_pct !== '' ? Number(markup_pct) : null;
    if ('comision_pct' in body) updateData.comision_pct = comision_pct != null && comision_pct !== '' ? Number(comision_pct) : null;
    if ('comision_pct_cabilla' in body) updateData.comision_pct_cabilla = comision_pct_cabilla != null && comision_pct_cabilla !== '' ? Number(comision_pct_cabilla) : null;

    // Hash new PIN if provided
    if (pin) {
      const pinLen = (rol === 'vendedor' || rol === 'vendedor_sin_comision' || (rol || 'vendedor') === 'vendedor') ? 4 : 6;
      if (!/^\d+$/.test(pin) || pin.length !== pinLen) {
        return jsonError(`El PIN debe ser exactamente ${pinLen} dígitos numéricos`, 400, request);
      }
      const salt = generateSalt();
      const hash = await hashPinPBKDF2(pin, salt);
      updateData.pin_hash = hash;
      updateData.pin_salt = salt;
    }

    if (Object.keys(updateData).length > 0) {
      const dbRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(updateData),
        }
      );
      if (!dbRes.ok) {
        const dbErr = await dbRes.text();
        console.error('[WORKER] Error actualizando usuario:', dbErr);
        return jsonError(`Error al actualizar usuario: ${dbErr}`, 500, request);
      }
    }

    // Auditoría
    try {
      await registrarAuditoria(env, { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }, {
        usuarioId: user.operator_id || user.id, usuarioNombre: user.operator_nombre || 'Supervisor', usuarioRol: user.operator_rol || 'supervisor',
        categoria: 'USUARIO', accion: 'EDITAR_USUARIO', descripcion: `Usuario ${userId} actualizado`,
        entidadTipo: 'usuario', entidadId: userId, meta: { campos_actualizados: Object.keys(updateData), rol: updateData.rol, nombre: updateData.nombre }, ip,
      });
    } catch {}

    return json({ ok: true }, 200, request);
  }

  // ── Eliminar usuario (solo de tabla usuarios, sin auth) ──────────────
  if (route.startsWith('users/') && request.method === 'DELETE') {
    const userId = route.replace('users/', '');
    if (!isValidUuid(userId)) return jsonError('ID de usuario inválido', 400, request);
    if (userId === SUPER_ADMIN_UUID) return jsonError('No se puede eliminar al super admin', 403, request);

    // Eliminar de public.usuarios
    const dbRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}`,
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=minimal',
        },
      }
    );

    if (!dbRes.ok) return jsonError('Error al eliminar usuario', 500, request);

    // Auditoría
    try {
      await registrarAuditoria(env, { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }, {
        usuarioId: user.operator_id || user.id, usuarioNombre: user.operator_nombre || 'Supervisor', usuarioRol: user.operator_rol || 'supervisor',
        categoria: 'USUARIO', accion: 'ELIMINAR_USUARIO', descripcion: `Usuario ${userId} eliminado`,
        entidadTipo: 'usuario', entidadId: userId, ip,
      });
    } catch {}

    return json({ ok: true }, 200, request);
  }

  return jsonError('Ruta no encontrada', 404, request);
}

export async function handleBackup(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError('Server misconfigured', 500, request);
  }

  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const isSupervisor = await verifySupervisor(user.operator_id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };

  const errors = [];

  async function fetchTable(tabla, query = '') {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabla}?limit=100000${query}`, { headers: h });
    if (!res.ok) {
      errors.push(`Error al leer ${tabla}: ${res.status}`);
      return [];
    }
    return res.json();
  }

  const [
    productos,
    clientes,
    cotizaciones,
    cotizacion_items,
    notas_despacho,
    transportistas,
    usuarios,
    configuracion_negocio,
    auditoria,
  ] = await Promise.all([
    fetchTable('productos', '&order=codigo.asc'),
    fetchTable('clientes', '&order=nombre.asc'),
    fetchTable('cotizaciones', '&order=numero.asc'),
    fetchTable('cotizacion_items', '&order=cotizacion_id.asc,orden.asc'),
    fetchTable('notas_despacho', '&order=numero.asc'),
    fetchTable('transportistas', '&order=nombre.asc'),
    fetchTable('usuarios', '&order=nombre.asc'),
    fetchTable('configuracion_negocio'),
    fetchTable('auditoria', '&order=ts.desc&limit=5000'),
  ]);

  // If any table failed to load, warn in the backup
  const negocio = configuracion_negocio?.[0]?.nombre_negocio || 'sistema';

  const backup = {
    version: '1.0',
    generado_en: new Date().toISOString(),
    negocio,
    errores: errors.length > 0 ? errors : undefined,
    tablas: {
      productos,
      clientes,
      cotizaciones,
      cotizacion_items,
      notas_despacho,
      transportistas,
      usuarios,
      configuracion_negocio,
      auditoria,
    },
    resumen: {
      productos: productos.length,
      clientes: clientes.length,
      cotizaciones: cotizaciones.length,
      notas_despacho: notas_despacho.length,
      transportistas: transportistas.length,
      usuarios: usuarios.length,
    },
  };

  if (errors.length > 0) {
    backup.advertencia = `Backup incompleto: ${errors.length} tabla(s) con errores`;
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const filename = `backup-${negocio.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${fecha}.json`;

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...corsHeaders(request),
      ...(errors.length > 0 ? { 'X-Backup-Warnings': errors.join('; ') } : {}),
    },
  });
}

export async function handleRestore(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError('Server misconfigured', 500, request);
  }

  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const isSupervisor = await verifySupervisor(user.operator_id, env);
  if (!isSupervisor) return jsonError('Acceso denegado: solo supervisores', 403, request);

  let backup;
  try {
    backup = await request.json();
  } catch {
    return jsonError('Archivo inválido: no es un JSON válido', 400, request);
  }

  if (!backup?.tablas) {
    return jsonError('Archivo inválido: no parece un backup del sistema', 400, request);
  }

  // Validate expected tables (solo las fundamentales)
  const expectedTables = ['productos'];
  const missingTables = expectedTables.filter(t => !backup.tablas[t]);
  if (missingTables.length > 0) {
    return jsonError(`Backup incompleto: faltan tablas ${missingTables.join(', ')}`, 400, request);
  }

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  };

  // Tablas a restaurar en orden (respetando FK)
  const TABLAS_RESTORE = [
    'configuracion_negocio',
    'transportistas',
    'productos',
    'clientes',
    'cotizaciones',
    'cotizacion_items',
    'notas_despacho',
  ];

  const resumen = {};
  const errores = [];

  for (const tabla of TABLAS_RESTORE) {
    const filas = backup.tablas[tabla];
    if (!Array.isArray(filas) || filas.length === 0) {
      resumen[tabla] = 0;
      continue;
    }

    // Upsert en lotes de 500
    let restaurados = 0;
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500);
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabla}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(lote),
      });
      if (res.ok) {
        restaurados += lote.length;
      } else {
        const errText = await res.text().catch(() => 'unknown');
        errores.push(`${tabla} lote ${i}-${i + lote.length}: ${errText}`);
      }
    }
    resumen[tabla] = restaurados;
  }

  return json({
    ok: errores.length === 0,
    resumen,
    errores: errores.length > 0 ? errores : undefined,
    advertencia: errores.length > 0 ? `Restore parcial: ${errores.length} lote(s) fallaron` : undefined,
  }, 200, request);
}

async function getExistingColumns(env, cuentaId) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${cuentaId}&limit=1`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return Object.keys(data[0]);
      }
    }
  } catch (e) {
    console.error("Error detecting configuracion_negocio columns:", e);
  }
  return [];
}

export async function handleSaveConfig(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const ROLES_CONFIG = ['supervisor', 'jefe', 'administracion', 'desarrollador']
  const rol = user.operator_rol
  if (!rol || !ROLES_CONFIG.includes(rol)) {
    // Fallback: si el JWT no tiene operator_rol aún, verificar via DB
    const isPriv = await verifyPrivileged(user.operator_id, env)
    if (!isPriv) return jsonError('Solo supervisores o administración', 403, request)
  }

  const campos = await request.json();
  const existingColumns = await getExistingColumns(env, user.id);

  // Filtrar campos para enviar solo los que existen en la BD
  const datosGuardar = { cuenta_id: user.id };
  for (const [key, val] of Object.entries(campos)) {
    if (existingColumns.length === 0 || existingColumns.includes(key)) {
      datosGuardar[key] = val;
    }
  }

  // Si falló la detección de columnas y la lista está vacía, removemos preventivamente campos problemáticos
  if (existingColumns.length === 0) {
    delete datosGuardar.markup_pct_externo;
    delete datosGuardar.comision_ext_pct_cabilla;
    delete datosGuardar.comision_ext_pct_otros;
    delete datosGuardar.comision_ext_pct_externos;
    delete datosGuardar._comision_ext_extras;
    delete datosGuardar.nota_entrega_plantilla;
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?on_conflict=cuenta_id`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(datosGuardar),
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonError(text || `Error ${res.status}`, res.status, request);
  }

  // Auditoría
  try {
    await registrarAuditoria(env, { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }, {
      usuarioId: user.operator_id || user.id, usuarioNombre: user.operator_nombre || 'Supervisor', usuarioRol: user.operator_rol || 'supervisor',
      categoria: 'CONFIG', accion: 'GUARDAR_CONFIG', descripcion: `Configuración del negocio actualizada`,
      entidadTipo: 'configuracion', entidadId: '1', meta: { campos: Object.keys(datosGuardar) },
      ip: request.headers.get('CF-Connecting-IP') || null,
    });
  } catch {}

  return json({ ok: true }, 200, request);
}

export async function handleGetConfig(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Hacemos select=* para traer todas las columnas que existan dinámicamente sin fallar
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });

  if (!res.ok) return jsonError('Error al leer configuración', res.status, request);
  const rows = await res.json();
  const config = rows[0] || {};
  
  // Por seguridad, quitamos el hash de la contraseña del gate antes de enviarla
  delete config.gate_password_hash;
  
  return json(config, 200, request);
}

export async function handleResetOperacional(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  const start = Date.now();
  const log = [];
  function logStep(msg) { log.push({ ts: Date.now() - start, msg }) }

  logStep('=== RESET OPERACIONAL — Inicio ===');
  logStep(`Usuario: ${user.id}`);

  try {
    // Intentar vía RPC factory_reset_operacional (hace deletes por tenant)
    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/factory_reset_operacional`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ p_cuenta_id: user.id }),
    });

    if (rpcRes.ok) {
      const rpcData = await rpcRes.json().catch(() => ({}));
      const elapsed = Date.now() - start;
      logStep(`✓ RPC factory_reset_operacional OK en ${elapsed}ms`);
      return json({ ok: true, elapsed_ms: elapsed, correlativo_inicio: 200, log }, 200, request);
    }

    // Fallback: borrar manualmente vía PostgREST (service_role, sin RPC)
    logStep(`RPC no disponible (HTTP ${rpcRes.status}), usando borrado manual...`);

    logStep('Eliminando comisiones...');
    await supaDelete(env, 'comisiones', user.id, logStep);
    logStep('Eliminando cuentas_por_cobrar...');
    await supaDelete(env, 'cuentas_por_cobrar', user.id, logStep);
    logStep('Eliminando notas_despacho_items...');
    await supaDelete(env, 'notas_despacho_items', user.id, logStep);
    logStep('Eliminando notas_despacho...');
    await supaDelete(env, 'notas_despacho', user.id, logStep);
    logStep('Eliminando cotizacion_items...');
    await supaDelete(env, 'cotizacion_items', user.id, logStep);
    logStep('Eliminando cotizaciones...');
    await supaDelete(env, 'cotizaciones', user.id, logStep);
    logStep('Eliminando inventario_movimientos...');
    await supaDelete(env, 'inventario_movimientos', user.id, logStep);
    logStep('Eliminando auditoria...');
    await supaDelete(env, 'auditoria', user.id, logStep);
    // system_logs usa usuario_id
    logStep('Eliminando system_logs...');
    await supaDelete(env, 'system_logs', user.id, logStep);
    logStep('Clientes, transportistas e inventario conservados.');

    const elapsed = Date.now() - start;
    logStep(`✓ Borrado manual completado en ${elapsed}ms`);
    return json({ ok: true, elapsed_ms: elapsed, correlativo_inicio: null, warning: 'Sequences no reiniciadas — aplica migración 067', log }, 200, request);
  } catch (e) {
    logStep(`✗ ERROR: ${e.message}`);
    return json({ ok: false, error: e.message, log }, 500, request);
  }
}

export async function handleTesterClearAll(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  const start = Date.now();
  const log = [];
  function logStep(msg) { log.push({ ts: Date.now() - start, msg }) }

  logStep('=== CLEAR ALL — Inicio ===');
  logStep(`Usuario: ${user.id}`);
  logStep(`Supabase URL: ${env.SUPABASE_URL}`);

  try {
    // Orden por dependencias FK: primero las tablas hijas
    logStep('Eliminando cuentas_por_cobrar...');
    await supaDelete(env, 'cuentas_por_cobrar', user.id, logStep);
    logStep('Eliminando comisiones...');
    await supaDelete(env, 'comisiones', user.id, logStep);
    logStep('Eliminando notas_despacho...');
    await supaDelete(env, 'notas_despacho', user.id, logStep);
    logStep('Eliminando cotizacion_items...');
    await supaDelete(env, 'cotizacion_items', user.id, logStep);
    logStep('Eliminando cotizaciones...');
    await supaDelete(env, 'cotizaciones', user.id, logStep);
    logStep('Eliminando clientes...');
    await supaDelete(env, 'clientes', user.id, logStep);
    logStep('Eliminando transportistas...');
    await supaDelete(env, 'transportistas', user.id, logStep);
    logStep('Eliminando inventario_movimientos (kardex)...');
    await supaDelete(env, 'inventario_movimientos', user.id, logStep);
    logStep('Eliminando reasignaciones...');
    await supaDelete(env, 'reasignaciones', user.id, logStep);
    logStep('Eliminando auditoria...');
    await supaDelete(env, 'auditoria', user.id, logStep);
    logStep('Eliminando system_logs...');
    await supaDelete(env, 'system_logs', user.id, logStep);
    logStep('Inventario, usuarios y configuración conservados.');

    // Reiniciar correlativos (COT-00001, despacho #1)
    logStep('Reiniciando correlativos...');
    const seqRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/reiniciar_correlativos`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    logStep(`  Correlativos: HTTP ${seqRes.status}`);

    const elapsed = Date.now() - start;
    logStep(`✓ Limpieza completada en ${elapsed}ms`);
    return json({ ok: true, elapsed_ms: elapsed, log }, 200, request);
  } catch (e) {
    logStep(`✗ ERROR: ${e.message}`);
    return json({ ok: false, error: e.message, log }, 500, request);
  }
}

export async function handleTesterSeedDemo(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  const start = Date.now();
  const log = [];
  function logStep(msg) { log.push({ ts: Date.now() - start, msg }) }

  try {
    logStep('=== SEED DEMO — Inicio ===');
    logStep(`Usuario autenticado: ${user.id}`);
    logStep(`Supabase URL: ${env.SUPABASE_URL}`);
    logStep(`Fecha/hora: ${new Date().toISOString()}`);

    // Limpiar
    logStep('--- Fase 1: Limpieza de tablas ---');
    await supaDelete(env, 'comisiones', user.id, logStep);
    await supaDelete(env, 'notas_despacho', user.id, logStep);
    await supaDelete(env, 'cotizacion_items', user.id, logStep);
    await supaDelete(env, 'cotizaciones', user.id, logStep);
    await supaDelete(env, 'clientes', user.id, logStep);
    await supaDelete(env, 'transportistas', user.id, logStep);
    await supaDelete(env, 'productos', user.id, logStep);
    logStep('✓ Limpieza completada');

    // Usuarios
    logStep('--- Fase 2: Consultar usuarios activos ---');
    const t0Users = Date.now();
    const usuarios = await supaQuery(env, 'usuarios', '?select=id,nombre,rol&activo=eq.true');
    logStep(`  GET usuarios: ${usuarios.length} encontrados (${Date.now() - t0Users}ms)`);
    for (const u of usuarios) logStep(`    → ${u.rol}: ${u.nombre} (${u.id.substring(0, 8)}...)`);
    const supervisor = usuarios.find(u => u.rol === 'supervisor');
    const vendedor = usuarios.find(u => u.rol === 'vendedor');
    if (!supervisor) {
      logStep('✗ ERROR: No hay supervisor activo en la tabla usuarios');
      return json({ ok: false, error: 'No hay supervisor activo', log }, 400, request);
    }
    const vendedorId = vendedor?.id ?? supervisor.id;
    logStep(`  Supervisor: ${supervisor.nombre} | Vendedor: ${vendedor?.nombre ?? 'N/A (usando supervisor)'}`);

    // Config
    logStep('--- Fase 3: Actualizar configuración de negocio ---');
    const t0Cfg = Date.now();
    const cfgRes = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?id=eq.1`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        nombre_negocio: 'Construacero Carabobo C.A.',
        rif_negocio: 'J-41256789-3',
        telefono_negocio: '0241-8675432',
        direccion_negocio: 'Av. Bolívar Norte, C.C. La Granja, Local 12, Valencia, Carabobo',
        email_negocio: 'ventas@construacero.com.ve',
        pie_pagina_pdf: 'Precios en USD. Sujetos a cambio sin previo aviso.',
      }),
    });
    logStep(`  PATCH configuracion_negocio: HTTP ${cfgRes.status} (${Date.now() - t0Cfg}ms)`);

    // Productos
    logStep('--- Fase 4: Insertar productos (21) ---');
    const productos = [
      { codigo: 'CEM-001', nombre: 'Cemento Gris Tipo I 42.5kg',        categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 5.50,  costo_usd: 4.20,  stock_actual: 250,  stock_minimo: 50 },
      { codigo: 'CEM-002', nombre: 'Cemento Blanco 1kg',                 categoria: 'Cemento',      unidad: 'kg',    precio_usd: 2.80,  costo_usd: 2.10,  stock_actual: 80,   stock_minimo: 20 },
      { codigo: 'CEM-003', nombre: 'Mortero Premezclado 40kg',           categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 4.50,  costo_usd: 3.40,  stock_actual: 120,  stock_minimo: 30 },
      { codigo: 'CEM-004', nombre: 'Arena Lavada (saco 40kg)',           categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 2.00,  costo_usd: 1.30,  stock_actual: 180,  stock_minimo: 40 },
      { codigo: 'CEM-005', nombre: 'Piedra Picada Nro. 2 (saco 40kg)',  categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 2.50,  costo_usd: 1.60,  stock_actual: 150,  stock_minimo: 30 },
      { codigo: 'PIN-001', nombre: 'Pintura Caucho Int. Blanco Glaciar 4L', categoria: 'Pintura',   unidad: 'und',   precio_usd: 18.00, costo_usd: 13.50, stock_actual: 45,   stock_minimo: 10 },
      { codigo: 'PIN-002', nombre: 'Pintura Caucho Ext. Blanco Hueso 4L',   categoria: 'Pintura',   unidad: 'und',   precio_usd: 22.00, costo_usd: 16.80, stock_actual: 30,   stock_minimo: 8 },
      { codigo: 'PIN-003', nombre: 'Esmalte Brillante Rojo 1L',             categoria: 'Pintura',   unidad: 'und',   precio_usd: 8.50,  costo_usd: 6.20,  stock_actual: 25,   stock_minimo: 5 },
      { codigo: 'PIN-004', nombre: 'Impermeabilizante Acrílico 4L',         categoria: 'Pintura',   unidad: 'und',   precio_usd: 28.00, costo_usd: 21.00, stock_actual: 15,   stock_minimo: 5 },
      { codigo: 'PIN-005', nombre: 'Rodillo de Felpa 9" con Mango',         categoria: 'Pintura',   unidad: 'und',   precio_usd: 4.50,  costo_usd: 2.80,  stock_actual: 60,   stock_minimo: 15 },
      { codigo: 'ELE-001', nombre: 'Cable THHN 12AWG Rojo (rollo 100m)',  categoria: 'Electricidad', unidad: 'rollo', precio_usd: 35.00, costo_usd: 26.00, stock_actual: 18,  stock_minimo: 5 },
      { codigo: 'ELE-002', nombre: 'Interruptor Sencillo 15A Blanco',     categoria: 'Electricidad', unidad: 'und',   precio_usd: 2.50,  costo_usd: 1.50,  stock_actual: 80,  stock_minimo: 20 },
      { codigo: 'ELE-003', nombre: 'Toma Corriente Doble 15A',            categoria: 'Electricidad', unidad: 'und',   precio_usd: 3.00,  costo_usd: 1.80,  stock_actual: 65,  stock_minimo: 15 },
      { codigo: 'ELE-004', nombre: 'Breaker 1x20A Riel DIN',              categoria: 'Electricidad', unidad: 'und',   precio_usd: 6.50,  costo_usd: 4.20,  stock_actual: 30,  stock_minimo: 8 },
      { codigo: 'ELE-005', nombre: 'Bombillo LED 12W Luz Blanca E27',     categoria: 'Electricidad', unidad: 'und',   precio_usd: 2.00,  costo_usd: 1.10,  stock_actual: 120, stock_minimo: 30 },
      { codigo: 'PLO-001', nombre: 'Tubo PVC 1/2" x 3m Presión',       categoria: 'Plomería',     unidad: 'und',   precio_usd: 3.50,  costo_usd: 2.30,  stock_actual: 60,   stock_minimo: 15 },
      { codigo: 'PLO-002', nombre: 'Tubo PVC 4" x 3m Drenaje',         categoria: 'Plomería',     unidad: 'und',   precio_usd: 8.00,  costo_usd: 5.80,  stock_actual: 25,   stock_minimo: 8 },
      { codigo: 'PLO-003', nombre: 'Codo PVC 1/2" x 90°',              categoria: 'Plomería',     unidad: 'und',   precio_usd: 0.40,  costo_usd: 0.20,  stock_actual: 200,  stock_minimo: 50 },
      { codigo: 'PLO-004', nombre: 'Llave de Paso 1/2" Bronce',        categoria: 'Plomería',     unidad: 'und',   precio_usd: 5.50,  costo_usd: 3.80,  stock_actual: 20,   stock_minimo: 5 },
      { codigo: 'PLO-005', nombre: 'Teflón Industrial 3/4" x 10m',     categoria: 'Plomería',     unidad: 'und',   precio_usd: 0.80,  costo_usd: 0.40,  stock_actual: 150,  stock_minimo: 40 },
      { codigo: 'FIJ-001', nombre: 'Tornillo Drywall 6x1" (caja 100)', categoria: 'Fijación',     unidad: 'caja',  precio_usd: 3.00,  costo_usd: 1.80,  stock_actual: 40,   stock_minimo: 10 },
    ];
    const prodsCreados = await supaBatch(env, 'productos', productos, 500, logStep);
    logStep(`✓ ${prodsCreados.length} productos creados`);

    // Transportistas
    logStep('--- Fase 5: Insertar transportistas (4) ---');
    const transportistas = [
      { nombre: 'TransVenCarga Express', rif: 'J-30456789-1', telefono: '0241-4561234', zona_cobertura: 'Valencia / Carabobo', tarifa_base: 8.00, notas: 'Entrega mismo día en Valencia', creado_por: supervisor.id },
      { nombre: 'MRW Encomiendas', rif: 'J-00359741-6', telefono: '0800-679-0000', zona_cobertura: 'Nacional', tarifa_base: 12.00, notas: 'Cobertura nacional, 2-3 días', creado_por: supervisor.id },
      { nombre: 'Zoom Envíos', rif: 'J-29871456-2', telefono: '0800-966-6000', zona_cobertura: 'Nacional', tarifa_base: 10.00, notas: 'Envíos puerta a puerta', creado_por: supervisor.id },
      { nombre: 'Fletes Rodríguez', rif: 'V-18456321', telefono: '0414-4123456', zona_cobertura: 'Carabobo / Aragua / Cojedes', tarifa_base: 15.00, notas: 'Camión 350 para materiales pesados', creado_por: supervisor.id },
    ];
    const transCreados = await supaBatch(env, 'transportistas', transportistas, 500, logStep);
    logStep(`✓ ${transCreados.length} transportistas creados`);

    // Clientes
    logStep('--- Fase 6: Insertar clientes (13) ---');
    const clientes = [
      { nombre: 'Ferretería Don Pedro', rif_cedula: 'J-41023456-7', telefono: '0241-8234567', email: 'donpedro@gmail.com', direccion: 'Av. Lara, C.C. Roma, Local 5, Valencia', tipo_cliente: 'ferreteria', vendedor_id: supervisor.id, notas: 'Cliente mayorista.' },
      { nombre: 'Constructora Bolívar 2020 C.A.', rif_cedula: 'J-50234567-8', telefono: '0241-8345678', email: 'compras@constructorabolivar.com', direccion: 'Zona Industrial Castillito, Galpón 15, San Diego', tipo_cliente: 'constructor', vendedor_id: supervisor.id, notas: 'Obras en curso.' },
      { nombre: 'Inversiones Martínez & Hijos', rif_cedula: 'J-40567890-1', telefono: '0414-4234567', email: 'martinez@hotmail.com', direccion: 'Urb. Prebo, Av. 98, Casa 12, Valencia', tipo_cliente: 'empresa', vendedor_id: supervisor.id, notas: 'Pago a 15 días.' },
      { nombre: 'Carlos Mendoza', rif_cedula: 'V-18456789', telefono: '0424-4567890', email: null, direccion: 'Sector San José, Naguanagua', tipo_cliente: 'particular', vendedor_id: supervisor.id, notas: 'Remodelación.' },
      { nombre: 'Ferretería La Esquina', rif_cedula: 'J-41234567-0', telefono: '0241-8567890', email: 'laesquina@gmail.com', direccion: 'Av. Cedeño, Nro. 78, Valencia', tipo_cliente: 'ferreteria', vendedor_id: supervisor.id, notas: 'Artículos eléctricos.' },
      { nombre: 'María González', rif_cedula: 'V-20345678', telefono: '0412-4678901', email: 'mariag78@gmail.com', direccion: 'Res. Las Acacias, Torre B, Apto 4-C, Valencia', tipo_cliente: 'particular', vendedor_id: supervisor.id },
      { nombre: 'Corporación SAMCA', rif_cedula: 'J-30987654-3', telefono: '0241-8901234', email: 'compras@samca.com.ve', direccion: 'Zona Industrial Municipal Norte, Valencia', tipo_cliente: 'empresa', vendedor_id: supervisor.id, notas: 'Mantenimiento industrial.' },
      { nombre: 'José Ramírez', rif_cedula: 'V-19876543', telefono: '0414-4789012', email: null, direccion: 'Barrio Unión, Guacara', tipo_cliente: 'particular', vendedor_id: vendedorId, notas: 'Autoconstrucción.' },
      { nombre: 'Construcciones Orinoco C.A.', rif_cedula: 'J-41567890-2', telefono: '0241-8012345', email: 'orinoco@gmail.com', direccion: 'Av. Universidad, Edif. Orinoco, Valencia', tipo_cliente: 'constructor', vendedor_id: vendedorId, notas: 'Obra: Parque del Este.' },
      { nombre: 'Ferretería El Tornillo Feliz', rif_cedula: 'J-50456789-5', telefono: '0241-8123456', email: 'eltornillofeliz@hotmail.com', direccion: 'C.C. Paseo Las Industrias, Valencia', tipo_cliente: 'ferreteria', vendedor_id: vendedorId, notas: 'Reventa quincenal.' },
      { nombre: 'Ana Lucía Pérez', rif_cedula: 'V-21456789', telefono: '0424-4890123', email: 'analucia@gmail.com', direccion: 'Urb. Trigal Norte, Valencia', tipo_cliente: 'particular', vendedor_id: vendedorId },
      { nombre: 'Soluciones Eléctricas VLC', rif_cedula: 'J-41890123-4', telefono: '0412-4901234', email: 'soluciones.electricas@gmail.com', direccion: 'Av. Bolívar Sur, C.C. Cosmos, Valencia', tipo_cliente: 'empresa', vendedor_id: vendedorId, notas: 'Cables por volumen.' },
      { nombre: 'Pedro Hernández', rif_cedula: 'V-15678901', telefono: '0416-6012345', email: null, direccion: 'Sector La Isabelica, Valencia', tipo_cliente: 'particular', vendedor_id: vendedorId, notas: 'Plomero independiente.' },
    ];
    const clientesCreados = await supaBatch(env, 'clientes', clientes, 500, logStep);
    logStep(`✓ ${clientesCreados.length} clientes creados`);

    // Cotizaciones con items
    logStep('--- Fase 7: Insertar cotizaciones (6) ---');
    const ahora = Date.now();
    const hace3d = new Date(ahora - 3 * 86400000).toISOString();
    const hace5d = new Date(ahora - 5 * 86400000).toISOString();
    const hace7d = new Date(ahora - 7 * 86400000).toISOString();
    const hace10d = new Date(ahora - 10 * 86400000).toISOString();

    const cotizaciones = [
      { cliente_id: clientesCreados[1].id, vendedor_id: supervisor.id, transportista_id: transCreados[3].id, estado: 'borrador', subtotal_usd: 777.50, descuento_global_pct: 3, descuento_usd: 23.33, costo_envio_usd: 15, total_usd: 769.17, notas_cliente: 'Precios especiales por volumen.', notas_internas: 'Pendiente aprobación.', creado_en: hace3d },
      { cliente_id: clientesCreados[0].id, vendedor_id: supervisor.id, estado: 'enviada', subtotal_usd: 438.48, descuento_global_pct: 0, descuento_usd: 0, costo_envio_usd: 0, total_usd: 438.48, tasa_bcv_snapshot: 95.50, total_bs_snapshot: 41874.84, notas_cliente: 'Retiro en tienda.', enviada_en: hace5d, creado_en: hace5d },
      { cliente_id: clientesCreados[12].id, vendedor_id: vendedorId, transportista_id: transCreados[0].id, estado: 'enviada', subtotal_usd: 121.50, descuento_global_pct: 0, descuento_usd: 0, costo_envio_usd: 8, total_usd: 129.50, tasa_bcv_snapshot: 94.80, total_bs_snapshot: 12276.60, notas_cliente: 'Plomería residencial.', enviada_en: hace3d, creado_en: hace5d },
      { cliente_id: clientesCreados[11].id, vendedor_id: vendedorId, estado: 'aceptada', subtotal_usd: 441.25, descuento_global_pct: 2, descuento_usd: 8.83, costo_envio_usd: 0, total_usd: 432.42, tasa_bcv_snapshot: 93.20, total_bs_snapshot: 40321.54, notas_cliente: 'Material eléctrico.', enviada_en: hace7d, creado_en: hace10d },
      { cliente_id: clientesCreados[3].id, vendedor_id: supervisor.id, estado: 'borrador', subtotal_usd: 10.00, descuento_global_pct: 0, descuento_usd: 0, costo_envio_usd: 0, total_usd: 10.00, notas_internas: 'Preguntó por descuento efectivo.', creado_en: new Date().toISOString() },
      { cliente_id: clientesCreados[8].id, vendedor_id: vendedorId, transportista_id: transCreados[3].id, estado: 'enviada', subtotal_usd: 1627.50, descuento_global_pct: 5, descuento_usd: 81.38, costo_envio_usd: 15, total_usd: 1561.12, tasa_bcv_snapshot: 95.10, total_bs_snapshot: 148462.51, notas_cliente: 'Entrega en obra: Parque del Este.', notas_internas: 'Descuento autorizado.', enviada_en: hace3d, creado_en: hace5d },
    ];
    const cotsCreadas = await supaBatch(env, 'cotizaciones', cotizaciones, 500, logStep);
    logStep(`✓ ${cotsCreadas.length} cotizaciones creadas`);
    for (const c of cotsCreadas) logStep(`    → Cot ${c.id?.substring(0, 8)}... estado=${c.estado} cliente=${c.cliente_id?.substring(0, 8)}...`);

    // Items (simplificados)
    logStep('--- Fase 8: Insertar items (17) ---');
    const allItems = [
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[0].id, codigo_snap: 'CEM-001', nombre_snap: 'Cemento Gris Tipo I 42.5kg', unidad_snap: 'bolsa', cantidad: 100, precio_unit_usd: 5.50, descuento_pct: 5, total_linea_usd: 522.50, orden: 0 },
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[3].id, codigo_snap: 'CEM-004', nombre_snap: 'Arena Lavada (saco 40kg)', unidad_snap: 'bolsa', cantidad: 50, precio_unit_usd: 2.00, descuento_pct: 0, total_linea_usd: 100.00, orden: 1 },
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[4].id, codigo_snap: 'CEM-005', nombre_snap: 'Piedra Picada Nro. 2', unidad_snap: 'bolsa', cantidad: 50, precio_unit_usd: 2.50, descuento_pct: 0, total_linea_usd: 125.00, orden: 2 },
      { cotizacion_id: cotsCreadas[0].id, producto_id: prodsCreados[20].id, codigo_snap: 'FIJ-001', nombre_snap: 'Tornillo Drywall', unidad_snap: 'caja', cantidad: 10, precio_unit_usd: 3.00, descuento_pct: 0, total_linea_usd: 30.00, orden: 3 },
      { cotizacion_id: cotsCreadas[1].id, producto_id: prodsCreados[5].id, codigo_snap: 'PIN-001', nombre_snap: 'Pintura Caucho Int.', unidad_snap: 'und', cantidad: 12, precio_unit_usd: 18.00, descuento_pct: 8, total_linea_usd: 198.72, orden: 0 },
      { cotizacion_id: cotsCreadas[1].id, producto_id: prodsCreados[6].id, codigo_snap: 'PIN-002', nombre_snap: 'Pintura Caucho Ext.', unidad_snap: 'und', cantidad: 8, precio_unit_usd: 22.00, descuento_pct: 8, total_linea_usd: 161.92, orden: 1 },
      { cotizacion_id: cotsCreadas[1].id, producto_id: prodsCreados[9].id, codigo_snap: 'PIN-005', nombre_snap: 'Rodillo de Felpa', unidad_snap: 'und', cantidad: 20, precio_unit_usd: 4.50, descuento_pct: 0, total_linea_usd: 90.00, orden: 2 },
      { cotizacion_id: cotsCreadas[2].id, producto_id: prodsCreados[15].id, codigo_snap: 'PLO-001', nombre_snap: 'Tubo PVC 1/2"', unidad_snap: 'und', cantidad: 20, precio_unit_usd: 3.50, descuento_pct: 0, total_linea_usd: 70.00, orden: 0 },
      { cotizacion_id: cotsCreadas[2].id, producto_id: prodsCreados[17].id, codigo_snap: 'PLO-003', nombre_snap: 'Codo PVC 1/2"', unidad_snap: 'und', cantidad: 40, precio_unit_usd: 0.40, descuento_pct: 0, total_linea_usd: 16.00, orden: 1 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[10].id, codigo_snap: 'ELE-001', nombre_snap: 'Cable THHN 12AWG', unidad_snap: 'rollo', cantidad: 5, precio_unit_usd: 35.00, descuento_pct: 5, total_linea_usd: 166.25, orden: 0 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[11].id, codigo_snap: 'ELE-002', nombre_snap: 'Interruptor 15A', unidad_snap: 'und', cantidad: 30, precio_unit_usd: 2.50, descuento_pct: 0, total_linea_usd: 75.00, orden: 1 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[12].id, codigo_snap: 'ELE-003', nombre_snap: 'Toma Corriente', unidad_snap: 'und', cantidad: 25, precio_unit_usd: 3.00, descuento_pct: 0, total_linea_usd: 75.00, orden: 2 },
      { cotizacion_id: cotsCreadas[3].id, producto_id: prodsCreados[14].id, codigo_snap: 'ELE-005', nombre_snap: 'Bombillo LED', unidad_snap: 'und', cantidad: 50, precio_unit_usd: 2.00, descuento_pct: 0, total_linea_usd: 100.00, orden: 3 },
      { cotizacion_id: cotsCreadas[4].id, producto_id: prodsCreados[11].id, codigo_snap: 'ELE-002', nombre_snap: 'Interruptor 15A', unidad_snap: 'und', cantidad: 4, precio_unit_usd: 2.50, descuento_pct: 0, total_linea_usd: 10.00, orden: 0 },
      { cotizacion_id: cotsCreadas[5].id, producto_id: prodsCreados[0].id, codigo_snap: 'CEM-001', nombre_snap: 'Cemento Gris', unidad_snap: 'bolsa', cantidad: 200, precio_unit_usd: 5.50, descuento_pct: 8, total_linea_usd: 1012.00, orden: 0 },
      { cotizacion_id: cotsCreadas[5].id, producto_id: prodsCreados[2].id, codigo_snap: 'CEM-003', nombre_snap: 'Mortero 40kg', unidad_snap: 'bolsa', cantidad: 50, precio_unit_usd: 4.50, descuento_pct: 5, total_linea_usd: 213.75, orden: 1 },
      { cotizacion_id: cotsCreadas[5].id, producto_id: prodsCreados[3].id, codigo_snap: 'CEM-004', nombre_snap: 'Arena Lavada', unidad_snap: 'bolsa', cantidad: 80, precio_unit_usd: 2.00, descuento_pct: 0, total_linea_usd: 160.00, orden: 2 },
    ];
    const itemsCreados = await supaBatch(env, 'cotizacion_items', allItems, 500, logStep);
    logStep(`✓ ${itemsCreados.length} items creados`);

    const elapsed = Date.now() - start;
    logStep('--- Resumen final ---');
    logStep(`  Productos: ${prodsCreados.length}`);
    logStep(`  Transportistas: ${transCreados.length}`);
    logStep(`  Clientes: ${clientesCreados.length}`);
    logStep(`  Cotizaciones: ${cotsCreadas.length}`);
    logStep(`  Items: ${itemsCreados.length}`);
    logStep(`  Total registros: ${prodsCreados.length + transCreados.length + clientesCreados.length + cotsCreadas.length + itemsCreados.length}`);
    logStep(`✓ SEED DEMO completado exitosamente en ${elapsed}ms`);
    return json({
      ok: true,
      elapsed_ms: elapsed,
      resumen: { productos: prodsCreados.length, transportistas: transCreados.length, clientes: clientesCreados.length, cotizaciones: cotsCreadas.length, items: itemsCreados.length },
      log,
    }, 200, request);
  } catch (e) {
    logStep(`✗ ERROR FATAL: ${e.message}`);
    logStep(`  Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ') || 'N/A'}`);
    return json({ ok: false, error: `Error en seed demo: ${e.message}`, log }, 500, request);
  }
}

export async function handleTesterStressSeed(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);
  const isSup = await verifySupervisor(user.operator_id, env);
  if (!isSup) return jsonError('Solo supervisores', 403, request);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const LEVELS = {
    small:   { productos: 100,  clientes: 50,   cotizaciones: 200,  itemsPorCot: [2, 6] },
    medium:  { productos: 300,  clientes: 150,  cotizaciones: 500,  itemsPorCot: [2, 8] },
    large:   { productos: 500,  clientes: 300,  cotizaciones: 1000, itemsPorCot: [2, 8] },
  };

  const level = LEVELS[body.level] || LEVELS.medium;
  const levelName = body.level || 'medium';
  const start = Date.now();
  const log = [];
  function logStep(msg) { log.push({ ts: Date.now() - start, msg }) }

  try {
    logStep('=== STRESS SEED — Inicio ===');
    logStep(`Usuario: ${user.id}`);
    logStep(`Supabase URL: ${env.SUPABASE_URL}`);
    logStep(`Nivel: ${levelName}`);
    logStep(`Config: ${level.productos} prods, ${level.clientes} clientes, ${level.cotizaciones} cotizaciones, items/cot: ${level.itemsPorCot.join('-')}`);
    logStep(`Fecha/hora: ${new Date().toISOString()}`);

    // Limpiar
    logStep('--- Fase 1: Limpieza de tablas ---');
    await supaDelete(env, 'comisiones', user.id, logStep);
    await supaDelete(env, 'notas_despacho', user.id, logStep);
    await supaDelete(env, 'cotizacion_items', user.id, logStep);
    await supaDelete(env, 'cotizaciones', user.id, logStep);
    await supaDelete(env, 'clientes', user.id, logStep);
    await supaDelete(env, 'transportistas', user.id, logStep);
    await supaDelete(env, 'productos', user.id, logStep);
    logStep('✓ Limpieza completada');

    // Usuarios
    logStep('--- Fase 2: Consultar usuarios ---');
    const t0Users = Date.now();
    const usuarios = await supaQuery(env, 'usuarios', '?select=id,nombre,rol&activo=eq.true');
    logStep(`  GET usuarios: ${usuarios.length} encontrados (${Date.now() - t0Users}ms)`);
    for (const u of usuarios) logStep(`    → ${u.rol}: ${u.nombre} (${u.id.substring(0, 8)}...)`);
    const supervisor = usuarios.find(u => u.rol === 'supervisor');
    const vendedor = usuarios.find(u => u.rol === 'vendedor');
    if (!supervisor) {
      logStep('✗ ERROR: No hay supervisor activo');
      return json({ ok: false, error: 'No hay supervisor activo', log }, 400, request);
    }
    const vendedorId = vendedor?.id ?? supervisor.id;

    const CATEGORIAS = ['Cemento', 'Pintura', 'Herramientas', 'Electricidad', 'Plomería', 'Fijación', 'Ferretería General', 'Seguridad']
    const UNIDADES = ['und', 'bolsa', 'kg', 'rollo', 'caja', 'metro', 'galón', 'litro']
    const TIPOS = ['particular', 'ferreteria', 'constructor', 'empresa']
    const ESTADOS = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada']
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const randF = (a, b) => +(Math.random() * (b - a) + a).toFixed(2);

    logStep('--- Fase 3: Generar productos ---');
    // Productos
    const productos = [];
    for (let i = 0; i < level.productos; i++) {
      const cat = pick(CATEGORIAS);
      const costo = randF(0.20, 50);
      productos.push({
        codigo: `${cat.substring(0, 3).toUpperCase()}-${String(i + 1).padStart(4, '0')}`,
        nombre: `Producto ${cat} #${i + 1}`,
        categoria: cat,
        unidad: pick(UNIDADES),
        precio_usd: +(costo * randF(1.2, 1.8)).toFixed(2),
        costo_usd: costo,
        stock_actual: rand(0, 500),
        stock_minimo: rand(5, 50),
        cuenta_id: user.id,
      });
    }
    logStep(`  Generados ${productos.length} productos en memoria`);
    const prods = await supaBatch(env, 'productos', productos, 500, logStep);
    logStep(`✓ ${prods.length} productos insertados`);

    // Transportistas
    logStep('--- Fase 4: Insertar transportistas ---');
    const trans = await supaBatch(env, 'transportistas', [
      { nombre: 'TransVenCarga', rif: 'J-30456789-1', telefono: '0241-4561234', zona_cobertura: 'Valencia', tarifa_base: 8, creado_por: supervisor.id, cuenta_id: user.id },
      { nombre: 'MRW', rif: 'J-00359741-6', telefono: '0800-679-0000', zona_cobertura: 'Nacional', tarifa_base: 12, creado_por: supervisor.id, cuenta_id: user.id },
      { nombre: 'Zoom', rif: 'J-29871456-2', telefono: '0800-966-6000', zona_cobertura: 'Nacional', tarifa_base: 10, creado_por: supervisor.id, cuenta_id: user.id },
    ], 500, logStep);
    logStep(`✓ ${trans.length} transportistas insertados`);

    // Clientes
    logStep(`--- Fase 5: Generar clientes (${level.clientes}) ---`);
    const clientes = [];
    const APELLIDOS = ['Rodríguez', 'Martínez', 'López', 'González', 'Hernández', 'Pérez', 'García', 'Ramírez', 'Torres', 'Flores', 'Morales', 'Castillo'];
    for (let i = 0; i < level.clientes; i++) {
      const tipo = pick(TIPOS);
      const esVend = Math.random() < 0.5;
      clientes.push({
        nombre: tipo === 'particular' ? `${pick(['José', 'María', 'Carlos', 'Ana', 'Luis', 'Rosa'])} ${pick(APELLIDOS)}` : `${pick(['Ferretería', 'Construcciones', 'Inversiones', 'Servicios'])} ${pick(APELLIDOS)} ${pick(['C.A.', 'S.A.', '& Hijos'])}`,
        rif_cedula: tipo === 'particular' ? `V-${rand(10000000, 29999999)}` : `J-${rand(30000000, 50999999)}-${rand(0, 9)}`,
        telefono: `04${rand(12, 26)}-${rand(1000000, 9999999)}`,
        email: Math.random() < 0.6 ? `stress${i}@test.com` : null,
        direccion: `Calle ${rand(1, 100)}, Valencia`,
        tipo_cliente: tipo,
        vendedor_id: esVend ? vendedorId : supervisor.id,
        cuenta_id: user.id,
      });
    }
    logStep(`  Generados ${clientes.length} clientes en memoria`);
    const clis = await supaBatch(env, 'clientes', clientes, 500, logStep);
    logStep(`✓ ${clis.length} clientes insertados`);

    // Cotizaciones + Items
    logStep(`--- Fase 6: Generar cotizaciones (${level.cotizaciones}) ---`);
    const cotBatch = [];
    const ahora = Date.now();
    for (let i = 0; i < level.cotizaciones; i++) {
      const estado = pick(ESTADOS);
      const cli = pick(clis);
      const descG = Math.random() < 0.4 ? rand(1, 10) : 0;
      const envio = Math.random() < 0.3 ? pick(trans).tarifa_base : 0;
      const diasAtras = rand(0, 30);
      const creado = new Date(ahora - diasAtras * 86400000).toISOString();
      cotBatch.push({
        cliente_id: cli.id,
        vendedor_id: cli.vendedor_id,
        transportista_id: Math.random() < 0.3 ? pick(trans).id : null,
        estado,
        subtotal_usd: 0, descuento_global_pct: descG, descuento_usd: 0, costo_envio_usd: envio, total_usd: 0,
        tasa_bcv_snapshot: estado !== 'borrador' ? randF(90, 100) : null,
        notas_cliente: i % 3 === 0 ? `Stress test cotización #${i + 1}` : null,
        creado_en: creado,
        enviada_en: estado !== 'borrador' ? creado : null,
        cuenta_id: user.id,
      });
    }
    logStep(`  Generadas ${cotBatch.length} cotizaciones en memoria`);
    const cots = await supaBatch(env, 'cotizaciones', cotBatch, 500, logStep);
    logStep(`✓ ${cots.length} cotizaciones insertadas`);

    // Items
    logStep(`--- Fase 7: Generar items ---`);
    const allItems = [];
    for (let i = 0; i < cots.length; i++) {
      const numItems = rand(level.itemsPorCot[0], level.itemsPorCot[1]);
      let subtotal = 0;
      for (let j = 0; j < numItems; j++) {
        const prod = pick(prods);
        const cant = rand(1, 50);
        const desc = 0;
        const total = +(cant * prod.precio_usd).toFixed(2);
        subtotal += total;
        allItems.push({
          cotizacion_id: cots[i].id,
          producto_id: prod.id,
          codigo_snap: prod.codigo,
          nombre_snap: prod.nombre,
          unidad_snap: prod.unidad,
          cantidad: cant,
          precio_unit_usd: prod.precio_usd,
          descuento_pct: desc,
          total_linea_usd: total,
          orden: j,
          cuenta_id: user.id,
        });
      }
    }
    logStep(`  Generados ${allItems.length} items en memoria`);
    const items = await supaBatch(env, 'cotizacion_items', allItems, 1000, logStep);
    logStep(`✓ ${items.length} items insertados`);

    const elapsed = Date.now() - start;
    logStep('--- Resumen final ---');
    logStep(`✓ STRESS SEED completado exitosamente en ${elapsed}ms`);
    return json({
      ok: true,
      level: levelName,
      elapsed_ms: elapsed,
      resumen: { productos: prods.length, transportistas: trans.length, clientes: clis.length, cotizaciones: cots.length, items: items.length },
      log,
    }, 200, request);
  } catch (e) {
    logStep(`✗ ERROR FATAL: ${e.message}`);
    return json({ ok: false, error: e.message, log }, 500, request);
  }
}

// ── Helpers locales para Tester ───────────────────────────────────────────
async function supaBatch(env, table, rows, chunkSize = 500, logFn = null) {
  const allKeys = new Set();
  for (const row of rows) for (const k of Object.keys(row)) allKeys.add(k);
  const normalized = rows.map(row => {
    const obj = {};
    for (const k of allKeys) obj[k] = row[k] !== undefined ? row[k] : null;
    return obj;
  });
  const all = [];
  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize);
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`POST ${table} failed: ${res.status}`);
    const data = await res.json();
    all.push(...data);
  }
  return all;
}

async function supaDelete(env, table, userId, logFn = null) {
  const queryParam = table === 'system_logs' ? `usuario_id=eq.${userId}` : `cuenta_id=eq.${userId}`;
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${queryParam}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
}

async function supaQuery(env, table, params = '') {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  return res.json();
}

async function supaInsert(env, table, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Insert failed: ${res.status}`);
  return res.json();
}

// ── Gestión de Transportistas (Admin) ─────────────────────────────────────────

export async function handleCrearTransportista(request, env) {
  const { user, operador, error } = await validateOperator(request, env);
  if (error) return error;

  const ROLES_AUTORIZADOS = ['administracion', 'desarrollador', 'supervisor', 'jefe', 'vendedor', 'vendedor_sin_comision', 'logistica'];
  if (!ROLES_AUTORIZADOS.includes(operador.rol)) {
    return jsonError('Acceso denegado: solo personal autorizado puede crear transportistas', 403, request);
  }

  const body = await request.json();
  const { nombre, rif, telefono, zona_cobertura, tarifa_base, notas, color, vehiculo, placa_chuto, placa_batea, capacidad, color_batea } = body;
  if (!nombre) return jsonError('Nombre es requerido', 400, request);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transportistas`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      nombre, rif, telefono, zona_cobertura, tarifa_base, notas,
      color, vehiculo, placa_chuto, placa_batea, capacidad, color_batea,
      cuenta_id: operador.cuenta_id,
      creado_por: operador.id,
      activo: true
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error en DB: ${err}`, 500, request);
  }

  const data = await res.json();
  return json({ ok: true, transportista: data[0] }, 201, request);
}

export async function handleActualizarTransportista(request, env) {
  const { user, operador, error } = await validateOperator(request, env);
  if (error) return error;

  const ROLES_AUTORIZADOS = ['administracion', 'desarrollador', 'supervisor', 'jefe', 'vendedor', 'vendedor_sin_comision', 'logistica'];
  if (!ROLES_AUTORIZADOS.includes(operador.rol)) {
    return jsonError('Acceso denegado: solo personal autorizado', 403, request);
  }

  const body = await request.json();
  const { id, ...updateData } = body;
  if (!id) return jsonError('ID es requerido', 400, request);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transportistas?id=eq.${id}&cuenta_id=eq.${operador.cuenta_id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(updateData),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error en DB: ${err}`, 500, request);
  }

  const data = await res.json();
  return json({ ok: true, transportista: data[0] }, 200, request);
}
