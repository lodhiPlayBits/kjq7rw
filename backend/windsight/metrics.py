"""Forecast error metrics. Error = forecast − actual, in MW.

MAPE is deliberately absent: at low wind the actual is near zero and percentage errors explode.
nMAE (MAE ÷ mean actual) is used for a relative figure instead.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Callable, Iterable


def error_metrics(errors: list[float], actuals: list[float]) -> dict | None:
    if len(errors) != len(actuals):
        raise ValueError("errors and actuals must have the same length")
    if not errors:
        return None
    abs_errors = [abs(e) for e in errors]
    if len(abs_errors) == 1:
        p50 = p90 = abs_errors[0]
    else:
        p50 = statistics.median(abs_errors)
        p90 = statistics.quantiles(abs_errors, n=10, method="inclusive")[8]
    mae = statistics.fmean(abs_errors)
    mean_actual = statistics.fmean(actuals)
    return {
        "n": len(errors),
        "mae": mae,
        "rmse": math.sqrt(statistics.fmean(e * e for e in errors)),
        "bias": statistics.fmean(errors),
        "p50": p50,
        "p90": p90,
        "nmae": mae / mean_actual if mean_actual else None,
    }


def grouped_metrics(rows: Iterable[dict], key: Callable[[dict], object]) -> list[dict]:
    """Metrics per group of rows with ``error`` and ``actual`` fields, ordered by group key."""
    groups: dict[object, list[dict]] = defaultdict(list)
    for row in rows:
        groups[key(row)].append(row)
    return [
        {"key": k, **error_metrics([r["error"] for r in rs], [r["actual"] for r in rs])}
        for k, rs in sorted(groups.items())
    ]
