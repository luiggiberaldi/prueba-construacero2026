-- 196_fix_editar_despacho_profundidad_no_stock.sql
--
-- VÍA A — Detener el bug (no destructiva, NO corrige stock histórico).
--
-- Problema: editar_despacho_profundidad (desde la migración 098, vigente en la 163)
-- mutaba stock_actual directamente: devolvía el stock de los ítems viejos (+cantidad)
-- y descontaba el de los nuevos (-cantidad), SIN registrar movimientos en el Kardex
-- (inventario_movimientos). Esto es incorrecto: el stock SOLO debe descontarse al
-- pasar el despacho a 'entregada' (handler api/handlers/despachos.js) y restaurarse al
-- salir de ese estado. Como la función solo puede invocarse en estados
-- 'pendiente'/'despachada' (donde el stock aún NO se ha descontado), no debe tocar
-- el inventario en absoluto.
--
-- Esta migración redefine la función para NO alterar stock. La corrección retroactiva
-- del stock ya corrupto (72 despachos afectados) se hace por separado en la Vía B,
-- tras revisión humana del reporte de reconciliación.
--
-- Se mantiene la política de stock negativo de la migración 162 (sin validación
-- STOCK_INSUFICIENTE), que la 163 había reintroducido por error.

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id    UUID,
  p_nuevos_items   JSONB,
  p_usuario_id     UUID     DEFAULT NULL,
  p_usuario_nombre TEXT     DEFAULT 'Sistema',
  p_usuario_rol    TEXT     DEFAULT 'sistema',
  p_forma_pago     TEXT     DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho    RECORD;
  v_item_json   RECORD;
  v_total_items NUMERIC(12,4) := 0;
BEGIN
  -- 1. Validar permisos
  IF p_usuario_rol NOT IN ('administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo administración puede editar despachos a profundidad';
  END IF;

  -- 2. Bloquear despacho
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  IF v_despacho.estado IN ('entregada', 'anulada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: No se puede editar un despacho %', v_despacho.estado;
  END IF;

  -- 3. Borrar ítems viejos.
  --    NO se devuelve stock: en 'pendiente'/'despachada' el inventario nunca fue descontado.
  DELETE FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id;

  -- 4. Insertar nuevos ítems.
  --    NO se descuenta stock ni se valida STOCK_INSUFICIENTE: el descuento ocurre
  --    únicamente al confirmar la entrega (estado 'entregada').
  FOR v_item_json IN SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
    producto_id UUID, codigo_snap TEXT, nombre_snap TEXT, unidad_snap TEXT,
    cantidad NUMERIC, precio_unit_usd NUMERIC, descuento_pct NUMERIC, orden INTEGER, origen TEXT,
    es_prestamo BOOLEAN
  ) LOOP

    INSERT INTO public.notas_despacho_items (
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad_original, precio_original,
      cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden, origen,
      es_prestamo
    ) VALUES (
      p_despacho_id,
      v_item_json.producto_id,
      v_item_json.codigo_snap,
      v_item_json.nombre_snap,
      v_item_json.unidad_snap,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      COALESCE(v_item_json.descuento_pct, 0),
      CASE WHEN COALESCE(v_item_json.es_prestamo, FALSE) THEN 0.0000
           ELSE (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100)) END,
      v_item_json.orden,
      COALESCE(v_item_json.origen, CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END),
      COALESCE(v_item_json.es_prestamo, FALSE)
    );

    -- Sumar al total financiero del despacho únicamente si NO es un préstamo
    IF NOT COALESCE(v_item_json.es_prestamo, FALSE) THEN
      v_total_items := v_total_items
        + (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100));
    END IF;
  END LOOP;

  -- 5. Recalcular total de la cabecera Y actualizar pagos si se proporcionan
  UPDATE public.notas_despacho
  SET
    total_usd = v_total_items + COALESCE(flete_usd, 0) + COALESCE(corte_usd, 0) - COALESCE(descuento_total_usd, 0),
    forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
    forma_pago = COALESCE(p_forma_pago, forma_pago)
  WHERE id = p_despacho_id;

  -- 6. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := p_usuario_id,
    p_usuario_nombre := p_usuario_nombre,
    p_usuario_rol    := p_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'total_anterior', v_despacho.total_usd,
      'total_nuevo',    (v_total_items + COALESCE(v_despacho.flete_usd, 0) + COALESCE(v_despacho.corte_usd, 0) - COALESCE(v_despacho.descuento_total_usd, 0)),
      'pagos_actualizados', (p_forma_pago IS NOT NULL)
    )
  );

END;
$$;
