import unicodedata
import uuid

import pytest

from app import sync as sync_module

DECK_ID = str(uuid.uuid4())
CARD_ID = str(uuid.uuid4())


def deck(updated_at=1000, **kw):
    return {
        "id": DECK_ID,
        "name": "Deck",
        "direction": "ko_en",
        "new_per_day": 20,
        "autoplay_audio": False,
        "answer_mode": "flip",
        "created_at": 1000,
        "updated_at": updated_at,
        "deleted_at": None,
        **kw,
    }


def card(updated_at=1000, **kw):
    return {
        "id": CARD_ID,
        "deck_id": DECK_ID,
        "front": "물",
        "back": "water",
        "notes": "",
        "accepted_front": [],
        "accepted_back": [],
        "created_at": 1000,
        "updated_at": updated_at,
        "deleted_at": None,
        **kw,
    }


def state(updated_at=1000, **kw):
    return {
        "id": f"{CARD_ID}:fwd",
        "card_id": CARD_ID,
        "direction": "fwd",
        "state": "review",
        "ease": 2.5,
        "interval": 3,
        "reps": 2,
        "lapses": 0,
        "step": 0,
        "due": 5000,
        "last_reviewed": 1000,
        "introduced_at": 900,
        "updated_at": updated_at,
        "deleted_at": None,
        **kw,
    }


def review(**kw):
    return {
        "id": str(uuid.uuid4()),
        "card_id": CARD_ID,
        "deck_id": DECK_ID,
        "direction": "fwd",
        "rating": 3,
        "reviewed_at": 1000,
        "prev_state": "learning",
        "state": "review",
        "interval": 1,
        "ease": 2.5,
        **kw,
    }


@pytest.fixture
def clock(monkeypatch):
    """Controllable server clock (ms)."""

    class Clock:
        now = 1_000_000_000

    monkeypatch.setattr(sync_module, "now_ms", lambda: Clock.now)
    return Clock


def push(client, auth, **payload):
    res = client.post("/sync/push", json=payload, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def pull(client, auth, since=0):
    res = client.get(f"/sync/pull?since={since}", headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def test_push_then_pull_roundtrip(client, auth):
    r = review()
    res = push(client, auth, decks=[deck()], cards=[card()], card_states=[state()], reviews=[r])
    assert res == {"accepted": 4, "ignored": 0, "server_time": res["server_time"]}

    data = pull(client, auth)
    assert data["decks"] == [deck()]
    assert data["cards"] == [card()]
    assert data["card_states"] == [state()]
    assert data["reviews"] == [r]
    assert "server_updated_at" not in data["cards"][0]


def test_pull_since_returns_only_newer_changes(client, auth, clock):
    clock.now = 1_000_000
    push(client, auth, decks=[deck()])
    clock.now = 2_000_000
    first = pull(client, auth)
    assert len(first["decks"]) == 1
    # Cursor is moved back by the overlap window so in-flight pushes aren't missed.
    assert first["server_time"] == 2_000_000 - sync_module.PULL_OVERLAP_MS

    clock.now = 3_000_000
    push(client, auth, cards=[card()])
    second = pull(client, auth, since=first["server_time"])
    assert second["decks"] == []
    assert [c["id"] for c in second["cards"]] == [CARD_ID]


def test_deck_answer_mode_roundtrips_and_defaults_to_flip(client, auth):
    push(client, auth, decks=[deck(answer_mode="type")])
    assert pull(client, auth)["decks"][0]["answer_mode"] == "type"
    older_client = {k: v for k, v in deck(updated_at=2000).items() if k != "answer_mode"}
    push(client, auth, decks=[older_client])
    assert pull(client, auth)["decks"][0]["answer_mode"] == "flip"


def test_card_accepted_answers_roundtrip_and_default_to_empty(client, auth):
    push(client, auth, cards=[card(accepted_back=["hi", "greetings"], accepted_front=["물"])])
    c = pull(client, auth)["cards"][0]
    assert c["accepted_back"] == ["hi", "greetings"]
    assert c["accepted_front"] == ["물"]
    older_client = {k: v for k, v in card(updated_at=2000).items() if not k.startswith("accepted_")}
    push(client, auth, cards=[older_client])
    c = pull(client, auth)["cards"][0]
    assert c["accepted_back"] == [] and c["accepted_front"] == []


def test_last_write_wins_newer_update_applies(client, auth):
    push(client, auth, cards=[card(updated_at=1000, back="water")])
    res = push(client, auth, cards=[card(updated_at=2000, back="water (drink)")])
    assert res["accepted"] == 1
    assert pull(client, auth)["cards"][0]["back"] == "water (drink)"


def test_last_write_wins_older_update_is_ignored(client, auth):
    push(client, auth, cards=[card(updated_at=2000, back="newer")])
    res = push(client, auth, cards=[card(updated_at=1000, back="older, from an offline device")])
    assert res == {"accepted": 0, "ignored": 1, "server_time": res["server_time"]}
    assert pull(client, auth)["cards"][0]["back"] == "newer"


def test_equal_timestamp_keeps_server_version(client, auth):
    push(client, auth, decks=[deck(updated_at=1000, name="A")])
    push(client, auth, decks=[deck(updated_at=1000, name="B")])
    assert pull(client, auth)["decks"][0]["name"] == "A"


def test_conflict_between_two_devices_resolves_per_record(client, auth):
    other_card = str(uuid.uuid4())
    # Device A edits the deck name late, card early; device B the opposite.
    push(
        client,
        auth,
        decks=[deck(updated_at=3000, name="From A")],
        cards=[card(updated_at=1000, back="A's card")],
    )
    push(
        client,
        auth,
        decks=[deck(updated_at=2000, name="From B")],
        cards=[card(updated_at=4000, back="B's card"), card(id=other_card, updated_at=4000)],
    )
    data = pull(client, auth)
    assert data["decks"][0]["name"] == "From A"
    backs = {c["id"]: c["back"] for c in data["cards"]}
    assert backs[CARD_ID] == "B's card"
    assert other_card in backs


def test_soft_delete_syncs_and_beats_older_edit(client, auth):
    push(client, auth, cards=[card(updated_at=1000)])
    push(client, auth, cards=[card(updated_at=2000, deleted_at=2000)])
    push(client, auth, cards=[card(updated_at=1500, back="stale edit")])
    c = pull(client, auth)["cards"][0]
    assert c["deleted_at"] == 2000
    assert c["back"] == "water"


def test_card_state_last_write_wins(client, auth):
    push(client, auth, card_states=[state(updated_at=1000, interval=3)])
    push(client, auth, card_states=[state(updated_at=900, interval=1)])
    push(client, auth, card_states=[state(updated_at=1100, interval=8)])
    assert pull(client, auth)["card_states"][0]["interval"] == 8


def test_reviews_are_append_only_and_deduplicated(client, auth):
    r1, r2 = review(), review(rating=1)
    push(client, auth, reviews=[r1])
    res = push(client, auth, reviews=[r1, r2, {**r1, "rating": 4}])
    assert res["accepted"] == 1 and res["ignored"] == 2
    reviews = pull(client, auth)["reviews"]
    assert {r["id"]: r["rating"] for r in reviews} == {r1["id"]: 3, r2["id"]: 1}


def test_duplicate_ids_within_one_batch(client, auth):
    res = push(client, auth, cards=[card(updated_at=1000, back="first"), card(updated_at=2000, back="second")])
    assert res["accepted"] == 2
    assert pull(client, auth)["cards"][0]["back"] == "second"


def test_server_normalizes_text_to_nfc(client, auth):
    decomposed = unicodedata.normalize("NFD", "강아지")
    assert decomposed != "강아지"
    push(client, auth, cards=[card(front=decomposed)])
    assert pull(client, auth)["cards"][0]["front"] == "강아지"


@pytest.mark.parametrize(
    "payload",
    [
        {"cards": [card(id="not-a-uuid")]},
        {"cards": [card(front="x" * 2001)]},
        {"cards": [card(updated_at=-1)]},
        {"cards": [card(accepted_back=[""])]},
        {"cards": [card(accepted_back=["x"] * 51)]},
        {"cards": [card(accepted_back="hi")]},
        {"decks": [deck(direction="sideways")]},
        {"decks": [deck(name="")]},
        {"decks": [deck(answer_mode="quiz")]},
        {"card_states": [state(id=f"{uuid.uuid4()}:fwd")]},  # id doesn't match card_id
        {"card_states": [state(ease=0.5)]},
        {"reviews": [review(rating=5)]},
        {"unknown_table": []},
        {"cards": [card(updated_at=1000 + i, id=str(uuid.uuid4())) for i in range(5001)]},
    ],
)
def test_push_rejects_invalid_input(client, auth, payload):
    assert client.post("/sync/push", json=payload, headers=auth).status_code == 422


def test_pull_rejects_invalid_since(client, auth):
    assert client.get("/sync/pull?since=-5", headers=auth).status_code == 422
    assert client.get("/sync/pull?since=abc", headers=auth).status_code == 422


def test_sync_requires_token(client):
    assert client.post("/sync/push", json={"cards": [card()]}).status_code == 401
    assert client.get("/sync/pull?since=0").status_code == 401
