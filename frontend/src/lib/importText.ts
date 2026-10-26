import { nfc } from './text'

export type SeparatorChoice = 'tab' | 'dash' | 'comma' | 'custom'

export function separatorString(choice: SeparatorChoice, custom = ''): string {
  switch (choice) {
    case 'tab':
      return '\t'
    case 'dash':
      return ' - '
    case 'comma':
      return ','
    case 'custom':
      return custom
  }
}

export interface ParsedCard {
  front: string
  back: string
  notes: string
}

export interface ParseResult {
  cards: ParsedCard[]
  /** 1-based line numbers that couldn't be parsed. */
  skipped: number[]
}

/**
 * Parse Quizlet-style pasted text: one card per line, "front<sep>back[<sep>notes]".
 * Everything after a second separator becomes the notes. Blank lines are ignored;
 * lines without a separator (or with an empty side) are reported in `skipped`.
 */
export function parseImport(text: string, separator: string): ParseResult {
  const cards: ParsedCard[] = []
  const skipped: number[] = []
  if (!separator) return { cards, skipped }
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((raw, i) => {
    if (!raw.trim()) return
    const parts = raw.split(separator)
    if (parts.length < 2) {
      skipped.push(i + 1)
      return
    }
    const front = nfc(parts[0])
    const back = nfc(parts[1])
    const notes = nfc(parts.slice(2).join(separator))
    if (!front || !back) {
      skipped.push(i + 1)
      return
    }
    cards.push({ front, back, notes })
  })
  return { cards, skipped }
}
