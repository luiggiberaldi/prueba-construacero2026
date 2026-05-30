import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

// Usar git commit hash como buster — el cache solo se invalida en deploys reales,
// no en cada reinicio del dev server (evita borrar datos offline innecesariamente)
let gitHash = 'dev'
try { gitHash = execSync('git rev-parse --short HEAD').toString().trim() } catch {}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(gitHash),
  },
  server: {
    proxy: {
      '/api': {
        // Proxy a la producción mientras wrangler local no funciona en Windows+Node22
        // Para usar el worker local: cambiar a 'http://localhost:8787'
        target: 'https://prueba-construacero2026.luiggiberaldi94.workers.dev',
        changeOrigin: true,
        secure: true,
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false,

      includeAssets: [
        'favicon.png',
        'logo.png',
        'logo-dark.png',
        'pwa-icon.png',
      ],

      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globIgnores: [
          '**/node_modules/**/*',
          '**/pdf-*.js',
          '**/pdf.*.js',
          '**/pdf-*.css',
          '**/pdf.*.css'
        ],
      },

      manifest: {
        name: 'Construacero Carabobo',
        short_name: 'Construacero',
        description: 'Sistema de cotizaciones y despachos',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0ea5e9',
        orientation: 'portrait-primary',
        icons: [
          { src: 'pwa-icon.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'pwa-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },

      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  test: {
    include: ['src/utils/__tests__/**/*.test.js'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons: ['lucide-react'],
          pdf: ['jspdf', 'html2canvas'],
          cloud: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
        }
      }
    }
  },
})
