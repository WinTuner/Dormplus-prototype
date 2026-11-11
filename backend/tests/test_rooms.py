"""GET /v1/rooms and PUT /v1/rooms/{id}/reading against the seeded dorm p_1."""
import pytest
from sqlalchemy import text

from app.auth import Session
from app.config import get_settings

OWNER_P1 = Session(user_id="u_owner1", role="owner", property_id="p_1")
OWNER_P2 = Session(user_id="u_owner2", role="owner", property_id="p_2")
TENANT_P1 = Session(user_id="u_tenant", role="tenant", property_id="p_1")


@pytest.fixture
def second_dorm(seeded):
    """A second dorm p_2 with one room, to prove dorms cannot see or touch each other."""
    with seeded.begin() as conn:
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
        conn.execute(text("insert into rooms (id, property_id, room_no, rent) values ('r_p2_101', 'p_2', '101', 2800)"))
    return seeded


def reading_row(engine, room_id: str, period: str):
    with engine.connect() as conn:
        return conn.execute(
            text("select water_prev, water_now, elec_prev, elec_now, recorded_by from readings "
                 "where room_id = :r and period = :p"),
            {"r": room_id, "p": period},
        ).first()


# --- auth -----------------------------------------------------------------------------------------

def test_rooms_need_a_session(client_for, seeded):
    res = client_for(seeded).get("/v1/rooms?period=2026-11")  # no session override, DEV_AUTH off
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_dev_auth_headers_pick_the_session(client_for, seeded, monkeypatch):
    monkeypatch.setenv("DEV_AUTH", "true")
    get_settings.cache_clear()
    try:
        client = client_for(seeded)
        res = client.get("/v1/rooms?period=2026-11", headers={"X-Dev-Property": "p_1"})
        assert res.status_code == 200
        assert len(res.json()["items"]) == 42
        assert client.get("/v1/rooms", headers={"X-Dev-Property": "p_1", "X-Dev-Role": "tenant"}).status_code == 403
        assert client.get("/v1/rooms").status_code == 401  # DEV_AUTH still needs a property
    finally:
        get_settings.cache_clear()


def test_tenants_cannot_list_rooms_or_record_meters(client_for, seeded):
    client = client_for(seeded, TENANT_P1)
    assert client.get("/v1/rooms").status_code == 403
    res = client.put("/v1/rooms/r_301/reading", json={"period": "2026-11", "water_now": 1, "elec_now": 1})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"


def test_another_dorm_sees_only_its_own_rooms(client_for, second_dorm):
    items = client_for(second_dorm, OWNER_P2).get("/v1/rooms?period=2026-11").json()["items"]
    assert [room["id"] for room in items] == ["r_p2_101"]


def test_another_dorm_cannot_record_a_meter_here(client_for, second_dorm):
    res = client_for(second_dorm, OWNER_P2).put(
        "/v1/rooms/r_301/reading", json={"period": "2026-11", "water_now": 200, "elec_now": 900}
    )
    assert res.status_code == 403
    assert reading_row(second_dorm, "r_301", "2026-11") is None


# --- GET /v1/rooms --------------------------------------------------------------------------------

def test_list_rooms_for_a_period(client_for, seeded):
    body = client_for(seeded, OWNER_P1).get("/v1/rooms?period=2026-11").json()
    assert body["period"] == "2026-11"
    items = {room["id"]: room for room in body["items"]}
    assert len(items) == 42
    assert body["items"][0]["room_no"] == "201"

    r201 = items["r_201"]
    assert r201["tenant"] == {"name": "ผู้เช่า 201", "line_linked": False}
    assert r201["reading"] == {"water_prev": 113, "water_now": 118, "elec_prev": 541, "elec_now": 572}
    assert r201["invoice"] is None

    assert items["r_301"]["reading"] is None  # only the first 12 rooms are read in November


def test_list_rooms_shows_the_invoice_of_that_period(client_for, seeded):
    items = client_for(seeded, OWNER_P1).get("/v1/rooms?period=2026-10").json()["items"]
    r203 = next(room for room in items if room["id"] == "r_203")
    assert r203["invoice"] == {"id": "inv_203_2026-10", "total": 3530, "status": "unpaid", "due_date": "2026-10-09"}


def test_list_rooms_rejects_a_bad_period(client_for, seeded):
    res = client_for(seeded, OWNER_P1).get("/v1/rooms?period=2026-13")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION"


# --- PUT /v1/rooms/{id}/reading -------------------------------------------------------------------

def test_record_a_reading_against_last_month(client_for, seeded):
    # r_301 is room #13 (floor 2 has 201-212): October ends at water 110 + 6*3 = 128, elec 520 + 4*21 = 604 (server.py formula)
    res = client_for(seeded, OWNER_P1).put(
        "/v1/rooms/r_301/reading", json={"period": "2026-11", "water_now": 135, "elec_now": 640}
    )
    assert res.status_code == 200
    assert res.json() == {"water_units": 7, "elec_units": 36, "warning": None}
    assert tuple(reading_row(seeded, "r_301", "2026-11")) == (128, 135, 604, 640, "u_owner1")


def test_sending_again_overwrites_until_billed(client_for, seeded):
    client = client_for(seeded, OWNER_P1)
    client.put("/v1/rooms/r_301/reading", json={"period": "2026-11", "water_now": 135, "elec_now": 640})
    res = client.put("/v1/rooms/r_301/reading", json={"period": "2026-11", "water_now": 133, "elec_now": 650})
    assert res.json() == {"water_units": 5, "elec_units": 46, "warning": None}
    with seeded.connect() as conn:
        rows = conn.execute(text("select count(*) from readings where room_id = 'r_301' and period = '2026-11'"))
        assert rows.scalar_one() == 1
    assert tuple(reading_row(seeded, "r_301", "2026-11"))[:4] == (128, 133, 604, 650)


def test_a_lower_meter_is_saved_with_a_warning(client_for, seeded):
    res = client_for(seeded, OWNER_P1).put(
        "/v1/rooms/r_301/reading", json={"period": "2026-11", "water_now": 100, "elec_now": 640}
    )
    assert res.status_code == 200
    assert res.json() == {"water_units": 0, "elec_units": 36, "warning": "METER_DECREASED"}
    assert reading_row(seeded, "r_301", "2026-11").water_now == 100


def test_first_reading_of_a_room_has_nothing_to_subtract(client_for, second_dorm):
    res = client_for(second_dorm, OWNER_P2).put(
        "/v1/rooms/r_p2_101/reading", json={"period": "2026-11", "water_now": 50, "elec_now": 300}
    )
    assert res.json() == {"water_units": 0, "elec_units": 0, "warning": "NO_PREVIOUS_READING"}
    assert tuple(reading_row(second_dorm, "r_p2_101", "2026-11"))[:4] == (None, 50, None, 300)


def test_a_billed_period_cannot_be_changed(client_for, seeded):
    res = client_for(seeded, OWNER_P1).put(
        "/v1/rooms/r_203/reading", json={"period": "2026-10", "water_now": 999, "elec_now": 999}
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"


def test_unknown_room(client_for, seeded):
    res = client_for(seeded, OWNER_P1).put(
        "/v1/rooms/r_999/reading", json={"period": "2026-11", "water_now": 1, "elec_now": 1}
    )
    assert res.status_code == 404


@pytest.mark.parametrize("body", [
    {"period": "2026-11", "water_now": -1, "elec_now": 10},
    {"period": "11/2026", "water_now": 1, "elec_now": 10},
    {"period": "2026-11", "water_now": 1},
])
def test_invalid_readings_are_rejected(client_for, seeded, body):
    res = client_for(seeded, OWNER_P1).put("/v1/rooms/r_301/reading", json=body)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION"
    assert reading_row(seeded, "r_301", "2026-11") is None
