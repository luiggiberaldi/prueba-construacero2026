// src/services/pdf/comisionesPDF.js
// Genera PDF profesional de Reporte de Comisiones — formato Listo POS
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import { LOGO_LISTA_PRECIOS } from './logoListaPreciosBase64'
import {
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_EMERALD, C_AMBER, C_GRAY, C_RED,
  fmtUsd, fmtBs, fmtBsShort, fmtFecha, fmtFechaCorta,
  hexToRgb, drawWatermark, checkPage, drawSimplifiedHeader, drawPremiumHeader, drawPremiumFooter
} from './pdfShared'

// ─── Generar Reporte de Comisiones ───────────────────────────────────────────
// ─── Generar Reporte de Comisiones ───────────────────────────────────────────
export async function generarComisionesPDF({ comisiones, vendedor = null, tipoVendedor = null, resumen = null, rango = null, config = {}, action = 'download', formato = 'detallado', tasaEuro = null, ajustesManuales = {} }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  let y = 0

  const logoData = LOGO_LISTA_PRECIOS

  const handlePageAdd = (d) => {
    let rightTitle = 'Reporte de Comisiones'
    if (tipoVendedor === 'internos') rightTitle = 'Comisiones (Vendedores Internos)'
    else if (tipoVendedor === 'externos') rightTitle = 'Comisiones (Vendedores Externos)'
    else if (vendedor) rightTitle = `Comisiones - ${vendedor.nombre}`
    return drawSimplifiedHeader(d, logoData, config, rightTitle, [255, 255, 255], [0, 0, 0])
  }

  function drawStatusBadge(d, estado, x, y, w, h) {
    let bgColor = [241, 245, 249] // slate 100
    let borderColor = [226, 232, 240] // slate 200
    let textColor = [71, 85, 105] // slate 600
    let text = 'PENDIENTE'
    
    if (estado === 'pagada') {
      bgColor = [236, 253, 245] // emerald 50
      borderColor = [167, 243, 208] // emerald 200
      textColor = [4, 120, 87] // emerald 700
      text = 'PAGADA'
    } else if (estado === 'cta_cobrar') {
      bgColor = [254, 242, 242] // red 50 (#FEF2F2)
      borderColor = [254, 202, 202] // red 200 (#FECACA)
      textColor = [185, 28, 28] // red 700 (#B91C1C)
      text = 'CTA X COBRAR'
    } else {
      bgColor = [255, 251, 235] // amber 50
      borderColor = [253, 230, 138] // amber 200
      textColor = [180, 83, 9] // amber 700
      text = 'PENDIENTE'
    }
    
    d.setFont('helvetica', 'bold')
    d.setFontSize(7.0)
    
    const textW = d.getTextWidth(text)
    const badgeW = Math.min(w, textW + 4)
    const badgeX = x + (w - badgeW) / 2
    
    d.setFillColor(...bgColor)
    d.roundedRect(badgeX, y - h + 1, badgeW, h, 1.2, 1.2, 'F')
    
    d.setDrawColor(...borderColor)
    d.setLineWidth(0.2)
    d.roundedRect(badgeX, y - h + 1, badgeW, h, 1.2, 1.2, 'S')
    
    d.setTextColor(...textColor)
    d.text(text, badgeX + badgeW / 2, y - h / 2 + 1.4, { align: 'center' })
  }

  // Obtener porcentaje de comisión para un artículo específico
  function obtenerPctItem(p, esExterno, pctCabilla, pctOtros, catCabilla) {
    const nombre = (p.nombre_snap || p.nombre || '').toLowerCase().trim();
    const categoria = (p.producto?.categoria || p.categoria || '').toLowerCase().trim();
    const catCab = (catCabilla || 'cabilla').toLowerCase().trim();
    
    // 1. Si es de origen externo
    if (p.origen === 'externo') {
      return pctOtros;
    }
    
    // 2. Si es cemento y el vendedor es externo, usa la comisión de cabilla (2%)
    if (esExterno && (categoria === 'cemento' || nombre.includes('cemento'))) {
      return pctCabilla;
    }
    
    // 3. Si la categoría o el nombre coincide con catCabilla, usa la comisión de cabilla
    if (categoria === catCab || nombre.includes(catCab)) {
      return pctCabilla;
    }
    
    // 4. Cualquier otro producto usa la tasa de otros (3%)
    return pctOtros;
  }

  // Desglosar comisiones por artículo individual
  function desglosarComisionesPorArticulo(lista) {
    const nuevaLista = []
    const catCabilla = (config?.comision_categoria_cabilla || 'cabilla').toLowerCase().trim()
    
    for (const c of lista) {
      const desp = c.despacho || {}
      const prods = Array.isArray(desp.productos) ? desp.productos.filter(Boolean) : []
      
      if (prods.length === 0) {
        // Fallback: no tiene productos, agregar tal cual
        nuevaLista.push(c)
        continue
      }
      
      const esExterno = c.vendedor ? (!!c.vendedor.es_externo || (c.vendedor.markup_pct != null && Number(c.vendedor.markup_pct) > 0)) : false
      const pctCabilla = Number(c.pctcabilla ?? c.pct ?? 2)
      const pctOtros = Number(c.pctotros ?? c.pct ?? 3)
      
      // 1. Calcular comisión cruda para cada artículo para poder prorratear
      let sumRawCom = 0
      const itemsCalculados = prods.map(p => {
        const itemPct = obtenerPctItem(p, esExterno, pctCabilla, pctOtros, catCabilla)
        const valorItem = Number(p.total_linea_usd ?? 0)
        const rawCom = (valorItem * itemPct) / 100
        sumRawCom += rawCom
        return {
          p,
          itemPct,
          valorItem,
          rawCom
        }
      })
      
      // 2. Crear un registro para cada artículo
      itemsCalculados.forEach(({ p, itemPct, valorItem, rawCom }) => {
        // Prorratear la comisión total del registro/evento
        const factor = sumRawCom > 0 ? (rawCom / sumRawCom) : (1 / prods.length)
        const itemTotalComision = Number((c.totalcomision * factor).toFixed(2))
        const itemMontoPagado = Number(((c.montopagado || 0) * factor).toFixed(2))
        
        // Clasificar como cabilla u otros para mantener los subtotales/totales consistentes
        const esCabilla = itemPct === pctCabilla
        const itemComisionCabilla = esCabilla ? itemTotalComision : 0
        const itemComisionOtros = esCabilla ? 0 : itemTotalComision
        
        // Limpiar nombre si ya incluye el código al principio
        let nombreLimpio = p.nombre_snap || '—'
        if (p.codigo_snap) {
          const codEscapado = p.codigo_snap.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
          const regexCorchetes = new RegExp(`^\\[${codEscapado}\\]\\s*[-:]*\\s*`, 'i')
          const regexSimple = new RegExp(`^${codEscapado}\\s*[-:]*\\s*`, 'i')
          nombreLimpio = nombreLimpio.replace(regexCorchetes, '').replace(regexSimple, '')
        }
        
        nuevaLista.push({
          ...c,
          codigo: p.codigo_snap || '',
          descripcion: nombreLimpio.toUpperCase(),
          valor: valorItem,
          pct: itemPct,
          totalcomision: itemTotalComision,
          montopagado: itemMontoPagado,
          comisioncabilla: itemComisionCabilla,
          comisionotros: itemComisionOtros
        })
      })
    }
    
    return nuevaLista
  }

  // NORMALIZAR: unificar naming antes de procesar (soporte para Worker API y RPC)
  function normalizarComision(c) {
    // Detectar si c es un evento de comision_liberaciones (Fase 7)
    const esEvento = c && (c.tipo === 'contado' || c.tipo === 'abono') && c.comisiones;
    
    if (esEvento) {
      const com = c.comisiones;
      const desp = com.despacho || {};
      const cot = com.cotizacion || {};
      const cli = desp.cliente || {};
      const vend = c.vendedor || com.vendedor || (vendedor ? { nombre: vendedor.nombre, color: vendedor.color, markup_pct: vendedor.markup_pct, es_externo: vendedor.es_externo } : null);
      
      const totalcomision = Number(c.monto || 0);
      
      // Proporción de cabilla
      const comisioncabilla = com.totalcomision > 0 
        ? Number(com.comisioncabilla || 0) * (totalcomision / com.totalcomision) 
        : 0;
      const comisionotros = totalcomision - comisioncabilla;
      
      const rawEstado = com.estado === 'pagada' ? 'pagada' : 'pendiente';

      // Nombres de los productos del despacho (si vienen adjuntos). Fallback al
      // label de liberación cuando no hay productos disponibles.
      const prods = Array.isArray(desp.productos) ? desp.productos.filter(Boolean) : [];
      const descProductos = prods.length
        ? [...new Set(prods.map(p => String(p.nombre_snap || p).toUpperCase()))].join(' · ')
        : '';
      const labelLiberacion = c.tipo === 'contado' ? 'LIBERACIÓN INICIAL (CONTADO)' : 'LIBERACIÓN POR COBRO (ABONO)';

      return {
        ...c,
        vendedor: vend,
        totalcomision,
        comisioncabilla: Number(comisioncabilla.toFixed(2)),
        comisionotros: Number(comisionotros.toFixed(2)),
        valor: Number(desp.totalusd || 0),
        pct: Number(com.pctcabilla || com.pctotros || 0),
        pctcabilla: Number(com.pctcabilla || 0),
        pctotros: Number(com.pctotros || 0),
        codigo: '',
        descripcion: descProductos || labelLiberacion,
        despachonumero: desp.numero || '---',
        montopagado: Number(com.montopagado || 0),
        tasa_snapshot: Number(tasaEuro ?? desp.tasa_snapshot ?? cot.tasa_bcv_snapshot ?? 0),
        estado: rawEstado,
        // Preservar despacho con productos para el desglose por artículo
        despacho: {
          ...desp,
          productos: desp.productos || []
        },
        clienteNombre: (() => {
          const rawName = cli.nombre || desp.cliente_nombre || '---';
          const isPersonal = cli.tipo_cliente === 'personal';
          return isPersonal ? `${String(rawName).toUpperCase()} (PERSONAL)` : String(rawName).toUpperCase();
        })(),
        creadoen: c.creado_en || c.creadoen || new Date().toISOString()
      };
    }

    const rawEstado = (c.estado_comision || c.estado || 'pendiente').toLowerCase()
    const vend = c.vendedor || (vendedor ? { nombre: vendedor.nombre, color: vendedor.color, markup_pct: vendedor.markup_pct, es_externo: vendedor.es_externo } : (c.asesor ? { nombre: c.asesor, color: c.asesor_color || '#1B365D', es_externo: c.vendedor_es_externo } : null))
    
    const esExterno = vend ? (!!vend.es_externo || (vend.markup_pct != null && Number(vend.markup_pct) > 0)) : false;
    
    let pct = Number(c.comision_pct ?? c.pct ?? 0)
    let totalcomision = Number(c.total_com ?? c.totalcomision ?? c.despacho_comision_total ?? 0)
    
    const desp = c.despacho || {};
    const prods = Array.isArray(desp.productos) ? desp.productos.filter(Boolean) : [];
    const descProductos = prods.length
      ? [...new Set(prods.map(p => String(p.nombre_snap || p).toUpperCase()))].join(' · ')
      : '';

    const descLower = (c.descripcion || c.nombre_snap || descProductos || '').toLowerCase().trim()
    const catLower = (c.categoria || '').toLowerCase().trim()
    
    if (esExterno && (catLower === 'cemento' || descLower.includes('cemento'))) {
      const pctCabilla = config?.comision_ext_pct_cabilla ?? 2
      pct = pctCabilla
      totalcomision = Number((Number(c.total ?? c.total_linea_neto ?? 0) * pctCabilla / 100).toFixed(2))
    }
    
    return {
      ...c,
      vendedor: vend,
      // Totales (Prioridad a RPC si existen, luego Worker, luego default)
      totalcomision,
      comisioncabilla: Number(c.comisioncabilla ?? 0),
      comisionotros: Number(c.comisionotros ?? 0),
      pctcabilla: Number(c.pctcabilla ?? pct),
      pctotros: Number(c.pctotros ?? pct),
      // Valor del item (si aplica)
      valor: Number(c.total ?? c.total_linea_neto ?? 0),
      pct,
      // Producto
      codigo: c.codigo || '',
      descripcion: (c.descripcion || c.nombre_snap || descProductos || '---').toUpperCase(),
      // Número de despacho
      despachonumero: c.despacho_numero || c.despachonumero || c.despacho?.numero || '---',
      montopagado: Number(c.despacho_comision_liberada ?? c.montopagado ?? 0),
      // Tasa
      tasa_snapshot: Number(
        tasaEuro ??
        c.tasa ??
        c.tasa_snapshot ?? 
        c.despacho?.tasa_snapshot ?? 
        c.cotizacion?.tasa_bcv_snapshot ?? 
        0
      ),
      // Preservar despacho con productos para el desglose por artículo
      despacho: desp ? { ...desp, productos: desp.productos || [] } : null,
      // Mapeo de estados: 'pagada' es el único estado que suma al pagado, resto son pendientes
      estado: rawEstado,
      clienteNombre: (() => {
        const rawName = c.cliente || c.despacho?.cliente_nombre || c.cotizacion?.cliente_nombre || '---';
        const isPersonal = c.cliente_tipo_cliente === 'personal' || c.despacho?.cliente_tipo_cliente === 'personal';
        return isPersonal ? `${String(rawName).toUpperCase()} (PERSONAL)` : String(rawName).toUpperCase();
      })(),
      creadoen: c.fecha || c.creadoen || new Date().toISOString()
    }
  }

  const ordenarPorVendedorYDocumento = (a, b) => {
    const nombreA = (a.vendedor?.nombre || '').trim().toLowerCase();
    const nombreB = (b.vendedor?.nombre || '').trim().toLowerCase();
    if (nombreA < nombreB) return -1;
    if (nombreA > nombreB) return 1;

    // Mismo vendedor, ordenar por número de despacho descendente
    const numA = parseInt(String(a.despachonumero).replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(String(b.despachonumero).replace(/\D/g, ''), 10) || 0;
    if (numA !== numB) {
      return numB - numA;
    }

    // Mismo despacho, ordenar por fecha descendente
    const dateA = new Date(a.creadoen).getTime() || 0;
    const dateB = new Date(b.creadoen).getTime() || 0;
    if (dateA !== dateB) {
      return dateB - dateA;
    }

    // Por descripción
    const descA = (a.descripcion || '').toLowerCase();
    const descB = (b.descripcion || '').toLowerCase();
    return descA.localeCompare(descB);
  };

  const comisionesNorm = desglosarComisionesPorArticulo(
    (comisiones || [])
      .map(normalizarComision)
      .filter(c => c.estado !== 'cta_cobrar' || c.tipo !== undefined)
  ).sort(ordenarPorVendedorYDocumento)
  console.log('[generarComisionesPDF] Comisiones normalizadas para el PDF:', comisionesNorm.map(c => ({
    id: c.id,
    doc: c.despachonumero,
    clienteNombre: c.clienteNombre,
    despachoRaw: c.despacho,
    cotizacionRaw: c.cotizacion
  })));
  // Si hay descripciones significativas, es el reporte detallado
  const esDetallado = comisionesNorm.some(c => c.descripcion && c.descripcion !== '---')

  let subTitleText = 'Reporte de Comisiones'
  if (tipoVendedor === 'internos') subTitleText = 'Reporte de Comisiones — Internos'
  else if (tipoVendedor === 'externos') subTitleText = 'Reporte de Comisiones — Externos'
  
  let subHeaderDate = fmtFecha(new Date().toISOString(), 'short-month')
  if (rango && (rango.from || rango.to)) {
    subHeaderDate = `Periodo: ${rango.from ? fmtFechaCorta(rango.from) : 'Inicio'} al ${rango.to ? fmtFechaCorta(rango.to) : 'Fin'}`
  }

  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: subTitleText,
    subtitle: subHeaderDate,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true
  })

  // Watermark
  drawWatermark(doc)

  // ══════════════════════════════════════════════════════════════════════════
  // 2. INFO VENDEDOR (si aplica)
  // ══════════════════════════════════════════════════════════════════════════
  if (vendedor) {
    const vColor = hexToRgb(vendedor.color)
    doc.setFillColor(vColor[0], vColor[1], vColor[2])
    doc.roundedRect(MARGIN, y, 4, 10, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13.5)
    doc.setTextColor(...C_DARK)
    const esExterno = !!vendedor.es_externo || (vendedor.markup_pct != null && Number(vendedor.markup_pct) > 0);
    const labelV = esExterno ? `${vendedor.nombre} — Vendedor Externo (+${vendedor.markup_pct || 0}%)` : `${vendedor.nombre} — Vendedor Interno`;
    doc.text(labelV, MARGIN + 7, y + 7)
    y += 14
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. RESUMEN
  // ══════════════════════════════════════════════════════════════════════════
  const pends = comisionesNorm.filter(c => c.estado === 'pendiente')
  const cxc = comisionesNorm.filter(c => c.estado === 'cta_cobrar')
  const pagadas = comisionesNorm.filter(c => c.estado === 'pagada')
  
  // 1) "Saldo Pendiente": sum( max(totalcomision - montopagado, 0) ) para estados pendiente y cta_cobrar
  const totalPendiente = comisionesNorm
    .filter(c => ['pendiente', 'cta_cobrar'].includes(c.estado))
    .reduce((s, c) => s + Math.max(c.totalcomision - (c.montopagado || 0), 0), 0)
    
  // Desglose de pendientes
  const totalPendienteRegular = comisionesNorm
    .filter(c => c.estado === 'pendiente')
    .reduce((s, c) => s + Math.max(c.totalcomision - (c.montopagado || 0), 0), 0)

  const totalPendienteCxc = comisionesNorm
    .filter(c => c.estado === 'cta_cobrar')
    .reduce((s, c) => s + Math.max(c.totalcomision - (c.montopagado || 0), 0), 0)
    
  // 2) "Total Pagado": sum(COALESCE(montopagado, 0)) de todas
  const totalPagado = comisionesNorm.reduce((s, c) => s + (c.montopagado || 0), 0)
  
  // 3) "Generado Histórico": sum(totalcomision) de todas
  const totalGeneral = comisionesNorm.reduce((s, c) => s + c.totalcomision, 0)

  // Cuadro resumen premium
  const boxH = 18
  const boxW = CONTENT_W / 3
  const uniqueDocsCount = new Set(comisionesNorm.map(c => c.despachonumero)).size
  const uniquePagadasCount = new Set(pagadas.map(c => c.despachonumero)).size
  const uniquePendsCount = new Set(pends.map(c => c.despachonumero)).size
  const uniqueCxcCount = new Set(cxc.map(c => c.despachonumero)).size

  const boxes = [
    { 
      label: 'Generado Histórico', 
      value: fmtUsd(totalGeneral), 
      count: `${uniqueDocsCount} comisiones`, 
      bgColor: [248, 250, 252], // Slate 50
      borderColor: [226, 232, 240], // Slate 200
      textColor: [15, 23, 42], // Slate 900
      badgeColor: [100, 116, 139] // Slate 500
    },
    { 
      label: 'Total Pagado', 
      value: fmtUsd(totalPagado), 
      count: `${uniquePagadasCount} pagadas`, 
      bgColor: [236, 253, 245], // Emerald 50
      borderColor: [167, 243, 208], // Emerald 200
      textColor: [4, 120, 87], // Emerald 700
      badgeColor: [5, 150, 105] // Emerald 600
    },
    { 
      label: 'Saldo Pendiente', 
      value: fmtUsd(totalPendiente), 
      count: `${uniquePendsCount} pend / ${uniqueCxcCount} cxc`, 
      bgColor: [255, 251, 235], // Amber 50
      borderColor: [253, 230, 138], // Amber 200
      textColor: [180, 83, 9], // Amber 700
      badgeColor: [217, 119, 6] // Amber 600
    },
  ]

  boxes.forEach((box, i) => {
    const bx = MARGIN + i * boxW
    
    // Draw background
    doc.setFillColor(...box.bgColor)
    doc.roundedRect(bx + 1, y, boxW - 2, boxH, 2.5, 2.5, 'F')
    
    // Draw border
    doc.setDrawColor(...box.borderColor)
    doc.setLineWidth(0.4)
    doc.roundedRect(bx + 1, y, boxW - 2, boxH, 2.5, 2.5, 'S')
    
    // Draw content
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...box.badgeColor)
    doc.text(box.label.toUpperCase(), bx + 4.5, y + 5.5)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13.5)
    doc.setTextColor(...box.textColor)
    doc.text(box.value, bx + 4.5, y + 11.5)
    
    if (i === 2) {
      // Dibujar desglose premium
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.7)
      doc.setTextColor(217, 119, 6) // Amber 600
      const txtReg = `Reg: ${fmtUsd(totalPendienteRegular)}  ·  `
      doc.text(txtReg, bx + 4.5, y + 15.5)
      const offset = doc.getTextWidth(txtReg)
      doc.setTextColor(185, 28, 28) // Red 700
      doc.text(`CxC: ${fmtUsd(totalPendienteCxc)}`, bx + 4.5 + offset, y + 15.5)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.0)
      doc.setTextColor(...box.badgeColor)
      doc.text(box.count, bx + 4.5, y + 15.5)
    }
  })

  y += boxH + 4

  if (tasaEuro && Number(tasaEuro) > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(79, 70, 229) // Indigo 600
    doc.text(`Tasa de Referencia Euro BCV: ${fmtBs(tasaEuro)}`, MARGIN + 1, y + 1.5)
    y += 7.0
  }

  // DRAW VISUAL BREAKDOWN BAR (Barra de progreso)
  if (totalGeneral > 0) {
    const barH = 5
    const barW = CONTENT_W
    const pctPagado = (totalPagado / totalGeneral) * 100
    const pctPendiente = (totalPendiente / totalGeneral) * 100
    const wPagado = (totalPagado / totalGeneral) * barW

    y = checkPage(doc, y, 14)
    
    // Label
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.0)
    doc.setTextColor(...C_DARK)
    doc.text('Distribución de Liquidación:', MARGIN + 1, y + 3)
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_GRAY)
    const labelPct = `${pctPagado.toFixed(1)}% Pagado · ${pctPendiente.toFixed(1)}% Pendiente`
    doc.text(labelPct, MARGIN + CONTENT_W - 1, y + 3, { align: 'right' })
    
    y += 4.5

    // Background track
    doc.setFillColor(241, 245, 249) // Gray 100
    doc.roundedRect(MARGIN, y, barW, barH, 1.5, 1.5, 'F')

    // Emerald fill (Pagado)
    if (wPagado > 0) {
      doc.setFillColor(16, 185, 129) // Emerald 500
      doc.roundedRect(MARGIN, y, wPagado, barH, 1.5, 1.5, 'F')
    }

    // Amber fill (Pendiente)
    if (barW - wPagado > 0.5) {
      doc.setFillColor(245, 158, 11) // Amber 500
      doc.roundedRect(MARGIN + wPagado, y, barW - wPagado, barH, 1.5, 1.5, 'F')
      
      // Draw divider line if both parts exist
      if (wPagado > 0 && wPagado < barW) {
        doc.setFillColor(255, 255, 255)
        doc.rect(MARGIN + wPagado - 0.2, y, 0.4, barH, 'F')
      }
    }

    y += barH + 6
  } else {
    y += 4
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. TABLA DE COMISIONES
  // ══════════════════════════════════════════════════════════════════════════
  // Header de la tabla
  let cols = []
  
  if (esDetallado) {
    cols = [
      { label: 'Fecha', x: MARGIN, w: 12 },
      { label: 'Doc / Cliente', x: MARGIN + 12, w: 35 },
      { label: 'Producto / Descripción', x: MARGIN + 47, w: 45 },
      { label: 'Valor ($)', x: MARGIN + 92, w: 14, align: 'right' },
      { label: '%', x: MARGIN + 106, w: 6, align: 'right' },
      { label: 'Com ($)', x: MARGIN + 112, w: 14, align: 'right' },
      { label: 'Tasa EUR', x: MARGIN + 126, w: 15, align: 'right' },
      { label: 'Com (Bs)', x: MARGIN + 141, w: 25, align: 'right' },
      { label: 'Estado', x: MARGIN + 166, w: 22, align: 'center' },
    ]
  } else {
    const catName = config.comision_categoria_cabilla || 'Cabilla';
    const pct = tipoVendedor === 'externos' ? (config.comision_ext_pct_cabilla || 2) : (config.comision_pct_cabilla || 2);
    const cabLabel = tipoVendedor === 'externos' 
      ? `Cemento (${pct}%) ($)` 
      : `${catName} (${pct}%) ($)`;

    cols = [
      { label: 'Fecha', x: MARGIN, w: 12 },
      { label: 'Doc / Cliente', x: MARGIN + 12, w: 35 },
      { label: cabLabel, x: MARGIN + 47, w: 28, align: 'right' },
      { label: 'Otros ($)', x: MARGIN + 75, w: 15, align: 'right' },
      { label: 'Total Com ($)', x: MARGIN + 90, w: 18, align: 'right' },
      { label: 'Abonado ($)', x: MARGIN + 108, w: 17, align: 'right' },
      { label: 'Tasa EUR', x: MARGIN + 125, w: 16, align: 'right' },
      { label: 'Com. (Bs)', x: MARGIN + 141, w: 27, align: 'right' },
      { label: 'Estado', x: MARGIN + 168, w: 20, align: 'center' },
    ]
  }

  function drawTableHeader(doc, yPos) {
    // Solo líneas sutiles, sin fondo gris pesado
    doc.setDrawColor(210, 215, 225)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, yPos, MARGIN + CONTENT_W, yPos)
    doc.line(MARGIN, yPos + 8, MARGIN + CONTENT_W, yPos + 8)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(80, 90, 110)
    cols.forEach(col => {
      const align = col.align || 'left'
      let posX = col.x + 1
      if (align === 'right') posX = col.x + col.w - 2
      if (align === 'center') posX = col.x + (col.w / 2)
      
      const lines = doc.splitTextToSize(col.label, col.w - 2)
      if (lines.length > 1) {
        lines.forEach((line, lineIdx) => {
          doc.text(line, posX, yPos + 3.2 + (lineIdx * 3.0), { align })
        })
      } else {
        doc.text(col.label, posX, yPos + 5, { align })
      }
    })
    return yPos + 9.5
  }

  function dibujarTablaResumida(sellers) {
    y = checkPage(doc, y, 18, handlePageAdd);
    
    const rateVal = Number(tasaEuro || 0);
    const tasaLabel = rateVal > 0 ? fmtBsShort(rateVal) : 'N/D';

    const colDateLabel = rango && (rango.from || rango.to)
      ? `COMISIÓN DEL\n${rango.from ? fmtFechaCorta(rango.from) : 'INICIO'} AL ${rango.to ? fmtFechaCorta(rango.to) : 'FIN'}`
      : 'COMISIÓN DEL\nPERIODO ($)';

    const sumCols = [
      { label: 'VENDEDOR', x: MARGIN, w: 32, align: 'left' },
      { label: colDateLabel, x: MARGIN + 32, w: 38, align: 'right' },
      { label: 'COMISIÓN CUENTAS\nPOR COBRAR ($)', x: MARGIN + 70, w: 38, align: 'center', highlight: true },
      { label: 'DESCUENTO\nCARRO ($)', x: MARGIN + 108, w: 26, align: 'center' },
      { label: 'TOTAL A\nPAGAR ($)', x: MARGIN + 134, w: 26, align: 'right' },
      { label: `TOTAL EN Bs\n(TASA: ${tasaLabel})`, x: MARGIN + 160, w: 28, align: 'right' }
    ];

    // Pintar fondo amarillo en cabecera de Comisión CxC primero
    sumCols.forEach(col => {
      if (col.highlight) {
        doc.setFillColor(254, 240, 138); // Amarillo suave (yellow 200)
        doc.rect(col.x, y + 0.1, col.w, 9.3, 'F');
      }
    });

    // Líneas de cabecera
    doc.setDrawColor(210, 215, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    doc.line(MARGIN, y + 9.5, MARGIN + CONTENT_W, y + 9.5);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(80, 90, 110);
    sumCols.forEach(col => {
      const align = col.align;
      let posX = col.x + 1;
      if (align === 'right') posX = col.x + col.w - 2;
      if (align === 'center') posX = col.x + (col.w / 2);
      
      const lines = doc.splitTextToSize(col.label, col.w - 2);
      if (lines.length > 1) {
        lines.forEach((line, lineIdx) => {
          doc.text(line, posX, y + 3.5 + (lineIdx * 3.2), { align });
        });
      } else {
        doc.text(col.label, posX, y + 5.5, { align });
      }
    });
    y += 9.5;
    
    let totalGen = 0;
    let totalCxC = 0;
    let totalDescCarro = 0;
    let totalPagarUsd = 0;
    let totalBs = 0;
    
    sellers.forEach((s, idx) => {
      y = checkPage(doc, y, 9.5, handlePageAdd);
      
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253);
        doc.rect(MARGIN, y - 0.8, CONTENT_W, 8.5, 'F');
      }
      
      const rgbColor = hexToRgb(s.color || '#1B365D');
      doc.setFillColor(rgbColor[0], rgbColor[1], rgbColor[2]);
      doc.circle(MARGIN + 3, y + 3.2, 1.5, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...C_DARK);
      doc.text(s.nombre, MARGIN + 7, y + 4.2);
      
      // Comisión del periodo ($)
      doc.setFont('helvetica', 'normal');
      doc.text(fmtUsd(s.generadoUsd), MARGIN + 32 + 38 - 2, y + 4.2, { align: 'right' });
      
      // Ajustes manuales
      const ajuste = ajustesManuales[s.id] || { cxc: 0, descuentoCarro: 0 };
      const valCxC = Number(ajuste.cxc || 0);
      const valDescCarro = Number(ajuste.descuentoCarro || 0);
      
      // Comisión Cuentas por Cobrar ($) (Valor si > 0, si no líneas punteadas)
      if (valCxC > 0) {
        doc.setFont('helvetica', 'bold');
        doc.text(fmtUsd(valCxC), MARGIN + 70 + 38 - 2, y + 4.2, { align: 'right' });
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(200, 200, 200);
        doc.text('. . . . . . . . . . . .', MARGIN + 70 + 19, y + 4.2, { align: 'center' });
        doc.setTextColor(...C_DARK);
      }
      
      // Descuento Carro ($)
      if (valDescCarro > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C_RED);
        doc.text(fmtUsd(valDescCarro), MARGIN + 108 + 26 - 2, y + 4.2, { align: 'right' });
        doc.setTextColor(...C_DARK);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(200, 200, 200);
        doc.text('. . . . . . . . . .', MARGIN + 108 + 13, y + 4.2, { align: 'center' });
        doc.setTextColor(...C_DARK);
      }
      
      doc.setTextColor(...C_DARK);
      
      // Total a pagar ($)
      const filaTotalUsd = s.generadoUsd + valCxC - valDescCarro;
      doc.setFont('helvetica', 'bold');
      doc.text(fmtUsd(filaTotalUsd), MARGIN + 134 + 26 - 2, y + 4.2, { align: 'right' });
      
      // Total en Bs
      const totalFilaBs = rateVal > 0 ? filaTotalUsd * rateVal : 0;
      doc.text(rateVal > 0 ? fmtBs(totalFilaBs) : 'N/D', MARGIN + 160 + 28 - 2, y + 4.2, { align: 'right' });
      
      totalGen += s.generadoUsd;
      totalCxC += valCxC;
      totalDescCarro += valDescCarro;
      totalPagarUsd += filaTotalUsd;
      totalBs += totalFilaBs;
      
      y += 8.5;
    });
    
    // Fila del Total General
    y = checkPage(doc, y, 12, handlePageAdd);
    doc.setDrawColor(210, 215, 225);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...C_PRIMARY);
    doc.text('TOTAL GENERAL:', MARGIN + 2, y + 1);
    
    doc.setTextColor(...C_DARK);
    // Total Comisión periodo
    doc.text(fmtUsd(totalGen), MARGIN + 32 + 38 - 2, y + 1, { align: 'right' });
    
    // Total CxC
    if (totalCxC > 0) {
      doc.text(fmtUsd(totalCxC), MARGIN + 70 + 38 - 2, y + 1, { align: 'right' });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 200);
      doc.text('. . . . . . . . . . . .', MARGIN + 70 + 19, y + 1, { align: 'center' });
      doc.setTextColor(...C_DARK);
      doc.setFont('helvetica', 'bold');
    }
    
    // Total Descuento Carro
    if (totalDescCarro > 0) {
      doc.setTextColor(...C_RED);
      doc.text(fmtUsd(totalDescCarro), MARGIN + 108 + 26 - 2, y + 1, { align: 'right' });
      doc.setTextColor(...C_DARK);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 200);
      doc.text('. . . . . . . . . .', MARGIN + 108 + 13, y + 1, { align: 'center' });
      doc.setTextColor(...C_DARK);
      doc.setFont('helvetica', 'bold');
    }
    
    // Total a pagar USD
    doc.text(fmtUsd(totalPagarUsd), MARGIN + 134 + 26 - 2, y + 1, { align: 'right' });
    
    // Total en Bs
    doc.text(rateVal > 0 ? fmtBs(totalBs) : 'N/D', MARGIN + 160 + 28 - 2, y + 1, { align: 'right' });
    
    y += 8;
  }

  // Clasificación de comisiones en internos y externos
  const comisionesInternos = comisionesNorm.filter(c => {
    const esExterno = !!c.vendedor?.es_externo || (c.vendedor?.markup_pct != null && Number(c.vendedor.markup_pct) > 0);
    return !esExterno;
  });
  const comisionesExternos = comisionesNorm.filter(c => {
    const esExterno = !!c.vendedor?.es_externo || (c.vendedor?.markup_pct != null && Number(c.vendedor.markup_pct) > 0);
    return esExterno;
  });

  // Función auxiliar para dibujar un grupo de comisiones
  function dibujarGrupoTabla(titulo, items) {
    if (items.length === 0) {
      y = checkPage(doc, y, 15, handlePageAdd);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.0);
      doc.setTextColor(...C_DARK);
      doc.text(titulo, MARGIN, y + 4);
      y += 6;
      
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10.0);
      doc.setTextColor(...C_GRAY);
      doc.text('No hay comisiones registradas en este grupo.', MARGIN + 2, y + 4);
      y += 8;
      return { totalUsd: 0, cabillaUsd: 0, otrosUsd: 0, abonadoUsd: 0, totalBs: 0 };
    }

    y = checkPage(doc, y, 15, handlePageAdd);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.0);
    doc.setTextColor(...C_PRIMARY);
    doc.text(titulo, MARGIN, y + 4);
    y += 7;

    let groupCabillaUsd = 0;
    let groupOtrosUsd = 0;
    let groupTotalUsd = 0;
    let groupAbonadoUsd = 0;
    let groupTotalBs = 0;

    function dibujarSubTablaVendedor(vNombre, vColor, vItems) {
      // Dibujar subheader del vendedor
      y = checkPage(doc, y, 18, handlePageAdd);
      
      const rgbColor = hexToRgb(vColor || '#1B365D');
      doc.setFillColor(rgbColor[0], rgbColor[1], rgbColor[2]);
      doc.circle(MARGIN + 3, y + 3, 1.5, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.0);
      doc.setTextColor(...C_DARK);
      doc.text(vNombre.toUpperCase(), MARGIN + 7, y + 4);
      y += 7;

      const comisionesNormales = vItems.filter(c => c.estado !== 'cta_cobrar');
      const cuentasCobrar = vItems.filter(c => c.estado === 'cta_cobrar');

      let totalCabillaUsd = 0;
      let totalOtrosUsd = 0;
      let totalTotalUsd = 0;
      let totalAbonadoUsd = 0;
      let totalTotalBs = 0;

      function dibujarTablaEspecifica(itemsParaTabla, tituloTabla, suffixSubtotal) {
        if (itemsParaTabla.length === 0) return;

        // Para evitar cabeceras o títulos huérfanos al final de la página,
        // verificamos que quepa al menos el título (si aplica) + la cabecera + la primera fila
        const tieneTituloSeccion = comisionesNormales.length > 0 && cuentasCobrar.length > 0;
        const espacioRequerido = tieneTituloSeccion ? 28 : 20;
        
        y = checkPage(doc, y, espacioRequerido, handlePageAdd);

        // Si hay ambos tipos, dibujar un pequeño título de sección para la tabla
        if (tieneTituloSeccion) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(80, 90, 110);
          doc.text(tituloTabla.toUpperCase(), MARGIN + 2, y + 4);
          y += 6;
        }

        // Dibujar cabecera de tabla
        y = drawTableHeader(doc, y);

        let subCabillaUsd = 0;
        let subOtrosUsd = 0;
        let subTotalUsd = 0;
        let subAbonadoUsd = 0;
        let subTotalBs = 0;

        itemsParaTabla.forEach((c, idx) => {
          let splitDesc = [];
          if (esDetallado) {
            const desc = `${c.codigo ? '['+c.codigo+'] ' : ''}${c.descripcion || '—'}`;
            doc.setFontSize(8.0);
            splitDesc = doc.splitTextToSize(desc, cols[2].w - 9);
            doc.setFontSize(9.0);
          }

          // Dividir el nombre del cliente en múltiples líneas según el ancho de la columna
          doc.setFontSize(7.5);
          const cliDisplay = (c.clienteNombre || '---').toUpperCase();
          const splitCli = doc.splitTextToSize(cliDisplay, cols[1].w - 2);
          doc.setFontSize(9.0);

          // Calcular la altura dinámica de la fila según el máximo de líneas de texto
          const linesCli = splitCli.length + 1; // líneas de cliente + 1 (número de documento)
          const linesDesc = esDetallado ? splitDesc.length : 1;
          const maxLines = Math.max(linesCli, linesDesc);

          let rowH = 9.5;
          if (maxLines === 3) {
            rowH = 12.0;
          } else if (maxLines > 3) {
            rowH = 12.0 + (maxLines - 3) * 3.0;
          }

          y = checkPage(doc, y, rowH + 2, handlePageAdd);

          if (y < MARGIN + 12) {
            y = drawTableHeader(doc, y);
          }

          if (idx % 2 === 0) {
            doc.setFillColor(252, 252, 253);
            doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F');
          }

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.0);
          doc.setTextColor(...C_DARK);

          const tasa = c.tasa_snapshot;
          const comBs = tasa > 0 ? c.totalcomision * tasa : 0;

          // Sumar a subtotales de esta subtabla
          subCabillaUsd += c.comisioncabilla;
          subOtrosUsd += c.comisionotros;
          subTotalUsd += c.totalcomision;
          subAbonadoUsd += c.montopagado;
          subTotalBs += comBs;

          // Sumar al total general del vendedor
          totalCabillaUsd += c.comisioncabilla;
          totalOtrosUsd += c.comisionotros;
          totalTotalUsd += c.totalcomision;
          totalAbonadoUsd += c.montopagado;
          totalTotalBs += comBs;

          if (esDetallado) {
            doc.setFontSize(8.0);
            doc.text(fmtFechaCorta(c.creadoen), cols[0].x + 1, y + 3.8);
            doc.setFontSize(9.0);
            
            // Cliente en múltiples líneas y Documento abajo
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            splitCli.forEach((line, lineIdx) => {
              doc.text(line, cols[1].x + 1, y + 3.8 + (lineIdx * 3.4));
            });
            
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.0);
            doc.setTextColor(100, 116, 139); // Slate 500
            doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3.8 + (splitCli.length * 3.4));
            
            // Restaurar estilos
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.0);
            doc.setTextColor(...C_DARK);
            
            doc.setFontSize(8.0);
            const descY = splitDesc.length > 1 ? y + 3.8 : y + (rowH / 2) + 0.7;
            doc.text(splitDesc, cols[2].x + 1, descY);
            doc.setFontSize(9.0);

            doc.text(fmtUsd(c.valor), cols[3].x + cols[3].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            doc.text(`${c.pct}%`, cols[4].x + cols[4].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            
            doc.setFont('helvetica', 'bold');
            doc.text(fmtUsd(c.totalcomision), cols[5].x + cols[5].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            
            doc.setFont('helvetica', 'normal');
            doc.text(tasa > 0 ? fmtBsShort(tasa) : 'N/D', cols[6].x + cols[6].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            
            doc.setFont('helvetica', 'bold');
            doc.text(tasa > 0 ? fmtBs(comBs) : 'N/D', cols[7].x + cols[7].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });

            drawStatusBadge(doc, c.estado, cols[8].x, y + (rowH / 2) + 1.7, cols[8].w, 4.5);
          } else {
            doc.setFontSize(8.0);
            doc.text(fmtFechaCorta(c.creadoen), cols[0].x + 1, y + 3.8);
            doc.setFontSize(9.0);
            
            // Cliente en múltiples líneas y Documento abajo
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            splitCli.forEach((line, lineIdx) => {
              doc.text(line, cols[1].x + 1, y + 3.8 + (lineIdx * 3.4));
            });
            
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.0);
            doc.setTextColor(100, 116, 139); // Slate 500
            doc.text(`#${c.despachonumero}`, cols[1].x + 1, y + 3.8 + (splitCli.length * 3.4));
            
            // Restaurar estilos
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.0);
            doc.setTextColor(...C_DARK);
            
            doc.text(fmtUsd(c.comisioncabilla), cols[2].x + cols[2].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            doc.text(fmtUsd(c.comisionotros), cols[3].x + cols[3].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            
            doc.setFont('helvetica', 'bold');
            doc.text(fmtUsd(c.totalcomision), cols[4].x + cols[4].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            
            doc.setFont('helvetica', 'normal');
            doc.text(c.montopagado > 0 ? fmtUsd(c.montopagado) : '—', cols[5].x + cols[5].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            
            doc.text(tasa > 0 ? fmtBsShort(tasa) : 'N/D', cols[6].x + cols[6].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });
            
            doc.setFont('helvetica', 'bold');
            doc.text(tasa > 0 ? fmtBs(comBs) : 'N/D', cols[7].x + cols[7].w - 2, y + (rowH / 2) + 0.7, { align: 'right' });

            drawStatusBadge(doc, c.estado, cols[8].x, y + (rowH / 2) + 1.7, cols[8].w, 4.5);
          }

          y += rowH;
        });

        // Dibujar subtotal de esta subtabla
        y = checkPage(doc, y, 10, handlePageAdd);
        doc.setDrawColor(210, 215, 225);
        doc.setLineWidth(0.25);
        doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
        y += 4.5;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.0);
        doc.setTextColor(80, 90, 100);
        const rawLabel = `Subtotal ${vNombre}${suffixSubtotal}:`;
        const maxLabelW = cols[2].x - (MARGIN + 4);
        let finalLabel = rawLabel;
        if (doc.getTextWidth(finalLabel) > maxLabelW) {
          const shortName = vNombre.length > 15 ? vNombre.substring(0, 13) + '..' : vNombre;
          finalLabel = `Subtotal ${shortName}${suffixSubtotal}:`;
        }
        doc.text(finalLabel, MARGIN + 2, y);

        doc.setTextColor(...C_DARK);
        if (esDetallado) {
          doc.text(fmtUsd(subTotalUsd), cols[5].x + cols[5].w - 2, y, { align: 'right' });
          doc.text(fmtBs(subTotalBs), cols[7].x + cols[7].w - 2, y, { align: 'right' });
        } else {
          doc.text(fmtUsd(subCabillaUsd), cols[2].x + cols[2].w - 2, y, { align: 'right' });
          doc.text(fmtUsd(subOtrosUsd), cols[3].x + cols[3].w - 2, y, { align: 'right' });
          doc.text(fmtUsd(subTotalUsd), cols[4].x + cols[4].w - 2, y, { align: 'right' });
          doc.text(fmtUsd(subAbonadoUsd), cols[5].x + cols[5].w - 2, y, { align: 'right' });
          doc.text(fmtBs(subTotalBs), cols[7].x + cols[7].w - 2, y, { align: 'right' });
        }
        y += 6.5;
      }

      // Dibujar las tablas según corresponda
      if (comisionesNormales.length > 0) {
        dibujarTablaEspecifica(comisionesNormales, "Comisiones", "");
      }
      
      if (cuentasCobrar.length > 0) {
        if (comisionesNormales.length > 0) {
          y += 4; // Espacio adicional si se dibujan ambas tablas
        }
        dibujarTablaEspecifica(cuentasCobrar, "Cuentas por Cobrar", " (CxC)");
      }

      return { totalUsd: totalTotalUsd, cabillaUsd: totalCabillaUsd, otrosUsd: totalOtrosUsd, abonadoUsd: totalAbonadoUsd, totalBs: totalTotalBs };
    }

    if (vendedor) {
      const res = dibujarSubTablaVendedor(vendedor.nombre, vendedor.color, items);
      groupCabillaUsd = res.cabillaUsd;
      groupOtrosUsd = res.otrosUsd;
      groupTotalUsd = res.totalUsd;
      groupAbonadoUsd = res.abonadoUsd;
      groupTotalBs = res.totalBs;
    } else {
      const itemsPorVendedor = {};
      const vendedoresOrdenados = [];

      items.forEach(c => {
        const vName = c.vendedor?.nombre || 'Sin asesor';
        if (!itemsPorVendedor[vName]) {
          itemsPorVendedor[vName] = [];
          vendedoresOrdenados.push({
            nombre: vName,
            color: c.vendedor?.color || '#1B365D'
          });
        }
        itemsPorVendedor[vName].push(c);
      });

      vendedoresOrdenados.forEach((v, idx) => {
        if (idx > 0) {
          y += 8; // Espacio entre vendedores
        }
        const res = dibujarSubTablaVendedor(v.nombre, v.color, itemsPorVendedor[v.nombre]);
        groupCabillaUsd += res.cabillaUsd;
        groupOtrosUsd += res.otrosUsd;
        groupTotalUsd += res.totalUsd;
        groupAbonadoUsd += res.abonadoUsd;
        groupTotalBs += res.totalBs;
      });
    }

    // Subtotal del grupo (e.g. Vendedores Internos)
    if (!tipoVendedor && !vendedor) {
      y = checkPage(doc, y, 10, handlePageAdd);
      doc.setDrawColor(210, 215, 225);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 4.5;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(80, 90, 110);
      doc.text(`Subtotal ${titulo}:`, MARGIN + 2, y);

      doc.setTextColor(...C_DARK);
      if (esDetallado) {
        doc.text(fmtUsd(groupTotalUsd), cols[5].x + cols[5].w - 2, y, { align: 'right' });
        doc.text(fmtBs(groupTotalBs), cols[7].x + cols[7].w - 2, y, { align: 'right' });
      } else {
        doc.text(fmtUsd(groupCabillaUsd), cols[2].x + cols[2].w - 2, y, { align: 'right' });
        doc.text(fmtUsd(groupOtrosUsd), cols[3].x + cols[3].w - 2, y, { align: 'right' });
        doc.text(fmtUsd(groupTotalUsd), cols[4].x + cols[4].w - 2, y, { align: 'right' });
        doc.text(fmtUsd(groupAbonadoUsd), cols[5].x + cols[5].w - 2, y, { align: 'right' });
        doc.text(fmtBs(groupTotalBs), cols[7].x + cols[7].w - 2, y, { align: 'right' });
      }
      y += 6.5;
    }

    return { totalUsd: groupTotalUsd, cabillaUsd: groupCabillaUsd, otrosUsd: groupOtrosUsd, abonadoUsd: groupAbonadoUsd, totalBs: groupTotalBs };
  }

  if (formato === 'resumido') {
    const resumenSellers = {}
    comisionesNorm.forEach(c => {
      if (c.estado === 'cta_cobrar') return; // Excluir cuentas por cobrar (cxc) del resumido
      const vId = c.vendedor?.id || 'sin_asesor'
      const vName = c.vendedor?.nombre || 'Sin asesor'
      const esExterno = !!c.vendedor?.es_externo || (c.vendedor?.markup_pct != null && Number(c.vendedor.markup_pct) > 0)
      
      if (!resumenSellers[vId]) {
        resumenSellers[vId] = {
          id: vId,
          nombre: vName,
          esExterno,
          color: c.vendedor?.color || '#1B365D',
          count: 0,
          generadoUsd: 0,
          pagadoUsd: 0,
          pendienteUsd: 0
        }
      }
      
      resumenSellers[vId].count += 1
      resumenSellers[vId].generadoUsd += c.totalcomision
      resumenSellers[vId].pagadoUsd += c.montopagado || 0
      resumenSellers[vId].pendienteUsd += Math.max(c.totalcomision - (c.montopagado || 0), 0)
    })
    const sellersList = Object.values(resumenSellers).sort((a, b) => a.nombre.localeCompare(b.nombre))
    
    dibujarTablaResumida(sellersList)
  } else {
    let sumCabillaUsd = 0;
    let sumOtrosUsd = 0;
    let sumTotalUsd = 0;
    let sumAbonadoUsd = 0;
    let sumTotalBs = 0;

    if (vendedor) {
      const res = dibujarGrupoTabla("Comisiones", comisionesNorm);
      sumCabillaUsd = res.cabillaUsd;
      sumOtrosUsd = res.otrosUsd;
      sumTotalUsd = res.totalUsd;
      sumAbonadoUsd = res.abonadoUsd;
      sumTotalBs = res.totalBs;
    } else {
      if (tipoVendedor !== 'externos') {
        const resInt = dibujarGrupoTabla("Vendedores Internos", comisionesInternos);
        sumCabillaUsd += resInt.cabillaUsd;
        sumOtrosUsd += resInt.otrosUsd;
        sumTotalUsd += resInt.totalUsd;
        sumAbonadoUsd += resInt.abonadoUsd;
        sumTotalBs += resInt.totalBs;
      }
      if (tipoVendedor !== 'internos') {
        const resExt = dibujarGrupoTabla("Vendedores Externos", comisionesExternos);
        sumCabillaUsd += resExt.cabillaUsd;
        sumOtrosUsd += resExt.otrosUsd;
        sumTotalUsd += resExt.totalUsd;
        sumAbonadoUsd += resExt.abonadoUsd;
        sumTotalBs += resExt.totalBs;
      }
    }

    // Línea final y TOTALIZACIÓN
    y = checkPage(doc, y, 12, handlePageAdd);
    doc.setDrawColor(210, 215, 225);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;

    // Fila de gran total
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.0);
    doc.setTextColor(...C_DARK);
    doc.text('TOTAL GENERAL:', MARGIN + 2, y + 1.2);
    
    if (esDetallado) {
      doc.text(fmtUsd(sumTotalUsd), cols[5].x + cols[5].w - 2, y + 1.2, { align: 'right' });
      doc.text(fmtBs(sumTotalBs), cols[7].x + cols[7].w - 2, y + 1.2, { align: 'right' });
    } else {
      doc.text(fmtUsd(sumCabillaUsd), cols[2].x + cols[2].w - 2, y + 1.2, { align: 'right' });
      doc.text(fmtUsd(sumOtrosUsd), cols[3].x + cols[3].w - 2, y + 1.2, { align: 'right' });
      doc.text(fmtUsd(sumTotalUsd), cols[4].x + cols[4].w - 2, y + 1.2, { align: 'right' });
      doc.text(fmtUsd(sumAbonadoUsd), cols[5].x + cols[5].w - 2, y + 1.2, { align: 'right' });
      doc.text(fmtBs(sumTotalBs), cols[7].x + cols[7].w - 2, y + 1.2, { align: 'right' });
    }
    
    y += 8;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0])

  // Guardar o Imprimir
  const suffix = tipoVendedor ? `_${tipoVendedor}` : ''
  let titulo = vendedor
    ? `Comisiones_${vendedor.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`
    : `Comisiones_General${suffix}_${new Date().toISOString().slice(0, 10)}`
  if (formato === 'resumido') {
    titulo = vendedor
      ? `Comisiones_Resumido_${vendedor.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`
      : `Comisiones_Resumido_General${suffix}_${new Date().toISOString().slice(0, 10)}`
  }

  if (action === 'print') {
    doc.autoPrint();
    const hNV = doc.output('bloburl');
    if (hNV) {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = hNV;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(hNV);
        }, 10000);
      };
    }
  } else {
    doc.save(`${titulo}.pdf`)
  }
}

// ─── Generar Reporte de Ventas PDF ───────────────────────────────────────────
export async function generarReporteVentasPDF({ reporte, rango, config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  let y = 0

  const logoData = LOGO_LISTA_PRECIOS

  const originalAddPage = doc.addPage.bind(doc)
  doc.addPage = function(...args) {
    originalAddPage(...args)
    drawWatermark(doc)
    drawSimplifiedHeader(doc, logoData, config, 'Reporte Ventas (Cont.)', [255, 255, 255], [0, 0, 0])
  }

  let labelTitle = 'Reporte de Ventas';
  if (reporte.tipoFiltro === 'internos') {
    labelTitle = 'Reporte de Ventas — Internos';
  } else if (reporte.tipoFiltro === 'externos') {
    labelTitle = 'Reporte de Ventas — Externos';
  } else if (reporte.tipoFiltro === 'todos') {
    labelTitle = 'Reporte de Ventas';
  } else {
    const porVendedorTitle = reporte.porVendedor || []
    const internosCount = porVendedorTitle.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))).length;
    const externosCount = porVendedorTitle.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)).length;
    if (internosCount > 0 && externosCount === 0) {
      labelTitle = 'Reporte de Ventas — Internos';
    } else if (externosCount > 0 && internosCount === 0) {
      labelTitle = 'Reporte de Ventas — Externos';
    }
  }

  y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: labelTitle,
    subtitle: `${rango.from} — ${rango.to}`,
    customBgColor:       [255, 255, 255],
    customAccentColor:   [0, 0, 0],
    customTextColor:     [0, 0, 0],
    customSubtitleColor: [0, 0, 0],
    customBorderColor:   [0, 0, 0],
    centerBusinessName:  true
  })

  // Watermark
  drawWatermark(doc)

  const kpis = reporte.kpis || {}

  // ══════════════════════════════════════════════════════════════════════════
  // 2. KPIs
  // ══════════════════════════════════════════════════════════════════════════
  const hasDev = kpis.totalDevoluciones > 0 || kpis.totalDevoluciones !== undefined;
  const kpiBoxW = CONTENT_W / (hasDev ? 5 : 4)
  const kpiBoxH = 22
  const kpiData = [
    { label: 'Ventas Netas (Sin Flete)', value: fmtUsd(kpis.totalVentas), sub: '(Solo mercancía)' },
    { label: 'Despachos', value: String(kpis.numDespachos || 0) },
    { label: 'Ticket Promedio', value: fmtUsd(kpis.ticketPromedio) },
    { label: 'Comisiones', value: fmtUsd(kpis.totalComisiones), sub: (kpis.totalComisiones > 0) ? `2%: ${fmtUsd((kpis.comisionCabilla2 || 0) + (kpis.comisionCabilla3 || 0))} | 3%: ${fmtUsd(kpis.comisionOtros || 0)}` : null },
  ]
  if (hasDev) {
    kpiData.push({
      label: 'Devolución de Saldo a Favor',
      value: fmtUsd(kpis.totalDevoluciones || 0),
      sub: kpis.prevTotalDevoluciones ? `Ant: ${fmtUsd(kpis.prevTotalDevoluciones)}` : null
    })
  }

  kpiData.forEach((kpi, i) => {
    const bx = MARGIN + i * kpiBoxW
    
    // Draw background (light gray/slate-50)
    doc.setFillColor(248, 250, 252)
    // Draw border (slate-200)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    
    // FD means Fill and Stroke (Draw)
    doc.roundedRect(bx + 1, y, kpiBoxW - 2, kpiBoxH, 2, 2, 'FD')
    
    // Label text (dark gray / slate-600)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(71, 85, 105)
    doc.text(kpi.label, bx + 3.5, y + 6)
    
    // Value text (midnight blue / C_DARK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(hasDev ? 11.5 : 12.5)
    doc.setTextColor(...C_DARK)
    doc.text(kpi.value, bx + 3.5, y + 13.5)
    
    // Sub text (slate-400 / C_GRAY)
    if (kpi.sub) {
      if (kpi.label === 'Comisiones') {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(71, 85, 105) // Slate-600 (darker and more visible)
      } else {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(...C_GRAY)
      }
      doc.text(kpi.sub, bx + 3.5, y + 19)
    }
  })
  y += kpiBoxH + 8

  // ══════════════════════════════════════════════════════════════════════════
  // 3. POR VENDEDOR
  // ══════════════════════════════════════════════════════════════════════════
  const porVendedor = reporte.porVendedor || []
  if (porVendedor.length > 0) {
    const internos = porVendedor.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)));
    const externos = porVendedor.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...C_DARK);
    doc.text('Ventas por Vendedor', MARGIN, y + 4);
    y += 8;

    function dibujarVentasGrupo(titulo, list) {
      if (list.length === 0) {
        y = checkPage(doc, y, 12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...C_DARK);
        doc.text(titulo, MARGIN, y + 4);
        y += 6;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...C_GRAY);
        doc.text('No hay registros en este grupo.', MARGIN + 2, y + 4);
        y += 8;
        return { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0 };
      }

      y = checkPage(doc, y, 15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...C_DARK);
      doc.text(titulo, MARGIN, y + 4);
      y += 7;

      // Tabla header
      doc.setFillColor(240, 242, 245);
      doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(80, 90, 110);
      doc.text('Vendedor', MARGIN + 2, y + 4.5);
      doc.text('Despachos', MARGIN + 55, y + 4.5);
      doc.text('Ventas USD', MARGIN + 85, y + 4.5);
      doc.text('Comisiones', MARGIN + 125, y + 4.5);
      y += 9;

      let subCount = 0;
      let subTotalUsd = 0;
      let subComision = 0;
      let subCabilla = 0;
      let subOtros = 0;

      list.forEach((v, idx) => {
        const rowH = (v.comision > 0) ? 11 : 8;
        y = checkPage(doc, y, rowH + 1);
        if (idx % 2 === 0) {
          doc.setFillColor(252, 252, 253);
          doc.rect(MARGIN, y - 1, CONTENT_W, rowH, 'F');
        }
        if (v.vendedorColor) {
          const vc = hexToRgb(v.vendedorColor);
          doc.setFillColor(vc[0], vc[1], vc[2]);
          doc.circle(MARGIN + 3, y + 3.5, 1.8, 'F');
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...C_DARK);
        
        const esVendedorExterno = !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0);
        const displayName = esVendedorExterno
          ? (v.markup_pct != null && Number(v.markup_pct) > 0 ? `${v.vendedor} (E) (+${v.markup_pct}%)` : `${v.vendedor} (E)`)
          : v.vendedor;
        doc.text(displayName || '—', MARGIN + 7, y + 4.5);
        doc.text(fmtUsd(v.totalUsd), MARGIN + 85, y + 4.5);
        doc.text(fmtUsd(v.comision), MARGIN + 125, y + 4.5);
        
        doc.setFont('helvetica', 'normal');
        doc.text(String(v.count || 0), MARGIN + 58, y + 4.5);
        
        if (v.comision > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(71, 85, 105);
          const totalCabilla = (v.comisionCabilla2 || 0) + (v.comisionCabilla3 || 0);
          doc.text(`2%: ${fmtUsd(totalCabilla)} | 3%: ${fmtUsd(v.comisionOtros || 0)}`, MARGIN + 125, y + 8.5);
          
          subCabilla += totalCabilla;
          subOtros += (v.comisionOtros || 0);
        }
        
        subCount += (v.count || 0);
        subTotalUsd += (v.totalUsd || 0);
        subComision += (v.comision || 0);

        y += rowH;
      });

      // Subtotal de Ventas
      y = checkPage(doc, y, 10);
      doc.setDrawColor(210, 215, 225);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 90, 110);
      doc.text(`Subtotal ${titulo}`, MARGIN + 7, y + 4.5);
      doc.text(String(subCount), MARGIN + 58, y + 4.5);
      doc.text(fmtUsd(subTotalUsd), MARGIN + 85, y + 4.5);
      doc.text(fmtUsd(subComision), MARGIN + 125, y + 4.5);

      if (subComision > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(71, 85, 105);
        doc.text(`2%: ${fmtUsd(subCabilla)} | 3%: ${fmtUsd(subOtros)}`, MARGIN + 125, y + 8.5);
      }
      y += 12;
      return { count: subCount, totalUsd: subTotalUsd, comision: subComision, comisionCabilla: subCabilla, comisionOtros: subOtros };
    }

    let rInt = { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0 };
    let rExt = { count: 0, totalUsd: 0, comision: 0, comisionCabilla: 0, comisionOtros: 0 };

    const showInternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'internos' || !reporte.tipoFiltro);
    const showExternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'externos' || !reporte.tipoFiltro);

    if (showInternos) {
      rInt = dibujarVentasGrupo("Vendedores Internos", internos);
    }
    if (showExternos) {
      rExt = dibujarVentasGrupo("Vendedores Externos", externos);
    }

    // Fila de Total
    y = checkPage(doc, y, 12);
    doc.setFillColor(245, 247, 250);
    doc.rect(MARGIN, y - 1, CONTENT_W, 11, 'F');

    doc.setDrawColor(200, 204, 210);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1);

    const totalDespachos = rInt.count + rExt.count;
    const totalVentasUsd = rInt.totalUsd + rExt.totalUsd;
    const totalComisiones = rInt.comision + rExt.comision;
    const totalCabilla = rInt.comisionCabilla + rExt.comisionCabilla;
    const totalOtros = rInt.comisionOtros + rExt.comisionOtros;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C_DARK);
    doc.text('TOTAL GENERAL', MARGIN + 7, y + 4.5);
    
    doc.setFont('helvetica', 'bold');
    doc.text(String(totalDespachos), MARGIN + 58, y + 4.5);
    doc.text(fmtUsd(totalVentasUsd), MARGIN + 85, y + 4.5);
    doc.text(fmtUsd(totalComisiones), MARGIN + 125, y + 4.5);
    
    if (totalComisiones > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(`2%: ${fmtUsd(totalCabilla)} | 3%: ${fmtUsd(totalOtros)}`, MARGIN + 125, y + 9);
    }

    doc.line(MARGIN, y + 10, MARGIN + CONTENT_W, y + 10);
    y += 14;
    y += 6;
  }

  // Se eliminó la sección de Top Clientes y Ventas por Categoría por solicitud del usuario

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DESGLOSE DETALLADO DE VENTAS POR VENDEDOR
  // ══════════════════════════════════════════════════════════════════════════
  const despachosReporte = reporte.despachos || [];
  if (despachosReporte.length > 0 && porVendedor.length > 0) {
    const internos = porVendedor.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)));
    const externos = porVendedor.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0));

    const showInternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'internos' || !reporte.tipoFiltro);
    const showExternos = (reporte.tipoFiltro === 'todos' || reporte.tipoFiltro === 'externos' || !reporte.tipoFiltro);

    // Unir la lista según el filtro para el desglose detallado
    const listadoParaDetalle = [];
    if (showInternos && internos.length > 0) {
      listadoParaDetalle.push({ titulo: "Desglose - Vendedores Internos", lista: internos });
    }
    if (showExternos && externos.length > 0) {
      listadoParaDetalle.push({ titulo: "Desglose - Vendedores Externos", lista: externos });
    }

    let seDibujoTituloSeccion = false;

    listadoParaDetalle.forEach(grupo => {
      let seDibujoTituloGrupo = false;

      grupo.lista.forEach(v => {
        // Encontrar despachos asociados al vendedor actual
        const susDespachos = despachosReporte.filter(d => 
          (d.asesor_id && d.asesor_id === v.id) || 
          (d.asesor_nombre && String(d.asesor_nombre).trim().toLowerCase() === String(v.vendedor).trim().toLowerCase())
        );

        if (susDespachos.length === 0) return;

        susDespachos.sort((a, b) => (Number(a.despacho_numero) || 0) - (Number(b.despacho_numero) || 0));

        // 1. Título General de la Sección
        if (!seDibujoTituloSeccion) {
          y = checkPage(doc, y, 22);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(...C_DARK);
          doc.text('Detalle de Ventas por Vendedor', MARGIN, y + 4);
          y += 8;
          seDibujoTituloSeccion = true;
        }

        // 2. Subtítulo del Grupo (ej. Desglose - Vendedores Internos)
        if (!seDibujoTituloGrupo) {
          y = checkPage(doc, y, 14);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(80, 90, 110);
          doc.text(grupo.titulo, MARGIN, y + 4);
          y += 6;
          seDibujoTituloGrupo = true;
        }

        // 3. Bloque del Vendedor
        // Aseguramos espacio para: Cabecera del vendedor (4mm) + Header de subtabla (6mm) + 2 registros (12mm) = 22mm
        y = checkPage(doc, y, 22);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5); // Aumentado de 8.5 a 10.5
        doc.setTextColor(...C_DARK);

        const esVendedorExterno = !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0);
        const displayName = esVendedorExterno
          ? (v.markup_pct != null && Number(v.markup_pct) > 0 ? `${v.vendedor} (E) (+${v.markup_pct}%)` : `${v.vendedor} (E)`)
          : v.vendedor;

        // Círculo de color
        if (v.vendedorColor) {
          const vc = hexToRgb(v.vendedorColor);
          doc.setFillColor(vc[0], vc[1], vc[2]);
          doc.circle(MARGIN + 3, y + 2.5, 1.8, 'F');
        }
        doc.text(displayName || '—', MARGIN + 7, y + 3.5);
        y += 7;

        // Cabecera de la sub-tabla de documentos
        doc.setFillColor(242, 244, 247);
        doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9); // Aumentado de 7.5 a 9
        doc.setTextColor(71, 85, 105);
        
        doc.text('Documento / Correlativo', MARGIN + 4, y + 4.5);
        doc.text('Cliente', MARGIN + 52, y + 4.5); // Movido a 52 para evitar colisión
        doc.text('Monto de la Venta (USD)', MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' });
        y += 8;

        // Dibujar transacciones
        susDespachos.forEach((d, dIdx) => {
          y = checkPage(doc, y, 8);

          // Alternar fila
          if (dIdx % 2 === 1) {
            doc.setFillColor(250, 251, 253);
            doc.rect(MARGIN, y - 0.5, CONTENT_W, 7, 'F');
          }

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9); // Aumentado de 7.5 a 9
          doc.setTextColor(51, 65, 85);

          const numDoc = d.despacho_numero ? `#${d.despacho_numero}` : 'S/N';
          const suffixPrestamo = d.es_prestamo_puro 
            ? ' (Préstamo)' 
            : (d.es_prestamo_mixto ? ' (Mixto/Prést.)' : '');
          const cliente = d.cliente_nombre ? String(d.cliente_nombre).toUpperCase() : 'CLIENTE SIN NOMBRE';
          const displayCliente = d.cliente_tipo_cliente === 'personal'
            ? `${cliente} (PERSONAL)`
            : cliente;
          
          // Truncar cliente para seguridad espacial
          const maxChars = 44;
          const truncatedCliente = displayCliente.length > maxChars ? `${displayCliente.substring(0, maxChars)}...` : displayCliente;

          if (d.es_prestamo_puro || d.es_prestamo_mixto) {
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(194, 120, 3); // Tono ámbar/dorado para préstamo
          } else {
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(51, 65, 85);
          }
          const docText = `Doc ${numDoc}${suffixPrestamo}`;
          doc.text(docText, MARGIN + 4, y + 4.5);
          
          if (d.tasa && Number(d.tasa) > 0) {
            const docW = doc.getTextWidth(docText);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(140, 150, 160); // Gris más tenue
            doc.setFontSize(7.5);
            doc.text(` (tasa: ${d.tasa})`, MARGIN + 4 + docW, y + 4.5);
            doc.setFontSize(9); // Restaurar
          }
          
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          doc.text(truncatedCliente, MARGIN + 52, y + 4.5);

          // Totales (Monto) siempre en negrita
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...C_DARK);
          doc.text(fmtUsd(d.venta_neta_usd || 0), MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' });

          y += 6.5;

          // Si tiene productos en préstamo, mostrarlos debajo de la fila del documento
          const prestamosItems = (d.items || []).filter(it => it.es_prestamo);
          if (prestamosItems.length > 0) {
            prestamosItems.forEach(it => {
              y = checkPage(doc, y, 6);
              // Materiales de préstamo también en negrita
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(8); // Aumentado de 6.5 a 8
              doc.setTextColor(71, 85, 105); // Tono gris oscuro muy legible
              const itemText = `      • [PRÉSTAMO] ${Number(it.cantidad).toLocaleString('es-VE')} unds.  ·  ${it.nombre_snap || 'PRODUCTO SIN NOMBRE'}`;
              doc.text(itemText, MARGIN + 8, y + 3.5);
              y += 5;
            });
          }
        });

        y += 4; // Espacio entre vendedores
      });
    });
    
    y += 4;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. FORMAS DE PAGO
  // ══════════════════════════════════════════════════════════════════════════
  const porFormaPago = reporte.porFormaPago || []
  if (porFormaPago.length > 0) {
    y = checkPage(doc, y, 15)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_DARK)
    doc.text('Formas de Pago', MARGIN, y + 4)
    y += 8

    const fpTotal = porFormaPago.reduce((s, fp) => s + fp.totalUsd, 0)
    porFormaPago.forEach((fp) => {
      const pct = fpTotal > 0 ? ((Math.max(0, fp.totalUsd) / fpTotal) * 100).toFixed(1) : '0.0'

      // 1. Cabecera: nombre del metodo (se previene cabecera huerfana controlando el espacio minimo reqH)
      const reqH = Array.isArray(fp.pagos) && fp.pagos.length > 0 ? 32 : 20
      y = checkPage(doc, y, reqH)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text(`${fp.formaPago} (${fp.count} desp.)`, MARGIN + 2, y + 4)
      y += 8

      // 2. Desglose de transacciones
      if (Array.isArray(fp.pagos) && fp.pagos.length > 0) {
        fp.pagos.forEach(p => {
          y = checkPage(doc, y, 9)
          doc.setFontSize(8.5)
          doc.setTextColor(110, 120, 130)

          const numDoc = p.numero ? `#${p.numero}` : 'S/N'
          const suffixPrestamo = p.es_prestamo_puro 
            ? ' (Préstamo)' 
            : (p.es_prestamo_mixto ? ' (Mixto/Prést.)' : '');
          const cliente = p.cliente ? String(p.cliente).toUpperCase().substring(0, 36) : 'CLIENTE SIN NOMBRE'
          const suffixRef = p.referencia ? ` [Ref: ${p.referencia}]` : ''
          const labelText = `    • Doc ${numDoc}${suffixRef}${suffixPrestamo}  ·  ${cliente}  ·  `

          doc.setFont('helvetica', 'normal')
          doc.text(labelText, MARGIN + 2, y + 2)

          const labelW = doc.getTextWidth(labelText)
          const usdVal = fmtUsd(p.monto)

          // 1. Dibujar monto en USD en negrita
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(...C_DARK)
          doc.text(usdVal, MARGIN + 2 + labelW, y + 2)

          // 2. Dibujar monto en Bs y tasa en color tenue regular al lado
          if (['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && p.montoBs) {
            const usdW = doc.getTextWidth(usdVal)
            const tasaText = p.tasa && Number(p.tasa) > 0 ? ` · Tasa: ${p.tasa}` : ''
            const bsText = `  ·  (${fmtBs(p.montoBs)}${tasaText})`
            
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(7.5) // Un poco más pequeño para dar jerarquía
            doc.setTextColor(110, 120, 130) // Color gris tenue
            doc.text(bsText, MARGIN + 2 + labelW + usdW, y + 2)
            doc.setFontSize(8.5) // Restaurar
          }
          y += 7.5
        })
      }

      // 3. Total del metodo + % + barra (al final del grupo)
      y = checkPage(doc, y, 11)
      if (Array.isArray(fp.pagos) && fp.pagos.length > 0) {
        doc.setDrawColor(220, 224, 230)
        doc.setLineWidth(0.35)
        doc.line(MARGIN + 2, y + 0.5, MARGIN + CONTENT_W - 2, y + 0.5)
        y += 3
      }
      const hasBsTotal = ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago) && Array.isArray(fp.pagos)
      const totalBs = hasBsTotal
        ? fp.pagos.reduce((s, p) => s + (Number(p.montoBs) || 0), 0)
        : 0

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text(fmtUsd(fp.totalUsd), MARGIN + 80, y + 4)

      if (hasBsTotal && totalBs > 0) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(79, 70, 229) // Indigo 600
        doc.text(`(${fmtBs(totalBs)})`, MARGIN + 80, y + 7.5)
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(...C_DARK)
      doc.text(`${pct}%`, MARGIN + 110, y + 4)

      // Mini barra
      const barX = MARGIN + 130
      const barW = CONTENT_W - 130
      doc.setFillColor(230, 233, 240)
      doc.roundedRect(barX, y + 0.5, barW, 4, 1, 1, 'F')
      const fillW = barW * (Number(pct) / 100)
      if (fillW > 0) {
        doc.setFillColor(...C_PRIMARY)
        doc.roundedRect(barX, y + 0.5, Math.max(fillW, 2), 4, 1, 1, 'F')
      }
      y += (hasBsTotal && totalBs > 0) ? 12 : 8.5
      y += 4
    })

    // Fila de Total
    y = checkPage(doc, y, 24)
    doc.setFillColor(240, 244, 250)
    doc.rect(MARGIN, y - 1, CONTENT_W, 22, 'F')

    doc.setDrawColor(180, 190, 210)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y - 1, MARGIN + CONTENT_W, y - 1)

    const totalFpDespachos = porFormaPago.reduce((s, fp) => s + (fp.count || 0), 0)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C_DARK)
    doc.text(`TOTAL RECAUDADO (${totalFpDespachos} desp.)`, MARGIN + 2, y + 5)
    doc.text(fmtUsd(fpTotal), MARGIN + 80, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('100.0%', MARGIN + 110, y + 5)

    // Separador interno
    doc.setDrawColor(210, 220, 235)
    doc.setLineWidth(0.3)
    doc.line(MARGIN + 2, y + 8, MARGIN + CONTENT_W - 2, y + 8)

    // Divisas total (Efectivo $, Zelle, USDT)
    const totalDivisasUsd = porFormaPago
      .filter(fp => ['Efectivo $', 'Zelle', 'USDT'].includes(fp.formaPago))
      .reduce((s, fp) => s + fp.totalUsd, 0)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(80, 90, 110)
    doc.text('Total en Divisas (Efectivo $, Zelle, USDT):', MARGIN + 4, y + 13)
    doc.setTextColor(...C_DARK)
    doc.text(fmtUsd(totalDivisasUsd), MARGIN + 80, y + 13)

    // Bolívares total (Efectivo Bs, Transf. / Pago Móvil, Punto de Venta)
    const totalBolivaresBs = porFormaPago
      .filter(fp => ['Efectivo Bs', 'Transf. / Pago Móvil', 'Punto de Venta'].includes(fp.formaPago))
      .reduce((s, fp) => s + (fp.pagos?.reduce((sum, p) => sum + (Number(p.montoBs) || 0), 0) || 0), 0)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(79, 70, 229) // Indigo 600
    doc.text('Total en Bolívares (Efectivo Bs, Transf, P. Venta):', MARGIN + 4, y + 18)
    doc.text(fmtBs(totalBolivaresBs), MARGIN + 80, y + 18)

    doc.setDrawColor(180, 190, 210)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y + 21, MARGIN + CONTENT_W, y + 21)
    y += 26

    // Bloque de Desglose de Flete / Diferencia
    const fpCxc = porFormaPago.find(fp => fp.formaPago === 'Cta por cobrar');
    const fpCod = porFormaPago.find(fp => fp.formaPago === 'Cobro a destino');
    const totalCxC = (fpCxc ? fpCxc.totalUsd : 0) + (fpCod ? fpCod.totalUsd : 0);
    const fpDonacion = porFormaPago.find(fp => fp.formaPago === 'Donación');
    const totalDonacion = fpDonacion ? fpDonacion.totalUsd : 0;
    const totalDeducciones = totalCxC + totalDonacion;
    const ventasSinCxc = fpTotal - totalDeducciones;
    const tieneCxC = totalDeducciones > 0;
    const tieneDev = kpis.totalDevoluciones > 0;
    const boxH = (tieneCxC || tieneDev) ? 28 : 20;

    y = checkPage(doc, y, boxH + 4)
    doc.setFillColor(245, 250, 255)
    doc.setDrawColor(190, 215, 245)
    doc.setLineWidth(0.4)
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_PRIMARY)
    doc.text('DESGLOSE DE LA DIFERENCIA (RECAUDACIÓN VS VENTAS NETAS):', MARGIN + 3.5, y + 7)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...C_DARK)

    let curX = MARGIN + 3.5
    
    // 1. Ventas Netas
    const lbl1 = 'Ventas Netas: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl1, curX, y + 14)
    curX += doc.getTextWidth(lbl1)
    
    const val1 = fmtUsd(kpis.totalVentas || 0)
    doc.setFont('helvetica', 'bold')
    doc.text(val1, curX, y + 14)
    curX += doc.getTextWidth(val1)
    
    // Separator 1
    const sep1 = '   |   '
    doc.setFont('helvetica', 'normal')
    doc.text(sep1, curX, y + 14)
    curX += doc.getTextWidth(sep1)
    
    // 2. Flete
    const lbl2 = 'Flete: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl2, curX, y + 14)
    curX += doc.getTextWidth(lbl2)
    
    const val2 = fmtUsd(kpis.totalFlete || 0)
    doc.setFont('helvetica', 'bold')
    doc.text(val2, curX, y + 14)
    curX += doc.getTextWidth(val2)
    
    // Separator 2
    const sep2 = '   |   '
    doc.setFont('helvetica', 'normal')
    doc.text(sep2, curX, y + 14)
    curX += doc.getTextWidth(sep2)

    // 2.5 Devoluciones
    if (tieneDev) {
      const lblDev = 'Devoluciones: '
      doc.setFont('helvetica', 'normal')
      doc.text(lblDev, curX, y + 14)
      curX += doc.getTextWidth(lblDev)
      
      const valDev = `-${fmtUsd(kpis.totalDevoluciones)}`
      doc.setFont('helvetica', 'bold')
      doc.text(valDev, curX, y + 14)
      curX += doc.getTextWidth(valDev)

      // Separator Dev
      const sepDev = '   |   '
      doc.setFont('helvetica', 'normal')
      doc.text(sepDev, curX, y + 14)
      curX += doc.getTextWidth(sepDev)
    }
    
    // 3. Total Recaudado
    const lbl3 = 'Total Recaudado: '
    doc.setFont('helvetica', 'normal')
    doc.text(lbl3, curX, y + 14)
    curX += doc.getTextWidth(lbl3)
    
    const val3 = fmtUsd(fpTotal)
    doc.setFont('helvetica', 'bold')
    doc.text(val3, curX, y + 14)

    // Linea 2 (solo si tiene CxC o donaciones)
    if (tieneCxC) {
      let curX2 = MARGIN + 3.5;
      
      const lblCxC = 'CxC y Donaciones: ';
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.text(lblCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(lblCxC)
      
      const valCxC = `-${fmtUsd(totalDeducciones)}`;
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(220, 38, 38)
      doc.text(valCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(valCxC)
      
      doc.setTextColor(...C_DARK)
      const sepCxC = '   |   ';
      doc.setFont('helvetica', 'normal')
      doc.text(sepCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(sepCxC)
      
      const lblSinCxC = 'Ventas Líquidas (Caja Real): ';
      doc.setFont('helvetica', 'normal')
      doc.text(lblSinCxC, curX2, y + 21)
      curX2 += doc.getTextWidth(lblSinCxC)
      
      const valSinCxC = fmtUsd(ventasSinCxc);
      doc.setFont('helvetica', 'bold')
      doc.text(valSinCxC, curX2, y + 21)
    }

    y += boxH + 4
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6.5. DEVOLUCIONES DE SALDO A FAVOR
  // ══════════════════════════════════════════════════════════════════════════
  const devolucionesReporte = reporte.devoluciones || [];
  if (devolucionesReporte.length > 0) {
    y = checkPage(doc, y, 22)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...C_DARK)
    doc.text('Devoluciones de Saldo a Favor (Reembolsos a Clientes)', MARGIN, y + 4)
    y += 8

    // Tabla header
    doc.setFillColor(242, 244, 247);
    doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    
    doc.text('Cliente', MARGIN + 4, y + 4.5);
    doc.text('Asesor', MARGIN + 55, y + 4.5);
    doc.text('Fecha', MARGIN + 100, y + 4.5);
    doc.text('Forma de Pago', MARGIN + 122, y + 4.5);
    doc.text('Devuelto ($)', MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' });
    y += 8;

    devolucionesReporte.forEach((dev, idx) => {
      y = checkPage(doc, y, 8)
      if (idx % 2 === 1) {
        doc.setFillColor(250, 251, 253);
        doc.rect(MARGIN, y - 0.5, CONTENT_W, 7, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);

      const cliente = dev.cliente_nombre ? String(dev.cliente_nombre).toUpperCase().substring(0, 28) : 'CLIENTE SIN NOMBRE'
      const displayCliente = dev.cliente_tipo_cliente === 'personal' ? `${cliente} (P)` : cliente
      
      doc.text(displayCliente, MARGIN + 4, y + 4.5)
      doc.text(dev.vendedor_nombre || '—', MARGIN + 55, y + 4.5)
      
      const fechaStr = dev.creado_en ? new Date(dev.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }) : '—'
      doc.text(fechaStr, MARGIN + 100, y + 4.5)
      doc.text(dev.forma_pago_abono || 'Sin especificar', MARGIN + 122, y + 4.5)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(220, 38, 38) // Rose 600
      doc.text(`-${fmtUsd(dev.monto_usd)}`, MARGIN + CONTENT_W - 4, y + 4.5, { align: 'right' })

      y += 6.5
    })
    y += 4
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. FOOTER
  // ══════════════════════════════════════════════════════════════════════════
  drawPremiumFooter(doc, config, [255, 255, 255], [0, 0, 0], [0, 0, 0])

  let dynamicFilename = `Reporte_Ventas_${rango.from}_${rango.to}.pdf`;
  if (reporte.tipoFiltro === 'internos') {
    dynamicFilename = `Reporte_Ventas_Internos_${rango.from}_${rango.to}.pdf`;
  } else if (reporte.tipoFiltro === 'externos') {
    dynamicFilename = `Reporte_Ventas_Externos_${rango.from}_${rango.to}.pdf`;
  } else if (reporte.tipoFiltro === 'todos') {
    dynamicFilename = `Reporte_Ventas_${rango.from}_${rango.to}.pdf`;
  } else {
    const porVendedorSave = reporte.porVendedor || []
    const internosCountSave = porVendedorSave.filter(v => !(!!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0))).length;
    const externosCountSave = porVendedorSave.filter(v => !!v.es_externo || (v.markup_pct != null && Number(v.markup_pct) > 0)).length;
    if (internosCountSave > 0 && externosCountSave === 0) {
      dynamicFilename = `Reporte_Ventas_Internos_${rango.from}_${rango.to}.pdf`;
    } else if (externosCountSave > 0 && internosCountSave === 0) {
      dynamicFilename = `Reporte_Ventas_Externos_${rango.from}_${rango.to}.pdf`;
    }
  }

  if (action === 'print') {
    doc.autoPrint();
    const hNV = doc.output('bloburl');
    if (hNV) {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = hNV;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(hNV);
        }, 10000);
      };
    }
  } else {
    doc.save(dynamicFilename)
  }
}
