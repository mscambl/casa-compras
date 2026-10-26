import { useRef, useState } from 'react'
import { getState, useStore } from '../lib/store'
import { updateProduct } from '../lib/actions'
import { addPhoto, deletePhoto, mainImage, makeMain, usePhotoUrl } from '../lib/photos'
import { lookupBarcode, NUTRIENT_LABEL } from '../lib/off'
import { shortDate } from '../lib/format'
import type { NutrientKey, Product } from '../lib/types'
import { Scanner } from './Scanner'
import { ConfirmButton, Icon, Sheet, toast } from './ui'

const useLive = (p: Product) => useStore((s) => s.products.find((x) => x.id === p.id)) ?? p

/** Miniatura para las listas. No pinta nada si el producto no tiene imagen. */
export function Thumb({ product }: { product: Product }) {
  const img = mainImage(product)
  const signed = usePhotoUrl(img?.path)
  const src = img?.url ?? signed
  if (!img) return null
  return src ? <img className="thumb" src={src} alt="" loading="lazy" /> : <span className="thumb" />
}

function Photo({ path, url, alt }: { path?: string; url?: string; alt: string }) {
  const signed = usePhotoUrl(path)
  const src = url ?? signed
  return src ? <img src={src} alt={alt} loading="lazy" /> : <img alt="" />
}

export function PhotoGallery({ product: p0 }: { product: Product }) {
  const product = useLive(p0)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<{ path?: string; url?: string } | null>(null)
  const photos = product.photos ?? []
  const offImg = product.info?.image_url

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!navigator.onLine) return toast('Necesitas conexión para subir la foto', 'error')
    if (photos.length >= 8) return toast('Máximo 8 fotos por producto. Borra alguna antes.', 'error')
    setBusy(true)
    try {
      await addPhoto(product, file)
      toast('Foto guardada')
    } catch (err) {
      toast('No se pudo subir la foto: ' + (err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="gallery" data-testid="gallery">
        {photos.map((path, i) => (
          <button key={path} type="button" onClick={() => setOpen({ path })} aria-label={`Ver foto ${i + 1}`}><Photo path={path} alt={product.name} /></button>
        ))}
        {offImg && (
          <button type="button" onClick={() => setOpen({ url: offImg })} aria-label="Ver foto de la base de datos"><Photo url={offImg} alt={product.name} /></button>
        )}
        <button type="button" className="add-photo" disabled={busy} onClick={() => input.current?.click()}>
          <span><Icon name="camera" /><br />{busy ? 'Subiendo…' : 'Añadir foto'}</span>
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void onFile(e)} data-testid="photo-input" />
      </div>
      {open && (
        <div className="viewer" role="dialog" aria-label="Foto" onClick={() => setOpen(null)}>
          <div className="row" onClick={(e) => e.stopPropagation()}>
            {open.path ? (
              <div className="row">
                {photos[0] !== open.path && <button className="btn sm" onClick={() => { makeMain(product, open.path!); setOpen(null) }}>Poner como principal</button>}
                <button className="btn sm danger" onClick={() => { void deletePhoto(product, open.path!); setOpen(null); toast('Foto borrada') }}>Borrar foto</button>
              </div>
            ) : <span className="small" style={{ color: '#ccc' }}>Foto de {product.info?.db ?? 'Open Food Facts'}</span>}
            <button className="icon-btn" onClick={() => setOpen(null)} aria-label="Cerrar foto"><Icon name="x" /></button>
          </div>
          <Photo path={open.path} url={open.url} alt={product.name} />
        </div>
      )}
    </>
  )
}

const fmtN = (k: NutrientKey, v: number) => {
  const n = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(v)
  return k === 'kcal' ? `${n} kcal` : `${n} g`
}

/** Código de barras y datos del envase (ingredientes, alérgenos, nutrición). */
export function PackInfo({ product: p0 }: { product: Product }) {
  const product = useLive(p0)
  const [scan, setScan] = useState(false)
  const [busy, setBusy] = useState(false)
  const info = product.info

  const fetchInfo = async (code: string) => {
    setBusy(true)
    try {
      const found = await lookupBarcode(code)
      if (found) {
        updateProduct(product, { barcode: code, info: found.info })
        toast(`Datos actualizados desde ${found.info.db}`)
      } else {
        updateProduct(product, { barcode: code })
        toast('Código guardado. Ninguna base de datos abierta conoce este producto: puedes hacer una foto de la etiqueta.')
      }
    } catch {
      updateProduct(product, { barcode: code })
      toast('Código guardado. Sin conexión con las bases de datos: prueba «Actualizar datos» más tarde.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const onCode = (code: string) => {
    setScan(false)
    const other = getState().products.find((p) => p.barcode === code && p.id !== product.id)
    if (other) return toast(`Ese código ya es de «${other.name}»`, 'error')
    void fetchInfo(code)
  }

  const nutrition = info?.nutrition ? (Object.keys(NUTRIENT_LABEL) as NutrientKey[]).filter((k) => info.nutrition![k] != null) : []

  return (
    <div className="stack">
      <div className="row">
        <Icon name="barcode" />
        <div className="grow">
          {product.barcode ? <span className="num">{product.barcode}</span> : <span className="muted">Sin código de barras</span>}
          {info?.brand && <div className="small muted">{[info.brand, info.quantity].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => setScan(true)}>{product.barcode ? 'Cambiar código' : 'Escanear código'}</button>
        {product.barcode && <button className="btn sm" disabled={busy} onClick={() => void fetchInfo(product.barcode!)}>{busy ? 'Buscando…' : 'Actualizar datos'}</button>}
      </div>

      {info && (
        <div className="card stack" data-testid="pack-info">
          {(info.nutriscore || info.nova) && (
            <div className="row small">
              {info.nutriscore && <><span className={`nutri ${info.nutriscore}`} aria-label={`Nutri-Score ${info.nutriscore.toUpperCase()}`}>{info.nutriscore}</span><span>Nutri-Score</span></>}
              {info.nova && <span className="tag">NOVA {info.nova}</span>}
            </div>
          )}
          {info.allergens && (
            <div className="small"><b>Alérgenos:</b> {info.allergens.map((a) => <span key={a} className="tag danger" style={{ marginRight: 4 }}>{a}</span>)}</div>
          )}
          {info.traces && <div className="small muted">Puede contener trazas de: {info.traces.join(', ')}</div>}
          {info.ingredients && (
            <details>
              <summary className="small"><b>Ingredientes</b></summary>
              <p className="small" style={{ margin: '6px 0 0' }}>{info.ingredients}</p>
            </details>
          )}
          {nutrition.length > 0 && (
            <details open>
              <summary className="small"><b>Información nutricional</b> <span className="muted">por {info.per ?? '100 g'}</span></summary>
              <table className="nutri-table"><tbody>
                {nutrition.map((k) => (
                  <tr key={k}><td className={k === 'saturated' || k === 'sugars' ? 'sub' : ''}>{NUTRIENT_LABEL[k].trim()}</td><td>{fmtN(k, info.nutrition![k]!)}</td></tr>
                ))}
              </tbody></table>
            </details>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Fuente: {info.db ?? 'Open Food Facts'}, {shortDate(info.fetched_on)}. Son datos abiertos aportados por voluntarios: compruébalos en el envase si hay alergias.
          </p>
          <ConfirmButton onConfirm={() => updateProduct(product, { info: null })}>Quitar estos datos</ConfirmButton>
        </div>
      )}

      {scan && (
        <Sheet title="Escanear código" onClose={() => setScan(false)}>
          <Scanner onCode={onCode} />
        </Sheet>
      )}
    </div>
  )
}
