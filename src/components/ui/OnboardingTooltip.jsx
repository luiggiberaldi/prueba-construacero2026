// src/components/ui/OnboardingTooltip.jsx
// Tooltips de primera vez para guiar al usuario nuevo
import { useState, useEffect } from 'react'
import { X, Lightbulb } from 'lucide-react'
import { TIPS } from '../../utils/onboardingConfig'

import useAuthStore from '../../store/useAuthStore'

const STORAGE_KEY_BASE = 'listopos_onboarding_done'
const TIPS_KEY_BASE = 'listopos_tips_shown'

function getKeys() {
  const businessId = useAuthStore.getState().user?.id
  const suffix = businessId ? `-${businessId}` : ''
  return {
    onboarding: `${STORAGE_KEY_BASE}${suffix}`,
    tips: `${TIPS_KEY_BASE}${suffix}`
  }
}

// Verificar si el onboarding ya fue completado
export function isOnboardingDone() {
  const keys = getKeys()
  try { return localStorage.getItem(keys.onboarding) === '1' } catch { return true }
}

// Marcar onboarding como completado
export function markOnboardingDone() {
  const keys = getKeys()
  try { localStorage.setItem(keys.onboarding, '1') } catch {}
}

export function isTipShown(tipId) {
  const keys = getKeys()
  try {
    const shown = JSON.parse(localStorage.getItem(keys.tips) || '[]')
    return shown.includes(tipId)
  } catch { return true }
}

export function markTipShown(tipId) {
  const keys = getKeys()
  try {
    const shown = JSON.parse(localStorage.getItem(keys.tips) || '[]')
    if (!shown.includes(tipId)) {
      shown.push(tipId)
      localStorage.setItem(keys.tips, JSON.stringify(shown))
    }
  } catch {}
}

// Componente de tooltip inline — se muestra solo 1 vez por tipId
export default function OnboardingTip({ tipId, children, className = '' }) {
  const [visible, setVisible] = useState(() => !isTipShown(tipId))

  useEffect(() => {
    if (visible) {
      // Marcar como mostrado inmediatamente para que no vuelva a aparecer en futuras visitas
      markTipShown(tipId)
      // Auto-dismiss después de 15 segundos
      const timer = setTimeout(() => setVisible(false), 15000)
      return () => clearTimeout(timer)
    }
  }, [visible, tipId])

  function dismiss() {
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border animate-in fade-in slide-in-from-top-1 duration-300 ${className}`}
      style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.05), rgba(184,134,11,0.05))', border: '1px solid rgba(27,54,93,0.12)' }}>
      <Lightbulb size={14} className="text-amber-500 shrink-0 mt-0.5" />
      <p className="text-xs text-slate-600 flex-1 leading-relaxed">{children}</p>
      <button onClick={dismiss}
        className="p-0.5 text-slate-300 hover:text-slate-500 transition-colors shrink-0">
        <X size={12} />
      </button>
    </div>
  )
}

// Secuencia de tips por rol — muestra el primer tip no visto para la página actual
export function OnboardingSequence({ rol, page }) {
  const tips = (TIPS[rol] || []).filter(t => t.page === page)
  // Encontrar el primer tip no mostrado
  const nextTip = tips.find(t => !isTipShown(t.id))
  if (!nextTip) return null
  return <OnboardingTip tipId={nextTip.id} className="mb-3">{nextTip.text}</OnboardingTip>
}
