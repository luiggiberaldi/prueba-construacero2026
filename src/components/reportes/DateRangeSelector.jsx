// src/components/reportes/DateRangeSelector.jsx
import { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { getDayRange, getWeekRange, getMonthRange, getLocalISODate } from '../../utils/dateHelpers'

const PRESETS = [
  { id: 'today',     label: 'Hoy',           short: 'Hoy',       getRango: () => getDayRange(0),   getPrev: () => getDayRange(-1) },
  { id: 'yesterday', label: 'Ayer',          short: 'Ayer',      getRango: () => getDayRange(-1),  getPrev: () => getDayRange(-2) },
  { id: 'thisWeek',  label: 'Esta semana',   short: 'Semana',    getRango: () => getWeekRange(0),  getPrev: () => getWeekRange(-1) },
  { id: 'lastWeek',  label: 'Semana pasada', short: 'Anterior',  getRango: () => getWeekRange(-1), getPrev: () => getWeekRange(-2) },
  { id: 'thisMonth', label: 'Este mes',      short: 'Mes',       getRango: () => getMonthRange(0), getPrev: () => getMonthRange(-1) },
  { id: 'lastMonth', label: 'Mes pasado',    short: 'Mes ant.',  getRango: () => getMonthRange(-1),getPrev: () => getMonthRange(-2) },
]

function mismoRango(a, b) {
  return a?.from === b?.from && a?.to === b?.to
}

export default function DateRangeSelector({ value, onChange }) {
  const [showCustom, setShowCustom] = useState(false)
  const [activePresetId, setActivePresetId] = useState(() => {
    return PRESETS.find(p => mismoRango(value, p.getRango()))?.id || ''
  })

  // Estado local para los campos del rango personalizado
  const [localFrom, setLocalFrom] = useState(value?.from || '')
  const [localTo, setLocalTo] = useState(value?.to || '')

  // Sincronizar el preset activo si el valor cambia externamente
  useEffect(() => {
    const currentPreset = PRESETS.find(p => p.id === activePresetId)
    if (currentPreset && mismoRango(value, currentPreset.getRango())) {
      return
    }
    const matching = PRESETS.find(p => mismoRango(value, p.getRango()))
    setActivePresetId(matching ? matching.id : '')
    if (!matching) {
      setShowCustom(true)
    }
  }, [value, activePresetId])

  // Sincronizar inputs locales si el rango cambia externamente
  useEffect(() => {
    if (value?.from) setLocalFrom(value.from)
    if (value?.to) setLocalTo(value.to)
  }, [value?.from, value?.to])

  const customActivo = showCustom || !activePresetId

  function selectPreset(preset) {
    setShowCustom(false)
    setActivePresetId(preset.id)
    const rango = preset.getRango()
    const prev = preset.getPrev()
    onChange({ from: rango.from, to: rango.to, prevFrom: prev.from, prevTo: prev.to })
  }

  function applyCustom() {
    if (!localFrom || !localTo) return

    let nextFrom = localFrom
    let nextTo = localTo

    // Auto-corrección: si desde > hasta, ajustamos "hasta" para que sea igual a "desde"
    const pFrom = nextFrom.split('-')
    const pTo = nextTo.split('-')
    const fromD = new Date(pFrom[0], pFrom[1] - 1, pFrom[2])
    const toD = new Date(pTo[0], pTo[1] - 1, pTo[2])

    if (fromD > toD) {
      nextTo = nextFrom
      setLocalTo(nextFrom)
    }

    // Recalcular periodo anterior con los valores corregidos
    const pFromC = nextFrom.split('-')
    const pToC = nextTo.split('-')
    const fromDC = new Date(pFromC[0], pFromC[1] - 1, pFromC[2])
    const toDC = new Date(pToC[0], pToC[1] - 1, pToC[2])
    const diff = Math.max(toDC - fromDC, 0)
    const prevTo = new Date(fromDC.getTime() - 86400000)
    const prevFrom = new Date(prevTo.getTime() - diff)

    onChange({
      from: nextFrom,
      to: nextTo,
      prevFrom: getLocalISODate(prevFrom),
      prevTo: getLocalISODate(prevTo)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        <Calendar size={12} className="text-slate-400 shrink-0 sm:w-3.5 sm:h-3.5" />
        {PRESETS.map(p => (
          <button key={p.id}
            onClick={() => selectPreset(p)}
            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold transition-colors border whitespace-nowrap shrink-0 ${
              activePresetId === p.id && !showCustom
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-slate-600 border-slate-200 hover:border-primary-focus'
            }`}>
            <span className="sm:hidden">{p.short}</span>
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        ))}
        <button
          onClick={() => {
            setShowCustom(true)
            setActivePresetId('')
          }}
          className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold transition-colors border whitespace-nowrap shrink-0 ${
            customActivo
              ? 'bg-primary text-white border-primary'
              : 'bg-white text-slate-600 border-slate-200 hover:border-primary-focus'
          }`}>
          <span className="sm:hidden">Rango</span>
          <span className="hidden sm:inline">Personalizado</span>
        </button>
      </div>
      {showCustom && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100 mt-2 transition-all duration-300">
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1 ml-1">Desde</span>
            <input type="date" value={localFrom}
              max={localTo || undefined}
              onChange={e => setLocalFrom(e.target.value)}
              className="text-[11px] sm:text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-full transition-all" />
          </div>
          <span className="hidden sm:inline text-[10px] text-slate-400 shrink-0 mb-2.5">→</span>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1 ml-1">Hasta</span>
            <input type="date" value={localTo}
              min={localFrom || undefined}
              onChange={e => setLocalTo(e.target.value)}
              className="text-[11px] sm:text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-full transition-all" />
          </div>
          <button
            onClick={applyCustom}
            disabled={!localFrom || !localTo}
            className={`h-[38px] w-full sm:w-auto px-5 rounded-xl text-xs font-bold transition-all flex items-center justify-center shadow-sm ${
              localFrom && localTo
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98]'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            Aceptar
          </button>
        </div>
      )}
    </div>
  )
}
