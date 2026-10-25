import { useEffect, useRef, useState } from 'react'
import { reset, setNotifier, start, supabase, useStore } from './lib/store'
import { logSession } from './lib/actions'
import { HomeScreen } from './screens/Home'
import { ListScreen } from './screens/List'
import { PantryScreen } from './screens/Pantry'
import { SpendingScreen } from './screens/Spending'
import { MoreScreen } from './screens/More'
import { Icon, Toasts, toast } from './components/ui'

export type Tab = 'inicio' | 'lista' | 'casa' | 'gastos' | 'mas'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'lista', label: 'Lista', icon: 'list' },
  { id: 'casa', label: 'En casa', icon: 'box' },
  { id: 'gastos', label: 'Gastos', icon: 'euro' },
  { id: 'mas', label: 'Más', icon: 'more' },
]

const tabFromHash = (): Tab => {
  const h = location.hash.replace('#/', '') as Tab
  return TABS.some((t) => t.id === h) ? h : 'inicio'
}

export function App() {
  const [session, setSession] = useState<'loading' | 'out' | 'in'>('loading')
  useEffect(() => {
    setNotifier((m, k) => toast(m, k))
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        start(data.session.user.id)
        setSession('in')
      } else setSession('out')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      if (ev === 'SIGNED_IN' && s) {
        start(s.user.id)
        setSession('in')
      }
      if (ev === 'SIGNED_OUT') {
        reset()
        setSession('out')
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === 'loading') return null
  if (session === 'out') return <><Login /><Toasts /></>
  return <><Main /><Toasts /></>
}

function Main() {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const loaded = useStore((s) => s.loaded)
  const household = useStore((s) => s.household)
  const error = useStore((s) => s.error)
  const pendingCount = useStore((s) => s.items.filter((i) => !i.checked).length)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Tiempo dedicado a la app (métrica de "tiempo organizando la compra").
  const since = useRef(Date.now())
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') logSession((Date.now() - since.current) / 1000)
      else since.current = Date.now()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const go = (t: Tab) => {
    location.hash = `#/${t}`
    setTab(t)
    window.scrollTo(0, 0)
  }
  const signOut = async () => {
    await supabase.auth.signOut()
  }

  if (!household) {
    if (!loaded) return <div className="empty" style={{ paddingTop: 80 }}>Cargando…</div>
    return (
      <div className="login">
        <div className="card stack" style={{ maxWidth: 380 }}>
          <h3 style={{ margin: 0 }}>Sin acceso a un hogar</h3>
          <p className="muted">{error === 'no-household' ? 'Tu cuenta no está en la lista de personas autorizadas. Pide que añadan tu email.' : `No se pudieron cargar los datos. ${error ?? 'Revisa la conexión.'}`}</p>
          <button className="btn block" onClick={signOut}>Cerrar sesión</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {tab === 'inicio' && <HomeScreen go={go} />}
      {tab === 'lista' && <ListScreen />}
      {tab === 'casa' && <PantryScreen />}
      {tab === 'gastos' && <SpendingScreen />}
      {tab === 'mas' && <MoreScreen onSignOut={signOut} />}
      <nav className="nav">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
            <Icon name={t.icon} />
            {t.label}
            {t.id === 'lista' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) toast(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message, 'error')
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname })
      toast(error ? error.message : 'Si el email existe, te llegará un enlace para cambiar la contraseña.', error ? 'error' : 'info')
    }
    setBusy(false)
  }
  return (
    <div className="login">
      <form className="stack" onSubmit={submit}>
        <div style={{ textAlign: 'center' }}>
          <img src="icon.svg" width="64" height="64" alt="" />
          <h1 style={{ margin: '8px 0 0' }}>Compras de casa</h1>
          <p className="muted">Lista, despensa y gasto del mes</p>
        </div>
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode === 'login' && <label className="field"><span>Contraseña</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        <button className="btn primary block" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Enviar enlace'}</button>
        <button type="button" className="btn ghost block" onClick={() => setMode(mode === 'login' ? 'reset' : 'login')}>{mode === 'login' ? 'He olvidado la contraseña' : 'Volver'}</button>
      </form>
    </div>
  )
}
