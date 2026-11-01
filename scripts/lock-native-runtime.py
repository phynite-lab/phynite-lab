#!/usr/bin/env python3
"""Add exact successful micromamba dry-run output to the reviewed catalogue.

Run this during runtime maintenance, never on a user's install path. It does not
solve dependencies, download software, qualify platforms, or publish anything.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

TARGETS = {"darwin-arm64": "osx-arm64", "darwin-x64": "osx-64", "linux-arm64": "linux-aarch64", "linux-x64": "linux-64"}
EXECUTABLES = {"dft": ["python", "pw.x", "bands.x", "dos.x", "projwfc.x", "ph.x", "q2r.x", "matdyn.x", "mpirun"], "md": ["python", "lmp", "mpirun"], "analysis": ["python"]}
DEFAULT_MAX_INSTALLED_BYTES = 4 * 1024**3
LINUX_MD_MAX_INSTALLED_BYTES = 8 * 1024**3


def entry_from_solve(solve: dict, component: str, target: str, version: str, installer: dict, wheels: list[dict] | None = None) -> dict:
    if component not in EXECUTABLES or target not in TARGETS or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", version):
        raise ValueError("Declare an exact component, platform, and immutable version.")
    if solve.get("success") is not True or solve.get("dry_run") is not True:
        raise ValueError("Only successful dry-run solves can become reviewed package locks.")
    records = solve.get("actions", {}).get("LINK", [])
    if not records:
        raise ValueError("The solve did not contain a complete LINK inventory.")
    packages = []
    for package in records:
        url = urlsplit(package.get("url", ""))
        forge = url.netloc == "conda.anaconda.org" and any(url.path.startswith(f"/conda-forge/{subdir}/") for subdir in (TARGETS[target], "noarch"))
        ovito = url.netloc == "conda.ovito.org" and any(url.path.startswith(f"/{subdir}/") for subdir in (TARGETS[target], "noarch")) and package.get("name") in {"ovito", "anari_ovito", "ospray_ovito", "visrtx_ovito"}
        if url.scheme != "https" or url.query or url.fragment or not (forge or ovito):
            raise ValueError("Use exact conda-forge or official OVITO URLs for the selected target only.")
        if not re.fullmatch(r"[a-f0-9]{64}", package.get("sha256", "")) or type(package.get("size")) is not int or not package.get("license"):
            raise ValueError("All locked packages need exact SHA-256, size, and license metadata.")
        packages.append({"name": package["name"], "version": package["version"], "build": package["build_string"], "license": package["license"], "url": package["url"], "sha256": package["sha256"], "sizeBytes": package["size"]})
    # Linux MD/OVITO includes a substantially larger Qt/graphics stack than
    # the DFT lock. Keep that reviewed budget target-specific instead of
    # letting the installer fail after it has already linked the environment.
    budget = LINUX_MD_MAX_INSTALLED_BYTES if component == "md" and target.startswith("linux-") else DEFAULT_MAX_INSTALLED_BYTES
    entry = {"format": "conda-lock", "version": version, "qualificationStatus": "not-tested-on-target", "installer": installer, "packages": packages, "maxInstalledBytes": budget, "executables": {name: f"env/bin/{name}" for name in EXECUTABLES[component]}}
    if target.startswith("linux-"):
        entry["minimumGlibc"] = "2.39"
    if wheels:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from backend.local_api.conda_runtime import _wheel_record
        for wheel in wheels:
            _wheel_record(wheel, target)
        entry["wheels"] = wheels
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--solve", type=Path, required=True)
    parser.add_argument("--installer", type=Path, required=True, help="JSON record with pinned native micromamba URL, SHA-256, sizeBytes, version and license")
    parser.add_argument("--component", choices=EXECUTABLES, required=True)
    parser.add_argument("--platform", choices=TARGETS, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--wheels", type=Path, help="Reviewed JSON list of exact official wheel records; Linux ARM64 CPython 3.12 only")
    parser.add_argument("--catalogue", type=Path, default=Path("backend/local_api/runtime-manifest.json"))
    args = parser.parse_args()
    entry = entry_from_solve(json.loads(args.solve.read_text()), args.component, args.platform, args.version, json.loads(args.installer.read_text()), json.loads(args.wheels.read_text()) if args.wheels else None)
    catalogue = json.loads(args.catalogue.read_text()) if args.catalogue.is_file() else {"schemaVersion": 1, "components": {}}
    if catalogue.get("schemaVersion") != 1:
        parser.error("Unsupported catalogue version")
    component = catalogue["components"].setdefault(args.component, {})
    if args.platform in component:
        parser.error("This catalogue target already exists. Review a new catalogue version explicitly before replacing it.")
    component[args.platform] = entry
    args.catalogue.write_text(json.dumps(catalogue, indent=2) + "\n")
    print(f"Prepared {args.component}/{args.platform}: {len(entry['packages'])} exact packages; target qualification still required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
