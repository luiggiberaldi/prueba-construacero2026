-- 116_fix_comisiones_vendedor_huerfano.sql

-- Este script asigna automáticamente el vendedor a las comisiones huérfanas 
-- (incluyendo DES-00388 y DES-00387) basándose en el vendedor actual del cliente.

DO $$
BEGIN
  -- 1. Actualizar comisiones huérfanas
  UPDATE public.comisiones com
  SET vendedor_id = cl.vendedor_id
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = c.cliente_id
  WHERE com.despacho_id = nd.id
    AND com.vendedor_id IS NULL
    AND cl.vendedor_id IS NOT NULL;

  -- 2. Actualizar notas_despacho huérfanas
  UPDATE public.notas_despacho nd
  SET vendedor_id = cl.vendedor_id
  FROM public.cotizaciones c
  JOIN public.clientes cl ON cl.id = c.cliente_id
  WHERE nd.cotizacion_id = c.id
    AND nd.vendedor_id IS NULL
    AND cl.vendedor_id IS NOT NULL;

  -- 3. Actualizar cotizaciones huérfanas
  UPDATE public.cotizaciones c
  SET vendedor_id = cl.vendedor_id
  FROM public.clientes cl
  WHERE c.cliente_id = cl.id
    AND c.vendedor_id IS NULL
    AND cl.vendedor_id IS NOT NULL;

END;
$$;
