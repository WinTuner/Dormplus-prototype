"""Owner side of LINE binding: invite a tenant to a room, revoke invites, unlink a LINE account."""
import json
import secrets
from datetime import date, datetime

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import Connection, Engine, text

from app.auth import Session, owner_session
from app.clock import today
from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError
from app.invites import TTL, hash_code, liff_link, new_code

router = APIRouter(prefix="/v1", tags=["line-link"])


class InviteIn(BaseModel):
    # Which tenant record gets the LINE account. Leave out to use the room's tenant who has no LINE
    # yet, or, if there is none, to add a new tenant (a roommate) when the code is used.
    tenant_id: str | None = None


class InviteOut(BaseModel):
    code: str           # shown once; only its hash is stored
    link_url: str | None  # LIFF link for the QR; null until LIFF_ID is set
    expires_at: datetime
    tenant_id: str | None


class RevokeOut(BaseModel):
    revoked: int


def own_room(conn: Connection, room_id: str, session: Session) -> None:
    room = conn.execute(text("select property_id from rooms where id = :id for update"), {"id": room_id}).first()
    if room is None:
        raise ApiError(404, "NOT_FOUND", "ไม่พบห้อง")
    if room.property_id != session.property_id:
        raise ApiError(403, "FORBIDDEN", "ห้องนี้ไม่ได้อยู่ในหอของคุณ")


def audit(conn: Connection, session: Session, action: str, payload: dict) -> None:
    conn.execute(
        text("""insert into audit_log (property_id, actor, action, payload)
                values (:pid, :actor, :action, cast(:payload as jsonb))"""),
        {"pid": session.property_id, "actor": session.user_id, "action": action, "payload": json.dumps(payload)},
    )


@router.post("/rooms/{room_id}/invite", status_code=201, response_model=InviteOut)
def create_invite(
    room_id: str,
    body: InviteIn | None = None,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> InviteOut:
    code = new_code()
    with engine.begin() as conn:
        own_room(conn, room_id, session)
        current = "(moved_out is null or moved_out > :today)"

        tenant_id = body.tenant_id if body else None
        if tenant_id:
            tenant = conn.execute(
                text(f"select line_user_id from tenants where id = :id and room_id = :room and {current}"),
                {"id": tenant_id, "room": room_id, "today": day},
            ).first()
            if tenant is None:
                raise ApiError(404, "NOT_FOUND", "ไม่พบผู้เช่าคนนี้ในห้อง")
            if tenant.line_user_id:
                raise ApiError(409, "TENANT_ALREADY_LINKED", "ผู้เช่าคนนี้ผูก LINE แล้ว")
        else:
            tenant_id = conn.execute(
                text(f"""select id from tenants where room_id = :room and line_user_id is null and {current}
                         order by moved_in nulls first, id limit 1"""),
                {"room": room_id, "today": day},
            ).scalar()

        if tenant_id:
            # One live invite per tenant: a new one replaces any earlier unused one.
            replaced = conn.execute(
                text("""update link_codes set revoked_at = now()
                        where tenant_id = :t and used_at is null and revoked_at is null
                        returning id"""),
                {"t": tenant_id},
            ).fetchall()
            for old in replaced:
                audit(conn, session, "invite.revoke",
                      {"invite_id": old.id, "room_id": room_id, "tenant_id": tenant_id, "reason": "reissued"})

        row = conn.execute(
            text("""insert into link_codes (id, code_hash, property_id, room_id, tenant_id, created_by, expires_at)
                    values (:id, :hash, :pid, :room, :tenant, :by, now() + cast(:ttl as interval))
                    returning id, expires_at"""),
            {"id": f"lc_{secrets.token_hex(8)}", "hash": hash_code(code), "pid": session.property_id,
             "room": room_id, "tenant": tenant_id, "by": session.user_id, "ttl": f"{int(TTL.total_seconds())} seconds"},
        ).one()
        audit(conn, session, "invite.create", {"invite_id": row.id, "room_id": room_id, "tenant_id": tenant_id})

    return InviteOut(code=code, link_url=liff_link(get_settings().liff_id, code),
                     expires_at=row.expires_at, tenant_id=tenant_id)


@router.delete("/rooms/{room_id}/invite", response_model=RevokeOut)
def revoke_invites(
    room_id: str,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
) -> RevokeOut:
    """Cancel every unused invite of the room, e.g. when a QR photo went to the wrong person."""
    with engine.begin() as conn:
        own_room(conn, room_id, session)
        revoked = conn.execute(
            text("""update link_codes set revoked_at = now()
                    where room_id = :room and used_at is null and revoked_at is null"""),
            {"room": room_id},
        ).rowcount
        if revoked:
            audit(conn, session, "invite.revoke", {"room_id": room_id, "revoked": revoked})
    return RevokeOut(revoked=revoked)


@router.delete("/tenants/{tenant_id}/line", status_code=204)
def unlink_line(
    tenant_id: str,
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
) -> Response:
    """Remove a tenant's LINE account. Their next LIFF login answers NOT_LINKED.

    A session cookie they already hold keeps working until it expires (up to 7 days)."""
    with engine.begin() as conn:
        tenant = conn.execute(
            text("""select r.property_id from tenants t join rooms r on r.id = t.room_id
                    where t.id = :id for update of t"""),
            {"id": tenant_id},
        ).first()
        if tenant is None:
            raise ApiError(404, "NOT_FOUND", "ไม่พบผู้เช่า")
        if tenant.property_id != session.property_id:
            raise ApiError(403, "FORBIDDEN", "ผู้เช่าคนนี้ไม่ได้อยู่ในหอของคุณ")
        conn.execute(text("update tenants set line_user_id = null where id = :id"), {"id": tenant_id})
        audit(conn, session, "tenant.unlink_line", {"tenant_id": tenant_id})
    return Response(status_code=204)
