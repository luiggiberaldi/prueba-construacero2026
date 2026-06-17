-- 176_personal_descuento_negocio.sql

-- 1. Agregar columna de descuento para personal a configuracion_negocio
ALTER TABLE public.configuracion_negocio 
  ADD COLUMN IF NOT EXISTS descuento_personal_pct NUMERIC(5,2) DEFAULT 10.00;

-- 2. Permitir que cualquier operador autenticado lea los clientes de tipo personal de su propia cuenta
CREATE POLICY clientes_personal_select ON public.clientes
  FOR SELECT
  USING (tipo_cliente = 'personal' AND activo = true);
