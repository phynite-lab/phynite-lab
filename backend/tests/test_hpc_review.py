"""PR79 regression fixtures exercise real shell and archive boundaries, without HPC."""
from __future__ import annotations
import hashlib
import io
import json
import os
import shlex
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from backend.local_worker.hpc_ssh import HpcSshConnection, HpcSshError
from backend.local_worker.hpc_remote import HpcRemoteJobManager, HpcError
from backend.tests.test_compute_fallbacks import _load_compute_modules


class VenvSetupTests(unittest.TestCase):
    def test_real_shell_transport_creates_then_reuses_private_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / 'base-python'
            # Protocol fixture, not a real scientific package qualification.
            base.write_text(f'#!{sys.executable}\n' + '''import pathlib, shutil, sys
root = pathlib.Path(__file__).resolve().parent
if sys.argv[1:3] == ['-m', 'venv']:
    target = pathlib.Path(sys.argv[3]); (target / 'bin').mkdir(parents=True)
    (target / 'pyvenv.cfg').write_text('fixture')
    shutil.copyfile(__file__, target / 'bin/python'); (target / 'bin/python').chmod(0o700)
elif sys.argv[1:3] == ['-m', 'pip']:
    (root / 'installed').write_text(' '.join(sys.argv))
elif 'importlib' in sys.argv[-1]:
    print('3.12.1|' + ('' if (root / 'installed').exists() else 'numpy'))
''')
            base.chmod(0o700)
            conn = HpcSshConnection('login.example', 'researcher', control_dir=root / 'ssh')
            commands = []
            def run(cmd, **kwargs):
                commands.append(cmd)
                self.assertTrue(all(not any(ord(c) < 32 for c in value) for value in cmd))
                return subprocess.run(['sh', '-c', cmd[-1]], input=kwargs['input'], text=True,
                                      capture_output=True, timeout=10, env={**os.environ, 'HOME': str(root)})
            with patch.object(conn, 'ensure_master'), patch.object(conn, '_run_ssh_tool', side_effect=run):
                first = conn.setup_python_venv(base_python=str(base))
                self.assertTrue(first['ok'], first)
                self.assertFalse(first['alreadyConfigured'])
                second = conn.setup_python_venv(base_python=str(base))
                self.assertTrue(second['alreadyConfigured'], second)
            target = root / '.phynite-venv'
            self.assertEqual(first['pythonExecutable'], str(target / 'bin/python'))
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)
            self.assertFalse((root / '.phynite-venv.phynite-setup.lock').exists())
            self.assertIn('--no-input', (target / 'bin/installed').read_text())
            self.assertEqual(len(commands), 2)

    def test_invalid_paths_or_package_flags_never_reach_ssh(self):
        conn = HpcSshConnection('login.example', 'researcher')
        for arguments in ({'venv_path': '../escape'}, {'venv_path': '/path with spaces'},
                          {'base_python': 'python3'}, {'packages': ['--target=/tmp']}, {'venv_path': 3}):
            with self.subTest(arguments=arguments), patch.object(conn, '_run_ssh_tool') as ssh:
                with self.assertRaises(HpcSshError): conn.setup_python_venv(**arguments)
                ssh.assert_not_called()

    def test_unmanaged_directory_is_not_modified(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); target = root / '.phynite-venv'; target.mkdir()
            keep = target / 'research.txt'; keep.write_text('preserve')
            conn = HpcSshConnection('login.example', 'researcher', control_dir=root / 'ssh')
            def run(cmd, **kwargs):
                return subprocess.run(['sh', '-c', cmd[-1]], input=kwargs['input'], text=True,
                                      capture_output=True, timeout=10, env={**os.environ, 'HOME': str(root)})
            with patch.object(conn, 'ensure_master'), patch.object(conn, '_run_ssh_tool', side_effect=run):
                result = conn.setup_python_venv(base_python=sys.executable)
            self.assertFalse(result['ok']); self.assertIn('unmanaged', result['error'])
            self.assertEqual(keep.read_text(), 'preserve')


class RemoteScfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _load_compute_modules()
        import workflow_scf
        cls.scf = workflow_scf

    def fixture(self, root):
        archive = root / 'dependency-0.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            for name, data in {'scf-state.json': b'{}', 'tmp/qe.save/charge-density.dat': b'fixture', 'evidence/scf.out': b'log'}.items():
                member = tarfile.TarInfo(name); member.size = len(data)
                bundle.addfile(member, io.BytesIO(data))
        reference = {'calculationId': 'source', 'bundleSha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
        return archive, reference

    def test_remote_copy_requires_exact_bundle_and_keeps_unrelated_dependencies(self):
        for remote_code in (0, 1):
            with self.subTest(remote_code=remote_code), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); archive, reference = self.fixture(root)
                conn = MagicMock(spec=HpcSshConnection)
                conn.run_command.side_effect = lambda argv: (remote_code if argv[0] == 'sh' else 0, '', '')
                profile = {'scheduler': 'slurm', 'ownerId': 'owner', 'storage': {'scratchRoot': '/scratch'},
                           'runtime': {'pythonExecutable': '/usr/bin/python3'}}
                manager = HpcRemoteJobManager(conn, profile)
                manager._scheduler_command = MagicMock(return_value=(0, '123', ''))
                inputs = {'input.json': json.dumps({'settings': {'sharedScf': reference}}),
                          'dependency-0.tar.gz': archive, 'dependencies/scf/scf-state.json': '{}',
                          'dependency-1.tar.gz': b'another dependency', 'pseudo/Si.UPF': b'fixture'}
                receipt = manager.submit_job('target', inputs, root / 'receipts')
                uploads = [call.args[1] for call in conn.sftp_upload.call_args_list]
                self.assertEqual(receipt['remoteScratchRetained'], remote_code == 0)
                self.assertEqual(any(name.endswith('dependency-0.tar.gz') for name in uploads), remote_code != 0)
                self.assertTrue(any(name.endswith('dependency-1.tar.gz') for name in uploads))
                self.assertTrue(any(name.endswith('pseudo/Si.UPF') for name in uploads))
                script = manager.render_remote_script('target', '/scratch/owner/target')
                self.assertEqual('stage_remote_scf_archive' in script, remote_code == 0)
                self.assertNotIn('fused', script.lower())
                manager._scheduler_command.assert_called_once_with(['sbatch', '--parsable', '/scratch/owner/target/submit.sh'])

    def test_bad_local_checksum_blocks_submission(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); archive, reference = self.fixture(root)
            reference['bundleSha256'] = '0' * 64
            conn = MagicMock(spec=HpcSshConnection); conn.run_command.return_value = (0, '', '')
            manager = HpcRemoteJobManager(conn, {'scheduler': 'slurm'})
            with self.assertRaisesRegex(HpcError, 'checksum'):
                manager.submit_job('target', {'input.json': json.dumps({'settings': {'sharedScf': reference}}), 'dependency-0.tar.gz': archive}, root / 'receipts')
            self.assertFalse(list((root / 'receipts').iterdir()))

    def test_extracts_private_state_and_rejects_changed_bundle(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); archive, reference = self.fixture(root)
            self.scf.stage_remote_scf_archive(root, reference)
            self.assertEqual((root / 'dependencies/scf/tmp/qe.save/charge-density.dat').read_bytes(), b'fixture')
            with self.assertRaisesRegex(ValueError, 'fresh'): self.scf.stage_remote_scf_archive(root, reference)
            archive.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum'): self.scf.stage_remote_scf_archive(root, reference)

    def test_unsafe_archives_are_rejected_even_when_checksum_matches(self):
        for name, kind in (('../escape', tarfile.REGTYPE), ('tmp/link', tarfile.SYMTYPE), ('/absolute', tarfile.REGTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); archive = root / 'dependency-0.tar.gz'
                with tarfile.open(archive, 'w:gz') as bundle:
                    member = tarfile.TarInfo(name); member.type = kind; member.linkname = '/tmp'
                    bundle.addfile(member)
                with self.assertRaisesRegex(ValueError, 'unsafe'):
                    self.scf.stage_remote_scf_archive(root, {'bundleSha256': hashlib.sha256(archive.read_bytes()).hexdigest()})
                self.assertFalse((root / 'dependencies').exists())
