-- =============================================================================
-- Migration 182: Filtrar resumen de comisiones por fecha del despacho
-- =============================================================================
-- PROBLEMA: La RPC obtener_resumen_comisiones_v2 filtraba por comisiones.creadoen
--           pero el PDF filtra por notas_despacho.creado_en.
--           Esto causaba discrepancias cuando el despacho y la comisión se
--           registraban en fechas distintas.
-- SOLUCIÓN: Hacer JOIN con notas_despacho y filtrar por notas_despacho.creado_en
-- =============================================================================

CREATE OR REPLACE FUNCTION public.obtener_resumen_comisiones_v2(
  p_cuenta_id UUID,
  p_vendedor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_fecha_inicio TIMESTAMPTZ DEFAULT NULL,
  p_fecha_fin TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  totalAcumulado NUMERIC,
  pendientePago NUMERIC,
  yaPagado NUMERIC,
  numPendientes BIGINT,
  numPagadas BIGINT,
  total BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uuid_nulo CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(c.totalcomision), 0)::NUMERIC AS totalAcumulado,

    COALESCE(SUM(CASE
      WHEN c.estado IN ('pendiente', 'cta_cobrar')
      THEN GREATEST(c.totalcomision - COALESCE(c.montopagado, 0), 0)
      ELSE 0
    END), 0)::NUMERIC AS pendientePago,

    COALESCE(SUM(COALESCE(c.montopagado, 0)), 0)::NUMERIC AS yaPagado,

    COUNT(*) FILTER (WHERE c.estado IN ('pendiente', 'cta_cobrar')) AS numPendientes,

    COUNT(*) FILTER (WHERE c.estado = 'pagada') AS numPagadas,

    COUNT(*) AS total

  FROM public.comisiones c
  -- JOIN con notas_despacho para filtrar por fecha física del despacho (igual que el PDF)
  INNER JOIN public.notas_despacho nd ON nd.id = c.despachoid

  WHERE c.cuentaid = p_cuenta_id
    AND (
      p_vendedor_id IS NULL
      OR (p_vendedor_id = v_uuid_nulo AND c.vendedorid IS NULL)
      OR (c.vendedorid = p_vendedor_id)
    )
    AND (
      p_estado IS NULL
      OR (p_estado = 'pendiente' AND c.estado IN ('pendiente', 'cta_cobrar'))
      OR (c.estado = p_estado)
    )
    -- Filtrar por fecha del DESPACHO (nd.creado_en), igual que el PDF
    AND (p_fecha_inicio IS NULL OR nd.creado_en >= p_fecha_inicio)
    AND (p_fecha_fin   IS NULL OR nd.creado_en <= p_fecha_fin);
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
