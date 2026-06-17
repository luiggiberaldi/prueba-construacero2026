// Genera PDF profesional de Factura — formato Listo POS
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  fmtFecha, fmtTelefono,
  fmtBsShort, fmtBcvUsd, fmtUsd,
  drawWatermark, drawAnuladaWatermark,
} from './pdfShared'

// Formateadores locales de la Factura — sin prefijo "Bs" (solo cifras)
function fmtPrecioFac(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBsShort(Number(n || 0) * tasa)
  if ((moneda === 'bcv' || moneda === 'mixto_bcv') && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  return fmtUsd(n)
}

function fmtTotalFac(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBsShort(Number(n || 0) * tasa)
  if (moneda === 'bcv' && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  if (moneda === 'mixto' && tasa > 0) return `${fmtUsd(n)} / ${fmtBsShort(Number(n || 0) * tasa)}`
  if (moneda === 'mixto_bcv' && factorBcv > 0 && tasa > 0) return `${fmtBcvUsd(Number(n || 0) * factorBcv)} / ${fmtBsShort(Number(n || 0) * tasa)}`
  return fmtUsd(n)
}

function formatTlfDash(raw) {
  if (!raw) return ''
  let cleaned = String(raw).trim()
  if (cleaned.startsWith('+58')) {
    cleaned = cleaned.slice(3)
  } else if (cleaned.startsWith('58') && cleaned.length > 10) {
    cleaned = cleaned.slice(2)
  }
  const digits = cleaned.replace(/[^\d]/g, '')
  let finalDigits = digits
  if (digits.length === 10 && (digits.startsWith('4') || digits.startsWith('2'))) {
    finalDigits = '0' + digits
  }
  if (finalDigits.length === 11) {
    return `${finalDigits.slice(0, 4)}-${finalDigits.slice(4)}`
  }
  return fmtTelefono(raw)
}

export async function generarFacturaPDF({ despacho, items = [], config = {}, formaPago = '', monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, returnBlob = false, nroFactura = '', nroControl = '', porcentaje = 100 }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  const factor = Number(porcentaje || 100) / 100
  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const rif = config.rif_negocio || 'J-50115913-0'
  let y = 0

  const numFac = `FAC- ${String(nroFactura).padStart(5, '0')}`
  const displayControl = String(nroControl).toUpperCase()
  let pageNum = 1

  const esMembrete = config.nota_entrega_plantilla === 'membrete'

  const drawHeader = (doc, num) => {
    if (pageNum > 1) {
      const HDR_H = 15
      if (!esMembrete) {
        try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN - 2, 4, 12, 12) } catch (_) { /* ignore */ }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(...C_DARK)
        let n = config.nombre_negocio || 'Listo POS C.A.'
        if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'Listo POS C.A.'
        doc.text(n.toUpperCase(), MARGIN + 14, 10)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text(`FACTURA N° ${String(nroFactura).padStart(5, '0')}`, PAGE_W - MARGIN, 10, { align: 'right' })
        doc.setLineWidth(0.4)
        doc.setDrawColor(...C_DARK)
        doc.line(MARGIN, 14, PAGE_W - MARGIN, 14)
        return 19
      }
      return 19 + 20
    }

    if (!esMembrete) {
      return 15 // Empieza a 15mm de arriba
    }
    return 50 // Empieza a 50mm de arriba (5cm) si es membrete pre-impreso
  }

  y = drawHeader(doc, numFac)

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
  const tlfVendedor = vendedorResponsable?.telefono || despacho.vendedor?.telefono

  // Formateadores de RIF y Teléfono con espacios simples
  const rawRif = (cliente.rif_cedula || cliente.rif || '—').toUpperCase()
  let formattedRif = rawRif
  const cleanRif = rawRif.replace(/[-.\s]/g, '')
  if (cleanRif.length === 10 && /^[VJGVEV]\d{9}$/i.test(cleanRif)) {
    formattedRif = `${cleanRif[0]} ${cleanRif.slice(1, 4)} ${cleanRif.slice(4, 7)} ${cleanRif.slice(7)}`
  } else {
    formattedRif = rawRif.replace(/-/g, ' ')
  }

  const formattedClienteTlf = cliente.telefono ? formatTlfDash(cliente.telefono) : '—'
  const formattedSellerTlf = tlfVendedor ? formatTlfDash(tlfVendedor) : ''
  const sellerTlfStr = formattedSellerTlf ? ` ${formattedSellerTlf}` : ''
  const vNombre = (vendedorResponsable?.nombre || despacho.vendedor?.nombre || '').toUpperCase()
  const displaySeller = `${vNombre}${sellerTlfStr}`.trim() || '—'

  let displayDate = '—'
  if (despacho.creado_en) {
    const dateObj = new Date(despacho.creado_en + (String(despacho.creado_en).includes('T') ? '' : 'T12:00:00'))
    const day = dateObj.getDate()
    const month = dateObj.getMonth() + 1
    const year = dateObj.getFullYear()
    displayDate = `${day}/${month}/${year}`
  }

  const displayInvoice = String(nroFactura).padStart(7, '0')
  const displayControlPadded = String(nroControl).toUpperCase().padStart(7, '0')

  const gY = esMembrete ? 50 : 36
  
  // Calcular las líneas de la dirección fiscal con antelación para expandir la cabecera dinámicamente si es necesario
  const dirStr = [cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ').toUpperCase() || '—'
  const line4Prefix = 'Direccion Fiscal : '
  const line4 = `${line4Prefix}${dirStr}`

  const maxLeftColW = 108
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const dirLines = doc.splitTextToSize(line4, maxLeftColW)
  const extraLines = Math.max(0, dirLines.length - 1)
  const dirLineSpacing = 3.8
  const extraH = extraLines * dirLineSpacing
  const headerTotalH = 31 + extraH

  // Si no es membrete, dibujamos el logo y los datos de la empresa arriba del recuadro
  if (!esMembrete) {
    try { doc.addImage(LOGO_DESPACHO, 'PNG', MARGIN, 11, 15, 15) } catch (_) { /* ignore */ }
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C_DARK)
    let n = config.nombre_negocio || 'Listo POS C.A.'
    if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'Listo POS C.A.'
    doc.text(n.toUpperCase(), MARGIN + 18, 16)
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(`RIF: ${rif}`, MARGIN + 18, 21)
    
    const tel = fmtTelefono(config.telefono_negocio) || ''
    if (tel) {
      doc.text(`TELÉFONO: ${tel}`, MARGIN + 18, 26)
    }
  }

  // Dibujar recuadro gris fino unificado sin líneas internas
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)
  doc.rect(MARGIN, gY, CONTENT_W, headerTotalH, 'S')

  // Posiciones Y de las 4 líneas
  const lineSpacing = 6.8
  const pY1 = gY + 5.5
  const pY2 = pY1 + lineSpacing
  const pY3 = pY2 + lineSpacing
  const pY4 = pY3 + lineSpacing

  const col1X = MARGIN + 4

  // --- COLUMNA 1 (IZQUIERDA) ---
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C_DARK)

  // Fila 1: Cliente
  doc.setFontSize(8.5)
  const cNombre = (cliente.nombre || '—').toUpperCase()
  const line1 = `Cliente : ${cNombre}`
  let displayLine1 = line1
  if (doc.getTextWidth(displayLine1) > maxLeftColW) {
    while (displayLine1.length > 1 && doc.getTextWidth(displayLine1 + '…') > maxLeftColW) displayLine1 = displayLine1.slice(0, -1)
    displayLine1 += '…'
  }
  doc.text(displayLine1, col1X, pY1)

  // Fila 2: R.F.I/C.I.
  const line2 = `R.F.I/C.I. : ${formattedRif}`
  let displayLine2 = line2
  if (doc.getTextWidth(displayLine2) > maxLeftColW) {
    while (displayLine2.length > 1 && doc.getTextWidth(displayLine2 + '…') > maxLeftColW) displayLine2 = displayLine2.slice(0, -1)
    displayLine2 += '…'
  }
  doc.text(displayLine2, col1X, pY2)

  // Fila 3: Telefonos
  const line3 = `Telefonos : ${formattedClienteTlf}`
  let displayLine3 = line3
  if (doc.getTextWidth(displayLine3) > maxLeftColW) {
    while (displayLine3.length > 1 && doc.getTextWidth(displayLine3 + '…') > maxLeftColW) displayLine3 = displayLine3.slice(0, -1)
    displayLine3 += '…'
  }
  doc.text(displayLine3, col1X, pY3)

  // Fila 4: Direccion Fiscal (con soporte para múltiples líneas dinámicas)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  dirLines.forEach((line, idx) => {
    doc.text(line, col1X, pY4 + idx * dirLineSpacing)
  })

  // --- COLUMNA 2 (DERECHA) ---
  const col2LabelX = MARGIN + 115
  const col2ValueX = PAGE_W - MARGIN - 4

  // Fila 1: FACTURA NUMERO
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('FACTURA NUMERO:', col2LabelX, pY1)
  doc.text(displayInvoice, col2ValueX, pY1, { align: 'right' })

  // Fila 2: Emision
  doc.text('Emision : ', col2LabelX, pY2)
  doc.text(displayDate, col2ValueX, pY2, { align: 'right' })
  // Subrayado exacto del valor de la fecha
  const dateW = doc.getTextWidth(displayDate)
  const underlineY = pY2 + 0.8
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.line(col2ValueX - dateW, underlineY, col2ValueX, underlineY)

  // Fila 3: Vendedor
  doc.text('Vendedor : ', col2LabelX, pY3)
  const vendLabelW = doc.getTextWidth('Vendedor : ')
  const maxVendValW = col2ValueX - (col2LabelX + vendLabelW) - 2
  let displaySellerTrunc = displaySeller
  if (doc.getTextWidth(displaySellerTrunc) > maxVendValW) {
    while (displaySellerTrunc.length > 1 && doc.getTextWidth(displaySellerTrunc + '…') > maxVendValW) displaySellerTrunc = displaySellerTrunc.slice(0, -1)
    displaySellerTrunc += '…'
  }
  doc.text(displaySellerTrunc, col2ValueX, pY3, { align: 'right' })

  // Fila 4: N° CONTROL
  doc.text('N° CONTROL', col2LabelX, pY4)
  doc.text(displayControlPadded, col2ValueX, pY4, { align: 'right' })

  y = gY + headerTotalH + 3

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

  // Cabecera tabla
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, y, CONTENT_W, 7.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...C_DARK)
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

  const isLargeDoc = itemsToRender.length >= 23

  itemsToRender.forEach((item) => {
    // Calcular cuántas líneas necesita la descripción
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const descLines = doc.splitTextToSize((item.nombre_snap || '').toUpperCase(), COLS[2].w - 4)
    const lineH = 3.6
    const ROW_H = Math.max(ROW_H_BASE, descLines.length * lineH + 1.2)

    let limitY = PAGE_H - 40 // Margen de seguridad para el footer
    
    // BALANCEO INTELIGENTE: Si hay más de 20 items, cortamos antes en la Pág 1
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 120
    }
    
    if (y + ROW_H > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numFac)
      // Redraw table header
      doc.setFillColor(255, 255, 255)
      doc.setDrawColor(120, 120, 120)
      doc.setLineWidth(0.3)
      doc.rect(MARGIN, y, CONTENT_W, 7.5, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C_DARK)
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

    const precioText = fmtPrecioFac(precioUnitarioAMostrar, monedaPDF, tasa, factorBcv)
    const totalText = fmtPrecioFac(totalLineaAMostrar, monedaPDF, tasa, factorBcv)

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
  y = y + 2

  // Margen superior membrete: 50mm (5cm) | Margen inferior: 25mm (2.5cm)
  // creditRowY = sloganY - 4 - CREDIT_ROW_H → borde inferior = sloganY - 4 = PAGE_H - 25
  const sloganY = PAGE_H - 21

  // ── Cálculo del IVA (16% sumado) ──
  const totalOriginal = items.reduce((acc, it) => acc + (it.es_prestamo ? (Number(it.cantidad || 0) * Number(it.precio_unit_usd || 0)) : Number(it.total_linea_usd || 0)), 0)
  const total = totalOriginal * factor
  const flete = Number(despacho.flete_usd || 0)
  const corte = Number(despacho.corte_usd || 0)
  const montoExento = flete + corte
  const descuentoTotalOriginal = Number(despacho.descuento_total_usd || 0)
  const descuentoTotal = descuentoTotalOriginal * factor
  const totalFinal = total - descuentoTotal

  const baseImponible = totalFinal  // El total de los productos (después de descuentos, excluyendo flete/corte) es la Base Imponible
  const ivaPct = config.iva_pct !== undefined && config.iva_pct !== null ? Number(config.iva_pct) : 16
  const ivaAmount = baseImponible * (ivaPct / 100)  // Se le suma el % de IVA configurado
  const totalFacturaFinal = baseImponible + ivaAmount + montoExento

  const hasExento = montoExento > 0
  const hasFlete = flete > 0
  const hasDescuento = descuentoTotal > 0
  const transportista = despacho.transportista_id ? (despacho.transportista || null) : null
  const refPago = despacho.referencia_pago || ''

  // ══════════════════════════════════════════════════════════════════════════
  // 4. BLOQUE COMBINADO: Crédito + Transporte (izq) | Desglose (der) + TOTAL
  // ══════════════════════════════════════════════════════════════════════════
  // Desglose de totales de factura
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
    rightItems.push({ label: 'SubTotal:', value: fmtTotalFac(subtotalOriginal, monedaPDF, tasa, factorBcv) })
    rightItems.push({ label: `Desc. Personal (${descPersonalPct}%):`, value: '-' + fmtTotalFac(descuentoPersonal, monedaPDF, tasa, factorBcv), color: [180, 100, 0] })
  } else {
    rightItems.push({ label: 'SubTotal:', value: fmtTotalFac(total, monedaPDF, tasa, factorBcv) })
  }

  if (hasDescuento) {
    rightItems.push({ label: 'Descuento:', value: '-' + fmtTotalFac(descuentoTotal, monedaPDF, tasa, factorBcv), color: [220, 38, 38] })
  }
  if (hasExento) {
    rightItems.push({ label: 'Exento:', value: fmtTotalFac(montoExento, monedaPDF, tasa, factorBcv), color: [50, 100, 180] })
  }
  rightItems.push({ label: 'Base Gravable:', value: fmtTotalFac(baseImponible, monedaPDF, tasa, factorBcv) })
  rightItems.push({ label: `IVA ${ivaPct}%:`, value: fmtTotalFac(ivaAmount, monedaPDF, tasa, factorBcv) })
  rightItems.push({ label: 'IGTF 3%:', value: fmtTotalFac(0, monedaPDF, tasa, factorBcv) })

  if (refPago) {
    rightItems.push({ label: 'Ref:', value: refPago })
  }

  const numComboRows = rightItems.length
  const totalBarH = 5.5
  const CREDIT_ROW_H = 4.5
  const creditRowY = sloganY - 4 - CREDIT_ROW_H
  const comboBottom = creditRowY - 2
  const dataRowH = 3.6
  const comboTop = comboBottom - totalBarH - numComboRows * dataRowH



  // Dibujar desglose
  const comboLeftW = CONTENT_W - 90
  const comboRightW = CONTENT_W - comboLeftW

  for (let r = 0; r < numComboRows; r++) {
    const ry = comboTop + r * dataRowH

    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN + comboLeftW, ry, comboRightW, dataRowH, 'S')
    
    const item = rightItems[r]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.2)
    doc.setTextColor(...C_DARK)
    doc.text(item.label, MARGIN + comboLeftW + 3, ry + dataRowH / 2 + 0.8)
    doc.text(item.value, MARGIN + CONTENT_W - 3, ry + dataRowH / 2 + 0.8, { align: 'right' })
  }

  // Barra TOTAL Factura
  const totTopY = comboTop + numComboRows * dataRowH
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN + comboLeftW, totTopY, comboRightW, totalBarH, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C_DARK)
  doc.text('Total Factura:', MARGIN + comboLeftW + 3, totTopY + 4.8)
  doc.text(fmtTotalFac(totalFacturaFinal, monedaPDF, tasa, factorBcv), MARGIN + CONTENT_W - 3, totTopY + 4.8, { align: 'right' })

  // (Condiciones de pago eliminadas)

  // ── Slogan ──
  if (y < sloganY) {
    if (!esMembrete) {
      doc.setFont('helvetica', 'bolditalic')
      doc.setFontSize(12)
      doc.setTextColor(...C_DARK)
      doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })
    }
  }

  // ── FOOTER LIMPIO ──
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H
    if (!esMembrete) {
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

  // ── Guardar o devolver blob ──
  const clienteNombreDes = ((despacho.cliente_factura || despacho.cliente)?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaDes = (despacho.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `FACTURA_${numFac.replace(/ /g, '_')}_${clienteNombreDes}_${fechaDes}.pdf`
  if (returnBlob) return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return { filename }
}
