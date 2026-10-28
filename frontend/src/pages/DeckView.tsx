import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Button, Icon, Page, Stat, inputClass } from '../components/ui'
import { db } from '../lib/db'
import { deckCards, statesForCards } from '../lib/repo'
import { navigate } from '../lib/router'
import { maturity } from '../lib/scheduler'
import { summarizeDeck } from '../lib/study'
import { matchesQuery } from '../lib/text'
import { dirsFor, stateId, toScheduling } from '../lib/types'

const badge = {
  new: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  learning: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  mature: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
}

export default function DeckView({ deckId }: { deckId: string }) {
  const [query, setQuery] = useState('')
  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(deckId)
    if (!deck || deck.deleted_at) return { deck: null }
    const cards = await deckCards(deckId)
    const states = await statesForCards(cards.map((c) => c.id))
    return { deck, cards, states, summary: summarizeDeck(deck, cards, states, Date.now()) }
  }, [deckId])

  if (!data) return null
  if (!data.deck) return <NotFound />
  const { deck, cards, states, summary } = data
  const dirs = dirsFor(deck.direction)
  const visible = cards.filter((c) => matchesQuery(query, c.front, c.back, c.notes))

  return (
    <Page
      title={deck.name}
      back="/"
      actions={
        <>
          <a href={`#/deck/${deck.id}/stats`} className="tap-icon" aria-label="Statistics">
            <Icon name="chart" />
          </a>
          <a href={`#/deck/${deck.id}/settings`} className="tap-icon" aria-label="Deck settings">
            <Icon name="gear" />
          </a>
        </>
      }
    >
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="grid grid-cols-3">
          <Stat label="Due" value={summary.due} tone="text-sky-600 dark:text-sky-400" />
          <Stat label="New today" value={summary.new} tone="text-emerald-600 dark:text-emerald-400" />
          <Stat label="Total" value={summary.total} />
        </div>
        {summary.due + summary.new === 0 ? (
          <p className="mt-4 text-center font-medium text-slate-500">All done for today 🎉</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="primary" className="h-14 text-lg" onClick={() => navigate(`/deck/${deck.id}/study`)}>
              <Icon name="cards" /> Flashcards
            </Button>
            <Button variant="primary" className="h-14 text-lg" onClick={() => navigate(`/deck/${deck.id}/type`)}>
              <Icon name="keyboard" /> Typing Mode
            </Button>
          </div>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={() => navigate(`/deck/${deck.id}/new`)}>
          <Icon name="plus" /> Add card
        </Button>
        <Button onClick={() => navigate(`/deck/${deck.id}/import`)}>
          <Icon name="upload" /> Import
        </Button>
      </div>

      <div className="relative mt-4">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          className={`${inputClass} pl-10`}
          placeholder={`Search ${cards.length} cards…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search cards in this deck"
        />
      </div>

      <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
        {visible.length === 0 && (
          <li className="p-4 text-slate-500">{cards.length ? 'No matching cards.' : 'No cards yet.'}</li>
        )}
        {visible.map((c) => {
          const rec = states.get(stateId(c.id, dirs[0]))
          const m = maturity(rec ? toScheduling(rec) : null)
          return (
            <li key={c.id}>
              <a
                href={`#/card/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="hangul truncate text-lg font-medium">{c.front}</div>
                  <div className="truncate text-slate-600 dark:text-slate-400">{c.back}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[m]}`}>{m}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </Page>
  )
}

export function NotFound() {
  return (
    <Page title="Not found" back="/">
      <p className="py-10 text-center text-slate-500">This deck or card doesn't exist (it may have been deleted).</p>
    </Page>
  )
}
