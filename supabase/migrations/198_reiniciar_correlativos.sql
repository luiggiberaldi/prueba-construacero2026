-- Función para reiniciar correlativos (llamada desde factory reset)
CREATE OR REPLACE FUNCTION public.reiniciar_correlativos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reiniciar secuencia de cotizaciones.numero
  ALTER SEQUENCE cotizaciones_numero_seq RESTART WITH 1;
  -- Reiniciar secuencia de notas_despacho.numero
  ALTER SEQUENCE notas_despacho_numero_seq RESTART WITH 1;
END;
$$;

-- Solo supervisores pueden llamarla
REVOKE ALL ON FUNCTION public.reiniciar_correlativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reiniciar_correlativos() TO authenticated;
