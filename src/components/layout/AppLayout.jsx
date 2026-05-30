// src/components/layout/AppLayout.jsx
// Layout principal: sidebar fijo en desktop, drawer en móvil
import { useState, useRef, useEffect, memo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Users, FileText, Package, Truck, Zap,
  UserCog, ClipboardList,
  LayoutDashboard, Settings, ArrowRightLeft,
  Menu, X, DollarSign, RefreshCw, PackageCheck, Bell, BellOff,
  AlertTriangle, Send, CheckCircle, Ban,
  PanelLeftClose, PanelLeftOpen, BarChart3, BarChart2,
  Clock, AlertCircle, ScrollText, FlaskConical, UserX, Shield, ShoppingCart,
  Globe, Compass, Smartphone, HelpCircle, Lock,
} from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import LoginAvatar from '../auth/LoginAvatar'
import BcvWidget from './BcvWidget'
import BottomNav from './BottomNav'
import Breadcrumbs from '../ui/Breadcrumbs'
import QuickQuoteFAB from '../cotizaciones/QuickQuoteFAB'
import { useRealtimeSync } from '../../hooks/useRealtimeSync'
import { useAdminAlerts } from '../../hooks/useAdminAlerts'
import { useRecordatoriosCotizaciones } from '../../hooks/useRecordatoriosCotizaciones'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { showToast } from '../ui/Toast'
import { NOTIF_TYPES, setNotificationUserId, startRealtimeNotifications, stopRealtimeNotifications } from '../../services/notificationService'
import PendingQueueBadge from '../ui/PendingQueueBadge'
import { useOffline } from '../ui/OfflineBanner'

// ─── Formato de tiempo relativo para notificaciones ─────────────────────────
function formatNotifTime(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Ahora'
  if (mins < 60) return `Hace ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `Hace ${days}d`
  return new Date(ts).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
}

// ─── Iconos por tipo de notificación ────────────────────────────────────────
const NOTIF_ICON_MAP = {
  [NOTIF_TYPES.STOCK_BAJO]:                    { icon: AlertTriangle, color: 'text-amber-500',    bg: 'bg-amber-50' },
  [NOTIF_TYPES.STOCK_CRITICO]:                 { icon: AlertCircle,   color: 'text-red-600',     bg: 'bg-red-50' },
  [NOTIF_TYPES.STOCK_REABASTECIDO]:            { icon: PackageCheck,  color: 'text-green-500',   bg: 'bg-green-50' },
  [NOTIF_TYPES.COTIZACION_ENVIADA]:            { icon: Send,          color: 'text-sky-500',     bg: 'bg-sky-50' },
  [NOTIF_TYPES.COTIZACION_ACEPTADA]:           { icon: CheckCircle,   color: 'text-emerald-500', bg: 'bg-emerald-50' },
  [NOTIF_TYPES.COTIZACION_ACEPTADA_DESPACHO]:  { icon: CheckCircle,   color: 'text-emerald-600', bg: 'bg-emerald-50' },
  [NOTIF_TYPES.DESPACHO_CREADO]:               { icon: Truck,         color: 'text-indigo-500',  bg: 'bg-indigo-50' },
  [NOTIF_TYPES.DESPACHO_EN_RUTA]:              { icon: Truck,         color: 'text-blue-500',    bg: 'bg-blue-50' },
  [NOTIF_TYPES.DESPACHO_ENTREGADO]:            { icon: PackageCheck,  color: 'text-green-600',   bg: 'bg-green-50' },
  [NOTIF_TYPES.DESPACHO_CANCELADO]:            { icon: Ban,           color: 'text-red-500',     bg: 'bg-red-50' },
  [NOTIF_TYPES.DESPACHO_PENDIENTE_MUCHO]:      { icon: Clock,         color: 'text-amber-600',   bg: 'bg-amber-50' },
  [NOTIF_TYPES.COTIZACION_ANULADA]:            { icon: Ban,           color: 'text-red-500',     bg: 'bg-red-50' },
  [NOTIF_TYPES.COTIZACION_SIN_RESPUESTA]:      { icon: Clock,         color: 'text-orange-500',  bg: 'bg-orange-50' },
  [NOTIF_TYPES.COMPROMISO_ALTO]:               { icon: AlertTriangle, color: 'text-orange-500',  bg: 'bg-orange-50' },
  [NOTIF_TYPES.DESPACHO_CLIENTE_AJENO]:         { icon: UserX,         color: 'text-red-500',     bg: 'bg-red-50' },
  [NOTIF_TYPES.FACTURACION_CLIENTE_AJENO]:      { icon: UserX,         color: 'text-amber-600',   bg: 'bg-amber-50' },
}
const DEFAULT_NOTIF_ICON = { icon: Bell, color: 'text-slate-400', bg: 'bg-slate-50' }

function NotifIcon({ type }) {
  const { icon: Icon, color, bg } = NOTIF_ICON_MAP[type] || DEFAULT_NOTIF_ICON
  return (
    <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
      <Icon size={16} className={color} />
    </div>
  )
}

// ─── Definición de rutas de navegación ────────────────────────────────────────
const NAV_TODOS = [
  { path: '/',               label: 'Inicio',         icono: LayoutDashboard },
  { path: '/venta-rapida',   label: 'Venta rápida',   icono: Zap,            onlyRoles: ['vendedor', 'vendedor_sin_comision', 'supervisor'] },
  { path: '/cotizaciones',   label: 'Cotizaciones',   icono: FileText,       excludeRoles: ['logistica', 'administracion'] },
  { path: '/despachos',      label: 'Despachos',      icono: PackageCheck,   labelByRole: { logistica: 'Entregas' } },
  { path: '/clientes',       label: 'Clientes',       icono: Users,          excludeRoles: ['logistica'] },
  { path: '/inventario',     label: 'Inventario',     icono: Package,        excludeRoles: ['logistica'] },
  { path: '/transportistas', label: 'Transportistas', icono: Truck,          excludeRoles: ['logistica'] },
  { path: '/comisiones',     label: 'Comisiones',     icono: DollarSign,     excludeRoles: ['logistica', 'administracion'] },
]

const NAV_SUPERVISOR = [
  { path: '/reporte-vendedores', label: 'Reporte Vendedores', icono: BarChart2, onlyRoles: ['supervisor', 'jefe', 'desarrollador'] },
  { path: '/orden-compra',        label: 'Orden de Compra',   icono: ShoppingCart, onlyRoles: ['supervisor', 'jefe', 'desarrollador'] },
  { path: '/seguimiento-operativo', label: 'Seguimiento Operativo', icono: ClipboardList, onlyRoles: ['supervisor', 'administracion', 'jefe', 'desarrollador'] },
  { path: '/reportes',      label: 'Reportes',      icono: BarChart3,   excludeRoles: ['supervisor'] },
  { path: '/configuracion', label: 'Configuración', icono: Settings, excludeRoles: ['vendedor', 'vendedor_sin_comision', 'logistica'] },
  { path: '/logs',          label: 'System Logs',   icono: ScrollText, onlyRoles: ['desarrollador'] },
  { path: '/tester',        label: 'Tester',        icono: FlaskConical, onlyRoles: ['desarrollador'] },
  { path: '/auditoria',     label: 'Auditoría',     icono: Shield,       onlyRoles: ['desarrollador'] },
]

// ─── Badge de rol ──────────────────────────────────────────────────────────────
function BadgeRol({ rol }) {
  const estilos = {
    supervisor:      'bg-sky-500/20 text-sky-300 border border-sky-500/30',
    vendedor:        'bg-teal-500/20 text-teal-300 border border-teal-500/30',
    vendedor_sin_comision: 'bg-teal-500/20 text-teal-300 border border-teal-500/30',
    administracion:  'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    logistica:       'bg-purple-500/20 text-purple-300 border border-purple-500/30',
    desarrollador:   'bg-violet-500/20 text-violet-300 border border-violet-500/30',
    jefe:            'bg-amber-600/20 text-amber-400 border border-amber-600/30',
  }
  const textos = { supervisor: 'Supervisor', vendedor: 'Vendedor', vendedor_sin_comision: 'Vendedor', administracion: 'Administración', logistica: 'Logística', desarrollador: 'Dev', jefe: 'Jefe' }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${estilos[rol] ?? 'bg-white/10 text-white/50'}`}>
      {textos[rol] ?? rol}
    </span>
  )
}

// ─── Item de navegación ────────────────────────────────────────────────────────
const NavItem = memo(function NavItem({ path, label, Icono, onClick, collapsed }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={({ isActive }) => `
        flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${collapsed ? 'px-2' : 'px-3'} py-1.5 rounded-xl
        text-sm font-bold transition-colors duration-150
        ${isActive
          ? 'text-white shadow-lg'
          : 'text-white/75 hover:text-white hover:bg-white/10'
        }
      `}
      style={({ isActive }) => ({
        touchAction: 'manipulation',
        ...(isActive
          ? { background: 'linear-gradient(135deg, rgba(27,54,93,0.9), rgba(184,134,11,0.7))', boxShadow: '0 4px 15px rgba(184,134,11,0.2)', border: '1px solid rgba(184,134,11,0.25)' }
          : {})
      })}
    >
      <Icono size={18} />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  )
})

// ─── Layout principal ──────────────────────────────────────────────────────────
export default function AppLayout() {
  const queryClient = useQueryClient()
  // Selectores granulares: NO suscribirse a 'user' (TOKEN_REFRESHED lo actualiza frecuentemente)
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const switchOut = useAuthStore(s => s.switchOut)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth >= 768 && window.innerWidth < 1400)

  // Realtime: escucha cambios en tablas y refresca cache automáticamente
  useRealtimeSync()

  // Configurar userId para notificaciones per-user
  useEffect(() => {
    if (perfil?.id) setNotificationUserId(perfil.id)
  }, [perfil?.id])

  // Realtime notifications cross-device
  useEffect(() => {
    if (perfil?.rol) {
      startRealtimeNotifications(perfil.rol)
      return () => stopRealtimeNotifications()
    }
  }, [perfil?.rol])

  // Recordatorios de vencimiento deshabilitados (cotizaciones y despachos no vencen)
  // useRecordatoriosCotizaciones()

  // Notificaciones
  const { unreadCount, notifications, markAllRead, clearAll } = useAdminAlerts()
  const [showNotifs, setShowNotifs] = useState(false)
  const notifsRef = useRef(null)

  // Push notifications
  const { supported: pushSupported, subscribed: pushSubscribed, loading: pushLoading, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications()
  const [showPushTrouble, setShowPushTrouble] = useState(false)
  const [pushTroubleRawMsg, setPushTroubleRawMsg] = useState('')

  async function togglePush() {
    if (pushSubscribed) {
      await pushUnsubscribe()
      showToast('Notificaciones push desactivadas', 'info')
    } else {
      const result = await pushSubscribe()
      if (result.ok) {
        showToast('Notificaciones push activadas', 'success')
      } else if (result.error === 'push-service-error') {
        setPushTroubleRawMsg(result.rawError || 'Registration failed - push service error')
        setShowPushTrouble(true)
        showToast('Error en servicio push. Pulse para solucionar.', 'warning', 5000)
      } else {
        showToast(result.error || 'No se pudo activar', 'error')
      }
    }
  }

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (notifsRef.current && !notifsRef.current.contains(e.target)) {
        setShowNotifs(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Escuchar navegación desde notificaciones nativas de Windows/PC
  useEffect(() => {
    const handleNavigate = (e) => {
      const target = e.detail
      if (target) navigate(target)
    }
    window.addEventListener('navigate-to', handleNavigate)
    return () => window.removeEventListener('navigate-to', handleNavigate)
  }, [navigate])

  const [urgentNotif, setUrgentNotif] = useState(null)

  // Escuchar notificaciones urgentes para modal overlay e invalidar caché
  useEffect(() => {
    const handleNotif = (e) => {
      const notif = e.detail
      if (!notif) return

      // Invalida inmediatamente la caché de despachos al recibir una notificación de despacho
      if (['despacho_creado', 'despacho_en_ruta'].includes(notif.type)) {
        queryClient.invalidateQueries({ queryKey: ['despachos'], refetchType: 'active' })
      }

      if (['despacho_creado', 'stock_critico'].includes(notif.type)) {
        const esPermitido = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe' || perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador')
        if (esPermitido) {
          setUrgentNotif(notif)
        }
      } else if (notif.type === 'despacho_en_ruta') {
        const esPermitido = (perfil?.rol === 'logistica' || perfil?.rol === 'vendedor' || perfil?.rol === 'supervisor' || perfil?.rol === 'jefe' || perfil?.rol === 'desarrollador')
        if (esPermitido) {
          setUrgentNotif(notif)
        }
      }
    }
    window.addEventListener('construacero-notification', handleNotif)
    return () => window.removeEventListener('construacero-notification', handleNotif)
  }, [perfil?.rol, queryClient])

  const esDesarrollador = perfil?.rol === 'desarrollador'
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe') || esDesarrollador
  const esAdministracion = perfil?.rol === 'administracion'
  const esPrivilegiado = esSupervisor || esAdministracion

  // Página actual para título en topbar
  const location = useLocation()

  // Scroll to top on route change
  const mainRef = useRef(null)
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [location.pathname])
  const allNavItems = [...NAV_TODOS, ...NAV_SUPERVISOR]
  const currentPage = allNavItems.find(item =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
  )

  async function handleSwitchOut() {
    await switchOut()
    navigate('/login', { replace: true })
  }

  const bannerVisible = useOffline()

  function cerrarMenu() { setMenuOpen(false) }
  // En móvil el drawer siempre muestra labels completos
  const collapsed = sidebarCollapsed && !menuOpen

  return (
    <div className="flex pt-12 md:pt-14 overflow-hidden"
      style={{
        background: '#f1f5f9',
        height: bannerVisible ? 'calc(100vh - 46px)' : '100vh',
        transition: 'height 350ms cubic-bezier(0.4, 0, 0.2, 1)'
      }}>

      {/* ── Barra superior (móvil + desktop) ────────────────────────────── */}
      <div className="fixed left-0 right-0 z-40 px-3 md:px-4 h-12 md:h-14 flex items-center justify-between gap-2 md:gap-4"
        style={{
          top: bannerVisible ? '46px' : '0px',
          background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          transition: 'top 350ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}>

        {/* Hamburger — solo móvil */}
        <button
          onClick={() => setMenuOpen(true)}
          className="md:hidden p-2.5 rounded-xl transition-colors text-white/60 hover:text-white hover:bg-white/10"
          aria-label="Abrir menú"
        >
          <Menu size={20} />
        </button>

        {/* Logo — solo móvil */}
        <img src="/logo.png" alt="Construacero Carabobo" className="md:hidden h-7 w-auto object-contain" style={{ filter: 'brightness(1.1)' }} />

        {/* Título de página — solo desktop */}
        {currentPage && (
          <div className="hidden md:flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.8), rgba(184,134,11,0.5))', border: '1px solid rgba(184,134,11,0.2)' }}>
              <currentPage.icono size={16} className="text-white/80" />
            </div>
            <span className="text-sm font-black tracking-wide text-white/90">{currentPage.label}</span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Widget BCV — supervisor puede configurar, vendedor solo ve la tasa */}
        <BcvWidget soloLectura={!esPrivilegiado} />

        {/* Badge de cola offline — solo para roles que pueden hacer ventas */}
        {(perfil?.rol === 'vendedor' || perfil?.rol === 'vendedor_sin_comision' || perfil?.rol === 'supervisor' || perfil?.rol === 'desarrollador' || perfil?.rol === 'jefe') && (
          <PendingQueueBadge />
        )}

        {/* Campana con dropdown — siempre visible */}
        <div className="relative" ref={notifsRef}>
          <button
            onClick={() => { setShowNotifs(v => { if (!v && unreadCount > 0) setTimeout(markAllRead, 2000); return !v }) }}
            className="relative p-3 rounded-xl transition-all"
            style={{
              color:      unreadCount > 0 ? '#fbbf24' : 'rgba(255,255,255,0.55)',
              background: unreadCount > 0 ? 'rgba(251,191,36,0.1)' : 'transparent',
              border:     unreadCount > 0 ? '1px solid rgba(251,191,36,0.2)' : '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = unreadCount > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = unreadCount > 0 ? 'rgba(251,191,36,0.1)' : 'transparent' }}
            title="Alertas"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-rose-500 text-white text-xs font-black rounded-full flex items-center justify-center px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown de alertas */}
          {showNotifs && (
            <div className="absolute top-full right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
              style={{ background: '#0f1f3c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

              {/* Header del dropdown */}
              <div className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center gap-2">
                  <Bell size={13} className="text-white/40" />
                  <p className="text-xs font-black uppercase tracking-wider text-white/60">Alertas</p>
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-black bg-rose-500/20 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </div>
                {notifications.length > 0 && (
                  <button onClick={() => { clearAll(); setShowNotifs(false) }}
                    className="text-[10px] font-bold text-white/30 hover:text-rose-400 transition-colors px-2 py-1 rounded-lg hover:bg-rose-500/10">
                    Limpiar todo
                  </button>
                )}
              </div>

              {/* Lista de notificaciones */}
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="text-center py-10 px-4">
                    <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Bell size={20} className="text-white/20" />
                    </div>
                    <p className="text-sm font-bold text-white/30">Sin alertas recientes</p>
                    <p className="text-xs text-white/20 mt-1">Las notificaciones aparecerán aquí</p>
                  </div>
                ) : (
                  notifications.slice(0, 25).map((n, idx) => {
                    // Determinar navegación según tipo
                    const navTarget = {
                      [NOTIF_TYPES.STOCK_BAJO]: '/inventario?filtro=stock_bajo',
                      [NOTIF_TYPES.STOCK_CRITICO]: '/inventario?filtro=stock_bajo',
                      [NOTIF_TYPES.STOCK_REABASTECIDO]: '/inventario',
                      [NOTIF_TYPES.COTIZACION_ENVIADA]: '/cotizaciones',
                      [NOTIF_TYPES.COTIZACION_ACEPTADA]: '/cotizaciones',
                      [NOTIF_TYPES.COTIZACION_ACEPTADA_DESPACHO]: '/cotizaciones',
                      [NOTIF_TYPES.DESPACHO_CREADO]: '/despachos',
                      [NOTIF_TYPES.DESPACHO_EN_RUTA]: '/despachos',
                      [NOTIF_TYPES.DESPACHO_ENTREGADO]: '/despachos',
                      [NOTIF_TYPES.DESPACHO_CANCELADO]: '/despachos',
                      [NOTIF_TYPES.DESPACHO_PENDIENTE_MUCHO]: '/despachos',
                      [NOTIF_TYPES.COTIZACION_ANULADA]: '/cotizaciones',
                      [NOTIF_TYPES.COTIZACION_SIN_RESPUESTA]: '/cotizaciones',
                      [NOTIF_TYPES.COMPROMISO_ALTO]: '/inventario',
                      [NOTIF_TYPES.DESPACHO_CLIENTE_AJENO]: '/despachos',
                      [NOTIF_TYPES.FACTURACION_CLIENTE_AJENO]: '/despachos',
                    }[n.type]
                    const isClickable = !!navTarget
                    const iconData = NOTIF_ICON_MAP[n.type] || DEFAULT_NOTIF_ICON

                    return (
                      <div key={n.id}
                        onClick={isClickable ? () => { navigate(navTarget); setShowNotifs(false) } : undefined}
                        className={`px-4 py-3 transition-colors ${isClickable ? 'cursor-pointer hover:bg-white/[0.03]' : ''} ${!n.read ? 'bg-white/[0.02]' : ''}`}
                        style={{ borderBottom: idx < notifications.slice(0,25).length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                      >
                        <div className="flex gap-3 items-start">
                          <NotifIcon type={n.type} />
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-bold leading-tight ${!n.read ? 'text-white/90' : 'text-white/70'}`}>{n.title}</p>
                            {n.body && (
                              <p className="text-[11px] text-white/40 mt-0.5 leading-snug line-clamp-2">{n.body}</p>
                            )}
                            <p className="text-[10px] text-white/25 mt-1">
                              {formatNotifTime(n.ts)}
                            </p>
                          </div>
                          {!n.read && <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: iconData.color.replace('text-', '').includes('red') ? '#ef4444' : iconData.color.includes('amber') ? '#f59e0b' : '#3b82f6' }} />}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Push toggle al pie */}
              {pushSupported && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    onClick={togglePush}
                    disabled={pushLoading}
                    className="w-full flex items-center justify-between px-4 py-3 transition-all group"
                    style={{
                      background: pushSubscribed ? 'rgba(59,130,246,0.08)' : 'transparent',
                      color: pushSubscribed ? '#60a5fa' : 'rgba(255,255,255,0.4)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = pushSubscribed ? 'rgba(59,130,246,0.14)' : 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = pushSubscribed ? 'rgba(59,130,246,0.08)' : 'transparent'}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: pushSubscribed ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.06)' }}>
                        {pushSubscribed ? <Bell size={13} className="text-sky-400" /> : <BellOff size={13} className="text-white/30" />}
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-bold leading-tight">
                          {pushLoading ? 'Procesando…' : pushSubscribed ? 'Push activado' : 'Activar notificaciones push'}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {pushSubscribed ? 'Toca para desactivar' : 'Recibe alertas en tu dispositivo'}
                        </p>
                      </div>
                    </div>
                    {pushSubscribed && <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Backdrop overlay (móvil) ─────────────────────────────────────── */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm transition-opacity"
          onClick={cerrarMenu}
        />
      )}

      {/* ── Sidebar / Drawer ─────────────────────────────────────────────── */}
      <div className={`relative shrink-0 transition-all duration-300 ease-out ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'}`}>
      <aside
        className={`
          app-sidebar
          ${bannerVisible ? 'banner-visible' : ''}
          fixed left-0 z-[200] flex flex-col shrink-0
          transition-all duration-300 ease-out
          ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
          ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'}
          w-[85%] max-w-xs rounded-br-2xl rounded-tr-2xl
          md:w-64 md:inset-y-0 md:rounded-none md:translate-x-0 md:static md:z-auto md:sticky
          overflow-hidden
        `}
        style={{
          background: 'linear-gradient(180deg, #0a1628 0%, #0d1f3c 60%, #0a1a0f 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
        }}
      >
        <div className="flex flex-col md:h-full min-h-0">
        {/* Malla de puntos decorativa */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.03]">
          <svg width="100%" height="100%"><defs><pattern id="sdot" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="white"/></pattern></defs><rect width="100%" height="100%" fill="url(#sdot)"/></svg>
        </div>
        {/* Orbe decorativo */}
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none -mb-16 -ml-16 opacity-20"
          style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(30px)' }} />

        {/* Header móvil: perfil + cerrar */}
        <div className="md:hidden relative z-10 px-4 py-3 flex items-center gap-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <LoginAvatar user={perfil} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate leading-tight">
              {perfil?.nombre ?? 'Usuario'}
            </p>
            <BadgeRol rol={perfil?.rol} />
          </div>
          <button onClick={cerrarMenu} className="p-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Logo + botón colapsar — solo desktop */}
        <div className="relative z-10 px-4 py-2 hidden md:flex flex-col items-center shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

          <img src="/logo.png" alt="Construacero Carabobo"
            className={`object-contain transition-all duration-300 select-none pointer-events-none ${
              collapsed ? 'h-[40px] w-[40px]' : 'h-[66px] md:h-[80px]'
            }`}
            style={{ filter: 'brightness(1.05) drop-shadow(0 0 12px rgba(184,134,11,0.2))' }}
            draggable={false}
          />
          {!collapsed && (
            <div className="mt-1.5 md:mt-2 flex items-center gap-2 w-full justify-center">
              <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
              <span className="text-[9px] font-bold tracking-[0.25em] uppercase whitespace-nowrap" style={{ color: 'rgba(184,134,11,0.7)' }}>
                Sistema de Gestión
              </span>
              <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
            </div>
          )}
        </div>

        {/* Navegación */}
        <nav className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
          {NAV_TODOS
            .filter(item => {
              if (perfil?.rol === 'desarrollador') return true;
              if (item.onlyRoles?.length === 1 && item.onlyRoles[0] === 'desarrollador') return false;
              if (perfil?.rol === 'jefe') return true;
              return (!item.excludeRoles || !item.excludeRoles.includes(perfil?.rol)) && (!item.onlyRoles || item.onlyRoles.includes(perfil?.rol));
            })
            .map(({ path, label, labelByRole, icono: Icono }) => (
            <NavItem key={path} path={path} label={labelByRole?.[perfil?.rol] || label} Icono={Icono} onClick={cerrarMenu} collapsed={collapsed} />
          ))}
          {esPrivilegiado && (
            <>
              {!collapsed && (
                <div className="pt-2 pb-1 px-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(184,134,11,0.7)' }}>
                    Administración
                  </p>
                </div>
              )}
              {collapsed && <div className="pt-3 mt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />}
              {NAV_SUPERVISOR
                .filter(item => {
                  if (perfil?.rol === 'desarrollador') return true;
                  if (item.onlyRoles?.length === 1 && item.onlyRoles[0] === 'desarrollador') return false;
                  if (perfil?.rol === 'jefe') return true;
                  return (!item.excludeRoles || !item.excludeRoles.includes(perfil?.rol)) && (!item.onlyRoles || item.onlyRoles.includes(perfil?.rol));
                })
                .map(({ path, label, icono: Icono }) => (
                <NavItem key={path} path={path} label={label} Icono={Icono} onClick={cerrarMenu} collapsed={collapsed} />
              ))}
            </>
          )}
        </nav>

        {/* Cambiar usuario — solo móvil */}
        <div className="md:hidden relative z-10 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => { cerrarMenu(); handleSwitchOut() }}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors active:scale-[0.98]"
          >
            <ArrowRightLeft size={18} />
            <span className="text-sm font-semibold">Cambiar usuario</span>
          </button>
        </div>

        {/* Usuario — toca para cambiar operador (solo desktop) */}
        <div className="relative z-10 p-2 pb-2 shrink-0 hidden md:block" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={handleSwitchOut}
            className={`flex items-center ${collapsed ? 'justify-center p-1.5 mx-auto' : 'w-full gap-3 p-3'} rounded-2xl transition-all active:scale-[0.98] group`}
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
            title={collapsed ? 'Cambiar operador' : undefined}
          >
            <LoginAvatar user={perfil} size="sm" />
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-black text-white/90 truncate leading-tight">
                    {perfil?.nombre ?? 'Usuario'}
                  </p>
                  <BadgeRol rol={perfil?.rol} />
                </div>
                <ArrowRightLeft size={14} className="shrink-0 text-white/25 group-hover:text-white/50 transition-colors" />
              </>
            )}
          </button>
        </div>
        </div>
      </aside>

      {/* Botón colapsar — solo desktop, fuera del aside para no ser recortado por overflow-hidden */}
      <button
        onClick={() => setSidebarCollapsed(c => !c)}
        className="hidden md:flex absolute -right-3 top-28 w-6 h-6 rounded-full items-center justify-center transition-all hover:scale-110 z-50"
        style={{ background: '#0d1f3c', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.5)' }}
        title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
      </button>
      </div>

      {/* ── Área de contenido ───────────────────────────────────────────── */}
      <main ref={mainRef} className="flex-1 overflow-y-auto min-w-0 flex flex-col">
        <div className="w-full flex flex-col flex-1 min-h-0">
          <Outlet />
          <div className="h-20 shrink-0 md:hidden" />
        </div>
      </main>

      {/* ── Bottom Navigation — solo móvil ──────────────────────────────── */}
      <BottomNav esSupervisor={esSupervisor} esAdministracion={esAdministracion} rol={perfil?.rol} />

      {/* ── FAB Cotización Rápida — solo móvil, no para administracion ── */}
      {!esAdministracion && <QuickQuoteFAB />}

      {/* ── Glassmorphic Urgent Notification Overlay Modal ── */}
      {urgentNotif && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative overflow-hidden bg-slate-900/95 border border-slate-700/50 rounded-3xl p-6 max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-200">
            
            {/* Animated breathing pulse background glow */}
            {urgentNotif.type === 'despacho_en_ruta' ? (
              <>
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-teal-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
              </>
            ) : (
              <>
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-rose-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
              </>
            )}
            
            <div className="flex flex-col items-center text-center">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 animate-bounce ${
                urgentNotif.type === 'stock_critico'
                  ? 'bg-rose-500/10 border border-rose-500/20'
                  : urgentNotif.type === 'despacho_en_ruta'
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'bg-amber-500/10 border border-amber-500/20'
              }`}>
                {urgentNotif.type === 'stock_critico' ? (
                  <AlertCircle size={32} className="text-rose-400" />
                ) : urgentNotif.type === 'despacho_en_ruta' ? (
                  <Truck size={32} className="text-emerald-400" />
                ) : (
                  <Truck size={32} className="text-amber-400" />
                )}
              </div>
              
              <span className={`text-[10px] font-black tracking-[0.2em] uppercase px-3 py-1 rounded-full mb-3 select-none ${
                urgentNotif.type === 'stock_critico'
                  ? 'text-rose-400 bg-rose-500/10 border border-rose-500/20'
                  : urgentNotif.type === 'despacho_en_ruta'
                  ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                  : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
              }`}>
                {urgentNotif.type === 'stock_critico' 
                  ? '⚠️ SIN STOCK CRÍTICO ⚠️' 
                  : urgentNotif.type === 'despacho_en_ruta' 
                  ? '🚚 DESPACHO APROBADO 🚚' 
                  : '🚨 NUEVO DESPACHO URGENTE 🚨'}
              </span>
              
              <h3 className="text-lg font-black text-white mb-2 leading-tight">
                {urgentNotif.title}
              </h3>
              
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                {urgentNotif.body}
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <button
                  onClick={() => {
                    setUrgentNotif(null)
                    // Navegar al módulo adecuado
                    const navTarget = {
                      'stock_critico': '/inventario?filtro=stock_bajo',
                      'despacho_creado': '/despachos',
                      'despacho_en_ruta': '/despachos',
                    }[urgentNotif.type] || '/despachos'
                    navigate(navTarget)
                  }}
                  className="flex-1 px-5 py-3 rounded-xl text-sm font-black text-slate-900 transition-all select-none hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: urgentNotif.type === 'stock_critico'
                      ? 'linear-gradient(135deg, #f43f5e 0%, #be123c 100%)'
                      : urgentNotif.type === 'despacho_en_ruta'
                      ? 'linear-gradient(135deg, #10b981 0%, #047857 100%)'
                      : 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
                    color: urgentNotif.type === 'stock_critico' ? '#ffffff' : urgentNotif.type === 'despacho_en_ruta' ? '#ffffff' : '#0f172a',
                    boxShadow: urgentNotif.type === 'stock_critico'
                      ? '0 4px 15px rgba(244, 63, 94, 0.4)'
                      : urgentNotif.type === 'despacho_en_ruta'
                      ? '0 4px 15px rgba(16, 185, 129, 0.4)'
                      : '0 4px 15px rgba(217, 119, 6, 0.4)',
                  }}
                >
                  Verificar Ahora
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Resolución de Problemas Push ── */}
      <PushTroubleshootingModal
        isOpen={showPushTrouble}
        onClose={() => setShowPushTrouble(false)}
        rawError={pushTroubleRawMsg}
      />

      <style>{`
        .app-sidebar {
          top: 0;
          height: 100vh;
          transition: top 350ms cubic-bezier(0.4, 0, 0.2, 1), height 350ms cubic-bezier(0.4, 0, 0.2, 1), transform 300ms ease-out;
        }
        .app-sidebar.banner-visible {
          top: 46px;
          height: calc(100vh - 46px);
        }
        @media (min-width: 768px) {
          .app-sidebar {
            top: 3.5rem;
            height: calc(100vh - 3.5rem);
          }
          .app-sidebar.banner-visible {
            top: calc(3.5rem + 46px);
            height: calc(100vh - 3.5rem - 46px);
          }
        }
      `}</style>

    </div>
  )
}

// ─── Componente Modal de Resolución de Problemas Push ─────────────────────────
function PushTroubleshootingModal({ isOpen, onClose, rawError }) {
  const [activeTab, setActiveTab] = useState('vpn')

  if (!isOpen) return null

  const tabs = [
    {
      id: 'vpn',
      label: 'Bloqueo / VPN',
      icon: Globe,
      title: 'Bloqueo de Proveedores (Venezuela)',
      content: (
        <div className="space-y-3 text-left">
          <p className="text-sm text-slate-300 leading-relaxed">
            Los servidores de notificaciones push de Google (FCM) y otros servicios web sufren frecuentemente bloqueos o saturación temporal por parte de operadoras locales de internet en Venezuela (como <strong>CANTV, Movistar, Digitel</strong>).
          </p>
          <div className="bg-slate-950/40 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
            <h4 className="text-xs font-black text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle size={12} /> Solución Recomendada:
            </h4>
            <ol className="text-xs text-slate-400 space-y-1.5 list-decimal pl-4">
              <li>Active un <strong>VPN gratuito</strong> (como Windscribe, ProtonVPN, Warp Cloudflare o TunnelBear) en su teléfono móvil.</li>
              <li>Una vez activado el VPN, vuelva a intentar presionar el botón <strong>"Activar notificaciones push"</strong>.</li>
              <li>¡Listo! Una vez realizada la suscripción, ya puede apagar el VPN; las notificaciones seguirán llegando.</li>
              <li>Opcional: Pruebe alternando entre sus <strong>Datos Móviles</strong> y una red <strong>WiFi</strong>.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: 'brave',
      label: 'Brave Browser',
      icon: Shield,
      title: 'Configuración de Privacidad en Brave',
      content: (
        <div className="space-y-3 text-left">
          <p className="text-sm text-slate-300 leading-relaxed">
            El navegador Brave bloquea los servicios de push de Google por defecto para proteger su privacidad. Debe habilitar la mensajería push explícitamente.
          </p>
          <div className="bg-slate-950/40 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
            <h4 className="text-xs font-black text-sky-400 uppercase tracking-wide flex items-center gap-1.5">
              <Settings size={12} /> Pasos para activar:
            </h4>
            <ol className="text-xs text-slate-400 space-y-1.5 list-decimal pl-4">
              <li>Vaya a la <strong>Configuración / Ajustes</strong> de Brave en su móvil.</li>
              <li>Seleccione <strong>Privacidad y seguridad</strong>.</li>
              <li>Active la opción <strong>"Usar servicios de Google para mensajería push"</strong> (Use Google services for push messaging).</li>
              <li><strong>Cierre por completo</strong> el navegador Brave y vuelva a abrir la aplicación.</li>
              <li>Intente activar las notificaciones push nuevamente.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: 'ios',
      label: 'iPhone / iOS',
      icon: Compass,
      title: 'Notificaciones Push en iOS (Apple)',
      content: (
        <div className="space-y-3 text-left">
          <p className="text-sm text-slate-300 leading-relaxed">
            En dispositivos iPhone y iPad, Apple restringe las notificaciones push en el navegador Safari normal. <strong>Solo están permitidas si la app se instala en la pantalla de inicio</strong>.
          </p>
          <div className="bg-slate-950/40 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
            <h4 className="text-xs font-black text-rose-400 uppercase tracking-wide flex items-center gap-1.5">
              <Smartphone size={12} /> Guía de Instalación PWA:
            </h4>
            <ol className="text-xs text-slate-400 space-y-1.5 list-decimal pl-4">
              <li>Abra la aplicación en <strong>Safari</strong>.</li>
              <li>Presione el botón <strong>Compartir</strong> (el ícono de la flecha hacia arriba en la barra inferior).</li>
              <li>Deslice hacia abajo y presione <strong>"Agregar a inicio"</strong> (Add to Home Screen).</li>
              <li>Abra el nuevo ícono que se creó en la pantalla de inicio de su iPhone.</li>
              <li>Inicie sesión allí, abra las alertas y presione <strong>"Activar notificaciones push"</strong>.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: 'browser',
      label: 'Incógnito / Permisos',
      icon: HelpCircle,
      title: 'Pestañas Privadas y Permisos del Sitio',
      content: (
        <div className="space-y-3 text-left">
          <p className="text-sm text-slate-300 leading-relaxed">
            Asegúrese de no estar utilizando el modo incógnito o de haber bloqueado los permisos sin querer.
          </p>
          <div className="bg-slate-950/40 border border-slate-800/80 p-3.5 rounded-xl space-y-2">
            <h4 className="text-xs font-black text-amber-500 uppercase tracking-wide flex items-center gap-1.5">
              <Lock size={12} /> Solución de Permisos:
            </h4>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
              <li>Las pestañas en <strong>Modo Incógnito</strong> no tienen acceso al motor de notificaciones. Use una pestaña normal.</li>
              <li>Si al presionar el botón de activación no le pregunta permisos, verifique el candado <Lock size={10} className="inline mx-0.5" /> al lado de la dirección URL en la parte superior del navegador y asegúrese de que el permiso de <strong>Notificaciones</strong> esté en <strong>"Permitir"</strong>.</li>
            </ul>
          </div>
        </div>
      )
    }
  ]

  const ActiveTabItem = tabs.find(t => t.id === activeTab) || tabs[0]

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-300">
      <div className="relative overflow-hidden bg-slate-900/95 border border-slate-700/50 rounded-3xl p-5 max-w-lg w-full shadow-[0_20px_50px_rgba(0,0,0,0.6)] animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Glow Effects */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center">
              <BellOff size={20} className="text-rose-400 animate-pulse" />
            </div>
            <div className="text-left">
              <h3 className="text-base font-black text-white leading-tight">Soporte de Notificaciones</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Guía interactiva para resolver el error de registro</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex gap-1.5 overflow-x-auto py-2.5 border-b border-white/5 shrink-0 scrollbar-none">
          {tabs.map(tab => {
            const TabIcon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                  isActive 
                    ? 'text-white bg-white/10 border border-white/10 shadow-md' 
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent'
                }`}
                style={isActive ? { background: 'linear-gradient(135deg, rgba(27,54,93,0.5), rgba(184,134,11,0.3))' } : {}}
              >
                <TabIcon size={13} className={isActive ? 'text-amber-400' : ''} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          <div className="space-y-2">
            <h4 className="text-sm font-black text-white text-left flex items-center gap-2">
              <ActiveTabItem.icon size={16} className="text-amber-400" />
              {ActiveTabItem.title}
            </h4>
            {ActiveTabItem.content}
          </div>

          {rawError && (
            <div className="bg-slate-950/60 border border-red-500/10 p-2.5 rounded-xl text-left shrink-0">
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Código de error técnico:</p>
              <p className="text-[10px] font-mono text-rose-400/80 break-all mt-0.5 leading-snug">{rawError}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="pt-3 border-t border-white/10 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-xs font-black text-slate-900 transition-all select-none hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-1.5"
            style={{
              background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
              boxShadow: '0 4px 12px rgba(217, 119, 6, 0.3)',
            }}
          >
            Entendido, lo intentaré
          </button>
        </div>

      </div>
    </div>
  )
}
