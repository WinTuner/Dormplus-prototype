from functools import lru_cache

from sqlalchemy import Engine, create_engine, event

from app.config import get_settings

PROPERTY_SETTING = "app.property_id"


def attach_property(engine: Engine, property_id: str) -> Engine:
    """Pin every transaction to one dorm.

    The RLS policies (migration 0004) compare `property_id` with `app.property_id`; a transaction
    that never set it reads nothing.

    The setting is transaction-local (`set_config(..., true)`) and set on SQLAlchemy's `begin`
    event, which fires for `engine.begin()` and for the autobegin of `engine.connect()` alike.
    A session-level setting made on connect is not safe behind PgBouncer in transaction mode
    (Neon's pooled endpoint): the next transaction can land on a server connection that never
    received it, and RLS then silently returns no rows. A local setting travels with the
    transaction, so it is correct on whichever server connection the pooler picks, and it cannot
    leak into another client's transaction afterwards.
    """

    @event.listens_for(engine, "begin")
    def _set_property(conn):
        conn.exec_driver_sql("select set_config(%s, %s, true)", (PROPERTY_SETTING, property_id))

    return engine


@lru_cache
def get_engine() -> Engine:
    """One pooled engine per process. Routes take it through Depends(get_engine) so tests can swap it.

    `pool_pre_ping` stays on: `pool_recycle` only retires connections by age, and the ones this app
    loses are killed by the server or the pooler while idle (Neon scale-to-zero, PgBouncer idle
    timeout, failover). Without the ping the first request after a quiet spell gets
    `OperationalError: server closed the connection unexpectedly`. One cheap round trip on checkout
    is the better trade for an app that is idle most of the day; `pool_recycle` still trims the
    connections that would otherwise need the ping.
    """
    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_recycle=300)
    return attach_property(engine, settings.property_id)
