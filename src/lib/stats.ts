import type { AppEvent, Budget, BudgetGroup, InventoryRow, Product, ShoppingItem } from './types'
import type { PurchaseWithLines } from './store'
import { addMonths, daysBetween, round2 } from './format'

export interface MonthSpend {
  total: number
  byGroup: Record<BudgetGroup, number>
  /** Importe pagado que no está desglosado en líneas (p. ej. compra registrada solo con total). */
  unassigned: number
  byStore: Map<string | null, number>
  count: number
  unplanned: number
}

const zeroGroups = (): Record<BudgetGroup, number> => ({ alimentacion: 0, limpieza: 0, higiene: 0, papel_lavanderia: 0, otros: 0 })

export function inMonth(dateISO: string, monthISO: string) {
  return dateISO.slice(0, 7) === monthISO.slice(0, 7)
}

/** Gasto de un mes. Si untilDay se indica, solo cuenta hasta ese día (para comparar periodos equivalentes). */
export function monthSpend(purchases: PurchaseWithLines[], monthISO: string, untilDay?: number): MonthSpend {
  const r: MonthSpend = { total: 0, byGroup: zeroGroups(), unassigned: 0, byStore: new Map(), count: 0, unplanned: 0 }
  for (const p of purchases) {
    if (!inMonth(p.purchased_on, monthISO)) continue
    if (untilDay != null && Number(p.purchased_on.slice(8, 10)) > untilDay) continue
    r.total += p.total_paid
    r.count++
    if (p.unplanned) r.unplanned++
    r.byStore.set(p.store_id, (r.byStore.get(p.store_id) ?? 0) + p.total_paid)
    let linesSum = 0
    for (const l of p.purchase_lines) {
      r.byGroup[l.grp] += l.line_total
      linesSum += l.line_total
    }
    // Si el ticket es mayor que la suma de líneas, la diferencia queda sin desglosar.
    // Si es menor (descuentos globales), repartimos el descuento en proporción.
    const diff = p.total_paid - linesSum
    if (diff > 0.005) r.unassigned += diff
    else if (diff < -0.005 && linesSum > 0) {
      const factor = p.total_paid / linesSum
      for (const l of p.purchase_lines) r.byGroup[l.grp] -= l.line_total * (1 - factor)
    }
  }
  r.total = round2(r.total)
  r.unassigned = round2(r.unassigned)
  for (const g of Object.keys(r.byGroup) as BudgetGroup[]) r.byGroup[g] = round2(r.byGroup[g])
  return r
}

/**
 * Previsión lineal a fin de mes: ritmo diario hasta hoy × días del mes.
 * Con menos de 7 días de datos es poco fiable y se marca como tal.
 */
export function forecast(spent: number, todayISO: string): { value: number; reliable: boolean } {
  const [y, m, d] = todayISO.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  return { value: round2((spent / d) * days), reliable: d >= 7 }
}

/** Presupuesto vigente para un mes: el del propio mes o el último anterior definido. */
export function budgetFor(budgets: Budget[], monthISO: string, grp: Budget['grp']): number | null {
  let best: Budget | null = null
  for (const b of budgets) {
    if (b.grp !== grp || b.month > monthISO) continue
    if (!best || b.month > best.month) best = b
  }
  return best ? best.amount : null
}

export interface ProductSpend { productId: string | null; name: string; total: number; qty: number }
export function topProducts(purchases: PurchaseWithLines[], monthISO: string, n = 5): ProductSpend[] {
  const m = new Map<string, ProductSpend>()
  for (const p of purchases) {
    if (!inMonth(p.purchased_on, monthISO)) continue
    for (const l of p.purchase_lines) {
      const k = l.product_id ?? l.name
      const cur = m.get(k) ?? { productId: l.product_id, name: l.name, total: 0, qty: 0 }
      cur.total += l.line_total
      cur.qty += l.qty
      m.set(k, cur)
    }
  }
  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, n).map((x) => ({ ...x, total: round2(x.total) }))
}

// ---------------------------------------------------------------------------
// Avisos: caducidad, mínimos y reposición
// ---------------------------------------------------------------------------

export interface Alert {
  product: Product
  kind: 'caduca' | 'caducado' | 'minimo' | 'reponer'
  urgency: 'urgente' | 'pronto' | 'puede_esperar'
  text: string
}

export function lastPurchaseDate(purchases: PurchaseWithLines[], productId: string): string | null {
  for (const p of purchases) {
    // purchases viene ordenado de más reciente a más antiguo
    if (p.purchase_lines.some((l) => l.product_id === productId)) return p.purchased_on
  }
  return null
}

/** Intervalo medio entre compras de un producto (días), con al menos 3 compras. */
export function avgInterval(purchases: PurchaseWithLines[], productId: string): number | null {
  const dates = [...new Set(purchases.filter((p) => p.purchase_lines.some((l) => l.product_id === productId)).map((p) => p.purchased_on))].sort()
  if (dates.length < 3) return null
  const gaps: number[] = []
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]))
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
}

export function alerts(
  products: Product[], inventory: InventoryRow[], items: ShoppingItem[], purchases: PurchaseWithLines[], todayISO: string,
): Alert[] {
  const out: Alert[] = []
  const inList = new Set(items.map((i) => i.product_id))
  const byId = new Map(products.map((p) => [p.id, p]))
  for (const row of inventory) {
    const p = byId.get(row.product_id)
    if (!p || !row.expires_on || row.qty <= 0) continue
    const d = daysBetween(todayISO, row.expires_on)
    if (d < 0) out.push({ product: p, kind: 'caducado', urgency: 'urgente', text: `Caducó hace ${-d} ${-d === 1 ? 'día' : 'días'}` })
    else if (d <= 3) out.push({ product: p, kind: 'caduca', urgency: 'urgente', text: d === 0 ? 'Caduca hoy' : `Caduca en ${d} ${d === 1 ? 'día' : 'días'}` })
    else if (d <= 7) out.push({ product: p, kind: 'caduca', urgency: 'pronto', text: `Caduca en ${d} días` })
  }
  const stock = new Map(inventory.map((r) => [r.product_id, r.qty]))
  for (const p of products) {
    if (inList.has(p.id)) continue
    const q = stock.get(p.id)
    if (p.min_qty != null && p.min_qty > 0 && (q ?? 0) < p.min_qty) {
      out.push({ product: p, kind: 'minimo', urgency: (q ?? 0) === 0 ? 'urgente' : 'pronto', text: (q ?? 0) === 0 ? 'Agotado' : `Quedan ${q} (mínimo ${p.min_qty})` })
      continue
    }
    const every = p.restock_days ?? avgInterval(purchases, p.id)
    if (!every) continue
    const last = lastPurchaseDate(purchases, p.id)
    if (!last) continue
    const due = every - daysBetween(last, todayISO)
    if (due <= 0) out.push({ product: p, kind: 'reponer', urgency: 'pronto', text: `Se suele comprar cada ${every} días` })
    else if (due <= 3) out.push({ product: p, kind: 'reponer', urgency: 'puede_esperar', text: `Toca reponer en ${due} ${due === 1 ? 'día' : 'días'}` })
  }
  const order = { urgente: 0, pronto: 1, puede_esperar: 2 }
  return out.sort((a, b) => order[a.urgency] - order[b.urgency])
}

// ---------------------------------------------------------------------------
// Métricas del hogar
// ---------------------------------------------------------------------------

export interface Metrics {
  avgBasket: number | null
  unplanned: number
  duplicatesAvoided: number
  wastedValue: number
  wastedCount: number
  minutesInApp: number
}

export function metrics(purchases: PurchaseWithLines[], events: AppEvent[], monthISO: string): Metrics {
  const ps = purchases.filter((p) => inMonth(p.purchased_on, monthISO))
  const ev = events.filter((e) => inMonth(e.created_at.slice(0, 10), monthISO))
  const wasted = ev.filter((e) => e.kind === 'wasted')
  return {
    avgBasket: ps.length ? round2(ps.reduce((a, p) => a + p.total_paid, 0) / ps.length) : null,
    unplanned: ps.filter((p) => p.unplanned).length,
    duplicatesAvoided: ev.filter((e) => e.kind === 'duplicate_avoided').length,
    wastedValue: round2(wasted.reduce((a, e) => a + (Number(e.data.value) || 0), 0)),
    wastedCount: wasted.length,
    minutesInApp: Math.round(ev.filter((e) => e.kind === 'session').reduce((a, e) => a + (Number(e.data.seconds) || 0), 0) / 60),
  }
}

export const prevMonth = (monthISO: string) => addMonths(monthISO, -1)
