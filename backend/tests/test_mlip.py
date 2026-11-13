"""Control-plane tests use labelled synthetic output, never claim actual MACE qualification."""
from __future__ import annotations
import copy
import json
import subprocess
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch, Mock

from backend.mlip.contract import MODEL, checksum, geometry, protocol, validate_result
from backend.mlip.runner import calculate
from backend.local_api.mlip_runtime import MlipRuntime, MIN_FREE
from backend.local_api.domain.ai_mlip import MlipJobs
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.services import LocalServices

G = {'symbols': ['Si'], 'scaledPositions': [[0., 0., 0.]], 'cellAngstrom': [[5., 0., 0.], [0., 5., 0.], [0., 0., 5.]], 'periodic': [True, True, True]}
P = {'mode': 'single_point', 'fmaxEvAngstrom': .02, 'maxSteps': 10, 'wallSeconds': 60}


def synthetic(request, energy=-1.):
    return {'schemaVersion': 1, 'model': MODEL, 'requestSha256': checksum(request), 'protocolSha256': checksum(request['protocol']), 'energyEv': energy, 'energyPerAtomEv': energy, 'forcesEvAngstrom': [[0., 0., 0.]], 'finalGeometry': request['geometry'], 'steps': 0, 'converged': True, 'elapsedSeconds': .01}


class FakeRuntime:
    def status(self): return {'ready': True}
    def approval_binding(self): return {'binding': 'synthetic control-plane test only', 'qualificationSha256': 'a'*64}


class MlipTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.services = LocalServices(Path(tmp.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.services.mlip_runtime = FakeRuntime()
        self.api = PhyniteApi(self.services); self.ai = AiWorkspace(self.api); self.jobs = MlipJobs(self.api); self.owner = self.services.owner
        self.project = body(self.api.create_project(self.owner, {'name': 'Synthetic MLIP controls'}))['project']['id']
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_mlip', {'projectKey': 'project:' + self.project, 'mode': 'approval', 'activeRunId': 'air_mlip'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_mlip', {'status': 'running', 'conversationId': 'aic_mlip', 'taskMode': 'work', 'modelId': 'fixture', 'expiresAt': int(time.time())+900})
        self.structure = body(self.api.create_structure(self.owner, self.project, {'name': 'Synthetic Si', 'lattice': {'vectors': G['cellAngstrom']}, 'periodic': G['periodic'], 'atoms': [{'species': 'Si', 'x': 0., 'y': 0., 'z': 0.}]}))['structure']
        self.data = {'structureId': self.structure['id'], 'protocol': P}

    def queued(self):
        data = self.jobs.prepare(self.owner, self.conversation, self.data)
        action = {'id': 'aia_fixture'}
        result = self.jobs.create(self.owner, self.conversation, action, data)
        return self.ai.row(self.owner, 'MLIP_JOB', result['mlipId']), data

    def completed(self, energy=-1., index=0):
        data = self.jobs.prepare(self.owner, self.conversation, self.data)
        result = self.jobs.create(self.owner, self.conversation, {'id': 'aia_fixture'+str(index)}, data)
        row = self.ai.row(self.owner, 'MLIP_JOB', result['mlipId'])
        key, sha = self.jobs.workflow.write_json(self.owner, self.project, 'mlip', synthetic(data, energy))
        self.jobs.update(row, status='completed', resultKey=key, resultSha256=sha)
        return result['mlipId']

    def test_closed_protocol_and_geometry_reject_physical_mutations_nonfinite_and_unknown_periodicity(self):
        self.assertEqual(protocol(P), P); self.assertEqual(geometry(G), G)
        for changed in ({**P, 'mode': 'relax_variable_cell'}, {**P, 'maxSteps': 501}, {**P, 'wallSeconds': True}, {**P, 'fmaxEvAngstrom': float('nan')}, {**P, 'device': 'mps'}):
            with self.assertRaises(ValueError): protocol(changed)
        for changed in ({**G, 'periodic': None}, {**G, 'cellAngstrom': [[0,0,0]]*3}, {**G, 'scaledPositions': [[float('inf'),0,0]]}):
            with self.assertRaises(ValueError): geometry(changed)

    def test_model_checksum_rejected_before_loading_scientific_packages(self):
        model = self.services.data_dir / 'wrong.model'; model.write_bytes(b'synthetic wrong checksum')
        with self.assertRaisesRegex(ValueError, 'checksum'): calculate({'geometry': G, 'protocol': P}, model)

    def test_real_install_preflight_fails_before_any_network_when_disk_insufficient(self):
        runtime = MlipRuntime(self.services.data_dir, None)
        with patch('backend.local_api.mlip_runtime.shutil.disk_usage') as disk, patch('backend.local_api.mlip_runtime.subprocess.run') as run:
            disk.return_value.free = MIN_FREE - 1
            with patch.object(runtime, 'binding', return_value={}), self.assertRaisesRegex(RuntimeError, '4 GiB'): runtime.install()
            run.assert_not_called()
        self.assertFalse(runtime.status()['ready'])
        self.assertEqual(runtime.progress['state'], 'failed')

    def test_download_retry_exhaustion_preserves_active_runtime_without_installing(self):
        base = Mock()
        base.environment.return_value = {'PHYNITE_RUNTIME_PYTHON_DFT': '/usr/bin/python3'}
        runtime = MlipRuntime(self.services.data_dir, base)
        active = runtime.root / 'active.json'
        previous = b'{"retained": "previously active installation"}'
        active.write_bytes(previous)
        with patch.object(runtime, 'binding', return_value={'platform': 'darwin-arm64'}), \
             patch.object(runtime, 'run') as confined, \
             patch('backend.local_api.mlip_runtime.time.sleep'), \
             patch('backend.local_api.mlip_runtime.shutil.disk_usage') as disk, \
             patch('backend.local_api.mlip_runtime.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'download')) as download, \
             patch('backend.local_api.mlip_runtime.urllib.request.urlopen') as model:
            disk.return_value.free = MIN_FREE + 1
            with self.assertRaises(subprocess.CalledProcessError): runtime.install()
        self.assertEqual(download.call_count, 3)
        self.assertTrue(all('--require-hashes' in call.args[0] for call in download.call_args_list))
        self.assertFalse(any('install' in call.args[1] for call in confined.call_args_list))
        model.assert_not_called()
        self.assertEqual(active.read_bytes(), previous)
        self.assertEqual(runtime.progress['state'], 'failed')

    def test_scoped_immutable_submission_idempotency_and_cancel_revision(self):
        row, data = self.queued()
        self.assertEqual(self.jobs.create(self.owner, self.conversation, {'id': 'aia_fixture'}, data)['mlipId'], row['id'])
        self.assertEqual(len(self.services.list_owner_items(self.owner, 'MLIP_JOB')), 1)
        self.assertIn(row['id'], [item['id'] for item in self.services.list_project_items(self.project)])
        with self.assertRaises(ApiError): self.jobs.read('another-owner', self.conversation, row['id'])
        other = body(self.api.create_project(self.owner, {'name': 'Other project'}))['project']['id']
        with self.assertRaises(ApiError): self.jobs.read(self.owner, {**self.conversation, 'projectKey': 'project:'+other}, row['id'])
        with self.assertRaises(ApiError): self.jobs.cancel(self.owner, self.conversation, row['id'], row['revision']+1)
        self.jobs.cancel(self.owner, self.conversation, row['id'], row['revision']); self.jobs.tick()
        self.assertEqual(self.ai.row(self.owner, 'MLIP_JOB', row['id'])['status'], 'cancelled')
        with self.assertRaises(ApiError): self.jobs.create(self.owner, self.conversation, {'id': 'aia_fixture'}, {**data, 'model': 'changed'})

    def test_restart_with_durable_running_intent_never_replays(self):
        row, _ = self.queued(); self.jobs.update(row, status='running')
        self.jobs.tick()
        self.assertEqual(self.ai.row(self.owner, 'MLIP_JOB', row['id'])['status'], 'manual resume required')
        self.assertFalse(self.jobs.processes)

    def test_result_binding_units_composition_fixed_cell_forces_and_convergence(self):
        request = {'geometry': G, 'protocol': P}; original = synthetic(request)
        self.assertEqual(validate_result(original, request), original)
        for key, value in [('energyEv', float('nan')), ('energyPerAtomEv', 5.), ('forcesEvAngstrom', []), ('requestSha256', 'b'*64), ('model', {**MODEL, 'device': 'cuda'}), ('converged', False), ('finalGeometry', {**G, 'cellAngstrom': [[6.,0,0],[0,5.,0],[0,0,5.]]})]:
            with self.subTest(key=key), self.assertRaises(ValueError): validate_result({**original, key: value}, request)

    def test_screening_same_composition_model_protocol_and_max_three_proposals(self):
        ids = [self.completed(-5+index*.05, index) for index in range(4)]
        result = self.jobs.promotions(self.owner, self.conversation, {'ids': ids, 'energyWindowEvPerAtom': .2})
        self.assertEqual(len(result['candidates']), 3); self.assertTrue(result['requiresNewDftApproval'])
        self.assertFalse(self.services.list_owner_items(self.owner, 'CALCULATION'))
        row = self.ai.row(self.owner, 'MLIP_JOB', ids[-1]); request = self.jobs.workflow.read_json(row['requestKey'], row['requestObjectSha256'])
        request['protocol'] = {**P, 'fmaxEvAngstrom': .01}
        key, sha = self.jobs.workflow.write_json(self.owner, self.project, 'mlip', request)
        rkey, rsha = self.jobs.workflow.write_json(self.owner, self.project, 'mlip', synthetic(request))
        self.jobs.update(row, requestKey=key, requestObjectSha256=sha, resultKey=rkey, resultSha256=rsha)
        with self.assertRaises(ApiError): self.jobs.promotions(self.owner, self.conversation, {'ids': ids, 'energyWindowEvPerAtom': .2})

    def test_unqualified_runtime_source_tampering_and_deletion_guards(self):
        self.services.mlip_runtime = None
        with self.assertRaises(ApiError): MlipJobs(self.api).prepare(self.owner, self.conversation, self.data)
        self.services.mlip_runtime = FakeRuntime()
        row, _ = self.queued()
        with self.assertRaises(ApiError): self.api.delete_project(self.owner, self.project)
        with self.assertRaises(ApiError): self.api.delete_structure(self.owner, self.structure['id'])
        item = self.ai.row(self.owner, 'STRUCTURE', self.structure['id'])
        self.services.s3.put_object(Bucket=self.services.bucket, Key=item['objectKey'], Body=b'changed source')
        with self.assertRaises(ApiError): self.jobs.prepare(self.owner, self.conversation, self.data)

    def test_action_boundary_freezes_source_and_requires_runtime_binding(self):
        action = self.ai.prepare(self.owner, self.conversation, self.run, {'kind': 'run_mlip', 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'payload': self.data})
        result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'succeeded', result)
        self.assertEqual(result['result']['status'], 'queued')
        self.assertEqual(len(self.services.list_owner_items(self.owner, 'MLIP_JOB')), 1)
        self.assertEqual(self.ai.row(self.owner, 'STRUCTURE', self.structure['id'])['sha256'], self.structure['sha256'])

    def test_single_point_does_not_claim_force_convergence_when_forces_above_tolerance(self):
        request = {'geometry': G, 'protocol': P}; value = synthetic(request)
        value.update(forcesEvAngstrom=[[.1, 0., 0.]], converged=False)
        self.assertFalse(validate_result(value, request)['converged'])
        value['converged'] = True
        with self.assertRaises(ValueError): validate_result(value, request)

    def test_durable_process_intent_completed_result_and_cancellation(self):
        for cancelled in (False, True):
            self.jobs.processes.clear()
            request = self.jobs.prepare(self.owner, self.conversation, self.data)
            result = self.jobs.create(self.owner, self.conversation, {'id': 'aia_process'+str(cancelled)}, request)
            identifier = result['mlipId']
            self.jobs.runtime.active = lambda: (self.services.data_dir / 'synthetic-runtime', {})
            self.jobs.runtime.sandbox = Mock(command=lambda directory, command: command)
            self.jobs.runtime.environment = lambda directory: {}
            process = Mock(); process.poll.return_value = None
            with patch('backend.local_api.domain.ai_mlip.subprocess.Popen', return_value=process): self.jobs.tick()
            row = self.ai.row(self.owner, 'MLIP_JOB', identifier)
            self.assertEqual(row['status'], 'running')
            if cancelled:
                self.jobs.cancel(self.owner, self.conversation, identifier, row['revision'])
                process.terminate.side_effect = lambda: setattr(process.poll, 'return_value', -15)
            else:
                directory = self.services.data_dir / 'work/mlip' / identifier
                (directory / 'result.json').write_text(json.dumps(synthetic(request)))
                process.poll.return_value = 0; process.returncode = 0
            self.jobs.tick()
            value = self.jobs.read(self.owner, self.conversation, identifier)
            self.assertEqual(value['status'], 'cancelled' if cancelled else 'completed')
            if cancelled: self.assertNotIn('result', value)
            else: self.assertEqual(value['result']['energyEv'], -1.)
