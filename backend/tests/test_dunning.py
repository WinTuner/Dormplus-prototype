"""Queue behaviour: what dunning selects, and that a queued job is not queued twice.

Procrastinate keeps its own tables (created with `procrastinate schema --apply`), so these tests do
not need them: selection is pure SQL against the app schema, and `queue_reminders` is stubbed.
"""
from datetime import date, timedelta

import pytest
from fastapi import Request
from sqlalchemy import event, text

from app import dunning
from app.auth import Session
from app.routes.dunning import presented_token
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


def set_moved_out(engine, tenant_id: str, day: date) -> None:
    with engine.begin() as conn:
        conn.execute(text("update tenants set moved_out = :d where id = :id"), {"d": day, "id": tenant_id})


def test_reminder_kind_matches_the_days_late():
    assert reminder_kind(1) == "reminder_1"
    assert reminder_kind(5) == "reminder_5"
    assert reminder_kind(10) == "reminder_10"


def _request(headers: dict) -> Request:
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]})


def test_cron_token_is_read_from_the_header_only():
    """A token in the query string ends up in access logs, so only the header counts."""
    assert presented_token(_request({"Authorization": "Bearer s3cret"})) == "s3cret"
    assert presented_token(_request({})) is None


def test_a_token_in_the_url_is_refused(client_for, seeded, monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("DUNNING_TOKEN", "cron-secret")
    get_settings.cache_clear()
    try:
        client = client_for(seeded)
        res = client.post("/v1/dunning/run?token=cron-secret")
        assert res.status_code == 401
        from app.routes import dunning as dunning_route
        monkeypatch.setattr(dunning_route, "queue_reminders", lambda rows: len(rows))
        ok = client.post("/v1/dunning/run", headers={"Authorization": "Bearer cron-secret"})
        assert ok.status_code == 200
        bad = client.post("/v1/dunning/run", headers={"Authorization": "Bearer wrong"})
        assert bad.status_code == 401
    finally:
        get_settings.cache_clear()


def test_each_invoice_gets_the_step_it_has_reached(seeded):
    add_invoice(seeded, "inv_due_1", "r_201", date(2026, 11, 19))   # 1 day late  -> step 1
    add_invoice(seeded, "inv_due_3", "r_202", date(2026, 11, 17))   # 3 days late -> step 1 (catch-up)
    add_invoice(seeded, "inv_due_5", "r_303", date(2026, 11, 15))   # 5 days late -> step 5
    add_invoice(seeded, "inv_due_12", "r_304", date(2026, 11, 8))   # 12 days late -> step 10
    for tenant, user in (("t_201", "U_201"), ("t_202", "U_202"), ("t_303", "U_303"), ("t_304", "U_304")):
        set_line(seeded, tenant, user)

    rows = {r["id"]: r["kind"] for r in dunning.due_for_reminder(seeded, "p_1", TODAY)}

    assert rows == {"inv_due_1": "reminder_1", "inv_due_3": "reminder_1",
                    "inv_due_5": "reminder_5", "inv_due_12": "reminder_10"}


def test_reminder_step_changes_at_days_five_and_ten(seeded):
    cases = [
        ("inv_due_4", "r_201", "t_201", 4, "reminder_1"),
        ("inv_due_5", "r_202", "t_202", 5, "reminder_5"),
        ("inv_due_9", "r_303", "t_303", 9, "reminder_5"),
        ("inv_due_10", "r_304", "t_304", 10, "reminder_10"),
    ]
    for invoice, room, tenant, late, _ in cases:
        add_invoice(seeded, invoice, room, TODAY - timedelta(days=late))
        set_line(seeded, tenant, f"U_{tenant}")

    rows = dunning.due_for_reminder(seeded, "p_1", TODAY)

    assert [(row["id"], row["kind"]) for row in rows] == [
        ("inv_due_4", "reminder_1"),
        ("inv_due_9", "reminder_5"),
        ("inv_due_5", "reminder_5"),
        ("inv_due_10", "reminder_10"),
    ]


def test_due_for_reminder_uses_one_select(seeded):
    add_invoice(seeded, "inv_one_select", "r_201", date(2026, 11, 19))
    set_line(seeded, "t_201", "U_201")
    calls = []

    def capture(_conn, _cursor, statement, _parameters, _context, executemany):
        # The set_config from attach_property is not part of the query under test. It runs at the
        # start of EVERY transaction on purpose (app/db.py: a per-connection setting is lost behind
        # Neon's PgBouncer pooler and RLS then returns no rows), so do not "fix" it back to once
        # per connection to make this count smaller.
        if statement.lstrip().lower().startswith("select") and "set_config" not in statement:
            calls.append((statement, executemany))

    event.listen(seeded, "before_cursor_execute", capture)
    try:
        assert [r["id"] for r in dunning.due_for_reminder(seeded, "p_1", TODAY)] == ["inv_one_select"]
    finally:
        event.remove(seeded, "before_cursor_execute", capture)

    assert len(calls) == 1
    assert calls[0][1] is False


def test_a_failed_push_does_not_count_as_sent(seeded):
    add_invoice(seeded, "inv_due_1", "r_201", date(2026, 11, 19))
    set_line(seeded, "t_201", "U_201")
    with seeded.begin() as conn:
        conn.execute(
            text("insert into message_log (invoice_id, kind, to_user_id, line_status) "
                 "values ('inv_due_1', 'reminder_1', 'U_201', 'error: HTTP 500')"),
        )

    assert [r["id"] for r in dunning.due_for_reminder(seeded, "p_1", TODAY)] == ["inv_due_1"]


def test_the_push_task_raises_so_the_queue_retries(seeded, monkeypatch):
    from app import tasks

    monkeypatch.setattr(tasks.line_push, "push_text", lambda to, body: "error: HTTP 500 down")
    monkeypatch.setattr(tasks, "get_engine", lambda: seeded)
    with pytest.raises(tasks.PushFailed):
        tasks.push_text(to_user_id="U_201", body="hi", invoice_id=None, kind="reminder_1")
    with seeded.connect() as conn:
        status = conn.execute(text("select line_status from message_log where to_user_id = 'U_201'")).scalar_one()
    assert status.startswith("error"), "the failed attempt is still logged"


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
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        conn.execute(text("insert into properties (id, name) values ('p_2', 'หออื่น')"))
    add_invoice(seeded, "inv_other", "r_201", date(2026, 11, 19))
    set_line(seeded, "t_201", "U_201")
    with seeded.begin() as conn:
        # Moving the room to p_2 also has to happen under p_2, or RLS rejects the new value.
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
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


def test_a_tenant_who_moved_out_is_not_reminded(seeded):
    # One LINE tenant per room: moved out yesterday, moved out today, moves out tomorrow.
    add_invoice(seeded, "inv_out_yesterday", "r_201", date(2026, 11, 19))
    set_line(seeded, "t_201", "U_201")
    set_moved_out(seeded, "t_201", TODAY - timedelta(days=1))

    add_invoice(seeded, "inv_out_today", "r_202", date(2026, 11, 19))
    set_line(seeded, "t_202", "U_202")
    set_moved_out(seeded, "t_202", TODAY)  # moved_out == today already counts as moved out

    add_invoice(seeded, "inv_out_tomorrow", "r_303", date(2026, 11, 19))
    set_line(seeded, "t_303", "U_303")
    set_moved_out(seeded, "t_303", TODAY + timedelta(days=1))  # still living there today

    ids = [r["id"] for r in dunning.due_for_reminder(seeded, "p_1", TODAY)]

    assert ids == ["inv_out_tomorrow"]


def test_the_latest_tenant_with_line_is_used(seeded):
    add_invoice(seeded, "inv_room_201", "r_201", date(2026, 11, 19))
    add_invoice(seeded, "inv_room_202", "r_202", date(2026, 11, 19))
    with seeded.begin() as conn:
        # r_201: two current tenants with LINE ids; the later move-in is the one reminded.
        conn.execute(text("update tenants set line_user_id = 'U_201_OLD', moved_in = date '2026-01-01' where id = 't_201'"))
        conn.execute(text("insert into tenants (id, room_id, name, line_user_id, moved_in) "
                          "values ('t_201_new', 'r_201', 'new tenant', 'U_201_NEW', date '2026-11-01')"))
        # r_202: the newer tenant has no LINE id, so the older tenant with LINE is reminded.
        conn.execute(text("update tenants set line_user_id = 'U_202_OLD', moved_in = date '2026-01-01' where id = 't_202'"))
        conn.execute(text("insert into tenants (id, room_id, name, line_user_id, moved_in) "
                          "values ('t_202_new', 'r_202', 'new tenant', null, date '2026-11-10')"))

    rows = {r["id"]: r["line_user_id"] for r in dunning.due_for_reminder(seeded, "p_1", TODAY)}

    assert rows == {"inv_room_201": "U_201_NEW", "inv_room_202": "U_202_OLD"}
