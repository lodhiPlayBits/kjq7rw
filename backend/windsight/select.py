"""Pick the forecast a buyer could actually have seen at decision time.

Definitions (roadmap A3):
    T  target (delivery) hour
    h  requested horizon in hours
    D  decision time = T − h; only decisions made in January 2026 count
    chosen forecast = latest WINDFOR run with publish_time <= D (equality counts as available)
    L  realised lead = T − publish_time of the chosen run, so L >= h
"""

from __future__ import annotations

from bisect import bisect_right
from collections import defaultdict
from datetime import datetime, timedelta

from windsight.snapshot import JANUARY


class ForecastIndex:
    """Forecast runs per target hour, sorted by publish time, for O(log n) as-of lookups."""

    def __init__(self, forecasts: list[dict]):
        runs: dict[datetime, list[tuple[datetime, int]]] = defaultdict(list)
        for f in forecasts:
            runs[f["start_time"]].append((f["publish_time"], f["generation"]))
        self._publish: dict[datetime, list[datetime]] = {}
        self._value: dict[datetime, list[int]] = {}
        for target, items in runs.items():
            items.sort()
            self._publish[target] = [p for p, _ in items]
            self._value[target] = [v for _, v in items]

    def latest_at_or_before(self, target: datetime, cutoff: datetime) -> tuple[datetime, int] | None:
        publishes = self._publish.get(target)
        if not publishes:
            return None
        i = bisect_right(publishes, cutoff)
        if i == 0:
            return None
        return publishes[i - 1], self._value[target][i - 1]


def delivery_window(horizon_h: float) -> tuple[datetime, datetime]:
    """Delivery times whose decision time T − h falls in January."""
    shift = timedelta(hours=horizon_h)
    return JANUARY[0] + shift, JANUARY[1] + shift


def hours(td: timedelta) -> float:
    return td.total_seconds() / 3600


def select_series(
    index: ForecastIndex,
    actuals: list[dict],
    horizon_h: float,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[dict]:
    """One point per hourly actual in [start, end) whose decision time falls in January.

    Points with no forecast published early enough keep ``forecast``/``error`` as None.
    """
    if horizon_h < 0:
        raise ValueError("horizon must be >= 0")
    shift = timedelta(hours=horizon_h)
    points = []
    for a in actuals:
        target = a["start_time"]
        if target.minute or target.second:
            continue  # WINDFOR is hourly; half-hour actuals have nothing to compare with
        if start is not None and target < start or end is not None and target >= end:
            continue
        decision = target - shift
        if not JANUARY[0] <= decision < JANUARY[1]:
            continue
        found = index.latest_at_or_before(target, decision)
        published, forecast = found if found else (None, None)
        points.append(
            {
                "start_time": target,
                "actual": a["generation"],
                "forecast": forecast,
                "publish_time": published,
                "decision_time": decision,
                "lead_hours": hours(target - published) if published else None,
                "error": forecast - a["generation"] if forecast is not None else None,
            }
        )
    return points


def lead_points(forecasts: list[dict], actuals: list[dict], max_lead_hours: float = 48) -> list[dict]:
    """Every January-published run's error at its realised lead, for accuracy-by-lead analysis."""
    actual_by_time = {a["start_time"]: a["generation"] for a in actuals}
    out = []
    for f in forecasts:
        if not JANUARY[0] <= f["publish_time"] < JANUARY[1]:
            continue
        actual = actual_by_time.get(f["start_time"])
        if actual is None:
            continue
        lead = hours(f["start_time"] - f["publish_time"])
        if 0 <= lead < max_lead_hours:
            out.append(
                {
                    "start_time": f["start_time"],
                    "publish_time": f["publish_time"],
                    "lead_hours": lead,
                    "actual": actual,
                    "error": f["generation"] - actual,
                }
            )
    return out
