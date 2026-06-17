// api/handlers/cxc.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

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
        } else if (item.tipo === 'devolucion_credito') {
          saldoFavor -= monto;
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
    
    console.log(`[RECALCULO-SALDO] Cliente ${clienteId} saldo sincronizado a deuda $${saldoReal}, credito $${saldoFavor}`);
  } catch (err) {
    console.error(`[RECALCULO-SALDO] Error al recalcular saldo para cliente ${clienteId}:`, err?.message);
  }
}

export async function handleRegistrarAbono(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_ABONO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_ABONO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar abonos', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { clienteId, monto, formaPago, referencia, descripcion, despachoId } = body;
  if (!clienteId || !isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  if (!monto || monto <= 0) return jsonError('Monto inválido', 400, request);

  try {
    // 1. Obtener cliente y su saldo actual
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=saldo_pendiente`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado', 404, request);

    let saldoActual = Number(cliente.saldo_pendiente || 0);

    // Auto-sanación para despachos COD heredados (anteriores a la actualización de cargos automáticos)
    if (despachoId) {
      const cargoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id`, { headers });
      const cargos = await cargoRes.json();
      if (Array.isArray(cargos) && cargos.length === 0) {
        console.log(`[AUTO-HEAL] Creando cargo CxC faltante para despacho COD heredado: ${despachoId}`);
        
        // Obtener el despacho y su forma_pago para extraer el monto de "Cobro a destino" correcto
        const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=forma_pago,total_usd`, { headers });
        const despachos = await dRes.json();
        let montoCargo = Number(monto); // Fallback al monto del abono si no se puede leer el despacho
        
        if (Array.isArray(despachos) && despachos.length > 0) {
          const desp = despachos[0];
          try {
            const fps = typeof desp.forma_pago === 'string' ? JSON.parse(desp.forma_pago) : desp.forma_pago;
            if (Array.isArray(fps)) {
              const cod = fps.find(f => f.metodo === 'Cobro a destino');
              if (cod && cod.monto) {
                montoCargo = Number(cod.monto);
              }
            }
          } catch (err) {
            console.error('[AUTO-HEAL] Error parseando forma_pago del despacho:', err);
          }
        }

        // 1.1 Crear el cargo CxC faltante
        const cargoBody = {
          cliente_id: clienteId,
          despacho_id: despachoId,
          tipo: 'cargo',
          monto_usd: montoCargo,
          saldo_usd: saldoActual + montoCargo,
          descripcion: `Cargo COD auto-generado (Legacy DES)`,
          registrado_por: operador.id,
          metodo_pago: 'cod'
        };

        const postCargo = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify(cargoBody)
        });

        if (postCargo.ok) {
          // 1.2 Actualizar saldo actual en memoria y en base de datos
          saldoActual += montoCargo;
          await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ saldo_pendiente: saldoActual })
          });
        }
      }
    }

    // Ajustar por diferencias infinitesimales de coma flotante si es para saldar
    let montoAbonar = Number(monto);
    const roundedMonto = Math.round(montoAbonar * 100) / 100;
    const roundedSaldo = Math.round(saldoActual * 100) / 100;

    if (roundedMonto === roundedSaldo) {
      // Si redondeados a centavos son iguales, forzar el monto del abono al saldo exacto de base de datos
      // para saldar la cuenta al 100% sin dejar saldos residuales decimales como 0.0001
      montoAbonar = saldoActual;
    } else if (roundedMonto > roundedSaldo) {
      // Si excede por una fracción menor a 1.5 centavos, ajustar al saldo real
      const diff = montoAbonar - saldoActual;
      if (diff > 0 && diff < 0.015) {
        montoAbonar = saldoActual;
      } else {
        return jsonError(`El abono ($${monto}) supera el saldo pendiente ($${saldoActual.toFixed(4)})`, 400, request);
      }
    }

    const nuevoSaldo = Math.max(0, Math.round((saldoActual - montoAbonar) * 10000) / 10000);

    // 2. Registrar abono
    const aRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id: clienteId,
        despacho_id: despachoId || null,
        tipo: 'abono',
        monto_usd: montoAbonar,
        forma_pago_abono: formaPago,
        referencia,
        saldo_usd: nuevoSaldo,
        descripcion: descripcion || 'Abono recibido',
        registrado_por: operador.id
      }),
    });
    if (!aRes.ok) {
      const err = await aRes.text();
      return jsonError(`Error al registrar abono: ${err}`, 500, request);
    }
    const [abono] = await aRes.json();

    // 3. Recalcular saldo pendiente real del cliente de forma unificada desde la base de datos
    await recalcularSaldoPendienteCliente(clienteId, env, headers);

    // 4. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'REGISTRAR_ABONO', descripcion: `Abono de $${montoAbonar} registrado para cliente ${clienteId}`,
        entidadTipo: 'cliente', entidadId: clienteId, meta: { monto: montoAbonar, forma_pago: formaPago, saldo_anterior: saldoActual, saldo_nuevo: nuevoSaldo }, ip,
      });
    } catch {}

    return json({ id: abono.id, nuevoSaldo }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al registrar abono', 500, request);
  }
}

export async function handleRevertirAbono(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // Restringir a administración, jefe y desarrollador
  const ROLES_REVERTIR = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_REVERTIR.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden revertir abonos o saldos a favor', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { abonoId } = body;
  if (!abonoId || !isValidUuid(abonoId)) return jsonError('abonoId inválido', 400, request);

  try {
    // 1. Obtener la transacción para verificar que existe y es de tipo abono o crédito
    const abonoRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${abonoId}`, { headers });
    const abonos = await abonoRes.json();
    if (!Array.isArray(abonos) || abonos.length === 0) {
      return jsonError('La transacción no existe', 404, request);
    }
    const abono = abonos[0];
    if (abono.tipo !== 'abono' && abono.tipo !== 'credito' && abono.tipo !== 'devolucion_credito') {
      return jsonError('Solo se pueden revertir transacciones de tipo abono, crédito (saldo a favor) o devolución de crédito', 400, request);
    }

    const { cliente_id: clienteId, monto_usd: montoMov, tipo } = abono;

    if (tipo === 'credito') {
      // Validar si el cliente tiene suficiente saldo_a_favor disponible para ser revertido (es decir, no ha sido consumido)
      const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=saldo_a_favor`, { headers });
      const clients = await cRes.json();
      if (!Array.isArray(clients) || clients.length === 0) {
        return jsonError('Cliente no encontrado', 404, request);
      }
      const client = clients[0];
      const saldoFavorActual = Number(client.saldo_a_favor || 0);

      // Usamos una pequeña tolerancia para flotantes, ej. montoMov - 0.005
      if (saldoFavorActual < montoMov - 0.005) {
        return jsonError('No se puede revertir este crédito porque ya ha sido consumido parcial o totalmente.', 400, request);
      }
    }

    // 2. Eliminar la transacción
    const delRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${abonoId}`, {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=minimal' },
    });
    if (!delRes.ok) {
      const err = await delRes.text();
      return jsonError(`Error al eliminar la transacción: ${err}`, 500, request);
    }

    // 3. Recalcular saldo pendiente y saldo a favor del cliente para sincronizar
    await recalcularSaldoPendienteCliente(clienteId, env, headers);

    // 4. Auditoría
    try {
      const accionAuditoria = tipo === 'credito' ? 'REVERTIR_CREDITO' : tipo === 'devolucion_credito' ? 'REVERTIR_DEVOLUCION_CREDITO' : 'REVERTIR_ABONO';
      const descAuditoria = tipo === 'credito' 
        ? `Carga de crédito (saldo a favor) de $${montoMov} revertida para cliente ${clienteId}` 
        : tipo === 'devolucion_credito'
        ? `Devolución de saldo a favor de $${montoMov} revertida para cliente ${clienteId}`
        : `Abono de $${montoMov} revertido para cliente ${clienteId}`;
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: accionAuditoria,
        descripcion: descAuditoria,
        entidadTipo: 'cliente', entidadId: clienteId,
        meta: { abonoId, monto: montoMov, tipo }, ip,
      });
    } catch {}

    return json({ success: true }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al revertir la transacción', 500, request);
  }
}

export async function handleRegistrarSaldoFavor(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_SALDO_FAVOR = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_SALDO_FAVOR.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar saldo a favor', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { clienteId, monto, formaPago, referencia, descripcion } = body;
  if (!clienteId || !isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  if (!monto || monto <= 0) return jsonError('Monto inválido', 400, request);

  try {
    // 1. Obtener cliente y su saldo a favor actual
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=saldo_a_favor`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado', 404, request);

    let saldoFavorActual = Number(cliente.saldo_a_favor || 0);
    const nuevoSaldoFavor = Math.max(0, Math.round((saldoFavorActual + Number(monto)) * 10000) / 10000);

    // 2. Registrar crédito en cuentas_por_cobrar
    const aRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id: clienteId,
        tipo: 'credito',
        monto_usd: Number(monto),
        forma_pago_abono: formaPago || null,
        referencia: referencia || null,
        saldo_usd: nuevoSaldoFavor,
        descripcion: descripcion || 'Saldo a favor registrado',
        registrado_por: operador.id
      }),
    });
    if (!aRes.ok) {
      const err = await aRes.text();
      return jsonError(`Error al registrar saldo a favor: ${err}`, 500, request);
    }
    const [creditoRow] = await aRes.json();

    // 3. Recalcular
    await recalcularSaldoPendienteCliente(clienteId, env, headers);

    // 4. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'REGISTRAR_SALDO_FAVOR', descripcion: `Saldo a favor de $${monto} registrado para cliente ${clienteId}`,
        entidadTipo: 'cliente', entidadId: clienteId, meta: { monto, forma_pago: formaPago, saldo_anterior: saldoFavorActual, saldo_nuevo: nuevoSaldoFavor }, ip,
      });
    } catch {}

    return json({ id: creditoRow.id, nuevoSaldoFavor }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al registrar saldo a favor', 500, request);
  }
}

export async function handleCruzarSaldoFavor(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_CRUZAR = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_CRUZAR.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden cruzar saldo a favor', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { clienteId, monto } = body;
  if (!clienteId || !isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  if (!monto || monto <= 0) return jsonError('Monto inválido', 400, request);

  try {
    // 1. Obtener cliente, saldo_pendiente y saldo_a_favor
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=saldo_pendiente,saldo_a_favor`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado', 404, request);

    let saldoPendiente = Number(cliente.saldo_pendiente || 0);
    let saldoFavor = Number(cliente.saldo_a_favor || 0);

    if (saldoFavor <= 0) {
      return jsonError('El cliente no tiene saldo a favor disponible', 400, request);
    }
    if (saldoPendiente <= 0) {
      return jsonError('El cliente no tiene saldo pendiente por pagar', 400, request);
    }

    // Validar que el monto cruzado no supere lo que el cliente tiene ni lo que debe
    let montoCruzar = Number(monto);
    
    // Tolerancia de coma flotante
    if (montoCruzar > saldoFavor) {
      const diff = montoCruzar - saldoFavor;
      if (diff < 0.015) {
        montoCruzar = saldoFavor;
      } else {
        return jsonError(`El monto a cruzar ($${montoCruzar}) supera el saldo a favor disponible ($${saldoFavor})`, 400, request);
      }
    }

    if (montoCruzar > saldoPendiente) {
      const diff = montoCruzar - saldoPendiente;
      if (diff < 0.015) {
        montoCruzar = saldoPendiente;
      } else {
        return jsonError(`El monto a cruzar ($${montoCruzar}) supera el saldo pendiente de deuda ($${saldoPendiente})`, 400, request);
      }
    }

    const nuevoSaldoPendiente = Math.max(0, Math.round((saldoPendiente - montoCruzar) * 10000) / 10000);
    const nuevoSaldoFavor = Math.max(0, Math.round((saldoFavor - montoCruzar) * 10000) / 10000);

    // 2. Registrar el cruce como un abono (que reduce deuda y consume saldo a favor)
    const aRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id: clienteId,
        tipo: 'abono',
        monto_usd: montoCruzar,
        forma_pago_abono: 'Saldo a favor',
        referencia: 'Cruce interno',
        saldo_usd: nuevoSaldoPendiente,
        descripcion: `Cruce de saldo a favor contra deuda`,
        registrado_por: operador.id
      }),
    });
    if (!aRes.ok) {
      const err = await aRes.text();
      return jsonError(`Error al registrar cruce de saldo: ${err}`, 500, request);
    }
    const [abonoRow] = await aRes.json();

    // 3. Recalcular
    await recalcularSaldoPendienteCliente(clienteId, env, headers);

    // 4. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'CRUZAR_SALDO_FAVOR', descripcion: `Cruce de saldo a favor de $${montoCruzar} para cliente ${clienteId}`,
        entidadTipo: 'cliente', entidadId: clienteId, 
        meta: { 
          monto: montoCruzar, 
          saldo_pendiente_anterior: saldoPendiente, saldo_pendiente_nuevo: nuevoSaldoPendiente,
          saldo_favor_anterior: saldoFavor, saldo_favor_nuevo: nuevoSaldoFavor 
        }, ip,
      });
    } catch {}

    return json({ id: abonoRow.id, nuevoSaldoPendiente, nuevoSaldoFavor }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al cruzar saldo a favor', 500, request);
  }
}

export async function handleRegistrarDevolucionCredito(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_DEVOLUCION = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_DEVOLUCION.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar devoluciones de saldo a favor', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { clienteId, monto, formaPago, referencia, descripcion } = body;
  if (!clienteId || !isValidUuid(clienteId)) return jsonError('clienteId inválido', 400, request);
  if (!monto || monto <= 0) return jsonError('Monto inválido', 400, request);

  try {
    // 1. Obtener cliente y su saldo a favor actual
    const cRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=saldo_a_favor`, { headers });
    const [cliente] = await cRes.json();
    if (!cliente) return jsonError('Cliente no encontrado', 404, request);

    let saldoFavorActual = Number(cliente.saldo_a_favor || 0);

    // Validar que el monto no exceda el saldo a favor actual (con tolerancia a float)
    if (monto > saldoFavorActual + 0.005) {
      return jsonError(`El monto a devolver ($${monto}) supera el saldo a favor disponible ($${saldoFavorActual.toFixed(2)})`, 400, request);
    }

    // Ajustar por precisiones de coma flotante si es para saldar por completo
    let montoDevolver = Number(monto);
    if (Math.abs(montoDevolver - saldoFavorActual) < 0.015) {
      montoDevolver = saldoFavorActual;
    }

    const nuevoSaldoFavor = Math.max(0, Math.round((saldoFavorActual - montoDevolver) * 10000) / 10000);

    // 2. Registrar devolución de crédito en cuentas_por_cobrar
    const aRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id: clienteId,
        tipo: 'devolucion_credito',
        monto_usd: montoDevolver,
        forma_pago_abono: formaPago || null,
        referencia: referencia || null,
        saldo_usd: nuevoSaldoFavor,
        descripcion: descripcion || 'Devolución de saldo a favor registrada',
        registrado_por: operador.id
      }),
    });
    if (!aRes.ok) {
      const err = await aRes.text();
      return jsonError(`Error al registrar devolución de saldo a favor: ${err}`, 500, request);
    }
    const [row] = await aRes.json();

    // 3. Recalcular
    await recalcularSaldoPendienteCliente(clienteId, env, headers);

    // 4. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'FINANZAS', accion: 'REGISTRAR_DEVOLUCION_CREDITO', descripcion: `Devolución de saldo a favor de $${montoDevolver} registrado para cliente ${clienteId}`,
        entidadTipo: 'cliente', entidadId: clienteId, meta: { monto: montoDevolver, forma_pago: formaPago, saldo_anterior: saldoFavorActual, saldo_nuevo: nuevoSaldoFavor }, ip,
      });
    } catch {}

    return json({ id: row.id, nuevoSaldoFavor }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al registrar devolución de saldo a favor', 500, request);
  }
}


