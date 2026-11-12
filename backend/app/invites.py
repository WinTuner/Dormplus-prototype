"""Invite codes for binding a tenant's LINE account to a room (see migration 0002).

A code is 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L), about 10^12
combinations. Only its SHA-256 hash is stored. It works once and expires after 7 days.
"""
import hashlib
import secrets
from datetime import timedelta
from urllib.parse import quote

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
TTL = timedelta(days=7)


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def hash_code(code: str) -> str:
    """Typed codes may come in lower case or with spaces, so normalise before hashing."""
    return hashlib.sha256(code.strip().upper().replace(" ", "").encode()).hexdigest()


def liff_link(liff_id: str, code: str) -> str | None:
    """The link to put in the QR. LIFF hands the query string on to the page."""
    if not liff_id:
        return None
    return f"https://liff.line.me/{liff_id}?code={quote(code)}"
