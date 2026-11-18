"""Binding a tenant's LINE account to a room with an invite code.

LINE itself is faked: an idToken "tok:<userId>:<display name>" verifies as that user.
Seed: room r_203 has tenant t_203 with no LINE yet, and unpaid invoices from October.
"""
import pytest
from sqlalchemy import text

from app import line as line_module
from app.auth import Session
from app.config import get_settings

OWNER_P1 = Session(user_id="u_owner1", role="owner", property_id="p_1")
OWNER_P2 = Session(user_id="u_owner2", role="owner", property_id="p_2")
TENANT_P1 = Session(user_id="u_tenant", role="tenant", property_id="p_1", room_id="r_203")
LIFF_ID = "2000000000-abcdefgh"


@pytest.fixture
def line_ready(monkeypatch):
    monkeypatch.setenv("LINE_CHANNEL_ID", "1234567890")
    monkeypatch.setenv("LIFF_ID", LIFF_ID)
    get_settings.cache_clear()

    def fake_verify(id_token: str, channel_id: str) -> dict:
        _, sub, name = (id_token.split(":") + [""])[:3]
        return {"sub": sub, "aud": channel_id, "name": name or None}

    monkeypatch.setattr(line_module, "verify_id_token", fake_verify)
    yield
    get_settings.cache_clear()


@pytest.fixture
def owner(client_for, seeded, line_ready):
    return client_for(seeded, OWNER_P1)


@pytest.fixture
def phone(client_for, seeded, line_ready):
    """The tenant's LIFF page: no session until it logs in, then it carries the cookie."""
    return client_for(seeded)


def invite(owner, room="r_203", **body):
    res = owner.post(f"/v1/rooms/{room}/invite", json=body)
    assert res.status_code == 201, res.json()
    return res.json()


def link(phone, code, user="U_somchai", name="สมชาย"):
    return phone.post("/v1/auth/line/link", json={"id_token": f"tok:{user}:{name}", "code": code})


def one(engine, sql: str, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).first()


# --- owner creates an invite ----------------------------------------------------------------------

def test_invite_targets_the_rooms_tenant_without_line(owner, seeded):
    body = invite(owner)
    assert len(body["code"]) == 8
    assert body["tenant_id"] == "t_203"
    assert body["link_url"] == f"https://liff.line.me/{LIFF_ID}?code={body['code']}"
    # only a hash is kept
    assert one(seeded, "select count(*) from link_codes where code_hash = :c", c=body["code"])[0] == 0
    assert one(seeded, "select action from audit_log order by id desc limit 1").action == "invite.create"


def test_a_new_invite_for_the_same_tenant_cancels_the_old_one(owner, phone):
    first = invite(owner)["code"]
    second = invite(owner)["code"]
    assert link(phone, first).json()["error"]["code"] == "INVITE_EXPIRED"
    assert link(phone, second).status_code == 200


def test_cannot_invite_for_a_tenant_who_already_has_line(owner, phone):
    link(phone, invite(owner)["code"])
    res = owner.post("/v1/rooms/r_203/invite", json={"tenant_id": "t_203"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "TENANT_ALREADY_LINKED"


def test_only_the_dorms_owner_can_invite(client_for, seeded, line_ready):
    assert client_for(seeded, TENANT_P1).post("/v1/rooms/r_203/invite", json={}).status_code == 403
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
    res = client_for(seeded, OWNER_P2).post("/v1/rooms/r_203/invite", json={})
    assert res.status_code == 403
    assert one(seeded, "select count(*) from link_codes")[0] == 0


# --- tenant uses the invite -----------------------------------------------------------------------

def test_linking_binds_line_to_the_room_and_logs_in(owner, phone, seeded):
    res = link(phone, invite(owner)["code"])
    assert res.status_code == 200
    assert res.json() == {"user": {"room_no": "203", "name": "ผู้เช่า 203", "property_id": "p_1"}}
    assert one(seeded, "select line_user_id from tenants where id = 't_203'").line_user_id == "U_somchai"

    # the cookie from the link call is a working tenant session
    bills = phone.get("/v1/me/invoices")
    assert bills.status_code == 200
    assert "inv_203_2026-10" in [b["id"] for b in bills.json()["items"]]


def test_after_linking_a_plain_login_finds_the_room(owner, client_for, seeded, line_ready):
    link(client_for(seeded), invite(owner)["code"])
    res = client_for(seeded).post("/v1/auth/line", json={"id_token": "tok:U_somchai:สมชาย"})
    assert res.status_code == 200
    assert res.json()["user"]["room_no"] == "203"


def test_code_typed_in_lower_case_with_spaces_still_works(owner, phone):
    code = invite(owner)["code"]
    messy = f" {code[:4].lower()} {code[4:].lower()} "
    assert link(phone, messy).status_code == 200


def test_the_same_person_can_open_the_link_twice(owner, phone):
    code = invite(owner)["code"]
    assert link(phone, code).status_code == 200
    assert link(phone, code).status_code == 200


def test_someone_else_cannot_reuse_a_used_code(owner, client_for, seeded, line_ready):
    code = invite(owner)["code"]
    link(client_for(seeded), code)
    res = link(client_for(seeded), code, user="U_stranger", name="คนอื่น")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "INVITE_USED"
    assert one(seeded, "select count(*) from tenants where line_user_id = 'U_stranger'")[0] == 0


def test_unknown_code(phone):
    res = link(phone, "ZZZZZZZZ")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "INVITE_NOT_FOUND"


def test_expired_code(owner, phone, seeded):
    code = invite(owner)["code"]
    with seeded.begin() as conn:
        conn.execute(text("update link_codes set expires_at = now() - interval '1 minute'"))
    res = link(phone, code)
    assert res.status_code == 410
    assert res.json()["error"]["code"] == "INVITE_EXPIRED"


def test_revoked_code(owner, phone):
    code = invite(owner)["code"]
    assert owner.delete("/v1/rooms/r_203/invite").json() == {"revoked": 1}
    assert link(phone, code).status_code == 410


def test_an_invite_for_a_room_whose_tenant_is_linked_adds_a_roommate(owner, client_for, seeded, line_ready):
    link(client_for(seeded), invite(owner)["code"])
    body = invite(owner)  # t_203 has LINE now, so this one is for a new person
    assert body["tenant_id"] is None
    res = link(client_for(seeded), body["code"], user="U_mali", name="มะลิ")
    assert res.status_code == 200
    assert res.json()["user"]["name"] == "มะลิ"
    with seeded.connect() as conn:
        names = {r.name for r in conn.execute(
            text("select name from tenants where room_id = 'r_203' and line_user_id is not null"))}
    assert names == {"ผู้เช่า 203", "มะลิ"}


def test_link_answers_503_until_line_is_configured(client_for, seeded):
    res = client_for(seeded).post("/v1/auth/line/link", json={"id_token": "tok:U1:x", "code": "ABCDEFGH"})
    assert res.status_code == 503


# --- owner unlinks --------------------------------------------------------------------------------

def test_unlink_makes_the_next_login_not_linked(owner, client_for, seeded, line_ready):
    link(client_for(seeded), invite(owner)["code"])
    assert owner.delete("/v1/tenants/t_203/line").status_code == 204
    res = client_for(seeded).post("/v1/auth/line", json={"id_token": "tok:U_somchai:สมชาย"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "NOT_LINKED"


# --- invite lifetime and one-room-per-account ------------------------------------------------------

def test_an_expired_code_cannot_be_replayed_even_by_the_person_who_used_it(owner, client_for, seeded, line_ready):
    code = invite(owner)["code"]
    assert link(client_for(seeded), code).status_code == 200
    with seeded.begin() as conn:
        conn.execute(text("update link_codes set expires_at = now() - interval '1 day'"))
    res = link(client_for(seeded), code)
    assert res.status_code == 410
    assert res.json()["error"]["code"] == "INVITE_EXPIRED"


def test_a_revoked_code_cannot_be_replayed_even_by_the_person_who_used_it(owner, client_for, seeded, line_ready):
    code = invite(owner)["code"]
    assert link(client_for(seeded), code).status_code == 200
    with seeded.begin() as conn:
        conn.execute(text("update link_codes set revoked_at = now()"))
    res = link(client_for(seeded), code)
    assert res.status_code == 410
    assert res.json()["error"]["code"] == "INVITE_EXPIRED"


def test_one_line_account_cannot_hold_two_rooms(owner, client_for, seeded, line_ready):
    assert link(client_for(seeded), invite(owner)["code"]).status_code == 200
    res = link(client_for(seeded), invite(owner, room="r_204")["code"])
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "LINE_ON_ANOTHER_ROOM"
    with seeded.connect() as conn:
        linked = conn.execute(text(
            "select count(*) from tenants where line_user_id = 'U_somchai'"
        )).scalar_one()
    assert linked == 1


def test_the_same_person_can_come_back_to_the_same_room(owner, client_for, seeded, line_ready):
    """A move-out keeps the tenant row, so the unique (room_id, line_user_id) index still holds the
    key. Inviting the same account back must free it instead of failing with a 500."""
    client = client_for(seeded)
    assert link(client, invite(owner)["code"]).status_code == 200
    with seeded.begin() as conn:
        conn.execute(text("update tenants set moved_out = current_date - 1 where id = 't_203'"))

    res = link(client, invite(owner)["code"])
    assert res.status_code == 200, res.json()
    with seeded.connect() as conn:
        rows = conn.execute(text(
            "select id, moved_out from tenants where room_id = 'r_203' and line_user_id = 'U_somchai'"
        )).all()
    assert len(rows) == 1, "one row holds the key, the old one keeps only its history"
    assert rows[0].moved_out is None


def test_an_invite_needs_no_request_body(owner, seeded):
    res = owner.post("/v1/rooms/r_203/invite")
    assert res.status_code == 201, res.json()
    assert res.json()["tenant_id"] == "t_203"


def test_reissuing_revokes_the_old_code_and_writes_an_audit_row(owner, client_for, seeded, line_ready):
    old = invite(owner)["code"]
    new = invite(owner)["code"]
    assert link(client_for(seeded), old).status_code == 410
    assert link(client_for(seeded), new).status_code == 200

    row = one(seeded, "select payload from audit_log where action = 'invite.revoke' order by id desc limit 1")
    assert row is not None, "re-issuing must leave an audit trail"
    assert row.payload["reason"] == "reissued"
    assert row.payload["room_id"] == "r_203"


def test_another_dorm_cannot_unlink(client_for, seeded, line_ready):
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
    with seeded.begin() as conn:
        # The tenant belongs to p_1, so this update runs under p_1 (the transaction above reverted).
        conn.execute(text("update tenants set line_user_id = 'U_x' where id = 't_203'"))
    assert client_for(seeded, OWNER_P2).delete("/v1/tenants/t_203/line").status_code == 403
    assert one(seeded, "select line_user_id from tenants where id = 't_203'").line_user_id == "U_x"


# --- security: revoked sessions and guessing ------------------------------------------------------

def test_unlinking_ends_the_tenants_existing_session(owner, client_for, seeded, line_ready):
    phone = client_for(seeded)
    link(phone, invite(owner)["code"])
    assert phone.get("/v1/me/invoices").status_code == 200

    assert owner.delete("/v1/tenants/t_203/line").status_code == 204
    res = phone.get("/v1/me/invoices")  # same cookie, still within its 7 days
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "SESSION_REVOKED"


def test_moving_out_ends_the_tenants_existing_session(owner, client_for, seeded, line_ready):
    phone = client_for(seeded)
    link(phone, invite(owner)["code"])
    with seeded.begin() as conn:
        conn.execute(text("update tenants set moved_out = current_date where id = 't_203'"))
    assert phone.get("/v1/me/invoices").status_code == 401


def test_guessing_codes_is_rate_limited(owner, client_for, seeded, line_ready):
    from app.attempts import MAX_FAILURES

    phone = client_for(seeded)
    for i in range(MAX_FAILURES):
        assert link(phone, f"WRONG{i:03d}", user="U_guesser").status_code == 404
    real = invite(owner)["code"]
    res = link(phone, real, user="U_guesser")
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "TOO_MANY_ATTEMPTS"
    # someone else is not slowed down by the guesser
    assert link(client_for(seeded), real, user="U_somchai").status_code == 200


# --- the bill belongs to the person, not to the room ----------------------------------------------

def test_a_new_tenant_does_not_see_or_pay_the_previous_tenants_bills(owner, client_for, seeded, line_ready):
    """A room keeps its bills when someone moves out; the next person owes only from their own month."""
    with seeded.begin() as conn:
        conn.execute(text("update tenants set moved_in = date '2026-11-01' where id = 't_203'"))
        conn.execute(text("""insert into invoices (id, room_id, period, rent, total, due_date, status)
                             values ('inv_nov203', 'r_203', '2026-11', 3000, 3000,
                                     date '2026-11-09', 'unpaid')
                             on conflict (room_id, period) do nothing"""))
    october = one(seeded, "select id from invoices where room_id = 'r_203' and period = '2026-10'")
    november = one(seeded, "select id from invoices where room_id = 'r_203' and period = '2026-11'")

    phone = client_for(seeded)
    link(phone, invite(owner)["code"])

    assert [i["period"] for i in phone.get("/v1/me/invoices").json()["items"]] == ["2026-11"]
    assert phone.get(f"/v1/invoices/{november.id}").status_code == 200
    assert phone.get(f"/v1/invoices/{october.id}").status_code == 404
    assert phone.post(f"/v1/invoices/{october.id}/slip", json={"slip_url": None}).status_code == 404

