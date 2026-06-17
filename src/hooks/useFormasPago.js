import { useState, useCallback, useMemo, useEffect } from 'react'
import { FORMAS_PAGO } from '../constants/formasPago'

/**
 * Hook centralizado para gestionar el estado de formas de pago en ventas, despachos y cotizaciones.
 * @param {number} totalRequerido - El monto total que se debe cubrir con los pagos.
 */
export function useFormasPago(totalRequerido = 0) {
  // Estado local: formasPago es un array de objetos { metodo, monto }
  // Se mantiene como array para preservar el orden de selección y facilitar el renderizado.
  const [formasPago, setFormasPago] = useState([])

  // Auto-adjust payment amounts when totalRequerido changes
  useEffect(() => {
    if (!totalRequerido || totalRequerido <= 0) return

    setFormasPago(prev => {
      if (prev.length === 1) {
        const p = prev[0]
        if (Number(p.monto) !== totalRequerido) {
          return [{ ...p, monto: Number(totalRequerido.toFixed(2)) }]
        }
      } else if (prev.length > 1) {
        // Find if there is a Cta por cobrar or Cobro a destino to absorb the difference
        const cxcIndex = prev.findIndex(p => p.metodo === 'Cta por cobrar')
        if (cxcIndex !== -1) {
          const sumOthers = prev
            .filter((_, idx) => idx !== cxcIndex)
            .reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
          const newCxcMonto = Math.max(0, Number((totalRequerido - sumOthers).toFixed(2)))
          if (Number(prev[cxcIndex].monto) !== newCxcMonto) {
            return prev.map((p, idx) => idx === cxcIndex ? { ...p, monto: newCxcMonto || '' } : p)
          }
        } else {
          const codIndex = prev.findIndex(p => p.metodo === 'Cobro a destino')
          if (codIndex !== -1) {
            const sumOthers = prev
              .filter((_, idx) => idx !== codIndex)
              .reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
            const newCodMonto = Math.max(0, Number((totalRequerido - sumOthers).toFixed(2)))
            if (Number(prev[codIndex].monto) !== newCodMonto) {
              return prev.map((p, idx) => idx === codIndex ? { ...p, monto: newCodMonto || '' } : p)
            }
          }
        }
      }
      return prev
    })
  }, [totalRequerido])

  /**
   * Alterna la activación de una forma de pago.
   * Si se activa por primera vez, intenta asignar el monto restante automáticamente.
   */
  const toggleForma = useCallback((metodo) => {
    setFormasPago(prev => {
      const existe = prev.find(fp => fp.metodo === metodo)
      if (existe) return prev.filter(fp => fp.metodo !== metodo)

      // UX: Si hay exactamente 1 forma de pago que cubre el total, y el usuario 
      // selecciona una distinta, asumimos que quiere CAMBIAR la forma de pago.
      if (prev.length === 1 && Math.abs(Number(prev[0].monto) - totalRequerido) < 0.02) {
        return [{ metodo, monto: Number(totalRequerido.toFixed(2)) }]
      }

      // Calcular cuánto falta para cubrir el totalRequerido
      const actualAsignado = prev.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
      const restante = totalRequerido - actualAsignado
      
      // Si falta dinero, asignamos el resto a esta nueva forma de pago
      const montoInicial = restante > 0 ? Number(restante.toFixed(2)) : ''
      
      return [...prev, { metodo, monto: montoInicial }]
    })
  }, [totalRequerido])

  /**
   * Actualiza el monto de una forma de pago específica.
   */
  const setMontoForma = useCallback((metodo, monto) => {
    setFormasPago(prev => prev.map(fp => 
      fp.metodo === metodo ? { ...fp, monto } : fp
    ))
  }, [])

  /**
   * Actualiza propiedades extra de una forma de pago específica.
   */
  const updateForma = useCallback((metodo, updates) => {
    setFormasPago(prev => prev.map(fp => 
      fp.metodo === metodo ? { ...fp, ...updates } : fp
    ))
  }, [])

  /**
   * Reinicia todas las formas de pago.
   */
  const resetFormas = useCallback(() => {
    setFormasPago([])
  }, [])

  /**
   * Inicializa las formas de pago (útil para cargar datos existentes).
   */
  const setFormas = useCallback((nuevasFormas) => {
    if (Array.isArray(nuevasFormas)) {
      setFormasPago(nuevasFormas)
    }
  }, [])

  // Cálculos derivados (Computed)
  const totalAsignado = useMemo(() => {
    return formasPago.reduce((s, fp) => s + (Number(fp.monto) || 0), 0)
  }, [formasPago])

  // Lógica de "pago cuadrado" o excedente: totalAsignado debe ser mayor o igual al totalRequerido (dentro de la tolerancia de centavos)
  const pagoCuadrado = useMemo(() => {
    return formasPago.length > 0 && (totalAsignado - totalRequerido) >= -0.02
  }, [totalAsignado, totalRequerido, formasPago.length])

  const diferencia = useMemo(() => {
    return totalAsignado - totalRequerido
  }, [totalAsignado, totalRequerido])

  const hayVuelto = useMemo(() => {
    return formasPago.length > 0 && diferencia > 0.02
  }, [formasPago.length, diferencia])

  const faltante = useMemo(() => {
    return formasPago.length > 0 && diferencia < -0.02
  }, [formasPago.length, diferencia])

  const montoPendiente = useMemo(() => {
    const p = totalRequerido - totalAsignado
    return p > 0 ? p : 0
  }, [totalAsignado, totalRequerido])

  return {
    formasPago,
    setFormas,
    toggleForma,
    setMontoForma,
    updateForma,
    resetFormas,
    totalAsignado,
    pagoCuadrado,
    diferencia,
    hayVuelto,
    faltante,
    montoPendiente,
    FORMAS_PAGO,
  }
}
