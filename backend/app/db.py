from functools import lru_cache

from sqlalchemy import Engine, create_engine

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    """One pooled engine per process. Routes take it through Depends(get_engine) so tests can swap it."""
    return create_engine(get_settings().database_url, pool_pre_ping=True)
