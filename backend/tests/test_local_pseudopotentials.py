"""Native SSSP setup preserves the selected model and verifies every download."""
from __future__ import annotations

from contextlib import ExitStack
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from backend.local_api.desktop_server import DesktopApplication
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.pseudopotentials import PseudopotentialManager, execution_pseudopotential_error
from backend.local_worker import install_pseudopotentials as installer


def qe_input(family='precision'):
    return f'ATOMIC_SPECIES\nSi 28.085 Si.pbe.sssp-{family}.upf\nATOMIC_POSITIONS crystal\nSi 0 0 0\nK_POINTS gamma\n'


class LocalPseudopotentialTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.metadata = self.root / 'metadata'; self.metadata.mkdir()
        self.content = b'UPF verification fixture, never presented as scientific output\n'
        self.license = b'Test license fixture\n'
        self.record = {'Si': {'filename': 'Si.fixture.UPF', 'md5': hashlib.md5(self.content).hexdigest()}}
        self.archive = self.make_archive([('Si.fixture.UPF', self.content)])
        for library in ('precision', 'efficiency'):
            (self.metadata / f'SSSP_1.3.0_PBE_{library}.json').write_text(json.dumps(self.record))
        stack = ExitStack(); self.addCleanup(stack.close)
        stack.enter_context(patch.object(installer, 'METADATA_ROOT', self.metadata))
        stack.enter_context(patch.object(installer, 'ARCHIVES', {name: (hashlib.md5(self.archive).hexdigest(), len(self.archive)) for name in ('precision', 'efficiency')}))
        stack.enter_context(patch.object(installer, 'ARCHIVE_SHA256', {name: hashlib.sha256(self.archive).hexdigest() for name in ('precision', 'efficiency')}))
        stack.enter_context(patch.object(installer, 'LICENSE_MD5', hashlib.md5(self.license).hexdigest()))
        stack.enter_context(patch.object(installer, 'LICENSE_SHA256', hashlib.sha256(self.license).hexdigest()))
        stack.enter_context(patch('backend.local_api.pseudopotentials.LICENSE_SHA256', hashlib.sha256(self.license).hexdigest()))
        self.opened = stack.enter_context(patch.object(installer, '_open', side_effect=lambda request: io.BytesIO(self.license if request.full_url.endswith('/LICENSE.txt/content') else self.archive)))

    def make_archive(self, entries):
        result = io.BytesIO()
        with tarfile.open(fileobj=result, mode='w:gz') as archive:
            for name, content in entries:
                entry = tarfile.TarInfo(name); entry.size = len(content)
                archive.addfile(entry, io.BytesIO(content))
        return result.getvalue()

    def install(self, library='precision'):
        installer.install_library(self.root / 'pseudopotentials', library)

    def test_verified_install_status_and_selected_model_checks(self):
        manager = PseudopotentialManager(self.root)
        self.assertFalse(manager.status()['libraries']['precision']['installed'])
        self.opened.assert_not_called()
        execution = {'qeInput': qe_input(), 'pseudopotentials': {}}
        self.assertIn('Precision', execution_pseudopotential_error(self.root, execution))
        self.install()
        self.assertTrue(manager.status()['libraries']['precision']['installed'])
        self.assertFalse(manager.status()['libraries']['efficiency']['installed'])
        self.assertIsNone(execution_pseudopotential_error(self.root, execution))
        self.assertIn('Efficiency', execution_pseudopotential_error(self.root, {'qeInput': qe_input('efficiency')}))
        self.assertEqual(installer.install_library(self.root / 'pseudopotentials', 'precision', check=True), 1)
        (self.root / 'pseudopotentials/sssp-pbe-precision/Si.fixture.UPF').write_bytes(b'corrupt')
        self.assertFalse(manager.status()['libraries']['precision']['installed'])
        self.assertIn('checksum', execution_pseudopotential_error(self.root, execution))
        # Explicitly uploaded UPFs are validated by the owned upload protocol.
        self.assertIsNone(execution_pseudopotential_error(self.root, {**execution, 'pseudopotentials': {'Si.pbe.sssp-precision.upf': 'owned-upload'}}))

    def test_failed_download_or_activation_keeps_existing_library(self):
        self.install()
        target = self.root / 'pseudopotentials/sssp-pbe-precision/Si.fixture.UPF'
        target.write_bytes(b'retained preexisting file')
        for failure in ('checksum', 'interrupted', 'activation'):
            with self.subTest(failure=failure):
                if failure == 'checksum':
                    manager = patch.object(installer, 'ARCHIVE_SHA256', {'precision': '0' * 64})
                elif failure == 'interrupted':
                    manager = patch.object(installer, '_open', side_effect=TimeoutError('Download interrupted'))
                else:
                    manager = patch.object(installer, '_activate_directory', side_effect=OSError('Disk full during activation'))
                with manager, patch.object(installer.time, 'sleep'), self.assertRaises((RuntimeError, OSError)):
                    self.install()
                self.assertEqual(target.read_bytes(), b'retained preexisting file')
                self.assertFalse(list((self.root / 'pseudopotentials').glob('.sssp-install-*')))
        self.install()
        self.assertEqual(target.read_bytes(), self.content)

    def test_unsafe_and_duplicate_archive_members_cannot_activate(self):
        for entries in ([('../Si.fixture.UPF', self.content)], [('Si.fixture.UPF', self.content), ('nested/Si.fixture.UPF', self.content)]):
            with self.subTest(entries=[name for name, _ in entries]):
                archive = self.make_archive(entries)
                with patch.object(installer, 'download', side_effect=lambda name, destination, *args, **kwargs: destination.write_bytes(self.license if name == 'LICENSE.txt' else archive)), self.assertRaises(RuntimeError):
                    self.install()
                self.assertFalse((self.root / 'pseudopotentials/sssp-pbe-precision').exists())
        (self.root / 'pseudopotentials/sssp-pbe-precision').symlink_to(self.root / 'outside', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'symbolic link'):
            self.install()

    def test_background_setup_reports_progress_failure_and_prevents_duplicates(self):
        manager = PseudopotentialManager(self.root)
        started, proceed = threading.Event(), threading.Event()
        def blocked_install(root, library, **kwargs):
            started.set(); proceed.wait(3)
            raise RuntimeError('Fixture network failure; previous library preserved')
        with patch('backend.local_api.pseudopotentials.install_library', side_effect=blocked_install):
            self.assertTrue(manager.begin('precision')); self.assertTrue(started.wait(2))
            self.assertFalse(manager.begin('efficiency'))
            self.assertEqual(manager.status()['progress']['library'], 'precision')
            proceed.set()
            for _ in range(100):
                if manager.status()['progress']['state'] == 'failed':
                    break
                time.sleep(.01)
        self.assertEqual(manager.status()['progress']['state'], 'failed')
        self.assertIn('network failure', manager.status()['progress']['error'])

    def test_web_installer_accepts_only_named_library_and_requires_local_auth(self):
        app = DesktopApplication(self.root / 'workspace', 49120, 'http://127.0.0.1:3000')
        self.addCleanup(app.close)
        headers = {'Authorization': 'Bearer ' + app.token}
        with patch.object(app.pseudopotentials, 'begin', return_value=True) as begin:
            for payload in ({'library': 'unknown'}, {'library': 'precision', 'url': 'https://example.test'}, []):
                with self.assertRaises(ApiError):
                    app.dispatch('POST', '/__local/pseudopotentials/install', json.dumps(payload).encode(), headers, {})
            with self.assertRaises(ApiError) as denied:
                app.dispatch('POST', '/__local/pseudopotentials/install', b'{"library":"precision"}', {}, {})
            self.assertEqual(denied.exception.status, 401)
            result = app.dispatch('POST', '/__local/pseudopotentials/install', b'{"library":"precision"}', headers, {})
            self.assertEqual(result['statusCode'], 202); begin.assert_called_once_with('precision')
            begin.return_value = False
            with self.assertRaises(ApiError) as busy:
                app.dispatch('POST', '/__local/pseudopotentials/install', b'{"library":"efficiency"}', headers, {})
            self.assertEqual(busy.exception.code, 'PSEUDOPOTENTIAL_INSTALL_BUSY')

    def test_missing_bundled_metadata_does_not_hide_runtime_status(self):
        app = DesktopApplication(self.root / 'workspace', 49120, 'http://127.0.0.1:3000')
        self.addCleanup(app.close)
        with patch.object(installer, 'METADATA_ROOT', self.root / 'missing-bundle'):
            result = app.dispatch('GET', '/__local/runtime', b'', {'Authorization': 'Bearer ' + app.token}, {})
        self.assertEqual(result['statusCode'], 200)
        status = json.loads(result['body'])
        self.assertIn('runtime', status)
        self.assertIn('capabilities', status)
        self.assertFalse(status['pseudopotentials']['libraries']['precision']['installed'])
        self.assertIn('Reinstall Phynite Lab', status['pseudopotentials']['libraries']['precision']['error'])

    def test_direct_cli_from_unrelated_directory_keeps_offline_check_usable(self):
        script = Path(installer.__file__).resolve()
        environment = {key: value for key, value in os.environ.items() if key != 'PYTHONPATH'}
        result = subprocess.run([sys.executable, str(script), '--library', 'precision', '--pseudo-root', str(self.root / 'not-installed'), '--check'],
                                cwd=self.root, env=environment, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 1)
        self.assertIn('library is incomplete', result.stderr)
        self.assertNotIn('ModuleNotFoundError', result.stderr)

    def test_download_redirects_allow_only_official_https_storage(self):
        redirect = installer._OfficialRedirect()
        request = installer.urllib.request.Request(installer.SOURCE + '/LICENSE.txt/content')
        approved = 'https://rgw.cscs.ch/mc-archive/approved/content'
        self.assertEqual(redirect.redirect_request(request, None, 302, 'Found', {}, approved).full_url, approved)
        for url in ('https://example.test/file', 'http://rgw.cscs.ch/mc-archive/file', 'https://rgw.cscs.ch/elsewhere/file', 'https://user:secret@rgw.cscs.ch/mc-archive/file'):
            with self.subTest(url=url), self.assertRaises(RuntimeError):
                redirect.redirect_request(request, None, 302, 'Found', {}, url)


if __name__ == '__main__':
    unittest.main()
