"""Queue the "your bill is ready" message for each new invoice.

Kept out of `app.tasks` on purpose: the task is what the worker runs, this is the API deciding how
many messages to enqueue. Same shape as `app.dunning.queue_reminders`.
"""
from app.queue import app
from app.tasks import invoice_text


def notify_invoices(rows: list[dict]) -> tuple[int, str | None]:
    """Queue one LINE message per row. Returns (how many were queued, the first job id).

    A row without `line_user_id` is skipped: the invoice is still real, there is just nobody to
    message. The caller decides what to do with the gap.
    """
    sendable = [row for row in rows if row.get("line_user_id")]
    if not sendable:
        return 0, None
    first: str | None = None
    with app.open():
        for row in sendable:
            job_id = app.configure_task("line.push_text").defer(
                to_user_id=row["line_user_id"],
                body=invoice_text(row["room_no"], row["period"], row["total"], row["due_date"]),
                invoice_id=row["id"],
                kind="invoice",
            )
            if first is None and job_id is not None:
                first = str(job_id)
    return len(sendable), first
