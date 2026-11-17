"""push_text over the shared httpx client: return contract and connection reuse."""
import httpx
import pytest

from app import line_push
from app.config import get_settings


class _Resp:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class _Client:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setenv("LINE_CHANNEL_ACCESS_TOKEN", "tok123")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _fake(monkeypatch, result):
    fake = _Client(result)
    monkeypatch.setattr(line_push, "client", lambda: fake)
    return fake


def test_no_token_is_skipped(monkeypatch):
    monkeypatch.setenv("LINE_CHANNEL_ACCESS_TOKEN", "")
    get_settings.cache_clear()
    try:
        fake = _fake(monkeypatch, _Resp(200))
        assert line_push.push_text("U1", "hi") == "skipped: no LINE_CHANNEL_ACCESS_TOKEN"
        assert fake.calls == []
    finally:
        get_settings.cache_clear()


def test_200_is_ok_and_request_is_well_formed(monkeypatch, token):
    fake = _fake(monkeypatch, _Resp(200))
    assert line_push.push_text("U1", "hi") == "ok"
    url, kwargs = fake.calls[0]
    assert url == line_push.PUSH_URL
    assert kwargs["headers"]["Authorization"] == "Bearer tok123"
    assert kwargs["json"] == {"to": "U1", "messages": [{"type": "text", "text": "hi"}]}


def test_http_error_status_is_reported(monkeypatch, token):
    _fake(monkeypatch, _Resp(500, "x" * 500))
    result = line_push.push_text("U1", "hi")
    assert result.startswith("error: HTTP 500")
    assert len(result) <= len("error: HTTP 500 ") + 120


def test_transport_error_is_reported_not_raised(monkeypatch, token):
    _fake(monkeypatch, httpx.ConnectTimeout("slow"))
    assert line_push.push_text("U1", "hi").startswith("error:")


def test_client_is_created_once_and_reused():
    line_push.client.cache_clear()
    try:
        assert line_push.client() is line_push.client()
    finally:
        line_push.client.cache_clear()
