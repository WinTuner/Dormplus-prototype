from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from environment variables or backend/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/domplus"

    # Until LINE Login exists, local development can pick a session with X-Dev-* headers (see app/auth.py).
    # Never turn this on in a deployed environment: anyone could act as any dorm.
    dev_auth: bool = False

    # LINE Login channel that issues the LIFF idToken (app/routes/auth.py). Empty = LIFF login off.
    line_channel_id: str = ""
    liff_id: str = ""
    # Messaging API token: the backend pushes reminders itself (app/line_push.py).
    line_channel_access_token: str = ""
    # Messaging API channel secret: verifies X-Line-Signature on /v1/webhooks/line/:property_id.
    # Used when `properties.line_secret_enc` is empty (one dorm per deployment).
    line_channel_secret: str = ""
    # Key for the encrypted per-dorm credentials in `properties.line_*_enc` (app/secrets.py).
    # Fernet key: urlsafe base64, 32 bytes — `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`.
    secret_enc_key: str = ""

    # Shared secret for the daily cron. Vercel puts it in `Authorization: Bearer <CRON_SECRET>`
    # by itself; DUNNING_TOKEN is the old name and still works.
    cron_secret: str = Field(
        default="", validation_alias=AliasChoices("CRON_SECRET", "DUNNING_TOKEN")
    )
    # Which dorm this deployment serves (one property per deploy).
    property_id: str = "p_1"

    # Signs the session cookie (app/session.py). Set a long random value in production;
    # app/session.py refuses to sign or verify with this placeholder.
    session_secret: str = "dev-only-change-me"
    # HTTPS only. Set COOKIE_SECURE=false for a plain-HTTP local dev box.
    cookie_secure: bool = True

    # Owner login for the web UI at /owner (app/routes/auth.py). This deployment serves one dorm and
    # there are no owner accounts, so "the owner" is whoever knows this shared code. Empty = the owner
    # UI shows the login screen and refuses every code.
    owner_access_code: str = ""

    # Set by Vercel on every deployment: "production", "preview" or "development" (`vercel dev`).
    vercel_env: str = ""
    # The same signal on the other hosts main.py names: Railway and Cloud Run set these themselves.
    railway_env: str = ""
    cloud_run_service: str = Field("", validation_alias=AliasChoices("K_SERVICE", "CLOUD_RUN_SERVICE"))

    @property
    def is_production(self) -> bool:
        """Any hosted platform counts, not only Vercel: DEV_AUTH must not survive a copy of the
        local env onto Railway or Cloud Run (the deployment targets named in app/main.py)."""
        return bool(self.vercel_env == "production" or self.railway_env or self.cloud_run_service)

    @property
    def dev_auth_active(self) -> bool:
        """DEV_AUTH counts only off production. A DEV_AUTH=true copied into the production
        environment by mistake would let anyone act as any dorm, so there it is ignored."""
        return self.dev_auth and not self.is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()
