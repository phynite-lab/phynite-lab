"""Owner/project scoped MLIP jobs, immutable requests and proposal-only DFT promotion."""
from __future__ import annotations
import hashlib
import json
import subprocess
import time

from backend.mlip.contract import MODEL, checksum, geometry, protocol, validate_result
from backend.local_api.domain.ai_workspace import AiWorkspace, digest, fail
from backend.local_api.domain.project_workflow import ProjectWorkflowApi
from backend.local_api.domain.phynite_core import json_safe
from backend.local_api.domain.elements import ELEMENT_SYMBOLS
from backend.local_api.domain.workflow_structure import lattice_vectors
from backend.local_api.mlip_runtime import SOURCES

TERMINAL = {'completed', 'failed', 'cancelled', 'manual resume required'}


class MlipJobs:
    def __init__(self, api, runtime=None):
        self.ai = AiWorkspace(api); self.services = api.services; self.workflow = ProjectWorkflowApi(api)
        self.runtime = runtime or getattr(self.services, 'mlip_runtime', None)
        self.processes = {}

    def prepare(self, owner, conversation, data):
        if not self.runtime or not self.runtime.status()['ready']:
            fail(422, 'Install and qualify the separate MLIP runtime in Settings → Compute before proposing a run.', 'MLIP_NOT_QUALIFIED')
        project = self.ai.scope(owner, conversation['projectKey'])
        if not project or project['kind'] != 'canvas': fail(422, 'MLIP requires a saved Canvas project.', 'MLIP_PROJECT_REQUIRED')
        item = self.ai.row(owner, 'STRUCTURE', data.get('structureId'))
        if item.get('projectId') != project['id']: fail(404, 'Structure is outside this project.', 'AI_NOT_FOUND')
        raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=item['objectKey'])['Body'].read(5_000_001)
        if len(raw) > 5_000_000 or hashlib.sha256(raw).hexdigest() != item.get('sha256'): fail(409, 'Source structure checksum changed.', 'MLIP_SOURCE_CHANGED')
        source = json.loads(raw)
        if any(atom.get('species') not in ELEMENT_SYMBOLS or atom.get('occupancy', 1) != 1 or atom.get('siteSpecies') and (len(atom['siteSpecies']) != 1 or atom['siteSpecies'][0].get('element') != atom['species'] or atom['siteSpecies'][0].get('occupancy') != 1) for atom in source['atoms']):
            fail(422, 'MLIP requires explicit elements and fully occupied sites.', 'MLIP_STRUCTURE_INVALID')
        try:
            g = geometry({'symbols': [atom['species'] for atom in source['atoms']], 'scaledPositions': [[atom[key] for key in ('x', 'y', 'z')] for atom in source['atoms']], 'cellAngstrom': lattice_vectors(source['lattice']), 'periodic': source.get('periodic', source['lattice'].get('periodic'))})
            p = protocol(data.get('protocol'))
        except (ValueError, KeyError, TypeError) as error: fail(422, str(error), 'MLIP_INPUT_INVALID')
        return {'schemaVersion': 1, 'structureId': item['id'], 'sourceSha256': item['sha256'], 'projectId': project['id'], 'geometry': g, 'protocol': p, 'model': MODEL, 'runtimeBinding': self.runtime.approval_binding()}

    def create(self, owner, conversation, action, data):
        identifier = 'mlip_' + digest([owner, action['id']])[:32]
        existing = self.services.get_item(owner, 'MLIP_JOB', identifier)
        if existing:
            if existing.get('requestSha256') != checksum(data): fail(409, 'MLIP submission key changed.', 'MLIP_CONFLICT')
            return {'mlipId': identifier, 'status': existing['status']}
        key, sha = self.workflow.write_json(owner, data['projectId'], 'mlip', data)
        self.ai.put(owner, 'MLIP_JOB', identifier, {'GSI1PK': 'PROJECT#' + data['projectId'], 'GSI1SK': 'MLIP_JOB#' + identifier, 'projectId': data['projectId'], 'conversationId': conversation['id'], 'status': 'queued', 'requestKey': key, 'requestObjectSha256': sha, 'requestSha256': checksum(data), 'structureId': data['structureId']})
        return {'mlipId': identifier, 'status': 'queued'}

    def scoped(self, owner, conversation, identifier):
        row = self.ai.row(owner, 'MLIP_JOB', identifier)
        project = self.ai.scope(owner, conversation['projectKey'])
        if not project or row['projectId'] != project['id'] or row['conversationId'] != conversation['id']: fail(404, 'MLIP job is outside this conversation/project.', 'AI_NOT_FOUND')
        return row

    def read(self, owner, conversation, identifier):
        row = self.scoped(owner, conversation, identifier)
        row = json_safe(row)
        result = {key: row[key] for key in ('id', 'status', 'revision', 'structureId', 'requestSha256', 'reason') if key in row}
        if row['status'] == 'completed':
            request = self.workflow.read_json(row['requestKey'], row['requestObjectSha256'])
            value = self.workflow.read_json(row['resultKey'], row['resultSha256'])
            result.update(result=validate_result(value, request), resultSha256=row['resultSha256'])
        return result

    def cancel(self, owner, conversation, identifier, revision):
        row = self.scoped(owner, conversation, identifier)
        if type(revision) is not int or revision != row['revision']: fail(409, 'Read the latest MLIP revision before cancelling.', 'MLIP_CONFLICT')
        if row['status'] not in TERMINAL: self.ai.update(owner, 'MLIP_JOB', row, {'cancelRequested': True})
        return {'mlipId': identifier, 'cancelRequested': True}

    def promotions(self, owner, conversation, data):
        ids, window = data.get('ids'), data.get('energyWindowEvPerAtom')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 32 or any(not isinstance(identifier, str) for identifier in ids) or len(set(ids)) != len(ids) or type(window) not in {int, float} or not 0 <= window <= 10:
            fail(422, 'Review distinct MLIP results and a finite energy window from 0 to 10 eV/atom.', 'MLIP_SCREENING_INVALID')
        rows = [self.read(owner, conversation, identifier) for identifier in ids]
        results = [row.get('result') for row in rows]
        if any(not result or not result['converged'] for result in results): fail(422, 'Only completed force-converged results can be screened.', 'MLIP_SCREENING_INVALID')
        identity = lambda result: checksum([sorted(result['finalGeometry']['symbols']), result['model'], result['protocolSha256'], result['finalGeometry']['periodic']])
        if len({identity(result) for result in results}) != 1: fail(422, 'Screening needs identical composition, model and protocol. MLIP energies cannot be compared to corrected Materials Project energies.', 'MLIP_SCREENING_MISMATCH')
        minimum = min(result['energyPerAtomEv'] for result in results)
        ordered = sorted((row for row in rows if row['result']['energyPerAtomEv'] <= minimum + window), key=lambda row: (row['result']['energyPerAtomEv'], row['id']))[:3]
        return {'status': 'proposal_only', 'requiresNewDftApproval': True, 'candidates': ordered, 'note': 'MLIP energy ranking is not a band-gap prediction. Review DFT inputs and scientific suitability separately.'}

    def update(self, row, **values):
        return json_safe(self.ai.update(row['ownerId'], 'MLIP_JOB', row, values))

    def tick(self):
        owner = self.services.owner
        rows = [json_safe(row) for row in self.services.list_owner_items(owner, 'MLIP_JOB') if row['status'] not in TERMINAL]
        for row in rows:
            process = self.processes.get(row['id'])
            if row['status'] == 'running':
                if not process:
                    self.update(row, status='manual resume required', reason='Application restarted with an uncertain MLIP attempt; no automatic resubmission.')
                    continue
                directory = self.services.data_dir / 'work/mlip' / row['id']
                stop = row.get('cancelRequested') or time.time() >= row['deadlineEpoch']
                if stop and process.poll() is None:
                    (directory / 'cancel').touch(); process.terminate()
                if process.poll() is None: continue
                self.processes.pop(row['id'], None)
                if stop:
                    self.update(row, status='cancelled' if row.get('cancelRequested') else 'failed', reason='Cancellation requested or reviewed wall budget exhausted.')
                elif process.returncode != 0:
                    self.update(row, status='failed', reason='MACE did not produce a verified completed result. Inspect the retained local runtime log.')
                else:
                    try:
                        request = self.workflow.read_json(row['requestKey'], row['requestObjectSha256'])
                        value = validate_result(json.loads((directory / 'result.json').read_text()), request)
                        key, sha = self.workflow.write_json(owner, row['projectId'], 'mlip', value)
                        self.update(row, status='completed', resultKey=key, resultSha256=sha)
                    except Exception:
                        self.update(row, status='failed', reason='MLIP result validation failed; no scientific result was accepted.')
            elif row.get('cancelRequested'):
                self.update(row, status='cancelled')
        if self.processes: return
        # One active job; do not start MLIP while an admitted solver job is executing.
        if any(item.get('status') in {'RUNNING', 'CANCEL_REQUESTED'} for kind in ('CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS') for item in self.services.list_owner_items(owner, kind)): return
        row = next((json_safe(item) for item in self.services.list_owner_items(owner, 'MLIP_JOB') if item['status'] == 'queued' and not item.get('cancelRequested')), None)
        if not row: return
        try:
            release, _ = self.runtime.active()
            request = self.workflow.read_json(row['requestKey'], row['requestObjectSha256'])
            if checksum(request) != row['requestSha256'] or request['runtimeBinding'] != self.runtime.approval_binding(): raise ValueError('Approved MLIP runtime changed.')
            directory = self.services.data_dir / 'work/mlip' / row['id']; directory.mkdir(parents=True, exist_ok=False)
            request_path = directory / 'request.json'; request_path.write_text(json.dumps(request))
            command = self.runtime.sandbox.command(directory, [str(release / 'env/bin/python'), '-I', str(SOURCES / 'runner.py'), str(request_path), str(release / 'model.model'), str(directory / 'result.json')])
            # Durable running intent precedes process creation. Restart never replays an uncertain intent.
            row = self.update(row, status='running', deadlineEpoch=time.time() + request['protocol']['wallSeconds'])
            with (directory / 'runtime.log').open('w') as log:
                self.processes[row['id']] = subprocess.Popen(command, cwd=directory, env=self.runtime.environment(directory), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        except Exception:
            self.update(row, status='failed', reason='The qualified runtime or immutable input could not be verified; no retry was submitted.')
