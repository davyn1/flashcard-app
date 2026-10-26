import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { SyncIndicator } from '../components/SyncIndicator'
import { Button, Field, Icon, Modal, Page, imeGuard, inputClass } from '../components/ui'
import { db } from '../lib/db'
import { createDeck } from '../lib/repo'
import { navigate } from '../lib/router'
import { summarizeDeck } from '../lib/study'
import { matchesQuery } from '../lib/text'

export default function Home() {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const data = useLiveQuery(async () => {
    const [decks, cards, states] = await Promise.all([db.decks.toArray(), db.cards.toArray(), db.card_states.toArray()])
    const live = decks.filter((d) => !d.deleted_at).sort((a, b) => a.created_at - b.created_at)
    const liveCards = cards.filter((c) => !c.deleted_at)
    const stateMap = new Map(states.filter((s) => !s.deleted_at).map((s) => [s.id, s]))
    const now = Date.now()
    return {
      decks: live.map((deck) => {
        const deckCards = liveCards.filter((c) => c.deck_id === deck.id)
        return { deck, summary: summarizeDeck(deck, deckCards, stateMap, now) }
      }),
      cards: liveCards,
      deckNames: new Map(live.map((d) => [d.id, d.name])),
    }
  })

  const results =
    query.trim() && data
      ? data.cards
          .filter((c) => data.deckNames.has(c.deck_id) && matchesQuery(query, c.front, c.back, c.notes))
          .slice(0, 100)
      : null

  return (
    <Page
      title="Decks"
      actions={
        <>
          <SyncIndicator />
          <a href="#/settings" className="tap-icon" aria-label="Settings">
            <Icon name="gear" />
          </a>
        </>
      }
    >
      <div className="relative mb-4">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          className={`${inputClass} pl-10`}
          placeholder="Search Korean or English…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search all cards"
        />
      </div>

      {results ? (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
          {results.length === 0 && <li className="p-4 text-slate-500">No matching cards.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <a href={`#/card/${c.id}`} className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
                <div className="hangul text-lg font-medium">{c.front}</div>
                <div className="text-slate-600 dark:text-slate-400">{c.back}</div>
                <div className="mt-0.5 text-xs text-slate-400">{data?.deckNames.get(c.deck_id)}</div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data?.decks.map(({ deck, summary }) => (
              <li
                key={deck.id}
                className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
              >
                <a href={`#/deck/${deck.id}`} className="min-w-0 flex-1">
                  <div className="hangul truncate text-lg font-semibold">{deck.name}</div>
                  <div className="mt-1 flex gap-3 text-sm">
                    <span className="font-medium text-sky-600 dark:text-sky-400">{summary.due} due</span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{summary.new} new</span>
                    <span className="text-slate-500">{summary.total} cards</span>
                  </div>
                </a>
                <Button
                  variant={summary.due + summary.new > 0 ? 'primary' : 'secondary'}
                  disabled={summary.due + summary.new === 0}
                  onClick={() => navigate(`/deck/${deck.id}/study`)}
                >
                  Study
                </Button>
              </li>
            ))}
          </ul>
          {data && data.decks.length === 0 && (
            <p className="py-10 text-center text-slate-500">No decks yet. Create one to get started.</p>
          )}
          <Button variant="secondary" className="mt-4 w-full" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New deck
          </Button>
        </>
      )}

      <NewDeckModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  )
}

function NewDeckModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const deck = await createDeck(name)
    setName('')
    onClose()
    navigate(`/deck/${deck.id}`)
  }
  return (
    <Modal open={open} onClose={onClose} title="New deck">
      <form onSubmit={submit} onKeyDownCapture={imeGuard} className="flex flex-col gap-4">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  )
}
