"""Real local action lifecycle with synthetic MCP responses; no scientific claims."""
import copy
import json
import tempfile
import time
from pathlib import Path
import unittest
from unittest.mock import patch
from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, digest, body
from backend.local_api.domain.ai_mcp import AiMcp, bridge
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.ai_custom_skills import CustomSkills


class AiMcpTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.services = LocalServices(Path(temporary.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.owner = self.services.owner; self.api = PhyniteApi(self.services); self.ai = AiWorkspace(self.api)
        project = body(self.api.create_project(self.owner, {'name': 'MCP fixture'}))['project']['id']
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_mcp', {'projectKey': 'project:' + project, 'mode': 'approval', 'activeRunId': 'air_mcp'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_mcp', {'conversationId': 'aic_mcp', 'mode': 'approval', 'status': 'running', 'taskMode': 'work', 'modelId': 'fixture', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('fixture-lease')})
        self.tools = [{'name': 'mcp__fixture__' + name, 'serverId': 'fixture', 'toolHash': letter * 64, 'readOnly': read, 'input_schema': {'type': 'object'}, 'description': 'Synthetic fixture'} for name, letter, read in [('read', 'a', True), ('write', 'b', False)]]
        self.calls = []
        def fake(operation, payload=None):
            if operation == 'tools': return {'tools': copy.deepcopy(self.tools)}
            if operation == 'call': self.calls.append(copy.deepcopy(payload)); return {'content': [{'type': 'text', 'text': 'Synthetic fixture result'}]}
            return {'valid': True}
        mocked = patch('backend.local_api.domain.ai_mcp.bridge', side_effect=fake); mocked.start(); self.addCleanup(mocked.stop)

    def payload(self, write=False):
        tool = self.tools[int(write)]
        return {'name': tool['name'], 'toolHash': tool['toolHash'], 'readOnly': tool['readOnly'], 'arguments': {'query': 'Fixture'}}

    def prepared(self):
        return self.ai.prepare(self.owner, self.conversation, self.run, {'kind': 'mcp_call', 'toolName': self.tools[1]['name'], 'payload': self.payload(True), 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'toolCallId': 'fixture-write'})

    def test_read_only_mapping_holds_for_every_task_permission_and_selected_project(self):
        mcp = AiMcp(self.ai)
        for mode in ['chat', 'approval', 'full']:
            for task in ['work', 'plan', 'research', 'summary']:
                catalogue = mcp.tools({**self.conversation, 'mode': mode}, {**self.run, 'taskMode': task})
                self.assertEqual(len(catalogue), 2 if mode != 'chat' and task == 'work' else 1)
        self.assertEqual(len(mcp.tools({**self.conversation, 'projectKey': None}, self.run)), 1)
        self.assertEqual(len(mcp.tools(self.conversation, {**self.run, 'skillSnapshot': {'allowedTools': []}})), 0)
        with self.assertRaises(ApiError): mcp.read(self.conversation, self.run, self.payload(True))
        self.assertEqual(self.calls, [])

    def test_mutation_waits_for_exact_approval_and_executes_once(self):
        action = self.prepared(); self.assertEqual(action['status'], 'pending'); self.assertEqual(self.calls, [])
        self.assertEqual(action['after']['arguments'], {'query': 'Fixture'})
        with self.assertRaises(ApiError): self.ai.execute(self.owner, self.conversation, action, '0' * 64)
        result = body(self.ai.handle(self.owner, 'POST', '/v1/ai/conversations/aic_mcp/actions/' + action['id'], {'decision': 'approve', 'payloadHash': action['payloadHash']}, {}))['action']
        self.assertEqual(result['status'], 'succeeded', result); self.assertEqual(len(self.calls), 1)
        again = self.ai.execute(self.owner, self.conversation, self.ai.row(self.owner, 'AI_ACTION', action['id']), action['payloadHash'])
        self.assertEqual(again['status'], 'succeeded'); self.assertEqual(len(self.calls), 1)

    def test_changed_tool_disabled_server_and_other_owner_never_call(self):
        action = self.prepared(); self.tools[1]['toolHash'] = 'c' * 64
        with self.assertRaises(ApiError): self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.tools.clear()
        with self.assertRaises(ApiError): self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        with self.assertRaises(ApiError): self.ai.handle('other-owner', 'POST', '/v1/ai/conversations/aic_mcp/mcp_call', {'runId': 'air_mcp', 'lease': 'fixture-lease', **self.payload_safe()}, {})
        self.assertEqual(self.calls, [])

    def payload_safe(self): return {'name': 'mcp__fixture__read', 'toolHash': 'a' * 64, 'readOnly': True, 'arguments': {}}

    def test_rejected_expired_and_failed_actions_never_report_success(self):
        action = self.prepared()
        self.ai.update(self.owner, 'AI_ACTION', action, {'status': 'rejected'})
        with self.assertRaises(ApiError): self.ai.execute(self.owner, self.conversation, self.ai.row(self.owner, 'AI_ACTION', action['id']), action['payloadHash'])
        self.assertEqual(self.calls, [])
        expired = self.ai.update(self.owner, 'AI_ACTION', self.ai.row(self.owner, 'AI_ACTION', action['id']), {'status': 'pending', 'expiresAt': 0})
        self.assertEqual(self.ai.execute(self.owner, self.conversation, expired, expired['payloadHash'])['status'], 'expired')
        self.assertEqual(self.calls, [])
        current = self.ai.update(self.owner, 'AI_ACTION', self.ai.row(self.owner, 'AI_ACTION', action['id']), {'status': 'pending', 'expiresAt': int(time.time()) + 900})
        def failing(operation, payload=None):
            return {'tools': copy.deepcopy(self.tools)} if operation == 'tools' else {'valid': True} if operation == 'validate' else {'isError': True, 'content': []}
        with patch('backend.local_api.domain.ai_mcp.bridge', side_effect=failing):
            result = self.ai.execute(self.owner, self.conversation, current, current['payloadHash'])
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['code'], 'MCP_TOOL_FAILED')

    def test_custom_skills_can_select_current_mcp_tools_but_never_grant_mutations_in_plan(self):
        name = self.tools[1]['name']
        saved = CustomSkills(self.ai).save(self.owner, {'command': 'mcp_review', 'label': 'MCP review', 'description': 'Synthetic fixture', 'instruction': 'Use allowed evidence', 'allowedTaskModes': None, 'allowedTools': [name]})
        self.assertEqual(saved['allowedTools'], [name])
        self.assertEqual(AiMcp(self.ai).tools(self.conversation, {**self.run, 'taskMode': 'plan', 'skillSnapshot': saved}), [])
        self.run = self.ai.update(self.owner, 'AI_RUN', self.run, {'skillSnapshot': {'allowedTools': [self.tools[0]['name']]}})
        with self.assertRaises(ApiError): self.prepared()
        self.assertEqual(self.calls, [])

    def test_read_route_requires_live_run_and_lease(self):
        route = '/v1/ai/conversations/aic_mcp/mcp_call'
        with self.assertRaises(ApiError): self.ai.handle(self.owner, 'POST', route, {'runId': 'air_mcp', 'lease': 'wrong', **self.payload()}, {})
        result = body(self.ai.handle(self.owner, 'POST', route, {'runId': 'air_mcp', 'lease': 'fixture-lease', **self.payload()}, {}))
        self.assertEqual(result['content'][0]['text'], 'Synthetic fixture result')
        self.assertEqual(len(self.calls), 1)

    def test_hosted_or_arbitrary_bridge_destinations_fail_before_network(self):
        # Use original function rather than the synthetic bridge mock.
        for origin in ['https://example.test', 'http://localhost:1234', 'http://127.0.0.1:1234/redirect', 'http://127.0.0.1:1234?token=bad']:
            with patch.dict('os.environ', {'PHYNITE_APP_MODE': 'local', 'PHYNITE_LOCAL_AI_URL': origin, 'PHYNITE_LOCAL_AI_TOKEN': 'fixture'}), self.assertRaises(ApiError): bridge('tools')
        with patch.dict('os.environ', {'PHYNITE_APP_MODE': 'cloud'}), self.assertRaises(ApiError): bridge('tools')
