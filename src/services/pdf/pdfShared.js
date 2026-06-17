// src/services/pdf/pdfShared.js
// Utilidades compartidas para generación de PDFs — Listo POS
import { WATERMARK_LOGO } from './watermarkBase64'

// ─── Layout ──────────────────────────────────────────────────────────────────
export const PAGE_W    = 216
export const PAGE_H    = 279
export const MARGIN    = 14
export const CONTENT_W = PAGE_W - MARGIN * 2

// ─── Colores ─────────────────────────────────────────────────────────────────
export const C_PRIMARY = [26, 54, 93]      // Azul de Acero Oscuro (Corporativo e industrial)
export const C_ACCENT  = [245, 158, 11]    // Amarillo Mostaza Cálido de Cerrajería (Acento de alta visibilidad)
export const C_DARK    = [5, 8, 52]        // Midnight Express — text
export const C_WHITE   = [255, 255, 255]
export const C_EMERALD = [4, 120, 87]      // Para estados "pagada"/"entregada"
export const C_AMBER   = [146, 64, 14]     // Para estados "pendiente"
export const C_GRAY    = [100, 116, 139]   // Para texto deshabilitado
export const C_RED     = [185, 28, 28]     // Para montos críticos

// ─── Datos del negocio ───────────────────────────────────────────────────────
export const CUENTAS_BANCARIAS = [
  'CTA. CTE. BANESCO 0134 0187 0128 7104 1852',
  'CTA. CTE. PROVINCIAL 0108 0071 4901 0129 1305',
]

// ─── Formateadores ───────────────────────────────────────────────────────────
export function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtBs(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtBsShort(n) {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtBcvUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Formatea fecha corta dd/mm/yyyy. Variante 'short-month' usa mes abreviado. */
export function fmtFecha(f, variant) {
  if (!f) return '—'
  let dateObj
  if (f instanceof Date) {
    dateObj = f
  } else {
    const dateStr = String(f).includes('T') ? String(f) : `${f}T12:00:00`
    dateObj = new Date(dateStr)
    if (isNaN(dateObj.getTime())) {
      dateObj = new Date(f)
    }
  }

  if (variant === 'short-month') {
    return dateObj.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  if (variant === 'short') {
    return dateObj.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }
  return dateObj.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtFechaCorta(f) {
  return fmtFecha(f, 'short')
}

export function fmtTelefono(tel) {
  if (!tel) return '—'
  const t = String(tel).trim()
  if (t.startsWith('+58')) {
    const num = t.slice(3).replace(/[^\d]/g, '')
    if (num.length === 10) return `0${num.slice(0, 3)}-${num.slice(3)}`
    return `0${num}`
  }
  return t
}

export function fmtPrecio(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  if ((moneda === 'bcv' || moneda === 'mixto_bcv') && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  return fmtUsd(n)
}

export function fmtTotal(n, moneda, tasa, factorBcv) {
  if (moneda === 'bs' && tasa > 0) return fmtBs(Number(n || 0) * tasa)
  if (moneda === 'bcv' && factorBcv > 0) return fmtBcvUsd(Number(n || 0) * factorBcv)
  if (moneda === 'mixto' && tasa > 0) return `${fmtUsd(n)} / ${fmtBs(Number(n || 0) * tasa)}`
  if (moneda === 'mixto_bcv' && factorBcv > 0 && tasa > 0) return `${fmtBcvUsd(Number(n || 0) * factorBcv)} / ${fmtBs(Number(n || 0) * tasa)}`
  return fmtUsd(n)
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  const h = (hex || '').replace('#', '')
  if (h.length !== 6) return C_DARK
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)]
}

/** Dibuja checkbox con label */
export function drawCheck(doc, label, x, y, checked = false) {
  doc.setLineWidth(0.3)
  doc.setDrawColor(...C_DARK)
  doc.rect(x, y - 2.5, 3, 3, 'S')
  if (checked) {
    doc.setLineWidth(0.5)
    doc.line(x + 0.4, y - 1.2, x + 1.5, y + 0.2)
    doc.line(x + 1.5, y + 0.2, x + 2.8, y - 2.2)
    doc.setLineWidth(0.3)
  }
  doc.setFont('helvetica', checked ? 'bold' : 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C_DARK)
  doc.text(label, x + 4.5, y)
}

/** Dibuja marca de agua centrada con opacidad */
export function drawWatermark(doc) {
  try {
    const gState = new doc.GState({ opacity: 0.06 })
    doc.setGState(gState)
    const wmSize = 140
    doc.addImage(WATERMARK_LOGO, 'PNG', (PAGE_W - wmSize) / 2, (PAGE_H - wmSize) / 2, wmSize, wmSize, 'WATERMARK_LOGO', 'FAST')
    doc.setGState(new doc.GState({ opacity: 1 }))
  } catch (_) {}
}

/** Dibuja marca de agua "ANULADA" en rojo, diagonal, semitransparente */
export function drawAnuladaWatermark(doc) {
  try {
    // Obtenemos el centro real directamente de la instancia del documento
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const cx = pageWidth / 2
    const cy = pageHeight / 2
    
    doc.saveGraphicsState()
    const gState = new doc.GState({ opacity: 0.16 }) 
    doc.setGState(gState)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(100)
    doc.setTextColor(220, 0, 0)
    
    // Si el texto sale muy abajo es porque la rotación de jsPDF a veces interpreta 
    // mal el punto de anclaje en milímetros. 
    // Lo subiremos manualmente para forzar que cruce el centro visual.
    const verticalOffset = -35 // Compensación manual bajada 1cm adicional
    const horizontalOffset = 20 // Ajuste a la derecha solicitado (2cm)
    doc.text('ANULADA', cx + horizontalOffset, cy + verticalOffset, { align: 'center', angle: 325 })
    
    doc.restoreGraphicsState()
  } catch (err) {
    console.error('Error en drawAnuladaWatermark:', err)
  }
}

/** Dibuja marca de agua "APROBADO POR: [NOMBRE]" en verde, diagonal, semitransparente */
export function drawAprobadoWatermark(doc, nombre) {
  try {
    doc.saveGraphicsState()
    const gState = new doc.GState({ opacity: 0.35 }) // Menos traslúcido
    doc.setGState(gState)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(32) // Más grande
    doc.setTextColor(30, 80, 160)
    const cx = (PAGE_W / 2) + 10 // Movido 1cm a la derecha
    const cy = (PAGE_H / 2) + 40 // Movido 1cm abajo adicional
    
    // Ajustado para que quede más centrado y grande
    doc.text(`APROBADO POR:`, cx - 8, cy - 10, { align: 'center', angle: 35 })
    doc.setFontSize(28) // Nombre más grande
    doc.text(`${nombre}`.toUpperCase(), cx + 8, cy + 10, { align: 'center', angle: 35 })
    doc.restoreGraphicsState()
  } catch (_) {}
}

/** Verifica si necesita salto de página, agrega nueva con watermark y ejecuta callback si existe */
export function checkPage(doc, y, needed = 30, onPageAdd = null, customBottomMargin = null) {
  const bottomMargin = customBottomMargin !== null ? customBottomMargin : 35
  if (y + needed > PAGE_H - bottomMargin) {
    doc.addPage()
    drawWatermark(doc)
    if (onPageAdd && typeof onPageAdd === 'function') {
      return onPageAdd(doc)
    }
    return MARGIN + 10
  }
  return y
}

/** 
 * Dibuja un encabezado simplificado (banner azul pequeño) para páginas subsiguientes.
 * @param {Object} doc - Instancia de jsPDF
 * @param {string} logoData - Base64 del logo
 * @param {Object} config - Configuración del negocio
 * @param {string} rightTitle - Texto a mostrar a la derecha (ej: "Cotización Nº- 00001" o "Lista de Precios (Cont.)")
 */
export function drawSimplifiedHeader(doc, logoData, config, rightTitle = '', customBgColor = null, customTextColor = null) {
  const SHDR_H = 12
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFillColor(...(customBgColor || C_PRIMARY))
  doc.rect(0, 0, pageWidth, SHDR_H, 'F')

  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 4, 0.75, 10.5, 10.5, 'HEADER_LOGO', 'FAST') } catch (_) {}
  }

  let n = config.nombre_negocio || 'Listo POS C.A.'
  if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'Listo POS C.A.'
  
  doc.setFont('times', 'bold')
  doc.setFontSize(15.5)
  doc.setTextColor(...(customTextColor || C_WHITE))
  doc.text(n.toUpperCase(), pageWidth / 2, 8.5, { align: 'center' })

  if (rightTitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...(customTextColor || C_WHITE))
    doc.text(rightTitle, pageWidth - MARGIN, 8.5, { align: 'right' })
  }

  // Si el fondo es blanco, agregamos una línea negra de borde para separar la cabecera simplificada del contenido
  if (customBgColor && customBgColor[0] === 255 && customBgColor[1] === 255 && customBgColor[2] === 255) {
    doc.setLineWidth(0.3)
    doc.setDrawColor(0, 0, 0)
    doc.line(0, SHDR_H, pageWidth, SHDR_H)
  }

  return SHDR_H + 4
}

/**
 * Dibuja el encabezado premium con el estilo Listo POS (hazard stripes, puntos y blueprint markers).
 */
export function drawPremiumHeader({
  doc,
  logoData,
  config,
  title,
  subtitle,
  dotColor = null,
  customBgColor = null,
  customAccentColor = null,
  customTextColor = null,
  customSubtitleColor = null,
  customBorderColor = null,
  centerBusinessName = false
}) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const HDR_H = 40

  // Banner primario
  doc.setFillColor(...(customBgColor || C_PRIMARY))
  doc.rect(0, 0, W, HDR_H, 'F')

  // Puntos decorativos izquierdo
  const dotsCol = customAccentColor || dotColor || C_ACCENT
  doc.setFillColor(...dotsCol)
  for(let i = 0; i < 4; i++) {
    for(let j = 0; j < 6; j++) {
      doc.circle(MARGIN + i * 2.5, 4 + j * 2.5, 0.4, 'F')
    }
  }

  // Hazard stripe superior derecho
  doc.setFillColor(...(customAccentColor || C_ACCENT))
  const solidStartX = W - 25.2
  const solidStartBottomX = solidStartX - 2.5
  doc.rect(solidStartX, 0, W - solidStartX, 6, 'F')
  doc.triangle(solidStartX, 0, solidStartBottomX, 6, solidStartX, 6, 'F')
  
  doc.setLineWidth(0.5)
  doc.setDrawColor(...(customAccentColor || C_ACCENT))
  doc.line(solidStartX, 0.5, solidStartX, 5.5)

  // Diagonales amarillas mostaza
  const diagStartX = W - 42.0
  const stripeWidth = 1.4
  const stripeSlant = 2.5
  for (let i = 0; i < 6; i++) {
    const lx = diagStartX + i * 2.8
    doc.triangle(lx, 0, lx + stripeWidth, 0, lx - stripeSlant, 6, 'F')
    doc.triangle(lx + stripeWidth, 0, lx - stripeSlant + stripeWidth, 6, lx - stripeSlant, 6, 'F')
    doc.line(lx + stripeWidth - 0.2, 0.5, lx - stripeSlant + 0.2, 5.5)
  }

  // Micro-dots en zona amarilla (blancos si el fondo del banner es blanco/diagonales negras para contraste)
  const microDotsColor = customBgColor && customBgColor[0] === 255 && customBgColor[1] === 255 && customBgColor[2] === 255
    ? [255, 255, 255]
    : [0, 0, 0]
  doc.setFillColor(...microDotsColor)
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 2; j++) {
      doc.circle(W - 16 + i * 3.0, 9.5 + j * 2.5, 0.3, 'F')
    }
  }

  // Línea base del header
  doc.setLineWidth(1.0)
  doc.setDrawColor(...(customBorderColor || customAccentColor || C_ACCENT))
  doc.line(0, HDR_H, W, HDR_H)

  // Blueprint micro-indicadores
  doc.setLineWidth(0.12)
  doc.setDrawColor(180, 188, 200)
  // Sup Izq
  doc.line(MARGIN - 2, 46, MARGIN + 2, 46); doc.line(MARGIN, 44, MARGIN, 48)
  // Sup Der
  doc.line(W - MARGIN - 2, 46, W - MARGIN + 2, 46); doc.line(W - MARGIN, 44, W - MARGIN, 48)
  // Inf Izq
  doc.line(MARGIN - 2, H - 33, MARGIN + 2, H - 33); doc.line(MARGIN, H - 35, MARGIN, H - 31)
  // Inf Der
  doc.line(W - MARGIN - 2, H - 33, W - MARGIN + 2, H - 33); doc.line(W - MARGIN, H - 35, W - MARGIN, H - 31)

  // Logo
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', MARGIN + 11, 3, 34, 34) } catch (_) {}
  }

  // Títulos de negocio centrado
  let n = config.nombre_negocio || 'Listo POS C.A.'
  if (!n || n.trim().toUpperCase() === 'PRUEBA' || n.trim() === '') n = 'Listo POS C.A.'
  const words = n.split(' ')
  const main = (words[0] || 'LISTO').toUpperCase()
  const secondary = words.slice(1).join(' ').toUpperCase() || 'POS C.A.'
  
  doc.setFont('times', 'bold'); doc.setTextColor(...(customTextColor || C_WHITE))
  if (centerBusinessName) {
    doc.setFontSize(20); doc.text(main, W / 2, 17, { align: 'center' })
    doc.setFontSize(13); doc.text(secondary, W / 2, 24, { align: 'center' })
  } else {
    // Alinear el nombre de la empresa a la izquierda, al lado del logo
    const businessTextX = MARGIN + 48
    doc.setFontSize(20); doc.text(main, businessTextX, 17, { align: 'left' })
    doc.setFontSize(13); doc.text(secondary, businessTextX, 24, { align: 'left' })
  }

  // Títulos del reporte derecha (con un tamaño y posición refinados para que se vean espectaculares)
  if (title) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    doc.setTextColor(...(customTextColor || C_WHITE))
    doc.text(title, W - MARGIN, HDR_H - 13, { align: 'right' })
  }
  if (subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    doc.setTextColor(...(customSubtitleColor || C_ACCENT)) // Color mostaza/amarillo de contraste para subtítulos (periodo/fecha) o color personalizado
    doc.text(subtitle, W - MARGIN, HDR_H - 6, { align: 'right' })
  }

  return HDR_H + 6
}

/**
 * Dibuja el pie de página premium con el formato de la lista de precios (diagonales, dirección, contacto e iconos).
 */
export function drawPremiumFooter(doc, config, customBgColor = [255, 255, 255], customAccentColor = [0, 0, 0], customTextColor = [0, 0, 0], extraText = '') {
  const totalPages = doc.internal.getNumberOfPages()
  const ph = PAGE_H
  const pw = PAGE_W

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)

    if (p === 1) {
      // Franja superior con las diagonales
      const hazardY = ph - 30
      doc.setFillColor(...customAccentColor)
      doc.rect(0, hazardY, pw, 4, 'F')

      doc.setDrawColor(...customBgColor)
      doc.setLineWidth(0.8)
      for (let k = 1; k < 20; k++) {
        doc.line(k * 4, hazardY, k * 4 - 3, hazardY + 4)
        doc.line(pw - k * 4, hazardY, pw - k * 4 + 3, hazardY + 4)
      }

      // Franja principal
      doc.setFillColor(...customBgColor)
      doc.rect(0, ph - 29, pw, 29, 'F')

      // Borde superior sutil para separar del contenido
      doc.setLineWidth(0.3)
      doc.setDrawColor(...customAccentColor)
      doc.line(0, ph - 29, pw, ph - 29)

      // Pin ubicación + dirección
      doc.setFillColor(...customTextColor)
      doc.setDrawColor(...customTextColor)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...customTextColor)

      const addr1 = config.direccion_negocio || 'Dirección Comercial'
      const addr2 = config.pie_pagina_pdf || (config.rif_negocio ? `RIF: ${config.rif_negocio}` : '')

      const addr1W = doc.getTextWidth(addr1)
      const addr1X = pw / 2 - addr1W / 2
      const pinX = addr1X - 4
      const pinY = ph - 21
      doc.circle(pinX, pinY - 0.3, 1.4, 'F')
      doc.triangle(pinX - 1.2, pinY, pinX + 1.2, pinY, pinX, pinY + 2.4, 'F')

      doc.text(addr1, pw / 2, ph - 19.5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.text(addr2, pw / 2, ph - 15, { align: 'center' })

      const tel = fmtTelefono(config.telefono_negocio) || ''
      const email = config.email_negocio || ''
      if (tel && tel !== '—' || email) {
        const parts = []
        if (tel && tel !== '—') parts.push({ icon: 'phone', text: tel })
        if (email) parts.push({ icon: 'mail', text: email })

        doc.setFont('helvetica', 'normal')
        const gap = 12
        let totalW = 0
        parts.forEach((part, idx) => {
          totalW += 5 + doc.getTextWidth(part.text)
          if (idx < parts.length - 1) totalW += gap
        })

        let cx = pw / 2 - totalW / 2
        const cy = ph - 7

        parts.forEach((part, idx) => {
          doc.setFillColor(...customTextColor)
          doc.setDrawColor(...customTextColor)
          if (part.icon === 'phone') {
             doc.setLineWidth(0.4)
             doc.roundedRect(cx, cy - 2.2, 1.6, 2.8, 0.3, 0.3, 'S')
             doc.setLineWidth(0.3)
             doc.line(cx + 0.3, cy + 0.2, cx + 1.3, cy + 0.2)
          } else {
             doc.setLineWidth(0.3)
             doc.rect(cx, cy - 1.8, 2.4, 1.8, 'S')
             doc.line(cx, cy - 1.8, cx + 1.2, cy - 0.6)
             doc.line(cx + 2.4, cy - 1.8, cx + 1.2, cy - 0.6)
          }
          doc.setTextColor(...customTextColor)
          doc.text(part.text, cx + 4, cy)
          cx += 5 + doc.getTextWidth(part.text) + gap
        })
      }

      if (extraText) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6)
        doc.setTextColor(...customTextColor)
        doc.text(extraText, MARGIN, ph - 4)
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...customTextColor)
      doc.text(`Página ${p} de ${totalPages}`, pw - 10, ph - 4, { align: 'right' })
    } else {
      // Footer simplificado para páginas > 1
      const fHeight = 8
      doc.setFillColor(...customBgColor)
      doc.rect(0, ph - fHeight, pw, fHeight, 'F')
      
      doc.setFillColor(...customAccentColor)
      doc.rect(0, ph - fHeight - 1.5, pw, 1.5, 'F')

      if (extraText) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6)
        doc.setTextColor(...customTextColor)
        doc.text(extraText, MARGIN, ph - 2.5)
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...customTextColor)
      doc.text(`Página ${p} de ${totalPages}`, pw - 10, ph - 2.5, { align: 'right' })
    }
  }
}
