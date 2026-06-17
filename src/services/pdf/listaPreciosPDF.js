// src/services/pdf/listaPreciosPDF.js
// Genera PDF "Lista de Precios" para enviar a clientes — Listo POS
import { jsPDF } from 'jspdf'
import { WATERMARK_LOGO } from './watermarkBase64'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import { 
  PAGE_W, PAGE_H, MARGIN, CONTENT_W, 
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY,
  drawSimplifiedHeader, checkPage, drawWatermark, drawPremiumHeader
} from './pdfShared'

// ─── Colores personalizados para Lista de Precios (blanco/negro) ─────────────
const LP_BG      = [255, 255, 255]  // Fondo blanco
const LP_ACCENT  = [0, 0, 0]        // Rayas y detalles negros
const LP_TEXT    = [0, 0, 0]        // Texto negro
const LP_BORDER  = [0, 0, 0]        // Borde de línea base negro

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extraerDimensiones(nombre) {
  if (!nombre) return []
  let n = nombre.toUpperCase().replace(',', '.')
  
  // Manejar fracciones mixtas como "1 1/2" -> "1.5"
  n = n.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (match, entero, num, den) => {
    return (parseFloat(entero) + (parseFloat(num) / parseFloat(den))).toString()
  })
  
  // Manejar fracciones simples como "1/2" -> "0.5"
  n = n.replace(/(\d+)\s*\/\s*(\d+)/g, (match, num, den) => {
    return (parseFloat(num) / parseFloat(den)).toString()
  })
  
  const numeros = n.match(/(\d+(\.\d+)?)/g)
  return numeros ? numeros.map(Number) : []
}

function corregirCategoriaCruzada(categoriaActual, nombre) {
  const n = (nombre || '').toUpperCase()
  const c = (categoriaActual || '').toUpperCase().trim()

  if (c.startsWith('LAMINA')) {
    return 'LAMINAS'
  }

  // Definir palabras clave para detectar inconsistencias
  const reglas = [
    // 1. PRODUCTOS PRINCIPALES (Alta prioridad)
    { key: 'LAMINA', target: 'LAMINAS' },
    { key: 'LOSACERO', target: 'LAMINAS' },
    { key: 'VIGA', target: 'VIGAS' },
    { key: 'PERFIL MARCO', target: 'PERFILES PARA MARCOS' },
    { key: 'ANGULO', target: 'PERFILES ANGULOS' },
    { key: 'PLETINA', target: 'PERFILES PLETINA' },
    { key: 'PERFIL', target: 'PERFILES' },
    { key: 'CABILLA', target: 'CABILLAS' },
    { key: 'CEMENTO', target: 'CEMENTO' },
    { key: 'ALAMBRE', target: 'ALAMBRES' },
    { key: 'ALAMBRON', target: 'ALAMBRONES' },
    { key: 'MALLA', target: 'MALLAS' },
    { key: 'ZUNCHO', target: 'ZUNCHOS' },
    { key: 'CERCHA', target: 'CERCHAS' },
    { key: 'JUNTA', target: 'JUNTAS' },

    // 2. EQUIPOS ELECTRICOS Y CAJAS
    { key: 'CAJA', target: 'CAJAS Y TABLEROS' },
    { key: 'CAJETIN', target: 'CAJAS Y TABLEROS' },
    { key: 'TABLERO', target: 'CAJAS Y TABLEROS' },
    { key: 'BREAKER', target: 'ELECTRICIDAD' },
    { key: 'ARVIDAL', target: 'ARVIDAL' },
    { key: 'CABLE', target: 'CABLES' },

    // 3. FERRETERIA Y OTROS
    { key: 'ELECTRODO', target: 'FERRETERIA' },
    { key: 'DISCO', target: 'FERRETERIA' },
    { key: 'TORNILLO', target: 'FERRETERIA' },
    { key: 'FERRETERIA', target: 'FERRETERIA' },

    // 4. TUBOS ESPECIFICOS
    { key: 'TUBO ESTRUC. CUAD', target: 'TUBOS ESTRUCTURALES CUADRADO' },
    { key: 'TUBO ESTRUC. RECT', target: 'TUBOS ESTRUCTURALES RECTANGULAR' },
    { key: 'TUBO ELEC', target: 'TUBOS PVC ELECTRICOS' },
    { key: 'TUBO PVC A.F', target: 'TUBOS PVC AGUA FRIAS' },
    { key: 'TUBO PVC A/N', target: 'TUBOS PVC AGUAS NEGRAS' },
    { key: 'TUBO PULIDO CUAD', target: 'TUBOS PULIDO CUADRADO' },
    { key: 'TUBO PULIDO RECT', target: 'TUBOS PULIDO RECTANGULAR' },
    { key: 'TUBO GALV', target: 'TUBOS GALVANIZADO' },
    { key: 'TUBO VENT', target: 'TUBOS DE VENTILACION' },
    { key: 'TUBO REDONDO', target: 'TUBOS REDONDOS' },
    { key: 'TUBERIA', target: 'TUBOS' },
    { key: 'TUBO', target: 'TUBOS' },

    // 5. MATERIALES DE CONEXIONES (Modificadores)
    { key: 'CPVC', target: 'CONEXIONES CPVC' },
    { key: 'A.F', target: 'CONEXIONES PVC AGUA FRIA' },
    { key: 'A.N', target: 'CONEXIONES PVC AGUAS NEGRAS' },
    { key: 'EMT', target: 'CONEXIONES EMT' },
    { key: 'CONDUIT', target: 'CONEXIONES CONDUIT' },
    { key: 'HG', target: 'CONEXIONES GALVANIZADAS' },
    { key: 'GALV', target: 'CONEXIONES GALVANIZADAS' },

    // 6. TIPOS DE CONEXIONES (Fallback para las genéricas o de PVC básico)
    { key: 'CODO', target: 'CODOS' },
    { key: 'TEE', target: 'TEES' },
    { key: 'UNION', target: 'UNIONES' },
    { key: 'YEE', target: 'YEES' },
    { key: 'REDUCCION', target: 'REDUCCIONES' },
    { key: 'SIFON', target: 'SIFONES' },
    { key: 'TAPON', target: 'TAPONES' },
    { key: 'ANILLO', target: 'ANILLOS' },
    { key: 'ADAPTADOR', target: 'ADAPTADORES' },
    { key: 'CURVA', target: 'CURVAS' },
    { key: 'NIPLE', target: 'NIPLES' },
  ]

  for (const regla of reglas) {
    if (n.includes(regla.key)) {
      return regla.target
    }
  }

  return categoriaActual
}

function obtenerSubcategoria(nombre, cat) {
  if (!nombre) return 'OTROS'
  const n = nombre.toUpperCase().trim()

  if (cat === 'LAMINAS') {
    if (n.includes('LOSACERO')) {
      return 'LOSACERO (LOSA ESTRUCTURAL)'
    }
    if (n.includes(' HN') || n.includes('HN ') || n.includes('HIERRO NEGRO') || n.startsWith('HN')) {
      return 'LÁMINAS DE HIERRO NEGRO (HN)'
    }
    if (n.includes(' HP') || n.includes('HP ') || n.includes('HIERRO PULIDO') || n.startsWith('HP')) {
      return 'LÁMINAS DE HIERRO PULIDO (HP)'
    }
    if (n.includes('EST.') || n.includes('ESTRIADA') || n.includes('ESTRIADO')) {
      return 'LÁMINAS ESTRIADAS'
    }
    if (n.includes('GALV. LISA') || n.includes('GALV LISA') || n.includes('GALVANIZADA LISA')) {
      return 'LÁMINAS GALVANIZADAS LISAS'
    }
    if (n.includes('PREPINTADO')) {
      return 'LÁMINAS PREPINTADAS'
    }
    if (n.includes('ZINC')) {
      return 'LÁMINAS DE ZINC'
    }
    if (n.includes('TERMOPANEL')) {
      return 'LÁMINAS TERMOPANEL'
    }
    if (n.includes('ARQUITECTONICA')) {
      return 'LÁMINAS ARQUITECTÓNICAS'
    }
    if (n.includes('CUMBRERA') || n.includes('CABALLETE') || n.includes('REMATE')) {
      return 'ACCESORIOS PARA TECHO'
    }
    const keywordsTecho = [
      'GALVATECHO', 'ACEROLIT', 'TEJAS', 'TEJA'
    ]
    if (keywordsTecho.some(key => n.includes(key))) {
      return 'LÁMINAS PARA TECHO'
    }
    return 'OTROS'
  }

  if (cat === 'VIGAS') {
    if (n.includes('WF')) {
      return 'VIGAS WF'
    }
    if (n.includes('IPE')) {
      return 'VIGAS IPE'
    }
    if (n.includes('IPN')) {
      return 'VIGAS IPN'
    }
    if (n.includes('HEA')) {
      return 'VIGAS HEA'
    }
    if (n.includes('HEB')) {
      return 'VIGAS HEB'
    }
    if (n.includes('UPL')) {
      return 'VIGAS UPL'
    }
    if (n.includes('UPN')) {
      return 'VIGAS UPN'
    }
    if (n.includes('VP')) {
      return 'VIGAS VP'
    }
    return 'OTROS'
  }

  // Detección de abreviaturas comunes de ferretería para tornillería
  if (n.startsWith('TOR ') || n.includes(' TOR ') || n.includes('TORNILLO')) {
    return 'TORNILLOS'
  }
  if (n.startsWith('TUE ') || n.includes(' TUE ') || n.includes('TUERCA')) {
    return 'TUERCAS'
  }
  if (n.includes('CAJA DE PASO') || n.includes('CAJA PASO')) {
    return 'CAJAS DE PASO ELÉCTRICAS'
  }
  if (n.includes('CAJA DE MEDIDOR') || n.includes('CAJA MEDIDOR')) {
    return 'CAJAS DE MEDIDOR'
  }
  if ((n.startsWith('LLAVE') || n.includes(' LLAVE ')) && !n.includes('KIT DE FREGADERO') && !n.includes('KIT FREGADERO')) {
    return 'LLAVES'
  }
  
  const subcats = [
    { key: 'CODO', label: 'CODOS' },
    { key: 'ANILLO', label: 'ANILLOS' },
    { key: 'REDUCCION', label: 'REDUCCIONES' },
    { key: 'TEE', label: 'TEES' },
    { key: 'SIFON', label: 'SIFONES' },
    { key: 'REJILLA', label: 'REJILLAS' },
    { key: 'TAPON', label: 'TAPONES' },
    { key: 'ADAPTADOR', label: 'ADAPTADORES' },
    { key: 'CURVA', label: 'CURVAS' },
    { key: 'NIPLE', label: 'NIPLES' },
    { key: 'UNION', label: 'UNIONES' },
    { key: 'YEE', label: 'YEES' },
    { key: 'ABRAZADERA', label: 'ABRAZADERAS' },
    { key: 'VALVULA', label: 'VALVULAS' },
    { key: 'PEGAMENTO', label: 'PEGAMENTOS' },
    { key: 'PEGA ', label: 'PEGAMENTOS' },
    { key: 'FLANCHE', label: 'FLANCHES' },
    { key: 'COLLARIN', label: 'COLLARINES' },
    { key: 'DISCO', label: 'DISCOS' },
    { key: 'ELECTRODO', label: 'ELECTRODOS' },
    { key: 'CABLE', label: 'CABLES' },
    { key: 'BREAKER', label: 'BREAKERS' },
    { key: 'CAJETIN', label: 'CAJETINES' },
    { key: 'TABLERO', label: 'TABLEROS' },
    { key: 'MARCO', label: 'MARCOS' }
  ]
  
  for (const item of subcats) {
    if (n.includes(item.key)) {
      return item.label
    }
  }
  
  return 'OTROS'
}

function normalizarCategoria(cat) {
  if (!cat) return 'PRODUCTOS EXTERNOS'
  let upper = cat.toUpperCase().trim()
  
  // Limpieza inicial
  upper = upper.replace(/\s+/g, ' ')
  if (upper.includes('AGUA') && upper.includes('FRIA') && upper.includes('PVC')) upper = 'TUBOS PVC AGUAS FRIAS'
  if (upper.includes('PVC') && upper.includes('ELECTRIC')) upper = 'TUBOS PVC ELECTRICIDAD'
  if (upper === 'TUBOS ESTRUCTURAL' || upper === 'TUBO ESTRUCTURAL') upper = 'TUBOS ESTRUCTURALES'

  // Estandarizar todas las categorías de ferretería en una sola
  if (upper.startsWith('FERRETERIA')) {
    return 'FERRETERIA'
  }

  // Estandarizar plurales iniciales
  if (upper.startsWith('TUBO ')) upper = upper.replace('TUBO ', 'TUBOS ')
  if (upper.startsWith('LAMINA ')) upper = upper.replace('LAMINA ', 'LAMINAS ')
  if (upper.startsWith('VIGA ')) upper = upper.replace('VIGA ', 'VIGAS ')
  if (upper.startsWith('PERFIL ')) upper = upper.replace('PERFIL ', 'PERFILES ')
  if (upper.startsWith('MALLA ')) upper = upper.replace('MALLA ', 'MALLAS ')
  if (upper.startsWith('CONEXION ')) upper = upper.replace('CONEXION ', 'CONEXIONES ')

  return upper
}

function fmtUsd(n) {
  return `$${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtBs(n) {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtPrecio(n, moneda, tasa) {
  const usd = Number(n || 0)
  if (moneda === 'bs' && tasa > 0) return fmtBs(usd * tasa)
  if ((moneda === 'mixto' || moneda === 'mixto_bcv') && tasa > 0) return `${fmtUsd(usd)}  /  ${fmtBs(usd * tasa)}`
  return fmtUsd(usd)
}
const MONEDA_LABELS = {
  '$': 'Precio Detal USDT',
  'bcv': 'Precio Detal BCV',
  'bs': 'Precio Bs',
  'mixto': 'Precio USDT / Bs',
  'mixto_bcv': 'Precio BCV / Bs',
  'usd': 'Precio Detal USD',
}

// ─── Layout y Colores ────────────────────────────────────────────────────────
const C_CAT_BG  = [235, 240, 250]


// Trunca texto para que quepa en maxW mm, agregando '…' si se corta
function fitText(doc, text, maxW) {
  if (!text) return '—'
  if (doc.getTextWidth(text) <= maxW) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
  return t + '…'
}

// ─── Dibujar cabecera ────────────────────────────────────────────────────────
function drawHeader(doc, _logoData, config, moneda, tasa) {
  const fechaTxt = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
  return drawPremiumHeader({
    doc,
    logoData: LOGO_LISTA_PRECIOS,
    config,
    title: 'Lista de Precios',
    subtitle: fechaTxt,
    customBgColor:       LP_BG,
    customAccentColor:   LP_ACCENT,
    customTextColor:     LP_TEXT,
    customSubtitleColor: LP_TEXT,
    customBorderColor:   LP_BORDER,
    centerBusinessName:  true
  })
}

function fmtTelefono(tel) {
  if (!tel) return ''
  const s = String(tel).replace(/\D/g, '')
  if (s.length === 11) return `${s.slice(0, 4)}-${s.slice(4, 7)}.${s.slice(7, 9)}.${s.slice(9, 11)}`
  return tel
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function drawFooter(doc, config) {
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const ph = PAGE_H

    if (p === 1) {
      // Franja negra superior con las diagonales
      const hazardY = ph - 30
      doc.setFillColor(...LP_ACCENT)
      doc.rect(0, hazardY, PAGE_W, 4, 'F')

      doc.setDrawColor(...LP_BG)
      doc.setLineWidth(0.8)
      for(let k = 1; k < 20; k++) {
        doc.line(k * 4, hazardY, k * 4 - 3, hazardY + 4)
        doc.line(PAGE_W - k * 4, hazardY, PAGE_W - k * 4 + 3, hazardY + 4)
      }

      // Franja principal blanca
      doc.setFillColor(...LP_BG)
      doc.rect(0, ph - 29, PAGE_W, 29, 'F')

      // Borde superior sutil para separar del contenido
      doc.setLineWidth(0.3)
      doc.setDrawColor(...LP_ACCENT)
      doc.line(0, ph - 29, PAGE_W, ph - 29)

      // ── Icono pin ubicación + dirección ──
      doc.setFillColor(...LP_TEXT)
      doc.setDrawColor(...LP_TEXT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...LP_TEXT)

      const addr1 = config.direccion_negocio || 'Listo POS C.A.'
      const addr2 = config.pie_pagina_pdf || (config.rif_negocio ? `RIF: ${config.rif_negocio}` : '')

      const addr1W = doc.getTextWidth(addr1)
      const addr1X = PAGE_W/2 - addr1W/2
      const pinX = addr1X - 4
      const pinY = ph - 21
      doc.circle(pinX, pinY - 0.3, 1.4, 'F')
      doc.triangle(pinX - 1.2, pinY, pinX + 1.2, pinY, pinX, pinY + 2.4, 'F')

      doc.text(addr1, PAGE_W/2, ph - 19.5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.text(addr2, PAGE_W/2, ph - 15, { align: 'center' })

      const tel = fmtTelefono(config.telefono_negocio) || ''
      const email = config.email_negocio || ''
      if (tel || email) {
        const parts = []
        if (tel && tel !== '—') parts.push({ icon: 'phone', text: tel })
        if (email) parts.push({ icon: 'mail', text: email })

        doc.setFont('helvetica', 'normal')
        const gap = 12
        let totalW = 0
        parts.forEach((p, i) => {
          totalW += 5 + doc.getTextWidth(p.text)
          if (i < parts.length - 1) totalW += gap
        })

        let cx = PAGE_W/2 - totalW/2
        const cy = ph - 7

        parts.forEach((p, i) => {
          doc.setFillColor(...LP_TEXT)
          doc.setDrawColor(...LP_TEXT)
          if (p.icon === 'phone') {
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
          doc.setTextColor(...LP_TEXT)
          doc.text(p.text, cx + 4, cy)
          cx += 5 + doc.getTextWidth(p.text) + gap
        })
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...LP_TEXT)
      doc.text(`Página ${p} de ${totalPages}`, PAGE_W - 10, ph - 4, { align: 'right' })
    } else {
      // Footer simplificado para páginas > 1
      const fHeight = 8
      doc.setFillColor(...LP_BG)
      doc.rect(0, ph - fHeight, PAGE_W, fHeight, 'F')
      
      doc.setFillColor(...LP_ACCENT)
      doc.rect(0, ph - fHeight - 1.5, PAGE_W, 1.5, 'F')

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...LP_TEXT)
      doc.text(`Página ${p} de ${totalPages}`, PAGE_W - 10, ph - 2.5, { align: 'right' })
    }
  }
}

// ─── Generar Lista de Precios ────────────────────────────────────────────────
/**
 * @param {Object} params
 * @param {Array}  params.productos  - Lista de productos a incluir
 * @param {Object} params.config     - Config del negocio (nombre_negocio, logo_url)
 * @param {Object} params.opciones   - { moneda: 'usd'|'bs'|'mixto', tasa: number, columnas: { codigo, categoria, unidad, stock, precio2, precio3 } }
 */
export async function generarListaPreciosPDF({ productos, config = {}, opciones = {} }) {
  const { moneda = 'usd', tasa = 0, columnas = {}, formato = 'lista' } = opciones
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })

  let y = drawHeader(doc, null, config, moneda, tasa)
  drawWatermark(doc)



  // Agrupar por categoría usando el normalizador para corregir errores de tipeo
  const grupos = {}
  productos.forEach(p => {
    // 1. Corregir categoría basada en discrepancias con el nombre
    const catCorregida = corregirCategoriaCruzada(p.categoria, p.nombre)
    
    // 2. Normalizar formato
    const cat = normalizarCategoria(catCorregida)
    
    if (!grupos[cat]) grupos[cat] = []
    grupos[cat].push(p)
  })

  // Ordenar productos dentro de cada categoría por tipo y luego por tamaño
  Object.keys(grupos).forEach(cat => {
    grupos[cat].sort((a, b) => {
      const nombreA = (a.nombre || '').toUpperCase()
      const nombreB = (b.nombre || '').toUpperCase()

      // Si es Conexiones o Tubos, agrupar primero por el tipo (primera palabra relevante)
      if (cat.includes('CONEXIONES')) {
        const tipoA = nombreA.split(' ')[0]
        const tipoB = nombreB.split(' ')[0]
        if (tipoA !== tipoB) return tipoA.localeCompare(tipoB)
      } else if (cat.includes('TUBOS')) {
        // Para tubos usamos las 2 primeras palabras (ej: TUBO PULIDO, TUBO PVC)
        const tipoA = nombreA.split(' ').slice(0, 2).join(' ')
        const tipoB = nombreB.split(' ').slice(0, 2).join(' ')
        if (tipoA !== tipoB) return tipoA.localeCompare(tipoB)
      }

      // Luego ordenar por dimensiones
      const dimsA = extraerDimensiones(nombreA)
      const dimsB = extraerDimensiones(nombreB)

      const maxLen = Math.min(dimsA.length, dimsB.length)
      for (let i = 0; i < maxLen; i++) {
        if (dimsA[i] !== dimsB[i]) return dimsA[i] - dimsB[i]
      }

      return nombreA.localeCompare(nombreB)
    })
  })
  const categoriasOrdenadas = Object.keys(grupos).sort()

  // ─── Definir columnas dinámicas según opciones ──────────────────────────
  const cols = []
  let xCursor = MARGIN

  let usedCodigoW = 0
  if (columnas.codigo !== false) { // Default to true if undefined
    cols.push({ key: 'codigo', label: 'CÓDIGO', x: xCursor, w: 22 })
    usedCodigoW = 22
    xCursor += 22
  }

  const nombreCol = { key: 'nombre', label: 'DESCRIPCIÓN DE PRODUCTO', x: xCursor, w: 0 }
  cols.push(nombreCol)

  const rightCols = []
  if (columnas.unidad !== false) rightCols.push({ key: 'unidad', label: 'UND', w: 10 })

  const labelPrecio = (MONEDA_LABELS[moneda] || 'PRECIO DETAL USDT').toUpperCase()
  rightCols.push({ key: 'precio', label: labelPrecio, w: 32 })

  if (columnas.precio2) {
    const labelPrecio2 = moneda === 'bs' ? 'PRECIO MAYOR Bs' : moneda === 'bcv' ? 'PRECIO MAYOR BCV' : 'PRECIO MAYOR USDT'
    rightCols.push({ key: 'precio2', label: labelPrecio2, w: 32 })
  }

  if (columnas.stock) {
    rightCols.push({ key: 'stock', label: 'STOCK', w: 16 })
  }

  const rightTotalW = rightCols.reduce((sum, c) => sum + c.w, 0)
  nombreCol.w = CONTENT_W - usedCodigoW - rightTotalW

  let rightX = nombreCol.x + nombreCol.w
  rightCols.forEach(c => {
    c.x = rightX
    rightX += c.w
    cols.push(c)
  })

  function drawTableHeader(yPos, isGrid) {
    const TH_H = 5.0
    if (isGrid) {
      doc.setDrawColor(180, 180, 180)
      doc.setLineWidth(0.3)
      doc.setFillColor(20, 20, 20)
      doc.rect(MARGIN, yPos, CONTENT_W, TH_H, 'FD')
      cols.forEach(col => {
        if (col.x > MARGIN) doc.line(col.x, yPos, col.x, yPos + TH_H)
      })
    } else {
      doc.setDrawColor(0, 0, 0) // Black lines
      doc.setLineWidth(0.4)
      doc.line(MARGIN, yPos, MARGIN + CONTENT_W, yPos)
      doc.line(MARGIN, yPos + TH_H, MARGIN + CONTENT_W, yPos + TH_H)
    }
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    if (isGrid) {
      doc.setTextColor(255, 255, 255)
    } else {
      doc.setTextColor(0, 0, 0)
    }
    
    cols.forEach(col => {
      const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
      let tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
      if (isGrid && align === 'left') tx = col.x + 2
      
      let fs = 6.5
      doc.setFontSize(fs)
      while (doc.getTextWidth(col.label) > col.w - 3 && fs > 4.5) {
        fs -= 0.5
        doc.setFontSize(fs)
      }
      
      doc.text(col.label, tx, yPos + 3.8, { align })
      doc.setFontSize(6.5) // restore
    })
    return yPos + (isGrid ? 5.5 : 6.5)
  }

  // ─── Resumen rápido ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C_GRAY)
  doc.text(`${productos.length} producto${productos.length !== 1 ? 's' : ''} · ${categoriasOrdenadas.length} categoría${categoriasOrdenadas.length !== 1 ? 's' : ''}`, MARGIN, y + 3)
  y += 8

  // ─── Iterar por categoría ────────────────────────────────────────────────
  const isGrid = formato === 'cuadricula'
  let needsHeader = true
  const ROW_H = 5.2

  categoriasOrdenadas.forEach(cat => {
    const items = grupos[cat]

    // 1. Agrupar items de la categoría por subcategoría
    const subgrupos = {}
    items.forEach(p => {
      const sub = obtenerSubcategoria(p.nombre, cat)
      if (!subgrupos[sub]) subgrupos[sub] = []
      subgrupos[sub].push(p)
    })

    const subcats = Object.keys(subgrupos).sort((a, b) => {
      if (a === 'OTROS') return 1
      if (b === 'OTROS') return -1
      if (cat === 'LAMINAS') {
        const order = [
          'LÁMINAS DE HIERRO PULIDO (HP)',
          'LÁMINAS DE HIERRO NEGRO (HN)',
          'LÁMINAS ESTRIADAS',
          'LÁMINAS GALVANIZADAS LISAS',
          'LOSACERO (LOSA ESTRUCTURAL)',
          'LÁMINAS DE ZINC',
          'LÁMINAS PREPINTADAS',
          'LÁMINAS TERMOPANEL',
          'LÁMINAS ARQUITECTÓNICAS',
          'LÁMINAS PARA TECHO',
          'ACCESORIOS PARA TECHO'
        ]
        const indexA = order.indexOf(a)
        const indexB = order.indexOf(b)
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB
        }
        if (indexA !== -1) return -1
        if (indexB !== -1) return 1
      }
      if (cat === 'VIGAS') {
        const order = [
          'VIGAS IPE',
          'VIGAS WF',
          'VIGAS IPN',
          'VIGAS HEA',
          'VIGAS HEB',
          'VIGAS UPL',
          'VIGAS UPN',
          'VIGAS VP'
        ]
        const indexA = order.indexOf(a)
        const indexB = order.indexOf(b)
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB
        }
        if (indexA !== -1) return -1
        if (indexB !== -1) return 1
      }
      return a.localeCompare(b)
    })
    const catIndex = categoriasOrdenadas.indexOf(cat) + 1

    // Subtítulo de categoría
    let prevY = y
    const bottomMargin = doc.internal.getNumberOfPages() === 1 ? 35 : 12
    y = checkPage(doc, y, 15, (d) => drawSimplifiedHeader(d, LOGO_LISTA_PRECIOS, config, 'Lista de Precios (Cont.)', LP_BG, LP_TEXT), bottomMargin)
    if (needsHeader || y < prevY) {
      y = drawTableHeader(y, isGrid)
      needsHeader = false
    }

    const CAT_H = 5.0
    if (isGrid) {
      doc.setFillColor(200, 205, 210)
      doc.rect(MARGIN, y, CONTENT_W, CAT_H, 'F')
      doc.setDrawColor(180, 180, 180)
      doc.setLineWidth(0.3)
      doc.rect(MARGIN, y, CONTENT_W, CAT_H, 'S')
    } else {
      doc.setFillColor(210, 210, 210)
      doc.rect(MARGIN, y, CONTENT_W, CAT_H, 'F')
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(0, 0, 0)
    const indexStr = String(catIndex)
    doc.text(indexStr, MARGIN + 2, y + 3.7)
    doc.text(cat.toUpperCase(), MARGIN + 10, y + 3.7)
        y += (isGrid ? 5.5 : 6.0)

    // Filtrar subcategorías válidas para numeración ordenada
    const subcatsValidas = subcats.filter(s => s !== 'OTROS')
    const tieneSubcategorias = subcatsValidas.length > 0 && items.length > 1

    if (tieneSubcategorias) {
      // 1. Dibujar primero los items generales (OTROS) directamente bajo la categoría principal
      const otrosItems = subgrupos['OTROS'] || []
      if (otrosItems.length > 0) {
        otrosItems.forEach((p, idx) => {
          const nombreColDef = cols.find(c => c.key === 'nombre')
          const nombreMaxW = nombreColDef ? nombreColDef.w - 2 : 50
          const nombreLines = doc.splitTextToSize(p.nombre || '—', nombreMaxW)
          const hRow = 5.2 + (nombreLines.length - 1) * 3.5

          let prevYItem = y
          const bottomMarginItem = doc.internal.getNumberOfPages() === 1 ? 35 : 12
          y = checkPage(doc, y, hRow, (d) => drawSimplifiedHeader(d, LOGO_LISTA_PRECIOS, config, 'Lista de Precios (Cont.)', LP_BG, LP_TEXT), bottomMarginItem)
          if (y < prevYItem) {
            y = drawTableHeader(y, isGrid)
            needsHeader = false
          }

          if (isGrid) {
            if (idx % 2 === 0) {
              doc.setFillColor(252, 252, 255)
              doc.rect(MARGIN, y, CONTENT_W, hRow, 'FD')
            } else {
              doc.rect(MARGIN, y, CONTENT_W, hRow, 'S')
            }
            cols.forEach(col => {
              if (col.x > MARGIN) doc.line(col.x, y, col.x, y + hRow)
            })
          } else {
            if (idx % 2 === 0) {
              doc.setFillColor(252, 252, 253)
              doc.rect(MARGIN, y, CONTENT_W, hRow, 'F')
            }
          }

          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...C_DARK)

          cols.forEach(col => {
            let val = ''
            const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
            let tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
            if (isGrid && align === 'left') tx = col.x + 2

            const colMaxW = col.w - 2 // 1mm padding each side

            switch (col.key) {
              case 'codigo':
                val = fitText(doc, p.codigo || '—', colMaxW)
                break
              case 'unidad':
                val = (p.unidad || 'Und')
                val = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()
                break
              case 'stock':
                val = p.stock_actual != null ? Number(p.stock_actual).toLocaleString('es-VE') : '—'
                if (p.stock_actual <= 0) doc.setTextColor(185, 28, 28)
                break
              case 'precio':
              case 'precio2':
                const basePrecio = col.key === 'precio' ? p.precio_usd : p.precio_2;
                if (basePrecio != null) {
                  const usd = Number(basePrecio)
                  if (moneda === 'bs' && tasa > 0) {
                     val = 'Bs ' + (usd * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  } else {
                     val = '$' + usd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  }
                } else {
                  val = '—'
                }
                break
            }

            const textY = y + 3.8
            if (isGrid && ['precio', 'precio2', 'stock'].includes(col.key) && val !== '—') doc.setFont('helvetica', 'bold')

            if (col.key === 'nombre') {
              nombreLines.forEach((lineText, lineIdx) => {
                doc.text(lineText, tx, y + 3.8 + lineIdx * 3.5)
              })
            } else {
              doc.text(val, tx, textY, { align })
            }

            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...C_DARK)
          })

          y += hRow
        })
      }

      // 2. Luego, iterar solo las subcategorías válidas (con cabecera numerada)
      subcatsValidas.forEach((subcat, subIdx) => {
        const subItems = subgrupos[subcat]
        const visibleIdx = subIdx + 1
        const subIndexStr = `${catIndex}.${visibleIdx}`

        // Sub-encabezado de subcategoría
        let prevYSub = y
        y = checkPage(doc, y, 12, (d) => drawSimplifiedHeader(d, LOGO_LISTA_PRECIOS, config, 'Lista de Precios (Cont.)', LP_BG, LP_TEXT), bottomMargin)
        if (y < prevYSub) {
          y = drawTableHeader(y, isGrid)
        }

        const SUBCAT_H = 4.4
        if (isGrid) {
          doc.setFillColor(220, 225, 230)
          doc.rect(MARGIN, y, CONTENT_W, SUBCAT_H, 'F')
          doc.setDrawColor(180, 180, 180)
          doc.setLineWidth(0.3)
          doc.rect(MARGIN, y, CONTENT_W, SUBCAT_H, 'S')
        } else {
          doc.setFillColor(230, 232, 235)
          doc.rect(MARGIN, y, CONTENT_W, SUBCAT_H, 'F')
        }

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.0)
        doc.setTextColor(50, 50, 50)
        doc.text(subIndexStr, MARGIN + 4, y + 3.1)
        doc.text(subcat.toUpperCase(), MARGIN + 13, y + 3.1)
        y += (isGrid ? 4.9 : 5.2)

        // Filas de productos de la subcategoría
        subItems.forEach((p, idx) => {
          const nombreColDef = cols.find(c => c.key === 'nombre')
          const nombreMaxW = nombreColDef ? nombreColDef.w - 2 : 50
          const nombreLines = doc.splitTextToSize(p.nombre || '—', nombreMaxW)
          const hRow = 5.2 + (nombreLines.length - 1) * 3.5

          let prevYItem = y
          const bottomMarginItem = doc.internal.getNumberOfPages() === 1 ? 35 : 12
          y = checkPage(doc, y, hRow, (d) => drawSimplifiedHeader(d, LOGO_LISTA_PRECIOS, config, 'Lista de Precios (Cont.)', LP_BG, LP_TEXT), bottomMarginItem)
          if (y < prevYItem) {
            y = drawTableHeader(y, isGrid)
            needsHeader = false
          }

          if (isGrid) {
            if (idx % 2 === 0) {
              doc.setFillColor(252, 252, 255)
              doc.rect(MARGIN, y, CONTENT_W, hRow, 'FD')
            } else {
              doc.rect(MARGIN, y, CONTENT_W, hRow, 'S')
            }
            cols.forEach(col => {
              if (col.x > MARGIN) doc.line(col.x, y, col.x, y + hRow)
            })
          } else {
            if (idx % 2 === 0) {
              doc.setFillColor(252, 252, 253)
              doc.rect(MARGIN, y, CONTENT_W, hRow, 'F')
            }
          }

          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...C_DARK)

          cols.forEach(col => {
            let val = ''
            const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
            let tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
            if (isGrid && align === 'left') tx = col.x + 2

            const colMaxW = col.w - 2 // 1mm padding each side

            switch (col.key) {
              case 'codigo':
                val = fitText(doc, p.codigo || '—', colMaxW)
                break
              case 'unidad':
                val = (p.unidad || 'Und')
                val = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()
                break
              case 'stock':
                val = p.stock_actual != null ? Number(p.stock_actual).toLocaleString('es-VE') : '—'
                if (p.stock_actual <= 0) doc.setTextColor(185, 28, 28)
                break
              case 'precio':
              case 'precio2':
                const basePrecio = col.key === 'precio' ? p.precio_usd : p.precio_2;
                if (basePrecio != null) {
                  const usd = Number(basePrecio)
                  if (moneda === 'bs' && tasa > 0) {
                     val = 'Bs ' + (usd * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  } else {
                     val = '$' + usd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  }
                } else {
                  val = '—'
                }
                break
            }

            const textY = y + 3.8
            if (isGrid && ['precio', 'precio2', 'stock'].includes(col.key) && val !== '—') doc.setFont('helvetica', 'bold')

            if (col.key === 'nombre') {
              nombreLines.forEach((lineText, lineIdx) => {
                doc.text(lineText, tx, y + 3.8 + lineIdx * 3.5)
              })
            } else {
              doc.text(val, tx, textY, { align })
            }

            doc.setFont('helvetica', 'normal')
            doc.setTextColor(...C_DARK)
          })

          y += hRow
        })
      })
    } else {
      // Filas de productos normales si no hay subcategorías
      items.forEach((p, idx) => {
        const nombreColDef = cols.find(c => c.key === 'nombre')
        const nombreMaxW = nombreColDef ? nombreColDef.w - 2 : 50
        const nombreLines = doc.splitTextToSize(p.nombre || '—', nombreMaxW)
        const hRow = 5.2 + (nombreLines.length - 1) * 3.5

        let prevYItem = y
        const bottomMarginItem = doc.internal.getNumberOfPages() === 1 ? 35 : 12
        y = checkPage(doc, y, hRow, (d) => drawSimplifiedHeader(d, LOGO_LISTA_PRECIOS, config, 'Lista de Precios (Cont.)', LP_BG, LP_TEXT), bottomMarginItem)
        if (y < prevYItem) {
          y = drawTableHeader(y, isGrid)
          needsHeader = false
        }

        if (isGrid) {
          if (idx % 2 === 0) {
            doc.setFillColor(252, 252, 255)
            doc.rect(MARGIN, y, CONTENT_W, hRow, 'FD')
          } else {
            doc.rect(MARGIN, y, CONTENT_W, hRow, 'S')
          }
          cols.forEach(col => {
            if (col.x > MARGIN) doc.line(col.x, y, col.x, y + hRow)
          })
        } else {
          if (idx % 2 === 0) {
            doc.setFillColor(252, 252, 253)
            doc.rect(MARGIN, y, CONTENT_W, hRow, 'F')
          }
        }

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...C_DARK)

        cols.forEach(col => {
          let val = ''
          const align = ['precio', 'precio2', 'stock'].includes(col.key) ? 'right' : 'left'
          let tx = align === 'right' ? col.x + col.w - 2 : col.x + 1
          if (isGrid && align === 'left') tx = col.x + 2

          const colMaxW = col.w - 2 // 1mm padding each side

          switch (col.key) {
            case 'codigo':
              val = fitText(doc, p.codigo || '—', colMaxW)
              break
            case 'unidad':
              val = (p.unidad || 'Und')
              val = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()
              break
            case 'stock':
              val = p.stock_actual != null ? Number(p.stock_actual).toLocaleString('es-VE') : '—'
              if (p.stock_actual <= 0) doc.setTextColor(185, 28, 28)
              break
            case 'precio':
            case 'precio2':
              const basePrecio = col.key === 'precio' ? p.precio_usd : p.precio_2;
              if (basePrecio != null) {
                const usd = Number(basePrecio)
                if (moneda === 'bs' && tasa > 0) {
                   val = 'Bs ' + (usd * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                } else {
                   val = '$' + usd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                }
              } else {
                val = '—'
              }
              break
          }

          const textY = y + 3.8
          if (isGrid && ['precio', 'precio2', 'stock'].includes(col.key) && val !== '—') doc.setFont('helvetica', 'bold')

          if (col.key === 'nombre') {
            nombreLines.forEach((lineText, lineIdx) => {
              doc.text(lineText, tx, y + 3.8 + lineIdx * 3.5)
            })
          } else {
            doc.text(val, tx, textY, { align })
          }

          doc.setFont('helvetica', 'normal')
          doc.setTextColor(...C_DARK)
        })

        y += hRow
      })
    }

    y += (isGrid ? 0 : 2)
  })

  drawFooter(doc, config)
  doc.save(`Lista_Precios_${new Date().toISOString().slice(0, 10)}.pdf`)
}
