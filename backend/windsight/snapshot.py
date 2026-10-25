"""Download Elexon BMRS wind data for January 2026 decisions into local snapshots.

The deployed app only reads the snapshot files in ``data/``; it never calls Elexon.

Usage:
    PYTHONPATH=backend python -m windsight.snapshot --fetch     # download and write data/*.csv.gz
    PYTHONPATH=backend python -m windsight.snapshot --summary   # describe the existing snapshot
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import statistics
import sys
import time
import urllib.request
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

UTC = timezone.utc
BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"

# Decisions D = T - h fall in January 2026, with h up to 48 h (roadmap A3/A4).
FORECAST_PUBLISH_FROM = datetime(2025, 12, 30, tzinfo=UTC)
FORECAST_PUBLISH_TO = datetime(2026, 2, 1, tzinfo=UTC)  # exclusive
ACTUAL_FROM = datetime(2026, 1, 1, tzinfo=UTC)
ACTUAL_TO = datetime(2026, 2, 3, tzinfo=UTC)  # exclusive: 1 Feb + 48 h
JANUARY = (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC))
# Targets that every horizon up to Hmax must cover (decisions in January, h >= 24 h).
CORE_TARGETS = (datetime(2026, 1, 2, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC))
CHUNK = timedelta(days=7)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
FORECAST_FILE = DATA_DIR / "windfor_jan2026.csv.gz"
ACTUAL_FILE = DATA_DIR / "fuelhh_wind_jan2026.csv.gz"
FORECAST_FIELDS = ["start_time", "publish_time", "generation"]
ACTUAL_FIELDS = ["start_time", "publish_time", "generation"]


def parse_time(value: str) -> datetime:
    """Parse an ISO-8601 timestamp (``Z`` or offset) into an aware UTC datetime."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError(f"timestamp without timezone: {value!r}")
    return dt.astimezone(UTC)


def format_time(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def chunks(start: datetime, end: datetime, step: timedelta = CHUNK) -> list[tuple[datetime, datetime]]:
    """Split [start, end) into consecutive half-open windows of at most ``step``."""
    out = []
    cursor = start
    while cursor < end:
        nxt = min(cursor + step, end)
        out.append((cursor, nxt))
        cursor = nxt
    return out


def windfor_url(start: datetime, end: datetime) -> str:
    return (
        f"{BASE_URL}/WINDFOR/stream"
        f"?publishDateTimeFrom={format_time(start)}&publishDateTimeTo={format_time(end)}"
    )


def fuelhh_url(start: datetime, end: datetime) -> str:
    # Settlement dates are inclusive on both ends; GMT all window, so dates match UTC.
    if start.time() != datetime.min.time() or end.time() != datetime.min.time():
        raise ValueError("FUELHH chunks must start and end at midnight UTC")
    last_day = (end - timedelta(days=1)).date()
    return (
        f"{BASE_URL}/FUELHH/stream"
        f"?settlementDateFrom={start.date()}&settlementDateTo={last_day}&fuelType=WIND"
    )


def fetch_json(url: str, timeout: float = 60, retries: int = 1) -> list[dict]:
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return json.load(resp)
        except OSError:
            if attempt == retries:
                raise
            time.sleep(2)
    raise AssertionError("unreachable")


def parse_windfor(rows: list[dict], start: datetime, end: datetime) -> list[dict]:
    """Keep forecasts published in [start, end); drop duplicates from overlapping chunks."""
    seen: dict[tuple[datetime, datetime], dict] = {}
    for row in rows:
        published = parse_time(row["publishTime"])
        if not start <= published < end or row.get("generation") is None:
            continue
        target = parse_time(row["startTime"])
        generation = int(row["generation"])
        existing = seen.get((target, published))
        if existing is not None and existing["generation"] != generation:
            raise ValueError(
                f"conflicting WINDFOR values for start {format_time(target)} published {format_time(published)}"
            )
        seen[(target, published)] = {"start_time": target, "publish_time": published, "generation": generation}
    return [seen[key] for key in sorted(seen)]


def parse_fuelhh(rows: list[dict], start: datetime, end: datetime) -> list[dict]:
    """Keep WIND actuals with startTime in [start, end); for revisions keep the latest publish."""
    latest: dict[datetime, dict] = {}
    for row in rows:
        if row.get("fuelType") != "WIND" or row.get("generation") is None:
            continue
        target = parse_time(row["startTime"])
        if not start <= target < end:
            continue
        published = parse_time(row["publishTime"])
        current = latest.get(target)
        if current is None or published > current["publish_time"]:
            latest[target] = {
                "start_time": target,
                "publish_time": published,
                "generation": int(row["generation"]),
            }
    return [latest[key] for key in sorted(latest)]


def write_csv_gz(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # No embedded name or mtime, so identical data gives identical bytes whatever the path.
    with open(path, "wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as gz:
        with io.TextIOWrapper(gz, encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
            writer.writeheader()
            for row in rows:
                writer.writerow({k: format_time(v) if isinstance(v, datetime) else v for k, v in row.items()})


def read_csv_gz(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
        return [
            {
                "start_time": parse_time(r["start_time"]),
                "publish_time": parse_time(r["publish_time"]),
                "generation": int(r["generation"]),
            }
            for r in csv.DictReader(fh)
        ]


def full_coverage_horizon(forecasts: list[dict], targets: list[datetime]) -> float:
    """Largest h (hours) for which every target has a forecast published at least h before it."""
    earliest: dict[datetime, datetime] = {}
    for f in forecasts:
        t, p = f["start_time"], f["publish_time"]
        if p <= t and (t not in earliest or p < earliest[t]):
            earliest[t] = p
    leads = [(t - earliest[t]).total_seconds() / 3600 for t in targets if t in earliest]
    if len(leads) < len(targets):
        return 0.0
    return min(leads)


def hourly(start: datetime, end: datetime) -> list[datetime]:
    return [start + timedelta(hours=i) for i in range(int((end - start).total_seconds() // 3600))]


def validate(forecasts: list[dict], actuals: list[dict]) -> None:
    """Refuse to write a snapshot with gaps, so a truncated download never replaces good files."""
    expected = int((ACTUAL_TO - ACTUAL_FROM).total_seconds() // 1800)
    if len(actuals) != expected:
        raise ValueError(f"expected {expected} FUELHH half-hours, got {len(actuals)}")
    have = {f["start_time"] for f in forecasts}
    missing = [t for t in hourly(*CORE_TARGETS) if t not in have]
    if missing:
        raise ValueError(f"{len(missing)} hourly targets have no forecast, first {format_time(missing[0])}")


def summarize(forecasts: list[dict], actuals: list[dict]) -> dict:
    by_target: dict[datetime, list[datetime]] = defaultdict(list)
    for f in forecasts:
        by_target[f["start_time"]].append(f["publish_time"])
    publish_times = sorted({f["publish_time"] for f in forecasts})
    targets = sorted(by_target)
    leads = [
        (f["start_time"] - f["publish_time"]).total_seconds() / 3600
        for f in forecasts
        if f["publish_time"] <= f["start_time"]
    ]
    steps = Counter(int((b - a).total_seconds() // 60) for a, b in zip(targets, targets[1:]))

    # A7: compare January means on shared timestamps, using the freshest forecast at or before delivery.
    value = {(f["start_time"], f["publish_time"]): f["generation"] for f in forecasts}
    actual_by_time = {a["start_time"]: a["generation"] for a in actuals}
    paired = []
    for t in targets:
        if t not in actual_by_time or not JANUARY[0] <= t < JANUARY[1]:
            continue
        pubs = sorted(by_target[t])
        i = bisect_right(pubs, t)
        if i:
            paired.append((value[(t, pubs[i - 1])], actual_by_time[t]))

    return {
        "forecast_rows": len(forecasts),
        "forecast_publishes": len(publish_times),
        "publish_range": [format_time(publish_times[0]), format_time(publish_times[-1])] if publish_times else None,
        "forecast_target_range": [format_time(targets[0]), format_time(targets[-1])] if targets else None,
        "forecast_step_minutes": dict(steps),
        "publishes_per_target": {
            "min": min(map(len, by_target.values()), default=0),
            "median": statistics.median(map(len, by_target.values())) if by_target else 0,
            "max": max(map(len, by_target.values()), default=0),
        },
        "publish_times_of_day": dict(sorted(Counter(p.strftime("%H:%M") for p in publish_times).items())),
        "max_lead_hours": max(leads, default=0.0),
        "full_coverage_horizon_hours": full_coverage_horizon(forecasts, hourly(*CORE_TARGETS)),
        "actual_rows": len(actuals),
        "actual_range": [format_time(actuals[0]["start_time"]), format_time(actuals[-1]["start_time"])] if actuals else None,
        "paired_points": len(paired),
        "mean_forecast_mw": round(statistics.mean(p[0] for p in paired)) if paired else None,
        "mean_actual_mw": round(statistics.mean(p[1] for p in paired)) if paired else None,
    }


def fetch_all() -> tuple[list[dict], list[dict]]:
    raw_forecasts: list[dict] = []
    for a, b in chunks(FORECAST_PUBLISH_FROM, FORECAST_PUBLISH_TO):
        print(f"WINDFOR {format_time(a)} .. {format_time(b)}", file=sys.stderr)
        raw_forecasts += fetch_json(windfor_url(a, b))
    raw_actuals: list[dict] = []
    for a, b in chunks(ACTUAL_FROM, ACTUAL_TO):
        print(f"FUELHH  {a.date()} .. {(b - timedelta(days=1)).date()}", file=sys.stderr)
        raw_actuals += fetch_json(fuelhh_url(a, b))
    return (
        parse_windfor(raw_forecasts, FORECAST_PUBLISH_FROM, FORECAST_PUBLISH_TO),
        parse_fuelhh(raw_actuals, ACTUAL_FROM, ACTUAL_TO),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--fetch", action="store_true", help="download from Elexon and write data/*.csv.gz")
    group.add_argument("--summary", action="store_true", help="describe the existing snapshot")
    args = parser.parse_args(argv)

    if args.fetch:
        forecasts, actuals = fetch_all()
        validate(forecasts, actuals)
        # Write both to temp files first so a failure never leaves a mismatched pair.
        pending = [(FORECAST_FILE, forecasts, FORECAST_FIELDS), (ACTUAL_FILE, actuals, ACTUAL_FIELDS)]
        for path, rows, fields in pending:
            write_csv_gz(path.with_suffix(".tmp"), rows, fields)
        for path, _, _ in pending:
            os.replace(path.with_suffix(".tmp"), path)
    else:
        forecasts, actuals = read_csv_gz(FORECAST_FILE), read_csv_gz(ACTUAL_FILE)
    print(json.dumps(summarize(forecasts, actuals), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
