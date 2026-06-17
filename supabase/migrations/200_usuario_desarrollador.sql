-- 073_usuario_desarrollador.sql
-- El perfil "Desarrollador" usa un operator_id sintético (UUID ceros)
-- que no existía en la tabla usuarios, causando NOT FOUND en RPCs.
-- Se agrega 'desarrollador' al constraint y se inserta la fila.

-- 1. Actualizar constraint para incluir 'desarrollador'
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('supervisor', 'vendedor', 'administracion', 'logistica', 'desarrollador'));

-- 2. Insertar usuario desarrollador con UUID sintético
INSERT INTO public.usuarios (id, nombre, rol, activo, color)
VALUES ('00000000-0000-0000-0000-000000000000', 'Desarrollador', 'desarrollador', true, '#8b5cf6')
ON CONFLICT (id) DO UPDATE SET rol = 'desarrollador', activo = true;
