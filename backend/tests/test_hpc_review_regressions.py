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
from backend.local_worker.hpc_remote import HpcRemoteJobManager, HpcRemoteWorker, profile_sha256


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
            worker = HpcRemoteWorker(client, 'worker-a', 'cluster-a', checksum, workspace_builder=builder)
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


if __name__ == '__main__':
    unittest.main()
