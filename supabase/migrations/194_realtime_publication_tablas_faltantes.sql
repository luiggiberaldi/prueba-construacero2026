-- 193: agregar a la publicación supabase_realtime las tablas que el cliente
-- escucha por postgres_changes pero que nunca fueron publicadas.
--
-- useRealtimeSync se suscribe a clientes, usuarios, configuracion_negocio y
-- cotizaciones, pero solo se habían publicado comisiones (035), notas_despacho
-- (021), notas_despacho_items (097), ordenes_compra (146) y seguimiento_operativo
-- (157). Sin estar en la publicación, sus cambios nunca llegaban a los otros
-- dispositivos (el respaldo postgres_changes quedaba inerte).
--
-- Idempotente: solo agrega la tabla si aún no está en la publicación.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes','usuarios','configuracion_negocio','cotizaciones'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
