import type { Unit } from './types'

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })

export const money = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '—' : eur.format(n))
export const qtyFmt = (n: number) => num.format(n)

/** Convierte texto con coma o punto decimal a número. Devuelve null si no es válido. */
export function parseNum(s: string | number | null | undefined): number | null {
  if (s == null) return null
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const t = s.trim().replace(/\s/g, '').replace('€', '')
  if (!t) return null
  // "1.234,56" -> 1234.56 ; "1,5" -> 1.5 ; "1.5" -> 1.5
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** Unidad de entrada (lo que escribe el usuario) -> unidad comparable. */
export type InputUnit = 'g' | 'kg' | 'ml' | 'l' | 'ud' | 'dosis'
export const INPUT_UNITS: InputUnit[] = ['ud', 'g', 'kg', 'ml', 'l', 'dosis']

export function toBase(size: number, u: InputUnit): { unit: Unit; size: number } {
  switch (u) {
    case 'g': return { unit: 'kg', size: size / 1000 }
    case 'ml': return { unit: 'l', size: size / 1000 }
    default: return { unit: u, size }
  }
}

/** Formato legible: 0.5 kg -> "500 g", 1.5 l -> "1,5 l", 12 ud -> "12 ud". */
export function packLabel(unit: Unit, size: number | null): string {
  if (!size) return ''
  if (unit === 'kg' && size < 1) return `${num.format(round3(size * 1000))} g`
  if (unit === 'l' && size < 1) return `${num.format(round3(size * 1000))} ml`
  return `${num.format(size)} ${unit}`
}

/** Valores para editar un formato guardado en la unidad más natural. */
export function packInput(unit: Unit, size: number | null): { size: string; unit: InputUnit } {
  if (!size) return { size: '', unit: unit }
  if (unit === 'kg' && size < 1) return { size: String(round3(size * 1000)), unit: 'g' }
  if (unit === 'l' && size < 1) return { size: String(round3(size * 1000)), unit: 'ml' }
  return { size: String(size), unit }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Precio por unidad comparable (€/kg, €/l, €/ud, €/dosis). */
export function unitPrice(price: number | null | undefined, packSize: number | null | undefined): number | null {
  if (price == null || !packSize || packSize <= 0) return null
  return price / packSize
}

export function unitPriceLabel(price: number | null | undefined, unit: Unit, packSize: number | null | undefined): string {
  const up = unitPrice(price, packSize)
  if (up == null) return ''
  return `${eur.format(up)}/${unit}`
}

export function pctChange(now: number, before: number): number | null {
  if (!before) return null
  return (now - before) / before
}

export const pctFmt = (p: number) => `${p > 0 ? '+' : ''}${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(p * 100)} %`

export const todayISO = () => isoDate(new Date())
export function isoDate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export const monthKey = (iso: string) => iso.slice(0, 7) + '-01'
export function daysBetween(aISO: string, bISO: string) {
  return Math.round((Date.parse(bISO + 'T00:00:00') - Date.parse(aISO + 'T00:00:00')) / 86400000)
}
export function addMonths(monthISO: string, n: number) {
  const [y, m] = monthISO.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return isoDate(d)
}
export function monthLabel(monthISO: string) {
  const [y, m] = monthISO.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
export function shortDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}
export function addDaysISO(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDate(new Date(y, m - 1, d + n))
}
