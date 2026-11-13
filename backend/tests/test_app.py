"""API-level tests. All but test_healthz_ok run without a database."""
import pytest
from sqlalchemy import create_engine

from app.config import get_settings

DEAD = "postgresql+psycopg://nobody@127.0.0.1:1/none"


@pytest.fixture
def env(monkeypatch):
    """Set environment variables for one test; settings are re-read before and after."""
    def put(**values):
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
    yield put
    get_settings.cache_clear()


def test_docs_are_served_off_production(client_for, env):
    env(VERCEL_ENV="preview")
    client = client_for(create_engine(DEAD))
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_docs_are_hidden_on_production(client_for, env):
    env(VERCEL_ENV="production")
    client = client_for(create_engine(DEAD))
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path


def test_dev_auth_is_ignored_on_production(client_for, env):
    env(VERCEL_ENV="production", DEV_AUTH="true")
    res = client_for(create_engine(DEAD)).get("/v1/rooms", headers={"X-Dev-Property": "p_1"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_unknown_path_uses_contract_error_shape(client_for):
    client = client_for(create_engine("postgresql+psycopg://nobody@127.0.0.1:1/none"))
    res = client.get("/v1/does-not-exist")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_healthz_reports_database_down(client_for):
    # Port 1 refuses connections, so this fails fast without a real database.
    dead = create_engine("postgresql+psycopg://nobody@127.0.0.1:1/none", connect_args={"connect_timeout": 2})
    res = client_for(dead).get("/healthz")
    assert res.status_code == 503
    assert res.json() == {"error": {"code": "DB_UNAVAILABLE", "message": "ต่อฐานข้อมูลไม่ได้"}}


def test_healthz_ok(client_for, engine):
    res = client_for(engine).get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
