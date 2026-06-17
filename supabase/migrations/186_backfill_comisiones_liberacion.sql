-- 186: Backfill de comisiones históricas para liberación proporcional
-- 1. Comisiones ya liberadas o pagadas (totalcomision): comision_liberada = totalcomision, comision_retenida = 0
UPDATE public.comisiones 
SET comision_liberada = totalcomision, 
    comision_retenida = 0 
WHERE estado IN ('pendiente', 'pagada');

-- 2. Comisiones retenidas (cta_cobrar): se inicializan con comision_liberada = 0, comision_retenida = totalcomision
-- (se irán liberando proporcionalmente con abonos futuros)
UPDATE public.comisiones 
SET comision_liberada = 0, 
    comision_retenida = totalcomision 
WHERE estado = 'cta_cobrar';

-- 3. Crear eventos históricos de liberación para comisiones ya liberadas,
-- fechados con el momento de creación del despacho para no distorsionar el período actual.
INSERT INTO public.comision_liberaciones (
  comision_id, 
  despacho_id, 
  vendedor_id, 
  cuenta_id, 
  monto, 
  tipo, 
  creado_en
)
SELECT 
  c.id, 
  c.despachoid, 
  c.vendedorid, 
  c.cuentaid, 
  c.comision_liberada, 
  'contado', 
  nd.creado_en
FROM public.comisiones c
JOIN public.notas_despacho nd ON nd.id = c.despachoid
WHERE c.comision_liberada > 0;
