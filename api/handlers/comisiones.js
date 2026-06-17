// api/handlers/comisiones.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { verifyAuth, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

async function obtenerVendedoresConRol(env, headers, cuentaId, roles) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?cuenta_id=eq.${cuentaId}&rol=in.(${roles.join(',')})&select=id`,
    { headers }
  );
  if (!res.ok) return '00000000-0000-0000-0000-000000000000';
  const rows = await res.json();
  if (!rows.length) return '00000000-0000-0000-0000-000000000000';
  return rows.map(r => r.id).join(',');
}

function safeParam(val) {
  if (!val || val === 'null' || val === 'undefined' || val.trim() === '') return null;
  return val.trim();
}

// Helper interno para unificar la lógica de filtros entre Lista y Resumen
function aplicarFiltrosComisiones(query, urlParams, user) {
  const vendedorId = safeParam(urlParams.get('vendedorId'))
  const estado = safeParam(urlParams.get('estado'))
  const desde = safeParam(urlParams.get('desde'))
  const hasta = safeParam(urlParams.get('hasta'))

  const operatorRol = user.operator_rol
  const operatorId = user.operator_id
  const esSupervisor = ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(operatorRol)

  // 1. Aislamiento por Cuenta/Tenant
  query += `&cuentaid=eq.${user.id}`

  // 2. Filtro por Vendedor (según Rol)
  const filtroVendedor = esSupervisor ? (vendedorId || null) : operatorId
  if (filtroVendedor) {
    if (filtroVendedor === '00000000-0000-0000-0000-000000000000') {
      query += `&vendedorid=is.null`
    } else {
      query += `&vendedorid=eq.${filtroVendedor}`
    }
  }
  // 3. Filtro por Estado
  if (estado) {
    query += `&estado=eq.${estado}`
  }

  // 4. Filtro por Fechas (Día Completo - Zona Horaria Venezuela UTC-4)
  // Se filtra por la fecha del DESPACHO (notas_despacho.creado_en), igual que el PDF
  if (desde) query += `&despacho.creado_en=gte.${desde}T00:00:00-04:00`
  if (hasta) query += `&despacho.creado_en=lte.${hasta}T23:59:59-04:00`

  return query
}

function csvIds(ids) {
  return [...new Set(ids.filter(Boolean))].join(',')
}

async function fetchByIds(env, headers, table, ids, select) {
  const idsCsv = csvIds(ids)
  if (!idsCsv) return {}

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=in.(${idsCsv})&select=${select}`, { headers })
  if (!res.ok) return {}

  const rows = await res.json()
  return Object.fromEntries(rows.map(row => [row.id, row]))
}

export async function handleMarcarComisionPagada(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  const ROLES_PAGO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_PAGO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden registrar pagos de comisiones', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body invalido', 400, request); }
  const comisionid = body.comisionid || body.comisionId;
  if (!comisionid || !isValidUuid(comisionid)) return jsonError('comisionid invalido', 400, request);

  try {
    // 1. Obtener la comisión actual para validar montos
    const actualRes = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&select=totalcomision,comision_liberada,comision_retenida,montopagado`, { headers });
    if (!actualRes.ok) {
      const err = await actualRes.text();
      return jsonError(`Error al leer comision: ${err}`, actualRes.status, request);
    }
    const [actual] = await actualRes.json();
    if (!actual) return jsonError('Comision no encontrada', 404, request);

    const comisionLiberada = Number(actual.comision_liberada || 0);
    const totalComision = Number(actual.totalcomision || 0);
    const comisionRetenida = Number(actual.comision_retenida || 0);
    const montopagadoPrev = Number(actual.montopagado || 0);

    let monto = Number(body.montopagado);
    if (body.montopagado == null) {
      // Si no se especifica monto, pagamos todo lo liberado hasta la fecha
      monto = comisionLiberada;
    }

    if (!Number.isFinite(monto) || monto < 0) {
      return jsonError('montopagado invalido', 400, request);
    }

    // Validar que el pago no supere lo liberado
    if (monto > comisionLiberada + 0.01) {
      return jsonError(`No se puede registrar un pago de ${monto} USD porque supera el monto liberado (${comisionLiberada} USD)`, 400, request);
    }

    if (monto < montopagadoPrev - 0.01) {
      return jsonError(`El nuevo monto pagado (${monto} USD) no puede ser inferior al monto ya pagado anteriormente (${montopagadoPrev} USD)`, 400, request);
    }

    // Determinar el nuevo estado
    let nuevoEstado = 'pendiente';
    if (comisionRetenida > 0.01) {
      nuevoEstado = 'cta_cobrar';
    } else if (monto >= comisionLiberada - 0.01) {
      nuevoEstado = 'pagada';
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&estado=in.(pendiente,cta_cobrar)&select=id,estado,montopagado`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        estado: nuevoEstado,
        montopagado: monto,
        pagadaen: nuevoEstado === 'pagada' ? new Date().toISOString() : null,
        pagadapor: nuevoEstado === 'pagada' ? operador.id : null,
        actualizadoen: new Date().toISOString()
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al registrar pago de comision: ${err}`, res.status, request);
    }

    const [comision] = await res.json();
    if (!comision) return jsonError('Comision no encontrada o ya pagada en su totalidad', 404, request);

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'PAGAR_COMISION',
      entidadTipo: 'comision', entidadId: comisionid,
      meta: { montopagado: monto, estado_nuevo: nuevoEstado }, ip,
    });

    return json({ ok: true, comisionid, montopagado: monto, estado: nuevoEstado }, 200, request);
  } catch (e) {
    return jsonError(`Error critico de pago: ${e.message}`, 500, request);
  }
}

export async function handleActualizarEstadoComision(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { operador, headers, ip } = v;

  const ROLES_ESTADO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_ESTADO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden cambiar el estado de comisiones', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body invalido', 400, request); }
  const { comisionid, estado } = body;
  if (!comisionid || !isValidUuid(comisionid)) return jsonError('comisionid invalido', 400, request);
  if (!['pendiente', 'cta_cobrar'].includes(estado)) {
    return jsonError('estado invalido', 400, request);
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/comisiones?id=eq.${comisionid}&select=id,estado`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        estado,
        actualizadoen: new Date().toISOString()
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al actualizar estado de comision: ${err}`, res.status, request);
    }

    const [comision] = await res.json();
    if (!comision) return jsonError('Comision no encontrada', 404, request);

    await registrarAuditoria(env, headers, {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'COTIZACION', accion: 'ACTUALIZAR_ESTADO_COMISION',
      entidadTipo: 'comision', entidadId: comisionid,
      meta: { estado_nuevo: estado }, ip,
    });

    return json({ ok: true, comisionid, estado }, 200, request);
  } catch (e) {
    return jsonError(`Error critico al actualizar estado de comision: ${e.message}`, 500, request);
  }
}

export async function handleGetComisionesConfig(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);
  const user = await verifyAuth(request, env);
  if (!user?.id) return jsonError('No autenticado', 401, request);

  // Consultar todas las columnas que existan sin select explícito
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return jsonError('Error al leer config comisiones', res.status, request);
  const rows = await res.json();
  return json(rows[0] || {}, 200, request);
}

export async function handleGetComisiones(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers } = v;

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.max(1, Math.min(500, parseInt(url.searchParams.get('pageSize') || '100')));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const vista = url.searchParams.get('vista');
  const vendedorId = safeParam(url.searchParams.get('vendedorId'));
  const estado = safeParam(url.searchParams.get('estado'));
  const desde = safeParam(url.searchParams.get('desde'));
  const hasta = safeParam(url.searchParams.get('hasta'));

  const esSupervisor = ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(operador.rol);
  const operatorId = operador.id;

  if (vista === 'eventos') {
    let baseUrl = `${env.SUPABASE_URL}/rest/v1/comision_liberaciones?select=id,comision_id,despacho_id,vendedor_id,cuenta_id,monto,tipo,cxc_id,creado_en,comisiones:comisiones!inner(id,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,estado,montopagado,cotizacionid,despacho:notas_despacho(id,numero,total_usd,tasa_snapshot,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre,tipo_cliente),productos:notas_despacho_items(nombre_snap,codigo_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,origen,producto_id,producto:productos(categoria)))),vendedor:usuarios(id,nombre,color,markup_pct,rol,es_externo)&order=creado_en.desc`
    
    let query = baseUrl + `&cuenta_id=eq.${user.id}`

    const filtroVendedor = esSupervisor ? (vendedorId || null) : operatorId;
    if (filtroVendedor) {
      if (filtroVendedor === '00000000-0000-0000-0000-000000000000') {
        query += `&vendedor_id=is.null`
      } else {
        query += `&vendedor_id=eq.${filtroVendedor}`
      }
    }

    if (desde) query += `&creado_en=gte.${desde}T00:00:00-04:00`
    if (hasta) query += `&creado_en=lte.${hasta}T23:59:59-04:00`

    const res = await fetch(query, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Range': `${from}-${to}`,
        'Prefer': 'count=exact'
      },
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al obtener eventos de comision: ${err}`, 500, request);
    }

    const rows = await res.json();
    const cotizacionIds = rows.map(r => r.comisiones?.cotizacionid).filter(Boolean);
    const cotizaciones = await fetchByIds(env, headers, 'cotizaciones', cotizacionIds, 'id,numero,tasa_bcv_snapshot,cliente_id,cliente:clientes(id,nombre)');

    const data = rows.map(r => {
      const com = r.comisiones || {};
      const desp = com.despacho || {};
      const cot = cotizaciones[com.cotizacionid];
      return {
        id: r.id,
        monto: Number(r.monto || 0),
        tipo: r.tipo,
        creado_en: r.creado_en,
        comisiones: {
          id: com.id,
          totalcomision: Number(com.totalcomision || 0),
          comisioncabilla: Number(com.comisioncabilla || 0),
          comisionotros: Number(com.comisionotros || 0),
          pctcabilla: Number(com.pctcabilla || 0),
          pctotros: Number(com.pctotros || 0),
          estado: com.estado,
          montopagado: Number(com.montopagado || 0),
          despacho: desp ? {
            id: desp.id,
            numero: desp.numero,
            totalusd: desp.total_usd,
            tasa_snapshot: desp.tasa_snapshot,
            cliente: desp.cliente,
            productos: desp.productos
          } : null,
          cotizacion: cot ? {
            id: cot.id,
            numero: cot.numero,
            tasa_bcv_snapshot: cot.tasa_bcv_snapshot,
            cliente_nombre: cot.cliente?.nombre || null
          } : null
        },
        vendedor: r.vendedor
      };
    });

    const contentRange = res.headers.get('content-range') || '';
    const total = parseInt(contentRange.split('/')[1] || '0');

    return json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }, 200, request);
  }

  // Se incluye despacho:notas_despacho!inner(creado_en) para poder filtrar por fecha del despacho
  let baseUrl = `${env.SUPABASE_URL}/rest/v1/comisiones?select=id,despachoid,vendedorid,cotizacionid,cuentaid,totalcomision,comisioncabilla,comisionotros,pctcabilla,pctotros,montopagado,comision_liberada,comision_retenida,estado,pagadaen,pagadapor,creadoen,actualizadoen,despacho:notas_despacho!inner(creado_en)&order=creadoen.desc`
  
  const userContext = { ...user, operator_rol: operador.rol, operator_id: operador.id };
  let query = aplicarFiltrosComisiones(baseUrl, url.searchParams, userContext)

  const res = await fetch(query, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Range': `${from}-${to}`,
      'Prefer': 'count=exact'
    },
  })

  if (!res.ok) {
    const err = await res.text()
    return jsonError(`Error al obtener comisiones: ${err}`, 500, request)
  }

  const rows = await res.json()
  const despachos = await fetchByIds(env, headers, 'notas_despacho', rows.map(c => c.despachoid), 'id,numero,total_usd,tasa_snapshot,cliente_id,cliente:clientes!notas_despacho_cliente_id_fkey(id,nombre),productos:notas_despacho_items(nombre_snap,codigo_snap,cantidad,precio_unit_usd,descuento_pct,total_linea_usd,origen,producto_id,producto:productos(categoria))')
  const cotizaciones = await fetchByIds(env, headers, 'cotizaciones', rows.map(c => c.cotizacionid), 'id,numero,tasa_bcv_snapshot,cliente_id,cliente:clientes(id,nombre)')
  const vendedores = await fetchByIds(env, headers, 'usuarios', rows.map(c => c.vendedorid), 'id,nombre,color,markup_pct,rol,es_externo')
  const data = rows.map(c => {
    const despacho = despachos[c.despachoid]
    const cotizacion = cotizaciones[c.cotizacionid]
    return {
      id: c.id,
      despachoid: c.despachoid,
      vendedorid: c.vendedorid,
      cotizacionid: c.cotizacionid,
      cuentaid: c.cuentaid,
      totalcomision: c.totalcomision,
      comisioncabilla: c.comisioncabilla,
      comisionotros: c.comisionotros,
      pctcabilla: c.pctcabilla,
      pctotros: c.pctotros,
      montopagado: c.montopagado,
      comision_liberada: c.comision_liberada,
      comision_retenida: c.comision_retenida,
      estado: c.estado,
      pagadaen: c.pagadaen,
      pagadapor: c.pagadapor,
      creadoen: c.creadoen,
      vendedor: vendedores[c.vendedorid] || { id: null, nombre: 'Sin vendedor asignado', color: '#94a3b8' },
      despacho: despacho ? { 
        id: despacho.id, 
        numero: despacho.numero, 
        totalusd: despacho.total_usd, 
        tasa_snapshot: despacho.tasa_snapshot,
        cliente_nombre: despacho.cliente?.nombre || null,
        productos: despacho.productos
      } : null,
      cotizacion: cotizacion ? {
        id: cotizacion.id,
        numero: cotizacion.numero,
        tasa_bcv_snapshot: cotizacion.tasa_bcv_snapshot,
        cliente_nombre: cotizacion.cliente?.nombre || null
      } : null
    }
  })
  
  // Extraer el total de filas del header Content-Range (ej: "0-99/1250")
  const contentRange = res.headers.get('content-range') || '';
  const total = parseInt(contentRange.split('/')[1] || '0');

  return json({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }, 200, request)
}

export async function handleGetComisionesResumen(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador } = v;

  const url = new URL(request.url);

  try {
    const headers = {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    };
    const vendedorId = safeParam(url.searchParams.get('vendedorId'));
    const estado = safeParam(url.searchParams.get('estado'));
    const desde = safeParam(url.searchParams.get('desde'));
    const hasta = safeParam(url.searchParams.get('hasta'));

    const esSupervisor = ['supervisor', 'administracion', 'desarrollador', 'jefe'].includes(operador.rol);
    const filtroVendedor = esSupervisor ? (vendedorId || null) : operador.id;

    const rpcBody = {
      p_cuenta_id: user.id,
      p_vendedor_id: filtroVendedor,
      p_estado: estado,
      p_fecha_inicio: desde ? `${desde}T00:00:00-04:00` : null,
      p_fecha_fin: hasta ? `${hasta}T23:59:59-04:00` : null
    };

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/obtener_resumen_comisiones_v2`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rpcBody)
    });

    if (!res.ok) {
      const err = await res.text();
      return jsonError(`Error al obtener resumen de comisiones: ${err}`, 500, request);
    }

    const rows = await res.json();
    const r = rows[0] || {};

    // ── CONSULTA SECUNDARIA: desglose de saldo pendiente (Regular vs CxC) ─────
    // Se incluye despacho:notas_despacho!inner(creado_en) para que el filtro de fecha use la fecha del despacho
    let queryBreakdown = `${env.SUPABASE_URL}/rest/v1/comisiones?select=estado,totalcomision,montopagado,despacho:notas_despacho!inner(creado_en)&estado=in.(pendiente,cta_cobrar)`;
    const userContext = { ...user, operator_rol: operador.rol, operator_id: operador.id };
    queryBreakdown = aplicarFiltrosComisiones(queryBreakdown, url.searchParams, userContext);

    let pendienteRegular = 0;
    let pendienteCxc = 0;

    try {
      const breakdownRes = await fetch(queryBreakdown, { headers });
      if (breakdownRes.ok) {
        const items = await breakdownRes.json();
        for (const item of items) {
          const saldo = Math.max(0, Number(item.totalcomision || 0) - Number(item.montopagado || 0));
          if (item.estado === 'cta_cobrar') {
            pendienteCxc += saldo;
          } else {
            pendienteRegular += saldo;
          }
        }
      } else {
        console.error('[ResumenComisiones] Error fetching breakdown:', await breakdownRes.text());
      }
    } catch (eBreakdown) {
      console.error('[ResumenComisiones] Exception in breakdown:', eBreakdown);
    }

    return json({
      totalAcumulado: Number(r.totalacumulado || 0),
      pendientePago: Number(r.pendientepago || 0),
      yaPagado: Number(r.yapagado || 0),
      numPendientes: Number(r.numpendientes || 0),
      numPagadas: Number(r.numpagadas || 0),
      total: Number(r.total || 0),
      pendienteRegular,
      pendienteCxc,
    }, 200, request);

  } catch (e) {
    return jsonError(`Error en agregación: ${e.message}`, 500, request);
  }
}
