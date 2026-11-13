"""Project Notes: immutable checkpoints, independent editor drafts, reviewed AI hunks."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from typing import Any

from .domain.phynite_core import ApiError, owner_partition, public_item, require_project, storage_owner, utc_now

MAX_NOTE_BYTES = 1024 * 1024
NOTE_KINDS = {'PROJECT_NOTE', 'NOTE_REVISION', 'NOTE_DRAFT', 'NOTE_PROPOSAL'}


def invalid(message: str, code: str = 'NOTE_INVALID', status: int = 400):
    raise ApiError(status, message, code)


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
        invalid('Choose a valid note, revision, or editor identity.')
    return value


def content(value: Any) -> bytes:
    if not isinstance(value, str):
        invalid('Notes must contain UTF-8 Markdown text.')
    try:
        data = value.encode('utf-8')
    except UnicodeError:
        invalid('Notes must contain valid UTF-8 text.')
    if len(data) > MAX_NOTE_BYTES:
        invalid('A note can contain at most 1 MiB of UTF-8 text.', status=413)
    if re.search(r'data\s*:\s*image/[^\s)]*base64', value, re.I):
        invalid('Attach an image as a project artifact; inline base64 images are not supported.')
    return data


class ProjectNotes:
    def __init__(self, services):
        self.s = services

    def scope(self, owner: str, project: str):
        if os.environ.get('PHYNITE_PROJECT_NOTES', '1') == '0':
            invalid('Project Notes is disabled for this workspace.', 'NOTES_DISABLED', 404)
        require_project(self.s, owner, project)

    def row(self, owner: str, project: str, kind: str, key: str) -> dict:
        self.scope(owner, project)
        row = self.s.get_item(owner, kind, identifier(key))
        if not row or row.get('projectId') != project:
            invalid('This note source is not in the selected project.', 'NOTE_NOT_FOUND', 404)
        return row

    def put(self, owner: str, project: str, kind: str, key: str, values: dict) -> dict:
        row = {'PK': owner_partition(owner), 'SK': kind + '#' + key, 'entityType': kind, 'id': key, 'ownerId': owner, 'projectId': project, **values}
        self.s.put_item(row)
        return row

    def store(self, owner: str, project: str, text: str) -> dict:
        data = content(text)
        sha = hashlib.sha256(data).hexdigest()
        key = f'users/{storage_owner(owner)}/projects/{project}/notes/{sha}.md'
        self.s.s3.put_object(Bucket=self.s.bucket, Key=key, Body=data, ContentType='text/markdown; charset=utf-8')
        return {'objectKey': key, 'sha256': sha, 'sizeBytes': len(data)}

    def read(self, row: dict) -> dict:
        with self.s.s3.get_object(Bucket=self.s.bucket, Key=row['objectKey'])['Body'] as stream:
            data = stream.read(MAX_NOTE_BYTES + 1)
        if len(data) != row['sizeBytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
            invalid('The saved note checksum failed. Keep the browser draft and restore a verified revision.', 'NOTE_CHECKSUM', 409)
        return {**public_item(row), 'text': data.decode('utf-8')}

    def list(self, owner: str, project: str) -> dict:
        self.scope(owner, project)
        return {'notes': [public_item(r) for r in self.s.list_owner_items(owner, 'PROJECT_NOTE') if r.get('projectId') == project]}

    def create(self, owner: str, project: str, payload: dict) -> dict:
        self.scope(owner, project)
        request = identifier(payload.get('requestId'))
        key = 'note_' + hashlib.sha256((project + ':' + request).encode()).hexdigest()[:32]
        name = payload.get('name', 'Untitled note')
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            invalid('Give this note a title of 1–200 characters.')
        text = payload.get('text', '')
        blob = self.store(owner, project, text)
        with self.s.table.atomic():
            previous = self.s.get_item(owner, 'PROJECT_NOTE', key)
            if previous:
                initial = self.row(owner, project, 'NOTE_REVISION', previous['initialRevision'])
                if initial['sha256'] != blob['sha256'] or initial['name'] != name.strip():
                    invalid('This request identity was already used for another note.', 'NOTE_IDEMPOTENCY', 409)
                return self.get(owner, project, key)
            revision = 'nrev_' + secrets.token_hex(16)
            now = utc_now()
            self.put(owner, project, 'NOTE_REVISION', revision, {**blob, 'noteId': key, 'name': name.strip(), 'parentRevision': None, 'revision': 1, 'author': {'kind': 'user', 'id': owner}, 'createdAt': now})
            self.put(owner, project, 'PROJECT_NOTE', key, {'name': name.strip(), 'head': revision, 'initialRevision': revision, 'revision': 1, 'sha256': blob['sha256'], 'createdAt': now, 'updatedAt': now})
        return self.get(owner, project, key)

    def get(self, owner: str, project: str, key: str) -> dict:
        note = self.row(owner, project, 'PROJECT_NOTE', key)
        return {'note': public_item(note), 'revision': self.read(self.row(owner, project, 'NOTE_REVISION', note['head']))}

    def revision(self, owner: str, project: str, key: str) -> dict:
        return self.read(self.row(owner, project, 'NOTE_REVISION', key))

    def drafts(self, owner: str, project: str, key: str) -> dict:
        self.row(owner, project, 'PROJECT_NOTE', key)
        return {'drafts': [self.read(r) for r in self.s.list_owner_items(owner, 'NOTE_DRAFT') if r.get('projectId') == project and r.get('noteId') == key]}

    def draft(self, owner: str, project: str, key: str, payload: dict) -> dict:
        self.row(owner, project, 'PROJECT_NOTE', key)
        editor = identifier(payload.get('editorId'))
        base = self.row(owner, project, 'NOTE_REVISION', payload.get('baseRevision'))
        if base['noteId'] != key:
            invalid('The draft base is not a revision of this note.')
        seq = payload.get('sequence')
        if type(seq) is not int or not 0 < seq <= 2**53 - 1:
            invalid('Draft sequence must be a positive safe integer.')
        blob = self.store(owner, project, payload.get('text'))
        draft_id = 'ndraft_' + hashlib.sha256((key + ':' + editor).encode()).hexdigest()[:32]
        with self.s.table.atomic():
            previous = self.s.get_item(owner, 'NOTE_DRAFT', draft_id)
            if previous and (previous['sequence'] > seq or previous['sequence'] == seq and (previous['sha256'] != blob['sha256'] or previous['baseRevision'] != base['id'])):
                invalid('A newer draft is already stored for this editor. Keep this text and save a copy.', 'NOTE_DRAFT_CONFLICT', 409)
            row = self.put(owner, project, 'NOTE_DRAFT', draft_id, {**blob, 'noteId': key, 'editorId': editor, 'baseRevision': base['id'], 'name': str(payload.get('name', ''))[:200], 'sequence': seq, 'updatedAt': utc_now()})
            head = self.row(owner, project, 'PROJECT_NOTE', key)['head']
        return {'draft': public_item(row), 'conflict': head != base['id']}

    def save(self, owner: str, project: str, key: str, payload: dict, *, provenance: dict | None = None) -> dict:
        self.scope(owner, project)
        request = identifier(payload.get('requestId'))
        if 'name' in payload and (not isinstance(payload['name'], str) or not payload['name'].strip() or len(payload['name']) > 200):
            invalid('Give this note a title of 1–200 characters.')
        blob = self.store(owner, project, payload.get('text'))
        revision_id = 'nrev_' + hashlib.sha256((key + ':' + request).encode()).hexdigest()[:32]
        with self.s.table.atomic():
            note = self.row(owner, project, 'PROJECT_NOTE', key)
            previous = self.s.get_item(owner, 'NOTE_REVISION', revision_id)
            if previous:
                if previous['sha256'] != blob['sha256'] or previous['parentRevision'] != payload.get('baseRevision') or previous['name'] != payload.get('name', previous['name']).strip():
                    invalid('This Save identity was already used for different text.', 'NOTE_IDEMPOTENCY', 409)
                return {'note': public_item(note), 'revision': self.read(previous)}
            if note['head'] != payload.get('baseRevision'):
                invalid('This note changed in another editor. Compare, save a copy, or open the latest revision; your draft is retained.', 'NOTE_CONFLICT', 409)
            name = payload.get('name', note['name'])
            if not isinstance(name, str) or not name.strip() or len(name) > 200:
                invalid('Give this note a title of 1–200 characters.')
            now = utc_now()
            self.put(owner, project, 'NOTE_REVISION', revision_id, {**blob, 'noteId': key, 'name': name.strip(), 'parentRevision': note['head'], 'revision': note['revision'] + 1, 'author': {'kind': 'user', 'id': owner}, 'provenance': provenance, 'requestId': request, 'createdAt': now})
            self.s.update_item(owner, 'PROJECT_NOTE', key, {'head': revision_id, 'revision': note['revision'] + 1, 'sha256': blob['sha256'], 'name': name.strip(), 'updatedAt': now})
        return self.get(owner, project, key)

    def propose(self, owner: str, project: str, payload: dict, provenance: dict) -> dict:
        key = identifier(payload.get('noteId'))
        note = self.row(owner, project, 'PROJECT_NOTE', key)
        if note['head'] != payload.get('baseRevision'):
            invalid('Read the current immutable note revision before proposing changes.', 'NOTE_CONFLICT', 409)
        text = self.revision(owner, project, note['head'])['text']
        hunks = payload.get('hunks')
        if not isinstance(hunks, list) or not 1 <= len(hunks) <= 32:
            invalid('Propose 1–32 independent note hunks.')
        checked = []
        for h in hunks:
            if not isinstance(h, dict) or not isinstance(h.get('before'), str) or not isinstance(h.get('reason'), str) or len(h['reason']) > 2000:
                invalid('Each hunk needs exact before/after text and a short reason.')
            content(h.get('after'))
            before = h['before']
            if not before or text.count(before) != 1:
                invalid('Each before must match unique exact text; include context for insertions and repeated sections.')
            start = text.index(before)
            end = start + len(before)
            if any(start < entry['end'] and end > entry['start'] for entry in checked):
                invalid('Note hunks cannot overlap.')
            content(text[:start] + h['after'] + text[end:])
            checked.append({'id': secrets.token_hex(8), 'start': start, 'end': end, 'before': before, 'after': h['after'], 'reason': h['reason'], 'decision': 'pending'})
        # Reserve the whole proposal's largest possible result, not just each hunk.
        if len(text.encode()) + sum(max(0, len(h['after'].encode()) - len(h['before'].encode())) for h in checked) > MAX_NOTE_BYTES:
            invalid('The combined proposal exceeds the 1 MiB note limit.', status=413)
        request = identifier(payload.get('toolCallId'))
        proposal_id = 'nprop_' + hashlib.sha256((str(provenance.get('runId')) + ':' + request).encode()).hexdigest()[:32]
        with self.s.table.atomic():
            latest = self.row(owner, project, 'PROJECT_NOTE', key)
            if latest['head'] != note['head']:
                invalid('This note changed while the proposal was prepared.', 'NOTE_CONFLICT', 409)
            previous = self.s.get_item(owner, 'NOTE_PROPOSAL', proposal_id)
            if previous:
                if previous.get('requestFingerprint') != hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest():
                    invalid('This proposal identity was already used for different hunks.', 'NOTE_IDEMPOTENCY', 409)
                return public_item(previous)
            proposal = self.put(owner, project, 'NOTE_PROPOSAL', proposal_id, {'requestFingerprint': hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'noteId': key, 'baseRevision': note['head'], 'expectedHead': note['head'], 'hunks': checked, 'provenance': provenance, 'status': 'open', 'createdAt': utc_now()})
        return public_item(proposal)

    def decide(self, owner: str, project: str, key: str, payload: dict) -> dict:
        with self.s.table.atomic():
            proposal = self.row(owner, project, 'NOTE_PROPOSAL', identifier(payload.get('proposalId')))
            if proposal['noteId'] != key:
                invalid('Choose a proposal for this note.')
            hunk = next((h for h in proposal['hunks'] if h['id'] == payload.get('hunkId')), None)
            decision = payload.get('decision')
            if not hunk or decision not in {'accepted', 'rejected'}:
                invalid('Choose Accept or Reject for a pending hunk.')
            if hunk['decision'] == decision:
                return {'proposal': public_item(proposal), **self.get(owner, project, key)}
            if hunk['decision'] != 'pending':
                invalid('This hunk already has a decision.', 'NOTE_CONFLICT', 409)
            note = self.row(owner, project, 'PROJECT_NOTE', key)
            source_run = self.s.get_item(owner, 'AI_RUN', str(proposal['provenance'].get('runId', '')))
            if source_run and (source_run.get('status') == 'stopped' or source_run.get('controlRevision', 0) != proposal['provenance'].get('controlRevision', 0)):
                invalid('The AI direction changed or this run was stopped. Request a new proposal.', 'NOTE_PROPOSAL_STALE', 409)
            if proposal['status'] != 'open' or note['head'] != proposal['expectedHead']:
                self.s.update_item(owner, 'NOTE_PROPOSAL', proposal['id'], {'status': 'stale'})
                invalid('This proposal is stale after an external edit. Ask AI for a new proposal.', 'NOTE_PROPOSAL_STALE', 409)
            if decision == 'accepted':
                # Browser callers cannot assert an editor is clean without its actual saved draft.
                editor = identifier(payload.get('editorId'))
                drafts = self.drafts(owner, project, key)['drafts']
                if any(d['editorId'] == editor and (d['sha256'] != note['sha256'] or d['baseRevision'] != note['head'] or d['name'] != note['name']) for d in drafts):
                    invalid('Save or review this editor draft before accepting an AI hunk.', 'NOTE_DIRTY_DRAFT', 409)
                source = self.revision(owner, project, note['head'])['text']
                if source[hunk['start']:hunk['end']] != hunk['before']:
                    invalid('The hunk no longer matches the expected note.', 'NOTE_PROPOSAL_STALE', 409)
                updated = self.save(owner, project, key, {'requestId': proposal['id'] + '_' + hunk['id'], 'baseRevision': note['head'], 'text': source[:hunk['start']] + hunk['after'] + source[hunk['end']:]}, provenance={**proposal['provenance'], 'proposalId': proposal['id'], 'hunkId': hunk['id']})
                proposal['expectedHead'] = updated['note']['head']
                delta = len(hunk['after']) - (hunk['end'] - hunk['start'])
                for other in proposal['hunks']:
                    if other['decision'] == 'pending' and other['start'] >= hunk['end']:
                        other['start'] += delta; other['end'] += delta
                # The accepted editor draft advances to the new checkpoint; other editors are retained.
                for draft in drafts:
                    if draft['editorId'] == editor:
                        row = self.row(owner, project, 'NOTE_DRAFT', draft['id'])
                        self.s.update_item(owner, 'NOTE_DRAFT', draft['id'], {**self.store(owner, project, updated['revision']['text']), 'baseRevision': proposal['expectedHead'], 'sequence': row['sequence']})
            hunk['decision'] = decision
            proposal['status'] = 'complete' if all(h['decision'] != 'pending' for h in proposal['hunks']) else 'open'
            self.s.put_item(proposal)
            return {'proposal': public_item(proposal), **self.get(owner, project, key)}

    def attach(self, owner: str, project: str, key: str, payload: dict) -> dict:
        note = self.row(owner, project, 'PROJECT_NOTE', key)
        revision = self.row(owner, project, 'NOTE_REVISION', identifier(payload.get('baseRevision')))
        if revision['noteId'] != key:
            invalid('Choose a revision of this note.')
        text = self.read(revision)['text']
        selection = payload.get('selection')
        if selection is not None:
            if not isinstance(selection, dict) or type(selection.get('start')) is not int or type(selection.get('end')) is not int or not 0 <= selection['start'] < selection['end'] <= len(text):
                invalid('Choose an exact range in the saved revision.')
            text = text[selection['start']:selection['end']]
        if len(text.encode()) > 32 * 1024:
            invalid('Select a section of at most 32 KiB to attach to AI.', 'NOTE_CONTEXT_LIMIT', 413)
        blob = self.store(owner, project, text)
        snapshot_id = 'nctx_' + hashlib.sha256((revision['id'] + ':' + str(selection)).encode()).hexdigest()[:32]
        with self.s.table.atomic():
            existing = self.s.get_item(owner, 'NOTE_CONTEXT', snapshot_id)
            if existing:
                row = existing
            else:
                row = self.put(owner, project, 'NOTE_CONTEXT', snapshot_id, {**blob, 'noteId': key, 'name': note['name'], 'sourceRevision': revision['id'], 'revision': revision['revision'], 'selection': selection, 'capturedAt': utc_now()})
        return {'context': {'ref': {'kind': 'resource', 'resourceKind': 'note_snapshot', 'id': snapshot_id, 'revision': revision['revision']}, 'label': note['name'] + ' · v' + str(revision['revision'])}, 'snapshot': public_item(row)}

    def handle(self, owner: str, method: str, parts: list[str], payload: dict) -> dict:
        if not parts or len(parts) > 4:
            invalid('Invalid Notes route.', 'NOT_FOUND', 404)
        project = identifier(parts[0]); self.scope(owner, project)
        if len(parts) == 1:
            if method == 'GET': return self.list(owner, project)
            if method == 'POST': return self.create(owner, project, payload)
        key = identifier(parts[1]) if len(parts) > 1 else ''
        if len(parts) == 2 and method == 'GET': return self.get(owner, project, key)
        if len(parts) == 3:
            operation = parts[2]
            self.row(owner, project, 'PROJECT_NOTE', key)
            if operation == 'drafts':
                if method == 'GET': return self.drafts(owner, project, key)
                if method == 'PUT': return self.draft(owner, project, key, payload)
            if operation == 'save' and method == 'POST': return self.save(owner, project, key, payload)
            if operation == 'history' and method == 'GET':
                return {'revisions': sorted([public_item(r) for r in self.s.list_owner_items(owner, 'NOTE_REVISION') if r.get('projectId') == project and r.get('noteId') == key], key=lambda r: r['revision'], reverse=True)}
            if operation == 'proposals' and method == 'GET':
                return {'proposals': [public_item(r) for r in self.s.list_owner_items(owner, 'NOTE_PROPOSAL') if r.get('projectId') == project and r.get('noteId') == key]}
            if operation == 'attach' and method == 'POST': return self.attach(owner, project, key, payload)
            if operation == 'decision' and method == 'POST': return self.decide(owner, project, key, payload)
        if len(parts) == 4 and parts[2] == 'history' and method == 'GET':
            revision = self.revision(owner, project, identifier(parts[3]))
            if revision['noteId'] != key: invalid('This revision belongs to another note.', 'NOTE_NOT_FOUND', 404)
            return {'revision': revision}
        invalid('This Notes operation is not supported.', 'NOT_FOUND', 404)
