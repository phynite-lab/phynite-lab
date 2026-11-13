"""Opt-in capture broker. The browser supplies pixels, never permission or source authority."""
from __future__ import annotations
import json
import math
import re
import time
from backend.local_api.domain.ai_workspace import clean, digest, fail
from backend.local_api.domain.ai_workbench import AiWorkbench
from backend.local_api.domain.ai_attachments import AiAttachments


class AiViewport:
    def __init__(self, ai):
        self.ai, self.services = ai, ai.services

    def permission(self, owner, conversation, payload=None):
        with self.services.table.atomic():
            current = self.ai.row(owner, 'AI_CONVERSATION', conversation['id'])
            if payload is not None:
                if type(payload.get('enabled')) is not bool or type(payload.get('revision')) is not int or payload.get('revision') != current.get('captureRevision', 0):
                    fail(409, 'Capture permission changed. Refresh this conversation.', 'AI_CAPTURE_CONFLICT')
                current = self.ai.update(owner, 'AI_CONVERSATION', current, {'captureEnabled': payload['enabled'], 'captureRevision': current.get('captureRevision', 0) + 1})
                for row in self.services.list_owner_items(owner, 'AI_CAPTURE'):
                    if row.get('conversationId') == current['id'] and row.get('status') in {'pending', 'ready'}:
                        self.ai.update(owner, 'AI_CAPTURE', row, {'status': 'cancelled', 'error': 'Capture permission changed.'})
            return {'enabled': current.get('captureEnabled') is True, 'revision': current.get('captureRevision', 0)}

    def request(self, owner, conversation, run, payload):
        ref, call_id = payload.get('sourceRef'), payload.get('toolCallId')
        if not isinstance(ref, dict) or ref.get('kind') != 'node' or not isinstance(call_id, str) or not call_id or len(call_id) > 200:
            fail(400, 'Select an exact saved Canvas node and tool call.', 'AI_CAPTURE_SOURCE_REQUIRED')
        with self.services.table.atomic():
            permission = self.permission(owner, conversation)
            if not permission['enabled']: fail(403, 'Enable viewport capture for this conversation first.', 'AI_CAPTURE_DENIED')
            source = AiWorkbench(self.ai).resolve(owner, conversation, [ref])[0]
            item_id = 'aiv_' + digest([conversation['id'], run['id'], call_id])[:32]
            previous = self.services.get_item(owner, 'AI_CAPTURE', item_id)
            if previous:
                if previous['source']['sha256'] != source['sha256']: fail(409, 'The source changed since this capture request.', 'AI_CAPTURE_STALE')
                return self.public(previous)
            row = self.ai.put(owner, 'AI_CAPTURE', item_id, {'schemaVersion': 1, 'conversationId': conversation['id'], 'projectKey': conversation['projectKey'], 'runId': run['id'], 'permissionRevision': permission['revision'], 'source': {k: source[k] for k in ('ref', 'sha256', 'label')}, 'status': 'pending', 'expiresAt': int(time.time()) + 60})
            return self.public(row)

    @staticmethod
    def public(row):
        return clean({k: row[k] for k in ('id', 'projectKey', 'runId', 'source', 'status', 'expiresAt', 'attachmentId', 'attachmentSha256', 'metadata', 'error') if k in row})

    def get(self, owner, conversation, item_id):
        row = self.ai.row(owner, 'AI_CAPTURE', item_id)
        if row['conversationId'] != conversation['id'] or row['projectKey'] != conversation['projectKey']: fail(404, 'Capture not found.', 'AI_NOT_FOUND')
        permission = self.permission(owner, conversation)
        run = self.ai.row(owner, 'AI_RUN', row['runId'])
        valid = permission['enabled'] and permission['revision'] == row['permissionRevision'] and run['status'] == 'running' and run['expiresAt'] > time.time() and conversation.get('activeRunId') == run['id'] and row['expiresAt'] > time.time()
        if valid:
            try: valid = AiWorkbench(self.ai).resolve(owner, conversation, [row['source']['ref']])[0]['sha256'] == row['source']['sha256']
            except Exception: valid = False
        if not valid and row['status'] in {'pending', 'ready'}:
            row = self.ai.update(owner, 'AI_CAPTURE', row, {'status': 'cancelled', 'error': 'Capture expired, was revoked, or its saved source/turn changed.'})
        return row

    def pending(self, owner, conversation):
        with self.services.table.atomic():
            return [self.public(self.get(owner, self.ai.row(owner, 'AI_CONVERSATION', conversation['id']), r['id'])) for r in self.services.list_owner_items(owner, 'AI_CAPTURE') if r.get('conversationId') == conversation['id'] and r.get('status') == 'pending']

    def complete(self, owner, conversation, item_id, payload):
        with self.services.table.atomic():
            row = self.get(owner, self.ai.row(owner, 'AI_CONVERSATION', conversation['id']), item_id)
            if row['status'] != 'pending': fail(409, 'This capture is no longer pending.', 'AI_CAPTURE_CANCELLED')
            if payload.get('error'):
                return self.public(self.ai.update(owner, 'AI_CAPTURE', row, {'status': 'failed', 'error': str(payload['error'])[:500]}))
            metadata = payload.get('metadata')
            def finite(value):
                if isinstance(value, float) and not math.isfinite(value): return False
                if isinstance(value, dict): return all(finite(v) for v in value.values())
                if isinstance(value, list): return all(finite(v) for v in value)
                return True
            if not isinstance(metadata, dict) or len(json.dumps(metadata)) > 12000 or not finite(metadata) or not all(k in metadata for k in ('kind', 'camera', 'projection', 'selection', 'periodicImages', 'axes', 'units', 'energyReference', 'displaySha256')):
                fail(422, 'Capture metadata is incomplete or invalid.', 'AI_CAPTURE_INVALID')
            if not isinstance(metadata['displaySha256'], str) or not re.fullmatch('[a-f0-9]{64}', metadata['displaySha256']): fail(422, 'Capture needs the displayed source checksum.', 'AI_CAPTURE_INVALID')
            attachment = AiAttachments(self.ai.api).get(owner, conversation, payload.get('attachmentId'))
            if attachment['status'] != 'ready' or attachment['mediaType'] != 'image/png' or attachment['sizeBytes'] > 10 * 1024 ** 2: fail(422, 'A verified PNG attachment below 10 MiB is required.', 'AI_CAPTURE_INVALID')
            return self.public(self.ai.update(owner, 'AI_CAPTURE', row, {'status': 'ready', 'attachmentId': attachment['id'], 'attachmentSha256': attachment['sha256'], 'metadata': {**clean(metadata), 'source': row['source'], 'scientificRunId': metadata.get('scientificRunId'), 'chatRunId': row['runId'], 'capturedAt': time.time(), 'interpretation': 'Visual evidence is approximate. Check numerical source data; screenshots do not prove topology or convergence.'}}))
