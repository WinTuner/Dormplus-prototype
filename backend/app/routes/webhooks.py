"""POST /v1/webhooks/line/{property_id} — the Messaging API entry point for this backend.

The channel secret comes from `properties.line_secret_enc` when an operator has stored one
(`scripts/set_line_secret.py`), so the same deployment can serve a dorm whose own OA we do not
control; `LINE_CHANNEL_SECRET` stays as the fallback for the one-dorm case. The endpoint is wired
but the LINE console still points at `line-app`; see docs/API.md and docs/HANDOFF.md.
"""
import base64
import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import Connection, Engine, text
from starlette.concurrency import run_in_threadpool

from app import line_handlers, secrets
from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError

router = APIRouter(prefix="/v1", tags=["webhooks"])
logger = logging.getLogger(__name__)

SECRET_SQL = text("select line_secret_enc from properties where id = :id")

AUDIT_SQL = text("""
    insert into audit_log (property_id, actor, action, payload)
    values (:pid, null, 'webhook.line', cast(:payload as jsonb))
""")

# `on conflict do nothing returning` tells us which ids are new: a redelivery returns no row.
EVENT_SQL = text("""
    insert into line_events (event_id, property_id)
    values (:event_id, :pid)
    on conflict (event_id) do nothing
    returning event_id
""")


def signature_matches(secret: str, raw: bytes, header: str) -> bool:
    """True when `header` is the Base64 HMAC-SHA256 of the exact bytes received.

    Compared as bytes: `hmac.compare_digest` refuses non-ASCII str, and a header LINE would never
    send must be a plain mismatch (401), not a crash.
    """
    expected = base64.b64encode(hmac.new(secret.encode(), raw, hashlib.sha256).digest())
    return hmac.compare_digest(expected, header.encode("latin-1", "replace"))


def channel_secret(conn: Connection, property_id: str) -> str:
    """The dorm's own secret when one is stored, otherwise the deployment-wide env value.

    An unreadable column is 503, never 401: LINE retries 5xx, so a wrong key is a pause the operator
    can fix, while a wrong secret is a signature that can never pass.
    """
    blob = conn.execute(SECRET_SQL, {"id": property_id}).scalar()
    if blob:
        try:
            return secrets.decrypt(blob)
        except (secrets.KeyMissing, secrets.Undecryptable) as err:
            logger.error("line secret unreadable for %s: %s", property_id, err)
            raise ApiError(503, "LINE_SECRET_UNREADABLE",
                           "อ่าน channel secret ของหอไม่ได้ — ตรวจ SECRET_ENC_KEY") from err
    secret = get_settings().line_channel_secret
    if not secret:
        raise ApiError(503, "LINE_NOT_CONFIGURED", "ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET")
    return secret


def answer_events(engine: Engine, events: list[dict], fresh: set[str]) -> None:
    """Answer the events this delivery just recorded.

    Only fresh ids: a redelivery must not say "ยินดีต้อนรับ" twice. One event that throws must not
    silence the rest — LINE already got its 200 either way.
    """
    for event in events:
        if event.get("webhookEventId") not in fresh:
            continue
        try:
            with engine.connect() as conn:
                line_handlers.handle(event, conn)
        except Exception:  # noqa: BLE001 — a handler bug must not take the endpoint down
            logger.exception("line event not answered: %s", event.get("webhookEventId"))


@router.post("/webhooks/line/{property_id}")
async def line_webhook(
    property_id: str,
    request: Request,
    engine: Engine = Depends(get_engine),
) -> dict:
    """Verify `X-Line-Signature` over the raw body, record each event once, then answer it.

    The answer is plain text (`app/line_handlers.py`): a welcome on `follow`, the tenant's newest
    bill on "บิล". The LINE console still points at `line-app`; this endpoint is ready for the
    switch, see docs/DEPLOYMENT.md.
    """
    settings = get_settings()

    # The signature is per channel: a valid one from another dorm's channel must not be accepted
    # here, so the path has to name this deployment's dorm.
    if property_id != settings.property_id:
        raise ApiError(404, "NOT_FOUND", "ไม่พบหอนี้")

    raw = await request.body()
    with engine.connect() as conn:
        secret = channel_secret(conn, property_id)
    if not signature_matches(secret, raw,
                             request.headers.get("X-Line-Signature", "")):
        raise ApiError(401, "UNAUTHORIZED", "signature ไม่ถูกต้อง")

    try:
        events = json.loads(raw).get("events") or []
        types = [str(event.get("type", "unknown")) for event in events]
        ids = [str(event["webhookEventId"]) for event in events if event.get("webhookEventId")]
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, "VALIDATION", "body ไม่ใช่ JSON ของ LINE")

    with engine.begin() as conn:
        # One statement per id: two ids in one `execute` go through psycopg's executemany, which drops
        # RETURNING, and `.all()` then raises instead of answering (LINE batches events).
        fresh = [event_id for event_id in ids
                 if conn.execute(EVENT_SQL, {"event_id": event_id, "pid": property_id}).first()]
        # A retry of an event we already recorded changes nothing, and is still a 200 so LINE stops.
        if not ids or fresh:
            conn.execute(AUDIT_SQL, {"pid": property_id,
                                     "payload": json.dumps({"count": len(types), "types": types})})
        else:
            logger.info("line webhook redelivery ignored: %s", ", ".join(i for i in ids))

    # After the commit, and after LINE has its answer on the way: a handler talks to LINE and reads
    # the database, neither of which belongs inside the transaction that records the delivery.
    await run_in_threadpool(answer_events, engine, events, set(fresh))
    return {"ok": True}
