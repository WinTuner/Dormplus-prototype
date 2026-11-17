"""Queue the "your bill is ready" message for each new invoice.

Kept out of `app.tasks` on purpose: the task is what the worker runs, this is the API deciding how
many messages to enqueue. Same shape as `app.dunning.queue_reminders`.
"""

# Set only by tests (a fake queue). Left as None, the real one is imported on first use: procrastinate
# is slow to import and must not be paid for by requests that never queue a message.
app = None


def notify_invoices(rows: list[dict]) -> tuple[int, str | None]:
    """Queue one LINE message per row. Returns (how many were queued, the first job id).

    A row without `line_user_id` is skipped: the invoice is still real, there is just nobody to
    message. The caller decides what to do with the gap.
    """
    sendable = [row for row in rows if row.get("line_user_id")]
    if not sendable:
        return 0, None
    from app.tasks import invoice_text

    if app is None:
        from app.queue import get_app

        queue = get_app()
    else:
        queue = app
    first: str | None = None
    with queue.open():
        for row in sendable:
            job_id = queue.configure_task("line.push_text").defer(
                to_user_id=row["line_user_id"],
                body=invoice_text(row["room_no"], row["period"], row["total"], row["due_date"]),
                invoice_id=row["id"],
                kind="invoice",
            )
            if first is None and job_id is not None:
                first = str(job_id)
    return len(sendable), first
