import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  apiGet: api.apiGet,
  apiPost: api.apiPost,
}))

import { exportAll, importBackup } from './backup'
import { db, getMeta } from './db'
import { addCard, createDeck, deleteCard, nextTimestamp, recordReview, updateCard } from './repo'
import { seedIfEmpty } from './seed'
import { PULL_CURSOR_KEY, incomingWins, mergeRecords, pullChanges, pushChanges, type SyncPayload } from './sync'
import type { Card } from './types'

const empty = (): SyncPayload => ({ decks: [], cards: [], card_states: [], reviews: [] })

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  api.apiGet.mockReset()
  api.apiPost.mockReset().mockResolvedValue({ accepted: 0, ignored: 0, server_time: 0 })
})

describe('local writes', () => {
  it('normalizes to NFC and queues changes in the outbox', async () => {
    const deck = await createDeck('  한국어  ')
    const card = await addCard(deck.id, { front: '물'.normalize('NFD'), back: ' water ' })
    expect(deck.name).toBe('한국어')
    expect(card.front).toBe('물')
    expect(card.front.length).toBe(1)
    expect(card.back).toBe('water')
    const keys = (await db.outbox.toArray()).map((e) => e.key).sort()
    expect(keys).toEqual([`cards:${card.id}`, `decks:${deck.id}`].sort())
  })

  it('soft-deletes so the deletion can sync', async () => {
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '책', back: 'book' })
    await deleteCard(card.id)
    const stored = await db.cards.get(card.id)
    expect(stored?.deleted_at).toBeGreaterThan(0)
    expect(stored?.updated_at).toBe(stored?.deleted_at)
  })

  it('always bumps updated_at past the previous version, even if the clock is behind', async () => {
    expect(nextTimestamp({ updated_at: 5000 }, 1000)).toBe(5001)
    expect(nextTimestamp({ updated_at: 5000 }, 9000)).toBe(9000)
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '집', back: 'house' })
    await db.cards.update(card.id, { updated_at: Date.now() + 60_000 }) // edited on a device with a fast clock
    await updateCard(card.id, { front: '집', back: 'home' })
    expect((await db.cards.get(card.id))!.updated_at).toBeGreaterThan(Date.now() + 59_000)
  })

  it('recordReview stores the new state and appends to the review log', async () => {
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '학교', back: 'school' })
    const s1 = await recordReview(card, 'fwd', 1, 1_000_000)
    const s2 = await recordReview(card, 'fwd', 3, 1_060_000)
    expect(s1.id).toBe(`${card.id}:fwd`)
    expect(s2.state).toBe('learning')
    expect(s2.introduced_at).toBe(1_000_000)
    const log = await db.reviews.where('card_id').equals(card.id).sortBy('reviewed_at')
    expect(log.map((r) => [r.rating, r.prev_state, r.state])).toEqual([
      [1, 'new', 'learning'],
      [3, 'learning', 'learning'],
    ])
    expect(await db.outbox.where('table').equals('reviews').count()).toBe(2)
  })
})

describe('mergeRecords (last-write-wins)', () => {
  async function localCard(updated_at: number, back = 'local'): Promise<Card> {
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '물', back })
    await db.cards.update(card.id, { updated_at })
    return { ...card, back, updated_at }
  }

  it('incomingWins only for strictly newer records', () => {
    expect(incomingWins(undefined, { updated_at: 1 })).toBe(true)
    expect(incomingWins({ updated_at: 1 }, { updated_at: 2 })).toBe(true)
    expect(incomingWins({ updated_at: 2 }, { updated_at: 2 })).toBe(false)
    expect(incomingWins({ updated_at: 3 }, { updated_at: 2 })).toBe(false)
  })

  it('applies newer remote records and drops the superseded local outbox entry', async () => {
    const card = await localCard(1000)
    await mergeRecords({ ...empty(), cards: [{ ...card, back: 'remote', updated_at: 2000 }] })
    expect((await db.cards.get(card.id))!.back).toBe('remote')
    expect(await db.outbox.get(`cards:${card.id}`)).toBeUndefined()
  })

  it('keeps newer local edits and their pending push', async () => {
    const card = await localCard(3000)
    await mergeRecords({ ...empty(), cards: [{ ...card, back: 'remote', updated_at: 2000 }] })
    expect((await db.cards.get(card.id))!.back).toBe('local')
    expect(await db.outbox.get(`cards:${card.id}`)).toBeDefined()
  })

  it('merges reviews by id without overwriting', async () => {
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '물', back: 'water' })
    await recordReview(card, 'fwd', 3, 1000)
    const [mine] = await db.reviews.toArray()
    const theirs = { ...mine, id: crypto.randomUUID(), rating: 1 as const }
    const n = await mergeRecords({ ...empty(), reviews: [{ ...mine, rating: 4 }, theirs] })
    expect(n).toBe(1)
    expect((await db.reviews.get(mine.id))!.rating).toBe(3)
    expect(await db.reviews.count()).toBe(2)
  })
})

describe('push', () => {
  it('sends queued records grouped by table and clears the outbox', async () => {
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '물', back: 'water' })
    await recordReview(card, 'fwd', 3)
    const sent = await pushChanges()
    expect(sent).toBe(4)
    expect(api.apiPost).toHaveBeenCalledTimes(1)
    const [path, payload] = api.apiPost.mock.calls[0]
    expect(path).toBe('/sync/push')
    expect(payload.decks.map((d: { id: string }) => d.id)).toEqual([deck.id])
    expect(payload.cards.map((c: { id: string }) => c.id)).toEqual([card.id])
    expect(payload.card_states).toHaveLength(1)
    expect(payload.reviews).toHaveLength(1)
    expect(await db.outbox.count()).toBe(0)
  })

  it('keeps a record queued if it was edited while the push was in flight', async () => {
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '물', back: 'water' })
    api.apiPost.mockImplementationOnce(async () => {
      await updateCard(card.id, { front: '물', back: 'water!' })
      return { accepted: 2 }
    })
    await pushChanges()
    // first round left the edited card queued; second round sent it
    expect(api.apiPost).toHaveBeenCalledTimes(2)
    expect(api.apiPost.mock.calls[1][1].cards[0].back).toBe('water!')
    expect(await db.outbox.count()).toBe(0)
  })

  it('leaves the outbox intact when the request fails (offline)', async () => {
    await createDeck('D')
    api.apiPost.mockRejectedValue(new Error('offline'))
    await expect(pushChanges()).rejects.toThrow('offline')
    expect(await db.outbox.count()).toBe(1)
  })

  it('does nothing with an empty outbox', async () => {
    expect(await pushChanges()).toBe(0)
    expect(api.apiPost).not.toHaveBeenCalled()
  })
})

describe('pull', () => {
  it('uses and advances the server cursor', async () => {
    api.apiGet.mockResolvedValueOnce({ ...empty(), server_time: 111 })
    await pullChanges()
    expect(api.apiGet).toHaveBeenLastCalledWith('/sync/pull?since=0')
    expect(await getMeta(PULL_CURSOR_KEY)).toBe(111)

    api.apiGet.mockResolvedValueOnce({ ...empty(), server_time: 222 })
    await pullChanges()
    expect(api.apiGet).toHaveBeenLastCalledWith('/sync/pull?since=111')
    expect(await getMeta(PULL_CURSOR_KEY)).toBe(222)
  })

  it('brings in remote decks, cards, and deletions', async () => {
    const deckId = crypto.randomUUID()
    const cardId = crypto.randomUUID()
    const remoteDeck = {
      id: deckId, name: 'Remote', direction: 'both' as const, new_per_day: 10, autoplay_audio: true,
      created_at: 1, updated_at: 5, deleted_at: null,
    }
    const remoteCard = {
      id: cardId, deck_id: deckId, front: '사과', back: 'apple', notes: '', created_at: 1, updated_at: 5, deleted_at: null,
    }
    api.apiGet.mockResolvedValueOnce({ ...empty(), decks: [remoteDeck], cards: [remoteCard], server_time: 10 })
    await pullChanges()
    expect(await db.decks.get(deckId)).toEqual(remoteDeck)
    expect(await db.outbox.count()).toBe(0) // pulled data isn't re-pushed

    api.apiGet.mockResolvedValueOnce({ ...empty(), cards: [{ ...remoteCard, deleted_at: 9, updated_at: 9 }], server_time: 20 })
    await pullChanges()
    expect((await db.cards.get(cardId))!.deleted_at).toBe(9)
  })
})

describe('seed', () => {
  it('seeds once, and a remote deletion of the sample deck wins over the seed', async () => {
    expect(await seedIfEmpty()).toBe(true)
    expect(await seedIfEmpty()).toBe(false)
    const deck = (await db.decks.toArray())[0]
    expect(await db.cards.count()).toBeGreaterThanOrEqual(15)
    await mergeRecords({ ...empty(), decks: [{ ...deck, deleted_at: 50, updated_at: 50 }] })
    expect((await db.decks.get(deck.id))!.deleted_at).toBe(50)
  })
})

describe('backup', () => {
  it('round-trips through export/import', async () => {
    const deck = await createDeck('D')
    const card = await addCard(deck.id, { front: '물', back: 'water' })
    await recordReview(card, 'fwd', 3)
    const backup = JSON.parse(JSON.stringify(await exportAll()))
    await Promise.all(db.tables.map((t) => t.clear()))
    const n = await importBackup(backup)
    expect(n).toBe(4)
    expect((await db.cards.get(card.id))!.front).toBe('물')
    expect(await db.outbox.count()).toBe(4) // queued for upload
  })

  it('rejects files that are not backups or contain invalid records', async () => {
    await expect(importBackup({ hello: 1 })).rejects.toThrow(/Not a Korean Flashcards backup/)
    const b = JSON.parse(JSON.stringify(await exportAll()))
    b.cards = [{ id: 'x' }]
    await expect(importBackup(b)).rejects.toThrow(/invalid record in "cards"/)
  })
})
