import { buildQueue, countDue, startOfDay, type QueueCandidate } from './scheduler'
import { dirsFor, stateId, toScheduling, type Card, type CardStateRecord, type Deck } from './types'

/** One studyable unit per card per active direction. */
export function studyCandidates(deck: Deck, cards: Card[], states: Map<string, CardStateRecord>): QueueCandidate[] {
  const dirs = dirsFor(deck.direction)
  return cards.flatMap((c) =>
    dirs.map((dir, order) => {
      const rec = states.get(stateId(c.id, dir))
      return { key: stateId(c.id, dir), state: rec ? toScheduling(rec) : null, createdAt: c.created_at, order }
    }),
  )
}

/** New cards still allowed today after the ones already introduced. */
export function newLimitRemaining(
  deck: Deck,
  cards: Card[],
  states: Map<string, CardStateRecord>,
  now: number,
): number {
  const since = startOfDay(now)
  const ids = new Set(cards.map((c) => c.id))
  let introducedToday = 0
  for (const s of states.values()) {
    if (ids.has(s.card_id) && s.introduced_at !== null && s.introduced_at >= since) introducedToday++
  }
  return Math.max(0, deck.new_per_day - introducedToday)
}

export interface DeckSummary {
  due: number
  new: number
  total: number
}

export function summarizeDeck(
  deck: Deck,
  cards: Card[],
  states: Map<string, CardStateRecord>,
  now: number,
): DeckSummary {
  const candidates = studyCandidates(deck, cards, states)
  const counts = countDue(
    candidates.map((c) => c.state),
    now,
    newLimitRemaining(deck, cards, states, now),
  )
  return { ...counts, total: cards.length }
}

export function sessionQueue(
  deck: Deck,
  cards: Card[],
  states: Map<string, CardStateRecord>,
  now: number,
): string[] {
  return buildQueue(studyCandidates(deck, cards, states), now, newLimitRemaining(deck, cards, states, now))
}
