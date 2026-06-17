// src/services/pdf/liquidacionPDF.js
// PDF profesional de Liquidación de Ventas y Comisiones — Listo POS
// Orientación HORIZONTAL (landscape) para mostrar todos los datos sin truncar
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_GRAY,
  fmtUsd, fmtFechaCorta,
  hexToRgb, drawWatermark, checkPage, drawPremiumHeader
} from './pdfShared'

// ─── Dimensiones landscape letter ─────────────────────────────────────────────
const L_W = 279   // ancho en landscape (mm)
const L_H = 216   // alto en landscape  (mm)
const L_M = 12    // margen
const L_CW = L_W - L_M * 2  // ancho de contenido = 255 mm

// ─── Helpers locales ──────────────────────────────────────────────────────────

function parsePago(pago) {
  if (!pago) return '—'
  try {
    const p = typeof pago === 'string' ? JSON.parse(pago) : pago
    if (Array.isArray(p)) {
      return p.map(x => {
        const m = x.metodo || x.method || ''
        const v = x.monto  || x.amount || 0
        return v > 0 ? `${m}: $${Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : m
      }).filter(Boolean).join(' + ') || '—'
    }
  } catch (_) {}
  return String(pago)
}

// ─── checkPage adaptado a landscape ──────────────────────────────────────────
function checkPageL(doc, y, needed = 10) {
  if (y + needed > L_H - 18) {
    doc.addPage()
    return L_M + 12
  }
  return y
}

// ─── Cabecera ─────────────────────────────────────────────────────────────────
async function dibujarCabecera(doc, config, logoData, subtitulo, rangoStr) {
  return drawPremiumHeader({
    doc,
    logoData,
    config,
    title: subtitulo,
    subtitle: rangoStr
  })
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function dibujarFooters(doc, config) {
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_PRIMARY); doc.setLineWidth(0.5)
    doc.line(L_M, L_H - 12, L_M + L_CW, L_H - 12)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...C_GRAY)
    let footName = config.nombre_negocio || 'Listo POS C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Listo POS C.A.'
    doc.text(footName, L_M, L_H - 7)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, L_M, L_H - 4)
    doc.text(`Página ${p} de ${totalPages}`, L_W - L_M, L_H - 7, { align: 'right' })
    if (config.pie_pagina_pdf) doc.text(config.pie_pagina_pdf, L_W / 2, L_H - 4, { align: 'center' })
  }
}

// ─── Columnas de la tabla de detalle (landscape: 255 mm disponibles) ─────────
// Fecha(16) + NºDesp(18) + Cliente(28) + Producto(60) + Cant(10) + Total$(22)
// + Com%(10) + Com$(20) + Tasa(20) + ComBs(22) + Estado(14) + Pago(15) = 255 ✓
const COLS = [
  { label: 'Fecha',    x: L_M,        w: 16 },
  { label: 'Nº Desp.', x: L_M + 16,  w: 18 },
  { label: 'Cliente',  x: L_M + 34,  w: 28 },
  { label: 'Producto', x: L_M + 62,  w: 62 },
  { label: 'Cant.',    x: L_M + 124, w: 10 },
  { label: 'Total $',  x: L_M + 134, w: 22 },
  { label: 'Com%',     x: L_M + 156, w: 11 },
  { label: 'Com $',    x: L_M + 167, w: 20 },
  { label: 'Tasa',     x: L_M + 187, w: 20 },
  { label: 'Com Bs',   x: L_M + 207, w: 25 },
  { label: 'Estado',   x: L_M + 232, w: 16 },
]

function drawDetalleHeader(doc, y) {
  doc.setFillColor(240, 242, 245)
  doc.rect(L_M, y, L_CW, 7, 'F')
  doc.setDrawColor(210, 215, 225); doc.setLineWidth(0.3)
  doc.line(L_M, y + 7, L_M + L_CW, y + 7)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(80, 90, 110)
  COLS.forEach(col => doc.text(col.label, col.x + 1, y + 5))
  return y + 9
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════
export async function generarLiquidacionPDF({ data, range, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' })
  const logoData = await cargarLogo(config.logo_url)

  const { kpis, porAsesor } = data
  const rangoStr = `${range.from}  al  ${range.to}`

  // ── Portada: cabecera + KPIs + resumen por asesor ──────────────────────────
  let y = await dibujarCabecera(doc, config, logoData, 'Liquidación de Comisiones', rangoStr)
  drawWatermark(doc)

  // KPIs — 4 cajas
  const kpiBoxW = L_CW / 4
  const kpiBoxH = 17
  const kpisData = [
    { label: 'Total Ventas',   value: fmtUsd(kpis.totalVentas),     color: C_PRIMARY },
    { label: 'Total Comisión', value: fmtUsd(kpis.totalComisiones), color: [4, 120, 87] },
    { label: 'Por Pagar',      value: fmtUsd(kpis.totalPendiente),  color: kpis.totalPendiente > 0 ? [185, 28, 28] : [4, 120, 87] },
    { label: 'Ya Pagado',      value: fmtUsd(kpis.totalPagado),     color: C_EMERALD },
  ]
  kpisData.forEach((kpi, i) => {
    const bx = L_M + i * kpiBoxW
    doc.setFillColor(...kpi.color)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...C_WHITE)
    doc.text(kpi.label, bx + 3, y + 5)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(kpi.value, bx + 3, y + 13)
  })
  y += kpiBoxH + 8

  // Resumen por asesor
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C_DARK)
  doc.text('Resumen por Asesor', L_M, y + 4)
  y += 8

  const RES_COLS = { asesor: L_M + 7, ventas: L_M + 110, comision: L_M + 148, porPagar: L_M + 186, pagado: L_M + 220 }

  const drawResumenHeader = () => {
    doc.setFillColor(240, 242, 245); doc.rect(L_M, y, L_CW, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(80, 90, 110)
    doc.text('Asesor',          RES_COLS.asesor, y + 5)
    doc.text('Ventas USD',      RES_COLS.ventas, y + 5)
    doc.text('Comisión Total',  RES_COLS.comision, y + 5)
    doc.text('Por Pagar',       RES_COLS.porPagar, y + 5)
    doc.text('Ya Pagado',       RES_COLS.pagado, y + 5)
  }
  drawResumenHeader(); y += 9

  porAsesor.forEach((g, idx) => {
    y = checkPageL(doc, y, 7)
    if (idx % 2 === 0) { doc.setFillColor(252, 252, 253); doc.rect(L_M, y - 1, L_CW, 6, 'F') }
    const aColor = hexToRgb(g.color || '#1B365D')
    doc.setFillColor(...aColor); doc.circle(L_M + 3.5, y + 2, 2, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C_DARK)
    doc.text((g.asesor || '—').substring(0, 35), RES_COLS.asesor, y + 3.5)
    doc.setFont('helvetica', 'normal')
    doc.text(fmtUsd(g.totalVentas), RES_COLS.ventas, y + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(g.totalComisiones), RES_COLS.comision, y + 3.5)
    doc.setTextColor(...(g.totalPendiente > 0 ? C_AMBER : C_EMERALD))
    doc.text(fmtUsd(g.totalPendiente), RES_COLS.porPagar, y + 3.5)
    doc.setTextColor(...C_EMERALD)
    doc.text(fmtUsd(g.totalPagado), RES_COLS.pagado, y + 3.5)
    y += 6
  })

  // Fila totales
  doc.setDrawColor(210, 215, 225); doc.setLineWidth(0.3)
  doc.line(L_M, y, L_M + L_CW, y); y += 2
  doc.setFillColor(...C_DARK); doc.rect(L_M, y, L_CW, 7, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C_WHITE)
  doc.text('TOTAL GENERAL', L_M + 3, y + 5)
  doc.text(fmtUsd(kpis.totalVentas),     RES_COLS.ventas, y + 5)
  doc.text(fmtUsd(kpis.totalComisiones), RES_COLS.comision, y + 5)
  doc.text(fmtUsd(kpis.totalPendiente),  RES_COLS.porPagar, y + 5)
  doc.text(fmtUsd(kpis.totalPagado),     RES_COLS.pagado, y + 5)
  y += 12

  // ══ DETALLE por asesor ═════════════════════════════════════════════════════
  for (const grupo of porAsesor) {
    y = checkPageL(doc, y, 30)
    drawWatermark(doc)

    // Barra de color del asesor
    const aColor = hexToRgb(grupo.color || '#1B365D')
    doc.setFillColor(...aColor)
    doc.roundedRect(L_M, y, 4, 10, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C_DARK)
    doc.text(grupo.asesor || '—', L_M + 7, y + 7)

    // Resumen a la derecha
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C_GRAY)
    const resumen = [
      `${grupo.items.length} despacho${grupo.items.length !== 1 ? 's' : ''}`,
      `Ventas: ${fmtUsd(grupo.totalVentas)}`,
      `Com: ${fmtUsd(grupo.totalComisiones)}`,
      grupo.totalPendiente > 0 ? `Por pagar: ${fmtUsd(grupo.totalPendiente)}` : '✓ Todo pagado',
    ].join('   ')
    doc.text(resumen, L_W - L_M, y + 7, { align: 'right' })
    y += 13

    y = drawDetalleHeader(doc, y)

    // Filas de transacciones
    grupo.items.forEach((r, idx) => {
      const rowH = 6.5
      y = checkPageL(doc, y, rowH + 2)
      if (y < L_M + 12) { drawWatermark(doc); y = drawDetalleHeader(doc, y) }

      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(L_M, y - 0.5, L_CW, rowH, 'F')
      }

      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C_DARK)

      doc.text(fmtFechaCorta(r.fecha),                              COLS[0].x + 1, y + 3.5)
      const numDesp = r.despacho_numero ? `DES-${String(r.despacho_numero).padStart(5, '0')}` : '—'
      doc.text(numDesp,                                             COLS[1].x + 1, y + 3.5)
      doc.text((r.cliente || '—').substring(0, 16),                COLS[2].x + 1, y + 3.5)
      // Producto — sin truncar en landscape (60mm de ancho = ~50 chars a 6.5pt)
      doc.text((r.descripcion || '—').substring(0, 52),            COLS[3].x + 1, y + 3.5)
      doc.text(String(Number(r.cantidad || 0)),                     COLS[4].x + 1, y + 3.5)

      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(r.total),                                     COLS[5].x + 1, y + 3.5)

      doc.setFont('helvetica', 'normal'); doc.setTextColor(...C_GRAY)
      doc.text(`${Number(r.comision_pct || 0)}%`,                   COLS[6].x + 1, y + 3.5)

      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C_EMERALD)
      doc.text(fmtUsd(r.total_com),                                 COLS[7].x + 1, y + 3.5)

      // Tasa
      doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 90, 110)
      const tasaStr = r.tasa
        ? Number(r.tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—'
      doc.text(tasaStr,                                             COLS[8].x + 1, y + 3.5)

      // Com Bs = comisión × tasa
      doc.setFont('helvetica', 'bold'); doc.setTextColor(67, 56, 202)
      const comBs = (r.total_com && r.tasa) ? Number(r.total_com) * Number(r.tasa) : null
      const bsStr = comBs
        ? `Bs ${comBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '—'
      doc.text(bsStr,                                               COLS[9].x + 1, y + 3.5)

      // Estado
      const esPagada = r.estado_comision === 'pagada'
      doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5)
      doc.setTextColor(...(esPagada ? C_EMERALD : C_AMBER))
      doc.text(esPagada ? 'Pagada' : 'Pendiente',                   COLS[10].x + 1, y + 3.5)

      y += rowH
    })

    // Subtotal del asesor
    doc.setDrawColor(210, 215, 225); doc.setLineWidth(0.3)
    doc.line(L_M, y, L_M + L_CW, y); y += 1.5
    doc.setFillColor(245, 247, 250); doc.rect(L_M, y, L_CW, 6.5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...C_GRAY)
    doc.text(`SUBTOTAL — ${grupo.asesor}`, L_M + 3, y + 4.5)
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(grupo.totalVentas),     COLS[5].x + 1, y + 4.5)
    doc.setTextColor(...C_EMERALD)
    doc.text(fmtUsd(grupo.totalComisiones), COLS[7].x + 1, y + 4.5)
    y += 10
  }

  dibujarFooters(doc, config)

  const hoy = new Date().toISOString().slice(0, 10)
  doc.save(`Liquidacion_${range.from}_${range.to}_${hoy}.pdf`)
}
