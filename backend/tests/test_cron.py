"""GET /v1/cron/daily — the one endpoint Vercel Cron calls.

No database needed: the reminder selection and the queue are stubbed, so these cases pin the
authorisation (header only, constant time) and that a run drains what it queued.
"""
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.routes import cron as cron_route

SECRET = "cron-secret-for-tests"


def make_client(monkeypatch, drained: list | None = None):
    monkeypatch.setenv("CRON_SECRET", SECRET)
    get_settings.cache_clear()
    monkeypatch.setattr(cron_route, "due_for_reminder", lambda *_a, **_k: [{"id": "inv_1"}])
    monkeypatch.setattr(cron_route, "queue_reminders", lambda rows: len(rows))

    async def fake_drain():
        if drained is not None:
            drained.append("drained")

    monkeypatch.setattr(cron_route, "drain_queue", fake_drain)
    return TestClient(create_app())


def test_no_secret_is_refused(monkeypatch):
    try:
        client = make_client(monkeypatch)
        assert client.get("/v1/cron/daily").status_code == 401
    finally:
        get_settings.cache_clear()


def test_a_wrong_secret_is_refused(monkeypatch):
    try:
        client = make_client(monkeypatch)
        res = client.get("/v1/cron/daily", headers={"Authorization": "Bearer nope"})
        assert res.status_code == 401
    finally:
        get_settings.cache_clear()


def test_a_token_in_the_url_is_refused(monkeypatch):
    try:
        client = make_client(monkeypatch)
        assert client.get(f"/v1/cron/daily?token={SECRET}").status_code == 401
    finally:
        get_settings.cache_clear()


def test_the_cron_secret_in_the_header_queues_and_drains(monkeypatch):
    drained: list = []
    try:
        client = make_client(monkeypatch, drained)
        res = client.get("/v1/cron/daily", headers={"Authorization": f"Bearer {SECRET}"})
        assert res.status_code == 200
        assert res.json() == {"queued": 1, "drained": True}
        assert drained == ["drained"], "the queue is drained in the same invocation"
    finally:
        get_settings.cache_clear()


def test_the_drain_app_knows_the_tasks(monkeypatch):
    """The worker looks a task up in its own App's dict. Tasks register on the sync app, so a drain
    app without the copy finds nothing, fails every job with TaskNotFound, and still answers 200."""
    from app.queue import get_app, get_async_app

    import app.tasks  # noqa: F401 - the decorator registers on the app get_app() returns

    assert "line.push_text" in get_app().tasks, "the task decorator registers on the sync app"
    assert "line.push_text" in get_async_app().tasks, "and the drain app has to know it too"


def test_an_unset_secret_never_authorises(monkeypatch):
    """A deployment that forgot CRON_SECRET must fail closed, not run with an empty token."""
    try:
        client = make_client(monkeypatch)
        monkeypatch.delenv("CRON_SECRET", raising=False)
        get_settings.cache_clear()
        res = client.get("/v1/cron/daily", headers={"Authorization": "Bearer "})
        assert res.status_code == 401
    finally:
        get_settings.cache_clear()
