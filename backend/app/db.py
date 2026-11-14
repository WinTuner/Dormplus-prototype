from functools import lru_cache

from sqlalchemy import Engine, create_engine, event

from app.config import get_settings

PROPERTY_SETTING = "app.property_id"


def attach_property(engine: Engine, property_id: str) -> Engine:
    """Pin every connection to one dorm.

    The RLS policies (migration 0004) compare `property_id` with `app.property_id`; a connection
    that never set it reads nothing, so this runs on connect for the app and for the tests.
    """

    @event.listens_for(engine, "connect")
    def _set_property(dbapi_connection, _record):  # pragma: no cover - exercised by every query
        with dbapi_connection.cursor() as cursor:
            cursor.execute("select set_config(%s, %s, false)", (PROPERTY_SETTING, property_id))

    return engine


@lru_cache
def get_engine() -> Engine:
    """One pooled engine per process. Routes take it through Depends(get_engine) so tests can swap it."""
    settings = get_settings()
    return attach_property(create_engine(settings.database_url, pool_pre_ping=True), settings.property_id)
