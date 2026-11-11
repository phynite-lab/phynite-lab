"""Preserve interrupted scientific executions; never guess a solver restart state."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import uuid
from pathlib import Path
from typing import Any

JOURNAL = ".execution-journal.json"
ATTEMPT_MANIFEST = ".attempt-manifest.json"


class RecoveryError(RuntimeError):
    pass


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def canonical_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def atomic_json(path: Path, value: dict[str, Any], *, overwrite: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}-{uuid.uuid4().hex}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        if overwrite:
            temporary.replace(path)
        else:
            os.link(temporary, path)  # Atomic exclusive creation, including concurrent controllers.
    finally:
        temporary.unlink(missing_ok=True)


def claim_identity(job: dict[str, Any]) -> dict[str, Any]:
    # Signed URLs and worker credentials are intentionally excluded.
    downloads = {}
    for key in ("sourceDownload", "potentialDownloads", "pseudopotentialDownloads", "dependencyDownloads"):
        items = job.get(key) or []
        if isinstance(items, dict):
            items = [items]
        downloads[key] = [{name: item[name] for name in ("filename", "sha256", "sizeBytes", "role", "calculationId") if name in item}
                          for item in items if isinstance(item, dict)]
    payload = job.get("input") or {}
    return {"calculationId": job.get("calculationId"), "ownerId": job.get("ownerId"),
            "kind": job.get("kind", "qe"), "inputSha256": canonical_digest(payload),
            "modelsAndSources": downloads, "vcpus": job.get("vcpus"), "memoryMiB": job.get("memoryMiB")}


def runtime_identity(runtime: str, image: str | None, kind: str) -> dict[str, Any]:
    identity: dict[str, Any] = {"mode": runtime, "host": socket.gethostname(), "architecture": platform.machine(), "operatingSystem": platform.system(),
                                "mpiLauncher": os.environ.get("PHYNITE_MPI_LAUNCHER"),
                                "scheduler": os.environ.get("PHYNITE_HPC_SCHEDULER"),
                                "qeParallelMode": os.environ.get("PHYNITE_QE_PARALLEL_MODE", "auto")}
    if identity["scheduler"]:
        import hpc
        identity["schedulerAllocation"] = hpc.current_allocation(identity["scheduler"])
    # PyInstaller may spell its extracted module under /var while resolve()
    # spells the same macOS directory /private/var. Use one canonical root for
    # both provenance hashes and relative paths before any solver is started.
    source = Path(__file__).resolve()
    root = source.parents[1]
    source_paths = [source, source.with_name("worker.py")]
    source_paths += list((root / ("md_local" if kind in {"md-simulation", "md-analysis"} else "compute")).glob("*.py"))
    if kind == "md-analysis":
        source_paths += list((root / "md_studio").rglob("*.py"))
    identity["executionSources"] = [{"path": path.relative_to(root).as_posix(), "sha256": digest(path)} for path in sorted(set(source_paths)) if path.is_file()]
    if runtime == "docker":
        identity["image"] = image
        if image:
            try:
                reply = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", image], capture_output=True, text=True, timeout=30, check=False)
                identifier = reply.stdout.strip()
                if reply.returncode or not re.fullmatch(r"sha256:[a-f0-9]{64}", identifier):
                    raise RecoveryError("The local Docker runtime image has no verifiable immutable identity.")
                identity["imageId"] = identifier
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise RecoveryError("Cannot inspect the local Docker runtime image; preserve existing execution evidence.") from exc
        return identity
    executables = [sys.executable]
    executables += [shutil.which(name) for name in (("lmp", "lammps", "lmp_serial") if kind == "md-simulation" else
                     ("pw.x", "ph.x", "bands.x", "dos.x", "projwfc.x", "q2r.x", "matdyn.x", "mpirun", "srun", "mpiexec"))]
    identity["executables"] = [{"name": Path(path).name, "sha256": digest(Path(path).resolve())}
                                for path in executables if path and Path(path).is_file()]
    identity["packages"] = {}
    for name in ("numpy", "scipy", "ovito", "seekpath", "BoltzTraP2"):
        try:
            identity["packages"][name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            continue
    return identity


def inventory(directory: Path) -> list[dict[str, Any]]:
    result = []
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise RecoveryError(f"Recovery refuses symbolic link: {path.relative_to(directory)}")
        if path.is_file() and path != directory / ATTEMPT_MANIFEST:
            result.append({"path": path.relative_to(directory).as_posix(), "sizeBytes": path.stat().st_size, "sha256": digest(path)})
    return result


def contained_file(directory: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute() or ".." in Path(value).parts:
        raise RecoveryError("Recovery journal contains an invalid relative file path.")
    path = directory / value
    if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
        raise RecoveryError("Recovery journal file escapes its workspace.")
    return path


def has_execution_evidence(directory: Path) -> bool:
    if not directory.is_dir():
        return False
    if (directory / JOURNAL).is_file():
        return True
    for name in ("tmp", "results"):
        if (directory / name).is_dir() and any((directory / name).rglob("*")):
            return True
    log = directory / "worker-container.log"
    return log.is_file() and log.stat().st_size > 0


def begin(directory: Path, claim: dict[str, Any], runtime: dict[str, Any]) -> dict[str, Any]:
    journal = {"version": 1, "attemptId": uuid.uuid4().hex, "state": "prepared", "createdAtEpoch": int(time.time()),
               "claimIdentity": claim, "runtimeIdentity": runtime,
               "preparedInputSha256": digest(directory / "input.json") if (directory / "input.json").is_file() else None,
               "modelFiles": [entry for entry in inventory(directory) if entry["path"].startswith(("pseudo/", "potential/", "source/", "dependency-"))]}
    atomic_json(directory / JOURNAL, journal)
    return journal


def mark(directory: Path, state: str, **details: Any) -> None:
    path = directory / JOURNAL
    if not path.is_file():
        return
    journal = json.loads(path.read_text())
    journal.update({"state": state, "updatedAtEpoch": int(time.time()), **details})
    atomic_json(path, journal)


def verify_claim(directory: Path, claim: dict[str, Any], runtime: dict[str, Any]) -> list[str]:
    path = directory / JOURNAL
    if not path.is_file():
        return ["The previous execution predates recovery identity recording."]
    try:
        journal = json.loads(path.read_text())
        mismatches = []
        if journal.get("claimIdentity") != claim:
            mismatches.append("The calculation input, source/model identity, or resource request changed.")
        if journal.get("runtimeIdentity") != runtime:
            mismatches.append("The solver runtime or MPI launcher changed.")
        prepared = directory / "input.json"
        if journal.get("preparedInputSha256") and (not prepared.is_file() or digest(prepared) != journal["preparedInputSha256"]):
            mismatches.append("The prepared input checksum changed.")
        for entry in journal.get("modelFiles", []):
            path = contained_file(directory, entry["path"])
            if not path.is_file() or path.is_symlink() or path.stat().st_size != entry["sizeBytes"] or digest(path) != entry["sha256"]:
                mismatches.append(f"Model/source checksum mismatch: {entry['path']}")
        return mismatches
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RecoveryError("The execution journal is invalid; preserve the workspace for inspection.") from exc


def preserve(directory: Path, reason: str, identity_mismatches: list[str] | None = None) -> dict[str, Any]:
    """Move a stopped workspace atomically. A crash never deletes its checkpoints."""
    if directory.is_symlink() or not directory.is_dir():
        raise RecoveryError("Recovery requires an existing non-symlink workspace.")
    files = inventory(directory)
    try:
        journal = json.loads((directory / JOURNAL).read_text()) if (directory / JOURNAL).is_file() else None
    except (ValueError, OSError):
        journal = None
    identifier = f"{int(time.time())}-{uuid.uuid4().hex}"
    destination = directory.parent / ".recovery" / directory.name / identifier
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.parent.chmod(0o700)
    destination.parent.parent.chmod(0o700)
    descriptor = {"version": 1, "attemptId": identifier, "calculationId": directory.name,
                  "state": "manual-resume-required", "reason": reason, "preservedAtEpoch": int(time.time()),
                  "identityMismatches": identity_mismatches or [], "journal": journal, "files": files,
                  "inventorySha256": canonical_digest(files)}
    directory.rename(destination)
    # Rename happens before writing metadata. If interrupted here the original data
    # still lives under .recovery and can be inspected; nothing is overwritten.
    atomic_json(destination / ATTEMPT_MANIFEST, descriptor)
    destination.chmod(0o700)
    for path in destination.rglob("*"):
        if path.is_dir():
            path.chmod(0o700)
    for entry in files:
        (destination / entry["path"]).chmod(0o400)
    (destination / ATTEMPT_MANIFEST).chmod(0o400)
    return {"attemptId": identifier, "relativePath": destination.relative_to(directory.parent).as_posix(),
            "state": descriptor["state"], "inventorySha256": descriptor["inventorySha256"],
            "fileCount": len(files), "identityMismatches": descriptor["identityMismatches"]}


def verify_attempt(directory: Path) -> dict[str, Any]:
    if directory.is_symlink():
        raise RecoveryError("Recovery attempt cannot be a symbolic link.")
    manifest = json.loads((directory / ATTEMPT_MANIFEST).read_text())
    actual = inventory(directory)
    if manifest.get("files") != actual or manifest.get("inventorySha256") != canonical_digest(actual):
        raise RecoveryError("Preserved attempt checksum verification failed; do not resume it.")
    return manifest


def restore_archive(source: Path, destination: Path) -> dict[str, Any]:
    """Restore only ordinary attempt files, then verify their original inventory."""
    if destination.exists() or source.is_symlink():
        raise RecoveryError("Restore requires a new destination and a regular private archive.")
    destination.mkdir(parents=True, mode=0o700)
    try:
        seen: set[str] = set()
        total = 0
        with tarfile.open(source, "r:gz") as archive:
            for index, member in enumerate(archive):
                if index >= 100_000 or member.name in seen:
                    raise RecoveryError("Recovery archive has duplicate or excessive entries.")
                seen.add(member.name)
                parts = Path(member.name).parts
                if not parts or parts[0] != "attempt" or Path(member.name).is_absolute() or ".." in parts or not (member.isdir() or member.isfile()):
                    raise RecoveryError("Recovery archive contains an unsafe path or entry type.")
                if len(parts) == 1:
                    if not member.isdir():
                        raise RecoveryError("Recovery archive root must be an attempt directory.")
                    continue
                target = contained_file(destination, Path(*parts[1:]).as_posix())
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                    continue
                if member.size < 0 or member.size > 1_073_741_824 * 1024**2 or total + member.size > 1_073_741_824 * 1024**2:
                    raise RecoveryError("Recovery archive exceeds its bounded storage limit.")
                total += member.size
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                data = archive.extractfile(member)
                if data is None:
                    raise RecoveryError("Recovery archive file is missing.")
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with data, os.fdopen(descriptor, "wb") as output:
                    shutil.copyfileobj(data, output, 1024 * 1024)
                if target.stat().st_size != member.size:
                    raise RecoveryError("Recovery archive file size changed during extraction.")
        return verify_attempt(destination)
    except Exception:
        shutil.rmtree(destination)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect and recover Phynite checkpoints without claiming solver continuation succeeded.")
    parser.add_argument("action", choices=("inspect", "verify", "export", "restore"))
    parser.add_argument("attempt", type=Path)
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args(argv)
    restored_archive = args.action == "restore" and args.attempt.is_file()
    if restored_archive:
        if args.destination is None:
            raise RecoveryError("Restore requires a new --destination.")
        manifest = restore_archive(args.attempt, args.destination)
    else:
        manifest = verify_attempt(args.attempt)
    if args.action == "export":
        if args.destination is None:
            raise RecoveryError("Export requires --destination for a private .tar.gz archive.")
        with args.destination.open("xb") as output, tarfile.open(fileobj=output, mode="w:gz") as archive:
            archive.add(args.attempt, arcname="attempt")
        args.destination.chmod(0o600)
    elif args.action == "restore" and not restored_archive:
        if args.destination is None or args.destination.exists():
            raise RecoveryError("Restore requires a new --destination; existing data is never overwritten.")
        shutil.copytree(args.attempt, args.destination)
        verify_attempt(args.destination)
        for path in args.destination.rglob("*"):
            if path.is_file():
                path.chmod(0o600)
    print(json.dumps({"attemptId": manifest["attemptId"], "state": manifest["state"],
                      "fileCount": len(manifest["files"]), "inventorySha256": manifest["inventorySha256"],
                      "identityMismatches": manifest["identityMismatches"],
                      "checkpointFiles": [entry["path"] for entry in manifest["files"] if "restart" in entry["path"] or ".save/" in entry["path"]]}, indent=2))
    return 0


def host_subprocess_env(base_env: dict[str, str] | None = None) -> dict[str, str] | None:
    """Restore original dynamic-linker paths when spawning host tools from a frozen binary."""
    source = os.environ if base_env is None else base_env
    meipass = getattr(sys, "_MEIPASS", None)
    if not getattr(sys, "frozen", False) and not meipass:
        return None if base_env is None else dict(base_env)
    env = dict(source)
    meipass_root = Path(meipass).resolve() if meipass else None
    for variable in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        original = f"{variable}_ORIG"
        if original in env:
            if env[original]:
                env[variable] = env[original]
            else:
                env.pop(variable, None)
        elif variable in env:
            kept = []
            for entry in env[variable].split(os.pathsep):
                if not entry:
                    continue
                if meipass_root is not None:
                    try:
                        if Path(entry).resolve().is_relative_to(meipass_root):
                            continue
                    except OSError:
                        pass
                kept.append(entry)
            if kept:
                env[variable] = os.pathsep.join(kept)
            else:
                env.pop(variable, None)
    return env


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RecoveryError, OSError, ValueError) as exc:
        print(f"Recovery failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
