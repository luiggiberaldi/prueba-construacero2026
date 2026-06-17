// src/services/pdf/pipelinePDF.js
// Genera PDF profesional de Reporte de Pipeline de Cotizaciones — formato Listo POS
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_RED, C_GRAY,
  drawPremiumHeader, fmtFechaCorta
} from './pdfShared'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return [5, 8, 52]
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
}

const ESTADO_COLORS = {
  borrador:  [148, 163, 184],
  enviada:   [59, 130, 246],
  aceptada:  [16, 185, 129],
  rechazada: [239, 68, 68],
  vencida:   [245, 158, 11],
  anulada:   [107, 114, 128],
}

function checkPage(doc, y, needed = 30) {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
    try {
      const gState = new doc.GState({ opacity: 0.06 })
      doc.setGState(gState)
      doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
      doc.setGState(new doc.GState({ opacity: 1 }))
    } catch (_) {}
    return MARGIN + 10
  }
  return y
}

// ─── Generar Reporte de Pipeline ────────────────────────────────────────────
export async function generarPipelinePDF({ reporte, rango, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  let y = 0

  // ═══ CABECERA ═══
  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Pipeline de Cotizaciones',
    subtitle: `${rango.from} — ${rango.to}`
  })

  // Watermark
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  const { kpis, porEstado, aging, porVendedor, topPendientes } = reporte

  // ═══ KPIs ═══
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 18
  const kpiData = [
    { label: 'Total cotizaciones', value: String(kpis.totalCotizaciones), color: C_PRIMARY },
    { label: 'Valor pipeline', value: fmtUsd(kpis.valorPipeline), color: C_AMBER },
    { label: 'Tasa de conversión', value: `${kpis.tasaConversion.toFixed(1)}%`, color: C_EMERALD },
    { label: 'Enviadas pendientes', value: String(kpis.enviadasPendientes), color: C_RED },
  ]

  kpiData.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2])
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    doc.text(kpi.label, bx + 4, y + 5.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(kpi.value, bx + 4, y + 13)
  })
  y += kpiBoxH + 8

  // ═══ Por Estado ═══
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Cotizaciones por Estado', MARGIN, y + 4)
  y += 8

  const totalCots = porEstado.reduce((s, e) => s + e.count, 0) || 1
  porEstado.forEach(e => {
    if (e.count === 0) return
    y = checkPage(doc, y, 10)
    const pct = ((e.count / totalCots) * 100).toFixed(1)
    const eColor = ESTADO_COLORS[e.estado] || C_GRAY

    // Indicador de color
    doc.setFillColor(eColor[0], eColor[1], eColor[2])
    doc.roundedRect(MARGIN, y, 3, 5, 1, 1, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    const label = e.estado.charAt(0).toUpperCase() + e.estado.slice(1)
    doc.text(label, MARGIN + 6, y + 3.5)

    doc.setFont('helvetica', 'normal')
    doc.text(`${e.count} cot.`, MARGIN + 35, y + 3.5)
    doc.text(`${pct}%`, MARGIN + 58, y + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(e.totalUsd), MARGIN + 78, y + 3.5)

    // Barra
    const barX = MARGIN + 110
    const barW = CONTENT_W - 110
    doc.setFillColor(230, 233, 240)
    doc.roundedRect(barX, y + 0.5, barW, 4, 1, 1, 'F')
    const fillW = barW * (Number(pct) / 100)
    if (fillW > 0) {
      doc.setFillColor(eColor[0], eColor[1], eColor[2])
      doc.roundedRect(barX, y + 0.5, Math.max(fillW, 2), 4, 1, 1, 'F')
    }
    y += 8
  })
  y += 4

  // ═══ Aging de Cotizaciones Enviadas ═══
  if (aging.some(a => a.count > 0)) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Antigüedad — Cotizaciones Enviadas sin Respuesta', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Rango', MARGIN + 2, y + 5)
    doc.text('Cotizaciones', MARGIN + 50, y + 5)
    doc.text('Monto Total', MARGIN + 90, y + 5)
    y += 9

    const agingColors = [C_EMERALD, C_AMBER, C_AMBER, C_RED]
    aging.forEach((a, idx) => {
      if (a.count === 0) return
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(a.rango, MARGIN + 2, y + 3)
      doc.text(String(a.count), MARGIN + 55, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...agingColors[idx])
      doc.text(fmtUsd(a.totalUsd), MARGIN + 90, y + 3)
      y += 6
    })
    y += 6
  }

  // ═══ Por Vendedor ═══
  if (porVendedor.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Pipeline por Vendedor', MARGIN, y + 4)
    y += 8

    const vCols = [
      { label: 'Vendedor', x: MARGIN, w: 35 },
      { label: 'Borr.', x: MARGIN + 35, w: 16 },
      { label: 'Env.', x: MARGIN + 51, w: 16 },
      { label: 'Acept.', x: MARGIN + 67, w: 16 },
      { label: 'Rech.', x: MARGIN + 83, w: 16 },
      { label: 'Venc.', x: MARGIN + 99, w: 16 },
      { label: 'Anul.', x: MARGIN + 115, w: 16 },
      { label: 'Total USD', x: MARGIN + 131, w: 51 },
    ]

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(80, 90, 110)
    vCols.forEach(col => doc.text(col.label, col.x + 1, y + 5))
    y += 9

    porVendedor.forEach((v, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }

      if (v.color) {
        const vc = hexToRgb(v.color)
        doc.setFillColor(vc[0], vc[1], vc[2])
        doc.circle(MARGIN + 3, y + 2, 1.5, 'F')
      }

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
      doc.text((v.nombre || '—').substring(0, 18), MARGIN + 7, y + 3)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.text(String(v.borrador || 0), vCols[1].x + 1, y + 3)
      doc.text(String(v.enviada || 0), vCols[2].x + 1, y + 3)
      doc.setTextColor(...C_EMERALD)
      doc.text(String(v.aceptada || 0), vCols[3].x + 1, y + 3)
      doc.setTextColor(...C_RED)
      doc.text(String(v.rechazada || 0), vCols[4].x + 1, y + 3)
      doc.setTextColor(...C_AMBER)
      doc.text(String(v.vencida || 0), vCols[5].x + 1, y + 3)
      doc.setTextColor(...C_GRAY)
      doc.text(String(v.anulada || 0), vCols[6].x + 1, y + 3)
      doc.setTextColor(...C_DARK)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(v.totalUsd), vCols[7].x + 1, y + 3)
      y += 6
    })
    y += 6
  }

  // ═══ Top Cotizaciones Pendientes ═══
  if (topPendientes.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Cotizaciones Enviadas sin Respuesta (más antiguas)', MARGIN, y + 4)
    y += 8

    const tpCols = [
      { label: '#', x: MARGIN, w: 12 },
      { label: 'Cliente', x: MARGIN + 12, w: 48 },
      { label: 'Vendedor', x: MARGIN + 60, w: 32 },
      { label: 'Total USD', x: MARGIN + 92, w: 30 },
      { label: 'Enviada', x: MARGIN + 122, w: 24 },
      { label: 'Días', x: MARGIN + 146, w: 18 },
    ]

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    tpCols.forEach(col => doc.text(col.label, col.x + 1, y + 5))
    y += 9

    topPendientes.forEach((c, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...C_DARK)
      doc.text(`${c.numero}`, tpCols[0].x + 1, y + 3)
      doc.text(c.cliente.substring(0, 25), tpCols[1].x + 1, y + 3)

      if (c.vendedorColor) {
        const vc = hexToRgb(c.vendedorColor)
        doc.setFillColor(vc[0], vc[1], vc[2])
        doc.circle(tpCols[2].x + 2, y + 2, 1, 'F')
      }
      doc.text(c.vendedor.substring(0, 16), tpCols[2].x + 5, y + 3)

      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(c.totalUsd), tpCols[3].x + 1, y + 3)
      doc.setFont('helvetica', 'normal')
      doc.text(fmtFechaCorta(c.enviada), tpCols[4].x + 1, y + 3)

      // Días con color
      const diasColor = c.dias > 30 ? C_RED : c.dias > 15 ? C_AMBER : C_EMERALD
      doc.setTextColor(...diasColor)
      doc.setFont('helvetica', 'bold')
      doc.text(String(c.dias), tpCols[5].x + 1, y + 3)
      y += 6
    })
  }

  // ═══ FOOTER ═══
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    let footName = config.nombre_negocio || 'Listo POS C.A.'
    if (footName.trim().toUpperCase() === 'PRUEBA' || footName.trim() === '') footName = 'Listo POS C.A.'
    doc.text(footName, MARGIN, PAGE_H - 10)
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 10, { align: 'right' })
  }

  doc.save(`Pipeline_Cotizaciones_${rango.from}_${rango.to}.pdf`)
}
