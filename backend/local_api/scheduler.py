"""Persistent admission and observed-RSS limits for local native jobs."""
from __future__ import annotations

import contextlib
import fcntl
import json
import math
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

import psutil


class ResourceError(RuntimeError):
    def __init__(self, message: str, code: str = "INVALID_RESOURCES"):
        super().__init__(message)
        self.code = code


class ResourceScheduler:
    def __init__(self, data_dir: Path):
        self.root = Path(data_dir).expanduser().resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._lock = (self.root / ".scheduler.lock").open("a+b")
        try:
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self._lock.close()
            owner = self._lock_owner()
            if owner:
                raise ResourceError(
                    "Another scheduler already owns this local workspace "
                    f"(PID {owner}). Stop the existing Phynite Lab instance before starting another."
                ) from error
            # flock releases ownership automatically when the owning process
            # exits. Keep the lock file in place for diagnostics, but never
            # unlink or forcibly recover it here: a PID recorded in a stale
            # file is not proof that the current lock holder is dead.
            raise ResourceError(
                "Another scheduler already owns this local workspace. "
                "Stop the existing Phynite Lab instance before starting another."
            ) from error
        self._write_lock_owner()
        self.path = self.root / "scheduler.sqlite"
        with self._db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, vcpus INTEGER NOT NULL, memory INTEGER NOT NULL, status TEXT NOT NULL, pid INTEGER, created REAL, reason TEXT, updated REAL NOT NULL)")
            # No automatic relaunch or assumptions about a PID from a previous
            # scheduler. Saved scratch remains the authority for manual recovery.
            for row in db.execute("SELECT * FROM jobs WHERE status IN ('running','recovery-required')").fetchall():
                status = "recovery-required" if self._process(dict(row)) else "interrupted"
                db.execute("UPDATE jobs SET status=?, reason='The local scheduler stopped before this job completed. Inspect preserved output before resuming.', updated=? WHERE id=?", (status, time.time(), row["id"]))
        self._closed = False

    def _lock_owner(self) -> int | None:
        """Return the recorded owner PID when its process identity is valid.

        The lock itself is authoritative. The metadata is only a diagnostic
        aid, and a PID is accepted only when its creation time still matches
        the value written by the owner. This avoids reporting an unrelated
        process after PID reuse.
        """
        try:
            with self.root.joinpath(".scheduler.lock").open("rb") as descriptor:
                value = json.loads(descriptor.read().decode("utf-8"))
            pid, created = value.get("pid"), value.get("created")
            if type(pid) is not int or pid <= 1 or not isinstance(created, (int, float)):
                return None
            process = psutil.Process(pid)
            if process.status() == psutil.STATUS_ZOMBIE or not math.isclose(process.create_time(), created, rel_tol=0, abs_tol=0.001):
                return None
            return pid
        except (OSError, ValueError, TypeError, KeyError, psutil.Error):
            return None

    def _write_lock_owner(self) -> None:
        """Persist best-effort owner metadata after acquiring the OS lock."""
        try:
            self._lock.seek(0)
            self._lock.truncate()
            self._lock.write(json.dumps({
                "pid": os.getpid(),
                "created": psutil.Process(os.getpid()).create_time(),
                "startedAt": time.time(),
            }).encode("utf-8"))
            self._lock.flush()
            os.fsync(self._lock.fileno())
        except (OSError, psutil.Error):
            # The flock remains authoritative; diagnostics must never prevent
            # a valid scheduler from starting.
            pass

    @contextlib.contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=30, isolation_level="IMMEDIATE")
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        try:
            with db:
                yield db
        finally:
            db.close()

    def close(self) -> None:
        if not self._closed:
            fcntl.flock(self._lock, fcntl.LOCK_UN)
            self._lock.close()
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def capacity(self) -> dict[str, int | str]:
        cpus = psutil.cpu_count(logical=True) or os.cpu_count() or 1
        memory = int(psutil.virtual_memory().total // 1024**2)
        if memory < 1:
            raise ResourceError("The operating system did not report available physical memory.")
        return {"cpuCapacity": cpus, "memoryCapacityMiB": memory, "memoryEnforcement": "rss-watchdog"}

    def settings(self) -> dict[str, Any]:
        capacity = self.capacity()
        with self._db() as db:
            row = db.execute("SELECT value FROM settings WHERE id=1").fetchone()
        defaults = {"vcpus": max(1, int(capacity["cpuCapacity"]) // 2), "memoryMiB": max(1, int(capacity["memoryCapacityMiB"]) // 2), "maxParallelJobs": 1}
        return {**capacity, **(json.loads(row[0]) if row else defaults)}

    def configure(self, values: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(values, dict) or not set(values) <= {"vcpus", "memoryMiB", "maxParallelJobs"}:
            raise ResourceError("Choose CPU, memory, and parallel-job limits only.")
        selected = {key: value for key, value in self.settings().items() if key in {"vcpus", "memoryMiB", "maxParallelJobs"}}
        selected.update(values)
        capacity = self.capacity()
        memory_minimum = min(1024, int(capacity["memoryCapacityMiB"]))
        for key, minimum, maximum in (("vcpus", 1, int(capacity["cpuCapacity"])), ("memoryMiB", memory_minimum, int(capacity["memoryCapacityMiB"])), ("maxParallelJobs", 1, int(capacity["cpuCapacity"]))):
            if type(selected[key]) is not int or not minimum <= selected[key] <= maximum:
                raise ResourceError(f"{key} must be a whole number from {minimum} to {maximum}.")
        # Already admitted jobs retain their exact grants. A lower setting changes
        # only admission of subsequent jobs; it never rewrites an active record.
        with self._db() as db:
            db.execute("INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", (json.dumps(selected),))
        return self.settings()

    def reserve(self, job_id: str, vcpus: int | None = None, memory_mib: int | None = None) -> dict[str, Any]:
        if not isinstance(job_id, str) or not job_id or len(job_id) > 128 or any(ord(c) < 32 for c in job_id):
            raise ResourceError("A local job needs a valid persistent identity.")
        selected = self.settings()
        cpu = selected["vcpus"] if vcpus is None else vcpus
        memory = selected["memoryMiB"] if memory_mib is None else memory_mib
        if type(cpu) is not int or type(memory) is not int or not 1 <= cpu <= selected["vcpus"] or not 1 <= memory <= selected["memoryMiB"]:
            raise ResourceError("The job exceeds the selected local CPU or memory budget.")
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM jobs WHERE id=?", (job_id,)).fetchone():
                raise ResourceError("This job already has an execution record. Recovery must be chosen explicitly.")
            active = db.execute("SELECT COUNT(*),COALESCE(SUM(vcpus),0),COALESCE(SUM(memory),0) FROM jobs WHERE status IN ('running','recovery-required')").fetchone()
            if active[0] >= selected["maxParallelJobs"] or active[1] + cpu > selected["vcpus"] or active[2] + memory > selected["memoryMiB"]:
                raise ResourceError("The local compute budget is reserved by active jobs. Keep this job queued until resources are released.", "RESOURCE_BUSY")
            db.execute("INSERT INTO jobs VALUES(?,?,?,'running',NULL,NULL,NULL,?)", (job_id, cpu, memory, time.time()))
        return self.job(job_id)

    def job(self, job_id: str) -> dict[str, Any]:
        with self._db() as db:
            record = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not record:
            raise ResourceError("Local job reservation was not found.")
        value = dict(record)
        value["memoryMiB"] = value.pop("memory")
        return value

    def attach(self, job_id: str, pid: int) -> None:
        if type(pid) is not int or pid <= 1 or pid == os.getpid():
            raise ResourceError("A solver process must be a separate child with a valid PID.")
        try:
            process = psutil.Process(pid)
            identity = process.create_time()
            if os.getpid() not in {ancestor.pid for ancestor in process.parents()}:
                raise ResourceError("The scheduler can attach only processes started by this local application.")
        except psutil.Error as error:
            raise ResourceError("The solver process could not be identified.") from error
        with self._db() as db:
            changed = db.execute("UPDATE jobs SET pid=?,created=?,updated=? WHERE id=? AND status='running' AND pid IS NULL", (pid, identity, time.time(), job_id)).rowcount
        if changed != 1:
            raise ResourceError("The job has no unbound active reservation.")

    def release(self, job_id: str, status: str, reason: str | None = None) -> None:
        if status not in {"completed", "failed", "cancelled", "interrupted"}:
            raise ResourceError("Choose a valid terminal job status.")
        with self._db() as db:
            db.execute("UPDATE jobs SET status=?,reason=?,updated=? WHERE id=? AND status IN ('running','recovery-required')", (status, str(reason)[:2000] if reason else None, time.time(), job_id))

    @staticmethod
    def _process(record: dict[str, Any]):
        if not record.get("pid"):
            return None
        try:
            process = psutil.Process(record["pid"])
            if not math.isclose(process.create_time(), record["created"], rel_tol=0, abs_tol=0.001) or process.status() == psutil.STATUS_ZOMBIE:
                return None
            return process
        except psutil.Error:
            return None

    @staticmethod
    def _stop(process) -> None:
        try:
            children = process.children(recursive=True)
            identities = [(child, child.create_time()) for child in children] + [(process, process.create_time())]
            for child, created in reversed(identities):
                try:
                    if child.create_time() == created:
                        child.terminate()
                except psutil.Error:
                    pass
            _, alive = psutil.wait_procs([child for child, _ in identities], timeout=5)
            for child in alive:
                try:
                    if any(child.pid == saved.pid and child.create_time() == created for saved, created in identities):
                        child.kill()
                except psutil.Error:
                    pass
            psutil.wait_procs(alive, timeout=5)
        except psutil.NoSuchProcess:
            pass

    def cancel(self, job_id: str) -> dict[str, Any]:
        record = self.job(job_id)
        if record["status"] in {"running", "recovery-required"}:
            process = self._process(record)
            if process:
                self._stop(process)
            self.release(job_id, "cancelled", "Cancelled by the user; scratch and checkpoints were retained.")
        return self.job(job_id)

    def poll(self) -> list[dict[str, Any]]:
        with self._db() as db:
            active = [dict(row) for row in db.execute("SELECT * FROM jobs WHERE status IN ('running','recovery-required') AND pid IS NOT NULL")]
        stopped: list[dict[str, Any]] = []
        for record in active:
            process = self._process(record)
            if process is None:
                # The worker still needs to verify and transfer terminal output.
                # Its explicit release acknowledges that result. On core restart,
                # a missing runner becomes interrupted and cannot auto-relaunch.
                continue
            try:
                rss = sum(child.memory_info().rss for child in [process, *process.children(recursive=True)] if child.is_running())
                if rss > record["memory"] * 1024**2:
                    self._stop(process)
                    self.release(record["id"], "failed", f"Observed process-tree RSS exceeded the {record['memory']} MiB local memory budget. This budget is enforced by a watchdog, not an OS hard limit.")
                    stopped.append(self.job(record["id"]))
            except psutil.NoSuchProcess:
                continue
        return stopped
