"""What this backend answers when a Messaging API event arrives.

Two answers for now: a welcome on `follow`, and the tenant's newest bill as text when they type
"บิล". Text, not a Flex card: the cards are built in `line-app`, and this backend has no card
builder to drift from them. Everything else is recorded by the route and ignored here.

The live bot still runs in `line-app` — the console stays pointed there until the bills tenants
see also live in this database (they do not: bills are in the Blob/R2 store). See
docs/DEPLOYMENT.md § "สลับ webhook มาที่ backend".
"""
import logging
from datetime import date

from sqlalchemy import Connection, text

from app import line_push

logger = logging.getLogger(__name__)

BILL_WORDS = {"บิล", "bill", "ใบเสร็จ", "invoice"}

WELCOME = ("ยินดีต้อนรับครับ 🏠\n"
           "สแกน QR ที่ป้ายหน้าห้องเพื่อผูกห้องกับ LINE นี้ "
           "แล้วพิมพ์ \"บิล\" เพื่อดูบิลล่าสุด")
NO_ROOM = "ยังไม่ได้ผูกห้องกับระบบนี้ครับ — สแกน QR ที่ป้ายหน้าห้องก่อน"
NO_BILL = "ห้อง {room} ยังไม่มีบิลในระบบครับ"

STATUS = {"unpaid": "รอชำระ", "pending": "รอตรวจสลิป", "paid": "ชำระแล้ว"}
MONTHS = ("ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
          "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.")

# One row per person: a tenant who moved out is not the tenant of the room any more.
TENANT_ROOM_SQL = text("""
    select r.room_no
    from tenants t
    join rooms r on r.id = t.room_id
    where t.line_user_id = :uid
      and (t.moved_out is null or t.moved_out > (now() at time zone 'Asia/Bangkok')::date)
    order by t.moved_in desc nulls last
    limit 1
""")

LATEST_INVOICE_SQL = text("""
    select i.period, i.total, i.due_date, i.status
    from invoices i
    join rooms r on r.id = i.room_id
    where r.room_no = :room_no and i.status <> 'void'
    order by i.period desc
    limit 1
""")


def thai_date(day: date) -> str:
    """9 พ.ย. 2569 — the way the rent notice writes a date."""
    return f"{day.day} {MONTHS[day.month - 1]} {day.year + 543}"


def handle(event: dict, conn: Connection) -> str | None:
    """Answer one event. Returns the reply we sent (None when there was nothing to say)."""
    kind = event.get("type")

    if kind == "follow":
        return answer(event, WELCOME)

    message = event.get("message") or {}
    if kind == "message" and message.get("type") == "text":
        if (message.get("text") or "").strip().lower() in BILL_WORDS:
            return answer(event, bill_text((event.get("source") or {}).get("userId"), conn))

    return None


def bill_text(user_id: str | None, conn: Connection) -> str:
    """The tenant's newest bill, or the reason there is none."""
    if not user_id:
        return NO_ROOM
    room = conn.execute(TENANT_ROOM_SQL, {"uid": user_id}).scalar()
    if not room:
        return NO_ROOM

    bill = conn.execute(LATEST_INVOICE_SQL, {"room_no": room}).first()
    if not bill:
        return NO_BILL.format(room=room)

    period, total, due, status = bill
    return (f"ห้อง {room} · รอบ {period}\n"
            f"ยอด {total:,} บาท\n"
            f"ครบกำหนด {thai_date(due)}\n"
            f"สถานะ: {STATUS.get(status, status)}")


def answer(event: dict, message: str) -> str | None:
    """Send a reply when LINE gave us a token; a failed send must never fail the webhook."""
    token = event.get("replyToken")
    if not token:
        return None
    result = line_push.reply_text(token, message)
    if result != "ok":
        logger.info("line reply not sent: %s", result)
    return message
