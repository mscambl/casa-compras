import { useMemo } from 'react'
import { useStore } from '../lib/store'
import { addToList } from '../lib/actions'
import { money, monthKey, monthLabel, round2, todayISO } from '../lib/format'
import { alerts, budgetFor, forecast, monthSpend } from '../lib/stats'
import { Icon, toast } from '../components/ui'
import { itemPrice } from './List'
import type { Tab } from '../App'

export function HomeScreen({ go }: { go: (t: Tab) => void }) {
  const s = useStore((x) => x)
  const today = todayISO()
  const month = monthKey(today)
  const pmap = useMemo(() => new Map(s.products.map((p) => [p.id, p])), [s.products])
  const pending = s.items.filter((i) => !i.checked)
  const est = round2(s.items.reduce((a, i) => a + (itemPrice(i, pmap.get(i.product_id)) ?? 0), 0))
  const spend = useMemo(() => monthSpend(s.purchases, month), [s.purchases, month])
  const fc = forecast(spend.total, today)
  const budget = budgetFor(s.budgets, month, 'total')
  const al = useMemo(() => alerts(s.products, s.inventory, s.items, s.purchases, today), [s.products, s.inventory, s.items, s.purchases, today])
  const me = s.members.find((m) => m.user_id === s.userId)

  return (
    <>
      <div className="page-head">
        <h1>Hola{me ? `, ${me.display_name}` : ''}</h1>
        {!s.online && <span className="status off">Sin conexión{s.pending ? ` · ${s.pending} por enviar` : ''}</span>}
      </div>
      <div className="page stack">
        <button className="card card-btn" onClick={() => go('lista')}>
          <div className="row">
            <div className="grow">
              <div className="muted small">Lista de la compra</div>
              <div className="big num" data-testid="home-pending">{pending.length} <span style={{ fontSize: 16, fontWeight: 500 }}>{pending.length === 1 ? 'pendiente' : 'pendientes'}</span></div>
              <div className="small muted num">Estimado {money(est)}</div>
            </div>
            <span className="btn primary" aria-hidden="true"><Icon name="list" /> Abrir</span>
          </div>
        </button>

        <button className="card card-btn" onClick={() => go('gastos')}>
          <div className="muted small">{monthLabel(month)}</div>
          <div className="row">
            <div className="big num grow">{money(spend.total)}</div>
            {budget != null && <div className="right small"><div className="muted">de {money(budget)}</div><div className={spend.total > budget ? 'danger' : 'ok'}>{spend.total > budget ? `Te pasas ${money(spend.total - budget)}` : `Quedan ${money(budget - spend.total)}`}</div></div>}
          </div>
          {spend.total > 0 && <div className="small muted">Previsión a fin de mes {money(fc.value)}{fc.reliable ? '' : ' (poco fiable aún)'}</div>}
          {budget == null && <div className="small muted">Mes de medición: aún sin presupuesto</div>}
        </button>

        <h2>Avisos</h2>
        {al.length === 0 ? <p className="muted small">Nada urgente. Los avisos de caducidad y reposición aparecerán aquí.</p> : (
          <div className="list">
            {al.slice(0, 6).map((a) => (
              <div className="li" key={a.product.id + a.kind}>
                <div className="grow">
                  <div className="title">{a.product.name}</div>
                  <div className={`small ${a.urgency === 'urgente' ? 'danger' : a.urgency === 'pronto' ? 'warn' : 'muted'}`}>{a.text}</div>
                </div>
                {(a.kind === 'minimo' || a.kind === 'reponer') && (
                  <button className="btn sm" onClick={() => { addToList(a.product); toast(`${a.product.name} añadido a la lista`) }}>Añadir</button>
                )}
                {(a.kind === 'caduca' || a.kind === 'caducado') && <span className="tag warn">Consumir</span>}
              </div>
            ))}
          </div>
        )}
        {al.length > 6 && <button className="btn ghost block" onClick={() => go('casa')}>Ver {al.length - 6} más</button>}

        <div className="grid2">
          <button className="btn block" onClick={() => go('casa')}><Icon name="box" /> En casa</button>
          <button className="btn block" onClick={() => go('mas')}><Icon name="more" /> Más</button>
        </div>
      </div>
    </>
  )
}
