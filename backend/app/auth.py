"""Who is calling, and for which dorm.

Every /v1 route gets the caller through current_session(). The property_id it carries is the only
one a route may read or write (docs/HANDOFF.md: never take property_id from the client).

Two ways in:
  1. the signed session cookie from POST /v1/auth/line (real LINE login, see app/routes/auth.py)
  2. X-Dev-* headers, only while DEV_AUTH is on (local development, never on a deployed server)
"""
from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, Request

from app import session as session_cookie
from app.config import get_settings
from app.errors import ApiError

Role = Literal["owner", "tenant"]


@dataclass(frozen=True)
class Session:
    user_id: str
    role: Role
    property_id: str
    room_id: str | None = None


def current_session(request: Request) -> Session:
    settings = get_settings()

    token = request.cookies.get(session_cookie.COOKIE_NAME)
    if token:
        payload = session_cookie.unsign(token, settings.session_secret)
        if payload:
            return Session(
                user_id=payload["uid"],
                role=payload.get("role", "tenant"),
                property_id=payload["property_id"],
                room_id=payload.get("room_id"),
            )
        # A stale or tampered cookie falls through to 401 rather than being trusted.

    if not settings.dev_auth:
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


def owner_session(session: Session = Depends(current_session)) -> Session:
    if session.role != "owner":
        raise ApiError(403, "FORBIDDEN", "เฉพาะเจ้าของหอ")
    return session


def tenant_session(session: Session = Depends(current_session)) -> Session:
    if session.role != "tenant" or not session.room_id:
        raise ApiError(403, "FORBIDDEN", "เฉพาะผู้เช่าที่ผูกห้องแล้ว")
    return session
