// src/views/TutorialView.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  HelpCircle, Zap, FileText, Truck, Users, DollarSign, Lightbulb,
  ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, Play, BookOpen,
  Sparkles, Star, Award, ChevronRight, Shield, Search, Plus, Check,
  Minus, Download, Share2, Clipboard, WifiOff, RefreshCw, Copy, Info, CheckCircle, PlusCircle,
  MessageSquare
} from 'lucide-react'
import useAuthStore from '../store/useAuthStore'

const TUTORIAL_MODULES = [
  {
    id: 'inicio',
    title: 'Inicio y General',
    desc: 'Conoce la interfaz principal, tu rol y el panel de control.',
    icon: HelpCircle,
    color: 'from-sky-500 to-indigo-600 border-sky-500/20',
    bgColor: 'bg-sky-500/10',
    steps: [
      {
        title: '¡Bienvenido a Listo!',
        desc: 'Listo POS es el sistema centralizado de cotizaciones y despachos. Aquí podrás gestionar clientes, productos, emitir presupuestos en tiempo récord y consultar tus comisiones del mes.',
        tip: 'Este es el centro de operaciones donde ocurre toda la magia de ventas.',
        mockupType: 'welcome'
      },
      {
        title: 'Tu Perfil y Tasas de Cambio',
        desc: 'En la parte superior verás las tasas del día (BCV, USDT) sincronizadas automáticamente. El sistema también registra la tasa Euro oficial para reportes de liquidación.',
        tip: 'Las tasas se actualizan en tiempo real basándose en los datos oficiales.',
        mockupType: 'profile'
      },
      {
        title: 'Tu Panel de Control',
        desc: 'El Dashboard te muestra tus métricas clave de forma inmediata: total cotizado, comisiones acumuladas y estado de tus despachos pendientes de entrega.',
        tip: 'Haz clic en cualquier métrica para ver los detalles de ese módulo directamente.',
        mockupType: 'dashboard'
      }
    ]
  },
  {
    id: 'venta-rapida',
    title: 'Venta Rápida',
    desc: 'Crea un presupuesto y orden de entrega rápido en 3 pasos con el botón flotante.',
    icon: Zap,
    color: 'from-amber-500 to-orange-600 border-amber-500/20',
    bgColor: 'bg-amber-500/10',
    steps: [
      {
        title: 'El Botón Flotante (FAB)',
        desc: 'En dispositivos móviles, presiona el botón circular con el ícono de más (+) en la esquina inferior derecha. Al abrirse el menú Speed Dial, selecciona "Venta Rápida" (ícono de Rayo).',
        tip: 'Haz clic en el botón flotante (+) en la simulación a la derecha para ver las opciones, luego selecciona Venta Rápida.',
        mockupType: 'fab'
      },
      {
        title: 'Paso 1: Cliente y Productos',
        desc: 'Busca y selecciona al cliente (se te advertirá si pertenece a otro vendedor). Luego busca productos por nombre/categoría y tócalos para agregarlos directamente al carrito de compras in-line, donde puedes modificar la cantidad.',
        tip: 'Toca en "Inversiones Comerciales, C.A.", agrega "Cabilla 1/2" e incrementa la cantidad a 10 para continuar.',
        mockupType: 'vr_cliente_productos'
      },
      {
        title: 'Paso 2: Pago y Entrega',
        desc: 'Define los métodos de pago (pueden ser mixtos o divididos). Selecciona si se incluye Flete, el transportista, la dirección de entrega, o si se maneja como Cobro a Destino (COD).',
        tip: 'Toca en la opción "Flete / Transporte" y selecciona "Efectivo" en el simulador para avanzar.',
        mockupType: 'vr_pago_entrega'
      },
      {
        title: 'Paso 3: Emisión y Documentos',
        desc: 'Revisa los totales generales en divisas y bolívares. Presiona "Generar Despacho" para registrar la venta. Tendrás acceso inmediato para descargar, imprimir o compartir por WhatsApp la Nota de Entrega y la Orden de Despacho en PDF.',
        tip: 'Toca en "Generar Despacho" para concluir el flujo y ver las opciones de PDF.',
        mockupType: 'vr_finish'
      }
    ]
  },
  {
    id: 'cotizaciones',
    title: 'Cotizaciones',
    desc: 'Usa el constructor detallado para clientes recurrentes, descuentos de personal y presupuestos en PDF.',
    icon: FileText,
    color: 'from-indigo-500 to-violet-600 border-indigo-500/20',
    bgColor: 'bg-indigo-500/10',
    steps: [
      {
        title: 'Paso 1: Datos del Cliente',
        desc: 'Ingresa al constructor completo de cotizaciones y selecciona o crea al cliente. Si es un cliente de tipo "Personal", el sistema te advertirá que se le aplicará un descuento automático en el total (configurado en el negocio, ej: 10%).',
        tip: 'Toca sobre el buscador y selecciona a "Inversiones Comerciales, C.A." para ver los datos del cliente.',
        mockupType: 'cot_completa_cliente'
      },
      {
        title: 'Paso 2: Selección de Productos',
        desc: 'Busca productos por catálogo o usa el lector/escáner de listas bulk. Agrega los materiales a la cesta de compras a la derecha, donde puedes elegir entre los niveles de precio (P1, P2 o P3) y verificar el stock actual.',
        tip: 'Toca en la cesta para ajustar cantidades y definir precios promocionales autorizados.',
        mockupType: 'cot_completa_productos'
      },
      {
        title: 'Paso 3: Resumen y Opciones',
        desc: 'Configura las opciones finales: selecciona la moneda a mostrar en el PDF (USDT, BCV o Bs), activa o desactiva la inclusión de IVA (16%), agrega cargos de flete y escribe observaciones públicas o internas.',
        tip: 'Revisa el total general y el cálculo automático de tu Comisión Estimada antes de proceder.',
        mockupType: 'cot_completa_resumen'
      },
      {
        title: 'Paso 4: Confirmación y Compartir',
        desc: 'Una vez enviada, el sistema genera el código correlativo de cotización (ej. COT-01234). Podrás imprimir, descargar el PDF o compartir el enlace por WhatsApp. También tienes el botón "Despachar" para iniciar el envío de inmediato.',
        tip: 'Toca en "Compartir por WhatsApp" en la simulación para concluir el constructor.',
        mockupType: 'cot_completa_print'
      }
    ]
  },
  {
    id: 'despachos',
    title: 'Despachos',
    desc: 'Aprende los estados contextuales de las entregas, permisos de roles y acciones de vendedor.',
    icon: Truck,
    color: 'from-emerald-500 to-teal-600 border-emerald-500/20',
    bgColor: 'bg-emerald-500/10',
    steps: [
      {
        title: 'Estados Contextuales por Rol',
        desc: 'Los despachos tienen estados dinámicos. Por ejemplo, un despacho nuevo sale como "Esperando aprobación" (para vendedores), "Por aprobar" (para supervisores) o "Pendiente" (para logística). Al aprobarse pasa a "Aprobada/En entrega".',
        tip: 'Filtra y revisa los badges de estado para saber en qué parte del ciclo de entrega se encuentra la orden.',
        mockupType: 'despacho_estados'
      },
      {
        title: 'Acciones de Vendedor (Anular y Reciclar)',
        desc: 'Como vendedor no puedes despachar físicamente, pero tienes dos herramientas clave: puedes "Anular" un despacho pendiente si el cliente desiste, o "Reciclar" un despacho anulado para generar una nueva cotización con los mismos ítems.',
        tip: 'Toca en "Reciclar como Cotización" en el simulador para ver cómo se clona el despacho.',
        mockupType: 'despacho_acciones'
      },
      {
        title: 'Trazabilidad: Transporte y COD',
        desc: 'Los choferes, camiones y placas de vehículos son asignados por el rol de Logística al despachar. La Administración concilia y registra si los pagos de flete o Cobro a Destino (COD) son recibidos conforme.',
        tip: 'Toca en "Auto-completar Datos de Logística" en el simulador para ver la información de trazabilidad registrada.',
        mockupType: 'despacho_trazabilidad'
      }
    ]
  },
  {
    id: 'clientes',
    title: 'Clientes',
    desc: 'Registra nuevos clientes y consulta su historial de compras.',
    icon: Users,
    color: 'from-purple-500 to-pink-600 border-purple-500/20',
    bgColor: 'bg-purple-500/10',
    steps: [
      {
        title: 'Directorio de Clientes',
        desc: 'Accede a la base de datos completa. Puedes buscar por RIF, cédula o razón social y ver el total comprado por cada cliente.',
        tip: 'Usa el buscador para ubicar clientes rápidamente.',
        mockupType: 'cliente_list'
      },
      {
        title: 'Registro de un Nuevo Cliente',
        desc: 'Ingresa los datos fiscales obligatorios. Asegúrate de colocar el correo y teléfono celular correctos para el envío de cotizaciones.',
        tip: 'Toca el botón "+ Crear Nuevo Cliente" en el simulador.',
        mockupType: 'cliente_form'
      },
      {
        title: 'Historial de Cotizaciones',
        desc: 'Desde la ficha del cliente, puedes consultar su historial completo de cotizaciones y despachos, facilitando el seguimiento post-venta.',
        tip: 'Toca en la pestaña "Historial" en la simulación para completar el módulo.',
        mockupType: 'cliente_historial'
      }
    ]
  },
  {
    id: 'comisiones',
    title: 'Comisiones',
    desc: 'Monitorea tus ganancias por cada venta concretada.',
    icon: DollarSign,
    color: 'from-blue-500 to-cyan-600 border-blue-500/20',
    bgColor: 'bg-blue-500/10',
    steps: [
      {
        title: 'Mi Panel de Comisiones',
        desc: 'Monitorea tus ganancias por cada venta cobrada. El sistema calcula automáticamente el porcentaje correspondiente a tu rol.',
        tip: 'Recuerda que las comisiones se calculan sobre el precio de venta cobrado y despachado.',
        mockupType: 'comision_panel'
      },
      {
        title: 'Estados de Pago',
        desc: 'Conoce el estado de tus comisiones: "Por Liquidar" (material por despachar), "Disponible" (listo para cobro) o "Pagado".',
        tip: 'Revisa regularmente este estatus para planificar tus retiros.',
        mockupType: 'comision_estados'
      },
      {
        title: 'Filtros por Fecha',
        desc: 'Filtra tus comisiones por mes o rango de fechas para llevar un control detallado de tu desempeño comercial.',
        tip: 'Toca sobre el selector de fecha y marca "Este Mes" en la simulación.',
        mockupType: 'comision_filtros'
      }
    ]
  },
  {
    id: 'tips',
    title: 'Tips & Trucos',
    desc: 'Sincronización en tiempo real, modo offline y buzón de sugerencias.',
    icon: Lightbulb,
    color: 'from-teal-500 to-emerald-600 border-teal-500/20',
    bgColor: 'bg-teal-500/10',
    steps: [
      {
        title: 'Sincronización en Tiempo Real',
        desc: '¡Olvídate de F5! Si un supervisor actualiza una tasa de cambio o cambia un precio en el inventario, los valores en tu pantalla se actualizan automáticamente en segundos sin interrumpir tu trabajo.',
        tip: 'Observa cómo cambian las tasas y stock en el simulador al detectar actualizaciones en la red.',
        mockupType: 'tips_realtime'
      },
      {
        title: 'Buzón de Sugerencias',
        desc: '¿Tienes ideas de mejora o fallas técnicas? Envía comentarios usando el botón flotante de chat (ícono de mensaje). En la pestaña "Mis Mensajes" podrás ver el historial y las respuestas del equipo técnico.',
        tip: 'Toca en el FAB flotante del buzón (ícono de mensaje) en el simulador.',
        mockupType: 'tips_buzon'
      },
      {
        title: 'Modo Offline (Sin Conexión)',
        desc: '¡No te detengas! Si te quedas sin señal, Listo almacena tus cotizaciones localmente. Cuando recuperes la conexión, se sincronizarán solas.',
        tip: 'Verás un banner rojo de advertencia offline y un banner verde cuando se sincronice la cola pendiente.',
        mockupType: 'tips_offline'
      },
      {
        title: 'Duplicar Cotizaciones',
        desc: 'Si un cliente pide el mismo presupuesto que la semana pasada, no lo escribas de nuevo. Abre la cotización y haz clic en "Duplicar".',
        tip: 'Haz clic en "Duplicar" en la cotización de prueba para finalizar el tutorial completo.',
        mockupType: 'tips_duplicar'
      }
    ]
  }
]

export default function TutorialView() {
  const perfil = useAuthStore(s => s.perfil)
  
  // State
  const [activeModule, setActiveModule] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [progress, setProgress] = useState({})
  
  // Simulated Interactive States inside mockups
  const [mockupState, setMockupState] = useState({
    // quick quote / venta rapida variables
    qqFabOpen: false,
    qqSearched: false,
    qqQuantity: 1,
    qqAdded: false,
    qqFinished: false,
    qqClientSelected: false,
    qqProductAdded: false,
    qqDespachoSelected: false,
    qqPaymentSelected: false,
    // full quote variables
    cqClientSelected: false,
    cqDiscountApplied: false,
    cqDespachoSelected: false,
    cqNotesAdded: false,
    cqShared: false,
    cqCurrencySelected: false,
    cqProductAdded: false,
    // dispatch variables
    dsSelected: false,
    dsAssigned: false,
    dsPaymentSelected: false,
    dsDelivered: false,
    dsRecycled: false,
    // client variables
    clCreated: false,
    clTab: 'info',
    // commission variables
    cmFiltered: false,
    // tips variables
    tpBuzonOpen: false,
    tpBuzonTab: 'nuevo',
    tpOfflineSync: false,
    tpRealtimeActive: false
  })

  // Load progress from localStorage
  useEffect(() => {
    if (perfil?.cuenta_id) {
      const key = `listo-tutorial-progress-${perfil.cuenta_id}`
      const saved = localStorage.getItem(key)
      if (saved) {
        try {
          setProgress(JSON.parse(saved))
        } catch (e) {
          console.error(e)
        }
      }
    }
  }, [perfil?.cuenta_id])

  // Save progress
  const saveProgress = useCallback((newProgress) => {
    setProgress(newProgress)
    if (perfil?.cuenta_id) {
      const key = `listo-tutorial-progress-${perfil.cuenta_id}`
      localStorage.setItem(key, JSON.stringify(newProgress))
    }
  }, [perfil?.cuenta_id])

  // Reset progress
  const handleResetProgress = () => {
    if (window.confirm('¿Deseas restablecer tu progreso del tutorial?')) {
      saveProgress({})
      setActiveModule(null)
      setStepIndex(0)
    }
  }

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!activeModule) return
      if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        handlePrev()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeModule, stepIndex])

  const handleSelectModule = (mod) => {
    setActiveModule(mod)
    setStepIndex(0)
    // Reset mockup states for this session
    setMockupState({
      qqFabOpen: false,
      qqSearched: false,
      qqQuantity: 1,
      qqAdded: false,
      qqFinished: false,
      qqClientSelected: false,
      qqProductAdded: false,
      qqDespachoSelected: false,
      qqPaymentSelected: false,
      cqClientSelected: false,
      cqDiscountApplied: false,
      cqDespachoSelected: false,
      cqNotesAdded: false,
      cqShared: false,
      cqCurrencySelected: false,
      cqProductAdded: false,
      dsSelected: false,
      dsAssigned: false,
      dsPaymentSelected: false,
      dsDelivered: false,
      dsRecycled: false,
      clCreated: false,
      clTab: 'info',
      cmFiltered: false,
      tpBuzonOpen: false,
      tpBuzonTab: 'nuevo',
      tpOfflineSync: false,
      tpRealtimeActive: false
    })
  }

  const handleNext = () => {
    if (!activeModule) return
    if (stepIndex < activeModule.steps.length - 1) {
      setStepIndex(v => v + 1)
    } else {
      // Mark module as completed
      const newProgress = { ...progress, [activeModule.id]: true }
      saveProgress(newProgress)
      setActiveModule(null)
    }
  }

  const handlePrev = () => {
    if (stepIndex > 0) {
      setStepIndex(v => v - 1)
    }
  }

  // Calculations
  const completedCount = TUTORIAL_MODULES.filter(m => progress[m.id]).length
  const totalCount = TUTORIAL_MODULES.length
  const pctComplete = Math.round((completedCount / totalCount) * 100)

  // Interactive step controls inside mockups to auto-advance
  const handleMockupInteraction = (action) => {
    // Venta Rápida / Quick Quote
    if (action === 'qq-fab') {
      setMockupState(s => ({ ...s, qqFabOpen: true }))
    } else if (action === 'qq-select-vr') {
      setTimeout(() => setStepIndex(1), 300)
    } else if (action === 'vr-select-client') {
      setMockupState(s => ({ ...s, qqClientSelected: true }))
    } else if (action === 'vr-select-product') {
      setMockupState(s => ({ ...s, qqProductAdded: true }))
    } else if (action === 'vr-add-qty') {
      setMockupState(s => {
        const nextQty = s.qqQuantity + 1
        return { ...s, qqQuantity: nextQty }
      })
    } else if (action === 'vr-goto-pago') {
      setStepIndex(2)
    } else if (action === 'vr-select-despacho') {
      setMockupState(s => ({ ...s, qqDespachoSelected: true }))
    } else if (action === 'vr-select-pago') {
      setMockupState(s => ({ ...s, qqPaymentSelected: true }))
    } else if (action === 'vr-goto-confirmar') {
      setStepIndex(3)
    } else if (action === 'vr-finish') {
      setMockupState(s => ({ ...s, qqFinished: true }))
    }

    // Full Quote
    if (action === 'cq-client') {
      setMockupState(s => ({ ...s, cqClientSelected: true }))
    } else if (action === 'cq-goto-productos') {
      setStepIndex(1)
    } else if (action === 'cq-add-product') {
      setMockupState(s => ({ ...s, cqProductAdded: true }))
    } else if (action === 'cq-price-tier') {
      setMockupState(s => ({ ...s, cqDiscountApplied: true }))
    } else if (action === 'cq-goto-resumen') {
      setStepIndex(2)
    } else if (action === 'cq-currency') {
      setMockupState(s => ({ ...s, cqCurrencySelected: true }))
    } else if (action === 'cq-flete') {
      setMockupState(s => ({ ...s, cqDespachoSelected: true }))
    } else if (action === 'cq-enviar') {
      setStepIndex(3)
    } else if (action === 'cq-share') {
      setMockupState(s => ({ ...s, cqShared: true }))
    }

    // Despachos
    if (action === 'ds-view-states') {
      setStepIndex(1)
    } else if (action === 'ds-recycle') {
      setMockupState(s => ({ ...s, dsRecycled: true }))
    } else if (action === 'ds-goto-trazabilidad') {
      setStepIndex(2)
    } else if (action === 'ds-assign') {
      setMockupState(s => ({ ...s, dsAssigned: true, dsPaymentSelected: true }))
    }

    // Clientes
    if (action === 'cl-create-btn') {
      setMockupState(s => ({ ...s, clCreated: true }))
      setTimeout(() => setStepIndex(2), 850)
    } else if (action === 'cl-tab-history') {
      setMockupState(s => ({ ...s, clTab: 'history' }))
    }

    // Commissions
    if (action === 'cm-filter') {
      setMockupState(s => ({ ...s, cmFiltered: true }))
    }

    // Tips
    if (action === 'tp-realtime-trigger') {
      setMockupState(s => ({ ...s, tpRealtimeActive: true }))
    } else if (action === 'tp-buzon') {
      setMockupState(s => ({ ...s, tpBuzonOpen: true }))
    } else if (action === 'tp-buzon-tab-history') {
      setMockupState(s => ({ ...s, tpBuzonTab: 'historial' }))
    } else if (action === 'tp-offline') {
      setMockupState(s => ({ ...s, tpOfflineSync: true }))
    }
  }

  // Renders the mockup interface in the right pane
  const renderMockup = (type) => {
    switch (type) {
      case 'welcome':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-4 overflow-hidden border border-white/5 relative">
            <div className="flex justify-between items-center pb-3 border-b border-white/10 mb-4">
              <span className="text-xs font-black text-sky-400">Listo POS</span>
              <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full font-bold">En Línea</span>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center text-center p-4">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4 animate-pulse">
                <Sparkles size={32} className="text-white" />
              </div>
              <h4 className="text-base font-black text-white mb-2">¡Hola, {perfil?.nombre || 'Vendedor'}!</h4>
              <p className="text-xs text-white/50 max-w-[220px] mb-4">Listo para empezar tu jornada. ¿Qué deseas hacer hoy?</p>
              
              <div className="grid grid-cols-2 gap-2 w-full max-w-[260px]">
                <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-left hover:bg-white/10 transition-colors">
                  <div className="text-[10px] text-white/40 font-bold">Ventas Hoy</div>
                  <div className="text-sm font-extrabold text-white">$450.00</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-left hover:bg-white/10 transition-colors">
                  <div className="text-[10px] text-white/40 font-bold">Fletes</div>
                  <div className="text-sm font-extrabold text-white">3 Pend.</div>
                </div>
              </div>
            </div>
            <div className="bg-white/5 p-2 rounded-xl flex items-center gap-2 border border-white/5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[9px] text-white/45 font-bold">Sincronización de inventario completada</span>
            </div>
          </div>
        )

      case 'profile':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-4 overflow-hidden border border-white/5">
            <div className="h-10 bg-slate-900 border border-white/10 rounded-xl px-3 flex items-center justify-between mb-4 shadow-inner">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center text-[10px] font-bold text-white uppercase">
                  {perfil?.nombre?.charAt(0) || 'V'}
                </div>
                <span className="text-[10px] text-white/80 font-black truncate max-w-[70px]">{perfil?.nombre || 'Usuario'}</span>
                <span className="text-[8px] bg-teal-500/20 text-teal-300 border border-teal-500/30 px-1 rounded font-bold">Vendedor</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[8px] text-white/40 font-black uppercase">Listo POS</span>
              </div>
            </div>

            <h5 className="text-xs font-black text-white/40 uppercase mb-3 tracking-widest">Panel de Tasas de Cambio</h5>
            <div className="space-y-2.5">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex justify-between items-center hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-[10px] font-black text-emerald-400">BCV</div>
                  <span className="text-xs font-bold text-white/70">Dólar BCV</span>
                </div>
                <span className="text-xs font-extrabold text-emerald-300">Bs. 45.32</span>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex justify-between items-center hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center text-[10px] font-black text-blue-400">USDT</div>
                  <span className="text-xs font-bold text-white/70">Cripto USDT</span>
                </div>
                <span className="text-xs font-extrabold text-blue-300">Bs. 46.10</span>
              </div>
            </div>
          </div>
        )

      case 'dashboard':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-4 overflow-hidden border border-white/5">
            <h5 className="text-xs font-black text-white/40 uppercase mb-3 tracking-widest">Dashboard Resumen</h5>
            <div className="space-y-2.5 flex-1 overflow-y-auto">
              <div className="bg-gradient-to-r from-sky-500/10 to-indigo-500/10 border border-sky-500/20 rounded-xl p-3">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] text-white/50 font-bold">Total Cotizado</span>
                  <FileText size={14} className="text-sky-400" />
                </div>
                <div className="text-base font-extrabold text-white">$12,450.00</div>
                <div className="text-[10px] text-white/30 font-medium">Bs. 564,234.00 · Este mes</div>
              </div>

              <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-xl p-3">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] text-white/50 font-bold">Comisiones Acumuladas</span>
                  <DollarSign size={14} className="text-amber-400" />
                </div>
                <div className="text-base font-extrabold text-white">$345.50</div>
                <div className="text-[10px] text-white/30 font-medium">12 transacciones cobradas</div>
              </div>

              <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-xl p-3">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] text-white/50 font-bold">Despachos Pendientes</span>
                  <Truck size={14} className="text-emerald-400" />
                </div>
                <div className="text-base font-extrabold text-white">4 Ordenes</div>
                <div className="text-[10px] text-white/30 font-medium">2 en ruta · 2 en preparación</div>
              </div>
            </div>
          </div>
        )

      case 'fab':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-4 overflow-hidden border border-white/5 relative justify-between">
            <div className="bg-white/5 rounded-xl p-3 border border-white/10 text-center">
              <span className="text-xs font-bold text-white/60">Simulación de pantalla de ventas</span>
              <p className="text-[10px] text-white/30 mt-1">Presiona el botón flotante con el icono de más (+) para abrir las opciones.</p>
            </div>
            
            {/* Speed Dial Options Container */}
            {mockupState.qqFabOpen && (
              <div className="flex flex-col items-end gap-2 pr-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
                {/* Opción Venta Rápida */}
                <button 
                  onClick={() => handleMockupInteraction('qq-select-vr')}
                  className="flex items-center gap-2 pl-3 pr-2 py-1 bg-gradient-to-r from-slate-900 to-indigo-950 border border-white/10 rounded-full shadow-lg cursor-pointer hover:scale-105 active:scale-95 transition-all animate-bounce"
                >
                  <span className="text-[9px] font-black text-white uppercase tracking-wider">Venta Rápida</span>
                  <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
                    <Zap size={14} className="text-white fill-white" />
                  </div>
                </button>
                {/* Opción Cotización */}
                <div className="flex items-center gap-2 pl-3 pr-2 py-1 bg-slate-900/80 border border-white/10 rounded-full shadow-lg opacity-40">
                  <span className="text-[9px] font-black text-white uppercase tracking-wider">Cotización</span>
                  <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center">
                    <FileText size={14} className="text-white" />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end p-2">
              <button 
                onClick={() => handleMockupInteraction('qq-fab')}
                className={`w-12 h-12 rounded-full bg-gradient-to-r from-slate-900 to-indigo-950 border border-white/20 flex items-center justify-center shadow-lg cursor-pointer transition-all ${mockupState.qqFabOpen ? 'rotate-45' : 'animate-bounce'}`}
                title="Abrir opciones"
              >
                <Plus size={20} className="text-white" strokeWidth={2.5} />
                {!mockupState.qqFabOpen && <span className="absolute inset-0 rounded-full bg-amber-500/40 animate-ping pointer-events-none" />}
              </button>
            </div>
          </div>
        )

      case 'vr_cliente_productos':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between text-left">
            <div className="space-y-2.5 flex-1 overflow-y-auto">
              <span className="text-[9px] text-white/40 font-black uppercase tracking-wider">Paso 1: Cliente y Productos</span>
              
              {/* Cliente */}
              <div className="space-y-1">
                <label className="text-[8px] text-white/45 font-bold uppercase">Cliente</label>
                {!mockupState.qqClientSelected ? (
                  <div 
                    onClick={() => handleMockupInteraction('vr-select-client')}
                    className="bg-white/5 border border-white/10 rounded-lg p-2 flex justify-between items-center cursor-pointer hover:bg-white/10 animate-pulse"
                  >
                    <span className="text-[10px] text-white/70">Buscar o seleccionar cliente...</span>
                    <Plus size={10} className="text-white/40" />
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-2 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-black text-emerald-400">Inversiones Comerciales, C.A.</span>
                      <p className="text-[7px] text-white/50 mt-0.5">J-30495827-1 · Seleccionado</p>
                    </div>
                    <Check size={10} className="text-emerald-400" />
                  </div>
                )}
              </div>

              {/* Selector de productos */}
              <div className="space-y-1.5">
                <label className="text-[8px] text-white/45 font-bold uppercase">Catálogo de Productos</label>
                <div className="grid grid-cols-2 gap-2">
                  <div 
                    onClick={() => handleMockupInteraction('vr-select-product')}
                    className={`p-2 border rounded-xl cursor-pointer text-left transition-all ${mockupState.qqProductAdded ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-white/10 bg-white/5 hover:bg-white/10 animate-pulse'}`}
                  >
                    <span className="text-[10px] font-bold text-white block">Cabilla 1/2</span>
                    <span className="text-[8px] text-white/45 block mt-0.5">Stock: 420 pcs · $9.50</span>
                  </div>
                  <div className="p-2 border border-white/5 bg-white/5 rounded-xl opacity-30 text-left">
                    <span className="text-[10px] font-bold text-white block">Cemento Gris</span>
                    <span className="text-[8px] text-white/45 block mt-0.5">Stock: 80 sacos · $8.50</span>
                  </div>
                </div>
              </div>

              {/* Carrito de Compras */}
              {mockupState.qqProductAdded && (
                <div className="bg-slate-900 border border-white/10 rounded-xl p-2.5 space-y-2">
                  <span className="text-[8px] text-white/40 font-bold uppercase">Productos Agregados</span>
                  <div className="flex justify-between items-center text-[10px] text-white">
                    <span>Cabilla 1/2 Pulgada</span>
                    <div className="flex items-center gap-2">
                      <button className="w-5 h-5 rounded bg-white/10 flex items-center justify-center text-xs">-</button>
                      <span className="font-extrabold w-4 text-center">{mockupState.qqQuantity}</span>
                      <button 
                        onClick={() => handleMockupInteraction('vr-add-qty')}
                        className={`w-5 h-5 rounded bg-amber-500 text-white flex items-center justify-center text-xs font-bold cursor-pointer ${mockupState.qqQuantity < 10 ? 'animate-bounce' : ''}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="text-right border-t border-white/5 pt-1.5">
                    <span className="text-[8px] text-white/40 font-bold">Subtotal:</span>
                    <span className="text-[10px] font-black text-amber-400 ml-1.5">${(mockupState.qqQuantity * 9.5).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {mockupState.qqClientSelected && mockupState.qqProductAdded && mockupState.qqQuantity >= 10 && (
              <button 
                onClick={() => handleMockupInteraction('vr-goto-pago')}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-black py-2 rounded-lg shadow-lg flex items-center justify-center gap-1 cursor-pointer mt-2 animate-pulse"
              >
                Siguiente: Pago & Entrega <ArrowRight size={10} />
              </button>
            )}
          </div>
        )

      case 'vr_pago_entrega':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between text-left">
            <div className="space-y-3 flex-1 overflow-y-auto">
              <span className="text-[9px] text-white/40 font-black uppercase tracking-wider">Paso 2: Pago y Entrega</span>
              
              {/* Opciones de Despacho */}
              <div className="space-y-1">
                <label className="text-[8px] text-white/45 font-bold uppercase">Forma de Despacho</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-white/5 bg-white/5 rounded-xl p-2 text-center opacity-40">
                    <span className="text-[9px] text-white font-semibold block">Retira por Planta</span>
                  </div>
                  <div 
                    onClick={() => handleMockupInteraction('vr-select-despacho')}
                    className={`border rounded-xl p-2 text-center cursor-pointer transition-all ${mockupState.qqDespachoSelected ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10 animate-pulse'}`}
                  >
                    <span className={`text-[9px] font-bold block ${mockupState.qqDespachoSelected ? 'text-emerald-400' : 'text-white/80'}`}>Flete / Transporte</span>
                  </div>
                </div>
              </div>

              {/* Transportistas sugeridos (si flete activo) */}
              {mockupState.qqDespachoSelected && (
                <div className="bg-slate-900 border border-white/5 rounded-xl p-2 space-y-1.5">
                  <span className="text-[7px] text-white/40 font-bold block uppercase block">Transportistas de Turno</span>
                  <div className="text-[9px] text-white/70 flex justify-between">
                    <span>Transportes Express C.A. (Placa: A72B39X)</span>
                    <span className="font-extrabold text-white">$120.00</span>
                  </div>
                </div>
              )}

              {/* Formas de Pago */}
              <div className="space-y-1">
                <label className="text-[8px] text-white/45 font-bold uppercase">Método de Pago</label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button 
                    onClick={() => handleMockupInteraction('vr-select-pago')}
                    className={`py-1 px-0.5 rounded-lg text-[9px] font-black shadow cursor-pointer transition-all ${mockupState.qqPaymentSelected ? 'bg-emerald-500 text-white' : 'bg-white/5 text-white/75 hover:bg-white/10 animate-pulse'}`}
                  >
                    Efectivo
                  </button>
                  <button className="py-1 px-0.5 rounded-lg text-[9px] font-bold bg-white/5 text-white/30 cursor-not-allowed">Pago Móvil</button>
                  <button className="py-1 px-0.5 rounded-lg text-[9px] font-bold bg-white/5 text-white/30 cursor-not-allowed">CxC</button>
                </div>
              </div>

              {/* Cobro a Destino (COD) */}
              <div className="flex items-center justify-between bg-white/5 p-2 rounded-xl border border-white/5">
                <div>
                  <span className="text-[9px] font-bold text-white block">Cobro a Destino (COD)</span>
                  <p className="text-[7px] text-white/40">El cliente paga al recibir la mercancía</p>
                </div>
                <div className="w-8 h-4 rounded-full bg-white/10 relative p-0.5">
                  <div className="w-3 h-3 rounded-full bg-white/40" />
                </div>
              </div>
            </div>

            {mockupState.qqDespachoSelected && mockupState.qqPaymentSelected && (
              <button 
                onClick={() => handleMockupInteraction('vr-goto-confirmar')}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-black py-2 rounded-lg shadow-lg flex items-center justify-center gap-1 cursor-pointer mt-2 animate-pulse"
              >
                Siguiente: Resumen <ArrowRight size={10} />
              </button>
            )}
          </div>
        )

      case 'vr_finish':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between text-left">
            {mockupState.qqFinished ? (
              <div className="flex-1 flex flex-col justify-center items-center text-center p-4">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/35 flex items-center justify-center mb-2.5 text-emerald-400 animate-bounce">
                  <CheckCircle size={20} />
                </div>
                <h5 className="text-xs font-black text-white mb-0.5">¡Despacho Registrado!</h5>
                <span className="text-[9px] text-emerald-400 font-black">Nº de Despacho: VR-00204</span>
                <p className="text-[8px] text-white/40 max-w-[200px] mt-1 leading-relaxed">Nota de Entrega y Orden de Despacho generadas exitosamente.</p>
                
                <div className="space-y-1.5 w-full mt-3">
                  <button className="w-full bg-white/5 border border-white/10 py-1.5 rounded-lg text-[9px] text-white/80 flex items-center justify-center gap-1">
                    <Download size={10} /> Descargar Nota de Entrega (PDF)
                  </button>
                  <button className="w-full bg-white/5 border border-white/10 py-1.5 rounded-lg text-[9px] text-white/80 flex items-center justify-center gap-1">
                    <Download size={10} /> Descargar Orden de Despacho (PDF)
                  </button>
                  <button className="w-full bg-emerald-600/90 py-1.5 rounded-lg text-[9px] text-white flex items-center justify-center gap-1">
                    <Share2 size={10} /> Compartir por WhatsApp
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2 flex-1">
                  <span className="text-[9px] text-white/40 font-black uppercase tracking-wider block">Paso 3: Confirmar Venta</span>
                  
                  {/* Resumen */}
                  <div className="bg-slate-900/60 rounded-xl p-2 border border-white/5 space-y-1.5 text-[9px]">
                    <div className="flex justify-between text-white/70">
                      <span>Cliente:</span>
                      <span className="font-bold text-white">Inversiones Comerciales, C.A.</span>
                    </div>
                    <div className="flex justify-between text-white/70">
                      <span>Renglones:</span>
                      <span>10x Cabilla 1/2</span>
                    </div>
                    <div className="flex justify-between text-white/70">
                      <span>Flete:</span>
                      <span>$120.00</span>
                    </div>
                  </div>

                  {/* Totales */}
                  <div className="bg-white/5 rounded-xl p-2.5 border border-white/10 flex justify-between items-center">
                    <div>
                      <span className="text-[8px] text-white/40 font-bold block">Total en USD</span>
                      <div className="text-sm font-extrabold text-white">${(10 * 9.5 + 120.00).toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[8px] text-white/40 font-bold block">Tasa BCV (Bs. 45.32)</span>
                      <div className="text-[10px] font-black text-amber-400">Bs. {((10 * 9.5 + 120.00) * 45.32).toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => handleMockupInteraction('vr-finish')}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-black py-2 rounded-lg shadow-lg flex items-center justify-center gap-1 cursor-pointer animate-pulse"
                >
                  <Check size={12} />
                  Generar Despacho
                </button>
              </>
            )}
          </div>
        )

      // Cotizaciones Completa
      case 'cot_completa_cliente':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between text-left">
            <div className="space-y-2.5 flex-1 overflow-y-auto">
              <span className="text-[9px] text-white/40 font-black uppercase tracking-wider block">Paso 1: Datos del Cliente</span>
              
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2 text-white/35" />
                <input 
                  type="text" 
                  placeholder="Buscar por RIF o Razón Social..." 
                  className="w-full bg-slate-900/60 border border-white/10 rounded-lg py-1.5 pl-7 pr-3 text-[10px] text-white placeholder-white/25 focus:outline-none"
                  value={mockupState.cqClientSelected ? 'Inversiones Comerciales, C.A.' : ''}
                  readOnly
                />
              </div>

              {!mockupState.cqClientSelected ? (
                <div 
                  onClick={() => handleMockupInteraction('cq-client')}
                  className="bg-white/5 border border-white/10 rounded-lg p-2 flex justify-between items-center cursor-pointer hover:bg-white/10 group animate-pulse"
                >
                  <div>
                    <span className="text-[10px] font-bold text-white group-hover:text-amber-400">Inversiones Comerciales, C.A.</span>
                    <p className="text-[7px] text-white/40 mt-0.5">J-30495827-1 · Valencia, Edo. Miranda</p>
                  </div>
                  <Plus size={10} className="text-white/40" />
                </div>
              ) : (
                <div className="space-y-2.5 animate-in fade-in duration-300">
                  <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-2.5 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-black text-emerald-400">Inversiones Comerciales, C.A.</span>
                      <p className="text-[8px] text-white/50 mt-0.5">J-30495827-1 · Seleccionado correctamente</p>
                    </div>
                    <Check size={12} className="text-emerald-400" />
                  </div>
                  {/* Warning: cliente de otro vendedor */}
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 flex items-start gap-2">
                    <Info size={12} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[8px] text-amber-300 leading-normal font-medium">Este cliente está asignado a Edgar Ramírez. Puedes cotizarle pero se notificará al supervisor al enviar.</p>
                  </div>
                </div>
              )}
            </div>
            
            {mockupState.cqClientSelected && (
              <button 
                onClick={() => handleMockupInteraction('cq-goto-productos')}
                className="w-full bg-gradient-to-r from-slate-900 to-indigo-950 border border-white/10 text-white text-[10px] font-black py-2 rounded-lg shadow-lg flex items-center justify-center gap-1 cursor-pointer animate-pulse"
              >
                Siguiente: Productos <ArrowRight size={10} />
              </button>
            )}
          </div>
        )

      case 'cot_completa_productos':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between">
            <div className="space-y-3 flex-1 overflow-y-auto text-left">
              <span className="text-[9px] text-white/40 font-bold uppercase block">Paso 2: Selección de Productos</span>
              
              <div className="grid grid-cols-2 gap-2">
                <div 
                  onClick={() => handleMockupInteraction('cq-add-product')}
                  className={`p-2 border rounded-xl cursor-pointer text-left transition-all ${mockupState.cqProductAdded ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-white/10 bg-white/5 hover:bg-white/10 animate-pulse'}`}
                >
                  <span className="text-[10px] font-bold text-white block">Cabilla 1/2</span>
                  <span className="text-[8px] text-white/45 block mt-0.5">Stock: 420 pcs · $9.50</span>
                </div>
                <div className="p-2 border border-white/5 bg-white/5 rounded-xl opacity-20 text-left">
                  <span className="text-[10px] font-bold text-white block">Cemento Gris</span>
                  <span className="text-[8px] text-white/45 block mt-0.5">Stock: 80 sacos</span>
                </div>
              </div>

              {mockupState.cqProductAdded && (
                <div className="bg-slate-900 border border-white/15 rounded-xl p-2.5 space-y-2">
                  <span className="text-[8px] text-white/45 font-bold uppercase">Cesta de Compra</span>
                  <div className="flex justify-between items-center text-[10px] text-white">
                    <span>Cabilla 1/2 (50 pcs)</span>
                    <span className="font-extrabold">${mockupState.cqDiscountApplied ? '451.25' : '475.00'}</span>
                  </div>
                  
                  {/* Selector de nivel de precio */}
                  <div className="pt-2 border-t border-white/5">
                    <span className="text-[7px] text-white/40 font-bold uppercase block mb-1">Nivel de Precio</span>
                    <div className="grid grid-cols-3 gap-1">
                      <button className="bg-white/5 py-1 text-[8px] text-white/60 font-bold rounded">P1 ($9.50)</button>
                      <button 
                        onClick={() => handleMockupInteraction('cq-price-tier')}
                        className={`py-1 text-[8px] font-black rounded cursor-pointer transition-all ${mockupState.cqDiscountApplied ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/90 animate-pulse'}`}
                      >
                        P2 ($9.02)
                      </button>
                      <button className="bg-white/5 py-1 text-[8px] text-white/20 font-bold rounded cursor-not-allowed">P3</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {mockupState.cqProductAdded && (
              <button 
                onClick={() => handleMockupInteraction('cq-goto-resumen')}
                className="w-full bg-gradient-to-r from-slate-900 to-indigo-950 border border-white/10 text-white text-[10px] font-black py-2 rounded-lg shadow-lg flex items-center justify-center gap-1 cursor-pointer animate-pulse"
              >
                Siguiente: Opciones <ArrowRight size={10} />
              </button>
            )}
          </div>
        )

      case 'cot_completa_resumen':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between text-left">
            <div className="space-y-2.5 flex-1 overflow-y-auto">
              <span className="text-[9px] text-white/40 font-black uppercase tracking-wider block">Paso 3: Opciones y Resumen</span>
              
              {/* Moneda PDF */}
              <div className="space-y-1">
                <label className="text-[8px] text-white/45 font-bold uppercase">Moneda del PDF</label>
                <div className="grid grid-cols-3 gap-1 bg-white/5 p-0.5 rounded-lg border border-white/5">
                  <button className="py-1 text-[8px] font-bold rounded text-white/40">USDT ($)</button>
                  <button 
                    onClick={() => handleMockupInteraction('cq-currency')}
                    className={`py-1 text-[8px] font-black rounded cursor-pointer ${mockupState.cqCurrencySelected ? 'bg-indigo-500 text-white' : 'text-white/70 animate-pulse'}`}
                  >
                    Dólar BCV
                  </button>
                  <button className="py-1 text-[8px] font-bold rounded text-white/40">Bolívares</button>
                </div>
              </div>

              {/* Incluir IVA */}
              <div className="flex items-center justify-between text-[9px] text-white/70">
                <span>Incluir IVA (16%) en el PDF</span>
                <input type="checkbox" className="rounded bg-white/15 border-white/10" readOnly checked />
              </div>

              {/* Servicios adicionales (Flete) */}
              <div className="space-y-1">
                <label className="text-[8px] text-white/45 font-bold uppercase">Flete / Transporte (USD)</label>
                <div 
                  onClick={() => handleMockupInteraction('cq-flete')}
                  className={`h-6 bg-slate-900 border rounded px-2 flex items-center justify-between text-[9px] cursor-pointer ${mockupState.cqDespachoSelected ? 'border-emerald-500/30' : 'border-white/10 animate-pulse'}`}
                >
                  <span className="text-white/60">Costo del flete...</span>
                  <span className="font-extrabold text-white">{mockupState.cqDespachoSelected ? '$120.00' : ''}</span>
                </div>
              </div>

              {/* Comision Estimada */}
              {mockupState.cqDespachoSelected && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2 flex justify-between text-[9px] font-bold text-emerald-400">
                  <span>Comisión Estimada Vendedor</span>
                  <span>~$9.02 (2.0%)</span>
                </div>
              )}
            </div>

            {mockupState.cqCurrencySelected && mockupState.cqDespachoSelected && (
              <button 
                onClick={() => handleMockupInteraction('cq-enviar')}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-black py-2 rounded-lg shadow-lg flex items-center justify-center gap-1 cursor-pointer mt-2 animate-pulse"
              >
                <Send size={12} /> Enviar Cotización
              </button>
            )}
          </div>
        )

      case 'cot_completa_print':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-center items-center text-center">
            {mockupState.cqShared ? (
              <div className="animate-in zoom-in-95 duration-300">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mb-2.5 mx-auto text-emerald-400">
                  <Check size={18} />
                </div>
                <h6 className="text-xs font-black text-white">¡Enlace Compartido!</h6>
                <p className="text-[8px] text-white/40 mt-1 max-w-[180px]">El presupuesto fue guardado y se copió el enlace al portapapeles del dispositivo.</p>
              </div>
            ) : (
              <div className="space-y-2.5 w-full">
                <span className="text-[10px] font-black text-white/50 block">Paso 4: Cotización Enviada (#COT-08742)</span>
                
                <button className="w-full bg-white/5 border border-white/10 py-1.5 rounded-xl text-[9px] text-white font-bold flex items-center justify-center gap-1.5">
                  <Download size={12} className="text-red-400" /> Descargar PDF Oficial
                </button>
                
                <button 
                  onClick={() => handleMockupInteraction('cq-share')}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 py-1.5 rounded-xl text-[9px] text-white font-black flex items-center justify-center gap-1.5 shadow-lg cursor-pointer animate-pulse"
                >
                  <Share2 size={12} /> Compartir por WhatsApp
                </button>

                <div className="border-t border-white/5 pt-2 mt-2">
                  <button className="w-full bg-indigo-600 py-1.5 rounded-xl text-[9px] text-white font-bold flex items-center justify-center gap-1">
                    <Truck size={12} /> Despachar Inmediatamente
                  </button>
                </div>
              </div>
            )}
          </div>
        )

      // Despachos
      case 'despacho_estados':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between">
            <div className="space-y-2 flex-1">
              <span className="text-[9px] text-white/40 font-black uppercase tracking-wider block text-left">Despachos y Roles</span>
              
              <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-left flex justify-between items-center">
                <div>
                  <span className="text-[10px] font-black text-white">Orden #DSP-2045</span>
                  <p className="text-[7px] text-white/45 mt-0.5">Cliente: Distribuidora Demo</p>
                </div>
                <div className="text-right">
                  <span className="text-[8px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-black block">Esperando aprobación</span>
                  <span className="text-[7px] text-white/30 mt-0.5 block">Supervisor ve: "Por aprobar"</span>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-left flex justify-between items-center opacity-70">
                <div>
                  <span className="text-[10px] font-bold text-white">Orden #DSP-2044</span>
                  <p className="text-[7px] text-white/35 mt-0.5">Cliente: Ferretería Norte</p>
                </div>
                <div className="text-right">
                  <span className="text-[8px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded font-black block">Aprobada</span>
                  <span className="text-[7px] text-white/30 mt-0.5 block">Logística ve: "Por entregar"</span>
                </div>
              </div>
            </div>

            <button 
              onClick={() => handleMockupInteraction('ds-view-states')}
              className="w-full bg-indigo-600 py-1.5 text-[9px] font-black text-white rounded-lg cursor-pointer animate-pulse"
            >
              Siguiente: Acciones de Vendedor
            </button>
          </div>
        )

      case 'despacho_acciones':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between text-left">
            <span className="text-[9px] text-white/40 font-black uppercase tracking-wider block mb-1">Acciones del Vendedor</span>
            
            {mockupState.dsRecycled ? (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center my-auto animate-in zoom-in-95 duration-200">
                <CheckCircle size={18} className="text-emerald-400 mx-auto mb-1.5" />
                <span className="text-[10px] font-black text-white block">¡Despacho Reciclado!</span>
                <p className="text-[8px] text-emerald-300 mt-1">Se creó una cotización en borrador con los mismos productos para poder modificarla.</p>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-3 flex-1 flex flex-col justify-center">
                <div className="text-center pb-2 border-b border-white/5">
                  <span className="text-[9px] font-bold text-rose-400 block">Orden #DSP-2043 (Anulada)</span>
                  <p className="text-[7px] text-white/40">Despacho cancelado por desistimiento.</p>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <button className="bg-white/5 text-white/30 border border-white/5 py-2 rounded-lg text-[8px] font-bold cursor-not-allowed">Anular (Desactivado)</button>
                  <button 
                    onClick={() => handleMockupInteraction('ds-recycle')}
                    className="bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg text-[8px] font-black shadow-lg cursor-pointer animate-pulse"
                  >
                    Reciclar como Cotización
                  </button>
                </div>
              </div>
            )}

            {mockupState.dsRecycled && (
              <button 
                onClick={() => handleMockupInteraction('ds-goto-trazabilidad')}
                className="w-full bg-indigo-600 py-1.5 text-[9px] font-black text-white rounded-lg cursor-pointer mt-2 animate-pulse"
              >
                Siguiente: Trazabilidad Logística
              </button>
            )}
          </div>
        )

      case 'despacho_trazabilidad':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-between text-left">
            <span className="text-[9px] text-white/40 font-black uppercase tracking-wider block mb-1">Trazabilidad Registrada</span>
            
            <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-2 flex-1">
              {/* Logistica */}
              <div>
                <span className="text-[7px] text-white/40 font-bold block uppercase">Datos de Despacho (Logística)</span>
                <div className="h-6 bg-slate-900 border border-white/5 rounded px-2 flex items-center justify-between text-[9px] text-white mt-1">
                  <span>Conductor:</span>
                  <span className="font-bold">{mockupState.dsAssigned ? 'José Rafael González' : '—'}</span>
                </div>
                <div className="h-6 bg-slate-900 border border-white/5 rounded px-2 flex items-center justify-between text-[9px] text-white mt-1">
                  <span>Placa Camión:</span>
                  <span className="font-bold">{mockupState.dsAssigned ? 'A72B39X (NPR Blanco)' : '—'}</span>
                </div>
              </div>

              {/* Administracion */}
              <div>
                <span className="text-[7px] text-white/40 font-bold block uppercase">Conciliación de Pagos (Administración)</span>
                <div className="h-6 bg-slate-900 border border-white/5 rounded px-2 flex items-center justify-between text-[9px] text-white mt-1">
                  <span>Cobro a Destino (COD):</span>
                  <span className={`font-black ${mockupState.dsPaymentSelected ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {mockupState.dsPaymentSelected ? 'Conciliado ✓' : 'Pendiente de Conciliación'}
                  </span>
                </div>
              </div>
            </div>

            {!mockupState.dsAssigned && (
              <button 
                onClick={() => handleMockupInteraction('ds-assign')}
                className="w-full bg-amber-500 py-1.5 text-[9px] font-black text-white rounded-lg shadow-lg cursor-pointer mt-2 animate-pulse"
              >
                Auto-completar Datos de Logística
              </button>
            )}
          </div>
        )

      // Clientes
      case 'cliente_list':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left">
            <div className="relative mb-2">
              <Search size={12} className="absolute left-2.5 top-2 text-white/30" />
              <input 
                type="text" 
                placeholder="Buscar clientes por RIF..." 
                className="w-full bg-slate-900/60 border border-white/10 rounded-lg py-1.5 pl-7 text-[9px] text-white placeholder-white/20"
                readOnly
              />
            </div>
            <div className="space-y-1.5 flex-1 overflow-y-auto">
              <div className="bg-white/5 rounded-lg p-2 flex justify-between items-center border border-white/5">
                <div>
                  <span className="text-[10px] font-black text-white">Inversiones Comerciales, C.A.</span>
                  <span className="text-[8px] text-white/40 block">RIF: J-30495827-1</span>
                </div>
                <ChevronRight size={10} className="text-white/30" />
              </div>
              <div className="bg-white/5 rounded-lg p-2 flex justify-between items-center border border-white/5">
                <div>
                  <span className="text-[10px] font-black text-white">Ferretería del Centro</span>
                  <span className="text-[8px] text-white/40 block">RIF: J-5049382-0</span>
                </div>
                <ChevronRight size={10} className="text-white/30" />
              </div>
            </div>
          </div>
        )

      case 'cliente_form':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left justify-between">
            <div className="space-y-2">
              <span className="text-[9px] text-white/40 font-black uppercase">Nuevo Cliente</span>
              <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-2">
                <div>
                  <label className="text-[8px] text-white/40 font-bold block mb-0.5">Nombre / Razón Social</label>
                  <div className="h-6 bg-slate-900 rounded border border-white/5 px-2 flex items-center text-[9px] text-white font-medium">
                    {mockupState.clCreated ? 'Ferretería el Constructor' : ''}
                  </div>
                </div>
                <div>
                  <label className="text-[8px] text-white/40 font-bold block mb-0.5">RIF / Cédula</label>
                  <div className="h-6 bg-slate-900 rounded border border-white/5 px-2 flex items-center text-[9px] text-white">
                    {mockupState.clCreated ? 'J-82739485-2' : ''}
                  </div>
                </div>
              </div>
            </div>

            <button 
              onClick={() => handleMockupInteraction('cl-create-btn')}
              className="w-full bg-amber-500 py-1.5 text-[9px] font-black text-white rounded-lg shadow-lg cursor-pointer animate-pulse"
            >
              {mockupState.clCreated ? 'Registrado ✓' : 'Crear Registro'}
            </button>
          </div>
        )

      case 'cliente_historial':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left justify-between">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex justify-between items-center pb-2 border-b border-white/10 mb-2">
                <span className="text-[10px] font-black text-amber-400">Inversiones Comerciales, C.A.</span>
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-2 gap-1 mb-2 bg-white/5 p-0.5 rounded-lg border border-white/5">
                <button 
                  onClick={() => setMockupState(s => ({ ...s, clTab: 'info' }))}
                  className={`py-1 text-[8px] font-bold rounded ${mockupState.clTab === 'info' ? 'bg-white/10 text-white' : 'text-white/40'}`}
                >
                  Detalles
                </button>
                <button 
                  onClick={() => handleMockupInteraction('cl-tab-history')}
                  className={`py-1 text-[8px] font-black rounded cursor-pointer ${mockupState.clTab === 'history' ? 'bg-amber-500 text-white' : 'text-white/40 animate-pulse'}`}
                >
                  Historial (Logs)
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto">
                {mockupState.clTab === 'info' ? (
                  <div className="text-[8px] text-white/50 space-y-1">
                    <p>**Tlf:** +58 412-3456789</p>
                    <p>**Ubicación:** Valencia, Miranda</p>
                    <p>**Vendedor Asignado:** {perfil?.nombre || 'Tú'}</p>
                  </div>
                ) : (
                  <div className="space-y-1 animate-in fade-in duration-300">
                    <div className="bg-slate-900 p-1.5 rounded border border-white/5 flex justify-between text-[8px]">
                      <span className="text-white/70">Cotización #COT-8742</span>
                      <span className="text-emerald-400 font-bold">$450.00</span>
                    </div>
                    <div className="bg-slate-900 p-1.5 rounded border border-white/5 flex justify-between text-[8px]">
                      <span className="text-white/70">Despacho #DSP-2041</span>
                      <span className="text-sky-400 font-bold">Entregado</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )

      // Commissions
      case 'comision_panel':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left justify-between">
            <span className="text-[9px] text-white/40 font-black uppercase">Resumen de Comisiones</span>
            
            <div className="grid grid-cols-2 gap-2 flex-1 my-2">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">
                <span className="text-[8px] text-white/40 font-bold block">Disponible</span>
                <span className="text-xs font-black text-emerald-300">$185.00</span>
                <p className="text-[7px] text-white/30 block mt-1">Listo para cobrar</p>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
                <span className="text-[8px] text-white/40 font-bold block">Por Liquidar</span>
                <span className="text-xs font-black text-amber-300">$95.00</span>
                <p className="text-[7px] text-white/30 block mt-1">Pendiente despacho</p>
              </div>
            </div>

            <div className="bg-white/5 p-2 rounded-xl border border-white/5 flex items-center justify-between text-[8px] text-white/40">
              <span>Tasa de Comisión Promedio:</span>
              <span className="font-bold text-white/75">1.5%</span>
            </div>
          </div>
        )

      case 'comision_estados':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left">
            <span className="text-[9px] text-white/40 font-black uppercase mb-2">Comisiones Detalladas</span>
            
            <div className="space-y-1.5 overflow-y-auto flex-1">
              <div className="bg-slate-900 border border-white/5 rounded-lg p-2 flex justify-between items-center text-[9px]">
                <div>
                  <span className="text-white/80 font-bold">Ref: #COT-8742</span>
                  <p className="text-[7px] text-white/30 block mt-0.5">Cobrado el 15/06</p>
                </div>
                <div className="text-right">
                  <span className="text-emerald-400 font-extrabold">$22.50</span>
                  <span className="text-[7px] bg-emerald-500/20 text-emerald-300 px-1 rounded block mt-0.5 font-bold">Disponible</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-white/5 rounded-lg p-2 flex justify-between items-center text-[9px]">
                <div>
                  <span className="text-white/80 font-bold">Ref: #COT-8741</span>
                  <p className="text-[7px] text-white/30 block mt-0.5">En proceso despacho</p>
                </div>
                <div className="text-right">
                  <span className="text-amber-400 font-extrabold">$14.20</span>
                  <span className="text-[7px] bg-amber-500/20 text-amber-300 px-1 rounded block mt-0.5 font-bold">Por Liquidar</span>
                </div>
              </div>
            </div>
          </div>
        )

      case 'comision_filtros':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left justify-between">
            <div className="space-y-3">
              <span className="text-[9px] text-white/40 font-black uppercase">Filtrar Ganancias</span>
              
              <div>
                <label className="text-[8px] text-white/40 font-bold block mb-0.5">Período de Ventas</label>
                <div className="h-6 bg-slate-900 rounded border border-white/5 px-2 flex items-center text-[9px] text-white/70">
                  {mockupState.cmFiltered ? 'Este Mes (15/06 - 30/06)' : 'Todos los registros'}
                </div>
              </div>
            </div>

            <button 
              onClick={() => handleMockupInteraction('cm-filter')}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 py-1.5 text-[9px] font-black text-white rounded-lg shadow-lg cursor-pointer animate-pulse"
            >
              {mockupState.cmFiltered ? 'Filtro Aplicado ✓' : 'Filtrar por "Este Mes"'}
            </button>
          </div>
        )

      // Tips
      case 'tips_realtime':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left justify-between">
            <span className="text-[9px] text-white/40 font-black uppercase tracking-wider">Tasa y Precios en Tiempo Real</span>
            
            <div className="space-y-2.5 my-2 flex-1">
              <div className="bg-slate-900 border border-white/5 rounded-lg p-2.5 space-y-2">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-white/60">Tasa Dólar BCV:</span>
                  <span className={`font-black ${mockupState.tpRealtimeActive ? 'text-emerald-400 animate-pulse text-xs' : 'text-white'}`}>
                    {mockupState.tpRealtimeActive ? 'Bs. 45.85' : 'Bs. 45.32'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-white/60">Stock Cabilla 1/2:</span>
                  <span className={`font-black ${mockupState.tpRealtimeActive ? 'text-rose-400 animate-pulse text-xs' : 'text-white'}`}>
                    {mockupState.tpRealtimeActive ? '390 piezas' : '420 piezas'}
                  </span>
                </div>
              </div>

              {mockupState.tpRealtimeActive && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2 flex items-center gap-1.5 animate-in slide-in-from-top duration-300">
                  <RefreshCw size={10} className="text-emerald-400 animate-spin" />
                  <span className="text-[8px] text-emerald-300 font-bold leading-tight">¡Tasas y stock actualizados en tiempo real!</span>
                </div>
              )}
            </div>

            {!mockupState.tpRealtimeActive && (
              <button 
                onClick={() => handleMockupInteraction('tp-realtime-trigger')}
                className="w-full bg-gradient-to-r from-teal-500 to-emerald-600 py-1.5 text-[9px] font-black text-white rounded-lg shadow-lg cursor-pointer animate-pulse"
              >
                Simular Cambio de Tasa de Cambio
              </button>
            )}
          </div>
        )

      case 'tips_buzon':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 relative justify-between text-left">
            {mockupState.tpBuzonOpen ? (
              <div className="bg-slate-900 border border-white/10 rounded-xl p-2 flex-1 flex flex-col justify-between animate-in zoom-in-95 duration-200">
                <div>
                  {/* Tabs */}
                  <div className="grid grid-cols-2 gap-1 bg-white/5 p-0.5 rounded-lg border border-white/5 mb-2">
                    <button 
                      onClick={() => setMockupState(s => ({ ...s, tpBuzonTab: 'nuevo' }))}
                      className={`py-0.5 text-[7px] font-bold rounded ${mockupState.tpBuzonTab === 'nuevo' ? 'bg-white/10 text-white' : 'text-white/40'}`}
                    >
                      Enviar
                    </button>
                    <button 
                      onClick={() => handleMockupInteraction('tp-buzon-tab-history')}
                      className={`py-0.5 text-[7px] font-black rounded cursor-pointer ${mockupState.tpBuzonTab === 'historial' ? 'bg-amber-500 text-white' : 'text-white/40 animate-pulse'}`}
                    >
                      Mis Mensajes
                    </button>
                  </div>

                  {mockupState.tpBuzonTab === 'nuevo' ? (
                    <div className="space-y-1.5">
                      <span className="text-[8px] text-amber-400 font-bold block">Nuevo Mensaje</span>
                      <textarea 
                        className="w-full bg-slate-950 border border-white/5 rounded p-1 text-[8px] text-white placeholder-white/20 h-10 resize-none focus:outline-none"
                        value="Sería excelente agregar un botón para calcular fletes por zona."
                        onChange={() => {}}
                        readOnly
                        disabled
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5 animate-in fade-in duration-300 overflow-y-auto max-h-[110px]">
                      <div className="bg-slate-950 p-1 rounded border border-white/5 text-[7px]">
                        <p className="text-white/80 font-semibold">Mensaje: Sería excelente agregar un botón...</p>
                        <div className="mt-1 p-1 bg-blue-500/10 border-l border-blue-400 text-blue-300 rounded-r text-[6px] leading-snug">
                          <span className="font-bold block text-[5px] uppercase">Nota Dev:</span>
                          ¡Hola! Ya agregamos la estimación de fletes por transportistas en la sección de despacho.
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {mockupState.tpBuzonTab === 'nuevo' && (
                  <button className="w-full bg-amber-500 py-1 text-[8px] font-black text-white rounded shadow-sm" type="button">
                    Enviar Sugerencia
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="bg-white/5 rounded-xl p-2 text-center text-[9px] text-white/50">
                  Haz clic en el ícono de sugerencias abajo a la derecha para simular abrir el buzón del sistema.
                </div>
                
                <div className="flex justify-end mt-4">
                  <button 
                    onClick={() => handleMockupInteraction('tp-buzon')}
                    className="w-10 h-10 rounded-full bg-gradient-to-r from-slate-900 to-indigo-950 border border-white/25 flex items-center justify-center shadow-lg cursor-pointer animate-bounce relative"
                    type="button"
                  >
                    <MessageSquare size={18} className="text-white animate-pulse" />
                    <span className="absolute inset-0 rounded-full bg-amber-500/40 animate-ping pointer-events-none" />
                  </button>
                </div>
              </>
            )}
          </div>
        )

      case 'tips_offline':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 text-left justify-between">
            <span className="text-[9px] text-white/40 font-black uppercase">Simulación Offline</span>
            
            <div className="space-y-2.5 my-2 flex-1">
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5 flex items-center gap-2">
                <WifiOff size={14} className="text-rose-400 shrink-0" />
                <div>
                  <span className="text-[9px] text-rose-300 font-bold block">Sin conexión a Internet</span>
                  <p className="text-[7px] text-white/40 mt-0.5 leading-snug">Modo offline activo. Puedes seguir cotizando.</p>
                </div>
              </div>

              {mockupState.tpOfflineSync && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5 flex items-center gap-2 animate-in slide-in-from-top duration-300">
                  <RefreshCw size={12} className="text-emerald-400 shrink-0 animate-spin" />
                  <div>
                    <span className="text-[9px] text-emerald-300 font-bold block">Sincronizando datos...</span>
                    <p className="text-[7px] text-white/40 mt-0.5 leading-snug">Se subieron 2 cotizaciones pendientes exitosamente.</p>
                  </div>
                </div>
              )}
            </div>

            {!mockupState.tpOfflineSync && (
              <button 
                onClick={() => handleMockupInteraction('tp-offline')}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-1.5 text-[9px] font-black text-white rounded-lg shadow-lg cursor-pointer animate-pulse"
              >
                Simular Recuperación de Señal
              </button>
            )}
          </div>
        )

      case 'tips_duplicar':
        return (
          <div className="flex flex-col h-full bg-slate-950/40 rounded-2xl p-3 overflow-hidden border border-white/5 justify-center">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-left">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <span className="text-[10px] font-black text-white">Cotización #COT-8640</span>
                  <p className="text-[8px] text-white/40 block mt-0.5">Cliente: Constructor Demo</p>
                </div>
                <span className="text-xs font-black text-white">$1,250.00</span>
              </div>
              
              <button 
                onClick={handleNext}
                className="w-full bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 py-2 rounded-xl text-[10px] text-white font-black flex items-center justify-center gap-1.5 shadow-lg cursor-pointer animate-pulse"
              >
                <Copy size={12} />
                Duplicar Cotización
              </button>
            </div>
          </div>
        )

      default:
        return (
          <div className="flex h-full items-center justify-center text-xs text-white/20">
            Vista no disponible
          </div>
        )
    }
  }

  // Renders the main dashboard of modules or the walkthrough
  return (
    <div className="flex-1 p-4 md:p-6 text-slate-800" style={{ background: '#f8fafc' }}>
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Area */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 to-indigo-950 p-6 md:p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden border border-white/5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,#b8860b,transparent_25%)] opacity-20 pointer-events-none" />
          <div className="relative z-10 space-y-1">
            <div className="flex items-center gap-2 text-amber-400 font-extrabold text-xs tracking-widest uppercase">
              <Sparkles size={14} className="animate-spin duration-1000" />
              <span>Listo POS Academia</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">Centro de Aprendizaje Interactiva</h1>
            <p className="text-xs text-white/50 max-w-lg">Domina los flujos de ventas, cotizaciones rápidas, fletes y comisiones del sistema oficial de Listo POS.</p>
          </div>

          <div className="relative z-10 flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl p-4 min-w-[220px] backdrop-blur-sm self-start md:self-auto">
            {/* Progress Gauge */}
            <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
              <svg className="w-12 h-12 transform -rotate-90">
                <circle cx="24" cy="24" r="20" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
                <circle 
                  cx="24" 
                  cy="24" 
                  r="20" 
                  fill="transparent" 
                  stroke="#fbbf24" 
                  strokeWidth="4" 
                  strokeDasharray={`${2 * Math.PI * 20}`}
                  strokeDashoffset={`${2 * Math.PI * 20 * (1 - pctComplete / 100)}`}
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <span className="absolute text-[10px] font-black text-white">{pctComplete}%</span>
            </div>
            <div>
              <span className="text-[10px] text-white/40 font-bold block uppercase tracking-wider">Progreso General</span>
              <span className="text-sm font-black text-white">{completedCount} de {totalCount} Módulos</span>
              <button 
                onClick={handleResetProgress}
                className="text-[9px] font-bold text-amber-400 hover:text-amber-300 block mt-0.5 hover:underline"
              >
                Restablecer progreso
              </button>
            </div>
          </div>
        </div>

        {/* Walkthrough Mode */}
        {activeModule ? (
          <div className="flex flex-col lg:flex-row gap-6 items-stretch">
            
            {/* Stepper Details Panel */}
            <div className="flex-1 lg:flex-[7] bg-white border border-slate-200/80 rounded-3xl p-5 md:p-8 shadow-xl flex flex-col justify-between min-h-[420px] relative overflow-hidden min-w-0">
              <div className="space-y-5">
                {/* Back to list */}
                <button 
                  onClick={() => setActiveModule(null)}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 hover:bg-slate-100 px-3 py-1.5 rounded-xl transition-all self-start"
                >
                  <ArrowLeft size={14} /> Volver a módulos
                </button>

                {/* Progress Indicators */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex gap-1.5">
                    {activeModule.steps.map((_, i) => (
                      <span 
                        key={i} 
                        onClick={() => setStepIndex(i)}
                        className={`h-2 rounded-full cursor-pointer transition-all ${
                          i === stepIndex 
                            ? 'w-6 bg-slate-900' 
                            : i < stepIndex 
                            ? 'w-2 bg-emerald-500' 
                            : 'w-2 bg-slate-200 hover:bg-slate-300'
                        }`} 
                        title={`Paso ${i + 1}`}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    Paso {stepIndex + 1} de {activeModule.steps.length}
                  </span>
                </div>

                {/* Step Content */}
                <div className="space-y-3 animate-in fade-in duration-300">
                  <span className="text-[10px] font-black tracking-widest text-indigo-600 uppercase">
                    Módulo: {activeModule.title}
                  </span>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-snug">
                    {activeModule.steps[stepIndex].title}
                  </h2>
                  <p className="text-sm text-slate-500 leading-relaxed font-medium">
                    {activeModule.steps[stepIndex].desc}
                  </p>
                </div>
              </div>

              {/* Tips and Controls */}
              <div className="mt-8 space-y-4">
                {activeModule.steps[stepIndex].tip && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Lightbulb size={16} className="text-amber-500" />
                    </div>
                    <div className="text-left">
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">Tip del Experto</span>
                      <p className="text-xs text-amber-700/80 mt-0.5 leading-relaxed font-semibold">
                        {activeModule.steps[stepIndex].tip}
                      </p>
                    </div>
                  </div>
                )}

                {/* Controls */}
                <div className="flex justify-between items-center gap-3 pt-2">
                  <button 
                    onClick={handlePrev}
                    disabled={stepIndex === 0}
                    className="flex-1 max-w-[120px] bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 py-3 rounded-2xl text-xs font-black flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ArrowLeft size={14} /> Anterior
                  </button>

                  <button 
                    onClick={handleNext}
                    className="flex-1 bg-gradient-to-r from-slate-900 to-indigo-950 hover:from-slate-800 hover:to-indigo-900 text-white py-3 rounded-2xl text-xs font-black flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-slate-900/15 cursor-pointer"
                  >
                    {stepIndex === activeModule.steps.length - 1 ? (
                      <>Completar Módulo <CheckCircle2 size={14} /></>
                    ) : (
                      <>Siguiente <ArrowRight size={14} /></>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Simulated Live Mockup Panel */}
            <div className="flex-1 lg:flex-[5] bg-gradient-to-b from-slate-900 to-slate-950 rounded-3xl p-6 shadow-2xl flex flex-col border border-white/5 relative overflow-hidden min-h-[420px] min-w-0">
              {/* Mesh background effect */}
              <div className="absolute inset-0 bg-grid-white/[0.02] pointer-events-none" />
              <div className="absolute top-1/4 left-1/4 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 flex-1 flex flex-col justify-between">
                {/* Mockup Header */}
                <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                  </div>
                  <div className="text-[10px] text-white/35 font-bold uppercase tracking-wider">
                    Simulación Interactiva
                  </div>
                </div>

                {/* Mockup Content Render */}
                <div className="flex-1 min-h-[280px]">
                  {renderMockup(activeModule.steps[stepIndex].mockupType)}
                </div>
              </div>
            </div>

          </div>
        ) : (
          /* Modules Selection View */
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Módulos del Sistema</h2>
                <p className="text-xs text-slate-400 font-medium">Completa las siguientes {totalCount} guías para dominar Listo POS.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {TUTORIAL_MODULES.map((mod) => {
                const IconComp = mod.icon
                const isCompleted = progress[mod.id]
                
                return (
                  <div 
                    key={mod.id}
                    onClick={() => handleSelectModule(mod)}
                    className="bg-white border border-slate-200/70 hover:border-slate-300 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
                  >
                    <div className="space-y-4 relative z-10">
                      {/* Icon */}
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${mod.color} flex items-center justify-center shadow-lg text-white group-hover:scale-105 transition-transform`}>
                        <IconComp size={20} />
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
                          {mod.title}
                          {isCompleted && (
                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                          )}
                        </h3>
                        <p className="text-xs text-slate-400 font-medium leading-relaxed">
                          {mod.desc}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between relative z-10">
                      <span className="text-[10px] font-bold text-slate-400">
                        {mod.steps.length} pasos
                      </span>
                      
                      <button className={`text-[10px] font-black px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                        isCompleted 
                          ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' 
                          : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-600/10'
                      }`}>
                        {isCompleted ? 'Repasar' : 'Iniciar'} <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
