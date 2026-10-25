#!/usr/bin/env bash
# Full local check, run before every commit: backend tests, frontend typecheck, tests and build.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python}"
if [ -x .venv/Scripts/python ]; then PY=.venv/Scripts/python; fi
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; fi

echo "== backend tests"
PYTHONPATH=backend "$PY" -m pytest -q
echo "== frontend typecheck"
npm --prefix web run typecheck
echo "== frontend tests"
npm --prefix web test -- --run
echo "== frontend build"
npm --prefix web run build
echo "== verify OK"
