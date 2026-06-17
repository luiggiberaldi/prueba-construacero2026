// src/components/layout/BottomNav.jsx
// Barra de navegación inferior para móvil (thumb-friendly)
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, FileText, Users, Package, MoreHorizontal, Zap, ShoppingBag, Briefcase } from 'lucide-react'
import { useState } from 'react'
import { PackageCheck, Truck, DollarSign, BarChart3, BarChart2, Settings, AlertCircle, FlaskConical, Shield, ShoppingCart } from 'lucide-react'

// Vendedor: Inicio, Cotizar, Despachos, Clientes + Más (4 fijos)
// Otros roles ajustan según permisos
const BOTTOM_ITEMS = [
  { path: '/', label: 'Inicio', icon: LayoutDashboard },
  { path: '/cotizaciones', label: 'Cotizar', icon: FileText, excludeRoles: ['logistica', 'administracion'] },
  { path: '/despachos', label: 'Despacho', icon: PackageCheck, labelByRole: { logistica: 'Entregas' } },
  { path: '/clientes', label: 'Clientes', icon: Users, excludeRoles: ['logistica'] },
]

const MORE_ITEMS = [
  { path: '/venta-rapida',        label: 'Venta rápida',       icon: Zap,       onlyRoles: ['vendedor', 'vendedor_sin_comision', 'supervisor'] },
  { path: '/personal',            label: 'Personal',           icon: Briefcase, onlyRoles: ['administracion', 'jefe', 'desarrollador'] },
  { path: '/orden-compra',        label: 'Orden de Compra',    icon: ShoppingCart, onlyRoles: ['supervisor', 'jefe', 'desarrollador'] },
  { path: '/inventario',          label: 'Inventario',         icon: Package,   excludeRoles: ['logistica'] },
  { path: '/transportistas',      label: 'Transportistas',     icon: Truck,     excludeRoles: ['logistica'] },
  { path: '/comisiones',          label: 'Comisiones',         icon: DollarSign, excludeRoles: ['logistica', 'administracion'] },
  { path: '/reporte-vendedores',  label: 'Rep. Vendedores',    icon: BarChart2, onlyRoles: ['supervisor', 'jefe', 'desarrollador'] },
  { path: '/reportes',            label: 'Reportes',           icon: BarChart3, onlyRoles: ['administracion', 'desarrollador'] },
  { path: '/configuracion',       label: 'Configuración',      icon: Settings,  onlyRoles: ['supervisor', 'administracion', 'desarrollador'] },
  { path: '/tester',              label: 'Tester',             icon: FlaskConical, onlyRoles: ['desarrollador'] },
  { path: '/auditoria',           label: 'Auditoría',          icon: Shield,    onlyRoles: ['desarrollador'] },
]

export default function BottomNav({ esSupervisor, esAdministracion = false, rol: rolProp }) {
  const esDesarrollador = rolProp === 'desarrollador'
  const rol = rolProp || (esAdministracion ? 'administracion' : esSupervisor ? 'supervisor' : 'vendedor')
  const esJefe = rol === 'jefe'
  const esPrivilegiado = esSupervisor || esAdministracion || esDesarrollador || esJefe
  const [showMore, setShowMore] = useState(false)

  const moreItemsFiltrados = MORE_ITEMS.filter(item => {
    if (esDesarrollador) return true
    if (item.onlyRoles?.length === 1 && item.onlyRoles[0] === 'desarrollador') return false
    if (esJefe) return true
    if (item.excludeRoles && item.excludeRoles.includes(rol)) return false
    if (item.onlyRoles && !item.onlyRoles.includes(rol)) return false
    if (item.supervisorOnly && !esSupervisor) return false
    if (item.requiresPrivileged && !esPrivilegiado) return false
    if (!esSupervisor && ['/auditoria', '/logs'].includes(item.path)) return false
    return true
  })

  return (
    <>
      {/* More menu overlay */}
      {showMore && (
        <div className="fixed inset-0 z-[98] bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setShowMore(false)} />
      )}

      {/* More menu sheet */}
      {showMore && (
        <div className="fixed bottom-[4.5rem] left-3 right-3 z-[99] md:hidden rounded-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200"
          style={{ background: '#0f1f3c', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div className="grid grid-cols-3 gap-1 p-3">
            {moreItemsFiltrados.map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                onClick={() => setShowMore(false)}
                style={{ touchAction: 'manipulation' }}
                className={({ isActive }) => `
                  flex flex-col items-center justify-start gap-1.5 py-3 px-2 rounded-xl transition-all h-[72px]
                  ${isActive ? 'bg-white/10 text-amber-400' : 'text-white/60 hover:text-white hover:bg-white/5'}
                `}
              >
                <Icon size={20} className="shrink-0" />
                <span className="text-xs font-bold text-center leading-tight">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* Bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-[97] md:hidden"
        style={{
          background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
        }}>
        <div className="flex items-center justify-around px-2 h-16">
          {BOTTOM_ITEMS
            .filter(item => {
              if (esDesarrollador) return true
              if (item.onlyRoles?.length === 1 && item.onlyRoles[0] === 'desarrollador') return false
              if (esJefe) return true
              if (item.excludeRoles && item.excludeRoles.includes(rol)) return false
              if (item.onlyRoles && !item.onlyRoles.includes(rol)) return false
              return true
            })
            .map(({ path, label, labelByRole, icon: Icon }) => {
            const displayLabel = labelByRole?.[rol] || label
            return (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={() => {
                document.querySelector('main')?.scrollTo(0, 0)
                window.scrollTo(0, 0)
              }}
              style={{ touchAction: 'manipulation' }}
              className={({ isActive }) => `
                flex flex-col items-center gap-0.5 py-1.5 px-1.5 rounded-xl transition-colors min-w-[48px]
                ${isActive ? 'text-amber-400' : 'text-white/50 active:text-white/80'}
              `}
            >
              {({ isActive }) => (
                <>
                  <div className={`p-1.5 rounded-lg transition-all ${isActive ? 'bg-amber-400/15' : ''}`}>
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                  <span className={`text-[10px] font-bold ${isActive ? 'text-amber-400' : ''}`}>{displayLabel}</span>
                </>
              )}
            </NavLink>
          )})}

          {/* Botón "Más" — solo si hay items */}
          {moreItemsFiltrados.length > 0 && (
          <button
            onClick={() => setShowMore(v => !v)}
            className={`flex flex-col items-center gap-0.5 py-1.5 px-1.5 rounded-xl transition-all min-w-[48px]
              ${showMore ? 'text-amber-400' : 'text-white/50 active:text-white/80'}
            `}
          >
            <div className={`p-1.5 rounded-lg transition-all ${showMore ? 'bg-amber-400/15' : ''}`}>
              <MoreHorizontal size={20} strokeWidth={showMore ? 2.5 : 2} />
            </div>
            <span className={`text-[10px] font-bold ${showMore ? 'text-amber-400' : ''}`}>Más</span>
          </button>
          )}
        </div>
      </nav>
    </>
  )
}
