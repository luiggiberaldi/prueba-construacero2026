


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE TYPE "public"."categoria_auditoria" AS ENUM (
    'AUTH',
    'CLIENTE',
    'COTIZACION',
    'INVENTARIO',
    'TRANSPORTISTA',
    'USUARIO',
    'REASIGNACION',
    'CONFIGURACION',
    'SISTEMA'
);


ALTER TYPE "public"."categoria_auditoria" OWNER TO "postgres";


CREATE TYPE "public"."estado_cotizacion" AS ENUM (
    'borrador',
    'enviada',
    'aceptada',
    'rechazada',
    'vencida',
    'anulada'
);


ALTER TYPE "public"."estado_cotizacion" OWNER TO "postgres";


CREATE TYPE "public"."log_nivel" AS ENUM (
    'error',
    'warn',
    'info'
);


ALTER TYPE "public"."log_nivel" OWNER TO "postgres";


CREATE TYPE "public"."log_origen" AS ENUM (
    'frontend',
    'worker',
    'supabase'
);


ALTER TYPE "public"."log_origen" OWNER TO "postgres";


CREATE TYPE "public"."motivo_movimiento" AS ENUM (
    'compra_proveedor',
    'ajuste_inventario',
    'merma',
    'devolucion',
    'transferencia',
    'otro',
    'venta'
);


ALTER TYPE "public"."motivo_movimiento" OWNER TO "postgres";


CREATE TYPE "public"."tipo_movimiento" AS ENUM (
    'ingreso',
    'egreso'
);


ALTER TYPE "public"."tipo_movimiento" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actualizar_estado_despacho"("p_despacho_id" "uuid", "p_nuevo_estado" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_despacho       RECORD;
  v_item           RECORD;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden actualizar despachos';
  END IF;

  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF NOT (
    (v_despacho.estado = 'pendiente'  AND p_nuevo_estado IN ('despachada', 'anulada'))
    OR
    (v_despacho.estado = 'despachada' AND p_nuevo_estado IN ('entregada', 'anulada'))
  ) THEN
    RAISE EXCEPTION 'TRANSICION_INVALIDA: No se puede pasar de "%" a "%"',
      v_despacho.estado, p_nuevo_estado;
  END IF;

  IF p_nuevo_estado = 'anulada' AND v_despacho.estado IN ('pendiente', 'despachada') THEN
    FOR v_item IN
      SELECT ci.producto_id, ci.cantidad
      FROM public.cotizacion_items ci
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
        AND ci.producto_id IS NOT NULL
    LOOP
      UPDATE public.productos
      SET stock_actual = stock_actual + v_item.cantidad
      WHERE id = v_item.producto_id;
    END LOOP;
  END IF;

  UPDATE public.notas_despacho
  SET
    estado = p_nuevo_estado,
    despachada_en = CASE WHEN p_nuevo_estado = 'despachada' THEN now() ELSE despachada_en END,
    entregada_en  = CASE WHEN p_nuevo_estado = 'entregada'  THEN now() ELSE entregada_en END
  WHERE id = p_despacho_id;

  IF p_nuevo_estado = 'entregada' THEN
    PERFORM public.calcular_comision_despacho(p_despacho_id);
  END IF;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'ACTUALIZAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'estado_anterior', v_despacho.estado,
      'estado_nuevo', p_nuevo_estado,
      'cotizacion_id', v_despacho.cotizacion_id
    )
  );
END;
$$;


ALTER FUNCTION "public"."actualizar_estado_despacho"("p_despacho_id" "uuid", "p_nuevo_estado" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text" DEFAULT NULL::"text", "p_nombre" "text" DEFAULT ''::"text", "p_descripcion" "text" DEFAULT NULL::"text", "p_categoria" "text" DEFAULT NULL::"text", "p_unidad" "text" DEFAULT 'und'::"text", "p_precio_usd" numeric DEFAULT 0, "p_costo_usd" numeric DEFAULT NULL::numeric, "p_stock_actual" numeric DEFAULT 0, "p_stock_minimo" numeric DEFAULT 0, "p_imagen_url" "text" DEFAULT NULL::"text", "p_precio_2" numeric DEFAULT NULL::numeric, "p_precio_3" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_old_stock      NUMERIC(10,2);
  v_new_stock      NUMERIC(10,2);
  v_diff           NUMERIC(10,2);
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores o administración pueden editar productos';
  END IF;

  SELECT stock_actual INTO v_old_stock
  FROM public.productos
  WHERE id = p_id AND activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  v_new_stock := COALESCE(p_stock_actual, 0);
  v_diff := v_new_stock - v_old_stock;

  UPDATE public.productos SET
    codigo       = NULLIF(trim(p_codigo), ''),
    nombre       = trim(p_nombre),
    descripcion  = NULLIF(trim(p_descripcion), ''),
    categoria    = NULLIF(trim(p_categoria), ''),
    unidad       = COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
    precio_usd   = COALESCE(p_precio_usd, 0),
    precio_2     = p_precio_2,
    precio_3     = p_precio_3,
    costo_usd    = p_costo_usd,
    stock_actual = v_new_stock,
    stock_minimo = COALESCE(p_stock_minimo, 0),
    -- Preservar imagen existente si no se pasa una nueva
    imagen_url   = COALESCE(NULLIF(trim(p_imagen_url), ''), imagen_url),
    actualizado_en = now()
  WHERE id = p_id
  RETURNING * INTO v_producto;

  IF v_diff != 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id,
       CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
       'Ajuste de stock al editar producto',
       'ajuste_inventario',
       v_producto.id, v_producto.nombre,
       abs(v_diff), v_old_stock, v_new_stock,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  RETURN jsonb_build_object(
    'id', v_producto.id,
    'codigo', v_producto.codigo,
    'nombre', v_producto.nombre,
    'descripcion', v_producto.descripcion,
    'categoria', v_producto.categoria,
    'unidad', v_producto.unidad,
    'precio_usd', v_producto.precio_usd,
    'precio_2', v_producto.precio_2,
    'precio_3', v_producto.precio_3,
    'costo_usd', v_producto.costo_usd,
    'stock_actual', v_producto.stock_actual,
    'stock_minimo', v_producto.stock_minimo,
    'imagen_url', v_producto.imagen_url,
    'activo', v_producto.activo,
    'creado_en', v_producto.creado_en,
    'actualizado_en', v_producto.actualizado_en
  );
END;
$$;


ALTER FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text" DEFAULT NULL::"text", "p_nombre" "text" DEFAULT ''::"text", "p_descripcion" "text" DEFAULT NULL::"text", "p_categoria" "text" DEFAULT NULL::"text", "p_unidad" "text" DEFAULT 'und'::"text", "p_precio_usd" numeric DEFAULT 0, "p_costo_usd" numeric DEFAULT NULL::numeric, "p_stock_actual" numeric DEFAULT 0, "p_stock_minimo" numeric DEFAULT 0, "p_imagen_url" "text" DEFAULT NULL::"text", "p_precio_2" numeric DEFAULT NULL::numeric, "p_precio_3" numeric DEFAULT NULL::numeric, "p_precio1_porcentaje" numeric DEFAULT NULL::numeric, "p_precio2_porcentaje" numeric DEFAULT NULL::numeric, "p_precio3_porcentaje" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_old_stock      NUMERIC(10,2);
  v_new_stock      NUMERIC(10,2);
  v_diff           NUMERIC(10,2);
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores o administración pueden editar productos';
  END IF;

  SELECT stock_actual INTO v_old_stock
  FROM public.productos
  WHERE id = p_id AND activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  v_new_stock := COALESCE(p_stock_actual, 0);
  v_diff := v_new_stock - v_old_stock;

  UPDATE public.productos SET
    codigo       = NULLIF(trim(p_codigo), ''),
    nombre       = trim(p_nombre),
    descripcion  = NULLIF(trim(p_descripcion), ''),
    categoria    = NULLIF(trim(p_categoria), ''),
    unidad       = COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
    precio_usd   = COALESCE(p_precio_usd, 0),
    precio_2     = p_precio_2,
    precio_3     = p_precio_3,
    precio1_porcentaje = p_precio1_porcentaje,
    precio2_porcentaje = p_precio2_porcentaje,
    precio3_porcentaje = p_precio3_porcentaje,
    costo_usd    = p_costo_usd,
    stock_actual = v_new_stock,
    stock_minimo = COALESCE(p_stock_minimo, 0),
    imagen_url   = NULLIF(trim(p_imagen_url), ''),
    actualizado_en = now()
  WHERE id = p_id
  RETURNING * INTO v_producto;

  IF v_diff != 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id,
       CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
       'Ajuste de stock al editar producto',
       'ajuste_inventario',
       v_producto.id, v_producto.nombre,
       abs(v_diff), v_old_stock, v_new_stock,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  RETURN jsonb_build_object(
    'id', v_producto.id,
    'codigo', v_producto.codigo,
    'nombre', v_producto.nombre,
    'descripcion', v_producto.descripcion,
    'categoria', v_producto.categoria,
    'unidad', v_producto.unidad,
    'precio_usd', v_producto.precio_usd,
    'precio_2', v_producto.precio_2,
    'precio_3', v_producto.precio_3,
    'costo_usd', v_producto.costo_usd,
    'stock_actual', v_producto.stock_actual,
    'stock_minimo', v_producto.stock_minimo,
    'imagen_url', v_producto.imagen_url,
    'activo', v_producto.activo,
    'creado_en', v_producto.creado_en,
    'actualizado_en', v_producto.actualizado_en,
    'precio1_porcentaje', v_producto.precio1_porcentaje,
    'precio2_porcentaje', v_producto.precio2_porcentaje,
    'precio3_porcentaje', v_producto.precio3_porcentaje
  );
END;
$$;


ALTER FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anular_despacho_atomico"("p_despacho_id" "uuid", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_color" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_despacho       RECORD;
  v_item           RECORD;
  v_stock_antes    NUMERIC(10,2);
  v_stock_nuevo    NUMERIC(10,2);
  v_lote_id        UUID := gen_random_uuid();
BEGIN
  -- 1. Obtener y bloquear despacho
  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado NOT IN ('pendiente', 'despachada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede anular pendiente o despachada, actual: %', v_despacho.estado;
  END IF;

  -- 2. Devolver stock y registrar kardex (atómico con FOR UPDATE)
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_antes
    FROM public.productos
    WHERE id = v_item.producto_id
    FOR UPDATE;

    IF FOUND THEN
      v_stock_nuevo := v_stock_antes + v_item.cantidad;

      UPDATE public.productos
      SET stock_actual = v_stock_nuevo, actualizado_en = now()
      WHERE id = v_item.producto_id;

      INSERT INTO public.inventario_movimientos (
        lote_id, tipo, motivo, motivo_tipo,
        producto_id, producto_nombre,
        cantidad, stock_anterior, stock_nuevo,
        usuario_id, usuario_nombre, usuario_color
      ) VALUES (
        v_lote_id, 'ingreso',
        'Anulación de despacho #' || v_despacho.numero,
        'venta',
        v_item.producto_id, v_item.nombre_snap,
        v_item.cantidad, v_stock_antes, v_stock_nuevo,
        p_usuario_id, p_usuario_nombre, p_usuario_color
      );
    END IF;
  END LOOP;

  -- 3. Eliminar comisión pendiente (si existe)
  DELETE FROM public.comisiones
  WHERE despacho_id = p_despacho_id AND estado = 'pendiente';

  -- 4. Actualizar estado del despacho
  UPDATE public.notas_despacho
  SET estado = 'anulada'
  WHERE id = p_despacho_id;
END;
$$;


ALTER FUNCTION "public"."anular_despacho_atomico"("p_despacho_id" "uuid", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_color" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aplicar_movimiento_lote"("p_tipo" "public"."tipo_movimiento", "p_motivo" "text", "p_motivo_tipo" "public"."motivo_movimiento", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_lote_id        UUID := gen_random_uuid();
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_item           JSONB;
  v_producto       RECORD;
  v_cantidad       NUMERIC(10,2);
  v_nuevo_stock    NUMERIC(10,2);
  v_primer_numero  INTEGER;
BEGIN
  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true AND u.rol = 'administracion';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo administracion puede ejecutar movimientos de inventario';
  END IF;

  IF p_motivo IS NULL OR char_length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC(10,2);
    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = (v_item->>'producto_id')::UUID AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado o inactivo';
    END IF;

    IF p_tipo = 'egreso' THEN
      v_nuevo_stock := v_producto.stock_actual - v_cantidad;
      IF v_nuevo_stock < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para "%": tiene % y se intenta retirar %',
          v_producto.nombre, v_producto.stock_actual, v_cantidad;
      END IF;
    ELSE
      v_nuevo_stock := v_producto.stock_actual + v_cantidad;
    END IF;

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock, actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id, p_tipo, trim(p_motivo), p_motivo_tipo, v_producto.id, v_producto.nombre,
       v_cantidad, v_producto.stock_actual, v_nuevo_stock, v_usuario_id, v_usuario_nombre, v_usuario_color);
  END LOOP;

  SELECT numero INTO v_primer_numero
  FROM public.inventario_movimientos
  WHERE lote_id = v_lote_id
  ORDER BY numero ASC LIMIT 1;

  RETURN jsonb_build_object('lote_id', v_lote_id, 'numero', v_primer_numero);
END;
$$;


ALTER FUNCTION "public"."aplicar_movimiento_lote"("p_tipo" "public"."tipo_movimiento", "p_motivo" "text", "p_motivo_tipo" "public"."motivo_movimiento", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."borrar_producto_con_kardex"("p_producto_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_producto       RECORD;
  v_lote_id        UUID;
  v_stock_actual   NUMERIC(10,2);
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'No tienes permisos para borrar productos';
  END IF;

  SELECT * INTO v_producto
  FROM public.productos
  WHERE id = p_producto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  v_stock_actual := COALESCE(v_producto.stock_actual, 0);

  IF v_stock_actual > 0 THEN
    v_lote_id := gen_random_uuid();

    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id, 'egreso', 'Producto eliminado del sistema', 'ajuste_inventario',
       v_producto.id, v_producto.nombre, v_stock_actual,
       v_stock_actual, 0,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  DELETE FROM public.productos
  WHERE id = p_producto_id;
END;
$$;


ALTER FUNCTION "public"."borrar_producto_con_kardex"("p_producto_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buscar_productos_hibrido"("p_busqueda" "text" DEFAULT ''::"text", "p_embedding" "public"."vector" DEFAULT NULL::"public"."vector", "p_categoria" "text" DEFAULT ''::"text", "p_categoria_grupo" boolean DEFAULT false, "p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "codigo" "text", "nombre" "text", "descripcion" "text", "categoria" "text", "unidad" "text", "precio_usd" numeric, "precio_2" numeric, "precio_3" numeric, "precio1_porcentaje" numeric, "precio2_porcentaje" numeric, "precio3_porcentaje" numeric, "costo_usd" numeric, "stock_actual" numeric, "stock_minimo" numeric, "activo" boolean, "imagen_url" "text", "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_terms TEXT[];
BEGIN
  -- Tokenizar búsqueda textual
  IF trim(COALESCE(p_busqueda, '')) <> '' THEN
    v_terms := string_to_array(lower(trim(p_busqueda)), ' ');
    v_terms := array_remove(v_terms, '');
  ELSE
    v_terms := ARRAY[]::TEXT[];
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      p.id, p.codigo, p.nombre, p.descripcion, p.categoria, p.unidad,
      p.precio_usd, p.precio_2, p.precio_3, p.precio1_porcentaje, p.precio2_porcentaje, p.precio3_porcentaje, 
      p.costo_usd, p.stock_actual, p.stock_minimo, p.activo, p.imagen_url,
      -- Calcular distancia del coseno (0 es identico, 2 es opuesto)
      -- Si el vector no se pasa, la distancia es 0
      CASE 
        WHEN p_embedding IS NOT NULL AND p.vector_embedding IS NOT NULL THEN
          (p.vector_embedding <=> p_embedding)
        ELSE 0
      END AS vector_distance
    FROM productos p
    WHERE p.activo = true
      AND (
        p_categoria = ''
        OR (p_categoria_grupo AND p.categoria ILIKE p_categoria || '%')
        OR (NOT p_categoria_grupo AND p.categoria = p_categoria)
      )
  ),
  -- Filtrado tradicional por texto
  text_match AS (
    SELECT f.*
    FROM filtered f
    WHERE (
      array_length(v_terms, 1) IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(v_terms) AS t(term)
        WHERE NOT (
          lower(f.nombre) LIKE '%' || t.term || '%'
          OR lower(COALESCE(f.codigo, '')) LIKE '%' || t.term || '%'
        )
      )
    )
  ),
  -- Filtrado híbrido: unimos resultados textuales con los resultados más similares por IA
  -- Solo traemos resultados de IA si p_embedding no es null
  ai_match AS (
    SELECT f.*
    FROM filtered f
    WHERE p_embedding IS NOT NULL AND f.vector_distance < 0.6
    ORDER BY f.vector_distance ASC
    LIMIT 20
  ),
  combined AS (
    SELECT * FROM text_match
    UNION
    SELECT * FROM ai_match
  )
  SELECT c.id, c.codigo, c.nombre, c.descripcion, c.categoria, c.unidad,
         c.precio_usd, c.precio_2, c.precio_3, c.precio1_porcentaje, c.precio2_porcentaje, c.precio3_porcentaje,
         c.costo_usd, c.stock_actual, c.stock_minimo, c.activo, c.imagen_url,
         count(*) OVER() AS total_count
  FROM combined c
  ORDER BY c.vector_distance ASC, c.nombre ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."buscar_productos_hibrido"("p_busqueda" "text", "p_embedding" "public"."vector", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calcular_comision_despacho"("p_despacho_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.calcularcomisiondespacho(p_despacho_id);
$$;


ALTER FUNCTION "public"."calcular_comision_despacho"("p_despacho_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calcularcomisiondespacho"("p_despachoid" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_despacho RECORD;
  v_tiene_items_despacho BOOLEAN;
  v_pct_cabilla NUMERIC;
  v_pct_otros NUMERIC;
  v_pct_externos NUMERIC;
  v_extras_json JSONB;
  v_cat_cabilla TEXT;
  v_monto_cabilla NUMERIC(12,2) := 0;
  v_monto_otros NUMERIC(12,2) := 0;
  v_monto_externos NUMERIC(12,2) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_comision_externos NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT;
  v_comisionid UUID;
BEGIN
  -- Si ya tiene registro de comisión calculado, omitir
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despachoid = p_despachoid) THEN
    RETURN NULL;
  END IF;

  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         cl.vendedor_id AS vendedor_dueno_cliente_id,
         u.rol AS vendedor_rol,
         u.es_externo AS vendedor_es_externo
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = cl.vendedor_id
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  IF v_despacho.vendedor_dueno_cliente_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- NO generar comisión para roles administrativos, ni para vendedor_sin_comision a menos que sea externo
  IF v_despacho.vendedor_rol IN ('jefe', 'logistica', 'administracion', 'desarrollador') OR 
     (v_despacho.vendedor_rol = 'vendedor_sin_comision' AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE)) THEN 
    RETURN NULL; 
  END IF;

  -- Modificación: Permitir estado 'despachada' (aprobado por administración) o 'entregada' (logística)
  IF v_despacho.estado NOT IN ('despachada', 'entregada') THEN RETURN NULL; END IF;
  IF v_despacho.cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_ID_REQUERIDO'; END IF;

  -- Obtener configuración global (interna y externa)
  DECLARE
    v_cfg RECORD;
  BEGIN
    SELECT
      cn.comision_pct_cabilla,
      cn.comision_pct_otros,
      cn.comision_pct_externos,
      cn._comision_extras,
      cn.comision_ext_pct_cabilla,
      cn.comision_ext_pct_otros,
      cn.comision_ext_pct_externos,
      cn._comision_ext_extras,
      COALESCE(NULLIF(trim(cn.comision_categoria_cabilla), ''), 'Cabilla') AS comision_categoria_cabilla
    INTO v_cfg
    FROM public.configuracion_negocio cn
    WHERE cn.cuenta_id = v_despacho.cuenta_id OR cn.id = 1
    ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
      -- Fallback hardcoded por si acaso
      v_pct_cabilla := 0;
      v_pct_otros := 0;
      v_pct_externos := 3;
      v_extras_json := '[]'::jsonb;
      v_cat_cabilla := 'cabilla';
    ELSE
      v_cat_cabilla := lower(trim(v_cfg.comision_categoria_cabilla));
      
      -- Asignar tasas según si el vendedor es externo o no
      IF COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN
        v_pct_cabilla := COALESCE(v_cfg.comision_ext_pct_cabilla, 2.00);
        v_pct_otros   := COALESCE(v_cfg.comision_ext_pct_otros, 3.00);
        v_pct_externos := COALESCE(v_cfg.comision_ext_pct_externos, 3.00);
        v_extras_json := COALESCE(v_cfg._comision_ext_extras, '[]'::jsonb);
      ELSE
        v_pct_cabilla := COALESCE(v_cfg.comision_pct_cabilla, 2.00);
        v_pct_otros   := COALESCE(v_cfg.comision_pct_otros, 3.00);
        v_pct_externos := COALESCE(v_cfg.comision_pct_externos, 3.00);
        v_extras_json := COALESCE(v_cfg._comision_extras, '[]'::jsonb);
      END IF;
    END IF;
  END;

  -- Si es vendedor_sin_comision, forzar tasas a 0%
  IF v_despacho.vendedor_rol = 'vendedor_sin_comision' THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_pct_externos := 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items ndi WHERE ndi.despacho_id = p_despachoid
  ) INTO v_tiene_items_despacho;

  IF v_tiene_items_despacho THEN
    SELECT
      COALESCE(SUM(CASE
        WHEN ndi.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, comparte tasa de cabilla
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ndi.nombre_snap)) LIKE '%cemento%') THEN ndi.total_linea_usd
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ndi.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ndi.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, ya entra en cabilla, aquí da 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ndi.nombre_snap)) LIKE '%cemento%') THEN 0
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        ELSE ndi.total_linea_usd
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ndi.origen = 'externo' THEN ndi.total_linea_usd
        ELSE 0
      END), 0)
    INTO v_monto_cabilla, v_monto_otros, v_monto_externos
    FROM public.notas_despacho_items ndi
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    WHERE ndi.despacho_id = p_despachoid;
  ELSE
    SELECT
      COALESCE(SUM(CASE
        WHEN ci.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, comparte tasa de cabilla
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ci.nombre_snap)) LIKE '%cemento%') THEN ci.total_linea_usd
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ci.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ci.origen = 'externo' THEN 0
        -- Si es cemento y es vendedor externo, ya entra en cabilla, aquí da 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ci.nombre_snap)) LIKE '%cemento%') THEN 0
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        ELSE ci.total_linea_usd
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ci.origen = 'externo' THEN ci.total_linea_usd
        ELSE 0
      END), 0)
    INTO v_monto_cabilla, v_monto_otros, v_monto_externos
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id;
  END IF;

  v_comision_cabilla := ROUND((v_monto_cabilla * v_pct_cabilla / 100)::numeric, 2);
  v_comision_externos := ROUND((v_monto_externos * v_pct_externos / 100)::numeric, 2);
  v_comision_otros   := ROUND((v_monto_otros   * v_pct_otros   / 100)::numeric, 2) + v_comision_externos;
  v_total_comision   := v_comision_cabilla + v_comision_otros;

  -- Usar balance neto en lugar de snapshot
  IF (
    SELECT COALESCE(SUM(
      CASE WHEN cxc.tipo = 'cargo' THEN cxc.monto_usd ELSE -cxc.monto_usd END
    ), 0)
    FROM public.cuentas_por_cobrar cxc
    WHERE cxc.despacho_id = p_despachoid
  ) > 0.01 THEN
    v_estado := 'cta_cobrar';
  ELSE
    v_estado := 'pendiente';
  END IF;

  INSERT INTO public.comisiones (
    despachoid, vendedorid, cotizacionid, cuentaid,
    totalcomision, comisioncabilla, comisionotros, pctcabilla, pctotros, estado
  ) VALUES (
    p_despachoid, v_despacho.vendedor_dueno_cliente_id, v_despacho.cotizacion_id, v_despacho.cuenta_id,
    v_total_comision, v_comision_cabilla, v_comision_otros, v_pct_cabilla, v_pct_otros, v_estado
  ) RETURNING id INTO v_comisionid;

  RETURN v_comisionid;
END;
$$;


ALTER FUNCTION "public"."calcularcomisiondespacho"("p_despachoid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_seguimiento_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Permitir modificaciones del sistema (cron, service_role, etc.)
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Si es el creador de la nota, permitir cualquier modificación
  IF OLD.usuario_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Si es un rol privilegiado pero NO es el creador, verificar que
  -- la única modificación permitida sea pasar `fijada` de true a false.
  IF public.get_rol_actual() IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    -- Comprobar si se está intentando modificar cualquier campo protegido
    IF (NEW.id IS DISTINCT FROM OLD.id) OR
       (NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id) OR
       (NEW.cliente_id IS DISTINCT FROM OLD.cliente_id) OR
       (NEW.cotizacion_id IS DISTINCT FROM OLD.cotizacion_id) OR
       (NEW.despacho_id IS DISTINCT FROM OLD.despacho_id) OR
       (NEW.usuario_id IS DISTINCT FROM OLD.usuario_id) OR
       (NEW.tipo IS DISTINCT FROM OLD.tipo) OR
       (NEW.prioridad IS DISTINCT FROM OLD.prioridad) OR
       (NEW.titulo IS DISTINCT FROM OLD.titulo) OR
       (NEW.contenido IS DISTINCT FROM OLD.contenido) OR
       (NEW.imagenes IS DISTINCT FROM OLD.imagenes) OR
       (NEW.creado_en IS DISTINCT FROM OLD.creado_en) THEN
      RAISE EXCEPTION 'Solo el creador del seguimiento puede modificar su contenido.';
    END IF;

    -- Solo se permite quitar el fijado (de true a false)
    IF OLD.fijada = false AND NEW.fijada = true THEN
      RAISE EXCEPTION 'Solo el creador del seguimiento puede fijarlo.';
    END IF;

    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'No tiene permisos para modificar este seguimiento.';
  END IF;
END;
$$;


ALTER FUNCTION "public"."check_seguimiento_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_configuracion_por_defecto"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Solo crear config si el usuario insertado es una cuenta principal
  -- (existe en auth.users como usuario de autenticación)
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.id) THEN
    INSERT INTO public.configuracion_negocio (cuenta_id, nombre_negocio)
    VALUES (NEW.id, 'Mi Negocio')
    ON CONFLICT (cuenta_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."crear_configuracion_por_defecto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_nota_despacho"("p_cotizacion_id" "uuid", "p_notas" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_cotizacion     RECORD;
  v_item           RECORD;
  v_stock_actual   NUMERIC;
  v_stock_antes    NUMERIC(10,2);
  v_stock_nuevo    NUMERIC(10,2);
  v_despacho_id    UUID;
  v_lote_id        UUID := gen_random_uuid();
BEGIN
  -- 1. Solo supervisores activos
  SELECT nombre, color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden crear notas de despacho';
  END IF;

  -- 2. Bloquear y obtener la cotización
  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 3. Validar estado
  IF v_cotizacion.estado NOT IN ('enviada', 'aceptada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar enviada o aceptada para despachar';
  END IF;

  IF v_cotizacion.estado = 'enviada' THEN
    UPDATE public.cotizaciones SET estado = 'aceptada' WHERE id = p_cotizacion_id;
  END IF;

  -- 4. Idempotencia
  IF EXISTS (SELECT 1 FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id) THEN
    RAISE EXCEPTION 'DESPACHO_EXISTENTE: Ya existe una nota de despacho para esta cotización';
  END IF;

  -- 5. Primera pasada: validar stock de todos los productos
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_item.producto_id AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO: El producto "%" ya no existe o está inactivo', v_item.nombre_snap;
    END IF;

    IF v_stock_actual < v_item.cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" requiere % pero solo hay % disponible',
        v_item.nombre_snap, v_item.cantidad, v_stock_actual;
    END IF;
  END LOOP;

  -- 6. Crear la nota de despacho con el mismo número que la cotización
  INSERT INTO public.notas_despacho (
    numero, cotizacion_id, cliente_id, vendedor_id, transportista_id,
    estado, total_usd, notas, creado_por
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_cotizacion.numero,
    p_cotizacion_id, v_cotizacion.cliente_id, v_cotizacion.vendedor_id,
    v_cotizacion.transportista_id,
    'pendiente', v_cotizacion.total_usd, p_notas, v_usuario_id
  )
  RETURNING id INTO v_despacho_id;

  -- 7. Segunda pasada: descontar stock Y registrar kardex egreso
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_antes
    FROM public.productos
    WHERE id = v_item.producto_id;

    v_stock_nuevo := v_stock_antes - v_item.cantidad;

    UPDATE public.productos
    SET stock_actual = v_stock_nuevo,
        actualizado_en = now()
    WHERE id = v_item.producto_id;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color
    ) VALUES (
      v_lote_id,
      'egreso',
      'Nota de despacho #' || v_cotizacion.numero,
      'venta',
      v_item.producto_id, v_item.nombre_snap,
      v_item.cantidad, v_stock_antes, v_stock_nuevo,
      v_usuario_id, v_usuario_nombre, v_usuario_color
    );
  END LOOP;

  -- 8. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'CREAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := v_despacho_id,
    p_meta           := jsonb_build_object(
      'cotizacion_id', p_cotizacion_id,
      'total_usd', v_cotizacion.total_usd
    )
  );

  RETURN v_despacho_id;
END;
$$;


ALTER FUNCTION "public"."crear_nota_despacho"("p_cotizacion_id" "uuid", "p_notas" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text" DEFAULT NULL::"text", "p_nombre" "text" DEFAULT ''::"text", "p_descripcion" "text" DEFAULT NULL::"text", "p_categoria" "text" DEFAULT NULL::"text", "p_unidad" "text" DEFAULT 'und'::"text", "p_precio_usd" numeric DEFAULT 0, "p_costo_usd" numeric DEFAULT NULL::numeric, "p_stock_actual" numeric DEFAULT 0, "p_stock_minimo" numeric DEFAULT 0, "p_imagen_url" "text" DEFAULT NULL::"text", "p_precio_2" numeric DEFAULT NULL::numeric, "p_precio_3" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores o administración pueden crear productos';
  END IF;

  INSERT INTO public.productos
    (codigo, nombre, descripcion, categoria, unidad, precio_usd, costo_usd, stock_actual, stock_minimo, imagen_url, precio_2, precio_3)
  VALUES
    (NULLIF(trim(p_codigo), ''), trim(p_nombre), NULLIF(trim(p_descripcion), ''),
     NULLIF(trim(p_categoria), ''), COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
     COALESCE(p_precio_usd, 0), p_costo_usd, COALESCE(p_stock_actual, 0),
     COALESCE(p_stock_minimo, 0), NULLIF(trim(p_imagen_url), ''), p_precio_2, p_precio_3)
  RETURNING * INTO v_producto;

  IF v_producto.stock_actual > 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id, 'ingreso', 'Stock inicial al crear producto', 'ajuste_inventario',
       v_producto.id, v_producto.nombre, v_producto.stock_actual, 0, v_producto.stock_actual,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  RETURN jsonb_build_object(
    'id', v_producto.id,
    'codigo', v_producto.codigo,
    'nombre', v_producto.nombre,
    'descripcion', v_producto.descripcion,
    'categoria', v_producto.categoria,
    'unidad', v_producto.unidad,
    'precio_usd', v_producto.precio_usd,
    'precio_2', v_producto.precio_2,
    'precio_3', v_producto.precio_3,
    'costo_usd', v_producto.costo_usd,
    'stock_actual', v_producto.stock_actual,
    'stock_minimo', v_producto.stock_minimo,
    'imagen_url', v_producto.imagen_url,
    'activo', v_producto.activo,
    'creado_en', v_producto.creado_en,
    'actualizado_en', v_producto.actualizado_en
  );
END;
$$;


ALTER FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text" DEFAULT NULL::"text", "p_nombre" "text" DEFAULT ''::"text", "p_descripcion" "text" DEFAULT NULL::"text", "p_categoria" "text" DEFAULT NULL::"text", "p_unidad" "text" DEFAULT 'und'::"text", "p_precio_usd" numeric DEFAULT 0, "p_costo_usd" numeric DEFAULT NULL::numeric, "p_stock_actual" numeric DEFAULT 0, "p_stock_minimo" numeric DEFAULT 0, "p_imagen_url" "text" DEFAULT NULL::"text", "p_precio_2" numeric DEFAULT NULL::numeric, "p_precio_3" numeric DEFAULT NULL::numeric, "p_precio1_porcentaje" numeric DEFAULT NULL::numeric, "p_precio2_porcentaje" numeric DEFAULT NULL::numeric, "p_precio3_porcentaje" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_rol            TEXT;
  v_usuario_nombre TEXT;
  v_usuario_color  TEXT;
  v_producto       RECORD;
  v_lote_id        UUID;
BEGIN
  v_rol := public.get_rol_actual();

  SELECT u.nombre, u.color INTO v_usuario_nombre, v_usuario_color
  FROM public.usuarios u
  WHERE u.id = v_usuario_id AND u.activo = true;

  IF NOT FOUND OR v_rol NOT IN ('supervisor', 'administracion') THEN
    RAISE EXCEPTION 'Solo supervisores o administración pueden crear productos';
  END IF;

  INSERT INTO public.productos
    (codigo, nombre, descripcion, categoria, unidad, precio_usd, costo_usd, stock_actual, stock_minimo, imagen_url, precio_2, precio_3, precio1_porcentaje, precio2_porcentaje, precio3_porcentaje)
  VALUES
    (NULLIF(trim(p_codigo), ''), trim(p_nombre), NULLIF(trim(p_descripcion), ''),
     NULLIF(trim(p_categoria), ''), COALESCE(NULLIF(trim(p_unidad), ''), 'und'),
     COALESCE(p_precio_usd, 0), p_costo_usd, COALESCE(p_stock_actual, 0),
     COALESCE(p_stock_minimo, 0), NULLIF(trim(p_imagen_url), ''), p_precio_2, p_precio_3, p_precio1_porcentaje, p_precio2_porcentaje, p_precio3_porcentaje)
  RETURNING * INTO v_producto;

  IF v_producto.stock_actual > 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos
      (lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
       cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre, usuario_color)
    VALUES
      (v_lote_id, 'ingreso', 'Stock inicial al crear producto', 'ajuste_inventario',
       v_producto.id, v_producto.nombre, v_producto.stock_actual, 0, v_producto.stock_actual,
       v_usuario_id, v_usuario_nombre, v_usuario_color);
  END IF;

  RETURN jsonb_build_object(
    'id', v_producto.id,
    'codigo', v_producto.codigo,
    'nombre', v_producto.nombre,
    'descripcion', v_producto.descripcion,
    'categoria', v_producto.categoria,
    'unidad', v_producto.unidad,
    'precio_usd', v_producto.precio_usd,
    'precio_2', v_producto.precio_2,
    'precio_3', v_producto.precio_3,
    'costo_usd', v_producto.costo_usd,
    'stock_actual', v_producto.stock_actual,
    'stock_minimo', v_producto.stock_minimo,
    'imagen_url', v_producto.imagen_url,
    'activo', v_producto.activo,
    'creado_en', v_producto.creado_en,
    'actualizado_en', v_producto.actualizado_en,
    'precio1_porcentaje', v_producto.precio1_porcentaje,
    'precio2_porcentaje', v_producto.precio2_porcentaje,
    'precio3_porcentaje', v_producto.precio3_porcentaje
  );
END;
$$;


ALTER FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_version_cotizacion"("p_cotizacion_id" "uuid", "p_notas_cambio" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_original       RECORD;
  v_raiz_id        UUID;
  v_nueva_version  INTEGER;
  v_nueva_cot_id   UUID;
BEGIN
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_INVALIDO'; END IF;

  SELECT * INTO v_original
  FROM public.cotizaciones WHERE id = p_cotizacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA'; END IF;

  IF v_original.estado NOT IN ('enviada', 'rechazada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se versionan cotizaciones enviadas o rechazadas';
  END IF;

  IF v_original.vendedor_id <> v_usuario_id AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  v_raiz_id := COALESCE(v_original.cotizacion_raiz_id, v_original.id);

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_nueva_version
  FROM public.cotizaciones
  WHERE cotizacion_raiz_id = v_raiz_id OR id = v_raiz_id;

  INSERT INTO public.cotizaciones (
    numero, version, cotizacion_raiz_id,
    cliente_id, vendedor_id, transportista_id,
    estado, valida_hasta,
    notas_cliente, notas_internas
  )
  VALUES (
    DEFAULT,
    v_nueva_version,
    v_raiz_id,
    v_original.cliente_id,
    v_original.vendedor_id,
    v_original.transportista_id,
    'borrador',
    v_original.valida_hasta,
    v_original.notas_cliente,
    COALESCE(p_notas_cambio, v_original.notas_internas)
  )
  RETURNING id INTO v_nueva_cot_id;

  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_cot_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  FROM public.cotizacion_items
  WHERE cotizacion_id = p_cotizacion_id;

  UPDATE public.cotizaciones
  SET
    subtotal_usd         = v_original.subtotal_usd,
    descuento_global_pct = v_original.descuento_global_pct,
    descuento_usd        = v_original.descuento_usd,
    costo_envio_usd      = v_original.costo_envio_usd,
    total_usd            = v_original.total_usd
  WHERE id = v_nueva_cot_id;

  -- Anular la cotización original automáticamente
  UPDATE public.cotizaciones
  SET estado = 'anulada'
  WHERE id = p_cotizacion_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := v_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'CREAR_VERSION',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_cot_id,
    p_meta           := jsonb_build_object(
      'cotizacion_origen', p_cotizacion_id,
      'nueva_version', v_nueva_version
    )
  );

  RETURN v_nueva_cot_id;
END;
$$;


ALTER FUNCTION "public"."crear_version_cotizacion"("p_cotizacion_id" "uuid", "p_notas_cambio" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debug_comision_mixto"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  r RECORD;
  v_pago_inicial NUMERIC;
  elem JSONB;
  v_forma_pago_json JSONB;
  v_total_abonos NUMERIC;
  v_porcentaje_abn NUMERIC;
  v_comision_lib NUMERIC;
  v_comision_ret NUMERIC;
  v_log JSONB := '[]'::jsonb;
  v_error TEXT;
  v_type TEXT;
BEGIN
  FOR r IN 
    SELECT c.despacho_id, nd.total_usd, nd.forma_pago, c.total_comision, c.comision_liberada, c.comision_retenida, c.estado
    FROM public.comisiones c
    JOIN public.notas_despacho nd ON c.despacho_id = nd.id
    WHERE c.estado IN ('retenida', 'pago_parcial')
  LOOP
    v_pago_inicial := 0;
    v_type := jsonb_typeof(r.forma_pago::jsonb);
    
    BEGIN
      IF v_type = 'string' THEN
        v_forma_pago_json := (r.forma_pago::jsonb#>>'{}')::jsonb;
      ELSE
        v_forma_pago_json := r.forma_pago::jsonb;
      END IF;

      IF jsonb_typeof(v_forma_pago_json) = 'array' THEN
        FOR elem IN SELECT * FROM jsonb_array_elements(v_forma_pago_json)
        LOOP
          IF elem->>'metodo' NOT ILIKE '%Cta por cobrar%' AND elem->>'metodo' NOT ILIKE '%Credito%' THEN
            v_pago_inicial := v_pago_inicial + COALESCE((elem->>'monto')::numeric, 0);
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      v_log := v_log || jsonb_build_object('despacho_id', r.despacho_id, 'error', v_error);
      v_pago_inicial := 0;
    END;

    IF v_pago_inicial > 0 THEN
      -- Obtener abonos en cuentas_por_cobrar específicos para este despacho
      SELECT COALESCE(SUM(monto_usd), 0) INTO v_total_abonos
      FROM public.cuentas_por_cobrar
      WHERE despacho_id = r.despacho_id AND tipo = 'abono';
      
      v_total_abonos := v_total_abonos + v_pago_inicial;
      
      IF r.total_usd > 0 THEN
        v_porcentaje_abn := v_total_abonos / r.total_usd;
      ELSE
        v_porcentaje_abn := 1;
      END IF;
      
      IF v_porcentaje_abn > 1 THEN v_porcentaje_abn := 1; END IF;
      
      v_comision_lib := ROUND((r.total_comision * v_porcentaje_abn)::numeric, 2);
      v_comision_ret := GREATEST(0, r.total_comision - v_comision_lib);
      
      v_log := v_log || jsonb_build_object(
        'despacho_id', r.despacho_id,
        'v_pago_inicial', v_pago_inicial,
        'v_total_abonos', v_total_abonos,
        'v_porcentaje_abn', v_porcentaje_abn,
        'v_comision_lib', v_comision_lib,
        'v_comision_ret', v_comision_ret
      );
    ELSE
      v_log := v_log || jsonb_build_object(
        'despacho_id', r.despacho_id,
        'v_pago_inicial', 0,
        'v_type', v_type,
        'forma_pago_raw', r.forma_pago,
        'parsed', v_forma_pago_json
      );
    END IF;
  END LOOP;
  
  RETURN v_log;
END;
$$;


ALTER FUNCTION "public"."debug_comision_mixto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_despacho       RECORD;
  v_item_json      RECORD;
  v_total_items    NUMERIC(12,4) := 0;
BEGIN
  -- 1. Validar permisos: solo administraciÃ³n o jefes
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;

  IF v_usuario_rol NOT IN ('administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo administraciÃ³n puede editar despachos a profundidad';
  END IF;

  -- 2. Bloquear despacho y productos
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;
  
  IF v_despacho.estado IN ('entregada', 'anulada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: No se puede editar un despacho %', v_despacho.estado;
  END IF;

  -- 3. PASO CRÃTICO: Devolver stock actual al inventario temporalmente
  UPDATE public.productos p
  SET stock_actual = p.stock_actual + di.cantidad
  FROM public.notas_despacho_items di
  WHERE p.id = di.producto_id AND di.despacho_id = p_despacho_id;

  -- 4. Limpiar Ã­tems viejos
  DELETE FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id;

  -- 5. Insertar nuevos Ã­tems y volver a descontar stock
  FOR v_item_json IN SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
    producto_id UUID, codigo_snap TEXT, nombre_snap TEXT, unidad_snap TEXT,
    cantidad NUMERIC, precio_unit_usd NUMERIC, descuento_pct NUMERIC, orden INTEGER
  ) LOOP
    
    -- Validar stock disponible
    IF NOT EXISTS (SELECT 1 FROM public.productos WHERE id = v_item_json.producto_id AND stock_actual >= v_item_json.cantidad) THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: El producto "%" no tiene stock suficiente', v_item_json.nombre_snap;
    END IF;

    -- Descontar nuevo stock
    UPDATE public.productos SET stock_actual = stock_actual - v_item_json.cantidad WHERE id = v_item_json.producto_id;

    -- Insertar Ã­tem
    INSERT INTO public.notas_despacho_items (
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad_original, precio_original,
      cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden
    ) VALUES (
      p_despacho_id, v_item_json.producto_id, v_item_json.codigo_snap, v_item_json.nombre_snap, v_item_json.unidad_snap,
      v_item_json.cantidad, v_item_json.precio_unit_usd, -- Usamos los nuevos como originales ya que es una ediciÃ³n profunda
      v_item_json.cantidad, v_item_json.precio_unit_usd, v_item_json.descuento_pct,
      (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct,0)/100)),
      v_item_json.orden
    );

    v_total_items := v_total_items + (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct,0)/100));
  END LOOP;

  -- 6. Actualizar total de la cabecera (Items + Flete + Corte)
  UPDATE public.notas_despacho 
  SET total_usd = v_total_items + COALESCE(flete_usd, 0) + COALESCE(corte_usd, 0)
  WHERE id = p_despacho_id;

  -- 7. AuditorÃ­a
  PERFORM public.registrar_auditoria(
    p_usuario_id := v_usuario_id, p_usuario_nombre := v_usuario_nombre, p_usuario_rol := v_usuario_rol,
    p_categoria := 'COTIZACION', p_accion := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo := 'nota_despacho', p_entidad_id := p_despacho_id,
    p_meta := jsonb_build_object(
      'total_anterior', v_despacho.total_usd, 
      'total_nuevo', (v_total_items + COALESCE(v_despacho.flete_usd, 0) + COALESCE(v_despacho.corte_usd, 0))
    )
  );

END;
$$;


ALTER FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_usuario_nombre" "text" DEFAULT 'Sistema'::"text", "p_usuario_rol" "text" DEFAULT 'sistema'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_despacho    RECORD;
  v_item_json   RECORD;
  v_total_items NUMERIC(12,4) := 0;
BEGIN
  -- 1. Validar permisos
  IF p_usuario_rol NOT IN ('administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo administraciÃ³n puede editar despachos a profundidad';
  END IF;

  -- 2. Bloquear despacho (FOR UPDATE evita ediciones concurrentes)
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  IF v_despacho.estado IN ('entregada', 'anulada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: No se puede editar un despacho %', v_despacho.estado;
  END IF;

  -- 3. Devolver stock anterior al inventario
  UPDATE public.productos p
  SET stock_actual = p.stock_actual + di.cantidad
  FROM public.notas_despacho_items di
  WHERE p.id = di.producto_id AND di.despacho_id = p_despacho_id;

  -- 4. Borrar Ã­tems viejos
  DELETE FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id;

  -- 5. Insertar nuevos Ã­tems y descontar stock
  FOR v_item_json IN SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
    producto_id UUID, codigo_snap TEXT, nombre_snap TEXT, unidad_snap TEXT,
    cantidad NUMERIC, precio_unit_usd NUMERIC, descuento_pct NUMERIC, orden INTEGER
  ) LOOP

    -- Validar stock
    IF NOT EXISTS (
      SELECT 1 FROM public.productos
      WHERE id = v_item_json.producto_id AND stock_actual >= v_item_json.cantidad
    ) THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: El producto "%" no tiene stock suficiente', v_item_json.nombre_snap;
    END IF;

    -- Descontar stock
    UPDATE public.productos
    SET stock_actual = stock_actual - v_item_json.cantidad
    WHERE id = v_item_json.producto_id;

    -- Insertar Ã­tem (cantidad_original = valor al momento de la ediciÃ³n profunda)
    INSERT INTO public.notas_despacho_items (
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad_original, precio_original,
      cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden
    ) VALUES (
      p_despacho_id,
      v_item_json.producto_id,
      v_item_json.codigo_snap,
      v_item_json.nombre_snap,
      v_item_json.unidad_snap,
      v_item_json.cantidad,        -- cantidad_original
      v_item_json.precio_unit_usd, -- precio_original
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      COALESCE(v_item_json.descuento_pct, 0),
      (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100)),
      v_item_json.orden
    );

    v_total_items := v_total_items
      + (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100));
  END LOOP;

  -- 6. Recalcular total de la cabecera
  UPDATE public.notas_despacho
  SET total_usd = v_total_items + COALESCE(flete_usd, 0) + COALESCE(corte_usd, 0)
  WHERE id = p_despacho_id;

  -- 7. AuditorÃ­a (usa parÃ¡metros explÃ­citos, no auth.uid())
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
      'total_nuevo',    (v_total_items + COALESCE(v_despacho.flete_usd, 0) + COALESCE(v_despacho.corte_usd, 0))
    )
  );

END;
$$;


ALTER FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_usuario_nombre" "text" DEFAULT 'Sistema'::"text", "p_usuario_rol" "text" DEFAULT 'sistema'::"text", "p_forma_pago" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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

  -- 3. Devolver stock anterior al inventario SOLO de productos que sí son del inventario
  UPDATE public.productos p
  SET stock_actual = p.stock_actual + di.cantidad
  FROM public.notas_despacho_items di
  WHERE p.id = di.producto_id 
    AND di.despacho_id = p_despacho_id
    AND di.producto_id IS NOT NULL;

  -- 4. Borrar ítems viejos
  DELETE FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id;

  -- 5. Insertar nuevos ítems y descontar stock
  FOR v_item_json IN SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
    producto_id UUID, codigo_snap TEXT, nombre_snap TEXT, unidad_snap TEXT,
    cantidad NUMERIC, precio_unit_usd NUMERIC, descuento_pct NUMERIC, orden INTEGER, origen TEXT,
    es_prestamo BOOLEAN
  ) LOOP

    -- Validar y descontar stock SOLO si es producto de inventario (física y contablemente sale de almacén)
    IF v_item_json.producto_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.productos
        WHERE id = v_item_json.producto_id AND stock_actual >= v_item_json.cantidad
      ) THEN
        RAISE EXCEPTION 'STOCK_INSUFICIENTE: El producto "%" no tiene stock suficiente', v_item_json.nombre_snap;
      END IF;

      -- Descontar stock
      UPDATE public.productos
      SET stock_actual = stock_actual - v_item_json.cantidad
      WHERE id = v_item_json.producto_id;
    END IF;

    -- Insertar ítem (si es préstamo, se guarda con total_linea_usd = 0 en el despacho, pero precio unitario original para referencia)
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

  -- 6. Recalcular total de la cabecera Y actualizar pagos si se proporcionan
  UPDATE public.notas_despacho
  SET 
    total_usd = v_total_items + COALESCE(flete_usd, 0) + COALESCE(corte_usd, 0) - COALESCE(descuento_total_usd, 0),
    forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
    forma_pago = COALESCE(p_forma_pago, forma_pago)
  WHERE id = p_despacho_id;

  -- 7. Auditoría
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


ALTER FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_forma_pago" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enviar_cotizacion"("p_cotizacion_id" "uuid", "p_tasa_bcv" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id    UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_usuario_rol   TEXT;
  v_cotizacion    RECORD;
BEGIN
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USUARIO_INVALIDO';
  END IF;

  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  IF v_cotizacion.vendedor_id <> v_usuario_id
     AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  IF v_cotizacion.estado <> 'borrador' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar en borrador para enviar';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id
  ) THEN
    RAISE EXCEPTION 'SIN_ITEMS: No se puede enviar una cotización sin productos';
  END IF;

  UPDATE public.cotizaciones
  SET
    estado             = 'enviada',
    enviada_en         = now(),
    tasa_bcv_snapshot  = p_tasa_bcv,
    total_bs_snapshot  = total_usd * p_tasa_bcv,
    actualizado_en     = now()
  WHERE id = p_cotizacion_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := v_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'ENVIAR_COTIZACION',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := p_cotizacion_id,
    p_meta           := jsonb_build_object('tasa_bcv', p_tasa_bcv)
  );
END;
$$;


ALTER FUNCTION "public"."enviar_cotizacion"("p_cotizacion_id" "uuid", "p_tasa_bcv" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."factory_reset_operacional"("p_cuenta_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Orden seguro respetando FK constraints. SOLO BORRA PARA TU CUENTA.
  DELETE FROM comisiones WHERE cuenta_id = p_cuenta_id;
  DELETE FROM cuentas_por_cobrar WHERE cuenta_id = p_cuenta_id;
  DELETE FROM notas_despacho_items WHERE cuenta_id = p_cuenta_id;
  DELETE FROM notas_despacho WHERE cuenta_id = p_cuenta_id;
  DELETE FROM cotizacion_items WHERE cuenta_id = p_cuenta_id;
  DELETE FROM cotizaciones WHERE cuenta_id = p_cuenta_id;
  DELETE FROM inventario_movimientos WHERE cuenta_id = p_cuenta_id;
  DELETE FROM auditoria WHERE cuenta_id = p_cuenta_id;
  
  -- system_logs no tiene cuenta_id (es para debug global del dev), así que lo omitimos
  
  RETURN json_build_object(
    'ok', true,
    'mensaje', 'Reset completado. Sus datos operacionales han sido eliminados conservando clientes, usuarios y stock de su cuenta.'
  );
END;
$$;


ALTER FUNCTION "public"."factory_reset_operacional"("p_cuenta_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generar_codigo_cliente_unico"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_codigo TEXT;
  v_existe BOOLEAN;
BEGIN
  LOOP
    v_codigo := floor(random() * 900000 + 100000)::text;

    SELECT EXISTS(
      SELECT 1
      FROM public.clientes
      WHERE codigo_cliente = v_codigo
    )
    INTO v_existe;

    IF NOT v_existe THEN
      RETURN v_codigo;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."generar_codigo_cliente_unico"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_operador_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT (auth.jwt()->'app_metadata'->>'operator_id')::uuid;
$$;


ALTER FUNCTION "public"."get_operador_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rol_actual"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN COALESCE(
           auth.jwt()->'app_metadata'->>'operator_rol',
           (SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true)
         ) = 'desarrollador'
    THEN 'supervisor'
    ELSE COALESCE(
           auth.jwt()->'app_metadata'->>'operator_rol',
           (SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true)
         )
  END;
$$;


ALTER FUNCTION "public"."get_rol_actual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."listar_usuarios_login"() RETURNS TABLE("id" "uuid", "nombre" "text", "rol" "text", "color" "text", "imagen_url" "text", "markup_pct" numeric, "es_externo" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT u.id, u.nombre, u.rol, u.color, NULL::text AS imagen_url, u.markup_pct, u.es_externo
  FROM public.usuarios u
  WHERE u.activo = true
    AND u.nombre <> 'Super Admin'
    AND u.cuenta_id = auth.uid()
  ORDER BY u.nombre;
$$;


ALTER FUNCTION "public"."listar_usuarios_login"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_comision_pagada"("p_comision_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_comision       RECORD;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden marcar comisiones como pagadas';
  END IF;

  SELECT * INTO v_comision
  FROM public.comisiones
  WHERE id = p_comision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMISION_NO_ENCONTRADA';
  END IF;

  IF v_comision.estado = 'pagada' THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: Esta comisión ya fue marcada como pagada';
  END IF;

  UPDATE public.comisiones
  SET
    estado = 'pagada',
    pagada_en = now(),
    pagada_por = v_usuario_id,
    actualizado_en = now()
  WHERE id = p_comision_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'PAGAR_COMISION',
    p_entidad_tipo   := 'comision',
    p_entidad_id     := p_comision_id,
    p_meta           := jsonb_build_object(
      'vendedor_id', v_comision.vendedor_id,
      'total_comision', v_comision.total_comision,
      'despacho_id', v_comision.despacho_id
    )
  );
END;
$$;


ALTER FUNCTION "public"."marcar_comision_pagada"("p_comision_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_categorias_vendedor"() RETURNS TABLE("categoria" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT p.categoria
  FROM productos p
  WHERE p.activo = true AND p.categoria IS NOT NULL
  ORDER BY p.categoria ASC;
$$;


ALTER FUNCTION "public"."obtener_categorias_vendedor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_productos_vendedor"("p_busqueda" "text" DEFAULT ''::"text", "p_categoria" "text" DEFAULT ''::"text", "p_categoria_grupo" boolean DEFAULT false, "p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "codigo" "text", "nombre" "text", "descripcion" "text", "categoria" "text", "unidad" "text", "precio_usd" numeric, "precio_2" numeric, "precio_3" numeric, "stock_actual" numeric, "stock_minimo" numeric, "activo" boolean, "imagen_url" "text", "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_terms TEXT[];
BEGIN
  IF trim(COALESCE(p_busqueda, '')) <> '' THEN
    v_terms := string_to_array(lower(trim(p_busqueda)), ' ');
    v_terms := array_remove(v_terms, '');
  ELSE
    v_terms := ARRAY[]::TEXT[];
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      p.id, p.codigo, p.nombre, p.descripcion, p.categoria, p.unidad,
      p.precio_usd, p.precio_2, p.precio_3,
      p.stock_actual, p.stock_minimo, p.activo, p.imagen_url
    FROM productos p
    WHERE p.activo = true
      AND (
        array_length(v_terms, 1) IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(v_terms) AS t(term)
          WHERE NOT (
            lower(p.nombre) LIKE '%' || t.term || '%'
            OR lower(COALESCE(p.codigo, '')) LIKE '%' || t.term || '%'
          )
        )
      )
      AND (
        p_categoria = ''
        OR (p_categoria_grupo AND p.categoria ILIKE p_categoria || '%')
        OR (NOT p_categoria_grupo AND p.categoria = p_categoria)
      )
    ORDER BY p.nombre ASC
  )
  SELECT f.*, count(*) OVER() AS total_count
  FROM filtered f
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."obtener_productos_vendedor"("p_busqueda" "text", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_reporte_ventas_comisiones"("p_fecha_inicio" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_fecha_fin" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_vendedor_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("despacho_id" "uuid", "despacho_numero" integer, "fecha" timestamp with time zone, "asesor" "text", "asesor_color" "text", "cliente" "text", "codigo" "text", "descripcion" "text", "pza" "text", "precio" numeric, "cantidad" numeric, "total" numeric, "comision_pct" numeric, "total_com" numeric, "tasa" numeric, "pago" "text", "total_bs" numeric, "estado" "text", "estado_comision" "text", "despacho_comision_liberada" numeric, "despacho_comision_total" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
      CASE
        WHEN u.rol = 'vendedor_sin_comision' THEN 0
        ELSE COALESCE(com.pctcabilla, u.comision_pct_cabilla, cfg.cfg_pct_cabilla)
      END AS final_pct_cabilla,
      CASE
        WHEN u.rol = 'vendedor_sin_comision' THEN 0
        ELSE COALESCE(com.pctotros, u.comision_pct, cfg.cfg_pct_otros)
      END AS final_pct_otros,
      CASE
        WHEN u.rol = 'vendedor_sin_comision' THEN 0
        ELSE COALESCE(u.comision_pct, cfg.cfg_pct_externos)
      END AS final_pct_externos,
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
    LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
    CROSS JOIN config_tasas cfg
    WHERE (
      p_vendedor_id IS NULL
      OR (p_vendedor_id = v_uuid_nulo AND COALESCE(cl.vendedor_id, nd.vendedor_id) IS NULL)
      OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id
    )
    -- Excluir ítems de vendedor_sin_comision a menos que tengan markup_pct > 0
    AND COALESCE(cl.vendedor_id, nd.vendedor_id) NOT IN (
      SELECT id FROM public.usuarios WHERE rol = 'vendedor_sin_comision' AND COALESCE(markup_pct, 0) <= 0
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
    i.res_com_total::numeric(12,2)     AS despacho_comision_total
  FROM items_con_comision i
  JOIN public.notas_despacho nd ON nd.id = i.despacho_id_ref
  JOIN public.cotizaciones c    ON c.id  = nd.cotizacion_id
  JOIN public.clientes cl       ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u   ON u.id  = i.dueno_cliente_id
  WHERE NOT i.es_corte
  ORDER BY nd.creado_en DESC, i.nombre_snap ASC;
END;
$$;


ALTER FUNCTION "public"."obtener_reporte_ventas_comisiones"("p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone, "p_vendedor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_reporte_ventas_operaciones"("p_fecha_inicio" "date" DEFAULT NULL::"date", "p_fecha_fin" "date" DEFAULT NULL::"date", "p_vendedor_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("despacho_id" "uuid", "despacho_numero" integer, "cotizacion_id" "uuid", "fecha" timestamp with time zone, "estado" "text", "asesor_id" "uuid", "asesor_nombre" "text", "asesor_color" "text", "cliente_nombre" "text", "total_usd" numeric, "flete_usd" numeric, "descuento_usd" numeric, "venta_neta_usd" numeric, "tasa" numeric, "total_bs" numeric, "forma_pago" "jsonb", "referencia_pago" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    nd.referencia_pago
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = nd.cliente_id                       -- JOIN corregido a nd.cliente_id
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


ALTER FUNCTION "public"."obtener_reporte_ventas_operaciones"("p_fecha_inicio" "date", "p_fecha_fin" "date", "p_vendedor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_resumen_comisiones"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_estado" "text" DEFAULT NULL::"text", "p_fecha_inicio" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_fecha_fin" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("pendiente" numeric, "retenida" numeric, "pagado" numeric, "total" numeric, "count_pendiente" bigint, "count_pagado" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uuid_nulo CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE 
      WHEN estado IN ('retenida', 'pago_parcial', 'liberada') 
      THEN GREATEST(0, comision_liberada - COALESCE(comision_pagada_monto, 0)) 
      ELSE 0 
    END), 0)::NUMERIC AS pendiente,
    
    COALESCE(SUM(CASE 
      WHEN estado IN ('retenida', 'pago_parcial', 'liberada') 
      THEN comision_retenida 
      ELSE 0 
    END), 0)::NUMERIC AS retenida,
    
    COALESCE(SUM(COALESCE(comision_pagada_monto, 0)), 0)::NUMERIC AS pagado,
    
    COALESCE(SUM(total_comision), 0)::NUMERIC AS total,
    
    COUNT(*) FILTER (WHERE estado IN ('retenida', 'pago_parcial', 'liberada')) AS count_pendiente,
    
    COUNT(*) FILTER (WHERE estado = 'pagada') AS count_pagado
  FROM public.comisiones
  WHERE cuenta_id = p_cuenta_id
    AND (
      p_vendedor_id IS NULL 
      OR (p_vendedor_id = v_uuid_nulo AND vendedor_id IS NULL)
      OR (vendedor_id = p_vendedor_id)
    )
    AND (
      p_estado IS NULL 
      OR (p_estado = 'pendiente' AND estado IN ('retenida', 'pago_parcial', 'liberada'))
      OR (estado = p_estado)
    )
    AND (p_fecha_inicio IS NULL OR creado_en >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR creado_en <= p_fecha_fin);
END;
$$;


ALTER FUNCTION "public"."obtener_resumen_comisiones"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_resumen_comisiones_v2"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid" DEFAULT NULL::"uuid", "p_estado" "text" DEFAULT NULL::"text", "p_fecha_inicio" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_fecha_fin" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("totalacumulado" numeric, "pendientepago" numeric, "yapagado" numeric, "numpendientes" bigint, "numpagadas" bigint, "total" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uuid_nulo CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(totalcomision), 0)::NUMERIC AS totalAcumulado,
    
    COALESCE(SUM(CASE 
      WHEN estado IN ('pendiente', 'cta_cobrar') 
      THEN GREATEST(totalcomision - COALESCE(montopagado, 0), 0)
      ELSE 0 
    END), 0)::NUMERIC AS pendientePago,
    
    COALESCE(SUM(COALESCE(montopagado, 0)), 0)::NUMERIC AS yaPagado,
    
    COUNT(*) FILTER (WHERE estado IN ('pendiente', 'cta_cobrar')) AS numPendientes,
    
    COUNT(*) FILTER (WHERE estado = 'pagada') AS numPagadas,
    
    COUNT(*) AS total
  FROM public.comisiones
  WHERE cuentaid = p_cuenta_id
    AND (
      p_vendedor_id IS NULL 
      OR (p_vendedor_id = v_uuid_nulo AND vendedorid IS NULL)
      OR (vendedorid = p_vendedor_id)
    )
    AND (
      p_estado IS NULL 
      OR (p_estado = 'pendiente' AND estado IN ('pendiente', 'cta_cobrar'))
      OR (estado = p_estado)
    )
    AND (p_fecha_inicio IS NULL OR creadoen >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR creadoen <= p_fecha_fin);
END;
$$;


ALTER FUNCTION "public"."obtener_resumen_comisiones_v2"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_stock_comprometido"() RETURNS TABLE("producto_id" "uuid", "total_comprometido" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    ci.producto_id,
    SUM(ci.cantidad) AS total_comprometido
  FROM public.cotizacion_items ci
  JOIN public.cotizaciones c ON c.id = ci.cotizacion_id
  WHERE c.estado IN ('enviada', 'aceptada')
    AND ci.producto_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = c.id
        AND nd.estado = 'entregada'
    )
  GROUP BY ci.producto_id;
$$;


ALTER FUNCTION "public"."obtener_stock_comprometido"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_stock_comprometido_detalle"("p_producto_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("producto_id" "uuid", "producto_nombre" "text", "cantidad" numeric, "vendedor_id" "uuid", "vendedor_nombre" "text", "cotizacion_id" "uuid", "cotizacion_numero" "text", "cotizacion_estado" "text", "cotizacion_fecha" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    ci.producto_id,
    ci.nombre_snap AS producto_nombre,
    ci.cantidad,
    c.vendedor_id,
    u.nombre AS vendedor_nombre,
    c.id AS cotizacion_id,
    c.numero AS cotizacion_numero,
    c.estado::TEXT AS cotizacion_estado,
    c.creado_en AS cotizacion_fecha
  FROM public.cotizacion_items ci
  JOIN public.cotizaciones c ON c.id = ci.cotizacion_id
  JOIN public.usuarios u ON u.id = c.vendedor_id
  WHERE c.estado IN ('enviada', 'aceptada')
    AND ci.producto_id IS NOT NULL
    AND (p_producto_id IS NULL OR ci.producto_id = p_producto_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = c.id
        AND nd.estado = 'entregada'
    )
  ORDER BY ci.producto_id, c.creado_en DESC;
$$;


ALTER FUNCTION "public"."obtener_stock_comprometido_detalle"("p_producto_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."obtener_stock_productos"("p_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "stock_actual" numeric, "nombre" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p.id, p.stock_actual, p.nombre
  FROM productos p
  WHERE p.id = ANY(p_ids) AND p.activo = true;
$$;


ALTER FUNCTION "public"."obtener_stock_productos"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purgar_logs_antiguos"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  filas integer;
BEGIN
  DELETE FROM system_logs WHERE ts < now() - interval '90 days';
  GET DIAGNOSTICS filas = ROW_COUNT;
  RETURN filas;
END;
$$;


ALTER FUNCTION "public"."purgar_logs_antiguos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reasignar_cliente"("p_cliente_id" "uuid", "p_nuevo_vendedor" "uuid", "p_motivo" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_supervisor_id   UUID := public.get_operador_id();
  v_supervisor_nombre TEXT;
  v_vendedor_origen UUID;
  v_cliente_nombre  TEXT;
BEGIN
  SELECT nombre INTO v_supervisor_nombre
  FROM public.usuarios
  WHERE id = v_supervisor_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo un supervisor activo puede reasignar clientes';
  END IF;

  IF p_motivo IS NULL OR char_length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'MOTIVO_INVALIDO: El motivo debe tener al menos 10 caracteres';
  END IF;

  SELECT vendedor_id, nombre INTO v_vendedor_origen, v_cliente_nombre
  FROM public.clientes
  WHERE id = p_cliente_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO: El cliente no existe o está inactivo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_nuevo_vendedor AND activo = true
  ) THEN
    RAISE EXCEPTION 'VENDEDOR_INVALIDO: El vendedor destino no existe o está inactivo';
  END IF;

  IF v_vendedor_origen = p_nuevo_vendedor THEN
    RAISE EXCEPTION 'SIN_CAMBIO: El cliente ya pertenece a ese vendedor';
  END IF;

  UPDATE public.clientes
  SET
    vendedor_id          = p_nuevo_vendedor,
    ultima_reasig_por    = v_supervisor_id,
    ultima_reasig_motivo = p_motivo,
    ultima_reasig_en     = now(),
    actualizado_en       = now()
  WHERE id = p_cliente_id;

  INSERT INTO public.reasignaciones_clientes
    (cliente_id, vendedor_origen, vendedor_destino, supervisor_id, motivo)
  VALUES
    (p_cliente_id, v_vendedor_origen, p_nuevo_vendedor, v_supervisor_id, p_motivo);

  PERFORM public.registrar_auditoria(
    p_usuario_id    := v_supervisor_id,
    p_usuario_nombre := v_supervisor_nombre,
    p_usuario_rol   := 'supervisor',
    p_categoria     := 'REASIGNACION',
    p_accion        := 'REASIGNAR_CLIENTE',
    p_descripcion   := 'Cliente "' || v_cliente_nombre || '" reasignado. Motivo: ' || p_motivo,
    p_entidad_tipo  := 'cliente',
    p_entidad_id    := p_cliente_id,
    p_meta          := jsonb_build_object(
      'vendedor_origen', v_vendedor_origen,
      'vendedor_destino', p_nuevo_vendedor,
      'motivo', p_motivo
    )
  );
END;
$$;


ALTER FUNCTION "public"."reasignar_cliente"("p_cliente_id" "uuid", "p_nuevo_vendedor" "uuid", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reciclar_cotizacion"("p_cotizacion_id" "uuid", "p_vendedor_destino_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id         UUID := public.get_operador_id();
  v_usuario_nombre     TEXT;
  v_cotizacion_orig    RECORD;
  v_vendedor_orig_name TEXT;
  v_vendedor_dest_name TEXT;
  v_nueva_id           UUID;
  v_nuevo_numero       BIGINT;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden reciclar cotizaciones';
  END IF;

  SELECT * INTO v_cotizacion_orig
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  IF v_cotizacion_orig.estado NOT IN ('rechazada', 'anulada', 'vencida') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se pueden reciclar cotizaciones rechazadas, anuladas o vencidas';
  END IF;

  SELECT nombre INTO v_vendedor_dest_name
  FROM public.usuarios
  WHERE id = p_vendedor_destino_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDEDOR_INVALIDO: El vendedor destino no existe o está inactivo';
  END IF;

  SELECT nombre INTO v_vendedor_orig_name
  FROM public.usuarios
  WHERE id = v_cotizacion_orig.vendedor_id;

  INSERT INTO public.cotizaciones (
    version, cliente_id, vendedor_id, transportista_id,
    estado, subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd,
    notas_cliente, notas_internas
  ) VALUES (
    1, v_cotizacion_orig.cliente_id, p_vendedor_destino_id,
    v_cotizacion_orig.transportista_id,
    'borrador', v_cotizacion_orig.subtotal_usd, v_cotizacion_orig.descuento_global_pct,
    v_cotizacion_orig.descuento_usd, v_cotizacion_orig.costo_envio_usd,
    v_cotizacion_orig.total_usd,
    v_cotizacion_orig.notas_cliente, v_cotizacion_orig.notas_internas
  )
  RETURNING id, numero INTO v_nueva_id, v_nuevo_numero;

  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_id, ci.producto_id, ci.codigo_snap, ci.nombre_snap,
    ci.unidad_snap, ci.cantidad, ci.precio_unit_usd, ci.descuento_pct,
    ci.total_linea_usd, ci.orden
  FROM public.cotizacion_items ci
  WHERE ci.cotizacion_id = p_cotizacion_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'RECICLAR_COTIZACION',
    p_descripcion    := format(
      'Cotización COT-%s reciclada → COT-%s. Vendedor: %s → %s',
      lpad(v_cotizacion_orig.numero::text, 5, '0'),
      lpad(v_nuevo_numero::text, 5, '0'),
      coalesce(v_vendedor_orig_name, '—'),
      v_vendedor_dest_name
    ),
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_id,
    p_meta           := jsonb_build_object(
      'cotizacion_original_id', p_cotizacion_id,
      'cotizacion_original_numero', v_cotizacion_orig.numero,
      'estado_original', v_cotizacion_orig.estado,
      'vendedor_origen_id', v_cotizacion_orig.vendedor_id,
      'vendedor_origen_nombre', coalesce(v_vendedor_orig_name, '—'),
      'vendedor_destino_id', p_vendedor_destino_id,
      'vendedor_destino_nombre', v_vendedor_dest_name,
      'total_usd', v_cotizacion_orig.total_usd,
      'nuevo_numero', v_nuevo_numero
    )
  );

  RETURN v_nueva_id;
END;
$$;


ALTER FUNCTION "public"."reciclar_cotizacion"("p_cotizacion_id" "uuid", "p_vendedor_destino_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reciclar_despacho"("p_despacho_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id      UUID := public.get_operador_id();
  v_usuario_nombre  TEXT;
  v_despacho        RECORD;
  v_cotizacion_orig RECORD;
  v_nueva_id        UUID;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden reciclar despachos';
  END IF;

  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'anulada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se pueden reciclar despachos anulados';
  END IF;

  SELECT * INTO v_cotizacion_orig
  FROM public.cotizaciones
  WHERE id = v_despacho.cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  INSERT INTO public.cotizaciones (
    version, cliente_id, vendedor_id, transportista_id,
    estado, subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd,
    notas_cliente, notas_internas
  ) VALUES (
    1, v_cotizacion_orig.cliente_id, v_cotizacion_orig.vendedor_id,
    v_cotizacion_orig.transportista_id,
    'borrador', v_cotizacion_orig.subtotal_usd, v_cotizacion_orig.descuento_global_pct,
    v_cotizacion_orig.descuento_usd, v_cotizacion_orig.costo_envio_usd,
    v_cotizacion_orig.total_usd,
    v_cotizacion_orig.notas_cliente, v_cotizacion_orig.notas_internas
  )
  RETURNING id INTO v_nueva_id;

  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_id, ci.producto_id, ci.codigo_snap, ci.nombre_snap,
    ci.unidad_snap, ci.cantidad, ci.precio_unit_usd, ci.descuento_pct,
    ci.total_linea_usd, ci.orden
  FROM public.cotizacion_items ci
  WHERE ci.cotizacion_id = v_despacho.cotizacion_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'RECICLAR_DESPACHO',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_id,
    p_meta           := jsonb_build_object(
      'despacho_id', p_despacho_id,
      'cotizacion_original_id', v_despacho.cotizacion_id,
      'total_usd', v_cotizacion_orig.total_usd
    )
  );

  RETURN v_nueva_id;
END;
$$;


ALTER FUNCTION "public"."reciclar_despacho"("p_despacho_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_abono_cxc"("p_cliente_id" "uuid", "p_monto" numeric, "p_forma_pago" "text" DEFAULT NULL::"text", "p_referencia" "text" DEFAULT NULL::"text", "p_descripcion" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_usuario_id UUID := public.get_operador_id(); v_saldo_actual NUMERIC(12,4); v_nuevo_saldo NUMERIC(12,4); v_cxc_id UUID; BEGIN IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true) THEN RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden registrar abonos'; END IF; IF p_monto <= 0 THEN RAISE EXCEPTION 'MONTO_INVALIDO: El monto debe ser mayor a cero'; END IF; SELECT COALESCE(saldo_pendiente, 0) INTO v_saldo_actual FROM public.clientes WHERE id = p_cliente_id AND activo = true FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO: Cliente no existe o está inactivo'; END IF; IF v_saldo_actual <= 0 THEN RAISE EXCEPTION 'SIN_DEUDA: El cliente no tiene saldo pendiente'; END IF; v_nuevo_saldo := GREATEST(0, v_saldo_actual - p_monto); INSERT INTO public.cuentas_por_cobrar (cliente_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia, descripcion, registrado_por) VALUES (p_cliente_id, 'abono', p_monto, v_nuevo_saldo, p_forma_pago, NULLIF(TRIM(COALESCE(p_referencia, '')), ''), COALESCE(NULLIF(TRIM(p_descripcion), ''), 'Abono recibido'), v_usuario_id) RETURNING id INTO v_cxc_id; UPDATE public.clientes SET saldo_pendiente = v_nuevo_saldo WHERE id = p_cliente_id; RETURN v_cxc_id; END; $$;


ALTER FUNCTION "public"."registrar_abono_cxc"("p_cliente_id" "uuid", "p_monto" numeric, "p_forma_pago" "text", "p_referencia" "text", "p_descripcion" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_auditoria"("p_accion" "text", "p_entidad" "text", "p_entidad_id" "uuid" DEFAULT NULL::"uuid", "p_detalle" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_usuario_id UUID;
  v_usuario_nombre TEXT;
  v_usuario_rol TEXT;
BEGIN
  v_usuario_id := public.get_operador_id();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'USUARIO_NO_AUTENTICADO';
  END IF;

  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo = true;

  IF v_usuario_nombre IS NULL THEN
    RAISE EXCEPTION 'USUARIO_NO_ENCONTRADO';
  END IF;

  INSERT INTO public.auditoria (
    usuario_id, usuario_nombre, usuario_rol,
    accion, entidad, entidad_id, detalle
  ) VALUES (
    v_usuario_id, v_usuario_nombre, v_usuario_rol,
    p_accion, p_entidad, p_entidad_id, p_detalle
  );
END;
$$;


ALTER FUNCTION "public"."registrar_auditoria"("p_accion" "text", "p_entidad" "text", "p_entidad_id" "uuid", "p_detalle" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_auditoria"("p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_categoria" "public"."categoria_auditoria", "p_accion" "text", "p_descripcion" "text" DEFAULT NULL::"text", "p_entidad_tipo" "text" DEFAULT NULL::"text", "p_entidad_id" "uuid" DEFAULT NULL::"uuid", "p_meta" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.auditoria (
    usuario_id, usuario_nombre, usuario_rol,
    categoria, accion, descripcion,
    entidad_tipo, entidad_id, meta
  ) VALUES (
    p_usuario_id, p_usuario_nombre, p_usuario_rol,
    p_categoria, p_accion, p_descripcion,
    p_entidad_tipo, p_entidad_id, p_meta
  );
END;
$$;


ALTER FUNCTION "public"."registrar_auditoria"("p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_categoria" "public"."categoria_auditoria", "p_accion" "text", "p_descripcion" "text", "p_entidad_tipo" "text", "p_entidad_id" "uuid", "p_meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_cargo_cxc"("p_despacho_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_usuario_id UUID := public.get_operador_id(); v_despacho RECORD; v_saldo_actual NUMERIC(12,4); v_nuevo_saldo NUMERIC(12,4); v_cxc_id UUID; BEGIN IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true) THEN RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden registrar cargos CxC'; END IF; SELECT nd.id, nd.total_usd, nd.cliente_id, nd.numero, c.nombre AS cliente_nombre INTO v_despacho FROM public.notas_despacho nd JOIN public.clientes c ON c.id = nd.cliente_id WHERE nd.id = p_despacho_id; IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO: No existe el despacho %', p_despacho_id; END IF; IF EXISTS (SELECT 1 FROM public.cuentas_por_cobrar WHERE despacho_id = p_despacho_id AND tipo = 'cargo') THEN RAISE EXCEPTION 'CARGO_DUPLICADO: Ya existe un cargo para este despacho'; END IF; SELECT COALESCE(saldo_pendiente, 0) INTO v_saldo_actual FROM public.clientes WHERE id = v_despacho.cliente_id FOR UPDATE; v_nuevo_saldo := v_saldo_actual + v_despacho.total_usd; INSERT INTO public.cuentas_por_cobrar (cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion, registrado_por) VALUES (v_despacho.cliente_id, p_despacho_id, 'cargo', v_despacho.total_usd, v_nuevo_saldo, 'Orden de despacho #' || v_despacho.numero, v_usuario_id) RETURNING id INTO v_cxc_id; UPDATE public.clientes SET saldo_pendiente = v_nuevo_saldo WHERE id = v_despacho.cliente_id; RETURN v_cxc_id; END; $$;


ALTER FUNCTION "public"."registrar_cargo_cxc"("p_despacho_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_cargo_cxc"("p_cliente_id" "uuid", "p_despacho_id" "uuid", "p_monto_usd" numeric, "p_descripcion" "text", "p_registrado_por" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_saldo_actual   NUMERIC(12,2);
  v_saldo_nuevo    NUMERIC(12,2);
BEGIN
  -- 1. Bloquear y leer saldo actual del cliente
  SELECT saldo_pendiente INTO v_saldo_actual
  FROM public.clientes
  WHERE id = p_cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO';
  END IF;

  v_saldo_nuevo := COALESCE(v_saldo_actual, 0) + p_monto_usd;

  -- 2. Insertar transacción CxC
  INSERT INTO public.cuentas_por_cobrar (
    cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
    descripcion, registrado_por
  ) VALUES (
    p_cliente_id, p_despacho_id, 'cargo', p_monto_usd, v_saldo_nuevo,
    p_descripcion, p_registrado_por
  );

  -- 3. Actualizar saldo del cliente
  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_nuevo
  WHERE id = p_cliente_id;

  RETURN v_saldo_nuevo;
END;
$$;


ALTER FUNCTION "public"."registrar_cargo_cxc"("p_cliente_id" "uuid", "p_despacho_id" "uuid", "p_monto_usd" numeric, "p_descripcion" "text", "p_registrado_por" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_pago_comision"("p_comision_id" "uuid", "p_cuenta_id" "uuid", "p_operador_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_comision RECORD;
  v_saldo_por_pagar NUMERIC;
  v_nuevo_estado TEXT;
  v_res JSONB;
BEGIN
  -- 1. Bloquear la fila para evitar concurrencia (FOR UPDATE)
  SELECT * INTO v_comision 
  FROM public.comisiones 
  WHERE id = p_comision_id 
    AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  -- 2. Validaciones Críticas
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comisión no encontrada';
  END IF;

  IF v_comision.estado = 'pagada' THEN
    RAISE EXCEPTION 'Esta comisión ya fue marcada como pagada';
  END IF;

  -- Cálculo de saldo (Liberado - Ya Pagado)
  v_saldo_por_pagar := GREATEST(0, v_comision.comision_liberada - COALESCE(v_comision.comision_pagada_monto, 0));

  IF v_saldo_por_pagar <= 0 AND v_comision.comision_retenida > 0 THEN
    RAISE EXCEPTION 'No hay montos liberados disponibles para pago en esta comisión';
  END IF;

  -- 3. Determinar Estado Final
  -- Si después de este pago aún hay algo retenido, es pago_parcial. Si no, es pagada.
  v_nuevo_estado := CASE 
    WHEN v_comision.comision_retenida > 0 THEN 'pago_parcial' 
    ELSE 'pagada' 
  END;

  -- 4. Ejecutar Actualización Atómica
  UPDATE public.comisiones
  SET 
    estado = v_nuevo_estado,
    comision_pagada_monto = v_comision.comision_liberada, -- Se paga todo lo liberado hasta ahora
    pagada_en = NOW(),
    pagada_por = p_operador_id,
    actualizado_en = NOW()
  WHERE id = p_comision_id;

  -- 5. Construir Respuesta para Auditoría
  v_res := jsonb_build_object(
    'ok', true,
    'monto_pagado', v_saldo_por_pagar,
    'estado_anterior', v_comision.estado,
    'estado_nuevo', v_nuevo_estado,
    'total_comision', v_comision.total_comision,
    'despacho_id', v_comision.despacho_id,
    'vendedor_id', v_comision.vendedor_id
  );

  RETURN v_res;
END;
$$;


ALTER FUNCTION "public"."registrar_pago_comision"("p_comision_id" "uuid", "p_cuenta_id" "uuid", "p_operador_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reiniciar_correlativos"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  ALTER SEQUENCE cotizaciones_numero_seq RESTART WITH 1;
  ALTER SEQUENCE notas_despacho_numero_seq RESTART WITH 1;
  ALTER SEQUENCE inventario_movimientos_numero_seq RESTART WITH 1;
END;
$$;


ALTER FUNCTION "public"."reiniciar_correlativos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_cuenta_id_purchase_orders"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Si ya viene con cuenta_id, respetarlo
  IF NEW.cuenta_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Si hay un usuario autenticado normal (Frontend directo), usamos su ID
  IF auth.uid() IS NOT NULL THEN
    NEW.cuenta_id := auth.uid();
    RETURN NEW;
  END IF;

  -- Si es un proceso en background (Worker con Service Key), inferimos a través de relaciones
  IF TG_TABLE_NAME = 'ordenes_compra' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'orden_compra_items' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.ordenes_compra WHERE id = NEW.orden_compra_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_cuenta_id_purchase_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_cuenta_id_smart"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.cuenta_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    NEW.cuenta_id := auth.uid();
    RETURN NEW;
  END IF;
  -- Inferencia en el Worker API via relaciones
  IF TG_TABLE_NAME = 'clientes' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'cotizaciones' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'cotizacion_items' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.cotizaciones WHERE id = NEW.cotizacion_id;
  ELSIF TG_TABLE_NAME = 'notas_despacho' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'notas_despacho_items' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.notas_despacho WHERE id = NEW.despacho_id;
  ELSIF TG_TABLE_NAME = 'comisiones' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.vendedor_id;
  ELSIF TG_TABLE_NAME = 'inventario_movimientos' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.productos WHERE id = NEW.producto_id;
  ELSIF TG_TABLE_NAME = 'cuentas_por_cobrar' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.clientes WHERE id = NEW.cliente_id;
  ELSIF TG_TABLE_NAME = 'despacho_descuentos' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.notas_despacho WHERE id = NEW.despacho_id;
  ELSIF TG_TABLE_NAME = 'reasignaciones_clientes' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.clientes WHERE id = NEW.cliente_id;
  ELSIF TG_TABLE_NAME = 'auditoria' THEN
    IF NEW.usuario_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.usuario_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'seguimiento_operativo' THEN
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.clientes WHERE id = NEW.cliente_id;
    ELSIF NEW.cotizacion_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.cotizaciones WHERE id = NEW.cotizacion_id;
    ELSIF NEW.despacho_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.notas_despacho WHERE id = NEW.despacho_id;
    ELSIF NEW.usuario_id IS NOT NULL THEN
      SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.usuario_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_cuenta_id_smart"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sincronizar_prestamos_despacho"("p_despacho_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_despacho RECORD;
  v_item RECORD;
  v_tiene_prestamos BOOLEAN := FALSE;
BEGIN
  -- 1. Obtener datos del despacho
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- 2. Si el despacho está en estado 'despachada' o 'entregada', sincronizar préstamos
  IF v_despacho.estado IN ('despachada', 'entregada') THEN
    -- Borrar préstamos de este despacho que ya no existen en los ítems actualizados
    DELETE FROM public.cliente_prestamos cp
    WHERE cp.despacho_id = p_despacho_id
      AND cp.despacho_item_id NOT IN (
        SELECT id FROM public.notas_despacho_items 
        WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
      );

    -- Insertar o actualizar cada ítem que sea préstamo
    FOR v_item IN 
      SELECT * FROM public.notas_despacho_items 
      WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
    LOOP
      INSERT INTO public.cliente_prestamos (
        cliente_id, despacho_item_id, despacho_id, producto_id, cantidad_prestada, estado
      ) VALUES (
        COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id),
        v_item.id,
        p_despacho_id,
        v_item.producto_id,
        v_item.cantidad,
        'pendiente'
      )
      ON CONFLICT (despacho_item_id) DO UPDATE SET
        cantidad_prestada = v_item.cantidad,
        cliente_id = COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id);
    END LOOP;

  ELSE
    -- Si el despacho no está aprobado o entregado (p. ej., pendiente o anulado), eliminar registros de préstamos
    DELETE FROM public.cliente_prestamos WHERE despacho_id = p_despacho_id;
  END IF;

  -- 3. Calcular si existen ítems con es_prestamo = TRUE para este despacho y actualizar tiene_prestamos
  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items 
    WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
  ) INTO v_tiene_prestamos;

  UPDATE public.notas_despacho 
  SET tiene_prestamos = v_tiene_prestamos 
  WHERE id = p_despacho_id;
END;
$$;


ALTER FUNCTION "public"."sincronizar_prestamos_despacho"("p_despacho_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tester_cleanup_cotizacion"("p_cotizacion_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ DECLARE v_rol TEXT; v_despacho_ids UUID[]; BEGIN v_rol := public.get_rol_actual(); IF v_rol NOT IN ('supervisor', 'administracion') THEN RAISE EXCEPTION 'Solo supervisores pueden ejecutar limpieza de tester'; END IF; SELECT array_agg(id) INTO v_despacho_ids FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id; IF v_despacho_ids IS NOT NULL THEN DELETE FROM public.despacho_descuentos WHERE despacho_id = ANY(v_despacho_ids); DELETE FROM public.cuentas_por_cobrar WHERE despacho_id = ANY(v_despacho_ids); DELETE FROM public.comisiones WHERE despacho_id = ANY(v_despacho_ids); DELETE FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id; END IF; DELETE FROM public.comisiones WHERE cotizacion_id = p_cotizacion_id; DELETE FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id; DELETE FROM public.cotizaciones WHERE id = p_cotizacion_id; END; $$;


ALTER FUNCTION "public"."tester_cleanup_cotizacion"("p_cotizacion_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_sincronizar_prestamos_cabecera"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  PERFORM public.sincronizar_prestamos_despacho(NEW.id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tg_sincronizar_prestamos_cabecera"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_sincronizar_prestamos_despacho"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sincronizar_prestamos_despacho(OLD.despacho_id);
    RETURN OLD;
  ELSE
    PERFORM public.sincronizar_prestamos_despacho(NEW.despacho_id);
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."tg_sincronizar_prestamos_despacho"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tiene_gate_configurado"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM configuracion_negocio
    WHERE id = 1
      AND gate_email IS NOT NULL
      AND gate_password_hash IS NOT NULL
  );
$$;


ALTER FUNCTION "public"."tiene_gate_configurado"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_clientes_generar_codigo"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.codigo_cliente IS NULL OR NEW.codigo_cliente = '' THEN
    NEW.codigo_cliente := public.generar_codigo_cliente_unico();
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_clientes_generar_codigo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_despacho_copiar_numero"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  -- Si viene cotizacion_id, copiar su numero
  IF NEW.cotizacion_id IS NOT NULL THEN
    SELECT numero INTO v_numero
    FROM public.cotizaciones
    WHERE id = NEW.cotizacion_id;

    IF v_numero IS NOT NULL THEN
      NEW.numero := v_numero;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_despacho_copiar_numero"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_liberar_comision_por_pago"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_despacho_id UUID;
  v_cliente_id UUID;
  v_balance NUMERIC(12,4);
  v_saldo_cliente NUMERIC(12,4);
BEGIN
  -- Obtener despacho_id y cliente_id según el tipo de operación
  IF TG_OP = 'DELETE' THEN
    v_despacho_id := OLD.despacho_id;
    v_cliente_id := OLD.cliente_id;
  ELSE
    v_despacho_id := NEW.despacho_id;
    v_cliente_id := NEW.cliente_id;
  END IF;

  -- CASO 1: El abono o movimiento está asociado a un despacho específico
  IF v_despacho_id IS NOT NULL THEN
    -- Calcular balance neto de ese despacho (cargos - abonos)
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END
    ), 0)
    INTO v_balance
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = v_despacho_id;

    IF v_balance <= 0.01 THEN
      -- Liberar la comisión: cta_cobrar -> pendiente
      UPDATE public.comisiones
      SET estado = 'pendiente', actualizadoen = now()
      WHERE despachoid = v_despacho_id
        AND estado = 'cta_cobrar';
    ELSE
      -- Volver a retener la comisión si la deuda vuelve a ser positiva (reversión de abono)
      UPDATE public.comisiones
      SET estado = 'cta_cobrar', actualizadoen = now()
      WHERE despachoid = v_despacho_id
        AND estado = 'pendiente';
    END IF;
  END IF;

  -- CASO 2: Manejo de abonos globales / saldo del cliente general
  IF v_cliente_id IS NOT NULL THEN
    -- Calcular balance global de cuentas por cobrar para el cliente
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END
    ), 0)
    INTO v_saldo_cliente
    FROM public.cuentas_por_cobrar
    WHERE cliente_id = v_cliente_id;

    -- Si el cliente saldó toda su deuda global, liberamos todas sus comisiones 'cta_cobrar'
    IF v_saldo_cliente <= 0.01 THEN
      UPDATE public.comisiones com
      SET estado = 'pendiente', actualizadoen = now()
      WHERE com.estado = 'cta_cobrar'
        AND EXISTS (
          SELECT 1 FROM public.notas_despacho nd
          WHERE nd.id = com.despachoid
            AND nd.cliente_id = v_cliente_id
        );
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."trg_liberar_comision_por_pago"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalcular_saldo_pendiente"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cliente_id UUID;
  v_saldo_real NUMERIC(12,4);
BEGIN
  -- En DELETE, NEW es null; usamos OLD
  v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);

  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = v_cliente_id;

  v_saldo_real := GREATEST(0, v_saldo_real);

  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_real
  WHERE id = v_cliente_id
    AND saldo_pendiente IS DISTINCT FROM v_saldo_real;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."trg_recalcular_saldo_pendiente"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalcular_saldo_pendiente_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_saldo_real NUMERIC(12,4);
BEGIN
  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_cobrar
  WHERE cliente_id = OLD.cliente_id;

  v_saldo_real := GREATEST(0, v_saldo_real);

  UPDATE public.clientes
  SET saldo_pendiente = v_saldo_real
  WHERE id = OLD.cliente_id
    AND saldo_pendiente IS DISTINCT FROM v_saldo_real;

  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."trg_recalcular_saldo_pendiente_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_cliente_para_cotizar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_cliente RECORD;
BEGIN
  SELECT nombre, telefono, email
  INTO v_cliente
  FROM public.clientes WHERE id = NEW.cliente_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_INVALIDO: El cliente no existe o está inactivo';
  END IF;

  IF v_cliente.nombre IS NULL OR trim(v_cliente.nombre) = '' THEN
    RAISE EXCEPTION 'CLIENTE_SIN_NOMBRE: El cliente debe tener nombre para cotizar';
  END IF;

  IF (v_cliente.telefono IS NULL OR trim(v_cliente.telefono) = '')
     AND (v_cliente.email IS NULL OR trim(v_cliente.email) = '') THEN
    RAISE EXCEPTION 'CLIENTE_SIN_CONTACTO: El cliente debe tener teléfono o email para cotizar';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_cliente_para_cotizar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_gate_acceso"("p_email" "text", "p_password_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_email TEXT;
  v_hash TEXT;
BEGIN
  SELECT gate_email, gate_password_hash
  INTO v_email, v_hash
  FROM configuracion_negocio
  WHERE id = 1;

  -- Si no hay gate configurado, permitir acceso
  IF v_email IS NULL OR v_hash IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN lower(trim(p_email)) = lower(trim(v_email))
     AND p_password_hash = v_hash;
END;
$$;


ALTER FUNCTION "public"."validar_gate_acceso"("p_email" "text", "p_password_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_transicion_estado"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  transiciones_validas TEXT[][] := ARRAY[
    -- [estado_origen, estado_destino]
    ARRAY['borrador',  'enviada'],
    ARRAY['borrador',  'anulada'],
    ARRAY['enviada',   'aceptada'],
    ARRAY['enviada',   'rechazada'],
    ARRAY['enviada',   'vencida'],
    ARRAY['enviada',   'anulada'],
    ARRAY['enviada',   'borrador'],     -- reabrir para edición
    ARRAY['rechazada', 'borrador'],     -- reabrir para edición
    ARRAY['aceptada',  'anulada'],      -- Solo supervisor, validado en RPC
    ARRAY['vencida',   'anulada']
  ];
  par TEXT[];
  valido BOOLEAN := false;
BEGIN
  -- Si el estado no cambia, permitir
  IF OLD.estado = NEW.estado THEN
    RETURN NEW;
  END IF;

  FOREACH par SLICE 1 IN ARRAY transiciones_validas LOOP
    IF par[1] = OLD.estado::TEXT AND par[2] = NEW.estado::TEXT THEN
      valido := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT valido THEN
    RAISE EXCEPTION 'Transición de estado inválida: % → %', OLD.estado, NEW.estado;
  END IF;

  -- Registrar timestamps automáticamente
  IF NEW.estado = 'enviada' AND OLD.estado = 'borrador' THEN
    NEW.enviada_en = now();
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_transicion_estado"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."auditoria" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "usuario_id" "uuid",
    "usuario_nombre" "text" DEFAULT 'Sistema'::"text" NOT NULL,
    "usuario_rol" "text" DEFAULT 'sistema'::"text" NOT NULL,
    "categoria" "public"."categoria_auditoria" NOT NULL,
    "accion" "text" NOT NULL,
    "descripcion" "text",
    "entidad_tipo" "text",
    "entidad_id" "uuid",
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_origen" "text",
    "cuenta_id" "uuid"
);


ALTER TABLE "public"."auditoria" OWNER TO "postgres";


COMMENT ON TABLE "public"."auditoria" IS 'Registro inmutable. Solo INSERT. Ver políticas RLS.';



CREATE TABLE IF NOT EXISTS "public"."cliente_prestamos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid",
    "despacho_item_id" "uuid",
    "despacho_id" "uuid",
    "producto_id" "uuid",
    "cantidad_prestada" numeric(12,4) NOT NULL,
    "cantidad_devuelta" numeric(12,4) DEFAULT 0.0000,
    "cantidad_facturada" numeric(12,4) DEFAULT 0.0000,
    "estado" character varying(30) DEFAULT 'pendiente'::character varying,
    "creado_en" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."cliente_prestamos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "rif_cedula" "text",
    "telefono" "text",
    "email" "text",
    "direccion" "text",
    "notas" "text",
    "vendedor_id" "uuid" NOT NULL,
    "asignado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ultima_reasig_por" "uuid",
    "ultima_reasig_motivo" "text",
    "ultima_reasig_en" timestamp with time zone,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo_cliente" "text" DEFAULT 'natural'::"text",
    "saldo_pendiente" numeric(12,4) DEFAULT 0 NOT NULL,
    "estado" "text",
    "ciudad" "text",
    "cuenta_id" "uuid",
    "codigo_cliente" "text" NOT NULL,
    CONSTRAINT "clientes_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) > 0))
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clientes"."vendedor_id" IS 'Propietario del cliente. Solo modificable vía RPC reasignar_cliente()';



CREATE TABLE IF NOT EXISTS "public"."comisiones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "despachoid" "uuid" NOT NULL,
    "vendedorid" "uuid",
    "cotizacionid" "uuid" NOT NULL,
    "cuentaid" "uuid" NOT NULL,
    "totalcomision" numeric(12,2) DEFAULT 0 NOT NULL,
    "comisioncabilla" numeric(12,2) DEFAULT 0 NOT NULL,
    "comisionotros" numeric(12,2) DEFAULT 0 NOT NULL,
    "pctcabilla" numeric(5,2) DEFAULT 0 NOT NULL,
    "pctotros" numeric(5,2) DEFAULT 0 NOT NULL,
    "montopagado" numeric(12,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "pagadaen" timestamp with time zone,
    "pagadapor" "uuid",
    "creadoen" timestamp with time zone DEFAULT "now"(),
    "actualizadoen" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "comisiones_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'cta_cobrar'::"text", 'pagada'::"text"])))
);


ALTER TABLE "public"."comisiones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuracion_negocio" (
    "id" integer DEFAULT 1 NOT NULL,
    "nombre_negocio" "text" DEFAULT 'Ferretería'::"text" NOT NULL,
    "rif_negocio" "text",
    "telefono_negocio" "text",
    "direccion_negocio" "text",
    "email_negocio" "text",
    "logo_url" "text",
    "moneda_principal" "text" DEFAULT 'USD'::"text" NOT NULL,
    "validez_cotizacion_dias" integer DEFAULT 15 NOT NULL,
    "pie_pagina_pdf" "text" DEFAULT 'Gracias por su preferencia.'::"text",
    "tasa_bcv_manual" numeric(10,4),
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gate_email" "text",
    "gate_password_hash" "text",
    "iva_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "comision_pct_cabilla" numeric(5,2) DEFAULT 2 NOT NULL,
    "comision_pct_otros" numeric(5,2) DEFAULT 3 NOT NULL,
    "comision_categoria_cabilla" "text" DEFAULT 'Cabilla'::"text" NOT NULL,
    "_comision_extras" "jsonb" DEFAULT '[]'::"jsonb",
    "cuenta_id" "uuid",
    "comision_pct_externos" numeric(5,2) DEFAULT 3 NOT NULL,
    "nota_entrega_mostrar_iva" boolean DEFAULT true NOT NULL,
    "nota_entrega_plantilla" "text" DEFAULT 'estandar'::"text" NOT NULL,
    "markup_pct_externo" numeric(5,2) DEFAULT 5.00 NOT NULL,
    "comision_ext_pct_cabilla" numeric(5,2) DEFAULT 2.00 NOT NULL,
    "comision_ext_pct_otros" numeric(5,2) DEFAULT 3.00 NOT NULL,
    "comision_ext_pct_externos" numeric(5,2) DEFAULT 3.00 NOT NULL,
    "_comision_ext_extras" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "configuracion_negocio_moneda_principal_check" CHECK (("moneda_principal" = ANY (ARRAY['USD'::"text", 'VES'::"text"]))),
    CONSTRAINT "configuracion_negocio_validez_cotizacion_dias_check" CHECK (("validez_cotizacion_dias" > 0))
);


ALTER TABLE "public"."configuracion_negocio" OWNER TO "postgres";


COMMENT ON TABLE "public"."configuracion_negocio" IS 'Tabla singleton (solo id=1). Configuración global del negocio para PDFs.';



COMMENT ON COLUMN "public"."configuracion_negocio"."comision_pct_cabilla" IS 'Porcentaje de comisión para productos de la categoría cabilla';



COMMENT ON COLUMN "public"."configuracion_negocio"."comision_pct_otros" IS 'Porcentaje de comisión para productos de otras categorías';



COMMENT ON COLUMN "public"."configuracion_negocio"."comision_categoria_cabilla" IS 'Nombre de la categoría considerada cabilla (match case-insensitive)';



COMMENT ON COLUMN "public"."configuracion_negocio"."comision_pct_externos" IS 'Porcentaje de comisión para productos externos (por defecto 3%).';



COMMENT ON COLUMN "public"."configuracion_negocio"."nota_entrega_mostrar_iva" IS 'Si es TRUE, el PDF de la nota de entrega incluye la fila de IVA. Si es FALSE, la omite.';



CREATE TABLE IF NOT EXISTS "public"."cotizacion_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cotizacion_id" "uuid" NOT NULL,
    "producto_id" "uuid",
    "codigo_snap" "text",
    "nombre_snap" "text" NOT NULL,
    "unidad_snap" "text" DEFAULT 'und'::"text" NOT NULL,
    "cantidad" numeric(10,2) NOT NULL,
    "precio_unit_usd" numeric(12,4) NOT NULL,
    "descuento_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "total_linea_usd" numeric(12,4) NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "cuenta_id" "uuid",
    "origen" "text" DEFAULT 'inventario'::"text" NOT NULL,
    CONSTRAINT "cot_items_externo_prod_check" CHECK ((("origen" = 'inventario'::"text") OR (("origen" = 'externo'::"text") AND ("producto_id" IS NULL)))),
    CONSTRAINT "cot_items_origen_check" CHECK (("origen" = ANY (ARRAY['inventario'::"text", 'externo'::"text"]))),
    CONSTRAINT "cotizacion_items_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "cotizacion_items_descuento_pct_check" CHECK ((("descuento_pct" >= (0)::numeric) AND ("descuento_pct" <= (100)::numeric))),
    CONSTRAINT "cotizacion_items_nombre_snap_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre_snap")) > 0)),
    CONSTRAINT "cotizacion_items_precio_unit_usd_check" CHECK (("precio_unit_usd" >= (0)::numeric)),
    CONSTRAINT "cotizacion_items_total_linea_usd_check" CHECK (("total_linea_usd" >= (0)::numeric))
);


ALTER TABLE "public"."cotizacion_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cotizacion_items"."producto_id" IS 'Referencia al catálogo. Puede ser NULL si el producto fue eliminado.';



COMMENT ON COLUMN "public"."cotizacion_items"."nombre_snap" IS 'Nombre del producto al momento de cotizar. No cambia si el catálogo cambia.';



COMMENT ON COLUMN "public"."cotizacion_items"."origen" IS 'Origen del ítem: inventario (producto del catálogo) o externo (producto manual sin stock)';



CREATE TABLE IF NOT EXISTS "public"."cotizaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "numero" integer NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "cotizacion_raiz_id" "uuid",
    "cliente_id" "uuid" NOT NULL,
    "vendedor_id" "uuid" NOT NULL,
    "transportista_id" "uuid",
    "estado" "public"."estado_cotizacion" DEFAULT 'borrador'::"public"."estado_cotizacion" NOT NULL,
    "subtotal_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "descuento_global_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "descuento_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "costo_envio_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "total_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "tasa_bcv_snapshot" numeric(10,4),
    "total_bs_snapshot" numeric(14,2),
    "valida_hasta" "date",
    "notas_cliente" "text",
    "notas_internas" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "enviada_en" timestamp with time zone,
    "exportada_en" timestamp with time zone,
    "cuenta_id" "uuid",
    "corte_usd" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "canal_venta" "text" DEFAULT 'interno'::"text",
    CONSTRAINT "chk_version_raiz" CHECK (((("version" = 1) AND ("cotizacion_raiz_id" IS NULL)) OR (("version" > 1) AND ("cotizacion_raiz_id" IS NOT NULL)))),
    CONSTRAINT "cotizaciones_canal_venta_check" CHECK (("canal_venta" = ANY (ARRAY['interno'::"text", 'externo'::"text"]))),
    CONSTRAINT "cotizaciones_corte_usd_check" CHECK (("corte_usd" >= (0)::numeric)),
    CONSTRAINT "cotizaciones_costo_envio_usd_check" CHECK (("costo_envio_usd" >= (0)::numeric)),
    CONSTRAINT "cotizaciones_descuento_global_pct_check" CHECK ((("descuento_global_pct" >= (0)::numeric) AND ("descuento_global_pct" <= (100)::numeric))),
    CONSTRAINT "cotizaciones_descuento_usd_check" CHECK (("descuento_usd" >= (0)::numeric)),
    CONSTRAINT "cotizaciones_subtotal_usd_check" CHECK (("subtotal_usd" >= (0)::numeric)),
    CONSTRAINT "cotizaciones_total_usd_check" CHECK (("total_usd" >= (0)::numeric)),
    CONSTRAINT "cotizaciones_version_check" CHECK (("version" >= 1))
);


ALTER TABLE "public"."cotizaciones" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cotizaciones"."cotizacion_raiz_id" IS 'UUID de la cotización original (v1). NULL si esta ES la original.';



COMMENT ON COLUMN "public"."cotizaciones"."notas_internas" IS 'Oculto en la UI del vendedor vía la vista v_cotizaciones_vendedor';



COMMENT ON COLUMN "public"."cotizaciones"."corte_usd" IS 'Costo del servicio de corte. Exento de IVA, se suma directamente al total_usd junto con costo_envio_usd.';



ALTER TABLE "public"."cotizaciones" ALTER COLUMN "numero" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cotizaciones_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cuentas_por_cobrar" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "despacho_id" "uuid",
    "tipo" "text" NOT NULL,
    "monto_usd" numeric(12,4) NOT NULL,
    "saldo_usd" numeric(12,4) NOT NULL,
    "forma_pago_abono" "text",
    "referencia" "text",
    "descripcion" "text" NOT NULL,
    "registrado_por" "uuid" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cuenta_id" "uuid",
    "fecha_vencimiento" "date",
    "metodo_pago" "text" DEFAULT 'cxc'::"text" NOT NULL,
    CONSTRAINT "cuentas_por_cobrar_metodo_pago_check" CHECK (("metodo_pago" = ANY (ARRAY['cxc'::"text", 'cod'::"text"]))),
    CONSTRAINT "cuentas_por_cobrar_monto_usd_check" CHECK (("monto_usd" > (0)::numeric)),
    CONSTRAINT "cuentas_por_cobrar_tipo_check" CHECK (("tipo" = ANY (ARRAY['cargo'::"text", 'abono'::"text"])))
);


ALTER TABLE "public"."cuentas_por_cobrar" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cuentas_por_cobrar"."fecha_vencimiento" IS 'Fecha de vencimiento para los créditos (días de crédito sumados a la fecha de creación)';



CREATE TABLE IF NOT EXISTS "public"."despacho_descuentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "despacho_id" "uuid" NOT NULL,
    "cotizacion_item_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "valor" numeric(12,4) NOT NULL,
    "monto_usd" numeric(12,4) NOT NULL,
    "aplicado_por" "uuid" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cuenta_id" "uuid",
    "despacho_item_id" "uuid",
    CONSTRAINT "despacho_descuentos_monto_usd_check" CHECK (("monto_usd" >= (0)::numeric)),
    CONSTRAINT "despacho_descuentos_tipo_check" CHECK (("tipo" = ANY (ARRAY['porcentaje'::"text", 'monto'::"text", 'monto_unitario'::"text"]))),
    CONSTRAINT "despacho_descuentos_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."despacho_descuentos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."despacho_descuentos"."despacho_item_id" IS 'Referencia al ítem del despacho (nuevo flujo). cotizacion_item_id queda para compatibilidad con registros anteriores.';



CREATE TABLE IF NOT EXISTS "public"."inventario_movimientos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lote_id" "uuid" NOT NULL,
    "tipo" "public"."tipo_movimiento" NOT NULL,
    "motivo" "text" NOT NULL,
    "producto_id" "uuid",
    "producto_nombre" "text" NOT NULL,
    "cantidad" numeric(10,2) NOT NULL,
    "stock_anterior" numeric(10,2) NOT NULL,
    "stock_nuevo" numeric(10,2) NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "usuario_nombre" "text" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "numero" integer NOT NULL,
    "motivo_tipo" "public"."motivo_movimiento" DEFAULT 'otro'::"public"."motivo_movimiento" NOT NULL,
    "usuario_color" "text",
    "cuenta_id" "uuid",
    CONSTRAINT "inventario_movimientos_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "inventario_movimientos_motivo_check" CHECK (("char_length"(TRIM(BOTH FROM "motivo")) > 0))
);


ALTER TABLE "public"."inventario_movimientos" OWNER TO "postgres";


ALTER TABLE "public"."inventario_movimientos" ALTER COLUMN "numero" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."inventario_movimientos_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notas_despacho" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "numero" integer NOT NULL,
    "cotizacion_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "vendedor_id" "uuid" NOT NULL,
    "transportista_id" "uuid",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "total_usd" numeric(12,4) NOT NULL,
    "notas" "text",
    "creado_por" "uuid" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "despachada_en" timestamp with time zone,
    "entregada_en" timestamp with time zone,
    "forma_pago" "text",
    "flete_usd" numeric(12,2) DEFAULT 0,
    "referencia_pago" "text",
    "forma_pago_cliente" "text",
    "descuento_total_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "cuenta_id" "uuid",
    "cliente_factura_id" "uuid",
    "corte_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "items_editado_en" timestamp with time zone,
    "items_editado_por" "text",
    "tasa_snapshot" numeric(12,4),
    "motivo_devolucion" "text",
    "motivo_anulacion" "text",
    "aprobado_por_nombre" "text",
    "tiene_prestamos" boolean DEFAULT false,
    "direccion_envio_direccion" "text",
    "direccion_envio_ciudad" "text",
    "direccion_envio_estado" "text",
    CONSTRAINT "notas_despacho_corte_usd_check" CHECK (("corte_usd" >= (0)::numeric)),
    CONSTRAINT "notas_despacho_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'despachada'::"text", 'entregada'::"text", 'anulada'::"text"]))),
    CONSTRAINT "notas_despacho_total_usd_check" CHECK (("total_usd" >= (0)::numeric))
);


ALTER TABLE "public"."notas_despacho" OWNER TO "postgres";


COMMENT ON COLUMN "public"."notas_despacho"."tasa_snapshot" IS 'Tasa de cambio (Bs/USD) al momento de confirmar la entrega. Fuente de verdad para calcular montos en Bs.';



CREATE TABLE IF NOT EXISTS "public"."notas_despacho_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "despacho_id" "uuid" NOT NULL,
    "producto_id" "uuid",
    "codigo_snap" "text",
    "nombre_snap" "text" NOT NULL,
    "unidad_snap" "text" DEFAULT 'und'::"text" NOT NULL,
    "origen" "text" DEFAULT 'inventario'::"text" NOT NULL,
    "cantidad_original" numeric(10,2) NOT NULL,
    "precio_original" numeric(12,4) DEFAULT 0 NOT NULL,
    "cantidad" numeric(10,2) NOT NULL,
    "precio_unit_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "descuento_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "total_linea_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "editado_en" timestamp with time zone,
    "editado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cuenta_id" "uuid",
    "es_prestamo" boolean DEFAULT false,
    CONSTRAINT "notas_despacho_items_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "notas_despacho_items_descuento_pct_check" CHECK ((("descuento_pct" >= (0)::numeric) AND ("descuento_pct" <= (100)::numeric)))
);


ALTER TABLE "public"."notas_despacho_items" OWNER TO "postgres";


ALTER TABLE "public"."notas_despacho" ALTER COLUMN "numero" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."notas_despacho_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."orden_compra_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "orden_compra_id" "uuid" NOT NULL,
    "cantidad" numeric(10,2) NOT NULL,
    "codigo_snap" "text",
    "descripcion" "text" NOT NULL,
    "unidad" "text" DEFAULT 'und'::"text" NOT NULL,
    "precio_unit_usd" numeric(12,4) NOT NULL,
    "total_usd" numeric(12,4) NOT NULL,
    "cuenta_id" "uuid",
    "orden" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "orden_compra_items_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "orden_compra_items_descripcion_check" CHECK (("char_length"(TRIM(BOTH FROM "descripcion")) > 0)),
    CONSTRAINT "orden_compra_items_precio_unit_usd_check" CHECK (("precio_unit_usd" >= (0)::numeric)),
    CONSTRAINT "orden_compra_items_total_usd_check" CHECK (("total_usd" >= (0)::numeric)),
    CONSTRAINT "orden_compra_items_unidad_check" CHECK (("char_length"(TRIM(BOTH FROM "unidad")) > 0))
);


ALTER TABLE "public"."orden_compra_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."orden_compra_items" IS 'Artículos e ítems que componen las órdenes de compra.';



CREATE TABLE IF NOT EXISTS "public"."ordenes_compra" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "numero" integer NOT NULL,
    "proveedor_nombre" "text" NOT NULL,
    "proveedor_rif" "text" NOT NULL,
    "proveedor_direccion" "text",
    "proveedor_telefono" "text",
    "proveedor_correo" "text",
    "proveedor_contacto" "text",
    "fecha_emision" timestamp with time zone DEFAULT "now"() NOT NULL,
    "condicion_pago" "text" NOT NULL,
    "subtotal_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "total_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "notas" "text",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "cuenta_id" "uuid",
    "vendedor_id" "uuid" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ordenes_compra_condicion_pago_check" CHECK (("char_length"(TRIM(BOTH FROM "condicion_pago")) > 0)),
    CONSTRAINT "ordenes_compra_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aprobada'::"text", 'anulada'::"text"]))),
    CONSTRAINT "ordenes_compra_proveedor_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "proveedor_nombre")) > 0)),
    CONSTRAINT "ordenes_compra_proveedor_rif_check" CHECK (("char_length"(TRIM(BOTH FROM "proveedor_rif")) > 0)),
    CONSTRAINT "ordenes_compra_subtotal_usd_check" CHECK (("subtotal_usd" >= (0)::numeric)),
    CONSTRAINT "ordenes_compra_total_usd_check" CHECK (("total_usd" >= (0)::numeric))
);


ALTER TABLE "public"."ordenes_compra" OWNER TO "postgres";


COMMENT ON TABLE "public"."ordenes_compra" IS 'Órdenes de compra generadas por supervisores para adquirir productos externos de proveedores.';



ALTER TABLE "public"."ordenes_compra" ALTER COLUMN "numero" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ordenes_compra_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."productos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text",
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "categoria" "text",
    "unidad" "text" DEFAULT 'und'::"text" NOT NULL,
    "precio_usd" numeric(12,4) DEFAULT 0 NOT NULL,
    "costo_usd" numeric(12,4),
    "stock_actual" numeric(10,2) DEFAULT 0 NOT NULL,
    "stock_minimo" numeric(10,2) DEFAULT 0 NOT NULL,
    "imagen_url" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "precio_2" numeric(12,4),
    "precio_3" numeric(12,4),
    "cuenta_id" "uuid",
    "precio1_porcentaje" numeric,
    "precio2_porcentaje" numeric,
    "precio3_porcentaje" numeric,
    "vector_embedding" "public"."vector"(768),
    CONSTRAINT "productos_costo_usd_check" CHECK (("costo_usd" >= (0)::numeric)),
    CONSTRAINT "productos_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) > 0)),
    CONSTRAINT "productos_precio_2_check" CHECK (("precio_2" >= (0)::numeric)),
    CONSTRAINT "productos_precio_3_check" CHECK (("precio_3" >= (0)::numeric)),
    CONSTRAINT "productos_precio_usd_check" CHECK (("precio_usd" >= (0)::numeric)),
    CONSTRAINT "productos_stock_minimo_check" CHECK (("stock_minimo" >= (0)::numeric))
);


ALTER TABLE "public"."productos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."productos"."precio_usd" IS 'Precio 1 (USD) — precio principal';



COMMENT ON COLUMN "public"."productos"."costo_usd" IS 'Costo de compra. SOLO visible para supervisores vía vista v_productos_supervisor';



COMMENT ON COLUMN "public"."productos"."precio_2" IS 'Precio 2 (USD) — opcional';



COMMENT ON COLUMN "public"."productos"."precio_3" IS 'Precio 3 (USD) — opcional';



CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid",
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "creado_en" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reasignaciones_clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "vendedor_origen" "uuid" NOT NULL,
    "vendedor_destino" "uuid" NOT NULL,
    "supervisor_id" "uuid" NOT NULL,
    "motivo" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cuenta_id" "uuid"
);


ALTER TABLE "public"."reasignaciones_clientes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."reasignaciones_clientes"."motivo" IS 'Mínimo 10 caracteres. Evita motivos como "x" o "na".';



CREATE TABLE IF NOT EXISTS "public"."seguimiento_operativo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cuenta_id" "uuid" NOT NULL,
    "cliente_id" "uuid",
    "cotizacion_id" "uuid",
    "despacho_id" "uuid",
    "usuario_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "prioridad" "text" DEFAULT 'informativa'::"text" NOT NULL,
    "fijada" boolean DEFAULT true NOT NULL,
    "titulo" "text",
    "contenido" "text" NOT NULL,
    "imagenes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "seguimiento_operativo_prioridad_check" CHECK (("prioridad" = ANY (ARRAY['pendiente'::"text", 'resuelta'::"text", 'informativa'::"text", 'urgente'::"text"]))),
    CONSTRAINT "seguimiento_operativo_tipo_check" CHECK (("tipo" = ANY (ARRAY['nota'::"text", 'incidencia'::"text", 'aclaratoria'::"text", 'seguimiento'::"text", 'evidencia'::"text", 'resolucion'::"text"])))
);


ALTER TABLE "public"."seguimiento_operativo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_log_analysis" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" "text" NOT NULL,
    "resultado" "text" NOT NULL,
    "logs_count" integer DEFAULT 0,
    "modelo" "text" DEFAULT 'llama-3.3-70b-versatile'::"text"
);


ALTER TABLE "public"."system_log_analysis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nivel" "public"."log_nivel" DEFAULT 'error'::"public"."log_nivel" NOT NULL,
    "origen" "public"."log_origen" NOT NULL,
    "categoria" "text",
    "mensaje" "text" NOT NULL,
    "stack" "text",
    "endpoint" "text",
    "usuario_id" "uuid",
    "usuario_nombre" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "resuelto" boolean DEFAULT false
);


ALTER TABLE "public"."system_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transportistas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "rif" "text",
    "telefono" "text",
    "zona_cobertura" "text",
    "tarifa_base" numeric(12,2) DEFAULT 0,
    "notas" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "creado_por" "uuid",
    "vehiculo" "text",
    "placa_chuto" "text",
    "placa_batea" "text",
    "color" "text" DEFAULT ''::"text",
    "cuenta_id" "uuid",
    "capacidad" "text",
    CONSTRAINT "transportistas_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) > 0)),
    CONSTRAINT "transportistas_tarifa_base_check" CHECK (("tarifa_base" >= (0)::numeric))
);


ALTER TABLE "public"."transportistas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "rol" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "creado_por" "uuid",
    "color" "text",
    "pin_hash" "text",
    "pin_salt" "text",
    "telefono" "text",
    "cuenta_id" "uuid",
    "telefono_secundario" "text",
    "markup_pct" numeric(5,2) DEFAULT NULL::numeric,
    "comision_pct" numeric(5,2) DEFAULT NULL::numeric,
    "comision_pct_cabilla" numeric(5,2) DEFAULT NULL::numeric,
    "es_externo" boolean DEFAULT false NOT NULL,
    CONSTRAINT "usuarios_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) > 0)),
    CONSTRAINT "usuarios_rol_check" CHECK (("rol" = ANY (ARRAY['administracion'::"text", 'supervisor'::"text", 'vendedor'::"text", 'trabajador'::"text", 'logistica'::"text", 'jefe'::"text", 'desarrollador'::"text", 'vendedor_sin_comision'::"text"])))
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


COMMENT ON TABLE "public"."usuarios" IS 'Extensión de auth.users con datos de rol y negocio';



COMMENT ON COLUMN "public"."usuarios"."creado_por" IS 'Supervisor que creó este usuario';



COMMENT ON COLUMN "public"."usuarios"."telefono" IS 'Número de teléfono del usuario';



CREATE OR REPLACE VIEW "public"."v_catalogo_publico" WITH ("security_invoker"='off') AS
 SELECT "id",
    "codigo",
    "nombre",
    "categoria",
    "descripcion",
    "unidad",
    "precio_usd",
    "stock_actual",
    "imagen_url",
    "activo"
   FROM "public"."productos"
  WHERE (("activo" = true) AND ("stock_actual" > (0)::numeric));


ALTER VIEW "public"."v_catalogo_publico" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_catalogo_publico" IS 'Catálogo público para el autocotizador web PWA. Filtra stock > 0 y omite costo_usd.';



CREATE OR REPLACE VIEW "public"."v_cotizaciones_vendedor" AS
 SELECT "id",
    "numero",
    "version",
    "cotizacion_raiz_id",
    "cliente_id",
    "vendedor_id",
    "transportista_id",
    "estado",
    "subtotal_usd",
    "descuento_global_pct",
    "descuento_usd",
    "costo_envio_usd",
    "total_usd",
    "tasa_bcv_snapshot",
    "total_bs_snapshot",
    "valida_hasta",
    "notas_cliente",
    "creado_en",
    "actualizado_en",
    "enviada_en",
    "exportada_en"
   FROM "public"."cotizaciones";


ALTER VIEW "public"."v_cotizaciones_vendedor" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_cotizaciones_vendedor" IS 'Vista sin notas_internas. Para uso exclusivo del rol vendedor.';



CREATE OR REPLACE VIEW "public"."v_productos_vendedor" AS
 SELECT "id",
    "codigo",
    "nombre",
    "descripcion",
    "categoria",
    "unidad",
    "precio_usd",
    "stock_actual",
    "stock_minimo",
    "imagen_url",
    "activo",
    "creado_en",
    "actualizado_en"
   FROM "public"."productos"
  WHERE ("activo" = true);


ALTER VIEW "public"."v_productos_vendedor" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_productos_vendedor" IS 'Vista sin costo_usd. Para uso exclusivo del rol vendedor.';



ALTER TABLE ONLY "public"."auditoria"
    ADD CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cliente_prestamos"
    ADD CONSTRAINT "cliente_prestamos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comisiones"
    ADD CONSTRAINT "comisiones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_negocio"
    ADD CONSTRAINT "configuracion_negocio_cuenta_id_key" UNIQUE ("cuenta_id");



ALTER TABLE ONLY "public"."configuracion_negocio"
    ADD CONSTRAINT "configuracion_negocio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cotizacion_items"
    ADD CONSTRAINT "cotizacion_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuentas_por_cobrar"
    ADD CONSTRAINT "cuentas_por_cobrar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."despacho_descuentos"
    ADD CONSTRAINT "despacho_descuentos_despacho_id_cotizacion_item_id_key" UNIQUE ("despacho_id", "cotizacion_item_id");



ALTER TABLE ONLY "public"."despacho_descuentos"
    ADD CONSTRAINT "despacho_descuentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventario_movimientos"
    ADD CONSTRAINT "inventario_movimientos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_cotizacion_id_key" UNIQUE ("cotizacion_id");



ALTER TABLE ONLY "public"."notas_despacho_items"
    ADD CONSTRAINT "notas_despacho_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orden_compra_items"
    ADD CONSTRAINT "orden_compra_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reasignaciones_clientes"
    ADD CONSTRAINT "reasignaciones_clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seguimiento_operativo"
    ADD CONSTRAINT "seguimiento_operativo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_log_analysis"
    ADD CONSTRAINT "system_log_analysis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transportistas"
    ADD CONSTRAINT "transportistas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cliente_prestamos"
    ADD CONSTRAINT "uq_cliente_prestamos_item" UNIQUE ("despacho_item_id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "uq_clientes_codigo_cliente" UNIQUE ("codigo_cliente");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_auditoria_categoria" ON "public"."auditoria" USING "btree" ("categoria");



CREATE INDEX "idx_auditoria_entidad" ON "public"."auditoria" USING "btree" ("entidad_tipo", "entidad_id") WHERE ("entidad_id" IS NOT NULL);



CREATE INDEX "idx_auditoria_ts" ON "public"."auditoria" USING "btree" ("ts" DESC);



CREATE INDEX "idx_auditoria_usuario" ON "public"."auditoria" USING "btree" ("usuario_id");



CREATE INDEX "idx_clientes_activo" ON "public"."clientes" USING "btree" ("activo") WHERE ("activo" = true);



CREATE INDEX "idx_clientes_cuenta_id" ON "public"."clientes" USING "btree" ("cuenta_id");



CREATE UNIQUE INDEX "idx_clientes_rif_cuenta_unico" ON "public"."clientes" USING "btree" ("cuenta_id", "rif_cedula") WHERE (("rif_cedula" IS NOT NULL) AND (TRIM(BOTH FROM "rif_cedula") <> ''::"text"));



CREATE INDEX "idx_clientes_vendedor" ON "public"."clientes" USING "btree" ("vendedor_id");



CREATE INDEX "idx_cotizacion_items_cuenta_id" ON "public"."cotizacion_items" USING "btree" ("cuenta_id");



CREATE INDEX "idx_cotizacion_items_producto" ON "public"."cotizacion_items" USING "btree" ("producto_id");



CREATE INDEX "idx_cotizaciones_canal" ON "public"."cotizaciones" USING "btree" ("canal_venta");



CREATE INDEX "idx_cotizaciones_cliente" ON "public"."cotizaciones" USING "btree" ("cliente_id");



CREATE INDEX "idx_cotizaciones_cuenta_id" ON "public"."cotizaciones" USING "btree" ("cuenta_id");



CREATE INDEX "idx_cotizaciones_estado" ON "public"."cotizaciones" USING "btree" ("estado");



CREATE INDEX "idx_cotizaciones_numero" ON "public"."cotizaciones" USING "btree" ("numero" DESC);



CREATE INDEX "idx_cotizaciones_raiz" ON "public"."cotizaciones" USING "btree" ("cotizacion_raiz_id") WHERE ("cotizacion_raiz_id" IS NOT NULL);



CREATE INDEX "idx_cotizaciones_vendedor" ON "public"."cotizaciones" USING "btree" ("vendedor_id");



CREATE INDEX "idx_cuentas_por_cobrar_cuenta_id" ON "public"."cuentas_por_cobrar" USING "btree" ("cuenta_id");



CREATE INDEX "idx_cxc_cliente" ON "public"."cuentas_por_cobrar" USING "btree" ("cliente_id");



CREATE INDEX "idx_cxc_despacho" ON "public"."cuentas_por_cobrar" USING "btree" ("despacho_id");



CREATE INDEX "idx_cxc_fecha" ON "public"."cuentas_por_cobrar" USING "btree" ("creado_en" DESC);



CREATE INDEX "idx_cxc_metodo_pago" ON "public"."cuentas_por_cobrar" USING "btree" ("metodo_pago");



CREATE INDEX "idx_cxc_tipo" ON "public"."cuentas_por_cobrar" USING "btree" ("tipo");



CREATE INDEX "idx_despacho_descuentos_despacho" ON "public"."despacho_descuentos" USING "btree" ("despacho_id");



CREATE INDEX "idx_despachos_estado" ON "public"."notas_despacho" USING "btree" ("estado");



CREATE INDEX "idx_despachos_numero" ON "public"."notas_despacho" USING "btree" ("numero" DESC);



CREATE INDEX "idx_despachos_vendedor" ON "public"."notas_despacho" USING "btree" ("vendedor_id");



CREATE INDEX "idx_inventario_movimientos_cuenta_id" ON "public"."inventario_movimientos" USING "btree" ("cuenta_id");



CREATE INDEX "idx_items_cotizacion" ON "public"."cotizacion_items" USING "btree" ("cotizacion_id");



CREATE INDEX "idx_logs_cat" ON "public"."system_logs" USING "btree" ("categoria");



CREATE INDEX "idx_logs_nivel" ON "public"."system_logs" USING "btree" ("nivel");



CREATE INDEX "idx_logs_origen" ON "public"."system_logs" USING "btree" ("origen");



CREATE INDEX "idx_logs_ts" ON "public"."system_logs" USING "btree" ("ts" DESC);



CREATE INDEX "idx_mov_creado" ON "public"."inventario_movimientos" USING "btree" ("creado_en" DESC);



CREATE INDEX "idx_mov_lote" ON "public"."inventario_movimientos" USING "btree" ("lote_id");



CREATE INDEX "idx_mov_numero" ON "public"."inventario_movimientos" USING "btree" ("numero" DESC);



CREATE INDEX "idx_mov_producto" ON "public"."inventario_movimientos" USING "btree" ("producto_id");



CREATE INDEX "idx_mov_tipo" ON "public"."inventario_movimientos" USING "btree" ("tipo");



CREATE INDEX "idx_nd_items_despacho" ON "public"."notas_despacho_items" USING "btree" ("despacho_id");



CREATE INDEX "idx_nd_items_producto" ON "public"."notas_despacho_items" USING "btree" ("producto_id");



CREATE INDEX "idx_notas_despacho_cliente" ON "public"."notas_despacho" USING "btree" ("cliente_id");



CREATE INDEX "idx_notas_despacho_cuenta_id" ON "public"."notas_despacho" USING "btree" ("cuenta_id");



CREATE INDEX "idx_orden_compra_items_orden" ON "public"."orden_compra_items" USING "btree" ("orden_compra_id");



CREATE INDEX "idx_ordenes_compra_estado" ON "public"."ordenes_compra" USING "btree" ("estado");



CREATE INDEX "idx_ordenes_compra_numero" ON "public"."ordenes_compra" USING "btree" ("numero" DESC);



CREATE INDEX "idx_ordenes_compra_vendedor" ON "public"."ordenes_compra" USING "btree" ("vendedor_id");



CREATE INDEX "idx_productos_activo" ON "public"."productos" USING "btree" ("activo") WHERE ("activo" = true);



CREATE INDEX "idx_productos_categoria" ON "public"."productos" USING "btree" ("categoria");



CREATE UNIQUE INDEX "idx_productos_codigo_cuenta_unico" ON "public"."productos" USING "btree" ("cuenta_id", "codigo") WHERE (("codigo" IS NOT NULL) AND (TRIM(BOTH FROM "codigo") <> ''::"text"));



CREATE INDEX "idx_productos_cuenta_id" ON "public"."productos" USING "btree" ("cuenta_id");



CREATE INDEX "idx_productos_nombre_fts" ON "public"."productos" USING "gin" ("to_tsvector"('"spanish"'::"regconfig", "nombre"));



CREATE INDEX "idx_reasig_cliente" ON "public"."reasignaciones_clientes" USING "btree" ("cliente_id");



CREATE INDEX "idx_reasig_supervisor" ON "public"."reasignaciones_clientes" USING "btree" ("supervisor_id");



CREATE INDEX "idx_seguimiento_cliente" ON "public"."seguimiento_operativo" USING "btree" ("cliente_id") WHERE ("cliente_id" IS NOT NULL);



CREATE INDEX "idx_seguimiento_cotizacion" ON "public"."seguimiento_operativo" USING "btree" ("cotizacion_id") WHERE ("cotizacion_id" IS NOT NULL);



CREATE INDEX "idx_seguimiento_creado" ON "public"."seguimiento_operativo" USING "btree" ("fijada" DESC, "creado_en" DESC);



CREATE INDEX "idx_seguimiento_cuenta" ON "public"."seguimiento_operativo" USING "btree" ("cuenta_id");



CREATE INDEX "idx_seguimiento_despacho" ON "public"."seguimiento_operativo" USING "btree" ("despacho_id") WHERE ("despacho_id" IS NOT NULL);



CREATE INDEX "idx_transportistas_cuenta_id" ON "public"."transportistas" USING "btree" ("cuenta_id");



CREATE INDEX "idx_usuarios_cuenta_id" ON "public"."usuarios" USING "btree" ("cuenta_id");



CREATE INDEX "idx_usuarios_es_externo" ON "public"."usuarios" USING "btree" ("es_externo");



CREATE INDEX "idx_usuarios_markup" ON "public"."usuarios" USING "btree" ("markup_pct") WHERE ("markup_pct" IS NOT NULL);



CREATE INDEX "productos_vector_idx" ON "public"."productos" USING "hnsw" ("vector_embedding" "public"."vector_cosine_ops");



CREATE UNIQUE INDEX "uq_cotizacion_raiz_version" ON "public"."cotizaciones" USING "btree" ("cotizacion_raiz_id", "version") WHERE ("cotizacion_raiz_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_check_seguimiento_update" BEFORE UPDATE ON "public"."seguimiento_operativo" FOR EACH ROW EXECUTE FUNCTION "public"."check_seguimiento_update"();



CREATE OR REPLACE TRIGGER "trg_clientes_auto_codigo" BEFORE INSERT ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."trg_clientes_generar_codigo"();



CREATE OR REPLACE TRIGGER "trg_clientes_updated" BEFORE UPDATE ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_config_updated" BEFORE UPDATE ON "public"."configuracion_negocio" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cotizacion_validar_cliente" BEFORE INSERT ON "public"."cotizaciones" FOR EACH ROW EXECUTE FUNCTION "public"."validar_cliente_para_cotizar"();



CREATE OR REPLACE TRIGGER "trg_cotizaciones_estado" BEFORE UPDATE OF "estado" ON "public"."cotizaciones" FOR EACH ROW EXECUTE FUNCTION "public"."validar_transicion_estado"();



CREATE OR REPLACE TRIGGER "trg_cotizaciones_updated" BEFORE UPDATE ON "public"."cotizaciones" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_crear_config_usuario" AFTER INSERT ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."crear_configuracion_por_defecto"();



CREATE OR REPLACE TRIGGER "trg_despacho_copiar_numero" BEFORE INSERT ON "public"."notas_despacho" FOR EACH ROW EXECUTE FUNCTION "public"."trg_despacho_copiar_numero"();



CREATE OR REPLACE TRIGGER "trg_despachos_updated" BEFORE UPDATE ON "public"."notas_despacho" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_liberar_comision_pago" AFTER INSERT OR UPDATE ON "public"."cuentas_por_cobrar" FOR EACH ROW EXECUTE FUNCTION "public"."trg_liberar_comision_por_pago"();



CREATE OR REPLACE TRIGGER "trg_liberar_comision_pago_delete" AFTER DELETE ON "public"."cuentas_por_cobrar" FOR EACH ROW EXECUTE FUNCTION "public"."trg_liberar_comision_por_pago"();



CREATE OR REPLACE TRIGGER "trg_ordenes_compra_updated" BEFORE UPDATE ON "public"."ordenes_compra" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_productos_updated" BEFORE UPDATE ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_seguimiento_updated" BEFORE UPDATE ON "public"."seguimiento_operativo" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_auditoria" BEFORE INSERT ON "public"."auditoria" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_clientes" BEFORE INSERT ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_configuracion_negocio" BEFORE INSERT ON "public"."configuracion_negocio" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_cotizacion_items" BEFORE INSERT ON "public"."cotizacion_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_cotizaciones" BEFORE INSERT ON "public"."cotizaciones" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_cuentas_por_cobrar" BEFORE INSERT ON "public"."cuentas_por_cobrar" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_despacho_descuentos" BEFORE INSERT ON "public"."despacho_descuentos" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_inventario_movimientos" BEFORE INSERT ON "public"."inventario_movimientos" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_notas_despacho" BEFORE INSERT ON "public"."notas_despacho" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_notas_despacho_items" BEFORE INSERT ON "public"."notas_despacho_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_orden_compra_items" BEFORE INSERT ON "public"."orden_compra_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_purchase_orders"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_ordenes_compra" BEFORE INSERT ON "public"."ordenes_compra" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_purchase_orders"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_productos" BEFORE INSERT ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_reasignaciones_clientes" BEFORE INSERT ON "public"."reasignaciones_clientes" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_seguimiento" BEFORE INSERT ON "public"."seguimiento_operativo" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_transportistas" BEFORE INSERT ON "public"."transportistas" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_set_cuenta_id_usuarios" BEFORE INSERT ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."set_cuenta_id_smart"();



CREATE OR REPLACE TRIGGER "trg_sincronizar_prestamos_despacho" AFTER UPDATE OF "estado" ON "public"."notas_despacho" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sincronizar_prestamos_cabecera"();



CREATE OR REPLACE TRIGGER "trg_sincronizar_prestamos_items" AFTER INSERT OR DELETE OR UPDATE ON "public"."notas_despacho_items" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sincronizar_prestamos_despacho"();



CREATE OR REPLACE TRIGGER "trg_sync_saldo_pendiente" AFTER INSERT OR UPDATE ON "public"."cuentas_por_cobrar" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalcular_saldo_pendiente"();



CREATE OR REPLACE TRIGGER "trg_sync_saldo_pendiente_delete" AFTER DELETE ON "public"."cuentas_por_cobrar" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalcular_saldo_pendiente_delete"();



CREATE OR REPLACE TRIGGER "trg_transportistas_updated" BEFORE UPDATE ON "public"."transportistas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_usuarios_updated" BEFORE UPDATE ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."auditoria"
    ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cliente_prestamos"
    ADD CONSTRAINT "cliente_prestamos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_prestamos"
    ADD CONSTRAINT "cliente_prestamos_despacho_id_fkey" FOREIGN KEY ("despacho_id") REFERENCES "public"."notas_despacho"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_prestamos"
    ADD CONSTRAINT "cliente_prestamos_despacho_item_id_fkey" FOREIGN KEY ("despacho_item_id") REFERENCES "public"."notas_despacho_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_prestamos"
    ADD CONSTRAINT "cliente_prestamos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_ultima_reasig_por_fkey" FOREIGN KEY ("ultima_reasig_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."comisiones"
    ADD CONSTRAINT "comisiones_cotizacionid_fkey" FOREIGN KEY ("cotizacionid") REFERENCES "public"."cotizaciones"("id");



ALTER TABLE ONLY "public"."comisiones"
    ADD CONSTRAINT "comisiones_despachoid_fkey" FOREIGN KEY ("despachoid") REFERENCES "public"."notas_despacho"("id");



ALTER TABLE ONLY "public"."comisiones"
    ADD CONSTRAINT "comisiones_vendedorid_fkey" FOREIGN KEY ("vendedorid") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."cotizacion_items"
    ADD CONSTRAINT "cotizacion_items_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cotizacion_items"
    ADD CONSTRAINT "cotizacion_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_cotizacion_raiz_id_fkey" FOREIGN KEY ("cotizacion_raiz_id") REFERENCES "public"."cotizaciones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_transportista_id_fkey" FOREIGN KEY ("transportista_id") REFERENCES "public"."transportistas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cuentas_por_cobrar"
    ADD CONSTRAINT "cuentas_por_cobrar_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cuentas_por_cobrar"
    ADD CONSTRAINT "cuentas_por_cobrar_despacho_id_fkey" FOREIGN KEY ("despacho_id") REFERENCES "public"."notas_despacho"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cuentas_por_cobrar"
    ADD CONSTRAINT "cuentas_por_cobrar_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."despacho_descuentos"
    ADD CONSTRAINT "despacho_descuentos_aplicado_por_fkey" FOREIGN KEY ("aplicado_por") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."despacho_descuentos"
    ADD CONSTRAINT "despacho_descuentos_cotizacion_item_id_fkey" FOREIGN KEY ("cotizacion_item_id") REFERENCES "public"."cotizacion_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."despacho_descuentos"
    ADD CONSTRAINT "despacho_descuentos_despacho_id_fkey" FOREIGN KEY ("despacho_id") REFERENCES "public"."notas_despacho"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."despacho_descuentos"
    ADD CONSTRAINT "despacho_descuentos_despacho_item_id_fkey" FOREIGN KEY ("despacho_item_id") REFERENCES "public"."notas_despacho_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventario_movimientos"
    ADD CONSTRAINT "inventario_movimientos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventario_movimientos"
    ADD CONSTRAINT "inventario_movimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_cliente_factura_id_fkey" FOREIGN KEY ("cliente_factura_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notas_despacho_items"
    ADD CONSTRAINT "notas_despacho_items_despacho_id_fkey" FOREIGN KEY ("despacho_id") REFERENCES "public"."notas_despacho"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notas_despacho_items"
    ADD CONSTRAINT "notas_despacho_items_editado_por_fkey" FOREIGN KEY ("editado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notas_despacho_items"
    ADD CONSTRAINT "notas_despacho_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_transportista_id_fkey" FOREIGN KEY ("transportista_id") REFERENCES "public"."transportistas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notas_despacho"
    ADD CONSTRAINT "notas_despacho_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orden_compra_items"
    ADD CONSTRAINT "orden_compra_items_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reasignaciones_clientes"
    ADD CONSTRAINT "reasignaciones_clientes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reasignaciones_clientes"
    ADD CONSTRAINT "reasignaciones_clientes_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reasignaciones_clientes"
    ADD CONSTRAINT "reasignaciones_clientes_vendedor_destino_fkey" FOREIGN KEY ("vendedor_destino") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reasignaciones_clientes"
    ADD CONSTRAINT "reasignaciones_clientes_vendedor_origen_fkey" FOREIGN KEY ("vendedor_origen") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."seguimiento_operativo"
    ADD CONSTRAINT "seguimiento_operativo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seguimiento_operativo"
    ADD CONSTRAINT "seguimiento_operativo_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seguimiento_operativo"
    ADD CONSTRAINT "seguimiento_operativo_despacho_id_fkey" FOREIGN KEY ("despacho_id") REFERENCES "public"."notas_despacho"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seguimiento_operativo"
    ADD CONSTRAINT "seguimiento_operativo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transportistas"
    ADD CONSTRAINT "transportistas_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL;



CREATE POLICY "Permitir todo a operadores autorizados en cliente_prestamos" ON "public"."cliente_prestamos" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "analysis_no_delete" ON "public"."system_log_analysis" FOR DELETE USING (false);



CREATE POLICY "analysis_supervisor_select" ON "public"."system_log_analysis" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



ALTER TABLE "public"."auditoria" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auditoria_admin_select" ON "public"."auditoria" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "auditoria_insert" ON "public"."auditoria" FOR INSERT WITH CHECK (("usuario_id" = "public"."get_operador_id"()));



CREATE POLICY "auditoria_jefe_all" ON "public"."auditoria" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "auditoria_supervisor_select" ON "public"."auditoria" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



ALTER TABLE "public"."cliente_prestamos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_admin_select" ON "public"."clientes" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "clientes_jefe_all" ON "public"."clientes" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "clientes_logistica_select" ON "public"."clientes" FOR SELECT USING (("public"."get_rol_actual"() = 'logistica'::"text"));



CREATE POLICY "clientes_supervisor_insert" ON "public"."clientes" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "clientes_supervisor_select" ON "public"."clientes" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "clientes_supervisor_update" ON "public"."clientes" FOR UPDATE USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "clientes_vendedor_insert" ON "public"."clientes" FOR INSERT WITH CHECK ((("vendedor_id" = "public"."get_operador_id"()) AND ("public"."get_rol_actual"() = 'vendedor'::"text")));



CREATE POLICY "clientes_vendedor_select" ON "public"."clientes" FOR SELECT USING ((("vendedor_id" = "public"."get_operador_id"()) AND ("activo" = true)));



CREATE POLICY "clientes_vendedor_update" ON "public"."clientes" FOR UPDATE USING ((("vendedor_id" = "public"."get_operador_id"()) AND ("public"."get_rol_actual"() = 'vendedor'::"text"))) WITH CHECK (("vendedor_id" = "public"."get_operador_id"()));



ALTER TABLE "public"."comisiones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "config_admin_select" ON "public"."configuracion_negocio" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "config_autenticados_leen" ON "public"."configuracion_negocio" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "config_supervisor_update" ON "public"."configuracion_negocio" FOR UPDATE USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "configuracion_jefe_all" ON "public"."configuracion_negocio" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



ALTER TABLE "public"."configuracion_negocio" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cotizacion_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cotizacion_items_admin_select" ON "public"."cotizacion_items" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "cotizacion_items_jefe_all" ON "public"."cotizacion_items" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



ALTER TABLE "public"."cotizaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cotizaciones_admin_select" ON "public"."cotizaciones" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "cotizaciones_jefe_all" ON "public"."cotizaciones" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "cotizaciones_logistica_select" ON "public"."cotizaciones" FOR SELECT USING ((("public"."get_rol_actual"() = 'logistica'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."notas_despacho" "nd"
  WHERE ("nd"."cotizacion_id" = "cotizaciones"."id")))));



CREATE POLICY "cotizaciones_supervisor_insert" ON "public"."cotizaciones" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "cotizaciones_supervisor_select" ON "public"."cotizaciones" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "cotizaciones_supervisor_update" ON "public"."cotizaciones" FOR UPDATE USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "cotizaciones_vendedor_insert" ON "public"."cotizaciones" FOR INSERT WITH CHECK ((("vendedor_id" = "public"."get_operador_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."clientes"
  WHERE (("clientes"."id" = "cotizaciones"."cliente_id") AND ("clientes"."vendedor_id" = "public"."get_operador_id"()))))));



CREATE POLICY "cotizaciones_vendedor_select" ON "public"."cotizaciones" FOR SELECT USING (("vendedor_id" = "public"."get_operador_id"()));



CREATE POLICY "cotizaciones_vendedor_update" ON "public"."cotizaciones" FOR UPDATE USING ((("vendedor_id" = "public"."get_operador_id"()) AND ("estado" = ANY (ARRAY['borrador'::"public"."estado_cotizacion", 'enviada'::"public"."estado_cotizacion"])))) WITH CHECK ((("vendedor_id" = "public"."get_operador_id"()) AND ("estado" = ANY (ARRAY['borrador'::"public"."estado_cotizacion", 'enviada'::"public"."estado_cotizacion", 'anulada'::"public"."estado_cotizacion"]))));



CREATE POLICY "cuentas_cobrar_admin_select" ON "public"."cuentas_por_cobrar" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



ALTER TABLE "public"."cuentas_por_cobrar" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cuentas_por_cobrar_jefe_all" ON "public"."cuentas_por_cobrar" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "cxc_supervisor_all" ON "public"."cuentas_por_cobrar" USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "cxc_vendedor_select" ON "public"."cuentas_por_cobrar" FOR SELECT USING (("cliente_id" IN ( SELECT "clientes"."id"
   FROM "public"."clientes"
  WHERE ("clientes"."vendedor_id" = "public"."get_operador_id"()))));



CREATE POLICY "descuentos_admin_select" ON "public"."despacho_descuentos" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "descuentos_logistica_all" ON "public"."despacho_descuentos" USING (("public"."get_rol_actual"() = 'logistica'::"text"));



CREATE POLICY "descuentos_supervisor_all" ON "public"."despacho_descuentos" USING (("public"."get_rol_actual"() = ANY (ARRAY['supervisor'::"text", 'desarrollador'::"text"])));



CREATE POLICY "descuentos_vendedor_select" ON "public"."despacho_descuentos" FOR SELECT USING ((("public"."get_rol_actual"() = 'vendedor'::"text") AND ("despacho_id" IN ( SELECT "notas_despacho"."id"
   FROM "public"."notas_despacho"
  WHERE ("notas_despacho"."vendedor_id" = "auth"."uid"())))));



ALTER TABLE "public"."despacho_descuentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "despachos_admin_select" ON "public"."notas_despacho" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "despachos_logistica_select" ON "public"."notas_despacho" FOR SELECT USING (("public"."get_rol_actual"() = 'logistica'::"text"));



CREATE POLICY "despachos_supervisor_select" ON "public"."notas_despacho" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "despachos_supervisor_update" ON "public"."notas_despacho" FOR UPDATE USING (("public"."get_rol_actual"() = 'supervisor'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "despachos_vendedor_select" ON "public"."notas_despacho" FOR SELECT USING (("vendedor_id" = "public"."get_operador_id"()));



ALTER TABLE "public"."inventario_movimientos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inventario_movimientos_jefe_all" ON "public"."inventario_movimientos" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "isolation_auditoria" ON "public"."auditoria" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_cliente_prestamos" ON "public"."cliente_prestamos" AS RESTRICTIVE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "cliente_prestamos"."cliente_id") AND ("c"."cuenta_id" = "auth"."uid"())))));



CREATE POLICY "isolation_clientes" ON "public"."clientes" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_configuracion_negocio" ON "public"."configuracion_negocio" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_cotizacion_items" ON "public"."cotizacion_items" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_cotizaciones" ON "public"."cotizaciones" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_cuentas_por_cobrar" ON "public"."cuentas_por_cobrar" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_despacho_descuentos" ON "public"."despacho_descuentos" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_inventario_movimientos" ON "public"."inventario_movimientos" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_notas_despacho" ON "public"."notas_despacho" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_notas_despacho_items" ON "public"."notas_despacho_items" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_orden_compra_items" ON "public"."orden_compra_items" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_ordenes_compra" ON "public"."ordenes_compra" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_productos" ON "public"."productos" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_reasignaciones_clientes" ON "public"."reasignaciones_clientes" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_seguimiento_operativo" ON "public"."seguimiento_operativo" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_transportistas" ON "public"."transportistas" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "isolation_usuarios" ON "public"."usuarios" AS RESTRICTIVE USING (("cuenta_id" = "auth"."uid"()));



CREATE POLICY "items_logistica_select" ON "public"."cotizacion_items" FOR SELECT USING ((("public"."get_rol_actual"() = 'logistica'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."notas_despacho" "nd"
  WHERE ("nd"."cotizacion_id" = "cotizacion_items"."cotizacion_id")))));



CREATE POLICY "items_supervisor_delete" ON "public"."cotizacion_items" FOR DELETE USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "items_supervisor_insert" ON "public"."cotizacion_items" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "items_supervisor_select" ON "public"."cotizacion_items" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "items_supervisor_update" ON "public"."cotizacion_items" FOR UPDATE USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "items_vendedor_delete" ON "public"."cotizacion_items" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "cotizacion_items"."cotizacion_id") AND ("c"."vendedor_id" = "public"."get_operador_id"()) AND ("c"."estado" = 'borrador'::"public"."estado_cotizacion")))));



CREATE POLICY "items_vendedor_insert" ON "public"."cotizacion_items" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "cotizacion_items"."cotizacion_id") AND ("c"."vendedor_id" = "public"."get_operador_id"()) AND ("c"."estado" = 'borrador'::"public"."estado_cotizacion")))));



CREATE POLICY "items_vendedor_select" ON "public"."cotizacion_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "cotizacion_items"."cotizacion_id") AND ("c"."vendedor_id" = "public"."get_operador_id"())))));



CREATE POLICY "items_vendedor_update" ON "public"."cotizacion_items" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "cotizacion_items"."cotizacion_id") AND ("c"."vendedor_id" = "public"."get_operador_id"()) AND ("c"."estado" = 'borrador'::"public"."estado_cotizacion")))));



CREATE POLICY "logs_no_delete" ON "public"."system_logs" FOR DELETE USING (false);



CREATE POLICY "logs_supervisor_select" ON "public"."system_logs" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "movimientos_admin_insert" ON "public"."inventario_movimientos" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "movimientos_admin_select" ON "public"."inventario_movimientos" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "movimientos_supervisor_insert" ON "public"."inventario_movimientos" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "movimientos_supervisor_select" ON "public"."inventario_movimientos" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "nd_items_admin" ON "public"."notas_despacho_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."cuenta_id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['supervisor'::"text", 'administracion'::"text", 'desarrollador'::"text"])) AND ("usuarios"."activo" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."cuenta_id" = "auth"."uid"()) AND ("usuarios"."rol" = ANY (ARRAY['supervisor'::"text", 'administracion'::"text", 'desarrollador'::"text"])) AND ("usuarios"."activo" = true)))));



CREATE POLICY "nd_items_vendedor_read" ON "public"."notas_despacho_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios"
  WHERE (("usuarios"."cuenta_id" = "auth"."uid"()) AND ("usuarios"."activo" = true)))));



ALTER TABLE "public"."notas_despacho" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notas_despacho_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notas_despacho_jefe_all" ON "public"."notas_despacho" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



ALTER TABLE "public"."orden_compra_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orden_compra_items_rol_all" ON "public"."orden_compra_items" USING (("public"."get_rol_actual"() = ANY (ARRAY['supervisor'::"text", 'jefe'::"text", 'desarrollador'::"text"]))) WITH CHECK (("public"."get_rol_actual"() = ANY (ARRAY['supervisor'::"text", 'jefe'::"text", 'desarrollador'::"text"])));



ALTER TABLE "public"."ordenes_compra" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ordenes_compra_rol_all" ON "public"."ordenes_compra" USING (("public"."get_rol_actual"() = ANY (ARRAY['supervisor'::"text", 'jefe'::"text", 'desarrollador'::"text"]))) WITH CHECK (("public"."get_rol_actual"() = ANY (ARRAY['supervisor'::"text", 'jefe'::"text", 'desarrollador'::"text"])));



CREATE POLICY "own_push" ON "public"."push_subscriptions" USING (("usuario_id" = "auth"."uid"()));



ALTER TABLE "public"."productos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "productos_admin_delete" ON "public"."productos" FOR DELETE USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "productos_admin_insert" ON "public"."productos" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "productos_admin_select" ON "public"."productos" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "productos_admin_update" ON "public"."productos" FOR UPDATE USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "productos_jefe_all" ON "public"."productos" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "productos_supervisor_select" ON "public"."productos" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reasig_supervisor_select" ON "public"."reasignaciones_clientes" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "reasignaciones_admin_select" ON "public"."reasignaciones_clientes" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



ALTER TABLE "public"."reasignaciones_clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reasignaciones_jefe_all" ON "public"."reasignaciones_clientes" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "seguimiento_delete" ON "public"."seguimiento_operativo" FOR DELETE USING (("usuario_id" = "auth"."uid"()));



CREATE POLICY "seguimiento_insert" ON "public"."seguimiento_operativo" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."seguimiento_operativo" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seguimiento_select" ON "public"."seguimiento_operativo" FOR SELECT USING (true);



CREATE POLICY "seguimiento_update" ON "public"."seguimiento_operativo" FOR UPDATE USING ((("usuario_id" = "auth"."uid"()) OR ("public"."get_rol_actual"() = ANY (ARRAY['supervisor'::"text", 'administracion'::"text", 'jefe'::"text", 'desarrollador'::"text"]))));



CREATE POLICY "supervisor_push" ON "public"."push_subscriptions" USING (("usuario_id" = "auth"."uid"()));



ALTER TABLE "public"."system_log_analysis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transportistas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transportistas_admin_select" ON "public"."transportistas" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "transportistas_jefe_all" ON "public"."transportistas" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "transportistas_logistica_select" ON "public"."transportistas" FOR SELECT USING (("public"."get_rol_actual"() = 'logistica'::"text"));



CREATE POLICY "transportistas_supervisor_todos" ON "public"."transportistas" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "transportistas_supervisor_update" ON "public"."transportistas" FOR UPDATE USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "transportistas_supervisor_write" ON "public"."transportistas" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "transportistas_todos_leen" ON "public"."transportistas" FOR SELECT USING (("activo" = true));



CREATE POLICY "transportistas_vendedor_update" ON "public"."transportistas" FOR UPDATE USING (("public"."get_rol_actual"() = 'vendedor'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'vendedor'::"text"));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_admin_select" ON "public"."usuarios" FOR SELECT USING (("public"."get_rol_actual"() = 'administracion'::"text"));



CREATE POLICY "usuarios_jefe_all" ON "public"."usuarios" USING (("public"."get_rol_actual"() = 'jefe'::"text")) WITH CHECK (("public"."get_rol_actual"() = 'jefe'::"text"));



CREATE POLICY "usuarios_logistica_select" ON "public"."usuarios" FOR SELECT USING (("public"."get_rol_actual"() = 'logistica'::"text"));



CREATE POLICY "usuarios_supervisor_insert" ON "public"."usuarios" FOR INSERT WITH CHECK (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "usuarios_supervisor_select" ON "public"."usuarios" FOR SELECT USING (("public"."get_rol_actual"() = 'supervisor'::"text"));



CREATE POLICY "usuarios_supervisor_update" ON "public"."usuarios" FOR UPDATE USING (("public"."get_rol_actual"() = 'supervisor'::"text")) WITH CHECK ((NOT (("id" = "public"."get_operador_id"()) AND ("rol" <> 'supervisor'::"text"))));



CREATE POLICY "usuarios_ver_propio" ON "public"."usuarios" FOR SELECT USING (("id" = "public"."get_operador_id"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."clientes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."cotizaciones";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notas_despacho";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orden_compra_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."ordenes_compra";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."productos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."seguimiento_operativo";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."actualizar_estado_despacho"("p_despacho_id" "uuid", "p_nuevo_estado" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_estado_despacho"("p_despacho_id" "uuid", "p_nuevo_estado" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_estado_despacho"("p_despacho_id" "uuid", "p_nuevo_estado" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_producto_con_kardex"("p_id" "uuid", "p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."anular_despacho_atomico"("p_despacho_id" "uuid", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_color" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."anular_despacho_atomico"("p_despacho_id" "uuid", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_color" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."anular_despacho_atomico"("p_despacho_id" "uuid", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_color" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."aplicar_movimiento_lote"("p_tipo" "public"."tipo_movimiento", "p_motivo" "text", "p_motivo_tipo" "public"."motivo_movimiento", "p_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."aplicar_movimiento_lote"("p_tipo" "public"."tipo_movimiento", "p_motivo" "text", "p_motivo_tipo" "public"."motivo_movimiento", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."aplicar_movimiento_lote"("p_tipo" "public"."tipo_movimiento", "p_motivo" "text", "p_motivo_tipo" "public"."motivo_movimiento", "p_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."borrar_producto_con_kardex"("p_producto_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."borrar_producto_con_kardex"("p_producto_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."borrar_producto_con_kardex"("p_producto_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."buscar_productos_hibrido"("p_busqueda" "text", "p_embedding" "public"."vector", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."buscar_productos_hibrido"("p_busqueda" "text", "p_embedding" "public"."vector", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."buscar_productos_hibrido"("p_busqueda" "text", "p_embedding" "public"."vector", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calcular_comision_despacho"("p_despacho_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calcular_comision_despacho"("p_despacho_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calcular_comision_despacho"("p_despacho_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calcularcomisiondespacho"("p_despachoid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calcularcomisiondespacho"("p_despachoid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calcularcomisiondespacho"("p_despachoid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_seguimiento_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_seguimiento_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_seguimiento_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_configuracion_por_defecto"() TO "anon";
GRANT ALL ON FUNCTION "public"."crear_configuracion_por_defecto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_configuracion_por_defecto"() TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_nota_despacho"("p_cotizacion_id" "uuid", "p_notas" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_nota_despacho"("p_cotizacion_id" "uuid", "p_notas" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_nota_despacho"("p_cotizacion_id" "uuid", "p_notas" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_producto_con_kardex"("p_codigo" "text", "p_nombre" "text", "p_descripcion" "text", "p_categoria" "text", "p_unidad" "text", "p_precio_usd" numeric, "p_costo_usd" numeric, "p_stock_actual" numeric, "p_stock_minimo" numeric, "p_imagen_url" "text", "p_precio_2" numeric, "p_precio_3" numeric, "p_precio1_porcentaje" numeric, "p_precio2_porcentaje" numeric, "p_precio3_porcentaje" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_version_cotizacion"("p_cotizacion_id" "uuid", "p_notas_cambio" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_version_cotizacion"("p_cotizacion_id" "uuid", "p_notas_cambio" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_version_cotizacion"("p_cotizacion_id" "uuid", "p_notas_cambio" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."debug_comision_mixto"() TO "anon";
GRANT ALL ON FUNCTION "public"."debug_comision_mixto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."debug_comision_mixto"() TO "service_role";



GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_forma_pago" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_forma_pago" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."editar_despacho_profundidad"("p_despacho_id" "uuid", "p_nuevos_items" "jsonb", "p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_forma_pago" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enviar_cotizacion"("p_cotizacion_id" "uuid", "p_tasa_bcv" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."enviar_cotizacion"("p_cotizacion_id" "uuid", "p_tasa_bcv" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enviar_cotizacion"("p_cotizacion_id" "uuid", "p_tasa_bcv" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."factory_reset_operacional"("p_cuenta_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."factory_reset_operacional"("p_cuenta_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."factory_reset_operacional"("p_cuenta_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."factory_reset_operacional"("p_cuenta_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generar_codigo_cliente_unico"() TO "anon";
GRANT ALL ON FUNCTION "public"."generar_codigo_cliente_unico"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generar_codigo_cliente_unico"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_operador_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_operador_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_operador_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rol_actual"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_rol_actual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rol_actual"() TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."listar_usuarios_login"() TO "anon";
GRANT ALL ON FUNCTION "public"."listar_usuarios_login"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."listar_usuarios_login"() TO "service_role";



GRANT ALL ON FUNCTION "public"."marcar_comision_pagada"("p_comision_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."marcar_comision_pagada"("p_comision_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_comision_pagada"("p_comision_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_categorias_vendedor"() TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_categorias_vendedor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_categorias_vendedor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_productos_vendedor"("p_busqueda" "text", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_productos_vendedor"("p_busqueda" "text", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_productos_vendedor"("p_busqueda" "text", "p_categoria" "text", "p_categoria_grupo" boolean, "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_reporte_ventas_comisiones"("p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone, "p_vendedor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_reporte_ventas_comisiones"("p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone, "p_vendedor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_reporte_ventas_comisiones"("p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone, "p_vendedor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_reporte_ventas_operaciones"("p_fecha_inicio" "date", "p_fecha_fin" "date", "p_vendedor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_reporte_ventas_operaciones"("p_fecha_inicio" "date", "p_fecha_fin" "date", "p_vendedor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_reporte_ventas_operaciones"("p_fecha_inicio" "date", "p_fecha_fin" "date", "p_vendedor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_resumen_comisiones"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_resumen_comisiones"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_resumen_comisiones"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_resumen_comisiones_v2"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_resumen_comisiones_v2"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_resumen_comisiones_v2"("p_cuenta_id" "uuid", "p_vendedor_id" "uuid", "p_estado" "text", "p_fecha_inicio" timestamp with time zone, "p_fecha_fin" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_stock_comprometido"() TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_stock_comprometido"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_stock_comprometido"() TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_stock_comprometido_detalle"("p_producto_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_stock_comprometido_detalle"("p_producto_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_stock_comprometido_detalle"("p_producto_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."obtener_stock_productos"("p_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."obtener_stock_productos"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."obtener_stock_productos"("p_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."purgar_logs_antiguos"() TO "anon";
GRANT ALL ON FUNCTION "public"."purgar_logs_antiguos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purgar_logs_antiguos"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reasignar_cliente"("p_cliente_id" "uuid", "p_nuevo_vendedor" "uuid", "p_motivo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reasignar_cliente"("p_cliente_id" "uuid", "p_nuevo_vendedor" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reasignar_cliente"("p_cliente_id" "uuid", "p_nuevo_vendedor" "uuid", "p_motivo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reciclar_cotizacion"("p_cotizacion_id" "uuid", "p_vendedor_destino_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reciclar_cotizacion"("p_cotizacion_id" "uuid", "p_vendedor_destino_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reciclar_cotizacion"("p_cotizacion_id" "uuid", "p_vendedor_destino_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reciclar_despacho"("p_despacho_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reciclar_despacho"("p_despacho_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reciclar_despacho"("p_despacho_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_abono_cxc"("p_cliente_id" "uuid", "p_monto" numeric, "p_forma_pago" "text", "p_referencia" "text", "p_descripcion" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_abono_cxc"("p_cliente_id" "uuid", "p_monto" numeric, "p_forma_pago" "text", "p_referencia" "text", "p_descripcion" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_abono_cxc"("p_cliente_id" "uuid", "p_monto" numeric, "p_forma_pago" "text", "p_referencia" "text", "p_descripcion" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_auditoria"("p_accion" "text", "p_entidad" "text", "p_entidad_id" "uuid", "p_detalle" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_auditoria"("p_accion" "text", "p_entidad" "text", "p_entidad_id" "uuid", "p_detalle" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_auditoria"("p_accion" "text", "p_entidad" "text", "p_entidad_id" "uuid", "p_detalle" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_auditoria"("p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_categoria" "public"."categoria_auditoria", "p_accion" "text", "p_descripcion" "text", "p_entidad_tipo" "text", "p_entidad_id" "uuid", "p_meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_auditoria"("p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_categoria" "public"."categoria_auditoria", "p_accion" "text", "p_descripcion" "text", "p_entidad_tipo" "text", "p_entidad_id" "uuid", "p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_auditoria"("p_usuario_id" "uuid", "p_usuario_nombre" "text", "p_usuario_rol" "text", "p_categoria" "public"."categoria_auditoria", "p_accion" "text", "p_descripcion" "text", "p_entidad_tipo" "text", "p_entidad_id" "uuid", "p_meta" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_cargo_cxc"("p_despacho_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_cargo_cxc"("p_despacho_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_cargo_cxc"("p_despacho_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_cargo_cxc"("p_cliente_id" "uuid", "p_despacho_id" "uuid", "p_monto_usd" numeric, "p_descripcion" "text", "p_registrado_por" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_cargo_cxc"("p_cliente_id" "uuid", "p_despacho_id" "uuid", "p_monto_usd" numeric, "p_descripcion" "text", "p_registrado_por" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_cargo_cxc"("p_cliente_id" "uuid", "p_despacho_id" "uuid", "p_monto_usd" numeric, "p_descripcion" "text", "p_registrado_por" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_pago_comision"("p_comision_id" "uuid", "p_cuenta_id" "uuid", "p_operador_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_pago_comision"("p_comision_id" "uuid", "p_cuenta_id" "uuid", "p_operador_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_pago_comision"("p_comision_id" "uuid", "p_cuenta_id" "uuid", "p_operador_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reiniciar_correlativos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reiniciar_correlativos"() TO "anon";
GRANT ALL ON FUNCTION "public"."reiniciar_correlativos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reiniciar_correlativos"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_cuenta_id_purchase_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_cuenta_id_purchase_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_cuenta_id_purchase_orders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_cuenta_id_smart"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_cuenta_id_smart"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_cuenta_id_smart"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sincronizar_prestamos_despacho"("p_despacho_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sincronizar_prestamos_despacho"("p_despacho_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sincronizar_prestamos_despacho"("p_despacho_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."tester_cleanup_cotizacion"("p_cotizacion_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."tester_cleanup_cotizacion"("p_cotizacion_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tester_cleanup_cotizacion"("p_cotizacion_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_sincronizar_prestamos_cabecera"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_sincronizar_prestamos_cabecera"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_sincronizar_prestamos_cabecera"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_sincronizar_prestamos_despacho"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_sincronizar_prestamos_despacho"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_sincronizar_prestamos_despacho"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tiene_gate_configurado"() TO "anon";
GRANT ALL ON FUNCTION "public"."tiene_gate_configurado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tiene_gate_configurado"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_clientes_generar_codigo"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_clientes_generar_codigo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_clientes_generar_codigo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_despacho_copiar_numero"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_despacho_copiar_numero"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_despacho_copiar_numero"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_liberar_comision_por_pago"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_liberar_comision_por_pago"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_liberar_comision_por_pago"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recalcular_saldo_pendiente"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recalcular_saldo_pendiente"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalcular_saldo_pendiente"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recalcular_saldo_pendiente_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recalcular_saldo_pendiente_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalcular_saldo_pendiente_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_cliente_para_cotizar"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_cliente_para_cotizar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_cliente_para_cotizar"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_gate_acceso"("p_email" "text", "p_password_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validar_gate_acceso"("p_email" "text", "p_password_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_gate_acceso"("p_email" "text", "p_password_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_transicion_estado"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_transicion_estado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_transicion_estado"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";









GRANT ALL ON TABLE "public"."auditoria" TO "anon";
GRANT ALL ON TABLE "public"."auditoria" TO "authenticated";
GRANT ALL ON TABLE "public"."auditoria" TO "service_role";



GRANT ALL ON TABLE "public"."cliente_prestamos" TO "anon";
GRANT ALL ON TABLE "public"."cliente_prestamos" TO "authenticated";
GRANT ALL ON TABLE "public"."cliente_prestamos" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "anon";
GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."comisiones" TO "anon";
GRANT ALL ON TABLE "public"."comisiones" TO "authenticated";
GRANT ALL ON TABLE "public"."comisiones" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_negocio" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_negocio" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_negocio" TO "service_role";



GRANT ALL ON TABLE "public"."cotizacion_items" TO "anon";
GRANT ALL ON TABLE "public"."cotizacion_items" TO "authenticated";
GRANT ALL ON TABLE "public"."cotizacion_items" TO "service_role";



GRANT ALL ON TABLE "public"."cotizaciones" TO "anon";
GRANT ALL ON TABLE "public"."cotizaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."cotizaciones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cotizaciones_numero_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cotizaciones_numero_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cotizaciones_numero_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cuentas_por_cobrar" TO "anon";
GRANT ALL ON TABLE "public"."cuentas_por_cobrar" TO "authenticated";
GRANT ALL ON TABLE "public"."cuentas_por_cobrar" TO "service_role";



GRANT ALL ON TABLE "public"."despacho_descuentos" TO "anon";
GRANT ALL ON TABLE "public"."despacho_descuentos" TO "authenticated";
GRANT ALL ON TABLE "public"."despacho_descuentos" TO "service_role";



GRANT ALL ON TABLE "public"."inventario_movimientos" TO "anon";
GRANT ALL ON TABLE "public"."inventario_movimientos" TO "authenticated";
GRANT ALL ON TABLE "public"."inventario_movimientos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."inventario_movimientos_numero_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."inventario_movimientos_numero_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."inventario_movimientos_numero_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notas_despacho" TO "anon";
GRANT ALL ON TABLE "public"."notas_despacho" TO "authenticated";
GRANT ALL ON TABLE "public"."notas_despacho" TO "service_role";



GRANT ALL ON TABLE "public"."notas_despacho_items" TO "anon";
GRANT ALL ON TABLE "public"."notas_despacho_items" TO "authenticated";
GRANT ALL ON TABLE "public"."notas_despacho_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notas_despacho_numero_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notas_despacho_numero_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notas_despacho_numero_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orden_compra_items" TO "anon";
GRANT ALL ON TABLE "public"."orden_compra_items" TO "authenticated";
GRANT ALL ON TABLE "public"."orden_compra_items" TO "service_role";



GRANT ALL ON TABLE "public"."ordenes_compra" TO "anon";
GRANT ALL ON TABLE "public"."ordenes_compra" TO "authenticated";
GRANT ALL ON TABLE "public"."ordenes_compra" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ordenes_compra_numero_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ordenes_compra_numero_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ordenes_compra_numero_seq" TO "service_role";



GRANT ALL ON TABLE "public"."productos" TO "anon";
GRANT ALL ON TABLE "public"."productos" TO "authenticated";
GRANT ALL ON TABLE "public"."productos" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."reasignaciones_clientes" TO "anon";
GRANT ALL ON TABLE "public"."reasignaciones_clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."reasignaciones_clientes" TO "service_role";



GRANT ALL ON TABLE "public"."seguimiento_operativo" TO "anon";
GRANT ALL ON TABLE "public"."seguimiento_operativo" TO "authenticated";
GRANT ALL ON TABLE "public"."seguimiento_operativo" TO "service_role";



GRANT ALL ON TABLE "public"."system_log_analysis" TO "anon";
GRANT ALL ON TABLE "public"."system_log_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."system_log_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."system_logs" TO "anon";
GRANT ALL ON TABLE "public"."system_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."system_logs" TO "service_role";



GRANT ALL ON TABLE "public"."transportistas" TO "anon";
GRANT ALL ON TABLE "public"."transportistas" TO "authenticated";
GRANT ALL ON TABLE "public"."transportistas" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios" TO "anon";
GRANT ALL ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."v_catalogo_publico" TO "anon";
GRANT ALL ON TABLE "public"."v_catalogo_publico" TO "authenticated";
GRANT ALL ON TABLE "public"."v_catalogo_publico" TO "service_role";



GRANT ALL ON TABLE "public"."v_cotizaciones_vendedor" TO "anon";
GRANT ALL ON TABLE "public"."v_cotizaciones_vendedor" TO "authenticated";
GRANT ALL ON TABLE "public"."v_cotizaciones_vendedor" TO "service_role";



GRANT ALL ON TABLE "public"."v_productos_vendedor" TO "anon";
GRANT ALL ON TABLE "public"."v_productos_vendedor" TO "authenticated";
GRANT ALL ON TABLE "public"."v_productos_vendedor" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































