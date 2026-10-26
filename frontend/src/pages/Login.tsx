import { useState, type FormEvent } from 'react'
import { Button, imeGuard, inputClass } from '../components/ui'
import { AuthError, NetworkError, login } from '../lib/api'

export function LoginForm({ onSuccess, compact = false }: { onSuccess: () => void; compact?: boolean }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await login(password)
      setPassword('')
      onSuccess()
    } catch (err) {
      setError(
        err instanceof AuthError
          ? 'Incorrect password.'
          : err instanceof NetworkError
            ? "Can't reach the server. Check your connection."
            : err instanceof Error
              ? err.message
              : 'Login failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} onKeyDownCapture={imeGuard} className={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-3'}>
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        className={inputClass}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus={!compact}
      />
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  return (
    <div className="pt-safe pb-safe px-safe flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="hangul mb-2 text-5xl font-bold text-indigo-600 dark:text-indigo-400">한국어</div>
          <h1 className="text-xl font-semibold">Korean Flashcards</h1>
        </div>
        <LoginForm onSuccess={onSuccess} />
      </div>
    </div>
  )
}
