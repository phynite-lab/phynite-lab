from __future__ import annotations

import errno
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from backend.local_api.domain.phynite_core import ApiError, owner_partition, storage_owner
from backend.local_api.desktop_server import DesktopApplication
from backend.local_api.services import LocalServices
from backend.local_api.archives import ProjectArchives, restore_snapshot
from backend.local_api.snapshots import build_project_snapshot
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.project_workflow import ProjectWorkflowApi


class LocalDesktopTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        # Any accidental cloud SDK initialization is a test failure.
        self.cloud = patch('boto3.client', side_effect=AssertionError('Offline workspace initialized a cloud client'))
        self.cloud.start(); self.addCleanup(self.cloud.stop)
        self.app = DesktopApplication(self.root, 49120, 'http://127.0.0.1:3000')
        self.addCleanup(lambda: self.app.close())

    def call(self, method, path, body=None):
        result = self.app.dispatch(method, path, json.dumps(body).encode() if body is not None else b'', {'Authorization': 'Bearer ' + self.app.token}, {})
        self.assertLess(result['statusCode'], 300, result)
        return json.loads(result['body'])

    def project(self):
        return self.call('POST', '/v1/projects', {'name': 'Local silicon'})['project']['id']

    def test_real_project_structure_workflow_and_workspace_survive_restart(self):
        session = self.call('GET', '/__local/session')
        self.assertFalse(session['authenticated']); self.assertFalse(session['cloud']['authenticated'])
        owner = session['user']['id']
        project = self.project()
        upload = self.call('POST', f'/v1/projects/{project}/structures/upload-url', {'filename': 'silicon.json', 'contentType': 'application/json'})
        structure = upload['structure']['id']
        record = self.app.services.get_item(owner, 'STRUCTURE', structure)
        raw = b'{"atoms":[{"species":"Si","x":0,"y":0,"z":0}],"lattice":{"a":5.43,"b":5.43,"c":5.43,"alpha":90,"beta":90,"gamma":90}}'
        self.app.services.s3.put_object(Bucket=self.app.services.bucket, Key=record['objectKey'], Body=raw, ContentType='application/json')
        self.call('PATCH', f'/v1/structures/{structure}', {'status': 'READY', 'atomCount': 1})
        graph = {'version': 1, 'projectId': project, 'nodes': [{'id': 'structure-node', 'kind': 'structure', 'name': 'Silicon', 'position': {'x': 0, 'y': 0}, 'configuration': {}, 'resources': [{'kind': 'structure', 'id': structure}]}], 'edges': [], 'groups': []}
        self.call('PUT', f'/v1/projects/{project}/workflow', {'baseRevision': 0, 'workflow': graph})
        self.call('PUT', '/v1/workspace', {'baseRevision': 0, 'workspace': {'version': 1, 'projects': [{'id': project}], 'materials': [], 'jobs': []}})
        self.app.close()
        self.app = DesktopApplication(self.root, 49121, 'http://127.0.0.1:3001')
        self.assertEqual(self.call('GET', '/__local/session')['user']['id'], owner)
        self.assertEqual(self.call('GET', f'/v1/projects/{project}/workflow')['workflow'], graph)
        self.assertEqual(self.call('GET', '/v1/workspace')['revision'], 1)
        key = self.app.services.get_item(owner, 'STRUCTURE', structure)['objectKey']
        with self.app.services.s3.get_object(Bucket=self.app.services.bucket, Key=key)['Body'] as body:
            self.assertEqual(body.read(), raw)
        with self.assertRaises(ApiError) as conflict:
            self.call('PUT', f'/v1/projects/{project}/workflow', {'baseRevision': 0, 'workflow': graph})
        self.assertEqual(conflict.exception.code, 'WORKFLOW_CONFLICT')

    def test_run_admission_immediately_uses_validated_worker_presence(self):
        project = self.project()
        structure = self.call('POST', f'/v1/projects/{project}/structures/upload-url', {'filename': 'silicon.in', 'contentType': 'text/plain'})['structure']['id']
        self.app.services.update_item(self.app.services.owner, 'PERSONAL_WORKER', 'primary', {'capabilities': ['qe'], 'lastSeenAtEpoch': int(time.time())})
        self.assertFalse(self.app.services.compute_enabled)  # No monitor tick occurred.
        qe_input = "&CONTROL\n calculation='scf'\n/\n&SYSTEM\n ibrav=1,celldm(1)=10.2,nat=1,ntyp=1,ecutwfc=12\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nSi 28.085 Si.UPF\nATOMIC_POSITIONS crystal\nSi 0 0 0\nK_POINTS gamma\n"
        queued = self.call('POST', f'/v1/projects/{project}/calculations', {'structureId': structure, 'calculationType': 'Total energy', 'qeInput': qe_input, 'inputFiles': {'scf.in': qe_input}, 'settings': {}, 'computeTarget': 'personal', 'vcpus': 1, 'memoryMiB': 2048})
        self.assertEqual(queued['calculation']['status'], 'QUEUED')
        # A stale capability must also disappear immediately, without a tick.
        self.app.services.update_item(self.app.services.owner, 'PERSONAL_WORKER', 'primary', {'lastSeenAtEpoch': int(time.time()) - 100})
        self.call('GET', '/__local/session')
        # Session reads return before domain dispatch, so use a real domain read.
        self.call('GET', '/v1/projects')
        self.assertFalse(self.app.services.compute_enabled)

    def test_expired_and_restarted_jobs_never_replay(self):
        services = self.app.services
        for identifier, status, lease in [('expired', 'RUNNING', 1), ('active', 'RUNNING', int(time.time()) + 90), ('cancel', 'CANCEL_REQUESTED', int(time.time()) + 90), ('queued', 'QUEUED', 0)]:
            services.put_item({'PK': owner_partition(services.owner), 'SK': 'CALCULATION#' + identifier, 'id': identifier, 'ownerId': services.owner, 'entityType': 'CALCULATION', 'computeBackend': 'LOCAL_MAC', 'status': status, 'leaseExpiresAtEpoch': lease})
        self.assertIsNone(services.claim_local_calculation(services.get_item(services.owner, 'CALCULATION', 'expired'), 'worker', int(time.time()) + 90, int(time.time()), 'now'))
        self.assertEqual(services.get_item(services.owner, 'CALCULATION', 'expired')['status'], 'FAILED')
        self.app.close()
        self.app = DesktopApplication(self.root, 49121, 'http://127.0.0.1:3001')
        self.assertEqual(self.app.services.get_item(services.owner, 'CALCULATION', 'active')['status'], 'FAILED')
        self.assertEqual(self.app.services.get_item(services.owner, 'CALCULATION', 'cancel')['status'], 'CANCELLED')
        self.assertEqual(self.app.services.get_item(services.owner, 'CALCULATION', 'queued')['status'], 'QUEUED')

    def test_canvas_dft_dispatch_queues_real_local_calculation_and_rejects_cloud(self):
        project = self.project()
        structure = self.call('POST', f'/v1/projects/{project}/structures/upload-url', {'filename': 'silicon.in', 'contentType': 'text/plain'})['structure']['id']
        self.app.services.compute_enabled = True
        control = PhyniteApi(self.app.services)
        workflow = ProjectWorkflowApi(control)
        qe_input = "&CONTROL\n calculation='scf'\n/\n&SYSTEM\n ibrav=1,celldm(1)=10.2,nat=1,ntyp=1,ecutwfc=12\n/\n&ELECTRONS\n/\nATOMIC_SPECIES\nSi 28.085 Si.UPF\nATOMIC_POSITIONS crystal\nSi 0 0 0\nK_POINTS gamma\n"
        payload = {'structureId': structure, 'calculationType': 'Total energy', 'qeInput': qe_input, 'inputFiles': {'scf.in': qe_input}, 'settings': {}, 'computeTarget': 'personal', 'vcpus': 1, 'memoryMiB': 2048}
        node = {'id': 'scf', 'kind': 'scf', 'configuration': {'execution': payload}}
        queued = workflow.submit(self.app.services.owner, project, 'run', node, [], 'attempt')
        self.assertEqual(queued['status'], 'queued')
        calculation = self.app.services.get_item(self.app.services.owner, 'CALCULATION', queued['jobId'])
        self.assertEqual(calculation['status'], 'QUEUED')
        self.assertEqual(calculation['computeBackend'], 'LOCAL_MAC')
        stored = self.app.services.s3.get_object(Bucket=self.app.services.bucket, Key=calculation['inputKey'])['Body'].read()
        self.assertEqual(json.loads(stored)['qeInput'], qe_input)
        payload['computeTarget'] = 'shared'
        with self.assertRaises(ApiError) as error:
            workflow.submit(self.app.services.owner, project, 'run', node, [], 'cloud-attempt')
        self.assertEqual(error.exception.code, 'INVALID_COMPUTE_TARGET')

    def test_canvas_compiled_dft_passes_worker_protocol_and_exact_bound_inputs(self):
        workflow = ProjectWorkflowApi(PhyniteApi(self.app.services))
        node = {'id': 'scf', 'kind': 'scf', 'configuration': {'compilerVersion': 1}}
        snapshot = {'workflow': {'version': 1}, 'compiler': {'sha256': 'reviewed'}}
        owner = self.app.services.owner
        workflow.put_new(owner, 'PROJECT_RUN', 'run', {'objectKey': 'snapshot', 'sha256': 'test'})
        bound = {'structureId': 'actual-geometry', 'computeTarget': 'personal', 'inputFiles': {'scf.in': 'exact bound input'}}
        with patch.object(workflow, 'read_json', return_value=snapshot), patch('backend.local_api.domain.workflow_structure.source_structure', return_value={'atoms': [{'species': 'Si'}]}), patch('backend.local_api.domain.workflow_compiler.invoke', return_value=bound), patch.object(workflow.api, 'create_calculation', return_value={'body': '{"calculation":{"id":"bound-job"}}'}) as create:
            result = workflow.submit(owner, 'p', 'run', node, [{'result': {'resources': [{'kind': 'structure', 'id': 'actual-geometry'}]}}], 'bound-attempt')
        self.assertEqual(result['jobId'], 'bound-job')
        self.assertEqual(create.call_args.kwargs['workflow_protocol'], 1)
        self.assertEqual(create.call_args.args[2]['inputFiles'], bound['inputFiles'])

    def test_dead_worker_slot_recovers_with_backoff_without_stopping_active_peer(self):
        environment = {'PATH': '/reviewed-runtime/bin'}
        self.app.worker_environment = json.dumps(environment, sort_keys=True)
        dead, live, replacement = Mock(), Mock(), Mock()
        dead.poll.return_value = 1
        live.poll.return_value = replacement.poll.return_value = None
        self.app.workers = [dead, live]
        self.app.worker_slots = {dead: 0, live: 1}
        self.app.worker_started = {dead: 99, live: 99}
        with patch('backend.local_api.desktop_server.time.monotonic', return_value=100), patch('backend.local_api.desktop_server.subprocess.Popen', return_value=replacement) as spawn:
            self.app.maintain_workers(environment, 2, active=True)
            spawn.assert_not_called()
            self.assertEqual(self.app.workers, [live])
        with patch('backend.local_api.desktop_server.time.monotonic', return_value=102), patch('backend.local_api.desktop_server.subprocess.Popen', return_value=replacement) as spawn:
            self.app.maintain_workers(environment, 2, active=True)
            self.assertEqual(spawn.call_count, 1)
            self.assertEqual(self.app.worker_slots[replacement], 0)
        live.terminate.assert_not_called()
        self.app.workers.clear()

    def test_cloud_login_logout_preserve_local_identity_and_projects(self):
        project = self.project()
        owner = self.call('GET', '/__local/session')['user']['id']
        cloud = Mock()
        cloud.account = 'cloud-researcher'
        cloud.status.return_value = {'connected': True, 'accountId': cloud.account, 'user': {'email': 'researcher@example.test'}}
        self.app.connections.cloud = cloud
        self.assertTrue(self.call('POST', '/__local/cloud/login', {'identifier': 'researcher', 'password': 'fixture'})['authenticated'])
        connected = self.call('GET', '/__local/session')
        self.assertEqual(connected['user']['id'], owner)
        self.assertFalse(connected['authenticated'])
        self.assertTrue(connected['cloud']['authenticated'])
        cloud.status.return_value = {'connected': False, 'accountId': None}
        cloud.logout.return_value = {'connected': False}
        self.call('POST', '/__local/cloud/logout', {})
        disconnected = self.call('GET', '/__local/session')
        self.assertEqual(disconnected['user']['id'], owner)
        self.assertFalse(disconnected['cloud']['authenticated'])
        self.assertIsNone(self.app.connections.resume_account)
        self.assertEqual(self.app.connections.store.list('cloud-researcher'), [])
        self.assertTrue(any(item['id'] == project for item in self.call('GET', '/v1/projects')['projects']))

    def test_archive_roundtrip_copy_and_wrong_checksum_leave_existing_data_intact(self):
        project = self.project(); services = self.app.services
        key = f'users/{storage_owner(services.owner)}/projects/{project}/input.json'
        raw = b'{"exactEnergy":-1.234567890123,"units":"Ry"}'
        services.s3.put_object(Bucket=services.bucket, Key=key, Body=raw, ContentType='application/json')
        services.put_item({'PK': owner_partition(services.owner), 'SK': 'STRUCTURE#s', 'id': 's', 'entityType': 'STRUCTURE', 'ownerId': services.owner, 'projectId': project, 'objectKey': key, 'sha256': hashlib.sha256(raw).hexdigest(), 'status': 'READY'})
        snapshot, sources = build_project_snapshot(services, services.owner, project, self.root / 'snapshot')
        self.assertEqual(len(snapshot['artifacts']), 1)
        other = LocalServices(self.root / 'other-device', 'http://127.0.0.1:49122', 'http://127.0.0.1:3002')
        restored = restore_snapshot(other, snapshot, sources)
        self.assertEqual(restored['projectId'], project)
        imported = other.get_item(other.owner, 'STRUCTURE', 's')
        self.assertIn(storage_owner(other.owner), imported['objectKey'])
        with other.s3.get_object(Bucket=other.bucket, Key=imported['objectKey'])['Body'] as body:
            self.assertEqual(body.read(), raw)
        exported = self.app.archives.export(project)
        archive = self.app.archives.export_path(exported['exportId']).read_bytes()
        transfer = self.app.archives.begin({'sizeBytes': len(archive), 'asCopy': True})
        self.app.archives.upload(transfer['importId'], 0, archive)
        copied = self.app.archives.complete(transfer['importId'])
        self.assertNotEqual(copied['projectId'], project)
        next(iter(sources.values())).write_bytes(b'corrupted')
        with self.assertRaises(ApiError):
            restore_snapshot(other, snapshot, sources)
        self.assertIsNotNone(other.get_item(other.owner, 'PROJECT', project))

    def test_disk_full_does_not_replace_existing_artifact(self):
        objects = self.app.services.s3
        objects.put_object(Bucket=objects.bucket, Key='existing', Body=b'original')
        with patch('backend.local_api.filesystem_store.os.replace', side_effect=OSError(errno.ENOSPC, 'Disk full')):
            with self.assertRaises(OSError):
                objects.put_object(Bucket=objects.bucket, Key='existing', Body=b'new')
        with objects.get_object(Bucket=objects.bucket, Key='existing')['Body'] as body:
            self.assertEqual(body.read(), b'original')

    def test_project_delete_stages_sync_tombstone_even_while_signed_out(self):
        project = self.project()
        self.app.connections.store.enable('prior-cloud-account', project)
        self.call('DELETE', f'/v1/projects/{project}')
        self.assertIsNone(self.app.services.get_item(self.app.services.owner, 'PROJECT', project))
        pending = self.app.connections.store.pending('prior-cloud-account', project)
        self.assertTrue(pending['snapshot']['deleted'])
        self.assertIsNone(self.app.connections.cloud)

    def test_failed_project_delete_restores_sync_outbox(self):
        project = self.project()
        store = self.app.connections.store
        store.enable('prior-cloud-account', project)
        snapshot, sources = self.app.connections.build(project)
        store.enqueue('prior-cloud-account', project, snapshot, sources)
        before = store.pending('prior-cloud-account', project)
        with patch.object(self.app.services, 'delete_s3_prefix', side_effect=OSError(errno.ENOSPC, 'Disk full')):
            with self.assertRaises(OSError):
                self.call('DELETE', f'/v1/projects/{project}')
        self.assertIsNotNone(self.app.services.get_item(self.app.services.owner, 'PROJECT', project))
        self.assertEqual(store.pending('prior-cloud-account', project), before)


if __name__ == '__main__':
    unittest.main()
