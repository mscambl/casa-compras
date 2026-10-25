import { norm } from './text'
import { addDaysISO, daysBetween } from './format'
import {
  DEFAULT_PREFS, type Ingredient, type InventoryRow, type MealSlot, type PlanEntry, type Prefs, type Product, type Recipe, type ShoppingItem,
} from './types'

export const prefsOf = (p?: Prefs): Required<Prefs> => ({ ...DEFAULT_PREFS, ...(p ?? {}) })

/** Lunes de la semana de una fecha. */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7 // 0 = lunes
  return addDaysISO(iso, -dow)
}
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
export const isWeekend = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const w = new Date(y, m - 1, d).getDay()
  return w === 0 || w === 6
}

/** Huecos que se planifican por defecto: comida L-V (Mike) y cena todos los días. */
export function defaultSlots(monday: string, prefs: Required<Prefs>): { day: string; slot: MealSlot; servings: number }[] {
  const out: { day: string; slot: MealSlot; servings: number }[] = []
  for (const day of weekDays(monday)) {
    if (!isWeekend(day) || prefs.weekendLunch) out.push({ day, slot: 'comida', servings: isWeekend(day) ? prefs.dinnerServings : prefs.lunchServings })
    out.push({ day, slot: 'cena', servings: prefs.dinnerServings })
  }
  return out
}

export function recipeAllowed(r: Recipe, prefs: Required<Prefs>, slot?: MealSlot): boolean {
  if (!r.active) return false
  if (slot && r.slot !== 'ambas' && r.slot !== slot) return false
  if (r.prep_min > prefs.maxPrep) return false
  if (r.equipment !== 'ninguno' && !prefs.equipment.includes(r.equipment)) return false
  const ex = prefs.excluded.map(norm).filter(Boolean)
  return !r.ingredients.some((i) => ex.some((e) => norm(i.name).includes(e)))
}

export interface ScoreCtx {
  stock: Set<string> // nombres normalizados con existencias
  expiring: Set<string> // caducan en ≤ 4 días
  weekIngredients: Map<string, number> // ingredientes ya usados en la semana
  recipeUses: Map<string, number>
  recentByDay: Map<string, Set<string>> // día -> recetas
  dayIngredients?: Map<string, Set<string>> // día -> ingredientes ya usados ese día
}

/** Registra una receta ya puesta en el menú para puntuar las siguientes. */
export function notePlanned(ctx: ScoreCtx, r: Recipe, day: string) {
  ctx.recipeUses.set(r.id, (ctx.recipeUses.get(r.id) ?? 0) + 1)
  if (!ctx.recentByDay.has(day)) ctx.recentByDay.set(day, new Set())
  ctx.recentByDay.get(day)!.add(r.id)
  if (!ctx.dayIngredients) ctx.dayIngredients = new Map()
  if (!ctx.dayIngredients.has(day)) ctx.dayIngredients.set(day, new Set())
  for (const i of r.ingredients) {
    if (i.basic) continue
    const n = norm(i.name)
    ctx.weekIngredients.set(n, (ctx.weekIngredients.get(n) ?? 0) + 1)
    ctx.dayIngredients.get(day)!.add(n)
  }
}

export function buildCtx(products: Product[], inventory: InventoryRow[], today: string): Pick<ScoreCtx, 'stock' | 'expiring'> {
  const byId = new Map(products.map((p) => [p.id, p]))
  const stock = new Set<string>()
  const expiring = new Set<string>()
  for (const r of inventory) {
    const p = byId.get(r.product_id)
    if (!p || r.qty <= 0) continue
    stock.add(norm(p.name))
    if (r.expires_on && daysBetween(today, r.expires_on) <= 4) expiring.add(norm(p.name))
  }
  return { stock, expiring }
}

/** Puntuación: aprovechar lo que hay (sobre todo lo que caduca), reutilizar ingredientes y variar. */
export function scoreRecipe(r: Recipe, day: string, slot: MealSlot, ctx: ScoreCtx): number {
  let s = 0
  for (const i of r.ingredients) {
    if (i.basic) continue
    const n = norm(i.name)
    const inStock = ctx.stock.has(n)
    const reused = (ctx.weekIngredients.get(n) ?? 0) > 0
    if (ctx.expiring.has(n)) s += 6
    if (inStock) s += 3
    if (reused) s += 2
    if (!inStock && !reused) s -= 1.5 // obliga a comprar algo nuevo
  }
  if (r.tags.includes('ensalada')) s += 1
  if (slot === 'comida' && r.tags.includes('tupper')) s += 2
  s -= r.prep_min / 15
  s -= 5 * (ctx.recipeUses.get(r.id) ?? 0)
  for (const d of [-2, -1, 1, 2]) if (ctx.recentByDay.get(addDaysISO(day, d))?.has(r.id)) s -= 100
  // Reutilizar en la semana está bien; repetir lo mismo en comida y cena del mismo día, no.
  const sameDay = ctx.dayIngredients?.get(day)
  if (sameDay) for (const i of r.ingredients) if (!i.basic && sameDay.has(norm(i.name))) s -= 2.5
  return s
}

/**
 * Rellena los huecos vacíos de la semana. No toca lo que ya está planificado
 * ni los huecos marcados como «fuera» o «sobras».
 */
export function proposeWeek(
  monday: string, plan: PlanEntry[], recipes: Recipe[], prefs: Required<Prefs>, stockCtx: Pick<ScoreCtx, 'stock' | 'expiring'>,
): { day: string; slot: MealSlot; recipe: Recipe; servings: number }[] {
  const days = new Set(weekDays(monday))
  const weekPlan = plan.filter((p) => days.has(p.day))
  const rmap = new Map(recipes.map((r) => [r.id, r]))
  const ctx: ScoreCtx = { ...stockCtx, weekIngredients: new Map(), recipeUses: new Map(), recentByDay: new Map(), dayIngredients: new Map() }
  const note = (r: Recipe, day: string) => notePlanned(ctx, r, day)
  for (const p of weekPlan) {
    const r = p.recipe_id ? rmap.get(p.recipe_id) : undefined
    if (r) note(r, p.day)
  }
  const out: { day: string; slot: MealSlot; recipe: Recipe; servings: number }[] = []
  for (const { day, slot, servings } of defaultSlots(monday, prefs)) {
    const existing = weekPlan.find((p) => p.day === day && p.slot === slot)
    if (existing && (existing.recipe_id || existing.status !== 'plan')) continue
    const candidates = recipes.filter((r) => recipeAllowed(r, prefs, slot))
    let best: Recipe | null = null
    let bestScore = -Infinity
    for (const r of candidates) {
      const sc = scoreRecipe(r, day, slot, ctx)
      if (sc > bestScore) { best = r; bestScore = sc }
    }
    if (!best) continue
    note(best, day)
    out.push({ day, slot, recipe: best, servings: existing?.servings ?? servings })
  }
  return out
}

// ---------------------------------------------------------------------------
// Lista de ingredientes que faltan
// ---------------------------------------------------------------------------

type Dim = 'peso' | 'volumen' | 'ud'
const dimOf = (u: string): Dim => (u === 'g' || u === 'kg' ? 'peso' : u === 'ml' || u === 'l' ? 'volumen' : 'ud')
/** Cantidad en unidad base (kg, l, ud). */
const toBaseAmount = (i: Ingredient) => (i.unit === 'g' || i.unit === 'ml' ? i.amount / 1000 : i.amount)
const productDim = (p: Product): Dim => (p.unit === 'kg' ? 'peso' : p.unit === 'l' ? 'volumen' : 'ud')

export interface Need {
  key: string
  name: string
  product: Product | undefined
  need: number // en unidad base
  dim: Dim
  have: number | null // en unidad base; null si no se puede saber
  buyPacks: number // formatos/unidades a comprar (0 = cubierto)
  inList: boolean
  uses: string[] // recetas que lo usan
}

export function weekNeeds(
  entries: PlanEntry[], recipes: Recipe[], products: Product[], inventory: InventoryRow[], items: ShoppingItem[],
): { needs: Need[]; basicsOut: Product[] } {
  const rmap = new Map(recipes.map((r) => [r.id, r]))
  const pByName = new Map(products.map((p) => [norm(p.name), p]))
  const inv = new Map(inventory.map((r) => [r.product_id, r]))
  const inList = new Set(items.map((i) => i.product_id))
  const agg = new Map<string, Need>()
  const basics = new Map<string, Product>()

  for (const e of entries) {
    if (e.status !== 'plan' || !e.recipe_id) continue
    const r = rmap.get(e.recipe_id)
    if (!r) continue
    for (const i of r.ingredients) {
      const key = norm(i.name)
      const product = pByName.get(key)
      if (i.basic) {
        // Básicos de despensa: solo avisamos si están marcados como agotados.
        const row = product && inv.get(product.id)
        if (product && row && row.qty <= 0 && !inList.has(product.id)) basics.set(product.id, product)
        continue
      }
      const cur = agg.get(key) ?? { key, name: product?.name ?? i.name, product, need: 0, dim: dimOf(i.unit), have: null, buyPacks: 0, inList: !!product && inList.has(product.id), uses: [] }
      cur.need += toBaseAmount(i) * e.servings
      if (!cur.uses.includes(r.name)) cur.uses.push(r.name)
      agg.set(key, cur)
    }
  }

  for (const n of agg.values()) {
    n.need = Math.round(n.need * 1000) / 1000
    const p = n.product
    const row = p && inv.get(p.id)
    const sameDim = p && productDim(p) === n.dim
    const pack = p?.pack_size && sameDim ? p.pack_size : null
    if (row) n.have = pack ? row.qty * pack : sameDim ? row.qty : row.qty > 0 ? null : 0
    else n.have = 0
    if (n.inList) { n.buyPacks = 0; continue }
    if (n.have === null) { n.buyPacks = 0; continue } // hay algo y no sabemos cuánto: no lo añadimos
    const missing = n.need - n.have
    if (missing <= 1e-9) n.buyPacks = 0
    else if (pack) n.buyPacks = Math.ceil(missing / pack - 1e-9)
    else if (n.dim === 'ud') n.buyPacks = Math.ceil(missing - 1e-9)
    else n.buyPacks = 1
  }
  const needs = [...agg.values()].sort((a, b) => Number(b.buyPacks > 0) - Number(a.buyPacks > 0) || a.name.localeCompare(b.name, 'es'))
  return { needs, basicsOut: [...basics.values()] }
}

export function needLabel(n: Need): string {
  const v = n.need
  if (n.dim === 'peso') return v < 1 ? `${Math.round(v * 1000)} g` : `${String(Math.round(v * 100) / 100).replace('.', ',')} kg`
  if (n.dim === 'volumen') return v < 1 ? `${Math.round(v * 1000)} ml` : `${String(Math.round(v * 100) / 100).replace('.', ',')} l`
  return `${String(Math.round(v * 100) / 100).replace('.', ',')} ud`
}
