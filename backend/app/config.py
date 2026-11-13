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
    # Messaging API token: the backend pushes reminders itself (app/line_push.py).
    line_channel_access_token: str = ""

    # Shared secret for the daily dunning cron (?token= on POST /v1/dunning/run).
    dunning_token: str = ""
    # Which dorm this deployment serves (one property per deploy).
    property_id: str = "p_1"

    # Signs the session cookie (app/session.py). Set a long random value in production;
    # app/session.py refuses to sign or verify with this placeholder.
    session_secret: str = "dev-only-change-me"
    # HTTPS only. Set COOKIE_SECURE=false for a plain-HTTP local dev box.
    cookie_secure: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
