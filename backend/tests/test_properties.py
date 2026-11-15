"""GET /v1/properties/{id} — the owning dorm's settings."""
from app.auth import Session
from app.seed import PROPERTY_NAME, room_numbers

OWNER = Session(user_id="u_owner", role="owner", property_id="p_1")
TENANT = Session(user_id="u_tenant", role="tenant", property_id="p_1", room_id="r_201")


def test_owner_reads_own_property(seeded, client_for):
    r = client_for(seeded, OWNER).get("/v1/properties/p_1")
    assert r.status_code == 200
    body = r.json()
    assert (body["id"], body["name"], body["billing_mode"]) == ("p_1", PROPERTY_NAME, "meter")
    assert body["rooms"] == len(room_numbers())  # every room, vacant ones included
    assert (body["water_rate"], body["elec_rate"], body["due_days"]) == (25, 7, 5)


def test_other_property_is_404(seeded, client_for):
    # Never 403: the caller must not learn that another dorm exists.
    assert client_for(seeded, OWNER).get("/v1/properties/p_2").status_code == 404


def test_tenant_is_403(seeded, client_for):
    assert client_for(seeded, TENANT).get("/v1/properties/p_1").status_code == 403


def test_anonymous_is_401(seeded, client_for):
    assert client_for(seeded).get("/v1/properties/p_1").status_code == 401
