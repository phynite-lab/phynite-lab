"""Local-only HPC profile persistence and owner/checksum fences."""
from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from backend.local_api.hpc_profiles import HpcProfileStore, _profile_digest


class Table:
    def __init__(self): self.rows = {}
    def get_item(self, *, Key, **_):
        item = self.rows.get((Key['PK'], Key['SK']))
        return {'Item': copy.deepcopy(item)} if item else {}
    def put_item(self, *, Item, **_): self.rows[(Item['PK'], Item['SK'])] = copy.deepcopy(Item)
    def delete_item(self, *, Key, **_): self.rows.pop((Key['PK'], Key['SK']), None)
    def query(self, *, ExpressionAttributeValues, **_):
        pk, prefix = ExpressionAttributeValues[':pk'], ExpressionAttributeValues[':prefix']
        return {'Items': [copy.deepcopy(item) for (row_pk, sk), item in self.rows.items() if row_pk == pk and sk.startswith(prefix)]}


class Services:
    def __init__(self, owner='local-a'):
        self.owner = owner; self.worker_token = 'worker-secret'; self.table = Table(); self.jobs = []
    def list_owner_items(self, owner, kind): return [copy.deepcopy(job) for job in self.jobs if job.get('ownerId') == owner and job.get('entityType') == kind]


def profile(name='Cluster'):
    return {'name': name, 'scheduler': 'slurm', 'connection': {'host': 'login.example', 'username': 'researcher', 'authKind': 'agent'}, 'storage': {'scratchRoot': '/scratch/researcher', 'purgeWavefunctions': True}, 'runtime': {'environmentModules': ['qe/7.2'], 'mpiLauncher': ['srun', '--ntasks={ranks}']}, 'defaults': {'nodes': 1, 'ranksPerNode': 4, 'wallSeconds': 300, 'memoryMiBPerNode': 1024}}


class HpcLocalApiTests(unittest.TestCase):
    def test_owner_scoped_crud_and_server_checksum(self):
        services = Services(); store = HpcProfileStore(services)
        saved = store.save(profile(), 'cl-one')
        self.assertEqual(saved['ownerId'], 'local-a')
        self.assertEqual(saved['profileSha256'], _profile_digest(saved))
        self.assertEqual(store.get('cl-one')['profileSha256'], saved['profileSha256'])
        self.assertEqual(store.snapshot('cl-one', saved['profileSha256'])['id'], 'cl-one')
        other = HpcProfileStore(Services('local-b'))
        other.services.table = services.table
        self.assertIsNone(other.get('cl-one'))

    def test_default_switch_preserves_canonical_snapshot_checksum(self):
        from backend.local_worker.hpc_remote import profile_sha256
        services = Services(); store = HpcProfileStore(services)
        first = store.save({**profile(), 'isDefault': True}, 'cl-one')
        store.save({**profile(), 'isDefault': True}, 'cl-two')
        updated = store.get('cl-one')
        self.assertFalse(updated['isDefault'])
        snapshot = store.worker_snapshot({'X-Phynite-Worker-Token': services.worker_token}, 'cl-one', updated['profileSha256'])
        self.assertEqual(profile_sha256(snapshot), updated['profileSha256'])
        self.assertIsNotNone(store.snapshot('cl-one', first['profileSha256']))

    def test_update_keeps_immutable_snapshot_and_delete_blocks_active_job(self):
        services = Services(); store = HpcProfileStore(services)
        first = store.save(profile(), 'cl-one')
        second = store.save(profile('Updated'), 'cl-one')
        self.assertNotEqual(first['profileSha256'], second['profileSha256'])
        self.assertIsNotNone(store.snapshot('cl-one', first['profileSha256']))
        services.jobs.append({'ownerId': services.owner, 'entityType': 'CALCULATION', 'status': 'RUNNING', 'executionAffinity': {'scheduler': 'slurm', 'profileSha256': first['profileSha256']}})
        with self.assertRaisesRegex(Exception, 'active job'):
            store.delete('cl-one')

    def test_worker_snapshot_requires_exact_token_and_checksum(self):
        services = Services(); store = HpcProfileStore(services); saved = store.save(profile(), 'cl-one')
        value = store.worker_snapshot({'X-Phynite-Worker-Token': services.worker_token}, 'cl-one', saved['profileSha256'])
        self.assertEqual(value['profileSha256'], saved['profileSha256'])
        with self.assertRaises(Exception):
            store.worker_snapshot({'X-Phynite-Worker-Token': 'wrong'}, 'cl-one', saved['profileSha256'])

    def test_unsafe_modules_and_paths_are_rejected(self):
        services = Services(); store = HpcProfileStore(services)
        bad = profile(); bad['runtime']['environmentModules'] = ['qe/7.2; touch /tmp/pwned']
        with self.assertRaises(Exception): store.save(bad, 'cl-one')
        bad = profile(); bad['storage']['scratchRoot'] = '/scratch/../escape'
        with self.assertRaises(Exception): store.save(bad, 'cl-two')


class HpcDesktopProtocolTests(unittest.TestCase):
    def test_sqlite_routes_server_identity_worker_auth_and_owner_partition(self):
        from backend.local_api.desktop_server import DesktopApplication
        from backend.local_api.domain.phynite_core import ApiError, owner_partition
        with tempfile.TemporaryDirectory() as directory:
            app = DesktopApplication(Path(directory), 8792, 'http://127.0.0.1:3000')
            try:
                headers = {'Authorization': 'Bearer ' + app.token}
                payload = {**profile(), 'ownerId': 'forged-owner', 'id': 'forged-id', 'profileSha256': '0' * 64}
                created = app.dispatch('POST', '/__local/hpc/clusters', json.dumps(payload).encode(), headers, {})
                cluster = json.loads(created['body'])['cluster']
                self.assertEqual(cluster['ownerId'], app.services.owner)
                self.assertNotEqual(cluster['id'], 'forged-id')
                self.assertNotEqual(cluster['profileSha256'], '0' * 64)
                row = app.services.table.get_item(Key={'PK': owner_partition(app.services.owner), 'SK': 'HPC_PROFILE#' + cluster['id']})['Item']
                self.assertEqual(row['id'], cluster['id'])
                with self.assertRaises(ApiError):
                    app.dispatch('GET', '/__local/hpc/clusters', b'', {}, {})
                path = f"/__local/hpc/clusters/{cluster['id']}/snapshot/{cluster['profileSha256']}"
                with self.assertRaises(ApiError):
                    app.dispatch('GET', path, b'', {'X-Phynite-Worker-Token': 'wrong'}, {})
                snapshot = json.loads(app.dispatch('GET', path, b'', {'X-Phynite-Worker-Token': app.services.worker_token}, {})['body'])['profile']
                self.assertEqual(snapshot['profileSha256'], cluster['profileSha256'])
                from unittest.mock import patch
                query = {'profileSha256': cluster['profileSha256']}
                member = '/__local/hpc/clusters/' + cluster['id']
                with patch('backend.local_api.hpc_profiles.probe_profile', side_effect=AssertionError('Unauthorized SSH probe')):
                    for route, method in ((member, 'PUT'), (member, 'DELETE'), (member + '/probe', 'POST')):
                        for credentials in ({}, {'X-Phynite-Worker-Token': app.services.worker_token}):
                            with self.assertRaises(ApiError) as rejected:
                                app.dispatch(method, route, json.dumps(profile('Unauthorized replacement')).encode(), credentials, query)
                            self.assertEqual(rejected.exception.code, 'LOCAL_SESSION_REQUIRED')
                            with self.assertRaises(ApiError):
                                app.hpc_request(method, route, b'{}', credentials, query)
                self.assertEqual(HpcProfileStore(app.services).get(cluster['id'])['name'], cluster['name'])
                alias = json.loads(app.dispatch('GET', member, b'', {'X-Phynite-Worker-Token': app.services.worker_token}, query)['body'])['profile']
                self.assertEqual(alias['profileSha256'], cluster['profileSha256'])
            finally:
                app.close()

    def test_claim_any_requires_matching_owner_and_frozen_affinity(self):
        from backend.local_api.domain.api import PhyniteApi
        from backend.local_api.domain.phynite_core import owner_partition, utc_now
        from backend.local_api.services import LocalServices
        with tempfile.TemporaryDirectory() as directory:
            services = LocalServices(Path(directory), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
            api = PhyniteApi(services)
            project = json.loads(api.create_project(services.owner, {'name': 'HPC protocol test'})['body'])['project']['id']
            key = 'users/fixture/input.json'
            services.s3.put_object(Bucket=services.bucket, Key=key, Body=b'{"calculationId":"hpc-fixture","calculationType":"Total energy","qeInput":"test protocol fixture"}')
            affinity = {'scheduler': 'pbs', 'profileSha256': 'a' * 64}
            item = {'PK': owner_partition(services.owner), 'SK': 'CALCULATION#hpc-fixture', 'id': 'hpc-fixture', 'ownerId': services.owner, 'projectId': project, 'entityType': 'CALCULATION', 'status': 'QUEUED', 'computeBackend': 'LOCAL_MAC', 'computeTarget': 'personal', 'inputKey': key, 'outputPrefix': 'users/fixture/results', 'createdAt': utc_now(), 'executionAffinity': affinity}
            services.put_item(item)
            api.require_local_worker({'headers': {'X-Phynite-Worker-Token': services.worker_token}})
            for requested in (None, {**affinity, 'profileSha256': 'b' * 64}):
                claim = {'workerId': 'fixture-worker', 'capabilities': ['qe'], **({'executionAffinity': requested} if requested else {})}
                self.assertIsNone(json.loads(api.claim_local_job(claim)['body'])['job'])
            claimed = json.loads(api.claim_local_job({'workerId': 'fixture-worker', 'capabilities': ['qe'], 'executionAffinity': affinity})['body'])['job']
            self.assertEqual(claimed['calculationId'], 'hpc-fixture')
            self.assertEqual(claimed['executionAffinity'], affinity)


if __name__ == '__main__': unittest.main()
