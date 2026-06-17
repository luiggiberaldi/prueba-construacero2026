-- 178_add_cliente_tipo_reporte.sql
-- Modifica obtener_reporte_ventas_operaciones y obtener_reporte_ventas_comisiones
-- para incluir tipo_cliente y categoria del cliente en las consultas del reporte.

-- ══════════════════════════════════════════════════════════════════════
-- 1. Redefinir obtener_reporte_ventas_operaciones
-- ══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_operaciones(date, date, uuid);

CREATE OR REPLACE FUNCTION public.obtener_reporte_ventas_operaciones(
  p_fecha_inicio DATE DEFAULT NULL,
  p_fecha_fin    DATE DEFAULT NULL,
  p_vendedor_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  despacho_id UUID,
  despacho_numero INTEGER,
  cotizacion_id UUID,
  fecha TIMESTAMPTZ,
  estado TEXT,
  asesor_id UUID,
  asesor_nombre TEXT,
  asesor_color TEXT,
  cliente_nombre TEXT,
  total_usd NUMERIC(12,4),
  flete_usd NUMERIC(12,4),
  descuento_usd NUMERIC(12,4),
  venta_neta_usd NUMERIC(12,4),
  tasa NUMERIC(12,4),
  total_bs NUMERIC(12,4),
  forma_pago JSONB,
  referencia_pago TEXT,
  cliente_tipo_cliente TEXT,
  cliente_categoria TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  v_rol := public.get_rol_actual();
  
  -- Validación de roles autorizados
  IF v_rol NOT IN ('administracion', 'supervisor', 'jefe', 'desarrollador', 'vendedor') THEN
    RAISE EXCEPTION 'Acceso denegado. Rol no autorizado.';
  END IF;

  -- Seguridad estricta: si es vendedor regular, obligar a que solo consulte su propio ID
  IF v_rol = 'vendedor' AND (p_vendedor_id IS NULL OR p_vendedor_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Acceso denegado. Solo puede consultar sus propias ventas.';
  END IF;

  RETURN QUERY
  SELECT 
    nd.id AS despacho_id,
    nd.numero AS despacho_numero,
    nd.cotizacion_id AS cotizacion_id,
    nd.creado_en AS fecha,
    nd.estado AS estado,
    COALESCE(cl.vendedor_id, nd.vendedor_id) AS asesor_id,
    COALESCE(u.nombre, 'Sin asesor')::TEXT AS asesor_nombre,
    COALESCE(u.color, '#64748b')::TEXT AS asesor_color,
    cl.nombre::TEXT AS cliente_nombre,
    nd.total_usd::NUMERIC(12,4) AS total_usd,
    nd.flete_usd::NUMERIC(12,4) AS flete_usd,
    nd.descuento_total_usd::NUMERIC(12,4) AS descuento_usd,
    GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0)::NUMERIC(12,4) AS venta_neta_usd,
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot, 1)::NUMERIC(12,4) AS tasa,
    ROUND(GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0) * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot, 1), 2)::NUMERIC(12,4) AS total_bs,
    -- Normalización de la forma de pago a JSONB array
    (CASE 
      WHEN nd.forma_pago IS NULL THEN '[]'::jsonb 
      WHEN nd.forma_pago ~ '^\s*\[' THEN nd.forma_pago::jsonb 
      ELSE jsonb_build_array(
        jsonb_build_object(
          'metodo', nd.forma_pago, 
          'monto', GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0)
        )
      ) 
    END) AS forma_pago,
    nd.referencia_pago,
    cl.tipo_cliente::TEXT AS cliente_tipo_cliente,
    cl.categoria::TEXT AS cliente_categoria
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
  WHERE nd.estado IN ('despachada', 'entregada')
    -- Conversión a timezone de Venezuela antes de procesar fecha límite
    AND (p_fecha_inicio IS NULL OR (nd.creado_en AT TIME ZONE 'America/Caracas')::date >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR (nd.creado_en AT TIME ZONE 'America/Caracas')::date <= p_fecha_fin)
    -- Filtro de vendedor
    AND (p_vendedor_id IS NULL OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id)
  ORDER BY nd.creado_en DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_reporte_ventas_operaciones(date, date, uuid) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 2. Redefinir obtener_reporte_ventas_comisiones
-- ══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_comisiones(TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.obtener_reporte_ventas_comisiones(
  p_fecha_inicio TIMESTAMPTZ DEFAULT NULL,
  p_fecha_fin    TIMESTAMPTZ DEFAULT NULL,
  p_vendedor_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  despacho_id UUID,
  despacho_numero INTEGER,
  fecha TIMESTAMPTZ,
  asesor TEXT,
  asesor_color TEXT,
  cliente TEXT,
  codigo TEXT,
  descripcion TEXT,
  pza TEXT,
  precio NUMERIC(12,4),
  cantidad NUMERIC(12,2),
  total NUMERIC(12,4),
  comision_pct NUMERIC(5,2),
  total_com NUMERIC(12,2),
  tasa NUMERIC(12,4),
  pago TEXT,
  total_bs NUMERIC(12,4),
  estado TEXT,
  estado_comision TEXT,
  despacho_comision_liberada NUMERIC(12,2),
  despacho_comision_total NUMERIC(12,2),
  cliente_tipo_cliente TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
  v_cat_cabilla TEXT;
  v_uuid_nulo UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  v_rol := public.get_rol_actual();
  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'Acceso denegado. Solo administración puede ver este reporte.';
  END IF;

  SELECT lower(trim(comision_categoria_cabilla)) INTO v_cat_cabilla
  FROM public.configuracion_negocio WHERE id = 1;

  RETURN QUERY
  WITH despachos_filtrados AS (
    SELECT
      nd.id, nd.numero, nd.cotizacion_id,
      nd.estado AS col_estado, nd.entregada_en, nd.creado_en,
      nd.vendedor_id, nd.tasa_snapshot, nd.forma_pago, nd.cliente_id
    FROM public.notas_despacho nd
    WHERE nd.estado IN ('despachada', 'entregada')
      AND (p_fecha_inicio IS NULL OR nd.creado_en >= p_fecha_inicio)
      AND (p_fecha_fin   IS NULL OR nd.creado_en <= p_fecha_fin)
  ),
  items_con_descuento AS (
    -- Desde notas_despacho_items
    SELECT
      ndi.id AS item_id, nd.cotizacion_id, nd.id AS despacho_id_ref,
      ndi.codigo_snap, ndi.nombre_snap, ndi.unidad_snap,
      ndi.precio_unit_usd, ndi.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      COALESCE(ndi.total_linea_usd, 0) AS total_linea_neto,
      -- Corte = nombre empieza con "corte"
      CASE WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN TRUE ELSE FALSE END AS es_corte,
      ndi.origen
    FROM despachos_filtrados nd
    JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
    LEFT JOIN public.productos p ON p.id = ndi.producto_id

    UNION ALL

    -- Desde cotizacion_items (fallback cuando no hay items de despacho)
    SELECT
      ci.id AS item_id, ci.cotizacion_id, nd.id AS despacho_id_ref,
      ci.codigo_snap, ci.nombre_snap, ci.unidad_snap,
      ci.precio_unit_usd, ci.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS total_linea_neto,
      CASE WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN TRUE ELSE FALSE END AS es_corte,
      ci.origen
    FROM despachos_filtrados nd
    JOIN public.cotizacion_items ci ON ci.cotizacion_id = nd.cotizacion_id
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    LEFT JOIN public.despacho_descuentos dd ON dd.despacho_id = nd.id AND dd.cotizacion_item_id = ci.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notas_despacho_items ndi2 WHERE ndi2.despacho_id = nd.id
    )
  ),
  config_tasas AS (
    SELECT
      comision_pct_cabilla AS cfg_pct_cabilla,
      comision_pct_otros   AS cfg_pct_otros,
      comision_pct_externos AS cfg_pct_externos,
      COALESCE(_comision_extras, '[]'::jsonb) AS cfg_extras
    FROM public.configuracion_negocio WHERE id = 1
  ),
  items_con_comision AS (
    SELECT
      i.*,
      COALESCE(com.pctcabilla, cfg.cfg_pct_cabilla) AS final_pct_cabilla,
      COALESCE(com.pctotros,   cfg.cfg_pct_otros)   AS final_pct_otros,
      cfg.cfg_pct_externos AS final_pct_externos,
      cfg.cfg_extras AS final_extras,
      COALESCE(com.estado, 'pendiente') AS res_estado_comision,
      COALESCE(cl.vendedor_id, nd.vendedor_id) AS dueno_cliente_id,
      COALESCE(com.montopagado,   0) AS res_com_liberada,
      COALESCE(com.totalcomision, 0) AS res_com_total
    FROM items_con_descuento i
    JOIN public.notas_despacho nd ON nd.id = i.despacho_id_ref
    JOIN public.cotizaciones c    ON c.id  = nd.cotizacion_id
    JOIN public.clientes cl       ON cl.id = nd.cliente_id
    LEFT JOIN public.comisiones com ON com.despachoid = i.despacho_id_ref
    CROSS JOIN config_tasas cfg
    WHERE (
      p_vendedor_id IS NULL
      OR (p_vendedor_id = v_uuid_nulo AND COALESCE(cl.vendedor_id, nd.vendedor_id) IS NULL)
      OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id
    )
    -- Excluir ítems de vendedor_sin_comision del reporte detallado
    AND COALESCE(cl.vendedor_id, nd.vendedor_id) NOT IN (
      SELECT id FROM public.usuarios WHERE rol = 'vendedor_sin_comision'
    )
  )
  SELECT
    i.despacho_id_ref AS despacho_id,
    nd.numero         AS despacho_numero,
    nd.creado_en      AS fecha,
    COALESCE(u.nombre, 'Sin asesor') AS asesor,
    COALESCE(u.color,  '#1B365D')    AS asesor_color,
    cl.nombre AS cliente,
    i.codigo_snap     AS codigo,
    i.nombre_snap     AS descripcion,
    i.unidad_snap     AS pza,
    i.precio_unit_usd AS precio,
    i.cantidad        AS cantidad,
    i.total_linea_neto AS total,
    (CASE
      WHEN i.es_corte THEN 0
      -- Si es un producto externo, NUNCA es cabilla, va directo a comision_externos (final_pct_externos)
      WHEN i.origen = 'externo' THEN i.final_pct_externos
      WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.final_pct_cabilla
      ELSE COALESCE(
        (SELECT (elem->>'pct')::numeric
         FROM jsonb_array_elements(i.final_extras) elem
         WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria))
         LIMIT 1),
        i.final_pct_otros
      )
    END)::numeric(5,2) AS comision_pct,
    ROUND(i.total_linea_neto * (
      CASE
        WHEN i.es_corte THEN 0
        -- Si es un producto externo, NUNCA es cabilla, va directo a comision_externos (final_pct_externos)
        WHEN i.origen = 'externo' THEN i.final_pct_externos
        WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.final_pct_cabilla
        ELSE COALESCE(
          (SELECT (elem->>'pct')::numeric
           FROM jsonb_array_elements(i.final_extras) elem
           WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria))
           LIMIT 1),
          i.final_pct_otros
        )
      END
    ) / 100, 2)::numeric(12,2) AS total_com,
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot)::numeric(12,4) AS tasa,
    COALESCE(nd.forma_pago, 'Pendiente') AS pago,
    ROUND(i.total_linea_neto * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot), 2)::numeric(12,4) AS total_bs,
    nd.estado AS estado,
    i.res_estado_comision AS estado_comision,
    i.res_com_liberada::numeric(12,2)  AS despacho_comision_liberada,
    i.res_com_total::numeric(12,2)     AS despacho_comision_total,
    cl.tipo_cliente::TEXT AS cliente_tipo_cliente
  FROM items_con_comision i
  JOIN public.notas_despacho nd ON nd.id = i.despacho_id_ref
  JOIN public.cotizaciones c    ON c.id  = nd.cotizacion_id
  JOIN public.clientes cl       ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u   ON u.id  = i.dueno_cliente_id
  WHERE NOT i.es_corte  -- Excluir filas de corte del reporte final
  ORDER BY nd.creado_en DESC, i.nombre_snap ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_reporte_ventas_comisiones(TIMESTAMPTZ, TIMESTAMPTZ, UUID)
  TO authenticated, service_role;
