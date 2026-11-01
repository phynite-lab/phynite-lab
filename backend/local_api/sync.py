"""Durable opt-in project sync. Authentication never enables a project implicitly."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from .cloud_client import CloudError

from backend.local_api.domain.project_sync import canonical, validate_snapshot, MAX_CHUNK_BYTES


class SyncStore:
    def __init__(self, data_dir: Path):
        self.root = Path(data_dir).resolve() / "sync"
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.chunks = self.root / "chunks"
        self.chunks.mkdir(mode=0o700, exist_ok=True)
        self.path = self.root / "state.sqlite"
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in {0, 1}:
                raise RuntimeError("This sync database requires a newer Phynite Lab version. Data was retained.")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS projects (
                    account TEXT NOT NULL, project TEXT NOT NULL, remote TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
                    sha256 TEXT, state TEXT NOT NULL DEFAULT 'local', message TEXT,
                    PRIMARY KEY(account, project), UNIQUE(account, remote)
                );
                CREATE TABLE IF NOT EXISTS outbox (
                    account TEXT NOT NULL, project TEXT NOT NULL, generation TEXT NOT NULL,
                    snapshot TEXT NOT NULL, base_revision INTEGER NOT NULL, created REAL NOT NULL,
                    PRIMARY KEY(account, project)
                );
                PRAGMA user_version=1;
            """)
        self.path.chmod(0o600)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=30000")
        db.execute("BEGIN IMMEDIATE")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def enable(self, account: str, project: str, remote_project: str | None = None) -> dict[str, Any]:
        if not account or not project:
            raise ValueError("Choose a cloud account and local project before enabling sync.")
        remote = remote_project or project
        with self.connection() as db:
            previous = db.execute("SELECT * FROM projects WHERE account=? AND project=?", (account, project)).fetchone()
            if previous and previous["remote"] != remote:
                raise ValueError("This local project is already mapped to another cloud project.")
            db.execute("INSERT INTO projects(account,project,remote,enabled,state) VALUES(?,?,?,1,'pending') ON CONFLICT(account,project) DO UPDATE SET enabled=1,state=CASE WHEN state='conflict' THEN state ELSE 'pending' END,message=NULL", (account, project, remote))
        return self.status(account, project)

    def disable(self, account: str, project: str) -> None:
        with self.connection() as db:
            db.execute("UPDATE projects SET enabled=0,state='local',message=NULL WHERE account=? AND project=?", (account, project))
            db.execute("DELETE FROM outbox WHERE account=? AND project=?", (account, project))

    def status(self, account: str, project: str) -> dict[str, Any]:
        with self.connection() as db:
            row = db.execute("SELECT * FROM projects WHERE account=? AND project=?", (account, project)).fetchone()
        if row is None:
            return {"account": account, "project": project, "enabled": False, "state": "local", "revision": 0}
        return {**dict(row), "enabled": bool(row["enabled"])}

    def list(self, account: str) -> list[dict[str, Any]]:
        with self.connection() as db:
            rows = db.execute("SELECT * FROM projects WHERE account=? ORDER BY project", (account,)).fetchall()
        return [{**dict(row), "enabled": bool(row["enabled"])} for row in rows]

    def deletion_checkpoint(self, project: str) -> list[dict[str, Any]]:
        with self.connection() as db:
            mappings = db.execute("SELECT * FROM projects WHERE project=? AND enabled=1", (project,)).fetchall()
            return [{"mapping": dict(row), "outbox": dict(pending) if (pending := db.execute("SELECT * FROM outbox WHERE account=? AND project=?", (row["account"], project)).fetchone()) else None} for row in mappings]

    def restore_checkpoint(self, checkpoint: list[dict[str, Any]]) -> None:
        with self.connection() as db:
            for entry in checkpoint:
                row, pending = entry["mapping"], entry["outbox"]
                db.execute("UPDATE projects SET enabled=?,revision=?,sha256=?,state=?,message=? WHERE account=? AND project=?", (row["enabled"], row["revision"], row["sha256"], row["state"], row["message"], row["account"], row["project"]))
                db.execute("DELETE FROM outbox WHERE account=? AND project=?", (row["account"], row["project"]))
                if pending:
                    db.execute("INSERT INTO outbox VALUES(?,?,?,?,?,?)", tuple(pending[key] for key in ("account", "project", "generation", "snapshot", "base_revision", "created")))

    def stage_chunk(self, source: Path, digest: str, size: int) -> None:
        if not 0 <= size <= MAX_CHUNK_BYTES:
            raise ValueError("Split large files into bounded transfer chunks before syncing.")
        destination = self.chunks / digest
        if source.is_symlink() or not source.is_file():
            raise CloudError(409, "SYNC_LOCAL_INTEGRITY", "A project input is missing or is a symbolic link.")
        temporary = self.chunks / (".staging-" + secrets.token_hex(16))
        try:
            sha = hashlib.sha256()
            count = 0
            with source.open("rb") as handle, temporary.open("xb") as output:
                while chunk := handle.read(1024**2):
                    count += len(chunk)
                    if count > size:
                        raise CloudError(409, "SYNC_LOCAL_INTEGRITY", "An input changed while preparing its snapshot.")
                    sha.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if count != size or sha.hexdigest() != digest:
                raise CloudError(409, "SYNC_LOCAL_INTEGRITY", "An input changed while preparing its snapshot.")
            temporary.chmod(0o600)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def enqueue(self, account: str, project: str, snapshot: dict[str, Any], sources: dict[str, Path]) -> str:
        mapping = self.status(account, project)
        if not mapping["enabled"]:
            raise CloudError(409, "SYNC_DISABLED", "Enable Cloud Sync for this project before uploading it.")
        raw = validate_snapshot(snapshot, mapping["remote"])
        for artifact in snapshot["artifacts"]:
            source = sources.get(artifact["sha256"])
            if source is None:
                raise CloudError(409, "SYNC_LOCAL_INTEGRITY", "A snapshot transfer chunk is missing.")
            self.stage_chunk(Path(source), artifact["sha256"], artifact["sizeBytes"])
        generation = secrets.token_hex(16)
        with self.connection() as db:
            current = db.execute("SELECT * FROM projects WHERE account=? AND project=?", (account, project)).fetchone()
            if not current or not current["enabled"]:
                raise CloudError(409, "SYNC_DISABLED", "Cloud Sync was disabled while preparing the snapshot.")
            db.execute("INSERT INTO outbox VALUES(?,?,?,?,?,?) ON CONFLICT(account,project) DO UPDATE SET generation=excluded.generation,snapshot=excluded.snapshot,base_revision=excluded.base_revision,created=excluded.created", (account, project, generation, raw.decode(), current["revision"], time.time()))
            db.execute("UPDATE projects SET state=CASE WHEN state='conflict' THEN state ELSE 'pending' END,message=NULL WHERE account=? AND project=?", (account, project))
        return generation

    def pending(self, account: str, project: str) -> dict[str, Any] | None:
        with self.connection() as db:
            row = db.execute("SELECT o.*,p.remote FROM outbox o JOIN projects p ON p.account=o.account AND p.project=o.project WHERE o.account=? AND o.project=? AND p.enabled=1 AND p.state!='conflict'", (account, project)).fetchone()
        return {**dict(row), "snapshot": json.loads(row["snapshot"])} if row else None

    def mark(self, account: str, project: str, state: str, message: str | None = None) -> None:
        with self.connection() as db:
            db.execute("UPDATE projects SET state=?,message=? WHERE account=? AND project=? AND enabled=1", (state, message, account, project))

    def acknowledge(self, account: str, project: str, generation: str, revision: int, digest: str, *, deleted: bool = False) -> None:
        with self.connection() as db:
            db.execute("UPDATE projects SET revision=?,sha256=?,state=?,message=NULL WHERE account=? AND project=? AND enabled=1", (revision, digest, "trashed" if deleted else "synced", account, project))
            db.execute("DELETE FROM outbox WHERE account=? AND project=? AND generation=?", (account, project, generation))
            # A new edit queued during upload must be based on the head we just
            # published, without dropping its newer local snapshot.
            db.execute("UPDATE outbox SET base_revision=? WHERE account=? AND project=?", (revision, account, project))
            db.execute("UPDATE projects SET state='pending' WHERE account=? AND project=? AND enabled=1 AND EXISTS(SELECT 1 FROM outbox WHERE account=? AND project=?)", (account, project, account, project))


class SyncEngine:
    def __init__(self, store: SyncStore, cloud_client: Any):
        self.store, self.cloud = store, cloud_client
        self.lock = threading.RLock()

    def _active(self, account: str, project: str) -> dict[str, Any]:
        if self.cloud.account != account:
            raise CloudError(401, "CLOUD_ACCOUNT_CHANGED", "Reconnect this project's cloud account before syncing it.")
        mapping = self.store.status(account, project)
        if not mapping["enabled"]:
            raise CloudError(409, "SYNC_DISABLED", "Cloud Sync is disabled for this project.")
        return mapping

    def flush(self, account: str, project: str) -> dict[str, Any]:
        with self.lock:
            self._active(account, project)
            pending = self.store.pending(account, project)
            if pending is None:
                return self.store.status(account, project)
            self.store.mark(account, project, "syncing")
            prefix = f"/v1/sync/projects/{pending['remote']}"
            try:
                prepared = self.cloud.request(account, "POST", prefix + "/prepare", {"baseRevision": pending["base_revision"], "snapshot": pending["snapshot"]})
                artifacts = {entry["sha256"]: entry for entry in pending["snapshot"]["artifacts"]}
                for upload in prepared["uploads"]:
                    self._active(account, project)
                    artifact = artifacts.get(upload["sha256"])
                    if artifact is None or upload["sizeBytes"] != artifact["sizeBytes"]:
                        raise CloudError(502, "SYNC_TRANSFER_INVALID", "Cloud requested an artifact outside this snapshot.")
                    source = self.store.chunks / artifact["sha256"]
                    data = source.read_bytes()
                    if len(data) != artifact["sizeBytes"] or hashlib.sha256(data).hexdigest() != artifact["sha256"]:
                        raise CloudError(409, "SYNC_LOCAL_INTEGRITY", "A staged transfer chunk changed. Prepare a new snapshot.")
                    self.cloud.put_chunk(upload, data)
                self._active(account, project)
                result = self.cloud.request(account, "POST", prefix + "/commit", {"prepareId": prepared["prepareId"]})
                digest = hashlib.sha256(canonical(pending["snapshot"])).hexdigest()
                if result.get("sha256") != digest or type(result.get("revision")) is not int or result["revision"] <= pending["base_revision"]:
                    raise CloudError(502, "SYNC_REMOTE_INTEGRITY", "Cloud acknowledgement does not match this snapshot.")
                self.store.acknowledge(account, project, pending["generation"], result["revision"], digest, deleted=pending["snapshot"].get("deleted", False))
            except CloudError as exc:
                self.store.mark(account, project, "conflict" if exc.code == "SYNC_CONFLICT" else "error", str(exc))
                raise
            except OSError:
                self.store.mark(account, project, "error", "Local transfer data is unavailable. Prepare a new snapshot.")
                raise CloudError(409, "SYNC_LOCAL_INTEGRITY", "Local transfer data is unavailable. Prepare a new snapshot.") from None
            return self.store.status(account, project)

    def pull(self, account: str, project: str, apply_snapshot: Callable[[dict[str, Any], dict[str, Path]], None], *, _confirmed_replace: bool = False) -> dict[str, Any]:
        """Call only at a clean local revision or after explicit conflict choice.

        apply_snapshot must atomically replace domain metadata after validating it;
        it receives only fully downloaded, checksum-verified immutable chunks.
        """
        with self.lock:
            mapping = self._active(account, project)
            with self.store.connection() as db:
                pending = db.execute("SELECT 1 FROM outbox WHERE account=? AND project=?", (account, project)).fetchone()
            if not _confirmed_replace and (pending or mapping["state"] == "conflict"):
                raise CloudError(409, "SYNC_LOCAL_CHANGES", "Push local changes or resolve this conflict before replacing the local project.")
            prefix = f"/v1/sync/projects/{mapping['remote']}"
            head = self.cloud.request(account, "GET", prefix + "/head")
            if not head.get("revision"):
                return self.store.status(account, project)
            result = self.cloud.request(account, "GET", prefix + f"/snapshots/{head['revision']}")
            snapshot = result["snapshot"]
            raw = validate_snapshot(snapshot, mapping["remote"])
            if hashlib.sha256(raw).hexdigest() != head.get("sha256") or result.get("sha256") != head.get("sha256"):
                raise CloudError(502, "SYNC_REMOTE_INTEGRITY", "Cloud snapshot failed its checksum.")
            downloads = {entry["sha256"]: entry["url"] for entry in result["downloads"]}
            sources: dict[str, Path] = {}
            for artifact in snapshot["artifacts"]:
                self._active(account, project)
                destination = self.store.chunks / artifact["sha256"]
                if destination.is_file() and destination.stat().st_size == artifact["sizeBytes"] and hashlib.sha256(destination.read_bytes()).hexdigest() == artifact["sha256"]:
                    sources[artifact["sha256"]] = destination
                    continue
                if artifact["sha256"] not in downloads:
                    raise CloudError(502, "SYNC_REMOTE_INTEGRITY", "Cloud snapshot is missing a transfer link.")
                data = self.cloud.download_chunk(downloads[artifact["sha256"]], artifact["sizeBytes"])
                if len(data) != artifact["sizeBytes"] or hashlib.sha256(data).hexdigest() != artifact["sha256"]:
                    raise CloudError(502, "SYNC_REMOTE_INTEGRITY", "Cloud transfer chunk failed its checksum.")
                temporary = self.store.chunks / (".download-" + secrets.token_hex(16))
                try:
                    temporary.write_bytes(data)
                    temporary.chmod(0o600)
                    os.replace(temporary, destination)
                finally:
                    temporary.unlink(missing_ok=True)
                sources[artifact["sha256"]] = destination
            self._active(account, project)
            apply_snapshot(snapshot, sources)
            with self.store.connection() as db:
                db.execute("DELETE FROM outbox WHERE account=? AND project=?", (account, project))
                db.execute("UPDATE projects SET revision=?,sha256=?,state=?,message=NULL WHERE account=? AND project=? AND enabled=1", (head["revision"], head["sha256"], "trashed" if snapshot.get("deleted") else "synced", account, project))
            return self.store.status(account, project)

    def resolve(self, account: str, project: str, choice: str, *, apply_snapshot: Callable[[dict[str, Any], dict[str, Path]], None] | None = None, copy_local: Callable[[], str] | None = None) -> dict[str, Any]:
        with self.lock:
            mapping = self._active(account, project)
            if mapping["state"] != "conflict":
                raise CloudError(409, "SYNC_NO_CONFLICT", "This project does not have a sync conflict.")
            if choice == "local":
                with self.store.connection() as db:
                    pending = db.execute("SELECT 1 FROM outbox WHERE account=? AND project=?", (account, project)).fetchone()
                if pending is None:
                    raise CloudError(409, "SYNC_LOCAL_UNAVAILABLE", "This project's local version is unavailable. Restore a local export or choose the cloud version.")
                head = self.cloud.request(account, "GET", f"/v1/sync/projects/{mapping['remote']}/head")
                with self.store.connection() as db:
                    db.execute("UPDATE outbox SET base_revision=? WHERE account=? AND project=?", (head["revision"], account, project))
                    db.execute("UPDATE projects SET state='pending',revision=? WHERE account=? AND project=?", (head["revision"], account, project))
                return self.flush(account, project)
            if choice not in {"cloud", "copy"} or apply_snapshot is None or (choice == "copy" and copy_local is None):
                raise ValueError("Choose local, cloud or copy and provide the atomic domain import callback.")
            copy_id = copy_local() if choice == "copy" and copy_local else None
            result = self.pull(account, project, apply_snapshot, _confirmed_replace=True)
            return {**result, **({"localCopyProjectId": copy_id} if copy_id else {})}
