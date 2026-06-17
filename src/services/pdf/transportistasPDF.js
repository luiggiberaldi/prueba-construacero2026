// src/services/pdf/transportistasPDF.js
// Genera PDF profesional del Listado Detallado de Choferes / Transportistas — Listo POS
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_ACCENT, C_GRAY,
  drawPremiumHeader
} from './pdfShared'

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

function drawHeader(doc, logoData, config) {
  return drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Base de Datos de Choferes / Equipos',
    subtitle: `Generado: ${new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}`
  })
}

function drawFooter(doc, config) {
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
}

export async function generarTransportistasPDF({ items = [], config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawHeader(doc, logoData, config)

  // Watermark
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  // KPIs
  const totalChoferes = items.length
  const kpiBoxH = 12
  
  doc.setFillColor(...C_PRIMARY)
  doc.roundedRect(MARGIN + 1, y, CONTENT_W - 2, kpiBoxH, 2, 2, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C_WHITE)
  doc.text('Total Choferes / Equipos Registrados', MARGIN + 4, y + 4.5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(String(totalChoferes), MARGIN + 4, y + 9.5)

  y += kpiBoxH + 8

  // Tabla
  const cols = [
    { label: 'NOMBRE / CHOFER', x: MARGIN, w: 40 },
    { label: 'CÉDULA / RIF', x: MARGIN + 40, w: 25 },
    { label: 'VEHÍCULO / COLOR', x: MARGIN + 65, w: 30 },
    { label: 'PLACAS (CHUTO/BATEA)', x: MARGIN + 95, w: 35 },
    { label: 'COBERTURA (ZONAS)', x: MARGIN + 130, w: 33 },
    { label: 'CAPACIDAD', x: MARGIN + 163, w: 25 },
  ]

  function drawTableHeaders(yPos) {
    doc.setFillColor(240, 242, 245)
    doc.rect(MARGIN, yPos, CONTENT_W, 7, 'F')
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos + 7, MARGIN + CONTENT_W, yPos + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(80, 90, 110)
    cols.forEach(col => doc.text(col.label, col.x + 1, yPos + 5))
    return yPos + 8
  }

  y = drawTableHeaders(y)

  items.forEach((item, idx) => {
    y = checkPage(doc, y, 7)
    if (y < MARGIN + 12) y = drawTableHeaders(y)

    if (idx % 2 === 0) {
      doc.setFillColor(252, 252, 253)
      doc.rect(MARGIN, y - 1, CONTENT_W, 6, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)

    // Nombre
    doc.setFont('helvetica', 'bold')
    doc.text((item.nombre || '—').toUpperCase().substring(0, 24), cols[0].x + 1, y + 3)
    doc.setFont('helvetica', 'normal')

    // RIF/Cédula
    doc.text(item.rif || '—', cols[1].x + 1, y + 3)

    // Vehículo + Color
    const veh = item.vehiculo || ''
    const col = item.color ? ` (${item.color})` : ''
    doc.text(`${veh}${col}`.substring(0, 22), cols[2].x + 1, y + 3)

    // Placas
    const chuto = item.placa_chuto ? `C: ${item.placa_chuto}` : ''
    const batea = item.placa_batea ? `B: ${item.placa_batea}` : ''
    const placas = [chuto, batea].filter(Boolean).join(' | ')
    doc.text(placas || '—', cols[3].x + 1, y + 3)

    // Cobertura
    doc.text((item.zona_cobertura || '—').substring(0, 22), cols[4].x + 1, y + 3)

    // Capacidad
    doc.text((item.capacidad || '—').substring(0, 16), cols[5].x + 1, y + 3)

    y += 6
  })

  drawFooter(doc, config)

  const filename = `Base_de_Datos_Choferes_${new Date().toISOString().slice(0, 10)}`

  if (action === 'print') {
    doc.autoPrint()
    const blobUrl = doc.output('bloburl')
    if (blobUrl) {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.src = blobUrl
      document.body.appendChild(iframe)
      iframe.onload = () => {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
        setTimeout(() => {
          document.body.removeChild(iframe)
          URL.revokeObjectURL(blobUrl)
        }, 10000)
      }
    }
  } else {
    doc.save(`${filename}.pdf`)
  }
}
