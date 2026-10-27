import { useState } from 'react'
import { flush, getState, refresh, reloadPurchases, rpcNow, uid, useStore, type PurchaseWithLines } from '../lib/store'
import { getOrCreateProduct } from '../lib/actions'
import { money, parseNum, round2, todayISO } from '../lib/format'
import { groupByStore, linesSum, suggestedTotal } from '../lib/purchases'
import { fmt, LineRows, storeName, StoreSelect, type Line } from './PurchaseSheet'
import { ProductSearch } from './ProductSearch'
import { Sheet, toast } from './ui'

/**
 * Editar una compra cerrada. Si sus líneas acaban en varias tiendas, al guardar se separa:
 * la compra original se queda con su tienda y se crea una compra nueva por cada tienda más.
 */
export function PurchaseEdit({ p, onClose, onDone }: { p: PurchaseWithLines; onClose: () => void; onDone: () => void }) {
  const products = useStore((s) => s.products)
  const stores = useStore((s) => s.stores)
  const members = useStore((s) => s.members)
  const main = p.store_id ?? ''
  const [lines, setLines] = useState<Line[]>(() =>
    p.purchase_lines.flatMap((l) => {
      const product = products.find((x) => x.id === l.product_id)
      // Una línea cuyo producto se borró no se puede rehacer: se queda fuera (y se avisa).
      return product ? [{ key: l.id, product, qty: String(l.qty).replace('.', ','), total: fmt(l.line_total), store: main, itemId: null }] : []
    }),
  )
  const orphan = p.purchase_lines.length - lines.length
  const [store, setStore] = useState(main) // tienda de la compra original
  const [date, setDate] = useState(p.purchased_on)
  const [paidBy, setPaidBy] = useState(p.paid_by ?? '')
  const [unplanned, setUnplanned] = useState(p.unplanned)
  const [notes, setNotes] = useState(p.notes ?? '')
  const [totals, setTotals] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Un id por tienda nueva, el mismo en reintentos: el servidor no duplica nada.
  const [ids] = useState(() => new Map<string, string>())
  const idFor = (st: string) => {
    if (!ids.has(st)) ids.set(st, uid())
    return ids.get(st)!
  }

  const original = { total: p.total_paid, lines: linesSum(p.purchase_lines.map((l) => l.line_total)) }
  // Si todo se ha movido a otras tiendas, la compra original pasa a ser la primera de ellas.
  const all = groupByStore(lines, store)
  const groups = all.length > 1 && !all[0].lines.length ? all.slice(1) : all
  const keep = groups[0].store
  const multi = groups.length > 1
  const sumOf = (ls: Line[]) => linesSum(ls.map((l) => parseNum(l.total)))
  const groupTotal = (g: { store: string; lines: Line[] }) => parseNum(totals[g.store] ?? '') ?? suggestedTotal(g.store === keep, sumOf(g.lines), original)
  const totalNum = round2(groups.reduce((a, g) => a + groupTotal(g), 0))

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const changeMainStore = (v: string) => {
    // Las líneas que estaban en la tienda original la siguen.
    setLines((ls) => ls.map((l) => (l.store === store ? { ...l, store: v } : l)))
    setTotals(({ [store]: t, ...rest }) => (t == null ? rest : { ...rest, [v]: t }))
    setStore(v)
  }

  const save = async () => {
    if (!navigator.onLine) return toast('Necesitas conexión para editar la compra', 'error')
    for (const l of lines) {
      const q = parseNum(l.qty)
      if (!q || q <= 0) return toast(`Cantidad no válida en ${l.product.name}`, 'error')
      const t = parseNum(l.total)
      if (t == null || t < 0) return toast(`Falta el importe de ${l.product.name}`, 'error')
    }
    if (groups.some((g) => groupTotal(g) < 0)) return toast('El importe no puede ser negativo', 'error')
    setBusy(true)
    try {
      // Los productos nuevos tienen que existir en el servidor antes.
      await flush()
      if (getState().pending) throw new Error('hay cambios pendientes de enviar; inténtalo en unos segundos')
      const parts = groups.map((g) => ({
        id: g.store === keep ? p.id : idFor(g.store),
        store_id: g.store || null,
        purchased_on: date,
        total_paid: groupTotal(g),
        paid_by: paidBy || null,
        unplanned,
        notes,
        lines: g.lines.map((l) => ({ product_id: l.product.id, qty: parseNum(l.qty), line_total: parseNum(l.total) })),
      }))
      await rpcNow('edit_purchase', { p_purchase: p.id, p_parts: parts })
      await Promise.all([refresh(), reloadPurchases()])
      toast(parts.length > 1 ? `Compra separada en ${parts.length} tiendas` : 'Compra actualizada')
      onDone()
    } catch (e) {
      const msg = (e as Error).message
      toast(/edit_purchase|function|PGRST202/i.test(msg) ? 'Falta un paso en la base de datos: ejecuta editar-compras.sql en Supabase.' : 'No se pudo guardar: ' + msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Editar compra" onClose={onClose}>
      <div className="stack">
        <div className="grid2">
          <label className="field"><span>Tienda</span><StoreSelect label="Tienda de la compra" value={store} onChange={changeMainStore} /></label>
          <label className="field"><span>Fecha</span><input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {multi ? `Se separará en ${groups.length} compras, una por tienda.` : 'Para separar la compra, cambia la tienda de los productos que se compraron en otro sitio.'}
        </p>
        {orphan > 0 && <p className="small warn">{orphan} {orphan === 1 ? 'línea es' : 'líneas son'} de productos borrados y se quitarán al guardar.</p>}

        {groups.map((g) => (
          <section className="stack" key={g.store} data-testid="store-group">
            <h2>{storeName(stores, g.store)}{g.store === keep ? '' : ' · compra nueva'}</h2>
            <LineRows lines={g.lines} multi setLine={setLine} removeLine={(k) => setLines((ls) => ls.filter((x) => x.key !== k))} />
            <label className="field">
              <span>Total pagado en {storeName(stores, g.store)} · suma de líneas {money(sumOf(g.lines))}</span>
              <input className="input num" inputMode="decimal" placeholder={fmt(suggestedTotal(g.store === keep, sumOf(g.lines), original))}
                value={totals[g.store] ?? ''} aria-label={`Total de ${storeName(stores, g.store)}`} onChange={(e) => setTotals({ ...totals, [g.store]: e.target.value })} />
            </label>
          </section>
        ))}

        <ProductSearch
          sticky={false}
          placeholder="Añadir producto a la compra"
          onPick={(x) => {
            const prod = typeof x === 'string' ? getOrCreateProduct(x) : x
            setLines((ls) => [...ls, { key: uid(), product: prod, qty: '1', total: fmt(prod.last_price), store, itemId: null }])
          }}
        />

        <div className="grid2">
          <label className="field"><span>Pagó</span>
            <select className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              <option value="">Sin indicar</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          </label>
          <label className="toggle"><span>Compra imprevista</span><input type="checkbox" checked={unplanned} onChange={(e) => setUnplanned(e.target.checked)} /></label>
        </div>
        <label className="field"><span>Nota</span><input className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button className="btn primary block" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : `Guardar cambios · ${money(totalNum)}`}</button>
        <p className="small muted">Al guardar se corrige «En casa» con la diferencia de cantidades y el historial de precios toma la tienda y la fecha nuevas.</p>
      </div>
    </Sheet>
  )
}
