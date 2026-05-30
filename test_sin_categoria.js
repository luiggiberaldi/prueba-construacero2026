import { createClient } from '@supabase/supabase-js'

import fs from 'fs'

const envContent = fs.readFileSync('.env', 'utf-8')
const getEnvVar = (name) => {
  const match = envContent.match(new RegExp(`${name}=(.*)`))
  return match ? match[1].trim() : null
}

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL')
const supabaseKey = getEnvVar('VITE_SUPABASE_ANON_KEY')

const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, codigo, categoria')
    .is('categoria', null)

  if (error) {
    console.error('Error fetching products:', error)
    return
  }

  console.log('--- PRODUCTS WITHOUT CATEGORY ---')
  console.log(`Found ${data.length} products:`)
  data.forEach((p, idx) => {
    console.log(`${idx + 1}. [${p.codigo || 'NO CODE'}] ${p.nombre}`)
  })
}

run()
