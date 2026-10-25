from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from windsight.app import app

client = TestClient(app)


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def test_health_reports_snapshot_row_counts():
    resp = client.get("/api/health")

    assert resp.status_code == 200
    # Counts from docs/data-notes.md; a missing or truncated snapshot fails here.
    assert resp.json() == {"status": "ok", "actuals": 1584, "forecasts": 19272}


def test_openapi_docs_are_served_under_api():
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/api/docs").status_code == 200


def test_meta_reports_measured_full_coverage_horizon():
    m = client.get("/api/meta").json()
    assert m["hmax"] == 43
    assert m["default_horizon_h"] == 24
    assert m["decision_window"] == ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]


def test_series_at_24h_only_uses_forecasts_published_24h_before_and_decided_in_january():
    body = client.get("/api/series", params={"horizon_h": 24}).json()
    points = body["points"]

    assert len(points) == 31 * 24  # one per hour of the shifted window
    for p in points:
        start = ts(p["start_time"])
        assert ts(p["publish_time"]) <= start - timedelta(hours=24)
        assert ts("2026-01-01T00:00:00Z") <= ts(p["decision_time"]) < ts("2026-02-01T00:00:00Z")
        assert p["lead_hours"] >= 24
        assert p["error"] == p["forecast"] - p["actual"]


def test_every_hour_has_a_forecast_up_to_hmax():
    points = client.get("/api/series", params={"horizon_h": 43}).json()["points"]
    assert all(p["forecast"] is not None for p in points)


def test_series_range_filter_returns_half_hourly_actuals_and_hourly_points():
    body = client.get(
        "/api/series", params={"horizon_h": 24, "from": "2026-01-10T00:00:00Z", "to": "2026-01-13T00:00:00Z"}
    ).json()

    assert body["window"] == ["2026-01-10T00:00:00Z", "2026-01-13T00:00:00Z"]
    assert len(body["actual"]) == 3 * 48
    assert len(body["points"]) == 3 * 24
    assert body["summary"]["n"] == 72


def test_series_range_is_clipped_to_the_delivery_window():
    body = client.get("/api/series", params={"horizon_h": 0, "from": "2025-12-01", "to": "2026-01-02"}).json()
    assert body["window"] == ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]


def test_series_rejects_out_of_range_horizon_and_empty_range():
    assert client.get("/api/series", params={"horizon_h": 44}).status_code == 422
    assert client.get("/api/series", params={"horizon_h": -1}).status_code == 422
    assert client.get("/api/series", params={"from": "2026-01-12", "to": "2026-01-10"}).status_code == 422


def test_metrics_by_lead_buckets_cover_0_to_48h_and_error_grows_with_lead():
    body = client.get("/api/metrics", params={"by": "lead"}).json()
    groups = body["groups"]

    assert [g["label"] for g in groups][:2] == ["0–4 h", "4–8 h"]
    assert len(groups) == 12
    assert groups[0]["mae"] < groups[-1]["mae"]
    assert body["overall"]["n"] == sum(g["n"] for g in groups)


def test_metrics_by_hour_and_day_partition_the_series_at_h():
    hour = client.get("/api/metrics", params={"by": "hour", "horizon_h": 24}).json()
    day = client.get("/api/metrics", params={"by": "day", "horizon_h": 24}).json()
    series = client.get("/api/series", params={"horizon_h": 24}).json()

    assert len(hour["groups"]) == 24
    assert len(day["groups"]) == 31
    assert hour["overall"] == day["overall"] == series["summary"]
    assert sum(g["n"] for g in hour["groups"]) == hour["overall"]["n"]


def test_metrics_rejects_unknown_grouping():
    assert client.get("/api/metrics", params={"by": "week"}).status_code == 422


def test_series_accepts_offsets_and_naive_times_as_utc():
    offset = client.get("/api/series", params={"from": "2026-01-10T01:00:00+01:00", "to": "2026-01-10T06:00:00"}).json()
    assert offset["window"] == ["2026-01-10T00:00:00Z", "2026-01-10T06:00:00Z"]


def test_metrics_horizon_defaults_to_24_for_hour_and_is_ignored_for_lead():
    assert client.get("/api/metrics", params={"by": "hour"}).json()["horizon_h"] == 24
    assert client.get("/api/metrics", params={"by": "lead"}).json()["horizon_h"] is None


def test_points_without_a_forecast_are_null_and_excluded_from_summary():
    from windsight import app as api

    points = [
        {"start_time": ts("2026-01-10T00:00:00Z"), "decision_time": ts("2026-01-09T00:00:00Z"),
         "actual": 100, "forecast": None, "publish_time": None, "lead_hours": None, "error": None},
        {"start_time": ts("2026-01-10T01:00:00Z"), "decision_time": ts("2026-01-09T01:00:00Z"),
         "actual": 100, "forecast": 150, "publish_time": ts("2026-01-08T22:30:00Z"), "lead_hours": 26.5, "error": 50},
    ]
    assert api.point_json(points[0])["publish_time"] is None
    assert api.summary(points)["n"] == 1 and api.summary(points)["mae"] == 50
    assert api.summary(points[:1]) is None


def test_covered_horizon_stops_at_first_gap():
    from windsight import app as api
    from windsight.select import ForecastIndex

    target = ts("2026-01-10T12:00:00Z")
    index = ForecastIndex([{"start_time": target, "publish_time": ts("2026-01-10T10:00:00Z"), "generation": 1}])
    actuals = [{"start_time": target, "publish_time": target, "generation": 1}]
    assert api.covered_horizon(index, actuals) == 2


def test_frontend_is_served_at_root_when_built_and_api_still_wins(tmp_path):
    from fastapi import FastAPI

    from windsight import app as api

    (tmp_path / "index.html").write_text("<!doctype html><title>WindSight</title>")
    target = FastAPI()
    target.get("/api/ping")(lambda: {"ok": True})

    assert api.mount_frontend(target, tmp_path) is True
    c = TestClient(target)
    assert "WindSight" in c.get("/").text
    assert c.get("/api/ping").json() == {"ok": True}


def test_frontend_is_not_mounted_without_a_build(tmp_path):
    from fastapi import FastAPI

    from windsight import app as api

    assert api.mount_frontend(FastAPI(), tmp_path) is False


def test_frontend_mount_is_registered_after_every_api_route():
    # Starlette matches in order: a route added after Mount("/") would be shadowed by the static files.
    from starlette.routing import Mount

    routes = app.routes
    mounts = [i for i, r in enumerate(routes) if isinstance(r, Mount)]
    if mounts:  # only present when web/dist has been built
        assert mounts == [len(routes) - 1]


def test_static_files_reject_path_traversal(tmp_path):
    from fastapi import FastAPI

    from windsight import app as api

    (tmp_path / "index.html").write_text("ok")
    target = FastAPI()
    api.mount_frontend(target, tmp_path)
    assert TestClient(target).get("/..%2fapp.py").status_code == 404
