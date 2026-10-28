"""add decks.answer_mode

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("decks") as batch:
        batch.add_column(sa.Column("answer_mode", sa.String(8), nullable=False, server_default="flip"))


def downgrade() -> None:
    with op.batch_alter_table("decks") as batch:
        batch.drop_column("answer_mode")
