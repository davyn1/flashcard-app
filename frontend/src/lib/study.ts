import { buildQueue, countDue, startOfDay, type QueueCandidate } from './scheduler'
import {
  dirsFor,
  stateId,
  toScheduling,
  type Card,
  type CardDir,
  type CardStateRecord,
  type Deck,
  type StudyDirection,
} from './types'

/** One studyable unit per card per active direction. */
export function studyCandidates(deck: Deck, cards: Card[], states: Map<string, CardStateRecord>): QueueCandidate[] {
  const dirs = dirsFor(deck.direction)
  return cards.flatMap((c) =>
    dirs.map((dir) => {
      const rec = states.get(stateId(c.id, dir))
      return { key: stateId(c.id, dir), state: rec ? toScheduling(rec) : null }
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

/** Mixed decks never ask the same side more than this many times in a row. */
export const MAX_SAME_SIDE = 2

/**
 * The side actually asked. For mixed decks it's picked pseudo-randomly per showing (`showing`
 * = how many cards have been rated so far), so it's stable while the card is on screen but
 * can differ next time the card comes up. `recent` = sides shown so far this session.
 */
export function shownDirection(
  direction: StudyDirection,
  scheduled: CardDir,
  cardId: string,
  showing: number,
  recent: CardDir[] = [],
): CardDir {
  if (direction !== 'mixed') return scheduled
  const last = recent.slice(-MAX_SAME_SIDE)
  if (last.length === MAX_SAME_SIDE && last.every((d) => d === last[0])) return last[0] === 'fwd' ? 'rev' : 'fwd'
  // FNV-1a over the id, then a full avalanche (MurmurHash3 fmix32): FNV's low bit alone
  // barely changes between similar ids, so without this, runs of cards got the same side.
  let h = 2166136261
  for (const ch of `${cardId}:${showing}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h & 1) === 0 ? 'fwd' : 'rev'
}

export function sessionQueue(
  deck: Deck,
  cards: Card[],
  states: Map<string, CardStateRecord>,
  now: number,
): string[] {
  return buildQueue(studyCandidates(deck, cards, states), now, newLimitRemaining(deck, cards, states, now))
}
