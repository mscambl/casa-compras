import { todayISO, toBase } from './format'
import type { NutrientKey, ProductInfo, Unit } from './types'

// Bases de datos abiertas y gratuitas de la familia Open Food Facts: alimentación,
// cosmética e higiene, comida de mascotas y resto de productos (limpieza, hogar…).
// Solo se envía el número del código de barras.
export const DATABASES = [
  { host: 'world.openfoodfacts.org', label: 'Open Food Facts' },
  { host: 'world.openbeautyfacts.org', label: 'Open Beauty Facts' },
  { host: 'world.openproductsfacts.org', label: 'Open Products Facts' },
  { host: 'world.openpetfoodfacts.org', label: 'Open Pet Food Facts' },
]
const FIELDS = [
  'product_name_es', 'product_name', 'generic_name_es', 'brands', 'quantity', 'product_quantity', 'product_quantity_unit',
  'image_front_url', 'image_url', 'ingredients_text_es', 'ingredients_text', 'allergens_tags', 'traces_tags',
  'nutriments', 'nutriscore_grade', 'nova_group',
].join(',')

/** Comprueba el dígito de control de un EAN-8, UPC-A (12), EAN-13 o GTIN-14. */
export function gtinValid(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Deja solo dígitos y pasa UPC-A (12) a EAN-13, que es como lo guarda Open Food Facts. */
export function normalizeBarcode(raw: string): string {
  const d = raw.replace(/\D/g, '')
  return d.length === 12 ? '0' + d : d
}

const ALLERGENS: Record<string, string> = {
  gluten: 'Gluten', crustaceans: 'Crustáceos', eggs: 'Huevo', fish: 'Pescado', peanuts: 'Cacahuete', soybeans: 'Soja',
  milk: 'Leche', nuts: 'Frutos de cáscara', celery: 'Apio', mustard: 'Mostaza', 'sesame-seeds': 'Sésamo',
  'sulphur-dioxide-and-sulphites': 'Sulfitos', lupin: 'Altramuces', molluscs: 'Moluscos',
}
const allergenLabel = (tag: string) => {
  const [lang, key] = tag.includes(':') ? tag.split(':', 2) : ['', tag]
  if (lang === 'en' && ALLERGENS[key]) return ALLERGENS[key]
  const t = key.replace(/-/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const NUTRIENTS: [NutrientKey, string][] = [
  ['kcal', 'energy-kcal_100g'], ['fat', 'fat_100g'], ['saturated', 'saturated-fat_100g'], ['carbs', 'carbohydrates_100g'],
  ['sugars', 'sugars_100g'], ['fiber', 'fiber_100g'], ['proteins', 'proteins_100g'], ['salt', 'salt_100g'],
]
export const NUTRIENT_LABEL: Record<NutrientKey, string> = {
  kcal: 'Energía', fat: 'Grasas', saturated: 'de las cuales saturadas', carbs: 'Hidratos de carbono',
  sugars: 'de los cuales azúcares', fiber: 'Fibra', proteins: 'Proteínas', salt: 'Sal',
}

export interface OffResult {
  name: string
  info: ProductInfo
  pack: { unit: Unit; size: number } | null
}

type Raw = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Convierte la respuesta de Open Food Facts en lo que guardamos. null si no hay producto. */
export function parseOff(json: unknown, db = 'Open Food Facts'): OffResult | null {
  const j = json as Raw
  if (!j || j.status !== 1 || typeof j.product !== 'object' || !j.product) return null
  const p = j.product as Raw
  const brand = str(p.brands)?.split(',')[0].trim()
  const name = str(p.product_name_es) ?? str(p.product_name) ?? str(p.generic_name_es)
  if (!name && !brand) return null

  const nutr = (p.nutriments ?? {}) as Raw
  const nutrition: ProductInfo['nutrition'] = {}
  for (const [k, src] of NUTRIENTS) {
    const v = Number(nutr[src])
    if (nutr[src] != null && nutr[src] !== '' && Number.isFinite(v)) nutrition[k] = Math.round(v * 10) / 10
  }
  const qUnit = str(p.product_quantity_unit)?.toLowerCase()
  const qty = Number(p.product_quantity)
  let pack: OffResult['pack'] = null
  if (Number.isFinite(qty) && qty > 0 && (qUnit === 'g' || qUnit === 'ml' || qUnit === 'kg' || qUnit === 'l' || qUnit === 'm' || qUnit === 'cm')) pack = toBase(qty, qUnit)
  const grade = str(p.nutriscore_grade)?.toLowerCase()
  const nova = Number(p.nova_group)
  const tags = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === 'string').map(allergenLabel))] : [])
  const allergens = tags(p.allergens_tags)
  const traces = tags(p.traces_tags).filter((t) => !allergens.includes(t))

  const info: ProductInfo = {
    source: 'off',
    db,
    fetched_on: todayISO(),
    brand,
    quantity: str(p.quantity),
    image_url: str(p.image_front_url) ?? str(p.image_url),
    ingredients: str(p.ingredients_text_es) ?? str(p.ingredients_text),
    allergens: allergens.length ? allergens : undefined,
    traces: traces.length ? traces : undefined,
    nutriscore: grade && /^[a-e]$/.test(grade) ? (grade as ProductInfo['nutriscore']) : undefined,
    nova: Number.isInteger(nova) && nova >= 1 && nova <= 4 ? nova : undefined,
    nutrition: Object.keys(nutrition).length ? nutrition : undefined,
    per: qUnit === 'ml' || qUnit === 'l' ? '100 ml' : '100 g',
  }
  // Sin claves vacías: el jsonb queda limpio.
  for (const k of Object.keys(info) as (keyof ProductInfo)[]) if (info[k] === undefined) delete info[k]
  return { name: (name ?? brand!).slice(0, 80), info, pack }
}

async function lookupIn(db: (typeof DATABASES)[number], code: string, signal: AbortSignal): Promise<OffResult | null> {
  const res = await fetch(`https://${db.host}/api/v2/product/${encodeURIComponent(code)}.json?lc=es&fields=${FIELDS}`, { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${db.label} respondió ${res.status}`)
  return parseOff(await res.json(), db.label)
}

/**
 * Busca un código en las cuatro bases a la vez y se queda con la primera que lo
 * conozca (por orden de la lista). null si ninguna lo conoce; lanza si no hay red.
 */
export async function lookupBarcode(code: string): Promise<OffResult | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const all = await Promise.allSettled(DATABASES.map((db) => lookupIn(db, code, ctrl.signal)))
    for (const r of all) if (r.status === 'fulfilled' && r.value) return r.value
    if (all.every((r) => r.status === 'rejected')) throw (all[0] as PromiseRejectedResult).reason
    return null
  } finally {
    clearTimeout(t)
  }
}
