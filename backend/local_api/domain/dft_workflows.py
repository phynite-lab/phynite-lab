"""Durable workflow submission; reuse is admitted here and verified by the solver."""
from __future__ import annotations
import copy
import hashlib
import json
import re
import time
from typing import Any
from backend.local_api.domain.dft_validation import dependency_dft_error, read_dft_manifest, scf_input_identity, validate_relaxation_input, validate_transport_settings
from backend.local_api.domain.phynite_core import ApiError, CALCULATION_TYPES, owner_partition, public_item, require_owner_item, require_project, response, storage_owner, utc_now
ANALYSES = {'Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties'}

def source_metadata(services: Any, owner: str, project: str, source_id: str, expected: str | None=None, phonon: bool=False) -> tuple[dict[str, Any], dict[str, Any] | None]:
    source = require_owner_item(services, owner, 'CALCULATION', source_id, 'SCF_SOURCE_NOT_FOUND')
    if source.get('projectId') != project or source.get('calculationType') != 'Total energy':
        raise ApiError(409, 'Choose an SCF calculation in this project.', 'INVALID_SCF_SOURCE')
    if source.get('status') in {'FAILED', 'CANCELLED', 'DRAFT'}:
        raise ApiError(409, 'The source SCF is not available. Run a new SCF.', 'SCF_SOURCE_UNAVAILABLE')
    if expected and source.get('scfInputIdentity') != expected:
        raise ApiError(409, 'The selected SCF has different effective input.', 'SCF_INPUT_MISMATCH')
    if source.get('status') != 'COMPLETED':
        return (source, None)
    if int(source.get('artifactsExpireAtEpoch') or 0) and int(source['artifactsExpireAtEpoch']) <= time.time():
        raise ApiError(409, 'The SCF state has expired. Run a new SCF.', 'SCF_SOURCE_EXPIRED')
    error = dependency_dft_error(services, source)
    if error:
        raise ApiError(409, error, 'SCF_NOT_CONVERGED')
    manifest = read_dft_manifest(services, source)
    bundle = manifest.get('provenance', {}).get('scfBundle')
    if not isinstance(bundle, dict) or bundle.get('version') != 1 or bundle.get('calculationId') != source_id or (bundle.get('path') != 'scf-workspace.tar.gz') or (not re.fullmatch('[a-f0-9]{64}', str(bundle.get('sha256', '')))) or (not re.fullmatch('[a-f0-9]{64}', str(bundle.get('scfInputIdentity', '')))):
        raise ApiError(409, 'This run has no verified reusable SCF bundle. Run a new SCF.', 'SCF_BUNDLE_REQUIRED')
    artifact = next((a for a in manifest.get('artifacts', []) if a.get('path') == bundle['path']), None)
    if not artifact or artifact.get('sha256') != bundle['sha256'] or artifact.get('sizeBytes') != bundle.get('sizeBytes'):
        raise ApiError(409, 'SCF bundle identity is incomplete.', 'SCF_BUNDLE_REQUIRED')
    if phonon and (not bundle.get('wavefunctionsIncluded')):
        raise ApiError(409, 'This SCF has no wavefunctions for phonons. Run a new SCF with disk_io=low.', 'SCF_WAVEFUNCTIONS_REQUIRED')
    return (source, bundle)

def validate_graph(nodes: Any, targets: Any) -> list[dict[str, Any]]:
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 256:
        raise ApiError(400, 'Submit between 1 and 256 calculation nodes.', 'INVALID_WORKFLOW')
    indexed = {}
    for node in nodes:
        if not isinstance(node, dict) or not re.fullmatch('[A-Za-z0-9_-]{1,96}', str(node.get('id', ''))) or node['id'] in indexed or (not isinstance(node.get('request'), dict)):
            raise ApiError(400, 'Workflow contains invalid or duplicate node identities.', 'INVALID_WORKFLOW')
        if node['request'].get('calculationType') not in CALCULATION_TYPES or not isinstance(node.get('dependsOnNodeIds', []), list):
            raise ApiError(400, 'Workflow has unsupported calculations or dependencies.', 'INVALID_WORKFLOW')
        indexed[node['id']] = node
    if targets is None:
        targets = list(indexed)
    if not isinstance(targets, list) or not targets or any((t not in indexed for t in targets)):
        raise ApiError(400, 'Select existing workflow targets.', 'INVALID_WORKFLOW')
    ordered, done, active = ([], set(), set())

    def visit(key: str) -> None:
        if key in active:
            raise ApiError(400, 'Workflow contains a cycle.', 'WORKFLOW_CYCLE')
        if key in done:
            return
        node = indexed.get(key)
        if not node:
            raise ApiError(400, 'Workflow dependency is missing.', 'INVALID_WORKFLOW')
        active.add(key)
        parents = node.get('dependsOnNodeIds', [])
        kind = node['request']['calculationType']
        if kind == 'Nudged elastic band' and parents:
            raise ApiError(400, 'NEB endpoints must be explicit fixed structure snapshots.', 'INVALID_NEB_DEPENDENCY')
        if len(parents) > 1 or (kind in ANALYSES and len(parents) != 1):
            raise ApiError(400, 'Each analysis requires one SCF source.', 'INVALID_WORKFLOW')
        for parent in parents:
            if not isinstance(parent, str) or parent not in indexed or indexed[parent]['request']['calculationType'] != ('Total energy' if kind in ANALYSES else 'Structural relaxation'):
                raise ApiError(400, 'Workflow has an incompatible connection.', 'INVALID_WORKFLOW')
            visit(parent)
        active.remove(key)
        done.add(key)
        ordered.append(node)
    for target in targets:
        visit(target)
    return ordered

class DftWorkflows:

    def __init__(self, api: Any):
        self.api, self.services = (api, api.services)

    def submit(self, owner: str, project: str, payload: dict[str, Any]) -> dict[str, Any]:
        require_project(self.services, owner, project)
        key = payload.get('idempotencyKey')
        if not isinstance(key, str) or not re.fullmatch('[A-Za-z0-9_-]{16,96}', key):
            raise ApiError(400, 'A stable workflow idempotency key is required.', 'INVALID_IDEMPOTENCY_KEY')
        nodes = validate_graph(payload.get('nodes'), payload.get('targetNodeIds'))
        normalized_payload = copy.deepcopy(payload)
        for node in normalized_payload.get('nodes', []):
            node['request'].pop('quoteId', None)
        fingerprint = hashlib.sha256(json.dumps(normalized_payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        run_id = 'workflow_' + hashlib.sha256(f'{owner}:{project}:{key}'.encode()).hexdigest()[:32]
        existing = self.services.get_item(owner, 'WORKFLOW_RUN', run_id)
        if existing and existing.get('requestFingerprint') != fingerprint:
            raise ApiError(409, 'Workflow key was used with a different snapshot.', 'IDEMPOTENCY_CONFLICT')
        if existing and existing.get('cancelRequested'):
            return self.get(owner, run_id)
        for node in nodes:
            request = node['request']
            structure = require_owner_item(self.services, owner, 'STRUCTURE', request.get('structureId'), 'STRUCTURE_NOT_FOUND')
            if structure.get('projectId') != project:
                raise ApiError(409, 'Workflow structure belongs to another project.', 'PROJECT_MISMATCH')
            files = request.get('inputFiles')
            if not isinstance(files, dict) or not files or len(files) > 12 or any((not isinstance(v, str) or not v.strip() for v in files.values())):
                raise ApiError(400, 'Workflow node has no executable input.', 'INVALID_INPUT_FILES')
            if sum((len(v.encode()) for v in files.values())) > 4000000:
                raise ApiError(400, 'Workflow node input is too large.', 'INVALID_INPUT_FILES')
            try:
                validate_relaxation_input(files)
                if request['calculationType'] == 'Thermoelectric properties':
                    validate_transport_settings(request.get('settings', {}))
            except ValueError as exc:
                raise ApiError(400, str(exc), 'INVALID_WORKFLOW_INPUT') from exc
            if request['calculationType'] in ANALYSES:
                parent = next((n for n in nodes if n['id'] == node['dependsOnNodeIds'][0]))
                if scf_input_identity(files.get('scf.in', '')) != scf_input_identity(parent['request']['inputFiles'].get('scf.in', '')):
                    raise ApiError(409, 'Analysis ground state differs from its SCF source.', 'SCF_INPUT_MISMATCH')
        if not existing:
            snapshot_key = f'users/{storage_owner(owner)}/projects/{project}/workflow-runs/{run_id}/snapshot.json'
            self.services.s3.put_object(Bucket=self.services.bucket, Key=snapshot_key, Body=json.dumps(payload).encode(), ContentType='application/json', ServerSideEncryption='AES256')
            item = {'PK': owner_partition(owner), 'SK': f'WORKFLOW_RUN#{run_id}', 'GSI1PK': f'PROJECT#{project}', 'GSI1SK': f'WORKFLOW_RUN#{run_id}', 'entityType': 'WORKFLOW_RUN', 'id': run_id, 'ownerId': owner, 'projectId': project, 'requestFingerprint': fingerprint, 'snapshotKey': snapshot_key, 'nodes': {}, 'status': 'SUBMITTING', 'createdAt': utc_now()}
            try:
                self.services.put_item(item, 'attribute_not_exists(PK)')
            except Exception:
                existing = self.services.get_item(owner, 'WORKFLOW_RUN', run_id)
                if not existing or existing.get('requestFingerprint') != fingerprint:
                    raise
            existing = existing or item
        mapping = dict(existing.get('nodes') or {})
        for node in nodes:
            if node['id'] in mapping:
                continue
            request = copy.deepcopy(node['request'])
            request['idempotencyKey'] = 'workflow-' + hashlib.sha256(f"{run_id}:{node['id']}".encode()).hexdigest()
            request['dependsOnCalculationIds'] = [mapping[p]['calculationId'] for p in node.get('dependsOnNodeIds', [])]
            request['settings'] = {**request.get('settings', {}), 'workflowRunId': run_id}
            kind = request['calculationType']
            if node.get('dependsOnNodeIds'):
                parent_id = request['dependsOnCalculationIds'][0]
                parent = next((n for n in nodes if n['id'] == node['dependsOnNodeIds'][0]))
                if kind in ANALYSES:
                    request['scfSourceCalculationId'] = parent_id
                    request['settings'].pop('structureSource', None)
                else:
                    request['settings']['structureSource'] = {'calculationId': parent_id, 'calculationType': 'Structural relaxation', 'prefix': parent['request']['settings'].get('prefix')}
                    request['settings']['submittedStructure'] = {'version': 1, 'source': 'relaxation-dependency'}
            source_id, reused = (None, False)
            try:
                if kind == 'Total energy':
                    request['settings']['retainScfBundle'] = True
                    source_id = self.resolve_scf(owner, project, request, node.get('scfReuse', {'mode': 'auto'}))
                    reused = source_id is not None
                if not source_id and request.get('computeTarget') == 'shared' and (request.get('cloudMode') in {'paid', 'pilot'}):
                    raise ApiError(400, 'Submit online compute through the optional Cloud connection. This workflow runner executes on Your computer.', 'INVALID_COMPUTE_TARGET')
                calculation = json.loads(self.api.create_calculation(owner, project, request)['body'])['calculation'] if not source_id else public_item(require_owner_item(self.services, owner, 'CALCULATION', source_id, 'SCF_SOURCE_NOT_FOUND'))
                mapping[node['id']] = {'calculationId': calculation['id'], 'reused': reused, 'owned': not reused}
                self.services.update_item(owner, 'WORKFLOW_RUN', run_id, {'nodes': mapping, 'updatedAt': utc_now(), 'status': 'SUBMITTING', 'submissionError': ''})
            except Exception as exc:
                self.services.update_item(owner, 'WORKFLOW_RUN', run_id, {'nodes': mapping, 'updatedAt': utc_now(), 'status': 'SUBMISSION_FAILED', 'submissionError': str(exc)})
                if isinstance(exc, ApiError):
                    return self.get(owner, run_id)
                raise
        self.services.update_item(owner, 'WORKFLOW_RUN', run_id, {'status': 'SUBMITTED', 'updatedAt': utc_now()})
        return self.get(owner, run_id)

    def resolve_scf(self, owner: str, project: str, request: dict[str, Any], policy: dict[str, Any]) -> str | None:
        expected = scf_input_identity(request['inputFiles']['scf.in'])
        mode = policy.get('mode')
        if mode == 'fresh':
            return None
        if mode == 'selected':
            source, _ = source_metadata(self.services, owner, project, policy.get('calculationId', ''), expected)
            return source['id']
        if mode != 'auto':
            raise ApiError(400, 'Choose automatic, selected or fresh SCF.', 'INVALID_SCF_SOURCE')
        selection = {k: request.get(k) for k in ('computeTarget', 'cloudMode', 'computeProfileId', 'executionAffinity', 'vcpus', 'memoryMiB', 'pseudopotentials', 'dependsOnCalculationIds')}
        identity = hashlib.sha256(json.dumps([project, expected, selection], sort_keys=True).encode()).hexdigest()
        slot = self.services.get_item(owner, 'SCF_SOURCE', identity)
        prior = slot.get('calculationId') if slot else None
        prospective = 'calc_' + hashlib.sha256(f"{owner}:{request['idempotencyKey']}".encode()).hexdigest()[:32]
        if prior == prospective:
            return None
        if prior:
            candidate = self.services.get_item(owner, 'CALCULATION', prior)
            if candidate is None and time.time() - int(slot.get('updatedAtEpoch') or 0) < 60:
                raise ApiError(409, 'An identical SCF is being prepared. Retry shortly.', 'SCF_PREPARING')
            if candidate:
                try:
                    source_metadata(self.services, owner, project, prior, expected)
                    return prior
                except ApiError:
                    pass
        prospective = 'calc_' + hashlib.sha256(f"{owner}:{request['idempotencyKey']}".encode()).hexdigest()[:32]
        if not self.services.reserve_scf_source(owner, identity, prospective, prior):
            raise ApiError(409, 'Another submission reserved this SCF. Retry shortly.', 'SCF_PREPARING')
        return None

    def get(self, owner: str, run_id: str) -> dict[str, Any]:
        run = require_owner_item(self.services, owner, 'WORKFLOW_RUN', run_id, 'WORKFLOW_RUN_NOT_FOUND')
        calculations = []
        for value in run.get('nodes', {}).values():
            item = require_owner_item(self.services, owner, 'CALCULATION', value['calculationId'], 'CALCULATION_NOT_FOUND')
            if item.get('projectId') != run['projectId']:
                raise ApiError(409, 'Workflow job project mismatch.', 'PROJECT_MISMATCH')
            calculations.append(public_item(item))
        states = {c['status'] for c in calculations}
        status = run['status']
        if status not in {'SUBMITTING', 'SUBMISSION_FAILED'}:
            status = 'FAILED' if 'FAILED' in states else 'COMPLETED' if states == {'COMPLETED'} else 'CANCELLED' if states and states <= {'COMPLETED', 'CANCELLED'} and ('CANCELLED' in states) else 'RUNNING'
        return response(200, {'workflowRun': {**public_item(run), 'status': status}, 'calculations': calculations})

    def cancel(self, owner: str, run_id: str) -> dict[str, Any]:
        run = require_owner_item(self.services, owner, 'WORKFLOW_RUN', run_id, 'WORKFLOW_RUN_NOT_FOUND')
        self.services.update_item(owner, 'WORKFLOW_RUN', run_id, {'cancelRequested': True})
        for value in run.get('nodes', {}).values():
            item = self.services.get_item(owner, 'CALCULATION', value['calculationId'])
            if not value.get('owned') or item is None or item.get('calculationType') == 'Total energy' or (item.get('status') in {'COMPLETED', 'FAILED', 'CANCELLED'}):
                continue
            self.api.cancel_calculation(owner, value['calculationId'])
        return self.get(owner, run_id)
