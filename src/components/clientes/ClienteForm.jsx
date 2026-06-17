// src/components/clientes/ClienteForm.jsx
// Formulario para crear o editar un cliente
// Usado dentro de un Modal — recibe onSuccess para cerrar tras guardar
import { useState, useEffect } from 'react'
import { User, Hash, Phone, Mail, MapPin, StickyNote, Loader2, Tag, Building, Briefcase } from 'lucide-react'
import { useCrearCliente, useActualizarCliente } from '../../hooks/useClientes'
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
const TIPOS_CLIENTE = [
  { valor: 'natural',   label: 'Natural' },
  { valor: 'juridico',  label: 'Jurídico' },
]

const VACIO = {
  nombre:       '',
  rif_cedula:   '',
  telefono:     '',
  email:        '',
  estado:       '',
  ciudad:       '',
  direccion:    '',
  notas:        '',
  tipo_cliente: 'natural',
  categoria:    '',
}

const PREFIJOS_RIF = ['V', 'J', 'E', 'G', 'P']

/** Separa "V24.457.713" o "J-30123456-7" en { prefijo, numero } */
function parsearRif(rif) {
  if (!rif) return { prefijo: 'V', numero: '' }
  const limpio = rif.trim().toUpperCase()
  const match = limpio.match(/^([VJEGP])-?(.*)$/)
  if (match) return { prefijo: match[1], numero: match[2].replace(/\./g, '') }
  return { prefijo: 'V', numero: limpio.replace(/\./g, '') }
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
export default function ClienteForm({ cliente = null, onSuccess, onCancel, compact = false, forzarTipoCliente = null, forzarVendedorId = null, categoriasExistentes = [] }) {
  const esEdicion = !!cliente
  const ROLES_SUGERIDOS = ['ADMINISTRADOR', 'DESPACHADOR', 'FACTURADOR', 'LOGÍSTICA', 'OPERARIO', 'VENDEDOR']
  const [rolesCustom, setRolesCustom] = useState(() => {
    try {
      const saved = localStorage.getItem('roles_personal_custom')
      return saved ? JSON.parse(saved).map(r => String(r).toUpperCase()) : []
    } catch {
      return []
    }
  })
  const listaRoles = Array.from(new Set([
    ...ROLES_SUGERIDOS,
    ...categoriasExistentes.map(r => String(r).toUpperCase()),
    ...rolesCustom
  ])).sort()

  const [campos, setCampos] = useState(VACIO)
  const [rifPrefijo, setRifPrefijo] = useState('V')
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState('')

  const crearCliente    = useCrearCliente()
  const actualizarCliente = useActualizarCliente()
  const mutation = esEdicion ? actualizarCliente : crearCliente
  const cargando = mutation.isPending

  // Cargar datos del cliente al editar o forzar tipo de cliente
  useEffect(() => {
    if (cliente) {
      // Cargar teléfono tal cual (PhoneInput se encarga de parsear)
      let tel = cliente.telefono ?? ''
      // Separar prefijo del RIF/Cédula
      const { prefijo, numero } = parsearRif(cliente.rif_cedula)
      setRifPrefijo(prefijo)
      setCampos({
        nombre:       cliente.nombre       ?? '',
        rif_cedula:   numero,
        telefono:     tel,
        email:        cliente.email        ?? '',
        estado:       cliente.estado       ?? '',
        ciudad:       cliente.ciudad       ?? '',
        direccion:    cliente.direccion    ?? '',
        notas:        cliente.notas        ?? '',
        tipo_cliente: cliente.tipo_cliente ?? 'natural',
        categoria:    cliente.categoria    ?? '',
      })
    } else if (forzarTipoCliente) {
      setCampos(prev => ({ ...prev, tipo_cliente: forzarTipoCliente }))
    }
  }, [cliente, forzarTipoCliente])

  function cambiar(e) {
    const { name, value } = e.target
    const val = name === 'nombre' ? value.replace(/(^|\s)\S/g, c => c.toUpperCase()) : value
    setCampos(prev => ({ ...prev, [name]: val }))
    // Limpiar error del campo al escribir
    if (errores[name]) setErrores(prev => ({ ...prev, [name]: '' }))
    if (errorGeneral) setErrorGeneral('')
  }

  function validar() {
    const errs = {}
    if (!campos.nombre.trim()) errs.nombre = 'El nombre es obligatorio'
    if (campos.nombre.trim() && campos.nombre.trim().length < 3) errs.nombre = 'El nombre debe tener al menos 3 caracteres'
    if (!campos.rif_cedula.trim()) {
      errs.rif_cedula = 'El RIF/Cédula es obligatorio para proteger la asignación del cliente'
    } else {
      const limpio = campos.rif_cedula.replace(/[^\d-]/g, '')
      if (rifPrefijo === 'V') {
        // Cédula venezolana: 6-9 dígitos
        if (!/^\d{6,9}$/.test(limpio)) {
          errs.rif_cedula = 'Cédula: 6 a 9 dígitos. Ej: 24457713'
        }
      } else if (rifPrefijo === 'J') {
        // RIF jurídico: 8 dígitos + guión + dígito verificador
        if (!/^\d{7,9}-\d$/.test(limpio)) {
          errs.rif_cedula = 'RIF: 8 dígitos-verificador. Ej: 30123456-7'
        }
      } else {
        // E, G, P: solo se exige que tenga al menos 4 dígitos
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
    if (campos.tipo_cliente === 'personal' && !campos.categoria.trim()) {
      errs.categoria = 'El papel/rol en la empresa es obligatorio'
    }
    // direccion: opcional
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validar()
    if (Object.keys(errs).length) { setErrores(errs); return }

    // Preparar campos finales: limpiar teléfono de espacios/guiones
    let telefonoFinal = campos.telefono.replace(/[\s\-]/g, '')
    
    // Solo añadir +58 si no tiene código (+) y parece ser un número local de Venezuela (10-11 dígitos)
    if (telefonoFinal && !telefonoFinal.startsWith('+')) {
      if (telefonoFinal.startsWith('0')) {
        telefonoFinal = `+58${telefonoFinal.slice(1)}`
      } else if (telefonoFinal.length === 10) {
        telefonoFinal = `+58${telefonoFinal}`
      }
      // Si tiene otra longitud (ej. 17164163205), lo dejamos pasar tal cual 
      // para que PhoneInput/DB lo maneje, pero lo ideal es que tenga el +
    }

    const camposFinales = {
      ...campos,
      categoria: campos.tipo_cliente === 'personal' ? (campos.categoria || '').trim().toUpperCase() : '',
      rif_cedula: formatearRif(rifPrefijo, campos.rif_cedula.trim()),
      telefono: telefonoFinal,
    }

    if (forzarVendedorId) {
      camposFinales.vendedor_id = forzarVendedorId
    }

    try {
      // Pre-check: buscar si ya existe un cliente con ese RIF/cédula (via worker, bypasses RLS)
      const rifFinal = camposFinales.rif_cedula
      if (rifFinal) {
        const params = new URLSearchParams({ rif: rifFinal })
        if (esEdicion) params.set('exclude', cliente.id)
        const res = await authFetch(`/api/clientes/check-rif?${params}`)
        if (res.ok) {
          const result = await res.json()
          if (result.existe) {
            const msg = `Ya existe un cliente con ese RIF/Cédula: "${result.nombre}" — asignado a ${result.vendedor}`
            setErrorGeneral(msg)
            showToast.error(msg)
            return
          }
        }
      }

      let resultado
      if (esEdicion) {
        resultado = await actualizarCliente.mutateAsync({ id: cliente.id, campos: camposFinales })
      } else {
        resultado = await crearCliente.mutateAsync(camposFinales)
      }
      showToast(esEdicion ? 'Cliente actualizado' : 'Cliente registrado', 'success')
      onSuccess?.(resultado)
    } catch (err) {
      const msg = err.message ?? 'Ocurrió un error. Intenta de nuevo.'
      setErrorGeneral(msg)
      showToast(msg, 'error')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">


      {/* Código del cliente (Solo en edición) */}
      {esEdicion && cliente?.codigo_cliente && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
          <span className="text-slate-500 font-semibold">Código Único del Cliente:</span>
          <span className="font-mono font-black text-slate-800 bg-white border border-slate-200 rounded px-2 py-0.5 shadow-sm">
            #{cliente.codigo_cliente}
          </span>
        </div>
      )}

      {/* Nombre */}
      <Campo label="Nombre *" icono={User} error={errores.nombre}>
        <input
          type="text"
          name="nombre"
          value={campos.nombre}
          onChange={cambiar}
          placeholder="Ej: Juan Pérez / Ferretería Central"
          className={inputClass}
          disabled={cargando}
          autoFocus
        />
      </Campo>

      {/* Tipo de cliente */}
      {!forzarTipoCliente && (
        <Campo label="Tipo de cliente *" icono={Tag} error={errores.tipo_cliente}>
          <CustomSelect
            options={TIPOS_CLIENTE.map(t => ({ value: t.valor, label: t.label }))}
            value={campos.tipo_cliente}
            onChange={val => { setCampos(prev => ({ ...prev, tipo_cliente: val })); if (val === 'natural' && rifPrefijo === 'J') setRifPrefijo('V'); if (val === 'juridico' && rifPrefijo === 'V') setRifPrefijo('J'); if (errores.tipo_cliente) setErrores(prev => ({ ...prev, tipo_cliente: '' })); if (errorGeneral) setErrorGeneral('') }}
            placeholder="Seleccionar tipo..."
            icon={Tag}
            disabled={cargando}
            searchable={false}
          />
        </Campo>
      )}

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
                // RIF jurídico: solo dígitos, auto-insertar guión antes del verificador
                let val = e.target.value.replace(/[^\d]/g, '')
                if (val.length > 10) return
                // Auto-format: 8+ dígitos → XXXXXXXX-D
                if (val.length > 8) {
                  val = val.slice(0, -1) + '-' + val.slice(-1)
                }
                cambiar({ target: { name: 'rif_cedula', value: val } })
              } else {
                // V, E, G, P: solo dígitos sin formato especial
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

      {/* Papel / Rol de personal (Sólo si es tipo_cliente === 'personal') */}
      {campos.tipo_cliente === 'personal' && (
        <Campo label="Papel / Rol en la empresa *" icono={Briefcase} error={errores.categoria}>
          <CustomSelect
            options={listaRoles.map(role => ({ value: role, label: role }))}
            value={campos.categoria}
            onChange={val => {
              const upperVal = val ? String(val).toUpperCase() : ''
              setCampos(prev => ({ ...prev, categoria: upperVal }))
              if (upperVal && !listaRoles.includes(upperVal)) {
                setRolesCustom(prev => {
                  const next = Array.from(new Set([...prev, upperVal]))
                  try {
                    localStorage.setItem('roles_personal_custom', JSON.stringify(next))
                  } catch (e) {
                    console.error(e)
                  }
                  return next
                })
              }
              if (errores.categoria) setErrores(prev => ({ ...prev, categoria: '' }))
              if (errorGeneral) setErrorGeneral('')
            }}
            placeholder="Seleccionar o escribir cargo..."
            icon={Briefcase}
            disabled={cargando}
            creatable={true}
            createLabel="Crear cargo"
            searchable={true}
          />
        </Campo>
      )}

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
          placeholder="Ej: cliente@empresa.com"
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

      {/* Dirección (línea específica) */}
      <Campo label="Dirección" icono={MapPin} error={errores.direccion}>
        <input
          type="text"
          name="direccion"
          value={campos.direccion}
          onChange={cambiar}
          placeholder="Ej: Av. Principal, Edif. Torre, Piso 3, Local 2"
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
          placeholder="Observaciones sobre el cliente..."
          className={`${inputClass} resize-none`}
          disabled={cargando}
        />
      </Campo>

      {/* Error general — abajo cerca del botón de acción para mejor visibilidad */}
      {errorGeneral && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 font-medium animate-pulse">
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
          className={`flex-1 py-2.5 px-4 rounded-xl text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
            compact
              ? 'bg-emerald-500 hover:bg-emerald-600'
              : 'bg-primary hover:bg-primary-hover'
          }`}
        >
          {cargando
            ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
            : esEdicion ? 'Guardar cambios' : compact ? 'Crear y seleccionar' : 'Crear cliente'
          }
        </button>
      </div>

    </form>
  )
}
