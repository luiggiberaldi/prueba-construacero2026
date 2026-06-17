import { Phone, Mail, MapPin, Hash, Tag, Pencil, UserMinus, ArrowRightLeft, FileText, AlertCircle, BookOpen, Trash2, UserCheck, Handshake, DollarSign, Briefcase } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'

function Contacto({ icono: Icono, valor }) {
  if (!valor) return null
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Icono size={11} className="shrink-0 text-slate-400" />
      <span className="truncate">{valor}</span>
    </div>
  )
}

const TIPO_LABELS = { natural: 'Natural', juridico: 'Jurídico', personal: 'Personal' }

// Genera iniciales del nombre (máx 2 caracteres)
function getIniciales(nombre = '') {
  const parts = nombre.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return nombre.slice(0, 2).toUpperCase()
}

export default function ClienteCard({ cliente, onEditar, onReasignar, onCotizar, onVerFicha, onBorrar, onActivar, esPersonalSection = false, onPromoverPersonal }) {
  const { perfil } = useAuthStore()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esAdministracion = perfil?.rol === 'administracion'
  const esPropio     = cliente.vendedor_id === perfil?.id
  const color        = cliente.vendedor?.color || '#64748b'

  return (
    <div className={`relative group bg-white rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${
      !cliente.activo ? 'border-slate-200/80 bg-slate-50/40 hover:shadow-none' : 'border-slate-200 hover:shadow-lg'
    }`}
      style={{ '--card-color': color }}>

      {/* Badge Desactivado (Absolute top-right corner to avoid horizontal flex overflow) */}
      {!cliente.activo && (
        <span className="absolute top-2.5 right-2.5 z-20 text-[9px] font-black px-2 py-0.5 rounded-lg bg-rose-600 text-white border border-rose-500 shadow-md uppercase tracking-wider animate-pulse select-none">
          DESACTIVADO
        </span>
      )}

      {/* ── Header strip con color del vendedor ── */}
      <div className="relative h-16 shrink-0 flex items-end px-4 pb-2 transition-all"
        style={{
          background: `linear-gradient(135deg, ${color}ee 0%, ${color}99 100%)`,
          opacity: cliente.activo ? 1 : 0.65,
        }}>
        {/* Patrón de puntos sutil */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }} />

        {/* Avatar con inicial */}
        <div className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
          style={{
            background: 'rgba(255,255,255,0.25)',
            border: '2px solid rgba(255,255,255,0.5)',
            color: 'white',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(4px)',
          }}>
          {getIniciales(cliente.nombre)}
        </div>

        {/* Chip tipo cliente en la esquina */}
        {cliente.tipo_cliente && (
          <span className="relative z-10 ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.4)' }}>
            {cliente.tipo_cliente === 'personal' && cliente.categoria
              ? cliente.categoria.toUpperCase()
              : (TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente)}
          </span>
        )}
      </div>

      {/* ── Nombre + RIF ── */}
      <div className={`px-4 pt-3 pb-1 transition-opacity ${!cliente.activo ? 'opacity-65' : ''}`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <h3 className="font-bold text-slate-800 text-sm leading-tight truncate">{cliente.nombre}</h3>
          {cliente.codigo_cliente && (
            <span className="text-[10px] font-mono font-black bg-slate-950 text-white px-2 py-0.5 rounded-lg shadow-sm shrink-0" title="Código de cliente">
              #{cliente.codigo_cliente}
            </span>
          )}
        </div>
        {cliente.rif_cedula && (
          <span className="flex items-center gap-1 text-xs text-slate-400 font-mono mt-0.5">
            <Hash size={10} />
            {cliente.rif_cedula}
          </span>
        )}
      </div>

      {/* ── Contacto ── */}
      {!esAdministracion && (
        <div className={`px-4 pb-3 space-y-1.5 mt-1 transition-opacity ${!cliente.activo ? 'opacity-60' : ''}`}>
          <Contacto icono={Phone} valor={cliente.telefono} />
          <Contacto icono={Mail}  valor={cliente.email} />
          <Contacto icono={MapPin} valor={[cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ')} />
        </div>
      )}

      {/* ── Vendedor chip ── */}
      {!esAdministracion && cliente.vendedor && (
        <div className={`mx-4 mb-3 flex flex-col gap-1 border-t border-slate-100 pt-2.5 transition-opacity ${!cliente.activo ? 'opacity-60' : ''}`}>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vendedor Asignado</span>
          <div className="inline-flex items-center gap-2 self-start px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all"
            style={{
              backgroundColor: color + '10',
              color: color,
              borderColor: color + '25',
            }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="leading-tight">
              {cliente.vendedor.nombre}
              {esPropio && <span className="text-[10px] font-normal opacity-70 ml-1.5">(tú)</span>}
            </span>
          </div>
        </div>
      )}

      {/* ── Saldo pendiente (crédito) ── */}
      {esAdministracion ? (
        <div className="flex flex-col gap-1.5 mx-4 mb-2">
          <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
            Number(cliente.saldo_pendiente || 0) > 0
              ? 'bg-red-50 border-red-200'
              : 'bg-emerald-50 border-emerald-200'
          }`}>
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${
              Number(cliente.saldo_pendiente || 0) > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}>
              <AlertCircle size={12} />
              {Number(cliente.saldo_pendiente || 0) > 0 ? 'Deuda' : 'Sin deuda'}
            </span>
            <span className={`text-sm font-black ${
              Number(cliente.saldo_pendiente || 0) > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}>{fmtUsd(cliente.saldo_pendiente || 0)}</span>
          </div>
          {Number(cliente.saldo_a_favor || 0) > 0 && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                <DollarSign size={12} className="text-emerald-500" />
                Saldo a Favor
              </span>
              <span className="text-sm font-black text-emerald-700">{fmtUsd(cliente.saldo_a_favor)}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          {Number(cliente.saldo_pendiente || 0) > 0 && (
            <div className="mx-4 mb-2 flex items-center justify-between bg-red-50 rounded-lg px-3 py-1.5 border border-red-100">
              <span className="flex items-center gap-1 text-xs text-red-600 font-semibold">
                <AlertCircle size={11} />
                Deuda
              </span>
              <span className="text-xs font-bold text-red-700">{fmtUsd(cliente.saldo_pendiente)}</span>
            </div>
          )}
          {Number(cliente.saldo_a_favor || 0) > 0 && (
            <div className="mx-4 mb-2 flex items-center justify-between bg-emerald-50 rounded-lg px-3 py-1.5 border border-emerald-100">
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                <DollarSign size={11} className="text-emerald-500" />
                Saldo a Favor
              </span>
              <span className="text-xs font-bold text-emerald-700">{fmtUsd(cliente.saldo_a_favor)}</span>
            </div>
          )}
        </>
      )}

      {/* ── Préstamos activos ── */}
      {cliente.tiene_prestamos_activos && (
        <div className="mx-4 mb-3 flex items-center justify-between bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-100 shadow-sm animate-pulse">
          <span className="flex items-center gap-1 text-xs text-amber-700 font-bold uppercase tracking-wider">
            <Handshake size={12} className="text-amber-600" />
            Préstamo Activo
          </span>
          <span className="text-[9px] bg-amber-600 text-white font-black px-2 py-0.5 rounded-full">PENDIENTE</span>
        </div>
      )}

      {/* ── Nota reasignación ── */}
      {!esAdministracion && cliente.ultima_reasig_en && (
        <div className="mx-4 mb-3 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100">
          Reasignado: {new Date(cliente.ultima_reasig_en).toLocaleDateString('es-VE')}
        </div>
      )}

      {/* ── Acciones ── */}
      <div className="mt-auto border-t border-slate-100 px-2 py-2 flex items-center flex-wrap gap-1">
        {!esAdministracion && onCotizar && (
          <button onClick={() => onCotizar(cliente)} title="Cotizar con este cliente"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
            <FileText size={13} />
            Cotizar
          </button>
        )}
        {onVerFicha && (
          <button onClick={() => onVerFicha(cliente)} title="Ver ficha del cliente"
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-violet-600 hover:bg-violet-50 active:bg-violet-100 transition-colors ${(esAdministracion && !esPersonalSection) ? 'flex-1 justify-center py-2' : ''}`}>
            <BookOpen size={13} />
            {(esAdministracion && !esPersonalSection) ? 'Ver cuenta' : 'Ficha'}
          </button>
        )}
        {onEditar && (esPersonalSection ? ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) : (!esAdministracion && (esPropio || esSupervisor))) && (
          <button onClick={() => onEditar(cliente)} title="Editar cliente"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 active:bg-sky-100 transition-colors">
            <Pencil size={13} />
            Editar
          </button>
        )}
        {onReasignar && (esSupervisor || esAdministracion) && (
          <button onClick={() => onReasignar(cliente)} title="Reasignar cliente"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <ArrowRightLeft size={14} />
          </button>
        )}
        {onPromoverPersonal && cliente.tipo_cliente !== 'personal' && cliente.activo && (
          <button onClick={() => onPromoverPersonal(cliente)} title="Pasar a Personal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 active:bg-amber-100 transition-colors">
            <Briefcase size={14} />
          </button>
        )}
        {!cliente.activo && onActivar && (esPersonalSection ? ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) : (!esAdministracion && (esPropio || esSupervisor))) && (
          <button onClick={() => onActivar(cliente)} title="Reactivar cliente"
            className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
            <UserCheck size={14} />
          </button>
        )}
        {onBorrar && cliente.activo && (esPersonalSection ? ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) : (!esAdministracion && (esPropio || esSupervisor))) && (
          <button onClick={() => onBorrar(cliente)} title="Eliminar cliente"
            className="ml-auto p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
