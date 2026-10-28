import { db } from './db'
import { mergeRecords, type SyncPayload } from './sync'

export const BACKUP_FORMAT = 'korean-flashcards-backup'

export interface Backup extends SyncPayload {
  format: typeof BACKUP_FORMAT
  version: 1
  exported_at: number
}

export async function exportAll(): Promise<Backup> {
  const [decks, cards, card_states, reviews] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.card_states.toArray(),
    db.reviews.toArray(),
  ])
  return { format: BACKUP_FORMAT, version: 1, exported_at: Date.now(), decks, cards, card_states, reviews }
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isStr = (v: unknown) => typeof v === 'string'
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isNumOrNull = (v: unknown) => v === null || isNum(v)

function validDeck(r: unknown) {
  return (
    isObj(r) && isStr(r.id) && isStr(r.name) && ['ko_en', 'en_ko', 'both'].includes(r.direction as string) &&
    isNum(r.new_per_day) && typeof r.autoplay_audio === 'boolean' &&
    (r.answer_mode === undefined || ['flip', 'type'].includes(r.answer_mode as string)) &&
    isNum(r.created_at) && isNum(r.updated_at) &&
    isNumOrNull(r.deleted_at)
  )
}
function validCard(r: unknown) {
  return (
    isObj(r) && isStr(r.id) && isStr(r.deck_id) && isStr(r.front) && isStr(r.back) && isStr(r.notes) &&
    isNum(r.created_at) && isNum(r.updated_at) && isNumOrNull(r.deleted_at)
  )
}
function validState(r: unknown) {
  return (
    isObj(r) && isStr(r.id) && isStr(r.card_id) && ['fwd', 'rev'].includes(r.direction as string) &&
    ['new', 'learning', 'review', 'relearning'].includes(r.state as string) &&
    [r.ease, r.interval, r.reps, r.lapses, r.step, r.due, r.updated_at].every(isNum) &&
    isNumOrNull(r.last_reviewed) && isNumOrNull(r.introduced_at) && isNumOrNull(r.deleted_at)
  )
}
function validReview(r: unknown) {
  return (
    isObj(r) && isStr(r.id) && isStr(r.card_id) && isStr(r.deck_id) && ['fwd', 'rev'].includes(r.direction as string) &&
    [1, 2, 3, 4].includes(r.rating as number) && isNum(r.reviewed_at) && isStr(r.prev_state) && isStr(r.state) &&
    isNum(r.interval) && isNum(r.ease)
  )
}

/**
 * Merge a backup into local data (newer records win, nothing is deleted) and queue
 * the result for upload. Returns the number of records written.
 */
export async function importBackup(json: unknown): Promise<number> {
  if (!isObj(json) || json.format !== BACKUP_FORMAT) throw new Error('Not a Korean Flashcards backup file.')
  const lists = ['decks', 'cards', 'card_states', 'reviews'] as const
  for (const k of lists) if (!Array.isArray(json[k])) throw new Error(`Backup is missing "${k}".`)
  const checks = { decks: validDeck, cards: validCard, card_states: validState, reviews: validReview }
  for (const k of lists) {
    const bad = (json[k] as unknown[]).findIndex((r) => !checks[k](r))
    if (bad >= 0) throw new Error(`Backup has an invalid record in "${k}" (#${bad + 1}).`)
  }
  const nfc = (s: string) => s.normalize('NFC')
  const data = json as unknown as SyncPayload
  return mergeRecords(
    {
      ...data,
      decks: data.decks.map((d) => ({ ...d, name: nfc(d.name) })),
      cards: data.cards.map((c) => ({ ...c, front: nfc(c.front), back: nfc(c.back), notes: nfc(c.notes) })),
    },
    { markDirty: true },
  )
}
