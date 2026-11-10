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
from contextlib import contextmanager
from pathlib import Path
from typing import Any


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

        control_root = (control_dir or Path(os.environ.get("PHYNITE_SSH_SOCKET_DIR", "/tmp/phynite-hpc-ssh"))).expanduser()
        if control_root.exists() and control_root.is_symlink():
            raise HpcSshError("SSH control directory cannot be a symlink")
        control_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.control_dir = control_root.resolve()
        if not self.control_dir.is_dir():
            raise HpcSshError("SSH control directory is not a private directory")
        try:
            self.control_dir.chmod(0o700)
        except OSError as exc:
            raise HpcSshError("SSH control directory permissions could not be restricted") from exc
        self.socket_path = self.control_dir / f"phynite-ssh-{socket_hash}.sock"
        self.lock_path = self.control_dir / f"phynite-ssh-{socket_hash}.lock"
        key = str(self.socket_path)
        with self._locks_guard:
            self._locks.setdefault(key, threading.RLock())
        self._lock = self._locks[key]

    @property
    def target(self) -> str:
        return f"{self.username}@{self.host}"

    def _base_ssh_args(self) -> list[str]:
        args = [
            "-p", str(self.port),
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=15",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            "-S", str(self.socket_path),
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
        result = subprocess.run(cmd, capture_output=True, text=True)
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
            subprocess.run(["ssh", "-O", "exit", "-S", str(self.socket_path), self.target], capture_output=True)
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
            result = subprocess.run(cmd, capture_output=True, text=True)
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
            res = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=timeout)
            return res.returncode, res.stdout, res.stderr
        except subprocess.TimeoutExpired as exc:
            raise HpcSshError(f"Remote command timed out after {timeout}s: {remote_cmd}") from exc

    def probe_connection(self, modules: list[str] | None = None) -> dict[str, Any]:
        """Probe connection latency, SSH banner, and solver/scheduler availability."""
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

        safe_modules: list[str] = []
        for raw in modules or []:
            value = str(raw).strip()
            if value.startswith("module load "):
                value = value[len("module load "):].strip()
            if value and value != "module purge" and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.+@:/-]{0,127}", value):
                safe_modules.append(value)
        module_prefix = " ".join(f"module load {shlex.quote(m)} >/dev/null 2>&1;" for m in safe_modules)

        # Probe schedulers and solvers (use a login shell when modules are configured so Lmod/modules functions load)
        probe_body = f"{module_prefix} which sbatch 2>/dev/null; which qsub 2>/dev/null; which pw.x 2>/dev/null; which lmp 2>/dev/null; uname -srm"
        probe_cmd = ["bash", "-lc", probe_body] if safe_modules else ["sh", "-c", probe_body]
        _, probe_out, _ = self.run_command(probe_cmd, timeout=15)
        lines = [l.strip() for l in probe_out.splitlines() if l.strip()]

        schedulers: dict[str, bool] = {
            "slurm": any("sbatch" in line for line in lines),
            "pbs": any("qsub" in line for line in lines),
        }
        solvers: dict[str, str | None] = {
            "qe": next((line for line in lines if line.endswith("pw.x")), None),
            "lammps": next((line for line in lines if line.endswith("lmp")), None),
        }
        system_info = lines[-1] if lines and not lines[-1].endswith(("sbatch", "qsub", "pw.x", "lmp")) else "Linux"

        return {
            "ok": True,
            "latencyMs": latency_ms,
            "system": system_info,
            "schedulers": schedulers,
            "solvers": solvers,
        }

    def sftp_upload(self, local_path: Path, remote_path: str) -> None:
        """Upload a local file to remote host via sftp batch."""
        self._validate_remote_path(remote_path)
        self.ensure_master()
        if not local_path.is_file():
            raise HpcSshError(f"Local file does not exist: {local_path}")

        batch = f"put {shlex.quote(str(local_path))} {shlex.quote(remote_path)}\n"
        cmd = ["sftp", *self._base_ssh_args(), self.target]
        res = subprocess.run(cmd, input=batch, capture_output=True, text=True)
        if res.returncode != 0:
            raise HpcSshError(f"SFTP upload failed: {res.stderr.strip()}")

    def sftp_download(self, remote_path: str, local_path: Path) -> None:
        """Download a remote file to local host via sftp batch."""
        self._validate_remote_path(remote_path)
        self.ensure_master()
        local_path.parent.mkdir(parents=True, exist_ok=True)
        batch = f"get {shlex.quote(remote_path)} {shlex.quote(str(local_path))}\n"
        cmd = ["sftp", *self._base_ssh_args(), self.target]
        res = subprocess.run(cmd, input=batch, capture_output=True, text=True)
        if res.returncode != 0:
            raise HpcSshError(f"SFTP download failed: {res.stderr.strip()}")
    _locks: dict[str, threading.RLock] = {}
    _locks_guard = threading.Lock()


    @staticmethod
    def _validate_remote_path(value: str) -> None:
        parts = value.split("/") if isinstance(value, str) else []
        if not isinstance(value, str) or not value.startswith("/") or any(part in {".", ".."} for part in parts) or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise HpcSshError("Remote path must be absolute and free of traversal")
