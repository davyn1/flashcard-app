"""initial tables

Revision ID: 0001
Revises:
Create Date: 2026-10-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "decks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("direction", sa.String(8), nullable=False),
        sa.Column("new_per_day", sa.Integer(), nullable=False),
        sa.Column("autoplay_audio", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.BigInteger(), nullable=True),
        sa.Column("server_updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_decks_server_updated_at", "decks", ["server_updated_at"])

    op.create_table(
        "cards",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("deck_id", sa.String(36), nullable=False),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.BigInteger(), nullable=True),
        sa.Column("server_updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_cards_deck_id", "cards", ["deck_id"])
    op.create_index("ix_cards_server_updated_at", "cards", ["server_updated_at"])

    op.create_table(
        "card_states",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("card_id", sa.String(36), nullable=False),
        sa.Column("direction", sa.String(3), nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("ease", sa.Float(), nullable=False),
        sa.Column("interval", sa.Float(), nullable=False),
        sa.Column("reps", sa.Integer(), nullable=False),
        sa.Column("lapses", sa.Integer(), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("due", sa.BigInteger(), nullable=False),
        sa.Column("last_reviewed", sa.BigInteger(), nullable=True),
        sa.Column("introduced_at", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.BigInteger(), nullable=True),
        sa.Column("server_updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_card_states_card_id", "card_states", ["card_id"])
    op.create_index("ix_card_states_server_updated_at", "card_states", ["server_updated_at"])

    op.create_table(
        "reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("card_id", sa.String(36), nullable=False),
        sa.Column("deck_id", sa.String(36), nullable=False),
        sa.Column("direction", sa.String(3), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("reviewed_at", sa.BigInteger(), nullable=False),
        sa.Column("prev_state", sa.String(12), nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("interval", sa.Float(), nullable=False),
        sa.Column("ease", sa.Float(), nullable=False),
        sa.Column("server_updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_reviews_card_id", "reviews", ["card_id"])
    op.create_index("ix_reviews_deck_id", "reviews", ["deck_id"])
    op.create_index("ix_reviews_server_updated_at", "reviews", ["server_updated_at"])


def downgrade() -> None:
    op.drop_table("reviews")
    op.drop_table("card_states")
    op.drop_table("cards")
    op.drop_table("decks")
