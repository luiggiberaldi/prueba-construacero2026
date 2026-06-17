// api/handlers/clientes.js
import { json, jsonError, corsHeaders, isRateLimited, sanitizeSearch, isValidUuid, removeAccents } from '../lib/utils.js'
import { verifyAuth, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

export async function handleCheckRif(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const url = new URL(request.url);
  const rif = url.searchParams.get('rif');
  const exclude = url.searchParams.get('exclude');
  if (!rif) return json({ existe: false }, 200, request);

  let queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?rif_cedula=eq.${encodeURIComponent(rif)}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,vendedor:usuarios!clientes_vendedor_id_fkey(nombre)&limit=1`;
  if (exclude) queryUrl += `&id=neq.${encodeURIComponent(exclude)}`;

  const res = await fetch(queryUrl, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return json({ existe: false }, 200, request);

  const data = await res.json();
  if (data.length === 0) return json({ existe: false }, 200, request);

  const c = data[0];
  return json({
    existe: true,
    nombre: c.nombre,
    vendedor: c.vendedor?.nombre || 'Sin vendedor',
  }, 200, request);
}

export async function handleListarClientes(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers: supaHeaders } = v;

  const url = new URL(request.url);
  const busqueda = url.searchParams.get('busqueda') || '';

  const esExterno = !!operador.es_externo;

  // Fetch ALL active clients — filtrado en el Worker (in-memory, rápido)
  // limit=10000 evita el tope de 1000 filas de PostgREST
  // Fetch ALL clients (incluyendo inactivos) — filtrado en el Worker
  let baseUrl = `${env.SUPABASE_URL}/rest/v1/clientes?cuenta_id=eq.${user.id}&order=nombre.asc&limit=10000&select=id,codigo_cliente,nombre,rif_cedula,telefono,email,direccion,estado,ciudad,notas,tipo_cliente,activo,vendedor_id,saldo_pendiente,saldo_a_favor,creado_en,categoria,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color,rol)`;

  if (esExterno) {
    baseUrl += `&vendedor_id=eq.${operador.id}`;
  }

  // Fetch active loans in parallel to detect which clients have pending/partial loans
  const prestamosUrl = `${env.SUPABASE_URL}/rest/v1/cliente_prestamos?estado=in.("pendiente","devuelto_parcial")&select=cliente_id`;

  const [clientesRes, prestamosRes] = await Promise.all([
    fetch(baseUrl, { headers: supaHeaders }),
    fetch(prestamosUrl, { headers: supaHeaders })
  ]);

  if (!clientesRes.ok) {
    const errText = await clientesRes.text();
    return jsonError(`Error al cargar clientes: ${errText}`, clientesRes.status, request);
  }

  const rawClientes = await clientesRes.json();
  const clientesConPrestamosActivos = new Set();

  if (prestamosRes.ok) {
    const prestamosList = await prestamosRes.json();
    if (Array.isArray(prestamosList)) {
      prestamosList.forEach(p => {
        if (p.cliente_id) clientesConPrestamosActivos.add(p.cliente_id);
      });
    }
  }

  let data = rawClientes.map(c => ({
    ...c,
    tiene_prestamos_activos: clientesConPrestamosActivos.has(c.id)
  }));

  if (busqueda.trim()) {
    const raw  = removeAccents(busqueda.trim().toLowerCase());
    const norm = raw.replace(/[\.\-\(\)\s\/\\]/g, '');

    data = data.filter(c => {
      const nombre = removeAccents((c.nombre    || '').toLowerCase());
      const codigo = (c.codigo_cliente || '').toLowerCase();
      const rif    = (c.rif_cedula|| '').toLowerCase().replace(/[\.\-\(\)\s\/\\]/g, '');
      const tel    = (c.telefono  || '').toLowerCase().replace(/[\.\-\(\)\s\/\\]/g, '');
      const email  = (c.email     || '').toLowerCase();

      return (
        nombre.includes(raw)  ||
        codigo.includes(raw)  ||
        rif.includes(norm)    ||
        tel.includes(norm)    ||
        email.includes(raw)
      );
    });
  }

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ── Lookup clientes by IDs (service key, bypasses RLS) ──────────────────────
export async function handleClientesLookup(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers: supaHeaders } = v;

  const { ids } = await request.json();
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) {
    return jsonError('ids debe ser un array de 1-200 UUIDs', 400, request);
  }

  const esExterno = !!operador.es_externo;

  let queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=in.(${ids.map(encodeURIComponent).join(',')})&cuenta_id=eq.${user.id}&select=id,codigo_cliente,nombre,rif_cedula,telefono,email,direccion,estado,ciudad,tipo_cliente,vendedor_id,creado_en,categoria,vendedor:usuarios!clientes_vendedor_id_fkey(id,nombre,color,rol)`;

  if (esExterno) {
    queryUrl += `&vendedor_id=eq.${operador.id}`;
  }

  const res = await fetch(queryUrl, { headers: supaHeaders });

  if (!res.ok) {
    return jsonError('Error al buscar clientes', res.status, request);
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

export async function handleReasignarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // ── Solo supervisores y administración pueden reasignar clientes ────────────
  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('Solo supervisores y administración pueden reasignar clientes', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { clienteId, nuevoVendedorId, motivo } = body;
  if (!clienteId || !nuevoVendedorId) return jsonError('Faltan campos', 400, request);
  if (!isValidUuid(clienteId) || !isValidUuid(nuevoVendedorId)) return jsonError('IDs inválidos', 400, request);
  const motivoFinal = (motivo || '').trim() || null;

  try {
    // 1. Obtener cliente
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&activo=eq.true&select=id,nombre,vendedor_id`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado o inactivo', 404, request);
    if (cliente.vendedor_id === nuevoVendedorId) return jsonError('El cliente ya pertenece a ese vendedor', 400, request);

    // 2. Validar vendedor destino
    const vRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${nuevoVendedorId}&activo=eq.true&select=id`, { headers });
    const [vendDest] = await vRes.json();
    if (!vendDest) return jsonError('Vendedor destino no encontrado o inactivo', 400, request);

    // 3. Actualizar cliente
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        vendedor_id: nuevoVendedorId,
        ultima_reasig_por: user.operator_id,
        ultima_reasig_motivo: motivoFinal,
        ultima_reasig_en: new Date().toISOString(),
        actualizado_en: new Date().toISOString(),
      }),
    });

    // 3.5. Reasignar comisiones no pagadas del cliente al nuevo vendedor
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?cliente_id=eq.${clienteId}&select=id`, { headers });
    if (dRes.ok) {
      const despachos = await dRes.json();
      const despIds = despachos.map(d => d.id);
      if (despIds.length > 0) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=in.(${despIds.join(',')})&estado=in.(pendiente,cta_cobrar)`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            vendedorid: nuevoVendedorId,
            actualizadoen: new Date().toISOString()
          })
        });
      }
    }

    // 4. Insertar registro de reasignación
    await fetch(`${env.SUPABASE_URL}/rest/v1/reasignaciones_clientes`, {
      method: 'POST', headers,
      body: JSON.stringify({
        cliente_id: clienteId,
        vendedor_origen: cliente.vendedor_id,
        vendedor_destino: nuevoVendedorId,
        supervisor_id: user.operator_id,
        motivo: motivoFinal,
      }),
    });

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'REASIGNACION', accion: 'REASIGNAR_CLIENTE',
      descripcion: `Cliente "${cliente.nombre}" reasignado${motivoFinal ? `. Motivo: ${motivoFinal}` : ''}`,
      entidadTipo: 'cliente', entidadId: clienteId,
      meta: { vendedor_origen: cliente.vendedor_id, vendedor_destino: nuevoVendedorId, motivo: motivoFinal }, ip,
    });

    return json({ ok: true }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reasignar cliente', 500, request);
  }
}

export async function handleBorrarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { id } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);

  const esExterno = !!operador.es_externo;

  // Verificar que el cliente pertenece a este tenant (y a este vendedor si es externo)
  let queryUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}&select=id,nombre,saldo_pendiente,activo,vendedor_id&limit=1`;
  if (esExterno) {
    queryUrl += `&vendedor_id=eq.${operador.id}`;
  }

  const cRes = await fetch(queryUrl, { headers });
  const [cliente] = await cRes.json();
  if (!cliente) return jsonError('Cliente no encontrado o no tienes permisos para borrarlo', 404, request);

  // NIVEL 3: Deuda activa → bloqueo total
  if (Number(cliente.saldo_pendiente || 0) > 0) {
    return jsonError(
      `No se puede eliminar "${cliente.nombre}" porque tiene una deuda pendiente de $${Number(cliente.saldo_pendiente).toFixed(2)}. Sáldale la deuda primero.`,
      409,
      request
    );
  }

  // NIVEL 2: ¿Tiene cotizaciones o despachos? → solo desactivar
  const [cotRes, ndRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?cliente_id=eq.${id}&select=id&limit=1`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?cliente_id=eq.${id}&select=id&limit=1`, { headers }),
  ]);
  const cots = await cotRes.json();
  const nds  = await ndRes.json();
  const tieneHistorial = (Array.isArray(cots) && cots.length > 0) || (Array.isArray(nds) && nds.length > 0);

  if (tieneHistorial) {
    // Solo desactivar — preservar integridad histórica
    let patchUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`;
    if (esExterno) {
      patchUrl += `&vendedor_id=eq.${operador.id}`;
    }
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() }),
    });
    return json({ accion: 'desactivado', nombre: cliente.nombre }, 200, request);
  }

  // NIVEL 1: Sin historial → borrado físico real
  let delUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`;
  if (esExterno) {
    delUrl += `&vendedor_id=eq.${operador.id}`;
  }
  const delRes = await fetch(delUrl, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal' },
  });

  if (!delRes.ok && delRes.status !== 204) {
    const err = await delRes.text();
    return jsonError(`Error al borrar cliente: ${err}`, delRes.status, request);
  }

  return json({ accion: 'eliminado', nombre: cliente.nombre }, 200, request);
}

export async function handleCrearCliente(request, env) {

  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { nombre, rif_cedula, telefono, email, direccion, estado, ciudad, notas, tipo_cliente, vendedor_id, categoria } = body;
  if (!nombre?.trim()) return jsonError('El nombre es obligatorio', 400, request);

  const esExterno = !!operador.es_externo;

  // Verificar duplicado de RIF si se proporciona
  if (rif_cedula?.trim()) {
    const checkUrl = `${env.SUPABASE_URL}/rest/v1/clientes?rif_cedula=eq.${encodeURIComponent(rif_cedula.trim())}&activo=eq.true&cuenta_id=eq.${user.id}&select=id&limit=1`;
    const checkRes = await fetch(checkUrl, { headers });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) return jsonError('Ya existe un cliente con ese RIF/cédula', 409, request);
    }
  }

  let finalVendedorId = esExterno ? operador.id : (vendedor_id || operador.id);
  if (tipo_cliente === 'personal') {
    const empRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?nombre=ilike.EMPRESA&activo=eq.true&select=id`, { headers });
    if (empRes.ok) {
      const empUsers = await empRes.json();
      if (empUsers.length > 0) {
        finalVendedorId = empUsers[0].id;
      }
    }
  }

  const payload = {
    nombre: nombre.trim(),
    rif_cedula: rif_cedula?.trim() || null,
    telefono: telefono?.trim() || null,
    email: email?.trim() || null,
    direccion: direccion?.trim() || null,
    estado: estado?.trim() || null,
    ciudad: ciudad?.trim() || null,
    notas: notas?.trim() || null,
    tipo_cliente: tipo_cliente || 'natural',
    categoria: categoria?.trim() || null,
    vendedor_id: finalVendedorId,
    cuenta_id: user.id,
    activo: true,
  };

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error al crear cliente: ${err}`, res.status, request);
  }

  const [data] = await res.json();
  return json(data, 201, request);
}

export async function handleActualizarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { id, nombre, rif_cedula, telefono, email, direccion, estado, ciudad, notas, tipo_cliente, categoria } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);
  if (!nombre?.trim()) return jsonError('El nombre es obligatorio', 400, request);

  const esExterno = !!operador.es_externo;

  // Verificar duplicado de RIF excluyendo este cliente
  if (rif_cedula?.trim()) {
    let checkUrl = `${env.SUPABASE_URL}/rest/v1/clientes?rif_cedula=eq.${encodeURIComponent(rif_cedula.trim())}&activo=eq.true&cuenta_id=eq.${user.id}&id=neq.${id}&select=id&limit=1`;
    if (esExterno) {
      checkUrl += `&vendedor_id=eq.${operador.id}`;
    }
    const checkRes = await fetch(checkUrl, { headers });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) return jsonError('Ya existe un cliente con ese RIF/cédula', 409, request);
    }
  }

  const payload = {
    nombre: nombre.trim(),
    rif_cedula: rif_cedula?.trim() || null,
    telefono: telefono?.trim() || null,
    email: email?.trim() || null,
    direccion: direccion?.trim() || null,
    estado: estado?.trim() || null,
    ciudad: ciudad?.trim() || null,
    notas: notas?.trim() || null,
    tipo_cliente: tipo_cliente || 'natural',
    categoria: categoria?.trim() || null,
    actualizado_en: new Date().toISOString(),
  };

  if (tipo_cliente === 'personal') {
    const empRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?nombre=ilike.EMPRESA&activo=eq.true&select=id`, { headers });
    if (empRes.ok) {
      const empUsers = await empRes.json();
      if (empUsers.length > 0) {
        payload.vendedor_id = empUsers[0].id;
      }
    }
  }

  let updateUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`;
  if (esExterno) {
    updateUrl += `&vendedor_id=eq.${operador.id}`;
  }

  const res = await fetch(updateUrl, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error al actualizar cliente: ${err}`, res.status, request);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    return jsonError('Cliente no encontrado o no tienes permisos para modificarlo', 404, request);
  }
  return json(data[0], 200, request);
}

export async function handleActivarCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { id } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);

  const esExterno = !!operador.es_externo;

  let activateUrl = `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${id}&cuenta_id=eq.${user.id}`;
  if (esExterno) {
    activateUrl += `&vendedor_id=eq.${operador.id}`;
  }

  const res = await fetch(activateUrl, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ activo: true, actualizado_en: new Date().toISOString() }),
  });

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error al activar cliente: ${err}`, res.status, request);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    return jsonError('Cliente no encontrado o no tienes permisos para activarlo', 404, request);
  }
  return json(data[0], 200, request);
}



export async function handleReasignarClientesBulk(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // ── Solo supervisores y administración pueden reasignar masivamente ─────────
  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('Solo supervisores y administración pueden reasignar clientes', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { vendedorOrigenId, vendedorDestinoId, motivo } = body;
  if (!vendedorOrigenId || !vendedorDestinoId) return jsonError('Faltan campos: vendedorOrigenId, vendedorDestinoId', 400, request);
  if (!isValidUuid(vendedorOrigenId) || !isValidUuid(vendedorDestinoId)) return jsonError('IDs inválidos', 400, request);
  if (vendedorOrigenId === vendedorDestinoId) return jsonError('El origen y destino no pueden ser el mismo usuario', 400, request);
  const motivoFinal = (motivo || '').trim() || 'Reasignación masiva';

  try {
    // 1. Validar vendedor destino
    const vRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${vendedorDestinoId}&activo=eq.true&select=id,nombre`, { headers });
    const [vendDest] = await vRes.json();
    if (!vendDest) return jsonError('Vendedor destino no encontrado o inactivo', 400, request);

    // 2. Obtener todos los clientes del origen (solo de este tenant)
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?vendedor_id=eq.${vendedorOrigenId}&cuenta_id=eq.${user.id}&select=id,nombre,vendedor_id`, { headers });
    const clientes = await cRes.json();
    if (!Array.isArray(clientes) || clientes.length === 0) return json({ ok: true, reasignados: 0, mensaje: 'Este vendedor no tiene clientes' }, 200, request);

    const ahora = new Date().toISOString();

    // 3. Actualizar todos los clientes en bulk (solo de este tenant)
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?vendedor_id=eq.${vendedorOrigenId}&cuenta_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        vendedor_id: vendedorDestinoId,
        ultima_reasig_por: user.operator_id,
        ultima_reasig_motivo: motivoFinal,
        ultima_reasig_en: ahora,
        actualizado_en: ahora,
      }),
    });

    // 3.5. Reasignar masivamente comisiones no pagadas de los clientes al nuevo vendedor
    const clientIds = clientes.map(c => c.id);
    if (clientIds.length > 0) {
      const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?cliente_id=in.(${clientIds.join(',')})&select=id`, { headers });
      if (dRes.ok) {
        const despachos = await dRes.json();
        const despIds = despachos.map(d => d.id);
        if (despIds.length > 0) {
          await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=in.(${despIds.join(',')})&estado=in.(pendiente,cta_cobrar)`, {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              vendedorid: vendedorDestinoId,
              actualizadoen: ahora
            })
          });
        }
      }
    }

    // 4. Registrar en reasignaciones_clientes (una por cliente)
    const registros = clientes.map(c => ({
      cliente_id: c.id,
      vendedor_origen: vendedorOrigenId,
      vendedor_destino: vendedorDestinoId,
      supervisor_id: user.operator_id,
      motivo: motivoFinal,
    }));
    await fetch(`${env.SUPABASE_URL}/rest/v1/reasignaciones_clientes`, {
      method: 'POST', headers,
      body: JSON.stringify(registros),
    });

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'REASIGNACION', accion: 'REASIGNAR_CLIENTES_BULK',
      descripcion: `${clientes.length} clientes reasignados de vendedor ${vendedorOrigenId} a ${vendDest.nombre}. Motivo: ${motivoFinal}`,
      entidadTipo: 'usuario', entidadId: vendedorOrigenId,
      meta: { vendedor_origen: vendedorOrigenId, vendedor_destino: vendedorDestinoId, total: clientes.length, motivo: motivoFinal }, ip,
    });

    return json({ ok: true, reasignados: clientes.length }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reasignar clientes', 500, request);
  }
}

// ─── LÓGICA DE PRÉSTAMO DE ARTÍCULOS ─────────────────────────────────────────

// Helper local para sincronizar saldo pendiente del cliente
async function recalcularSaldoPendienteCliente(clienteId, env, headers) {
  try {
    const cxcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?cliente_id=eq.${clienteId}&select=tipo,monto_usd,forma_pago_abono`, { headers });
    if (!cxcRes.ok) return;
    const cxcList = await cxcRes.json();
    
    let saldoReal = 0;
    let saldoFavor = 0;
    if (Array.isArray(cxcList)) {
      cxcList.forEach(item => {
        const monto = Number(item.monto_usd) || 0;
        if (item.tipo === 'cargo') {
          saldoReal += monto;
        } else if (item.tipo === 'abono') {
          saldoReal -= monto;
          if (item.forma_pago_abono === 'Saldo a favor') {
            saldoFavor -= monto;
          }
        } else if (item.tipo === 'credito') {
          saldoFavor += monto;
        }
      });
    }
    
    saldoReal = Math.max(0, Math.round(saldoReal * 10000) / 10000);
    saldoFavor = Math.max(0, Math.round(saldoFavor * 10000) / 10000);
    
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_pendiente: saldoReal, saldo_a_favor: saldoFavor }),
    });
    
    console.log(`[RECALCULO-SALDO] Cliente ${clienteId} saldo sincronizado a pendiente=$${saldoReal}, a_favor=$${saldoFavor}`);
  } catch (err) {
    console.error(`[RECALCULO-SALDO] Error al recalcular saldo para cliente ${clienteId}:`, err?.message);
  }
}

// Endpoint para consultar préstamos
export async function handleGetPrestamosCliente(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { headers } = v;

  const url = new URL(request.url);
  const clienteId = url.searchParams.get('clienteId');
  if (!clienteId || !isValidUuid(clienteId)) {
    return jsonError('clienteId inválido', 400, request);
  }

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cliente_prestamos?cliente_id=eq.${clienteId}&select=*,producto:productos(codigo,nombre,unidad,precio_usd),despacho:notas_despacho(numero)&order=creado_en.desc`,
      { headers }
    );
    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al consultar préstamos: ${err}`, res.status, request);
    }
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    });
  } catch (e) {
    return jsonError(e.message || 'Error en consulta de préstamos', 500, request);
  }
}

// Endpoint para devolver préstamo físico
export async function handleDevolverPrestamo(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // Permitido únicamente para administración (administracion, jefe, desarrollador)
  const rolesAbil = ['administracion', 'jefe', 'desarrollador'];
  if (!rolesAbil.includes(operador.rol)) {
    return jsonError('No tienes permisos para registrar devoluciones de préstamo', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { prestamoId, cantidad } = body;
  const cant = Number(cantidad);
  if (!prestamoId || !isValidUuid(prestamoId)) return jsonError('prestamoId inválido', 400, request);
  if (isNaN(cant) || cant <= 0) return jsonError('Cantidad a devolver inválida', 400, request);

  try {
    // 1. Obtener registro de préstamo actual
    const lpRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cliente_prestamos?id=eq.${prestamoId}&select=*,producto:productos(id,stock_actual,nombre,unidad),despacho:notas_despacho(numero)`,
      { headers }
    );
    const [prestamo] = await lpRes.json();
    if (!prestamo) return jsonError('Préstamo no encontrado', 404, request);

    const cantPrestada = Number(prestamo.cantidad_prestada);
    const cantDevueltaActual = Number(prestamo.cantidad_devuelta || 0);
    const cantFacturada = Number(prestamo.cantidad_facturada || 0);
    const restante = Math.max(0, cantPrestada - cantDevueltaActual - cantFacturada);

    if (cant > restante + 0.0001) {
      return jsonError(`La cantidad ingresada (${cant}) supera el saldo pendiente del préstamo (${restante})`, 400, request);
    }

    const nuevaCantDevuelta = cantDevueltaActual + cant;
    let nuevoEstado = 'pendiente';
    if (nuevaCantDevuelta + cantFacturada >= cantPrestada - 0.0001) {
      nuevoEstado = 'devuelto';
    } else if (nuevaCantDevuelta > 0) {
      nuevoEstado = 'devuelto_parcial';
    }

    // 2. Transacción: Actualizar préstamo
    const patchLp = await fetch(`${env.SUPABASE_URL}/rest/v1/cliente_prestamos?id=eq.${prestamoId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        cantidad_devuelta: nuevaCantDevuelta,
        estado: nuevoEstado
      })
    });
    if (!patchLp.ok) {
      const err = await patchLp.text();
      return jsonError(`Error al actualizar préstamo: ${err}`, 500, request);
    }

    // 3. Transacción: Regresar stock al inventario
    if (prestamo.producto_id && prestamo.producto) {
      const stockAnterior = Number(prestamo.producto.stock_actual);
      const nuevoStock = stockAnterior + cant;
      const patchProd = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${prestamo.producto_id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ stock_actual: nuevoStock })
      });

      if (patchProd.ok) {
        try {
          const loteId = crypto.randomUUID();
          const despachoNum = prestamo.despacho?.numero ? `DES-${String(prestamo.despacho.numero).padStart(5, '0')}` : 'Préstamo';
          
          // Buscar el nombre del cliente para el motivo del Kardex
          const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${prestamo.cliente_id}&select=nombre`, { headers });
          let clienteNombre = 'Cliente';
          if (cliRes.ok) {
            const cliData = await cliRes.json();
            if (cliData && cliData[0]) clienteNombre = cliData[0].nombre;
          }

          const movPayload = {
            lote_id: loteId,
            tipo: 'ingreso',
            motivo: `Devolución de préstamo (${despachoNum}) - Cliente: ${clienteNombre}`,
            motivo_tipo: 'devolucion',
            producto_id: prestamo.producto_id,
            producto_nombre: prestamo.producto.nombre,
            cantidad: cant,
            stock_anterior: stockAnterior,
            stock_nuevo: nuevoStock,
            usuario_id: operador.id,
            usuario_nombre: operador.nombre,
            usuario_color: operador.color || null
          };

          await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify(movPayload)
          });
        } catch (movErr) {
          console.error('[DEVOLVER-PRESTAMO] Error al registrar movimiento en inventario_movimientos:', movErr?.message);
        }
      }
    }

    // 4. Registrar en seguimiento_operativo
    const timelinesPayload = {
      cliente_id: prestamo.cliente_id,
      despacho_id: prestamo.despacho_id,
      usuario_id: operador.id,
      tipo: 'seguimiento',
      prioridad: 'informativa',
      titulo: 'Devolución de préstamo',
      contenido: `Se registraron de vuelta ${cant} ${prestamo.producto?.unidad || 'und'} de "${prestamo.producto?.nombre || 'Producto'}". Estado del préstamo: ${nuevoEstado.toUpperCase()}.`,
      imagenes: [],
      fijada: false,
      cuenta_id: user.id
    };
    await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo`, {
      method: 'POST',
      headers,
      body: JSON.stringify(timelinesPayload)
    });

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'FINANZAS', accion: 'DEVOLVER_PRESTAMO',
      descripcion: `Devolución de préstamo #${prestamoId}: ${cant} und de ${prestamo.producto?.nombre}`,
      entidadTipo: 'cliente', entidadId: prestamo.cliente_id,
      meta: { prestamo_id: prestamoId, cantidad: cant, estado_nuevo: nuevoEstado }, ip
    });

    return json({ ok: true, nuevoEstado, cantidad_devuelta: nuevaCantDevuelta }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error en devolución', 500, request);
  }
}

// Endpoint para facturar préstamo (convertir a venta con saldo en cuentas por cobrar)
export async function handleFacturarPrestamo(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // Permitido para administración, jefes y desarrolladores
  const rolesAbil = ['administracion', 'jefe', 'desarrollador'];
  if (!rolesAbil.includes(operador.rol)) {
    return jsonError('Solo administración o jefes pueden facturar préstamos', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { prestamoId, cantidad } = body;
  const cant = Number(cantidad);
  if (!prestamoId || !isValidUuid(prestamoId)) return jsonError('prestamoId inválido', 400, request);
  if (isNaN(cant) || cant <= 0) return jsonError('Cantidad a facturar inválida', 400, request);

  try {
    // 1. Obtener registro de préstamo actual
    const lpRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cliente_prestamos?id=eq.${prestamoId}&select=*,producto:productos(id,precio_usd,nombre,unidad),despacho:notas_despacho(numero)`,
      { headers }
    );
    const [prestamo] = await lpRes.json();
    if (!prestamo) return jsonError('Préstamo no encontrado', 404, request);

    const cantPrestada = Number(prestamo.cantidad_prestada);
    const cantDevuelta = Number(prestamo.cantidad_devuelta || 0);
    const cantFacturadaActual = Number(prestamo.cantidad_facturada || 0);
    const restante = Math.max(0, cantPrestada - cantDevuelta - cantFacturadaActual);

    if (cant > restante + 0.0001) {
      return jsonError(`La cantidad ingresada (${cant}) supera el saldo pendiente del préstamo (${restante})`, 400, request);
    }

    const nuevaCantFacturada = cantFacturadaActual + cant;
    let nuevoEstado = 'pendiente';
    if (cantDevuelta + nuevaCantFacturada >= cantPrestada - 0.0001) {
      nuevoEstado = 'facturado';
    }

    const precioUnitario = Number(prestamo.producto?.precio_usd || 0);
    const totalCargo = Math.round((cant * precioUnitario) * 100) / 100;

    if (totalCargo <= 0) {
      return jsonError('El costo del artículo es cero. No se puede facturar un préstamo sin valor de referencia.', 400, request);
    }

    // 2. Obtener saldo pendiente actual del cliente
    const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${prestamo.cliente_id}&select=saldo_pendiente`, { headers });
    const [cliente] = await cliRes.json();
    const saldoActual = Number(cliente?.saldo_pendiente || 0);
    const nuevoSaldo = saldoActual + totalCargo;

    // 3. Crear cargo en Cuentas por Cobrar (CxC)
    const despachoNum = prestamo.despacho?.numero ? `DES-${String(prestamo.despacho.numero).padStart(5, '0')}` : 'Préstamo';
    const cargoBody = {
      cliente_id: prestamo.cliente_id,
      despacho_id: prestamo.despacho_id,
      tipo: 'cargo',
      monto_usd: totalCargo,
      saldo_usd: nuevoSaldo,
      descripcion: `Facturación de préstamo de ${cant} und ${prestamo.producto?.nombre || 'Producto'} (Orig: ${despachoNum})`,
      registrado_por: operador.id
    };
    const cxcPost = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(cargoBody)
    });
    if (!cxcPost.ok) {
      const err = await cxcPost.text();
      return jsonError(`Error al crear cargo de cuentas por cobrar: ${err}`, 500, request);
    }

    // 4. Actualizar préstamo a facturado
    const patchLp = await fetch(`${env.SUPABASE_URL}/rest/v1/cliente_prestamos?id=eq.${prestamoId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        cantidad_facturada: nuevaCantFacturada,
        estado: nuevoEstado
      })
    });
    if (!patchLp.ok) {
      const err = await patchLp.text();
      return jsonError(`Error al actualizar préstamo: ${err}`, 500, request);
    }

    // 5. Sincronizar saldo de clientes
    await recalcularSaldoPendienteCliente(prestamo.cliente_id, env, headers);

    // 6. Registrar en seguimiento_operativo
    const timelinesPayload = {
      cliente_id: prestamo.cliente_id,
      despacho_id: prestamo.despacho_id,
      usuario_id: operador.id,
      tipo: 'seguimiento',
      prioridad: 'informativa',
      titulo: 'Conversión de préstamo a venta',
      contenido: `Se facturaron y cargaron a cuenta ${cant} ${prestamo.producto?.unidad || 'und'} de "${prestamo.producto?.nombre || 'Producto'}" por un total de $${totalCargo.toFixed(2)} USD.`,
      imagenes: [],
      fijada: false,
      cuenta_id: user.id
    };
    await fetch(`${env.SUPABASE_URL}/rest/v1/seguimiento_operativo`, {
      method: 'POST',
      headers,
      body: JSON.stringify(timelinesPayload)
    });

    // 7. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'FINANZAS', accion: 'FACTURAR_PRESTAMO',
      descripcion: `Facturación de préstamo #${prestamoId}: ${cant} und de ${prestamo.producto?.nombre} por $${totalCargo}`,
      entidadTipo: 'cliente', entidadId: prestamo.cliente_id,
      meta: { prestamo_id: prestamoId, cantidad: cant, monto: totalCargo, estado_nuevo: nuevoEstado }, ip
    });

    return json({ ok: true, nuevoEstado, cantidad_facturada: nuevaCantFacturada, cargo: totalCargo }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al facturar préstamo', 500, request);
  }
}
