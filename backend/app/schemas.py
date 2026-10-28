import unicodedata
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
MAX_MS = 2**53 - 1  # JS Number.MAX_SAFE_INTEGER
MAX_BATCH = 5000


def _nfc(v: str) -> str:
    return unicodedata.normalize("NFC", v)


Uuid = Annotated[str, StringConstraints(pattern=UUID_PATTERN)]
Ms = Annotated[int, Field(ge=0, le=MAX_MS)]
Text = Annotated[str, StringConstraints(max_length=2000), AfterValidator(_nfc)]
Notes = Annotated[str, StringConstraints(max_length=5000), AfterValidator(_nfc)]
AcceptedAnswers = Annotated[
    list[Annotated[str, StringConstraints(min_length=1, max_length=500), AfterValidator(_nfc)]],
    Field(max_length=50),
]
Direction = Literal["fwd", "rev"]
StateKind = Literal["new", "learning", "review", "relearning"]


class _Record(BaseModel):
    # Unknown fields are ignored so an older server tolerates a newer client.
    model_config = ConfigDict(extra="ignore", from_attributes=True)


class DeckRecord(_Record):
    id: Uuid
    name: Annotated[str, StringConstraints(min_length=1, max_length=200), AfterValidator(_nfc)]
    direction: Literal["ko_en", "en_ko", "both", "mixed"]
    new_per_day: int = Field(ge=0, le=9999)
    autoplay_audio: bool
    # Optional so clients from before this field existed can still push.
    answer_mode: Literal["flip", "type"] = "flip"
    created_at: Ms
    updated_at: Ms
    deleted_at: Ms | None = None


class CardRecord(_Record):
    id: Uuid
    deck_id: Uuid
    front: Text
    back: Text
    notes: Notes = ""
    # Optional so clients from before this field existed can still push.
    accepted_front: AcceptedAnswers = Field(default_factory=list)
    accepted_back: AcceptedAnswers = Field(default_factory=list)
    created_at: Ms
    updated_at: Ms
    deleted_at: Ms | None = None


class CardStateRecord(_Record):
    id: Annotated[str, StringConstraints(max_length=48)]
    card_id: Uuid
    direction: Direction
    state: StateKind
    ease: float = Field(ge=1.0, le=10.0)
    interval: float = Field(ge=0, le=100_000)
    reps: int = Field(ge=0, le=1_000_000)
    lapses: int = Field(ge=0, le=1_000_000)
    step: int = Field(ge=0, le=100)
    due: Ms
    last_reviewed: Ms | None = None
    introduced_at: Ms | None = None
    updated_at: Ms
    deleted_at: Ms | None = None

    @model_validator(mode="after")
    def _id_matches(self) -> "CardStateRecord":
        if self.id != f"{self.card_id}:{self.direction}":
            raise ValueError("id must be '<card_id>:<direction>'")
        return self


class ReviewRecord(_Record):
    id: Uuid
    card_id: Uuid
    deck_id: Uuid
    direction: Direction
    rating: int = Field(ge=1, le=4)
    reviewed_at: Ms
    prev_state: StateKind
    state: StateKind
    interval: float = Field(ge=0, le=100_000)
    ease: float = Field(ge=1.0, le=10.0)


class SyncPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decks: list[DeckRecord] = Field(default_factory=list, max_length=MAX_BATCH)
    cards: list[CardRecord] = Field(default_factory=list, max_length=MAX_BATCH)
    card_states: list[CardStateRecord] = Field(default_factory=list, max_length=MAX_BATCH)
    reviews: list[ReviewRecord] = Field(default_factory=list, max_length=MAX_BATCH)


class PushResponse(BaseModel):
    accepted: int
    """Records that were inserted or won last-write-wins."""
    ignored: int
    """Records that lost to a newer server version (or were duplicate reviews)."""
    server_time: int


class PullResponse(SyncPayload):
    model_config = ConfigDict(extra="forbid")

    server_time: int
    """Pass back as `since` on the next pull."""
