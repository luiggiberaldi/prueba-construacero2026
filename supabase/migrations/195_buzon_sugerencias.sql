-- 195_buzon_sugerencias.sql
-- Crear tabla buzon_sugerencias para quejas, sugerencias y errores técnicos de los operadores.

-- 1. Crear la tabla buzon_sugerencias
CREATE TABLE IF NOT EXISTS public.buzon_sugerencias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id      UUID NOT NULL REFERENCES public.configuracion_negocio(cuenta_id) ON DELETE CASCADE,
  usuario_id     UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('sugerencia', 'queja', 'error_tecnico')),
  mensaje        TEXT NOT NULL CHECK (char_length(mensaje) <= 500),
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'leido', 'resuelto')),
  nota_interna   TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Crear índices para búsquedas y filtros
CREATE INDEX IF NOT EXISTS idx_buzon_cuenta_id ON public.buzon_sugerencias(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_buzon_usuario_id ON public.buzon_sugerencias(usuario_id);
CREATE INDEX IF NOT EXISTS idx_buzon_estado ON public.buzon_sugerencias(estado);

-- 2. Habilitar RLS
ALTER TABLE public.buzon_sugerencias ENABLE ROW LEVEL SECURITY;

-- 3. Redefinir set_cuenta_id_smart para incluir buzon_sugerencias
CREATE OR REPLACE FUNCTION public.set_cuenta_id_smart()
RETURNS TRIGGER AS $$
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

  -- Si no (Worker con Service Key), inferimos a través de relaciones
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
  ELSIF TG_TABLE_NAME = 'cuentas_por_pagar' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.proveedores WHERE id = NEW.proveedor_id;
  ELSIF TG_TABLE_NAME = 'buzon_sugerencias' THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM public.usuarios WHERE id = NEW.usuario_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Crear trigger de cuenta_id
DROP TRIGGER IF EXISTS trg_set_cuenta_id_buzon_sugerencias ON public.buzon_sugerencias;
CREATE TRIGGER trg_set_cuenta_id_buzon_sugerencias
  BEFORE INSERT ON public.buzon_sugerencias
  FOR EACH ROW
  EXECUTE FUNCTION public.set_cuenta_id_smart();

-- 5. Crear trigger para actualizar actualizado_en
DROP TRIGGER IF EXISTS trg_buzon_sugerencias_updated ON public.buzon_sugerencias;
CREATE TRIGGER trg_buzon_sugerencias_updated
  BEFORE UPDATE ON public.buzon_sugerencias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Crear políticas RLS

-- Aislamiento de cuenta (Tenant isolation check)
DROP POLICY IF EXISTS isolation_buzon_sugerencias ON public.buzon_sugerencias;
CREATE POLICY isolation_buzon_sugerencias ON public.buzon_sugerencias
  AS RESTRICTIVE FOR ALL USING (cuenta_id = auth.uid());

-- SELECT: El desarrollador puede ver todos, otros usuarios ven solo sus propios mensajes
DROP POLICY IF EXISTS buzon_select ON public.buzon_sugerencias;
CREATE POLICY buzon_select ON public.buzon_sugerencias
  FOR SELECT TO authenticated
  USING (
    usuario_id = public.get_operador_id() OR
    COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador'
  );

-- INSERT: Cualquier usuario autenticado puede enviar su propio mensaje
DROP POLICY IF EXISTS buzon_insert ON public.buzon_sugerencias;
CREATE POLICY buzon_insert ON public.buzon_sugerencias
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = public.get_operador_id()
  );

-- UPDATE: Solo desarrollador puede actualizar (ej: estado, nota_interna)
DROP POLICY IF EXISTS buzon_update ON public.buzon_sugerencias;
CREATE POLICY buzon_update ON public.buzon_sugerencias
  FOR UPDATE TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador'
  )
  WITH CHECK (
    COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador'
  );

-- DELETE: Solo desarrollador puede eliminar
DROP POLICY IF EXISTS buzon_delete ON public.buzon_sugerencias;
CREATE POLICY buzon_delete ON public.buzon_sugerencias
  FOR DELETE TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador'
  );

-- 7. Agregar a la publicación supabase_realtime de forma segura
DO $$
DECLARE
  t text := 'buzon_sugerencias';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
  ) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
  END IF;
END $$;
