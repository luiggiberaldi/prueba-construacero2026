-- supabase/migrations/181_devolucion_parcial_intercambio.sql
-- Creación de la tabla despacho_devolucion_intercambios para registrar los productos entregados a cambio de una devolución parcial

CREATE TABLE IF NOT EXISTS public.despacho_devolucion_intercambios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    despacho_id UUID NOT NULL REFERENCES public.notas_despacho(id) ON DELETE CASCADE,
    producto_id UUID REFERENCES public.productos(id) ON DELETE SET NULL,
    nombre_snap TEXT NOT NULL,
    codigo_snap TEXT,
    unidad_snap TEXT NOT NULL DEFAULT 'und',
    cantidad NUMERIC(12,4) NOT NULL CHECK (cantidad > 0),
    precio_unit_usd NUMERIC(12,4) NOT NULL,
    total_usd NUMERIC(12,4) NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    registrado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_intercambios_despacho ON public.despacho_devolucion_intercambios(despacho_id);

ALTER TABLE public.despacho_devolucion_intercambios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en despacho_devolucion_i" ON public.despacho_devolucion_intercambios;
DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en despacho_devolucion_intercambios" ON public.despacho_devolucion_intercambios;

CREATE POLICY "Permitir todo a operadores autorizados en despacho_devolucion_intercambios"
ON public.despacho_devolucion_intercambios
FOR ALL
TO authenticated
USING (TRUE)
WITH CHECK (TRUE);
