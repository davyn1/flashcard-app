import { useEffect, useState } from 'react'

// Text-to-speech for the Korean side via the Web Speech API.

function findKoreanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang === 'ko-KR' && v.localService) ??
    voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ko')) ??
    null
  )
}

/** Returns the Korean voice, or null if the device has none (the audio button is then hidden). */
export function useKoreanVoice(): SpeechSynthesisVoice | null {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(findKoreanVoice)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    // Voices load asynchronously in most browsers (and iOS Safari).
    const update = () => setVoice(findKoreanVoice())
    update()
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
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
