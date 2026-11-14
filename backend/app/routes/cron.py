"""GET /v1/cron/daily — the Vercel Cron entry point: queue today's reminders and send them.

Vercel invokes a cron with a plain GET and, when `CRON_SECRET` is set on the project, puts it in
`Authorization: Bearer <CRON_SECRET>` by itself. Nothing else is needed: the queue drains inside
this one invocation, so there is no worker process to host.

Hobby allows one run per day, anywhere inside the scheduled hour — fine for rent reminders.
A job still running when the function is stopped goes back to the queue and is retried next run.
"""
import hmac
from datetime import date

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import Engine

from app.clock import today
from app.config import get_settings
from app.db import get_engine
from app.dunning import due_for_reminder, queue_reminders
from app.errors import ApiError
from app.routes.dunning import presented_token

router = APIRouter(prefix="/v1", tags=["cron"])


class CronOut(BaseModel):
    queued: int
    drained: bool


def drain_queue() -> None:
    """Send every queued job now, then return — no long-lived worker.

    `wait=False` makes procrastinate stop as soon as the queue is empty. With a day's worth of
    reminders (one per room) that is well inside the 300s a function gets.
    """
    from app.queue import app as queue

    queue.run_worker(
        wait=False,
        concurrency=4,
        listen_notify=False,
        install_signal_handlers=False,
    )


@router.get("/cron/daily", response_model=CronOut)
def daily_cron(
    request: Request,
    engine: Engine = Depends(get_engine),
    day: date = Depends(today),
) -> CronOut:
    settings = get_settings()
    presented = presented_token(request)
    if (
        not presented
        or not settings.cron_secret
        or not hmac.compare_digest(presented, settings.cron_secret)
    ):
        raise ApiError(401, "UNAUTHORIZED", "ต้องมาจาก cron (Authorization: Bearer CRON_SECRET)")

    rows = due_for_reminder(engine, settings.property_id, day)
    try:
        queued = queue_reminders(rows)
        drain_queue()
    except Exception as exc:  # noqa: BLE001 - a bare 500 in the cron log helps nobody
        raise ApiError(503, "QUEUE_UNAVAILABLE", f"คิวใช้งานไม่ได้ ({type(exc).__name__}) — ตรวจว่าสร้างตาราง procrastinate แล้วหรือยัง") from exc
    return CronOut(queued=queued, drained=True)
