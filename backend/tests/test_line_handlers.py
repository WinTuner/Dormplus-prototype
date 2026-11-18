"""The webhook's answers: a welcome on follow, the tenant's bill on "บิล".

Mutation of this section must stay in step with docs/API.md ("Webhook").
"""
import base64
import hashlib
import hmac
import json

import pytest
from sqlalchemy import text

from app import line_handlers, line_push
from app.config import get_settings

SECRET = "s3cret-for-tests"


def sign(body: bytes, secret: str = SECRET) -> str:
    return base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()


@pytest.fixture
def line_secret(monkeypatch):
    monkeypatch.setenv("LINE_CHANNEL_SECRET", SECRET)
    get_settings.cache_clear()
    yield SECRET
    get_settings.cache_clear()


@pytest.fixture
def replies(monkeypatch):
    """Collect what would go to LINE instead of calling it."""
    sent = []
    monkeypatch.setattr(line_push, "reply_text",
                        lambda token, text: sent.append((token, text)) or "ok")
    return sent


def deliver(client, events: list[dict]):
    body = json.dumps({"events": events}).encode()
    return client.post(
        "/v1/webhooks/line/p_1",
        content=body,
        headers={"X-Line-Signature": sign(body), "Content-Type": "application/json"},
    )


def follow(event_id: str = "ev_1", user_id: str = "U203") -> dict:
    return {"type": "follow", "webhookEventId": event_id, "replyToken": f"rt_{event_id}",
            "source": {"type": "user", "userId": user_id}}


def says(text: str, event_id: str = "ev_1", user_id: str = "U203") -> dict:
    return {"type": "message", "webhookEventId": event_id, "replyToken": f"rt_{event_id}",
            "source": {"type": "user", "userId": user_id},
            "message": {"type": "text", "text": text}}


def bind(engine, user_id: str, room_no: str = "203"):
    with engine.begin() as conn:
        conn.execute(text("update tenants set line_user_id = :uid where id = :tid"),
                     {"uid": user_id, "tid": f"t_{room_no}"})


def test_a_follow_gets_the_welcome(seeded, client_for, line_secret, replies):
    r = deliver(client_for(seeded), [follow()])

    assert r.status_code == 200
    assert replies == [("rt_ev_1", line_handlers.WELCOME)]


def test_bill_answers_with_the_tenants_newest_bill(seeded, client_for, line_secret, replies):
    bind(seeded, "U203")
    r = deliver(client_for(seeded), [says("บิล")])

    assert r.status_code == 200
    token, text = replies[0]
    assert token == "rt_ev_1"
    assert "ห้อง 203" in text
    assert "2026-10" in text          # the seeded arrears period
    assert "รอชำระ" in text
    assert "บาท" in text


def test_bill_from_someone_not_bound_says_so(seeded, client_for, line_secret, replies):
    deliver(client_for(seeded), [says("บิล", user_id="U_stranger")])

    assert replies[0][1] == line_handlers.NO_ROOM


def test_other_text_is_not_answered(seeded, client_for, line_secret, replies):
    r = deliver(client_for(seeded), [says("สวัสดี")])

    assert r.status_code == 200
    assert replies == []


def test_a_redelivery_does_not_answer_twice(seeded, client_for, line_secret, replies):
    client = client_for(seeded)
    deliver(client, [follow()])
    deliver(client, [follow()])

    assert len(replies) == 1


def test_a_broken_handler_still_answers_line_200(seeded, client_for, line_secret, monkeypatch):
    def explode(token, text):
        raise RuntimeError("LINE is down")

    monkeypatch.setattr(line_push, "reply_text", explode)
    r = deliver(client_for(seeded), [follow()])

    assert r.status_code == 200
    assert r.json() == {"ok": True}
