"""Desktop control-plane facade for opt-in cloud, sync and user AI gateways."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .cloud_client import CloudClient, CloudError
from .cloud_compute import CloudCompute
from .gateway import GatewayRegistry
from .snapshots import build_project_snapshot
from .sync import SyncEngine, SyncStore
from .vault import CredentialVault

from backend.local_api.domain.phynite_core import ApiError, response
from backend.local_api.domain.project_sync import canonical


class DesktopConnections:
    def __init__(self, data_dir: Path, services: Any, *, cloud_config: dict[str, str] | None = None):
        self.root = Path(data_dir).resolve()
        self.services = services
        self.vault = CredentialVault(self.root)
        self.gateway = GatewayRegistry(self.root, self.vault)
        self.store = SyncStore(self.root)
        config = cloud_config or {"apiOrigin": os.environ.get("PHYNITE_CLOUD_API_URL", ""), "region": os.environ.get("PHYNITE_CLOUD_AWS_REGION", ""), "clientId": os.environ.get("PHYNITE_CLOUD_COGNITO_CLIENT_ID", "")}
        self.cloud = CloudClient(self.vault, config["apiOrigin"], region=config["region"], client_id=config["clientId"]) if all(config.get(key) for key in ("apiOrigin", "region", "clientId")) else None
        self.sync = SyncEngine(self.store, self.cloud) if self.cloud else None
        self.compute = CloudCompute(self.root, self.cloud) if self.cloud else None
        self.closed = threading.Event()
        self.thread: threading.Thread | None = None
        self.lock = threading.RLock()
        self.state_path = self.root / "cloud-connection.json"
        self.resume_account: str | None = None
        self.resume_attempt = 0.0
        if self.state_path.exists():
            value = json.loads(self.state_path.read_text())
            if isinstance(value.get("account"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value["account"]):
                self.resume_account = value["account"]

    def _save_account(self, account: str | None) -> None:
        temporary = self.state_path.with_suffix(".tmp")
        with temporary.open("w") as handle:
            json.dump({"account": account}, handle)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, self.state_path)
        self.resume_account = account

    def _connected(self) -> tuple[CloudClient, str]:
        if not self.cloud:
            raise CloudError(503, "CLOUD_NOT_CONFIGURED", "This build needs its Phynite Cloud service configuration before connecting.")
        if not self.cloud.account or not self.cloud.status()["connected"]:
            raise CloudError(401, "CLOUD_LOGIN_REQUIRED", "Sign in to Phynite Cloud to use this connection. Local work remains available.")
        return self.cloud, self.cloud.account

    def cloud_status(self) -> dict[str, Any]:
        state = self.cloud.status() if self.cloud else {"connected": False, "accountId": None, "credentialStorage": "os-keychain" if self.vault.persistent else "session-only"}
        return {**state, "configured": self.cloud is not None, "authenticated": state["connected"], "account": state.get("user", {}).get("email") if state.get("user") else state.get("accountId"), "persistent": self.vault.persistent}

    def gateway_status(self) -> dict[str, Any]:
        state = self.gateway.status()
        capabilities = state["capabilities"]["models"]
        return {**state, "models": [{"id": identifier, **capabilities.get(identifier, {"available": False})} for identifier in state["models"]]}

    def build(self, project_id: str, *, deleted: bool = False) -> tuple[dict[str, Any], dict[str, Path]]:
        # SQLite's reentrant transaction serializes project metadata changes,
        # object publication and job submission while the snapshot is collected.
        with self.services.table.atomic():
            return build_project_snapshot(self.services, self.services.owner, project_id, self.root / "sync" / "staging", deleted=deleted)

    def _apply(self, snapshot: dict[str, Any], sources: dict[str, Path]) -> dict[str, Any]:
        from .archives import restore_snapshot
        if not snapshot.get("deleted"):
            return restore_snapshot(self.services, snapshot, sources, as_copy=False)
        cloud, account = self._connected()
        mapping = self.store.status(account, snapshot["projectId"])
        head = cloud.request(account, "GET", f"/v1/sync/projects/{mapping['remote']}/head")
        deadline = head.get("trashUntilEpoch")
        if type(deadline) is not int or deadline <= time.time():
            raise CloudError(410, "SYNC_TRASH_EXPIRED", "This project's 15-day Trash window expired. Restore a retained local export as a new project.")
        with self.services.table.atomic():
            result = restore_snapshot(self.services, {**snapshot, "deleted": False}, sources, as_copy=False)
            self.services.update_item(self.services.owner, "PROJECT", snapshot["projectId"], {"trashed": True, "trashUntilEpoch": deadline})
        return {**result, "trashed": True, "trashUntilEpoch": deadline}

    def before_project_delete(self, project_id: str) -> list[dict[str, Any]]:
        """Stage recoverable tombstones without networking, even while signed out.

        Prefer project_deletion() to keep the checkpoint and local deletion
        serialized and to restore the previous outbox when deletion fails.
        """
        checkpoint = self.store.deletion_checkpoint(project_id)
        try:
            if checkpoint:
                snapshot, sources = self.build(project_id, deleted=True)
                for entry in checkpoint:
                    self.store.enqueue(entry["mapping"]["account"], project_id, snapshot, sources)
        except BaseException:
            self.store.restore_checkpoint(checkpoint)
            raise
        return checkpoint

    @contextmanager
    def project_deletion(self, project_id: str):
        with self.lock:
            checkpoint = self.before_project_delete(project_id)
            try:
                yield
            except BaseException:
                self.store.restore_checkpoint(checkpoint)
                raise

    def _local_snapshot(self, project_id: str) -> tuple[dict[str, Any] | None, dict[str, Path]]:
        try:
            snapshot, sources = self.build(project_id)
            if any(record.get("entityType") == "PROJECT" and record.get("trashed") for record in snapshot["document"].get("records", [])):
                return None, {}
            return snapshot, sources
        except CloudError as exc:
            if exc.code != "LOCAL_PROJECT_NOT_FOUND":
                raise
            return None, {}

    def _reject_changed_local(self, account: str, project_id: str, snapshot: dict[str, Any] | None, sources: dict[str, Path]) -> None:
        if snapshot is not None:
            self.store.enqueue(account, project_id, snapshot, sources)
        self.store.mark(account, project_id, "conflict", "Local changes need an explicit choice before downloading the cloud project.")
        raise CloudError(409, "SYNC_CONFLICT", "This project has local changes. Choose local, cloud or save a copy before replacing either version.")

    def _apply_clean(self, account: str, project_id: str, expected_digest: str | None, snapshot: dict[str, Any], sources: dict[str, Path]) -> dict[str, Any]:
        # A user may edit while verified chunks are downloading. Recheck under
        # the same metadata transaction used by the atomic domain importer.
        with self.services.table.atomic():
            current, local_sources = self._local_snapshot(project_id)
            digest = hashlib.sha256(canonical(current)).hexdigest() if current is not None else None
            if digest != expected_digest:
                self._reject_changed_local(account, project_id, current, local_sources)
            return self._apply(snapshot, sources)

    def _copy(self, project_id: str) -> str:
        from .archives import restore_snapshot
        snapshot, sources = self.build(project_id)
        result = restore_snapshot(self.services, snapshot, sources, as_copy=True)
        project = result.get("project") or {}
        identifier = result.get("projectId") or project.get("id")
        if not identifier:
            raise CloudError(500, "LOCAL_COPY_FAILED", "The project copy could not be verified. Resolve the conflict again after checking local storage.")
        return identifier

    def start(self) -> None:
        if self.thread is None:
            self.thread = threading.Thread(target=self._run, name="phynite-cloud-sync", daemon=True)
            self.thread.start()

    def _run(self) -> None:
        while not self.closed.wait(5):
            try:
                self.tick()
            except Exception:
                # Individual project states carry safe actionable errors. Do not
                # print endpoints, tokens, input payloads or private file paths.
                continue

    def tick(self) -> None:
        with self.lock:
            if not self.cloud or not self.sync:
                return
            if not self.cloud.account and self.resume_account and time.time() - self.resume_attempt >= 60:
                self.resume_attempt = time.time()
                self.cloud.resume(self.resume_account)
            if not self.cloud.account:
                return
            account = self.cloud.account
            for mapping in self.store.list(account):
                if self.closed.is_set() or not mapping["enabled"] or mapping["state"] == "conflict":
                    continue
                project_id = mapping["project"]
                try:
                    pending = self.store.pending(account, project_id)
                    if pending and pending["snapshot"].get("deleted"):
                        # A staged deletion is sent only after local deletion
                        # committed; a crash before that cannot delete cloud data.
                        if self.services.get_item(self.services.owner, "PROJECT", project_id) is None:
                            self.sync.flush(account, project_id)
                        continue
                    if mapping["state"] == "trashed":
                        head = self.cloud.request(account, "GET", f"/v1/sync/projects/{mapping['remote']}/head")
                        if head["revision"] != mapping["revision"] and not head.get("deleted"):
                            self.sync.pull(account, project_id, lambda value, paths: self._apply_clean(account, project_id, None, value, paths))
                        continue
                    snapshot, sources = self.build(project_id)
                    digest = hashlib.sha256(canonical(snapshot)).hexdigest()
                    if digest != mapping.get("sha256"):
                        pending = self.store.pending(account, project_id)
                        if pending is None or hashlib.sha256(canonical(pending["snapshot"])).hexdigest() != digest:
                            self.store.enqueue(account, project_id, snapshot, sources)
                        self.sync.flush(account, project_id)
                    else:
                        head = self.cloud.request(account, "GET", f"/v1/sync/projects/{mapping['remote']}/head")
                        if head["revision"] != mapping["revision"]:
                            self.sync.pull(account, project_id, lambda value, paths: self._apply_clean(account, project_id, digest, value, paths))
                except CloudError as exc:
                    if exc.code != "SYNC_PROJECT_BUSY":
                        self.store.mark(account, project_id, "conflict" if exc.code == "SYNC_CONFLICT" else "error", str(exc))

    def close(self) -> None:
        self.closed.set()
        if self.thread:
            self.thread.join(timeout=2)

    def handle(self, method: str, path: str, payload: dict[str, Any], query: dict[str, str] | None = None, *, internal: bool = False) -> dict[str, Any]:
        try:
            with self.lock:
                return response(200, self._handle(method, path, payload, query or {}, internal))
        except CloudError as exc:
            raise ApiError(exc.status, str(exc), exc.code) from None

    def _handle(self, method: str, path: str, payload: dict[str, Any], query: dict[str, str], internal: bool) -> dict[str, Any]:
        if path == "/__local/cloud" and method == "GET":
            return self.cloud_status()
        if path == "/__local/cloud/login" and method == "POST":
            if not self.cloud:
                raise CloudError(503, "CLOUD_NOT_CONFIGURED", "Phynite Cloud connection is not configured in this build.")
            self.cloud.login(payload.get("identifier"), payload.get("password"))
            self._save_account(self.cloud.account)
            return self.cloud_status()
        if path == "/__local/cloud/logout" and method == "POST":
            self.resume_account = None
            self._save_account(None)
            result = self.cloud.logout() if self.cloud else {"connected": False}
            return {**self.cloud_status(), **result}
        if path == "/__local/gateway/environment" and method == "GET":
            if not internal:
                raise CloudError(404, "NOT_FOUND", "This operation is only available to the local application server.")
            return self.gateway.environment()
        if path == "/__local/gateway":
            if method == "GET":
                return self.gateway_status()
            if method == "PUT":
                self.gateway.configure(payload.get("baseUrl"), payload.get("token"))
                return self.gateway_status()
            if method == "DELETE":
                self.gateway.disconnect()
                return self.gateway_status()
        if path == "/__local/gateway/discover" and method == "POST":
            self.gateway.discover()
            return self.gateway_status()
        if path == "/__local/gateway/probe" and method == "POST":
            self.gateway.probe(payload.get("modelId"))
            return self.gateway_status()
        if path == "/__local/sync" and method == "GET":
            cloud, account = self._connected()
            return {"projects": self.store.list(account), "cloudProjects": cloud.request(account, "GET", "/v1/sync/projects")["projects"]}
        match = re.fullmatch(r"/__local/sync/([A-Za-z0-9_-]{1,100})(?:/(preview|enable|disable|download|flush|resolve|restore))?", path)
        if match:
            cloud, account = self._connected()
            project_id, action = match.groups()
            if method == "GET" and not action:
                return self.store.status(account, project_id)
            if action == "preview" and method == "POST":
                snapshot, _ = self.build(project_id)
                storage = cloud.request(account, "GET", "/v1/account/usage")["usage"]["storage"]
                limit = storage.get("cloudQuotaBytes", storage.get("researchQuotaBytes"))
                capacity = {**storage, "limitBytes": limit}
                if type(limit) is int:
                    capacity["availableBytes"] = max(0, limit - int(storage.get("bytes", 0)) - int(storage.get("uploadReservedBytes", 0)))
                return {"projectId": project_id, "snapshotSha256": hashlib.sha256(canonical(snapshot)).hexdigest(), "artifactCount": len(snapshot["artifacts"]), "transferBytes": sum({item["sha256"]: item["sizeBytes"] for item in snapshot["artifacts"]}.values()), "missingAssets": snapshot["document"]["missingAssets"], "cloudStorage": capacity, "scope": "Project configuration, inputs, conversations and completed results. A complete local copy is retained."}
            if action == "enable" and method == "POST":
                snapshot, sources = self.build(project_id)
                if payload.get("confirmSha256") != hashlib.sha256(canonical(snapshot)).hexdigest():
                    raise CloudError(409, "SYNC_CONFIRMATION_REQUIRED", "Preview and confirm this project's upload scope before enabling Cloud Sync.")
                self.store.enable(account, project_id)
                self.store.enqueue(account, project_id, snapshot, sources)
                return self.store.status(account, project_id)
            if action == "disable" and method == "POST":
                self.store.disable(account, project_id)
                return self.store.status(account, project_id)
            if action == "download" and method == "POST":
                mapping = self.store.status(account, project_id)
                self.store.enable(account, project_id)
                current, sources = self._local_snapshot(project_id)
                digest = hashlib.sha256(canonical(current)).hexdigest() if current is not None else None
                if digest != mapping.get("sha256"):
                    self._reject_changed_local(account, project_id, current, sources)
                return self.sync.pull(account, project_id, lambda value, paths: self._apply_clean(account, project_id, digest, value, paths))
            if action == "flush" and method == "POST":
                pending = self.store.pending(account, project_id)
                if pending and pending["snapshot"].get("deleted") and self.services.get_item(self.services.owner, "PROJECT", project_id):
                    raise CloudError(409, "SYNC_DELETE_NOT_COMMITTED", "The local project deletion has not committed. Retry deletion before publishing its tombstone.")
                return self.sync.flush(account, project_id)
            if action == "resolve" and method == "POST":
                return self.sync.resolve(account, project_id, payload.get("choice"), apply_snapshot=self._apply, copy_local=lambda: self._copy(project_id))
            if action == "restore" and method == "POST":
                mapping = self.store.status(account, project_id)
                head = cloud.request(account, "GET", f"/v1/sync/projects/{mapping.get('remote', project_id)}/head")
                if not head.get("deleted") or int(head.get("trashUntilEpoch", 0)) <= time.time():
                    raise CloudError(410, "SYNC_TRASH_EXPIRED", "Choose a project still inside its 15-day Trash window.")
                current, sources = self._local_snapshot(project_id)
                if current is not None:
                    self.store.enable(account, project_id)
                    self._reject_changed_local(account, project_id, current, sources)
                self.store.enable(account, project_id)
                self.sync.pull(account, project_id, lambda value, paths: self._apply_clean(account, project_id, None, value, paths))
                with self.services.table.atomic():
                    self.services.update_item(self.services.owner, "PROJECT", project_id, {"trashed": False, "trashUntilEpoch": 0})
                    snapshot, sources = self.build(project_id)
                    self.store.enqueue(account, project_id, snapshot, sources)
                return self.sync.flush(account, project_id)
        if path.startswith("/__local/cloud/compute"):
            cloud, account = self._connected()
            if path == "/__local/cloud/compute" and method == "GET":
                return {"executions": self.compute.list(self.services)}
            if path == "/__local/cloud/compute/catalog" and method == "GET":
                result = cloud.request(account, "GET", "/v1/compute/catalog")
                try:
                    pilot = cloud.request(account, "GET", "/v1/account")["account"].get("pilotCompute")
                except CloudError:
                    pilot = {"available": False, "status": "unavailable"}
                return {**result, "pilot": pilot}
            if path == "/__local/cloud/compute/preview" and method == "POST":
                return self.compute.preview_calculation(self.services, payload.get("calculationId"), {key: payload[key] for key in ("cloudMode", "computeProfileId") if key in payload})
            match = re.fullmatch(r"/__local/cloud/compute/([a-f0-9]{32})(?:/(prepare|submit|cancel|download))?", path)
            if match:
                identifier, action = match.groups()
                if not action and method == "GET":
                    return self.compute.status(identifier)
                if action == "prepare" and method == "POST":
                    return self.compute.prepare(identifier, payload.get("confirmSha256"))
                if action == "submit" and method == "POST":
                    return self.compute.submit(identifier, payload.get("confirmSha256"), payload.get("confirmQuoteId"))
                if action == "cancel" and method == "POST":
                    return self.compute.cancel(identifier)
                if action == "download" and method == "POST":
                    return self.compute.import_results(self.services, identifier)
        raise CloudError(404, "NOT_FOUND", "This local connection operation was not found.")
