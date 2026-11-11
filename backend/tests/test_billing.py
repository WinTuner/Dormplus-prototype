"""POST /v1/billing/run and GET /v1/invoices against the seeded dorm p_1.

Seed: 42 rooms, all read for 2026-10, the first 12 (201-212) read for 2026-11, and 9 unpaid
invoices from Aug-Oct for rooms 203, 305, 312, 407 and 502.
"""
from datetime import date

import pytest
from sqlalchemy import text

from app.auth import Session
from app.routes import billing

OWNER_P1 = Session(user_id="u_owner1", role="owner", property_id="p_1")
OWNER_P2 = Session(user_id="u_owner2", role="owner", property_id="p_2")
TENANT_P1 = Session(user_id="u_tenant", role="tenant", property_id="p_1")
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
                          "skipped_no_reading": 30, "skipped_no_previous_reading": 0}

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


def test_all_42_rooms_in_one_request(client_for, seeded):
    read_all_rooms_for_november(seeded)
    res = run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert res.json()["rooms_to_bill"] == 42
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 42
    assert scalar(seeded, "select count(*) from invoice_items i join invoices v on v.id = i.invoice_id "
                          "where v.period = '2026-11'") == 126


def test_running_again_is_409_and_creates_nothing(client_for, seeded):
    client = client_for(seeded, OWNER_P1, BILL_DAY)
    run(client)
    res = run(client)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 12
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


def test_a_failure_halfway_rolls_back_the_whole_run(client_for, seeded, monkeypatch):
    real = billing.create_invoice
    calls = {"n": 0}

    def fail_on_fifth(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 5:
            raise RuntimeError("database went away")
        return real(*args, **kwargs)

    monkeypatch.setattr(billing, "create_invoice", fail_on_fifth)
    with pytest.raises(RuntimeError):
        run(client_for(seeded, OWNER_P1, BILL_DAY))
    assert scalar(seeded, "select count(*) from invoices where period = '2026-11'") == 0
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
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
    body = client_for(seeded, OWNER_P2, BILL_DAY).get("/v1/invoices?period=2026-10").json()
    assert body["items"] == []
    assert body["summary"] == {"total": 0, "paid": 0, "pending": 0, "unpaid": 0}


def test_unknown_status_is_rejected(client_for, seeded):
    res = client_for(seeded, OWNER_P1, BILL_DAY).get("/v1/invoices?status=refunded")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION"
