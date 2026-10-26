import { useEffect, type ReactNode } from 'react'
import { useAuth } from './lib/api'
import { match, navigate, useRoute } from './lib/router'
import { seedIfEmpty } from './lib/seed'
import { schedulePush, startSync, syncNow, useSyncState } from './lib/sync'
import CardEdit from './pages/CardEdit'
import DeckSettings from './pages/DeckSettings'
import DeckView from './pages/DeckView'
import Home from './pages/Home'
import Import from './pages/Import'
import Login, { LoginForm } from './pages/Login'
import Settings from './pages/Settings'
import Stats from './pages/Stats'
import Study from './pages/Study'

function route(path: string): ReactNode {
  let p: Record<string, string> | null
  if ((p = match('/deck/:id/study', path))) return <Study key={p.id} deckId={p.id} />
  if ((p = match('/deck/:id/new', path))) return <CardEdit key={`new-${p.id}`} deckId={p.id} />
  if ((p = match('/deck/:id/import', path))) return <Import deckId={p.id} />
  if ((p = match('/deck/:id/stats', path))) return <Stats deckId={p.id} />
  if ((p = match('/deck/:id/settings', path))) return <DeckSettings key={p.id} deckId={p.id} />
  if ((p = match('/deck/:id', path))) return <DeckView deckId={p.id} />
  if ((p = match('/card/:id', path))) return <CardEdit key={p.id} cardId={p.id} />
  if (match('/settings', path)) return <Settings />
  return <Home />
}

/** Shown when the token expired or was rejected: studying keeps working, sync waits for the password. */
function ReauthBanner() {
  return (
    <div className="pt-safe px-safe border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
      <div className="mx-auto max-w-2xl px-4 py-3">
        <p className="mb-2 text-sm text-amber-900 dark:text-amber-200">
          Your session expired. Your progress is saved on this device — sign in to sync it.
        </p>
        <LoginForm compact onSuccess={() => void syncNow()} />
      </div>
    </div>
  )
}

export default function App() {
  const auth = useAuth()
  const sync = useSyncState()
  const path = useRoute()
  const loggedIn = !!auth.token

  useEffect(() => {
    if (loggedIn) return startSync()
  }, [loggedIn])

  if (!loggedIn) {
    return (
      <Login
        onSuccess={async () => {
          navigate('/', { replace: true })
          // Pull existing data first; only seed the sample deck on a brand-new account.
          await syncNow()
          if (await seedIfEmpty()) schedulePush(0)
        }}
      />
    )
  }

  const studying = !!match('/deck/:id/study', path)
  return (
    <>
      {sync.status === 'auth' && !studying && <ReauthBanner />}
      {route(path)}
    </>
  )
}
