"""Immutable artifact versions, isolated overflow and deterministic typed validation."""
import json
from pathlib import Path
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.ai_artifacts import AiArtifacts
from backend.local_api.domain.phynite_core import ApiError, json_safe


class AiArtifactsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        services = LocalServices(Path(temporary.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.ai = AiWorkspace(PhyniteApi(services)); self.owner = services.owner
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_artifact', {'projectKey': None, 'activeRunId': 'air_artifact', 'mode': 'chat'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_artifact', {'conversationId': 'aic_artifact', 'modelId': 'fixture', 'taskMode': 'research', 'status': 'running', 'steps': 0, 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('lease')})
        self.artifacts = AiArtifacts(self.ai)

    def publish(self, **payload):
        return self.artifacts.publish(self.owner, self.conversation, self.run, {'kind': 'report', 'title': 'Fixture report', 'content': 'Recorded fixture source C1.', 'status': 'complete', **payload})

    def test_large_report_is_complete_checksummed_overflow_and_streams_only_metadata(self):
        content = 'Exact scientific source 80 Ry.\n' * 6000
        artifact = self.publish(content=content, toolCallId='long_report')
        self.assertTrue(artifact['hasOverflow']); self.assertEqual(artifact['content'], content)
        stored = self.ai.row(self.owner, 'AI_ARTIFACT', artifact['id'])
        self.assertNotIn('payload', stored)
        from backend.local_api.domain.ai_runtime import AiRuntime
        event = AiRuntime(self.ai.api).events(self.owner, self.conversation)[-1]['event']
        self.assertEqual(event['type'], 'artifact'); self.assertNotIn('content', json.dumps(event))
        self.assertLess(len(json.dumps(json_safe(event)).encode()), 2000)
        window = self.artifacts.read(self.owner, self.conversation, {'id': artifact['id']})
        self.assertEqual(window['nextOffset'], 12000)
        self.assertEqual(self.artifacts.publish(self.owner, self.conversation, self.run, {'kind': 'report', 'title': 'Fixture report', 'content': content, 'status': 'complete', 'toolCallId': 'long_report'})['id'], artifact['id'])
        key = self.artifacts.key(self.owner, self.conversation, artifact)
        self.ai.services.s3.put_object(Bucket=self.ai.services.bucket, Key=key, Body=b'{}')
        with self.assertRaisesRegex(ApiError, 'checksum'): self.artifacts.get(self.owner, self.conversation, artifact['id'])

    def test_versions_are_immutable_and_stale_updates_cannot_fork_the_group(self):
        first = self.publish()
        second = self.artifacts.edit(self.owner, self.conversation, {'artifactId': first['id'], 'baseSha256': first['sha256'], 'text': 'Corrected with source C2.', 'requestId': 'edit_fixture'})
        self.assertEqual(second['version'], 2); self.assertEqual(second['parentArtifactId'], first['id'])
        self.assertEqual(second['artifactGroupId'], first['artifactGroupId'])
        self.assertEqual(self.artifacts.get(self.owner, self.conversation, first['id'])['content'], first['content'])
        with self.assertRaises(ApiError): self.artifacts.publish(self.owner, self.conversation, self.run, {'artifactId': first['id'], 'content': 'stale edit'}, True)
        with self.assertRaises(ApiError): self.publish(artifactGroupId=first['artifactGroupId'], kind='table', structuredData={'columns': [], 'rows': [], 'sourceIds': []})

    def proposal(self, artifact, hunks, call='patch_fixture'):
        return self.artifacts.propose(self.owner, self.conversation, self.run, {'artifactId': artifact['id'], 'baseSha256': artifact['sha256'], 'hunks': hunks, 'toolCallId': call})

    def decision(self, proposal, index=0, decision='accepted', request_id='review_fixture'):
        return self.artifacts.decide_patch(self.owner, self.conversation, {'proposalId': proposal['id'], 'hunkId': proposal['hunks'][index]['id'], 'decision': decision, 'baseRevision': proposal['revision'], 'requestId': request_id})

    def test_user_save_is_idempotent_scoped_and_retains_original_provenance(self):
        first = self.publish(content='Exact source 80 Ry. 科学 🧪')
        request = {'artifactId': first['id'], 'baseSha256': first['sha256'], 'text': 'Researcher edit 80 Ry. 科学 🧪', 'requestId': 'save_fixture'}
        saved = self.artifacts.edit(self.owner, self.conversation, request)
        self.assertEqual(saved['version'], 2); self.assertEqual(saved['status'], 'draft')
        self.assertEqual(saved['author'], {'kind': 'researcher', 'id': self.owner})
        self.assertEqual(saved['change']['baseSha256'], first['sha256'])
        self.assertEqual(saved['contextManifest'], first['contextManifest'])
        self.assertEqual(self.artifacts.edit(self.owner, self.conversation, request)['id'], saved['id'])
        for changed in [{**request, 'text': 'reuse with different bytes'}, {**request, 'baseSha256': '0'*64}, {**request, 'requestId': 'new_stale'}]:
            with self.assertRaises(ApiError): self.artifacts.edit(self.owner, self.conversation, changed)
        for owner, conversation in [('other-owner', self.conversation), (self.owner, {'id': 'aic_other'})]:
            with self.assertRaises(ApiError): self.artifacts.edit(owner, conversation, request)
        self.assertEqual(self.artifacts.get(self.owner, self.conversation, first['id'])['content'], first['content'])

    def test_independent_hunks_accept_in_any_order_without_offset_drift(self):
        first = self.publish(content='🧪 alpha 80 Ry\nbeta 4 eV\ngamma unchanged\n')
        proposal = self.proposal(first, [{'before': 'alpha 80 Ry', 'after': 'alpha 80.5 Ry with context', 'reason': 'Fixture correction A'}, {'before': 'beta 4 eV', 'after': 'beta 4.2 eV', 'reason': 'Fixture correction B'}])
        self.assertEqual(self.proposal(first, [{'before': 'alpha 80 Ry', 'after': 'alpha 80.5 Ry with context', 'reason': 'Fixture correction A'}, {'before': 'beta 4 eV', 'after': 'beta 4.2 eV', 'reason': 'Fixture correction B'}])['id'], proposal['id'])
        second = self.decision(proposal, 1)
        self.assertEqual(second['artifact']['content'], '🧪 alpha 80 Ry\nbeta 4.2 eV\ngamma unchanged\n')
        self.assertEqual(self.decision(proposal, 1)['artifact']['id'], second['artifact']['id'])
        final = self.decision(second['proposal'], 0, request_id='review_second')
        self.assertEqual(final['artifact']['content'], '🧪 alpha 80.5 Ry with context\nbeta 4.2 eV\ngamma unchanged\n')
        self.assertEqual(final['proposal']['status'], 'complete'); self.assertEqual(final['artifact']['version'], 3)
        self.assertEqual(final['artifact']['change']['proposer']['modelId'], 'fixture')
        self.assertEqual(self.ai.services.list_owner_items(self.owner, 'AI_ACTION'), [])

    def test_reject_is_independent_and_does_not_create_a_version(self):
        first = self.publish(content='alpha\nbeta\n')
        p = self.proposal(first, [{'before': 'alpha', 'after': 'edited alpha', 'reason': 'A'}, {'before': 'beta', 'after': 'edited beta', 'reason': 'B'}])
        rejected = self.decision(p, 0, 'rejected')
        self.assertIsNone(rejected['artifact']); self.assertEqual(len(self.artifacts.list(self.owner, self.conversation)), 1)
        accepted = self.decision(rejected['proposal'], 1, request_id='accept_other')
        self.assertEqual(accepted['artifact']['content'], 'alpha\nedited beta\n')

    def test_save_invalidates_all_pending_hunks_and_ai_cannot_overwrite_text(self):
        first = self.publish(content='alpha beta')
        p = self.proposal(first, [{'before': 'alpha', 'after': 'changed', 'reason': 'A'}])
        for update in [{'artifactId': first['id']}, {'artifactGroupId': first['artifactGroupId']}]:
            with self.assertRaises(ApiError): self.publish(**update, content='silent replacement')
        self.artifacts.edit(self.owner, self.conversation, {'artifactId': first['id'], 'baseSha256': first['sha256'], 'text': 'researcher alpha beta', 'requestId': 'save_changed'})
        self.assertEqual(self.artifacts.patches(self.owner, self.conversation, first['id'])[0]['status'], 'stale')
        with self.assertRaises(ApiError): self.decision(p)
        with self.assertRaises(ApiError): self.proposal(first, [{'before': 'alpha', 'after': 'changed', 'reason': 'A'}], 'new_patch')

    def test_invalid_ambiguous_overlapping_and_expired_proposals_fail_closed(self):
        first = self.publish(content='alpha alpha beta')
        for hunks in [[{'before': 'alpha', 'after': 'changed', 'reason': 'A'}], [{'before': 'absent', 'after': 'changed', 'reason': 'A'}], [{'before': 'alpha alpha', 'after': 'changed', 'reason': 'A'}, {'before': 'alpha beta', 'after': 'changed', 'reason': 'B'}], []]:
            with self.assertRaises(ApiError): self.proposal(first, hunks)
        p = self.proposal(first, [{'before': 'beta', 'after': 'changed', 'reason': 'A'}])
        row = self.artifacts.patch(self.owner, self.conversation, p['id'])
        self.ai.update(self.owner, 'AI_ARTIFACT_PATCH', row, {'expiresAt': 1})
        self.assertEqual(self.artifacts.patches(self.owner, self.conversation, first['id'])[0]['status'], 'expired')
        with self.assertRaises(ApiError): self.decision(p)

    def test_scientific_input_save_removes_old_validation_and_never_executes(self):
        for format in ['qe', 'lammps', 'python', 'latex', 'markdown']:
            first = self.publish(kind='input_file', structuredData={'format': format, 'filename': 'fixture.in', 'text': 'old', 'validation': {'valid': True, 'issues': []}})
            saved = body(self.ai.handle(self.owner, 'POST', '/v1/ai/conversations/aic_artifact/artifact_edit', {'artifactId': first['id'], 'baseSha256': first['sha256'], 'text': 'new exact bytes\n', 'requestId': 'save_' + format}, {}))['artifact']
            self.assertEqual(saved['structuredData']['text'], 'new exact bytes\n')
            self.assertNotIn('validation', saved['structuredData']); self.assertEqual(saved['status'], 'draft')
        self.assertEqual(self.ai.services.list_owner_items(self.owner, 'CALCULATION'), [])
        self.assertEqual(self.ai.services.list_owner_items(self.owner, 'AI_ACTION'), [])

    def test_two_editors_cannot_fork_a_version(self):
        first = self.publish(content='common source')
        def save(index):
            try:
                return self.artifacts.edit(self.owner, self.conversation, {'artifactId': first['id'], 'baseSha256': first['sha256'], 'text': f'editor {index}', 'requestId': f'concurrent_{index}'})
            except ApiError: return None
        with ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(save, [1, 2]))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(len(self.artifacts.list(self.owner, self.conversation)), 2)

    def test_decision_crash_rolls_back_version_group_and_review_together(self):
        first = self.publish(content='common source')
        p = self.proposal(first, [{'before': 'source', 'after': 'updated', 'reason': 'A'}])
        update = self.ai.update
        def crash(owner, kind, row, values):
            if kind == 'AI_ARTIFACT_PATCH': raise RuntimeError('fixture crash after version write')
            return update(owner, kind, row, values)
        with patch.object(self.ai, 'update', crash):
            with self.assertRaises(RuntimeError): self.decision(p)
        self.assertEqual(len(self.artifacts.list(self.owner, self.conversation)), 1)
        self.assertEqual(self.artifacts.patches(self.owner, self.conversation, first['id'])[0]['hunks'][0]['decision'], 'pending')
        self.assertEqual(self.decision(p)['artifact']['version'], 2)

    def test_typed_payload_validation_and_owner_conversation_isolation(self):
        table = {'columns': [{'key': 'energy', 'label': 'Energy', 'unit': 'Ry'}], 'rows': [{'energy': -12.5}, {'energy': None}], 'sourceIds': ['C1']}
        artifact = self.publish(kind='table', structuredData=table)
        self.assertEqual(artifact['structuredData']['rows'][0]['energy'], -12.5)
        for data in [{**table, 'rows': [{'energy': float('nan')}]}, {**table, 'rows': [{'unknown': 1}]}, {**table, 'columns': [{'key': '__proto__', 'label': 'forged'}]}]:
            with self.assertRaises(ApiError): self.publish(kind='table', structuredData=data)
        for name in ['../qe.in', '/etc/passwd', '<script>.in']:
            with self.assertRaises(ApiError): self.publish(kind='input_file', structuredData={'format': 'qe', 'filename': name, 'text': '&CONTROL /'})
        for owner, conversation in [('another-owner', self.conversation), (self.owner, {'id': 'aic_other'})]:
            with self.assertRaises(ApiError): self.artifacts.get(owner, conversation, artifact['id'])

    def test_read_only_tasks_publish_without_project_actions_or_execution(self):
        for mode in ['plan', 'research', 'summary', 'work']:
            self.ai.update(self.owner, 'AI_RUN', self.ai.row(self.owner, 'AI_RUN', self.run['id']), {'taskMode': mode})
            result = body(self.ai.handle(self.owner, 'POST', '/v1/ai/conversations/aic_artifact/artifact_publish', {'runId': self.run['id'], 'lease': 'lease', 'kind': 'input_file', 'title': 'Draft input', 'status': 'draft', 'structuredData': {'format': 'qe', 'filename': 'draft.in', 'text': '&SYSTEM ecutwfc=80 /', 'validation': {'valid': True, 'issues': []}}}, {}))
            self.assertIn('Model-supplied', result['artifact']['structuredData']['validation']['note'])
        self.assertEqual(self.ai.services.list_owner_items(self.owner, 'AI_ACTION'), [])

    def test_legacy_reports_load_and_automatic_completion_avoids_duplicate_deliverable(self):
        legacy = self.ai.put(self.owner, 'AI_ARTIFACT', 'aid_legacy', {'conversationId': 'aic_artifact', 'kind': 'research', 'text': 'Legacy source', 'runId': 'old_run'})
        self.assertEqual(self.artifacts.get(self.owner, self.conversation, legacy['id'])['kind'], 'research')
        self.publish()
        self.ai.message(self.owner, self.conversation, self.run, 'assistant', 'Additional narrative')
        from backend.local_api.domain.ai_workbench import AiWorkbench
        AiWorkbench(self.ai).complete(self.owner, self.conversation, self.run, 'completed')
        self.assertEqual(len(self.artifacts.list(self.owner, self.conversation)), 2)
