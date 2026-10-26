/** Unicode NFC + trim. Applied before saving and when searching so Hangul typed on
 *  different devices (precomposed vs. decomposed jamo) compares equal. */
export function nfc(s: string): string {
  return s.normalize('NFC').trim()
}

/** Normalized, case-folded form used for search matching. */
export function searchKey(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function matchesQuery(query: string, ...fields: string[]): boolean {
  const q = searchKey(query)
  if (!q) return true
  return fields.some((f) => searchKey(f).includes(q))
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯ힰ-퟿]/

export function hasHangul(s: string): boolean {
  return HANGUL.test(s)
}

/**
 * True while an IME (e.g. the Korean keyboard) is composing a syllable.
 * Safari reports keyCode 229 for the Enter that ends composition even though
 * isComposing is already false, so check both.
 */
export function isComposing(e: { nativeEvent?: KeyboardEvent; isComposing?: boolean; keyCode?: number }): boolean {
  const ev = (e.nativeEvent ?? e) as KeyboardEvent
  return ev.isComposing === true || ev.keyCode === 229
}

export function uuid(): string {
  const c: Crypto = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  // randomUUID only exists in secure contexts (https/localhost); e.g. testing over a LAN IP.
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
