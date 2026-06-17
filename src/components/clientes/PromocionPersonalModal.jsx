// src/components/clientes/PromocionPersonalModal.jsx
// Modal para pasar un cliente a la zona de personal (tipo_cliente = 'personal')
import { useState } from 'react'
import { Briefcase, Loader2, AlertCircle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import CustomSelect from '../ui/CustomSelect'
import { useActualizarCliente, useReasignarCliente, useVendedores } from '../../hooks/useClientes'
import { showToast } from '../ui/Toast'

export default function PromocionPersonalModal({ cliente, isOpen, onClose }) {
  const [categoria, setCategoria] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: vendedores = [] } = useVendedores()
  const actualizarCliente = useActualizarCliente()
  const reasignarCliente = useReasignarCliente()

  const ROLES_SUGERIDOS = ['ADMINISTRADOR', 'DESPACHADOR', 'FACTURADOR', 'LOGÍSTICA', 'OPERARIO', 'VENDEDOR']
  const [rolesCustom, setRolesCustom] = useState(() => {
    try {
      const saved = localStorage.getItem('roles_personal_custom')
      return saved ? JSON.parse(saved).map(r => String(r).toUpperCase()) : []
    } catch {
      return []
    }
  })
  const listaRoles = Array.from(new Set([
    ...ROLES_SUGERIDOS,
    ...rolesCustom
  ])).sort()

  function handleClose() {
    if (loading) return
    setCategoria('')
    setError('')
    onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!categoria.trim()) {
      setError('Debes ingresar o seleccionar un cargo/rol')
      return
    }

    setLoading(true)
    const upperCargo = categoria.trim().toUpperCase()

    try {
      // 1. Encontrar usuario 'EMPRESA'
      const empresaUser = vendedores.find(v => v.nombre?.toUpperCase() === 'EMPRESA')
      const empresaVendedorId = empresaUser?.id

      // 2. Reasignar a 'EMPRESA' si es necesario
      if (empresaVendedorId && cliente.vendedor_id !== empresaVendedorId) {
        await reasignarCliente.mutateAsync({
          clienteId: cliente.id,
          nuevoVendedorId: empresaVendedorId,
          motivo: 'Promoción a personal de la empresa'
        })
      }

      // 3. Cambiar tipo de cliente a 'personal' y asignar categoría (cargo)
      await actualizarCliente.mutateAsync({
        id: cliente.id,
        campos: {
          nombre: cliente.nombre,
          rif_cedula: cliente.rif_cedula,
          telefono: cliente.telefono,
          email: cliente.email,
          estado: cliente.estado,
          ciudad: cliente.ciudad,
          direccion: cliente.direccion,
          notas: cliente.notas,
          tipo_cliente: 'personal',
          categoria: upperCargo,
        }
      })

      // Guardar rol si es nuevo
      if (!listaRoles.includes(upperCargo)) {
        setRolesCustom(prev => {
          const next = Array.from(new Set([...prev, upperCargo]))
          try {
            localStorage.setItem('roles_personal_custom', JSON.stringify(next))
          } catch (e) {
            console.error(e)
          }
          return next
        })
      }

      showToast(`¡${cliente.nombre} ha sido promovido a Personal!`, 'success')
      handleClose()
    } catch (err) {
      setError(err.message ?? 'Error al promover a personal. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  if (!cliente) return null

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Pasar a Personal">
      {/* Info del cliente */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
        <p className="text-sm font-semibold text-amber-950">{cliente.nombre}</p>
        {cliente.rif_cedula && (
          <p className="text-xs text-amber-700 mt-0.5">{cliente.rif_cedula}</p>
        )}
        <p className="text-xs text-amber-600 mt-1.5 leading-relaxed">
          Esta acción moverá al cliente al módulo de **Personal** (Trabajadores de la empresa) y le aplicará los beneficios y configuraciones correspondientes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Cargo / Rol */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Briefcase size={14} className="text-slate-400" />
            Papel / Rol en la empresa *
          </label>
          <CustomSelect
            options={listaRoles.map(role => ({ value: role, label: role }))}
            value={categoria}
            onChange={val => {
              setCategoria(val ? String(val).toUpperCase() : '')
              setError('')
            }}
            placeholder="Seleccionar o escribir cargo..."
            icon={Briefcase}
            disabled={loading}
            creatable={true}
            createLabel="Crear cargo"
            searchable={true}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !categoria.trim()}
            className="flex-[2] py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading
              ? <><Loader2 size={15} className="animate-spin" /> Procesando...</>
              : 'Promover a Personal'
            }
          </button>
        </div>
      </form>
    </Modal>
  )
}
