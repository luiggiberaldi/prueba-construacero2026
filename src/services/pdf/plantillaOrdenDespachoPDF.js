// src/services/pdf/plantillaOrdenDespachoPDF.js
// Plantilla VACÍA de Orden de Despacho — para llenado a mano
// Basada en ordenDespachoPDF.js pero sin datos
// Sin footer, cuentas, slogan ni condiciones (igual que la orden de despacho)
import { jsPDF } from 'jspdf'
import { LOGO_DESPACHO } from './logoDespachoBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_DARK, C_WHITE,
  drawWatermark,
} from './pdfShared'

function drawCheck(doc, label, x, y) {
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.rect(x, y - 2.5, 3, 3, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text(label, x + 4.5, y)
}

export async function generarPlantillaOrdenDespachoPDF({ config = {}, incluirTransporte = true } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  let y = 0

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CABECERA
  // ══════════════════════════════════════════════════════════════════════════
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
  let r = config.rif_negocio ? `RIF: ${config.rif_negocio}` : 'RIF.: J-50115913-0'
  doc.text(r, centerX, 22, { align: 'center' })

  doc.setLineWidth(0.8)
  doc.setDrawColor(...C_DARK)
  doc.line(MARGIN, HDR_H + 10, PAGE_W - MARGIN, HDR_H + 10)

  y = HDR_H + 17

  // Marca de agua
  drawWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DATOS DEL CLIENTE — cuadrícula vacía
  // ══════════════════════════════════════════════════════════════════════════
  const gridLW = 0.3
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(gridLW)

  const gY = y - 4
  const rowH = 7
  const leftColW = 38
  const rightLblW = 22
  const rightValW = 38
  const centerW = CONTENT_W - leftColW - rightLblW - rightValW

  // Celda izquierda: DEPARTAMENTO DE VENTAS
  const tripleH = rowH * 3
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

  const rLblX = MARGIN + leftColW + centerW
  const rValX = rLblX + rightLblW

  // Fila 1: ODC
  doc.rect(rLblX, gY, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('ODC', rLblX + rightLblW / 2, gY + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, gY, rightValW, rowH, 'S')

  // Fila 2: DIA
  const f2Y = gY + rowH
  doc.rect(rLblX, f2Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('DIA', rLblX + rightLblW / 2, f2Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f2Y, rightValW, rowH, 'S')

  // Fila 3: FECHA
  const f3Y = gY + rowH * 2
  doc.rect(rLblX, f3Y, rightLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('FECHA:', rLblX + rightLblW / 2, f3Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(rValX, f3Y, rightValW, rowH, 'S')

  // Fila 4: CLIENTE + R.I.F
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
  doc.rect(MARGIN + clienteLblW + clienteValW, f4Y, rifLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('R.I.F.,C.I.', MARGIN + clienteLblW + clienteValW + rifLblW / 2, f4Y + rowH / 2 + 1, { align: 'center' })
  doc.rect(MARGIN + clienteLblW + clienteValW + rifLblW, f4Y, rifValW, rowH, 'S')

  // Fila 5: DIRECCIÓN
  const f5Y = f4Y + rowH
  const dirLblW = 25
  doc.rect(MARGIN, f5Y, dirLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('DIRECCIÓN:', MARGIN + 2, f5Y + rowH / 2 + 1)
  doc.rect(MARGIN + dirLblW, f5Y, CONTENT_W - dirLblW, rowH, 'S')

  // Fila 6: TELÉFONO + VENDEDOR
  const f6Y = f5Y + rowH
  const tlfLblW = 25
  const tlfValW = 35
  const vendLblW = 25
  const vendValW = CONTENT_W - tlfLblW - tlfValW - vendLblW

  doc.rect(MARGIN, f6Y, tlfLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('TELÉFONO:', MARGIN + 2, f6Y + rowH / 2 + 1)
  doc.rect(MARGIN + tlfLblW, f6Y, tlfValW, rowH, 'S')
  doc.rect(MARGIN + tlfLblW + tlfValW, f6Y, vendLblW, rowH, 'S')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('VENDEDOR:', MARGIN + tlfLblW + tlfValW + 2, f6Y + rowH / 2 + 1)
  doc.rect(MARGIN + tlfLblW + tlfValW + vendLblW, f6Y, vendValW, rowH, 'S')

  y = f6Y + rowH + 2

  // ══════════════════════════════════════════════════════════════════════════
  // 3. TABLA DE PRODUCTOS — cabecera + filas vacías
  // ══════════════════════════════════════════════════════════════════════════
  const COLS = [
    { label: 'CANT.',       x: MARGIN,        w: 11,  align: 'center' },
    { label: 'CÓD.',        x: MARGIN + 11,   w: 20,  align: 'center' },
    { label: 'DESCRIPCIÓN', x: MARGIN + 31,   w: 91,  align: 'center' },
    { label: 'UNID.',       x: MARGIN + 122,  w: 11,  align: 'center' },
    { label: 'PRECIO',      x: MARGIN + 133,  w: 27,  align: 'center' },
    { label: 'TOTAL',       x: MARGIN + 160,  w: 28,  align: 'right'  },
  ]

  // Cabecera oscura
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

  // Filas vacías para llenar a mano
  const BLANK_ROW_H = 6.5
  const CHOFER_H = incluirTransporte ? 30 : 0
  const choferY = PAGE_H - MARGIN - CHOFER_H
  const fpY = incluirTransporte ? choferY - 24 : PAGE_H - MARGIN - 24
  const notasH = 20
  const availableH = fpY - y - notasH - 3
  const BLANK_ROWS = Math.max(1, Math.floor(availableH / BLANK_ROW_H))
  doc.setLineWidth(0.2)
  doc.setDrawColor(200, 200, 200)
  for (let i = 0; i < BLANK_ROWS; i++) {
    doc.rect(MARGIN, y, CONTENT_W, BLANK_ROW_H, 'S')
    COLS.forEach(col => { doc.line(col.x, y, col.x, y + BLANK_ROW_H) })
    y += BLANK_ROW_H
  }

  // Notas — líneas vacías
  y += 3
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C_DARK)
  doc.text('NOTAS:', MARGIN, y + 4)
  y += 6
  for (let i = 0; i < 2; i++) {
    doc.setLineWidth(0.3)
    doc.setDrawColor(150, 150, 150)
    doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5)
    y += 5.5
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Layout fijo desde el fondo: Chofer en footer, Totales encima
  // ══════════════════════════════════════════════════════════════════════════

  // Forma de pago (sin marcar)
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, fpY, CONTENT_W, 9, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text('FORMA DE PAGO:', MARGIN + 3, fpY + 6)
  drawCheck(doc, 'EFECTIVO $',  MARGIN + 38, fpY + 6)
  drawCheck(doc, 'EFECTIVO Bs', MARGIN + 58, fpY + 6)
  drawCheck(doc, 'ZELLE',       MARGIN + 78, fpY + 6)
  drawCheck(doc, 'P. MÓVIL',    MARGIN + 94, fpY + 6)
  drawCheck(doc, 'USDT',        MARGIN + 114, fpY + 6)
  drawCheck(doc, 'TRANSF.',     MARGIN + 130, fpY + 6)
  drawCheck(doc, 'CTA X COB.',  MARGIN + 150, fpY + 6)

  // Barra TOTAL — fondo blanco, borde, "Total:" en negro
  const totTopY = fpY + 9
  doc.setDrawColor(160, 160, 160)
  doc.setLineWidth(0.15)
  doc.rect(MARGIN, totTopY, CONTENT_W, 10, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C_DARK)
  doc.text('Total:', MARGIN + 4, totTopY + 7)

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DATOS DEL CHOFER Y VEHÍCULO — vacíos (2 filas: 3+4 cols como en la llena)
  // ══════════════════════════════════════════════════════════════════════════
  if (incluirTransporte) {
  doc.setFillColor(240, 240, 240)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'F')
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, choferY, CONTENT_W, 6, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text('DATOS DEL CHOFER Y DEL VEHÍCULO', MARGIN + 2, choferY + 4)

  const ROW_H2 = 12
  const row1Y = choferY + 6
  const row2Y = row1Y + ROW_H2
  const col3W = CONTENT_W / 3
  const col4W = CONTENT_W / 4

  // Fila 1: CHOFER, C.I., COLOR
  const row1Labels = ['CHOFER', 'C.I.', 'COLOR']
  row1Labels.forEach((label, i) => {
    const fx = MARGIN + i * col3W
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.3)
    doc.rect(fx, row1Y, col3W, ROW_H2, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 100, 100)
    doc.text(label, fx + 2, row1Y + 3.5)
  })

  // Fila 2: VEHÍCULO, PLACA CHUTO, PLACA BATEA
  const row2Labels = ['VEHÍCULO', 'PLACA CHUTO', 'PLACA BATEA']
  row2Labels.forEach((label, i) => {
    const fx = MARGIN + i * col3W
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.3)
    doc.rect(fx, row2Y, col3W, ROW_H2, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 100, 100)
    doc.text(label, fx + 2, row2Y + 3.5)
  })
  }

  // Sin footer, sin cuentas, sin slogan, sin condiciones

  doc.save('plantilla_orden_despacho.pdf')
}
