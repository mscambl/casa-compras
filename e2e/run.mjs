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
let png
let failed = 0

async function step(name, fn) {
  try {
    await fn()
    results.push(`✓ ${name}`)
    console.log(`✓ ${name}`)
  } catch (e) {
    failed++
    if (SHOTS) for (const [n, u] of [['mike', globalThis.mike], ['silvia', globalThis.silvia]]) if (u) await u.page.screenshot({ path: `${SHOTS}/fallo-${failed}-${n}.png` }).catch(() => {})
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
Object.assign(globalThis, { mike, silvia })
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

await step('Formato en metros: 30 m de papel de aluminio y precio por metro', async () => {
  await mike.page.click('nav >> text=Lista')
  await addToList(mike.page, 'Papel de aluminio')
  await item(mike.page, 'Papel de aluminio').locator('.li-btn').click()
  await mike.page.getByPlaceholder('Ej. 500').fill('30')
  await mike.page.locator('.sheet select').filter({ has: mike.page.locator('option[value=cm]') }).selectOption('m')
  await mike.page.click('.sheet button:has-text("Guardar")')
  // Deja llegar el eco en tiempo real del alta antes de volver a abrir la ficha.
  await mike.page.waitForFunction(() => window.__cc.getState().pending === 0)
  await mike.page.waitForTimeout(1500)
  await item(mike.page, 'Papel de aluminio').locator('.li-btn').click()
  assert(await mike.page.getByPlaceholder('Ej. 500').inputValue() === '30', 'no guardó el formato')
  await mike.page.getByPlaceholder('Precio visto (€)').fill('2,40')
  await mike.page.click('.sheet button:has-text("Guardar precio")')
  await mike.page.getByText('0,08 €/m').waitFor()
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

await step('Menú: proponer la semana siguiente y verlo en el otro móvil', async () => {
  for (const u of [mike, silvia]) {
    await u.page.click('nav >> text=Menú')
    await u.page.click('button[aria-label="Semana siguiente"]')
  }
  await mike.page.waitForFunction(() => window.__cc.getState().recipes.length >= 20, null, { timeout: 10000 })
  await mike.page.click('button:has-text("Proponer semana")')
  await mike.page.getByText('12 comidas propuestas').waitFor()
  await mike.page.waitForTimeout(500)
  assert(!(await mike.page.getByText('Elegir…').count()), 'quedan huecos sin elegir')
  await silvia.page.waitForFunction(() => !document.body.innerText.includes('Elegir…'), null, { timeout: 10000 })
  await shot(mike.page, 'menu')
})

await step('Menú: añadir a Silvia a una comida y cambiar un plato', async () => {
  const slot = mike.page.locator('[data-testid$="-comida"]').first()
  await slot.click()
  await mike.page.click('.sheet .chip:has-text("Mike y Silvia")')
  await mike.page.keyboard.press('Escape')
  await slot.getByText('Mike y Silvia').waitFor()
  const cena = mike.page.locator('[data-testid$="-cena"]').nth(2)
  await cena.click()
  await mike.page.click('.sheet .chip:has-text("Fuera de casa")')
  await cena.getByText('Fuera de casa').waitFor()
  await silvia.page.locator('[data-testid$="-cena"]').nth(2).getByText('Fuera de casa').waitFor({ timeout: 8000 })
})

await step('Menú: «Lo que falta» añade a la lista lo necesario', async () => {
  await mike.page.click('button:has-text("Lo que falta")')
  await mike.page.locator('.sheet .li').first().waitFor()
  await shot(mike.page, 'lo-que-falta')
  const btn = mike.page.locator('.sheet button:has-text("a la lista")')
  const label = await btn.textContent()
  const n = Number(label.match(/\d+/)[0])
  assert(n > 3, `solo ${n} ingredientes`)
  await btn.click()
  await mike.page.getByText('añadidos a la lista').waitFor()
  await silvia.page.click('nav >> text=Lista')
  await silvia.page.waitForFunction((k) => document.querySelectorAll('[data-testid=item]').length >= k, n, { timeout: 10000 })
})

await step('Menú: excluir un ingrediente lo quita de las propuestas', async () => {
  await mike.page.click('button[aria-label="Preferencias"]')
  await mike.page.getByPlaceholder('Ej. setas, marisco').fill('huevo')
  await mike.page.click('.sheet button:has-text("Guardar")')
  const slot = mike.page.locator('[data-testid$="-cena"]').first()
  await slot.click()
  const names = await mike.page.locator('.sheet .li .title').allTextContents()
  assert(names.length > 0 && !names.some((t) => /tortilla francesa|revuelto|huevos al plato/i.test(t)), names.join(', '))
  await mike.page.keyboard.press('Escape')
})

await step('Menú: añadir las recetas ligeras y verlas en el otro móvil', async () => {
  await mike.page.getByRole('button', { name: 'Recetas', exact: true }).click()
  await mike.page.click('.sheet button:has-text("Añadir recetas ligeras")')
  await mike.page.getByText('22 recetas nuevas y 27 ajustadas').waitFor()
  assert(await mike.page.getByTestId('light-pack').count() === 0, 'sigue ofreciendo el paquete')
  await mike.page.keyboard.press('Escape')
  await mike.page.click('button[aria-label="Preferencias"]')
  assert(await mike.page.getByPlaceholder('Ej. setas, marisco').inputValue() === 'huevo', 'perdió las exclusiones')
  assert(await mike.page.getByLabel('Dar prioridad a las recetas ligeras').isChecked(), 'sin prioridad a ligeras')
  await mike.page.keyboard.press('Escape')
  await silvia.page.click('nav >> text=Menú')
  await silvia.page.getByRole('button', { name: 'Recetas', exact: true }).click()
  await silvia.page.locator('.sheet .li .title', { hasText: 'Pisto con huevo' }).waitFor()
  await silvia.page.keyboard.press('Escape')
})

await step('Categorías: añadir, subir con «Editar» y verlo en el otro móvil', async () => {
  await mike.page.click('nav >> text=Más')
  await mike.page.click('text=Categorías')
  await mike.page.getByPlaceholder('Nueva categoría').fill('Mascotas')
  await mike.page.click('.sheet button:has-text("Añadir")')
  const names = async (pg) => (await pg.locator('[data-testid=category-row]').allTextContents())
  let list = await names(mike.page)
  assert(list.at(-1).startsWith('Mascotas'), 'no está al final: ' + list.at(-1))
  await mike.page.click('.sheet button:has-text("Editar")')
  for (let k = 0; k < 3; k++) await mike.page.click('button[aria-label="Subir Mascotas"]')
  await mike.page.click('.sheet button:has-text("Listo")')
  list = await names(mike.page)
  const pos = list.findIndex((t) => t.startsWith('Mascotas'))
  assert(pos === list.length - 4, `posición ${pos} de ${list.length}`)
  await shot(mike.page, 'categorias')
  await mike.page.keyboard.press('Escape')
  await silvia.page.click('nav >> text=Más')
  await silvia.page.click('text=Categorías')
  await silvia.page.waitForFunction((p) => [...document.querySelectorAll('[data-testid=category-row]')].findIndex((e) => e.textContent.startsWith('Mascotas')) === p, pos, { timeout: 8000 })
  await silvia.page.keyboard.press('Escape')
})

await step('Categorías: borrar desde «Editar»', async () => {
  await mike.page.click('text=Categorías')
  await mike.page.click('.sheet button:has-text("Editar")')
  await mike.page.click('button[aria-label="Borrar Mascotas"]')
  await shot(mike.page, 'categorias-borrar')
  await mike.page.click('.sheet button:has-text("Borrar")')
  await mike.page.getByText('Mascotas borrada').waitFor()
  await mike.page.keyboard.press('Escape')
})

await step('Escanear código: busca en Open Food Facts y lo añade a la lista', async () => {
  png = await mike.page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 200 } })
  for (const u of [mike, silvia]) {
    await u.ctx.route(/^https:\/\/world\.open\w+facts\.org\//, (r) => {
      const url = r.request().url()
      const code = url.match(/product\/(\d+)/)[1]
      if (code === '8430000004449' && url.includes('openbeautyfacts')) {
        return r.fulfill({ json: { status: 1, code, product: { product_name: 'Gel de ducha avena', brands: 'Deliplus', product_quantity: 750, product_quantity_unit: 'ml' } } })
      }
      if (code === '8410000001235' && url.includes('openfoodfacts')) {
        return r.fulfill({ json: { status: 1, code, product: {
          product_name_es: 'Yogur griego natural', brands: 'Hacendado', quantity: '4 x 125 g', product_quantity: 500, product_quantity_unit: 'g',
          image_front_url: 'https://images.openfoodfacts.org/images/yogur.jpg', ingredients_text_es: 'Leche, nata, fermentos lácticos.',
          allergens_tags: ['en:milk'], nutriscore_grade: 'c', nova_group: 1,
          nutriments: { 'energy-kcal_100g': 139, fat_100g: 10, 'saturated-fat_100g': 6.5, carbohydrates_100g: 4.2, sugars_100g: 4.2, proteins_100g: 3.5, salt_100g: 0.1 },
        } } })
      }
      return r.fulfill({ status: 404, json: { status: 0, status_verbose: 'product not found' } })
    })
    await u.ctx.route(/^https:\/\/images\.open\w+facts\.org\//, (r) => r.fulfill({ body: png, contentType: 'image/png' }))
    await u.page.click('nav >> text=Lista')
  }
  await mike.page.click('button[aria-label="Escanear código de barras"]')
  await mike.page.getByLabel('Número del código de barras').fill('8410000001235')
  await mike.page.click('.sheet button:has-text("Buscar")')
  await item(silvia.page, 'Yogur griego natural').waitFor()
  await item(silvia.page, 'Yogur griego natural').locator('.thumb').waitFor()
})

await step('Ficha: Nutri-Score, alérgenos y tabla nutricional', async () => {
  await item(mike.page, 'Yogur griego natural').locator('.li-btn').click()
  const info = mike.page.getByTestId('pack-info')
  await info.locator('.nutri.c').waitFor()
  await info.locator('.tag', { hasText: 'Leche' }).waitFor()
  await info.getByText('139 kcal').waitFor()
  await mike.page.getByText('8410000001235').waitFor()
  const pack = await mike.page.getByPlaceholder('Ej. 500').inputValue()
  assert(pack === '500', 'formato ' + pack)
  await shot(mike.page, 'ficha-envase')
})

await step('Foto propia: Mike la sube y Silvia la ve', async () => {
  await mike.page.getByTestId('photo-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png })
  await mike.page.getByText('Foto guardada').waitFor()
  await shot(mike.page, 'ficha-foto')
  await mike.page.keyboard.press('Escape')
  await item(silvia.page, 'Yogur griego natural').locator('.li-btn').click()
  await silvia.page.waitForFunction(() => {
    const i = document.querySelector('[data-testid=gallery] button img')
    return i && i.src.includes('/storage/v1/object/sign/product-photos/') && i.complete && i.naturalWidth > 0
  }, null, { timeout: 8000 })
  await silvia.page.keyboard.press('Escape')
  await shot(silvia.page, 'lista-con-fotos')
})

await step('Código desconocido: pide el nombre y lo recuerda', async () => {
  await mike.page.click('button[aria-label="Escanear código de barras"]')
  await mike.page.getByLabel('Número del código de barras').fill('8420000009996')
  await mike.page.click('.sheet button:has-text("Buscar")')
  await mike.page.getByText('no es un código de barras válido').waitFor()
  await mike.page.getByLabel('Número del código de barras').fill('8420000009995')
  await mike.page.click('.sheet button:has-text("Buscar")')
  await mike.page.getByLabel('Nombre del producto').fill('Galletas de la abuela')
  await mike.page.click('.sheet button:has-text("Guardar")')
  await item(mike.page, 'Galletas de la abuela').waitFor()
  await item(silvia.page, 'Galletas de la abuela').waitFor()
  await silvia.page.click('button[aria-label="Escanear código de barras"]')
  await silvia.page.getByLabel('Número del código de barras').fill('8420000009995')
  await silvia.page.click('.sheet button:has-text("Buscar")')
  await silvia.page.getByText('ya está en la lista').waitFor()
})

await step('Código de cosmética: lo encuentra en Open Beauty Facts', async () => {
  await mike.page.click('button[aria-label="Escanear código de barras"]')
  await mike.page.getByLabel('Número del código de barras').fill('8430000004449')
  await mike.page.click('.sheet button:has-text("Buscar")')
  await mike.page.getByText('Gel de ducha avena: datos de Open Beauty Facts').waitFor()
  await item(silvia.page, 'Gel de ducha avena').waitFor()
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
  const photo = await mike.page.evaluate(() => JSON.parse(localStorage.getItem('cc-cache-v1')).products.find((p) => p.photos?.length).photos[0])
  const dl = await c.storage.from('product-photos').download(photo)
  assert(dl.error, 'descarga una foto de otro hogar')
  const up = await c.storage.from('product-photos').upload(`${hh}/x/intruso.jpg`, new Blob(['x'], { type: 'image/jpeg' }))
  assert(up.error, 'sube una foto a otro hogar')
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
