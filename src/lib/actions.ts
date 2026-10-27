import { getState, remove, update, upsert, uid } from './store'
import type { InventoryRow, Location, Product, ShoppingItem, Unit } from './types'
import { cap, guessCategoryName, norm } from './text'
import { earliestLot, lotsAfterStock } from './codes'

const hid = () => getState().household!.id
const me = () => getState().userId

export function findProductByName(name: string): Product | undefined {
  const n = norm(name)
  return getState().products.find((p) => norm(p.name) === n)
}

export function createProduct(name: string, extra: Partial<Product> = {}): Product {
  const s = getState()
  const catName = guessCategoryName(name)
  const cat = catName ? s.categories.find((c) => c.name === catName) : undefined
  const p: Product = {
    id: uid(),
    household_id: hid(),
    name: cap(name),
    category_id: cat?.id ?? null,
    unit: 'ud',
    pack_size: null,
    usual_store_id: null,
    is_staple: false,
    min_qty: null,
    restock_days: null,
    location: defaultLocation(cat?.name),
    last_price: null,
    notes: null,
    archived: false,
    ...extra,
  }
  upsert('products', p)
  return p
}

function defaultLocation(catName?: string): Location | null {
  switch (catName) {
    case 'Fruta y verdura': case 'Carne y pescado': case 'Lácteos y huevos': case 'Platos preparados': return 'nevera'
    case 'Congelados': return 'congelador'
    case 'Panadería': case 'Despensa': case 'Bebidas': return 'despensa'
    case 'Higiene personal': return 'bano'
    case 'Limpieza': case 'Lavandería': case 'Papel': return 'limpieza'
    default: return null
  }
}

export function getOrCreateProduct(name: string): Product {
  return findProductByName(name) ?? createProduct(name)
}

export function itemForProduct(productId: string): ShoppingItem | undefined {
  return getState().items.find((i) => i.product_id === productId)
}

/** Añade a la lista. Si ya está, no duplica: devuelve el existente para que la UI ofrezca sumar. */
export function addToList(product: Product, qty = 1): { item: ShoppingItem; duplicate: boolean } {
  const existing = itemForProduct(product.id)
  if (existing) {
    upsert('events', { id: uid(), household_id: hid(), kind: 'duplicate_avoided', product_id: product.id, data: {}, user_id: me(), created_at: new Date().toISOString() })
    return { item: existing, duplicate: true }
  }
  const item: ShoppingItem = {
    id: uid(),
    household_id: hid(),
    product_id: product.id,
    qty,
    est_price: null,
    store_id: null,
    note: null,
    added_by: me(),
    added_at: new Date().toISOString(),
    checked: false,
    checked_by: null,
    checked_at: null,
    purchase_id: null,
  }
  upsert('shopping_items', item)
  return { item, duplicate: false }
}

export function setItemQty(item: ShoppingItem, qty: number) {
  if (qty <= 0) return removeItem(item)
  update('shopping_items', item.id, { qty })
}

export function toggleItem(item: ShoppingItem) {
  const checked = !item.checked
  update('shopping_items', item.id, {
    checked,
    checked_by: checked ? me() : null,
    checked_at: checked ? new Date().toISOString() : null,
  })
}

export function removeItem(item: ShoppingItem) {
  remove('shopping_items', item.id)
}

export function updateItem(item: ShoppingItem, patch: Partial<ShoppingItem>) {
  update('shopping_items', item.id, patch as Record<string, unknown>)
}

export function updateProduct(p: Product, patch: Partial<Product>) {
  update('products', p.id, patch as Record<string, unknown>)
}

export function archiveProduct(p: Product) {
  const item = itemForProduct(p.id)
  if (item) removeItem(item)
  update('products', p.id, { archived: true })
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

export function inventoryFor(productId: string): InventoryRow | undefined {
  return getState().inventory.find((r) => r.product_id === productId)
}

export function setStock(product: Product, qty: number, patch: Partial<InventoryRow> = {}) {
  const row = inventoryFor(product.id)
  const q = Math.max(0, Math.round(qty * 1000) / 1000)
  if (row) {
    // Con lotes: al bajar se gasta primero lo que caduca antes, y la fecha visible es la más próxima.
    if (row.lots?.length && !patch.lots) {
      const lots = lotsAfterStock(row.lots, row.qty, q)
      patch = { ...patch, lots, expires_on: earliestLot(lots) }
    }
    update('inventory', row.id, { qty: q, updated_by: me(), ...patch })
  } else {
    upsert('inventory', {
      id: uid(), household_id: hid(), product_id: product.id, qty: q, location: product.location, expires_on: null,
      updated_by: me(), updated_at: new Date().toISOString(), ...patch,
    })
  }
}

export function ranOut(product: Product) {
  setStock(product, 0, { expires_on: null })
  upsert('events', { id: uid(), household_id: hid(), kind: 'ran_out', product_id: product.id, data: {}, user_id: me(), created_at: new Date().toISOString() })
}

/** Registra producto tirado. El valor es una estimación con el último precio conocido. */
export function wasted(product: Product, qty: number) {
  const row = inventoryFor(product.id)
  const value = product.last_price != null ? Math.round(product.last_price * qty * 100) / 100 : null
  upsert('events', {
    id: uid(), household_id: hid(), kind: 'wasted', product_id: product.id, data: { qty, value }, user_id: me(), created_at: new Date().toISOString(),
  })
  if (row) setStock(product, row.qty - qty)
}

export function removeFromInventory(row: InventoryRow) {
  remove('inventory', row.id)
}

// ---------------------------------------------------------------------------
// Presupuesto y otros
// ---------------------------------------------------------------------------

export function setBudget(month: string, grp: string, amount: number | null) {
  const key = `${month}|${grp}`
  if (amount == null) {
    remove('budgets', key)
  } else {
    upsert('budgets', { household_id: hid(), month, grp, amount })
  }
}

export function logSession(seconds: number) {
  if (!getState().household || seconds < 5) return
  upsert('events', { id: uid(), household_id: hid(), kind: 'session', product_id: null, data: { seconds: Math.round(seconds) }, user_id: me(), created_at: new Date().toISOString() })
}

export function setPack(p: Product, unit: Unit, size: number | null) {
  updateProduct(p, { unit, pack_size: size })
}
