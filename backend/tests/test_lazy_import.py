"""Cold start: procrastinate costs ~200 ms to import and must only load when a job is queued/drained."""
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_importing_the_app_does_not_import_procrastinate():
    code = "import sys; import app.main; assert 'procrastinate' not in sys.modules, 'procrastinate was imported'"
    result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True,
                            env={**__import__("os").environ, "SESSION_SECRET": "test-secret"})
    assert result.returncode == 0, result.stderr


def test_the_worker_entrypoints_still_resolve():
    code = ("import sys; import app.queue as q; assert 'procrastinate' not in sys.modules; "
            "assert q.app is q.get_app(); assert q.async_app is q.get_async_app(); "
            "q.app.perform_import_paths(); assert 'line.push_text' in q.app.tasks, list(q.app.tasks)")
    result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True,
                            env={**__import__("os").environ, "SESSION_SECRET": "test-secret"})
    assert result.returncode == 0, result.stderr
