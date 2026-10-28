from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

BACKEND = Path(__file__).resolve().parent.parent


def test_alembic_upgrade_creates_all_tables(tmp_path):
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")

    tables = set(inspect(create_engine(url)).get_table_names())
    assert {"decks", "cards", "card_states", "reviews"} <= tables
    deck_columns = {c["name"] for c in inspect(create_engine(url)).get_columns("decks")}
    assert "answer_mode" in deck_columns

    command.downgrade(cfg, "base")
    assert "decks" not in set(inspect(create_engine(url)).get_table_names())
