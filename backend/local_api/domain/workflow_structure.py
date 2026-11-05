"""Owner-checked conversion of immutable structure outputs into MD inputs."""
from __future__ import annotations
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
from typing import Any
from backend.local_api.domain.phynite_core import ApiError, owner_partition, require_owner_item, storage_owner, utc_now
from backend.local_api.domain.dft_validation import dependency_dft_error, read_dft_manifest
from backend.local_api.domain.elements import ELEMENT_SYMBOLS


def resolve_qe_element(label: str, species_map: dict[str, str] | None = None) -> str:
    """Resolve a Quantum ESPRESSO atomic label/species to its standard periodic element symbol."""
    if species_map and label in species_map and species_map[label] in ELEMENT_SYMBOLS:
        return species_map[label]
    if label in ELEMENT_SYMBOLS:
        return label
    if len(label) >= 2 and label[0].isupper() and label[1].islower() and label[:2] in ELEMENT_SYMBOLS:
        return label[:2]
    if len(label) >= 1 and label[0].isupper() and label[:1] in ELEMENT_SYMBOLS:
        return label[:1]
    return label


def source_structure(api: Any, owner: str, project: str, attempt: dict[str, Any]) -> dict[str, Any]:
    if attempt.get('jobKind') == 'CALCULATION':
        job = require_owner_item(api.services, owner, 'CALCULATION', attempt['jobId'], 'CALCULATION_NOT_FOUND')
        if job.get('projectId') != project or job.get('calculationType') not in {'Structural relaxation', 'Total energy'} or dependency_dft_error(api.services, job):
            raise ApiError(409, 'A verified relaxation in this project is required.', 'WORKFLOW_STRUCTURE_INVALID')
        manifest = read_dft_manifest(api.services, job)
        stage = 'relax' if job['calculationType'] == 'Structural relaxation' else 'scf'
        artifact = next((item for item in manifest['artifacts'] if item['path'] == f'evidence/{stage}.xml'), None)
        if artifact is None:
            raise ApiError(409, 'Retained relaxation XML is unavailable.', 'WORKFLOW_STRUCTURE_INVALID')
        raw = api.services.s3.get_object(Bucket=api.services.bucket, Key=f"{job['outputPrefix']}/{artifact['path']}")['Body'].read(16_000_001)
        if len(raw) > 16_000_000 or hashlib.sha256(raw).hexdigest() != artifact['sha256']:
            raise ApiError(409, 'Relaxation XML checksum failed.', 'WORKFLOW_STRUCTURE_INVALID')
        root = ET.fromstring(raw)
        for element in root.iter():
            element.tag = element.tag.rsplit('}', 1)[-1]
        geometry = root.find('./output/atomic_structure')
        if geometry is None:
            raise ApiError(409, 'Final relaxation geometry is missing.', 'WORKFLOW_STRUCTURE_INVALID')
        factor = 0.529177210903  # QE schema atomic_structure is in bohr.
        vectors = [[float(number) * factor for number in row.text.split()] for row in geometry.find('cell')]
        particles = list(geometry.find('atomic_positions'))

        species_map: dict[str, str] = {}
        parent_periodic: list[bool] | None = None
        parent_labels: list[str | None] = []
        if job.get('structureId'):
            try:
                parent_item = api.services.get_item(owner, 'STRUCTURE', job['structureId'])
                if parent_item and parent_item.get('objectKey'):
                    raw_parent = api.services.s3.get_object(Bucket=api.services.bucket, Key=parent_item['objectKey'])['Body'].read(5_000_001)
                    parent_data = json.loads(raw_parent)
                    for a in parent_data.get('atoms', []):
                        sp = a.get('species')
                        lb = a.get('label') or sp
                        parent_labels.append(a.get('label'))
                        if lb and sp and sp in ELEMENT_SYMBOLS:
                            species_map[str(lb)] = str(sp)
                    if isinstance(parent_data.get('periodic'), list) and len(parent_data['periodic']) == 3:
                        parent_periodic = [bool(p) for p in parent_data['periodic']]
            except Exception:
                pass

        for species_node in root.findall('.//species'):
            s_name = str(species_node.attrib.get('name') or '').strip()
            pseudo = species_node.findtext('pseudo_file') or species_node.findtext('./pseudo_file') or ''
            if s_name and pseudo and s_name not in species_map:
                m = re.match(r'^([A-Za-z]{1,2})[._]', pseudo.strip())
                if m and m.group(1).capitalize() in ELEMENT_SYMBOLS:
                    species_map[s_name] = m.group(1).capitalize()

        raw_species = [str(atom.attrib.get('name') or '').strip() for atom in particles]
        element_map: dict[str, str] = {}
        for name in raw_species:
            element_map[name] = resolve_qe_element(name, species_map)

        periodic = parent_periodic if parent_periodic is not None else [True, True, True]
        from backend.local_api.domain.workflow_md_results import frame_structure
        result = frame_structure(
            {
                'vectors': vectors,
                'positions': [float(number) * factor for atom in particles for number in atom.text.split()],
                'species': raw_species,
                'origin': [0, 0, 0],
                'periodic': periodic,
                'hasCell': True,
            },
            {
                'coordinateUnit': 'angstrom',
                'elementMap': element_map,
                'periodic': periodic,
                'name': f"{job.get('name', 'Structure')} (relaxed)" if stage == 'relax' else f"{job.get('name', 'Structure')} (converged)",
            },
        )
        for index, atom in enumerate(result['atoms']):
            orig_label = parent_labels[index] if index < len(parent_labels) and parent_labels[index] else raw_species[index]
            if orig_label and orig_label != atom['species']:
                atom['label'] = orig_label
        result['source'] = 'workflow-relaxation' if stage == 'relax' else 'workflow-scf'
        return result
    refs = attempt.get('result', {}).get('resources', [])
    ref = next((ref for ref in refs if ref['kind'] == 'structure'), None)
    if not ref:
        raise ApiError(422, 'Connect a saved structure or an extracted frame.', 'WORKFLOW_STRUCTURE_REQUIRED')
    item = require_owner_item(api.services, owner, 'STRUCTURE', ref['id'], 'STRUCTURE_NOT_FOUND')
    if item.get('projectId') != project:
        raise ApiError(409, 'Structure belongs to another project.', 'PROJECT_MISMATCH')
    raw = api.services.s3.get_object(Bucket=api.services.bucket, Key=item['objectKey'])['Body'].read(5_000_001)
    expected = ref.get('sha256') or item.get('sha256')
    if len(raw) > 5_000_000 or expected and hashlib.sha256(raw).hexdigest() != expected:
        raise ApiError(409, 'Structure checksum failed.', 'WORKFLOW_STRUCTURE_INVALID')
    return json.loads(raw)


def lattice_vectors(lattice: dict[str, Any]) -> list[list[float]]:
    if lattice.get('vectors'):
        return lattice['vectors']
    a, b, c = (float(lattice[key]) for key in ('a', 'b', 'c'))
    alpha, beta, gamma = (math.radians(float(lattice[key])) for key in ('alpha', 'beta', 'gamma'))
    if min(a, b, c) <= 0 or abs(math.sin(gamma)) < 1e-10:
        raise ApiError(422, 'Structure cell is invalid.', 'WORKFLOW_STRUCTURE_INVALID')
    cy = c * (math.cos(alpha) - math.cos(beta) * math.cos(gamma)) / math.sin(gamma)
    cz2 = c*c - (c * math.cos(beta))**2 - cy*cy
    if cz2 <= 0:
        raise ApiError(422, 'Structure cell is singular.', 'WORKFLOW_STRUCTURE_INVALID')
    return [[a, 0, 0], [b * math.cos(gamma), b * math.sin(gamma), 0], [c * math.cos(beta), cy, math.sqrt(cz2)]]


def md_structure_input(api: Any, owner: str, project: str, attempt: dict[str, Any], boundary: str) -> str:
    structure = source_structure(api, owner, project, attempt)
    vectors = lattice_vectors(structure['lattice'])
    periodic = structure.get('periodic', structure['lattice'].get('periodic', [True, True, True]))
    if not isinstance(periodic, list) or len(periodic) != 3 or any(type(axis) is not bool for axis in periodic):
        raise ApiError(422, 'Confirm three explicit periodic axes.', 'WORKFLOW_STRUCTURE_INVALID')
    if boundary != ' '.join('p' if value else 'f' for value in periodic):
        raise ApiError(422, 'Match the MD boundary to the connected structure periodicity.', 'WORKFLOW_PERIODICITY_MISMATCH')
    if len(vectors) != 3 or any(not isinstance(vector, list) or len(vector) != 3 for vector in vectors) or any(type(value) not in (int, float) or not math.isfinite(value) for vector in vectors for value in vector):
        raise ApiError(422, 'Structure coordinates must be finite.', 'WORKFLOW_STRUCTURE_INVALID')
    a, b, c = vectors
    determinant = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])
    if abs(determinant) < 1e-12:
        raise ApiError(422, 'MD requires a nonsingular cell.', 'WORKFLOW_STRUCTURE_INVALID')
    lattice = ' '.join(f'{value:.16g}' for vector in vectors for value in vector)
    lines = [str(len(structure['atoms'])), f'Lattice="{lattice}" Properties=species:S:1:pos:R:3 pbc="'+ ' '.join('T' if value else 'F' for value in periodic) + '"']
    for atom in structure['atoms']:
        if atom.get('occupancy', 1) != 1 or atom.get('siteSpecies') and (len(atom['siteSpecies']) != 1 or atom['siteSpecies'][0].get('occupancy') != 1 or atom['siteSpecies'][0].get('element') != atom['species']):
            raise ApiError(422, 'Resolve partial or mixed site occupancies into an explicit atomistic structure before MD.', 'WORKFLOW_STRUCTURE_INVALID')
        if atom['species'] not in ELEMENT_SYMBOLS or any(type(atom.get(key)) not in (int, float) or not math.isfinite(atom[key]) for key in ('x', 'y', 'z')):
            raise ApiError(422, 'Explicit elements and finite coordinates are required.', 'WORKFLOW_STRUCTURE_INVALID')
        xyz = [sum(atom[key] * vectors[index][axis] for index, key in enumerate(('x', 'y', 'z'))) for axis in range(3)]
        lines.append(atom['species'] + ' ' + ' '.join(f'{value:.16g}' for value in xyz))
    raw = ('\n'.join(lines) + '\n').encode()
    sha = hashlib.sha256(raw).hexdigest()
    resource_id = 'mdt_' + hashlib.sha256(f'{project}:{sha}'.encode()).hexdigest()[:32]
    if not api.services.get_item(owner, 'MD_TRAJECTORY', resource_id):
        key = f'users/{storage_owner(owner)}/projects/{project}/workflow/structure-inputs/{sha}.xyz'
        api.services.s3.put_object(Bucket=api.services.bucket, Key=key, Body=raw, ContentType='chemical/x-xyz', ServerSideEncryption='AES256')
        now = utc_now()
        api.put_new(owner, 'MD_TRAJECTORY', resource_id, {'projectId': project, 'filename': resource_id+'.xyz', 'format': 'xyz', 'name': structure.get('name', 'Workflow structure'), 'sha256': sha, 'sizeBytes': len(raw), 'contentType': 'chemical/x-xyz', 'status': 'READY', 'objectKey': key, 'uploadedAt': now, 'updatedAt': now})
    return resource_id
