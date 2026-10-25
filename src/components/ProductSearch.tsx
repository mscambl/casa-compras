import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { ScanToAdd } from './Scanner'
import { norm, rank } from '../lib/text'
import type { Product } from '../lib/types'
import { Icon } from './ui'
import { money } from '../lib/format'

/** Buscador con autocompletado. Elegir crea el producto si no existe. */
export function ProductSearch({
  placeholder, onPick, badge, sticky = true,
}: {
  placeholder: string
  onPick: (p: Product | string) => void
  badge?: (p: Product) => string | null
  sticky?: boolean
}) {
  const products = useStore((s) => s.products)
  const canScan = useStore((s) => s.photosReady)
  const [q, setQ] = useState('')
  const [scan, setScan] = useState(false)
  const results = useMemo(() => rank(products, q, 6), [products, q])
  const exact = results.find((p) => norm(p.name) === norm(q))

  const pick = (p: Product | string) => {
    onPick(p)
    setQ('')
  }

  return (
    <div className={sticky ? 'adder' : ''} style={sticky ? undefined : { position: 'relative' }}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!q.trim()) return
          pick(exact ?? results[0] ?? q.trim())
        }}
      >
        <Icon name="search" className="lens" />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          enterKeyHint="done"
          autoComplete="off"
          aria-label={placeholder}
          maxLength={80}
          style={{ paddingLeft: 42, paddingRight: canScan ? 50 : undefined }}
        />
        {canScan && (
          <button type="button" className={`scan-btn${sticky ? ' in-adder' : ''}`} aria-label="Escanear código de barras" onClick={() => setScan(true)}>
            <Icon name="barcode" />
          </button>
        )}
      </form>
      {scan && <ScanToAdd onPick={(p) => pick(p)} onClose={() => setScan(false)} />}
      {q.trim() && (
        <div className="suggest" style={sticky ? undefined : { top: 52, left: 0, right: 0 }}>
          {results.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p)}>
              <span className="grow">{p.name}</span>
              {badge?.(p) && <span className="tag">{badge(p)}</span>}
              {p.last_price != null && <span className="muted small num">{money(p.last_price)}</span>}
            </button>
          ))}
          {!exact && (
            <button type="button" onClick={() => pick(q.trim())}>
              <Icon name="plus" className="ok" />
              <span className="grow">Añadir «{q.trim()}»</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
