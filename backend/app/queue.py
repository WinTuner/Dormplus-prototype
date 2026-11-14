"""Procrastinate queue. The API only *enqueues*; something must drain it.

    python -m app.queue                             # once per database: apply the schema
    GET /v1/cron/daily                              # what Vercel Cron calls (drains in-process)
    procrastinate -a app.queue.app worker           # or a long-lived worker, if you host one

`app/routes/cron.py` runs `run_worker(wait=False)`, so a serverless invocation can send the whole
queue and return; nothing has to stay running between cron runs.
"""
import procrastinate

from app.config import get_settings


def _conninfo() -> str:
    """psycopg wants plain postgresql://, SQLAlchemy's URL carries +psycopg."""
    return get_settings().database_url.replace("postgresql+psycopg://", "postgresql://")


app = procrastinate.App(
    connector=procrastinate.SyncPsycopgConnector(conninfo=_conninfo()),
    # The worker imports these to find the tasks.
    import_paths=["app.tasks"],
)

# `App.run_worker` is only a thin wrapper around `asyncio.run(run_worker_async())`, and that path
# requires an async connector; the sync one is what the request handlers use. The cron drain
# therefore gets its own app on the async connector.
#
# Local note: psycopg's async mode refuses Windows' ProactorEventLoop, so a manual drain on Windows
# needs asyncio.run(..., loop_factory=asyncio.SelectorEventLoop). Linux (Vercel) is unaffected.
async_app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(conninfo=_conninfo()),
    import_paths=["app.tasks"],
)


def apply_schema() -> None:
    """Create procrastinate's own tables.

    `procrastinate schema --apply` refuses a sync connector, which is what a serverless function
    wants, so the same migration runs from here: `python -m app.queue`.
    """
    with app.open():
        app.schema_manager.apply_schema()


if __name__ == "__main__":
    apply_schema()
    print("procrastinate schema applied")
