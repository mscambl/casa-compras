// Prueba de extremo a extremo contra el Supabase local (supabase start + scripts/dev-seed.sh)
// y la app servida en http://localhost:4173 (npm run build && npx vite preview --port 4173).
// Uso: node e2e/run.mjs [carpeta-capturas]
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

// Playwright viene preinstalado en el entorno (no es dependencia del proyecto).
const { chromium, devices } = createRequire(import.meta.url)('playwright')

const APP = process.env.APP_URL || 'http://localhost:4173/'
const API = 'http://127.0.0.1:54321'
const ANON = process.env.ANON_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const SHOTS = process.argv[2]
const results = []
let failed = 0

async function step(name, fn) {
  try {
    await fn()
    results.push(`✓ ${name}`)
    console.log(`✓ ${name}`)
  } catch (e) {
    failed++
    results.push(`✗ ${name}\n    ${String(e.message || e).split('\n')[0]}`)
    console.log(`✗ ${name}\n    ${String(e.message || e).split('\n')[0]}`)
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg) }

async function login(browser, email, device = devices['iPhone 13']) {
  const ctx = await browser.newContext({ ...device, locale: 'es-ES' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => console.log(`[${email}] pageerror:`, e.message))
  await page.goto(APP)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', 'prueba1234')
  await page.click('button:has-text("Entrar")')
  return { ctx, page }
}

async function addToList(page, name) {
  const input = page.getByPlaceholder('Añadir a la lista…')
  await input.fill(name)
  await input.press('Enter')
}
const item = (page, name) => page.getByTestId('item').filter({ has: page.locator('.title', { hasText: new RegExp(`^${name}$`) }) })
const shot = async (page, n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png` })

const browser = await chromium.launch()
const mike = await login(browser, 'mike@test.local')
const silvia = await login(browser, 'silvia@test.local')
await mike.page.waitForSelector('text=Hola, Mike')
await silvia.page.waitForSelector('text=Hola, Silvia')
for (const u of [mike, silvia]) await u.page.click('nav >> text=Lista')

await step('Mike añade Leche y Silvia la ve en tiempo real', async () => {
  await addToList(mike.page, 'Leche')
  await item(silvia.page, 'Leche').waitFor({ timeout: 5000 })
})

await step('Duplicado: Silvia añade «leche» y no se duplica', async () => {
  await addToList(silvia.page, 'leche')
  await silvia.page.getByText('ya está en la lista').waitFor({ timeout: 3000 })
  await silvia.page.click('.toast button:has-text("Sumar 1")')
  await mike.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=item]')].filter((e) => e.textContent.includes('Leche')).length === 1)
  await item(mike.page, 'Leche').locator('.stepper span', { hasText: '2' }).waitFor({ timeout: 5000 })
})

await step('La categoría se sugiere sola', async () => {
  await addToList(mike.page, 'Papel higiénico')
  await addToList(mike.page, 'Arroz redondo')
  await mike.page.locator('h2', { hasText: 'Papel' }).waitFor()
  await mike.page.locator('h2', { hasText: 'Despensa' }).waitFor()
})

await step('Editar precio estimado y formato (1 kg)', async () => {
  await item(mike.page, 'Arroz redondo').locator('.li-btn').click()
  await mike.page.getByLabel('Precio estimado (ud)').fill('1,20')
  await mike.page.getByPlaceholder('Ej. 500').fill('1')
  await mike.page.locator('.sheet select').nth(3).selectOption('kg')
  await mike.page.click('.sheet button:has-text("Guardar")')
  await item(mike.page, 'Arroz redondo').getByText('1,20').waitFor()
})

await step('Marcar en un móvil se refleja en el otro', async () => {
  await item(silvia.page, 'Leche').locator('.check-wrap').click()
  await item(mike.page, 'Leche').locator('.check.on').waitFor({ timeout: 5000 })
})

await step('Sin conexión: Silvia añade Tomates y se envía al volver', async () => {
  await silvia.ctx.setOffline(true)
  await addToList(silvia.page, 'Tomates')
  await item(silvia.page, 'Tomates').waitFor()
  await item(silvia.page, 'Papel higiénico').locator('.check-wrap').click()
  await mike.page.waitForTimeout(1500)
  assert(!(await item(mike.page, 'Tomates').count()), 'Mike no debería verlo aún')
  await silvia.ctx.setOffline(false)
  await silvia.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await item(mike.page, 'Tomates').waitFor({ timeout: 20000 })
  await item(mike.page, 'Papel higiénico').locator('.check.on').waitFor({ timeout: 10000 })
})

await step('Los dos añaden Huevos a la vez: queda uno', async () => {
  await Promise.all([addToList(mike.page, 'Huevos'), addToList(silvia.page, 'Huevos')])
  await mike.page.waitForTimeout(3000)
  for (const u of [mike, silvia]) {
    await u.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  }
  await mike.page.waitForTimeout(1500)
  const n = await item(mike.page, 'Huevos').count()
  const n2 = await item(silvia.page, 'Huevos').count()
  assert(n === 1 && n2 === 1, `Mike ve ${n}, Silvia ve ${n2}`)
})

await shot(mike.page, 'lista')

await step('Cerrar compra: total, salida de la lista y paso a «En casa»', async () => {
  await item(mike.page, 'Arroz redondo').locator('.check-wrap').click()
  await mike.page.click('button:has-text("Cerrar compra")')
  await mike.page.locator('.sheet select').first().selectOption({ label: 'Mercadona' })
  await mike.page.getByLabel('Importe de Leche').fill('1,90')
  await mike.page.getByLabel('Importe de Papel higiénico').fill('4,50')
  await mike.page.getByLabel('Importe de Arroz redondo').fill('1,15')
  await mike.page.getByPlaceholder(/7,55|0,00/).fill('8,05') // 0,50 de bolsa sin desglosar
  await shot(mike.page, 'cerrar-compra')
  await mike.page.click('button:has-text("Guardar compra")')
  await mike.page.getByText('Compra guardada').waitFor({ timeout: 8000 })
  await item(silvia.page, 'Leche').waitFor({ state: 'detached', timeout: 8000 })
  assert(await item(mike.page, 'Tomates').count() === 1, 'Tomates (sin marcar) debe seguir en la lista')
  await mike.page.click('nav >> text=Gastos')
  await mike.page.getByTestId('month-total').getByText('8,05').waitFor()
  await mike.page.getByText('Sin desglosar').waitFor()
  await shot(mike.page, 'gastos')
  await mike.page.click('nav >> text=En casa')
  await mike.page.getByTestId('stock').filter({ hasText: 'Leche' }).locator('.stepper span', { hasText: '2' }).waitFor()
  await shot(mike.page, 'en-casa')
})

await step('Precio por kg en el catálogo (1,15 €/kg)', async () => {
  await mike.page.click('nav >> text=Más')
  await mike.page.click('text=Catálogo de productos')
  await mike.page.getByText('1,15 €/kg').waitFor()
  await mike.page.keyboard.press('Escape')
})

await step('Presupuesto: Silvia lo fija y Mike lo ve en inicio', async () => {
  await silvia.page.click('nav >> text=Gastos')
  await silvia.page.click('button:has-text("Fijar presupuesto")')
  await silvia.page.getByLabel('Total del hogar').fill('400')
  await silvia.page.getByLabel('Alimentación').fill('300')
  await silvia.page.click('.sheet button:has-text("Guardar")')
  await mike.page.click('nav >> text=Inicio')
  await mike.page.getByText('de 400,00').waitFor({ timeout: 8000 })
  await mike.page.getByText('Quedan 391,95').waitFor()
  await shot(mike.page, 'inicio')
})

await step('«Se acabó» deja a 0 y ofrece añadir a la lista', async () => {
  await silvia.page.click('nav >> text=En casa')
  await silvia.page.getByLabel('Más acciones para Papel higiénico').click()
  await silvia.page.click('.sheet button:has-text("Se acabó")')
  await silvia.page.click('.toast button:has-text("Añadir a la lista")')
  await silvia.page.click('nav >> text=Lista')
  await item(silvia.page, 'Papel higiénico').waitFor()
})

await step('Mínimo deseado genera aviso en inicio', async () => {
  await mike.page.click('nav >> text=En casa')
  await mike.page.getByTestId('stock').filter({ hasText: 'Arroz' }).locator('.li-btn').click()
  await mike.page.getByLabel('Mínimo deseado').fill('3')
  await mike.page.click('.sheet button:has-text("Guardar")')
  await mike.page.click('nav >> text=Inicio')
  await mike.page.getByText('Quedan 1 (mínimo 3)').waitFor({ timeout: 5000 })
})

await step('Compra manual sin lista', async () => {
  await mike.page.click('nav >> text=Gastos')
  await mike.page.click('button:has-text("Compra")')
  await mike.page.getByPlaceholder('Añadir producto al ticket').fill('Lejía')
  await mike.page.getByPlaceholder('Añadir producto al ticket').press('Enter')
  await mike.page.getByLabel('Importe de Lejía').fill('0,95')
  await mike.page.click('button:has-text("Guardar compra")')
  await mike.page.getByTestId('month-total').getByText('9,00').waitFor({ timeout: 8000 })
})

await step('Eliminar compra descuenta de «En casa»', async () => {
  await mike.page.getByTestId('purchase').filter({ hasText: '0,95' }).click()
  await mike.page.click('.sheet button:has-text("Eliminar compra")')
  await mike.page.click('.sheet button:has-text("Toca otra vez")')
  await mike.page.getByTestId('month-total').getByText('8,05').waitFor({ timeout: 8000 })
})

await step('Exportar CSV de compras', async () => {
  await mike.page.click('nav >> text=Más')
  await mike.page.click('text=Exportar datos')
  const [dl] = await Promise.all([mike.page.waitForEvent('download'), mike.page.click('text=Compras línea a línea (CSV)')])
  const fs = await import('node:fs')
  const csv = fs.readFileSync(await dl.path(), 'utf8')
  assert(csv.includes('Leche') && csv.includes('Mercadona') && csv.includes('1.9'), 'CSV incompleto')
  await mike.page.keyboard.press('Escape')
})

await step('Una persona ajena no ve ni puede escribir datos', async () => {
  const intr = await login(browser, 'intruso@test.local')
  await intr.page.getByText('Sin acceso a un hogar').waitFor({ timeout: 8000 })
  const c = createClient(API, ANON)
  await c.auth.signInWithPassword({ email: 'intruso@test.local', password: 'prueba1234' })
  const { data } = await c.from('products').select('*')
  assert(data.length === 0, `ve ${data.length} productos`)
  const hh = await mike.page.evaluate(() => JSON.parse(localStorage.getItem('cc-cache-v1')).household.id)
  const ins = await c.from('products').insert({ household_id: hh, name: 'Intrusión' })
  assert(ins.error, 'pudo insertar en otro hogar')
  const rpc = await c.rpc('close_purchase', { p_household: hh, p_store: null, p_date: null, p_total: 1, p_paid_by: null, p_unplanned: false, p_lines: [] })
  assert(rpc.error, 'pudo cerrar compra en otro hogar')
  const anon = createClient(API, ANON)
  const a = await anon.from('purchases').select('*')
  assert(!a.data?.length, 'anónimo ve compras')
  await intr.ctx.close()
})

await step('Escritorio: la app se ve bien a 1280 px', async () => {
  const d = await login(browser, 'silvia@test.local', { viewport: { width: 1280, height: 860 } })
  await d.page.waitForSelector('text=Hola, Silvia')
  await d.page.click('nav >> text=Gastos')
  await shot(d.page, 'escritorio')
  await d.ctx.close()
})

await browser.close()
console.log(failed ? `\n${failed} fallos` : '\nTodo correcto')
process.exit(failed ? 1 : 0)
