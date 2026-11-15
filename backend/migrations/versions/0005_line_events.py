"""LINE event ids, so a redelivery is recorded once (POST /v1/webhooks/line/:property_id).

LINE retries a delivery when it does not see the 200. Without this table a retry would add a second
`audit_log` row for an event that already arrived, and every later handler (when there is one) would
act twice.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

PROPERTY = "current_setting('app.property_id', true)"


def upgrade() -> None:
    op.execute("""
        create table line_events (
            event_id    text primary key,
            property_id text not null,
            received_at timestamptz not null default now()
        )
    """)
    # Same shape as 0004: forced policies, and a NULL setting matches nothing (fail closed).
    op.execute("alter table line_events enable row level security")
    op.execute("alter table line_events force row level security")
    op.execute(
        f"create policy line_events_property on line_events for all "
        f"using (property_id = {PROPERTY}) with check (property_id = {PROPERTY})"
    )
    # The runtime role is created outside migrations (docs/CONFIGURATION.md), so grant only if it
    # exists: a fresh database (CI) has no such role and must still migrate.
    op.execute("""
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'dormplus_app') then
                execute 'grant select, insert, update, delete on line_events to dormplus_app';
            end if;
        end $$
    """)


def downgrade() -> None:
    op.execute("drop table if exists line_events")
