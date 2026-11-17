"""attach_property: the dorm setting must be set per transaction, not per connection.

Behind PgBouncer's transaction pooling two transactions of one client can run on different server
connections, so only a setting made inside each transaction is dependable.
"""
from sqlalchemy import text

SHOW = text("select current_setting('app.property_id', true)")


def test_every_transaction_sees_the_dorm(seeded):
    # engine.connect() (autobegin, used by the read routes) twice in a row, then engine.begin().
    for _ in range(2):
        with seeded.connect() as conn:
            assert conn.execute(SHOW).scalar_one() == "p_1"
    with seeded.begin() as conn:
        assert conn.execute(SHOW).scalar_one() == "p_1"


def test_a_second_transaction_on_the_same_connection_still_has_it(seeded):
    with seeded.connect() as conn:
        assert conn.execute(SHOW).scalar_one() == "p_1"
        conn.commit()
        # A new transaction on the very same connection gets the setting again.
        assert conn.execute(SHOW).scalar_one() == "p_1"


def test_the_setting_does_not_outlive_the_transaction(seeded):
    with seeded.connect() as conn:
        assert conn.execute(SHOW).scalar_one() == "p_1"
    # Outside any engine transaction, on a raw DBAPI connection, nothing is left behind.
    raw = seeded.raw_connection()
    try:
        with raw.cursor() as cursor:
            cursor.execute("select current_setting('app.property_id', true)")
            assert not cursor.fetchone()[0]
    finally:
        raw.rollback()
        raw.close()


def test_rls_filtered_reads_still_work(seeded):
    with seeded.connect() as conn:
        assert conn.execute(text("select count(*) from rooms")).scalar_one() == 42
