-- 033_fix_auditoria_rls_and_constraints.sql
-- Fixes:
-- 1. Add SELECT policy for auditoria (supervisors can read audit logs)
-- 2. Add DELETE protection policy on auditoria
-- 3. Add CHECK constraint on cotizaciones.cotizacion_raiz_id versioning

-- ── 1. Auditoria: supervisores pueden leer ──────────────────────────────────
CREATE POLICY auditoria_supervisor_select ON public.auditoria
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- ── 2. Auditoria: nadie puede borrar (append-only) ─────────────────────────
CREATE POLICY auditoria_no_delete ON public.auditoria
  FOR DELETE
  USING (false);

-- ── 3. CHECK: version=1 requiere cotizacion_raiz_id NULL y viceversa ────────
ALTER TABLE public.cotizaciones
  ADD CONSTRAINT chk_version_raiz
  CHECK (
    (version = 1 AND cotizacion_raiz_id IS NULL)
    OR
    (version > 1 AND cotizacion_raiz_id IS NOT NULL)
  );
