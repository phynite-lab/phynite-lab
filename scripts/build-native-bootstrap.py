#!/usr/bin/env python3
"""Prepare a relocatable, non-setuid Linux sandbox bootstrap from a locked prefix.

Build on the target architecture. The source prefix must match a reviewed
conda lock. The optional --prepare-prefix mode downloads only exact verified lock
records and links them offline. Neither mode installs system software, changes
namespace policy or publishes an artifact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import stat
import struct
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Callable
from urllib.parse import unquote, urlsplit


SYSTEM_LIBRARIES = {"libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1", "ld-linux-aarch64.so.1", "ld-linux-x86-64.so.2"}
INTERPRETERS = {"linux-arm64": "/lib/ld-linux-aarch64.so.1", "linux-x64": "/lib64/ld-linux-x86-64.so.2"}


class BootstrapError(RuntimeError):
    pass


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def elf_target(path: Path) -> str:
    header = path.read_bytes()[:20]
    if len(header) != 20 or header[:5] != b"\x7fELF\x02" or header[5] not in {1, 2}:
        raise BootstrapError("Bootstrap files must be native 64-bit ELF objects.")
    machine = struct.unpack("<H" if header[5] == 1 else ">H", header[18:20])[0]
    target = {62: "linux-x64", 183: "linux-arm64"}.get(machine)
    if target is None:
        raise BootstrapError("The bootstrap ELF architecture is unsupported.")
    return target


def regular_source(prefix: Path, path: Path) -> Path:
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(prefix) or not resolved.is_file() or resolved.stat().st_mode & (stat.S_ISUID | stat.S_ISGID):
        raise BootstrapError("Bootstrap inputs must be non-setuid files inside the reviewed prefix.")
    return resolved


def _run(argv: list[str]) -> str:
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        raise BootstrapError("Native bootstrap inspection or relocation failed.")
    return result.stdout.strip()


def _notice_tree(notices: Path) -> None:
    if not notices.is_dir():
        raise BootstrapError("Reviewed bootstrap license and source notices are required.")
    files = list(notices.rglob("*"))
    if not any(path.is_file() for path in files):
        raise BootstrapError("Reviewed bootstrap license and source notices are required.")
    for path in files:
        relative = path.relative_to(notices)
        if path.is_symlink() or any(part.startswith(".") for part in relative.parts) or path.suffix.lower() in {".upf", ".pem", ".key"} or not (path.is_dir() or path.is_file()):
            raise BootstrapError("The bootstrap notice tree contains an unsafe file.")


def prepare_prefix(prefix: Path, target: str, lock: dict, notices: Path, *, downloader=None, runner: Callable = subprocess.run) -> tuple[Path, Path]:
    """Fetch exact reviewed inputs, then invoke the pinned installer offline."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.local_api.conda_runtime import _download_record, _extract_tool, _verified_download
    from backend.local_api.runtime import _open
    prefix = prefix.absolute()
    work = prefix.with_name(prefix.name + "-build")
    notices = notices.resolve(strict=True)
    _notice_tree(notices)
    if prefix.exists() or prefix.is_symlink() or work.exists() or work.is_symlink() or prefix.resolve().is_relative_to(notices) or work.resolve().is_relative_to(notices):
        raise BootstrapError("Prefix preparation requires new prefix and build directories; existing files are retained.")
    if lock.get("target") != target or lock.get("minimumGlibc") != "2.39":
        raise BootstrapError("Use a reviewed bootstrap lock for the matching native target.")
    packages, installer = lock.get("packages"), lock.get("installer")
    if not isinstance(packages, list) or not 1 <= len(packages) <= 100 or not isinstance(installer, dict):
        raise BootstrapError("The bootstrap lock lacks exact package and installer records.")
    _download_record(installer, target, tool=True)
    for record in packages:
        _download_record(record, target)
    records = [installer, *packages]
    names = [unquote(urlsplit(record["url"]).path.rsplit("/", 1)[1]) for record in records]
    if len(set(names)) != len(names) or any("/" in name or "\\" in name for name in names):
        raise BootstrapError("The bootstrap lock has duplicate or unsafe filenames.")
    work.mkdir(parents=True, mode=0o700)
    cache = work / "downloads"
    cache.mkdir()
    manager = SimpleNamespace(downloader=downloader or _open, _progress={"downloadedBytes": 0})
    downloads = [cache / name for name in names]
    for record, destination in zip(records, downloads):
        _verified_download(manager, record, destination)
    tool = _extract_tool(downloads[0], work)
    if elf_target(tool) != target:
        raise BootstrapError("The locked installer does not match the native target.")
    explicit = work / "explicit-lock.txt"
    explicit.write_text("@EXPLICIT\n" + "\n".join(path.as_uri().replace("%21", "!") for path in downloads[1:]) + "\n")
    environment = {"PATH": os.defpath, "HOME": str(work / "home"), "TMPDIR": str(work / "tmp"), "PYTHONNOUSERSITE": "1"}
    Path(environment["HOME"]).mkdir()
    Path(environment["TMPDIR"]).mkdir()
    command = [str(tool), "create", "--offline", "--no-rc", "--no-env", "--json", "--yes", "--no-pyc", "--always-copy", "--no-deps", "--root-prefix", str(work / "mamba"), "--prefix", str(prefix), "--file", str(explicit)]
    with (work / "installation.log").open("w") as log:
        result = runner(command, cwd=work, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=300, check=False)
    if result.returncode:
        raise BootstrapError("Offline bootstrap prefix preparation failed. Inspect the retained installation log.")
    merged = work / "notices"
    shutil.copytree(notices, merged / "reviewed")
    (merged / "source-lock.json").write_text(json.dumps(lock, sort_keys=True, indent=2) + "\n")
    for package in (work / "mamba/pkgs").iterdir():
        info = package / "info"
        if package.is_dir() and info.is_dir():
            shutil.copytree(info, merged / "conda-packages" / package.name, symlinks=True)
    _notice_tree(merged)
    return prefix, merged


def assemble(prefix: Path, output: Path, target: str, lock: dict, notices: Path, *, inspect: Callable[[list[str]], str] = _run, qualify: Callable[[Path], dict] | None = None) -> dict:
    prefix, output, notices = prefix.resolve(strict=True), output.absolute(), notices.resolve(strict=True)
    if target not in {"linux-arm64", "linux-x64"} or lock.get("target") != target or lock.get("minimumGlibc") != "2.39":
        raise BootstrapError("Declare a reviewed Linux bootstrap lock and glibc 2.39 baseline.")
    if output.exists() or output.is_symlink() or output.resolve().is_relative_to(prefix) or output.resolve().is_relative_to(notices) or not notices.is_dir():
        raise BootstrapError("Use a new output directory outside the source prefix and reviewed notices.")
    expected = {(item["name"], item["version"], item["build"]): item for item in lock.get("packages", [])}
    if not expected or len(expected) != len(lock["packages"]) or not any(name == "bubblewrap" and version == "0.13.1" for name, version, _ in expected):
        raise BootstrapError("The reviewed bootstrap lock must pin bubblewrap 0.13.1.")
    installed = {}
    for path in (prefix / "conda-meta").glob("*.json"):
        item = json.loads(path.read_text())
        installed[(item.get("name"), item.get("version"), item.get("build"))] = item
    if set(installed) != set(expected):
        raise BootstrapError("The bootstrap prefix inventory differs from its reviewed lock.")
    for identity, item in installed.items():
        source = expected[identity]
        url = item.get("url")
        if url == source.get("url") and item.get("sha256") == source.get("sha256"):
            continue
        # Offline explicit installation accurately records a file:// origin.
        # Verify those retained bytes instead of rewriting their provenance.
        parsed = urlsplit(url if isinstance(url, str) else "")
        archive = Path(unquote(parsed.path))
        if parsed.scheme != "file" or parsed.netloc or parsed.query or parsed.fragment or archive.is_symlink() or not archive.is_file() or archive.stat().st_size != source.get("sizeBytes") or digest(archive) != source.get("sha256") or item.get("sha256") not in {None, source.get("sha256")}:
            raise BootstrapError("The bootstrap prefix provenance differs from its reviewed lock.")
    binary = regular_source(prefix, prefix / "bin/bwrap")
    patcher = regular_source(prefix, prefix / "bin/patchelf")
    if elf_target(binary) != target or elf_target(patcher) != target:
        raise BootstrapError("Build the Linux bootstrap on its matching native architecture.")
    if inspect([str(patcher), "--print-interpreter", str(binary)]) != INTERPRETERS[target]:
        raise BootstrapError("The bootstrap has an unsupported or build-host-bound ELF interpreter.")
    _notice_tree(notices)
    output.mkdir(parents=True, mode=0o755)
    libraries = output / "libraries"
    libraries.mkdir()
    destination = output / "bwrap"
    shutil.copyfile(binary, destination)
    destination.chmod(0o755)
    copied = {}
    pending = [destination]
    while pending:
        file = pending.pop()
        for name in inspect([str(patcher), "--print-needed", str(file)]).splitlines():
            if name in SYSTEM_LIBRARIES:
                continue
            if "/" in name or "\\" in name or name in {"", ".", ".."}:
                raise BootstrapError("The bootstrap contains a host-bound native dependency.")
            if name in copied:
                continue
            source = regular_source(prefix, prefix / "lib" / name)
            if elf_target(source) != target:
                raise BootstrapError("A bootstrap library has the wrong native architecture.")
            library = libraries / name
            shutil.copyfile(source, library)
            library.chmod(0o644)
            copied[name] = library
            pending.append(library)
        inspect([str(patcher), "--set-rpath", "$ORIGIN/libraries" if file == destination else "$ORIGIN", str(file)])
    shutil.copytree(notices, output / "notices")
    (output / "source-lock.json").write_text(json.dumps(lock, sort_keys=True, indent=2) + "\n")
    record = {"executable": "bwrap", "sha256": digest(destination), "libraries": [{"path": file.relative_to(output).as_posix(), "sha256": digest(file)} for _, file in sorted(copied.items())]}
    manifest = {"schemaVersion": 1, "target": target, "minimumGlibc": "2.39", "tools": {"bwrap": record}, "notices": "notices", "sourceLock": "source-lock.json"}
    (output / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    expected_hashes = {record["path"]: record["sha256"] for record in [{"path": "bwrap", "sha256": record["sha256"]}, *record["libraries"]]}
    if qualify is None:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from backend.local_api.sandbox import NativeSandbox
        from tempfile import TemporaryDirectory
        version = inspect([str(destination), "--version"])
        if version != "bubblewrap 0.13.1":
            raise BootstrapError("The relocated bootstrap version differs from its reviewed lock.")
        with TemporaryDirectory(prefix="phynite-bootstrap-probe-") as folder:
            qualification = NativeSandbox(Path(folder), bootstrap_dir=output).probe(refresh=True)
    else:
        qualification = qualify(output)
    if qualification.get("available") is not True:
        raise BootstrapError("The packaged bootstrap did not pass the native OS isolation probe. Check user namespaces and AppArmor policy; no policy was changed.")
    if any(digest(output / path) != value for path, value in expected_hashes.items()):
        raise BootstrapError("Qualification modified a reviewed bootstrap file.")
    (output / "qualification.json").write_text(json.dumps(qualification, indent=2) + "\n")
    return {"directory": str(output), "manifestSha256": digest(output / "manifest.json"), "target": target, "qualified": True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--prefix", type=Path, help="An existing prefix matching the reviewed lock")
    source.add_argument("--prepare-prefix", type=Path, help="Download the verified lock and prepare this new prefix offline")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target", choices=["linux-arm64", "linux-x64"], required=True)
    parser.add_argument("--notices", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=Path("backend/local_api/native-bootstrap-lock.json"))
    args = parser.parse_args()
    catalog = json.loads(args.lock.read_text())
    if catalog.get("schemaVersion") != 1 or args.target not in catalog.get("targets", {}):
        parser.error("The reviewed native bootstrap target lock is unavailable.")
    actual = {"aarch64": "linux-arm64", "arm64": "linux-arm64", "x86_64": "linux-x64"}.get(platform.machine())
    if platform.system() != "Linux" or actual != args.target:
        parser.error("Run the bootstrap builder on the selected native Linux target.")
    libc, version = platform.libc_ver()
    if libc != "glibc" or not version or tuple(map(int, version.split("."))) < (2, 39):
        parser.error("Use a native Linux builder with glibc 2.39 or later.")
    lock = catalog["targets"][args.target]
    prefix, notices = prepare_prefix(args.prepare_prefix, args.target, lock, args.notices) if args.prepare_prefix else (args.prefix, args.notices)
    print(json.dumps(assemble(prefix, args.output, args.target, lock, notices)))


if __name__ == "__main__":
    main()
