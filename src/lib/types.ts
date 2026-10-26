export type BudgetGroup = 'alimentacion' | 'limpieza' | 'higiene' | 'papel_lavanderia' | 'otros'
export type Unit = 'ud' | 'kg' | 'l' | 'dosis' | 'm'
export type Location = 'nevera' | 'congelador' | 'despensa' | 'bano' | 'limpieza' | 'otro'
export type PriceSource = 'ticket' | 'manual' | 'estimado' | 'oferta'

export const GROUPS: { id: BudgetGroup; label: string }[] = [
  { id: 'alimentacion', label: 'Alimentación' },
  { id: 'limpieza', label: 'Limpieza' },
  { id: 'higiene', label: 'Higiene' },
  { id: 'papel_lavanderia', label: 'Papel y lavandería' },
  { id: 'otros', label: 'Otros' },
]

export const LOCATIONS: { id: Location; label: string }[] = [
  { id: 'nevera', label: 'Nevera' },
  { id: 'congelador', label: 'Congelador' },
  { id: 'despensa', label: 'Despensa' },
  { id: 'bano', label: 'Baño' },
  { id: 'limpieza', label: 'Limpieza' },
  { id: 'otro', label: 'Otro' },
]

export interface Household { id: string; name: string; prefs?: Prefs }
export interface Member { household_id: string; user_id: string; display_name: string; email: string | null }

export interface Store {
  id: string
  household_id: string
  name: string
  travel: 'andando' | 'coche' | 'online'
  sort: number
  active: boolean
}

export interface Category {
  id: string
  household_id: string
  name: string
  grp: BudgetGroup
  sort: number
}

export interface Product {
  id: string
  household_id: string
  name: string
  name_norm?: string
  category_id: string | null
  unit: Unit
  pack_size: number | null
  usual_store_id: string | null
  is_staple: boolean
  min_qty: number | null
  restock_days: number | null
  location: Location | null
  last_price: number | null
  notes: string | null
  archived: boolean
  /** Solo existen cuando se ha aplicado la migración de fotos. */
  barcode?: string | null
  photos?: string[]
  info?: ProductInfo | null
  created_at?: string
}

export interface ShoppingItem {
  id: string
  household_id: string
  product_id: string
  qty: number
  est_price: number | null
  store_id: string | null
  note: string | null
  added_by: string | null
  added_at: string
  checked: boolean
  checked_by: string | null
  checked_at: string | null
  purchase_id: string | null
}

export interface InventoryRow {
  id: string
  household_id: string
  product_id: string
  qty: number
  location: Location | null
  expires_on: string | null
  updated_by: string | null
  updated_at: string
}

export interface Purchase {
  id: string
  household_id: string
  store_id: string | null
  purchased_on: string
  total_paid: number
  paid_by: string | null
  source: 'lista' | 'manual' | 'foto' | 'pdf'
  unplanned: boolean
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface PurchaseLine {
  id: string
  household_id: string
  purchase_id: string
  product_id: string | null
  name: string
  qty: number
  unit: Unit
  pack_size: number | null
  line_total: number
  discount: number
  grp: BudgetGroup
}

export interface PriceObservation {
  id: string
  household_id: string
  product_id: string
  store_id: string | null
  observed_on: string
  price: number
  unit: Unit
  pack_size: number | null
  unit_price: number | null
  source: PriceSource
}

export interface Budget { household_id: string; month: string; grp: BudgetGroup | 'total'; amount: number }

export interface AppEvent {
  id: string
  household_id: string
  user_id: string | null
  kind: 'duplicate_avoided' | 'ran_out' | 'wasted' | 'purchase_closed' | 'session'
  product_id: string | null
  data: Record<string, unknown>
  created_at: string
}

export type MealSlot = 'comida' | 'cena'
export type Equipment = 'ninguno' | 'microondas' | 'fuego' | 'horno'

export interface Ingredient { name: string; amount: number; unit: 'g' | 'kg' | 'ml' | 'l' | 'ud'; basic: boolean }

export interface Recipe {
  id: string
  household_id: string
  name: string
  slot: MealSlot | 'ambas'
  prep_min: number
  equipment: Equipment
  tags: string[]
  ingredients: Ingredient[]
  steps: string | null
  active: boolean
  /** Para cuántas personas son las cantidades (solo existe con la migración de raciones). */
  yields?: number
}

export interface PlanEntry {
  id: string
  household_id: string
  day: string
  slot: MealSlot
  recipe_id: string | null
  servings: number
  status: 'plan' | 'fuera' | 'sobras'
  note: string | null
  updated_by?: string | null
}

export interface Prefs {
  excluded?: string[]
  maxPrep?: number
  equipment?: Equipment[]
  /** Raciones por defecto de la comida entre semana (Mike = 1). */
  lunchServings?: number
  dinnerServings?: number
  weekendLunch?: boolean
  /** Da prioridad a las recetas con la etiqueta «ligera». */
  preferLight?: boolean
}

export const DEFAULT_PREFS: Required<Prefs> = {
  excluded: [],
  maxPrep: 30,
  equipment: ['ninguno', 'microondas', 'fuego', 'horno'],
  lunchServings: 1,
  dinnerServings: 2,
  weekendLunch: false,
  preferLight: false,
}

export type NutrientKey = 'kcal' | 'fat' | 'saturated' | 'carbs' | 'sugars' | 'fiber' | 'proteins' | 'salt'

/** Datos del envase. Hoy vienen de Open Food Facts (base de datos abierta). */
export interface ProductInfo {
  source: 'off'
  /** Base concreta: Open Food Facts, Open Beauty Facts, Open Products Facts… */
  db?: string
  fetched_on: string
  brand?: string
  quantity?: string
  image_url?: string
  ingredients?: string
  allergens?: string[]
  traces?: string[]
  nutriscore?: 'a' | 'b' | 'c' | 'd' | 'e'
  nova?: number
  nutrition?: Partial<Record<NutrientKey, number>>
  per?: '100 g' | '100 ml'
}
