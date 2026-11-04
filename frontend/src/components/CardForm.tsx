import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { db } from '../lib/db'
import { addCard, removeAcceptedAnswer, updateCard } from '../lib/repo'
import { isComposing, nfc } from '../lib/text'
import type { Card, CardSide } from '../lib/types'
import { Button, Field, Icon, imeGuard, inputClass } from './ui'

/**
 * Front / back / notes form for adding a card to `deckId`, or editing `card`. Used by the card
 * page and by the sheet on the study screen. `onDone` runs after Save (edit) or Save & close (add).
 */
export function CardForm({
  deckId,
  card,
  onDone,
}: {
  deckId: string
  card?: Card
  onDone: (saved: { id: string } | null) => void
}) {
  const deckFronts = useLiveQuery(
    async () =>
      (await db.cards.where('deck_id').equals(deckId).toArray())
        .filter((c) => !c.deleted_at && c.id !== card?.id)
        .map((c) => c.front),
    [deckId, card?.id],
  )

  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [notes, setNotes] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const loadedId = useRef<string | null>(null)
  const frontRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (card && loadedId.current !== card.id) {
      loadedId.current = card.id
      setFront(card.front)
      setBack(card.back)
      setNotes(card.notes)
    }
  }, [card])

  const isNew = !card
  const canSave = nfc(front) !== '' && nfc(back) !== ''
  const duplicate = nfc(front) !== '' && (deckFronts ?? []).includes(nfc(front))

  async function save(addAnother: boolean) {
    if (!canSave) return
    if (isNew) {
      const added = await addCard(deckId, { front, back, notes })
      if (addAnother) {
        setFront('')
        setBack('')
        setNotes('')
        setSavedCount((n) => n + 1)
        frontRef.current?.focus()
        return
      }
      onDone(added)
    } else {
      await updateCard(card.id, { front, back, notes })
      onDone(card)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void save(isNew)
  }

  // Enter in the front field moves to the back; Enter in the back saves.
  // Ignored while the IME is composing a syllable.
  function onFrontKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !isComposing(e)) {
      e.preventDefault()
      backRef.current?.focus()
    }
  }
  function onNotesKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isComposing(e)) {
      e.preventDefault()
      void save(isNew)
    }
  }

  return (
    <form onSubmit={onSubmit} onKeyDownCapture={imeGuard} className="flex flex-col gap-4">
      <Field label="Front" hint={duplicate ? '⚠ A card with this front already exists in this deck.' : undefined}>
        <input
          ref={frontRef}
          className={`${inputClass} hangul text-xl`}
          value={front}
          onChange={(e) => setFront(e.target.value)}
          onKeyDown={onFrontKey}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={2000}
        />
      </Field>
      <Field label="Back">
        <input
          ref={backRef}
          className={inputClass}
          value={back}
          onChange={(e) => setBack(e.target.value)}
          enterKeyHint={isNew ? 'next' : 'done'}
          autoComplete="off"
          maxLength={2000}
        />
      </Field>
      <Field label="Notes (optional)" hint="Example sentences, grammar notes, romanization…">
        <textarea
          className={`${inputClass} hangul min-h-24`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={onNotesKey}
          maxLength={5000}
        />
      </Field>

      {card && <AcceptedAnswers cardId={card.id} />}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" variant="primary" disabled={!canSave} className="sm:flex-1">
          {isNew ? 'Save & add another' : 'Save'}
        </Button>
        {isNew && (
          <Button disabled={!canSave} onClick={() => save(false)} className="sm:flex-1">
            Save & close
          </Button>
        )}
      </div>
      {savedCount > 0 && (
        <p className="text-center text-sm text-emerald-600 dark:text-emerald-400">
          {savedCount} card{savedCount === 1 ? '' : 's'} added
        </p>
      )}
    </form>
  )
}

/** Answers you marked as correct in Typing Mode, with a way to remove them. */
function AcceptedAnswers({ cardId }: { cardId: string }) {
  const card = useLiveQuery(() => db.cards.get(cardId), [cardId])
  const back = card?.accepted_back ?? []
  const front = card?.accepted_front ?? []
  if (!back.length && !front.length) return null
  const group = (label: string, side: CardSide, items: string[]) =>
    items.length > 0 && (
      <div>
        <div className="mb-1 text-xs text-slate-500">{label}</div>
        <ul className="flex flex-wrap gap-2">
          {items.map((a) => (
            <li
              key={a}
              className="hangul flex items-center gap-1 rounded-full bg-slate-100 py-1 pr-1 pl-3 text-sm dark:bg-slate-800"
            >
              {a}
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                aria-label={`Stop accepting “${a}”`}
                onClick={() => void removeAcceptedAnswer(cardId, side, a)}
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  return (
    <section className="flex flex-col gap-3">
      <div className="text-sm font-medium text-slate-600 dark:text-slate-300">Also accepted in Typing Mode</div>
      {group('For the back (Front → Back)', 'back', back)}
      {group('For the front (Back → Front)', 'front', front)}
    </section>
  )
}
