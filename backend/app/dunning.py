"""Dunning: find unpaid invoices that are 1, 5 or 10 days past due and queue one reminder each.

The reminder is queued only once per invoice and step — message_log is the ledger, so a job that
already ran (or was started by hand) is not queued twice. If the worker dies before writing the
log, the next run will queue it again (at-least-once, deliberately).
"""
from datetime import date

from sqlalchemy import Engine, text

from app.queue import app
from app.tasks import reminder_text
from app.ids import reminder_kind

REMINDER_DAYS = (1, 5, 10)

DUE_FOR_REMINDER_SQL = text("""
    select i.id, i.period, i.total, i.due_date, r.room_no, t.line_user_id,
           (:today - i.due_date) as days_late
    from invoices i
    join rooms r on r.id = i.room_id
    join lateral (
        select line_user_id
        from tenants
        where room_id = r.id
          and line_user_id is not null
          and (moved_out is null or moved_out > :today)
        order by moved_in desc nulls last
        limit 1
    ) t on true
    where r.property_id = :property_id
      and i.status = 'unpaid'
      and (:today - i.due_date) in (1, 5, 10)
      and not exists (
          select 1 from message_log m
          where m.invoice_id = i.id and m.kind = :kind_for_day
      )
    order by i.due_date, r.room_no
""")


def due_for_reminder(engine: Engine, property_id: str, today: date) -> list[dict]:
    """Rows that still need a reminder today (no queue involved — safe to unit test)."""
    rows: list[dict] = []
    for day in REMINDER_DAYS:
        kind = reminder_kind(day)
        with engine.connect() as conn:
            found = conn.execute(
                DUE_FOR_REMINDER_SQL,
                {"property_id": property_id, "today": today, "kind_for_day": kind},
            ).mappings().all()
        rows += [dict(row, kind=kind) for row in found]
    return rows


def queue_reminders(rows: list[dict]) -> int:
    """Hand each row to the worker. Returns how many jobs were queued."""
    if not rows:
        return 0
    with app.open():
        for row in rows:
            push = app.configure_task("line.push_text")
            push.defer(
                to_user_id=row["line_user_id"],
                body=reminder_text(row["room_no"], row["period"], row["total"], row["due_date"], row["days_late"]),
                invoice_id=row["id"],
                kind=row["kind"],
            )
    return len(rows)
