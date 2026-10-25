import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { addToList, getOrCreateProduct, inventoryFor, ranOut, setStock, wasted } from '../lib/actions'
import { daysBetween, shortDate, todayISO } from '../lib/format'
import { LOCATIONS, type InventoryRow, type Location, type Product } from '../lib/types'
import { ProductSearch } from '../components/ProductSearch'
import { Thumb } from '../components/ProductMedia'
import { ProductSheet } from '../components/ProductSheet'
import { Sheet, Stepper, toast } from '../components/ui'

type Filter = 'todo' | 'caduca' | 'reponer' | Location

export function PantryScreen() {
  const inventory = useStore((s) => s.inventory)
  const products = useStore((s) => s.products)
  const items = useStore((s) => s.items)
  const [filter, setFilter] = useState<Filter>('todo')
  const [editing, setEditing] = useState<Product | null>(null)
  const [acting, setActing] = useState<{ p: Product; row: InventoryRow } | null>(null)
  const today = todayISO()

  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const inList = useMemo(() => new Set(items.map((i) => i.product_id)), [items])

  const rows = useMemo(() => {
    const out = inventory
      .map((r) => ({ r, p: pmap.get(r.product_id) }))
      .filter((x): x is { r: InventoryRow; p: Product } => !!x.p)
      .filter(({ r, p }) => {
        if (filter === 'todo') return r.qty > 0 || (p.min_qty ?? 0) > 0
        if (filter === 'caduca') return r.qty > 0 && !!r.expires_on && daysBetween(today, r.expires_on) <= 7
        if (filter === 'reponer') return p.min_qty != null && r.qty < p.min_qty
        return (r.location ?? p.location) === filter && r.qty > 0
      })
    // Lo que caduca antes, primero; después por nombre.
    return out.sort((a, b) => {
      const ea = a.r.expires_on && a.r.qty > 0 ? a.r.expires_on : '9999', eb = b.r.expires_on && b.r.qty > 0 ? b.r.expires_on : '9999'
      return ea.localeCompare(eb) || a.p.name.localeCompare(b.p.name, 'es')
    })
  }, [inventory, pmap, filter, today])

  const add = (picked: Product | string) => {
    const p = typeof picked === 'string' ? getOrCreateProduct(picked) : picked
    const cur = inventoryFor(p.id)
    setStock(p, (cur?.qty ?? 0) + 1)
    toast(`${p.name}: ${(cur?.qty ?? 0) + 1} en casa`)
  }

  const filters: { id: Filter; label: string }[] = [
    { id: 'todo', label: 'Todo' },
    { id: 'caduca', label: 'Caduca pronto' },
    { id: 'reponer', label: 'Bajo mínimo' },
    ...LOCATIONS.map((l) => ({ id: l.id as Filter, label: l.label })),
  ]

  return (
    <>
      <div className="page-head"><h1>En casa</h1></div>
      <ProductSearch placeholder="Añadir algo que tenemos…" onPick={add} />
      <div className="page" style={{ paddingTop: 0 }}>
        <div className="chips" role="group" aria-label="Filtrar">
          {filters.map((f) => (
            <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            {inventory.length === 0 ? (
              <>
                <p>Todavía no hay nada registrado.</p>
                <p className="small">Al cerrar una compra, lo comprado aparece aquí solo. También puedes añadirlo arriba.</p>
              </>
            ) : <p>Nada en este filtro.</p>}
          </div>
        ) : (
          <div className="list">
            {rows.map(({ r, p }) => {
              const d = r.expires_on && r.qty > 0 ? daysBetween(today, r.expires_on) : null
              const low = p.min_qty != null && r.qty < p.min_qty
              return (
                <div className="li" key={r.id} data-testid="stock">
                  <Thumb product={p} />
                  <button className="li-btn" onClick={() => setEditing(p)}>
                    <div className="title ellipsis">{p.name}</div>
                    <div className="small row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {d != null && <span className={`tag ${d < 0 ? 'danger' : d <= 3 ? 'danger' : d <= 7 ? 'warn' : ''}`}>{d < 0 ? 'Caducado' : d === 0 ? 'Caduca hoy' : `Caduca ${shortDate(r.expires_on!)}`}</span>}
                      {low && <span className="tag warn">{r.qty === 0 ? 'Agotado' : `Mín. ${p.min_qty}`}</span>}
                      {inList.has(p.id) && <span className="tag ok">En la lista</span>}
                    </div>
                  </button>
                  <Stepper value={r.qty} onChange={(n) => setStock(p, n)} label={`Cantidad de ${p.name}`} />
                  <button className="btn sm" onClick={() => setActing({ p, row: r })} aria-label={`Más acciones para ${p.name}`}>···</button>
                </div>
              )
            })}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>Solo hace falta tocar «Se acabó» cuando algo se termina; no hay que registrar cada uso.</p>
      </div>
      {editing && <ProductSheet product={editing} onClose={() => setEditing(null)} />}
      {acting && <StockActions p={acting.p} row={acting.row} inList={inList.has(acting.p.id)} onClose={() => setActing(null)} />}
    </>
  )
}

function StockActions({ p, row, inList, onClose }: { p: Product; row: InventoryRow; inList: boolean; onClose: () => void }) {
  return (
    <Sheet title={p.name} onClose={onClose}>
      <div className="stack">
        <button className="btn block" onClick={() => {
          ranOut(p)
          onClose()
          if (!inList) toast(`${p.name} se acabó.`, 'info', { label: 'Añadir a la lista', run: () => addToList(p) })
        }}>Se acabó</button>
        {!inList && <button className="btn block" onClick={() => { addToList(p); toast('Añadido a la lista'); onClose() }}>Añadir a la lista</button>}
        <button className="btn block" disabled={row.qty <= 0} onClick={() => {
          wasted(p, Math.min(1, row.qty))
          toast(p.last_price != null ? `Registrado como desperdicio (≈ ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(p.last_price * Math.min(1, row.qty))})` : 'Registrado como desperdicio')
          onClose()
        }}>Tirado / se estropeó (1)</button>
        <p className="small muted">«Tirado» sirve para estimar el desperdicio; usa el último precio conocido.</p>
      </div>
    </Sheet>
  )
}
