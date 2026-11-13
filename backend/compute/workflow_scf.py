"""Checksummed SCF state snapshots; consumers copy into private scratch space."""
from __future__ import annotations
import hashlib
import json
import platform
import re
import shutil
import tarfile
from pathlib import Path
from typing import Any
from qe_model import qe_runtime_identity, qe_stage_error, strip_qe_comments


def file_sha(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def stage_remote_scf_archive(work: Path, reference: dict[str, Any]) -> None:
    """Extract an exact remote copy into fresh private state without shell tar."""
    archive = work / "dependency-0.tar.gz"
    if archive.is_symlink() or file_sha(archive) != reference.get("bundleSha256"):
        raise ValueError("Retained SCF archive checksum verification failed.")
    destination = work / "dependencies/scf"
    if destination.exists() or destination.is_symlink() or destination.parent.is_symlink():
        raise ValueError("Retained SCF state requires a fresh dependency directory.")
    with tarfile.open(archive, "r:gz") as bundle:
        members = []
        names: set[str] = set()
        size = 0
        for member in bundle:
            path = Path(member.name)
            if (not member.isfile() or path.is_absolute() or ".." in path.parts
                    or str(path) != member.name or member.name in names
                    or not (member.name == "scf-state.json" or path.parts[0] in {"tmp", "evidence"})):
                raise ValueError("Retained SCF archive contains an unsafe member.")
            size += member.size
            if size > 2 * 1024**3 or len(members) >= 100_000:
                raise ValueError("Retained SCF archive exceeds extraction limits.")
            names.add(member.name)
            members.append(member)
        if "scf-state.json" not in names:
            raise ValueError("Retained SCF archive is missing its manifest.")
        destination.mkdir(parents=True, mode=0o700)
        for member in members:
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with bundle.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)


def runtime_identity(pseudo: Path) -> dict[str, Any]:
    identity = qe_runtime_identity(pseudo)
    return {"architecture": platform.machine(), "system": platform.system(), "pseudopotentials": identity["pseudopotentials"], "pw": next((item for item in identity["solverExecutables"] if item["name"] == "pw.x"), None)}


def model_signature(text: str) -> dict[str, Any]:
    text = strip_qe_comments(text)
    system = re.search(r"(?ims)&SYSTEM\b(.*?)^\s*/", text)
    if not system:
        raise ValueError("Shared SCF requires an explicit SYSTEM namelist.")
    assignments = re.findall(r"([A-Za-z_][A-Za-z_0-9]*(?:\s*\([^)]*\))?)\s*=\s*('[^']*'|\"[^\"]*\"|[^,\n/]+)", system.group(1))
    ignored = {"nbnd", "occupations", "smearing", "degauss"}
    settings = {re.sub(r"\s+", "", key.lower()): value.strip().lower() for key, value in assignments if key.lower().strip() not in ignored}
    cards = re.split(r"(?im)^(ATOMIC_SPECIES|ATOMIC_POSITIONS|CELL_PARAMETERS|K_POINTS|HUBBARD)\b", text)
    structural = {cards[index].upper(): re.sub(r"\s+", " ", cards[index + 1].strip()) for index in range(1, len(cards) - 1, 2) if cards[index].upper() != "K_POINTS"}
    return {"system": settings, "structure": structural}


def runtime_fingerprint(pseudo: Path) -> str:
    return hashlib.sha256(json.dumps(runtime_identity(pseudo), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def attach_scf_bundle(scientific: dict[str, Any], calculation_id: str, scratch: Path, output: Path, pseudo: Path) -> None:
    stages = scientific.get("summary", {}).get("stageConvergence", [])
    stage = next((item for item in stages if item.get("stage") == "scf"), None)
    if stage is None or qe_stage_error(stage):
        return
    required = [output / "inputs/scf.in", output / "logs/scf.out", output / "evidence/scf.xml"]
    saves = list(scratch.glob("*.save"))
    if any(not path.is_file() for path in required) or len(saves) != 1 or not (saves[0] / "charge-density.dat").is_file():
        return
    files = [path for path in scratch.rglob("*") if path.is_file()]
    if any(path.is_symlink() for path in scratch.rglob("*")):
        raise ValueError("SCF state contains a symbolic link and cannot be reused.")
    # Full state includes distributed wavefunctions when produced. The same
    # runtime/binary/architecture is required for native QE binary portability.
    manifest = {"version": 1, "calculationId": calculation_id, "runtimeFingerprint": runtime_fingerprint(pseudo), "inputSha256": file_sha(required[0]), "stage": stage,
                "files": {"tmp/" + str(path.relative_to(scratch)): file_sha(path) for path in files}}
    for path in required:
        manifest["files"]["evidence/" + path.name] = file_sha(path)
    manifest_path = output / "scf-state.json"
    manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    archive_path = output / "scf-state.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(manifest_path, arcname="scf-state.json")
        for path in files:
            archive.add(path, arcname="tmp/" + str(path.relative_to(scratch)), recursive=False)
        for path in required:
            archive.add(path, arcname="evidence/" + path.name, recursive=False)
    bundle = {"version": 1, "path": archive_path.name, "calculationId": calculation_id, "sha256": file_sha(archive_path), "sizeBytes": archive_path.stat().st_size, "inputSha256": manifest["inputSha256"], "runtimeFingerprint": manifest["runtimeFingerprint"]}
    scientific["provenance"]["scfBundle"] = bundle
    scientific["artifacts"].append({"path": archive_path.name, "label": "Immutable SCF state", "role": "workspace", "contentType": "application/gzip", "sha256": bundle["sha256"], "sizeBytes": bundle["sizeBytes"]})


def prepare_shared_scf(work: Path, scratch: Path, output: Path, pseudo: Path, settings: dict[str, Any], inputs: dict[str, str]) -> dict[str, Any] | None:
    if "_inheritedScfStage" in settings:
        raise ValueError("Inherited convergence evidence can only be loaded from a verified SCF bundle.")
    reference = settings.get("sharedScf")
    if reference is None:
        return None
    source = work / "dependencies/scf"
    manifest = json.loads((source / "scf-state.json").read_text())
    if manifest.get("version") != 1 or manifest["inputSha256"] != reference["inputSha256"] or manifest["calculationId"] != reference["calculationId"] or manifest["runtimeFingerprint"] != reference["runtimeFingerprint"] or runtime_fingerprint(pseudo) != manifest["runtimeFingerprint"]:
        raise ValueError("SCF runtime, pseudopotentials, or source identity differ. Run SCF on this runtime.")
    if hashlib.sha256(inputs.get("scf.in", "").encode()).hexdigest() != manifest["inputSha256"]:
        raise ValueError("SCF input differs from its immutable source.")
    signature = model_signature(inputs["scf.in"])
    for filename, text in inputs.items():
        if filename != "scf.in" and re.search(r"(?im)^\s*ATOMIC_POSITIONS\b", text) and model_signature(text) != signature:
            raise ValueError(f"{filename} changes the shared SCF structure or Hamiltonian. Create a new SCF variant.")
    if qe_stage_error(manifest["stage"]):
        raise ValueError("Inherited SCF convergence evidence is invalid.")
    for name, sha in manifest["files"].items():
        path = source / name
        if path.is_symlink() or source.resolve() not in path.resolve().parents or not path.is_file() or file_sha(path) != sha:
            raise ValueError("SCF bundle file failed checksum verification.")
    if any(scratch.iterdir()):
        raise ValueError("Shared SCF requires a fresh private scratch directory.")
    shutil.copytree(source / "tmp", scratch, dirs_exist_ok=True)
    destination = output / "inherited" / reference["calculationId"]
    shutil.copytree(source / "evidence", destination, dirs_exist_ok=True)
    stage = {**manifest["stage"], "execution": "inherited", "sourceCalculationId": reference["calculationId"], "sourceBundleSha256": reference["bundleSha256"], "log": f"inherited/{reference['calculationId']}/scf.out", "inputFile": f"inherited/{reference['calculationId']}/scf.in"}
    settings["_inheritedScfStage"] = stage
    return stage
