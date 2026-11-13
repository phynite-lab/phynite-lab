"""Loopback-only production control plane for the Phynite Lab CLI."""
from __future__ import annotations

import argparse
import base64
import hmac
import json
import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from contextlib import nullcontext
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(sys._MEIPASS) if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError, response
from backend.local_api.services import LocalServices
from backend.local_api.sqlite_store import StorageError


def loopback_origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or not parsed.port or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("The local UI must use an explicit loopback HTTP origin")
    return value.rstrip("/")


class DesktopApplication:
    def __init__(self, data_dir: Path, port: int, ui_origin: str):
        self.data_dir = data_dir.expanduser().resolve()
        self.ui_origin = loopback_origin(ui_origin); self.origin = f"http://127.0.0.1:{port}"
        self.services = LocalServices(self.data_dir, self.origin, self.ui_origin)
        from backend.local_api.archives import ProjectArchives
        self.archives = ProjectArchives(self.services)
        from backend.local_api.connections import DesktopConnections
        self.connections = DesktopConnections(self.data_dir, self.services)
        from backend.local_api.materials_project import MaterialsProjectConnection
        from backend.local_api.vault import CredentialVault
        # Isolate connection fallback state: a Cloud/gateway credential-store
        # failure must not hide a previously saved Materials Project key.
        self.materials_project = MaterialsProjectConnection(CredentialVault(self.data_dir))
        # Domain material import uses the same credential and fixed-origin
        # transport as the Crystal browser. No secret enters project metadata.
        self.services.materials_project_search = self.materials_project.search
        from backend.local_api.pseudopotentials import PseudopotentialManager
        self.pseudopotentials = PseudopotentialManager(self.data_dir)
        self.token = secrets.token_urlsafe(48)
        self.closed = threading.Event()
        from backend.local_api.mlip_runtime import MlipRuntime
        from backend.local_api.domain.ai_mlip import MlipJobs
        self.mlip = MlipRuntime(self.data_dir, None)
        self.services.mlip_runtime = self.mlip
        self.mlip_jobs = MlipJobs(PhyniteApi(self.services), self.mlip)

        from backend.local_api.domain.ai_campaign import CampaignSupervisor
        self.campaigns = CampaignSupervisor(PhyniteApi(self.services))

        from backend.local_api.domain.ai_discovery import DiscoverySupervisor
        self.discovery = DiscoverySupervisor(PhyniteApi(self.services))
        self.workers: list[subprocess.Popen] = []
        self.worker_slots: dict[subprocess.Popen, int] = {}
        self.worker_started: dict[subprocess.Popen, float] = {}
        self.worker_failures = 0
        self.worker_retry_at = 0.0
        self.hpc_workers: dict[str, subprocess.Popen] = {}
        self.hpc_worker_signatures: dict[str, str] = {}
        self.worker_environment: str | None = None
        self.runtime = self.scheduler = None
        # The legacy Python control-plane contract reads AI catalogues from
        # process environment variables. Serialize those short-lived AI
        # dispatches so concurrent browser requests cannot observe another
        # request's refreshed native/gateway catalogue.
        self.ai_environment_lock = threading.RLock()
        try:
            from backend.local_api.runtime import RuntimeManager
            from backend.local_api.scheduler import ResourceScheduler
        except ImportError:
            # The standalone assembler requires both modules. Keep persistence
            # independently testable while reporting compute as unavailable.
            pass
        else:
            manifest = ROOT / "backend/local_api/runtime-manifest.json"
            self.runtime = RuntimeManager(self.data_dir, manifest if manifest.is_file() else None)
            self.mlip.base = self.runtime

            self.services.discovery_runtime = self.runtime
            self.scheduler = ResourceScheduler(self.data_dir)

    def worker_job(self, headers, job_id: str) -> dict:
        if not hmac.compare_digest(headers.get('X-Phynite-Worker-Token', ''), self.services.worker_token):
            raise ApiError(403, 'Local worker authorization is required.', 'INVALID_WORKER_TOKEN')
        for kind in ('CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS'):
            item = self.services.get_item(self.services.owner, kind, job_id)
            if item:
                if item.get('ownerId') != self.services.owner or item.get('computeBackend') != 'LOCAL_MAC':
                    break
                return item
        raise ApiError(404, 'The owned local job was not found.', 'NOT_FOUND')

    def hpc_request(self, method: str, path: str, raw: bytes, headers, query: dict) -> dict:
        """Serve owner-scoped HPC profiles and immutable worker snapshots."""
        import re
        from backend.local_api.hpc_profiles import HpcProfileStore, detect_scratch_root, probe_profile, resolve_scratch_root, setup_cluster_venv

        store = HpcProfileStore(self.services)
        detect_scratch = path == "/__local/hpc/clusters/detect-scratch"
        snapshot = None if detect_scratch else re.fullmatch(r"/__local/hpc/clusters/([A-Za-z0-9][A-Za-z0-9_.@-]{0,95})/(?:snapshot|snapshots)/([a-f0-9]{64})", path)
        if snapshot and method == "GET":
            return response(200, {"profile": store.worker_snapshot(headers, snapshot[1], snapshot[2])})
        member = None if detect_scratch else re.fullmatch(r"/__local/hpc/clusters/([A-Za-z0-9][A-Za-z0-9_.@-]{0,95})", path)
        if member and method == "GET" and query.get("profileSha256"):
            return response(200, {"profile": store.worker_snapshot(headers, member[1], str(query["profileSha256"]))})
        if not self.authorized(headers):
            raise ApiError(401, "Open this workspace through the Phynite Lab launcher.", "LOCAL_SESSION_REQUIRED")

        if detect_scratch:
            if method != "POST":
                raise ApiError(405, "HPC method is not supported.", "METHOD_NOT_ALLOWED")
            payload = json.loads(raw or b"{}")
            if not isinstance(payload, dict):
                raise ApiError(400, "Invalid HPC connection payload.", "INVALID_HPC_PROFILE")
            connection_raw = payload.get("connection") if "connection" in payload else payload
            return response(200, {"scratchRoot": detect_scratch_root(connection_raw)})

        collection = path == "/__local/hpc/clusters"
        probe = re.fullmatch(r"/__local/hpc/clusters/([A-Za-z0-9][A-Za-z0-9_.@-]{0,95})/probe", path)
        setup_venv = re.fullmatch(r"/__local/hpc/clusters/([A-Za-z0-9][A-Za-z0-9_.@-]{0,95})/setup-venv", path)
        if collection and method == "GET":
            return response(200, {"clusters": store.list()})
        if collection and method == "POST":
            payload = json.loads(raw or b"{}")
            if not isinstance(payload, dict):
                raise ApiError(400, "Invalid HPC profile payload.", "INVALID_HPC_PROFILE")
            profile = store.save(resolve_scratch_root(payload), "cl-" + secrets.token_hex(12))
            return response(201, {"cluster": profile})
        if probe and method == "POST":
            profile = store.get(probe[1])
            if not profile:
                raise ApiError(404, "HPC profile was not found.", "HPC_PROFILE_NOT_FOUND")
            return response(200, {"probe": probe_profile(profile)})
        if setup_venv and method == "POST":
            payload = json.loads(raw or b"{}") if raw else {}
            if not isinstance(payload, dict) or set(payload) - {'venvPath'}:
                raise ApiError(400, 'Setup accepts only an optional absolute venvPath.', 'INVALID_HPC_PROFILE')
            custom_path = payload.get("venvPath")
            return response(200, setup_cluster_venv(store, setup_venv[1], custom_venv_path=custom_path))
        if not member:
            raise ApiError(404, "HPC route was not found.", "NOT_FOUND")
        identifier = member[1]
        if method == "GET":
            profile = store.get(identifier)
            if not profile:
                raise ApiError(404, "HPC profile was not found.", "HPC_PROFILE_NOT_FOUND")
            return response(200, {"cluster": profile})
        if method == "PUT":
            existing = store.get(identifier)
            if not existing:
                raise ApiError(404, "HPC profile was not found.", "HPC_PROFILE_NOT_FOUND")
            payload = json.loads(raw or b"{}")
            if not isinstance(payload, dict):
                raise ApiError(400, "Invalid HPC profile payload.", "INVALID_HPC_PROFILE")
            return response(200, {"cluster": store.save(resolve_scratch_root(payload, existing), identifier)})
        if method == "DELETE":
            if not store.delete(identifier):
                raise ApiError(404, "HPC profile was not found.", "HPC_PROFILE_NOT_FOUND")
            return response(200, {"deleted": True, "id": identifier})
        raise ApiError(405, "HPC method is not supported.", "METHOD_NOT_ALLOWED")

    def job_request(self, headers, job_id: str, action: str, payload: dict) -> dict:
        item = self.worker_job(headers, job_id)
        if not self.scheduler:
            raise ApiError(503, 'The scheduler is unavailable.', 'RUNTIME_UNAVAILABLE')
        if action == 'reserve':
            if item.get('status') not in {'RUNNING', 'CANCEL_REQUESTED'} or int(item.get('leaseExpiresAtEpoch', 0)) < time.time():
                raise ApiError(409, 'The local job lease is no longer active.', 'LEASE_EXPIRED')
            cpu, memory = payload.get('vcpus'), payload.get('memoryMiB')
            if cpu != int(item.get('vcpus') or 1) or memory != int(item.get('memoryMiB') or 2048):
                raise ApiError(400, 'Resources differ from the accepted scientific job.', 'INVALID_RESOURCES')
            from backend.local_api.scheduler import ResourceError
            try:
                try:
                    existing = self.scheduler.job(job_id)
                except ResourceError:
                    existing = None
                if existing and existing['status'] == 'running':
                    if existing['vcpus'] != cpu or existing['memoryMiB'] != memory:
                        raise ApiError(409, 'The active reservation differs from this job.', 'RESOURCE_CONFLICT')
                    grant = existing
                else:
                    grant = self.scheduler.reserve(job_id, cpu, memory)
                return response(200, {'reserved': True, 'reservation': grant})
            except ResourceError as error:
                if error.code == 'RESOURCE_BUSY':
                    return response(200, {'reserved': False, 'queued': True})
                raise ApiError(400, str(error), error.code) from error
        if action == 'attach':
            if item.get('status') not in {'RUNNING', 'CANCEL_REQUESTED'}:
                raise ApiError(409, 'The local job is no longer running.', 'JOB_STOPPED')
            self.scheduler.attach(job_id, payload.get('pid'))
        elif action == 'release':
            self.scheduler.release(job_id, payload.get('status'), payload.get('reason'))
        elif action != 'status':
            raise ApiError(404, 'Unknown local job operation.', 'NOT_FOUND')
        return response(200, {'reservation': self.scheduler.job(job_id)})

    def _stop_process(self, process: subprocess.Popen) -> None:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)

    def maintain_hpc_workers(self) -> None:
        """Keep one affinity-pinned remote QE worker per configured profile."""
        import re
        from backend.local_api.hpc_profiles import HpcProfileStore

        profiles = [profile for profile in HpcProfileStore(self.services).list()
                    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}", str(profile.get("id", "")))
                    and re.fullmatch(r"[a-f0-9]{64}", str(profile.get("profileSha256", "")))]
        # Updating a profile must not kill a worker polling an older frozen
        # allocation. Keep those snapshots alive through the terminal receipt.
        store = HpcProfileStore(self.services)
        checksums = {profile["profileSha256"] for profile in profiles}
        for job in self.services.list_owner_items(self.services.owner, 'CALCULATION'):
            checksum = (job.get('executionAffinity') or {}).get('profileSha256')
            if job.get('status') in {'PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'} and checksum and checksum not in checksums:
                snapshot = store.snapshot_by_checksum(checksum)
                if snapshot:
                    profiles.append(snapshot)
                    checksums.add(checksum)
        desired = {f"{profile['id']}-{profile['profileSha256']}": str(profile["profileSha256"]) for profile in profiles}
        for identifier, process in list(self.hpc_workers.items()):
            if identifier not in desired or self.hpc_worker_signatures.get(identifier) != desired[identifier] or process.poll() is not None:
                self._stop_process(process)
                self.hpc_workers.pop(identifier, None)
                self.hpc_worker_signatures.pop(identifier, None)

        log_dir = self.data_dir / "logs"
        log_dir.mkdir(mode=0o700, exist_ok=True)
        base_command = [sys.executable, "--worker"] if getattr(sys, "frozen", False) else [sys.executable, str(Path(__file__).resolve()), "--worker"]
        for profile in profiles:
            identifier, checksum = str(profile["id"]), str(profile["profileSha256"])
            worker_key = f"{identifier}-{checksum}"
            if worker_key in self.hpc_workers:
                continue
            work_dir = self.data_dir / "work" / "hpc" / f"{identifier}-{checksum[:12]}"
            log_path = log_dir / f"hpc-{identifier}-{checksum[:12]}.log"
            command = [*base_command, "--runtime", "native", "--api-url", self.origin, "--work-dir", str(work_dir), "--pseudo-root", str(self.data_dir / "pseudopotentials"), "--poll-seconds", "10", "--timeout-seconds", "86400", "--hpc-cluster-id", identifier, "--hpc-profile-sha256", checksum]
            env = {key: value for key, value in os.environ.items() if not key.startswith("PHYNITE_HPC_")}
            env.update({"PHYNITE_APP_MODE": "local", "PHYNITE_DATA_DIR": str(self.data_dir), "PHYNITE_API_URL": self.origin, "PHYNITE_LOCAL_WORKER_TOKEN": self.services.worker_token})
            with log_path.open("ab") as output:
                process = subprocess.Popen(command, env=env, stdout=output, stderr=subprocess.STDOUT)
            self.hpc_workers[worker_key] = process
            self.hpc_worker_signatures[worker_key] = checksum

    def stop_workers(self, *, include_hpc: bool = True):
        for process in self.workers:
            self._stop_process(process)
        if include_hpc:
            for process in self.hpc_workers.values():
                self._stop_process(process)
            self.hpc_workers.clear()
            self.hpc_worker_signatures.clear()
        self.workers.clear()
        self.worker_slots.clear()
        self.worker_started.clear()

    def maintain_workers(self, environment: dict, maximum: int, active: bool):
        now = time.monotonic()
        failed = [process for process in self.workers if process.poll() is not None]
        for process in failed:
            if now - self.worker_started.pop(process, now) >= 60:
                self.worker_failures = 0
            self.worker_slots.pop(process, None)
        self.workers = [process for process in self.workers if process not in failed]
        if failed:
            self.worker_failures += 1
            self.worker_retry_at = now + min(60, 2 ** min(self.worker_failures, 6))
            if not self.workers:
                self.services.compute_enabled = any(process.poll() is None for process in self.hpc_workers.values())
                self.services.update_item(self.services.owner, 'PERSONAL_WORKER', 'primary', {'lastSeenAtEpoch': 0})
        signature = json.dumps(environment, sort_keys=True)
        changed = self.worker_environment != signature
        if changed or len(self.workers) > maximum:
            if active:
                return
            self.stop_workers(include_hpc=False)
            self.worker_environment = signature
            if changed:
                self.worker_failures = 0
                self.worker_retry_at = 0
        if now < self.worker_retry_at:
            return
        while len(self.workers) < maximum:
            used = {self.worker_slots.get(process, index) for index, process in enumerate(self.workers)}
            slot = next(index for index in range(maximum) if index not in used)
            command = [sys.executable, '--worker'] if getattr(sys, 'frozen', False) else [sys.executable, str(Path(__file__).resolve()), '--worker']
            env = {**os.environ, **environment, 'PHYNITE_APP_MODE': 'local', 'PHYNITE_DATA_DIR': str(self.data_dir), 'PHYNITE_API_URL': self.origin, 'PHYNITE_LOCAL_WORKER_TOKEN': self.services.worker_token}
            log = self.data_dir / 'logs'
            log.mkdir(mode=0o700, exist_ok=True)
            try:
                with (log / f'worker-{slot}.log').open('ab') as output:
                    process = subprocess.Popen([*command, '--runtime', 'native', '--work-dir', str(self.data_dir / 'work' / f'worker-{slot}'), '--pseudo-root', str(self.data_dir / 'pseudopotentials'), '--poll-seconds', '2'], env=env, stdout=output, stderr=subprocess.STDOUT)
            except OSError:
                self.worker_failures += 1
                self.worker_retry_at = now + min(60, 2 ** min(self.worker_failures, 6))
                raise
            self.workers.append(process)
            self.worker_slots[process] = slot
            self.worker_started[process] = now

    def sync_personal_defaults(self, budget):
        """Browser run forms read account defaults. Keep a saved user choice while it
        fits the local admission budget; otherwise follow the budget."""
        from backend.local_api.domain.compute_preferences import budget_defaults
        account = self.services.get_item(self.services.owner, 'ACCOUNT', 'primary') or {}
        defaults = budget_defaults(self.services, account, budget)
        if account.get('personalDefaults') != defaults:
            self.services.update_item(self.services.owner, 'ACCOUNT', 'primary', {'personalDefaults': defaults})

    def maintain(self):
        while not self.closed.wait(1):
            try:
                self.mlip_jobs.tick()

                self.campaigns.tick()

                self.discovery.tick()
                self.maintain_hpc_workers()
                hpc_ready = any(process.poll() is None for process in self.hpc_workers.values())
                if not self.runtime or not self.scheduler:
                    self.services.compute_enabled = hpc_ready
                    continue
                self.scheduler.poll()
                self.services.reconcile_interrupted_jobs()
                worker = self.services.get_item(self.services.owner, 'PERSONAL_WORKER', 'primary') or {}
                personal_ready = 'qe' in worker.get('capabilities', []) and int(worker.get('lastSeenAtEpoch') or 0) > time.time() - 90
                self.services.compute_enabled = personal_ready or hpc_ready
                environment = self.runtime.environment()
                # Capability startup belongs to the worker; do not claim readiness
                # until the installed runtime passes the existing validation.
                import shutil
                path = environment.get('PATH', '')
                ready = shutil.which('pw.x', path=path) or shutil.which('lmp', path=path) or shutil.which('lammps', path=path) or environment.get('PHYNITE_RUNTIME_PYTHON')
                selected = self.scheduler.settings()
                self.sync_personal_defaults(selected)
                if not ready:
                    continue
                active = any(item.get('status') in {'RUNNING', 'CANCEL_REQUESTED'} for kind in ('CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS') for item in self.services.list_owner_items(self.services.owner, kind))
                # Replace crashed slots even while another job is running.
                # Failed startup uses bounded backoff; lease reconciliation
                # above still never replays interrupted scientific jobs.
                self.maintain_workers(environment, selected['maxParallelJobs'], active)
            except Exception as error:
                print(f'Local runtime monitor: {type(error).__name__}: {error}', file=sys.stderr, flush=True)

    def publish_transport(self):
        descriptor = os.open(self.data_dir / "core-service.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as output:
            json.dump({"token": self.token, "origin": self.origin, "uiOrigin": self.ui_origin}, output)
            output.flush(); os.fsync(output.fileno())

    def authorized(self, headers) -> bool:
        return hmac.compare_digest(headers.get("Authorization", ""), "Bearer " + self.token)

    def dispatch(self, method: str, path: str, raw: bytes, headers, query: dict) -> dict:
        if path == "/__local/health" and method == "GET":
            return response(200, {"ready": True, "environment": "local", "mode": "local"})
        import re
        hpc_snapshot = method == 'GET' and (bool(re.fullmatch(r"/__local/hpc/clusters/[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}/(?:snapshot|snapshots)/[a-f0-9]{64}", path)) or (bool(re.fullmatch(r"/__local/hpc/clusters/[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}", path)) and bool(query.get('profileSha256'))))
        worker = path.startswith(("/worker/v1/", "/md-worker/v1/", "/__local/jobs/")) or hpc_snapshot
        if not self.authorized(headers) and not worker:
            raise ApiError(401, "Open this workspace through the Phynite Lab launcher.", "LOCAL_SESSION_REQUIRED")
        import re
        archive_part = re.fullmatch(r'/__local/projects/imports/([a-f0-9]{32})/parts/([0-9]+)', path)
        if archive_part and method == 'PUT':
            return response(200, self.archives.upload(archive_part[1], int(archive_part[2]), raw))
        payload = json.loads(raw or b"{}")
        if path.startswith('/__local/notes/'):
            from backend.local_api.notes import ProjectNotes
            if not isinstance(payload, dict):
                raise ApiError(400, 'Invalid Notes payload.', 'NOTE_INVALID')
            return response(200, ProjectNotes(self.services).handle(self.services.owner, method, path[len('/__local/notes/'):].split('/'), payload))
        if path.startswith("/__local/hpc"):
            return self.hpc_request(method, path, raw, headers, query)
        recovery_status = re.fullmatch(r'/__local/jobs/([A-Za-z0-9_-]+)/recovery', path)
        if recovery_status and method == 'GET':
            if not self.authorized(headers):
                raise ApiError(401, 'Open this workspace through the Phynite Lab launcher.', 'LOCAL_SESSION_REQUIRED')
            from backend.local_api.result_recovery import recovery_status as status
            return response(200, status(self.services, recovery_status[1]))
        recover = re.fullmatch(r'/__local/jobs/([A-Za-z0-9_-]+)/recover', path)
        if recover and method == 'POST':
            # Job reservations use worker authentication. Importing retained
            # output instead requires the opaque local browser session.
            if not self.authorized(headers):
                raise ApiError(401, 'Open this workspace through the Phynite Lab launcher.', 'LOCAL_SESSION_REQUIRED')
            if payload != {}:
                raise ApiError(400, 'Result recovery accepts only the saved local job identity.', 'INVALID_RECOVERY_REQUEST')
            from backend.local_api.result_recovery import recover_result
            return recover_result(self.services, recover[1])
        export = re.fullmatch(r'/__local/projects/([A-Za-z0-9_-]+)/export', path)
        if export and method == 'POST':
            return response(200, self.archives.export(export[1]))
        if path == '/__local/projects/imports' and method == 'POST':
            return response(201, self.archives.begin(payload))
        complete = re.fullmatch(r'/__local/projects/imports/([a-f0-9]{32})/complete', path)
        if complete and method == 'POST':
            return response(201, self.archives.complete(complete[1]))
        if path.startswith('/__local/jobs/') and method == 'POST':
            import re
            match = re.fullmatch(r'/__local/jobs/([A-Za-z0-9_-]+)/([a-z]+)', path)
            if not match:
                raise ApiError(404, 'Invalid local job operation.', 'NOT_FOUND')
            return self.job_request(headers, match[1], match[2], payload)
        if path == "/__local/session" and method == "GET":
            return response(200, {**self.services.local_session(), 'cloud': self.connections.cloud_status()})
        if path == '/__local/crystals/standardize' and method == 'POST':
            from backend.local_api.crystal_cells import standardize_crystal
            return response(200, standardize_crystal(payload, self.runtime))
        if path == '/__local/materials-project':
            if method == 'GET':
                return response(200, self.materials_project.status())
            if method == 'PUT':
                return response(200, self.materials_project.save(payload))
            if method == 'DELETE':
                if payload != {}:
                    raise ApiError(400, 'API key removal accepts no extra fields.', 'MP_SETTINGS_INVALID')
                return response(200, self.materials_project.remove())
            raise ApiError(404, 'Unknown Materials Project operation.', 'NOT_FOUND')
        if path == '/__local/materials-project/test' and method == 'POST':
            if payload != {}:
                raise ApiError(400, 'Test the saved Materials Project API key without extra fields.', 'MP_SETTINGS_INVALID')
            return response(200, self.materials_project.test())
        if path == '/__local/materials-project/search' and method == 'GET':
            try:
                limit = int(query.get('limit', '12'))
            except (TypeError, ValueError):
                raise ApiError(400, 'Choose between one and thirty material records.', 'INVALID_MATERIAL_LIMIT') from None
            options = {key: query[key] for key in ('offset', 'sort', 'spaceGroup', 'minSites', 'maxSites', 'minBandGap', 'maxBandGap', 'maxEnergyAboveHull') if key in query}
            return response(200, self.materials_project.search(query.get('q'), limit, options))
        if path.startswith('/__local/materials-project/'):
            raise ApiError(404, 'Unknown Materials Project operation.', 'NOT_FOUND')
        if path == '/__local/mlip' and method == 'GET':
            return response(200, self.mlip.status())
        if path == '/__local/mlip/install' and method == 'POST':
            if payload != {'acceptModelLicense': True}:
                raise ApiError(400, 'Review the separate MLIP installation and model license.', 'MLIP_SETUP_REQUIRED')
            def install_mlip():
                try: self.mlip.install()
                except Exception: return  # precise failure is retained in setup progress
            threading.Thread(target=install_mlip, daemon=True).start()
            return response(202, {'accepted': True})
        if path == "/__local/runtime" and method == "GET":
            worker = self.services.get_item(self.services.owner, 'PERSONAL_WORKER', 'primary') or {}
            online = int(worker.get('lastSeenAtEpoch') or 0) > time.time() - 90
            return response(200, {"mode": "local", "identity": {"workspaceId": self.services.owner}, "cloud": self.connections.cloud_status(), "capabilities": {"editor": True, "persistence": "sqlite-filesystem", "solver": worker.get('capabilities', []) if online else [], "solverManifest": worker.get('runtimeManifest') if online else None}, "runtime": self.runtime.status() if self.runtime else {"downloadAvailable": False, "installed": {}, "error": "Compute runtime is not included in this build."}, "pseudopotentials": self.pseudopotentials.status(), "resources": self.scheduler.settings() if self.scheduler else None})
        if path in {'/__local/pseudopotentials/install', '/__local/runtime/pseudopotentials/install'} and method == 'POST':
            library = payload.get('library') if isinstance(payload, dict) else None
            if library not in {'precision', 'efficiency'} or set(payload) != {'library'}:
                raise ApiError(400, 'Choose the precision or efficiency SSSP PBE library.', 'INVALID_PSEUDOPOTENTIAL_LIBRARY')
            if not self.pseudopotentials.begin(library):
                raise ApiError(409, 'A pseudopotential installation is already running.', 'PSEUDOPOTENTIAL_INSTALL_BUSY')
            return response(202, {'accepted': True, 'library': library})
        if path == "/__local/runtime/install" and method == "POST":
            if not self.runtime:
                raise ApiError(503, "The runtime installer is not included in this build.", "RUNTIME_UNAVAILABLE")
            component = payload.get("component")
            if component not in {"dft", "md", "analysis"}:
                raise ApiError(400, "Choose DFT, MD, or analysis.", "INVALID_RUNTIME_COMPONENT")
            # The manager enforces installation locking; progress remains readable.
            def install():
                try:
                    self.runtime.install(component)
                except Exception:
                    # Manager records its precise error in progress; no success
                    # is inferred merely because the request was accepted.
                    return
            threading.Thread(target=install, daemon=True).start()
            return response(202, {"accepted": True, "component": component})
        if path == "/__local/resources" and method == "PUT":
            if not self.scheduler:
                raise ApiError(503, "The native scheduler is unavailable.", "RUNTIME_UNAVAILABLE")
            # A budget below the 1 GiB per-job minimum would admit no job. The scheduler itself keeps
            # accepting smaller budgets, which release qualification uses to test resource recovery.
            minimum = min(1024, int(self.scheduler.capacity()["memoryCapacityMiB"]))
            memory = payload.get("memoryMiB") if isinstance(payload, dict) else None
            if type(memory) is int and memory < minimum:
                raise ApiError(400, f"Set RAM to at least {minimum} MiB so a job can start.", "INVALID_RESOURCES")
            return response(200, {"resources": self.scheduler.configure(payload)})
        if path.startswith(("/__local/cloud", "/__local/sync")):
            return self.connections.handle(method, path, payload, query, internal=False)
        if path.startswith(("/public/", "/internal/", "/v1/developer/")):
            raise ApiError(404, "This endpoint is not part of the local workspace.", "NOT_FOUND")
        claims = {} if worker else {"sub": self.services.owner, "name": "Local Researcher"}
        if not worker:
            # Admission must agree with the validated capability shown by setup.
            # A worker can report readiness between two monitor ticks; caching
            # this flag until the next tick made an immediately submitted Run
            # incorrectly fail with COMPUTE_DISABLED.
            presence = self.services.get_item(self.services.owner, 'PERSONAL_WORKER', 'primary') or {}
            self.services.compute_enabled = ('qe' in presence.get('capabilities', []) and int(presence.get('lastSeenAtEpoch') or 0) > time.time() - 90) or any(process.poll() is None for process in self.hpc_workers.values())
        # Worker authorization state belongs to one request. Threaded HTTP
        # handlers must never share a mutable PhyniteApi instance. The AI
        # branch also refreshes process-global environment values, so hold its
        # lock through the handler call as well as the refresh.
        with (self.ai_environment_lock if path.startswith('/v1/ai/') else nullcontext()):
            if path.startswith('/v1/ai/'):
                # The launcher-owned native bridge is a separate loopback process.
                # Refresh its verified catalog for each AI mutation so the Python
                # control plane never trusts a stale model list after connect,
                # disconnect, or probe.
                native_url, native_token = os.environ.get('PHYNITE_LOCAL_AI_URL'), os.environ.get('PHYNITE_LOCAL_AI_TOKEN')
                if native_url and native_token:
                    try:
                        from urllib.parse import urlsplit
                        from urllib.request import Request, urlopen
                        parsed = urlsplit(native_url)
                        if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or not parsed.port:
                            raise ValueError('native bridge is not loopback')
                        request = Request(native_url.rstrip('/') + '/status', headers={'Authorization': f'Bearer {native_token}'})
                        with urlopen(request, timeout=2) as result:
                            status = json.loads(result.read(4 * 1024 * 1024))
                        models = [item.get('id') for item in status.get('models', []) if isinstance(item, dict) and isinstance(item.get('id'), str)]
                        capabilities = status.get('capabilities', {}).get('models', {}) if isinstance(status.get('capabilities'), dict) else {}
                        os.environ['PHYNITE_LOCAL_AI_MODELS'] = json.dumps(models)
                        os.environ['PHYNITE_LOCAL_AI_CAPABILITIES'] = json.dumps({'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'models': capabilities})
                    except Exception:
                        os.environ['PHYNITE_LOCAL_AI_MODELS'] = '[]'
                        os.environ['PHYNITE_LOCAL_AI_CAPABILITIES'] = json.dumps({'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'models': {}})
            event = {"rawPath": path, "body": raw.decode(), "headers": dict(headers), "queryStringParameters": query, "requestContext": {"http": {"method": method, "sourceIp": "127.0.0.1"}, "authorizer": {"jwt": {"claims": claims}}}}
            deletion = re.fullmatch(r'/v1/projects/([A-Za-z0-9_-]+)', path)
            if deletion and method == 'DELETE':
                with self.connections.project_deletion(deletion[1]):
                    return PhyniteApi(self.services).handle(event)
            return PhyniteApi(self.services).handle(event)

    def close(self):
        self.closed.set()
        for process in self.mlip_jobs.processes.values():
            if process.poll() is None: process.terminate()
        self.connections.close()
        self.stop_workers()
        if self.scheduler:
            self.scheduler.close()
        transport = self.data_dir / "core-service.json"
        try:
            if json.loads(transport.read_text()).get("token") == self.token:
                transport.unlink()
        except (OSError, ValueError):
            pass


def handler_for(application: DesktopApplication):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self):
            super().setup(); self.connection.settimeout(30)

        def log_message(self, *_):
            pass

        def send_result(self, result: dict):
            body = base64.b64decode(result["body"]) if result.get("isBase64Encoded") else result["body"].encode()
            self.send_response(result["statusCode"])
            for name, value in result.get("headers", {}).items():
                self.send_header(name, value)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def body(self, maximum: int) -> bytes:
            if self.headers.get("Transfer-Encoding"):
                raise ApiError(400, "Use a bounded Content-Length.", "INVALID_LENGTH")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "Invalid request length.", "INVALID_LENGTH") from None
            if not 0 <= length <= maximum:
                raise ApiError(413, "The local request is too large.", "REQUEST_TOO_LARGE")
            body = self.rfile.read(length)
            if len(body) != length:
                raise ApiError(400, "The upload was interrupted.", "UPLOAD_INTERRUPTED")
            return body

        def stream_body(self, maximum: int, expected: int | None = None):
            """Read a signed artifact directly from the socket in bounded chunks.

            The storage adapter performs checksum and atomic publication. This
            wrapper keeps large local result files out of process memory while
            preserving exact Content-Length and interrupted-upload checks.
            """
            if self.headers.get("Transfer-Encoding"):
                raise ApiError(400, "Use a bounded Content-Length.", "INVALID_LENGTH")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "Invalid request length.", "INVALID_LENGTH") from None
            if not 0 <= length <= maximum:
                raise ApiError(413, "The local request is too large.", "REQUEST_TOO_LARGE")
            if expected is not None and length != expected:
                raise ApiError(400, "The upload length differs from its signed reservation.", "UPLOAD_MISMATCH")

            remaining = length
            stream = self.rfile

            class RequestBody:
                def read(self, amount: int = -1):
                    nonlocal remaining
                    if remaining == 0:
                        return b""
                    wanted = remaining if amount is None or amount < 0 else min(amount, remaining)
                    chunk = stream.read(wanted)
                    if len(chunk) != wanted:
                        raise ApiError(400, "The upload was interrupted.", "UPLOAD_INTERRUPTED")
                    remaining -= len(chunk)
                    return chunk

            return RequestBody()

        def artifact(self, query: dict):
            ticket = application.services.s3.verify_ticket(query.get("ticket", [""])[0], self.command)
            params = ticket["params"]; operation = ticket["operation"]
            if operation == "get_object":
                allowed = {key: params[key] for key in ("Bucket", "Key", "VersionId") if key in params}
                if self.headers.get("Range"):
                    allowed["Range"] = self.headers["Range"]
                item = application.services.s3.get_object(**allowed)
                self.send_response(206 if "ContentRange" in item else 200)
                self.send_header("Content-Type", item["ContentType"]); self.send_header("Content-Length", str(item["ContentLength"]))
                self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff")
                if "ContentRange" in item:
                    self.send_header("Content-Range", item["ContentRange"])
                self.end_headers()
                with item["Body"] as body:
                    for chunk in body.iter_chunks():
                        self.wfile.write(chunk)
                return
            if operation == "post_object":
                data = self.body(64 * 1024 ** 2 + 64 * 1024)
            else:
                expected_length = params.get("ContentLength")
                if expected_length is not None and (type(expected_length) is not int or expected_length < 0):
                    raise ApiError(400, "The artifact reservation has no valid size.", "UPLOAD_MISMATCH")
                data = self.stream_body(64 * 1024 ** 3 if expected_length is not None else 64 * 1024 ** 2, expected_length)
            if operation == "post_object":
                message = BytesParser(policy=default).parsebytes(f"Content-Type: {self.headers.get('Content-Type', '')}\r\nMIME-Version: 1.0\r\n\r\n".encode() + data)
                fields = {}; file = None
                for part in message.iter_parts():
                    name = part.get_param("name", header="content-disposition")
                    if name == "file":
                        file = part.get_payload(decode=True)
                    else:
                        fields[name] = part.get_payload(decode=True).decode()
                if file is None or fields.get("key") != params["Key"] or any(fields.get(key) != value for key, value in params.get("Fields", {}).items()):
                    raise ApiError(400, "Upload fields differ from the authorized artifact.", "UPLOAD_MISMATCH")
                for condition in params.get("Conditions", []):
                    if isinstance(condition, list) and condition[0] == "content-length-range" and not condition[1] <= len(file) <= condition[2]:
                        raise ApiError(400, "Upload size differs from its reservation.", "UPLOAD_MISMATCH")
                params = {key: params[key] for key in ("Bucket", "Key")}
                params.update(ContentType=fields.get("Content-Type", "application/octet-stream"), Metadata={"sha256": fields.get("x-amz-meta-sha256", "")})
                data = file; operation = "put_object"
            header_checksum = self.headers.get("x-amz-checksum-sha256")
            if header_checksum:
                signed_checksum = params.get("ChecksumSHA256")
                if signed_checksum and not hmac.compare_digest(header_checksum, signed_checksum):
                    raise ApiError(400, "The upload checksum differs from its signed reservation.", "UPLOAD_MISMATCH")
                params["ChecksumSHA256"] = header_checksum
            params.pop("Fields", None); params.pop("Conditions", None)
            getattr(application.services.s3, operation)(**params, Body=data)
            self.send_response(200); self.send_header("Content-Length", "0"); self.end_headers()

        def run_request(self):
            try:
                expected_host = urlsplit(application.origin).netloc
                if self.headers.get("Host") != expected_host or self.headers.get("Origin") not in {None, application.ui_origin}:
                    raise ApiError(403, "Local request origin is not allowed.", "INVALID_ORIGIN")
                parsed = urlsplit(self.path); query = parse_qs(parsed.query)
                if parsed.path.startswith('/__local/projects/exports/') and self.command == 'GET':
                    if not application.authorized(self.headers):
                        raise ApiError(401, 'Open the local workspace through phynite-lab.', 'LOCAL_SESSION_REQUIRED')
                    path = application.archives.export_path(parsed.path.rsplit('/', 1)[-1])
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/zip')
                    self.send_header('Content-Disposition', 'attachment; filename="project.phynite"')
                    self.send_header('Content-Length', str(path.stat().st_size))
                    self.send_header('Cache-Control', 'no-store'); self.end_headers()
                    with path.open('rb') as archive:
                        while chunk := archive.read(1024**2):
                            self.wfile.write(chunk)
                    return
                if parsed.path == "/__local/artifacts":
                    self.artifact(query); return
                raw = self.body(10 * 1024 ** 2) if self.command not in {"GET", "HEAD"} else b""
                result = application.dispatch(self.command, parsed.path, raw, self.headers, {key: values[-1] for key, values in query.items()})
                self.send_result(result)
            except ApiError as error:
                self.send_result(response(error.status, {"error": error.message, "code": error.code}))
            except StorageError as error:
                code = error.response["Error"]["Code"]
                self.send_result(response(404 if code == "NoSuchKey" else 409 if code in {"ConditionalCheckFailedException", "TransactionCanceledException"} else 403, {"error": str(error), "code": code}))
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                self.send_result(response(400, {"error": "The local request is invalid.", "code": "INVALID_REQUEST"}))
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                print(f"Local request failed: {type(error).__name__}", file=sys.stderr, flush=True)
                self.send_result(response(500, {"error": "The local operation failed. Your saved data was retained.", "code": "LOCAL_SERVICE_ERROR"}))

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = run_request
    return Handler


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--qualify-science':
        from backend.local_api.qualification import main as qualification_main
        raise SystemExit(qualification_main(sys.argv[2:]))
    if len(sys.argv) > 1 and sys.argv[1] == '--worker':
        sys.path.insert(0, str(ROOT / 'backend/local_worker'))
        from backend.local_worker.worker import main as worker_main
        raise SystemExit(worker_main(sys.argv[2:]))
    if len(sys.argv) > 1 and sys.argv[1] == '--run-runner':
        import runpy
        runners = {'qe': 'compute/local_runner.py', 'md-analysis': 'md_local/analysis_runner.py', 'md-simulation': 'md_local/runner.py'}
        if len(sys.argv) != 3 or sys.argv[2] not in runners:
            raise SystemExit('Unknown scientific runner')
        runner = ROOT / 'backend' / runners[sys.argv[2]]
        sys.path.insert(0, str(runner.parent)); sys.argv = [str(runner)]
        runpy.run_path(str(runner), run_name='__main__'); return
    if len(sys.argv) > 1 and sys.argv[1] == '--sandbox-probe':
        from backend.local_api.sandbox import run_probe
        raise SystemExit(run_probe())
    if len(sys.argv) == 3 and sys.argv[1] == '--runtime-check':
        import importlib
        checks = {'md': ('ovito',), 'qe': ('numpy', 'scipy', 'seekpath', 'matplotlib')}
        if sys.argv[2] not in checks:
            raise SystemExit('Unknown scientific runtime check')
        try:
            for module in checks[sys.argv[2]]:
                importlib.import_module(module)
        except ImportError:
            raise SystemExit(1)
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--ui-origin", required=True)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535")
    # Local persistence never initializes AWS clients, reads AWS credentials,
    # or enables hosted compute merely because shell variables are inherited.
    for key in list(os.environ):
        if key.startswith("AWS_"):
            os.environ.pop(key, None)
    os.environ["AWS_EC2_METADATA_DISABLED"] = "true"
    os.environ["PHYNITE_APP_MODE"] = "local"
    application = DesktopApplication(args.data_dir, args.port, args.ui_origin)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(application))
    server.daemon_threads = True
    application.publish_transport()
    application.connections.start()
    threading.Thread(target=application.maintain, daemon=True).start()
    def shutdown(*_):
        application.closed.set(); threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown); signal.signal(signal.SIGINT, shutdown)
    parent = int(os.environ.get("PHYNITE_PARENT_PID", "0"))
    if parent:
        # The launcher is a detached parent, so checking only that its numeric
        # PID exists is not sufficient: operating systems may reuse a PID
        # after the launcher exits.  New launchers also publish a small
        # heartbeat file in the workspace.  A stale heartbeat means the
        # detached core is orphaned and should release the scheduler lock.
        heartbeat_path = os.environ.get("PHYNITE_PARENT_HEARTBEAT", "")
        expected_instance = os.environ.get("PHYNITE_PARENT_INSTANCE_ID", "")
        heartbeat_timeout = max(10.0, float(os.environ.get("PHYNITE_PARENT_HEARTBEAT_TIMEOUT", "15")))

        def parent_is_alive() -> bool:
            try:
                os.kill(parent, 0)
            except (ProcessLookupError, PermissionError):
                return False
            if not heartbeat_path:
                return True
            try:
                heartbeat = Path(heartbeat_path)
                # The launcher updates this file while it owns the detached
                # services.  Do not trust contents supplied by a child; the
                # file's age is the liveness signal and remains local-only.
                if time.time() - heartbeat.stat().st_mtime > heartbeat_timeout:
                    return False
                if expected_instance:
                    value = json.loads(heartbeat.read_text())
                    return value.get("pid") == parent and value.get("instanceId") == expected_instance
                return True
            except (OSError, ValueError, TypeError):
                return False

        def monitor_parent():
            while not application.closed.wait(1):
                if not parent_is_alive():
                    shutdown(); return
        threading.Thread(target=monitor_parent, daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        application.close(); server.server_close()


if __name__ == "__main__":
    main()
