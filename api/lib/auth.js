// api/lib/auth.js
import { jsonError, isValidUuid } from './utils.js'

// UUID especial para Super Admin virtual (easter egg del logo)
export const SUPER_ADMIN_UUID = '00000000-0000-0000-0000-000000000000'

// Obtiene headers Supabase con service key
export function supaServiceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

// Verifica el JWT del usuario autenticado contra Supabase
// Extrae operator_id/operator_rol de app_metadata si están presentes
export async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  // Verificar el token llamando a Supabase auth
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  // Attach operator context from app_metadata (set by switch-operator)
  user.operator_id = user.app_metadata?.operator_id || null;
  user.operator_rol = user.app_metadata?.operator_rol || null;
  user.operator_nombre = user.app_metadata?.operator_nombre || null;
  user.operator_es_externo = user.app_metadata?.operator_es_externo || null;

  // Allow frontend to override operator_id via header (handles JWT refresh delay)
  const headerOpId = request.headers.get('X-Operator-Id');
  if (headerOpId && isValidUuid(headerOpId) && headerOpId !== user.operator_id) {
    // Verify the operator exists and is active before trusting the header
    const checkRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${headerOpId}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,rol,es_externo`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    );
    if (checkRes.ok) {
      const [op] = await checkRes.json();
      if (op) {
        user.operator_id = op.id;
        user.operator_rol = op.rol;
        user.operator_nombre = op.nombre;
        user.operator_es_externo = op.es_externo;
      }
    }
  }

  return user;
}

// Obtiene el rol del operador (supervisor | vendedor | administracion | desarrollador | null)
export async function getOperatorRole(operatorId, env) {
  if (!operatorId) return null;
  if (operatorId === SUPER_ADMIN_UUID) return 'desarrollador';
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${operatorId}&activo=eq.true&select=rol`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length === 1 ? rows[0].rol : null;
}

// Verifica que el operador sea supervisor consultando la tabla usuarios
export async function verifySupervisor(operatorId, env) {
  const rol = await getOperatorRole(operatorId, env);
  return rol === 'supervisor' || rol === 'jefe' || rol === 'administracion' || rol === 'desarrollador';
}

// Verifica supervisor O administracion O jefe (para endpoints compartidos como reportes)
export async function verifyPrivileged(operatorId, env) {
  const rol = await getOperatorRole(operatorId, env);
  return rol === 'supervisor' || rol === 'jefe' || rol === 'administracion' || rol === 'desarrollador';
}

// Valida auth + operator_id, devuelve { user, operador, ip } o Response de error
// HELPERS para endpoints migrados de RPC
export async function validateOperator(request, env, { requireSupervisor = false } = {}) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return { error: jsonError('No autenticado', 401, request) };
  if (!user.operator_id) return { error: jsonError('No hay operador seleccionado', 400, request) };

  const ip = request.headers.get('CF-Connecting-IP') || null;

  // Desarrollador virtual — no existe en tabla usuarios
  if (user.operator_id === SUPER_ADMIN_UUID) {
    const operador = { id: SUPER_ADMIN_UUID, nombre: 'Desarrollador', rol: 'desarrollador', color: '#8b5cf6' };
    return { user, operador, headers: supaServiceHeaders(env), ip };
  }

  const h = supaServiceHeaders(env);
  const rolFilter = requireSupervisor ? '&rol=in.(supervisor,jefe,logistica,administracion,desarrollador)' : '';
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.operator_id}&activo=eq.true${rolFilter}&select=id,nombre,rol,color,cuenta_id,markup_pct,es_externo`,
      { headers: h }
    );
    if (!res.ok) {
      const errText = await res.text();
      return { error: jsonError(`Error de conexion con Supabase (HTTP ${res.status}): ${errText}`, res.status || 500, request) };
    }
    const rows = await res.json();
    const operador = rows[0];
    if (!operador) {
      const msg = requireSupervisor
        ? 'Solo supervisores, logistica o administracion pueden realizar esta acción'
        : 'Operador no encontrado o inactivo';
      return { error: jsonError(msg, 403, request) };
    }

    return { user, operador, headers: h, ip };
  } catch (err) {
    return { error: jsonError(`Error critico al validar operador: ${err.message}`, 500, request) };
  }
}
