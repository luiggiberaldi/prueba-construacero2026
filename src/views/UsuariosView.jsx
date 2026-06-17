// src/views/UsuariosView.jsx
// Gestión de usuarios — solo supervisores
// Listo POS (avatares con inicial, Crown para supervisor)
import { useState } from 'react'
import { UserCog, Plus, Pencil, UserCheck, UserX, RefreshCw, Crown, Eye, EyeOff, Trash2, Phone, ArrowLeftRight, X, Loader2 } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import CustomSelect from '../components/ui/CustomSelect'
import {
  useUsuarios,
  useCrearUsuario,
  useActualizarUsuario,
  useCambiarActivoUsuario,
  useEliminarUsuario,
} from '../hooks/useUsuarios'
import { COTIZACIONES_KEY } from '../hooks/useCotizaciones'
import { CLIENTES_KEY } from '../hooks/useClientes'
import { DESPACHOS_KEY } from '../hooks/useDespachos'
import { useQueryClient } from '@tanstack/react-query'
import { useConfigNegocio } from '../hooks/useConfigNegocio'
import ConfirmModal from '../components/ui/ConfirmModal'
import Skeleton    from '../components/ui/Skeleton'
import EmptyState  from '../components/ui/EmptyState'
import PageHeader  from '../components/ui/PageHeader'
import { apiUrl } from '../services/apiBase'

const ROL_CONFIG = {
  supervisor: {
    label:  'Jefe de ventas',
    bg:     'bg-blue-50',
    text:   'text-blue-700',
    border: 'border-blue-200',
  },
  administracion: {
    label:  'Administración',
    bg:     'bg-slate-100',
    text:   'text-slate-700',
    border: 'border-slate-300',
  },
  vendedor: {
    label:  'Vendedor',
    bg:     'bg-teal-50',
    text:   'text-teal-700',
    border: 'border-teal-200',
  },
  vendedor_sin_comision: {
    label:  'Vendedor',
    bg:     'bg-teal-50',
    text:   'text-teal-700',
    border: 'border-teal-200',
  },
  desarrollador: {
    label:  'Desarrollador',
    bg:     'bg-violet-50',
    text:   'text-violet-600',
    border: 'border-violet-200',
  },
  logistica: {
    label:  'Logística',
    bg:     'bg-slate-100',
    text:   'text-slate-700',
    border: 'border-slate-300',
  },
  jefe: {
    label:  'Jefe',
    bg:     'bg-gradient-to-br from-[#FFD700] via-[#B8860B] to-[#8B6914]',
    text:   'text-[#451a03]',
    border: 'border-[#B8860B]/50',
  },
}

// Colores predefinidos para vendedores
const COLORES_VENDEDOR = [
  '#DC2626', // rojo vivo
  '#EA580C', // naranja fuerte
  '#CA8A04', // ámbar oscuro
  '#16A34A', // verde esmeralda
  '#0D9488', // teal profundo
  '#0284C7', // azul cielo
  '#2563EB', // azul real
  '#7C3AED', // violeta
  '#A21CAF', // magenta/púrpura
  '#DB2777', // rosa fuerte
  '#9F1239', // carmesí
  '#4D7C0F', // verde oliva
]

const COLOR_PLATEADO = '#E2E8F0' // slate-200 (plateado brillante)
const COLOR_DORADO = '#B8860B' // Metallic gold base

// ─── Formulario crear usuario ─────────────────────────────────────────────────
function FormCrear({ onGuardar, onCancelar, cargando, coloresUsados = [] }) {
  const primerColorLibre = COLORES_VENDEDOR.find(c => !coloresUsados.includes(c)) ?? COLORES_VENDEDOR[0]
  const [campos, setCampos] = useState({ nombre: '', pin: '', rol: 'vendedor', color: primerColorLibre, telefono: '', es_externo: false })
  const [mostrarPass, setMostrarPass] = useState(false)
  const [error, setError] = useState('')

  function cambiar(k, v) { setCampos(p => ({ ...p, [k]: v })); setError('') }

  function submit(e) {
    e.preventDefault()
    const pinLen = (campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? 4 : 6
    if (!campos.nombre.trim())                   { setError('El nombre es obligatorio'); return }
    if (!new RegExp(`^\\d{${pinLen}}$`).test(campos.pin)) { setError(`El PIN debe ser exactamente ${pinLen} dígitos numéricos`); return }
    if (coloresUsados.includes(campos.color))    { setError('Ese color ya está en uso por otro usuario'); return }
    onGuardar({ nombre: campos.nombre, pin: campos.pin, rol: campos.rol, color: campos.color, telefono: campos.telefono.trim() || undefined, es_externo: campos.es_externo })
  }

  const inputCls = `
    w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl
    text-sm font-medium text-slate-800 placeholder:text-slate-400
    focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all
  `

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Nombre */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-xs font-bold">N</div>
        <input value={campos.nombre} onChange={e => cambiar('nombre', e.target.value)}
          placeholder="Nombre completo" className={inputCls} disabled={cargando} autoFocus />
      </div>
      {/* Teléfono */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Phone size={14} /></div>
        <input value={campos.telefono} onChange={e => {
            let val = e.target.value.replace(/[^\d]/g, '')
            if (val.startsWith('58') && val.length > 10) val = val.slice(2)
            if (val.startsWith('0')) val = val.slice(1)
            val = val.slice(0, 10)
            if (val.length > 3) val = val.slice(0, 3) + '-' + val.slice(3)
            cambiar('telefono', val)
          }}
          placeholder="412-1234567" type="tel" inputMode="tel" className={inputCls} disabled={cargando} />
      </div>
      {/* PIN */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-xs font-bold">#</div>
        <input type={mostrarPass ? 'text' : 'password'} value={campos.pin}
          onChange={e => cambiar('pin', e.target.value.replace(/\D/g, '').slice(0, (campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? 4 : 6))}
          placeholder={`PIN de ${(campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? 4 : 6} dígitos (solo números)`}
          inputMode="numeric"
          className={`${inputCls} pr-11`} disabled={cargando} />
        <button type="button" onClick={() => setMostrarPass(p => !p)}
          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-sky-500 transition-colors">
          {mostrarPass ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {/* Rol */}
      <CustomSelect
        value={campos.rol}
        onChange={v => {
          cambiar('rol', v)
          if (v === 'jefe') cambiar('color', COLOR_DORADO)
          else if (['administracion', 'logistica'].includes(v)) cambiar('color', COLOR_PLATEADO)
          else if (campos.color === COLOR_PLATEADO || campos.color === COLOR_DORADO) cambiar('color', primerColorLibre)
          // Al cambiar a rol sin comisión, limpiar flag de externo si no corresponde
          if (!['vendedor', 'vendedor_sin_comision'].includes(v)) {
            cambiar('es_externo', false)
          }
        }}
        options={[
          { value: 'vendedor', label: 'Vendedor' },
          { value: 'vendedor_sin_comision', label: 'Vendedor sin comisión' },
          { value: 'administracion', label: 'Administración' },
          { value: 'logistica', label: 'Logística' },
          { value: 'supervisor', label: 'Supervisor' },
          { value: 'jefe', label: 'Jefe' },
        ]}
        placeholder="Seleccionar rol..."
        disabled={cargando}
        searchable={false}
      />

      {/* ¿Es Vendedor Externo? */}
      {['vendedor', 'vendedor_sin_comision'].includes(campos.rol) && (
        <label className="flex items-center gap-3 bg-amber-50/50 border border-amber-200/60 p-3 rounded-xl cursor-pointer hover:bg-amber-50 transition-colors">
          <input
            type="checkbox"
            checked={campos.es_externo}
            onChange={e => cambiar('es_externo', e.target.checked)}
            className="w-4.5 h-4.5 border-amber-300 text-amber-600 focus:ring-amber-500 rounded cursor-pointer accent-amber-600"
            disabled={cargando}
          />
          <div className="space-y-0.5">
            <span className="text-xs font-bold text-amber-800 select-none block">¿Es Vendedor Externo?</span>
            <span className="text-[10px] text-amber-600 select-none block">Usa comisiones y recargos globales de la administración.</span>
          </div>
        </label>
      )}

      {/* Color del usuario */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 ml-1">Color del usuario</label>
        {['administracion', 'logistica', 'jefe'].includes(campos.rol) ? (
          <div className="text-xs font-medium text-slate-500 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
            Color fijo asignado automáticamente por el rol.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {COLORES_VENDEDOR.map(c => {
            const enUso = coloresUsados.includes(c)
            return (
              <button key={c} type="button" onClick={() => !enUso && cambiar('color', c)} disabled={enUso}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg transition-all ${
                  campos.color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110'
                  : enUso ? 'opacity-20 cursor-not-allowed'
                  : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
                title={enUso ? 'En uso por otro usuario' : 'Seleccionar'} />
            )
          })}
        </div>
        )}
      </div>

      {error && <p className="text-xs text-red-500 font-bold ml-1">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-5 py-2 rounded-xl text-white text-sm font-black transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
          {cargando ? 'Creando...' : 'Crear usuario'}
        </button>
      </div>
    </form>
  )
}

// ─── Formulario editar usuario ────────────────────────────────────────────────
function FormEditar({ usuario, onGuardar, onCancelar, cargando, coloresUsados = [] }) {
  const telNorm = (() => {
    let t = (usuario.telefono || '').replace(/[\s\-\(\)\.+]/g, '')
    if (t.startsWith('58') && t.length >= 12) t = t.slice(2)
    if (t.startsWith('0')) t = t.slice(1)
    t = t.slice(0, 10)
    if (t.length > 3) t = t.slice(0, 3) + '-' + t.slice(3)
    return t
  })()
  const [campos, setCampos] = useState({
    nombre: usuario.nombre,
    rol: usuario.rol,
    pin: '', pinConfirm: '',
    color: usuario.color || COLORES_VENDEDOR[0],
    telefono: telNorm,
    es_externo: !!usuario.es_externo,
  })
  const [mostrarPin, setMostrarPin] = useState(false)
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    const pinLen = (campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? 4 : 6
    if (!campos.nombre.trim()) { setError('El nombre es obligatorio'); return }
    if (campos.pin && !new RegExp(`^\\d{${pinLen}}$`).test(campos.pin)) {
      setError(`El PIN debe ser exactamente ${pinLen} dígitos numéricos`)
      return
    }
    if (campos.pin && campos.pin !== campos.pinConfirm) {
      setError('Los PIN no coinciden')
      return
    }
    // Color en uso por otro usuario (excluir el color actual del propio usuario)
    const otrosColores = coloresUsados.filter(c => c !== usuario.color)
    if (otrosColores.includes(campos.color)) {
      setError('Ese color ya está en uso por otro usuario')
      return
    }
    onGuardar({
      nombre: campos.nombre,
      rol: campos.rol,
      pin: campos.pin || undefined,
      color: campos.color,
      telefono: campos.telefono.trim(),
      es_externo: campos.es_externo,
      markup_pct: null,
      comision_pct: null,
      comision_pct_cabilla: null,
    })
  }

  const inputCls = `
    w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl
    text-sm font-medium text-slate-800
    focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all
  `

  return (
    <form onSubmit={submit} className="space-y-3">
      <input value={campos.nombre} onChange={e => setCampos(p => ({ ...p, nombre: e.target.value }))}
        className={inputCls} placeholder="Nombre completo" disabled={cargando} />
      {/* Teléfono */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Phone size={14} /></div>
        <input value={campos.telefono} onChange={e => {
            let val = e.target.value.replace(/[^\d]/g, '')
            if (val.startsWith('58') && val.length > 10) val = val.slice(2)
            if (val.startsWith('0')) val = val.slice(1)
            val = val.slice(0, 10)
            if (val.length > 3) val = val.slice(0, 3) + '-' + val.slice(3)
            setCampos(p => ({ ...p, telefono: val }))
          }}
          placeholder="412-1234567" type="tel" inputMode="tel"
          className={`${inputCls} !pl-10`} disabled={cargando} />
      </div>
      <CustomSelect
        value={campos.rol}
        onChange={v => {
          setCampos(p => {
            const updates = { rol: v }
            if (v === 'jefe') {
              updates.color = COLOR_DORADO
            } else if (['administracion', 'logistica'].includes(v)) {
              updates.color = COLOR_PLATEADO
            } else if (p.color === COLOR_PLATEADO || p.color === COLOR_DORADO) {
              updates.color = COLORES_VENDEDOR.find(c => !coloresUsados.includes(c)) || COLORES_VENDEDOR[0]
            }
            if (!['vendedor', 'vendedor_sin_comision'].includes(v)) {
              updates.es_externo = false
            }
            return { ...p, ...updates }
          })
        }}
        options={[
          { value: 'vendedor', label: 'Vendedor' },
          { value: 'vendedor_sin_comision', label: 'Vendedor sin comisión' },
          { value: 'administracion', label: 'Administración' },
          { value: 'logistica', label: 'Logística' },
          { value: 'supervisor', label: 'Supervisor' },
          { value: 'jefe', label: 'Jefe' },
        ]}
        placeholder="Seleccionar rol..."
        disabled={cargando}
        searchable={false}
      />

      {/* ¿Es Vendedor Externo? */}
      {['vendedor', 'vendedor_sin_comision'].includes(campos.rol) && (
        <label className="flex items-center gap-3 bg-amber-50/50 border border-amber-200/60 p-3 rounded-xl cursor-pointer hover:bg-amber-50 transition-colors">
          <input
            type="checkbox"
            checked={campos.es_externo}
            onChange={e => setCampos(p => ({ ...p, es_externo: e.target.checked }))}
            className="w-4.5 h-4.5 border-amber-300 text-amber-600 focus:ring-amber-500 rounded cursor-pointer accent-amber-600"
            disabled={cargando}
          />
          <div className="space-y-0.5">
            <span className="text-xs font-bold text-amber-800 select-none block">¿Es Vendedor Externo?</span>
            <span className="text-[10px] text-amber-600 select-none block">Usa comisiones y recargos globales de la administración.</span>
          </div>
        </label>
      )}

      {/* Color del usuario */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-500 ml-1">Color del usuario</label>
        {['administracion', 'logistica', 'jefe'].includes(campos.rol) ? (
          <div className="text-xs font-medium text-slate-500 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
            Color fijo asignado automáticamente por el rol.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {COLORES_VENDEDOR.map(c => {
            const enUso = coloresUsados.filter(x => x !== usuario.color).includes(c)
            return (
              <button key={c} type="button"
                onClick={() => !enUso && setCampos(p => ({ ...p, color: c }))} disabled={enUso}
                className={`w-8 h-8 rounded-lg transition-all ${
                  campos.color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110'
                  : enUso ? 'opacity-20 cursor-not-allowed'
                  : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
                title={enUso ? 'En uso por otro usuario' : campos.color === c ? 'Color actual' : 'Seleccionar'} />
            )
          })}
        </div>
        )}
      </div>

      {/* PIN opcional */}
      <div className="relative">
        <input
          type={mostrarPin ? 'text' : 'password'}
          value={campos.pin}
          onChange={e => setCampos(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, (p.rol === 'vendedor' || p.rol === 'vendedor_sin_comision') ? 4 : 6) }))}
          className={`${inputCls} pr-11`}
          placeholder={`Nuevo PIN ${(campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? '4' : '6'} dígitos (vacío = no cambiar)`}
          inputMode="numeric"
          disabled={cargando}
        />
        <button type="button" onClick={() => setMostrarPin(p => !p)}
          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-sky-500 transition-colors">
          {mostrarPin ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {/* Confirmar PIN */}
      {campos.pin.length > 0 && (
        <div className="relative">
          <input
            type={mostrarPin ? 'text' : 'password'}
            value={campos.pinConfirm}
            onChange={e => setCampos(p => ({ ...p, pinConfirm: e.target.value.replace(/\D/g, '').slice(0, (p.rol === 'vendedor' || p.rol === 'vendedor_sin_comision') ? 4 : 6) }))}
            className={`${inputCls} pr-11 ${(campos.pinConfirm.length === ((campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? 4 : 6)) && campos.pinConfirm !== campos.pin ? 'border-red-300 ring-1 ring-red-200' : (campos.pinConfirm.length === ((campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? 4 : 6)) && campos.pinConfirm === campos.pin ? 'border-emerald-300 ring-1 ring-emerald-200' : ''}`}
            placeholder="Confirmar nuevo PIN"
            inputMode="numeric"
            disabled={cargando}
          />
        </div>
      )}
      {(() => { const pl = (campos.rol === 'vendedor' || campos.rol === 'vendedor_sin_comision') ? 4 : 6; return (<>
      {campos.pin.length > 0 && campos.pin.length < pl && (
        <p className="text-xs text-slate-400 ml-1">{pl - campos.pin.length} dígitos restantes</p>
      )}
      {campos.pin.length === pl && campos.pinConfirm.length === pl && campos.pin !== campos.pinConfirm && (
        <p className="text-xs text-red-500 font-medium ml-1">Los PIN no coinciden</p>
      )}
      {campos.pin.length === pl && campos.pinConfirm.length === pl && campos.pin === campos.pinConfirm && (
        <p className="text-xs text-emerald-600 font-medium ml-1">PIN confirmado</p>
      )}
      </>) })()}

      {error && <p className="text-xs text-red-500 font-bold ml-1">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-5 py-2 rounded-xl text-white text-sm font-black transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
          {cargando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

// ─── Modal crear/editar ───────────────────────────────────────────────────────
function UsuarioModal({ usuario = null, onClose, coloresUsados = [] }) {
  const crear      = useCrearUsuario()
  const actualizar = useActualizarUsuario()
  const esEdicion  = !!usuario
  const [err, setErr] = useState('')

  async function guardar(campos) {
    setErr('')
    try {
      if (esEdicion) await actualizar.mutateAsync({ id: usuario.id, ...campos })
      else           await crear.mutateAsync(campos)
      onClose()
    } catch (e) {
      setErr(e.message === 'NO_SERVICE_KEY'
        ? 'Falta VITE_SUPABASE_SERVICE_KEY en el .env para crear usuarios'
        : (e.message ?? 'Error al guardar'))
    }
  }

  const cargando = crear.isPending || actualizar.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 w-full max-w-md p-7 space-y-5 relative overflow-hidden">

        {/* Destellos decorativos */}
        <div className="absolute top-0 right-0 -mr-10 -mt-10 w-32 h-32 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(125,211,252,0.2)' }} />
        <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-32 h-32 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(94,234,212,0.15)' }} />

        <div className="relative z-10">
          <h3 className="font-black text-slate-800 text-lg mb-5">
            {esEdicion ? 'Editar usuario' : 'Nuevo usuario'}
          </h3>

          {err && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700 font-medium mb-4">
              {err}
            </div>
          )}

          {esEdicion
            ? <FormEditar usuario={usuario} onGuardar={guardar} onCancelar={onClose} cargando={cargando} coloresUsados={coloresUsados} />
            : <FormCrear  onGuardar={guardar} onCancelar={onClose} cargando={cargando} coloresUsados={coloresUsados} />
          }
        </div>
      </div>
    </div>
  )
}

// ─── Tarjeta de usuario ───────────────────────────────────────────────────────
function UsuarioCard({ usuario, propio, onEditar, onCambiarActivo, onEliminar, coloresUsados, onCambiarColor, onReasignarClientes }) {
  const conf = ROL_CONFIG[usuario.rol] ?? ROL_CONFIG.vendedor
  const esSupervisor = usuario.rol === 'jefe'
  const esExterno = !!usuario.es_externo
  const { data: config = {} } = useConfigNegocio()
  
  // Color del strip: usar colores de rol para jefe/admin/logistica (igual que login)
  const COLOR_POR_ROL = {
    jefe:           '#B8860B',   // dorado metalílico
    administracion: '#94a3b8',   // plateado
    logistica:      '#94a3b8',   // plateado
  }
  const esColorFijo = ['administracion', 'logistica', 'jefe'].includes(usuario.rol)
  const color = esExterno ? '#D97706' : (COLOR_POR_ROL[usuario.rol] || usuario.color || '#1B365D')
  const [showColors, setShowColors] = useState(false)

  const cardBorderColor = esExterno ? '#F59E0B60' : (color + '30')
  const cardShadow = esExterno ? '0 6px 20px rgba(217, 119, 6, 0.12)' : `0 1px 3px ${color}10`
  const stripBg = esExterno 
    ? 'linear-gradient(135deg, #B45309 0%, #D97706 100%)' 
    : `linear-gradient(135deg, ${color}ee 0%, ${color}99 100%)`

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden flex flex-col transition-all duration-200 ${
      usuario.activo ? 'hover:shadow-lg hover:scale-[1.01]' : 'opacity-60'
    } ${esExterno && usuario.activo ? 'ring-1 ring-amber-300/30' : ''}`}
      style={{ borderColor: cardBorderColor, boxShadow: cardShadow }}>

      {/* ── Strip superior ── */}
      <div className="relative h-20 shrink-0 flex items-center justify-center"
        style={{ background: stripBg }}>
        {/* Dot pattern */}
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />

        {/* Crown flotante encima del avatar */}
        {esSupervisor && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
            <Crown size={13} className="text-yellow-300 fill-yellow-300 drop-shadow" />
          </div>
        )}

        {/* Avatar centrado — clic para cambiar color */}
        <button type="button" 
          onClick={() => !esColorFijo && !esExterno && setShowColors(!showColors)} 
          title={esColorFijo ? "Color fijo por rol" : esExterno ? "Vendedor externo (color bronce)" : "Cambiar color"}
          className={`relative z-10 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform ${esColorFijo || esExterno ? 'cursor-default' : 'hover:scale-105 active:scale-95'}`}
          style={{ background: 'rgba(255,255,255,0.22)', border: '2px solid rgba(255,255,255,0.5)', backdropFilter: 'blur(4px)' }}>
          <span className="text-white font-black text-xl select-none leading-none">
            {(usuario.nombre || 'U')[0].toUpperCase()}
          </span>
        </button>
      </div>

      {/* ── Selector de color expandible ── */}
      {showColors && (
        <div className="px-4 pt-3 pb-1 border-b border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Cambiar color</p>
          <div className="flex flex-wrap gap-1.5">
            {COLORES_VENDEDOR.map(c => {
              const enUso = coloresUsados.includes(c) && c !== usuario.color
              return (
                <button key={c} type="button" disabled={enUso}
                  onClick={() => { onCambiarColor(usuario.id, c); setShowColors(false) }}
                  className={`w-7 h-7 rounded-lg transition-all ${
                    c === usuario.color
                      ? 'ring-2 ring-offset-1 ring-slate-500 scale-110'
                      : enUso ? 'opacity-20 cursor-not-allowed'
                      : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  title={enUso ? 'En uso por otro usuario' : c === usuario.color ? 'Color actual' : 'Seleccionar'} />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Nombre + rol + estado + fecha ── */}
      <div className="px-4 pt-3 pb-2 flex-1 space-y-2">
        {/* Nombre */}
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-black text-slate-800 truncate">{usuario.nombre}</p>
          {propio && (
            <span className="text-[8px] font-black uppercase tracking-wider bg-primary-light text-primary px-1.5 py-0.5 rounded-full shrink-0">Tú</span>
          )}
        </div>

        {/* Badge de rol */}
        <div className="flex flex-wrap gap-1.5 items-center">
          {esExterno ? (
            <span className="inline-flex text-[10px] font-black px-2 py-0.5 rounded-full border shadow-sm bg-amber-50 text-amber-700 border-amber-200">
              💼 Vendedor Externo
            </span>
          ) : (
            <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-sm ${conf.bg} ${conf.text} ${conf.border}`}
              style={usuario.rol === 'jefe' ? { textShadow: '0 0.5px 0 rgba(255,255,255,0.2)' } : {}}>
              {conf.label}
            </span>
          )}
          
          {/* Badge vendedor externo con porcentaje */}
          {esExterno && (
            <span className="inline-flex text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              Markup: +{config.markup_pct_externo ?? 5}%
            </span>
          )}
        </div>

        {/* Teléfono */}
        {usuario.telefono && (
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Phone size={11} className="shrink-0" />
            <span className="truncate">{usuario.telefono}</span>
          </div>
        )}

        {/* Estado + fecha */}
        <div className="flex items-center justify-between gap-1">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            usuario.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
          }`}>
            {usuario.activo ? 'Activo' : 'Inactivo'}
          </span>
          <span className="text-[11px] text-slate-400 shrink-0">
            {new Date(usuario.creado_en).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* ── Acciones ── */}
      {!propio ? (
        <div className="border-t border-slate-100 px-2 py-2 flex items-center flex-wrap gap-0.5">
          <button onClick={() => onEditar(usuario)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light active:bg-primary-light transition-colors whitespace-nowrap">
            <Pencil size={13} />Editar
          </button>
          <button onClick={() => onCambiarActivo(usuario, !usuario.activo)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              usuario.activo ? 'text-slate-600 hover:bg-slate-100' : 'text-emerald-600 hover:bg-emerald-50'
            }`}>
            {usuario.activo ? <UserX size={13} /> : <UserCheck size={13} />}
            {usuario.activo ? 'Desact.' : 'Activar'}
          </button>
          {/* Reasignar clientes — solo para vendedores */}
          {(usuario.rol === 'vendedor' || usuario.rol === 'vendedor_sin_comision') && (
            <button onClick={() => onReasignarClientes(usuario)} title="Reasignar todos sus clientes"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-600 hover:bg-amber-50 transition-colors whitespace-nowrap">
              <ArrowLeftRight size={13} />Reasignar
            </button>
          )}
          <button onClick={() => onEliminar(usuario)} title="Eliminar"
            className="ml-auto flex items-center justify-center p-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-50 hover:text-red-600 active:bg-red-100 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      ) : (
        <div className="border-t border-slate-100 px-2 py-2 flex items-center">
          <button onClick={() => onEditar(usuario)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary-light transition-colors whitespace-nowrap">
            <Pencil size={13} />Editar perfil
          </button>
        </div>
      )}
    </div>
  )
}

function SkeletonUsuarios() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex gap-3">
            <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100">
            <Skeleton className="h-4 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Modal de reasignación masiva de clientes ────────────────────────────────
function ModalReasignarBulk({ vendedorOrigen, vendedores, onClose, onDone }) {
  const { user } = useAuthStore()
  const [destino, setDestino] = useState('')
  const [motivo,  setMotivo]  = useState('')
  const [cargando, setCargando] = useState(false)
  const [err, setErr] = useState('')

  const opcionesDestino = vendedores.map(v => ({ value: v.id, label: v.nombre + (v.rol !== 'vendedor' ? ` (${ROL_CONFIG[v.rol]?.label || v.rol})` : '') }))

  async function confirmar() {
    if (!destino) { setErr('Selecciona un destinatario'); return }
    setCargando(true); setErr('')
    try {
      const res = await fetch(apiUrl('/api/clientes/reasignar-bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user?.id, 'x-operator-id': user?.operator_id },
        body: JSON.stringify({ vendedorOrigenId: vendedorOrigen.id, vendedorDestinoId: destino, motivo }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Error al reasignar'); return }
      onDone(data.reasignados)
    } catch (e) {
      setErr(e.message || 'Error de conexión')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-md p-7 space-y-5 relative" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-slate-800 text-lg">Reasignar clientes</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Todos los clientes de <span className="font-bold text-slate-700">{vendedorOrigen.nombre}</span> serán asignados al usuario seleccionado.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 shrink-0"><X size={18} /></button>
        </div>

        {/* Aviso */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex gap-3 items-start">
          <ArrowLeftRight size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 font-medium">Esta acción reasigna <strong>todos</strong> los clientes activos e inactivos. Se registrará en el historial de reasignaciones.</p>
        </div>

        {/* Selector destino */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Asignar a</label>
          <CustomSelect
            options={opcionesDestino}
            value={destino}
            onChange={setDestino}
            placeholder="Seleccionar usuario destino..."
          />
        </div>

        {/* Motivo opcional */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Motivo <span className="font-normal text-slate-400">(opcional)</span></label>
          <input
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ej: Vendedor se retiró, reorganización de cartera..."
            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 outline-none transition-all"
          />
        </div>

        {err && <p className="text-sm text-red-600 font-medium bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p>}

        {/* Acciones */}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={cargando || !destino}
            className="flex-1 py-2.5 rounded-xl text-sm font-black text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #D97706, #B45309)' }}>
            {cargando ? <><Loader2 size={15} className="animate-spin" />Reasignando...</> : <><ArrowLeftRight size={15} />Confirmar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────
export default function UsuariosView() {
  const { perfil } = useAuthStore()
  const [modalAbierto,     setModalAbierto]     = useState(false)
  const [editando,         setEditando]         = useState(null)
  const [confirmCambio,    setConfirmCambio]    = useState(null)
  const [confirmBorrar,    setConfirmBorrar]    = useState(null)
  const [reasignando,      setReasignando]      = useState(null) // usuario origen

  const { data: usuarios = [], isLoading, isError, refetch } = useUsuarios()
  const cambiarActivo = useCambiarActivoUsuario()
  const actualizarUsuario = useActualizarUsuario()
  const eliminar      = useEliminarUsuario()
  const qc = useQueryClient()

  // Solo contar como "en uso" los colores de roles que SÍ usan color libre (vendedor, supervisor)
  // jefe, administracion y logistica tienen colores fijos por rol — no bloquean la paleta
  const ROLES_COLOR_LIBRE = ['vendedor', 'vendedor_sin_comision', 'supervisor']
  const coloresUsados = usuarios
    .filter(u => ROLES_COLOR_LIBRE.includes(u.rol) && u.color)
    .map(u => u.color)

  function abrirNuevo()   { setEditando(null); setModalAbierto(true) }
  function abrirEditar(u) { setEditando(u);    setModalAbierto(true) }
  function cerrarModal()  { setModalAbierto(false); setEditando(null) }

  async function cambiarColor(id, color) {
    await actualizarUsuario.mutateAsync({ id, color })
    // Refrescar cotizaciones, clientes y despachos para que reflejen el nuevo color
    qc.invalidateQueries({ queryKey: COTIZACIONES_KEY })
    qc.invalidateQueries({ queryKey: CLIENTES_KEY })
    qc.invalidateQueries({ queryKey: DESPACHOS_KEY })
  }

  async function confirmarCambioActivo() {
    if (!confirmCambio) return
    try {
      await cambiarActivo.mutateAsync({ id: confirmCambio.usuario.id, activo: confirmCambio.activo })
    } finally {
      setConfirmCambio(null)
    }
  }

  async function confirmarBorrar() {
    if (!confirmBorrar) return
    try {
      await eliminar.mutateAsync({ id: confirmBorrar.id })
    } finally {
      setConfirmBorrar(null)
    }
  }

  const ROL_ORDEN = { jefe: 0, logistica: 1, administracion: 1, supervisor: 2, vendedor: 3, vendedor_sin_comision: 4 }
  const sortUsuarios = (arr) => [...arr].sort((a, b) => {
    const oa = ROL_ORDEN[a.rol] ?? 9
    const ob = ROL_ORDEN[b.rol] ?? 9
    if (oa !== ob) return oa - ob
    return (a.nombre || '').localeCompare(b.nombre || '', 'es')
  })

  const activos   = sortUsuarios(usuarios.filter(u => u.activo))
  const inactivos = sortUsuarios(usuarios.filter(u => !u.activo))

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">

      {/* Encabezado */}
      <PageHeader
        icon={UserCog}
        title="Usuarios"
        subtitle={isLoading ? 'Cargando...' : `${activos.length} activo${activos.length !== 1 ? 's' : ''}${inactivos.length > 0 ? ` · ${inactivos.length} inactivo${inactivos.length !== 1 ? 's' : ''}` : ''}`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 rounded-xl transition-colors text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button onClick={abrirNuevo}
              className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
              <Plus size={16} />Nuevo usuario
            </button>
          </div>
        }
      />

      {/* Contenido */}
      {isLoading ? (
        <SkeletonUsuarios />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-700">
          <p className="font-bold">Error al cargar usuarios</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline">Intentar de nuevo</button>
        </div>
      ) : usuarios.length === 0 ? (
        <EmptyState icon={UserCog} title="No hay usuarios" description="Crea el primer usuario del sistema." actionLabel="Nuevo usuario" onAction={abrirNuevo} />
      ) : (
        <div className="space-y-6">
          {activos.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">Activos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {activos.map(u => (
                  <UsuarioCard key={u.id} usuario={u}
                    propio={u.id === perfil?.id}
                    onEditar={abrirEditar}
                    onCambiarActivo={(usuario, activo) => setConfirmCambio({ usuario, activo })}
                    onEliminar={setConfirmBorrar}
                    coloresUsados={coloresUsados}
                    onCambiarColor={cambiarColor}
                    onReasignarClientes={setReasignando}
                  />
                ))}
              </div>
            </div>
          )}

          {inactivos.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Inactivos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {inactivos.map(u => (
                  <UsuarioCard key={u.id} usuario={u}
                    propio={u.id === perfil?.id}
                    onEditar={abrirEditar}
                    onCambiarActivo={(usuario, activo) => setConfirmCambio({ usuario, activo })}
                    onEliminar={setConfirmBorrar}
                    coloresUsados={coloresUsados}
                    onCambiarColor={cambiarColor}
                    onReasignarClientes={setReasignando}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {modalAbierto && <UsuarioModal usuario={editando} onClose={cerrarModal} coloresUsados={coloresUsados} />}

      {reasignando && (
        <ModalReasignarBulk
          vendedorOrigen={reasignando}
          vendedores={usuarios.filter(u => u.activo && u.id !== reasignando.id)}
          onClose={() => setReasignando(null)}
          onDone={() => { setReasignando(null); qc.invalidateQueries({ queryKey: CLIENTES_KEY }) }}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmCambio}
        onClose={() => setConfirmCambio(null)}
        onConfirm={confirmarCambioActivo}
        title={confirmCambio?.activo ? '¿Activar usuario?' : '¿Desactivar usuario?'}
        message={confirmCambio?.activo
          ? `"${confirmCambio?.usuario?.nombre}" podrá volver a iniciar sesión.`
          : `"${confirmCambio?.usuario?.nombre}" no podrá iniciar sesión.\nSus datos y cotizaciones se conservan.`}
        confirmText={confirmCambio?.activo ? 'Sí, activar' : 'Sí, desactivar'}
        variant={confirmCambio?.activo ? 'default' : 'danger'}
      />

      <ConfirmModal
        isOpen={!!confirmBorrar}
        onClose={() => setConfirmBorrar(null)}
        onConfirm={confirmarBorrar}
        title="¿Eliminar usuario?"
        message={`"${confirmBorrar?.nombre}" será eliminado permanentemente.\nEsta acción no se puede deshacer.`}
        confirmText="Sí, eliminar"
        variant="danger"
      />
    </div>
  )
}
