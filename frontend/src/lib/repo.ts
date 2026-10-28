/**
 * Local data access. Every write happens in IndexedDB first and records an outbox
 * entry; the sync engine pushes the outbox to the server when online.
 */
import { db } from './db'
import { newState, review, type Rating } from './scheduler'
import { nfc, uuid } from './text'
import {
  fromScheduling,
  stateId,
  toScheduling,
  type Card,
  type CardDir,
  type CardSide,
  type CardStateRecord,
  type Deck,
  type ReviewRecord,
  type SyncTable,
} from './types'

/** Listeners notified after any local write (the sync engine schedules a push). */
const changeListeners = new Set<() => void>()
export function onLocalChange(fn: () => void): () => void {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}
function notifyChange() {
  for (const fn of changeListeners) fn()
}

/**
 * Timestamp for a new version of a record. Always newer than the previous version,
 * even if this device's clock is behind the device that wrote it, so last-write-wins
 * still picks this edit.
 */
export function nextTimestamp(prev?: { updated_at: number } | null, now = Date.now()): number {
  return prev ? Math.max(now, prev.updated_at + 1) : now
}

function markDirty(table: SyncTable, id: string) {
  return db.outbox.put({ key: `${table}:${id}`, table, id })
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export const DECK_DEFAULTS = { direction: 'ko_en', new_per_day: 20, autoplay_audio: false, answer_mode: 'flip' } as const

export async function createDeck(name: string, patch: Partial<Deck> = {}): Promise<Deck> {
  const now = Date.now()
  const deck: Deck = {
    ...DECK_DEFAULTS,
    ...patch,
    id: uuid(),
    name: nfc(name) || 'Untitled deck',
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
  await db.transaction('rw', db.decks, db.outbox, async () => {
    await db.decks.add(deck)
    await markDirty('decks', deck.id)
  })
  notifyChange()
  return deck
}

export async function updateDeck(
  id: string,
  patch: Partial<Pick<Deck, 'name' | 'direction' | 'new_per_day' | 'autoplay_audio' | 'answer_mode'>>,
): Promise<void> {
  await db.transaction('rw', db.decks, db.outbox, async () => {
    const deck = await db.decks.get(id)
    if (!deck) return
    const next: Deck = { ...deck, ...patch, updated_at: nextTimestamp(deck) }
    if (patch.name !== undefined) next.name = nfc(patch.name) || deck.name
    if (patch.new_per_day !== undefined) next.new_per_day = clampInt(patch.new_per_day, 0, 9999)
    await db.decks.put(next)
    await markDirty('decks', id)
  })
  notifyChange()
}

/** Soft delete so the deletion syncs to other devices. */
export async function deleteDeck(id: string): Promise<void> {
  await db.transaction('rw', db.decks, db.outbox, async () => {
    const deck = await db.decks.get(id)
    if (!deck) return
    const ts = nextTimestamp(deck)
    await db.decks.put({ ...deck, deleted_at: ts, updated_at: ts })
    await markDirty('decks', id)
  })
  notifyChange()
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface CardInput {
  front: string
  back: string
  notes?: string
}

export async function addCards(deckId: string, inputs: CardInput[]): Promise<Card[]> {
  const now = Date.now()
  const cards: Card[] = inputs.map((c, i) => ({
    id: uuid(),
    deck_id: deckId,
    front: nfc(c.front),
    back: nfc(c.back),
    notes: nfc(c.notes ?? ''),
    accepted_front: [],
    accepted_back: [],
    // Keep the pasted order when ordering new cards.
    created_at: now + i,
    updated_at: now,
    deleted_at: null,
  }))
  await db.transaction('rw', db.cards, db.outbox, async () => {
    await db.cards.bulkAdd(cards)
    await db.outbox.bulkPut(cards.map((c) => ({ key: `cards:${c.id}`, table: 'cards' as const, id: c.id })))
  })
  notifyChange()
  return cards
}

export async function addCard(deckId: string, input: CardInput): Promise<Card> {
  return (await addCards(deckId, [input]))[0]
}

export async function updateCard(id: string, input: CardInput): Promise<void> {
  await db.transaction('rw', db.cards, db.outbox, async () => {
    const card = await db.cards.get(id)
    if (!card) return
    await db.cards.put({
      ...card,
      front: nfc(input.front),
      back: nfc(input.back),
      notes: nfc(input.notes ?? ''),
      updated_at: nextTimestamp(card),
    })
    await markDirty('cards', id)
  })
  notifyChange()
}

/**
 * Remember `text` as a correct answer for one side of a card (Typing Mode). Returns the
 * updated card, or the unchanged card if it was blank or already listed.
 */
export async function addAcceptedAnswer(id: string, side: CardSide, text: string): Promise<Card | undefined> {
  const value = nfc(text)
  const key = side === 'front' ? 'accepted_front' : 'accepted_back'
  let result: Card | undefined
  await db.transaction('rw', db.cards, db.outbox, async () => {
    const card = await db.cards.get(id)
    result = card
    if (!card || !value) return
    const list = card[key] ?? []
    if (list.includes(value) || list.length >= 50) return
    result = { ...card, [key]: [...list, value], updated_at: nextTimestamp(card) }
    await db.cards.put(result)
    await markDirty('cards', id)
  })
  notifyChange()
  return result
}

export async function removeAcceptedAnswer(id: string, side: CardSide, text: string): Promise<void> {
  const key = side === 'front' ? 'accepted_front' : 'accepted_back'
  await db.transaction('rw', db.cards, db.outbox, async () => {
    const card = await db.cards.get(id)
    if (!card) return
    const list = card[key] ?? []
    if (!list.includes(text)) return
    await db.cards.put({ ...card, [key]: list.filter((a) => a !== text), updated_at: nextTimestamp(card) })
    await markDirty('cards', id)
  })
  notifyChange()
}

export async function deleteCard(id: string): Promise<void> {
  await db.transaction('rw', db.cards, db.outbox, async () => {
    const card = await db.cards.get(id)
    if (!card) return
    const ts = nextTimestamp(card)
    await db.cards.put({ ...card, deleted_at: ts, updated_at: ts })
    await markDirty('cards', id)
  })
  notifyChange()
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function liveDecks(): Promise<Deck[]> {
  const decks = await db.decks.toArray()
  return decks.filter((d) => !d.deleted_at).sort((a, b) => a.created_at - b.created_at)
}

export async function deckCards(deckId: string): Promise<Card[]> {
  const cards = await db.cards.where('deck_id').equals(deckId).toArray()
  return cards.filter((c) => !c.deleted_at).sort((a, b) => a.created_at - b.created_at)
}

/** Map of state id -> state for the given cards. */
export async function statesForCards(cardIds: string[]): Promise<Map<string, CardStateRecord>> {
  const states = await db.card_states.where('card_id').anyOf(cardIds).toArray()
  return new Map(states.filter((s) => !s.deleted_at).map((s) => [s.id, s]))
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** Apply a rating: update the card's scheduling state and append to the review log. */
export async function recordReview(
  card: Card,
  dir: CardDir,
  rating: Rating,
  now = Date.now(),
): Promise<CardStateRecord> {
  let result!: CardStateRecord
  await db.transaction('rw', db.card_states, db.reviews, db.outbox, async () => {
    const id = stateId(card.id, dir)
    const existing = await db.card_states.get(id)
    const prev = existing && !existing.deleted_at ? toScheduling(existing) : newState(now)
    const next = review(prev, rating, now)
    result = fromScheduling(card.id, dir, next, nextTimestamp(existing, now))
    const log: ReviewRecord = {
      id: uuid(),
      card_id: card.id,
      deck_id: card.deck_id,
      direction: dir,
      rating,
      reviewed_at: now,
      prev_state: prev.state,
      state: next.state,
      interval: next.interval,
      ease: next.ease,
    }
    await db.card_states.put(result)
    await db.reviews.add(log)
    await markDirty('card_states', id)
    await markDirty('reviews', log.id)
  })
  notifyChange()
  return result
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)))
}
