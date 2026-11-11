"""Tests that need Postgres read TEST_DATABASE_URL and are skipped without it.

The database at that URL is wiped: every test session migrates it down to nothing and back up.
"""
import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.db import get_engine
from app.main import create_app
from app.seed import seed

BACKEND = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

TABLES = "audit_log, message_log, payments, invoice_items, invoices, readings, tenants, rooms, properties"


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
    eng = create_engine(TEST_DATABASE_URL)
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
    """Build a TestClient whose routes use the given engine."""
    def build(eng) -> TestClient:
        app = create_app()
        app.dependency_overrides[get_engine] = lambda: eng
        return TestClient(app)
    return build
