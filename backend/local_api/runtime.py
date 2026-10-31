"""Version-locked scientific runtime installation for the local desktop.

Only a server-owned manifest can select download URLs. A browser submits a
component name; it cannot supply an archive, checksum, executable, or URL.
"""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import platform
import re
import shutil
import tarfile
import tempfile
import threading
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Callable
from urllib.parse import urlsplit

from .sandbox import NativeSandbox
from .tls import verified_ssl_context as runtime_ssl_context


class RuntimeInstallError(RuntimeError):
    pass


def runtime_platform() -> str:
    system = {"Darwin": "darwin", "Linux": "linux"}.get(platform.system())
    architecture = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
    if not system or not architecture:
        raise RuntimeInstallError("Native compute supports macOS or Linux/WSL2 on ARM64 or x86-64.")
    return f"{system}-{architecture}"


def _relative(value: Any) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value or value.startswith("/"):
        raise RuntimeInstallError("Runtime archive contains an unsafe path.")
    path = PurePosixPath(value)
    if any(part in {"..", ""} for part in path.parts) or not path.parts:
        raise RuntimeInstallError("Runtime archive contains an unsafe path.")
    return path


class _PinnedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urlsplit(req.full_url), urlsplit(newurl)
        if (new.scheme, new.netloc) != (old.scheme, old.netloc):
            raise RuntimeInstallError("Runtime download redirected outside its approved origin.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(url: str) -> BinaryIO:
    opener = urllib.request.build_opener(_PinnedRedirect(), urllib.request.HTTPSHandler(context=runtime_ssl_context()))
    return opener.open(urllib.request.Request(url, headers={"User-Agent": "Phynite-Runtime-Installer"}), timeout=30)


class RuntimeManager:
    def __init__(self, data_dir: Path, manifest_path: Path | None = None, *, downloader: Callable[[str], BinaryIO] = _open):
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.root = self.data_dir / "runtimes"
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink():
            raise RuntimeInstallError("Runtime directory cannot be a symlink.")
        self.manifest_path = Path(manifest_path) if manifest_path else None
        self.downloader = downloader
        self._progress: dict[str, Any] = {"state": "idle", "component": None, "downloadedBytes": 0}
        self._mutex = threading.Lock()
        self.sandbox = NativeSandbox(self.data_dir, (self.root,))

    def _manifest(self) -> dict[str, Any]:
        if not self.manifest_path:
            return {"schemaVersion": 1, "components": {}}
        try:
            manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise RuntimeInstallError("The approved runtime manifest is missing or invalid.") from error
        if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("components"), dict):
            raise RuntimeInstallError("Unsupported runtime manifest version.")
        return manifest

    def _active(self) -> dict[str, Any]:
        path = self.root / "active.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            raise RuntimeInstallError("The installed runtime inventory is unreadable. Existing runtime files were retained.") from error

    def environment(self) -> dict[str, str]:
        paths: list[str] = []
        interpreters: dict[str, str] = {}
        for component, record in self._active().items():
            if component not in {"dft", "md", "analysis"} or not isinstance(record, dict):
                raise RuntimeInstallError("The installed runtime inventory has an invalid component.")
            release = self.root / str(_relative(record.get("directory")))
            if not release.resolve().is_relative_to(self.root) or release.is_symlink():
                raise RuntimeInstallError("The installed runtime directory is unsafe.")
            for name, relative in record.get("executables", {}).items():
                path = (release / str(_relative(relative))).resolve()
                if not path.is_relative_to(release.resolve()) or not path.is_file() or not os.access(path, os.X_OK):
                    raise RuntimeInstallError("An installed runtime executable is missing or unsafe.")
                if str(path.parent) not in paths:
                    paths.append(str(path.parent))
                if name in {"python", "python3"}:
                    interpreters[component] = str(path)
        environment = {"PATH": os.pathsep.join([*paths, os.environ.get("PATH", os.defpath)])}
        for component, python in interpreters.items():
            environment[f"PHYNITE_RUNTIME_PYTHON_{component.upper()}"] = python
        if interpreters:
            environment["PHYNITE_RUNTIME_PYTHON"] = next(iter(interpreters.values()))
        return environment

    def status(self) -> dict[str, Any]:
        manifest = self._manifest()
        target = runtime_platform()
        installed = self._active()
        environment = self.environment()
        binaries = {name: shutil.which(name, path=environment["PATH"]) for name in ("pw.x", "neb.x", "mpirun", "lmp", "lammps")}
        isolation = self.sandbox.probe()
        known = {name: builds[target] for name, builds in manifest["components"].items() if isinstance(builds, dict) and isinstance(builds.get(target), dict)}
        requirements = {}
        for name, entry in known.items():
            reason = ""
            if entry.get("format") == "conda-lock":
                from .conda_runtime import _check_host
                try:
                    _check_host(entry, target)
                except RuntimeInstallError as error:
                    reason = str(error)
                records = [entry.get("installer", {}), *entry.get("packages", []), *entry.get("wheels", [])]
                download_bytes = sum(record.get("sizeBytes", 0) for record in records if isinstance(record, dict) and type(record.get("sizeBytes", 0)) is int)
            else:
                download_bytes = entry.get("sizeBytes", 0)
            requirements[name] = {"downloadBytes": download_bytes, "maxInstalledBytes": entry.get("maxInstalledBytes", entry.get("unpackedBytes")), "minimumGlibc": entry.get("minimumGlibc"), "compatible": not reason, "reason": reason}
        available = [name for name in known if requirements[name]["compatible"]]
        qualification = {name: entry.get("qualificationStatus", "not-declared") for name, entry in known.items()}
        return {"platform": target, "installed": installed, "availableComponents": available, "qualification": qualification, "requirements": requirements, "executables": binaries, "isolation": isolation, "progress": dict(self._progress), "downloadAvailable": bool(available)}

    def install(self, component: str) -> dict[str, Any]:
        if component not in {"dft", "md", "analysis"}:
            raise RuntimeInstallError("Choose DFT, MD, or analysis from the approved runtime catalogue.")
        if not self._mutex.acquire(blocking=False):
            raise RuntimeInstallError("A runtime installation is already in progress.")
        try:
            with (self.root / ".install.lock").open("a+b") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as error:
                    raise RuntimeInstallError("Another process is installing a runtime.") from error
                return self._install(component)
        except Exception as error:
            self._progress = {**self._progress, "state": "failed", "error": str(error)[:500]}
            raise
        finally:
            self._mutex.release()

    def _install(self, component: str) -> dict[str, Any]:
        target = runtime_platform()
        entry = self._manifest()["components"].get(component, {}).get(target)
        if not isinstance(entry, dict):
            raise RuntimeInstallError("No reviewed runtime archive is published for this component and platform. An installed native solver can still be detected.")
        if entry.get("format") == "conda-lock":
            from .conda_runtime import install_locked_runtime
            return install_locked_runtime(self, component, target, entry)
        url = urlsplit(str(entry.get("url", "")))
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment:
            raise RuntimeInstallError("Runtime archives must use an approved HTTPS URL.")
        version, digest = entry.get("version"), entry.get("sha256")
        size, unpacked = entry.get("sizeBytes"), entry.get("unpackedBytes")
        if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", version) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise RuntimeInstallError("Runtime version and SHA-256 must be locked in the manifest.")
        if type(size) is not int or type(unpacked) is not int or not 1 <= size <= 8 * 1024**3 or not 1 <= unpacked <= 32 * 1024**3:
            raise RuntimeInstallError("Runtime download and extraction sizes must be bounded.")
        executables = entry.get("executables")
        notices = entry.get("notices")
        if not isinstance(executables, dict) or not executables or not isinstance(notices, list) or not notices:
            raise RuntimeInstallError("Runtime manifests must identify executables and third-party notices.")
        for name, relative in executables.items():
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", name):
                raise RuntimeInstallError("Runtime executable name is invalid.")
            _relative(relative)
        for notice in notices:
            _relative(notice)
        free = shutil.disk_usage(self.root).free
        if free < size + unpacked + 64 * 1024**2:
            raise RuntimeInstallError("Not enough free disk space to stage this runtime safely.")
        self._progress = {"state": "downloading", "component": component, "downloadedBytes": 0, "totalBytes": size}
        with tempfile.TemporaryDirectory(prefix=".staging-", dir=self.root) as temporary:
            staging = Path(temporary)
            archive = staging / "runtime.tar"
            sha = hashlib.sha256()
            with contextlib.closing(self.downloader(url.geturl())) as source, archive.open("xb") as output:
                received = 0
                while chunk := source.read(1024 * 1024):
                    received += len(chunk)
                    if received > size:
                        raise RuntimeInstallError("Runtime archive exceeds its reviewed download size.")
                    sha.update(chunk)
                    output.write(chunk)
                    self._progress["downloadedBytes"] = received
                output.flush()
                os.fsync(output.fileno())
            if received != size or sha.hexdigest() != digest:
                raise RuntimeInstallError("Runtime archive size or SHA-256 differs from the reviewed release. Existing runtime was retained.")
            self._progress["state"] = "extracting"
            destination = staging / "runtime"
            destination.mkdir()
            extracted = 0
            names: set[str] = set()
            with tarfile.open(archive, mode="r:*") as package:
                for index, member in enumerate(package):
                    if index > 100_000:
                        raise RuntimeInstallError("Runtime archive contains too many entries.")
                    relative = _relative(member.name)
                    name = str(relative)
                    if name in names or not (member.isfile() or member.isdir()) or member.mode & 0o6000:
                        raise RuntimeInstallError("Runtime archive contains duplicate paths, links, special files, or privileged modes.")
                    names.add(name)
                    if relative.suffix.lower() == ".upf":
                        raise RuntimeInstallError("Pseudopotentials must be installed separately with their own verified provenance and redistribution terms.")
                    path = destination / name
                    if member.isdir():
                        path.mkdir(parents=True, exist_ok=True)
                        continue
                    extracted += member.size
                    if extracted > unpacked:
                        raise RuntimeInstallError("Runtime archive expands beyond the reviewed size.")
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with package.extractfile(member) as source, path.open("xb") as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
                    path.chmod(0o755 if member.mode & 0o111 else 0o644)
            if extracted != unpacked:
                raise RuntimeInstallError("Runtime contents differ from the reviewed extraction size.")
            for relative in executables.values():
                path = destination / str(_relative(relative))
                if not path.is_file() or not os.access(path, os.X_OK):
                    raise RuntimeInstallError("Runtime archive lacks a declared executable.")
            for relative in notices:
                if not (destination / str(_relative(relative))).is_file():
                    raise RuntimeInstallError("Runtime archive lacks a required third-party notice.")
            release_name = f"{component}-{target}-{version}-{digest[:16]}"
            release = self.root / release_name
            if release.exists():
                # Never activate potentially modified leftovers from an earlier
                # install merely because a directory happens to have its name.
                raise RuntimeInstallError("This runtime release already exists; inspect or remove the inactive release before reinstalling.")
            destination.rename(release)
            inventory = self._active()
            inventory[component] = {"version": version, "platform": target, "sha256": digest, "directory": release_name, "executables": executables, "notices": notices}
            pending = staging / "active.json"
            with pending.open("x", encoding="utf-8") as output:
                json.dump(inventory, output, sort_keys=True)
                output.flush()
                os.fsync(output.fileno())
            os.replace(pending, self.root / "active.json")
        self._progress["state"] = "complete"
        return {"component": component, "installed": inventory[component]}
