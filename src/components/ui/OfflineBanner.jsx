// src/components/ui/OfflineBanner.jsx
// Detecta estado offline y muestra banner animado con controles para activar el modo offline manual y sincronizar al volver online.
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { WifiOff, Wifi, CloudLightning, ShieldAlert, Check } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { useMutationQueue } from '../../hooks/useMutationQueue'
import { apiUrl } from '../../services/apiBase'
import SyncModal from './SyncModal'
import { showToast } from './Toast'

// ─── Contexto ─────────────────────────────────────────────────────────────────
const OfflineCtx = createContext(false)
export const useOffline = () => useContext(OfflineCtx)

const BANNER_H = 46 // px — altura del banner

// ─── Verificación real de red (ping al worker) ─────────────────────────
async function checkRealConnectivity() {
  try {
    const res = await fetch(apiUrl('/api/ping'), {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function OfflineBanner({ children }) {
  const offlineManual = useAuthStore(s => s.offlineManual)
  const offlineFisico = useAuthStore(s => s.offlineFisico)
  const setOfflineManual = useAuthStore(s => s.setOfflineManual)
  const { pending } = useMutationQueue()

  const [showRestored, setShowRestored] = useState(false)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const restoredTimer = useRef(null)

  // Sondeo de conectividad real
  useEffect(() => {
    async function probe() {
      if (!navigator.onLine) {
        useAuthStore.setState({ offlineFisico: true, offline: true })
        return
      }
      const ok = await checkRealConnectivity()
      const currentFisico = useAuthStore.getState().offlineFisico
      
      if (ok && currentFisico) {
        console.log('[NETWORK] Conexión física restaurada vía ping')
        useAuthStore.setState({ offlineFisico: false })
        const manual = useAuthStore.getState().offlineManual
        useAuthStore.setState({ offline: manual })
        if (!manual) {
          setShowRestored(true)
          clearTimeout(restoredTimer.current)
          restoredTimer.current = setTimeout(() => setShowRestored(false), 4000)
        }
      } else if (!ok && !currentFisico) {
        console.log('[NETWORK] Conexión física perdida (ping fallido)')
        useAuthStore.setState({ offlineFisico: true, offline: true })
      }
    }

    const interval = setInterval(probe, 20_000)

    function onOnline() { probe() }
    function onOffline() { 
      useAuthStore.setState({ offlineFisico: true, offline: true })
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    // Carga inicial
    probe()

    return () => {
      clearInterval(interval)
      clearTimeout(restoredTimer.current)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const visible = offlineFisico || offlineManual || showRestored

  return (
    <OfflineCtx.Provider value={visible}>
      <div
        style={{
          height: visible ? BANNER_H : 0,
          overflow: 'hidden',
          transition: 'height 350ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        className="z-[9997] relative"
      >
        {/* Layout 1: Offline Físico (Sin internet) y el usuario sigue en Online Manual */}
        {offlineFisico && !offlineManual && (
          <div
            className="flex items-center justify-between px-4 sm:px-6 text-xs sm:text-sm font-semibold text-white animate-in fade-in duration-300"
            style={{
              height: BANNER_H,
              background: 'linear-gradient(90deg, #d97706, #b45309)',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
            }}
          >
            <div className="flex items-center gap-2">
              <WifiOff size={16} className="animate-pulse shrink-0" />
              <span className="truncate">Sin conexión a internet. ¿Deseas activar el Modo Offline controlado?</span>
            </div>
            <button
              onClick={() => setOfflineManual(true)}
              className="px-3 py-1 bg-white text-amber-900 rounded-lg font-bold text-xs hover:bg-amber-50 active:scale-95 transition-all shadow-sm shrink-0"
            >
              Activar Modo Offline
            </button>
          </div>
        )}

        {/* Layout 2: Offline Manual Activo */}
        {offlineManual && (
          <div
            className="flex items-center justify-between px-4 sm:px-6 text-xs sm:text-sm font-semibold text-white animate-in fade-in duration-300"
            style={{
              height: BANNER_H,
              background: 'linear-gradient(90deg, #1e293b, #0f172a)',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CloudLightning size={16} className="text-amber-400 animate-pulse shrink-0" />
              <span className="truncate">Modo Offline Activo (Local). {pending > 0 ? `Tienes ${pending} venta(s) pendiente(s).` : 'Trabajando en local.'}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!offlineFisico ? (
                <button
                  onClick={() => {
                    if (pending === 0) {
                      setOfflineManual(false)
                      showToast('Volviendo a modo online', 'success')
                    } else {
                      setShowSyncModal(true)
                    }
                  }}
                  className="px-3 py-1 bg-emerald-500 text-white rounded-lg font-bold text-xs hover:bg-emerald-400 active:scale-95 transition-all shadow-sm"
                >
                  Sincronizar y volver a Online
                </button>
              ) : (
                <span className="text-[10px] text-slate-400 font-medium">Falta internet para sincronizar</span>
              )}
            </div>
          </div>
        )}

        {/* Layout 3: Conexión Restaurada (transición online exitosa) */}
        {showRestored && !offlineManual && (
          <div
            className="flex items-center justify-center gap-2 px-4 text-xs sm:text-sm font-semibold text-white animate-in fade-in duration-300"
            style={{
              height: BANNER_H,
              background: 'linear-gradient(90deg, #059669, #047857)'
            }}
          >
            <Check size={16} className="animate-bounce shrink-0" />
            <span>¡Conexión restaurada con la nube exitosamente! ✓</span>
          </div>
        )}
      </div>

      {children}

      {/* SyncModal */}
      {showSyncModal && (
        <SyncModal isOpen={showSyncModal} onClose={() => setShowSyncModal(false)} />
      )}
    </OfflineCtx.Provider>
  )
}
