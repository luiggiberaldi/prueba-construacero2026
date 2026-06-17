-- 197_reconciliar_stock_bug_profundidad.sql
--
-- VÍA B — Reconciliación retroactiva del stock corrupto por el bug de
-- editar_despacho_profundidad (que mutaba stock_actual sin registrar Kardex).
--
-- Lleva cada producto afectado a su "stock_correcto" reconstruido por replay de
-- deltas del Kardex (diagnóstico read-only previo). La corrección se aplica como
-- DELTA (stock_actual := stock_actual - diferencia) para no pisar movimientos que
-- ocurran entre el snapshot y la aplicación, y SE REGISTRA en inventario_movimientos
-- con motivo_tipo='ajuste_inventario' (a diferencia del bug, que mutaba en silencio).
--
-- diferencia = stock_real(snapshot) - stock_correcto(replay)
--   diferencia > 0  -> stock inflado  -> EGRESO de ajuste (resta)
--   diferencia < 0  -> stock deflado  -> INGRESO de ajuste (suma)
--
-- EXCLUSIONES (decisiones documentadas):
--  * LAM0413001: descuadre observado (-5) NO coincide con el impacto modelado del
--    bug (-11). Tiene otra causa -> se investiga aparte, NO se toca aquí.
--  * CAB0114005: aquí se corrige SOLO el bug (-343 -> -101). El residual negativo
--    (-101) son COMPRAS NO REGISTRADAS en el Kardex; es un ajuste de inventario
--    independiente que debe hacer administración con las facturas reales.
--
-- Idempotente: si ya existe el lote de esta reconciliación, no hace nada.
-- Reversible: cada ajuste queda asentado en el Kardex.
--
-- IMPORTANTE: aplicar la migración 196 ANTES que esta (detiene el bug).

DO $$
DECLARE
  v_motivo      TEXT := 'Reconciliacion bug editar_despacho_profundidad (mig 197)';
  v_lote        UUID := gen_random_uuid();
  v_user_id     UUID;
  v_user_nombre TEXT;
  v_prod        RECORD;
  v_row         RECORD;
  v_nuevo       NUMERIC(10,2);
  v_tipo        tipo_movimiento;
  v_count       INTEGER := 0;
BEGIN
  -- Guard de idempotencia
  IF EXISTS (SELECT 1 FROM public.inventario_movimientos WHERE motivo = v_motivo) THEN
    RAISE NOTICE 'Reconciliacion ya aplicada previamente. Se omite.';
    RETURN;
  END IF;

  -- Usuario responsable del asiento (usuario_id es NOT NULL con FK)
  SELECT id, nombre INTO v_user_id, v_user_nombre
  FROM public.usuarios
  WHERE activo = true AND rol = 'desarrollador'
  ORDER BY creado_en NULLS LAST
  LIMIT 1;

  IF v_user_id IS NULL THEN
    SELECT id, nombre INTO v_user_id, v_user_nombre
    FROM public.usuarios
    WHERE activo = true AND rol IN ('supervisor', 'administracion', 'jefe')
    ORDER BY creado_en NULLS LAST
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro un usuario valido para asentar los ajustes';
  END IF;

  -- Productos a reconciliar (codigo, diferencia = stock_real - stock_correcto)
  FOR v_row IN
    SELECT * FROM (VALUES
      ('CAB0114005', -242::numeric),
      ('CAB0114007',  242::numeric),
      ('TUB0202019',  -87::numeric),
      ('CEM1045001',  -60::numeric),
      ('LAM1916004',  -42::numeric),
      ('TUB0302007',  -26::numeric),
      ('LAM0413003',   26::numeric),
      ('CER0100002',   20::numeric),
      ('CER0100001',  -20::numeric),
      ('LAM1915008',   16::numeric),
      ('BAR0101001',   12::numeric),
      ('LAM1954008',  -10::numeric),
      ('TUB0201005',   10::numeric),
      ('LAM1954003',   10::numeric),
      ('ALA0403001',   -9::numeric),
      ('TUB0202005',   -9::numeric),
      ('TUB0302005',   -7::numeric),
      ('MAL0138002',   -6::numeric),
      ('TUB0301024',   -2::numeric),
      ('TUB1403009',   -2::numeric),
      ('FER1003001',   -2::numeric),
      ('TUB0202014',   -2::numeric),
      ('TUB0201010',    1::numeric),
      ('CON0822008',    1::numeric),
      ('TUB0803007',   -1::numeric)
    ) AS t(codigo, diferencia)
  LOOP
    SELECT id, nombre, stock_actual, cuenta_id
    INTO v_prod
    FROM public.productos
    WHERE codigo = v_row.codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE NOTICE 'Producto % no encontrado, se omite.', v_row.codigo;
      CONTINUE;
    END IF;

    v_nuevo := v_prod.stock_actual - v_row.diferencia;

    IF v_row.diferencia > 0 THEN
      v_tipo := 'egreso';   -- stock inflado: hay que restar
    ELSE
      v_tipo := 'ingreso';  -- stock deflado: hay que sumar
    END IF;

    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre, cantidad,
       stock_anterior, stock_nuevo, usuario_id, usuario_nombre, cuenta_id)
    VALUES
      (v_lote, v_tipo, v_motivo, 'ajuste_inventario', v_prod.id, v_prod.nombre,
       abs(v_row.diferencia), v_prod.stock_actual, v_nuevo,
       v_user_id, v_user_nombre, v_prod.cuenta_id);

    UPDATE public.productos
    SET stock_actual = v_nuevo
    WHERE id = v_prod.id;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Reconciliacion completada: % productos ajustados (lote %).', v_count, v_lote;
END $$;
