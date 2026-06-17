// src/components/clientes/ReasignacionModal.jsx
// Modal exclusivo de supervisor para reasignar un cliente a otro vendedor
// Llama a la RPC reasignar_cliente() que valida y audita todo en BD
import { useState } from 'react'
import { ArrowRightLeft, Loader2, AlertCircle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import CustomSelect from '../ui/CustomSelect'
import { useReasignarCliente, useVendedores } from '../../hooks/useClientes'

export default function ReasignacionModal({ cliente, isOpen, onClose }) {
  const [nuevoVendedorId, setNuevoVendedorId] = useState('')
  const [error, setError] = useState('')

  const { data: vendedores = [], isLoading: cargandoVendedores } = useVendedores()
  const reasignar = useReasignarCliente()
  const cargando  = reasignar.isPending

  // Excluir al vendedor actual de las opciones
  const opcionesVendedor = vendedores.filter(v => v.id !== cliente?.vendedor_id)

  function handleClose() {
    if (cargando) return
    setNuevoVendedorId('')
    setError('')
    onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!nuevoVendedorId) { setError('Selecciona el vendedor destino'); return }

    try {
      await reasignar.mutateAsync({
        clienteId:      cliente.id,
        nuevoVendedorId,
      })
      handleClose()
    } catch (err) {
      setError(err.message ?? 'Error al reasignar. Intenta de nuevo.')
    }
  }

  if (!cliente) return null

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Reasignar cliente">

      {/* Info del cliente */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
        <p className="text-sm font-semibold" style={{ color: cliente.vendedor?.color || '#92400e' }}>{cliente.nombre}</p>
        {cliente.rif_cedula && (
          <p className="text-xs text-amber-600 mt-0.5">{cliente.rif_cedula}</p>
        )}
        <p className="text-xs text-amber-600 mt-1">
          Vendedor actual: <span className="font-semibold">{cliente.vendedor?.nombre ?? '—'}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Selector de nuevo vendedor */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <ArrowRightLeft size={14} className="text-slate-400" />
            Reasignar a *
          </label>
          {cargandoVendedores
            ? <div className="h-10 bg-slate-100 rounded-xl animate-pulse" />
            : (
              <CustomSelect
                options={opcionesVendedor.map(v => ({
                  value: v.id,
                  label: v.nombre,
                  sub: v.rol === 'supervisor' ? 'Supervisor' : 'Vendedor',
                }))}
                value={nuevoVendedorId}
                onChange={val => { setNuevoVendedorId(val); setError('') }}
                placeholder="Seleccionar vendedor..."
                icon={ArrowRightLeft}
                disabled={cargando}
              />
            )
          }
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
            disabled={cargando}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={cargando || !nuevoVendedorId}
            className="flex-[2] py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {cargando
              ? <><Loader2 size={15} className="animate-spin" /> Reasignando...</>
              : 'Confirmar reasignación'
            }
          </button>
        </div>

      </form>
    </Modal>
  )
}
