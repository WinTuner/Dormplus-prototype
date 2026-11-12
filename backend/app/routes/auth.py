"""LINE login: exchange a LIFF idToken for a session cookie."""
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import Engine, text

from app import line, session as session_cookie
from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError

router = APIRouter(prefix="/v1/auth", tags=["auth"])

SESSION_TTL = 7 * 24 * 3600


class LineLoginIn(BaseModel):
    id_token: str


class LineUserOut(BaseModel):
    room_no: str
    name: str | None
    property_id: str


class LineLoginOut(BaseModel):
    user: LineUserOut


TENANT_BY_LINE_SQL = text("""
    select t.name, r.id as room_id, r.room_no, r.property_id
    from tenants t
    join rooms r on r.id = t.room_id
    where t.line_user_id = :line_user_id
      and (t.moved_out is null or t.moved_out > current_date)
    order by t.moved_in desc nulls last
    limit 1
""")


@router.post("/line", response_model=LineLoginOut)
def login_with_line(
    body: LineLoginIn,
    response: Response,
    engine: Engine = Depends(get_engine),
) -> LineLoginOut:
    """LIFF sends its idToken here; we verify it with LINE, find the room it is bound to,
    and hand back a signed cookie. Nothing from the request decides which dorm is used."""
    settings = get_settings()
    if not settings.line_channel_id:
        raise ApiError(503, "LINE_NOT_CONFIGURED", "ยังไม่ได้ตั้ง LINE_CHANNEL_ID บนเซิร์ฟเวอร์")

    payload = line.verify_id_token(body.id_token, settings.line_channel_id)
    line_user_id = payload["sub"]

    with engine.connect() as conn:
        row = conn.execute(TENANT_BY_LINE_SQL, {"line_user_id": line_user_id}).first()

    if row is None:
        raise ApiError(403, "NOT_LINKED", "LINE นี้ยังไม่ได้ผูกกับห้อง — ให้เจ้าของหอเพิ่มให้ก่อน")

    token = session_cookie.sign(
        {
            "uid": line_user_id,
            "role": "tenant",
            "property_id": row.property_id,
            "room_id": row.room_id,
        },
        settings.session_secret,
        ttl_seconds=SESSION_TTL,
    )
    response.set_cookie(
        session_cookie.COOKIE_NAME,
        token,
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return LineLoginOut(user=LineUserOut(room_no=row.room_no, name=row.name, property_id=row.property_id))


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(session_cookie.COOKIE_NAME, path="/")
