// src/components/inventario/ProductoCard.jsx
import { useState } from 'react'
import { Hash, Tag, Layers, Pencil, EyeOff, AlertTriangle, Package, Trash2, ClipboardList, TrendingUp, Eye, Building2, Zap, Copy, MoreVertical } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { usePrecioVendedor } from '../../hooks/usePrecioVendedor'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { fmtBs, usdToBs } from '../../utils/format'
import StockComprometidoDetalle from './StockComprometidoDetalle'

function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const PALETA = [
  ['#1e40af','#dbeafe'], ['#065f46','#d1fae5'], ['#92400e','#fef3c7'],
  ['#7c3aed','#ede9fe'], ['#be185d','#fce7f3'], ['#0f766e','#ccfbf1'],
  ['#b45309','#fef9c3'], ['#1d4ed8','#eff6ff'], ['#166534','#dcfce7'],
]
function colorCategoria(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff
  const [fg, bg] = PALETA[h % PALETA.length]
  return { fg, bg }
}

function StockBadge({ actual, minimo, comprometido = 0, productoId }) {
  const agotado = actual <= 0
  const bajo = !agotado && minimo > 0 && actual <= minimo
  const disponible = actual - comprometido
  const sobrecomprometido = comprometido > 0 && disponible < 0

  if (agotado) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 border border-red-300 px-2.5 py-1 rounded-lg">
      Sin stock
    </span>
  )

  const cls = sobrecomprometido
    ? 'text-red-700 bg-red-100 border-red-300'
    : bajo
      ? 'text-amber-700 bg-amber-100 border-amber-300'
      : 'text-emerald-700 bg-emerald-100 border-emerald-300'

  return (
    <div className="text-right space-y-0.5">
      <span className={`inline-flex items-center gap-1 text-xs font-bold border px-2.5 py-1 rounded-lg ${cls}`}>
        {(sobrecomprometido || bajo) && <AlertTriangle size={10} />}
        {Number(actual).toLocaleString('es-VE')}
      </span>
      {comprometido > 0 && (
        <div>
          <StockComprometidoDetalle productoId={productoId} comprometido={comprometido} />
          {sobrecomprometido && (
            <div className="text-[10px] text-red-600 font-semibold mt-0.5">
              Disponible: {Number(disponible).toLocaleString('es-VE')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProductoCard({ producto, onEditar, onClonar, onDesactivar, onBorrar, onKardex, onDetalle, tasa = 0, comprometido = 0, index }) {
  const { perfil } = useAuthStore()
  const [copiado, setCopiado] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { tasaBcv, tasaUsdt, tasaEfectiva } = useTasaCambio()

  const handleCopiarCodigo = (e) => {
    e.stopPropagation()
    if (!producto.codigo) return
    navigator.clipboard.writeText(producto.codigo)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1500)
  }

  const esAdministracion = perfil?.rol === 'administracion'
  const esPrivilegiado = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe' || perfil?.rol === 'desarrollador') || esAdministracion
  const puedeGestionarInventario = esAdministracion || perfil?.rol === 'desarrollador' || perfil?.rol === 'jefe'
  // Costo solo visible para administracion, jefe y desarrollador
  const puedeVerCosto = ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol)
  const { fg, bg } = colorCategoria(producto.categoria || '')

  // Markup para vendedor externo (solo presentación, no modifica BD)
  const { aplicarMarkup, esExterno, markupPct } = usePrecioVendedor()
  const precioDisplay  = esExterno ? aplicarMarkup(producto.precio_usd) : Number(producto.precio_usd)
  const precio2Display = producto.precio_2 != null ? (esExterno ? aplicarMarkup(producto.precio_2) : Number(producto.precio_2)) : null
  const precio3Display = producto.precio_3 != null ? (esExterno ? aplicarMarkup(producto.precio_3) : Number(producto.precio_3)) : null

  const stockActual = Number(producto.stock_actual) || 0
  const stockMinimo = Number(producto.stock_minimo) || 0
  const agotado = stockActual <= 0
  const stockBajo = !agotado && stockMinimo > 0 && stockActual <= stockMinimo

  const precio = Number(producto.precio_usd)
  const costo = Number(producto.costo_usd)
  const margen = puedeVerCosto && precio > 0 && costo > 0
    ? Math.round(((precio - costo) / precio) * 100)
    : null

  return (
    <div className={`rounded-2xl border hover:shadow-lg transition-all duration-200 flex flex-col relative ${
      agotado
        ? 'bg-red-50/50 border-red-200 hover:border-red-300 hover:shadow-red-100'
        : stockBajo
          ? 'bg-amber-50/30 border-amber-200 hover:border-amber-300 hover:shadow-amber-100'
          : 'bg-white border-slate-200 hover:border-sky-200 hover:shadow-sky-50'
    }`}>

      {/* Imagen */}
      <div className={`relative w-full h-16 sm:h-20 flex items-center justify-center overflow-hidden shrink-0 rounded-t-2xl ${agotado ? 'opacity-50 grayscale' : ''}`}
        style={{ background: producto.imagen_url ? '#f8fafc' : bg }}>
        {producto.imagen_url ? (
          <img src={producto.imagen_url} alt={producto.nombre}
            className="w-full h-full object-contain p-1" loading="lazy" />
        ) : (
          <Package size={24} style={{ color: fg, opacity: 0.7 }} />
        )}
        {agotado && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900/40">
            <span className="text-[10px] font-black text-white bg-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider">Agotado</span>
          </div>
        )}
        {stockBajo && (
          <div className="absolute top-1 right-1">
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-800 bg-amber-300 px-1.5 py-0.5 rounded-full shadow-sm">
              <AlertTriangle size={8} />Bajo
            </span>
          </div>
        )}
      </div>

      {/* Contenido */}
      <div className={`px-2.5 pt-2 pb-2.5 flex flex-col gap-2 flex-1 ${agotado ? 'opacity-70' : ''}`}>

        {/* Encabezado: código, unidad, nombre, categoría */}
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            {producto.codigo && (
              <div className="flex items-center gap-1 min-w-0">
                <button
                  onClick={handleCopiarCodigo}
                  title="Click para copiar código"
                  className={`relative flex items-center gap-1 px-2 py-1 border rounded-lg text-[10px] font-mono font-bold uppercase transition-all duration-200 active:scale-95 shrink-0 ${
                    copiado
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-100'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 hover:border-slate-300 hover:text-slate-900'
                  }`}
                >
                  <Hash size={10} className={copiado ? 'text-white' : 'text-slate-400'} />
                  <span>{copiado ? '¡Copiado!' : producto.codigo}</span>
                </button>
              </div>
            )}
            {producto.unidad && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0 ml-auto">
                <Layers size={7} />{producto.unidad}
              </span>
            )}
          </div>
          <h3 className="font-bold text-slate-800 text-[11px] sm:text-xs leading-snug uppercase">{producto.nombre}</h3>
          {producto.categoria && (
            <span className="inline-flex items-center gap-0.5 mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full max-w-full"
              style={{ background: bg, color: fg }}>
              <Tag size={7} /><span className="truncate">{producto.categoria}</span>
            </span>
          )}
        </div>

        {/* Bloque de precios y stock */}
        <div className="mt-auto space-y-1.5 pt-2 border-t border-slate-100">

          {/* Precio venta — bloque destacado */}
          <div className="rounded-xl bg-slate-50 px-2.5 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Precio venta</span>
              {margen !== null && (
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  margen >= 30 ? 'text-emerald-700 bg-emerald-100' :
                  margen >= 15 ? 'text-amber-700 bg-amber-100' :
                  'text-red-700 bg-red-100'
                }`}>
                  <TrendingUp size={8} />+{margen}%
                </span>
              )}
            </div>

            {/* P1 — precio principal */}
            <div className="flex items-baseline gap-1.5">
              {(producto.precio_2 != null || producto.precio_3 != null) && (
                <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">Detal</span>
              )}
              <p className="font-black text-slate-800 text-base sm:text-lg leading-none">{fmtUsd(precioDisplay)}</p>
            </div>

            {/* Bloque Multimoneda Compacto */}
            {precioDisplay > 0 && (() => {
              // factorBcv = tasaEfectiva / tasaBcv
              // Cuánto USD equivale el precio al pagar por transferencia BCV
              const factorBcv = tasaBcv?.precio > 0 && tasaEfectiva > 0
                ? tasaEfectiva / tasaBcv.precio
                : 1
              const precioBcvUsd = precioDisplay * factorBcv
              const precioBs = tasaEfectiva > 0
                ? usdToBs(precioDisplay, tasaEfectiva)
                : null
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2">
                  {/* Bs — precio en bolívares (tasa USDT/mercado) */}
                  <div className="flex flex-col items-center justify-center rounded-lg bg-emerald-50/70 border border-emerald-100 p-1.5 min-w-0">
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 uppercase tracking-wider">
                      <Zap size={9} className="shrink-0" />
                      Ref.
                    </span>
                    <span className="text-[11px] font-black text-emerald-950 mt-0.5 w-full text-center">
                      {precioBs != null ? fmtBs(precioBs) : '—'}
                    </span>
                  </div>

                  {/* BCV — equivalente USD al factor BCV */}
                  <div className="flex flex-col items-center justify-center rounded-lg bg-blue-50/70 border border-blue-100 p-1.5 min-w-0">
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-700 uppercase tracking-wider">
                      <Building2 size={9} className="shrink-0" />
                      BCV
                    </span>
                    <span className="text-[11px] font-black text-blue-950 mt-0.5 w-full text-center">
                      {tasaBcv?.precio > 0 && tasaEfectiva > 0 ? fmtUsd(precioBcvUsd) : '—'}
                    </span>
                  </div>
                </div>
              )
            })()}

            {/* P2 / P3 — precios secundarios */}
            {(producto.precio_2 != null || producto.precio_3 != null) && (
              <div className="flex flex-wrap gap-1 mt-2 pt-1.5 border-t border-slate-200">
                {precio2Display != null && (
                  <div className="flex flex-col bg-white border border-slate-200 rounded-lg px-2 py-1 min-w-0">
                    <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wide">Mayor</span>
                    <span className="text-[11px] font-bold text-slate-700 leading-tight">{fmtUsd(precio2Display)}</span>
                    {esExterno && <span className="text-[8px] text-slate-400 line-through">{fmtUsd(producto.precio_2)}</span>}
                    {tasa > 0 && <span className="text-[9px] text-slate-400 leading-none">{fmtBs(usdToBs(precio2Display, tasa))}</span>}
                  </div>
                )}
                {precio3Display != null && (
                  <div className="flex flex-col bg-white border border-slate-200 rounded-lg px-2 py-1 min-w-0">
                    <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wide">Especial</span>
                    <span className="text-[11px] font-bold text-slate-700 leading-tight">{fmtUsd(precio3Display)}</span>
                    {esExterno && <span className="text-[8px] text-slate-400 line-through">{fmtUsd(producto.precio_3)}</span>}
                    {tasa > 0 && <span className="text-[9px] text-slate-400 leading-none">{fmtBs(usdToBs(precio3Display, tasa))}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Costo — fila secundaria */}
          {puedeVerCosto && producto.costo_usd != null && (
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-slate-400">Costo</span>
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-600">{fmtUsd(producto.costo_usd)}</p>
                {tasa > 0 && (
                  <p className="text-[10px] text-slate-400">{fmtBs(usdToBs(producto.costo_usd, tasa))}</p>
                )}
              </div>
            </div>
          )}

          {/* Stock */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] text-slate-400">Stock</span>
            <StockBadge
              actual={producto.stock_actual}
              minimo={producto.stock_minimo}
              comprometido={comprometido}
              productoId={producto.id}
            />
          </div>

        </div>
      </div>

      {/* Acciones */}
      <div className="border-t border-slate-100 px-2.5 py-2 flex items-center justify-between gap-1.5 bg-slate-50/50 relative rounded-b-2xl">
        <button onClick={() => onDetalle?.(producto)} title="Ver detalle"
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors border border-emerald-200 whitespace-nowrap">
          <Eye size={14} /> Ver detalle
        </button>
        {esPrivilegiado && (
          <div className="relative shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              title="Más opciones"
              className={`flex items-center justify-center p-2 rounded-xl border transition-colors ${
                menuOpen
                  ? 'bg-slate-200 border-slate-300 text-slate-700'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <MoreVertical size={14} />
            </button>
          </div>
        )}

        {esPrivilegiado && menuOpen && (
          <>
            {/* Overlay invisible para cerrar al hacer click fuera */}
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className={`absolute ${index !== undefined && index % 2 === 0 ? 'left-2 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto' : 'right-2 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto'} bottom-full mb-2 z-20 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-150 flex flex-col gap-0.5`}>
              <button
                onClick={(e) => { e.stopPropagation(); onKardex(producto); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-violet-50 hover:text-violet-700 rounded-lg transition-colors text-left"
              >
                <ClipboardList size={13} className="text-violet-600" />
                Kardex (Movimientos)
              </button>

              {puedeGestionarInventario && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditar(producto); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-sky-50 hover:text-sky-700 rounded-lg transition-colors text-left"
                  >
                    <Pencil size={13} className="text-sky-600" />
                    Editar datos
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); onClonar?.(producto); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-purple-50 hover:text-purple-700 rounded-lg transition-colors text-left"
                  >
                    <Copy size={13} className="text-purple-600" />
                    Clonar producto
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); onDesactivar(producto); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-700 rounded-lg transition-colors text-left"
                  >
                    {producto.activo ? <EyeOff size={13} className="text-amber-500" /> : <Eye size={13} className="text-emerald-500" />}
                    {producto.activo ? 'Desactivar' : 'Activar'}
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); onBorrar(producto); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-red-600 hover:bg-red-50 hover:text-red-700 rounded-lg transition-colors text-left border-t border-slate-100 mt-1 pt-1.5"
                  >
                    <Trash2 size={13} className="text-red-500" />
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
