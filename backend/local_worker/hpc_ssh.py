"""OpenSSH ControlMaster connection pooling for remote HPC cluster execution.

Manages the 5-phase SSH lifecycle (probe, cleanup, connect, execute, teardown)
and SFTP file transfers with proxyjump/bastion support and strict security boundaries.
"""
from __future__ import annotations

import hashlib
import os
import re
import shlex
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

try:
    from .recovery import host_subprocess_env
except ImportError:
    from recovery import host_subprocess_env

_MAX_CONTROL_SOCKET_BYTES = 86

_SCRATCH_DETECT_SNIPPET = (
    'for _ph_d in "${SCRATCH:-}" "${SCRATCH_DIR:-}" "${WORK:-}" '
    '"/scratch/${USER:-$(id -un 2>/dev/null || :)}" '
    '"/scratch/users/${USER:-$(id -un 2>/dev/null || :)}"; do '
    'if [ -n "$_ph_d" ] && [ -d "$_ph_d" ] && [ -w "$_ph_d" ] && [ -x "$_ph_d" ]; then '
    'printf \'scratch_dir=%s\\n\' "$_ph_d"; break; fi; done; '
    'if [ -n "${HOME:-}" ] && [ -d "$HOME" ] && [ -w "$HOME" ] && [ -x "$HOME" ]; then '
    'printf \'home_dir=%s\\n\' "$HOME"; fi'
)


def _valid_remote_dir(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip().rstrip("/")
    if not cleaned or not cleaned.startswith("/") or len(cleaned) > 1800:
        return None
    if ".." in cleaned.split("/") or any(ord(char) < 32 or ord(char) == 127 for char in cleaned):
        return None
    return cleaned


REQUIRED_PYTHON_MODULES = ("numpy", "scipy", "matplotlib", "seekpath", "spglib")
_PY_CHECK_CODE = "\n".join([
    "import importlib, sys",
    "missing = []",
    f"for name in {REQUIRED_PYTHON_MODULES!r}:",
    "    try:",
    "        importlib.import_module(name)",
    "    except Exception:",
    "        missing.append(name)",
    'print("%d.%d.%d|%s" % (sys.version_info[:3] + (",".join(missing),)))',
])
# Keep SSH arguments free of literal control characters; Python decodes these
# newlines only after the remote shell has passed the single argument.
_PY_CHECK_CODE = f"exec({_PY_CHECK_CODE!r})"

# Prefer cluster-wide shared HPC installations before user-managed $HOME envs.
PYTHON_CANDIDATE_GLOBS = (
    '/mgpfs/shared/apps/app/miniconda*/*/bin/python3',
    '/mgpfs/shared/apps/app/miniforge*/*/bin/python3',
    '/mgpfs/shared/apps/app/anaconda*/*/bin/python3',
    '/mgpfs/apps/*/apps/miniconda*/*/bin/python3',
    '/mgpfs/apps/*/apps/miniforge*/*/bin/python3',
    '/mgpfs/apps/*/apps/anaconda*/*/bin/python3',
    '/opt/conda/bin/python3',
    '/opt/conda/envs/*/bin/python3',
    '"${HOME:-}"/miniconda3/envs/*/bin/python3',
    '"${HOME:-}"/.conda/envs/*/bin/python3',
    '"${HOME:-}"/anaconda3/envs/*/bin/python3',
    '"${HOME:-}"/miniforge3/envs/*/bin/python3',
)


def _valid_remote_executable(value: Any) -> str | None:
    path = _valid_remote_dir(value)
    if not path or any(char.isspace() or char in "\"'\\$`;&|()<>{}" for char in path):
        return None
    return path


def _version_at_least(version: str, minimum: tuple[int, int] = (3, 10)) -> bool:
    parts = []
    for piece in version.split(".")[:2]:
        try:
            parts.append(int(piece))
        except ValueError:
            return False
    return tuple(parts) >= minimum


def _suggested_scratch_root(scratch_dir: Any, home_dir: Any) -> str | None:
    base = _valid_remote_dir(scratch_dir) or _valid_remote_dir(home_dir)
    if not base:
        return None
    return base if base.endswith("/phynite-work") else f"{base}/phynite-work"


def _extract_framed_records(output: str, begin: str, end: str, allowed_keys: set[str]) -> dict[str, str] | None:
    lines = [line.strip() for line in output.splitlines()]
    if begin not in lines or end not in lines or lines.index(end) <= lines.index(begin):
        return None
    records: dict[str, str] = {}
    for line in lines[lines.index(begin) + 1:lines.index(end)]:
        key, separator, value = line.partition("=")
        if separator and key in allowed_keys:
            records[key] = value
    return records


def _prepare_control_dir(candidate: Path) -> Path:
    control_root = candidate.expanduser()
    if control_root.exists() and control_root.is_symlink():
        raise HpcSshError("SSH control directory cannot be a symlink")
    control_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    resolved = control_root.resolve()
    if not resolved.is_dir():
        raise HpcSshError("SSH control directory is not a private directory")
    if hasattr(os, "getuid") and resolved.stat().st_uid != os.getuid():
        raise HpcSshError("SSH control directory is owned by another user")
    try:
        resolved.chmod(0o700)
    except OSError as exc:
        raise HpcSshError("SSH control directory permissions could not be restricted") from exc
    return resolved


def _default_control_root() -> Path:
    configured = os.environ.get("PHYNITE_SSH_SOCKET_DIR")
    if configured:
        return Path(configured)
    preferred = Path("/tmp/phynite-hpc-ssh")
    if hasattr(os, "getuid") and preferred.exists():
        try:
            if preferred.is_symlink() or preferred.lstat().st_uid != os.getuid():
                return Path(f"/tmp/phynite-ssh-{os.getuid()}")
        except OSError:
            return Path(f"/tmp/phynite-ssh-{os.getuid()}")
    return preferred


class HpcSshError(RuntimeError):
    pass


class HpcSshConnection:
    """Manages an isolated OpenSSH ControlMaster socket for an HPC login node."""

    def __init__(
        self,
        host: str,
        username: str,
        port: int = 22,
        private_key_path: str | Path | None = None,
        bastion_host: str | None = None,
        bastion_port: int = 22,
        bastion_user: str | None = None,
        control_dir: Path | None = None,
    ) -> None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,253}", host):
            raise HpcSshError(f"Invalid host: {host}")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}", username):
            raise HpcSshError(f"Invalid username: {username}")
        if not 1 <= port <= 65535:
            raise HpcSshError(f"Invalid port: {port}")

        self.host = host
        self.username = username
        self.port = port
        if private_key_path is not None:
            raw_key = Path(private_key_path).expanduser()
            if not raw_key.is_absolute() or ".." in raw_key.parts:
                raise HpcSshError("Private key path must be absolute and free of traversal")
            if raw_key.is_symlink():
                raise HpcSshError("Private key path cannot be a symlink")
            self.private_key_path = raw_key
        else:
            self.private_key_path = None
        if bastion_host is not None and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,253}", bastion_host):
            raise HpcSshError(f"Invalid bastion host: {bastion_host}")
        if not 1 <= bastion_port <= 65535:
            raise HpcSshError(f"Invalid bastion port: {bastion_port}")
        if bastion_user is not None and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}", bastion_user):
            raise HpcSshError(f"Invalid bastion username: {bastion_user}")
        self.bastion_host = bastion_host
        self.bastion_port = bastion_port
        self.bastion_user = bastion_user

        if self.private_key_path:
            if not self.private_key_path.is_file():
                raise HpcSshError(f"Private key not found: {self.private_key_path}")
            if self.private_key_path.stat().st_mode & 0o077:
                raise HpcSshError("Private key permissions must be owner-only")

        # Deterministic control socket path based on connection signature
        signature = f"{username}@{host}:{port}"
        if bastion_host:
            signature += f"|jump:{bastion_user or username}@{bastion_host}:{bastion_port}"
        socket_hash = hashlib.sha256(signature.encode()).hexdigest()[:16]

        self.control_dir = _prepare_control_dir(control_dir or _default_control_root())
        socket_path = self.control_dir / f"phynite-ssh-{socket_hash}.sock"
        if len(str(socket_path).encode("utf-8")) > _MAX_CONTROL_SOCKET_BYTES:
            socket_path = self.control_dir / f"s-{socket_hash[:12]}.sock"
        if len(str(socket_path).encode("utf-8")) > _MAX_CONTROL_SOCKET_BYTES:
            self.control_dir = _prepare_control_dir(_default_control_root())
            socket_path = self.control_dir / f"phynite-ssh-{socket_hash}.sock"
            if len(str(socket_path).encode("utf-8")) > _MAX_CONTROL_SOCKET_BYTES:
                socket_path = self.control_dir / f"s-{socket_hash[:12]}.sock"
        if len(str(socket_path).encode("utf-8")) > _MAX_CONTROL_SOCKET_BYTES:
            raise HpcSshError(f"SSH control socket path exceeds Unix socket length limit: {socket_path}")
        self.socket_path = socket_path
        self.lock_path = self.socket_path.with_suffix(".lock")
        key = str(self.socket_path)
        with self._locks_guard:
            self._locks.setdefault(key, threading.RLock())
        self._lock = self._locks[key]

    @property
    def target(self) -> str:
        return f"{self.username}@{self.host}"

    def _run_ssh_tool(self, cmd: list[str], *, input: str | None = None, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(cmd, input=input, capture_output=True, text=True, timeout=timeout, env=host_subprocess_env())

    def _base_ssh_args(self, *, sftp: bool = False) -> list[str]:
        args = [
            "-P" if sftp else "-p", str(self.port),
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=15",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            *(["-o", f"ControlPath={self.socket_path}"] if sftp else ["-S", str(self.socket_path)]),
        ]
        if self.private_key_path:
            args.extend(["-i", str(self.private_key_path)])
        if self.bastion_host:
            bastion_target = f"{self.bastion_user or self.username}@{self.bastion_host}:{self.bastion_port}"
            args.extend(["-o", f"ProxyJump={bastion_target}"])
        return args

    def check_socket(self) -> bool:
        """Phase 1: Check if the ControlMaster socket is active and responsive."""
        if not self.socket_path.exists() or self.socket_path.is_symlink():
            return False
        cmd = ["ssh", "-O", "check", "-S", str(self.socket_path), self.target]
        result = self._run_ssh_tool(cmd)
        return result.returncode == 0

    @contextmanager
    def _cross_process_lock(self):
        """Serialize ControlMaster creation across worker processes."""
        if self.lock_path.is_symlink():
            raise HpcSshError("Refusing to use a symlink at the SSH control lock path")
        flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.lock_path, flags, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
        except OSError:
            os.close(descriptor)
            raise HpcSshError("SSH control lock permissions could not be restricted")
        try:
            try:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_EX)
            except (ImportError, OSError):
                # The per-process RLock still protects supported platforms that
                # do not expose POSIX flock; SSH itself remains the authority.
                pass
            yield
        finally:
            try:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            except (ImportError, OSError):
                pass
            os.close(descriptor)

    def _exit_socket_unlocked(self) -> None:
        if self.socket_path.is_symlink():
            raise HpcSshError("Refusing to remove a symlink at the SSH control socket path")
        if self.socket_path.exists():
            self._run_ssh_tool(["ssh", "-O", "exit", "-S", str(self.socket_path), self.target])
            try:
                if self.socket_path.exists():
                    self.socket_path.unlink(missing_ok=True)
            except OSError:
                pass

    def exit_socket(self) -> None:
        """Phase 2 & 5: Gracefully instruct the ControlMaster to exit and remove socket."""
        with self._lock, self._cross_process_lock():
            self._exit_socket_unlocked()

    def ensure_master(self) -> None:
        """Phase 3: Ensure an active ControlMaster socket is established."""
        with self._lock, self._cross_process_lock():
            if self.check_socket():
                return

            # Clean up a stale socket file while holding the per-signature lock.
            self._exit_socket_unlocked()
            cmd = ["ssh", "-N", "-f", "-M", *self._base_ssh_args(), self.target]
            result = self._run_ssh_tool(cmd)
            if result.returncode != 0:
                raise HpcSshError(f"Failed to establish SSH ControlMaster connection to {self.target}: {result.stderr.strip()}")
            for _ in range(20):
                if self.socket_path.exists() and self.check_socket():
                    return
                time.sleep(0.1)
            raise HpcSshError(f"ControlMaster socket was not established within timeout at {self.socket_path}")

    def run_command(self, argv: list[str], timeout: int = 60) -> tuple[int, str, str]:
        """Phase 4: Run a command on the remote host multiplexed over the ControlMaster socket."""
        if not isinstance(argv, list) or not argv or any(not isinstance(value, str) or not value or any(ord(char) < 32 or ord(char) == 127 for char in value) for value in argv):
            raise HpcSshError("Remote command argv is invalid")
        self.ensure_master()
        remote_cmd = shlex.join(argv)
        ssh_cmd = ["ssh", *self._base_ssh_args(), self.target, remote_cmd]
        try:
            res = self._run_ssh_tool(ssh_cmd, timeout=timeout)
            return res.returncode, res.stdout, res.stderr
        except subprocess.TimeoutExpired as exc:
            raise HpcSshError(f"Remote command timed out after {timeout}s: {remote_cmd}") from exc

    def probe_connection(self, modules: list[str] | None = None, *, python_executable: str | None = None) -> dict[str, Any]:
        """Probe connection latency, SSH banner, and solver/scheduler/runtime availability."""
        safe_modules: list[str] = []
        if modules is not None and not isinstance(modules, list):
            raise HpcSshError("Environment modules are invalid; expected a list of module names.")
        for raw in modules or []:
            if not isinstance(raw, str):
                raise HpcSshError("Environment modules are invalid; expected module names.")
            value = raw.strip()
            # Match job execution: legacy purge entries are a no-op, never a reset.
            if value == "module purge":
                continue
            if value.startswith("module load "):
                value = value[len("module load "):].strip()
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.+@:/-]{0,127}", value):
                raise HpcSshError("Environment modules must be safe module names.")
            if value not in safe_modules:
                safe_modules.append(value)

        safe_python: str | None = None
        if python_executable is not None and python_executable != "":
            safe_python = _valid_remote_executable(python_executable)
            if not safe_python:
                raise HpcSshError("Python executable path must be a safe absolute path.")

        t0 = time.perf_counter()
        code, stdout, stderr = self.run_command(["echo", "PHYNITE_HPC_PROBE_OK"], timeout=15)
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)

        if code != 0 or "PHYNITE_HPC_PROBE_OK" not in stdout:
            return {
                "ok": False,
                "latencyMs": latency_ms,
                "error": stderr.strip() or f"Probe failed with exit code {code}",
                "solvers": {},
                "schedulers": {},
            }

        # Login shells can print MOTD both before and after our commands. Only
        # uniquely framed, explicitly labelled records describe capabilities.
        marker = "PHYNITE_HPC_" + uuid.uuid4().hex
        begin, end = marker + "_BEGIN", marker + "_END"
        commands = [f"printf '%s\\n' {shlex.quote(begin)}"]
        for name in safe_modules:
            failure = shlex.quote(marker + "_MODULE_ERROR=" + name)
            commands.append(f"if ! module load {shlex.quote(name)}; then printf '%s\\n' {failure}; exit 1; fi")
        for label, command in (("slurm", "sbatch"), ("pbs", "qsub"), ("qe", "pw.x"), ("lammps", "lmp")):
            commands.append(f"printf '%s=%s\\n' {label} \"$(command -v {command} 2>/dev/null || :)\"")
        commands.append('printf \'mpirun=%s\\n\' "$(command -v mpirun 2>/dev/null || :)"')
        commands.append('printf \'mpiexec=%s\\n\' "$(command -v mpiexec 2>/dev/null || :)"')
        commands.append(
            'if command -v srun >/dev/null 2>&1; then '
            'printf \'srun_mpi=%s\\n\' "$(srun --mpi=list 2>/dev/null | awk \'NR>1 && NF>0 {printf "%s%s", sep, $1; sep=","}\' || :)"; fi'
        )
        commands.append(
            '_ph_pw=$(command -v pw.x 2>/dev/null || :); '
            'if [ -n "$_ph_pw" ] && command -v ldd >/dev/null 2>&1; then '
            '_ph_ldd=$(ldd "$_ph_pw" 2>/dev/null || :); '
            'case "$_ph_ldd" in *libmpi.so.12*) printf \'qe_mpi=impi\\n\' ;; *libmpi.so.40*) printf \'qe_mpi=openmpi\\n\' ;; esac; fi'
        )
        target_py = shlex.quote(safe_python) if safe_python else '"$(command -v python3 2>/dev/null || :)"'
        commands.append(
            f'_ph_py={target_py}; '
            'printf \'py_bin=%s\\n\' "$_ph_py"; '
            '_ph_py_ok=0; '
            'if [ -n "$_ph_py" ] && [ -x "$_ph_py" ]; then '
            f'_ph_py_info=$("$_ph_py" -c {shlex.quote(_PY_CHECK_CODE)} 2>/dev/null || :); '
            'printf \'py_info=%s\\n\' "$_ph_py_info"; '
            'case "$_ph_py_info" in '
            '3.[1-9][0-9].*\\|*) '
            '_ph_py_miss=${_ph_py_info#*|}; '
            'if [ -z "$_ph_py_miss" ]; then _ph_py_ok=1; fi ;; '
            'esac; '
            'fi; '
            'if [ "$_ph_py_ok" != "1" ]; then '
            f'for _ph_cand in {" ".join(PYTHON_CANDIDATE_GLOBS)}; do '
            'if [ -x "$_ph_cand" ]; then '
            f'_ph_ci=$("$_ph_cand" -c {shlex.quote(_PY_CHECK_CODE)} 2>/dev/null || :); '
            'case "$_ph_ci" in 3.[1-9][0-9].*\\|*) '
            '_ph_cm=${_ph_ci#*|}; '
            'if [ -z "$_ph_cm" ]; then printf \'py_suggested=%s\\n\' "$_ph_cand"; printf \'py_suggested_info=%s\\n\' "$_ph_ci"; break; fi ;; '
            'esac; '
            'fi; '
            'done; '
            'fi'
        )
        commands.extend([_SCRATCH_DETECT_SNIPPET, "printf 'system=%s\\n' \"$(uname -srm)\"", f"printf '%s\\n' {shlex.quote(end)}"])
        probe_cmd = ["bash", "-lc" if safe_modules else "-c", "; ".join(commands)]
        if not safe_modules:
            probe_cmd[0] = "sh"
        code, probe_out, probe_err = self.run_command(probe_cmd, timeout=20)
        lines = [line.strip() for line in probe_out.splitlines()]

        def failure(message: str) -> dict[str, Any]:
            # Remote diagnostics are plain React text, bounded and stripped of
            # terminal escapes/control characters before crossing the API.
            detail = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", probe_err)
            detail = "".join(char for char in detail if char.isprintable() or char in "\n\t").strip()[:2000]
            return {"ok": False, "latencyMs": latency_ms, "error": message + (f": {detail}" if detail else ""), "solvers": {}, "schedulers": {}}

        module_error = next((line.split("=", 1)[1] for line in lines if line.startswith(marker + "_MODULE_ERROR=")), None)
        if module_error:
            return failure(f"Failed to load environment module {module_error}")
        if code != 0:
            return failure(f"HPC environment probe failed with exit code {code}")
        records = _extract_framed_records(
            probe_out,
            begin,
            end,
            {
                "slurm", "pbs", "qe", "lammps", "system", "scratch_dir", "home_dir",
                "mpirun", "mpiexec", "srun_mpi", "qe_mpi",
                "py_bin", "py_info", "py_suggested", "py_suggested_info",
            },
        )
        if records is None:
            return failure("HPC environment probe returned incomplete output")
        if not {"slurm", "pbs", "qe", "lammps", "system"} <= set(records) or not records["system"]:
            return failure("HPC environment probe returned incomplete capability records")
        suggested_scratch = _suggested_scratch_root(records.get("scratch_dir"), records.get("home_dir"))

        result: dict[str, Any] = {
            "ok": True,
            "latencyMs": latency_ms,
            "system": records["system"],
            "schedulers": {"slurm": bool(records["slurm"]), "pbs": bool(records["pbs"])},
            "solvers": {"qe": records["qe"] or None, "lammps": records["lammps"] or None},
            **({"suggestedScratchRoot": suggested_scratch} if suggested_scratch else {}),
        }

        srun_plugins = [item.strip() for item in (records.get("srun_mpi") or "").split(",") if item.strip()]
        if records.get("mpirun") or records.get("mpiexec") or srun_plugins or records.get("qe_mpi"):
            result["mpi"] = {
                "mpirun": records.get("mpirun") or None,
                "mpiexec": records.get("mpiexec") or None,
                "srunPlugins": srun_plugins,
                "qeMpi": records.get("qe_mpi") or None,
            }

        py_bin = records.get("py_bin") or None
        py_info = records.get("py_info") or ""
        py_suggested = _valid_remote_executable(records.get("py_suggested"))
        if py_bin or py_suggested:
            version = ""
            missing: list[str] = []
            if "|" in py_info:
                version, raw_miss = py_info.split("|", 1)
                missing = [pkg for pkg in raw_miss.split(",") if pkg]
            version_ok = bool(version and _version_at_least(version))
            python_summary: dict[str, Any] = {
                "executable": py_bin,
                "version": version or None,
                "versionOk": version_ok,
                "packagesOk": bool(version_ok and "|" in py_info and not missing),
                "missingPackages": missing,
            }
            if py_suggested:
                python_summary["suggestedExecutable"] = py_suggested
                sug_info = records.get("py_suggested_info") or ""
                if "|" in sug_info:
                    python_summary["suggestedVersion"] = sug_info.split("|", 1)[0]
            result["python"] = python_summary

        return result

    def detect_scratch_root(self) -> str:
        """Detect a writable remote scratch or home work directory via SSH."""
        marker = "PHYNITE_SCRATCH_" + uuid.uuid4().hex
        begin, end = marker + "_BEGIN", marker + "_END"
        script = f"printf '%s\\n' {shlex.quote(begin)}; {_SCRATCH_DETECT_SNIPPET}; printf '%s\\n' {shlex.quote(end)}"
        for shell_cmd in (["bash", "-lc", script], ["sh", "-c", script]):
            code, out, _ = self.run_command(shell_cmd, timeout=15)
            if code != 0:
                continue
            records = _extract_framed_records(out, begin, end, {"scratch_dir", "home_dir"})
            if records is None:
                continue
            suggested = _suggested_scratch_root(records.get("scratch_dir"), records.get("home_dir"))
            if suggested:
                return suggested
        raise HpcSshError("Could not detect a writable scratch or home directory on the HPC cluster.")

    def check_writable_path(self, remote_path: str) -> bool:
        """Return whether remote_path or its nearest existing ancestor directory is writable."""
        if not _valid_remote_dir(remote_path):
            return False
        marker = "PHYNITE_WRITABLE_" + uuid.uuid4().hex
        begin, end = marker + "_BEGIN", marker + "_END"
        script = (
            f"printf '%s\\n' {shlex.quote(begin)}; "
            f"p={shlex.quote(remote_path)}; "
            "while [ -n \"$p\" ] && [ \"$p\" != \"/\" ] && [ ! -e \"$p\" ]; do p=$(dirname \"$p\"); done; "
            "if [ -n \"$p\" ] && [ \"$p\" != \"/\" ] && [ -d \"$p\" ] && [ -w \"$p\" ] && [ -x \"$p\" ]; "
            "then printf 'writable=1\\n'; else printf 'writable=0\\n'; fi; "
            f"printf '%s\\n' {shlex.quote(end)}"
        )
        code, out, _ = self.run_command(["sh", "-c", script], timeout=15)
        if code != 0:
            return False
        records = _extract_framed_records(out, begin, end, {"writable"})
        return bool(records and records.get("writable") == "1")

    def _run_sftp_batch(self, batch: str, action: str) -> None:
        cmd = ["sftp", "-b", "-", *self._base_ssh_args(sftp=True), self.target]
        res = self._run_ssh_tool(cmd, input=batch)
        if res.returncode != 0:
            raise HpcSshError(f"SFTP {action} failed: {res.stderr.strip()}")

    def sftp_upload(self, local_path: Path, remote_path: str) -> None:
        """Upload a local file to remote host via sftp batch."""
        self._validate_remote_path(remote_path)
        self.ensure_master()
        if not local_path.is_file():
            raise HpcSshError(f"Local file does not exist: {local_path}")
        self._run_sftp_batch(f"put {shlex.quote(str(local_path))} {shlex.quote(remote_path)}\n", "upload")

    def sftp_download(self, remote_path: str, local_path: Path) -> None:
        """Download a remote file to local host via sftp batch."""
        self._validate_remote_path(remote_path)
        self.ensure_master()
        local_path.parent.mkdir(parents=True, exist_ok=True)
        self._run_sftp_batch(f"get {shlex.quote(remote_path)} {shlex.quote(str(local_path))}\n", "download")
    _locks: dict[str, threading.RLock] = {}
    _locks_guard = threading.Lock()


    @staticmethod
    def _validate_remote_path(value: str) -> None:
        parts = value.split("/") if isinstance(value, str) else []
        if not isinstance(value, str) or not value.startswith("/") or any(part in {".", ".."} for part in parts) or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise HpcSshError("Remote path must be absolute and free of traversal")
