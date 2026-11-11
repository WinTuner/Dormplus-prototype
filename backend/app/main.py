from fastapi import Depends, FastAPI
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app import errors
from app.db import get_engine
from app.errors import ApiError
from app.routes import rooms


def create_app() -> FastAPI:
    app = FastAPI(title="DomPlus API", version="0.1.0")
    errors.install(app)
    app.include_router(rooms.router)

    @app.get("/healthz", tags=["ops"])
    def healthz(engine: Engine = Depends(get_engine)) -> dict:
        """Liveness + database check, for Railway / Cloud Run health probes."""
        try:
            with engine.connect() as conn:
                conn.execute(text("select 1"))
        except SQLAlchemyError:
            raise ApiError(503, "DB_UNAVAILABLE", "ต่อฐานข้อมูลไม่ได้")
        return {"status": "ok"}

    return app


app = create_app()
