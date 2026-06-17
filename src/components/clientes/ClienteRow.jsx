import { Phone, Mail, MapPin, Hash, Tag, Pencil, UserMinus, ArrowRightLeft, FileText, AlertCircle, BookOpen, Trash2, UserCheck, Handshake, DollarSign, Briefcase } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import { fmtUsdSimple as fmtUsd } from '../../utils/format'

const TIPO_LABELS = { natural: 'Natural', juridico: 'Jurídico', personal: 'Personal' }
const TIPO_COLORS = {
  natural:  'bg-slate-50 text-slate-600 border-slate-200',
  juridico: 'bg-violet-50 text-violet-700 border-violet-200',
  personal: 'bg-indigo-50 text-indigo-700 border-indigo-200',
}

export default function ClienteRow({ cliente, onEditar, onReasignar, onCotizar, onVerFicha, onBorrar, onActivar, esPersonalSection = false, onPromoverPersonal }) {
  const { perfil } = useAuthStore()
  const esSupervisor = (perfil?.rol === 'supervisor' || perfil?.rol === 'jefe')
  const esAdministracion = perfil?.rol === 'administracion'
  const esPropio = cliente.vendedor_id === perfil?.id
  const color = cliente.vendedor?.color || null
  const mostrarComoAdmin = esAdministracion && !esPersonalSection

  return (
    <div className={`bg-white rounded-xl border border-slate-200 hover:shadow-md transition-all overflow-hidden flex items-stretch ${!cliente.activo ? 'opacity-60 grayscale-[0.5]' : ''}`}
      style={color ? { borderColor: color + '40' } : undefined}>

      {/* Barra lateral de color del vendedor */}
      {color && (
        <div className="w-1 shrink-0 rounded-l-xl" style={{ background: color }} />
      )}

      {/* Info principal */}
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-slate-800 text-sm truncate">{cliente.nombre}</h3>
          {cliente.codigo_cliente && (
            <span className="text-[10px] font-mono font-black bg-slate-950 text-white px-2 py-0.5 rounded-lg shadow-sm shrink-0" title="Código de cliente">
              #{cliente.codigo_cliente}
            </span>
          )}
          {cliente.rif_cedula && (
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Hash size={10} />{cliente.rif_cedula}
            </span>
          )}
          {cliente.tipo_cliente && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TIPO_COLORS[cliente.tipo_cliente] || TIPO_COLORS.natural}`}>
              <Tag size={9} />
              {cliente.tipo_cliente === 'personal' && cliente.categoria
                ? cliente.categoria.toUpperCase()
                : (TIPO_LABELS[cliente.tipo_cliente] || cliente.tipo_cliente)}
            </span>
          )}
          {cliente.tiene_prestamos_activos && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wider animate-pulse">
              <Handshake size={9} /> Préstamo
            </span>
          )}
          {Number(cliente.saldo_pendiente || 0) > 0 && !esAdministracion && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
              <AlertCircle size={9} /> Deuda: {fmtUsd(cliente.saldo_pendiente)}
            </span>
          )}
          {Number(cliente.saldo_a_favor || 0) > 0 && !esAdministracion && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
              <DollarSign size={9} className="text-emerald-500" /> Crédito: {fmtUsd(cliente.saldo_a_favor)}
            </span>
          )}
          {!cliente.activo && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-white border border-slate-600">
              DESACTIVADO
            </span>
          )}
        </div>
        {esAdministracion ? (
          <div className="flex items-center gap-3 mt-1">
            {cliente.telefono && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Phone size={11} className="text-slate-400" />{cliente.telefono}
              </span>
            )}
            <span className={`flex items-center gap-1 text-xs font-bold ${
              Number(cliente.saldo_pendiente || 0) > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}>
              <AlertCircle size={11} />
              Deuda: {fmtUsd(cliente.saldo_pendiente || 0)}
            </span>
            {Number(cliente.saldo_a_favor || 0) > 0 && (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                <DollarSign size={11} className="text-emerald-500" />
                Crédito: {fmtUsd(cliente.saldo_a_favor || 0)}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            {cliente.telefono && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Phone size={11} className="text-slate-400" />{cliente.telefono}
              </span>
            )}
            {cliente.email && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Mail size={11} className="text-slate-400" />
                <span className="truncate max-w-[180px]">{cliente.email}</span>
              </span>
            )}
            {(cliente.direccion || cliente.ciudad || cliente.estado) && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin size={11} className="text-slate-400" />
                <span className="truncate max-w-[200px]">{[cliente.direccion, cliente.ciudad, cliente.estado].filter(Boolean).join(', ')}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chip vendedor */}
      {cliente.vendedor && (
        <div className="hidden sm:flex items-center px-3 shrink-0">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
            style={color
              ? { backgroundColor: color + '15', color, border: `1px solid ${color}30` }
              : { backgroundColor: '#f1f5f9', color: '#475569' }
            }>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color || '#94a3b8' }} />
            {cliente.vendedor.nombre}
            {esPropio && <span className="text-[9px] opacity-60">(tú)</span>}
          </span>
        </div>
      )}

      {/* Acciones */}
      <div className="flex items-center gap-1 px-2 shrink-0">
        {mostrarComoAdmin ? (
          <div className="flex items-center gap-1">
            {onVerFicha && (
              <button onClick={() => onVerFicha(cliente)} title="Ver cuenta"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-violet-600 hover:bg-violet-50 active:bg-violet-100 transition-colors">
                <BookOpen size={13} />
                Ver cuenta
              </button>
            )}
            {onReasignar && (
              <button onClick={() => onReasignar(cliente)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors" title="Reasignar cliente">
                <ArrowRightLeft size={15} />
              </button>
            )}
            {onPromoverPersonal && cliente.tipo_cliente !== 'personal' && cliente.activo && (
              <button onClick={() => onPromoverPersonal(cliente)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors" title="Pasar a Personal">
                <Briefcase size={15} />
              </button>
            )}
          </div>
        ) : (
          <>
            {!esAdministracion && onCotizar && (
              <button onClick={() => onCotizar(cliente)} title="Cotizar"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
                <FileText size={13} />
                Cotizar
              </button>
            )}
            {onVerFicha && esPersonalSection && (
              <button onClick={() => onVerFicha(cliente)} title="Ver ficha"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-violet-600 hover:bg-violet-50 active:bg-violet-100 transition-colors">
                <BookOpen size={13} />
                Ficha
              </button>
            )}
            {onEditar && (esPersonalSection ? ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) : (esPropio || esSupervisor)) && (
              <button onClick={() => onEditar(cliente)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors" title="Editar cliente">
                <Pencil size={15} />
              </button>
            )}
            {onReasignar && (esSupervisor || esAdministracion) && (
              <button onClick={() => onReasignar(cliente)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-colors" title="Reasignar cliente">
                <ArrowRightLeft size={15} />
              </button>
            )}
            {onPromoverPersonal && cliente.tipo_cliente !== 'personal' && cliente.activo && (
              <button onClick={() => onPromoverPersonal(cliente)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors" title="Pasar a Personal">
                <Briefcase size={15} />
              </button>
            )}
            {!cliente.activo && onActivar && (esPersonalSection ? ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) : (esPropio || esSupervisor)) && (
              <button onClick={() => onActivar(cliente)} title="Reactivar cliente"
                className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
                <UserCheck size={16} />
              </button>
            )}
            {onBorrar && cliente.activo && (esPersonalSection ? ['administracion', 'jefe', 'desarrollador'].includes(perfil?.rol) : (esPropio || esSupervisor)) && (
              <button onClick={() => onBorrar(cliente)} title="Eliminar cliente"
                className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors">
                <Trash2 size={15} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
