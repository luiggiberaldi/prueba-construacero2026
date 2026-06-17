// Genera PDF de Guía de Despacho — formato Listo POS
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  fmtFecha, fmtTelefono,
  drawWatermark, drawAnuladaWatermark, drawAprobadoWatermark,
} from './pdfShared'

export async function generarGuiaDespachoPDF({ despacho, items = [], config = {}, returnBlob = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  let y = 0
  const correlativo = String(despacho.cotizacion?.numero ?? despacho.numero).padStart(5, '0')
  const numDes = correlativo
  let pageNum = 1

  // Modo membrete: hoja pre-impresa con membrete de empresa ya impreso
  // → omite header con logo/nombre, arranca en 50mm (5cm) igual que la Factura
  const esMembrete = config.nota_entrega_plantilla === 'membrete'

  const drawHeader = (doc, num) => {
    // En modo membrete: no dibujar encabezado corporativo (ya viene pre-impreso)
    if (esMembrete) {
      return 50 // Margen superior 5cm para hoja pre-impresa
    }
    const HDR_H = 20
    try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) { /* ignore */ }
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

  y = drawHeader(doc, numDes)


  // Marca de agua solo en hoja blanca (no en membrete pre-impreso)
  if (!esMembrete) {
    drawWatermark(doc)
  }
  if (despacho.estado === 'anulada') {
    drawAnuladaWatermark(doc)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE
  // ══════════════════════════════════════════════════════════════════════════
  const baseCliente = despacho.cliente_factura || despacho.cliente || {}
  const cliente = { ...baseCliente }
  if (despacho.direccion_envio_estado || despacho.direccion_envio_ciudad || despacho.direccion_envio_direccion) {
    cliente.estado = despacho.direccion_envio_estado || ''
    cliente.ciudad = despacho.direccion_envio_ciudad || ''
    cliente.direccion = despacho.direccion_envio_direccion || ''
  }
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = despacho.creado_en ? new Date(despacho.creado_en) : new Date()
  const diaNombre = diasSemana[fechaObj.getDay()]

  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  // ── Fila 1-3: Header con título y datos ──
  const gY = y - 4
  const rowH = 7
  const rightLblW = 22
  const rightValW = 38
  const centerW = CONTENT_W - rightLblW - rightValW

  // Celda central: GUÍA DE DESPACHO
  const tripleH = rowH * 3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...C_DARK)
  doc.text('GUÍA DE DESPACHO', MARGIN + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas
  const rLblX = MARGIN + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: N°
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('N°', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(numDes, rValX + rightValW / 2, gY + rowH / 2 + 1, { align: 'center' })

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

  // Fila 3: FECHA
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('FECHA:', rLblX + rightLblW / 2, f3Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f3Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(fmtFecha(despacho.creado_en), rValX + rightValW / 2, f3Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 4: CLIENTE + RIF ──
  const f4Y = gY + tripleH
  const clienteLblW = 25
  const rifLblW = 22
  const rifValW = 38
  const clienteValW = CONTENT_W - clienteLblW - rifLblW - rifValW

  doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + clienteLblW, f4Y, clienteValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const clienteNombre = (cliente.nombre || '—').toUpperCase()
  const maxClienteW = clienteValW - 4
  let cNombre = clienteNombre
  if (doc.getTextWidth(cNombre) > maxClienteW) {
    while (cNombre.length > 1 && doc.getTextWidth(cNombre + '…') > maxClienteW) cNombre = cNombre.slice(0, -1)
    cNombre += '…'
  }
  doc.text(cNombre, MARGIN + clienteLblW + 2, f4Y + rowH / 2 + 1)

  doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + rifLblW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  let rifValFontSize = 10
  doc.setFontSize(rifValFontSize)
  const rifText = cliente.rif_cedula || '—'
  const maxRifW = rifValW - 4
  while (doc.getTextWidth(rifText) > maxRifW && rifValFontSize > 6.5) {
    rifValFontSize -= 0.5
    doc.setFontSize(rifValFontSize)
  }
  doc.text(rifText, MARGIN + clienteLblW + clienteValW + rifLblW + rifValW / 2, f4Y + rowH / 2 + 1, { align: 'center' })

  // ── Fila 5: DIRECCIÓN (altura dinámica para texto largo) ──
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const dirStr = [cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ').toUpperCase() || '—'
  const maxDirW = CONTENT_W - dirLblW - 4
  const dirLines = doc.splitTextToSize(dirStr, maxDirW)
  const dirLineH = 4.5
  const dirRowH = Math.max(rowH, dirLines.length * dirLineH + 2.5)

  // Celda label DIRECCIÓN
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, f5Y, dirLblW, dirRowH, 'S')
  doc.setTextColor(...C_DARK)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + dirRowH / 2 + 1)

  // Celda valor DIRECCIÓN — con wrap
  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, dirRowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const dirTextStartY = f5Y + (dirRowH - dirLines.length * dirLineH) / 2 + dirLineH - 1
  dirLines.forEach((line, idx) => {
    doc.text(line, MARGIN + dirLblW + 2, dirTextStartY + idx * dirLineH)
  })

  // ── Fila 6: TELÉFONO ──
  const f6Y = f5Y + dirRowH
  const tlfLblW = 25
  const tlfValW = CONTENT_W - tlfLblW

  doc.rect(MARGIN, f6Y, tlfLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 1)

  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  let tlfFontSize = 10
  doc.setFontSize(tlfFontSize)
  const tlfText = fmtTelefono(cliente.telefono) || '—'
  const maxTlfW = tlfValW - 4
  while (doc.getTextWidth(tlfText) > maxTlfW && tlfFontSize > 6.5) {
    tlfFontSize -= 0.5
    doc.setFontSize(tlfFontSize)
  }
  doc.text(tlfText, MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 1)

  y = f6Y + rowH + 2

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS (sin precios, optimizada)
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 15,  align: 'center' },
    { label: 'CÓD. ACC.',   x: MARGIN + 15,   w: 28,  align: 'center' },
    { label: 'DESCRIPCIÓN COMPLETA DEL ARTÍCULO', x: MARGIN + 43,   w: 125, align: 'center' },
    { label: 'UNID.',       x: MARGIN + 168,  w: 20,  align: 'center' },
  ]
  const ROW_H_BASE = 6.0

  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w / 2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 6.5, { align: col.align })
  })
  y += 9

  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  const itemsToRender = [...items]
  const fleteVal = Number(despacho.flete_usd || 0)
  if (fleteVal > 0) {
    itemsToRender.push({
      cantidad: 1,
      codigo_snap: 'FTL1005632',
      nombre_snap: 'SERVICIO DE FLETE (E)',
      unidad_snap: 'UND',
    })
  }

  const corteVal = Number(despacho.corte_usd || 0)
  if (corteVal > 0) {
    itemsToRender.push({
      cantidad: 1,
      codigo_snap: 'CRT1254698',
      nombre_snap: 'SERVICIO DE CORTE (E)',
      unidad_snap: 'UND',
    })
  }

  const isLargeDoc = itemsToRender.length >= 23

  itemsToRender.forEach((item) => {
    // Calcular cuántas líneas necesita la descripción
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    const baseNombre = item.nombre_snap || ''
    const descLines = doc.splitTextToSize(baseNombre.toUpperCase(), COLS[2].w - 4)
    const lineH = 4.5
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 2.5)

    let limitY = PAGE_H - 45 // Margen de seguridad estándar
    
    // Balanceo inteligente si hay muchos items
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 65
    }
    
    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numDes)
      // Redebujar cabecera de la tabla
      doc.setFillColor(60, 60, 60)
      doc.rect(MARGIN, y, CONTENT_W, 9, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_WHITE)
      COLS.forEach(col => {
        let tx = col.x + 2
        if (col.align === 'center') tx = col.x + col.w / 2
        else if (col.align === 'right') tx = col.x + col.w - 2
        doc.text(col.label, tx, y + 6.5, { align: col.align })
      })
      y += 9
    }

    doc.setLineWidth(0.2)
    doc.setDrawColor(200, 200, 200)
    doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...C_DARK)

    const midY = y + ROW_H / 2 + 1.2
    const isFlete = (item.nombre_snap || '').toUpperCase().includes('FLETE') || (item.codigo_snap || '').startsWith('FTL')
    const cantDisplay = item.cantidad ?? (isFlete ? 1 : '')
    let cantSize = 10
    doc.setFontSize(cantSize)
    const cantText = String(cantDisplay)
    const maxCantW = COLS[0].w - 2
    while (doc.getTextWidth(cantText) > maxCantW && cantSize > 6.5) {
      cantSize -= 0.5
      doc.setFontSize(cantSize)
    }
    doc.text(cantText, COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })

    let codSize = 8.5
    doc.setFontSize(codSize)
    const codText = item.codigo_snap || '—'
    const maxCodW = COLS[1].w - 3
    while (doc.getTextWidth(codText) > maxCodW && codSize > 6) {
      codSize -= 0.5
      doc.setFontSize(codSize)
    }
    doc.text(codText, COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })

    // Renderizar líneas de descripción alineadas a la izquierda pero en columna centrada
    const descStartY = y + (ROW_H - descLines.length * lineH) / 2 + lineH - 0.5
    descLines.forEach((line, idx) => {
      doc.setFont('helvetica', 'bold') // Nombre completo del artículo en negrita para logística
      doc.setFontSize(9.5)
      doc.text(line, COLS[2].x + 3, descStartY + idx * lineH)
    })

    let uniSize = 10
    doc.setFontSize(uniSize)
    const uniText = (item.unidad_snap || '-').toUpperCase()
    const maxUniW = COLS[3].w - 2
    while (doc.getTextWidth(uniText) > maxUniW && uniSize > 6.5) {
      uniSize -= 0.5
      doc.setFontSize(uniSize)
    }
    doc.text(uniText, COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    y += ROW_H
  })

  // Si es un documento grande y estamos en pág 1, forzamos página para que el chofer y eslogan queden perfectos
  if (isLargeDoc && pageNum === 1) {
    doc.addPage()
    pageNum++
    y = drawHeader(doc, numDes)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DATOS DEL CHOFER Y VEHÍCULO + ESLAZO FONDOS (footer fijo)
  // ══════════════════════════════════════════════════════════════════════════
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const tieneTransporte = !!transportista
  const hasFleteReal = fleteVal > 0

  const CHOFER_H = 20
  // Margen superior: 5cm (50mm) | Margen inferior: 2.5cm (25mm)
  // sloganY = choferY + CHOFER_H + 6 → debe quedar a PAGE_H - 25
  // choferY = PAGE_H - 25 - CHOFER_H - 6 = PAGE_H - 51
  const choferY = PAGE_H - 25 - CHOFER_H - 6
  const sloganY = choferY + CHOFER_H + 6

  // ── Caja de datos del chofer ──
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'F')
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferY + 4)

  const ROW_H = 7
  const row1Y = choferY + 6
  const row2Y = row1Y + ROW_H
  const col4W = CONTENT_W / 4
  const row1Fields = [
    { label: 'CHOFER', val: (transportista?.nombre || '').toUpperCase(), w: col4W * 2 },
    { label: 'C.I.',   val: (transportista?.rif    || '').toUpperCase(), w: col4W },
    { label: 'COLOR',  val: (transportista?.color  || '').toUpperCase(), w: col4W },
  ]
  const row2Fields = [
    { label: 'VEHÍCULO',    val: (transportista?.vehiculo    || '').toUpperCase(), w: col4W },
    { label: 'PLACA CHUTO', val: (transportista?.placa_chuto || '').toUpperCase(), w: col4W },
    { label: 'PLACA BATEA', val: (transportista?.placa_batea || '').toUpperCase(), w: col4W },
    { label: 'COLOR BATEA', val: (transportista?.color_batea || '').toUpperCase(), w: col4W },
  ]

  function drawRow(fields, ry) {
    let currentX = MARGIN
    fields.forEach((f) => {
      const cellW = f.w
      doc.setDrawColor(120, 120, 120)
      doc.setLineWidth(0.3)
      doc.rect(currentX, ry, cellW, ROW_H, 'S')

      const maxTextW = cellW - 3

      // Label
      doc.setFont('helvetica', 'bold')
      let lblSize = 6.5
      doc.setFontSize(lblSize)
      doc.setTextColor(100, 100, 100)
      const labelText = (f.label || '').toUpperCase()
      while (doc.getTextWidth(labelText) > maxTextW && lblSize > 4.5) {
        lblSize -= 0.5
        doc.setFontSize(lblSize)
      }
      doc.text(labelText, currentX + 1.5, ry + 2.3)

      // Valor
      if (f.val) {
        doc.setFont('helvetica', 'bold')
        let valSize = 8
        doc.setFontSize(valSize)
        doc.setTextColor(0, 0, 0)
        const valText = String(f.val).toUpperCase()
        while (doc.getTextWidth(valText) > maxTextW && valSize > 5.5) {
          valSize -= 0.5
          doc.setFontSize(valSize)
        }
        doc.text(valText, currentX + 1.5, ry + 5.5)
      }

      currentX += cellW
    })
  }
  drawRow(row1Fields, row1Y)
  drawRow(row2Fields, row2Y)

  // ── Slogan — última línea antes del margen inferior ──
  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(11)
  doc.setTextColor(...C_DARK)
  doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })


  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const clienteNombreGuia = ((despacho.cliente_factura || despacho.cliente)?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaGuia = (despacho.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `GUIA_DESPACHO_${numDes.replace(/ /g, '_')}_${clienteNombreGuia}_${fechaGuia}.pdf`
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
