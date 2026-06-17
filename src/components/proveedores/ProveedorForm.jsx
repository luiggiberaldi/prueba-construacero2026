// src/components/proveedores/ProveedorForm.jsx
// Formulario para crear o editar un proveedor
// Usado dentro de un Modal — recibe onSuccess para cerrar tras guardar
import { useState, useEffect } from 'react'
import { User, Hash, Phone, Mail, MapPin, StickyNote, Loader2, Tag, Building } from 'lucide-react'
import { useCrearProveedor, useActualizarProveedor } from '../../hooks/useProveedores'
import { authFetch } from '../../services/authFetch'
import CustomSelect from '../ui/CustomSelect'
import { ESTADOS, getCiudades } from '../../data/venezuelaGeo'
import PhoneInput from '../ui/PhoneInput'
import { showToast } from '../ui/Toast'

// ─── Campo de formulario reutilizable ─────────────────────────────────────────
function Campo({ label, icono: Icono, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {Icono && <Icono size={14} className="text-slate-400" />}
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// ─── Estilo base de input ─────────────────────────────────────────────────────
const inputClass = `
  w-full px-3 py-2.5 rounded-xl border text-sm text-slate-800
  bg-slate-50 border-slate-200
  focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary
  placeholder:text-slate-400
  transition-colors relative
`

// ─── Valores iniciales vacíos ─────────────────────────────────────────────────
const TIPOS_PROVEEDOR = [
  { valor: 'natural',   label: 'Natural' },
  { valor: 'juridico',  label: 'Jurídico' },
]

const VACIO = {
  nombre:         '',
  rif_cedula:     '',
  telefono:       '',
  email:          '',
  estado:         '',
  ciudad:         '',
  direccion:      '',
  notas:          '',
  tipo_proveedor: 'juridico',
}

const PREFIJOS_RIF = ['V', 'J', 'E', 'G', 'P']

/** Separa "V24.457.713" o "J-30123456-7" en { prefijo, numero } */
function parsearRif(rif) {
  if (!rif) return { prefijo: 'J', numero: '' }
  const limpio = rif.trim().toUpperCase()
  const match = limpio.match(/^([VJEGP])-?(.*)$/)
  if (match) return { prefijo: match[1], numero: match[2].replace(/\./g, '') }
  return { prefijo: 'J', numero: limpio.replace(/\./g, '') }
}

/** Formatea número con puntos de miles: 24457713 → 24.457.713 */
function formatearConPuntos(num) {
  const limpio = num.replace(/\D/g, '')
  return limpio.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Combina prefijo + número en formato final */
function formatearRif(prefijo, numero) {
  const limpio = numero.replace(/[^\d-]/g, '')
  if (!limpio) return ''
  if (prefijo === 'V') {
    // Cédula venezolana: V24.457.713 (sin guión, con puntos)
    return `V${formatearConPuntos(limpio)}`
  }
  if (prefijo === 'J') {
    // RIF jurídico: J-30123456-7 (con guión verificador)
    return `J-${limpio}`
  }
  // E, G, P: número simple sin formato especial
  return `${prefijo}${limpio}`
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ProveedorForm({ proveedor = null, onSuccess, onCancel, compact = false }) {
  const esEdicion = !!proveedor

  const [campos, setCampos] = useState(VACIO)
  const [rifPrefijo, setRifPrefijo] = useState('J')
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState('')

  const crearProveedor      = useCrearProveedor()
  const actualizarProveedor = useActualizarProveedor()
  const mutation = esEdicion ? actualizarProveedor : crearProveedor
  const cargando = mutation.isPending

  // Cargar datos del proveedor al editar
  useEffect(() => {
    if (proveedor) {
      let tel = proveedor.telefono ?? ''
      // Separar prefijo del RIF/Cédula
      const { prefijo, numero } = parsearRif(proveedor.rif_cedula)
      setRifPrefijo(prefijo)
      setCampos({
        nombre:         proveedor.nombre         ?? '',
        rif_cedula:     numero,
        telefono:       tel,
        email:          proveedor.email          ?? '',
        estado:         proveedor.estado         ?? '',
        ciudad:         proveedor.ciudad         ?? '',
        direccion:      proveedor.direccion      ?? '',
        notas:          proveedor.notas          ?? '',
        tipo_proveedor: proveedor.tipo_proveedor ?? 'juridico',
      })
    }
  }, [proveedor])

  function cambiar(e) {
    const { name, value } = e.target
    // Capitalización del nombre
    const val = name === 'nombre' ? value.replace(/(^|\s)\S/g, c => c.toUpperCase()) : value
    setCampos(prev => ({ ...prev, [name]: val }))
    if (errores[name]) setErrores(prev => ({ ...prev, [name]: '' }))
    if (errorGeneral) setErrorGeneral('')
  }

  function validar() {
    const errs = {}
    if (!campos.nombre.trim()) errs.nombre = 'El nombre es obligatorio'
    if (campos.nombre.trim() && campos.nombre.trim().length < 3) errs.nombre = 'El nombre debe tener al menos 3 caracteres'
    if (!campos.rif_cedula.trim()) {
      errs.rif_cedula = 'El RIF/Cédula es obligatorio'
    } else {
      const limpio = campos.rif_cedula.replace(/[^\d-]/g, '')
      if (rifPrefijo === 'V') {
        if (!/^\d{6,9}$/.test(limpio)) {
          errs.rif_cedula = 'Cédula: 6 a 9 dígitos. Ej: 24457713'
        }
      } else if (rifPrefijo === 'J') {
        if (!/^\d{7,9}-\d$/.test(limpio)) {
          errs.rif_cedula = 'RIF: 8 dígitos-verificador. Ej: 30123456-7'
        }
      } else {
        if (!/^\d{4,}$/.test(limpio)) {
          errs.rif_cedula = 'Ingresa al menos 4 dígitos'
        }
      }
    }
    if (campos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campos.email.trim())) {
      errs.email = 'Correo inválido'
    }
    if (!campos.telefono.trim()) {
      errs.telefono = 'El teléfono es obligatorio'
    } else {
      const telLimpio = campos.telefono.replace(/[^\d+]/g, '')
      if (telLimpio.length < 8) {
        errs.telefono = 'Número demasiado corto'
      }
    }
    if (!campos.estado) {
      errs.estado = 'Selecciona un estado'
    }
    if (!campos.ciudad) {
      errs.ciudad = 'Selecciona una ciudad'
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validar()
    if (Object.keys(errs).length) { setErrores(errs); return }

    let telefonoFinal = campos.telefono.replace(/[\s\-]/g, '')
    if (telefonoFinal && !telefonoFinal.startsWith('+')) {
      if (telefonoFinal.startsWith('0')) {
        telefonoFinal = `+58${telefonoFinal.slice(1)}`
      } else if (telefonoFinal.length === 10) {
        telefonoFinal = `+58${telefonoFinal}`
      }
    }

    const camposFinales = {
      ...campos,
      rif_cedula: formatearRif(rifPrefijo, campos.rif_cedula.trim()),
      telefono: telefonoFinal,
    }

    try {
      // Pre-check RIF duplicado
      const rifFinal = camposFinales.rif_cedula
      if (rifFinal) {
        const params = new URLSearchParams({ rif: rifFinal })
        if (esEdicion) params.set('exclude', proveedor.id)
        const res = await authFetch(`/api/proveedores/check-rif?${params}`)
        if (res.ok) {
          const result = await res.json()
          if (result.existe) {
            const msg = `Ya existe un proveedor activo con ese RIF/Cédula: "${result.nombre}"`
            setErrorGeneral(msg)
            showToast.error(msg)
            return
          }
        }
      }

      let resultado
      if (esEdicion) {
        resultado = await actualizarProveedor.mutateAsync({ id: proveedor.id, campos: camposFinales })
      } else {
        resultado = await crearProveedor.mutateAsync(camposFinales)
      }
      showToast(esEdicion ? 'Proveedor actualizado' : 'Proveedor registrado', 'success')
      onSuccess?.(resultado)
    } catch (err) {
      const msg = err.message ?? 'Ocurrió un error. Intenta de nuevo.'
      setErrorGeneral(msg)
      showToast(msg, 'error')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">

      {/* Nombre */}
      <Campo label="Nombre *" icono={User} error={errores.nombre}>
        <input
          type="text"
          name="nombre"
          value={campos.nombre}
          onChange={cambiar}
          placeholder="Ej: Aceros Nacionales C.A."
          className={inputClass}
          disabled={cargando}
          autoFocus
        />
      </Campo>

      {/* Tipo de proveedor */}
      <Campo label="Tipo de proveedor *" icono={Tag} error={errores.tipo_proveedor}>
        <CustomSelect
          options={TIPOS_PROVEEDOR.map(t => ({ value: t.valor, label: t.label }))}
          value={campos.tipo_proveedor}
          onChange={val => {
            setCampos(prev => ({ ...prev, tipo_proveedor: val }))
            if (val === 'natural' && rifPrefijo === 'J') setRifPrefijo('V')
            if (val === 'juridico' && rifPrefijo === 'V') setRifPrefijo('J')
            if (errores.tipo_proveedor) setErrores(prev => ({ ...prev, tipo_proveedor: '' }))
            if (errorGeneral) setErrorGeneral('')
          }}
          placeholder="Seleccionar tipo..."
          icon={Tag}
          disabled={cargando}
          searchable={false}
        />
      </Campo>

      {/* RIF / Cédula */}
      <Campo label="RIF / Cédula *" icono={Hash} error={errores.rif_cedula}>
        <div className="flex gap-1.5 mb-2">
          {PREFIJOS_RIF.map(p => (
            <button
              key={p}
              type="button"
              disabled={cargando}
              onClick={() => { setRifPrefijo(p); if (errores.rif_cedula) setErrores(prev => ({ ...prev, rif_cedula: '' })) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                rifPrefijo === p
                  ? 'bg-primary text-white shadow-sm scale-105'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              } disabled:opacity-50`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="relative flex items-center">
          <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 select-none h-[42px]">
            {rifPrefijo}{rifPrefijo === 'J' ? '-' : ''}
          </span>
          <input
            type="text"
            name="rif_cedula"
            value={campos.rif_cedula}
            onChange={e => {
              if (rifPrefijo === 'J') {
                let val = e.target.value.replace(/[^\d]/g, '')
                if (val.length > 10) return
                if (val.length > 8) {
                  val = val.slice(0, -1) + '-' + val.slice(-1)
                }
                cambiar({ target: { name: 'rif_cedula', value: val } })
              } else {
                let val = e.target.value.replace(/\D/g, '')
                if (val.length > 12) return
                cambiar({ target: { name: 'rif_cedula', value: val } })
              }
            }}
            placeholder={rifPrefijo === 'J' ? '301234567' : '24457713'}
            className={`${inputClass} rounded-l-none`}
            disabled={cargando}
            inputMode="numeric"
          />
        </div>
      </Campo>

      {/* Teléfono */}
      <Campo label="Teléfono *" icono={Phone} error={errores.telefono}>
        <PhoneInput
          value={campos.telefono}
          onChange={val => {
            setCampos(prev => ({ ...prev, telefono: val }))
            if (errores.telefono) setErrores(prev => ({ ...prev, telefono: '' }))
            if (errorGeneral) setErrorGeneral('')
          }}
          disabled={cargando}
        />
        <p className="text-[10px] text-slate-400 mt-1">Ingresa el número sin el cero inicial si es de Venezuela</p>
      </Campo>

      {/* Email */}
      <Campo label="Correo electrónico" icono={Mail} error={errores.email}>
        <input
          type="email"
          name="email"
          value={campos.email}
          onChange={cambiar}
          placeholder="Ej: ventas@proveedor.com"
          className={inputClass}
          disabled={cargando}
        />
      </Campo>

      {/* Estado y Ciudad */}
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Estado *" icono={MapPin} error={errores.estado}>
          <CustomSelect
            options={ESTADOS.map(e => ({ value: e, label: e }))}
            value={campos.estado}
            onChange={val => {
              setCampos(prev => ({ ...prev, estado: val, ciudad: '' }))
              if (errores.estado) setErrores(prev => ({ ...prev, estado: '' }))
              if (errores.ciudad) setErrores(prev => ({ ...prev, ciudad: '' }))
              if (errorGeneral) setErrorGeneral('')
            }}
            placeholder="Seleccionar..."
            icon={MapPin}
            disabled={cargando}
            searchable
          />
        </Campo>

        <Campo label="Ciudad *" icono={Building} error={errores.ciudad}>
          <CustomSelect
            options={(campos.estado ? getCiudades(campos.estado) : []).map(c => ({ value: c, label: c }))}
            value={campos.ciudad}
            onChange={val => {
              setCampos(prev => ({ ...prev, ciudad: val }))
              if (errores.ciudad) setErrores(prev => ({ ...prev, ciudad: '' }))
              if (errorGeneral) setErrorGeneral('')
            }}
            placeholder={campos.estado ? 'Seleccionar...' : 'Elige estado primero'}
            icon={Building}
            disabled={cargando || !campos.estado}
            searchable
          />
        </Campo>
      </div>

      {/* Dirección */}
      <Campo label="Dirección" icono={MapPin} error={errores.direccion}>
        <input
          type="text"
          name="direccion"
          value={campos.direccion}
          onChange={cambiar}
          placeholder="Ej: Zona Industrial I, Calle A, Galpón 4"
          className={inputClass}
          disabled={cargando}
          autoComplete="off"
          autoCorrect="off"
        />
      </Campo>

      {/* Notas */}
      <Campo label="Notas" icono={StickyNote} error={errores.notas}>
        <textarea
          name="notas"
          value={campos.notas}
          onChange={cambiar}
          rows={3}
          placeholder="Observaciones sobre el proveedor..."
          className={`${inputClass} resize-none`}
          disabled={cargando}
        />
      </Campo>

      {/* Error general */}
      {errorGeneral && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 font-medium">
          {errorGeneral}
        </div>
      )}

      {/* Botones */}
      <div className={`flex gap-3 pt-4 pb-4 ${compact ? '' : 'sticky bottom-0 bg-white'}`}>
        <button
          type="button"
          onClick={onCancel}
          disabled={cargando}
          className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={cargando}
          className="flex-1 py-2.5 px-4 rounded-xl text-white font-semibold text-sm bg-primary hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {cargando
            ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
            : esEdicion ? 'Guardar cambios' : 'Crear proveedor'
          }
        </button>
      </div>

    </form>
  )
}
