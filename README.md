# Listo POS

Sistema de cotizaciones comerciales y facturación. Permite a los vendedores registrar clientes, construir cotizaciones con el inventario disponible y generar PDFs profesionales para compartir por WhatsApp.

## Stack

- **React 19** + **Vite** — Frontend
- **Tailwind CSS** — Estilos
- **Zustand** — Estado global (sesión y rol)
- **TanStack Query** — Estado del servidor (queries a Supabase)
- **Supabase** — Auth, base de datos Postgres, RLS
- **jsPDF + html2canvas** — Generación de PDFs

## Roles

| Rol | Capacidades |
|---|---|
| `supervisor` | Acceso total: clientes, cotizaciones, inventario, auditoría, usuarios, reasignaciones |
| `vendedor` | Sus propios clientes y cotizaciones. Solo lectura de inventario |

## Estructura del proyecto

```
src/
├── modules/
│   ├── auth/          # Login, sesión, protección de rutas
│   ├── customers/     # Clientes + reglas anti-robo
│   ├── quotes/        # Constructor de cotizaciones + versioning
│   ├── inventory/     # Consulta de productos (solo lectura para vendedor)
│   ├── carriers/      # Transportistas
│   ├── users/         # Gestión de usuarios (solo supervisor)
│   └── audit/         # Log de acciones (solo supervisor)
├── services/
│   ├── supabase/      # Cliente Supabase + tipos
│   ├── pdf/           # Generador de PDF
│   └── whatsapp/      # Helper de compartir por WhatsApp
├── store/             # Zustand stores
├── components/
│   ├── ui/            # Componentes genéricos reutilizables
│   └── layout/        # Navbar, Sidebar
├── views/             # Páginas completas
└── utils/
    ├── dinero.js      # Matemática financiera precisa
    └── dateHelpers.js # Formateo de fechas

supabase/
└── migrations/        # 15 migrations SQL (ver ARQUITECTURA.md)
```

## Despliegue (Producción)

La aplicación usa una arquitectura de dos capas:

| Capa | Servicio | URL |
|------|----------|-----|
| **Frontend** | Vercel | `https://listo-pos-cotizaciones.vercel.app` |
| **API Backend** | Cloudflare Worker | `https://listo-pos-api.luiggiberaldi94.workers.dev` |

### Cómo funciona

1. **Vercel** sirve el frontend (React + Vite build estático).
2. Las llamadas a `/api/*` se redirigen al **Cloudflare Worker** mediante `vercel.json` rewrites.
3. El Worker maneja autenticación JWT (Supabase), operaciones de BD con `service_role`, y lógica de negocio.

### Variables de entorno en Vercel

| Variable | Valor | Notas |
|----------|-------|-------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Clave anon pública |
| `VITE_WORKER_ORIGIN` | *(vacío o no definir)* | **Dejar vacío** para usar el proxy de `vercel.json` |

> **Importante sobre `VITE_WORKER_ORIGIN`:**
> - Si se deja **vacío o sin definir**, el frontend usa rutas relativas (`/api/...`) y Vercel las proxea al Worker automáticamente. Esta es la configuración recomendada.
> - Si se define (ej: `https://listo-pos-api.luiggiberaldi94.workers.dev`), el frontend llama al Worker directamente (cross-origin). El Worker ya tiene CORS configurado para `*.vercel.app`.

### Flujo de deploy

```bash
# Frontend → Vercel (auto-deploy al hacer push a GitHub)
git push origin main

# API → Cloudflare Worker (manual)
wrangler deploy --dispatch-namespace chiridion
```

### vercel.json

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://listo-pos-api.luiggiberaldi94.workers.dev/api/:path*" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

La primera regla proxea todas las llamadas API al Worker. La segunda es el fallback SPA para React Router.

## Configuración local

```bash
# 1. Instalar dependencias
bun install

# 2. Variables de entorno
cp .env.example .env
# Editar .env con las credenciales del proyecto Supabase

# 3. Ejecutar migrations en Supabase
# SQL Editor → ejecutar en orden 001 → 015

# 4. Iniciar dev server
bun run dev
```

En desarrollo local, el Worker corre en `localhost:8787` (via `wrangler dev`) y el frontend usa Vite proxy o `VITE_WORKER_ORIGIN=http://localhost:8787`.

## Documentación interna

- **`ARQUITECTURA.md`** — Esquema de BD, RLS, RPCs, reglas de negocio (v1.1)
- **`BITACORA.md`** — Registro cronológico de decisiones y sesiones de trabajo
