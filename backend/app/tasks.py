"""Queued tasks: the only place that talks to a LINE user.

Keep them small — a worker may retry them.
"""
from sqlalchemy import text

from app import line_push
from app.db import get_engine
from app.queue import app


@app.task(name="line.push_text", retry=3)
def push_text(to_user_id: str, body: str, invoice_id: str | None = None, kind: str = "message") -> str:
    """Push one text message and record it in message_log either way."""
    status = line_push.push_text(to_user_id, body)
    with get_engine().begin() as conn:
        conn.execute(
            text("""
                insert into message_log (invoice_id, kind, to_user_id, line_status)
                values (:invoice_id, :kind, :to, :status)
            """),
            {"invoice_id": invoice_id, "kind": kind, "to": to_user_id, "status": status},
        )
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
