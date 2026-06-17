// src/components/cotizaciones/CotizacionBuilder.jsx
// Constructor de cotizaciones — wizard de 4 pasos
// Paso 1: Seleccionar/crear cliente
// Paso 2: Agregar productos
// Paso 3: Descuentos, envío, notas y resumen
// Paso 4: Confirmación (post-envío) con PDF y WhatsApp
import { useState, useEffect, useRef, useMemo } from 'react'
import {
  User, Truck, Plus, Trash2, UserPlus, ChevronDown, X,
  Save, Send, ArrowLeft, ArrowRight, Loader2, AlertCircle, AlertTriangle, DollarSign, RefreshCw,
  CheckCircle, MessageCircle, StickyNote, Tag, Hash, Phone, Mail, MapPin,
  Eye, Package, Printer, Edit2, Clock, Undo2, ShoppingCart,
} from 'lucide-react'
import { useClientes, useVendedores } from '../../hooks/useClientes'
import { useInventario } from '../../hooks/useInventario'
import { useTransportistas, useCrearTransportista }   from '../../hooks/useTransportistas'
import { useGuardarBorrador, useEnviarCotizacion } from '../../hooks/useCotizaciones'
import { useTasaCambio }       from '../../hooks/useTasaCambio'
import { useConfigNegocio }    from '../../hooks/useConfigNegocio'
import useAuthStore            from '../../store/useAuthStore'
import { compartirPorWhatsApp, generarMensaje } from '../../utils/whatsapp'
import { round2, mulR } from '../../utils/dinero'
import { calcTotales } from '../../utils/calcTotales'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs, fmtTelefono } from '../../utils/format'
import { showToast } from '../ui/Toast'
import { calcComisionEstimada } from '../../utils/comisionUtils'
import { usePrecioVendedor } from '../../hooks/usePrecioVendedor'

import supabase from '../../services/supabase/client'
import CustomSelect from '../ui/CustomSelect'
import ClienteForm from '../clientes/ClienteForm'
import ScanMaterialListModal from './ScanMaterialListModal'
import BuscadorProductos from './CotizacionBuscador'
import ClienteSelector from './CotizacionClienteSelector'
import CestaPanel, { SectionH3 } from './CotizacionCesta'
import DetalleModal from '../ui/DetalleModal'

// ─── Helpers ─────────────────────────────────────────────────────────────────
let _itemCounter = 0

const STEP_LABELS = ['Cliente', 'Productos', 'Resumen', 'Enviada']

// ─── Auto-guardado en localStorage (por usuario y negocio) ────────────────
const DRAFT_KEY_BASE = 'listopos_cotizacion_draft'

function getDraftKey(userId) {
  // Obtenemos el businessId del store de auth para el sufijo
  const state = useAuthStore.getState()
  const businessId = state.perfil?.cuenta_id
  const suffix = businessId ? `-${businessId}` : ''
  
  if (!userId) return `${DRAFT_KEY_BASE}${suffix}`
  return `${DRAFT_KEY_BASE}_${userId}${suffix}`
}

function saveDraft(state, userId) {
  try {
    const clienteNombre = state._clienteNombre || ''
    const totalUsd = state._totalUsd ?? 0
    const itemsCount = state._itemsCount ?? state.items?.length ?? 0
    localStorage.setItem(getDraftKey(userId), JSON.stringify({
      ...state,
      _ts: Date.now(),
      _userId: userId,
      _clienteNombre: clienteNombre,
      _totalUsd: totalUsd,
      _itemsCount: itemsCount,
    }))
  } catch {}
}

function loadDraft(userId) {
  try {
    const key = getDraftKey(userId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const draft = JSON.parse(raw)
    // Expirar después de 24h
    if (Date.now() - draft._ts > 24 * 60 * 60 * 1000) { localStorage.removeItem(key); return null }
    // Verificar que el draft pertenece al usuario actual
    if (draft._userId && draft._userId !== userId) { localStorage.removeItem(key); return null }
    return draft
  } catch { return null }
}

function clearDraft(userId) {
  try {
    localStorage.removeItem(getDraftKey(userId))
    // También limpiar el draft viejo sin userId (migración)
    localStorage.removeItem(DRAFT_KEY_BASE)
  } catch {}
}

function formatRelativeTime(ts) {
  if (!ts) return ''
  const diffMs = Date.now() - ts
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'hace un instante'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH}h`
  return 'hace más de 1 día'
}

// ─── Indicador de pasos ──────────────────────────────────────────────────────
function StepIndicator({ paso, totalPasos = 4 }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {Array.from({ length: totalPasos }).map((_, i) => {
        const step = i + 1
        const isActive = step === paso
        const isDone   = step < paso
        return (
          <div key={step} className="flex items-center gap-1 sm:gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all ${
              isDone ? 'bg-emerald-100 text-emerald-700' : !isActive ? 'bg-slate-100 text-slate-400' : ''
            }`}
              style={isActive ? {
                background: 'linear-gradient(135deg, #1B365D, #B8860B)',
                color: 'white',
                boxShadow: '0 2px 8px rgba(27,54,93,0.3)',
              } : undefined}>
              {isDone ? <CheckCircle size={12} /> : <span>{step}</span>}
              <span className="hidden sm:inline">{STEP_LABELS[i]}</span>
            </div>
            {i < totalPasos - 1 && (
              <div className={`w-4 sm:w-8 h-0.5 rounded-full transition-colors ${
                step < paso ? 'bg-emerald-300' : 'bg-slate-200'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}





// ─── Modal de envío (con tasa auto/manual) ──────────────────────────────────
function ModalEnvio({ isOpen, onConfirm, onCancel, cargando, tasaHook }) {
  const { tasaBcv, tasaUsdt, tasaEfectiva, modoTasa, setModoTasa, tasaManual, setTasaManual, cargando: tasaCargando, refrescar } = tasaHook
  const [error, setError] = useState('')

  if (!isOpen) return null

  function confirmar() {
    if (!tasaEfectiva || tasaEfectiva <= 0) {
      setError('La tasa debe ser mayor a 0')
      return
    }
    onConfirm(tasaEfectiva)
  }

  const fmtBs = n => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-[calc(100vw-1.5rem)] sm:max-w-sm p-4 sm:p-6 space-y-4">
        <h3 className="font-black text-slate-800 text-lg">Enviar cotización</h3>
        <p className="text-sm text-slate-500">
          Confirma la tasa de cambio para registrar el equivalente en bolívares.
        </p>

        {/* Selector de modo: BCV / USDT / Manual */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Tasa de cambio</span>
            <button onClick={refrescar} disabled={tasaCargando}
              className="p-1.5 rounded-lg hover:bg-white text-slate-400 hover:text-emerald-600 transition-colors">
              <RefreshCw size={14} className={tasaCargando ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 3 botones de modo */}
          <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200">
            <button onClick={() => setModoTasa('bcv')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${modoTasa === 'bcv' ? 'bg-white text-emerald-600 shadow-sm border border-emerald-200' : 'text-slate-400 hover:text-slate-600'}`}>
              BCV
            </button>
            <button onClick={() => setModoTasa('usdt')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${modoTasa === 'usdt' ? 'bg-white text-indigo-600 shadow-sm border border-indigo-200' : 'text-slate-400 hover:text-slate-600'}`}>
              USDT
            </button>
            <button onClick={() => setModoTasa('manual')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${modoTasa === 'manual' ? 'bg-white text-amber-600 shadow-sm border border-amber-200' : 'text-slate-400 hover:text-slate-600'}`}>
              Manual
            </button>
          </div>

          {/* Info del modo activo */}
          {modoTasa === 'bcv' && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-black text-emerald-600">{fmtBs(tasaBcv.precio)} <span className="text-xs font-medium text-slate-400">Bs/$</span></p>
                <p className="text-[10px] text-slate-400">
                  {tasaBcv.fuente || 'Sin datos'}
                  {tasaBcv.ultimaActualizacion && ` · ${new Date(tasaBcv.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
            </div>
          )}

          {modoTasa === 'usdt' && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-black text-indigo-600">{fmtBs(tasaUsdt?.precio || 0)} <span className="text-xs font-medium text-slate-400">Bs/$</span></p>
                <p className="text-[10px] text-slate-400">
                  {tasaUsdt?.fuente || 'Sin datos'}
                  {tasaUsdt?.ultimaActualizacion && ` · ${new Date(tasaUsdt.ultimaActualizacion).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
            </div>
          )}

          {modoTasa === 'manual' && (
            <div className="space-y-1.5">
              <input type="number" min="0.01" step="0.01"
                value={tasaManual}
                onChange={e => { setTasaManual(e.target.value); setError('') }}
                placeholder="Ej: 48.50"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary-focus"
                autoFocus
              />
              <div className="flex gap-3 text-[10px] text-slate-400">
                {tasaBcv.precio > 0 && <span>BCV: {fmtBs(tasaBcv.precio)}</span>}
                {tasaUsdt?.precio > 0 && <span>USDT: {fmtBs(tasaUsdt.precio)}</span>}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button onClick={onCancel} disabled={cargando}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={cargando || tasaEfectiva <= 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {cargando ? <><Loader2 size={15} className="animate-spin" />Enviando...</> : 'Confirmar envío'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: confirmar despacho con stock insuficiente ────────────────────────
function ModalConfirmarDespacho({ isOpen, items, stockMap, onConfirmar, onCancelar }) {
  if (!isOpen || items.length === 0) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-[calc(100vw-1.5rem)] sm:max-w-md p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <div>
            <h3 className="font-black text-slate-800 text-base">Stock insuficiente</h3>
            <p className="text-xs text-slate-500">Los siguientes productos no tienen stock suficiente. ¿Deseas despachar igualmente?</p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-amber-100">
                <th className="text-left px-3 py-2 text-xs font-bold text-amber-800">Producto</th>
                <th className="text-center px-3 py-2 text-xs font-bold text-amber-800">Stock actual</th>
                <th className="text-center px-3 py-2 text-xs font-bold text-amber-800">Cant. cotizada</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it._key} className="border-t border-amber-200">
                  <td className="px-3 py-2 text-xs text-slate-700 font-medium leading-snug">{it.nombreSnap}</td>
                  <td className="px-3 py-2 text-xs text-center font-black text-red-600">{stockMap[it.productoId] ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-center font-black text-slate-800">{it.cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirmar}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
            <Truck size={14} />
            Despachar igualmente
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── Componente principal (Wizard) ───────────────────────────────────────────

// ─── Selector de transportista con opción de crear nuevo ─────────────────────
const PREFIJOS_RIF_CB = ['V', 'J', 'E', 'G', 'P']

function parsearRifCB(rif) {
  if (!rif) return { prefijo: 'V', numero: '' }
  const limpio = rif.trim().toUpperCase()
  const match = limpio.match(/^([VJEGP])-?(.*)$/)
  if (match) return { prefijo: match[1], numero: match[2].replace(/\./g, '') }
  return { prefijo: 'V', numero: limpio.replace(/\./g, '') }
}

function formatearRifCB(prefijo, numero) {
  const limpio = numero.replace(/[^\d-]/g, '')
  if (!limpio) return ''
  if (prefijo === 'V') return `V${limpio.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
  return `${prefijo}-${limpio}`
}

function TransportistaSelector({ transportistas, transportistaId, setTransportistaId, disabled }) {
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState('')
  const crearTransp = useCrearTransportista()

  // Compact form state
  const [rifPrefijo, setRifPrefijo] = useState('V')
  const [rifNumero, setRifNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState('')
  const [vehiculo, setVehiculo] = useState('')
  const [placaChuto, setPlacaChuto] = useState('')
  const [placaBatea, setPlacaBatea] = useState('')

  async function handleCrear(e) {
    e.preventDefault()
    if (!nombre.trim()) { setFormError('El nombre es obligatorio'); return }
    setFormError('')
    try {
      const nuevo = await crearTransp.mutateAsync({
        nombre,
        rif: formatearRifCB(rifPrefijo, rifNumero),
        color,
        vehiculo,
        placa_chuto: placaChuto,
        placa_batea: placaBatea,
      })
      if (!nuevo?.id) throw new Error('No se pudo obtener el ID del transportista creado')
      setTransportistaId(nuevo.id)
      setShowForm(false)
      setRifPrefijo('V'); setRifNumero(''); setNombre(''); setColor('')
      setVehiculo(''); setPlacaChuto(''); setPlacaBatea('')
      showToast('Transportista creado y seleccionado', 'success')
    } catch (e) {
      setFormError(e.message ?? 'Error al crear')
    }
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Transportista</label>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <CustomSelect
            value={transportistaId}
            onChange={setTransportistaId}
            placeholder="— Sin transportista —"
            clearable
            icon={Truck}
            options={transportistas.map(t => ({
              value: t.id,
              label: t.nombre,
              sub: t.vehiculo || undefined,
            }))}
          />
        </div>
        <button type="button"
          onClick={() => setShowForm(!showForm)}
          disabled={disabled}
          className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
          title="Crear nuevo transportista">
          <Plus size={16} className="text-emerald-600" />
        </button>
      </div>
      {showForm && (
        <div className="mt-2 bg-white rounded-2xl border-2 border-emerald-200 shadow-lg p-3 sm:p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 mb-3">
            <Truck size={14} className="text-emerald-500" />
            <span className="text-sm font-bold text-slate-700">Nuevo transportista</span>
          </div>
          {formError && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700 mb-3">{formError}</div>}
          <form onSubmit={handleCrear} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Nombre *</label>
                <input value={nombre} onChange={e => { setNombre(e.target.value.replace(/(^|\s)\S/g, c => c.toUpperCase())); setFormError('') }}
                  placeholder="Nombre del transportista" className={inputCls} disabled={crearTransp.isPending} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Cédula / RIF</label>
                <div className="flex gap-1 mb-1">
                  {PREFIJOS_RIF_CB.map(p => (
                    <button key={p} type="button" disabled={crearTransp.isPending}
                      onClick={() => setRifPrefijo(p)}
                      className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                        rifPrefijo === p ? 'bg-primary text-white shadow-sm scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      } disabled:opacity-50`}>
                      {p}
                    </button>
                  ))}
                </div>
                <div className="flex items-center">
                  <span className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 select-none h-[42px]">
                    {rifPrefijo}{rifPrefijo !== 'V' ? '-' : ''}
                  </span>
                  <input value={rifNumero} onChange={e => {
                    if (rifPrefijo === 'V') {
                      setRifNumero(e.target.value.replace(/\D/g, '').slice(0, 9))
                    } else {
                      const val = e.target.value.replace(/[^\d-]/g, '')
                      if (val.replace(/-/g, '').length > 10) return
                      setRifNumero(val)
                    }
                  }}
                    placeholder={rifPrefijo === 'V' ? '24457713' : '30123456-7'}
                    className={`${inputCls} !rounded-l-none`} disabled={crearTransp.isPending} inputMode="numeric" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Color</label>
                <input value={color} onChange={e => setColor(e.target.value)}
                  placeholder="Ej: Rojo, Blanco" className={inputCls} disabled={crearTransp.isPending} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Vehículo</label>
                <input value={vehiculo} onChange={e => setVehiculo(e.target.value)}
                  placeholder="Ej: Mack Granite 2020" className={inputCls} disabled={crearTransp.isPending} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Placa chuto</label>
                <input value={placaChuto} onChange={e => setPlacaChuto(e.target.value.toUpperCase())}
                  placeholder="Ej: AB123CD" className={inputCls} disabled={crearTransp.isPending} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Placa batea</label>
                <input value={placaBatea} onChange={e => setPlacaBatea(e.target.value.toUpperCase())}
                  placeholder="Ej: XY456ZW" className={inputCls} disabled={crearTransp.isPending} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setShowForm(false); setFormError('') }} disabled={crearTransp.isPending}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button type="submit" disabled={crearTransp.isPending}
                className="px-3 py-2 rounded-xl text-white text-xs font-semibold transition-colors disabled:opacity-50"
                style={{ background: '#1B365D' }}>
                {crearTransp.isPending ? 'Creando...' : 'Crear transportista'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default function CotizacionBuilder({ cotizacionExistente = null, clientePreseleccionado = null, onVolver, onGuardado, onDespachar }) {
  const esEdicion = !!cotizacionExistente
  const { perfil } = useAuthStore()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const { aplicarMarkup, esExterno: esVendedorExterno } = usePrecioVendedor()

  // Queries & Hooks
  const { data: clientes      = [], refetch: refetchClientes } = useClientes()
  const { data: transportistas = [] } = useTransportistas()
  const { data: vendedores     = [] } = useVendedores()
  const { data: config = {} }  = useConfigNegocio()
  const guardarBorrador  = useGuardarBorrador()
  const enviarCotizacion = useEnviarCotizacion()
  const tasaHook         = useTasaCambio()
  const { data: inventarioParaPrecios } = useInventario({ pageSize: 1000 })

  // Paso actual del wizard (1-4)
  const [paso, setPaso] = useState(esEdicion ? 2 : 1)
  const [showCrearCliente, setShowCrearCliente] = useState(false)
  const [showScanModal, setShowScanModal] = useState(false)

  // Estado del formulario
  const [vendedorId,         setVendedorId]         = useState(cotizacionExistente?.vendedor_id ?? '')
  const [clienteId,          setClienteId]          = useState(cotizacionExistente?.cliente_id ?? clientePreseleccionado ?? '')
  const [transportistaId,    setTransportistaId]    = useState(cotizacionExistente?.transportista_id ?? '')
  const [notasCliente,       setNotasCliente]       = useState(cotizacionExistente?.notas_cliente ?? '')
  const [notasInternas,      setNotasInternas]      = useState(cotizacionExistente?.notas_internas ?? '')
  const [monedaPDF,          setMonedaPDFRaw]       = useState(() => {
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const key = `listopos_moneda_pdf${businessId ? `-${businessId}` : ''}`
    return localStorage.getItem(key) || '$'
  })
  const setMonedaPDF = (v) => { 
    const businessId = useAuthStore.getState().perfil?.cuenta_id
    const key = `listopos_moneda_pdf${businessId ? `-${businessId}` : ''}`
    setMonedaPDFRaw(v); 
    localStorage.setItem(key, v) 
  }
  const descuentoGlobalPct = 0 // Discount disabled — always 0
  const [costoEnvioUsd,      setCostoEnvioUsd]      = useState(cotizacionExistente?.costo_envio_usd ?? 0)
  const [corteUsd,           setCorteUsd]           = useState(cotizacionExistente?.corte_usd ?? 0)
  const [items,              setItems]              = useState(
    (cotizacionExistente?.items ?? []).map(it => {
      const precioBase = Number(it.precio_unit_usd)
      return {
        _key:          `item-${++_itemCounter}`,
        productoId:    it.producto_id,
        codigoSnap:    it.codigo_snap,
        nombreSnap:    it.nombre_snap,
        unidadSnap:    it.unidad_snap,
        cantidad:      Number(it.cantidad),
        precioUnitUsd: precioBase,
        precioOriginalUsd: precioBase,
        descuentoPct:  0, // Discount disabled — always 0
        origen:        it.producto_id ? (it.origen || 'inventario') : 'externo',
      }
    })
  )

  const [errorGeneral,  setErrorGeneral]  = useState('')
  const [showModalDespachar, setShowModalDespachar] = useState(false)
  const [cotizacionId,  setCotizacionId]  = useState(cotizacionExistente?.id ?? null)

  // Estado post-envío (para paso 4)
  const [enviada, setEnviada] = useState(false)
  const [numDisplay, setNumDisplay] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [printLoading, setPrintLoading] = useState(false)
  const [waLoading, setWaLoading]   = useState(false)
  const [showResumen, setShowResumen] = useState(false)
  const [editItemIdx, setEditItemIdx] = useState(null)
  const [conIva, setConIva] = useState(() => localStorage.getItem('listopos_con_iva') === 'true')

  const prevClienteIdRef = useRef(clienteId)

  const initializedRef = useRef(false)
  useEffect(() => {
    if (esEdicion && cotizacionExistente && config && !initializedRef.current) {
      const descPct = config.descuento_personal_pct ?? 10.00
      const esPersonal = cotizacionExistente.cliente?.tipo_cliente === 'personal'
      setItems((cotizacionExistente.items ?? []).map(it => {
        const precioBase = Number(it.precio_unit_usd)
        const precioReinflado = esPersonal ? round2(precioBase / (1 - descPct / 100)) : precioBase
        return {
          _key:          `item-${++_itemCounter}`,
          productoId:    it.producto_id,
          codigoSnap:    it.codigo_snap,
          nombreSnap:    it.nombre_snap,
          unidadSnap:    it.unidad_snap,
          cantidad:      Number(it.cantidad),
          precioUnitUsd: precioReinflado,
          precioOriginalUsd: precioReinflado,
          descuentoPct:  0,
          origen:        it.producto_id ? (it.origen || 'inventario') : 'externo',
        }
      }))
      initializedRef.current = true
    }
  }, [esEdicion, cotizacionExistente, config])

  useEffect(() => {
    if (!clientes.length || !config) return

    const prevId = prevClienteIdRef.current
    if (prevId === clienteId) return
    prevClienteIdRef.current = clienteId

    const prevCli = clientes.find(c => c.id === prevId)
    const nextCli = clientes.find(c => c.id === clienteId)
    const prevEsPersonal = prevCli?.tipo_cliente === 'personal'
    const nextEsPersonal = nextCli?.tipo_cliente === 'personal'

    if (prevEsPersonal === nextEsPersonal) return

    showToast(nextEsPersonal ? 'Cliente personal seleccionado: descuento de personal se aplicará en totales' : 'Descuento de personal removido', 'info')
  }, [clienteId, clientes, config])

  // ── Auto-guardado: restaurar borrador al montar ────────────────────────────
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [borradorInfo, setBorradorInfo] = useState(null)
  const draftRef = useRef(null)
  const [undoDraft, setUndoDraft] = useState(null)
  const undoTimerRef = useRef(null)

  useEffect(() => {
    if (esEdicion) return
    const draft = loadDraft(perfil?.id)
    if (draft && (draft.items?.length > 0 || draft.clienteId)) {
      draftRef.current = draft
      setBorradorInfo(draft)
      setShowDraftBanner(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current) }
  }, [])

  function restoreDraft() {
    const d = draftRef.current
    if (!d) return
    if (d.clienteId) setClienteId(d.clienteId)
    if (d.vendedorId) setVendedorId(d.vendedorId)
    if (d.notasCliente) setNotasCliente(d.notasCliente)
    if (d.notasInternas) setNotasInternas(d.notasInternas)
    if (d.monedaPDF) setMonedaPDF(d.monedaPDF)
    if (d.costoEnvioUsd !== undefined) setCostoEnvioUsd(d.costoEnvioUsd)
    if (d.corteUsd !== undefined) setCorteUsd(d.corteUsd)
    if (d.items?.length > 0) {
      setItems(d.items.map(it => ({ ...it, _key: `item-${++_itemCounter}` })))
    }
    if (d.paso && d.paso > 1 && d.paso < 4) setPaso(d.paso)
    setShowDraftBanner(false)
    setBorradorInfo(null)
    draftRef.current = null
  }

  function discardDraft() {
    // Save draft in memory for undo
    const savedDraft = draftRef.current
    setUndoDraft(savedDraft)
    clearDraft(perfil?.id)
    setShowDraftBanner(false)
    setBorradorInfo(null)
    draftRef.current = null
    // Auto-dismiss undo after 6 seconds
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setUndoDraft(null), 6000)
  }

  function undoDiscard() {
    if (!undoDraft) return
    // Re-save to localStorage and restore banner
    saveDraft(undoDraft, perfil?.id)
    draftRef.current = undoDraft
    setBorradorInfo(undoDraft)
    setShowDraftBanner(true)
    setUndoDraft(null)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }

  // ── Auto-guardado: persistir en localStorage (debounced 1.5s) ──────────────
  useEffect(() => {
    if (esEdicion || paso === 4 || enviada) return
    const timer = setTimeout(() => {
      if (items.length > 0 || clienteId) {
        const clienteObj = clientes.find(c => c.id === clienteId)
        saveDraft({
          paso, clienteId, vendedorId, notasCliente, notasInternas, monedaPDF, items, costoEnvioUsd, corteUsd,
          _clienteNombre: clienteObj?.nombre || '',
          _totalUsd: totalUsd,
          _itemsCount: items.length,
        }, perfil?.id)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [paso, clienteId, vendedorId, notasCliente, notasInternas, monedaPDF, items, costoEnvioUsd, corteUsd, esEdicion, enviada])


  const clienteSeleccionado = clientes.find(c => c.id === clienteId)

  const { subtotal, descuentoUsd: rawDescuentoUsd, totalUsd: rawTotalUsd } = calcTotales(items, descuentoGlobalPct, costoEnvioUsd, corteUsd)
  const esPersonal = clienteSeleccionado?.tipo_cliente === 'personal'
  const descPct = config.descuento_personal_pct ?? 10.00
  const descuentoPersonalUsd = esPersonal ? round2(subtotal * (descPct / 100)) : 0
  const descuentoUsd = esPersonal ? descuentoPersonalUsd : rawDescuentoUsd
  const totalUsd = esPersonal ? round2(subtotal - descuentoPersonalUsd + round2(Number(costoEnvioUsd) || 0) + round2(Number(corteUsd) || 0)) : rawTotalUsd
  const totalBs = tasaHook.tasaEfectiva > 0 ? mulR(totalUsd, tasaHook.tasaEfectiva) : 0

  const comisionEstimada = useMemo(
    () => calcComisionEstimada(items, config, perfil),
    [items, config, perfil]
  )

  // Conversión visual según moneda seleccionada
  const factorBcv = tasaHook.tasaBcv?.precio > 0 && tasaHook.tasaUsdt?.precio > 0
    ? tasaHook.tasaUsdt.precio / tasaHook.tasaBcv.precio
    : 0
  const fmtMoneda = monedaPDF === 'bcv' && factorBcv > 0
    ? (n) => `$${(Number(n || 0) * factorBcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : monedaPDF === 'bs' && tasaHook.tasaEfectiva > 0
      ? (n) => fmtBs(Number(n || 0) * tasaHook.tasaEfectiva)
      : fmtUsd

  // Mapa de precios por producto (para selector P1/P2/P3 en la cesta)
  const preciosMap = useMemo(() => {
    const prods = inventarioParaPrecios?.productos ?? inventarioParaPrecios ?? []
    const m = {}
    for (const p of prods) {
      if (p.precio_2 != null || p.precio_3 != null) {
        m[p.id] = {
          p1: aplicarMarkup(Number(p.precio_usd) || 0),
          p2: p.precio_2 != null ? aplicarMarkup(Number(p.precio_2)) : null,
          p3: p.precio_3 != null ? aplicarMarkup(Number(p.precio_3)) : null
        }
      }
    }
    return m
  }, [inventarioParaPrecios, aplicarMarkup])

  // Mapa de stock por producto (para limitar cantidad en la cesta)
  const stockMap = useMemo(() => {
    const prods = inventarioParaPrecios?.productos ?? inventarioParaPrecios ?? []
    const m = {}
    for (const p of prods) m[p.id] = Number(p.stock_actual) || 0
    return m
  }, [inventarioParaPrecios])

  function getStockMax(productoId) {
    return stockMap[productoId] ?? Infinity
  }

  // ── Agregar producto ─────────────────────────────────────────────────────
  function agregarProducto(p) {
    const isExterno = p.origen === 'externo'
    const stock = isExterno ? Infinity : (Number(p.stock_actual) || 0)
    setItems(prev => {
      const idx = isExterno 
        ? prev.findIndex(it => it.codigoSnap === p.codigo)
        : prev.findIndex(it => it.productoId === p.id)
      if (idx !== -1) {
        const nuevaCantidad = prev[idx].cantidad + (p.cantidadExterna || 1)
        if (nuevaCantidad > stock && stock > 0 && stock < Infinity) {
          showToast(`⚠ Stock insuficiente: tienes ${stock} ${p.unidad ?? 'und'}`, 'warning')
        }
        return prev.map((it, i) => i === idx ? { ...it, cantidad: nuevaCantidad } : it)
      }

      const precioBase = isExterno ? Number(p.precio_usd) : aplicarMarkup(Number(p.precio_usd))

      return [...prev, {
        _key:          `item-${++_itemCounter}`,
        productoId:    isExterno ? null : p.id,
        origen:        p.origen || 'inventario',
        codigoSnap:    p.codigo ?? '',
        nombreSnap:    p.nombre,
        categoria:     p.categoria || '',
        unidadSnap:    p.unidad ?? 'und',
        cantidad:      isExterno ? (p.cantidadExterna || 1) : 1,
        precioUnitUsd: precioBase,
        precioOriginalUsd: precioBase,
        descuentoPct:  0,
      }]
    })
  }

  // Bulk-add desde escaneo de lista
  function agregarProductosBulk(listaItems) {
    setItems(prev => {
      let updated = [...prev]
      let agregados = 0
      for (const { producto, cantidad } of listaItems) {
        const stock = Number(producto.stock_actual) || 0
        const qty = cantidad  // sin cap — se permite superar el stock con advertencia
        const idx = updated.findIndex(it => it.productoId === producto.id)
        if (idx !== -1) {
          const newQty = updated[idx].cantidad + qty
          updated = updated.map((it, i) => i === idx ? { ...it, cantidad: newQty } : it)
        } else {
          const precioBase = aplicarMarkup(Number(producto.precio_usd))
          updated.push({
            _key:          `item-${++_itemCounter}`,
            productoId:    producto.id,
            origen:        'inventario',
            codigoSnap:    producto.codigo ?? '',
            nombreSnap:    producto.nombre,
            categoria:     producto.categoria || '',
            unidadSnap:    producto.unidad ?? 'und',
            cantidad:      qty,
            precioUnitUsd: precioBase,
            precioOriginalUsd: precioBase,
            descuentoPct:  0,
          })
        }
        agregados++
      }
      if (agregados > 0) showToast(`${agregados} producto${agregados > 1 ? 's' : ''} agregado${agregados > 1 ? 's' : ''} desde el escaneo`, 'ok')
      return updated
    })
  }

  function cambiarItem(idx, campo, valor) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      if (campo === 'cantidad') {
        const num = parseFloat(String(valor).replace(',', '.'))
        const stock = it.origen === 'externo' ? Infinity : (stockMap[it.productoId] ?? Infinity)
        if (!isNaN(num) && num > stock && stock > 0 && stock < Infinity) {
          showToast(`⚠ Stock insuficiente: tienes ${stock} unidades`, 'warning')
        }
      }

      const updated = { ...it, [campo]: valor }

      if (campo === 'precioUnitUsd') {
        const precioUnit = parseFloat(String(valor)) || 0
        updated.precioOriginalUsd = precioUnit
      }

      return updated
    }))
  }

  function eliminarItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Navegación entre pasos ─────────────────────────────────────────────
  function siguiente() {
    setErrorGeneral('')
    if (paso === 1) {
      // vendedorId se asigna automáticamente al perfil actual si está vacío
      if (!clienteId) { setErrorGeneral('Selecciona un cliente para continuar'); return }
      setPaso(2)
    } else if (paso === 2) {
      if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); return }
      setPaso(3)
    }
  }

  function anterior() {
    setErrorGeneral('')
    if (paso > 1 && paso < 4) setPaso(paso - 1)
  }

  // ── Guardar borrador ─────────────────────────────────────────────────────
  async function handleGuardar() {
    if (!clienteId) { setErrorGeneral('Selecciona un cliente'); return }
    if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); return }
    setErrorGeneral('')

    try {
      const esPersonal = clienteSeleccionado?.tipo_cliente === 'personal'
      const descPct = config.descuento_personal_pct ?? 10.00
      const itemsConDescuento = items.map(it => {
        const precioUnit = it.precioUnitUsd
        const precioFinal = esPersonal ? round2(precioUnit * (1 - descPct / 100)) : precioUnit
        return {
          ...it,
          precioUnitUsd: precioFinal
        }
      })

      const payload = {
        cotizacionId,
        campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, corteUsd, canal_venta: esVendedorExterno ? 'externo' : 'interno' },
        items: itemsConDescuento,
      }
      console.log('payload cotizacion (builder-guardar)', payload)

      const res = await guardarBorrador.mutateAsync(payload)
      const extractedId = res?.localId || res?.id
      setCotizacionId(extractedId)
      clearDraft(perfil?.id)
      onGuardado?.()
    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al guardar')
    }
  }

  // ── Enviar cotización ────────────────────────────────────────────────────
  async function handleEnviar(tasaBcv) {
    if (!clienteId) { setErrorGeneral('Selecciona un cliente'); return }
    if (items.length === 0) { setErrorGeneral('Agrega al menos un producto'); return }

    try {
      let currentId = cotizacionId
      let isOfflineId = String(currentId).startsWith('local_')
      
      const esPersonal = clienteSeleccionado?.tipo_cliente === 'personal'
      const descPct = config.descuento_personal_pct ?? 10.00
      const itemsConDescuento = items.map(it => {
        const precioUnit = it.precioUnitUsd
        const precioFinal = esPersonal ? round2(precioUnit * (1 - descPct / 100)) : precioUnit
        return {
          ...it,
          precioUnitUsd: precioFinal
        }
      })

      // Guardar primero si no tiene ID o actualizar si ya lo tiene
      if (!currentId) {
        const payload = {
          cotizacionId: null,
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, corteUsd },
          items: itemsConDescuento,
        }
        console.log('payload cotizacion (builder-enviar-nuevo)', payload)

        const res = await guardarBorrador.mutateAsync(payload)
        currentId = res?.localId || res?.id
        setCotizacionId(currentId)
        if (res?._queued) isOfflineId = true
      } else {
        const res = await guardarBorrador.mutateAsync({
          cotizacionId: currentId,
          campos: { clienteId, vendedorId: esSupervisor && !esEdicion ? vendedorId : undefined, transportistaId, notasCliente, notasInternas, descuentoGlobalPct, costoEnvioUsd, corteUsd },
          items: itemsConDescuento,
        })
        if (res?._queued) isOfflineId = true
      }

      // Si se guardó como borrador local (offline), NO intentamos enviar
      // Solo simulamos que fue enviada para que el usuario avance y no se quede colgado
      if (isOfflineId || !navigator.onLine) {
        setNumDisplay('OFFLINE')
        setEnviada(true)
        clearDraft(perfil?.id)
        setPaso(4)
        return
      }

      await enviarCotizacion.mutateAsync({ cotizacionId: currentId, tasaBcv })

      // Obtener número de cotización para mostrar en confirmación
      const tabla = 'cotizaciones'
      const { data: cotEnviada } = await supabase
        .from(tabla).select('numero, version').eq('id', currentId).single()
      if (cotEnviada) {
        const nd = `COT-${String(cotEnviada.numero).padStart(5, '0')}`
        setNumDisplay(nd)
      }

      setEnviada(true)
      clearDraft(perfil?.id)
      setPaso(4)

    } catch (e) {
      setErrorGeneral(e.message ?? 'Error al enviar')
    }
  }

  // ── Acciones post-envío (Paso 4) ─────────────────────────────────────────
  async function obtenerDatosParaPDF() {
    let cot, itms
    
    // Asegurar que el dueño del cliente tenga sus datos completos (tlf) desde la lista global
    const dueño = vendedores.find(v => v.id === clienteSeleccionado?.vendedor_id)
    const clienteHidratado = clienteSeleccionado 
      ? { ...clienteSeleccionado, vendedor: dueño || clienteSeleccionado.vendedor } 
      : null

    if (String(cotizacionId).startsWith('local_')) {
      const vendedor = esSupervisor ? vendedores.find(v => v.id === vendedorId) || perfil : perfil
      cot = {
        id: cotizacionId, numero: 'OFFLINE', cliente_id: clienteId, vendedor_id: vendedor?.id,
        transportista_id: transportistaId, estado: 'borrador', 
        subtotal_usd: subtotal, descuento_global_pct: descuentoGlobalPct, descuento_usd,
        costo_envio_usd: costoEnvioUsd, corte_usd: corteUsd, total_usd: totalUsd,
        notas_cliente: notasCliente, cliente: clienteHidratado, vendedor
      }
      itms = items.map((it, i) => ({
        cantidad: it.cantidad, codigo_snap: it.codigoSnap, nombre_snap: it.nombreSnap,
        unidad_snap: it.unidadSnap, precio_unit_usd: it.precioUnitUsd,
        descuento_pct: it.descuentoPct, total_linea_usd: round2(it.cantidad * it.precioUnitUsd),
        orden: i
      }))
    } else {
      const [itemsRes, cotRes] = await Promise.all([
        supabase.from('cotizacion_items').select('cantidad, codigo_snap, nombre_snap, unidad_snap, precio_unit_usd, descuento_pct, total_linea_usd, orden').eq('cotizacion_id', cotizacionId).order('orden'),
        supabase.from('cotizaciones').select('id, numero, version, cotizacion_raiz_id, cliente_id, vendedor_id, transportista_id, estado, subtotal_usd, descuento_global_pct, descuento_usd, costo_envio_usd, corte_usd, total_usd, tasa_bcv_snapshot, total_bs_snapshot, notas_cliente, creado_en, actualizado_en, enviada_en, exportada_en').eq('id', cotizacionId).single(),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (cotRes.error) throw cotRes.error
      
      const vendedor = esSupervisor ? vendedores.find(v => v.id === vendedorId) || perfil : perfil
      cot = { ...cotRes.data, cliente: clienteHidratado, vendedor }
      itms = itemsRes.data ?? []
    }
    return { cot, itms }
  }

  async function descargarPDF() {
    setPdfLoading(true)
    try {
      const { generarPDF } = await import('../../services/pdf/cotizacionPDF')
      const { cot, itms } = await obtenerDatosParaPDF()
      
      await generarPDF({
        cotizacion: cot,
        items: itms,
        config,
        monedaPDF,
        tasa: tasaHook.tasaEfectiva,
        tasaUsdt: tasaHook.tasaUsdt?.precio || 0,
        tasaBcv: tasaHook.tasaBcv?.precio || 0,
        conIVA: conIva,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setPdfLoading(false)
    }
  }

  function printOrDownloadPdf(blob, filename) {
    const url = URL.createObjectURL(blob)
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) {
      const w = window.open(url, '_blank')
      if (!w) {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } else {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none'
      iframe.src = url
      document.body.appendChild(iframe)
      iframe.onload = () => {
        try { iframe.contentWindow.print() } catch { window.open(url) }
        setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url) }, 60000)
      }
    }
  }

  async function imprimirCotizacion() {
    setPrintLoading(true)
    try {
      const { generarPDF } = await import('../../services/pdf/cotizacionPDF')
      const { cot, itms } = await obtenerDatosParaPDF()
      
      const blob = await generarPDF({
        cotizacion: cot,
        items: itms,
        config,
        returnBlob: true,
        monedaPDF,
        tasa: tasaHook.tasaEfectiva,
        tasaUsdt: tasaHook.tasaUsdt?.precio || 0,
        tasaBcv: tasaHook.tasaBcv?.precio || 0,
        conIVA: conIva,
      })
      printOrDownloadPdf(blob, `${numDisplay.replace(/\s+/g, '_')}.pdf`)
    } catch (err) {
      showToast('Error al imprimir: ' + (err.message || 'Error desconocido'), 'error')
    } finally {
      setPrintLoading(false)
    }
  }

  async function handleWhatsApp() {
    setWaLoading(true)
    try {
      const { generarPDF } = await import('../../services/pdf/cotizacionPDF')
      const { cot, itms } = await obtenerDatosParaPDF()
      
      const pdfBlob = await generarPDF({
        cotizacion: cot,
        items: itms,
        config,
        returnBlob: true,
        monedaPDF,
        tasa: tasaHook.tasaEfectiva,
        tasaUsdt: tasaHook.tasaUsdt?.precio || 0,
        tasaBcv: tasaHook.tasaBcv?.precio || 0,
        conIVA: conIva,
      })

      const totalConIva = conIva 
        ? (totalUsd + (subtotal - descuentoUsd) * 0.16)
        : totalUsd
      const mensajeParams = {
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteSeleccionado?.nombre,
        numDisplay,
        totalUsd: totalConIva,
        nombreVendedor: cot.vendedor?.nombre || perfil?.nombre,
        items: itms,
      }
      const mensaje = generarMensaje(mensajeParams)

      await compartirPorWhatsApp({
        pdfBlob,
        pdfFilename: `${numDisplay.replace(/\s+/g, '_')}.pdf`,
        telefono: clienteSeleccionado?.telefono,
        mensaje,
        mensajeParams,
      })
    } catch (err) {
      const totalConIva = conIva 
        ? (totalUsd + (subtotal - descuentoUsd) * 0.16)
        : totalUsd
      const texto = generarMensaje({
        nombreNegocio: config.nombre_negocio,
        nombreCliente: clienteSeleccionado?.nombre,
        numDisplay,
        totalUsd: totalConIva,
        nombreVendedor: perfil?.nombre,
      })
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
    } finally {
      setWaLoading(false)
    }
  }

  const cargando = guardarBorrador.isPending || enviarCotizacion.isPending
  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400'

  return (
    <div className={`bg-slate-50 ${paso === 2 ? 'h-full flex flex-col' : 'min-h-full'}`}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 sticky top-0 z-10 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {paso < 4 && (
              <button onClick={paso === 1 ? onVolver : anterior}
                className="p-1.5 sm:p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors shrink-0">
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="font-bold text-slate-800 text-sm sm:text-base md:text-lg truncate">
              {paso === 4 ? 'Cotización enviada' :
               esEdicion ? 'Editar' : 'Nueva cotización'}
            </h2>
            {paso === 2 && clienteSeleccionado && (
              <span className="hidden sm:inline text-xs truncate" style={{ color: clienteSeleccionado.vendedor?.color || '#94a3b8' }}>· {clienteSeleccionado.nombre}</span>
            )}
            {esEdicion && cotizacionExistente.numero && (
              <span className="hidden sm:inline text-[10px] font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0">
                COT-{String(cotizacionExistente.numero).padStart(5, '0')}
              </span>
            )}
          </div>

          {paso < 4 && <StepIndicator paso={paso} />}
        </div>
      </div>

      {/* ── Contenido por paso ─────────────────────────────────────────── */}
      <div className={`p-3 sm:p-4 md:p-5 lg:p-6 w-full ${paso === 2 ? 'flex-1 min-h-0 flex flex-col' : 'space-y-3 sm:space-y-4 md:space-y-5 pb-24 lg:pb-6'}`}>

        {/* Error general */}
        {errorGeneral && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} className="shrink-0" />
            {errorGeneral}
          </div>
        )}

        {/* Banner: retomar borrador — tarjeta premium */}
        {showDraftBanner && borradorInfo && (
          <div className="relative overflow-hidden rounded-2xl border border-white/30 p-4 animate-in fade-in slide-in-from-top-2 duration-500"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(248,250,252,0.9) 100%)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
            }}>
            {/* Animated accent bar */}
            <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ background: 'linear-gradient(90deg, #f59e0b, #d97706, #b45309)' }} />
            {/* Pulsing indicator */}
            <div className="absolute top-3 right-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Icon + Info */}
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg, #fbbf24, #d97706)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' }}>
                  <Save size={18} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">Cotización sin terminar</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                    <span className="text-xs text-slate-500 flex items-center gap-1 truncate">
                      <User size={11} className="shrink-0" />
                      {borradorInfo._clienteNombre || 'Cliente sin especificar'}
                    </span>
                    {(borradorInfo._itemsCount || borradorInfo.items?.length > 0) && (
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <ShoppingCart size={11} className="shrink-0" />
                        {borradorInfo._itemsCount || borradorInfo.items?.length} artículo{(borradorInfo._itemsCount || borradorInfo.items?.length) !== 1 ? 's' : ''}
                      </span>
                    )}
                    {borradorInfo._totalUsd > 0 && (
                      <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                        <DollarSign size={11} className="shrink-0" />
                        {fmtUsd(borradorInfo._totalUsd)}
                      </span>
                    )}
                    {borradorInfo._ts && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Clock size={10} className="shrink-0" />
                        {formatRelativeTime(borradorInfo._ts)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 sm:self-center">
                <button type="button" onClick={restoreDraft}
                  className="px-4 py-2 rounded-xl text-white text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #d97706, #b45309)', boxShadow: '0 4px 12px rgba(180,83,9,0.3)' }}>
                  Retomar
                </button>
                <button type="button" onClick={discardDraft}
                  className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-all">
                  Descartar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Undo toast — flotante al descartar borrador */}
        {undoDraft && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] animate-in fade-in slide-in-from-bottom-3 duration-300"
            style={{ maxWidth: 'calc(100vw - 2rem)' }}>
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-700/40"
              style={{
                background: 'rgba(15,23,42,0.92)',
                backdropFilter: 'blur(16px)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
              }}>
              <Trash2 size={15} className="text-slate-400 shrink-0" />
              <span className="text-sm text-white/90 font-medium whitespace-nowrap">Borrador descartado</span>
              <button onClick={undoDiscard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-all">
                <Undo2 size={13} />
                Deshacer
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 1: Seleccionar o crear cliente                           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 1 && (
          <div className="space-y-4">
            {/* Selector de vendedor — oculto, cotizaciones quedan a nombre del usuario */}
            {false && esSupervisor && !esEdicion && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                <SectionH3 icon={Tag}>Asignar a vendedor</SectionH3>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2">
                  {vendedores.map(v => {
                    const sel = vendedorId === v.id
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVendedorId(v.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all text-sm font-semibold ${
                          sel ? 'border-primary bg-primary-light text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: v.color || '#94a3b8' }}
                        />
                        {v.nombre}
                      </button>
                    )
                  })}
                </div>
                {!vendedorId && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle size={11} /> Selecciona a quién se le asignará esta cotización
                  </p>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <SectionH3 icon={User}>Seleccionar cliente</SectionH3>
                <button onClick={() => setShowCrearCliente(!showCrearCliente)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                  <UserPlus size={13} /> {showCrearCliente ? 'Cancelar' : 'Nuevo cliente'}
                </button>
              </div>

              {/* Crear cliente completo (formulario inline) */}
              {showCrearCliente && (
                <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-4 relative z-[1]">
                  <h4 className="font-bold text-emerald-800 text-sm flex items-center gap-1.5 mb-3">
                    <UserPlus size={14} /> Registrar nuevo cliente
                  </h4>
                  <ClienteForm
                    compact
                    onSuccess={(nuevo) => {
                      refetchClientes()
                      setClienteId(nuevo.id)
                      setShowCrearCliente(false)
                    }}
                    onCancel={() => setShowCrearCliente(false)}
                  />
                </div>
              )}

              {/* Seleccionar de lista */}
              {!showCrearCliente && (
                <div className="space-y-3">
                  <ClienteSelector
                    clientes={clientes}
                    clienteId={clienteId}
                    onSelect={(id) => { setClienteId(id); setErrorGeneral('') }}
                  />

                  {/* Vista previa del cliente seleccionado */}
                  {clienteSeleccionado && (
                    <div className="bg-primary-light/30 border border-primary-focus/30 rounded-xl p-3 sm:p-4">
                      <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
                        {clienteSeleccionado.rif_cedula && (
                          <span className="flex items-center gap-1.5"><Hash size={11} className="text-slate-400" /> {clienteSeleccionado.rif_cedula}</span>
                        )}
                        {clienteSeleccionado.telefono && (
                          <span className="flex items-center gap-1.5"><Phone size={11} className="text-slate-400" /> {fmtTelefono(clienteSeleccionado.telefono)}</span>
                        )}
                        {clienteSeleccionado.email && (
                          <span className="flex items-center gap-1.5"><Mail size={11} className="text-slate-400" /> {clienteSeleccionado.email}</span>
                        )}
                        {(clienteSeleccionado.direccion || clienteSeleccionado.ciudad || clienteSeleccionado.estado) && (
                          <span className="flex items-center gap-1.5 col-span-2"><MapPin size={11} className="text-slate-400" /> {[clienteSeleccionado.direccion, clienteSeleccionado.ciudad, clienteSeleccionado.estado].filter(Boolean).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {clienteSeleccionado?.tipo_cliente === 'personal' && (
                    <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <User size={16} className="text-amber-600 shrink-0" />
                      <p className="text-xs text-amber-800 font-bold">
                        Cliente identificado como Personal. Se aplica descuento automático de personal ({config.descuento_personal_pct ?? 10}%) en la sección de totales.
                      </p>
                    </div>
                  )}

                  {/* Alerta: cliente de otro vendedor */}
                  {clienteSeleccionado && perfil?.rol !== 'supervisor' && clienteSeleccionado.vendedor_id && clienteSeleccionado.vendedor_id !== perfil?.id && (
                    <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                      <AlertCircle size={16} className="text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-700">
                        Este cliente está asignado a <strong>{clienteSeleccionado.vendedor?.nombre || 'otro vendedor'}</strong>.
                        Puedes continuar, pero se notificará al supervisor al enviar la cotización.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Botón siguiente */}
            <div className="flex justify-end">
              <button onClick={siguiente}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 text-white font-bold text-sm rounded-xl transition-all shadow-lg active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                Siguiente: Productos <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 2: Agregar productos                                      */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 2 && (
          <div className="flex-1 min-h-0 flex flex-col">

            {/* Split: catálogo izquierda + cesta derecha */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:gap-3">

              {/* ── Catálogo de productos ── */}
              <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                <div className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0">
                  <BuscadorProductos onAgregar={agregarProducto} itemsAgregados={items} tasa={tasaHook.tasaEfectiva} onCambiarCantidad={cambiarItem} onEliminarItem={eliminarItem} onScanClick={() => setShowScanModal(true)} />
                  <ScanMaterialListModal
                    open={showScanModal}
                    onClose={() => setShowScanModal(false)}
                    onBulkAdd={agregarProductosBulk}
                    tasa={tasaHook.tasaEfectiva}
                  />
                </div>
              </div>

              {/* ── Cesta flotante ── */}
              <div className="w-full lg:w-72 xl:w-80 shrink-0 lg:sticky lg:top-[73px]">
                <CestaPanel
                  items={items}
                  onCambiar={cambiarItem}
                  onEliminar={eliminarItem}
                  onEditar={setEditItemIdx}
                  subtotal={subtotal}
                  tasa={tasaHook.tasaEfectiva}
                  onSiguiente={siguiente}
                  onAnterior={anterior}
                  preciosMap={preciosMap}
                  stockMap={stockMap}
                  esPersonal={esPersonal}
                  descPct={descPct}
                />
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 3: Resumen, descuentos, notas y envío                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 3 && (
          <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 items-start">

            {/* ── Columna izquierda: formularios ── */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* Moneda del PDF */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
                <SectionH3 icon={Truck}>Opciones</SectionH3>
                <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Moneda del PDF</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: '$',         label: 'USDT ($)' },
                        { value: 'bcv',       label: 'Dólar BCV' },
                        { value: 'bs',        label: 'Bolívares (Bs)' },
                      ].map(opt => (
                        <button key={opt.value} type="button"
                          onClick={() => setMonedaPDF(opt.value)}
                          disabled={cargando}
                          className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all ${monedaPDF === opt.value
                            ? 'bg-primary text-white shadow-sm'
                            : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                          }`}
                          style={monedaPDF === opt.value ? { background: '#1B365D' } : {}}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {monedaPDF !== '$' && tasaHook.tasaEfectiva > 0 && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Tasa: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2 }).format(tasaHook.tasaEfectiva)} Bs/$
                        {(monedaPDF === 'bcv' || monedaPDF === 'mixto_bcv') && tasaHook.tasaUsdt?.precio > 0 && tasaHook.tasaBcv?.precio > 0 && (
                          <> · Factor BCV: {(tasaHook.tasaUsdt.precio / tasaHook.tasaBcv.precio).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                        )}
                      </p>
                    )}
                </div>

                <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-600 cursor-pointer flex items-center gap-2 select-none w-full">
                    <input type="checkbox" checked={conIva} onChange={e => {
                      setConIva(e.target.checked)
                      localStorage.setItem('listopos_con_iva', e.target.checked ? 'true' : 'false')
                    }} className="rounded text-primary focus:ring-primary h-3.5 w-3.5 border-slate-300" />
                    Incluir IVA (16%) en el PDF
                  </label>
                </div>

                {/* Servicios Extras */}
                <div className="space-y-3">
                  <SectionH3 icon={Truck}>Servicios Adicionales (USD)</SectionH3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Flete / Envío</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                        <input
                          type="text"
                          value={costoEnvioUsd || ''}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')
                            setCostoEnvioUsd(val ? Number(val) : 0)
                          }}
                          className={`${inputCls} pl-7`}
                          placeholder="0.00"
                          disabled={cargando}
                        />
                      </div>
                    </div>
                    {/* FEATURE_CORTE_HIDDEN: Oculto temporalmente a petición del usuario. Cambiar a true para reactivar. */}
                    {false && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Corte de Material</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                        <input
                          type="text"
                          value={corteUsd || ''}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')
                            setCorteUsd(val ? Number(val) : 0)
                          }}
                          className={`${inputCls} pl-7`}
                          placeholder="0.00"
                          disabled={cargando}
                        />
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Notas */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
                <SectionH3 icon={StickyNote}>Notas</SectionH3>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                      Para el cliente
                      <span className="font-normal normal-case text-slate-400 text-[11px]">· aparece en PDF</span>
                    </label>
                    <textarea value={notasCliente} onChange={e => setNotasCliente(e.target.value)}
                      rows={3} placeholder="Ej: Precios válidos por 15 días, sujetos a disponibilidad de stock..."
                      className={`${inputCls} resize-none`} disabled={cargando} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                      Notas internas
                      <span className="font-normal normal-case text-slate-400 text-[11px]">· no aparece en PDF</span>
                    </label>
                    <textarea value={notasInternas} onChange={e => setNotasInternas(e.target.value)}
                      rows={2} placeholder="Observaciones internas..."
                      className={`${inputCls} resize-none`} disabled={cargando} />
                  </div>
                </div>
              </div>

              {/* Navegación — solo visible en móvil (lg la mueve al panel derecho) */}
              <div className="flex flex-col gap-3 pb-4 lg:hidden relative z-10">
                <button onClick={() => { setErrorGeneral(''); handleEnviar(tasaHook.tasaEfectiva) }}
                  disabled={cargando}
                  className="flex items-center justify-center gap-2 w-full px-6 py-3.5 text-white font-bold text-sm rounded-xl transition-all shadow-lg disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)', touchAction: 'manipulation' }}>
                  {cargando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {cargando ? 'Enviando...' : 'Enviar cotización'}
                </button>
                <div className="flex gap-2">
                  <button onClick={anterior} disabled={cargando}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
                    <ArrowLeft size={15} /> Volver
                  </button>
                  <button onClick={handleGuardar} disabled={cargando}
                    style={{ touchAction: 'manipulation' }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
                    {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Guardar
                  </button>
                </div>
              </div>
            </div>

            {/* ── Columna derecha: panel sticky de resumen ── */}
            <div className="w-full lg:w-64 xl:w-80 shrink-0 lg:sticky lg:top-[73px] space-y-3">

              {/* Cliente */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate" style={{ color: clienteSeleccionado?.vendedor?.color || '#1e293b' }}>{clienteSeleccionado?.nombre}</p>
                    {clienteSeleccionado?.tipo_cliente === 'personal' ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 mt-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                        Personal ({config.descuento_personal_pct ?? 10}%)
                      </span>
                    ) : (
                      clienteSeleccionado?.tipo_cliente && (
                        <p className="text-xs text-slate-400 capitalize">{clienteSeleccionado.tipo_cliente}</p>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Lista de productos */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                    {items.length} producto{items.length !== 1 ? 's' : ''}
                  </span>
                  <button onClick={anterior} className="text-xs text-primary font-semibold hover:underline">
                    Editar
                  </button>
                </div>
                <div className="divide-y divide-slate-50 max-h-52 overflow-y-auto">
                  {items.map((it, i) => {
                    const lineTotal = round2(it.cantidad * it.precioUnitUsd)
                    return (
                      <div key={it._id ?? i} className="px-4 py-2.5 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-700 leading-tight">
                            {it.nombreSnap}
                            {(it.origen === 'externo' || !it.productoId) && (
                              <span className="inline-block ml-1.5 align-middle mb-0.5 text-[8px] uppercase tracking-wider font-bold bg-amber-100 text-amber-700 px-1 py-0.5 rounded">
                                Ext - {it.codigoSnap}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {it.cantidad} {it.unidadSnap}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-slate-700 shrink-0">{fmtMoneda(lineTotal)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Totales */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                {clienteSeleccionado?.tipo_cliente === 'personal' && (
                  <p className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-100 px-2 py-1.5 rounded-lg mb-2 text-center">
                    * Descuento automático de personal ({config.descuento_personal_pct ?? 10}%) se aplicará en el total.
                  </p>
                )}
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span className="font-medium text-slate-700">{fmtMoneda(subtotal)}</span>
                </div>
                {clienteSeleccionado?.tipo_cliente === 'personal' && (
                  <div className="flex justify-between text-sm text-amber-700 font-medium">
                    <span>Descuento Personal ({config.descuento_personal_pct ?? 10}%)</span>
                    <span>-{fmtMoneda(descuentoPersonalUsd)}</span>
                  </div>
                )}
                {costoEnvioUsd > 0 && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Envío</span>
                    <span className="font-medium text-slate-700">+{fmtMoneda(costoEnvioUsd)}</span>
                  </div>
                )}
                {corteUsd > 0 && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Corte</span>
                    <span className="font-medium text-slate-700">+{fmtMoneda(corteUsd)}</span>
                  </div>
                )}
                {conIva && (
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>IVA (16%)</span>
                    <span className="font-medium text-slate-700">+{fmtMoneda((subtotal - descuentoUsd) * 0.16)}</span>
                  </div>
                )}

                <div className="border-t border-slate-100 pt-3 mt-1">
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-wide">Total</span>
                    <span className="text-2xl font-black text-slate-900">{fmtMoneda(conIva ? (totalUsd + (subtotal - descuentoUsd) * 0.16) : totalUsd)}</span>
                  </div>
                  {monedaPDF !== 'bs' && tasaHook.tasaEfectiva > 0 && totalUsd > 0 && (
                    <p className="text-right text-xs text-slate-400 mt-0.5 font-mono">
                      Bs {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(conIva ? ((totalUsd + (subtotal - descuentoUsd) * 0.16) * tasaHook.tasaEfectiva) : totalBs)}
                    </p>
                  )}
                </div>

                {/* Tasa BCV visible */}
                {tasaHook.tasaEfectiva > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-50 mt-2">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <DollarSign size={10} /> BCV: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaHook.tasaBcv?.precio || 0)} Bs/$
                      {tasaHook.tasaUsdt?.precio > 0 && (
                        <> · <span className="text-indigo-500">USDT: {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tasaHook.tasaUsdt.precio)}</span></>
                      )}
                    </span>
                    <button type="button" onClick={tasaHook.refrescar}
                      className="p-1 text-slate-300 hover:text-primary transition-colors rounded">
                      <RefreshCw size={11} className={tasaHook.cargando ? 'animate-spin' : ''} />
                    </button>
                  </div>
                )}

                {/* Comisión estimada (solo vendedor) */}
                {comisionEstimada.monto > 0 && (
                  <div className="mt-1 pt-2 border-t border-slate-50">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-emerald-600 font-semibold">
                        Comisión est.
                      </span>
                      <span className="text-[11px] font-bold text-emerald-600">
                        ~{fmtUsd(comisionEstimada.monto)}{' '}
                        {comisionEstimada.mixto ? '(tasas mixtas)' : `(${comisionEstimada.pct}%)`}
                      </span>
                    </div>
                    {/* Tooltip de desglose cuando hay tasas mixtas */}
                    {comisionEstimada.mixto && (
                      <p className="text-[10px] text-slate-400 mt-0.5 text-right">
                        {comisionEstimada.detalle
                          .map(d => `${d.cat}: ${d.pct}%`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Botones — solo desktop */}
              <div className="hidden lg:flex flex-col gap-2">
                <button onClick={() => { setErrorGeneral(''); handleEnviar(tasaHook.tasaEfectiva) }}
                  disabled={cargando}
                  className="flex items-center justify-center gap-2 w-full px-6 py-3.5 text-white font-bold text-sm rounded-xl transition-all shadow-lg disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                  {enviarCotizacion.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Enviar cotización
                </button>
                <button onClick={handleGuardar} disabled={cargando}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors disabled:opacity-50">
                  {guardarBorrador.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Guardar borrador
                </button>
                <button onClick={anterior} disabled={cargando}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
                  <ArrowLeft size={15} /> Volver a productos
                </button>
              </div>
            </div>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* PASO 4: Confirmación post-envío                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {paso === 4 && (
          <div className="flex items-center justify-center min-h-[40vh] px-2">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-[calc(100vw-1.5rem)] sm:max-w-sm w-full">

              {/* Header de éxito compacto */}
              <div className="relative h-20 flex flex-col items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #1B365D 0%, #2d5a8e 50%, #B8860B 100%)' }}>
                <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
                  style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
                <div className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center bg-white/20 backdrop-blur-sm border-2 border-white/40 shadow-lg">
                  <CheckCircle size={20} color="white" strokeWidth={2.5} />
                </div>
                <p className="relative z-10 text-white/80 text-[10px] font-medium mt-1 tracking-wide uppercase">Enviada exitosamente</p>
              </div>

              <div className="p-4 space-y-3 text-center">
                {/* Número de cotización */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Cotización enviada</h3>
                  {numDisplay && (
                    <p className="font-black text-xl font-mono mt-0.5 tracking-tight" style={{ color: '#1B365D' }}>{numDisplay}</p>
                  )}
                </div>

                {/* Resumen compacto */}
                <div className="bg-slate-50 rounded-xl p-3 divide-y divide-slate-100 text-left">
                  <div className="flex justify-between py-1.5 first:pt-0">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Cliente</span>
                    <span className="font-semibold text-xs text-right max-w-[200px] truncate" style={{ color: clienteSeleccionado?.vendedor?.color || '#1e293b' }}>{clienteSeleccionado?.nombre}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Vendedor</span>
                    <span className="font-medium text-slate-700 text-xs">{perfil?.nombre}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Items</span>
                    <span className="font-medium text-slate-700 text-xs">{items.length} producto{items.length !== 1 ? 's' : ''}</span>
                  </div>
                  {(subtotal !== totalUsd || conIva) && (
                    <>
                      <div className="flex justify-between py-1.5">
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Subtotal</span>
                        <span className="font-medium text-slate-600 text-xs">{fmtMoneda(subtotal)}</span>
                      </div>
                      {descuentoUsd > 0 && (
                        <div className="flex justify-between py-1.5">
                          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Descuento</span>
                          <span className="font-medium text-red-500 text-xs">-{fmtMoneda(descuentoUsd)}</span>
                        </div>
                      )}
                      {conIva && (
                        <div className="flex justify-between py-1.5">
                          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">IVA (16%)</span>
                          <span className="font-medium text-emerald-600 text-xs">+{fmtMoneda((subtotal - descuentoUsd) * 0.16)}</span>
                        </div>
                      )}
                      {costoEnvioUsd > 0 && (
                        <div className="flex justify-between py-1.5">
                          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Envío</span>
                          <span className="font-medium text-emerald-600 text-xs">+{fmtMoneda(costoEnvioUsd)}</span>
                        </div>
                      )}
                      {corteUsd > 0 && (
                        <div className="flex justify-between py-1.5">
                          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Corte</span>
                          <span className="font-medium text-emerald-600 text-xs">+{fmtMoneda(corteUsd)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between py-1.5 last:pb-0">
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Total</span>
                    <div className="text-right">
                      <span className="font-bold text-slate-900 text-sm">{fmtMoneda(conIva ? (totalUsd + (subtotal - descuentoUsd) * 0.16) : totalUsd)}</span>
                      {monedaPDF !== 'bs' && tasaHook.tasaEfectiva > 0 && totalUsd > 0 && (
                        <p className="text-[10px] text-slate-400 font-mono">
                          Bs {new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(conIva ? ((totalUsd + (subtotal - descuentoUsd) * 0.16) * tasaHook.tasaEfectiva) : totalBs)}
                        </p>
                      )}
                    </div>
                  </div>
                  {notasCliente && (
                    <div className="py-1.5 last:pb-0">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block mb-0.5">Notas</span>
                      <p className="text-[11px] text-slate-600 leading-snug">{notasCliente}</p>
                    </div>
                  )}
                </div>

                {/* Acciones */}
                <div className="space-y-2">
                  {/* Ver resumen completo en modal */}
                  <button onClick={() => setShowResumen(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs transition-all active:scale-[0.98]"
                    style={{ backgroundColor: '#1B365D10', color: '#1B365D' }}>
                    <Eye size={14} />
                    Ver resumen
                  </button>

                  <div className="flex gap-2">
                    <button onClick={handleWhatsApp} disabled={waLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-xs rounded-xl transition-all active:scale-[0.98] disabled:opacity-50">
                      {waLoading
                        ? <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                        : <MessageCircle size={14} />}
                      WhatsApp
                    </button>
                    <button onClick={imprimirCotizacion} disabled={printLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs rounded-xl transition-all active:scale-[0.98] disabled:opacity-50">
                      {printLoading
                        ? <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        : <Printer size={14} />}
                      Imprimir
                    </button>
                    {onDespachar && (
                      <button onClick={() => {
                        const insuficientes = items.filter(it =>
                          stockMap[it.productoId] !== undefined && it.cantidad > stockMap[it.productoId]
                        )
                        if (insuficientes.length > 0) {
                          setShowModalDespachar(true)
                        } else {
                          onDespachar({
                            id: cotizacionId,
                            numero: numDisplay.replace('COT-', '').replace(/^0+/, ''),
                            total_usd: totalUsd,
                            costo_envio_usd: Number(costoEnvioUsd) || 0,
                            corte_usd: Number(corteUsd) || 0,
                            cliente: { nombre: clienteSeleccionado?.nombre }
                          })
                        }
                      }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-xl transition-all active:scale-[0.98]">
                        <Truck size={14} /> Despachar
                      </button>
                    )}
                  </div>

                  <button onClick={onGuardado}
                    className="w-full py-3 text-white font-bold text-xs rounded-xl transition-all shadow-lg hover:shadow-xl active:scale-[0.98] flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
                    <Plus size={14} /> Nueva cotización
                  </button>

                  <button onClick={onVolver}
                    className="w-full py-2.5 text-slate-400 hover:text-slate-600 font-medium text-xs transition-colors uppercase tracking-wide">
                    Volver a la lista
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <DetalleModal
          isOpen={showResumen}
          onClose={() => setShowResumen(false)}
          tipo="cotizacion"
          registro={{
            id: cotizacionId,
            numero: numDisplay ? Number(numDisplay.replace('COT-', '')) : 0,
            vendedor: { nombre: perfil?.nombre, color: perfil?.color },
            cliente: clienteSeleccionado,
            total_usd: totalUsd,
            costo_envio_usd: costoEnvioUsd,
            corte_usd: corteUsd,
            notas_cliente: notasCliente,
            creado_en: new Date().toISOString(),
          }}
          tasa={tasaHook.tasaEfectiva}
        />

      </div>



      {/* Modal confirmación despacho con stock insuficiente */}
      <ModalConfirmarDespacho
        isOpen={showModalDespachar}
        items={items.filter(it => {
          const esExterno = it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-') || String(it.codigoSnap).startsWith('EXT')
          if (esExterno) return false
          return stockMap[it.productoId] !== undefined && it.cantidad > stockMap[it.productoId]
        })}
        stockMap={stockMap}
        onConfirmar={() => {
          setShowModalDespachar(false)
          onDespachar?.({
            id: cotizacionId,
            numero: numDisplay.replace('COT-', '').replace(/^0+/, ''),
            total_usd: totalUsd,
            costo_envio_usd: Number(costoEnvioUsd) || 0,
            corte_usd: Number(corteUsd) || 0,
            cliente: { nombre: clienteSeleccionado?.nombre }
          })
        }}
        onCancelar={() => setShowModalDespachar(false)}
      />
      <ModalEditarExterno 
        isOpen={editItemIdx !== null}
        item={editItemIdx !== null ? items[editItemIdx] : null}
        onClose={() => setEditItemIdx(null)}
        onSave={(idx, nuevosCampos) => {
          setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...nuevosCampos } : it))
          setEditItemIdx(null)
          showToast('Producto actualizado', 'success')
        }}
        idx={editItemIdx}
      />

    </div>
  )
}

function ModalEditarExterno({ isOpen, item, onClose, onSave, idx }) {
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [precio, setPrecio] = useState('')
  const [unidad, setUnidad] = useState('')

  useEffect(() => {
    if (item && isOpen) {
      setNombre(item.nombreSnap || '')
      setCodigo(item.codigoSnap || '')
      setPrecio(item.precioUnitUsd || '')
      setUnidad(item.unidadSnap || '')
    }
  }, [item, isOpen])

  if (!isOpen || !item) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm p-5 space-y-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
            <Edit2 size={16} className="text-amber-500" /> Editar producto externo
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nombre del producto</label>
            <input 
              type="text" 
              value={nombre} 
              onChange={e => setNombre(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Código</label>
              <input 
                type="text" 
                value={codigo} 
                onChange={e => setCodigo(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unidad</label>
              <input 
                type="text" 
                value={unidad} 
                onChange={e => setUnidad(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Precio Unitario (USD)</label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="number" 
                step="0.01"
                value={precio} 
                onChange={e => setPrecio(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:outline-none font-bold text-slate-700"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">
            Cancelar
          </button>
          <button 
            onClick={() => onSave(idx, { nombreSnap: nombre, codigoSnap: codigo, precioUnitUsd: Number(precio), unidadSnap: unidad })}
            className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 active:scale-95 transition-all"
          >
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  )
}
