import { round2 } from './format'

// ---------------------------------------------------------------------------
// Una compra con productos de varias tiendas se guarda como una compra por tienda.
// ---------------------------------------------------------------------------

export interface StoreGroup<T> { store: string; lines: T[] }

/** Agrupa por tienda, en el orden en que aparece cada una. '' es «sin indicar». */
export function groupByStore<T extends { store: string }>(lines: T[], first?: string): StoreGroup<T>[] {
  const groups = new Map<string, T[]>()
  if (first != null) groups.set(first, [])
  for (const l of lines) {
    if (!groups.has(l.store)) groups.set(l.store, [])
    groups.get(l.store)!.push(l)
  }
  return [...groups.entries()].filter(([s, ls]) => ls.length || s === first).map(([store, ls]) => ({ store, lines: ls }))
}

export const linesSum = (totals: (number | null)[]) => round2(totals.reduce<number>((a, t) => a + (t ?? 0), 0))

/**
 * Importe propuesto para cada parte al editar: las partes nuevas pagan lo que suman sus
 * líneas; la original conserva la diferencia que tenía el ticket con sus líneas
 * (descuentos o gasto sin desglosar).
 */
export function suggestedTotal(isMain: boolean, partLines: number, original?: { total: number; lines: number }): number {
  if (!isMain || !original) return round2(partLines)
  return Math.max(0, round2(original.total - original.lines + partLines))
}
