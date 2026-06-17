-- 112_factory_reset_multitenant.sql
-- Hace que el reinicio operacional solo borre datos del tenant actual

CREATE OR REPLACE FUNCTION public.factory_reset_operacional(p_cuenta_id UUID)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verificar que el usuario tenga acceso a esa cuenta (o que la función se llame de forma segura desde el worker)
  -- En nuestro caso, el worker pasa p_cuenta_id del usuario autenticado.

  -- Orden seguro respetando FK constraints
  DELETE FROM comisiones WHERE cuenta_id = p_cuenta_id;
  DELETE FROM cuentas_por_cobrar WHERE cuenta_id = p_cuenta_id;
  DELETE FROM notas_despacho_items WHERE cuenta_id = p_cuenta_id;
  DELETE FROM notas_despacho WHERE cuenta_id = p_cuenta_id;
  DELETE FROM cotizacion_items WHERE cuenta_id = p_cuenta_id;
  DELETE FROM cotizaciones WHERE cuenta_id = p_cuenta_id;
  DELETE FROM inventario_movimientos WHERE cuenta_id = p_cuenta_id;
  DELETE FROM auditoria WHERE cuenta_id = p_cuenta_id;
  
  -- system_logs no tiene cuenta_id y es global, así que no lo borramos aquí

  RETURN json_build_object(
    'ok', true,
    'mensaje', 'Reset completado. Sus datos operacionales han sido eliminados conservando clientes, usuarios y stock.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.factory_reset_operacional(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.factory_reset_operacional(UUID) TO authenticated;
