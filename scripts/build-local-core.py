"""Freeze the public local control plane using its reviewed explicit source graph."""
from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path, PurePosixPath
import subprocess
import sys


def source_manifest(root: Path) -> dict:
    """Reject private or traversal paths before invoking an executable builder."""
    document = json.loads((root / "backend/local_api/public-core.json").read_text())
    if document.get("schemaVersion") != 1:
        raise ValueError("Unsupported local core source manifest")
    for field in ("pythonModules", "dataFiles", "generatedDataFiles", "frozenModules", "runnerSources", "portableTests"):
        values = document.get(field)
        if not isinstance(values, list) or len(values) != len(set(values)):
            raise ValueError(f"Invalid explicit source list: {field}")
        for value in values:
            path = PurePosixPath(value)
            if not isinstance(value, str) or path.is_absolute() or ".." in path.parts or not value.startswith("backend/") or value.startswith(("backend/functions/", "backend/md_compute/")) or value in {"backend/local_api/server.py", "backend/local_api/launcher.py", "backend/compute/runner.py"}:
                raise ValueError(f"A non-public source is forbidden in {field}: {value}")
    for field in ("frozenModules", "runnerSources"):
        if not set(document[field]) <= set(document["pythonModules"]):
            raise ValueError(f"{field} must be contained in pythonModules")
    return document


def build_command(root: Path, output: Path, target: str, manifest: dict) -> list[str]:
    command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--name", "phynite-core",
               "--distpath", str(output / target), "--workpath", str(output / "work" / target),
               "--specpath", str(output / "spec" / target), "--paths", str(root),
               "--paths", str(root / "backend/local_worker"), "--paths", str(root / "backend/compute")]
    for name in manifest["hiddenImports"]:
        command.extend(["--hidden-import", name])
    for source in manifest["frozenModules"]:
        module = source.removesuffix(".py").replace("/", ".").removesuffix(".__init__")
        command.extend(["--hidden-import", module])
    # Solver libraries are installed separately. Original reviewed runner source
    # is passed to that runtime's Python instead of freezing its libraries here.
    for name in manifest["excludedModules"]:
        command.extend(["--exclude-module", name])
    for source in manifest["runnerSources"] + manifest["dataFiles"] + manifest["generatedDataFiles"]:
        path = root / source
        command.extend(["--add-data", f"{path}:{path.parent.relative_to(root).as_posix()}"])
    command.append(str(root / "backend/local_api/desktop_server.py"))
    return command


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=root / "build/local-core")
    parser.add_argument("--check-sources", action="store_true", help="Validate public source paths without building or requiring generated compiler data")
    args = parser.parse_args()
    try:
        manifest = source_manifest(root)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    required = manifest["pythonModules"] + manifest["dataFiles"]
    if not args.check_sources:
        required += manifest["generatedDataFiles"]
    for name in required:
        if not (root / name).is_file():
            parser.error(f"Missing reviewed local source {name}. Generate the local scientific compiler with npm run prepare:workflow -- --local before building.")
    if args.check_sources:
        print(f"Validated {len(manifest['pythonModules'])} public Python sources; no hosted source is in the build graph.")
        return
    operating_system = {"Darwin": "darwin", "Linux": "linux"}.get(platform.system())
    architecture = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
    if not operating_system or not architecture:
        parser.error("Build on macOS or Linux arm64/x64. Windows is supported through WSL2.")
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        parser.error("Install the pinned core build requirements in an isolated build environment first.")
    target = f"{operating_system}-{architecture}"
    output = args.output.resolve()
    subprocess.run(build_command(root, output, target, manifest), cwd=root, check=True)
    notices = output / target / "THIRD_PARTY_NOTICES.md"
    subprocess.run([sys.executable, str(root / "scripts/local-core-notices.py"), "--output", str(notices),
                    "--executable", str(output / target / "phynite-core"),
                    "--pkg-toc", str(output / "work" / target / "phynite-core" / "PKG-00.toc")], cwd=root, check=True)
    print(f"Built {output / target / 'phynite-core'}. Dependency notices: {notices}. Review corresponding-source obligations before distribution.")


if __name__ == "__main__":
    main()
