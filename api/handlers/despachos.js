// api/handlers/despachos.js
import { json, jsonError, corsHeaders, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator, getOperatorRole, verifySupervisor, verifyPrivileged } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

async function recalcularSaldoPendienteCliente(clienteId, env, headers) {
  try {
    const cxcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?cliente_id=eq.${clienteId}&select=tipo,monto_usd`, { headers });
    if (!cxcRes.ok) return;
    const cxcList = await cxcRes.json();
    
    let saldoReal = 0;
    if (Array.isArray(cxcList)) {
      cxcList.forEach(item => {
        const monto = Number(item.monto_usd) || 0;
        if (item.tipo === 'cargo') {
          saldoReal += monto;
        } else {
          saldoReal -= monto;
        }
      });
    }
    
    saldoReal = Math.max(0, Math.round(saldoReal * 10000) / 10000);
    
    await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ saldo_pendiente: saldoReal }),
    });
    
    console.log(`[RECALCULO-SALDO] Cliente ${clienteId} saldo sincronizado a $${saldoReal}`);
  } catch (err) {
    console.error(`[RECALCULO-SALDO] Error al recalcular saldo para cliente ${clienteId}:`, err?.message);
  }
}


export async function handleCrearDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { cotizacionId, notas, formaPago, transportistaId, fleteUsd, corteUsd, clienteFacturaId, direccionEnvioDireccion, direccionEnvioCiudad, direccionEnvioEstado } = body;
  const flete = Math.max(0, Number(fleteUsd) || 0);
  const corte = Math.max(0, Number(corteUsd) || 0);
  if (!cotizacionId) return jsonError('Falta cotizacionId', 400, request);
  if (!isValidUuid(cotizacionId)) return jsonError('cotizacionId inválido', 400, request);

  try {
    // 1+2. Fetch cotización + check existing despacho in parallel
    const [cotRes, existRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}&select=*`, { headers }),
      fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?cotizacion_id=eq.${cotizacionId}&select=id,numero&limit=1`, { headers }),
    ]);
    const [cot] = await cotRes.json();
    if (!cot) return jsonError('Cotización no encontrada', 404, request);

    const existing = await existRes.json();
    if (existing && existing.length > 0) {
      return json({
        id: existing[0].id,
        numero: existing[0].numero,
        numeroCotizacion: cot.numero,
        clienteNombre: 'cliente',
        alreadyExists: true,
      }, 200, request);
    }

    const esSupervisorOp = operador.rol === 'supervisor';
    const esPropietario = cot.vendedor_id === operador.id;

    if (!['enviada', 'aceptada'].includes(cot.estado)) {
      return jsonError('La cotización debe estar enviada o aceptada para despachar', 400, request);
    }
    if (!esSupervisorOp && !esPropietario) {
      return jsonError(`Solo puedes despachar tus propias cotizaciones (op:${operador.id} vs vend:${cot.vendedor_id})`, 403, request);
    }

    // 3. Si está enviada, aceptarla automáticamente
    if (cot.estado === 'enviada') {
      await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${cotizacionId}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'aceptada' }),
      });
    }

    // Fetch cliente details and check if vendedor has no commission
    let clienteNombre = 'cliente';
    let esVendedorSinComision = false;
    if (cot.cliente_id) {
      const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${cot.cliente_id}&select=nombre,vendedor_id,vendedor:usuarios!clientes_vendedor_id_fkey(rol)`, { headers });
      if (cliRes.ok) {
        const cliData = await cliRes.json();
        if (cliData && cliData.length > 0) {
          clienteNombre = cliData[0].nombre;
          esVendedorSinComision = cliData[0].vendedor?.rol === 'vendedor_sin_comision';
        }
      }
    }

    if (formaPago) {
      try {
        const fps = typeof formaPago === 'string' ? JSON.parse(formaPago) : formaPago;
        if (Array.isArray(fps)) {
          const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
          if (cxc) {
            const dias = parseInt(cxc.diasVencimiento, 10);
            if (isNaN(dias) || dias <= 0) {
              return jsonError('Los días de vencimiento son obligatorios para cuentas por cobrar', 400, request);
            }
          }
        }
      } catch (e) {}
    }

    // 4. Crear nota de despacho (stock se descuenta al confirmar entrega por logística)
    // Se resta costo_envio_usd y corte_usd de la cotización (estimados) para evitar doble suma
    // con el flete y corte reales ingresados al momento del despacho.
    const cotEnvio = Number(cot.costo_envio_usd || 0);
    const cotCorte = Number(cot.corte_usd || 0);
    const totalBase = Number(cot.total_usd) - cotEnvio - cotCorte;
    const totalConFleteCorte = totalBase + flete + corte;
    const despRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?select=id,numero`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        cotizacion_id: cotizacionId,
        cliente_id: cot.cliente_id,
        cliente_factura_id: (clienteFacturaId && isValidUuid(clienteFacturaId)) ? clienteFacturaId : null,
        vendedor_id: cot.vendedor_id,
        transportista_id: transportistaId || cot.transportista_id,
        estado: 'pendiente',
        total_usd: totalConFleteCorte,
        flete_usd: flete,
        corte_usd: corte,
        notas: notas || null,
        forma_pago: formaPago || null,
        creado_por: user.operator_id,
        direccion_envio_direccion: direccionEnvioDireccion || null,
        direccion_envio_ciudad:    direccionEnvioCiudad || null,
        direccion_envio_estado:    direccionEnvioEstado || null,
      }),
    });

    if (!despRes.ok) {
      const err = await despRes.text();
      return jsonError(`Error al crear despacho: ${err}`, 500, request);
    }
    const [despacho] = await despRes.json();

    // ── Copiar ítems de la cotización al despacho (snapshot inicial) ──────────
    const ciSnap = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items` +
      `?cotizacion_id=eq.${cotizacionId}` +
      `&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden,origen` +
      `&order=orden.asc`,
      { headers }
    );
    const ciRows = await ciSnap.json();

    if (Array.isArray(ciRows) && ciRows.length > 0) {
      const despItems = ciRows.map((item, i) => ({
        despacho_id:       despacho.id,
        producto_id:       item.producto_id || null,
        codigo_snap:       item.codigo_snap || null,
        nombre_snap:       item.nombre_snap,
        unidad_snap:       item.unidad_snap || 'und',
        origen:            item.origen || 'inventario',
        cantidad_original: Number(item.cantidad),
        precio_original:   Number(item.precio_unit_usd),
        cantidad:          Number(item.cantidad),
        precio_unit_usd:   Number(item.precio_unit_usd),
        descuento_pct:     Number(item.descuento_pct || 0),
        total_linea_usd:   Number(item.total_linea_usd),
        orden:             item.orden ?? i,
      }));

      await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho_items`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(despItems),
      });
    }

    // Auditoría (fire-and-forget)
    registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'CREAR_DESPACHO',
      entidadTipo: 'nota_despacho', entidadId: despacho.id,
      meta: { cotizacion_id: cotizacionId, total_usd: cot.total_usd }, ip,
    }).catch(() => {});

    return json({
      id: despacho.id,
      numero: despacho.numero,
      numeroCotizacion: cot.numero,
      clienteNombre: clienteNombre
    }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al crear despacho', 500, request);
  }
}

export async function handleEditarPagoDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers: h, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { despachoId, formaPago, formaPagoCliente, referenciaPago, transportistaId, fleteUsd, corteUsd, notas, clienteId, direccionEnvioDireccion, direccionEnvioCiudad, direccionEnvioEstado } = body;
  if (!despachoId) return jsonError('Falta despachoId', 400, request);

  const checkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=id,estado,vendedor_id,flete_usd,corte_usd,total_usd,cotizacion_id,cliente_id`, { headers: h });
  if (!checkRes.ok) return jsonError('Error al verificar despacho', 500, request);
  const despachos = await checkRes.json();
  if (!despachos.length) return jsonError('Despacho no encontrado', 404, request);
  const despacho = despachos[0];
  
  const esAdmin = ['supervisor', 'administracion', 'jefe', 'desarrollador', 'logistica'].includes(operador.rol);
  const esVendedorDueno = despacho.vendedor_id === operador.id;
  if (!esAdmin && !esVendedorDueno) return jsonError('No tienes permiso para editar este despacho', 403, request);

  const cliToCheck = clienteId || despacho.cliente_id;
  let esVendedorSinComision = false;
  if (cliToCheck) {
    try {
      const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${cliToCheck}&select=vendedor_id,vendedor:usuarios!clientes_vendedor_id_fkey(rol)`, { headers: h });
      if (cliRes.ok) {
        const cliData = await cliRes.json();
        if (Array.isArray(cliData) && cliData.length > 0) {
          esVendedorSinComision = cliData[0].vendedor?.rol === 'vendedor_sin_comision';
        }
      }
    } catch {}
  }

  if (formaPago) {
    try {
      const fps = typeof formaPago === 'string' ? JSON.parse(formaPago) : formaPago;
      if (Array.isArray(fps)) {
        const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
        if (cxc) {
          const dias = parseInt(cxc.diasVencimiento, 10);
          if (isNaN(dias) || dias <= 0) {
            return jsonError('Los días de vencimiento son obligatorios para cuentas por cobrar', 400, request);
          }
        }
      }
    } catch {}
  }

  const esConciliacionCod = formaPago !== undefined && 
    (['administracion', 'desarrollador', 'supervisor', 'jefe'].includes(operador.rol));

  if (despacho.estado === 'entregada' && !esConciliacionCod) {
    return jsonError('No se pueden editar despachos en estado entregado', 400, request);
  }

  if (despacho.estado !== 'pendiente' && !esConciliacionCod) {
    const tieneCamposFinancierosRestringidos = formaPago !== undefined || formaPagoCliente !== undefined || referenciaPago !== undefined || corteUsd !== undefined || clienteId !== undefined;
    if (tieneCamposFinancierosRestringidos) {
      return jsonError('No se pueden editar datos financieros en un despacho aprobado', 400, request);
    }
    if (transportistaId === undefined && fleteUsd === undefined && notas === undefined) {
      return jsonError('No hay campos editables para este estado', 400, request);
    }
  }

  // Actualizar campos
  const campos = {};
  if (formaPago !== undefined) campos.forma_pago = formaPago;
  if (formaPagoCliente !== undefined) campos.forma_pago_cliente = formaPagoCliente;
  if (referenciaPago !== undefined) campos.referencia_pago = referenciaPago;
  if (direccionEnvioDireccion !== undefined) campos.direccion_envio_direccion = direccionEnvioDireccion || null;
  if (direccionEnvioCiudad !== undefined) campos.direccion_envio_ciudad = direccionEnvioCiudad || null;
  if (direccionEnvioEstado !== undefined) campos.direccion_envio_estado = direccionEnvioEstado || null;
  if (transportistaId !== undefined) campos.transportista_id = transportistaId || null;
  if (fleteUsd !== undefined || corteUsd !== undefined) {
    const nuevoFlete = fleteUsd !== undefined ? (Number(fleteUsd) || 0) : Number(despacho.flete_usd || 0);
    const nuevoCorte = corteUsd !== undefined ? (Number(corteUsd) || 0) : Number(despacho.corte_usd || 0);
    const fleteAnterior = Number(despacho.flete_usd) || 0;
    const corteAnterior = Number(despacho.corte_usd) || 0;
    campos.flete_usd = nuevoFlete;
    campos.corte_usd = nuevoCorte;
    // Recalcular total_usd: total actual - flete/corte anterior + nuevo flete/corte
    campos.total_usd = Number(despacho.total_usd) - fleteAnterior - corteAnterior + nuevoFlete + nuevoCorte;
  }
  if (notas !== undefined) campos.notas = notas || null;
  if (clienteId !== undefined && isValidUuid(clienteId)) {
    campos.cliente_id = clienteId;
    campos.cliente_factura_id = clienteId;

    // Buscar el vendedor dueño del cliente para mantener consistencia
    try {
      const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=vendedor_id`, { headers: h });
      if (cliRes.ok) {
        const cliData = await cliRes.json();
        if (Array.isArray(cliData) && cliData.length > 0 && cliData[0].vendedor_id) {
          campos.vendedor_id = cliData[0].vendedor_id;
        }
      }
    } catch (cliErr) {
      console.error('[EDITAR_PAGO] Error al sincronizar vendedor del cliente:', cliErr?.message);
    }
  }

  if (Object.keys(campos).length === 0) return jsonError('No hay campos para actualizar', 400, request);

  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}`, {
    method: 'PATCH',
    headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify(campos),
  });
  if (!upRes.ok) return jsonError('Error al actualizar despacho', 500, request);

  // Recalcular comision si ya existe (porque pudo cambiar el total o forma de pago)
  const comRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&select=id`, { headers: h });
  const comEntries = await comRes.json();
  if (Array.isArray(comEntries) && comEntries.length > 0) {
    const vendRolRes2 = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${despacho.vendedor_id}&select=rol,markup_pct`,
      { headers: h }
    );
    const [vendRol2] = await vendRolRes2.json();
    console.log('[COMISION][EDITAR_PAGO] rol vendedor:', vendRol2?.rol, 'markup:', vendRol2?.markup_pct);

    let esDonacion = false;
    const fpToCheck = formaPago !== undefined ? formaPago : despacho.forma_pago;
    if (fpToCheck) {
      try {
        const fps = typeof fpToCheck === 'string' ? JSON.parse(fpToCheck) : fpToCheck;
        if (Array.isArray(fps)) {
          esDonacion = fps.some(f => f.metodo === 'Donación');
        } else if (typeof fps === 'string') {
          esDonacion = fps === 'Donación';
        }
      } catch (e) {}
    }

    if (esDonacion || ['jefe', 'logistica', 'administracion', 'desarrollador'].includes(vendRol2?.rol) || (vendRol2?.rol === 'vendedor_sin_comision' && parseFloat(vendRol2?.markup_pct || 0) <= 0)) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}`, {
        method: 'DELETE', headers: h,
      });
      console.log('[COMISION][EDITAR_PAGO] Comisión eliminada por ser método Donación o rol exento.');
    } else {
      await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}`, {
        method: 'DELETE', headers: h,
      });
      await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calcularcomisiondespacho`, {
        method: 'POST', headers: { ...h, Prefer: 'return=representation' },
        body: JSON.stringify({ p_despachoid: despachoId }),
      });
    }
  }

  // Auditoría
  try {
    await registrarAuditoria(env, h, {
      usuarioId: operador.id,
      usuarioNombre: operador.nombre,
      usuarioRol: operador.rol,
      categoria: 'COTIZACION',
      accion: 'EDITAR_PAGO_DESPACHO',
      descripcion: `Despacho ${despachoId.slice(0,8)} editado (pago/transportista/notas)`,
      entidadTipo: 'despacho',
      entidadId: despachoId,
      meta: campos,
      ip: request.headers.get('CF-Connecting-IP') || null,
    });
  } catch {}

  return json({ ok: true }, 200, request);
}

export async function handleActualizarEstadoDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId, nuevoEstado, tasaBcv } = body;
  if (!despachoId || !nuevoEstado) return jsonError('Faltan campos', 400, request);
  if (!isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);

  try {
    // 1. Obtener despacho
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=*`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);

    // 2. Validar transición
    const valid = (desp.estado === 'pendiente' && ['despachada', 'entregada', 'anulada'].includes(nuevoEstado))
      || (desp.estado === 'despachada' && ['entregada', 'pendiente'].includes(nuevoEstado))
      || (desp.estado === 'entregada' && ['pendiente', 'despachada'].includes(nuevoEstado));
    if (!valid) {
      return jsonError(`No se puede pasar de "${desp.estado}" a "${nuevoEstado}"`, 400, request);
    }

    // 2b. Aprobar (pendiente→despachada): solo administración y desarrollador
    const rolOp = operador.rol;
    if (desp.estado === 'pendiente' && nuevoEstado === 'despachada') {
      if (rolOp !== 'administracion' && rolOp !== 'jefe' && rolOp !== 'desarrollador') {
        return jsonError('Solo administración puede aprobar despachos', 403, request);
      }
    }

    // 2c. Confirmar entrega: solo logística, jefe y desarrollador
    if (nuevoEstado === 'entregada') {
      if (!['logistica', 'jefe', 'desarrollador'].includes(rolOp)) {
        return jsonError('Solo logística, jefe o desarrollador pueden confirmar entregas', 403, request);
      }
    }

    // 2d. Anular: administración, supervisor, desarrollador, o vendedor dueño si está pendiente.
    if (nuevoEstado === 'anulada') {
      const esVendedorPropio = ['vendedor', 'vendedor_sin_comision'].includes(rolOp) && desp.vendedor_id === operador.id && desp.estado === 'pendiente';
      if (!['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(rolOp) && !esVendedorPropio) {
        return jsonError('No tiene permiso para anular despachos', 403, request);
      }
    }

    // 2e. Devolver (despachada/entregada→pendiente): logistica, jefe, desarrollador, administracion
    if (['despachada', 'entregada'].includes(desp.estado) && nuevoEstado === 'pendiente') {
      const rolesPermitidos = ['logistica', 'jefe', 'desarrollador', 'administracion'];
      if (!rolesPermitidos.includes(rolOp)) {
        return jsonError('No tiene permiso para devolver este despacho a pendiente', 403, request);
      }
      if (!body.motivo_devolucion || body.motivo_devolucion.trim() === '') {
        return jsonError('Debe proporcionar el motivo de devolución', 400, request);
      }
    }

    // Bloquear reversión o anulación si el despacho tiene préstamos activos que ya han sido devueltos o facturados
    // Excluyendo a administración, jefe y desarrollador de este bloqueo
    if (['pendiente', 'anulada'].includes(nuevoEstado) && ['despachada', 'entregada'].includes(desp.estado)) {
      if (!['administracion', 'jefe', 'desarrollador'].includes(rolOp)) {
        const prestRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/cliente_prestamos?despacho_id=eq.${despachoId}&select=cantidad_devuelta,cantidad_facturada`,
          { headers }
        );
        if (prestRes.ok) {
          const prestList = await prestRes.json();
          if (Array.isArray(prestList) && prestList.length > 0) {
            const tieneActividad = prestList.some(
              p => Number(p.cantidad_devuelta || 0) > 0 || Number(p.cantidad_facturada || 0) > 0
            );
            if (tieneActividad) {
              return jsonError(
                'No se puede revertir o anular un despacho que tiene préstamos asociados con devoluciones o facturaciones ya registradas.',
                400,
                request
              );
            }
          }
        }
      }
    }

    // 2f. Revertir entrega (entregada→despachada): administración, supervisor, desarrollador
    if (desp.estado === 'entregada' && nuevoEstado === 'despachada') {
      if (!['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(rolOp)) {
        return jsonError('Solo un supervisor o administración puede revertir un despacho entregado', 403, request);
      }
    }
    // Solo restaurar stock si ya había sido entregada (stock ya descontado) y se anula o revierte
    if (desp.estado === 'entregada' && ['pendiente', 'despachada', 'anulada'].includes(nuevoEstado)) {
      const ciRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${despachoId}&producto_id=not.is.null&origen=eq.inventario&select=producto_id,cantidad,nombre_snap`,
        { headers }
      );
      const items = await ciRes.json();
      const loteId = crypto.randomUUID();
      const movimientos = [];
      for (const item of items) {
        const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}&select=stock_actual,nombre`, { headers });
        const [prod] = await pRes.json();
        if (prod) {
          const stockAnterior = Number(prod.stock_actual);
          const nuevoStock = stockAnterior + Number(item.cantidad);
          await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
            method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ stock_actual: nuevoStock }),
          });
          movimientos.push({
            lote_id: loteId,
            tipo: 'ingreso',
            motivo: nuevoEstado === 'anulada'
              ? `Anulación de despacho #${desp.numero}`
              : `Reversión de despacho #${desp.numero} a ${nuevoEstado === 'pendiente' ? 'pendiente' : 'aprobado'}`,
            motivo_tipo: 'venta',
            producto_id: item.producto_id,
            producto_nombre: item.nombre_snap || prod.nombre,
            cantidad: Number(item.cantidad),
            stock_anterior: stockAnterior,
            stock_nuevo: nuevoStock,
            usuario_id: user.operator_id,
            usuario_nombre: operador.nombre,
            usuario_color: operador.color || null,
          });
        }
      }
      if (movimientos.length > 0) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
          method: 'POST', headers,
          body: JSON.stringify(movimientos),
        });
      }
    }

    // 3b. Al confirmar entrega: descontar stock + registrar kardex
    if (nuevoEstado === 'entregada') {
      const ciResEnt = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${despachoId}&producto_id=not.is.null&origen=eq.inventario&select=producto_id,cantidad,nombre_snap`,
        { headers }
      );
      const itemsEnt = await ciResEnt.json();

      if (itemsEnt.length > 0) {
        const prodIdsEnt = itemsEnt.map(i => i.producto_id);
        const prodResEnt = await fetch(
          `${env.SUPABASE_URL}/rest/v1/productos?id=in.(${prodIdsEnt.join(',')})&activo=eq.true&select=id,stock_actual,stock_minimo,nombre,unidad`,
          { headers }
        );
        const productosEnt = await prodResEnt.json();
        const stockMapEnt = Object.fromEntries(productosEnt.map(p => [p.id, p]));

        // Verificar existencia de productos
        for (const item of itemsEnt) {
          const prod = stockMapEnt[item.producto_id];
          if (!prod) return jsonError(`Producto "${item.nombre_snap}" no encontrado o inactivo`, 400, request);
        }

        // Descontar stock y registrar kardex
        const loteIdEnt = crypto.randomUUID();
        const movimientosEnt = [];
        for (const item of itemsEnt) {
          const prod = stockMapEnt[item.producto_id];
          const stockAnterior = Number(prod.stock_actual);
          const nuevoStock = stockAnterior - Number(item.cantidad);
          const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
            method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ stock_actual: nuevoStock }),
          });
          movimientosEnt.push({
            lote_id: loteIdEnt,
            tipo: 'egreso',
            motivo: `Entrega confirmada — Despacho #${desp.numero}`,
            motivo_tipo: 'venta',
            producto_id: item.producto_id,
            producto_nombre: item.nombre_snap || prod.nombre,
            cantidad: Number(item.cantidad),
            stock_anterior: stockAnterior,
            stock_nuevo: nuevoStock,
            usuario_id: user.operator_id,
            usuario_nombre: operador.nombre,
            usuario_color: operador.color || null,
          });
        }
        if (movimientosEnt.length > 0) {
          const kardexRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
            method: 'POST', headers,
            body: JSON.stringify(movimientosEnt),
          });
          if (!kardexRes.ok) {
            const kardexErr = await kardexRes.text();
            return jsonError(`Error al registrar kardex de entrega: ${kardexErr}`, 500, request);
          }
        }
      }
    }

    // 4. Actualizar estado
    const updateData = { estado: nuevoEstado };
    const ahora = new Date().toISOString();
    if (nuevoEstado === 'despachada') {
      updateData.despachada_en = ahora;
      updateData.aprobado_por_nombre = operador.nombre;
    }
    if (nuevoEstado === 'entregada') {
      updateData.entregada_en = ahora;
      if (!desp.despachada_en) updateData.despachada_en = ahora; // auto-despachar
      // Guardar tasa del momento de entrega
      if (tasaBcv && Number(tasaBcv) > 0) updateData.tasa_snapshot = Number(tasaBcv);
    }
    if (nuevoEstado === 'pendiente' && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      updateData.motivo_devolucion = body.motivo_devolucion;
      updateData.entregada_en = null;
    }
    if (nuevoEstado === 'anulada' && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      updateData.motivo_anulacion = body.motivo_anulacion;
    }
    if (nuevoEstado === 'despachada' && desp.estado === 'entregada') {
      updateData.entregada_en = null;
    }

    // Resetear metadatos de pago COD si se devuelve o anula desde despachada o entregada
    if (['pendiente', 'anulada'].includes(nuevoEstado) && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      const cleanFormaPago = (fpRaw) => {
        if (!fpRaw) return fpRaw;
        try {
          const fps = typeof fpRaw === 'string' ? JSON.parse(fpRaw) : fpRaw;
          if (Array.isArray(fps)) {
            const updated = fps.map(f => {
              if (f.metodo === 'Cobro a destino') {
                const copy = { ...f };
                copy.cobro_destino_pagado = false;
                if (Array.isArray(copy.metodos_pagados) && copy.metodos_pagados.length > 0) {
                  copy.metodo_propuesto = copy.metodos_pagados.map(p => ({
                    metodo: p.metodo,
                    monto: String(p.monto),
                    referencia: p.referencia || ""
                  }));
                }
                delete copy.metodos_pagados;
                return copy;
              }
              return f;
            });
            return JSON.stringify(updated);
          }
        } catch (err) {
          console.error('[CXC] Error reseteando metadatos de pago COD:', err);
        }
        return fpRaw;
      };

      if (desp.forma_pago) updateData.forma_pago = cleanFormaPago(desp.forma_pago);
      if (desp.forma_pago_cliente) updateData.forma_pago_cliente = cleanFormaPago(desp.forma_pago_cliente);
    }

    // 4b. Revertir CxC si se devuelve o anula desde despachada o entregada
    if (['pendiente', 'anulada'].includes(nuevoEstado) && (desp.estado === 'despachada' || desp.estado === 'entregada')) {
      try {
        const clienteCxCId = desp.cliente_factura_id || desp.cliente_id;
        if (clienteCxCId) {
          // Eliminar tanto cargos como abonos asociados a este despacho
          await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}`, {
            method: 'DELETE',
            headers,
          });
          console.log(`[CXC] Movimientos CxC eliminados para despacho ${despachoId}`);
          
          // Recalcular saldo pendiente del cliente de forma unificada
          await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
        }
      } catch (cxcRevErr) {
        console.error('[CXC] Error al revertir CxC:', cxcRevErr?.message);
        /* no crítico — no bloquear operación por error CxC */
      }
    }

    // 4c. Revertir/Eliminar comisión si pasa de aprobada/entregada a pendiente o anulada
    if (['despachada', 'entregada'].includes(desp.estado) && ['pendiente', 'anulada'].includes(nuevoEstado)) {
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}`, {
          method: 'DELETE', headers,
        });
        console.log('[COMISION] Comisión eliminada por reversión de despacho.');
      } catch (comRevErr) {
        console.error('[COMISION] Error al revertir comisión:', comRevErr?.message);
      }
    }

    const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(updateData),
    });
    if (!patchRes.ok) {
      const err = await patchRes.text();
      console.error('[DESPACHOS] Error al hacer PATCH notas_despacho:', err);
      return jsonError(`Error BD al actualizar despacho: ${err}`, 500, request);
    }

    // 5. Al aprobar (despachada): registrar cargo CxC si hay saldo a crédito
    if (nuevoEstado === 'despachada') {
      try {
        const fpRaw = desp.forma_pago_cliente || desp.forma_pago || '[]';
        let itemsCargos = []; // [{ monto: number, dias: number|null, metodo: 'cxc'|'cod', desc: string }]
        try {
          const fps = typeof fpRaw === 'string' ? JSON.parse(fpRaw) : fpRaw;
          if (Array.isArray(fps)) {
            const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
            const cod = fps.find(f => f.metodo === 'Cobro a destino');
            if (cxc && Number(cxc.monto) > 0) {
              itemsCargos.push({
                monto: Number(cxc.monto),
                dias: cxc.diasVencimiento ? parseInt(cxc.diasVencimiento, 10) : null,
                metodo: 'cxc',
                desc: ' (Crédito)'
              });
            }
            if (cod && Number(cod.monto) > 0) {
              itemsCargos.push({
                monto: Number(cod.monto),
                dias: cod.diasVencimiento ? parseInt(cod.diasVencimiento, 10) : null,
                metodo: 'cod',
                desc: ' (COD)'
              });
            }
          }
        } catch {
          if (fpRaw === 'Cta por cobrar' && Number(desp.total_usd) > 0) {
            itemsCargos.push({
              monto: Number(desp.total_usd),
              dias: null,
              metodo: 'cxc',
              desc: ' (Crédito)'
            });
          }
        }

        if (itemsCargos.length > 0) {
          // Verificar si ya existe algún cargo CxC para este despacho (idempotente)
          const cxcExistRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id`,
            { headers }
          );
          const cxcExist = await cxcExistRes.json();
          if (!Array.isArray(cxcExist) || cxcExist.length === 0) {
            const cotRes = await fetch(
              `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${desp.cotizacion_id}&select=cliente_id,numero`,
              { headers }
            );
            const [cot] = await cotRes.json();
            if (cot) {
              const clienteCxCId = desp.cliente_factura_id || cot.cliente_id;
              
              for (const item of itemsCargos) {
                const saldoRes = await fetch(
                  `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteCxCId}&select=saldo_pendiente`,
                  { headers }
                );
                const [clienteSaldo] = await saldoRes.json();
                const saldoActual = Number(clienteSaldo?.saldo_pendiente || 0);
                const nuevoSaldo = saldoActual + item.monto;

                let fecha_vencimiento = null;
                if (item.dias && !isNaN(item.dias)) {
                  const date = new Date();
                  date.setDate(date.getDate() + item.dias);
                  fecha_vencimiento = date.toISOString().split('T')[0];
                }

                const cargoPost = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                  method: 'POST', headers,
                  body: JSON.stringify({
                    cliente_id: clienteCxCId,
                    despacho_id: despachoId,
                    tipo: 'cargo',
                    monto_usd: item.monto,
                    saldo_usd: nuevoSaldo,
                    descripcion: `Orden de despacho #${cot.numero}${item.desc}`,
                    registrado_por: user.operator_id,
                    fecha_vencimiento: fecha_vencimiento,
                    metodo_pago: item.metodo
                  }),
                });

                if (cargoPost.ok) {
                  await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
                  console.log(`[CXC] Cargo CxC (${item.metodo}) registrado al aprobar y saldo recalculado. Monto:`, item.monto);
                }
              }
            }
          }
        }
      } catch (cxcErr) {
        console.error('[CXC] Error al registrar CxC al aprobar:', cxcErr?.message);
        /* no crítico — no bloquear aprobación por error CxC */
      }
    }

    // 5b. Calcular comisión al aprobar o entregar
    if (nuevoEstado === 'despachada' || nuevoEstado === 'entregada') {
      try {
        const vendRolRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${desp.vendedor_id}&select=rol,markup_pct`,
          { headers }
        );
        const [vendRol] = await vendRolRes.json();
        console.log('[COMISION] rol vendedor:', vendRol?.rol, 'markup:', vendRol?.markup_pct);

        let esDonacion = false;
        if (desp.forma_pago) {
          try {
            const fps = typeof desp.forma_pago === 'string' ? JSON.parse(desp.forma_pago) : desp.forma_pago;
            if (Array.isArray(fps)) {
              esDonacion = fps.some(f => f.metodo === 'Donación');
            } else if (typeof fps === 'string') {
              esDonacion = fps === 'Donación';
            }
          } catch (e) {}
        }

        if (!esDonacion && !['jefe', 'logistica', 'administracion', 'desarrollador'].includes(vendRol?.rol) && (vendRol?.rol !== 'vendedor_sin_comision' || parseFloat(vendRol?.markup_pct || 0) > 0)) {
          const comRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calcularcomisiondespacho`, {
            method: 'POST', headers,
            body: JSON.stringify({ p_despachoid: despachoId }),
          });
          if (!comRes.ok) {
            const comErr = await comRes.text();
            console.error('[COMISION] Error al calcular:', comErr);
          } else {
            const comisionId = await comRes.json();
            console.log('[COMISION] Creada con id:', comisionId);
          }
        } else {
          console.log('[COMISION] Vendedor sin comisión, rol administrativo o donación, se omite el cálculo.');
        }
      } catch (comEx) {
        console.error('[COMISION] Error al calcular:', comEx?.message);
      }
    }

    // 6. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: 'supervisor',
      categoria: 'COTIZACION', accion: 'ACTUALIZAR_DESPACHO',
      entidadTipo: 'nota_despacho', entidadId: despachoId,
      meta: { estado_anterior: desp.estado, estado_nuevo: nuevoEstado, cotizacion_id: desp.cotizacion_id }, ip,
    });

    return json({ ok: true, nuevoEstado }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al actualizar despacho', 500, request);
  }
}

export async function handleReciclarDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId } = body;
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);

  try {
    // 1. Obtener despacho
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=*`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);
    if (desp.estado !== 'anulada') return jsonError('Solo se pueden reciclar despachos anulados', 400, request);

    const rolOp = operador.rol;
    const esVendedorPropio = ['vendedor', 'vendedor_sin_comision'].includes(rolOp) && desp.vendedor_id === operador.id;
    if (!['administracion', 'supervisor', 'jefe', 'desarrollador'].includes(rolOp) && !esVendedorPropio) {
      return jsonError('No tiene permiso para reciclar despachos', 403, request);
    }

    // 2. Obtener cotización original
    const cotRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${desp.cotizacion_id}&select=*`, { headers });
    const [cotOrig] = await cotRes.json();
    if (!cotOrig) return jsonError('Cotización original no encontrada', 404, request);

    // 3. Crear nueva cotización borrador
    const nuevaRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cotizaciones?select=id,numero`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        version: 1,
        cliente_id: cotOrig.cliente_id,
        vendedor_id: cotOrig.vendedor_id,
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
    if (!nuevaRes.ok) return jsonError('Error al crear cotización', 500, request);
    const [nueva] = await nuevaRes.json();

    // 4. Copiar items
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cotizacion_items?cotizacion_id=eq.${desp.cotizacion_id}&select=producto_id,codigo_snap,nombre_snap,unidad_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,orden`,
      { headers }
    );
    const items = await itemsRes.json();
    if (items.length > 0) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/cotizacion_items`, {
        method: 'POST', headers,
        body: JSON.stringify(items.map(it => ({ ...it, cotizacion_id: nueva.id }))),
      });
    }

    // 5. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'RECICLAR_DESPACHO',
      entidadTipo: 'cotizacion', entidadId: nueva.id,
      meta: { despacho_id: despachoId, cotizacion_original_id: desp.cotizacion_id, total_usd: cotOrig.total_usd }, ip,
    });

    return json({ id: nueva.id, numero: nueva.numero }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al reciclar despacho', 500, request);
  }
}

export async function handleEditarItemsDespacho(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // ── 1. Solo administración o jefes pueden editar ítems de despacho ──────────
  if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
    return jsonError('Solo administración puede editar ítems del despacho', 403, request);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Body inválido', 400, request); }

  const { despachoId, items, pagos } = body;
  // items: [{ producto_id, codigo_snap, nombre_snap, unidad_snap, cantidad, precio_unit_usd, descuento_pct, orden }]
  // pagos: string (JSON stringified array of payments)

  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);
  if (!Array.isArray(items) || items.length === 0) return jsonError('items no puede estar vacío', 400, request);

  try {
    const checkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=cliente_id,cliente_factura_id`, { headers });
    const despList = await checkRes.json();
    const despacho = despList?.[0];
    let esVendedorSinComision = false;
    if (despacho) {
      const cliToCheck = despacho.cliente_factura_id || despacho.cliente_id;
      if (cliToCheck) {
        const cliRes = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${cliToCheck}&select=vendedor_id,vendedor:usuarios!clientes_vendedor_id_fkey(rol)`, { headers });
        if (cliRes.ok) {
          const cliData = await cliRes.json();
          if (Array.isArray(cliData) && cliData.length > 0) {
            esVendedorSinComision = cliData[0].vendedor?.rol === 'vendedor_sin_comision';
          }
        }
      }
    }

    if (pagos) {
      try {
        const fps = typeof pagos === 'string' ? JSON.parse(pagos) : pagos;
        if (Array.isArray(fps)) {
          const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
          if (cxc) {
            const dias = parseInt(cxc.diasVencimiento, 10);
            if (isNaN(dias) || dias <= 0) {
              return jsonError('Los días de vencimiento son obligatorios para cuentas por cobrar', 400, request);
            }
          }
        }
      } catch {}
    }

    // ── 2. Llamar al RPC que maneja la transacción e inventario ────────────────
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/editar_despacho_profundidad`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        p_despacho_id:    despachoId,
        p_nuevos_items:   items,
        p_usuario_id:     operador.id,
        p_usuario_nombre: operador.nombre,
        p_usuario_rol:    operador.rol,
        p_forma_pago:     pagos || null
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      let msg = 'Error al editar despacho';
      if (err.includes('STOCK_INSUFICIENTE')) msg = err.split(': ')[1] || err;
      if (err.includes('ESTADO_INVALIDO')) msg = 'El despacho no se puede editar en su estado actual';
      return jsonError(msg, 400, request);
    }

    // ── 2b. Sincronizar Cuentas por Cobrar (CxC) si el despacho ya está aprobado ('despachada') ──
    try {
      const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=estado,cliente_id,cliente_factura_id,cotizacion_id,total_usd,forma_pago,forma_pago_cliente`, { headers });
      const despList = await dRes.json();
      if (Array.isArray(despList) && despList.length > 0) {
        const updatedDesp = despList[0];
        
        if (updatedDesp.estado === 'despachada') {
          const fpRaw = updatedDesp.forma_pago_cliente || updatedDesp.forma_pago || '[]';
          let itemsCargos = [];
          try {
            const fps = typeof fpRaw === 'string' ? JSON.parse(fpRaw) : fpRaw;
            if (Array.isArray(fps)) {
              const cxc = fps.find(f => f.metodo === 'Cta por cobrar');
              const cod = fps.find(f => f.metodo === 'Cobro a destino');
              if (cxc && Number(cxc.monto) > 0) {
                itemsCargos.push({
                  monto: Number(cxc.monto),
                  dias: cxc.diasVencimiento ? parseInt(cxc.diasVencimiento, 10) : null,
                  metodo: 'cxc',
                  desc: ' (Crédito)'
                });
              }
              if (cod && Number(cod.monto) > 0) {
                itemsCargos.push({
                  monto: Number(cod.monto),
                  dias: cod.diasVencimiento ? parseInt(cod.diasVencimiento, 10) : null,
                  metodo: 'cod',
                  desc: ' (COD)'
                });
              }
            }
          } catch {
            if (fpRaw === 'Cta por cobrar' && Number(updatedDesp.total_usd) > 0) {
              itemsCargos.push({
                monto: Number(updatedDesp.total_usd),
                dias: null,
                metodo: 'cxc',
                desc: ' (Crédito)'
              });
            }
          }

          // Buscar cargos existentes en CxC
          const cxcExistRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id,monto_usd,cliente_id,metodo_pago`,
            { headers }
          );
          const cxcExist = await cxcExistRes.json();
          const dbCargos = Array.isArray(cxcExist) ? cxcExist : [];

          const cotRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/cotizaciones?id=eq.${updatedDesp.cotizacion_id}&select=cliente_id,numero`,
            { headers }
          );
          const [cot] = await cotRes.json();
          const clienteCxCId = updatedDesp.cliente_factura_id || updatedDesp.cliente_id || (cot ? cot.cliente_id : null);

          if (clienteCxCId) {
            const metodos = ['cxc', 'cod'];
            for (const met of metodos) {
              const target = itemsCargos.find(it => it.metodo === met);
              const existing = dbCargos.find(c => c.metodo_pago === met);

              if (existing) {
                if (!target) {
                  // Si ya no existe este método de pago, eliminamos el cargo de CxC
                  await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existing.id}`, {
                    method: 'DELETE', headers,
                  });
                  console.log(`[CXC-DEEP-EDIT] Cargo CxC (${met}) eliminado en edición profunda por quedar en $0.`);
                } else {
                  // Si existe y cambió el monto, actualizamos
                  const diff = target.monto - Number(existing.monto_usd);
                  if (diff !== 0) {
                    await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${existing.id}`, {
                      method: 'PATCH',
                      headers: { ...headers, Prefer: 'return=minimal' },
                      body: JSON.stringify({ monto_usd: Math.round(target.monto * 10000) / 10000 }),
                    });
                    console.log(`[CXC-DEEP-EDIT] Ajustado cargo (${met}) de despacho ${despachoId} a $${target.monto}.`);
                  }
                }
              } else if (target) {
                // Si no existía pero ahora sí requiere uno
                let fecha_vencimiento = null;
                if (target.dias && !isNaN(target.dias)) {
                  const date = new Date();
                  date.setDate(date.getDate() + target.dias);
                  fecha_vencimiento = date.toISOString().split('T')[0];
                }

                await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar`, {
                  method: 'POST', headers,
                  body: JSON.stringify({
                    cliente_id: clienteCxCId,
                    despacho_id: despachoId,
                    tipo: 'cargo',
                    monto_usd: target.monto,
                    saldo_usd: target.monto, // saldo transitorio
                    descripcion: `Orden de despacho #${cot ? cot.numero : despachoId}${target.desc} (Creado en edición profunda)`,
                    registrado_por: user.operator_id,
                    fecha_vencimiento: fecha_vencimiento,
                    metodo_pago: target.metodo
                  }),
                });
                console.log(`[CXC-DEEP-EDIT] Cargo CxC (${met}) creado en edición profunda por monto $${target.monto}.`);
              }
            }

            // Al final recalculamos una sola vez el saldo
            await recalcularSaldoPendienteCliente(clienteCxCId, env, headers);
          }
        }
      }
    } catch (cxcErr) {
      console.error('[CXC-DEEP-EDIT] Error al sincronizar CxC en edición profunda:', cxcErr?.message);
    }


    // Recalcular comision si ya existe
    const comRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&select=id`, { headers });
    const comEntries = await comRes.json();
    if (Array.isArray(comEntries) && comEntries.length > 0) {
      const dResCheck = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=vendedor_id`,
        { headers }
      );
      const [despCheck] = await dResCheck.json();
      const vendRolRes4 = await fetch(
        `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${despCheck?.vendedor_id}&select=rol,markup_pct`,
        { headers }
      );
      const [vendRol4] = await vendRolRes4.json();
      console.log('[COMISION][EDITAR_ITEMS] rol vendedor:', vendRol4?.rol, 'markup:', vendRol4?.markup_pct);

      if (!['jefe', 'logistica', 'administracion', 'desarrollador'].includes(vendRol4?.rol) && (vendRol4?.rol !== 'vendedor_sin_comision' || parseFloat(vendRol4?.markup_pct || 0) > 0)) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}`, {
          method: 'DELETE', headers,
        });
        await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calcularcomisiondespacho`, {
          method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ p_despachoid: despachoId }),
        });
      }
    }

    return json({ ok: true }, 200, request);
  } catch (e) {
    console.error('[EDITAR_ITEMS] Error:', e);
    return jsonError(e.message || 'Error interno al procesar el cambio', 500, request);
  }
}

export async function handleGuardarDescuentos(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  // Solo administración o desarrollador
  if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
    return jsonError('Solo administración puede aplicar descuentos', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { despachoId, descuentos } = body;
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);
  if (!Array.isArray(descuentos)) return jsonError('descuentos debe ser un array', 400, request);

  try {
    // 1. Obtener despacho
    const dRes = await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}&select=id,estado,cotizacion_id,total_usd`, { headers });
    const [desp] = await dRes.json();
    if (!desp) return jsonError('Despacho no encontrado', 404, request);
    if (!['pendiente', 'despachada'].includes(desp.estado)) {
      return jsonError('Solo se pueden aplicar descuentos a despachos pendientes o despachados', 400, request);
    }

    // 2. Obtener ítems del despacho para validar
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notas_despacho_items?despacho_id=eq.${despachoId}&select=id,total_linea_usd,precio_unit_usd,cantidad`,
      { headers }
    );
    const items = await itemsRes.json();
    const itemMap = Object.fromEntries(items.map(i => [i.id, i]));

    // 3. Validar y calcular cada descuento
    const descuentosValidos = [];
    for (const d of descuentos) {
      // Soportar despachoItemId (nuevo) o cotizacionItemId (legacy temporal)
      const itemId = d.despachoItemId || d.cotizacionItemId;
      if (!itemId || !isValidUuid(itemId)) continue;
      
      const item = itemMap[itemId];
      if (!item) continue;

      const tipo = d.tipo === 'monto' ? 'monto' : d.tipo === 'monto_unitario' ? 'monto_unitario' : 'porcentaje';
      const valor = Math.max(0, Number(d.valor) || 0);
      if (valor <= 0) continue;

      let montoUsd;
      if (tipo === 'porcentaje') {
        if (valor > 100) continue;
        montoUsd = Number(item.total_linea_usd) * valor / 100;
      } else if (tipo === 'monto_unitario') {
        montoUsd = valor * Number(item.cantidad);
        if (montoUsd > Number(item.total_linea_usd)) continue;
      } else {
        montoUsd = valor;
        if (montoUsd > Number(item.total_linea_usd)) continue;
      }
      montoUsd = Math.round(montoUsd * 10000) / 10000;

      descuentosValidos.push({
        despacho_id: despachoId,
        despacho_item_id: itemId,
        tipo,
        valor,
        monto_usd: montoUsd,
        aplicado_por: user.operator_id,
      });
    }

    // 4. Eliminar descuentos existentes del despacho
    await fetch(`${env.SUPABASE_URL}/rest/v1/despacho_descuentos?despacho_id=eq.${despachoId}`, {
      method: 'DELETE', headers,
    });

    // 5. Insertar nuevos descuentos (si hay)
    if (descuentosValidos.length > 0) {
      const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/despacho_descuentos`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(descuentosValidos),
      });
      if (!insRes.ok) {
        const err = await insRes.text();
        return jsonError('Error al guardar descuentos: ' + err, 500, request);
      }
    }

    // 6. Calcular y actualizar descuento_total_usd en notas_despacho
    const descuentoTotal = descuentosValidos.reduce((sum, d) => sum + d.monto_usd, 0);
    const descTotalRounded = Math.round(descuentoTotal * 10000) / 10000;
    const descuentoPrevio = Number(desp.descuento_total_usd || 0);

    await fetch(`${env.SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ descuento_total_usd: descTotalRounded }),
    });

    // 7. Ajustar CxC si existe un cargo para este despacho
    const diffDescuento = descTotalRounded - descuentoPrevio;
    if (diffDescuento !== 0) {
      const cxcRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?despacho_id=eq.${despachoId}&tipo=eq.cargo&select=id,monto_usd,cliente_id,metodo_pago`,
        { headers }
      );
      const cxcEntries = await cxcRes.json();
      if (Array.isArray(cxcEntries) && cxcEntries.length > 0) {
        const cxc = cxcEntries.find(c => c.metodo_pago === 'cxc') || cxcEntries[0];
        const nuevoMontoCxc = Math.max(0, Number(cxc.monto_usd) - diffDescuento);
        // Actualizar monto del cargo CxC
        await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_por_cobrar?id=eq.${cxc.id}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ monto_usd: Math.round(nuevoMontoCxc * 10000) / 10000 }),
        });
        // Recalcular saldo pendiente de forma unificada para evitar drifts de coma flotante
        await recalcularSaldoPendienteCliente(cxc.cliente_id, env, headers);
      }

      // 8. Si ya existe comisión, eliminarla para recalcular con descuentos
      const comRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}&select=id`,
        { headers }
      );
      const comEntries = await comRes.json();
      if (Array.isArray(comEntries) && comEntries.length > 0) {
        const vendRolRes3 = await fetch(
          `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${desp.vendedor_id}&select=rol,markup_pct`,
          { headers }
        );
        const [vendRol3] = await vendRolRes3.json();
        console.log('[COMISION][DESCUENTOS] rol vendedor:', vendRol3?.rol, 'markup:', vendRol3?.markup_pct);

        if (!['jefe'].includes(vendRol3?.rol) && (vendRol3?.rol !== 'vendedor_sin_comision' || parseFloat(vendRol3?.markup_pct || 0) > 0)) {
          // Eliminar comisión existente para que se recalcule
          await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?despachoid=eq.${despachoId}`, {
            method: 'DELETE', headers,
          });
          // Recalcular comisión con descuentos aplicados
          await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calcularcomisiondespacho`, {
            method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
            body: JSON.stringify({ p_despachoid: despachoId }),
          });
        }
      }
    }

    // 9. Auditoría
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'DESPACHO', accion: 'APLICAR_DESCUENTO',
      entidadTipo: 'nota_despacho', entidadId: despachoId,
      meta: { descuento_total_usd: descTotalRounded, items_con_descuento: descuentosValidos.length }, ip,
    });

    return json({ ok: true, descuento_total_usd: descTotalRounded, descuentos: descuentosValidos.length }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al guardar descuentos', 500, request);
  }
}

export async function handleObtenerDescuentos(request, env, url) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { headers } = v;

  // Extraer despachoId de /api/despachos/:id/descuentos
  const parts = url.pathname.split('/');
  const despachoId = parts[3];
  if (!despachoId || !isValidUuid(despachoId)) return jsonError('despachoId inválido', 400, request);

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/despacho_descuentos?despacho_id=eq.${despachoId}&select=id,despacho_item_id,cotizacion_item_id,tipo,valor,monto_usd,aplicado_por,creado_en`,
      { headers }
    );
    const descuentos = await res.json();
    return json(descuentos, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al obtener descuentos', 500, request);
  }
}
