"""Immutable artifact versions, isolated overflow and deterministic typed validation."""
import json
from pathlib import Path
import tempfile
import time
import unittest
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
        second = self.artifacts.publish(self.owner, self.conversation, self.run, {'artifactId': first['id'], 'content': 'Corrected with source C2.'}, True)
        self.assertEqual(second['version'], 2); self.assertEqual(second['parentArtifactId'], first['id'])
        self.assertEqual(second['artifactGroupId'], first['artifactGroupId'])
        self.assertEqual(self.artifacts.get(self.owner, self.conversation, first['id'])['content'], first['content'])
        with self.assertRaises(ApiError): self.artifacts.publish(self.owner, self.conversation, self.run, {'artifactId': first['id'], 'content': 'stale edit'}, True)
        with self.assertRaises(ApiError): self.publish(artifactGroupId=first['artifactGroupId'], kind='table', structuredData={'columns': [], 'rows': [], 'sourceIds': []})

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
