"""Owned local scientific dispatcher; hosted routes and execution live separately."""
from __future__ import annotations
from backend.local_api.domain.scf_telemetry import normalize_scf_convergence
from backend.local_api.domain.compute_preferences import personal_resources
from backend.local_api.domain.worker_resources import normalize_compute_phase, normalize_effective_resources
import base64
import binascii
import hashlib
import hmac
import json
import logging
import math
import mimetypes
import os
import re
import secrets
import shlex
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from backend.local_api.domain.dft_validation import dft_convergence_summary, dependency_dft_error, dft_result_error, validate_band_postprocessor_input, validate_relaxation_input, validate_transport_settings
from backend.local_api.domain.result_artifacts import MAX_RESULT_MANIFEST_BYTES, artifact_page, read_result_manifest
from backend.local_api.domain.research_documents import DOCUMENT_PATH, ResearchDocuments
from backend.local_api.domain.account import AccountApi, validate_avatar
from backend.local_api.domain.failure_digest import FAILURE_CATEGORIES
from backend.local_api.domain.md_results import MD_ARTIFACT_PATH, MD_DIAGNOSTIC_PATH, MdResultError, finalize_md_analysis_result, md_result_summary, read_md_diagnostic_manifest, read_md_result_manifest
from backend.local_api.domain.phynite_core import CALCULATION_TYPES, FINAL_JOB_STATES, ApiError, MetadataServices, clean_text, fetch_materials_project, json_safe, materials_project_api_key, new_id, owner_partition, parse_body, public_item, request_claims, require_owner_item, require_project, retained_locally, response, route_details, safe_filename, storage_owner, utc_now
CLOUD_BACKEND = 'CLOUD_EC2'
PAID_BACKEND = 'CLOUD_PAID_EC2'
PILOT_FLEET_BACKEND = 'CLOUD_PILOT_EC2'

def normalize_execution_affinity(value: Any) -> dict[str, str] | None:
    """Bind scheduler work to the matching owner-paired allocation."""
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {'scheduler', 'profileSha256'}:
        raise ApiError(400, 'Scheduler affinity requires scheduler and profileSha256.', 'INVALID_EXECUTION_AFFINITY')
    if not isinstance(value['scheduler'], str) or value['scheduler'] not in {'slurm', 'pbs'} or (not isinstance(value['profileSha256'], str)) or (not re.fullmatch('[a-f0-9]{64}', value['profileSha256'])):
        raise ApiError(400, 'Scheduler affinity must identify Slurm or PBS and the exact profile SHA-256.', 'INVALID_EXECUTION_AFFINITY')
    return dict(value)
PROJECT_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)$')
PROJECT_STRUCTURES_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/structures$')
PROJECT_UPLOAD_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/structures/upload-url$')
PROJECT_CALCULATIONS_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/calculations$')
PROJECT_RESEARCH_CONTEXT_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/research-context$')
PROJECT_RESEARCH_EVENTS_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/research-events$')
STRUCTURE_PATH = re.compile('^/v1/structures/([A-Za-z0-9_-]+)$')
CALCULATION_PATH = re.compile('^/v1/calculations/([A-Za-z0-9_-]+)$')
CALCULATION_FILES_PATH = re.compile('^/v1/calculations/([A-Za-z0-9_-]+)/files$')
CALCULATION_ARTIFACTS_PATH = re.compile('^/v1/calculations/([A-Za-z0-9_-]+)/artifacts$')
CALCULATION_CANCEL_PATH = re.compile('^/v1/calculations/([A-Za-z0-9_-]+)/cancel$')
CALCULATION_DIAGNOSIS_PATH = re.compile('^/v1/calculations/([A-Za-z0-9_-]+)/diagnosis$')
PROJECT_MD_TRAJECTORIES_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/md/trajectories$')
MD_TRAJECTORY_COMPLETE_PATH = re.compile('^/v1/md/trajectories/([A-Za-z0-9_-]+)/complete$')
MD_TRAJECTORY_PATH = re.compile('^/v1/md/trajectories/([A-Za-z0-9_-]+)$')
PROJECT_MD_ANALYSES_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/md/analyses$')
PROJECT_MD_SIMULATIONS_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/md/simulations$')
PROJECT_MD_POTENTIALS_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/md/potentials$')
PROJECT_MD_CONFIGURATIONS_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/md/configurations$')
MD_SIMULATION_PATH = re.compile('^/v1/md/simulations/([A-Za-z0-9_-]+)$')
MD_SIMULATION_CANCEL_PATH = re.compile('^/v1/md/simulations/([A-Za-z0-9_-]+)/cancel$')
MD_POTENTIAL_COMPLETE_PATH = re.compile('^/v1/md/potentials/([A-Za-z0-9_-]+)/complete$')
MD_POTENTIAL_PATH = re.compile('^/v1/md/potentials/([A-Za-z0-9_-]+)$')
MD_CONFIGURATION_PATH = re.compile('^/v1/md/configurations/([A-Za-z0-9_-]+)$')
MD_ANALYSIS_PATH = re.compile('^/v1/md/analyses/([A-Za-z0-9_-]+)$')
MD_ANALYSIS_CANCEL_PATH = re.compile('^/v1/md/analyses/([A-Za-z0-9_-]+)/cancel$')
MD_ANALYSIS_ARTIFACT_PATH = re.compile('^/v1/md/analyses/([A-Za-z0-9_-]+)/artifacts/(timeline\\.json\\.gz|frames/(?:[0-9]{6}|[0-9]{6}-[0-9]{6})\\.json\\.gz|logs/[A-Za-z0-9_.-]+\\.(?:out|log|txt))$')
MD_WORKER_ANALYSIS_PATH = re.compile('^/md-worker/v1/analyses/([A-Za-z0-9_-]+)/(inputs|uploads|progress)$')
DEVELOPER_JOB_PATH = re.compile('^/v1/developer/jobs/([A-Za-z0-9_-]+)$')
DEVELOPER_WAITLIST_ENTRY_PATH = re.compile('^/v1/developer/waitlist/([a-f0-9]{64})$')
DEVELOPER_WAITLIST_CONFIRMATION_PATH = re.compile('^/v1/developer/waitlist/([a-f0-9]{64})/confirmation$')
DEVELOPER_WAITLIST_RECONCILE_PATH = re.compile('^/v1/developer/waitlist/([a-f0-9]{64})/reconcile$')
WORKER_JOB_PATH = re.compile('^/worker/v1/jobs/([A-Za-z0-9_-]+)/(heartbeat|uploads|complete)$')
WORKER_CLAIM_PATH = '/worker/v1/jobs/claim'
DEVELOPER_JOBS_PATH = '/v1/developer/jobs'
DEVELOPER_QUEUE_PATH = '/v1/developer/queue'
DEVELOPER_WORKERS_PATH = '/v1/developer/workers'
DEVELOPER_WAITLIST_PATH = '/v1/developer/waitlist'
DEVELOPER_WAITLIST_INVITATIONS_PATH = '/v1/developer/waitlist/invitations'
DEVELOPER_WAITLIST_POLICY_PATH = '/v1/developer/waitlist/policy'
COMPUTE_STATUS_PATH = '/v1/compute/status'
MD_RUNTIME_MANIFEST_PATH = '/v1/md/runtime-manifest'
PSEUDOPOTENTIAL_UPLOAD_PATH = '/v1/pseudopotentials/upload-url'
WORKSPACE_PATH = '/v1/workspace'
PROFILE_PATH = '/v1/profile'
MAX_WORKSPACE_BYTES = 4500000
MAX_MD_TRAJECTORY_BYTES = 268435456
MAX_PERSONAL_MD_RESULT_BYTES = 64 * 1024 ** 3
MAX_MD_TRAJECTORIES_PER_PROJECT = 200
MAX_MD_TRAJECTORY_BYTES_PER_PROJECT = 64 * 1024 ** 3
MAX_ACTIVE_MD_ANALYSES_PER_PROJECT = 8
MAX_ACTIVE_MD_SIMULATIONS_PER_PROJECT = 8
MAX_MD_POTENTIAL_FILES = 4
MAX_MD_POTENTIAL_FILE_BYTES = 20 * 1024 * 1024
MAX_MD_POTENTIAL_BYTES = 50 * 1024 * 1024
MAX_MD_POTENTIALS_PER_PROJECT = 100
MAX_MD_CONFIGURATIONS_PER_PROJECT = 100
MAX_MD_WORKFLOW_BYTES = 128000
MAX_MD_PIPELINE_BYTES = 64000
MAX_MD_RESULT_MANIFEST_BYTES = 8000000
MAX_MD_RESULT_ARTIFACT_BYTES = 128 * 1024 * 1024
PROJECT_TRASH_RETENTION_DAYS = 15
EMAIL_PATTERN = re.compile('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')
WAITLIST_STATUSES = {'WAITING', 'INVITED', 'ONBOARDED', 'DECLINED'}
PROJECT_TAGS = {'QE', 'LAMMPS', 'MD'}
LOCAL_WORKER_CAPABILITIES = {'qe', 'md-analysis', 'md-simulation'}
MD_RUNNER_PROTOCOL = 1
MD_WORKFLOW_VERSIONS = {1, 2}
MD_SIMULATION_RECIPES = {'equilibration', 'tensile', 'shear', 'compression', 'melting', 'diffusion'}
MD_WORKFLOW_STEP_KINDS = {'minimization', 'velocity', 'nve', 'nvt', 'npt', 'nph', 'langevin', 'temp-berendsen', 'press-berendsen', 'pressure-ramp', 'heating', 'cooling', 'annealing', 'tensile', 'compression', 'shear', 'diffusion', 'rdf', 'vacf', 'coordination', 'cna', 'centrosymmetry', 'voronoi', 'stress-atom', 'pe-atom', 'ke-atom', 'restart'}
MD_DIRECTIVE_BLOCK_KINDS = {'run', 'minimize', 'velocity', 'thermostat', 'barostat', 'deform', 'analysis', 'checkpoint'}
MD_POTENTIAL_FAMILIES = {'eam': {'fileCount': {1}, 'roles': None}, 'eam-alloy': {'fileCount': {1}, 'roles': None}, 'meam': {'fileCount': {2}, 'roles': {'library', 'parameter'}}, 'tersoff': {'fileCount': {1}, 'roles': None}, 'sw': {'fileCount': {1}, 'roles': None}}
MD_POTENTIAL_PAIR_STYLES = {'eam': 'eam', 'eam-alloy': 'eam/alloy', 'meam': 'meam', 'tersoff': 'tersoff', 'sw': 'sw'}
MD_LEGACY_WORKFLOW_STEP_KINDS = {'minimization', 'velocity', 'nve', 'nvt', 'npt', 'heating', 'cooling', 'annealing', 'tensile', 'compression', 'shear', 'diffusion', 'rdf', 'restart'}
MD_REQUIRED_STYLE_INVENTORIES = {'atom', 'integrate', 'minimize', 'pair', 'fix', 'compute', 'dump'}
MD_LEGACY_RUNTIME_STYLES = {'atom': {'atomic'}, 'integrate': {'verlet'}, 'minimize': {'cg', 'fire', 'sd'}, 'fix': {'ave/time', 'deform', 'nve', 'nvt', 'npt'}, 'compute': {'msd', 'rdf'}, 'dump': {'custom'}}
MD_STEP_RUNTIME_STYLES: dict[str, dict[str, set[str]]] = {'nve': {'fix': {'nve'}}, 'nvt': {'fix': {'nvt'}}, 'npt': {'fix': {'npt'}}, 'nph': {'fix': {'nph'}}, 'langevin': {'fix': {'langevin', 'nve'}}, 'temp-berendsen': {'fix': {'nve', 'temp/berendsen'}}, 'press-berendsen': {'fix': {'nve', 'press/berendsen'}}, 'pressure-ramp': {'fix': {'nph'}}, 'heating': {'fix': {'nvt'}}, 'cooling': {'fix': {'nvt'}}, 'annealing': {'fix': {'nvt'}}, 'tensile': {'fix': {'deform', 'nvt'}}, 'compression': {'fix': {'deform', 'nvt'}}, 'shear': {'fix': {'deform', 'nvt'}}, 'diffusion': {'fix': {'ave/time', 'nvt'}, 'compute': {'msd'}}, 'rdf': {'fix': {'ave/time', 'nvt'}, 'compute': {'rdf'}}, 'vacf': {'fix': {'ave/time', 'nve'}, 'compute': {'vacf'}}, 'coordination': {'compute': {'coord/atom'}}, 'cna': {'compute': {'cna/atom'}}, 'centrosymmetry': {'compute': {'centro/atom'}}, 'voronoi': {'compute': {'voronoi/atom'}}, 'stress-atom': {'compute': {'stress/atom'}}, 'pe-atom': {'compute': {'pe/atom'}}, 'ke-atom': {'compute': {'ke/atom'}}}
MD_STEP_RUNTIME_PACKAGES = {'voronoi': {'VORONOI'}}
MD_TRAJECTORY_FORMATS = {'.dump': 'lammps-dump', '.lammpstrj': 'lammps-dump', '.xyz': 'xyz', '.extxyz': 'extxyz', '.data': 'lammps-data', '.cif': 'cif', '.pdb': 'pdb', '.xsf': 'xsf', '.axsf': 'xsf', '.poscar': 'poscar', '.contcar': 'poscar', '.vasp': 'poscar', '.lmp': 'lammps-data', '.txt': 'text', '.in': 'quantum-espresso', '.pwi': 'quantum-espresso', '.pw': 'quantum-espresso', '.qe': 'quantum-espresso', '.out': 'quantum-espresso', '.pwo': 'quantum-espresso'}
MD_CONTENT_TYPES = {'application/octet-stream', 'text/plain', 'chemical/x-cif', 'chemical/x-xyz', 'chemical/x-pdb', 'application/x-lammps'}

def normalize_project_tags(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > len(PROJECT_TAGS):
        raise ApiError(400, 'Project tags are invalid.', 'INVALID_PROJECT_TAGS')
    tags: list[str] = []
    for raw in value:
        if not isinstance(raw, str) or raw not in PROJECT_TAGS:
            raise ApiError(400, 'Project tags are invalid.', 'INVALID_PROJECT_TAGS')
        if raw not in tags:
            tags.append(raw)
    return tags

def md_project_tags(existing: Any, trajectory_format: str) -> list[str]:
    tags = normalize_project_tags(existing)
    for tag in ['MD', 'LAMMPS' if trajectory_format.startswith('lammps-') else 'QE' if trajectory_format == 'quantum-espresso' else '']:
        if tag and tag not in tags:
            tags.append(tag)
    return tags
MD_MODIFIER_TYPES = {'supercell', 'surface_slab', 'wrap', 'ptm', 'cna', 'dxa', 'rdf', 'surface', 'expression', 'slice', 'centrosymmetry', 'strain', 'cluster', 'coordination', 'bonds', 'replicate'}
MD_MODIFIER_PARAMETERS = {'supercell': {'matrix'}, 'surface_slab': {'miller', 'layers', 'vacuumAngstrom', 'termination'}, 'wrap': set(), 'ptm': {'rmsd', 'rmsdCutoff'}, 'cna': {'mode', 'cutoff'}, 'dxa': {'lattice', 'crystalStructure'}, 'rdf': {'cutoff', 'bins'}, 'surface': {'radius'}, 'expression': {'expression', 'action'}, 'slice': {'normal', 'distance', 'reverse'}, 'centrosymmetry': {'neighbors'}, 'strain': {'cutoff', 'referenceFrame'}, 'cluster': {'cutoff'}, 'coordination': {'cutoff'}, 'bonds': {'cutoff'}, 'replicate': {'repeat', 'numX', 'numY', 'numZ'}}

def request_api_base_url(event: dict[str, Any]) -> str:
    """Build the worker callback origin from API Gateway's trusted context."""
    context = event.get('requestContext') or {}
    domain = str(context.get('domainName') or '').strip().lower()
    if not re.fullmatch('[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?', domain):
        raise ApiError(500, 'MD worker callback address is unavailable.', 'MD_WORKER_CONFIGURATION')
    stage = str(context.get('stage') or '$default').strip()
    if stage == '$default':
        return f'https://{domain}'
    if not re.fullmatch('[A-Za-z0-9_-]{1,128}', stage):
        raise ApiError(500, 'MD worker callback address is invalid.', 'MD_WORKER_CONFIGURATION')
    return f'https://{domain}/{stage}'

def project_trash_expiry(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None

def prune_expired_project_trash(snapshot: dict[str, Any]) -> dict[str, Any]:
    trash = snapshot.get('projectTrash')
    if not isinstance(trash, list):
        return snapshot
    now = datetime.now(timezone.utc)
    retained: list[dict[str, Any]] = []
    changed = False
    for entry in trash:
        if not isinstance(entry, dict):
            changed = True
            continue
        deleted_at = project_trash_expiry(entry.get('deletedAt'))
        requested_expiry = project_trash_expiry(entry.get('expiresAt'))
        if deleted_at is None or requested_expiry is None:
            changed = True
            continue
        maximum_expiry = min(deleted_at + timedelta(days=PROJECT_TRASH_RETENTION_DAYS), now + timedelta(days=PROJECT_TRASH_RETENTION_DAYS))
        effective_expiry = min(requested_expiry, maximum_expiry)
        if effective_expiry <= now:
            changed = True
            continue
        normalized_expiry = effective_expiry.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
        if normalized_expiry != entry.get('expiresAt'):
            entry = {**entry, 'expiresAt': normalized_expiry}
            changed = True
        retained.append(entry)
    return snapshot if not changed else {**snapshot, 'projectTrash': retained}

def md_idempotency_key(value: Any) -> str:
    key = clean_text(value, 'Idempotency key', minimum=16, maximum=96)
    if not re.fullmatch('[A-Za-z0-9_-]+', key):
        raise ApiError(400, 'Idempotency key contains unsupported characters.', 'INVALID_IDEMPOTENCY_KEY')
    return key

def md_integer(value: Any, label: str, minimum: int, maximum: int, code: str='INVALID_MD_PIPELINE') -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ApiError(400, f'{label} must be a whole number.', code)
    if value < minimum or value > maximum:
        raise ApiError(400, f'{label} is outside the supported range.', code)
    return value

def md_finite_number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(400, f'{label} must be a finite number.', 'INVALID_MD_SIMULATION')
    result = float(value)
    if not math.isfinite(result) or result < minimum or result > maximum:
        raise ApiError(400, f'{label} is outside the supported range.', 'INVALID_MD_SIMULATION')
    return result

def normalize_md_simulation_config(value: Any) -> dict[str, Any]:
    """Return the small, auditable LAMMPS contract accepted by personal compute."""
    if not isinstance(value, dict):
        raise ApiError(400, 'MD simulation configuration is invalid.', 'INVALID_MD_SIMULATION')
    recipe = value.get('recipeId')
    if recipe not in MD_SIMULATION_RECIPES:
        raise ApiError(400, 'MD simulation recipe is not supported.', 'INVALID_MD_SIMULATION')
    boundary = value.get('boundaryType', 'p p p')
    if boundary not in {'p p p', 'p p f', 'p f p', 'f p p', 'p f f', 'f p f', 'f f p', 'f f f'}:
        raise ApiError(400, 'MD boundary conditions are invalid.', 'INVALID_MD_SIMULATION')
    ensemble = value.get('ensemble', 'nvt')
    if ensemble not in {'nve', 'nvt', 'npt'}:
        raise ApiError(400, 'MD ensemble is invalid.', 'INVALID_MD_SIMULATION')
    force_field = value.get('forceFieldId', 'lj-generic')
    if force_field != 'lj-generic':
        raise ApiError(422, 'This potential is not installed. Choose Lennard-Jones or upload a verified potential first.', 'MD_POTENTIAL_REQUIRED')
    axis = value.get('compressionAxis', 'z') if recipe == 'compression' else value.get('tensileAxis', 'z')
    if axis not in {'x', 'y', 'z'}:
        raise ApiError(400, 'Deformation axis is invalid.', 'INVALID_MD_SIMULATION')
    shear_plane = value.get('shearPlane', 'xy')
    if shear_plane not in {'xy', 'xz', 'yz'}:
        raise ApiError(400, 'Shear plane is invalid.', 'INVALID_MD_SIMULATION')
    total_steps = md_integer(value.get('totalSteps', 10000), 'Total steps', 1, 100000000, 'INVALID_MD_SIMULATION')
    thermo_frequency = md_integer(value.get('thermoFrequency', 100), 'Thermo interval', 1, total_steps, 'INVALID_MD_SIMULATION')
    dump_frequency = md_integer(value.get('dumpFrequency', 500), 'Dump interval', 1, total_steps, 'INVALID_MD_SIMULATION')
    sigma = md_finite_number(value.get('sigmaAngstrom', 3.4), 'Lennard-Jones sigma', 1e-06, 1000.0)
    cutoff = md_finite_number(value.get('cutoffRadiusAngstrom', 8.5), 'Lennard-Jones cutoff', sigma, 10000.0)
    timestep_fs = md_finite_number(value.get('timestepFs', 1.0), 'Timestep', 0.0001, 100.0)
    if recipe == 'shear':
        rate_value = value.get('shearRate', 100000000.0)
        maximum_value = value.get('maxShearStrain', 0.2)
    elif recipe == 'compression':
        rate_value = value.get('compressionRate', 100000000.0)
        maximum_value = value.get('maxCompressionStrain', 0.2)
    else:
        rate_value = value.get('strainRate', 100000000.0)
        maximum_value = value.get('maxStrain', 0.2)
    strain_rate = md_finite_number(rate_value, 'Strain rate', 1e-12, 1e+18)
    maximum_strain = md_finite_number(maximum_value, 'Maximum strain', 1e-09, 10.0)
    if recipe in {'tensile', 'shear', 'compression'}:
        planned_strain = strain_rate * 1e-12 * (timestep_fs / 1000.0) * total_steps
        if planned_strain > maximum_strain * (1.0 + 1e-09):
            raise ApiError(400, f'This run would reach {planned_strain:.6g} strain, above the {maximum_strain:.6g} safety limit.', 'INVALID_MD_SIMULATION')
    return {'version': 1, 'recipeId': recipe, 'units': 'metal', 'atomStyle': 'atomic', 'boundaryType': boundary, 'ensemble': ensemble, 'timestepFs': timestep_fs, 'totalSteps': total_steps, 'tempStartK': md_finite_number(value.get('tempStartK', 300.0), 'Initial temperature', 0.0, 100000.0), 'tempEndK': md_finite_number(value.get('tempEndK', value.get('tempStartK', 300.0)), 'Final temperature', 0.0, 100000.0), 'pressureBar': md_finite_number(value.get('pressureBar', 0.0), 'Pressure', -1000000.0, 1000000.0), 'velocitySeed': md_integer(value.get('velocitySeed', 4928459), 'Velocity seed', 1, 2147483646, 'INVALID_MD_SIMULATION'), 'thermoFrequency': thermo_frequency, 'dumpFrequency': dump_frequency, 'forceField': {'kind': 'lennard-jones', 'epsilonEv': md_finite_number(value.get('epsilonEv', 0.0103), 'Lennard-Jones epsilon', 1e-12, 1000.0), 'sigmaAngstrom': sigma, 'cutoffAngstrom': cutoff}, 'axis': axis, 'shearPlane': shear_plane, 'strainRatePerSecond': strain_rate, 'maxStrain': maximum_strain}

def normalize_md_manual_body(value: Any) -> str:
    if not isinstance(value, str):
        raise ApiError(400, 'LAMMPS input must be text.', 'INVALID_MD_MANUAL_INPUT')
    body = value.replace('\r\n', '\n').replace('\r', '\n').strip()
    encoded = body.encode('utf-8')
    if not body or len(encoded) > 64000 or '\x00' in body:
        raise ApiError(400, 'LAMMPS input is empty or too large.', 'INVALID_MD_MANUAL_INPUT')
    blocked_commands = {'clear', 'shell', 'python', 'plugin', 'quit', 'include', 'jump', 'read_data', 'read_dump', 'read_restart', 'log', 'dump', 'undump', 'write_data', 'write_dump', 'write_restart', 'restart', 'thermo', 'thermo_style', 'thermo_modify', 'units', 'dimension', 'boundary', 'atom_style', 'create_box', 'create_atoms', 'mass', 'pair_style', 'pair_coeff', 'pair_modify', 'pair_write', 'write_coeff', 'reset_timestep'}
    has_execution = False
    commands: list[list[str]] = []
    pending = ''
    continued = False
    for raw_line in body.splitlines():
        continued = raw_line.rstrip().endswith('&')
        pending += raw_line.rstrip()[:-1] if continued else raw_line
        if continued:
            continue
        try:
            tokens = shlex.split(pending, comments=True, posix=True)
        except ValueError as exc:
            raise ApiError(400, 'LAMMPS input contains an unterminated quoted command.', 'INVALID_MD_MANUAL_INPUT') from exc
        pending = ''
        if not tokens:
            continue
        commands.append(tokens)
    if continued:
        raise ApiError(400, 'LAMMPS input ends with an incomplete continued command.', 'INVALID_MD_MANUAL_INPUT')
    if len(commands) > 500:
        raise ApiError(400, 'LAMMPS input contains too many commands.', 'INVALID_MD_MANUAL_INPUT')
    for tokens in commands:
        line = ' '.join(tokens)
        command = tokens[0].lower()
        if command.startswith('$') or command in blocked_commands:
            raise ApiError(400, f'LAMMPS command {command!r} is managed by Phynite or is not allowed.', 'UNSAFE_MD_MANUAL_INPUT')
        if command == 'if' or (command == 'run' and any((token.strip('"\'').lower() == 'every' for token in tokens[1:]))):
            raise ApiError(400, 'LAMMPS input cannot execute nested command strings.', 'UNSAFE_MD_MANUAL_INPUT')
        if command == 'variable' and len(tokens) >= 3 and (tokens[2].lower() in {'atomfile', 'file', 'python'}):
            raise ApiError(400, 'LAMMPS input cannot load variables from files or Python.', 'UNSAFE_MD_MANUAL_INPUT')
        if command == 'fix' and len(tokens) >= 4 and (tokens[3].lower() == 'dt/reset'):
            raise ApiError(400, 'Adaptive timesteps are unsupported by the physical-time contract; use fixed timesteps per stage.', 'UNSAFE_MD_MANUAL_INPUT')
        lowered = line.lower()
        if re.search('(?:^|\\s)(?:/|~(?:/|\\s)|\\.\\.(?:/|\\\\)|[a-z][a-z0-9+.-]*://)', lowered):
            raise ApiError(400, 'LAMMPS input contains an unsafe path.', 'UNSAFE_MD_MANUAL_INPUT')
        if command in {'fix', 'print', 'variable', 'info', 'balance'} and any((token.lower() in {'file', 'append', 'out'} for token in tokens[1:])):
            raise ApiError(400, 'LAMMPS input cannot create unmanaged output files.', 'UNSAFE_MD_MANUAL_INPUT')
        has_execution = has_execution or command in {'run', 'minimize'}
    if not has_execution:
        raise ApiError(400, 'LAMMPS input must contain a run or minimize command.', 'INVALID_MD_MANUAL_INPUT')
    return body + '\n'

def _md_step_number(params: dict[str, Any], name: str, default: float, minimum: float, maximum: float, label: str) -> float:
    return md_finite_number(params.get(name, default), label, minimum, maximum)

def _md_step_integer(params: dict[str, Any], name: str, default: int, minimum: int, maximum: int, label: str) -> int:
    return md_integer(params.get(name, default), label, minimum, maximum, 'INVALID_MD_SIMULATION')

def normalize_md_directive_blocks(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= 24:
        raise ApiError(400, 'LAMMPS block list is invalid.', 'INVALID_MD_SIMULATION')
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, block in enumerate(value):
        if not isinstance(block, dict) or set(block) != {'id', 'kind', 'enabled', 'params'}:
            raise ApiError(400, 'LAMMPS block is invalid.', 'INVALID_MD_SIMULATION')
        block_id = clean_text(block.get('id', f'block-{index + 1}'), 'LAMMPS block ID', minimum=1, maximum=80)
        if not re.fullmatch('[A-Za-z0-9_-]+', block_id) or block_id in seen:
            raise ApiError(400, 'LAMMPS block IDs must be unique identifiers.', 'INVALID_MD_SIMULATION')
        seen.add(block_id)
        kind = block.get('kind')
        if kind not in MD_DIRECTIVE_BLOCK_KINDS:
            raise ApiError(400, 'LAMMPS block type is not supported.', 'INVALID_MD_SIMULATION')
        enabled = block.get('enabled')
        raw = block.get('params')
        if not isinstance(enabled, bool) or not isinstance(raw, dict):
            raise ApiError(400, 'LAMMPS block state is invalid.', 'INVALID_MD_SIMULATION')
        params: dict[str, Any]
        if kind == 'run':
            if set(raw) != {'steps'}:
                raise ApiError(400, 'Run block parameters are invalid.', 'INVALID_MD_SIMULATION')
            params = {'steps': _md_step_integer(raw, 'steps', 10000, 0, 100000000, 'Run steps')}
        elif kind == 'minimize':
            if set(raw) != {'style', 'energyTolerance', 'forceTolerance', 'maxIterations', 'maxEvaluations'} or raw.get('style') not in {'cg', 'fire', 'sd'}:
                raise ApiError(400, 'Minimize block parameters are invalid.', 'INVALID_MD_SIMULATION')
            params = {'style': raw['style'], 'energyTolerance': _md_step_number(raw, 'energyTolerance', 1e-08, 0, 1, 'Energy tolerance'), 'forceTolerance': _md_step_number(raw, 'forceTolerance', 1e-10, 0, 1, 'Force tolerance'), 'maxIterations': _md_step_integer(raw, 'maxIterations', 10000, 1, 10000000, 'Maximum iterations'), 'maxEvaluations': _md_step_integer(raw, 'maxEvaluations', 100000, 1, 100000000, 'Maximum evaluations')}
        elif kind == 'velocity':
            if set(raw) != {'temperatureK', 'seed'}:
                raise ApiError(400, 'Velocity block parameters are invalid.', 'INVALID_MD_SIMULATION')
            params = {'temperatureK': _md_step_number(raw, 'temperatureK', 300, 0, 100000, 'Temperature'), 'seed': _md_step_integer(raw, 'seed', 4928459, 1, 2147483646, 'Velocity seed')}
        elif kind == 'thermostat':
            expected = {'style', 'timestepFs', 'totalSteps', 'tempStartK', 'tempEndK', 'dampingPs', 'seed'}
            if set(raw) != expected or raw.get('style') not in {'nve', 'nvt', 'langevin', 'temp-berendsen'}:
                raise ApiError(400, 'Temperature-control block parameters are invalid.', 'INVALID_MD_SIMULATION')
            params = {'style': raw['style'], 'timestepFs': _md_step_number(raw, 'timestepFs', 1, 0.0001, 100, 'Timestep'), 'totalSteps': _md_step_integer(raw, 'totalSteps', 10000, 0, 100000000, 'Total steps'), 'tempStartK': _md_step_number(raw, 'tempStartK', 300, 0, 100000, 'Initial temperature'), 'tempEndK': _md_step_number(raw, 'tempEndK', 300, 0, 100000, 'Final temperature'), 'dampingPs': _md_step_number(raw, 'dampingPs', 0.1, 1e-06, 10000, 'Temperature damping'), 'seed': _md_step_integer(raw, 'seed', 4928459, 1, 2147483646, 'Random seed')}
        elif kind == 'barostat':
            expected = {'style', 'timestepFs', 'totalSteps', 'tempStartK', 'tempEndK', 'tempDampingPs', 'pressureStartBar', 'pressureEndBar', 'pressureDampingPs'}
            if set(raw) != expected or raw.get('style') not in {'npt', 'nph', 'press-berendsen'}:
                raise ApiError(400, 'Pressure-control block parameters are invalid.', 'INVALID_MD_SIMULATION')
            params = {'style': raw['style'], 'timestepFs': _md_step_number(raw, 'timestepFs', 1, 0.0001, 100, 'Timestep'), 'totalSteps': _md_step_integer(raw, 'totalSteps', 10000, 0, 100000000, 'Total steps'), 'tempStartK': _md_step_number(raw, 'tempStartK', 300, 0, 100000, 'Initial temperature'), 'tempEndK': _md_step_number(raw, 'tempEndK', 300, 0, 100000, 'Final temperature'), 'tempDampingPs': _md_step_number(raw, 'tempDampingPs', 0.1, 1e-06, 10000, 'Temperature damping'), 'pressureStartBar': _md_step_number(raw, 'pressureStartBar', 0, -1000000, 1000000, 'Initial pressure'), 'pressureEndBar': _md_step_number(raw, 'pressureEndBar', 0, -1000000, 1000000, 'Final pressure'), 'pressureDampingPs': _md_step_number(raw, 'pressureDampingPs', 1, 1e-06, 100000, 'Pressure damping')}
        elif kind == 'deform':
            expected = {'mode', 'axis', 'timestepFs', 'totalSteps', 'temperatureK', 'tempDampingPs', 'strainRatePerSecond', 'maxStrain'}
            mode = raw.get('mode')
            axis = raw.get('axis')
            if set(raw) != expected or mode not in {'tensile', 'compression', 'shear'} or axis not in ({'xy', 'xz', 'yz'} if mode == 'shear' else {'x', 'y', 'z'}):
                raise ApiError(400, 'Deformation block parameters are invalid.', 'INVALID_MD_SIMULATION')
            timestep = _md_step_number(raw, 'timestepFs', 1, 0.0001, 100, 'Timestep')
            steps = _md_step_integer(raw, 'totalSteps', 10000, 0, 100000000, 'Total steps')
            rate = _md_step_number(raw, 'strainRatePerSecond', 100000000.0, 1e-12, 1e+18, 'Strain rate')
            maximum = _md_step_number(raw, 'maxStrain', 0.2, 1e-09, 10, 'Maximum strain')
            planned = rate * 1e-12 * (timestep / 1000) * steps
            if planned > maximum * (1 + 1e-09):
                raise ApiError(400, f'This block would reach {planned:.6g} strain, above the {maximum:.6g} safety limit.', 'INVALID_MD_SIMULATION')
            params = {'mode': mode, 'axis': axis, 'timestepFs': timestep, 'totalSteps': steps, 'temperatureK': _md_step_number(raw, 'temperatureK', 300, 0, 100000, 'Temperature'), 'tempDampingPs': _md_step_number(raw, 'tempDampingPs', 0.1, 1e-06, 10000, 'Temperature damping'), 'strainRatePerSecond': rate, 'maxStrain': maximum}
        elif kind == 'analysis':
            expected = {'style', 'totalSteps', 'sampleEvery', 'cutoffAngstrom', 'bins', 'neighbors'}
            styles = {'msd', 'rdf', 'vacf', 'coordination', 'cna', 'centrosymmetry', 'voronoi', 'stress-atom', 'pe-atom', 'ke-atom'}
            if set(raw) != expected or raw.get('style') not in styles:
                raise ApiError(400, 'Analysis block parameters are invalid.', 'INVALID_MD_SIMULATION')
            steps = _md_step_integer(raw, 'totalSteps', 10000, 0, 100000000, 'Analysis run steps')
            neighbors = _md_step_integer(raw, 'neighbors', 12, 2, 20, 'Neighbor count')
            if neighbors % 2:
                raise ApiError(400, 'Centrosymmetry neighbor count must be even.', 'INVALID_MD_SIMULATION')
            params = {'style': raw['style'], 'totalSteps': steps, 'sampleEvery': _md_step_integer(raw, 'sampleEvery', 100, 1, max(1, steps), 'Sampling interval'), 'cutoffAngstrom': _md_step_number(raw, 'cutoffAngstrom', 3.5, 1e-06, 10000, 'Analysis cutoff'), 'bins': _md_step_integer(raw, 'bins', 200, 10, 10000, 'RDF bins'), 'neighbors': neighbors}
        else:
            if set(raw) != {'label'}:
                raise ApiError(400, 'Checkpoint block parameters are invalid.', 'INVALID_MD_SIMULATION')
            label = clean_text(raw.get('label'), 'Checkpoint label', minimum=1, maximum=60)
            if not re.fullmatch('[A-Za-z0-9_-]+', label):
                raise ApiError(400, 'Checkpoint label is invalid.', 'INVALID_MD_SIMULATION')
            params = {'label': label}
        normalized.append({'id': block_id, 'kind': kind, 'enabled': enabled, 'params': params})
    if not any((block['enabled'] for block in normalized)):
        raise ApiError(400, 'Enable at least one LAMMPS block.', 'INVALID_MD_SIMULATION')
    return normalized

def normalize_md_workflow_step(value: Any, index: int) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {'id', 'kind', 'name', 'enabled', 'params', 'directives'}:
        raise ApiError(400, 'MD workflow step is invalid.', 'INVALID_MD_SIMULATION')
    kind = value.get('kind')
    if kind not in MD_WORKFLOW_STEP_KINDS:
        raise ApiError(400, 'MD workflow step is not supported.', 'INVALID_MD_SIMULATION')
    step_id = clean_text(value.get('id', f'step-{index + 1}'), 'Step ID', minimum=1, maximum=64)
    if not re.fullmatch('[A-Za-z0-9_-]+', step_id):
        raise ApiError(400, 'MD workflow step ID is invalid.', 'INVALID_MD_SIMULATION')
    name = clean_text(value.get('name', str(kind).replace('-', ' ').title()), 'Step name', minimum=1, maximum=120)
    enabled = value.get('enabled', True)
    if not isinstance(enabled, bool):
        raise ApiError(400, 'MD workflow step enabled state is invalid.', 'INVALID_MD_SIMULATION')
    raw_params = value.get('params', {})
    if not isinstance(raw_params, dict):
        raise ApiError(400, 'MD workflow step parameters are invalid.', 'INVALID_MD_SIMULATION')
    common_dynamics = {'timestepFs', 'totalSteps', 'tempStartK', 'tempEndK', 'temperatureK', 'pressureBar', 'pressureEndBar', 'velocitySeed', 'tempDampingPs', 'pressureDampingPs'}
    allowed_by_kind = {'minimization': {'style', 'energyTolerance', 'forceTolerance', 'maxIterations', 'maxEvaluations'}, 'velocity': {'temperatureK', 'velocitySeed'}, 'nve': {'timestepFs', 'totalSteps'}, 'nvt': common_dynamics, 'npt': common_dynamics, 'nph': common_dynamics, 'langevin': common_dynamics | {'frictionDampingPs'}, 'temp-berendsen': common_dynamics, 'press-berendsen': common_dynamics, 'pressure-ramp': common_dynamics, 'heating': common_dynamics, 'cooling': common_dynamics, 'annealing': common_dynamics, 'tensile': common_dynamics | {'axis', 'strainRatePerSecond', 'maxStrain'}, 'compression': common_dynamics | {'axis', 'strainRatePerSecond', 'maxStrain'}, 'shear': common_dynamics | {'shearPlane', 'strainRatePerSecond', 'maxStrain'}, 'diffusion': common_dynamics, 'rdf': common_dynamics | {'cutoffAngstrom', 'bins', 'sampleEvery'}, 'vacf': {'timestepFs', 'totalSteps', 'sampleEvery'}, 'coordination': {'cutoffAngstrom'}, 'cna': {'cutoffAngstrom'}, 'centrosymmetry': {'neighbors'}, 'voronoi': set(), 'stress-atom': set(), 'pe-atom': set(), 'ke-atom': set(), 'restart': {'label'}}
    if set(raw_params) - allowed_by_kind[str(kind)]:
        raise ApiError(400, 'MD workflow step contains unsupported parameters.', 'INVALID_MD_SIMULATION')
    params: dict[str, Any] = {}
    if kind == 'minimization':
        style = raw_params.get('style', 'cg')
        if style not in {'cg', 'fire', 'sd'}:
            raise ApiError(400, 'Minimization style is invalid.', 'INVALID_MD_SIMULATION')
        params = {'style': style, 'energyTolerance': _md_step_number(raw_params, 'energyTolerance', 1e-08, 0.0, 1.0, 'Energy tolerance'), 'forceTolerance': _md_step_number(raw_params, 'forceTolerance', 1e-10, 0.0, 1.0, 'Force tolerance'), 'maxIterations': _md_step_integer(raw_params, 'maxIterations', 10000, 1, 10000000, 'Maximum iterations'), 'maxEvaluations': _md_step_integer(raw_params, 'maxEvaluations', 100000, 1, 100000000, 'Maximum evaluations')}
    elif kind == 'velocity':
        params = {'temperatureK': _md_step_number(raw_params, 'temperatureK', 300.0, 0.0, 100000.0, 'Temperature'), 'velocitySeed': _md_step_integer(raw_params, 'velocitySeed', 4928459, 1, 2147483646, 'Velocity seed')}
    elif kind == 'restart':
        label = clean_text(raw_params.get('label', name), 'Restart label', minimum=1, maximum=60)
        params = {'label': re.sub('[^A-Za-z0-9_-]+', '-', label).strip('-') or 'checkpoint'}
    elif kind in {'coordination', 'cna'}:
        params = {'cutoffAngstrom': _md_step_number(raw_params, 'cutoffAngstrom', 3.5, 1e-06, 10000.0, 'Analysis cutoff')}
    elif kind == 'centrosymmetry':
        neighbors = _md_step_integer(raw_params, 'neighbors', 12, 2, 20, 'Neighbor count')
        if neighbors % 2:
            raise ApiError(400, 'Centrosymmetry neighbor count must be even.', 'INVALID_MD_SIMULATION')
        params = {'neighbors': neighbors}
    elif kind in {'voronoi', 'stress-atom', 'pe-atom', 'ke-atom'}:
        params = {}
    else:
        total_steps = _md_step_integer(raw_params, 'totalSteps', 10000, 1, 100000000, 'Total steps')
        timestep_fs = _md_step_number(raw_params, 'timestepFs', 1.0, 0.0001, 100.0, 'Timestep')
        start_k = _md_step_number(raw_params, 'tempStartK', float(raw_params.get('temperatureK', 300.0)), 0.0, 100000.0, 'Initial temperature')
        end_default = start_k
        if kind == 'heating':
            end_default = max(1000.0, start_k)
        elif kind == 'cooling':
            end_default = min(300.0, start_k)
        params = {'timestepFs': timestep_fs, 'totalSteps': total_steps}
        if kind not in {'nve', 'vacf'}:
            params.update({'tempStartK': start_k, 'tempEndK': _md_step_number(raw_params, 'tempEndK', end_default, 0.0, 100000.0, 'Final temperature'), 'tempDampingPs': _md_step_number(raw_params, 'tempDampingPs', max(timestep_fs * 0.1, 0.01), 1e-06, 10000.0, 'Temperature damping')})
        if kind in {'npt', 'nph', 'press-berendsen', 'pressure-ramp'}:
            params.update({'pressureBar': _md_step_number(raw_params, 'pressureBar', 0.0, -1000000.0, 1000000.0, 'Initial pressure'), 'pressureEndBar': _md_step_number(raw_params, 'pressureEndBar', float(raw_params.get('pressureBar', 0.0)), -1000000.0, 1000000.0, 'Final pressure'), 'pressureDampingPs': _md_step_number(raw_params, 'pressureDampingPs', max(timestep_fs, 0.1), 1e-06, 100000.0, 'Pressure damping')})
        if kind == 'langevin':
            params.update({'frictionDampingPs': _md_step_number(raw_params, 'frictionDampingPs', 0.1, 1e-06, 10000.0, 'Langevin damping'), 'velocitySeed': _md_step_integer(raw_params, 'velocitySeed', 4928459, 1, 2147483646, 'Random seed')})
        if kind in {'tensile', 'compression', 'shear'}:
            rate = _md_step_number(raw_params, 'strainRatePerSecond', 100000000.0, 1e-12, 1e+18, 'Strain rate')
            maximum = _md_step_number(raw_params, 'maxStrain', 0.2, 1e-09, 10.0, 'Maximum strain')
            planned = rate * 1e-12 * (timestep_fs / 1000.0) * total_steps
            if planned > maximum * (1.0 + 1e-09):
                raise ApiError(400, f'Step {name!r} would reach {planned:.6g} strain, above the {maximum:.6g} safety limit.', 'INVALID_MD_SIMULATION')
            params.update({'strainRatePerSecond': rate, 'maxStrain': maximum})
            if kind == 'shear':
                plane = raw_params.get('shearPlane', 'xy')
                if plane not in {'xy', 'xz', 'yz'}:
                    raise ApiError(400, 'Shear plane is invalid.', 'INVALID_MD_SIMULATION')
                params['shearPlane'] = plane
            else:
                axis = raw_params.get('axis', 'z')
                if axis not in {'x', 'y', 'z'}:
                    raise ApiError(400, 'Deformation axis is invalid.', 'INVALID_MD_SIMULATION')
                params['axis'] = axis
        if kind == 'rdf':
            params.update({'cutoffAngstrom': _md_step_number(raw_params, 'cutoffAngstrom', 8.0, 1e-06, 10000.0, 'RDF cutoff'), 'bins': _md_step_integer(raw_params, 'bins', 200, 10, 10000, 'RDF bins'), 'sampleEvery': _md_step_integer(raw_params, 'sampleEvery', 100, 1, total_steps, 'RDF sampling interval')})
        elif kind == 'vacf':
            params['sampleEvery'] = _md_step_integer(raw_params, 'sampleEvery', 100, 1, total_steps, 'VACF sampling interval')
    result = {'id': step_id, 'kind': kind, 'name': name, 'enabled': enabled, 'params': params}
    if 'directives' in value:
        result['directives'] = normalize_md_directive_blocks(value.get('directives'))
    return result

def legacy_md_config_to_workflow(config: dict[str, Any]) -> dict[str, Any]:
    recipe = str(config['recipeId'])
    kind = {'equilibration': str(config.get('ensemble', 'nvt')), 'melting': 'heating'}.get(recipe, recipe)
    params: dict[str, Any] = {'timestepFs': config['timestepFs'], 'totalSteps': config['totalSteps'], 'tempStartK': config['tempStartK'], 'tempEndK': config['tempEndK']}
    if kind == 'npt':
        params['pressureBar'] = config['pressureBar']
        params['pressureEndBar'] = config['pressureBar']
    if kind in {'tensile', 'compression'}:
        params.update({'axis': config['axis'], 'strainRatePerSecond': config['strainRatePerSecond'], 'maxStrain': config['maxStrain']})
    elif kind == 'shear':
        params.update({'shearPlane': config['shearPlane'], 'strainRatePerSecond': config['strainRatePerSecond'], 'maxStrain': config['maxStrain']})
    return {'version': 2, 'mode': 'guided', 'units': 'metal', 'boundaryType': config['boundaryType'], 'potential': {'kind': 'builtin', 'id': 'lj-generic', 'epsilonEv': config['forceField']['epsilonEv'], 'sigmaAngstrom': config['forceField']['sigmaAngstrom'], 'cutoffAngstrom': config['forceField']['cutoffAngstrom']}, 'steps': [{'id': 'step-1', 'kind': kind, 'name': recipe.title(), 'enabled': True, 'params': params}], 'output': {'thermoFrequency': config['thermoFrequency'], 'dumpFrequency': config['dumpFrequency']}}

def normalize_md_simulation_workflow(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {'version', 'mode', 'units', 'boundaryType', 'potential', 'steps', 'manualBody', 'output'}:
        raise ApiError(400, 'MD simulation workflow is invalid.', 'INVALID_MD_SIMULATION')
    if value.get('version') != 2:
        raise ApiError(400, 'MD simulation workflow version must be 2.', 'INVALID_MD_SIMULATION')
    mode = value.get('mode', 'guided')
    if mode not in {'simple', 'guided', 'manual'}:
        raise ApiError(400, 'MD simulation mode is invalid.', 'INVALID_MD_SIMULATION')
    if value.get('units', 'metal') != 'metal':
        raise ApiError(400, 'MD Lab currently supports LAMMPS metal units.', 'INVALID_MD_SIMULATION')
    boundary = value.get('boundaryType', 'p p p')
    if boundary not in {'p p p', 'p p f', 'p f p', 'f p p', 'p f f', 'f p f', 'f f p', 'f f f'}:
        raise ApiError(400, 'MD boundary conditions are invalid.', 'INVALID_MD_SIMULATION')
    raw_potential = value.get('potential')
    if not isinstance(raw_potential, dict):
        raise ApiError(422, 'Choose a verified potential before running MD.', 'MD_POTENTIAL_REQUIRED')
    potential_kind = raw_potential.get('kind')
    if potential_kind == 'builtin':
        if set(raw_potential) - {'kind', 'id', 'epsilonEv', 'sigmaAngstrom', 'cutoffAngstrom'} or raw_potential.get('id') != 'lj-generic':
            raise ApiError(422, 'The built-in potential is not supported.', 'MD_POTENTIAL_REQUIRED')
        sigma = md_finite_number(raw_potential.get('sigmaAngstrom', 3.4), 'Lennard-Jones sigma', 1e-06, 1000.0)
        potential = {'kind': 'builtin', 'id': 'lj-generic', 'epsilonEv': md_finite_number(raw_potential.get('epsilonEv', 0.0103), 'Lennard-Jones epsilon', 1e-12, 1000.0), 'sigmaAngstrom': sigma, 'cutoffAngstrom': md_finite_number(raw_potential.get('cutoffAngstrom', 8.5), 'Lennard-Jones cutoff', sigma, 10000.0)}
    elif potential_kind == 'project':
        if set(raw_potential) != {'kind', 'assetId'}:
            raise ApiError(400, 'Project potential reference is invalid.', 'INVALID_MD_SIMULATION')
        asset_id = clean_text(raw_potential.get('assetId'), 'Potential asset ID', minimum=1, maximum=96)
        if not re.fullmatch('[A-Za-z0-9_-]+', asset_id):
            raise ApiError(400, 'Project potential reference is invalid.', 'INVALID_MD_SIMULATION')
        potential = {'kind': 'project', 'assetId': asset_id}
    else:
        raise ApiError(422, 'Choose a verified potential before running MD.', 'MD_POTENTIAL_REQUIRED')
    raw_steps = value.get('steps', [])
    if not isinstance(raw_steps, list) or len(raw_steps) > 64:
        raise ApiError(400, 'MD workflow step list is invalid.', 'INVALID_MD_SIMULATION')
    steps = [normalize_md_workflow_step(item, index) for index, item in enumerate(raw_steps)]
    ids = [step['id'] for step in steps]
    if len(ids) != len(set(ids)):
        raise ApiError(400, 'MD workflow step IDs must be unique.', 'INVALID_MD_SIMULATION')
    has_legacy_manual = mode == 'manual' and isinstance(value.get('manualBody'), str) and bool(value['manualBody'].strip())
    if not any((step['enabled'] for step in steps)) and (not has_legacy_manual):
        raise ApiError(400, 'Enable at least one workflow step.', 'INVALID_MD_SIMULATION')
    raw_output = value.get('output', {})
    if not isinstance(raw_output, dict) or set(raw_output) - {'thermoFrequency', 'dumpFrequency', 'restartEverySteps', 'productionWindow'}:
        raise ApiError(400, 'MD workflow output settings are invalid.', 'INVALID_MD_SIMULATION')
    output = {'thermoFrequency': md_integer(raw_output.get('thermoFrequency', 100), 'Thermo interval', 1, 100000000, 'INVALID_MD_SIMULATION'), 'dumpFrequency': md_integer(raw_output.get('dumpFrequency', 500), 'Dump interval', 1, 100000000, 'INVALID_MD_SIMULATION')}
    if 'restartEverySteps' in raw_output:
        output['restartEverySteps'] = md_integer(raw_output['restartEverySteps'], 'Restart interval', 1, 100000000, 'INVALID_MD_SIMULATION')
    if 'productionWindow' in raw_output:
        window = raw_output['productionWindow']
        if not isinstance(window, dict) or set(window) != {'startPs', 'endPs'}:
            raise ApiError(400, 'Choose explicit physical production-window times.', 'INVALID_MD_SIMULATION')
        start_ps = md_finite_number(window['startPs'], 'Production start', 0, 1000000000000.0)
        end_ps = md_finite_number(window['endPs'], 'Production end', 0, 1000000000000.0)
        if end_ps <= start_ps:
            raise ApiError(400, 'Production end must follow production start.', 'INVALID_MD_SIMULATION')
        output['productionWindow'] = {'startPs': start_ps, 'endPs': end_ps}
    workflow: dict[str, Any] = {'version': 2, 'mode': mode, 'units': 'metal', 'boundaryType': boundary, 'potential': potential, 'steps': steps, 'output': output}
    if has_legacy_manual:
        workflow['manualBody'] = normalize_md_manual_body(value.get('manualBody'))
    encoded = json.dumps(workflow, separators=(',', ':'), sort_keys=True).encode('utf-8')
    if len(encoded) > MAX_MD_WORKFLOW_BYTES:
        raise ApiError(413, 'MD simulation workflow is too large.', 'MD_WORKFLOW_TOO_LARGE')
    return workflow

def normalize_md_potential_files(value: Any, family: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_MD_POTENTIAL_FILES:
        raise ApiError(400, 'Potential file list is invalid.', 'INVALID_MD_POTENTIAL')
    family_rules = MD_POTENTIAL_FAMILIES[family]
    if len(value) not in family_rules['fileCount']:
        raise ApiError(400, f'{family} requires a different number of files.', 'INVALID_MD_POTENTIAL')
    normalized: list[dict[str, Any]] = []
    filenames: set[str] = set()
    total_bytes = 0
    for raw in value:
        if not isinstance(raw, dict) or set(raw) - {'filename', 'sizeBytes', 'sha256', 'role'}:
            raise ApiError(400, 'Potential file metadata is invalid.', 'INVALID_MD_POTENTIAL')
        filename = safe_filename(raw.get('filename'))
        if filename in filenames:
            raise ApiError(400, 'Potential filenames must be unique.', 'INVALID_MD_POTENTIAL')
        filenames.add(filename)
        size_bytes = md_integer(raw.get('sizeBytes'), 'Potential file size', 1, MAX_MD_POTENTIAL_FILE_BYTES, 'INVALID_MD_POTENTIAL')
        total_bytes += size_bytes
        sha256 = clean_text(raw.get('sha256'), 'Potential SHA-256', minimum=64, maximum=64).lower()
        if not re.fullmatch('[a-f0-9]{64}', sha256):
            raise ApiError(400, 'Potential SHA-256 is invalid.', 'INVALID_MD_POTENTIAL')
        role = clean_text(raw.get('role', 'potential'), 'Potential file role', minimum=1, maximum=24).lower()
        if not re.fullmatch('[a-z][a-z0-9-]*', role):
            raise ApiError(400, 'Potential file role is invalid.', 'INVALID_MD_POTENTIAL')
        normalized.append({'filename': filename, 'sizeBytes': size_bytes, 'sha256': sha256, 'role': role})
    if total_bytes > MAX_MD_POTENTIAL_BYTES:
        raise ApiError(413, 'Potential files exceed the project asset limit.', 'MD_POTENTIAL_TOO_LARGE')
    expected_roles = family_rules['roles']
    if expected_roles is not None and {item['role'] for item in normalized} != expected_roles:
        raise ApiError(400, f'{family} requires exactly one library file and one parameter file.', 'INVALID_MD_POTENTIAL')
    if expected_roles is None and any((item['role'] != 'potential' for item in normalized)):
        raise ApiError(400, f'{family} requires a potential file role.', 'INVALID_MD_POTENTIAL')
    return normalized

def normalize_worker_runtime_manifest(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ApiError(400, 'Worker runtime manifest is invalid.', 'INVALID_WORKER_RUNTIME')
    schema_version = value.get('schemaVersion')
    allowed = {'schemaVersion', 'executionMode', 'architecture', 'lammpsVersion', 'packages', 'pairStyles', 'manualInput'}
    if schema_version == 2:
        allowed.update({'styles', 'workflowVersions', 'runnerProtocol'})
    if schema_version not in {1, 2} or set(value) - allowed:
        raise ApiError(400, 'Worker runtime manifest version is invalid.', 'INVALID_WORKER_RUNTIME')
    execution_mode = value.get('executionMode')
    if execution_mode not in {'docker', 'personal-container', 'native', 'native-sandbox'}:
        raise ApiError(400, 'Worker execution mode is invalid.', 'INVALID_WORKER_RUNTIME')
    architecture = clean_text(value.get('architecture'), 'Worker architecture', minimum=1, maximum=32)
    lammps_version = clean_text(value.get('lammpsVersion'), 'LAMMPS version', minimum=1, maximum=160)
    packages = value.get('packages', [])
    if not isinstance(packages, list) or len(packages) > 256:
        raise ApiError(400, 'Worker LAMMPS package list is invalid.', 'INVALID_WORKER_RUNTIME')
    normalized_packages: list[str] = []
    for package in packages:
        name = clean_text(package, 'LAMMPS package', minimum=1, maximum=40).upper()
        if not re.fullmatch('[A-Z0-9_-]+', name):
            raise ApiError(400, 'Worker LAMMPS package name is invalid.', 'INVALID_WORKER_RUNTIME')
        if name not in normalized_packages:
            normalized_packages.append(name)
    pair_styles = value.get('pairStyles', [])
    pair_style_limit = 2048 if schema_version == 2 else 1024
    if not isinstance(pair_styles, list) or len(pair_styles) > pair_style_limit:
        raise ApiError(400, 'Worker LAMMPS pair-style list is invalid.', 'INVALID_WORKER_RUNTIME')
    normalized_pair_styles: list[str] = []
    for pair_style in pair_styles:
        name = clean_text(pair_style, 'LAMMPS pair style', minimum=1, maximum=80).lower()
        if not re.fullmatch('[a-z0-9][a-z0-9_+./-]*', name):
            raise ApiError(400, 'Worker LAMMPS pair style is invalid.', 'INVALID_WORKER_RUNTIME')
        if name not in normalized_pair_styles:
            normalized_pair_styles.append(name)
    manual_input = value.get('manualInput')
    if not isinstance(manual_input, bool) or (manual_input and execution_mode == 'native'):
        raise ApiError(400, 'Worker manual-input capability is invalid.', 'INVALID_WORKER_RUNTIME')
    normalized: dict[str, Any] = {'schemaVersion': schema_version, 'executionMode': execution_mode, 'architecture': architecture, 'lammpsVersion': lammps_version, 'packages': sorted(normalized_packages), 'pairStyles': sorted(normalized_pair_styles), 'manualInput': manual_input}
    if schema_version == 1:
        return normalized
    raw_versions = value.get('workflowVersions')
    if not isinstance(raw_versions, list) or not raw_versions or len(raw_versions) > 8 or any((isinstance(version, bool) or not isinstance(version, int) or (not 1 <= version <= 100) for version in raw_versions)):
        raise ApiError(400, 'Worker workflow-version list is invalid.', 'INVALID_WORKER_RUNTIME')
    runner_protocol = value.get('runnerProtocol')
    if isinstance(runner_protocol, bool) or not isinstance(runner_protocol, int) or (not 1 <= runner_protocol <= 100):
        raise ApiError(400, 'Worker runner protocol is invalid.', 'INVALID_WORKER_RUNTIME')
    raw_styles = value.get('styles')
    if not isinstance(raw_styles, dict) or not MD_REQUIRED_STYLE_INVENTORIES.issubset(raw_styles) or len(raw_styles) > 32:
        raise ApiError(400, 'Worker LAMMPS style inventory is invalid.', 'INVALID_WORKER_RUNTIME')
    normalized_styles: dict[str, list[str]] = {}
    for raw_category, raw_names in raw_styles.items():
        category = clean_text(raw_category, 'LAMMPS style category', minimum=1, maximum=32).lower()
        if not re.fullmatch('[a-z][a-z0-9-]*', category) or category in normalized_styles:
            raise ApiError(400, 'Worker LAMMPS style category is invalid.', 'INVALID_WORKER_RUNTIME')
        if not isinstance(raw_names, list) or len(raw_names) > 2048:
            raise ApiError(400, 'Worker LAMMPS style list is invalid.', 'INVALID_WORKER_RUNTIME')
        names: list[str] = []
        for raw_name in raw_names:
            name = clean_text(raw_name, 'LAMMPS style', minimum=1, maximum=80).lower()
            if not re.fullmatch('[a-z0-9][a-z0-9_+./-]*', name):
                raise ApiError(400, 'Worker LAMMPS style name is invalid.', 'INVALID_WORKER_RUNTIME')
            if name not in names:
                names.append(name)
        normalized_styles[category] = sorted(names)
    if normalized_styles.get('pair') != sorted(normalized_pair_styles):
        raise ApiError(400, 'Worker pair-style inventories do not match.', 'INVALID_WORKER_RUNTIME')
    normalized.update({'styles': dict(sorted(normalized_styles.items())), 'workflowVersions': sorted(set(raw_versions)), 'runnerProtocol': runner_protocol})
    return normalized

def normalize_worker_telemetry(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {'cpuPercent', 'availableMemoryBytes', 'diskFreeBytes', 'diskTotalBytes', 'runtime', 'qeImageDigest', 'mdImageDigest'}:
        raise ApiError(400, 'Worker telemetry is invalid.', 'INVALID_WORKER_TELEMETRY')
    runtime = value.get('runtime')
    if runtime not in {'docker', 'native'}:
        raise ApiError(400, 'Worker runtime is invalid.', 'INVALID_WORKER_TELEMETRY')
    result: dict[str, Any] = {'runtime': runtime}
    for name in ('availableMemoryBytes', 'diskFreeBytes', 'diskTotalBytes'):
        amount = value.get(name)
        if amount is not None and (isinstance(amount, bool) or not isinstance(amount, int) or (not 0 <= amount <= 10 ** 16)):
            raise ApiError(400, 'Worker capacity measurement is invalid.', 'INVALID_WORKER_TELEMETRY')
        result[name] = amount
    if result['diskFreeBytes'] is not None and result['diskTotalBytes'] is not None and (result['diskFreeBytes'] > result['diskTotalBytes']):
        raise ApiError(400, 'Worker disk measurement is invalid.', 'INVALID_WORKER_TELEMETRY')
    cpu = value.get('cpuPercent')
    if cpu is not None and (isinstance(cpu, bool) or not isinstance(cpu, (int, float)) or (not 0 <= cpu <= 100) or (not math.isfinite(cpu))):
        raise ApiError(400, 'Worker CPU measurement is invalid.', 'INVALID_WORKER_TELEMETRY')
    result['cpuPercent'] = None if cpu is None else round(cpu, 1)
    for name in ('qeImageDigest', 'mdImageDigest'):
        digest = value.get(name)
        if digest is not None and (not isinstance(digest, str) or not re.fullmatch('sha256:[a-f0-9]{64}', digest)):
            raise ApiError(400, 'Worker image digest is invalid.', 'INVALID_WORKER_TELEMETRY')
        result[name] = digest
    return result

def md_runtime_manifest_fingerprint(manifest: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(json_safe(manifest), separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest()

def _md_runtime_style_requirements(kind: str, params: dict[str, Any]) -> dict[str, set[str]]:
    result = {category: set(names) for category, names in MD_STEP_RUNTIME_STYLES.get(kind, {}).items()}
    if kind == 'minimization':
        result['minimize'] = {str(params.get('style') or 'cg')}
    return result

def _md_directive_runtime_requirements(directive: dict[str, Any]) -> tuple[dict[str, set[str]], set[str]]:
    kind = str(directive.get('kind') or '')
    params = directive.get('params') if isinstance(directive.get('params'), dict) else {}
    styles: dict[str, set[str]] = {}
    packages: set[str] = set()
    if kind == 'minimize':
        styles['minimize'] = {str(params.get('style') or 'cg')}
    elif kind == 'thermostat':
        style = str(params.get('style') or 'nvt')
        if style == 'langevin':
            styles['fix'] = {'nve', 'langevin'}
        elif style == 'temp-berendsen':
            styles['fix'] = {'nve', 'temp/berendsen'}
        else:
            styles['fix'] = {style}
    elif kind == 'barostat':
        style = str(params.get('style') or 'npt')
        styles['fix'] = {'nve', 'press/berendsen'} if style == 'press-berendsen' else {style}
    elif kind == 'deform':
        styles['fix'] = {'deform', 'nvt'}
    elif kind == 'analysis':
        style = str(params.get('style') or '')
        compute_style = {'coordination': 'coord/atom', 'cna': 'cna/atom', 'centrosymmetry': 'centro/atom', 'voronoi': 'voronoi/atom', 'stress-atom': 'stress/atom', 'pe-atom': 'pe/atom', 'ke-atom': 'ke/atom'}.get(style, style)
        if compute_style:
            styles['compute'] = {compute_style}
        if style == 'rdf':
            styles['fix'] = {'ave/time'}
        if style == 'voronoi':
            packages.add('VORONOI')
    return (styles, packages)

def md_workflow_runtime_requirements(workflow: dict[str, Any], required_pair_style: str, workflow_version: int) -> dict[str, Any]:
    styles: dict[str, set[str]] = {'atom': {'atomic'}, 'integrate': {'verlet'}, 'pair': {required_pair_style}, 'dump': {'custom'}}
    packages: set[str] = set()
    enabled_kinds: set[str] = set()
    for step in workflow.get('steps') or []:
        if not isinstance(step, dict) or not step.get('enabled'):
            continue
        kind = str(step.get('kind') or '')
        enabled_kinds.add(kind)
        for category, names in _md_runtime_style_requirements(kind, step.get('params') if isinstance(step.get('params'), dict) else {}).items():
            styles.setdefault(category, set()).update(names)
        packages.update(MD_STEP_RUNTIME_PACKAGES.get(kind, set()))
        for directive in step.get('directives') or []:
            if not isinstance(directive, dict) or not directive.get('enabled'):
                continue
            directive_styles, directive_packages = _md_directive_runtime_requirements(directive)
            for category, names in directive_styles.items():
                styles.setdefault(category, set()).update(names)
            packages.update(directive_packages)
    manual_input = workflow.get('mode') == 'manual' and bool(workflow.get('manualBody'))
    if manual_input:
        for raw_line in str(workflow['manualBody']).splitlines():
            tokens = raw_line.split('#', 1)[0].split()
            if len(tokens) >= 4 and tokens[0].lower() in {'fix', 'compute'}:
                styles.setdefault(tokens[0].lower(), set()).add(tokens[3].lower())
            elif len(tokens) >= 2 and tokens[0].lower() == 'min_style':
                styles.setdefault('minimize', set()).add(tokens[1].lower())
            elif len(tokens) >= 2 and tokens[0].lower() == 'run_style':
                styles.setdefault('integrate', set()).add(tokens[1].lower())
    minimum_schema = 1
    if enabled_kinds - MD_LEGACY_WORKFLOW_STEP_KINDS:
        minimum_schema = 2
    for category, names in styles.items():
        if category == 'pair':
            continue
        if names - MD_LEGACY_RUNTIME_STYLES.get(category, set()):
            minimum_schema = 2
    if packages:
        minimum_schema = 2
    return {'schemaVersion': 1, 'runnerProtocol': MD_RUNNER_PROTOCOL, 'workflowVersion': workflow_version, 'minimumManifestSchemaVersion': minimum_schema, 'styles': {category: sorted(names) for category, names in sorted(styles.items()) if names}, 'packages': sorted(packages), 'manualInput': manual_input}

def md_runtime_requirement_failure(manifest: dict[str, Any] | None, requirements: dict[str, Any]) -> tuple[str, str] | None:
    if not isinstance(manifest, dict):
        return ('MD_RUNTIME_REQUIRED', 'The worker did not report its LAMMPS runtime manifest.')
    schema_version = int(manifest.get('schemaVersion') or 0)
    minimum_schema = int(requirements.get('minimumManifestSchemaVersion') or 1)
    if schema_version < minimum_schema:
        return ('MD_RUNTIME_REQUIRED', 'Update and restart personal compute to report the exact LAMMPS style inventory.')
    workflow_version = int(requirements.get('workflowVersion') or 0)
    workflow_versions = set(manifest.get('workflowVersions') or []) if schema_version >= 2 else set(MD_WORKFLOW_VERSIONS)
    if workflow_version not in workflow_versions:
        return ('MD_WORKFLOW_VERSION_REQUIRED', f'The connected MD runner does not support workflow version {workflow_version}.')
    runner_protocol = int(manifest.get('runnerProtocol') or MD_RUNNER_PROTOCOL) if schema_version == 1 else manifest.get('runnerProtocol')
    if runner_protocol != requirements.get('runnerProtocol'):
        return ('MD_RUNNER_PROTOCOL_REQUIRED', 'The connected MD runner protocol is not compatible with this workflow.')
    required_styles = requirements.get('styles') if isinstance(requirements.get('styles'), dict) else {}
    pair_styles = set(manifest.get('pairStyles') or [])
    for pair_style in required_styles.get('pair') or []:
        if pair_style not in pair_styles:
            return ('MD_PAIR_STYLE_REQUIRED', f'The connected LAMMPS runtime does not provide pair_style {pair_style}.')
    if requirements.get('manualInput') and manifest.get('manualInput') is not True:
        return ('MD_MANUAL_RUNTIME_REQUIRED', 'Legacy LAMMPS text input requires the current container personal-compute runtime.')
    if schema_version >= 2:
        inventories = manifest.get('styles') if isinstance(manifest.get('styles'), dict) else {}
        for category, names in required_styles.items():
            missing = sorted(set(names) - set(inventories.get(category) or []))
            if missing:
                return ('MD_RUNTIME_STYLE_REQUIRED', f'The connected LAMMPS runtime does not provide {category} style {missing[0]}.')
        missing_packages = sorted(set(requirements.get('packages') or []) - set(manifest.get('packages') or []))
        if missing_packages:
            return ('MD_RUNTIME_PACKAGE_REQUIRED', f'The connected LAMMPS runtime does not provide package {missing_packages[0]}.')
    return None

def md_supported_workflow_step_kinds(manifest: dict[str, Any] | None) -> list[str]:
    if not isinstance(manifest, dict):
        return []
    supported: list[str] = []
    for kind in MD_WORKFLOW_STEP_KINDS:
        params = {'style': 'cg'} if kind == 'minimization' else {}
        requirements = md_workflow_runtime_requirements({'mode': 'simple', 'steps': [{'kind': kind, 'enabled': True, 'params': params}]}, str((manifest.get('pairStyles') or ['__missing__'])[0]), 2)
        requirements['styles'].pop('pair', None)
        if md_runtime_requirement_failure(manifest, requirements) is None:
            supported.append(kind)
    return sorted(supported)

def md_worker_can_claim_simulation(item: dict[str, Any], worker_id: str, runtime_manifest: dict[str, Any] | None, *, allow_owner_rebind: bool=False) -> bool:
    requirements = item.get('runtimeRequirements')
    if not isinstance(requirements, dict):
        return True
    binding = item.get('runtimeBinding')
    if isinstance(binding, dict):
        if binding.get('workerId') != worker_id and (not allow_owner_rebind) or runtime_manifest is None:
            return False
    if runtime_manifest is None:
        return int(requirements.get('minimumManifestSchemaVersion') or 1) == 1 and requirements.get('manualInput') is not True
    if md_runtime_requirement_failure(runtime_manifest, requirements) is not None:
        return False
    if isinstance(binding, dict):
        expected = binding.get('manifestSha256')
        if not isinstance(expected, str) or not hmac.compare_digest(expected, md_runtime_manifest_fingerprint(runtime_manifest)):
            return False
    return True

def public_md_potential(item: dict[str, Any]) -> dict[str, Any]:
    result = public_item(item)
    raw_files = result.get('files')
    if isinstance(raw_files, list):
        result['files'] = [{key: value for key, value in file_item.items() if key != 'objectKey'} for file_item in raw_files if isinstance(file_item, dict)]
    return result

def md_parameter_value(name: str, value: Any) -> Any:
    if name in {'matrix', 'miller'}:
        size = 9 if name == 'matrix' else 3
        bound = 512 if name == 'matrix' else 12
        if not isinstance(value, list) or len(value) != size or any((isinstance(v, bool) or not isinstance(v, (int, float)) or (not math.isfinite(v)) or (int(v) != v) or (abs(v) > bound) for v in value)):
            raise ApiError(400, 'Geometry needs a bounded integer matrix or Miller vector.', 'INVALID_MD_PIPELINE')
        return [int(v) for v in value]
    if name in {'layers', 'termination'}:
        return md_integer(value, name, 1 if name == 'layers' else 0, 256 if name == 'layers' else 100000)
    if name == 'vacuumAngstrom':
        if isinstance(value, bool) or not isinstance(value, (int, float)) or (not math.isfinite(value)) or (not 0 < value <= 1000):
            raise ApiError(400, 'Use positive vacuum up to 1000 Å.', 'INVALID_MD_PIPELINE')
        return value
    if name in {'repeat', 'normal'}:
        if not isinstance(value, list) or len(value) != 3:
            raise ApiError(400, f'{name} must contain three values.', 'INVALID_MD_PIPELINE')
        if name == 'repeat':
            return [md_integer(item, 'Repeat count', 1, 8) for item in value]
        if any((isinstance(item, bool) or not isinstance(item, (int, float)) or (not math.isfinite(float(item))) for item in value)):
            raise ApiError(400, 'Slice normal must contain finite numbers.', 'INVALID_MD_PIPELINE')
        normalized = [float(item) for item in value]
        if math.sqrt(sum((item * item for item in normalized))) < 1e-12:
            raise ApiError(400, 'Slice normal cannot be zero.', 'INVALID_MD_PIPELINE')
        return normalized
    if name in {'bins', 'neighbors', 'referenceFrame', 'numX', 'numY', 'numZ'}:
        limits = {'bins': (10, 500), 'neighbors': (2, 32), 'referenceFrame': (0, 9999), 'numX': (1, 8), 'numY': (1, 8), 'numZ': (1, 8)}
        minimum, maximum = limits[name]
        normalized = md_integer(value, name, minimum, maximum)
        if name == 'neighbors' and normalized % 2:
            raise ApiError(400, 'Centrosymmetry neighbors must be even.', 'INVALID_MD_PIPELINE')
        return normalized
    if name in {'cutoff', 'radius', 'rmsd', 'rmsdCutoff', 'distance'}:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or (not math.isfinite(float(value))):
            raise ApiError(400, f'{name} must be a finite number.', 'INVALID_MD_PIPELINE')
        normalized = float(value)
        maximum = 1 if name in {'rmsd', 'rmsdCutoff'} else 20 if name == 'radius' else 30
        if name != 'distance' and (not 0 < normalized <= maximum):
            raise ApiError(400, f'{name} is outside the supported range.', 'INVALID_MD_PIPELINE')
        if name == 'distance' and abs(normalized) > 1000000000:
            raise ApiError(400, 'Slice distance is outside the supported range.', 'INVALID_MD_PIPELINE')
        return normalized
    if name == 'reverse':
        if not isinstance(value, bool):
            raise ApiError(400, 'Slice reverse must be true or false.', 'INVALID_MD_PIPELINE')
        return value
    if name == 'action':
        if value not in {'select', 'remove'}:
            raise ApiError(400, 'Expression action is invalid.', 'INVALID_MD_PIPELINE')
        return value
    if name == 'mode':
        if value not in {'adaptive', 'fixed'}:
            raise ApiError(400, 'CNA mode is invalid.', 'INVALID_MD_PIPELINE')
        return value
    if name in {'lattice', 'crystalStructure'}:
        if value not in {'FCC', 'BCC', 'HCP', 'CUBIC_DIAMOND', 'HEX_DIAMOND', 'CubicDiamond', 'HexagonalDiamond'}:
            raise ApiError(400, 'DXA crystal structure is invalid.', 'INVALID_MD_PIPELINE')
        return value
    if name == 'expression':
        if not isinstance(value, str) or not value.strip() or len(value) > 500 or any((ord(char) < 32 for char in value)):
            raise ApiError(400, 'Expression is invalid.', 'INVALID_MD_PIPELINE')
        return value.strip()
    raise ApiError(400, 'Modifier parameter is not supported.', 'INVALID_MD_PIPELINE')

def normalize_md_pipeline(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {'version', 'modifiers', 'typeMap', 'periodic', 'frameRange'}:
        raise ApiError(400, 'MD pipeline is invalid.', 'INVALID_MD_PIPELINE')
    if value.get('version') != 1:
        raise ApiError(400, 'MD pipeline version must be 1.', 'INVALID_MD_PIPELINE')
    raw_modifiers = value.get('modifiers', [])
    if not isinstance(raw_modifiers, list) or len(raw_modifiers) > 24:
        raise ApiError(400, 'MD pipeline supports at most 24 modifiers.', 'INVALID_MD_PIPELINE')
    modifiers: list[dict[str, Any]] = []
    modifier_ids: set[str] = set()
    for index, raw_modifier in enumerate(raw_modifiers):
        if not isinstance(raw_modifier, dict) or set(raw_modifier) - {'id', 'type', 'enabled', 'params'}:
            raise ApiError(400, 'MD modifier is invalid.', 'INVALID_MD_PIPELINE')
        modifier_type = raw_modifier.get('type')
        if modifier_type not in MD_MODIFIER_TYPES:
            raise ApiError(400, 'MD modifier type is not supported.', 'INVALID_MD_PIPELINE')
        modifier_id = clean_text(raw_modifier.get('id', f'modifier-{index + 1}'), 'Modifier ID', minimum=1, maximum=64)
        if not re.fullmatch('[A-Za-z0-9_-]+', modifier_id) or modifier_id in modifier_ids:
            raise ApiError(400, 'MD modifier IDs must be unique and URL-safe.', 'INVALID_MD_PIPELINE')
        modifier_ids.add(modifier_id)
        enabled = raw_modifier.get('enabled', True)
        if not isinstance(enabled, bool):
            raise ApiError(400, 'Modifier enabled must be true or false.', 'INVALID_MD_PIPELINE')
        raw_params = raw_modifier.get('params', {})
        if not isinstance(raw_params, dict) or set(raw_params) - MD_MODIFIER_PARAMETERS[modifier_type]:
            raise ApiError(400, 'MD modifier parameters are invalid.', 'INVALID_MD_PIPELINE')
        params = {name: md_parameter_value(name, parameter) for name, parameter in raw_params.items()}
        if modifier_type == 'ptm' and 'rmsdCutoff' in params:
            if 'rmsd' in params and params['rmsd'] != params['rmsdCutoff']:
                raise ApiError(400, 'PTM RMSD parameters conflict.', 'INVALID_MD_PIPELINE')
            params['rmsd'] = params.pop('rmsdCutoff')
        if modifier_type == 'dxa' and 'crystalStructure' in params:
            if 'lattice' in params and params['lattice'] != params['crystalStructure']:
                raise ApiError(400, 'DXA lattice parameters conflict.', 'INVALID_MD_PIPELINE')
            lattice = params.pop('crystalStructure')
            params['lattice'] = {'CubicDiamond': 'CUBIC_DIAMOND', 'HexagonalDiamond': 'HEX_DIAMOND'}.get(lattice, lattice)
        if modifier_type == 'replicate' and any((name in params for name in ('numX', 'numY', 'numZ'))):
            repeats = [params.pop('numX', 1), params.pop('numY', 1), params.pop('numZ', 1)]
            if 'repeat' in params and params['repeat'] != repeats:
                raise ApiError(400, 'Replication parameters conflict.', 'INVALID_MD_PIPELINE')
            params['repeat'] = repeats
        if modifier_type == 'bonds' and float(params.get('cutoff', 1)) > 20:
            raise ApiError(400, 'Bond cutoff is outside the supported range.', 'INVALID_MD_PIPELINE')
        modifiers.append({'id': modifier_id, 'type': modifier_type, 'enabled': enabled, 'params': params})
    raw_type_map = value.get('typeMap', {})
    if not isinstance(raw_type_map, dict) or len(raw_type_map) > 256:
        raise ApiError(400, 'MD type map is invalid.', 'INVALID_MD_PIPELINE')
    type_map: dict[str, str] = {}
    for raw_type, raw_element in raw_type_map.items():
        type_id = str(raw_type)
        if not re.fullmatch('[A-Za-z0-9_.+-]{1,32}', type_id):
            raise ApiError(400, 'MD type map key is invalid.', 'INVALID_MD_PIPELINE')
        if not isinstance(raw_element, str) or not re.fullmatch('[A-Z][a-z]{0,2}', raw_element):
            raise ApiError(400, 'MD type map values must be element symbols.', 'INVALID_MD_PIPELINE')
        type_map[type_id] = raw_element
    periodic = value.get('periodic', [True, True, True])
    if not isinstance(periodic, list) or len(periodic) != 3 or (not all((isinstance(item, bool) for item in periodic))):
        raise ApiError(400, 'Periodic boundaries must contain three booleans.', 'INVALID_MD_PIPELINE')
    raw_range = value.get('frameRange', {'start': 0, 'stop': None, 'stride': 1})
    if not isinstance(raw_range, dict) or set(raw_range) - {'start', 'stop', 'stride'}:
        raise ApiError(400, 'MD frame range is invalid.', 'INVALID_MD_PIPELINE')
    start = md_integer(raw_range.get('start', 0), 'Frame start', 0, 9999)
    stop_value = raw_range.get('stop')
    stop = None if stop_value is None else md_integer(stop_value, 'Frame stop', start + 1, 10000)
    stride = md_integer(raw_range.get('stride', 1), 'Frame stride', 1, 10000)
    if stop is not None and (stop - start + stride - 1) // stride > 10000:
        raise ApiError(400, 'MD frame range selects too many frames.', 'INVALID_MD_PIPELINE')
    pipeline = {'version': 1, 'modifiers': modifiers, 'typeMap': type_map, 'periodic': list(periodic), 'frameRange': {'start': start, 'stop': stop, 'stride': stride}}
    if len(json.dumps(pipeline, separators=(',', ':')).encode('utf-8')) > MAX_MD_PIPELINE_BYTES:
        raise ApiError(413, 'MD pipeline is too large.', 'MD_PIPELINE_TOO_LARGE')
    return pipeline

def normalize_md_studio_settings(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {'version', 'pipeline', 'display', 'simulation'}:
        raise ApiError(400, 'MD Lab settings are invalid.', 'INVALID_MD_STUDIO_SETTINGS')
    version = value.get('version')
    if version not in {1, 2}:
        raise ApiError(400, 'MD Lab settings version is not supported.', 'INVALID_MD_STUDIO_SETTINGS')
    if version == 1 and set(value) != {'version', 'pipeline', 'display'}:
        raise ApiError(400, 'MD Lab version 1 settings are invalid.', 'INVALID_MD_STUDIO_SETTINGS')
    pipeline = normalize_md_pipeline(value.get('pipeline'))
    display = value.get('display')
    allowed_display = {'colorBy', 'palette', 'atomScale', 'showCell', 'showBonds', 'hideBulk', 'timeStepPs', 'fps', 'loop', 'periodicOverride'}
    if not isinstance(display, dict) or set(display) != allowed_display:
        raise ApiError(400, 'MD Lab display settings are invalid.', 'INVALID_MD_STUDIO_SETTINGS')
    color_by = clean_text(display.get('colorBy'), 'Color property', minimum=1, maximum=120)
    palette = display.get('palette')
    if palette not in {'viridis', 'coolwarm', 'turbo', 'jet'}:
        raise ApiError(400, 'MD Lab color palette is invalid.', 'INVALID_MD_STUDIO_SETTINGS')
    atom_scale = display.get('atomScale')
    if isinstance(atom_scale, bool) or not isinstance(atom_scale, (int, float)) or (not math.isfinite(float(atom_scale))) or (not 0.1 <= float(atom_scale) <= 3):
        raise ApiError(400, 'MD Lab atom scale is invalid.', 'INVALID_MD_STUDIO_SETTINGS')
    for name in ('showCell', 'showBonds', 'hideBulk', 'loop'):
        if not isinstance(display.get(name), bool):
            raise ApiError(400, f'MD Lab {name} must be true or false.', 'INVALID_MD_STUDIO_SETTINGS')
    time_step = display.get('timeStepPs')
    if time_step is not None and (isinstance(time_step, bool) or not isinstance(time_step, (int, float)) or (not math.isfinite(float(time_step))) or (not 0 < float(time_step) <= 1000000)):
        raise ApiError(400, 'MD Lab time step is invalid.', 'INVALID_MD_STUDIO_SETTINGS')
    fps = md_integer(display.get('fps'), 'Playback speed', 1, 120, 'INVALID_MD_STUDIO_SETTINGS')
    periodic_override = display.get('periodicOverride')
    if periodic_override is not None and (not isinstance(periodic_override, list) or len(periodic_override) != 3 or (not all((isinstance(item, bool) for item in periodic_override)))):
        raise ApiError(400, 'MD Lab periodic override is invalid.', 'INVALID_MD_STUDIO_SETTINGS')
    normalized_display = {'colorBy': color_by, 'palette': palette, 'atomScale': float(atom_scale), 'showCell': display['showCell'], 'showBonds': display['showBonds'], 'hideBulk': display['hideBulk'], 'timeStepPs': None if time_step is None else float(time_step), 'fps': fps, 'loop': display['loop'], 'periodicOverride': None if periodic_override is None else list(periodic_override)}
    simulation = None
    if version == 2 and value.get('simulation') is not None:
        simulation = normalize_md_simulation_workflow(value.get('simulation'))
    return {'version': 2, 'pipeline': pipeline, 'display': normalized_display, 'simulation': simulation}

class PhyniteApi:

    def __init__(self, services: MetadataServices):
        self.services = services
        self.worker_owner = None

    def is_developer(self, claims):
        return False

    def record_research_event(self, owner: str, project_id: str, payload: dict[str, Any]) -> None:
        """Best-effort ledger write; a telemetry failure must not change a run."""
        try:
            from backend.local_api.domain.research_ledger import append_research_event
            append_research_event(self.services, owner, project_id, payload, allow_server=True)
        except Exception:
            logging.getLogger(__name__).exception("Research ledger write failed for %s", project_id)

    def handle(self, event: dict[str, Any]) -> dict[str, Any]:
        method, path = route_details(event)
        if path.startswith(('/public/', '/internal/', '/developer/', '/cloud-worker/', '/paid-worker/', '/ai-worker/')):
            raise ApiError(404, 'This hosted endpoint is not part of the local workspace.', 'NOT_FOUND')
        if path == '/worker/v1/session' and method == 'POST':
            self.require_local_worker(event)
            return response(200, {'status': 'connected'})
        if path == WORKER_CLAIM_PATH and method == 'POST':
            self.require_local_worker(event)
            return self.claim_local_job(parse_body(event))
        worker_match = WORKER_JOB_PATH.fullmatch(path)
        if worker_match and method == 'POST':
            self.require_local_worker(event)
            calculation_id, action = worker_match.groups()
            payload = parse_body(event)
            if action == 'heartbeat':
                return self.heartbeat_local_job(calculation_id, payload)
            if action == 'uploads':
                return self.create_local_upload_urls(calculation_id, payload)
            return self.complete_local_job(calculation_id, payload)
        claims = request_claims(event)
        user_id = claims['sub']
        if path == '/v1/me' and method == 'GET':
            return response(200, {'user': {'id': user_id, 'email': None, 'name': None, 'pilotAccess': False}})
        if path == '/v1/account' or path.startswith('/v1/account/'):
            return AccountApi(self.services).handle(user_id, method, path, parse_body(event) if method in {'POST', 'PUT'} else {}, event.get('queryStringParameters') or {})
        research_match = DOCUMENT_PATH.fullmatch(path)
        if research_match:
            return ResearchDocuments(self.services).handle(user_id, method, *research_match.groups(), event.get('queryStringParameters') or {}, parse_body(event) if method == 'PUT' else {})
        retained_match = re.fullmatch('/v1/calculations/([A-Za-z0-9_-]+)/research-data', path)
        if retained_match and method == 'GET':
            item = require_owner_item(self.services, user_id, 'CALCULATION', retained_match.group(1), 'CALCULATION_NOT_FOUND')
            if item.get('status') != 'COMPLETED' or not item.get('outputPrefix'):
                raise ApiError(409, 'Complete the calculation before opening research data.', 'RESEARCH_UNAVAILABLE')
            return response(200, {'url': local_artifact_url(self.services, item, 'research/dataset.json') if not retained_locally(self.services, item) and item.get('computeBackend') in {CLOUD_BACKEND, PAID_BACKEND, PILOT_FLEET_BACKEND} else self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': f"{item['outputPrefix']}/research/dataset.json"}, ExpiresIn=900)})
        if path == COMPUTE_STATUS_PATH and method == 'GET':
            return self.get_compute_status(user_id)
        if path == MD_RUNTIME_MANIFEST_PATH and method == 'GET':
            return self.get_md_runtime_manifest(user_id)
        if path == WORKSPACE_PATH:
            if method == 'GET':
                return self.get_workspace(user_id)
            if method == 'PUT':
                return self.put_workspace(user_id, parse_body(event))
        if path == PROFILE_PATH:
            if method == 'GET':
                return self.get_profile(user_id)
            if method == 'PUT':
                return self.put_profile(user_id, parse_body(event))
            if method == 'PATCH':
                return self.patch_profile(user_id, parse_body(event))
        if path.startswith('/v1/ai/'):
            from backend.local_api.domain.ai_workspace import AiWorkspace
            return AiWorkspace(self).handle(user_id, method, path, parse_body(event) if method != 'GET' else {}, event.get('queryStringParameters') or {})
        if path == '/v1/navigation-preferences/v2':
            from backend.local_api.domain.project_navigation import ProjectNavigationApi
            if method == 'GET':
                return ProjectNavigationApi(self).get(user_id)
            if method == 'PUT':
                return ProjectNavigationApi(self).put(user_id, parse_body(event))
        if path == '/v1/navigation-preferences':
            from backend.local_api.domain.navigation_preferences import NavigationPreferencesApi
            navigation = NavigationPreferencesApi(self.services)
            if method == 'GET':
                return navigation.get(user_id)
            if method == 'PUT':
                return navigation.put(user_id, parse_body(event))
        from backend.local_api.domain.project_workflow import WORKFLOW_PATH, ProjectWorkflowApi
        workflow_input = re.fullmatch('/v1/projects/([A-Za-z0-9_-]+)/workflow/inputs/([A-Za-z0-9_-]+)', path)
        if workflow_input and method == 'GET':
            return response(200, ProjectWorkflowApi(self).input_document(user_id, *workflow_input.groups()))
        md_dataset_match = re.fullmatch('/v1/projects/([A-Za-z0-9_-]+)/workflow-datasets/([A-Za-z0-9_-]+)', path)
        if md_dataset_match and method == 'GET':
            require_project(self.services, user_id, md_dataset_match.group(1))
            from backend.local_api.domain.workflow_md_results import numerical_datasets
            return response(200, {'datasets': numerical_datasets(self.services, user_id, *md_dataset_match.groups())})
        if path == '/v1/project-migrations' and method == 'POST':
            return response(200, ProjectWorkflowApi(self).migrate_identity(user_id, parse_body(event)))
        workflow_match = WORKFLOW_PATH.fullmatch(path)
        if workflow_match:
            return ProjectWorkflowApi(self).handle(user_id, *workflow_match.groups(), method, parse_body(event) if method in {'PUT', 'POST'} else {})
        if method == 'GET' and path == '/v1/materials':
            params = event.get('queryStringParameters') or {}
            query = str(params.get('q')).strip()
            try:
                limit = int(20)
            except (TypeError, ValueError):
                limit = 20
            materials = fetch_materials_project(self.services, query, limit)
            return response(200, {'materials': materials, 'query': query, 'source': 'Materials Project', 'retrievedAt': utc_now()})
        if path == '/v1/projects':
            if method == 'GET':
                items = sorted(self.services.list_owner_items(user_id, 'PROJECT'), key=lambda item: item.get('updatedAt', ''), reverse=True)
                tags_by_project = {str(item.get('id')): normalize_project_tags(item.get('tags')) for item in items}
                md_trajectory_counts = {project_id: 0 for project_id in tags_by_project}
                for item in items:
                    if item.get('description') == 'Molecular dynamics trajectories' and 'MD' not in tags_by_project[str(item.get('id'))]:
                        tags_by_project[str(item.get('id'))].append('MD')
                for trajectory in self.services.list_owner_items(user_id, 'MD_TRAJECTORY'):
                    project_id = str(trajectory.get('projectId'))
                    if project_id in tags_by_project:
                        tags_by_project[project_id] = md_project_tags(tags_by_project[project_id], str(trajectory.get('format')))
                        md_trajectory_counts[project_id] += 1
                for calculation in self.services.list_owner_items(user_id, 'CALCULATION'):
                    project_id = str(calculation.get('projectId'))
                    if project_id in tags_by_project and 'QE' not in tags_by_project[project_id]:
                        tags_by_project[project_id].append('QE')
                items = [{**item, 'tags': tags_by_project[str(item.get('id'))], 'mdTrajectoryCount': md_trajectory_counts[str(item.get('id'))]} for item in items if item.get('executionOnly') is not True and item.get('trashed') is not True]
                return response(200, {'projects': [public_item(item) for item in items]})
            if method == 'POST':
                return self.create_project(user_id, parse_body(event))
        context_match = PROJECT_RESEARCH_CONTEXT_PATH.fullmatch(path)
        if context_match and method == 'GET':
            from backend.local_api.domain.research_ledger import research_context
            project_id = context_match.group(1)
            return response(200, {'context': research_context(self.services, user_id, project_id)})
        events_match = PROJECT_RESEARCH_EVENTS_PATH.fullmatch(path)
        if events_match:
            from backend.local_api.domain.research_ledger import append_research_event, list_research_events
            project_id = events_match.group(1)
            if method == 'GET':
                params = event.get('queryStringParameters') or {}
                return response(200, {'events': list_research_events(self.services, user_id, project_id, limit=params.get('limit', 100), before=params.get('before'))})
            if method == 'POST':
                created = append_research_event(self.services, user_id, project_id, parse_body(event))
                return response(201, {'event': created})
        match = PROJECT_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            if method == 'GET':
                return response(200, {'project': public_item(require_project(self.services, user_id, project_id))})
            if method == 'PATCH':
                return self.update_project(user_id, project_id, parse_body(event))
            if method == 'DELETE':
                return self.delete_project(user_id, project_id)
        match = PROJECT_STRUCTURES_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            require_project(self.services, user_id, project_id)
            if method == 'GET':
                items = self.services.list_project_items(project_id, 'STRUCTURE')
                return response(200, {'structures': [public_item(item) for item in items]})
            if method == 'POST':
                return self.create_structure(user_id, project_id, parse_body(event))
        match = PROJECT_UPLOAD_PATH.fullmatch(path)
        if match and method == 'POST':
            project_id = match.group(1)
            require_project(self.services, user_id, project_id)
            return self.create_structure_upload(user_id, project_id, parse_body(event))
        match = PROJECT_MD_TRAJECTORIES_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            if method == 'GET':
                return self.list_md_trajectories(user_id, project_id)
            if method == 'POST':
                return self.create_md_trajectory_upload(user_id, project_id, parse_body(event))
        multipart = re.fullmatch('/v1/md/trajectories/([A-Za-z0-9_-]+)/(upload-part|multipart-complete)', path)
        if multipart and method == 'POST':
            from backend.local_api.domain.md_multipart import MdMultipart
            uploads = MdMultipart(self.services)
            if multipart[2] == 'upload-part':
                return response(200, uploads.part(user_id, multipart[1], parse_body(event)))
            uploads.complete(user_id, multipart[1])
            return response(200, {'uploaded': True})
        match = MD_TRAJECTORY_COMPLETE_PATH.fullmatch(path)
        if match and method == 'POST':
            return self.complete_md_trajectory(user_id, match.group(1), parse_body(event))
        match = MD_TRAJECTORY_PATH.fullmatch(path)
        if match:
            if method == 'GET':
                return self.get_md_trajectory(user_id, match.group(1))
            if method == 'PATCH':
                return self.update_md_trajectory(user_id, match.group(1), parse_body(event))
            if method == 'DELETE':
                return self.delete_md_trajectory(user_id, match.group(1))
        match = PROJECT_MD_ANALYSES_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            if method == 'GET':
                return self.list_md_analyses(user_id, project_id)
            if method == 'POST':
                return self.create_md_analysis(user_id, project_id, parse_body(event))
        match = MD_ANALYSIS_CANCEL_PATH.fullmatch(path)
        if match and method == 'POST':
            return self.cancel_md_analysis(user_id, match.group(1))
        match = MD_ANALYSIS_ARTIFACT_PATH.fullmatch(path)
        if match and method == 'GET':
            return self.get_md_analysis_artifact(user_id, match.group(1), match.group(2))
        match = MD_ANALYSIS_PATH.fullmatch(path)
        if match and method == 'GET':
            return self.get_md_analysis(user_id, match.group(1))
        match = PROJECT_MD_SIMULATIONS_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            if method == 'GET':
                return self.list_md_simulations(user_id, project_id)
            if method == 'POST':
                return self.create_md_simulation(user_id, project_id, parse_body(event))
        catalog_match = re.fullmatch('/v1/projects/([A-Za-z0-9_-]+)/md/potentials/catalog(?:/(import))?', path)
        if catalog_match and method == 'POST':
            project_id = catalog_match.group(1)
            require_project(self.services, user_id, project_id)
            return self.md_public_potential_catalog(user_id, project_id, parse_body(event), ingest=bool(catalog_match.group(2)))
        match = PROJECT_MD_POTENTIALS_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            if method == 'GET':
                return self.list_md_potentials(user_id, project_id)
            if method == 'POST':
                return self.create_md_potential_upload(user_id, project_id, parse_body(event))
        match = MD_POTENTIAL_COMPLETE_PATH.fullmatch(path)
        if match and method == 'POST':
            return self.complete_md_potential(user_id, match.group(1), parse_body(event))
        match = MD_POTENTIAL_PATH.fullmatch(path)
        if match and method == 'DELETE':
            return self.delete_md_potential(user_id, match.group(1))
        match = PROJECT_MD_CONFIGURATIONS_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            if method == 'GET':
                return self.list_md_configurations(user_id, project_id)
            if method == 'POST':
                return self.create_md_configuration(user_id, project_id, parse_body(event))
        match = MD_CONFIGURATION_PATH.fullmatch(path)
        if match:
            if method == 'PATCH':
                return self.update_md_configuration(user_id, match.group(1), parse_body(event))
            if method == 'DELETE':
                return self.delete_md_configuration(user_id, match.group(1))
        match = MD_SIMULATION_CANCEL_PATH.fullmatch(path)
        if match and method == 'POST':
            return self.cancel_md_simulation(user_id, match.group(1))
        match = MD_SIMULATION_PATH.fullmatch(path)
        if match and method == 'GET':
            return self.get_md_simulation(user_id, match.group(1))
        match = STRUCTURE_PATH.fullmatch(path)
        if match:
            structure_id = match.group(1)
            if method == 'GET':
                return self.get_structure(user_id, structure_id)
            if method == 'PATCH':
                return self.update_structure(user_id, structure_id, parse_body(event))
            if method == 'DELETE':
                return self.delete_structure(user_id, structure_id)
        if path == PSEUDOPOTENTIAL_UPLOAD_PATH and method == 'POST':
            return self.create_pseudopotential_upload(user_id, parse_body(event))
        workflow_project = re.fullmatch('/v1/projects/([A-Za-z0-9_-]+)/workflow-runs', path)
        workflow_run = re.fullmatch('/v1/workflow-runs/([A-Za-z0-9_-]+)(/cancel)?', path)
        if workflow_project or workflow_run:
            from backend.local_api.domain.dft_workflows import DftWorkflows
            workflows = DftWorkflows(self)
            if workflow_project and method == 'POST':
                return workflows.submit(user_id, workflow_project[1], parse_body(event))
            if workflow_run and method == 'GET' and (not workflow_run[2]):
                return workflows.get(user_id, workflow_run[1])
            if workflow_run and method == 'POST' and workflow_run[2]:
                return workflows.cancel(user_id, workflow_run[1])
        match = PROJECT_CALCULATIONS_PATH.fullmatch(path)
        if match:
            project_id = match.group(1)
            require_project(self.services, user_id, project_id)
            if method == 'GET':
                items = self.services.list_project_items(project_id, 'CALCULATION')
                items.sort(key=lambda item: item.get('createdAt', ''), reverse=True)
                return response(200, {'calculations': [public_item(item) for item in items]})
            if method == 'POST':
                return self.create_calculation(user_id, project_id, parse_body(event))
        match = CALCULATION_PATH.fullmatch(path)
        if match and method == 'GET':
            return self.get_calculation(user_id, match.group(1))
        match = CALCULATION_FILES_PATH.fullmatch(path)
        if match and method == 'GET':
            return self.get_calculation_files(user_id, match.group(1))
        match = CALCULATION_ARTIFACTS_PATH.fullmatch(path)
        if match and method == 'GET':
            return self.get_calculation_artifacts(user_id, match.group(1), event.get('queryStringParameters') or {})
        match = CALCULATION_CANCEL_PATH.fullmatch(path)
        if match and method == 'POST':
            return self.cancel_calculation(user_id, match.group(1))
        match = CALCULATION_DIAGNOSIS_PATH.fullmatch(path)
        if match and method == 'POST':
            return self.diagnose_calculation(user_id, match.group(1))
        raise ApiError(404, 'API route was not found.', 'NOT_FOUND')

    @staticmethod
    def local_queue_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
        status = str(item.get('status') or '')
        return (0 if status in {'RUNNING', 'CANCEL_REQUESTED'} else 1, -int(item.get('queuePriority') or 0), str(item.get('createdAt') or ''), str(item.get('id') or ''))

    def compute_status_payload(self) -> dict[str, Any]:
        now_epoch = int(time.time())
        presence = self.services.get_local_worker_presence()
        last_seen_epoch = int((presence or {}).get('lastSeenAtEpoch') or 0)
        connected = last_seen_epoch >= now_epoch - 90
        return {'backend': 'LOCAL_MAC', 'status': 'connected' if connected else 'offline', 'workerId': (presence or {}).get('workerId'), 'lastSeenAt': (presence or {}).get('lastSeenAt'), 'staleAfterSeconds': 90}

    def get_compute_status(self, user_id=None):
        compute = self.compute_status_payload()
        if user_id:
            computer = AccountApi(self.services).overview(user_id)['computer']
            compute = {'backend': 'LOCAL_MAC', 'target': 'personal', 'status': computer['status'], 'workerId': computer['workerId'], 'lastSeenAt': computer['lastSeenAt'], 'staleAfterSeconds': 90, 'capabilities': computer['capabilities']}
        return response(200, {'service': 'online', 'checkedAt': utc_now(), 'compute': compute, 'cloud': None, 'paid': None, 'mdCompute': compute})

    def require_local_worker(self, event):
        headers = event.get('headers') or {}
        supplied = next((str(value) for key, value in headers.items() if str(key).lower() == 'x-phynite-worker-token'), '') if isinstance(headers, dict) else ''
        self.worker_owner = AccountApi(self.services).authenticate_computer(supplied)

    def local_worker_item(self, calculation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        owner_id = clean_text(payload.get('ownerId'), 'Owner ID', minimum=1, maximum=256)
        if self.worker_owner is not None and self.worker_owner != owner_id:
            raise ApiError(403, "This computer can only access its owner's calculations.", 'WORKER_SCOPE_MISMATCH')
        job_kind = str(payload.get('kind') or 'qe')
        entity_kind = {'md-analysis': 'MD_ANALYSIS', 'md-simulation': 'MD_SIMULATION'}.get(job_kind, 'CALCULATION')
        item = require_owner_item(self.services, owner_id, entity_kind, calculation_id, 'LOCAL_JOB_NOT_FOUND')
        if item.get('computeBackend') != 'LOCAL_MAC':
            raise ApiError(404, 'Local calculation was not found.', 'CALCULATION_NOT_FOUND')
        if (item.get('computeTarget') == 'personal') != (self.worker_owner is not None):
            raise ApiError(403, 'This calculation targets a different computer.', 'WORKER_SCOPE_MISMATCH')
        worker_id = clean_text(payload.get('workerId'), 'Worker ID', minimum=1, maximum=96)
        if item.get('localWorkerId') != worker_id:
            raise ApiError(409, 'The calculation lease belongs to another worker.', 'WORKER_LEASE_MISMATCH')
        return item

    def local_job_input(self, claimed: dict[str, Any]) -> dict[str, Any]:
        """Build the immutable scientific claim for execution or result recovery."""
        raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=claimed['inputKey'])['Body'].read(4500001)
        if len(raw) > 4500000:
            raise RuntimeError('Local worker input exceeds the response limit')
        job_payload = json.loads(raw)
        if job_payload.get('scfSourceCalculationId'):
            from backend.local_api.domain.dft_workflows import source_metadata
            source, bundle = source_metadata(self.services, claimed['ownerId'], claimed['projectId'], job_payload['scfSourceCalculationId'], phonon=claimed.get('calculationType') == 'Phonon dispersion')
            if bundle is None:
                raise RuntimeError('SCF bundle is not ready')
            job_payload['scfSource'] = {**bundle, 'submittedScfInputIdentity': source['scfInputIdentity'], 'relaxedSource': bool(source.get('dependsOnCalculationIds'))}
        pseudo_downloads = []
        for filename, key in (job_payload.get('pseudopotentials') or {}).items():
            pseudo_downloads.append({'filename': safe_filename(filename), 'url': self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': key}, ExpiresIn=900)})
        dependency_downloads = [{'filename': f'dependency-{index}.tar.gz', **({'sha256': job_payload['scfSource']['sha256']} if key.endswith('/scf-workspace.tar.gz') and job_payload.get('scfSource') else {}), 'url': self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': key}, ExpiresIn=900)} for index, key in enumerate(job_payload.get('dependencyOutputKeys') or [])]
        source_download = None
        potential_downloads: list[dict[str, Any]] = []
        source = job_payload.get('source')
        if str(claimed.get('jobKind') or 'qe') in {'md-analysis', 'md-simulation'} and isinstance(source, dict):
            source_key = source.get('objectKey')
            if not isinstance(source_key, str) or not source_key.startswith(f"users/{storage_owner(claimed['ownerId'])}/"):
                raise RuntimeError('MD source is outside the worker owner scope')
            source_download = {'filename': safe_filename(source.get('filename')), 'sha256': str(source.get('sha256') or ''), 'sizeBytes': int(source.get('sizeBytes') or 0), 'url': self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': source_key}, ExpiresIn=900)}
        if str(claimed.get('jobKind') or 'qe') == 'md-simulation':
            raw_potential_files = job_payload.get('potentialFiles') or []
            if not isinstance(raw_potential_files, list) or len(raw_potential_files) > MAX_MD_POTENTIAL_FILES:
                raise RuntimeError('MD potential download list is invalid')
            potential_prefix = f"users/{storage_owner(claimed['ownerId'])}/projects/{claimed['projectId']}/md/potentials/"
            for file_item in raw_potential_files:
                if not isinstance(file_item, dict):
                    raise RuntimeError('MD potential download entry is invalid')
                object_key = file_item.get('objectKey')
                if not isinstance(object_key, str) or not object_key.startswith(potential_prefix):
                    raise RuntimeError('MD potential is outside the project scope')
                potential_downloads.append({'filename': safe_filename(file_item.get('filename')), 'role': str(file_item.get('role') or 'potential'), 'sha256': str(file_item.get('sha256') or ''), 'sizeBytes': int(file_item.get('sizeBytes') or 0), 'url': self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': object_key}, ExpiresIn=900)})
        return {'input': job_payload, 'pseudopotentialDownloads': pseudo_downloads, 'dependencyDownloads': dependency_downloads, **({'sourceDownload': source_download} if source_download else {}), **({'potentialDownloads': potential_downloads} if potential_downloads else {})}

    def claim_local_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.worker_owner:
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi
            ProjectWorkflowApi(self).tick_owner(self.worker_owner)
        worker_id = clean_text(payload.get('workerId'), 'Worker ID', minimum=1, maximum=96)
        requested_id = payload.get('requestedCalculationId')
        if requested_id is not None:
            if self.worker_owner is None:
                raise ApiError(403, 'Targeted claims require an owner-paired personal worker.', 'WORKER_SCOPE_MISMATCH')
            requested_id = clean_text(requested_id, 'Requested calculation ID', minimum=1, maximum=96)
            if not re.fullmatch('[A-Za-z0-9_-]+', requested_id):
                raise ApiError(400, 'Requested calculation ID is invalid.', 'INVALID_JOB_ID')
        affinity = normalize_execution_affinity(payload.get('executionAffinity'))
        if affinity is not None and self.worker_owner is None:
            raise ApiError(403, 'Scheduler claims require an owner-paired personal worker.', 'WORKER_SCOPE_MISMATCH')
        raw_capabilities = payload.get('capabilities')
        if raw_capabilities is None:
            capabilities = {'qe'}
        elif not isinstance(raw_capabilities, list) or any((value not in LOCAL_WORKER_CAPABILITIES for value in raw_capabilities)):
            raise ApiError(400, 'Worker capabilities are invalid.', 'INVALID_WORKER_CAPABILITIES')
        else:
            capabilities = set(raw_capabilities)
        if not capabilities:
            raise ApiError(400, 'Worker must advertise at least one capability.', 'INVALID_WORKER_CAPABILITIES')
        runtime_manifest = normalize_worker_runtime_manifest(payload.get('runtimeManifest'))
        telemetry = normalize_worker_telemetry(payload.get('telemetry'))
        now_epoch = int(time.time())
        timestamp = utc_now()
        if payload.get('reportPresence') is True and True:
            self.record_worker_presence(worker_id, capabilities, runtime_manifest, telemetry)
        if self.worker_owner is None and self.services.get_local_queue_config().get('paused'):
            return response(200, {'job': None, 'retryAfterSeconds': 10, 'queuePaused': True})
        lease_expires_at = now_epoch + 90
        if self.worker_owner:
            candidates = list(self.services.list_owner_items(self.worker_owner, 'CALCULATION'))
            if 'md-analysis' in capabilities:
                candidates.extend(self.services.list_owner_items(self.worker_owner, 'MD_ANALYSIS'))
            if 'md-simulation' in capabilities:
                candidates.extend(self.services.list_owner_items(self.worker_owner, 'MD_SIMULATION'))
        else:
            candidates = self.services.list_local_queue_candidates()
        candidates.sort(key=self.local_queue_sort_key)
        for item in candidates:
            if item.get('requiresWorkflowVersion', 0) > (payload.get('workflowVersion') if type(payload.get('workflowVersion')) is int else 0):
                continue
            if requested_id is not None and item.get('id') != requested_id:
                continue
            if item.get('computeBackend') != 'LOCAL_MAC':
                continue
            if item.get('executionAffinity') != affinity:
                continue
            item_capability = str(item.get('jobKind') or 'qe')
            if item_capability not in capabilities:
                continue
            if (item.get('computeTarget') == 'personal') != (self.worker_owner is not None):
                continue
            if self.worker_owner is not None and (item.get('ownerId') != self.worker_owner or item.get('computeBackend') != 'LOCAL_MAC'):
                continue
            if item.get('preferredWorkerId') and item.get('preferredWorkerId') != worker_id:
                continue
            owner_control = self.services.get_item(str(item.get('ownerId') or ''), 'ACCOUNT_CONTROL', 'primary') or {}
            if owner_control.get('suspended') or (getattr(self.services, 'pilot_gate_enabled', False) and (not owner_control.get('pilotGranted'))):
                continue
            status = item.get('status')
            if status == 'RUNNING' and int(item.get('leaseExpiresAtEpoch') or 0) >= now_epoch:
                continue
            if status not in {'QUEUED', 'RUNNING'}:
                continue
            if item_capability == 'md-simulation':
                owner_worker = self.services.get_item(self.worker_owner, 'PERSONAL_WORKER', 'primary') if self.worker_owner else None
                if not md_worker_can_claim_simulation(item, worker_id, runtime_manifest, allow_owner_rebind=bool(owner_worker and owner_worker.get('workerId') == worker_id)):
                    continue
            dependencies_ready = True
            dependency_failure = None
            for dependency_id in item.get('dependsOnCalculationIds') or []:
                dependency = self.services.get_item(item['ownerId'], 'CALCULATION', dependency_id)
                if not dependency or dependency.get('status') in {'FAILED', 'CANCELLED'}:
                    dependency_failure = 'A required calculation is missing, failed, or cancelled. Rerun it successfully before submitting this calculation.'
                    break
                if dependency.get('status') != 'COMPLETED':
                    dependencies_ready = False
                    continue
                dependency_failure = dependency_dft_error(self.services, dependency)
                if dependency_failure:
                    break
            if not dependencies_ready and (not dependency_failure):
                continue
            claimed = self.services.claim_local_calculation(item, worker_id, lease_expires_at, now_epoch, timestamp)
            if not claimed:
                continue
            self.record_research_event(claimed['ownerId'], claimed['projectId'], {
                'eventType': 'calculation_started',
                'title': 'Run started',
                'summary': str(claimed.get('name') or claimed.get('calculationType') or 'Calculation'),
                'runId': claimed['id'],
                'calculationId': claimed['id'],
                'jobKind': item_capability,
                'metadata': {'status': claimed.get('status'), 'computeBackend': claimed.get('computeBackend'), 'vcpus': claimed.get('vcpus'), 'memoryMiB': claimed.get('memoryMiB')},
            })
            if dependency_failure:
                self.services.finish_local_calculation(claimed, worker_id, 'FAILED', dependency_failure, timestamp)
                self.record_research_event(claimed['ownerId'], claimed['projectId'], {
                    'eventType': 'calculation_failed',
                    'title': 'Run failed before solver start',
                    'summary': dependency_failure,
                    'runId': claimed['id'],
                    'calculationId': claimed['id'],
                    'jobKind': item_capability,
                    'metadata': {'phase': 'preflight', 'status': 'FAILED'},
                })
                continue
            try:
                prepared_job = self.local_job_input(claimed)
            except Exception as exc:
                reason = f'Worker could not prepare the calculation input: {exc}'[:500]
                self.services.finish_local_calculation(claimed, worker_id, 'FAILED', reason, utc_now())
                if claimed.get('projectId'):
                    self.record_research_event(claimed['ownerId'], claimed['projectId'], {
                        'eventType': 'calculation_failed',
                        'title': 'Run failed before solver start',
                        'summary': reason,
                        'runId': claimed['id'],
                        'calculationId': claimed['id'],
                        'jobKind': item_capability,
                        'metadata': {'phase': 'preflight', 'status': 'FAILED'},
                    })
                continue
            return response(200, {'job': {'kind': item_capability, 'jobId': claimed['id'], 'calculationId': claimed['id'], 'ownerId': claimed['ownerId'], 'projectId': claimed['projectId'], 'vcpus': int(claimed.get('vcpus') or 1), 'memoryMiB': int(claimed.get('memoryMiB') or 2048), 'leaseExpiresAtEpoch': int(claimed.get('leaseExpiresAtEpoch') or lease_expires_at), **{}, **prepared_job, **({'executionAffinity': claimed['executionAffinity']} if claimed.get('executionAffinity') else {})}})
        return response(200, {'job': None, 'retryAfterSeconds': 10})

    def record_worker_presence(self, worker_id: str, capabilities: set[str] | None=None, runtime_manifest: dict[str, Any] | None=None, telemetry: dict[str, Any] | None=None) -> None:
        if self.worker_owner:
            if runtime_manifest is not None:
                updates: dict[str, Any] = {'workerId': worker_id, 'lastSeenAt': utc_now(), 'lastSeenAtEpoch': int(time.time()), 'runtimeManifest': runtime_manifest}
                if capabilities is not None:
                    updates['capabilities'] = sorted(capabilities)
                if telemetry is not None:
                    updates['telemetry'] = telemetry
                self.services.update_item(self.worker_owner, 'PERSONAL_WORKER', 'primary', updates)
            else:
                AccountApi(self.services).record_presence(self.worker_owner, worker_id, sorted(capabilities) if capabilities is not None else None)
                if telemetry is not None:
                    self.services.update_item(self.worker_owner, 'PERSONAL_WORKER', 'primary', {'telemetry': telemetry})
        else:
            self.services.record_local_worker_presence(worker_id, utc_now(), int(time.time()), sorted(capabilities) if capabilities is not None else None, runtime_manifest, telemetry)

    def heartbeat_local_job(self, calculation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        item = self.local_worker_item(calculation_id, payload)
        effective_resources = normalize_effective_resources(item, payload)
        compute_phase = normalize_compute_phase(payload)
        worker_id = clean_text(payload.get('workerId'), 'Worker ID', minimum=1, maximum=96)
        if payload.get('reportPresence') is True:
            self.record_worker_presence(worker_id, telemetry=normalize_worker_telemetry(payload.get('telemetry')))
        try:
            progress = int(payload.get('progress') or item.get('progress') or 35)
        except (TypeError, ValueError) as exc:
            raise ApiError(400, 'Worker progress is invalid.', 'INVALID_PROGRESS') from exc
        progress = max(12, min(progress, 95))
        stage = payload.get('stage')
        if stage is not None:
            stage = clean_text(stage, 'Worker stage', minimum=1, maximum=120)
        log_tail = payload.get('logTail')
        if log_tail is not None:
            if not isinstance(log_tail, str):
                raise ApiError(400, 'Worker log tail must be text.', 'INVALID_LOG_TAIL')
            log_tail = log_tail.replace('\x00', '')[-4000:]
        try:
            scf_convergence = normalize_scf_convergence(payload.get('scfConvergence'))
        except ValueError as exc:
            raise ApiError(400, str(exc), 'INVALID_SCF_TELEMETRY') from exc
        lease_expires_at = int(time.time()) + 90
        cloud_stop = False
        funding = {}
        try:
            updated = self.services.heartbeat_local_calculation(item, worker_id, lease_expires_at, progress, stage, log_tail, utc_now(), **{'scf_convergence': scf_convergence} if scf_convergence else {}, **{'effective_resources': effective_resources} if effective_resources else {}, **{'compute_phase': compute_phase} if compute_phase else {})
        except Exception as exc:
            raise ApiError(409, 'The local worker lease is no longer active.', 'WORKER_LEASE_LOST') from exc
        return response(200, {'status': updated.get('status'), 'cancelRequested': cloud_stop or updated.get('status') == 'CANCEL_REQUESTED', 'leaseExpiresAtEpoch': lease_expires_at, **funding})

    def create_local_upload_urls(self, calculation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        item = self.local_worker_item(calculation_id, payload)
        if payload.get('artifactAction') or (isinstance(payload.get('files'), list) and all((isinstance(file, dict) and 'sha256' in file for file in payload['files']))):
            from backend.local_api.domain.worker_artifacts import WorkerArtifacts
            artifacts = WorkerArtifacts(self.services)
            if payload.get('artifactAction'):
                return response(200, artifacts.action(item, payload))
            files = payload.get('files')
            if not isinstance(files, list) or not 1 <= len(files) <= 200 or any((not isinstance(file, dict) for file in files)):
                raise ApiError(400, 'Worker artifact list is invalid.', 'INVALID_ARTIFACTS')
            return response(200, {'uploads': [artifacts.plan(item, file) for file in files], 'expiresIn': 900})
        files = payload.get('files')
        if not isinstance(files, list) or not 1 <= len(files) <= 200:
            raise ApiError(400, 'Worker artifact list is invalid.', 'INVALID_ARTIFACTS')
        uploads = []
        declared_total_bytes = 0
        for file in files:
            if not isinstance(file, dict):
                raise ApiError(400, 'Worker artifact is invalid.', 'INVALID_ARTIFACTS')
            relative = file.get('path')
            if not isinstance(relative, str):
                raise ApiError(400, 'Worker artifact path is invalid.', 'INVALID_ARTIFACTS')
            path = Path(relative)
            if path.is_absolute() or '..' in path.parts or (not path.parts):
                raise ApiError(400, 'Worker artifact path is unsafe.', 'INVALID_ARTIFACTS')
            try:
                size = int(file.get('sizeBytes') or 0)
            except (TypeError, ValueError) as exc:
                raise ApiError(400, 'Worker artifact size is invalid.', 'INVALID_ARTIFACTS') from exc
            if size < 0 or size > 5000000000:
                raise ApiError(400, 'Worker artifact is too large.', 'INVALID_ARTIFACTS')
            declared_total_bytes += size
            content_type = str(file.get('contentType') or mimetypes.guess_type(path.name)[0] or 'application/octet-stream')[:160]
            key = f"{item['outputPrefix']}/{path.as_posix()}"
            uploads.append({'path': path.as_posix(), 'contentType': content_type, 'retentionTag': 'phynite-retention=research-data' if path.as_posix() == 'research/dataset.json' else 'phynite-retention=calculation-output', 'url': self.services.s3.generate_presigned_url('put_object', Params={'Bucket': self.services.bucket, 'Key': key, 'ContentLength': size, 'ContentType': content_type, 'ServerSideEncryption': 'AES256', 'Tagging': 'phynite-retention=research-data' if path.as_posix() == 'research/dataset.json' else 'phynite-retention=calculation-output'}, ExpiresIn=900)})
        if declared_total_bytes > 10 * 1024 ** 3:
            try:
                self.services.record_compute_alert(calculation_id, item['ownerId'], 'LARGE_ARTIFACT_BATCH', declared_total_bytes)
            except Exception:
                logging.getLogger(__name__).exception('Compute artifact alert could not be recorded')
        return response(200, {'uploads': uploads, 'expiresIn': 900})

    def complete_local_job(self, calculation_id: str, payload: dict[str, Any], *, interrupted_recovery: dict[str, Any] | None = None) -> dict[str, Any]:
        item = self.local_worker_item(calculation_id, payload)
        effective_resources = normalize_effective_resources(item, payload)
        reported_status = str(payload.get('status') or '').lower()
        status_map = {'completed': 'COMPLETED', 'failed': 'FAILED', 'cancelled': 'CANCELLED'}
        if reported_status not in status_map:
            raise ApiError(400, 'Worker completion status is invalid.', 'INVALID_WORKER_STATUS')
        log_tail = payload.get('logTail')
        if log_tail is not None:
            if not isinstance(log_tail, str):
                raise ApiError(400, 'Worker log tail must be text.', 'INVALID_LOG_TAIL')
            log_tail = log_tail.replace('\x00', '')[-4000:]
        final_status = status_map[reported_status]
        if item.get('status') in FINAL_JOB_STATES and interrupted_recovery is None:
            if item.get('status') == final_status or (item.get('status') == 'FAILED' and final_status == 'COMPLETED' and (item.get('resultValidationFailure') in {'DFT_RELAXATION_NOT_CONVERGED', 'DFT_NOT_CONVERGED'})):
                key = {'MD_SIMULATION': 'simulation', 'MD_ANALYSIS': 'analysis'}.get(item.get('entityType'), 'calculation')
                return response(200, {key: public_item(item)})
            raise ApiError(409, 'The calculation already has a different terminal status.', 'RESULT_MISMATCH')
        manifest_limit = MAX_RESULT_MANIFEST_BYTES
        result_key = f"{item['outputPrefix']}/result.json"
        try:
            raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=result_key)['Body'].read(manifest_limit + 1)
            manifest = json.loads(raw) if len(raw) <= manifest_limit else None
        except Exception as exc:
            raise ApiError(409, 'Upload result.json before completing the job.', 'RESULT_NOT_UPLOADED') from exc
        manifest_job_id = manifest.get('calculationId') if isinstance(manifest, dict) else None
        if not isinstance(manifest, dict) or manifest_job_id != calculation_id:
            raise ApiError(409, 'The uploaded result does not match this calculation.', 'RESULT_MISMATCH')
        if reported_status == 'completed' and manifest.get('status') != 'completed':
            raise ApiError(409, 'The result manifest is not completed.', 'RESULT_MISMATCH')
        failure_reason = None
        if reported_status != 'completed':
            failure_reason = clean_text(payload.get('failureReason') or manifest.get('error') or 'Local calculation failed.', 'Failure reason', minimum=1, maximum=500)
        dft_summary = None
        if item.get('entityType') == 'CALCULATION':
            dft_summary = dft_convergence_summary(manifest)
            if reported_status == 'completed':
                failure_reason = dft_result_error(manifest, item.get('calculationType'))
                from backend.local_api.domain.shared_scf import inherited_scf_error
                try:
                    failure_reason = failure_reason or inherited_scf_error(self.services, item, manifest)
                except (ApiError, KeyError, ValueError):
                    failure_reason = 'Inherited SCF source could not be verified.'
                if failure_reason:
                    final_status = 'FAILED'
        analysis_manifest: dict[str, Any] | None = None
        if item.get('entityType') == 'MD_ANALYSIS' and reported_status == 'completed':
            try:
                analysis_manifest = read_md_result_manifest(self.services, item)
            except Exception as exc:
                raise ApiError(409, 'MD analysis output could not be verified.', 'MD_RESULT_INVALID') from exc
        trajectory_result: dict[str, Any] | None = None
        if item.get('entityType') == 'MD_SIMULATION' and reported_status == 'completed':
            trajectory_artifact = manifest.get('trajectoryArtifact')
            if not isinstance(trajectory_artifact, dict):
                raise ApiError(409, 'Completed MD simulation has no finalized trajectory.', 'MD_RESULT_INCOMPLETE')
            artifact_path = trajectory_artifact.get('path')
            path = Path(str(artifact_path or ''))
            if path.is_absolute() or '..' in path.parts or (not path.parts):
                raise ApiError(409, 'MD result trajectory path is invalid.', 'MD_RESULT_INCOMPLETE')
            digest = str(trajectory_artifact.get('sha256') or '').lower()
            if not re.fullmatch('[a-f0-9]{64}', digest):
                raise ApiError(409, 'MD result trajectory checksum is invalid.', 'MD_RESULT_INCOMPLETE')
            trajectory_limit = MAX_PERSONAL_MD_RESULT_BYTES
            size_bytes = md_integer(trajectory_artifact.get('sizeBytes'), 'Result trajectory size', 1, trajectory_limit, 'MD_RESULT_INCOMPLETE')
            object_key = f"{item['outputPrefix']}/{path.as_posix()}"
            transfer_id = calculation_id + '_' + hashlib.sha256(path.as_posix().encode()).hexdigest()
            transfer = self.services.get_item(item['ownerId'], 'WORKER_ARTIFACT', transfer_id)
            if transfer is not None:
                from backend.local_api.domain.worker_artifacts import WorkerArtifacts
                WorkerArtifacts(self.services).verify(item, path.as_posix(), size_bytes, digest)
            elif size_bytes > MAX_MD_TRAJECTORY_BYTES:
                raise ApiError(409, 'Large MD trajectories require the checksummed multipart worker transfer. Update the worker and retry this retained result.', 'MD_RESULT_TRANSFER_REQUIRED')
            else:
                try:
                    body = self.services.s3.get_object(Bucket=self.services.bucket, Key=object_key)['Body']
                    actual_digest = hashlib.sha256()
                    actual_size = 0
                    while True:
                        chunk = body.read(1024 * 1024)
                        if not chunk:
                            break
                        actual_size += len(chunk)
                        if actual_size > MAX_MD_TRAJECTORY_BYTES:
                            raise ValueError('trajectory exceeds the retained file limit')
                        actual_digest.update(chunk)
                except Exception as exc:
                    raise ApiError(409, 'MD result trajectory could not be verified.', 'MD_RESULT_INCOMPLETE') from exc
                if actual_size != size_bytes or not hmac.compare_digest(actual_digest.hexdigest(), digest):
                    raise ApiError(409, 'MD result trajectory checksum or size does not match.', 'MD_RESULT_INCOMPLETE')
            trajectory_result = {'path': path, 'filename': safe_filename(trajectory_artifact.get('filename') or path.name), 'sha256': digest, 'sizeBytes': size_bytes, 'objectKey': object_key}
        try:
            if interrupted_recovery is not None:
                if final_status != 'COMPLETED' or not getattr(self.services, 'local_workspace', False):
                    raise ApiError(409, failure_reason or 'Only a verified completed local result can be recovered.', 'RESULT_RECOVERY_INVALID')
                if item != interrupted_recovery['expectedItem']:
                    raise ApiError(409, 'The interrupted job changed during verification.', 'RESULT_RECOVERY_CONFLICT')
                updated = self.services.finish_interrupted_calculation(item, payload['workerId'], utc_now(), interrupted_recovery['provenance'], effective_resources)
            else:
                updated = self.services.finish_local_calculation(item, payload['workerId'], final_status, failure_reason, utc_now(), **({'effective_resources': effective_resources} if effective_resources else {}), **({'log_tail': log_tail} if log_tail is not None else {}))
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError(409, 'The local worker lease is no longer active.', 'WORKER_LEASE_LOST') from exc
        if dft_summary is not None:
            updates = {'resultSummary': dft_summary}
            if reported_status == 'completed' and final_status == 'FAILED':
                updates['resultValidationFailure'] = 'DFT_RELAXATION_NOT_CONVERGED' if item.get('calculationType') == 'Structural relaxation' else 'DFT_NOT_CONVERGED'
            updated = self.services.update_item(item['ownerId'], 'CALCULATION', calculation_id, updates)
        if final_status == 'FAILED':
            try:
                self.services.record_scientific_failure(item['ownerId'], str(item.get('entityType') or 'CALCULATION'), calculation_id, failure_reason or 'Local calculation failed', utc_now())
            except Exception:
                logging.getLogger(__name__).exception('Failure digest recording failed for %s', calculation_id)
        if analysis_manifest is not None:
            updated = self.services.update_item(item['ownerId'], 'MD_ANALYSIS', calculation_id, {'resultSummary': md_result_summary(analysis_manifest), 'statusMessage': 'Analysis complete', 'updatedAt': utc_now()})
        trajectory_id: str | None = None
        if trajectory_result is not None:
            trajectory_id = f"mdt_{hashlib.sha256(f'md-result:{calculation_id}'.encode()).hexdigest()[:32]}"
            trajectory = self.services.get_item(item['ownerId'], 'MD_TRAJECTORY', trajectory_id)
            if trajectory is None:
                timestamp = utc_now()
                trajectory = {'PK': owner_partition(item['ownerId']), 'SK': f'MD_TRAJECTORY#{trajectory_id}', 'GSI1PK': f"PROJECT#{item['projectId']}", 'GSI1SK': f'MD_TRAJECTORY#{timestamp}#{trajectory_id}', 'entityType': 'MD_TRAJECTORY', 'id': trajectory_id, 'projectId': item['projectId'], 'ownerId': item['ownerId'], 'filename': trajectory_result['filename'], 'name': f"{item['name']} result", 'format': 'lammps-dump', 'contentType': 'application/x-lammps', 'sizeBytes': trajectory_result['sizeBytes'], 'sha256': trajectory_result['sha256'], 'status': 'READY', 'objectKey': trajectory_result['objectKey'], 'sourceSimulationId': calculation_id, 'uploadedAt': timestamp, 'createdAt': timestamp, 'updatedAt': timestamp}
                self.services.put_item(trajectory, 'attribute_not_exists(PK)')
            updated = self.services.update_item(item['ownerId'], 'MD_SIMULATION', calculation_id, {'resultTrajectoryId': trajectory_id, 'updatedAt': utc_now()})
            potential_asset_id = item.get('potentialAssetId')
            if potential_asset_id:
                try:
                    self.services.update_item(item['ownerId'], 'MD_POTENTIAL', potential_asset_id, {'runtimeValidatedAt': utc_now(), 'runtimeValidatedSimulationId': calculation_id, 'updatedAt': utc_now()})
                except Exception:
                    pass
            if interrupted_recovery is None:
                self.tick_project_workflows(item['ownerId'])
            if item.get('projectId'):
                self.record_research_event(item['ownerId'], item['projectId'], {
                    'eventType': {'COMPLETED': 'calculation_completed', 'FAILED': 'calculation_failed', 'CANCELLED': 'calculation_cancelled'}[final_status],
                    'title': {'COMPLETED': 'Run completed', 'FAILED': 'Run failed', 'CANCELLED': 'Run cancelled'}[final_status],
                    'summary': str(failure_reason or updated.get('statusMessage') or item.get('name') or 'MD simulation'),
                    'runId': calculation_id,
                    'calculationId': calculation_id,
                    'jobKind': 'md-simulation',
                    'metadata': {'status': final_status, 'failureReason': failure_reason, 'effectiveResources': effective_resources, 'resultTrajectoryId': trajectory_id},
                })
            return response(200, {'simulation': public_item(updated), 'trajectory': public_item(trajectory)})
        key = {'MD_SIMULATION': 'simulation', 'MD_ANALYSIS': 'analysis'}.get(item.get('entityType'), 'calculation')
        if interrupted_recovery is None:
            self.tick_project_workflows(item['ownerId'])
        if item.get('projectId'):
            self.record_research_event(item['ownerId'], item['projectId'], {
                'eventType': {'COMPLETED': 'calculation_completed', 'FAILED': 'calculation_failed', 'CANCELLED': 'calculation_cancelled'}[final_status],
                'title': {'COMPLETED': 'Run completed', 'FAILED': 'Run failed', 'CANCELLED': 'Run cancelled'}[final_status],
                'summary': str(failure_reason or updated.get('statusMessage') or item.get('name') or 'Calculation'),
                'runId': calculation_id,
                'calculationId': calculation_id,
                'jobKind': {'MD_ANALYSIS': 'md-analysis', 'MD_SIMULATION': 'md-simulation'}.get(item.get('entityType'), 'qe'),
                'metadata': {'status': final_status, 'failureReason': failure_reason, 'effectiveResources': effective_resources},
            })
        return response(200, {key: public_item(updated)})

    def tick_project_workflows(self, owner: str) -> None:
        try:
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi
            ProjectWorkflowApi(self).tick_owner(owner)
        except Exception:
            logging.getLogger(__name__).exception('Workflow continuation deferred to the next worker poll')

    def get_profile(self, user_id: str) -> dict[str, Any]:
        item = self.services.get_item(user_id, 'PROFILE', 'primary')
        return response(200, {'profile': public_item(item) if item else None})

    def put_profile(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        allowed_roles = {'Researcher', 'Student', 'Industrial R&D', 'Educator', 'Other'}
        role = clean_text(payload.get('role', 'Researcher'), 'Role', minimum=1, maximum=40)
        if role not in allowed_roles:
            raise ApiError(400, 'Role is not supported.', 'INVALID_PROFILE')
        workspace_theme = payload.get('workspaceTheme', 'light')
        if workspace_theme not in {'light', 'dark'}:
            raise ApiError(400, 'Workspace theme must be light or dark.', 'INVALID_PROFILE')
        timestamp = utc_now()
        values = {'version': 1, 'displayName': clean_text(payload.get('displayName', ''), 'Display name', minimum=1, maximum=100), 'institution': clean_text(payload.get('institution', ''), 'Institution', maximum=160), 'role': role, 'researchArea': clean_text(payload.get('researchArea', ''), 'Research area', maximum=240), 'workspaceTheme': workspace_theme, **({'avatarDataUrl': validate_avatar(payload['avatarDataUrl'])} if 'avatarDataUrl' in payload else {}), 'updatedAt': timestamp}
        current = self.services.get_item(user_id, 'PROFILE', 'primary')
        if current:
            item = self.services.update_item(user_id, 'PROFILE', 'primary', values)
        else:
            item = {'PK': owner_partition(user_id), 'SK': 'PROFILE#primary', 'entityType': 'PROFILE', 'id': 'primary', 'ownerId': user_id, 'createdAt': timestamp, **values}
            self.services.put_item(item, 'attribute_not_exists(PK)')
        return response(200, {'profile': public_item(item)})

    def patch_profile(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        text_fields = {'displayName': ('Display name', 1, 100), 'institution': ('Institution', 0, 160), 'role': ('Role', 1, 40), 'researchArea': ('Research area', 0, 240)}
        allowed = {*text_fields, 'workspaceTheme', 'avatarDataUrl'}
        if not payload or set(payload) - allowed:
            raise ApiError(400, 'Supply only the profile fields you want to change: displayName, institution, role, researchArea, workspaceTheme, or avatarDataUrl.', 'INVALID_PROFILE')
        current = self.services.get_item(user_id, 'PROFILE', 'primary')
        if not current and 'displayName' not in payload:
            raise ApiError(409, 'Create your research profile with a display name before saving these preferences.', 'PROFILE_INITIALIZATION_REQUIRED')
        values = {field: clean_text(payload[field], label, minimum=minimum, maximum=maximum) for field, (label, minimum, maximum) in text_fields.items() if field in payload}
        if 'role' in values and values['role'] not in {'Researcher', 'Student', 'Industrial R&D', 'Educator', 'Other'}:
            raise ApiError(400, 'Role is not supported.', 'INVALID_PROFILE')
        if 'workspaceTheme' in payload:
            theme = payload['workspaceTheme']
            if not isinstance(theme, str) or theme not in {'light', 'dark'}:
                raise ApiError(400, 'Workspace theme must be light or dark.', 'INVALID_PROFILE')
            values['workspaceTheme'] = theme
        if 'avatarDataUrl' in payload:
            values['avatarDataUrl'] = validate_avatar(payload['avatarDataUrl'])
        timestamp = utc_now()
        if current:
            item = self.services.update_item(user_id, 'PROFILE', 'primary', {**values, 'updatedAt': timestamp})
        else:
            item = {'PK': owner_partition(user_id), 'SK': 'PROFILE#primary', 'entityType': 'PROFILE', 'id': 'primary', 'ownerId': user_id, 'createdAt': timestamp, 'updatedAt': timestamp, 'version': 1, 'institution': '', 'role': 'Researcher', 'researchArea': '', 'workspaceTheme': 'light', **values}
            try:
                self.services.put_item(item, 'attribute_not_exists(PK)')
            except Exception as failure:
                if getattr(failure, 'response', {}).get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                    raise
                raise ApiError(409, 'Your profile was created in another session. Reload it before saving these changes.', 'PROFILE_CHANGED') from None
        return response(200, {'profile': public_item(item)})

    def get_workspace(self, user_id: str) -> dict[str, Any]:
        metadata = self.services.get_item(user_id, 'WORKSPACE', 'primary')
        if not metadata:
            return response(200, {'workspace': None, 'revision': 0, 'resetAt': None})
        try:
            stored = self.services.s3.get_object(Bucket=self.services.bucket, Key=metadata['objectKey'])['Body'].read()
            snapshot = prune_expired_project_trash(json.loads(stored.decode('utf-8')))
        except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError(500, 'The stored workspace could not be read.', 'WORKSPACE_CORRUPT') from exc
        return response(200, {'workspace': snapshot, 'revision': int(metadata.get('revision', 0)), 'sizeBytes': int(metadata.get('sizeBytes', len(stored))), 'createdAt': metadata.get('createdAt'), 'updatedAt': metadata.get('updatedAt'), 'resetAt': None})

    def put_workspace(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        snapshot = payload.get('workspace')
        if not isinstance(snapshot, dict) or snapshot.get('version') != 1:
            raise ApiError(400, 'Workspace must be a version 1 snapshot.', 'INVALID_WORKSPACE')
        for field in ('projects', 'materials', 'jobs', 'calculationComponents', 'projectTrash'):
            value = snapshot.get(field)
            if value is not None and (not isinstance(value, list)):
                raise ApiError(400, f'Workspace field {field} must be a list.', 'INVALID_WORKSPACE')
        for entry in snapshot.get('projectTrash', []):
            if not isinstance(entry, dict) or not isinstance(entry.get('project'), dict) or (not isinstance(entry['project'].get('id'), str)) or (project_trash_expiry(entry.get('deletedAt')) is None) or (project_trash_expiry(entry.get('expiresAt')) is None):
                raise ApiError(400, 'Workspace Trash contains an invalid project entry.', 'INVALID_WORKSPACE')
            for field in ('materials', 'jobs', 'calculationConfigurations', 'calculationComponents'):
                if not isinstance(entry.get(field), list):
                    raise ApiError(400, f'Workspace Trash field {field} must be a list.', 'INVALID_WORKSPACE')
        snapshot = prune_expired_project_trash(snapshot)
        encoded = json.dumps(snapshot, separators=(',', ':')).encode('utf-8')
        if len(encoded) > MAX_WORKSPACE_BYTES:
            raise ApiError(413, 'Workspace is larger than the 4.5 MB development limit.', 'WORKSPACE_TOO_LARGE')
        current = self.services.get_item(user_id, 'WORKSPACE', 'primary')
        current_revision = int(current.get('revision', 0)) if current else 0
        requested_revision = payload.get('baseRevision', current_revision)
        if not isinstance(requested_revision, int) or isinstance(requested_revision, bool):
            raise ApiError(400, 'baseRevision must be an integer.', 'INVALID_REVISION')
        if requested_revision != current_revision:
            raise ApiError(409, 'Workspace changed on another device. Reload before saving.', 'WORKSPACE_CONFLICT')
        revision = current_revision + 1
        timestamp = utc_now()
        key = f"users/{storage_owner(user_id)}/workspace/revisions/{revision}-{new_id('snapshot')}.json"
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=encoded, ContentType='application/json', ServerSideEncryption='AES256')
        metadata = {'PK': owner_partition(user_id), 'SK': 'WORKSPACE#primary', 'entityType': 'WORKSPACE', 'id': 'primary', 'ownerId': user_id, 'objectKey': key, 'revision': revision, 'sizeBytes': len(encoded), 'createdAt': current.get('createdAt', timestamp) if current else timestamp, 'updatedAt': timestamp}
        if not self.services.save_workspace_metadata(user_id, metadata, current_revision):
            self.services.s3.delete_object(Bucket=self.services.bucket, Key=key)
            raise ApiError(409, 'Workspace changed on another device. Reload before saving.', 'WORKSPACE_CONFLICT')
        previous_key = current.get('objectKey') if current else None
        if previous_key and previous_key != key:
            self.services.s3.delete_object(Bucket=self.services.bucket, Key=previous_key)
        return response(200, {'saved': True, 'revision': revision, 'sizeBytes': len(encoded), 'createdAt': metadata['createdAt'], 'updatedAt': timestamp})

    def create_project(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project_id = new_id('prj')
        timestamp = utc_now()
        item = {'PK': owner_partition(user_id), 'SK': f'PROJECT#{project_id}', 'entityType': 'PROJECT', 'id': project_id, 'ownerId': user_id, 'name': clean_text(payload.get('name'), 'Project name', minimum=1, maximum=120), 'description': clean_text(payload.get('description', ''), 'Description', maximum=1000), 'tags': normalize_project_tags(payload.get('tags')), 'createdAt': timestamp, 'updatedAt': timestamp, 'lastOpenedAt': timestamp}
        self.services.put_item(item, 'attribute_not_exists(PK)')
        self.record_research_event(user_id, project_id, {'eventType': 'project_created', 'title': 'Project created', 'summary': item['name'], 'metadata': {'name': item['name'], 'tags': item.get('tags', [])}})
        return response(201, {'project': public_item(item)})

    def update_project(self, user_id: str, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        require_project(self.services, user_id, project_id)
        updates: dict[str, Any] = {'updatedAt': utc_now()}
        if 'name' in payload:
            updates['name'] = clean_text(payload['name'], 'Project name', minimum=1, maximum=120)
        if 'description' in payload:
            updates['description'] = clean_text(payload['description'], 'Description', maximum=1000)
        if 'tags' in payload:
            updates['tags'] = normalize_project_tags(payload['tags'])
        if 'lastOpenedAt' in payload:
            updates['lastOpenedAt'] = utc_now()
        item = self.services.update_item(user_id, 'PROJECT', project_id, updates)
        return response(200, {'project': public_item(item)})

    def delete_project(self, user_id, project_id):
        require_project(self.services, user_id, project_id)
        with self.services.table.atomic():
            children = [item for item in self.services.list_project_items(project_id) if item.get('ownerId') == user_id]
            if any((item.get('entityType') in {'CALCULATION', 'MD_ANALYSIS', 'MD_SIMULATION'} and item.get('status') in {'QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'PREPARING'} for item in children)):
                raise ApiError(409, 'Cancel active jobs and wait for the worker to finish before deleting this project.', 'PROJECT_COMPUTE_ACTIVE')
            self.services.delete_s3_prefix(f'users/{storage_owner(user_id)}/projects/{project_id}/')
            self.services.delete_project(user_id, project_id, children)
        return response(200, {'deleted': True, 'projectId': project_id})

    def create_structure(self, user_id: str, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        name = clean_text(payload.get('name'), 'Structure name', minimum=1, maximum=140)
        formula = clean_text(payload.get('formula', ''), 'Formula', maximum=120)
        atoms = payload.get('atoms')
        lattice = payload.get('lattice')
        if not isinstance(atoms, list) or not atoms or len(atoms) > 50000:
            raise ApiError(400, 'Structure must contain between 1 and 50,000 atoms.', 'INVALID_STRUCTURE')
        if not isinstance(lattice, dict):
            raise ApiError(400, 'Structure lattice is required.', 'INVALID_STRUCTURE')
        periodic = payload.get('periodic', lattice.get('periodic'))
        if periodic is not None and (not isinstance(periodic, list) or len(periodic) != 3 or any((type(axis) is not bool for axis in periodic))):
            raise ApiError(400, 'Structure periodicity must contain three explicit booleans.', 'INVALID_STRUCTURE')
        encoded = json.dumps(payload, separators=(',', ':')).encode('utf-8')
        if len(encoded) > 5000000:
            raise ApiError(413, 'Structure payload is too large.', 'STRUCTURE_TOO_LARGE')
        structure_id = new_id('str')
        timestamp = utc_now()
        key = f'users/{storage_owner(user_id)}/projects/{project_id}/structures/{structure_id}/structure.json'
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=encoded, ContentType='application/json', ServerSideEncryption='AES256')
        item = {'PK': owner_partition(user_id), 'SK': f'STRUCTURE#{structure_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'STRUCTURE#{timestamp}#{structure_id}', 'entityType': 'STRUCTURE', 'id': structure_id, 'projectId': project_id, 'ownerId': user_id, 'name': name, 'formula': formula, 'atomCount': len(atoms), 'sha256': hashlib.sha256(encoded).hexdigest(), 'spaceGroup': clean_text(payload.get('spaceGroup', 'P1'), 'Space group', maximum=80), 'source': clean_text(payload.get('source', 'Phynite'), 'Source', maximum=80), 'status': 'READY', 'objectKey': key, 'createdAt': timestamp, 'updatedAt': timestamp}
        self.services.put_item(item, 'attribute_not_exists(PK)')
        self.record_research_event(user_id, project_id, {'eventType': 'structure_imported', 'title': 'Structure imported', 'summary': name, 'metadata': {'atomCount': len(atoms), 'formula': formula}, 'artifactRefs': [{'kind': 'structure', 'id': structure_id, 'sha256': item['sha256']}]})
        return response(201, {'structure': public_item(item)})

    def create_structure_upload(self, user_id: str, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        filename = safe_filename(payload.get('filename'))
        content_type = clean_text(payload.get('contentType', 'application/octet-stream'), 'Content type', minimum=1, maximum=120)
        structure_id = new_id('str')
        timestamp = utc_now()
        key = f'users/{storage_owner(user_id)}/projects/{project_id}/structures/{structure_id}/source/{filename}'
        item = {'PK': owner_partition(user_id), 'SK': f'STRUCTURE#{structure_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'STRUCTURE#{timestamp}#{structure_id}', 'entityType': 'STRUCTURE', 'id': structure_id, 'projectId': project_id, 'ownerId': user_id, 'name': filename, 'formula': '', 'atomCount': 0, 'source': 'Upload', 'status': 'UPLOAD_PENDING', 'objectKey': key, 'createdAt': timestamp, 'updatedAt': timestamp}
        self.services.put_item(item, 'attribute_not_exists(PK)')
        upload = self.services.s3.generate_presigned_post(Bucket=self.services.bucket, Key=key, Fields={'Content-Type': content_type, 'x-amz-server-side-encryption': 'AES256'}, Conditions=[{'Content-Type': content_type}, {'x-amz-server-side-encryption': 'AES256'}, ['content-length-range', 1, 25000000]], ExpiresIn=900)
        return response(201, {'structure': public_item(item), 'upload': {'url': upload['url'], 'method': 'POST', 'expiresIn': 900, 'fields': upload['fields']}})

    def update_structure(self, user_id: str, structure_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        require_owner_item(self.services, user_id, 'STRUCTURE', structure_id, 'STRUCTURE_NOT_FOUND')
        updates: dict[str, Any] = {'updatedAt': utc_now()}
        if 'name' in payload:
            updates['name'] = clean_text(payload['name'], 'Structure name', minimum=1, maximum=140)
        if 'formula' in payload:
            updates['formula'] = clean_text(payload['formula'], 'Formula', maximum=120)
        if 'spaceGroup' in payload:
            updates['spaceGroup'] = clean_text(payload['spaceGroup'], 'Space group', maximum=80)
        if 'atomCount' in payload:
            try:
                atom_count = int(payload['atomCount'])
            except (TypeError, ValueError) as exc:
                raise ApiError(400, 'Atom count is invalid.', 'INVALID_STRUCTURE') from exc
            if atom_count < 1 or atom_count > 50000:
                raise ApiError(400, 'Atom count is outside the supported range.', 'INVALID_STRUCTURE')
            updates['atomCount'] = atom_count
        if payload.get('status') == 'READY':
            updates['status'] = 'READY'
        item = self.services.update_item(user_id, 'STRUCTURE', structure_id, updates)
        return response(200, {'structure': public_item(item)})

    def create_pseudopotential_upload(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        filename = safe_filename(payload.get('filename'))
        if not filename.lower().endswith('.upf'):
            raise ApiError(400, 'Pseudopotential files must use the .UPF extension.', 'INVALID_PSEUDOPOTENTIAL')
        key = f"users/{storage_owner(user_id)}/pseudopotentials/{new_id('pseudo')}/{filename}"
        upload = self.services.s3.generate_presigned_post(Bucket=self.services.bucket, Key=key, Fields={'Content-Type': 'application/octet-stream', 'x-amz-server-side-encryption': 'AES256'}, Conditions=[{'Content-Type': 'application/octet-stream'}, {'x-amz-server-side-encryption': 'AES256'}, ['content-length-range', 1, 20000000]], ExpiresIn=900)
        return response(201, {'objectKey': key, 'filename': filename, 'upload': {'url': upload['url'], 'method': 'POST', 'expiresIn': 900, 'fields': upload['fields']}})

    def get_structure(self, user_id: str, structure_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'STRUCTURE', structure_id, 'STRUCTURE_NOT_FOUND')
        download_url = self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': item['objectKey']}, ExpiresIn=900)
        return response(200, {'structure': public_item(item), 'downloadUrl': download_url, 'expiresIn': 900})

    def delete_structure(self, user_id: str, structure_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'STRUCTURE', structure_id, 'STRUCTURE_NOT_FOUND')
        calculations = self.services.list_project_items(item['projectId'], 'CALCULATION')
        active = [calc for calc in calculations if calc.get('structureId') == structure_id and calc.get('status') not in FINAL_JOB_STATES]
        if active:
            raise ApiError(409, 'Structure is connected to an active calculation.', 'STRUCTURE_IN_USE')
        prefix = f"users/{storage_owner(user_id)}/projects/{item['projectId']}/structures/{structure_id}/"
        self.services.delete_s3_prefix(prefix)
        self.services.table.delete_item(Key={'PK': owner_partition(user_id), 'SK': f'STRUCTURE#{structure_id}'})
        return response(200, {'deleted': True, 'structureId': structure_id})

    def list_md_trajectories(self, user_id: str, project_id: str) -> dict[str, Any]:
        require_project(self.services, user_id, project_id)
        items = [item for item in self.services.list_project_items(project_id, 'MD_TRAJECTORY') if item.get('ownerId') == user_id]
        items.sort(key=lambda item: item.get('createdAt', ''), reverse=True)
        return response(200, {'trajectories': [public_item(item) for item in items]})

    def get_md_trajectory(self, user_id: str, trajectory_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'MD_TRAJECTORY', trajectory_id, 'MD_TRAJECTORY_NOT_FOUND')
        payload: dict[str, Any] = {'trajectory': public_item(item)}
        if item.get('status') == 'READY':
            try:
                payload['downloadUrl'] = self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': item['objectKey']}, ExpiresIn=900)
                simulation = self.services.get_item(user_id, 'MD_SIMULATION', item['sourceSimulationId']) if item.get('sourceSimulationId') else None
                if simulation and (not retained_locally(self.services, simulation)) and (simulation.get('computeBackend') in {CLOUD_BACKEND, PAID_BACKEND, PILOT_FLEET_BACKEND}):
                    prefix = str(simulation['outputPrefix']) + '/'
                    if not str(item['objectKey']).startswith(prefix):
                        raise ApiError(409, 'Cloud trajectory identity changed.', 'MD_RESULT_INVALID')
                    payload['downloadUrl'] = local_artifact_url(self.services, simulation, str(item['objectKey'])[len(prefix):])
                if not item.get('sourceSimulationId') and (not retained_locally(self.services, item)) and (not getattr(self.services, 'local_workspace', False)):
                    payload['downloadUrl'] = local_artifact_url(self.services, item, 'source')
                payload['expiresIn'] = 900
            except Exception as exc:
                raise ApiError(502, 'Trajectory download could not be prepared.', 'MD_DOWNLOAD_PREPARE_FAILED') from exc
        return response(200, payload)

    def update_md_trajectory(self, user_id: str, trajectory_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = require_owner_item(self.services, user_id, 'MD_TRAJECTORY', trajectory_id, 'MD_TRAJECTORY_NOT_FOUND')
        if not payload or set(payload) - {'name', 'studioSettings', 'baseRevision', 'clientMutationId'}:
            raise ApiError(400, 'Trajectory update is invalid.', 'INVALID_MD_TRAJECTORY_UPDATE')
        if not {'name', 'studioSettings'} & set(payload):
            raise ApiError(400, 'Trajectory update has no changes.', 'INVALID_MD_TRAJECTORY_UPDATE')
        current_revision = int(current.get('revision', 0))
        base_revision = payload.get('baseRevision', current_revision)
        if isinstance(base_revision, bool) or not isinstance(base_revision, int) or base_revision < 0:
            raise ApiError(400, 'Trajectory revision is invalid.', 'INVALID_MD_TRAJECTORY_REVISION')
        mutation_id = None
        if 'clientMutationId' in payload:
            mutation_id = md_idempotency_key(payload.get('clientMutationId'))
            if current.get('lastClientMutationId') == mutation_id:
                return response(200, {'trajectory': public_item(current), 'idempotentReplay': True})
        if base_revision != current_revision:
            raise ApiError(409, 'Trajectory changed in another session. Reload it before saving again.', 'MD_TRAJECTORY_CONFLICT')
        updates: dict[str, Any] = {'updatedAt': utc_now(), 'revision': current_revision + 1}
        if 'name' in payload:
            updates['name'] = clean_text(payload.get('name'), 'Trajectory name', minimum=1, maximum=200)
        if 'studioSettings' in payload:
            updates['studioSettings'] = normalize_md_studio_settings(payload.get('studioSettings'))
        if mutation_id is not None:
            updates['lastClientMutationId'] = mutation_id
        updated = self.services.update_item_if_revision(user_id, 'MD_TRAJECTORY', trajectory_id, current_revision, updates)
        if updated is None:
            raise ApiError(409, 'Trajectory changed in another session. Reload it before saving again.', 'MD_TRAJECTORY_CONFLICT')
        return response(200, {'trajectory': public_item(updated)})

    def delete_md_trajectory(self, user_id: str, trajectory_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'MD_TRAJECTORY', trajectory_id, 'MD_TRAJECTORY_NOT_FOUND')
        analyses = [analysis for analysis in self.services.list_project_items(item['projectId'], 'MD_ANALYSIS') if analysis.get('ownerId') == user_id]
        if any((analysis.get('trajectoryId') == trajectory_id and analysis.get('status') not in FINAL_JOB_STATES for analysis in analyses)):
            raise ApiError(409, 'Trajectory is connected to an active MD analysis.', 'MD_TRAJECTORY_IN_USE')
        if int(item.get('sizeBytes') or 0) > 64 * 1024 ** 2:
            from backend.local_api.domain.md_multipart import MdMultipart
            MdMultipart(self.services).abort(user_id, trajectory_id)
        prefix = f"users/{storage_owner(user_id)}/projects/{item['projectId']}/md/trajectories/{trajectory_id}/"
        self.services.delete_s3_prefix(prefix)
        self.services.table.delete_item(Key={'PK': owner_partition(user_id), 'SK': f'MD_TRAJECTORY#{trajectory_id}'})
        return response(200, {'deleted': True, 'trajectoryId': trajectory_id})

    def md_trajectory_upload_ticket(self, item: dict[str, Any]) -> dict[str, Any]:
        if int(item['sizeBytes']) > 64 * 1024 ** 2:
            from backend.local_api.domain.md_multipart import MdMultipart
            return MdMultipart(self.services).ticket(item)
        content_type = str(item['contentType'])
        sha256 = str(item['sha256'])
        size_bytes = int(item['sizeBytes'])
        checksum_sha256 = base64.b64encode(bytes.fromhex(sha256)).decode('ascii')
        tagging = 'phynite-retention=md-upload-pending'
        upload = self.services.s3.generate_presigned_post(Bucket=self.services.bucket, Key=item['objectKey'], Fields={'Content-Type': content_type, 'x-amz-server-side-encryption': 'AES256', 'x-amz-meta-sha256': sha256, 'x-amz-checksum-algorithm': 'SHA256', 'x-amz-checksum-sha256': checksum_sha256, 'x-amz-tagging': tagging}, Conditions=[{'Content-Type': content_type}, {'x-amz-server-side-encryption': 'AES256'}, {'x-amz-meta-sha256': sha256}, {'x-amz-checksum-algorithm': 'SHA256'}, {'x-amz-checksum-sha256': checksum_sha256}, {'x-amz-tagging': tagging}, ['content-length-range', size_bytes, size_bytes]], ExpiresIn=900)
        return {'url': upload['url'], 'method': 'POST', 'fields': upload['fields'], 'expiresIn': 900, 'maxBytes': MAX_MD_TRAJECTORY_BYTES}

    def create_md_trajectory_upload(self, user_id: str, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = require_project(self.services, user_id, project_id)
        allowed = {'filename', 'contentType', 'sizeBytes', 'sha256', 'idempotencyKey', 'name', 'studioSettings'}
        if set(payload) - allowed:
            raise ApiError(400, 'Trajectory upload request contains unsupported fields.', 'INVALID_MD_UPLOAD')
        filename = safe_filename(payload.get('filename'))
        extension = Path(filename).suffix.lower()
        trajectory_format = 'phynite-frame' if filename.lower().endswith('.phynite-md.json') else 'poscar' if Path(filename).name.upper() in {'POSCAR', 'CONTCAR'} else MD_TRAJECTORY_FORMATS.get(extension)
        if trajectory_format is None:
            raise ApiError(400, 'Trajectory format is not supported.', 'INVALID_MD_FORMAT')
        content_type = clean_text(payload.get('contentType', 'application/octet-stream'), 'Content type', minimum=1, maximum=120).lower()
        if content_type not in MD_CONTENT_TYPES:
            raise ApiError(400, 'Trajectory content type is not supported.', 'INVALID_MD_CONTENT_TYPE')
        size_bytes = md_integer(payload.get('sizeBytes'), 'Trajectory size', 1, MAX_PERSONAL_MD_RESULT_BYTES, 'INVALID_MD_UPLOAD')
        sha256 = clean_text(payload.get('sha256'), 'SHA-256', minimum=64, maximum=64).lower()
        if not re.fullmatch('[a-f0-9]{64}', sha256):
            raise ApiError(400, 'Trajectory SHA-256 is invalid.', 'INVALID_MD_CHECKSUM')
        idempotency_key = md_idempotency_key(payload.get('idempotencyKey'))
        name = clean_text(payload.get('name', filename), 'Trajectory name', minimum=1, maximum=200)
        studio_settings = normalize_md_studio_settings(payload.get('studioSettings')) if 'studioSettings' in payload else None
        fingerprint = hashlib.sha256(json.dumps({'projectId': project_id, 'filename': filename, 'contentType': content_type, 'sizeBytes': size_bytes, 'sha256': sha256}, separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest()
        trajectory_id = f"mdt_{hashlib.sha256(f'{user_id}:{idempotency_key}'.encode('utf-8')).hexdigest()[:32]}"
        existing = self.services.get_item(user_id, 'MD_TRAJECTORY', trajectory_id)
        if existing:
            if existing.get('idempotencyKey') != idempotency_key or existing.get('requestFingerprint') != fingerprint:
                raise ApiError(409, 'Idempotency key was already used for another trajectory.', 'IDEMPOTENCY_CONFLICT')
            ticket = self.md_trajectory_upload_ticket(existing) if existing.get('status') == 'UPLOAD_PENDING' else None
            return response(200, {'trajectory': public_item(existing), 'upload': ticket, 'idempotentReplay': True})
        project_trajectories = [item for item in self.services.list_project_items(project_id, 'MD_TRAJECTORY') if item.get('ownerId') == user_id]
        if len(project_trajectories) >= MAX_MD_TRAJECTORIES_PER_PROJECT:
            raise ApiError(409, 'This project has reached its trajectory limit.', 'MD_TRAJECTORY_LIMIT')
        retained_bytes = sum((max(0, int(item.get('sizeBytes') or 0)) for item in project_trajectories))
        if retained_bytes + size_bytes > MAX_MD_TRAJECTORY_BYTES_PER_PROJECT:
            raise ApiError(409, 'This project has reached its retained trajectory storage limit.', 'MD_TRAJECTORY_STORAGE_LIMIT')
        project_tags = md_project_tags(project.get('tags'), trajectory_format)
        if project_tags != project.get('tags'):
            self.services.update_item(user_id, 'PROJECT', project_id, {'tags': project_tags, 'updatedAt': utc_now()})
        timestamp = utc_now()
        object_key = f'users/{storage_owner(user_id)}/projects/{project_id}/md/trajectories/{trajectory_id}/source/{filename}'
        item = {'PK': owner_partition(user_id), 'SK': f'MD_TRAJECTORY#{trajectory_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'MD_TRAJECTORY#{timestamp}#{trajectory_id}', 'entityType': 'MD_TRAJECTORY', 'id': trajectory_id, 'projectId': project_id, 'ownerId': user_id, 'filename': filename, 'name': name, 'format': trajectory_format, 'contentType': content_type, 'sizeBytes': size_bytes, 'sha256': sha256, 'status': 'UPLOAD_PENDING', 'objectKey': object_key, 'idempotencyKey': idempotency_key, 'requestFingerprint': fingerprint, 'createdAt': timestamp, 'updatedAt': timestamp, 'revision': 0}
        if studio_settings is not None:
            item['studioSettings'] = studio_settings
        try:
            self.services.put_item(item, 'attribute_not_exists(PK)')
        except Exception:
            existing = self.services.get_item(user_id, 'MD_TRAJECTORY', trajectory_id)
            if not existing or existing.get('requestFingerprint') != fingerprint:
                raise
            return response(200, {'trajectory': public_item(existing), 'upload': self.md_trajectory_upload_ticket(existing) if existing.get('status') == 'UPLOAD_PENDING' else None, 'idempotentReplay': True})
        try:
            ticket = self.md_trajectory_upload_ticket(item)
        except Exception as exc:
            raise ApiError(502, 'Trajectory upload could not be prepared.', 'MD_UPLOAD_PREPARE_FAILED') from exc
        return response(201, {'trajectory': public_item(item), 'upload': ticket})

    def complete_md_trajectory(self, user_id: str, trajectory_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if set(payload) - {'sizeBytes', 'sha256'}:
            raise ApiError(400, 'Trajectory completion request contains unsupported fields.', 'INVALID_MD_UPLOAD')
        item = require_owner_item(self.services, user_id, 'MD_TRAJECTORY', trajectory_id, 'MD_TRAJECTORY_NOT_FOUND')
        if item.get('status') == 'READY':
            return response(200, {'trajectory': public_item(item), 'idempotentReplay': True})
        if item.get('status') != 'UPLOAD_PENDING':
            raise ApiError(409, 'Trajectory upload cannot be completed in its current state.', 'MD_TRAJECTORY_STATE')
        if payload.get('sizeBytes') is not None and payload.get('sizeBytes') != item.get('sizeBytes'):
            raise ApiError(409, 'Uploaded trajectory size does not match the upload ticket.', 'MD_UPLOAD_MISMATCH')
        if payload.get('sha256') is not None and str(payload.get('sha256')).lower() != item.get('sha256'):
            raise ApiError(409, 'Uploaded trajectory checksum does not match the upload ticket.', 'MD_UPLOAD_MISMATCH')
        try:
            metadata = self.services.s3.head_object(Bucket=self.services.bucket, Key=item['objectKey'], ChecksumMode='ENABLED')
        except Exception as exc:
            raise ApiError(409, 'Trajectory upload was not found in storage.', 'MD_UPLOAD_MISSING') from exc
        if int(metadata.get('ContentLength') or -1) != int(item['sizeBytes']):
            raise ApiError(409, 'Uploaded trajectory size does not match the upload ticket.', 'MD_UPLOAD_MISMATCH')
        object_sha256 = str((metadata.get('Metadata') or {}).get('sha256') or '').lower()
        if not hmac.compare_digest(object_sha256, str(item['sha256'])):
            raise ApiError(409, 'Uploaded trajectory checksum metadata is missing or invalid.', 'MD_UPLOAD_MISMATCH')
        object_checksum = str(metadata.get('ChecksumSHA256') or '')
        expected_checksum = base64.b64encode(bytes.fromhex(str(item['sha256']))).decode('ascii')
        from backend.local_api.domain.md_multipart import MdMultipart
        multipart = MdMultipart(self.services).record(user_id, trajectory_id) if int(item['sizeBytes']) > 64 * 1024 ** 2 else {}
        if multipart.get('uploadId'):
            expected_checksum = str(multipart.get('completedChecksum') or '')
            if not expected_checksum:
                raise ApiError(409, 'Complete the multipart upload before finalizing.', 'MD_UPLOAD_INCOMPLETE')
        if not hmac.compare_digest(object_checksum, expected_checksum):
            raise ApiError(409, 'Uploaded trajectory checksum does not match the upload ticket.', 'MD_UPLOAD_MISMATCH')
        if str(metadata.get('ContentType') or '').lower() != str(item['contentType']):
            raise ApiError(409, 'Uploaded trajectory content type does not match the upload ticket.', 'MD_UPLOAD_MISMATCH')
        try:
            self.services.s3.put_object_tagging(Bucket=self.services.bucket, Key=item['objectKey'], Tagging={'TagSet': [{'Key': 'phynite-retention', 'Value': 'md-source'}]})
        except Exception as exc:
            raise ApiError(502, 'Trajectory retention could not be finalized.', 'MD_UPLOAD_FINALIZE_FAILED') from exc
        timestamp = utc_now()
        updated = self.services.update_item(user_id, 'MD_TRAJECTORY', trajectory_id, {'status': 'READY', 'uploadedAt': timestamp, 'updatedAt': timestamp, 'eTag': str(metadata.get('ETag') or '').strip('"')[:128]})
        return response(200, {'trajectory': public_item(updated)})

    def create_md_analysis(self, user_id: str, project_id: str, payload: dict[str, Any], worker_api_url: str | None=None) -> dict[str, Any]:
        del worker_api_url
        require_local_target(payload)
        affinity = normalize_execution_affinity(payload.get('executionAffinity'))
        if affinity is not None:
            raise ApiError(400, 'Remote MD is not available. Use Your computer for MD.', 'MD_HPC_UNAVAILABLE')
        if affinity is not None and 'personal' != 'personal':
            raise ApiError(400, 'Scheduler jobs run on owner-paired personal compute.', 'INVALID_EXECUTION_AFFINITY')
        require_project(self.services, user_id, project_id)
        allowed = {'trajectoryId', 'pipeline', 'idempotencyKey', 'name', 'vcpus', 'memoryMiB', 'computeTarget', 'cloudMode', 'computeProfileId', 'quoteId', 'sourceImport', 'sourceImportPeriodic', 'executionAffinity'}
        if set(payload) - allowed:
            raise ApiError(400, 'MD analysis request contains unsupported fields.', 'INVALID_MD_ANALYSIS')
        worker = self.services.get_item(user_id, 'PERSONAL_WORKER', 'primary') or {}
        if not worker.get('tokenHash'):
            raise ApiError(409, 'Connect your computer before starting trajectory analysis.', 'PERSONAL_COMPUTER_REQUIRED')
        if 'md-analysis' not in set(worker.get('capabilities') or []):
            raise ApiError(409, 'Update and restart personal compute to install the OVITO runtime.', 'MD_RUNTIME_REQUIRED')
        trajectory_id = clean_text(payload.get('trajectoryId'), 'Trajectory ID', minimum=1, maximum=96)
        trajectory = require_owner_item(self.services, user_id, 'MD_TRAJECTORY', trajectory_id, 'MD_TRAJECTORY_NOT_FOUND')
        if trajectory.get('projectId') != project_id:
            raise ApiError(409, 'Trajectory does not belong to this project.', 'PROJECT_MISMATCH')
        if trajectory.get('status') != 'READY':
            raise ApiError(409, 'Complete the trajectory upload before starting analysis.', 'MD_TRAJECTORY_NOT_READY')
        pipeline = normalize_md_pipeline(payload.get('pipeline'))
        if 'sourceImport' in payload and (not isinstance(payload['sourceImport'], bool)):
            raise ApiError(400, 'Source import must be a boolean.', 'INVALID_MD_PIPELINE')
        source_import = payload.get('sourceImport') is True
        if source_import and (pipeline['typeMap'] or any((modifier['enabled'] for modifier in pipeline['modifiers'])) or pipeline['frameRange'] != {'start': 0, 'stop': None, 'stride': 1}):
            raise ApiError(400, 'Source imports must preserve every original frame and particle.', 'INVALID_MD_PIPELINE')
        pipeline_fingerprint = hashlib.sha256(json.dumps(pipeline, separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest()
        idempotency_key = md_idempotency_key(payload.get('idempotencyKey'))
        resources = personal_resources(self.services, user_id, 'md-analysis', payload) if 'personal' == 'personal' and affinity is None else payload
        max_vcpus = 65536 if affinity else max(1, int(getattr(self.services, 'max_md_job_vcpus', 8)))
        max_memory_mib = 1024 ** 3 if affinity else max(2048, int(getattr(self.services, 'max_md_job_memory', 16384)))
        vcpus = md_integer(resources.get('vcpus', min(4, max_vcpus)), 'Requested MD vCPU count', 1, max_vcpus, 'INVALID_MD_RESOURCES')
        minimum_memory_mib = 1024 if affinity else max(1024, vcpus * 1024)
        memory_mib = md_integer(resources.get('memoryMiB', min(max(4096, vcpus * 2048), max_memory_mib)), 'Requested MD memory', minimum_memory_mib, max_memory_mib, 'INVALID_MD_RESOURCES')
        name = clean_text(payload.get('name', f"Analyze {trajectory['filename']}"), 'Analysis name', minimum=1, maximum=160)
        request_fingerprint = hashlib.sha256(json.dumps({'projectId': project_id, 'trajectoryId': trajectory_id, 'pipeline': pipeline, 'pipelineFingerprint': pipeline_fingerprint, 'sourceImport': source_import, **{}, 'name': name, 'vcpus': vcpus, 'memoryMiB': memory_mib, **({'executionAffinity': affinity} if affinity else {})}, separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest()
        analysis_id = f"mda_{hashlib.sha256(f'{user_id}:{idempotency_key}'.encode('utf-8')).hexdigest()[:32]}"
        existing = self.services.get_item(user_id, 'MD_ANALYSIS', analysis_id)
        if existing:
            if existing.get('idempotencyKey') != idempotency_key or existing.get('requestFingerprint') != request_fingerprint:
                raise ApiError(409, 'Idempotency key was already used for another MD analysis.', 'IDEMPOTENCY_CONFLICT')
            return response(200 if existing.get('status') in FINAL_JOB_STATES else 202, {'analysis': public_item(existing), 'idempotentReplay': True})
        project_analyses = [item for item in self.services.list_project_items(project_id, 'MD_ANALYSIS') if item.get('ownerId') == user_id]
        active_count = sum((item.get('status') not in FINAL_JOB_STATES for item in project_analyses))
        if active_count >= MAX_ACTIVE_MD_ANALYSES_PER_PROJECT:
            raise ApiError(409, 'This project has too many active MD analyses.', 'MD_ANALYSIS_LIMIT')
        timestamp = utc_now()
        owner_path = storage_owner(user_id)
        base_prefix = f'users/{owner_path}/projects/{project_id}/md/analyses/{analysis_id}'
        input_key = f'{base_prefix}/input.json'
        output_prefix = f'{base_prefix}/output'
        job_payload = {'version': 1, 'kind': 'md-analysis', 'calculationId': analysis_id, 'analysisId': analysis_id, 'projectId': project_id, 'source': {'id': trajectory_id, 'objectKey': trajectory['objectKey'], 'filename': trajectory['filename'], 'sha256': trajectory['sha256'], 'sizeBytes': int(trajectory['sizeBytes'])}, 'pipeline': pipeline, 'pipelineFingerprint': pipeline_fingerprint, **({'executionAffinity': affinity} if affinity else {}), 'submittedAt': timestamp}
        item = {'PK': owner_partition(user_id), 'SK': f'MD_ANALYSIS#{analysis_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'MD_ANALYSIS#{timestamp}#{analysis_id}', 'entityType': 'MD_ANALYSIS', 'jobKind': 'md-analysis', 'id': analysis_id, 'projectId': project_id, 'trajectoryId': trajectory_id, 'sourceSha256': trajectory['sha256'], 'ownerId': user_id, 'name': name, 'status': 'QUEUED', 'progress': 0, 'statusMessage': 'Waiting for your computer', 'vcpus': vcpus, 'memoryMiB': memory_mib, **({'executionAffinity': affinity} if affinity else {}), 'computeBackend': 'LOCAL_MAC', 'computeTarget': 'personal', 'pipelineVersion': 1, 'pipelineFingerprint': pipeline_fingerprint, 'sourceImport': source_import, 'sourceImportPeriodic': pipeline['periodic'] if source_import else [], 'inputKey': input_key, 'outputPrefix': output_prefix, 'idempotencyKey': idempotency_key, 'requestFingerprint': request_fingerprint, 'GSI2PK': f'LOCAL_QUEUE#personal#{owner_path}', 'GSI2SK': f'QUEUED#{timestamp}#{analysis_id}', 'createdAt': timestamp, 'updatedAt': timestamp}
        try:
            self.services.put_item(item, 'attribute_not_exists(PK)')
        except Exception:
            existing = self.services.get_item(user_id, 'MD_ANALYSIS', analysis_id)
            if not existing or existing.get('requestFingerprint') != request_fingerprint:
                raise
            return response(200 if existing.get('status') in FINAL_JOB_STATES else 202, {'analysis': public_item(existing), 'idempotentReplay': True})
        try:
            self.services.s3.put_object(Bucket=self.services.bucket, Key=input_key, Body=json.dumps(job_payload, separators=(',', ':')).encode('utf-8'), ContentType='application/json', ServerSideEncryption='AES256', Tagging='phynite-retention=md-analysis-input')
        except Exception as exc:
            self.services.update_item(user_id, 'MD_ANALYSIS', analysis_id, {'status': 'FAILED', 'failureReason': 'MD analysis input upload failed', 'updatedAt': utc_now()})
            raise ApiError(502, 'MD analysis input could not be stored.', 'MD_ANALYSIS_INPUT_UPLOAD_FAILED') from exc
        return response(202, {'analysis': public_item(item)})

    def list_md_analyses(self, user_id: str, project_id: str) -> dict[str, Any]:
        require_project(self.services, user_id, project_id)
        items = [item for item in self.services.list_project_items(project_id, 'MD_ANALYSIS') if item.get('ownerId') == user_id]
        items.sort(key=lambda item: item.get('createdAt', ''), reverse=True)
        return response(200, {'analyses': [public_item(item) for item in items]})

    def _reconcile_expired_cancel(self, user_id: str, entity_type: str, item_id: str, item: dict[str, Any], not_found_code: str, backends: set[str] | None=None) -> dict[str, Any]:
        """Polling resolves abandoned cancellation without overwriting a renewed lease."""
        now_epoch = int(time.time())
        if item.get('computeBackend') in (backends or {'LOCAL_MAC'}) and item.get('status') == 'CANCEL_REQUESTED' and (int(item.get('leaseExpiresAtEpoch') or 0) < now_epoch):
            try:
                return self.services.cancel_expired_local_calculation(item, now_epoch, utc_now())
            except Exception:
                return require_owner_item(self.services, user_id, entity_type, item_id, not_found_code)
        return item

    def get_md_analysis(self, user_id: str, analysis_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'MD_ANALYSIS', analysis_id, 'MD_ANALYSIS_NOT_FOUND')
        item = self._reconcile_expired_cancel(user_id, 'MD_ANALYSIS', analysis_id, item, 'MD_ANALYSIS_NOT_FOUND')
        if item.get('status') == 'FINALIZING':
            item, _ = finalize_md_analysis_result(self.services, item, utc_now())
        payload: dict[str, Any] = {'analysis': public_item(item)}
        artifacts_expire_epoch = int(item.get('artifactsExpireAtEpoch') or 0)
        artifacts_expired = not retained_locally(self.services, item) and artifacts_expire_epoch > 0 and (artifacts_expire_epoch <= int(time.time()))
        payload['artifactsAvailable'] = item.get('status') == 'COMPLETED' and (not artifacts_expired)
        payload['artifactsExpired'] = artifacts_expired
        if item.get('status') in {'FAILED', 'CANCELLED'} and item.get('outputPrefix') and not artifacts_expired:
            try:
                diagnostics = read_md_diagnostic_manifest(self.services, item)
                for artifact in diagnostics['artifacts']:
                    artifact['downloadUrl'] = self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': f"{item['outputPrefix']}/{artifact['path']}"}, ExpiresIn=900)
                payload['result'] = diagnostics
                payload['artifactsAvailable'] = bool(diagnostics['artifacts'])
            except Exception:
                # Preserve the failure record even when its diagnostic upload
                # was interrupted or fails verification. Never invent a result.
                payload['diagnosticsError'] = 'The retained analysis log is unavailable or could not be verified.'
        if item.get('status') == 'COMPLETED' and item.get('outputPrefix') and (not artifacts_expired):
            try:
                manifest = read_md_result_manifest(self.services, item)
            except MdResultError as exc:
                raise ApiError(409, 'MD result manifest could not be verified.', 'MD_RESULT_INVALID') from exc
            except Exception as exc:
                raise ApiError(503, 'MD result manifest is temporarily unavailable.', 'MD_RESULT_UNAVAILABLE') from exc
            payload['result'] = {'version': manifest['version'], 'kind': 'md-analysis', 'status': manifest['status'], 'calculationId': item['id'], 'sourceSha256': manifest.get('sourceSha256'), 'summary': md_result_summary(manifest), 'verifiedManifestSha256': hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'artifactInventory': {'count': len(manifest['artifacts']), 'sha256': hashlib.sha256(json.dumps(manifest['artifacts'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()}}
            payload['resultManifestUrl'] = self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': f"{item['outputPrefix']}/result.json"}, ExpiresIn=900)
            if not retained_locally(self.services, item) and item.get('computeBackend') in {PAID_BACKEND, PILOT_FLEET_BACKEND}:
                payload['resultManifestUrl'] = local_artifact_url(self.services, item, 'result.json')
            payload['resultManifestExpiresIn'] = 900
        return response(200, payload)

    def get_md_analysis_artifact(self, user_id: str, analysis_id: str, artifact_path: str) -> dict[str, Any]:
        diagnostic = bool(MD_DIAGNOSTIC_PATH.fullmatch(artifact_path))
        if not MD_ARTIFACT_PATH.fullmatch(artifact_path) and not diagnostic:
            raise ApiError(400, 'MD artifact path is invalid.', 'INVALID_MD_ARTIFACT')
        item = require_owner_item(self.services, user_id, 'MD_ANALYSIS', analysis_id, 'MD_ANALYSIS_NOT_FOUND')
        if item.get('status') == 'FINALIZING':
            item, _ = finalize_md_analysis_result(self.services, item, utc_now())
        if item.get('status') != 'COMPLETED' and not (diagnostic and item.get('status') in {'FAILED', 'CANCELLED'}):
            raise ApiError(409, 'MD analysis artifacts are not ready.', 'MD_ARTIFACT_NOT_READY')
        artifacts_expire_epoch = int(item.get('artifactsExpireAtEpoch') or 0)
        if not retained_locally(self.services, item) and artifacts_expire_epoch > 0 and artifacts_expire_epoch <= int(time.time()):
            raise ApiError(410, 'MD analysis artifacts have expired.', 'MD_ARTIFACT_EXPIRED')
        try:
            manifest = read_md_diagnostic_manifest(self.services, item) if diagnostic else read_md_result_manifest(self.services, item)
        except MdResultError as exc:
            raise ApiError(409, 'MD result manifest could not be verified.', 'MD_RESULT_INVALID') from exc
        except Exception as exc:
            raise ApiError(503, 'MD result manifest is temporarily unavailable.', 'MD_RESULT_UNAVAILABLE') from exc
        artifact = next((candidate for candidate in manifest['artifacts'] if candidate['path'] == artifact_path), None)
        if artifact is None:
            raise ApiError(404, 'MD analysis artifact was not found.', 'MD_ARTIFACT_NOT_FOUND')
        url = self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': f"{item['outputPrefix']}/{artifact_path}"}, ExpiresIn=900)
        if item.get('computeBackend') in {PAID_BACKEND, PILOT_FLEET_BACKEND}:
            url = local_artifact_url(self.services, item, artifact_path)
        return response(200, {'url': url, 'path': artifact_path, 'contentType': artifact['contentType'], **({'contentEncoding': artifact['contentEncoding']} if artifact.get('contentEncoding') else {}), 'sizeBytes': artifact['sizeBytes'], 'sha256': artifact['sha256'], 'expiresIn': 900})

    def cancel_md_analysis(self, user_id: str, analysis_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'MD_ANALYSIS', analysis_id, 'MD_ANALYSIS_NOT_FOUND')
        item = self._reconcile_expired_cancel(user_id, 'MD_ANALYSIS', analysis_id, item, 'MD_ANALYSIS_NOT_FOUND')
        if item.get('status') == 'CANCEL_REQUESTED':
            return response(202, {'analysis': public_item(item), 'idempotentReplay': True})
        if item.get('status') == 'CANCELLED':
            return response(200, {'analysis': public_item(item), 'idempotentReplay': True})
        if item.get('status') in FINAL_JOB_STATES:
            raise ApiError(409, 'MD analysis has already finished.', 'MD_ANALYSIS_FINAL')
        try:
            if item.get('status') == 'QUEUED':
                updated = self.services.cancel_queued_local_calculation(item, utc_now())
                return response(200, {'analysis': public_item(updated)})
            now_epoch = int(time.time())
            if int(item.get('leaseExpiresAtEpoch') or 0) < now_epoch:
                updated = self.services.cancel_expired_local_calculation(item, now_epoch, utc_now())
            else:
                updated = self.services.request_running_local_calculation_cancel(item, 'Cancellation requested', utc_now())
        except Exception as exc:
            raise ApiError(409, 'MD analysis finished before cancellation was applied.', 'MD_ANALYSIS_FINAL') from exc
        return response(200 if updated.get('status') == 'CANCELLED' else 202, {'analysis': public_item(updated)})

    def get_md_runtime_manifest(self, user_id: str) -> dict[str, Any]:
        worker = self.services.get_item(user_id, 'PERSONAL_WORKER', 'primary') or {}
        account = self.services.get_item(user_id, 'ACCOUNT', 'primary') or {}
        last_seen_epoch = int(worker.get('lastSeenAtEpoch') or 0)
        connected = bool(worker.get('tokenHash')) and last_seen_epoch >= int(time.time()) - 90
        runtime = worker.get('runtimeManifest')
        md_capable = 'md-simulation' in set(worker.get('capabilities') or [])
        runtime_step_kinds = md_supported_workflow_step_kinds(runtime if isinstance(runtime, dict) else None)
        runtime_ready = isinstance(runtime, dict) and isinstance(runtime.get('pairStyles'), list) and bool(runtime.get('pairStyles')) and bool(runtime_step_kinds)
        if not worker.get('tokenHash'):
            personal_status = 'not-connected'
        elif not connected:
            personal_status = 'offline'
        elif not md_capable or not runtime_ready:
            personal_status = 'update-required'
        else:
            personal_status = 'connected'
        return response(200, {'manifest': {'schemaVersion': 2, 'limits': {'simulationAtoms': max(100000, min(1000000, min(8192, self.services.max_md_job_memory) * 1024 ** 2 // 8192)), 'resultTrajectoryBytes': MAX_PERSONAL_MD_RESULT_BYTES, 'vcpus': self.services.max_md_job_vcpus, 'memoryMiB': self.services.max_md_job_memory}, 'computeTargets': [{'id': 'personal', 'label': 'Your computer', 'available': connected and md_capable and runtime_ready, 'status': personal_status}, {'id': 'shared', 'label': 'Shared compute', 'available': bool(None), 'status': 'not-available-for-md'}], 'workflowVersion': 2, 'stepKinds': runtime_step_kinds, 'potentialFamilies': sorted((family for family, pair_style in MD_POTENTIAL_PAIR_STYLES.items() if isinstance(runtime, dict) and pair_style in set(runtime.get('pairStyles') or []))), 'builtInPotentials': ['lj-generic'] if isinstance(runtime, dict) and 'lj/cut' in set(runtime.get('pairStyles') or []) else [], 'manualInputRequiresDocker': not (isinstance(runtime, dict) and runtime.get('executionMode') == 'native-sandbox' and (runtime.get('manualInput') is True)), 'runtime': runtime if isinstance(runtime, dict) else None}})

    def require_md_potential_scope(self, user_id: str, project_id: str, workflow: dict[str, Any]) -> dict[str, Any] | None:
        """Resolve a project potential without allowing cross-project references."""
        potential_reference = workflow.get('potential') or {}
        if potential_reference.get('kind') != 'project':
            return None
        potential = require_owner_item(self.services, user_id, 'MD_POTENTIAL', str(potential_reference.get('assetId') or ''), 'MD_POTENTIAL_NOT_FOUND')
        if potential.get('projectId') != project_id:
            raise ApiError(409, 'Potential does not belong to this project.', 'PROJECT_MISMATCH')
        if potential.get('family') == 'meam':
            order = potential.get('libraryElementOrder')
            if not isinstance(order, list) or any((not isinstance(element, str) for element in order)) or len(order) != len(set(order)) or (set(order) != set(potential.get('elements') or [])):
                raise ApiError(409, 'This MEAM model has no verified library index order. Upload the model again and enter the element order used by its indexed parameter file.', 'MEAM_LIBRARY_ORDER_REQUIRED')
        return potential

    def md_potential_upload_ticket(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        uploads: list[dict[str, Any]] = []
        for file_item in item['files']:
            sha256 = str(file_item['sha256'])
            size_bytes = int(file_item['sizeBytes'])
            checksum = base64.b64encode(bytes.fromhex(sha256)).decode('ascii')
            tagging = 'phynite-retention=md-potential-pending'
            upload = self.services.s3.generate_presigned_post(Bucket=self.services.bucket, Key=file_item['objectKey'], Fields={'Content-Type': 'application/octet-stream', 'x-amz-server-side-encryption': 'AES256', 'x-amz-meta-sha256': sha256, 'x-amz-checksum-algorithm': 'SHA256', 'x-amz-checksum-sha256': checksum, 'x-amz-tagging': tagging}, Conditions=[{'Content-Type': 'application/octet-stream'}, {'x-amz-server-side-encryption': 'AES256'}, {'x-amz-meta-sha256': sha256}, {'x-amz-checksum-algorithm': 'SHA256'}, {'x-amz-checksum-sha256': checksum}, {'x-amz-tagging': tagging}, ['content-length-range', size_bytes, size_bytes]], ExpiresIn=900)
            uploads.append({'filename': file_item['filename'], 'role': file_item['role'], 'url': upload['url'], 'method': 'POST', 'fields': upload['fields'], 'expiresIn': 900})
        return uploads

    def list_md_potentials(self, user_id: str, project_id: str) -> dict[str, Any]:
        require_project(self.services, user_id, project_id)
        items = [item for item in self.services.list_project_items(project_id, 'MD_POTENTIAL') if item.get('ownerId') == user_id]
        items.sort(key=lambda item: item.get('createdAt', ''), reverse=True)
        return response(200, {'potentials': [public_md_potential(item) for item in items]})

    def md_public_potential_catalog(self, user_id: str, project_id: str, payload: dict[str, Any], *, ingest: bool=False) -> dict[str, Any]:
        from backend.local_api.domain.potential_catalog import search, ingest_files
        require_project(self.services, user_id, project_id)
        allowed = {'provider', 'elements', 'query', 'id', 'libraryElementOrder'}
        if set(payload) - allowed:
            raise ApiError(400, 'Catalog accepts provider identifiers, not external URLs.', 'INVALID_POTENTIAL_CATALOG')
        try:
            if not ingest:
                return response(200, {'models': search(payload.get('provider'), payload.get('elements'), str(payload.get('query', ''))[:200])})
            model, files, provenance = ingest_files(payload.get('provider'), payload.get('id', ''), payload.get('elements'), payload.get('libraryElementOrder'))
            created = self.create_md_potential_upload(user_id, project_id, {'name': model['title'][:160], 'family': model['family'], 'elements': model['elements'], 'citation': model['citation'], 'license': model['license'], 'modelVersion': model['modelVersion'], 'validityDomain': model['validityDomain'], **({'libraryElementOrder': model['libraryElementOrder']} if model['family'] == 'meam' else {}), 'files': [{'filename': name, 'sizeBytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'role': ('library' if re.search('library|meam\\.lib', name, re.I) else 'parameter') if model['family'] == 'meam' else 'potential'} for name, raw in files]})
            potential_id = json.loads(created['body'])['potential']['id']
            item = require_owner_item(self.services, user_id, 'MD_POTENTIAL', potential_id, 'MD_POTENTIAL_NOT_FOUND')
            try:
                for stored, (filename, raw) in zip(item['files'], files, strict=True):
                    if stored['filename'] != filename:
                        raise ValueError('Catalog file mapping changed.')
                    self.services.s3.put_object(Bucket=self.services.bucket, Key=stored['objectKey'], Body=raw, ContentType='application/octet-stream', Metadata={'sha256': stored['sha256']}, ChecksumSHA256=base64.b64encode(bytes.fromhex(stored['sha256'])).decode('ascii'))
                self.complete_md_potential(user_id, potential_id, {})
                updated = self.services.update_item(user_id, 'MD_POTENTIAL', potential_id, {'repositoryProvenance': provenance})
                return response(200, {'potential': public_md_potential(updated)})
            except Exception:
                self.services.table.delete_item(Key={'PK': owner_partition(user_id), 'SK': f'MD_POTENTIAL#{potential_id}'})
                self.services.delete_s3_prefix(f'users/{storage_owner(user_id)}/projects/{project_id}/md/potentials/{potential_id}/')
                raise
        except ApiError:
            raise
        except (ValueError, TypeError, KeyError) as exc:
            raise ApiError(400, str(exc), 'INVALID_POTENTIAL_CATALOG') from exc
        except Exception as exc:
            raise ApiError(502, 'Public repository is unavailable. Try again or upload the published files.', 'POTENTIAL_REPOSITORY_UNAVAILABLE') from exc

    def create_md_potential_upload(self, user_id: str, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {'name', 'family', 'elements', 'libraryElementOrder', 'units', 'atomStyle', 'citation', 'license', 'modelVersion', 'validityDomain', 'validationEvidence', 'files', 'filename', 'sizeBytes', 'sha256', 'role'}
        if set(payload) - allowed:
            raise ApiError(400, 'Potential upload contains unsupported fields.', 'INVALID_MD_POTENTIAL')
        require_project(self.services, user_id, project_id)
        family = str(payload.get('family') or '').lower()
        if family not in MD_POTENTIAL_FAMILIES:
            raise ApiError(400, 'Potential family is not supported.', 'INVALID_MD_POTENTIAL')
        raw_elements = payload.get('elements')
        if not isinstance(raw_elements, list) or not 1 <= len(raw_elements) <= 32:
            raise ApiError(400, 'Potential element mapping is invalid.', 'INVALID_MD_POTENTIAL')
        elements: list[str] = []
        for raw in raw_elements:
            element = clean_text(raw, 'Potential element', minimum=1, maximum=3)
            if not re.fullmatch('[A-Z][a-z]?', element) or element in elements:
                raise ApiError(400, 'Potential element mapping is invalid.', 'INVALID_MD_POTENTIAL')
            elements.append(element)
        if family == 'eam' and len(elements) != 1:
            raise ApiError(400, 'EAM funcfl potentials support exactly one mapped element.', 'INVALID_MD_POTENTIAL')
        library_order = payload.get('libraryElementOrder')
        if family == 'meam':
            if not isinstance(library_order, list) or len(library_order) != len(elements) or any((not isinstance(element, str) for element in library_order)) or (len(set(library_order)) != len(library_order)) or (set(library_order) != set(elements)):
                raise ApiError(400, 'MEAM requires the explicit library element order used by the indexed parameter file, containing every model element once.', 'MEAM_LIBRARY_ORDER_REQUIRED')
        elif library_order is not None:
            raise ApiError(400, 'Library element order applies only to MEAM potentials.', 'INVALID_MD_POTENTIAL')
        raw_files = payload.get('files')
        if raw_files is None and 'filename' in payload:
            raw_files = [{'filename': payload.get('filename'), 'sizeBytes': payload.get('sizeBytes'), 'sha256': payload.get('sha256'), 'role': payload.get('role', 'potential')}]
        files = normalize_md_potential_files(raw_files, family)
        current = [item for item in self.services.list_project_items(project_id, 'MD_POTENTIAL') if item.get('ownerId') == user_id]
        if len(current) >= MAX_MD_POTENTIALS_PER_PROJECT:
            raise ApiError(409, 'This project has reached its potential asset limit.', 'MD_POTENTIAL_LIMIT')
        potential_id = new_id('mdp')
        owner_path = storage_owner(user_id)
        stored_files = [{**file_item, 'objectKey': f"users/{owner_path}/projects/{project_id}/md/potentials/{potential_id}/files/{file_item['filename']}"} for file_item in files]
        timestamp = utc_now()
        item = {'PK': owner_partition(user_id), 'SK': f'MD_POTENTIAL#{potential_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'MD_POTENTIAL#{timestamp}#{potential_id}', 'entityType': 'MD_POTENTIAL', 'id': potential_id, 'projectId': project_id, 'ownerId': user_id, 'name': clean_text(payload.get('name', files[0]['filename']), 'Potential name', minimum=1, maximum=160), 'family': family, 'elements': elements, **({'libraryElementOrder': library_order} if family == 'meam' else {}), 'units': 'metal' if payload.get('units', 'metal') == 'metal' else None, 'atomStyle': 'atomic' if payload.get('atomStyle', 'atomic') == 'atomic' else None, 'citation': clean_text(payload.get('citation', 'Not provided'), 'Potential citation', minimum=1, maximum=1000), 'license': clean_text(payload.get('license', 'Not specified'), 'Potential license', minimum=1, maximum=160), 'modelVersion': clean_text(payload.get('modelVersion', 'Unspecified'), 'Potential model version', minimum=1, maximum=1000), 'validityDomain': clean_text(payload.get('validityDomain', 'Unassessed'), 'Potential validity domain', minimum=1, maximum=1000), 'validationEvidence': clean_text(payload.get('validationEvidence') or 'Unassessed', 'Potential validation evidence', minimum=1, maximum=2000), 'modelQualification': 'user-documented' if str(payload.get('validationEvidence') or '').strip() else 'unassessed', 'files': stored_files, 'sizeBytes': sum((int(file_item['sizeBytes']) for file_item in files)), 'status': 'UPLOAD_PENDING', 'createdAt': timestamp, 'updatedAt': timestamp}
        if item['units'] is None or item['atomStyle'] is None:
            raise ApiError(400, 'Potential units and atom style are not supported.', 'INVALID_MD_POTENTIAL')
        self.services.put_item(item, 'attribute_not_exists(PK)')
        try:
            uploads = self.md_potential_upload_ticket(item)
        except Exception as exc:
            try:
                self.services.table.delete_item(Key={'PK': owner_partition(user_id), 'SK': f'MD_POTENTIAL#{potential_id}'})
                self.services.delete_s3_prefix(f'users/{owner_path}/projects/{project_id}/md/potentials/{potential_id}/')
            except Exception:
                pass
            raise ApiError(502, 'Potential upload could not be prepared.', 'MD_POTENTIAL_UPLOAD_FAILED') from exc
        return response(201, {'potential': public_md_potential(item), 'uploads': uploads})

    def complete_md_potential(self, user_id: str, potential_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if payload:
            raise ApiError(400, 'Potential completion request must be empty.', 'INVALID_MD_POTENTIAL')
        item = require_owner_item(self.services, user_id, 'MD_POTENTIAL', potential_id, 'MD_POTENTIAL_NOT_FOUND')
        if item.get('status') == 'READY':
            return response(200, {'potential': public_md_potential(item), 'idempotentReplay': True})
        if item.get('status') != 'UPLOAD_PENDING':
            raise ApiError(409, 'Potential cannot be finalized in its current state.', 'MD_POTENTIAL_STATE')
        for file_item in item.get('files') or []:
            try:
                metadata = self.services.s3.head_object(Bucket=self.services.bucket, Key=file_item['objectKey'], ChecksumMode='ENABLED')
            except Exception as exc:
                raise ApiError(409, f"Potential file {file_item['filename']} was not uploaded.", 'MD_POTENTIAL_MISSING') from exc
            expected_hash = str(file_item['sha256'])
            expected_checksum = base64.b64encode(bytes.fromhex(expected_hash)).decode('ascii')
            if int(metadata.get('ContentLength') or -1) != int(file_item['sizeBytes']) or not hmac.compare_digest(str((metadata.get('Metadata') or {}).get('sha256') or '').lower(), expected_hash) or (not hmac.compare_digest(str(metadata.get('ChecksumSHA256') or ''), expected_checksum)) or (str(metadata.get('ContentType') or '').lower() != 'application/octet-stream'):
                raise ApiError(409, f"Potential file {file_item['filename']} failed integrity checks.", 'MD_POTENTIAL_MISMATCH')
            try:
                self.services.s3.put_object_tagging(Bucket=self.services.bucket, Key=file_item['objectKey'], Tagging={'TagSet': [{'Key': 'phynite-retention', 'Value': 'md-potential'}]})
            except Exception as exc:
                raise ApiError(502, 'Potential retention could not be finalized.', 'MD_POTENTIAL_FINALIZE_FAILED') from exc
        updated = self.services.update_item(user_id, 'MD_POTENTIAL', potential_id, {'status': 'READY', 'integrityCheckedAt': utc_now(), 'updatedAt': utc_now()})
        return response(200, {'potential': public_md_potential(updated)})

    def delete_md_potential(self, user_id: str, potential_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'MD_POTENTIAL', potential_id, 'MD_POTENTIAL_NOT_FOUND')
        simulations = self.services.list_project_items(item['projectId'], 'MD_SIMULATION')
        for simulation in simulations:
            workflow = simulation.get('workflow') or {}
            if simulation.get('ownerId') == user_id and simulation.get('status') not in FINAL_JOB_STATES and ((workflow.get('potential') or {}).get('assetId') == potential_id):
                raise ApiError(409, 'Potential is used by an active simulation.', 'MD_POTENTIAL_IN_USE')
        configurations = self.services.list_project_items(item['projectId'], 'MD_CONFIGURATION')
        for configuration in configurations:
            workflow = configuration.get('workflow') or {}
            if configuration.get('ownerId') == user_id and (workflow.get('potential') or {}).get('assetId') == potential_id:
                raise ApiError(409, 'Potential is used by a saved MD configuration.', 'MD_POTENTIAL_IN_USE')
        self.services.delete_s3_prefix(f"users/{storage_owner(user_id)}/projects/{item['projectId']}/md/potentials/{potential_id}/")
        self.services.table.delete_item(Key={'PK': owner_partition(user_id), 'SK': f'MD_POTENTIAL#{potential_id}'})
        return response(200, {'deleted': True, 'potentialId': potential_id})

    def list_md_configurations(self, user_id: str, project_id: str) -> dict[str, Any]:
        require_project(self.services, user_id, project_id)
        items = [item for item in self.services.list_project_items(project_id, 'MD_CONFIGURATION') if item.get('ownerId') == user_id]
        items.sort(key=lambda item: item.get('updatedAt', ''), reverse=True)
        return response(200, {'configurations': [public_item(item) for item in items]})

    def create_md_configuration(self, user_id: str, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if set(payload) - {'name', 'workflow'}:
            raise ApiError(400, 'Saved MD configuration is invalid.', 'INVALID_MD_CONFIGURATION')
        require_project(self.services, user_id, project_id)
        existing = [item for item in self.services.list_project_items(project_id, 'MD_CONFIGURATION') if item.get('ownerId') == user_id]
        if len(existing) >= MAX_MD_CONFIGURATIONS_PER_PROJECT:
            raise ApiError(409, 'This project has reached its saved-configuration limit.', 'MD_CONFIGURATION_LIMIT')
        workflow = self.normalize_md_workflow_for_user(user_id, 'save-configuration', payload.get('workflow'))
        self.require_md_potential_scope(user_id, project_id, workflow)
        configuration_id = new_id('mdc')
        timestamp = utc_now()
        item = {'PK': owner_partition(user_id), 'SK': f'MD_CONFIGURATION#{configuration_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'MD_CONFIGURATION#{timestamp}#{configuration_id}', 'entityType': 'MD_CONFIGURATION', 'id': configuration_id, 'projectId': project_id, 'ownerId': user_id, 'name': clean_text(payload.get('name'), 'Configuration name', minimum=1, maximum=160), 'workflow': workflow, 'createdAt': timestamp, 'updatedAt': timestamp}
        self.services.put_item(item, 'attribute_not_exists(PK)')
        return response(201, {'configuration': public_item(item)})

    def normalize_md_workflow_for_user(self, user_id: str, operation: str, value: Any) -> dict[str, Any]:
        try:
            return normalize_md_simulation_workflow(value)
        except ApiError as exc:
            if exc.code == 'UNSAFE_MD_MANUAL_INPUT':
                try:
                    self.services.record_preflight_violation(user_id, operation, exc.code)
                except Exception:
                    logging.getLogger(__name__).exception('Preflight event could not be recorded')
            raise

    def update_md_configuration(self, user_id: str, configuration_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = require_owner_item(self.services, user_id, 'MD_CONFIGURATION', configuration_id, 'MD_CONFIGURATION_NOT_FOUND')
        if not payload or set(payload) - {'name', 'workflow', 'baseRevision'}:
            raise ApiError(400, 'Saved MD configuration update is invalid.', 'INVALID_MD_CONFIGURATION')
        expected_revision = payload.get('baseRevision', int(current.get('revision', 0)))
        if type(expected_revision) is not int or expected_revision != int(current.get('revision', 0)):
            raise ApiError(409, 'The MD configuration changed. Reload before saving.', 'MD_CONFIGURATION_CONFLICT')
        updates: dict[str, Any] = {'updatedAt': utc_now()}
        if 'name' in payload:
            updates['name'] = clean_text(payload.get('name'), 'Configuration name', minimum=1, maximum=160)
        if 'workflow' in payload:
            updates['workflow'] = self.normalize_md_workflow_for_user(user_id, 'update-configuration', payload.get('workflow'))
            self.require_md_potential_scope(user_id, str(current.get('projectId') or ''), updates['workflow'])
        updated = self.services.update_item_if_revision(user_id, 'MD_CONFIGURATION', configuration_id, expected_revision, {**updates, 'revision': expected_revision + 1})
        if updated is None:
            raise ApiError(409, 'The MD configuration changed. Reload before saving.', 'MD_CONFIGURATION_CONFLICT')
        return response(200, {'configuration': public_item(updated)})

    def delete_md_configuration(self, user_id: str, configuration_id: str) -> dict[str, Any]:
        require_owner_item(self.services, user_id, 'MD_CONFIGURATION', configuration_id, 'MD_CONFIGURATION_NOT_FOUND')
        self.services.table.delete_item(Key={'PK': owner_partition(user_id), 'SK': f'MD_CONFIGURATION#{configuration_id}'})
        return response(200, {'deleted': True, 'configurationId': configuration_id})

    def list_md_simulations(self, user_id: str, project_id: str) -> dict[str, Any]:
        require_project(self.services, user_id, project_id)
        items = [item for item in self.services.list_project_items(project_id, 'MD_SIMULATION') if item.get('ownerId') == user_id]
        items.sort(key=lambda item: item.get('createdAt', ''), reverse=True)
        return response(200, {'simulations': [public_item(item) for item in items]})

    def get_md_simulation(self, user_id: str, simulation_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'MD_SIMULATION', simulation_id, 'MD_SIMULATION_NOT_FOUND')
        item = self._reconcile_expired_cancel(user_id, 'MD_SIMULATION', simulation_id, item, 'MD_SIMULATION_NOT_FOUND')
        payload: dict[str, Any] = {'simulation': public_item(item)}
        if item.get('status') in FINAL_JOB_STATES:
            try:
                raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=f"{item['outputPrefix']}/result.json")['Body'].read(MAX_MD_RESULT_MANIFEST_BYTES + 1)
                if len(raw) <= MAX_MD_RESULT_MANIFEST_BYTES:
                    manifest = json.loads(raw)
                    if not isinstance(manifest, dict) or manifest.get('calculationId') != simulation_id or manifest.get('kind') != 'md-simulation':
                        raise ValueError('MD simulation result identity mismatch')
                    for artifact in manifest.get('artifacts') or []:
                        raw_path = artifact.get('path') if isinstance(artifact, dict) else None
                        if not isinstance(raw_path, str) or not re.fullmatch('[A-Za-z0-9_.\\-/]+', raw_path) or raw_path.startswith('/') or any((part in {'', '.', '..'} for part in raw_path.split('/'))):
                            raise ValueError('MD simulation artifact path is invalid')
                        if not re.fullmatch('[a-f0-9]{64}', str(artifact.get('sha256') or '')):
                            raise ValueError('MD simulation artifact digest is invalid')
                    for artifact in manifest.get('artifacts') or []:
                        if not retained_locally(self.services, item) and item.get('computeBackend') in {PAID_BACKEND, PILOT_FLEET_BACKEND, CLOUD_BACKEND}:
                            artifact['downloadUrl'] = local_artifact_url(self.services, item, artifact['path'])
                        else:
                            artifact['downloadUrl'] = self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': f"{item['outputPrefix']}/{artifact['path']}"}, ExpiresIn=900)
                    payload['result'] = manifest
            except Exception:
                pass
        return response(200, payload)

    def create_md_simulation(self, user_id: str, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {'trajectoryId', 'name', 'config', 'workflow', 'idempotencyKey', 'computeTarget', 'vcpus', 'memoryMiB', 'cloudMode', 'computeProfileId', 'quoteId', 'executionAffinity'}
        if set(payload) - allowed:
            raise ApiError(400, 'MD simulation request contains unsupported fields.', 'INVALID_MD_SIMULATION')
        if ('config' in payload) == ('workflow' in payload):
            raise ApiError(400, 'Provide exactly one MD config or workflow.', 'INVALID_MD_SIMULATION')
        require_project(self.services, user_id, project_id)
        require_local_target(payload)
        affinity = normalize_execution_affinity(payload.get('executionAffinity'))
        if affinity is not None:
            raise ApiError(400, 'Remote MD is not available. Use Your computer for MD.', 'MD_HPC_UNAVAILABLE')
        if affinity is not None and 'personal' != 'personal':
            raise ApiError(400, 'Scheduler jobs run on owner-paired personal compute.', 'INVALID_EXECUTION_AFFINITY')
        worker = self.services.get_item(user_id, 'PERSONAL_WORKER', 'primary') or {}
        if not worker.get('tokenHash'):
            raise ApiError(409, 'Connect your computer before starting an MD simulation.', 'PERSONAL_COMPUTER_REQUIRED')
        if 'md-simulation' not in set(worker.get('capabilities') or []):
            raise ApiError(409, 'Update and restart personal compute to install the LAMMPS runtime.', 'MD_RUNTIME_REQUIRED')
        runtime_manifest = worker.get('runtimeManifest') or {}
        if not isinstance(runtime_manifest.get('pairStyles'), list) or not runtime_manifest.get('pairStyles'):
            raise ApiError(409, 'Update and restart personal compute to report the installed LAMMPS styles.', 'MD_RUNTIME_REQUIRED')
        trajectory_id = clean_text(payload.get('trajectoryId'), 'Trajectory ID', minimum=1, maximum=96)
        trajectory = require_owner_item(self.services, user_id, 'MD_TRAJECTORY', trajectory_id, 'MD_TRAJECTORY_NOT_FOUND')
        if trajectory.get('projectId') != project_id:
            raise ApiError(409, 'Trajectory does not belong to this project.', 'PROJECT_MISMATCH')
        if trajectory.get('status') != 'READY':
            raise ApiError(409, 'Wait for the trajectory save to finish before running MD.', 'MD_TRAJECTORY_NOT_READY')
        legacy_config = normalize_md_simulation_config(payload.get('config')) if 'config' in payload else None
        workflow = legacy_md_config_to_workflow(legacy_config) if legacy_config is not None else self.normalize_md_workflow_for_user(user_id, 'create-simulation', payload.get('workflow'))
        potential_asset: dict[str, Any] | None = None
        potential_files: list[dict[str, Any]] = []
        potential_reference = workflow['potential']
        if potential_reference['kind'] == 'project':
            potential_asset = self.require_md_potential_scope(user_id, project_id, workflow)
            if potential_asset.get('projectId') != project_id:
                raise ApiError(409, 'Potential does not belong to this project.', 'PROJECT_MISMATCH')
            if potential_asset.get('status') != 'READY':
                raise ApiError(409, 'Complete the potential upload before running MD.', 'MD_POTENTIAL_NOT_READY')
            if potential_asset.get('family') not in MD_POTENTIAL_FAMILIES:
                raise ApiError(422, 'Potential family is not supported by this runtime.', 'MD_POTENTIAL_REQUIRED')
            potential_files = [dict(file_item) for file_item in potential_asset.get('files') or []]
            if not potential_files:
                raise ApiError(422, 'Potential has no verified files.', 'MD_POTENTIAL_REQUIRED')
        required_pair_style = MD_POTENTIAL_PAIR_STYLES.get(str(potential_asset.get('family'))) if potential_asset is not None else 'lj/cut'
        job_contract_version = 2 if legacy_config is None else 1
        runtime_requirements = md_workflow_runtime_requirements(workflow, str(required_pair_style), job_contract_version)
        runtime_failure = md_runtime_requirement_failure(runtime_manifest, runtime_requirements)
        if runtime_failure is not None:
            code, message = runtime_failure
            raise ApiError(409, message, code)
        runtime_binding = None
        if affinity is None and runtime_manifest.get('schemaVersion') == 2 and worker.get('workerId'):
            runtime_binding = {'workerId': str(worker['workerId']), 'manifestSha256': md_runtime_manifest_fingerprint(runtime_manifest)}
        idempotency_key = md_idempotency_key(payload.get('idempotencyKey'))
        resources = personal_resources(self.services, user_id, 'md-simulation', payload) if 'personal' == 'personal' and affinity is None else payload
        try:
            vcpus = int(resources.get('vcpus') or min(6, self.services.max_md_job_vcpus))
            memory_mib = int(resources.get('memoryMiB') or min(8192, self.services.max_md_job_memory))
        except (TypeError, ValueError) as exc:
            raise ApiError(400, 'Requested compute resources are invalid.', 'INVALID_RESOURCES') from exc
        max_vcpus = 65536 if affinity else self.services.max_md_job_vcpus
        max_memory = 1024 ** 3 if affinity else self.services.max_md_job_memory
        if not 1 <= vcpus <= max_vcpus or not 1024 <= memory_mib <= max_memory:
            raise ApiError(400, 'Requested compute resources exceed the local limits.', 'INVALID_RESOURCES')
        active = [item for item in self.services.list_project_items(project_id, 'MD_SIMULATION') if item.get('ownerId') == user_id and item.get('status') not in FINAL_JOB_STATES]
        if len(active) >= MAX_ACTIVE_MD_SIMULATIONS_PER_PROJECT:
            raise ApiError(409, 'This project already has too many active MD simulations.', 'MD_SIMULATION_LIMIT')
        fingerprint = hashlib.sha256(json.dumps({'projectId': project_id, 'trajectoryId': trajectory_id, 'workflow': workflow, **{}, **{}, 'vcpus': vcpus, 'memoryMiB': memory_mib, **({'executionAffinity': affinity} if affinity else {})}, separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest()
        simulation_id = f"mds_{hashlib.sha256(f'{user_id}:{idempotency_key}'.encode('utf-8')).hexdigest()[:32]}"
        existing = self.services.get_item(user_id, 'MD_SIMULATION', simulation_id)
        if existing:
            if existing.get('requestFingerprint') != fingerprint:
                raise ApiError(409, 'Idempotency key was already used for another simulation.', 'IDEMPOTENCY_CONFLICT')
            return response(200 if existing.get('status') in FINAL_JOB_STATES else 202, {'simulation': public_item(existing), 'idempotentReplay': True})
        timestamp = utc_now()
        owner_path = storage_owner(user_id)
        input_key = f'users/{owner_path}/projects/{project_id}/md/simulations/{simulation_id}/input.json'
        output_prefix = f'users/{owner_path}/projects/{project_id}/md/simulations/{simulation_id}/output'
        job_payload = {'version': job_contract_version, 'kind': 'md-simulation', 'calculationId': simulation_id, 'simulationId': simulation_id, 'projectId': project_id, 'trajectoryId': trajectory_id, 'source': {'objectKey': trajectory['objectKey'], 'filename': trajectory['filename'], 'sha256': trajectory['sha256'], 'sizeBytes': int(trajectory['sizeBytes'])}, 'sourceSelection': {'kind': 'immutable-frame-snapshot' if trajectory.get('format') == 'phynite-frame' else 'original-first-frame', 'sha256': trajectory['sha256'], 'frame': 0}, 'workflow': workflow, **({'executionAffinity': affinity} if affinity else {}), 'runtimeRequirements': runtime_requirements, **({'runtimeBinding': runtime_binding} if runtime_binding is not None else {}), **({'config': legacy_config} if legacy_config is not None else {}), **({'potentialAsset': {'id': potential_asset['id'], 'family': potential_asset['family'], 'elements': potential_asset['elements'], **({'libraryElementOrder': potential_asset['libraryElementOrder']} if potential_asset.get('family') == 'meam' else {}), 'units': potential_asset['units'], 'atomStyle': potential_asset['atomStyle'], 'citation': potential_asset['citation'], 'license': potential_asset['license'], 'modelVersion': potential_asset.get('modelVersion', 'Unspecified'), 'validityDomain': potential_asset.get('validityDomain', 'Unassessed'), 'validationEvidence': potential_asset.get('validationEvidence', 'Unassessed'), 'modelQualification': potential_asset.get('modelQualification', 'unassessed'), 'files': [{key: file_item[key] for key in ('filename', 'role', 'sizeBytes', 'sha256')} for file_item in potential_files]}, 'potentialFiles': potential_files} if potential_asset is not None else {}), 'submittedAt': timestamp}
        first_step = next((step for step in workflow['steps'] if step['enabled']), None)
        workflow_label = str(first_step['name'] if first_step else 'Manual LAMMPS')
        item = {'PK': owner_partition(user_id), 'SK': f'MD_SIMULATION#{simulation_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'MD_SIMULATION#{timestamp}#{simulation_id}', 'GSI2PK': f'LOCAL_QUEUE#personal#{owner_path}', 'GSI2SK': f'QUEUED#{timestamp}#{simulation_id}', 'entityType': 'MD_SIMULATION', 'jobKind': 'md-simulation', 'id': simulation_id, 'projectId': project_id, 'trajectoryId': trajectory_id, 'ownerId': user_id, 'name': clean_text(payload.get('name', workflow_label), 'Simulation name', minimum=1, maximum=160), 'recipeId': str(first_step['kind'] if first_step else 'manual'), **({'config': legacy_config} if legacy_config is not None else {}), 'workflow': workflow, 'workflowVersion': 2, 'runtimeRequirements': runtime_requirements, **({'runtimeBinding': runtime_binding} if runtime_binding is not None else {}), **({'potentialAssetId': potential_asset['id']} if potential_asset is not None else {}), 'status': 'QUEUED', 'progress': 0, 'statusMessage': 'Waiting for your computer', 'computeBackend': 'LOCAL_MAC', 'computeTarget': 'personal', 'vcpus': vcpus, 'memoryMiB': memory_mib, **({'executionAffinity': affinity} if affinity else {}), 'inputKey': input_key, 'outputPrefix': output_prefix, 'idempotencyKey': idempotency_key, 'requestFingerprint': fingerprint, 'createdAt': timestamp, 'updatedAt': timestamp}
        self.services.put_item(item, 'attribute_not_exists(PK)')
        try:
            self.services.s3.put_object(Bucket=self.services.bucket, Key=input_key, Body=json.dumps(job_payload, separators=(',', ':')).encode('utf-8'), ContentType='application/json', ServerSideEncryption='AES256')
        except Exception as exc:
            self.services.update_item(user_id, 'MD_SIMULATION', simulation_id, {'status': 'FAILED', 'failureReason': 'Simulation input upload failed', 'updatedAt': utc_now()})
            raise ApiError(502, 'MD simulation input could not be stored.', 'MD_SIMULATION_INPUT_FAILED') from exc
        return response(202, {'simulation': public_item(item)})

    def cancel_md_simulation(self, user_id: str, simulation_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'MD_SIMULATION', simulation_id, 'MD_SIMULATION_NOT_FOUND')
        if item.get('status') in FINAL_JOB_STATES:
            raise ApiError(409, 'MD simulation has already finished.', 'MD_SIMULATION_FINAL')
        try:
            if item.get('status') == 'QUEUED':
                updated = self.services.cancel_queued_local_calculation(item, utc_now())
                return response(200, {'simulation': public_item(updated)})
            now_epoch = int(time.time())
            if int(item.get('leaseExpiresAtEpoch') or 0) < now_epoch:
                updated = self.services.cancel_expired_local_calculation(item, now_epoch, utc_now())
            else:
                updated = self.services.request_running_local_calculation_cancel(item, 'Cancellation requested', utc_now())
        except Exception as exc:
            raise ApiError(409, 'The simulation finished before cancellation was applied.', 'MD_SIMULATION_FINAL') from exc
        return response(200 if updated.get('status') == 'CANCELLED' else 202, {'simulation': public_item(updated)})

    def create_calculation(self, user_id: str, project_id: str, payload: dict[str, Any], *, workflow_protocol: int=0) -> dict[str, Any]:
        account = self.services.get_item(user_id, 'ACCOUNT', 'primary') or {}
        require_local_target(payload)
        affinity = normalize_execution_affinity(payload.get('executionAffinity'))
        if affinity is not None and 'personal' != 'personal':
            raise ApiError(400, 'Scheduler jobs run on owner-paired personal compute.', 'INVALID_EXECUTION_AFFINITY')
        if payload.get('run', True) is not False:
            pass
        if 'personal' == 'personal' and payload.get('run', True) is not False:
            worker = self.services.get_item(user_id, 'PERSONAL_WORKER', 'primary') or {}
            if not worker.get('tokenHash'):
                raise ApiError(409, 'Connect your computer in Account before starting a personal run.', 'PERSONAL_COMPUTER_REQUIRED')
        structure_id = clean_text(payload.get('structureId'), 'Structure ID', minimum=1, maximum=96)
        structure = require_owner_item(self.services, user_id, 'STRUCTURE', structure_id, 'STRUCTURE_NOT_FOUND')
        if structure.get('projectId') != project_id:
            raise ApiError(409, 'Structure does not belong to this project.', 'PROJECT_MISMATCH')
        calculation_type = payload.get('calculationType')
        if calculation_type not in CALCULATION_TYPES:
            raise ApiError(400, 'Calculation type is not supported.', 'INVALID_CALCULATION_TYPE')
        idempotency_key: str | None = None
        if payload.get('idempotencyKey') is not None:
            idempotency_key = clean_text(payload.get('idempotencyKey'), 'Idempotency key', minimum=16, maximum=96)
            if not re.fullmatch('[A-Za-z0-9_-]+', idempotency_key):
                raise ApiError(400, 'Idempotency key contains unsupported characters.', 'INVALID_IDEMPOTENCY_KEY')
        qe_input = payload.get('qeInput')
        if not isinstance(qe_input, str) or not qe_input.strip() or len(qe_input) > 1000000:
            raise ApiError(400, 'A valid Quantum ESPRESSO input is required.', 'INVALID_QE_INPUT')
        if '&CONTROL' not in qe_input.upper() or 'ATOMIC_POSITIONS' not in qe_input.upper():
            raise ApiError(400, 'Quantum ESPRESSO input is incomplete.', 'INVALID_QE_INPUT')
        if calculation_type == 'Nudged elastic band':
            from backend.local_api.domain.neb_inputs import validate_neb_input
            try:
                validate_neb_input(qe_input)
            except ValueError as exc:
                raise ApiError(400, str(exc), 'INVALID_NEB_INPUT') from exc
        input_files = payload.get('inputFiles')
        if input_files is not None:
            if not isinstance(input_files, dict) or not 1 <= len(input_files) <= 12:
                raise ApiError(400, 'Calculation input files are invalid.', 'INVALID_INPUT_FILES')
            total_input_size = 0
            for filename, content in input_files.items():
                safe_filename(filename)
                if not isinstance(content, str) or not content.strip() or len(content) > 1000000:
                    raise ApiError(400, 'A calculation input file is invalid.', 'INVALID_INPUT_FILES')
                total_input_size += len(content.encode('utf-8'))
            if total_input_size > 4000000:
                raise ApiError(400, 'Calculation input files are too large.', 'INVALID_INPUT_FILES')
        if calculation_type == 'Nudged elastic band' and input_files is not None:
            if set(input_files) != {'neb.in'} or input_files['neb.in'].strip() != qe_input.strip():
                raise ApiError(400, 'NEB primary input must match its single retained neb.in file.', 'INVALID_NEB_INPUT')
        settings = payload.get('settings') if isinstance(payload.get('settings'), dict) else {}
        if any((str(key).startswith('_') for key in settings)):
            raise ApiError(400, 'Internal execution settings cannot be submitted by a client.', 'INVALID_EXECUTION_SETTINGS')
        try:
            validate_band_postprocessor_input(input_files if isinstance(input_files, dict) else {'pw.in': qe_input}, calculation_type)
        except ValueError as exc:
            raise ApiError(400, str(exc), 'INVALID_QE_BANDS') from exc
        try:
            validate_relaxation_input(input_files if isinstance(input_files, dict) else {'pw.in': qe_input.split('! ---------- ', 1)[0]})
        except ValueError as exc:
            raise ApiError(400, str(exc), 'INVALID_QE_RELAXATION') from exc
        if calculation_type == 'Thermoelectric properties':
            try:
                validate_transport_settings(settings)
            except ValueError as exc:
                raise ApiError(400, str(exc), 'INVALID_TRANSPORT_SETTINGS') from exc
        plot_limits: dict[str, float] = {}
        for name in ('plotXMin', 'plotXMax', 'plotYMin', 'plotYMax'):
            value = settings.get(name)
            if value is None or value == '':
                continue
            if isinstance(value, bool):
                raise ApiError(400, f'{name} must be a finite number.', 'INVALID_PLOT_RANGE')
            try:
                plot_limits[name] = float(value)
            except (TypeError, ValueError) as exc:
                raise ApiError(400, f'{name} must be a finite number.', 'INVALID_PLOT_RANGE') from exc
            if not math.isfinite(plot_limits[name]):
                raise ApiError(400, f'{name} must be a finite number.', 'INVALID_PLOT_RANGE')
        if 'plotXMin' in plot_limits and 'plotXMax' in plot_limits and (plot_limits['plotXMin'] >= plot_limits['plotXMax']):
            raise ApiError(400, 'Plot X min must be lower than Plot X max.', 'INVALID_PLOT_RANGE')
        if 'plotYMin' in plot_limits and 'plotYMax' in plot_limits and (plot_limits['plotYMin'] >= plot_limits['plotYMax']):
            raise ApiError(400, 'Plot Y min must be lower than Plot Y max.', 'INVALID_PLOT_RANGE')
        run_now = payload.get('run', True) is not False
        if run_now and (not self.services.compute_enabled):
            raise ApiError(409, 'Install and start the DFT runtime from local setup, or save this calculation as a draft.', 'COMPUTE_DISABLED')
        if run_now and False and (not getattr(self.services, 'cloud_compute_allowed', lambda _kind: True)('dft')):
            raise ApiError(409, 'Cloud compute is being disabled. Save a draft instead.', 'COMPUTE_DISABLED')
        if run_now and True and True and (affinity is None):
            try:
                k_grid = tuple((int(settings.get(name)) for name in ('kPoint', 'kPointY', 'kPointZ')))
            except (TypeError, ValueError):
                k_grid = ()
            if len(k_grid) == 3 and all((value > 0 for value in k_grid)):
                k_product = math.prod(k_grid)
                if k_product > self.services.max_local_kpoint_product:
                    formatted_grid = '×'.join((str(value) for value in k_grid))
                    raise ApiError(422, f'Local compute resource check rejected the {formatted_grid} k-grid ({k_product:,} points); this development worker is limited to {self.services.max_local_kpoint_product:,} before symmetry reduction. Reduce the grid. For a slab, set the non-periodic axis to 1.', 'LOCAL_RESOURCE_LIMIT')
        default_vcpus = min(6, self.services.max_job_vcpus)
        if affinity is not None:
            from backend.local_api.hpc_profiles import HpcProfileStore, validate_hpc_allocation
            profile = HpcProfileStore(self.services).snapshot_by_checksum(affinity['profileSha256'])
            if not profile or profile.get('scheduler') != affinity['scheduler']:
                raise ApiError(400, 'The HPC profile snapshot is unavailable in this workspace. Select a local cluster again.', 'HPC_PROFILE_SNAPSHOT_NOT_FOUND')
            allocation = validate_hpc_allocation(settings.get('hpcAllocation'), profile)
            ranks, memory = allocation['nodes'] * allocation['ranksPerNode'], allocation['nodes'] * allocation['memoryMiBPerNode']
            if payload.get('vcpus', ranks) != ranks or payload.get('memoryMiB', memory) != memory:
                raise ApiError(400, 'Requested CPU/RAM differs from the frozen HPC allocation.', 'INVALID_HPC_ALLOCATION')
            settings['hpcAllocation'] = allocation
            payload = {**payload, 'vcpus': ranks, 'memoryMiB': memory}
        resources = personal_resources(self.services, user_id, 'qe', payload) if 'personal' == 'personal' and affinity is None else payload
        try:
            vcpus = int(resources.get('vcpus') or default_vcpus)
            default_memory_mib = min(self.services.max_job_memory, 8192)
            memory_mib = int(resources.get('memoryMiB') or default_memory_mib)
        except (TypeError, ValueError) as exc:
            raise ApiError(400, 'Requested compute resources are invalid.', 'INVALID_RESOURCES') from exc
        max_vcpus = 65536 if affinity else self.services.max_job_vcpus
        max_memory = 1024 ** 3 if affinity else self.services.max_job_memory
        if vcpus < 1 or vcpus > max_vcpus:
            raise ApiError(400, 'Requested vCPU count exceeds the server limit.', 'INVALID_RESOURCES')
        if memory_mib < 1024 or memory_mib > max_memory:
            raise ApiError(400, 'Requested memory exceeds the server limit.', 'INVALID_RESOURCES')
        pseudopotentials = payload.get('pseudopotentials') or {}
        if not isinstance(pseudopotentials, dict):
            raise ApiError(400, 'Pseudopotential mapping must be an object.', 'INVALID_PSEUDOPOTENTIALS')
        user_prefix = f'users/{storage_owner(user_id)}/'
        for filename, key in pseudopotentials.items():
            safe_filename(filename)
            if not isinstance(key, str) or not key.startswith(user_prefix):
                raise ApiError(400, 'Pseudopotential objects must belong to the signed-in user.', 'INVALID_PSEUDOPOTENTIALS')
        if run_now and getattr(self.services, 'local_workspace', False):
            from backend.local_api.pseudopotentials import execution_pseudopotential_error
            pseudo_error = execution_pseudopotential_error(self.services.data_dir, {'qeInput': qe_input, 'inputFiles': input_files, 'pseudopotentials': pseudopotentials})
            if pseudo_error:
                raise ApiError(422, pseudo_error, 'PSEUDOPOTENTIALS_REQUIRED')
        dependency_ids = payload.get('dependsOnCalculationIds') or []
        if calculation_type == 'Nudged elastic band' and dependency_ids:
            raise ApiError(400, 'NEB uses fixed endpoint snapshots; save completed relaxed structures first.', 'INVALID_NEB_DEPENDENCY')
        scf_source_id = payload.get('scfSourceCalculationId')
        scf_source = None
        if scf_source_id is not None:
            from backend.local_api.domain.dft_workflows import source_metadata
            from backend.local_api.domain.dft_validation import scf_input_identity
            if calculation_type not in {'Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties'} or not isinstance(scf_source_id, str) or (not isinstance(input_files, dict)) or ('scf.in' not in input_files):
                raise ApiError(400, 'Only analysis jobs can select an SCF source.', 'INVALID_SCF_SOURCE')
            scf_source, _ = source_metadata(self.services, user_id, project_id, scf_source_id, scf_input_identity(input_files['scf.in']), calculation_type == 'Phonon dispersion')
            if not isinstance(dependency_ids, list):
                raise ApiError(400, 'Calculation dependencies are invalid.', 'INVALID_DEPENDENCIES')
            dependency_ids = list(dict.fromkeys([*dependency_ids, scf_source_id]))
        if not isinstance(dependency_ids, list) or len(dependency_ids) > 12:
            raise ApiError(400, 'Calculation dependencies are invalid.', 'INVALID_DEPENDENCIES')
        batch_dependencies: list[dict[str, str]] = []
        dependency_outputs: list[str] = []
        dependency_items: list[dict[str, Any]] = []
        for dependency_id in dependency_ids:
            dependency = require_owner_item(self.services, user_id, 'CALCULATION', clean_text(dependency_id, 'Dependency ID', minimum=1, maximum=96), 'DEPENDENCY_NOT_FOUND')
            if dependency.get('projectId') != project_id:
                raise ApiError(409, 'Dependency belongs to another project.', 'PROJECT_MISMATCH')
            if dependency.get('status') in {'FAILED', 'CANCELLED'}:
                raise ApiError(409, 'A required calculation failed or was cancelled. Rerun it successfully before submitting this calculation.', 'DEPENDENCY_FAILED')
            if dependency.get('status') == 'COMPLETED':
                dependency_error = dependency_dft_error(self.services, dependency)
                if dependency_error:
                    raise ApiError(409, dependency_error, 'DEPENDENCY_NOT_CONVERGED')
            dependency_items.append(dependency)
            if dependency.get('batchJobId'):
                batch_dependencies.append({'jobId': dependency['batchJobId']})
            if dependency.get('outputPrefix'):
                dependency_outputs.append(f"{dependency['outputPrefix']}/{('scf-workspace.tar.gz' if dependency_id == scf_source_id else 'workspace.tar.gz')}")
        structure_source = settings.get('structureSource')
        if isinstance(structure_source, dict):
            source = next((dependency for dependency in dependency_items if dependency.get('id') == structure_source.get('calculationId')), None)
            if source is None or source.get('calculationType') != 'Structural relaxation':
                raise ApiError(400, 'Select an owned structural-relaxation dependency as the input structure source.', 'INVALID_STRUCTURE_SOURCE')
        from backend.local_api.domain.shared_scf import validate_shared_scf_submission
        shared_scf = validate_shared_scf_submission(self.services, user_id, project_id, settings, dependency_items, input_files or {})
        if shared_scf:
            dependency_outputs = [f"{dependency['outputPrefix']}/{shared_scf['bundlePath']}" for dependency in dependency_items if dependency['id'] == shared_scf['calculationId']]
        request_fingerprint = hashlib.sha256(json.dumps({'projectId': project_id, 'structureId': structure_id, 'calculationType': calculation_type, 'qeInput': qe_input, 'inputFiles': input_files, 'settings': settings, 'pseudopotentials': pseudopotentials, 'dependsOnCalculationIds': dependency_ids, 'scfSourceCalculationId': scf_source_id, 'vcpus': vcpus, 'memoryMiB': memory_mib, 'computeTarget': 'personal', **({'executionAffinity': affinity} if affinity else {}), **{}}, separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest()
        calculation_id = f"calc_{hashlib.sha256(f'{user_id}:{idempotency_key}'.encode('utf-8')).hexdigest()[:32]}" if idempotency_key else new_id('calc')
        timestamp = utc_now()
        owner_path = storage_owner(user_id)
        input_key = f'users/{owner_path}/projects/{project_id}/calculations/{calculation_id}/input.json'
        output_prefix = f'users/{owner_path}/projects/{project_id}/calculations/{calculation_id}/output'
        job_payload = {'version': 2, 'calculationId': calculation_id, 'projectId': project_id, 'structureId': structure_id, 'calculationType': calculation_type, 'qeInput': qe_input, 'inputFiles': input_files, 'pseudopotentials': pseudopotentials, 'dependencyOutputKeys': dependency_outputs, **({'scfSourceCalculationId': scf_source_id} if scf_source_id else {}), 'settings': settings, **({'executionAffinity': affinity} if affinity else {}), 'submittedAt': timestamp}
        item = {'PK': owner_partition(user_id), 'SK': f'CALCULATION#{calculation_id}', 'GSI1PK': f'PROJECT#{project_id}', 'GSI1SK': f'CALCULATION#{timestamp}#{calculation_id}', 'entityType': 'CALCULATION', 'id': calculation_id, 'projectId': project_id, 'structureId': structure_id, 'ownerId': user_id, 'name': clean_text(payload.get('name', calculation_type), 'Calculation name', minimum=1, maximum=160), 'calculationType': calculation_type, 'status': 'PREPARING' if run_now else 'DRAFT', 'progress': 0, 'vcpus': vcpus, 'memoryMiB': memory_mib, 'computeTarget': 'personal', **({'executionAffinity': affinity} if affinity else {}), **{}, 'inputKey': input_key, 'outputPrefix': output_prefix, 'dependsOnCalculationIds': dependency_ids, **({'scfSourceCalculationId': scf_source_id} if scf_source_id else {}), **({'scfInputIdentity': __import__('backend.local_api.domain.dft_validation', fromlist=['scf_input_identity']).scf_input_identity(input_files.get('scf.in', qe_input)), 'retainsScfBundle': bool(settings.get('retainScfBundle'))} if calculation_type == 'Total energy' and isinstance(input_files, dict) else {}), 'createdAt': timestamp, 'updatedAt': timestamp, **({'requiresWorkflowVersion': max(1, workflow_protocol)} if shared_scf or workflow_protocol else {}), **({'idempotencyKey': idempotency_key} if idempotency_key else {}), **({'requestFingerprint': request_fingerprint} if idempotency_key else {})}
        try:
            self.services.put_item(item, 'attribute_not_exists(PK)')
        except Exception:
            existing = self.services.get_item(user_id, 'CALCULATION', calculation_id)
            if idempotency_key and existing and (existing.get('idempotencyKey') == idempotency_key):
                if existing.get('requestFingerprint') != request_fingerprint:
                    raise ApiError(409, 'Idempotency key was already used for a different calculation request.', 'IDEMPOTENCY_CONFLICT')
                existing_status = existing.get('status')
                status_code = 201 if existing_status == 'DRAFT' else 200 if existing_status in FINAL_JOB_STATES else 202
                return response(status_code, {'calculation': public_item(existing), 'idempotentReplay': True})
            raise
        try:
            self.services.s3.put_object(Bucket=self.services.bucket, Key=input_key, Body=json.dumps(job_payload, separators=(',', ':')).encode('utf-8'), ContentType='application/json', ServerSideEncryption='AES256')
        except Exception as exc:
            self.services.update_item(user_id, 'CALCULATION', calculation_id, {'status': 'FAILED', 'failureReason': 'Calculation input upload failed', 'updatedAt': utc_now()})
            raise ApiError(502, 'Calculation input could not be stored.', 'CALCULATION_INPUT_UPLOAD_FAILED') from exc
        self.record_research_event(user_id, project_id, {
            'eventType': 'calculation_submitted',
            'title': 'Calculation submitted' if run_now else 'Calculation draft saved',
            'summary': item['name'],
            'runId': calculation_id,
            'calculationId': calculation_id,
            'jobKind': 'qe',
            'inputSha256': hashlib.sha256(json.dumps(job_payload, separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest(),
            'metadata': {'status': item['status'], 'calculationType': calculation_type, 'vcpus': vcpus, 'memoryMiB': memory_mib, 'computeTarget': 'personal'},
        })
        if not run_now:
            return response(201, {'calculation': public_item(item)})
        waiting_dependency = next((dependency for dependency in dependency_items if dependency.get('status') != 'COMPLETED'), None)
        status_message = f"Waiting for {str(waiting_dependency.get('calculationType') or 'required calculation').lower()} to finish" if waiting_dependency else 'Waiting for your computer'
        item = self.services.update_item(user_id, 'CALCULATION', calculation_id, {'status': 'QUEUED', 'computeBackend': 'LOCAL_MAC', 'statusMessage': status_message, 'GSI2PK': f'LOCAL_QUEUE#personal#{storage_owner(user_id)}', 'GSI2SK': f'QUEUED#{timestamp}#{calculation_id}', 'updatedAt': utc_now()})
        return response(202, {'calculation': public_item(item)})

    def get_calculation(self, user_id: str, calculation_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'CALCULATION', calculation_id, 'CALCULATION_NOT_FOUND')
        item = self._reconcile_expired_cancel(user_id, 'CALCULATION', calculation_id, item, 'CALCULATION_NOT_FOUND', {'LOCAL_MAC', CLOUD_BACKEND, PAID_BACKEND, PILOT_FLEET_BACKEND})
        payload: dict[str, Any] = {'calculation': public_item(item)}
        artifacts_expire_epoch = int(item.get('artifactsExpireAtEpoch') or 0)
        artifacts_expired = not retained_locally(self.services, item) and artifacts_expire_epoch > 0 and (artifacts_expire_epoch <= int(time.time()))
        payload['artifactsAvailable'] = item.get('status') in FINAL_JOB_STATES and (not artifacts_expired)
        payload['artifactsExpired'] = artifacts_expired
        if item.get('status') in FINAL_JOB_STATES and item.get('outputPrefix') and (not artifacts_expired):
            result_key = f"{item['outputPrefix']}/result.json"
            payload['resultManifestUrl'] = self.services.s3.generate_presigned_url('get_object', Params={'Bucket': self.services.bucket, 'Key': result_key}, ExpiresIn=900)
            if not retained_locally(self.services, item) and item.get('computeBackend') == CLOUD_BACKEND:
                payload['resultManifestUrl'] = local_artifact_url(self.services, item, 'result.json')
            payload['resultManifestExpiresIn'] = 900
            try:
                manifest, digest = read_result_manifest(self.services, item)
                page = artifact_page(self.services, item, manifest, digest)
                manifest['artifacts'] = page['artifacts']
                manifest['artifactPagination'] = {key: value for key, value in page.items() if key != 'artifacts'}
                payload['result'] = manifest
            except Exception:
                pass
        return response(200, payload)

    def get_calculation_artifacts(self, user_id: str, calculation_id: str, query: dict[str, Any]) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'CALCULATION', calculation_id, 'CALCULATION_NOT_FOUND')
        if item.get('status') not in FINAL_JOB_STATES or not item.get('outputPrefix'):
            raise ApiError(409, 'Calculation artifacts are not ready.', 'RESULT_NOT_READY')
        if not retained_locally(self.services, item) and int(item.get('artifactsExpireAtEpoch') or 0) and (int(item['artifactsExpireAtEpoch']) <= int(time.time())):
            raise ApiError(410, 'Calculation artifacts expired. Use the retained study archive.', 'ARTIFACT_EXPIRED')
        if set(query) - {'cursor'}:
            raise ApiError(400, 'Artifact page request contains unsupported fields.', 'INVALID_ARTIFACT_PAGE')
        try:
            manifest, digest = read_result_manifest(self.services, item)
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError(409, 'The result manifest could not be read.', 'RESULT_NOT_UPLOADED') from exc
        return response(200, artifact_page(self.services, item, manifest, digest, query.get('cursor')))

    def get_calculation_files(self, user_id: str, calculation_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'CALCULATION', calculation_id, 'CALCULATION_NOT_FOUND')
        input_key = item.get('inputKey')
        if not isinstance(input_key, str) or not input_key:
            raise ApiError(404, 'Calculation input files were not found.', 'CALCULATION_FILES_NOT_FOUND')
        try:
            body = self.services.s3.get_object(Bucket=self.services.bucket, Key=input_key)['Body'].read(6000001)
        except Exception as exc:
            raise ApiError(503, 'Calculation input files are temporarily unavailable.', 'CALCULATION_FILES_UNAVAILABLE') from exc
        if len(body) > 6000000:
            raise ApiError(413, 'Calculation input files are too large to inspect.', 'CALCULATION_FILES_TOO_LARGE')
        try:
            stored = json.loads(body)
        except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError(409, 'Calculation input files could not be verified.', 'CALCULATION_FILES_INVALID') from exc
        if not isinstance(stored, dict):
            raise ApiError(409, 'Calculation input files could not be verified.', 'CALCULATION_FILES_INVALID')
        files: list[dict[str, Any]] = []

        def add_text_file(path: str, content: str, role: str='input') -> None:
            encoded = content.encode('utf-8')
            files.append({'path': path, 'name': Path(path).name, 'role': role, 'contentType': 'application/json' if path.endswith('.json') else 'text/plain', 'sizeBytes': len(encoded), 'content': content})
        raw_input_files = stored.get('inputFiles')
        input_files = raw_input_files if isinstance(raw_input_files, dict) else {}
        for raw_name, content in input_files.items():
            if not isinstance(raw_name, str) or not isinstance(content, str):
                continue
            filename = safe_filename(raw_name)
            add_text_file(f'input/{filename}', content)
        qe_input = stored.get('qeInput')
        if isinstance(qe_input, str) and qe_input.strip() and (qe_input not in input_files.values()):
            add_text_file('input/qe.in', qe_input)
        settings = stored.get('settings')
        if isinstance(settings, dict) and settings:
            add_text_file('input/settings.json', json.dumps(settings, indent=2, sort_keys=True) + '\n')
        pseudopotentials = stored.get('pseudopotentials')
        if isinstance(pseudopotentials, dict) and pseudopotentials:
            pseudo_names = sorted((safe_filename(name) for name in pseudopotentials if isinstance(name, str)))
            add_text_file('input/pseudopotentials.json', json.dumps({'files': pseudo_names}, indent=2) + '\n')
        run_record = {'calculationId': item['id'], 'projectId': item['projectId'], 'structureId': item['structureId'], 'name': item['name'], 'calculationType': item['calculationType'], 'status': item['status'], 'submittedAt': stored.get('submittedAt') or item.get('createdAt'), 'completedAt': item.get('completedAt'), 'computeBackend': item.get('computeBackend'), 'vcpus': item.get('vcpus'), 'memoryMiB': item.get('memoryMiB'), 'dependsOnCalculationIds': item.get('dependsOnCalculationIds', [])}
        add_text_file('runtime/run.json', json.dumps(json_safe(run_record), indent=2, sort_keys=True) + '\n', 'runtime')
        return response(200, {'calculation': public_item(item), 'files': files})

    def diagnose_calculation(self, user_id, calculation_id):
        require_owner_item(self.services, user_id, 'CALCULATION', calculation_id, 'CALCULATION_NOT_FOUND')
        raise ApiError(503, "Connect a local AI provider and ask the project assistant to inspect this calculation's retained logs.", 'LOCAL_AI_PROVIDER_REQUIRED')

    def cancel_calculation(self, user_id: str, calculation_id: str) -> dict[str, Any]:
        item = require_owner_item(self.services, user_id, 'CALCULATION', calculation_id, 'CALCULATION_NOT_FOUND')
        if item.get('status') in FINAL_JOB_STATES:
            raise ApiError(409, 'Calculation has already finished.', 'CALCULATION_FINAL')
        if item.get('computeBackend') in {'LOCAL_MAC', CLOUD_BACKEND, PAID_BACKEND, PILOT_FLEET_BACKEND} and item.get('status') == 'QUEUED':
            updated = self.services.cancel_queued_local_calculation(item, utc_now())
            return response(200, {'calculation': public_item(updated)})
        if item.get('computeBackend') in {'LOCAL_MAC', CLOUD_BACKEND, PAID_BACKEND, PILOT_FLEET_BACKEND} and item.get('status') in {'RUNNING', 'CANCEL_REQUESTED'}:
            try:
                now_epoch = int(time.time())
                if int(item.get('leaseExpiresAtEpoch') or 0) < now_epoch:
                    updated = self.services.cancel_expired_local_calculation(item, now_epoch, utc_now())
                else:
                    updated = self.services.request_running_local_calculation_cancel(item, 'Cancellation requested', utc_now())
            except Exception as exc:
                raise ApiError(409, 'The calculation finished before cancellation was applied.', 'CALCULATION_FINAL') from exc
            return response(200 if updated.get('status') == 'CANCELLED' else 202, {'calculation': public_item(updated)})
        updated = self.services.update_item(user_id, 'CALCULATION', calculation_id, {'status': 'CANCEL_REQUESTED', 'statusMessage': 'Cancellation requested', 'updatedAt': utc_now()})
        return response(202, {'calculation': public_item(updated)})

def require_local_target(payload):
    if payload.get('computeTarget', 'personal') != 'personal':
        raise ApiError(400, 'Use the optional Cloud connection to submit online compute; local jobs target Your computer.', 'INVALID_COMPUTE_TARGET')
    return 'personal'

def local_artifact_url(services, item, path):
    return services.s3.generate_presigned_url('get_object', Params={'Bucket': services.bucket, 'Key': f"{item['outputPrefix']}/{path}"}, ExpiresIn=900)
