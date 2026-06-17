// src/components/transportistas/TransportistaFormCompact.jsx
// Formulario compacto reutilizable para crear transportista
import { useState } from 'react'

import { PREFIJOS_RIF, formatearRif } from '../../utils/rif'

export default function TransportistaFormCompact({ onGuardar, onCancelar, cargando }) {
  const [rifPrefijo, setRifPrefijo] = useState('V')
  const [rifNumero, setRifNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState('')
  const [vehiculo, setVehiculo] = useState('')
  const [placaChuto, setPlacaChuto] = useState('')
  const [placaBatea, setPlacaBatea] = useState('')
  const [colorBatea, setColorBatea] = useState('')
  const [zonaCobertura, setZonaCobertura] = useState('')
  const [capacidad, setCapacidad] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    onGuardar({
      nombre,
      rif: formatearRif(rifPrefijo, rifNumero),
      color,
      vehiculo,
      placa_chuto: placaChuto,
      placa_batea: placaBatea,
      color_batea: colorBatea,
      zona_cobertura: zonaCobertura,
      capacidad,
    })
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 placeholder:text-slate-400'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Nombre *</label>
          <input value={nombre} onChange={e => { setNombre(e.target.value.replace(/(^|\s)\S/g, c => c.toUpperCase())); setError('') }}
            placeholder="Nombre del transportista" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Cédula / RIF</label>
          <div className="flex gap-1 mb-1">
            {PREFIJOS_RIF.map(p => (
              <button key={p} type="button" disabled={cargando}
                onClick={() => setRifPrefijo(p)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                  rifPrefijo === p ? 'bg-sky-500 text-white shadow-sm scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
              className={`${inputCls} !rounded-l-none`} disabled={cargando} inputMode="numeric" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Color</label>
          <input value={color} onChange={e => setColor(e.target.value)}
            placeholder="Ej: Rojo, Blanco" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Vehículo</label>
          <input value={vehiculo} onChange={e => setVehiculo(e.target.value)}
            placeholder="Ej: Mack Granite 2020" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa chuto</label>
          <input value={placaChuto} onChange={e => setPlacaChuto(e.target.value.toUpperCase())}
            placeholder="Ej: AB123CD" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Placa batea</label>
          <input value={placaBatea} onChange={e => setPlacaBatea(e.target.value.toUpperCase())}
            placeholder="Ej: XY456ZW" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Color batea</label>
          <input value={colorBatea} onChange={e => setColorBatea(e.target.value)}
            placeholder="Ej: Blanco, Amarillo" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Cobertura (Zonas)</label>
          <input value={zonaCobertura} onChange={e => setZonaCobertura(e.target.value)}
            placeholder="Ej: Centro, Occidente" className={inputCls} disabled={cargando} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Capacidad de Carga</label>
          <input value={capacidad} onChange={e => setCapacidad(e.target.value)}
            placeholder="Ej: 30 Toneladas" className={inputCls} disabled={cargando} />
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancelar} disabled={cargando}
          className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="px-3 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-colors disabled:opacity-50">
          {cargando ? 'Creando...' : 'Crear transportista'}
        </button>
      </div>
    </form>
  )
}
