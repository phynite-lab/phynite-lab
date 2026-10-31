"""Monotonic scientific time shared with the outer, credential-owning worker.

Only trusted runner code starts these intervals; download and result upload never
start the clock. Atomic replacement lets the worker sample while a solver runs.
"""
from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


def clock_path(work: Path | None = None) -> Path:
    return (work or Path(os.environ.get('PHYNITE_WORK_DIR', '/work'))) / '.compute-clock.json'


def write_clock(value: dict, work: Path | None = None) -> None:
    path = clock_path(work)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)


@contextmanager
def measured_compute(work: Path | None = None) -> Iterator[None]:
    path = clock_path(work)
    previous = json.loads(path.read_text()) if path.is_file() else {}
    total = int(previous.get('totalNanoseconds') or 0)
    started = time.monotonic_ns()
    write_clock({'totalNanoseconds': total, 'startedMonotonicNs': started}, work)
    try:
        yield
    finally:
        write_clock({'totalNanoseconds': total + time.monotonic_ns() - started, 'startedMonotonicNs': None}, work)
