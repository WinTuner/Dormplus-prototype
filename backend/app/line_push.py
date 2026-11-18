"""Push a LINE text message, keeping time of delivery short.

Uses the Messaging API directly (the backend does not run LIFF pages).
"""
import functools

from app.config import get_settings

PUSH_URL = "https://api.line.me/v2/bot/message/push"
REPLY_URL = "https://api.line.me/v2/bot/message/reply"


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


def push_text(to_user_id: str, text: str, retry_key: str | None = None) -> str:
    """Send one text message. Returns the LINE status we can log ('ok' or 'error:…').

    `retry_key` (a UUID) makes LINE drop a repeat of the same push within 24 hours, so a job that
    retries after the message landed — the log insert failed, say — cannot send the text twice.
    """
    return _send(PUSH_URL, {"to": to_user_id, "messages": [{"type": "text", "text": text}]},
                 retry_key=retry_key)


def reply_text(reply_token: str, text: str) -> str:
    """Answer the event that just arrived. Free, but the token dies about a minute after the event."""
    return _send(REPLY_URL, {"replyToken": reply_token,
                             "messages": [{"type": "text", "text": text}]})


def _send(url: str, body: dict, retry_key: str | None = None) -> str:
    token = get_settings().line_channel_access_token
    if not token:
        return "skipped: no LINE_CHANNEL_ACCESS_TOKEN"

    import httpx

    headers = {"Authorization": f"Bearer {token}"}
    if retry_key:
        headers["X-Line-Retry-Key"] = retry_key
    try:
        response = client().post(url, json=body, headers=headers)
    except (httpx.HTTPError, OSError) as err:
        return f"error: {err}"
    if response.status_code == 200:
        return "ok"
    # 409 with a retry key is LINE saying it already accepted this exact push: the text is out, so
    # treat it as sent rather than retrying it forever.
    if retry_key and response.status_code == 409:
        return "ok"
    return f"error: HTTP {response.status_code} {response.text[:120]}"
