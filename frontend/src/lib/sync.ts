/**
 * Offline-first sync.
 *
 *  - Local writes go to IndexedDB and an outbox (see repo.ts).
 *  - push: send outbox records to POST /sync/push in batches; clear entries that
 *    weren't edited again while the request was in flight.
 *  - pull: GET /sync/pull?since=<cursor> and merge with last-write-wins on updated_at.
 *    The cursor is the server's clock, so device clock skew can't hide changes.
 *  - Reviews are an append-only log: merged by id, never overwritten.
 */
import { useSyncExternalStore } from 'react'
import { AuthError, NetworkError, apiGet, apiPost, canSync, getAuth } from './api'
import { db, getMeta, setMeta, type OutboxEntry } from './db'
import { onLocalChange } from './repo'
import type { Card, CardStateRecord, Deck, ReviewRecord, SyncTable } from './types'

export interface SyncPayload {
  decks: Deck[]
  cards: Card[]
  card_states: CardStateRecord[]
  reviews: ReviewRecord[]
}

export interface PullResponse extends SyncPayload {
  server_time: number
}

const LWW_TABLES = ['decks', 'cards', 'card_states'] as const
const PUSH_BATCH = 500
export const PULL_CURSOR_KEY = 'pullCursor'

function emptyPayload(): SyncPayload {
  return { decks: [], cards: [], card_states: [], reviews: [] }
}

// ---------------------------------------------------------------------------
// Merge (shared by pull and JSON backup import)
// ---------------------------------------------------------------------------

/** Last-write-wins: take the incoming record only if it is strictly newer. */
export function incomingWins(local: { updated_at: number } | undefined, incoming: { updated_at: number }): boolean {
  return !local || incoming.updated_at > local.updated_at
}

/**
 * Merge records into the local database.
 * markDirty=false (pull): records came from the server; a winning remote record
 *   supersedes any pending local edit of the same record, so drop its outbox entry.
 * markDirty=true (backup import): queue winners for upload.
 * Returns the number of records written.
 */
export async function mergeRecords(data: Partial<SyncPayload>, { markDirty = false } = {}): Promise<number> {
  let written = 0
  await db.transaction('rw', [db.decks, db.cards, db.card_states, db.reviews, db.outbox], async () => {
    for (const table of LWW_TABLES) {
      const incoming = (data[table] ?? []) as (Deck | Card | CardStateRecord)[]
      if (!incoming.length) continue
      const t = db.table(table)
      const locals = (await t.bulkGet(incoming.map((r) => r.id))) as ({ updated_at: number } | undefined)[]
      const winners = incoming.filter((r, i) => incomingWins(locals[i], r))
      if (!winners.length) continue
      await t.bulkPut(winners)
      const keys = winners.map((r) => `${table}:${r.id}`)
      if (markDirty) {
        await db.outbox.bulkPut(winners.map((r) => ({ key: `${table}:${r.id}`, table, id: r.id })))
      } else {
        await db.outbox.bulkDelete(keys)
      }
      written += winners.length
    }

    const reviews = data.reviews ?? []
    if (reviews.length) {
      const existing = await db.reviews.bulkGet(reviews.map((r) => r.id))
      const fresh = reviews.filter((_, i) => !existing[i])
      if (fresh.length) {
        await db.reviews.bulkAdd(fresh)
        if (markDirty) {
          await db.outbox.bulkPut(fresh.map((r) => ({ key: `reviews:${r.id}`, table: 'reviews' as const, id: r.id })))
        }
        written += fresh.length
      }
    }
  })
  return written
}

// ---------------------------------------------------------------------------
// Push / pull
// ---------------------------------------------------------------------------

/** Push all queued local changes. Returns the number of records sent. */
export async function pushChanges(): Promise<number> {
  let total = 0
  for (let round = 0; round < 1000; round++) {
    const entries = await db.outbox.limit(PUSH_BATCH).toArray()
    if (!entries.length) break

    const payload = emptyPayload()
    const sentVersion = new Map<string, number | null>()
    const missing: string[] = []
    const byTable = new Map<SyncTable, OutboxEntry[]>()
    for (const e of entries) byTable.set(e.table, [...(byTable.get(e.table) ?? []), e])
    for (const [table, list] of byTable) {
      const records = await db.table(table).bulkGet(list.map((e) => e.id))
      list.forEach((e, i) => {
        const rec = records[i]
        if (!rec) return missing.push(e.key)
        ;(payload[table] as unknown[]).push(rec)
        sentVersion.set(e.key, 'updated_at' in rec ? rec.updated_at : null)
      })
    }

    if (sentVersion.size) await apiPost<{ accepted: number }>('/sync/push', payload)

    // Remove what was sent, unless the record changed again in the meantime.
    let cleared = missing.length
    await db.transaction('rw', [db.outbox, db.decks, db.cards, db.card_states], async () => {
      await db.outbox.bulkDelete(missing)
      for (const [key, version] of sentVersion) {
        const entry = entries.find((e) => e.key === key)!
        if (version !== null) {
          const current = await db.table(entry.table).get(entry.id)
          if (current && current.updated_at !== version) continue
        }
        await db.outbox.delete(key)
        cleared++
      }
    })
    total += sentVersion.size
    if (cleared === 0) break // everything was re-edited mid-push; try again next sync
  }
  return total
}

/** Pull changes since the last cursor and merge them. Returns records written. */
export async function pullChanges(): Promise<number> {
  const since = (await getMeta<number>(PULL_CURSOR_KEY)) ?? 0
  const res = await apiGet<PullResponse>(`/sync/pull?since=${since}`)
  const written = await mergeRecords(res)
  await setMeta(PULL_CURSOR_KEY, res.server_time)
  return written
}

// ---------------------------------------------------------------------------
// Engine + status store
// ---------------------------------------------------------------------------

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth'

interface SyncState {
  status: SyncStatus
  lastSyncedAt: number | null
  error: string | null
}

let state: SyncState = { status: 'idle', lastSyncedAt: null, error: null }
const listeners = new Set<() => void>()

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

let running: Promise<void> | null = null
let again = false

/** Push then pull. Safe to call any time; concurrent calls coalesce. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    if (!getAuth().token) return
    if (!canSync()) return setState({ status: 'auth' })
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setState({ status: 'offline' })
    setState({ status: 'syncing', error: null })
    try {
      await pushChanges()
      await pullChanges()
      setState({ status: 'synced', lastSyncedAt: Date.now() })
    } catch (e) {
      if (e instanceof AuthError) setState({ status: 'auth' })
      else if (e instanceof NetworkError) setState({ status: 'offline' })
      else setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  })().finally(() => {
    running = null
    if (again) {
      again = false
      schedulePush()
    }
  })
  return running
}

let pushTimer: ReturnType<typeof setTimeout> | undefined
export function schedulePush(delay = 1500) {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void syncNow(), delay)
}

const PULL_INTERVAL = 60_000

/** Start background sync. Returns a stop function. */
export function startSync(): () => void {
  const offChange = onLocalChange(() => schedulePush())
  const onOnline = () => void syncNow()
  const onOffline = () => setState({ status: 'offline' })
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, PULL_INTERVAL)
  void syncNow()
  return () => {
    offChange()
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(interval)
    clearTimeout(pushTimer)
  }
}
