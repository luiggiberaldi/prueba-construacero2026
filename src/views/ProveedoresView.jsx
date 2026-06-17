// src/views/ProveedoresView.jsx
// Vista principal del módulo de Proveedores y Cuentas por Pagar (CxP)
import { useState, useMemo, useEffect, useCallback } from 'react'
import { Briefcase, Plus, Search, RefreshCw, X, LayoutGrid, List, Filter, ChevronDown, Check, AlertCircle, Trash2, ArrowUpCircle, ArrowDownCircle, PlusCircle, User, Hash, Phone, Mail, MapPin, StickyNote, Clock, Pencil } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import { useProveedores, useBorrarProveedor, useCuentasPorPagar, useRegistrarTransaccionCxP, useActualizarTransaccionCxP } from '../hooks/useProveedores'
import ProveedorForm from '../components/proveedores/ProveedorForm'
import { Modal } from '../components/ui/Modal'
import ConfirmModal from '../components/ui/ConfirmModal'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import Pagination from '../components/ui/Pagination'
import PageHeader from '../components/ui/PageHeader'
import { showToast } from '../components/ui/Toast'

const ITEMS_POR_PAGINA = 12

function fmtUsd(val) {
  const num = Number(val || 0)
  return `$${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

// ─── Dropdown custom ──────────────────────────────────────────────────────────
function Dropdown({ value, onChange, placeholder, options }) {
  const [open, setOpen] = useState(false)
  
  useEffect(() => {
    function handleClick() { setOpen(false) }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 text-sm font-semibold border rounded-xl pl-3 pr-2.5 py-2 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary ${
          value ? 'bg-primary-light border-primary/30 text-primary' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
        }`}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 min-w-[180px] bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-200/50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false) }}
            className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 transition-colors ${
              !value ? 'bg-primary-light text-primary font-semibold' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {!value && <Check size={14} className="text-primary" />}
            <span className={!value ? '' : 'pl-[22px]'}>{placeholder}</span>
          </button>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 transition-colors ${
                value === opt.value ? 'bg-primary-light text-primary font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {value === opt.value && <Check size={14} className="text-primary" />}
              <span className={value === opt.value ? '' : 'pl-[22px]'}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Skeletons ────────────────────────────────────────────────────────────────
function SkeletonProveedores() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-5 w-3/4 rounded-lg" />
          <Skeleton className="h-3.5 w-1/2 rounded-lg" />
          <Skeleton className="h-3.5 w-2/3 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

// ─── Componente para Editar Movimiento Contable (CxP) ─────────────────────────
function EditarMovimientoForm({ movimiento, proveedorId, onSuccess, onCancel }) {
  const mutation = useActualizarTransaccionCxP()
  const [monto, setMonto] = useState(movimiento.monto_usd || '')
  const [descripcion, setDescripcion] = useState(movimiento.descripcion || '')
  const [fechaVencimiento, setFechaVencimiento] = useState(movimiento.fecha_vencimiento ? movimiento.fecha_vencimiento.slice(0, 10) : '')
  const [formaPago, setFormaPago] = useState(movimiento.forma_pago_abono || 'Efectivo $')
  const [referencia, setReferencia] = useState(movimiento.referencia || '')
  const [error, setError] = useState('')

  const FORM_PAGOS = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'USDT', 'Cruce']

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const montoNum = Number(monto)
    if (isNaN(montoNum) || montoNum <= 0) {
      setError('El monto debe ser un número mayor a cero')
      return
    }

    try {
      await mutation.mutateAsync({
        id: movimiento.id,
        proveedorId,
        monto: montoNum,
        descripcion: descripcion.trim(),
        fechaVencimiento: movimiento.tipo === 'cargo' && fechaVencimiento ? new Date(fechaVencimiento).toISOString() : null,
        formaPago: movimiento.tipo === 'abono' ? formaPago : null,
        referencia: movimiento.tipo === 'abono' ? referencia : null,
      })
      showToast('Movimiento actualizado con éxito', 'success')
      onSuccess()
    } catch (err) {
      setError(err.message || 'Error al actualizar el movimiento')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Monto USD *</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={monto}
          onChange={e => setMonto(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Descripción / Concepto *</label>
        <input
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
          required
        />
      </div>

      {movimiento.tipo === 'cargo' && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Fecha de vencimiento</label>
          <input
            type="date"
            value={fechaVencimiento}
            onChange={e => setFechaVencimiento(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
          />
        </div>
      )}

      {movimiento.tipo === 'abono' && (
        <>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Forma de pago *</label>
            <select
              value={formaPago}
              onChange={e => setFormaPago(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
            >
              {FORM_PAGOS.map(fp => <option key={fp} value={fp}>{fp}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Referencia</label>
            <input
              type="text"
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}

      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-sm font-semibold text-slate-600 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          {mutation.isPending ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>
    </form>
  )
}

// ─── Modal Ficha del Proveedor (CxP) ──────────────────────────────────────────
function FichaProveedorModal({ proveedor, isOpen, onClose, onEditar, onBorrar, onEditarMovimiento }) {
  const { data: movimientos = [], isLoading, refetch } = useCuentasPorPagar(isOpen ? proveedor?.id : null)
  const registrarTransaccion = useRegistrarTransaccionCxP()
  const [saldoLocal, setSaldoLocal] = useState(0)

  // Campos para nueva transacción CxP
  const [transTipo, setTransTipo] = useState('cargo') // 'cargo' | 'abono'
  const [transMonto, setTransMonto] = useState('')
  const [transFormaPago, setTransFormaPago] = useState('Efectivo $')
  const [transReferencia, setTransReferencia] = useState('')
  const [transDescripcion, setTransDescripcion] = useState('')
  const [transDiasVencimiento, setTransDiasVencimiento] = useState('0')
  const [errorTrans, setErrorTrans] = useState('')

  const FORM_PAGOS = ['Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'USDT', 'Cruce']

  useEffect(() => {
    if (proveedor) {
      setSaldoLocal(Number(proveedor.saldo_pendiente || 0))
    }
  }, [proveedor])

  if (!isOpen || !proveedor) return null

  async function handleNuevaTransaccion(e) {
    e.preventDefault()
    setErrorTrans('')
    const montoNum = Number(transMonto)
    if (isNaN(montoNum) || montoNum <= 0) {
      setErrorTrans('El monto debe ser un número mayor a cero')
      return
    }

    if (transTipo === 'abono' && montoNum > saldoLocal + 0.01) {
      setErrorTrans(`El abono no puede superar la deuda actual de ${fmtUsd(saldoLocal)}`)
      return
    }

    const diasNum = transTipo === 'cargo' ? parseInt(transDiasVencimiento, 10) : null;

    try {
      const result = await registrarTransaccion.mutateAsync({
        proveedorId: proveedor.id,
        tipo: transTipo,
        monto: montoNum,
        formaPago: transTipo === 'abono' ? transFormaPago : null,
        referencia: transTipo === 'abono' ? transReferencia : null,
        descripcion: transDescripcion.trim() || undefined,
        diasVencimiento: diasNum && !isNaN(diasNum) && diasNum > 0 ? diasNum : null,
      })

      setSaldoLocal(result.nuevoSaldo)
      setTransMonto('')
      setTransReferencia('')
      setTransDescripcion('')
      setTransDiasVencimiento('0')
      showToast('Transacción registrada con éxito', 'success')
      refetch()
    } catch (err) {
      setErrorTrans(err.message || 'Error al registrar la transacción')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Card container */}
      <div className="relative bg-white dark:bg-slate-900 rounded-[2rem] w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-100">
        
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-br from-slate-800 to-slate-900 text-white shrink-0 relative">
          <button onClick={onClose} className="absolute right-4 top-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
            <X size={16} />
          </button>
          
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center font-black border-2 border-white/20 text-white shrink-0">
              {proveedor.nombre.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-black">{proveedor.nombre}</h3>
              <p className="text-xs text-slate-300 font-mono mt-0.5">{proveedor.rif_cedula || 'Sin RIF'}</p>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <div className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 ${
              saldoLocal > 0 ? 'bg-red-500/20 text-red-200 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
            }`}>
              <AlertCircle size={13} />
              {saldoLocal > 0 ? `Por pagar: ${fmtUsd(saldoLocal)}` : 'Sin deudas'}
            </div>
            <span className="bg-white/10 text-white/80 border border-white/20 px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase">
              {proveedor.tipo_proveedor}
            </span>
          </div>
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Info general */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/60 text-xs space-y-2 text-slate-600">
            <div className="grid grid-cols-2 gap-2">
              <p><strong>Teléfono:</strong> {proveedor.telefono || '—'}</p>
              <p><strong>Email:</strong> {proveedor.email || '—'}</p>
              <p><strong>Ubicación:</strong> {proveedor.ciudad ? `${proveedor.ciudad}, ${proveedor.estado}` : '—'}</p>
              <p><strong>Dirección:</strong> {proveedor.direccion || '—'}</p>
            </div>
            {proveedor.notes || proveedor.notas ? (
              <p className="border-t border-slate-200 pt-2 mt-2"><strong>Notas:</strong> {proveedor.notas || proveedor.notes}</p>
            ) : null}
            
            {/* Acciones principales de ficha */}
            <div className="flex gap-2 pt-3 border-t border-slate-200 mt-2">
              <button
                onClick={() => onEditar(proveedor)}
                className="flex-1 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 font-bold text-slate-700 transition-all text-center"
              >
                Editar Ficha
              </button>
              <button
                onClick={() => onBorrar(proveedor)}
                className="py-2 px-3 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white transition-all text-center flex items-center justify-center gap-1"
                title="Eliminar Proveedor"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Formulario transaccion */}
          <form onSubmit={handleNuevaTransaccion} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <PlusCircle size={15} className="text-slate-500" />
              Registrar cargo o abono contable
            </h4>

            {/* Tipo cargo / abono */}
            <div className="flex p-0.5 bg-slate-200/80 rounded-xl h-9">
              <button
                type="button"
                onClick={() => { setTransTipo('cargo'); setErrorTrans('') }}
                className={`flex-1 text-xs font-bold rounded-lg transition-all ${transTipo === 'cargo' ? 'bg-white shadow text-red-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Cargo (Deuda)
              </button>
              <button
                type="button"
                onClick={() => { setTransTipo('abono'); setErrorTrans('') }}
                className={`flex-1 text-xs font-bold rounded-lg transition-all ${transTipo === 'abono' ? 'bg-white shadow text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Abono (Pago)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Monto USD *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={transMonto}
                  onChange={e => { setTransMonto(e.target.value); setErrorTrans('') }}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
                  required
                />
              </div>

              {/* Si es abono, muestra formas de pago */}
              {transTipo === 'abono' && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Forma de pago *</label>
                  <select
                    value={transFormaPago}
                    onChange={e => setTransFormaPago(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
                  >
                    {FORM_PAGOS.map(fp => <option key={fp} value={fp}>{fp}</option>)}
                  </select>
                </div>
              )}

              {/* Si es cargo, muestra días de vencimiento */}
              {transTipo === 'cargo' && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Días de vencimiento</label>
                  <input
                    type="number"
                    min="0"
                    value={transDiasVencimiento}
                    onChange={e => setTransDiasVencimiento(e.target.value)}
                    placeholder="0 (inmediato)"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
                  />
                </div>
              )}
            </div>

            {transTipo === 'abono' && (
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Referencia (opcional)</label>
                <input
                  type="text"
                  value={transReferencia}
                  onChange={e => setTransReferencia(e.target.value)}
                  placeholder="Comprobante, transferencia..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
                />
              </div>
            )}

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Descripción / Concepto</label>
              <input
                type="text"
                value={transDescripcion}
                onChange={e => setTransDescripcion(e.target.value)}
                placeholder={transTipo === 'cargo' ? 'Cargo (Deuda registrada)' : 'Abono (Pago registrado)'}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-800"
              />
            </div>

            {errorTrans && <p className="text-xs text-red-500 font-semibold">{errorTrans}</p>}

            <button
              type="submit"
              disabled={registrarTransaccion.isPending}
              className={`w-full py-2.5 text-white text-xs font-black rounded-xl transition-all shadow-md ${
                transTipo === 'cargo' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {registrarTransaccion.isPending ? 'Procesando...' : transTipo === 'cargo' ? 'Registrar Cargo (Deuda)' : 'Confirmar Abono (Pago)'}
            </button>
          </form>

          {/* Historial contable */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={15} className="text-slate-500" />
                Historial de movimientos (CxP)
              </h4>
              <button onClick={() => refetch()} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}
              </div>
            ) : movimientos.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-2xl">
                Sin movimientos registrados aún
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {movimientos.map(mov => {
                  const isVencido = mov.fecha_vencimiento && new Date(mov.fecha_vencimiento) < new Date() && saldoLocal > 0;
                  return (
                    <div key={mov.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl border text-xs ${
                      mov.tipo === 'cargo' ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'
                    }`}>
                      {mov.tipo === 'cargo' ? (
                        <ArrowUpCircle size={16} className="text-red-500 shrink-0" />
                      ) : (
                        <ArrowDownCircle size={16} className="text-emerald-500 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-700 truncate">{mov.descripcion}</p>
                        <p className="text-[10px] text-slate-400">
                          {fmtFecha(mov.creado_en)}
                          {mov.registrador?.nombre ? ` · por ${mov.registrador.nombre}` : ''}
                        </p>
                        {mov.forma_pago_abono && (
                          <p className="text-[9px] text-slate-400 font-bold">
                            FP: {mov.forma_pago_abono} {mov.referencia ? `· Ref: ${mov.referencia}` : ''}
                          </p>
                        )}
                        {mov.fecha_vencimiento && mov.tipo === 'cargo' && (
                          <p className={`text-[9px] font-bold mt-0.5 ${isVencido ? 'text-red-600 font-black' : 'text-slate-500'}`}>
                            Vence: {new Date(mov.fecha_vencimiento).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {isVencido ? ' (Vencido)' : ''}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-2">
                        <div>
                          <p className={`font-black ${mov.tipo === 'cargo' ? 'text-red-600' : 'text-emerald-600'}`}>
                            {mov.tipo === 'cargo' ? '+' : '-'}{fmtUsd(mov.monto_usd)}
                          </p>
                          <p className="text-[10px] text-slate-400">Saldo: {fmtUsd(mov.saldo_usd)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onEditarMovimiento(mov)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/50 transition-colors shrink-0"
                          title="Editar"
                        >
                          <Pencil size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Componente de Carta Individual ───────────────────────────────────────────
function ProveedorCard({ proveedor, onEditar, onBorrar, onVerFicha }) {
  const saldo = Number(proveedor.saldo_pendiente || 0)
  
  return (
    <div
      onClick={() => onVerFicha(proveedor)}
      className="bg-white hover:bg-slate-50/50 rounded-2xl border border-slate-200 p-4 transition-all hover:shadow-md cursor-pointer flex flex-col justify-between h-40 group relative overflow-hidden"
    >
      {/* Background decorativo */}
      <div className="absolute -right-4 -bottom-4 w-12 h-12 bg-slate-50 rounded-full group-hover:scale-150 transition-all duration-300 pointer-events-none" />

      <div className="space-y-1 z-10">
        <div className="flex justify-between items-start gap-2">
          <h4 className="font-black text-slate-800 text-sm group-hover:text-primary transition-colors leading-snug line-clamp-2">
            {proveedor.nombre}
          </h4>
          {!proveedor.activo && (
            <span className="bg-slate-100 text-slate-400 text-[9px] px-1.5 py-0.5 rounded border border-slate-200 font-bold shrink-0 uppercase select-none">
              Inactivo
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 font-mono">{proveedor.rif_cedula || 'Sin RIF'}</p>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-semibold pt-1">
          {proveedor.telefono && <span className="flex items-center gap-1"><Phone size={10} />{proveedor.telefono}</span>}
          {proveedor.ciudad && <span className="flex items-center gap-1"><MapPin size={10} />{proveedor.ciudad}</span>}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between z-10 mt-auto">
        <div className="flex flex-col">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Cuentas por Pagar</span>
          <span className={`text-sm font-black ${saldo > 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {fmtUsd(saldo)}
          </span>
        </div>
        
        <button
          onClick={e => { e.stopPropagation(); onEditar(proveedor) }}
          className="text-xs font-bold text-slate-400 hover:text-slate-800 transition-colors p-1"
        >
          Editar
        </button>
      </div>
    </div>
  )
}

// ─── Vista Principal ──────────────────────────────────────────────────────────
export default function ProveedoresView() {
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('activos')
  const [pagina, setPagina] = useState(1)

  // Modales
  const [modalFormOpen, setModalFormOpen] = useState(false)
  const [proveedorEditando, setProveedorEditando] = useState(null)
  
  const [proveedorFicha, setProveedorFicha] = useState(null)
  const [fichaOpen, setFichaOpen] = useState(false)

  const [proveedorBorrando, setProveedorBorrando] = useState(null)
  const [confirmBorrarOpen, setConfirmBorrarOpen] = useState(false)
  const [movimientoEditando, setMovimientoEditando] = useState(null)

  const { data: proveedores = [], isLoading, isError, refetch } = useProveedores(busqueda)
  const borrarProveedor = useBorrarProveedor()

  const proveedorFichaLive = useMemo(() => {
    if (!proveedorFicha) return null
    return proveedores.find(p => p.id === proveedorFicha.id) || proveedorFicha
  }, [proveedores, proveedorFicha])

  // Debounce búsqueda
  useEffect(() => {
    const timer = setTimeout(() => {
      setBusqueda(textoBusqueda)
      setPagina(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [textoBusqueda])

  const proveedoresFiltrados = useMemo(() => {
    const list = proveedores.filter(p => {
      if (filtroTipo && p.tipo_proveedor !== filtroTipo) return false
      if (filtroEstado === 'activos' && !p.activo) return false
      if (filtroEstado === 'desactivados' && p.activo) return false
      return true
    })

    // Ordenamiento: proveedores con deuda primero
    return [...list].sort((a, b) => {
      const saldoA = Number(a.saldo_pendiente || 0)
      const saldoB = Number(b.saldo_pendiente || 0)
      if (saldoA !== saldoB) return saldoB - saldoA
      return (a.nombre || '').localeCompare(b.nombre || '')
    })
  }, [proveedores, filtroTipo, filtroEstado])

  const totalPaginas = Math.max(1, Math.ceil(proveedoresFiltrados.length / ITEMS_POR_PAGINA))
  const proveedoresPaginados = useMemo(() => {
    const inicio = (pagina - 1) * ITEMS_POR_PAGINA
    return proveedoresFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA)
  }, [proveedoresFiltrados, pagina])

  function limpiarBusqueda() {
    setTextoBusqueda('')
    setBusqueda('')
    setPagina(1)
  }

  function abrirCrear() {
    setProveedorEditando(null)
    setModalFormOpen(true)
  }

  function abrirEditar(prov) {
    setProveedorEditando(prov)
    setModalFormOpen(true)
  }

  function abrirBorrar(prov) {
    setProveedorBorrando(prov)
    setConfirmBorrarOpen(true)
  }

  async function handleBorrar() {
    if (!proveedorBorrando) return
    try {
      const result = await borrarProveedor.mutateAsync(proveedorBorrando.id)
      if (result.accion === 'eliminado') {
        showToast(`"${result.nombre}" eliminado permanentemente`, 'success')
      } else {
        showToast(`"${result.nombre}" marcado como inactivo (tiene historial)`, 'warning')
      }
      setFichaOpen(false)
      setProveedorFicha(null)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setConfirmBorrarOpen(false)
      setProveedorBorrando(null)
    }
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5">
      
      {/* Page Header */}
      <PageHeader
        icon={Briefcase}
        title="Proveedores"
        subtitle={isLoading ? 'Cargando...' : `${proveedoresFiltrados.length} proveedor${proveedoresFiltrados.length !== 1 ? 'es' : ''}`}
        action={
          <button onClick={abrirCrear} className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
            <Plus size={16} /> Registrar Proveedor
          </button>
        }
      />

      {/* Barra de búsqueda */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={textoBusqueda}
            onChange={e => setTextoBusqueda(e.target.value)}
            placeholder="Buscar por nombre, RIF o teléfono..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-slate-400"
          />
          {textoBusqueda && (
            <button onClick={limpiarBusqueda} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => refetch()}
          title="Actualizar lista"
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
          <Filter size={13} />
          Filtros:
        </div>

        <Dropdown
          value={filtroTipo}
          onChange={v => { setFiltroTipo(v); setPagina(1) }}
          placeholder="Todos los tipos"
          options={[
            { value: 'natural', label: 'Natural' },
            { value: 'juridico', label: 'Jurídico' },
          ]}
        />

        <Dropdown
          value={filtroEstado}
          onChange={v => { setFiltroEstado(v); setPagina(1) }}
          placeholder="Todos los estados"
          options={[
            { value: 'activos', label: 'Solo activos' },
            { value: 'desactivados', label: 'Solo inactivos' },
          ]}
        />
      </div>

      {/* Contenido */}
      {isLoading ? (
        <SkeletonProveedores />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <p className="font-semibold">Error al cargar los proveedores</p>
          <button onClick={() => refetch()} className="mt-3 text-sm underline text-red-600 hover:text-red-800">
            Intentar de nuevo
          </button>
        </div>
      ) : proveedores.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={busqueda ? 'Sin resultados' : 'No hay proveedores registrados'}
          description={busqueda ? `No se encontraron proveedores con "${busqueda}"` : 'Registra tu primer proveedor para llevar el control de tus deudas.'}
          actionLabel={busqueda ? 'Limpiar búsqueda' : 'Registrar Proveedor'}
          onAction={busqueda ? limpiarBusqueda : abrirCrear}
        />
      ) : proveedoresFiltrados.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="Sin resultados"
          description="No hay proveedores que coincidan con los filtros aplicados."
          actionLabel="Limpiar filtros"
          onAction={() => { setFiltroTipo(''); setFiltroEstado('activos') }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {proveedoresPaginados.map(prov => (
            <ProveedorCard
              key={prov.id}
              proveedor={prov}
              onEditar={abrirEditar}
              onBorrar={abrirBorrar}
              onVerFicha={p => { setProveedorFicha(p); setFichaOpen(true) }}
            />
          ))}
        </div>
      )}

      {/* Paginación */}
      {!isLoading && proveedoresFiltrados.length > ITEMS_POR_PAGINA && (
        <Pagination
          paginaActual={pagina}
          totalPaginas={totalPaginas}
          onCambiarPagina={setPagina}
        />
      )}

      {/* Modal Formulario */}
      <Modal
        isOpen={modalFormOpen}
        onClose={() => setModalFormOpen(false)}
        title={proveedorEditando ? 'Editar Proveedor' : 'Nuevo Proveedor'}
      >
        <ProveedorForm
          proveedor={proveedorEditando}
          onSuccess={() => setModalFormOpen(false)}
          onCancel={() => setModalFormOpen(false)}
        />
      </Modal>

      {/* Modal Ficha / Detalle */}
      <FichaProveedorModal
        proveedor={proveedorFichaLive}
        isOpen={fichaOpen}
        onClose={() => { setFichaOpen(false); setProveedorFicha(null) }}
        onEditar={(p) => { setFichaOpen(false); abrirEditar(p) }}
        onBorrar={(p) => abrirBorrar(p)}
        onEditarMovimiento={setMovimientoEditando}
      />

      {/* Modal Anidado para Editar el Movimiento */}
      {movimientoEditando && (
        <Modal
          isOpen={!!movimientoEditando}
          onClose={() => setMovimientoEditando(null)}
          title="Editar Movimiento CxP"
        >
          <EditarMovimientoForm
            movimiento={movimientoEditando}
            proveedorId={proveedorFichaLive?.id}
            onSuccess={() => setMovimientoEditando(null)}
            onCancel={() => setMovimientoEditando(null)}
          />
        </Modal>
      )}

      {/* Modal Confirmar Borrado */}
      <ConfirmModal
        isOpen={confirmBorrarOpen}
        onClose={() => { setConfirmBorrarOpen(false); setProveedorBorrando(null) }}
        onConfirm={handleBorrar}
        loading={borrarProveedor.isPending}
        title="Eliminar Proveedor"
        message={
          proveedorBorrando
            ? Number(proveedorBorrando.saldo_pendiente || 0) > 0
              ? `"${proveedorBorrando.nombre}" tiene un saldo pendiente de ${fmtUsd(proveedorBorrando.saldo_pendiente)} y no puede eliminarse. Liquida la deuda primero.`
              : `¿Eliminar a "${proveedorBorrando.nombre}"? Si tiene transacciones históricas en CxP, quedará inactivo. Si no tiene historial, se borrará permanentemente.`
            : ''
        }
        confirmLabel="Eliminar"
        confirmVariant="danger"
      />

    </div>
  )
}
