// src/utils/smartSearch.js
// Motor de búsqueda inteligente para materiales de construcción — Venezuela
// Fuzzy matching, sinónimos, tolerancia a errores tipográficos, scoring

// ─── Palabras triviales que se ignoran en la búsqueda ─────────────────────────
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'para', 'con', 'por', 'en', 'al', 'y', 'o', 'que', 'se', 'es',
  'saco', 'sacos', 'kilo', 'kilos', 'kg', 'rollo', 'rollos',
  'unidad', 'unidades', 'und', 'pieza', 'piezas', 'pza',
  'metro', 'metros', 'lineal', 'lineales',
])

// ─── Fracciones multi-palabra (se procesan antes de tokenizar) ────────────────
const FRACCIONES_MULTI = [
  // Fracciones escritas y coloquiales
  ['1 pulgada y media', '1 1/2"'],
  ['1 pulgada y medio', '1 1/2"'],
  ['2 pulgadas y media', '2 1/2"'],
  ['2 pulgadas y medio', '2 1/2"'],
  ['3 pulgadas y media', '3 1/2"'],
  ['3 pulgadas y medio', '3 1/2"'],
  ['de media', '1/2'],
  ['un medio', '1/2'],
  ['media pulgada', '1/2"'],
  ['medio pulgada', '1/2"'],
  ['de un cuarto', '1/4'],
  ['de tres octavos', '3/8'],
  ['de cinco octavos', '5/8'],
  ['de tres cuartos', '3/4'],
  ['de siete octavos', '7/8'],
  ['3 octavos', '3/8'],
  ['5 octavos', '5/8'],
  ['7 octavos', '7/8'],
  ['3 cuartos', '3/4'],
  ['1 cuarto', '1/4'],
  ['un cuarto', '1/4'],

  // Fracciones escritas
  ['tres octavos', '3/8'],
  ['cinco octavos', '5/8'],
  ['tres cuartos', '3/4'],
  ['siete octavos', '7/8'],
  ['una pulgada', '1"'],
  ['dos pulgadas', '2"'],
  ['tres pulgadas', '3"'],
  ['cuatro pulgadas', '4"'],
  ['seis pulgadas', '6"'],
  // Medidas compuestas coloquiales
  ['uno y medio', '1 1/2'],
  ['1 y medio', '1 1/2'],
  ['1 y media', '1 1/2'],
  ['pulgada y media', '1 1/2"'],
  ['2 y medio', '2 1/2'],
  ['2 y media', '2 1/2'],
  ['3 y medio', '3 1/2'],
  ['3 y media', '3 1/2'],
  // Aguas — jerga venezolana (deben ir antes de tokenizar)
  ['aguas negras', 'A/N'],
  ['agua negra', 'A/N'],
  ['aguas blancas', 'A.F'],
  ['agua blanca', 'A.F'],
  ['aguas frias', 'A.F'],
  ['agua fria', 'A.F'],
  ['agua caliente', 'A.C'],
  ['aguas calientes', 'A.C'],
  ['alta presion', 'alta presion'],
  // Tipos de producto compuestos
  ['hierro negro', 'HN'],
  ['hierro pulido', 'HP'],
  ['hierro galvanizado', 'HG'],
  ['losa acero', 'losacero'],
  ['dry wall', 'drywall'],
  ['mil tejas', 'mil tejas'],
  ['vigueta tipo c', 'vigueta tipo c'],
  ['tipo c', 'tipo c'],
  ['pega prof', 'pega prof'],
  ['cemento pvc', 'cemento pvc'],
  ['keep dry', 'keep dry'],
  ['galv caliente', 'galv caliente'],
  ['malla truckson', 'malla truckson'],
  ['cable electrico', 'cable electrico'],
  ['tubo pulido', 'tubo pulido'],
  ['tubo estruc', 'tubo estruc'],
  ['tubo galv', 'tubo galv'],
  ['tubo pvc', 'tubo pvc'],
  ['tubo elec', 'tubo elec'],
  ['tubo vent', 'tubo vent'],
  ['caja de paso', 'caja de paso'],
  ['caja de medidor', 'caja de medidor'],
  // Medidas con "pulgadas" después del número
  ['pulgadas', '"'],
  ['pulgada', '"'],
  ['pulg', '"'],
]

// ─── Sinónimos y expansiones de jerga venezolana ──────────────────────────────
const SINONIMOS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ABREVIACIONES DE SISTEMAS (agua, electricidad, gas)
  // ═══════════════════════════════════════════════════════════════════════════
  'an':            ['a.n', 'a/n', 'aguas negras', 'agua negra', 'drenaje', 'cloacal'],
  'af':            ['a.f', 'a.f.', 'agua fria', 'aguas frias', 'agua blanca', 'aguas blancas', 'presion'],
  'ac':            ['a.c', 'a.c.', 'agua caliente', 'aguas calientes', 'cpvc'],
  'a.n':           ['an', 'a/n', 'aguas negras', 'drenaje', 'cloacal'],
  'a.f':           ['af', 'a.f.', 'agua fria', 'agua blanca', 'presion'],
  'a.c':           ['ac', 'a.c.', 'agua caliente', 'cpvc'],
  'a/n':           ['an', 'a.n', 'aguas negras', 'drenaje'],
  'drenaje':       ['a.n', 'an', 'a/n', 'aguas negras', 'cloacal'],
  'cloacal':       ['a.n', 'an', 'drenaje', 'aguas negras'],
  'presion':       ['a.f', 'af', 'agua fria', 'alta presion'],
  'cpvc':          ['a.c', 'ac', 'agua caliente'],

  // ═══════════════════════════════════════════════════════════════════════════
  // ABREVIACIONES COMUNES FERRETERAS VENEZOLANAS
  // ═══════════════════════════════════════════════════════════════════════════
  'red':           ['reduccion', 'reducciones'],
  'rosc':          ['roscado', 'roscada', 'c/rosc'],
  'c/rosc':        ['roscado', 'roscada', 'rosc'],
  'int':           ['interior', 'int.'],
  'ext':           ['exterior', 'ext.'],
  'nac':           ['nacional'],
  'imp':           ['importado', 'importada'],
  'importado':     ['imp', 'importada'],
  'importada':     ['imp', 'importado'],
  'nacional':      ['nac'],
  'interior':      ['int', 'int.'],
  'exterior':      ['ext', 'ext.'],
  'ref':           ['reforzado', 'reforzada'],
  'reforzado':     ['ref', 'reforzada'],
  'reforzada':     ['ref', 'reforzado'],
  '2da':           ['segunda', 'segundo', 'de segunda'],
  'segunda':       ['2da'],
  'psi':           ['presion'],
  'hg':            ['hierro galvanizado', 'galv'],
  'hp':            ['hierro pulido', 'pulido'],
  'est':           ['estriada', 'estriado', 'est.'],
  'est.':          ['estriada', 'estriado', 'est'],
  'prep':          ['prepintado', 'prepintada'],
  'prepintado':    ['prep', 'prepintada'],
  'prepintada':    ['prep', 'prepintado'],
  'pul':           ['pulido', 'pulida'],
  'galv.':         ['galvanizado', 'galvanizada', 'galv'],
  'pr1':           ['prepintado'],
  'lam':           ['lamina', 'laminas', 'lam.'],
  'lam.':          ['lamina', 'laminas', 'lam'],

  // Marcas venezolanas comunes
  'sidetur':       ['sidetur', 'sidor'],
  'sidor':         ['sidor', 'sidetur'],
  'sizuca':        ['sizuca'],
  'tubrica':       ['tubrica'],
  'pavco':         ['pavco'],
  'uniteca':       ['uniteca'],
  'betaplast':     ['betaplast'],
  'gricon':        ['gricon'],
  'phelpsdodge':   ['phelps dodge', 'phelpsdodge'],

  // ═══════════════════════════════════════════════════════════════════════════
  // FRACCIONES Y MEDIDAS
  // ═══════════════════════════════════════════════════════════════════════════
  'media':         ['1/2'],
  'medio':         ['1/2'],
  'cuarto':        ['1/4'],
  'octavo':        ['1/8'],
  'mts':           ['metros', 'm'],
  'mm':            ['milimetros'],
  'cm':            ['centimetros'],
  'awg':           ['calibre'],

  // ═══════════════════════════════════════════════════════════════════════════
  // MATERIALES DE CONSTRUCCIÓN — JERGA VENEZOLANA
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Cabillas y acero ---
  'cabilla':       ['cabillas', 'cabilla estriada', 'varilla'],
  'cabillas':      ['cabilla', 'cabilla estriada', 'varilla'],
  'varilla':       ['cabilla', 'cabillas', 'cabilla estriada'],
  'varillas':      ['cabilla', 'cabillas'],
  'hierro':        ['hn', 'hro', 'hierro negro', 'acero'],
  'hn':            ['hierro', 'hierro negro'],
  'acero':         ['hierro'],
  'flanche':       ['flanches', 'flange', 'brida'],
  'flanches':      ['flanche'],
  'brida':         ['flanche'],

  // --- Perfiles y platinas ---
  'platina':       ['pletina', 'pletinas', 'platinas'],
  'platinas':      ['pletina', 'pletinas', 'platina'],
  'pletina':       ['platina', 'platinas'],
  'pletinas':      ['platina', 'platinas', 'pletina'],
  'perfil':        ['perfiles', 'vigueta'],
  'perfiles':      ['perfil', 'vigueta'],
  'vigueta':       ['perfil', 'perfiles', 'vigueta tipo c'],
  'tipoc':         ['vigueta tipo c', 'vigueta'],
  'cercha':        ['cerchas'],
  'cerchas':       ['cercha'],
  'angulo':        ['angulos', 'angular'],
  'angulos':       ['angulo', 'angular'],
  'angular':       ['angulo', 'angulos'],

  // --- Láminas y techos ---
  'zinc':          ['lamina', 'galv', 'galvanizado', 'galvatecho', 'prepintado', 'techo'],
  'techo':         ['lamina', 'zinc', 'galvatecho', 'termopanel', 'acerolit'],
  'acerolit':      ['lamina acerolit', 'teja'],
  'teja':          ['lamina', 'acerolit', 'galvatecho', 'termopanel', 'techo'],
  'tejas':         ['lamina', 'acerolit', 'galvatecho', 'termopanel', 'techo'],
  'lamina':        ['lam', 'lam.', 'laminas'],
  'laminas':       ['lam', 'lam.', 'lamina'],
  'galvatecho':    ['galva techo', 'zinc', 'techo'],
  'termopanel':    ['termo panel', 'techo', 'translucido'],
  'miltejas':      ['mil tejas', 'pvc'],
  'caballete':     ['cumbrera', 'remate'],
  'cumbrera':      ['caballete', 'remate'],
  'remate':        ['caballete', 'cumbrera', 'fachada'],
  'losacero':      ['losa acero', 'losacero', 'losa', 'entrepiso'],
  'entrepiso':     ['losacero', 'losa acero'],

  // --- Mallas y alambres ---
  'malla':         ['mallas', 'truckson', 'electrosoldada'],
  'mallas':        ['malla', 'truckson', 'electrosoldada'],
  'truckson':      ['malla', 'mallas', 'electrosoldada'],
  'electrosoldada':['malla', 'truckson'],
  'alambre':       ['alambre galvanizado', 'alambron'],
  'alambron':      ['alambre', 'alambrones'],
  'alambrones':    ['alambron', 'alambre'],

  // ═══════════════════════════════════════════════════════════════════════════
  // TUBOS Y TUBERÍAS
  // ═══════════════════════════════════════════════════════════════════════════
  'tubo':          ['tubos', 'tuberia'],
  'tubos':         ['tubo', 'tuberia'],
  'tuberia':       ['tubo', 'tubos'],
  'cano':          ['tubo', 'tubos', 'tuberia'],
  'tubular':       ['tubo estruc'],
  'estructural':   ['estruc', 'estruc.'],
  'estruc':        ['estructural', 'estruc.'],
  'estruc.':       ['estructural', 'estruc'],
  'pulido':        ['pulida'],
  'ventilacion':   ['vent', 'vent.'],
  'vent':          ['ventilacion', 'vent.'],
  'vent.':         ['ventilacion', 'vent'],
  'electrico':     ['elec', 'elec.', 'electrica', 'emt', 'conduit'],
  'electrica':     ['elec', 'electrico'],
  'elec':          ['electrico', 'electrica', 'elec.'],
  'elec.':         ['electrico', 'electrica', 'elec'],
  'conduit':       ['elec', 'electrico', 'emt'],
  'emt':           ['elec', 'electrico', 'conduit'],
  'pvc':           ['plastico'],
  'alcantarillado':['alcant', 'drenaje', 'a.n', 'corrugado'],
  'alcant':        ['alcantarillado', 'drenaje'],
  'corrugado':     ['alcantarillado', 'corrugada'],

  // ═══════════════════════════════════════════════════════════════════════════
  // CONEXIONES DE PLOMERÍA
  // ═══════════════════════════════════════════════════════════════════════════
  'codo':          ['codos'],
  'codos':         ['codo'],
  'tee':           ['te'],
  'te':            ['tee'],
  'reduccion':     ['reducciones', 'red'],
  'reducciones':   ['reduccion', 'red'],
  'anillo':        ['anillos', 'aro'],
  'anillos':       ['anillo', 'aro'],
  'aro':           ['anillo', 'anillos'],
  'sifon':         ['sifones', 'trampa'],
  'sifones':       ['sifon'],
  'trampa':        ['sifon'],
  'union':         ['uniones', 'cupla'],
  'uniones':       ['union', 'cupla'],
  'cupla':         ['union', 'uniones'],
  'tapon':         ['tapones', 'cap'],
  'tapones':       ['tapon'],
  'cap':           ['tapon'],
  'niple':         ['niples', 'nipple', 'nipples'],
  'niples':        ['niple'],
  'yee':           ['ye'],
  'ye':            ['yee'],
  'curva':         ['curvas'],
  'curvas':        ['curva'],
  'adaptador':     ['adaptadores', 'adapt'],
  'adaptadores':   ['adaptador'],
  'adapt':         ['adaptador', 'adaptadores'],
  'junta':         ['juntas', 'dresser'],
  'juntas':        ['junta', 'dresser'],
  'dresser':       ['junta', 'juntas'],
  'rejilla':       ['rejillas'],
  'rejillas':      ['rejilla'],
  'valvula':       ['llave', 'valvulas'],
  'llave':         ['valvula', 'arresto', 'paso'],
  'arresto':       ['llave', 'valvula'],

  // ═══════════════════════════════════════════════════════════════════════════
  // PEGAMENTOS, CEMENTOS Y AGREGADOS
  // ═══════════════════════════════════════════════════════════════════════════
  'pega':          ['pegamento', 'cemento pvc', 'pega prof', 'adhesivo'],
  'pegamento':     ['pega', 'pega prof', 'adhesivo'],
  'adhesivo':      ['pega', 'pegamento'],
  'cemento':       ['cemento gris', 'cementos'],
  'cementos':      ['cemento'],
  'sikaflex':      ['sika', 'sellador'],
  'sika':          ['sikaflex'],
  'silicon':       ['silicona', 'sellador'],
  'silicona':      ['silicon', 'sellador'],
  'sellador':      ['silicon', 'silicona', 'sikaflex'],
  'mortero':       ['mezcla', 'premezclado', 'friso'],
  'mezcla':        ['mortero', 'premezclado'],
  'friso':         ['mortero', 'mezcla'],
  'arena':         ['agregado'],
  'piedra':        ['agregado', 'picada', 'granzón'],
  'picada':        ['piedra'],
  'granzon':       ['piedra', 'granzón'],
  'agregado':      ['arena', 'piedra'],
  'epoxica':       ['epoxi', 'epoxica', 'epoxy'],
  'epoxi':         ['epoxica', 'epoxy'],
  'teflon':        ['cinta teflon', 'teflón'],
  'impermeabilizante': ['impermeabilizante', 'imperm'],
  'imperm':        ['impermeabilizante'],

  // ═══════════════════════════════════════════════════════════════════════════
  // METALES Y ACABADOS
  // ═══════════════════════════════════════════════════════════════════════════
  'galvanizado':   ['galv', 'galv.', 'galvanizada'],
  'galvanizada':   ['galv', 'galv.', 'galvanizado'],
  'galv':          ['galvanizado', 'galvanizada', 'galv.'],
  'inoxidable':    ['inox', 'acero inoxidable'],
  'inox':          ['inoxidable'],
  'estriada':      ['estriado', 'est', 'est.'],
  'estriado':      ['estriada', 'est', 'est.'],
  'negro':         ['negra', 'hn'],
  'negra':         ['negro', 'hn'],
  'blanco':        ['blanca'],
  'blanca':        ['blanco'],
  'rojo':          ['roja'],
  'roja':          ['rojo'],
  'azul':          ['azul'],
  'verde':         ['verde'],
  'amarillo':      ['amarilla'],
  'amarilla':      ['amarillo'],
  'naranja':       ['naranja'],
  'redondo':       ['redonda'],
  'redonda':       ['redondo'],
  'cuadrado':      ['cuadrada', 'cuad', 'cuad.'],
  'cuadrada':      ['cuadrado', 'cuad'],
  'cuad':          ['cuadrado', 'cuadrada', 'cuad.'],
  'cuad.':         ['cuadrado', 'cuadrada', 'cuad'],
  'rectangular':   ['rect', 'rect.'],
  'rect':          ['rectangular', 'rect.'],
  'rect.':         ['rectangular', 'rect'],
  'liso':          ['lisa'],
  'lisa':          ['liso'],
  'roscado':       ['rosc', 'c/rosc', 'roscada'],
  'roscada':       ['rosc', 'c/rosc', 'roscado'],
  'macho':         ['macho'],
  'hembra':        ['hembra'],
  'octagonal':     ['octogonal'],
  'octogonal':     ['octagonal'],

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRICIDAD
  // ═══════════════════════════════════════════════════════════════════════════
  'cable':         ['cables'],
  'cables':        ['cable'],
  'thw':           ['cable thw', 'thw'],
  'thwn':          ['cable thwn', 'thwn'],
  'ttu':           ['cable ttu', 'ttu'],
  'mcm':           ['cable mcm', 'mcm'],
  'breaker':       ['breakers', 'breker', 'interruptor termomagnetico'],
  'breakers':      ['breaker'],
  'interruptor':   ['breaker', 'switch'],
  'tablero':       ['panel electrico', 'centro carga'],
  'cajetin':       ['cajetines', 'caja electrica'],
  'cajetines':     ['cajetin'],
  'toma':          ['tomacorriente', 'enchufe'],
  'tomacorriente': ['toma', 'enchufe'],
  'enchufe':       ['toma', 'tomacorriente'],
  'bombillo':      ['bombillos', 'lampara', 'led', 'foco'],
  'bombillos':     ['bombillo'],
  'led':           ['bombillo', 'luz'],
  'arvidal':       ['arvidal'],
  'medidor':       ['caja de medidor'],
  'empotrable':    ['empotrar', 'embutir'],
  'superficial':   ['sobreponer', 'superficie'],
  'amp':           ['amperios', 'a'],
  'amperios':      ['amp'],

  // ═══════════════════════════════════════════════════════════════════════════
  // FERRETERÍA GENERAL
  // ═══════════════════════════════════════════════════════════════════════════
  'disco':         ['discos'],
  'discos':        ['disco'],
  'corte':         ['tronzar'],
  'esmerilar':     ['esmeril', 'desbaste'],
  'esmeril':       ['esmerilar', 'desbaste'],
  'tronzadora':    ['tronzar', 'cortadora'],
  'electrodo':     ['electrodos', 'soldadura'],
  'electrodos':    ['electrodo'],
  'soldadura':     ['electrodo', 'soldar'],
  'clavo':         ['clavos'],
  'clavos':        ['clavo'],
  'tornillo':      ['tornillos', 'tor', 'perno'],
  'tornillos':     ['tornillo', 'tor', 'perno'],
  'tor':           ['tornillo', 'tornillos'],
  'perno':         ['tornillo', 'tornillos', 'tor'],
  'barra':         ['barras'],
  'barras':        ['barra'],
  'drywall':       ['dry wall', 'laminas drywall', 'tabiqueria', 'yeso'],
  'tabiqueria':    ['drywall'],
  'zuncho':        ['zunchos', 'grapa', 'abrazadera'],
  'zunchos':       ['zuncho'],
  'grapa':         ['zuncho', 'zunchos'],
  'abrazadera':    ['zuncho', 'zunchos'],
  'arnes':         ['arnes', 'arneses', 'seguridad'],
  'arneses':       ['arnes'],
  'cerradura':     ['cerrojo', 'chapa', 'embutir'],
  'chapa':         ['cerradura'],
  'manilla':       ['manija', 'pomo'],
  'manija':        ['manilla', 'pomo'],
  'fregadero':     ['lavaplatos', 'fregaderos'],
  'lavaplatos':    ['fregadero'],
  'griferia':      ['grifo', 'llave'],
  'grifo':         ['griferia', 'llave'],
  'porton':        ['portones', 'puerta'],
  'portones':      ['porton'],

  // ═══════════════════════════════════════════════════════════════════════════
  // PINTURA
  // ═══════════════════════════════════════════════════════════════════════════
  'pintura':       ['pinturas'],
  'pinturas':      ['pintura'],
  'caucho':        ['pintura caucho', 'latex'],
  'latex':         ['caucho', 'pintura caucho'],
  'esmalte':       ['pintura esmalte', 'brillante'],
  'rodillo':       ['rodillos', 'felpa'],
  'rodillos':      ['rodillo'],
  'brocha':        ['brochas'],
  'brochas':       ['brocha'],

  // ═══════════════════════════════════════════════════════════════════════════
  // HERRAMIENTAS
  // ═══════════════════════════════════════════════════════════════════════════
  'taladro':       ['taladros', 'percutor'],
  'percutor':      ['taladro'],
  'martillo':      ['martillos'],
  'nivel':         ['niveles', 'burbuja'],
  'destornillador':['destornilladores', 'desarmador'],
  'desarmador':    ['destornillador'],
  'cinta':         ['cinta metrica'],

  // ═══════════════════════════════════════════════════════════════════════════
  // VIGAS ESPECÍFICAS
  // ═══════════════════════════════════════════════════════════════════════════
  'viga':          ['vigas'],
  'vigas':         ['viga'],
  'ipe':           ['ipe', 'i beam'],
  'ipn':           ['ipn'],
  'hea':           ['hea', 'he'],
  'heb':           ['heb', 'he'],
  'he':            ['hea', 'heb'],
  'wf':            ['wf', 'wide flange'],
  'upl':           ['upl'],
  'vp':            ['vp'],

  // ═══════════════════════════════════════════════════════════════════════════
  // ABREVIACIONES DE INVENTARIO
  // ═══════════════════════════════════════════════════════════════════════════
  'diametro':      ['diam', 'diam.'],
  'diam':          ['diametro', 'diam.'],
  'diam.':         ['diametro', 'diam'],
  'espesor':       ['esp', 'esp.'],
  'esp':           ['espesor', 'esp.'],
  'esp.':          ['espesor', 'esp'],
  'calibre':       ['cal', 'cal.', 'awg'],
  'cal':           ['calibre', 'cal.'],
  'cal.':          ['calibre', 'cal'],
  'largo':         ['longitud', 'long'],
  'longitud':      ['largo', 'long'],
  'ancho':         ['anchura'],
  'alto':          ['altura'],
  'peso':          ['grs', 'gramos', 'kg', 'kilos'],
  'grs':           ['gramos', 'peso'],
  'iso':           ['norma', 'iso'],
  'astm':          ['norma', 'astm'],
  'sdr':           ['sdr'],
  'sch':           ['schedule', 'cedula'],
  'schedule':      ['sch', 'cedula'],
  'nc':            ['rosca nacional'],
}

// ─── Mapa de correcciones tipográficas comunes ────────────────────────────────
const TYPO_MAP = {
  // ═══ Cabillas y varillas ═══
  'cavilla':     'cabilla',
  'cavillas':    'cabillas',
  'kabilla':     'cabilla',
  'kabillas':    'cabillas',
  'kabiya':      'cabilla',
  'cabiya':      'cabilla',
  'cabiyas':     'cabillas',
  'gavilla':     'cabilla',
  'cabila':      'cabilla',
  'cabilas':     'cabillas',
  'cabyas':      'cabillas',
  'variya':      'varilla',
  'variyas':     'varillas',
  'barilla':     'varilla',

  // ═══ Tubos ═══
  'tuvo':        'tubo',
  'tuvos':       'tubos',
  'tibo':        'tubo',
  'tubp':        'tubo',
  'tubi':        'tubo',
  'tuberia':     'tuberia',
  'tubria':      'tuberia',

  // ═══ Láminas ═══
  'lamima':      'lamina',
  'lanina':      'lamina',
  'lamna':       'lamina',
  'laina':       'lamina',
  'lanima':      'lamina',
  'lamnia':      'lamina',

  // ═══ Conexiones ═══
  'coto':        'codo',
  'codp':        'codo',
  'sifo':        'sifon',
  'cifon':       'sifon',
  'sipho':       'sifon',
  'tei':         'tee',
  'reduccin':    'reduccion',
  'reducion':    'reduccion',
  'reduccion':   'reduccion',
  'redustion':   'reduccion',
  'anilo':       'anillo',
  'aniyo':       'anillo',
  'niple':       'niple',
  'nipel':       'niple',
  'adaptadpr':   'adaptador',
  'adptador':    'adaptador',
  'unio':        'union',
  'junra':       'junta',
  'juna':        'junta',

  // ═══ Ángulos y vigas ═══
  'angilo':      'angulo',
  'amgulo':      'angulo',
  'anguko':      'angulo',
  'abgulo':      'angulo',
  'angulp':      'angulo',
  'vigaa':       'viga',
  'biga':        'viga',
  'bigas':       'vigas',
  'vigs':        'viga',
  'bigueta':     'vigueta',
  'viguets':     'vigueta',

  // ═══ Platinas/Pletinas ═══
  'pletima':     'pletina',
  'platima':     'platina',
  'pletna':      'pletina',
  'pleatina':    'pletina',
  'playtina':    'platina',

  // ═══ Clavos y tornillos ═══
  'clavp':       'clavo',
  'clabp':       'clavo',
  'clabo':       'clavo',
  'clabos':      'clavos',
  'tornilo':     'tornillo',
  'tronillo':    'tornillo',
  'tornllo':     'tornillo',

  // ═══ Alambres y mallas ═══
  'almabre':     'alambre',
  'alhambre':    'alambre',
  'alanbre':     'alambre',
  'alembre':     'alambre',
  'alambr':      'alambre',
  'alambrom':    'alambron',
  'alambrn':     'alambron',
  'mala':        'malla',
  'maalla':      'malla',
  'maya':        'malla',
  'mayas':       'mallas',
  'trukson':     'truckson',
  'trakson':     'truckson',

  // ═══ Cementos y pegamentos ═══
  'cemeto':      'cemento',
  'cemnto':      'cemento',
  'ceemento':    'cemento',
  'semnto':      'cemento',
  'semento':     'cemento',
  'peag':        'pega',
  'peg':         'pega',
  'pgea':        'pega',
  'pegaa':       'pega',
  'motero':      'mortero',
  'moretro':     'mortero',
  'mortro':      'mortero',

  // ═══ Losacero ═══
  'losasero':    'losacero',
  'lozacero':    'losacero',
  'losa':        'losacero',
  'losasero':    'losacero',

  // ═══ Electricidad ═══
  'breiker':     'breaker',
  'breker':      'breaker',
  'braker':      'breaker',
  'briker':      'breaker',
  'electrofo':   'electrodo',
  'electrod':    'electrodo',
  'electrdodo':  'electrodo',
  'cajetn':      'cajetin',
  'cajehin':     'cajetin',
  'cajeti':      'cajetin',
  'tabelro':     'tablero',
  'tabero':      'tablero',
  'arvdal':      'arvidal',
  'arbidal':     'arvidal',
  'arvdial':     'arvidal',
  'arvial':      'arvidal',
  'cabel':       'cable',
  'calbe':       'cable',

  // ═══ Perfiles y estructuras ═══
  'perfl':       'perfil',
  'perfi':       'perfil',
  'cerhca':      'cercha',
  'cerha':       'cercha',
  'flanch':      'flanche',
  'flange':      'flanche',

  // ═══ Ferretería ═══
  'disko':       'disco',
  'dico':        'disco',
  'disoc':       'disco',
  'rejila':      'rejilla',
  'rejiya':      'rejilla',
  'rejiia':      'rejilla',
  'arnes':       'arnes',
  'arnez':       'arnes',
  'cerradra':    'cerradura',
  'serradura':   'cerradura',
  'fregadro':    'fregadero',
  'grifria':     'griferia',
  'grieria':     'griferia',
  'portn':       'porton',
  'portom':      'porton',

  // ═══ Zunchos ═══
  'zunco':       'zuncho',
  'suncho':      'zuncho',
  'sunco':       'zuncho',
  'zumcho':      'zuncho',

  // ═══ Galvanizado y acabados ═══
  'galbanizado': 'galvanizado',
  'galvaniado':  'galvanizado',
  'galvnizado':  'galvanizado',
  'galvanisado': 'galvanizado',
  'estrucrural': 'estructural',
  'estrctural':  'estructural',
  'estructiral': 'estructural',
  'pulifo':      'pulido',
  'pulid':       'pulido',
  'puido':       'pulido',

  // ═══ Techos ═══
  'galvatexo':   'galvatecho',
  'galvatehco':  'galvatecho',
  'galvatexho':  'galvatecho',
  'termopabel':  'termopanel',
  'tremopanel':  'termopanel',
  'termopanle':  'termopanel',
  'acerlit':     'acerolit',
  'acerolith':   'acerolit',

  // ═══ Drywall ═══
  'drywal':      'drywall',
  'draiwall':    'drywall',
  'drywol':      'drywall',
  'draiwol':     'drywall',

  // ═══ Pintura ═══
  'pintra':      'pintura',
  'pnitura':     'pintura',
  'pintrua':     'pintura',
  'esmalte':     'esmalte',
  'rodilo':      'rodillo',
  'rodiyo':      'rodillo',

  // ═══ Abreviaciones mal escritas ═══
  'a,n':         'a.n',
  'a,f':         'a.f',
  'a,c':         'a.c',

  // ═══ Piedra y arena ═══
  'piedrs':      'piedra',
  'pidera':      'piedra',
  'arean':       'arena',
  'arna':        'arena',

  // ═══ Herramientas ═══
  'taladrop':    'taladro',
  'taaldro':     'taladro',
  'martilo':     'martillo',
  'martiyo':     'martillo',
  'nvel':        'nivel',
  'nibel':       'nivel',
}

// ─── Distancia de Levenshtein ─────────────────────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  // Optimización: si la diferencia de longitud es muy grande, no vale la pena
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length)
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// Umbral de distancia según longitud del token
function fuzzyThreshold(token) {
  if (token.length <= 3) return 0   // No fuzzy para tokens muy cortos
  if (token.length <= 5) return 1
  if (token.length <= 8) return 2
  return 3
}

// ─── Normalización de texto ───────────────────────────────────────────────────
export function normalizeText(text) {
  let t = (text || '').toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .replace(/ñ/g, 'n')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")

  // Colapsar espacios antes de unidades de medida (ej: "2 mm" -> "2mm")
  t = t.replace(/(\d+(?:\.\d+)?)\s*(mm|mt|mts|m|kg|kilos|cal|calibre)\b/g, '$1$2')

  // Colapsar espacios alrededor de la "x" en dimensiones (ej: "2 X 1" -> "2x1")
  t = t.replace(/([\d"\/])\s*x\s*([\d"\/])/g, '$1x$2')

  // Reemplazar comas decimales por puntos para evitar desajustes en OCR y consultas (ej: "0,90" -> "0.90")
  t = t.replace(/(\d+),(\d+)/g, '$1.$2')

  return t.replace(/\s+/g, ' ').trim()
}

// ─── Pre-procesar query: fracciones, de-plurizacion, calibre y limpieza ───────
function preprocessQuery(query) {
  let q = normalizeText(query)

  // Separar longitudes en metros acopladas con 'x' en perfiles
  q = q.replace(/\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?\s*(?:mt|mts|m))\b/gi, '$1 $2')

  // Limpiar slashes que no corresponden a fracciones (ej: "7018/ " -> "7018 ")
  q = q.replace(/(?<!\d)\/|\/(?!\d)/g, ' ')

  // Normalizar calibres a un formato estándar 'cal XX' o el decimal limpio
  q = q.replace(/\bcalibre\s+(\d+)\b/g, 'cal $1')
  q = q.replace(/\bcal\s+(\d+)\b/g, 'cal $1')
  q = q.replace(/\bc[/\s]+(\d+)\b/g, 'cal $1')
  q = q.replace(/\bc[/\s]+(0[.]\d+)\b/g, '$1') // c/0.90 -> 0.90

  for (const [frase, reemplazo] of FRACCIONES_MULTI) {
    q = q.replace(new RegExp(frase, 'gi'), reemplazo)
  }

  return q
}

// ─── Tokenización inteligente ─────────────────────────────────────────────────
function tokenize(q) {
  // Primero detectar medidas compuestas como "1 1/2", "2 1/4" etc
  const compoundPattern = /(\d+)\s+(\d+\/\d+)/g
  const compounds = []
  q = q.replace(compoundPattern, (match, whole, frac) => {
    const compound = `${whole} ${frac}`
    compounds.push(compound)
    return `__COMPOUND${compounds.length - 1}__`
  })

  // Tokenizar
  const rawTokens = q.split(/[\s,;]+/).filter(Boolean)

  // Restaurar compounds y filtrar stopwords
  return rawTokens.map(t => {
    let replaced = t
    const compoundMatches = t.match(/__COMPOUND(\d+)__/g)
    if (compoundMatches) {
      compoundMatches.forEach(match => {
        const idx = parseInt(match.match(/\d+/)[0])
        replaced = replaced.replace(match, compounds[idx])
      })
    }
    return replaced
  }).filter(t => !STOPWORDS.has(t) && t.length > 0)
}

// ─── Expandir un token en variantes ───────────────────────────────────────────
export function expandToken(token) {
  const variantes = new Set([token.toLowerCase()])

  // 1. Expansión de dimensiones combinadas con 'x' (ej: 1.20x2.40 -> 1200x2.40)
  if (token.includes('x')) {
    const parts = token.split('x')
    if (parts.length === 2) {
      const v1 = expandToken(parts[0])
      const v2 = expandToken(parts[1])
      v1.forEach(p1 => {
        v2.forEach(p2 => {
          variantes.add(`${p1}x${p2}`)
        })
      })
    }
  }

  // 1.5. Manejo de comillas de pulgadas de forma opcional y bidireccional
  if (token.endsWith('"')) {
    const sinComillas = token.slice(0, -1)
    variantes.add(sinComillas)
    // Expandir variantes de la versión limpia
    expandToken(sinComillas).forEach(v => variantes.add(v.toLowerCase()))
  } else {
    // Si es un número entero, decimal o fracción que representa pulgadas (ej: "1/2", "1 1/2", "1", "2")
    if (/^\d+(?:\/\d+)?$/.test(token) || /^\d+\s+\d+\/\d+$/.test(token)) {
      variantes.add(token + '"')
    }
  }

  // Mapeo calibre -> mm
  if (token === '20') {
    variantes.add('0.90'); variantes.add('0.9');
  } else if (token === '18') {
    variantes.add('1.20'); variantes.add('1.2'); variantes.add('1.10'); variantes.add('1.1');
  } else if (token === '22') {
    variantes.add('0.70'); variantes.add('0.7');
  } else if (token === '24') {
    variantes.add('0.60'); variantes.add('0.6'); variantes.add('0.55');
  } else if (token === '26') {
    variantes.add('0.45');
  } else if (token === '28') {
    variantes.add('0.35');
  } else if (token === '30') {
    variantes.add('0.30'); variantes.add('0.3');
  }

  // 2. Corrección de typos conocidos
  const corrected = TYPO_MAP[token]
  if (corrected) {
    variantes.add(corrected.toLowerCase())
    // También expandir sinónimos del corregido
    const sins = SINONIMOS[corrected.toLowerCase()]
    if (sins) sins.forEach(s => variantes.add(s.toLowerCase()))
  }

  // 3. Sinónimos directos
  const sins = SINONIMOS[token.toLowerCase()]
  if (sins) sins.forEach(s => variantes.add(s.toLowerCase()))

  // 4. Deplural: "cabillas" → "cabilla"
  if (token.length > 3 && token.endsWith('s')) {
    const singular = token.slice(0, -1)
    variantes.add(singular.toLowerCase())
    const sinsSingular = SINONIMOS[singular.toLowerCase()]
    if (sinsSingular) sinsSingular.forEach(s => variantes.add(s.toLowerCase()))
    const typoSingular = TYPO_MAP[singular.toLowerCase()]
    if (typoSingular) variantes.add(typoSingular.toLowerCase())
  }

  // 5. Deplural "es": "conexiones" → "conexion"
  if (token.length > 4 && token.endsWith('es')) {
    const base = token.slice(0, -2)
    variantes.add(base.toLowerCase())
    const sinsBase = SINONIMOS[base.toLowerCase()]
    if (sinsBase) sinsBase.forEach(s => variantes.add(s.toLowerCase()))
  }

  // 6. Expansiones de dimensiones comunes (metros a milímetros de láminas)
  const cleanTok = token.replace(',', '.')
  if (cleanTok === '1.20' || cleanTok === '1.2' || cleanTok === '1,20' || cleanTok === '1,2') {
    variantes.add('1200')
    variantes.add('1.20')
    variantes.add('1.2')
  } else if (cleanTok === '1200') {
    variantes.add('1.20')
    variantes.add('1.2')
  } else if (cleanTok === '1.00' || cleanTok === '1' || cleanTok === '1,00') {
    variantes.add('1000')
    variantes.add('1.00')
    variantes.add('1')
  } else if (cleanTok === '1000') {
    variantes.add('1.00')
    variantes.add('1')
  } else if (cleanTok === '1.25' || cleanTok === '1,25') {
    variantes.add('1250')
  } else if (cleanTok === '1250') {
    variantes.add('1.25')
  } else if (cleanTok === '1.01' || cleanTok === '1,01') {
    variantes.add('1010')
  } else if (cleanTok === '1010') {
    variantes.add('1.01')
  } else if (cleanTok === '1.22' || cleanTok === '1,22') {
    variantes.add('1220')
  } else if (cleanTok === '1220') {
    variantes.add('1.22')
  }

  return [...variantes]
}

// ─── Parser de términos de búsqueda ───────────────────────────────────────────
export function parseSearchTerms(query) {
  if (!query || !query.trim()) return []

  const q = preprocessQuery(query)
  const tokens = tokenize(q)

  return tokens.map(token => expandToken(token))
}

// Helper to parse dimension or fractional sizes to comparative decimal values
function parseSizeToDecimal(str) {
  if (!str) return 0;
  let clean = str.replace(/["\s]/g, ' ').replace(/-/g, ' ').trim();
  const compoundMatch = clean.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (compoundMatch) {
    const whole = parseInt(compoundMatch[1], 10);
    const num = parseInt(compoundMatch[2], 10);
    const den = parseInt(compoundMatch[3], 10);
    return whole + (num / den);
  }
  const fractionMatch = clean.match(/^(\d+)\/(\d+)$/);
  if (fractionMatch) {
    const num = parseInt(fractionMatch[1], 10);
    const den = parseInt(fractionMatch[2], 10);
    return num / den;
  }
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}

function parseSizeStructure(str) {
  if (!str) return [];
  const parts = str.toLowerCase().split('x');
  return parts.map(part => parseSizeToDecimal(part.trim())).filter(val => val > 0);
}

// Extrae tamaños en pulgadas o fracciones, limpiando otras unidades físicas (m, mm, kg)
export function extractInchSizes(text) {
  let cleanText = normalizeText(text)
  cleanText = cleanText.replace(/\b(?:cal|calibre|c\/)\s*\d+(?:\.\d+)?\b/g, '')
  cleanText = cleanText.replace(/(?:^|[\s,;\-x])\d+(?:\.\d+)?\s*(?:mm|mt|mts|m|kg|kilos)\b/gi, '')
  const matches = cleanText.match(/\b\d+(?:\.\d+)?(?:\"|in\b|pulg\b|pulgadas?\b)?x\d+(?:\.\d+)?(?:\"|in\b|pulg\b|pulgadas?\b)?|\d+\s+\d+\/\d+|\d+\/\d+|\b\d+(?:\.\d+)?(?:\"|in\b|pulg\b|pulgadas?\b)?/gi) || []
  const sizes = []
  for (const m of matches) {
    let clean = m.replace(/["\s]|in\b|pulg\b|pulgadas?\b/i, ' ').trim();
    if (!clean) continue;
    clean = clean.replace(/\s+/g, ' ');
    if (clean.includes('x')) {
      const parts = clean.split('x').map(p => p.trim()).filter(part => {
        const val = parseSizeToDecimal(part);
        return isNaN(val) || val >= 1;
      });
      if (parts.length === 0) continue;
      clean = parts.join('x');
    }
    const isFrac = clean.includes('/');
    const hasPulgMarker = /"|\bin\b|\bpulg\b|\bpulgadas?\b/i.test(m);
    const num = parseSizeToDecimal(clean);
    if (!clean.includes('x') && !isFrac && !isNaN(num) && num < 1) {
      continue;
    }
    if (isFrac || hasPulgMarker || clean.includes('x') || (!isNaN(num) && num > 0 && num < 10)) {
      if (!sizes.includes(clean)) sizes.push(clean);
    }
  }
  return sizes
}

export function sizesConflict(qs, ps) {
  const qStr = qs.toLowerCase().replace(/["\s]/g, '');
  const pStr = ps.toLowerCase().replace(/["\s]/g, '');
  
  const qsHasX = qStr.includes('x');
  const psHasX = pStr.includes('x');
  
  if (qsHasX !== psHasX) {
    if (pStr.includes(qStr) || qStr.includes(pStr)) {
      return true;
    }
    return false;
  }
  
  const qComponents = parseSizeStructure(qs);
  const pComponents = parseSizeStructure(ps);
  
  if (qComponents.length === 0 || pComponents.length === 0) return false;
  
  // Compare up to the length of the shorter components list
  const len = Math.min(qComponents.length, pComponents.length);
  for (let i = 0; i < len; i++) {
    const qVal = qComponents[i];
    const pVal = pComponents[i];
    const maxVal = Math.max(qVal, pVal);
    if (maxVal > 0) {
      const pctDiff = Math.abs(qVal - pVal) / maxVal;
      if (pctDiff > 0.09) return true;
    }
  }
  return false;
}

// ─── Búsqueda con match exacto (includes) ────────────────────────────────────
export function smartMatch(text, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true
  const normalized = normalizeText(text)
  return searchTerms.every(variantes =>
    variantes.some(v => normalized.includes(v.toLowerCase()))
  )
}

// ─── Búsqueda con scoring (para ranking) ──────────────────────────────────────
export function smartMatchScore(text, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return { match: true, score: 0 }
  const normalized = normalizeText(text)

  // ─── Exclusividad de dimensiones con 'x' ───
  const queryDims = []
  searchTerms.forEach(variantes => {
    variantes.forEach(v => {
      const match = v.match(/\b\d+(?:\.\d+)?(?:mm|mt|mts|m)?(?:x\d+(?:\.\d+)?(?:mm|mt|mts|m)?)+\b/gi)
      if (match) {
        match.forEach(d => {
          const cleanD = d.replace(/[^0-9.x]/gi, '')
          if (!queryDims.includes(cleanD)) queryDims.push(cleanD)
        })
      }
    })
  })

  if (queryDims.length > 0) {
    const rawProductDims = normalized.match(/\b\d+(?:\.\d+)?(?:mm|mt|mts|m)?(?:x\d+(?:\.\d+)?(?:mm|mt|mts|m)?)+\b/gi) || []
    const productDims = rawProductDims.map(d => d.replace(/[^0-9.x]/gi, ''))
    if (productDims.length > 0) {
      const hasMatchingDim = queryDims.some(qd => 
        productDims.some(pd => !sizesConflict(qd, pd))
      )
      if (!hasMatchingDim) {
        return { match: false, score: 0, coverage: 0, matchedTerms: 0, totalTerms: searchTerms.length }
      }
    }
  }

  // ─── Exclusividad de medidas fraccionales/pulgadas ───
  const querySizes = []
  searchTerms.forEach(variantes => {
    const orig = variantes[0]
    // Keep spaces for compound fractions like "7018 1/8" — removing spaces corrupts them
    const clean = orig.replace(/"/g, '').trim()
    if (!clean || clean === 'x') return // Skip standalone 'x'
    const isFrac = clean.includes('/')
    const hasPulgMarker = /"|\bin\b|\bpulg\b|\bpulgadas?\b/i.test(orig)
    const num = parseSizeToDecimal(clean.replace(/\s+.*/, '')) // parse leading number only
    const hasUnit = /(?:mm|mt|mts|m|kg|kilos|cal)\b/i.test(orig)
    const isModelCode = isFrac && num >= 100
    // Only add to querySizes if:
    // - Has a fraction, pulgada marker, or 'x' (but not standalone)
    // - AND num is < 100 (avoid model numbers like 7018 being treated as sizes)
    // - AND not a thickness/caliber decimal (< 1.0 values that represent mm thickness)
    const isThickness = !isFrac && !hasPulgMarker && !clean.includes('x') && !isNaN(num) && num > 0 && num < 1.0
    if (!hasUnit && !isThickness && !isModelCode && (isFrac || hasPulgMarker || (clean.includes('x') && clean !== 'x') || (!isNaN(num) && num > 0 && num < 10))) {
      // For compound fractions like "7018 1/8", only add the fractional part
      // to avoid treating model numbers as sizes
      const fractPart = clean.match(/^\d{4,}\s+(\d+\/\d+)$/)
      const sizeKey = fractPart ? fractPart[1] : clean
      if (!querySizes.includes(sizeKey)) querySizes.push(sizeKey)
    }
  })

  if (querySizes.length > 0) {
    const productSizes = extractInchSizes(normalized)
    if (productSizes.length > 0) {
      const isConflict = querySizes.some(qs => {
        return productSizes.some(ps => {
          return sizesConflict(qs, ps)
        })
      })
      if (isConflict) {
        return { match: false, score: 0, coverage: 0, matchedTerms: 0, totalTerms: searchTerms.length }
      }
    }
  }

  let totalScore = 0
  let matchedTerms = 0

  for (const variantes of searchTerms) {
    let bestScore = 0
    let found = false
    const originalToken = variantes[0]

    for (const v of variantes) {
      const isXDim = /^\d+(?:\.\d+)?(?:mm|mt|mts|m)?(?:x\d+(?:\.\d+)?(?:mm|mt|mts|m)?)+\b/i.test(v)
      let isMatch = false
      if (isXDim) {
        const cleanV = v.replace(/[^0-9.x]/gi, '')
        const rawProductDims = normalized.match(/\b\d+(?:\.\d+)?(?:mm|mt|mts|m)?(?:x\d+(?:\.\d+)?(?:mm|mt|mts|m)?)+\b/gi) || []
        const productDims = rawProductDims.map(d => d.replace(/[^0-9.x]/gi, ''))
        isMatch = productDims.some(pd => !sizesConflict(cleanV, pd))
      } else {
        // Enforce word boundaries for numeric/caliber tokens to avoid substring matches like "20" inside "1200"
        const isNumeric = /^\d+(?:\.\d+)?$/.test(v)
        if (isNumeric) {
          const regex = new RegExp(`(?:^|[^0-9.])${v.replace(/[.]/g, '\\.')}(?:$|[^0-9.])`)
          isMatch = regex.test(normalized)
        } else {
          isMatch = normalized.includes(v.toLowerCase())
        }
      }

      if (isMatch) {
        found = true
        // Bonus por match exacto de palabra vs substring
        const isOriginal = (v === originalToken)
        const wordBoundary = new RegExp(`(^|[\\s.,;/\\-"'])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s.,;/\\-"'])`)
        const isWord = wordBoundary.test(normalized)
        
        let score = 10
        if (isOriginal) score += 5
        if (isWord) score += 5
        
        bestScore = Math.max(bestScore, score)
      }
    }

    if (found) {
      matchedTerms++
      totalScore += bestScore
    } else {
      // No encontrado exacto — intentar fuzzy
      const textForFuzzy = normalized.replace(/(?<!\d)\.|\.(?!\d)|[,\s;/\-"]/g, ' ')
      const words = textForFuzzy.split(/\s+/).filter(Boolean)
      let bestFuzzy = Infinity
      let fuzzyFound = false

      for (const v of variantes) {
        if (/\d/.test(v)) continue // No fuzzy for tokens containing digits
        const threshold = fuzzyThreshold(v)
        if (threshold === 0) continue // No fuzzy para tokens cortos

        for (const word of words) {
          const dist = levenshtein(v, word)
          if (dist <= threshold && dist < bestFuzzy) {
            bestFuzzy = dist
            fuzzyFound = true
          }
        }
      }

      if (fuzzyFound) {
        matchedTerms++
        totalScore += Math.max(1, 5 - bestFuzzy) // Menor score por fuzzy
      }
    }
  }

  if (matchedTerms === 0) return { match: false, score: 0 }

  // Score final: % de términos que matchearon * score acumulado
  const coverage = matchedTerms / searchTerms.length
  return {
    match: coverage >= 0.5, // Al menos 50% de los términos deben matchear (permite marcas/nombres no en DB)
    score: totalScore * coverage,
    coverage,
    matchedTerms,
    totalTerms: searchTerms.length,
  }
}

// ─── Búsqueda directa por código (sin tokenizar, máxima prioridad) ───────────
export function matchByCode(producto, rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return false
  const codigo = normalizeText(producto.codigo || '')
  if (!codigo) return false
  const q = normalizeText(rawQuery.trim())
  
  if (codigo === q) return true
  if (codigo.startsWith(q) && q.length >= 2) return true
  if (q.length >= 2 && codigo.includes(q)) return true
  
  const codLimpio = codigo.replace(/[^a-z0-9]/g, '')
  const qLimpio = q.replace(/[^a-z0-9]/g, '')
  if (qLimpio.length >= 2 && codLimpio.includes(qLimpio)) return true
  return false
}

// ─── Autocomplete matching — delegates completely to smartMatchScore ─────────
export function smartMatchProducto(producto, searchTerms, rawQuery = '') {
  if (!searchTerms || searchTerms.length === 0) return true
  if (rawQuery && matchByCode(producto, rawQuery)) return true

  const texto = `${producto.nombre || ''} ${producto.codigo || ''} ${producto.categoria || ''} ${producto.descripcion || ''}`
  const result = smartMatchScore(texto, searchTerms)
  return result.match
}

// ─── Búsqueda con ranking para listas de productos ───────────────────────────
export function smartSearchProductos(productos, query) {
  const searchTerms = parseSearchTerms(query)
  if (searchTerms.length === 0) return productos

  return productos
    .map(p => {
      const texto = `${p.nombre || ''} ${p.codigo || ''} ${p.categoria || ''} ${p.descripcion || ''}`
      const result = smartMatchScore(texto, searchTerms)
      return { ...p, _score: result.score, _match: result.match, _coverage: result.coverage }
    })
    .filter(p => p._match)
    .sort((a, b) => {
      // Primero por coverage (todos los términos encontrados primero)
      if (b._coverage !== a._coverage) return b._coverage - a._coverage
      // Luego por score
      if (b._score !== a._score) return b._score - a._score
      // Finalmente por stock
      return (b.stock_actual || 0) - (a.stock_actual || 0)
    })
}

// ─── Filtro PostgREST para Supabase ───────────────────────────────────────────
export function buildSmartFilter(query) {
  const terms = parseSearchTerms(query)
  if (terms.length === 0) return null

  return terms.map(variantes => {
    const conditions = variantes.flatMap(v => {
      // Limpiar caracteres especiales de PostgREST pero mantener fracciones y pulgadas
      const safe = v.replace(/[\\%_]/g, '').replace(/\./g, '*')
      if (!safe || safe.length < 1) return []
      return [
        `nombre.ilike.*${safe}*`,
        `codigo.ilike.*${safe}*`,
      ]
    })
    return conditions.join(',')
  }).filter(Boolean)
}

// ─── Utilidades Unificadas de OCR y Procesamiento de Listas ───────────────────
export function canonicalizeOcr(str) {
  if (!str) return ''
  return str.toUpperCase()
    .replace(/[ODQU0]/g, '0')
    .replace(/[ILTJ1]/g, '1')
    .replace(/[Z2]/g, '2')
    .replace(/[S35]/g, '3')
    .replace(/[A4]/g, '4')
    .replace(/[G6]/g, '6')
    .replace(/[B8]/g, '8')
    .replace(/[Y7]/g, '7')
}

export function findBestFuzzyCodeMatch(ocrCode, catalogProducts) {
  if (!ocrCode || ocrCode.length < 4) return null
  
  const ocrClean = ocrCode.toUpperCase().replace(/[^A-Z0-9]/g, '').trim()
  const ocrCanon = canonicalizeOcr(ocrClean)
  
  let bestMatch = null
  let minDistance = 99
  
  for (const p of catalogProducts) {
    if (!p.codigo) continue
    const catClean = p.codigo.toUpperCase().trim()
    
    // 1. Coincidencia exacta
    if (ocrClean === catClean) {
      return p
    }
    
    // 2. Coincidencia canonicalizada exacta
    const catCanon = canonicalizeOcr(catClean)
    if (ocrCanon === catCanon) {
      return p
    }
    
    // 3. Coincidencia por distancia de Levenshtein en códigos normalizados
    const dist = levenshtein(ocrCanon, catCanon)
    if (dist < minDistance && dist <= 3) {
      minDistance = dist
      bestMatch = p
    }
  }
  return bestMatch
}

export function parsearLineaCompletaInteligente(linea) {
  let text = linea.trim()
  if (!text || text.length < 3) return null

  // Collapser espacios alrededor de 'x' en dimensiones
  text = text.replace(/([\d"\/])\s*x\s*([\d"\/])/gi, '$1x$2')

  // Limpiar viñetas iniciales
  text = text.replace(/^[\s*\-•·▪]+/g, '').trim()

  // Filtro de ruido explícito para cabeceras y logos con tolerancia a errores de OCR
  const cleanLineForFilter = text.toUpperCase()
    .replace(/[0OQ]/g, '0')
    .replace(/[ÍI]/g, 'I')
    .replace(/[ÓO]/g, 'O')
  
  if (
    cleanLineForFilter.includes('LISTA DE PRECIOS') || 
    cleanLineForFilter.includes('CONSTRUACERO') || 
    cleanLineForFilter.includes('LISTO') || 
    cleanLineForFilter.includes('LISTOPOS') || 
    cleanLineForFilter.includes('RIF-') || 
    cleanLineForFilter.includes('PRODUCTOS') || 
    cleanLineForFilter.includes('CATEGORIAS') || 
    cleanLineForFilter.includes('DESCRIPCION') || 
    cleanLineForFilter.includes('PRECIO DETAL') || 
    cleanLineForFilter.includes('PRECIO MAYOR') || 
    cleanLineForFilter.includes('STOCK') || 
    cleanLineForFilter.includes('MAY.') || 
    cleanLineForFilter.includes('CODIGO') ||
    cleanLineForFilter === 'UND' ||
    /^\d+\s+[A-Z\s]+$/.test(cleanLineForFilter)
  ) {
    return null
  }

  let codigo = ''
  let nombre = ''
  let unidad = 'und'
  let costo = 0
  let precio = 0
  let cantidad = 1

  // 1. Extraer Cantidad al inicio (ej: "10 cabillas" o "01 atado")
  const matchCantInicio = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:und|unid|unidades|pzs|piezas|sacos|mts|metros|kg|kilos|barras|atado|atados|rollos|rollo|laminas|lamina|cajas|caja|x)?\s+/i)
  if (matchCantInicio) {
    cantidad = parseFloat(matchCantInicio[1].replace(',', '.'))
    text = text.replace(matchCantInicio[0], '').trim()
  } else {
    // Intentar cantidad al final
    const matchCantFin = text.match(/(?<!cal|c\/|calibre|esp|espesor|e=)\s+[\-–—/]?\s*(\d+(?:[.,]\d+)?)$/i)
    if (matchCantFin) {
      let cantStr = matchCantFin[1]
      const prevChar = text.charAt(matchCantFin.index - 1)
      if (prevChar !== '/' && prevChar !== '.') {
        if (cantStr.includes('.') && cantStr.split('.')[1].length === 3) {
          cantStr = cantStr.replace('.', '') // miles
        }
        cantidad = parseFloat(cantStr.replace(',', '.'))
        text = text.slice(0, matchCantFin.index).trim()
      }
    }
  }

  // 2. Extraer Código Alfanumérico Real (ej: ELE0433005)
  // Excluimos explícitamente palabras de medidas con sufijos (ej: 100mt, 12mt)
  let words = text.split(/[\s|]+/).map(w => w.trim().replace(/[▪•·*]/g, '')).filter(Boolean)
  let codeCandidate = ''

  for (let i = 0; i < words.length; i++) {
    const w = words[i].toUpperCase()
    
    const hasLetter = /[A-Z]/i.test(w)
    const hasDigit = /\d/.test(w)
    const matchesFormat = /^[A-Z0-9\-]+$/i.test(w)
    const isDimension = /\d+X/i.test(w) || /X\d+/i.test(w) || /^\d+\/\d+/.test(w) || /^\d+\.\d+$/.test(w)
    const isUnitSuffix = /\d+(?:mt|mts|m|mm|kg|kilos|cal|calibre)$/i.test(w)
    const endsWithX = w.endsWith('X')
    
    if (hasLetter && hasDigit && matchesFormat && !isDimension && !isUnitSuffix && !endsWithX && w.length >= 4 && w.length <= 15) {
      codeCandidate = words[i]
      break
    }
  }

  if (codeCandidate) {
    codigo = codeCandidate.toUpperCase().replace(/[^A-Z0-9\-]/g, '')
    text = text.replace(codeCandidate, '').trim()
  }

  // 3. Extraer Precios y Costos de forma segura (etiquetas explícitas o símbolos)
  const matchDolar = text.match(/\$\s*(\d+(?:[.,]\d+)?)/)
  if (matchDolar) {
    precio = parseFloat(matchDolar[1].replace(',', '.'))
    costo = precio
    text = text.replace(matchDolar[0], '').trim()
  } else {
    const matchCostoEtiqueta = text.match(/(?:costo|costos|c)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i)
    if (matchCostoEtiqueta) {
      costo = parseFloat(matchCostoEtiqueta[1].replace(',', '.'))
      text = text.replace(matchCostoEtiqueta[0], '').trim()
    }
    const matchPrecioEtiqueta = text.match(/(?:precio|pv|pvp|p)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i)
    if (matchPrecioEtiqueta) {
      precio = parseFloat(matchPrecioEtiqueta[1].replace(',', '.'))
      text = text.replace(matchPrecioEtiqueta[0], '').trim()
      if (costo === 0) costo = precio
    }
  }

  // 4. Limpiar nombre
  nombre = text
    .replace(/[—|\[\]\=\*▪•·_–]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Filtro final de ruido
  if (!codigo && cantidad === 1 && !nombre) {
    return null
  }

  return {
    codigo,
    nombre: nombre || 'PRODUCTO SIN NOMBRE',
    unidad,
    costo,
    precio,
    cantidad
  }
}

export function preprocesarImagenCanvas(imageSrc) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        
        let width = img.width
        let height = img.height
        const maxDim = 2000
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width)
            width = maxDim
          } else {
            width = Math.round((width * maxDim) / height)
            height = maxDim
          }
        }
        
        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)
        
        const imgData = ctx.getImageData(0, 0, width, height)
        const data = imgData.data
        
        const s = Math.max(8, Math.round(width / 16))
        const t = 12
        
        const gray = new Uint8Array(width * height)
        const integral = new Int32Array(width * height)
        
        for (let y = 0; y < height; y++) {
          let sum = 0
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4
            const r = data[idx]
            const g = data[idx + 1]
            const b = data[idx + 2]
            
            const grayVal = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
            gray[y * width + x] = grayVal
            
            sum += grayVal
            if (y === 0) {
              integral[y * width + x] = sum
            } else {
              integral[y * width + x] = integral[(y - 1) * width + x] + sum
            }
          }
        }
        
        const halfS = Math.round(s / 2)
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x
            const g = gray[idx]
            
            const x1 = Math.max(0, x - halfS)
            const x2 = Math.min(width - 1, x + halfS)
            const y1 = Math.max(0, y - halfS)
            const y2 = Math.min(height - 1, y + halfS)
            
            const count = (x2 - x1 + 1) * (y2 - y1 + 1)
            
            const a = integral[y2 * width + x2]
            const b = y1 > 0 ? integral[(y1 - 1) * width + x2] : 0
            const c = x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0
            const d = (y1 > 0 && x1 > 0) ? integral[(y1 - 1) * width + (x1 - 1)] : 0
            const sumVal = a - b - c + d
            
            const outIdx = idx * 4
            if (g * count < sumVal * (100 - t) / 100) {
              data[outIdx] = 0
              data[outIdx + 1] = 0
              data[outIdx + 2] = 0
            } else {
              data[outIdx] = 255
              data[outIdx + 1] = 255
              data[outIdx + 2] = 255
            }
            data[outIdx + 3] = 255
          }
        }
        
        ctx.putImageData(imgData, 0, 0)
        resolve(canvas)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = (err) => reject(err)
    img.src = imageSrc
  })
}
