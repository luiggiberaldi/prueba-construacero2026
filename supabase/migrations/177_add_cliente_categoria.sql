-- 177_add_cliente_categoria.sql
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS categoria TEXT;
