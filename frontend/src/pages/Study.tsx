import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Icon, imeGuard, inputClass } from '../components/ui'
import { checkAnswer, suggestedRating, type AnswerResult } from '../lib/answer'
import { db } from '../lib/db'
import { addAcceptedAnswer, deckCards, recordReview, statesForCards } from '../lib/repo'
import { navigate } from '../lib/router'
import {
  RATING_LABELS,
  advanceQueue,
  formatDelay,
  newState,
  previewDelays,
  review,
  type Rating,
} from '../lib/scheduler'
import { speakKorean, useKoreanVoice } from '../lib/speech'
import { practiceQueue, sessionQueue, shownDirection } from '../lib/study'
import { hasHangul, isComposing } from '../lib/text'
import {
  answerSide,
  fromScheduling,
  toScheduling,
  type AnswerMode,
  type Card,
  type CardDir,
  type CardStateRecord,
  type Deck,
} from '../lib/types'

interface Session {
  deck: Deck
  cards: Map<string, Card>
  states: Map<string, CardStateRecord>
  queue: string[]
  /** No cards were due, so this is a free practice run that must not touch the schedule. */
  practice: boolean
}

interface LogEntry {
  key: string
  rating: Rating
  /** The side that was asked (differs from the key's direction only on Mixed decks). */
  shown: CardDir
}

function parseKey(key: string): { cardId: string; dir: CardDir } {
  const i = key.lastIndexOf(':')
  return { cardId: key.slice(0, i), dir: key.slice(i + 1) as CardDir }
}

/** Shrink long text so it still fits on the card face. */
function faceSize(text: string): string {
  const n = [...text].length
  if (n <= 6) return 'text-6xl sm:text-7xl'
  if (n <= 14) return 'text-5xl sm:text-6xl'
  if (n <= 32) return 'text-3xl sm:text-4xl'
  return 'text-2xl'
}

function answerSize(text: string): string {
  const n = [...text].length
  if (n <= 14) return 'text-4xl'
  if (n <= 32) return 'text-2xl sm:text-3xl'
  return 'text-xl'
}

const ratingStyle: Record<Rating, string> = {
  1: 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700',
  2: 'bg-amber-500 hover:bg-amber-400 active:bg-amber-600',
  3: 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700',
  4: 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700',
}

/** mode: flip = classic flashcards; type = type a guess, the app checks it. */
export default function Study({ deckId, mode }: { deckId: string; mode: AnswerMode }) {
  const [session, setSession] = useState<Session | null | 'missing'>(null)
  const [flipped, setFlipped] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  // Typing mode: what was typed and how it compared to the answer (null until checked).
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<AnswerResult | null>(null)
  /** You overrode the checker and saved your answer as correct for this card. */
  const [savedAnswer, setSavedAnswer] = useState(false)
  // Bumped by "Practice again" to start a fresh session over the same deck.
  const [runId, setRunId] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const voice = useKoreanVoice()

  // Snapshot the deck when the session starts; background syncs won't reshuffle the queue.
  useEffect(() => {
    let cancelled = false
    setSession(null)
    setLog([])
    setFlipped(false)
    setTyped('')
    setResult(null)
    setSavedAnswer(false)
    ;(async () => {
      const deck = await db.decks.get(deckId)
      if (!deck || deck.deleted_at) {
        if (!cancelled) setSession('missing')
        return
      }
      const cards = await deckCards(deckId)
      const states = await statesForCards(cards.map((c) => c.id))
      const due = sessionQueue(deck, cards, states, Date.now())
      // Nothing due: fall back to a practice run over the whole deck. Ratings in a practice
      // session don't reschedule, so the spaced-repetition schedule is left untouched.
      const practice = due.length === 0
      const queue = practice ? practiceQueue(deck, cards, states) : due
      if (!cancelled) setSession({ deck, cards: new Map(cards.map((c) => [c.id, c])), states, queue, practice })
    })()
    return () => {
      cancelled = true
    }
  }, [deckId, runId])

  const s = session && session !== 'missing' ? session : null
  const currentKey = s?.queue[0]
  const current = currentKey ? parseKey(currentKey) : null
  const card = current ? s?.cards.get(current.cardId) : undefined

  // `current.dir` is the schedule being reviewed; `shown` is the side actually asked
  // (they differ only on Mixed decks).
  const shown =
    current && s
      ? shownDirection(
          s.deck.direction,
          current.dir,
          current.cardId,
          log.length,
          log.map((l) => l.shown),
        )
      : 'fwd'
  const prompt = card ? (shown === 'fwd' ? card.front : card.back) : ''
  const answer = card ? (shown === 'fwd' ? card.back : card.front) : ''
  const side = answerSide(shown)
  const extraAnswers = (card && (side === 'front' ? card.accepted_front : card.accepted_back)) ?? []
  const koreanText = card ? (hasHangul(card.front) ? card.front : hasHangul(card.back) ? card.back : null) : null
  const koreanVisible = !!koreanText && (flipped || hasHangul(prompt))
  const typeMode = mode === 'type'
  const practice = s?.practice ?? false

  const flip = useCallback(() => {
    if (!card || flipped) return
    setFlipped(true)
    if (s?.deck.autoplay_audio && koreanText) speakKorean(koreanText, voice)
  }, [card, flipped, s, koreanText, voice])

  const check = useCallback(() => {
    if (!card || flipped || !typed.trim()) return
    setResult(checkAnswer(typed, answer, extraAnswers))
    flip()
  }, [card, flipped, typed, answer, extraAnswers, flip])

  // "My answer was right": count it as correct now and accept it for this card from now on.
  const acceptTyped = useCallback(() => {
    if (!s || !card || !flipped || !typed.trim() || result === 'correct') return
    setResult('correct')
    setSavedAnswer(true)
    addAcceptedAnswer(card.id, side, typed)
      .then((updated) => {
        if (!updated) return
        // Keep the session's copy current so a re-queued card uses the new answer too.
        setSession((cur) =>
          cur && cur !== 'missing' ? { ...cur, cards: new Map(cur.cards).set(updated.id, updated) } : cur,
        )
      })
      .catch((e) => console.error('Failed to save accepted answer', e))
  }, [s, card, flipped, typed, result, side])

  const giveUp = useCallback(() => {
    if (!card || flipped) return
    setResult('wrong')
    flip()
  }, [card, flipped, flip])

  // The UI advances immediately (computed with the same pure scheduler); the write to
  // IndexedDB happens in the background so fast keyboard input never gets dropped.
  // Practice mode: move to the next card without recording a review or rescheduling.
  const advance = useCallback(() => {
    if (!s || !card || !current || !flipped) return
    setLog((l) => [...l, { key: currentKey!, rating: 3, shown }])
    setSession({ ...s, queue: s.queue.slice(1) })
    setFlipped(false)
    setTyped('')
    setResult(null)
    setSavedAnswer(false)
  }, [s, card, current, currentKey, flipped, shown])

  const rate = useCallback(
    (rating: Rating) => {
      if (!s || !card || !current || !flipped || s.practice) return
      const now = Date.now()
      const prevRec = s.states.get(currentKey!)
      const next = review(prevRec ? toScheduling(prevRec) : newState(now), rating, now)
      const rec = fromScheduling(card.id, current.dir, next, now)
      setSession({
        ...s,
        states: new Map(s.states).set(rec.id, rec),
        queue: advanceQueue(s.queue, currentKey!, rating, next),
      })
      setLog((l) => [...l, { key: currentKey!, rating, shown }])
      setFlipped(false)
      setTyped('')
      setResult(null)
      setSavedAnswer(false)
      recordReview(card, current.dir, rating, now).catch((e) => console.error('Failed to save review', e))
    },
    [s, card, current, currentKey, flipped],
  )

  // Skip cards that were deleted (e.g. by a sync) while the session was open.
  useEffect(() => {
    if (s && currentKey && !card) setSession({ ...s, queue: s.queue.slice(1) })
  }, [s, currentKey, card])

  // Keyboard: Space/Enter flips, 1–4 rate. In typing mode, Enter in the box checks the answer
  // (handled by the form) and Enter afterwards takes the suggested rating. Ignored while
  // typing elsewhere or composing Hangul.
  const keys = useRef({ flipped, flip, rate, advance, typeMode, result, practice })
  keys.current = { flipped, flip, rate, advance, typeMode, result, practice }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || isComposing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      const k = keys.current
      if (e.key === ' ' || e.key === 'Enter') {
        // preventDefault also stops this Enter from submitting the next card's answer box.
        e.preventDefault()
        if (k.flipped) {
          // Practice: advance to the next card. Normal typing: Enter takes the suggested rating.
          if (k.practice) k.advance()
          else if (k.typeMode && e.key === 'Enter' && k.result) k.rate(suggestedRating(k.result))
        } else if (k.typeMode) {
          inputRef.current?.focus()
        } else {
          k.flip()
        }
      } else if (['1', '2', '3', '4'].includes(e.key) && k.flipped && !k.practice) {
        e.preventDefault()
        k.rate(Number(e.key) as Rating)
      } else if (e.key === 'Escape') {
        navigate(`/deck/${deckId}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deckId])

  if (session === null) return null
  if (session === 'missing') {
    return (
      <div className="pt-safe flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <p className="text-slate-500">This deck no longer exists.</p>
        <Button onClick={() => navigate('/')}>Back to decks</Button>
      </div>
    )
  }
  if (!currentKey)
    return (
      <Summary
        deck={session.deck}
        log={log}
        cards={session.cards}
        practice={session.practice}
        onAgain={() => setRunId((n) => n + 1)}
      />
    )
  if (!card) return null

  const rec = s!.states.get(currentKey)
  const now = Date.now()
  const delays = previewDelays(rec ? toScheduling(rec) : newState(now), now)
  const done = log.length
  const left = s!.queue.length
  const suggested = typeMode && result ? suggestedRating(result) : null

  return (
    <div className="flex h-dvh flex-col">
      {/* Top bar */}
      <div className="pt-safe px-safe">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-2">
          <a href={`#/deck/${deckId}`} className="tap-icon" aria-label="End session">
            <Icon name="x" className="h-6 w-6" />
          </a>
          {practice && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              Practice
            </span>
          )}
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${(done / Math.max(1, done + left)) * 100}%` }}
            />
          </div>
          <span className="min-w-16 text-right text-sm font-medium tabular-nums text-slate-600 dark:text-slate-300">
            {left} left
          </span>
        </div>
      </div>

      {/* Card */}
      <div className="px-safe flex min-h-0 flex-1 flex-col">
        <div
          className={`mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-4 py-2 ${typeMode ? '' : 'cursor-pointer select-none'}`}
          onClick={typeMode ? undefined : flip}
        >
          <div className="relative flex flex-1 flex-col items-center justify-center rounded-3xl bg-white px-5 py-8 text-center shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            {voice && koreanVisible && (
              <button
                className="tap-icon absolute top-2 right-2"
                aria-label="Play pronunciation"
                onClick={(e) => {
                  e.stopPropagation()
                  speakKorean(koreanText!, voice)
                }}
              >
                <Icon name="speaker" className="h-6 w-6" />
              </button>
            )}
            <div className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              {shown === 'fwd' ? 'Front → Back' : 'Back → Front'}
            </div>
            <div lang={hasHangul(prompt) ? 'ko' : 'en'} className={`hangul mt-4 font-bold ${faceSize(prompt)}`}>
              {prompt}
            </div>
            {flipped ? (
              <div className="mt-6 w-full border-t border-slate-200 pt-6 dark:border-slate-700">
                {typeMode && result && (
                  <Feedback result={result} typed={typed} saved={savedAnswer} onAccept={acceptTyped} />
                )}
                <div
                  lang={hasHangul(answer) ? 'ko' : 'en'}
                  className={`hangul font-semibold text-indigo-700 dark:text-indigo-300 ${answerSize(answer)}`}
                >
                  {answer}
                </div>
                {card.notes && (
                  <p className="hangul mt-4 whitespace-pre-line text-slate-600 dark:text-slate-400">{card.notes}</p>
                )}
              </div>
            ) : typeMode ? (
              <form
                className="mt-8 w-full max-w-md"
                onSubmit={(e) => {
                  e.preventDefault()
                  check()
                }}
                onKeyDownCapture={imeGuard}
              >
                <input
                  key={currentKey}
                  ref={inputRef}
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="Type the answer"
                  aria-label="Your answer"
                  lang={hasHangul(answer) ? 'ko' : 'en'}
                  className={`${inputClass} hangul text-center text-xl`}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="done"
                  maxLength={500}
                />
              </form>
            ) : (
              <div className="mt-8 text-sm text-slate-400">Tap to reveal</div>
            )}
          </div>
        </div>
      </div>

      {/* Answer controls: bottom of the screen for thumbs */}
      <div className="pb-safe px-safe">
        <div className="mx-auto max-w-2xl px-4 pt-2 pb-4">
          {!flipped && typeMode ? (
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Button className="h-14" onClick={giveUp}>
                Don't know
              </Button>
              <Button variant="primary" className="h-14 text-lg" onClick={check} disabled={!typed.trim()}>
                Check <kbd className="hidden text-xs opacity-70 sm:inline">Enter</kbd>
              </Button>
            </div>
          ) : !flipped ? (
            <Button variant="primary" className="h-14 w-full text-lg" onClick={flip}>
              Show answer <kbd className="hidden text-xs opacity-70 sm:inline">Space</kbd>
            </Button>
          ) : practice ? (
            <Button variant="primary" className="h-14 w-full text-lg" onClick={advance}>
              Next <kbd className="hidden text-xs opacity-70 sm:inline">Space</kbd>
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {([1, 2, 3, 4] as Rating[]).map((r) => (
                <button
                  key={r}
                  onClick={() => rate(r)}
                  aria-describedby={r === suggested ? 'suggested-hint' : undefined}
                  className={`flex h-16 flex-col items-center justify-center rounded-xl text-white transition-colors select-none ${ratingStyle[r]} ${
                    r === suggested
                      ? 'ring-4 ring-slate-900 ring-offset-2 ring-offset-slate-50 dark:ring-white dark:ring-offset-slate-950'
                      : suggested
                        ? 'opacity-70'
                        : ''
                  }`}
                >
                  <span className="font-semibold">{RATING_LABELS[r]}</span>
                  <span className="text-xs opacity-85">
                    {formatDelay(delays[r])}
                    <span className="hidden sm:inline"> · {r}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {flipped && !practice && suggested && (
            <p id="suggested-hint" className="mt-2 text-center text-xs text-slate-500">
              Suggested: {RATING_LABELS[suggested]}
              <span className="hidden sm:inline"> · press Enter</span> — or pick another
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Feedback({
  result,
  typed,
  saved,
  onAccept,
}: {
  result: AnswerResult
  typed: string
  saved: boolean
  onAccept: () => void
}) {
  if (result === 'correct') {
    return (
      <div className="mb-4">
        <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">✓ Correct</p>
        {saved && (
          <p className="hangul mt-1 text-sm text-slate-600 dark:text-slate-400">
            “{typed.trim()}” will count as correct for this card from now on.
          </p>
        )}
      </div>
    )
  }
  const tone = result === 'close' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
  return (
    <div className="mb-4">
      <p className={`text-lg font-semibold ${tone}`}>{result === 'close' ? 'Almost — check the spelling' : '✗ Not quite'}</p>
      {typed.trim() ? (
        <p className="hangul mt-1 text-slate-600 dark:text-slate-400">
          You typed: <span className={result === 'wrong' ? 'line-through' : ''}>{typed}</span>
        </p>
      ) : (
        <p className="mt-1 text-slate-500">No answer given</p>
      )}
      {typed.trim() && (
        <button
          type="button"
          onClick={onAccept}
          className="mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-indigo-700 ring-1 ring-indigo-300 hover:bg-indigo-50 dark:text-indigo-300 dark:ring-indigo-800 dark:hover:bg-indigo-950"
        >
          My answer is correct
        </button>
      )}
      <p className="mt-3 text-xs font-medium tracking-wide text-slate-400 uppercase">Answer</p>
    </div>
  )
}

function Summary({
  deck,
  log,
  cards,
  practice,
  onAgain,
}: {
  deck: Deck
  log: LogEntry[]
  cards: Map<string, Card>
  practice: boolean
  onAgain: () => void
}) {
  if (log.length === 0) {
    return (
      <div className="pt-safe pb-safe px-safe flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">🎉</div>
        <h1 className="text-xl font-semibold">Nothing to study right now</h1>
        <p className="text-slate-500">
          {practice
            ? `There are no cards to practice in “${deck.name}” yet. Add some first.`
            : `No cards are due in “${deck.name}”. Come back later or add new cards.`}
        </p>
        <Button variant="primary" onClick={() => navigate(`/deck/${deck.id}`)}>
          Back to deck
        </Button>
      </div>
    )
  }

  // Practice runs don't record ratings, so there's nothing to score — just show what was covered.
  if (practice) {
    const seen = new Set(log.map((l) => l.key)).size
    return (
      <div className="pt-safe pb-safe px-safe min-h-dvh">
        <div className="mx-auto max-w-2xl p-6">
          <h1 className="mt-6 text-center text-2xl font-bold">Practice complete</h1>
          <p className="hangul text-center text-slate-500">{deck.name}</p>
          <div className="mt-6 rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="text-4xl font-bold tabular-nums">{seen}</div>
            <div className="mt-1 text-xs text-slate-500">cards practiced · your schedule is unchanged</div>
          </div>
          <div className="mt-8 flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="primary" className="sm:flex-1" onClick={onAgain}>
              Practice again
            </Button>
            <Button className="sm:flex-1" onClick={() => navigate(`/deck/${deck.id}`)}>
              Done
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Per card-direction: did the first attempt this session succeed? How many Agains?
  const units = new Map<string, { first: Rating; again: number }>()
  for (const { key, rating } of log) {
    const u = units.get(key)
    if (!u) units.set(key, { first: rating, again: rating === 1 ? 1 : 0 })
    else if (rating === 1) u.again++
  }
  const remembered = [...units.values()].filter((u) => u.first !== 1).length
  const pct = Math.round((remembered / units.size) * 100)
  const struggling = [...units.entries()]
    .filter(([, u]) => u.again > 0)
    .sort((a, b) => b[1].again - a[1].again)
    .map(([key, u]) => ({ card: cards.get(parseKey(key).cardId), again: u.again, key }))
    .filter((x) => x.card)

  return (
    <div className="pt-safe pb-safe px-safe min-h-dvh">
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mt-6 text-center text-2xl font-bold">Session complete</h1>
        <p className="hangul text-center text-slate-500">{deck.name}</p>
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="text-3xl font-bold tabular-nums">{units.size}</div>
            <div className="text-xs text-slate-500">cards</div>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="text-3xl font-bold tabular-nums">{log.length}</div>
            <div className="text-xs text-slate-500">reviews</div>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="text-3xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">{pct}%</div>
            <div className="text-xs text-slate-500">remembered</div>
          </div>
        </div>

        {struggling.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 font-semibold">Struggled with</h2>
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
              {struggling.map(({ card, again, key }) => (
                <li key={key} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="hangul text-lg font-medium">{card!.front}</div>
                    <div className="text-slate-600 dark:text-slate-400">{card!.back}</div>
                  </div>
                  <span className="text-sm text-rose-600 dark:text-rose-400">
                    {again}× again
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8 flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="primary" className="sm:flex-1" onClick={() => navigate(`/deck/${deck.id}`)}>
            Done
          </Button>
          <Button className="sm:flex-1" onClick={onAgain}>
            Keep practicing
          </Button>
        </div>
      </div>
    </div>
  )
}
