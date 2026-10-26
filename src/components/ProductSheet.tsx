import { useEffect, useState } from 'react'
import { supabase, uid, useStore } from '../lib/store'
import { archiveProduct, inventoryFor, removeItem, setStock, updateItem, updateProduct } from '../lib/actions'
import {
  INPUT_UNITS, money, packInput, packLabel, parseNum, pctChange, pctFmt, shortDate, toBase, todayISO, unitPriceLabel, type InputUnit,
} from '../lib/format'
import { LOCATIONS, type Location, type PriceObservation, type Product, type ShoppingItem } from '../lib/types'
import { ConfirmButton, Sheet, toast } from './ui'
import { PackInfo, PhotoGallery } from './ProductMedia'

const SOURCE_LABEL: Record<string, string> = { ticket: 'Ticket', manual: 'Manual', estimado: 'Estimado', oferta: 'Oferta verificada' }

export function ProductSheet({ product, item, onClose }: { product: Product; item?: ShoppingItem; onClose: () => void }) {
  const categories = useStore((s) => s.categories)
  const stores = useStore((s) => s.stores)
  const inv = useStore(() => inventoryFor(product.id))
  const photosReady = useStore((s) => s.photosReady)
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

  useEffect(() => {
    let alive = true
    void supabase.from('price_observations').select('*').eq('product_id', product.id).order('observed_on', { ascending: false }).limit(20)
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
    if (st != null || expires) {
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
      setPrices((cur) => [{ ...row, unit_price: product.pack_size ? p / product.pack_size : null } as PriceObservation, ...(cur ?? [])])
      if (!newPriceOffer) updateProduct(product, { last_price: p })
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
          <label className="field"><span>Caduca</span><input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        </div>
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
          <div className="list">
            {prices.map((p, i) => {
              const prev = prices.slice(i + 1).find((x) => x.store_id === p.store_id && x.source !== 'estimado')
              const ch = prev ? pctChange(p.unit_price ?? p.price, prev.unit_price ?? prev.price) : null
              return (
                <div className="li" key={p.id}>
                  <div className="grow">
                    <div className="num"><b>{money(p.price)}</b> {p.pack_size ? <span className="muted small">· {packLabel(p.unit, p.pack_size)} · {unitPriceLabel(p.price, p.unit, p.pack_size)}</span> : null}</div>
                    <div className="small muted">{shortDate(p.observed_on)} · {stores.find((s) => s.id === p.store_id)?.name ?? 'Sin tienda'} · {SOURCE_LABEL[p.source]}</div>
                  </div>
                  {ch != null && Math.abs(ch) >= 0.005 && <span className={`tag ${ch > 0 ? 'danger' : 'ok'}`}>{pctFmt(ch)}</span>}
                </div>
              )
            })}
          </div>
        )}

        <h2>Opciones</h2>
        {item && <button className="btn block" onClick={() => { removeItem(item); onClose() }}>Quitar de la lista</button>}
        <ConfirmButton onConfirm={() => { archiveProduct(product); onClose(); toast('Producto archivado') }}>Archivar producto</ConfirmButton>
        <p className="small muted">Archivar lo quita del catálogo pero conserva su historial de compras y precios.</p>
      </div>
    </Sheet>
  )
}

