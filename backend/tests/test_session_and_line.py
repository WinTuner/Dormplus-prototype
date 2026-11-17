# -*- coding: utf-8 -*-
"""Tests that need no database: the session cookie and the LINE idToken check."""
import time

import pytest
from fastapi.testclient import TestClient

from app import line as line_module
from app import line_push
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


def test_the_shipped_default_secret_is_never_trusted():
    """A deploy that forgot SESSION_SECRET must not hand out or accept cookies anyone can forge."""
    with pytest.raises(RuntimeError):
        session_cookie.sign({"uid": "U123", "role": "owner"}, session_cookie.DEFAULT_SECRET)
    forged = session_cookie.sign({"uid": "U123", "role": "owner"}, "a-real-secret").split(".")[0]
    with pytest.raises(RuntimeError):
        session_cookie.unsign(f"{forged}.anything", session_cookie.DEFAULT_SECRET)
    with pytest.raises(RuntimeError):
        session_cookie.sign({"uid": "U123"}, "")


# ---------------------------------------------------------------- LINE verify

class _FakeResponse:
    def __init__(self, payload=None, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        if self._payload is None:
            raise ValueError("bad json")
        return self._payload


class _FakeClient:
    """Stands in for the shared httpx client: returns a canned response or raises."""

    def __init__(self, result):
        self.result = result

    def post(self, url, **kwargs):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _use_client(monkeypatch, result):
    monkeypatch.setattr(line_push, "client", lambda: _FakeClient(result))


def test_verify_id_token_accepts_matching_channel(monkeypatch):
    _use_client(monkeypatch, _FakeResponse({"sub": "U123", "aud": "1234567890", "name": "สม"}))
    payload = line_module.verify_id_token("token", "1234567890")
    assert payload["sub"] == "U123"


def test_verify_id_token_rejects_other_channel(monkeypatch):
    from app.errors import ApiError

    _use_client(monkeypatch, _FakeResponse({"sub": "U123", "aud": "999"}))
    with pytest.raises(ApiError) as exc:
        line_module.verify_id_token("token", "1234567890")
    assert exc.value.status == 401
    assert exc.value.code == "UNAUTHORIZED"


def test_verify_id_token_maps_a_400_from_line_to_401(monkeypatch):
    from app.errors import ApiError

    _use_client(monkeypatch, _FakeResponse({"error": "invalid_request"}, status_code=400))
    with pytest.raises(ApiError) as exc:
        line_module.verify_id_token("token", "1234567890")
    assert exc.value.status == 401
    assert exc.value.code == "UNAUTHORIZED"


def test_verify_id_token_maps_a_transport_error_to_502(monkeypatch):
    import httpx
    from app.errors import ApiError

    _use_client(monkeypatch, httpx.ConnectError("boom"))
    with pytest.raises(ApiError) as exc:
        line_module.verify_id_token("token", "1234567890")
    assert exc.value.status == 502
    assert exc.value.code == "UPSTREAM"


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
