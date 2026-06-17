// src/components/inventario/ProductoDetalleModal.jsx
// Modal de ficha de producto — optimizado para captura de pantalla y envío a clientes
import { X, Share2, Package, Loader2, Zap, Building2, DollarSign } from 'lucide-react'
import { useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { fmtBs, usdToBs } from '../../utils/format'
import { usePrecioVendedor } from '../../hooks/usePrecioVendedor'
import { useTasaCambio } from '../../hooks/useTasaCambio'

function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const MONEDAS = [
  { key: 'usdt',  label: 'USDT', Icon: Zap,        color: 'amber'   },
  { key: 'bs',    label: 'Bs',   Icon: DollarSign,  color: 'emerald' },
  { key: 'bcv',   label: 'BCV',  Icon: Building2,   color: 'blue'    },
]

export default function ProductoDetalleModal({ isOpen, onClose, producto, tasa = 0 }) {
  const cardRef = useRef(null)
  const [isSharing, setIsSharing] = useState(false)
  const [moneda, setMoneda] = useState('usdt')   // 'usdt' | 'bs' | 'bcv'
  const { aplicarMarkup } = usePrecioVendedor()
  const { tasaBcv, tasaUsdt, tasaEfectiva } = useTasaCambio()

  if (!isOpen || !producto) return null

  const precioUsdDisplay = producto.precio_usd != null ? aplicarMarkup(producto.precio_usd) : null
  const precio2Display   = producto.precio_2   != null ? aplicarMarkup(producto.precio_2)   : null
  const precio3Display   = producto.precio_3   != null ? aplicarMarkup(producto.precio_3)   : null

  const stockActual = Number(producto.stock_actual) || 0
  const disponible  = stockActual > 0

  // ── Tasas ────────────────────────────────────────────────────────────────────
  const tasaEfectivaNum  = tasaEfectiva  > 0 ? tasaEfectiva  : tasa
  const tasaBcvNum       = tasaBcv?.precio > 0 ? tasaBcv.precio : 0
  const tasaUsdtNum      = tasaUsdt?.precio > 0 ? tasaUsdt.precio : tasaEfectivaNum
  // factorBcv: cuánto USD cuesta si pagas a tasa BCV
  const factorBcv        = tasaBcvNum > 0 && tasaEfectivaNum > 0
    ? tasaEfectivaNum / tasaBcvNum
    : 1

  // ── Conversión según moneda elegida ──────────────────────────────────────────
  function precioEnMoneda(precioUsd) {
    if (precioUsd == null) return null
    if (moneda === 'bs')  return fmtBs(usdToBs(precioUsd, tasaEfectivaNum))
    if (moneda === 'bcv') return fmtUsd(precioUsd * factorBcv)
    return fmtUsd(precioUsd) // usdt
  }

  // Etiquetas amigables para el cliente (no mencionar USDT)
  function labelMoneda() {
    if (moneda === 'bs')  return 'Bolívares'
    if (moneda === 'bcv') return 'Dólares'
    return 'Dólares en Efectivo'
  }

  // ── Texto para compartir ─────────────────────────────────────────────────────
  async function handleShare() {
    setIsSharing(true)
    try {
      const pFmt  = precioEnMoneda(precioUsdDisplay)
      const p2Fmt = precioEnMoneda(precio2Display)
      const texto = [
        `📦 ${producto.nombre}`,
        producto.codigo ? `Código: ${producto.codigo}` : '',
        `Precio en ${labelMoneda()}: ${pFmt ?? '—'}`,
        p2Fmt != null ? `Precio Mayor en ${labelMoneda()}: ${p2Fmt}` : '',
        disponible ? `✅ Disponible` : `❌ Agotado`,
        '',
        '🏗️ Listo POS',
      ].filter(Boolean).join('\n')

      if (navigator.share && navigator.canShare && cardRef.current) {
        const canvas = await html2canvas(cardRef.current, {
          useCORS: true, scale: 2, backgroundColor: '#ffffff', logging: false
        })
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
        const file = new File([blob], `ficha_${producto.codigo || 'prod'}.png`, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: producto.nombre, text: texto })
          return
        }
      }
      if (navigator.share) {
        await navigator.share({ text: texto })
      } else {
        await navigator.clipboard.writeText(texto)
        alert('Texto copiado al portapapeles')
      }
    } catch (error) {
      console.error('Error sharing:', error)
    } finally {
      setIsSharing(false)
    }
  }

  // ── Colores del selector ─────────────────────────────────────────────────────
  const colorMap = {
    amber:   { active: 'bg-amber-500 text-white shadow-amber-200',   idle: 'text-amber-700 hover:bg-amber-50'   },
    emerald: { active: 'bg-emerald-500 text-white shadow-emerald-200', idle: 'text-emerald-700 hover:bg-emerald-50' },
    blue:    { active: 'bg-blue-500 text-white shadow-blue-200',     idle: 'text-blue-700 hover:bg-blue-50'     },
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center animate-in fade-in duration-200"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full sm:max-w-sm sm:mx-4 bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header: selector de moneda + botones */}
        <div className="shrink-0 border-b border-slate-100">
          {/* Fila 1: Compartir + Cerrar */}
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={handleShare}
              disabled={isSharing}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              {isSharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              {isSharing ? 'Capturando...' : 'Compartir'}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Fila 2: Selector de moneda */}
          <div className="px-4 pb-3 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-1">Mostrar en:</span>
            {MONEDAS.map(({ key, label, Icon, color }) => {
              const isActive = moneda === key
              return (
                <button
                  key={key}
                  onClick={() => setMoneda(key)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shadow-sm ${
                    isActive ? colorMap[color].active : `bg-slate-50 border border-slate-200 ${colorMap[color].idle}`
                  }`}
                >
                  <Icon size={10} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Contenido — diseñado para screenshot limpio */}
        <div className="flex-1 overflow-y-auto" ref={cardRef}>
          <div className="px-3 pt-2 pb-4 space-y-2.5 sm:px-5 sm:pt-5 sm:pb-6 sm:space-y-5">

            {/* Imagen del producto */}
            <div className="w-full aspect-square max-h-44 sm:max-h-64 rounded-xl sm:rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 flex items-center justify-center">
              {producto.imagen_url ? (
                <img src={producto.imagen_url} alt={producto.nombre} className="w-full h-full object-contain" />
              ) : (
                <Package size={64} className="text-slate-200" />
              )}
            </div>

            {/* Info del producto */}
            <div className="space-y-0.5 text-center">
              <h2 className="text-base sm:text-lg font-black text-slate-800 leading-tight">{producto.nombre}</h2>
              {producto.codigo && (
                <p className="text-xs text-slate-400 font-mono">Código: {producto.codigo}</p>
              )}
              {producto.categoria && (
                <p className="text-xs text-slate-500">{producto.categoria}</p>
              )}
            </div>

            {/* Precios — adaptados a la moneda elegida */}
            <div className="bg-slate-50 rounded-xl sm:rounded-2xl border border-slate-200 p-3 space-y-2 sm:p-4 sm:space-y-3">
              {/* Badge indicador de moneda — nombre amigable al cliente */}
              {(() => {
                const cfg = MONEDAS.find(m => m.key === moneda)
                const { Icon, color } = cfg
                const badgeColor = {
                  amber:   'bg-amber-50 text-amber-700 border-amber-200',
                  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  blue:    'bg-blue-50 text-blue-700 border-blue-200',
                }[color]
                return (
                  <div className="flex justify-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${badgeColor}`}>
                      <Icon size={9} />
                      {labelMoneda()}
                    </span>
                  </div>
                )
              })()}

              {/* Precio principal */}
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  {precio2Display != null ? 'Precio Detal' : 'Precio'}
                </p>
                <p className="text-2xl sm:text-3xl font-black text-slate-800">
                  {precioEnMoneda(precioUsdDisplay) ?? '—'}
                </p>

              </div>

              {/* Precios secundarios */}
              {(precio2Display != null || precio3Display != null) && (
                <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-slate-200">
                  {precio2Display != null && (
                    <div className="text-center bg-white rounded-lg sm:rounded-xl border border-slate-200 p-2 sm:p-3">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Mayor</p>
                      <p className="text-sm sm:text-base font-black text-slate-700">{precioEnMoneda(precio2Display)}</p>

                    </div>
                  )}
                  {precio3Display != null && (
                    <div className="text-center bg-white rounded-lg sm:rounded-xl border border-slate-200 p-2 sm:p-3">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Especial</p>
                      <p className="text-sm sm:text-base font-black text-slate-700">{precioEnMoneda(precio3Display)}</p>

                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Disponibilidad */}
            <div className="flex items-center justify-center pt-0.5">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-bold ${
                disponible
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {disponible ? '✅ Disponible' : '❌ Agotado'}
              </span>
            </div>

            {/* Unidad */}
            {producto.unidad && (
              <p className="text-center text-xs text-slate-400">
                Unidad de medida: <span className="font-semibold text-slate-600">{producto.unidad}</span>
              </p>
            )}

            {/* Footer branding */}
            <div className="text-center pt-2 border-t border-slate-100">
              <p className="text-[10px] sm:text-[11px] font-bold text-slate-400">Listo POS</p>
              <p className="text-[9px] sm:text-[10px] text-slate-300">Materiales de construcción</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
