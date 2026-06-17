// src/components/cotizaciones/CotizacionCesta.jsx
// Panel de cesta: FAB + bottom sheet en móvil, panel lateral en desktop
import { useState, useRef, useEffect } from 'react'
import { ShoppingCart, ArrowRight, ArrowLeft, Trash2, Minus, Plus, ChevronUp, X, Edit2 } from 'lucide-react'
import { round2, mulR } from '../../utils/dinero'
import { fmtUsdSimple as fmtUsd, fmtBs, usdToBs } from '../../utils/format'

// ─── Mini header de sección ─────────────────────────────────────────────────
export function SectionH3({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: 'linear-gradient(180deg, #B8860B, #1B365D)', minHeight: '18px' }} />
      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
        style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.08), rgba(184,134,11,0.08))', border: '1px solid rgba(27,54,93,0.1)' }}>
        {Icon && <Icon size={12} style={{ color: '#1B365D' }} />}
      </div>
      <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">{children}</h3>
    </div>
  )
}

// ─── Panel de cesta (lado derecho del paso 2) ────────────────────────────────
// Inspirado en PreciosAlDia: FAB + bottom sheet en móvil, panel lateral en desktop
export default function CestaPanel({ 
  items, onCambiar, onEliminar, onEditar, subtotal, tasa, onSiguiente, onAnterior, preciosMap = {}, stockMap = {},
  esPersonal = false, descPct = 10
}) {
  // 'closed' | 'normal' | 'expanded'
  const [sheetState, setSheetState] = useState('closed')
  const sheetOpen = sheetState !== 'closed'
  const setSheetOpen = (v) => setSheetState(v ? 'expanded' : 'closed')
  const fabRef = useRef(null)

  // Bloquear scroll del body cuando la cesta está abierta
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sheetOpen])
  const swipeStartY = useRef(null)
  const sheetRef = useRef(null)

  // Swipe-up en FAB para abrir (pointer events OK aquí porque es un botón simple)
  const onPointerDown = (e) => {
    swipeStartY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (swipeStartY.current === null) return
    if (swipeStartY.current - e.clientY > 30) {
      swipeStartY.current = null
      setSheetState('expanded')
    }
  }
  const onPointerUp = () => { swipeStartY.current = null }

  // ── Touch events para el handle del sheet ──
  const handleRef = useRef(null)
  const sheetStateRef = useRef(sheetState)
  sheetStateRef.current = sheetState

  // Tap en handle → toggle expand/normal
  const handleTapToggle = () => {
    setSheetState(s => s === 'expanded' ? 'normal' : 'expanded')
  }

  useEffect(() => {
    const el = handleRef.current
    if (!el) return

    let startY = 0
    let moved = false

    const onTouchStart = (e) => {
      startY = e.touches[0].clientY
      moved = false
      if (sheetRef.current) sheetRef.current.style.transition = 'none'
    }

    const onTouchMove = (e) => {
      const dy = e.touches[0].clientY - startY
      if (Math.abs(dy) > 5) moved = true
      if (!moved) return
      e.preventDefault()
      if (!sheetRef.current) return
      // Dampen upward drag, full follow downward
      const factor = dy < 0 ? 0.4 : 1
      sheetRef.current.style.transform = `translateY(${dy * factor}px)`
    }

    const onTouchEnd = (e) => {
      const dy = e.changedTouches[0].clientY - startY
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 0.3s ease, height 0.3s ease'
        sheetRef.current.style.transform = ''
      }
      if (!moved) return // tap handled by onClick
      const st = sheetStateRef.current
      if (dy < -40) {
        setSheetState('expanded')
      } else if (dy > 80) {
        setSheetState('closed')
      } else if (dy > 40 && st === 'expanded') {
        setSheetState('normal')
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, []) // no deps — uses ref for state

  const totalItems = items.reduce((s, it) => s + it.cantidad, 0)

  // Contenido compartido de la lista de items (usado en bottom sheet y desktop)
  const listaItems = (
    <div className="divide-y divide-slate-50">
      {items.length === 0 && (
        <div className="p-8 text-center text-slate-400">
          <ShoppingCart size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">Cesta vacía</p>
          <p className="text-xs text-slate-300 mt-1">Selecciona productos del catálogo</p>
        </div>
      )}
      {items.map((it, idx) => {
        const linea = mulR(it.cantidad, it.precioUnitUsd)
        const precios = preciosMap[it.productoId]
        const tieneMultiprecios = precios && [precios.p1, precios.p2, precios.p3].filter(v => v != null && Number(v) > 0).length > 1
        return (
          <div key={it._key} className="px-3 sm:px-4 py-2 group">
            {/* Fila 1: nombre completo + total línea */}
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] sm:text-[12px] font-bold text-slate-700 leading-snug break-words uppercase">
                  {it.nombreSnap}
                  {(it.origen === 'externo' || !it.productoId) && (
                    <span className="inline-block ml-1.5 mb-0.5 text-[9px] uppercase tracking-wider font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded align-middle">
                      Externo - {it.codigoSnap}
                    </span>
                  )}
                </p>
              </div>
              <span className="text-[11px] sm:text-xs font-black text-slate-800 shrink-0">{fmtUsd(linea)}</span>
            </div>
            {/* Badge: stock insuficiente (solo para productos de inventario) */}
            {(() => {
              const esExterno = it.origen === 'externo' || !it.productoId || String(it.productoId).startsWith('manual-') || String(it.codigoSnap).startsWith('EXT')
              return !esExterno && stockMap[it.productoId] !== undefined && it.cantidad > stockMap[it.productoId]
            })() && (
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 leading-none">
                  ⚠ Stock insuficiente — disponible: {stockMap[it.productoId]}
                </span>
              </div>
            )}
            {/* Fila 2: precio unitario + unidad + controles */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] sm:text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">{fmtUsd(it.precioUnitUsd)}</span>
              <span className="text-[11px] text-slate-400">{it.unidadSnap}</span>
              <div className="flex items-center bg-slate-50 rounded-lg border border-slate-100 overflow-hidden ml-auto">
                <button type="button"
                  onClick={() => it.cantidad <= 1 ? onEliminar(idx) : onCambiar(idx, 'cantidad', Math.max(0.01, it.cantidad - 1))}
                  className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors active:scale-90">
                  <Minus size={12} strokeWidth={3} />
                </button>
                <input
                  type="text" inputMode="decimal"
                  value={it.cantidad}
                  onFocus={e => e.target.select()}
                  onChange={e => {
                    const raw = e.target.value.replace(',', '.')
                    if (raw === '' || raw === '0' || raw === '0.') return onCambiar(idx, 'cantidad', raw)
                    const v = parseFloat(raw)
                    if (!isNaN(v) && v >= 0) onCambiar(idx, 'cantidad', raw)
                  }}
                  onBlur={e => {
                    const v = parseFloat(String(e.target.value).replace(',', '.'))
                    onCambiar(idx, 'cantidad', (!isNaN(v) && v > 0) ? v : 1)
                  }}
                  className="w-8 h-7 text-center text-[12px] font-black text-slate-700 bg-white border-x border-slate-100 outline-none"
                />
                <button type="button"
                  onClick={() => onCambiar(idx, 'cantidad', it.cantidad + 1)}
                  className="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors active:scale-90">
                  <Plus size={12} strokeWidth={3} />
                </button>
              </div>
              {(it.origen === 'externo' || !it.productoId) && (
                <button type="button" onClick={() => onEditar(idx)}
                  className="w-7 h-7 rounded-md bg-amber-50 hover:bg-amber-100 flex items-center justify-center shrink-0 transition-colors active:scale-95 border border-amber-200">
                  <Edit2 size={11} className="text-amber-600" />
                </button>
              )}
              <button type="button" onClick={() => onEliminar(idx)}
                className="w-7 h-7 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors active:scale-95">
                <Trash2 size={12} className="text-red-400" />
              </button>
            </div>
            {tieneMultiprecios && (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${[precios.p1, precios.p2, precios.p3].filter(v => v != null && Number(v) > 0).length}, 1fr)` }}>
                {[{ label: 'P1', value: precios.p1 }, { label: 'P2', value: precios.p2 }, { label: 'P3', value: precios.p3 }]
                  .filter(n => n.value != null && Number(n.value) > 0)
                  .map(n => {
                    const active = Number(it.precioUnitUsd) === Number(n.value)
                    return (
                      <button key={n.label} type="button"
                        onClick={() => onCambiar(idx, 'precioUnitUsd', Number(n.value))}
                        className={`flex flex-col items-center justify-center py-1.5 px-1.5 rounded-lg border-2 transition-all active:scale-[0.96] touch-manipulation ${
                          active ? 'border-primary bg-primary text-white shadow-md' : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${active ? 'text-white/80' : 'text-slate-400'}`}>{n.label}</span>
                        <span className={`text-xs font-black ${active ? 'text-white' : 'text-slate-800'}`}>${Number(n.value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </button>
                    )
                  })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  const descuentoPersonalUsd = esPersonal ? round2(subtotal * (descPct / 100)) : 0
  const totalUsd = esPersonal ? round2(subtotal - descuentoPersonalUsd) : subtotal

  // Footer compartido (totales + botones)
  const footerContent = (
    <div className="border-t border-slate-200 p-3 sm:p-4 pb-6 sm:pb-4 space-y-2 sm:space-y-3 bg-white">
      {items.length > 0 && (
        <div className="space-y-1.5 px-1 mb-2">
          {esPersonal && (
            <p className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg text-center">
              * Descuento automático de personal ({descPct}%) se aplicará en el total.
            </p>
          )}
          
          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>Subtotal</span>
            <span className="font-bold text-slate-700">{fmtUsd(subtotal)}</span>
          </div>

          {esPersonal && (
            <div className="flex justify-between items-center text-xs text-amber-700 font-medium">
              <span>Desc. Personal ({descPct}%)</span>
              <span className="font-bold">-{fmtUsd(descuentoPersonalUsd)}</span>
            </div>
          )}

          <div className="flex justify-between items-end pt-1 border-t border-slate-100">
            <div>
              <span className="text-[12px] sm:text-xs font-black text-slate-400 uppercase tracking-wider">Total</span>
              {tasa > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{fmtBs(usdToBs(totalUsd, tasa))}</p>}
            </div>
            <span className="text-xl sm:text-2xl font-black text-slate-800">{fmtUsd(totalUsd)}</span>
          </div>
        </div>
      )}
      <button type="button" onClick={onSiguiente} disabled={items.length === 0}
        className="w-full flex items-center justify-center gap-2 py-3 sm:py-3.5 text-white font-bold text-sm sm:text-base rounded-xl sm:rounded-2xl transition-all disabled:opacity-40 active:scale-[0.98] shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
        <ArrowRight size={16} /> Continuar al resumen
      </button>
      <button type="button" onClick={onAnterior}
        className="w-full py-2 sm:py-2.5 border border-slate-200 text-slate-500 font-semibold text-sm rounded-xl hover:bg-slate-50 transition-colors">
        Volver
      </button>
    </div>
  )

  return (
    <>
      {/* ── Móvil: FAB flotante + Bottom Sheet (estilo PreciosAlDia) ── */}
      <div className="lg:hidden">
        {/* FAB: solo visible cuando hay items y el sheet está cerrado */}
        {items.length > 0 && !sheetOpen && (
          <button type="button"
            ref={fabRef}
            onClick={() => setSheetOpen(true)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="fixed bottom-20 left-3 right-3 z-[98] p-3.5 rounded-2xl shadow-xl flex items-center justify-between active:scale-[0.97] transition-all md:bottom-4"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)', boxShadow: '0 8px 30px rgba(27,54,93,0.35)', touchAction: 'none' }}>
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                <ShoppingCart size={18} className="text-white" />
              </div>
              <div className="text-left">
                <div className="text-[10px] font-bold text-white/70 uppercase tracking-wider">Ver Cesta</div>
                <div className="text-white font-black text-sm">{items.length} producto{items.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-black text-white leading-none">{fmtUsd(subtotal)}</div>
              {tasa > 0 && <div className="text-[10px] font-bold text-white/70 mt-0.5">{fmtBs(usdToBs(subtotal, tasa))}</div>}
            </div>
          </button>
        )}

        {/* Bottom Sheet Overlay */}
        {sheetOpen && (
          <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}>
            <div ref={sheetRef}
              className="bg-white w-full rounded-t-3xl shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]"
              style={{
                height: sheetState === 'expanded' ? '92vh' : '50vh',
                transition: 'transform 0.3s ease, height 0.3s ease',
              }}
              onClick={e => e.stopPropagation()}>
              {/* Handle + Header - zona de swipe completa */}
              <div ref={handleRef} className="shrink-0 cursor-grab active:cursor-grabbing select-none"
                onClick={handleTapToggle}
                style={{ touchAction: 'none' }}>
                {/* Handle visual */}
                <div className="flex flex-col items-center pt-3 pb-2 gap-0.5">
                  <div className={`w-12 h-1.5 rounded-full transition-colors ${sheetState === 'expanded' ? 'bg-primary' : 'bg-slate-300'}`} />
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    {sheetState === 'normal' ? '↑ Expandir' : '↓ Reducir'}
                  </span>
                </div>
                {/* Header */}
                <div className="px-4 pb-3 flex items-center justify-between border-b border-slate-200">
                  <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    <ShoppingCart size={18} className="text-primary" /> Cesta
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${items.length > 0 ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'}`}>
                      {items.length} items
                    </span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setSheetOpen(false) }} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                </div>
              </div>
              {/* Items scrollable */}
              <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                {listaItems}
              </div>
              {/* Footer */}
              {footerContent}
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop: panel lateral completo ── */}
      <div className="hidden lg:flex bg-white rounded-2xl border border-slate-200 flex-col overflow-hidden h-[calc(100vh-140px)]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl shrink-0">
          <span className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <ShoppingCart size={14} className="text-primary" /> Cesta
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${items.length > 0 ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'}`}>
            {items.length} items
          </span>
        </div>

        {/* Lista de items */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {listaItems}
        </div>

        {/* Footer */}
        <div className="shrink-0">
          {footerContent}
        </div>
      </div>
    </>
  )
}
