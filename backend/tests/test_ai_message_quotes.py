"""Quotes are owner/project scoped saved model output, never research authority."""
from pathlib import Path
import tempfile
import unittest
from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, digest
from backend.local_api.domain.ai_workbench import AiWorkbench
from backend.local_api.domain.phynite_core import ApiError


class AiMessageQuoteTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        services = LocalServices(Path(temporary.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.ai = AiWorkspace(PhyniteApi(services)); self.owner = services.owner
        self.origin = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_source', {'projectKey': 'project:fixture'})
        self.target = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_target', {'projectKey': 'project:fixture'})
        self.text = '🧪 Compare **80 Ry**; convergence is unverified.'
        self.message = self.ai.put(self.owner, 'AI_MESSAGE#aic_source', 'aim_source', {'conversationId': 'aic_source', 'runId': 'air_source', 'role': 'assistant', 'text': self.text})
        start = self.text.index('80 Ry')
        self.ref = {'kind': 'message', 'id': 'aim_source', 'conversationId': 'aic_source', 'start': start, 'end': start + 5, 'quote': '80 Ry'}

    def resolve(self, **changes):
        return AiWorkbench(self.ai).resolve(self.owner, self.target, [{**self.ref, **changes}])[0]

    def test_source_identity_exact_unicode_range_and_uncertainty_survive_side_chat(self):
        source = self.resolve()
        self.assertEqual(source['ref'], self.ref)
        self.assertEqual(source['value']['text'], '80 Ry')
        self.assertEqual(source['value']['sourceSha256'], digest(self.text))
        self.assertEqual(source['value']['runId'], 'air_source')
        self.assertTrue(source['value']['untrusted'])
        self.assertIn('not verified scientific evidence', source['value']['note'])

    def test_tampered_quotes_ranges_roles_and_project_scope_are_rejected(self):
        for changed in [{'quote': '40 Ry'}, {'start': True}, {'end': 9000}, {'start': -1}]:
            with self.subTest(changed=changed), self.assertRaises(ApiError): self.resolve(**changed)
        with self.assertRaises(ApiError): AiWorkbench(self.ai).resolve('another-owner', self.target, [self.ref])
        with self.assertRaises(ApiError): AiWorkbench(self.ai).resolve(self.owner, {**self.target, 'projectKey': 'project:other'}, [self.ref])
        self.ai.update(self.owner, 'AI_MESSAGE#aic_source', self.message, {'role': 'user'})
        with self.assertRaises(ApiError): self.resolve()

    def test_deleted_origin_and_changed_source_cannot_be_quoted_from_stale_drafts(self):
        self.ai.update(self.owner, 'AI_MESSAGE#aic_source', self.message, {'text': 'Changed source'})
        with self.assertRaises(ApiError): self.resolve()
        self.ai.update(self.owner, 'AI_CONVERSATION', self.origin, {'deletedAt': 'fixture'})
        with self.assertRaises(ApiError): self.resolve()
