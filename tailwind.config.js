/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    screens: {
      'xs': '400px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {

        // ─────────────────────────────────────────────────────
        // 🎨 LISTO POS — PALETA PROFESIONAL
        // Navy Institucional + Dorado Bronce (refinada)
        // ─────────────────────────────────────────────────────

        // 1. PRIMARIO — Navy Institucional (botones, nav, foco)
        primary: {
          DEFAULT: '#1B365D', // Navy profundo — botón principal
          hover:   '#142A4A', // hover más oscuro
          light:   '#EDF2F7', // fondo suave (badges, highlights)
          focus:   '#90B4D2', // anillo de foco en inputs
          dark:    '#0E1F38', // pressed / active state
        },

        // 2. ACENTO DORADO BRONCE (énfasis, precios, CTA secundarios)
        accent: {
          DEFAULT: '#B8860B', // Dorado bronce — más sobrio y profesional
          hover:   '#9A7209', // hover bronce oscuro
          light:   '#FBF5E6', // fondo dorado muy suave
          focus:   '#E8D5A3', // anillo dorado suave
          dark:    '#7A5A07', // bronce profundo
        },

        // 3. FONDOS DE PANTALLA
        app: {
          light: '#F7F8FA', // Gris cálido — fondo general
          dark:  '#0E1A2E', // Navy profundo — modo oscuro
        },

        // 4. FONDOS DE TARJETAS / MODALES / SIDEBAR
        surface: {
          light: '#FFFFFF',
          dark:  '#152238', // Navy panel
        },

        // 5. TEXTOS
        content: {
          main:      '#1A2332', // Navy oscuro — títulos (alta legibilidad)
          secondary: '#5A6B7F', // Gris azulado — subtítulos
          inverse:   '#F7F8FA', // Texto claro sobre fondos oscuros
        },

        // 6. ESTADOS SEMÁNTICOS
        status: {
          success:   '#0D9668',
          successBg: '#D1FAE5',
          danger:    '#DC2626',
          dangerBg:  '#FEE2E2',
          warning:   '#D97706',
          warningBg: '#FEF3C7',
        },

        // 7. BORDES Y SEPARADORES
        border: {
          subtle: '#E2E6EC',
          focus:  '#1B365D', // Navy — borde activo en inputs
        },

        // ─────────────────────────────────────────────────────
        // 🔄 ALIASES — Compatibilidad con código existente
        // ─────────────────────────────────────────────────────

        brand: {
          light:   '#EDF2F7',
          DEFAULT: '#1B365D',
          dark:    '#0E1F38',
        },

        background: {
          light: '#F7F8FA',
          dark:  '#0E1A2E',
        },

        // blue → navy institucional
        blue: {
          50:  '#EDF2F7',
          100: '#D4DEE9',
          200: '#A8BDD4',
          300: '#7D9CBE',
          400: '#517BA9',
          500: '#1B365D',
          600: '#142A4A',
          700: '#0E1F38',
          800: '#091525',
          900: '#050B13',
          950: '#02060A',
        },

        // indigo → navy (compatibilidad)
        indigo: {
          50:  '#EDF2F7',
          100: '#D4DEE9',
          200: '#A8BDD4',
          300: '#7D9CBE',
          400: '#517BA9',
          500: '#1B365D',
          600: '#142A4A',
          700: '#0E1F38',
          800: '#091525',
          900: '#050B13',
          950: '#02060A',
        },

        // sky → navy
        sky: {
          50:  '#EDF2F7',
          100: '#D4DEE9',
          200: '#A8BDD4',
          300: '#7D9CBE',
          400: '#517BA9',
          500: '#1B365D',
          600: '#142A4A',
          700: '#0E1F38',
          800: '#091525',
          900: '#050B13',
        },

        // purple → navy
        purple: {
          50:  '#EDF2F7',
          100: '#D4DEE9',
          400: '#517BA9',
          500: '#1B365D',
          600: '#142A4A',
          700: '#0E1F38',
        },

        // teal → dorado bronce
        teal: {
          50:  '#FBF5E6',
          100: '#F5E8C4',
          200: '#E8D5A3',
          300: '#DBC282',
          400: '#CEAF61',
          500: '#B8860B',
          600: '#9A7209',
          700: '#7A5A07',
          800: '#5B4305',
          900: '#3B2C03',
        },

        // slate (neutros)
        slate: {
          50:  '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#020617',
        },

        // emerald — success
        emerald: {
          50:  '#ECFDF5',
          100: '#D1FAE5',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          900: '#064E3B',
        },

        // red — danger
        red: {
          50:  '#FFF1F2',
          100: '#FFE4E6',
          400: '#FB7185',
          500: '#F43F5E',
          600: '#E11D48',
          900: '#881337',
        },

        // amber — warning
        amber: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          900: '#78350F',
        },

        // rose → danger (compatibilidad)
        rose: {
          50:  '#FFF1F2',
          100: '#FFE4E6',
          400: '#FB7185',
          500: '#F43F5E',
          600: '#E11D48',
        },
      },

      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },

      animation: {
        'fade-in':        'fadeIn 0.3s ease-out',
        'slide-up':       'slideUp 0.4s ease-out',
        'spin-slow':      'spin 1s linear infinite',
        'slide-in-left':  'slideInLeft 0.3s ease-out',
        'slide-out-left': 'slideOutLeft 0.2s ease-in forwards',
      },

      keyframes: {
        fadeIn:       { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp:      { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideInLeft:  { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(0)' } },
        slideOutLeft: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-100%)' } },
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.font-numbers': {
          'font-variant-numeric': 'tabular-nums',
          'letter-spacing': '-0.02em',
        },
        '.scrollbar-hide': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
        '.custom-scrollbar': {
          '&::-webkit-scrollbar': { width: '4px', height: '4px' },
          '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '&::-webkit-scrollbar-thumb': { backgroundColor: '#CBD5E1', borderRadius: '2px' },
        },
      })
    },
  ],
}
