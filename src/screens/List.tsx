import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { addToList, getOrCreateProduct, setItemQty, toggleItem } from '../lib/actions'
import { money, round2 } from '../lib/format'
import { alerts } from '../lib/stats'
import { todayISO } from '../lib/format'
import type { Product, ShoppingItem } from '../lib/types'
import { ProductSearch } from '../components/ProductSearch'
import { Thumb } from '../components/ProductMedia'
import { ProductSheet } from '../components/ProductSheet'
import { PurchaseSheet } from '../components/PurchaseSheet'
import { Icon, Sheet, Stepper, Who, toast } from '../components/ui'

type GroupBy = 'categoria' | 'tienda'

function readGroupBy(): GroupBy {
  try {
    return (localStorage.getItem('cc-groupby') as GroupBy) || 'categoria'
  } catch {
    return 'categoria'
  }
}

export function itemPrice(i: ShoppingItem, p?: Product) {
  const u = i.est_price ?? p?.last_price
  return u == null ? null : u * i.qty
}

export function ListScreen() {
  const items = useStore((s) => s.items)
  const products = useStore((s) => s.products)
  const categories = useStore((s) => s.categories)
  const stores = useStore((s) => s.stores)
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy)
  const [editing, setEditing] = useState<{ p: Product; i?: ShoppingItem } | null>(null)
  const [closing, setClosing] = useState(false)
  const [staples, setStaples] = useState(false)

  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const groups = useMemo(() => {
    const g = new Map<string, { name: string; sort: number; items: ShoppingItem[] }>()
    for (const i of items) {
      const p = pmap.get(i.product_id)
      let key: string, name: string, sort: number
      if (groupBy === 'tienda') {
        const s = stores.find((x) => x.id === (i.store_id ?? p?.usual_store_id))
        key = s?.id ?? '_'; name = s?.name ?? 'Cualquier tienda'; sort = s?.sort ?? 999
      } else {
        const c = categories.find((x) => x.id === p?.category_id)
        key = c?.id ?? '_'; name = c?.name ?? 'Sin categoría'; sort = c?.sort ?? 999
      }
      if (!g.has(key)) g.set(key, { name, sort, items: [] })
      g.get(key)!.items.push(i)
    }
    const arr = [...g.values()].sort((a, b) => a.sort - b.sort)
    for (const grp of arr) {
      grp.items.sort((a, b) => Number(a.checked) - Number(b.checked) || (pmap.get(a.product_id)?.name ?? '').localeCompare(pmap.get(b.product_id)?.name ?? '', 'es'))
    }
    return arr
  }, [items, pmap, categories, stores, groupBy])

  const pending = items.filter((i) => !i.checked)
  const checked = items.filter((i) => i.checked)
  const est = round2(items.reduce((a, i) => a + (itemPrice(i, pmap.get(i.product_id)) ?? 0), 0))
  const cart = round2(checked.reduce((a, i) => a + (itemPrice(i, pmap.get(i.product_id)) ?? 0), 0))
  const unknown = items.filter((i) => itemPrice(i, pmap.get(i.product_id)) == null).length

  const add = (picked: Product | string, units = 1) => {
    const p = typeof picked === 'string' ? getOrCreateProduct(picked) : picked
    const { item, duplicate } = addToList(p, units)
    if (duplicate) {
      toast(`${p.name} ya está en la lista (${item.qty}).`, 'info', { label: `Sumar ${units}`, run: () => setItemQty(item, item.qty + units) })
    }
  }

  const switchGroup = (g: GroupBy) => {
    setGroupBy(g)
    try { localStorage.setItem('cc-groupby', g) } catch { /* nada */ }
  }

  return (
    <>
      <div className="page-head">
        <h1>Lista</h1>
        <button className="btn sm" onClick={() => setStaples(true)}><Icon name="star" /> Habituales</button>
      </div>
      <ProductSearch placeholder="Añadir a la lista…" onPick={add} badge={(p) => (items.some((i) => i.product_id === p.id) ? 'En la lista' : null)} />
      <div className="page" style={{ paddingTop: 0, paddingBottom: 90 }}>
        <div className="chips" role="group" aria-label="Agrupar por">
          <button className="chip" aria-pressed={groupBy === 'categoria'} onClick={() => switchGroup('categoria')}>Por categoría</button>
          <button className="chip" aria-pressed={groupBy === 'tienda'} onClick={() => switchGroup('tienda')}>Por tienda</button>
        </div>
        {items.length === 0 && (
          <div className="empty">
            <p>La lista está vacía.</p>
            <p className="small">Escribe arriba o toca «Habituales» para añadir lo de siempre.</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.name}>
            <h2>{g.name}</h2>
            <div className="list">
              {g.items.map((i) => {
                const p = pmap.get(i.product_id)
                if (!p) return null
                const price = itemPrice(i, p)
                return (
                  <div className={`li ${i.checked ? 'done' : ''}`} key={i.id} data-testid="item">
                    <button className="check-wrap" onClick={() => toggleItem(i)} aria-label={`${i.checked ? 'Desmarcar' : 'Marcar'} ${p.name}`}>
                      <span className={`check ${i.checked ? 'on' : ''}`}>{i.checked && <Icon name="check" />}</span>
                    </button>
                    <Thumb product={p} />
                    <button className="li-btn" onClick={() => setEditing({ p, i })}>
                      <div className="title ellipsis">{p.name}</div>
                      <div className="small muted row" style={{ gap: 6 }}>
                        <Who userId={i.checked ? i.checked_by : i.added_by} />
                        <span className="num">{price != null ? money(price) : 'Sin precio'}</span>
                        {i.note && <span className="ellipsis">· {i.note}</span>}
                      </div>
                    </button>
                    <Stepper value={i.qty} onChange={(n) => setItemQty(i, n)} label={`Cantidad de ${p.name}`} />
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {items.length > 0 && (
        <div className="totals">
          <div className="grow">
            <div className="num"><b>{money(est)}</b> <span className="small muted">estimado</span></div>
            <div className="small muted num">{checked.length ? `En el carro ${money(cart)}` : `${pending.length} por comprar`}{unknown ? ` · ${unknown} sin precio` : ''}</div>
          </div>
          <button className="btn primary" disabled={!checked.length} onClick={() => setClosing(true)}>Cerrar compra</button>
        </div>
      )}

      {editing && <ProductSheet product={editing.p} item={editing.i} onClose={() => setEditing(null)} />}
      {closing && <PurchaseSheet items={checked} onClose={() => setClosing(false)} />}
      {staples && <StaplesSheet onClose={() => setStaples(false)} />}
    </>
  )
}

/** Habituales y avisos de reposición: se añaden con un toque, nunca automáticamente. */
function StaplesSheet({ onClose }: { onClose: () => void }) {
  const products = useStore((s) => s.products)
  const items = useStore((s) => s.items)
  const inventory = useStore((s) => s.inventory)
  const purchases = useStore((s) => s.purchases)

  const suggestions = useMemo(() => {
    const inList = new Set(items.map((i) => i.product_id))
    const al = alerts(products, inventory, items, purchases, todayISO()).filter((a) => a.kind === 'minimo' || a.kind === 'reponer')
    const out: { p: Product; reason: string; urgent: boolean }[] = al.map((a) => ({ p: a.product, reason: a.text, urgent: a.urgency === 'urgente' || a.urgency === 'pronto' }))
    const seen = new Set(out.map((o) => o.p.id))
    for (const p of products) {
      if (p.is_staple && !inList.has(p.id) && !seen.has(p.id)) out.push({ p, reason: 'Habitual', urgent: false })
    }
    return out
  }, [products, items, inventory, purchases])

  const [sel, setSel] = useState<Set<string>>(() => new Set(suggestions.filter((s) => s.urgent).map((s) => s.p.id)))
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  return (
    <Sheet title="Habituales" onClose={onClose}>
      {suggestions.length === 0 ? (
        <div className="empty">
          <p>No hay nada que reponer.</p>
          <p className="small">Marca productos como «habituales» o ponles un mínimo para que aparezcan aquí.</p>
        </div>
      ) : (
        <div className="stack">
          <div className="list">
            {suggestions.map(({ p, reason }) => (
              <label className="li" key={p.id}>
                <span className={`check ${sel.has(p.id) ? 'on' : ''}`}>{sel.has(p.id) && <Icon name="check" />}</span>
                <input type="checkbox" hidden checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                <div className="grow">
                  <div className="title">{p.name}</div>
                  <div className="small muted">{reason}</div>
                </div>
                {p.last_price != null && <span className="small muted num">{money(p.last_price)}</span>}
              </label>
            ))}
          </div>
          <button
            className="btn primary block"
            disabled={!sel.size}
            onClick={() => {
              for (const s of suggestions) if (sel.has(s.p.id)) addToList(s.p)
              toast(`${sel.size} ${sel.size === 1 ? 'producto añadido' : 'productos añadidos'}`)
              onClose()
            }}
          >
            Añadir {sel.size || ''} a la lista
          </button>
        </div>
      )}
    </Sheet>
  )
}
