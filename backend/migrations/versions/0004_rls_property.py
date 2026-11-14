"""Row level security: every dorm-scoped table only shows rows of one property.

The application sets `app.property_id` on each connection (app/db.py) from the deployment's
PROPERTY_ID, so a query that forgets `where property_id = ...` still cannot read another dorm.
`force row level security` matters: the app connects as the table owner, and an owner bypasses
policies otherwise — which is exactly why the `enable row level security` in 0001 had no effect.

A policy whose predicate is NULL (setting missing) matches nothing, so a connection that never set
it reads no rows rather than all of them.

`auth_failures` is deliberately left out: it is keyed by LINE user, not by dorm.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-15
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

PROPERTY = "current_setting('app.property_id', true)"

# table -> predicate over that table's own columns
POLICIES = {
    "properties": f"id = {PROPERTY}",
    "rooms": f"property_id = {PROPERTY}",
    "tenants": f"exists (select 1 from rooms r where r.id = tenants.room_id and r.property_id = {PROPERTY})",
    "readings": f"exists (select 1 from rooms r where r.id = readings.room_id and r.property_id = {PROPERTY})",
    "invoices": f"exists (select 1 from rooms r where r.id = invoices.room_id and r.property_id = {PROPERTY})",
    "invoice_items": (
        "exists (select 1 from invoices i join rooms r on r.id = i.room_id "
        f"where i.id = invoice_items.invoice_id and r.property_id = {PROPERTY})"
    ),
    "payments": (
        "exists (select 1 from invoices i join rooms r on r.id = i.room_id "
        f"where i.id = payments.invoice_id and r.property_id = {PROPERTY})"
    ),
    # A message about no particular invoice (a plain notice) has no dorm to check; keep it.
    "message_log": (
        "invoice_id is null or exists (select 1 from invoices i join rooms r on r.id = i.room_id "
        f"where i.id = message_log.invoice_id and r.property_id = {PROPERTY})"
    ),
    "audit_log": f"property_id = {PROPERTY}",
    "link_codes": f"property_id = {PROPERTY}",
}


def upgrade() -> None:
    for table, predicate in POLICIES.items():
        op.execute(f"alter table {table} enable row level security")
        op.execute(f"alter table {table} force row level security")
        op.execute(f"drop policy if exists {table}_property on {table}")
        op.execute(
            f"create policy {table}_property on {table} for all "
            f"using ({predicate}) with check ({predicate})"
        )


def downgrade() -> None:
    for table in POLICIES:
        op.execute(f"drop policy if exists {table}_property on {table}")
        op.execute(f"alter table {table} no force row level security")
