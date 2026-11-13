import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.local_api.desktop_server import DesktopApplication
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.notes import ProjectNotes, content
from backend.local_api.snapshots import build_project_snapshot
from backend.local_api.archives import restore_snapshot


class ProjectNotesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.app = DesktopApplication(Path(self.directory.name), 49210, 'http://127.0.0.1:3991'); self.addCleanup(self.app.close)
        self.owner = self.app.services.owner; self.notes = ProjectNotes(self.app.services)
        self.project = self.call('POST', '/v1/projects', {'name': 'Notes test'})['project']['id']

    def call(self, method, path, body=None):
        result = self.app.dispatch(method, path, json.dumps(body or {}).encode(), {'Authorization': 'Bearer ' + self.app.token}, {})
        return json.loads(result['body'])

    def create(self, text='α first\n\nβ second'):
        return self.notes.create(self.owner, self.project, {'requestId': 'create', 'name': 'Research', 'text': text})

    def save(self, note, text, request='save'):
        return self.notes.save(self.owner, self.project, note['note']['id'], {'requestId': request, 'baseRevision': note['note']['head'], 'text': text})

    def test_immutable_revision_and_conflict_retain_each_editor_draft(self):
        first = self.create(); key = first['note']['id']
        draft = {'editorId': 'editor1', 'baseRevision': first['note']['head'], 'sequence': 1, 'text': 'my uncommitted draft', 'name': 'My draft'}
        self.notes.draft(self.owner, self.project, key, draft)
        second = self.save(first, 'another editor checkpoint')
        self.assertEqual(self.notes.revision(self.owner, self.project, first['note']['head'])['text'], first['revision']['text'])
        with self.assertRaises(ApiError) as caught: self.save(first, 'attempt to overwrite', 'conflict')
        self.assertEqual(caught.exception.code, 'NOTE_CONFLICT')
        self.assertEqual(self.notes.get(self.owner, self.project, key)['note']['head'], second['note']['head'])
        retained = self.notes.drafts(self.owner, self.project, key)['drafts'][0]
        self.assertEqual(retained['text'], draft['text']); self.assertEqual(retained['name'], 'My draft')
        with self.assertRaises(ApiError): self.notes.draft(self.owner, self.project, key, {**draft, 'text': 'late duplicate'})
        self.assertEqual(self.save(first, 'another editor checkpoint')['revision']['id'], second['revision']['id'])

    def test_hunks_rebase_independently_and_external_edits_invalidate(self):
        first = self.create(); key = first['note']['id']
        p = self.notes.propose(self.owner, self.project, {'noteId': key, 'baseRevision': first['note']['head'], 'toolCallId': 'call1', 'hunks': [{'before': 'α first', 'after': 'α longer first part', 'reason': 'clarify'}, {'before': 'β second', 'after': 'β verified second', 'reason': 'evidence'}]}, {'kind': 'ai', 'runId': 'run1'})
        one = self.notes.decide(self.owner, self.project, key, {'proposalId': p['id'], 'hunkId': p['hunks'][0]['id'], 'decision': 'accepted', 'editorId': 'editor1'})
        two = self.notes.decide(self.owner, self.project, key, {'proposalId': p['id'], 'hunkId': p['hunks'][1]['id'], 'decision': 'accepted', 'editorId': 'editor1'})
        self.assertEqual(two['revision']['text'], 'α longer first part\n\nβ verified second')
        self.assertEqual(two['revision']['author']['id'], self.owner)
        self.assertEqual(two['revision']['provenance']['runId'], 'run1')
        self.assertEqual(two['proposal']['status'], 'complete')
        self.assertNotEqual(one['note']['head'], two['note']['head'])
        p2 = self.notes.propose(self.owner, self.project, {'noteId': key, 'baseRevision': two['note']['head'], 'toolCallId': 'call2', 'hunks': [{'before': 'α longer', 'after': 'α changed', 'reason': 'review'}]}, {'kind': 'ai', 'runId': 'run2'})
        self.save(two, 'outside edit', 'outside')
        with self.assertRaises(ApiError) as caught: self.notes.decide(self.owner, self.project, key, {'proposalId': p2['id'], 'hunkId': p2['hunks'][0]['id'], 'decision': 'accepted', 'editorId': 'editor1'})
        self.assertEqual(caught.exception.code, 'NOTE_PROPOSAL_STALE')

    def test_dirty_editor_stopped_run_and_steering_block_acceptance(self):
        first = self.create(); key = first['note']['id']
        p = self.notes.propose(self.owner, self.project, {'noteId': key, 'baseRevision': first['note']['head'], 'toolCallId': 'call1', 'hunks': [{'before': 'α first', 'after': 'α result', 'reason': 'review'}]}, {'kind': 'ai', 'runId': 'run1', 'controlRevision': 0})
        self.notes.draft(self.owner, self.project, key, {'editorId': 'editor1', 'baseRevision': first['note']['head'], 'sequence': 1, 'text': 'typing'})
        decision = {'proposalId': p['id'], 'hunkId': p['hunks'][0]['id'], 'decision': 'accepted', 'editorId': 'editor1'}
        with self.assertRaises(ApiError) as caught: self.notes.decide(self.owner, self.project, key, decision)
        self.assertEqual(caught.exception.code, 'NOTE_DIRTY_DRAFT')
        self.notes.put(self.owner, self.project, 'AI_RUN', 'run1', {'status': 'stopped', 'controlRevision': 0})
        with self.assertRaises(ApiError) as caught: self.notes.decide(self.owner, self.project, key, decision)
        self.assertEqual(caught.exception.code, 'NOTE_PROPOSAL_STALE')

    def test_snapshots_freeze_unicode_selection_and_scope(self):
        first = self.create('😀α first\r\nβ second'); key = first['note']['id']
        snap = self.notes.attach(self.owner, self.project, key, {'baseRevision': first['note']['head'], 'selection': {'start': 1, 'end': 8}})
        self.save(first, 'latest')
        source = self.notes.row(self.owner, self.project, 'NOTE_CONTEXT', snap['context']['ref']['id'])
        self.assertEqual(self.notes.read(source)['text'], 'α first')
        other = self.call('POST', '/v1/projects', {'name': 'Other'})['project']['id']
        with self.assertRaises(ApiError): self.notes.get(self.owner, other, key)
        with self.assertRaises(ApiError): self.notes.get('another-owner', self.project, key)
        with patch.dict(os.environ, {'PHYNITE_PROJECT_NOTES': '0'}):
            with self.assertRaises(ApiError): self.notes.list(self.owner, self.project)

    def test_notes_archive_locally_and_never_cloud_sync(self):
        first = self.create(); key = first['note']['id']
        self.notes.draft(self.owner, self.project, key, {'editorId': 'editor1', 'baseRevision': first['note']['head'], 'sequence': 1, 'text': 'retained draft'})
        with tempfile.TemporaryDirectory() as stage:
            cloud, _ = build_project_snapshot(self.app.services, self.owner, self.project, Path(stage))
            restore_snapshot(self.app.services, cloud, {}, as_copy=False)
            self.assertEqual(self.notes.get(self.owner, self.project, key)['note']['head'], first['note']['head'])
            local, sources = build_project_snapshot(self.app.services, self.owner, self.project, Path(stage), local_archive=True)
        self.assertFalse(any(r['entityType'].startswith(('NOTE_', 'PROJECT_NOTE')) for r in cloud['document']['records']))
        self.assertEqual(sum(r['entityType'] in {'PROJECT_NOTE', 'NOTE_REVISION', 'NOTE_DRAFT'} for r in local['document']['records']), 3)
        self.assertEqual(len(sources), 2)
        exported = self.app.archives.export(self.project)
        self.assertTrue(exported)

    def test_limits_and_failed_disk_do_not_advance_head(self):
        first = self.create()
        with self.assertRaises(ApiError): content('α' * (512 * 1024 + 1))
        with self.assertRaises(ApiError): content('![a](data:image/png;base64,AAAA)')
        with patch.object(self.app.services.s3, 'put_object', side_effect=OSError('disk full')):
            with self.assertRaises(OSError): self.save(first, 'not saved')
        self.assertEqual(self.notes.get(self.owner, self.project, first['note']['id'])['note']['head'], first['note']['head'])

    def test_old_archive_cannot_overwrite_newer_editor_draft(self):
        first = self.create(); key = first['note']['id']
        draft = {'editorId': 'editor1', 'baseRevision': first['note']['head'], 'sequence': 1, 'text': 'old draft', 'name': 'Research'}
        self.notes.draft(self.owner, self.project, key, draft)
        with tempfile.TemporaryDirectory() as stage:
            archive, sources = build_project_snapshot(self.app.services, self.owner, self.project, Path(stage), local_archive=True)
            self.notes.draft(self.owner, self.project, key, {**draft, 'sequence': 2, 'text': 'latest typing'})
            with self.assertRaises(ApiError): restore_snapshot(self.app.services, archive, sources, local_archive=True)
        self.assertEqual(self.notes.drafts(self.owner, self.project, key)['drafts'][0]['text'], 'latest typing')
