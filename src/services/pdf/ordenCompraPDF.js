// src/services/pdf/ordenCompraPDF.js
// Genera PDF de Orden de Compra — sin driver, sin BCV, sin firmas de validación
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE, C_PRIMARY,
  fmtPrecio, fmtFecha, fmtTelefono,
  drawWatermark, drawAnuladaWatermark,
} from './pdfShared'

export async function generarOrdenCompraPDF({ orden, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  let y = 0
  const numOC = `OC-${String(orden.numero).padStart(5, '0')}`
  let pageNum = 1

  const drawHeader = (doc, num) => {
    const HDR_H = 20
    try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) {}
    const centerX = PAGE_W / 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...C_DARK)
    let n = config.nombre_negocio || 'Listo POS C.A.'
    if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'Listo POS C.A.'
    doc.text(n.toUpperCase(), centerX, 16, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    let r = config.rif_negocio ? `RIF: ${config.rif_negocio}` : ''
    doc.text(r, centerX, 22, { align: 'center' })
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, HDR_H + 10, PAGE_W - MARGIN, HDR_H + 10)
    return HDR_H + 17
  }

  y = drawHeader(doc, numOC)

  // ── Marca de agua central ──
  drawWatermark(doc)
  if (orden.estado === 'anulada') {
    drawAnuladaWatermark(doc)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL PROVEEDOR
  // ══════════════════════════════════════════════════════════════════════════
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = orden.fecha_emision ? new Date(orden.fecha_emision) : new Date()
  const diaNombre = diasSemana[fechaObj.getDay()]

  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  // ── Fila 1-3: Header con título y datos ──
  const gY = y - 4
  const rowH = 7
  const leftColW = 38
  const rightLblW = 22
  const rightValW = 38
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW

  // Celda izquierda: DEPARTAMENTO DE COMPRAS
  const tripleH = rowH * 3
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE COMPRAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central: ORDEN DE COMPRA
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('ORDEN DE COMPRA', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: OC Correlativo
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('N° OC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(numOC, rValX + rightValW / 2, gY + rowH / 2 + 1, { align: 'center' })

  // Fila 2: DIA
  const f2Y = gY + rowH
  doc.rect(rLblX, f2Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('DIA', rLblX + rightLblW / 2, f2Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f2Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(diaNombre, rValX + rightValW / 2, f2Y + rowH / 2 + 1, { align: 'center' })

  // Fila 3: FECHA EMISIÓN
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('FECHA:', rLblX + rightLblW / 2, f3Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f3Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(fmtFecha(orden.fecha_emision), rValX + rightValW / 2, f3Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 4: PROVEEDOR + RIF ──
  const f4Y = gY + tripleH
  const provLblW = 25
  const rifLblW = 22
  const rifValW = 38
  const provValW = CONTENT_W - provLblW - rifLblW - rifValW

  doc.rect(MARGIN, f4Y, provLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('PROVEEDOR:', MARGIN + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + provLblW, f4Y, provValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const proveedorNombre = (orden.proveedor_nombre || '—').toUpperCase()
  const maxProvW = provValW - 4
  let pNombre = proveedorNombre
  if (doc.getTextWidth(pNombre) > maxProvW) {
    while (pNombre.length > 1 && doc.getTextWidth(pNombre + '…') > maxProvW) pNombre = pNombre.slice(0, -1)
    pNombre += '…'
  }
  doc.text(pNombre, MARGIN + provLblW + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + provLblW + provValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('R.I.F.,C.I.', MARGIN + provLblW + provValW + rifLblW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  doc.rect(MARGIN + provLblW + provValW + rifLblW, f4Y, rifValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(orden.proveedor_rif || '—', MARGIN + provLblW + provValW + rifLblW + rifValW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 5: DIRECCIÓN (altura dinámica para texto largo) ──
  const f5Y = f4Y + rowH
  const dirLblW = 25
  const dirStr = (orden.proveedor_direccion || '—').toUpperCase()
  const maxDirW = CONTENT_W - dirLblW - 4
  const dirLines = doc.splitTextToSize(dirStr, maxDirW)
  const dirLineH = 4.5
  const dirRowH = Math.max(rowH, dirLines.length * dirLineH + 2.5)

  // Celda label DIRECCIÓN
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.rect(MARGIN, f5Y, dirLblW, dirRowH, 'S')
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + dirRowH / 2 + 1)

  // Celda valor DIRECCIÓN — con wrap
  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, dirRowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const dirTextStartY = f5Y + (dirRowH - dirLines.length * dirLineH) / 2 + dirLineH - 1
  dirLines.forEach((line, idx) => {
    doc.text(line, MARGIN + dirLblW + 2, dirTextStartY + idx * dirLineH)
  })

  // ── Fila 6: TELÉFONO + CORREO ──
  const f6Y = f5Y + dirRowH
  const tlfLblW = 25
  const tlfValW = 35
  const correoLblW = 20
  const correoValW = CONTENT_W - tlfLblW - tlfValW - correoLblW

  doc.rect(MARGIN, f6Y, tlfLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(fmtTelefono(orden.proveedor_telefono) || '—', MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, correoLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('CORREO:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW + tlfValW + correoLblW, f6Y, correoValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const correoStr = (orden.proveedor_correo || '—').toLowerCase()
  const maxCorrW = correoValW - 4
  let cStr = correoStr
  if (doc.getTextWidth(cStr) > maxCorrW) {
    while (cStr.length > 1 && doc.getTextWidth(cStr + '…') > maxCorrW) cStr = cStr.slice(0, -1)
    cStr += '…'
  }
  doc.text(cStr, MARGIN + tlfLblW + tlfValW + correoLblW + 2, f6Y + rowH / 2 + 1)

  // ── Fila 7: CONTACTO + CONDICIÓN PAGO ──
  const f7Y = f6Y + rowH
  const contLblW = 25
  const contValW = tlfValW + 15
  const condLblW = 25
  const condValW = CONTENT_W - contLblW - contValW - condLblW

  doc.rect(MARGIN, f7Y, contLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('ATENCIÓN A:', MARGIN + 2, f7Y + rowH / 2 + 1)

  doc.rect(MARGIN + contLblW, f7Y, contValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const contactoStr = (orden.vendedor?.nombre || config?.supervisorNombre || '—').toUpperCase()
  const maxContW = contValW - 4
  let contText = contactoStr
  if (doc.getTextWidth(contText) > maxContW) {
    while (contText.length > 1 && doc.getTextWidth(contText + '…') > maxContW) contText = contText.slice(0, -1)
    contText += '…'
  }
  doc.text(contText, MARGIN + contLblW + 2, f7Y + rowH / 2 + 1)

  doc.rect(MARGIN + contLblW + contValW, f7Y, condLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('COND. PAGO:', MARGIN + contLblW + contValW + 2, f7Y + rowH / 2 + 1)

  doc.setFillColor(235, 235, 240)
  doc.rect(MARGIN + contLblW + contValW + condLblW, f7Y, condValW, rowH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text((orden.condicion_pago || '—').toUpperCase(), MARGIN + contLblW + contValW + condLblW + 2, f7Y + rowH / 2 + 1)

  y = f7Y + rowH + 4

  // ══════════════════════════════════════════════════════════════════════════
  // Título de la tabla: DATOS DE PRODUCTO A ADQUIRIR
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DE PRODUCTO A ADQUIRIR', MARGIN, y)
  y += 3

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 15,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 15,   w: 22,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 37,   w: 92,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 129,  w: 12,  align: 'center' },
    { label: 'PRECIO ($)',  x: MARGIN + 141,  w: 23,  align: 'center' },
    { label: 'TOTAL ($)',   x: MARGIN + 164,  w: 24,  align: 'right'  },
  ]
  const ROW_H_BASE = 6.0

  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 8, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 5.5, { align: col.align })
  })
  y += 8

  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  const itemsToRender = [...items]
  const isLargeDoc = itemsToRender.length >= 20

  itemsToRender.forEach((item) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const descLines = doc.splitTextToSize(item.descripcion || '', COLS[2].w - 4)
    const lineH = 3.8
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 2)

    let limitY = PAGE_H - 48
    if (pageNum === 1 && itemsToRender.length > 18) {
      limitY = PAGE_H - 78
    }

    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numOC)
      // Redraw table header
      doc.setFillColor(60, 60, 60)
      doc.rect(MARGIN, y, CONTENT_W, 8, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...C_WHITE)
      COLS.forEach(col => {
        let tx = col.x + 2
        if (col.align === 'center') tx = col.x + col.w / 2
        else if (col.align === 'right') tx = col.x + col.w - 2
        doc.text(col.label, tx, y + 5.5, { align: col.align })
      })
      y += 8
    }

    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)

    const midY = y + ROW_H / 2 + 1.2
    
    // Cantidad
    doc.text(String(item.cantidad), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })

    // Código
    doc.setFontSize(7)
    doc.text(item.codigo_snap || 'EXT-PROV', COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })

    // Descripción con wrap
    const descStartY = y + (ROW_H - descLines.length * lineH) / 2 + lineH - 0.5
    descLines.forEach((line, idx) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.text(line, COLS[2].x + 2, descStartY + idx * lineH)
    })

    // Unidad
    doc.setFontSize(8)
    doc.text((item.unidad || 'und').toUpperCase(), COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    // Precio Unitario (USD)
    const precioText = fmtPrecio(item.precio_unit_usd, '$', 0, 0)
    const totalText = fmtPrecio(item.total_usd, '$', 0, 0)

    const fitTextCol = (text, col, baseFontSize, bold) => {
      const maxW = col.w - 3
      let fs = baseFontSize
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      while (fs > 6) {
        doc.setFontSize(fs)
        if (doc.getTextWidth(text) <= maxW) break
        fs -= 0.5
      }
      doc.setFontSize(fs)
      doc.text(text, col.x + col.w - 2, midY, { align: 'right' })
    }

    fitTextCol(precioText, COLS[4], 9.5, false)
    fitTextCol(totalText, COLS[5], 9.5, true)
    doc.setFontSize(8.5)

    y += ROW_H
  })

  // Calculate notes height
  let notasLines = []
  let notasHeight = 0
  const hasNotas = !!(orden.notas?.trim())
  const totW = 70
  const totX = PAGE_W - MARGIN - totW

  if (hasNotas) {
    notasLines = doc.splitTextToSize(orden.notas.trim(), CONTENT_W - totW - 8)
    notasHeight = 5 + notasLines.length * 4 // Header (5mm) + 4mm per line
  }

  const bottomSectionHeight = Math.max(15, notasHeight) // Totals card is 15mm high (7mm subtotal + 8mm total)
  const bottomStartY = Math.max(50, PAGE_H - 43 - bottomSectionHeight) // 43mm leaves plenty of room for slogan + footer

  // If the current y is too low to fit the bottom section with a small gap, add a page
  if (y > bottomStartY - 5) {
    doc.addPage()
    pageNum++
    y = drawHeader(doc, numOC)
  }

  // Draw the bottom section at bottomStartY
  const drawY = bottomStartY

  // 1. Draw Totals on the right
  const subtotal = Number(orden.subtotal_usd || 0)
  const total = Number(orden.total_usd || 0)

  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.2)

  // Subtotal Card
  doc.rect(totX, drawY, totW, 7, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Subtotal:', totX + 3, drawY + 5)
  doc.text(fmtPrecio(subtotal, '$', 0, 0), totX + totW - 3, drawY + 5, { align: 'right' })

  // Total Card
  doc.setFillColor(60, 60, 60)
  doc.rect(totX, drawY + 7, totW, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...C_WHITE)
  doc.text('Total General:', totX + 3, drawY + 7 + 5.5)
  doc.text(fmtPrecio(total, '$', 0, 0), totX + totW - 3, drawY + 7 + 5.5, { align: 'right' })

  // 2. Draw Notes and Terms on the left (at the same height drawY)
  if (hasNotas) {
    let noteY = drawY
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    doc.text('NOTAS Y TÉRMINOS DE ADQUISICIÓN:', MARGIN, noteY + 4)
    noteY += 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    notasLines.forEach((line) => {
      doc.text(line, MARGIN, noteY)
      noteY += 4
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FOOTER (Minimalista)
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    const sloganY = ph - 33
    doc.setFont('helvetica', 'bolditalic')
    doc.setFontSize(12)
    doc.setTextColor(...C_DARK)
    doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })

    const footerY = ph - 28
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C_DARK)
    const addr1 = config.direccion_negocio || 'Dirección Comercial'
    const addr2 = config.pie_pagina_pdf || (config.rif_negocio ? `RIF: ${config.rif_negocio}` : '')
    doc.text(addr1, PAGE_W / 2, footerY + 5, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W / 2, footerY + 9, { align: 'center' })

    const tel = fmtTelefono(config.telefono_negocio) || ''
    const email = config.email_negocio || ''
    const contactLine = [tel, email].filter(Boolean).join('     |     ')
    if (contactLine) {
      doc.setFontSize(8)
      doc.text(contactLine, PAGE_W / 2, footerY + 15, { align: 'center' })
    }
  }

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const provNombreOC = (orden.proveedor_nombre || 'PROVEEDOR').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaOC = (orden.fecha_emision || new Date().toISOString()).slice(0, 10)
  const filename = `OC_${numOC}_${provNombreOC}_${fechaOC}.pdf`
  
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
