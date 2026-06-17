// src/services/pdf/inventarioPDF.js
// Genera PDF profesional de Reporte de Inventario Valorizado — formato Listo POS
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_RED, C_GRAY,
  drawPremiumHeader, drawSimplifiedHeader, drawPremiumFooter, checkPage, fmtUsd
} from './pdfShared'

// ─── Helpers locales ──────────────────────────────────────────────────────────
function fmtNum(n) {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// ─── Dibujar cabecera ────────────────────────────────────────────────────────
function drawHeader(doc, logoData, config, titulo) {
  return drawPremiumHeader({
    doc,
    logoData: LOGO_LISTA_PRECIOS,
    config,
    title: titulo,
    subtitle: new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }),
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true
  })
}

// ─── Generar Reporte de Inventario ──────────────────────────────────────────
export async function generarInventarioPDF({ reporte, config = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = LOGO_LISTA_PRECIOS

  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function(...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, 'Inventario (Cont.)', [255, 255, 255], [0, 0, 0])
  }

  let y = drawHeader(doc, logoData, config, 'Inventario Valorizado')

  // Watermark
  drawWatermark(doc)

  const { kpis, items, productosBajoStock, productosSinMov90, porCategoria } = reporte

  // ═══ KPIs ═══
  const kpiBoxW = kpis.esPrivilegiado ? CONTENT_W / 4 : CONTENT_W / 3
  const kpiBoxH = 18
  const kpiData = [
    { label: 'Total productos', value: String(kpis.totalProductos), color: C_PRIMARY },
    ...(kpis.esPrivilegiado ? [{ label: 'Valor a costo', value: fmtUsd(kpis.totalValorCosto), color: C_EMERALD }] : []),
    { label: 'Valor a precio venta', value: fmtUsd(kpis.totalValorVenta), color: kpis.esPrivilegiado ? C_AMBER : C_EMERALD },
    { label: 'Bajo stock', value: String(kpis.numBajoStock), color: C_RED },
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

  // ═══ Tabla principal por categoría ═══
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Resumen por Categoría', MARGIN, y + 4)
  y += 8

  const catCols = kpis.esPrivilegiado
    ? [
        { label: 'Categoría', x: MARGIN, w: 48 },
        { label: 'Productos', x: MARGIN + 48, w: 22 },
        { label: 'Stock', x: MARGIN + 70, w: 25 },
        { label: 'Valor Costo', x: MARGIN + 95, w: 30 },
        { label: 'Valor Venta', x: MARGIN + 125, w: 30 },
        { label: 'Margen', x: MARGIN + 155, w: 27 },
      ]
    : [
        { label: 'Categoría', x: MARGIN, w: 60 },
        { label: 'Productos', x: MARGIN + 60, w: 30 },
        { label: 'Stock', x: MARGIN + 90, w: 40 },
        { label: 'Valor Venta', x: MARGIN + 130, w: 52 },
      ]

  function drawCatHeader(yPos) {
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    catCols.forEach(col => doc.text(col.label, col.x + 1, yPos + 5))
    return yPos + 9
  }

  y = drawCatHeader(y)

  porCategoria.forEach((cat, idx) => {
    y = checkPage(doc, y, 8, null, doc.internal.getNumberOfPages() === 1 ? 35 : 20)
    if (y < MARGIN + 12) y = drawCatHeader(y)

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    doc.text((cat.categoria || '—').substring(0, 25), catCols[0].x + 1, y + 3)
    doc.text(String(cat.count), catCols[1].x + 1, y + 3)
    doc.text(fmtNum(cat.stockTotal), catCols[2].x + 1, y + 3)

    if (kpis.esPrivilegiado) {
      doc.text(fmtUsd(cat.valorCosto), catCols[3].x + 1, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(cat.valorVenta), catCols[4].x + 1, y + 3)
      // Margen
      const margen = cat.valorVenta > 0 && cat.valorCosto > 0
        ? ((cat.valorVenta - cat.valorCosto) / cat.valorVenta * 100).toFixed(1) + '%'
        : '—'
      doc.setTextColor(...(margen !== '—' ? C_EMERALD : C_GRAY))
      doc.text(margen, catCols[5].x + 1, y + 3)
    } else {
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(cat.valorVenta), catCols[3].x + 1, y + 3)
    }

    y += 6
  })

  // Línea total
  doc.setDrawColor(210, 215, 225)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('TOTAL', MARGIN + 1, y + 3)
  doc.text(String(items.length), catCols[1].x + 1, y + 3)
  if (kpis.esPrivilegiado) {
    doc.text(fmtUsd(kpis.totalValorCosto), catCols[3].x + 1, y + 3)
    doc.text(fmtUsd(kpis.totalValorVenta), catCols[4].x + 1, y + 3)
  } else {
    doc.text(fmtUsd(kpis.totalValorVenta), catCols[3].x + 1, y + 3)
  }
  y += 10

  // ═══ Productos con Stock Bajo ═══
  if (productosBajoStock.length > 0) {
    y = checkPage(doc, y, 20, null, doc.internal.getNumberOfPages() === 1 ? 35 : 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_RED)
    doc.text(`Productos con Stock Bajo (${productosBajoStock.length})`, MARGIN, y + 4)
    y += 8

    const bajoCols = [
      { label: 'Código', x: MARGIN, w: 24 },
      { label: 'Producto', x: MARGIN + 24, w: 68 },
      { label: 'Categoría', x: MARGIN + 92, w: 30 },
      { label: 'Stock', x: MARGIN + 122, w: 20 },
      { label: 'Mínimo', x: MARGIN + 142, w: 20 },
      { label: 'Déficit', x: MARGIN + 162, w: 20 },
    ]

    doc.setFillColor(254, 242, 242)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(127, 29, 29)
    bajoCols.forEach(col => doc.text(col.label, col.x + 1, y + 5))
    y += 9

    productosBajoStock.slice(0, 30).forEach((p, idx) => {
      y = checkPage(doc, y, 7, null, doc.internal.getNumberOfPages() === 1 ? 35 : 20)
      if (idx % 2 === 0) {
        doc.setFillColor(255, 249, 249)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...C_DARK)
      doc.text((p.codigo || '—').substring(0, 12), bajoCols[0].x + 1, y + 3)
      doc.text((p.nombre || '—').substring(0, 35), bajoCols[1].x + 1, y + 3)
      doc.text((p.categoria || '—').substring(0, 15), bajoCols[2].x + 1, y + 3)
      doc.text(fmtNum(p.stock_actual), bajoCols[3].x + 1, y + 3)
      doc.text(fmtNum(p.stock_minimo), bajoCols[4].x + 1, y + 3)
      doc.setTextColor(...C_RED)
      doc.setFont('helvetica', 'bold')
      const deficit = Number(p.stock_minimo) - Number(p.stock_actual)
      doc.text(fmtNum(deficit > 0 ? deficit : 0), bajoCols[5].x + 1, y + 3)
      y += 6
    })
    y += 6
  }

  // ═══ Productos sin Movimiento (90+ días) ═══
  if (productosSinMov90.length > 0) {
    y = checkPage(doc, y, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_AMBER)
    doc.text(`Productos sin Movimiento 90+ días (${productosSinMov90.length})`, MARGIN, y + 4)
    y += 8

    const sinMovCols = [
      { label: 'Código', x: MARGIN, w: 24 },
      { label: 'Producto', x: MARGIN + 24, w: 60 },
      { label: 'Categoría', x: MARGIN + 84, w: 30 },
      { label: 'Stock', x: MARGIN + 114, w: 20 },
      { label: 'Valor USD', x: MARGIN + 134, w: 28 },
      { label: 'Días', x: MARGIN + 162, w: 20 },
    ]

    doc.setFillColor(255, 251, 235)
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(113, 63, 18)
    sinMovCols.forEach(col => doc.text(col.label, col.x + 1, y + 5))
    y += 9

    productosSinMov90.sort((a, b) => b.valorVenta - a.valorVenta).slice(0, 30).forEach((p, idx) => {
      y = checkPage(doc, y, 7, null, doc.internal.getNumberOfPages() === 1 ? 35 : 20)
      if (idx % 2 === 0) {
        doc.setFillColor(255, 252, 245)
        doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...C_DARK)
      doc.text((p.codigo || '—').substring(0, 12), sinMovCols[0].x + 1, y + 3)
      doc.text((p.nombre || '—').substring(0, 30), sinMovCols[1].x + 1, y + 3)
      doc.text((p.categoria || '—').substring(0, 15), sinMovCols[2].x + 1, y + 3)
      doc.text(fmtNum(p.stock_actual), sinMovCols[3].x + 1, y + 3)
      doc.setFont('helvetica', 'bold')
      doc.text(fmtUsd(p.valorVenta), sinMovCols[4].x + 1, y + 3)
      doc.setTextColor(...C_AMBER)
      doc.text(String(p.diasSinMov >= 999 ? '90+' : p.diasSinMov), sinMovCols[5].x + 1, y + 3)
      y += 6
    })
  }

  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0])
  doc.save(`Inventario_Valorizado_${new Date().toISOString().slice(0, 10)}.pdf`)
}
