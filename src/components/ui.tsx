import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../lib/store'

const paths: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  euro: 'M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  x: 'M6 6l12 12M18 6L6 18',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
  cart: 'M3 4h2l2.4 11h11l2-8H6.2M9 20h.01M18 20h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  food: 'M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9',
}

export function Icon({ name, ...rest }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={paths[name]} />
    </svg>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="row">
          <h3 className="grow">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Stepper({ value, onChange, min = 0, label }: { value: number; onChange: (n: number) => void; min?: number; label?: string }) {
  return (
    <div className="stepper" aria-label={label ?? 'Cantidad'}>
      <button type="button" aria-label="Menos" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span>{new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)}</span>
      <button type="button" aria-label="Más" onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

export function Who({ userId }: { userId: string | null }) {
  const members = useStore((s) => s.members)
  const idx = members.findIndex((m) => m.user_id === userId)
  const m = members[idx]
  if (!m) return null
  const color = idx === 0 ? 'var(--mike)' : 'var(--silvia)'
  return <span className="who" style={{ background: color }} title={m.display_name}>{m.display_name.charAt(0).toUpperCase()}</span>
}

export function memberName(members: { user_id: string; display_name: string }[], id: string | null) {
  return members.find((m) => m.user_id === id)?.display_name ?? '—'
}

// ---------------------------------------------------------------------------
// Avisos breves (toasts)
// ---------------------------------------------------------------------------

interface ToastMsg { id: number; text: string; kind: 'info' | 'error'; action?: { label: string; run: () => void } }
let pushToast: (t: Omit<ToastMsg, 'id'>) => void = () => {}
export function toast(text: string, kind: 'info' | 'error' = 'info', action?: ToastMsg['action']) {
  pushToast({ text, kind, action })
}

export function Toasts() {
  const [t, setT] = useState<ToastMsg | null>(null)
  const timer = useRef<number>()
  useEffect(() => {
    pushToast = (m) => {
      window.clearTimeout(timer.current)
      setT({ ...m, id: Date.now() })
      timer.current = window.setTimeout(() => setT(null), m.action ? 6000 : 3500)
    }
  }, [])
  if (!t) return null
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className={`toast ${t.kind}`}>
        <span className="grow">{t.text}</span>
        {t.action && (
          <button onClick={() => { t.action!.run(); setT(null) }}>{t.action.label}</button>
        )}
      </div>
    </div>
  )
}

/** Botón que pide un segundo toque para confirmar (evita diálogos del navegador). */
export function ConfirmButton({ children, onConfirm, className = 'btn danger block' }: { children: ReactNode; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button type="button" className={className} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Toca otra vez para confirmar' : children}
    </button>
  )
}
