// src/main.jsx
// Punto de entrada de la aplicación
// Los providers (QueryClient, BrowserRouter) viven en App.jsx
// para que AppRoutes pueda usar useEffect allí mismo
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './modo-accesible.css'

// Manejar errores de carga de chunks dinámicos (cuando hay un nuevo despliegue y los hashes de los assets cambian)
window.addEventListener('error', (e) => {
  const msg = e.message || '';
  const isChunkError = 
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK') && String(e.target.src || e.target.href).includes('/assets/'));
  const isOffline = !navigator.onLine || localStorage.getItem('listo_offline_manual') === 'true';
  if (isChunkError && !isOffline) {
    console.warn('Fallo de importación dinámica detectado. Recargando página...');
    window.location.reload();
  }
}, true);

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  const isChunkError = 
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module');
  const isOffline = !navigator.onLine || localStorage.getItem('listo_offline_manual') === 'true';
  if (isChunkError && !isOffline) {
    console.warn('Fallo de importación dinámica detectado en promesa. Recargando página...');
    window.location.reload();
  }
});

// Aplicar modo accesible antes del render para evitar flash visual
if (localStorage.getItem('modo-accesible') === '1') {
  document.documentElement.classList.add('modo-accesible')
}

// Evitar que scroll con rueda del mouse cambie valores en inputs numéricos
document.addEventListener('wheel', (e) => {
  if (e.target?.type === 'number') e.target.blur()
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Registrar Service Worker (push notifications; el caché de datos de React Query
// se persiste en IndexedDB vía PersistQueryClientProvider en App.jsx)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    } catch (err) {
      console.error('Error registrando el Service Worker', err)
    }
  })
}
