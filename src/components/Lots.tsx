import { useState } from 'react'
import { useStore, uid } from '../lib/store'
import { inventoryFor, setStock } from '../lib/actions'
import { datedQty, earliestLot, fitLots, sortLots } from '../lib/codes'
import { qtyFmt, shortDate } from '../lib/format'
import type { Lot, Product } from '../lib/types'
import { Icon, toast } from './ui'

/**
 * Caducidades por lotes: «4 caducan el 2 nov, 6 el 15 nov». Lo que no está en ningún
 * lote es «sin fecha». Al gastar desde la app se descuenta primero lo que caduca antes.
 */
export function LotsEditor({ product, onQty }: { product: Product; onQty: (qty: number) => void }) {
  const row = useStore(() => inventoryFor(product.id))
  const [qty, setQty] = useState('1')
  const [date, setDate] = useState('')
  const total = row?.qty ?? 0
  // Lotes guardados; una fecha antigua sin lotes cuenta como un lote de todo lo que hay.
  const lots: Lot[] = row?.lots?.length
    ? fitLots(row.lots, total)
    : row?.expires_on && total > 0 ? [{ id: 'unica', qty: total, expires_on: row.expires_on }] : []
  const undated = Math.max(0, Math.round((total - datedQty(lots)) * 1000) / 1000)

  const save = (next: Lot[], newTotal = total) => {
    const clean = sortLots(next.map((l) => (l.id === 'unica' ? { ...l, id: uid() } : l)))
    setStock(product, newTotal, { lots: clean, expires_on: earliestLot(clean) })
    if (newTotal !== total) onQty(newTotal)
  }
  const add = () => {
    const n = Number(qty.replace(',', '.'))
    if (!(n > 0)) return toast('Pon cuántas unidades caducan en esa fecha', 'error')
    if (!date) return toast('Elige la fecha de caducidad', 'error')
    const same = lots.find((l) => l.expires_on === date)
    const next = same ? lots.map((l) => (l === same ? { ...l, qty: l.qty + n } : l)) : [...lots, { id: uid(), qty: n, expires_on: date }]
    // Si las fechas suman más de lo que había, es que hay más en casa.
    save(next, Math.max(total, datedQty(next)))
    setDate('')
    setQty('1')
  }

  return (
    <div className="stack" data-testid="lots">
      <div className="small muted">Caducidades{total > 0 ? ` · ${qtyFmt(total)} en casa` : ''}</div>
      {lots.length > 0 && (
        <div className="list">
          {lots.map((l) => (
            <div className="li" key={l.id} data-testid="lot">
              <div className="grow"><b className="num">{qtyFmt(l.qty)}</b> caducan el {shortDate(l.expires_on)}</div>
              <button className="icon-btn" aria-label={`Quitar fecha ${shortDate(l.expires_on)}`} onClick={() => save(lots.filter((x) => x !== l))}><Icon name="x" /></button>
            </div>
          ))}
          {undated > 0 && <div className="li"><div className="grow muted"><span className="num">{qtyFmt(undated)}</span> sin fecha</div></div>}
        </div>
      )}
      <div className="row">
        <input className="input" style={{ width: 70 }} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Unidades que caducan" />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha de caducidad" />
        <button className="btn sm" onClick={add}>Añadir</button>
      </div>
    </div>
  )
}
