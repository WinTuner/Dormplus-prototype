"""Invite codes that bind a tenant's LINE account to a room.

The owner creates a code for a room; the tenant opens the LIFF link with it, and the first LINE
login that presents it is written into tenants.line_user_id. Only a SHA-256 hash of the code is
stored, so a leaked database does not hand out working invites.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-12
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create table link_codes (
      id          text primary key,
      code_hash   text not null unique,
      property_id text not null references properties(id) on delete cascade,
      room_id     text not null references rooms(id) on delete cascade,
      tenant_id   text references tenants(id) on delete set null,  -- null: the link adds a new tenant to the room
      created_by  text,
      created_at  timestamptz not null default now(),
      expires_at  timestamptz not null,
      used_at     timestamptz,
      used_by     text,                                           -- the LINE userId that used it
      revoked_at  timestamptz
    );
    create index on link_codes (room_id);
    alter table link_codes enable row level security;
    """)


def downgrade() -> None:
    op.execute("drop table if exists link_codes")
