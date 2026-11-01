"""Fail-closed OS process confinement for the desktop's native solvers.

No environment variable is evidence of isolation. A real child must demonstrate
allowed workspace access, denied outside access, and denied external networking.
"""
from __future__ import annotations

import json
import hashlib
import re
import stat
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


class SandboxError(RuntimeError):
    pass


def run_probe() -> int:
    """Fixed child entrypoint also supported by the frozen desktop core."""
    job, outside = (Path(os.environ[key]) for key in ("PHYNITE_SANDBOX_PROBE_JOB", "PHYNITE_SANDBOX_PROBE_OUTSIDE"))
    flags: dict[str, bool] = {}
    try:
        (job / "allowed").write_text("ok")
        flags["workspaceWrite"] = True
    except OSError:
        flags["workspaceWrite"] = False
    try:
        outside.write_text("bad")
        flags["outsideWriteDenied"] = False
    except OSError:
        flags["outsideWriteDenied"] = True
    try:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            connection.connect(("198.51.100.1", 9))
        flags["externalNetworkDenied"] = False
    except OSError:
        flags["externalNetworkDenied"] = True
    print(json.dumps(flags))
    return 0


class NativeSandbox:
    def __init__(self, data_dir: Path, read_roots: tuple[Path, ...] = (), *, bootstrap_dir: Path | None = None):
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.read_roots = tuple(Path(root).resolve() for root in read_roots)
        self._checked: tuple[float, dict[str, Any]] | None = None
        declared = bootstrap_dir or os.environ.get("PHYNITE_NATIVE_TOOLS_DIR")
        self.bootstrap_dir = Path(declared).resolve() if declared else None

    def _packaged_bwrap(self) -> str | None:
        if self.bootstrap_dir is None:
            return None
        root = self.bootstrap_dir
        try:
            path = root / "manifest.json"
            if not path.is_file() or path.is_symlink() or path.stat().st_size > 128 * 1024:
                raise ValueError("invalid bootstrap manifest")
            manifest = json.loads(path.read_text())
            machine = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
            target = f"linux-{machine}"
            if manifest.get("schemaVersion") != 1 or manifest.get("target") != target or set(manifest.get("tools", {})) != {"bwrap"}:
                raise ValueError("incorrect bootstrap target or tool")
            tool = manifest["tools"]["bwrap"]
            libraries = tool.get("libraries", [])
            if not isinstance(libraries, list) or len(libraries) > 100:
                raise ValueError("invalid bootstrap libraries")
            records = [{"path": tool.get("executable"), "sha256": tool.get("sha256")}, *libraries]
            seen = set()
            for record in records:
                value, digest = record.get("path"), record.get("sha256")
                if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value or any(part in {"", ".", ".."} for part in value.split("/")) or value in seen:
                    raise ValueError("unsafe bootstrap path")
                seen.add(value)
                candidate = root / value
                if any(parent.is_symlink() for parent in (candidate, *candidate.parents) if parent != root.parent) or not candidate.resolve().is_relative_to(root) or not candidate.is_file():
                    raise ValueError("bootstrap path is not a regular confined file")
                mode = candidate.stat().st_mode
                if mode & (stat.S_ISUID | stat.S_ISGID) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
                    raise ValueError("unsafe bootstrap mode or digest")
                sha = hashlib.sha256()
                with candidate.open("rb") as source:
                    while block := source.read(1024 * 1024):
                        sha.update(block)
                if sha.hexdigest() != digest:
                    raise ValueError("bootstrap checksum mismatch")
            binary = root / tool["executable"]
            if not os.access(binary, os.X_OK):
                raise ValueError("bootstrap is not executable")
            return str(binary)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            raise SandboxError("The packaged Linux sandbox bootstrap failed verification. Reinstall a verified Phynite Lab runtime package.") from error

    def _tool(self) -> tuple[str, str]:
        system = platform.system()
        name = "sandbox-exec" if system == "Darwin" else "bwrap" if system == "Linux" else ""
        if system == "Darwin":
            # The operating-system tool must work with an empty user PATH and
            # must never be replaced by an executable earlier on that PATH.
            trusted = Path("/usr/bin/sandbox-exec")
            executable = str(trusted) if trusted.is_file() and os.access(trusted, os.X_OK) else None
        else:
            executable = self._packaged_bwrap() if system == "Linux" and self.bootstrap_dir else shutil.which(name) if name else None
        if not executable:
            raise SandboxError("Native isolation needs sandbox-exec on macOS or a verified bubblewrap with user namespaces on Linux/WSL2. Check Ubuntu user-namespace/AppArmor policy when the tool is installed but the probe fails.")
        return system, executable

    def _command(self, job_dir: Path, argv: list[str]) -> list[str]:
        system, executable = self._tool()
        job_dir = job_dir.resolve(strict=True)
        if not job_dir.is_dir() or not argv or any(not isinstance(arg, str) or "\0" in arg for arg in argv):
            raise SandboxError("A native sandbox needs a job directory and valid argument array.")
        (job_dir / ".tmp").mkdir(exist_ok=True)
        # The Python interpreter and its libraries are runtime inputs too. Resolve
        # symlinks before generating policies, as macOS resolves /var to /private/var.
        roots = {Path(sys.prefix).resolve(), Path(sys.base_prefix).resolve(), Path(sys.executable).resolve().parent, *self.read_roots}
        binary = shutil.which(argv[0])
        if binary:
            roots.add(Path(binary).resolve().parent)
        if system == "Darwin":
            roots.update(Path(path) for path in ("/System", "/usr", "/bin", "/sbin", "/Library", "/private/etc", "/dev", "/opt/homebrew", "/opt/local"))
            quoted = lambda path: json.dumps(str(path))
            policy = ["(version 1)", "(deny default)", "(allow process*)", "(allow sysctl-read)", "(allow mach-lookup)", "(allow file-read-metadata)", '(allow file-read* (literal "/"))']
            policy += [f"(allow file-read* (subpath {quoted(root)}))" for root in sorted(roots, key=str) if root.exists()]
            # Python's namespace-package discovery lists the package root even
            # when only its backend subtree is readable. Permit directory
            # traversal/listing at ancestors without granting their contents.
            ancestors = {parent for root in roots for parent in root.parents if parent != Path("/")}
            policy += [f"(allow file-read* (literal {quoted(parent)}))" for parent in sorted(ancestors, key=str) if parent.is_dir()]
            policy += [f"(allow file-read* file-write* (subpath {quoted(job_dir)}))"]
            # MPI ranks on one computer need loopback/Unix rendezvous. Their
            # external sockets remain denied and are exercised by the probe.
            policy += ['(allow network-bind network-inbound (local ip "localhost:*"))', '(allow network-outbound (remote ip "localhost:*"))', f"(allow network-bind network-inbound (local unix-socket (subpath {quoted(job_dir)})))", f"(allow network-outbound (remote unix-socket (subpath {quoted(job_dir)})))"]
            policy += ['(allow file-write-data (literal "/dev/null"))']
            profile = job_dir / ".phynite-sandbox.sb"
            profile.write_text("\n".join(policy) + "\n", encoding="utf-8")
            return [executable, "-f", str(profile), *argv]
        # Read-only bind of / preserves the installed runtime's dynamic linker
        # paths. /home and /root are hidden, then explicitly selected runtime
        # roots are rebound. Network and IPC namespaces are private to the job.
        command = [executable, "--die-with-parent", "--new-session", "--unshare-all", "--ro-bind", "/", "/"]
        hidden_roots = ("/home", "/root", "/run", "/mnt", "/media", "/Users", "/tmp")
        for hidden in hidden_roots:
            if Path(hidden).is_dir():
                command += ["--tmpfs", hidden]
        for root in sorted(roots, key=str):
            if root.exists() and any(root.is_relative_to(hidden) for hidden in hidden_roots):
                command += ["--ro-bind", str(root), str(root)]
        # Rebind selected runtimes after hiding /tmp too: the frozen core's
        # active interpreter is extracted there and remains read-only.
        command += ["--proc", "/proc", "--dev", "/dev", "--bind", str(job_dir), str(job_dir)]
        # Bubblewrap creates parent directories for the explicitly rebound
        # roots/job. Lock each covering tmpfs only after those mounts exist:
        # otherwise a child can write siblings in the disposable /tmp or /home
        # mount. The separately bound job mount remains writable.
        for hidden in (*hidden_roots, "/proc", "/dev"):
            if Path(hidden).is_dir():
                command += ["--remount-ro", hidden]
        command += ["--chdir", str(job_dir), "--", *argv]
        return command

    def probe(self, *, refresh: bool = False) -> dict[str, Any]:
        if not refresh and self._checked and time.monotonic() - self._checked[0] < 60:
            return dict(self._checked[1])
        result: dict[str, Any] = {"available": False, "kind": None, "externalNetwork": "blocked", "reason": ""}
        try:
            system, _ = self._tool()
            self.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="isolation-probe-", dir=self.data_dir) as temporary:
                root = Path(temporary).resolve()
                job = root / "job"
                job.mkdir()
                outside = root / "outside"
                outside.write_text("private probe", encoding="utf-8")
                script = """import json,pathlib,socket,sys
job,outside=map(pathlib.Path,sys.argv[1:])
flags={}
try:
 (job/'allowed').write_text('ok');flags['workspaceWrite']=True
except OSError:flags['workspaceWrite']=False
try:
 outside.write_text('bad');flags['outsideWriteDenied']=False
except OSError:flags['outsideWriteDenied']=True
try:
 sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);sock.connect(('198.51.100.1',9));flags['externalNetworkDenied']=False
except OSError:flags['externalNetworkDenied']=True
print(json.dumps(flags))
"""
                env = {"PATH": os.defpath, "HOME": str(job), "TMPDIR": str(job / ".tmp"), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1"}
                if getattr(sys, "frozen", False):
                    env.update(PHYNITE_SANDBOX_PROBE_JOB=str(job), PHYNITE_SANDBOX_PROBE_OUTSIDE=str(outside))
                    argv = [sys.executable, "--sandbox-probe"]
                    extraction = getattr(sys, "_MEIPASS", None)
                    if not extraction or not Path(extraction).is_dir():
                        raise SandboxError("The frozen sandbox probe has no active native runtime directory.")
                    extraction = Path(extraction).resolve()
                    self.read_roots += (extraction,)
                    # PyInstaller 6.16 one-file subprocesses reuse the running
                    # interpreter's extraction. A fresh bootloader extraction
                    # needs SysV semaphores, which Seatbelt correctly denies.
                    # Derive only these internal values from this process;
                    # never copy arbitrary inherited environment or allow IPC.
                    env.update(_PYI_ARCHIVE_FILE=str(Path(sys.executable).resolve()),
                               _PYI_APPLICATION_HOME_DIR=str(extraction),
                               _PYI_PARENT_PROCESS_LEVEL="1")
                else:
                    argv = [sys.executable, "-c", script, str(job), str(outside)]
                command = self._command(job, argv)
                process = subprocess.run(command, cwd=job, env=env, capture_output=True, text=True, timeout=15, check=False)
                if process.returncode:
                    detail = " ".join(process.stderr.split())[:300]
                    raise SandboxError(f"Native isolation could not start (exit {process.returncode}): {detail or 'no diagnostic'}. Check OS sandbox/user-namespace support.")
                flags = json.loads(process.stdout) if process.returncode == 0 else {}
                failed = [key for key in ("workspaceWrite", "outsideWriteDenied", "externalNetworkDenied") if flags.get(key) is not True]
                if outside.read_text() != "private probe":
                    failed.append("outsideUnchanged")
                if failed:
                    raise SandboxError("The native isolation probe failed checks: " + ", ".join(failed) + ". Check OS sandbox/user-namespace support.")
                result.update(available=True, kind="macos-seatbelt" if system == "Darwin" else "linux-bubblewrap")
        except (SandboxError, OSError, ValueError, subprocess.SubprocessError) as error:
            result["reason"] = str(error)[:500]
        self._checked = (time.monotonic(), result)
        return dict(result)

    def command(self, job_dir: Path, argv: list[str]) -> list[str]:
        capability = self.probe()
        if capability["available"] is not True:
            raise SandboxError(capability["reason"])
        return self._command(Path(job_dir), argv)
