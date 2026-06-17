// Genera PDF de Orden de Despacho — formato Listo POS
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  fmtUsd, fmtBs, fmtBcvUsd, fmtPrecio, fmtTotal, fmtFecha, fmtTelefono,
  drawCheck, drawWatermark, drawAnuladaWatermark, drawAprobadoWatermark,
} from './pdfShared'

export async function generarOrdenDespachoPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false, porcentaje = 100 }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factor = Number(porcentaje || 100) / 100
  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0
  let y = 0

  const numDes = `N°- ${String(despacho.cotizacion?.numero ?? despacho.numero).padStart(5, '0')}`
  let pageNum = 1

  const drawHeader = (doc, num) => {
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

  // ── Marca de agua central ──
  drawWatermark(doc)
  if (despacho.estado === 'anulada') {
    drawAnuladaWatermark(doc)
  } else if (despacho.aprobado_por_nombre) {
    drawAprobadoWatermark(doc, despacho.aprobado_por_nombre)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE
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
  // Fallback de teléfono
  const tlfVendedor = vendedorResponsable?.telefono || despacho.vendedor?.telefono
  const vendedorTlf = tlfVendedor ? ` — ${fmtTelefono(tlfVendedor)}` : ''

  const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']
  const fechaObj = despacho.creado_en ? new Date(despacho.creado_en) : new Date()
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

  // Celda izquierda: DEPARTAMENTO DE VENTAS
  const tripleH = rowH * 3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, leftColW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('DEPARTAMENTO', MARGIN + leftColW / 2, gY + tripleH / 2 - 2, { align: 'center' })
  doc.text('DE VENTAS', MARGIN + leftColW / 2, gY + tripleH / 2 + 3, { align: 'center' })

  // Celda central: ORDEN DE DESPACHO
  doc.rect(MARGIN + leftColW, gY, centerW, tripleH, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('ORDEN DE DESPACHO', MARGIN + leftColW + centerW / 2, gY + tripleH / 2 + 1.5, { align: 'center' })

  // 3 celdas derechas
  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
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

  // ── Fila 6: TELÉFONO + VENDEDOR ──
  const f6Y = f5Y + dirRowH
  const tlfLblW = 25
  const tlfValW = 35
  const vendLblW = 25
  const vendValW = CONTENT_W - tlfLblW - tlfValW - vendLblW

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

  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 1)

  doc.setFillColor(235, 235, 240)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const vendStr = (vendedorResponsable?.nombre?.toUpperCase() || '—') + vendedorTlf
  const maxVendW = vendValW - 4
  let vStr = vendStr
  if (doc.getTextWidth(vStr) > maxVendW) {
    while (vStr.length > 1 && doc.getTextWidth(vStr + '…') > maxVendW) vStr = vStr.slice(0, -1)
    vStr += '…'
  }
  doc.text(vStr, MARGIN + tlfLblW + tlfValW + vendLblW + 2, f6Y + rowH / 2 + 1)

  y = f6Y + rowH + 2

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'PRECIO BCV' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : (monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') ? 'TOTAL BCV'  : 'TOTAL'
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 11,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 11,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 31,   w: 91,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 122,  w: 11,  align: 'center' },
    { label: precioLabel,    x: MARGIN + 133,  w: 27,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 160,  w: 28,  align: 'right'  },
  ]
  const ROW_H_BASE = 6.0

  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, y, CONTENT_W, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C_WHITE)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
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

  const isLargeDoc = itemsToRender.length >= 23

  itemsToRender.forEach((item) => {
    const baseNombre = item.es_prestamo ? `${item.nombre_snap || ''} (PRÉSTAMO)` : (item.nombre_snap || '')
    const descLines = doc.splitTextToSize(baseNombre.toUpperCase(), COLS[2].w - 4)
    const lineH = 4.0
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 2)

    let limitY = PAGE_H - 40 // Margen de seguridad estándar
    
    // BALANCEO INTELIGENTE: Si hay más de 20 items, repartimos entre páginas
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 130 // Reparto equitativo para ODC
    }
    
    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numDes)
      // Redraw table header
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

    const midY = y + ROW_H / 2 + 1.2
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

    // Render all lines of the description
    const descStartY = y + (ROW_H - descLines.length * lineH) / 2 + lineH - 0.5
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
    let totalLineaAMostrar = Number(item.total_linea_usd || 0)

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

  // Notas Adicionales — se renderizan ancladas sobre el recuadro de forma de pago (ver más abajo)
  y += 4

  // Si es un doc grande y aún estamos en la pág 1, forzamos página para totales y chofer
  if (isLargeDoc && pageNum === 1) {
    doc.addPage()
    pageNum++
    y = drawHeader(doc, numDes)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Layout fijo desde el fondo: Chofer en footer, Totales encima
  // ══════════════════════════════════════════════════════════════════════════
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const tieneTransporte = !!transportista

  // Datos del chofer fijos al fondo de la página (footer)
  const CHOFER_H = 20
  const choferY = PAGE_H - MARGIN - CHOFER_H

  // Total 6mm más alto que antes (originalmente ~36mm offset, ahora 30mm)
  const totW = (monedaPDF === 'mixto' || monedaPDF === 'mixto_bcv') ? 90 : 75
  const totX = PAGE_W - MARGIN - totW
  const total = Number(despacho.total_usd || 0)
  const flete = Number(despacho.flete_usd || 0)
  const corte = Number(despacho.corte_usd || 0)
  const montoExento = flete + corte
  const descuentoTotalOriginal = Number(despacho.descuento_total_usd || 0)
  const descuentoTotal = descuentoTotalOriginal * factor
  
  // En orden de despacho ahora SIEMPRE se muestra el exento
  const subtotalOriginalVal = total - montoExento
  const subtotal = subtotalOriginalVal * factor

  // Variables esPersonal y descPersonalPct definidas al inicio

  let subtotalOriginal = subtotal
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
    descuentoPersonal = Math.max(0, subtotalOriginal - subtotal)
  }

  const totalFinal = subtotal - descuentoTotal + montoExento
  const hasExentoReal = montoExento > 0
  const hasFleteReal = flete > 0
  const hasDescuento = descuentoTotal > 0
  const hasDescuentoPersonal = descuentoPersonal > 0

  // Posicionar recuadro unificado fijo sobre el chofer
  // Si hay exento, el desglose ocupa 14mm (Subtotal + Exento), si no, 7mm (solo Subtotal)
  const desgloseH = (hasExentoReal ? 14 : 7) + (hasDescuento ? 7 : 0) + (hasDescuentoPersonal ? 7 : 0)
  const ty = choferY - 24 - desgloseH

  // Parsear formas de pago (JSON array o string legacy)
  let formasPagoArr = []
  const fpRaw = formaPago || despacho.forma_pago || ''
  try {
    const parsed = JSON.parse(fpRaw)
    if (Array.isArray(parsed)) {
      parsed.forEach(f => {
        if (f.metodo === 'Cobro a destino') {
          if (f.cobro_destino_pagado) {
            const metodosDefinitivos = Array.isArray(f.metodos_pagados) ? f.metodos_pagados : (Array.isArray(f.metodo_propuesto) ? f.metodo_propuesto : []);
            if (metodosDefinitivos.length > 0) {
              metodosDefinitivos.forEach(p => {
                formasPagoArr.push({ metodo: p.metodo === 'Efectivo' ? 'Efectivo $' : p.metodo, monto: p.monto })
              })
            } else {
              formasPagoArr.push({ metodo: 'Efectivo $', monto: f.monto })
            }
          } else {
            formasPagoArr.push({ metodo: 'Cobro a destino (COD)', monto: f.monto })
          }
        } else if (f.metodo === 'Saldo a Favor') {
          const origen = (f.forma_pago_origen || 'Crédito').toUpperCase()
          formasPagoArr.push({ ...f, metodo: `SALDO A FAVOR (${origen})` })
        } else {
          const metodoNorm = f.metodo === 'Efectivo' ? 'Efectivo $' : f.metodo
          formasPagoArr.push({ ...f, metodo: metodoNorm })
        }
      })
    }
  } catch {
    if (fpRaw) {
      const metodoNorm = fpRaw === 'Efectivo' ? 'Efectivo $' : fpRaw
      formasPagoArr = [{ metodo: metodoNorm, monto: null }]
    }
  }

  // Scale payment methods to match the new total if there are multiple
  if (formasPagoArr.length > 1) {
    const originalTotalFinal = (subtotalOriginalVal - descuentoTotalOriginal) + montoExento
    const scalingFactor = originalTotalFinal > 0 ? totalFinal / originalTotalFinal : 1
    formasPagoArr.forEach(fp => {
      if (fp.monto != null) {
        fp.monto = fp.monto * scalingFactor
      }
    })
  } else if (formasPagoArr.length === 1) {
    formasPagoArr[0].monto = totalFinal
  }

  // Notas Adicionales — Eliminado para que no se muestre en Orden de Despacho

  // Fila FORMA DE PAGO — solo los elegidos con checkbox y palomita
  const fpY = ty
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, fpY, CONTENT_W, 9, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', MARGIN + 3, fpY + 6)

  const checkSize = 3.5
  let cx = MARGIN + 38
  formasPagoArr.forEach(fp => {
    const nombre = (fp.metodo || '').toUpperCase()
    if (!nombre) return
    const boxY = fpY + 2.5
    // Checkbox
    doc.setDrawColor(80, 80, 80)
    doc.setLineWidth(0.3)
    doc.rect(cx, boxY, checkSize, checkSize, 'S')

    // Dibuja la palomita (check) si está aprobado
    if (despacho.aprobado_por_nombre) {
      doc.setLineWidth(0.6)
      doc.setDrawColor(30, 80, 160) // Color azul institucional (mismo que marca de agua de aprobación)
      doc.line(cx + 0.6, boxY + 1.8, cx + 1.6, boxY + 2.8)
      doc.line(cx + 1.6, boxY + 2.8, cx + 3.1, boxY + 0.5)
      doc.setLineWidth(0.3)
    }

    const montoVal = fp.monto != null && fp.monto !== '' ? Number(fp.monto) : null
    const monto = montoVal != null ? ` ${fmtTotal(montoVal, monedaPDF, tasa, factorBcv)}` : ''
    const txt = nombre + monto
    // Label
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C_DARK)
    doc.text(txt, cx + checkSize + 1.2, fpY + 6)
    cx += checkSize + 1.2 + doc.getTextWidth(txt) + 4
  })

  // Desglose Subtotal + Exento (si aplica) + Descuento
  let desY = fpY + 9
  
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.2)

  // Subtotal
  doc.rect(MARGIN, desY, CONTENT_W, 7, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('Subtotal', MARGIN + 4, desY + 5)
  doc.text(fmtTotal(subtotalOriginal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, desY + 5, { align: 'right' })
  desY += 7

  if (hasDescuentoPersonal) {
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, desY, CONTENT_W, 7, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(180, 100, 0)
    doc.text(`Descuento Personal (${descPersonalPct}%)`, MARGIN + 4, desY + 5)
    doc.text('-' + fmtTotal(descuentoPersonal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, desY + 5, { align: 'right' })
    desY += 7
  }

  if (hasExentoReal) {
    doc.rect(MARGIN, desY, CONTENT_W, 7, 'S')
    doc.text('Monto Exento', MARGIN + 4, desY + 5)
    doc.text(fmtTotal(montoExento, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, desY + 5, { align: 'right' })
    desY += 7
  }

  if (hasDescuento) {
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, desY, CONTENT_W, 7, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(180, 100, 0)
    doc.text('Descuento', MARGIN + 4, desY + 5)
    doc.text('-' + fmtTotal(descuentoTotal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, desY + 5, { align: 'right' })
  }

  // Barra oscura TOTAL (alineada con cuadrícula)
  const totTopY = fpY + 9 + desgloseH
  doc.setFillColor(60, 60, 60)
  doc.rect(MARGIN, totTopY, CONTENT_W, 10, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_WHITE)
  doc.text('Total:', MARGIN + 4, totTopY + 7)
  doc.text(fmtTotal(totalFinal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 4, totTopY + 7, { align: 'right' })



  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO — fijo al fondo (footer)
  // ══════════════════════════════════════════════════════════════════════════
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'F')
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferY + 4)

  // Grid: fila 1 y 2 alineadas con 4 columnas simétricas
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

  // ── NO cuentas, NO slogan, NO condiciones ──

  // ── Guardar o devolver blob ──────────────────────────────────────────────
  const clienteNombreODC = ((despacho.cliente_factura || despacho.cliente)?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaODC = (despacho.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `ODC_${numDes.replace(/ /g, '_')}_${clienteNombreODC}_${fechaODC}.pdf`
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
