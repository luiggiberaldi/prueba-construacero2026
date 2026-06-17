// src/components/inventario/ProductoRow.jsx
// Fila compacta de producto para vista de lista
import { useState } from 'react'
import { Hash, Tag, Layers, Pencil, EyeOff, AlertTriangle, Package, Trash2, ClipboardList, Eye, Building2, Zap, Copy } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { usePrecioVendedor } from '../../hooks/usePrecioVendedor'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { fmtBs, usdToBs } from '../../utils/format'



function fmtUsd(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Mismo hash determinista que ProductoCard
const PALETA = [
  ['#1e40af','#dbeafe'], ['#065f46','#d1fae5'], ['#92400e','#fef3c7'],
  ['#7c3aed','#ede9fe'], ['#be185d','#fce7f3'], ['#0f766e','#ccfbf1'],
  ['#b45309','#fef9c3'], ['#1d4ed8','#eff6ff'], ['#166534','#dcfce7'],
]
function colorCategoria(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff
  const [fg] = PALETA[h % PALETA.length]
  return fg
}

export default function ProductoRow({ producto, onEditar, onClonar, onDesactivar, onBorrar, onKardex, onDetalle, tasa = 0, comprometido = 0 }) {
  const { perfil } = useAuthStore()
  const [copiado, setCopiado] = useState(false)
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
  const { aplicarMarkup, esExterno, markupPct } = usePrecioVendedor()
  const precioDisplay = esExterno ? aplicarMarkup(producto.precio_usd) : Number(producto.precio_usd)
  const stockBajo = producto.stock_minimo > 0 && producto.stock_actual <= producto.stock_minimo
  const sobrecomprometido = comprometido > 0 && (producto.stock_actual - comprometido) < 0
  const catColor = colorCategoria(producto.categoria || '')

  return (
    <div className="bg-white rounded-xl border hover:shadow-md transition-all overflow-hidden flex items-stretch"
      style={{ borderColor: catColor + '30' }}>

      {/* Barra lateral de color de categoría */}
      <div className="w-1 shrink-0" style={{ background: catColor }} />

      {/* Thumbnail */}
      <div className="w-10 h-10 my-auto ml-3 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
        style={{ background: catColor + '15' }}>
        {producto.imagen_url ? (
          <img src={producto.imagen_url} alt="" className="w-full h-full object-contain p-0.5" loading="lazy" />
        ) : (
          <Package size={16} style={{ color: catColor, opacity: 0.7 }} />
        )}
      </div>

      {/* Info principal */}
      <div className="min-w-0 flex-1 px-3 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-slate-800 text-sm truncate uppercase">{producto.nombre}</h3>
          {producto.codigo && (
            <button
              onClick={handleCopiarCodigo}
              title="Click para copiar código"
              className={`relative flex items-center gap-1 px-2 py-0.5 border rounded-lg text-[10px] font-mono font-bold uppercase transition-all duration-200 active:scale-95 shrink-0 ${
                copiado
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-100'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-200 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              <Hash size={10} className={copiado ? 'text-white' : 'text-slate-400'} />
              <span>{copiado ? '¡Copiado!' : producto.codigo}</span>
            </button>
          )}
          {producto.categoria && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: catColor + '15', color: catColor }}>
              <Tag size={9} />{producto.categoria}
            </span>
          )}
        </div>
        {producto.descripcion && (
          <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[300px]">{producto.descripcion}</p>
        )}
      </div>

      {/* Precio + Stock */}
      <div className="hidden sm:flex items-center gap-4 pr-3 shrink-0">
        <div className="text-right space-y-1">
          <div className="flex items-baseline gap-1.5 justify-end">
            <span className="font-bold text-slate-800 text-sm">{fmtUsd(precioDisplay)}</span>
            {puedeVerCosto && producto.costo_usd != null && (
              <span className="text-xs text-slate-400 ml-1">C: {fmtUsd(producto.costo_usd)}</span>
            )}
          </div>
          {precioDisplay > 0 && (() => {
            const factorBcv = tasaBcv?.precio > 0 && tasaEfectiva > 0
              ? tasaEfectiva / tasaBcv.precio
              : 1
            const precioBcvUsd = precioDisplay * factorBcv
            const precioBs = tasaEfectiva > 0
              ? usdToBs(precioDisplay, tasaEfectiva)
              : null
            return (
              <div className="flex items-center gap-1 justify-end text-[11px] font-bold">
                <span className="inline-flex items-center gap-0.5 px-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-100" title="Precio en Bolívares">
                  <Zap size={9.5} />
                  {precioBs != null ? fmtBs(precioBs) : '—'}
                </span>
                <span className="inline-flex items-center gap-0.5 px-1 rounded bg-blue-50 text-blue-700 border border-blue-100" title="Equivalente USD a tasa BCV">
                  <Building2 size={9.5} />
                  {tasaBcv?.precio > 0 && tasaEfectiva > 0 ? fmtUsd(precioBcvUsd) : '—'}
                </span>
              </div>
            )
          })()}
        </div>

        <div className="flex items-center gap-1.5">
          <Layers size={11} className="text-slate-400" />
          <span className="text-xs text-slate-400">{producto.unidad}</span>
        </div>

        {sobrecomprometido ? (
          <div className="text-right">
            <span className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertTriangle size={11} />
              Stock: {Number(producto.stock_actual).toLocaleString('es-VE')}
            </span>
            <span className="text-[10px] text-amber-600 font-medium">{Number(comprometido).toLocaleString('es-VE')} comprometidas</span>
          </div>
        ) : stockBajo ? (
          <div className="text-right">
            <span className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
              <AlertTriangle size={11} />
              Stock bajo: {Number(producto.stock_actual).toLocaleString('es-VE')}
            </span>
            {comprometido > 0 && <span className="text-[10px] text-amber-600 font-medium">{Number(comprometido).toLocaleString('es-VE')} comprometidas</span>}
          </div>
        ) : (
          <div className="text-right">
            <span className="text-xs text-slate-400">
              Stock: {Number(producto.stock_actual).toLocaleString('es-VE')}
            </span>
            {comprometido > 0 && <div className="text-[10px] text-amber-600 font-medium">{Number(comprometido).toLocaleString('es-VE')} comprometidas</div>}
          </div>
        )}
      </div>

      {/* Acciones (kardex: supervisor y admin; CRUD: solo administracion) */}
      <div className="flex items-center gap-1 px-2 shrink-0">
        <button onClick={() => onDetalle?.(producto)} title="Ver detalle"
          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
          <Eye size={15} />
        </button>
        {esPrivilegiado && (
          <>
            <button onClick={() => onKardex(producto)} title="Kardex"
              className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
              <ClipboardList size={15} />
            </button>
            {puedeGestionarInventario && (
              <>
                <button onClick={() => onEditar(producto)} title="Editar producto"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-light transition-colors">
                  <Pencil size={15} />
                </button>
                <button onClick={() => onClonar?.(producto)} title="Crear producto similar"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
                  <Copy size={15} />
                </button>
                <button onClick={() => onDesactivar(producto)} title="Desactivar producto"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors">
                  <EyeOff size={15} />
                </button>
                <button onClick={() => onBorrar(producto)} title="Borrar producto"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
