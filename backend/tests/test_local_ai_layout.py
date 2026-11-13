"""Frozen Canvas payloads persist exact preview geometry and reject stale approvals."""
import copy
import json
from pathlib import Path
import tempfile
import time
import unittest

from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.project_workflow import ProjectWorkflowApi


class FrozenLayoutTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.owner = services.owner
        self.api = PhyniteApi(services)
        self.ai = AiWorkspace(self.api)
        self.workflow = ProjectWorkflowApi(self.api)
        self.project = body(self.api.create_project(self.owner, {'name': 'Frozen layout fixture'}))['project']['id']
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_layout', {'projectKey': 'project:' + self.project, 'mode': 'approval', 'activeRunId': 'air_layout', 'title': 'Layout'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_layout', {'conversationId': 'aic_layout', 'status': 'running', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('fixture'), 'taskMode': 'work', 'modelId': 'fixture-model'})
        self.graph = {'version': 1, 'projectId': self.project, 'nodes': [{'id': 's', 'kind': 'structure', 'name': 'Unconfigured structure', 'position': {'x': 123.25, 'y': -47.125}, 'configuration': {}, 'resources': []}], 'edges': [], 'groups': []}

    def prepare(self):
        return self.ai.prepare(self.owner, self.conversation, self.run, {'kind': 'save_workflow', 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'payload': {'workflow': self.graph, 'baseRevision': 0, 'nodeIds': ['s'], 'changes': [], 'layout': {'engine': 'elk-layered', 'version': '0.12.1', 'mode': 'touched', 'frozen': True}}})

    def test_exact_reviewed_payload_is_applied_once_without_layout_recomputation(self):
        action = self.prepare()
        reviewed = body(self.ai.handle(self.owner, 'GET', '/v1/ai/conversations/aic_layout/actions/' + action['id'], {}, {}))['preview']
        self.assertEqual(reviewed['workflow'], self.graph)
        self.assertEqual(digest(reviewed), action['payloadHash'])
        self.graph['nodes'][0]['position']['x'] = 999  # no reference sharing with persisted payload
        applied = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(applied['status'], 'succeeded', json.dumps(applied))
        saved = self.workflow.load(self.owner, self.project)
        self.assertEqual(saved['workflow'], reviewed['workflow'])
        self.assertEqual(saved['revision'], 1)
        self.ai.execute(self.owner, self.conversation, applied, applied['payloadHash'])
        self.assertEqual(self.workflow.load(self.owner, self.project)['revision'], 1)

    def test_saved_revision_change_expires_action_instead_of_applying_old_preview(self):
        action = self.prepare()
        other = copy.deepcopy(self.graph)
        other['nodes'][0]['position']['x'] = -999
        self.workflow.save(self.owner, self.project, {'workflow': other, 'baseRevision': 0})
        result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'expired')
        self.assertEqual(self.workflow.load(self.owner, self.project)['workflow'], other)
