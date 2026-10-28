"""add cards.accepted_front / accepted_back

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-28
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("cards") as batch:
        batch.add_column(sa.Column("accepted_front", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("accepted_back", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("cards") as batch:
        batch.drop_column("accepted_back")
        batch.drop_column("accepted_front")
