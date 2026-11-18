"""Who is calling, and for which dorm.

Every /v1 route gets the caller through current_session(). The property_id it carries is the only
one a route may read or write (docs/HANDOFF.md: never take property_id from the client).

Two ways in:
  1. the signed session cookie from POST /v1/auth/line (real LINE login, see app/routes/auth.py)
  2. X-Dev-* headers, only while DEV_AUTH is on (local development, never on a deployed server)
"""
from dataclasses import dataclass, replace
from typing import Literal

from fastapi import Depends, Request
from sqlalchemy import Engine, text

from app import session as session_cookie
from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError

Role = Literal["owner", "tenant"]


@dataclass(frozen=True)
class Session:
    user_id: str
    role: Role
    property_id: str
    room_id: str | None = None
    # The month this tenant moved in ("YYYY-MM"), re-read from the database on every request. Bills
    # for earlier periods belong to whoever lived here before, not to this person.
    since: str | None = None


STILL_LINKED_SQL = text("""
    select to_char(t.moved_in, 'YYYY-MM') as since from tenants t join rooms r on r.id = t.room_id
    where t.line_user_id = :uid and t.room_id = :room and r.property_id = :property_id
      and (t.moved_out is null or t.moved_out > (now() at time zone 'Asia/Bangkok')::date)
""")


def current_session(request: Request, engine: Engine = Depends(get_engine)) -> Session:
    settings = get_settings()

    token = request.cookies.get(session_cookie.COOKIE_NAME)
    if token:
        payload = session_cookie.unsign(token, settings.session_secret)
        if payload:
            session = Session(
                user_id=payload["uid"],
                role=payload.get("role", "tenant"),
                property_id=payload["property_id"],
                room_id=payload.get("room_id"),
            )
            # A cookie lives 7 days. Re-check the binding on every request, so unlinking a tenant
            # or moving them out takes effect at once instead of when the cookie expires.
            if session.role == "tenant":
                linked, since = linked_since(engine, session)
                if not linked:
                    raise ApiError(401, "SESSION_REVOKED", "LINE นี้ไม่ได้ผูกกับห้องนี้แล้ว — เข้าสู่ระบบใหม่")
                session = replace(session, since=since)
            return session
        # A stale or tampered cookie falls through to 401 rather than being trusted.

    if not settings.dev_auth_active:  # off, or on but ignored because this is production
        raise ApiError(401, "UNAUTHORIZED", "ยังไม่ได้เข้าสู่ระบบ")

    property_id = request.headers.get("X-Dev-Property")
    if not property_id:
        raise ApiError(401, "UNAUTHORIZED", "ต้องส่ง X-Dev-Property เมื่อใช้ DEV_AUTH")
    role = request.headers.get("X-Dev-Role", "owner")
    if role not in ("owner", "tenant"):
        raise ApiError(401, "UNAUTHORIZED", "X-Dev-Role ต้องเป็น owner หรือ tenant")
    return Session(
        user_id=request.headers.get("X-Dev-User", "u_dev"),
        role=role,
        property_id=property_id,
        room_id=request.headers.get("X-Dev-Room"),
    )


def linked_since(engine: Engine, session: Session) -> tuple[bool, str | None]:
    """(still bound, month they moved in). One query answers both questions."""
    with engine.connect() as conn:
        row = conn.execute(
            STILL_LINKED_SQL,
            {"uid": session.user_id, "room": session.room_id, "property_id": session.property_id},
        ).first()
    return (row is not None, row.since if row else None)


def still_linked(engine: Engine, session: Session) -> bool:
    return linked_since(engine, session)[0]


def owner_session(session: Session = Depends(current_session)) -> Session:
    if session.role != "owner":
        raise ApiError(403, "FORBIDDEN", "เฉพาะเจ้าของหอ")
    return session


def tenant_session(session: Session = Depends(current_session)) -> Session:
    if session.role != "tenant" or not session.room_id:
        raise ApiError(403, "FORBIDDEN", "เฉพาะผู้เช่าที่ผูกห้องแล้ว")
    return session
