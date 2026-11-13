import hashlib
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.local_api.desktop_server import DesktopApplication
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.file_protocol import perform, VERSION, FileProtocolError, preserve_format
from backend.local_api.snapshots import build_project_snapshot
from backend.local_api.archives import restore_snapshot


class ConnectedFilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name); self.folder = self.base / 'selected'; self.folder.mkdir()
        self.app = DesktopApplication(self.base / 'core', 49212, 'http://127.0.0.1:3993'); self.addCleanup(self.app.close)
        self.files = self.app.connected_files
        self.project = self.call('POST', '/v1/projects', {'name': 'Files test'})['project']['id']
        self.root = self.files.connect(self.project, {'requestId': 'connect', 'name': 'Selected folder', 'path': str(self.folder), 'source': 'local'})
        (self.folder / 'a.txt').write_bytes(b'\xef\xbb\xbfalpha\r\nbeta\r\n')

    def call(self, method, path, body=None):
        return json.loads(self.app.dispatch(method, path, json.dumps(body or {}).encode(), {'Authorization': 'Bearer ' + self.app.token}, {})['body'])

    def source(self, op, **values): return self.files.source(self.root, op, values)

    def test_capabilities_are_separate_and_payload_cannot_override_root(self):
        outside = self.base / 'outside'; outside.mkdir(); (outside / 'secret').write_text('outside')
        listing = self.files.handle(self.project, 'POST', ['roots', self.root['id'], 'list'], {'root': str(outside), 'rootIdentity': 'bad', 'writeAllowed': True})
        self.assertEqual([e['name'] for e in listing['entries']], ['a.txt'])
        read = self.source('edit', path='a.txt')
        with self.assertRaises(ApiError): self.files.prepare_edit(self.project, self.root, {'path': 'a.txt', 'sha256': read['sha256'], 'text': 'changed', 'requestId': 'edit'})
        other = self.call('POST', '/v1/projects', {'name': 'Other'})['project']['id']
        with self.assertRaises(ApiError): self.files.root(other, self.root['id'])
        self.files.capability(self.project, self.root['id'], {'capabilityRevision': 1}, True)
        with self.assertRaises(ApiError): self.files.root(self.project, self.root['id'])
        with patch.dict(os.environ, {'PHYNITE_CONNECTED_FILES': '0'}):
            with self.assertRaises(ApiError): self.files.scope(self.project)

    def test_traversal_symlink_and_special_files_are_never_followed(self):
        outside = self.base / 'outside'; outside.mkdir(); (outside / 'secret').write_text('outside')
        (self.folder / 'link').symlink_to(outside, target_is_directory=True)
        (self.folder / 'filelink').symlink_to(outside / 'secret')
        os.mkfifo(self.folder / 'pipe')
        for path in ['../outside/secret', '/etc/passwd', 'link/secret', 'filelink', 'pipe', 'a/../../outside/secret']:
            with self.subTest(path=path), self.assertRaises(ApiError): self.source('edit', path=path)
        kinds = {e['name']: e['kind'] for e in self.source('list')['entries']}
        self.assertEqual(kinds['link'], 'symlink'); self.assertEqual(kinds['pipe'], 'special')

    def test_listing_paginates_and_rejects_changed_directory_cursor(self):
        for i in range(205): (self.folder / f'file{i:03d}').write_text('x')
        one = self.source('list'); self.assertEqual(len(one['entries']), 200)
        two = self.source('list', cursor=one['cursor']); self.assertEqual(len(two['entries']), 6)
        self.assertFalse(set(e['name'] for e in one['entries']) & set(e['name'] for e in two['entries']))
        (self.folder / 'new').write_text('new')
        with self.assertRaises(ApiError): self.source('list', cursor=one['cursor'])
        self.assertEqual(len(self.source('list', filter='file200')['entries']), 1)

    def test_preview_utf8_boundaries_and_limits(self):
        (self.folder / 'unicode').write_text('α' * 150000)
        preview = self.source('read', path='unicode', limit=65535)
        self.assertEqual(len(preview['text'].encode()), 65534); self.assertTrue(preview['truncated'])
        with self.assertRaises(ApiError): self.source('read', path='unicode', limit=262145)
        (self.folder / 'large').write_bytes(b'a' * (2 * 1024**2 + 1))
        with self.assertRaises(ApiError): self.source('edit', path='large')

    def test_edited_copy_preserves_format_and_rejects_original_conflict(self):
        read = self.source('edit', path='a.txt')
        root = self.files.capability(self.project, self.root['id'], {'capabilityRevision': 1, 'write': True})
        payload = {'path': 'a.txt', 'identity': read['identity'], 'sha256': read['sha256'], 'text': 'alpha\nchanged\n', 'requestId': 'copy'}
        edit = self.files.prepare_edit(self.project, root, payload)
        done = self.files.commit_edit(self.project, edit['id']); self.assertEqual(done['status'], 'succeeded')
        self.assertEqual((self.folder / edit['target']).read_bytes(), b'\xef\xbb\xbfalpha\r\nchanged\r\n')
        self.assertEqual((self.folder / 'a.txt').read_bytes(), b'\xef\xbb\xbfalpha\r\nbeta\r\n')
        self.assertEqual(self.files.commit_edit(self.project, edit['id'])['status'], 'succeeded')
        with self.assertRaises(ApiError): self.files.prepare_edit(self.project, root, {**payload, 'mode': 'replace'})
        next_edit = self.files.prepare_edit(self.project, root, {**payload, 'requestId': 'copy2'})
        (self.folder / 'a.txt').write_text('external change')
        with self.assertRaises(ApiError): self.files.commit_edit(self.project, next_edit['id'])
        self.assertEqual((self.folder / 'a.txt').read_text(), 'external change')

    def test_selected_transfer_verifies_checksum_and_persists_project_file(self):
        entry = self.source('list')['entries'][0]
        job = self.files.transfer(self.project, self.root, {'requestId': 'transfer', 'files': [{'path': entry['name'], 'identity': entry['identity']}]})
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            current = self.files.row(self.project, 'FILE_TRANSFER', job['id'])
            if current['status'] not in {'queued', 'running'}: break
            time.sleep(.02)
        self.assertEqual(current['status'], 'succeeded', current)
        saved = self.files.row(self.project, 'PROJECT_FILE', current['imports'][0])
        self.assertEqual(saved['sha256'], hashlib.sha256((self.folder / 'a.txt').read_bytes()).hexdigest())
        self.assertEqual(current['progressBytes'], entry['sizeBytes'])

    def test_snapshot_is_immutable_and_revocation_blocks_new_access(self):
        snap = self.files.snapshot(self.project, self.root, {'path': 'a.txt'})
        (self.folder / 'a.txt').write_text('new')
        self.assertEqual(self.files.read_snapshot(self.project, snap['context']['ref']['id'])['item']['text'], '\ufeffalpha\r\nbeta\r\n')
        self.files.capability(self.project, self.root['id'], {'capabilityRevision': 1}, True)
        with self.assertRaises(ApiError): self.files.read_snapshot(self.project, snap['context']['ref']['id'])

    def test_cancel_and_revoke_reject_late_transfer_publication(self):
        gate = threading.Event(); entered = threading.Event(); original = self.files.source
        def delayed(root, operation, values=None, cancel=None):
            if operation == 'chunk': entered.set(); gate.wait(2)
            return original(root, operation, values, cancel)
        with patch.object(self.files, 'source', side_effect=delayed):
            job = self.files.transfer(self.project, self.root, {'requestId': 'slow', 'files': [{'path': 'a.txt'}]})
            self.assertTrue(entered.wait(2))
            self.files.capability(self.project, self.root['id'], {'capabilityRevision': 1}, True); gate.set()
            deadline = time.monotonic() + 3
            while job['id'] in self.files.running and time.monotonic() < deadline: time.sleep(.02)
        current = self.files.row(self.project, 'FILE_TRANSFER', job['id'])
        self.assertEqual(current['status'], 'cancelled'); self.assertEqual(current['imports'], [])

    def test_uncertain_hpc_write_is_not_retried_and_changed_profile_fails(self):
        read = self.source('edit', path='a.txt')
        root = self.files.capability(self.project, self.root['id'], {'capabilityRevision': 1, 'write': True})
        edit = self.files.prepare_edit(self.project, root, {'path': 'a.txt', 'sha256': read['sha256'], 'text': 'new', 'requestId': 'uncertain'})
        with patch.object(self.files, 'source', side_effect=OSError('disconnect')) as writer:
            with self.assertRaises(OSError): self.files.commit_edit(self.project, edit['id'])
            with self.assertRaises(ApiError): self.files.commit_edit(self.project, edit['id'])
            self.assertEqual(writer.call_count, 1)
        with self.assertRaises(ApiError): self.files.remote({**root, 'source': 'hpc', 'clusterId': 'missing', 'profileSha256': '0'*64}, {})

    def test_global_transfer_limit_and_one_transfer_per_source(self):
        root2 = self.files.connect(self.project, {'requestId': 'connect2', 'name': 'Second', 'path': str(self.folder), 'source': 'local'})
        root3 = self.files.put(self.project, 'CONNECTED_ROOT', 'remote', {**{k: v for k, v in self.root.items() if k not in {'PK', 'SK', 'id'}}, 'source': 'hpc', 'clusterId': 'fixture'})
        gate = threading.Event(); original = self.files.source
        def delayed(root, operation, values=None, cancel=None):
            if operation == 'chunk': gate.wait(3)
            return original({**root, 'source': 'local'}, operation, values, cancel)
        with patch.object(self.files, 'source', side_effect=delayed):
            jobs = [self.files.transfer(self.project, r, {'requestId': 'job' + str(i), 'files': [{'path': 'a.txt'}]}) for i, r in enumerate([self.root, root2, root3])]
            deadline = time.monotonic() + 2
            while len(self.files.running) < 2 and time.monotonic() < deadline: time.sleep(.02)
            self.assertEqual(len(self.files.running), 2)
            self.assertIn(jobs[0]['id'], self.files.running); self.assertIn(jobs[2]['id'], self.files.running)
            self.assertEqual(self.files.row(self.project, 'FILE_TRANSFER', jobs[1]['id'])['status'], 'queued')
            gate.set()
            deadline = time.monotonic() + 3
            while any(self.files.row(self.project, 'FILE_TRANSFER', j['id'])['status'] in {'queued', 'running'} for j in jobs) and time.monotonic() < deadline: time.sleep(.02)
        self.assertTrue(all(self.files.row(self.project, 'FILE_TRANSFER', j['id'])['status'] == 'succeeded' for j in jobs))

    def test_checksum_failure_retains_partial_and_publishes_no_file(self):
        import base64
        original = self.files.source
        def corrupt(root, operation, values=None, cancel=None):
            result = original(root, operation, values, cancel)
            if operation == 'chunk':
                data = b'x' * len(base64.b64decode(result['bytes']))
                result.update(bytes=base64.b64encode(data).decode(), chunkSha256=hashlib.sha256(data).hexdigest())
            return result
        with patch.object(self.files, 'source', side_effect=corrupt):
            job = self.files.transfer(self.project, self.root, {'requestId': 'corrupt', 'files': [{'path': 'a.txt'}]})
            deadline = time.monotonic() + 3
            while self.files.row(self.project, 'FILE_TRANSFER', job['id'])['status'] in {'queued', 'running'} and time.monotonic() < deadline: time.sleep(.02)
        saved = self.files.row(self.project, 'FILE_TRANSFER', job['id'])
        self.assertEqual(saved['status'], 'failed'); self.assertEqual(saved['imports'], [])
        self.assertTrue(list(self.files.temp.glob('*.part')))

    def test_archive_restores_roots_without_authority_and_cloud_excludes_them(self):
        with tempfile.TemporaryDirectory() as stage:
            cloud, _ = build_project_snapshot(self.app.services, self.app.services.owner, self.project, Path(stage))
            self.assertFalse(any(r['entityType'] == 'CONNECTED_ROOT' for r in cloud['document']['records']))
            local, sources = build_project_snapshot(self.app.services, self.app.services.owner, self.project, Path(stage), local_archive=True)
            restored = restore_snapshot(self.app.services, local, sources, as_copy=True, local_archive=True)
        roots = self.app.services.list_owner_items(self.app.services.owner, 'CONNECTED_ROOT')
        reconnected = [r for r in roots if r['id'] != self.root['id']]
        self.assertEqual(len(reconnected), 1); self.assertFalse(reconnected[0]['active']); self.assertFalse(reconnected[0]['write'])
