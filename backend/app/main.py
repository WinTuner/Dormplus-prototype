from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app import errors
from app.config import get_settings
from app.db import get_engine
from app.errors import ApiError
from app.routes import auth, billing, me, rooms

BACKEND_DIR = Path(__file__).resolve().parents[1]
LIFF_DIR = BACKEND_DIR / "liff"


def create_app() -> FastAPI:
    app = FastAPI(title="DormPlus API", version="0.1.0")
    errors.install(app)
    app.include_router(auth.router)
    app.include_router(rooms.router)
    app.include_router(billing.router)
    app.include_router(me.router)

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

    return app


app = create_app()
