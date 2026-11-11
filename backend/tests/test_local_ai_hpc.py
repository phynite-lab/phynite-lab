"""AI HPC uses the reviewed local queue, not model-directed SSH commands."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.local_api.domain.ai_workspace import AiWorkspace, clean, digest
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.project_workflow import DEFAULT_QE_DRAFT, ProjectWorkflowApi
from backend.local_api.hpc_profiles import HpcProfileStore, resolve_hpc_compute
from backend.local_api.services import LocalServices
from backend.tests.test_hpc_local_api import profile
from backend.tests.test_local_ai_structure_import import imported_node


class LocalAiHpcTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.services.compute_enabled = True
        self.owner = self.services.owner
        self.api = PhyniteApi(self.services)
        self.ai = AiWorkspace(self.api)
        self.workflow = ProjectWorkflowApi(self.api)
        self.project = json.loads(self.api.create_project(self.owner, {'name': 'AI HPC fixture'})['body'])['project']['id']
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_hpc', {'projectKey': 'project:' + self.project, 'mode': 'approval', 'activeRunId': 'air_hpc', 'title': 'Run QE'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_hpc', {'conversationId': 'aic_hpc', 'status': 'running', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('lease'), 'taskMode': 'work', 'modelId': 'fixture'})
        # No personal QE binary: remote HPC must not require a local solver.
        self.services.update_item(self.owner, 'PERSONAL_WORKER', 'primary', {'lastSeenAtEpoch': 0, 'capabilities': []})
        self.store = HpcProfileStore(self.services)
        self.cluster = self.store.save(profile(), 'cluster-one')
        self.selection = {'clusterId': self.cluster['id'], 'profileSha256': self.cluster['profileSha256'], 'nodes': 2, 'ranksPerNode': 4, 'wallSeconds': 600, 'memoryMiBPerNode': 2048}
        structure = imported_node()
        saved = json.loads(self.api.create_structure(self.owner, self.project, structure['configuration']['structure'])['body'])['structure']
        structure['resources'] = [{'kind': 'structure', 'id': saved['id'], 'sha256': saved['sha256']}]
        self.graph = {'version': 1, 'projectId': self.project, 'nodes': [structure, {'id': 'scf', 'kind': 'scf', 'name': 'SCF', 'position': {'x': 300, 'y': 80}, 'resources': [], 'configuration': {'compilerVersion': 1, 'draft': {**DEFAULT_QE_DRAFT, 'cutoffPolicy': 'manual', 'cutoff': 80, 'chargeDensityCutoff': 640}, 'computeTarget': 'hpc', 'hpc': self.selection}}], 'edges': [{'id': 'edge1', 'source': structure['id'], 'target': 'scf', 'port': 'structure'}], 'groups': []}
        self.workflow.save(self.owner, self.project, {'workflow': self.graph, 'baseRevision': 0})
        # Protocol tests retain real compiler/admission/queue but do not install
        # restricted UPFs or claim scientific execution. Native gates test those.
        pseudo = patch('backend.local_api.pseudopotentials.execution_pseudopotential_error', return_value=None)
        pseudo.start()
        self.addCleanup(pseudo.stop)

    def prepare_run(self):
        return self.ai.prepare(self.owner, self.conversation, self.run, {'kind': 'run_workflow', 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'payload': {'revision': 1, 'targets': ['scf']}, 'toolCallId': 'run_hpc'})

    def test_inventory_is_owner_scoped_and_exposes_no_ssh_connection_or_paths(self):
        raw = profile(); raw['connection'] = {'host': 'private-host.example', 'username': 'private-user', 'authKind': 'key', 'privateKeyPath': '/private/key'}
        raw['storage']['scratchRoot'] = '/private/scratch'
        self.store.save(raw, 'private-cluster')
        inventory = self.ai.compute_context(self.owner)
        encoded = json.dumps(inventory)
        for private in ('private-host', 'private-user', '/private/', 'connection', 'environmentModules', 'worker_token', 'tokenHash'):
            self.assertNotIn(private, encoded)
        self.assertEqual(len(inventory['clusters']), 2)
        self.assertEqual(inventory['clusters'][0]['profileSha256'], self.cluster['profileSha256'])
        self.assertEqual(self.ai.compute_context('another-owner')['clusters'], [])
        self.assertNotIn('/private/', json.dumps(clean({'receipt': {'remoteWorkDir': '/private/scratch', 'schedulerJobId': '42'}, 'privateKeyPath': '/private/key'})))
        route = '/v1/ai/conversations/aic_hpc/compute'
        result = self.ai.handle(self.owner, 'POST', route, {'runId': 'air_hpc', 'lease': 'lease'}, {})
        self.assertEqual(json.loads(result['body'])['clusters'], inventory['clusters'])

    def test_review_freezes_allocation_then_queues_once_and_monitor_reads_real_job(self):
        action = self.prepare_run()
        self.assertEqual(action['status'], 'pending')
        self.assertFalse(self.services.list_owner_items(self.owner, 'CALCULATION'))
        compute = action['after']['plan']['nodes'][-1]['compute']
        self.assertEqual(compute['executionAffinity']['profileSha256'], self.cluster['profileSha256'])
        self.assertEqual((compute['vcpus'], compute['memoryMiB']), (8, 4096))
        self.assertEqual(compute['settings']['hpcAllocation']['wallSeconds'], 600)
        result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'succeeded', result)
        jobs = self.services.list_owner_items(self.owner, 'CALCULATION')
        self.assertEqual(len(jobs), 1, result)
        job = jobs[0]
        self.assertEqual(job['computeTarget'], 'personal')
        self.assertEqual(job['executionAffinity'], compute['executionAffinity'])
        self.assertEqual((job['vcpus'], job['memoryMiB']), (8, 4096))
        self.ai.execute(self.owner, self.conversation, result, action['payloadHash'])
        self.assertEqual(len(self.services.list_owner_items(self.owner, 'CALCULATION')), 1)
        self.api.require_local_worker({'headers': {'X-Phynite-Worker-Token': self.services.worker_token}})
        self.assertIsNone(json.loads(self.api.claim_local_job({'workerId': 'personal', 'capabilities': ['qe']})['body'])['job'])
        from backend.local_worker.hpc_remote import HpcRemoteWorker
        client = SimpleNamespace(post=lambda path, payload: json.loads(self.api.claim_local_job(payload)['body']))
        remote = HpcRemoteWorker(client, 'remote', self.cluster['id'], self.cluster['profileSha256'])
        claimed = remote.claim_any()
        self.assertEqual(claimed['calculationId'], job['id'])
        self.assertEqual(claimed['input']['settings']['hpcAllocation'], compute['settings']['hpcAllocation'])
        self.services.update_item(self.owner, 'CALCULATION', job['id'], {'status': 'RUNNING', 'logTail': 'slurm job 42: RUNNING; scientific results pending validation.'})
        evidence = self.ai.resource(self.owner, self.conversation, 'calculation', job['id'])
        self.assertEqual(evidence['details']['calculation']['status'], 'RUNNING')
        self.assertIn('job 42', evidence['item']['logTail'])
        with self.assertRaises(ApiError):
            self.ai.resource(self.owner, self.conversation, 'calculation', 'another-project-job')

    def assert_changed_profile_blocks(self, delete=False):
        action = self.prepare_run()
        if delete:
            self.store.delete('cluster-one')
        else:
            updated = profile('Updated allocation'); updated['defaults']['ranksPerNode'] = 8
            self.store.save(updated, 'cluster-one')
        with self.assertRaises(ApiError):
            self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertFalse(self.services.list_owner_items(self.owner, 'CALCULATION'))
        self.assertFalse(self.services.list_owner_items(self.owner, 'PROJECT_RUN'))

    def test_profile_update_after_review_never_submits(self):
        self.assert_changed_profile_blocks()

    def test_profile_delete_after_review_never_submits(self):
        self.assert_changed_profile_blocks(delete=True)

    def compiled_hpc_submission(self):
        _, graph = self.workflow.plan(self.owner, self.project, {'revision': 1, 'targets': ['scf']})
        execution = copy.deepcopy(graph['nodes'][-1]['configuration']['execution'])
        compute = resolve_hpc_compute(self.services, self.owner, self.selection)
        return {
            **execution,
            **compute,
            'settings': {**execution['settings'], **compute['settings']},
            'run': True,
        }

    def test_hpc_queues_without_native_runtime_or_dispatcher_startup_flag(self):
        self.services.compute_enabled = False
        plan, _ = self.workflow.plan(self.owner, self.project, {'revision': 1, 'targets': ['scf']})
        self.assertFalse(plan['errors'], plan['errors'])

        payload = self.compiled_hpc_submission()
        result = self.api.create_calculation(self.owner, self.project, payload, workflow_protocol=1)
        self.assertEqual(result['statusCode'], 202)
        calculation = json.loads(result['body'])['calculation']
        self.assertEqual(calculation['status'], 'QUEUED')
        self.assertEqual(calculation['executionAffinity'], payload['executionAffinity'])
        self.assertEqual((calculation['vcpus'], calculation['memoryMiB']), (8, 4096))

        # The exact owner/profile worker can claim it after dispatcher startup.
        self.api.require_local_worker({'headers': {'X-Phynite-Worker-Token': self.services.worker_token}})
        claimed = json.loads(self.api.claim_local_job({
            'workerId': 'hpc-no-native-runtime',
            'capabilities': ['qe'],
            'workflowVersion': 1,
            'executionAffinity': payload['executionAffinity'],
        })['body'])['job']
        self.assertEqual(claimed['calculationId'], calculation['id'])
        self.assertEqual(claimed['input']['settings']['hpcAllocation'], payload['settings']['hpcAllocation'])
        worker = self.services.get_item(self.owner, 'PERSONAL_WORKER', 'primary')
        self.assertEqual(worker['capabilities'], [])
        self.assertEqual(int(worker['lastSeenAtEpoch']), 0)

    def test_personal_compute_remains_blocked_without_native_runtime(self):
        payload = self.compiled_hpc_submission()
        payload.pop('executionAffinity')
        payload['settings'].pop('hpcAllocation')
        payload.update({'vcpus': 1, 'memoryMiB': 1024})
        self.services.compute_enabled = False
        with self.assertRaises(ApiError) as denied:
            self.api.create_calculation(self.owner, self.project, payload, workflow_protocol=1)
        self.assertEqual(denied.exception.code, 'COMPUTE_DISABLED')

        personal = copy.deepcopy(self.graph)
        personal['nodes'][-1]['configuration']['computeTarget'] = 'personal'
        personal['nodes'][-1]['configuration'].pop('hpc')
        self.workflow.save(self.owner, self.project, {'workflow': personal, 'baseRevision': 1})
        plan, _ = self.workflow.plan(self.owner, self.project, {'revision': 2, 'targets': ['scf']})
        self.assertTrue(plan['errors'])
        self.assertIn('Your computer is offline', plan['errors'][0]['message'])
        self.assertFalse(self.services.list_owner_items(self.owner, 'CALCULATION'))

    def test_hpc_without_a_saved_profile_or_snapshot_stays_rejected(self):
        payload = self.compiled_hpc_submission()
        self.services.compute_enabled = False
        self.store.delete(self.cluster['id'])
        self.services.table.delete_item(Key={
            'PK': self.store.pk,
            'SK': f"HPC_PROFILE_SNAPSHOT#{self.cluster['id']}#{self.cluster['profileSha256']}",
        })
        plan, _ = self.workflow.plan(self.owner, self.project, {'revision': 1, 'targets': ['scf']})
        self.assertTrue(plan['errors'])
        self.assertIn('selected HPC cluster is unavailable', plan['errors'][0]['message'])
        with self.assertRaises(ApiError) as denied:
            self.api.create_calculation(self.owner, self.project, payload, workflow_protocol=1)
        self.assertEqual(denied.exception.code, 'HPC_PROFILE_SNAPSHOT_NOT_FOUND')
        self.assertFalse(self.services.list_owner_items(self.owner, 'CALCULATION'))

    def test_hpc_forged_affinity_cannot_bypass_native_runtime_gate(self):
        payload = self.compiled_hpc_submission()
        self.services.compute_enabled = False
        for affinity, error_code in (
            ({'scheduler': 'slurm', 'profileSha256': 'f' * 64}, 'HPC_PROFILE_SNAPSHOT_NOT_FOUND'),
            ({'scheduler': 'pbs', 'profileSha256': self.cluster['profileSha256']}, 'HPC_PROFILE_SNAPSHOT_NOT_FOUND'),
            ({'scheduler': 'slurm', 'profileSha256': 'invalid'}, 'INVALID_EXECUTION_AFFINITY'),
        ):
            with self.subTest(affinity=affinity), self.assertRaises(ApiError) as denied:
                self.api.create_calculation(self.owner, self.project, {
                    **copy.deepcopy(payload), 'executionAffinity': affinity,
                }, workflow_protocol=1)
            self.assertEqual(denied.exception.code, error_code)
        self.assertFalse(self.services.list_owner_items(self.owner, 'CALCULATION'))

    def test_run_snapshot_retains_approved_profile_when_cluster_changes_after_start(self):
        action = self.prepare_run()
        with patch.object(self.workflow.__class__, 'advance'):
            result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'succeeded', result)
        run = self.services.list_owner_items(self.owner, 'PROJECT_RUN')[0]
        snapshot = self.workflow.read_json(run['objectKey'], run['sha256'])
        frozen = snapshot['workflow']['nodes'][-1]['configuration']['resolvedHpcCompute']
        self.store.save(profile('Changed later'), 'cluster-one')
        self.assertEqual(frozen['executionAffinity']['profileSha256'], self.cluster['profileSha256'])
        self.assertIsNotNone(self.store.snapshot('cluster-one', self.cluster['profileSha256']))

    def test_legacy_submission_is_frozen_before_approval_and_rejects_forged_affinity(self):
        _, graph = self.workflow.plan(self.owner, self.project, {'revision': 1, 'targets': ['scf']})
        execution = graph['nodes'][-1]['configuration']['execution']
        data = {'materialId': 'm1', 'name': 'SCF', 'draft': copy.deepcopy(DEFAULT_QE_DRAFT), 'compute': {'computeTarget': 'hpc', 'hpc': self.selection},
                'submission': {key: execution[key] for key in ('calculationType', 'qeInput', 'inputFiles', 'settings')}}
        context = {'project': {'id': 'legacy', 'kind': 'dft', 'name': 'Legacy'}, 'stamp': 'legacy-stamp', 'workspaceRevision': 0, 'workspace': {'materials': [], 'configurations': []}, 'resources': {}}
        with patch.object(self.ai, 'context', return_value=context), patch.object(self.ai, 'scope', return_value=context['project']), patch.object(self.ai, 'resource', return_value={'item': {'id': 'm1'}}):
            action = self.ai.prepare(self.owner, self.conversation, self.run, {'kind': 'run_dft', 'stamp': context['stamp'], 'payload': data})
            frozen = self.ai.action_payload(action)['submission']
            self.assertEqual(frozen['qeInput'], execution['qeInput'])
            self.assertEqual(frozen['inputFiles'], execution['inputFiles'])
            self.assertEqual(frozen['executionAffinity']['profileSha256'], self.cluster['profileSha256'])
            self.assertEqual((frozen['vcpus'], frozen['memoryMiB']), (8, 4096))
            self.assertFalse(self.services.list_owner_items(self.owner, 'CALCULATION'))
            forged = copy.deepcopy(data)
            forged['submission']['executionAffinity'] = {'scheduler': 'pbs', 'profileSha256': '0' * 64}
            with self.assertRaises(ApiError):
                self.ai.validate_action(self.owner, self.conversation, 'run_dft', forged)
            self.store.save(profile('Changed before approval'), 'cluster-one')
            with self.assertRaises(ApiError), patch.object(self.ai, 'perform', side_effect=AssertionError('Cannot submit changed allocation')):
                self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])

    def test_scheduler_observations_and_incomplete_harvest_remain_manual_not_scientific_success(self):
        from backend.local_worker.hpc_remote import HpcRemoteWorker
        manager = SimpleNamespace(submit_job=lambda *_, **__: {'scheduler': 'slurm', 'schedulerJobId': '42', 'remoteWorkDir': '/private/scratch'},
                                  poll_job=lambda *_: {'state': 'COMPLETED', 'exitCode': '0', 'terminal': True},
                                  harvest_completed=lambda *_: {'state': 'manual-resume-required', 'reason': 'Manifest checksum failed; checkpoints retained.'})
        job = {'kind': 'qe', 'ownerId': self.owner, 'calculationId': 'calc1', 'vcpus': 8, 'memoryMiB': 4096, 'input': {'calculationType': 'Total energy', 'settings': {'hpcAllocation': resolve_hpc_compute(self.services, self.owner, self.selection)['settings']['hpcAllocation']}}}
        calls = []
        def post(path, payload):
            calls.append((path, payload))
            return {'job': job} if path.endswith('/claim') else {}
        client = SimpleNamespace(get=lambda _: {'profile': self.cluster}, post=post)
        worker = HpcRemoteWorker(client, 'remote', self.cluster['id'], self.cluster['profileSha256'], manager_factory=lambda *_: manager, workspace_builder=lambda *_: {})
        outcome = worker.run_once(None, None, self.services.data_dir / 'protocol')
        self.assertEqual(outcome['state'], 'manual-resume-required')
        self.assertEqual(sum(path.endswith('/claim') for path, _ in calls), 1)
        logs = [payload['logTail'] for path, payload in calls if path.endswith('/heartbeat')]
        self.assertTrue(any('slurm job 42: COMPLETED' in value and 'pending validation' in value for value in logs))
        self.assertNotIn('/private/', json.dumps(logs))

    def test_chat_plan_research_and_remote_md_cannot_prepare_hpc_execution(self):
        payload = {'kind': 'run_workflow', 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'payload': {'revision': 1, 'targets': ['scf']}}
        for task in ('plan', 'research', 'summary'):
            with self.assertRaises(ApiError):
                self.ai.prepare(self.owner, self.conversation, {**self.run, 'taskMode': task}, payload)
        with self.assertRaises(ApiError):
            self.ai.prepare(self.owner, {**self.conversation, 'mode': 'chat'}, self.run, payload)
        for kind in ('md', 'md-analysis', 'extract-frame'):
            with self.assertRaises(ApiError):
                self.ai.local_workflow(self.owner, {'nodes': [{'kind': kind, 'configuration': {'computeTarget': 'hpc', 'hpc': self.selection}}]})
        for kind in ('run_md', 'run_analysis', 'save_md'):
            with self.assertRaises(ApiError):
                self.ai.validate_action(self.owner, self.conversation, kind, {'compute': {'computeTarget': 'hpc', 'hpc': self.selection}})
        for selection in ({**self.selection, 'nodes': 0}, {**self.selection, 'partition': '../bad'}, {**self.selection, 'autoRestartOnWalltime': True}, {**self.selection, 'profileSha256': '0' * 64}):
            with self.assertRaises(ApiError):
                resolve_hpc_compute(self.services, self.owner, selection)
        with self.assertRaises(ApiError):
            resolve_hpc_compute(self.services, 'another-owner', self.selection)
        self.services.local_workspace = False
        with self.assertRaises(ApiError):
            resolve_hpc_compute(self.services, self.owner, self.selection)


if __name__ == '__main__':
    unittest.main()
