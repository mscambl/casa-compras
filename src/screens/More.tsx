import { useMemo, useState } from 'react'
import { getState, supabase, update, upsert, uid, useStore } from '../lib/store'
import { money, packLabel, todayISO, unitPriceLabel } from '../lib/format'
import { rank } from '../lib/text'
import { GROUPS, type BudgetGroup, type Product, type Store } from '../lib/types'
import { ProductSheet } from '../components/ProductSheet'
import { Sheet, toast } from '../components/ui'

type Panel = null | 'catalogo' | 'tiendas' | 'categorias' | 'exportar' | 'cuenta'

export function MoreScreen({ onSignOut }: { onSignOut: () => void }) {
  const [panel, setPanel] = useState<Panel>(null)
  const s = useStore((x) => x)
  const me = s.members.find((m) => m.user_id === s.userId)
  const entries: { id: Panel; label: string; hint: string }[] = [
    { id: 'catalogo', label: 'Catálogo de productos', hint: `${s.products.length} productos` },
    { id: 'tiendas', label: 'Tiendas', hint: s.stores.filter((x) => x.active).map((x) => x.name).join(', ') },
    { id: 'categorias', label: 'Categorías', hint: 'Y a qué grupo de presupuesto cuentan' },
    { id: 'exportar', label: 'Exportar datos', hint: 'CSV y JSON con todo el historial' },
    { id: 'cuenta', label: 'Mi cuenta', hint: me ? `${me.display_name} · ${me.email ?? ''}` : '' },
  ]
  return (
    <>
      <div className="page-head"><h1>Más</h1></div>
      <div className="page stack">
        <div className="list">
          {entries.map((e) => (
            <button key={e.id} className="li" onClick={() => setPanel(e.id)}>
              <div className="grow"><div className="title">{e.label}</div><div className="small muted ellipsis">{e.hint}</div></div>
            </button>
          ))}
        </div>
        <p className="small muted">
          {s.online ? 'Conectado' : 'Sin conexión'}{s.pending ? ` · ${s.pending} cambios por enviar` : ''}
          {s.lastSync && ` · sincronizado ${new Date(s.lastSync).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`}
        </p>
        <p className="small muted">Próximamente: escaneo de tickets, comparación entre tiendas, planificador de menús y asistente.</p>
      </div>
      {panel === 'catalogo' && <Catalog onClose={() => setPanel(null)} />}
      {panel === 'tiendas' && <Stores onClose={() => setPanel(null)} />}
      {panel === 'categorias' && <Categories onClose={() => setPanel(null)} />}
      {panel === 'exportar' && <Export onClose={() => setPanel(null)} />}
      {panel === 'cuenta' && <Account onClose={() => setPanel(null)} onSignOut={onSignOut} />}
    </>
  )
}

function Catalog({ onClose }: { onClose: () => void }) {
  const products = useStore((s) => s.products)
  const categories = useStore((s) => s.categories)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const list = useMemo(() => (q.trim() ? rank(products, q, 50) : [...products].sort((a, b) => a.name.localeCompare(b.name, 'es'))), [products, q])
  if (editing) return <ProductSheet product={editing} onClose={() => setEditing(null)} />
  return (
    <Sheet title="Catálogo" onClose={onClose}>
      <div className="stack">
        <input className="input" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length === 0 ? <p className="muted">No hay productos. Se crean solos al añadirlos a la lista.</p> : (
          <div className="list">
            {list.map((p) => (
              <button key={p.id} className="li" onClick={() => setEditing(p)}>
                <div className="grow">
                  <div className="title">{p.name}{p.is_staple && ' ★'}</div>
                  <div className="small muted">{categories.find((c) => c.id === p.category_id)?.name ?? 'Sin categoría'}{p.pack_size ? ` · ${packLabel(p.unit, p.pack_size)}` : ''}</div>
                </div>
                <div className="right small num">
                  <div>{money(p.last_price)}</div>
                  <div className="muted">{unitPriceLabel(p.last_price, p.unit, p.pack_size)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

function Stores({ onClose }: { onClose: () => void }) {
  const stores = useStore((s) => s.stores)
  const [name, setName] = useState('')
  const add = () => {
    const n = name.trim()
    if (!n) return
    if (stores.some((s) => s.name.toLowerCase() === n.toLowerCase())) return toast('Esa tienda ya existe', 'error')
    const st: Store = { id: uid(), household_id: getState().household!.id, name: n, travel: 'coche', sort: (stores.at(-1)?.sort ?? 0) + 10, active: true }
    upsert('stores', st)
    setName('')
  }
  return (
    <Sheet title="Tiendas" onClose={onClose}>
      <div className="stack">
        <div className="list">
          {stores.map((s) => (
            <div className="li" key={s.id}>
              <div className="grow"><div className="title">{s.name}</div></div>
              <select className="input" style={{ width: 120 }} value={s.travel} onChange={(e) => update('stores', s.id, { travel: e.target.value })} aria-label={`Desplazamiento a ${s.name}`}>
                <option value="andando">Andando</option><option value="coche">Coche</option><option value="online">Online</option>
              </select>
              <label className="toggle small"><input type="checkbox" checked={s.active} onChange={(e) => update('stores', s.id, { active: e.target.checked })} aria-label={`${s.name} activa`} /></label>
            </div>
          ))}
        </div>
        <div className="row">
          <input className="input" placeholder="Nueva tienda" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={add}>Añadir</button>
        </div>
      </div>
    </Sheet>
  )
}

function Categories({ onClose }: { onClose: () => void }) {
  const categories = useStore((s) => s.categories)
  const [name, setName] = useState('')
  return (
    <Sheet title="Categorías" onClose={onClose}>
      <div className="stack">
        <div className="list">
          {categories.map((c) => (
            <div className="li" key={c.id}>
              <span className="grow">{c.name}</span>
              <select className="input" style={{ width: 170 }} value={c.grp} onChange={(e) => update('categories', c.id, { grp: e.target.value as BudgetGroup })} aria-label={`Grupo de ${c.name}`}>
                {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="row">
          <input className="input" placeholder="Nueva categoría" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => {
            const n = name.trim()
            if (!n) return
            upsert('categories', { id: uid(), household_id: getState().household!.id, name: n, grp: 'otros', sort: (categories.at(-1)?.sort ?? 0) + 5 })
            setName('')
          }}>Añadir</button>
        </div>
        <p className="small muted">Cambiar el grupo afecta a las compras futuras; las ya registradas mantienen su grupo.</p>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // Punto y coma: es lo que espera Excel en español.
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n')
}

const TABLES = ['households', 'members', 'stores', 'categories', 'products', 'shopping_items', 'purchases', 'purchase_lines', 'price_observations', 'inventory', 'budgets', 'events'] as const

async function fetchAll() {
  const hid = getState().household!.id
  const out: Record<string, Record<string, unknown>[]> = {}
  for (const t of TABLES) {
    const q = supabase.from(t).select('*')
    const { data, error } = await (t === 'households' ? q.eq('id', hid) : q.eq('household_id', hid))
    if (error) throw new Error(`${t}: ${error.message}`)
    out[t] = data ?? []
  }
  return out
}

function Export({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async (kind: 'json' | 'compras' | 'precios') => {
    setBusy(true)
    try {
      const all = await fetchAll()
      const d = todayISO()
      if (kind === 'json') download(`casa-compras-${d}.json`, JSON.stringify(all, null, 2), 'application/json')
      else if (kind === 'compras') {
        const stores = new Map(all.stores.map((s) => [s.id, s.name]))
        const purchases = new Map(all.purchases.map((p) => [p.id, p]))
        const rows = all.purchase_lines.map((l) => {
          const p = purchases.get(l.purchase_id) as Record<string, unknown>
          return { fecha: p?.purchased_on, tienda: stores.get(p?.store_id) ?? '', producto: l.name, cantidad: l.qty, importe: l.line_total, grupo: l.grp, total_ticket: p?.total_paid, compra: l.purchase_id }
        })
        download(`compras-${d}.csv`, toCSV(rows), 'text/csv')
      } else {
        const stores = new Map(all.stores.map((s) => [s.id, s.name]))
        const products = new Map(all.products.map((p) => [p.id, p.name]))
        const rows = all.price_observations.map((o) => ({ fecha: o.observed_on, producto: products.get(o.product_id), tienda: stores.get(o.store_id) ?? '', precio: o.price, formato: o.pack_size, unidad: o.unit, precio_unitario: o.unit_price, origen: o.source }))
        download(`precios-${d}.csv`, toCSV(rows), 'text/csv')
      }
    } catch (e) {
      toast('No se pudo exportar: ' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Exportar datos" onClose={onClose}>
      <div className="stack">
        <button className="btn block" disabled={busy} onClick={() => run('json')}>Copia completa (JSON)</button>
        <button className="btn block" disabled={busy} onClick={() => run('compras')}>Compras línea a línea (CSV)</button>
        <button className="btn block" disabled={busy} onClick={() => run('precios')}>Historial de precios (CSV)</button>
        <p className="small muted">Los CSV se abren directamente en Excel o Google Sheets.</p>
      </div>
    </Sheet>
  )
}

function Account({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const s = useStore((x) => x)
  const me = s.members.find((m) => m.user_id === s.userId)
  const [name, setName] = useState(me?.display_name ?? '')
  const [pw, setPw] = useState('')
  return (
    <Sheet title="Mi cuenta" onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Nombre visible</span><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn block" onClick={() => {
          if (!me || !name.trim()) return
          update('members', me.user_id, { display_name: name.trim() })
          toast('Nombre guardado')
        }}>Guardar nombre</button>
        <label className="field"><span>Nueva contraseña</span><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <button className="btn block" onClick={async () => {
          if (pw.length < 8) return toast('Mínimo 8 caracteres', 'error')
          const { error } = await supabase.auth.updateUser({ password: pw })
          if (error) toast(error.message, 'error')
          else { toast('Contraseña cambiada'); setPw('') }
        }}>Cambiar contraseña</button>
        <button className="btn danger block" onClick={onSignOut}>Cerrar sesión</button>
      </div>
    </Sheet>
  )
}
