import { db } from './db'
import type { Card, Deck } from './types'

// Fixed ids and a very old timestamp: every device seeds the *same* records, and any
// real edit or deletion (newer updated_at) wins over the seed during sync.
const SEED_TS = 1
const DECK_ID = '5eed0000-0000-4000-8000-000000000000'
const cardId = (n: number) => `5eed0000-0000-4000-8000-${String(n).padStart(12, '0')}`

const VOCAB: [string, string, string][] = [
  ['안녕하세요', 'Hello', 'annyeonghaseyo · polite greeting, any time of day'],
  ['감사합니다', 'Thank you', 'gamsahamnida · formal'],
  ['죄송합니다', "I'm sorry", 'joesonghamnida · formal apology'],
  ['네', 'Yes', 'ne'],
  ['아니요', 'No', 'aniyo'],
  ['물', 'Water', 'mul · 물 주세요. = Water, please.'],
  ['학교', 'School', 'hakgyo · 학교에 가요. = I go to school.'],
  ['학생', 'Student', 'haksaeng'],
  ['선생님', 'Teacher', 'seonsaengnim'],
  ['사람', 'Person', 'saram'],
  ['친구', 'Friend', 'chingu'],
  ['집', 'House, home', 'jip · 집에 가요. = I go home.'],
  ['밥', 'Rice, meal', 'bap · 밥 먹었어요? = Have you eaten?'],
  ['책', 'Book', 'chaek'],
  ['사랑', 'Love', 'sarang'],
  ['맛있어요', "It's delicious", 'masisseoyo'],
]

/** Add the sample deck if this device has never had any decks. */
export async function seedIfEmpty(): Promise<boolean> {
  return db.transaction('rw', db.decks, db.cards, db.outbox, async () => {
    if ((await db.decks.count()) > 0) return false
    const deck: Deck = {
      id: DECK_ID,
      name: 'Korean basics',
      direction: 'ko_en',
      new_per_day: 20,
      autoplay_audio: false,
      answer_mode: 'flip',
      created_at: SEED_TS,
      updated_at: SEED_TS,
      deleted_at: null,
    }
    const cards: Card[] = VOCAB.map(([front, back, notes], i) => ({
      id: cardId(i + 1),
      deck_id: DECK_ID,
      front: front.normalize('NFC'),
      back,
      notes: notes.normalize('NFC'),
      created_at: SEED_TS + i,
      updated_at: SEED_TS,
      deleted_at: null,
    }))
    await db.decks.add(deck)
    await db.cards.bulkAdd(cards)
    await db.outbox.bulkPut([
      { key: `decks:${deck.id}`, table: 'decks', id: deck.id },
      ...cards.map((c) => ({ key: `cards:${c.id}`, table: 'cards' as const, id: c.id })),
    ])
    return true
  })
}
