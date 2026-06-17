-- 173_add_vencimiento_to_cxp.sql
-- Agregar fecha_vencimiento a cuentas_por_pagar para soporte de crédito de proveedores

-- 1. Agregar columna fecha_vencimiento
ALTER TABLE public.cuentas_por_pagar 
  ADD COLUMN IF NOT EXISTS fecha_vencimiento TIMESTAMPTZ DEFAULT NULL;

-- 2. Crear índice para optimizar consultas de alertas
CREATE INDEX IF NOT EXISTS idx_cpp_fecha_vencimiento 
  ON public.cuentas_por_pagar(fecha_vencimiento) 
  WHERE tipo = 'cargo' AND fecha_vencimiento IS NOT NULL;
