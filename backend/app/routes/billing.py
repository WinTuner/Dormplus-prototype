"""Billing and invoices: POST /v1/billing/run and GET /v1/invoices (docs/API.md)."""
import json
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import Connection, Engine, text

from app.auth import Session, owner_session, tenant_session
from app.clock import PERIOD_PATTERN, period_of, today
from app.db import get_engine
from app.errors import ApiError
from app.ids import invoice_id, payment_id

router = APIRouter(prefix="/v1", tags=["billing"])

Status = Literal["unpaid", "pending", "paid", "void"]


class BillingRunIn(BaseModel):
    period: str = Field(pattern=PERIOD_PATTERN, examples=["2026-11"])


class BillingRunOut(BaseModel):
    job_id: str | None  # LINE sending is not queued yet, so this stays null for now
    period: str
    rooms_to_bill: int
    skipped_no_reading: int
    skipped_no_previous_reading: int


class InvoiceRow(BaseModel):
    id: str
    room_no: str
    total: int
    status: Status
    due_date: date
    days_overdue: int


class InvoiceSummary(BaseModel):
    total: int
    paid: int
    pending: int
    unpaid: int


class InvoicesOut(BaseModel):
    period: str
    items: list[InvoiceRow]
    summary: InvoiceSummary


class SlipIn(BaseModel):
    slip_url: str | None = Field(default=None, max_length=500, examples=["s3://slips/203-1109.jpg"])


class SlipVerify(BaseModel):
    ok: bool | None = None  # null until someone (or an OCR service) checks the slip
    amount: int
    provider: str = "manual"


class SlipOut(BaseModel):
    status: Status
    verify: SlipVerify


class ConfirmOut(BaseModel):
    status: Status
    receipt_no: str
    paid_at: datetime


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class RejectOut(BaseModel):
    status: Status


# Every occupied room of the dorm, with this period's reading, the latest earlier reading and whether
# it already has an invoice. The previous reading is looked up now rather than trusting the copy stored
# when the meter was recorded, so a later fix to last month's meter still reaches this bill.
ROOMS_TO_BILL_SQL = text("""
    select r.id, r.rent, r.mode,
           cur.id as reading_id, cur.water_now, cur.elec_now,
           prev.water_now as water_prev, prev.elec_now as elec_prev,
           exists (select 1 from invoices i where i.room_id = r.id and i.period = :period) as billed
    from rooms r
    left join readings cur on cur.room_id = r.id and cur.period = :period
    left join lateral (
        select water_now, elec_now from readings p
        where p.room_id = r.id and p.period < :period
        order by p.period desc
        limit 1
    ) prev on true
    where r.property_id = :property_id and r.status = 'occupied'
    order by r.room_no
    for update of r
""")


@router.post("/billing/run", status_code=202, response_model=BillingRunOut)
def run_billing(
    body: BillingRunIn,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> BillingRunOut:
    """Bill every room that is ready and not billed yet for the period, all in one transaction.

    Meter rooms need this period's reading and an earlier one. Flat-rate rooms need no reading.
    Running it again bills only rooms that became ready since; with none left it answers 409.
    """
    with engine.begin() as conn:
        # Locking the dorm row makes two runs for the same dorm (a double click) wait for each other.
        prop = conn.execute(
            text("select water_rate, elec_rate, due_days from properties where id = :id for update"),
            {"id": session.property_id},
        ).first()
        if prop is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบหอ")

        rooms = conn.execute(ROOMS_TO_BILL_SQL, {"period": body.period, "property_id": session.property_id}).all()
        due = day + timedelta(days=prop.due_days)
        created: list[str] = []
        no_reading = no_previous = 0

        for room in rooms:
            if room.billed:
                continue
            items = [("ค่าเช่า", 1, room.rent)]
            if room.mode == "meter":
                if room.reading_id is None or room.water_now is None or room.elec_now is None:
                    no_reading += 1
                    continue
                if room.water_prev is None or room.elec_prev is None:
                    no_previous += 1
                    continue
                items += [
                    ("ค่าน้ำ", max(0, room.water_now - room.water_prev), prop.water_rate),
                    ("ค่าไฟ", max(0, room.elec_now - room.elec_prev), prop.elec_rate),
                ]
                # Keep the reading's stored "previous" in line with what was billed.
                conn.execute(
                    text("update readings set water_prev = :wp, elec_prev = :ep where id = :id"),
                    {"wp": room.water_prev, "ep": room.elec_prev, "id": room.reading_id},
                )
            new_id = create_invoice(conn, room.id, body.period, room.rent, items, due)
            if new_id:
                created.append(new_id)

        if not created and any(room.billed for room in rooms):
            raise ApiError(409, "CONFLICT", f"ออกบิลรอบ {body.period} ไปแล้ว ไม่มีห้องใหม่ให้ออกบิล")

        if created:
            conn.execute(
                text("""insert into audit_log (property_id, actor, action, payload)
                        values (:pid, :actor, 'billing.run', cast(:payload as jsonb))"""),
                {"pid": session.property_id, "actor": session.user_id,
                 "payload": json.dumps({"period": body.period, "invoice_ids": created})},
            )

    return BillingRunOut(job_id=None, period=body.period, rooms_to_bill=len(created),
                         skipped_no_reading=no_reading, skipped_no_previous_reading=no_previous)


def create_invoice(conn: Connection, room_id: str, period: str, rent: int,
                   items: list[tuple[str, int, int]], due: date) -> str | None:
    """Insert one invoice with its line items. Returns None if the room already has one for the period."""
    total = sum(qty * unit_price for _, qty, unit_price in items)
    row = conn.execute(
        text("""insert into invoices (id, room_id, period, rent, total, due_date, status)
                values (:id, :room, :period, :rent, :total, :due, 'unpaid')
                on conflict do nothing returning id"""),
        {"id": invoice_id(room_id, period), "room": room_id, "period": period,
         "rent": rent, "total": total, "due": due},
    ).first()
    if row is None:
        return None
    for label, qty, unit_price in items:
        conn.execute(
            text("""insert into invoice_items (invoice_id, label, qty, unit_price, amount)
                    values (:inv, :label, :qty, :price, :amount)"""),
            {"inv": row.id, "label": label, "qty": qty, "price": unit_price, "amount": qty * unit_price},
        )
    return row.id


@router.get("/invoices", response_model=InvoicesOut)
def list_invoices(
    period: str | None = Query(default=None, pattern=PERIOD_PATTERN, description="YYYY-MM, default this month"),
    status: Status | None = None,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> InvoicesOut:
    period = period or period_of(day)
    params = {"period": period, "property_id": session.property_id, "status": status}
    with engine.connect() as conn:
        rows = conn.execute(text("""
            select i.id, r.room_no, i.total, i.status, i.due_date
            from invoices i join rooms r on r.id = i.room_id
            where r.property_id = :property_id and i.period = :period
              and (cast(:status as text) is null or i.status = :status)
            order by r.room_no
        """), params).all()
        sums = dict(conn.execute(text("""
            select i.status, sum(i.total) from invoices i join rooms r on r.id = i.room_id
            where r.property_id = :property_id and i.period = :period
            group by i.status
        """), params).all())

    def days_overdue(status: str, due: date) -> int:
        # Only unpaid bills count: a slip waiting for the owner is not the tenant's delay.
        return max(0, (day - due).days) if status == "unpaid" else 0

    paid, pending, unpaid = (int(sums.get(s) or 0) for s in ("paid", "pending", "unpaid"))
    return InvoicesOut(
        period=period,
        items=[InvoiceRow(id=r.id, room_no=r.room_no, total=r.total, status=r.status, due_date=r.due_date,
                          days_overdue=days_overdue(r.status, r.due_date)) for r in rows],
        summary=InvoiceSummary(total=paid + pending + unpaid, paid=paid, pending=pending, unpaid=unpaid),
    )


# --- tenant attaches a slip, owner confirms or rejects it ---------------------------------------

# The room comes from the session, never from the request: a tenant can only reach their own bill.
OWN_INVOICE_SQL = text("""
    select i.id, i.total, i.status
    from invoices i
    where i.id = :id and i.room_id = :room_id
    for update
""")

PROPERTY_INVOICE_SQL = text("""
    select i.id, i.period, i.status
    from invoices i join rooms r on r.id = i.room_id
    where i.id = :id and r.property_id = :property_id
    for update of i
""")


@router.post("/invoices/{invoice_id}/slip", response_model=SlipOut)
def attach_slip(
    invoice_id: str,
    body: SlipIn,
    session: Session = Depends(tenant_session),
    engine: Engine = Depends(get_engine),
) -> SlipOut:
    """Tenant says "I paid, here is the slip" -> pending. Uploading the photo itself is not built yet,
    so slip_url is stored as given (null is fine for a walk-in slip)."""
    with engine.begin() as conn:
        row = conn.execute(OWN_INVOICE_SQL, {"id": invoice_id, "room_id": session.room_id}).first()
        if row is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบบิลนี้ในห้องของคุณ")
        if row.status != "unpaid":
            raise ApiError(409, "INVALID_STATE", f"บิลนี้อยู่ในสถานะ {row.status} จึงแนบสลิปไม่ได้")

        conn.execute(text("""
            insert into payments (id, invoice_id, amount, slip_key, verify_ok)
            values (:id, :invoice_id, :amount, :slip_key, null)
            on conflict (id) do update
                set slip_key = excluded.slip_key, verify_ok = null, verified_by = null, verified_at = null
        """), {"id": payment_id(row.id), "invoice_id": row.id, "amount": row.total, "slip_key": body.slip_url})
        conn.execute(text("update invoices set status = 'pending' where id = :id"), {"id": row.id})

    return SlipOut(status="pending", verify=SlipVerify(ok=None, amount=row.total))


@router.post("/invoices/{invoice_id}/confirm", response_model=ConfirmOut)
def confirm_invoice(
    invoice_id: str,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
) -> ConfirmOut:
    """Owner checks the slip and closes the bill: pending -> paid, with a receipt number."""
    with engine.begin() as conn:
        row = conn.execute(PROPERTY_INVOICE_SQL,
                           {"id": invoice_id, "property_id": session.property_id}).first()
        if row is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบบิลนี้ในหอของคุณ")
        if row.status != "pending":
            raise ApiError(409, "INVALID_STATE", f"บิลนี้อยู่ในสถานะ {row.status} จึงยืนยันไม่ได้")

        used = conn.execute(text("""
            select count(*) from invoices i join rooms r on r.id = i.room_id
            where r.property_id = :property_id and i.period = :period and i.receipt_no is not null
        """), {"property_id": session.property_id, "period": row.period}).scalar_one()
        receipt_no = f"REC-{row.period}-{used + 1:04d}"

        conn.execute(text("""
            update invoices set status = 'paid', receipt_no = :receipt_no, paid_at = now() where id = :id
        """), {"id": row.id, "receipt_no": receipt_no})
        conn.execute(text("""
            update payments set verify_ok = true, verified_by = :by, verified_at = now()
            where invoice_id = :id
        """), {"id": row.id, "by": session.user_id})
        conn.execute(text("""
            insert into audit_log (property_id, actor, action, payload)
            values (:pid, :actor, 'invoice.confirm', cast(:payload as jsonb))
        """), {"pid": session.property_id, "actor": session.user_id,
               "payload": json.dumps({"invoice_id": row.id, "receipt_no": receipt_no})})
        paid_at = conn.execute(text("select paid_at from invoices where id = :id"),
                               {"id": row.id}).scalar_one()

    return ConfirmOut(status="paid", receipt_no=receipt_no, paid_at=paid_at)


@router.post("/invoices/{invoice_id}/reject", response_model=RejectOut)
def reject_slip(
    invoice_id: str,
    body: RejectIn,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
) -> RejectOut:
    """Owner says the slip is wrong: pending -> unpaid so the tenant can pay again."""
    with engine.begin() as conn:
        row = conn.execute(PROPERTY_INVOICE_SQL,
                           {"id": invoice_id, "property_id": session.property_id}).first()
        if row is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบบิลนี้ในหอของคุณ")
        if row.status != "pending":
            raise ApiError(409, "INVALID_STATE", f"บิลนี้อยู่ในสถานะ {row.status} จึงตีกลับไม่ได้")

        conn.execute(text("update invoices set status = 'unpaid' where id = :id"), {"id": row.id})
        conn.execute(text("""
            update payments set verify_ok = false, verified_by = :by, verified_at = now()
            where invoice_id = :id
        """), {"id": row.id, "by": session.user_id})
        conn.execute(text("""
            insert into audit_log (property_id, actor, action, payload)
            values (:pid, :actor, 'invoice.reject', cast(:payload as jsonb))
        """), {"pid": session.property_id, "actor": session.user_id,
               "payload": json.dumps({"invoice_id": row.id, "reason": body.reason})})

    return RejectOut(status="unpaid")
