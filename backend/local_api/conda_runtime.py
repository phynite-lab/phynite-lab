"""Install only an explicitly reviewed conda package lock, without solving.

All downloads are verified before the native installer starts. Installation
uses local file URLs, offline mode, an empty home, and the OS sandbox. Conda
prefix rewriting happens at the immutable final prefix; activation changes only
the inventory pointer after real scientific imports and executable checks pass.
"""
from __future__ import annotations

import contextlib
import csv
import email.parser
import hashlib
import itertools
import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .runtime import RuntimeInstallError, _relative


SUBDIRS = {"darwin-arm64": "osx-arm64", "darwin-x64": "osx-64", "linux-arm64": "linux-aarch64", "linux-x64": "linux-64"}
REQUIRED = {"dft": {"python", "pw.x", "bands.x", "dos.x", "projwfc.x", "ph.x", "q2r.x", "matdyn.x", "mpirun"}, "md": {"python", "lmp", "mpirun"}, "analysis": {"python"}}
IMPORTS = {"dft": ["numpy", "scipy", "seekpath", "matplotlib", "psutil"], "md": ["numpy", "ovito", "psutil", "requests", "fastapi", "pydantic", "python_multipart"], "analysis": ["numpy", "ovito", "psutil", "requests", "fastapi", "pydantic", "python_multipart"]}


def _download_record(record: dict, target: str, *, tool: bool = False) -> tuple[str, int, str]:
    if not isinstance(record, dict):
        raise RuntimeInstallError("A reviewed conda lock has an invalid download record.")
    url, digest, size = record.get("url"), record.get("sha256"), record.get("sizeBytes")
    parsed = urlsplit(url if isinstance(url, str) else "")
    path = _relative(parsed.path.lstrip("/"))
    allowed = {SUBDIRS[target]} if tool else {SUBDIRS[target], "noarch"}
    conda_forge = parsed.netloc == "conda.anaconda.org" and len(path.parts) == 3 and path.parts[0] == "conda-forge" and path.parts[1] in allowed
    official_ovito = not tool and parsed.netloc == "conda.ovito.org" and len(path.parts) == 2 and path.parts[0] in allowed and path.name.startswith(("ovito-", "anari_ovito-", "ospray_ovito-", "visrtx_ovito-"))
    if parsed.scheme != "https" or parsed.query or parsed.fragment or not (conda_forge or official_ovito):
        raise RuntimeInstallError("Locked runtime downloads must use the approved conda-forge or official OVITO package URLs for this platform.")
    if not path.name.endswith((".conda", ".tar.bz2")) or (tool and not path.name.startswith("micromamba-")):
        raise RuntimeInstallError("The runtime lock contains an unsupported native package.")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or type(size) is not int or not 0 < size <= 2 * 1024**3:
        raise RuntimeInstallError("Every runtime package needs a reviewed SHA-256 and bounded exact size.")
    return url, size, digest

def _wheel_record(record: dict, target: str) -> tuple[str, int, str]:
    """Validate a distinct, immutable PyPI wheel record, never a conda package."""
    if not isinstance(record, dict) or target != "linux-arm64":
        raise RuntimeInstallError("Reviewed wheel overlays currently support Linux ARM64 only.")
    url = record.get("url")
    parsed = urlsplit(url if isinstance(url, str) else "")
    name, version = record.get("name"), record.get("version")
    filename, digest, size = record.get("filename"), record.get("sha256"), record.get("sizeBytes")
    if parsed.scheme != "https" or parsed.netloc != "files.pythonhosted.org" or parsed.query or parsed.fragment or not parsed.path.startswith("/packages/"):
        raise RuntimeInstallError("Reviewed wheel downloads must use exact official Python package URLs.")
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", name) or not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.!+_-]{0,79}", version):
        raise RuntimeInstallError("Reviewed wheels need exact package names and versions.")
    path = _relative(unquote(parsed.path).lstrip("/"))
    if not isinstance(filename, str) or len(_relative(filename).parts) != 1 or path.name != filename or not filename.endswith(".whl"):
        raise RuntimeInstallError("The reviewed wheel filename is invalid.")
    fields = filename[:-4].rsplit("-", 3)
    if len(fields) != 4:
        raise RuntimeInstallError("The reviewed wheel has invalid compatibility tags.")
    identity, python_tag, abi_tag, platform_tag = fields
    if identity != f"{name.replace('-', '_')}-{version}" or record.get("tags") != [python_tag, abi_tag, platform_tag]:
        raise RuntimeInstallError("The reviewed wheel identity or tags differ from its filename.")
    interpreter_ok = python_tag == "cp312" and abi_tag == "cp312" or python_tag in {"cp38", "cp39", "cp310", "cp311", "cp312"} and abi_tag == "abi3" or python_tag in {"py3", "py2.py3"} and abi_tag == "none"
    platforms = platform_tag.split(".")
    platform_ok = all(tag in {"any", "manylinux2014_aarch64"} or re.fullmatch(r"manylinux_2_(?:[0-9]|[12][0-9]|3[0-9])_aarch64", tag) for tag in platforms)
    if not interpreter_ok or not platform_ok:
        raise RuntimeInstallError("The reviewed wheel does not support this CPython 3.12 Linux ARM64 runtime.")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or type(size) is not int or not 0 < size <= 2 * 1024**3 or not isinstance(record.get("license"), str) or not record["license"] or len(record["license"]) > 200:
        raise RuntimeInstallError("Every reviewed wheel needs a bounded exact size, SHA-256 and license.")
    return url, size, digest


def _check_host(entry: dict, target: str) -> None:
    minimum = entry.get("minimumGlibc")
    if minimum is None:
        return
    if not target.startswith("linux-") or minimum != "2.39":
        raise RuntimeInstallError("The runtime lock has an unsupported minimum glibc declaration.")
    libc, version = platform.libc_ver()
    if libc != "glibc" or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)+", version) or tuple(map(int, version.split("."))) < (2, 39):
        raise RuntimeInstallError("This runtime requires glibc 2.39 or later: use Ubuntu 24.04 or a compatible Linux/WSL2 distribution.")


def _validate_wheel_archive(record: dict, path: Path, maximum: int) -> None:
    """Verify metadata and paths before running any trusted native installer."""
    try:
        with zipfile.ZipFile(path) as archive:
            size = 0
            metadata = []
            wheel = []
            for member in archive.infolist():
                relative = _relative(member.filename.rstrip("/"))
                if (member.external_attr >> 16) & 0o170000 == 0o120000:
                    raise RuntimeInstallError("Reviewed wheels may not contain symlinks.")
                size += member.file_size
                if size > maximum:
                    raise RuntimeInstallError("A reviewed wheel exceeds the installation-size budget.")
                if relative.name == "METADATA" and len(relative.parts) == 2 and relative.parts[0].endswith(".dist-info"):
                    metadata.append(archive.read(member))
                if relative.name == "WHEEL" and len(relative.parts) == 2 and relative.parts[0].endswith(".dist-info"):
                    wheel.append(archive.read(member))
            if len(metadata) != 1 or len(wheel) != 1:
                raise RuntimeInstallError("A reviewed wheel lacks unique package metadata.")
            info = email.parser.BytesParser().parsebytes(metadata[0])
            normalize = lambda value: re.sub(r"[-_.]+", "-", value).lower()
            if normalize(info.get("Name", "")) != normalize(record["name"]) or info.get("Version") != record["version"]:
                raise RuntimeInstallError("Reviewed wheel metadata differs from the locked package identity.")
            wheel_info = email.parser.BytesParser().parsebytes(wheel[0])
            expected_tags = {"-".join(parts) for parts in itertools.product(*(tag.split(".") for tag in record["tags"]))}
            if expected_tags != set(wheel_info.get_all("Tag", [])):
                raise RuntimeInstallError("Reviewed wheel metadata differs from its compatibility tags.")
    except (OSError, zipfile.BadZipFile, KeyError) as error:
        raise RuntimeInstallError("The reviewed wheel archive is invalid.") from error


def _install_wheels(manager, release: Path, wheels: list[dict], environment: dict) -> list[dict]:
    if not wheels:
        return []
    requirements = release / "wheel-requirements.txt"
    requirements.write_text("".join(f"{item['name']}=={item['version']} --hash=sha256:{item['sha256']}\n" for item in wheels), encoding="utf-8")
    command = [str(release / "env/bin/python"), "-I", "-m", "pip", "--isolated", "install"]
    # No-index, no-deps and local find-links are pip's offline contract; OS
    # isolation independently blocks sockets.
    command += ["--no-index", "--no-deps", "--no-cache-dir", "--no-compile", "--require-hashes", "--only-binary=:all:", "--find-links", str(release / ".downloads"), "--requirement", str(requirements)]
    command = manager.sandbox.command(release, command)
    with (release / "wheel-installation.log").open("w", encoding="utf-8") as output:
        result = subprocess.run(command, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, timeout=300, check=False)
    if result.returncode:
        raise RuntimeInstallError("Offline installation of the reviewed wheels failed. Inspect the retained wheel log; the previous runtime remains active.")
    normalize = lambda value: re.sub(r"[-_.]+", "-", value).lower()
    expected = {normalize(item["name"]): item["version"] for item in wheels}
    actual = {}
    metadata_paths = {}
    for path in (release / "env/lib/python3.12/site-packages").glob("*.dist-info/METADATA"):
        if path.is_symlink() or not path.resolve().is_relative_to(release / "env"):
            raise RuntimeInstallError("Installed wheel metadata escapes the immutable prefix.")
        info = email.parser.BytesParser().parsebytes(path.read_bytes())
        name = normalize(info.get("Name", ""))
        if name in expected:
            if name in actual:
                raise RuntimeInstallError("The installed wheel inventory contains duplicate packages.")
            actual[name] = info.get("Version")
            metadata_paths[name] = path.parent.relative_to(release / "env").as_posix()
            shutil.copytree(path.parent, release / "notices/wheels" / path.parent.name, symlinks=False)
    if actual != expected:
        raise RuntimeInstallError("The installed wheel inventory differs from the reviewed lock.")
    return [{"name": item["name"], "version": item["version"], "sha256": item["sha256"], "distInfo": metadata_paths[normalize(item["name"]) ]} for item in wheels]

def _repair_linux_wheel_libraries(manager, release: Path, inventory: list[dict], environment: dict) -> int:
    """Keep each wheel's native dependencies inside its own immutable prefix."""
    if not inventory:
        return 0
    release = release.resolve()
    prefix = release / "env"
    patcher = prefix / "bin/patchelf"
    if not patcher.is_file() or not patcher.resolve().is_relative_to(prefix):
        raise RuntimeInstallError("The reviewed wheel overlay needs its pinned runtime patchelf for native-library relocation.")
    changed = []
    seen = set()
    with (release / "wheel-relocation.log").open("w", encoding="utf-8") as log:
        for package in inventory:
            metadata = prefix / str(_relative(package["distInfo"]))
            record = metadata / "RECORD"
            if not record.is_file() or record.is_symlink():
                raise RuntimeInstallError("The installed wheel lacks its native-file inventory.")
            with record.open(newline="") as stream:
                files = list(csv.reader(stream))
            for fields in files:
                if not fields:
                    continue
                binary = metadata.parent / fields[0]
                if binary.is_symlink() or not binary.resolve().is_relative_to(prefix):
                    raise RuntimeInstallError("An installed wheel file escapes its immutable prefix.")
                binary = binary.resolve()
                if binary in seen or not binary.is_file():
                    continue
                seen.add(binary)
                with binary.open("rb") as source:
                    if source.read(4) != b"\x7fELF":
                        continue
                argv = manager.sandbox.command(release, [str(patcher), "--print-rpath", str(binary)])
                result = subprocess.run(argv, cwd=release, env=environment, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30, check=False)
                if result.returncode:
                    raise RuntimeInstallError("A reviewed wheel's ELF search path could not be inspected.")
                paths = []
                for value in result.stdout.strip().split(":"):
                    if not value:
                        continue
                    if value == "$ORIGIN" or value.startswith("$ORIGIN/"):
                        location = binary.parent / value.removeprefix("$ORIGIN").lstrip("/")
                        if not location.resolve().is_relative_to(prefix):
                            raise RuntimeInstallError("A wheel library search path escapes its immutable prefix.")
                        paths.append(value)
                    elif value.startswith("/"):
                        # Upstream wheels can retain build-host paths. Remove
                        # those paths instead of requiring that host's Qt/GL.
                        if Path(value).resolve().is_relative_to(prefix):
                            paths.append(value)
                    else:
                        raise RuntimeInstallError("A wheel library has an unsupported native search path.")
                local = "$ORIGIN/" + os.path.relpath(prefix / "lib", binary.parent)
                paths = list(dict.fromkeys([*paths, local]))
                argv = manager.sandbox.command(release, [str(patcher), "--set-rpath", ":".join(paths), str(binary)])
                result = subprocess.run(argv, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=30, check=False)
                if result.returncode:
                    raise RuntimeInstallError("A reviewed wheel's native dependencies could not be relocated.")
                sha = hashlib.sha256()
                with binary.open("rb") as source:
                    while block := source.read(1024 * 1024):
                        sha.update(block)
                changed.append({"path": binary.relative_to(prefix).as_posix(), "sha256": sha.hexdigest(), "rpath": paths})
    (release / "wheel-library-relocation.json").write_text(json.dumps({"tool": "pinned-runtime-patchelf", "files": changed}, indent=2) + "\n")
    return len(changed)


def _verified_download(manager, record: dict, path: Path) -> None:
    expected, digest = record["sizeBytes"], record["sha256"]
    if path.is_file() and not path.is_symlink() and path.stat().st_size == expected:
        sha = hashlib.sha256()
        with path.open("rb") as source:
            while block := source.read(1024 * 1024):
                sha.update(block)
        if sha.hexdigest() == digest:
            manager._progress["downloadedBytes"] += expected
            return
    pending = path.with_name(path.name + ".part")
    for attempt in range(3):
        sha = hashlib.sha256()
        count = 0
        try:
            pending.unlink(missing_ok=True)
            with contextlib.closing(manager.downloader(record["url"])) as source, pending.open("xb") as output:
                while block := source.read(1024 * 1024):
                    count += len(block)
                    if count > expected:
                        raise RuntimeInstallError("A native runtime package exceeds its locked download size.")
                    output.write(block)
                    sha.update(block)
                output.flush()
                os.fsync(output.fileno())
            if count != expected or sha.hexdigest() != digest:
                raise RuntimeInstallError("A runtime package size or SHA-256 differs from the reviewed lock. Existing runtime was retained.")
            os.replace(pending, path)
            manager._progress["downloadedBytes"] += count
            return
        except (OSError, RuntimeInstallError):
            if attempt == 2:
                raise
        finally:
            pending.unlink(missing_ok=True)


def _extract_tool(archive: Path, release: Path) -> Path:
    tool = release / "micromamba"
    with tarfile.open(archive, "r:bz2") as package:
        members = [member for member in package if member.name == "bin/micromamba"]
        if len(members) != 1 or not members[0].isfile() or members[0].size > 64 * 1024**2 or members[0].mode & 0o6000:
            raise RuntimeInstallError("The verified native installer archive has an invalid executable.")
        with package.extractfile(members[0]) as source, tool.open("xb") as output:
            shutil.copyfileobj(source, output)
        tool.chmod(0o755)
    return tool


def _qualify(manager, release: Path, component: str, executables: dict, environment: dict) -> dict:
    prefix = release / "env"
    for value in executables.values():
        binary = (release / str(_relative(value))).resolve()
        if not binary.is_relative_to(prefix) or not binary.is_file() or not os.access(binary, os.X_OK):
            raise RuntimeInstallError("The locked runtime lacks a declared native executable.")
    python = release / executables["python"]
    bundled = Path(__file__).resolve().parents[2]
    manager.sandbox.read_roots += (bundled / "backend",)
    script = """import importlib,json,pathlib,sys,sysconfig
root=pathlib.Path(sys.argv[1]).resolve()
modules=[importlib.import_module(name) for name in json.loads(sys.argv[2])]
paths=[pathlib.Path(sys.prefix).resolve(),pathlib.Path(sys.base_prefix).resolve(),pathlib.Path(sysconfig.get_path('stdlib')).resolve()]
paths.extend(pathlib.Path(module.__file__).resolve() for module in modules if getattr(module,'__file__',None))
if not all(path.is_relative_to(root) for path in paths):raise RuntimeError('Scientific Python still depends on the build host')
application=pathlib.Path(sys.argv[3]).resolve()
sys.path.insert(0,str(application));sys.path.insert(0,str(application/'backend/compute'))
runners=['local_runner'] if sys.argv[4]=='dft' else ['backend.md_local.runner','backend.md_local.analysis_runner']
for name in runners:importlib.import_module(name)
print(json.dumps({'python':sys.version.split()[0],'imports':[m.__name__ for m in modules],'runnerImports':runners,'passed':True}))
"""
    command = manager.sandbox.command(release, [str(python), "-I", "-c", script, str(prefix), json.dumps(IMPORTS[component]), str(bundled), component])
    log = release / "qualification.log"
    with log.open("w", encoding="utf-8") as output:
        # Native libraries may emit diagnostics on stderr even after a valid
        # import. Retain those diagnostics without mixing them into the fixed
        # JSON acknowledgement on stdout.
        process = subprocess.run(command, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=output, text=True, timeout=120, check=False)
        output.write(process.stdout)
    if process.returncode:
        raise RuntimeInstallError("Scientific runtime import qualification failed. Inspect the retained qualification log; the previous runtime remains active.")
    try:
        result = json.loads(process.stdout)
        if result.get("passed") is not True:
            raise ValueError()
    except (ValueError, OSError) as error:
        raise RuntimeInstallError("Scientific runtime qualification did not produce a valid acknowledgement.") from error
    for name in ("lmp", "pw.x", "mpirun"):
        if name not in executables:
            continue
        arguments = [str(release / executables[name]), "--version" if name == "mpirun" else "-h"]
        command = manager.sandbox.command(release, arguments)
        with (release / f"{name}.check.log").open("w") as output:
            process = subprocess.run(command, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, timeout=45, check=False)
        # QE builds commonly ignore -h and read stdin instead. Its expected
        # empty-input error proves native/MPI startup only; this is never
        # presented as a successful scientific calculation.
        text = (release / f"{name}.check.log").read_text(errors="replace")
        expected_qe_empty_input = name == "pw.x" and "Program PWSCF v." in text and "could not find namelist &control" in text
        if process.returncode and not expected_qe_empty_input:
            raise RuntimeInstallError(f"The installed {name} executable failed its native startup check.")
    return result


def _repair_macos_signatures(manager, release: Path, environment: dict) -> int:
    """Conda prefix rewriting invalidates ad-hoc signatures on Apple Silicon.

    Re-sign only verified upstream Mach-O bytes after the trusted prefix rewrite,
    without a developer identity, network, elevated privileges or new libraries.
    The final runtime identity records its actual installed executable hashes.
    """
    if platform.system() != "Darwin":
        return 0
    tool = Path("/usr/bin/codesign")
    if not tool.is_file():
        raise RuntimeInstallError("macOS runtime relocation needs the system codesign tool for local ad-hoc signatures.")
    magics = {b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"}
    count = 0
    with (release / "local-signatures.log").open("w", encoding="utf-8") as log:
        for binary in sorted((release / "env").rglob("*")):
            if binary.is_symlink() or not binary.is_file():
                continue
            with binary.open("rb") as source:
                if source.read(4) not in magics:
                    continue
            check = manager.sandbox.command(release, [str(tool), "--verify", str(binary)])
            result = subprocess.run(check, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=30, check=False)
            if result.returncode:
                sign = manager.sandbox.command(release, [str(tool), "--force", "--sign", "-", "--timestamp=none", str(binary)])
                result = subprocess.run(sign, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=30, check=False)
                if result.returncode or subprocess.run(check, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=30, check=False).returncode:
                    raise RuntimeInstallError("macOS rejected a relocated runtime's local ad-hoc signature. The previous runtime remains active.")
                count += 1
    return count


def _regenerate_loader_cache(manager, release: Path, environment: dict) -> None:
    # This pinned package's original post-link script may run its helper before
    # macOS signatures are repaired and report a fallback warning. Regenerate
    # the exact documented loader cache after repair, before activation.
    binary = release / "env/bin/gdk-pixbuf-query-loaders"
    if not binary.is_file():
        return
    command = manager.sandbox.command(release, [str(binary), "--update-cache"])
    with (release / "loader-cache.log").open("w") as log:
        process = subprocess.run(command, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=60, check=False)
    if process.returncode:
        raise RuntimeInstallError("The scientific runtime's image-loader cache could not be initialized after relocation. The previous runtime remains active.")


def install_locked_runtime(manager, component: str, target: str, entry: dict) -> dict:
    version, packages, tool = entry.get("version"), entry.get("packages"), entry.get("installer")
    executables = entry.get("executables")
    wheels = entry.get("wheels", [])
    _check_host(entry, target)
    if not isinstance(wheels, list) or len(wheels) > 100:
        raise RuntimeInstallError("The runtime lock has an invalid wheel overlay.")
    if wheels and (target != "linux-arm64" or entry.get("minimumGlibc") != "2.39"):
        raise RuntimeInstallError("Wheel overlays require the declared Linux ARM64 glibc 2.39 baseline.")
    for wheel in wheels:
        _wheel_record(wheel, target)
    wheel_names = [re.sub(r"[-_.]+", "-", item["name"]).lower() for item in wheels]
    if len(wheel_names) != len(set(wheel_names)):
        raise RuntimeInstallError("The reviewed runtime contains duplicate wheel identities.")
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", version):
        raise RuntimeInstallError("Conda runtime locks require an immutable version.")
    if not isinstance(packages, list) or not 1 <= len(packages) <= 1000 or not isinstance(executables, dict) or not REQUIRED[component].issubset(executables):
        raise RuntimeInstallError("The runtime lock lacks required scientific packages or executable declarations.")
    for name, value in executables.items():
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", name) or not str(_relative(value)).startswith("env/bin/"):
            raise RuntimeInstallError("Runtime executable declarations must stay inside the immutable environment.")
    records = [tool, *packages]
    for index, record in enumerate(records):
        _download_record(record, target, tool=index == 0)
    urls = [item["url"] for item in packages]
    for item in packages:
        if any(not isinstance(item.get(key), str) or not item[key] or len(item[key]) > 200 for key in ("name", "version", "build", "license")):
            raise RuntimeInstallError("Locked scientific packages must identify exact builds and licenses.")
    if len(urls) != len(set(urls)):
        raise RuntimeInstallError("The reviewed conda runtime lock contains duplicate packages.")
    if wheels and (not any(item["name"] == "python" and item["version"].startswith("3.12.") for item in packages) or not any(item["name"] == "pip" for item in packages) or not any(item["name"] == "patchelf" for item in packages)):
        raise RuntimeInstallError("Reviewed wheels require pinned CPython 3.12, pip and patchelf in the conda lock.")
    if set(wheel_names) & {re.sub(r"[-_.]+", "-", item["name"]).lower() for item in packages}:
        raise RuntimeInstallError("Wheel overlays may not replace a conda package identity.")
    records.extend(wheels)
    total = sum(item["sizeBytes"] for item in records)
    maximum = entry.get("maxInstalledBytes")
    if type(maximum) is not int or not total <= maximum <= 16 * 1024**3:
        raise RuntimeInstallError("The runtime lock needs a bounded installation size.")
    if shutil.disk_usage(manager.root).free < maximum + total * 2 + 64 * 1024**2:
        raise RuntimeInstallError("Not enough free disk space to install the locked runtime safely.")
    if manager.sandbox.probe().get("available") is not True:
        raise RuntimeInstallError("Native runtime installation requires a verified OS sandbox. Install bubblewrap/user namespaces on Linux/WSL2 or repair sandbox-exec on macOS.")
    lock_digest = hashlib.sha256(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    release_name = f"{component}-{target}-{version}-{lock_digest[:16]}"
    release = manager.root / release_name
    state = release / "installation-state.json"
    if release.exists():
        if release.is_symlink() or not release.resolve().is_relative_to(manager.root):
            raise RuntimeInstallError("The inactive runtime prefix is unsafe.")
        active = manager._active()
        if component in active and active[component].get("directory") == release_name:
            manager.environment()  # Validate declared executable paths again.
            return {"component": component, "installed": active[component]}
        if any(isinstance(record, dict) and record.get("directory") == release_name for record in active.values()):
            raise RuntimeInstallError("The immutable prefix is used by another active component and cannot be retried in place.")
        try:
            if json.loads(state.read_text()).get("lockSha256") != lock_digest:
                raise ValueError()
        except (ValueError, OSError) as error:
            raise RuntimeInstallError("An unrecognized immutable runtime prefix already exists. Inspect it before retrying.") from error
        # Retry only files belonging to this exact inactive lock. Keep verified
        # downloads and logs; relink at the same final prefix after interruption.
        for name in ("env", ".mamba", "notices"):
            shutil.rmtree(release / name, ignore_errors=True)
        for name in ("installation.log", "wheel-installation.log", "qualification.log"):
            log = release / name
            if log.is_file():
                os.replace(log, release / (name + ".previous"))
        (release / "micromamba").unlink(missing_ok=True)
    else:
        release.mkdir(mode=0o700)
        state.write_text(json.dumps({"lockSha256": lock_digest, "component": component, "platform": target}))
    cache = release / ".downloads"
    cache.mkdir(exist_ok=True)
    manager._progress = {"state": "downloading", "component": component, "downloadedBytes": 0, "totalBytes": total, "packages": len(packages) + len(wheels)}
    try:
        filenames = [unquote(urlsplit(record["url"]).path.rsplit("/", 1)[1]) for record in records]
        if any(len(_relative(name).parts) != 1 for name in filenames):
            raise RuntimeInstallError("A runtime package filename contains an encoded unsafe path.")
        destinations = [cache / name for name in filenames]
        if len(destinations) != len(set(destinations)):
            raise RuntimeInstallError("The lock contains ambiguous package filenames.")
        with ThreadPoolExecutor(max_workers=6) as downloads:
            futures = [downloads.submit(_verified_download, manager, record, path) for record, path in zip(records, destinations)]
            for future in futures:
                future.result()
        for record, path in zip(wheels, destinations[1 + len(packages):]):
            _validate_wheel_archive(record, path, maximum)
        binary = _extract_tool(destinations[0], release)
        explicit = release / "explicit-lock.txt"
        # libmamba's explicit-package parser expects epoch `!` in a filename
        # before URL unescaping; encode other path characters normally.
        explicit.write_text("@EXPLICIT\n" + "\n".join(path.as_uri().replace("%21", "!") for path in destinations[1:1 + len(packages)]) + "\n", encoding="utf-8")
        environment = {"PATH": str(release / "env/bin") + os.pathsep + os.defpath, "HOME": str(release / ".home"), "TMPDIR": str(release / ".tmp"), "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "QT_QPA_PLATFORM": "offscreen", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1", "MPLCONFIGDIR": str(release / ".home/matplotlib")}
        loopback = "lo0" if platform.system() == "Darwin" else "lo"
        environment.update(OMPI_MCA_btl="self,tcp", OMPI_MCA_btl_tcp_if_include=loopback)
        Path(environment["HOME"]).mkdir(exist_ok=True)
        manager._progress["state"] = "installing"
        command = [str(binary), "create", "--offline", "--no-rc", "--no-env", "--json", "--yes", "--no-pyc", "--always-copy", "--no-deps", "--root-prefix", str(release / ".mamba"), "--prefix", str(release / "env"), "--file", str(explicit)]
        command = manager.sandbox.command(release, command)
        with (release / "installation.log").open("w", encoding="utf-8") as output:
            process = subprocess.run(command, cwd=release, env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, timeout=900, check=False)
        if process.returncode:
            raise RuntimeInstallError("Offline installation of the reviewed runtime failed. Inspect the retained installation log; the previous runtime remains active.")
        manager._progress["state"] = "verifying"
        installed = list((release / "env/conda-meta").glob("*.json"))
        expected = {(item["name"], item["version"], item["build"]) for item in packages}
        actual = set()
        for metadata in installed:
            item = json.loads(metadata.read_text())
            actual.add((item.get("name"), item.get("version"), item.get("build")))
        if actual != expected:
            raise RuntimeInstallError("The installed package inventory differs from the explicit reviewed lock.")
        wheel_inventory = _install_wheels(manager, release, wheels, environment)
        relocated_wheels = _repair_linux_wheel_libraries(manager, release, wheel_inventory, environment)
        size = 0
        for path in (release / "env").rglob("*"):
            if path.is_symlink() and not path.resolve().is_relative_to(release / "env"):
                raise RuntimeInstallError("A scientific runtime symlink escapes its immutable prefix.")
            if path.suffix.lower() == ".upf":
                raise RuntimeInstallError("Pseudopotentials must be installed separately with their own provenance and redistribution terms.")
            if path.is_file():
                size += path.stat().st_size
                if size > maximum:
                    raise RuntimeInstallError(
                        "The scientific environment exceeds its reviewed installation-size budget "
                        f"({size} bytes installed; {maximum} bytes allowed)."
                    )
        signatures = _repair_macos_signatures(manager, release, environment)
        _regenerate_loader_cache(manager, release, environment)
        qualification = _qualify(manager, release, component, executables, environment)
        qualification["locallyRepairedAdhocSignatures"] = signatures
        qualification["locallyRelocatedWheelLibraries"] = relocated_wheels
        # Installed conda-meta retains exact package provenance. Preserve the
        # reviewed upstream lock and conda package licenses/source references.
        (release / "runtime-lock.json").write_text(json.dumps(entry, sort_keys=True, indent=2))
        notices = release / "THIRD_PARTY_NOTICES.json"
        notices.write_text(json.dumps({"channel": "conda-forge", "packages": [{key: item.get(key) for key in ("name", "version", "build", "license", "url", "sha256")} for item in packages], "sourceAndLicenseMetadata": "env/conda-meta and each installed package's license files; upstream recipes at https://github.com/conda-forge", "installer": tool, "wheels": wheels, "wheelMetadata": "notices/wheels and env/lib/python3.12/site-packages/*.dist-info"}, indent=2))
        license_root = release / "notices/conda-packages"
        for package in (release / ".mamba/pkgs").iterdir():
            metadata = package / "info"
            if package.is_dir() and metadata.is_dir():
                # info contains exact licenses, source/recipe URLs and build
                # provenance that conda does not always link into the prefix.
                shutil.copytree(metadata, license_root / package.name, symlinks=False)
        # Keep prefix files and all installed license notices; caches and tool
        # are installation-only and must not become execution dependencies.
        shutil.rmtree(cache)
        shutil.rmtree(release / ".mamba", ignore_errors=True)
        binary.unlink()
        record = {"version": version, "platform": target, "sha256": lock_digest, "directory": release_name, "executables": executables, "notices": [notices.name], "format": "conda-lock", "packages": len(packages), "qualification": qualification, "wheels": wheel_inventory}
        if wheel_inventory:
            record["wheelLibraryRelocation"] = {"path": "wheel-library-relocation.json", "files": relocated_wheels}
        inventory = manager._active()
        inventory[component] = record
        pending = release / ".active.pending.json"
        with pending.open("x", encoding="utf-8") as output:
            json.dump(inventory, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(pending, manager.root / "active.json")
        descriptor = os.open(manager.root, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        manager._progress["state"] = "complete"
        return {"component": component, "installed": record}
    except Exception:
        # Keep diagnostics and reviewed bytes for an explicit recovery/retry.
        # Never activate or erase a previously installed runtime on failure.
        manager._progress["inactiveDirectory"] = release_name
        raise
