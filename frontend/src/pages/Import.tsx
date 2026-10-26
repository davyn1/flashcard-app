import { useMemo, useState } from 'react'
import { Button, Field, Page, inputClass } from '../components/ui'
import { parseImport, separatorString, type SeparatorChoice } from '../lib/importText'
import { addCards } from '../lib/repo'
import { navigate } from '../lib/router'

const CHOICES: { value: SeparatorChoice; label: string }[] = [
  { value: 'tab', label: 'Tab' },
  { value: 'dash', label: '" - "' },
  { value: 'comma', label: 'Comma' },
  { value: 'custom', label: 'Custom' },
]

export default function Import({ deckId }: { deckId: string }) {
  const [text, setText] = useState('')
  const [choice, setChoice] = useState<SeparatorChoice>('tab')
  const [custom, setCustom] = useState(';')
  const [busy, setBusy] = useState(false)

  const result = useMemo(() => parseImport(text, separatorString(choice, custom)), [text, choice, custom])

  async function doImport() {
    if (!result.cards.length) return
    setBusy(true)
    await addCards(deckId, result.cards)
    navigate(`/deck/${deckId}`)
  }

  return (
    <Page title="Import cards" back={`/deck/${deckId}`}>
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-300">
            Between term and definition
          </legend>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((c) => (
              <label
                key={c.value}
                className={`flex min-h-11 cursor-pointer items-center rounded-xl px-4 ring-1 ${
                  choice === c.value
                    ? 'bg-indigo-600 text-white ring-indigo-600'
                    : 'bg-white ring-slate-300 dark:bg-slate-900 dark:ring-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="sep"
                  className="sr-only"
                  checked={choice === c.value}
                  onChange={() => setChoice(c.value)}
                />
                {c.label}
              </label>
            ))}
            {choice === 'custom' && (
              <input
                className={`${inputClass} w-24`}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="Custom separator"
              />
            )}
          </div>
        </fieldset>

        <Field
          label="Paste your cards"
          hint="One card per line: Korean, separator, English. An optional third column becomes the notes. Copy from a spreadsheet to get tabs."
        >
          <textarea
            className={`${inputClass} hangul min-h-56 font-mono text-sm`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={choice === 'dash' ? '사과 - apple\n바나나 - banana' : '사과\tapple\n바나나\tbanana'}
            spellCheck={false}
          />
        </Field>

        {text.trim() && (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="font-medium">
              {result.cards.length} card{result.cards.length === 1 ? '' : 's'} ready
              {result.skipped.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}
                  · {result.skipped.length} line{result.skipped.length === 1 ? '' : 's'} skipped (
                  {result.skipped.slice(0, 8).join(', ')}
                  {result.skipped.length > 8 ? '…' : ''})
                </span>
              )}
            </p>
            <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {result.cards.slice(0, 5).map((c, i) => (
                <li key={i} className="flex gap-3 py-1.5">
                  <span className="hangul w-1/2 truncate font-medium">{c.front}</span>
                  <span className="w-1/2 truncate text-slate-600 dark:text-slate-400">{c.back}</span>
                </li>
              ))}
              {result.cards.length > 5 && <li className="py-1.5 text-slate-500">…and {result.cards.length - 5} more</li>}
            </ul>
          </div>
        )}

        <Button variant="primary" disabled={!result.cards.length || busy} onClick={doImport}>
          Import {result.cards.length || ''} cards
        </Button>
      </div>
    </Page>
  )
}
