"""Local pinned requirements, verified overflow and bounded multi-stage execution."""
import json
from pathlib import Path
import tempfile
import time
import unittest

from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.ai_memory import AiMemory, evidence_digest
from backend.local_api.domain.phynite_core import ApiError, json_safe


class AiMemoryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.owner = self.services.owner
        self.ai = AiWorkspace(PhyniteApi(self.services))
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_memory', {'projectKey': None, 'activeRunId': 'air_memory', 'mode': 'chat'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_memory', {'conversationId': 'aic_memory', 'steps': 0, 'status': 'running', 'modelId': 'fixture', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('lease')})
        self.memory = AiMemory(self.ai)

    def reload(self):
        self.conversation = self.ai.row(self.owner, 'AI_CONVERSATION', 'aic_memory')
        self.run = self.ai.row(self.owner, 'AI_RUN', 'air_memory')

    def request(self, op, payload=None):
        return body(self.ai.handle(self.owner, 'POST', '/v1/ai/conversations/aic_memory/' + op, {'runId': 'air_memory', 'lease': 'lease', **(payload or {})}, {}))

    def test_initial_exact_requirements_survive_over_200kb_and_compaction(self):
        message = self.ai.message(self.owner, self.conversation, self.run, 'user', 'Use PBEsol, ecutwfc=80 Ry; freeze relax_node and SiC 2x2x1 periodic cell.')
        for i in range(30):
            self.ai.message(self.owner, self.conversation, self.run, 'tool', json.dumps({'id': str(i), 'sha256': 'a' * 64, 'energy': {'value': -12.34, 'unit': 'Ry'}, 'log': 'evidence ' * 1500}))
        ledger = self.request('ledger')['ledger']
        self.reload()
        self.assertEqual(ledger['constraints'][0]['text'], message['text'])
        self.assertEqual(ledger['constraints'][0]['messageId'], message['id'])
        self.assertTrue(self.conversation['compactionSummary'])
        detail = self.ai.detail(self.owner, self.conversation)
        self.assertTrue(detail['hasOlderMessages'])
        self.assertNotIn(message['id'], [m['id'] for m in detail['messages']])
        self.assertEqual(detail['conversation']['stateLedger']['constraints'][0]['text'], message['text'])
        stored = json_safe(self.memory.messages(self.owner, self.conversation)[1])
        self.assertLessEqual(len(json.dumps(stored['evidenceDigest']).encode()), 2000)
        self.assertIn('-12.34', json.dumps(stored['evidenceDigest']))
        self.assertGreater(len(stored['text']), 10000)

    def test_overflow_checksum_and_atomic_revision_fence(self):
        for i in range(3):
            self.ai.message(self.owner, self.conversation, self.run, 'user', str(i) + ' requirement' * 2000)
        ledger = self.request('ledger')['ledger']
        self.reload()
        self.assertTrue(self.conversation['stateLedger']['overflow'])
        self.assertEqual(self.memory.load(self.owner, self.conversation), ledger)
        with self.assertRaises(ApiError):
            self.memory.checkpoint(self.owner, {**self.conversation, 'revision': 0}, self.run)
        # A rejected checkpoint may leave an unreferenced immutable blob. Corrupt the live ledger.
        active_suffix = '/' + self.conversation['ledgerSha256'] + '.json'
        self.services.s3.put_object(Bucket=self.services.bucket, Key=next(p['Key'] for p in self.services.s3.list_objects_v2(Bucket=self.services.bucket)['Contents'] if p['Key'].endswith(active_suffix)), Body=b'{}')
        with self.assertRaisesRegex(ApiError, 'verification'):
            self.memory.load(self.owner, self.conversation)

    def test_model_can_assess_but_never_rewrite_requirements_or_action_states(self):
        message = self.ai.message(self.owner, self.conversation, self.run, 'user', 'Preserve cutoff 80 Ry.')
        with self.assertRaises(ApiError):
            self.request('ledger', {'assessments': [{'messageId': message['id'], 'status': 'addressed', 'explanation': 'fake', 'text': 'change to 40 Ry'}]})
        self.request('ledger', {'assessments': [{'messageId': message['id'], 'status': 'unmet', 'explanation': 'Cannot verify saved settings.'}]})
        self.reload()
        audit = self.request('audit')
        self.assertFalse(audit['verified'])
        self.assertEqual(audit['issues'][0]['status'], 'unmet')
        self.ai.put(self.owner, 'AI_ACTION', 'aia_pending', {'conversationId': 'aic_memory', 'runId': 'air_memory', 'kind': 'run_dft', 'title': 'Run Si', 'status': 'pending'})
        self.assertEqual(self.request('audit')['openGaps'], ['aia_pending: pending'])

    def test_short_cap_and_opt_in_40_step_cap_are_idempotent(self):
        for i in range(12): self.request('step', {'toolCallId': f'short{i}'})
        with self.assertRaises(ApiError): self.request('step', {'toolCallId': 'excess'})
        self.reload()
        self.ai.update(self.owner, 'AI_RUN', self.run, {'executionMode': 'multistage'})
        for i in range(12, 40): self.request('step', {'toolCallId': f'long{i}'})
        self.assertEqual(self.request('step', {'toolCallId': 'long39'})['run']['steps'], 40)
        with self.assertRaises(ApiError): self.request('step', {'toolCallId': 'long40'})

    def test_finish_retains_unverified_requirements_and_actual_pending_actions(self):
        message = self.ai.message(self.owner, self.conversation, self.run, 'user', 'Run Si after review.')
        self.ai.put(self.owner, 'AI_ACTION', 'aia_pending', {
            'conversationId': self.conversation['id'], 'runId': self.run['id'],
            'kind': 'run_dft', 'title': 'Run Si', 'status': 'pending'})
        self.request('finish', {'status': 'completed'})
        self.reload()
        self.assertFalse(self.run['verification']['verified'])
        self.assertEqual(self.run['verification']['issues'][0]['messageId'], message['id'])
        self.assertEqual(self.run['verification']['openGaps'], ['aia_pending: pending'])
        self.assertEqual(self.ai.row(self.owner, 'AI_ACTION', 'aia_pending')['status'], 'pending')

    def test_audit_keeps_old_instructions_but_does_not_reopen_old_turns(self):
        previous = {**self.run, 'id': 'air_previous'}
        old = self.ai.message(self.owner, self.conversation, previous, 'user', 'Keep the Si cutoff at 80 Ry.')
        latest = self.ai.message(self.owner, self.conversation, self.run, 'user', 'Read the SCF results.')
        for status in ('rejected', 'expired', 'superseded', 'failed'):
            self.ai.put(self.owner, 'AI_ACTION', 'aia_old_' + status, {
                'conversationId': self.conversation['id'], 'runId': previous['id'],
                'kind': 'run_dft', 'title': 'Old Si calculation', 'status': status})
        self.ai.put(self.owner, 'AI_ACTION', 'aia_pending', {
            'conversationId': self.conversation['id'], 'runId': previous['id'],
            'kind': 'run_dft', 'title': 'Review Si calculation', 'status': 'pending'})
        audit = self.request('audit')
        self.assertEqual([issue['messageId'] for issue in audit['issues']], [latest['id']])
        self.assertEqual(audit['openGaps'], ['aia_pending: pending'])
        self.assertIn(old['id'], [item['messageId'] for item in self.memory.snapshot(self.owner, self.conversation)['constraints']])
        # Explicitly revisiting a previous request still reports that assessment.
        self.request('ledger', {'assessments': [{'messageId': old['id'], 'status': 'unmet', 'explanation': 'The cutoff could not be checked.'}]})
        self.reload()
        self.assertIn(old['id'], [issue['messageId'] for issue in self.request('audit')['issues']])

    def test_digest_redacts_secrets_and_preserves_reading_pointers(self):
        result = evidence_digest(json.dumps({'api_key': 'fixture-only', 'nextLine': 123, 'sha256': 'b' * 64, 'log': 'x' * 24000}))
        self.assertNotIn('fixture-only', json.dumps(result))
        self.assertIn('123', json.dumps(result))
        self.assertLessEqual(len(json.dumps(result).encode()), 2000)
