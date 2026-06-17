// src/components/inventario/ProductoForm.jsx
// Formulario para crear/editar productos — solo supervisor
import { useState, useEffect, useRef } from 'react'
import { Hash, Package, Tag, Layers, DollarSign, BarChart2, Loader2, Camera, X, Clipboard } from 'lucide-react'
import { useCrearProducto, useActualizarProducto, useCategorias } from '../../hooks/useInventario'
import { comprimirImagen, subirImagenProducto } from '../../utils/imageCompress'
import supabase from '../../services/supabase/client'
import CustomSelect from '../ui/CustomSelect'
import useAuthStore from '../../store/useAuthStore'
import { LINEAS, MATERIALES, FORMAS, RESTRICCIONES, obtenerCategoriaDesdeEstructura, calcularSiguienteCodigo, sugerirEstructuraDesdeNombre } from '../../utils/codigosHelper'

function Campo({ label, icono: Icono, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {Icono && <Icono size={14} className="text-slate-400" />}
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

const inputClass = `
  w-full px-3 py-2.5 rounded-xl border text-sm text-slate-800
  bg-slate-50 border-slate-200
  focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary
  placeholder:text-slate-400 transition-colors
`

const VACIO = {
  codigo: '', nombre: '', descripcion: '', categoria: '',
  unidad: 'und', precio_usd: '', precio_2: '', precio_3: '', costo_usd: '',
  stock_actual: '0', stock_minimo: '0',
  precio1_porcentaje: '', precio2_porcentaje: '', precio3_porcentaje: ''
}

function PrecioBlock({ label, precioName, pctName, campos, cambiar, esAdmin, errores, cargando }) {
  const precio = Number(campos[precioName]) || 0;
  const costo = Number(campos.costo_usd) || 0;
  
  const ganancia = precio - costo;
  const margenReal = precio > 0 ? (ganancia / precio) * 100 : 0;

  let stateColor = 'text-slate-600';
  let inputBorder = 'border-slate-200 focus:border-primary focus:ring-primary-focus';
  let msg = '';
  
  if (costo > 0 && campos[precioName] !== '') {
    if (margenReal > 15) {
      stateColor = 'text-emerald-600';
    } else if (margenReal > 0 && margenReal <= 15) {
      stateColor = 'text-amber-500';
      if (margenReal <= 5) msg = 'Margen bajo';
      inputBorder = 'border-amber-300 focus:border-amber-500 focus:ring-amber-200 bg-amber-50';
    } else if (precio === costo) {
      stateColor = 'text-amber-500';
      msg = 'Precio = Costo';
      inputBorder = 'border-amber-300 focus:border-amber-500 focus:ring-amber-200 bg-amber-50';
    } else {
      stateColor = 'text-red-500';
      msg = 'El precio no cubre el costo';
      inputBorder = 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50';
    }
  }

  const baseInputClass = "w-full px-3 py-2.5 rounded-xl border text-sm text-slate-800 focus:outline-none focus:ring-2 placeholder:text-slate-400 transition-colors bg-slate-50";

  return (
    <div className="space-y-2 border border-slate-200 rounded-xl p-3 bg-white">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1">
        <DollarSign size={14} className="text-slate-400" />
        {label}
      </label>
      <div className="flex gap-2">
        <div className="flex-1">
          <input type="text" inputMode="decimal" name={precioName} value={campos[precioName]}
            onChange={cambiar} placeholder="0.00" disabled={cargando}
            className={`${baseInputClass} ${errores[precioName] ? 'border-red-500 ring-red-200 bg-red-50' : inputBorder}`} />
        </div>
        {esAdmin && (
          <div className="w-24 relative shrink-0">
            <input type="text" inputMode="decimal" name={pctName} value={campos[pctName]}
              onChange={cambiar} placeholder="0" disabled={cargando}
              className={`${baseInputClass} ${inputBorder} pr-6`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">%</span>
          </div>
        )}
      </div>
      {esAdmin && costo > 0 && campos[precioName] !== '' && (
        <div className="text-[11px] leading-tight flex flex-col gap-0.5 mt-1">
          <span className="text-slate-500">
            Ganancia: <strong className={stateColor}>${ganancia.toFixed(2)}</strong> · Margen real: <strong>{margenReal.toFixed(1)}%</strong>
          </span>
          {msg && <span className={`font-medium ${stateColor}`}>{msg}</span>}
        </div>
      )}
      {errores[precioName] && <p className="text-xs text-red-500">{errores[precioName]}</p>}
    </div>
  )
}

export default function ProductoForm({ producto = null, isClone = false, onSuccess, onCancel }) {
  const { perfil } = useAuthStore()
  const esAdmin = perfil?.rol === 'administracion' || perfil?.rol === 'desarrollador' || perfil?.rol === 'jefe'
  const esEdicion = !!producto && !isClone
  const [campos, setCampos] = useState(VACIO)
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState('')

  // Imagen
  const fileRef = useRef(null)
  const [imagenPreview, setImagenPreview] = useState(null) // URL para preview
  const [imagenBlob, setImagenBlob] = useState(null)       // Blob comprimido para subir
  const [imagenEliminada, setImagenEliminada] = useState(false)
  const [comprimiendo, setComprimiendo] = useState(false)

  const crear     = useCrearProducto()
  const actualizar = useActualizarProducto()
  const { data: categoriasExistentes = [] } = useCategorias()
  const mutation  = esEdicion ? actualizar : crear
  const cargando  = mutation.isPending

  // Estados del generador de códigos
  const [genLinea, setGenLinea] = useState('')
  const [genMaterial, setGenMaterial] = useState('')
  const [genForma, setGenForma] = useState('')
  const [generando, setGenerando] = useState(false)

  // Control de modificaciones manuales de los selectores para evitar que la auto-sugerencia los sobrescriba
  const [manuales, setManuales] = useState({ linea: false, material: false, forma: false })

  // Ref para acceder al código actual sin causar re-ejecuciones de efectos circulares
  const codigoRef = useRef(campos.codigo)
  // Ref para bloquear el efecto cascada de genLinea durante la inicialización del producto
  const inicializandoRef = useRef(false)
  useEffect(() => {
    codigoRef.current = campos.codigo
  }, [campos.codigo])

  // Filtrar materiales y formas según la línea seleccionada (cascada)
  const restrict = genLinea ? RESTRICCIONES[genLinea] : null
  const materialesFiltrados = restrict
    ? MATERIALES.filter(m => restrict.materiales.includes(m.value))
    : []
  const formasFiltradas = restrict
    ? FORMAS.filter(f => restrict.formas.includes(f.value))
    : []

  // Inicializar/actualizar formulario cuando cambia el producto (modo edición/clonación)
  useEffect(() => {
    if (producto) {
      setCampos({
        codigo:       isClone ? '' : (producto.codigo ?? ''),
        nombre:       producto.nombre       ?? '',
        descripcion:  producto.descripcion  ?? '',
        categoria:    producto.categoria    ?? '',
        unidad:       producto.unidad       ?? 'und',
        precio_usd:   producto.precio_usd != null ? String(producto.precio_usd) : '',
        precio_2:     producto.precio_2  != null ? String(producto.precio_2)  : '',
        precio_3:     producto.precio_3  != null ? String(producto.precio_3)  : '',
        precio1_porcentaje: producto.precio1_porcentaje != null ? String(producto.precio1_porcentaje) : '',
        precio2_porcentaje: producto.precio2_porcentaje != null ? String(producto.precio2_porcentaje) : '',
        precio3_porcentaje: producto.precio3_porcentaje != null ? String(producto.precio3_porcentaje) : '',
        costo_usd:    producto.costo_usd  != null ? String(producto.costo_usd)  : '',
        stock_actual: isClone ? '0' : (producto.stock_actual != null ? String(producto.stock_actual) : '0'),
        stock_minimo: isClone ? '0' : (producto.stock_minimo != null ? String(producto.stock_minimo) : '0'),
      })
      if (producto.imagen_url && !isClone) setImagenPreview(producto.imagen_url)

      // Cargar valores iniciales en los selectores del generador de códigos
      if (producto.codigo) {
        const match = producto.codigo.trim().toUpperCase().match(/^([A-Z]{2,3})(\d{2})(\d{2})(\d{3})$/)
        if (match) {
          // Bloquear el efecto cascada de genLinea para que no limpie material/forma
          inicializandoRef.current = true
          setGenLinea(match[1])
          setGenMaterial(match[2])
          setGenForma(match[3])
          setManuales({ linea: true, material: true, forma: true })
          // Liberar el bloqueo en el próximo ciclo (después de que los efectos se ejecuten)
          Promise.resolve().then(() => { inicializandoRef.current = false })
        }
      }
    }
  }, [producto, isClone])



  // Limpiar selectores al cambiar la línea por acción del usuario (no durante inicialización)
  useEffect(() => {
    if (inicializandoRef.current) return   // está inicializando, no tocar material/forma
    if (!genLinea) {
      setGenMaterial('')
      setGenForma('')
      return
    }
    const r = RESTRICCIONES[genLinea]
    if (r) {
      // Validar/actualizar Material
      if (!r.materiales.includes(genMaterial)) {
        setGenMaterial(r.materiales.length === 1 ? r.materiales[0] : '')
      }
      // Validar/actualizar Forma
      if (!r.formas.includes(genForma)) {
        setGenForma(r.formas.length === 1 ? r.formas[0] : '')
      }
    }
  }, [genLinea])  // Auto-sincronizar categoría basada en la estructura del código y nombre
  useEffect(() => {
    if (!genLinea || !genMaterial || !genForma) return
    const catSugerida = obtenerCategoriaDesdeEstructura(genLinea, genMaterial, genForma, campos.nombre)
    if (catSugerida && campos.categoria !== catSugerida) {
      setCampos(p => ({ ...p, categoria: catSugerida }))
    }
  }, [genLinea, genMaterial, genForma, campos.nombre])

  // Auto-sugerir estructura del código (Línea, Material, Forma) basándose en el nombre
  useEffect(() => {
    if (esEdicion || !campos.nombre.trim()) return

    const sug = sugerirEstructuraDesdeNombre(campos.nombre)
    if (sug) {
      if (sug.linea && !manuales.linea && sug.linea !== genLinea) {
        setGenLinea(sug.linea)
      }
      if (sug.material && !manuales.material && sug.material !== genMaterial) {
        setGenMaterial(sug.material)
      }
      if (sug.forma && !manuales.forma && sug.forma !== genForma) {
        setGenForma(sug.forma)
      }
    }
  }, [campos.nombre, esEdicion, manuales, genLinea, genMaterial, genForma])


  // Sincronizar selectores si se edita manualmente el código en el input
  useEffect(() => {
    if (!campos.codigo) return
    const match = campos.codigo.trim().toUpperCase().match(/^([A-Z]{2,3})(\d{2})(\d{2})(\d{3})$/)
    if (match) {
      const [, line, mat, form] = match
      
      // Validar si la combinación es teóricamente permitida antes de forzarla en los selectores
      const r = RESTRICCIONES[line]
      if (r && r.materiales.includes(mat) && r.formas.includes(form)) {
        if (line !== genLinea) {
          setGenLinea(line)
          setManuales(m => ({ ...m, linea: true }))
        }
        if (mat !== genMaterial) {
          setGenMaterial(mat)
          setManuales(m => ({ ...m, material: true }))
        }
        if (form !== genForma) {
          setGenForma(form)
          setManuales(m => ({ ...m, forma: true }))
        }
      }
    }
  }, [campos.codigo])

  // Calcular código sugerido de forma reactiva al cambiar los selectores
  useEffect(() => {
    if (!genLinea || !genMaterial || !genForma) return
    
    // Si el código actual ya está completo (10 caracteres) y coincide con los selectores,
    // asumimos que el usuario lo ingresó manualmente o ya está establecido, así que no lo sobrescribimos.
    const actualUpper = codigoRef.current ? codigoRef.current.trim().toUpperCase() : ''
    const prefijoDeseado = `${genLinea}${genMaterial}${genForma}`
    if (actualUpper.startsWith(prefijoDeseado) && actualUpper.length === 10) {
      return
    }

    let active = true
    async function updateCode() {
      setGenerando(true)
      const code = await calcularSiguienteCodigo(supabase, genLinea, genMaterial, genForma)
      if (active && code) {
        if (esEdicion && producto?.codigo && producto.codigo.startsWith(prefijoDeseado)) {
          setCampos(p => ({ ...p, codigo: producto.codigo }))
        } else {
          setCampos(p => ({ ...p, codigo: code }))
        }
      }
      setGenerando(false)
    }
    
    const delayDebounce = setTimeout(() => {
      updateCode()
    }, 400)
    
    return () => {
      active = false
      clearTimeout(delayDebounce)
    }
  }, [genLinea, genMaterial, genForma, esEdicion, producto])

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      if (imagenPreview && imagenPreview.startsWith('blob:')) URL.revokeObjectURL(imagenPreview)
    }
  }, [imagenPreview])

  // Pegar imagen desde portapapeles (Ctrl+V)
  useEffect(() => {
    async function handlePaste(e) {
      if (cargando) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (!file) continue
          setComprimiendo(true)
          try {
            const { blob, dataUrl } = await comprimirImagen(file)
            if (imagenPreview?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview)
            setImagenBlob(blob)
            setImagenPreview(dataUrl)
            setImagenEliminada(false)
          } catch (err) {
            setErrorGeneral('Error al pegar imagen: ' + err.message)
          } finally {
            setComprimiendo(false)
          }
          break
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [cargando, imagenPreview])

  async function handleImagen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset file input
    e.target.value = ''

    setComprimiendo(true)
    try {
      const { blob, dataUrl } = await comprimirImagen(file)
      // Limpiar preview anterior si era blob
      if (imagenPreview?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview)
      setImagenBlob(blob)
      setImagenPreview(dataUrl)
      setImagenEliminada(false)
    } catch (err) {
      setErrorGeneral('Error al procesar la imagen: ' + err.message)
    } finally {
      setComprimiendo(false)
    }
  }

  function quitarImagen() {
    if (imagenPreview?.startsWith('blob:')) URL.revokeObjectURL(imagenPreview)
    setImagenPreview(null)
    setImagenBlob(null)
    setImagenEliminada(true)
  }

  const camposNumericos = new Set(['precio_usd', 'precio_2', 'precio_3', 'costo_usd', 'stock_actual', 'stock_minimo', 'precio1_porcentaje', 'precio2_porcentaje', 'precio3_porcentaje'])

  function cambiar(e) {
    const { name } = e.target
    let value = e.target.value
    if (camposNumericos.has(name)) value = value.replace(',', '.')

    setCampos(p => {
      const next = { ...p, [name]: value }

      // Auto-calcular porcentaje si cambia precio y hay costo
      if ((name === 'precio_usd' || name === 'precio_2' || name === 'precio_3') && esAdmin) {
        const idx = name === 'precio_usd' ? 1 : name === 'precio_2' ? 2 : 3;
        const costo = Number(next.costo_usd);
        const precio = Number(value);
        if (costo > 0 && !isNaN(precio) && value !== '') {
          next[`precio${idx}_porcentaje`] = (((precio - costo) / costo) * 100).toFixed(2);
        } else if (value === '') {
          next[`precio${idx}_porcentaje`] = '';
        }
      }

      // Auto-calcular precio si cambia porcentaje y hay costo
      if ((name === 'precio1_porcentaje' || name === 'precio2_porcentaje' || name === 'precio3_porcentaje') && esAdmin) {
        const idx = name.replace('precio', '').replace('_porcentaje', '');
        const costo = Number(next.costo_usd);
        const pct = Number(value);
        const targetName = idx === '1' ? 'precio_usd' : `precio_${idx}`;
        if (costo > 0 && !isNaN(pct) && value !== '') {
          next[targetName] = (costo * (1 + pct / 100)).toFixed(2);
        }
      }

      // Si cambia el costo, recalcular precios basados en los % guardados
      if (name === 'costo_usd' && esAdmin) {
        const costo = Number(value);
        if (costo > 0) {
          ['1', '2', '3'].forEach(idx => {
            const pctName = `precio${idx}_porcentaje`;
            const pct = Number(next[pctName]);
            const targetName = idx === '1' ? 'precio_usd' : `precio_${idx}`;
            if (!isNaN(pct) && next[pctName] !== '') {
              next[targetName] = (costo * (1 + pct / 100)).toFixed(2);
            }
          });
        }
      }

      return next
    })

    if (errores[name]) setErrores(p => ({ ...p, [name]: '' }))
    if (errorGeneral) setErrorGeneral('')
  }

  function recalcularPrecios() {
    const costo = Number(campos.costo_usd);
    if (costo <= 0 || isNaN(costo)) return;
    
    setCampos(p => {
      const next = { ...p };
      ['1', '2', '3'].forEach(idx => {
        const pctName = `precio${idx}_porcentaje`;
        const pct = Number(next[pctName]);
        const targetName = idx === '1' ? 'precio_usd' : `precio_${idx}`;
        if (!isNaN(pct) && next[pctName] !== '') {
          next[targetName] = (costo * (1 + pct / 100)).toFixed(2);
        }
      });
      return next;
    });
  }

  function validar() {
    const errs = {}
    if (!campos.nombre.trim()) errs.nombre = 'El nombre es obligatorio'
    if (campos.precio_usd !== '' && isNaN(Number(campos.precio_usd)))
      errs.precio_usd = 'Precio inválido'
    if (campos.precio_2 !== '' && isNaN(Number(campos.precio_2)))
      errs.precio_2 = 'Precio inválido'
    if (campos.precio_3 !== '' && isNaN(Number(campos.precio_3)))
      errs.precio_3 = 'Precio inválido'
    if (campos.costo_usd !== '' && isNaN(Number(campos.costo_usd)))
      errs.costo_usd = 'Costo inválido'
    if (isNaN(Number(campos.stock_actual)))
      errs.stock_actual = 'Stock inválido'
    
    // Validar estructura de código estructurado
    if (campos.codigo && campos.codigo.trim() !== '') {
      const validPattern = /^([A-Z]{2,3})(\d{2})(\d{2})(\d{3})$/
      if (!validPattern.test(campos.codigo.trim().toUpperCase())) {
        errs.codigo = 'Código inválido (Formato ej: VIG0106001 o VI0156001)'
      }
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validar()
    if (Object.keys(errs).length) { setErrores(errs); return }

    try {
      let productoResult
      if (esEdicion) {
        // 1. Determinar el URL final de la imagen
        let finalImageUrl = producto.imagen_url
        if (imagenEliminada) {
          finalImageUrl = null
        } else if (imagenBlob) {
          finalImageUrl = await subirImagenProducto(supabase, producto.id, imagenBlob)
        }

        // 2. Ejecutar la actualización en base de datos con el nuevo URL
        productoResult = await actualizar.mutateAsync({
          id: producto.id,
          campos,
          imagen_url: finalImageUrl
        })
      } else {
        // Para nuevos productos: primero creamos para obtener el ID
        productoResult = await crear.mutateAsync(campos)
        
        // Luego subimos la imagen si hay una
        if (imagenBlob && productoResult?.id) {
          const url = await subirImagenProducto(supabase, productoResult.id, imagenBlob)
          await supabase.from('productos').update({ imagen_url: url }).eq('id', productoResult.id)
        }
      }

      onSuccess?.()
    } catch (err) {
      setErrorGeneral(err.message ?? 'Ocurrió un error. Intenta de nuevo.')
    }
  }

  const tieneImagen = !!imagenPreview

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Imagen del producto */}
      <div className="flex items-center gap-4">
        <div
          onClick={() => !cargando && fileRef.current?.click()}
          className={`relative w-20 h-20 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-all overflow-hidden shrink-0 ${
            tieneImagen ? 'border-primary/30 bg-white' : 'border-slate-300 bg-slate-50 hover:border-primary hover:bg-primary-light'
          }`}
        >
          {comprimiendo ? (
            <Loader2 size={20} className="text-slate-400 animate-spin" />
          ) : tieneImagen ? (
            <img src={imagenPreview} alt="Producto" className="w-full h-full object-cover" />
          ) : (
            <Camera size={22} className="text-slate-400" />
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={handleImagen} disabled={cargando} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700">Foto del producto</p>
          <p className="text-xs text-slate-400">JPG, PNG o WebP. Se comprime automáticamente.</p>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
            <Clipboard size={10} className="shrink-0" />
            También puedes <span className="font-semibold text-slate-600">pegar (Ctrl+V)</span> desde el portapapeles
          </p>
          {tieneImagen && (
            <button type="button" onClick={quitarImagen} disabled={cargando}
              className="flex items-center gap-1 mt-1 text-xs text-red-500 hover:text-red-700 transition-colors">
              <X size={12} /> Quitar imagen
            </button>
          )}
        </div>
      </div>

      {/* Nombre */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Package size={14} className="text-slate-400" />
          Nombre *
        </label>
        <input
          type="text"
          name="nombre"
          value={campos.nombre}
          onChange={cambiar}
          placeholder="Ej: Viga IPE 100x50mm"
          className={inputClass}
          disabled={cargando}
          autoFocus
        />
        {errores.nombre && <p className="text-xs text-red-500 mt-1">{errores.nombre}</p>}
      </div>

      {/* Código y Asistente */}
      <div className="space-y-3 border border-slate-100 rounded-2xl p-4 bg-slate-50/50">
        <Campo label="Código" icono={Hash} error={errores.codigo}>
          <div className="relative">
            <input type="text" name="codigo" value={campos.codigo}
              onChange={cambiar} placeholder="Ej: VIG0106001"
              className={`${inputClass} bg-white pr-20`} disabled={cargando} />
            {generando && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-slate-400">
                <Loader2 size={12} className="animate-spin text-primary" /> Consultando...
              </span>
            )}
          </div>
        </Campo>

        <div className="border-t border-slate-200/60 pt-3 mt-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Asistente de Código Estructurado</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-medium text-slate-500 block mb-1">Línea</label>
              <select
                value={genLinea}
                onChange={e => {
                  const val = e.target.value
                  setGenLinea(val)
                  if (!val) {
                    setManuales({ linea: false, material: false, forma: false })
                  } else {
                    setManuales(m => ({ ...m, linea: true }))
                  }
                }}
                disabled={cargando}
                className="w-full text-xs bg-white border border-slate-200 rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary transition-colors text-slate-800"
              >
                <option value="">-- Línea --</option>
                {LINEAS.map((l, idx) => (
                  <option key={`${l.value}-${idx}`} value={l.value}>{l.value} - {l.label.split(' ')[0]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-500 block mb-1">Material</label>
              <select
                value={genMaterial}
                onChange={e => {
                  const val = e.target.value
                  setGenMaterial(val)
                  setManuales(m => ({ ...m, material: !!val }))
                }}
                disabled={cargando || !genLinea}
                className="w-full text-xs bg-white border border-slate-200 rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary transition-colors text-slate-800 disabled:opacity-60 disabled:bg-slate-100"
              >
                <option value="">{!genLinea ? 'Selecciona Línea' : '-- Material --'}</option>
                {materialesFiltrados.map(m => (
                  <option key={m.value} value={m.value}>{m.value} - {m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-500 block mb-1">Forma</label>
              <select
                value={genForma}
                onChange={e => {
                  const val = e.target.value
                  setGenForma(val)
                  setManuales(m => ({ ...m, forma: !!val }))
                }}
                disabled={cargando || !genLinea}
                className="w-full text-xs bg-white border border-slate-200 rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-primary-focus focus:border-primary transition-colors text-slate-800 disabled:opacity-60 disabled:bg-slate-100"
              >
                <option value="">{!genLinea ? 'Selecciona Línea' : '-- Forma --'}</option>
                {formasFiltradas.map(f => (
                  <option key={f.value} value={f.value}>{f.value} - {f.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Desglose visual del código en tiempo real */}
        {(() => {
          const match = campos.codigo?.trim().toUpperCase().match(/^([A-Z]{2,3})(\d{2})(\d{2})(\d{3})$/)
          if (!match) return null
          const [, lCode, mCode, fCode, cCode] = match
          const lineaLabel = LINEAS.find(l => l.value === lCode)?.label?.split(' ')[0] || 'Desconocido'
          const matLabel = MATERIALES.find(m => m.value === mCode)?.label || 'Desconocido'
          const formaLabel = FORMAS.find(f => f.value === fCode)?.label || 'Desconocido'
          const catSugerida = obtenerCategoriaDesdeEstructura(lCode, mCode, fCode, campos.nombre)

          return (
            <div className="mt-2.5 p-3 bg-white border border-slate-200/60 rounded-xl space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <span className="text-[11px] font-semibold text-slate-700">Desglose del Código Estructurado</span>
                <span className="text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-200/50 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Código Válido
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                {/* Línea */}
                <div className="flex-1 min-w-[65px] bg-slate-50 border border-slate-200/60 rounded-lg p-2 flex flex-col">
                  <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Línea</span>
                  <span className="font-mono text-slate-800 font-bold text-sm mt-0.5">{lCode}</span>
                  <span className="text-slate-500 truncate text-[10px] mt-0.5" title={lineaLabel}>{lineaLabel}</span>
                </div>
                <div className="text-slate-300 font-bold text-sm select-none">-</div>
                {/* Material */}
                <div className="flex-1 min-w-[65px] bg-slate-50 border border-slate-200/60 rounded-lg p-2 flex flex-col">
                  <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Material</span>
                  <span className="font-mono text-slate-800 font-bold text-sm mt-0.5">{mCode}</span>
                  <span className="text-slate-500 truncate text-[10px] mt-0.5" title={matLabel}>{matLabel}</span>
                </div>
                <div className="text-slate-300 font-bold text-sm select-none">-</div>
                {/* Forma */}
                <div className="flex-1 min-w-[65px] bg-slate-50 border border-slate-200/60 rounded-lg p-2 flex flex-col">
                  <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Forma</span>
                  <span className="font-mono text-slate-800 font-bold text-sm mt-0.5">{fCode}</span>
                  <span className="text-slate-500 truncate text-[10px] mt-0.5" title={formaLabel}>{formaLabel}</span>
                </div>
                <div className="text-slate-300 font-bold text-sm select-none">-</div>
                {/* Correlativo */}
                <div className="flex-1 min-w-[65px] bg-primary/5 border border-primary/10 rounded-lg p-2 flex flex-col">
                  <span className="text-[8px] text-primary/70 font-bold uppercase tracking-wider">Correlativo</span>
                  <span className="font-mono text-primary font-bold text-sm mt-0.5">{cCode}</span>
                  <span className="text-primary/70 text-[9px] mt-0.5 font-medium">Auto</span>
                </div>
              </div>
              {catSugerida && (
                <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-150 flex items-center justify-between">
                  <span>Categoría auto-sincronizada:</span>
                  <span className="font-bold text-slate-800 bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                    {catSugerida}
                  </span>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Categoría + Unidad (fila) */}
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Categoría" icono={Tag} error={errores.categoria}>
          <CustomSelect
            options={categoriasExistentes}
            value={campos.categoria}
            onChange={val => { setCampos(p => ({ ...p, categoria: val })); if (errores.categoria) setErrores(p => ({ ...p, categoria: '' })); if (errorGeneral) setErrorGeneral('') }}
            placeholder="Seleccionar categoría..."
            icon={Tag}
            disabled={cargando}
            clearable
            creatable
            createLabel="Crear"
          />
        </Campo>
        <Campo label="Unidad" icono={Layers} error={errores.unidad}>
          <CustomSelect
            options={['und', 'kg', 'g', 'lt', 'ml', 'm', 'cm', 'm2', 'm3', 'caja', 'paq', 'rollo', 'par', 'bolsa', 'saco'].map(u => ({ value: u, label: u }))}
            value={campos.unidad}
            onChange={val => setCampos(p => ({ ...p, unidad: val }))}
            icon={Layers}
            disabled={cargando}
            creatable
            createLabel="Crear"
            createMaxLength={5}
          />
        </Campo>
      </div>

      {/* Descripción */}
      <Campo label="Descripción" icono={Package} error={errores.descripcion}>
        <textarea name="descripcion" value={campos.descripcion}
          onChange={cambiar} rows={2}
          placeholder="Descripción opcional del producto..."
          className={`${inputClass} resize-none`} disabled={cargando} />
      </Campo>

      {/* Precios (bloques de precios con márgenes) */}
      <div className={`grid grid-cols-1 ${esAdmin ? 'md:grid-cols-3' : 'grid-cols-3'} gap-3 bg-slate-50/50 p-3 rounded-2xl border border-slate-100`}>
        <PrecioBlock label="Precio 1 (USD)" precioName="precio_usd" pctName="precio1_porcentaje" campos={campos} cambiar={cambiar} esAdmin={esAdmin} errores={errores} cargando={cargando} />
        <PrecioBlock label="Precio 2 (USD)" precioName="precio_2" pctName="precio2_porcentaje" campos={campos} cambiar={cambiar} esAdmin={esAdmin} errores={errores} cargando={cargando} />
        <PrecioBlock label="Precio 3 (USD)" precioName="precio_3" pctName="precio3_porcentaje" campos={campos} cambiar={cambiar} esAdmin={esAdmin} errores={errores} cargando={cargando} />
      </div>

      {/* Costo */}
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <Campo label="Costo (USD)" icono={DollarSign} error={errores.costo_usd}>
            <input type="text" inputMode="decimal" name="costo_usd" value={campos.costo_usd}
              onChange={cambiar} placeholder="0.00"
              className={inputClass} disabled={cargando} />
          </Campo>
        </div>
        {esAdmin && (campos.precio1_porcentaje || campos.precio2_porcentaje || campos.precio3_porcentaje) && (
          <button type="button" onClick={recalcularPrecios} disabled={cargando}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl border border-slate-200 transition-colors h-[42px] flex items-center justify-center">
            Recalcular precios
          </button>
        )}
      </div>

      {/* Stock actual + mínimo (fila) */}
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Stock actual" icono={BarChart2} error={errores.stock_actual}>
          <input type="text" inputMode="decimal" name="stock_actual" value={campos.stock_actual}
            onChange={cambiar} placeholder="0"
            className={inputClass} disabled={cargando} />
        </Campo>
        <Campo label="Stock mínimo" icono={BarChart2} error={errores.stock_minimo}>
          <input type="text" inputMode="decimal" name="stock_minimo" value={campos.stock_minimo}
            onChange={cambiar} placeholder="0"
            className={inputClass} disabled={cargando} />
        </Campo>
      </div>

      {errorGeneral && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {errorGeneral}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={cargando}
          className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={cargando || comprimiendo}
          className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {cargando
            ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
            : esEdicion ? 'Guardar cambios' : 'Crear producto'
          }
        </button>
      </div>
    </form>
  )
}
