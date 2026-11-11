from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from environment variables or backend/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/domplus"

    # Until LINE Login exists, local development can pick a session with X-Dev-* headers (see app/auth.py).
    # Never turn this on in a deployed environment: anyone could act as any dorm.
    dev_auth: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
