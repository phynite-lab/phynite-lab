"""JSON-lines test harness: ephemeral real core, synthetic qualification only.

Never import this from production. No cloud, provider credentials or scientific jobs.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

from backend.local_api.ai_orchestration import AiOrchestration
from backend.local_api.domain.ai_runtime import AiRuntime
from backend.local_api.domain.ai_workspace import AiWorkspace, body
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError, json_safe
from backend.local_api.services import LocalServices

with tempfile.TemporaryDirectory() as directory:
    services = LocalServices(Path(directory), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
    api, executor, counter = PhyniteApi(services), 'fixture_executor', 0
    authority = AiOrchestration(api)
    services.ai_orchestration = authority
    if os.environ.get('PHYNITE_EXECUTOR_UNREGISTERED') != '1':
        authority.private('register', {'executorId': executor})
    ai, runtime = AiWorkspace(api), AiRuntime(api)
    project = body(api.create_project(services.owner, {'name': 'Synthetic executor fixture'}))['project']['id']
    for line in sys.stdin:
        try:
            request = json.loads(line)
            operation, data = request['operation'], request.get('data', {})
            if operation == 'setup':
                counter += 1
                conversation = ai.put(services.owner, 'AI_CONVERSATION', f'aic_executor{counter}', {
                    'projectKey': 'project:' + project, 'mode': 'chat', 'activeRunId': None,
                    'title': 'New research conversation', 'modelId': data.get('modelId', 'codex/fixture'),
                    'providerId': 'local', 'effort': 'auto', 'queuePaused': False})
                with patch.object(authority, 'qualified', return_value=data.get('qualified', True)):
                    runtime.handle(services.owner, conversation, 'POST', 'queue', None, {
                        'text': data.get('goal', 'Review independent sources A and B, then synthesize with evidence.'),
                        'clientMessageId': f'executor_message{counter}', 'strategy': data.get('strategy', 'auto')}, {})
                    result = {'conversationId': conversation['id']} if data.get('enqueueOnly') else authority.private('claim', {'executorId': executor})
            elif operation == 'metrics':
                run = authority.get('AI_RUN', data['parentId'])
                result = {'inference': authority.rows('AI_INFERENCE'), 'usage': json_safe(run.get('usage')), 'messages': ai.detail(services.owner, authority.get('AI_CONVERSATION', run['conversationId']))['messages']}
            elif operation == 'stop':
                result = authority.ai_request(data['conversationId'], 'stop', {'runId': data['parentId']})
            elif operation == 'steer':
                conversation = authority.get('AI_CONVERSATION', data['conversationId'])
                queued = body(runtime.handle(services.owner, conversation, 'POST', 'queue', None, {
                    'text': 'Changed objective. Read only source A.', 'clientMessageId': 'steering_message'}, {}))['message']
                result = body(runtime.handle(services.owner, authority.get('AI_CONVERSATION', conversation['id']),
                              'POST', 'steer', queued['id'], {}, {}))
            elif operation == 'public':
                result = authority.public_request(data['conversationId'], data['action'], data)
            elif operation == 'restart':
                authority = AiOrchestration(api)
                services.ai_orchestration = authority
                authority.private('register', {'executorId': executor})
                result = {'restarted': True}
            else:
                result = authority.private(operation, {'executorId': executor, **data})
            print(json.dumps({'id': request['id'], 'result': result}), flush=True)
        except Exception as error:
            print(json.dumps({'id': request.get('id'), 'error': str(error),
                              'code': error.code if isinstance(error, ApiError) else type(error).__name__}), flush=True)
