"""Queue behaviour: what dunning selects, and that a queued job is not queued twice.

Procrastinate keeps its own tables (created with `procrastinate schema --apply`), so these tests do
not need them: selection is pure SQL against the app schema, and `queue_reminders` is stubbed.
"""
from datetime import date

import pytest
from sqlalchemy import text

from app import dunning
from app.auth import Session
from app.ids import reminder_kind

OWNER_P1 = Session(user_id="u_owner1", role="owner", property_id="p_1")
TODAY = date(2026, 11, 20)


def add_invoice(engine, invoice_id: str, room_id: str, due: date, status: str = "unpaid") -> None:
    with engine.begin() as conn:
        conn.execute(
            text("""
                insert into invoices (id, room_id, period, rent, total, due_date, status)
                values (:id, :room, '2026-11', 3500, 3930, :due, :status)
            """),
            {"id": invoice_id, "room": room_id, "due": due, "status": status},
        )


def set_line(engine, tenant_id: str, user_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("update tenants set line_user_id = :u where id = :id"), {"u": user_id, "id": tenant_id})


def test_reminder_kind_matches_the_days_late():
    assert reminder_kind(1) == "reminder_1"
    assert reminder_kind(5) == "reminder_5"
    assert reminder_kind(10) == "reminder_10"


def test_selects_only_1_5_10_days_late(seeded):
    add_invoice(seeded, "inv_due_1", "r_201", date(2026, 11, 19))
    add_invoice(seeded, "inv_due_3", "r_202", date(2026, 11, 17))
    add_invoice(seeded, "inv_due_5", "r_303", date(2026, 11, 15))
    set_line(seeded, "t_201", "U_201")
    set_line(seeded, "t_202", "U_202")
    set_line(seeded, "t_303", "U_303")

    rows = dunning.due_for_reminder(seeded, "p_1", TODAY)

    assert {r["id"] for r in rows} == {"inv_due_1", "inv_due_5"}
    assert {r["kind"] for r in rows} == {"reminder_1", "reminder_5"}
    assert all(r["line_user_id"] for r in rows)


def test_a_tenant_without_line_is_not_queued(seeded):
    add_invoice(seeded, "inv_due_1", "r_201", date(2026, 11, 19))  # t_201 has no line_user_id

    assert dunning.due_for_reminder(seeded, "p_1", TODAY) == []


def test_paid_invoices_are_skipped(seeded):
    add_invoice(seeded, "inv_paid", "r_201", date(2026, 11, 19), status="paid")
    set_line(seeded, "t_201", "U_201")

    assert dunning.due_for_reminder(seeded, "p_1", TODAY) == []


def test_a_reminder_already_logged_is_not_selected_again(seeded):
    add_invoice(seeded, "inv_due_1", "r_201", date(2026, 11, 19))
    set_line(seeded, "t_201", "U_201")
    assert len(dunning.due_for_reminder(seeded, "p_1", TODAY)) == 1

    with seeded.begin() as conn:
        conn.execute(
            text("insert into message_log (invoice_id, kind, to_user_id, line_status) values (:i, 'reminder_1', :u, 'ok')"),
            {"i": "inv_due_1", "u": "U_201"},
        )

    assert dunning.due_for_reminder(seeded, "p_1", TODAY) == []


def test_other_dorms_are_not_touched(seeded):
    with seeded.begin() as conn:
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หออื่น')"))
    add_invoice(seeded, "inv_other", "r_201", date(2026, 11, 19))
    set_line(seeded, "t_201", "U_201")
    with seeded.begin() as conn:
        conn.execute(text("update rooms set property_id = 'p_2' where id = 'r_201'"))

    assert dunning.due_for_reminder(seeded, "p_1", TODAY) == []


def test_queue_reminders_hands_each_row_to_the_worker(seeded, monkeypatch):
    calls = []

    class FakePush:
        def defer(self, **kwargs):
            calls.append(kwargs)

    class FakeApp:
        def open(self):
            class Ctx:
                def __enter__(self_inner):
                    return None

                def __exit__(self_inner, *exc):
                    return False

            return Ctx()

        def configure_task(self, name):
            assert name == "line.push_text"
            return FakePush()

    monkeypatch.setattr(dunning, "app", FakeApp())
    rows = [
        {"id": "inv_1", "period": "2026-11", "total": 3930, "due_date": date(2026, 11, 19),
         "room_no": "201", "line_user_id": "U_201", "days_late": 1, "kind": "reminder_1"},
    ]

    assert dunning.queue_reminders(rows) == 1
    assert calls[0]["to_user_id"] == "U_201"
    assert calls[0]["kind"] == "reminder_1"
    assert "3,930" in calls[0]["body"]
