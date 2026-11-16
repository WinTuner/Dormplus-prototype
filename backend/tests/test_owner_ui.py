"""Owner web UI: POST /v1/auth/owner, the /owner page, and who may use the owner endpoints.

The code is one shared secret per deployment (one dorm per deploy), so these cases pin the three
things that matter: no code configured means no login, a wrong code costs a failure (rate limited
like the invite codes), and the cookie it hands out is an owner cookie and nothing else.
"""
from fastapi.testclient import TestClient

from app import attempts
from app.auth import Session
from app.config import get_settings
from app.main import create_app

CODE = "owner-code-for-tests"
TENANT = Session(user_id="u_tenant", role="tenant", property_id="p_1", room_id="r_201")


def owner_client(monkeypatch, eng, client_for):
    monkeypatch.setenv("OWNER_ACCESS_CODE", CODE)
    get_settings.cache_clear()
    return client_for(eng)


def test_owner_login_opens_the_rooms_screen(seeded, client_for, monkeypatch):
    client = owner_client(monkeypatch, seeded, client_for)

    res = client.post("/v1/auth/owner", json={"code": CODE})

    assert res.status_code == 200
    assert res.json() == {"role": "owner", "property_id": "p_1"}
    assert "dp_session" in res.cookies
    rooms = client.get("/v1/rooms?period=2026-11")
    assert rooms.status_code == 200
    assert len(rooms.json()["items"]) == 42  # the seeded dorm has 42 rooms


def test_a_wrong_code_is_a_failure_and_guessing_is_limited(seeded, client_for, monkeypatch):
    client = owner_client(monkeypatch, seeded, client_for)

    first = client.post("/v1/auth/owner", json={"code": "not-the-code"})
    assert first.status_code == 401
    assert first.json()["error"]["code"] == "UNAUTHORIZED"
    assert "dp_session" not in first.cookies

    for _ in range(attempts.MAX_FAILURES):
        client.post("/v1/auth/owner", json={"code": "not-the-code"})
    blocked = client.post("/v1/auth/owner", json={"code": CODE})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "TOO_MANY_ATTEMPTS"


def test_login_is_off_when_no_code_is_configured(monkeypatch):
    monkeypatch.delenv("OWNER_ACCESS_CODE", raising=False)
    get_settings.cache_clear()
    client = TestClient(create_app())

    res = client.post("/v1/auth/owner", json={"code": "anything"})

    assert res.status_code == 503
    assert res.json()["error"]["code"] == "OWNER_LOGIN_OFF"


def test_a_tenant_cookie_cannot_open_the_owner_screens(seeded, client_for):
    client = client_for(seeded, session=TENANT)

    assert client.get("/v1/rooms").status_code == 403
    assert client.get("/v1/reports/summary").status_code == 403
    assert client.post("/v1/billing/run", json={"period": "2026-11"}).status_code == 403


def test_logout_ends_the_owner_session(seeded, client_for, monkeypatch):
    client = owner_client(monkeypatch, seeded, client_for)
    client.post("/v1/auth/owner", json={"code": CODE})
    assert client.get("/v1/rooms?period=2026-11").status_code == 200

    assert client.post("/v1/auth/logout").status_code == 204

    assert client.get("/v1/rooms?period=2026-11").status_code == 401


def test_the_owner_page_is_served():
    client = TestClient(create_app())

    for path in ("/owner", "/owner/"):
        res = client.get(path, follow_redirects=True)
        assert res.status_code == 200, path
        assert "เจ้าของหอ" in res.text
        assert "/v1/auth/owner" in res.text
