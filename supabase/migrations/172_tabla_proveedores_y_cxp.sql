-- 172_tabla_proveedores_y_cxp.sql
-- Tablas, RLS, triggers e índices para Proveedores y Cuentas por Pagar (CxP)

-- 1. Tabla Proveedores
CREATE TABLE IF NOT EXISTS public.proveedores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rif_cedula      TEXT,
  telefono        TEXT,
  email           TEXT,
  estado          TEXT,
  ciudad          TEXT,
  direccion       TEXT,
  notas           TEXT,
  tipo_proveedor  TEXT DEFAULT 'juridico' CHECK (tipo_proveedor IN ('natural', 'juridico')),
  saldo_pendiente NUMERIC(12,4) NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  cuenta_id       UUID NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices proveedores
CREATE INDEX IF NOT EXISTS idx_proveedores_cuenta ON public.proveedores(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_proveedores_activo ON public.proveedores(activo) WHERE activo = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_rif ON public.proveedores(rif_cedula, cuenta_id) WHERE activo = true AND rif_cedula IS NOT NULL AND trim(rif_cedula) <> '';

-- 2. Tabla Cuentas por Pagar (CxP)
CREATE TABLE IF NOT EXISTS public.cuentas_por_pagar (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id     UUID NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  tipo             TEXT NOT NULL CHECK (tipo IN ('cargo', 'abono')),
  monto_usd        NUMERIC(12,4) NOT NULL CHECK (monto_usd > 0),
  saldo_usd        NUMERIC(12,4) NOT NULL,
  forma_pago_abono TEXT,
  referencia       TEXT,
  descripcion      TEXT NOT NULL,
  registrado_por   UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  cuenta_id        UUID NOT NULL,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices cuentas por pagar
CREATE INDEX IF NOT EXISTS idx_cpp_proveedor ON public.cuentas_por_pagar(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_cpp_tipo      ON public.cuentas_por_pagar(tipo);
CREATE INDEX IF NOT EXISTS idx_cpp_cuenta    ON public.cuentas_por_pagar(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_cpp_fecha     ON public.cuentas_por_pagar(creado_en DESC);

-- 3. Habilitar RLS
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas_por_pagar ENABLE ROW LEVEL SECURITY;

-- 4. Triggers de actualización
CREATE TRIGGER trg_proveedores_updated
  BEFORE UPDATE ON public.proveedores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Trigger de Sincronización de Saldo Pendiente del Proveedor
CREATE OR REPLACE FUNCTION public.trg_recalcular_saldo_pendiente_proveedor()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo_real NUMERIC(12,4);
BEGIN
  -- Recalcular saldo sumando cargos (deudas) y restando abonos (pagos)
  SELECT COALESCE(
    SUM(CASE WHEN tipo = 'cargo' THEN monto_usd ELSE -monto_usd END),
    0
  )
  INTO v_saldo_real
  FROM public.cuentas_por_pagar
  WHERE proveedor_id = NEW.proveedor_id;

  -- Asegurar que no quede negativo
  v_saldo_real := GREATEST(0, v_saldo_real);

  -- Actualizar saldo_pendiente en proveedores
  UPDATE public.proveedores
  SET saldo_pendiente = v_saldo_real
  WHERE id = NEW.proveedor_id
    AND saldo_pendiente IS DISTINCT FROM v_saldo_real;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_saldo_pendiente_proveedor ON public.cuentas_por_pagar;
CREATE TRIGGER trg_sync_saldo_pendiente_proveedor
  AFTER INSERT ON public.cuentas_por_pagar
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_recalcular_saldo_pendiente_proveedor();

-- 6. Extender set_cuenta_id_smart() para poblar automáticamente cuenta_id
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggers de cuenta_id
DROP TRIGGER IF EXISTS trg_set_cuenta_id_proveedores ON public.proveedores;
CREATE TRIGGER trg_set_cuenta_id_proveedores
  BEFORE INSERT ON public.proveedores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_cuenta_id_smart();

DROP TRIGGER IF EXISTS trg_set_cuenta_id_cuentas_por_pagar ON public.cuentas_por_pagar;
CREATE TRIGGER trg_set_cuenta_id_cuentas_por_pagar
  BEFORE INSERT ON public.cuentas_por_pagar
  FOR EACH ROW
  EXECUTE FUNCTION public.set_cuenta_id_smart();

-- 7. RLS Policies
-- Restrictive isolation policies (Tenant isolation check)
DROP POLICY IF EXISTS isolation_proveedores ON public.proveedores;
CREATE POLICY isolation_proveedores ON public.proveedores AS RESTRICTIVE FOR ALL USING (cuenta_id = auth.uid());

DROP POLICY IF EXISTS isolation_cuentas_por_pagar ON public.cuentas_por_pagar;
CREATE POLICY isolation_cuentas_por_pagar ON public.cuentas_por_pagar AS RESTRICTIVE FOR ALL USING (cuenta_id = auth.uid());

-- Permissive role check policies (Privileged roles ALL permissions)
DROP POLICY IF EXISTS proveedores_privileged_all ON public.proveedores;
CREATE POLICY proveedores_privileged_all ON public.proveedores
  FOR ALL TO authenticated
  USING (public.get_rol_actual() IN ('supervisor', 'jefe', 'administracion', 'desarrollador'))
  WITH CHECK (public.get_rol_actual() IN ('supervisor', 'jefe', 'administracion', 'desarrollador'));

DROP POLICY IF EXISTS cpp_privileged_all ON public.cuentas_por_pagar;
CREATE POLICY cpp_privileged_all ON public.cuentas_por_pagar
  FOR ALL TO authenticated
  USING (public.get_rol_actual() IN ('supervisor', 'jefe', 'administracion', 'desarrollador'))
  WITH CHECK (public.get_rol_actual() IN ('supervisor', 'jefe', 'administracion', 'desarrollador'));
