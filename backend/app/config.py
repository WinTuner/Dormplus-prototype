from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from environment variables or backend/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/domplus"

    # Until LINE Login exists, local development can pick a session with X-Dev-* headers (see app/auth.py).
    # Never turn this on in a deployed environment: anyone could act as any dorm.
    dev_auth: bool = False

    # LINE Login channel that issues the LIFF idToken (app/routes/auth.py). Empty = LIFF login off.
    line_channel_id: str = ""
    liff_id: str = ""

    # Signs the session cookie (app/session.py). Set a long random value in production.
    session_secret: str = "dev-only-change-me"
    # Set true when served over HTTPS so the cookie is not sent on plain HTTP.
    cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
