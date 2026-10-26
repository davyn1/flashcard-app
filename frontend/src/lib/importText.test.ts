import { describe, expect, it } from 'vitest'
import { parseImport, separatorString } from './importText'
import { hasHangul, isComposing, matchesQuery, nfc } from './text'

describe('parseImport', () => {
  it('parses tab-separated lines (Quizlet / spreadsheet paste)', () => {
    const r = parseImport('사과\tapple\n바나나\tbanana\tnotes here\r\n', '\t')
    expect(r.cards).toEqual([
      { front: '사과', back: 'apple', notes: '' },
      { front: '바나나', back: 'banana', notes: 'notes here' },
    ])
    expect(r.skipped).toEqual([])
  })

  it('parses " - " separated lines and keeps hyphens inside words', () => {
    const r = parseImport('안녕 - hi\n잘 지내요 - I am well - re-greeting', ' - ')
    expect(r.cards[0]).toEqual({ front: '안녕', back: 'hi', notes: '' })
    expect(r.cards[1]).toEqual({ front: '잘 지내요', back: 'I am well', notes: 're-greeting' })
  })

  it('skips blank lines silently and reports unparseable ones', () => {
    const r = parseImport('a,b\n\nno separator\n,missing front\nc,d', ',')
    expect(r.cards.map((c) => c.front)).toEqual(['a', 'c'])
    expect(r.skipped).toEqual([3, 4])
  })

  it('normalizes to NFC', () => {
    const r = parseImport(`${'물'.normalize('NFD')}\twater`, '\t')
    expect(r.cards[0].front).toBe('물')
  })

  it('supports a custom separator and ignores an empty one', () => {
    expect(parseImport('a;b', separatorString('custom', ';')).cards).toHaveLength(1)
    expect(parseImport('a;b', '').cards).toHaveLength(0)
  })
})

describe('text helpers', () => {
  it('matches Korean or English regardless of normalization and case', () => {
    expect(matchesQuery('물', '물'.normalize('NFD'), 'water')).toBe(true)
    expect(matchesQuery('WAT', '물', 'water')).toBe(true)
    expect(matchesQuery('불', '물', 'water')).toBe(false)
    expect(matchesQuery('  ', 'anything')).toBe(true)
  })

  it('detects Hangul', () => {
    expect(hasHangul('hello 안녕')).toBe(true)
    expect(hasHangul('hello')).toBe(false)
  })

  it('detects IME composition, including Safari keyCode 229', () => {
    expect(isComposing({ isComposing: true })).toBe(true)
    expect(isComposing({ keyCode: 229 })).toBe(true)
    expect(isComposing({ isComposing: false, keyCode: 13 })).toBe(false)
  })

  it('nfc trims and normalizes', () => {
    expect(nfc(' 한 '.normalize('NFD'))).toBe('한')
  })
})
