// src/components/despachos/EditDespachoModal.jsx
// Modal para editar forma de pago, transportista y notas de un despacho pendiente
import { useState, useEffect, useMemo } from 'react'
import { X, Pencil, Loader2, Truck, ChevronDown, StickyNote, Plus, User, Clock, DollarSign } from 'lucide-react'
import { useTransportistas, useCrearTransportista } from '../../hooks/useTransportistas'
import { useEditarDespacho } from '../../hooks/useDespachos'
import { useClientes } from '../../hooks/useClientes'
import { useFormasPago } from '../../hooks/useFormasPago'
import { useSaldoFavorOrigen } from '../../hooks/useCuentasCobrar'
import { useTasaCambio } from '../../hooks/useTasaCambio'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'
import { round2 } from '../../utils/dinero'
import CustomSelect from '../ui/CustomSelect'
import TransportistaFormCompact from '../transportistas/TransportistaFormCompact'
import ClienteForm from '../clientes/ClienteForm'
import { Modal } from '../ui/Modal'
import { showToast } from '../ui/Toast'
import useAuthStore from '../../store/useAuthStore'
import { ESTADOS, getCiudades } from '../../data/venezuelaGeo'
import { MapPin, Building } from 'lucide-react'

import { FORMAS_PAGO } from '../../constants/formasPago'


export default function EditDespachoModal({ isOpen, onClose, despacho }) {
  const { data: transportistas = [] } = useTransportistas()
  const { data: clientes = [] } = useClientes()
  const editarDespacho = useEditarDespacho()
  const crearTransp = useCrearTransportista()

  const [clienteId, setClienteId] = useState('')
  const clientesActivosParaDespacho = useMemo(() => {
    return clientes.filter(c => c.activo !== false || c.id === clienteId || c.id === despacho?.cliente_id)
  }, [clientes, clienteId, despacho?.cliente_id])
  const [referenciaPago, setReferenciaPago] = useState('')
  const [transportistaId, setTransportistaId] = useState('')
  const [fleteUsd, setFleteUsd] = useState('')
  const [corteUsd, setCorteUsd] = useState('')
  const [notas, setNotas] = useState('')
  const [showNuevoTransp, setShowNuevoTransp] = useState(false)
  const [showNuevoCliente, setShowNuevoCliente] = useState(false)
  const [nuevoError, setNuevoError] = useState('')
  const [esCod, setEsCod] = useState(false)
  const [direccionEnvioActiva, setDireccionEnvioActiva] = useState(false)
  const [direccionEnvioEstado, setDireccionEnvioEstado] = useState('')
  const [direccionEnvioCiudad, setDireccionEnvioCiudad] = useState('')
  const [direccionEnvioDireccion, setDireccionEnvioDireccion] = useState('')
  const perfil = useAuthStore(s => s.perfil)
  const [vueltoComoSaldoFavor, setVueltoComoSaldoFavor] = useState(false)
  const { tasaEfectiva: tasa = 0 } = useTasaCambio()
  const selectedCliente = useMemo(() => {
    return clientes.find(c => c.id === clienteId) || despacho?.cliente
  }, [clientes, clienteId, despacho])

  const esVendedorSinComision = useMemo(() => {
    if (!selectedCliente) return false
    return (
      selectedCliente.vendedor?.rol === 'vendedor_sin_comision' ||
      (selectedCliente.vendedor_id === perfil?.id && perfil?.rol === 'vendedor_sin_comision')
    )
  }, [selectedCliente, perfil])

  // 1. Cálculos derivados (necesarios para el hook)
  const totalBase = Number(despacho?.total_usd || 0) - Number(despacho?.flete_usd || 0) - Number(despacho?.corte_usd || 0)
  const totalParaPago = totalBase + (Number(corteUsd) || 0)
  const totalConFlete = totalParaPago + (Number(fleteUsd) || 0)

  const { data: saldoFavorOrigen } = useSaldoFavorOrigen(clienteId)

  // 2. Hook de formas de pago
  const {
    formasPago: pagosInmediatos,
    setFormas: setPagosInmediatos,
    toggleForma: togglePagoInmediato,
    setMontoForma: setMontoPagoInmediato,
    updateForma: updatePagoInmediato,
    resetFormas: resetPagosInmediatos,
    totalAsignado: totalInmediato,
    pagoCuadrado: pagoInmediatoCuadrado,
    hayVuelto: pagosInmediatosHayVuelto,
    diferencia: pagosInmediatosDiferencia,
  } = useFormasPago(totalConFlete)

  const handleTogglePagoInmediato = (metodo) => {
    if (metodo === 'Saldo a Favor') {
      const active = pagosInmediatos.some(f => f.metodo === 'Saldo a Favor')
      if (!active) {
        togglePagoInmediato('Saldo a Favor')
        setTimeout(() => {
          const available = Number(selectedCliente?.saldo_a_favor || 0)
          const actualAsignado = pagosInmediatos.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
          const restante = totalConFlete - actualAsignado
          const montoInicial = Math.min(restante > 0 ? restante : 0, available)
          updatePagoInmediato('Saldo a Favor', {
            monto: Number(montoInicial.toFixed(2)) || '',
            forma_pago_origen: saldoFavorOrigen || 'Crédito'
          })
        }, 50)
        return
      }
    }
    togglePagoInmediato(metodo)
  }

  const handleSetMontoPagoInmediato = (metodo, val) => {
    if (metodo === 'Saldo a Favor') {
      const maxVal = Number(selectedCliente?.saldo_a_favor || 0)
      let numVal = Number(val)
      if (numVal > maxVal) {
        val = String(maxVal)
      }
    }
    if (metodo === 'Cta por cobrar') {
      const sumOthers = pagosInmediatos
        .filter(p => p.metodo !== 'Cta por cobrar')
        .reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
      const maxVal = Math.max(0, totalConFlete - sumOthers)
      let numVal = Number(val)
      if (numVal > maxVal) {
        val = String(maxVal)
      }
    }
    setMontoPagoInmediato(metodo, val)
  }

  // El monto COD requerido es el total restante
  const montoCodRequerido = Math.max(0, round2(totalConFlete - totalInmediato))

  const {
    formasPago: propuestaCod,
    setFormas: setPropuestaCod,
    toggleForma: togglePropuestaCod,
    setMontoForma: setMontoPropuestaCod,
    updateForma: updatePropuestaCod,
    resetFormas: resetPropuestaCod,
    totalAsignado: totalPropuestaCod,
    pagoCuadrado: propuestaCodCuadrado,
  } = useFormasPago(montoCodRequerido)

  const cxcItem = pagosInmediatos.find(f => f.metodo === 'Cta por cobrar');
  const cxcVencimientoValido = !cxcItem || (
    cxcItem.diasVencimiento !== undefined &&
    cxcItem.diasVencimiento !== null &&
    !isNaN(cxcItem.diasVencimiento) &&
    Number(cxcItem.diasVencimiento) > 0
  );

  const formasPagoFinales = useMemo(() => {
    const inyectarVuelto = (fps) => {
      if (pagosInmediatosHayVuelto && vueltoComoSaldoFavor) {
        return fps.map((fp, i) => i === 0 ? { ...fp, vuelto_a_favor: true } : fp)
      }
      return fps
    }

    if (esCod) {
      return [
        ...inyectarVuelto(pagosInmediatos),
        {
          metodo: "Cobro a destino",
          monto: montoCodRequerido,
          diasVencimiento: 0,
          cobro_destino_pagado: false,
          metodo_propuesto: propuestaCod
        }
      ]
    } else {
      return inyectarVuelto(pagosInmediatos)
    }
  }, [esCod, pagosInmediatos, propuestaCod, totalConFlete, totalInmediato, montoCodRequerido, pagosInmediatosHayVuelto, vueltoComoSaldoFavor])

  const handleToggleCod = () => {
    setEsCod(prev => {
      const next = !prev;
      if (!next) {
        resetPropuestaCod();
      } else {
        resetPropuestaCod();
      }
      return next;
    });
  };

  // 3. Inicializar valores del despacho actual
  useEffect(() => {
    if (!despacho || !isOpen) return
    // Parsear forma de pago
    try {
      const fp = typeof despacho.forma_pago === 'string' ? JSON.parse(despacho.forma_pago) : despacho.forma_pago
      if (Array.isArray(fp)) {
        const codItem = fp.find(f => f.metodo === 'Cobro a destino')
        if (codItem) {
          setEsCod(true)
          setPropuestaCod(Array.isArray(codItem.metodo_propuesto) ? codItem.metodo_propuesto : [])
          setPagosInmediatos(fp.filter(f => f.metodo !== 'Cobro a destino'))
        } else {
          setEsCod(false)
          setPagosInmediatos(fp)
          setPropuestaCod([])
        }
      } else {
        setPagosInmediatos([])
        setPropuestaCod([])
      }
    } catch { 
      setPagosInmediatos([])
      setPropuestaCod([])
    }
    setReferenciaPago(despacho.referencia_pago || '')
    setTransportistaId(despacho.transportista_id || '')
    setFleteUsd(despacho.flete_usd ? String(Number(despacho.flete_usd)) : '')
    setCorteUsd(despacho.corte_usd ? String(Number(despacho.corte_usd)) : '')
    setNotas(despacho.notas || '')
    setClienteId(despacho.cliente_id || '')
    const dirAct = !!(despacho.direccion_envio_direccion || despacho.direccion_envio_ciudad || despacho.direccion_envio_estado)
    setDireccionEnvioActiva(dirAct)
    setDireccionEnvioEstado(despacho.direccion_envio_estado || '')
    setDireccionEnvioCiudad(despacho.direccion_envio_ciudad || '')
    setDireccionEnvioDireccion(despacho.direccion_envio_direccion || '')
  }, [despacho, isOpen, setPagosInmediatos, setPropuestaCod])

  if (!isOpen || !despacho) return null

  const numDisplay = despacho.cotizacion
    ? `DES-${String(despacho.cotizacion.numero).padStart(5, '0')}`
    : `DES-${String(despacho.numero).padStart(5, '0')}`


  async function handleGuardar() {
    const fpJson = JSON.stringify(formasPagoFinales)
    await editarDespacho.mutateAsync({
      despachoId: despacho.id,
      formaPago: fpJson,
      formaPagoCliente: fpJson,
      referenciaPago: referenciaPago || null,
      transportistaId: transportistaId || null,
      fleteUsd: Number(fleteUsd) || 0,
      corteUsd: Number(corteUsd) || 0,
      notas: notas || null,
      clienteId: clienteId || null,
      direccionEnvioDireccion: direccionEnvioActiva ? direccionEnvioDireccion : null,
      direccionEnvioCiudad: direccionEnvioActiva ? direccionEnvioCiudad : null,
      direccionEnvioEstado: direccionEnvioActiva ? direccionEnvioEstado : null,
    })
    onClose()
  }

  const cargando = editarDespacho.isPending

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-2xl p-4 sm:p-8 max-h-[90vh] flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <Pencil size={20} className="text-amber-500" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg">Editar despacho</h3>
              <p className="text-sm text-slate-500 font-mono">{numDisplay}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-24 space-y-5">

          {/* ── 0. Cliente ── */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente (Facturar a nombre de...)</p>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <CustomSelect
                  value={clienteId}
                  onChange={setClienteId}
                  options={clientesActivosParaDespacho.map(c => ({
                    value: c.id,
                    label: c.nombre,
                    sub: c.rif_cedula
                  }))}
                  placeholder="Seleccionar cliente..."
                  disabled={cargando}
                  searchable
                  icon={User}
                />
              </div>
              <button type="button"
                onClick={() => setShowNuevoCliente(true)}
                disabled={cargando}
                className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
                title="Crear nuevo cliente">
                <Plus size={16} className="text-emerald-600" />
              </button>
            </div>
          </div>

          {/* ── 1. Transportista ── */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transportista</p>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <CustomSelect
                  value={transportistaId}
                  onChange={(v) => {
                    setTransportistaId(v)
                    if (!v) setFleteUsd('')
                  }}
                  showSubInTrigger={false}
                  options={transportistas.map(t => ({
                    value: t.id,
                    label: `${t.nombre}${t.rif ? ` (${t.rif})` : ''}`,
                    selectedLabel: t.nombre,
                    sub: [t.vehiculo, t.placa_chuto ? `Placas: ${t.placa_chuto}${t.placa_batea ? `/${t.placa_batea}` : ''}` : '', t.color].filter(Boolean).join(' · ') || undefined
                  }))}
                  placeholder="Seleccionar transportista..."
                  disabled={cargando}
                  searchable
                  clearable
                  icon={Truck}
                />
              </div>
              <button type="button"
                onClick={() => setShowNuevoTransp(v => !v)}
                disabled={cargando}
                className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center transition-colors active:scale-95 disabled:opacity-50"
                title="Crear nuevo transportista">
                <Plus size={16} className="text-emerald-600" />
              </button>
            </div>

            {showNuevoTransp && (
              <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-lg p-3 sm:p-4 space-y-3">
                <p className="text-sm font-bold text-emerald-700">Nuevo transportista</p>
                {nuevoError && <p className="text-xs text-red-500 font-medium">{nuevoError}</p>}
                <TransportistaFormCompact
                  cargando={crearTransp.isPending}
                  onCancelar={() => { setShowNuevoTransp(false); setNuevoError('') }}
                  onGuardar={async (campos) => {
                    setNuevoError('')
                    try {
                      const nuevo = await crearTransp.mutateAsync(campos)
                      const idNuevo = nuevo.transportista?.id || nuevo.id
                      if (!idNuevo) throw new Error('No se pudo obtener el ID del transportista creado')
                      
                      setTransportistaId(idNuevo)
                      setShowNuevoTransp(false)
                      showToast.success('Transportista creado y seleccionado')
                    } catch (e) {
                      const msg = e.message || 'Error al crear'
                      setNuevoError(msg)
                      showToast.error(msg)
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* ── 2. Flete (solo si hay transportista) ── */}
          {transportistaId && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monto del flete (USD)</p>
              <input
                type="number" min="0" step="0.01" value={fleteUsd}
                onChange={e => setFleteUsd(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white transition-colors min-h-[44px]"
                disabled={cargando}
              />
              {Number(fleteUsd) > 0 && (
                <p className="text-xs text-indigo-500 font-medium">
                  + Flete: ${Number(fleteUsd).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
          )}

          {/* ── 3. Forma de pago ── */}
          <div className="space-y-2">
            {/* Toggle Cobro a destino (COD) */}
            <div className="mb-3 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-2.5 shadow-sm max-w-sm">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-rose-100 text-rose-600">
                  <Truck size={14} />
                </span>
                <div>
                  <span className="text-[11px] font-bold text-slate-700 block">¿Cobro a destino (COD)?</span>
                  <span className="text-[9px] text-slate-400">El cliente pagará al recibir</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleCod}
                disabled={cargando}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  esCod ? 'bg-rose-500' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    esCod ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* SECCIÓN 1: PAGO INMEDIATO (ADELANTO) */}
            <div className="space-y-2.5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {esCod ? 'Pago Inmediato (Adelanto / Seña)' : 'Formas de pago *'}
              </p>

              {/* Métodos activos de pagosInmediatos */}
              <div className="space-y-2">
                {pagosInmediatos.map(fp => {
                  const restante = totalConFlete - totalInmediato - totalPropuestaCod
                  return (
                    <div key={fp.metodo} className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-600 w-28 truncate">
                          {fp.metodo === 'Saldo a Favor'
                            ? `Saldo a Favor (${(fp.forma_pago_origen || 'Crédito').toUpperCase()})`
                            : fp.metodo}
                        </span>
                        <div className="relative flex-1 flex items-center">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={fp.monto}
                            onChange={e => handleSetMontoPagoInmediato(fp.metodo, e.target.value)}
                            onFocus={e => e.target.select()}
                            placeholder="0.00"
                            className="w-full pl-7 pr-3 py-2 rounded-lg text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white"
                            disabled={cargando}
                          />
                          {restante > 0.01 && (
                            <button type="button"
                              onClick={() => {
                                let amountToAssign = (Number(fp.monto) || 0) + restante
                                if (fp.metodo === 'Saldo a Favor') {
                                  const available = Number(selectedCliente?.saldo_a_favor || 0)
                                  if (amountToAssign > available) {
                                    amountToAssign = available
                                  }
                                }
                                handleSetMontoPagoInmediato(fp.metodo, Number(amountToAssign.toFixed(2)))
                              }}
                              className="ml-1 px-2.5 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors shrink-0 whitespace-nowrap"
                              title={`Sumar $${restante.toFixed(2)} restante`}>
                              Resto
                            </button>
                          )}
                        </div>
                        <button type="button"
                          onClick={() => handleTogglePagoInmediato(fp.metodo)}
                          disabled={cargando}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                          title="Eliminar forma de pago">
                          <X size={15} />
                        </button>
                      </div>
                      {fp.metodo === 'Cta por cobrar' && (
                        <div className="flex items-center gap-2 pl-28">
                          <span className="text-xs text-slate-500 font-medium">
                            Días venc. (obligatorio) *:
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={fp.diasVencimiento ?? ''}
                            onChange={e => updatePagoInmediato(fp.metodo, { diasVencimiento: e.target.value ? parseInt(e.target.value) : null })}
                            placeholder="Obligatorio"
                            className="w-28 px-2 py-1.5 rounded-lg text-xs border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white"
                            disabled={cargando}
                          />
                        </div>
                      )}

                      {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(fp.metodo) && (
                        <div className="flex items-center gap-2 pl-28">
                          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                            Referencia (opcional):
                          </span>
                          <input
                            type="text"
                            value={fp.referencia ?? ''}
                            onChange={e => updatePagoInmediato(fp.metodo, { referencia: e.target.value })}
                            placeholder="Ej: 12345"
                            className="flex-1 max-w-[200px] px-2 py-1.5 rounded-lg text-xs border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white"
                            disabled={cargando}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Chips para agregar métodos inmediatos */}
              <div className="flex flex-wrap gap-2">
                {/* Chip especial para Saldo a Favor */}
                {Number(selectedCliente?.saldo_a_favor || 0) > 0 && !pagosInmediatos.some(f => f.metodo === 'Saldo a Favor') && (
                  <button
                    type="button"
                    onClick={() => handleTogglePagoInmediato('Saldo a Favor')}
                    disabled={cargando}
                    className="px-4 py-2.5 rounded-lg text-sm font-black border bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-all min-h-[44px] flex items-center gap-1"
                  >
                    Saldo a Favor (${Number(selectedCliente.saldo_a_favor).toFixed(2)})
                  </button>
                )}

                {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && (m !== 'Donación' || perfil?.rol !== 'vendedor'))
                  .filter(m => m !== 'Saldo a Favor')
                  .filter(m => !pagosInmediatos.some(f => f.metodo === m))
                  .map(m => (
                    <button key={m} type="button"
                      onClick={() => handleTogglePagoInmediato(m)}
                      disabled={cargando}
                      className="px-4 py-2.5 rounded-lg text-sm font-semibold border bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition-all min-h-[44px]">
                      {m}
                    </button>
                  ))}
              </div>

              {esCod && pagosInmediatos.length === 0 && (
                <p className="text-xs text-slate-400 italic">No se registraron adelantos inmediatos.</p>
              )}

              {/* Banner de Vuelto / Excedente a Saldo a Favor */}
              {pagosInmediatosHayVuelto && (
                <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200">
                  <div className="flex items-start gap-2">
                    <span className="p-1 rounded-lg bg-indigo-100 text-indigo-600 shrink-0 mt-0.5">
                      <DollarSign size={14} />
                    </span>
                    <div>
                      <span className="text-[11px] font-black text-indigo-900 block">
                        El pago supera el total por ${pagosInmediatosDiferencia.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-indigo-600 font-bold leading-normal">
                        ¿Qué deseas hacer con la diferencia? {tasa > 0 && `(Equivale a ${fmtBs(pagosInmediatosDiferencia * tasa)})`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <span className="text-[10px] font-bold text-slate-500">Vuelto Físico</span>
                    <button
                      type="button"
                      onClick={() => setVueltoComoSaldoFavor(!vueltoComoSaldoFavor)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        vueltoComoSaldoFavor ? 'bg-indigo-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          vueltoComoSaldoFavor ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-[10px] font-black text-indigo-700">Saldo a Favor</span>
                  </div>
                </div>
              )}

              {!esCod && pagosInmediatos.length > 0 && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${
                  pagoInmediatoCuadrado
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : (totalInmediato - totalConFlete > 0.02)
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-red-50 text-red-600 border border-red-200'
                }`}>
                  <span>Asignado: ${totalInmediato.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span>Total (con flete): ${totalConFlete.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  {pagoInmediatoCuadrado ? (
                    <span className="text-emerald-500">✓</span>
                  ) : (totalInmediato - totalConFlete > 0.02) ? (
                    <span className="text-amber-600">Sobran ${(totalInmediato - totalConFlete).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  ) : (
                    <span className="text-red-400">Faltan ${Math.abs(totalInmediato - totalConFlete).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  )}
                </div>
              )}
            </div>

            {/* SECCIÓN 2: COBRO AL RECIBIR (COD) */}
            {esCod && (
              <div className="mt-4 p-3.5 bg-rose-50/50 border border-rose-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-rose-800">
                  <span>Monto a cobrar al recibir:</span>
                  <span className="text-sm font-extrabold text-rose-600">${montoCodRequerido.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                {montoCodRequerido > 0.015 ? (
                  <div className="space-y-3 border-t border-rose-100 pt-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      ¿Cómo pagará al recibir? (Propuesta) *
                    </label>

                    {/* Métodos activos de propuestaCod */}
                    <div className="space-y-2">
                      {propuestaCod.map(fp => {
                        const restanteCod = Math.max(0, round2(montoCodRequerido - totalPropuestaCod));
                        return (
                          <div key={fp.metodo} className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-rose-700 w-28 truncate">{fp.metodo}</span>
                              <div className="relative flex-1 flex items-center">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400 text-sm">$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={fp.monto}
                                  onChange={e => setMontoPropuestaCod(fp.metodo, e.target.value)}
                                  onFocus={e => e.target.select()}
                                  placeholder="0.00"
                                  className="w-full pl-7 pr-3 py-2 rounded-lg text-sm border border-rose-200 bg-white focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400/20"
                                  disabled={cargando}
                                />
                                {restanteCod > 0.01 && (
                                  <button type="button"
                                    onClick={() => setMontoPropuestaCod(fp.metodo, Number(((Number(fp.monto) || 0) + restanteCod).toFixed(2)))}
                                    className="ml-1 px-2.5 py-1 text-[10px] font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 rounded-lg transition-colors shrink-0 whitespace-nowrap"
                                    title={`Sumar $${restanteCod.toFixed(2)} restante`}>
                                    Resto
                                  </button>
                                )}
                              </div>
                              <button type="button"
                                onClick={() => togglePropuestaCod(fp.metodo)}
                                disabled={cargando}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                                title="Eliminar propuesta">
                                <X size={15} />
                              </button>
                            </div>
                            {['Transf. / Pago Móvil', 'Transferencia', 'Pago Móvil'].includes(fp.metodo) && (
                              <div className="flex items-center gap-2 pl-28 mt-1">
                                <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                                  Referencia (opcional):
                                </span>
                                <input
                                  type="text"
                                  value={fp.referencia ?? ''}
                                  onChange={e => updatePropuestaCod(fp.metodo, { referencia: e.target.value })}
                                  placeholder="Ej: 12345"
                                  className="flex-1 max-w-[200px] px-2 py-1.5 rounded-lg text-xs border border-rose-200 bg-white focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400/20"
                                  disabled={cargando}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Chips de propuestaCod */}
                    {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && m !== 'Cta por cobrar' && m !== 'Donación')
                      .some(m => !propuestaCod.some(f => f.metodo === m)) && (
                      <div className="flex flex-wrap gap-2">
                        {FORMAS_PAGO.filter(m => m !== 'Cobro a destino' && m !== 'Cta por cobrar' && m !== 'Donación')
                          .filter(m => !propuestaCod.some(f => f.metodo === m))
                          .map(m => (
                            <button key={m} type="button"
                              onClick={() => togglePropuestaCod(m)}
                              disabled={cargando}
                              className="px-4 py-2.5 rounded-lg text-sm font-semibold border bg-white text-rose-600 border-rose-200 hover:border-rose-300 hover:text-rose-700 transition-all min-h-[44px]">
                              {m}
                            </button>
                          ))}
                      </div>
                    )}

                    {/* Validador de suma de propuestas */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${
                      propuestaCodCuadrado
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : (totalPropuestaCod - montoCodRequerido > 0.02)
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      <span>Asignado COD: ${totalPropuestaCod.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      {propuestaCodCuadrado ? (
                        <span className="text-emerald-500">✓</span>
                      ) : (totalPropuestaCod - montoCodRequerido > 0.02) ? (
                        <span className="text-amber-600">Sobran ${(totalPropuestaCod - montoCodRequerido).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      ) : (
                        <span className="text-rose-700 font-bold">Faltan ${Math.abs(totalPropuestaCod - montoCodRequerido).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-amber-600 font-medium bg-amber-50 border border-amber-200 p-2 rounded-lg">
                    El monto asignado en pagos inmediatos ya cubre el total.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Dirección de Envío Opcional */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                  <MapPin size={15} />
                </span>
                <div>
                  <span className="text-[11px] font-bold text-slate-700 block">¿Enviar a otra dirección?</span>
                  <span className="text-[9px] text-slate-400">Especificar dirección alternativa de entrega</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDireccionEnvioActiva(v => !v)}
                disabled={cargando}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  direccionEnvioActiva ? 'bg-indigo-500' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    direccionEnvioActiva ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {direccionEnvioActiva && (
              <div className="space-y-3 border-t border-slate-200/60 pt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Estado *</label>
                    <CustomSelect
                      options={ESTADOS.map(e => ({ value: e, label: e }))}
                      value={direccionEnvioEstado}
                      onChange={val => {
                        setDireccionEnvioEstado(val)
                        setDireccionEnvioCiudad('')
                      }}
                      placeholder="Elegir..."
                      icon={MapPin}
                      searchable
                      disabled={cargando}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Ciudad *</label>
                    <CustomSelect
                      options={(direccionEnvioEstado ? getCiudades(direccionEnvioEstado) : []).map(c => ({ value: c, label: c }))}
                      value={direccionEnvioCiudad}
                      onChange={setDireccionEnvioCiudad}
                      placeholder={direccionEnvioEstado ? 'Elegir...' : 'Falta estado'}
                      icon={Building}
                      disabled={cargando || !direccionEnvioEstado}
                      searchable
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Dirección (Opcional)</label>
                  <input
                    type="text"
                    value={direccionEnvioDireccion}
                    onChange={e => setDireccionEnvioDireccion(e.target.value)}
                    placeholder="Ej: Av. Principal, Local 4..."
                    className="w-full px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    disabled={cargando}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── 4. Notas ── */}

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <StickyNote size={13} /> Notas / observaciones
            </p>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Observaciones adicionales..."
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl text-sm border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 focus:bg-white resize-none"
              disabled={cargando}
            />
          </div>

        </div>{/* fin scrollable */}

        {/* Botones */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button onClick={onClose} disabled={cargando}
            className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-base hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleGuardar} disabled={
            cargando ||
            !(esCod ? (montoCodRequerido > 0.015 && propuestaCodCuadrado) : pagoInmediatoCuadrado) ||
            !cxcVencimientoValido ||
            (direccionEnvioActiva && (!direccionEnvioEstado || !direccionEnvioCiudad))
          }
            title={
              !cxcVencimientoValido
                ? 'Días de vencimiento obligatorios para cuentas por cobrar'
                : direccionEnvioActiva && (!direccionEnvioEstado || !direccionEnvioCiudad)
                ? 'Debe seleccionar un Estado y una Ciudad para el envío'
                : esCod
                ? (!propuestaCodCuadrado ? 'La propuesta COD no está cuadrada' : undefined)
                : (!pagoInmediatoCuadrado ? 'Los montos no cuadran con el total' : undefined)
            }
            className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20">
            {cargando
              ? <><Loader2 size={16} className="animate-spin" />Guardando...</>
              : <><Pencil size={16} />Guardar cambios</>}
          </button>
        </div>
      </div>

      {/* Modal: Nuevo Cliente */}
      <Modal 
        isOpen={showNuevoCliente} 
        onClose={() => setShowNuevoCliente(false)} 
        title="Nuevo cliente"
        className="sm:max-w-2xl"
      >
        <ClienteForm 
          onSuccess={(nuevo) => {
            const cid = nuevo?.cliente?.id || nuevo?.id
            if (cid) setClienteId(cid)
            setShowNuevoCliente(false)
          }}
          onCancel={() => setShowNuevoCliente(false)}
        />
      </Modal>

    </div>
  )
}
