// api/lib/utils.js

// ── Allowed origins for CORS ──────────────────────────────────────────────────
export const ALLOWED_ORIGINS = new Set([
  'https://listo-pos-cotizaciones.camelai.app',
  'https://listo-pos-cotizaciones.apps.camelai.dev',
  'https://listo-pos-cotizaciones-nqb5ge.apps.camelai.dev',
  'https://listo-pos-cotizaciones.vercel.app',
  // Desarrollo local
  'http://localhost:5173',
  'http://localhost:4173',
])

export function getAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || ''
  // Allow same-origin requests (no Origin header)
  if (!origin) return null
  // Only exact matches — no wildcards
  return ALLOWED_ORIGINS.has(origin) ? origin : null
}

export function corsHeaders(request) {
  const origin = getAllowedOrigin(request)
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Operator-Id',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

// ── Simple in-memory rate limiter (per-isolate, best-effort) ──────────────────
export const rateLimitMap = new Map()
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX = 30 // max requests per minute per IP for admin endpoints

export function isRateLimited(ip) {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 })
    return false
  }
  entry.count++
  if (entry.count > RATE_LIMIT_MAX) return true
  return false
}

// ── Email validation ──────────────────────────────────────────────────────────
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim())
}

// UUID v4 format validation
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isValidUuid(str) {
  return typeof str === 'string' && UUID_RE.test(str)
}

// ── Sanitize search input for PostgREST ilike ─────────────────────────────────
export function sanitizeSearch(input) {
  if (typeof input !== 'string') return ''
  return input.replace(/[%_\\'"()]/g, '').trim()
}

// ── HTTP Response Helpers ─────────────────────────────────────────────────────
export function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(request ? corsHeaders(request) : {}),
    },
  });
}

export function jsonError(message, status = 400, request = null) {
  return json({ error: message }, status, request);
}

export function removeAccents(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
