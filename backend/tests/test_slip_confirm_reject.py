# -*- coding: utf-8 -*-
"""POST /v1/invoices/:id/slip, /confirm and /reject against the seeded dorm p_1.

Seed: 42 rooms, the first 12 (201-212) have a 2026-11 reading, so one billing run
creates inv_201_2026-11 with total 3562 (rent 3220 + water 125 + elec 217).
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth import Session, current_session
from app.db import get_engine
from app.main import create_app

OWNER_P1 = Session(user_id="u_owner1", role="owner", property_id="p_1")
OWNER_P2 = Session(user_id="u_owner2", role="owner", property_id="p_2")
TENANT_201 = Session(user_id="u_t201", role="tenant", property_id="p_1", room_id="r_201")
TENANT_202 = Session(user_id="u_t202", role="tenant", property_id="p_1", room_id="r_202")
TENANT_305 = Session(user_id="u_t305", role="tenant", property_id="p_1", room_id="r_305")
TENANT_UNBOUND = Session(user_id="u_none", role="tenant", property_id="p_1")
BILL_DAY = date(2026, 11, 4)
INVOICE = "inv_201_2026-11"


def as_user(engine, session) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[current_session] = lambda: session
    return TestClient(app)


def slip(engine, session=TENANT_201, invoice=INVOICE, body=None):
    return as_user(engine, session).post(f"/v1/invoices/{invoice}/slip", json=body or {})


def row(engine, sql, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).first()


@pytest.fixture
def billed(client_for, seeded):
    """View the year's bills first, so the invoice the tests slip exists."""
    assert client_for(seeded, OWNER_P1, BILL_DAY).post("/v1/billing/run", json={"period": "2026-11"}).status_code == 202
    return seeded


def test_slip_moves_the_invoice_to_pending(billed):
    res = slip(billed)
    assert res.status_code == 200
    assert res.json() == {"status": "pending", "verify": {"ok": None, "amount": 3562, "provider": "manual"}}

    assert row(billed, "select status from invoices where id = :id", id=INVOICE).status == "pending"
    payment = row(billed, "select amount, slip_key, verify_ok from payments where invoice_id = :id", id=INVOICE)
    assert tuple(payment) == (3562, None, None)


def test_slip_keeps_the_url_the_page_sent(billed):
    assert slip(billed, body={"slip_url": "s3://slips/201-1109.jpg"}).status_code == 200
    assert row(billed, "select slip_key from payments where invoice_id = :id", id=INVOICE).slip_key == "s3://slips/201-1109.jpg"


def test_tenant_cannot_slip_another_rooms_invoice(billed):
    res = slip(billed, session=TENANT_305)
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_tenant_without_a_room_is_refused(billed):
    assert slip(billed, session=TENANT_UNBOUND).status_code == 403


def test_slipping_twice_conflicts(billed):
    assert slip(billed).status_code == 200
    res = slip(billed)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "INVALID_STATE"


# --- POST /v1/invoices/:id/confirm --------------------------------------------------------------

def test_confirm_marks_paid_and_issues_a_receipt(billed):
    assert slip(billed).status_code == 200
    res = as_user(billed, OWNER_P1).post(f"/v1/invoices/{INVOICE}/confirm", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "paid"
    assert body["receipt_no"] == "REC-2026-11-0001"
    assert body["paid_at"]

    invoice = row(billed, "select status, receipt_no, paid_at from invoices where id = :id", id=INVOICE)
    assert invoice.status == "paid"
    assert invoice.paid_at is not None
    payment = row(billed, "select verify_ok, verified_by from payments where invoice_id = :id", id=INVOICE)
    assert tuple(payment) == (True, "u_owner1")


def test_confirm_needs_a_slip_first(billed):
    res = as_user(billed, OWNER_P1).post(f"/v1/invoices/{INVOICE}/confirm", json={})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "INVALID_STATE"


def test_other_dorm_cannot_confirm(billed):
    assert slip(billed).status_code == 200
    res = as_user(billed, OWNER_P2).post(f"/v1/invoices/{INVOICE}/confirm", json={})
    assert res.status_code == 404


def test_receipt_numbers_do_not_repeat(billed):
    other = "inv_202_2026-11"
    assert slip(billed, session=TENANT_202, invoice=other).status_code == 200
    assert slip(billed).status_code == 200
    owner = as_user(billed, OWNER_P1)
    assert owner.post(f"/v1/invoices/{INVOICE}/confirm", json={}).json()["receipt_no"] == "REC-2026-11-0001"
    assert owner.post(f"/v1/invoices/{other}/confirm", json={}).json()["receipt_no"] == "REC-2026-11-0002"


# --- POST /v1/invoices/:id/reject ---------------------------------------------------------------

def test_reject_sends_the_invoice_back_to_unpaid(billed):
    assert slip(billed).status_code == 200
    res = as_user(billed, OWNER_P1).post(
        f"/v1/invoices/{INVOICE}/reject", json={"reason": "ยอดในสลิปไม่ตรง"}
    )
    assert res.status_code == 200
    assert res.json() == {"status": "unpaid"}

    assert row(billed, "select status from invoices where id = :id", id=INVOICE).status == "unpaid"
    assert row(billed, "select verify_ok from payments where invoice_id = :id", id=INVOICE).verify_ok is False
    logged = row(billed, "select actor, payload from audit_log where action = 'invoice.reject'")
    assert logged.actor == "u_owner1"
    assert logged.payload["reason"] == "ยอดในสลิปไม่ตรง"


def test_reject_needs_a_pending_slip(billed):
    res = as_user(billed, OWNER_P1).post(f"/v1/invoices/{INVOICE}/reject", json={"reason": "x"})
    assert res.status_code == 409
