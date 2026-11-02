"""Production local services: real application schemas on SQLite and local files."""
from __future__ import annotations

import hashlib
import base64
import os
import secrets
import time
from pathlib import Path
from typing import Any

from backend.local_api.domain.phynite_core import ApiError, MetadataServices, owner_partition, utc_now
from .filesystem_store import FilesystemObjects
from .sqlite_store import SQLiteClient, SQLiteTable

INTERRUPTED_REASON = "Local execution was interrupted. Saved inputs, logs and scratch were retained. Inspect the previous output and submit a new run explicitly."


class LocalServices(MetadataServices):
    def __init__(self, data_dir: Path, api_origin: str, ui_origin: str):
        self.data_dir = data_dir.resolve(); self.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.local_workspace = True
        self.table = SQLiteTable(self.data_dir / "metadata.sqlite")
        self.persistence_client = SQLiteClient(self.table)
        with self.table.atomic():
            identity = self.table.get_item(Key={"PK": "LOCAL", "SK": "IDENTITY"}).get("Item")
            if identity is None:
                identity = {"PK": "LOCAL", "SK": "IDENTITY", "owner": "local-" + secrets.token_hex(16), "signingKey": secrets.token_hex(32)}
                self.table.put_item(Item=identity)
        self.owner = identity["owner"]
        self.bucket = "phynite-local"
        self.s3 = FilesystemObjects(self.data_dir / "artifacts", self.table, self.bucket, api_origin, bytes.fromhex(identity["signingKey"]))
        self.public_app_url = ui_origin
        self.local_worker_enabled = True
        self.compute_enabled = False
        import psutil
        self.max_job_vcpus = self.max_md_job_vcpus = psutil.cpu_count(logical=True) or os.cpu_count() or 1
        physical_mib = psutil.virtual_memory().total // 1024 ** 2
        self.max_job_memory = self.max_md_job_memory = physical_mib
        self.max_local_kpoint_product = 4096
        encoded_owner = base64.urlsafe_b64encode(self.owner.encode()).decode().rstrip('=')
        self.worker_token = f'phyp.{encoded_owner}.{secrets.token_urlsafe(36)}'
        self.worker_token_sha256 = hashlib.sha256(self.worker_token.encode()).hexdigest()
        if not self.get_item(self.owner, "ACCOUNT", "primary"):
            self.put_item({"PK": owner_partition(self.owner), "SK": "ACCOUNT#primary", "id": "primary", "entityType": "ACCOUNT", "ownerId": self.owner, "planId": "free", "computeTarget": "personal", "username": "local", "createdAt": utc_now()})
        # The launcher pairs its owned local worker internally; no cloud pairing
        # code or user credential is needed. A restart rotates this private token.
        self.put_item({'PK': owner_partition(self.owner), 'SK': 'PERSONAL_WORKER#primary', 'id': 'primary', 'entityType': 'PERSONAL_WORKER', 'ownerId': self.owner, 'tokenHash': self.worker_token_sha256, 'credentialVersion': secrets.token_hex(16), 'credentialCreatedAt': utc_now(), 'lastSeenAtEpoch': 0, 'capabilities': []})
        self.reconcile_interrupted_jobs(restart=True)

    def reconcile_interrupted_jobs(self, *, restart: bool = False) -> None:
        """An expired desktop lease is an interruption, never a replay request."""
        now = int(time.time())
        with self.table.atomic():
            for kind in ('CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS'):
                for item in self.list_owner_items(self.owner, kind):
                    if item.get('computeBackend') != 'LOCAL_MAC' or item.get('status') not in {'RUNNING', 'CANCEL_REQUESTED'}:
                        continue
                    if not restart and int(item.get('leaseExpiresAtEpoch') or 0) >= now:
                        continue
                    self.update_item(self.owner, kind, item['id'], {'status': 'CANCELLED' if item['status'] == 'CANCEL_REQUESTED' else 'FAILED', 'statusMessage': INTERRUPTED_REASON, 'failureReason': INTERRUPTED_REASON, 'interrupted': True, 'completedAt': utc_now(), 'updatedAt': utc_now()})

    def claim_local_calculation(self, item, worker_id, lease_expires_at, now_epoch, timestamp):
        if item.get('status') != 'QUEUED':
            self.reconcile_interrupted_jobs()
            return None
        # Keep the check and the inherited conditional claim in one SQLite
        # transaction, so another thread cannot turn this into a stale replay.
        with self.table.atomic():
            current = self.table.get_item(Key=item).get('Item', {})
            if current.get('status') != 'QUEUED':
                return None
            return super().claim_local_calculation(item, worker_id, lease_expires_at, now_epoch, timestamp)

    def local_session(self) -> dict:
        profile = self.get_item(self.owner, "PROFILE", "primary") or {}
        return {"mode": "local", "authenticated": False, "user": {"id": self.owner, "email": "", "name": profile.get("name") or "Local Researcher", "groups": [], "isDeveloper": False}, "cloud": {"authenticated": False}}

    def finish_interrupted_calculation(self, item: dict, worker_id: str, timestamp: str, provenance: dict, effective_resources: dict | None = None) -> dict:
        """Import verified terminal bytes without renewing a worker lease or running a solver."""
        with self.table.atomic():
            current = self.table.get_item(Key=item).get('Item')
            if (current != item or item.get('ownerId') != self.owner
                    or item.get('computeBackend') != 'LOCAL_MAC' or item.get('computeTarget') != 'personal'
                    or item.get('status') != 'FAILED' or item.get('interrupted') is not True
                    or item.get('failureReason') != INTERRUPTED_REASON or item.get('statusMessage') != INTERRUPTED_REASON
                    or item.get('localWorkerId') != worker_id):
                raise ApiError(409, 'The interrupted job changed during verification. Refresh before recovering it.', 'RESULT_RECOVERY_CONFLICT')
            updated = {**item, 'status': 'COMPLETED', 'progress': 100, 'computePhase': 'FINISHED',
                       'statusMessage': 'Completed result recovered from your computer', 'completedAt': timestamp,
                       'updatedAt': timestamp, 'resultRecovery': {**provenance, 'recoveredAt': timestamp},
                       **(effective_resources or {})}
            for field in ('interrupted', 'failureReason', 'resultValidationFailure', 'leaseExpiresAtEpoch', 'logTail', 'GSI2PK', 'GSI2SK'):
                updated.pop(field, None)
            self.table.put_item(Item=updated)
            return updated
