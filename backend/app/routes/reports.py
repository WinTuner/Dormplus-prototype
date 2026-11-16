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
    select
      (select count(*) from rooms where property_id = :property_id) as rooms_total,
      coalesce(sum(i.total) filter (where i.status = 'paid'), 0) as paid,
      coalesce(sum(i.total) filter (where i.status = 'pending'), 0) as pending,
      coalesce(sum(i.total) filter (where i.status = 'unpaid'), 0) as unpaid,
      count(distinct i.room_id) filter (where i.status = 'paid') as rooms_paid,
      count(*) filter (where i.status = 'unpaid' and i.due_date < :day) as rooms_overdue
    from invoices i join rooms r on r.id = i.room_id
    where r.property_id = :property_id and i.period = :period
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
    # One round trip to Neon: the four numbers are one scan, not four.
    with engine.connect() as conn:
        row = conn.execute(SUMS_SQL, params).one()

    paid, pending, unpaid = int(row.paid), int(row.pending), int(row.unpaid)
    return ReportSummaryOut(
        billed=paid + pending + unpaid,
        paid=paid, pending=pending, unpaid=unpaid,
        rooms_total=int(row.rooms_total), rooms_paid=int(row.rooms_paid),
        rooms_overdue=int(row.rooms_overdue),
    )
