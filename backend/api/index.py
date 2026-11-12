"""Vercel entrypoint: exposes the FastAPI ASGI app as `app`.

The project root is backend/, so the package next to this file is `app`.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402  (path must be set first)

__all__ = ["app"]
