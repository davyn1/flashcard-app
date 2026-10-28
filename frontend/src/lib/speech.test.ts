import { describe, expect, it } from 'vitest'
import { pickKoreanVoice, rankKoreanVoices, voiceGender, type VoiceLike } from './speech'

const v = (name: string, lang = 'ko-KR', localService = true): VoiceLike => ({
  name,
  lang,
  localService,
  voiceURI: `uri:${name}`,
})

describe('voiceGender', () => {
  it('recognizes common female and male Korean voices by name', () => {
    expect(voiceGender(v('Yuna'))).toBe('female')
    expect(voiceGender(v('Yuna (Enhanced)'))).toBe('female')
    expect(voiceGender(v('Microsoft Heami - Korean (Korean)'))).toBe('female')
    expect(voiceGender(v('Microsoft SunHi Online (Natural) - Korean (Korea)'))).toBe('female')
    expect(voiceGender(v('Google 한국의'))).toBe('female')
    expect(voiceGender(v('Minsu'))).toBe('male')
    expect(voiceGender(v('Microsoft InJoon Online (Natural) - Korean (Korea)'))).toBe('male')
    expect(voiceGender(v('Korean Female'))).toBe('female')
    expect(voiceGender(v('Korean Male'))).toBe('male')
    expect(voiceGender(v('Some Voice'))).toBe('unknown')
  })
})

describe('rankKoreanVoices / pickKoreanVoice', () => {
  const voices = [v('Samantha', 'en-US'), v('Minsu'), v('Mystery'), v('Yuna', 'ko-KR', false), v('Yuna (Enhanced)')]

  it('drops non-Korean voices and puts female first, male last', () => {
    expect(rankKoreanVoices(voices).map((x) => x.name)).toEqual(['Yuna (Enhanced)', 'Yuna', 'Mystery', 'Minsu'])
  })

  it('picks a female voice automatically', () => {
    expect(pickKoreanVoice(voices, null)?.name).toBe('Yuna (Enhanced)')
  })

  it('uses the chosen voice when installed, otherwise falls back', () => {
    expect(pickKoreanVoice(voices, 'uri:Mystery')?.name).toBe('Mystery')
    expect(pickKoreanVoice(voices, 'uri:Removed')?.name).toBe('Yuna (Enhanced)')
  })

  it('still speaks with a male voice if that is the only Korean voice', () => {
    expect(pickKoreanVoice([v('Minsu')], null)?.name).toBe('Minsu')
    expect(pickKoreanVoice([v('Samantha', 'en-US')], null)).toBeNull()
  })
})
