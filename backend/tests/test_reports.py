"""GET /v1/reports/summary — one period's money and room counts (docs/API.md)."""
from datetime import date

from sqlalchemy import text

from app.auth import Session

OWNER = Session(user_id="u_owner", role="owner", property_id="p_1")
TENANT = Session(user_id="u_tenant", role="tenant", property_id="p_1", room_id="r_201")
BILL_DAY = date(2026, 11, 4)  # due date = 2026-11-09


def bill_november(client):
    assert client.post("/v1/billing/run", json={"period": "2026-11"}).status_code == 202


def test_summary_matches_the_invoice_list(seeded, client_for):
    client = client_for(seeded, OWNER, BILL_DAY)
    bill_november(client)
    with seeded.begin() as conn:
        conn.execute(text("update invoices set status = 'pending' where id = 'inv_202_2026-11'"))
        conn.execute(text("update invoices set status = 'paid' where id = 'inv_203_2026-11'"))

    summary = client.get("/v1/reports/summary?period=2026-11").json()
    listed = client.get("/v1/invoices?period=2026-11").json()

    assert summary["billed"] == listed["summary"]["total"]
    assert summary["paid"] == listed["summary"]["paid"]
    assert summary["pending"] == listed["summary"]["pending"]
    assert summary["unpaid"] == listed["summary"]["unpaid"]
    assert summary["rooms_total"] == 42, "every room of the dorm, billed or not"
    assert summary["rooms_paid"] == 1
    assert summary["rooms_overdue"] == 0, "due 2026-11-09, today is 2026-11-04"


def test_overdue_is_counted_only_after_the_due_date(seeded, client_for):
    bill_november(client_for(seeded, OWNER, BILL_DAY))
    body = client_for(seeded, OWNER, date(2026, 11, 12)).get("/v1/reports/summary?period=2026-11").json()
    assert body["rooms_overdue"] == 12, "every unpaid bill of the period is past due by then"


def test_period_defaults_to_this_month(seeded, client_for):
    # The seed leaves unpaid bills in 2026-10, so a default of "this month" has money in it.
    body = client_for(seeded, OWNER, date(2026, 10, 20)).get("/v1/reports/summary").json()
    assert body["billed"] > 0
    assert body["rooms_total"] == 42


def test_tenant_cannot_read_the_report(seeded, client_for):
    assert client_for(seeded, TENANT, BILL_DAY).get("/v1/reports/summary").status_code == 403


def test_another_dorm_sees_zeros(seeded, client_for):
    bill_november(client_for(seeded, OWNER, BILL_DAY))
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หอพักอีกแห่ง')"))
    body = client_for(seeded, Session(user_id="u2", role="owner", property_id="p_2"), BILL_DAY) \
        .get("/v1/reports/summary?period=2026-11").json()
    assert (body["billed"], body["rooms_total"]) == (0, 0)
