"""Local-only HPC profile persistence and owner/checksum fences."""
from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.local_api.hpc_profiles import HpcProfileStore, _profile_digest, probe_profile


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
    def test_probe_forwards_configured_environment_modules_and_failure(self):
        failure = {'ok': False, 'error': 'Failed to load environment module qe/typo: Lmod unknown module', 'latencyMs': 2, 'solvers': {}, 'schedulers': {}}
        with patch('backend.local_worker.hpc_ssh.HpcSshConnection') as connection:
            connection.return_value.probe_connection.return_value = failure
            value = profile()
            value['runtime']['environmentModules'] = ['module purge', 'module load qe/typo']
            self.assertEqual(probe_profile(value), failure)
            connection.return_value.probe_connection.assert_called_once_with(modules=value['runtime']['environmentModules'])

    def test_probe_rejects_corrupt_runtime_and_module_list(self):
        for runtime in ('qe/7.2', None, {'environmentModules': 'qe/7.2'}, {'environmentModules': ''}, {'environmentModules': None}):
            with self.subTest(runtime=runtime), patch('backend.local_worker.hpc_ssh.HpcSshConnection') as connection:
                result = probe_profile({**profile(), 'runtime': runtime})
                self.assertFalse(result['ok'])
                self.assertIn('invalid', result['error'])
                connection.return_value.probe_connection.assert_not_called()

    def test_probe_defaults_missing_modules_to_empty_list(self):
        with patch('backend.local_worker.hpc_ssh.HpcSshConnection') as connection:
            probe_profile({**profile(), 'runtime': {}})
            connection.return_value.probe_connection.assert_called_once_with(modules=[])

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

    def test_detect_scratch_endpoint_and_blank_scratch_autodetection_on_save(self):
        from backend.local_api.desktop_server import DesktopApplication
        from backend.local_api.domain.phynite_core import ApiError
        with tempfile.TemporaryDirectory() as directory:
            app = DesktopApplication(Path(directory), 8792, 'http://127.0.0.1:3000')
            try:
                headers = {'Authorization': 'Bearer ' + app.token}
                with self.assertRaises(ApiError) as denied:
                    app.dispatch('POST', '/__local/hpc/clusters/detect-scratch', b'{}', {}, {})
                self.assertEqual(denied.exception.code, 'LOCAL_SESSION_REQUIRED')

                with patch('backend.local_worker.hpc_ssh.HpcSshConnection') as connection:
                    connection.return_value.detect_scratch_root.return_value = '/mgpfs/home/researcher/phynite-work'
                    connection.return_value.probe_connection.return_value = {
                        'ok': True, 'latencyMs': 5.0, 'system': 'Linux x86_64',
                        'schedulers': {'slurm': True, 'pbs': False},
                        'solvers': {'qe': '/usr/bin/pw.x', 'lammps': None},
                        'suggestedScratchRoot': '/mgpfs/home/researcher/phynite-work',
                    }
                    connection.return_value.check_writable_path.return_value = False

                    detected = app.dispatch(
                        'POST',
                        '/__local/hpc/clusters/detect-scratch',
                        json.dumps({'connection': profile()['connection']}).encode(),
                        headers,
                        {},
                    )
                    self.assertEqual(json.loads(detected['body'])['scratchRoot'], '/mgpfs/home/researcher/phynite-work')

                    blank_payload = {
                        **profile(),
                        'storage': {'purgeWavefunctions': True},
                    }
                    created = app.dispatch('POST', '/__local/hpc/clusters', json.dumps(blank_payload).encode(), headers, {})
                    cluster = json.loads(created['body'])['cluster']
                    self.assertEqual(cluster['storage']['scratchRoot'], '/mgpfs/home/researcher/phynite-work')

                    probe_result = probe_profile({**cluster, 'storage': {'scratchRoot': '/scratch', 'purgeWavefunctions': True}})
                    self.assertFalse(probe_result['scratchWritable'])
                    self.assertEqual(probe_result['suggestedScratchRoot'], '/mgpfs/home/researcher/phynite-work')
            finally:
                app.close()

    def test_probe_profile_emits_runtime_warnings_and_recommendations(self):
        with patch('backend.local_worker.hpc_ssh.HpcSshConnection') as connection:
            connection.return_value.check_writable_path.return_value = True
            connection.return_value.probe_connection.return_value = {
                'ok': True,
                'latencyMs': 8.0,
                'system': 'Linux x86_64',
                'schedulers': {'slurm': True, 'pbs': False},
                'solvers': {'qe': '/opt/qe/bin/pw.x', 'lammps': None},
                'mpi': {
                    'mpirun': '/opt/impi/bin/mpirun',
                    'mpiexec': '/opt/impi/bin/mpiexec',
                    'srunPlugins': ['cray_shasta', 'none', 'pmi2'],
                    'qeMpi': 'intelmpi',
                },
                'python': {
                    'executable': '/usr/bin/python3',
                    'version': '3.6.8',
                    'versionOk': False,
                    'packagesOk': False,
                    'missingPackages': ['numpy', 'scipy', 'matplotlib'],
                    'suggestedExecutable': '/home/researcher/miniconda3/envs/science/bin/python3',
                    'suggestedVersion': '3.10.20',
                },
            }
            prof = profile()
            prof['runtime']['mpiLauncher'] = ['srun', '--mpi=pmix', '--ntasks={ranks}']
            res = probe_profile(prof)
            self.assertEqual(res['suggestedMpiLauncher'], ['mpirun', '-np', '{ranks}'])
            self.assertEqual(res['suggestedPythonExecutable'], '/home/researcher/miniconda3/envs/science/bin/python3')
            self.assertTrue(res.get('runtimeWarnings'))
            self.assertGreaterEqual(len(res['runtimeWarnings']), 2)
            connection.return_value.probe_connection.assert_called_once_with(modules=prof['runtime']['environmentModules'])

            connection.reset_mock()
            connection.return_value.check_writable_path.return_value = True
            connection.return_value.probe_connection.return_value = {
                'ok': True,
                'latencyMs': 7.0,
                'system': 'Linux x86_64',
                'schedulers': {'slurm': True, 'pbs': False},
                'solvers': {'qe': '/opt/qe/bin/pw.x', 'lammps': None},
                'mpi': {'mpirun': '/opt/impi/bin/mpirun', 'mpiexec': '/opt/impi/bin/mpiexec', 'srunPlugins': ['pmi2'], 'qeMpi': 'intelmpi'},
                'python': {'executable': '/home/researcher/miniconda3/envs/science/bin/python3', 'version': '3.10.20', 'versionOk': True, 'packagesOk': True, 'missingPackages': []},
            }
            fixed = copy.deepcopy(prof)
            fixed['runtime']['mpiLauncher'] = ['mpirun', '-np', '{ranks}']
            fixed['runtime']['pythonExecutable'] = '/home/researcher/miniconda3/envs/science/bin/python3'
            res_fixed = probe_profile(fixed)
            self.assertNotIn('suggestedMpiLauncher', res_fixed)
            self.assertNotIn('suggestedPythonExecutable', res_fixed)
            self.assertFalse(res_fixed.get('runtimeWarnings'))
            connection.return_value.probe_connection.assert_called_once_with(
                modules=fixed['runtime']['environmentModules'],
                python_executable='/home/researcher/miniconda3/envs/science/bin/python3',
            )

    def test_reconcile_interrupted_jobs_spares_submitted_hpc_jobs_only(self):
        from backend.local_api.domain.phynite_core import owner_partition
        from backend.local_api.services import LocalServices
        with tempfile.TemporaryDirectory() as directory:
            services = LocalServices(Path(directory), 'http://127.0.0.1:49160', 'http://127.0.0.1:3000')
            owner = services.owner
            sha = 'c' * 64
            services.put_item({
                'PK': owner_partition(owner), 'SK': 'CALCULATION#hpc-calc', 'id': 'hpc-calc',
                'ownerId': owner, 'projectId': 'p', 'entityType': 'CALCULATION', 'status': 'RUNNING',
                'computeBackend': 'LOCAL_MAC', 'leaseExpiresAtEpoch': 1,
                'executionAffinity': {'scheduler': 'slurm', 'profileSha256': sha},
            })
            services.put_item({
                'PK': owner_partition(owner), 'SK': 'CALCULATION#local-calc', 'id': 'local-calc',
                'ownerId': owner, 'projectId': 'p', 'entityType': 'CALCULATION', 'status': 'RUNNING',
                'computeBackend': 'LOCAL_MAC', 'leaseExpiresAtEpoch': 1,
            })
            services.put_item({
                'PK': owner_partition(owner), 'SK': 'CALCULATION#uncertain-calc', 'id': 'uncertain-calc',
                'ownerId': owner, 'projectId': 'p', 'entityType': 'CALCULATION', 'status': 'RUNNING',
                'computeBackend': 'LOCAL_MAC', 'leaseExpiresAtEpoch': 1,
                'executionAffinity': {'scheduler': 'slurm', 'profileSha256': sha},
            })
            submitted_receipt = Path(directory) / 'work' / 'hpc' / f'brin-{sha[:12]}' / 'hpc-calc' / 'receipts' / 'hpc-calc.json'
            submitted_receipt.parent.mkdir(parents=True)
            submitted_receipt.write_text(json.dumps({
                'state': 'submitted', 'calculationId': 'hpc-calc', 'profileSha256': sha,
                'scheduler': 'slurm', 'schedulerJobId': '571085',
            }), encoding='utf-8')
            uncertain_receipt = Path(directory) / 'work' / 'hpc' / f'brin-{sha[:12]}' / 'uncertain-calc' / 'receipts' / 'uncertain-calc.json'
            uncertain_receipt.parent.mkdir(parents=True)
            uncertain_receipt.write_text(json.dumps({
                'state': 'submission-uncertain', 'calculationId': 'uncertain-calc', 'profileSha256': sha,
                'scheduler': 'slurm',
            }), encoding='utf-8')

            services.reconcile_interrupted_jobs(restart=True)
            self.assertEqual(services.get_item(owner, 'CALCULATION', 'hpc-calc')['status'], 'RUNNING')
            self.assertEqual(services.get_item(owner, 'CALCULATION', 'local-calc')['status'], 'FAILED')
            self.assertTrue(services.get_item(owner, 'CALCULATION', 'local-calc')['interrupted'])
            self.assertEqual(services.get_item(owner, 'CALCULATION', 'uncertain-calc')['status'], 'FAILED')

            # After restart and lease expiry, only the RUNNING HPC job with a submitted receipt can be re-claimed to resume polling.
            resumed = services.claim_local_calculation(
                services.get_item(owner, 'CALCULATION', 'hpc-calc'),
                'worker-resumed',
                2000,
                1000,
                '2026-11-11T09:30:00Z',
            )
            self.assertIsNotNone(resumed)
            self.assertEqual(resumed['localWorkerId'], 'worker-resumed')
            self.assertEqual(int(resumed['leaseExpiresAtEpoch']), 2000)

            # Without a valid submitted receipt, an expired RUNNING local job must still never be re-claimed.
            services.put_item({
                'PK': owner_partition(owner), 'SK': 'CALCULATION#no-receipt-running', 'id': 'no-receipt-running',
                'ownerId': owner, 'projectId': 'p', 'entityType': 'CALCULATION', 'status': 'RUNNING',
                'computeBackend': 'LOCAL_MAC', 'leaseExpiresAtEpoch': 1,
            })
            self.assertIsNone(services.claim_local_calculation(
                services.get_item(owner, 'CALCULATION', 'no-receipt-running'),
                'worker-resumed',
                2000,
                1000,
                '2026-11-11T09:30:00Z',
            ))

    def test_setup_venv_endpoint_and_profile_update(self):
        from backend.local_api.desktop_server import DesktopApplication
        from backend.local_api.hpc_profiles import HpcProfileStore
        with tempfile.TemporaryDirectory() as directory:
            app = DesktopApplication(Path(directory), 8792, 'http://127.0.0.1:3000')
            try:
                headers = {'Authorization': 'Bearer ' + app.token}
                store = HpcProfileStore(app.services)
                saved = store.save(profile(), 'cl-setup-test')
                cluster_id = saved['id']

                with patch('backend.local_worker.hpc_ssh.HpcSshConnection') as connection:
                    connection.return_value.setup_python_venv.return_value = {
                        'ok': True,
                        'pythonExecutable': '/home/researcher/.phynite-venv/bin/python',
                        'venvDir': '/home/researcher/.phynite-venv',
                        'version': '3.11.4',
                        'packages': ['numpy', 'scipy', 'matplotlib', 'seekpath', 'spglib', 'ase', 'pymatgen'],
                    }
                    connection.return_value.probe_connection.return_value = {
                        'ok': True, 'latencyMs': 6.0, 'system': 'Linux x86_64',
                        'schedulers': {'slurm': True, 'pbs': False},
                        'solvers': {'qe': '/usr/bin/pw.x', 'lammps': None},
                    }
                    connection.return_value.check_writable_path.return_value = True

                    response_raw = app.dispatch(
                        'POST',
                        f'/__local/hpc/clusters/{cluster_id}/setup-venv',
                        json.dumps({'venvPath': '/home/researcher/.phynite-venv'}).encode(),
                        headers,
                        {},
                    )
                    self.assertEqual(response_raw['statusCode'], 200)
                    body = json.loads(response_raw['body'])
                    self.assertTrue(body['ok'])
                    self.assertEqual(body['pythonExecutable'], '/home/researcher/.phynite-venv/bin/python')

                    # Check that the profile in store was updated with the new pythonExecutable
                    updated_profile = store.get(cluster_id)
                    self.assertEqual(updated_profile['runtime']['pythonExecutable'], '/home/researcher/.phynite-venv/bin/python')
            finally:
                app.close()

    def test_venv_setup_does_not_overwrite_concurrent_profile_edits_or_recreate_deleted_profiles(self):
        from backend.local_api.desktop_server import DesktopApplication
        from backend.local_api.hpc_profiles import HpcProfileStore, setup_cluster_venv
        from backend.local_api.domain.phynite_core import ApiError
        for delete in (False, True):
            with self.subTest(delete=delete), tempfile.TemporaryDirectory() as directory:
                app = DesktopApplication(Path(directory), 8792, 'http://127.0.0.1:3000')
                try:
                    store = HpcProfileStore(app.services); saved = store.save(profile(), 'cl-race')
                    def setup(**kwargs):
                        if delete: store.delete(saved['id'])
                        else: store.save({**saved, 'name': 'edited concurrently'}, saved['id'])
                        return {'ok': True, 'pythonExecutable': '/home/researcher/.phynite-venv/bin/python'}
                    with patch('backend.local_api.hpc_profiles._ssh_client') as ssh:
                        ssh.return_value.setup_python_venv.side_effect = setup
                        with self.assertRaises(ApiError) as caught: setup_cluster_venv(store, saved['id'])
                        self.assertEqual(caught.exception.code, 'HPC_PROFILE_CHANGED')
                    self.assertIsNone(store.get(saved['id'])) if delete else self.assertEqual(store.get(saved['id'])['name'], 'edited concurrently')
                finally: app.close()


if __name__ == '__main__': unittest.main()

