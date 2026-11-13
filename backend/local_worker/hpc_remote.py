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
import time
import urllib.error
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

try:
    from .hpc import HpcError, job_id, launcher_template
    from .hpc_ssh import HpcSshConnection, HpcSshError, PYTHON_CANDIDATE_GLOBS
    from .recovery import atomic_json, canonical_digest
except ImportError:
    from hpc import HpcError, job_id, launcher_template
    from hpc_ssh import HpcSshConnection, HpcSshError, PYTHON_CANDIDATE_GLOBS
    from recovery import atomic_json, canonical_digest

SPARSE_HARVEST_EXTENSIONS = {
    ".xml", ".out", ".err", ".log", ".json", ".dat", ".png", ".svg", ".pdf",
    ".csv", ".gz", ".txt", ".in", ".gnu", ".gp", ".freq", ".trace",
    ".condtens", ".halltens", ".bt2", ".btj",
}
DISALLOWED_HARVEST_PATTERNS = [r"^wfc.*\.dat$", r"^charge-density.*\.dat$", r"^atomic_occupations.*\.dat$", r".*\.save/K[0-9]+/.*\.dat$"]
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}$")
SAFE_MODULE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+@:/-]{0,127}$")
SAFE_SHA = re.compile(r"^[a-f0-9]{64}$")
TERMINAL_STATES = {"COMPLETED", "FAILED", "TIMEOUT", "CANCELLED", "NODE_FAIL", "PREEMPTED", "OUT_OF_MEMORY", "BOOT_FAIL", "DEADLINE", "REVOKED", "C", "F", "E", "X"}
MAX_HARVEST_BYTES = 256 * 1024 * 1024


class MonitoringDeferred(HpcError):
    """Temporary transport loss; preserve the active job for receipt resumption."""


class LeaseLost(HpcError):
    """The control plane explicitly rejected this worker's ownership."""


@dataclass
class _HeartbeatLease:
    deadline: float
    stopped: threading.Event = field(default_factory=threading.Event)
    lock: Any = field(default_factory=threading.Lock)


def _transient_api_error(exc: Exception) -> bool:
    cause = exc
    while cause is not None:
        if isinstance(cause, urllib.error.HTTPError):
            return cause.code in {408, 429} or 500 <= cause.code < 600
        if isinstance(cause, (TimeoutError, ConnectionError, urllib.error.URLError)):
            return True
        cause = cause.__cause__
    return False


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
    return (
        Path(filename).suffix.lower() in SPARSE_HARVEST_EXTENSIONS
        or base in {"total-energy.dat", "manifest.sha256"}
        or ".pdos" in base
    )


class HpcRemoteJobManager:
    """Manage one remote QE allocation over a multiplexed SSH connection."""

    def __init__(self, connection: HpcSshConnection, profile: dict[str, Any], allocation: dict[str, Any] | None = None, settings: dict[str, Any] | None = None) -> None:
        self.connection = connection
        self.profile = profile
        self.scheduler = profile.get("scheduler", "slurm")
        if self.scheduler not in {"slurm", "pbs"}:
            raise HpcError("Scheduler must be slurm or pbs.")
        self.last_harvest_manifest_validated = False
        self.allocation = {**profile.get("defaults", {}), **(allocation or {})}
        self.remote_scf_staged = False
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

    def _scheduler_command(self, argv: list[str]) -> tuple[int, str, str]:
        """Use the probed module environment; exclude login/module banners."""
        modules = self._modules()
        marker = "PHYNITE_SCHEDULER_" + uuid.uuid4().hex
        begin, end = marker + "_BEGIN", marker + "_END"
        commands = [f"module load {shlex.quote(name)} >&2 || exit $?" for name in modules]
        commands.extend([
            f"printf '\\n%s\\n' {shlex.quote(begin)}",
            f"if {shlex.join(argv)}; then _ph_status=0; else _ph_status=$?; fi",
            f"printf '\\n%s\\n' {shlex.quote(end)}",
            'exit "$_ph_status"',
        ])
        code, stdout, stderr = self.connection.run_command(["bash" if modules else "sh", "-lc" if modules else "-c", "; ".join(commands)])
        lines = stdout.splitlines()
        if begin not in lines or end not in lines or lines.index(end) <= lines.index(begin):
            if code != 0:
                return code, "", stderr
            raise HpcError("Remote scheduler returned incomplete framed output.")
        return code, "\n".join(lines[lines.index(begin) + 1:lines.index(end)]).strip(), stderr

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
        allowed_launchers = {"srun", "mpiexec", "mpirun"} if self.scheduler == "slurm" else {"mpiexec", "mpirun"}
        if Path(launcher[0]).name not in allowed_launchers:
            raise HpcError("MPI launcher does not match the scheduler.")
        raw_python = runtime.get("pythonExecutable")
        python_executable: str | None = None
        if isinstance(raw_python, str) and raw_python.strip():
            python_executable = _safe_remote_path(raw_python.strip())
            if any(char.isspace() or char in "\"'\\$`;&|()<>{}" for char in python_executable):
                raise HpcError("Python executable contains unsupported characters.")
        elif raw_python not in (None, ""):
            raise HpcError("Python executable path is invalid.")
        environment = {
            "PHYNITE_WORK_DIR": remote_work_dir,
            "PHYNITE_CALCULATION_ID": calculation_id,
            "PHYNITE_VCPUS": str(total_ranks),
            "PHYNITE_MEMORY_MIB": str(memory_mib * nodes),
            "PHYNITE_HPC_SCHEDULER": self.scheduler,
            "PHYNITE_HPC_PROFILE_SHA256": profile_sha256(self.profile),
            "PHYNITE_HPC_MAX_RANKS": str(total_ranks),
            "PHYNITE_MPI_LAUNCHER": json.dumps(launcher),
            "PHYNITE_EXECUTION_MODE": "remote-hpc",
            "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1",
        }
        py_cmd = '"$PHYNITE_PYTHON"'
        python_setup: list[str]
        if python_executable:
            python_setup = [f"export PHYNITE_PYTHON={shlex.quote(python_executable)}"]
        else:
            python_setup = [
                'export PHYNITE_PYTHON="$(command -v python3 || :)"',
                'if ! "$PHYNITE_PYTHON" -c \'import sys, numpy, scipy, matplotlib, seekpath, spglib; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)\' >/dev/null 2>&1; then',
                f'  for _ph_py in {" ".join(PYTHON_CANDIDATE_GLOBS)}; do',
                '    if [ -x "$_ph_py" ] && "$_ph_py" -c \'import sys, numpy, scipy, matplotlib, seekpath, spglib; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)\' >/dev/null 2>&1; then',
                '      export PHYNITE_PYTHON="$_ph_py"',
                '      break',
                '    fi',
                '  done',
                'fi',
            ]
        python_setup.extend([
            f"if ! {py_cmd} -c 'import sys, numpy, scipy, matplotlib, seekpath, spglib; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then",
            "  printf '%s\\n' 'Phynite requires Python >= 3.10 with working numpy, scipy, matplotlib, seekpath, and spglib. Check the HPC runtime profile.' >&2",
            "  exit 1",
            "fi",
        ])
        # The same source-bound scientific runner used by personal QE creates
        # result.json and validates the exact input/pseudopotential identity.
        return "\n".join([
            "#!/bin/bash -l" if self._modules() else "#!/bin/bash",
            *directives,
            "set -euo pipefail",
            "umask 077",
            f"cd {shlex.quote(remote_work_dir)}",
            "",
            "# Load verified module names",
            *[f"module load {shlex.quote(name)}" for name in self._modules()],
            *[f"export {key}={shlex.quote(value)}" for key, value in environment.items()],
            *python_setup,
            *([f"{py_cmd} -c " + shlex.quote(
                "import json, sys; from pathlib import Path; sys.path.insert(0, 'runners'); "
                "from workflow_scf import stage_remote_scf_archive; "
                "stage_remote_scf_archive(Path('.'), json.loads(Path('input.json').read_text())['settings']['sharedScf'])"
            )] if self.remote_scf_staged else []),
            f"{py_cmd} runners/local_runner.py > runner.out 2>&1 || STATUS=$?",
            "STATUS=${STATUS:-0}",
            "mkdir -p results",
            "cp runner.out results/runner.out",
            f"{py_cmd} runners/hpc_manifest.py",
            "exit $STATUS",
            "",
        ])

    def _receipt(self, receipt_path: Path, value: dict[str, Any], *, overwrite: bool = True) -> None:
        atomic_json(receipt_path, value, overwrite=overwrite)

    def submit_job(self, calculation_id: str, input_files: dict[str, str | bytes | Path], receipt_dir: Path | None = None, *, before_submit: Callable[[], None] | None = None) -> dict[str, Any]:
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
        if code == 255:
            raise HpcSshError("SSH connection failed while creating remote scratch.")
        if code != 0:
            raise HpcError(f"Could not create remote scratch directory: {stderr.strip()}")

        # Reuse only the exact immutable bundle admitted by the local worker.
        # An existing tmp directory or a scheduler receipt is not SCF evidence.
        self.remote_scf_staged = False
        source_calc_id = None
        raw_input = input_files.get("input.json")
        reference = None
        if raw_input is not None:
            raw_input = raw_input.read_bytes() if isinstance(raw_input, Path) else raw_input
            try:
                payload = json.loads(raw_input)
                settings = payload.get("settings", {}) if isinstance(payload, dict) else {}
                reference = settings.get("sharedScf") if isinstance(settings, dict) else None
            except (TypeError, ValueError):
                raise HpcError("Remote input.json must contain valid JSON.")
        files_to_upload = dict(input_files)
        if isinstance(reference, dict):
            source_calc_id = reference.get("calculationId")
            expected_sha = reference.get("bundleSha256")
            archive = input_files.get("dependency-0.tar.gz")
            if (isinstance(source_calc_id, str) and SAFE_ID.fullmatch(source_calc_id)
                    and source_calc_id != calculation_id and isinstance(expected_sha, str)
                    and SAFE_SHA.fullmatch(expected_sha) and archive is not None):
                digest = hashlib.sha256()
                if isinstance(archive, Path):
                    with archive.open("rb") as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b""):
                            digest.update(block)
                else:
                    digest.update(archive.encode() if isinstance(archive, str) else archive)
                if digest.hexdigest() != expected_sha:
                    raise HpcError("Shared SCF archive checksum verification failed before staging.")
                source = f"{scratch_root}/{owner_id}/{source_calc_id}/results/scf-state.tar.gz"
                target = f"{remote_work_dir}/dependency-0.tar.gz"
                # Copy the archive, never hardlink mutable QE state. Verify the
                # copy before omitting any upload, then recheck in the job.
                command = (
                    f"test -f {shlex.quote(source)} && test ! -L {shlex.quote(source)} && "
                    f"test ! -L {shlex.quote(target)} && cp -- {shlex.quote(source)} {shlex.quote(target)} && "
                    f"printf '%s  %s\\n' {shlex.quote(expected_sha)} {shlex.quote(target)} | sha256sum -c - >/dev/null"
                )
                code, _, _ = self.connection.run_command(["sh", "-c", command])
                if code == 255:
                    raise HpcSshError("SSH connection failed while verifying retained SCF state.")
                if code == 0:
                    self.remote_scf_staged = True
                    files_to_upload = {name: data for name, data in files_to_upload.items()
                                       if name != "dependency-0.tar.gz" and not name.startswith("dependencies/scf/")}
        files_to_upload["submit.sh"] = self.render_remote_script(calculation_id, remote_work_dir)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            for filename, data in files_to_upload.items():
                path = root / filename; path.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(data, Path):
                    import shutil
                    shutil.copyfile(data, path)
                elif isinstance(data, str):
                    path.write_text(data, encoding="utf-8")
                else:
                    path.write_bytes(data)
                code, _, _ = self.connection.run_command(["mkdir", "-p", str(Path(f"{remote_work_dir}/{filename}").parent)])
                if code == 255:
                    raise HpcSshError("SSH connection failed while creating a remote input directory.")
                if code != 0:
                    raise HpcError("Could not create a remote input directory.")
                self.connection.sftp_upload(path, f"{remote_work_dir}/{filename}")
        if before_submit is not None:
            before_submit()
        content = self.render_remote_script(calculation_id, remote_work_dir)
        receipt = {
            "version": 1,
            "calculationId": calculation_id,
            "scheduler": self.scheduler,
            "profileSha256": profile_sha256(self.profile),
            "allocation": self.allocation,
            "scriptSha256": hashlib.sha256(content.encode()).hexdigest(),
            "remoteWorkDir": remote_work_dir,
            "state": "submission-uncertain",
            "remoteScratchRetained": self.remote_scf_staged,
            **({"sourceCalculationId": source_calc_id} if self.remote_scf_staged else {}),
        }
        self._receipt(receipt_path, receipt, overwrite=False)
        # Workflow admission waits for verified upstream scientific results;
        # each stage receives its own allocation and durable receipt.
        submit_cmd = ["sbatch", "--parsable", f"{remote_work_dir}/submit.sh"] if self.scheduler == "slurm" else ["qsub", f"{remote_work_dir}/submit.sh"]
        try:
            code, stdout, stderr = self._scheduler_command(submit_cmd)
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
            code, stdout, stderr = self._scheduler_command(["sacct", "--noheader", "--parsable2", "--allocations", "--jobs", identifier, "--format", "JobIDRaw,State,ExitCode"])
            entries = [row.split("|") for row in stdout.splitlines() if row.split("|", 1)[0] == identifier] if code == 0 else []
            if not entries:
                q_code, q_out, q_err = self._scheduler_command(["squeue", "--noheader", "--format=%T", "--jobs", identifier])
                if q_code != 0:
                    raise HpcSshError(f"Remote scheduler status is unavailable: {q_err.strip() or stderr.strip()}")
                # squeue has no verified allocation exit code; even a terminal
                # state here must be reconciled through accounting before harvest.
                return {"schedulerJobId": identifier, "state": q_out.strip() or "UNKNOWN", "exitCode": "", "terminal": False}
            if len(entries[-1]) < 3: raise HpcError("Slurm returned an invalid status response.")
            raw_state, raw_exit = entries[-1][1:3]; state = raw_state.split()[0].rstrip("+"); exit_code = raw_exit.split(":", 1)[0]
        else:
            code, stdout, _ = self._scheduler_command(["qstat", "-x", "-f", "-F", "json", identifier])
            if code != 0: return {"schedulerJobId": identifier, "state": "UNKNOWN", "exitCode": "", "terminal": False}
            try:
                data = json.loads(stdout)["Jobs"][identifier]; state = str(data.get("job_state", "UNKNOWN")); exit_code = str(data.get("Exit_status", ""))
            except (KeyError, TypeError, ValueError) as exc: raise HpcError("PBS returned an invalid status response.") from exc
        return {"schedulerJobId": identifier, "state": state, "exitCode": exit_code, "terminal": state in TERMINAL_STATES}

    def sparse_harvest(self, remote_work_dir: str, local_destination: Path, retain_wavefunctions: bool = False) -> list[str]:
        remote_work_dir = self._remote_dir(remote_work_dir); local_destination.mkdir(mode=0o700, parents=True, exist_ok=True)
        results_dir = remote_work_dir + "/results"
        code, stdout, _ = self.connection.run_command(["find", results_dir, "-type", "f", "-printf", r"%P\n"])
        if code == 255: raise HpcSshError("SSH connection failed while listing remote results.")
        if code != 0: return []
        harvested: list[str] = []
        total = 0
        for filename in (item.strip() for item in stdout.splitlines() if item.strip()):
            try: _safe_filename(filename)
            except HpcError: continue
            if not is_sparse_harvest_target(filename, retain_wavefunctions): continue
            size_code, size_out, _ = self.connection.run_command(["stat", "-c", "%s", f"{results_dir}/{filename}"])
            if size_code == 255:
                raise HpcSshError("SSH connection failed while inspecting remote results.")
            if size_code != 0:
                continue
            if size_code == 0:
                try:
                    size = int(size_out.strip())
                    if not 0 <= size <= MAX_HARVEST_BYTES or total + size > 512 * 1024 * 1024:
                        continue
                except ValueError:
                    continue
            destination = local_destination / filename
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            self.connection.sftp_download(f"{results_dir}/{filename}", destination)
            harvested.append(filename)
            total += size
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
            "workflowVersion": 1,
            "executionAffinity": {"scheduler": self.scheduler, "profileSha256": self.profile_sha256},
        }
        if calculation_id is not None:
            payload["requestedCalculationId"] = calculation_id
        reply = self.client.post("/worker/v1/jobs/claim", payload)
        job = reply.get("job") if isinstance(reply, dict) else None
        return job if isinstance(job, dict) else None

    def _heartbeat(self, job: dict[str, Any], progress: int, stage: str, lease: _HeartbeatLease) -> None:
        """Retry transient API failures within the lease, preserving cancellation."""
        with lease.lock:
            for attempt in range(4):
                if lease.stopped.is_set():
                    return
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
                            "logTail": getattr(self, 'scheduler_observation', 'Remote scheduler execution is being polled.'),
                        },
                    )
                except Exception as exc:
                    if lease.stopped.is_set():
                        return
                    if not _transient_api_error(exc):
                        cause = exc
                        while cause is not None:
                            if isinstance(cause, urllib.error.HTTPError) and cause.code in {401, 403, 409}:
                                raise LeaseLost("The control plane rejected the remote worker lease; scheduler scratch was retained.") from exc
                            cause = cause.__cause__
                        raise HpcError(f"Remote worker heartbeat failed: {exc}") from exc
                    request_timeout = getattr(self.client, "timeout", 30)
                    if not isinstance(request_timeout, (int, float)):
                        request_timeout = 30
                    if attempt == 3 or time.monotonic() + 2 + request_timeout >= lease.deadline:
                        raise MonitoringDeferred("Local API heartbeat is temporarily unavailable; remote job and receipt were retained for monitoring to resume.") from exc
                    time.sleep(2)
                    continue
                if lease.stopped.is_set():
                    return
                lease.deadline = time.monotonic() + 90
                if reply.get("cancelRequested"):
                    raise HpcError("Cancellation requested. Reconcile or cancel the remote allocation explicitly; scratch/checkpoints were retained.")
                return

    def _poll_with_retry(self, manager: HpcRemoteJobManager, receipt: dict[str, Any], job: dict[str, Any], progress: int, lease: _HeartbeatLease) -> dict[str, Any]:
        for attempt in range(4):
            try:
                return manager.poll_job(receipt["schedulerJobId"])
            except HpcSshError as exc:
                self.scheduler_observation = f"{self.scheduler} job {receipt['schedulerJobId']}: status temporarily unavailable; retrying the read without resubmitting."
                self._heartbeat(job, progress, "REMOTE_SCHEDULER_RECONNECTING", lease)
                if attempt == 3:
                    raise MonitoringDeferred("Remote scheduler connection is unavailable; monitoring will resume from the retained receipt.") from exc
                time.sleep(2 * (attempt + 1))
        raise AssertionError("unreachable")

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
        self.scheduler_observation = 'Remote scheduler submission is being prepared; scientific results are not available.'
        payload = job.get("input") if isinstance(job.get("input"), dict) else {}
        job_destination = destination if destination.name == job["calculationId"] else destination / job["calculationId"]
        lease = _HeartbeatLease(time.monotonic() + min(90, max(0, float(job.get("leaseExpiresAtEpoch") or time.time() + 90) - time.time())))
        stopped = lease.stopped
        heartbeat_failure: list[Exception] = []
        def heartbeat_loop():
            while not stopped.wait(15):
                try:
                    self._heartbeat(job, 15, "REMOTE_SCHEDULER", lease)
                except Exception as exc:
                    heartbeat_failure.append(exc)
                    return
        heartbeat = threading.Thread(target=heartbeat_loop, daemon=True)
        heartbeat.start()
        receipt: dict[str, Any] | None = None
        try:
            allocation = (payload.get("settings") or {}).get("hpcAllocation") or profile.get("defaults", {})
            if (int(allocation["nodes"]) * int(allocation["ranksPerNode"]) != int(job["vcpus"])
                    or int(allocation["nodes"]) * int(allocation["memoryMiBPerNode"]) != int(job["memoryMiB"])):
                raise HpcError("The frozen HPC allocation differs from the accepted job resources.")
            manager = self.manager_factory(connection, profile, allocation)
            manager.calculation_id = _safe_calculation_id(job["calculationId"])
            manager.calculation_type = str(payload.get("calculationType", ""))
            if self.workspace_builder is None:
                raise HpcError("Remote QE requires the source-bound scientific runner and verified pseudopotentials.")
            receipt_path = job_destination / "receipts" / f"{job['calculationId']}.json"
            if receipt_path.exists():
                try:
                    existing_receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    existing_receipt = None
                if (
                    isinstance(existing_receipt, dict)
                    and existing_receipt.get("state") == "submitted"
                    and existing_receipt.get("calculationId") == job["calculationId"]
                    and existing_receipt.get("profileSha256") == self.profile_sha256
                    and existing_receipt.get("scheduler") == self.scheduler
                    and existing_receipt.get("schedulerJobId")
                    and existing_receipt.get("remoteWorkDir")
                ):
                    job_id(str(existing_receipt["schedulerJobId"]), self.scheduler)
                    _safe_remote_path(str(existing_receipt["remoteWorkDir"]))
                    receipt = existing_receipt
                else:
                    raise HpcError("Submission receipt already exists; reconcile it before retrying.")
            self._heartbeat(job, 12, "REMOTE_PREPARING", lease)
            if receipt is None:
                files = self.workspace_builder(job, job_destination / "inputs")
                if heartbeat_failure:
                    raise heartbeat_failure[0]
                def before_submit():
                    if heartbeat_failure:
                        raise heartbeat_failure[0]
                    self._heartbeat(job, 12, "REMOTE_SUBMITTING", lease)
                for attempt in range(4):
                    try:
                        receipt = manager.submit_job(job["calculationId"], files, job_destination / "receipts", before_submit=before_submit)
                        break
                    except HpcSshError:
                        # No scheduler request can precede the durable receipt.
                        # submit_job wraps every uncertain scheduler reply as
                        # HpcError, so only pre-submission staging is retried.
                        if attempt == 3:
                            raise
                        self._heartbeat(job, 12, "REMOTE_STAGING_RETRY", lease)
                        if heartbeat_failure:
                            raise heartbeat_failure[0]
                        time.sleep(2 * (attempt + 1))
                self.scheduler_observation = f"{self.scheduler} job {receipt['schedulerJobId']}: submitted; scientific results pending validation."
            else:
                self.scheduler_observation = f"{self.scheduler} job {receipt['schedulerJobId']}: resumed polling; scientific results pending validation."
            # Scheduler walltime begins when the allocation starts. This is a
            # monitoring slice, including queue wait, never a solver deadline.
            for poll_index in range(max(1, max_polls)):
                if heartbeat_failure:
                    raise heartbeat_failure[0]
                self._heartbeat(job, min(95, 15 + round(75 * poll_index / max(1, max_polls))), "REMOTE_SCHEDULER", lease)
                status = self._poll_with_retry(manager, receipt, job, min(95, 15 + round(75 * poll_index / max(1, max_polls))), lease)
                self.scheduler_observation = f"{self.scheduler} job {receipt['schedulerJobId']}: {status.get('state', 'UNKNOWN')}; exit code {status.get('exitCode') or 'unavailable'}; scientific results pending validation."
                self._heartbeat(job, min(95, 15 + round(75 * poll_index / max(1, max_polls))), "REMOTE_SCHEDULER", lease)
                if status.get("terminal"):
                    result = manager.harvest_completed(receipt["schedulerJobId"], receipt["remoteWorkDir"], job_destination / "results")
                    result["receipt"] = receipt
                    result["job"] = job
                    return result
                time.sleep(max(0.1, poll_seconds))
            return {"state": "monitoring-deferred", "job": job, "receipt": receipt, "reason": "Monitoring slice ended; the scheduler job remains active and polling will resume from its receipt."}
        except LeaseLost as exc:
            return {"state": "lease-lost", "job": job, "receipt": receipt, "reason": str(exc), "scratchRetained": True}
        except (MonitoringDeferred, HpcSshError) as exc:
            # Without a submitted receipt the broker cannot safely reclaim a
            # remote allocation. Startup retries exhausted: report that clearly.
            state = "monitoring-deferred" if receipt is not None else "manual-resume-required"
            return {"state": state, "job": job, "receipt": receipt, "reason": str(exc), "scratchRetained": True}
        except Exception as exc:
            # Uncertain submissions, invalid profiles/results and cancellation
            # require explicit reconciliation; never auto-submit another job.
            return {"state": "manual-resume-required", "job": job, "receipt": receipt, "reason": str(exc), "scratchRetained": True}
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
                "workflowVersion": 1,
                "executionAffinity": {"scheduler": self.scheduler, "profileSha256": self.profile_sha256},
            },
        )
        job = reply.get("job") if isinstance(reply, dict) else None
        return job if isinstance(job, dict) else None
