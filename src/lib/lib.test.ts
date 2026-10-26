import { describe, expect, it } from 'vitest'
import { DATABASES, gtinValid, lookupBarcode, normalizeBarcode, parseOff } from './off'
import { packInput, packLabel, parseNum, pctChange, toBase, unitPrice, unitPriceLabel } from './format'
import { guessCategoryName, norm, rank } from './text'
import { alerts, budgetFor, forecast, metrics, monthSpend } from './stats'
import type { PurchaseWithLines } from './store'
import type { Product, PurchaseLine } from './types'

describe('números y unidades', () => {
  it('lee decimales con coma o punto', () => {
    expect(parseNum('1,5')).toBe(1.5)
    expect(parseNum('1.5')).toBe(1.5)
    expect(parseNum('1.234,56')).toBe(1234.56)
    expect(parseNum(' 3,20 € ')).toBe(3.2)
    expect(parseNum('abc')).toBeNull()
    expect(parseNum('')).toBeNull()
  })
  it('convierte g y ml a kg y l', () => {
    expect(toBase(500, 'g')).toEqual({ unit: 'kg', size: 0.5 })
    expect(toBase(750, 'ml')).toEqual({ unit: 'l', size: 0.75 })
    expect(toBase(12, 'ud')).toEqual({ unit: 'ud', size: 12 })
  })
  it('precio por unidad comparable', () => {
    expect(unitPrice(1.2, 0.5)).toBeCloseTo(2.4)
    expect(unitPrice(3.6, 12)).toBeCloseTo(0.3)
    expect(unitPrice(2, null)).toBeNull()
    expect(unitPrice(2, 0)).toBeNull()
    expect(unitPriceLabel(1.2, 'kg', 0.5).replace(/\s/g, ' ')).toBe('2,40 €/kg')
  })
  it('formatos legibles y editables', () => {
    expect(packLabel('kg', 0.5)).toBe('500 g')
    expect(packLabel('l', 1.5)).toBe('1,5 l')
    expect(packLabel('ud', 12)).toBe('12 ud')
    expect(packInput('kg', 0.25)).toEqual({ size: '250', unit: 'g' })
  })
  it('variación porcentual', () => {
    expect(pctChange(1.1, 1)).toBeCloseTo(0.1)
    expect(pctChange(1, 0)).toBeNull()
  })
})

describe('texto', () => {
  it('normaliza tildes y mayúsculas', () => {
    expect(norm('  Plátano   de Canarias ')).toBe('platano de canarias')
  })
  it('ordena búsquedas por relevancia', () => {
    const items = [{ name: 'Leche de avena' }, { name: 'Leche entera' }, { name: 'Pan' }, { name: 'Café con leche' }]
    expect(rank(items, 'leche').map((i) => i.name)).toEqual(['Leche entera', 'Leche de avena', 'Café con leche'])
    expect(rank(items, 'lech ent').map((i) => i.name)).toEqual(['Leche entera'])
  })
  it('sugiere categoría', () => {
    expect(guessCategoryName('Pasta de dientes')).toBe('Higiene personal')
    expect(guessCategoryName('Macarrones')).toBe('Despensa')
    expect(guessCategoryName('Pañuelos')).toBe('Papel')
    expect(guessCategoryName('Pan de molde')).toBe('Panadería')
    expect(guessCategoryName('Plátanos')).toBe('Fruta y verdura')
    expect(guessCategoryName('Detergente líquido')).toBe('Lavandería')
    expect(guessCategoryName('Cosa rara')).toBeNull()
  })
})

const line = (p: Partial<PurchaseLine>): PurchaseLine => ({
  id: crypto.randomUUID(), household_id: 'h', purchase_id: 'p', product_id: null, name: 'x', qty: 1, unit: 'ud', pack_size: null,
  line_total: 0, discount: 0, grp: 'alimentacion', ...p,
})
const purchase = (date: string, total: number, lines: PurchaseLine[], extra: Partial<PurchaseWithLines> = {}): PurchaseWithLines => ({
  id: crypto.randomUUID(), household_id: 'h', store_id: 's1', purchased_on: date, total_paid: total, paid_by: null, source: 'lista',
  unplanned: false, notes: null, created_by: null, created_at: date, purchase_lines: lines, ...extra,
})

describe('gasto mensual', () => {
  const ps = [
    purchase('2026-10-03', 50, [line({ line_total: 30 }), line({ line_total: 15, grp: 'limpieza' })]),
    purchase('2026-10-20', 20, [line({ line_total: 25 })], { unplanned: true, store_id: 's2' }),
    purchase('2026-09-28', 99, []),
  ]
  it('suma total, grupos, sin desglosar y descuentos', () => {
    const r = monthSpend(ps, '2026-10-01')
    expect(r.total).toBe(70)
    expect(r.unassigned).toBe(5) // 50 - 45
    expect(r.byGroup.alimentacion).toBe(50) // 30 + 25 * (20/25)
    expect(r.byGroup.limpieza).toBe(15)
    expect(r.count).toBe(2)
    expect(r.unplanned).toBe(1)
    expect(r.byStore.get('s2')).toBe(20)
    // la suma de grupos + sin desglosar cuadra con el total pagado
    const sum = Object.values(r.byGroup).reduce((a, b) => a + b, 0) + r.unassigned
    expect(sum).toBeCloseTo(r.total)
  })
  it('compara solo hasta el mismo día', () => {
    expect(monthSpend(ps, '2026-10-01', 10).total).toBe(50)
  })
  it('previsión lineal', () => {
    expect(forecast(100, '2026-10-10')).toEqual({ value: 310, reliable: true })
    expect(forecast(30, '2026-10-03').reliable).toBe(false)
  })
  it('presupuesto vigente se arrastra de meses anteriores', () => {
    const b = [{ household_id: 'h', month: '2026-08-01', grp: 'total' as const, amount: 400 }, { household_id: 'h', month: '2026-10-01', grp: 'total' as const, amount: 450 }]
    expect(budgetFor(b, '2026-09-01', 'total')).toBe(400)
    expect(budgetFor(b, '2026-11-01', 'total')).toBe(450)
    expect(budgetFor(b, '2026-07-01', 'total')).toBeNull()
  })
})

describe('avisos', () => {
  const prod = (p: Partial<Product>): Product => ({
    id: crypto.randomUUID(), household_id: 'h', name: 'P', category_id: null, unit: 'ud', pack_size: null, usual_store_id: null,
    is_staple: false, min_qty: null, restock_days: null, location: null, last_price: null, notes: null, archived: false, ...p,
  })
  it('caducidad, mínimos y reposición', () => {
    const yog = prod({ name: 'Yogur' }), pap = prod({ name: 'Papel', min_qty: 2 }), det = prod({ name: 'Detergente', restock_days: 30 })
    const inv = [
      { id: '1', household_id: 'h', product_id: yog.id, qty: 4, location: null, expires_on: '2026-10-26', updated_by: null, updated_at: '' },
      { id: '2', household_id: 'h', product_id: pap.id, qty: 1, location: null, expires_on: null, updated_by: null, updated_at: '' },
    ]
    const ps = [purchase('2026-09-20', 8, [line({ product_id: det.id, line_total: 8 })])]
    const a = alerts([yog, pap, det], inv, [], ps, '2026-10-25')
    expect(a.map((x) => [x.product.name, x.kind])).toEqual([['Yogur', 'caduca'], ['Papel', 'minimo'], ['Detergente', 'reponer']])
    // si ya está en la lista, no se avisa de reponer
    const a2 = alerts([yog, pap, det], inv, [{ product_id: pap.id } as never], ps, '2026-10-25')
    expect(a2.some((x) => x.product.name === 'Papel')).toBe(false)
  })
})

describe('métricas', () => {
  it('cuenta imprevistas, duplicados, desperdicio y tiempo', () => {
    const ps = [purchase('2026-10-03', 40, []), purchase('2026-10-05', 10, [], { unplanned: true })]
    const ev = [
      { id: '1', household_id: 'h', user_id: null, kind: 'duplicate_avoided' as const, product_id: null, data: {}, created_at: '2026-10-04T10:00:00Z' },
      { id: '2', household_id: 'h', user_id: null, kind: 'wasted' as const, product_id: null, data: { value: 1.5 }, created_at: '2026-10-04T10:00:00Z' },
      { id: '3', household_id: 'h', user_id: null, kind: 'session' as const, product_id: null, data: { seconds: 300 }, created_at: '2026-10-04T10:00:00Z' },
    ]
    expect(metrics(ps, ev, '2026-10-01')).toEqual({ avgBasket: 25, unplanned: 1, duplicatesAvoided: 1, wastedValue: 1.5, wastedCount: 1, minutesInApp: 5 })
  })
})

describe('código de barras y Open Food Facts', () => {
  it('valida el dígito de control', () => {
    expect(gtinValid('8480000160072')).toBe(true)
    expect(gtinValid('8480000160073')).toBe(false)
    expect(gtinValid('96385074')).toBe(true)
    expect(gtinValid('12345')).toBe(false)
    expect(normalizeBarcode('0 36000 29145 2')).toBe('0036000291452')
  })
  it('interpreta la ficha', () => {
    const r = parseOff({
      status: 1,
      product: {
        product_name_es: 'Leche semidesnatada', brands: 'Hacendado, Mercadona', quantity: '1 l', product_quantity: '1000', product_quantity_unit: 'ml',
        image_front_url: 'https://images.openfoodfacts.org/x.jpg', ingredients_text_es: 'Leche semidesnatada de vaca.',
        allergens_tags: ['en:milk'], traces_tags: ['en:milk', 'en:nuts'], nutriscore_grade: 'B', nova_group: 1,
        nutriments: { 'energy-kcal_100g': 46, fat_100g: 1.55, 'saturated-fat_100g': '1', salt_100g: '' },
      },
    })!
    expect(r.name).toBe('Leche semidesnatada')
    expect(r.pack).toEqual({ unit: 'l', size: 1 })
    expect(r.info.brand).toBe('Hacendado')
    expect(r.info.allergens).toEqual(['Leche'])
    expect(r.info.traces).toEqual(['Frutos de cáscara'])
    expect(r.info.nutriscore).toBe('b')
    expect(r.info.nutrition).toEqual({ kcal: 46, fat: 1.6, saturated: 1 })
    expect(r.info.per).toBe('100 ml')
    expect('salt' in (r.info.nutrition ?? {})).toBe(false)
  })
  it('sin producto devuelve null', () => {
    expect(parseOff({ status: 0 })).toBeNull()
    expect(parseOff({ status: 1, product: {} })).toBeNull()
  })
})

describe('búsqueda en varias bases', () => {
  const realFetch = globalThis.fetch
  const mock = (found: Record<string, unknown>, fail: string[] = []) => {
    globalThis.fetch = (async (url: string) => {
      const host = new URL(url).hostname
      if (fail.includes(host)) throw new TypeError('Failed to fetch')
      const p = found[host]
      return new Response(JSON.stringify(p ? { status: 1, product: p } : { status: 0 }), { status: p ? 200 : 404 })
    }) as typeof fetch
  }
  it('usa la primera base que conoce el código', async () => {
    mock({ 'world.openbeautyfacts.org': { product_name: 'Gel de ducha' }, 'world.openproductsfacts.org': { product_name: 'Otro' } })
    const r = await lookupBarcode('8430000004449')
    expect(r?.name).toBe('Gel de ducha')
    expect(r?.info.db).toBe('Open Beauty Facts')
  })
  it('null si ninguna lo conoce aunque alguna falle; error si fallan todas', async () => {
    mock({}, ['world.openpetfoodfacts.org'])
    expect(await lookupBarcode('8430000004449')).toBeNull()
    mock({}, DATABASES.map((d) => d.host))
    await expect(lookupBarcode('8430000004449')).rejects.toThrow()
    globalThis.fetch = realFetch
  })
})
