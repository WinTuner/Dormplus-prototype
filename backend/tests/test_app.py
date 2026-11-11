"""API-level tests. The first two run without a database."""
from sqlalchemy import create_engine


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
