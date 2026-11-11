"""Database rules from docs/HANDOFF.md section 3, checked against the real schema."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.seed import seed


def count(conn, sql: str, **params) -> int:
    return conn.execute(text(sql), params).scalar_one()


def test_seed_creates_the_demo_dorm(seeded):
    with seeded.connect() as conn:
        assert count(conn, "select count(*) from rooms where property_id = 'p_1'") == 42
        assert count(conn, "select count(*) from tenants") == 42
        assert count(conn, "select count(*) from readings where period = '2026-10'") == 42
        assert count(conn, "select count(*) from readings where period = '2026-11'") == 12
        # 1 + 3 + 2 + 1 + 2 overdue periods across rooms 203, 305, 312, 407, 502
        assert count(conn, "select count(*) from invoices where status = 'unpaid'") == 9
        assert count(conn, "select count(*) from invoice_items") == 27


def test_seed_matches_prototype_numbers(seeded):
    with seeded.connect() as conn:
        row = conn.execute(text(
            "select water_prev, water_now, elec_prev, elec_now from readings "
            "where room_id = 'r_201' and period = '2026-11'"
        )).one()
        assert tuple(row) == (113, 118, 541, 572)
        total = count(conn, "select total from invoices where id = 'inv_203_2026-10'")
        assert total == 3220 + 4 * 25 + 30 * 7


def test_seed_twice_changes_nothing(seeded):
    tables = ["rooms", "tenants", "readings", "invoices", "invoice_items"]
    with seeded.connect() as conn:
        before = {t: count(conn, f"select count(*) from {t}") for t in tables}
    with seeded.begin() as conn:
        seed(conn)
    with seeded.connect() as conn:
        after = {t: count(conn, f"select count(*) from {t}") for t in tables}
    assert after == before


def test_database_blocks_a_second_bill_for_the_same_room_and_period(seeded):
    insert = text(
        "insert into invoices (id, room_id, period, rent, total, due_date) "
        "values (:id, 'r_201', '2026-11', 3220, 3562, date '2026-11-09')"
    )
    with seeded.begin() as conn:
        conn.execute(insert, {"id": "inv_a"})
    with pytest.raises(IntegrityError, match="invoices_room_id_period_key"):
        with seeded.begin() as conn:
            conn.execute(insert, {"id": "inv_b"})


def test_invoice_status_is_limited_to_the_state_machine(seeded):
    with pytest.raises(IntegrityError, match="invoices_status_check"):
        with seeded.begin() as conn:
            conn.execute(text(
                "insert into invoices (id, room_id, period, rent, total, due_date, status) "
                "values ('inv_x', 'r_201', '2026-11', 3220, 3220, date '2026-11-09', 'refunded')"
            ))
