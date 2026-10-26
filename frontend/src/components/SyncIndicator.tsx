import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { syncNow, useSyncState, type SyncStatus } from '../lib/sync'

const look: Record<SyncStatus, { dot: string; label: string }> = {
  idle: { dot: 'bg-slate-400', label: 'Not synced' },
  syncing: { dot: 'bg-indigo-500 animate-pulse', label: 'Syncing' },
  synced: { dot: 'bg-emerald-500', label: 'Synced' },
  offline: { dot: 'bg-slate-400', label: 'Offline' },
  error: { dot: 'bg-rose-500', label: 'Sync error' },
  auth: { dot: 'bg-amber-500', label: 'Sign in to sync' },
}

export function SyncIndicator() {
  const { status, error } = useSyncState()
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const { dot, label } = look[status]
  const showPending = pending > 0 && status !== 'syncing'
  return (
    <button
      onClick={() => void syncNow()}
      title={error ?? `${label}${pending ? ` · ${pending} change(s) waiting` : ''} — tap to sync`}
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
      aria-label={`Sync status: ${label}`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="hidden sm:inline">{label}</span>
      {showPending && <span className="tabular-nums text-slate-400">{pending}</span>}
    </button>
  )
}
