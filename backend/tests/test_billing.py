"""POST /v1/billing/run and GET /v1/invoices against the seeded dorm p_1.

Seed: 42 rooms, all read for 2026-10, the first 12 (201-212) read for 2026-11, and 9 unpaid
invoices from Aug-Oct for rooms 203, 305, 312, 407 and 502.
"""
from datetime import date

import pytest
from sqlalchemy import event, text

from app.auth import Session
from app.routes import billing

OWNER_P1 = Session(user_id="u_owner1", role="owner", property_id="p_1")
OWNER_P2 = Session(user_id="u_owner2", role="owner", property_id="p_2")
TENANT_P1 = Session(user_id="u_tenant", role="tenant", property_id="p_1")
TENANT_R201 = Session(user_id="u_t201", role="tenant", property_id="p_1", room_id="r_201")
BILL_DAY = date(2026, 11, 4)  # the prototype's demo "today"; due date = +5 days = 2026-11-09


def scalar(engine, sql: str, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar_one()


def run(client, period="2026-11"):
    return client.post("/v1/billing/run", json={"period": period})


def read_all_rooms_for_november(engine):
    """Give the 30 rooms the seed left unread a November reading (+5 water, +31 elec)."""
    with engine.begin() as conn:
        conn.execute(text("""
            insert into readings (id, room_id, period, water_prev, water_now, elec_prev, elec_now)
            select 'rd_' || substr(o.room_id, 3) || '_2026-11', o.room_id, '2026-11',
                   o.water_now, o.water_now + 5, o.elec_now, o.elec_now + 31
            from readings o
            where o.period = '2026-10'
              and not exists (select 1 from readings n where n.room_id = o.room_id and n.period = '2026-11')
        """))


# --- POST /v1/billing/run -------------------------------------------------------------------------

def test_bills_the_rooms_that_have_this_months_reading(client_for, seeded):
    res = run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert res.status_code == 202
    assert res.json() == {"job_id": None, "period": "2026-11", "rooms_to_bill": 12,
                          "skipped_no_reading": 30, "skipped_no_previous_reading": 0,
                          "queued": 0, "drained": False}

    with seeded.connect() as conn:
        inv = conn.execute(text(
            "select total, rent, due_date, status from invoices where id = 'inv_201_2026-11'"
        )).one()
        items = conn.execute(text(
            "select label, qty, unit_price, amount from invoice_items "
            "where invoice_id = 'inv_201_2026-11' order by id"
        )).all()
    # Room 201: water 113 -> 118, elec 541 -> 572 (same as server.py)
    assert tuple(inv) == (3562, 3220, date(2026, 11, 9), "unpaid")
    assert [tuple(i) for i in items] == [("ค่าเช่า", 1, 3220, 3220), ("ค่าน้ำ", 5, 25, 125), ("ค่าไฟ", 31, 7, 217)]


def test_a_billing_run_is_a_handful_of_statements(client_for, seeded):
    """The run must not loop per room: this is the guard against the N+1 coming back."""
    read_all_rooms_for_november(seeded)
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(seeded, "before_cursor_execute", capture)
    try:
        res = run(client_for(seeded, OWNER_P1, BILL_DAY))
    finally:
        event.remove(seeded, "before_cursor_execute", capture)

    assert res.json()["rooms_to_bill"] == 42
    # Per-transaction set_config x2, dorm lock, rooms select, readings update, invoices insert,
    # items insert, audit insert, notify select = 9. The two set_config calls are intended: RLS is
    # set at the start of every transaction (app/db.py) because a per-connection setting is lost
    # behind Neon's PgBouncer pooler. Do not move it back to connect time to shave the count.
    assert len(statements) <= 10, f"{len(statements)} statements: {statements}"
    inserts = [s for s in statements if "insert into invoice" in s.lower()]
    assert len(inserts) == 2, "one multi-row insert for invoices, one for their items"


def test_items_keep_their_order_and_labels(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    with seeded.connect() as conn:
        labels = conn.execute(text(
            "select label from invoice_items where invoice_id = 'inv_202_2026-11' order by id"
        )).scalars().all()
    assert labels == ["ค่าเช่า", "ค่าน้ำ", "ค่าไฟ"]


def test_all_42_rooms_in_one_request(client_for, seeded):
    read_all_rooms_for_november(seeded)
    res = run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert res.json()["rooms_to_bill"] == 42
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 42
    assert scalar(seeded, "select count(*) from invoice_items i join invoices v on v.id = i.invoice_id "
                          "where v.period = '2026-11'") == 126


def test_running_again_with_rooms_still_unread_is_202(client_for, seeded):
    """Only a period with nothing left to bill is a conflict. A room that merely lacks a reading
    keeps the run answerable, so the owner sees what is left instead of a bare 409."""
    client = client_for(seeded, OWNER_P1, BILL_DAY)
    run(client)
    res = run(client)
    assert res.status_code == 202
    assert res.json()["rooms_to_bill"] == 0
    assert res.json()["skipped_no_reading"] == 30
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 12
    assert scalar(seeded, "select count(*) from audit_log where action = 'billing.run'") == 1


def test_running_again_after_every_room_is_billed_is_409(client_for, seeded):
    read_all_rooms_for_november(seeded)
    client = client_for(seeded, OWNER_P1, BILL_DAY)
    run(client)
    res = run(client)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 42
    assert scalar(seeded, "select count(*) from audit_log where action = 'billing.run'") == 1


def test_running_again_bills_rooms_read_since(client_for, seeded):
    client = client_for(seeded, OWNER_P1, BILL_DAY)
    run(client)
    client.put("/v1/rooms/r_301/reading", json={"period": "2026-11", "water_now": 135, "elec_now": 640})
    res = run(client)
    assert res.status_code == 202
    assert res.json()["rooms_to_bill"] == 1
    # r_301: water 128 -> 135, elec 604 -> 640
    assert scalar(seeded, "select total from invoices where id = 'inv_301_2026-11'") == 3220 + 7 * 25 + 36 * 7


def test_a_failure_halfway_rolls_back_the_whole_run(client_for, seeded):
    # The invoices and items are already written when the audit row is inserted; failing there must
    # undo all of it.
    def fail_on_audit(_conn, _cursor, statement, _parameters, _context, _executemany):
        if "insert into audit_log" in statement:
            raise RuntimeError("database went away")

    event.listen(seeded, "before_cursor_execute", fail_on_audit)
    try:
        with pytest.raises(RuntimeError):
            run(client_for(seeded, OWNER_P1, BILL_DAY))
    finally:
        event.remove(seeded, "before_cursor_execute", fail_on_audit)
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 0
    assert scalar(seeded, "select count(*) from invoice_items") == scalar(
        seeded, "select count(*) from invoice_items i join invoices v on v.id = i.invoice_id")
    assert scalar(seeded, "select count(*) from audit_log") == 0


def test_bill_uses_last_months_meter_as_it_is_now(client_for, seeded):
    # Owner corrects October after November was already recorded.
    with seeded.begin() as conn:
        conn.execute(text("update readings set water_now = 115 where room_id = 'r_201' and period = '2026-10'"))
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    water = scalar(seeded, "select qty from invoice_items where invoice_id = 'inv_201_2026-11' and label = 'ค่าน้ำ'")
    assert water == 118 - 115
    assert scalar(seeded, "select water_prev from readings where room_id = 'r_201' and period = '2026-11'") == 115


def test_flat_rate_rooms_need_no_reading_and_vacant_rooms_are_skipped(client_for, seeded):
    with seeded.begin() as conn:
        conn.execute(text("update rooms set mode = 'flat', rent = 3500 where id = 'r_301'"))
        conn.execute(text("update rooms set status = 'vacant' where id = 'r_201'"))
    res = run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert res.json()["rooms_to_bill"] == 12  # 11 read meter rooms + flat r_301; vacant r_201 left out
    assert scalar(seeded, "select total from invoices where id = 'inv_301_2026-11'") == 3500
    assert scalar(seeded, "select count(*) from invoice_items where invoice_id = 'inv_301_2026-11'") == 1
    assert scalar(seeded, "select count(*) from invoices where id = 'inv_201_2026-11'") == 0


def test_a_room_without_an_earlier_reading_is_not_billed(client_for, seeded):
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
        conn.execute(text("insert into rooms (id, property_id, room_no, rent) values ('r_p2_101', 'p_2', '101', 2800)"))
        conn.execute(text("insert into readings (id, room_id, period, water_now, elec_now) "
                          "values ('rd_p2_101_2026-11', 'r_p2_101', '2026-11', 50, 300)"))
    res = run(client_for(seeded, OWNER_P2, BILL_DAY))
    assert res.status_code == 202
    assert res.json()["rooms_to_bill"] == 0
    assert res.json()["skipped_no_previous_reading"] == 1
    # and dorm p_2's run did not touch dorm p_1
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 0


def test_tenants_cannot_run_billing(client_for, seeded):
    assert run(client_for(seeded, TENANT_P1, BILL_DAY)).status_code == 403


def test_bad_period_is_rejected(client_for, seeded):
    res = run(client_for(seeded, OWNER_P1, BILL_DAY), period="2026-1")
    assert res.status_code == 422


# --- GET /v1/invoices -----------------------------------------------------------------------------

def test_invoices_of_a_period_with_overdue_days_and_summary(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    with seeded.begin() as conn:
        conn.execute(text("update invoices set status = 'pending' where id = 'inv_202_2026-11'"))
        conn.execute(text("update invoices set status = 'paid' where id = 'inv_203_2026-11'"))

    body = client_for(seeded, OWNER_P1, date(2026, 11, 12)).get("/v1/invoices?period=2026-11").json()
    assert body["period"] == "2026-11"
    assert len(body["items"]) == 12
    by_room = {item["room_no"]: item for item in body["items"]}
    assert by_room["201"] == {"id": "inv_201_2026-11", "room_no": "201", "total": 3562, "status": "unpaid",
                              "due_date": "2026-11-09", "days_overdue": 3}
    assert by_room["202"]["days_overdue"] == 0  # slip sent, waiting for the owner
    assert by_room["203"]["days_overdue"] == 0

    s = body["summary"]
    assert s["total"] == s["paid"] + s["pending"] + s["unpaid"]
    assert s["paid"] == by_room["203"]["total"]
    assert s["pending"] == by_room["202"]["total"]


def test_filter_by_status(client_for, seeded):
    items = client_for(seeded, OWNER_P1, BILL_DAY).get("/v1/invoices?period=2026-10&status=unpaid").json()["items"]
    assert [i["room_no"] for i in items] == ["203", "305", "312", "407", "502"]
    assert {i["days_overdue"] for i in items} == {26}  # due 2026-10-09, today 2026-11-04


def test_period_defaults_to_this_month(client_for, seeded):
    body = client_for(seeded, OWNER_P1, date(2026, 10, 20)).get("/v1/invoices").json()
    assert body["period"] == "2026-10"
    assert len(body["items"]) == 5


def test_another_dorm_sees_none_of_these_invoices(client_for, seeded):
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
    body = client_for(seeded, OWNER_P2, BILL_DAY).get("/v1/invoices?period=2026-10").json()
    assert body["items"] == []
    assert body["summary"] == {"total": 0, "paid": 0, "pending": 0, "unpaid": 0}


def test_unknown_status_is_rejected(client_for, seeded):
    res = client_for(seeded, OWNER_P1, BILL_DAY).get("/v1/invoices?status=refunded")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION"


# --- GET /v1/invoices/:id -------------------------------------------------------------------------

def test_owner_reads_any_invoice_of_the_dorm(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    r = client_for(seeded, OWNER_P1, BILL_DAY).get("/v1/invoices/inv_201_2026-11")
    assert r.status_code == 200
    body = r.json()
    assert (body["id"], body["room_no"], body["total"]) == ("inv_201_2026-11", "201", 3562)
    assert (body["status"], body["due_date"], body["period"]) == ("unpaid", "2026-11-09", "2026-11")
    assert [i["label"] for i in body["items"]] == ["ค่าเช่า", "ค่าน้ำ", "ค่าไฟ"]
    assert body["items"][1] == {"label": "ค่าน้ำ", "qty": 5, "unit_price": 25, "amount": 125}
    assert body["payment"] is None


def capture_statements(engine, call):
    """Run call() and return what it sent to the database, without the per-transaction set_config."""
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        result = call()
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    # The set_config calls are intended: RLS is set at the start of every transaction (app/db.py),
    # so they are not part of what the endpoint itself costs.
    return result, [s for s in statements if "set_config" not in s]


def test_invoice_detail_is_one_select_with_items_and_latest_payment(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_1', true)"))
        conn.execute(text("""
            insert into payments (id, invoice_id, amount, slip_key, verify_ok, created_at) values
              ('pay_old', 'inv_201_2026-11', 1000, 'old.jpg', false, '2026-11-01 10:00+00'),
              ('pay_new', 'inv_201_2026-11', 3562, 'new.jpg', true, '2026-11-02 10:00+00')
        """))
    client = client_for(seeded, OWNER_P1, BILL_DAY)
    res, statements = capture_statements(seeded, lambda: client.get("/v1/invoices/inv_201_2026-11"))

    assert len(statements) == 1, f"{len(statements)} statements: {statements}"
    body = res.json()
    assert [i["label"] for i in body["items"]] == ["ค่าเช่า", "ค่าน้ำ", "ค่าไฟ"]
    assert body["payment"]["amount"] == 3562
    assert body["payment"]["slip_key"] == "new.jpg"
    assert body["payment"]["verify_ok"] is True
    assert body["payment"]["verified_at"] is None or isinstance(body["payment"]["verified_at"], str)


def test_invoice_without_items_or_payment_has_empty_items_and_null_payment(client_for, seeded):
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_1', true)"))
        conn.execute(text("insert into invoices (id, room_id, period, rent, total, due_date, status) "
                          "values ('inv_bare', 'r_201', '2026-12', 0, 0, date '2026-12-09', 'unpaid')"))
    body = client_for(seeded, OWNER_P1, BILL_DAY).get("/v1/invoices/inv_bare").json()
    assert body["items"] == []
    assert body["payment"] is None


def test_tenant_reads_own_room_invoice_only(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    tenant = client_for(seeded, TENANT_R201, BILL_DAY)
    assert tenant.get("/v1/invoices/inv_201_2026-11").status_code == 200
    assert tenant.get("/v1/invoices/inv_202_2026-11").status_code == 404


def test_payment_appears_after_the_slip(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    tenant = client_for(seeded, TENANT_R201, BILL_DAY)
    assert tenant.post("/v1/invoices/inv_201_2026-11/slip", json={}).status_code == 200
    body = tenant.get("/v1/invoices/inv_201_2026-11").json()
    assert body["status"] == "pending"
    assert body["payment"]["amount"] == 3562
    assert body["payment"]["verify_ok"] is None


def test_invoice_of_another_dorm_is_404(client_for, seeded):
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
        conn.execute(text("insert into rooms (id, property_id, room_no, rent) "
                          "values ('r_p2_101', 'p_2', '101', 2800)"))
        conn.execute(text("insert into invoices (id, room_id, period, rent, total, due_date, status) "
                          "values ('inv_p2_101_2026-10', 'r_p2_101', '2026-10', 2800, 2800, "
                          "date '2026-10-09', 'unpaid')"))
    assert client_for(seeded, OWNER_P1, BILL_DAY).get("/v1/invoices/inv_p2_101_2026-10").status_code == 404


def test_unknown_invoice_is_404(client_for, seeded):
    assert client_for(seeded, OWNER_P1, BILL_DAY).get("/v1/invoices/inv_nope").status_code == 404


# --- the bill message goes out with the run -------------------------------------------------------

def link_line(engine, *room_ids: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("update tenants set line_user_id = 'U_' || room_id "
                          "where room_id = any(:ids)"), {"ids": list(room_ids)})


def test_run_notifies_the_rooms_that_have_a_tenant(client_for, seeded, monkeypatch):
    link_line(seeded, "r_201", "r_202", "r_203")
    seen = {}
    drained = []

    def fake_notify(rows):
        seen["rows"] = rows
        return len(rows), "7"

    async def fake_drain():
        drained.append(True)

    monkeypatch.setattr(billing, "notify_invoices", fake_notify)
    monkeypatch.setattr(billing, "drain_queue", fake_drain)

    res = run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert res.status_code == 202
    body = res.json()
    assert (body["queued"], body["drained"], body["job_id"]) == (3, True, "7")
    assert body["rooms_to_bill"] == 12, "every ready room is billed, not only the messaged ones"
    assert {r["room_no"] for r in seen["rows"]} == {"201", "202", "203"}
    assert all(r["line_user_id"].startswith("U_") for r in seen["rows"])
    assert drained == [True]


def test_run_without_tenants_sends_nothing_and_does_not_drain(client_for, seeded, monkeypatch):
    seen = []

    async def no_drain():  # the seeded dorm has no LINE user, so there is nothing to send
        raise AssertionError("an empty queue must not be drained")

    # The notify path must still run: the answer is 0 because nobody is linked, not because the
    # block was skipped.
    monkeypatch.setattr(billing, "notify_invoices", lambda rows: (seen.append(rows), (len(rows), None))[1])
    monkeypatch.setattr(billing, "drain_queue", no_drain)
    body = run(client_for(seeded, OWNER_P1, BILL_DAY)).json()
    assert (body["queued"], body["drained"]) == (0, False)
    assert len(seen) == 1, "the notify path ran once"
    assert seen[0] == [], "and found no room with a tenant to message"


def test_queue_down_still_returns_the_bills(client_for, seeded, monkeypatch):
    link_line(seeded, "r_201")
    called = []

    def boom(rows):
        called.append(len(rows))
        raise RuntimeError("procrastinate tables are missing")

    async def no_drain():
        raise AssertionError("drain must not run when the enqueue failed")

    monkeypatch.setattr(billing, "notify_invoices", boom)
    monkeypatch.setattr(billing, "drain_queue", no_drain)

    res = run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert res.status_code == 202
    assert (res.json()["queued"], res.json()["drained"]) == (0, False)
    assert called, "the notify path was attempted with the linked room"
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 12

# --- review follow-ups ---------------------------------------------------------------------------

def test_a_failed_drain_keeps_the_queued_count(client_for, seeded, monkeypatch):
    link_line(seeded, "r_201", "r_202")

    def fake_notify(rows):
        return len(rows), "9"

    async def broken_drain():
        raise RuntimeError("worker could not start")

    monkeypatch.setattr(billing, "notify_invoices", fake_notify)
    monkeypatch.setattr(billing, "drain_queue", broken_drain)

    body = run(client_for(seeded, OWNER_P1, BILL_DAY)).json()
    # The two messages really are in the queue; saying 0 would be a lie the owner cannot act on.
    assert (body["queued"], body["drained"], body["job_id"]) == (2, False, "9")


def test_a_tenant_without_a_room_is_refused(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    roomless = Session(user_id="u_noroom", role="tenant", property_id="p_1")
    assert client_for(seeded, roomless, BILL_DAY).get(
        "/v1/invoices/inv_201_2026-11").status_code == 403


def test_two_tenants_in_one_room_get_one_message(client_for, seeded, monkeypatch):
    with seeded.begin() as conn:
        conn.execute(text("update tenants set line_user_id = 'U_OLD', moved_in = date '2026-01-01' "
                          "where room_id = 'r_201'"))
        conn.execute(text("insert into tenants (id, room_id, name, line_user_id, moved_in) "
                          "values ('t_201_new', 'r_201', 'ผู้เช่าใหม่', 'U_NEW', date '2026-11-01')"))

    seen = {}
    async def no_drain():
        return None

    monkeypatch.setattr(billing, "notify_invoices",
                        lambda rows: (seen.setdefault("rows", rows), (len(rows), "1"))[1])
    monkeypatch.setattr(billing, "drain_queue", no_drain)

    run(client_for(seeded, OWNER_P1, BILL_DAY))
    rooms = [r["room_no"] for r in seen["rows"]]
    assert rooms.count("201") == 1, "a room with roommates gets one bill message, not two"
    assert [r["line_user_id"] for r in seen["rows"] if r["room_no"] == "201"] == ["U_NEW"]


def test_all_42_bills_reach_the_tenant_and_the_message_log(client_for, seeded, monkeypatch):
    from app import notify as notify_module, tasks

    read_all_rooms_for_november(seeded)
    with seeded.begin() as conn:
        conn.execute(text("update tenants set line_user_id = 'U_' || room_id"))

    calls = []

    class FakePush:
        # Only batch_defer: the whole run is queued in one insert, so a per-row defer would fail here.
        def batch_defer(self, *jobs):
            start = len(calls)
            calls.extend(jobs)
            return list(range(start + 1, len(calls) + 1))

    class FakeApp:
        def open(self):
            class Ctx:
                def __enter__(self_inner): return None
                def __exit__(self_inner, *exc): return False
            return Ctx()

        def configure_task(self, name):
            return FakePush()

    async def no_drain():
        return None

    monkeypatch.setattr(notify_module, "app", FakeApp())
    monkeypatch.setattr(billing, "drain_queue", no_drain)

    body = run(client_for(seeded, OWNER_P1, BILL_DAY)).json()
    assert (body["rooms_to_bill"], body["queued"], body["drained"]) == (42, 42, True)

    # Run each queued job the way the worker would, with LINE answering 200.
    monkeypatch.setattr(tasks.line_push, "push_text", lambda to, text: "ok")
    monkeypatch.setattr(tasks, "get_engine", lambda: seeded)
    for call in calls:
        tasks.push_text(**call)

    assert scalar(seeded, "select count(*) from message_log where kind = 'invoice'") == 42
    assert scalar(seeded, "select count(*) from message_log "
                          "where kind = 'invoice' and line_status = 'ok'") == 42


def test_confirm_reads_paid_at_from_the_update_not_a_second_select(client_for, seeded):
    run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert client_for(seeded, TENANT_R201, BILL_DAY).post(
        "/v1/invoices/inv_201_2026-11/slip", json={}).status_code == 200
    owner = client_for(seeded, OWNER_P1, BILL_DAY)
    res, statements = capture_statements(
        seeded, lambda: owner.post("/v1/invoices/inv_201_2026-11/confirm", json={}))

    assert res.status_code == 200
    assert res.json()["paid_at"]
    assert not [s for s in statements if s.lower().lstrip().startswith("select paid_at")]
    assert any("returning paid_at" in s.lower() for s in statements)
