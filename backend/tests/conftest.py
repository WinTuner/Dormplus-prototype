"""Tests that need Postgres read TEST_DATABASE_URL and are skipped without it.

The database at that URL is wiped: every test session migrates it down to nothing and back up.
"""
import os
from pathlib import Path

# app/session.py refuses the placeholder secret shipped in .env.example, so the suite needs one.
os.environ.setdefault("SESSION_SECRET", "test-secret")
# TestClient speaks http://testserver: a Secure cookie is never sent back over plain http.
os.environ.setdefault("COOKIE_SECURE", "false")

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from datetime import date

from app.auth import Session, current_session
from app.clock import today
from app.db import attach_property, get_engine
from app.main import create_app
from app.seed import seed

BACKEND = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

TABLES = ("auth_failures, line_events, link_codes, audit_log, message_log, payments, invoice_items, invoices, readings, "
          "tenants, rooms, properties")


def alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.attributes["database_url"] = url
    return cfg


@pytest.fixture(scope="session")
def engine():
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    cfg = alembic_config(TEST_DATABASE_URL)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    # The RLS policies read app.property_id; the app sets it on connect, so the tests do too.
    eng = attach_property(create_engine(TEST_DATABASE_URL), "p_1")
    yield eng
    eng.dispose()


@pytest.fixture
def seeded(engine):
    """A freshly seeded database for each test."""
    with engine.begin() as conn:
        conn.execute(text(f"truncate {TABLES} restart identity cascade"))
        seed(conn)
    return engine


@pytest.fixture
def client_for():
    """Build a TestClient on the given engine, optionally acting as `session` on the date `day`."""
    def build(eng, session: Session | None = None, day: date | None = None) -> TestClient:
        app = create_app()
        app.dependency_overrides[get_engine] = lambda: eng
        if session is not None:
            app.dependency_overrides[current_session] = lambda: session
        if day is not None:
            app.dependency_overrides[today] = lambda: day
        return TestClient(app)
    return build
