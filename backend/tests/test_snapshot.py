import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from windsight import snapshot

UTC = timezone.utc
FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIXTURES / name).read_text())


def t(s):
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def test_parse_time_accepts_z_and_offsets_and_converts_to_utc():
    assert snapshot.parse_time("2026-01-10T00:30:00Z") == t("2026-01-10T00:30:00")
    assert snapshot.parse_time("2026-01-10T00:30:00+00:00") == t("2026-01-10T00:30:00")
    assert snapshot.parse_time("2026-01-10T01:30:00+01:00") == t("2026-01-10T00:30:00")


def test_parse_time_rejects_naive_timestamps():
    with pytest.raises(ValueError):
        snapshot.parse_time("2026-01-10T00:30:00")


def test_parse_fuelhh_keeps_wind_in_window_and_latest_revision():
    rows = snapshot.parse_fuelhh(load("fuelhh_sample.json"), t("2026-01-01T00:00:00"), t("2026-02-03T00:00:00"))

    assert [r["start_time"] for r in rows] == [
        t("2026-01-10T00:00:00"),
        t("2026-01-10T00:30:00"),
        t("2026-01-10T01:00:00"),
    ]
    # 00:30 was revised: the 01:05 publish (9075) wins over 01:00 (9050); the CCGT row is ignored.
    assert rows[1]["generation"] == 9075
    assert rows[1]["publish_time"] == t("2026-01-10T01:05:00")


def test_parse_windfor_filters_publish_window_dedupes_and_sorts():
    rows = snapshot.parse_windfor(load("windfor_sample.json"), t("2025-12-30T00:00:00"), t("2026-02-01T00:00:00"))

    # The 2025-12-29 publish is outside the window; the repeated 22:30/01:00 row appears once.
    assert len(rows) == 4
    assert [(r["start_time"], r["publish_time"]) for r in rows] == sorted(
        (r["start_time"], r["publish_time"]) for r in rows
    )
    assert rows[0] == {
        "start_time": t("2026-01-10T00:00:00"),
        "publish_time": t("2026-01-09T22:30:00"),
        "generation": 12100,
    }


def test_chunks_cover_range_without_gaps():
    start, end = t("2025-12-30T00:00:00"), t("2026-02-01T00:00:00")
    parts = snapshot.chunks(start, end, timedelta(days=7))

    assert parts[0][0] == start and parts[-1][1] == end
    assert all(a[1] == b[0] for a, b in zip(parts, parts[1:]))
    assert all(b - a <= timedelta(days=7) for a, b in parts)


def test_fuelhh_url_uses_inclusive_last_settlement_date():
    url = snapshot.fuelhh_url(t("2026-01-01T00:00:00"), t("2026-01-08T00:00:00"))
    assert "settlementDateFrom=2026-01-01" in url
    assert "settlementDateTo=2026-01-07" in url
    assert "fuelType=WIND" in url


def test_csv_round_trip(tmp_path):
    rows = snapshot.parse_windfor(load("windfor_sample.json"), t("2025-12-30T00:00:00"), t("2026-02-01T00:00:00"))
    path = tmp_path / "f.csv.gz"
    snapshot.write_csv_gz(path, rows, snapshot.FORECAST_FIELDS)

    assert snapshot.read_csv_gz(path) == rows


def test_full_coverage_horizon_is_the_smallest_earliest_lead():
    forecasts = [
        {"start_time": t("2026-01-10T00:00:00"), "publish_time": t("2026-01-08T00:00:00"), "generation": 1},
        {"start_time": t("2026-01-10T00:00:00"), "publish_time": t("2026-01-09T12:00:00"), "generation": 1},
        {"start_time": t("2026-01-10T01:00:00"), "publish_time": t("2026-01-09T01:00:00"), "generation": 1},
        # Published after delivery: never counts as a forecast.
        {"start_time": t("2026-01-10T01:00:00"), "publish_time": t("2026-01-10T02:00:00"), "generation": 1},
    ]
    targets = [t("2026-01-10T00:00:00"), t("2026-01-10T01:00:00")]

    assert snapshot.full_coverage_horizon(forecasts, targets) == 24.0


def test_full_coverage_horizon_is_zero_when_a_target_has_no_forecast():
    forecasts = [{"start_time": t("2026-01-10T00:00:00"), "publish_time": t("2026-01-09T00:00:00"), "generation": 1}]
    assert snapshot.full_coverage_horizon(forecasts, [t("2026-01-10T00:00:00"), t("2026-01-10T01:00:00")]) == 0.0


def test_summarize_pairs_freshest_forecast_with_actual():
    forecasts = snapshot.parse_windfor(load("windfor_sample.json"), t("2025-12-30T00:00:00"), t("2026-02-01T00:00:00"))
    actuals = snapshot.parse_fuelhh(load("fuelhh_sample.json"), t("2026-01-01T00:00:00"), t("2026-02-03T00:00:00"))
    s = snapshot.summarize(forecasts, actuals)

    assert s["forecast_publishes"] == 2
    assert s["publishes_per_target"] == {"min": 2, "median": 2, "max": 2}
    assert s["forecast_step_minutes"] == {60: 1}
    # 00:00 has no publish at or before delivery from 02:30, so the 22:30 forecast (12100) is used;
    # 01:00 likewise uses 22:30 (11800).
    assert s["paired_points"] == 2
    assert s["mean_forecast_mw"] == round((12100 + 11800) / 2)
    assert s["mean_actual_mw"] == round((9120 + 8990) / 2)


def test_parse_windfor_keeps_publish_at_start_and_drops_publish_at_end():
    rows = [
        {"publishTime": "2026-01-01T00:00:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": 1},
        {"publishTime": "2026-02-01T00:00:00Z", "startTime": "2026-02-02T00:00:00Z", "generation": 2},
    ]
    kept = snapshot.parse_windfor(rows, t("2026-01-01T00:00:00"), t("2026-02-01T00:00:00"))
    assert [r["generation"] for r in kept] == [1]


def test_parse_windfor_rejects_conflicting_duplicates():
    rows = [
        {"publishTime": "2026-01-01T00:00:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": 1},
        {"publishTime": "2026-01-01T00:00:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": 2},
    ]
    with pytest.raises(ValueError, match="conflicting"):
        snapshot.parse_windfor(rows, t("2026-01-01T00:00:00"), t("2026-02-01T00:00:00"))


def test_parse_fuelhh_drops_row_at_window_end():
    rows = [{"fuelType": "WIND", "startTime": "2026-02-03T00:00:00Z", "publishTime": "2026-02-03T00:30:00Z", "generation": 1}]
    assert snapshot.parse_fuelhh(rows, snapshot.ACTUAL_FROM, snapshot.ACTUAL_TO) == []


def test_urls():
    assert snapshot.windfor_url(t("2026-01-06T00:00:00"), t("2026-01-13T00:00:00")).endswith(
        "/WINDFOR/stream?publishDateTimeFrom=2026-01-06T00:00:00Z&publishDateTimeTo=2026-01-13T00:00:00Z"
    )
    with pytest.raises(ValueError):
        snapshot.fuelhh_url(t("2026-01-01T00:00:00"), t("2026-01-08T12:00:00"))


def test_fetch_all_dedupes_rows_repeated_across_chunks(monkeypatch):
    payload = {
        "WINDFOR": [{"publishTime": "2026-01-06T00:00:00Z", "startTime": "2026-01-07T00:00:00Z", "generation": 5}],
        "FUELHH": [{"fuelType": "WIND", "startTime": "2026-01-07T00:00:00Z", "publishTime": "2026-01-07T00:30:00Z", "generation": 6}],
    }
    # Every chunk returns the same boundary row, as an inclusive "To" filter would.
    monkeypatch.setattr(snapshot, "fetch_json", lambda url: payload["WINDFOR" if "WINDFOR" in url else "FUELHH"])
    forecasts, actuals = snapshot.fetch_all()
    assert len(forecasts) == 1 and len(actuals) == 1


def test_validate_rejects_gaps_and_accepts_complete_data():
    actuals = [
        {"start_time": snapshot.ACTUAL_FROM + timedelta(minutes=30 * i), "publish_time": snapshot.ACTUAL_FROM, "generation": 1}
        for i in range(int((snapshot.ACTUAL_TO - snapshot.ACTUAL_FROM) / timedelta(minutes=30)))
    ]
    forecasts = [
        {"start_time": h, "publish_time": h - timedelta(hours=24), "generation": 1}
        for h in snapshot.hourly(*snapshot.CORE_TARGETS)
    ]
    snapshot.validate(forecasts, actuals)
    with pytest.raises(ValueError, match="FUELHH"):
        snapshot.validate(forecasts, actuals[:-1])
    with pytest.raises(ValueError, match="no forecast"):
        snapshot.validate(forecasts[:5] + forecasts[6:], actuals)


def test_summary_coverage_counts_hours_missing_from_every_forecast(monkeypatch):
    monkeypatch.setattr(snapshot, "CORE_TARGETS", (t("2026-01-10T00:00:00"), t("2026-01-10T03:00:00")))
    forecasts = [
        {"start_time": t(f"2026-01-10T0{h}:00:00"), "publish_time": t("2026-01-09T00:00:00"), "generation": 1}
        for h in (0, 2)  # 01:00 is missing from every run
    ]
    assert snapshot.summarize(forecasts, [])["full_coverage_horizon_hours"] == 0.0


def test_summary_pairs_forecast_published_exactly_at_delivery_and_only_january():
    forecasts = [
        {"start_time": t("2026-01-31T23:00:00"), "publish_time": t("2026-01-31T23:00:00"), "generation": 100},
        {"start_time": t("2026-02-01T00:00:00"), "publish_time": t("2026-01-31T22:30:00"), "generation": 999},
    ]
    actuals = [
        {"start_time": t("2026-01-31T23:00:00"), "publish_time": t("2026-01-31T23:30:00"), "generation": 80},
        {"start_time": t("2026-02-01T00:00:00"), "publish_time": t("2026-02-01T00:30:00"), "generation": 1},
    ]
    s = snapshot.summarize(forecasts, actuals)
    assert s["paired_points"] == 1
    assert (s["mean_forecast_mw"], s["mean_actual_mw"]) == (100, 80)


def test_write_is_byte_identical_for_identical_rows(tmp_path):
    rows = snapshot.parse_windfor(load("windfor_sample.json"), t("2025-12-30T00:00:00"), t("2026-02-01T00:00:00"))
    a, b = tmp_path / "a" / "f.csv.gz", tmp_path / "b" / "f.csv.gz"
    snapshot.write_csv_gz(a, rows, snapshot.FORECAST_FIELDS)
    snapshot.write_csv_gz(b, rows, snapshot.FORECAST_FIELDS)
    assert a.read_bytes() == b.read_bytes()
