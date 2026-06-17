-- migration: 180_reporte_articulos_externos.sql
CREATE OR REPLACE FUNCTION public.obtener_reporte_articulos_externos(
  p_fecha_inicio DATE DEFAULT NULL,
  p_fecha_fin    DATE DEFAULT NULL,
  p_vendedor_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  despacho_id UUID,
  despacho_numero INTEGER,
  fecha TIMESTAMPTZ,
  articulo_nombre TEXT,
  articulo_codigo TEXT,
  cantidad NUMERIC(10,2),
  precio_unit_usd NUMERIC(12,4),
  total_usd NUMERIC(12,4),
  cliente_nombre TEXT,
  cliente_rif TEXT,
  cliente_tipo TEXT,
  asesor_nombre TEXT,
  asesor_color TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  v_rol := public.get_rol_actual();
  -- Restricción de seguridad: solo roles con acceso a reportes administrativos
  IF v_rol NOT IN ('administracion', 'supervisor', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'Acceso denegado. Rol no autorizado.';
  END IF;

  RETURN QUERY
  SELECT 
    nd.id AS despacho_id,
    nd.numero AS despacho_numero,
    nd.creado_en AS fecha,
    ndi.nombre_snap::TEXT AS articulo_nombre,
    ndi.codigo_snap::TEXT AS articulo_codigo,
    ndi.cantidad::NUMERIC(10,2) AS cantidad,
    ndi.precio_unit_usd::NUMERIC(12,4) AS precio_unit_usd,
    ndi.total_linea_usd::NUMERIC(12,4) AS total_usd,
    cl.nombre::TEXT AS cliente_nombre,
    cl.rif_cedula::TEXT AS cliente_rif,
    cl.tipo_cliente::TEXT AS cliente_tipo,
    COALESCE(u.nombre, 'Sin asesor')::TEXT AS asesor_nombre,
    COALESCE(u.color, '#64748b')::TEXT AS asesor_color
  FROM public.notas_despacho_items ndi
  JOIN public.notas_despacho nd ON nd.id = ndi.despacho_id
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
  WHERE ndi.origen = 'externo'
    AND nd.estado IN ('despachada', 'entregada')
    AND (p_fecha_inicio IS NULL OR (nd.creado_en AT TIME ZONE 'America/Caracas')::date >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR (nd.creado_en AT TIME ZONE 'America/Caracas')::date <= p_fecha_fin)
    AND (p_vendedor_id IS NULL OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id)
  ORDER BY nd.creado_en DESC, ndi.nombre_snap ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_reporte_articulos_externos(date, date, uuid) TO authenticated;
