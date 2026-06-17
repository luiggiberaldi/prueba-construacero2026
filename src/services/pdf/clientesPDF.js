// src/services/pdf/clientesPDF.js
// Genera PDF profesional del Listado Detallado de Clientes — Listo POS
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { WATERMARK_LOGO } from './watermarkBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_RED, C_GRAY,
  drawPremiumHeader, fmtFecha, fmtTelefono
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

function drawHeader(doc, logoData, config, title = 'Base de Datos de Clientes') {
  return drawPremiumHeader({
    doc,
    logoData,
    config,
    title,
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

export async function generarClientesPDF({ items = [], config = {}, action = 'download', title = 'Base de Datos de Clientes' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)

  let y = drawHeader(doc, logoData, config, title)

  // Watermark
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - 140) / 2, (PAGE_H - 140) / 2, 140, 140)
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}

  // KPIs de clientes (removidas deudas, añadidas métricas de registro)
  const totalClientes = items.length
  const activos = items.filter(c => c.activo).length
  
  const ahora = new Date()
  const esteMes = ahora.getMonth()
  const esteAnio = ahora.getFullYear()
  const nuevosEsteMes = items.filter(c => {
    if (!c.creado_en) return false
    const d = new Date(c.creado_en)
    return d.getMonth() === esteMes && d.getFullYear() === esteAnio
  }).length

  const kpiBoxW = CONTENT_W / 3
  const kpiBoxH = 15
  const isPersonalReport = title === 'Reporte de Personal'

  const kpis = [
    { label: isPersonalReport ? 'Total Personal' : 'Total Clientes', value: String(totalClientes), color: C_PRIMARY },
    { label: isPersonalReport ? 'Personal Activo' : 'Clientes Activos', value: String(activos), color: C_EMERALD },
    { label: 'Nuevos Este Mes', value: String(nuevosEsteMes), color: C_AMBER },
  ]

  kpis.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2])
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    doc.text(kpi.label, bx + 4, y + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(kpi.value, bx + 4, y + 10.5)
  })

  y += kpiBoxH + 8

  // Tabla
  const cols = isPersonalReport ? [
    { label: 'CÓDIGO', x: MARGIN, w: 12 },
    { label: 'CÉDULA / RIF', x: MARGIN + 12, w: 20 },
    { label: 'NOMBRE Y APELLIDO', x: MARGIN + 32, w: 50 },
    { label: 'ROL / CARGO', x: MARGIN + 82, w: 26 },
    { label: 'TELÉFONO', x: MARGIN + 108, w: 22 },
    { label: 'VENDEDOR ASIG.', x: MARGIN + 130, w: 28 },
    { label: 'REGISTRO', x: MARGIN + 158, w: 30 },
  ] : [
    { label: 'CÓDIGO', x: MARGIN, w: 14 },
    { label: 'RIF / CÉDULA', x: MARGIN + 14, w: 22 },
    { label: 'NOMBRE / RAZÓN SOCIAL', x: MARGIN + 36, w: 58 },
    { label: 'TIPO', x: MARGIN + 94, w: 16 },
    { label: 'TELÉFONO', x: MARGIN + 110, w: 25 },
    { label: 'VENDEDOR', x: MARGIN + 135, w: 27 },
    { label: 'REGISTRO', x: MARGIN + 162, w: 26 },
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

    // Código
    const codStr = item.codigo_cliente || '—'
    doc.text(String(codStr).substring(0, 12), cols[0].x + 1, y + 3)

    // RIF / Cédula
    const rifStr = item.rif_cedula || '—'
    doc.text(String(rifStr).substring(0, 18), cols[1].x + 1, y + 3)

    // Nombre
    doc.setFont('helvetica', 'bold')
    doc.text((item.nombre || '—').toUpperCase().substring(0, 40), cols[2].x + 1, y + 3)
    doc.setFont('helvetica', 'normal')

    // Tipo / Rol
    const tipo = isPersonalReport 
      ? (item.categoria || '—').toUpperCase()
      : (item.tipo_cliente === 'juridico' ? 'JURÍDICO' : 'NATURAL')
    doc.text(String(tipo).substring(0, 12), cols[3].x + 1, y + 3)

    // Teléfono
    doc.text(fmtTelefono(item.telefono), cols[4].x + 1, y + 3)

    // Vendedor
    const vend = item.vendedor?.nombre || item.vendedor_nombre || '—'
    doc.text(vend.substring(0, 18), cols[5].x + 1, y + 3)

    // Registro
    const fechaReg = item.creado_en ? fmtFecha(item.creado_en) : '—'
    doc.text(fechaReg, cols[6].x + 1, y + 3)

    y += 6
  })

  drawFooter(doc, config)

  const filename = `Base_de_Datos_Clientes_${new Date().toISOString().slice(0, 10)}`

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
