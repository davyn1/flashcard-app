import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Page } from '../components/ui'
import { db } from '../lib/db'
import { deckCards, statesForCards } from '../lib/repo'
import { isStruggling, maturity, startOfDay } from '../lib/scheduler'
import { dirsFor, stateId, toScheduling, type Card, type CardStateRecord } from '../lib/types'
import { NotFound } from './DeckView'

const DAYS = 30
const DAY = 86_400_000

// Validated (dataviz validate_palette): light indigo-600/orange-500, dark indigo-500/orange-600.
const REMEMBERED = 'bg-indigo-600 dark:bg-indigo-500'
const AGAIN = 'bg-orange-500 dark:bg-orange-600'

interface DayBucket {
  start: number
  remembered: number
  again: number
}

export default function Stats({ deckId }: { deckId: string }) {
  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(deckId)
    if (!deck || deck.deleted_at) return { deck: null }
    const cards = await deckCards(deckId)
    const states = await statesForCards(cards.map((c) => c.id))
    const reviews = await db.reviews.where('deck_id').equals(deckId).toArray()
    return { deck, cards, states, reviews }
  }, [deckId])

  if (!data) return null
  if (!data.deck) return <NotFound />
  const { deck, cards, states, reviews } = data

  // Cards by state, counting each studied direction as its own card.
  const dirs = dirsFor(deck.direction)
  const counts = { new: 0, learning: 0, mature: 0 }
  for (const c of cards) for (const d of dirs) {
    const rec = states.get(stateId(c.id, d))
    counts[maturity(rec ? toScheduling(rec) : null)]++
  }

  // Review history, last 30 days (local days).
  const today = startOfDay(Date.now())
  const buckets: DayBucket[] = Array.from({ length: DAYS }, (_, i) => ({
    start: today - (DAYS - 1 - i) * DAY,
    remembered: 0,
    again: 0,
  }))
  for (const r of reviews) {
    const idx = Math.floor((startOfDay(r.reviewed_at) - buckets[0].start) / DAY + 0.5)
    if (idx < 0 || idx >= DAYS) continue
    if (r.rating === 1) buckets[idx].again++
    else buckets[idx].remembered++
  }
  const total30 = buckets.reduce((n, b) => n + b.remembered + b.again, 0)
  const remembered30 = buckets.reduce((n, b) => n + b.remembered, 0)

  // Struggling: many lapses or low ease (either direction).
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const struggling = [...states.values()]
    .filter((s) => cardById.has(s.card_id) && isStruggling(toScheduling(s)))
    .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease)

  return (
    <Page title={`${deck.name} · Stats`} back={`/deck/${deckId}`}>
      <div className="flex flex-col gap-4">
        <section className="grid grid-cols-3 gap-3 text-center">
          <Tile label="New" value={counts.new} />
          <Tile label="Learning" value={counts.learning} />
          <Tile label="Mature" value={counts.mature} hint="interval ≥ 21 days" />
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Reviews, last 30 days</h2>
            <span className="text-sm text-slate-500">
              {total30} reviews
              {total30 > 0 && ` · ${Math.round((remembered30 / total30) * 100)}% remembered`}
            </span>
          </div>
          <HistoryChart buckets={buckets} />
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="font-semibold">Struggling cards</h2>
          <p className="mb-2 text-xs text-slate-500">Forgotten 3+ times, or ease at 2.0 or below.</p>
          {struggling.length === 0 ? (
            <p className="py-3 text-slate-500">None — nice work.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {struggling.map((s) => (
                <StrugglingRow key={s.id} card={cardById.get(s.card_id)!} state={s} showDir={dirs.length > 1} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  )
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800" title={hint}>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

function StrugglingRow({ card, state, showDir }: { card: Card; state: CardStateRecord; showDir: boolean }) {
  return (
    <li>
      <a href={`#/card/${card.id}`} className="flex items-center gap-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="hangul truncate text-lg font-medium">{card.front}</div>
          <div className="truncate text-sm text-slate-600 dark:text-slate-400">
            {card.back}
            {showDir && <span className="text-slate-400"> · {state.direction === 'fwd' ? 'Front→Back' : 'Back→Front'}</span>}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500 tabular-nums">
          <div>{state.lapses} lapses</div>
          <div>ease {state.ease.toFixed(2)}</div>
        </div>
      </a>
    </li>
  )
}

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function HistoryChart({ buckets }: { buckets: DayBucket[] }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...buckets.map((b) => b.remembered + b.again))
  const shown = active ?? buckets.length - 1
  const b = buckets[shown]

  return (
    <div className="mt-3">
      {/* Readout doubles as the hover tooltip (stays inside the card on phones). */}
      <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-live="polite">
        <span className="font-medium text-slate-800 dark:text-slate-200">{fmtDay(b.start)}</span>
        <Legend swatch={REMEMBERED} label="Remembered" value={b.remembered} />
        <Legend swatch={AGAIN} label="Again" value={b.again} />
      </div>

      <div className="relative h-36" onMouseLeave={() => setActive(null)}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200 dark:border-slate-800" />
        <span className="absolute top-0 right-0 -translate-y-full pb-0.5 text-[10px] text-slate-400 tabular-nums">{max}</span>
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-slate-300 dark:border-slate-700">
          {buckets.map((d, i) => {
            const total = d.remembered + d.again
            return (
              <button
                key={d.start}
                type="button"
                className={`flex h-full min-w-0 flex-1 flex-col justify-end gap-[2px] rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active === i ? 'bg-slate-100 dark:bg-slate-800/60' : ''
                }`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                aria-label={`${fmtDay(d.start)}: ${d.remembered} remembered, ${d.again} again`}
              >
                {d.again > 0 && (
                  <div className={`w-full rounded-t-[4px] ${AGAIN}`} style={{ height: `${(d.again / max) * 100}%` }} />
                )}
                {d.remembered > 0 && (
                  <div
                    className={`w-full ${d.again > 0 ? '' : 'rounded-t-[4px]'} ${REMEMBERED}`}
                    style={{ height: `${(d.remembered / max) * 100}%` }}
                  />
                )}
                {total === 0 && <div className="h-0" />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{fmtDay(buckets[0].start)}</span>
        <span>{fmtDay(buckets[Math.floor(buckets.length / 2)].start)}</span>
        <span>Today</span>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-500">Show as table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Remembered</th>
              <th className="py-1 text-right font-medium">Again</th>
            </tr>
          </thead>
          <tbody>
            {buckets
              .filter((d) => d.remembered + d.again > 0)
              .reverse()
              .map((d) => (
                <tr key={d.start} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">{fmtDay(d.start)}</td>
                  <td className="py-1 text-right">{d.remembered}</td>
                  <td className="py-1 text-right">{d.again}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
      <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} />
      {label} <span className="font-medium text-slate-800 tabular-nums dark:text-slate-200">{value}</span>
    </span>
  )
}
