import { useMemo, useState } from 'react'
import { flush, getState, refresh, reloadPurchases, rpcNow, uid, useStore } from '../lib/store'
import { getOrCreateProduct } from '../lib/actions'
import { money, parseNum, round2, todayISO } from '../lib/format'
import type { Product, ShoppingItem } from '../lib/types'
import { ProductSearch } from './ProductSearch'
import { Icon, Sheet, toast } from './ui'

interface Line { key: string; product: Product; qty: string; total: string; itemId: string | null }

const fmt = (n: number | null) => (n == null ? '' : String(round2(n)).replace('.', ','))

function initialLines(items: ShoppingItem[], products: Product[]): Line[] {
  return items.flatMap((i) => {
    const p = products.find((x) => x.id === i.product_id)
    if (!p) return []
    const unit = i.est_price ?? p.last_price
    return [{ key: i.id, product: p, qty: String(i.qty).replace('.', ','), total: fmt(unit != null ? unit * i.qty : null), itemId: i.id }]
  })
}

/** Cerrar la compra desde la lista (líneas = lo marcado) o registrar una compra manual. */
export function PurchaseSheet({ items, onClose }: { items: ShoppingItem[]; onClose: () => void }) {
  const products = useStore((s) => s.products)
  const stores = useStore((s) => s.stores)
  const members = useStore((s) => s.members)
  const purchases = useStore((s) => s.purchases)
  const userId = useStore((s) => s.userId)

  const defaultStore = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) {
      const p = products.find((x) => x.id === i.product_id)
      const s = i.store_id ?? p?.usual_store_id
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    return top ?? purchases[0]?.store_id ?? ''
  }, [items, products, purchases])

  const [lines, setLines] = useState<Line[]>(() => initialLines(items, products))
  const [store, setStore] = useState(defaultStore)
  const [date, setDate] = useState(todayISO())
  const [total, setTotal] = useState('')
  const [paidBy, setPaidBy] = useState(userId ?? '')
  const [unplanned, setUnplanned] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [opId] = useState(uid) // mismo id en reintentos: el servidor no duplica la compra

  const linesSum = round2(lines.reduce((a, l) => a + (parseNum(l.total) ?? 0), 0))
  const missing = lines.filter((l) => parseNum(l.total) == null).length
  const totalNum = parseNum(total) ?? linesSum

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const submit = async () => {
    if (!navigator.onLine) return toast('Necesitas conexión para cerrar la compra. Lo marcado se queda guardado.', 'error')
    if (totalNum < 0) return toast('El importe no puede ser negativo', 'error')
    if (!lines.length && !parseNum(total)) return toast('Añade productos o el importe del ticket', 'error')
    for (const l of lines) {
      const q = parseNum(l.qty)
      if (!q || q <= 0) return toast(`Cantidad no válida en ${l.product.name}`, 'error')
    }
    setBusy(true)
    try {
      // Los productos nuevos tienen que existir en el servidor antes de la compra.
      await flush()
      if (getState().pending) throw new Error('hay cambios pendientes de enviar; inténtalo en unos segundos')
      await rpcNow('close_purchase', {
        p_household: getState().household!.id,
        p_store: store || null,
        p_date: date,
        p_total: totalNum,
        p_paid_by: paidBy || null,
        p_unplanned: unplanned,
        p_lines: lines.map((l) => ({ product_id: l.product.id, qty: parseNum(l.qty), line_total: parseNum(l.total), shopping_item_id: l.itemId })),
        p_notes: notes,
        p_source: items.length ? 'lista' : 'manual',
        p_purchase_id: opId,
      })
      await Promise.all([refresh(), reloadPurchases()])
      toast(`Compra guardada: ${money(totalNum)}`)
      onClose()
    } catch (e) {
      toast('No se pudo guardar la compra: ' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={items.length ? 'Cerrar compra' : 'Registrar compra'} onClose={onClose}>
      <div className="stack">
        <div className="grid2">
          <label className="field"><span>Tienda</span>
            <select className="input" value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">Sin indicar</option>
              {stores.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Fecha</span><input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
        </div>

        <h2>Productos · precio pagado por línea</h2>
        {lines.length > 0 && (
          <div className="list">
            {lines.map((l) => (
              <div className="li" key={l.key}>
                <div className="grow">
                  <div className="title ellipsis">{l.product.name}</div>
                  {l.product.last_price != null && <div className="small muted">Último: {money(l.product.last_price)}/ud</div>}
                </div>
                <input className="input num" style={{ width: 64 }} inputMode="decimal" aria-label={`Cantidad de ${l.product.name}`} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                <input className="input num" style={{ width: 90 }} inputMode="decimal" aria-label={`Importe de ${l.product.name}`} placeholder="€" value={l.total} onChange={(e) => setLine(l.key, { total: e.target.value })} />
                <button className="icon-btn" aria-label={`Quitar ${l.product.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Icon name="x" /></button>
              </div>
            ))}
          </div>
        )}
        <ProductSearch
          sticky={false}
          placeholder="Añadir producto al ticket"
          onPick={(p) => {
            const prod = typeof p === 'string' ? getOrCreateProduct(p) : p
            setLines((ls) => [...ls, { key: uid(), product: prod, qty: '1', total: fmt(prod.last_price), itemId: null }])
          }}
        />
        {missing > 0 && <p className="small warn">{missing} {missing === 1 ? 'línea' : 'líneas'} sin importe: no guardarán precio, pero sí entran en casa.</p>}

        <label className="field">
          <span>Total del ticket · suma de líneas {money(linesSum)}</span>
          <input className="input num big" inputMode="decimal" placeholder={fmt(linesSum) || '0,00'} value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        {parseNum(total) != null && Math.abs(totalNum - linesSum) > 0.009 && lines.length > 0 && (
          <p className="small muted">
            Diferencia con las líneas: {money(round2(totalNum - linesSum))}. {totalNum > linesSum ? 'Se contará como gasto sin desglosar.' : 'Se reparte como descuento entre las líneas.'}
          </p>
        )}

        <div className="grid2">
          <label className="field"><span>Pagó</span>
            <select className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          </label>
          <label className="toggle"><span>Compra imprevista</span><input type="checkbox" checked={unplanned} onChange={(e) => setUnplanned(e.target.checked)} /></label>
        </div>
        <label className="field"><span>Nota</span><input className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button className="btn primary block" disabled={busy} onClick={submit}>{busy ? 'Guardando…' : `Guardar compra · ${money(totalNum)}`}</button>
        <p className="small muted">Al guardar: lo comprado sale de la lista, se suma a «En casa» y sus precios pasan al historial.</p>
      </div>
    </Sheet>
  )
}
