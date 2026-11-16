import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { addToList, getOrCreateProduct, inventoryFor, ranOut, setStock, wasted } from '../lib/actions'
import { daysBetween, shortDate, todayISO } from '../lib/format'
import { norm } from '../lib/text'
import { LOCATIONS, type Category, type InventoryRow, type Location, type Product } from '../lib/types'
import { ProductSearch } from '../components/ProductSearch'
import { Thumb } from '../components/ProductMedia'
import { ProductSheet } from '../components/ProductSheet'
import { Icon, Sheet, Stepper, toast } from '../components/ui'

type Status = 'todo' | 'caduca' | 'reponer'
type GroupBy = 'ubicacion' | 'categoria'
type Row = { r: InventoryRow; p: Product; days: number | null; low: boolean }
type Group = { key: string; name: string; emoji: string; sort: number; rows: Row[]; expiring: number; low: number }

const LOCATION_EMOJI: Record<Location, string> = {
  nevera: '🥛', congelador: '❄️', despensa: '🥫', bano: '🛁', limpieza: '🧽', otro: '📦',
}

/** Icono orientativo según el nombre de la categoría (las categorías las crea cada hogar). */
const CATEGORY_EMOJI: [RegExp, string][] = [
  [/fruta|verdura/, '🥦'], [/carne|pescado/, '🥩'], [/lacteo|huevo/, '🧀'], [/pan/, '🥖'], [/congelado/, '❄️'],
  [/preparado/, '🍱'], [/bebida/, '🧃'], [/limpieza/, '🧽'], [/higiene/, '🧴'], [/papel/, '🧻'], [/lavanderia/, '🧺'],
  [/mascota/, '🐾'], [/bebe/, '🍼'], [/despensa/, '🥫'],
]
export function categoryEmoji(name: string) {
  const n = norm(name)
  return CATEGORY_EMOJI.find(([re]) => re.test(n))?.[1] ?? '🏷️'
}

function readPref<T extends string>(k: string, fallback: T): T {
  try { return (localStorage.getItem(k) as T) || fallback } catch { return fallback }
}
function writePref(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* nada */ }
}

function groupOf(row: Row, by: GroupBy, cats: Map<string, Category>): Omit<Group, 'rows' | 'expiring' | 'low'> {
  if (by === 'categoria') {
    const c = row.p.category_id ? cats.get(row.p.category_id) : undefined
    return c ? { key: c.id, name: c.name, emoji: categoryEmoji(c.name), sort: c.sort } : { key: '_', name: 'Sin categoría', emoji: '🏷️', sort: 9999 }
  }
  const loc = (row.r.location ?? row.p.location ?? 'otro') as Location
  const i = LOCATIONS.findIndex((l) => l.id === loc)
  return { key: loc, name: LOCATIONS[i]?.label ?? 'Otro', emoji: LOCATION_EMOJI[loc] ?? '📦', sort: i < 0 ? 99 : i }
}

export function PantryScreen() {
  const inventory = useStore((s) => s.inventory)
  const products = useStore((s) => s.products)
  const categories = useStore((s) => s.categories)
  const items = useStore((s) => s.items)
  const [status, setStatus] = useState<Status>('todo')
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readPref<GroupBy>('cc-pantry-groupby', 'ubicacion'))
  const [closed, setClosed] = useState<Set<string>>(() => new Set(readPref('cc-pantry-closed', '').split('|').filter(Boolean)))
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [acting, setActing] = useState<{ p: Product; row: InventoryRow } | null>(null)
  const today = todayISO()

  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const cmap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const inList = useMemo(() => new Set(items.map((i) => i.product_id)), [items])

  // Todo lo que tiene sentido enseñar (hay algo, o tiene mínimo y se ha agotado).
  const all = useMemo<Row[]>(() => inventory
    .map((r) => ({ r, p: pmap.get(r.product_id) }))
    .filter((x): x is { r: InventoryRow; p: Product } => !!x.p && (x.r.qty > 0 || (x.p.min_qty ?? 0) > 0))
    .map(({ r, p }) => ({
      r, p,
      days: r.expires_on && r.qty > 0 ? daysBetween(today, r.expires_on) : null,
      low: p.min_qty != null && r.qty < p.min_qty,
    })), [inventory, pmap, today])

  const isExpiring = (x: Row) => x.days != null && x.days <= 7
  const counts = { todo: all.length, caduca: all.filter(isExpiring).length, reponer: all.filter((x) => x.low).length }

  const words = norm(q).split(' ').filter(Boolean)
  const searching = words.length > 0
  const rows = all.filter((x) => {
    if (status === 'caduca' && !isExpiring(x)) return false
    if (status === 'reponer' && !x.low) return false
    if (searching) { const n = norm(x.p.name); return words.every((w) => n.includes(w)) }
    return true
  })

  const groups = useMemo(() => {
    const g = new Map<string, Group>()
    for (const row of rows) {
      const info = groupOf(row, groupBy, cmap)
      if (!g.has(info.key)) g.set(info.key, { ...info, rows: [], expiring: 0, low: 0 })
      const grp = g.get(info.key)!
      grp.rows.push(row)
      if (isExpiring(row)) grp.expiring++
      if (row.low) grp.low++
    }
    const out = [...g.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
    for (const grp of out) {
      grp.rows.sort(status === 'caduca'
        ? (a, b) => (a.days ?? 999) - (b.days ?? 999) || a.p.name.localeCompare(b.p.name, 'es')
        : (a, b) => a.p.name.localeCompare(b.p.name, 'es'))
    }
    return out
  }, [rows, groupBy, cmap, status])

  // Al buscar o filtrar se abre todo para no esconder resultados.
  const forceOpen = searching || status !== 'todo'
  const isOpen = (key: string) => forceOpen || !closed.has(`${groupBy}:${key}`)
  const saveClosed = (s: Set<string>) => { setClosed(s); writePref('cc-pantry-closed', [...s].join('|')) }
  const toggle = (key: string) => {
    const s = new Set(closed)
    const k = `${groupBy}:${key}`
    if (s.has(k)) s.delete(k); else s.add(k)
    saveClosed(s)
  }
  const allClosed = groups.length > 0 && groups.every((g) => !isOpen(g.key))
  const toggleAll = () => {
    const s = new Set([...closed].filter((k) => !k.startsWith(`${groupBy}:`)))
    if (!allClosed) for (const g of groups) s.add(`${groupBy}:${g.key}`)
    saveClosed(s)
  }
  const switchGroup = (g: GroupBy) => { setGroupBy(g); writePref('cc-pantry-groupby', g) }

  const add = (picked: Product | string, units = 1) => {
    const p = typeof picked === 'string' ? getOrCreateProduct(picked) : picked
    const cur = inventoryFor(p.id)
    setStock(p, (cur?.qty ?? 0) + units)
    toast(`${p.name}: ${(cur?.qty ?? 0) + units} en casa`)
  }

  const statusChips: { id: Status; label: string; n: number; tone?: string }[] = [
    { id: 'todo', label: 'Todo', n: counts.todo },
    { id: 'caduca', label: 'Caducan', n: counts.caduca, tone: 'danger' },
    { id: 'reponer', label: 'Reponer', n: counts.reponer, tone: 'warn' },
  ]

  return (
    <>
      <div className="page-head">
        <h1>En casa</h1>
        <button className="btn sm primary" onClick={() => setAdding(true)}><Icon name="plus" /> Añadir</button>
      </div>
      <div className="adder pantry-search">
        <Icon name="search" className="lens" />
        <input
          className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar entre ${counts.todo} productos…`} aria-label="Buscar en casa" autoComplete="off" enterKeyHint="search"
        />
        {q && <button className="clear-btn" aria-label="Borrar búsqueda" onClick={() => setQ('')}><Icon name="x" /></button>}
      </div>
      <div className="page" style={{ paddingTop: 0 }}>
        <div className="chips" role="group" aria-label="Filtrar">
          {statusChips.map((f) => (
            <button key={f.id} className="chip" aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
              {f.label} <span className={`chip-n ${f.n && f.tone ? f.tone : ''}`}>{f.n}</span>
            </button>
          ))}
        </div>
        <div className="row pantry-tools">
          <div className="seg" role="group" aria-label="Agrupar por">
            <button aria-pressed={groupBy === 'ubicacion'} onClick={() => switchGroup('ubicacion')}>Por sitio</button>
            <button aria-pressed={groupBy === 'categoria'} onClick={() => switchGroup('categoria')}>Por categoría</button>
          </div>
          <span className="grow" />
          {!forceOpen && groups.length > 1 && (
            <button className="btn ghost sm" onClick={toggleAll}>{allClosed ? 'Abrir todo' : 'Plegar todo'}</button>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            {inventory.length === 0 ? (
              <>
                <p>Todavía no hay nada registrado.</p>
                <p className="small">Al cerrar una compra, lo comprado aparece aquí solo. También puedes añadirlo con «Añadir».</p>
              </>
            ) : searching ? (
              <>
                <p>No hay «{q.trim()}» en casa{status !== 'todo' ? ' con este filtro' : ''}.</p>
                <button className="btn sm" onClick={() => { add(q.trim()); setQ('') }}><Icon name="plus" /> Añadir «{q.trim()}»</button>
              </>
            ) : <p>Nada en este filtro.</p>}
          </div>
        ) : groups.map((g) => {
          const open = isOpen(g.key)
          return (
            <section key={g.key} className="pgroup" data-testid="pantry-group">
              <button className="pgroup-head" aria-expanded={open} onClick={() => !forceOpen && toggle(g.key)}>
                <span className="pgroup-emoji" aria-hidden="true">{g.emoji}</span>
                <span className="pgroup-name">{g.name}</span>
                <span className="pgroup-count">{g.rows.length}</span>
                <span className="grow" />
                {g.expiring > 0 && <span className="tag danger" title="Caducan en 7 días o menos">⏰ {g.expiring}</span>}
                {g.low > 0 && <span className="tag warn" title="Por debajo del mínimo">↓ {g.low}</span>}
                {!forceOpen && <span className={`chev ${open ? 'open' : ''}`}><Icon name="down" /></span>}
              </button>
              {open && (
                <div className="list">
                  {g.rows.map((x) => <StockRow key={x.r.id} x={x} inList={inList.has(x.p.id)} onEdit={() => setEditing(x.p)} onMore={() => setActing({ p: x.p, row: x.r })} />)}
                </div>
              )}
            </section>
          )
        })}
        <p className="small muted" style={{ marginTop: 12 }}>Solo hace falta tocar «Se acabó» cuando algo se termina; no hay que registrar cada uso.</p>
      </div>
      {adding && (
        <Sheet title="Añadir a casa" onClose={() => setAdding(false)}>
          <ProductSearch sticky={false} placeholder="Añadir algo que tenemos…" onPick={(p, u) => add(p, u)}
            badge={(p) => { const r = inventoryFor(p.id); return r && r.qty > 0 ? `${r.qty} en casa` : null }} />
          <p className="small muted" style={{ marginTop: 160 }}>Escribe o escanea; puedes añadir varios seguidos.</p>
        </Sheet>
      )}
      {editing && <ProductSheet product={editing} onClose={() => setEditing(null)} />}
      {acting && <StockActions p={acting.p} row={acting.row} inList={inList.has(acting.p.id)} onClose={() => setActing(null)} />}
    </>
  )
}

function StockRow({ x, inList, onEdit, onMore }: { x: Row; inList: boolean; onEdit: () => void; onMore: () => void }) {
  const { r, p, days: d, low } = x
  const tone = d != null && d <= 3 ? 'danger' : r.qty === 0 && low ? 'danger' : (d != null && d <= 7) || low ? 'warn' : ''
  return (
    <div className={`li compact ${tone ? `st-${tone}` : ''}`} data-testid="stock">
      <Thumb product={p} />
      <button className="li-btn" onClick={onEdit}>
        <div className="title ellipsis">{p.name}</div>
        {(d != null || low || inList) && (
          <div className="small row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {d != null && <span className={`tag ${d <= 3 ? 'danger' : d <= 7 ? 'warn' : ''}`}>{d < 0 ? 'Caducado' : d === 0 ? 'Caduca hoy' : `Caduca ${shortDate(r.expires_on!)}${(r.lots?.length ?? 0) > 1 ? ` · ${r.lots!.length} fechas` : ''}`}</span>}
            {low && <span className={`tag ${r.qty === 0 ? 'danger' : 'warn'}`}>{r.qty === 0 ? 'Agotado' : `Mín. ${p.min_qty}`}</span>}
            {inList && <span className="tag ok">En la lista</span>}
          </div>
        )}
      </button>
      <Stepper value={r.qty} onChange={(n) => setStock(p, n)} label={`Cantidad de ${p.name}`} />
      <button className="btn sm more-btn" onClick={onMore} aria-label={`Más acciones para ${p.name}`}>···</button>
    </div>
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
