"""Sync endpoints: POST /sync/push and GET /sync/pull?since=<ms>.

Conflict resolution is per record, last-write-wins on the client-provided
`updated_at`. Deletes are soft (`deleted_at`) so they propagate like edits.
Reviews are an append-only log keyed by id.
"""

import time
from collections.abc import Sequence

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import require_auth
from .models import Card, CardState, Deck, Review
from .schemas import (
    MAX_MS,
    CardRecord,
    CardStateRecord,
    DeckRecord,
    PullResponse,
    PushResponse,
    ReviewRecord,
    SyncPayload,
)

# Pull cursors are moved back by this much so a push that was stamped just before a
# pull but committed just after it is still picked up next time. Re-sent records are
# harmless: clients merge idempotently.
PULL_OVERLAP_MS = 30_000
_CHUNK = 500

router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(require_auth)])


def now_ms() -> int:
    return int(time.time() * 1000)


def get_session(request: Request):
    yield from request.app.state.db.session()


def _chunks(items: Sequence, size: int = _CHUNK):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_lww(session: Session, model, records: Sequence, stamp: int) -> int:
    """Insert new records; overwrite existing ones only if the incoming updated_at is newer."""
    accepted = 0
    for chunk in _chunks(records):
        ids = {r.id for r in chunk}
        existing = {o.id: o for o in session.scalars(select(model).where(model.id.in_(ids)))}
        for rec in chunk:
            data = rec.model_dump()
            obj = existing.get(rec.id)
            if obj is None:
                obj = model(**data, server_updated_at=stamp)
                session.add(obj)
                existing[rec.id] = obj
                accepted += 1
            elif rec.updated_at > obj.updated_at:
                for key, value in data.items():
                    setattr(obj, key, value)
                obj.server_updated_at = stamp
                accepted += 1
    return accepted


def insert_reviews(session: Session, records: Sequence[ReviewRecord], stamp: int) -> int:
    accepted = 0
    for chunk in _chunks(records):
        ids = {r.id for r in chunk}
        seen = set(session.scalars(select(Review.id).where(Review.id.in_(ids))))
        for rec in chunk:
            if rec.id in seen:
                continue
            session.add(Review(**rec.model_dump(), server_updated_at=stamp))
            seen.add(rec.id)
            accepted += 1
    return accepted


@router.post("/push", response_model=PushResponse)
def push(body: SyncPayload, session: Session = Depends(get_session)) -> PushResponse:
    stamp = now_ms()
    accepted = (
        upsert_lww(session, Deck, body.decks, stamp)
        + upsert_lww(session, Card, body.cards, stamp)
        + upsert_lww(session, CardState, body.card_states, stamp)
        + insert_reviews(session, body.reviews, stamp)
    )
    session.commit()
    total = len(body.decks) + len(body.cards) + len(body.card_states) + len(body.reviews)
    return PushResponse(accepted=accepted, ignored=total - accepted, server_time=stamp)


@router.get("/pull", response_model=PullResponse)
def pull(
    since: int = Query(0, ge=0, le=MAX_MS, description="server_time from the previous pull (ms)"),
    session: Session = Depends(get_session),
) -> PullResponse:
    started = now_ms()

    def changed(model):
        return session.scalars(select(model).where(model.server_updated_at >= since)).all()

    return PullResponse(
        decks=[DeckRecord.model_validate(o) for o in changed(Deck)],
        cards=[CardRecord.model_validate(o) for o in changed(Card)],
        card_states=[CardStateRecord.model_validate(o) for o in changed(CardState)],
        reviews=[ReviewRecord.model_validate(o) for o in changed(Review)],
        server_time=max(0, started - PULL_OVERLAP_MS),
    )
