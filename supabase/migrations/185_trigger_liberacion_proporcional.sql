-- 185: Trigger de liberación proporcional de comisiones al recibir abonos
CREATE OR REPLACE FUNCTION public.trg_liberar_comision_por_pago()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public 
LANGUAGE plpgsql AS $$
DECLARE
  v_despacho_id UUID;
  v_total_usd   NUMERIC(12,2);
  v_saldo_efect NUMERIC(12,2);
  v_fraccion    NUMERIC;
  v_com         RECORD;
  v_objetivo    NUMERIC(12,2);
  v_delta       NUMERIC(12,2);
BEGIN
  v_despacho_id := COALESCE(NEW.despacho_id, OLD.despacho_id);
  IF v_despacho_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT * INTO v_com FROM public.comisiones WHERE despachoid = v_despacho_id;
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(total_usd,0) INTO v_total_usd FROM public.notas_despacho WHERE id = v_despacho_id;
  IF v_total_usd <= 0 THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto_usd
                           WHEN tipo='abono' AND forma_pago_abono IS DISTINCT FROM 'Devolución' THEN -monto_usd
                           ELSE 0 END),0)
    INTO v_saldo_efect
  FROM public.cuentas_por_cobrar WHERE despacho_id = v_despacho_id;

  v_fraccion := LEAST(1, GREATEST(0, (v_total_usd - v_saldo_efect) / v_total_usd));
  v_objetivo := ROUND(v_com.totalcomision * v_fraccion, 2);

  -- Monótono: solo libera más, nunca quita lo ya liberado
  IF v_objetivo > COALESCE(v_com.comision_liberada,0) + 0.001 THEN
    v_delta := v_objetivo - COALESCE(v_com.comision_liberada,0);
    UPDATE public.comisiones
      SET comision_liberada = v_objetivo,
          comision_retenida = v_com.totalcomision - v_objetivo,
          estado = CASE WHEN (v_com.totalcomision - v_objetivo) > 0.01 THEN 'cta_cobrar' ELSE 'pendiente' END,
          actualizadoen = now()
      WHERE id = v_com.id;

    INSERT INTO public.comision_liberaciones (comision_id, despacho_id, vendedor_id, cuenta_id, monto, tipo, cxc_id)
    VALUES (v_com.id, v_despacho_id, v_com.vendedorid, v_com.cuentaid, v_delta, 'abono', COALESCE(NEW.id, OLD.id));
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Recrear los triggers (INSERT/UPDATE/DELETE)
DROP TRIGGER IF EXISTS trg_liberar_comision_pago ON public.cuentas_por_cobrar;
CREATE TRIGGER trg_liberar_comision_pago AFTER INSERT OR UPDATE ON public.cuentas_por_cobrar
  FOR EACH ROW EXECUTE FUNCTION public.trg_liberar_comision_por_pago();

DROP TRIGGER IF EXISTS trg_liberar_comision_pago_delete ON public.cuentas_por_cobrar;
CREATE TRIGGER trg_liberar_comision_pago_delete AFTER DELETE ON public.cuentas_por_cobrar
  FOR EACH ROW EXECUTE FUNCTION public.trg_liberar_comision_por_pago();
