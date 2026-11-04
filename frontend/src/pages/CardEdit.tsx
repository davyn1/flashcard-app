import { useLiveQuery } from 'dexie-react-hooks'
import { CardForm } from '../components/CardForm'
import { Icon, Page } from '../components/ui'
import { db } from '../lib/db'
import { deleteCard } from '../lib/repo'
import { navigate } from '../lib/router'
import { NotFound } from './DeckView'

/** Add (deckId given) or edit (cardId given) a card. */
export default function CardEdit({ deckId, cardId }: { deckId?: string; cardId?: string }) {
  const card = useLiveQuery(async () => (cardId ? ((await db.cards.get(cardId)) ?? null) : null), [cardId])
  const targetDeckId = deckId ?? card?.deck_id
  const deck = useLiveQuery(async () => (targetDeckId ? ((await db.decks.get(targetDeckId)) ?? null) : null), [targetDeckId])

  if (cardId && card === null) return <NotFound />
  if (card === undefined && cardId) return null
  if (deck === null || (deck && deck.deleted_at)) return <NotFound />
  if (!targetDeckId) return null

  const isNew = !cardId
  const backTo = `/deck/${targetDeckId}`

  async function remove() {
    if (!cardId || !confirm('Delete this card?')) return
    await deleteCard(cardId)
    navigate(backTo)
  }

  return (
    <Page
      title={isNew ? 'Add card' : 'Edit card'}
      back={backTo}
      actions={
        !isNew && (
          <button className="tap-icon text-rose-600" onClick={remove} aria-label="Delete card">
            <Icon name="trash" />
          </button>
        )
      }
    >
      <CardForm deckId={targetDeckId} card={card ?? undefined} onDone={() => navigate(backTo)} />
    </Page>
  )
}
