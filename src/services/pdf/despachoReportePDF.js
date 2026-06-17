// src/services/pdf/despachoReportePDF.js
// Genera PDF profesional de Reporte de Despachos y Cobranza — formato Listo POS
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_RED, C_GRAY,
  fmtUsd,
  hexToRgb, drawWatermark, checkPage, drawPremiumHeader, drawSimplifiedHeader, drawPremiumFooter,
} from './pdfShared'

// ─── Colores específicos de este reporte ────────────────────────────────────
const ESTADO_COLORS = {
  pendiente:   C_AMBER,
  despachada:  C_PRIMARY,
  entregada:   C_EMERALD,
  anulada:     C_GRAY,
}

const FP_COLORS = {
  'Efectivo $':       [16, 185, 129],
  'Efectivo Bs':      [34, 197, 94],
  'Zelle':            [59, 130, 246],
  'Transf. / Pago Móvil': [20, 184, 166],
  'USDT':             [245, 158, 11],
  'Punto de Venta':   [6, 182, 212],
  'Cruce':            [236, 72, 153],
  'Cta por cobrar':   [239, 68, 68],
  'Sin especificar':  [148, 163, 184],
}

// ─── Generar Reporte de Despachos ───────────────────────────────────────────
export async function generarDespachoReportePDF({ reporte, rango, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = LOGO_LISTA_PRECIOS

  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function(...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, 'Despachos y Cobranza (Cont.)', [255, 255, 255], [0, 0, 0])
  }

  let y = 0

  // ═══ CABECERA ═══
  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Despachos y Cobranza',
    subtitle: `${rango.from} — ${rango.to}`,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true
  })

  // Watermark
  drawWatermark(doc)

  const { kpis, porEstado, porFormaPago, aging, porVendedor, topClientesPendientes } = reporte

  // ═══ KPIs ═══
  const kpiBoxW = CONTENT_W / 4
  const kpiBoxH = 18
  const kpiData = [
    { label: 'Total despachos', value: String(kpis.totalDespachos), color: C_PRIMARY },
    { label: 'Entregados', value: String(kpis.numEntregados), sub: fmtUsd(kpis.montoEntregado), color: C_EMERALD },
    { label: 'Pendientes', value: String(kpis.numPendientes), sub: fmtUsd(kpis.montoPendiente), color: C_AMBER },
    { label: 'Monto pendiente', value: fmtUsd(kpis.montoPendiente), color: C_RED },
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
    if (kpi.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.text(kpi.sub, bx + 4, y + 16.5)
    }
  })
  y += kpiBoxH + 8

  // ═══ Por Estado ═══
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Despachos por Estado', MARGIN, y + 4)
  y += 8

  const totalDesp = porEstado.reduce((s, e) => s + e.count, 0) || 1
  porEstado.forEach(e => {
    if (e.count === 0) return
    y = checkPage(doc, y, 10, null, doc.internal.getNumberOfPages() === 1 ? 35 : 20)
    const pct = ((e.count / totalDesp) * 100).toFixed(1)
    const eColor = ESTADO_COLORS[e.estado] || C_GRAY

    doc.setFillColor(eColor[0], eColor[1], eColor[2])
    doc.roundedRect(MARGIN, y, 3, 5, 1, 1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    const label = e.estado.charAt(0).toUpperCase() + e.estado.slice(1)
    doc.text(label, MARGIN + 6, y + 3.5)
    doc.setFont('helvetica', 'normal')
    doc.text(`${e.count} desp.`, MARGIN + 35, y + 3.5)
    doc.text(`${pct}%`, MARGIN + 58, y + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUsd(e.totalUsd), MARGIN + 78, y + 3.5)

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

  // ═══ Formas de Pago ═══
  if (porFormaPago.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Formas de Pago', MARGIN, y + 4)
    y += 8

    const fpTotal = porFormaPago.reduce((s, fp) => s + fp.totalUsd, 0)
    porFormaPago.forEach(fp => {
      y = checkPage(doc, y, 10, null, doc.internal.getNumberOfPages() === 1 ? 35 : 20)
      const pct = fpTotal > 0 ? ((fp.totalUsd / fpTotal) * 100).toFixed(1) : '0.0'
      const color = FP_COLORS[fp.formaPago] || C_GRAY

      doc.setFillColor(color[0], color[1], color[2])
      doc.roundedRect(MARGIN, y, 3, 5, 1, 1, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text(`${fp.formaPago} (${fp.count} desp.)`, MARGIN + 6, y + 3.5)
      doc.text(`${pct}%`, MARGIN + 70, y + 3.5)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(fp.totalUsd), MARGIN + 88, y + 3.5)

      const barX = MARGIN + 120
      const barW = CONTENT_W - 120
      doc.setFillColor(230, 233, 240)
      doc.roundedRect(barX, y + 0.5, barW, 4, 1, 1, 'F')
      const fillW = barW * (Number(pct) / 100)
      if (fillW > 0) {
        doc.setFillColor(color[0], color[1], color[2])
        doc.roundedRect(barX, y + 0.5, Math.max(fillW, 2), 4, 1, 1, 'F')
      }
      y += 8
    })
    y += 4
  }

  // ═══ Aging de Pendientes ═══
  if (aging.some(a => a.count > 0)) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Antigüedad — Despachos Pendientes', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Rango', MARGIN + 2, y + 5)
    doc.text('Despachos', MARGIN + 50, y + 5)
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
    doc.text('Despachos por Vendedor', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Vendedor', MARGIN + 2, y + 5)
    doc.text('Total', MARGIN + 50, y + 5)
    doc.text('Entregados', MARGIN + 68, y + 5)
    doc.text('Pendientes', MARGIN + 95, y + 5)
    doc.text('Ventas USD', MARGIN + 120, y + 5)
    doc.text('Pend. USD', MARGIN + 150, y + 5)
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
      doc.text((v.nombre || '—').substring(0, 20), MARGIN + 7, y + 3)
      doc.setFont('helvetica', 'normal')
      doc.text(String(v.despachos), MARGIN + 53, y + 3)
      doc.setTextColor(...C_EMERALD)
      doc.text(String(v.entregados), MARGIN + 73, y + 3)
      doc.setTextColor(...C_AMBER)
      doc.text(String(v.pendientes), MARGIN + 100, y + 3)
      doc.setTextColor(...C_DARK)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(v.totalUsd), MARGIN + 120, y + 3)
      doc.setTextColor(...C_RED)
      doc.text(fmtUsd(v.montoPendiente), MARGIN + 150, y + 3)
      y += 6
    })
    y += 6
  }

  // ═══ Top Clientes con Monto Pendiente ═══
  if (topClientesPendientes.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('Clientes con Mayor Monto Pendiente', MARGIN, y + 4)
    y += 8

    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Cliente', MARGIN + 2, y + 5)
    doc.text('Despachos pend.', MARGIN + 90, y + 5)
    doc.text('Monto Pendiente', MARGIN + 130, y + 5)
    y += 9

    topClientesPendientes.forEach((c, idx) => {
      y = checkPage(doc, y, 7)
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)
      doc.text((c.nombre || '—').substring(0, 40), MARGIN + 2, y + 3)
      doc.text(String(c.count), MARGIN + 98, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...C_RED)
      doc.text(fmtUsd(c.totalUsd), MARGIN + 130, y + 3)
      y += 6
    })
  }

  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0])

  doc.save(`Despachos_Cobranza_${rango.from}_${rango.to}.pdf`)
}
