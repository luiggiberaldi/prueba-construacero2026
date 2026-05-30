// src/store/useAuthStore.js
// Estado global de sesión y perfil de usuario
// Cuenta única de negocio en auth.users — operadores se identifican con PIN
// El JWT lleva operator_id y operator_rol en app_metadata
import { create } from 'zustand'
import supabase from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import queryClient from '../lib/queryClient'
import { descargarSnapshotsLocales } from '../lib/offlineSnapshots'
import { clearOfflineAuthToken, saveOfflineAuthToken } from '../lib/offlineAuthToken'

// ─── Mapear mensajes de error de Supabase a español ───────────────────────────
function traducirError(mensaje) {
  if (!mensaje) return 'Ocurrió un error inesperado'
  if (mensaje.includes('Invalid login credentials'))
    return 'Email o contraseña incorrectos'
  if (mensaje.includes('Email not confirmed'))
    return 'Debes confirmar tu email antes de entrar'
  if (mensaje.includes('Too many requests'))
    return 'Demasiados intentos. Espera unos minutos e intenta de nuevo'
  if (mensaje.includes('fetch') || mensaje.includes('network') || mensaje.includes('NetworkError'))
    return 'Error de conexión. Verifica tu internet e intenta de nuevo'
  return 'Error al iniciar sesión. Intenta de nuevo'
}

// ─── Helper: obtener token de sesión actual (con refresh si está expirado) ────
async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null
  saveOfflineAuthToken(data.session).catch(() => {})

  // Verificar si el token está próximo a expirar (menos de 60s de vida)
  const exp = data.session.expires_at // epoch en segundos
  if (exp && exp - Math.floor(Date.now() / 1000) < 60) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      saveOfflineAuthToken(refreshed?.session).catch(() => {})
      return refreshed?.session?.access_token ?? token
    } catch {
      return token // usar el que hay si falla el refresh
    }
  }
  return token
}

// ─── Cache por usuario en localStorage ────────────────────────────────────────
function getStorageKeys(userId) {
  const suffix = userId ? `-${userId}` : ''
  return {
    perfilKey: `listo_perfil_cache${suffix}`,
    operatorsKey: `listo_operators_cache${suffix}`
  }
}

const CACHE_MAX_AGE_PERFIL = 1000 * 60 * 60 * 24 // 24h
const CACHE_MAX_AGE_OPERATORS = 1000 * 60 * 60 * 24 * 7 // 7 días
const ACTIVE_OPERATOR_KEY = 'listo_active_operator_id'
const ACTIVE_ACCOUNT_KEY = 'listo_active_account_id'

function guardarScopeOperadorActivo(perfil, userId) {
  if (perfil?.id && userId) {
    localStorage.setItem(ACTIVE_OPERATOR_KEY, perfil.id)
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, userId)
  } else {
    localStorage.removeItem(ACTIVE_OPERATOR_KEY)
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
  }
}

function guardarPerfilCache(perfil, userId) {
  try {
    const { perfilKey } = getStorageKeys(userId)
    if (perfil) {
      localStorage.setItem(perfilKey, JSON.stringify({ ...perfil, _cachedAt: Date.now() }))
      guardarScopeOperadorActivo(perfil, userId)
    } else {
      localStorage.removeItem(perfilKey)
      guardarScopeOperadorActivo(null, userId)
    }
  } catch { /* ignorar */ }
}

function leerPerfilCache(userId) {
  try {
    const { perfilKey } = getStorageKeys(userId)
    const raw = localStorage.getItem(perfilKey)
    if (!raw) return null
    const cached = JSON.parse(raw)
    // Invalidar si tiene más de 24h
    if (cached._cachedAt && Date.now() - cached._cachedAt > CACHE_MAX_AGE_PERFIL) {
      localStorage.removeItem(perfilKey)
      return null
    }
    return cached
  } catch { return null }
}

function guardarOperadoresCache(operators, userId) {
  try {
    const { operatorsKey } = getStorageKeys(userId)
    if (Array.isArray(operators) && operators.length > 0) {
      localStorage.setItem(operatorsKey, JSON.stringify({ operators, _cachedAt: Date.now() }))
    }
  } catch { /* ignorar */ }
}

function leerOperadoresCache(userId) {
  try {
    const { operatorsKey } = getStorageKeys(userId)
    const raw = localStorage.getItem(operatorsKey)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (cached._cachedAt && Date.now() - cached._cachedAt > CACHE_MAX_AGE_OPERATORS) {
      localStorage.removeItem(operatorsKey)
      return null
    }
    return cached.operators ?? null
  } catch { return null }
}

// ─── Fallback en JS Puro para PBKDF2-SHA256 (cuando crypto.subtle no está disponible en HTTP) ───
function sha256Fallback(bytes) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const asciiBitLength = bytes.length * 8;
  const padLength = (64 - ((bytes.length + 1 + 8) % 64)) % 64;
  const msgBytes = new Uint8Array(bytes.length + 1 + padLength + 8);
  msgBytes.set(bytes);
  msgBytes[bytes.length] = 0x80;
  const view = new DataView(msgBytes.buffer);
  view.setUint32(msgBytes.length - 4, asciiBitLength);
  const words = new Uint32Array(64);
  for (let i = 0; i < msgBytes.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      words[j] = view.getUint32(i + j * 4);
    }
    for (let j = 16; j < 64; j++) {
      const w15 = words[j - 15];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const w2 = words[j - 2];
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      words[j] = (words[j - 16] + s0 + words[j - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + words[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0);
  outView.setUint32(4, h1);
  outView.setUint32(8, h2);
  outView.setUint32(12, h3);
  outView.setUint32(16, h4);
  outView.setUint32(20, h5);
  outView.setUint32(24, h6);
  outView.setUint32(28, h7);
  return out;
}

function hmacSha255Fallback(key, message) {
  const enc = new TextEncoder();
  let keyBytes = typeof key === 'string' ? enc.encode(key) : key;
  let messageBytes = typeof message === 'string' ? enc.encode(message) : message;
  if (keyBytes.length > 64) {
    keyBytes = sha256Fallback(keyBytes);
  }
  const paddedKey = new Uint8Array(64);
  paddedKey.set(keyBytes);
  const oKeyPad = new Uint8Array(64);
  const iKeyPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }
  const innerMsg = new Uint8Array(64 + messageBytes.length);
  innerMsg.set(iKeyPad);
  innerMsg.set(messageBytes, 64);
  const innerHash = sha256Fallback(innerMsg);
  const outerMsg = new Uint8Array(64 + 32);
  outerMsg.set(oKeyPad);
  outerMsg.set(innerHash, 64);
  return sha256Fallback(outerMsg);
}

function pbkdf2Sha256Fallback(password, salt, iterations, keyLen) {
  const enc = new TextEncoder();
  const passwordBytes = typeof password === 'string' ? enc.encode(password) : password;
  const saltBytes = typeof salt === 'string' ? enc.encode(salt) : salt;
  const result = new Uint8Array(keyLen);
  let offset = 0;
  let blockNum = 1;
  while (offset < keyLen) {
    const blockSalt = new Uint8Array(saltBytes.length + 4);
    blockSalt.set(saltBytes);
    const view = new DataView(blockSalt.buffer);
    view.setUint32(saltBytes.length, blockNum, false);
    let u = hmacSha255Fallback(passwordBytes, blockSalt);
    const t = new Uint8Array(u);
    for (let i = 1; i < iterations; i++) {
      u = hmacSha255Fallback(passwordBytes, u);
      for (let j = 0; j < t.length; j++) {
        t[j] ^= u[j];
      }
    }
    const chunkLen = Math.min(t.length, keyLen - offset);
    result.set(t.subarray(0, chunkLen), offset);
    offset += chunkLen;
    blockNum++;
  }
  return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Validación local de PIN con PBKDF2 (mismo algoritmo que el worker) ────────
// Usa WebCrypto API del browser — mismos parámetros: 10k iter, SHA-256, 256 bits
async function hashPinPBKDF2(pin, salt) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 10_000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyPinLocal(pin, storedHash, storedSalt) {
  try {
    console.log('[AUTH] Iniciando verificación local de PIN...')
    let hash;
    if (crypto?.subtle) {
      hash = await hashPinPBKDF2(pin, storedSalt)
    } else {
      console.warn('[AUTH] WARNING: crypto.subtle no está disponible. Usando fallback de PBKDF2 en JS puro.')
      hash = pbkdf2Sha256Fallback(pin, storedSalt, 10_000, 32)
    }
    const matched = hash === storedHash
    console.log('[AUTH] Verificación de PIN completada:', { matched, pinLength: pin.length })
    return matched
  } catch (err) {
    console.error('[AUTH] Error en verificación de PIN local:', err)
    return false
  }
}

// ─── Descargar y cachear operadores en background ────────────────────────────
async function fetchAndCacheOperators(token, userId) {
  try {
    const res = await fetch(apiUrl('/api/auth/operators'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const { operators } = await res.json()
    if (Array.isArray(operators) && operators.length > 0) {
      guardarOperadoresCache(operators, userId)
      console.log('[AUTH] operadores cacheados para uso offline:', operators.length)
    }
  } catch { /* ignorar — no crítico */ }
}

// ─── Store ────────────────────────────────────────────────────────────────────
const useAuthStore = create((set, get) => ({
  // Estado
  user: null,          // Objeto auth.user de Supabase (cuenta del negocio)
  perfil: null,        // { id, nombre, email, rol, activo, color } del operador activo
  loading: false,
  error: null,
  initialized: false,  // true una vez que se verificó la sesión inicial
  offlineManual: localStorage.getItem('listo_offline_manual') === 'true',
  offlineFisico: !navigator.onLine,
  offline: localStorage.getItem('listo_offline_manual') === 'true' || !navigator.onLine,
  _cargandoPerfil: false,
  _logoutManual: false,
  _refreshingToken: false, // guard para evitar múltiples refreshSession concurrentes

  // ─── Inicializar: suscribirse a cambios de auth ────────────────────────────
  initialize: () => {
    console.log('[AUTH] initialize() llamado')
    // Detectar si hay sesión guardada para dar más tiempo
    let haySession = false
    try {
      const keys = Object.keys(localStorage)
      const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (sbKey && localStorage.getItem(sbKey)) haySession = true
    } catch { /* ignorar */ }
    console.log('[AUTH] haySession:', haySession)

    // ── Offline awareness ──
    // Obtener userId de la sesión (si existe) para leer cache correcto
    let currentUserId = null
    try {
      const keys = Object.keys(localStorage)
      const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (sbKey) {
        const sbData = JSON.parse(localStorage.getItem(sbKey))
        currentUserId = sbData?.user?.id
      }
    } catch { /* ignorar */ }

    const manualOffline = localStorage.getItem('listo_offline_manual') === 'true'
    const estaOffline = !navigator.onLine
    const perfilCacheado = leerPerfilCache(currentUserId)
    set({
      offlineFisico: estaOffline,
      offlineManual: manualOffline,
      offline: manualOffline || estaOffline
    })

    if (estaOffline && perfilCacheado) {
      console.log('[AUTH] offline detectado con perfil cacheado — modo sin conexión activado')
      // No limpiar el cache — se restaurará en INITIAL_SESSION
    }
    // El cache NO se borra online: persiste hasta logout/switchOut explícito.
    // Esto permite el fallback en switchOperator cuando la red falla.

    // Listeners de conectividad
    const handleOnline = () => {
      console.log('[AUTH] conexión física restaurada')
      set({ offlineFisico: false })
      const manual = get().offlineManual
      set({ offline: manual })
      if (!manual) {
        set({ error: null })
        queryClient.invalidateQueries()
        const p = get().perfil
        if (p) descargarSnapshotsLocales(p).catch(() => {})
      }
    }
    const handleOffline = () => {
      console.log('[AUTH] conexión física perdida')
      set({ offlineFisico: true, offline: true })
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const timeoutId = setTimeout(() => {
      const state = get()
      console.log('[AUTH] timeout principal disparado — initialized:', state.initialized, 'user:', !!state.user, 'perfil:', !!state.perfil)
      if (!state.initialized) {
        console.log('[AUTH] forzando initialized=true por timeout')
        set({ initialized: true })
      }
    }, haySession ? 3000 : 1500)

    // Segundo timeout: si hay user pero no perfil después de 12s, limpiar para evitar loop
    const safetyTimeoutId = setTimeout(() => {
      const { user, perfil, initialized } = get()
      console.log('[AUTH] safety timeout — initialized:', initialized, 'user:', !!user, 'perfil:', !!perfil)
      if (user && !perfil) {
        console.log('[AUTH] safety: user sin perfil, forzando perfil=null')
        set({ initialized: true, perfil: null })
      }
    }, 6000)

    console.log('[AUTH] registrando onAuthStateChange...')
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AUTH] evento:', event, 'session:', !!session, 'user:', session?.user?.email)
        if (event === 'INITIAL_SESSION') {
          try {
            if (session?.user) {
              saveOfflineAuthToken(session).catch(() => {})
              console.log('[AUTH] INITIAL_SESSION con user, seteando user...')
              // Si estamos offline y hay perfil cacheado válido, restaurarlo
              // El usuario ya se autentricó con PIN antes — puede continuar offline
              const offline = !navigator.onLine
              const cached = leerPerfilCache(session.user.id)
              if (offline && cached) {
                console.log('[AUTH] modo offline: restaurando perfil cacheado —', cached.nombre, '/', cached.rol)
                guardarPerfilCache(cached, session.user.id)
                set({ user: session.user, perfil: cached, _cargandoPerfil: false })
              } else {
                // Online: solo setear user, NO cargar perfil automáticamente (requiere PIN)
                set({ user: session.user, _cargandoPerfil: false })
                getAccessToken()
                  .then(token => { if (token) fetchAndCacheOperators(token, session.user.id) })
                  .catch(() => {})
              }
            } else {
              console.log('[AUTH] INITIAL_SESSION sin user (no hay sesión)')
            }
          } catch (err) {
            console.log('[AUTH] error en INITIAL_SESSION:', err.message)
          } finally {
            clearTimeout(timeoutId)
            clearTimeout(safetyTimeoutId)
            console.log('[AUTH] seteando initialized=true')
            set({ initialized: true, _cargandoPerfil: false })
          }
        }

        if (event === 'SIGNED_IN' && session?.user) {
          saveOfflineAuthToken(session).catch(() => {})
          // Solo actualizar user si cambió (evitar re-renders innecesarios)
          const currentUser = get().user
          if (!currentUser || currentUser.id !== session.user.id) {
            set({ user: session.user })
          }
          if (!navigator.onLine) {
            // Offline: no fetch
          } else {
            getAccessToken()
              .then(token => { if (token) fetchAndCacheOperators(token, session.user.id) })
              .catch(() => {})
          }
          // SEGURIDAD: NO cargar perfil automáticamente desde metadata.
          // El perfil solo se establece a través de switchOperator() (PIN).
        }

        if (event === 'SIGNED_OUT') {
          // Si estamos offline y no fue un logout manual, ignorar el SIGNED_OUT.
          // Supabase puede disparar este evento cuando falla el refresco del token por red,
          // lo que borraría el cache y expulsaría al usuario innecesariamente.
          const esManual = get()._logoutManual
          if (!navigator.onLine && !esManual) {
            console.log('[AUTH] SIGNED_OUT ignorado — offline y no fue logout manual')
            return
          }
          const wasLoggedIn = get().user !== null && !esManual
          const userId = get().user?.id
          clearOfflineAuthToken().catch(() => {})
          guardarPerfilCache(null, userId)
          set({ user: null, perfil: null, error: null, _logoutManual: false })
          if (wasLoggedIn) {
            set({ error: 'Tu sesión ha expirado. Inicia sesión nuevamente para no perder tu trabajo.' })
          }
        }

        if (event === 'TOKEN_REFRESHED' && session?.user) {
          saveOfflineAuthToken(session).catch(() => {})
          // Solo actualizar user si realmente cambió (evitar re-renders innecesarios)
          const currentUser = get().user
          if (!currentUser || currentUser.id !== session.user.id || currentUser.email !== session.user.email) {
            set({ user: session.user })
          }
          // SEGURIDAD: NO cargar perfil automáticamente.
          // Si el perfil ya está seteado (por switchOperator), se mantiene.
        }
      }
    )

    return () => {
      clearTimeout(timeoutId)
      clearTimeout(safetyTimeoutId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      subscription.unsubscribe()
    }
  },

  // Acción para conmutar offline manual
  setOfflineManual: (val) => {
    localStorage.setItem('listo_offline_manual', String(val))
    const fisico = get().offlineFisico
    set({ offlineManual: val, offline: val || fisico })

    if (!val && !fisico) {
      set({ error: null })
      queryClient.invalidateQueries()
      const p = get().perfil
      if (p) descargarSnapshotsLocales(p).catch(() => {})
    }
  },

  // ─── Cargar perfil del operador desde public.usuarios ──────────────────────
  // Lee operator_id de app_metadata. Si no hay → perfil queda null (requiere selección).
  _cargarPerfil: async (authUser) => {
    const operatorId = authUser.app_metadata?.operator_id
    if (!operatorId) {
      // Hay sesión de negocio pero no se ha seleccionado operador
      set({ user: authUser, perfil: null, error: null })
      return
    }

    // Desarrollador — no existe en tabla usuarios, perfil sintético
    if (operatorId === '00000000-0000-0000-0000-000000000000') {
      const perfilDev = {
        id: operatorId,
        nombre: 'Desarrollador',
        email: authUser.email,
        rol: 'desarrollador',
        activo: true,
        color: '#8b5cf6',
        _isSuperAdmin: true,
      }
      guardarPerfilCache(perfilDev, authUser.id)
      set({ user: authUser, perfil: perfilDev, error: null })
      return
    }

    const queryPromise = supabase
      .from('usuarios')
      .select('id, nombre, rol, activo, color, markup_pct, comision_pct, comision_pct_cabilla, es_externo')
      .eq('id', operatorId)
      .single()

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout_perfil')), 5000)
    )

    const { data, error } = await Promise.race([queryPromise, timeoutPromise])
      .catch(err => ({ data: null, error: err }))

    if (error || !data) {
      guardarPerfilCache(null, authUser.id)
      set({
        user: authUser,
        perfil: null,
        error: 'Operador no encontrado. Selecciona otro operador.',
      })
      return
    }

    if (!data.activo) {
      // Operador desactivado — limpiar metadata y volver a selección
      try {
        const token = await getAccessToken()
        if (token) {
          await fetch(apiUrl('/api/auth/clear-operator'), {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
        }
      } catch { /* ignorar */ }
      guardarPerfilCache(null, authUser.id)
      set({
        user: authUser,
        perfil: null,
        error: 'Este operador está desactivado. Contacta al supervisor.',
      })
      return
    }

    const perfilNuevo = {
      id: data.id,
      nombre: data.nombre,
      email: authUser.email,
      rol: data.rol,
      activo: data.activo,
      color: data.color ?? null,
      markup_pct: data.markup_pct ?? null,
      comision_pct: data.comision_pct ?? null,
      comision_pct_cabilla: data.comision_pct_cabilla ?? null,
      es_externo: !!data.es_externo,
    }
    // Solo actualizar si el perfil realmente cambió (evitar re-renders innecesarios)
    const perfilActual = get().perfil
    if (
      perfilActual &&
      perfilActual.id === perfilNuevo.id &&
      perfilActual.rol === perfilNuevo.rol &&
      perfilActual.nombre === perfilNuevo.nombre &&
      perfilActual.color === perfilNuevo.color &&
      perfilActual.markup_pct === perfilNuevo.markup_pct &&
      perfilActual.comision_pct === perfilNuevo.comision_pct &&
      perfilActual.es_externo === perfilNuevo.es_externo
    ) {
      return // perfil idéntico, no disparar re-render
    }
    guardarPerfilCache(perfilNuevo, authUser.id)
    set({ user: authUser, perfil: perfilNuevo, error: null })
  },

  // ─── Login del negocio (email + contraseña) ───────────────────────────────
  login: async (email, password) => {
    if (get().loading) return { ok: false }

    set({ loading: true, error: null, _cargandoPerfil: true })

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      set({ loading: false, error: traducirError(error.message), _cargandoPerfil: false })
      return { ok: false }
    }

    // Setear user — el perfil SOLO se establece al seleccionar operador con PIN
    set({ user: data.user, loading: false, _cargandoPerfil: false, error: null })

    // Descargar operadores en background para cache offline
    const userId = data.user.id
    getAccessToken()
      .then(token => { if (token) fetchAndCacheOperators(token, userId) })
      .catch(() => { /* ignorar */ })

    return { ok: true }
  },

  // ─── Seleccionar operador con PIN ─────────────────────────────────────────
  switchOperator: async (operatorId, pin) => {
    if (get().loading) return { ok: false }

    set({ loading: true, error: null })

    // Helper para hacer la llamada al worker
    const callWorker = async (token) => {
      return fetch(apiUrl('/api/auth/switch-operator'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ operator_id: operatorId, pin }),
      })
    }

    try {
      if (get().offline) {
        throw new TypeError('Offline')
      }
      let token = await getAccessToken()
      if (!token) {
        set({ loading: false, error: 'No hay sesión activa. Inicia sesión primero.' })
        return { ok: false }
      }

      let res = await callWorker(token)
      let result = await res.json()

      // Si el worker responde 401 "No autenticado" → sesión expirada
      // Intentar refrescar el token y reintentar una vez
      if (!res.ok && res.status === 401 && result.error?.includes('autenticado')) {
        console.log('[AUTH] switchOperator: sesión expirada, intentando refresh...')
        try {
          const { data: refreshData } = await supabase.auth.refreshSession()
          const freshToken = refreshData?.session?.access_token
          if (freshToken) {
            saveOfflineAuthToken(refreshData.session).catch(() => {})
            set({ user: refreshData.user })
            res = await callWorker(freshToken)
            result = await res.json()
          } else {
            // Refresh falló — forzar logout completo
            console.log('[AUTH] switchOperator: refresh falló, forzando logout')
            guardarPerfilCache(null, get().user?.id)
            set({ user: null, perfil: null, loading: false, error: 'Tu sesión expiró. Inicia sesión nuevamente.' })
            await supabase.auth.signOut()
            return { ok: false }
          }
        } catch {
          guardarPerfilCache(null, get().user?.id)
          set({ user: null, perfil: null, loading: false, error: 'Tu sesión expiró. Inicia sesión nuevamente.' })
          await supabase.auth.signOut()
          return { ok: false }
        }
      }

      if (!res.ok) {
        // Si el worker está caído (500) → intentar validación offline con cache
        // Esto evita falsos "PIN incorrecto" cuando wrangler no corre localmente
        if (res.status === 500) {
          throw new Error('worker_unavailable')
        }
        set({ loading: false, error: result.error || 'PIN incorrecto' })
        return { ok: false }
      }

      // Setear perfil inmediatamente con datos del worker (sin esperar refresh)
      const op = result.operator
      if (op) {
        // Invalidar queries sensibles al operador (no borrar todo el cache)
        queryClient.invalidateQueries({ queryKey: ['cotizaciones'] })
        queryClient.invalidateQueries({ queryKey: ['despachos'] })
        queryClient.invalidateQueries({ queryKey: ['comisiones'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard_metricas'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard_metrics'] })
        queryClient.invalidateQueries({ queryKey: ['cuentas_por_cobrar'] })

        const perfilOp = {
          id: op.id,
          nombre: op.nombre,
          email: get().user?.email,
          rol: op.rol,
          activo: true,
          color: op.color ?? null,
          markup_pct: op.markup_pct ?? null,
          comision_pct: op.comision_pct ?? null,
          comision_pct_cabilla: op.comision_pct_cabilla ?? null,
          es_externo: !!op.es_externo,
        }
        guardarPerfilCache(perfilOp, get().user?.id)
        set({ perfil: perfilOp, loading: false, error: null })
        // Descargar snapshots locales al cambiar operador exitosamente (background)
        descargarSnapshotsLocales(perfilOp).catch(() => {})

        // Refrescar operadores cache
        const userId = get().user?.id
        if (userId) {
          fetchAndCacheOperators(token, userId).catch(() => {})
        }
      }

      // Refrescar JWT en background — no bloquear al usuario
      // Guard: solo un refresh concurrente a la vez para evitar bucle de eventos
      if (!get()._refreshingToken) {
        set({ _refreshingToken: true })
        supabase.auth.refreshSession()
          .then(({ data }) => { if (data?.user) set({ user: data.user }) })
          .catch(() => { /* ignorar — perfil ya está seteado */ })
          .finally(() => set({ _refreshingToken: false }))
      }

      return { ok: true }
    } catch (err) {
      // Error de red — intentar validación local con PBKDF2 usando operadores cacheados
      const userId = get().user?.id
      const operators = leerOperadoresCache(userId)
      const op = operators?.find(o => o.id === operatorId)

      console.log('[AUTH] Validando PIN offline:', {
        userId,
        operatorsCount: operators?.length || 0,
        opEncontrado: !!op,
        tieneHash: !!op?.pin_hash,
        tieneSalt: !!op?.pin_salt
      })

      if (op && op.pin_hash && op.pin_salt) {
        const pinValido = await verifyPinLocal(pin, op.pin_hash, op.pin_salt)
        if (pinValido) {
          const perfilOp = {
            id: op.id,
            nombre: op.nombre,
            email: get().user?.email,
            rol: op.rol,
            activo: true,
            color: op.color ?? null,
            markup_pct: op.markup_pct ?? null,
            comision_pct: op.comision_pct ?? null,
            comision_pct_cabilla: op.comision_pct_cabilla ?? null,
            es_externo: !!op.es_externo,
            _offline: true,
          }
          guardarPerfilCache(perfilOp, userId)
          set({ perfil: perfilOp, loading: false, error: null })
          console.log('[AUTH] PIN validado localmente (offline) —', op.nombre)
          return { ok: true, offline: true }
        }
        // PIN incorrecto — validación local determinó que es incorrecto
        set({ loading: false, error: 'PIN incorrecto' })
        return { ok: false }
      }

      // No hay cache de operadores — no se puede validar offline
      set({
        loading: false,
        error: !navigator.onLine
          ? 'Sin conexión. Conecta a internet la primera vez para habilitar el modo offline.'
          : 'Error de conexión. Verifica tu internet e intenta de nuevo.',
      })
      return { ok: false }
    }
  },

  // ─── Cambiar de operador (volver a selección) ─────────────────────────────
  switchOut: async () => {
    set({ loading: true, error: null })

    try {
      const token = await getAccessToken()
      if (token) {
        await fetch(apiUrl('/api/auth/clear-operator'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }

      // Refrescar para limpiar app_metadata del JWT
      await supabase.auth.refreshSession()

      // Limpiar cache de datos del operador anterior
      queryClient.clear()
      const userId = get().user?.id
      guardarPerfilCache(null, userId)
      set({ perfil: null, loading: false, error: null })
    } catch {
      guardarPerfilCache(null, get().user?.id)
      set({ perfil: null, loading: false })
    }
  },

  // ─── Reset de contraseña (email) ───────────────────────────────────────────
  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { ok: !error, error: error?.message }
  },

  // ─── Logout completo ─────────────────────────────────────────────────────
  logout: async () => {
    // Limpiar operador antes de cerrar sesión
    try {
      const token = await getAccessToken()
      if (token) {
        await fetch(apiUrl('/api/auth/clear-operator'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch { /* ignorar */ }

    set({ _logoutManual: true })
    const userId = get().user?.id
    await supabase.auth.signOut()
    clearOfflineAuthToken().catch(() => {})
    guardarPerfilCache(null, userId)
    set({ user: null, perfil: null, error: null, _logoutManual: false })
  },

  // ─── Limpiar error manualmente ─────────────────────────────────────────────
  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
