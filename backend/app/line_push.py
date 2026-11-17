"""Push a LINE text message, keeping time of delivery short.

Uses the Messaging API directly (the backend does not run LIFF pages).
"""
import functools

from app.config import get_settings

PUSH_URL = "https://api.line.me/v2/bot/message/push"


@functools.lru_cache(maxsize=1)
def client():
    """One shared keep-alive HTTPS client for every LINE call.

    A new urllib request pays a TCP + TLS handshake each time; reusing one client
    keeps the connection to api.line.me open. httpx.Client is thread-safe, and
    lru_cache makes the first creation race-free enough (worst case one spare client).
    httpx is imported here, not at module top, so app start-up stays cheap.
    """
    import httpx

    return httpx.Client(timeout=10)


def push_text(to_user_id: str, text: str) -> str:
    """Send one text message. Returns the LINE status we can log ('ok' or 'error:…')."""
    token = get_settings().line_channel_access_token
    if not token:
        return "skipped: no LINE_CHANNEL_ACCESS_TOKEN"

    import httpx

    try:
        response = client().post(
            PUSH_URL,
            json={"to": to_user_id, "messages": [{"type": "text", "text": text}]},
            headers={"Authorization": f"Bearer {token}"},
        )
    except (httpx.HTTPError, OSError) as err:
        return f"error: {err}"
    if response.status_code == 200:
        return "ok"
    return f"error: HTTP {response.status_code} {response.text[:120]}"
