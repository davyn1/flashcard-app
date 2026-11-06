"""add card_states.track (separate practice-mode schedule)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-05
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("card_states") as batch:
        batch.add_column(sa.Column("track", sa.String(8), nullable=False, server_default="main"))


def downgrade() -> None:
    with op.batch_alter_table("card_states") as batch:
        batch.drop_column("track")
