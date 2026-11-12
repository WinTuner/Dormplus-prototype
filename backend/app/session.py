"""Signed session cookie using only the standard library.

The cookie carries who is calling and which dorm they belong to. It is signed, not encrypted:
never put anything in it that the holder must not read.
"""
import base64
import hashlib
import hmac
import json
import time

COOKIE_NAME = "dp_session"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign(payload: dict, secret: str, ttl_seconds: int = 7 * 24 * 3600) -> str:
    body = dict(payload)
    body["exp"] = int(time.time()) + ttl_seconds
    raw = _b64(json.dumps(body, separators=(",", ":")).encode())
    sig = _b64(hmac.new(secret.encode(), raw.encode(), hashlib.sha256).digest())
    return f"{raw}.{sig}"


def unsign(token: str, secret: str) -> dict | None:
    """Return the payload, or None when the token is malformed, forged or expired."""
    try:
        raw, sig = token.split(".")
    except (AttributeError, ValueError):
        return None
    expected = _b64(hmac.new(secret.encode(), raw.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_unb64(raw))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    return payload
