import { describe, expect, it } from 'vitest'
import { defaultSlots, mondayOf, prefsOf, proposeWeek, recipeAllowed, weekNeeds } from './planner'
import { parseIngredient, seedRecipes, SEED_RECIPES } from './recipes'
import { LIGHT_RECIPES, lightPack } from './lightRecipes'
import type { InventoryRow, PlanEntry, Product, Recipe } from './types'

let n = 0
const id = () => `id-${++n}`
const recipes = seedRecipes('h', id)
const prod = (p: Partial<Product>): Product => ({
  id: id(), household_id: 'h', name: 'P', category_id: null, unit: 'ud', pack_size: null, usual_store_id: null, is_staple: false,
  min_qty: null, restock_days: null, location: null, last_price: null, notes: null, archived: false, ...p,
})
const inv = (p: Product, qty: number, expires_on: string | null = null): InventoryRow => ({
  id: id(), household_id: 'h', product_id: p.id, qty, location: null, expires_on, updated_by: null, updated_at: '',
})
const entry = (day: string, slot: 'comida' | 'cena', r: Recipe, servings: number): PlanEntry => ({
  id: id(), household_id: 'h', day, slot, recipe_id: r.id, servings, status: 'plan', note: null,
})

describe('recetario', () => {
  it('interpreta ingredientes', () => {
    expect(parseIngredient('150 g Pechuga de pollo')).toEqual({ name: 'Pechuga de pollo', amount: 150, unit: 'g', basic: false })
    expect(parseIngredient('0,5 ud Pepino')).toEqual({ name: 'Pepino', amount: 0.5, unit: 'ud', basic: false })
    expect(parseIngredient('* Aceite de oliva')).toEqual({ name: 'Aceite de oliva', amount: 0, unit: 'ud', basic: true })
    expect(parseIngredient('Sal')).toEqual({ name: 'Sal', amount: 1, unit: 'ud', basic: false })
  })
  it('todas las recetas iniciales tienen ingredientes válidos', () => {
    expect(recipes).toHaveLength(SEED_RECIPES.length)
    for (const r of recipes) {
      expect(r.ingredients.length).toBeGreaterThan(1)
      for (const i of r.ingredients) expect(i.basic || i.amount > 0).toBe(true)
    }
  })
})

describe('semana', () => {
  const prefs = prefsOf()
  it('lunes de la semana', () => {
    expect(mondayOf('2026-10-25')).toBe('2026-10-19') // domingo
    expect(mondayOf('2026-10-26')).toBe('2026-10-26')
  })
  it('comida L-V para uno y cena diaria para dos', () => {
    const s = defaultSlots('2026-10-26', prefs)
    expect(s.filter((x) => x.slot === 'comida')).toHaveLength(5)
    expect(s.filter((x) => x.slot === 'cena')).toHaveLength(7)
    expect(s.find((x) => x.slot === 'comida')!.servings).toBe(1)
    expect(s.find((x) => x.slot === 'cena')!.servings).toBe(2)
  })
  it('respeta exclusiones, tiempo y equipamiento', () => {
    const atun = recipes.find((r) => r.name.includes('garbanzos con atún'))!
    expect(recipeAllowed(atun, prefsOf({ excluded: ['atun'] }))).toBe(false)
    const horno = recipes.find((r) => r.equipment === 'horno')!
    expect(recipeAllowed(horno, prefsOf({ equipment: ['microondas'] }))).toBe(false)
    expect(recipes.filter((r) => recipeAllowed(r, prefsOf({ maxPrep: 10 }))).every((r) => r.prep_min <= 10)).toBe(true)
  })
  it('propone 12 comidas sin repetir en días seguidos y priorizando lo que caduca', () => {
    const merluza = prod({ name: 'Merluza' })
    const ctx = { stock: new Set(['merluza']), expiring: new Set(['merluza']) }
    void merluza
    const out = proposeWeek('2026-10-26', [], recipes, prefs, ctx)
    expect(out).toHaveLength(12)
    expect(out.some((o) => o.recipe.name.includes('Merluza'))).toBe(true)
    const byDay = new Map<string, string[]>()
    for (const o of out) byDay.set(o.day, [...(byDay.get(o.day) ?? []), o.recipe.id])
    const days = [...byDay.keys()].sort()
    for (let i = 1; i < days.length; i++) {
      for (const r of byDay.get(days[i])!) expect(byDay.get(days[i - 1])!.includes(r)).toBe(false)
    }
    expect(out.filter((o) => o.slot === 'comida').every((o) => o.recipe.slot !== 'cena')).toBe(true)
  })
  it('no toca huecos ya planificados o marcados fuera de casa', () => {
    const plan: PlanEntry[] = [{ ...entry('2026-10-26', 'cena', recipes[0], 2), recipe_id: null, status: 'fuera' }]
    const out = proposeWeek('2026-10-26', plan, recipes, prefs, { stock: new Set(), expiring: new Set() })
    expect(out.find((o) => o.day === '2026-10-26' && o.slot === 'cena')).toBeUndefined()
    expect(out).toHaveLength(11)
  })
})

describe('lo que falta', () => {
  const tortilla = recipes.find((r) => r.name.startsWith('Tortilla francesa'))! // 2 huevos, 0,25 lechuga, 1 tomate
  const lentejas = recipes.find((r) => r.name === 'Ensalada de lentejas')! // 130 g lentejas, 1 huevo...
  it('suma raciones, descuenta lo de casa y redondea a formatos', () => {
    const huevos = prod({ name: 'Huevos', unit: 'ud', pack_size: 12 })
    const lent = prod({ name: 'Lentejas cocidas', unit: 'kg', pack_size: 0.4 })
    const plan = [entry('2026-10-26', 'cena', tortilla, 2), entry('2026-10-27', 'comida', lentejas, 1), entry('2026-10-28', 'comida', lentejas, 1)]
    const { needs } = weekNeeds(plan, recipes, [huevos, lent], [inv(huevos, 0)], [])
    const h = needs.find((x) => x.name === 'Huevos')!
    expect(h.need).toBe(6) // 2×2 + 1 + 1
    expect(h.buyPacks).toBe(1) // una docena
    const l = needs.find((x) => x.name === 'Lentejas cocidas')!
    expect(l.need).toBeCloseTo(0.26)
    expect(l.buyPacks).toBe(1)
    const tom = needs.find((x) => x.name === 'Tomates')!
    expect(tom.buyPacks).toBe(4) // 2 cena + 1 + 1, sin producto: por unidades
  })
  it('no pide lo que ya hay o está en la lista, y aparta los básicos', () => {
    const huevos = prod({ name: 'Huevos', unit: 'ud', pack_size: 12 })
    const tomates = prod({ name: 'Tomates' })
    const aceite = prod({ name: 'Aceite de oliva' })
    const plan = [entry('2026-10-26', 'cena', tortilla, 2)]
    const items = [{ product_id: tomates.id } as never]
    const { needs, basicsOut } = weekNeeds(plan, recipes, [huevos, tomates, aceite], [inv(huevos, 1), inv(aceite, 0)], items)
    expect(needs.find((x) => x.name === 'Huevos')!.buyPacks).toBe(0)
    expect(needs.find((x) => x.name === 'Tomates')!.inList).toBe(true)
    expect(needs.some((x) => x.name === 'Aceite de oliva')).toBe(false)
    expect(basicsOut.map((b) => b.name)).toEqual(['Aceite de oliva'])
  })
  it('ignora fuera de casa y sobras', () => {
    const plan = [{ ...entry('2026-10-26', 'cena', tortilla, 2), status: 'fuera' as const }]
    expect(weekNeeds(plan, recipes, [], [], []).needs).toHaveLength(0)
  })
})

describe('recetas ligeras', () => {
  const base = seedRecipes('h', id)
  const apply = (rs: Recipe[], pack: ReturnType<typeof lightPack>) => [
    ...rs.map((r) => ({ ...r, ...(pack.adjust.find((a) => a.id === r.id)?.patch ?? {}) })),
    ...pack.add,
  ]
  it('añade las nuevas, ajusta las de partida y luego no queda nada', () => {
    const pack = lightPack(base, 'h', (i) => `l-${i}`)
    expect(pack.add).toHaveLength(LIGHT_RECIPES.length)
    expect(pack.adjust).toHaveLength(27)
    expect(pack.skipped).toEqual([])
    const after = apply(base, pack)
    const again = lightPack(after, 'h', (i) => `l-${i}`)
    expect(again.add).toHaveLength(0)
    expect(again.adjust).toHaveLength(0)
    expect(after.filter((r) => r.tags.includes('crema')).every((r) => r.slot === 'comida')).toBe(true)
    expect(after.find((r) => r.name === 'Crema de calabacín')!.slot).toBe('comida')
    expect(after.find((r) => r.name.startsWith('Pizza'))!.tags).not.toContain('ligera')
  })
  it('no toca las recetas editadas a mano', () => {
    const edited = base.map((r) => (r.name === 'Ensalada de arroz' ? { ...r, steps: 'Mi versión' } : r))
    const pack = lightPack(edited, 'h', (i) => `l-${i}`)
    expect(pack.skipped).toEqual(['Ensalada de arroz'])
    expect(pack.adjust.some((a) => a.name === 'Ensalada de arroz')).toBe(false)
  })
  it('con prioridad, el planificador propone sobre todo recetas ligeras', () => {
    const all = apply(base, lightPack(base, 'h', (i) => `l-${i}`))
    const ctx = { stock: new Set<string>(), expiring: new Set<string>() }
    const light = (p: boolean) => proposeWeek('2026-10-26', [], all, prefsOf({ preferLight: p }), ctx).filter((o) => o.recipe.tags.includes('ligera')).length
    expect(light(true)).toBeGreaterThanOrEqual(light(false))
    expect(light(true)).toBeGreaterThanOrEqual(10)
  })
})
