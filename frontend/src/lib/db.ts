import Dexie, { type Table } from 'dexie'
import type { Card, CardStateRecord, Deck, ReviewRecord, SyncTable } from './types'

/** A local change waiting to be pushed. key = `${table}:${id}`. */
export interface OutboxEntry {
  key: string
  table: SyncTable
  id: string
}

export interface MetaEntry {
  key: string
  value: unknown
}

export class FlashcardDB extends Dexie {
  decks!: Table<Deck, string>
  cards!: Table<Card, string>
  card_states!: Table<CardStateRecord, string>
  reviews!: Table<ReviewRecord, string>
  outbox!: Table<OutboxEntry, string>
  meta!: Table<MetaEntry, string>

  constructor(name = 'korean-flashcards') {
    super(name)
    this.version(1).stores({
      decks: 'id, updated_at',
      cards: 'id, deck_id, updated_at',
      card_states: 'id, card_id, updated_at',
      reviews: 'id, card_id, deck_id, reviewed_at',
      outbox: 'key, table',
      meta: 'key',
    })
  }
}

export const db = new FlashcardDB()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}
