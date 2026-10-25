import { useEffect, useState } from 'react'
import { getState, supabase, uid, update } from './store'
import type { Product } from './types'

export const BUCKET = 'product-photos'
const URL_KEY = 'cc-photo-urls-v1'
const TTL = 7 * 24 * 3600 // enlaces firmados de una semana: el navegador los puede cachear
type Cached = Record<string, { url: string; exp: number }>

let cache: Cached = {}
try {
  cache = JSON.parse(localStorage.getItem(URL_KEY) ?? '{}') as Cached
} catch {
  cache = {}
}
const persist = () => {
  try {
    const now = Date.now()
    for (const k of Object.keys(cache)) if (cache[k].exp < now) delete cache[k]
    localStorage.setItem(URL_KEY, JSON.stringify(cache))
  } catch {
    /* sin almacenamiento: seguimos sin caché */
  }
}
const fresh = (path: string) => {
  const c = cache[path]
  return c && c.exp > Date.now() + 3600_000 ? c.url : null
}

// Agrupamos en una sola petición todas las fotos que se pinten a la vez.
let pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
const waiting = new Map<string, Set<(url: string | null) => void>>()
function request(path: string, cb: (url: string | null) => void) {
  if (!waiting.has(path)) waiting.set(path, new Set())
  waiting.get(path)!.add(cb)
  pending.add(path)
  timer ??= setTimeout(() => void sign(), 30)
}
async function sign() {
  const paths = [...pending]
  pending = new Set()
  timer = null
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, TTL)
  for (const r of data ?? []) {
    if (r.path && r.signedUrl) cache[r.path] = { url: r.signedUrl, exp: Date.now() + TTL * 1000 }
  }
  persist()
  for (const p of paths) {
    const url = cache[p]?.url ?? null
    for (const cb of waiting.get(p) ?? []) cb(url)
    waiting.delete(p)
  }
}

export function usePhotoUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState(() => (path ? fresh(path) : null))
  useEffect(() => {
    if (!path) return setUrl(null)
    const hit = fresh(path)
    if (hit) return setUrl(hit)
    let alive = true
    request(path, (u) => alive && setUrl(u))
    return () => { alive = false }
  }, [path])
  return url
}

/** Imagen principal: la foto propia si la hay; si no, la de Open Food Facts. */
export function mainImage(p: Product): { path?: string; url?: string } | null {
  if (p.photos?.length) return { path: p.photos[0] }
  if (p.info?.image_url) return { url: p.info.image_url }
  return null
}

/** Reduce la foto en el móvil (lado mayor 1280 px, JPEG) antes de subirla. */
export async function shrink(file: Blob, max = 1280, quality = 0.72): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('No se pudo leer la imagen'))
      i.src = url
    })
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * k)
    canvas.height = Math.round(img.naturalHeight * k)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen'))), 'image/jpeg', quality))
  } finally {
    URL.revokeObjectURL(url)
  }
}

const current = (id: string) => getState().products.find((p) => p.id === id)

export async function addPhoto(product: Product, file: File): Promise<void> {
  const blob = await shrink(file)
  const path = `${product.household_id}/${product.id}/${uid()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  const photos = current(product.id)?.photos ?? product.photos ?? []
  update('products', product.id, { photos: [...photos, path] })
}

export function makeMain(product: Product, path: string) {
  const photos = current(product.id)?.photos ?? []
  update('products', product.id, { photos: [path, ...photos.filter((p) => p !== path)] })
}

export async function deletePhoto(product: Product, path: string): Promise<void> {
  const photos = current(product.id)?.photos ?? []
  update('products', product.id, { photos: photos.filter((p) => p !== path) })
  // Si falla (sin red) queda un archivo huérfano, que no ve nadie fuera del hogar.
  await supabase.storage.from(BUCKET).remove([path])
  delete cache[path]
  persist()
}
