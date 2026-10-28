import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  advanceQueue,
  buildQueue,
  countDue,
  formatDelay,
  isStruggling,
  maturity,
  newState,
  previewDelays,
  review,
  type Rating,
  type SchedulingState,
} from './scheduler'

const MIN = 60_000
const DAY = 86_400_000
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime() // local noon

function reviewCard(over: Partial<SchedulingState> = {}): SchedulingState {
  return {
    ...newState(NOW),
    state: 'review',
    interval: 10,
    reps: 3,
    introducedAt: NOW - 30 * DAY,
    lastReviewed: NOW - 10 * DAY,
    due: NOW,
    ...over,
  }
}

describe('new cards / learning steps', () => {
  it('starts with SM-2 defaults', () => {
    const s = newState(NOW)
    expect(s).toMatchObject({ state: 'new', ease: 2.5, interval: 0, reps: 0, lapses: 0 })
  })

  it('Again keeps the card in learning at the first step, due in 1 minute', () => {
    const s = review(newState(NOW), 1, NOW)
    expect(s.state).toBe('learning')
    expect(s.step).toBe(0)
    expect(s.due).toBe(NOW + 1 * MIN)
    expect(s.introducedAt).toBe(NOW)
    expect(s.lastReviewed).toBe(NOW)
  })

  it('Good graduates a new card straight to 2 days', () => {
    const s = review(newState(NOW), 3, NOW)
    expect(s.state).toBe('review')
    expect(s.interval).toBe(2)
    expect(s.reps).toBe(1)
    expect(s.due).toBe(NOW + 2 * DAY)
  })

  it('Good after Again also graduates to 2 days', () => {
    const s = review(review(newState(NOW), 1, NOW), 3, NOW + MIN)
    expect(s).toMatchObject({ state: 'review', interval: 2 })
    expect(s.due).toBe(NOW + MIN + 2 * DAY)
  })

  it('Easy graduates a new card immediately with the easy interval', () => {
    const s = review(newState(NOW), 4, NOW)
    expect(s.state).toBe('review')
    expect(s.interval).toBe(DEFAULT_CONFIG.easyInterval)
  })

  it('Hard repeats the current step and is due again in 1 hour', () => {
    const s = review(newState(NOW), 2, NOW)
    expect(s).toMatchObject({ state: 'learning', step: 0 })
    expect(s.due).toBe(NOW + 60 * MIN)
    const afterAgain = review(review(newState(NOW), 1, NOW), 2, NOW)
    expect(afterAgain).toMatchObject({ state: 'learning', step: 0 })
    expect(afterAgain.due).toBe(NOW + 60 * MIN)
  })

  it('Hard while relearning is also due in 1 hour, without changing the reset interval', () => {
    const lapsed = review(reviewCard({ interval: 30 }), 1, NOW)
    const s = review(lapsed, 2, NOW)
    expect(s).toMatchObject({ state: 'relearning', interval: 2 })
    expect(s.due).toBe(NOW + 60 * MIN)
  })

  it('Again during learning goes back to the first step without counting a lapse', () => {
    let s = review(newState(NOW), 2, NOW)
    s = review(s, 1, NOW + MIN)
    expect(s.step).toBe(0)
    expect(s.lapses).toBe(0)
    expect(s.ease).toBe(2.5)
  })

  it('keeps the original introducedAt across reviews', () => {
    let s = review(newState(NOW), 1, NOW)
    s = review(s, 3, NOW + 5 * MIN)
    expect(s.introducedAt).toBe(NOW)
  })
})

describe('review cards', () => {
  it('Hard < Good < Easy, and all grow the interval', () => {
    const prev = reviewCard()
    const hard = review(prev, 2, NOW)
    const good = review(prev, 3, NOW)
    const easy = review(prev, 4, NOW)
    expect(hard.interval).toBeGreaterThan(prev.interval)
    expect(good.interval).toBeGreaterThan(hard.interval)
    expect(easy.interval).toBeGreaterThan(good.interval)
    expect(good.interval).toBe(25) // 10 * 2.5
    expect(good.due).toBe(NOW + 25 * DAY)
  })

  it('adjusts ease: Hard -0.15, Good unchanged, Easy +0.15', () => {
    expect(review(reviewCard(), 2, NOW).ease).toBe(2.35)
    expect(review(reviewCard(), 3, NOW).ease).toBe(2.5)
    expect(review(reviewCard(), 4, NOW).ease).toBe(2.65)
  })

  it('Again resets to relearning, increments lapses, lowers ease, and resets the interval', () => {
    const s = review(reviewCard({ interval: 40, lapses: 1 }), 1, NOW)
    expect(s.state).toBe('relearning')
    expect(s.lapses).toBe(2)
    expect(s.ease).toBe(2.3)
    expect(s.reps).toBe(0)
    expect(s.interval).toBe(2)
    expect(s.due).toBe(NOW + 10 * MIN)
  })

  it('never lets ease drop below 1.3', () => {
    let s = reviewCard({ ease: 1.35 })
    for (let i = 0; i < 5; i++) s = review({ ...s, state: 'review' }, 1, NOW)
    expect(s.ease).toBe(1.3)
    expect(review(reviewCard({ ease: 1.3 }), 2, NOW).ease).toBe(1.3)
  })

  it('relearning graduates back to review in 2 days on Good', () => {
    const lapsed = review(reviewCard({ interval: 30 }), 1, NOW)
    const back = review(lapsed, 3, NOW + 10 * MIN)
    expect(back.state).toBe('review')
    expect(back.interval).toBe(2)
    expect(back.due).toBe(NOW + 10 * MIN + 2 * DAY)
  })

  it('a well-known card keeps getting pushed further out', () => {
    let s = reviewCard({ interval: 1 })
    let t = NOW
    const intervals: number[] = []
    for (let i = 0; i < 6; i++) {
      s = review(s, 3, t)
      intervals.push(s.interval)
      t = s.due
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1])
    expect(intervals.at(-1)).toBeGreaterThan(60)
  })

  it('caps the interval at maxInterval', () => {
    const s = review(reviewCard({ interval: 30000 }), 4, NOW)
    expect(s.interval).toBe(DEFAULT_CONFIG.maxInterval)
  })
})

describe('previewDelays / formatDelay', () => {
  it('previews delays for each rating', () => {
    const p = previewDelays(newState(NOW), NOW)
    expect(formatDelay(p[1])).toBe('1m')
    expect(formatDelay(p[2])).toBe('1h')
    expect(formatDelay(p[3])).toBe('2d')
    expect(formatDelay(p[4])).toBe('4d')
    expect(formatDelay(30 * 1000)).toBe('<1m')
    expect(formatDelay(3 * 3600_000)).toBe('3h')
    expect(formatDelay(90 * DAY)).toBe('3mo')
    expect(formatDelay(730 * DAY)).toBe('2y')
  })
})

describe('buildQueue', () => {
  /** Deterministic pseudo-random numbers for repeatable shuffles. */
  const seeded = (seed: number) => () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
  const due = (key: string, daysAgo = 1) => ({ key, state: reviewCard({ due: NOW - daysAgo * DAY }) })
  const fresh = (key: string) => ({ key, state: null })

  it('puts due cards first, then new cards up to the limit', () => {
    const candidates = [
      fresh('new-a'),
      due('due-1'),
      due('due-2', 5),
      { key: 'not-due', state: reviewCard({ due: NOW + 3 * DAY }) },
      fresh('new-b'),
      due('due-3'),
      fresh('new-c'),
    ]
    for (let seed = 1; seed <= 20; seed++) {
      const q = buildQueue(candidates, NOW, 2, seeded(seed))
      expect(q).toHaveLength(5)
      expect(new Set(q.slice(0, 3))).toEqual(new Set(['due-1', 'due-2', 'due-3']))
      expect(q.slice(3).every((k) => k.startsWith('new-'))).toBe(true)
      expect(q).not.toContain('not-due')
    }
  })

  it('includes cards due later today and learning cards', () => {
    const q = buildQueue(
      [
        { key: 'later-today', state: reviewCard({ due: NOW + 3 * 3600_000 }) },
        { key: 'learning', state: { ...newState(NOW), state: 'learning', due: NOW + MIN } },
      ],
      NOW,
      0,
    )
    expect(new Set(q)).toEqual(new Set(['learning', 'later-today']))
  })

  it('shuffles reviews, and picks new cards at random rather than oldest first', () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => due(`due-${i}`)),
      ...Array.from({ length: 30 }, (_, i) => fresh(`new-${i}`)),
    ]
    const orders = new Set<string>()
    const picked = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const q = buildQueue(candidates, NOW, 5, seeded(seed))
      orders.add(q.slice(0, 10).join(','))
      q.slice(10).forEach((k) => picked.add(k))
    }
    expect(orders.size).toBeGreaterThan(15) // review order differs between sessions
    expect(picked.size).toBeGreaterThan(20) // new cards come from the whole pool, not just the first 5
  })

  it('keeps the two directions of the same word apart', () => {
    const candidates = ['a', 'b', 'c', 'd'].flatMap((id) => [fresh(`${id}:fwd`), fresh(`${id}:rev`)])
    for (let seed = 1; seed <= 50; seed++) {
      const q = buildQueue(candidates, NOW, 8, seeded(seed))
      for (let i = 1; i < q.length; i++) expect(q[i].split(':')[0]).not.toBe(q[i - 1].split(':')[0])
    }
  })
})

describe('advanceQueue (in-session repetition)', () => {
  const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']

  it('removes a card that graduated / was answered with a day interval', () => {
    const next = review(reviewCard(), 3, NOW)
    expect(advanceQueue(queue, 'a', 3, next)).toEqual(queue.slice(1))
  })

  it('re-queues a card rated Again a few cards later', () => {
    const next = review(reviewCard(), 1, NOW)
    const q = advanceQueue(queue, 'a', 1, next)
    expect(q.indexOf('a')).toBe(3)
    expect(q).toHaveLength(queue.length)
  })

  it('re-queues learning cards further back for Hard than for Again, and drops them on Good', () => {
    const again = advanceQueue(queue, 'a', 1, review(newState(NOW), 1, NOW))
    const hard = advanceQueue(queue, 'a', 2, review(newState(NOW), 2, NOW))
    const good = advanceQueue(queue, 'a', 3, review(newState(NOW), 3, NOW))
    expect(hard.indexOf('a')).toBeGreaterThan(again.indexOf('a'))
    expect(good).not.toContain('a')
  })

  it('appends to the end when the queue is short, so the session continues until learned', () => {
    let q = ['a']
    let s = newState(NOW)
    const ratings: Rating[] = [1, 2, 1, 3]
    let shown = 0
    for (const r of ratings) {
      expect(q[0]).toBe('a')
      s = review(s, r, NOW)
      q = advanceQueue(q, 'a', r, s)
      shown++
    }
    expect(shown).toBe(4)
    expect(q).toEqual([])
  })
})

describe('countDue / maturity / struggling', () => {
  it('counts due and new (capped by the daily limit)', () => {
    const states = [null, null, null, reviewCard({ due: NOW - DAY }), reviewCard({ due: NOW + 5 * DAY })]
    expect(countDue(states, NOW, 2)).toEqual({ due: 1, new: 2 })
    expect(countDue(states, NOW, 20)).toEqual({ due: 1, new: 3 })
  })

  it('classifies maturity', () => {
    expect(maturity(null)).toBe('new')
    expect(maturity(review(newState(NOW), 3, NOW))).toBe('learning')
    expect(maturity(reviewCard({ interval: 5 }))).toBe('learning')
    expect(maturity(reviewCard({ interval: 21 }))).toBe('mature')
  })

  it('flags struggling cards by lapses or low ease', () => {
    expect(isStruggling(null)).toBe(false)
    expect(isStruggling(reviewCard())).toBe(false)
    expect(isStruggling(reviewCard({ lapses: 3 }))).toBe(true)
    expect(isStruggling(reviewCard({ ease: 1.9 }))).toBe(true)
  })
})
