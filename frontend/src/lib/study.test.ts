import { describe, expect, it } from 'vitest'
import { MAX_SAME_SIDE, practiceQueue, shownDirection, studyCandidates } from './study'
import { dirsFor, type Card, type CardDir, type Deck } from './types'

const deck = (direction: Deck['direction']): Deck => ({
  id: 'd',
  name: 'D',
  direction,
  new_per_day: 20,
  autoplay_audio: false,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
})
const card = (id: string): Card => ({
  id,
  deck_id: 'd',
  front: '물',
  back: 'water',
  notes: '',
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
})

describe('mixed direction', () => {
  it('keeps one schedule per card (the front → back one)', () => {
    expect(dirsFor('mixed')).toEqual(['fwd'])
    expect(studyCandidates(deck('mixed'), [card('a'), card('b')], new Map()).map((c) => c.key)).toEqual([
      'a:fwd',
      'b:fwd',
    ])
  })

  it('asks both sides across showings, and is stable for a given showing', () => {
    const sides = new Set(Array.from({ length: 40 }, (_, n) => shownDirection('mixed', 'fwd', 'card-1', n)))
    expect(sides).toEqual(new Set(['fwd', 'rev']))
    expect(shownDirection('mixed', 'fwd', 'card-1', 7)).toBe(shownDirection('mixed', 'fwd', 'card-1', 7))
  })

  it('is roughly balanced across many cards', () => {
    let rev = 0
    for (let i = 0; i < 400; i++) if (shownDirection('mixed', 'fwd', `card-${i}`, i % 5) === 'rev') rev++
    expect(rev).toBeGreaterThan(140)
    expect(rev).toBeLessThan(260)
  })

  it('never asks the same side more than twice in a row within a session', () => {
    // Sequential ids like the sample deck's, shown one after another (as the study screen does).
    for (let deckRun = 0; deckRun < 50; deckRun++) {
      const sides: CardDir[] = []
      for (let n = 0; n < 40; n++) {
        const id = `5eed${deckRun}-0000-4000-8000-${String((n % 16) + 1).padStart(12, '0')}`
        sides.push(shownDirection('mixed', 'fwd', id, n, sides))
      }
      let longest = 1
      for (let i = 1, run = 1; i < sides.length; i++) {
        run = sides[i] === sides[i - 1] ? run + 1 : 1
        longest = Math.max(longest, run)
      }
      expect(longest).toBeLessThanOrEqual(MAX_SAME_SIDE)
      expect(sides.filter((d) => d === 'rev').length).toBeGreaterThanOrEqual(12)
      expect(sides.filter((d) => d === 'fwd').length).toBeGreaterThanOrEqual(12)
    }
  })

  it('leaves the other directions alone', () => {
    expect(shownDirection('ko_en', 'fwd', 'x', 3)).toBe('fwd')
    expect(shownDirection('en_ko', 'rev', 'x', 3)).toBe('rev')
    expect(shownDirection('both', 'rev', 'x', 3)).toBe('rev')
  })
})

describe('practiceQueue', () => {
  it('includes every card, ignoring due dates and the new-card limit', () => {
    const cards = Array.from({ length: 5 }, (_, i) => card(`c${i}`))
    const q = practiceQueue({ ...deck('ko_en'), new_per_day: 0 }, cards, new Map())
    expect(q.length).toBe(5)
    expect(new Set(q)).toEqual(new Set(cards.map((c) => `${c.id}:fwd`)))
  })

  it('covers both directions for a two-way deck', () => {
    const q = practiceQueue(deck('both'), [card('a'), card('b')], new Map())
    expect(new Set(q)).toEqual(new Set(['a:fwd', 'a:rev', 'b:fwd', 'b:rev']))
  })
})
