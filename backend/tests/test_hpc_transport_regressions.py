"""Fault injection for SSH deadlines and safe scheduler read retries; no live HPC."""
from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from backend.local_worker.hpc_ssh import HpcSshConnection, HpcSshError
from backend.local_worker.hpc_remote import HpcRemoteJobManager, HpcRemoteWorker, profile_sha256


class TransportDeadlineRegressions(unittest.TestCase):
    def connection(self, root: Path) -> HpcSshConnection:
        connection = HpcSshConnection('login.example', 'researcher', control_dir=root / 'ssh')
        connection.socket_path.touch()
        return connection

    def assert_deadline_error(self, operation, *, maximum_seconds: float = .5):
        started = time.monotonic()
        with self.assertRaises(HpcSshError):
            operation()
        self.assertLess(time.monotonic() - started, maximum_seconds)

    def test_run_command_timeout_bounds_controlmaster_check(self):
        # A real child process respects subprocess.run's timeout. No remote host
        # is contacted: this executable only sleeps, simulating stalled mux I/O.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'bin'
            binary.mkdir()
            fake_ssh = binary / 'ssh'
            fake_ssh.write_text('#!' + sys.executable + '\nimport time\ntime.sleep(1.0)\n')
            fake_ssh.chmod(0o755)
            connection = self.connection(root)
            with patch.dict(os.environ, {'PATH': str(binary) + os.pathsep + os.environ.get('PATH', '')}):
                self.assert_deadline_error(lambda: connection.run_command(['echo', 'ok'], timeout=.05))

    def test_run_command_timeout_bounds_inprocess_master_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            connection = self.connection(root)
            acquired = threading.Event()
            release = threading.Event()

            def holder():
                with connection._lock:
                    acquired.set()
                    release.wait(1.0)

            thread = threading.Thread(target=holder)
            thread.start()
            self.assertTrue(acquired.wait(1))
            try:
                with patch.object(connection, '_run_ssh_tool', return_value=subprocess.CompletedProcess(['ssh'], 0, 'ok', '')):
                    self.assert_deadline_error(lambda: connection.run_command(['echo', 'ok'], timeout=.05))
            finally:
                release.set()
                thread.join(timeout=2)

    def test_run_command_timeout_bounds_crossprocess_master_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            connection = self.connection(root)
            # Child holds a real POSIX file lock; stdout gives a deterministic
            # handshake and timeout ensures a failing test cannot hang forever.
            code = ('import fcntl,sys,time; '
                    'handle=open(sys.argv[1], "w"); '
                    'fcntl.flock(handle, fcntl.LOCK_EX); '
                    'print("ready", flush=True); time.sleep(1.0)')
            process = subprocess.Popen([sys.executable, '-c', code, str(connection.lock_path)],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(process.stdout.readline().strip(), 'ready')
                with patch.object(connection, '_run_ssh_tool', return_value=subprocess.CompletedProcess(['ssh'], 0, 'ok', '')):
                    self.assert_deadline_error(lambda: connection.run_command(['echo', 'ok'], timeout=.05))
            finally:
                process.terminate()
                process.communicate(timeout=2)

    def test_sftp_timeout_is_finite_and_translated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            connection = self.connection(root)
            source = root / 'input.in'
            source.write_text('&CONTROL /\n')
            calls = []

            def stalled(command, **kwargs):
                calls.append((command, kwargs))
                self.assertIsNotNone(kwargs.get('timeout'), 'SFTP must have a finite transfer deadline')
                self.assertGreater(kwargs['timeout'], 0)
                raise subprocess.TimeoutExpired(command, kwargs['timeout'])

            with patch.object(connection, 'ensure_master'), patch.object(connection, '_run_ssh_tool', side_effect=stalled):
                with self.assertRaises(HpcSshError):
                    connection.sftp_upload(source, '/scratch/input.in')
            self.assertEqual(len(calls), 1)


class SchedulerReadRegressions(unittest.TestCase):
    def test_sacct_nonzero_uses_squeue_for_live_state(self):
        connection = MagicMock(spec=HpcSshConnection)
        connection.run_command.side_effect = [
            (1, '', 'slurmdbd temporarily unavailable'),
            (0, 'PENDING\n', ''),
        ]
        manager = HpcRemoteJobManager(connection, {'scheduler': 'slurm'})
        manager._scheduler_command = connection.run_command
        state = manager.poll_job('123')
        self.assertEqual(state['state'], 'PENDING')
        self.assertFalse(state['terminal'])
        commands = [call.args[0] for call in connection.run_command.call_args_list]
        self.assertEqual([command[0] for command in commands], ['sacct', 'squeue'])
        self.assertFalse(any(command[0] in {'sbatch', 'qsub'} for command in commands))

    def test_resumed_worker_retries_typed_status_failure_without_submission(self):
        for failures in (1, 3, 4):
            with self.subTest(transient_failures=failures):
                self._check_resumed_retry_budget(failures)

    def _check_resumed_retry_budget(self, failures):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profile = {
                'id': 'cluster-a', 'ownerId': 'owner-a', 'scheduler': 'slurm',
                'storage': {'scratchRoot': '/scratch'},
                'defaults': {'nodes': 1, 'ranksPerNode': 4, 'wallSeconds': 300, 'memoryMiBPerNode': 1024},
            }
            checksum = profile_sha256(profile)
            job = {'calculationId': 'calc-1', 'ownerId': 'owner-a', 'kind': 'qe', 'vcpus': 4, 'memoryMiB': 1024,
                   'input': {'calculationType': 'Total energy', 'settings': {'hpcAllocation': profile['defaults']}}}
            receipts = root / 'calc-1' / 'receipts'
            receipts.mkdir(parents=True)
            receipt = {'state': 'submitted', 'calculationId': 'calc-1', 'profileSha256': checksum,
                       'scheduler': 'slurm', 'schedulerJobId': '123', 'remoteWorkDir': '/scratch/owner-a/calc-1'}
            (receipts / 'calc-1.json').write_text(json.dumps(receipt))
            client = MagicMock()
            client.get.return_value = {'profile': {**profile, 'profileSha256': checksum}}
            client.post.side_effect = lambda path, *_: {'job': job} if path.endswith('/claim') else {'cancelRequested': False}
            # The real manager propagates a transport error from its status read;
            # worker should retry this idempotent operation, then harvest once.
            connection = MagicMock(spec=HpcSshConnection)
            scheduler_reads = [HpcSshError('Connection reset by peer') for _ in range(failures)] + [
                (0, '123|COMPLETED|0:0\n', ''),
            ]
            manager = HpcRemoteJobManager(connection, profile)
            manager._scheduler_command = MagicMock(side_effect=scheduler_reads)
            manager.harvest_completed = MagicMock(return_value={'state': 'completed', 'manifestValidated': True})
            builder = MagicMock(side_effect=AssertionError('resumed job must not stage or resubmit'))
            worker = HpcRemoteWorker(client, 'worker-1', 'cluster-a', checksum,
                                     manager_factory=lambda *_: manager, workspace_builder=builder)
            with patch('time.sleep'):
                outcome = worker.run_once('calc-1', connection, root, poll_seconds=0)
            if failures < 4:
                self.assertEqual(outcome['state'], 'completed', outcome)
                self.assertEqual(manager._scheduler_command.call_count, failures + 1)
                manager.harvest_completed.assert_called_once()
            else:
                self.assertEqual(outcome['state'], 'monitoring-deferred', outcome)
                self.assertEqual(manager._scheduler_command.call_count, 4)
                manager.harvest_completed.assert_not_called()
            builder.assert_not_called()
            self.assertFalse(any(call.args[0][0] in {'sbatch', 'qsub'} for call in connection.run_command.call_args_list))
            self.assertGreaterEqual(sum(call.args[0].endswith('/heartbeat') for call in client.post.call_args_list), 2)
            self.assertEqual(json.loads((receipts / 'calc-1.json').read_text()), receipt)


if __name__ == '__main__':
    unittest.main()
