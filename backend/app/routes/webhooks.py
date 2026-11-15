"""POST /v1/webhooks/line/{property_id} — the Messaging API entry point for this backend.

One deployment serves one dorm, so the channel secret comes from `LINE_CHANNEL_SECRET` rather than
from the (still keyless) `properties.line_secret_enc` column. The endpoint is wired but the LINE
console still points at `line-app`; see docs/API.md and docs/HANDOFF.md.
"""
import base64
import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import Engine, text

from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError

router = APIRouter(prefix="/v1", tags=["webhooks"])
logger = logging.getLogger(__name__)

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


@router.post("/webhooks/line/{property_id}")
async def line_webhook(
    property_id: str,
    request: Request,
    engine: Engine = Depends(get_engine),
) -> dict:
    """Verify `X-Line-Signature` over the raw body, then record what arrived.

    Nothing here answers the user yet: the chatbot lives in `line-app`. What this proves is the
    signature check and the wiring, so a later handler has a verified event to work from.
    """
    settings = get_settings()
    if not settings.line_channel_secret:
        raise ApiError(503, "LINE_NOT_CONFIGURED", "ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET")

    # The signature is per channel: a valid one from another dorm's channel must not be accepted
    # here, so the path has to name this deployment's dorm.
    if property_id != settings.property_id:
        raise ApiError(404, "NOT_FOUND", "ไม่พบหอนี้")

    raw = await request.body()
    if not signature_matches(settings.line_channel_secret, raw,
                             request.headers.get("X-Line-Signature", "")):
        raise ApiError(401, "UNAUTHORIZED", "signature ไม่ถูกต้อง")

    try:
        events = json.loads(raw).get("events") or []
        types = [str(event.get("type", "unknown")) for event in events]
        ids = [str(event["webhookEventId"]) for event in events if event.get("webhookEventId")]
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, "VALIDATION", "body ไม่ใช่ JSON ของ LINE")

    with engine.begin() as conn:
        fresh = conn.execute(EVENT_SQL, [{"event_id": i, "pid": property_id} for i in ids]).all() if ids else []
        # A retry of an event we already recorded changes nothing, and is still a 200 so LINE stops.
        if not ids or fresh:
            conn.execute(AUDIT_SQL, {"pid": property_id,
                                     "payload": json.dumps({"count": len(types), "types": types})})
        else:
            logger.info("line webhook redelivery ignored: %s", ", ".join(i for i in ids))
    return {"ok": True}
