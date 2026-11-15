"""RLS (migration 0004): a connection sees one dorm, whatever the query says.

These talk to Postgres directly rather than through the API on purpose: the point of the policies is
that a route which forgets `where property_id = ...` still cannot read another dorm.

CI connects as `postgres`, which is a superuser and therefore bypasses RLS no matter what. The
checks below switch to a plain role (`set local role`) so they exercise the policies the way the
deployed application user does.
"""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.usefixtures("seeded")

PROBE = "rls_probe"


@pytest.fixture(scope="module")
def probe(engine):
    """A role that is neither the owner nor a superuser, so policies apply to it."""
    with engine.begin() as conn:
        # A role that already holds grants cannot be dropped ("privileges for schema public"), and
        # this suite is re-run against the same database on a developer machine, not only on a
        # throwaway CI service. Revoke before dropping so the second run starts clean.
        conn.execute(text(f"""do $$ begin
            if exists (select 1 from pg_roles where rolname = '{PROBE}') then
                execute 'revoke all on schema public from {PROBE}';
                execute 'revoke all on all tables in schema public from {PROBE}';
                execute 'drop role {PROBE}';
            end if;
        end $$"""))
        conn.execute(text(f"create role {PROBE} nologin"))
        conn.execute(text(f"grant usage on schema public to {PROBE}"))
        conn.execute(text(f"grant select, insert, update, delete on all tables in schema public to {PROBE}"))
    return PROBE


def as_probe(conn, property_id: str) -> None:
    """Run the rest of this transaction as the probe role with the given dorm."""
    conn.execute(text(f"set local role {PROBE}"))
    conn.execute(text("select set_config('app.property_id', :pid, true)"), {"pid": property_id})


def count(conn, table: str = "rooms") -> int:
    return conn.execute(text(f"select count(*) from {table}")).scalar_one()


def test_the_connection_is_pinned_to_p_1(seeded, probe):
    with seeded.begin() as conn:
        as_probe(conn, "p_1")
        assert count(conn) > 0


def test_switching_the_setting_hides_every_row(seeded, probe):
    with seeded.begin() as conn:
        as_probe(conn, "p_2")
        assert count(conn) == 0, "no room belongs to p_2, and the policy filters by the setting"
        assert count(conn, "invoices") == 0
        conn.execute(text("select set_config('app.property_id', 'p_1', true)"))
        assert count(conn) > 0


def test_without_the_setting_nothing_is_visible(seeded, probe):
    """A connection that never set it must fail closed, not open."""
    with seeded.begin() as conn:
        conn.execute(text(f"set local role {PROBE}"))
        conn.execute(text("select set_config('app.property_id', null, true)"))
        assert count(conn) == 0


def test_writing_a_row_of_another_dorm_is_refused(seeded, probe):
    with pytest.raises(DBAPIError):
        with seeded.begin() as conn:
            as_probe(conn, "p_1")
            conn.execute(text("insert into rooms (id, property_id, room_no, rent) "
                              "values ('r_rls', 'p_2', '999', 1000)"))


def test_child_tables_follow_their_room(seeded, probe):
    """invoices/payments/tenants have no property_id column; the policy walks up to rooms."""
    with seeded.begin() as conn:
        as_probe(conn, "p_1")
        assert count(conn, "invoices") > 0
        conn.execute(text("select set_config('app.property_id', 'p_2', true)"))
        assert count(conn, "invoices") == 0
        assert count(conn, "tenants") == 0
        assert count(conn, "payments") == 0
