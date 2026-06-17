// api/handlers/dev.js
import { json, jsonError } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { logToSystem } from '../lib/audit.js'
import { runPurgeTrackingImages } from './seguimiento.js'
import { runCleanupCotizaciones } from './cotizaciones.js'

export async function handleDevTools(request, env, url) {
  // Verificar que sea desarrollador
  const op = await validateOperator(request, env);
  if (op.error) return op.error;
  if (op.operador.rol !== 'desarrollador') return jsonError('Acceso denegado', 403, request);

  const sub = url.pathname.replace('/api/dev/', '');

  // GET /api/dev/health — Health check en vivo
  if (sub === 'health' && request.method === 'GET') {
    const checks = {};
    const t0 = Date.now();

    // 1. Supabase connection
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?select=count&limit=1`, {
        headers: supaServiceHeaders(env),
      });
      checks.supabase = { ok: r.ok, status: r.status, ms: Date.now() - t0 };
    } catch (e) {
      checks.supabase = { ok: false, error: e.message, ms: Date.now() - t0 };
    }

    // 2. Groq API (grupo A, modelo check)
    const t1 = Date.now();
    try {
      const raw = env.GROQ_KEYS_A;
      const keys = raw ? raw.split(',').map(k => k.trim()).filter(Boolean) : [];
      if (!keys.length) {
        checks.groq = { ok: false, error: 'No hay keys configuradas', ms: 0 };
      } else {
        const r = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${keys[0]}` },
        });
        checks.groq = { ok: r.ok, status: r.status, keys_count: keys.length * 3, ms: Date.now() - t1 };
      }
    } catch (e) {
      checks.groq = { ok: false, error: e.message, ms: Date.now() - t1 };
    }

    // 3. System logs table
    const t2 = Date.now();
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/system_logs?select=count`, {
        headers: { ...supaServiceHeaders(env), Prefer: 'count=exact' },
      });
      const count = r.headers.get('content-range')?.split('/')?.[1] || '?';
      checks.system_logs = { ok: r.ok, total_logs: count, ms: Date.now() - t2 };
    } catch (e) {
      checks.system_logs = { ok: false, error: e.message, ms: Date.now() - t2 };
    }

    // 4. Tables check
    const t3 = Date.now();
    try {
      const tables = ['usuarios', 'clientes', 'productos', 'cotizaciones', 'despachos', 'transportistas'];
      const counts = {};
      for (const t of tables) {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=count`, {
          headers: { ...supaServiceHeaders(env), Prefer: 'count=exact' },
        });
        counts[t] = r.headers.get('content-range')?.split('/')?.[1] || '?';
      }
      checks.tables = { ok: true, counts, ms: Date.now() - t3 };
    } catch (e) {
      checks.tables = { ok: false, error: e.message, ms: Date.now() - t3 };
    }

    return json({ ok: true, checks, total_ms: Date.now() - t0 }, 200, request);
  }

  // POST /api/dev/purge-images — Ejecutar purga de imágenes manualmente
  if (sub === 'purge-images' && request.method === 'POST') {
    const result = await runPurgeTrackingImages(env);
    return json(result, 200, request);
  }

  // POST /api/dev/cleanup-cotizaciones — Ejecutar limpieza de cotizaciones manualmente
  if (sub === 'cleanup-cotizaciones' && request.method === 'POST') {
    const result = await runCleanupCotizaciones(env);
    return json(result, 200, request);
  }

  return jsonError('Endpoint no encontrado', 404, request);
}
