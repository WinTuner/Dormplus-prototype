"""Who is calling, and for which dorm.

Every /v1 route gets the caller through current_session(). The property_id it carries is the only
one a route may read or write (docs/HANDOFF.md: never take property_id from the client).

LINE Login does not exist yet, so current_session() answers 401 unless DEV_AUTH is on. With DEV_AUTH,
the session comes from request headers:

    X-Dev-Property: p_1        required
    X-Dev-Role:     owner      owner | tenant, default owner
    X-Dev-User:     u_dev      default u_dev

When LINE Login lands, only current_session() changes: it will read the session cookie instead.
"""
from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, Request

from app.config import get_settings
from app.errors import ApiError

Role = Literal["owner", "tenant"]


@dataclass(frozen=True)
class Session:
    user_id: str
    role: Role
    property_id: str


def current_session(request: Request) -> Session:
    if not get_settings().dev_auth:
        raise ApiError(401, "UNAUTHORIZED", "ยังไม่ได้เข้าสู่ระบบ")
    property_id = request.headers.get("X-Dev-Property")
    if not property_id:
        raise ApiError(401, "UNAUTHORIZED", "ต้องส่ง X-Dev-Property เมื่อใช้ DEV_AUTH")
    role = request.headers.get("X-Dev-Role", "owner")
    if role not in ("owner", "tenant"):
        raise ApiError(401, "UNAUTHORIZED", "X-Dev-Role ต้องเป็น owner หรือ tenant")
    return Session(user_id=request.headers.get("X-Dev-User", "u_dev"), role=role, property_id=property_id)


def owner_session(session: Session = Depends(current_session)) -> Session:
    if session.role != "owner":
        raise ApiError(403, "FORBIDDEN", "เฉพาะเจ้าของหอ")
    return session
