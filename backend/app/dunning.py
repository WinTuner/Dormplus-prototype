"""Dunning: find unpaid invoices that are 1, 5 or 10 days past due and queue one reminder each.

Each invoice is at one step: 1 (1-4 days late), 5 (5-9 days) or 10 (10 days or more). Its reminder
for that step is queued until message_log holds a row for it with line_status 'ok', so:
- a day the cron did not run is caught up the next day instead of skipping the step for good
- a push LINE refused is tried again on the next run
- a step already sent is never queued twice (at-least-once if the worker dies mid-job)
"""
from datetime import date

from sqlalchemy import Engine, text

from app.ids import reminder_kind

# Set only by tests (a fake queue). Left as None, the real one is imported on first use: procrastinate
# is slow to import and must not be paid for by requests that never queue a message.
app = None

DUE_FOR_REMINDER_SQL = text("""
    select i.id, i.period, i.total, i.due_date, r.room_no, t.line_user_id,
           (:today - i.due_date) as days_late,
           case
             when (:today - i.due_date) >= 10 then :kind_10
             when (:today - i.due_date) >= 5 then :kind_5
             else :kind_1
           end as kind
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
      and (:today - i.due_date) >= 1
      and not exists (
          select 1 from message_log m
          where m.invoice_id = i.id
            and m.kind = case
              when (:today - i.due_date) >= 10 then :kind_10
              when (:today - i.due_date) >= 5 then :kind_5
              else :kind_1
            end
            and m.line_status = 'ok'
      )
    order by case
               when (:today - i.due_date) >= 10 then 10
               when (:today - i.due_date) >= 5 then 5
               else 1
             end,
             i.due_date, r.room_no
""")


def due_for_reminder(engine: Engine, property_id: str, today: date) -> list[dict]:
    """Rows that still need a reminder today (no queue involved — safe to unit test)."""
    params = {
        "property_id": property_id,
        "today": today,
        "kind_1": reminder_kind(1),
        "kind_5": reminder_kind(5),
        "kind_10": reminder_kind(10),
    }
    with engine.connect() as conn:
        found = conn.execute(DUE_FOR_REMINDER_SQL, params).mappings().all()
    return [dict(row) for row in found]


def queue_reminders(rows: list[dict]) -> int:
    """Hand each row to the worker. Returns how many jobs were queued."""
    if not rows:
        return 0
    from app.tasks import reminder_text

    if app is None:
        from app.queue import get_app

        queue = get_app()
    else:
        queue = app
    with queue.open():
        for row in rows:
            push = queue.configure_task("line.push_text")
            push.defer(
                to_user_id=row["line_user_id"],
                body=reminder_text(row["room_no"], row["period"], row["total"], row["due_date"], row["days_late"]),
                invoice_id=row["id"],
                kind=row["kind"],
            )
    return len(rows)
