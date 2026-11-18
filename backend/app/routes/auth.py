"""LINE login: exchange a LIFF idToken for a session cookie, and bind a LINE account to a room."""
import hmac
import json
import secrets
from datetime import date

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import Connection, Engine, text

from app import attempts, line, session as session_cookie
from app.clock import today
from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError
from app.invites import hash_code

router = APIRouter(prefix="/v1/auth", tags=["auth"])

SESSION_TTL = 7 * 24 * 3600


class LineLoginIn(BaseModel):
    id_token: str


class LineLinkIn(BaseModel):
    id_token: str
    code: str


class OwnerLoginIn(BaseModel):
    code: str = Field(min_length=1, max_length=200)


class OwnerLoginOut(BaseModel):
    role: str
    property_id: str


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
      and (t.moved_out is null or t.moved_out > (now() at time zone 'Asia/Bangkok')::date)
    order by t.moved_in desc nulls last
    limit 1
""")


def verified_line_user(id_token: str) -> dict:
    settings = get_settings()
    if not settings.line_channel_id:
        raise ApiError(503, "LINE_NOT_CONFIGURED", "ยังไม่ได้ตั้ง LINE_CHANNEL_ID บนเซิร์ฟเวอร์")
    return line.verify_id_token(id_token, settings.line_channel_id)


def _set_session_cookie(response: Response, payload: dict) -> None:
    settings = get_settings()
    token = session_cookie.sign(payload, settings.session_secret, ttl_seconds=SESSION_TTL)
    response.set_cookie(
        session_cookie.COOKIE_NAME,
        token,
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def start_tenant_session(response: Response, line_user_id: str, property_id: str, room_id: str) -> None:
    _set_session_cookie(
        response,
        {"uid": line_user_id, "role": "tenant", "property_id": property_id, "room_id": room_id},
    )


@router.post("/line", response_model=LineLoginOut)
def login_with_line(
    body: LineLoginIn,
    response: Response,
    engine: Engine = Depends(get_engine),
) -> LineLoginOut:
    """LIFF sends its idToken here; we verify it with LINE, find the room it is bound to,
    and hand back a signed cookie. Nothing from the request decides which dorm is used."""
    line_user_id = verified_line_user(body.id_token)["sub"]

    with engine.connect() as conn:
        row = conn.execute(TENANT_BY_LINE_SQL, {"line_user_id": line_user_id}).first()

    if row is None:
        raise ApiError(403, "NOT_LINKED", "LINE นี้ยังไม่ได้ผูกกับห้อง — ขอ QR เชิญจากเจ้าของหอ")

    start_tenant_session(response, line_user_id, row.property_id, row.room_id)
    return LineLoginOut(user=LineUserOut(room_no=row.room_no, name=row.name, property_id=row.property_id))


@router.post("/line/link", response_model=LineLoginOut)
def link_with_line(
    body: LineLinkIn,
    response: Response,
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> LineLoginOut:
    """First visit from an invite QR: bind this LINE account to the invite's room, then log in.

    The room and the dorm come from the invite, never from the request. A code works once;
    presenting it again from the same LINE account just logs in again."""
    profile = verified_line_user(body.id_token)
    line_user_id = profile["sub"]

    attempts.ensure_not_blocked(engine, LINK_SCOPE, line_user_id)
    try:
        return _link(body, response, engine, day, profile, line_user_id)
    except ApiError as err:
        if err.code in GUESS_FAILURES:
            attempts.record_failure(engine, LINK_SCOPE, line_user_id)
        raise


# Answers that mean "this code did not work for you": each one counts towards the rate limit.
LINK_SCOPE = "line.link"
GUESS_FAILURES = {"INVITE_NOT_FOUND", "INVITE_EXPIRED", "INVITE_USED"}


def _link(body: LineLinkIn, response: Response, engine: Engine, day: date, profile: dict,
          line_user_id: str) -> LineLoginOut:
    with engine.begin() as conn:
        invite = conn.execute(
            text("""select id, room_id, tenant_id, used_at, used_by,
                           (revoked_at is not null or expires_at <= now()) as dead
                    from link_codes where code_hash = :hash for update"""),
            {"hash": hash_code(body.code)},
        ).first()
        if invite is None:
            raise ApiError(404, "INVITE_NOT_FOUND", "รหัสเชิญไม่ถูกต้อง")

        room = conn.execute(
            text("select id, room_no, property_id from rooms where id = :id"), {"id": invite.room_id}
        ).one()
        current = "(moved_out is null or moved_out > :today)"
        already = conn.execute(
            text(f"select id, name from tenants where room_id = :room and line_user_id = :uid and {current}"),
            {"room": room.id, "uid": line_user_id, "today": day},
        ).first()

        if invite.dead:
            # A revoked or expired code is dead even for the person who already used it:
            # otherwise the invite URL would be a permanent login credential.
            raise ApiError(410, "INVITE_EXPIRED", "รหัสเชิญหมดอายุหรือถูกยกเลิกแล้ว — ขอรหัสใหม่จากเจ้าของหอ")
        if invite.used_at is not None:
            if invite.used_by == line_user_id and already is not None:
                start_tenant_session(response, line_user_id, room.property_id, room.id)
                return LineLoginOut(user=LineUserOut(room_no=room.room_no, name=already.name,
                                                     property_id=room.property_id))
            raise ApiError(409, "INVITE_USED", "รหัสเชิญนี้ถูกใช้ไปแล้ว — ขอรหัสใหม่จากเจ้าของหอ")

        tenant_id, name = bind(conn, invite, room.id, line_user_id, profile.get("name"), already, day)

        conn.execute(
            text("update link_codes set used_at = now(), used_by = :uid where id = :id"),
            {"uid": line_user_id, "id": invite.id},
        )
        conn.execute(
            text("""insert into audit_log (property_id, actor, action, payload)
                    values (:pid, :actor, 'tenant.link_line', cast(:payload as jsonb))"""),
            {"pid": room.property_id, "actor": line_user_id,
             "payload": json.dumps({"invite_id": invite.id, "room_id": room.id, "tenant_id": tenant_id})},
        )

    start_tenant_session(response, line_user_id, room.property_id, room.id)
    return LineLoginOut(user=LineUserOut(room_no=room.room_no, name=name, property_id=room.property_id))


def bind(conn: Connection, invite, room_id: str, line_user_id: str, line_name: str | None,
         already, day: date) -> tuple[str, str | None]:
    """Write the LINE userId onto a tenant of the room. Returns (tenant_id, tenant name)."""
    if already is not None:
        return already.id, already.name  # this LINE account is already in the room: nothing to change

    current = "(moved_out is null or moved_out > :today)"

    # Two invites for the same account opened at once both pass the `elsewhere` check below; the lock
    # makes the second one run after the first has written, so it sees the new room.
    conn.execute(text("select pg_advisory_xact_lock(hashtext(:uid))"), {"uid": line_user_id})

    # The same person coming back to the same room would collide with the unique
    # (room_id, line_user_id) index. The moved-out row gives up the key; it stays as history.
    conn.execute(
        text("""update tenants set line_user_id = null
                 where room_id = :room and line_user_id = :uid
                   and not (moved_out is null or moved_out > :today)"""),
        {"room": room_id, "uid": line_user_id, "today": day},
    )

    # One LINE account lives in one room: otherwise /v1/auth/line would have to guess which dorm
    # to sign the caller into (it orders by moved_in and picks one).
    elsewhere = conn.execute(
        text(f"""select r.room_no from tenants t join rooms r on r.id = t.room_id
                 where t.line_user_id = :uid and t.room_id <> :room and {current}
                 limit 1"""),
        {"uid": line_user_id, "room": room_id, "today": day},
    ).first()
    if elsewhere is not None:
        raise ApiError(409, "LINE_ON_ANOTHER_ROOM",
                       f"LINE นี้ผูกกับห้อง {elsewhere.room_no} อยู่ — ให้เจ้าของหอยกเลิกการผูกเดิมก่อน")

    if invite.tenant_id:
        tenant = conn.execute(
            text(f"""select id, name, line_user_id from tenants
                     where id = :id and room_id = :room and {current} for update"""),
            {"id": invite.tenant_id, "room": room_id, "today": day},
        ).first()
        if tenant is None:
            raise ApiError(410, "INVITE_EXPIRED", "ผู้เช่าที่รหัสนี้เชิญย้ายออกแล้ว — ขอรหัสใหม่จากเจ้าของหอ")
        if tenant.line_user_id:
            raise ApiError(409, "TENANT_ALREADY_LINKED", "ผู้เช่าคนนี้ผูก LINE อื่นไว้แล้ว")
        conn.execute(
            text("update tenants set line_user_id = :uid, moved_in = coalesce(moved_in, :today) where id = :id"),
            {"uid": line_user_id, "today": day, "id": tenant.id},
        )
        return tenant.id, tenant.name

    # The invite was for someone not on the room yet (a roommate): add them, named from LINE.
    tenant_id = f"t_{secrets.token_hex(6)}"
    conn.execute(
        text("""insert into tenants (id, room_id, name, line_user_id, moved_in)
                values (:id, :room, :name, :uid, :today)"""),
        {"id": tenant_id, "room": room_id, "name": line_name, "uid": line_user_id, "today": day},
    )
    return tenant_id, line_name


@router.post("/owner", response_model=OwnerLoginOut)
def login_owner(
    body: OwnerLoginIn,
    request: Request,
    response: Response,
    engine: Engine = Depends(get_engine),
) -> OwnerLoginOut:
    """Owner web UI at /owner: one dorm per deployment, so the owner is whoever knows the code.

    Guessing is rate limited like the invite codes (app/attempts.py), and the comparison is constant
    time so a wrong code cannot be narrowed down by timing.
    """
    settings = get_settings()
    if not settings.owner_access_code:
        raise ApiError(503, "OWNER_LOGIN_OFF", "ยังไม่ได้ตั้ง OWNER_ACCESS_CODE บนเซิร์ฟเวอร์")
    # Behind Vercel/Cloud Run the peer address is the platform proxy: one shared key would let ten
    # wrong codes lock every owner out, and a missing peer would make them all "unknown".
    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    actor = forwarded or (request.client.host if request.client else "unknown")
    attempts.ensure_not_blocked(engine, "owner-login", actor)
    if not hmac.compare_digest(body.code, settings.owner_access_code):
        attempts.record_failure(engine, "owner-login", actor)
        raise ApiError(401, "UNAUTHORIZED", "รหัสเจ้าของหอไม่ถูกต้อง")
    _set_session_cookie(response, {"uid": "owner", "role": "owner", "property_id": settings.property_id})
    return OwnerLoginOut(role="owner", property_id=settings.property_id)


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(session_cookie.COOKIE_NAME, path="/")
