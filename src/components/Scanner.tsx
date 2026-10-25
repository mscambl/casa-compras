import { useEffect, useRef, useState } from 'react'
import { getState, useStore } from '../lib/store'
import { createProduct, findProductByName, updateProduct } from '../lib/actions'
import { gtinValid, lookupBarcode, normalizeBarcode, type OffResult } from '../lib/off'
import type { Product } from '../lib/types'
import { Sheet, toast } from './ui'

/** Cámara que lee códigos de barras, con la opción de escribir el número a mano. */
export function Scanner({ onCode, busy }: { onCode: (code: string) => void; busy?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const done = useRef(false)
  const cb = useRef(onCode)
  cb.current = onCode

  useEffect(() => {
    let stop: (() => void) | null = null
    let alive = true
    done.current = false
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCamError('Este navegador no permite usar la cámara.')
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
        const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]])
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })
        if (!alive || !video.current) return
        const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current, (result) => {
          if (!result || done.current) return
          const code = normalizeBarcode(result.getText())
          if (!gtinValid(code)) return
          done.current = true
          navigator.vibrate?.(60)
          controls.stop()
          cb.current(code)
        })
        if (!alive) controls.stop()
        else stop = () => controls.stop()
      } catch (e) {
        const name = (e as Error).name
        if (alive) setCamError(name === 'NotAllowedError' ? 'No hay permiso para usar la cámara. Puedes escribir el número.' : 'No se pudo abrir la cámara. Puedes escribir el número.')
      }
    })()
    return () => {
      alive = false
      stop?.()
    }
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const code = normalizeBarcode(manual)
    if (!gtinValid(code)) return toast('Ese número no es un código de barras válido. Revisa los dígitos.', 'error')
    done.current = true
    cb.current(code)
  }

  return (
    <div className="stack">
      {camError ? <p className="muted small">{camError}</p> : (
        <div className="scanner">
          <video ref={video} muted playsInline autoPlay />
          <i className="scan-line" />
        </div>
      )}
      <form className="row" onSubmit={submit}>
        <input className="input" inputMode="numeric" autoComplete="off" placeholder="O escribe el número" aria-label="Número del código de barras"
          value={manual} onChange={(e) => setManual(e.target.value)} maxLength={16} />
        <button className="btn" disabled={busy}>Buscar</button>
      </form>
    </div>
  )
}

/**
 * Escanear para añadir: si ya tenemos el producto lo devuelve; si no, lo crea con
 * los datos de Open Food Facts o pide el nombre.
 */
export function ScanToAdd({ onPick, onClose }: { onPick: (p: Product) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState<{ code: string; offline: boolean } | null>(null)
  const [name, setName] = useState('')

  const finish = (p: Product) => {
    onPick(p)
    onClose()
  }

  const onCode = async (code: string) => {
    const known = getState().products.find((p) => p.barcode === code)
    if (known) return finish(known)
    setBusy(true)
    let found: OffResult | null = null
    let offline = false
    try {
      found = await lookupBarcode(code)
    } catch {
      offline = true
    }
    setBusy(false)
    if (!found) return setUnknown({ code, offline })
    const same = findProductByName(found.name)
    if (same) {
      if (!same.barcode) updateProduct(same, { barcode: code, info: found.info })
      return finish(same)
    }
    toast(`${found.name}: datos de Open Food Facts`)
    finish(createProduct(found.name, { barcode: code, info: found.info, ...(found.pack ? { unit: found.pack.unit, pack_size: found.pack.size } : {}) }))
  }

  const saveName = (e: React.FormEvent) => {
    e.preventDefault()
    const nm = name.trim()
    if (!nm || !unknown) return
    const same = findProductByName(nm)
    if (same) {
      if (!same.barcode) updateProduct(same, { barcode: unknown.code })
      return finish(same)
    }
    finish(createProduct(nm, { barcode: unknown.code }))
  }

  return (
    <Sheet title="Escanear código" onClose={onClose}>
      {unknown ? (
        <form className="stack" onSubmit={saveName}>
          <p className="muted">
            {unknown.offline ? 'Sin conexión con Open Food Facts.' : 'Open Food Facts no conoce este producto.'} Escribe cómo se llama y
            la próxima vez lo reconoceremos por el código ({unknown.code}).
          </p>
          <input className="input" autoFocus value={name} maxLength={80} placeholder="Nombre del producto" aria-label="Nombre del producto" onChange={(e) => setName(e.target.value)} />
          <button className="btn primary block" disabled={!name.trim()}>Guardar</button>
        </form>
      ) : (
        <>
          <Scanner onCode={(c) => void onCode(c)} busy={busy} />
          {busy && <p className="muted small">Buscando el producto…</p>}
        </>
      )}
    </Sheet>
  )
}

/** Hook de conveniencia para saber si ya se puede usar (migración aplicada). */
export const usePhotosReady = () => useStore((s) => s.photosReady)
