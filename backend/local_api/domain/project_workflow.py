"""Owner-scoped, revisioned workflow graphs and durable execution snapshots.

The graph is not an authority to read an asset or reuse a result. Every resource
and every job is resolved again under the signed-in owner's partition.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
import re
import time
from datetime import datetime, timezone
from typing import Any
from backend.local_api.domain.phynite_core import ApiError, json_safe, new_id, owner_partition, require_owner_item, require_project, response, storage_owner, utc_now
WORKFLOW_PATH = re.compile('^/v1/projects/([A-Za-z0-9_-]+)/workflow(?:/(plan|runs|import)(?:/([A-Za-z0-9_-]+)(?:/(cancel))?)?)?$')
PORTS = {'structure': (None, 'structure'), 'trajectory': (None, 'trajectory'), 'scf': ('structure', 'electronic'), 'relax': ('structure', 'structure'), 'bands': ('electronic', 'dataset'), 'dos': ('electronic', 'dataset'), 'phonon': ('electronic', 'dataset'), 'btp2': ('electronic', 'dataset'), 'md': ('structure', 'trajectory'), 'md-analysis': ('trajectory', 'dataset'), 'extract-frame': ('trajectory', 'structure'), 'figure': ('dataset', 'dataset'), 'legacy': (None, 'dataset')}
JOB_KINDS = {'md': 'MD_SIMULATION', 'md-analysis': 'MD_ANALYSIS'}
DFT_TYPES = {'scf': 'Total energy', 'relax': 'Structural relaxation', 'bands': 'Band structure', 'dos': 'Density of states', 'phonon': 'Phonon dispersion', 'btp2': 'Thermoelectric properties'}
SUCCESS = {'completed', 'ready', 'reused'}
FINAL = SUCCESS | {'failed', 'blocked', 'cancelled'}
RESOURCE_KINDS = {'structure': 'STRUCTURE', 'trajectory': 'MD_TRAJECTORY', 'potential': 'MD_POTENTIAL'}

WORKFLOW_BRANCH_FIELDS = {
    'kPoint', 'kPointY', 'kPointZ', 'kPointShift', 'kPath', 'kPathMode', 'kPathPoints',
    'numberOfBands', 'bandSymmetry', 'bandOverlap', 'dosEnergyMin', 'dosEnergyMax',
    'dosEnergyStep', 'projectedDos', 'projectedBands', 'dosSymmetrize', 'pawProjection',
    'qPoint', 'qPointY', 'qPointZ', 'phononThreshold', 'phononIterations', 'phononMixing',
    'phononMixingNdim', 'phononAsr', 'transportInterpolationMultiplier', 'transportEnergyBins',
    'transportTemperatureMin', 'transportTemperatureMax', 'transportTemperatureStep',
    'transportRelaxationTime', 'transportChemicalPotentialMin', 'transportChemicalPotentialMax',
    'transportScatteringModel', 'transportSampling',
}
DEFAULT_QE_DRAFT: dict[str, Any] = {
    'calculations': [], 'accuracy': 'Balanced', 'functional': 'PBE', 'kPoint': 8,
    'cutoff': 70, 'chargeDensityCutoff': 560, 'occupationPolicy': 'auto',
    'occupations': 'smearing', 'smearingType': 'marzari-vanderbilt', 'smearing': 0.02,
    'cutoffPolicy': 'auto', 'spin': False, 'startingMagnetization': 0.5,
    'magnetizationConstraint': 'unconstrained', 'startingMagnetizations': {},
    'soc': False, 'noncollinear': False, 'kPath': 'Γ — X — W — K — Γ — L',
    'kPathMode': 'automatic', 'kPathPoints': 24, 'numberOfBands': 32, 'relaxCell': True,
    'ionDynamics': 'bfgs', 'forceThreshold': 0.001, 'targetPressure': 0, 'qPoint': 4,
    'phononThreshold': 1e-12, 'acousticSumRule': True, 'scfThreshold': 0.00000001,
    'electronMaxSteps': 100, 'mixingBeta': 0.7, 'dosEnergyMin': -12, 'dosEnergyMax': 8,
    'dosEnergyStep': 0.02, 'projectedDos': True, 'projectedBands': False,
    'prefix': 'calculation', 'restartMode': 'from_scratch', 'verbosity': 'low',
    'diskIO': 'low', 'maxSeconds': 86400, 'pseudoFamily': 'SSSP precision',
    'kPointShift': '0 0 0', 'totalCharge': 0, 'useSymmetry': True, 'useInversion': True,
    'vdwCorrection': 'none', 'mixingMode': 'plain', 'mixingNdim': 8,
    'diagonalization': 'david', 'diagonalizationThreshold': 0.00001,
    'scfMustConverge': True, 'exxFraction': 0.25, 'dftU': False, 'hubbardU': 4,
    'hubbardProjector': 'ortho-atomic', 'hubbardCorrections': [],
    'energyThreshold': 0.0001, 'cellDynamics': 'bfgs', 'cellDoFree': 'all',
    'pressureThreshold': 0.5, 'trustRadius': 0.5, 'bandSymmetry': True,
    'bandOverlap': False, 'firstBand': 1, 'lastBand': 0, 'dosBroadening': 0,
    'dosNgauss': 0, 'dosSymmetrize': True, 'pawProjection': False,
    'phononIterations': 100, 'phononMixing': 0.7, 'phononMixingNdim': 4,
    'dielectricTensor': False, 'effectiveCharges': False, 'phononAsr': 'crystal',
    'electronPhonon': 'none', 'qeVersion': '7.5', 'rawInput': '',
    'title': 'Untitled calculation', 'outdir': './tmp', 'pseudoDir': './pseudo',
    'nstep': 100, 'printForces': True, 'printStress': True, 'kPointY': 8, 'kPointZ': 8,
    'fftGridMode': 'automatic', 'nr1': 48, 'nr2': 48, 'nr3': 48, 'totalMagnetization': 0,
    'assumeIsolated': 'none', 'dipoleCorrection': False, 'dipolePlacement': 'automatic',
    'dipolePosition': 0.9, 'dipoleRegion': 0.05, 'electricFieldAmplitude': 0,
    'startingPotential': 'atomic', 'startingWavefunctions': 'atomic+random',
    'realSpace': False, 'diagoFullAccuracy': False, 'potentialExtrapolation': 'atomic',
    'wavefunctionExtrapolation': 'none', 'removeRigidRotation': False,
    'refoldPositions': False, 'cellFactor': 2, 'qPointY': 4, 'qPointZ': 4,
    'matdynDeltaE': 1, 'transportInterpolationMultiplier': 3,
    'transportTemperatureMin': 100, 'transportTemperatureMax': 900,
    'transportTemperatureStep': 50, 'transportChemicalPotentialMin': -0.5,
    'transportChemicalPotentialMax': 0.5,
    'transportScatteringModel': 'constant-relaxation-time',
    'transportSampling': 'chemical-potential', 'transportRelaxationTime': 10,
    'transportEnergyBins': 5000,
}

def fail(message: str, code: str='INVALID_WORKFLOW', status: int=400) -> None:
    raise ApiError(status, message, code)

def _canonical_json_numbers(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _canonical_json_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_canonical_json_numbers(v) for v in value]
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return value

def encoded(value: Any) -> bytes:
    return json.dumps(_canonical_json_numbers(json_safe(value)), sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')

def digest(value: Any) -> str:
    return hashlib.sha256(encoded(value)).hexdigest()

def identifier(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch('[A-Za-z0-9_-]{1,200}', value))

def order(graph: dict[str, Any], targets: list[str] | None=None) -> list[str]:
    nodes = {node['id'] for node in graph['nodes']}
    inputs = {node_id: sorted((edge['source'] for edge in graph['edges'] if edge['target'] == node_id)) for node_id in nodes}
    done: set[str] = set()
    visiting: set[str] = set()
    result: list[str] = []
    for target in sorted(nodes if targets is None else targets):
        stack = [(target, False)]
        while stack:
            node_id, exiting = stack.pop()
            if node_id in done:
                continue
            if node_id not in nodes:
                fail('Workflow target does not exist.')
            if exiting:
                visiting.remove(node_id)
                done.add(node_id)
                result.append(node_id)
                continue
            if node_id in visiting:
                fail('Workflow connections cannot form a cycle.')
            visiting.add(node_id)
            stack.append((node_id, True))
            stack.extend(((source, False) for source in reversed(inputs[node_id])))
    return result

def validate_graph(value: Any, project_id: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get('version') != 1 or type(value.get('version')) is not int or (value.get('projectId') != project_id):
        fail('Select a version 1 workflow in this project.')
    for key, limit in (('nodes', 1000), ('edges', 4000), ('groups', 200)):
        if not isinstance(value.get(key), list) or len(value[key]) > limit:
            fail(f'Workflow {key} exceed the supported limit.')
    try:
        if len(encoded(value)) > 4000000:
            fail('Workflow exceeds 4 MB. Split this workflow or remove unused configurations.', status=413)
    except (ValueError, TypeError, RecursionError) as exc:
        raise ApiError(400, 'Workflow contains invalid values.', 'INVALID_WORKFLOW') from exc
    nodes: dict[str, Any] = {}
    for node in value['nodes']:
        if not isinstance(node, dict) or not identifier(node.get('id')) or node['id'] in nodes or (not isinstance(node.get('kind'), str)) or (node['kind'] not in PORTS):
            fail('Workflow has an invalid or duplicate node.')
        if not isinstance(node.get('name'), str) or not node['name'].strip() or len(node['name']) > 200 or (not isinstance(node.get('configuration'), dict)):
            fail('Each node needs a name and configuration.')
        pos = node.get('position')
        if not isinstance(pos, dict) or any((type(pos.get(axis)) not in (int, float) or not math.isfinite(pos[axis]) or abs(pos[axis]) > 10000000.0 for axis in ('x', 'y'))):
            fail('Node positions must be finite coordinates.')
        resources = node.get('resources')
        if not isinstance(resources, list) or len(resources) > 100:
            fail('Node resource references are invalid.')
        for resource in resources:
            if not isinstance(resource, dict) or not isinstance(resource.get('kind'), str) or resource['kind'] not in RESOURCE_KINDS or (not identifier(resource.get('id'))):
                fail('Node resource reference is invalid.')
            if 'sha256' in resource and (not re.fullmatch('[a-f0-9]{64}', str(resource['sha256']))):
                fail('Resource checksum must be SHA-256.')
            if 'deviceOnly' in resource and type(resource['deviceOnly']) is not bool:
                fail('Device-only flag must be a boolean.')
        legacy = node.get('legacy')
        if legacy is not None and (not isinstance(legacy, dict) or not identifier(legacy.get('localId')) or legacy.get('editor') not in {'dft', 'md', 'figures'}):
            fail('Legacy editor reference is invalid.')
        nodes[node['id']] = node
    edge_ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    incoming: set[str] = set()
    for edge in value['edges']:
        if not isinstance(edge, dict) or not identifier(edge.get('id')) or edge['id'] in edge_ids or (not identifier(edge.get('source'))) or (not identifier(edge.get('target'))) or (edge['source'] not in nodes) or (edge['target'] not in nodes):
            fail('Workflow has an invalid connection.')
        source, target = (nodes[edge['source']], nodes[edge['target']])
        pair = (source['id'], target['id'])
        expected, output = (PORTS[target['kind']][0], PORTS[source['kind']][1])
        if source['kind'] == 'figure' or source['id'] == target['id'] or pair in pairs or (not expected) or (edge.get('port') != expected) or (output != expected):
            fail('These module inputs and outputs are incompatible.')
        if target['kind'] != 'figure' and target['id'] in incoming:
            fail('Disconnect the current input before choosing another source.')
        incoming.add(target['id'])
        pairs.add(pair)
        edge_ids.add(edge['id'])
    group_ids: set[str] = set()
    grouped: set[str] = set()
    for group in value['groups']:
        if not isinstance(group, dict) or not identifier(group.get('id')) or group['id'] in group_ids or (not isinstance(group.get('name'), str)) or (not group['name'].strip()) or (len(group['name']) > 200) or (not isinstance(group.get('nodeIds'), list)) or (not group['nodeIds']):
            fail('Workflow group is invalid.')
        for node_id in group['nodeIds']:
            if not identifier(node_id) or node_id not in nodes or node_id in grouped:
                fail('A node can belong to one existing group.')
            grouped.add(node_id)
        group_ids.add(group['id'])
    for node in nodes.values():
        if node.get('groupId') and (not any((group['id'] == node['groupId'] and node['id'] in group['nodeIds'] for group in value['groups']))):
            fail('Node group does not exist.')
    order(value)
    return copy.deepcopy(value)

def canonical_configuration(configuration: dict[str, Any], kind: str | None=None) -> dict[str, Any]:
    config = copy.deepcopy(configuration)
    if configuration.get('compilerVersion') == 1 or (kind in DFT_TYPES and isinstance(config.get('draft'), dict)) or (kind == 'md' and isinstance(config.get('components'), list)):
        config.pop('execution', None)
    for key in ('savedStructureSignature', 'configurationError', 'legacySource', 'preservedHistory', 'plotSettings', 'elementMapText', 'style', 'compilerVersion', 'estimatedComputeSeconds', 'formula', 'missingInputs', 'parameterStudy', 'pseudopotentialChecksums', 'computeTarget', 'cloudMode', 'computeProfileId', 'vcpus', 'memoryMiB'):
        config.pop(key, None)
    for key in ('structure', 'draft', 'execution'):
        value = config.get(key)
        if not isinstance(value, dict):
            continue
        value.pop('name', None)
        if key == 'structure':
            for struct_key in ('formula', 'source', 'spaceGroup', 'id', 'provenance', 'externalId', 'sourceUrl', 'sourceUpdatedAt', 'sourceData', 'geometryProvenance', 'bandGap'):
                value.pop(struct_key, None)
            if isinstance(value.get('atoms'), list):
                for atom in value['atoms']:
                    if not isinstance(atom, dict):
                        continue
                    atom.pop('id', None)
                    if isinstance(atom.get('label'), str) and atom['label'].strip() == atom.get('species'):
                        atom.pop('label', None)
            lattice = value.get('lattice')
            if isinstance(lattice, dict):
                periodic = value.get('periodic', lattice.get('periodic'))
                lattice.pop('periodic', None)
                value['periodic'] = periodic if isinstance(periodic, list) else [True, True, True]
        if key == 'draft':
            for draft_ui_key in ('calculations', 'plotYMin', 'plotYMax'):
                value.pop(draft_ui_key, None)
            if kind in DFT_TYPES:
                if kind in {'bands', 'dos', 'phonon', 'btp2'} and (not str(value.get('rawInput') or '').strip()):
                    for draft_key in list(value):
                        if draft_key in DEFAULT_QE_DRAFT and draft_key not in WORKFLOW_BRANCH_FIELDS:
                            value.pop(draft_key, None)
                for draft_key, default_val in DEFAULT_QE_DRAFT.items():
                    if draft_key in value and encoded(value[draft_key]) == encoded(default_val):
                        value.pop(draft_key, None)
                if not value:
                    config.pop('draft', None)
        if key == 'execution':
            for exec_key in ('idempotencyKey', 'computeTarget', 'cloudMode', 'computeProfileId', 'vcpus', 'memoryMiB', 'estimatedComputeSeconds', 'quoteId'):
                value.pop(exec_key, None)
            if isinstance(value.get('settings'), dict):
                value['settings'].pop('calculations', None)
            if not value:
                config.pop('execution', None)
    for stage in config.get('components', []):
        if not isinstance(stage, dict):
            continue
        for key in ('id', 'name', 'materialId', 'materialName'):
            stage.pop(key, None)
        if isinstance(stage.get('config'), dict):
            stage['config'].pop('name', None)
    component = config.get('component')
    if isinstance(component, dict):
        for key in ('id', 'name', 'materialId', 'materialName', 'selected'):
            component.pop(key, None)
        if isinstance(component.get('config'), dict):
            component['config'].pop('name', None)
    return config

def fingerprints(graph: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    nodes = {node['id']: node for node in graph['nodes']}
    for node_id in order(graph):
        node = nodes[node_id]
        inputs = sorted(({'port': edge['port'], 'fingerprint': result[edge['source']]} for edge in graph['edges'] if edge['target'] == node_id), key=encoded)
        config = canonical_configuration(node['configuration'], node['kind'])
        resources = [{'kind': ref['kind'], 'id': ref['id'], **({'deviceOnly': True} if ref.get('deviceOnly') else {})} for ref in node['resources']]
        result[node_id] = digest({'kind': node['kind'], 'configuration': config, 'resources': resources, 'inputs': inputs})
    return result

class ProjectWorkflowApi:

    def __init__(self, api: Any):
        self.api = api
        self.services = api.services
        self._attempt_candidates: dict[str, list[dict[str, Any]]] = {}
        self._run_snapshot_hashes: dict[tuple[str, str, int], dict[str, str]] = {}

    def migrate_identity(self, owner: str, payload: dict[str, Any]) -> dict[str, Any]:
        legacy_id = payload.get('legacyId')
        if not identifier(legacy_id):
            fail('A valid legacy project ID is required.')
        alias = self.services.get_item(owner, 'PROJECT_ALIAS', legacy_id)
        if alias:
            project = require_project(self.services, owner, alias['projectId'])
            from backend.local_api.domain.phynite_core import public_item
            return {'project': public_item(project), 'alias': legacy_id}
        remote = payload.get('remoteId')
        if remote:
            project = require_project(self.services, owner, remote)
        else:
            name, description = (payload.get('name'), payload.get('description', ''))
            if not isinstance(name, str) or not name.strip() or len(name) > 100 or (not isinstance(description, str)) or (len(description) > 500):
                fail('Project name or description is invalid.')
            project_id = 'prj_' + hashlib.sha256(f'migration:{owner}:{legacy_id}'.encode()).hexdigest()[:32]
            project = self.services.get_item(owner, 'PROJECT', project_id)
            if not project:
                project = self.put_new(owner, 'PROJECT', project_id, {'name': name, 'description': description, 'tags': [], 'updatedAt': utc_now(), 'legacyId': legacy_id})
                project = project or require_project(self.services, owner, project_id)
        if not project.get('legacyId'):
            project = self.services.update_item(owner, 'PROJECT', project['id'], {'legacyId': legacy_id})
        self.put_new(owner, 'PROJECT_ALIAS', legacy_id, {'projectId': project['id']})
        from backend.local_api.domain.phynite_core import public_item
        return {'project': public_item(project), 'alias': legacy_id}

    def read_json(self, key: str, checksum: str) -> Any:
        raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=key)['Body'].read(16000001)
        if len(raw) > 16000000 or hashlib.sha256(raw).hexdigest() != checksum:
            fail('Stored workflow checksum failed. Restore a verified revision.', 'WORKFLOW_CORRUPT', 409)
        return json.loads(raw)

    def write_json(self, owner: str, project: str, category: str, value: Any) -> tuple[str, str]:
        raw = encoded(value)
        checksum = hashlib.sha256(raw).hexdigest()
        key = f'users/{storage_owner(owner)}/projects/{project}/workflow/{category}/{checksum}.json'
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=raw, ContentType='application/json', ServerSideEncryption='AES256')
        return (key, checksum)

    def put_new(self, owner: str, kind: str, item_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
        created = datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z') if kind == 'PROJECT_RUN' else utc_now()
        item = {'PK': owner_partition(owner), 'SK': f'{kind}#{item_id}', 'entityType': kind, 'id': item_id, 'ownerId': owner, 'createdAt': created, **values}
        if values.get('projectId'):
            item.update(GSI1PK=f"PROJECT#{values['projectId']}", GSI1SK=f"{kind}#{item['createdAt']}#{item_id}")
        try:
            self.services.put_item(item, 'attribute_not_exists(PK)')
            return item
        except Exception as exc:
            if getattr(exc, 'response', {}).get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return None
            raise

    def load(self, owner: str, project: str) -> dict[str, Any]:
        require_project(self.services, owner, project)
        current = self.services.get_item(owner, 'PROJECT_WORKFLOW', project)
        if not current:
            graph = {'version': 1, 'projectId': project, 'nodes': [], 'edges': [], 'groups': []}
            for kind, resource_kind, node_kind in (('STRUCTURE', 'structure', 'structure'), ('MD_TRAJECTORY', 'trajectory', 'trajectory')):
                for item in self.services.list_owner_items(owner, kind):
                    if item.get('projectId') != project:
                        continue
                    configuration: dict[str, Any] = {}
                    if kind == 'STRUCTURE' and item.get('objectKey'):
                        raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=item['objectKey'])['Body'].read(5000001)
                        if len(raw) > 5000000:
                            fail('Legacy structure exceeds its retained input limit.', 'WORKFLOW_MIGRATION_FAILED', 409)
                        try:
                            original = json.loads(raw)
                        except (ValueError, UnicodeDecodeError):
                            original = None
                        configuration = {'structure': original, 'legacySource': item['id']}
                    graph['nodes'].append({'id': item['id'], 'kind': node_kind, 'name': item.get('name', item.get('filename', item['id'])), 'position': {'x': 60, 'y': len(graph['nodes']) * 160 + 60}, 'configuration': configuration, 'resources': [{'kind': resource_kind, 'id': item['id'], **({'sha256': item['sha256']} if item.get('sha256') else {})}]})
            for kind, editor in (('CALCULATION', 'dft'), ('MD_SIMULATION', 'md'), ('MD_CONFIGURATION', 'md'), ('MD_ANALYSIS', 'md')):
                for item in self.services.list_owner_items(owner, kind):
                    if item.get('projectId') == project:
                        graph['nodes'].append({'id': 'legacy_' + item['id'], 'kind': 'legacy', 'name': item.get('name', item['id']), 'position': {'x': 380, 'y': len(graph['nodes']) * 140 + 60}, 'configuration': {'preservedJobId': item['id'], 'preservedJobKind': kind, 'preservedConfiguration': item.get('workflow', item.get('config'))}, 'resources': [], 'legacy': {'localId': project, 'editor': editor}})
            project_record = require_project(self.services, owner, project)
            for item in self.services.list_owner_items(owner, 'FIGURE'):
                if item.get('projectId') not in {project, project_record.get('legacyId')} or item.get('archived'):
                    continue
                graph['nodes'].append({'id': 'legacy_figure_' + item['id'], 'kind': 'legacy', 'name': item.get('name', item['id']), 'position': {'x': 680, 'y': len(graph['nodes']) * 140 + 60}, 'configuration': {'preservedFigureId': item['id']}, 'resources': [], 'legacy': {'localId': item['projectId'], 'editor': 'figures'}})
            return {'revision': 0, 'workflow': graph, 'migrated': bool(graph['nodes'])}
        return {'revision': int(current['revision']), 'workflow': self.read_json(current['objectKey'], current['sha256'])}

    def input_document(self, owner: str, project: str, resource_id: str) -> dict[str, Any]:
        require_project(self.services, owner, project)
        item = require_owner_item(self.services, owner, 'STRUCTURE', resource_id, 'STRUCTURE_NOT_FOUND')
        if item.get('projectId') != project:
            fail('Structure belongs to another project.', 'PROJECT_MISMATCH', 409)
        raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=item['objectKey'])['Body'].read(5000001)
        checksum = hashlib.sha256(raw).hexdigest()
        if len(raw) > 5000000 or (item.get('sha256') and item['sha256'] != checksum):
            fail('Structure input checksum failed or exceeds its size limit.', 'WORKFLOW_RESOURCE_CHANGED', 409)
        try:
            document = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            document = None
        return {'structure': document, 'text': raw.decode('utf-8') if document is None else None, 'filename': item.get('filename', item['objectKey'].rsplit('/', 1)[-1]), 'sha256': checksum}

    def resources(self, owner: str, graph: dict[str, Any], *, execution: bool=False) -> None:
        for node in graph['nodes']:
            if execution and node['configuration'].get('missingInputs'):
                fail(f"Repair missing inputs in {node['name']} before running.", 'WORKFLOW_INPUT_MISSING', 409)
            for ref in node['resources']:
                if ref.get('deviceOnly'):
                    if execution:
                        fail(f"Save {node['name']} to the cloud before running this workflow.", 'WORKFLOW_DEVICE_ONLY', 409)
                    continue
                item = require_owner_item(self.services, owner, RESOURCE_KINDS[ref['kind']], ref['id'], 'WORKFLOW_RESOURCE_NOT_FOUND')
                if item.get('projectId') != graph['projectId']:
                    fail('Workflow resources must belong to this project.', 'PROJECT_MISMATCH', 409)
                if item.get('sha256') and ref.get('sha256') and (item['sha256'] != ref['sha256']):
                    fail('Resource checksum has changed. Select its current revision.', 'WORKFLOW_RESOURCE_CHANGED', 409)
                if item.get('sha256') and (not ref.get('sha256')):
                    ref['sha256'] = item['sha256']
                if execution and node['kind'] == 'structure' and (ref['kind'] == 'structure') and isinstance(node['configuration'].get('structure'), dict):
                    document = self.input_document(owner, graph['projectId'], ref['id'])['structure']
                    configured = node['configuration']['structure']
                    configured_struct = canonical_configuration({'structure': configured}, 'structure').get('structure')
                    document_struct = canonical_configuration({'structure': document}, 'structure').get('structure') if isinstance(document, dict) else None
                    if not isinstance(document_struct, dict) or encoded(configured_struct) != encoded(document_struct):
                        fail('Save the edited crystal input before running its workflow.', 'WORKFLOW_INPUT_NOT_SAVED', 409)

    def save(self, owner: str, project: str, payload: dict[str, Any]) -> dict[str, Any]:
        require_project(self.services, owner, project)
        revision = payload.get('baseRevision')
        if type(revision) is not int or revision < 0:
            fail('A nonnegative baseRevision is required.')
        graph = validate_graph(payload.get('workflow'), project)
        self.resources(owner, graph)
        current = self.services.get_item(owner, 'PROJECT_WORKFLOW', project)
        if (int(current['revision']) if current else 0) != revision:
            fail('Workflow changed on another device. Keep your draft and resolve the conflict.', 'WORKFLOW_CONFLICT', 409)
        key, checksum = self.write_json(owner, project, 'revisions', graph)
        values = {'projectId': project, 'objectKey': key, 'sha256': checksum, 'revision': revision + 1, 'updatedAt': utc_now()}
        updated = self.services.update_item_if_revision(owner, 'PROJECT_WORKFLOW', project, revision, values) if current else self.put_new(owner, 'PROJECT_WORKFLOW', project, values)
        if not updated:
            fail('Workflow changed while saving. Your local draft is preserved.', 'WORKFLOW_CONFLICT', 409)
        self._attempt_candidates.clear()
        self._run_snapshot_hashes.clear()
        return {'workflow': graph, 'revision': revision + 1}

    def snapshot_fingerprints(self, snapshot_workflow: Any, current_workflow: dict[str, Any] | None=None, owner: str | None=None, project: str | None=None) -> dict[str, str]:
        if not isinstance(snapshot_workflow, dict) or not isinstance(snapshot_workflow.get('nodes'), list) or (not isinstance(snapshot_workflow.get('edges'), list)):
            return {}
        workflow = copy.deepcopy(snapshot_workflow)
        if isinstance(current_workflow, dict) and isinstance(current_workflow.get('nodes'), list):
            current_nodes = {node['id']: node for node in current_workflow['nodes'] if isinstance(node, dict) and 'id' in node}
            for node in workflow['nodes']:
                if not isinstance(node, dict) or node.get('kind') != 'structure':
                    continue
                current = current_nodes.get(node.get('id'))
                if not current or current.get('kind') != 'structure':
                    continue
                snap_ids = [ref.get('id') for ref in node.get('resources', []) if isinstance(ref, dict) and ref.get('kind') == 'structure' and (not ref.get('deviceOnly'))]
                curr_ids = [ref.get('id') for ref in current.get('resources', []) if isinstance(ref, dict) and ref.get('kind') == 'structure' and (not ref.get('deviceOnly'))]
                snap_struct = node.get('configuration', {}).get('structure')
                curr_struct = current.get('configuration', {}).get('structure')
                if not isinstance(snap_struct, dict) and isinstance(curr_struct, dict) and snap_ids:
                    if snap_ids == curr_ids:
                        saved_sig = current.get('configuration', {}).get('savedStructureSignature')
                        legacy_source = current.get('configuration', {}).get('legacySource')
                        if (isinstance(saved_sig, str) and saved_sig == encoded(curr_struct).decode('utf-8')) or legacy_source == snap_ids[0] or isinstance(legacy_source, dict):
                            snap_struct = copy.deepcopy(curr_struct)
                            node.setdefault('configuration', {})['structure'] = snap_struct
                    if not isinstance(snap_struct, dict) and owner and project:
                        try:
                            doc = self.input_document(owner, project, snap_ids[0]).get('structure')
                            if isinstance(doc, dict):
                                snap_struct = copy.deepcopy(doc)
                                node.setdefault('configuration', {})['structure'] = snap_struct
                        except Exception:
                            pass
                elif isinstance(snap_struct, dict) and (not isinstance(curr_struct, dict)) and snap_ids and (snap_ids == curr_ids):
                    node.get('configuration', {}).pop('structure', None)
                    snap_struct = None
                if isinstance(snap_struct, dict) and isinstance(curr_struct, dict) and snap_ids and curr_ids and (snap_ids != curr_ids):
                    snap_canon = canonical_configuration({'structure': snap_struct}, 'structure').get('structure')
                    curr_canon = canonical_configuration({'structure': curr_struct}, 'structure').get('structure')
                    if isinstance(snap_canon, dict) and isinstance(curr_canon, dict) and (encoded(snap_canon) == encoded(curr_canon)):
                        node['resources'] = copy.deepcopy(current['resources'])
        try:
            return fingerprints(workflow)
        except Exception:
            return {}

    def attempt_matches_fingerprint(self, owner: str, project: str, item: dict[str, Any], fingerprint: str) -> bool:
        if item.get('fingerprint') == fingerprint:
            return True
        run_id, node_id = (item.get('runId'), item.get('nodeId'))
        if not identifier(run_id) or not identifier(node_id):
            return False
        envelope = self.load(owner, project)
        cache_key = (owner, run_id, int(envelope.get('revision', 0)))
        if cache_key not in self._run_snapshot_hashes:
            run_item = self.services.get_item(owner, 'PROJECT_RUN', run_id)
            if not run_item or run_item.get('projectId') != project or (not run_item.get('objectKey')) or (not run_item.get('sha256')):
                self._run_snapshot_hashes[cache_key] = {}
            else:
                try:
                    snapshot = self.read_json(run_item['objectKey'], run_item['sha256'])
                    self._run_snapshot_hashes[cache_key] = self.snapshot_fingerprints(snapshot.get('workflow'), envelope.get('workflow'), owner, project)
                except Exception:
                    self._run_snapshot_hashes[cache_key] = {}
        return self._run_snapshot_hashes[cache_key].get(node_id) == fingerprint

    def find_reusable(self, owner: str, project: str, node: dict[str, Any], fingerprint: str) -> dict[str, Any] | None:
        if node['kind'] in {'structure', 'trajectory', 'figure', 'legacy'}:
            return None
        if owner not in self._attempt_candidates:
            self._attempt_candidates[owner] = self.services.list_owner_items(owner, 'WORKFLOW_ATTEMPT')
        candidates = self._attempt_candidates[owner]
        for item in sorted(candidates, key=lambda attempt: attempt.get('createdAt', ''), reverse=True):
            if item.get('projectId') != project or item.get('status') not in SUCCESS or (not self.attempt_matches_fingerprint(owner, project, item, fingerprint)):
                continue
            if not item.get('jobId'):
                continue
            job = self.services.get_item(owner, item['jobKind'], item['jobId'])
            if not job or job.get('status') != 'COMPLETED':
                continue
            if node['kind'] in DFT_TYPES:
                from backend.local_api.domain.dft_validation import dependency_dft_error
                if dependency_dft_error(self.services, job):
                    continue
                if node['kind'] == 'scf':
                    from backend.local_api.domain.shared_scf import verified_scf_reference
                    try:
                        verified_scf_reference(self.services, owner, project, job['id'])
                    except ApiError:
                        continue
            if item['jobKind'] in {'MD_SIMULATION', 'MD_ANALYSIS'}:
                try:
                    from backend.local_api.domain.worker_artifacts import WorkerArtifacts
                    if item['jobKind'] == 'MD_ANALYSIS':
                        from backend.local_api.domain.md_results import read_md_result_manifest
                        retained = read_md_result_manifest(self.services, job)
                        required = retained.get('artifacts', [])
                    else:
                        retained = self.services.s3.get_object(Bucket=self.services.bucket, Key=f"{job['outputPrefix']}/result.json")['Body'].read(8000001)
                        retained = json.loads(retained)
                        required = [retained['trajectoryArtifact']]
                    for artifact in required:
                        WorkerArtifacts(self.services).verify(job, artifact['path'], artifact['sizeBytes'], artifact['sha256'])
                except Exception:
                    continue
            return item
        return None

    def retained_legacy_result(self, owner: str, project: str, node: dict[str, Any]) -> dict[str, Any] | None:
        config = node['configuration']
        kind, job_id = (config.get('preservedJobKind'), config.get('preservedJobId'))
        if kind not in {'CALCULATION', 'MD_ANALYSIS'} or not identifier(job_id):
            return None
        job = self.services.get_item(owner, kind, job_id)
        if not job or job.get('projectId') != project or job.get('status') != 'COMPLETED':
            return None
        try:
            if kind == 'CALCULATION':
                from backend.local_api.domain.dft_validation import dependency_dft_error, read_dft_manifest
                if dependency_dft_error(self.services, job):
                    return None
                manifest = read_dft_manifest(self.services, job)
                if not any((artifact.get('role') == 'data' and str(artifact.get('path', '')).endswith('.csv') for artifact in manifest.get('artifacts', []))):
                    return None
            else:
                from backend.local_api.domain.md_results import read_md_result_manifest
                read_md_result_manifest(self.services, job)
            return {'jobId': job_id, 'jobKind': kind}
        except Exception:
            return None

    def plan(self, owner: str, project: str, payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        envelope = self.load(owner, project)
        if type(payload.get('revision')) is not int or payload['revision'] != envelope['revision']:
            fail('Save and validate the current workflow before running.', 'WORKFLOW_CONFLICT', 409)
        graph = validate_graph(envelope['workflow'], project)
        targets = payload.get('targets', [node['id'] for node in graph['nodes']])
        rerun = payload.get('rerun', [])
        if not isinstance(targets, list) or not targets or len(targets) > 1000 or any((not identifier(item) for item in targets)) or (len(set(targets)) != len(targets)) or (not isinstance(rerun, list)) or (len(rerun) > 1000) or any((not identifier(item) for item in rerun)) or (len(set(rerun)) != len(rerun)):
            fail('Select existing workflow targets to run.')
        execution_order = order(graph, targets)
        if any((item not in execution_order for item in rerun)):
            fail('Only targets and their prerequisites can be run fresh.')
        forced = set(rerun)
        for node_id in execution_order:
            if any((edge['source'] in forced and edge['target'] == node_id for edge in graph['edges'])):
                forced.add(node_id)
        hashes = fingerprints(graph)
        nodes_by_id = {node['id']: node for node in graph['nodes']}
        input_sources: dict[str, list[str]] = {node_id: [] for node_id in nodes_by_id}
        for edge in graph['edges']:
            input_sources[edge['target']].append(edge['source'])
        deferred_nodes: set[str] = set()
        for node_id in execution_order:
            if any((source in deferred_nodes or nodes_by_id[source]['kind'] in {'extract-frame', 'relax'} for source in input_sources[node_id])):
                deferred_nodes.add(node_id)
        needs_compiler = any((node['id'] in execution_order and (node['kind'] in DFT_TYPES and node['configuration'].get('compilerVersion') == 1 or (node['kind'] == 'md' and isinstance(node['configuration'].get('components'), list))) for node in graph['nodes']))
        from backend.local_api.domain.workflow_compiler import invoke
        compiled = invoke('prepareNodes', [graph, execution_order]) if needs_compiler else {}
        planned: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        estimated_micros = 0
        worker = self.services.get_item(owner, 'PERSONAL_WORKER', 'primary') or {}
        now = time.time()
        for node_id in execution_order:
            node = next((node for node in graph['nodes'] if node['id'] == node_id))
            input_edges = [edge for edge in graph['edges'] if edge['target'] == node_id]
            error = None
            if PORTS[node['kind']][0] and (not input_edges):
                error = 'Connect the required input.'
            deferred = False
            if node['kind'] in DFT_TYPES and node['configuration'].get('compilerVersion') == 1:
                deferred = node_id in deferred_nodes
                error = error or compiled.get(node_id, {}).get('issue')
            if node['kind'] == 'md' and isinstance(node['configuration'].get('components'), list):
                error = error or compiled.get(node_id, {}).get('issue')
                if not error:
                    from backend.local_api.domain.api import normalize_md_simulation_workflow
                    try:
                        expected = normalize_md_simulation_workflow(compiled[node_id]['mdWorkflow'])
                        execution = node['configuration'].get('execution') or {'name': node['name'], 'computeTarget': 'personal'}
                        actual = normalize_md_simulation_workflow(execution['workflow']) if execution.get('workflow') else None

                        def physical(workflow):
                            value = copy.deepcopy(workflow)
                            for step in value['steps']:
                                step.pop('id', None)
                                step.pop('name', None)
                            return value
                        if actual is not None and physical(actual) != physical(expected):
                            error = 'MD execution differs from its editor configuration. Review the current stages again.'
                        else:
                            node['configuration']['execution'] = {**execution, 'workflow': expected}
                    except ApiError as exc:
                        error = str(exc)
            if node['kind'] in {'structure', 'trajectory'} and (not node['resources']):
                error = 'Create or import a saved input first.'
            legacy_result = self.retained_legacy_result(owner, project, node) if node['kind'] == 'legacy' else None
            if node['kind'] == 'legacy' and (not legacy_result):
                error = 'Open the preserved legacy editor to run this configuration.'
            if node['kind'] not in {'structure', 'trajectory', 'figure', 'legacy', 'extract-frame'} and (not node['configuration'].get('execution')) and (not deferred):
                error = node['configuration'].get('configurationError') or 'Configure this module before running.'
            if node['kind'] == 'extract-frame' and (type(node['configuration'].get('frame')) is not int or node['configuration']['frame'] < 0 or node['configuration'].get('coordinateUnit') != 'angstrom' or (not isinstance(node['configuration'].get('periodic'), list)) or (len(node['configuration']['periodic']) != 3) or any((type(axis) is not bool for axis in node['configuration']['periodic']))):
                error = 'Choose an explicit frame and confirm angstrom coordinates.'
            if node['kind'] in {'md', 'md-analysis', 'extract-frame'} and node['configuration'].get('execution', {}).get('computeTarget', 'personal') != 'personal':
                error = 'MD runs on Your computer only.'
            if node['kind'] in {'md', 'md-analysis'} and node['configuration'].get('execution'):
                from backend.local_api.domain.api import normalize_md_simulation_workflow, normalize_md_pipeline
                execution = node['configuration']['execution']
                try:
                    if node['kind'] == 'md':
                        normalize_md_simulation_workflow(execution.get('workflow'))
                    else:
                        normalize_md_pipeline(execution.get('pipeline'))
                except ApiError as exc:
                    error = str(exc)
            try:
                self.resources(owner, {**graph, 'nodes': [node]}, execution=True)
            except ApiError as exc:
                error = str(exc)
            reusable = None if node_id in forced or error else self.find_reusable(owner, project, node, hashes[node_id])
            action = 'reuse' if reusable else 'input' if node['kind'] in {'structure', 'trajectory'} or legacy_result else 'prepare' if node['kind'] == 'figure' else 'run'
            if action == 'run' and (not error) and (node['kind'] in DFT_TYPES) and (node['configuration'].get('computeTarget') == 'shared'):
                raise ApiError(400, 'Submit online compute through the optional Cloud connection. This workflow runner executes on Your computer.', 'INVALID_COMPUTE_TARGET')
            capability = 'qe' if node['kind'] in DFT_TYPES else 'md-simulation' if node['kind'] == 'md' else 'md-analysis' if node['kind'] in {'md-analysis', 'extract-frame'} else None
            if action == 'run' and not error and capability:
                runtime = 'DFT (Quantum ESPRESSO)' if capability == 'qe' else 'MD and analysis (LAMMPS/OVITO)'
                if not worker.get('tokenHash') or int(worker.get('lastSeenAtEpoch') or 0) < now - 90:
                    error = 'Your computer is offline. Start or restart phynite-lab and wait for Your computer in Settings > Compute (/local#runtime) to become ready.'
                    if capability not in (worker.get('capabilities') or []):
                        error += f' If the {runtime} runtime is not installed for this workspace, install it there (/local#runtime).'
                elif capability not in (worker.get('capabilities') or []):
                    error = f'Install the {runtime} runtime for this workspace in Settings > Compute (/local#runtime), then wait for Your computer to become ready.'
                elif capability == 'qe' and getattr(self.services, 'local_workspace', False):
                    from backend.local_api.pseudopotentials import execution_pseudopotential_error
                    error = execution_pseudopotential_error(self.services.data_dir, node['configuration'].get('execution', {}))
            if error:
                errors.append({'nodeId': node_id, 'message': error})
            scf_source = next((edge['source'] for edge in input_edges if edge['port'] == 'electronic'), None)
            planned.append({'nodeId': node_id, 'fingerprint': hashes[node_id], 'action': action, 'force': node_id in forced, 'validationDeferred': deferred, **({'sourceScfNodeId': scf_source} if scf_source else {}), **({'sourceAttemptId': reusable['id']} if reusable else {}), **({'error': error} if error else {})})
        compiler_sha = None
        if needs_compiler:
            from backend.local_api.domain.workflow_compiler import compiler_source
            compiler_sha = hashlib.sha256(compiler_source().encode()).hexdigest()
        return ({'compilerSha256': compiler_sha, 'revision': envelope['revision'], 'targets': targets, 'order': execution_order, 'nodes': planned, 'errors': errors, 'compute': {'pricing': 'existing', 'md': 'personal', 'requiresConfirmation': True, 'estimatedQuanta': estimated_micros / 1000000, 'hasSharedCompute': any((node['configuration'].get('computeTarget') == 'shared' for node in graph['nodes'] if node['id'] in execution_order))}}, graph)

    def start(self, owner: str, project: str, payload: dict[str, Any]) -> dict[str, Any]:
        key = payload.get('idempotencyKey')
        if not isinstance(key, str) or not re.fullmatch('[A-Za-z0-9_-]{16,96}', key):
            fail('Supply a stable idempotency key for this run.')
        run_id = 'run_' + hashlib.sha256(f'{project}:{key}'.encode()).hexdigest()[:40]
        previous = self.services.get_item(owner, 'PROJECT_RUN', run_id)
        request_hash = digest({field: payload.get(field) for field in ('revision', 'targets', 'rerun', 'compilerSha256')})
        if previous:
            if previous.get('requestFingerprint') != request_hash:
                fail('This run key already identifies another request.', 'IDEMPOTENCY_CONFLICT', 409)
            return self.get_run(owner, project, run_id)
        plan, graph = self.plan(owner, project, payload)
        if plan['errors']:
            fail('Fix workflow configuration errors before submitting.', 'WORKFLOW_NOT_READY', 422)
        if plan.get('compilerSha256') and payload.get('compilerSha256') != plan['compilerSha256']:
            fail('The scientific compiler changed. Review the updated run plan.', 'WORKFLOW_COMPILER_CHANGED', 409)
        snapshot = {'workflow': graph, 'plan': plan}
        if plan.get('compilerSha256'):
            from backend.local_api.domain.workflow_compiler import compiler_source
            snapshot['compiler'] = {'sha256': plan['compilerSha256'], 'source': compiler_source()}
        object_key, checksum = self.write_json(owner, project, 'runs', snapshot)
        item = self.put_new(owner, 'PROJECT_RUN', run_id, {'projectId': project, 'workflowRevision': plan['revision'], 'status': 'pending', 'targets': plan['targets'], 'objectKey': object_key, 'sha256': checksum, 'revision': 0, 'requestFingerprint': request_hash})
        if not item:
            previous = self.services.get_item(owner, 'PROJECT_RUN', run_id)
            if not previous or previous.get('requestFingerprint') != request_hash:
                fail('Concurrent run request differs. Retry with a new key.', 'IDEMPOTENCY_CONFLICT', 409)
        self.advance(owner, project, run_id)
        return self.get_run(owner, project, run_id)

    def attempt(self, owner: str, run_id: str, node_id: str) -> dict[str, Any] | None:
        return self.services.get_item(owner, 'WORKFLOW_ATTEMPT', f'{run_id}_{node_id}')

    def advance(self, owner: str, project: str, run_id: str) -> None:
        run = require_owner_item(self.services, owner, 'PROJECT_RUN', run_id, 'WORKFLOW_RUN_NOT_FOUND')
        if run.get('projectId') != project:
            fail('Run belongs to another project.', 'PROJECT_MISMATCH', 409)
        if run['status'] in {'completed', 'failed', 'cancelled'} or float(run.get('leaseUntil', 0)) > time.time():
            return
        revision = int(run['revision'])
        if not self.services.update_item_if_revision(owner, 'PROJECT_RUN', run_id, revision, {'revision': revision + 1, 'leaseUntil': int(time.time()) + 90}):
            return
        snapshot = self.read_json(run['objectKey'], run['sha256'])
        graph, plan = (snapshot['workflow'], snapshot['plan'])
        attempts: dict[str, Any] = {}
        started = time.monotonic()
        try:
            for planned in plan['nodes']:
                if time.monotonic() - started > 12:
                    break
                node_id = planned['nodeId']
                node = next((node for node in graph['nodes'] if node['id'] == node_id))
                attempt_id = f'{run_id}_{node_id}'
                attempt = self.attempt(owner, run_id, node_id)
                if attempt is None:
                    self.put_new(owner, 'WORKFLOW_ATTEMPT', attempt_id, {'projectId': project, 'runId': run_id, 'nodeId': node_id, 'fingerprint': planned['fingerprint'], 'status': 'pending'})
                    attempt = self.attempt(owner, run_id, node_id)
                requested = set(self.services.get_item(owner, 'PROJECT_RUN', run_id).get('cancelRequests', []))
                if node_id in requested:
                    attempt = self.cancel_attempt(owner, run_id, attempt)
                if attempt['status'] in FINAL:
                    attempts[node_id] = attempt
                    continue
                updates: dict[str, Any] = {}
                inputs = [attempts[edge['source']] for edge in graph['edges'] if edge['target'] == node_id]
                if attempt.get('jobId'):
                    job = self.services.get_item(owner, attempt['jobKind'], attempt['jobId'])
                    state = (job or {}).get('status', 'FAILED')
                    updates = {'status': {'COMPLETED': 'completed', 'FAILED': 'failed', 'CANCELLED': 'cancelled', 'RUNNING': 'running', 'QUEUED': 'queued'}.get(state, 'queued')}
                    if state in {'FAILED', 'CANCELLED'}:
                        updates['error'] = (job or {}).get('failureReason', 'Execution did not complete.')
                    elif state == 'COMPLETED':
                        updates['result'] = {'jobId': job['id'], 'jobKind': attempt['jobKind']}
                        if node['kind'] == 'extract-frame':
                            try:
                                from backend.local_api.domain.workflow_md_results import analysis_frame, frame_structure
                                frame, checksum = analysis_frame(self.services, job, node['configuration']['frame'])
                                structure = frame_structure(frame['frame'], {**node['configuration'], 'name': node['name']})
                                structure['provenance'].update(analysisId=job['id'], sourceSha256=checksum)
                                resource_id = 'str_' + digest([attempt_id, structure])[:32]
                                object_key, sha = self.write_json(owner, project, 'derived-structures', structure)
                                self.put_new(owner, 'STRUCTURE', resource_id, {'projectId': project, 'name': node['name'], 'formula': structure['formula'], 'status': 'READY', 'atomCount': len(structure['atoms']), 'objectKey': object_key, 'sha256': sha, 'source': 'workflow-md-frame', 'updatedAt': utc_now()})
                                updates['result'] = {'jobId': job['id'], 'jobKind': attempt['jobKind'], 'resources': [{'kind': 'structure', 'id': resource_id, 'sha256': sha}], 'structureRef': {'id': resource_id, 'sha256': sha}}
                            except (ApiError, ValueError, KeyError) as exc:
                                updates = {'status': 'failed', 'error': str(exc)}
                elif any((item['status'] in {'failed', 'blocked', 'cancelled'} for item in inputs)):
                    updates = {'status': 'blocked', 'error': 'A prerequisite did not complete. Independent branches continue.'}
                elif all((item['status'] in SUCCESS for item in inputs)):
                    try:
                        if planned['action'] == 'reuse':
                            reusable = self.find_reusable(owner, project, node, planned['fingerprint'])
                            if reusable:
                                updates = {'status': 'reused', 'sourceAttemptId': reusable['id'], 'jobId': reusable['jobId'], 'jobKind': reusable['jobKind'], 'result': reusable.get('result', {})}
                            else:
                                fail('A reused result is no longer available. Review and retry this run.', 'WORKFLOW_REUSE_EXPIRED', 409)
                        elif planned['action'] == 'input':
                            self.resources(owner, {**graph, 'nodes': [node]}, execution=True)
                            legacy_result = self.retained_legacy_result(owner, project, node) if node['kind'] == 'legacy' else None
                            if node['kind'] == 'legacy' and (not legacy_result):
                                fail('The retained result is no longer available.', 'WORKFLOW_REUSE_EXPIRED', 409)
                            updates = {'status': 'completed', **(legacy_result or {}), 'result': legacy_result or {'resources': node['resources']}}
                        elif planned['action'] == 'prepare':
                            sources = self.figure_sources(owner, project, inputs)
                            updates = {'status': 'ready', 'result': {'sources': sources, 'figureRevision': digest(sources)}}
                        else:
                            updates = self.dispatch(owner, project, run_id, node, inputs, attempt_id, planned)
                    except ApiError as exc:
                        updates = {'status': 'failed', 'error': str(exc), 'errorCode': exc.code}
                if updates:
                    attempt = self.services.update_item(owner, 'WORKFLOW_ATTEMPT', attempt_id, {**updates, 'updatedAt': utc_now()})
                if node_id in set(self.services.get_item(owner, 'PROJECT_RUN', run_id).get('cancelRequests', [])):
                    attempt = self.cancel_attempt(owner, run_id, attempt)
                attempts[node_id] = attempt
            states = [item['status'] for item in attempts.values()]
            status = 'running' if len(attempts) != len(plan['nodes']) else 'cancelled' if states and all((state == 'cancelled' for state in states)) else 'completed' if all((state in SUCCESS for state in states)) else 'failed' if all((state in FINAL for state in states)) else 'running'
            latest = self.services.get_item(owner, 'PROJECT_RUN', run_id)
            if len(attempts) == len(plan['nodes']) and latest.get('cancelRequests') and all((state in FINAL for state in states)):
                status = 'cancelled'
            if latest.get('cancelRequests') and any((attempts.get(node_id, {}).get('status') not in FINAL for node_id in latest['cancelRequests'])):
                status = 'running'
            self.services.update_item_if_revision(owner, 'PROJECT_RUN', run_id, int(latest['revision']), {'revision': int(latest['revision']) + 1, 'status': status, 'leaseUntil': 0, 'updatedAt': utc_now()})
        except Exception:
            self.services.update_item(owner, 'PROJECT_RUN', run_id, {'leaseUntil': 0})
            raise

    def figure_sources(self, owner: str, project: str, inputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sources = []
        for item in inputs:
            result = item.get('result', {})
            job_id, kind = (result.get('jobId'), result.get('jobKind'))
            if kind not in {'CALCULATION', 'MD_ANALYSIS'} or not identifier(job_id):
                fail('Figure requires retained numerical calculation or MD analysis results.', 'WORKFLOW_FIGURE_NOT_READY', 422)
            job = require_owner_item(self.services, owner, kind, job_id, 'WORKFLOW_RESULT_NOT_FOUND')
            if job.get('projectId') != project or job.get('status') != 'COMPLETED':
                fail('Figure sources must be completed in this project.', 'WORKFLOW_FIGURE_NOT_READY', 409)
            if kind == 'MD_ANALYSIS':
                from backend.local_api.domain.workflow_md_results import numerical_datasets
                datasets = numerical_datasets(self.services, owner, project, job_id)
                if not datasets or any((not dataset.get('points') for dataset in datasets)):
                    fail('The MD analysis has no retained numerical samples.', 'WORKFLOW_FIGURE_NOT_READY', 422)
            else:
                from backend.local_api.domain.dft_validation import dependency_dft_error, read_dft_manifest
                if dependency_dft_error(self.services, job):
                    fail('Figure source convergence could not be verified.', 'WORKFLOW_FIGURE_NOT_READY', 409)
                manifest = read_dft_manifest(self.services, job)
                data = [artifact for artifact in manifest.get('artifacts', []) if artifact.get('role') == 'data' and str(artifact.get('path', '')).endswith('.csv')]
                if not data:
                    fail('The source has no retained numerical dataset.', 'WORKFLOW_FIGURE_NOT_READY', 422)
                from backend.local_api.domain.worker_artifacts import WorkerArtifacts
                for artifact in data:
                    WorkerArtifacts(self.services).verify(job, artifact['path'], artifact['sizeBytes'], artifact['sha256'])
            sources.append({'nodeId': item['nodeId'], 'fingerprint': item['fingerprint'], 'result': result})
        return sources

    def dispatch(self, owner: str, project: str, run_id: str, node: dict[str, Any], inputs: list[dict[str, Any]], attempt_id: str, planned: dict[str, Any]) -> dict[str, Any]:
        execution_id = 'exec_' + digest([project, planned['fingerprint'], attempt_id if planned.get('force') else 'shared'])[:40]
        current = self.services.get_item(owner, 'WORKFLOW_EXECUTION', execution_id)
        if current and current.get('jobId'):
            job = self.services.get_item(owner, current['jobKind'], current['jobId'])
            if job and job.get('status') in {'RUNNING', 'QUEUED', 'PREPARING', 'CANCEL_REQUESTED'}:
                return {'status': 'queued', 'jobId': current['jobId'], 'jobKind': current['jobKind']}
        if current and float(current.get('leaseUntil', 0)) > time.time():
            return {}
        revision = int(current.get('revision', 0)) if current else 0
        request_key = current.get('requestKey') if current and (not current.get('jobId')) else None
        values = {'projectId': project, 'revision': revision + 1, 'leaseUntil': int(time.time()) + 90, 'requestKey': request_key or new_id('dispatch')}
        if current and current.get('jobId'):
            values.update(jobId=None, jobKind=None)
        acquired = self.services.update_item_if_revision(owner, 'WORKFLOW_EXECUTION', execution_id, revision, values) if current else self.put_new(owner, 'WORKFLOW_EXECUTION', execution_id, values)
        if not acquired:
            return {}
        try:
            updates = self.submit(owner, project, run_id, node, inputs, acquired['requestKey'])
            self.services.update_item(owner, 'WORKFLOW_EXECUTION', execution_id, {'jobId': updates['jobId'], 'jobKind': updates['jobKind'], 'leaseUntil': 0})
            return updates
        except Exception:
            self.services.update_item(owner, 'WORKFLOW_EXECUTION', execution_id, {'leaseUntil': 0})
            raise

    def cancel_attempt(self, owner: str, run_id: str, attempt: dict[str, Any]) -> dict[str, Any]:
        if attempt['status'] in FINAL:
            return attempt
        if attempt.get('jobId'):
            users = [other for other in self.services.list_owner_items(owner, 'WORKFLOW_ATTEMPT') if other.get('jobId') == attempt['jobId'] and other.get('runId') != run_id and (other.get('status') not in FINAL)]
            if not users:
                method = {'CALCULATION': self.api.cancel_calculation, 'MD_SIMULATION': self.api.cancel_md_simulation, 'MD_ANALYSIS': self.api.cancel_md_analysis}[attempt['jobKind']]
                try:
                    method(owner, attempt['jobId'])
                except ApiError as exc:
                    if exc.status != 409:
                        raise
        return self.services.update_item(owner, 'WORKFLOW_ATTEMPT', attempt['id'], {'status': 'cancelled', 'updatedAt': utc_now()})

    def submit(self, owner: str, project: str, run_id: str, node: dict[str, Any], inputs: list[dict[str, Any]], attempt_id: str) -> dict[str, Any]:
        payload = copy.deepcopy(node['configuration'].get('execution') or {})
        payload['idempotencyKey'] = 'wf_' + hashlib.sha256(attempt_id.encode()).hexdigest()[:60]
        kind = node['kind']
        if kind in DFT_TYPES and node['configuration'].get('compilerVersion') == 1:
            from backend.local_api.domain.workflow_compiler import invoke
            from backend.local_api.domain.workflow_structure import source_structure
            run = self.services.get_item(owner, 'PROJECT_RUN', run_id)
            snapshot = self.read_json(run['objectKey'], run['sha256'])
            frozen = snapshot['workflow']
            structure = source_structure(self, owner, project, inputs[0])
            if inputs[0].get('jobKind') == 'CALCULATION':
                predecessor = self.services.get_item(owner, 'CALCULATION', inputs[0]['jobId'])
                structure_id = predecessor['structureId']
            else:
                structure_id = next((ref['id'] for ref in inputs[0]['result']['resources'] if ref['kind'] == 'structure'))
            payload = invoke('compileBoundDft', [frozen, node['id'], structure, structure_id], snapshot['compiler'])
            payload['idempotencyKey'] = 'wf_' + hashlib.sha256(attempt_id.encode()).hexdigest()[:60]
        if kind in DFT_TYPES:
            # Canvas DFT nodes use the same owner-scoped local calculation
            # admission as the standalone DFT form.  The workflow runner used
            # to reject every DFT node here, even when the node explicitly
            # targeted the user's computer, so a valid local workflow stopped
            # after its structure prerequisite with INVALID_COMPUTE_TARGET.
            # Shared/cloud DFT is still rejected by the plan and must go
            # through the cloud submission flow with its own transfer review.
            if payload.get('computeTarget', 'personal') != 'personal':
                raise ApiError(400, 'Submit online compute through the optional Cloud connection. This workflow runner executes on Your computer.', 'INVALID_COMPUTE_TARGET')
            payload['computeTarget'] = 'personal'
            workflow_protocol = 1 if node['configuration'].get('compilerVersion') == 1 else 0
            result = json.loads(self.api.create_calculation(owner, project, payload, workflow_protocol=workflow_protocol)['body'])['calculation']
            return {'status': 'queued', 'jobId': result['id'], 'jobKind': 'CALCULATION'}
        if kind == 'md':
            if payload.get('computeTarget', 'personal') != 'personal':
                fail('MD runs on Your computer only.')
            payload['computeTarget'] = 'personal'
            from backend.local_api.domain.workflow_structure import md_structure_input
            payload['trajectoryId'] = md_structure_input(self, owner, project, inputs[0], payload.get('workflow', {}).get('boundaryType', ''))
            result = json.loads(self.api.create_md_simulation(owner, project, payload)['body'])['simulation']
            return {'status': 'queued', 'jobId': result['id'], 'jobKind': 'MD_SIMULATION'}
        if kind in {'md-analysis', 'extract-frame'}:
            source = inputs[0]
            if source.get('jobKind') == 'MD_SIMULATION':
                simulation = require_owner_item(self.services, owner, 'MD_SIMULATION', source['jobId'], 'MD_SIMULATION_NOT_FOUND')
                payload['trajectoryId'] = simulation.get('resultTrajectoryId')
            else:
                payload['trajectoryId'] = next((ref['id'] for ref in source.get('result', {}).get('resources', []) if ref['kind'] == 'trajectory'), None)
            if kind == 'extract-frame':
                frame = node['configuration']['frame']
                payload['pipeline'] = {'version': 1, 'modifiers': [], 'typeMap': node['configuration'].get('elementMap', {}), 'periodic': node['configuration']['periodic'], 'frameRange': {'start': frame, 'stop': frame + 1, 'stride': 1}}
            if payload.get('computeTarget', 'personal') != 'personal':
                fail('MD runs on Your computer only.', 'INVALID_COMPUTE_TARGET', 422)
            payload['computeTarget'] = 'personal'
            result = json.loads(self.api.create_md_analysis(owner, project, payload)['body'])['analysis']
            return {'status': 'queued', 'jobId': result['id'], 'jobKind': 'MD_ANALYSIS'}
        fail('This module has no execution handler.', 'WORKFLOW_MODULE_NOT_READY', 422)
        return {}

    def get_run(self, owner: str, project: str, run_id: str) -> dict[str, Any]:
        require_project(self.services, owner, project)
        item = require_owner_item(self.services, owner, 'PROJECT_RUN', run_id, 'WORKFLOW_RUN_NOT_FOUND')
        if item.get('projectId') != project:
            fail('Run belongs to another project.', 'PROJECT_MISMATCH', 409)
        snapshot = self.read_json(item['objectKey'], item['sha256'])
        attempts = []
        allowed = {'nodeId', 'fingerprint', 'status', 'jobId', 'jobKind', 'error', 'result', 'sourceAttemptId'}
        for planned in snapshot['plan']['nodes']:
            attempt = self.attempt(owner, run_id, planned['nodeId'])
            if attempt:
                attempts.append({key: value for key, value in attempt.items() if key in allowed} | {'outdated': False})
        return {'run': {key: item[key] for key in ('id', 'projectId', 'workflowRevision', 'status', 'createdAt', 'targets')} | {'attempts': attempts}}

    def cancel(self, owner: str, project: str, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.get_run(owner, project, run_id)
        for _ in range(3):
            current = self.services.get_item(owner, 'PROJECT_RUN', run_id)
            snapshot = self.read_json(current['objectKey'], current['sha256'])
            allowed = set(snapshot['plan']['order'])
            selected = payload.get('nodeIds', list(allowed))
            if not isinstance(selected, list) or not selected or any((not identifier(node_id) or node_id not in allowed for node_id in selected)):
                fail('Select nodes in this run to cancel.')
            cancelled = set(selected) | set(current.get('cancelRequests', []))
            for _ in snapshot['workflow']['nodes']:
                cancelled.update((edge['target'] for edge in snapshot['workflow']['edges'] if edge['source'] in cancelled and edge['target'] in allowed))
            revision = int(current['revision'])
            if self.services.update_item_if_revision(owner, 'PROJECT_RUN', run_id, revision, {'revision': revision + 1, 'cancelRequests': sorted(cancelled)}):
                self.advance(owner, project, run_id)
                return self.get_run(owner, project, run_id)
        fail('Run changed while cancellation was requested. Retry.', 'WORKFLOW_CONFLICT', 409)
        return {}

    def tick_owner(self, owner: str) -> None:
        for item in self.services.list_owner_items(owner, 'PROJECT_RUN'):
            if item.get('status') in {'pending', 'running'}:
                self.advance(owner, item['projectId'], item['id'])

    def handle(self, owner: str, project: str, action: str | None, run_id: str | None, cancel: str | None, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        require_project(self.services, owner, project)
        if not action and method == 'GET':
            return response(200, self.load(owner, project))
        if not action and method == 'PUT':
            return response(200, self.save(owner, project, payload))
        if action == 'plan' and method == 'POST':
            return response(200, {'plan': self.plan(owner, project, payload)[0]})
        if action == 'import' and method == 'POST':
            from backend.local_api.domain.workflow_import import import_workflow
            return response(200, import_workflow(self, owner, project, payload))
        if action == 'runs' and (not run_id) and (method == 'POST'):
            return response(202, self.start(owner, project, payload))
        if action == 'runs' and (not run_id) and (method == 'GET'):
            runs = sorted((item for item in self.services.list_owner_items(owner, 'PROJECT_RUN') if item.get('projectId') == project), key=lambda item: item['createdAt'], reverse=True)
            return response(200, {'runs': [self.get_run(owner, project, item['id'])['run'] for item in runs[:100]]})
        if action == 'runs' and run_id and (method == 'GET') and (not cancel):
            self.advance(owner, project, run_id)
            return response(200, self.get_run(owner, project, run_id))
        if action == 'runs' and run_id and (method == 'POST') and cancel:
            return response(200, self.cancel(owner, project, run_id, payload))
        fail('Workflow route was not found.', 'NOT_FOUND', 404)
        return {}
