"""Procrastinate queue. The API only *enqueues*; a worker on a real host drains the queue.

    procrastinate schema --apply        # once per database
    procrastinate -a app.queue.app worker --with-periodic

Vercel functions cannot host that worker, so notifications are queued until one runs.
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
