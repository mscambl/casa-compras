import { useMemo, useState } from 'react'
import { reloadPurchases, rpcNow, type PurchaseWithLines, useStore } from '../lib/store'
import { setBudget } from '../lib/actions'
import { addMonths, money, monthKey, monthLabel, parseNum, pctChange, pctFmt, shortDate, todayISO } from '../lib/format'
import { budgetFor, forecast, metrics, monthSpend, topProducts } from '../lib/stats'
import { GROUPS, type BudgetGroup } from '../lib/types'
import { PurchaseSheet } from '../components/PurchaseSheet'
import { PurchaseEdit } from '../components/PurchaseEdit'
import { ConfirmButton, Icon, Sheet, memberName, toast } from '../components/ui'

export function SpendingScreen() {
  const purchases = useStore((s) => s.purchases)
  const budgets = useStore((s) => s.budgets)
  const stores = useStore((s) => s.stores)
  const events = useStore((s) => s.events)
  const today = todayISO()
  const current = monthKey(today)
  const [month, setMonth] = useState(current)
  const [manual, setManual] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [viewing, setViewing] = useState<PurchaseWithLines | null>(null)

  const isCurrent = month === current
  const day = Number(today.slice(8, 10))
  const spend = useMemo(() => monthSpend(purchases, month), [purchases, month])
  // Comparación justa: mes anterior hasta el mismo día si es el mes en curso.
  const prev = useMemo(() => monthSpend(purchases, addMonths(month, -1), isCurrent ? day : undefined), [purchases, month, isCurrent, day])
  const fc = isCurrent ? forecast(spend.total, today) : null
  const totalBudget = budgetFor(budgets, month, 'total')
  const top = useMemo(() => topProducts(purchases, month), [purchases, month])
  const m = useMemo(() => metrics(purchases, events, month), [purchases, events, month])
  const monthPurchases = purchases.filter((p) => p.purchased_on.slice(0, 7) === month.slice(0, 7))
  const change = pctChange(spend.total, prev.total)
  const hasData = purchases.length > 0
  const firstPurchase = purchases.length ? purchases[purchases.length - 1].purchased_on : null

  return (
    <>
      <div className="page-head">
        <h1>Gastos</h1>
        <button className="btn sm" onClick={() => setManual(true)}><Icon name="plus" /> Compra</button>
      </div>
      <div className="page stack">
        <div className="row">
          <button className="icon-btn" aria-label="Mes anterior" onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevL" /></button>
          <div className="grow" style={{ textAlign: 'center', fontWeight: 600 }}>{monthLabel(month)}</div>
          <button className="icon-btn" aria-label="Mes siguiente" disabled={isCurrent} onClick={() => setMonth(addMonths(month, 1))}><Icon name="chevR" /></button>
        </div>

        <div className="card">
          <div className="muted small">Gastado</div>
          <div className="big num" data-testid="month-total">{money(spend.total)}</div>
          {totalBudget != null && <BudgetBar spent={spend.total} budget={totalBudget} />}
          <div className="small muted" style={{ marginTop: 6 }}>
            {totalBudget != null ? `Presupuesto ${money(totalBudget)} · quedan ${money(Math.max(0, totalBudget - spend.total))}` : 'Sin presupuesto: mes de medición'}
          </div>
          {fc && spend.total > 0 && (
            <div className="small" style={{ marginTop: 4 }}>
              Previsión a fin de mes: <b className="num">{money(fc.value)}</b>{!fc.reliable && <span className="muted"> (poco fiable aún)</span>}
            </div>
          )}
          {change != null && (
            <div className="small muted" style={{ marginTop: 4 }}>
              {pctFmt(change)} frente a {monthLabel(addMonths(month, -1)).toLowerCase()}{isCurrent ? ` hasta el día ${day}` : ''} ({money(prev.total)})
            </div>
          )}
        </div>

        <button className="btn block" onClick={() => setBudgetOpen(true)}>{totalBudget != null ? 'Editar presupuesto' : 'Fijar presupuesto'}</button>

        <h2>Por grupo</h2>
        <div className="list">
          {GROUPS.map((g) => {
            const b = budgetFor(budgets, month, g.id)
            return (
              <div className="li" key={g.id} style={{ display: 'block' }}>
                <div className="row"><span className="grow">{g.label}</span><b className="num">{money(spend.byGroup[g.id])}</b>{b != null && <span className="small muted num">/ {money(b)}</span>}</div>
                {b != null && <BudgetBar spent={spend.byGroup[g.id]} budget={b} />}
              </div>
            )
          })}
          {spend.unassigned > 0 && (
            <div className="li"><span className="grow muted">Sin desglosar (solo total del ticket)</span><b className="num">{money(spend.unassigned)}</b></div>
          )}
        </div>

        {spend.byStore.size > 0 && (
          <>
            <h2>Por tienda</h2>
            <div className="list">
              {[...spend.byStore.entries()].sort((a, b) => b[1] - a[1]).map(([sid, v]) => (
                <div className="li" key={sid ?? '_'}><span className="grow">{stores.find((s) => s.id === sid)?.name ?? 'Sin indicar'}</span><b className="num">{money(v)}</b></div>
              ))}
            </div>
          </>
        )}

        {top.length > 0 && (
          <>
            <h2>Lo que más pesa en la cesta</h2>
            <div className="list">
              {top.map((t) => (
                <div className="li" key={t.productId ?? t.name}><span className="grow ellipsis">{t.name}</span><span className="small muted num">×{t.qty}</span><b className="num">{money(t.total)}</b></div>
              ))}
            </div>
          </>
        )}

        <h2>Compras</h2>
        {monthPurchases.length === 0 ? <p className="muted">No hay compras este mes.</p> : (
          <div className="list">
            {monthPurchases.map((p) => (
              <button className="li" key={p.id} onClick={() => setViewing(p)} data-testid="purchase">
                <div className="grow">
                  <div className="title">{stores.find((s) => s.id === p.store_id)?.name ?? 'Sin tienda'}</div>
                  <div className="small muted">{shortDate(p.purchased_on)} · {p.purchase_lines.length} productos{p.unplanned ? ' · imprevista' : ''}</div>
                </div>
                <b className="num">{money(p.total_paid)}</b>
              </button>
            ))}
          </div>
        )}

        <h2>Indicadores del mes</h2>
        <div className="tiles">
          <div className="tile"><div className="k">Cesta media</div><div className="v">{money(m.avgBasket)}</div></div>
          <div className="tile"><div className="k">Compras imprevistas</div><div className="v">{m.unplanned}</div></div>
          <div className="tile"><div className="k">Duplicados evitados</div><div className="v">{m.duplicatesAvoided}</div></div>
          <div className="tile"><div className="k">Desperdicio estimado</div><div className="v">{money(m.wastedValue)}</div><div className="small muted">{m.wastedCount} registros</div></div>
          <div className="tile"><div className="k">Tiempo en la app</div><div className="v">{m.minutesInApp} min</div></div>
          <div className="tile"><div className="k">Ahorro verificado</div><div className="v">—</div><div className="small muted">Tras el mes de medición</div></div>
        </div>
        {hasData && firstPurchase && daysBetweenSafe(firstPurchase, today) < 30 && (
          <p className="small muted">Línea base: llevamos {daysBetweenSafe(firstPurchase, today) + 1} días de datos. Hasta completar un mes no se calcula ahorro.</p>
        )}
      </div>
      {manual && <PurchaseSheet items={[]} onClose={() => setManual(false)} />}
      {budgetOpen && <BudgetSheet month={month} onClose={() => setBudgetOpen(false)} />}
      {viewing && <PurchaseDetail p={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}

const daysBetweenSafe = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000))

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? spent / budget : spent > 0 ? 2 : 0
  return (
    <div className={`bar ${pct > 1 ? 'over' : pct > 0.85 ? 'near' : ''}`} style={{ marginTop: 8 }} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.min(100, pct * 100)}%` }} />
    </div>
  )
}

function BudgetSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const budgets = useStore((s) => s.budgets)
  const all: (BudgetGroup | 'total')[] = ['total', ...GROUPS.map((g) => g.id)]
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(all.map((g) => [g, budgetFor(budgets, month, g)?.toString().replace('.', ',') ?? ''])))
  const sumGroups = GROUPS.reduce((a, g) => a + (parseNum(vals[g.id]) ?? 0), 0)

  const save = () => {
    for (const g of all) {
      const v = parseNum(vals[g])
      if (v != null && v < 0) return toast('Los importes no pueden ser negativos', 'error')
    }
    for (const g of all) {
      const v = parseNum(vals[g])
      const cur = budgets.find((b) => b.month === month && b.grp === g)
      if (v == null) {
        if (cur) setBudget(month, g, null)
      } else if (!cur || cur.amount !== v) {
        setBudget(month, g, v)
      }
    }
    toast('Presupuesto guardado')
    onClose()
  }

  return (
    <Sheet title={`Presupuesto · ${monthLabel(month)}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">Se aplica a este mes y a los siguientes hasta que lo cambies. Déjalo vacío para seguir midiendo.</p>
        <label className="field"><span>Total del hogar</span><input className="input num" inputMode="decimal" value={vals.total} placeholder={sumGroups ? String(sumGroups) : '€'} onChange={(e) => setVals({ ...vals, total: e.target.value })} /></label>
        <div className="grid2">
          {GROUPS.map((g) => (
            <label className="field" key={g.id}><span>{g.label}</span><input className="input num" inputMode="decimal" value={vals[g.id]} placeholder="€" onChange={(e) => setVals({ ...vals, [g.id]: e.target.value })} /></label>
          ))}
        </div>
        <button className="btn primary block" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}

function PurchaseDetail({ p, onClose }: { p: PurchaseWithLines; onClose: () => void }) {
  const stores = useStore((s) => s.stores)
  const members = useStore((s) => s.members)
  const [editing, setEditing] = useState(false)
  if (editing) return <PurchaseEdit p={p} onClose={() => setEditing(false)} onDone={onClose} />
  return (
    <Sheet title={`${stores.find((s) => s.id === p.store_id)?.name ?? 'Compra'} · ${shortDate(p.purchased_on)}`} onClose={onClose}>
      <div className="stack">
        <div className="card row"><div className="grow"><div className="small muted">Pagado por {memberName(members, p.paid_by)}</div>{p.notes && <div className="small">{p.notes}</div>}</div><div className="big num">{money(p.total_paid)}</div></div>
        {p.purchase_lines.length > 0 && (
          <div className="list">
            {p.purchase_lines.map((l) => (
              <div className="li" key={l.id}><span className="grow">{l.name}</span><span className="small muted num">×{l.qty}</span><b className="num">{money(l.line_total)}</b></div>
            ))}
          </div>
        )}
        <button className="btn block" onClick={() => setEditing(true)}>Editar o separar por tiendas</button>
        <ConfirmButton onConfirm={async () => {
          try {
            await rpcNow('delete_purchase', { p_purchase: p.id })
            await reloadPurchases()
            toast('Compra eliminada y descontada de «En casa»')
            onClose()
          } catch (e) {
            toast('No se pudo eliminar: ' + (e as Error).message, 'error')
          }
        }}>Eliminar compra</ConfirmButton>
      </div>
    </Sheet>
  )
}
