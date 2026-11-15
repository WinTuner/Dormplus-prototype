"""GET /v1/reports/summary — one period's money and room counts (docs/API.md)."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import Engine, text

from app.auth import Session, owner_session
from app.clock import PERIOD_PATTERN, period_of, today
from app.db import get_engine

router = APIRouter(prefix="/v1", tags=["reports"])

PARAMS = ("property_id", "period")


class ReportSummaryOut(BaseModel):
    billed: int
    paid: int
    pending: int
    unpaid: int
    rooms_total: int
    rooms_paid: int
    rooms_overdue: int


SUMS_SQL = text("""
    select i.status, sum(i.total)
    from invoices i join rooms r on r.id = i.room_id
    where r.property_id = :property_id and i.period = :period
    group by i.status
""")

ROOMS_PAID_SQL = text("""
    select count(distinct i.room_id)
    from invoices i join rooms r on r.id = i.room_id
    where r.property_id = :property_id and i.period = :period and i.status = 'paid'
""")

ROOMS_OVERDUE_SQL = text("""
    select count(*)
    from invoices i join rooms r on r.id = i.room_id
    where r.property_id = :property_id and i.period = :period
      and i.status = 'unpaid' and i.due_date < :day
""")


@router.get("/reports/summary", response_model=ReportSummaryOut)
def summary(
    period: str | None = Query(default=None, pattern=PERIOD_PATTERN, description="YYYY-MM, default this month"),
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> ReportSummaryOut:
    """Money and rooms for one period.

    `billed` is paid + pending + unpaid, so it always agrees with `GET /v1/invoices`; voided bills
    are not money anyone owes. `rooms_total` counts every room of the dorm, billed or not.
    """
    period = period or period_of(day)
    params = {"property_id": session.property_id, "period": period, "day": day}
    with engine.connect() as conn:
        sums = dict(conn.execute(SUMS_SQL, params).all())
        rooms_total = conn.execute(
            text("select count(*) from rooms where property_id = :property_id"),
            {"property_id": session.property_id},
        ).scalar_one()
        rooms_paid = conn.execute(ROOMS_PAID_SQL, params).scalar_one()
        rooms_overdue = conn.execute(ROOMS_OVERDUE_SQL, params).scalar_one()

    paid, pending, unpaid = (int(sums.get(s) or 0) for s in ("paid", "pending", "unpaid"))
    return ReportSummaryOut(
        billed=paid + pending + unpaid,
        paid=paid, pending=pending, unpaid=unpaid,
        rooms_total=rooms_total, rooms_paid=rooms_paid, rooms_overdue=rooms_overdue,
    )
