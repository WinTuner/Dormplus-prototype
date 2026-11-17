"""app/secrets.py — the key never leaves the server, and a wrong key is an error, not a fallback."""
import pytest
from cryptography.fernet import Fernet

from app import secrets
from app.config import get_settings


@pytest.fixture
def key(monkeypatch):
    value = Fernet.generate_key().decode()
    monkeypatch.setenv("SECRET_ENC_KEY", value)
    get_settings.cache_clear()
    yield value
    get_settings.cache_clear()


def test_encrypt_then_decrypt_round_trips(key):
    blob = secrets.encrypt("s3cret-for-tests")
    assert blob != b"s3cret-for-tests", "the column must not hold the plain secret"
    assert secrets.decrypt(blob) == "s3cret-for-tests"


def test_another_key_cannot_read_the_value(key, monkeypatch):
    blob = secrets.encrypt("s3cret-for-tests")
    monkeypatch.setenv("SECRET_ENC_KEY", Fernet.generate_key().decode())
    get_settings.cache_clear()
    with pytest.raises(secrets.Undecryptable):
        secrets.decrypt(blob)


def test_no_key_is_an_error_not_an_empty_secret(monkeypatch):
    monkeypatch.setenv("SECRET_ENC_KEY", "")
    get_settings.cache_clear()
    try:
        with pytest.raises(secrets.KeyMissing):
            secrets.encrypt("s3cret-for-tests")
    finally:
        get_settings.cache_clear()


def test_a_value_that_is_not_a_key_is_reported_as_missing(monkeypatch):
    monkeypatch.setenv("SECRET_ENC_KEY", "not-a-fernet-key")
    get_settings.cache_clear()
    try:
        with pytest.raises(secrets.KeyMissing):
            secrets.encrypt("s3cret-for-tests")
    finally:
        get_settings.cache_clear()
