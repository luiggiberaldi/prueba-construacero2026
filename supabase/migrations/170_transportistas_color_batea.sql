-- 170_transportistas_color_batea.sql
-- Añadir columna de color_batea a la tabla de transportistas
ALTER TABLE public.transportistas ADD COLUMN IF NOT EXISTS color_batea TEXT;
