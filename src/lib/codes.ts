import type { Lot, Product, ProductCode } from './types'

// ---------------------------------------------------------------------------
// Varios códigos por producto: el del envase suelto (1 ud) y los de packs (6 ud…).
// `barcode` sigue siendo el código principal (el que se consulta en Open Food Facts);
// `codes` guarda todos con sus unidades. Si el principal no está en `codes`, vale 1 ud.
// ---------------------------------------------------------------------------

export function codesOf(p: Product): ProductCode[] {
  const list = (p.codes ?? []).filter((c) => c && c.code)
  if (p.barcode && !list.some((c) => c.code === p.barcode)) return [{ code: p.barcode, units: 1 }, ...list]
  return list
}

export function findByCode(products: Product[], code: string): { product: Product; units: number } | null {
  for (const p of products) {
    const c = codesOf(p).find((x) => x.code === code)
    if (c) return { product: p, units: Math.max(1, c.units || 1) }
  }
  return null
}

/** Añade o cambia un código. Devuelve el parche para el producto. */
export function withCode(p: Product, code: string, units: number): Pick<Product, 'codes' | 'barcode'> {
  const u = Math.max(1, Math.round(units) || 1)
  const list = codesOf(p).filter((c) => c.code !== code)
  // El código suelto (1 ud) va primero: es el que mejor describe el producto.
  const next = u === 1 ? [{ code, units: u }, ...list] : [...list, { code, units: u }]
  return { codes: next, barcode: p.barcode ?? code }
}

export function withoutCode(p: Product, code: string): Pick<Product, 'codes' | 'barcode'> {
  const next = codesOf(p).filter((c) => c.code !== code)
  const barcode = p.barcode === code ? (next[0]?.code ?? null) : (p.barcode ?? null)
  return { codes: next, barcode }
}

/** «4 x 125 g», «pack 6 x 1 l», «12 rollos»… → unidades del pack (null si no se deduce). */
export function packUnitsFromQuantity(q?: string): number | null {
  if (!q) return null
  const m = q.match(/(\d+)\s*[x×]\s*\d/i) ?? q.match(/^\s*(?:pack\s*(?:de\s*)?)?(\d+)\s*(?:ud|uds|unidades|rollos|bolsas|latas|botellas|briks?)\b/i)
  const n = m ? Number(m[1]) : NaN
  return Number.isInteger(n) && n > 1 && n <= 100 ? n : null
}

// ---------------------------------------------------------------------------
// Lotes: lo que hay en casa repartido por fechas de caducidad. Lo que no está en
// ningún lote es «sin fecha». Se gasta primero lo que caduca antes.
// ---------------------------------------------------------------------------

const r3 = (n: number) => Math.round(n * 1000) / 1000
export const sortLots = (lots: Lot[]) => lots.filter((l) => l.qty > 0).slice().sort((a, b) => a.expires_on.localeCompare(b.expires_on))
export const datedQty = (lots: Lot[]) => r3(lots.reduce((s, l) => s + Math.max(0, l.qty), 0))
export const earliestLot = (lots: Lot[]) => sortLots(lots)[0]?.expires_on ?? null

/** Quita `amount` empezando por el lote que caduca antes. */
export function consumeLots(lots: Lot[], amount: number): Lot[] {
  let left = amount
  const out: Lot[] = []
  for (const l of sortLots(lots)) {
    const take = Math.min(l.qty, Math.max(0, left))
    left = r3(left - take)
    if (l.qty - take > 1e-9) out.push({ ...l, qty: r3(l.qty - take) })
  }
  return out
}

/** Asegura que los lotes no suman más de lo que hay. */
export const fitLots = (lots: Lot[], qty: number): Lot[] => {
  const extra = datedQty(lots) - qty
  return extra > 1e-9 ? consumeLots(lots, extra) : sortLots(lots)
}

/** Nuevos lotes al pasar de `from` a `to` unidades: si baja, se gasta lo que caduca antes. */
export function lotsAfterStock(lots: Lot[], from: number, to: number): Lot[] {
  const used = to < from ? consumeLots(lots, r3(from - to)) : sortLots(lots)
  return fitLots(used, to)
}
