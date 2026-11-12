# -*- coding: utf-8 -*-
"""Tests that need no database: the session cookie and the LINE idToken check."""
import time

import pytest
from fastapi.testclient import TestClient

from app import line as line_module
from app import session as session_cookie
from app.main import create_app

SECRET = "test-secret"


# ---------------------------------------------------------------- cookie

def test_sign_and_unsign_roundtrip():
    token = session_cookie.sign({"uid": "U123", "role": "tenant", "property_id": "p_1", "room_id": "r_1"}, SECRET)
    payload = session_cookie.unsign(token, SECRET)
    assert payload["uid"] == "U123"
    assert payload["room_id"] == "r_1"
    assert payload["exp"] > time.time()


def test_tampered_token_is_rejected():
    token = session_cookie.sign({"uid": "U123"}, SECRET)
    body, sig = token.split(".")
    forged = body + "." + ("A" * len(sig))
    assert session_cookie.unsign(forged, SECRET) is None


def test_token_signed_with_another_secret_is_rejected():
    token = session_cookie.sign({"uid": "U123"}, "other-secret")
    assert session_cookie.unsign(token, SECRET) is None


def test_expired_token_is_rejected():
    token = session_cookie.sign({"uid": "U123"}, SECRET, ttl_seconds=-1)
    assert session_cookie.unsign(token, SECRET) is None


# ---------------------------------------------------------------- LINE verify

class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_verify_id_token_accepts_matching_channel(monkeypatch):
    monkeypatch.setattr(
        line_module.urllib.request, "urlopen",
        lambda request, timeout: _FakeResponse(b'{"sub":"U123","aud":"1234567890","name":"\\u0e2a\\u0e21"}'),
    )
    payload = line_module.verify_id_token("token", "1234567890")
    assert payload["sub"] == "U123"


def test_verify_id_token_rejects_other_channel(monkeypatch):
    from app.errors import ApiError

    monkeypatch.setattr(
        line_module.urllib.request, "urlopen",
        lambda request, timeout: _FakeResponse(b'{"sub":"U123","aud":"999"}'),
    )
    with pytest.raises(ApiError) as exc:
        line_module.verify_id_token("token", "1234567890")
    assert exc.value.status == 401
    assert exc.value.code == "UNAUTHORIZED"


# ---------------------------------------------------------------- endpoint guard

def test_login_returns_503_when_line_is_not_configured():
    from app.config import get_settings

    settings = get_settings()
    original = settings.line_channel_id
    settings.line_channel_id = ""
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        response = client.post("/v1/auth/line", json={"id_token": "whatever"})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "LINE_NOT_CONFIGURED"
    finally:
        settings.line_channel_id = original
        get_settings.cache_clear()
