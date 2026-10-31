"""Immutable SCF transfer with independently verified evidence and solver state."""
from __future__ import annotations

import hashlib
import json
import platform
import re
import shutil
import tarfile
from pathlib import Path
from typing import Any

from qe_model import qe_runtime_identity, scf_input_identity


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()


def runtime_identity(pseudo: Path, vcpus: int) -> dict[str, Any]:
    runtime = qe_runtime_identity(pseudo)
    return {"architecture": platform.machine(), "system": platform.system(), "vcpus": vcpus,
            "pseudopotentials": runtime["pseudopotentials"], "solverExecutables": runtime["solverExecutables"],
            "software": runtime["software"], "parallelMode": __import__('os').environ.get('PHYNITE_QE_PARALLEL_MODE', 'auto')}


def create_bundle(work: Path, output: Path, pseudo: Path, calculation_id: str, vcpus: int) -> dict[str, Any]:
    from results import parse_qe_output
    from qe_model import qe_stage_error
    scf_input, log, xml = (output / name for name in ('inputs/scf.in', 'logs/scf.out', 'evidence/scf.xml'))
    if not all(path.is_file() for path in (scf_input, log, xml)):
        raise RuntimeError('Reusable SCF needs its executed input, log and stage XML.')
    stage = {"stage": "scf", "calculationMode": "scf", **parse_qe_output(log.read_text(), 'scf', input_text=scf_input.read_text(), xml_path=xml)}
    failure = qe_stage_error(stage)
    if failure:
        raise RuntimeError(f'SCF cannot be shared: {failure}')
    runtime = runtime_identity(pseudo, vcpus)
    if not runtime['pseudopotentials'] or not any(item['name'] == 'pw.x' for item in runtime['solverExecutables']):
        raise RuntimeError('Reusable SCF requires exact solver and pseudopotential fingerprints.')
    scratch = work / 'tmp'
    charge = list(scratch.glob('*.save/charge-density.*'))
    if len(charge) != 1:
        raise RuntimeError('Reusable SCF requires one saved charge density.')
    source = output / '.scf-source'
    if source.exists():
        shutil.rmtree(source)
    source.mkdir()
    try:
        shutil.copytree(scratch, source / 'tmp')
        for name in ('inputs/scf.in', 'logs/scf.out', 'evidence/scf.xml'):
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(output / name, target)
        files = [{"path": p.relative_to(source).as_posix(), "sha256": digest(p), "sizeBytes": p.stat().st_size} for p in sorted(source.rglob('*')) if p.is_file()]
        manifest = {"version": 1, "calculationId": calculation_id, "scfInputIdentity": scf_input_identity(scf_input.read_text()),
                    "runtime": runtime, "files": files, "wavefunctionsIncluded": any(re.search(r'(?:wfc|evc)', item['path'], re.I) for item in files)}
        (source / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True))
        archive = output / 'scf-workspace.tar.gz'
        with tarfile.open(archive, 'w:gz') as target:
            target.add(source, arcname='scf-source')
        return {"version": 1, "calculationId": calculation_id, "scfInputIdentity": manifest['scfInputIdentity'],
                "path": archive.name, "sha256": digest(archive), "sizeBytes": archive.stat().st_size,
                "wavefunctionsIncluded": manifest['wavefunctionsIncluded'], "runtime": runtime}
    finally:
        shutil.rmtree(source, ignore_errors=True)


def restore_bundle(work: Path, output: Path, pseudo: Path, input_files: dict[str, str], source: dict[str, Any], vcpus: int, calculation_type: str) -> dict[str, Any]:
    root = work / 'scf-source'
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest.get('version') != 1 or manifest.get('calculationId') != source.get('calculationId'):
        raise RuntimeError('SCF bundle belongs to a different source calculation.')
    expected = scf_input_identity(input_files['scf.in'])
    if manifest.get('scfInputIdentity') != expected or source.get('scfInputIdentity') != expected:
        raise RuntimeError('SCF input differs from the selected source. Run a new SCF.')
    if manifest.get('runtime') != runtime_identity(pseudo, vcpus):
        raise RuntimeError('SCF solver, parallel layout or pseudopotentials differ. Use the source runtime or run a new SCF.')
    if calculation_type == 'Phonon dispersion' and not manifest.get('wavefunctionsIncluded'):
        raise RuntimeError('This SCF has no retained wavefunctions for phonons. Run a new SCF with disk_io=low.')
    files = manifest.get('files')
    if not isinstance(files, list) or not files:
        raise RuntimeError('SCF bundle has no checksum inventory.')
    names = set()
    for entry in files:
        name = Path(entry['path']); path = root / name
        if name.is_absolute() or '..' in name.parts or path.is_symlink() or not path.is_file() or path.stat().st_size != entry['sizeBytes'] or digest(path) != entry['sha256']:
            raise RuntimeError('SCF bundle checksum verification failed.')
        names.add(name.as_posix())
    if any(p.is_symlink() for p in root.rglob('*')) or names != {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name != 'manifest.json'}:
        raise RuntimeError('SCF bundle contains unverified files.')
    for required in ('inputs/scf.in', 'logs/scf.out', 'evidence/scf.xml'):
        if required not in names:
            raise RuntimeError('SCF bundle convergence evidence is incomplete.')
    retained = (root / 'inputs/scf.in').read_text()
    if scf_input_identity(retained) != expected:
        raise RuntimeError('SCF retained input identity is invalid.')
    from qe_model import qe_stage_error, qe_string_value
    from results import parse_qe_output
    stage = {"stage": "scf", "calculationMode": "scf", **parse_qe_output((root / 'logs/scf.out').read_text(), 'scf', input_text=retained, xml_path=root / 'evidence/scf.xml')}
    failure = qe_stage_error(stage)
    if failure:
        raise RuntimeError(f'Reused SCF convergence rejected: {failure}')
    # Keep the saved prefix rather than rewriting binary/XML solver state.
    prefix = qe_string_value(retained, 'CONTROL', 'prefix', 'pwscf')
    if not prefix or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', prefix):
        raise RuntimeError('SCF prefix is unsafe.')
    for filename, text in tuple(input_files.items()):
        input_files[filename] = re.sub(r"\bprefix\s*=\s*['\"][^'\"]*['\"]", f"prefix = '{prefix}'", text, flags=re.I)
    input_files['scf.in'] = retained
    scratch = work / 'tmp'
    if scratch.exists():
        shutil.rmtree(scratch)
    shutil.copytree(root / 'tmp', scratch)
    for name in ('inputs/scf.in', 'logs/scf.out', 'evidence/scf.xml'):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target)
    return {"calculationId": source['calculationId'], "scfInputIdentity": expected, "bundleSha256": source['sha256'], "status": "reused"}
