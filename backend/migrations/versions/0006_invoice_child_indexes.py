"""Index the invoice foreign keys that every bill view and confirm/reject reads.

Postgres does not index foreign keys on its own. `invoice_items.invoice_id` and `payments.invoice_id`
are read on every bill view (items + latest payment) and on every confirm/reject, and `on delete
cascade` from invoices scans both tables. Without an index each of those is a sequential scan that
grows with every month of history.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-17
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The column order matches the queries' `order by id` and `order by created_at desc, id desc
    # limit 1`, so the index also returns rows already sorted.
    op.execute("create index if not exists invoice_items_invoice_id_idx on invoice_items (invoice_id, id)")
    op.execute("create index if not exists payments_invoice_id_idx on payments (invoice_id, created_at desc, id desc)")


def downgrade() -> None:
    op.execute("drop index if exists payments_invoice_id_idx")
    op.execute("drop index if exists invoice_items_invoice_id_idx")
