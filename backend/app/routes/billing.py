"""Billing and invoices: POST /v1/billing/run and GET /v1/invoices (docs/API.md)."""
import json
import logging
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import Engine, text

from app.auth import Session, current_session, owner_session, tenant_session
from app.clock import PERIOD_PATTERN, period_of, today
from app.db import get_engine
from app.errors import ApiError
from app.ids import invoice_id, payment_id
from app.notify import notify_invoices
from app.routes.cron import drain_queue

router = APIRouter(prefix="/v1", tags=["billing"])
logger = logging.getLogger(__name__)

Status = Literal["unpaid", "pending", "paid", "void"]


class BillingRunIn(BaseModel):
    period: str = Field(pattern=PERIOD_PATTERN, examples=["2026-11"])


class BillingRunOut(BaseModel):
    job_id: str | None  # the first queued LINE job, when at least one message went to the queue
    period: str
    rooms_to_bill: int
    skipped_no_reading: int
    skipped_no_previous_reading: int
    queued: int = 0     # messages handed to the queue: rooms with a tenant linked to LINE
    drained: bool = False  # whether this request also sent them


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


class InvoiceItemOut(BaseModel):
    label: str
    qty: int
    unit_price: int
    amount: int


class PaymentOut(BaseModel):
    amount: int
    slip_key: str | None
    verify_ok: bool | None
    verified_at: datetime | None


class InvoiceDetailOut(BaseModel):
    id: str
    period: str
    room_no: str
    items: list[InvoiceItemOut]
    total: int
    status: Status
    due_date: date
    payment: PaymentOut | None


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


# One row per new invoice, carrying the single tenant to message: the newest one still in the room,
# the same rule dunning uses, so a room with roommates does not get two of every message.
NOTIFY_ROWS_SQL = text("""
    select i.id, i.period, i.total, i.due_date, r.room_no, t.line_user_id
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
    where r.property_id = :property_id and i.id = any(cast(:ids as text[]))
    order by r.room_no
""")


# The three bulk statements of a billing run. Arrays are unnested instead of looping so that a
# 42-room dorm costs a handful of round trips (each one is a network hop to Neon while the dorm
# row lock is held) instead of ~130.
INSERT_INVOICES_SQL = text("""
    insert into invoices (id, room_id, period, rent, total, due_date, status)
    select v.id, v.room_id, :period, v.rent, v.total, :due, 'unpaid'
    from unnest(cast(:ids as text[]), cast(:room_ids as text[]), cast(:rents as int[]),
                cast(:totals as int[])) as v(id, room_id, rent, total)
    on conflict do nothing
    returning id
""")

# `with ordinality` + order by keeps the items in the order they were computed (rent, water, power).
INSERT_ITEMS_SQL = text("""
    insert into invoice_items (invoice_id, label, qty, unit_price, amount)
    select v.invoice_id, v.label, v.qty, v.unit_price, v.amount
    from unnest(cast(:invoice_ids as text[]), cast(:labels as text[]), cast(:qtys as int[]),
                cast(:prices as int[]), cast(:amounts as int[])) with ordinality
         as v(invoice_id, label, qty, unit_price, amount, n)
    order by v.n
""")

UPDATE_READINGS_SQL = text("""
    update readings r set water_prev = v.water_prev, elec_prev = v.elec_prev
    from unnest(cast(:ids as text[]), cast(:water_prevs as int[]), cast(:elec_prevs as int[]))
         as v(id, water_prev, elec_prev)
    where r.id = v.id
""")


@router.post("/billing/run", status_code=202, response_model=BillingRunOut)
async def run_billing(
    body: BillingRunIn,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> BillingRunOut:
    """Bill every room that is ready and not billed yet for the period, all in one transaction.

    Meter rooms need this period's reading and an earlier one. Flat-rate rooms need no reading.
    Running it again bills only rooms that became ready since; with none left it answers 409.
    """
    # The route stays `async` only for the final drain. All the database and queue work is
    # synchronous (SQLAlchemy sync engine, procrastinate's sync connector), so it goes to a worker
    # thread; run directly it would freeze the event loop for the whole run.
    result = await run_in_threadpool(_bill_and_enqueue, engine, session, body.period, day)
    created, no_reading, no_previous, queued, first = result

    drained = False
    if queued:  # draining an empty queue would only open a connection
        try:
            await drain_queue()
            drained = True
        except Exception:  # noqa: BLE001 - the jobs are queued; the next drain sends them
            logger.exception("draining the invoice queue failed for %s", body.period)

    return BillingRunOut(job_id=str(first) if first else None, period=body.period,
                         rooms_to_bill=created, skipped_no_reading=no_reading,
                         skipped_no_previous_reading=no_previous, queued=queued, drained=drained)


def _bill_and_enqueue(engine: Engine, session: Session, period: str,
                      day: date) -> tuple[int, int, int, int, str | None]:
    """Synchronous part of a billing run. Returns (created, no_reading, no_previous, queued, first_job)."""
    with engine.begin() as conn:
        # Locking the dorm row makes two runs for the same dorm (a double click) wait for each other.
        prop = conn.execute(
            text("select water_rate, elec_rate, due_days from properties where id = :id for update"),
            {"id": session.property_id},
        ).first()
        if prop is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบหอ")

        rooms = conn.execute(ROOMS_TO_BILL_SQL, {"period": period, "property_id": session.property_id}).all()
        due = day + timedelta(days=prop.due_days)
        no_reading = no_previous = 0

        # The loop only computes; everything is written afterwards in a few bulk statements.
        planned: list[tuple[str, int, int, list[tuple[str, int, int]]]] = []  # room, rent, total, items
        reading_fixes: list[tuple[str, int, int]] = []  # reading id, water_prev, elec_prev
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
                reading_fixes.append((room.reading_id, room.water_prev, room.elec_prev))
            total = sum(qty * unit_price for _, qty, unit_price in items)
            planned.append((room.id, room.rent, total, items))

        if reading_fixes:
            conn.execute(UPDATE_READINGS_SQL, {
                "ids": [r[0] for r in reading_fixes],
                "water_prevs": [r[1] for r in reading_fixes],
                "elec_prevs": [r[2] for r in reading_fixes],
            })

        created: list[str] = []
        if planned:
            ids = [invoice_id(room_id, period) for room_id, _, _, _ in planned]
            created = [row.id for row in conn.execute(INSERT_INVOICES_SQL, {
                "period": period, "due": due, "ids": ids,
                "room_ids": [p[0] for p in planned],
                "rents": [p[1] for p in planned],
                "totals": [p[2] for p in planned],
            })]
            # Items only for invoices that were really inserted (a conflict inserted nothing).
            inserted = set(created)
            lines = [(inv_id, label, qty, price)
                     for inv_id, (_, _, _, items) in zip(ids, planned) if inv_id in inserted
                     for label, qty, price in items]
            if lines:
                conn.execute(INSERT_ITEMS_SQL, {
                    "invoice_ids": [ln[0] for ln in lines],
                    "labels": [ln[1] for ln in lines],
                    "qtys": [ln[2] for ln in lines],
                    "prices": [ln[3] for ln in lines],
                    "amounts": [ln[2] * ln[3] for ln in lines],
                })

        if not created and any(room.billed for room in rooms):
            raise ApiError(409, "CONFLICT", f"ออกบิลรอบ {period} ไปแล้ว ไม่มีห้องใหม่ให้ออกบิล")

        if created:
            conn.execute(
                text("""insert into audit_log (property_id, actor, action, payload)
                        values (:pid, :actor, 'billing.run', cast(:payload as jsonb))"""),
                {"pid": session.property_id, "actor": session.user_id,
                 "payload": json.dumps({"period": period, "invoice_ids": created})},
            )

    # The bills are committed. Everything below is the message about them, and a queue that is not
    # set up must not turn a saved billing run into an error for the owner.
    queued, first = 0, None
    if created:
        try:
            with engine.connect() as conn:
                rows = conn.execute(
                    NOTIFY_ROWS_SQL,
                    {"property_id": session.property_id, "today": day, "ids": created},
                ).mappings().all()
            queued, first = notify_invoices([dict(row) for row in rows])
        except Exception:  # noqa: BLE001 - logged, and the answer still explains the run
            logger.exception("invoice notify failed for %s bills of %s", len(created), period)
            queued, first = 0, None
    return len(created), no_reading, no_previous, queued, first


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


INVOICE_DETAIL_SQL = text("""
    select i.id, i.period, i.total, i.status, i.due_date, r.room_no
    from invoices i join rooms r on r.id = i.room_id
    where i.id = :id and r.property_id = :property_id
      and (cast(:room_id as text) is null or i.room_id = :room_id)
""")


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetailOut)
def get_invoice(
    invoice_id: str,
    session: Session = Depends(current_session),
    engine: Engine = Depends(get_engine),
) -> InvoiceDetailOut:
    """One bill with its line items and latest payment.

    An owner sees any bill of their dorm; a tenant sees only their own room's. Anything else is
    404 rather than 403, so the caller cannot learn that the bill exists (docs/API.md).
    """
    room_id = session.room_id if session.role == "tenant" else None
    if session.role == "tenant" and not room_id:
        # Without this the query would drop the room filter and show a roomless tenant the whole
        # dorm. Fail closed, like every other tenant route.
        raise ApiError(403, "FORBIDDEN", "เฉพาะผู้เช่าที่ผูกห้องแล้ว")
    with engine.connect() as conn:
        row = conn.execute(
            INVOICE_DETAIL_SQL,
            {"id": invoice_id, "property_id": session.property_id, "room_id": room_id},
        ).first()
        if row is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบบิลนี้")
        items = conn.execute(
            text("select label, qty, unit_price, amount from invoice_items "
                 "where invoice_id = :id order by id"),
            {"id": invoice_id},
        ).all()
        payment = conn.execute(
            text("select amount, slip_key, verify_ok, verified_at from payments "
                 "where invoice_id = :id order by created_at desc, id desc limit 1"),
            {"id": invoice_id},
        ).first()

    return InvoiceDetailOut(
        id=row.id, period=row.period, room_no=row.room_no, total=row.total, status=row.status,
        due_date=row.due_date,
        items=[InvoiceItemOut(**item._mapping) for item in items],
        payment=PaymentOut(**payment._mapping) if payment is not None else None,
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
        # Receipt numbers are "how many receipts this period + 1", so two confirms in the same dorm
        # at the same moment would both count the same and hand out one number twice. Locking the
        # dorm row first makes them take turns. Dorm first, invoice second: the same order as
        # run_billing, so the two cannot deadlock each other.
        conn.execute(text("select id from properties where id = :id for update"),
                     {"id": session.property_id})
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
