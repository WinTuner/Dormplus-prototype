"""Failed code redemptions, so guessing invite codes can be rate limited per LINE account.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-13
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create table auth_failures (
      id         bigserial primary key,
      scope      text not null,          -- e.g. 'line.link'
      actor      text not null,          -- the LINE userId that failed
      created_at timestamptz not null default now()
    );
    create index on auth_failures (scope, actor, created_at);
    """)


def downgrade() -> None:
    op.execute("drop table if exists auth_failures")
