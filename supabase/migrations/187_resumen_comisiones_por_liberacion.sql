-- 187: Redefinición de obtener_resumen_comisiones_v2 por fecha de liberación
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
  WITH period_liberations AS (
    -- Sumar la liberación del período por cada comisión
    SELECT 
      cl.comision_id,
      SUM(cl.monto) AS monto_liberado_periodo
    FROM public.comision_liberaciones cl
    WHERE 
      (p_fecha_inicio IS NULL OR cl.creado_en >= p_fecha_inicio)
      AND (p_fecha_fin IS NULL OR cl.creado_en <= p_fecha_fin)
    GROUP BY cl.comision_id
  ),
  period_comisiones AS (
    -- Obtener los datos consolidados de las comisiones que tuvieron actividad de liberación en el período
    SELECT
      c.id,
      c.totalcomision,
      c.comision_liberada,
      c.comision_retenida,
      c.montopagado,
      c.estado,
      pl.monto_liberado_periodo
    FROM public.comisiones c
    INNER JOIN period_liberations pl ON pl.comision_id = c.id
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
  )
  SELECT
    -- Total acumulado liberado en el período
    COALESCE(SUM(pc.monto_liberado_periodo), 0)::NUMERIC AS totalAcumulado,

    -- Pendiente de pago atribuible a las liberaciones de este período (usando FIFO)
    COALESCE(SUM(
      GREATEST(
        pc.monto_liberado_periodo - GREATEST(COALESCE(pc.montopagado, 0) - (pc.comision_liberada - pc.monto_liberado_periodo), 0),
        0
      )
    ), 0)::NUMERIC AS pendientePago,

    -- Pagado atribuible a las liberaciones de este período (usando FIFO)
    COALESCE(SUM(
      GREATEST(COALESCE(pc.montopagado, 0) - (pc.comision_liberada - pc.monto_liberado_periodo), 0)
    ), 0)::NUMERIC AS yaPagado,

    -- Conteos sobre las comisiones del período
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.estado IN ('pendiente', 'cta_cobrar')) AS numPendientes,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.estado = 'pagada') AS numPagadas,
    COUNT(DISTINCT pc.id) AS total
  FROM period_comisiones pc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
