"""Golden tests for forecast selection, built from a hand-drawn timeline.

Target T = 2026-01-10 12:00. Three runs forecast it:

    publish  09 Jan 10:30  ->  9,000 MW   (lead 25.5 h)
    publish  09 Jan 12:00  ->  9,500 MW   (lead 24.0 h, exactly on the 24 h cutoff)
    publish  10 Jan 09:30  -> 10,200 MW   (lead  2.5 h)
    actual                  ->  9,800 MW
"""

from datetime import datetime, timezone

import pytest

from windsight.select import ForecastIndex, delivery_window, lead_points, select_series

UTC = timezone.utc


def t(s):
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


T = t("2026-01-10T12:00:00")
FORECASTS = [
    {"start_time": T, "publish_time": t("2026-01-09T10:30:00"), "generation": 9000},
    {"start_time": T, "publish_time": t("2026-01-09T12:00:00"), "generation": 9500},
    {"start_time": T, "publish_time": t("2026-01-10T09:30:00"), "generation": 10200},
    # Published after delivery: must never be selected.
    {"start_time": T, "publish_time": t("2026-01-10T15:30:00"), "generation": 9790},
]
ACTUALS = [
    {"start_time": T, "publish_time": t("2026-01-10T12:30:00"), "generation": 9800},
    # Half-hour actual with no hourly forecast: not a comparison point.
    {"start_time": t("2026-01-10T12:30:00"), "publish_time": t("2026-01-10T13:00:00"), "generation": 9700},
]


def only_point(h, forecasts=FORECASTS, actuals=ACTUALS):
    points = select_series(ForecastIndex(forecasts), actuals, h)
    assert len(points) == 1
    return points[0]


def test_latest_forecast_at_or_before_cutoff_is_chosen():
    p = only_point(2)
    assert p["forecast"] == 10200
    assert p["publish_time"] == t("2026-01-10T09:30:00")
    assert p["decision_time"] == t("2026-01-10T10:00:00")
    assert p["lead_hours"] == 2.5
    assert p["error"] == 10200 - 9800


def test_publish_exactly_at_cutoff_counts_as_available():
    p = only_point(24)
    assert p["forecast"] == 9500
    assert p["lead_hours"] == 24.0


def test_one_hour_more_falls_back_to_the_older_run():
    p = only_point(25)
    assert p["forecast"] == 9000
    assert p["lead_hours"] == 25.5


def test_no_forecast_old_enough_gives_an_empty_point():
    p = only_point(26)
    assert p["forecast"] is None and p["error"] is None and p["publish_time"] is None
    assert p["actual"] == 9800


def test_horizon_zero_uses_the_freshest_run_published_before_delivery():
    p = only_point(0)
    assert p["forecast"] == 10200


def test_decision_time_must_fall_in_january():
    jan_first = t("2026-01-01T00:00:00")
    feb_first = t("2026-02-01T00:00:00")
    forecasts = [
        {"start_time": jan_first, "publish_time": t("2025-12-31T00:00:00"), "generation": 1},
        {"start_time": feb_first, "publish_time": t("2026-01-31T00:00:00"), "generation": 2},
    ]
    actuals = [
        {"start_time": jan_first, "publish_time": jan_first, "generation": 10},
        {"start_time": feb_first, "publish_time": feb_first, "generation": 20},
    ]
    # h = 0: D = T, so 1 Jan 00:00 is in (boundary inclusive) and 1 Feb 00:00 is out.
    assert [p["start_time"] for p in select_series(ForecastIndex(forecasts), actuals, 0)] == [jan_first]
    # h = 24: D for 1 Feb 00:00 is 31 Jan 00:00, so it is in; D for 1 Jan is 31 Dec, out.
    assert [p["start_time"] for p in select_series(ForecastIndex(forecasts), actuals, 24)] == [feb_first]


def test_requested_range_is_half_open():
    a = [
        {"start_time": t("2026-01-10T11:00:00"), "publish_time": T, "generation": 1},
        {"start_time": T, "publish_time": T, "generation": 2},
        {"start_time": t("2026-01-10T13:00:00"), "publish_time": T, "generation": 3},
    ]
    points = select_series(ForecastIndex(FORECASTS), a, 2, start=T, end=t("2026-01-10T13:00:00"))
    assert [p["start_time"] for p in points] == [T]


def test_delivery_window_shifts_with_horizon():
    assert delivery_window(0) == (t("2026-01-01T00:00:00"), t("2026-02-01T00:00:00"))
    assert delivery_window(24) == (t("2026-01-02T00:00:00"), t("2026-02-02T00:00:00"))


def test_negative_horizon_is_rejected():
    with pytest.raises(ValueError):
        select_series(ForecastIndex(FORECASTS), ACTUALS, -1)


def test_lead_points_use_every_january_run_with_non_negative_lead_below_cap():
    points = lead_points(FORECASTS, ACTUALS, max_lead_hours=25)
    # 25.5 h is above the cap; 15:30 is after delivery (negative lead); 24.0 and 2.5 remain.
    assert sorted(p["lead_hours"] for p in points) == [2.5, 24.0]
    assert {p["error"] for p in points} == {9500 - 9800, 10200 - 9800}


def test_lead_points_skip_runs_published_outside_january():
    forecasts = [{"start_time": t("2026-01-01T06:00:00"), "publish_time": t("2025-12-31T22:30:00"), "generation": 5}]
    actuals = [{"start_time": t("2026-01-01T06:00:00"), "publish_time": t("2026-01-01T06:30:00"), "generation": 4}]
    assert lead_points(forecasts, actuals) == []
