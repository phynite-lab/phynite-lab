#!/usr/bin/env python3
"""Prepare a reviewed, relocatable scientific runtime release; never publish it.

The input must already be a self-contained environment. This tool is not a
compiler, conda relocator, virtualenv copier, dependency downloader, or uploader.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


TARGETS = {"darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"}
REQUIRED = {
    "dft": {"python", "pw.x", "bands.x", "dos.x", "projwfc.x", "ph.x", "q2r.x", "matdyn.x", "mpirun"},
    "md": {"python", "lmp"},
    "analysis": {"python"},
}
IMPORTS = {"dft": ["numpy", "scipy", "seekpath", "matplotlib"], "md": ["numpy", "ovito"], "analysis": ["numpy", "ovito"]}
FORBIDDEN_NAMES = {".git", ".aws", ".ssh", ".npmrc", ".pypirc", "credentials", "credentials.json", "auth.json", "token.json", "phynite-computer.json", "core-service.json", "id_rsa", "id_ed25519", "sessions.sqlite", "identity.json"}
SKIP_NAMES = {"__pycache__", ".pytest_cache", ".DS_Store"}
PRIVATE_KEY = re.compile(rb"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----")


class ReleaseError(RuntimeError):
    pass


def relative(value: str) -> Path:
    path = PurePosixPath(value)
    if not value or value.startswith("/") or "\\" in value or "\0" in value or not path.parts or ".." in path.parts:
        raise ReleaseError("Release paths must be nonempty relative POSIX paths without traversal.")
    return Path(*path.parts)


def mapping(values: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for value in values:
        name, separator, location = value.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z0-9._-]+", name) or name in result:
            raise ReleaseError("Executables use distinct NAME=relative/path mappings.")
        result[name] = relative(location).as_posix()
    return result


def sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def copy_environment(source: Path, target: Path) -> list[dict]:
    """Flatten internal links; reject outside references and credentials."""
    source = source.resolve(strict=True)
    inventory: list[dict] = []

    def visit(path: Path, name: Path, ancestors: set[tuple[int, int]]) -> None:
        if path.name in SKIP_NAMES or path.suffix in {".pyc", ".pyo"}:
            return
        if path.name in FORBIDDEN_NAMES or path.name.startswith(".env") or path.suffix.lower() in {".upf", ".p12", ".pfx"}:
            raise ReleaseError(f"Forbidden credential, private configuration, or pseudopotential path: {name.as_posix()}")
        actual = path.resolve(strict=True)
        if not actual.is_relative_to(source):
            raise ReleaseError(f"The environment has a host-bound symlink: {name.as_posix()}. Build a genuinely relocatable environment first.")
        info = actual.stat()
        if info.st_mode & (stat.S_ISUID | stat.S_ISGID):
            raise ReleaseError(f"Privileged runtime modes are not allowed: {name.as_posix()}")
        destination = target / name
        if actual.is_dir():
            identity = (info.st_dev, info.st_ino)
            if identity in ancestors:
                raise ReleaseError(f"Runtime contains a directory-link cycle: {name.as_posix()}")
            destination.mkdir(parents=True, exist_ok=True)
            for child in sorted(actual.iterdir(), key=lambda entry: entry.name):
                visit(child, name / child.name, ancestors | {identity})
        elif actual.is_file():
            destination.parent.mkdir(parents=True, exist_ok=True)
            # Scan while copying; binary runtimes are never printed in diagnostics.
            tail = b""
            with actual.open("rb") as original, destination.open("xb") as output:
                first = True
                while block := original.read(1024 * 1024):
                    if PRIVATE_KEY.search(tail + block):
                        raise ReleaseError(f"A private-key marker was found in runtime path: {name.as_posix()}")
                    if first and info.st_mode & 0o111 and block.startswith(b"#!"):
                        shebang = block.splitlines()[0][2:].strip().split()[0].decode("utf-8", errors="replace")
                        if shebang.startswith("/") and shebang not in {"/bin/sh", "/bin/bash", "/usr/bin/env"}:
                            raise ReleaseError(f"Executable script has a host-bound interpreter: {name.as_posix()}")
                    first = False
                    output.write(block)
                    tail = block[-128:]
            destination.chmod(0o755 if info.st_mode & 0o111 else 0o644)
            inventory.append({"path": name.as_posix(), "sizeBytes": destination.stat().st_size, "sha256": sha256(destination), "executable": bool(info.st_mode & 0o111)})
        else:
            raise ReleaseError(f"Runtime contains a socket, device, or special file: {name.as_posix()}")

    target.mkdir()
    for child in sorted(source.iterdir(), key=lambda entry: entry.name):
        visit(child, Path(child.name), set())
    if not inventory:
        raise ReleaseError("An empty scientific runtime cannot be released.")
    return inventory


def relocation_check(root: Path, component: str, executables: dict[str, str]) -> dict:
    """Actually import science after relocation and check native dependency paths."""
    environment = {"PATH": str(root / "bin") + os.pathsep + os.defpath, "HOME": str(root / ".check-home"), "TMPDIR": str(root / ".check-temp"), "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"}
    Path(environment["HOME"]).mkdir()
    Path(environment["TMPDIR"]).mkdir()
    python = root / executables["python"]
    code = """import importlib,json,pathlib,sys,sysconfig
root=pathlib.Path(sys.argv[1]).resolve()
modules=[importlib.import_module(name) for name in json.loads(sys.argv[2])]
paths=[pathlib.Path(sys.prefix).resolve(),pathlib.Path(sys.base_prefix).resolve(),pathlib.Path(sysconfig.get_path('stdlib')).resolve()]
paths.extend(pathlib.Path(module.__file__).resolve() for module in modules if getattr(module,'__file__',None))
if not all(path.is_relative_to(root) for path in paths):raise RuntimeError('Scientific Python or imported dependencies still refer to the build host')
print(json.dumps({'passed':True,'imports':[module.__name__ for module in modules],'python':sys.version.split()[0]}))
"""
    try:
        process = subprocess.run([str(python), "-I", "-c", code, str(root), json.dumps(IMPORTS[component])], cwd=root, env=environment, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90, check=False)
        if process.returncode != 0:
            raise ReleaseError("Relocated scientific Python/import check failed. A copied venv or host-bound conda prefix cannot be published as a standalone runtime.")
        report = json.loads(process.stdout)
        if report.get("passed") is not True:
            raise ReleaseError("Scientific Python did not acknowledge the relocation check.")
        report["nativeDependencies"] = native_dependencies(root)
        return report
    finally:
        shutil.rmtree(root / ".check-home", ignore_errors=True)
        shutil.rmtree(root / ".check-temp", ignore_errors=True)


def native_dependencies(root: Path) -> dict:
    """Reject absolute build-host library and runtime search paths."""
    mac = sys.platform == "darwin"
    tool = shutil.which("otool" if mac else "readelf")
    if not tool:
        raise ReleaseError("Release qualification needs otool on macOS or readelf on Linux.")
    count = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        with path.open("rb") as source:
            magic = source.read(4)
        macho = magic in {b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"}
        elf = magic == b"\x7fELF"
        if not (macho if mac else elf):
            continue
        count += 1
        command = [tool, "-L", str(path)] if mac else [tool, "-d", str(path)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=True)
        output = result.stdout
        if mac:
            dependencies = [line.strip().split(" (", 1)[0] for line in output.splitlines()[1:] if line.strip()]
            bad = [value for value in dependencies if value.startswith("/") and not value.startswith(("/usr/lib/", "/System/Library/"))]
            load = subprocess.run([tool, "-l", str(path)], capture_output=True, text=True, timeout=20, check=True).stdout
            bad += [value for value in re.findall(r"\n\s*path (.*?) \(offset", load) if value.startswith("/")]
        else:
            dependencies = re.findall(r"Shared library: \[(.*?)\]", output)
            paths = re.findall(r"(?:RPATH|RUNPATH).*?\[(.*?)\]", output)
            bad = [value for value in dependencies if "/" in value]
            bad += [value for group in paths for value in group.split(":") if value and not value.startswith(("$ORIGIN", "${ORIGIN}"))]
            # Non-baseline libraries must ship in the environment rather than
            # accidentally resolve to an installed MPI/BLAS/Fortran package.
            baseline = ("libc.so", "libm.so", "libdl.so", "libpthread.so", "librt.so", "libutil.so", "libresolv.so", "libgcc_s.so", "ld-linux")
            bundled = {candidate.name for candidate in root.rglob("*") if candidate.is_file()}
            bad += [name for name in dependencies if name not in bundled and not name.startswith(baseline)]
        if bad:
            raise ReleaseError(f"Native dependencies remain host-bound in {path.relative_to(root).as_posix()}. Rewrite install names/RPATH and include the required redistributable libraries before assembly.")
    if count == 0:
        raise ReleaseError("No native Python or scientific libraries were found in the proposed runtime.")
    return {"checkedNativeFiles": count, "absoluteBuildHostPaths": False}


def assemble(source: Path, output: Path, component: str, version: str, target: str, release_base_url: str, executables: dict[str, str], notices: list[str], *, check=relocation_check) -> dict:
    if component not in REQUIRED or target not in TARGETS or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", version):
        raise ReleaseError("Choose a supported component, target platform, and explicit release version.")
    missing = REQUIRED[component] - set(executables)
    if missing:
        raise ReleaseError("Declare every required executable: " + ", ".join(sorted(missing)))
    base = urlsplit(release_base_url)
    if base.scheme != "https" or not base.hostname or base.username or base.password or base.query or base.fragment:
        raise ReleaseError("An explicit HTTPS release base URL without credentials is required. Assembly never uploads to it.")
    if not notices:
        raise ReleaseError("Include the exact redistribution notices and applicable source-offer instructions.")
    source, output = source.resolve(strict=True), output.resolve()
    if output.is_relative_to(source):
        raise ReleaseError("Release output must be outside the source environment.")
    output.mkdir(parents=True, exist_ok=True)
    filename = f"phynite-runtime-{component}-{target}-{version}.tar.gz"
    archive = output / filename
    prepared = output / f"{filename}.manifest.prepared.json"
    if archive.exists() or prepared.exists():
        raise ReleaseError("Release artifacts already exist. Use a new output directory or version; never overwrite a reviewed release.")
    with tempfile.TemporaryDirectory(prefix=".native-release-", dir=output) as temporary:
        staging = Path(temporary)
        relocated = staging / "relocated-runtime"
        inventory = copy_environment(source, relocated)
        for name, value in executables.items():
            binary = relocated / relative(value)
            if not binary.is_file() or not os.access(binary, os.X_OK):
                raise ReleaseError(f"Declared executable is missing or not executable: {name}")
        for value in notices:
            if not (relocated / relative(value)).is_file():
                raise ReleaseError("A declared third-party notice is missing from the runtime.")
        qualification = check(relocated, component, executables)
        if qualification.get("passed") is not True:
            raise ReleaseError("The relocated scientific runtime did not pass its qualification.")
        for record in inventory:
            checked = relocated / record["path"]
            if not checked.is_file() or checked.stat().st_size != record["sizeBytes"] or sha256(checked) != record["sha256"]:
                raise ReleaseError("Runtime initialization modified a release file. Prepare an immutable environment before assembly.")
        candidate = staging / filename
        with candidate.open("xb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as package:
            for record in inventory:
                path = relocated / record["path"]
                info = tarfile.TarInfo(record["path"])
                info.size = record["sizeBytes"]
                info.mode = 0o755 if record["executable"] else 0o644
                info.mtime = 0
                with path.open("rb") as stream:
                    package.addfile(info, stream)
        entry = {"version": version, "url": release_base_url.rstrip("/") + "/" + filename, "sha256": sha256(candidate), "sizeBytes": candidate.stat().st_size, "unpackedBytes": sum(record["sizeBytes"] for record in inventory), "executables": executables, "notices": notices}
        manifest = {"schemaVersion": 1, "releaseStatus": "prepared-not-published", "components": {component: {target: entry}}}
        report = {"component": component, "platform": target, "archiveSha256": entry["sha256"], "qualification": qualification, "files": inventory, "published": False}
        candidate.rename(archive)
        prepared.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        (output / f"{filename}.inventory.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {"archive": str(archive), "preparedManifest": str(prepared), "sha256": entry["sha256"], "sizeBytes": entry["sizeBytes"], "unpackedBytes": entry["unpackedBytes"], "published": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Already relocatable scientific environment, including Python and native libraries.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--component", choices=tuple(REQUIRED), required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--platform", choices=sorted(TARGETS), required=True)
    parser.add_argument("--release-base-url", required=True)
    parser.add_argument("--executable", action="append", required=True, metavar="NAME=RELATIVE_PATH")
    parser.add_argument("--notice", action="append", required=True, metavar="RELATIVE_PATH")
    args = parser.parse_args()
    import platform
    host = ("darwin" if sys.platform == "darwin" else "linux" if sys.platform.startswith("linux") else "unsupported") + "-" + ("arm64" if platform.machine() in {"arm64", "aarch64"} else "x64" if platform.machine() in {"x86_64", "AMD64"} else "unsupported")
    if args.platform != host:
        parser.error("Prepare and qualify each runtime on its actual target OS/architecture; cross-target assembly is not qualification.")
    try:
        print(json.dumps(assemble(args.source, args.output, args.component, args.version, args.platform, args.release_base_url, mapping(args.executable), args.notice), indent=2))
    except (OSError, ValueError, ReleaseError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Runtime release was not prepared: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
