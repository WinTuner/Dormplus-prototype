"""Initial schema, copied from db/schema.sql (v1).

From here on, schema changes go in new migrations, not in db/schema.sql.

Revision ID: 0001
Revises:
Create Date: 2026-11-11
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

UPGRADE = """
create table properties (
  id            text primary key,
  name          text not null,
  billing_mode  text not null default 'meter' check (billing_mode in ('meter','flat')),
  water_rate    int  not null default 25,
  elec_rate     int  not null default 7,
  due_days      int  not null default 5,
  line_channel_id   text,
  line_secret_enc   bytea,
  line_token_enc    bytea,
  created_at    timestamptz not null default now()
);

create table rooms (
  id          text primary key,
  property_id text not null references properties(id) on delete cascade,
  room_no     text not null,
  rent        int  not null,
  mode        text not null default 'meter' check (mode in ('meter','flat')),
  status      text not null default 'occupied' check (status in ('vacant','occupied')),
  unique (property_id, room_no)
);

create table tenants (
  id            text primary key,
  room_id       text not null references rooms(id) on delete cascade,
  name          text,
  line_user_id  text,
  moved_in      date,
  moved_out     date,
  unique (room_id, line_user_id)
);
create index on tenants (line_user_id);

create table readings (
  id          text primary key,
  room_id     text not null references rooms(id) on delete cascade,
  period      text not null,
  water_prev  int, water_now int,
  elec_prev   int, elec_now  int,
  photo_key   text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  unique (room_id, period)
);

create table invoices (
  id         text primary key,
  room_id    text not null references rooms(id) on delete cascade,
  period     text not null,
  rent       int not null,
  total      int not null,
  due_date   date not null,
  status     text not null default 'unpaid' check (status in ('unpaid','pending','paid','void')),
  receipt_no text,
  created_at timestamptz not null default now(),
  paid_at    timestamptz,
  unique (room_id, period)
);
create index on invoices (status, due_date);

create table invoice_items (
  id         bigserial primary key,
  invoice_id text not null references invoices(id) on delete cascade,
  label      text not null,
  qty        int  not null,
  unit_price int  not null,
  amount     int  not null
);

create table payments (
  id          text primary key,
  invoice_id  text not null references invoices(id) on delete cascade,
  amount      int  not null,
  slip_key    text,
  verify_ok   boolean,
  verified_by text,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create table message_log (
  id         bigserial primary key,
  invoice_id text references invoices(id) on delete set null,
  kind       text not null,
  to_user_id text,
  sent_at    timestamptz not null default now(),
  line_status text
);
create index on message_log (invoice_id, kind);

create table audit_log (
  id          bigserial primary key,
  property_id text not null,
  actor       text,
  action      text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

alter table rooms         enable row level security;
alter table readings      enable row level security;
alter table invoices      enable row level security;
alter table invoice_items enable row level security;
alter table payments      enable row level security;
"""

# Children before parents, so foreign keys never block a drop.
TABLES = [
    "audit_log", "message_log", "payments", "invoice_items",
    "invoices", "readings", "tenants", "rooms", "properties",
]


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"drop table if exists {table}")
