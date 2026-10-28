/**
 * Checking a typed answer against the card. Pure functions so they're easy to test.
 *
 * Lenient on things that don't matter (case, punctuation, spacing, NFC vs NFD Hangul,
 * a leading "to"/"a"/"the", parenthesized extras) and accepts any of several meanings
 * separated by , ; or /. One small typo counts as "close".
 */
import type { Rating } from './scheduler'

export type AnswerResult = 'correct' | 'close' | 'wrong'

const PUNCT = /[.,!?;:'"’‘“”~…·\-–—_*()[\]{}]/g

function canon(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase().replace(PUNCT, ' ').replace(/\s+/g, ' ').trim()
}

/** Spaces removed too: Korean spacing (띄어쓰기) is easy to get wrong and rarely the point. */
function compact(s: string): string {
  return canon(s).replace(/ /g, '')
}

/** All accepted forms of the expected answer. */
export function acceptedAnswers(expected: string): string[] {
  const out = new Set<string>()
  const add = (v: string) => {
    const c = compact(v)
    if (c) out.add(c)
  }
  const alts = [expected, ...expected.split(/[,;/]/)]
  for (const alt of alts) {
    const withoutParens = alt.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    for (const v of [alt, withoutParens]) {
      add(v)
      const c = canon(v)
      const m = /^(to|a|an|the) (.+)$/.exec(c)
      if (m) add(m[2])
    }
  }
  return [...out]
}

/**
 * Edit distance where a swapped pair of letters counts as one typo (optimal string
 * alignment), measured on decomposed Hangul jamo so one wrong vowel counts as one typo.
 */
export function editDistance(a: string, b: string): number {
  const x = [...a.normalize('NFD')]
  const y = [...b.normalize('NFD')]
  const d = Array.from({ length: x.length + 1 }, (_, i) =>
    Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[x.length][y.length]
}

function typoAllowance(answer: string): number {
  const n = [...answer.normalize('NFD')].length
  return n >= 8 ? 2 : n >= 4 ? 1 : 0
}

/** `extra` = answers you marked as correct before; they get the same leniency. */
export function checkAnswer(typed: string, expected: string, extra: string[] = []): AnswerResult {
  const t = compact(typed)
  if (!t) return 'wrong'
  const accepted = [expected, ...extra].flatMap(acceptedAnswers)
  if (accepted.includes(t)) return 'correct'
  if (accepted.some((a) => editDistance(t, a) <= typoAllowance(a))) return 'close'
  return 'wrong'
}

/** The rating pre-selected after checking; you can still pick another. */
export function suggestedRating(result: AnswerResult): Rating {
  return result === 'correct' ? 3 : result === 'close' ? 2 : 1
}
