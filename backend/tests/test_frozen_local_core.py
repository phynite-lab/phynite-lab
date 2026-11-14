"""Opt-in acceptance of the built executable without a checkout or Python on PATH."""
from __future__ import annotations

import hashlib
import json
import os
import platform
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


CORE = os.environ.get('PHYNITE_TEST_FROZEN_CORE')


@unittest.skipUnless(CORE, 'Build the actual frozen core and set PHYNITE_TEST_FROZEN_CORE to run distribution acceptance.')
class FrozenLocalCoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='phynite-frozen-acceptance-')
        self.addCleanup(self.directory.cleanup)
        self.data = Path(self.directory.name)
        (self.data / 'empty-path').mkdir()
        self.process = None
        self.addCleanup(self.stop_core)
        self.start_core()

    def start_core(self):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); self.port = probe.getsockname()[1]
        self.origin = f'http://127.0.0.1:{self.port}'
        environment = {key: value for key, value in os.environ.items() if not key.startswith(('AWS_', 'PHYNITE_', 'PYTHON'))}
        environment['PATH'] = str(self.data / 'empty-path')
        self.process = subprocess.Popen([str(Path(CORE).resolve()), '--data-dir', str(self.data), '--port', str(self.port), '--ui-origin', 'http://127.0.0.1:3000'], cwd=self.data, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        # The real one-file executable first extracts its native interpreter and
        # dependencies. Measured cold startup on macOS arm64 is 15.3s, beyond the
        # former 10s loop even though subsequent starts take 3.8–6.2s. Allow a
        # bounded cold startup while still failing immediately on early exit.
        started = time.monotonic()
        deadline = started + 60
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                output, errors = self.process.communicate()
                self.fail(f'Frozen core failed to start: {output}\n{errors}')
            try:
                if self.request('/__local/health', authenticated=False, timeout=.5)[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(.05)
        else:
            self.stop_core()
            self.fail(f'The frozen core did not become ready within 60s: {self.diagnostics[-4000:]}')
        service = json.loads((self.data / 'core-service.json').read_text())
        self.token = service['token']
        self.assertEqual(service['origin'], self.origin)
        self.assertEqual((self.data / 'core-service.json').stat().st_mode & 0o777, 0o600)

    def stop_core(self):
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
            try:
                output, errors = self.process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill(); output, errors = self.process.communicate(timeout=5)
            self.diagnostics = output + '\n' + errors

    def request(self, path, method='GET', payload=None, authenticated=True, headers=None, timeout=3):
        request_headers = {'Content-Type': 'application/json', **(headers or {})}
        if authenticated:
            request_headers['Authorization'] = 'Bearer ' + self.token
        request = Request(self.origin + path, data=json.dumps(payload).encode() if payload is not None else None, method=method, headers=request_headers)
        try:
            result = urlopen(request, timeout=timeout)
        except HTTPError as error:
            result = error
        with result:
            return result.status, json.load(result)

    def test_opaque_local_session_and_projects_survive_process_restart(self):
        self.assertEqual(self.request('/v1/projects', authenticated=False)[0], 401)
        self.assertEqual(self.request('/__local/health', authenticated=False, headers={'Host': 'attacker.invalid'})[0], 403)
        status, session = self.request('/__local/session')
        self.assertEqual(status, 200); self.assertEqual(session['mode'], 'local'); self.assertFalse(session['authenticated']); self.assertFalse(session['cloud']['authenticated'])
        owner = session['user']['id']
        status, created = self.request('/v1/projects', 'POST', {'name': 'Frozen core persistence test'})
        self.assertEqual(status, 201)
        project_id = created['project']['id']
        self.stop_core(); self.start_core()
        self.assertEqual(self.request('/__local/session')[1]['user']['id'], owner)
        projects = self.request('/v1/projects')[1]['projects']
        self.assertTrue(any(project['id'] == project_id for project in projects))

    def test_frozen_scientific_compiler_data_is_available_without_source_checkout(self):
        status, created = self.request('/v1/projects', 'POST', {'name': 'Frozen compiler package test'})
        self.assertEqual(status, 201)
        project = created['project']['id']
        graph = {'version': 1, 'projectId': project, 'nodes': [{'id': 'scf-node', 'kind': 'scf', 'name': 'Draft SCF', 'configuration': {'compilerVersion': 1}, 'position': {'x': 0, 'y': 0}, 'resources': []}], 'edges': [], 'groups': []}
        self.assertEqual(self.request(f'/v1/projects/{project}/workflow', 'PUT', {'baseRevision': 0, 'workflow': graph})[0], 200)
        status, plan = self.request(f'/v1/projects/{project}/workflow/plan', 'POST', {'revision': 1, 'targets': ['scf-node']})
        self.assertIn(status, (200, 422), plan)
        self.assertNotEqual(plan.get('code'), 'WORKFLOW_COMPILER_UNAVAILABLE')
        if status == 200:
            self.assertRegex(plan['plan']['compilerSha256'], r'^[a-f0-9]{64}$')

    def test_frozen_files_helper_supports_reviewed_edited_copies_without_source_checkout(self):
        folder = self.data / 'selected-folder'
        folder.mkdir()
        original = b'\xef\xbb\xbfalpha\r\nbeta\r\n'
        (folder / 'source.txt').write_bytes(original)
        status, created = self.request('/v1/projects', 'POST', {'name': 'Frozen files helper test'})
        self.assertEqual(status, 201)
        base = '/__local/files/' + created['project']['id']
        status, connected = self.request(base, 'POST', {'requestId': 'connect', 'source': 'local', 'name': 'Selected folder', 'path': str(folder)})
        self.assertEqual(status, 200, connected)
        root = connected['root']
        root_path = base + '/roots/' + root['id']
        status, listing = self.request(root_path + '/list', 'POST', {})
        self.assertEqual(status, 200, listing)
        self.assertEqual([entry['name'] for entry in listing['entries']], ['source.txt'])
        status, before = self.request(root_path + '/edit', 'POST', {'path': 'source.txt'})
        self.assertEqual(status, 200, before)
        self.assertEqual(before['sha256'], hashlib.sha256(original).hexdigest())
        status, writable = self.request(root_path, 'PUT', {'capabilityRevision': root['capabilityRevision'], 'write': True})
        self.assertEqual(status, 200, writable)
        status, qualified = self.request(root_path + '/qualify', 'POST', {'capabilityRevision': writable['root']['capabilityRevision']})
        self.assertEqual(status, 200, qualified)
        self.assertTrue(qualified['root']['replaceQualified'])
        helper = Path(__file__).resolve().parents[1] / 'local_api/file_protocol.py'
        self.assertEqual(qualified['root']['replacementQualification']['helperSha256'], hashlib.sha256(helper.read_bytes()).hexdigest())
        status, prepared = self.request(root_path + '/prepare', 'POST', {'path': 'source.txt', 'identity': before['identity'], 'sha256': before['sha256'], 'text': 'alpha\nchanged\n', 'requestId': 'copy'})
        self.assertEqual(status, 200, prepared)
        self.assertEqual(prepared['edit']['mode'], 'copy')
        status, saved = self.request(base + '/edits/' + prepared['edit']['id'], 'POST', {})
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['edit']['status'], 'succeeded')
        self.assertEqual((folder / prepared['edit']['target']).read_bytes(), b'\xef\xbb\xbfalpha\r\nchanged\r\n')
        self.assertEqual((folder / 'source.txt').read_bytes(), original)

    @unittest.skipUnless(platform.system() == 'Darwin', 'Linux sandbox is qualified after packaging its verified bootstrap.')
    def test_frozen_runtime_verifies_real_macos_isolation_with_empty_path(self):
        status, runtime = self.request('/__local/runtime', timeout=20)
        self.assertEqual(status, 200)
        isolation = runtime['runtime']['isolation']
        self.assertTrue(isolation['available'], isolation)
        self.assertEqual(isolation['kind'], 'macos-seatbelt')


if __name__ == '__main__':
    unittest.main()
