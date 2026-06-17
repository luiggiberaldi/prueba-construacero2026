-- 188: Corregir políticas RLS para comisiones y liberaciones (auth.uid() -> get_operador_id())

-- 1. Actualizar política de lectura para public.comisiones
DROP POLICY IF EXISTS comisiones_vendedor_select ON public.comisiones;
CREATE POLICY comisiones_vendedor_select ON public.comisiones
  FOR SELECT
  USING (vendedorid = public.get_operador_id());

-- 2. Actualizar política de lectura para public.comision_liberaciones
DROP POLICY IF EXISTS comision_liberaciones_select ON public.comision_liberaciones;
CREATE POLICY comision_liberaciones_select ON public.comision_liberaciones
  FOR SELECT
  USING (
    vendedor_id = public.get_operador_id()
    OR public.get_rol_actual() IN ('supervisor', 'admin', 'administracion', 'desarrollador', 'jefe')
  );
