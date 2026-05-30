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
  const clienteId = "40eeb642-5615-4ec0-a450-c9bdbd6b658f";
  const despachoId = "51007116-b72c-4aaa-aa5a-193faad56c6b";

  console.log("=== 1. VERIFICANDO TODOS LOS MOVIMIENTOS CXC DEL CLIENTE ===");
  const rCxc = await fetch(`${SUPABASE_URL}/rest/v1/cuentas_por_cobrar?cliente_id=eq.${clienteId}&select=*`, { headers: h });
  console.log(JSON.stringify(await rCxc.json(), null, 2));

  console.log("\n=== 2. ACTUALIZANDO FORMA_PAGO DEL DESPACHO A PAGADO ===");
  const updatedFormaPago = [
    {
      metodo: "Cobro a destino",
      monto: 3.39,
      diasVencimiento: 0,
      cobro_destino_pagado: true,
      metodos_pagados: [
        {
          metodo: "Transferencia",
          monto: 3.39,
          referencia: ""
        }
      ]
    }
  ];

  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/notas_despacho?id=eq.${despachoId}`, {
    method: 'PATCH',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({
      forma_pago: JSON.stringify(updatedFormaPago),
      forma_pago_cliente: JSON.stringify(updatedFormaPago)
    })
  });

  if (!patchRes.ok) {
    throw new Error(`Error al actualizar despacho: ${await patchRes.text()}`);
  }
  console.log("Despacho DES-00578 actualizado a pagado con éxito en la base de datos!");
}
run().catch(console.error);
