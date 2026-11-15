"""GET /v1/properties/{id} — the settings of the dorm the caller is signed in to."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import Engine, text

from app.auth import Session, owner_session
from app.db import get_engine
from app.errors import ApiError

router = APIRouter(prefix="/v1", tags=["properties"])


class PropertyOut(BaseModel):
    id: str
    name: str
    billing_mode: str
    water_rate: int
    elec_rate: int
    due_days: int
    rooms: int


PROPERTY_SQL = text("""
    select p.id, p.name, p.billing_mode, p.water_rate, p.elec_rate, p.due_days,
           (select count(*) from rooms r where r.property_id = p.id) as rooms
    from properties p
    where p.id = :id
""")


@router.get("/properties/{property_id}", response_model=PropertyOut)
def get_property(
    property_id: str,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
) -> PropertyOut:
    """A dorm's own settings. Another dorm's id answers 404 — never 403 — so the caller cannot
    learn whether that dorm exists (docs/API.md)."""
    if property_id != session.property_id:
        raise ApiError(404, "NOT_FOUND", "ไม่พบหอนี้")
    with engine.connect() as conn:
        row = conn.execute(PROPERTY_SQL, {"id": property_id}).first()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "ไม่พบหอนี้")
    return PropertyOut(**row._mapping)
