#!/usr/bin/env python3
"""Execute a release's installed native scientific checks; never accept claimed results.

Python runs this release harness only. The installed launcher and native core
run with an empty PATH and a fresh HOME/data directory, and scientific Python
is obtained only through the real setup API. A missing prerequisite is a failed
gate. Nothing is installed into, or read from, a user's research workspace.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlencode, urlsplit


# The MD runtime includes OVITO analysis; setup exposes these two bundles.
INSTALL_COMPONENTS = ("dft", "md")

CHECKS = (
    "runtime-install", "app-qe-queue-reference", "app-queued-cancel-restart",
    "qe-reference", "md-guided-reference", "md-manual-reference",
    "analysis-reference", "sandbox-probe", "sandbox-denials",
    "cancel-resource-recovery", "installer-failure-recovery",
)
HASH = re.compile(r"[a-f0-9]{64}")


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def archive_json(path: Path, name: str) -> dict:
    with tarfile.open(path, "r:gz") as archive:
        member = archive.getmember("package/" + name)
        if not member.isfile() or member.size > 16 * 1024**2:
            raise ValueError("The package manifest is not a bounded regular file.")
        with archive.extractfile(member) as source:
            return json.load(source)


def fixture_files(manifest: dict) -> list[dict]:
    records = manifest.get("files")
    if manifest.get("schemaVersion") != 1 or not isinstance(records, list) or not records:
        raise ValueError("Missing versioned, pinned QE reference fixture.")
    names: set[str] = set()
    for record in records:
        name = record.get("name", "")
        url = urlsplit(record.get("url", ""))
        if (not isinstance(name, str) or not name or Path(name).name != name or name in {".", ".."}
                or "\\" in name or name in names or not HASH.fullmatch(record.get("sha256", ""))
                or url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment):
            raise ValueError("Unsafe or unpinned QE reference file.")
        names.add(name)
    if len([value for value in records if value.get("role") == "input"]) != 1 or len([value for value in records if value.get("role") == "reference"]) != 1:
        raise ValueError("QE needs one independently produced input and reference output.")
    if not any(value.get("role") == "pseudopotential" for value in records):
        raise ValueError("QE needs an explicit separately downloaded pseudopotential.")
    return records


def prepare_fixture(source: Path, destination: Path) -> None:
    manifest = json.loads((source / "fixture.json").read_text())
    records = fixture_files(manifest)
    destination.mkdir(mode=0o700)
    write_json(destination / "fixture.json", manifest)
    for record in records:
        target = destination / record["name"]
        existing = source / record["name"]
        if existing.is_file() and not existing.is_symlink():
            shutil.copyfile(existing, target)
        else:
            request = urllib.request.Request(record["url"], headers={"User-Agent": "Phynite-Scientific-Qualification/1"})
            with urllib.request.urlopen(request, timeout=60) as response, target.open("xb") as output:
                # Provider-controlled redirects may stay on the same HTTPS host.
                if urlsplit(response.url).scheme != "https" or urlsplit(response.url).hostname != urlsplit(record["url"]).hostname:
                    raise ValueError("Reference download redirected outside its pinned provider.")
                total = 0
                while block := response.read(1024 * 1024):
                    total += len(block)
                    if total > 64 * 1024**2:
                        raise ValueError("Reference fixture exceeds the 64 MiB per-file bound.")
                    output.write(block)
        if digest(target) != record["sha256"]:
            raise ValueError("The downloaded reference checksum does not match its predeclared manifest.")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError("Local qualification requests must not redirect.")


def local_url(origin: str, value: str) -> str:
    base, target = urlsplit(origin), urlsplit(value)
    if (base.scheme != "http" or base.hostname not in {"127.0.0.1", "localhost", "::1"}
            or not base.port or base.username or base.password or base.path or base.query or base.fragment
            or target.scheme != base.scheme or target.netloc != base.netloc or target.fragment):
        raise ValueError("Qualification must transfer research bytes only through its actual loopback service.")
    return value


def local_open(origin: str, request: urllib.request.Request):
    local_url(origin, request.full_url)
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=30)


def request_json(origin: str, token: str, path: str, payload: dict | None = None, method: str | None = None) -> dict:
    request = urllib.request.Request(origin + path, method=method or ("GET" if payload is None else "POST"),
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                                     data=None if payload is None else json.dumps(payload).encode())
    with local_open(origin, request) as response:
        return json.load(response)


def attachment(root: Path, path: Path, kind: str) -> dict:
    return {"kind": kind, "path": path.relative_to(root).as_posix(), "sha256": digest(path)}


def failed_check(root: Path, check_id: str, message: str) -> dict:
    print(f"FAILED {check_id}: {message}", file=sys.stderr)
    path = root / (check_id + "-failure.json")
    write_json(path, {"passed": False, "error": message})
    return {"id": check_id, "status": "failed", "execution": {"returnCode": 1}, "attachments": [attachment(root, path, "log")]}


def qe_io_comparison(text: str) -> str:
    """Ignore formatting only in the three explicitly declared IO assignments.

    The real runner rewrites outdir/pseudo_dir with spaces around '='. Values
    still must match the fixed disposable paths; every other byte remains part
    of the comparison, including all physics and QE defaults.
    """
    for name, value in (("pseudo_dir", "./pseudo"), ("outdir", "./tmp"), ("prefix", "phynite")):
        pattern = rf"\b{name}\s*=\s*(['\"])([^'\"]*)\1"
        matches = list(re.finditer(pattern, text, re.I))
        if len(matches) != 1 or matches[0][2] != value:
            raise ValueError("The executed QE input does not retain its predeclared disposable IO paths.")
        text = re.sub(pattern, f"{name}='{value}'", text, count=1, flags=re.I)
    return text


class ApplicationQualification:
    """Exercise the installed app's real HTTP/SQLite/worker transfer path.

    No module from the checkout is imported and no worker claim, scheduler or
    result record is fabricated. The independently pinned fixture is submitted
    through the same control-plane endpoints as the browser.
    """
    def __init__(self, output: Path, fixture: Path, origin: str, token: str, timeout: int):
        self.output, self.fixture, self.origin, self.token, self.timeout = output, fixture, origin, token, timeout
        self.project: str | None = None
        self.payload: dict | None = None
        self.completed: str | None = None
        self.cancelled: str | None = None
        self.manifest_sha256: str | None = None

    def call(self, path: str, payload: dict | None = None, method: str | None = None) -> dict:
        return request_json(self.origin, self.token, path, payload, method)

    def upload(self, ticket: dict, source: Path) -> None:
        if ticket.get("method") != "POST" or not isinstance(ticket.get("fields"), dict):
            raise ValueError("The application did not issue its supported immutable upload ticket.")
        boundary = "PhyniteReleaseQualificationMultipartBoundary"
        chunks = []
        for name, value in ticket["fields"].items():
            if not isinstance(name, str) or not isinstance(value, str) or any(c in name for c in '\r\n"'):
                raise ValueError("Unsafe application upload fields.")
            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        chunks.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{source.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(), source.read_bytes(), f'\r\n--{boundary}--\r\n'.encode()])
        request = urllib.request.Request(ticket["url"], data=b"".join(chunks), method="POST",
                                         headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
        with local_open(self.origin, request) as response:
            response.read()

    def download(self, url: str, destination: Path, expected: dict | None = None) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with local_open(self.origin, urllib.request.Request(url)) as response, destination.open("xb") as output:
            total = 0
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > 128 * 1024**2:
                    raise ValueError("The small app reference exceeded its predeclared artifact size bound.")
                output.write(block)
        if expected is not None and (type(expected.get("sizeBytes")) is not int
                or destination.stat().st_size != expected["sizeBytes"]
                or not HASH.fullmatch(str(expected.get("sha256", ""))) or digest(destination) != expected["sha256"]):
            raise ValueError("The artifact downloaded from the application failed its manifest checksum/size.")

    @staticmethod
    def relative_artifact(value: object) -> str:
        if (not isinstance(value, str) or not value or "\\" in value or Path(value).is_absolute()
                or any(part in {"", ".", ".."} for part in value.split("/"))):
            raise ValueError("The imported application artifact path is unsafe.")
        # UPF assets remain provider downloads, never public evidence attachments.
        if value.lower().endswith(".upf"):
            raise ValueError("A restricted pseudopotential cannot enter release evidence.")
        return value

    def qe(self) -> dict:
        directory = self.output / "app-qe-queue-reference"
        directory.mkdir(mode=0o700)
        fixture = json.loads((self.fixture / "fixture.json").read_text())
        records = fixture_files(fixture)
        for item in records:
            if digest(self.fixture / item["name"]) != item["sha256"]:
                raise ValueError("The application fixture differs from its predeclared checksum.")
        source = self.fixture / next(item["name"] for item in records if item["role"] == "input")
        golden = self.fixture / next(item["name"] for item in records if item["role"] == "reference")
        energy_pattern = re.compile(r"!\s+total energy\s+=\s+([-+0-9.EeDd]+)\s+Ry")
        expected, tolerance = fixture.get("expectedEnergyRy"), fixture.get("absoluteToleranceRy")
        if (any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (expected, tolerance))
                or tolerance <= 0 or not energy_pattern.findall(golden.read_text())
                or float(energy_pattern.findall(golden.read_text())[-1].replace("D", "E")) != expected):
            raise ValueError("The independent QE golden output does not establish a finite pinned reference.")
        text = source.read_text()
        atom_counts = re.findall(r"\bnat\s*=\s*([0-9]+)\b", re.sub(r"!.*", "", text), re.I)
        if len(atom_counts) != 1 or not 1 <= int(atom_counts[0]) <= 50000:
            raise ValueError("The pinned application fixture must declare one explicit valid QE atom count.")
        for name, value in (("pseudo_dir", "./pseudo"), ("outdir", "./tmp"), ("prefix", "phynite")):
            if re.search(rf"\b{name}\s*=", text, re.I):
                text = re.sub(rf"\b{name}\s*=\s*['\"][^'\"]*['\"]", f"{name}='{value}'", text, count=1, flags=re.I)
            else:
                text = re.sub(r"&control\b", f"&control\n {name}='{value}',", text, count=1, flags=re.I)
        write_json(directory / "reference.json", {**fixture, "frozenBeforeCandidate": True,
                   "ioPathChangesOnly": {"pseudo_dir": "./pseudo", "outdir": "./tmp", "prefix": "phynite"}})
        deadline = time.monotonic() + min(180, self.timeout)
        while "qe" not in self.call("/__local/runtime").get("capabilities", {}).get("solver", []):
            if time.monotonic() >= deadline:
                raise RuntimeError("The actual application worker never advertised a validated DFT capability.")
            time.sleep(0.25)
        self.call("/__local/resources", {"vcpus": 1, "memoryMiB": 2048, "maxParallelJobs": 1}, "PUT")
        self.project = self.call("/v1/projects", {"name": "Installed app QE release reference"})["project"]["id"]
        structure = self.call(f"/v1/projects/{self.project}/structures/upload-url", {"filename": source.name, "contentType": "text/plain"})
        self.upload(structure["upload"], source)
        structure_id = structure["structure"]["id"]
        self.call(f"/v1/structures/{structure_id}", {"status": "READY", "name": "Pinned upstream SCF structure", "atomCount": int(atom_counts[0])}, "PATCH")
        stored = self.call(f"/v1/structures/{structure_id}")
        self.download(stored["downloadUrl"], directory / "source.in")
        if digest(directory / "source.in") != digest(source):
            raise ValueError("The actual application's persisted structure bytes changed during import.")
        pseudos = {}
        for item in records:
            if item["role"] == "pseudopotential":
                upload = self.call("/v1/pseudopotentials/upload-url", {"filename": item["name"]})
                self.upload(upload["upload"], self.fixture / item["name"])
                pseudos[item["name"]] = upload["objectKey"]
        self.payload = {"structureId": structure_id, "calculationType": "Total energy", "name": "Unchanged upstream QE reference",
                        "qeInput": text, "inputFiles": {"scf.in": text}, "settings": {}, "pseudopotentials": pseudos,
                        "computeTarget": "personal", "vcpus": 1, "memoryMiB": 2048}
        graph = {"version": 1, "projectId": self.project, "nodes": [
            {"id": "source", "kind": "structure", "name": "Pinned upstream structure", "position": {"x": 0, "y": 0}, "configuration": {}, "resources": [{"kind": "structure", "id": structure_id}]},
            {"id": "scf", "kind": "scf", "name": "Pinned upstream SCF", "position": {"x": 300, "y": 0}, "configuration": {"execution": self.payload, "qualification": {"fixtureId": fixture.get("id"), "inputSha256": digest(source)}}, "resources": []}], "edges": [{"id": "source-scf", "source": "source", "target": "scf", "port": "structure"}], "groups": []}
        self.call(f"/v1/projects/{self.project}/workflow", {"baseRevision": 0, "workflow": graph}, "PUT")
        if self.call(f"/v1/projects/{self.project}/workflow").get("workflow") != graph:
            raise ValueError("The actual application did not persist the scientific workflow configuration.")
        planned = self.call(f"/v1/projects/{self.project}/workflow/plan", {"revision": 1, "targets": ["scf"]})["plan"]
        if planned.get("errors"):
            raise ValueError("The real Canvas scientific run plan was rejected: " + json.dumps(planned["errors"]))
        run = self.call(f"/v1/projects/{self.project}/workflow/runs", {"revision": 1, "targets": ["scf"], "idempotencyKey": "qualification_canvas_scf", "compilerSha256": planned.get("compilerSha256")})
        attempt = next((item for item in run["run"]["attempts"] if item["nodeId"] == "scf"), {})
        if not attempt.get("jobId"):
            raise ValueError("The real Canvas did not dispatch the DFT job: " + json.dumps(attempt))
        submitted = self.call(f"/v1/calculations/{attempt['jobId']}")["calculation"]
        if submitted.get("status") not in {"QUEUED", "RUNNING", "COMPLETED"} or submitted.get("computeBackend") != "LOCAL_MAC":
            raise ValueError("The application's real Run submission did not create an owned local queue job.")
        self.completed = submitted["id"]
        history = [{key: submitted.get(key) for key in ("id", "status", "createdAt")}]
        deadline = time.monotonic() + self.timeout
        while True:
            state = self.call(f"/v1/calculations/{self.completed}")
            item = state["calculation"]
            if item.get("status") != history[-1]["status"]:
                history.append({key: item.get(key) for key in ("id", "status", "startedAt", "completedAt", "failureReason")})
                write_json(directory / "status-history.json", history)
            if item.get("status") in {"COMPLETED", "FAILED", "CANCELLED"}:
                break
            if time.monotonic() >= deadline:
                self.call(f"/v1/calculations/{self.completed}/cancel", {})
                raise RuntimeError("The real queued scientific run exceeded its predeclared timeout and was cancelled.")
            time.sleep(0.2)
        if item.get("status") != "COMPLETED" or not item.get("startedAt") or not item.get("completedAt") or state.get("artifactsAvailable") is not True:
            raise ValueError("The actual queued worker did not complete/import its scientific result: " + str(item.get("failureReason") or item.get("status")))
        results = directory / "results"
        results.mkdir()
        self.download(state["resultManifestUrl"], results / "result.json")
        self.manifest_sha256 = digest(results / "result.json")
        result = json.loads((results / "result.json").read_text())
        if (result.get("calculationId") != self.completed or result.get("status") != "completed"
                or result.get("syntheticData") is True or result.get("provenance", {}).get("syntheticData") is True
                or result.get("provenance", {}).get("executionMode") != "local-native-sandbox"
                or result.get("summary", {}).get("converged") is not True or result.get("summary", {}).get("jobDone") is not True):
            raise ValueError("The imported application manifest lacks real native, completed, converged provenance.")
        actual_models = result["provenance"].get("resolvedPseudopotentials")
        if not isinstance(actual_models, list) or {entry.get("requestedFilename"): entry.get("sha256") for entry in actual_models} != {entry["name"]: entry["sha256"] for entry in records if entry["role"] == "pseudopotential"}:
            raise ValueError("The actual queued solver did not retain the exact separately downloaded model identities.")
        expected_artifacts = {}
        for artifact in result.get("artifacts", []):
            path = self.relative_artifact(artifact.get("path"))
            if path in expected_artifacts:
                raise ValueError("The imported manifest duplicated a scientific artifact.")
            expected_artifacts[path] = artifact
        if not expected_artifacts:
            raise ValueError("The real application imported no scientific artifacts.")
        cursor, seen = None, set()
        while True:
            page = self.call(f"/v1/calculations/{self.completed}/artifacts" + ("?" + urlencode({"cursor": cursor}) if cursor else ""))
            if page.get("manifestSha256") != self.manifest_sha256 or page.get("totalArtifacts") != len(expected_artifacts):
                raise ValueError("The application's artifact page is not bound to its actual imported manifest.")
            for artifact in page["artifacts"]:
                path = self.relative_artifact(artifact.get("path"))
                expected_artifact = expected_artifacts.get(path)
                if path in seen or expected_artifact is None or any(artifact.get(key) != expected_artifact.get(key) for key in ("sha256", "sizeBytes")):
                    raise ValueError("The application's artifact pagination changed or duplicated its retained result.")
                self.download(artifact["downloadUrl"], results / path, expected_artifact)
                seen.add(path)
            cursor = page.get("nextCursor")
            if not cursor:
                break
        if seen != set(expected_artifacts):
            raise ValueError("The application did not expose every retained scientific artifact.")
        if qe_io_comparison((results / "inputs/scf.in").read_text()) != qe_io_comparison(text):
            raise ValueError("The actual worker changed the pinned QE input beyond its predeclared IO paths.")
        raw_log = results / "logs/scf.out"
        observed = result["summary"].get("totalEnergyRy")
        parsed = energy_pattern.findall(raw_log.read_text())
        if (isinstance(observed, bool) or not isinstance(observed, (int, float)) or not math.isfinite(observed)
                or not parsed or abs(observed - expected) > tolerance
                or abs(observed - float(parsed[-1].replace("D", "E"))) > 1e-10):
            raise ValueError("The real queued application's numerical result failed the independent pinned QE reference.")
        measurements = [{"name": "queued app total energy vs independent upstream", "unit": "Ry", "value": observed, "expected": expected, "tolerance": tolerance},
                        {"name": "queued app energy vs actual retained solver log", "unit": "Ry", "value": observed, "expected": float(parsed[-1].replace("D", "E")), "tolerance": 1e-10}]
        write_json(directory / "numeric.json", {"measurements": measurements})
        write_json(directory / "input.json", {key: value for key, value in self.payload.items() if key != "pseudopotentials"})
        write_json(directory / "provenance.json", {"engine": "Quantum ESPRESSO", "returnCode": 0, "inputSha256": digest(directory / "input.json"), "outputSha256": self.manifest_sha256,
                   "applicationExecution": {"projectId": self.project, "structureId": structure_id, "calculationId": self.completed, "submissionStatus": "QUEUED", "finalStatus": item["status"], "startedAt": item["startedAt"], "completedAt": item["completedAt"], "verifiedImportedArtifacts": len(seen)},
                   "solver": result["provenance"], "models": [{"filename": entry["name"], "sha256": entry["sha256"]} for entry in records if entry["role"] == "pseudopotential"]})
        kinds = {"results/result.json": "output", "input.json": "input", "provenance.json": "provenance", "numeric.json": "numeric", "results/logs/scf.out": "log", "reference.json": "reference", "results/inputs/scf.in": "executed-input", "source.in": "source", "status-history.json": "status"}
        attachments = [attachment(self.output, directory / path, kind) for path, kind in kinds.items()]
        return {"id": "app-qe-queue-reference", "status": "passed", "execution": {"returnCode": 0}, "attachments": attachments}

    def queued_cancel(self) -> None:
        if not self.project or not self.payload:
            raise RuntimeError("The real application project and scientific input must exist before testing queue cancellation.")
        directory = self.output / "app-queued-cancel-restart"
        directory.mkdir(mode=0o700)
        path = f"/v1/projects/{self.project}/calculations"
        draft = self.call(path, {**self.payload, "run": False, "name": "Explicit unreleased dependency"})["calculation"]
        if draft.get("status") != "DRAFT":
            raise ValueError("The application did not retain the explicit draft dependency.")
        queued = self.call(path, {**self.payload, "name": "Cancel before worker execution", "dependsOnCalculationIds": [draft["id"]]})["calculation"]
        if queued.get("status") != "QUEUED":
            raise ValueError("The dependency-blocked Run was not queued.")
        self.cancelled = queued["id"]
        cancelled = self.call(f"/v1/calculations/{self.cancelled}/cancel", {})["calculation"]
        if cancelled.get("status") != "CANCELLED" or cancelled.get("startedAt"):
            raise ValueError("The actual app did not cancel the blocked queued job before worker execution.")
        write_json(directory / "queue-cancel.json", {"draftDependency": {"id": draft["id"], "status": draft["status"]}, "job": {key: cancelled.get(key) for key in ("id", "status", "startedAt", "completedAt", "statusMessage")}, "submissionStatus": queued["status"]})

    def after_restart(self, origin: str, token: str) -> dict:
        self.origin, self.token = origin, token
        directory = self.output / "app-queued-cancel-restart"
        completed = self.call(f"/v1/calculations/{self.completed}")
        cancelled = self.call(f"/v1/calculations/{self.cancelled}")["calculation"]
        if completed["calculation"].get("status") != "COMPLETED" or cancelled.get("status") != "CANCELLED" or cancelled.get("startedAt"):
            raise ValueError("The actual application restart lost or replayed its completed/cancelled queue states.")
        self.download(completed["resultManifestUrl"], directory / "restarted-result.json")
        if digest(directory / "restarted-result.json") != self.manifest_sha256:
            raise ValueError("The verified completed scientific manifest changed across application restart.")
        time.sleep(3)  # Wait through an actual worker poll; cancellation cannot replay.
        again = self.call(f"/v1/calculations/{self.cancelled}")["calculation"]
        if again.get("status") != "CANCELLED" or again.get("startedAt"):
            raise ValueError("The application worker replayed the cancelled job after restart.")
        write_json(directory / "restart.json", {"completedJob": {"id": self.completed, "status": "COMPLETED", "manifestSha256": self.manifest_sha256}, "cancelledJob": {key: again.get(key) for key in ("id", "status", "startedAt", "completedAt")}, "workerPollAfterRestart": True})
        return {"id": "app-queued-cancel-restart", "status": "passed", "execution": {"returnCode": 0}, "attachments": [attachment(self.output, directory / name, kind) for name, kind in (("queue-cancel.json", "input"), ("restart.json", "output"), ("restarted-result.json", "provenance"))]}


def distribution_metadata_script() -> str:
    """Resolve through the installed verifier for the actual native target."""
    return """import {pathToFileURL} from 'node:url';
const root=process.argv[1]; const {resolveDistribution}=await import(pathToFileURL(root+'/lib/distribution.mjs'));
const value=await resolveDistribution(root, process.platform+'-'+process.arch);
console.log(JSON.stringify({executable:value.executable,packageRoot:value.packageRoot,bootstrap:value.bootstrap}));"""


def qualify(args: argparse.Namespace) -> int:
    output = args.output.expanduser().resolve()
    output.mkdir(mode=0o700)  # Refuse existing directories, including user data.
    home, install, data = (output / name for name in ("home", "install", "data"))
    home.mkdir(mode=0o700)
    data.mkdir(mode=0o700)
    (data / ".release-qualification").write_text("Disposable release acceptance workspace.\n")
    report = {"format": "phynite-local-scientific-evidence", "schemaVersion": 1, "passed": False,
              "packages": {"launcherSha256": digest(args.launcher_tarball), "runtimeSha256": digest(args.runtime_tarball)},
              "checks": []}
    child = None
    application = None
    core = None
    node = shutil.which("node")
    npm = shutil.which("npm")
    child_env = {"HOME": str(home), "USERPROFILE": str(home), "XDG_CONFIG_HOME": str(home / ".config"),
                 "XDG_CACHE_HOME": str(home / ".cache"), "PATH": "", "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8",
                 **({"TMPDIR": os.environ["TMPDIR"]} if "TMPDIR" in os.environ else {})}
    launch_log = output / "launcher.log"
    launcher = install / "node_modules/phynite-lab/bin/phynite-lab.mjs"
    runtime_error = None

    def start_application() -> tuple[str, str]:
        nonlocal child
        with launch_log.open("a") as log:
            child = subprocess.Popen([node, str(launcher), "--no-open", "--port", "3000", "--data-dir", str(data)],
                                     cwd=output, env=child_env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("The installed launcher stopped before its native service became ready.")
            try:
                transport = json.loads((data / "core-service.json").read_text())
                origin, token = transport["origin"], transport["token"]
                request_json(origin, token, "/__local/runtime")
                return origin, token
            except (OSError, ValueError, urllib.error.URLError):
                time.sleep(0.2)
        raise RuntimeError("The installed native service did not become ready in 90 seconds.")

    def stop_application() -> None:
        nonlocal child
        if child is None:
            return
        try:
            subprocess.run([node, str(launcher), "stop", "--data-dir", str(data)], env=child_env,
                           capture_output=True, check=True, timeout=30)
            child.wait(timeout=30)
        except (subprocess.SubprocessError, OSError):
            child.terminate()
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=15)
        child = None

    fixture = output / "qe-fixture"
    try:
        prepare_fixture(args.qe_fixture, fixture)
    except Exception as error:
        # Absent reference fails its gates, without hiding independent MD checks.
        write_json(output / "qe-fixture-error.json", {"passed": False, "error": f"{type(error).__name__}: {error}"})
    try:
        if not node or not npm:
            raise RuntimeError("Node.js >=22.13 with npm is required to execute this release gate.")
        launcher_manifest = archive_json(args.launcher_tarball, "distribution.json")
        native_manifest = archive_json(args.runtime_tarball, "distribution.json")
        if launcher_manifest.get("schemaVersion") != 2 or launcher_manifest.get("kind") != "launcher" or native_manifest.get("kind") != "runtime":
            raise ValueError("Qualification requires real schema-2 launcher and native runtime packages.")
        if native_manifest.get("source") != launcher_manifest.get("source") or native_manifest.get("version") != launcher_manifest.get("version"):
            raise ValueError("Launcher and native runtime must identify the same public source commit/version.")
        report.update(version=launcher_manifest["version"], sourceCommit=launcher_manifest["source"]["commit"])
        environment_script = """const fs=require('node:fs'),os=require('node:os');
const kernel=process.platform==='linux'?fs.readFileSync('/proc/sys/kernel/osrelease','utf8').trim():os.release();
console.log(JSON.stringify({platform:process.platform,arch:process.arch,nodeVersion:process.version,kernelRelease:kernel,wsl2:process.platform==='linux'&&/microsoft.*wsl2/i.test(kernel),...(process.platform==='linux'?{glibcVersion:process.report.getReport().header.glibcVersionRuntime}:{})}));"""
        result = subprocess.run([node, "-e", environment_script], env=child_env, capture_output=True, text=True, check=True, timeout=15)
        environment = json.loads(result.stdout)
        report["environment"] = environment
        target = environment["platform"] + "-" + environment["arch"]
        report["target"] = ("wsl2-" if environment["wsl2"] else "") + target
        if native_manifest.get("target") != target:
            raise ValueError("This tarball is for another OS/architecture; qualification must run natively.")
        version = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+).*", environment["nodeVersion"])
        if not version or tuple(map(int, version.groups())) < (22, 13, 0):
            raise ValueError("Node.js >=22.13 is required.")
        if environment["platform"] == "linux":
            glibc = re.fullmatch(r"(\d+)\.(\d+).*", environment.get("glibcVersion", ""))
            if not glibc or tuple(map(int, glibc.groups())) < (2, 39):
                raise ValueError("Scientific qualification requires the declared Linux/WSL2 glibc >=2.39 baseline.")
        with (output / "npm-install.log").open("w") as log:
            subprocess.run([npm, "install", "--prefix", str(install), "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
                            "--userconfig", str(home / "npmrc"), "--cache", str(output / "npm-cache"),
                            str(args.launcher_tarball), str(args.runtime_tarball)], cwd=output,
                           env={**child_env, "PATH": os.environ.get("PATH", "")}, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=120)
        package_root = launcher.parent.parent
        metadata = subprocess.run([node, "--input-type=module", "-e", distribution_metadata_script(), str(package_root)], env=child_env,
                                  capture_output=True, text=True, timeout=60, check=True)
        distribution = json.loads(metadata.stdout)
        core = Path(distribution["executable"])
        if distribution.get("bootstrap"):
            child_env["PHYNITE_NATIVE_TOOLS_DIR"] = distribution["bootstrap"]
        with core.open("rb") as source:
            if source.read(4).hex() not in {"7f454c46", "cffaedfe", "feedfacf", "cefaedfe", "feedface", "cafebabe", "bebafeca"}:
                raise ValueError("Qualification requires a genuine frozen native executable.")
        write_json(output / "native-identity.json", {"sha256": digest(core), "manifest": native_manifest})
        origin, token = start_application()
        inventory = []
        for component in INSTALL_COMPONENTS:
            print(f"Installing approved {component} runtime...", flush=True)
            request_json(origin, token, "/__local/runtime/install", {"component": component})
            deadline = time.monotonic() + args.timeout_seconds
            while time.monotonic() < deadline:
                state = request_json(origin, token, "/__local/runtime")
                progress = state.get("runtime", {}).get("progress", {})
                if progress.get("state") == "failed":
                    raise RuntimeError(f"The actual {component} installer failed: {progress.get('error', 'inspect native installer logs')}")
                if progress.get("state") == "complete" and component in state.get("runtime", {}).get("installed", {}):
                    inventory.append({"component": component, "runtime": state["runtime"]})
                    print(f"PASS runtime installation: {component}", flush=True)
                    break
                if child.poll() is not None:
                    raise RuntimeError("The installed application stopped during runtime setup.")
                time.sleep(1)
            else:
                raise RuntimeError(f"The real {component} installation exceeded its bounded timeout.")
        path = output / "runtime-install.json"
        write_json(path, {"installation": "Installed native core /__local/runtime/install endpoint", "states": inventory})
        report["checks"].append({"id": "runtime-install", "status": "passed", "execution": {"returnCode": 0}, "attachments": [attachment(output, path, "output"), attachment(output, output / "native-identity.json", "provenance")]})
        application = ApplicationQualification(output, fixture, origin, token, args.timeout_seconds)
        try:
            report["checks"].append(application.qe())
        except Exception as error:
            report["checks"].append(failed_check(output, "app-qe-queue-reference", f"{type(error).__name__}: {error}"))
        try:
            application.queued_cancel()
        except Exception as error:
            report["checks"].append(failed_check(output, "app-queued-cancel-restart", f"{type(error).__name__}: {error}"))
            application.cancelled = None
    except Exception as error:
        runtime_error = f"{type(error).__name__}: {error}"
        report["checks"].append(failed_check(output, "runtime-install", runtime_error))
    finally:
        stop_application()
    if application is not None and application.cancelled:
        try:
            origin, token = start_application()
            report["checks"].append(application.after_restart(origin, token))
        except Exception as error:
            report["checks"].append(failed_check(output, "app-queued-cancel-restart", f"{type(error).__name__}: {error}"))
        finally:
            stop_application()
    if core is not None:
        try:
            command = [str(core), "--qualify-science", "--data-dir", str(data), "--output", str(output / "checks"),
                       "--qe-fixture", str(fixture), "--timeout-seconds", str(args.timeout_seconds)]
            with (output / "qualification-core.log").open("w") as log:
                subprocess.run(command, env=child_env, cwd=output, stdout=log, stderr=subprocess.STDOUT,
                               timeout=args.timeout_seconds * 5 + 300, check=False)
            fragment = json.loads((output / "checks/checks.json").read_text())
            for check in fragment["checks"]:
                for item in check.get("attachments", []):
                    item["path"] = "checks/" + item["path"]
                report["checks"].append(check)
                print(f"{check['status'].upper()} {check['id']}" + (f": {check.get('error', 'inspect qualification diagnostics')}" if check['status'] != 'passed' else ''), flush=True)
        except Exception as error:
            runtime_error = f"Native qualification could not finish: {type(error).__name__}: {error}"
    present = {check["id"] for check in report["checks"]}
    for check_id in CHECKS:
        if check_id not in present:
            report["checks"].append(failed_check(output, check_id, runtime_error or "The installed native qualification did not produce this required check."))
    report["passed"] = len(report["checks"]) == len(CHECKS) and {check["id"] for check in report["checks"]} == set(CHECKS) and all(check["status"] == "passed" for check in report["checks"])
    write_json(output / "report.json", report)
    print(str(output / "report.json"))
    return 0 if report["passed"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--launcher-tarball", type=Path, required=True)
    parser.add_argument("--runtime-tarball", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New evidence directory; must not exist")
    parser.add_argument("--qe-fixture", type=Path, default=Path(__file__).resolve().parents[1] / "distribution/qualification/qe")
    parser.add_argument("--timeout-seconds", type=int, default=3600, help="Bound per installation/scientific run")
    args = parser.parse_args()
    if not 30 <= args.timeout_seconds <= 14400:
        parser.error("Choose a timeout from 30 to 14400 seconds.")
    args.launcher_tarball = args.launcher_tarball.expanduser().resolve(strict=True)
    args.runtime_tarball = args.runtime_tarball.expanduser().resolve(strict=True)
    return qualify(args)


if __name__ == "__main__":
    raise SystemExit(main())
