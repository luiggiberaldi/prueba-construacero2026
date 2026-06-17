// src/views/ConfiguracionView.jsx
// Configuración del negocio — solo supervisor (rediseñado con tabs)
import { useState, useRef, useEffect } from 'react'
import {
  Settings, Building2, Phone, Mail, MapPin, FileText, Save, CheckCircle,
  Eye, EyeOff, Accessibility, HardDrive, Download, Upload,
  AlertCircle, AlertTriangle, Percent, Users, Database, Copy, Check, DollarSign,
  HelpCircle, Info, Trash2, Plus,
} from 'lucide-react'
import { useConfigNegocio, useActualizarConfig, hashSHA256 } from '../hooks/useConfigNegocio'
import { useCategorias } from '../hooks/useInventario'
import CustomSelect from '../components/ui/CustomSelect'
import { fmtUsd } from '../utils/format'
import { adminAPI } from '../services/supabase/adminClient'
import useAuthStore from '../store/useAuthStore'
import UsuariosView from './UsuariosView'
import PageHeader  from '../components/ui/PageHeader'

// ─── Tabs ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'negocio',    label: 'Negocio',         icon: Building2                                                          },
  { id: 'comisiones', label: 'Administración',   icon: DollarSign, roles: ['administracion', 'desarrollador', 'jefe'] },
  { id: 'usuarios',   label: 'Usuarios',         icon: Users,      roles: ['supervisor', 'desarrollador', 'jefe']                  },
  { id: 'datos',      label: 'Datos',            icon: Database,   roles: ['supervisor', 'desarrollador', 'jefe']                  },
]

// ─── Section Header reutilizable ─────────────────────────────────────────────
const SectionHeader = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-3 mb-1">
    <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: 'linear-gradient(180deg, #B8860B, #1B365D)', minHeight: '20px' }} />
    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))', border: '1px solid rgba(27,54,93,0.1)' }}>
      <Icon size={13} style={{ color: '#1B365D' }} />
    </div>
    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">{children}</h2>
  </div>
)

// ─── Section Header para Externos ───────────────────────────────────────────
const SectionHeaderExt = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-3 mb-1">
    <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ backgroundColor: '#D97706', minHeight: '20px' }} />
    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: 'linear-gradient(135deg, rgba(217, 119, 6, 0.08), rgba(245, 158, 11, 0.08))', border: '1px solid rgba(217, 119, 6, 0.15)' }}>
      <Icon size={13} style={{ color: '#D97706' }} />
    </div>
    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">{children}</h2>
  </div>
)

function ComisionesTab({ campos, cambiar, isLoading, cargando }) {
  const { data: categorias = [] } = useCategorias()
  const disabled = isLoading || cargando

  // Parse categorías especiales internos: [{cat, pct}]
  const [extras, setExtras] = useState([])

  // Parse categorías especiales externos: [{cat, pct}]
  const [extExtras, setExtExtras] = useState([])

  // Inicializar extras internos
  useEffect(() => {
    if (campos._comision_extras) {
      try {
        const val = campos._comision_extras
        const parsed = Array.isArray(val) ? val : JSON.parse(val)
        if (Array.isArray(parsed)) setExtras(parsed)
      } catch {}
    }
  }, [campos._comision_extras])

  // Inicializar extras externos
  useEffect(() => {
    if (campos._comision_ext_extras) {
      try {
        const val = campos._comision_ext_extras
        const parsed = Array.isArray(val) ? val : JSON.parse(val)
        if (Array.isArray(parsed)) setExtExtras(parsed)
      } catch {}
    }
  }, [campos._comision_ext_extras])

  // Categorías especiales internos
  const catPrincipal = campos.comision_categoria_cabilla || ''
  const catsEspeciales = [catPrincipal, ...extras.map(e => e.cat)].filter(Boolean)

  // Categorías especiales externos
  const catsEspecialesExt = [catPrincipal, ...extExtras.map(e => e.cat)].filter(Boolean)

  function agregarCategoria() {
    const disponibles = categorias.filter(c => !catsEspeciales.includes(c.value))
    if (disponibles.length === 0) return
    const nuevas = [...extras, { cat: disponibles[0].value, pct: 2 }]
    setExtras(nuevas)
    cambiar('_comision_extras', nuevas)
  }

  function cambiarExtra(idx, campo, valor) {
    const nuevas = extras.map((e, i) => i === idx ? { ...e, [campo]: valor } : e)
    setExtras(nuevas)
    cambiar('_comision_extras', nuevas)
  }

  function eliminarExtra(idx) {
    const nuevas = extras.filter((_, i) => i !== idx)
    setExtras(nuevas)
    cambiar('_comision_extras', nuevas)
  }

  function agregarCategoriaExt() {
    const disponibles = categorias.filter(c => !catsEspecialesExt.includes(c.value))
    if (disponibles.length === 0) return
    const nuevas = [...extExtras, { cat: disponibles[0].value, pct: 2 }]
    setExtExtras(nuevas)
    cambiar('_comision_ext_extras', nuevas)
  }

  function cambiarExtraExt(idx, campo, valor) {
    const nuevas = extExtras.map((e, i) => i === idx ? { ...e, [campo]: valor } : e)
    setExtExtras(nuevas)
    cambiar('_comision_ext_extras', nuevas)
  }

  function eliminarExtraExt(idx) {
    const nuevas = extExtras.filter((_, i) => i !== idx)
    setExtExtras(nuevas)
    cambiar('_comision_ext_extras', nuevas)
  }

  const selectOnFocus = (e) => e.target.select()

  const catsDisponibles = categorias.filter(c => !catsEspeciales.includes(c.value))
  const catsDisponiblesExt = categorias.filter(c => !catsEspecialesExt.includes(c.value))

  const COLORES = [
    { from: 'from-amber-50', to: 'to-orange-50', border: 'border-amber-200', dot: 'bg-amber-500', title: 'text-amber-800', ring: 'focus:ring-amber-300', pct: 'text-amber-600', ejemplo: 'text-amber-700' },
    { from: 'from-violet-50', to: 'to-purple-50', border: 'border-violet-200', dot: 'bg-violet-500', title: 'text-violet-800', ring: 'focus:ring-violet-300', pct: 'text-violet-600', ejemplo: 'text-violet-700' },
    { from: 'from-emerald-50', to: 'to-teal-50', border: 'border-emerald-200', dot: 'bg-emerald-500', title: 'text-emerald-800', ring: 'focus:ring-emerald-300', pct: 'text-emerald-600', ejemplo: 'text-emerald-700' },
    { from: 'from-rose-50', to: 'to-pink-50', border: 'border-rose-200', dot: 'bg-rose-500', title: 'text-rose-800', ring: 'focus:ring-rose-300', pct: 'text-rose-600', ejemplo: 'text-rose-700' },
  ]



  return (
    <div className="space-y-6">
      {/* Grid de Configuración de Comisiones - Lado a Lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* SECCIÓN 1: VENDEDORES INTERNOS */}
        <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-slate-200/80 p-5 space-y-5 shadow-sm hover:border-slate-300/80 transition-all duration-300">
          <SectionHeader icon={Percent}>Vendedores Internos</SectionHeader>
          <p className="text-xs text-slate-500 -mt-2">
            Porcentajes de comisión para vendedores internos. Se calculan al marcar un despacho como entregado.
          </p>

          <div className="space-y-4">
            {/* Tarjeta categoría principal */}
            <div className={`bg-gradient-to-br ${COLORES[0].from} ${COLORES[0].to} rounded-xl border ${COLORES[0].border} p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300`}>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${COLORES[0].dot}`} />
                <span className={`text-xs font-bold uppercase tracking-wider ${COLORES[0].title}`}>Categoría principal ({catPrincipal || 'Cabilla'})</span>
              </div>

              {/* Selector dropdown */}
              {categorias.length > 0 && (
                <CustomSelect
                  options={categorias.filter(c => !extras.map(e => e.cat).includes(c.value))}
                  value={catPrincipal}
                  onChange={val => !disabled && cambiar('comision_categoria_cabilla', val)}
                  placeholder="Seleccionar categoría"
                  disabled={disabled}
                />
              )}

              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.comision_pct_cabilla}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('comision_pct_cabilla', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className={`w-20 px-3 py-2.5 rounded-xl border ${COLORES[0].border} bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 ${COLORES[0].ring} text-right font-bold shadow-inner`}
                  disabled={disabled} />
                <span className={`text-lg font-bold ${COLORES[0].pct}`}>%</span>
              </div>
              <p className={`text-xs ${COLORES[0].ejemplo}`}>
                $1,000 → <strong>{fmtUsd(1000 * campos.comision_pct_cabilla / 100)}</strong>
              </p>
            </div>

            {/* Tarjetas de categorías extras */}
            {extras.map((extra, idx) => {
              const color = COLORES[(idx + 1) % COLORES.length]
              return (
                <div key={idx} className={`bg-gradient-to-br ${color.from} ${color.to} rounded-xl border ${color.border} p-4 space-y-3 relative shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300`}>
                  <button type="button" onClick={() => eliminarExtra(idx)} disabled={disabled}
                    className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={14} />
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                    <span className={`text-xs font-bold uppercase tracking-wider ${color.title}`}>Categoría especial {idx + 2}</span>
                  </div>

                  {/* Selector dropdown */}
                  <CustomSelect
                    options={[
                      { value: extra.cat, label: extra.cat },
                      ...categorias.filter(c => !catsEspeciales.includes(c.value)),
                    ]}
                    value={extra.cat}
                    onChange={val => !disabled && cambiarExtra(idx, 'cat', val)}
                    placeholder="Seleccionar categoría"
                    disabled={disabled}
                  />

                  <div className="flex items-baseline gap-2">
                    <input type="number" min="0" max="100" step="0.01"
                      value={extra.pct}
                      onFocus={selectOnFocus}
                      onChange={e => cambiarExtra(idx, 'pct', Math.max(0, Math.min(100, Number(e.target.value))))}
                      className={`w-20 px-3 py-2.5 rounded-xl border ${color.border} bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 ${color.ring} text-right font-bold shadow-inner`}
                      disabled={disabled} />
                    <span className={`text-lg font-bold ${color.pct}`}>%</span>
                  </div>
                  <p className={`text-xs ${color.ejemplo}`}>
                    $1,000 → <strong>{fmtUsd(1000 * extra.pct / 100)}</strong>
                  </p>
                </div>
              )
            })}

            {/* Tarjeta "Productos externos" */}
            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl border border-indigo-200 p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Productos externos</span>
              </div>
              <p className="text-[11px] text-indigo-400 font-medium">Aplica a productos no pertenecientes al inventario físico.</p>
              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.comision_pct_externos}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('comision_pct_externos', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 px-3 py-2.5 rounded-xl border border-indigo-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right font-bold shadow-inner"
                  disabled={disabled} />
                <span className="text-lg font-bold text-indigo-500">%</span>
              </div>
              <p className="text-xs text-indigo-600 font-semibold">
                $1,000 → <strong>{fmtUsd(1000 * (campos.comision_pct_externos ?? 3) / 100)}</strong>
              </p>
            </div>

            {/* Tarjeta "Demás categorías" (siempre al final) */}
            <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl border border-slate-200 p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Demás categorías</span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Aplica a todas las categorías sin tasa especial.</p>
              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.comision_pct_otros}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('comision_pct_otros', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 text-right font-bold shadow-inner"
                  disabled={disabled} />
                <span className="text-lg font-bold text-blue-500">%</span>
              </div>
              <p className="text-xs text-slate-500 font-semibold">
                $1,000 → <strong>{fmtUsd(1000 * campos.comision_pct_otros / 100)}</strong>
              </p>
            </div>

            {/* Tarjeta "Descuento de Personal" */}
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Descuento de Personal</span>
              </div>
              <p className="text-[11px] text-indigo-400 font-medium">Aplica un descuento por defecto a trabajadores de la empresa.</p>
              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.descuento_personal_pct ?? 10.00}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('descuento_personal_pct', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 px-3 py-2.5 rounded-xl border border-indigo-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right font-bold shadow-inner"
                  disabled={disabled} />
                <span className="text-lg font-bold text-indigo-500">%</span>
              </div>
            </div>
          </div>

          {/* Botón agregar categoría */}
          {catsDisponibles.length > 0 && (
            <button type="button" onClick={agregarCategoria} disabled={disabled}
              className="flex items-center gap-2 text-xs font-bold text-[#1B365D] hover:text-[#1B365D]/85 transition-colors disabled:opacity-50 mt-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/80 shadow-sm w-full justify-center active:scale-[0.99]">
              <Plus size={14} />
              Agregar categoría especial
            </button>
          )}
        </div>

        {/* SECCIÓN 2: VENDEDORES EXTERNOS (con color ámbar #D97706) */}
        <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-amber-200/80 p-5 space-y-5 shadow-sm relative overflow-hidden hover:border-amber-300/80 transition-all duration-300">
          {/* Línea superior para destacar la sección con color de externos */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
          
          <div className="flex items-center justify-between">
            <SectionHeaderExt icon={Users}>Vendedores Externos</SectionHeaderExt>
            <div className="flex items-center gap-1 bg-amber-500/10 text-amber-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-amber-500/20">
              Canal Externo
            </div>
          </div>
          <p className="text-xs text-slate-500 -mt-2">
            Configuración global aplicable únicamente a los vendedores marcados como <strong>Externos</strong>.
          </p>

          <div className="space-y-4">
            {/* Markup Recargo Global */}
            <div className="bg-gradient-to-br from-amber-50/60 to-orange-50/60 rounded-xl border border-amber-200/60 p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                  Recargo de Venta (Markup)
                  <div className="group relative">
                    <Info size={12} className="text-amber-700 cursor-pointer" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 text-white text-[10px] p-2 rounded-lg font-normal opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-md z-20">
                      Margen que se agrega por defecto a los precios del inventario cuando un vendedor externo cotiza.
                    </span>
                  </div>
                </span>
              </div>
              <p className="text-[11px] text-amber-700/80 font-medium">
                Margen incrementado sobre los precios base del inventario.
              </p>
              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.markup_pct_externo}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('markup_pct_externo', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 px-3 py-2.5 rounded-xl border border-amber-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-right font-bold shadow-inner"
                  disabled={disabled} />
                <span className="text-lg font-bold text-amber-600">%</span>
              </div>
              <p className="text-xs text-amber-700 font-semibold">
                Ejemplo: Costo $100 → Venta <strong>{fmtUsd(100 * (1 + campos.markup_pct_externo / 100))}</strong> (+{campos.markup_pct_externo}%)
              </p>
            </div>

            {/* Tarjeta categoría principal (Cabilla / Cemento) */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200/60 p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                  Categoría principal & Cemento
                  <div className="group relative">
                    <Info size={12} className="text-amber-700 cursor-pointer" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 text-white text-[10px] p-2 rounded-lg font-normal opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-md z-20">
                      Por regla de negocio, el Cemento comparte la misma tasa de comisión que la categoría principal.
                    </span>
                  </div>
                </span>
              </div>
              <p className="text-[11px] text-amber-700/80 font-medium">
                Aplica a la categoría principal y Cemento (actualmente {campos.comision_ext_pct_cabilla}%).
              </p>
              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.comision_ext_pct_cabilla}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('comision_ext_pct_cabilla', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 px-3 py-2.5 rounded-xl border border-amber-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-right font-bold shadow-inner"
                  disabled={disabled} />
                <span className="text-lg font-bold text-amber-600">%</span>
              </div>
              <p className="text-xs text-amber-700 font-semibold">
                $1,000 → <strong>{fmtUsd(1000 * campos.comision_ext_pct_cabilla / 100)}</strong>
              </p>
            </div>

            {/* Tarjetas de categorías extras externos */}
            {extExtras.map((extra, idx) => {
              return (
                <div key={idx} className="bg-gradient-to-br from-amber-50 to-orange-50/30 rounded-xl border border-amber-200/60 p-4 space-y-3 relative shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
                  <button type="button" onClick={() => eliminarExtraExt(idx)} disabled={disabled}
                    className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={14} />
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Categoría especial {idx + 2} (Ext.)</span>
                  </div>

                  {/* Selector dropdown */}
                  <CustomSelect
                    options={[
                      { value: extra.cat, label: extra.cat },
                      ...categorias.filter(c => !catsEspecialesExt.includes(c.value)),
                    ]}
                    value={extra.cat}
                    onChange={val => !disabled && cambiarExtraExt(idx, 'cat', val)}
                    placeholder="Seleccionar categoría"
                    disabled={disabled}
                  />

                  <div className="flex items-baseline gap-2">
                    <input type="number" min="0" max="100" step="0.01"
                      value={extra.pct}
                      onFocus={selectOnFocus}
                      onChange={e => cambiarExtraExt(idx, 'pct', Math.max(0, Math.min(100, Number(e.target.value))))}
                      className="w-20 px-3 py-2.5 rounded-xl border border-amber-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-right font-bold shadow-inner"
                      disabled={disabled} />
                    <span className="text-lg font-bold text-amber-600">%</span>
                  </div>
                  <p className="text-xs text-amber-700 font-semibold">
                    $1,000 → <strong>{fmtUsd(1000 * extra.pct / 100)}</strong>
                  </p>
                </div>
              )
            })}

            {/* Tarjeta "Productos externos" para externos */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200/60 p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Productos externos</span>
              </div>
              <p className="text-[11px] text-amber-700/80 font-medium">Aplica a productos no pertenecientes al inventario físico.</p>
              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.comision_ext_pct_externos}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('comision_ext_pct_externos', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 px-3 py-2.5 rounded-xl border border-amber-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-right font-bold shadow-inner"
                  disabled={disabled} />
                <span className="text-lg font-bold text-amber-600">%</span>
              </div>
              <p className="text-xs text-amber-700 font-semibold">
                $1,000 → <strong>{fmtUsd(1000 * (campos.comision_ext_pct_externos ?? 3) / 100)}</strong>
              </p>
            </div>

            {/* Tarjeta "Demás categorías" para externos */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200/60 p-4 space-y-3 shadow-sm hover:scale-[1.01] hover:shadow-md transition-all duration-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Demás categorías</span>
              </div>
              <p className="text-[11px] text-amber-700/80 font-medium">Aplica a todas las categorías sin tasa especial.</p>
              <div className="flex items-baseline gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  value={campos.comision_ext_pct_otros}
                  onFocus={selectOnFocus}
                  onChange={e => cambiar('comision_ext_pct_otros', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-20 px-3 py-2.5 rounded-xl border border-amber-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-right font-bold shadow-inner"
                  disabled={disabled} />
                <span className="text-lg font-bold text-amber-600">%</span>
              </div>
              <p className="text-xs text-amber-700 font-semibold">
                $1,000 → <strong>{fmtUsd(1000 * campos.comision_ext_pct_otros / 100)}</strong>
              </p>
            </div>
          </div>

          {/* Botón agregar categoría para externos */}
          {catsDisponiblesExt.length > 0 && (
            <button type="button" onClick={agregarCategoriaExt} disabled={disabled}
              className="flex items-center gap-2 text-xs font-bold text-amber-800 hover:text-amber-900 transition-colors disabled:opacity-50 mt-2 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200/80 shadow-sm w-full justify-center active:scale-[0.99]">
              <Plus size={14} />
              Agregar categoría especial para externos
            </button>
          )}
        </div>
      </div>



      {/* Grid inferior: IVA Simbólico + Plantilla Nota de Entrega */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* ── IVA de Facturación ─────────────────────────────────────────── */}
        <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-slate-200/80 p-5 space-y-4 shadow-sm hover:border-slate-300/80 transition-all duration-300">
          <SectionHeader icon={Percent}>IVA de Facturación</SectionHeader>
          <p className="text-xs text-slate-500 -mt-2">
            Porcentaje de IVA que se aplicará al generar el PDF de la factura.
          </p>
          <div className="flex items-baseline gap-3">
            <input type="number" min="0" max="100" step="0.01"
              value={campos.iva_pct}
              onFocus={e => e.target.select()}
              onChange={e => cambiar('iva_pct', Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="w-24 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 text-right font-bold shadow-inner"
              disabled={disabled} />
            <span className="text-lg font-bold text-blue-500">%</span>
          </div>
        </div>

        {/* ── Plantilla de Nota de Entrega ─────────────────────────────────── */}
        <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-slate-200/80 p-5 space-y-4 shadow-sm hover:border-slate-300/80 transition-all duration-300">
          <SectionHeader icon={FileText}>Plantilla de Nota de Entrega</SectionHeader>
          <p className="text-xs text-slate-500 -mt-2">
            Selecciona el diseño del PDF generado para las notas de entrega de los despachos.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Opción Estándar */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => cambiar('nota_entrega_plantilla', 'estandar')}
              className={`flex flex-col text-left p-4 rounded-xl border transition-all hover:scale-[1.02] duration-200 ${
                (campos.nota_entrega_plantilla || 'estandar') === 'estandar'
                  ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-200 shadow-sm'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="text-xs font-bold text-slate-800">Estándar (Logo + Membrete)</span>
              <span className="text-[10px] text-slate-500 mt-1">
                Incluye logo, datos de contacto y pie de página en el PDF.
              </span>
            </button>

            {/* Opción Membrete Pre-Impreso */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => cambiar('nota_entrega_plantilla', 'membrete')}
              className={`flex flex-col text-left p-4 rounded-xl border transition-all hover:scale-[1.02] duration-200 ${
                campos.nota_entrega_plantilla === 'membrete'
                  ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-200 shadow-sm'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="text-xs font-bold text-slate-800">Hoja Pre-Impresa</span>
              <span className="text-[10px] text-slate-500 mt-1">
                Omite logo y membrete. Ideal para imprimir sobre hojas físicas ya membretadas.
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ConfiguracionView() {
  const { data: config = {}, isLoading } = useConfigNegocio()
  const actualizar = useActualizarConfig()
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador'
  const [tab, setTab]         = useState(esAdmin ? 'comisiones' : 'negocio')
  const [guardado, setGuardado] = useState(false)
  const [error,    setError]    = useState('')
  const [showGatePass, setShowGatePass] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupMsg, setBackupMsg]         = useState(null)
  const [clearLoading, setClearLoading] = useState(false)
  const [clearMsg, setClearMsg]         = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetMsg, setResetMsg]         = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetOpLoading, setResetOpLoading] = useState(false)
  const [resetOpMsg, setResetOpMsg]         = useState(null)
  const [confirmResetOp, setConfirmResetOp] = useState(false)
  const [restoreMsg, setRestoreMsg]         = useState(null)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [copiedSql, setCopiedSql]           = useState(false)
  const restoreInputRef = useRef(null)

  const [modoAccesible, setModoAccesible] = useState(() => {
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const key = `modo-accesible${businessId ? `-${businessId}` : ''}`
    return localStorage.getItem(key) === '1'
  })

  function toggleModoAccesible() {
    const next = !modoAccesible
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const key = `modo-accesible${businessId ? `-${businessId}` : ''}`
    setModoAccesible(next)
    localStorage.setItem(key, next ? '1' : '0')
    document.documentElement.classList.toggle('modo-accesible', next)
  }

  const [campos, setCampos] = useState({
    nombre_negocio:          '',
    rif_negocio:             '',
    telefono_negocio:        '',
    email_negocio:           '',
    direccion_negocio:       '',
    pie_pagina_pdf:          '',
    iva_pct:                 16,
    nota_entrega_mostrar_iva: true,
    nota_entrega_plantilla:  'estandar',
    gate_email:              '',
    comision_pct_cabilla:         2,
    comision_pct_otros:           3,
    comision_pct_externos:        3,
    comision_categoria_cabilla:   'Cabilla',
    _comision_extras:             [],
    markup_pct_externo:           5.00,
    comision_ext_pct_cabilla:     2,
    comision_ext_pct_otros:       3,
    comision_ext_pct_externos:    3,
    _comision_ext_extras:         [],
    descuento_personal_pct:       10.00,
  })
  const [gatePassword, setGatePassword] = useState('')

  useEffect(() => {
    if (config && Object.keys(config).length > 0) {
      setCampos({
        nombre_negocio:          config.nombre_negocio          ?? '',
        rif_negocio:             config.rif_negocio             ?? '',
        telefono_negocio:        config.telefono_negocio        ?? '',
        email_negocio:           config.email_negocio           ?? '',
        direccion_negocio:       config.direccion_negocio       ?? '',
        pie_pagina_pdf:          config.pie_pagina_pdf          ?? '',
        iva_pct:                 config.iva_pct                 ?? 16,
        nota_entrega_mostrar_iva: config.nota_entrega_mostrar_iva ?? true,
        nota_entrega_plantilla:  config.nota_entrega_plantilla  ?? 'estandar',
        gate_email:              config.gate_email              ?? '',
        comision_pct_cabilla:       config.comision_pct_cabilla       ?? 2,
        comision_pct_otros:         config.comision_pct_otros         ?? 3,
        comision_pct_externos:      config.comision_pct_externos      ?? 3,
        comision_categoria_cabilla: config.comision_categoria_cabilla ?? 'Cabilla',
        _comision_extras:           config._comision_extras           ?? [],
        markup_pct_externo:         config.markup_pct_externo         ?? 5.00,
        comision_ext_pct_cabilla:   config.comision_ext_pct_cabilla   ?? 2,
        comision_ext_pct_otros:     config.comision_ext_pct_otros     ?? 3,
        comision_ext_pct_externos:  config.comision_ext_pct_externos  ?? 3,
        _comision_ext_extras:       config._comision_ext_extras       ?? [],
        descuento_personal_pct:     config.descuento_personal_pct     ?? 10.00,
      })
    }
  }, [config])

  async function handleClearInventory() {
    setClearLoading(true); setClearMsg(null); setConfirmClear(false)
    try {
      await adminAPI.clearInventory()
      setClearMsg({ tipo: 'ok', texto: 'Inventario borrado correctamente' })
    } catch (err) {
      setClearMsg({ tipo: 'error', texto: err.message || 'Error al borrar' })
    } finally { setClearLoading(false) }
  }

  async function handleFactoryReset() {
    setResetLoading(true); setResetMsg(null); setConfirmReset(false)
    try {
      await adminAPI.factoryReset()
      setResetMsg({ tipo: 'ok', texto: 'Reinicio completado. El inventario se conservó.' })
    } catch (err) {
      setResetMsg({ tipo: 'error', texto: err.message || 'Error al reiniciar' })
    } finally { setResetLoading(false) }
  }

  async function handleResetOperacional() {
    setResetOpLoading(true); setResetOpMsg(null); setConfirmResetOp(false)
    try {
      const result = await adminAPI.resetOperacional()
      const correlativos = result?.correlativo_inicio ? ` Los correlativos inician en COT-00${result.correlativo_inicio}.` : ''
      const warning = result?.warning ? ` ⚠ ${result.warning}` : ''
      setResetOpMsg({ tipo: 'ok', texto: `Reinicio completado. Clientes e inventario conservados.${correlativos}${warning}` })
    } catch (err) {
      setResetOpMsg({ tipo: 'error', texto: err.message || 'Error al reiniciar' })
    } finally { setResetOpLoading(false) }
  }

  async function handleBackup() {
    setBackupMsg(null)
    try {
      const filename = await adminAPI.downloadBackup()
      setBackupMsg({ tipo: 'ok', texto: `Descargado: ${filename}` })
    } catch (err) {
      setBackupMsg({ tipo: 'error', texto: err.message || 'Error al generar backup' })
    } finally { setBackupLoading(false) }
  }

  async function handleRestoreFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    if (!confirmRestore) { setConfirmRestore(file); return }
    await doRestore(file)
  }

  async function doRestore(file) {
    setRestoreLoading(true); setRestoreMsg(null); setConfirmRestore(false)
    try {
      const resumen = await adminAPI.restoreBackup(file)
      const total   = Object.values(resumen).reduce((a, b) => a + b, 0)
      setRestoreMsg({ tipo: 'ok', texto: `Restaurado: ${total} registros en ${Object.keys(resumen).length} tablas` })
    } catch (err) {
      setRestoreMsg({ tipo: 'error', texto: err.message || 'Error al restaurar' })
    } finally { setRestoreLoading(false) }
  }

  function cambiar(k, v) { setCampos(p => ({ ...p, [k]: v })); setGuardado(false); setError('') }

  async function handleGuardar(e) {
    e.preventDefault()
    if (!campos.nombre_negocio.trim()) { setError('El nombre del negocio es obligatorio'); return }
    try {
      const keysExistentes = Object.keys(config)
      const datosGuardar = {}
      for (const [key, val] of Object.entries(campos)) {
        if (keysExistentes.length === 0 || keysExistentes.includes(key) || key === 'gate_password_hash') {
          datosGuardar[key] = val
        }
      }
      if (gatePassword.trim()) {
        datosGuardar.gate_password_hash = await hashSHA256(gatePassword)
        setGatePassword('')
      }
      await actualizar.mutateAsync(datosGuardar)
      setGuardado(true)
      setTimeout(() => setGuardado(false), 3000)
    } catch (err) {
      setError(err.message ?? 'Error al guardar')
    }
  }

  const migrationSql = `ALTER TABLE configuracion_negocio\n  ADD COLUMN IF NOT EXISTS iva_pct NUMERIC(5,2) NOT NULL DEFAULT 16;`
  const ivaMissing   = config.iva_pct === undefined || config.iva_pct === null

  async function copiarSql() {
    await navigator.clipboard.writeText(migrationSql).catch(() => {})
    setCopiedSql(true)
    setTimeout(() => setCopiedSql(false), 2000)
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'
  const cargando = actualizar.isPending
  const esTabForm = tab === 'comisiones' || tab === 'negocio'

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 max-w-4xl space-y-4">

      {/* Encabezado */}
      <PageHeader
        icon={Settings}
        title="Configuración"
        subtitle="Ajustes del sistema y del negocio"
      />

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1 bg-slate-100 p-1 rounded-2xl scrollbar-hide">
        {TABS.filter(t => !t.roles || t.roles.includes(perfil?.rol)).map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all sm:flex-1 justify-center overflow-hidden ${
                active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {active && (
                <span className="absolute bottom-0 left-[20%] right-[20%] h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(to right, #1B365D, #B8860B)' }} />
              )}
              <span className={`flex items-center justify-center w-5 h-5 rounded-md transition-all ${
                active ? 'text-[#1B365D]' : ''
              }`}>
                <Icon size={14} />
              </span>
              <span className="inline sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tabs de formulario — Negocio, Fiscal, Sistema */}
      {esTabForm && (
        <form onSubmit={handleGuardar} className="space-y-5">

          {/* ── Negocio ─────────────────────────────────────────────────── */}
          {tab === 'negocio' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
              <SectionHeader icon={Building2}>Datos de contacto</SectionHeader>
              <p className="text-xs text-slate-500 -mt-2">
                Teléfono y correo que aparecen en los PDFs de cotizaciones y notas de entrega.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    <Building2 size={12} className="inline mr-1" />Nombre del negocio
                  </label>
                  <input
                    type="text"
                    value={campos.nombre_negocio}
                    onChange={e => cambiar('nombre_negocio', e.target.value)}
                    placeholder="Distribuidora Ejemplo C.A."
                    disabled={isLoading || cargando}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D]/40 transition-all disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    <Phone size={12} className="inline mr-1" />Teléfono
                  </label>
                  <input
                    type="text"
                    value={campos.telefono_negocio}
                    onChange={e => cambiar('telefono_negocio', e.target.value)}
                    placeholder="0424-4556736 / 0412-4416005"
                    disabled={isLoading || cargando}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D]/40 transition-all disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    <Mail size={12} className="inline mr-1" />Correo electrónico
                  </label>
                  <input
                    type="email"
                    value={campos.email_negocio}
                    onChange={e => cambiar('email_negocio', e.target.value)}
                    placeholder="j501159130@gmail.com"
                    disabled={isLoading || cargando}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1B365D]/20 focus:border-[#1B365D]/40 transition-all disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Comisiones ────────────────────────────────────────────────── */}
          {tab === 'comisiones' && <ComisionesTab campos={campos} cambiar={cambiar} isLoading={isLoading} cargando={cargando} />}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
              {error.includes('iva_pct') && (
                <p className="mt-1 text-xs">Ejecuta la migración SQL en Supabase Dashboard (ver tab "Fiscal").</p>
              )}
            </div>
          )}

          {/* Botón guardar */}
          <div className="flex items-center justify-end gap-3 pb-4">
            {guardado && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                <CheckCircle size={15} /> Cambios guardados
              </div>
            )}
            <button type="submit" disabled={isLoading || cargando}
              className="flex items-center gap-2 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              {cargando
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Guardando...</>
                : <><Save size={15} />Guardar cambios</>
              }
            </button>
          </div>
        </form>
      )}

      {/* ── Tab Usuarios ───────────────────────────────────────────────────── */}
      {tab === 'usuarios' && <UsuariosView embedded />}

      {/* ── Tab Datos ──────────────────────────────────────────────────────── */}
      {tab === 'datos' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <SectionHeader icon={HardDrive}>Copia de seguridad</SectionHeader>
            <p className="text-xs text-slate-500 -mt-2">
              Descarga o importa un archivo JSON con todos los datos del sistema.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleBackup} disabled={backupLoading}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
                {backupLoading
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Generando...</>
                  : <><Download size={15} />Descargar backup</>
                }
              </button>
              <input ref={restoreInputRef} type="file" accept=".json" className="hidden" onChange={handleRestoreFile} />
              <button type="button" onClick={() => restoreInputRef.current?.click()} disabled={restoreLoading}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
                {restoreLoading
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Restaurando...</>
                  : <><Upload size={15} />Importar backup</>
                }
              </button>
            </div>
            {confirmRestore && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">¿Confirmar restauración?</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Sobreescribirá los datos existentes con <strong>{confirmRestore.name}</strong>. No se puede deshacer.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => doRestore(confirmRestore)}
                    className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
                    <Upload size={13} />Sí, restaurar
                  </button>
                  <button type="button" onClick={() => setConfirmRestore(false)}
                    className="text-sm font-medium text-slate-600 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {backupMsg && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${backupMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {backupMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                {backupMsg.texto}
              </div>
            )}
            {restoreMsg && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${restoreMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {restoreMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                {restoreMsg.texto}
              </div>
            )}
          </div>

          {/* ── Reinicio Operacional (supervisores+) ─────────────────────── */}
          {esSupervisor && (
          <div className="bg-white rounded-2xl border border-orange-200 p-5 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-0.5 self-stretch rounded-full shrink-0 bg-orange-400" style={{ minHeight: '20px' }} />
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-orange-50 border border-orange-200">
                <AlertTriangle size={13} className="text-orange-500" />
              </div>
              <h2 className="text-sm font-bold text-orange-700 uppercase tracking-wide">Reinicio operacional</h2>
            </div>

            {/* Qué borra / qué conserva */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide mb-1.5">Se borra</p>
                <ul className="space-y-0.5">
                  {['Cotizaciones','Ítems cotiz.','Notas de despacho','Comisiones','Cuentas por cobrar','Kardex (movimientos)','Auditoría','Logs del sistema'].map(item => (
                    <li key={item} className="flex items-center gap-1.5 text-[11px] text-red-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />{item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-1.5">Se conserva</p>
                <ul className="space-y-0.5">
                  {['Usuarios','Clientes','Productos (stock)','Transportistas','Configuración'].map(item => (
                    <li key={item} className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />{item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-xs text-slate-500">Los correlativos se reinician a <strong className="text-slate-700">COT-00200</strong>. Esta acción es <strong className="text-orange-600">irreversible</strong> — descarga un backup primero.</p>

            {!confirmResetOp ? (
              <button type="button" onClick={() => setConfirmResetOp(true)}
                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-md active:scale-[0.98]">
                <AlertTriangle size={15} />Ejecutar reinicio operacional
              </button>
            ) : (
              <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-orange-600 mt-0.5 shrink-0" />
                  <p className="text-sm font-semibold text-orange-900">
                    ¿Confirmas el reinicio operacional? Se borrarán todas las cotizaciones, despachos, comisiones y el kardex. Los correlativos reinician en <strong>COT-00200</strong>. Esta acción no se puede deshacer.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={handleResetOperacional} disabled={resetOpLoading}
                    className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 shadow-md">
                    {resetOpLoading
                      ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Reiniciando...</>
                      : <><AlertTriangle size={14} />Sí, reiniciar ahora</>
                    }
                  </button>
                  <button type="button" onClick={() => setConfirmResetOp(false)}
                    className="text-sm font-semibold text-slate-600 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {resetOpMsg && (
              <div className={`flex items-start gap-2 text-sm font-medium p-3 rounded-xl border ${
                resetOpMsg.tipo === 'ok'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-red-700 bg-red-50 border-red-200'
              }`}>
                {resetOpMsg.tipo === 'ok' ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                <span>{resetOpMsg.texto}</span>
              </div>
            )}
          </div>
          )}

          {/* ── Zona de peligro (solo desarrollador) ────────────────────── */}
          {esDesarrollador && (
          <div className="bg-white rounded-2xl border border-red-200 p-5 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-0.5 self-stretch rounded-full shrink-0 bg-red-400" style={{ minHeight: '20px' }} />
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-red-50 border border-red-200">
                <AlertTriangle size={13} className="text-red-500" />
              </div>
              <h2 className="text-sm font-bold text-red-700 uppercase tracking-wide">Zona de peligro</h2>
            </div>
            <p className="text-xs text-slate-500 -mt-2">Acciones permanentes e irreversibles. Solo para desarrolladores.</p>
            {!confirmClear ? (
              <button type="button" onClick={() => setConfirmClear(true)}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm">
                <AlertTriangle size={15} />Borrar todo el inventario
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-red-800">
                  ¿Estás seguro? Borrará <strong>todos los productos</strong> permanentemente.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={handleClearInventory} disabled={clearLoading}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                    {clearLoading
                      ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Borrando...</>
                      : 'Sí, borrar todo'
                    }
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)}
                    className="text-sm font-medium text-slate-600 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {clearMsg && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${clearMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                {clearMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                {clearMsg.texto}
              </div>
            )}

            <div className="border-t border-red-100 pt-4 mt-2">
              <p className="text-xs text-slate-500 mb-3">Elimina clientes, cotizaciones, despachos, comisiones y transportistas. <strong>El inventario, los usuarios y la configuración se conservan.</strong></p>
              {!confirmReset ? (
                <button type="button" onClick={() => setConfirmReset(true)}
                  className="flex items-center gap-2 bg-red-800 hover:bg-red-900 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm">
                  <AlertTriangle size={15} />Reinicio de fábrica
                </button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-red-800">
                    ¿Estás seguro? Se borrarán clientes, cotizaciones, despachos, comisiones y transportistas. <strong>El inventario se conserva.</strong>
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleFactoryReset} disabled={resetLoading}
                      className="flex items-center gap-1.5 bg-red-800 hover:bg-red-900 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                      {resetLoading
                        ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Reiniciando...</>
                        : 'Sí, reiniciar todo'
                      }
                    </button>
                    <button type="button" onClick={() => setConfirmReset(false)}
                      className="text-sm font-medium text-slate-600 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {resetMsg && (
                <div className={`flex items-center gap-1.5 text-sm font-medium mt-2 ${resetMsg.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {resetMsg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                  {resetMsg.texto}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  )
}
