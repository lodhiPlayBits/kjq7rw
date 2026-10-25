import subprocess
import sys
from pathlib import Path

ENTRY = Path(__file__).resolve().parents[2] / "api" / "index.py"


def test_vercel_entry_imports_app_without_pythonpath(tmp_path):
    # Fresh isolated interpreter in an unrelated directory, as on Vercel: api/index.py must find backend/ itself.
    code = f"import runpy; m = runpy.run_path({str(ENTRY)!r}); assert m['app'].title == 'WindSight API'"
    result = subprocess.run([sys.executable, "-I", "-c", code], cwd=tmp_path, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
