-- 193_unificar_cabillas.sql
-- Unificar la categoría "CABILLAS ACERO ESTRIADAS" a "CABILLAS" en los productos
-- y actualizar la configuración global del negocio para que apunte a "CABILLAS".

-- 1. Actualizar productos que tengan la categoría vieja
UPDATE public.productos
SET categoria = 'CABILLAS'
WHERE categoria = 'CABILLAS ACERO ESTRIADAS';

-- 2. Actualizar configuración de negocio para usar la categoría unificada
UPDATE public.configuracion_negocio
SET comision_categoria_cabilla = 'CABILLAS'
WHERE comision_categoria_cabilla = 'CABILLAS ACERO ESTRIADAS';
