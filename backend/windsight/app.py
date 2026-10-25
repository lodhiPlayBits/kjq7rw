"""WindSight HTTP API.

The January snapshot is loaded once at import, so every request is served from memory.
All routes live under /api so the same app works behind Vercel's rewrite and locally.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query

from windsight.metrics import error_metrics, grouped_metrics
from windsight.select import ForecastIndex, delivery_window, lead_points, select_series
from windsight.snapshot import (
    ACTUAL_FILE,
    FORECAST_FILE,
    JANUARY,
    format_time,
    read_csv_gz,
)

# UK local time. The whole window (1 Jan – 3 Feb) is GMT, so it equals UTC (roadmap A5). This avoids
# zoneinfo, which needs the extra tzdata package on Windows. Revisit if the window ever crosses BST.
UK = timezone.utc
DEFAULT_HORIZON_H = 24
LEAD_BUCKET_H = 4
MAX_LEAD_H = 48
# Fail loudly rather than mislabel hours if the window is ever moved into British Summer Time.
assert JANUARY[1] + timedelta(hours=MAX_LEAD_H) < datetime(2026, 3, 29, 1, tzinfo=timezone.utc)

FORECASTS = read_csv_gz(FORECAST_FILE)
ACTUALS = read_csv_gz(ACTUAL_FILE)
INDEX = ForecastIndex(FORECASTS)
LEAD_ROWS = lead_points(FORECASTS, ACTUALS, MAX_LEAD_H)


def covered_horizon(index: ForecastIndex, actuals: list[dict], limit: int = MAX_LEAD_H) -> int:
    """Largest h such that every horizon 0..h gives a forecast for every delivery hour in its window."""
    best = -1
    for h in range(limit + 1):
        if not all(p["forecast"] is not None for p in select_series(index, actuals, h)):
            break
        best = h
    return best


HMAX = covered_horizon(INDEX, ACTUALS)  # 43 h for this snapshot

app = FastAPI(
    title="WindSight API",
    version="0.2.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

Horizon = Annotated[int, Query(ge=0, le=HMAX, description="Requested horizon h in hours: forecast published at least h before delivery")]


@lru_cache(maxsize=None)
def series_for(horizon_h: int) -> list[dict]:
    return select_series(INDEX, ACTUALS, horizon_h)


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def rounded(m: dict | None) -> dict | None:
    if m is None:
        return None
    return {k: (round(v, 4) if k == "nmae" else round(v, 1)) if isinstance(v, float) else v for k, v in m.items()}


def point_json(p: dict) -> dict:
    return {
        **p,
        "start_time": format_time(p["start_time"]),
        "decision_time": format_time(p["decision_time"]),
        "publish_time": format_time(p["publish_time"]) if p["publish_time"] else None,
    }


def summary(points: list[dict]) -> dict | None:
    matched = [p for p in points if p["error"] is not None]
    return rounded(error_metrics([p["error"] for p in matched], [p["actual"] for p in matched]))


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "actuals": len(ACTUALS), "forecasts": len(FORECASTS)}


@app.get("/api/meta")
def meta() -> dict:
    """Limits the UI needs: horizon range, default and the January decision window."""
    return {
        "hmax": HMAX,
        "default_horizon_h": DEFAULT_HORIZON_H,
        "lead_bucket_hours": LEAD_BUCKET_H,
        "max_lead_hours": MAX_LEAD_H,
        "decision_window": [format_time(JANUARY[0]), format_time(JANUARY[1])],
    }


@app.get("/api/series")
def series(
    horizon_h: Horizon = DEFAULT_HORIZON_H,
    start: Annotated[datetime | None, Query(alias="from", description="Delivery range start (UTC), inclusive")] = None,
    end: Annotated[datetime | None, Query(alias="to", description="Delivery range end (UTC), exclusive")] = None,
) -> dict:
    """Forecast vs actual for deliveries whose decision time T − h falls in January."""
    lo, hi = delivery_window(horizon_h)
    start, end = max(as_utc(start) or lo, lo), min(as_utc(end) or hi, hi)
    if start >= end:
        raise HTTPException(422, f"empty range: deliveries for h={horizon_h} run {format_time(lo)} to {format_time(hi)}")
    points = [p for p in series_for(horizon_h) if start <= p["start_time"] < end]
    actual = [
        {"start_time": format_time(a["start_time"]), "generation": a["generation"]}
        for a in ACTUALS
        if start <= a["start_time"] < end
    ]
    return {
        "horizon_h": horizon_h,
        "window": [format_time(start), format_time(end)],
        "actual": actual,
        "points": [point_json(p) for p in points],
        "summary": summary(points),
    }


def lead_label(bucket: int) -> str:
    return f"{bucket * LEAD_BUCKET_H}–{(bucket + 1) * LEAD_BUCKET_H} h"


@app.get("/api/metrics")
def metrics(
    by: Literal["lead", "hour", "day"],
    horizon_h: Annotated[int | None, Query(ge=0, le=HMAX, description="Horizon for by=hour/day (default 24)")] = None,
) -> dict:
    """Error metrics grouped by realised lead time (all January runs), or by UK hour/day at horizon h.

    ``horizon_h`` is ignored for ``by=lead`` and defaults to 24 otherwise. Each group's ``key`` is the
    sort key (lead bucket index, hour 0–23, or ISO date); clients should display ``label``.
    """
    if by != "lead" and horizon_h is None:
        horizon_h = DEFAULT_HORIZON_H
    if by == "lead":
        rows = LEAD_ROWS
        groups = grouped_metrics(rows, key=lambda r: int(r["lead_hours"] // LEAD_BUCKET_H))
        labels = {g["key"]: lead_label(g["key"]) for g in groups}
    else:
        rows = [p for p in series_for(horizon_h) if p["error"] is not None]
        if by == "hour":
            groups = grouped_metrics(rows, key=lambda r: r["start_time"].astimezone(UK).hour)
            labels = {g["key"]: f"{g['key']:02d}:00" for g in groups}
        else:
            groups = grouped_metrics(rows, key=lambda r: r["start_time"].astimezone(UK).date().isoformat())
            labels = {g["key"]: g["key"] for g in groups}
    return {
        "by": by,
        "horizon_h": None if by == "lead" else horizon_h,
        "groups": [{**rounded(g), "label": labels[g["key"]]} for g in groups],
        "overall": rounded(error_metrics([r["error"] for r in rows], [r["actual"] for r in rows])),
    }
