# Data notes — Elexon BMRS snapshot for January 2026 decisions

Measured on 2026-10-25 with `PYTHONPATH=backend python -m windsight.snapshot --fetch`.
Re-fetching produced byte-identical files, so the snapshot is reproducible.

## Sources

| Dataset | Endpoint | Filter used |
|---|---|---|
| Forecasts | `https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream` | `publishDateTimeFrom` / `publishDateTimeTo`, 7-day chunks |
| Actuals | `https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream` | `settlementDateFrom` / `settlementDateTo`, `fuelType=WIND`, 7-day chunks |

Both stream endpoints return a plain JSON array with no paging. A 7-day chunk took about 1–3 s.

## Snapshot files (`data/`)

| File | Rows | Size | Columns |
|---|---|---|---|
| `windfor_jan2026.csv.gz` | 19,272 | 94 KB | `start_time, publish_time, generation` (UTC, MW) |
| `fuelhh_wind_jan2026.csv.gz` | 1,584 | 13 KB | `start_time, publish_time, generation` (UTC, MW) |

`--fetch` refuses to write if any actual half-hour is missing or any hour from 2 Jan to 1 Feb has no forecast. It writes both files via temp files, so a failed download never replaces good data.

- Forecasts: every publish from 2025-12-30T02:30Z to 2026-01-31T22:30Z (264 publishes).
- Actuals: half-hours from 2026-01-01T00:00Z to 2026-02-02T23:30Z (33 days × 48, no gaps, no revisions seen).

## Shape of WINDFOR

- **Resolution: hourly**, on the hour (every consecutive target is 60 minutes apart). FUELHH is half-hourly, so forecasts are compared with actuals only at `:00` (roadmap A2). No interpolation.
- **Publish cadence: 8 runs a day**, at 02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30 and 22:30 UTC. One run on one day was at 12:25 instead of 11:30.
- **Each run covers a fixed window**, from D-1 21:00 to D+2 21:00 (73 hourly points), whatever its publish time. So each run includes some hours that are already in the past (negative lead, which is ignored), and the furthest lead runs from 46.5 h (22:30 run) to 66.5 h (02:30 run).
- **Publishes per target:** min 8, median 24, max 32.
- **Maximum lead seen:** 66.5 h.
- **Full-coverage horizon: 43.5 h.** For every target from 2 Jan to 1 Feb, at least one forecast was published 43.5 h or more ahead. Above that, some hours have no forecast old enough. **The horizon slider therefore caps at 43 h** (Hmax, roadmap A3). The default of 24 h is well inside it.

## Comparability (roadmap A7)

On the 744 January hourly timestamps where both exist, using the freshest forecast published at or before delivery:

| | Mean MW |
|---|---|
| WINDFOR forecast | 13,174 |
| FUELHH WIND actual | 11,581 |

The forecast mean is 14% above the actual mean, inside the 25% threshold, so the two are treated as comparable. The gap is a first sign of positive bias (wind over-forecast), to confirm in Phase 2 with the proper metrics.

## Time zones

The whole window is GMT, so UK local time equals UTC. All timestamps are stored and served as UTC ISO-8601 with a `Z` suffix.

## Refreshing

```bash
PYTHONPATH=backend python -m windsight.snapshot --fetch     # re-download and rewrite data/
PYTHONPATH=backend python -m windsight.snapshot --summary   # print these numbers from the files
```

## First accuracy results (Phase 2 API, real snapshot)

From `/api/metrics` and `/api/series`. Error = forecast − actual.

**By realised lead time** (every January run; 4 h buckets, about 990 points each):

| Lead | MAE (MW) | RMSE | Bias | P90 abs. error | nMAE |
|---|---|---|---|---|---|
| 0–4 h | 1,758 | 2,226 | +1,536 | 3,674 | 15.3% |
| 20–24 h | 1,944 | 2,421 | +1,774 | 3,849 | 17.3% |
| 24–28 h | 1,948 | 2,413 | +1,730 | 3,844 | 17.4% |
| 44–48 h | 2,292 | 2,866 | +1,861 | 4,582 | 20.7% |

**At a fixed horizon** (744 January decisions each): h = 1 h → MAE 1,794 MW; h = 24 h → MAE 1,932 MW, bias +1,736 MW, P90 3,850 MW; h = 43 h → MAE 2,188 MW.

**Worst UK hours at 24 h:** 02:00–05:00, about 2.4 GW MAE. **Worst delivery days:** 11 Jan (5.0 GW), 12 Jan (4.3 GW), 21 Jan (3.8 GW).

### What stands out

- Error grows with lead time, as expected, but only moderately: MAE rises about 30% from 0–4 h to 44–48 h.
- **Bias dominates.** Forecasts sit about 1.5–1.9 GW above metered output even 0–4 h ahead, where weather uncertainty is smallest. Most of the MAE is this constant offset, not random error.
- **Hypothesis (not verified):** WINDFOR may forecast available or unconstrained wind, while FUELHH reports metered output after curtailment. The bias would then be largely curtailed wind. Curtailment is highest overnight, when demand is low, which matches the 02:00–05:00 peak. If true, a buyer should correct the forecast down by the typical bias before sizing purchases. Check this against Elexon's WINDFOR dataset definition before stating it as fact in the pitch.
