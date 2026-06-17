-- 183: columnas y tabla para liberación proporcional (aditivo, sin lógica)
ALTER TABLE public.comisiones
  ADD COLUMN IF NOT EXISTS comision_liberada NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comision_retenida NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.comision_liberaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comision_id UUID NOT NULL REFERENCES public.comisiones(id) ON DELETE CASCADE,
  despacho_id UUID NOT NULL,
  vendedor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cuenta_id   UUID NOT NULL,
  monto       NUMERIC(12,2) NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('contado','abono')),
  cxc_id      UUID,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comision_liberaciones_fecha    ON public.comision_liberaciones(creado_en);
CREATE INDEX IF NOT EXISTS idx_comision_liberaciones_comision ON public.comision_liberaciones(comision_id);

ALTER TABLE public.comision_liberaciones ENABLE ROW LEVEL SECURITY;

-- Política de lectura segura igual que comisiones
CREATE POLICY comision_liberaciones_select ON public.comision_liberaciones
  FOR SELECT
  USING (
    vendedor_id = auth.uid()
    OR public.get_rol_actual() IN ('supervisor', 'admin', 'administracion', 'desarrollador', 'jefe')
  );

GRANT SELECT ON public.comision_liberaciones TO authenticated;
