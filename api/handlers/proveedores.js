// api/handlers/proveedores.js
import { json, jsonError, isValidUuid, removeAccents } from '../lib/utils.js'
import { verifyAuth, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

// Helper para sincronizar saldo pendiente del proveedor
async function recalcularSaldoPendienteProveedor(proveedorId, env, headers) {
  try {
    const cppRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar?proveedor_id=eq.${proveedorId}&select=tipo,monto_usd`, { headers });
    if (!cppRes.ok) return;
    const cppList = await cppRes.json();
    
    let saldoReal = 0;
    if (Array.isArray(cppList)) {
      cppList.forEach(item => {
        const monto = Number(item.monto_usd) || 0;
        if (item.tipo === 'cargo') {
          saldoReal += monto;
        } else {
          saldoReal -= monto;
        }
      });
    }
    
    saldoReal = Math.max(0, Math.round(saldoReal * 10000) / 10000);
    
    await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores?id=eq.${proveedorId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_pendiente: saldoReal }),
    });
    
    console.log(`[RECALCULO-SALDO] Proveedor ${proveedorId} saldo sincronizado a $${saldoReal}`);
  } catch (err) {
    console.error(`[RECALCULO-SALDO] Error al recalcular saldo para proveedor ${proveedorId}:`, err?.message);
  }
}

// 1. Listar proveedores (con filtro por búsqueda)
export async function handleListarProveedores(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('No tienes permisos para listar proveedores', 403, request);
  }

  const url = new URL(request.url);
  const busqueda = url.searchParams.get('busqueda') || '';

  try {
    const queryUrl = `${env.SUPABASE_URL}/rest/v1/proveedores?cuenta_id=eq.${user.id}&order=nombre.asc&limit=1000`;
    const res = await fetch(queryUrl, { headers });
    if (!res.ok) {
      const errText = await res.text();
      return jsonError(`Error al cargar proveedores: ${errText}`, res.status, request);
    }

    let data = await res.json();

    if (busqueda.trim()) {
      const raw = removeAccents(busqueda.trim().toLowerCase());
      const norm = raw.replace(/[\.\-\(\)\s\/\\]/g, '');

      data = data.filter(p => {
        const nombre = removeAccents((p.nombre || '').toLowerCase());
        const rif = removeAccents((p.rif_cedula || '').toLowerCase().replace(/[\.\-\(\)\s\/\\]/g, ''));
        const tel = removeAccents((p.telefono || '').toLowerCase().replace(/[\.\-\(\)\s\/\\]/g, ''));
        const email = removeAccents((p.email || '').toLowerCase());

        return (
          nombre.includes(raw) ||
          rif.includes(norm) ||
          tel.includes(norm) ||
          email.includes(raw)
        );
      });
    }

    return json(data, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al listar proveedores', 500, request);
  }
}

// 2. Pre-chequeo de RIF/cédula
export async function handleCheckRifProveedor(request, env) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  const url = new URL(request.url);
  const rif = url.searchParams.get('rif');
  const exclude = url.searchParams.get('exclude');
  if (!rif) return json({ existe: false }, 200, request);

  try {
    let queryUrl = `${env.SUPABASE_URL}/rest/v1/proveedores?rif_cedula=eq.${encodeURIComponent(rif)}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre&limit=1`;
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

    return json({
      existe: true,
      nombre: data[0].nombre,
    }, 200, request);
  } catch (e) {
    return json({ existe: false }, 200, request);
  }
}

// 3. Crear Proveedor
export async function handleCrearProveedor(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('No tienes permisos para crear proveedores', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { nombre, rif_cedula, telefono, email, direccion, estado, ciudad, notas, tipo_proveedor } = body;
  if (!nombre?.trim()) return jsonError('El nombre es obligatorio', 400, request);

  // Verificar duplicado de RIF
  if (rif_cedula?.trim()) {
    const checkUrl = `${env.SUPABASE_URL}/rest/v1/proveedores?rif_cedula=eq.${encodeURIComponent(rif_cedula.trim())}&activo=eq.true&cuenta_id=eq.${user.id}&select=id&limit=1`;
    const checkRes = await fetch(checkUrl, { headers });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) return jsonError('Ya existe un proveedor con ese RIF/cédula', 409, request);
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
    tipo_proveedor: tipo_proveedor || 'juridico',
    cuenta_id: user.id,
    activo: true,
  };

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al crear proveedor: ${err}`, res.status, request);
    }

    const [data] = await res.json();

    // Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'SISTEMA', accion: 'CREAR_PROVEEDOR',
      descripcion: `Proveedor "${payload.nombre}" creado por ${operador.nombre}`,
      entidadTipo: 'proveedor', entidadId: data.id, ip,
    });

    return json(data, 201, request);
  } catch (e) {
    return jsonError(e.message || 'Error al crear proveedor', 500, request);
  }
}

// 4. Actualizar Proveedor
export async function handleActualizarProveedor(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('No tienes permisos para actualizar proveedores', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { id, nombre, rif_cedula, telefono, email, direccion, estado, ciudad, notas, tipo_proveedor } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);
  if (!nombre?.trim()) return jsonError('El nombre es obligatorio', 400, request);

  // Verificar duplicado de RIF excluyendo este ID
  if (rif_cedula?.trim()) {
    const checkUrl = `${env.SUPABASE_URL}/rest/v1/proveedores?rif_cedula=eq.${encodeURIComponent(rif_cedula.trim())}&activo=eq.true&cuenta_id=eq.${user.id}&id=neq.${id}&select=id&limit=1`;
    const checkRes = await fetch(checkUrl, { headers });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) return jsonError('Ya existe un proveedor con ese RIF/cédula', 409, request);
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
    tipo_proveedor: tipo_proveedor || 'juridico',
    actualizado_en: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores?id=eq.${id}&cuenta_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al actualizar proveedor: ${err}`, res.status, request);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return jsonError('Proveedor no encontrado o no tienes permisos', 404, request);
    }

    // Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'SISTEMA', accion: 'ACTUALIZAR_PROVEEDOR',
      descripcion: `Proveedor "${payload.nombre}" actualizado por ${operador.nombre}`,
      entidadTipo: 'proveedor', entidadId: id, ip,
    });

    return json(data[0], 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al actualizar proveedor', 500, request);
  }
}

// 5. Borrar / Desactivar Proveedor
export async function handleBorrarProveedor(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('No tienes permisos para borrar proveedores', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { id } = body;
  if (!id || !isValidUuid(id)) return jsonError('ID inválido', 400, request);

  try {
    // Verificar si el proveedor existe
    const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores?id=eq.${id}&cuenta_id=eq.${user.id}&select=id,nombre,saldo_pendiente`, { headers });
    const [proveedor] = await pRes.json();
    if (!proveedor) return jsonError('Proveedor no encontrado', 404, request);

    if (Number(proveedor.saldo_pendiente || 0) > 0) {
      return jsonError(`No se puede eliminar "${proveedor.nombre}" porque se le debe un saldo de $${Number(proveedor.saldo_pendiente).toFixed(2)}. Cancela la deuda primero.`, 409, request);
    }

    // Verificar si tiene transacciones en cuentas_por_pagar
    const cppRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar?proveedor_id=eq.${id}&select=id&limit=1`, { headers });
    const cpps = await cppRes.json();
    const tieneHistorial = Array.isArray(cpps) && cpps.length > 0;

    if (tieneHistorial) {
      // Solo desactivar para no romper integridad referencial
      await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores?id=eq.${id}&cuenta_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() }),
      });

      // Auditoría
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'SISTEMA', accion: 'DESACTIVAR_PROVEEDOR',
        descripcion: `Proveedor "${proveedor.nombre}" desactivado por tener historial contable`,
        entidadTipo: 'proveedor', entidadId: id, ip,
      });

      return json({ accion: 'desactivado', nombre: proveedor.nombre }, 200, request);
    }

    // Borrado físico real ya que no tiene transacciones asociadas
    const delRes = await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores?id=eq.${id}&cuenta_id=eq.${user.id}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=minimal' },
    });

    if (!delRes.ok && delRes.status !== 204) {
      const err = await delRes.text();
      return jsonError(`Error al borrar proveedor: ${err}`, delRes.status, request);
    }

    // Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'SISTEMA', accion: 'ELIMINAR_PROVEEDOR',
      descripcion: `Proveedor "${proveedor.nombre}" eliminado físicamente`,
      entidadTipo: 'proveedor', entidadId: id, ip,
    });

    return json({ accion: 'eliminado', nombre: proveedor.nombre }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al borrar proveedor', 500, request);
  }
}

// 6. Consultar historial de cuentas por pagar (CxP)
export async function handleGetCuentasPorPagar(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { headers } = v;

  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(v.operador.rol)) {
    return jsonError('No tienes permisos para ver CxP', 403, request);
  }

  const url = new URL(request.url);
  const proveedorId = url.searchParams.get('proveedorId');
  if (!proveedorId || !isValidUuid(proveedorId)) {
    return jsonError('proveedorId inválido', 400, request);
  }

  try {
    const queryUrl = `${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar?proveedor_id=eq.${proveedorId}&order=creado_en.desc&select=id,tipo,monto_usd,saldo_usd,forma_pago_abono,referencia,descripcion,fecha_vencimiento,creado_en,registrado_por,registrador:usuarios!cuentas_por_pagar_registrado_por_fkey(nombre)`;
    const res = await fetch(queryUrl, { headers });
    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al cargar movimientos de CxP: ${err}`, res.status, request);
    }
    const data = await res.json();
    return json(data, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error en consulta de CxP', 500, request);
  }
}

// 7. Registrar transacción en CxP (Cargo o Abono)
export async function handleRegistrarTransaccionCxP(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('No tienes permisos para registrar transacciones de CxP', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { proveedorId, tipo, monto, formaPago, referencia, descripcion, diasVencimiento } = body;
  if (!proveedorId || !isValidUuid(proveedorId)) return jsonError('proveedorId inválido', 400, request);
  if (!tipo || !['cargo', 'abono'].includes(tipo)) return jsonError('tipo de transacción inválido', 400, request);
  const montoNum = Number(monto);
  if (isNaN(montoNum) || montoNum <= 0) return jsonError('monto debe ser mayor a 0', 400, request);

  try {
    // 1. Obtener proveedor y saldo actual
    const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores?id=eq.${proveedorId}&select=saldo_pendiente,nombre`, { headers });
    const [proveedor] = await pRes.json();
    if (!proveedor) return jsonError('Proveedor no encontrado', 404, request);

    const saldoActual = Number(proveedor.saldo_pendiente || 0);

    let nuevoSaldo = saldoActual;
    let montoFinal = montoNum;

    if (tipo === 'cargo') {
      // Incrementa deuda
      nuevoSaldo += montoNum;
    } else {
      // Abono: decrementa deuda. Verificar que no exceda
      const roundedMonto = Math.round(montoNum * 100) / 100;
      const roundedSaldo = Math.round(saldoActual * 100) / 100;

      if (roundedMonto === roundedSaldo) {
        montoFinal = saldoActual; // Ajustar por decimales
      } else if (roundedMonto > roundedSaldo) {
        const diff = montoNum - saldoActual;
        if (diff > 0 && diff < 0.015) {
          montoFinal = saldoActual; // Ajuste por coma flotante
        } else {
          return jsonError(`El abono ($${montoNum}) supera la deuda actual ($${saldoActual.toFixed(2)})`, 400, request);
        }
      }
      nuevoSaldo -= montoFinal;
    }

    nuevoSaldo = Math.max(0, Math.round(nuevoSaldo * 10000) / 10000);

    let fechaVencimiento = null;
    if (tipo === 'cargo' && typeof diasVencimiento === 'number' && diasVencimiento > 0) {
      const date = new Date();
      date.setDate(date.getDate() + diasVencimiento);
      fechaVencimiento = date.toISOString();
    }

    // 2. Insertar movimiento
    const payload = {
      proveedor_id: proveedorId,
      tipo,
      monto_usd: montoFinal,
      saldo_usd: nuevoSaldo,
      forma_pago_abono: tipo === 'abono' ? (formaPago || 'Efectivo $') : null,
      referencia: tipo === 'abono' ? (referencia || null) : null,
      descripcion: descripcion || (tipo === 'cargo' ? 'Cargo (Deuda registrada)' : 'Abono (Pago registrado)'),
      fecha_vencimiento: fechaVencimiento,
      registrado_por: operador.id,
      cuenta_id: user.id
    };

    const postRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });

    if (!postRes.ok) {
      const err = await postRes.text();
      return jsonError(`Error al registrar movimiento en CxP: ${err}`, postRes.status, request);
    }
    const [transaccion] = await postRes.json();

    // 3. Recalcular saldo del proveedor de manera robusta
    await recalcularSaldoPendienteProveedor(proveedorId, env, headers);

    // 4. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'FINANZAS', accion: tipo === 'cargo' ? 'REGISTRAR_CARGO_CXP' : 'REGISTRAR_ABONO_CXP',
      descripcion: `${tipo === 'cargo' ? 'Cargo' : 'Abono'} de $${montoFinal} registrado para proveedor "${proveedor.nombre}"`,
      entidadTipo: 'proveedor', entidadId: proveedorId,
      meta: { monto: montoFinal, tipo, saldo_anterior: saldoActual, saldo_nuevo: nuevoSaldo }, ip,
    });

    return json({ id: transaccion.id, nuevoSaldo }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al registrar transacción contable', 500, request);
  }
}

// 8. Actualizar transacción en CxP
export async function handleActualizarTransaccionCxP(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const rolesPermitidos = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!rolesPermitidos.includes(operador.rol)) {
    return jsonError('No tienes permisos para actualizar transacciones de CxP', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { id, monto, descripcion, fechaVencimiento, formaPago, referencia } = body;
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request);

  try {
    // 1. Obtener la transacción actual
    const tRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar?id=eq.${id}`, { headers });
    const [transaccion] = await tRes.json();
    if (!transaccion) return jsonError('Transacción no encontrada', 404, request);

    const proveedorId = transaccion.proveedor_id;
    const tipo = transaccion.tipo;

    // 2. Construir payload de actualización
    const payload = {};
    if (descripcion !== undefined) payload.descripcion = descripcion;
    if (tipo === 'cargo' && fechaVencimiento !== undefined) payload.fecha_vencimiento = fechaVencimiento;
    if (tipo === 'abono' && formaPago !== undefined) payload.forma_pago_abono = formaPago;
    if (tipo === 'abono' && referencia !== undefined) payload.referencia = referencia;

    if (monto !== undefined) {
      const montoNum = Number(monto);
      if (isNaN(montoNum) || montoNum <= 0) return jsonError('monto debe ser mayor a 0', 400, request);
      payload.monto_usd = montoNum;
    }

    // 3. Guardar cambios de la transacción
    const updateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      return jsonError(`Error al actualizar transacción de CxP: ${err}`, updateRes.status, request);
    }

    // 4. Recalcular saldos de todos los movimientos de este proveedor chronológicamente si cambió el monto
    if (monto !== undefined && Number(monto) !== Number(transaccion.monto_usd)) {
      const getRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar?proveedor_id=eq.${proveedorId}&order=creado_en.asc`, { headers });
      if (getRes.ok) {
        const list = await getRes.json();
        let running = 0;
        for (const item of list) {
          const amt = Number(item.monto_usd) || 0;
          if (item.tipo === 'cargo') {
            running += amt;
          } else {
            running -= amt;
          }
          running = Math.max(0, Math.round(running * 10000) / 10000);
          
          if (Number(item.saldo_usd) !== running) {
            await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_pagar?id=eq.${item.id}`, {
              method: 'PATCH',
              headers: { ...headers, Prefer: 'return=minimal' },
              body: JSON.stringify({ saldo_usd: running })
            });
          }
        }
      }
    }

    // 5. Recalcular saldo total del proveedor en la tabla proveedores
    await recalcularSaldoPendienteProveedor(proveedorId, env, headers);

    // 6. Obtener saldo final del proveedor para retornar
    const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/proveedores?id=eq.${proveedorId}&select=saldo_pendiente`, { headers });
    const [proveedor] = await pRes.json();
    const nuevoSaldo = proveedor ? Number(proveedor.saldo_pendiente || 0) : 0;

    // 7. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'FINANZAS', accion: 'ACTUALIZAR_TRANSACCION_CXP',
      descripcion: `Transacción CxP de tipo ${tipo} ID ${id} editada por ${operador.nombre}`,
      entidadTipo: 'proveedor', entidadId: proveedorId,
      meta: { id, tipo, payload }, ip,
    });

    return json({ id, nuevoSaldo }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al actualizar transacción de CxP', 500, request);
  }
}

