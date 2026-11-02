"""Recovery imports retained output; it never changes input or replays compute."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import Mock, patch

from backend.local_api.desktop_server import DesktopApplication
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError, owner_partition
from backend.local_api.result_recovery import recover_result, recovery_status
from backend.local_api.services import INTERRUPTED_REASON, LocalServices
from backend.local_worker import recovery


class LocalResultRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.services = LocalServices(Path(self.temporary.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.owner = self.services.owner
        self.serial = 0

    def put(self, kind, identifier, **fields):
        value = {'PK': owner_partition(self.owner), 'SK': kind + '#' + identifier, 'id': identifier,
                 'entityType': kind, 'ownerId': self.owner, **fields}
        self.services.put_item(value)
        return value

    def fixture(self):
        self.serial += 1
        identifier = 'calc_recovery_' + str(self.serial)
        payload = {'pseudopotentials': {'Si.upf': 'original/Si.upf'}, 'inputFiles': {'scf.in': 'Original scientific input'}}
        input_key = 'inputs/' + identifier
        self.services.s3.put_object(Bucket=self.services.bucket, Key=input_key, Body=json.dumps(payload).encode())
        item = self.put('CALCULATION', identifier, projectId='project', name='Si SCF', jobKind='qe', status='FAILED',
            interrupted=True, failureReason=INTERRUPTED_REASON, statusMessage=INTERRUPTED_REASON,
            computeBackend='LOCAL_MAC', computeTarget='personal', localWorkerId='worker', vcpus=2, memoryMiB=2048,
            calculationType='Total energy', inputKey=input_key, outputPrefix='outputs/' + identifier,
            updatedAt='2026-11-02T00:00:00Z', leaseExpiresAtEpoch=1)
        directory = self.services.data_dir / 'work' / 'worker-0' / identifier
        (directory / 'pseudo').mkdir(parents=True)
        (directory / 'pseudo' / 'Si.upf').write_bytes(b'Fixture potential bytes')
        (directory / 'input.json').write_text(json.dumps(payload))
        api = PhyniteApi(self.services)
        claim = {'calculationId': identifier, 'ownerId': self.owner, 'kind': 'qe', 'vcpus': 2,
                 'memoryMiB': 2048, **api.local_job_input(item)}
        recovery.begin(directory, recovery.claim_identity(claim), {'mode': 'native', 'host': socket.gethostname()})
        recovery.mark(directory, 'running', effectiveResources={'effectiveVcpus': 2, 'effectiveMemoryMiB': 2048})
        results = directory / 'results'
        (results / 'logs').mkdir(parents=True)
        log = b'estimated scf accuracy < 1.0e-9 Ry\nconvergence has been achieved\nJOB DONE.\n'
        (results / 'logs' / 'scf.out').write_bytes(log)
        stage = {'stage': 'scf', 'calculationMode': 'scf', 'jobDone': True, 'solverError': False,
                 'electronicConvergence': 'converged', 'hybridConvergence': 'not-applicable',
                 'scfAccuracy': {'status': 'verified', 'residualRy': 1e-9, 'residualUpperRy': 1.1e-9,
                                 'thresholdRy': 1e-6, 'source': 'qe-log-bound'}}
        manifest = {'version': 2, 'calculationId': identifier, 'calculationType': 'Total energy', 'status': 'completed',
                    'summary': {'converged': True, 'jobDone': True, 'totalEnergyRy': -15.75, 'stageConvergence': [stage]},
                    'artifacts': [{'path': 'logs/scf.out', 'sizeBytes': len(log), 'sha256': hashlib.sha256(log).hexdigest()}]}
        (results / 'result.json').write_text(json.dumps(manifest))
        return item, directory, manifest

    def current(self, item):
        return self.services.get_item(self.owner, item['entityType'], item['id'])

    def assert_rejected(self, item):
        previous = self.current(item)
        with self.assertRaises(ApiError):
            recover_result(self.services, item['id'])
        self.assertEqual(self.current(item), previous)

    def write_manifest(self, directory, manifest):
        (directory / 'results' / 'result.json').write_text(json.dumps(manifest))

    def test_import_preserves_original_science_and_never_launches_or_ticks(self):
        item, directory, manifest = self.fixture()
        original = (directory / 'results' / 'result.json').read_bytes()
        with patch('subprocess.Popen', side_effect=AssertionError('Recovery launched a process')), \
                patch.object(PhyniteApi, 'tick_project_workflows', side_effect=AssertionError('Recovery dispatched work')):
            result = json.loads(recover_result(self.services, item['id'])['body'])['calculation']
        self.assertEqual(result['status'], 'COMPLETED')
        self.assertTrue(result['resultSummary']['converged'])
        self.assertEqual(result['resultRecovery']['method'], 'verified-local-output-import')
        self.assertEqual(result['resultRecovery']['manifestSha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(result['effectiveVcpus'], 2)
        self.assertEqual(result['effectiveMemoryMiB'], 2048)
        self.assertNotIn('interrupted', result)
        self.assertNotIn('failureReason', result)
        self.assertEqual((directory / 'results' / 'result.json').read_bytes(), original)
        with self.services.s3.get_object(Bucket=self.services.bucket, Key=item['outputPrefix'] + '/result.json')['Body'] as body:
            self.assertEqual(body.read(), original)
        self.assertEqual(manifest['summary']['totalEnergyRy'], -15.75)
        self.assertFalse(recovery_status(self.services, item['id'])['available'])

    def test_status_is_cheap_and_does_not_hash_outputs(self):
        item, _, _ = self.fixture()
        with patch.object(recovery, 'digest', side_effect=AssertionError('Status hashed output')):
            self.assertEqual(recovery_status(self.services, item['id']), {'available': True})

    def test_endpoint_requires_local_session_and_does_not_accept_paths_or_bytes(self):
        item, _, _ = self.fixture()
        application = object.__new__(DesktopApplication)
        application.services = self.services
        application.token = 'opaque-session'
        base = '/__local/jobs/' + item['id']
        for path, method in ((base + '/recovery', 'GET'), (base + '/recover', 'POST')):
            with self.subTest(path=path), self.assertRaises(ApiError) as error:
                application.dispatch(method, path, b'{}', {'X-Phynite-Worker-Token': self.services.worker_token}, {})
            self.assertEqual(error.exception.status, 401)
        headers = {'Authorization': 'Bearer opaque-session'}
        available = application.dispatch('GET', base + '/recovery', b'', headers, {})
        self.assertTrue(json.loads(available['body'])['available'])
        with self.assertRaises(ApiError):
            application.dispatch('POST', base + '/recover', b'{"workdir":"/tmp/forged"}', headers, {})
        self.assertEqual(self.current(item)['status'], 'FAILED')

    def test_cancelled_noninterrupted_other_owner_and_changed_reason_cannot_recover(self):
        for changes in ({'status': 'CANCELLED'}, {'interrupted': False}, {'computeBackend': 'CLOUD_EC2'},
                        {'computeTarget': 'shared'}, {'ownerId': 'another-owner'}, {'failureReason': 'Actual solver failure'},
                        {'statusMessage': 'Changed state'}, {'localWorkerId': None}):
            with self.subTest(changes=changes):
                item, _, _ = self.fixture()
                self.services.update_item(self.owner, 'CALCULATION', item['id'], changes)
                self.assertFalse(recovery_status(self.services, item['id'])['available'])
                self.assert_rejected(item)

    def test_original_input_models_and_resources_must_still_match_journal(self):
        for change in ('saved-input', 'prepared-input', 'model', 'resources', 'missing-journal', 'runtime-host'):
            with self.subTest(change=change):
                item, directory, _ = self.fixture()
                if change == 'saved-input':
                    self.services.s3.put_object(Bucket=self.services.bucket, Key=item['inputKey'], Body=b'{"changed":true}')
                elif change == 'prepared-input':
                    (directory / 'input.json').write_bytes(b'Changed prepared input')
                elif change == 'model':
                    (directory / 'pseudo' / 'Si.upf').write_bytes(b'Changed model')
                elif change == 'resources':
                    self.services.update_item(self.owner, 'CALCULATION', item['id'], {'vcpus': 3})
                elif change == 'missing-journal':
                    (directory / recovery.JOURNAL).unlink()
                else:
                    journal = json.loads((directory / recovery.JOURNAL).read_text())
                    journal['runtimeIdentity']['host'] = 'another-computer'
                    (directory / recovery.JOURNAL).write_text(json.dumps(journal))
                self.assert_rejected(item)

    def test_invalid_manifest_artifact_and_numerical_evidence_are_rejected(self):
        for change in ('wrong-id', 'failed', 'checksum', 'size', 'missing-file', 'duplicate', 'traversal',
                       'absolute', 'nonconverged', 'no-job-done', 'no-stage-proof'):
            with self.subTest(change=change):
                item, directory, manifest = self.fixture()
                if change == 'wrong-id':
                    manifest['calculationId'] = 'another-calculation'
                elif change == 'failed':
                    manifest['status'] = 'failed'
                elif change == 'checksum':
                    manifest['artifacts'][0]['sha256'] = 'a' * 64
                elif change == 'size':
                    manifest['artifacts'][0]['sizeBytes'] += 1
                elif change == 'missing-file':
                    (directory / 'results' / 'logs' / 'scf.out').unlink()
                elif change == 'duplicate':
                    manifest['artifacts'] *= 2
                elif change == 'traversal':
                    manifest['artifacts'][0]['path'] = 'logs/../scf.out'
                elif change == 'absolute':
                    manifest['artifacts'][0]['path'] = '/tmp/scf.out'
                elif change == 'nonconverged':
                    manifest['summary']['converged'] = False
                elif change == 'no-job-done':
                    manifest['summary']['stageConvergence'][0]['jobDone'] = False
                else:
                    manifest['summary']['stageConvergence'][0]['scfAccuracy']['residualUpperRy'] = 1
                self.write_manifest(directory, manifest)
                self.assert_rejected(item)

    def test_symbolic_links_in_every_relevant_parent_are_rejected(self):
        for name in ('workspace', 'worker', 'results', 'log-parent', 'log-file', 'input', 'journal', 'model-parent'):
            with self.subTest(name=name):
                item, directory, _ = self.fixture()
                path = {'workspace': directory, 'worker': directory.parent, 'results': directory / 'results',
                        'log-parent': directory / 'results' / 'logs', 'log-file': directory / 'results' / 'logs' / 'scf.out',
                        'input': directory / 'input.json', 'journal': directory / recovery.JOURNAL,
                        'model-parent': directory / 'pseudo'}[name]
                original = path.with_name(path.name + '-saved')
                path.rename(original)
                path.symlink_to(original, target_is_directory=original.is_dir())
                self.assert_rejected(item)
                path.unlink()
                original.rename(path)

    def test_duplicate_worker_workspaces_are_not_guessed(self):
        item, directory, _ = self.fixture()
        duplicate = directory.parent.parent / 'worker-1' / item['id']
        duplicate.mkdir(parents=True)
        self.assert_rejected(item)

    def test_active_native_process_or_orphan_rank_is_rejected_without_killing(self):
        for orphan in (False, True):
            with self.subTest(orphan=orphan):
                item, directory, _ = self.fixture()
                process = Mock(pid=123456)
                process.status.return_value = 'running'
                process.create_time.return_value = 1234.5
                process.cwd.return_value = str(directory)
                if not orphan:
                    recovery.mark(directory, 'running', nativeProcess={'pid': process.pid, 'host': socket.gethostname(), 'createTimeEpoch': 1234.5})
                with patch('backend.local_api.result_recovery.psutil.Process', return_value=process), \
                        patch('backend.local_api.result_recovery.psutil.process_iter', return_value=[process]), \
                        patch('os.killpg', side_effect=AssertionError('Recovery killed a process')):
                    self.assert_rejected(item)

    def test_concurrent_state_change_during_import_is_not_overwritten(self):
        item, _, _ = self.fixture()
        original_put = self.services.s3.put_object
        def concurrent_change(**kwargs):
            result = original_put(**kwargs)
            self.services.update_item(self.owner, 'CALCULATION', item['id'], {'updatedAt': 'concurrent-change', 'status': 'CANCELLED'})
            return result
        with patch.object(self.services.s3, 'put_object', side_effect=concurrent_change), self.assertRaises(ApiError):
            recover_result(self.services, item['id'])
        self.assertEqual(self.current(item)['status'], 'CANCELLED')
        self.assertEqual(self.current(item)['updatedAt'], 'concurrent-change')

    def workflow(self, item, *, descendant=False, cancelled=False):
        node_ids = ['input', 'scf'] + (['downstream'] if descendant else [])
        snapshot = {'plan': {'nodes': [{'nodeId': identifier} for identifier in node_ids]}}
        content = json.dumps(snapshot).encode()
        object_key = 'workflow/' + item['id']
        self.services.s3.put_object(Bucket=self.services.bucket, Key=object_key, Body=content)
        run_id = 'run_' + item['id']
        self.put('PROJECT_RUN', run_id, projectId='project', status='cancelled' if cancelled else 'failed',
                 revision=2, objectKey=object_key, sha256=hashlib.sha256(content).hexdigest(), leaseUntil=0)
        self.put('WORKFLOW_ATTEMPT', run_id + '_input', projectId='project', runId=run_id, nodeId='input', status='completed')
        self.put('WORKFLOW_ATTEMPT', run_id + '_scf', projectId='project', runId=run_id, nodeId='scf', status='failed',
                 jobId=item['id'], jobKind='CALCULATION', error=INTERRUPTED_REASON)
        if descendant:
            self.put('WORKFLOW_ATTEMPT', run_id + '_downstream', projectId='project', runId=run_id,
                     nodeId='downstream', status='blocked', error='A prerequisite did not complete.')
        return run_id

    def test_recovery_updates_only_matching_interruption_attempts_and_completed_run(self):
        item, _, _ = self.fixture()
        run_id = self.workflow(item)
        with patch.object(PhyniteApi, 'tick_project_workflows', side_effect=AssertionError('Recovery replayed workflow')):
            recover_result(self.services, item['id'])
        attempt = self.services.get_item(self.owner, 'WORKFLOW_ATTEMPT', run_id + '_scf')
        self.assertEqual(attempt['status'], 'completed')
        self.assertNotIn('error', attempt)
        self.assertEqual(attempt['result'], {'jobId': item['id'], 'jobKind': 'CALCULATION'})
        self.assertEqual(self.services.get_item(self.owner, 'PROJECT_RUN', run_id)['status'], 'completed')

    def test_blocked_descendants_and_cancelled_runs_are_not_reopened(self):
        for cancelled in (False, True):
            with self.subTest(cancelled=cancelled):
                item, _, _ = self.fixture()
                run_id = self.workflow(item, descendant=True, cancelled=cancelled)
                recover_result(self.services, item['id'])
                self.assertEqual(self.services.get_item(self.owner, 'PROJECT_RUN', run_id)['status'], 'cancelled' if cancelled else 'failed')
                self.assertEqual(self.services.get_item(self.owner, 'WORKFLOW_ATTEMPT', run_id + '_downstream')['status'], 'blocked')
                self.assertEqual(self.services.get_item(self.owner, 'WORKFLOW_ATTEMPT', run_id + '_scf')['status'], 'failed' if cancelled else 'completed')


if __name__ == '__main__':
    unittest.main()
