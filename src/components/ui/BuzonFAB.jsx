// src/components/ui/BuzonFAB.jsx
import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageSquare, Send, History, X, AlertCircle } from 'lucide-react'
import { Modal } from './Modal'
import { useMisBuzon, useEnviarSugerencia } from '../../hooks/useBuzon'
import useAuthStore from '../../store/useAuthStore'

export default function BuzonFAB() {
  const location = useLocation()
  const perfil = useAuthStore(s => s.perfil)
  
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('nuevo') // 'nuevo' | 'historial'
  const [tipo, setTipo] = useState('sugerencia')
  const [mensaje, setMensaje] = useState('')
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [vistos, setVistos] = useState([])
  
  const { data: misMensajes = [], isLoading } = useMisBuzon()
  const enviarMutation = useEnviarSugerencia()

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Cargar respuestas vistas
  useEffect(() => {
    if (!perfil?.id) return
    try {
      const stored = localStorage.getItem(`buzon_vistos_${perfil.id}`)
      setVistos(stored ? JSON.parse(stored) : [])
    } catch {
      setVistos([])
    }
  }, [perfil?.id])

  // Marcar respuestas como leídas al abrir historial
  useEffect(() => {
    if (isOpen && activeTab === 'historial' && misMensajes.length > 0 && perfil?.id) {
      const respondedIds = misMensajes.filter(m => m.nota_interna).map(m => m.id)
      if (respondedIds.length > 0) {
        const newVistos = Array.from(new Set([...vistos, ...respondedIds]))
        setVistos(newVistos)
        localStorage.setItem(`buzon_vistos_${perfil.id}`, JSON.stringify(newVistos))
      }
    }
  }, [isOpen, activeTab, misMensajes, perfil?.id])

  // No mostrar en la pantalla de login o si no hay operador autenticado
  if (!perfil || location.pathname === '/login') return null

  // En móvil, solo mostrar en el inicio (dashboard, pathname "/") para no estorbar
  if (isMobile && location.pathname !== '/') return null

  // Contar respuestas no vistas
  const noVistasCount = misMensajes.filter(m => m.nota_interna && !vistos.includes(m.id)).length

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!mensaje.trim()) return

    enviarMutation.mutate(
      { tipo, mensaje },
      {
        onSuccess: () => {
          setMensaje('')
          setTipo('sugerencia')
          setActiveTab('historial') // Ir al historial para ver el mensaje recién enviado
        },
      }
    )
  }

  // Estilos de tipo de mensaje
  const getTipoEstilo = (t) => {
    const tipos = {
      sugerencia: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
      queja: 'bg-rose-500/10 text-rose-500 border border-rose-500/20',
      error_tecnico: 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20',
    }
    return tipos[t] || 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
  }

  const getTipoEtiqueta = (t) => {
    const etiquetas = {
      sugerencia: 'Sugerencia',
      queja: 'Queja',
      error_tecnico: 'Error Técnico',
    }
    return etiquetas[t] || t
  }

  // Estilos de estado
  const getEstadoEstilo = (est) => {
    const estados = {
      pendiente: 'bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30',
      leido: 'bg-blue-500/20 text-blue-500 dark:text-blue-400 border border-blue-500/30',
      resuelto: 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30',
    }
    return estados[est] || 'bg-slate-500/20 text-slate-500 border border-slate-500/30'
  }

  return (
    <>
      {/* Botón Flotante (FAB) */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed z-[90] bottom-36 right-4 md:bottom-6 md:right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-all hover:scale-105 group"
        style={{
          background: 'linear-gradient(135deg, #1B365D 0%, #B8860B 100%)',
          boxShadow: '0 6px 24px rgba(27,54,93,0.4)',
        }}
        title="Buzón de sugerencias"
      >
        <MessageSquare size={22} className="text-white group-hover:rotate-12 transition-transform" />
        
        {/* Badge para indicar que tiene respuestas no leídas */}
        {noVistasCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-6 h-6 px-1.5 rounded-full bg-red-600 text-white font-black text-xs flex items-center justify-center shadow-md border border-white/20 animate-pulse">
            {noVistasCount}
          </span>
        )}
      </button>

      {/* Modal del Buzón */}
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="📬 Buzón de Sugerencias & Quejas"
        className="sm:max-w-md"
      >
        {/* Tabs selector */}
        <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-4 shrink-0">
          <button
            onClick={() => setActiveTab('nuevo')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black rounded-lg transition-all ${
              activeTab === 'nuevo'
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            <Send size={14} />
            <span>Enviar Mensaje</span>
          </button>
          
          <button
            onClick={() => setActiveTab('historial')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black rounded-lg transition-all ${
              activeTab === 'historial'
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            <History size={14} />
            <span>Mis Mensajes</span>
            {noVistasCount > 0 ? (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-black animate-pulse">
                {noVistasCount}
              </span>
            ) : misMensajes.length > 0 ? (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300 text-[10px]">
                {misMensajes.length}
              </span>
            ) : null}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'nuevo' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-left space-y-1.5">
              <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Tipo de Mensaje
              </label>
              <div className="grid grid-cols-3 gap-2">
                {['sugerencia', 'queja', 'error_tecnico'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    className={`py-2 px-1 rounded-xl text-xs font-black text-center transition-all capitalize border ${
                      tipo === t
                        ? 'border-slate-800 dark:border-white bg-slate-800 text-white dark:bg-slate-700'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {getTipoEtiqueta(t)}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-left space-y-1.5">
              <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex justify-between">
                <span>Mensaje</span>
                <span className={`text-[10px] ${mensaje.length > 500 ? 'text-rose-500' : 'text-slate-400'}`}>
                  {mensaje.length}/500
                </span>
              </label>
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value.slice(0, 500))}
                placeholder="Escribe aquí tu sugerencia, reporte de error o queja para mejorar el sistema..."
                rows={5}
                required
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-800 dark:focus:ring-white transition-all text-slate-800 dark:text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={enviarMutation.isPending || !mensaje.trim()}
              className="w-full py-3 rounded-xl text-sm font-black text-white active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:pointer-events-none"
              style={{
                background: 'linear-gradient(135deg, #1B365D, #B8860B)',
                boxShadow: '0 4px 12px rgba(27,54,93,0.25)',
              }}
            >
              {enviarMutation.isPending ? 'Enviando...' : 'Enviar Mensaje'}
              <Send size={14} />
            </button>
          </form>
        ) : (
          /* Historial */
          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
            {isLoading ? (
              <div className="text-center py-8 text-slate-500 text-xs">Cargando historial...</div>
            ) : misMensajes.length === 0 ? (
              <div className="text-center py-12 px-4 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl">
                <AlertCircle size={28} className="mx-auto mb-2 text-slate-400 opacity-60" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Sin mensajes</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  Aún no has enviado sugerencias o quejas. Tu feedback nos ayuda a mejorar el sistema POS.
                </p>
              </div>
            ) : (
              misMensajes.map(m => (
                <div
                  key={m.id}
                  className="p-3 bg-slate-50 dark:bg-slate-850 border border-slate-100 dark:border-slate-800 rounded-2xl text-left space-y-2 relative"
                >
                  <div className="flex justify-between items-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${getTipoEstilo(m.tipo)}`}>
                      {getTipoEtiqueta(m.tipo)}
                    </span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${getEstadoEstilo(m.estado)}`}>
                      {m.estado}
                    </span>
                  </div>
                  
                  <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed break-words font-medium">
                    {m.mensaje}
                  </p>

                  {/* Notas internas del desarrollador si el mensaje ya fue leído/resuelto */}
                  {m.nota_interna && (
                    <div className="p-2 bg-blue-500/5 border-l-2 border-blue-500 dark:border-blue-400 rounded-r-lg mt-1 text-[11px] text-slate-600 dark:text-slate-300 leading-normal">
                      <span className="font-bold text-blue-500 dark:text-blue-400 block mb-0.5 text-[9px] uppercase tracking-wider">Nota de Desarrollador:</span>
                      {m.nota_interna}
                    </div>
                  )}

                  <div className="text-[9px] text-slate-400 flex justify-between pt-1">
                    <span>{new Date(m.creado_en).toLocaleDateString('es-VE')}</span>
                    <span>{new Date(m.creado_en).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
