"""Rooms and meter readings: GET /v1/rooms and PUT /v1/rooms/{room_id}/reading (docs/API.md)."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import Engine, text

from app.auth import Session, owner_session
from app.clock import PERIOD_PATTERN, period_of, today
from app.db import get_engine
from app.errors import ApiError
from app.ids import reading_id

router = APIRouter(prefix="/v1", tags=["rooms"])


class TenantOut(BaseModel):
    name: str | None
    line_linked: bool


class ReadingOut(BaseModel):
    water_prev: int | None
    water_now: int | None
    elec_prev: int | None
    elec_now: int | None


class InvoiceBrief(BaseModel):
    id: str
    total: int
    status: str
    due_date: date


class RoomOut(BaseModel):
    id: str
    room_no: str
    rent: int
    mode: str
    tenant: TenantOut | None
    reading: ReadingOut | None
    invoice: InvoiceBrief | None


class RoomsOut(BaseModel):
    period: str
    items: list[RoomOut]


class ReadingIn(BaseModel):
    period: str = Field(pattern=PERIOD_PATTERN, examples=["2026-11"])
    # int4 columns: a larger number would reach Postgres as a NumericValueOutOfRange 500.
    water_now: int = Field(ge=0, le=2_147_483_647)
    elec_now: int = Field(ge=0, le=2_147_483_647)
    photo_url: str | None = Field(default=None, max_length=500)


class ReadingResult(BaseModel):
    water_units: int
    elec_units: int
    # METER_DECREASED: lower than last time (saved anyway, units count as 0).
    # NO_PREVIOUS_READING: first reading for this room, so there is nothing to subtract yet.
    warning: Literal["METER_DECREASED", "NO_PREVIOUS_READING"] | None


ROOMS_SQL = text("""
    select r.id, r.room_no, r.rent, r.mode,
           t.name as tenant_name, t.line_user_id,
           (t.room_id is not null) as has_tenant,
           rd.id as reading_id, rd.water_prev, rd.water_now, rd.elec_prev, rd.elec_now,
           i.id as invoice_id, i.total, i.status, i.due_date
    from rooms r
    left join lateral (
        select room_id, name, line_user_id from tenants
        where room_id = r.id
          and (moved_out is null or moved_out > (now() at time zone 'Asia/Bangkok')::date)
        order by moved_in desc nulls last, id
        limit 1
    ) t on true
    left join readings rd on rd.room_id = r.id and rd.period = :period
    left join invoices i on i.room_id = r.id and i.period = :period
    where r.property_id = :property_id
    order by r.room_no
""")


@router.get("/rooms", response_model=RoomsOut)
def list_rooms(
    period: str | None = Query(default=None, pattern=PERIOD_PATTERN, description="YYYY-MM, default this month"),
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> RoomsOut:
    period = period or period_of(day)
    with engine.connect() as conn:
        rows = conn.execute(ROOMS_SQL, {"period": period, "property_id": session.property_id}).all()
    return RoomsOut(period=period, items=[room_out(row) for row in rows])


def room_out(row) -> RoomOut:
    return RoomOut(
        id=row.id,
        room_no=row.room_no,
        rent=row.rent,
        mode=row.mode,
        tenant=TenantOut(name=row.tenant_name, line_linked=row.line_user_id is not None) if row.has_tenant else None,
        reading=ReadingOut(water_prev=row.water_prev, water_now=row.water_now,
                           elec_prev=row.elec_prev, elec_now=row.elec_now) if row.reading_id else None,
        invoice=InvoiceBrief(id=row.invoice_id, total=row.total, status=row.status,
                             due_date=row.due_date) if row.invoice_id else None,
    )


@router.put("/rooms/{room_id}/reading", response_model=ReadingResult)
def put_reading(
    room_id: str,
    body: ReadingIn,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
) -> ReadingResult:
    """Save this period's meter reading. Sending it again overwrites it, until the room is billed."""
    with engine.begin() as conn:
        # Lock the room so billing for it cannot start halfway through this write.
        room = conn.execute(
            text("select property_id from rooms where id = :id for update"), {"id": room_id}
        ).first()
        if room is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบห้อง")
        if room.property_id != session.property_id:
            raise ApiError(403, "FORBIDDEN", "ห้องนี้ไม่ได้อยู่ในหอของคุณ")

        billed = conn.execute(
            text("select 1 from invoices where room_id = :room and period = :period"),
            {"room": room_id, "period": body.period},
        ).first()
        if billed:
            raise ApiError(409, "CONFLICT", "ออกบิลรอบนี้แล้ว แก้เลขมิเตอร์ไม่ได้")

        prev = conn.execute(
            text("""select water_now, elec_now from readings
                    where room_id = :room and period < :period
                    order by period desc limit 1"""),
            {"room": room_id, "period": body.period},
        ).first()
        water_prev = prev.water_now if prev else None
        elec_prev = prev.elec_now if prev else None

        conn.execute(
            text("""insert into readings (id, room_id, period, water_prev, water_now, elec_prev, elec_now,
                                          photo_key, recorded_by, recorded_at)
                    values (:id, :room, :period, :wp, :wn, :ep, :en, :photo, :by, now())
                    on conflict (room_id, period) do update set
                        water_prev = excluded.water_prev, water_now = excluded.water_now,
                        elec_prev = excluded.elec_prev, elec_now = excluded.elec_now,
                        photo_key = coalesce(excluded.photo_key, readings.photo_key),
                        recorded_by = excluded.recorded_by,
                        recorded_at = excluded.recorded_at"""),
            {"id": reading_id(room_id, body.period), "room": room_id, "period": body.period,
             "wp": water_prev, "wn": body.water_now, "ep": elec_prev, "en": body.elec_now,
             "photo": body.photo_url, "by": session.user_id},
        )

    if prev is None:
        return ReadingResult(water_units=0, elec_units=0, warning="NO_PREVIOUS_READING")
    decreased = body.water_now < water_prev or body.elec_now < elec_prev
    return ReadingResult(
        water_units=max(0, body.water_now - water_prev),
        elec_units=max(0, body.elec_now - elec_prev),
        warning="METER_DECREASED" if decreased else None,
    )
