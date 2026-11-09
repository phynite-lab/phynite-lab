"""Remote Slurm/OpenPBS dispatch with evidence-preserving recovery.

This module is used only by a local worker.  It never runs in the hosted
Next/Cloudflare process and it never turns a missing/uncertain scheduler reply
into a second submission.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import tempfile
import threading
from pathlib import Path
from typing import Any

try:
    from .hpc import HpcError, job_id, launcher_template
    from .hpc_ssh import HpcSshConnection, HpcSshError
    from .recovery import atomic_json, canonical_digest
except ImportError:
    from hpc import HpcError, job_id, launcher_template
    from hpc_ssh import HpcSshConnection, HpcSshError
    from recovery import atomic_json, canonical_digest

SPARSE_HARVEST_EXTENSIONS = {".xml", ".out", ".err", ".log", ".json", ".dat", ".png", ".svg", ".csv", ".gz", ".txt"}
DISALLOWED_HARVEST_PATTERNS = [r"^wfc.*\.dat$", r"^charge-density.*\.dat$", r"^atomic_occupations.*\.dat$", r".*\.save/K[0-9]+/.*\.dat$"]
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}$")
SAFE_MODULE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+@:/-]{0,127}$")
SAFE_SHA = re.compile(r"^[a-f0-9]{64}$")
TERMINAL_STATES = {"COMPLETED", "FAILED", "TIMEOUT", "CANCELLED", "NODE_FAIL", "PREEMPTED", "OUT_OF_MEMORY", "BOOT_FAIL", "DEADLINE", "REVOKED", "C", "F", "E", "X"}
MAX_HARVEST_BYTES = 64 * 1024 * 1024


def profile_sha256(profile: dict[str, Any]) -> str:
    """Digest a profile exactly as the local control plane does."""
    return canonical_digest({key: value for key, value in profile.items() if key != "profileSha256"})


def _safe_calculation_id(value: str) -> str:
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        raise HpcError("Calculation ID is invalid.")
    return value


def _safe_remote_path(value: str) -> str:
    parts = value.split("/") if isinstance(value, str) else []
    if not isinstance(value, str) or not value.startswith("/") or any(part in {".", ".."} for part in parts) or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise HpcError("Remote scratch path must be absolute and free of traversal.")
    return value.rstrip("/") or "/"


def _safe_filename(value: str) -> str:
    parts = value.split("/") if isinstance(value, str) else []
    if not isinstance(value, str) or not value or value.startswith("/") or value.endswith("/") or any(part in {"", ".", ".."} for part in parts) or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise HpcError("Input filename contains traversal or control characters.")
    return value


def _module_name(value: str) -> str | None:
    value = value.strip()
    if value == "module purge":
        return None
    if value.startswith("module load "):
        value = value[len("module load "):].strip()
    if not SAFE_MODULE.fullmatch(value) or any(char in value for char in ";&|`$()<>\\\"'\n\r\t"):
        raise HpcError("Environment modules must be safe module names.")
    return value


def is_sparse_harvest_target(filename: str, retain_wavefunctions: bool = False) -> bool:
    base = os.path.basename(filename)
    normalized = filename.replace("\\", "/")
    if not retain_wavefunctions and any(re.fullmatch(pattern, candidate) for pattern in DISALLOWED_HARVEST_PATTERNS for candidate in (base, normalized)):
        return False
    return Path(filename).suffix.lower() in SPARSE_HARVEST_EXTENSIONS or base in {"total-energy.dat", "manifest.sha256"}


class HpcRemoteJobManager:
    """Manage one remote QE allocation over a multiplexed SSH connection."""

    def __init__(self, connection: HpcSshConnection, profile: dict[str, Any], allocation: dict[str, Any] | None = None) -> None:
        self.connection = connection
        self.profile = profile
        self.scheduler = profile.get("scheduler", "slurm")
        if self.scheduler not in {"slurm", "pbs"}:
            raise HpcError("Scheduler must be slurm or pbs.")
        self.last_harvest_manifest_validated = False
        self.allocation = {**profile.get("defaults", {}), **(allocation or {})}
        self.calculation_id: str | None = None
        self.calculation_type: str | None = None

    def _remote_dir(self, value: str) -> str:
        return _safe_remote_path(value)

    def _modules(self) -> list[str]:
        values = self.profile.get("runtime", {}).get("environmentModules", [])
        if not isinstance(values, list):
            raise HpcError("Environment modules are invalid.")
        result: list[str] = []
        for value in values:
            if not isinstance(value, str):
                raise HpcError("Environment modules are invalid.")
            name = _module_name(value)
            if name and name not in result:
                result.append(name)
        return result

    def render_remote_script(self, calculation_id: str, remote_work_dir: str) -> str:
        calculation_id = _safe_calculation_id(calculation_id)
        self.calculation_id = calculation_id
        remote_work_dir = self._remote_dir(remote_work_dir)
        defaults = self.allocation
        nodes, ranks_per_node = int(defaults.get("nodes", 1)), int(defaults.get("ranksPerNode", 32))
        total_ranks, wall_seconds = nodes * ranks_per_node, int(defaults.get("wallSeconds", 14400))
        memory_mib, queue, account = int(defaults.get("memoryMiBPerNode", 65536)), defaults.get("queue"), defaults.get("account")
        if not 1 <= nodes <= 4096 or not 1 <= ranks_per_node <= 1024 or total_ranks > 65536 or not 300 <= wall_seconds <= 5_184_000 or not 1024 <= memory_mib <= 16_777_216:
            raise HpcError("HPC allocation defaults are outside the supported bounds.")
        for label, value in (("queue", queue), ("account", account)):
            if value is not None and (not isinstance(value, str) or not SAFE_ID.fullmatch(value)):
                raise HpcError(f"{label} contains unsupported characters.")
        hours, remainder = divmod(wall_seconds, 3600); minutes, seconds = divmod(remainder, 60)
        wall = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        if self.scheduler == "slurm":
            directives = [f"#SBATCH --job-name=phynite-{calculation_id[:40]}", f"#SBATCH --nodes={nodes}", f"#SBATCH --ntasks={total_ranks}", f"#SBATCH --ntasks-per-node={ranks_per_node}", "#SBATCH --cpus-per-task=1", f"#SBATCH --mem={memory_mib}M", f"#SBATCH --time={wall}", f"#SBATCH --output={remote_work_dir}/job-%j.out", f"#SBATCH --error={remote_work_dir}/job-%j.err", "#SBATCH --signal=B:TERM@60", "#SBATCH --no-requeue"]
            if queue: directives.append(f"#SBATCH --partition={queue}")
            if account: directives.append(f"#SBATCH --account={account}")
        else:
            directives = [f"#PBS -N phynite-{calculation_id[:15]}", f"#PBS -l select={nodes}:ncpus={ranks_per_node}:mpiprocs={ranks_per_node}:ompthreads=1:mem={memory_mib}mb", f"#PBS -l walltime={wall}", "#PBS -r n", f"#PBS -o {remote_work_dir}/job.out", f"#PBS -e {remote_work_dir}/job.err"]
            if queue: directives.append(f"#PBS -q {queue}")
            if account: directives.append(f"#PBS -A {account}")
        runtime = self.profile.get("runtime", {})
        launcher = launcher_template(runtime.get("mpiLauncher", ["srun", "--mpi=pmix", "--ntasks={ranks}"] if self.scheduler == "slurm" else ["mpiexec", "-n", "{ranks}"]))
        if (Path(launcher[0]).name != ("srun" if self.scheduler == "slurm" else "mpiexec")):
            raise HpcError("MPI launcher does not match the scheduler.")
        environment = {
            "PHYNITE_WORK_DIR": remote_work_dir,
            "PHYNITE_CALCULATION_ID": calculation_id,
            "PHYNITE_VCPUS": str(total_ranks),
            "PHYNITE_MEMORY_MIB": str(memory_mib * nodes),
            "PHYNITE_HPC_SCHEDULER": self.scheduler,
            "PHYNITE_HPC_MAX_RANKS": str(total_ranks),
            "PHYNITE_MPI_LAUNCHER": json.dumps(launcher),
            "PHYNITE_EXECUTION_MODE": "remote-hpc",
            "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1",
        }
        # The same source-bound scientific runner used by personal QE creates
        # result.json and validates the exact input/pseudopotential identity.
        return "\n".join(["#!/bin/bash", *directives, "set -euo pipefail", "umask 077", f"cd {shlex.quote(remote_work_dir)}", "", "# Load verified module names", *[f"module load {shlex.quote(name)}" for name in self._modules()], *[f"export {key}={shlex.quote(value)}" for key, value in environment.items()], "python3 runners/local_runner.py > runner.out 2>&1 || STATUS=$?", "STATUS=${STATUS:-0}", "mkdir -p results", "cp runner.out results/runner.out", "python3 runners/hpc_manifest.py", "exit $STATUS", ""])

    def _receipt(self, receipt_path: Path, value: dict[str, Any], *, overwrite: bool = True) -> None:
        atomic_json(receipt_path, value, overwrite=overwrite)

    def submit_job(self, calculation_id: str, input_files: dict[str, str | bytes | Path], receipt_dir: Path | None = None) -> dict[str, Any]:
        calculation_id = _safe_calculation_id(calculation_id)
        if not isinstance(input_files, dict) or not input_files:
            raise HpcError("Remote input files are required.")
        for filename, data in input_files.items():
            _safe_filename(filename)
            if not isinstance(data, (str, bytes, Path)) or isinstance(data, Path) and (not data.is_file() or data.is_symlink()):
                raise HpcError("Remote input file content is invalid.")
        storage = self.profile.get("storage", {})
        scratch_root = _safe_remote_path(storage.get("scratchRoot", "/tmp/phynite-work"))
        owner_id = self.profile.get("ownerId", "local")
        if not isinstance(owner_id, str) or not SAFE_ID.fullmatch(owner_id):
            raise HpcError("Profile owner ID is invalid.")
        remote_work_dir = f"{scratch_root}/{owner_id}/{calculation_id}"
        receipt_root = receipt_dir or Path(self.profile.get("receiptDir", Path(tempfile.gettempdir()) / "phynite-hpc-receipts"))
        receipt_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        receipt_path = receipt_root / f"{calculation_id}.json"
        if receipt_path.exists():
            raise HpcError("Submission receipt already exists; reconcile it before retrying.")
        code, _, stderr = self.connection.run_command(["mkdir", "-p", remote_work_dir])
        if code != 0:
            raise HpcError(f"Could not create remote scratch directory: {stderr.strip()}")
        script_content = self.render_remote_script(calculation_id, remote_work_dir)
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            for filename, data in {**input_files, "submit.sh": script_content}.items():
                path = root / filename; path.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(data, Path):
                    import shutil
                    shutil.copyfile(data, path)
                elif isinstance(data, str):
                    path.write_text(data, encoding="utf-8")
                else:
                    path.write_bytes(data)
                code, _, _ = self.connection.run_command(["mkdir", "-p", str(Path(f"{remote_work_dir}/{filename}").parent)])
                if code != 0:
                    raise HpcError("Could not create a remote input directory.")
                self.connection.sftp_upload(path, f"{remote_work_dir}/{filename}")
        content = self.render_remote_script(calculation_id, remote_work_dir)
        receipt = {"version": 1, "calculationId": calculation_id, "scheduler": self.scheduler, "profileSha256": profile_sha256(self.profile), "allocation": self.allocation, "scriptSha256": hashlib.sha256(content.encode()).hexdigest(), "remoteWorkDir": remote_work_dir, "state": "submission-uncertain"}
        self._receipt(receipt_path, receipt, overwrite=False)
        submit_cmd = ["sbatch", "--parsable", f"{remote_work_dir}/submit.sh"] if self.scheduler == "slurm" else ["qsub", f"{remote_work_dir}/submit.sh"]
        try:
            code, stdout, stderr = self.connection.run_command(submit_cmd)
            if code != 0:
                raise HpcError(f"Remote scheduler submission failed: {stderr.strip()}")
            raw_id = stdout.strip().splitlines()[-1].split(";", 1)[0]
            scheduler_job_id = job_id(raw_id, self.scheduler)
        except (HpcError, HpcSshError, IndexError) as exc:
            # Keep the uncertain receipt and remote scratch for explicit
            # reconciliation; never issue a second scheduler request here.
            raise HpcError(f"Remote submission is uncertain; reconcile {receipt_path.name} before retrying.") from exc
        receipt.update({"schedulerJobId": scheduler_job_id, "state": "submitted"})
        self._receipt(receipt_path, receipt)
        return receipt

    def poll_job(self, scheduler_job_id: str) -> dict[str, Any]:
        identifier = job_id(scheduler_job_id, self.scheduler)
        if self.scheduler == "slurm":
            code, stdout, stderr = self.connection.run_command(["sacct", "--noheader", "--parsable2", "--allocations", "--jobs", identifier, "--format", "JobIDRaw,State,ExitCode"])
            if code != 0: raise HpcError(f"Remote sacct command failed: {stderr.strip()}")
            entries = [row.split("|") for row in stdout.splitlines() if row.split("|", 1)[0] == identifier]
            if not entries:
                q_code, q_out, _ = self.connection.run_command(["squeue", "--noheader", "--format=%T", "--jobs", identifier])
                return {"schedulerJobId": identifier, "state": q_out.strip() if q_code == 0 and q_out.strip() else "UNKNOWN", "exitCode": "", "terminal": False}
            if len(entries[-1]) < 3: raise HpcError("Slurm returned an invalid status response.")
            raw_state, raw_exit = entries[-1][1:3]; state = raw_state.split()[0].rstrip("+"); exit_code = raw_exit.split(":", 1)[0]
        else:
            code, stdout, _ = self.connection.run_command(["qstat", "-x", "-f", "-F", "json", identifier])
            if code != 0: return {"schedulerJobId": identifier, "state": "UNKNOWN", "exitCode": "", "terminal": False}
            try:
                data = json.loads(stdout)["Jobs"][identifier]; state = str(data.get("job_state", "UNKNOWN")); exit_code = str(data.get("Exit_status", ""))
            except (KeyError, TypeError, ValueError) as exc: raise HpcError("PBS returned an invalid status response.") from exc
        return {"schedulerJobId": identifier, "state": state, "exitCode": exit_code, "terminal": state in TERMINAL_STATES}

    def sparse_harvest(self, remote_work_dir: str, local_destination: Path, retain_wavefunctions: bool = False) -> list[str]:
        remote_work_dir = self._remote_dir(remote_work_dir); local_destination.mkdir(mode=0o700, parents=True, exist_ok=True)
        results_dir = remote_work_dir + "/results"
        code, stdout, _ = self.connection.run_command(["find", results_dir, "-type", "f", "-printf", "%P\n"])
        if code != 0: return []
        harvested: list[str] = []
        total = 0
        for filename in (item.strip() for item in stdout.splitlines() if item.strip()):
            try: _safe_filename(filename)
            except HpcError: continue
            if not is_sparse_harvest_target(filename, retain_wavefunctions): continue
            size_code, size_out, _ = self.connection.run_command(["stat", "-c", "%s", f"{results_dir}/{filename}"])
            if size_code != 0:
                continue
            if size_code == 0:
                try:
                    size = int(size_out.strip())
                    if not 0 <= size <= MAX_HARVEST_BYTES or total + size > 256 * 1024 * 1024:
                        continue
                except ValueError:
                    continue
            destination = local_destination / filename
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            try:
                self.connection.sftp_download(f"{results_dir}/{filename}", destination); harvested.append(filename); total += size
            except HpcSshError: continue
        self.last_harvest_manifest_validated = self.validate_manifest(local_destination)
        return harvested

    @staticmethod
    def validate_manifest(directory: Path) -> bool:
        manifest = directory / "manifest.sha256"
        if not manifest.is_file(): return False
        try:
            seen = False
            for line in manifest.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                parts = line.strip().split(None, 1)
                if len(parts) != 2 or not SAFE_SHA.fullmatch(parts[0]) or _safe_filename(parts[1]) is None: return False
                path = directory / parts[1]
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != parts[0]: return False
                seen = True
            return seen
        except (OSError, UnicodeError, HpcError): return False

    def purge_wavefunctions_after_completion(self, remote_work_dir: str, status: dict[str, Any], manifest_validated: bool) -> bool:
        if not self.profile.get("storage", {}).get("purgeWavefunctions") or not status.get("terminal") or status.get("state") not in {"COMPLETED", "C", "F"} or str(status.get("exitCode", "")) not in {"0", "0:0"} or not manifest_validated:
            return False
        code, _, _ = self.connection.run_command(["find", self._remote_dir(remote_work_dir), "-maxdepth", "1", "-type", "f", "-name", "wfc*.dat", "-delete"])
        return code == 0

    def harvest_completed(self, scheduler_job_id: str, remote_work_dir: str, local_destination: Path, retain_wavefunctions: bool = False) -> dict[str, Any]:
        status = self.poll_job(scheduler_job_id)
        if not status.get("terminal"):
            return {"state": "running", "status": status, "files": []}
        if status.get("state") not in {"COMPLETED", "C", "F"} or str(status.get("exitCode", "")) not in {"0", "0:0"}:
            return {"state": "manual-resume-required", "status": status, "files": [], "reason": "Scheduler ended without a verified successful exit code; scratch and checkpoints were retained."}
        files = self.sparse_harvest(remote_work_dir, local_destination, retain_wavefunctions)
        if not self.last_harvest_manifest_validated:
            return {"state": "manual-resume-required", "status": status, "files": files, "reason": "Result manifest is missing or failed checksum validation; scratch and checkpoints were retained."}
        try:
            from backend.compute.qe_model import dft_result_error
            manifest = json.loads((local_destination / "result.json").read_text())
            failure = dft_result_error(manifest, self.calculation_type or str(manifest.get("calculationType", "")))
            if self.calculation_id and manifest.get("calculationId") != self.calculation_id:
                raise ValueError("The remote result identifies a different calculation.")
            if manifest.get("status") != "completed" or failure:
                raise ValueError(failure or "The scientific runner did not complete successfully.")
        except (OSError, ValueError, TypeError) as exc:
            return {"state": "manual-resume-required", "status": status, "files": files, "reason": f"Scientific result validation failed: {exc}; scratch and checkpoints were retained."}
        self.purge_wavefunctions_after_completion(remote_work_dir, status, True)
        return {"state": "completed", "status": status, "files": files, "manifestValidated": True}

    def check_and_prepare_restart(self, remote_work_dir: str) -> dict[str, Any]:
        remote_work_dir = self._remote_dir(remote_work_dir)
        code, stdout, _ = self.connection.run_command(["find", remote_work_dir, "-maxdepth", "2", "-type", "f", "-name", "data-file-schema.xml", "-print"])
        if code != 0 or not stdout.strip():
            return {"canRestart": False, "state": "manual-resume-required", "reason": "Checkpoint XML schema is missing or incomplete; scratch was retained."}
        return {"canRestart": True, "state": "manual-resume-required", "restartMode": "restart", "message": "A checkpoint was detected. Inspect and explicitly verify restart_mode='restart' before submitting a new job."}


def fetch_profile_snapshot(client: Any, cluster_id: str, checksum: str) -> dict[str, Any]:
    """Fetch and verify one immutable profile through the worker endpoint."""
    if not SAFE_ID.fullmatch(cluster_id) or not SAFE_SHA.fullmatch(checksum):
        raise HpcError("HPC profile identity is invalid.")
    reply = client.get(f"/__local/hpc/clusters/{cluster_id}/snapshot/{checksum}")
    profile = reply.get("profile") if isinstance(reply, dict) else None
    if not isinstance(profile, dict) or profile_sha256(profile) != checksum:
        raise HpcError("The worker received an HPC profile with a mismatched checksum.")
    if profile.get("id") != cluster_id:
        raise HpcError("The worker received a profile for a different cluster.")
    return profile


class HpcRemoteWorker:
    """Small, explicit remote QE worker loop used by local allocations."""

    def __init__(self, client: Any, worker_id: str, cluster_id: str, profile_sha256_value: str, manager_factory=HpcRemoteJobManager, workspace_builder=None) -> None:
        self.client = client
        self.worker_id = _safe_calculation_id(worker_id)
        self.cluster_id = cluster_id
        self.profile_sha256 = profile_sha256_value
        self.manager_factory = manager_factory
        self.workspace_builder = workspace_builder
        self.scheduler = "slurm"

    def claim(self, calculation_id: str | None) -> dict[str, Any] | None:
        if calculation_id is not None:
            calculation_id = _safe_calculation_id(calculation_id)
        payload: dict[str, Any] = {
            "workerId": self.worker_id,
            "capabilities": ["qe"],
            "executionAffinity": {"scheduler": self.scheduler, "profileSha256": self.profile_sha256},
        }
        if calculation_id is not None:
            payload["requestedCalculationId"] = calculation_id
        reply = self.client.post("/worker/v1/jobs/claim", payload)
        job = reply.get("job") if isinstance(reply, dict) else None
        return job if isinstance(job, dict) else None

    def _heartbeat(self, job: dict[str, Any], progress: int, stage: str) -> None:
        """Keep the owner job lease alive while the remote scheduler runs."""
        try:
            reply = self.client.post(
                f"/worker/v1/jobs/{job['calculationId']}/heartbeat",
                {
                    "workerId": self.worker_id,
                    "ownerId": job["ownerId"],
                    "kind": job.get("kind", "qe"),
                    "progress": max(12, min(99, int(progress))),
                    "computePhase": "COMPUTING",
                    "stage": stage,
                    "logTail": "Remote scheduler execution is being polled.",
                },
            )
            if reply.get("cancelRequested"):
                raise HpcError("Cancellation requested. Reconcile or cancel the remote allocation explicitly; scratch/checkpoints were retained.")
        except Exception as exc:
            raise HpcError("The local worker lost its job lease while polling the remote scheduler.") from exc

    def run_once(self, calculation_id: str | None, connection: HpcSshConnection, destination: Path, *, poll_seconds: float = 10, max_polls: int = 720) -> dict[str, Any]:
        profile = fetch_profile_snapshot(self.client, self.cluster_id, self.profile_sha256)
        if profile.get("scheduler") not in {"slurm", "pbs"}:
            raise HpcError("Only Slurm and OpenPBS remote QE jobs are supported.")
        self.scheduler = str(profile["scheduler"])
        job = self.claim(calculation_id) if calculation_id else self.claim_any()
        if job is None:
            return {"state": "no-job"}
        if str(job.get("kind") or "qe") != "qe":
            raise HpcError("Remote LAMMPS is not enabled; release this job for personal MD compute.")
        payload = job.get("input") if isinstance(job.get("input"), dict) else {}
        job_destination = destination if destination.name == job["calculationId"] else destination / job["calculationId"]
        stopped = threading.Event()
        heartbeat_failure: list[Exception] = []
        def heartbeat_loop():
            while not stopped.wait(15):
                try:
                    self._heartbeat(job, 15, "REMOTE_SCHEDULER")
                except Exception as exc:
                    heartbeat_failure.append(exc)
                    return
        heartbeat = threading.Thread(target=heartbeat_loop, daemon=True)
        heartbeat.start()
        try:
            allocation = (payload.get("settings") or {}).get("hpcAllocation") or profile.get("defaults", {})
            if (int(allocation["nodes"]) * int(allocation["ranksPerNode"]) != int(job["vcpus"])
                    or int(allocation["nodes"]) * int(allocation["memoryMiBPerNode"]) != int(job["memoryMiB"])):
                raise HpcError("The frozen HPC allocation differs from the accepted job resources.")
            manager = self.manager_factory(connection, profile, allocation)
            manager.calculation_type = str(payload.get("calculationType", ""))
            if self.workspace_builder is None:
                raise HpcError("Remote QE requires the source-bound scientific runner and verified pseudopotentials.")
            if (job_destination / "receipts" / f"{job['calculationId']}.json").exists():
                raise HpcError("Submission receipt already exists; reconcile it before retrying.")
            files = self.workspace_builder(job, job_destination / "inputs")
            if heartbeat_failure:
                raise heartbeat_failure[0]
            receipt = manager.submit_job(job["calculationId"], files, job_destination / "receipts")
            max_polls = max(max_polls, int((int(allocation["wallSeconds"]) + 600) / max(1, poll_seconds)))
            for poll_index in range(max(1, max_polls)):
                if heartbeat_failure:
                    raise heartbeat_failure[0]
                self._heartbeat(job, min(95, 15 + round(75 * poll_index / max(1, max_polls))), "REMOTE_SCHEDULER")
                status = manager.poll_job(receipt["schedulerJobId"])
                if status.get("terminal"):
                    result = manager.harvest_completed(receipt["schedulerJobId"], receipt["remoteWorkDir"], job_destination / "results")
                    result["receipt"] = receipt
                    result["job"] = job
                    return result
                import time
                time.sleep(max(0.1, poll_seconds))
            return {"state": "manual-resume-required", "job": job, "receipt": receipt, "reason": "Scheduler polling timed out; scratch/checkpoints were retained."}
        except Exception as exc:
            # A receipt is durable before sbatch/qsub is called. Keep the job
            # terminal in Phynite only after recording this explicit manual
            # reconciliation state; a retry must never submit automatically.
            return {"state": "manual-resume-required", "job": job, "reason": str(exc), "scratchRetained": True}
        finally:
            stopped.set()
            heartbeat.join(timeout=1)

    def claim_any(self) -> dict[str, Any] | None:
        """Claim one QE job for this exact owner/profile affinity."""
        reply = self.client.post(
            "/worker/v1/jobs/claim",
            {
                "workerId": self.worker_id,
                "capabilities": ["qe"],
                "executionAffinity": {"scheduler": self.scheduler, "profileSha256": self.profile_sha256},
            },
        )
        job = reply.get("job") if isinstance(reply, dict) else None
        return job if isinstance(job, dict) else None
