import { useEffect, useState } from 'react'

// Text-to-speech for the Korean side via the Web Speech API.
//
// Browsers don't say which voices are female, so voices are ranked by name: known
// female Korean voices first, known male ones last. A voice picked in Settings
// (stored per device) always wins.

/** Minimal shape of SpeechSynthesisVoice used here (keeps the picker testable). */
export interface VoiceLike {
  name: string
  lang: string
  voiceURI: string
  localService: boolean
}

// Apple: Yuna, Sora, Suhyun · Windows: Heami, SunHi · Amazon: Seoyeon · Chrome: "Google 한국의"
// · Android Google TTS: ko-kr-x-ism / -kob.
const FEMALE = /yuna|sora|suhyun|sun-?hi|heami|seoyeon|jimin|google|ko-kr-x-(ism|kob)|\bfemale\b|여성/i
// Apple: Minsu, Jian · Windows: InJoon, Hyunsu, BongJin, GookMin · Android: ko-kr-x-koc / -kod.
const MALE = /minsu|jian|injoon|hyunsu|bongjin|gookmin|ko-kr-x-(koc|kod)|\bmale\b|남성/i

export function isKorean(v: VoiceLike): boolean {
  return v.lang.replace('_', '-').toLowerCase().startsWith('ko')
}

export function voiceGender(v: VoiceLike): 'female' | 'male' | 'unknown' {
  if (FEMALE.test(v.name) || FEMALE.test(v.voiceURI)) return 'female'
  if (MALE.test(v.name) || MALE.test(v.voiceURI)) return 'male'
  return 'unknown'
}

/** Korean voices, best first: female, then unknown, then male; on-device before network. */
export function rankKoreanVoices<T extends VoiceLike>(voices: T[]): T[] {
  const score = (v: T) =>
    ({ female: 0, unknown: 1, male: 2 })[voiceGender(v)] * 10 +
    (v.lang === 'ko-KR' ? 0 : 1) * 2 +
    (v.localService ? 0 : 1)
  return voices.filter(isKorean).sort((a, b) => score(a) - score(b))
}

/** The chosen voice if it's still installed, otherwise the best-ranked one. */
export function pickKoreanVoice<T extends VoiceLike>(voices: T[], preferredURI: string | null): T | null {
  const ranked = rankKoreanVoices(voices)
  return ranked.find((v) => v.voiceURI === preferredURI) ?? ranked[0] ?? null
}

// ---------------------------------------------------------------------------
// Per-device preference
// ---------------------------------------------------------------------------

const PREF_KEY = 'fc_voice'
const listeners = new Set<() => void>()

export function getVoicePreference(): string | null {
  try {
    return localStorage.getItem(PREF_KEY)
  } catch {
    return null
  }
}

/** null = automatic (prefer a female voice). */
export function setVoicePreference(voiceURI: string | null) {
  try {
    if (voiceURI) localStorage.setItem(PREF_KEY, voiceURI)
    else localStorage.removeItem(PREF_KEY)
  } catch {
    /* storage unavailable */
  }
  for (const fn of listeners) fn()
}

function allVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices()
}

/** Korean voices on this device, best first (for the Settings picker). */
export function useKoreanVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState(() => rankKoreanVoices(allVoices()))
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const update = () => setVoices(rankKoreanVoices(allVoices()))
    update()
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return voices
}

/** Returns the Korean voice to use, or null if the device has none (the audio button is then hidden). */
export function useKoreanVoice(): SpeechSynthesisVoice | null {
  const find = () => pickKoreanVoice(allVoices(), getVoicePreference())
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(find)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    // Voices load asynchronously in most browsers (and iOS Safari).
    const update = () => setVoice(find())
    update()
    window.speechSynthesis.addEventListener('voiceschanged', update)
    listeners.add(update)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', update)
      listeners.delete(update)
    }
  }, [])
  return voice
}

export function speakKorean(text: string, voice: SpeechSynthesisVoice | null) {
  if (!voice || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  u.voice = voice
  u.rate = 0.9
  window.speechSynthesis.speak(u)
}
