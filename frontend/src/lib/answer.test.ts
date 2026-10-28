import { describe, expect, it } from 'vitest'
import { acceptedAnswers, checkAnswer, editDistance, suggestedRating } from './answer'

describe('checkAnswer', () => {
  it('accepts exact answers regardless of case, punctuation and spacing', () => {
    expect(checkAnswer('hello', 'Hello')).toBe('correct')
    expect(checkAnswer('  im sorry ', "I'm sorry")).toBe('correct')
    expect(checkAnswer('its delicious!', "It's delicious")).toBe('correct')
  })

  it('accepts any of several meanings', () => {
    expect(checkAnswer('home', 'House, home')).toBe('correct')
    expect(checkAnswer('house', 'House, home')).toBe('correct')
    expect(checkAnswer('meal', 'Rice / meal')).toBe('correct')
    expect(checkAnswer('house, home', 'House, home')).toBe('correct')
  })

  it('treats parenthesized parts and leading to/a/the as optional', () => {
    expect(checkAnswer('eat', 'to eat')).toBe('correct')
    expect(checkAnswer('to eat', 'to eat')).toBe('correct')
    expect(checkAnswer('water', 'water (drink)')).toBe('correct')
    expect(checkAnswer('water drink', 'water (drink)')).toBe('correct')
    expect(checkAnswer('book', 'a book')).toBe('correct')
  })

  it('matches Hangul across NFC/NFD and ignores Korean spacing', () => {
    expect(checkAnswer('안녕하세요'.normalize('NFD'), '안녕하세요')).toBe('correct')
    expect(checkAnswer('감사 합니다', '감사합니다')).toBe('correct')
    expect(checkAnswer('잘지내요', '잘 지내요')).toBe('correct')
  })

  it('counts a small typo as close', () => {
    expect(checkAnswer('teacher', 'Teacher')).toBe('correct')
    expect(checkAnswer('techer', 'Teacher')).toBe('close')
    expect(checkAnswer('학꾜', '학교')).toBe('close') // one jamo off
    expect(checkAnswer('studnet', 'Student')).toBe('close')
  })

  it('does not allow typos on very short answers', () => {
    expect(checkAnswer('no', 'Yes')).toBe('wrong')
    expect(checkAnswer('물', '불')).toBe('wrong')
  })

  it('marks blank and unrelated answers wrong', () => {
    expect(checkAnswer('', 'Water')).toBe('wrong')
    expect(checkAnswer('   ', 'Water')).toBe('wrong')
    expect(checkAnswer('fire', 'Water')).toBe('wrong')
  })
})

describe('helpers', () => {
  it('lists accepted forms', () => {
    expect(acceptedAnswers('to eat (food)')).toEqual(expect.arrayContaining(['toeatfood', 'toeat', 'eat']))
  })

  it('measures edit distance on Hangul jamo', () => {
    expect(editDistance('학교', '학교')).toBe(0)
    expect(editDistance('학교', '학꾜')).toBe(1)
    expect(editDistance('abc', 'abd')).toBe(1)
  })

  it('suggests Good / Hard / Again', () => {
    expect(suggestedRating('correct')).toBe(3)
    expect(suggestedRating('close')).toBe(2)
    expect(suggestedRating('wrong')).toBe(1)
  })
})
