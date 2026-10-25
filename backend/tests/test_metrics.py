import math

import pytest

from windsight.metrics import error_metrics, grouped_metrics


def test_four_point_series_matches_hand_computation():
    # errors +100, -200, +300, -400 MW against a flat 1,000 MW actual
    m = error_metrics([100, -200, 300, -400], [1000, 1000, 1000, 1000])

    assert m["n"] == 4
    assert m["mae"] == 250  # (100 + 200 + 300 + 400) / 4
    assert m["rmse"] == pytest.approx(math.sqrt(75_000))  # (1e4 + 4e4 + 9e4 + 16e4) / 4
    assert m["bias"] == -50  # (100 - 200 + 300 - 400) / 4
    assert m["p50"] == 250  # median of |e| = 100, 200, 300, 400
    assert m["p90"] == pytest.approx(370)  # linear interpolation: 300 + 0.7 * 100
    assert m["nmae"] == pytest.approx(0.25)  # 250 / 1,000


def test_single_point_quantiles_are_the_value_itself():
    m = error_metrics([-120], [800])
    assert m["p50"] == m["p90"] == 120


def test_empty_input_returns_none():
    assert error_metrics([], []) is None


def test_mismatched_lengths_are_rejected():
    with pytest.raises(ValueError):
        error_metrics([1, 2], [1])


def test_grouped_metrics_orders_groups_by_key():
    rows = [
        {"k": "b", "error": 10, "actual": 100},
        {"k": "a", "error": -20, "actual": 100},
        {"k": "b", "error": -30, "actual": 100},
    ]
    groups = grouped_metrics(rows, key=lambda r: r["k"])

    assert [g["key"] for g in groups] == ["a", "b"]
    assert groups[1]["n"] == 2 and groups[1]["mae"] == 20 and groups[1]["bias"] == -10
