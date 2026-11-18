"""Queued tasks: the only place that talks to a LINE user.

Keep them small — a worker may retry them.
"""
import uuid

from sqlalchemy import text

from app import line_push
from app.clock import today
from app.db import get_engine
from app.queue import app


class PushFailed(RuntimeError):
    """LINE did not take the message. Raising it lets Procrastinate retry the job."""


def retry_key_for(invoice_id: str | None, kind: str) -> str | None:
    """A stable key per (invoice, kind, Bangkok day) so a retry cannot send the same text twice.

    LINE holds a retry key for 24 hours. The day is part of the key on purpose: tomorrow's reminder
    is a new message, today's retry is not.
    """
    if not invoice_id:
        return None
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"line-push:{invoice_id}:{kind}:{today().isoformat()}"))


@app.task(name="line.push_text", retry=3)
def push_text(to_user_id: str, body: str, invoice_id: str | None = None, kind: str = "message") -> str:
    """Push one text message and record every attempt in message_log.

    Only a row with line_status 'ok' counts as sent (app/dunning.py), so a failed push is retried
    by the queue now and picked up again by tomorrow's dunning run if all retries fail."""
    status = line_push.push_text(to_user_id, body, retry_key=retry_key_for(invoice_id, kind))
    with get_engine().begin() as conn:
        conn.execute(
            text("""
                insert into message_log (invoice_id, kind, to_user_id, line_status)
                values (:invoice_id, :kind, :to, :status)
            """),
            {"invoice_id": invoice_id, "kind": kind, "to": to_user_id, "status": status},
        )
    if status.startswith("error"):
        raise PushFailed(status)
    return status


def money(amount: int) -> str:
    return f"{amount:,}"


def invoice_text(room_no: str, period: str, total: int, due_date) -> str:
    return f"ใบแจ้งหนี้ ห้อง {room_no}\nรอบ {period} ยอด {money(total)} บาท\nครบกำหนด {due_date}"


def reminder_text(room_no: str, period: str, total: int, due_date, days_late: int) -> str:
    return (
        f"แจ้งเตือนค่าเช่า ห้อง {room_no}\n"
        f"รอบ {period} ยอด {money(total)} บาท\n"
        f"ครบกำหนด {due_date} — เลยมา {days_late} วัน\n\n"
        "ถ้าชำระแล้วแนบสลิปในลิงก์บิลได้เลยครับ"
    )
