import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import type {
  AppEvent, Budget, Category, Household, InventoryRow, Member, Product, Purchase, PurchaseLine, ShoppingItem, Store,
} from './types'
import { addMonths, monthKey, todayISO } from './format'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })

export type PurchaseWithLines = Purchase & { purchase_lines: PurchaseLine[] }

export interface Data {
  household: Household | null
  members: Member[]
  categories: Category[]
  stores: Store[]
  products: Product[]
  items: ShoppingItem[] // solo la lista activa
  inventory: InventoryRow[]
  budgets: Budget[]
  purchases: PurchaseWithLines[]
  events: AppEvent[]
}

export interface State extends Data {
  userId: string | null
  loaded: boolean
  online: boolean
  pending: number
  lastSync: string | null
  error: string | null
}

type TableName = 'products' | 'categories' | 'stores' | 'shopping_items' | 'inventory' | 'budgets' | 'events' | 'members' | 'households'

type Op =
  | { opId: string; kind: 'upsert'; table: TableName; row: Record<string, unknown> }
  | { opId: string; kind: 'update'; table: TableName; id: string; patch: Record<string, unknown> }
  | { opId: string; kind: 'delete'; table: TableName; id: string }
  | { opId: string; kind: 'rpc'; fn: string; args: Record<string, unknown> }

const CACHE_KEY = 'cc-cache-v1'
const QUEUE_KEY = 'cc-queue-v1'

const empty: Data = {
  household: null, members: [], categories: [], stores: [], products: [], items: [], inventory: [], budgets: [], purchases: [], events: [],
}

function safeGet<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function safeSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* almacenamiento lleno o bloqueado: seguimos sin caché */
  }
}

let queue: Op[] = safeGet<Op[]>(QUEUE_KEY, [])
let state: State = {
  ...empty,
  ...safeGet<Partial<Data>>(CACHE_KEY, {}),
  userId: null,
  loaded: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: queue.length,
  lastSync: null,
  error: null,
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}
function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  emit()
}
let cacheTimer: number | undefined
function persistCache() {
  window.clearTimeout(cacheTimer)
  cacheTimer = window.setTimeout(() => {
    const { household, members, categories, stores, products, items, inventory, budgets, purchases, events } = state
    safeSet(CACHE_KEY, { household, members, categories, stores, products, items, inventory, budgets, purchases, events })
  }, 300)
}

export function getState() {
  return state
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => sel(state),
  )
}

// ---------------------------------------------------------------------------
// Aplicar cambios al estado local (optimista y desde tiempo real)
// ---------------------------------------------------------------------------

const keyOf = (table: TableName, row: Record<string, unknown>) =>
  table === 'budgets' ? `${row.month}|${row.grp}` : table === 'members' ? String(row.user_id) : String(row.id)

const stateKey: Partial<Record<TableName, keyof Data>> = {
  products: 'products', categories: 'categories', stores: 'stores', shopping_items: 'items', inventory: 'inventory',
  budgets: 'budgets', events: 'events', members: 'members',
}

function upsertLocal(table: TableName, row: Record<string, unknown>) {
  if (table === 'households') {
    set({ household: { ...(state.household as Household), ...(row as unknown as Household) } })
    return
  }
  const k = stateKey[table]
  if (!k) return
  const list = state[k] as unknown as Record<string, unknown>[]
  const rk = keyOf(table, row)
  const idx = list.findIndex((r) => keyOf(table, r) === rk)
  let next: Record<string, unknown>[]
  if ((table === 'shopping_items' && row.purchase_id) || (table === 'products' && row.archived)) {
    // Comprado o archivado: sale de la lista activa o del catálogo.
    next = list.filter((r) => keyOf(table, r) !== rk)
  } else if (idx >= 0) {
    next = list.slice()
    next[idx] = { ...list[idx], ...row }
  } else {
    next = [...list, row]
  }
  set({ [k]: next } as Partial<State>)
  persistCache()
}

function removeLocal(table: TableName, rowKey: string) {
  const k = stateKey[table]
  if (!k) return
  const list = state[k] as unknown as Record<string, unknown>[]
  set({ [k]: list.filter((r) => keyOf(table, r) !== rowKey) } as Partial<State>)
  persistCache()
}

// ---------------------------------------------------------------------------
// Cola de escritura: funciona sin conexión y reintenta al volver
// ---------------------------------------------------------------------------

type Notify = (msg: string, kind?: 'error' | 'info') => void
let notify: Notify = () => {}
export function setNotifier(n: Notify) {
  notify = n
}

function saveQueue() {
  safeSet(QUEUE_KEY, queue)
  set({ pending: queue.length })
}

function enqueue(op: Op) {
  queue.push(op)
  saveQueue()
  void flush()
}

export const uid = () => crypto.randomUUID()

export function upsert<T extends object>(table: TableName, row: T) {
  upsertLocal(table, row as Record<string, unknown>)
  enqueue({ opId: uid(), kind: 'upsert', table, row: row as Record<string, unknown> })
}
export function update(table: TableName, id: string, patch: Record<string, unknown>) {
  upsertLocal(table, { ...(table === 'members' ? { user_id: id } : { id }), ...patch })
  enqueue({ opId: uid(), kind: 'update', table, id, patch })
}
export function remove(table: TableName, id: string) {
  removeLocal(table, id)
  enqueue({ opId: uid(), kind: 'delete', table, id })
}

/** Llamada RPC que exige conexión (no se encola). */
export async function rpcNow<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

const isNetworkError = (e: { message?: string; code?: string } | null) =>
  !!e && !e.code && /fetch|network|load failed|timed out/i.test(e.message || '')

let flushing: Promise<void> | null = null
/** Envía la cola. Si ya se está enviando, espera a que termine. */
export function flush(): Promise<void> {
  if (flushing) return flushing
  flushing = doFlush().finally(() => {
    flushing = null
    // Algo pudo encolarse justo cuando terminaba el bucle.
    if (queue.length && state.online) void flush()
  })
  return flushing
}

async function doFlush() {
  if (!state.household) return
  if (!navigator.onLine) {
    set({ online: false })
    return
  }
  while (queue.length) {
    const op = queue[0]
    const error = await runOp(op)
    if (error && isNetworkError(error)) {
      set({ online: false })
      return
    }
    queue.shift()
    saveQueue()
    if (error) handleOpError(op, error)
  }
  set({ online: true })
}

async function runOp(op: Op): Promise<{ message: string; code?: string } | null> {
  try {
    if (op.kind === 'rpc') return (await supabase.rpc(op.fn, op.args)).error
    if (op.kind === 'upsert') {
      const onConflict = op.table === 'budgets' ? 'household_id,month,grp' : op.table === 'members' ? 'household_id,user_id' : 'id'
      return (await supabase.from(op.table).upsert(op.row, { onConflict })).error
    }
    if (op.kind === 'update') {
      const col = op.table === 'members' ? 'user_id' : 'id'
      return (await supabase.from(op.table).update(op.patch).eq(col, op.id)).error
    }
    if (op.table === 'budgets') {
      const [month, grp] = op.id.split('|')
      return (await supabase.from('budgets').delete().eq('household_id', state.household!.id).eq('month', month).eq('grp', grp)).error
    }
    return (await supabase.from(op.table).delete().eq('id', op.id)).error
  } catch (e) {
    return { message: String(e) }
  }
}

function handleOpError(op: Op, error: { message: string; code?: string }) {
  console.warn('op rechazada', op, error)
  if (error.code === '23505' && op.kind === 'upsert' && op.table === 'shopping_items') {
    notify('Ese producto ya estaba en la lista: lo ha añadido la otra persona.', 'info')
  } else if (error.code === '23505' && op.kind === 'upsert' && op.table === 'products') {
    notify('Ya existe un producto con ese nombre.', 'info')
  } else if (error.code === '23503') {
    notify('No se pudo guardar: el producto ya no existe.', 'error')
  } else {
    notify('No se pudo guardar un cambio: ' + error.message, 'error')
  }
  // El servidor manda: recargamos para deshacer el cambio optimista.
  void refresh()
}

// ---------------------------------------------------------------------------
// Carga y tiempo real
// ---------------------------------------------------------------------------

export async function refresh() {
  const userId = state.userId
  if (!userId) return
  const { data: mem, error: memErr } = await supabase.from('members').select('*').eq('user_id', userId).limit(1)
  if (memErr) {
    if (isNetworkError(memErr)) set({ online: false, loaded: true })
    else set({ error: memErr.message, loaded: true })
    return
  }
  if (!mem?.length) {
    set({ ...empty, loaded: true, error: 'no-household' })
    return
  }
  const hid = mem[0].household_id as string
  const since = addMonths(monthKey(todayISO()), -12)
  const [hh, members, categories, stores, products, items, inventory, budgets, purchases, events] = await Promise.all([
    supabase.from('households').select('*').eq('id', hid).single(),
    supabase.from('members').select('*').eq('household_id', hid),
    supabase.from('categories').select('*').eq('household_id', hid).order('sort'),
    supabase.from('stores').select('*').eq('household_id', hid).order('sort'),
    supabase.from('products').select('*').eq('household_id', hid).eq('archived', false).order('name'),
    supabase.from('shopping_items').select('*').eq('household_id', hid).is('purchase_id', null).order('added_at'),
    supabase.from('inventory').select('*').eq('household_id', hid),
    supabase.from('budgets').select('*').eq('household_id', hid),
    supabase.from('purchases').select('*, purchase_lines(*)').eq('household_id', hid).gte('purchased_on', since).order('purchased_on', { ascending: false }),
    supabase.from('events').select('*').eq('household_id', hid).gte('created_at', since).neq('kind', 'purchase_closed'),
  ])
  const firstErr = [hh, members, categories, stores, products, items, inventory, budgets, purchases, events].find((r) => r.error)?.error
  if (firstErr) {
    set({ online: !isNetworkError(firstErr), loaded: true })
    return
  }
  const fresh: Data = {
    household: hh.data as Household,
    members: members.data as Member[],
    categories: categories.data as Category[],
    stores: stores.data as Store[],
    products: (products.data as Product[]).map(numify),
    items: (items.data as ShoppingItem[]).map(numify),
    inventory: (inventory.data as InventoryRow[]).map(numify),
    budgets: (budgets.data as Budget[]).map(numify),
    purchases: (purchases.data as PurchaseWithLines[]).map((p) => ({ ...numify(p), purchase_lines: p.purchase_lines.map(numify) })),
    events: events.data as AppEvent[],
  }
  // Reaplicamos lo que aún está pendiente de enviar para no "parpadear".
  const hadHousehold = state.household?.id === hid
  set({ ...fresh, loaded: true, error: null, online: true, lastSync: new Date().toISOString() })
  if (hadHousehold) {
    for (const op of queue) {
      if (op.kind === 'upsert') upsertLocal(op.table, op.row)
      else if (op.kind === 'update') upsertLocal(op.table, { ...(op.table === 'members' ? { user_id: op.id } : { id: op.id }), ...op.patch })
      else if (op.kind === 'delete') removeLocal(op.table, op.id)
    }
  } else {
    // Otro hogar u otro usuario: la cola anterior no aplica.
    queue = []
    saveQueue()
  }
  persistCache()
  subscribe(hid)
  void flush()
}

// Postgres devuelve numeric como texto: lo convertimos a número.
const NUMERIC = new Set(['qty', 'est_price', 'pack_size', 'min_qty', 'last_price', 'total_paid', 'line_total', 'discount', 'amount', 'price', 'unit_price'])
function numify<T>(row: T): T {
  const r = { ...(row as Record<string, unknown>) }
  for (const k of Object.keys(r)) if (NUMERIC.has(k) && typeof r[k] === 'string') r[k] = Number(r[k])
  return r as T
}

let channel: RealtimeChannel | null = null
let channelHid: string | null = null
function subscribe(hid: string) {
  if (channel && channelHid === hid) return
  if (channel) void supabase.removeChannel(channel)
  channelHid = hid
  const ch = supabase.channel(`hh-${hid}`)
  const tables: TableName[] = ['shopping_items', 'inventory', 'products', 'stores', 'categories', 'budgets', 'members']
  for (const t of tables) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `household_id=eq.${hid}` }, (p) => {
      if (p.eventType === 'DELETE') {
        const old = p.old as Record<string, unknown>
        if (t === 'budgets' || old.id) removeLocal(t, keyOf(t, old))
      } else {
        const row = numify(p.new as Record<string, unknown>)
        upsertLocal(t, row)
      }
    })
  }
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'purchases', filter: `household_id=eq.${hid}` }, () => {
    void reloadPurchases()
  })
  // El canal tarda unos segundos en empezar a emitir cambios de la base de datos
  // después de conectar: cuando avisa de que está listo, recargamos para no perder nada.
  ch.on('system', {}, (p: { extension?: string; status?: string }) => {
    if (p.extension === 'postgres_changes' && p.status === 'ok') void refresh()
  })
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') set({ online: true })
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') set({ online: navigator.onLine })
  })
  channel = ch
}

let reloadTimer: number | undefined
let reloadWaiters: (() => void)[] = []
/** Recarga compras y líneas. Varias llamadas seguidas se agrupan en una sola petición. */
export function reloadPurchases(): Promise<void> {
  window.clearTimeout(reloadTimer)
  const done = new Promise<void>((resolve) => reloadWaiters.push(resolve))
  reloadTimer = window.setTimeout(async () => {
    const waiters = reloadWaiters
    reloadWaiters = []
    const hid = state.household?.id
    if (hid) {
      const since = addMonths(monthKey(todayISO()), -12)
      const { data, error } = await supabase.from('purchases').select('*, purchase_lines(*)').eq('household_id', hid)
        .gte('purchased_on', since).order('purchased_on', { ascending: false })
      if (!error && data) {
        set({ purchases: (data as PurchaseWithLines[]).map((p) => ({ ...numify(p), purchase_lines: p.purchase_lines.map(numify) })) })
        persistCache()
      }
    }
    for (const w of waiters) w()
  }, 250)
  return done
}

export function start(userId: string) {
  set({ userId })
  void refresh()
}

export function reset() {
  if (channel) void supabase.removeChannel(channel)
  channel = null
  channelHid = null
  queue = []
  saveQueue()
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* nada */
  }
  state = { ...state, ...empty, userId: null, loaded: false, pending: 0, error: null }
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    set({ online: true })
    void refresh()
  })
  window.addEventListener('offline', () => set({ online: false }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.userId) void refresh()
  })
  // Reintento periódico por si el evento "online" no llega (pasa en móviles).
  window.setInterval(() => {
    if (queue.length) void flush()
  }, 15000)
}

// Acceso para pruebas automáticas en local.
if (typeof window !== 'undefined' && location.hostname === 'localhost') {
  ;(window as unknown as { __cc: unknown }).__cc = { getState, flush }
}
