"""Push a LINE text message, keeping time of delivery short.

Uses the Messaging API directly (the backend does not run LIFF pages).
"""
import json
import urllib.error
import urllib.request

from app.config import get_settings

PUSH_URL = "https://api.line.me/v2/bot/message/push"


def push_text(to_user_id: str, text: str) -> str:
    """Send one text message. Returns the LINE status we can log ('ok' or 'error:…')."""
    token = get_settings().line_channel_access_token
    if not token:
        return "skipped: no LINE_CHANNEL_ACCESS_TOKEN"

    body = json.dumps({"to": to_user_id, "messages": [{"type": "text", "text": text}]}).encode()
    request = urllib.request.Request(
        PUSH_URL,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return "ok" if response.status == 200 else f"error: HTTP {response.status}"
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:120]
        return f"error: HTTP {err.code} {detail}"
    except (urllib.error.URLError, OSError) as err:
        return f"error: {err}"
