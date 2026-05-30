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
  console.log("=== ACTIVANDO CLIENTE PRUEBA ===");
  const clienteId = "59848e72-6b5e-444a-abf0-a4efbae4e0d4";
  
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, {
    method: 'PATCH',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({
      activo: true
    })
  });

  if (!patchRes.ok) {
    throw new Error(`Error al activar cliente: ${await patchRes.text()}`);
  }
  const data = await patchRes.json();
  console.log("Cliente activado con éxito! Respuesta:");
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
