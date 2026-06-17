# deploy.ps1 - Windows equivalent of deploy.sh
$ErrorActionPreference = "Stop"

if (!(Test-Path .env.secrets)) {
    Write-Host "⚠️ .env.secrets no encontrado - desplegando sin secrets" -ForegroundColor Yellow
    npm run build
    npx wrangler deploy
    exit 0
}

# Load secrets from .env.secrets
Get-Content .env.secrets | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        $name = $Matches[1].Trim()
        $value = $Matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($name, $value, [System.EnvironmentVariableTarget]::Process)
    }
}

Write-Host "🚀 Iniciando Build..." -ForegroundColor Cyan
npm run build

Write-Host "🚀 Iniciando Deploy..." -ForegroundColor Cyan
npx wrangler deploy `
  --var SUPABASE_SERVICE_KEY:"$($env:SUPABASE_SERVICE_KEY)" `
  --var VAPID_PUBLIC_KEY:"$($env:VAPID_PUBLIC_KEY)" `
  --var VAPID_PRIVATE_KEY:"$($env:VAPID_PRIVATE_KEY)" `
  --var GROQ_KEYS_A:"$($env:GROQ_KEYS_A)" `
  --var GROQ_KEYS_B:"$($env:GROQ_KEYS_B)" `
  --var GROQ_KEYS_C:"$($env:GROQ_KEYS_C)" `
  --var DEV_MASTER_PIN_4:"$($env:DEV_MASTER_PIN_4)" `
  --var DEV_MASTER_PIN_6:"$($env:DEV_MASTER_PIN_6)"

Write-Host "✅ Desplegado con secrets inyectados" -ForegroundColor Green
