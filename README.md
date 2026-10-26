# WindSight — GB wind forecast monitor for the day-ahead desk

WindSight shows a UK day-ahead buying team **the latest national wind forecast they could actually have seen when they had to buy**, next to what the wind really generated, and **how accurate those forecasts were**, so purchase volumes can be sized with the error in mind. Scope: national wind, Elexon BMRS data, purchase decisions made in January 2026.

**Live app:** https://kjq7rw.vercel.app · **API docs:** https://kjq7rw.vercel.app/api/docs · **Health:** https://kjq7rw.vercel.app/api/health

| Monitor | Accuracy |
|---|---|
| Forecast vs actual for any delivery range, with a horizon slider (0–43 h): every hour uses the latest forecast published at least *h* hours before delivery. Tooltip shows when that forecast was published and its real lead time. | Error by lead time, by hour of day and by delivery day; MAE, RMSE, bias, P90; data-driven takeaways for the desk. |

## How to run

**Docker (one command, recommended for review)** — serves the React build and the API on one port:

```bash
docker compose up --build
```

Then open http://localhost:8000 (API at http://localhost:8000/api/docs).

**Local development** (Python 3.12, Node 22):

```bash
python -m venv .venv                        # python3 on some Linux distros
source .venv/Scripts/activate               # Windows Git Bash; macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
npm --prefix web ci
PYTHONPATH=backend python -m uvicorn windsight.app:app --port 8000   # terminal 1 (venv active)
npm --prefix web run dev                                            # terminal 2 → http://localhost:5173
```

**Checks** (run before every commit):

```bash
bash scripts/verify.sh
```

It runs the backend tests (pytest), frontend lint, typecheck, tests (vitest) and the production build. Coverage locally:

```bash
pytest --cov                      # backend, fails below 85% (.coveragerc)
npm --prefix web run coverage     # frontend, fails below 90% lines (vite.config.ts)
```

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and pushes to `develop` and `main`. There is no deployment stage; hosting is Vercel.

| Job | What it does | Fails when |
|---|---|---|
| `test (backend)` | pytest with coverage; XML + HTML report uploaded, summary on the run page | a test fails or line coverage < 85% |
| `test (frontend)` | ESLint, `tsc`, vitest with v8 coverage (lcov + HTML uploaded), production build | lint/type/test/build error, or coverage below 90% lines / 85% branches |
| `scan (filesystem)` | Trivy: dependency vulnerabilities (pinned `requirements*.txt` and the npm lockfile; transitive Python packages are covered by the image scan), secrets, Dockerfile misconfiguration | a fixable CRITICAL vulnerability |
| `build + scan (docker)` | builds the image, smoke-tests `/api/health` and `/`, Trivy image scan (OS + Python packages) | the smoke test fails or a fixable CRITICAL vulnerability |
| `sonar` | SonarCloud analysis with both coverage reports | the `SONAR_TOKEN` secret is missing or the scan errors |
| `ci-passed` | single status to require in branch protection | any job above did not succeed |

Current coverage: backend 92% of lines; frontend 99.5% of lines (component tests with Testing Library + jsdom, API mocked).

**SonarCloud setup (one-off):** import the repository on sonarcloud.io (organization `lodhiplaybits`, project key `lodhiPlayBits_kjq7rw`; edit `sonar-project.properties` if yours differ), turn off "Automatic Analysis" in the project settings, and add the token as the repository secret `SONAR_TOKEN`.

**Refresh the data snapshot** (optional; the app never calls Elexon at runtime):

```bash
PYTHONPATH=backend python -m windsight.snapshot --fetch     # re-download January 2026 from Elexon
PYTHONPATH=backend python -m windsight.snapshot --summary   # describe the snapshot
```

## How the forecast is chosen

| Term | Meaning |
|---|---|
| *T* | delivery (target) hour |
| *h* | requested horizon in hours (slider, default 24, max 43) |
| *D = T − h* | decision time; only decisions made in **January 2026** count, so the delivery window shifts with *h* |
| forecast used | the latest WINDFOR run with `publishTime ≤ D` (a run published exactly at *D* counts) |
| realised lead | *T − publishTime* of that run, so it is always ≥ *h* |
| error | forecast − actual, in MW. **Positive = wind over-forecast → the desk bought too little and is short.** |

- **Why max 43 h:** each WINDFOR run covers a fixed window (D−1 21:00 → D+2 21:00). Above 43.5 h some hours have no run old enough, so the slider stops at 43 h. The backend measures this from the data.
- **Resolution:** WINDFOR is hourly, FUELHH half-hourly. Errors are computed only at the hours both share; no interpolation.
- **Metrics:** MAE, RMSE, bias, P50/P90 of absolute error, nMAE (MAE ÷ mean actual). MAPE is deliberately not used: it explodes when wind output is near zero.
- **Time zone:** the whole window is GMT, so UK time equals UTC.

## Findings (January 2026)

| Lead time | MAE (MW) | RMSE | Bias | P90 abs. error | nMAE |
|---|---|---|---|---|---|
| 0–4 h | 1,758 | 2,226 | +1,536 | 3,674 | 15.3% |
| 20–24 h | 1,944 | 2,421 | +1,774 | 3,849 | 17.3% |
| 24–28 h | 1,948 | 2,413 | +1,730 | 3,844 | 17.4% |
| 44–48 h | 2,292 | 2,866 | +1,861 | 4,582 | 20.7% |

- **Day-ahead (h = 24 h):** typical miss 1.93 GW (17% of mean output); 9 in 10 hours within 3.85 GW.
- **Error grows with lead time, but modestly:** about +30% from 0–4 h to 44–48 h.
- **Bias dominates:** forecasts sit 1.5–1.9 GW above metered output at *every* lead time, even 0–4 h ahead. It is a steady offset, not weather uncertainty, so on average the desk ends up short.
- **Worst hours:** 02:00–05:00. **Worst delivery days:** 11 Jan (5.0 GW MAE), 12 Jan (4.3 GW), 21 Jan (3.8 GW).
- **Caveat / hypothesis (not verified):** the offset may be wind curtailment. FUELHH is metered output after wind farms are turned down; WINDFOR may forecast unconstrained output. The overnight peak fits, since curtailment is highest at low demand. Check against Elexon's dataset definitions before acting on it.

Full measurements: [`docs/data-notes.md`](docs/data-notes.md).

## Architecture

```
Elexon BMRS (FUELHH, WINDFOR) ──snapshot.py --fetch──▶ data/*.csv.gz  (committed, 107 KB)
                                                             │ loaded once at start-up
                                                             ▼
              FastAPI (backend/windsight)  /api/meta  /api/series  /api/metrics  /api/health
                                                             │ JSON
                                                             ▼
              React + TypeScript + recharts (web/)   Monitor · Accuracy   (state in the URL)
```

- **Snapshot, not live calls:** January 2026 data never changes, so it is downloaded once and committed. The deployed app needs no network access to Elexon and always loads.
- **Selection** (`select.py`): forecasts are indexed per target hour with publish times sorted; `bisect_right` finds the latest run at or before the decision time (O(log n)).
- **Metrics** (`metrics.py`): standard library only (`statistics`); no pandas.
- **Hosting:** Vercel serves `web/dist` as static files and `api/index.py` as a Python function. **Docker is the reproducible local/reviewer environment**: one image builds the frontend and serves it with the API.

## Files and directories

| Path | What it is |
|---|---|
| `backend/windsight/snapshot.py` | Downloads Elexon data in 7-day chunks, validates completeness, writes `data/*.csv.gz`; `--summary` describes it |
| `backend/windsight/select.py` | Forecast selection: latest run published ≤ T − h, decision-window rules, lead-time points |
| `backend/windsight/metrics.py` | MAE, RMSE, bias, P50/P90, nMAE; grouping |
| `backend/windsight/app.py` | FastAPI app: `/api/health`, `/api/meta`, `/api/series`, `/api/metrics`; serves the React build when present |
| `backend/tests/` | pytest suite, including hand-checked "golden" tests for selection and metrics, plus small JSON fixtures |
| `api/index.py` | Vercel entry point (exposes the FastAPI app) |
| `data/` | January 2026 snapshot: `windfor_jan2026.csv.gz`, `fuelhh_wind_jan2026.csv.gz` |
| `web/src/components/` | `MonitorView`, `ForecastChart`, `AccuracyView`, `TopBar`, `KpiCard` |
| `web/src/url.ts` | Page state ⇄ URL (shareable views), with validation and clamping |
| `web/src/chartData.ts`, `accuracy.ts`, `format.ts` | Pure helpers for chart rows, selection, calendar, colours, wording, formatting |
| `web/src/api.ts`, `useApi.ts` | Typed API client and a cancel-on-change fetch hook |
| `web/src/**/*.test.ts(x)`, `web/src/test/` | vitest unit and component tests (Testing Library + jsdom), shared fixtures and setup |
| `scripts/verify.sh` | The full local check: pytest, lint, typecheck, vitest, build |
| `.coveragerc`, `sonar-project.properties` | Backend coverage settings; SonarCloud project settings |
| `scripts/coverage-summary.mjs` | Prints frontend coverage as a table on the CI run page |
| `Dockerfile`, `docker-compose.yml` | Multi-stage image (Node build → Python runtime, non-root, health check) |
| `vercel.json`, `.vercelignore` | Vercel build, function bundling and `/api/*` routing |
| `.github/workflows/ci.yml` | CI: tests with coverage, Trivy scans, Docker smoke test, SonarCloud |
| `docs/roadmap/` | The phased plan, including the objections it was stress-tested against |
| `docs/data-notes.md` | What the data looks like and the measured accuracy results |

## Development practices

- Phased roadmap with a checkable "done when" for each phase, reviewed by an independent critic before work started.
- Tests first for the core logic: hand-built timelines for forecast selection (cut-off equality, no forecast yet, January boundaries) and a 4-point metrics example worked out by hand.
- Every change runs `scripts/verify.sh`; each phase was reviewed by a separate reviewer before commit, and its findings were fixed.
- Feature branches merged into `develop` by pull request; CI runs on pull requests and on pushes to `main` and `develop`.
- Pinned dependencies, scanned by Trivy. Starlette advisories found in review and by Trivy (CVE-2025-62727, CVE-2026-48818, CVE-2026-54283) were fixed by upgrading to FastAPI 0.140 / Starlette 1.3.1. The image applies Debian security updates on top of the pinned base.

## Use of AI tools

This project was built with **Claude Code** (Anthropic) as a pair-programmer:

- **Planning:** drafting the phased roadmap, which a separate AI "critic" agent then challenged before work started.
- **Code:** writing the backend, frontend, tests, Docker and CI configuration.
- **Review:** an independent AI code-reviewer agent reviewed each phase; its findings were fixed and re-tested.
- **UI:** Claude generated the screen designs (Monitor and Accuracy) in Figma from the brief, and the React UI was then built to match them.

**Checked by hand:** the forecast-selection rules, the metric definitions, every number quoted in this README (against the API and the snapshot), and the app's behaviour in the browser. Decisions and final review were made by the author, who is responsible for the result.
