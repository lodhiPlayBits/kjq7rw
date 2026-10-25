# WindSight roadmap — GB wind forecast monitor (Jan 2026 decisions)

Status: approved 2026-10-25. Built phase by phase; each phase has a checkable "done when".

## Goal and success measure

Ship a public, deployed React + Python app that shows a UK day-ahead buying team:

- (a) the latest national wind forecast (Elexon WINDFOR) available at their decision time, against actual wind generation (FUELHH, `fuelType=WIND`), for decisions made in January 2026;
- (b) how accurate those forecasts were, by lead time and by time of day.

Submitted with a README and a video of 10 minutes or less, in about 16 effort hours.

Success means:

1. **Monitoring view** — the deployed URL shows forecast vs actual for any delivery range whose decision time `T − h` falls in January 2026. Moving the horizon slider changes which forecast is shown; the tooltip shows publishTime, decision time and realised lead.
2. **Accuracy view** — MAE, RMSE, bias and P90 absolute error by realised-lead bucket and by hour of day; values match the backend golden tests and the README Findings table.
3. **Repo** — public, randomly named, README (files/dirs, how to run, deployed link, AI disclosure, Findings) on the default branch; `bash scripts/verify.sh` passes.
4. **Docker** — `docker compose up --build` serves the app locally.
5. **Video and form** — unlisted YouTube video ≤ 10 min (pitch ≤ 5, tech walkthrough ≤ 5); form submitted.

## Workflow (set by the user)

- The user created the GitHub repo with `main` and `develop`; work happens on `develop`.
- **The user makes all commits, branches, PRs and merges.** Claude edits files, runs `scripts/verify.sh`, gets kit:code-reviewer reviews for changes over ~50 lines, and hands over with a suggested Conventional Commit message.

## Assumptions

- **A1 (data available, unverified):** Elexon still serves WINDFOR publishes from late Dec 2025 – Jan 2026, filterable by publish time, with more than one publish per startTime. Phase 0 gates on this.
- **A2 (resolution):** WINDFOR may be hourly while FUELHH is half-hourly. Compare only on timestamps both datasets share; no interpolation.
- **A3 (definitions):**
  - Requested horizon `h`: for target `T`, use the latest forecast with `publishTime ≤ T − h` (equality counts as available).
  - Decision time `D = T − h`.
  - Realised lead `L = T − publishTime` of the forecast chosen, so `L ≥ h`.
  - Slider 0..Hmax, Hmax = floor(full-coverage horizon) — the largest h for which every target hour has a forecast. **Measured in Phase 0: 43.5 h → Hmax = 43** (max single lead is 66.5 h, but coverage is incomplete above 43.5 h; see `docs/data-notes.md`). Default `h = 24`.
  - Fixed 11:00 D-1 gate mode is a stretch goal only.
- **A4 (window):** `D ∈ [2026-01-01T00:00Z, 2026-02-01T00:00Z)`, so deliveries shift with `h`. Snapshot covers forecasts published 2025-12-30 → 2026-01-31 and actuals 2026-01-01 → 2026-02-03 (exclusive), which covers 1 Feb + Hmax since Hmax ≤ 48.
- **A5 (time zones):** the whole window is GMT, so UK time = UTC. Store/serve UTC ISO-8601; use `zoneinfo("Europe/London")` for hour-of-day.
- **A6 (FUELHH revisions):** duplicate startTime → keep the latest publishTime.
- **A7 (comparability):** if FUELHH and WINDFOR January means differ by more than ~25%, document it as a README caveat. Measured: forecast 14% above actual, so they are treated as comparable.
- **A8 (hosting):** Vercel free tier — static `web/dist` + `api/index.py` Python function; `vercel.json` handles rewrites and `includeFiles` for `backend/**` and `data/**`. Docker is the local/reviewer environment.
- **A9 (runtime data):** raw January snapshot in `data/*.csv.gz` (< 2 MB) is source input, read at runtime; the deployed app makes no calls to Elexon.
- **A10 (dependencies):** backend `fastapi` (runtime), `uvicorn` (local/Docker), `pytest` + `httpx` (dev; `TestClient`). Frontend: Vite React TS, `recharts`, `vitest`; `@testing-library/react` only for cuttable render tests. No pandas — stdlib `bisect`, `statistics`, `csv`, `gzip` suffice.
- **A13 (verify):** `scripts/verify.sh` runs `PYTHONPATH=backend python -m pytest -q && npm --prefix web run typecheck && npm --prefix web test -- --run && npm --prefix web run build`, before every hand-over.

## Phases

### Phase 0 — Data spike and snapshot (S, 1.5 h)

- Delivers: committed January data snapshots and `docs/data-notes.md` with the measured data shape. Retires A1, A2, A7 and Hmax.
- Work:
  - First 15 minutes: query WINDFOR for publishes on 2026-01-10 only. Empty or current-only → **stop and re-plan**.
  - `backend/windsight/snapshot.py` (urllib, chunked by discovered limits, `--summary`): row counts, min/max startTime/publishTime, publishes per startTime, publish times of day, max lead, time step, January means.
  - Writes `data/windfor_jan2026.csv.gz` and `data/fuelhh_wind_jan2026.csv.gz` (A4 ranges, UTC, A6 de-dupe).
  - `backend/tests/test_snapshot.py`: parse/normalise on hand-trimmed fixtures (WIND filter, UTC, A6).
- Done when:
  - `PYTHONPATH=backend python -m windsight.snapshot --summary` shows publishTimes spanning 2025-12-30 → 2026-01-31, more than 1 publish per startTime, and a max lead.
  - `ls -l data/` shows both files, each < 2 MB.
  - `PYTHONPATH=backend python -m pytest -q backend/tests/test_snapshot.py` passes.

### Phase 1 — Walking skeleton on the real bundle (S, 1.5 h)

- Delivers: deployed app whose `/api/health` reads the snapshot; React page displays it.
- Work: `backend/windsight/app.py` (FastAPI, loads snapshot at import, `/api/health` → `{"status":"ok","actuals":N,"forecasts":M}`); thin `api/index.py`; `vercel.json`; `requirements*.txt`; `web/` Vite React TS; `scripts/verify.sh`; one `TestClient` test and one vitest smoke test; `vercel deploy --prod`.
- Done when: deployed `/api/health` counts equal the local `--summary`; first hit < 5 s; `bash scripts/verify.sh` exits 0.

### Phase 2 — Forecast selection and metrics API (M, 3 h) — never cut

- Delivers: `GET /api/series?from&to&horizon_h` and `GET /api/metrics?by=lead|hour|day&horizon_h=`, browsable in `/docs`.
- Work: `windsight/select.py` (`bisect_right` for `publishTime ≤ T − h`, `D` in January, returns publishTime, D, L, forecast, actual, error = forecast − actual); `windsight/metrics.py` (MAE, RMSE, bias, P50/P90 |error|, nMAE; never MAPE; lead buckets sized to publish cadence); precompute at load. Golden tests first: 3 publishes for one target, equality at cutoff, no forecast yet, h = 0 vs Hmax, D on the January boundary, 4-point hand-computed metrics.
- Done when: `verify.sh` passes incl. golden tests; a `TestClient` test asserts every `horizon_h=24` point has `publishTime ≤ startTime − 24h` and D in January; shortest-lead MAE < longest-lead MAE (else recorded in data notes).

### Phase 3 — Monitoring view (M, 2.5 h)

- Delivers: delivery range limited to the h-dependent window, horizon slider 0..Hmax (default 24), forecast-vs-actual chart (MW), tooltip (publishTime, decision time, realised lead, error), MAE/bias KPI cards. Design: Figma "Screen / Forecast Monitor".
- Done when: on a deployed preview, moving the slider 24 → 2 changes the line and the tooltip publishTime moves later; `?from=2026-01-15&to=2026-01-16&horizon=12` restores state; `verify.sh` passes.

### Phase 4 — Accuracy view (M, 2 h)

- Delivers: metrics by realised-lead bucket (main chart), by hour of day, daily strip, metrics table, and a "how to read this" note. **Bias sign: positive = wind over-forecast → the desk under-procured and is short.** Design: Figma "Screen / Forecast Accuracy".
- Done when: one lead bucket in the deployed tab matches `curl <deploy>/api/metrics?by=lead` by hand; `verify.sh` passes.

### Phase 5 — Docker, CI, README, ship, video, submit (M, 3.5 h) — never cut

- Work: multi-stage `Dockerfile` + `docker-compose.yml` (FastAPI serves `web/dist` when present); GitHub Actions running `verify.sh` (cuttable); README (pitch, directory map, how to run, deployed link, data definitions and caveats, **Findings** table, "Docker = reproducible env, Vercel = hosting", AI disclosure); final `vercel deploy --prod`; script, rehearse, record, upload unlisted; user submits the form.
- Done when: `docker compose up --build` then `curl localhost:8000/api/health` → ok and `/` → HTML; default branch on GitHub shows the README with Findings; incognito loads the app and repo; YouTube shows unlisted, ≤ 10:00; form confirmation received.

**Totals:** 14 h + 2 h buffer. **Overrun check** at the end of Phase 2: if more than 8 h spent, apply cuts 1–3.

**Cut first, in order:** 1. gate mode · 2. GitHub Actions CI · 3. hour-of-day and daily breakdowns · 4. frontend render tests · 5. KPI cards and polish.

**Never cut:** Phase 0 gate and snapshot, selection logic and golden tests, the deploy, minimal Docker, README with AI disclosure and Findings, default-branch check, the video.

## Dependency order

0 → 1 → 2 → {3, 4} → 5

## Out of scope

Regional/BM-unit wind, solar, other fuels; embedded-wind correction; decisions outside January 2026; own forecast model or probabilistic forecasts; live data or any runtime Elexon calls; auth, accounts, database; price/imbalance-cost analysis; mobile beyond "doesn't break"; gate mode unless buffer remains.

## Challenged by plan-critic

Verdict: **PROCEED WITH CHANGES** (no blocking objections). One critique round, one revision.

Accepted:
1. Runtime Elexon fetching of fixed historical data → raw snapshot in `data/`, no runtime network calls.
2. Library code under Vercel's `api/` and an untested bundle → `backend/windsight/`, thin `api/index.py`, pandas dropped, Phase 1 deploys the real bundle.
3. "Horizon" ambiguous → requested horizon vs realised lead defined (A3); decision window shifts with h (A4); slider capped at observed max lead.
4. Anonymity decided after first push → settled before first commit (resolved: user owns repo setup and commits).
5. Five PRs and wrong "no merge → no prod" claim → fewer PRs, `vercel deploy --prod` from any branch, default-branch README check.
6. Cut list targeted already-built items → Docker/CI moved to Phase 5, overrun check after Phase 2.
7. `python -I -m …` fails for project modules → `PYTHONPATH=backend python -m …`.
8. No written analysis → README Findings table; Docker role stated plainly.

Rejected: none.

Post-review correction: the revised Phase 4 note said positive bias means the buyer "over-buys"; corrected to under-procures (short).
