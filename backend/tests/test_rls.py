"""RLS (migration 0004): a connection sees one dorm, whatever the query says.

These talk to Postgres directly rather than through the API on purpose: the point of the policies is
that a route which forgets `where property_id = ...` still cannot read another dorm.
"""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.usefixtures("seeded")


def count(conn) -> int:
    return conn.execute(text("select count(*) from rooms")).scalar_one()


def test_the_connection_is_pinned_to_p_1(seeded):
    with seeded.connect() as conn:
        assert count(conn) > 0


def test_switching_the_setting_hides_every_row(seeded):
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        assert count(conn) == 0, "no room belongs to p_2, and the policy filters by the setting"
        assert conn.execute(text("select count(*) from invoices")).scalar_one() == 0
        # Back to p_1 for the rest of the transaction.
        conn.execute(text("select set_config('app.property_id', 'p_1', true)"))
        assert count(conn) > 0


def test_without_the_setting_nothing_is_visible(seeded):
    """A connection that never set it must fail closed, not open."""
    with seeded.begin() as conn:
        conn.execute(text("select set_config('app.property_id', null, true)"))
        assert count(conn) == 0


def test_writing_a_row_of_another_dorm_is_refused(seeded):
    with pytest.raises(DBAPIError):
        with seeded.begin() as conn:
            conn.execute(text("insert into rooms (id, property_id, room_no, rent) "
                              "values ('r_rls', 'p_2', '999', 1000)"))


def test_child_tables_follow_their_room(seeded):
    """invoices/payments/tenants have no property_id column; the policy walks up to rooms."""
    with seeded.begin() as conn:
        before = conn.execute(text("select count(*) from invoices")).scalar_one()
        assert before > 0
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        assert conn.execute(text("select count(*) from invoices")).scalar_one() == 0
        assert conn.execute(text("select count(*) from tenants")).scalar_one() == 0
        assert conn.execute(text("select count(*) from payments")).scalar_one() == 0
