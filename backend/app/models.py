"""Database tables.

All timestamps are integer milliseconds since the Unix epoch (UTC), which keeps
them identical between the browser (Date.now()) and the server.

`updated_at` is set by the client and decides last-write-wins conflicts.
`server_updated_at` is set by the server whenever it stores a change and is what
GET /sync/pull?since=... filters on, so client clock skew can't hide changes.
"""

from sqlalchemy import BigInteger, Boolean, Float, Integer, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Deck(Base):
    __tablename__ = "decks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # "ko_en" | "en_ko" | "both"
    direction: Mapped[str] = mapped_column(String(8), default="ko_en")
    new_per_day: Mapped[int] = mapped_column(Integer, default=20)
    autoplay_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    # "flip" | "type" (type the answer before revealing it)
    answer_mode: Mapped[str] = mapped_column(String(8), default="flip", server_default="flip")
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)
    deleted_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    server_updated_at: Mapped[int] = mapped_column(BigInteger, index=True)


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # No foreign key: records may arrive in any order across sync batches.
    deck_id: Mapped[str] = mapped_column(String(36), index=True)
    front: Mapped[str] = mapped_column(Text)
    back: Mapped[str] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)
    deleted_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    server_updated_at: Mapped[int] = mapped_column(BigInteger, index=True)


class CardState(Base):
    """Scheduling state for one direction of one card. id = "<card_id>:<fwd|rev>"."""

    __tablename__ = "card_states"

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    card_id: Mapped[str] = mapped_column(String(36), index=True)
    direction: Mapped[str] = mapped_column(String(3))
    # "new" | "learning" | "review" | "relearning"
    state: Mapped[str] = mapped_column(String(12))
    ease: Mapped[float] = mapped_column(Float)
    interval: Mapped[float] = mapped_column(Float)
    reps: Mapped[int] = mapped_column(Integer)
    lapses: Mapped[int] = mapped_column(Integer)
    step: Mapped[int] = mapped_column(Integer)
    due: Mapped[int] = mapped_column(BigInteger)
    last_reviewed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    introduced_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    updated_at: Mapped[int] = mapped_column(BigInteger)
    deleted_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    server_updated_at: Mapped[int] = mapped_column(BigInteger, index=True)


class Review(Base):
    """Append-only review log."""

    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    card_id: Mapped[str] = mapped_column(String(36), index=True)
    deck_id: Mapped[str] = mapped_column(String(36), index=True)
    direction: Mapped[str] = mapped_column(String(3))
    rating: Mapped[int] = mapped_column(SmallInteger)
    reviewed_at: Mapped[int] = mapped_column(BigInteger)
    prev_state: Mapped[str] = mapped_column(String(12))
    state: Mapped[str] = mapped_column(String(12))
    interval: Mapped[float] = mapped_column(Float)
    ease: Mapped[float] = mapped_column(Float)
    server_updated_at: Mapped[int] = mapped_column(BigInteger, index=True)
