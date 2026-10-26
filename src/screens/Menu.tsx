import { useEffect, useMemo, useState } from 'react'
import { getState, remove, update, upsert, uid, useStore } from '../lib/store'
import { addToList, getOrCreateProduct } from '../lib/actions'
import { addDaysISO, shortDate, todayISO } from '../lib/format'
import {
  buildCtx, defaultSlots, isWeekend, mondayOf, needLabel, notePlanned, prefsOf, proposeWeek, recipeAllowed, scoreRecipe, weekDays, weekNeeds,
  type Need, type ScoreCtx,
} from '../lib/planner'
import { ingredientLabel, parseIngredient, seedRecipes } from '../lib/recipes'
import { lightPack } from '../lib/lightRecipes'
import { norm, rank } from '../lib/text'
import type { Equipment, Ingredient, MealSlot, PlanEntry, Prefs, Recipe } from '../lib/types'
import { ConfirmButton, Icon, Sheet, toast } from '../components/ui'

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const EQUIP_LABEL: Record<Equipment, string> = { ninguno: 'Sin cocinar', microondas: 'Microondas', fuego: 'Fuego', horno: 'Horno' }

/** Ids fijos por hogar: si los dos abren la app a la vez, el recetario no se duplica. */
const seedId = (hid: string, i: number) => `${hid.slice(0, 24)}${(i + 1).toString(16).padStart(12, '0')}`
// Recetas ligeras: otro tramo de ids fijos (0x101…) para no chocar con el recetario inicial.
const lightId = (hid: string, i: number) => seedId(hid, 0x100 + i)

function useSeedRecipes() {
  const ready = useStore((s) => s.menusReady && s.loaded)
  const hid = useStore((s) => s.household?.id)
  const count = useStore((s) => s.recipes.length)
  useEffect(() => {
    if (!ready || !hid || count > 0) return
    let i = 0
    for (const r of seedRecipes(hid, () => seedId(hid, i++))) upsert('recipes', r)
  }, [ready, hid, count])
}

export function MenuScreen() {
  useSeedRecipes()
  const menusReady = useStore((s) => s.menusReady)
  const plan = useStore((s) => s.plan)
  const recipes = useStore((s) => s.recipes)
  const household = useStore((s) => s.household)
  const products = useStore((s) => s.products)
  const inventory = useStore((s) => s.inventory)
  const members = useStore((s) => s.members)
  const today = todayISO()
  const [monday, setMonday] = useState(() => mondayOf(today))
  const [editing, setEditing] = useState<{ day: string; slot: MealSlot } | null>(null)
  const [needsOpen, setNeedsOpen] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const prefs = prefsOf(household?.prefs)
  const rmap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes])
  const days = weekDays(monday)
  const lunchName = members[0]?.display_name ?? 'Mike'
  const otherName = members[1]?.display_name ?? 'Silvia'

  if (!menusReady) {
    return (
      <>
        <div className="page-head"><h1>Menú</h1></div>
        <div className="page"><div className="card stack">
          <b>Falta un paso en la base de datos</b>
          <p className="small">Para activar el menú hay que ejecutar una vez en Supabase → SQL Editor el archivo <code>supabase/migrations/20261025180000_menus.sql</code>.</p>
        </div></div>
      </>
    )
  }

  const entry = (day: string, slot: MealSlot) => plan.find((p) => p.day === day && p.slot === slot)
  const slotsByDay = new Map<string, MealSlot[]>()
  for (const s of defaultSlots(monday, prefs)) slotsByDay.set(s.day, [...(slotsByDay.get(s.day) ?? []), s.slot])
  for (const p of plan) if (days.includes(p.day) && !slotsByDay.get(p.day)?.includes(p.slot)) slotsByDay.set(p.day, [...(slotsByDay.get(p.day) ?? []), p.slot].sort())

  const propose = () => {
    const ctx = buildCtx(products, inventory, today)
    const proposals = proposeWeek(monday, plan, recipes, prefs, ctx).filter((p) => p.day >= today)
    if (!proposals.length) return toast('No hay huecos libres que rellenar esta semana')
    for (const p of proposals) setEntry(p.day, p.slot, { recipe_id: p.recipe.id, servings: p.servings, status: 'plan' })
    toast(`${proposals.length} comidas propuestas. Toca cualquiera para cambiarla.`)
  }

  const weekEntries = plan.filter((p) => days.includes(p.day))
  const planned = weekEntries.filter((p) => p.recipe_id && p.status === 'plan').length

  return (
    <>
      <div className="page-head">
        <h1>Menú</h1>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setRecipesOpen(true)}>Recetas</button>
          <button className="icon-btn" aria-label="Preferencias" onClick={() => setPrefsOpen(true)}><Icon name="edit" /></button>
        </div>
      </div>
      <div className="page stack">
        <div className="row">
          <button className="icon-btn" aria-label="Semana anterior" onClick={() => setMonday(addDaysISO(monday, -7))}><Icon name="chevL" /></button>
          <div className="grow" style={{ textAlign: 'center', fontWeight: 600 }}>{shortDate(monday)} – {shortDate(addDaysISO(monday, 6))}</div>
          <button className="icon-btn" aria-label="Semana siguiente" onClick={() => setMonday(addDaysISO(monday, 7))}><Icon name="chevR" /></button>
        </div>
        <div className="grid2">
          <button className="btn block" onClick={propose}>Proponer semana</button>
          <button className="btn primary block" disabled={!planned} onClick={() => setNeedsOpen(true)}>Lo que falta</button>
        </div>

        {days.map((day, i) => (
          <section key={day} className={day < today ? 'muted' : ''}>
            <h2 style={{ marginTop: 14 }}>{DAY_NAMES[i]} {shortDate(day)}{day === today ? ' · hoy' : ''}</h2>
            <div className="list">
              {(slotsByDay.get(day) ?? []).map((slot) => {
                const e = entry(day, slot)
                const r = e?.recipe_id ? rmap.get(e.recipe_id) : undefined
                const who = slot === 'comida'
                  ? ((e?.servings ?? prefs.lunchServings) >= 2 ? `${lunchName} y ${otherName}` : lunchName)
                  : `${e?.servings ?? prefs.dinnerServings} raciones`
                return (
                  <button className="li" key={slot} onClick={() => setEditing({ day, slot })} data-testid={`slot-${day}-${slot}`}>
                    <span className="tag" style={{ width: 64, textAlign: 'center' }}>{slot === 'comida' ? 'Comida' : 'Cena'}</span>
                    <div className="grow">
                      <div className="title ellipsis">
                        {e?.status === 'fuera' ? 'Fuera de casa' : e?.status === 'sobras' ? 'Sobras' : r ? r.name : <span className="muted">Elegir…</span>}
                      </div>
                      {e?.status === 'plan' || !e ? <div className="small muted">{who}{r ? ` · ${r.prep_min} min` : ''}</div> : null}
                    </div>
                  </button>
                )
              })}
              {isWeekend(day) && !(slotsByDay.get(day) ?? []).includes('comida') && (
                <button className="li small muted" onClick={() => setEditing({ day, slot: 'comida' })}>+ Añadir comida</button>
              )}
            </div>
          </section>
        ))}
        <p className="small muted">Las comidas son para {lunchName} de lunes a viernes; toca una para añadir a {otherName}. Nada se añade a la lista sin que lo confirméis.</p>
      </div>
      {editing && <SlotSheet day={editing.day} slot={editing.slot} entry={entry(editing.day, editing.slot)} onClose={() => setEditing(null)} />}
      {needsOpen && <NeedsSheet entries={weekEntries.filter((e) => e.day >= today)} onClose={() => setNeedsOpen(false)} />}
      {recipesOpen && <RecipesSheet onClose={() => setRecipesOpen(false)} />}
      {prefsOpen && <PrefsSheet onClose={() => setPrefsOpen(false)} />}
    </>
  )
}

function setEntry(day: string, slot: MealSlot, patch: Partial<PlanEntry>) {
  const s = getState()
  const cur = s.plan.find((p) => p.day === day && p.slot === slot)
  const prefs = prefsOf(s.household?.prefs)
  const row: PlanEntry = {
    id: cur?.id ?? uid(),
    household_id: s.household!.id,
    day,
    slot,
    recipe_id: cur?.recipe_id ?? null,
    servings: cur?.servings ?? (slot === 'comida' && !isWeekend(day) ? prefs.lunchServings : prefs.dinnerServings),
    status: cur?.status ?? 'plan',
    note: cur?.note ?? null,
    ...patch,
    updated_by: s.userId,
  }
  upsert('meal_plan', row)
}

function SlotSheet({ day, slot, entry, onClose }: { day: string; slot: MealSlot; entry?: PlanEntry; onClose: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const plan = useStore((s) => s.plan)
  const products = useStore((s) => s.products)
  const inventory = useStore((s) => s.inventory)
  const household = useStore((s) => s.household)
  const members = useStore((s) => s.members)
  const prefs = prefsOf(household?.prefs)
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const servings = entry?.servings ?? (slot === 'comida' && !isWeekend(day) ? prefs.lunchServings : prefs.dinnerServings)
  const lunchName = members[0]?.display_name ?? 'Mike'
  const otherName = members[1]?.display_name ?? 'Silvia'

  const ranked = useMemo(() => {
    const base = buildCtx(products, inventory, todayISO())
    const days = weekDays(mondayOf(day))
    const ctx: ScoreCtx = { ...base, weekIngredients: new Map(), recipeUses: new Map(), recentByDay: new Map(), preferLight: prefs.preferLight }
    const rmap = new Map(recipes.map((r) => [r.id, r]))
    for (const p of plan) {
      if (!days.includes(p.day) || (p.day === day && p.slot === slot)) continue
      const r = p.recipe_id ? rmap.get(p.recipe_id) : undefined
      if (r) notePlanned(ctx, r, p.day)
    }
    const pool = showAll ? recipes.filter((r) => r.active) : recipes.filter((r) => recipeAllowed(r, prefs, slot))
    return pool
      .map((r) => {
        const ings = r.ingredients.filter((i) => !i.basic).map((i) => norm(i.name))
        const exp = ings.filter((n) => ctx.expiring.has(n)).length
        const have = ings.filter((n) => ctx.stock.has(n)).length
        const reuse = ings.filter((n) => (ctx.weekIngredients.get(n) ?? 0) > 0).length
        const why = [exp && `aprovecha ${exp} que caduca${exp > 1 ? 'n' : ''}`, have && `${have} de ${ings.length} en casa`, reuse && `${reuse} ya en el menú`].filter(Boolean).join(' · ')
        return { r, score: scoreRecipe(r, day, slot, ctx), why }
      })
      .sort((a, b) => b.score - a.score)
  }, [recipes, plan, products, inventory, day, slot, showAll, prefs])

  const list = q.trim() ? rank(ranked.map((x) => ({ ...x, name: x.r.name })), q, 30) : ranked.slice(0, showAll ? 100 : 8)
  const pick = (r: Recipe) => { setEntry(day, slot, { recipe_id: r.id, status: 'plan', servings }); onClose() }

  return (
    <Sheet title={`${slot === 'comida' ? 'Comida' : 'Cena'} · ${shortDate(day)}`} onClose={onClose}>
      <div className="stack">
        <div className="chips" role="group" aria-label="Quién come">
          {slot === 'comida' ? (
            <>
              <button className="chip" aria-pressed={servings < 2 && entry?.status !== 'fuera'} onClick={() => setEntry(day, slot, { servings: 1, status: entry?.status === 'fuera' ? 'plan' : entry?.status ?? 'plan' })}>Solo {lunchName}</button>
              <button className="chip" aria-pressed={servings >= 2 && entry?.status !== 'fuera'} onClick={() => setEntry(day, slot, { servings: 2, status: entry?.status === 'fuera' ? 'plan' : entry?.status ?? 'plan' })}>{lunchName} y {otherName}</button>
            </>
          ) : (
            <button className="chip" aria-pressed={entry?.status !== 'fuera'} onClick={() => setEntry(day, slot, { status: 'plan' })}>Cenamos en casa</button>
          )}
          <button className="chip" aria-pressed={entry?.status === 'fuera'} onClick={() => { setEntry(day, slot, { status: 'fuera', recipe_id: null }); onClose() }}>Fuera de casa</button>
          <button className="chip" aria-pressed={entry?.status === 'sobras'} onClick={() => { setEntry(day, slot, { status: 'sobras', recipe_id: null }); onClose() }}>Sobras</button>
        </div>
        <input className="input" placeholder="Buscar receta" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="list">
          {list.map(({ r, why }) => (
            <button className="li" key={r.id} onClick={() => pick(r)} aria-pressed={entry?.recipe_id === r.id}>
              <div className="grow">
                <div className="title">{r.name}{entry?.recipe_id === r.id ? ' ✓' : ''}</div>
                <div className="small muted">{r.prep_min} min · {EQUIP_LABEL[r.equipment]}{why ? ` · ${why}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
        {!q && <button className="btn ghost block" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ver solo sugerencias' : 'Ver todas las recetas'}</button>}
        {entry && <button className="btn block" onClick={() => { remove('meal_plan', entry.id); onClose() }}>Dejar sin planificar</button>}
      </div>
    </Sheet>
  )
}

function NeedsSheet({ entries, onClose }: { entries: PlanEntry[]; onClose: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const products = useStore((s) => s.products)
  const inventory = useStore((s) => s.inventory)
  const items = useStore((s) => s.items)
  const { needs, basicsOut } = useMemo(() => weekNeeds(entries, recipes, products, inventory, items), [entries, recipes, products, inventory, items])
  const toBuy = needs.filter((n) => n.buyPacks > 0)
  const [sel, setSel] = useState<Set<string>>(() => new Set([...toBuy.map((n) => n.key), ...basicsOut.map((b) => b.id)]))
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const add = () => {
    let n = 0
    for (const need of toBuy) {
      if (!sel.has(need.key)) continue
      const p = need.product ?? getOrCreateProduct(need.name)
      if (!addToList(p, need.buyPacks).duplicate) n++
    }
    for (const b of basicsOut) if (sel.has(b.id) && !addToList(b).duplicate) n++
    toast(`${n} ${n === 1 ? 'producto añadido' : 'productos añadidos'} a la lista`)
    onClose()
  }

  const haveLabel = (n: Need) => (n.inList ? 'ya en la lista' : n.have === null ? 'hay en casa (sin cantidad)' : n.buyPacks === 0 ? 'cubierto con lo de casa' : n.have > 0 ? 'hay algo en casa' : '')

  return (
    <Sheet title="Lo que falta para el menú" onClose={onClose}>
      <div className="stack">
        <p className="small muted">Desde hoy hasta el domingo. Se descuenta lo que tenéis en «En casa» y lo que ya está en la lista.</p>
        {toBuy.length === 0 && basicsOut.length === 0 ? <div className="empty">No falta nada. 🎉</div> : (
          <div className="list">
            {toBuy.map((n) => (
              <label className="li" key={n.key}>
                <span className={`check ${sel.has(n.key) ? 'on' : ''}`}>{sel.has(n.key) && <Icon name="check" />}</span>
                <input type="checkbox" hidden checked={sel.has(n.key)} onChange={() => toggle(n.key)} />
                <div className="grow">
                  <div className="title">{n.name} <span className="muted small">× {n.buyPacks}</span></div>
                  <div className="small muted ellipsis">{needLabel(n)} para {n.uses.join(', ')}{haveLabel(n) ? ` · ${haveLabel(n)}` : ''}</div>
                </div>
              </label>
            ))}
            {basicsOut.map((b) => (
              <label className="li" key={b.id}>
                <span className={`check ${sel.has(b.id) ? 'on' : ''}`}>{sel.has(b.id) && <Icon name="check" />}</span>
                <input type="checkbox" hidden checked={sel.has(b.id)} onChange={() => toggle(b.id)} />
                <div className="grow"><div className="title">{b.name}</div><div className="small muted">Básico agotado</div></div>
              </label>
            ))}
          </div>
        )}
        {toBuy.length > 0 && <button className="btn primary block" disabled={!sel.size} onClick={add}>Añadir {sel.size} a la lista</button>}
        {needs.some((n) => n.buyPacks === 0) && (
          <>
            <h2>Ya cubierto</h2>
            <p className="small muted">{needs.filter((n) => n.buyPacks === 0).map((n) => `${n.name} (${haveLabel(n)})`).join(' · ')}</p>
          </>
        )}
        <p className="small muted">Aceite, sal y especias no se añaden salvo que los marquéis como agotados en «En casa».</p>
      </div>
    </Sheet>
  )
}

function RecipesSheet({ onClose }: { onClose: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null)
  const [q, setQ] = useState('')
  const household = useStore((s) => s.household)
  const pack = useMemo(() => (household ? lightPack(recipes, household.id, (i) => lightId(household.id, i)) : null), [recipes, household])
  if (editing) return <RecipeEdit recipe={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
  const applyPack = () => {
    if (!pack || !household) return
    for (const r of pack.add) upsert('recipes', r)
    for (const a of pack.adjust) update('recipes', a.id, a.patch)
    update('households', household.id, { prefs: { ...(household.prefs ?? {}), preferLight: true } })
    toast(`${pack.add.length} recetas nuevas y ${pack.adjust.length} ajustadas${pack.skipped.length ? `. No he tocado ${pack.skipped.length} que habíais editado` : ''}`)
  }
  const list = q.trim() ? rank(recipes, q, 100) : recipes.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return (
    <Sheet title="Recetas" onClose={onClose}>
      <div className="stack">
        {pack && (pack.add.length > 0 || pack.adjust.length > 0) && (
          <div className="card stack" data-testid="light-pack">
            <div><b>Recetas ligeras</b></div>
            <p className="small muted" style={{ margin: 0 }}>
              {pack.add.length} nuevas (cremas para la comida, cenas ligeras y tuppers) y {pack.adjust.length} ajustes a las de partida.
              Las que hayáis editado no se tocan. El planificador les dará prioridad.
            </p>
            <button className="btn primary" onClick={applyPack}>Añadir recetas ligeras</button>
          </div>
        )}
        <div className="row">
          <input className="input" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => setEditing('new')}><Icon name="plus" /> Nueva</button>
        </div>
        <div className="list">
          {list.map((r) => (
            <button className="li" key={r.id} onClick={() => setEditing(r)}>
              <div className="grow">
                <div className={`title ${r.active ? '' : 'muted'}`}>{r.name}{r.active ? '' : ' (oculta)'}</div>
                <div className="small muted">{r.slot === 'ambas' ? 'Comida o cena' : r.slot === 'comida' ? 'Comida' : 'Cena'} · {r.prep_min} min · {EQUIP_LABEL[r.equipment]}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

function RecipeEdit({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const [name, setName] = useState(recipe?.name ?? '')
  const [slot, setSlot] = useState<Recipe['slot']>(recipe?.slot ?? 'ambas')
  const [prep, setPrep] = useState(String(recipe?.prep_min ?? 15))
  const [equipment, setEquipment] = useState<Equipment>(recipe?.equipment ?? 'ninguno')
  const [ings, setIngs] = useState((recipe?.ingredients ?? []).map(ingredientLabel).join('\n'))
  const [steps, setSteps] = useState(recipe?.steps ?? '')
  const [tags, setTags] = useState((recipe?.tags ?? []).join(', '))

  const save = () => {
    if (!name.trim()) return toast('Pon un nombre', 'error')
    const ingredients = ings.split('\n').map(parseIngredient).filter((x): x is Ingredient => !!x)
    if (!ingredients.length) return toast('Añade al menos un ingrediente', 'error')
    const row: Recipe = {
      id: recipe?.id ?? uid(),
      household_id: getState().household!.id,
      name: name.trim(),
      slot,
      prep_min: Math.max(0, Math.min(240, Number(prep) || 0)),
      equipment,
      tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      ingredients,
      steps: steps.trim() || null,
      active: recipe?.active ?? true,
    }
    upsert('recipes', row)
    toast('Receta guardada')
    onClose()
  }

  return (
    <Sheet title={recipe ? 'Editar receta' : 'Nueva receta'} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Nombre</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid2">
          <label className="field"><span>Para</span>
            <select className="input" value={slot} onChange={(e) => setSlot(e.target.value as Recipe['slot'])}>
              <option value="ambas">Comida o cena</option><option value="comida">Comida</option><option value="cena">Cena</option>
            </select>
          </label>
          <label className="field"><span>Minutos</span><input className="input" inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} /></label>
        </div>
        <label className="field"><span>Necesita</span>
          <select className="input" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
            {(Object.keys(EQUIP_LABEL) as Equipment[]).map((k) => <option key={k} value={k}>{EQUIP_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field"><span>Ingredientes por ración, uno por línea (ej. «150 g Pechuga de pollo», «2 ud Huevos», «* Aceite» para básicos)</span>
          <textarea className="input" rows={7} value={ings} onChange={(e) => setIngs(e.target.value)} />
        </label>
        <label className="field"><span>Etiquetas (ensalada, tupper, rapido…)</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <label className="field"><span>Preparación</span><textarea className="input" rows={3} maxLength={2000} value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
        <button className="btn primary block" onClick={save}>Guardar</button>
        {recipe && (
          <button className="btn block" onClick={() => { update('recipes', recipe.id, { active: !recipe.active }); onClose() }}>
            {recipe.active ? 'Ocultar (no proponerla)' : 'Volver a proponerla'}
          </button>
        )}
        {recipe && <ConfirmButton onConfirm={() => { remove('recipes', recipe.id); onClose() }}>Borrar receta</ConfirmButton>}
      </div>
    </Sheet>
  )
}

function PrefsSheet({ onClose }: { onClose: () => void }) {
  const household = useStore((s) => s.household)
  const members = useStore((s) => s.members)
  const p = prefsOf(household?.prefs)
  const [excluded, setExcluded] = useState(p.excluded.join(', '))
  const [maxPrep, setMaxPrep] = useState(String(p.maxPrep))
  const [equipment, setEquipment] = useState<Equipment[]>(p.equipment)
  const [weekendLunch, setWeekendLunch] = useState(p.weekendLunch)
  const [lunchTwo, setLunchTwo] = useState(p.lunchServings >= 2)
  const [preferLight, setPreferLight] = useState(p.preferLight)
  const lunchName = members[0]?.display_name ?? 'Mike'
  const otherName = members[1]?.display_name ?? 'Silvia'

  const save = () => {
    const prefs: Prefs = {
      ...(household?.prefs ?? {}),
      preferLight,
      excluded: excluded.split(',').map((x) => x.trim()).filter(Boolean),
      maxPrep: Math.max(5, Math.min(240, Number(maxPrep) || 30)),
      equipment,
      weekendLunch,
      lunchServings: lunchTwo ? 2 : 1,
      dinnerServings: 2,
    }
    update('households', household!.id, { prefs })
    toast('Preferencias guardadas')
    onClose()
  }
  const toggleEq = (e: Equipment) => setEquipment((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))

  return (
    <Sheet title="Preferencias del menú" onClose={onClose}>
      <div className="stack">
        <label className="field"><span>No queremos (separado por comas: alergias, cosas que no os gustan)</span><input className="input" value={excluded} placeholder="Ej. setas, marisco" onChange={(e) => setExcluded(e.target.value)} /></label>
        <label className="field"><span>Tiempo máximo de preparación (min)</span><input className="input" inputMode="numeric" value={maxPrep} onChange={(e) => setMaxPrep(e.target.value)} /></label>
        <div className="field"><span>Qué podemos usar</span>
          <div className="chips">
            {(['microondas', 'fuego', 'horno'] as Equipment[]).map((e) => (
              <button key={e} className="chip" aria-pressed={equipment.includes(e)} onClick={() => toggleEq(e)}>{EQUIP_LABEL[e]}</button>
            ))}
          </div>
        </div>
        <label className="toggle"><span>Comida entre semana también para {otherName} por defecto</span><input type="checkbox" checked={lunchTwo} onChange={(e) => setLunchTwo(e.target.checked)} /></label>
        <label className="toggle"><span>Dar prioridad a las recetas ligeras</span><input type="checkbox" checked={preferLight} onChange={(e) => setPreferLight(e.target.checked)} /></label>
        <label className="toggle"><span>Planificar también la comida del fin de semana</span><input type="checkbox" checked={weekendLunch} onChange={(e) => setWeekendLunch(e.target.checked)} /></label>
        <p className="small muted">Ahora: comida para {lunchName} de lunes a viernes y cena para dos. Se puede cambiar cada día desde el menú.</p>
        <button className="btn primary block" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}
