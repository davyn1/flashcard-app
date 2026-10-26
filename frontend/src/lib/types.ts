// Records stored locally (IndexedDB) and synced with the server.
// Field names match the server's JSON so records can be sent as-is.
// All timestamps are ms since the Unix epoch.

import type { CardStateKind, Rating, SchedulingState } from './scheduler'

/** ko_en = show Korean (front), answer English; en_ko = the reverse; both = two separate cards. */
export type StudyDirection = 'ko_en' | 'en_ko' | 'both'
/** fwd = front→back (Korean→English), rev = back→front. */
export type CardDir = 'fwd' | 'rev'

export interface Deck {
  id: string
  name: string
  direction: StudyDirection
  new_per_day: number
  autoplay_audio: boolean
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface Card {
  id: string
  deck_id: string
  /** Korean */
  front: string
  /** English */
  back: string
  notes: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** Scheduling state for one direction of a card. id = `${card_id}:${direction}`. */
export interface CardStateRecord {
  id: string
  card_id: string
  direction: CardDir
  state: CardStateKind
  ease: number
  interval: number
  reps: number
  lapses: number
  step: number
  due: number
  last_reviewed: number | null
  introduced_at: number | null
  updated_at: number
  deleted_at: number | null
}

/** Append-only review log entry. */
export interface ReviewRecord {
  id: string
  card_id: string
  deck_id: string
  direction: CardDir
  rating: Rating
  reviewed_at: number
  prev_state: CardStateKind
  state: CardStateKind
  interval: number
  ease: number
}

export type SyncTable = 'decks' | 'cards' | 'card_states' | 'reviews'

export function dirsFor(direction: StudyDirection): CardDir[] {
  return direction === 'both' ? ['fwd', 'rev'] : direction === 'en_ko' ? ['rev'] : ['fwd']
}

export function stateId(cardId: string, dir: CardDir): string {
  return `${cardId}:${dir}`
}

export function toScheduling(r: CardStateRecord): SchedulingState {
  return {
    state: r.state,
    ease: r.ease,
    interval: r.interval,
    reps: r.reps,
    lapses: r.lapses,
    step: r.step,
    due: r.due,
    lastReviewed: r.last_reviewed,
    introducedAt: r.introduced_at,
  }
}

export function fromScheduling(
  cardId: string,
  dir: CardDir,
  s: SchedulingState,
  updatedAt: number,
): CardStateRecord {
  return {
    id: stateId(cardId, dir),
    card_id: cardId,
    direction: dir,
    state: s.state,
    ease: s.ease,
    interval: s.interval,
    reps: s.reps,
    lapses: s.lapses,
    step: s.step,
    due: s.due,
    last_reviewed: s.lastReviewed,
    introduced_at: s.introducedAt,
    updated_at: updatedAt,
    deleted_at: null,
  }
}
