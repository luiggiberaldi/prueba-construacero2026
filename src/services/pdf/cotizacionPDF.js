// Genera PDF profesional de Cotización — formato Listo POS
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_WHITE,
  CUENTAS_BANCARIAS,
  fmtFecha, fmtPrecio, fmtTotal, fmtTelefono,
  hexToRgb, drawWatermark, drawSimplifiedHeader,
  checkPage
} from './pdfShared'

// Nueva paleta de colores premium: Fusión Industrial de Alta Gama (Amarillo Principal & Charcoal de Cerrajería)
const C_PRIMARY = [255, 242, 0]    // Amarillo de alta visibilidad (Color principal de la marca)
const C_ACCENT  = [59, 59, 59]      // Gris #3b3b3b (Acento de la marca)
const C_DARK    = [59, 59, 59]      // Gris #3b3b3b para texto legible

export async function generarPDF({ cotizacion, items = [], config = {}, returnBlob = false, monedaPDF = '$', tasa = 0, tasaUsdt = 0, tasaBcv = 0, conIVA = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  let y = 0

  // Factor BCV: cuántos dólares BCV equivale 1 USDT (ej: 1.30)
  const factorBcv = (tasaUsdt > 0 && tasaBcv > 0) ? tasaUsdt / tasaBcv : 0

  const logoData = await cargarLogo(config.logo_url)
  const rif = config.rif_negocio || 'J-50115913-0'

  const drawHeader = (doc, num) => {
    const HDR_H = 40
    doc.setFillColor(...C_PRIMARY)
    doc.rect(0, 0, PAGE_W, HDR_H, 'F')

    // Decoraciones: Cuadrícula de puntos
    doc.setFillColor(...C_ACCENT)
    for(let i = 0; i < 4; i++) {
      for(let j = 0; j < 6; j++) {
        doc.circle(MARGIN + i * 2.5, 4 + j * 2.5, 0.4, 'F')
      }
    }

    // Cuadro derecho con franjas diagonales "Hazard" idéntico al zoom de la cerrajería
    const hazBgW = 45
    const hazBgX = PAGE_W - hazBgW
    
    // 2. Franja superior en Amarillo Mostaza en la esquina derecha (con borde izquierdo inclinado /)
    doc.setFillColor(...C_ACCENT)
    const solidStartX = PAGE_W - 25.2
    const solidStartBottomX = solidStartX - 2.5
    
    // Dibujamos el rectángulo y el triángulo con sus coordenadas matemáticas originales y perfectas.
    doc.rect(solidStartX, 0, PAGE_W - solidStartX, 6, 'F')
    doc.triangle(solidStartX, 0, solidStartBottomX, 6, solidStartX, 6, 'F')
    
    // Fusionamos la costura vertical con una línea interna que NO llega a los bordes superior e inferior
    // para evitar cualquier deformación de las esquinas o caps redondeados que sobresalgan.
    doc.setLineWidth(0.5)
    doc.setDrawColor(...C_ACCENT)
    doc.line(solidStartX, 0.5, solidStartX, 5.5)
    
    // 3. Diagonales en Amarillo Mostaza inclinadas - Paralelogramos con inclinación /
    const diagStartX = PAGE_W - 42.0
    const stripeWidth = 1.4 // Ancho de cada franja
    const stripeSlant = 2.5 // Inclinación lateral hacia la izquierda en la base
    for (let i = 0; i < 6; i++) {
      const lx = diagStartX + i * 2.8
      // Dibujamos un paralelogramo geométrico impecable y perfectamente paralelo
      doc.triangle(lx, 0, lx + stripeWidth, 0, lx - stripeSlant, 6, 'F')
      doc.triangle(lx + stripeWidth, 0, lx - stripeSlant + stripeWidth, 6, lx - stripeSlant, 6, 'F')
      
      // Fusionamos la diagonal interna con una línea de soldadura que se detiene 0.5mm antes de los bordes.
      // Esto elimina las costuras sub-píxel y garantiza líneas de contorno vectoriales 100% limpias y rectas.
      doc.line(lx + stripeWidth - 0.2, 0.5, lx - stripeSlant + 0.2, 5.5)
    }
    
    // 4. Puntos negros decorativos en la parte amarilla inferior derecha (micro-dots refinados)
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 2; j++) {
        doc.circle(PAGE_W - 16 + i * 3.0, 9.5 + j * 2.5, 0.3, 'F')
      }
    }

    // Elegante línea divisoria en amarillo mostaza cálido en la base del banner
    doc.setLineWidth(1.0)
    doc.setDrawColor(...C_ACCENT)
    doc.line(0, HDR_H, PAGE_W, HDR_H)

    // Micro-indicadores técnicos de alineación (Estilo Formalismo Industrial Blueprint)
    doc.setLineWidth(0.12)
    doc.setDrawColor(180, 188, 200) // Slate gris azulado sutil
    // Superior izquierdo
    doc.line(MARGIN - 2, 46, MARGIN + 2, 46)
    doc.line(MARGIN, 44, MARGIN, 48)
    // Superior derecho
    doc.line(PAGE_W - MARGIN - 2, 46, PAGE_W - MARGIN + 2, 46)
    doc.line(PAGE_W - MARGIN, 44, PAGE_W - MARGIN, 48)
    // Inferior izquierdo (anclado sobre el slogan)
    doc.line(MARGIN - 2, PAGE_H - 33, MARGIN + 2, PAGE_H - 33)
    doc.line(MARGIN, PAGE_H - 35, MARGIN, PAGE_H - 31)
    // Inferior derecho
    doc.line(PAGE_W - MARGIN - 2, PAGE_H - 33, PAGE_W - MARGIN + 2, PAGE_H - 33)
    doc.line(PAGE_W - MARGIN, PAGE_H - 35, PAGE_W - MARGIN, PAGE_H - 31)

    // Logo
    if (logoData) {
      try { doc.addImage(logoData, 'PNG', MARGIN + 11, 3, 34, 34) } catch (_) {}
    }

    let n = config.nombre_negocio || 'Listo POS C.A.'
    if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'Listo POS C.A.'
    const words = n.split(' ')
    const main = (words[0] || 'LISTO').toUpperCase()
    const secondary = words.slice(1).join(' ').toUpperCase() || 'POS C.A.'

    // Títulos Negocio
    const textCenterX = (MARGIN + 44 + PAGE_W - MARGIN - 40) / 2
    doc.setFont('times', 'bold')
    doc.setTextColor(...C_ACCENT)
    doc.setFontSize(24)
    doc.text(main, textCenterX, 18, { align: 'center' })
    doc.setFontSize(16)
    doc.text(secondary, textCenterX, 27, { align: 'center' })

    // "Cotización" + número
    doc.setFontSize(13)
    doc.text('Cotización', PAGE_W - MARGIN, HDR_H - 10, { align: 'right' })
    doc.setFontSize(11)
    doc.text(num, PAGE_W - MARGIN, HDR_H - 4, { align: 'right' })

    return HDR_H + 6
  }


  const numDisplay = `Nº- ${String(cotizacion.numero).padStart(5, '0')}`
  let pageNum = 1

  y = drawHeader(doc, numDisplay)

  // ── Marca de agua central ──
  drawWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula con celdas
  // ══════════════════════════════════════════════════════════════════════════
  const cliente = cotizacion.cliente || {}
  const esPersonal = cliente.tipo_cliente === 'personal'
  const descPersonalPct = esPersonal ? (config.descuento_personal_pct ?? 10) : 0

  // Encabezado tipo "COTIZACIÓN:" - Rediseñado para el Formalismo Industrial
  const cotBarY = y - 4
  doc.setFillColor(246, 248, 250)
  doc.rect(MARGIN, cotBarY, CONTENT_W, 7, 'F')
  doc.setDrawColor(220, 225, 230)
  doc.setLineWidth(0.2)
  doc.rect(MARGIN, cotBarY, CONTENT_W, 7, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C_DARK)
  doc.text('COTIZACIÓN:', MARGIN + 3, cotBarY + 5)
  y = cotBarY + 7

  const ROW_H_INFO = 6
  const halfW = CONTENT_W / 2
  doc.setLineWidth(0.2)
  doc.setDrawColor(220, 225, 230)

  // Helper para dibujar celda con label + valor - Rejilla Suiza ultra-precisa
  const drawCell = (x, cellY, w, label, val, opts = {}) => {
    doc.rect(x, cellY, w, ROW_H_INFO, 'S')
    if (opts.fill) {
      doc.setFillColor(246, 248, 250)
      doc.rect(x, cellY, w, ROW_H_INFO, 'F')
      doc.rect(x, cellY, w, ROW_H_INFO, 'S')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(`${label}:`, x + 2, cellY + 4.5)
    const lblW = doc.getTextWidth(`${label}: `)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    doc.text(String(val || '—'), x + 2 + lblW + 1, cellY + 4.8)
  }

  // Fila 1: Emisión (ancho completo)
  drawCell(MARGIN, y, CONTENT_W, 'Emisión', fmtFecha(cotizacion.creado_en))
  y += ROW_H_INFO

  // Fila 2: Cliente | R.I.F / Cédula
  const nameDisplay = cliente.tipo_cliente === 'personal'
    ? `${(cliente.nombre || '').toUpperCase()} (PERSONAL)`
    : (cliente.nombre || '').toUpperCase()
  drawCell(MARGIN, y, halfW, 'Cliente', nameDisplay)
  drawCell(MARGIN + halfW, y, halfW, 'R.I.F / Cédula', cliente.rif_cedula)
  y += ROW_H_INFO

  // Fila 3: Teléfono | Correo
  drawCell(MARGIN, y, halfW, 'Teléfono', fmtTelefono(cliente.telefono))
  drawCell(MARGIN + halfW, y, halfW, 'Correo', cliente.email)
  y += ROW_H_INFO

  // Fila 4: Vendedor (ancho completo, fondo gris)
  // Priorizar el vendedor asignado al cliente (dueño de la cuenta)
  const vendedorResponsable = cliente.vendedor || cotizacion.vendedor
  // Fallback de teléfono: si el dueño no tiene tlf, mostrar el del que cotiza para que haya un contacto
  const tlfVendedor = vendedorResponsable?.telefono || cotizacion.vendedor?.telefono
  const vendedorStr = (vendedorResponsable?.nombre?.toUpperCase() || '—') + (tlfVendedor ? ` — ${fmtTelefono(tlfVendedor)}` : '')
  drawCell(MARGIN, y, CONTENT_W, 'Vendedor', vendedorStr, { fill: true })
  y += ROW_H_INFO

  // Fila 5: Dirección Fiscal (ancho completo) — multilínea si es larga
  const dirFiscal = [cliente.direccion, cliente.ciudad?.toUpperCase(), cliente.estado?.toUpperCase()].filter(Boolean).join(', ') || '—'
  {
    const dirLabel = 'Dirección Fiscal'
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const dirLblW = doc.getTextWidth(`${dirLabel}: `)
    const dirAvailW = CONTENT_W - 2 - dirLblW - 3 // margen izq + derecho
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    const dirLines = doc.splitTextToSize(String(dirFiscal), dirAvailW)
    const dirLineH = 4.5
    const dirCellH = Math.max(ROW_H_INFO, dirLines.length * dirLineH + 3)
    doc.setLineWidth(0.2)
    doc.setDrawColor(220, 225, 230)
    doc.rect(MARGIN, y, CONTENT_W, dirCellH, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(`${dirLabel}:`, MARGIN + 2, y + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_DARK)
    dirLines.forEach((line, idx) => {
      doc.text(line, MARGIN + 2 + dirLblW + 1, y + 4.8 + idx * dirLineH)
    })
    y += dirCellH
  }

  y += 3

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS
  // ══════════════════════════════════════════════════════════════════════════
  const precioLabel = monedaPDF === 'bs' ? 'PRECIO Bs' : monedaPDF === 'bcv' ? 'PRECIO BCV' : monedaPDF === 'mixto_bcv' ? 'PRECIO BCV' : 'PRECIO'
  const totalLabel  = monedaPDF === 'bs' ? 'TOTAL Bs'  : monedaPDF === 'bcv' ? 'TOTAL BCV'  : monedaPDF === 'mixto_bcv' ? 'TOTAL BCV' : 'TOTAL'
  // Anchos fijos que funcionan para cualquier moneda
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 13,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 13,   w: 15,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 28,   w: 96,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 124,  w: 9,   align: 'center' },
    { label: precioLabel,    x: MARGIN + 133,  w: 27,  align: 'center' },
    { label: totalLabel,     x: MARGIN + 160,  w: 28,  align: 'right'  },
  ]
  const ROW_H_BASE = 6.0


  // Cabecera tabla - Azul Acero con texto Blanco para un anclaje premium
  doc.setFillColor(...C_PRIMARY)
  doc.rect(MARGIN, y, CONTENT_W, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C_ACCENT)
  COLS.forEach(col => {
    let tx = col.x + 2
    if (col.align === 'center') tx = col.x + col.w/2
    else if (col.align === 'right') tx = col.x + col.w - 2
    doc.text(col.label, tx, y + 6.5, { align: col.align })
  })
  y += 9

  // Items
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)

  const itemsToRender = [...items]
  const fleRef = Number(cotizacion.costo_envio_usd || 0)
  const corRef = Number(cotizacion.corte_usd || 0)
  if (fleRef > 0) itemsToRender.push({ codigo_snap: 'FTL1005632', nombre_snap: 'SERVICIO DE FLETE', unidad_snap: 'UND', precio_unit_usd: fleRef, total_linea_usd: fleRef, isExento: true })
  if (corRef > 0) itemsToRender.push({ codigo_snap: 'CRT1254698', nombre_snap: 'SERVICIO DE CORTE', unidad_snap: 'UND', precio_unit_usd: corRef, total_linea_usd: corRef, isExento: true })

  const isLargeDoc = itemsToRender.length >= 23

  itemsToRender.forEach((item) => {
    // Calcular cuántas líneas necesita la descripción
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const descLines = doc.splitTextToSize((item.nombre_snap || '').toUpperCase(), COLS[2].w - 4)
    const lineH = 4.0
    const rowH = Math.max(ROW_H_BASE, descLines.length * lineH + 2)

    let limitY = PAGE_H - 40 // Margen de seguridad para el footer
    
    // BALANCEO INTELIGENTE: 
    // Si el documento tiene más de 20 items, forzamos un corte temprano en la pág 1
    // para que la pág 2 no quede vacía y el documento se vea equilibrado.
    if (pageNum === 1 && itemsToRender.length > 20) {
      limitY = PAGE_H - 110 // Deja espacio para que ~12-15 items pasen a la siguiente página
    }
    
    if (y + rowH > limitY) {
      doc.addPage()
      pageNum++
      y = drawHeader(doc, numDisplay)
       // Redraw table header
       doc.setFillColor(...C_PRIMARY)
       doc.rect(MARGIN, y, CONTENT_W, 9, 'F')
       doc.setFont('helvetica', 'bold')
       doc.setFontSize(9.5)
       doc.setTextColor(...C_ACCENT)
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
    if (item.isExento) {
      doc.setFillColor(245, 250, 255)
      doc.rect(MARGIN, y, CONTENT_W, rowH, 'FD')
    } else {
      doc.rect(MARGIN, y, CONTENT_W, rowH, 'S')
    }
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + rowH) })

    const midY = y + rowH / 2 + 1.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)

    // Si es flete o falta la cantidad, mostrar 1 por defecto
    const isFlete = (item.nombre_snap || '').toUpperCase().includes('FLETE') || (item.codigo_snap || '').startsWith('FTL')
    const cantDisplay = item.cantidad ?? (isFlete ? 1 : '')
    doc.text(String(cantDisplay), COLS[0].x + COLS[0].w / 2, midY, { align: 'center' })
    doc.setFontSize(6.5)
    doc.text(item.codigo_snap || '—', COLS[1].x + COLS[1].w / 2, midY, { align: 'center' })
    doc.setFontSize(9)
    // Render all lines of the description
    const descStartY = y + (rowH - descLines.length * lineH) / 2 + lineH
    descLines.forEach((line, idx) => {
      doc.text(line, COLS[2].x + 2, descStartY + idx * lineH)
    })
    // UNID: auto-shrink si el texto no cabe (ej. "ROLLO")
    ;(() => {
      const unidText = (item.unidad_snap || '-').toUpperCase()
      const maxW = COLS[3].w - 1
      let fs = 9
      doc.setFont('helvetica', 'normal')
      while (fs > 6) { doc.setFontSize(fs); if (doc.getTextWidth(unidText) <= maxW) break; fs -= 0.5 }
      doc.text(unidText, COLS[3].x + COLS[3].w / 2, midY, { align: 'center' })
      doc.setFontSize(9)
    })()

    const tasaEfectiva = tasa > 0 ? tasa : Number(cotizacion.tasa_bcv_snapshot || 0)
    let precioUnitarioAMostrar = Number(item.precio_unit_usd || 0)
    let totalLineaAMostrar = Number(item.total_linea_usd || 0)

    const isCorte = (item.nombre_snap || '').toUpperCase().includes('CORTE') || (item.codigo_snap || '').startsWith('CRT')
    const esServicio = isFlete || isCorte || item.isExento === true || item.tiene_descuento === false

    if (esPersonal && descPersonalPct > 0 && !esServicio) {
      precioUnitarioAMostrar = Math.round((precioUnitarioAMostrar / (1 - descPersonalPct / 100)) * 100) / 100
      totalLineaAMostrar = precioUnitarioAMostrar * Number(item.cantidad || 0)
    }

    const precioText = fmtPrecio(precioUnitarioAMostrar, monedaPDF, tasaEfectiva, factorBcv)
    const totalText = fmtPrecio(totalLineaAMostrar, monedaPDF, tasaEfectiva, factorBcv)

    // Auto-reducir fuente si el precio no cabe en la columna
    const fitText = (text, col, baseFontSize, bold) => {
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

    fitText(precioText, COLS[4], 10.5, false)
    fitText(totalText, COLS[5], 10.5, true)
    doc.setFontSize(9)

    y += rowH
  })

  // 4. CONDICIONES + TOTALES + NOTAS
  // Calculamos la altura de cada bloque para ubicarlos anclados al fondo
  const bTotW = (monedaPDF === 'mixto' || monedaPDF === 'mixto_bcv') ? 90 : 75
  const bTotX = PAGE_W - MARGIN - bTotW
  const bLeftW = bTotX - MARGIN - 5
  const bConds = ['Precios Sujetos a cambios sin previo aviso.', 'El cliente se encarga de descargar la mercancía.']
  if (esPersonal) {
    const descPct = config.descuento_personal_pct ?? 10
    bConds.push(`Descuento de Personal del ${descPct}% desglosado en el total.`)
  }
  const bCP = 2, bCTH = 6, bCLH = 5.0
  const bBoxH = bCTH + bConds.length * bCLH + bCP * 2 + 1 // Altura bloque Condiciones
  
  const bSub = Number(cotizacion.subtotal_usd || 0)
  const bDesc = Number(cotizacion.descuento_usd || 0)
  const bTot = Number(cotizacion.total_usd || 0)
  const bTasa = tasa > 0 ? tasa : Number(cotizacion.tasa_bcv_snapshot || 0)
  const bExento = Number(cotizacion.costo_envio_usd || 0) + Number(cotizacion.corte_usd || 0)

  // Cálculo del IVA (16% sumado)
  const ivaPct = config.iva_pct !== undefined && config.iva_pct !== null ? Number(config.iva_pct) : 16
  const baseImponible = bTot - bExento
  const ivaAmount = baseImponible * (ivaPct / 100)
  const totalFacturaFinal = conIVA ? (bTot + ivaAmount) : bTot

  let subtotalOriginal = bSub
  let descuentoPersonal = 0

  if (esPersonal && descPersonalPct > 0) {
    let sumOriginal = 0
    items.forEach(it => {
      const cant = Number(it.cantidad || 0)
      const precio = Number(it.precio_unit_usd || 0)
      const precioOrig = Math.round((precio / (1 - descPersonalPct / 100)) * 100) / 100
      sumOriginal += precioOrig * cant
    })
    subtotalOriginal = sumOriginal
    descuentoPersonal = Math.max(0, subtotalOriginal - bSub)
  }

  const bLines = []
  if (conIVA) {
    bLines.push({ label: 'Subtotal:', val: fmtPrecio(subtotalOriginal, monedaPDF, bTasa, factorBcv) })
    if (esPersonal && descPersonalPct > 0) {
      bLines.push({ label: `Desc. Personal (${descPersonalPct}%):`, val: '-' + fmtPrecio(descuentoPersonal, monedaPDF, bTasa, factorBcv), color: [180, 100, 0] })
    }
    if (bDesc > 0) bLines.push({ label: 'Descuento:', val: '-' + fmtPrecio(bDesc, monedaPDF, bTasa, factorBcv), color: [220, 38, 38] })
    if (bExento > 0) bLines.push({ label: 'Exento:', val: fmtPrecio(bExento, monedaPDF, bTasa, factorBcv), color: [50, 100, 180] })
    bLines.push({ label: 'Base Gravable:', val: fmtPrecio(baseImponible, monedaPDF, bTasa, factorBcv) })
    bLines.push({ label: `IVA ${ivaPct}%:`, val: fmtPrecio(ivaAmount, monedaPDF, bTasa, factorBcv) })
  } else {
    bLines.push({ label: 'Subtotal:', val: fmtPrecio(subtotalOriginal, monedaPDF, bTasa, factorBcv) })
    if (esPersonal && descPersonalPct > 0) {
      bLines.push({ label: `Desc. Personal (${descPersonalPct}%):`, val: '-' + fmtPrecio(descuentoPersonal, monedaPDF, bTasa, factorBcv), color: [180, 100, 0] })
    }
    if (bDesc > 0) bLines.push({ label: 'Descuento:', val: '-' + fmtPrecio(bDesc, monedaPDF, bTasa, factorBcv), color: [220, 38, 38] })
    if (bExento > 0) bLines.push({ label: 'Exento:', val: fmtPrecio(bExento, monedaPDF, bTasa, factorBcv), color: [50, 100, 180] })
  }

  const bLH = 7
  const bTH = (bLines.length + 1) * bLH + 4
  const totalsTotalH = bTH + 10 - 2 // La caja redondeada + la caja azul de Total

  const blockH = Math.max(bBoxH, totalsTotalH)

  let notasH = 0
  let notasLineas = []
  if (cotizacion.notas_cliente?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    notasLineas = doc.splitTextToSize(cotizacion.notas_cliente.trim(), bLeftW)
    notasH = 5 + notasLineas.length * 5 // 5mm margen + lineas
  }

  // Verificamos si todo esto cabe
  const totalNeededH = (notasH > 0 ? notasH + 2 : 0) + blockH + 2 + 8 // 8 = altura slogan
  y = checkPage(doc, y, totalNeededH, (d) => drawSimplifiedHeader(d, logoData, config, `Cotización (Cont.) ${numDisplay}`, C_PRIMARY, C_ACCENT))

  // ── Slogan — fijo 10mm sobre el footer (PAGE_H - 35) ──
  const sloganY = PAGE_H - 35
  const topOfSlogan = sloganY - 6 // ~ top de 16pt

  // Bloque Totales/Condiciones -> ANCLADO 2mm por encima del slogan
  const blockFinalY = topOfSlogan - 2 - blockH
  
  // Si por alguna razón la tabla llega súper abajo, respetamos y para no solapar la tabla
  const finalY = Math.max(y + 6 + (notasH > 0 ? notasH + 2 : 0), blockFinalY)

  // DIBUJAR NOTAS (2mm sobre Condiciones)
  if (notasH > 0) {
    const notasStartY = finalY - 2 - notasH
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...C_PRIMARY)
    doc.text('NOTAS:', MARGIN, notasStartY + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C_DARK)
    notasLineas.forEach((lin, i) => {
      doc.text(lin, MARGIN, notasStartY + 4 + 5 + i * 5)
    })
  }

  // DIBUJAR CONDICIONES (Modular card de Formalismo Industrial con barra lateral sólida)
  doc.setFillColor(255, 255, 255) // Fondo blanco
  doc.setDrawColor(226, 232, 240) // Borde sutil
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN, finalY, bLeftW, bBoxH, 1.5, 1.5, 'FD')
  
  // Barra sólida de acento amarillo mostaza a la izquierda
  doc.setFillColor(...C_ACCENT)
  doc.rect(MARGIN, finalY, 2.0, bBoxH, 'F')
  
  // Ajustamos el padding horizontal (leftPad) para que el texto respete la barra de acento
  const leftPad = 4.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C_DARK)
  doc.text('CONDICIONES GENERALES:', MARGIN + leftPad, finalY + bCP + 4.5)
  doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3)
  doc.line(MARGIN + leftPad, finalY + bCP + bCTH, MARGIN + bLeftW - bCP, finalY + bCP + bCTH)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C_DARK)
  let bCY = finalY + bCP + bCTH + 4.5
  bConds.forEach(c => { doc.text('\u2022 ' + c, MARGIN + leftPad, bCY); bCY += bCLH })

  // DIBUJAR TOTALES
  doc.setFillColor(250, 250, 250); doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3)
  doc.roundedRect(bTotX, finalY, bTotW, bTH, 1.5, 1.5, 'FD')
  let bTy = finalY + 5
  bLines.forEach(l => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...(l.color || C_DARK))
    doc.text(l.label, bTotX + 4, bTy); doc.text(l.val, bTotX + bTotW - 4, bTy, { align: 'right' })
    bTy += bLH
  })
  doc.setFillColor(...C_PRIMARY); doc.rect(bTotX, bTy - 2, bTotW, 10, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...C_ACCENT)
  doc.text(conIVA ? 'Total Cotiz.' : 'Total:', bTotX + 4, bTy + 5)
  doc.text(fmtTotal(totalFacturaFinal, monedaPDF, bTasa, factorBcv), bTotX + bTotW - 4, bTy + 5, { align: 'right' })

  // DIBUJAR SLOGAN
  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(16)
  doc.setTextColor(...C_DARK)
  doc.text('"Todo lo puedo en Cristo que me fortalece" — Filipenses 4:13', PAGE_W / 2, sloganY, { align: 'center' })



  // ══════════════════════════════════════════════════════════════════════════
  // 5. FOOTER CON FRANJA DE PRECAUCIÓN
  // ══════════════════════════════════════════════════════════════════════════
  // Footer en páginas finales
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H
    {

    // Franja superior con las diagonales "Hazard" (Fondo azul oscuro con líneas amarillas)
    const hazardY = ph - 30
    doc.setFillColor(...C_PRIMARY)
    doc.rect(0, hazardY, PAGE_W, 4, 'F')

    doc.setDrawColor(...C_ACCENT)
    doc.setLineWidth(0.8)
    for(let k = 1; k < 20; k++) {
      doc.line(k * 4, hazardY, k * 4 - 3, hazardY + 4)
      doc.line(PAGE_W - k * 4, hazardY, PAGE_W - k * 4 + 3, hazardY + 4)
    }

    // Franja principal azul de acero oscuro corporativa
    doc.setFillColor(...C_PRIMARY)
    doc.rect(0, ph - 26, PAGE_W, 26, 'F')

    // ── Icono pin ubicación + dirección (en color blanco con pin amarillo accent) ──
    doc.setFillColor(...C_ACCENT)
    doc.setDrawColor(...C_ACCENT)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)

    const addr1 = config.direccion_negocio || 'Dirección Comercial'
    const addr2 = config.pie_pagina_pdf || (config.rif_negocio ? `RIF: ${config.rif_negocio}` : '')

    // Pin a la izquierda de addr1 (reajustado verticalmente)
    const addr1W = doc.getTextWidth(addr1)
    const addr1X = PAGE_W/2 - addr1W/2
    const pinX = addr1X - 4
    const pinY = ph - 17.5
    doc.circle(pinX, pinY - 0.3, 1.4, 'F')
    doc.triangle(pinX - 1.2, pinY, pinX + 1.2, pinY, pinX, pinY + 2.4, 'F')

    doc.text(addr1, PAGE_W/2, ph - 16, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(addr2, PAGE_W/2, ph - 11.5, { align: 'center' })

    const tel = fmtTelefono(config.telefono_negocio) || ''
    const email = config.email_negocio || ''
    if (tel || email) {
      const parts = []
      if (tel && tel !== '—') parts.push({ icon: 'phone', text: tel })
      if (email) parts.push({ icon: 'mail', text: email })

      // Calcular ancho total para centrar
      doc.setFont('helvetica', 'normal')
      const gap = 12
      let totalW = 0
      parts.forEach((p, i) => {
        totalW += 5 + doc.getTextWidth(p.text)
        if (i < parts.length - 1) totalW += gap
      })

      let cx = PAGE_W/2 - totalW/2
      const cy = ph - 5.5

      parts.forEach((p, i) => {
        doc.setFillColor(...C_ACCENT)
        doc.setDrawColor(...C_ACCENT)
        if (p.icon === 'phone') {
          // Icono teléfono: rectángulo redondeado
          doc.setLineWidth(0.4)
          doc.roundedRect(cx, cy - 2.2, 1.6, 2.8, 0.3, 0.3, 'S')
          doc.setLineWidth(0.3)
          doc.line(cx + 0.3, cy + 0.2, cx + 1.3, cy + 0.2)
        } else {
          // Icono sobre: rectángulo + V
          doc.setLineWidth(0.3)
          doc.rect(cx, cy - 1.8, 2.4, 1.8, 'S')
          doc.line(cx, cy - 1.8, cx + 1.2, cy - 0.6)
          doc.line(cx + 2.4, cy - 1.8, cx + 1.2, cy - 0.6)
        }
        doc.setTextColor(...C_DARK)
        doc.text(p.text, cx + 4, cy)
        cx += 5 + doc.getTextWidth(p.text) + gap
      })
    }
    } // fin bloque footer inner
  } // fin for páginas footer

  const clienteNombreCot = (cotizacion.cliente?.nombre || 'cliente').replace(/[^a-zA-Z0-9à-ÿ\s]/g, '').trim().replace(/\s+/g, '_').toUpperCase()
  const fechaCot = (cotizacion.creado_en || new Date().toISOString()).slice(0, 10)
  const filename = `${numDisplay.replace(/\s+/g, '_')}_${clienteNombreCot}_${fechaCot}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}
