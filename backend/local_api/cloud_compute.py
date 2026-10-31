"""Explicit job-only cloud uploads and verified result downloads to local storage."""
from __future__ import annotations

import hashlib
import base64
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Any, Iterator
from urllib.parse import quote

from .cloud_client import CloudError

from backend.local_api.domain.project_sync import canonical
from backend.local_api.domain.phynite_core import owner_partition, storage_owner, utc_now, public_item


class CloudCompute:
    def __init__(self, data_dir: Path, client: Any):
        self.root = Path(data_dir).resolve() / "cloud-executions"
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.client = client
        self.database = self.root / "state.sqlite"
        with self._db() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in {0, 1}:
                raise RuntimeError("Cloud execution records require a newer Phynite Lab version. Data was retained.")
            db.execute("CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, account TEXT NOT NULL, project TEXT NOT NULL, sha256 TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, remote TEXT)")
            db.execute("PRAGMA user_version=1")
        self.database.chmod(0o600)

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def _execution(self, identifier: str) -> dict[str, Any]:
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise ValueError("Choose a cloud execution.")
        with self._db() as db:
            row = db.execute("SELECT * FROM executions WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise CloudError(404, "CLOUD_EXECUTION_NOT_FOUND", "Cloud execution was not found on this device.")
        if row["account"] != self.client.account:
            raise CloudError(401, "CLOUD_ACCOUNT_CHANGED", "Reconnect the cloud account associated with this execution.")
        return dict(row)

    def list(self, services: Any) -> list[dict[str, Any]]:
        if not self.client.account:
            raise CloudError(401, "CLOUD_LOGIN_REQUIRED", "Sign in to view this account's cloud executions.")
        with self._db() as db:
            rows = db.execute("SELECT id,project,status FROM executions WHERE account=? ORDER BY rowid DESC", (self.client.account,)).fetchall()
        result = []
        for row in rows:
            suffix = hashlib.sha256((self.client.account + ":" + row["id"]).encode()).hexdigest()[:32]
            imported = bool(services.table.get_item(Key={"PK": owner_partition(services.owner), "SK": "CLOUD_IMPORT#" + suffix}).get("Item"))
            result.append({"id": row["id"], "projectId": row["project"], "status": row["status"], "imported": imported})
        return result

    def preview(self, project_id: str, structure: dict[str, Any], calculation: dict[str, Any], *, dependencies: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        if not self.client.account:
            raise CloudError(401, "CLOUD_LOGIN_REQUIRED", "Sign in before preparing online compute.")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", project_id) or not isinstance(structure, dict) or not isinstance(calculation, dict):
            raise ValueError("Choose a local project, structure and calculation.")
        if calculation.get("dependsOnCalculationIds") or calculation.get("scfSourceCalculationId"):
            raise CloudError(422, "CLOUD_LOCAL_DEPENDENCY_REQUIRED", "Prepare standalone input with its source steps before sending a local dependent calculation to cloud.")
        if calculation.get("jobKind") in {"md-simulation", "md-analysis"}:
            raise CloudError(409, "MD_CLOUD_UNAVAILABLE", "MD cloud execution is not available. Use your computer.")
        raw = canonical({"structure": structure, "calculation": calculation, **({"dependencies": dependencies} if dependencies else {})})
        if len(raw) > 6_000_000:
            raise CloudError(413, "CLOUD_EXECUTION_TOO_LARGE", "Cloud job inputs exceed 6 MB.")
        identifier, digest = secrets.token_hex(16), hashlib.sha256(raw).hexdigest()
        with self._db() as db:
            db.execute("INSERT INTO executions VALUES(?,?,?,?,?,'REVIEW',NULL)", (identifier, self.client.account, project_id, digest, raw.decode()))
        return {"executionId": identifier, "localProjectId": project_id, "inputSha256": digest, "inputBytes": len(raw), "inputs": {"structure": structure.get("name", "Structure"), "structureAtoms": len(structure.get("atoms", [])), "calculationType": calculation.get("calculationType"), "inputFiles": sorted(calculation.get("inputFiles", {}).keys()), "dependencies": [{key: item[key] for key in ("filename", "sha256", "sizeBytes")} for item in dependencies or []]}, "transferScope": "Only this job's structure, exact inputs and listed pseudopotentials are uploaded. Confirm only if you have permission for this private compute transfer; this does not authorize redistribution or Cloud Sync.", "retention": {"inputs": "Until this execution is deleted from cloud.", "results": "Standard job retention applies. Completed job metadata reports its actual expiry."}, "cloudSyncEnabled": False, "uploaded": False}

    def preview_calculation(self, services: Any, calculation_id: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
        if not isinstance(calculation_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", calculation_id):
            raise CloudError(400, "INVALID_CLOUD_EXECUTION", "Choose a saved local DFT calculation.")
        options = options or {}
        if set(options) - {"cloudMode", "computeProfileId"}:
            raise CloudError(400, "INVALID_CLOUD_EXECUTION", "Only the cloud compute mode and catalog profile may override saved inputs.")
        owner_prefix = f"users/{storage_owner(services.owner)}/"
        def read_json(key: Any, maximum: int):
            if not isinstance(key, str) or not key.startswith(owner_prefix):
                raise CloudError(409, "CLOUD_LOCAL_INPUT_INVALID", "A saved job input is outside this local workspace.")
            with services.s3.get_object(Bucket=services.bucket, Key=key)["Body"] as body:
                raw = body.read(maximum + 1)
            if len(raw) > maximum:
                raise CloudError(413, "CLOUD_EXECUTION_TOO_LARGE", "A saved cloud job input exceeds its bounded transfer size.")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise CloudError(409, "CLOUD_LOCAL_INPUT_INVALID", "A saved job input is invalid.")
            return value
        with services.table.atomic():
            record = services.get_item(services.owner, "CALCULATION", calculation_id)
            if not record or record.get("jobKind") in {"md-simulation", "md-analysis"}:
                raise CloudError(404, "LOCAL_CALCULATION_NOT_FOUND", "Choose a saved local DFT calculation.")
            project_id = record.get("projectId")
            project = services.get_item(services.owner, "PROJECT", project_id)
            structure = services.get_item(services.owner, "STRUCTURE", record.get("structureId"))
            if not project or project.get("trashed") or not structure or structure.get("projectId") != project_id:
                raise CloudError(409, "CLOUD_LOCAL_INPUT_INVALID", "The saved calculation's project and structure must be available in this workspace.")
            stored = read_json(record.get("inputKey"), 6_000_000)
            structure_payload = read_json(structure.get("objectKey"), 5_000_000)
            if stored.get("calculationId") != calculation_id or stored.get("projectId") != project_id or stored.get("structureId") != structure["id"]:
                raise CloudError(409, "CLOUD_LOCAL_INPUT_INVALID", "Saved calculation input identity does not match its project and structure.")
            if record.get("dependsOnCalculationIds") or stored.get("dependencyOutputKeys") or stored.get("scfSourceCalculationId") or stored.get("scfSource") or stored.get("settings", {}).get("sharedScf"):
                raise CloudError(422, "CLOUD_LOCAL_DEPENDENCY_REQUIRED", "This saved job needs local calculation outputs. Create a standalone input containing its source steps before cloud execution.")
            calculation = {key: stored[key] for key in ("calculationType", "qeInput", "inputFiles", "settings") if key in stored}
            calculation.update(name=record.get("name", stored.get("calculationType", "Calculation")), vcpus=record.get("vcpus"), memoryMiB=record.get("memoryMiB"), **options)
            dependencies = []
            required_pseudo = set()
            inputs = stored.get("inputFiles") or {"qe.in": stored.get("qeInput", "")}
            for content in inputs.values():
                clean = "\n".join(line.split("!", 1)[0] for line in str(content).splitlines())
                species = re.search(r"(?im)^\s*ATOMIC_SPECIES\s*$", clean)
                if species is None:
                    continue
                for line in clean[species.end():].splitlines():
                    fields = line.split()
                    if not fields:
                        continue
                    if len(fields) != 3 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", fields[0]):
                        break
                    try:
                        float(fields[1])
                    except ValueError:
                        break
                    required_pseudo.add(fields[2])
            if required_pseudo - set(stored.get("pseudopotentials") or {}):
                raise CloudError(422, "CLOUD_PSEUDOPOTENTIAL_REQUIRED", "Attach the exact UPF files referenced by ATOMIC_SPECIES to this saved calculation before cloud execution. Local runtime defaults are not transferred implicitly.")
            for filename, key in (stored.get("pseudopotentials") or {}).items():
                if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_.+\-]{1,200}", filename) or filename in {".", ".."} or not isinstance(key, str) or not key.startswith(owner_prefix):
                    raise CloudError(409, "CLOUD_LOCAL_INPUT_INVALID", "A saved pseudopotential has an invalid owner or filename.")
                with services.s3.get_object(Bucket=services.bucket, Key=key)["Body"] as body:
                    raw = body.read(4_000_001)
                if len(raw) > 4_000_000:
                    raise CloudError(413, "CLOUD_EXECUTION_TOO_LARGE", "This pseudopotential exceeds the job-only transfer limit. Split the input or use local compute.")
                dependencies.append({"filename": filename, "sha256": hashlib.sha256(raw).hexdigest(), "sizeBytes": len(raw), "contentBase64": base64.b64encode(raw).decode(), "licenseAcknowledged": True})
            return self.preview(project_id, structure_payload, calculation, dependencies=dependencies)

    def prepare(self, identifier: str, confirmed_sha256: str) -> dict[str, Any]:
        execution = self._execution(identifier)
        if confirmed_sha256 != execution["sha256"]:
            raise CloudError(409, "CLOUD_INPUT_CONFIRMATION_REQUIRED", "Confirm the reviewed input checksum before uploading.")
        payload = json.loads(execution["payload"])
        if hashlib.sha256(canonical(payload)).hexdigest() != confirmed_sha256:
            raise CloudError(409, "CLOUD_INPUT_INTEGRITY", "Saved cloud input failed its checksum.")
        result = self.client.request(execution["account"], "POST", "/v1/cloud-executions/prepare", {"executionId": identifier, "localProjectId": execution["project"], **payload, "confirmUpload": True})
        quoted = self.client.request(execution["account"], "POST", f"/v1/cloud-executions/{identifier}/quote", {})
        result = {**result, "quote": quoted.get("quote"), "inputSha256": confirmed_sha256}
        with self._db() as db:
            db.execute("UPDATE executions SET status=?,remote=? WHERE id=?", (result["execution"]["status"], json.dumps(result), identifier))
        return result

    def submit(self, identifier: str, confirmed_sha256: str, confirmed_quote_id: str | None = None) -> dict[str, Any]:
        execution = self._execution(identifier)
        if confirmed_sha256 != execution["sha256"]:
            raise CloudError(409, "CLOUD_INPUT_CONFIRMATION_REQUIRED", "Confirm the reviewed input checksum before submitting.")
        payload = json.loads(execution["payload"])
        if hashlib.sha256(canonical(payload)).hexdigest() != confirmed_sha256:
            raise CloudError(409, "CLOUD_INPUT_INTEGRITY", "Saved cloud input failed its checksum.")
        if execution["status"] == "REVIEW":
            raise CloudError(409, "CLOUD_ESTIMATE_REQUIRED", "Upload the reviewed inputs and confirm the cloud estimate before running.")
        if payload["calculation"].get("cloudMode") in {"paid", "pilot"} and (not isinstance(confirmed_quote_id, str) or not re.fullmatch(r"[a-f0-9]{32}", confirmed_quote_id)):
            raise CloudError(409, "CLOUD_ESTIMATE_REQUIRED", "Confirm the current cloud estimate before running.")
        result = self.client.request(execution["account"], "POST", f"/v1/cloud-executions/{identifier}/submit", {"confirmInputSha256": confirmed_sha256, **({"confirmQuoteId": confirmed_quote_id} if confirmed_quote_id else {})})
        with self._db() as db:
            db.execute("UPDATE executions SET status=?,remote=? WHERE id=?", (result["execution"]["status"], json.dumps(result["execution"]), identifier))
        return result

    def status(self, identifier: str) -> dict[str, Any]:
        execution = self._execution(identifier)
        if execution["status"] == "REVIEW":
            return {"executionId": identifier, "status": "REVIEW", "inputSha256": execution["sha256"], "uploaded": False, "cloudSyncEnabled": False}
        result = self.client.request(execution["account"], "GET", f"/v1/cloud-executions/{identifier}")
        prior = json.loads(execution["remote"] or "{}")
        quote = prior.get("quote")
        if isinstance(quote, dict) and int(quote.get("expiresAtEpoch", 0)) <= time.time():
            quote = None
        result = {**result, "inputSha256": execution["sha256"], "quote": quote}
        with self._db() as db:
            db.execute("UPDATE executions SET status=?,remote=? WHERE id=?", (result["execution"].get("calculation", {}).get("status", result["execution"]["status"]), json.dumps(result), identifier))
        return result

    def cancel(self, identifier: str) -> dict[str, Any]:
        execution = self._execution(identifier)
        result = self.client.request(execution["account"], "POST", f"/v1/cloud-executions/{identifier}/cancel", {})
        with self._db() as db:
            db.execute("UPDATE executions SET status=? WHERE id=?", (result.get("calculation", {}).get("status", "CANCEL_REQUESTED"), identifier))
        return result

    def download_results(self, identifier: str) -> dict[str, Any]:
        execution = self._execution(identifier)
        state = self.status(identifier)["execution"]
        calculation, manifest = state.get("calculation", {}), state.get("result")
        if calculation.get("status") not in {"COMPLETED", "FAILED", "CANCELLED"} or not state.get("artifactsAvailable") or not isinstance(manifest, dict):
            raise CloudError(409, "CLOUD_RESULT_NOT_READY", "Cloud results are not available yet or have expired.")
        artifacts = list(manifest.get("artifacts", []))
        cursor = manifest.get("artifactPagination", {}).get("nextCursor")
        seen = set()
        while cursor:
            if cursor in seen or len(seen) > 1000:
                raise CloudError(502, "CLOUD_RESULT_INVALID", "Cloud artifact pagination is invalid.")
            seen.add(cursor)
            page = self.client.request(execution["account"], "GET", f"/v1/calculations/{calculation['id']}/artifacts?cursor={quote(cursor, safe='')}")
            artifacts.extend(page["artifacts"])
            cursor = page.get("nextCursor")
        destination = self.root / identifier / "results"
        destination.mkdir(mode=0o700, parents=True, exist_ok=True)
        files = []
        paths = set()
        for artifact in artifacts:
            path, digest, size = artifact.get("path"), artifact.get("sha256"), artifact.get("sizeBytes")
            if not isinstance(path, str) or not path or path.startswith("/") or "\\" in path or any(part in {"", ".", ".."} for part in path.split("/")) or PurePosixPath(path).is_absolute() or path in paths or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or type(size) is not int or size < 0:
                raise CloudError(502, "CLOUD_RESULT_INVALID", "Cloud artifact lacks a safe path, size or checksum.")
            paths.add(path)
            target = destination / path
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if target.is_symlink() or any(parent.is_symlink() for parent in target.parents if parent != destination.parent):
                raise CloudError(409, "LOCAL_RESULT_PATH_INVALID", "A result destination contains a symbolic link.")
            temporary = target.with_name(target.name + ".download-" + secrets.token_hex(8))
            sha, count = hashlib.sha256(), 0
            try:
                with temporary.open("xb") as handle:
                    while count < size:
                        data, next_offset, total = self.client.artifact_chunk(execution["account"], calculation["id"], path, count)
                        if not data or next_offset != count + len(data) or total != size or next_offset > size:
                            raise CloudError(502, "CLOUD_RESULT_INTEGRITY", "Cloud artifact transfer bounds changed.")
                        handle.write(data)
                        sha.update(data)
                        count = next_offset
                    handle.flush()
                    os.fsync(handle.fileno())
                if count != size or sha.hexdigest() != digest:
                    raise CloudError(502, "CLOUD_RESULT_INTEGRITY", "Cloud result failed its checksum. Existing local data was retained.")
                temporary.chmod(0o600)
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
            files.append({"path": path, "file": str(target), "sha256": digest, "sizeBytes": size, "contentType": artifact.get("contentType", "application/octet-stream")})
        # Caller atomically imports these verified files plus provenance into its
        # local domain records. Download never marks scientific success itself.
        return {"executionId": identifier, "localProjectId": execution["project"], "calculation": calculation, "result": {**manifest, "artifacts": [{key: value for key, value in artifact.items() if key not in {"downloadUrl", "viewUrl"}} for artifact in artifacts]}, "files": files, "cloudSyncEnabled": False}

    def import_results(self, services: Any, identifier: str) -> dict[str, Any]:
        """Publish verified files and domain records together in local SQLite.

        Network transfer finishes before this transaction. Existing project work
        stays intact; the source execution retains its backend and scientific
        provenance while local storage pointers use independent owner-scoped IDs.
        """
        execution = self._execution(identifier)
        downloaded = self.download_results(identifier)
        payload = json.loads(execution["payload"])
        if hashlib.sha256(canonical(payload)).hexdigest() != execution["sha256"]:
            raise CloudError(409, "CLOUD_INPUT_INTEGRITY", "Saved cloud inputs failed their checksum. No project records were changed.")
        source = downloaded["calculation"]
        if source.get("status") not in {"COMPLETED", "FAILED", "CANCELLED"} or not isinstance(source.get("id"), str):
            raise CloudError(409, "CLOUD_RESULT_NOT_READY", "A terminal cloud calculation is required before importing results.")
        project_id = execution["project"]
        suffix = hashlib.sha256((execution["account"] + ":" + identifier).encode()).hexdigest()[:32]
        structure_id, calculation_id = "str_cloud_" + suffix, "calc_cloud_" + suffix
        prefix = f"users/{storage_owner(services.owner)}/projects/{project_id}"
        root = f"{prefix}/calculations/{calculation_id}"
        structure_key = f"{prefix}/structures/{structure_id}/structure.json"
        input_key, output_prefix = root + "/input.json", root + "/output"
        source_manifest = {key: value for key, value in downloaded["result"].items() if key != "artifactPagination"}
        if any(artifact["path"] == "result.json" for artifact in downloaded["files"]):
            raise CloudError(502, "CLOUD_RESULT_INVALID", "The result manifest cannot list itself as a scientific artifact.")
        manifest_digest = hashlib.sha256(canonical(source_manifest)).hexdigest()
        provenance = {"executionId": identifier, "accountId": execution["account"], "remoteCalculationId": source["id"], "remoteStructureId": source.get("structureId"), "computeBackend": source.get("computeBackend"), "inputSha256": execution["sha256"], "apiManifestSha256": manifest_digest, "remoteManifestSha256": downloaded["result"].get("artifactPagination", {}).get("manifestSha256"), "remoteArtifactsExpireAtEpoch": source.get("artifactsExpireAtEpoch")}
        timestamp = utc_now()
        receipt_key = {"PK": owner_partition(services.owner), "SK": "CLOUD_IMPORT#" + suffix}
        with services.table.atomic():
            project = services.get_item(services.owner, "PROJECT", project_id)
            if not project or project.get("trashed") or project.get("status") == "DELETING":
                raise CloudError(409, "LOCAL_PROJECT_NOT_FOUND", "Restore or choose the original local project before importing these results.")
            receipt = services.table.get_item(Key=receipt_key).get("Item")
            if receipt:
                if receipt.get("inputSha256") != execution["sha256"] or receipt.get("apiManifestSha256") != manifest_digest or receipt.get("projectId") != project_id:
                    raise CloudError(409, "CLOUD_IMPORT_CONFLICT", "This execution was previously imported with different verified results. Existing local data was retained.")
                prior_structure = services.get_item(services.owner, "STRUCTURE", structure_id)
                prior_calculation = services.get_item(services.owner, "CALCULATION", calculation_id)
                if not prior_structure or not prior_calculation:
                    raise CloudError(409, "CLOUD_IMPORT_INCOMPLETE", "The previous import records are unavailable. Restore its project export before importing again.")
                return {"executionId": identifier, "localProjectId": project_id, "structure": public_item(prior_structure), "calculation": public_item(prior_calculation), "imported": True, "idempotentReplay": True, "cloudSyncEnabled": False}
            if services.get_item(services.owner, "STRUCTURE", structure_id) or services.get_item(services.owner, "CALCULATION", calculation_id):
                raise CloudError(409, "CLOUD_IMPORT_CONFLICT", "A local record already uses this execution identity. Existing project data was retained.")
            structure = payload["structure"]
            structure_raw = canonical(structure)
            job_input = {"version": 2, **payload["calculation"], "calculationId": calculation_id, "projectId": project_id, "structureId": structure_id, "sourceCloudExecution": provenance}
            manifest = {**source_manifest, "calculationId": calculation_id, "projectId": project_id, "structureId": structure_id, "sourceCloudExecution": provenance}
            services.s3.put_object(Bucket=services.bucket, Key=structure_key, Body=structure_raw, ContentType="application/json", Metadata={"sha256": hashlib.sha256(structure_raw).hexdigest()})
            services.s3.put_object(Bucket=services.bucket, Key=input_key, Body=canonical(job_input), ContentType="application/json")
            # Keep dependency bytes as separate licence-aware artifacts. Never
            # conceal restricted UPF content inside a JSON snapshot or sync file.
            retained_input = {**payload, **({"dependencies": [{key: value for key, value in item.items() if key != "contentBase64"} for item in payload["dependencies"]]} if payload.get("dependencies") else {})}
            services.s3.put_object(Bucket=services.bucket, Key=root + "/source/cloud-input.json", Body=canonical(retained_input), ContentType="application/json")
            services.s3.put_object(Bucket=services.bucket, Key=root + "/source/result-manifest-api.json", Body=canonical(source_manifest), ContentType="application/json", Metadata={"sha256": manifest_digest})
            for artifact in downloaded["files"]:
                target = output_prefix + "/" + artifact["path"]
                with Path(artifact["file"]).open("rb") as body:
                    services.s3.put_object(Bucket=services.bucket, Key=target, Body=body, ContentType=artifact["contentType"], ContentLength=artifact["sizeBytes"], Metadata={"sha256": artifact["sha256"]})
            local_pseudopotentials = {}
            for dependency in payload.get("dependencies", []):
                raw = base64.b64decode(dependency["contentBase64"], validate=True)
                key = root + "/source/pseudo/" + dependency["filename"]
                services.s3.put_object(Bucket=services.bucket, Key=key, Body=raw, ContentType="application/octet-stream", ContentLength=dependency["sizeBytes"], Metadata={"sha256": dependency["sha256"]})
                local_pseudopotentials[dependency["filename"]] = key
            if local_pseudopotentials:
                job_input["pseudopotentials"] = local_pseudopotentials
                services.s3.put_object(Bucket=services.bucket, Key=input_key, Body=canonical(job_input), ContentType="application/json")
            services.s3.put_object(Bucket=services.bucket, Key=output_prefix + "/result.json", Body=canonical(manifest), ContentType="application/json")
            structure_record = {"PK": owner_partition(services.owner), "SK": "STRUCTURE#" + structure_id, "GSI1PK": "PROJECT#" + project_id, "GSI1SK": "STRUCTURE#" + timestamp + "#" + structure_id, "entityType": "STRUCTURE", "id": structure_id, "projectId": project_id, "ownerId": services.owner, "objectKey": structure_key, "name": structure["name"], "formula": structure.get("formula", ""), "atomCount": len(structure["atoms"]), "sha256": hashlib.sha256(structure_raw).hexdigest(), "source": structure.get("source", "Phynite"), "spaceGroup": structure.get("spaceGroup", "P1"), "status": "READY", "createdAt": timestamp, "updatedAt": timestamp, "sourceCloudExecution": provenance}
            excluded = {"PK", "SK", "ownerId", "inputKey", "outputPrefix", "localWorkerId", "workerId", "leaseToken", "leaseExpiresAtEpoch", "artifactsExpireAtEpoch", "idempotencyKey", "requestFingerprint", "computeRequestFingerprint"}
            calculation_record = {**{key: value for key, value in source.items() if key not in excluded and not key.startswith("GSI")}, "PK": owner_partition(services.owner), "SK": "CALCULATION#" + calculation_id, "GSI1PK": "PROJECT#" + project_id, "GSI1SK": "CALCULATION#" + timestamp + "#" + calculation_id, "entityType": "CALCULATION", "id": calculation_id, "projectId": project_id, "structureId": structure_id, "ownerId": services.owner, "inputKey": input_key, "outputPrefix": output_prefix, "imported": True, "sourceCloudExecution": provenance, "cloudSource": {"inputKey": root + "/source/cloud-input.json", "manifestKey": root + "/source/result-manifest-api.json", "dependencies": [{"inputKey": key, "filename": name} for name, key in local_pseudopotentials.items()]}, "importedAt": timestamp}
            services.put_item(structure_record, "attribute_not_exists(PK)")
            services.put_item(calculation_record, "attribute_not_exists(PK)")
            services.table.put_item(Item={**receipt_key, "projectId": project_id, "structureId": structure_id, "calculationId": calculation_id, "inputSha256": execution["sha256"], "apiManifestSha256": manifest_digest, "importedAt": timestamp, "artifactCount": len(downloaded["files"])})
        return {"executionId": identifier, "localProjectId": project_id, "structure": public_item(structure_record), "calculation": public_item(calculation_record), "imported": True, "artifactCount": len(downloaded["files"]), "manifestSha256": hashlib.sha256(canonical(manifest)).hexdigest(), "cloudSyncEnabled": False}
