"""Immutable typed conversation deliverables, independent of project mutation authority."""
from __future__ import annotations

import hashlib
import json
import math
import re
import secrets
from backend.local_api.domain.ai_workspace import clean, digest, fail, valid_id
from backend.local_api.domain.phynite_core import json_safe, owner_partition, storage_owner, utc_now

KINDS = {'report', 'plan', 'figure_preview', 'input_file', 'table', 'diff', 'manuscript'}
STATUSES = {'draft', 'complete', 'partial'}
MAX_BYTES = 2_000_000


def encoded(value):
    try: return json.dumps(json_safe(value), ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
    except (ValueError, TypeError): fail(400, 'Artifact data must contain finite JSON values.', 'AI_ARTIFACT_INVALID')


def text(value, name, maximum, empty=True):
    if not isinstance(value, str) or len(value) > maximum or not empty and not value.strip():
        fail(400, f'{name} must be text within {maximum:,} characters.', 'AI_ARTIFACT_INVALID')
    return value


def fields(value, allowed, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        fail(400, 'The artifact contains unsupported or missing fields.', 'AI_ARTIFACT_INVALID')


def summary(row):
    return {key: clean(row[key]) for key in ('id', 'conversationId', 'runId', 'artifactGroupId', 'version', 'parentArtifactId', 'kind', 'title', 'status', 'createdAt', 'hasOverflow', 'sha256') if key in row}


class AiArtifacts:
    def __init__(self, ai): self.ai, self.services = ai, ai.services

    def key(self, owner, conversation, row):
        return f'users/{storage_owner(owner)}/ai/{conversation["id"]}/artifacts/{row["id"]}/v{row["version"]}-{row["sha256"]}.json'

    def get(self, owner, conversation, item_id):
        row = self.ai.row(owner, 'AI_ARTIFACT', valid_id(item_id))
        if row.get('conversationId') != conversation['id']:
            fail(404, 'This artifact is not in this conversation.', 'AI_NOT_FOUND')
        if row.get('schemaVersion') != 2: return clean(row)
        if row.get('hasOverflow'):
            stream = self.services.s3.get_object(Bucket=self.services.bucket, Key=self.key(owner, conversation, row))['Body']
            try: raw = stream.read(MAX_BYTES + 1)
            finally: stream.close()
        else: raw = encoded(row['payload'])
        if len(raw) > MAX_BYTES or hashlib.sha256(raw).hexdigest() != row['sha256']:
            fail(409, 'The saved artifact failed its checksum verification.', 'AI_ARTIFACT_CHECKSUM')
        payload = json.loads(raw)
        public = {key: value for key, value in clean(row).items() if key != 'payload'}
        return {**public, **payload, 'text': payload.get('content', '')}

    def validate(self, owner, conversation, kind, data):
        if kind in {'report', 'plan'}:
            if data is not None: fail(400, 'Reports and plans use Markdown content.', 'AI_ARTIFACT_INVALID')
            return
        if kind == 'table':
            fields(data, {'columns', 'rows', 'sourceIds'}, {'columns', 'rows', 'sourceIds'})
            columns, rows, sources = data['columns'], data['rows'], data['sourceIds']
            if not isinstance(columns, list) or not 1 <= len(columns) <= 32 or not isinstance(rows, list) or len(rows) > 5000 or not isinstance(sources, list) or len(sources) > 100:
                fail(400, 'Tables allow 1–32 columns, up to 5,000 rows and 100 source IDs.', 'AI_ARTIFACT_INVALID')
            keys = []
            for column in columns:
                fields(column, {'key', 'label', 'unit', 'numeric'}, {'key', 'label'})
                key = text(column['key'], 'Column key', 80, False)
                if key in keys or key in {'__proto__', 'constructor', 'prototype'}: fail(400, 'Column keys must be distinct and safe.', 'AI_ARTIFACT_INVALID')
                keys.append(key); text(column['label'], 'Column label', 200, False)
                if 'unit' in column: text(column['unit'], 'Column unit', 80)
                if 'numeric' in column and type(column['numeric']) is not bool: fail(400, 'numeric must be boolean.', 'AI_ARTIFACT_INVALID')
            for row in rows:
                fields(row, keys)
                for value in row.values():
                    if value is not None and not (isinstance(value, str) and len(value) <= 10000 or type(value) in {int, float} and math.isfinite(value)):
                        fail(400, 'Table cells must be finite numbers, text or null.', 'AI_ARTIFACT_INVALID')
            for source in sources: text(source, 'Source ID', 200, False)
        elif kind in {'input_file', 'diff'}:
            fields(data, {'format', 'filename', 'text', 'validation'} if kind == 'input_file' else {'format', 'filename', 'before', 'after'}, {'format', 'filename', 'text'} if kind == 'input_file' else {'format', 'filename', 'before', 'after'})
            filename = text(data['filename'], 'Filename', 160, False)
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_. -]{0,159}', filename) or '..' in filename: fail(400, 'Use a plain filename without paths.', 'AI_ARTIFACT_INVALID')
            if data['format'] not in {'qe', 'lammps', 'cif', 'poscar', 'json', 'text'}: fail(400, 'Choose a supported text format.', 'AI_ARTIFACT_INVALID')
            for field in ('text',) if kind == 'input_file' else ('before', 'after'): text(data[field], field, 1_500_000)
            if 'validation' in data:
                fields(data['validation'], {'valid', 'issues'}, {'valid', 'issues'})
                if type(data['validation']['valid']) is not bool or not isinstance(data['validation']['issues'], list) or len(data['validation']['issues']) > 100:
                    fail(400, 'Validation needs boolean valid and up to 100 issue strings.', 'AI_ARTIFACT_INVALID')
                for issue in data['validation']['issues']: text(issue, 'Validation issue', 2000)
                data['validation']['note'] = 'Model-supplied assessment only. Artifact publication never validates, installs or executes scientific inputs.'
        elif kind == 'figure_preview':
            fields(data, {'figure', 'datasets'}, {'figure', 'datasets'})
            from backend.local_api.domain.research_documents import validate_document
            figure, datasets = data['figure'], data['datasets']
            if not isinstance(figure, dict) or not isinstance(datasets, list) or not 1 <= len(datasets) <= 32:
                fail(400, 'A figure preview needs a figure and 1–32 saved datasets.', 'AI_ARTIFACT_INVALID')
            project = self.ai.scope(owner, conversation.get('projectKey'))
            if not project or figure.get('projectId') != project['id']: fail(403, 'Figure preview must belong to the selected project.', 'AI_PROJECT_REQUIRED')
            validate_document('figures', figure, figure.get('id'))
            ids = set()
            for dataset in datasets:
                if not isinstance(dataset, dict) or dataset.get('projectId') != project['id']: fail(403, 'Preview datasets must belong to this project.', 'AI_ARTIFACT_INVALID')
                validate_document('datasets', dataset, dataset.get('id'))
                saved = self.ai.resource(owner, conversation, 'dataset', dataset['id'])['document']
                if digest(saved) != digest(dataset): fail(409, 'Use the exact saved dataset bytes for figure previews.', 'AI_CONTEXT_CHANGED')
                ids.add(dataset['id'])
            if any(layer.get('datasetId') not in ids for panel in figure['panels'] for layer in panel['layers']):
                fail(400, 'Every figure layer needs its retained dataset.', 'AI_ARTIFACT_INVALID')

    def publish(self, owner, conversation, run, request, update=False, *, evidence=None, manuscript=False):
        envelope = {'runId', 'lease', 'controlRevision', 'toolCallId', 'toolName'}
        fields(request, envelope | ({'artifactId', 'title', 'content', 'structuredData', 'status'} if update else {'artifactGroupId', 'kind', 'title', 'content', 'structuredData', 'status'}))
        call_id = request.get('toolCallId')
        if call_id is not None and (not isinstance(call_id, str) or not re.fullmatch('[A-Za-z0-9_-]{1,200}', call_id)): fail(400, 'Invalid artifact call ID.', 'AI_ARTIFACT_INVALID')
        item_id = 'aid_' + (digest([run['id'], call_id])[:32] if call_id else secrets.token_hex(16))
        request_hash = hashlib.sha256(encoded({k: v for k, v in request.items() if k not in envelope})).hexdigest()
        existing = self.services.get_item(owner, 'AI_ARTIFACT', item_id)
        if existing:
            if existing.get('conversationId') != conversation['id'] or existing.get('requestHash') != request_hash: fail(409, 'Artifact call ID was already used for different content.', 'AI_ARTIFACT_CONFLICT')
            return self.get(owner, conversation, item_id)
        parent = self.get(owner, conversation, valid_id(request.get('artifactId'))) if update else None
        group_id = parent.get('artifactGroupId', 'aig_' + digest(parent['id'])[:24]) if parent else request.get('artifactGroupId') or 'aig_' + secrets.token_hex(12)
        if not isinstance(group_id, str) or not re.fullmatch('aig_[a-f0-9]{24}', group_id): fail(400, 'Use a returned artifact group ID.', 'AI_ARTIFACT_INVALID')
        group = self.services.get_item(owner, 'AI_ARTIFACT_GROUP', group_id)
        if group and (group.get('conversationId') != conversation['id'] or parent and group['latestId'] != parent['id']): fail(409, 'Update the latest artifact version in this conversation.', 'AI_ARTIFACT_CONFLICT')
        if not group and request.get('artifactGroupId'): fail(404, 'Artifact group not found.', 'AI_NOT_FOUND')
        if not parent and group: parent = self.get(owner, conversation, group['latestId'])
        kind = request.get('kind', (parent or {}).get('kind'))
        if isinstance(kind, str): kind = {'research': 'report', 'summary': 'report'}.get(kind, kind)
        status = request.get('status', (parent or {}).get('status', 'complete'))
        if not isinstance(kind, str) or kind not in KINDS or not isinstance(status, str) or status not in STATUSES:
            fail(400, 'Choose a supported artifact kind and status.', 'AI_ARTIFACT_INVALID')
        if group and kind != group['kind']: fail(409, 'Artifact kind is fixed within its version group.', 'AI_ARTIFACT_CONFLICT')
        if kind == 'manuscript' and not manuscript: fail(400, 'Use create_manuscript to bind an archive to executed evidence.', 'AI_MANUSCRIPT_UNVERIFIED')
        title = text(request.get('title', (parent or {}).get('title', 'Research artifact')), 'Artifact title', 200, False)
        content = text(request.get('content', (parent or {}).get('content', (parent or {}).get('text', ''))), 'Artifact content', 1_500_000)
        structured = json_safe(request.get('structuredData', (parent or {}).get('structuredData')))
        # Annotation is generated by us, not accepted as permission on subsequent versions.
        if isinstance(structured, dict) and isinstance(structured.get('validation'), dict): structured['validation'].pop('note', None)
        self.validate(owner, conversation, kind, structured)
        if not content.strip() and structured is None: fail(400, 'Artifact needs content or typed data.', 'AI_ARTIFACT_INVALID')
        payload = clean({'content': content, 'structuredData': structured, 'contextManifest': run.get('contextManifest', []), 'evidence': evidence if evidence is not None else (parent or {}).get('evidence', [])})
        raw = encoded(payload)
        if len(raw) > MAX_BYTES: fail(413, 'Artifact exceeds the 2 MB deliverable limit.', 'AI_ARTIFACT_LIMIT')
        version = int((parent or {}).get('version', 1 if parent else 0)) + 1
        timestamp = utc_now()
        row = {'PK': owner_partition(owner), 'SK': 'AI_ARTIFACT#' + item_id, 'entityType': 'AI_ARTIFACT', 'ownerId': owner, 'id': item_id, 'revision': 0, 'schemaVersion': 2,
               'artifactGroupId': group_id, 'version': version, **({'parentArtifactId': parent['id']} if parent else {}), 'requestHash': request_hash,
               'conversationId': conversation['id'], 'projectKey': conversation.get('projectKey'), 'runId': run['id'], 'kind': kind, 'title': clean(title), 'status': status,
               'createdAt': timestamp, 'sourceStamp': run.get('sourceStamp'), 'modelId': run['modelId'], 'providerId': run.get('providerId', 'local'), 'effort': run.get('effort', 'auto'),
               'sha256': hashlib.sha256(raw).hexdigest(), 'hasOverflow': len(raw) > 32000}
        if row['hasOverflow']: self.services.s3.put_object(Bucket=self.services.bucket, Key=self.key(owner, conversation, row), Body=raw, ContentType='application/json', ServerSideEncryption='AES256')
        else: row['payload'] = payload
        next_group = {'PK': owner_partition(owner), 'SK': 'AI_ARTIFACT_GROUP#' + group_id, 'entityType': 'AI_ARTIFACT_GROUP', 'ownerId': owner, 'id': group_id, 'conversationId': conversation['id'],
                      'kind': kind, 'latestId': item_id, 'version': version, 'revision': int((group or {}).get('revision', -1)) + 1, 'updatedAt': timestamp}
        if not self.services.commit_ai_records([(row, None), (next_group, int(group['revision']) if group else None)]):
            fail(409, 'Artifact version changed. Read the latest version and retry.', 'AI_ARTIFACT_CONFLICT')
        from backend.local_api.domain.ai_runtime import AiRuntime
        AiRuntime(self.ai.api).event(owner, conversation, {'type': 'artifact', 'artifact': summary(row)})
        return self.get(owner, conversation, item_id)

    def list(self, owner, conversation):
        return [summary(row) for row in sorted(self.services.list_owner_items(owner, 'AI_ARTIFACT'), key=lambda row: (row['createdAt'], row['id'])) if row.get('conversationId') == conversation['id']]

    def read(self, owner, conversation, request):
        row = self.get(owner, conversation, valid_id(request.get('id')))
        offset = request.get('offset', 0)
        if type(offset) is not int or offset < 0: fail(400, 'Use a nonnegative artifact offset.', 'AI_ARTIFACT_INVALID')
        body = json.dumps({key: row.get(key) for key in ('content', 'structuredData', 'text', 'contextManifest', 'evidence')}, ensure_ascii=False)
        return {'artifact': summary(row), 'section': body[offset:offset + 12000], 'offset': offset,
                'nextOffset': offset + 12000 if offset + 12000 < len(body) else None, 'totalCharacters': len(body), 'readingLimit': 'This is a text window of retained artifact JSON, not scientific verification.'}
