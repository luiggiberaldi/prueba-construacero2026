// src/utils/format.js
// Funciones compartidas de formateo

export function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtUsdSimple(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtBs(n) {
  if (n == null || isNaN(n)) return 'Bs 0,00'
  return `Bs ${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function usdToBs(usd, tasa) {
  if (!usd || !tasa) return 0
  return Number(usd) * Number(tasa)
}

export function fmtFecha(f) {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtFechaHora(f) {
  if (!f) return '—'
  return new Date(f).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtFechaLarga(f) {
  if (!f) return '—'
  const d = new Date(f)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return d.toLocaleString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) + ` (${tz})`
}

// Sanitiza una cadena de búsqueda para uso seguro en filtros PostgREST .or()
export function sanitizePostgrestSearch(str) {
  if (!str) return ''
  // Escapar caracteres especiales de PostgREST: . , ( ) \
  return str.trim().replace(/[.,()\\%_]/g, '')
}

export function fmtTelefono(tel) {
  if (!tel) return ''
  const t = String(tel).trim()
  if (t.startsWith('+58')) {
    const num = t.slice(3).replace(/[^\d]/g, '')
    if (num.length === 10) return `0${num.slice(0, 3)}-${num.slice(3)}`
    return `0${num}`
  }
  return t
}

export function removeAccents(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
