from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app import errors
from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError
from app.routes import auth, billing, cron, dunning, invites, me, properties, reports, rooms, webhooks

BACKEND_DIR = Path(__file__).resolve().parents[1]
LIFF_DIR = BACKEND_DIR / "liff"
OWNER_DIR = BACKEND_DIR / "owner"


def create_app() -> FastAPI:
    # The interactive docs and the OpenAPI schema list every route and field: handy on a laptop or a
    # preview deploy, a free map for anyone probing production. docs/API.md is the public reference.
    production = get_settings().is_production
    app = FastAPI(
        title="DormPlus API",
        version="0.1.0",
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    errors.install(app)
    app.include_router(auth.router)
    app.include_router(properties.router)
    app.include_router(rooms.router)
    app.include_router(billing.router)
    app.include_router(me.router)
    app.include_router(dunning.router)
    app.include_router(cron.router)
    app.include_router(invites.router)
    app.include_router(reports.router)
    app.include_router(webhooks.router)

    @app.get("/healthz", tags=["ops"])
    def healthz(engine: Engine = Depends(get_engine)) -> dict:
        """Liveness + database check, for Railway / Cloud Run health probes."""
        try:
            with engine.connect() as conn:
                conn.execute(text("select 1"))
        except SQLAlchemyError:
            raise ApiError(503, "DB_UNAVAILABLE", "ต่อฐานข้อมูลไม่ได้")
        return {"status": "ok"}

    @app.get("/v1/liff-config", tags=["ops"])
    def liff_config() -> dict:
        """What the LIFF page needs before it can call liff.init(). Public on purpose."""
        settings = get_settings()
        return {"liff_id": settings.liff_id}

    if LIFF_DIR.is_dir():
        app.mount("/liff", StaticFiles(directory=str(LIFF_DIR), html=True), name="liff")
    # Owner UI: one static page, cookie-authenticated with POST /v1/auth/owner.
    if OWNER_DIR.is_dir():
        app.mount("/owner", StaticFiles(directory=str(OWNER_DIR), html=True), name="owner")

    return app


app = create_app()
