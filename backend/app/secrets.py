"""Encrypting the per-dorm LINE credentials kept in `properties.line_*_enc`.

The key is one deployment-wide `SECRET_ENC_KEY` (urlsafe-base64 32 bytes; `Fernet.generate_key()`
prints one). A value encrypted under another key must never be read as "no secret configured":
checking signatures with the wrong secret answers 401 forever, so the webhook turns an unreadable
column into 503 and LINE keeps retrying until an operator fixes the key.
"""
import binascii

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class KeyMissing(Exception):
    """`SECRET_ENC_KEY` is unset or is not a Fernet key."""


class Undecryptable(Exception):
    """The stored bytes were encrypted with a key this deployment does not hold."""


def _fernet() -> Fernet:
    raw = get_settings().secret_enc_key
    if not raw:
        raise KeyMissing("SECRET_ENC_KEY is not set")
    try:
        return Fernet(raw.encode())
    except (binascii.Error, ValueError) as err:
        raise KeyMissing(f"SECRET_ENC_KEY is not a Fernet key: {err}") from err


def encrypt(value: str) -> bytes:
    return _fernet().encrypt(value.encode())


def decrypt(blob: bytes) -> str:
    try:
        return _fernet().decrypt(blob).decode()
    except InvalidToken as err:
        raise Undecryptable("stored value does not decrypt with SECRET_ENC_KEY") from err
