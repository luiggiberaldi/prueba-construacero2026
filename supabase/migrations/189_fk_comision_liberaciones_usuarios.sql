-- 189: agregar FK comision_liberaciones.vendedor_id -> usuarios(id)
-- Necesario para que PostgREST pueda embeber `vendedor:usuarios(...)` en la
-- vista de eventos del reporte de comisiones. La tabla (183) se creo sin esta
-- restriccion. Idempotente: solo agrega el constraint si no existe.

-- Limpiar posibles vendedor_id huerfanos (del backfill 186) para que el
-- ALTER no falle por violacion de integridad referencial.
UPDATE public.comision_liberaciones cl
SET vendedor_id = NULL
WHERE vendedor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id = cl.vendedor_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comision_liberaciones_vendedor_id_fkey'
      AND conrelid = 'public.comision_liberaciones'::regclass
  ) THEN
    ALTER TABLE public.comision_liberaciones
      ADD CONSTRAINT comision_liberaciones_vendedor_id_fkey
      FOREIGN KEY (vendedor_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Recargar el cache de esquema de PostgREST para que reconozca la relacion
NOTIFY pgrst, 'reload schema';
