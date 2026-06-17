// Genera PDF profesional de Nota de Entrega — formato Listo POS
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  fmtPrecio, fmtTotal, fmtFecha, fmtTelefono,
  drawWatermark, drawAnuladaWatermark,
} from './pdfShared'

export async function generarDespachoPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false, porcentaje = 100 }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factor = Number(porcentaje || 100) / 100
  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numDes = `N°- ${String(despacho.cotizacion?.numero ?? despacho.numero).padStart(5, '0')}`
  let pageNum = 1
  // isLargeDoc se definirá después de calcular itemsToRender (con flete/corte)

  const esMembrete = config.nota_entrega_plantilla === 'membrete'

  const drawHeader = (doc, num) => {
    if (esMembrete) {
      return 50 // Margen superior 5cm para hoja pre-impresa
    }
    const HDR_H = 20
    try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 6, 22, 22) } catch (_) { /* ignore */ }
    const centerX = PAGE_W / 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.setTextColor(...C_DARK)
    let n = config.nombre_negocio || 'Listo POS C.A.'
    if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'Listo POS C.A.'
    doc.text(n.toUpperCase(), centerX, 16, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    let r = config.rif_negocio ? `RIF: ${config.rif_negocio}` : ''
    doc.text(r, centerX, 22, { align: 'center' })
    doc.setLineWidth(0.8)
    doc.setDrawColor(...C_DARK)
    doc.line(MARGIN, HDR_H + 10, PAGE_W - MARGIN, HDR_H + 10)
    return HDR_H + 17
  }

  y = drawHeader(doc, numDes)

  // ── Marca de agua central ──
  if (!esMembrete) {
    drawWatermark(doc)
  }
  if (despacho.estado === 'anulada') {
    drawAnuladaWatermark(doc)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula profesional
  // ══════════════════════════════════════════════════════════════════════════
  const baseCliente = despacho.cliente_factura || despacho.cliente || {}
  const cliente = { ...baseCliente }
  const esPersonal = cliente.tipo_cliente === 'personal'
  const descPersonalPct = esPersonal ? (config.descuento_personal_pct ?? 10) : 0
  if (despacho.direccion_envio_estado || despacho.direccion_envio_ciudad || despacho.direccion_envio_direccion) {
    cliente.estado = despacho.direccion_envio_estado || ''
    cliente.ciudad = despacho.direccion_envio_ciudad || ''
    cliente.direccion = despacho.direccion_envio_direccion || ''
  }
  const vendedorResponsable = cliente.vendedor || despacho.vendedor
  // Fallback de teléfono: si el dueño del cliente no tiene tlf, usamos el de quien despacha
  const tlfVendedor = vendedorResponsable?.telefono || despacho.vendedor?.telefono
  const vendedorTlf = tlfVendedor ? ` — ${fmtTelefono(tlfVendedor)}` : ''

  // Nombre del día
  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = despacho.creado_en ? new Date(despacho.creado_en) : new Date()
  const diaNombre = diasSemana[fechaObj.getDay()]

  // Helper para dibujar una celda con borde
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  function drawCell(x, cy, w, h, label, value, opts = {}) {
    // Borde de la celda
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(gridLW)
    doc.rect(x, cy, w, h, 'S')

    if (opts.fill) {
      doc.setFillColor(...(opts.fillColor || [240, 240, 240]))
      doc.rect(x + 0.15, cy + 0.15, w - 0.3, h - 0.3, 'F')
    }

    const pad = 2
    const midY = cy + h / 2

    if (label && value !== undefined) {
      // Label + valor
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(opts.labelSize || 8)
      doc.setTextColor(...C_DARK)
      doc.text(label, x + pad, midY + 0.5)
      const lblW = doc.getTextWidth(label + ' ')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(opts.valSize || 10)
      const valStr = String(value)
      const maxW = w - lblW - pad * 2 - 1
      let displayVal = valStr
      if (doc.getTextWidth(displayVal) > maxW && maxW > 0) {
        while (displayVal.length > 1 && doc.getTextWidth(displayVal + '…') > maxW) {
          displayVal = displayVal.slice(0, -1)
        }
        displayVal += '…'
      }
      doc.text(displayVal, x + pad + lblW, midY + 0.5)
    } else if (label) {
      // Solo texto centrado (título)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(opts.fontSize || 12)
      doc.setTextColor(...C_DARK)
      if (opts.center) {
        doc.text(label, x + w / 2, midY + 1, { align: 'center' })
      } else {
        doc.text(label, x + pad, midY + 1)
      }
    }
  }

  // ── Fila 1-3: Header con título y datos de correlativo/fecha ──
  const gY = y - 4    // inicio de la cuadrícula
  const rowH = 5       // altura de cada fila pequeña (optimizado)
  const leftColW = 38  // "DEPARTAMENTO DE LOGÍSTICA"
  const rightLblW = 22 // columna label derecha (ODC, DIA, FECHA)
  const rightValW = 38 // columna valor derecha
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW // columna central

  // Celda izquierda (3 filas de alto): DEPARTAMENTO DE LOGÍSTICA
  const tripleH = rowH * 3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 1.5, { align: 'center' })
  doc.text('DE LOGÍSTICA', MARGIN + leftColW / 2, gY + tripleH / 2 + 2.5, { align: 'center' })

  // Celda central (3 filas de alto): NOTA DE ENTREGA
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('NOTA DE ENTREGA', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas (label + valor por fila)
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC / Correlativo
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C_DARK)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 0.8, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(numDes, rValX + rightValW / 2, gY + rowH / 2 + 0.8, { align: 'center' })

  // Fila 2: DIA
  const f2Y = gY + rowH
  doc.rect(rLblX, f2Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('DIA', rLblX + rightLblW / 2, f2Y + rowH / 2 + 0.8, { align: 'center' })
  doc.rect(rValX, f2Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(diaNombre, rValX + rightValW / 2, f2Y + rowH / 2 + 0.8, { align: 'center' })

  // Fila 3: FECHA
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('FECHA:', rLblX + rightLblW / 2, f3Y + rowH / 2 + 0.8, { align: 'center' })
  doc.rect(rValX, f3Y, rightValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(fmtFecha(despacho.creado_en), rValX + rightValW / 2, f3Y + rowH / 2 + 0.8, { align: 'center' })

  // ── Fila 4: CLIENTE + R.I.F / Cédula ──
  const f4Y = gY + tripleH
  const clienteLblW = 25
  const rifLblW = 22
  const rifValW = 38
  const clienteValW = CONTENT_W - clienteLblW - rifLblW - rifValW

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('CLIENTE:', MARGIN + 2, f4Y + rowH / 2 + 0.8)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.2)
  doc.rect(MARGIN, f4Y, clienteLblW, rowH, 'S')

  doc.rect(MARGIN + clienteLblW, f4Y, clienteValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  let clienteNombre = (cliente.nombre || '—').toUpperCase()
  if (cliente.tipo_cliente === 'personal') {
    const descPct = config.descuento_personal_pct ?? 10
    clienteNombre += ` (PERSONAL - DESC. ${descPct}%)`
  }
  const maxClienteW = clienteValW - 4
  let cNombre = clienteNombre
  if (doc.getTextWidth(cNombre) > maxClienteW) {
    while (cNombre.length > 1 && doc.getTextWidth(cNombre + '…') > maxClienteW) cNombre = cNombre.slice(0, -1)
    cNombre += '…'
  }
  doc.text(cNombre, MARGIN + clienteLblW + 2, f4Y + rowH / 2 + 0.8)

  doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + rifLblW / 2, f4Y + rowH / 2 + 0.8, { align: 'center' })

  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  let rifValFontSize = 9.5
  doc.setFontSize(rifValFontSize)
  const rifText = cliente.rif_cedula || '—'
  const maxRifW = rifValW - 4
  while (doc.getTextWidth(rifText) > maxRifW && rifValFontSize > 6) {
    rifValFontSize -= 0.5
    doc.setFontSize(rifValFontSize)
  }
  doc.text(rifText, MARGIN + clienteLblW + clienteValW + rifLblW + rifValW / 2, f4Y + rowH / 2 + 0.8, { align: 'center' })

  // ── Fila 5: DIRECCIÓN (altura dinámica para texto largo) ──
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const dirStr = [cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ').toUpperCase() || '—'
  const maxDirW = CONTENT_W - dirLblW - 4
  const dirLines = doc.splitTextToSize(dirStr, maxDirW)
  const dirLineH = 3.8
  const dirRowH = Math.max(rowH, dirLines.length * dirLineH + 2.0)

  // Celda label DIRECCIÓN
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, f5Y, dirLblW, dirRowH, 'S')
  doc.setTextColor(...C_DARK)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + dirRowH / 2 + 0.8)

  // Celda valor DIRECCIÓN — con wrap
  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, dirRowH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const dirTextStartY = f5Y + (dirRowH - dirLines.length * dirLineH) / 2 + dirLineH - 0.8
  dirLines.forEach((line, idx) => {
    doc.text(line, MARGIN + dirLblW + 2, dirTextStartY + idx * dirLineH)
  })

  // ── Fila 6: TELÉFONO + VENDEDOR ──
  const f6Y = f5Y + dirRowH
  const tlfLblW = 25
  const tlfValW = 35
  const vendLblW = 25
  const vendValW = CONTENT_W - tlfLblW - tlfValW - vendLblW

  doc.rect(MARGIN, f6Y, tlfLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 0.8)

  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.setFont('helvetica', 'bold')
  let tlfFontSize = 9.5
  doc.setFontSize(tlfFontSize)
  const tlfText = fmtTelefono(cliente.telefono) || '—'
  const maxTlfW = tlfValW - 4
  while (doc.getTextWidth(tlfText) > maxTlfW && tlfFontSize > 6) {
    tlfFontSize -= 0.5
    doc.setFontSize(tlfFontSize)
  }
  doc.text(tlfText, MARGIN + tlfLblW + 2, f6Y + rowH / 2 + 0.8)

  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 0.8)

  doc.setFillColor(235, 235, 240)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const vendStr = (vendedorResponsable?.nombre?.toUpperCase() || '—') + vendedorTlf
  const maxVendW = vendValW - 4
  let vStr = vendStr
  if (doc.getTextWidth(vStr) > maxVendW) {
    while (vStr.length > 1 && doc.getTextWidth(vStr + '…') > maxVendW) vStr = vStr.slice(0, -1)
    vStr += '…'
  }
  doc.text(vStr, MARGIN + tlfLblW + tlfValW + vendLblW + 2, f6Y + rowH / 2 + 0.8)

  y = f6Y + rowH + 2

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'PRECIO BCV' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'TOTAL BCV'  : 'TOTAL'
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 11,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 11,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 31,   w: 87,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 118,  w: 11,  align: 'center' },
    { label: precioLabel,    x: MARGIN + 129,  w: 27,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 156,  w: 32,  align: 'right'  },
  ]
  const ROW_H_BASE = 5.2

  // Cabecera tabla (optimizado a 7.5 mm)
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 7.5, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 5.3, { align: col.align })
  })
  y += 7.5

  // Items
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
      precio_unit_usd: fleteVal,
      total_linea_usd: fleteVal,
      tiene_descuento: false
    })
  }

  const corteVal = Number(despacho.corte_usd || 0)
  if (corteVal > 0) {
    itemsToRender.push({
      cantidad: 1,
      codigo_snap: 'CRT1254698',
      nombre_snap: 'SERVICIO DE CORTE (E)',
      unidad_snap: 'UND',
      precio_unit_usd: corteVal,
      total_linea_usd: corteVal,
      tiene_descuento: false
    })
  }

  const isLargeDoc = itemsToRender.length >= 23 || (itemsToRender.length >= 18 && despacho.notas?.trim())

  itemsToRender.forEach((item) => {
    // Calcular cuántas líneas necesita la descripción (optimizado lineH = 3.6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const baseNombre = item.nombre_snap || ''
    const descLines = doc.splitTextToSize(baseNombre.toUpperCase(), COLS[2].w - 4)
    const lineH = 3.6
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 1.2)

    let limitY = PAGE_H - 40 // Margen de seguridad para el footer
    
    // BALANCEO INTELIGENTE: Si hay más de 20 items, cortamos antes en la Pág 1
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 120 // Forzamos un reparto más equitativo
    }
    
    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numDes)
      // Redraw table header on new page (optimizado a 7.5 mm)
      doc.setFillColor(60, 60, 60)
      doc.rect(MARGIN, y, CONTENT_W, 7.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C_WHITE)
      COLS.forEach(col => {
        let tx = col.x + 2
        if (col.align === 'center') tx = col.x + col.w / 2
        else if (col.align === 'right') tx = col.x + col.w - 2
        doc.text(col.label, tx, y + 5.3, { align: col.align })
      })
      y += 7.5
    }

    doc.setLineWidth(0.2)
    doc.setDrawColor(200, 200, 200)
    if (item.tiene_descuento) {
      doc.setFillColor(235, 235, 240)
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'FD')
    } else {
      doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'S')
    }
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + ROW_H) })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    const midY = y + ROW_H / 2 + 1.0
    const isFlete = (item.nombre_snap || '').toUpperCase().includes('FLETE') || (item.codigo_snap || '').startsWith('FTL')
    const cantDisplay = item.cantidad ?? (isFlete ? 1 : '')
    let cantSize = 9
    doc.setFontSize(cantSize)
    const cantText = String(cantDisplay)
    const maxCantW = COLS[0].w - 1.5
    while (doc.getTextWidth(cantText) > maxCantW && cantSize > 6) {
      cantSize -= 0.5
      doc.setFontSize(cantSize)
    }
    doc.text(cantText, COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })

    let codSize = 6.5
    doc.setFontSize(codSize)
    const codText = item.codigo_snap || '—'
    const maxCodW = COLS[1].w - 2
    while (doc.getTextWidth(codText) > maxCodW && codSize > 4.5) {
      codSize -= 0.5
      doc.setFontSize(codSize)
    }
    doc.text(codText, COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })

    // Render all lines of the description (ajustado de forma vertical)
    const descStartY = y + (ROW_H - descLines.length * lineH) / 2 + lineH - 0.8
    descLines.forEach((line, idx) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(line, COLS[2].x + 2, descStartY + idx * lineH)
    })

    let uniSize = 9
    doc.setFontSize(uniSize)
    const uniText = (item.unidad_snap || '-').toUpperCase()
    const maxUniW = COLS[3].w - 1.5
    while (doc.getTextWidth(uniText) > maxUniW && uniSize > 6) {
      uniSize -= 0.5
      doc.setFontSize(uniSize)
    }
    doc.text(uniText, COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })

    let precioUnitarioAMostrar = Number(item.precio_unit_usd || 0)
    let totalLineaAMostrar = item.es_prestamo ? (Number(item.cantidad || 0) * Number(item.precio_unit_usd || 0)) : Number(item.total_linea_usd || 0)

    const isCorte = (item.nombre_snap || '').toUpperCase().includes('CORTE') || (item.codigo_snap || '').startsWith('CRT')
    const esFleteCorte = isFlete || isCorte
    const esServicio = isFlete || isCorte || item.tiene_descuento === false

    if (!esFleteCorte) {
      precioUnitarioAMostrar = precioUnitarioAMostrar * factor
      totalLineaAMostrar = totalLineaAMostrar * factor
    }

    if (esPersonal && descPersonalPct > 0 && !item.es_prestamo && !esServicio) {
      precioUnitarioAMostrar = Math.round((precioUnitarioAMostrar / (1 - descPersonalPct / 100)) * 100) / 100
      totalLineaAMostrar = precioUnitarioAMostrar * Number(item.cantidad || 0)
    }

    const precioText = fmtPrecio(precioUnitarioAMostrar, monedaPDF, tasa, factorBcv)
    const totalText = fmtPrecio(totalLineaAMostrar, monedaPDF, tasa, factorBcv)

    // Auto-reducir fuente si el texto no cabe
    const fitTextCol = (text, col, baseFontSize, bold) => {
      const maxW = col.w - 4
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

    fitTextCol(precioText, COLS[4], 10.5, false)
    fitTextCol(totalText, COLS[5], 10.5, true)
    doc.setFontSize(9)

    y += ROW_H
  })

  y += 2

  // ── Layout fijo: posiciones calculadas desde el fondo ──
  // Si es un documento grande y todavía estamos en la página 1, forzamos página para los totales
  // No forzar salto de página artificial, el limitY ya se encarga de dejar espacio
  y = y + 2

  const sloganY = esMembrete ? PAGE_H - 21 : PAGE_H - 33

  const totalOriginal = items.reduce((acc, it) => acc + (it.es_prestamo ? (Number(it.cantidad || 0) * Number(it.precio_unit_usd || 0)) : Number(it.total_linea_usd || 0)), 0)
  const total = totalOriginal * factor
  const flete = Number(despacho.flete_usd || 0)
  const corte = Number(despacho.corte_usd || 0)
  const montoExento = flete + corte
  const descuentoTotalOriginal = Number(despacho.descuento_total_usd || 0)
  const descuentoTotal = descuentoTotalOriginal * factor
  const totalFinal = total - descuentoTotal + montoExento
  const hasExento = montoExento > 0
  const hasFlete = flete > 0
  const hasDescuento = descuentoTotal > 0
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const refPago = despacho.referencia_pago || ''

  // ══════════════════════════════════════════════════════════════════════════
  // 4. BLOQUE COMBINADO: Crédito + Transporte (izq) | Desglose (der) + TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  // Columna derecha: desglose (estructura fija de totales)
  let subtotalOriginal = total
  let descuentoPersonal = 0

  if (esPersonal && descPersonalPct > 0) {
    let sumOriginal = 0
    items.forEach(it => {
      if (!it.es_prestamo) {
        const cant = Number(it.cantidad || 0)
        const precio = Number(it.precio_unit_usd || 0) * factor
        const precioOrig = Math.round((precio / (1 - descPersonalPct / 100)) * 100) / 100
        sumOriginal += precioOrig * cant
      }
    })
    subtotalOriginal = sumOriginal
    descuentoPersonal = Math.max(0, subtotalOriginal - total)
  }

  const rightItems = []
  if (esPersonal && descPersonalPct > 0) {
    rightItems.push({ label: 'SubTotal:', value: fmtTotal(subtotalOriginal, monedaPDF, tasa, factorBcv) })
    rightItems.push({ label: `Desc. Personal (${descPersonalPct}%):`, value: '-' + fmtTotal(descuentoPersonal, monedaPDF, tasa, factorBcv), color: [180, 100, 0] })
  } else {
    rightItems.push({ label: 'SubTotal:', value: fmtTotal(total, monedaPDF, tasa, factorBcv) })
  }

  if (descuentoTotal > 0) {
    rightItems.push({ label: 'Descuento:', value: '-' + fmtTotal(descuentoTotal, monedaPDF, tasa, factorBcv), color: [220, 38, 38] })
  }
  if (montoExento > 0) {
    rightItems.push({ label: 'Exento:', value: fmtTotal(montoExento, monedaPDF, tasa, factorBcv), color: [50, 100, 180] })
  }

  if (refPago) {
    rightItems.push({ label: 'Ref:', value: refPago })
  }

  const numComboRows = rightItems.length
  const totalBarH = 5.5
  const CREDIT_ROW_H = 4.5
  const CHOFER_ROW_H = 6.0
  const CHOFER_H = 4.5 + CHOFER_ROW_H * 2  // header(4.5) + 2 filas
  const creditRowY = sloganY - 4 - CHOFER_H - CREDIT_ROW_H
  const choferGridY = creditRowY + CREDIT_ROW_H
  const comboBottom = creditRowY - 2
  const dataRowH = 3.6
  const comboTop = comboBottom - totalBarH - numComboRows * dataRowH

  // Notas Adicionales — se renderizan ancladas sobre el bloque de totales
  if (despacho.notas?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const notasLineas = doc.splitTextToSize(despacho.notas.trim(), CONTENT_W)
    const notasH = 5 + notasLineas.length * 5
    const notasStartY = comboTop - 2 - notasH

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    doc.text('NOTAS:', MARGIN, notasStartY + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    notasLineas.forEach((lin, i) => {
      doc.text(lin, MARGIN, notasStartY + 4 + 5 + i * 5)
    })
  }

  // Dibujar filas de datos
  const comboLeftW = CONTENT_W - 90
  const comboRightW = CONTENT_W - comboLeftW

  for (let r = 0; r < numComboRows; r++) {
    const ry = comboTop + r * dataRowH

    // Celda derecha
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN + comboLeftW, ry, comboRightW, dataRowH, 'S')
    
    const item = rightItems[r]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.2)
    if (item.color) doc.setTextColor(...item.color)
    else doc.setTextColor(...C_DARK)
    doc.text(item.label, MARGIN + comboLeftW + 3, ry + dataRowH / 2 + 0.8)
    doc.text(item.value, MARGIN + CONTENT_W - 3, ry + dataRowH / 2 + 0.8, { align: 'right' })
  }

  // Barra TOTAL (alineada con cuadrícula derecha)
  const totTopY = comboTop + numComboRows * dataRowH
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN + comboLeftW, totTopY, comboRightW, totalBarH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_WHITE)
  doc.text('Total:', MARGIN + comboLeftW + 3, totTopY + 4.8)
  doc.text(fmtTotal(totalFinal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 3, totTopY + 4.8, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO — cuadrícula fija encima del slogan
  // ══════════════════════════════════════════════════════════════════════════

  // Fila: 8 DÍAS DE CRÉDITO CONTINUO
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, creditRowY, CONTENT_W, CREDIT_ROW_H, 'S')
  const creditText = cliente.tipo_cliente === 'personal'
    ? `PERSONAL DE LA EMPRESA (DESC. ${config.descuento_personal_pct ?? 10}% APLICADO)`
    : '8 DÍAS DE CRÉDITO CONTINUO'
  doc.text(creditText, MARGIN + 3, creditRowY + CREDIT_ROW_H / 2 + 1.0)

  // Grid del chofer
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferGridY, CONTENT_W, 5, 'F')
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, choferGridY, CONTENT_W, 5, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferGridY + 3.5)

  const choferRow1Y = choferGridY + 5
  const choferRow2Y = choferRow1Y + CHOFER_ROW_H
  const col4W = CONTENT_W / 4

  const choferRow1Fields = [
    { label: 'CHOFER', val: (transportista?.nombre || '').toUpperCase(), w: col4W * 2 },
    { label: 'C.I.',   val: (transportista?.rif    || '').toUpperCase(), w: col4W },
    { label: 'COLOR',  val: (transportista?.color  || '').toUpperCase(), w: col4W },
  ]
  const choferRow2Fields = [
    { label: 'VEHÍCULO',    val: (transportista?.vehiculo    || '').toUpperCase(), w: col4W },
    { label: 'PLACA CHUTO', val: (transportista?.placa_chuto || '').toUpperCase(), w: col4W },
    { label: 'PLACA BATEA', val: (transportista?.placa_batea || '').toUpperCase(), w: col4W },
    { label: 'COLOR BATEA', val: (transportista?.color_batea || '').toUpperCase(), w: col4W },
  ]

  function drawChoferRow(fields, ry) {
    let currentX = MARGIN
    fields.forEach((f) => {
      const cellW = f.w
      doc.setDrawColor(120, 120, 120)
      doc.setLineWidth(0.3)
      doc.rect(currentX, ry, cellW, CHOFER_ROW_H, 'S')

      const maxTextW = cellW - 3

      // Label (con auto-encogimiento dinámico)
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

      // Valor (con auto-encogimiento dinámico)
      if (f.val) {
        doc.setFont('helvetica', 'bold')
        let valSize = 8.0
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

  drawChoferRow(choferRow1Fields, choferRow1Y)
  drawChoferRow(choferRow2Fields, choferRow2Y)

  // ── Slogan ──
  if (y < sloganY) {
    if (!esMembrete) {
      doc.setFont('helvetica', 'bolditalic')
      doc.setFontSize(12)
      doc.setTextColor(...C_DARK)
      doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FOOTER LIMPIO (blanco y negro)
  // ══════════════════════════════════════════════════════════════════════════
  // Footer SOLO en la última página — en páginas intermedias el espacio queda libre
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H
    if (!esMembrete) {
      // Línea separadora
      const footerY = ph - 28
      doc.setLineWidth(0.8)
      doc.setDrawColor(...C_DARK)
      doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

      // Dirección
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...C_DARK)

      const addr1 = config.direccion_negocio || 'Dirección Comercial'
      const addr2 = config.pie_pagina_pdf || (config.rif_negocio ? `RIF: ${config.rif_negocio}` : '')

      doc.text(addr1, PAGE_W / 2, footerY + 5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.text(addr2, PAGE_W / 2, footerY + 9, { align: 'center' })

      // Teléfono y correo
      doc.setFontSize(8)
      const tel = fmtTelefono(config.telefono_negocio) || ''
      const email = config.email_negocio || ''
      const contactLine = [tel, email].filter(Boolean).join('     |     ')
      if (contactLine) {
        doc.setFont('helvetica', 'normal')
        doc.text(contactLine, PAGE_W / 2, footerY + 15, { align: 'center' })
      }
    }
  }

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const clienteNombreDes = ((despacho.cliente_factura || despacho.cliente)?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaDes = (despacho.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `${numDes.replace(/ /g, '_')}_${clienteNombreDes}_${fechaDes}.pdf`
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
