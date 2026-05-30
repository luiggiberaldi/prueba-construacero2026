import fs from 'fs'

const getEnvVar = (file, name) => {
  try {
    const content = fs.readFileSync(file, 'utf-8')
    const match = content.match(new RegExp(`${name}=(.*)`))
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

const SUPABASE_URL = getEnvVar('.env', 'VITE_SUPABASE_URL')
const SERVICE_KEY = getEnvVar('.env.secrets', 'SUPABASE_SERVICE_KEY')
const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

async function run() {
  console.log("=== BUSCANDO CLIENTES QUE SE LLAMEN PRUEBA ===");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes?nombre=ilike.*Prueba*&select=*`, { headers: h });
  const data = await r.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
