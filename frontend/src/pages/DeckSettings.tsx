import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Field, Page, imeGuard, inputClass } from '../components/ui'
import { db } from '../lib/db'
import { deleteDeck, updateDeck } from '../lib/repo'
import { navigate } from '../lib/router'
import type { StudyDirection } from '../lib/types'
import { NotFound } from './DeckView'

export default function DeckSettings({ deckId }: { deckId: string }) {
  const deck = useLiveQuery(async () => (await db.decks.get(deckId)) ?? null, [deckId])
  const [name, setName] = useState('')
  const [direction, setDirection] = useState<StudyDirection>('ko_en')
  const [newPerDay, setNewPerDay] = useState('20')
  const [autoplay, setAutoplay] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (deck && !loaded) {
      setName(deck.name)
      setDirection(deck.direction)
      setNewPerDay(String(deck.new_per_day))
      setAutoplay(deck.autoplay_audio)
      setLoaded(true)
    }
  }, [deck, loaded])

  if (deck === undefined) return null
  if (deck === null || deck.deleted_at) return <NotFound />

  async function save(e: FormEvent) {
    e.preventDefault()
    await updateDeck(deckId, {
      name,
      direction,
      new_per_day: Number.parseInt(newPerDay, 10) || 0,
      autoplay_audio: autoplay,
    })
    navigate(`/deck/${deckId}`)
  }

  async function remove() {
    if (!confirm(`Delete the deck "${deck!.name}" and all its cards?`)) return
    await deleteDeck(deckId)
    navigate('/')
  }

  return (
    <Page title="Deck settings" back={`/deck/${deckId}`}>
      <form onSubmit={save} onKeyDownCapture={imeGuard} className="flex flex-col gap-5">
        <Field label="Name">
          <input className={`${inputClass} hangul`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field
          label="Study direction"
          hint="Mixed asks a random side each time and keeps one schedule per card. Both directions makes each side its own card with its own schedule."
        >
          <select
            className={inputClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value as StudyDirection)}
          >
            <option value="ko_en">Front → Back</option>
            <option value="en_ko">Back → Front</option>
            <option value="mixed">Mixed (random side each time)</option>
            <option value="both">Both directions (separate cards)</option>
          </select>
        </Field>
        <Field label="New cards per day">
          <input
            className={inputClass}
            type="number"
            inputMode="numeric"
            min={0}
            max={9999}
            value={newPerDay}
            onChange={(e) => setNewPerDay(e.target.value)}
          />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Auto-play audio on flip</span>
            <span className="block text-xs text-slate-500">Speaks the Korean text on the card when it is flipped.</span>
          </span>
          <input
            type="checkbox"
            className="h-6 w-6 accent-indigo-600"
            checked={autoplay}
            onChange={(e) => setAutoplay(e.target.checked)}
          />
        </label>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </form>

      <div className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
        <Button variant="danger" className="w-full" onClick={remove}>
          Delete deck
        </Button>
      </div>
    </Page>
  )
}
