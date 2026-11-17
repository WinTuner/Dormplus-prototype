"""POST /v1/webhooks/line/{property_id} â€” verify the signature, then log what arrived.

Mutation of the section below must stay in step with docs/API.md ("Webhook").
"""
import base64
import hashlib
import hmac
import json

import pytest
from sqlalchemy import text

from app.config import get_settings

SECRET = "s3cret-for-tests"


def sign(body: bytes, secret: str = SECRET) -> str:
    return base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()


@pytest.fixture
def line_secret(monkeypatch):
    """Turn the webhook on for one test, and put the cached settings back afterwards."""
    monkeypatch.setenv("LINE_CHANNEL_SECRET", SECRET)
    get_settings.cache_clear()
    yield SECRET
    get_settings.cache_clear()


def post(client, body: bytes, signature: str, property_id: str = "p_1"):
    return client.post(
        f"/v1/webhooks/line/{property_id}",
        content=body,
        headers={"X-Line-Signature": signature, "Content-Type": "application/json"},
    )


def audit_rows(engine):
    with engine.connect() as conn:
        return conn.execute(
            text("select property_id, actor, payload from audit_log where action = 'webhook.line'")
        ).all()


def test_valid_signature_is_200_and_writes_one_audit_row(seeded, client_for, line_secret):
    # Deliberately non-canonical JSON: the signature is over the exact bytes, so an implementation
    # that parsed and re-serialised the body before hashing would fail here.
    body = b'{"events": [ {"type":"follow"},{"type":"message"} ]}'
    r = post(client_for(seeded), body, sign(body))
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    rows = audit_rows(seeded)
    assert len(rows) == 1
    assert rows[0].property_id == "p_1"
    assert rows[0].payload == {"count": 2, "types": ["follow", "message"]}


def test_bad_signature_is_401_and_logs_nothing(seeded, client_for, line_secret):
    body = b'{"events":[{"type":"follow"}]}'
    assert post(client_for(seeded), body, sign(body, "another-secret")).status_code == 401
    assert audit_rows(seeded) == []


def test_another_dorm_is_404_even_with_a_valid_signature(seeded, client_for, line_secret):
    body = b'{"events":[{"type":"follow"}]}'
    assert post(client_for(seeded), body, sign(body), property_id="p_2").status_code == 404
    assert audit_rows(seeded) == []


def test_body_that_is_not_json_is_400(seeded, client_for, line_secret):
    body = b"not json at all"
    assert post(client_for(seeded), body, sign(body)).status_code == 400
    assert audit_rows(seeded) == []


def test_missing_secret_is_503(seeded, client_for, monkeypatch):
    monkeypatch.setenv("LINE_CHANNEL_SECRET", "")
    get_settings.cache_clear()
    try:
        body = b'{"events":[]}'
        assert post(client_for(seeded), body, sign(body)).status_code == 503
    finally:
        get_settings.cache_clear()

def test_a_header_with_non_ascii_characters_does_not_match(seeded, client_for, line_secret):
    """A header LINE would never send must fail the check, not crash the handler."""
    from app.routes import webhooks

    body = b'{"events":[]}'
    assert webhooks.signature_matches(SECRET, body, "ünïcode") is False
    assert webhooks.signature_matches(SECRET, body, sign(body)) is True

def test_a_redelivered_event_is_ignored(seeded, client_for, line_secret):
    """LINE retries a delivery it did not see answered; the same event must not be recorded twice."""
    body = json.dumps({"events": [{"type": "message", "webhookEventId": "01HABCDEF"}]}).encode()
    client = client_for(seeded)
    assert post(client, body, sign(body)).status_code == 200
    assert post(client, body, sign(body)).status_code == 200
    assert len(audit_rows(seeded)) == 1, "the second delivery adds nothing"

    other = json.dumps({"events": [{"type": "follow", "webhookEventId": "01HOTHER"}]}).encode()
    assert post(client, other, sign(other)).status_code == 200
    assert len(audit_rows(seeded)) == 2, "a different event is still recorded"


# ------------------------------------------------------- the dorm's own secret (properties.line_secret_enc)
STORED = "stored-secret-for-p_1"


@pytest.fixture
def enc_key(monkeypatch):
    """A throwaway SECRET_ENC_KEY for one test; settings are cached, so clear them both ways."""
    from cryptography.fernet import Fernet

    monkeypatch.setenv("SECRET_ENC_KEY", Fernet.generate_key().decode())
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def store_secret(engine, value: str = STORED) -> None:
    from app import secrets

    with engine.begin() as conn:
        conn.execute(text("update properties set line_secret_enc = :blob where id = 'p_1'"),
                     {"blob": secrets.encrypt(value)})


def test_a_stored_secret_wins_over_the_env(seeded, client_for, line_secret, enc_key):
    store_secret(seeded)
    client = client_for(seeded)
    body = b'{"events":[{"type":"follow"}]}'
    assert post(client, body, sign(body, STORED)).status_code == 200
    assert post(client, body, sign(body, SECRET)).status_code == 401, "the env value is only a fallback"


def test_a_stored_secret_works_without_the_env(seeded, client_for, monkeypatch, enc_key):
    monkeypatch.setenv("LINE_CHANNEL_SECRET", "")
    get_settings.cache_clear()
    try:
        store_secret(seeded)
        body = b'{"events":[]}'
        assert post(client_for(seeded), body, sign(body, STORED)).status_code == 200
    finally:
        get_settings.cache_clear()


def test_an_unreadable_stored_secret_is_503_not_401(seeded, client_for, line_secret, enc_key, monkeypatch):
    """A rotated or lost key must pause delivery (5xx retries), not reject every signature forever."""
    from cryptography.fernet import Fernet

    store_secret(seeded)
    monkeypatch.setenv("SECRET_ENC_KEY", Fernet.generate_key().decode())
    get_settings.cache_clear()

    body = b'{"events":[{"type":"follow"}]}'
    r = post(client_for(seeded), body, sign(body, STORED))
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "LINE_SECRET_UNREADABLE"
    assert audit_rows(seeded) == []

