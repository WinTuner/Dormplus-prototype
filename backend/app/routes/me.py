"""What the logged-in tenant sees: their own invoices only."""
from fastapi import APIRouter, Depends
from sqlalchemy import Engine, text

from app.auth import Session, tenant_session
from app.db import get_engine

router = APIRouter(prefix="/v1/me", tags=["me"])

MY_INVOICES_SQL = text("""
    select i.id, i.period, i.total, i.status, i.due_date
    from invoices i
    where i.room_id = :room_id
      and (cast(:since as text) is null or i.period >= :since)
    order by i.period desc
    limit 12
""")


@router.get("/invoices")
def my_invoices(
    session: Session = Depends(tenant_session),
    engine: Engine = Depends(get_engine),
) -> dict:
    """The room comes from the session cookie, never from the request."""
    with engine.connect() as conn:
        rows = conn.execute(
            MY_INVOICES_SQL, {"room_id": session.room_id, "since": session.since}
        ).all()

    return {
        "items": [
            {
                "id": row.id,
                "period": row.period,
                "total": row.total,
                "status": row.status,
                "due_date": row.due_date,
            }
            for row in rows
        ]
    }
