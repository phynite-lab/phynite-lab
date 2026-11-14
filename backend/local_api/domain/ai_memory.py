"""Pinned user requirements and deterministic evidence summaries, never model authority."""
from __future__ import annotations

import copy
import hashlib
import json
from backend.local_api.domain.ai_workspace import clean, fail, digest
from backend.local_api.domain.ai_observation import compact_observation
from backend.local_api.domain.phynite_core import json_safe, storage_owner, utc_now


def evidence_digest(text, evidence=None):
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        value = {'text': text}
    return compact_observation({'sourceSha256': hashlib.sha256(text.encode()).hexdigest(),
                                'evidence': evidence or {}, 'observation': json_safe(clean(value)),
                                'readingLimit': 'Digest only; use the scoped source reader for full evidence.'}, 2000)


class AiMemory:
    def __init__(self, ai):
        self.ai, self.services = ai, ai.services

    def messages(self, owner, conversation):
        return sorted(self.services.list_owner_items(owner, 'AI_MESSAGE#' + conversation['id']), key=lambda row: row['order'])

    def load(self, owner, conversation):
        # Keys are always derived from the authenticated owner, conversation and digest.
        ledger = conversation.get('stateLedger') or {}
        if conversation.get('ledgerSha256'):
            sha = conversation['ledgerSha256']
            key = f'users/{storage_owner(owner)}/ai/{conversation["id"]}/ledger/{sha}.json'
            raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=key)['Body'].read(4_000_001)
            if len(raw) > 4_000_000 or hashlib.sha256(raw).hexdigest() != sha:
                fail(409, 'The pinned conversation ledger failed verification.', 'AI_LEDGER_CHECKSUM')
            ledger = json.loads(raw)
        return copy.deepcopy(ledger)

    def snapshot(self, owner, conversation, run=None):
        previous = self.load(owner, conversation)
        old = {entry['messageId']: entry for entry in previous.get('constraints', [])}
        messages = self.messages(owner, conversation)
        constraints = []
        for message in messages:
            if message['role'] == 'user':
                # Keep exact instructions. A model cannot silently edit or supersede them.
                constraints.append({'messageId': message['id'], 'text': clean(message['text']), 'status': 'active',
                                    'assessment': old.get(message['id'], {}).get('assessment'), 'runId': message['runId']})
        actions = [row for row in self.services.list_owner_items(owner, 'AI_ACTION') if row.get('conversationId') == conversation['id']]
        outcomes = [{key: clean(action[key]) for key in ('id', 'runId', 'kind', 'status', 'title', 'payloadHash', 'result', 'error') if key in action} for action in actions]
        locked = {digest([item['ref'], item['sha256']]): {key: item[key] for key in ('sourceId', 'ref', 'sha256', 'label', 'value') if key in item}
                  for message in messages if message['role'] == 'user' for item in message.get('contextManifest', [])}
        return {'schemaVersion': 1, 'constraints': constraints, 'lockedParameters': list(locked.values()),
                'completedActions': outcomes, 'openGaps': [f'{a["id"]}: {a["status"]}' for a in actions if a['status'] != 'succeeded'],
                'stage': (run or {}).get('steps', 0) // 10, 'updatedAt': utc_now()}

    def checkpoint(self, owner, conversation, run, assessments=None):
        ledger = self.snapshot(owner, conversation, run)
        if assessments is not None:
            if not isinstance(assessments, list) or len(assessments) > 50:
                fail(400, 'Assess up to 50 pinned requirements at a time.', 'AI_LEDGER_INVALID')
            known = {entry['messageId']: entry for entry in ledger['constraints']}
            for entry in assessments:
                if not isinstance(entry, dict) or set(entry) != {'messageId', 'status', 'explanation'} or entry['messageId'] not in known or entry['status'] not in {'addressed', 'unmet', 'unknown'} or not isinstance(entry['explanation'], str) or not 1 <= len(entry['explanation']) <= 1000:
                    fail(400, 'Use existing requirement IDs, a disposition and a concise evidence explanation.', 'AI_LEDGER_INVALID')
                known[entry['messageId']]['assessment'] = {**clean(entry), 'runId': run['id'], 'modelAssessment': True}
        raw = json.dumps(json_safe(clean(ledger)), ensure_ascii=False, allow_nan=False).encode()
        if len(raw) > 4_000_000:
            fail(413, 'The pinned requirements exceed 4 MB. Start a new conversation with explicit carry-forward requirements.', 'AI_LEDGER_LIMIT')
        values = {'stateLedger': ledger, 'ledgerSha256': None}
        if len(raw) > 16000:
            sha = hashlib.sha256(raw).hexdigest()
            key = f'users/{storage_owner(owner)}/ai/{conversation["id"]}/ledger/{sha}.json'
            self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=raw, ContentType='application/json', ServerSideEncryption='AES256')
            values = {'stateLedger': {'schemaVersion': 1, 'overflow': True, 'constraintCount': len(ledger['constraints'])}, 'ledgerSha256': sha}
        messages = self.messages(owner, conversation)
        if sum(len(message['text']) for message in messages) > 180000:
            older = messages[:-20]
            values.update({'compactedBeforeOrder': older[-1]['order'] if older else '',
                           'compactionSummary': compact_observation({'readingLimit': 'Deterministic index, not a substitute for full source reads.',
                              'messages': json_safe([{'id': m['id'], 'runId': m['runId'], 'role': m['role'],
                                            'evidence': m.get('evidenceDigest') or evidence_digest(m['text'])} for m in older])}, 16000)})
        rows = []
        for row, changes in [(conversation, values), (run, {'stateLedger': values['stateLedger'], 'ledgerSha256': values['ledgerSha256'], 'stage': ledger['stage']})]:
            rows.append(({**row, **changes, 'revision': int(row['revision']) + 1, 'updatedAt': utc_now()}, int(row['revision'])))
        if not self.services.commit_ai_records(rows):
            fail(409, 'Conversation progress changed; reload the latest checkpoint.', 'AI_CONFLICT')
        return ledger

    def audit(self, owner, conversation, run):
        ledger = self.snapshot(owner, conversation, run)
        issues = []
        for requirement in ledger['constraints']:
            assessment = requirement.get('assessment') or {}
            # Earlier instructions remain pinned context. A new request does not
            # reopen every earlier conversation turn as unfinished work.
            if requirement['runId'] != run['id'] and assessment.get('runId') != run['id']:
                continue
            if assessment.get('runId') != run['id'] or assessment.get('status') != 'addressed':
                issues.append({'messageId': requirement['messageId'], 'status': assessment.get('status', 'unknown'),
                               'text': requirement['text'], 'explanation': assessment.get('explanation', 'Requirement has not been assessed against recorded evidence.')})
        actions = [action for action in ledger['completedActions']
                   if action.get('runId') == run['id'] or action['status'] in {'pending', 'executing'}]
        gaps = [f'{action["id"]}: {action["status"]}' for action in actions
                if action['status'] in {'pending', 'executing', 'failed'}]
        return {'verified': not issues and not gaps, 'issues': issues, 'actions': actions,
                'openGaps': gaps, 'note': 'Requirement assessments are model statements, not proof of scientific correctness. Action statuses are recorded facts.'}
