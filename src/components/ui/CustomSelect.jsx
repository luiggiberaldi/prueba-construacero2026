// src/components/ui/CustomSelect.jsx
// Selector personalizado con búsqueda — reemplaza el <select> nativo
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Search, ChevronDown, X, Check, Plus } from 'lucide-react'

/** Normaliza texto: quita acentos y pasa a minúsculas */
function normalizar(str) {
  if (!str) return ''
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Quita todo lo que no sea número o letra (útil para cédulas) */
function purificar(str) {
  if (!str) return ''
  return str.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/** Búsqueda inteligente: soporta acentos, inicio de palabra, y typos básicos */
function matchScore(texto, query) {
  const t = normalizar(texto)
  const q = normalizar(query)
  const qPure = purificar(query)
  const tPure = purificar(texto)

  // 1. Coincidencia exacta o inicio de cédula purificada (Ej: query "123" match "V12.3...")
  if (qPure.length >= 3 && tPure.includes(qPure)) return 4
  
  // 2. Coincidencia exacta al inicio → máxima prioridad
  if (t.startsWith(q)) return 3
  
  // 3. Coincidencia al inicio de alguna palabra
  if (t.split(/\s+/).some(w => w.startsWith(q))) return 2
  
  // 4. Contiene la query
  if (t.includes(q)) return 1
  
  // 5. Coincidencia por iniciales (ej: "dc" → "Distrito Capital")
  if (q.length >= 2) {
    const iniciales = t.split(/\s+/).map(w => w[0]).join('')
    if (iniciales.includes(q)) return 1
  }
  return 0
}

/**
 * @param {object} props
 * @param {Array<{value: string, label: string, sub?: string, icon?: React.ComponentType}>} props.options
 * @param {string} props.value - valor seleccionado
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder] - texto cuando no hay selección
 * @param {boolean} [props.searchable] - mostrar buscador (default: true si >5 opciones)
 * @param {boolean} [props.clearable] - permitir limpiar (default: false)
 * @param {boolean} [props.creatable] - permitir crear nuevas opciones escribiendo (default: false)
 * @param {string} [props.createLabel] - texto para la opción de crear (default: 'Crear')
 * @param {boolean} [props.disabled]
 * @param {React.ComponentType} [props.icon] - icono del trigger
 */
export default function CustomSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Seleccionar...',
  searchable,
  clearable = false,
  creatable = false,
  createLabel = 'Crear',
  createMaxLength = null,
  disabled = false,
  icon: TriggerIcon,
  showSubInTrigger = true,
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [openUp, setOpenUp] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [portalPos, setPortalPos] = useState({ top: 0, left: 0, width: 0 })
  const [showInlineCreate, setShowInlineCreate] = useState(false)
  const [newValueText, setNewValueText] = useState('')
  const ref = useRef(null)
  const dropdownRef = useRef(null)
  const searchRef = useRef(null)

  const showSearch = searchable ?? (creatable || options.length > 5)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Cerrar al hacer click/touch fuera en Desktop. En móvil lo maneja el backdrop.
  useEffect(() => {
    function handleOutside(e) {
      if (isMobile) return
      const inTrigger = ref.current && ref.current.contains(e.target)
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target)
      if (!inTrigger && !inDropdown) setAbierto(false)
    }
    if (abierto) {
      document.addEventListener('mousedown', handleOutside)
      document.addEventListener('touchstart', handleOutside, { passive: true })
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [abierto, isMobile])

  // Calcular posición del dropdown portal en desktop
  useEffect(() => {
    if (!abierto || !ref.current) return

    if (!isMobile) {
      const rect = ref.current.getBoundingClientRect()
      const viewH = window.visualViewport?.height || window.innerHeight
      const spaceBelow = viewH - rect.bottom
      const goUp = spaceBelow < 280
      setOpenUp(goUp)
      setPortalPos({
        top: goUp ? rect.top : rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        goUp,
      })
    }

    if (showSearch && searchRef.current && !isMobile) {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [abierto, showSearch, isMobile])

  const seleccionada = options.find(o => o.value === value)
  
  // Persistencia de etiqueta para evitar "parpadeo" durante refetchs en entornos lentos
  const [lastLabel, setLastLabel] = useState(null)
  useEffect(() => {
    if (seleccionada) {
      // Recordar el nombre cuando hay una selección válida
      setLastLabel(seleccionada.selectedLabel || seleccionada.label)
    } else if (!value) {
      // Limpiar la memoria cuando no hay valor (ej: al eliminar o deseleccionar)
      setLastLabel(null)
    }
    // Si hay value pero no hay seleccionada → refetch en curso, NO limpiar (mantener label)
  }, [seleccionada, value])

  // Si el valor actual no está en options (refetch en curso), usar el último label conocido
  const seleccionadaLabel = seleccionada 
    ? (seleccionada.selectedLabel || seleccionada.label) 
    : (value && lastLabel ? lastLabel : (creatable && value ? value : null))
  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return options
    const q = busqueda.trim()
    return options
      .map(o => ({ ...o, _score: Math.max(matchScore(o.label, q), matchScore(o.sub ?? '', q)) }))
      .filter(o => o._score > 0)
      .sort((a, b) => b._score - a._score)
  }, [options, busqueda])

  // Mostrar opción "Crear" cuando hay texto que no coincide exactamente
  const puedeCrear = creatable && busqueda.trim() &&
    !options.some(o => normalizar(o.label) === normalizar(busqueda.trim())) &&
    (!createMaxLength || busqueda.trim().length <= createMaxLength)

  function elegir(val) {
    onChange(val)
    setBusqueda('')
    setShowInlineCreate(false)
    setNewValueText('')
    setAbierto(false)
  }

  function limpiar(e) {
    e.stopPropagation()
    onChange('')
    setBusqueda('')
    setShowInlineCreate(false)
    setNewValueText('')
  }

  function toggle() {
    if (disabled) return
    setAbierto(!abierto)
    if (abierto) {
      setBusqueda('')
      setShowInlineCreate(false)
      setNewValueText('')
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left transition-all text-sm ${
          disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200' :
          abierto
            ? 'border-primary ring-1 ring-primary/30 bg-white'
            : seleccionada
              ? 'border-slate-200 bg-white hover:border-slate-300'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        }`}
      >
        {TriggerIcon && (
          <TriggerIcon size={15} className={seleccionadaLabel ? 'text-primary shrink-0' : 'text-slate-400 shrink-0'} />
        )}
        <span className={`flex-1 truncate ${seleccionadaLabel ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
          {seleccionadaLabel || placeholder}
        </span>
        {showSubInTrigger && seleccionada?.sub && (
          <span className="text-xs text-slate-400 truncate max-w-[120px] hidden sm:inline">{seleccionada.sub}</span>
        )}
        {clearable && seleccionadaLabel && !disabled && (
          <div role="button" tabIndex={0} onClick={limpiar}
            className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
            <X size={13} />
          </div>
        )}
        <ChevronDown size={15} className={`text-slate-400 transition-transform shrink-0 ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown / Bottom Sheet */}
      {abierto && (
        isMobile ? createPortal(
          <div className="fixed inset-0 z-[9999] bg-white flex flex-col h-[100dvh] animate-in slide-in-from-bottom-8 fade-in duration-200 ease-out" style={{ isolation: 'isolate' }}>
            {/* Header del modal */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <span className="font-semibold text-slate-800 text-lg">{placeholder}</span>
              <button type="button" onClick={() => setAbierto(false)} className="p-2 -mr-2 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex flex-col flex-1 min-h-0 bg-slate-50/30">
              {/* Buscador estático arriba */}
              {showSearch && (
                <div className="p-4 border-b border-slate-100 shrink-0 bg-white">
                  <div className="relative">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      ref={searchRef}
                      type="text"
                      inputMode="search"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={busqueda}
                      onChange={e => setBusqueda(e.target.value)}
                      maxLength={createMaxLength || undefined}
                      placeholder="Buscar..."
                      className="w-full pl-11 pr-4 py-3.5 text-[16px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-slate-400 transition-shadow"
                    />
                  </div>
                </div>
              )}
              
              {/* Lista amigable con scroll */}
              <div className="overflow-y-auto p-3 pb-8 overscroll-contain flex-1">
                  {filtradas.length === 0 && !puedeCrear ? (
                    <p className="text-base text-slate-400 text-center py-8">
                      {busqueda ? 'Sin resultados' : 'Sin opciones'}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {filtradas.map(opt => {
                        const isSelected = opt.value === value
                        const OptIcon = opt.icon
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => elegir(opt.value)}
                            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-xl transition-colors ${
                              isSelected
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'active:bg-slate-100 text-slate-700'
                            }`}
                          >
                            {OptIcon && <OptIcon size={18} className={isSelected ? 'text-primary shrink-0' : 'text-slate-400 shrink-0'} />}
                            <div className="flex-1 min-w-0">
                              <div className="text-base whitespace-normal break-words leading-tight">{opt.label}</div>
                              {opt.sub && <div className="text-[13px] text-slate-400 truncate mt-0.5">{opt.sub}</div>}
                            </div>
                            {isSelected && <Check size={18} className="text-primary shrink-0" />}
                          </button>
                        )
                      })}
                      {puedeCrear && (
                        <button
                          type="button"
                          onClick={() => elegir(busqueda.trim())}
                          className="w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-xl transition-colors active:bg-emerald-50 text-emerald-700 mt-2 border border-emerald-100/50 bg-emerald-50/30"
                        >
                          <Plus size={18} className="text-emerald-500 shrink-0" />
                          <div className="flex-1 truncate text-base">{createLabel} "<span className="font-bold">{busqueda.trim()}</span>"</div>
                          {createMaxLength && <span className="text-xs text-emerald-500/70 shrink-0">{busqueda.trim().length}/{createMaxLength}</span>}
                        </button>
                      )}
                      {creatable && (
                        showInlineCreate ? (
                          <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex gap-2 items-center mt-2 rounded-xl border border-indigo-100 animate-in fade-in zoom-in-95 duration-150">
                            <input
                              type="text"
                              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-white text-slate-800"
                              placeholder={createLabel ? `${createLabel}...` : "Escribir..."}
                              value={newValueText}
                              onChange={e => setNewValueText(e.target.value)}
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (newValueText.trim()) {
                                  elegir(newValueText.trim());
                                }
                              }}
                              className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
                            >
                              Agregar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowInlineCreate(false);
                                setNewValueText('');
                              }}
                              className="p-2 text-slate-500 hover:bg-slate-200 active:bg-slate-300 rounded-lg transition-colors"
                            >
                              <X size={18} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowInlineCreate(true)}
                            className="w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-xl transition-colors active:bg-indigo-50 text-indigo-700 mt-2 border border-indigo-100/50 bg-indigo-50/30 font-bold"
                          >
                            <Plus size={18} className="text-indigo-500 shrink-0" />
                            <div className="flex-1 truncate text-base">{createLabel ? `+ ${createLabel}` : "+ Crear nuevo"}</div>
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
        ) : createPortal(
          <div
            ref={dropdownRef}
            className="bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden"
            style={{
              position: 'fixed',
              zIndex: 9999,
              left: portalPos.left,
              width: portalPos.width,
              ...(portalPos.goUp
                ? { bottom: `calc(100vh - ${portalPos.top}px + 6px)` }
                : { top: portalPos.top }),
            }}
          >
            {/* Buscador Desktop */}
            {showSearch && (
              <div className="p-2 border-b border-slate-100">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    ref={searchRef}
                    type="text"
                    inputMode="search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    maxLength={createMaxLength || undefined}
                    placeholder="Buscar..."
                    className="w-full pl-7 pr-3 py-1.5 text-sm border border-slate-100 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary-focus focus:border-primary placeholder:text-slate-400"
                  />
                </div>
              </div>
            )}

            {/* Lista Desktop */}
            <div className="max-h-52 overflow-y-auto py-1 overscroll-contain">
              {filtradas.length === 0 && !puedeCrear ? (
                <p className="text-sm text-slate-400 text-center py-4">
                  {busqueda ? 'Sin resultados' : 'Sin opciones'}
                </p>
              ) : (
                <>
                  {filtradas.map(opt => {
                    const isSelected = opt.value === value
                    const OptIcon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => elegir(opt.value)}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? 'bg-primary-light/40 text-primary font-medium'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        {OptIcon && <OptIcon size={14} className={isSelected ? 'text-primary shrink-0' : 'text-slate-400 shrink-0'} />}
                        <span className="flex-1 whitespace-normal break-words leading-tight py-0.5">{opt.label}</span>
                        {opt.sub && <span className="text-xs text-slate-400 truncate max-w-[140px]">{opt.sub}</span>}
                        {isSelected && <Check size={14} className="text-primary shrink-0" />}
                      </button>
                    )
                  })}
                  {puedeCrear && (
                    <button
                      type="button"
                      onClick={() => elegir(busqueda.trim())}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-emerald-50 text-emerald-700 border-t border-slate-100"
                    >
                      <Plus size={14} className="text-emerald-500 shrink-0" />
                      <span className="flex-1 truncate">{createLabel} "<span className="font-bold">{busqueda.trim()}</span>"</span>
                      {createMaxLength && <span className="text-xs text-emerald-500/70 shrink-0">{busqueda.trim().length}/{createMaxLength}</span>}
                    </button>
                  )}
                  {creatable && (
                    showInlineCreate ? (
                      <div className="p-2 border-t border-slate-100 bg-slate-50/50 flex gap-1.5 items-center shrink-0 animate-in fade-in zoom-in-95 duration-150">
                        <input
                          type="text"
                          className="flex-1 px-2.5 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary bg-white text-slate-800"
                          placeholder={createLabel ? `${createLabel}...` : "Escribir..."}
                          value={newValueText}
                          onChange={e => setNewValueText(e.target.value)}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (newValueText.trim()) elegir(newValueText.trim());
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (newValueText.trim()) {
                              elegir(newValueText.trim());
                            }
                          }}
                          className="px-2.5 py-1 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-all active:scale-95 shrink-0 animate-pulse"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowInlineCreate(false);
                            setNewValueText('');
                          }}
                          className="p-1 text-slate-500 hover:bg-slate-200 active:bg-slate-300 rounded-lg transition-colors shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowInlineCreate(true)}
                        className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-xs font-bold text-indigo-600 hover:bg-indigo-50 border-t border-slate-100 shrink-0"
                      >
                        <Plus size={13} className="text-indigo-500 shrink-0" />
                        <span className="flex-1 truncate">{createLabel ? `+ ${createLabel}` : "+ Crear nuevo"}</span>
                      </button>
                    )
                  )}
                </>
              )}
            </div>
          </div>,
          document.body
        )
      )}
    </div>
  )
}
