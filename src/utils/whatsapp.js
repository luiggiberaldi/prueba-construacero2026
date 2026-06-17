// src/utils/whatsapp.js
// Utilidades para compartir cotizaciones por WhatsApp
// Sube el PDF al worker y envía el link por wa.me directo al número del cliente

import supabase from '../services/supabase/client'
import { showToast } from '../components/ui/Toast'

/**
 * Formatea un número de teléfono para wa.me
 * Quita espacios, guiones y paréntesis. Asume Venezuela (+58)
 * Acepta: 412-1234567, 04121234567, +584121234567, 584121234567
 */
export function formatearTelefono(telefono) {
  if (!telefono) return ''
  // 1. Limpiar caracteres no numéricos excepto el + inicial
  let num = telefono.replace(/[\s\-\(\)\.]/g, '')
  
  // 2. Si empieza con +, es internacional explícito. Quitar + y devolver.
  if (num.startsWith('+')) return num.slice(1)
  
  // 3. Si no empieza con +, pero tiene longitud de internacional (ej. > 10 dígitos)
  // Intentamos ser inteligentes. Si empieza con 58 y tiene 12+ dígitos, ya tiene el código.
  if (num.startsWith('58') && num.length >= 12) return num
  
  // 4. Si tiene 10-11 dígitos y empieza con 0, es probable que sea Venezuela sin código.
  if (num.startsWith('0')) num = num.slice(1)
  
  // 5. Si después de limpiar tiene 10 dígitos (formato estándar VEN), añadir 58.
  if (num.length === 10 && !num.startsWith('58')) {
    return '58' + num
  }
  
  // 6. Por defecto, si es corto, asumir Venezuela por retrocompatibilidad
  if (num.length < 10 && !num.startsWith('58')) {
    return '58' + num
  }
  
  return num
}

/**
 * Sube un PDF al worker (que usa service key) y devuelve la URL pública
 */
async function subirPdfTemporal(pdfBlob, pdfFilename) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const headers = {
    'Content-Type': 'application/pdf',
    'X-Filename': pdfFilename,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch('/api/pdf-temp', {
    method: 'POST',
    headers,
    body: pdfBlob,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err)
  }

  const { url } = await res.json()
  return url
}

/**
 * Genera el mensaje para WhatsApp (con link al PDF)
 */
export function generarMensaje({ nombreNegocio, nombreCliente, numDisplay, totalUsd, nombreVendedor, items = [], tipo = 'cotización' }) {
  const empresa = nombreNegocio || 'Listo POS'
  const saludo = nombreCliente ? `Estimado/a *${nombreCliente}*,` : 'Estimado/a cliente,'

  const firma = nombreVendedor
    ? `Atentamente,\n*${nombreVendedor}*\n_${empresa}_`
    : `Atentamente,\n_${empresa}_`

  const sustantivo = tipo.toLowerCase().includes('orden') ? 'la orden de despacho' : (tipo.toLowerCase().includes('nota') || tipo.toLowerCase().includes('despacho')) ? 'el despacho' : 'la cotización'
  const intro = nombreVendedor
    ? `Le saluda *${nombreVendedor}* de *${empresa}*. Le enviamos ${sustantivo} *${numDisplay}*:`
    : `Le enviamos ${sustantivo} *${numDisplay}* de *${empresa}*:`

  return [
    saludo,
    '',
    intro,
    '',
    'Adjunto encontrará el documento PDF para su revisión.',
    '',
    'Quedamos a su disposición para cualquier consulta.',
    '',
    firma,
  ].join('\n')
}

/**
 * Comparte una cotización por WhatsApp
 * - Móvil: usa Web Share API para adjuntar el PDF directamente
 * - PC: descarga el PDF automáticamente y abre wa.me con el mensaje (sin link, para adjuntar manual)
 */
export async function compartirPorWhatsApp({ pdfBlob, pdfFilename, telefono, mensaje, mensajeParams = null }) {
  const telFormateado = formatearTelefono(telefono)
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

  // ── Móvil: intentar Web Share API con archivo adjunto ──
  if (isMobile && pdfBlob && navigator.canShare) {
    try {
      // 1. Copiar al portapapeles el texto (opcional, por si el usuario quiere pegarlo manual)
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(mensaje)
        }
      } catch (err) {
        console.warn('[WhatsApp] No se pudo copiar al portapapeles', err)
      }

      const pdfFile = new File([pdfBlob], pdfFilename || 'documento.pdf', { type: 'application/pdf' })
      const shareData = {
        text: mensaje,
        files: [pdfFile],
      }
      
      if (navigator.canShare(shareData)) {
        await navigator.share(shareData)
        return { method: 'web_share_api' }
      }
    } catch (err) {
      if (err.name === 'AbortError') return { method: 'web_share_cancelled' }
      console.warn('[WhatsApp] Web Share API falló, usando fallback:', err?.message)
    }
  }

  // ── PC / Fallback: descargar PDF + abrir WhatsApp con mensaje (sin link) ──
  
  // 1. Siempre descargar el PDF en PC para que el usuario pueda adjuntarlo
  if (!isMobile && pdfBlob) {
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = pdfFilename || 'documento.pdf'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  // 2. Preparar mensaje final (sin link al servidor)
  // Si tenemos mensajeParams, generamos el mensaje limpio (sin pdfUrl)
  const mensajeFinal = (mensajeParams) 
    ? generarMensaje({ ...mensajeParams, pdfUrl: null }) 
    : mensaje

  // 3. Abrir WhatsApp directo al número del cliente
  const waUrl = telFormateado
    ? `https://wa.me/${telFormateado}?text=${encodeURIComponent(mensajeFinal)}`
    : `https://wa.me/?text=${encodeURIComponent(mensajeFinal)}`

  window.open(waUrl, '_blank', 'noopener')
  return { method: isMobile ? 'wa_link_mobile' : 'wa_link_desktop' }
}
