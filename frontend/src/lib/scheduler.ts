/**
 * Simplified SM-2 spaced-repetition scheduler. Pure functions only (no I/O, no Date.now()),
 * so it runs offline on the client and is easy to unit test.
 *
 * Lifecycle of one card direction:
 *   new ──► learning (Again/Hard: shown again within the session)
 *       ──► review   (Good: 2 days, Easy: 4 days, then intervals grow with the ease factor)
 *   review ──Again──► relearning (minute steps) ──► review (with a reset interval)
 */

export type Rating = 1 | 2 | 3 | 4 // Again | Hard | Good | Easy
export const RATING_LABELS: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }

export type CardStateKind = 'new' | 'learning' | 'review' | 'relearning'

export interface SchedulingState {
  state: CardStateKind
  /** Ease factor (SM-2). Starts at 2.5, never below minEase. */
  ease: number
  /** Current interval in days (0 while still in initial learning). */
  interval: number
  /** Successful reviews in a row (reset by Again). */
  reps: number
  /** Times the card was forgotten after it had been learned. */
  lapses: number
  /** Index into the learning / relearning steps. */
  step: number
  /** When the card is next due, ms since epoch. */
  due: number
  lastReviewed: number | null
  /** First time the card was studied (used for the new-cards-per-day limit). */
  introducedAt: number | null
}

export interface SchedulerConfig {
  /** Learning steps for new cards, in minutes. */
  learningSteps: number[]
  /** Relearning steps after a lapse, in minutes. */
  relearningSteps: number[]
  /** Interval (days) when Good is pressed on a new, learning or relearning card. */
  graduatingInterval: number
  /** Interval (days) when a new card is rated Easy. */
  easyInterval: number
  startingEase: number
  minEase: number
  easyBonus: number
  hardMultiplier: number
  /** Delay (minutes) when a learning/relearning card is rated Hard. Review cards use hardMultiplier. */
  hardLearningDelay: number
  /** New interval after a lapse = max(graduatingInterval, old * lapseMultiplier). 0 = reset. */
  lapseMultiplier: number
  maxInterval: number
  /** How many cards later a card is shown again within the session, per rating. */
  requeueGap: Record<Rating, number>
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  learningSteps: [1],
  relearningSteps: [10],
  graduatingInterval: 2,
  easyInterval: 4,
  startingEase: 2.5,
  minEase: 1.3,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  hardLearningDelay: 60,
  lapseMultiplier: 0,
  maxInterval: 36500,
  requeueGap: { 1: 3, 2: 5, 3: 8, 4: 8 },
}

const MINUTE = 60_000
const DAY = 86_400_000

export function newState(now: number, config: SchedulerConfig = DEFAULT_CONFIG): SchedulingState {
  return {
    state: 'new',
    ease: config.startingEase,
    interval: 0,
    reps: 0,
    lapses: 0,
    step: 0,
    due: now,
    lastReviewed: null,
    introducedAt: null,
  }
}

function clampEase(ease: number, config: SchedulerConfig): number {
  return Math.round(Math.max(config.minEase, ease) * 100) / 100
}

function stepDelayMinutes(steps: number[], step: number, rating: Rating, config: SchedulerConfig): number {
  if (rating === 2) return config.hardLearningDelay
  return steps[Math.min(step, steps.length - 1)]
}

/** Day-based intervals for a card in review, guaranteeing Hard < Good < Easy. */
function reviewIntervals(prev: SchedulingState, config: SchedulerConfig) {
  const base = Math.max(prev.interval, 1)
  const cap = (d: number) => Math.min(config.maxInterval, d)
  const hard = cap(Math.max(base + 1, Math.round(base * config.hardMultiplier)))
  const good = cap(Math.max(hard + 1, Math.round(base * prev.ease)))
  const easy = cap(Math.max(good + 1, Math.round(base * prev.ease * config.easyBonus)))
  return { hard, good, easy }
}

/** Apply a rating to a card's scheduling state and return the new state. */
export function review(
  prev: SchedulingState,
  rating: Rating,
  now: number,
  config: SchedulerConfig = DEFAULT_CONFIG,
): SchedulingState {
  const s: SchedulingState = {
    ...prev,
    lastReviewed: now,
    introducedAt: prev.introducedAt ?? now,
  }

  const graduate = (intervalDays: number): SchedulingState => ({
    ...s,
    state: 'review',
    step: 0,
    interval: intervalDays,
    reps: s.reps + 1,
    due: now + intervalDays * DAY,
  })

  switch (prev.state) {
    case 'new':
    case 'learning': {
      const steps = config.learningSteps
      const step = prev.state === 'new' ? 0 : prev.step
      if (rating === 4) return graduate(config.easyInterval)
      if (rating === 3) {
        const next = prev.state === 'new' ? 1 : step + 1
        if (next >= steps.length) return graduate(config.graduatingInterval)
        return { ...s, state: 'learning', step: next, due: now + steps[next] * MINUTE }
      }
      const nextStep = rating === 1 ? 0 : step
      return {
        ...s,
        state: 'learning',
        step: nextStep,
        reps: 0,
        due: now + stepDelayMinutes(steps, nextStep, rating, config) * MINUTE,
      }
    }

    case 'relearning': {
      const steps = config.relearningSteps
      if (rating === 4) return graduate(prev.interval + 1)
      if (rating === 3) {
        const next = prev.step + 1
        if (next >= steps.length) return graduate(prev.interval)
        return { ...s, step: next, due: now + steps[next] * MINUTE }
      }
      const nextStep = rating === 1 ? 0 : prev.step
      return { ...s, step: nextStep, due: now + stepDelayMinutes(steps, nextStep, rating, config) * MINUTE }
    }

    case 'review': {
      if (rating === 1) {
        const interval = Math.max(config.graduatingInterval, Math.round(prev.interval * config.lapseMultiplier))
        return {
          ...s,
          state: 'relearning',
          step: 0,
          reps: 0,
          lapses: prev.lapses + 1,
          ease: clampEase(prev.ease - 0.2, config),
          interval,
          due: now + config.relearningSteps[0] * MINUTE,
        }
      }
      const iv = reviewIntervals(prev, config)
      const interval = rating === 2 ? iv.hard : rating === 3 ? iv.good : iv.easy
      const easeDelta = rating === 2 ? -0.15 : rating === 4 ? 0.15 : 0
      return {
        ...s,
        state: 'review',
        interval,
        ease: clampEase(prev.ease + easeDelta, config),
        reps: prev.reps + 1,
        due: now + interval * DAY,
      }
    }
  }
}

/** True if the card should be shown again later in the same study session. */
export function isInSessionStep(s: SchedulingState): boolean {
  return s.state === 'learning' || s.state === 'relearning'
}

/** Preview the delay (ms) each rating would produce — used for the button labels. */
export function previewDelays(
  prev: SchedulingState,
  now: number,
  config: SchedulerConfig = DEFAULT_CONFIG,
): Record<Rating, number> {
  const out = {} as Record<Rating, number>
  for (const r of [1, 2, 3, 4] as Rating[]) out[r] = review(prev, r, now, config).due - now
  return out
}

export function formatDelay(ms: number): string {
  const min = ms / MINUTE
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  const hours = min / 60
  if (hours < 24) return `${Math.round(hours)}h`
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round((days / 365) * 10) / 10}y`
}

// ---------------------------------------------------------------------------
// Day boundaries (local time)
// ---------------------------------------------------------------------------

export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(now: number): number {
  return startOfDay(now) + DAY - 1
}

// ---------------------------------------------------------------------------
// Study queue
// ---------------------------------------------------------------------------

export interface QueueCandidate {
  key: string
  /** null = never studied (new). */
  state: SchedulingState | null
}

/** Fisher–Yates shuffle (returns a new array). `random` is injectable for tests. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Queue keys are `${cardId}:${dir}`; two keys with the same card id are the same word. */
function cardOf(key: string): string {
  const i = key.lastIndexOf(':')
  return i < 0 ? key : key.slice(0, i)
}

/**
 * Reorder as little as possible so the two directions of the same word aren't back to back
 * (the first would give away the second). Takes cards in order, skipping ahead past a card
 * that would sit next to its sibling; a leftover clash at the end is moved to the first
 * earlier gap where it fits.
 */
export function separateSiblings(keys: string[]): string[] {
  const pool = [...keys]
  const out: string[] = []
  while (pool.length) {
    const prev = out.at(-1)
    const idx = pool.findIndex((k) => prev === undefined || cardOf(k) !== cardOf(prev))
    out.push(pool.splice(Math.max(idx, 0), 1)[0])
  }
  for (let i = out.length - 1; i > 0; i--) {
    if (cardOf(out[i]) !== cardOf(out[i - 1])) continue
    const [item] = out.splice(i, 1)
    const fits = (p: number) =>
      (p === 0 || cardOf(out[p - 1]) !== cardOf(item)) && (p === out.length || cardOf(out[p]) !== cardOf(item))
    let p = 0
    while (p <= out.length && !fits(p)) p++
    out.splice(p <= out.length ? p : i, 0, item)
  }
  return out
}

/**
 * Build the session queue: cards due for review first, then up to `newLimit` new cards
 * picked at random from all the new ones. Both groups are shuffled so words don't come up
 * in the same order every time.
 */
export function buildQueue(
  candidates: QueueCandidate[],
  now: number,
  newLimit: number,
  random: () => number = Math.random,
): string[] {
  const cutoff = endOfDay(now)
  const due = candidates.filter((c) => c.state && c.state.state !== 'new' && c.state.due <= cutoff)
  const fresh = shuffle(
    candidates.filter((c) => !c.state || c.state.state === 'new'),
    random,
  ).slice(0, Math.max(0, newLimit))
  return separateSiblings([...shuffle(due, random), ...fresh].map((c) => c.key))
}

/**
 * After rating the card at the head of the queue, return the remaining queue.
 * Cards still in learning/relearning are re-inserted a few positions later.
 */
export function advanceQueue(
  queue: string[],
  key: string,
  rating: Rating,
  next: SchedulingState,
  config: SchedulerConfig = DEFAULT_CONFIG,
): string[] {
  const idx = queue.indexOf(key)
  const rest = idx < 0 ? [...queue] : [...queue.slice(0, idx), ...queue.slice(idx + 1)]
  if (!isInSessionStep(next)) return rest
  const gap = config.requeueGap[rating]
  const pos = Math.min(gap, rest.length)
  return [...rest.slice(0, pos), key, ...rest.slice(pos)]
}

/** Due/new counts for a deck, matching what buildQueue would schedule today. */
export function countDue(
  states: (SchedulingState | null)[],
  now: number,
  newLimit: number,
): { due: number; new: number } {
  const cutoff = endOfDay(now)
  let due = 0
  let fresh = 0
  for (const s of states) {
    if (!s || s.state === 'new') fresh++
    else if (s.due <= cutoff) due++
  }
  return { due, new: Math.min(fresh, Math.max(0, newLimit)) }
}

// ---------------------------------------------------------------------------
// Classification for stats
// ---------------------------------------------------------------------------

export const MATURE_DAYS = 21

export function maturity(s: SchedulingState | null): 'new' | 'learning' | 'mature' {
  if (!s || s.state === 'new') return 'new'
  if (s.state === 'review' && s.interval >= MATURE_DAYS) return 'mature'
  return 'learning'
}

export function isStruggling(s: SchedulingState | null): boolean {
  return !!s && s.state !== 'new' && (s.lapses >= 3 || s.ease <= 2.0)
}
