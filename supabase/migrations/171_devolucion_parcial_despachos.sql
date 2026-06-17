-- supabase/migrations/171_devolucion_parcial_despachos.sql
-- Add flags and tables for partial return (devolución parcial) of dispatches

-- 1. Add tiene_devoluciones flag to notas_despacho table
ALTER TABLE public.notas_despacho 
ADD COLUMN IF NOT EXISTS tiene_devoluciones BOOLEAN DEFAULT FALSE;

-- 2. Create despacho_devoluciones table
CREATE TABLE IF NOT EXISTS public.despacho_devoluciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    despacho_id UUID NOT NULL REFERENCES public.notas_despacho(id) ON DELETE CASCADE,
    despacho_item_id UUID REFERENCES public.notas_despacho_items(id) ON DELETE SET NULL,
    producto_id UUID REFERENCES public.productos(id) ON DELETE SET NULL,
    nombre_snap TEXT NOT NULL,
    codigo_snap TEXT,
    unidad_snap TEXT NOT NULL DEFAULT 'und',
    cantidad_devuelta NUMERIC(12,4) NOT NULL CHECK (cantidad_devuelta > 0),
    precio_unit_usd NUMERIC(12,4) NOT NULL,
    total_devuelto_usd NUMERIC(12,4) NOT NULL,
    motivo TEXT NOT NULL,
    registrado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    registrado_por_nombre TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    cotizacion_reemplazo_id UUID REFERENCES public.cotizaciones(id) ON DELETE SET NULL
);

-- 3. Create index for performance
CREATE INDEX IF NOT EXISTS idx_devoluciones_despacho ON public.despacho_devoluciones(despacho_id);

-- 4. Enable RLS
ALTER TABLE public.despacho_devoluciones ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policy
CREATE POLICY "Permitir todo a operadores autorizados en despacho_devoluciones"
ON public.despacho_devoluciones
FOR ALL
TO authenticated
USING (TRUE)
WITH CHECK (TRUE);
