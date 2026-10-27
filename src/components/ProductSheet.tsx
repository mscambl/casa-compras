import { useEffect, useState } from 'react'
import { supabase, uid, useStore } from '../lib/store'
import { archiveProduct, inventoryFor, removeItem, setStock, updateItem, updateProduct } from '../lib/actions'
import {
  INPUT_UNITS, money, packInput, packLabel, parseNum, pctChange, pctFmt, shortDate, toBase, todayISO, unitPriceLabel, type InputUnit,
} from '../lib/format'
import { LOCATIONS, type Location, type PriceObservation, type Product, type ShoppingItem, type Unit } from '../lib/types'
import { ConfirmButton, Icon, Sheet, toast } from './ui'
import { PackInfo, PhotoGallery } from './ProductMedia'
import { LotsEditor } from './Lots'

const SOURCE_LABEL: Record<string, string> = { ticket: 'Ticket', manual: 'Manual', estimado: 'Estimado', oferta: 'Oferta verificada' }

export function ProductSheet({ product, item, onClose }: { product: Product; item?: ShoppingItem; onClose: () => void }) {
  const categories = useStore((s) => s.categories)
  const stores = useStore((s) => s.stores)
  const inv = useStore(() => inventoryFor(product.id))
  const photosReady = useStore((s) => s.photosReady)
  const packsReady = useStore((s) => s.packsReady)
  const pk = packInput(product.unit, product.pack_size)

  const [name, setName] = useState(product.name)
  const [cat, setCat] = useState(product.category_id ?? '')
  const [packSize, setPackSize] = useState(pk.size)
  const [packUnit, setPackUnit] = useState<InputUnit>(pk.unit)
  const [store, setStore] = useState(product.usual_store_id ?? '')
  const [staple, setStaple] = useState(product.is_staple)
  const [minQty, setMinQty] = useState(product.min_qty?.toString() ?? '')
  const [restock, setRestock] = useState(product.restock_days?.toString() ?? '')
  const [loc, setLoc] = useState<Location | ''>(product.location ?? '')
  const [qty, setQty] = useState(item ? String(item.qty) : '')
  const [est, setEst] = useState(item?.est_price != null ? String(item.est_price).replace('.', ',') : '')
  const [itemStore, setItemStore] = useState(item?.store_id ?? '')
  const [note, setNote] = useState(item?.note ?? '')
  const [stock, setStockStr] = useState(inv ? String(inv.qty) : '')
  const [expires, setExpires] = useState(inv?.expires_on ?? '')

  const [prices, setPrices] = useState<PriceObservation[] | null>(null)
  const [newPrice, setNewPrice] = useState('')
  const [newPriceStore, setNewPriceStore] = useState(product.usual_store_id ?? '')
  const [newPriceOffer, setNewPriceOffer] = useState(false)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)

  /** El último precio pagado (ticket o manual) es el que se usa para estimar la lista. */
  const syncLastPrice = (list: PriceObservation[]) => {
    const last = list.find((x) => x.source === 'ticket' || x.source === 'manual')
    const lp = last ? last.price : null
    if (lp !== product.last_price) updateProduct(product, { last_price: lp })
  }
  const sortPrices = (list: PriceObservation[]) => list.slice().sort((a, b) => b.observed_on.localeCompare(a.observed_on))

  useEffect(() => {
    let alive = true
    void supabase.from('price_observations').select('*').eq('product_id', product.id).order('observed_on', { ascending: false }).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => alive && setPrices(((data ?? []) as PriceObservation[]).map((p) => ({ ...p, price: Number(p.price), pack_size: p.pack_size == null ? null : Number(p.pack_size), unit_price: p.unit_price == null ? null : Number(p.unit_price) }))))
    return () => { alive = false }
  }, [product.id])

  const save = () => {
    const nm = name.trim()
    if (!nm) return toast('El nombre no puede estar vacío', 'error')
    const size = parseNum(packSize)
    const base = size ? toBase(size, packUnit) : { unit: packUnit === 'g' ? 'kg' : packUnit === 'ml' ? 'l' : packUnit === 'cm' ? 'm' : packUnit, size: null }
    updateProduct(product, {
      name: nm,
      category_id: cat || null,
      unit: base.unit as Product['unit'],
      pack_size: base.size,
      usual_store_id: store || null,
      is_staple: staple,
      min_qty: parseNum(minQty),
      restock_days: parseNum(restock) ? Math.round(parseNum(restock)!) : null,
      location: (loc || null) as Location | null,
    })
    if (item) {
      const q = parseNum(qty)
      updateItem(item, { qty: q && q > 0 ? q : 1, est_price: parseNum(est), store_id: itemStore || null, note: note.trim() || null })
    }
    const st = parseNum(stock)
    if (packsReady) {
      // Las fechas se guardan al momento en «Caducidades»; aquí solo cantidad y ubicación.
      if (st != null && (st !== (inv?.qty ?? null) || (loc || null) !== (inv?.location ?? null))) setStock(product, st, { location: (loc || null) as Location | null })
    } else if (st != null || expires) {
      if (st !== (inv?.qty ?? null) || (expires || null) !== (inv?.expires_on ?? null) || (loc || null) !== (inv?.location ?? null)) {
        setStock(product, st ?? inv?.qty ?? 0, { expires_on: expires || null, location: (loc || null) as Location | null })
      }
    }
    onClose()
  }

  const addPrice = () => {
    const p = parseNum(newPrice)
    if (p == null || p < 0) return toast('Escribe un precio válido', 'error')
    const row = {
      id: uid(), household_id: product.household_id, product_id: product.id, store_id: newPriceStore || null, observed_on: todayISO(),
      price: p, unit: product.unit, pack_size: product.pack_size, source: newPriceOffer ? 'oferta' : 'manual',
    }
    // price_observations no se guarda en el estado global: escribimos directo y actualizamos la vista.
    void supabase.from('price_observations').insert(row).then(({ error }) => {
      if (error) return toast('No se pudo guardar el precio: ' + error.message, 'error')
      const list = sortPrices([{ ...row, unit_price: product.pack_size ? p / product.pack_size : null } as PriceObservation, ...(prices ?? [])])
      setPrices(list)
      syncLastPrice(list)
      setNewPrice('')
      toast('Precio guardado')
    })
  }

  return (
    <Sheet title={product.name} onClose={onClose}>
      <div className="stack">
        {photosReady && <PhotoGallery product={product} />}
        {item && (
          <div className="card stack">
            <div className="grid2">
              <label className="field"><span>Cantidad</span><input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
              <label className="field"><span>Precio estimado (ud)</span><input className="input" inputMode="decimal" placeholder={product.last_price != null ? money(product.last_price) : '€'} value={est} onChange={(e) => setEst(e.target.value)} /></label>
            </div>
            <label className="field"><span>Comprar en</span>
              <select className="input" value={itemStore} onChange={(e) => setItemStore(e.target.value)}>
                <option value="">Cualquiera</option>
                {stores.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Nota</span><input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Marca, tamaño…" /></label>
          </div>
        )}

        <label className="field"><span>Nombre</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid2">
          <label className="field"><span>Categoría</span>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Tienda habitual</span>
            <select className="input" value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">—</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Formato habitual (para comparar por kg, litro, metro o unidad)</span>
          <div className="row">
            <input className="input" inputMode="decimal" placeholder="Ej. 500" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
            <select className="input" style={{ width: 110 }} value={packUnit} onChange={(e) => setPackUnit(e.target.value as InputUnit)}>
              {INPUT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <label className="toggle"><span>Producto habitual (aparece en «Habituales»)</span><input type="checkbox" checked={staple} onChange={(e) => setStaple(e.target.checked)} /></label>

        <h2>En casa</h2>
        <div className="grid2">
          <label className="field"><span>Tenemos</span><input className="input" inputMode="decimal" value={stock} placeholder="0" onChange={(e) => setStockStr(e.target.value)} /></label>
          <label className="field"><span>Mínimo deseado</span><input className="input" inputMode="decimal" value={minQty} placeholder="—" onChange={(e) => setMinQty(e.target.value)} /></label>
          <label className="field"><span>Ubicación</span>
            <select className="input" value={loc} onChange={(e) => setLoc(e.target.value as Location | '')}>
              <option value="">—</option>
              {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          {!packsReady && <label className="field"><span>Caduca</span><input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>}
        </div>
        {packsReady && <LotsEditor product={product} onQty={(n) => setStockStr(String(n))} />}
        <label className="field"><span>Reponer cada (días)</span><input className="input" inputMode="numeric" value={restock} placeholder="Se calcula con el historial" onChange={(e) => setRestock(e.target.value)} /></label>

        <button className="btn primary block" onClick={save}>Guardar</button>

        {photosReady && (
          <>
            <h2>Envase</h2>
            <PackInfo product={product} />
          </>
        )}

        <h2>Precios</h2>
        <div className="card stack">
          <div className="row">
            <input className="input" inputMode="decimal" placeholder="Precio visto (€)" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
            <select className="input" style={{ width: 140 }} value={newPriceStore} onChange={(e) => setNewPriceStore(e.target.value)}>
              <option value="">Tienda</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <label className="toggle small"><span>Es una oferta comprobada en tienda</span><input type="checkbox" checked={newPriceOffer} onChange={(e) => setNewPriceOffer(e.target.checked)} /></label>
          <button className="btn sm" onClick={addPrice}>Guardar precio</button>
        </div>
        {prices === null ? <p className="muted small">Cargando…</p> : prices.length === 0 ? (
          <p className="muted small">Aún no hay precios. Se guardan solos al cerrar una compra.</p>
        ) : (
          <>
          <p className="small muted" style={{ margin: 0 }}>Toca un precio para corregirlo o borrarlo.</p>
          <div className="list">
            {prices.map((p, i) => {
              const prev = prices.slice(i + 1).find((x) => x.store_id === p.store_id && x.source !== 'estimado')
              const ch = prev ? pctChange(p.unit_price ?? p.price, prev.unit_price ?? prev.price) : null
              if (editingPrice === p.id) {
                return (
                  <PriceEdit key={p.id} obs={p} onCancel={() => setEditingPrice(null)}
                    onSaved={(next) => {
                      const list = sortPrices(prices.map((x) => (x.id === next.id ? next : x)))
                      setPrices(list)
                      syncLastPrice(list)
                      setEditingPrice(null)
                    }}
                    onDeleted={() => {
                      const list = prices.filter((x) => x.id !== p.id)
                      setPrices(list)
                      syncLastPrice(list)
                      setEditingPrice(null)
                    }} />
                )
              }
              return (
                <button className="li" key={p.id} data-testid="price" onClick={() => setEditingPrice(p.id)}>
                  <div className="grow">
                    <div className="num"><b>{money(p.price)}</b> {p.pack_size ? <span className="muted small">· {packLabel(p.unit, p.pack_size)} · {unitPriceLabel(p.price, p.unit, p.pack_size)}</span> : null}</div>
                    <div className="small muted">{shortDate(p.observed_on)} · {stores.find((s) => s.id === p.store_id)?.name ?? 'Sin tienda'} · {SOURCE_LABEL[p.source]}</div>
                  </div>
                  {ch != null && Math.abs(ch) >= 0.005 && <span className={`tag ${ch > 0 ? 'danger' : 'ok'}`}>{pctFmt(ch)}</span>}
                  <Icon name="edit" className="muted" />
                </button>
              )
            })}
          </div>
          </>
        )}

        <h2>Opciones</h2>
        {item && <button className="btn block" onClick={() => { removeItem(item); onClose() }}>Quitar de la lista</button>}
        <ConfirmButton onConfirm={() => { archiveProduct(product); onClose(); toast('Producto archivado') }}>Archivar producto</ConfirmButton>
        <p className="small muted">Archivar lo quita del catálogo pero conserva su historial de compras y precios.</p>
      </div>
    </Sheet>
  )
}


/** Corregir o borrar un precio del historial (también los que vienen de un ticket). */
function PriceEdit({ obs, onSaved, onDeleted, onCancel }: {
  obs: PriceObservation
  onSaved: (next: PriceObservation) => void
  onDeleted: () => void
  onCancel: () => void
}) {
  const stores = useStore((s) => s.stores)
  const pk = packInput(obs.unit, obs.pack_size)
  const [price, setPrice] = useState(String(obs.price).replace('.', ','))
  const [date, setDate] = useState(obs.observed_on)
  const [store, setStore] = useState(obs.store_id ?? '')
  const [size, setSize] = useState(pk.size)
  const [unit, setUnit] = useState<InputUnit>(pk.unit)
  const [offer, setOffer] = useState(obs.source === 'oferta')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const p = parseNum(price)
    if (p == null || p < 0) return toast('Escribe un precio válido', 'error')
    if (!date) return toast('Pon una fecha', 'error')
    const n = parseNum(size)
    const base = n ? toBase(n, unit) : { unit: unit === 'g' ? 'kg' : unit === 'ml' ? 'l' : unit === 'cm' ? 'm' : unit, size: null }
    // Un precio de ticket sigue siendo de ticket; los demás pasan a manual u oferta.
    const source = obs.source === 'ticket' ? 'ticket' : offer ? 'oferta' : 'manual'
    const patch = { price: p, observed_on: date, store_id: store || null, unit: base.unit as Unit, pack_size: base.size, source } as const
    setBusy(true)
    const { error } = await supabase.from('price_observations').update(patch).eq('id', obs.id)
    setBusy(false)
    if (error) return toast('No se pudo guardar: ' + error.message, 'error')
    toast('Precio corregido')
    onSaved({ ...obs, ...patch, unit_price: base.size ? p / base.size : null })
  }
  const del = async () => {
    setBusy(true)
    const { error } = await supabase.from('price_observations').delete().eq('id', obs.id)
    setBusy(false)
    if (error) return toast('No se pudo borrar: ' + error.message, 'error')
    toast('Precio borrado')
    onDeleted()
  }

  return (
    <div className="li" data-testid="price-edit" style={{ display: 'block' }}>
      <div className="stack">
        <div className="grid2">
          <label className="field"><span>Precio (€)</span><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="field"><span>Fecha</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Tienda</span>
            <select className="input" value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">Sin tienda</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="field"><span>Formato de ese precio</span>
            <div className="row">
              <input className="input" inputMode="decimal" value={size} placeholder="—" onChange={(e) => setSize(e.target.value)} aria-label="Formato" />
              <select className="input" style={{ width: 80 }} value={unit} onChange={(e) => setUnit(e.target.value as InputUnit)} aria-label="Unidad del formato">
                {INPUT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
        </div>
        {obs.source === 'ticket'
          ? <p className="small muted" style={{ margin: 0 }}>Viene de un ticket. Borrarlo no cambia la compra ni el gasto.</p>
          : <label className="toggle small"><span>Es una oferta comprobada en tienda</span><input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} /></label>}
        <div className="row">
          <button className="btn sm primary" disabled={busy} onClick={() => void save()}>Guardar</button>
          <button className="btn sm" disabled={busy} onClick={onCancel}>Cancelar</button>
          <span className="grow" />
          <ConfirmButton className="btn sm danger" onConfirm={() => void del()}>Borrar</ConfirmButton>
        </div>
      </div>
    </div>
  )
}
