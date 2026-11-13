"""POST /v1/dunning/run — queue today's reminders (1, 5 and 10 days past due).

Call it from a scheduler. A cron job has no cookie, so it passes the shared token in a header:

    curl -X POST -H "Authorization: Bearer $DUNNING_TOKEN" https://<host>/v1/dunning/run

A token in the URL (`?token=`) is refused: URLs end up in access logs.
"""
import hmac
from datetime import date

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import Engine

from app.auth import current_session
from app.clock import today
from app.config import get_settings
from app.db import get_engine
from app.dunning import due_for_reminder, queue_reminders
from app.errors import ApiError

router = APIRouter(prefix="/v1", tags=["dunning"])


class DunningOut(BaseModel):
    queued: int
    days: list[int]


def presented_token(request: Request) -> str | None:
    """The cron token from `Authorization: Bearer …`, or None when the caller sent none."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


@router.post("/dunning/run", response_model=DunningOut)
def run_dunning(
    request: Request,
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> DunningOut:
    settings = get_settings()

    if "token" in request.query_params:
        raise ApiError(401, "UNAUTHORIZED", "ส่ง token ใน header Authorization: Bearer … เท่านั้น")

    presented = presented_token(request)
    if presented is not None:
        if not settings.dunning_token or not hmac.compare_digest(presented, settings.dunning_token):
            raise ApiError(401, "UNAUTHORIZED", "token ไม่ถูกต้อง")
        property_id = settings.property_id
    else:
        session = current_session(request, engine)  # raises 401/403 the usual way
        if session.role != "owner":
            raise ApiError(403, "FORBIDDEN", "เฉพาะเจ้าของหอ")
        property_id = session.property_id

    rows = due_for_reminder(engine, property_id, day)
    return DunningOut(queued=queue_reminders(rows), days=sorted({r["days_late"] for r in rows}))
