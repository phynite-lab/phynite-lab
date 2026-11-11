"""Regression coverage for PR 57 runtime qualification and receipt identity."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from backend.local_api.hpc_profiles import _runtime_probe_diagnostics
from backend.local_worker import hpc_ssh
from backend.local_worker.hpc_ssh import HpcSshConnection
from backend.local_worker.hpc_remote import HpcError, HpcRemoteJobManager, HpcRemoteWorker, profile_sha256


class HpcReviewRegressions(unittest.TestCase):
    def test_probe_imports_scientific_packages_and_reports_broken_native_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in hpc_ssh.REQUIRED_PYTHON_MODULES:
                (root / f'{name}.py').write_text("raise ImportError('missing shared library')\n")
            probe = subprocess.run([sys.executable, '-c', hpc_ssh._PY_CHECK_CODE],
                                   cwd=root, capture_output=True, text=True, check=True)
            missing = probe.stdout.strip().split('|', 1)[1].split(',')
            self.assertEqual(missing, list(hpc_ssh.REQUIRED_PYTHON_MODULES))

    def test_probe_rejects_old_and_incomplete_runtimes_before_recommending_python(self):
        for version in ('3.7.17', '3.8.20', '3.9.25', '3.10.20'):
            for missing in ('', 'seekpath', 'spglib', 'numpy'):
                with self.subTest(version=version, missing=missing), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    binary = root / 'bin'
                    binary.mkdir()
                    python = binary / 'python3'
                    python.write_text(f"#!/bin/sh\nprintf '%s\\n' '{version}|{missing}'\n")
                    python.chmod(0o755)
                    candidate = root / 'candidate-python3'
                    candidate.write_text("#!/bin/sh\nprintf '%s\\n' '3.12.10|'\n")
                    candidate.chmod(0o755)
                    connection = hpc_ssh.HpcSshConnection('login.example', 'researcher', control_dir=root / 'ssh')
                    connection.ensure_master = MagicMock()

                    def local_shell(command, **kwargs):
                        return subprocess.run(['sh', '-c', command[-1]], capture_output=True, text=True,
                                              env={**os.environ, 'PATH': f'{binary}:{os.defpath}', 'HOME': str(root)})

                    # Exercise run_command validation, quoting and the actual probe shell script.
                    connection._run_ssh_tool = local_shell
                    with patch.object(hpc_ssh, 'PYTHON_CANDIDATE_GLOBS', (shlex.quote(str(candidate)),)):
                        result = connection.probe_connection()
                    self.assertTrue(result['ok'], result)
                    ready = version == '3.10.20' and not missing
                    self.assertEqual(result['python']['versionOk'], version == '3.10.20')
                    self.assertEqual(result['python']['packagesOk'], ready)
                    if ready:
                        self.assertNotIn('suggestedExecutable', result['python'])
                    else:
                        self.assertEqual(result['python']['suggestedExecutable'], str(candidate))

    def test_supported_pmi2_launcher_is_preserved_without_pmix(self):
        profile = {'scheduler': 'slurm', 'runtime': {'mpiLauncher': ['srun', '--mpi=pmi2', '--ntasks={ranks}']}}
        probe = {'mpi': {'mpirun': '/opt/mpi/bin/mpirun', 'srunPlugins': ['none', 'pmi2'], 'qeMpi': 'impi'}}
        self.assertEqual(_runtime_probe_diagnostics(profile, probe), {})

    def test_remote_script_blocks_invalid_explicit_python_before_starting_runner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            python = root / 'python3'
            marker = root / 'runner-started'
            python.write_text(f"#!/bin/sh\nif [ \"$1\" = -c ]; then exit 1; fi\ntouch {shlex.quote(str(marker))}\n")
            python.chmod(0o755)
            profile = {'scheduler': 'slurm', 'runtime': {'pythonExecutable': str(python), 'mpiLauncher': ['mpirun', '-np', '{ranks}']}}
            script = HpcRemoteJobManager(MagicMock(), profile).render_remote_script('calc-1', str(root))
            result = subprocess.run(['bash', '-c', script], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('Python >= 3.10', result.stderr)
            self.assertFalse(marker.exists())

    def test_resumed_job_checks_result_identity_with_real_manager_and_checksum_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / 'remote'
            results = remote / 'results'
            results.mkdir(parents=True)
            profile = {
                'id': 'cluster-a', 'ownerId': 'owner-a', 'scheduler': 'slurm',
                'storage': {'scratchRoot': str(root), 'purgeWavefunctions': False},
                'defaults': {'nodes': 1, 'ranksPerNode': 4, 'wallSeconds': 300, 'memoryMiBPerNode': 1024},
            }
            checksum = profile_sha256(profile)
            job = {'calculationId': 'calc-resumed', 'ownerId': 'owner-a', 'kind': 'qe', 'vcpus': 4, 'memoryMiB': 1024,
                   'input': {'calculationType': 'Total energy', 'settings': {'hpcAllocation': profile['defaults']}}}
            receipt_dir = root / 'calc-resumed' / 'receipts'
            receipt_dir.mkdir(parents=True)
            receipt = {'state': 'submitted', 'calculationId': 'calc-resumed', 'profileSha256': checksum,
                       'scheduler': 'slurm', 'schedulerJobId': '123', 'remoteWorkDir': str(remote)}
            (receipt_dir / 'calc-resumed.json').write_text(json.dumps(receipt))
            manifest = {'status': 'completed', 'calculationId': 'other-calculation', 'calculationType': 'Total energy',
                        'summary': {'converged': True, 'jobDone': True, 'stageConvergence': [{
                            'stage': 'scf', 'calculationMode': 'scf', 'jobDone': True,
                            'electronicConvergence': 'converged', 'hybridConvergence': 'not-applicable',
                            'scfAccuracy': {'status': 'verified', 'residualRy': 1e-9, 'residualUpperRy': 1.1e-9,
                                            'thresholdRy': 1e-8, 'source': 'qe-log-bound'}}]}}
            connection = MagicMock(spec=hpc_ssh.HpcSshConnection)

            def command(argv):
                if argv[0] == 'sacct': return 0, '123|COMPLETED|0:0\n', ''
                if argv[0] == 'find': return 0, 'result.json\nmanifest.sha256\n', ''
                if argv[0] == 'stat': return 0, str(Path(argv[-1]).stat().st_size), ''
                raise AssertionError(argv)

            connection.run_command.side_effect = command
            connection.sftp_download.side_effect = lambda source, destination: destination.write_bytes(Path(source).read_bytes())
            client = MagicMock()
            client.get.return_value = {'profile': {**profile, 'profileSha256': checksum}}
            client.post.side_effect = lambda path, *_: {'job': job} if path.endswith('/claim') else {'cancelRequested': False}
            builder = MagicMock(side_effect=AssertionError('resumed jobs must not rebuild or resubmit'))
            manager = HpcRemoteJobManager(connection, profile)
            manager._scheduler_command = MagicMock(return_value=(0, '123|COMPLETED|0:0\n', ''))
            worker = HpcRemoteWorker(client, 'worker-a', 'cluster-a', checksum, workspace_builder=builder, manager_factory=lambda *_: manager)
            for identity, expected in (('other-calculation', 'manual-resume-required'), ('calc-resumed', 'completed')):
                manifest['calculationId'] = identity
                result_path = results / 'result.json'
                result_path.write_text(json.dumps(manifest))
                (results / 'manifest.sha256').write_text(f'{hashlib.sha256(result_path.read_bytes()).hexdigest()}  result.json\n')
                outcome = worker.run_once('calc-resumed', connection, root, poll_seconds=0)
                self.assertEqual(outcome['state'], expected, outcome)
                if identity != 'calc-resumed':
                    self.assertIn('different calculation', outcome['reason'])
            builder.assert_not_called()
            self.assertFalse(any(call.args[0][0] in {'sbatch', 'qsub'} for call in connection.run_command.call_args_list))

    def hpc_monitor_fixture(self):
        """Real receipt identity; fake transport and scheduler, no live HPC."""
        from backend.local_worker.worker import WorkerError
        profile = {
            'id': 'cluster-monitor', 'ownerId': 'owner-monitor', 'scheduler': 'slurm',
            'storage': {'scratchRoot': '/scratch/phynite-work'},
            'runtime': {'environmentModules': [], 'mpiLauncher': ['srun', '--ntasks={ranks}']},
            'defaults': {'nodes': 1, 'ranksPerNode': 2, 'memoryMiBPerNode': 2048, 'wallSeconds': 300},
        }
        profile['profileSha256'] = profile_sha256(profile)
        job = {
            'kind': 'qe', 'ownerId': profile['ownerId'], 'calculationId': 'calc-monitor',
            'vcpus': 2, 'memoryMiB': 2048,
            'input': {'calculationType': 'Total energy', 'settings': {'hpcAllocation': profile['defaults']}},
        }
        client = MagicMock()
        client.get.return_value = {'profile': profile}
        client.post.side_effect = lambda path, payload: {'job': job} if path.endswith('/claim') else {}
        manager = MagicMock()
        receipt = {
            'version': 1, 'state': 'submitted', 'scheduler': 'slurm',
            'calculationId': job['calculationId'], 'profileSha256': profile['profileSha256'],
            'schedulerJobId': '123', 'remoteWorkDir': '/scratch/phynite-work/owner-monitor/calc-monitor',
        }
        manager.submit_job.return_value = receipt
        manager.poll_job.return_value = {'schedulerJobId': '123', 'state': 'COMPLETED', 'exitCode': '0', 'terminal': True}
        manager.harvest_completed.return_value = {'state': 'completed', 'manifestValidated': True}
        worker = HpcRemoteWorker(
            client, 'worker-monitor', profile['id'], profile['profileSha256'],
            manager_factory=lambda *_: manager, workspace_builder=lambda *_: {},
        )
        return worker, client, manager, receipt, job, WorkerError

    def test_single_transient_api_heartbeat_failure_does_not_fail_submitted_job(self):
        worker, client, manager, _, job, WorkerError = self.hpc_monitor_fixture()
        attempts = 0
        def post(path, payload):
            nonlocal attempts
            if path.endswith('/claim'):
                return {'job': job}
            attempts += 1
            if attempts == 1:
                try:
                    raise TimeoutError('one temporary localhost timeout')
                except TimeoutError as cause:
                    raise WorkerError('Worker API request timed out') from cause
            return {}
        client.post.side_effect = post
        with tempfile.TemporaryDirectory() as folder, patch('time.sleep', return_value=None):
            outcome = worker.run_once(None, MagicMock(spec=HpcSshConnection), Path(folder), poll_seconds=0)
        self.assertEqual(outcome['state'], 'completed', outcome)
        self.assertGreaterEqual(attempts, 2)
        manager.submit_job.assert_called_once()
        manager.harvest_completed.assert_called_once()

    def test_pending_queue_monitor_slice_is_nonterminal_and_resume_never_resubmits(self):
        worker, _, manager, receipt, job, _ = self.hpc_monitor_fixture()
        manager.poll_job.return_value = {'schedulerJobId': '123', 'state': 'PENDING', 'exitCode': '', 'terminal': False}
        with tempfile.TemporaryDirectory() as folder, patch('time.sleep', return_value=None):
            root = Path(folder)
            receipt_dir = root / job['calculationId'] / 'receipts'
            receipt_dir.mkdir(parents=True)
            (receipt_dir / (job['calculationId'] + '.json')).write_text(json.dumps(receipt), encoding='utf-8')
            outcome = worker.run_once(None, MagicMock(spec=HpcSshConnection), root, poll_seconds=60, max_polls=1)
            self.assertEqual(outcome['state'], 'monitoring-deferred', outcome)
            self.assertEqual(outcome['receipt'], receipt)
            manager.submit_job.assert_not_called()
            manager.harvest_completed.assert_not_called()
            self.assertFalse((root / job['calculationId'] / 'results' / 'result.json').exists())
            manager.poll_job.return_value = {'schedulerJobId': '123', 'state': 'COMPLETED', 'exitCode': '0', 'terminal': True}
            resumed = worker.run_once(None, MagicMock(spec=HpcSshConnection), root, poll_seconds=60, max_polls=1)
            self.assertEqual(resumed['state'], 'completed', resumed)
            manager.submit_job.assert_not_called()
            manager.harvest_completed.assert_called_once()

    def test_lease_rejection_is_not_retried_as_transient(self):
        import io
        import urllib.error
        worker, client, manager, _, job, WorkerError = self.hpc_monitor_fixture()
        attempts = 0
        def post(path, payload):
            nonlocal attempts
            if path.endswith('/claim'):
                return {'job': job}
            attempts += 1
            cause = urllib.error.HTTPError(
                'http://127.0.0.1/heartbeat', 409, 'Conflict', {},
                io.BytesIO(b'{"code":"WORKER_LEASE_MISMATCH","error":"Lease belongs to another worker"}'),
            )
            raise WorkerError('Lease belongs to another worker') from cause
        client.post.side_effect = post
        with tempfile.TemporaryDirectory() as folder, patch('time.sleep', return_value=None):
            outcome = worker.run_once(None, MagicMock(spec=HpcSshConnection), Path(folder), poll_seconds=0)
        # The caller must skip terminal upload for this outcome too: ownership is lost.
        self.assertEqual(outcome['state'], 'lease-lost', outcome)
        self.assertEqual(attempts, 1)
        manager.poll_job.assert_not_called()

    def test_pre_submission_guard_runs_after_staging_and_blocks_scheduler_and_receipt(self):
        from backend.local_worker.hpc_remote import LeaseLost
        profile = {
            'id': 'cluster-guard', 'ownerId': 'owner-guard', 'scheduler': 'slurm',
            'storage': {'scratchRoot': '/scratch/phynite-work'},
            'runtime': {'environmentModules': [], 'mpiLauncher': ['srun', '--ntasks={ranks}']},
            'defaults': {'nodes': 1, 'ranksPerNode': 2, 'memoryMiBPerNode': 2048, 'wallSeconds': 300},
        }
        for failure in (LeaseLost('lease was rejected during staging'), HpcError('Cancellation requested during staging')):
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as folder:
                connection = MagicMock(spec=HpcSshConnection)
                connection.run_command.return_value = (0, '', '')
                staged = []
                connection.sftp_upload.side_effect = lambda local, remote: staged.append(remote)
                manager = HpcRemoteJobManager(connection, profile)
                manager._scheduler_command = MagicMock(return_value=(0, '123\n', ''))
                receipts = Path(folder) / 'receipts'
                guarded = []
                def before_submit():
                    guarded.append(True)
                    # A slow final SFTP transfer must finish before the lease check.
                    self.assertEqual(len(staged), 3)
                    self.assertTrue(staged[-1].endswith('/submit.sh'))
                    self.assertFalse((receipts / 'calc-guard.json').exists())
                    raise failure
                with self.assertRaises(type(failure)) as rejected:
                    manager.submit_job(
                        'calc-guard', {'input.json': '{}', 'runners/local_runner.py': 'pass\n'},
                        receipts, before_submit=before_submit,
                    )
                self.assertEqual(str(rejected.exception), str(failure))
                self.assertEqual(guarded, [True])
                manager._scheduler_command.assert_not_called()
                self.assertFalse((receipts / 'calc-guard.json').exists())
                self.assertTrue(all(call.args[0][0] == 'mkdir' for call in connection.run_command.call_args_list))

    def test_staging_ssh_exit_is_retried_but_permission_failure_is_permanent(self):
        from backend.local_worker.hpc_ssh import HpcSshError
        worker, client, manager, receipt, job, _ = self.hpc_monitor_fixture()
        manager.submit_job.side_effect = [HpcSshError('temporary staging disconnect'), receipt]
        with tempfile.TemporaryDirectory() as folder, patch('time.sleep'):
            outcome = worker.run_once(None, MagicMock(), Path(folder))
        self.assertEqual(outcome['state'], 'completed', outcome)
        self.assertEqual(manager.submit_job.call_count, 2)
        for code, expected in ((255, HpcSshError), (1, HpcError)):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as folder:
                connection = MagicMock(spec=HpcSshConnection)
                connection.run_command.return_value = (code, '', 'failure')
                actual = HpcRemoteJobManager(connection, {'scheduler': 'slurm'})
                with self.assertRaises(expected) as failure:
                    actual.submit_job('calc-staging', {'input.json': '{}'}, Path(folder))
                self.assertIs(type(failure.exception), expected)
                connection.sftp_upload.assert_not_called()

    def test_remote_script_binds_runtime_provenance_to_the_frozen_profile(self):
        profile = {'scheduler': 'slurm', 'runtime': {'mpiLauncher': ['srun', '--ntasks={ranks}']}}
        script = HpcRemoteJobManager(MagicMock(), profile).render_remote_script('calc-provenance', '/scratch/calc')
        self.assertIn('export PHYNITE_HPC_PROFILE_SHA256=' + profile_sha256(profile), script)

    def test_nonterminal_outcomes_cannot_be_finalized_as_failed_results(self):
        from backend.local_worker.worker import WorkerError, remote_result
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for state in ('monitoring-deferred', 'lease-lost'):
                with self.subTest(state=state), self.assertRaises(WorkerError):
                    remote_result(root, {'calculationId': 'calc-active'}, {'state': state})
            self.assertFalse((root / 'results').exists())

    def test_cancellation_or_lease_rejection_during_staging_blocks_submission(self):
        import urllib.error
        for failure in ('cancel', 'lease-rejected'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                profile = {
                    'id': 'cluster-a', 'ownerId': 'owner-a', 'scheduler': 'slurm',
                    'storage': {'scratchRoot': '/scratch'},
                    'defaults': {'nodes': 1, 'ranksPerNode': 4, 'wallSeconds': 300, 'memoryMiBPerNode': 1024},
                }
                checksum = profile_sha256(profile)
                job = {
                    'calculationId': 'calc-1', 'ownerId': 'owner-a', 'kind': 'qe', 'vcpus': 4, 'memoryMiB': 1024,
                    'input': {'calculationType': 'Total energy', 'settings': {'hpcAllocation': profile['defaults']}},
                }
                staging = {'started': False}
                heartbeats = []
                client = MagicMock()
                client.get.return_value = {'profile': {**profile, 'profileSha256': checksum}}

                def post(path, payload):
                    if path.endswith('/claim'):
                        return {'job': job}
                    self.assertTrue(path.endswith('/heartbeat'), path)
                    heartbeats.append(payload['stage'])
                    if staging['started']:
                        if failure == 'lease-rejected':
                            raise urllib.error.HTTPError('http://localhost/heartbeat', 409, 'lease rejected', {}, None)
                        return {'cancelRequested': True}
                    return {'cancelRequested': False}

                client.post.side_effect = post
                connection = MagicMock(spec=HpcSshConnection)
                scheduler_calls = []

                def command(argv, **kwargs):
                    if argv[0] == 'mkdir':
                        return 0, '', ''
                    # Submission is now framed through sh/bash; checking only
                    # argv[0] == 'sbatch' would falsely pass a broken guard.
                    scheduler_calls.append(argv)
                    raise AssertionError('Scheduler command was reached after cancellation or lease loss')

                connection.run_command.side_effect = command
                connection.sftp_upload.side_effect = lambda *_: staging.update(started=True)
                builder = MagicMock(return_value={'input.json': '{}'})
                worker = HpcRemoteWorker(client, 'worker-a', 'cluster-a', checksum, workspace_builder=builder)
                outcome = worker.run_once('calc-1', connection, root, poll_seconds=0, max_polls=1)
                self.assertTrue(staging['started'])
                self.assertGreaterEqual(connection.sftp_upload.call_count, 2)
                self.assertIn('REMOTE_SUBMITTING', heartbeats, 'guard must refresh ownership after staging')
                self.assertEqual(scheduler_calls, [], 'neither raw nor wrapped sbatch/qsub may be reached')
                self.assertFalse((root / 'calc-1' / 'receipts' / 'calc-1.json').exists())
                self.assertEqual(outcome['state'], 'manual-resume-required' if failure == 'cancel' else 'lease-lost', outcome)
                self.assertIn('Cancellation requested' if failure == 'cancel' else 'rejected', outcome['reason'])
                builder.assert_called_once()


if __name__ == '__main__':
    unittest.main()
