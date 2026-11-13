"""Real local broker persistence, scope, immutable image checksums and revocation."""
import io
import tempfile
import time
import unittest
from pathlib import Path
from PIL import Image
from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.ai_viewport import AiViewport
from backend.local_api.domain.ai_attachments import AiAttachments
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.project_workflow import ProjectWorkflowApi


class AiViewportTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.api = PhyniteApi(self.services); self.ai = AiWorkspace(self.api); self.owner = self.services.owner
        self.project = body(self.api.create_project(self.owner, {'name': 'Capture fixture'}))['project']['id']
        self.workflow = ProjectWorkflowApi(self.api)
        saved = self.workflow.load(self.owner, self.project)
        graph = saved['workflow']; graph['nodes'].append({'id': 'crystal', 'kind': 'structure', 'name': 'Crystal', 'position': {'x': 0, 'y': 0}, 'configuration': {}, 'resources': []})
        self.workflow.save(self.owner, self.project, {'workflow': graph, 'baseRevision': saved['revision']})
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_capture', {'projectKey': 'project:' + self.project, 'mode': 'chat', 'activeRunId': 'air_capture'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_capture', {'conversationId': 'aic_capture', 'status': 'running', 'taskMode': 'research', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('lease')})
        self.capture = AiViewport(self.ai)

    def enable(self):
        return self.capture.permission(self.owner, self.conversation, {'enabled': True, 'revision': self.capture.permission(self.owner, self.conversation)['revision']})

    def request(self, call_id='fixture'):
        return self.capture.request(self.owner, self.conversation, self.run, {'sourceRef': {'kind': 'node', 'id': 'crystal'}, 'toolCallId': call_id})

    def image(self):
        stream = io.BytesIO(); Image.new('RGB', (10, 10), 'blue').save(stream, 'PNG'); raw = stream.getvalue()
        attachments = AiAttachments(self.api)
        item = body(attachments.handle(self.owner, self.conversation, 'POST', None, None, {'filename': 'fixture.png', 'sha256': __import__('hashlib').sha256(raw).hexdigest(), 'sizeBytes': len(raw)}))['attachment']
        stored = attachments.get(self.owner, self.conversation, item['id'])
        self.services.s3.put_object(Bucket=self.services.bucket, Key=stored['objectKey'], Body=raw)
        attachments.handle(self.owner, self.conversation, 'POST', item['id'], 'complete', {})
        return {'attachmentId': item['id'], 'metadata': {'kind': 'crystal', 'camera': {}, 'projection': 'orthographic', 'selection': [], 'periodicImages': [1,1,1], 'axes': ['a','b','c'], 'units': 'angstrom', 'energyReference': None, 'displaySha256': 'a'*64}}

    def test_opt_in_is_per_conversation_revisioned_and_cancels_pending_and_ready(self):
        with self.assertRaises(ApiError): self.request()
        self.enable(); first = self.request(); self.assertEqual(self.request()['id'], first['id'])
        ready = self.capture.complete(self.owner, self.conversation, first['id'], self.image())
        self.assertEqual(ready['status'], 'ready'); self.assertEqual(len(ready['attachmentSha256']), 64)
        self.assertEqual(ready['metadata']['source']['ref']['revision'], 1)
        permission = self.capture.permission(self.owner, self.conversation)
        self.capture.permission(self.owner, self.conversation, {'enabled': False, 'revision': permission['revision']})
        self.assertEqual(self.capture.get(self.owner, self.conversation, first['id'])['status'], 'cancelled')
        with self.assertRaises(ApiError): self.capture.complete(self.owner, self.conversation, first['id'], self.image())
        with self.assertRaises(ApiError): self.capture.permission(self.owner, self.conversation, {'enabled': True, 'revision': permission['revision']})

    def test_expiry_source_drift_stop_and_scope_fail_closed(self):
        self.enable(); first = self.request()
        other = {**self.conversation, 'id': 'aic_other'}
        with self.assertRaises(ApiError): self.capture.get(self.owner, other, first['id'])
        with self.assertRaises(ApiError): self.capture.get('other-owner', self.conversation, first['id'])
        saved = self.workflow.load(self.owner, self.project); saved['workflow']['nodes'][0]['name'] = 'Changed'
        self.workflow.save(self.owner, self.project, {'workflow': saved['workflow'], 'baseRevision': saved['revision']})
        self.assertEqual(self.capture.get(self.owner, self.conversation, first['id'])['status'], 'cancelled')
        second = self.request('second'); row = self.ai.row(self.owner, 'AI_CAPTURE', second['id']); self.ai.update(self.owner, 'AI_CAPTURE', row, {'expiresAt': 1})
        self.assertEqual(self.capture.get(self.owner, self.conversation, second['id'])['status'], 'cancelled')
        third = self.request('third'); self.ai.update(self.owner, 'AI_RUN', self.run, {'status': 'stopped'})
        self.assertEqual(self.capture.get(self.owner, self.conversation, third['id'])['status'], 'cancelled')

    def test_invalid_metadata_is_not_silently_accepted(self):
        self.enable(); first = self.request(); image = self.image()
        with self.assertRaises(ApiError): self.capture.complete(self.owner, self.conversation, first['id'], {**image, 'metadata': {'units': 'made up'}})
        image['metadata']['camera'] = {'x': float('nan')}
        with self.assertRaises(ApiError): self.capture.complete(self.owner, self.conversation, first['id'], image)
