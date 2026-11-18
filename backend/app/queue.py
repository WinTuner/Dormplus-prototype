"""Procrastinate queue. The API only *enqueues*; something must drain it.

    python -m app.queue                             # once per database: apply the schema
    GET /v1/cron/daily                              # what Vercel Cron calls (drains in-process)
    procrastinate -a app.queue.app worker           # or a long-lived worker, if you host one

`app/routes/cron.py` runs `run_worker(wait=False)`, so a serverless invocation can send the whole
queue and return; nothing has to stay running between cron runs.
"""
from functools import lru_cache
from typing import TYPE_CHECKING

from app.config import get_settings

if TYPE_CHECKING:
    import procrastinate


def _conninfo() -> str:
    """psycopg wants plain postgresql://, SQLAlchemy's URL carries +psycopg."""
    return get_settings().database_url.replace("postgresql+psycopg://", "postgresql://")


# procrastinate costs ~200 ms to import and most requests never touch the queue, so the two App
# objects are built on first use instead of at import time (cold starts on Vercel pay for every
# import). `app.queue.app` and `app.queue.async_app` still work as attributes through the module
# `__getattr__` below, which is what `procrastinate -a app.queue.app worker` resolves.
@lru_cache
def get_app() -> "procrastinate.App":
    import procrastinate

    return procrastinate.App(
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
@lru_cache
def get_async_app() -> "procrastinate.App":
    import procrastinate

    async_app = procrastinate.App(
        connector=procrastinate.PsycopgConnector(conninfo=_conninfo()),
        import_paths=["app.tasks"],
    )
    # Tasks register themselves on the *sync* app (app/tasks.py imports `app` from this module), and
    # each App keeps its own `tasks` dict. Without this copy the drain would find no tasks and mark
    # every job failed with TaskNotFound while still answering 200.
    import app.tasks  # noqa: F401 - import_paths only record the module, they do not load it

    async_app.tasks.update(get_app().tasks)
    return async_app


def __getattr__(name: str):
    if name == "app":
        return get_app()
    if name == "async_app":
        return get_async_app()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def apply_schema() -> None:
    """Create procrastinate's own tables.

    `procrastinate schema --apply` refuses a sync connector, which is what a serverless function
    wants, so the same migration runs from here: `python -m app.queue`.
    """
    app = get_app()
    with app.open():
        app.schema_manager.apply_schema()


if __name__ == "__main__":
    apply_schema()
    print("procrastinate schema applied")
