-- 190: corregir liberacion proporcional historica de la porcion pagada de contado
--
-- Las comisiones creadas antes del split proporcional (migraciones 184/185)
-- quedaron como 'cta_cobrar' totalmente retenidas (comision_liberada = 0),
-- ignorando el monto que el cliente pago de inmediato (contado / Zelle).
--
-- Este backfill libera la fraccion correspondiente al pago inicial usando la
-- MISMA formula que calcularcomisiondespacho (184) y el trigger (185):
--   fraccion = (total_usd - saldo_efectivo) / total_usd
-- e inserta el evento 'contado' faltante, fechado a la creacion del despacho
-- para que aparezca en el periodo correcto (igual criterio que la 186).
--
-- Idempotente: al recalcular, si la comision ya tiene la liberacion correcta
-- el conjunto 'to_fix' queda vacio y no hace nada.

WITH saldos AS (
  SELECT
    c.id               AS comision_id,
    c.despachoid,
    c.vendedorid,
    c.cuentaid,
    c.totalcomision,
    c.comision_liberada,
    nd.total_usd,
    nd.creado_en       AS despacho_creado_en,
    COALESCE(SUM(CASE
      WHEN cxc.tipo = 'cargo' THEN cxc.monto_usd
      WHEN cxc.tipo = 'abono' AND cxc.forma_pago_abono IS DISTINCT FROM 'Devolución' THEN -cxc.monto_usd
      ELSE 0
    END), 0) AS saldo_efect
  FROM public.comisiones c
  JOIN public.notas_despacho nd ON nd.id = c.despachoid
  LEFT JOIN public.cuentas_por_cobrar cxc ON cxc.despacho_id = c.despachoid
  WHERE c.estado = 'cta_cobrar'
    AND nd.total_usd > 0
  GROUP BY c.id, c.despachoid, c.vendedorid, c.cuentaid,
           c.totalcomision, c.comision_liberada, nd.total_usd, nd.creado_en
),
calc AS (
  SELECT *,
    ROUND(totalcomision * LEAST(1, GREATEST(0, (total_usd - saldo_efect) / total_usd)), 2) AS objetivo_liberada
  FROM saldos
),
to_fix AS (
  SELECT * FROM calc
  WHERE objetivo_liberada > comision_liberada + 0.01
),
ins AS (
  INSERT INTO public.comision_liberaciones
    (comision_id, despacho_id, vendedor_id, cuenta_id, monto, tipo, creado_en)
  SELECT comision_id, despachoid, vendedorid, cuentaid,
         (objetivo_liberada - comision_liberada), 'contado', despacho_creado_en
  FROM to_fix
  RETURNING comision_id
)
UPDATE public.comisiones c
SET comision_liberada = f.objetivo_liberada,
    comision_retenida = c.totalcomision - f.objetivo_liberada,
    estado = CASE WHEN (c.totalcomision - f.objetivo_liberada) > 0.01 THEN 'cta_cobrar' ELSE 'pendiente' END,
    actualizadoen = now()
FROM to_fix f
WHERE c.id = f.comision_id;

NOTIFY pgrst, 'reload schema';
