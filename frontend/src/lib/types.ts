// Records stored locally (IndexedDB) and synced with the server.
// Field names match the server's JSON so records can be sent as-is.
// All timestamps are ms since the Unix epoch.

import type { CardStateKind, Rating, SchedulingState } from './scheduler'

/**
 * ko_en = front → back; en_ko = back → front; both = each direction is its own card with its own
 * schedule; mixed = one schedule per card, and each time it comes up a random side is asked.
 */
export type StudyDirection = 'ko_en' | 'en_ko' | 'both' | 'mixed'
/** flip = reveal the answer; type = type a guess first, then reveal. */
export type AnswerMode = 'flip' | 'type'
/** fwd = front→back (Korean→English), rev = back→front. */
export type CardDir = 'fwd' | 'rev'
/** Which side of a card is being answered. */
export type CardSide = 'front' | 'back'

/** The side you type when studying in this direction. */
export function answerSide(dir: CardDir): CardSide {
  return dir === 'fwd' ? 'back' : 'front'
}

export interface Deck {
  id: string
  name: string
  direction: StudyDirection
  new_per_day: number
  autoplay_audio: boolean
  /** Missing on records saved before this setting existed; treat as 'flip'. */
  answer_mode?: AnswerMode
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
  /** Extra answers accepted in Typing Mode when the front is the answer (Back → Front). */
  accepted_front?: string[]
  /** Extra answers accepted in Typing Mode when the back is the answer (Front → Back). */
  accepted_back?: string[]
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

/** Scheduling directions for a deck. Mixed uses the front → back schedule for both sides. */
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
