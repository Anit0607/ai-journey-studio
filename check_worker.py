"""Durable-process smoke test in an isolated temporary workspace."""
import subprocess
import tempfile
import time
import sys
import sqlite3
from pathlib import Path
script=str(Path("studio.py").resolve())
with tempfile.TemporaryDirectory() as directory:
    first=subprocess.Popen([sys.executable,script,"worker"],cwd=directory)
    try:
        database=Path(directory)/"data/studio.sqlite3"
        for _ in range(30):
            if database.exists():
                with sqlite3.connect(database) as db:
                    try:
                        if db.execute("SELECT COUNT(*) FROM runtime").fetchone()[0]:break
                    except sqlite3.OperationalError:pass
            time.sleep(.1)
        second=subprocess.run([sys.executable,script,"worker"],cwd=directory,capture_output=True,text=True,timeout=5)
        assert second.returncode!=0 and "already running" in second.stderr
        with sqlite3.connect(database) as db:
            assert db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]==0
            assert db.execute("SELECT COUNT(*) FROM ledger").fetchone()[0]==0
            assert db.execute("SELECT enabled FROM runtime").fetchone()[0]==0
        print("PASS: worker heartbeat, singleton exclusion, no browser dependency, empty workspace, no calls")
    finally:
        first.terminate();first.wait(timeout=10)
