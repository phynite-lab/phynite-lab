"""Scheduler module/framing integration; no real scheduler or network is used."""
from __future__ import annotations

from contextlib import contextmanager
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from backend.local_worker import hpc_ssh
from backend.local_worker.hpc_remote import HpcRemoteJobManager


class ModuleSchedulerRegressions(unittest.TestCase):
    @contextmanager
    def fixture(self, scheduler, *, modules=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'bin'
            binary.mkdir()
            scheduler_bin = root / 'scheduler-bin'
            scheduler_bin.mkdir()
            called = root / 'scheduler-calls'
            tools = {
                'sbatch': "printf '123\\n'",
                'sacct': "printf '123|PENDING|0:0\\n'",
                'squeue': "printf 'PENDING\\n'",
                'qsub': "printf '123.cluster\\n'",
                'qstat': "printf '%s\\n' '{\"Jobs\": {\"123.cluster\": {\"job_state\": \"Q\"}}}'",
            }
            names = ('sbatch', 'sacct', 'squeue') if scheduler == 'slurm' else ('qsub', 'qstat')
            for name in names:
                tool = scheduler_bin / name
                tool.write_text('#!/bin/sh\nprintf "%s\\n" ' + shlex.quote(name) + ' >> ' + shlex.quote(str(called)) + '\n' + tools[name] + '\n')
                tool.chmod(0o755)
            # Simulates the initialization done by bash -lc without reading any
            # machine-specific .bash_profile. Login and module output deliberately
            # looks unlike the scheduler output and appears before/after it.
            bootstrap = (
                'module() { printf "module diagnostic: loading runtime\\n"; '
                'PATH=' + shlex.quote(str(scheduler_bin)) + ':$PATH; export PATH; }; '
                'printf "Welcome to synthetic login node\\n"; '
                'trap ' + shlex.quote('printf "Farewell from synthetic login node\\n"') + ' EXIT; '
                'eval "$1"'
            )
            bash = binary / 'bash'
            bash.write_text('#!/bin/sh\nexec /bin/bash --noprofile --norc -c ' + shlex.quote(bootstrap) + ' -- "$2"\n')
            bash.chmod(0o755)
            connection = hpc_ssh.HpcSshConnection('login.example', 'researcher', control_dir=root / 'ssh')
            connection.ensure_master = MagicMock()
            environment = {**os.environ, 'PATH': str(binary) + os.pathsep + os.defpath, 'HOME': str(root)}

            def local_ssh(command, **kwargs):
                return subprocess.run(['/bin/sh', '-c', command[-1]], env=environment,
                                      capture_output=True, text=True, timeout=kwargs.get('timeout'))

            if not modules:
                environment['PATH'] = str(scheduler_bin) + os.pathsep + environment['PATH']
                command_without_noise = local_ssh
                def local_ssh(command, **kwargs):
                    completed = command_without_noise(command, **kwargs)
                    completed.stdout = 'Welcome SSHrc banner\n' + completed.stdout + 'Farewell SSHrc banner\n'
                    return completed
            connection._run_ssh_tool = local_ssh
            connection.sftp_upload = lambda source, destination: shutil.copyfile(source, destination)
            profile = {
                'id': 'cluster-a', 'ownerId': 'owner-a', 'scheduler': scheduler,
                'storage': {'scratchRoot': str(root / 'scratch')},
                'runtime': {'environmentModules': ['scheduler/runtime'] if modules else []},
                'defaults': {'nodes': 1, 'ranksPerNode': 4, 'memoryMiBPerNode': 1024, 'wallSeconds': 300},
            }
            with patch.object(hpc_ssh, 'PYTHON_CANDIDATE_GLOBS', ()):
                yield root, called, connection, profile

    def test_green_slurm_probe_submits_and_polls_with_modules_and_login_noise(self):
        with self.fixture('slurm') as (root, called, connection, profile):
            probe = connection.probe_connection(modules=profile['runtime']['environmentModules'])
            self.assertTrue(probe['ok'], probe)
            self.assertTrue(probe['schedulers']['slurm'])
            manager = HpcRemoteJobManager(connection, profile)
            receipt = manager.submit_job('calc-1', {'input.json': '{}'}, root / 'receipts')
            self.assertEqual(receipt['state'], 'submitted')
            self.assertEqual(receipt['schedulerJobId'], '123')
            self.assertEqual(json.loads((root / 'receipts' / 'calc-1.json').read_text())['state'], 'submitted')
            status = manager.poll_job('123')
            self.assertEqual(status['state'], 'PENDING')
            self.assertFalse(status['terminal'])
            self.assertEqual(called.read_text().splitlines(), ['sbatch', 'sacct'])

    def test_green_pbs_probe_submits_and_parses_json_despite_module_and_login_noise(self):
        with self.fixture('pbs') as (root, called, connection, profile):
            probe = connection.probe_connection(modules=profile['runtime']['environmentModules'])
            self.assertTrue(probe['ok'], probe)
            self.assertTrue(probe['schedulers']['pbs'])
            manager = HpcRemoteJobManager(connection, profile)
            receipt = manager.submit_job('calc-1', {'input.json': '{}'}, root / 'receipts')
            self.assertEqual(receipt['schedulerJobId'], '123.cluster')
            status = manager.poll_job('123.cluster')
            self.assertEqual(status['state'], 'Q')
            self.assertFalse(status['terminal'])
            self.assertEqual(called.read_text().splitlines(), ['qsub', 'qstat'])

    def test_scheduler_framing_also_excludes_noise_without_modules(self):
        for scheduler in ('slurm', 'pbs'):
            with self.subTest(scheduler=scheduler), self.fixture(scheduler, modules=False) as (root, called, connection, profile):
                probe = connection.probe_connection()
                self.assertTrue(probe['ok'], probe)
                self.assertTrue(probe['schedulers'][scheduler])
                manager = HpcRemoteJobManager(connection, profile)
                receipt = manager.submit_job('calc-1', {'input.json': '{}'}, root / 'receipts')
                identifier = '123' if scheduler == 'slurm' else '123.cluster'
                self.assertEqual(receipt['schedulerJobId'], identifier)
                status = manager.poll_job(identifier)
                self.assertEqual(status['state'], 'PENDING' if scheduler == 'slurm' else 'Q')
                self.assertFalse(status['terminal'])


if __name__ == '__main__':
    unittest.main()
