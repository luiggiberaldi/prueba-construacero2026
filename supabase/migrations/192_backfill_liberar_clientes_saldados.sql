-- 192: backfill — liberar el remanente de comisiones de clientes ya saldados
--
-- Aplica el modelo de la 191 a los datos historicos: para los clientes cuyo
-- saldo total ya es 0 (todo pagado), libera por completo la comision retenida
-- de sus despachos e inserta el evento 'abono' correspondiente.
--
-- Debe correrse DESPUES de la 190 (que ya libero la porcion de contado de los
-- cta_cobrar). Idempotente: si no queda nada retenido, no hace nada.

WITH saldos AS (
  SELECT cliente_id,
    SUM(CASE
      WHEN tipo = 'cargo' THEN monto_usd
      WHEN tipo = 'abono' AND forma_pago_abono IS DISTINCT FROM 'Devolución' THEN -monto_usd
      ELSE 0 END) AS saldo
  FROM public.cuentas_por_cobrar
  GROUP BY cliente_id
),
settled AS (
  SELECT cliente_id FROM saldos WHERE saldo <= 0.01
),
to_lib AS (
  SELECT c.id, c.despachoid, c.vendedorid, c.cuentaid, c.totalcomision, c.comision_retenida
  FROM public.comisiones c
  JOIN public.notas_despacho nd ON nd.id = c.despachoid
  WHERE nd.cliente_id IN (SELECT cliente_id FROM settled)
    AND c.comision_retenida > 0.01
),
ins AS (
  INSERT INTO public.comision_liberaciones
    (comision_id, despacho_id, vendedor_id, cuenta_id, monto, tipo)
  SELECT id, despachoid, vendedorid, cuentaid, comision_retenida, 'abono'
  FROM to_lib
  RETURNING comision_id
)
UPDATE public.comisiones c
SET comision_liberada = c.totalcomision,
    comision_retenida = 0,
    estado = CASE WHEN c.estado = 'pagada' THEN 'pagada' ELSE 'pendiente' END,
    actualizadoen = now()
FROM to_lib t
WHERE c.id = t.id;

NOTIFY pgrst, 'reload schema';
