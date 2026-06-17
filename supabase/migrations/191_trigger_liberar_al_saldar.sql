-- 191: redefinir la liberacion por pago — liberar el remanente SOLO al saldar
--
-- Modelo acordado (reemplaza el split proporcional por abono de la 185):
--   * El contado se libera al aprobar el despacho (184) — sin cambios.
--   * El remanente retenido (porcion a credito / CxC) se libera COMPLETO
--     unicamente cuando el cliente queda sin deuda (saldo total = 0).
--
-- Motivo: los abonos se registran a nivel de cliente (despacho_id NULL), por lo
-- que no se pueden atribuir a un despacho puntual sin FIFO. Hasta que el cliente
-- liquide todo, la comision a credito permanece retenida; al saldar, se libera.
--
-- Es monotono: solo libera, nunca revierte (igual criterio que la version previa).

CREATE OR REPLACE FUNCTION public.trg_liberar_comision_por_pago()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_cliente_id    UUID;
  v_saldo_cliente NUMERIC(12,2);
  v_com           RECORD;
BEGIN
  v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);
  IF v_cliente_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Saldo total del cliente: cargos - abonos (excluyendo devoluciones)
  SELECT COALESCE(SUM(CASE
           WHEN tipo = 'cargo' THEN monto_usd
           WHEN tipo = 'abono' AND forma_pago_abono IS DISTINCT FROM 'Devolución' THEN -monto_usd
           ELSE 0 END), 0)
    INTO v_saldo_cliente
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = v_cliente_id;

  -- Mientras el cliente deba algo, no se libera el remanente
  IF v_saldo_cliente > 0.01 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Cliente al dia: liberar el remanente de cada comision retenida de sus despachos
  FOR v_com IN
    SELECT c.id, c.despachoid, c.vendedorid, c.cuentaid, c.totalcomision, c.comision_retenida, c.estado
    FROM public.comisiones c
    JOIN public.notas_despacho nd ON nd.id = c.despachoid
    WHERE nd.cliente_id = v_cliente_id
      AND c.comision_retenida > 0.01
  LOOP
    UPDATE public.comisiones
      SET comision_liberada = v_com.totalcomision,
          comision_retenida = 0,
          estado = CASE WHEN estado = 'pagada' THEN 'pagada' ELSE 'pendiente' END,
          actualizadoen = now()
      WHERE id = v_com.id;

    INSERT INTO public.comision_liberaciones
      (comision_id, despacho_id, vendedor_id, cuenta_id, monto, tipo, cxc_id)
    VALUES
      (v_com.id, v_com.despachoid, v_com.vendedorid, v_com.cuentaid,
       v_com.comision_retenida, 'abono', COALESCE(NEW.id, OLD.id));
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Los triggers ya existen (creados en la 185) y apuntan a esta funcion;
-- CREATE OR REPLACE conserva esos enlaces, no hay que recrearlos.
