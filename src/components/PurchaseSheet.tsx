import { useMemo, useRef, useState } from 'react'
import { flush, getState, refresh, reloadPurchases, rpcNow, uid, useStore } from '../lib/store'
import { getOrCreateProduct } from '../lib/actions'
import { money, parseNum, round2, todayISO } from '../lib/format'
import { groupByStore } from '../lib/purchases'
import type { Product, ShoppingItem, Store } from '../lib/types'
import { ProductSearch } from './ProductSearch'
import { Icon, Sheet, toast } from './ui'

export interface Line { key: string; product: Product; qty: string; total: string; store: string; itemId: string | null }

export const fmt = (n: number | null) => (n == null ? '' : String(round2(n)).replace('.', ','))

function initialLines(items: ShoppingItem[], products: Product[], fallback: string): Line[] {
  return items.flatMap((i) => {
    const p = products.find((x) => x.id === i.product_id)
    if (!p) return []
    const unit = i.est_price ?? p.last_price
    const store = i.store_id ?? p.usual_store_id ?? fallback
    return [{ key: i.id, product: p, qty: String(i.qty).replace('.', ','), total: fmt(unit != null ? unit * i.qty : null), store, itemId: i.id }]
  })
}

export const storeName = (stores: Store[], id: string) => stores.find((s) => s.id === id)?.name ?? 'Sin tienda'

/** Selector de tienda: las activas y, si la línea ya tiene una desactivada, también esa. */
export function StoreSelect({ value, onChange, label, small }: { value: string; onChange: (v: string) => void; label: string; small?: boolean }) {
  const stores = useStore((s) => s.stores)
  return (
    <select className={small ? 'input sm' : 'input'} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sin indicar</option>
      {stores.filter((s) => s.active || s.id === value).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  )
}

/** Líneas de una tienda: cantidad, importe, mover a otra tienda y quitar. */
export function LineRows({ lines, setLine, removeLine, multi }: {
  lines: Line[]; setLine: (key: string, patch: Partial<Line>) => void; removeLine: (key: string) => void; multi: boolean
}) {
  if (!lines.length) return null
  return (
    <div className="list">
      {lines.map((l) => (
        <div className="li wrap" key={l.key} data-testid="ticket-line">
          <div className="grow">
            <div className="title ellipsis">{l.product.name}</div>
            {l.product.last_price != null && <div className="small muted">Último: {money(l.product.last_price)}/ud</div>}
          </div>
          <input className="input num" style={{ width: 64 }} inputMode="decimal" aria-label={`Cantidad de ${l.product.name}`} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
          <input className="input num" style={{ width: 90 }} inputMode="decimal" aria-label={`Importe de ${l.product.name}`} placeholder="€" value={l.total} onChange={(e) => setLine(l.key, { total: e.target.value })} />
          <button className="icon-btn" aria-label={`Quitar ${l.product.name}`} onClick={() => removeLine(l.key)}><Icon name="x" /></button>
          <div className="line-store small muted">
            <span>{multi ? 'Comprado en' : 'Tienda'}</span>
            <StoreSelect small value={l.store} label={`Tienda de ${l.product.name}`} onChange={(v) => setLine(l.key, { store: v })} />
          </div>
        </div>
      ))}
    </div>
  )
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

  const [lines, setLines] = useState<Line[]>(() => initialLines(items, products, defaultStore))
  const [store, setStore] = useState(defaultStore) // solo para compras sin líneas y productos que se añaden
  const [totals, setTotals] = useState<Record<string, string>>({}) // importe por tienda si hay varias
  const [date, setDate] = useState(todayISO())
  const [total, setTotal] = useState('')
  const [paidBy, setPaidBy] = useState(userId ?? '')
  const [unplanned, setUnplanned] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  // Un id por tienda, el mismo en reintentos: el servidor no duplica la compra.
  const opIds = useRef(new Map<string, string>())
  const opId = (st: string) => {
    if (!opIds.current.has(st)) opIds.current.set(st, uid())
    return opIds.current.get(st)!
  }

  const groups = groupByStore(lines)
  const multi = groups.length > 1
  const sumOf = (ls: Line[]) => round2(ls.reduce((a, l) => a + (parseNum(l.total) ?? 0), 0))
  const linesSum = sumOf(lines)
  const missing = lines.filter((l) => parseNum(l.total) == null).length
  const groupTotal = (g: { store: string; lines: Line[] }) => parseNum(totals[g.store] ?? '') ?? sumOf(g.lines)
  const totalNum = multi ? round2(groups.reduce((a, g) => a + groupTotal(g), 0)) : parseNum(total) ?? linesSum

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
      const parts = lines.length ? groups.map((g) => ({ store: g.store, lines: g.lines, total: multi ? groupTotal(g) : totalNum })) : [{ store, lines: [], total: totalNum }]
      for (const part of parts) {
        await rpcNow('close_purchase', {
          p_household: getState().household!.id,
          p_store: part.store || null,
          p_date: date,
          p_total: part.total,
          p_paid_by: paidBy || null,
          p_unplanned: unplanned,
          p_lines: part.lines.map((l) => ({ product_id: l.product.id, qty: parseNum(l.qty), line_total: parseNum(l.total), shopping_item_id: l.itemId })),
          p_notes: notes,
          p_source: items.length ? 'lista' : 'manual',
          p_purchase_id: opId(part.store),
        })
      }
      await Promise.all([refresh(), reloadPurchases()])
      toast(parts.length > 1 ? `Guardadas ${parts.length} compras (una por tienda): ${money(totalNum)}` : `Compra guardada: ${money(totalNum)}`)
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
          {!multi && (
            <label className="field"><span>Tienda</span>
              <StoreSelect label="Tienda" value={lines.length ? groups[0].store : store} onChange={(v) => { setStore(v); setLines((ls) => ls.map((l) => ({ ...l, store: v }))) }} />
            </label>
          )}
          <label className="field"><span>Fecha</span><input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
        </div>

        {multi && <p className="small muted" style={{ margin: 0 }}>Hay productos de {groups.length} tiendas: se guardará una compra por tienda.</p>}
        {groups.map((g) => (
          <section className="stack" key={g.store} data-testid="store-group">
            <h2>{multi ? storeName(stores, g.store) : 'Productos'} · precio pagado por línea</h2>
            <LineRows lines={g.lines} multi={multi} setLine={setLine} removeLine={(k) => setLines((ls) => ls.filter((x) => x.key !== k))} />
            {multi && (
              <label className="field">
                <span>Total del ticket de {storeName(stores, g.store)} · suma {money(sumOf(g.lines))}</span>
                <input className="input num" inputMode="decimal" placeholder={fmt(sumOf(g.lines)) || '0,00'} value={totals[g.store] ?? ''}
                  aria-label={`Total de ${storeName(stores, g.store)}`} onChange={(e) => setTotals({ ...totals, [g.store]: e.target.value })} />
              </label>
            )}
          </section>
        ))}
        {!lines.length && <h2>Productos · precio pagado por línea</h2>}
        <ProductSearch
          sticky={false}
          placeholder="Añadir producto al ticket"
          onPick={(p) => {
            const prod = typeof p === 'string' ? getOrCreateProduct(p) : p
            const st = lines.length && !multi ? groups[0].store : (prod.usual_store_id ?? store)
            setLines((ls) => [...ls, { key: uid(), product: prod, qty: '1', total: fmt(prod.last_price), store: st, itemId: null }])
          }}
        />
        {missing > 0 && <p className="small warn">{missing} {missing === 1 ? 'línea' : 'líneas'} sin importe: no guardarán precio, pero sí entran en casa.</p>}

        {multi ? <div className="row"><span className="grow">Total de las {groups.length} compras</span><b className="num big">{money(totalNum)}</b></div> : (
        <label className="field">
          <span>Total del ticket · suma de líneas {money(linesSum)}</span>
          <input className="input num big" inputMode="decimal" placeholder={fmt(linesSum) || '0,00'} value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        )}
        {!multi && parseNum(total) != null && Math.abs(totalNum - linesSum) > 0.009 && lines.length > 0 && (
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
