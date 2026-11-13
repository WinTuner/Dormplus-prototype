"""Rate limit for guessing codes: at most MAX_FAILURES failed attempts per account per hour.

Only failures are counted, in the auth_failures table (migration 0003), so a tenant who scans
a valid QR is never slowed down.
"""
from sqlalchemy import Engine, text

from app.errors import ApiError

MAX_FAILURES = 10

COUNT_SQL = text("""
    select count(*) from auth_failures
    where scope = :scope and actor = :actor and created_at > now() - interval '1 hour'
""")


def ensure_not_blocked(engine: Engine, scope: str, actor: str) -> None:
    with engine.connect() as conn:
        failures = conn.execute(COUNT_SQL, {"scope": scope, "actor": actor}).scalar_one()
    if failures >= MAX_FAILURES:
        raise ApiError(429, "TOO_MANY_ATTEMPTS", "ลองรหัสผิดหลายครั้งเกินไป — รอ 1 ชั่วโมงแล้วลองใหม่")


def record_failure(engine: Engine, scope: str, actor: str) -> None:
    # Its own transaction: the request that failed is rolled back, the failure must still count.
    with engine.begin() as conn:
        conn.execute(
            text("insert into auth_failures (scope, actor) values (:scope, :actor)"),
            {"scope": scope, "actor": actor},
        )
