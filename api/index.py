"""Vercel serverless entry point. Only exposes the FastAPI app; all code lives in backend/."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from windsight.app import app  # noqa: E402

__all__ = ["app"]
