"""Local authority for durable, bounded coordinator/specialist work.

The launcher executor owns no database or public listener. Inference reservations,
leases, control revisions and task budgets are enforced here, including after a crash.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import threading
import time
from typing import Any

from .domain.phynite_core import ApiError, owner_partition, storage_owner, utc_now, json_safe
from .domain.ai_workspace import AiWorkspace, body, clean, digest
from .domain.ai_runtime import AiRuntime

READS = {
    'context', 'read', 'canvas', 'job_artifacts', 'job_file', 'dataset_query',
    'potential_search', 'jobs', 'job_status', 'worker_status',
    'calculation_diagnosis', 'md_preview', 'attachment_read', 'attachment_search',
    'artifact_get', 'report',
}
TERMINAL = {'completed', 'failed', 'cancelled', 'stale', 'stopped', 'interrupted'}
LIMITS = {'providerCalls': 30, 'toolCalls': 40, 'specialists': 6,
          'specialistProviderCalls': 8, 'specialistToolCalls': 12,
          'coordinatorProviderReserve': 6, 'coordinatorToolReserve': 4,
          'executionSeconds': 900, 'specialistSeconds': 300,
          'capacityWaitSeconds': 600, 'parentAgeSeconds': 3600}


def fail(message: str, code: str = 'AI_ORCHESTRATION_CONFLICT', status: int = 409):
    raise ApiError(status, message, code)


def platform_id() -> str:
    system, machine = platform.system().lower(), platform.machine().lower()
    if system == 'linux' and 'microsoft' in platform.release().lower():
        system = 'linux-wsl2' if 'wsl2' in platform.release().lower() else 'unsupported-wsl1'
    return system + '-' + machine


def bounded_text(value: str, size: int = 32768) -> str:
    return value.encode('utf-8')[:size].decode('utf-8', errors='ignore')


class AiOrchestration:
    def __init__(self, api):
        self.api, self.s, self.owner = api, api.services, api.services.owner
        self.ai, self.runtime = AiWorkspace(api), AiRuntime(api)
        self.lock = threading.RLock()
        self.writers: dict[str, threading.RLock] = {}
        with self.lock, self.s.table.atomic():
            self.put('AI_EXECUTOR', 'primary', {'executorId': None, 'leaseUntil': 0})
            for parent in self.rows('AI_ORCHESTRATION'):
                if parent['status'] == 'running':
                    self.interrupt(parent, 'Executor restarted. Review retained work and choose Continue.')

    def rows(self, kind: str) -> list[dict]:
        return json_safe(self.s.list_owner_items(self.owner, kind))

    def get(self, kind: str, key: str) -> dict:
        row = self.s.get_item(self.owner, kind, key)
        if not row or row.get('ownerId') != self.owner:
            fail('This task is not in the local workspace.', 'AI_NOT_FOUND', 404)
        return json_safe(row)

    def put(self, kind: str, key: str, values: dict) -> dict:
        row = {'PK': owner_partition(self.owner), 'SK': kind + '#' + key,
               'id': key, 'entityType': kind, 'ownerId': self.owner, **values}
        self.s.put_item(row)
        return row

    def update(self, kind: str, row: dict, **values) -> dict:
        return json_safe(self.s.update_item(self.owner, kind, row['id'], values))

    def tasks(self, parent: dict, *, all_plans: bool = False) -> list[dict]:
        return sorted([task for task in self.rows('AI_AGENT_TASK')
                       if task['parentId'] == parent['id'] and
                       (all_plans or task['planRevision'] == parent['planRevision'])],
                      key=lambda task: (task['planRevision'], task['index']))

    def public(self, parent: dict) -> dict:
        def visible(row):
            return clean({key: value for key, value in row.items()
                          if key not in {'PK', 'SK', 'lease', 'executorId', 'resultKey', 'checkpointKey'}})
        return {'parent': visible(parent), 'tasks': [visible(task) for task in self.tasks(parent)],
                'limits': LIMITS, 'usage': {'cost': None, 'label': 'Belum tersedia'}}

    def qualified(self, model: str) -> bool:
        """Fail closed: a synthetic benchmark can never qualify a native provider."""
        if os.environ.get('PHYNITE_AI_TEAM') != '1':
            return False
        try:
            path = Path(os.environ.get('PHYNITE_AI_TEAM_QUALIFICATION', ''))
            qualification = json.loads(path.read_text())
            target = platform_id()
            if target not in {'darwin-arm64', 'linux-x86_64', 'linux-aarch64', 'linux-wsl2-x86_64', 'linux-wsl2-aarch64'}:
                return False
            if qualification.get('schemaVersion') != 1:
                return False
            for entry in qualification.get('entries', []):
                if entry.get('modelId') != model or entry.get('platform') != target or entry.get('passed') is not True:
                    continue
                evidence_path = path.parent / entry.get('evidenceFile', '')
                raw = evidence_path.read_bytes()
                if len(raw) > 2_000_000 or hashlib.sha256(raw).hexdigest() != entry.get('evidenceSha256'):
                    continue
                evidence = json.loads(raw)
                if (evidence.get('schemaVersion') == 1 and evidence.get('kind') == 'native-provider'
                        and evidence.get('modelId') == model and evidence.get('platform') == target
                        and evidence.get('safetyPassed') is True
                        and evidence.get('evidenceQualityReviewed') is True
                        and evidence.get('overlapObserved') is True
                        and all(evidence.get('runs', {}).get(strategy, {}).get('status') == 'completed'
                                for strategy in ('solo', 'team'))):
                    return True
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        return False

    @contextmanager
    def project_writer(self, project_key: str):
        with self.lock:
            writer = self.writers.setdefault(project_key or 'none', threading.RLock())
        with writer:
            yield

    def ai_request(self, conversation_id: str, operation: str, data: dict) -> dict:
        return body(self.ai.handle(self.owner, 'POST',
                                  f'/v1/ai/conversations/{conversation_id}/{operation}', data, {}))

    def freeze_clock(self, parent: dict) -> dict:
        elapsed = parent.get('executionSeconds', 0)
        if parent.get('executionStartedEpoch'):
            elapsed += max(0, time.time() - parent['executionStartedEpoch'])
        return {'executionSeconds': elapsed, 'executionStartedEpoch': None}

    def task_clock(self, task: dict) -> dict:
        elapsed = task.get('executionSeconds', 0)
        if task.get('startedEpoch'):
            elapsed += max(0, time.time() - task['startedEpoch'])
        return {'executionSeconds': elapsed, 'startedEpoch': None}

    def interrupt(self, parent: dict, reason: str, status: str = 'interrupted') -> dict:
        parent = self.update('AI_ORCHESTRATION', parent, status=status,
                             generation=parent['generation'] + 1, reason=reason,
                             leaseUntil=0, **self.freeze_clock(parent))
        for task in self.tasks(parent, all_plans=True):
            if task['status'] == 'running' or task['status'] == 'queued' and status in {'stopped', 'stale', 'failed'}:
                self.update('AI_AGENT_TASK', task, status=status,
                            generation=task['generation'] + 1, error=reason, **self.task_clock(task))
        for slot in self.rows('AI_INFERENCE'):
            if slot['parentId'] == parent['id'] and slot['status'] in {'queued', 'active'}:
                self.update('AI_INFERENCE', slot, status='cancelled')
        if status in {'interrupted', 'failed'}:
            run = self.get('AI_RUN', parent['id'])
            if run['status'] == 'running' or run['status'] == 'awaiting_approval' and status == 'failed':
                self.update('AI_RUN', run, status='failed', failure={
                    'code': 'AI_EXECUTOR_INTERRUPTED', 'message': reason})
                conversation = self.get('AI_CONVERSATION', parent['conversationId'])
                self.runtime.finish(self.owner, conversation, run, 'failed')
        return parent

    def stop_parent(self, parent_id: str):
        # Stop also fences a continuation waiting to be claimed and a parent
        # paused for approval. Neither state has a live executor heartbeat.
        with self.lock, self.s.table.atomic():
            parent = self.get('AI_ORCHESTRATION', parent_id)
            if parent['status'] != 'stopped':
                self.interrupt(parent, 'AI stopped. Scientific jobs are separate.', 'stopped')

    def reconcile(self):
        with self.lock, self.s.table.atomic():
            now = time.time()
            for parent in self.rows('AI_ORCHESTRATION'):
                if parent['status'] != 'running':
                    continue
                run = self.get('AI_RUN', parent['id'])
                if run['status'] == 'stopped':
                    self.interrupt(parent, 'AI stopped. Scientific jobs are separate.', 'stopped')
                    continue
                if run.get('controlRevision', 0) != parent['controlRevision']:
                    parent = self.interrupt(parent, 'Direction changed; previous proposals are superseded.', 'stale')
                    self.update('AI_ORCHESTRATION', parent, status='queued', planReady=False,
                                planRevision=parent['planRevision'] + 1,
                                controlRevision=run.get('controlRevision', 0))
                    continue
                elapsed = self.freeze_clock(parent)['executionSeconds']
                if now - parent['createdEpoch'] >= 3600 or elapsed >= 900:
                    self.interrupt(parent, 'Parent time budget reached. Partial work is retained.', 'failed')
                    continue
                if parent['leaseUntil'] < now:
                    self.interrupt(parent, 'Executor heartbeat expired. Choose Continue; inference was not retried.')
                    continue
                for task in self.tasks(parent):
                    if task['status'] == 'running' and task.get('startedEpoch') and self.task_clock(task)['executionSeconds'] >= 300:
                        self.update('AI_AGENT_TASK', task, status='failed', generation=task['generation'] + 1,
                                    error='Five-minute specialist limit reached. Partial work is retained.', **self.task_clock(task))
            for slot in self.rows('AI_INFERENCE'):
                if slot['status'] not in {'queued', 'active'}:
                    continue
                parent = self.get('AI_ORCHESTRATION', slot['parentId'])
                task = self.get('AI_AGENT_TASK', slot['taskId']) if slot.get('taskId') else None
                if (parent['status'] != 'running' or slot['generation'] != parent['generation']
                        or task and (task['status'] != 'running' or slot.get('taskGeneration') != task['generation'])):
                    self.update('AI_INFERENCE', slot, status='cancelled')
                elif slot['status'] == 'queued' and now - slot['queuedEpoch'] >= 600:
                    self.update('AI_INFERENCE', slot, status='expired')

    def fence(self, payload: dict, *, allow_finished: bool = False) -> tuple[dict, dict]:
        parent = self.get('AI_ORCHESTRATION', str(payload.get('parentId', '')))
        if (parent['status'] != 'running' or parent['generation'] != payload.get('generation')
                or parent.get('executorId') != payload.get('executorId') or parent['leaseUntil'] < time.time()):
            fail('This executor generation no longer owns the parent.', 'AI_EXECUTOR_FENCED')
        run = self.get('AI_RUN', parent['id'])
        if run['status'] not in ({'running', 'awaiting_approval', 'completed', 'failed'} if allow_finished else {'running', 'awaiting_approval'}) or run.get('controlRevision', 0) != parent['controlRevision']:
            fail('The AI turn stopped or received new direction.', 'AI_EXECUTOR_FENCED')
        self.ai.scope(self.owner, parent.get('projectKey'))
        return parent, run

    def task_fence(self, parent: dict, payload: dict) -> dict | None:
        if not payload.get('taskId'):
            return None
        task = self.get('AI_AGENT_TASK', payload['taskId'])
        if (task['parentId'] != parent['id'] or task['planRevision'] != parent['planRevision']
                or task['status'] != 'running' or task['generation'] != payload.get('taskGeneration')):
            fail('This specialist was stopped or replaced.', 'AI_TASK_FENCED')
        return task

    def claim(self, payload: dict) -> dict:
        executor = payload.get('executorId')
        if not isinstance(executor, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', executor):
            fail('Choose a valid executor identity.', status=400)
        parent = next((p for p in sorted(self.rows('AI_ORCHESTRATION'), key=lambda p: p['createdEpoch'])
                       if p['status'] == 'queued'), None)
        if parent:
            if time.time() - parent['createdEpoch'] >= 3600:
                self.interrupt(parent, 'Parent age limit reached.', 'failed')
                return {'idle': True}
            conversation = self.get('AI_CONVERSATION', parent['conversationId'])
            self.ai.scope(self.owner, conversation.get('projectKey'))
            run = self.get('AI_RUN', parent['id'])
            lease = secrets.token_hex(32)
            self.ai.update(self.owner, 'AI_RUN', run, {'status': 'running', 'leaseHash': digest(lease),
                           'expiresAt': int(time.time()) + 900})
            parent = self.update('AI_ORCHESTRATION', parent, status='running', executorId=executor,
                                 lease=lease, leaseUntil=time.time() + 30, generation=parent['generation'] + 1)
            return {**self.public(parent), 'detail': self.ai.detail(self.owner, self.get('AI_CONVERSATION', conversation['id']))}
        for conversation in sorted(self.rows('AI_CONVERSATION'), key=lambda c: c.get('updatedAt', '')):
            if conversation.get('deletedAt') or conversation.get('queuePaused'):
                continue
            active = self.s.get_item(self.owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
            if active and active['status'] in {'running', 'awaiting_approval'}:
                continue
            queued = [q for q in self.runtime.queue(self.owner, conversation) if q['status'] == 'queued']
            if not queued:
                continue
            self.ai.scope(self.owner, conversation.get('projectKey'))
            if time.time() - float(queued[0]['order']) / 1e9 >= 3600:
                self.ai.update(self.owner, 'AI_QUEUE#' + conversation['id'], queued[0], {'status': 'cancelled', 'error': 'Queue age exceeded one hour; resend explicitly.'})
                continue
            detail = self.runtime.claim(self.owner, conversation, foreground=True, queue_id=queued[0]['id'])
            run, now = detail['run'], time.time()
            parent = self.put('AI_ORCHESTRATION', run['id'], {
                'schemaVersion': 2, 'conversationId': conversation['id'], 'projectKey': conversation.get('projectKey'),
                'modelId': run['modelId'], 'providerId': run.get('providerId'),
                'strategy': queued[0].get('strategy', 'auto'), 'teamQualified': self.qualified(run['modelId']),
                'status': 'running', 'generation': 1, 'controlRevision': run.get('controlRevision', 0),
                'executorId': executor, 'lease': detail['lease'], 'leaseUntil': now + 30,
                'createdEpoch': now, 'executionSeconds': 0, 'executionStartedEpoch': None,
                'providerCalls': 0, 'toolCalls': 0, 'planReady': False, 'planRevision': 1,
                'checkpoint': None, 'createdAt': utc_now(), 'reason': None})
            self.s.update_item(self.owner, 'AI_RUN', run['id'], {'orchestrationId': run['id']})
            if parent['strategy'] == 'team' and not parent['teamQualified']:
                self.interrupt(parent, 'Team qualification changed before dispatch; choose Auto or Solo.', 'failed')
                continue
            return {**self.public(parent), 'detail': self.ai.detail(self.owner, self.get('AI_CONVERSATION', conversation['id']))}
        return {'idle': True}

    def plan(self, parent: dict, payload: dict) -> dict:
        if parent['planReady']:
            return self.public(parent)
        plan = payload.get('tasks', [])
        if not isinstance(plan, list) or len(plan) > 6:
            fail('A plan supports at most six specialists.', status=400)
        if plan and (not parent['teamQualified'] or parent['strategy'] == 'solo'):
            fail('Team is not qualified for this model/platform.', 'AI_TEAM_UNQUALIFIED')
        for index, item in enumerate(plan):
            if (not isinstance(item, dict) or set(item) - {'goal', 'dependencies'}
                    or not isinstance(item.get('goal'), str) or not 1 <= len(item['goal'].strip()) <= 2000):
                fail('Use bounded specialist objectives.', status=400)
            dependencies = item.get('dependencies', [])
            if (not isinstance(dependencies, list)
                    or any(type(value) is not int or not 0 <= value < index for value in dependencies)
                    or len(set(dependencies)) != len(dependencies)):
                fail('Dependencies must refer to earlier tasks. Nested delegation is unavailable.', status=400)
        run = self.get('AI_RUN', parent['id'])
        for index, item in enumerate(plan):
            key = 'ait_' + digest([parent['id'], parent['planRevision'], index])[:32]
            self.put('AI_AGENT_TASK', key, {
                'parentId': parent['id'], 'conversationId': parent['conversationId'], 'planRevision': parent['planRevision'],
                'index': index, 'goal': item['goal'].strip(), 'dependencies': item.get('dependencies', []),
                'modelId': parent['modelId'], 'scope': 'project_read_only', 'status': 'queued', 'generation': 1,
                'providerCalls': 0, 'toolCalls': 0, 'countedCalls': [], 'messages': [], 'evidence': [],
                'result': None, 'error': None, 'executionSeconds': 0, 'startedEpoch': None, 'sources': run.get('contextManifest', []), 'createdAt': utc_now()})
        parent = self.update('AI_ORCHESTRATION', parent, planReady=True,
                             resolvedStrategy='team' if plan else 'solo',
                             reason='Independent specialist work selected.' if plan else
                             ('Team is not qualified; using Solo on the selected model.' if not parent['teamQualified'] and parent['strategy'] == 'auto' else 'A single agent is sufficient.'))
        return self.public(parent)

    def inference(self, parent: dict, payload: dict) -> dict:
        task = self.task_fence(parent, payload)
        request = payload.get('requestId')
        if not isinstance(request, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', request):
            fail('Give each inference a stable dispatch identity.', status=400)
        key = 'aip_' + digest([parent['id'], parent['generation'], payload.get('taskId'), payload.get('taskGeneration'), request])[:32]
        slot = json_safe(self.s.get_item(self.owner, 'AI_INFERENCE', key))
        if slot and slot['status'] == 'active':
            return {'permit': key}
        if slot and slot['status'] != 'queued':
            fail('Inference already dispatched or capacity wait expired. Retry manually with remaining budget.',
                 'AI_QUEUE_TIMEOUT' if slot['status'] == 'expired' else 'AI_INFERENCE_DISPATCHED')
        if not slot:
            slot = self.put('AI_INFERENCE', key, {'parentId': parent['id'], 'taskId': payload.get('taskId'),
                            'taskGeneration': payload.get('taskGeneration'), 'generation': parent['generation'],
                            'executorId': parent['executorId'], 'status': 'queued', 'queuedEpoch': time.time(), 'order': time.time_ns()})
        waiting = sorted([s for s in self.rows('AI_INFERENCE') if s['status'] == 'queued'], key=lambda s: s['order'])
        active = [s for s in self.rows('AI_INFERENCE') if s['status'] == 'active']
        active_parents = {s['parentId'] for s in active}
        candidate = next((s for s in waiting if s['parentId'] not in active_parents), waiting[0])
        if len(active) >= 2 or candidate['id'] != key:
            return {'waiting': True}
        if parent['providerCalls'] >= (24 if task else 30) or task and task['providerCalls'] >= 8:
            fail('Provider-call budget reached. Partial work is retained.', 'AI_PROVIDER_BUDGET')
        self.update('AI_ORCHESTRATION', parent, providerCalls=parent['providerCalls'] + 1,
                    executionStartedEpoch=parent.get('executionStartedEpoch') or time.time())
        if task:
            self.update('AI_AGENT_TASK', task, providerCalls=task['providerCalls'] + 1,
                        startedEpoch=task.get('startedEpoch') or time.time())
        self.update('AI_INFERENCE', slot, status='active', dispatchedAt=time.time())
        return {'permit': key}

    def result(self, parent: dict, task: dict, data: dict) -> dict:
        text = bounded_text('\n'.join(message['text'] for message in task['messages'] if message['role'] == 'assistant'))
        status = 'completed' if data.get('status') == 'completed' and not data.get('partial') else 'failed'
        if data.get('partial'):
            data = {**data, 'failure': {'message': 'Specialist budget reached. Partial work is retained.'}}
        result = {'schemaVersion': 2, 'taskId': task['id'], 'status': status, 'text': text,
                  'evidenceRefs': task['evidence'], 'proposals': [],
                  'uncertainties': ['Specialist analysis; scientific claims require source verification.']}
        raw = json.dumps(result, sort_keys=True, ensure_ascii=False).encode()
        sha = hashlib.sha256(raw).hexdigest()
        key = f'users/{storage_owner(self.owner)}/ai/tasks/{sha}.json'
        self.s.s3.put_object(Bucket=self.s.bucket, Key=key, Body=raw, ContentType='application/json')
        self.update('AI_AGENT_TASK', task, status=status, result=result, resultSha256=sha,
                    resultKey=key, usage=data.get('usage'), completedAt=utc_now(), **self.task_clock(task),
                    error=(data.get('failure') or {}).get('message') if status == 'failed' else None)
        return {'saved': True}

    def rpc(self, payload: dict) -> dict:
        operation, data = payload.get('operation'), payload.get('data') or {}
        if not isinstance(data, dict) or not isinstance(operation, str):
            fail('Use structured tool arguments.', status=400)
        with self.lock, self.s.table.atomic():
            parent, run = self.fence(payload)
            task = self.task_fence(parent, payload)
            if task:
                if operation in {'attachment_read', 'attachment_search'}:
                    messages = self.ai.detail(self.owner, self.get('AI_CONVERSATION', parent['conversationId']))['messages']
                    allowed = {identifier for message in messages if message['runId'] == parent['id'] and message['role'] == 'user' for identifier in message.get('attachmentIds', [])}
                    allowed.update(source['ref']['id'] for source in task['sources'] if source['ref']['kind'] == 'attachment')
                    if data.get('id') not in allowed:
                        fail('This file was not selected for the parent.', 'AI_SPECIALIST_SCOPE', 403)
                if operation == 'mcp_tools':
                    return {'tools': []}
                if operation == 'message':
                    if data.get('role') not in {'assistant', 'tool'} or not isinstance(data.get('text'), str):
                        fail('Use a valid specialist message.', status=400)
                    messages = task['messages'] + [{'role': data['role'], 'text': bounded_text(data['text'])}]
                    evidence = task['evidence']
                    if data['role'] == 'tool' and isinstance(data.get('evidence'), dict):
                        evidence = evidence + [{'id': task['id'] + ':E' + str(len(evidence) + 1), 'operation': data['evidence'].get('tool', 'tool_observation'), 'arguments': clean(data['evidence'].get('arguments')), 'sha256': digest(data['text']), 'capturedAt': utc_now()}]
                    self.update('AI_AGENT_TASK', task, messages=messages[-32:], evidence=evidence[-24:])
                    return {'saved': True}
                if operation == 'finish':
                    return self.result(parent, task, data)
                if operation not in READS | {'step'}:
                    fail('Specialists can only read scoped evidence and return proposals.', 'AI_SPECIALIST_READ_ONLY', 403)
            elif operation == 'finish' and data.get('partial'):
                data = {**data, 'status': 'failed', 'failure': {'code': 'AI_PARENT_BUDGET', 'message': 'The inference budget was reached. Partial work is retained.'}}
            elif operation == 'execute':
                fail('Coordinator changes require explicit review.', 'AI_APPROVAL_REQUIRED', 403)
            if operation == 'step':
                call_id = data.get('toolCallId')
                if not isinstance(call_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', call_id):
                    fail('A tool call needs an identity.', status=400)
                record = task or run
                if call_id in record.get('countedCalls', []):
                    return {'run': {'steps': record.get('toolCalls', record.get('steps', 0))}}
                if parent['toolCalls'] >= (36 if task else 40) or task and task['toolCalls'] >= 12:
                    fail('Tool budget reached. Partial work is retained.', 'AI_TOOL_BUDGET')
                self.update('AI_ORCHESTRATION', parent, toolCalls=parent['toolCalls'] + 1)
                if task:
                    task = self.update('AI_AGENT_TASK', task, toolCalls=task['toolCalls'] + 1,
                                        countedCalls=task['countedCalls'] + [call_id])
                    return {'run': {'steps': task['toolCalls']}}
            if operation not in READS | {'prepare', 'mcp_tools', 'mcp_call'}:
                return self.ai_request(parent['conversationId'], operation, {
                    **data, 'runId': parent['id'], 'lease': parent['lease'],
                    'executorGeneration': parent['generation'], 'controlRevision': parent['controlRevision']})
        # Remote readers must not hold the authority lock or a SQLite transaction:
        # Stop, capacity and heartbeats remain responsive while a source is unavailable.
        result = self.ai_request(parent['conversationId'], operation, {
            **data, 'runId': parent['id'], 'lease': parent['lease'],
            'executorGeneration': parent['generation'], 'controlRevision': parent['controlRevision']})
        with self.lock, self.s.table.atomic():
            self.fence(payload)
            task = self.task_fence(parent, payload)
            if task:
                evidence = task['evidence'] + [{
                    'id': task['id'] + ':E' + str(len(task['evidence']) + 1), 'operation': operation,
                    'arguments': clean(json.loads(json.dumps(data))), 'sha256': digest(result), 'capturedAt': utc_now()}]
                self.update('AI_AGENT_TASK', task, evidence=evidence[-24:])
                if isinstance(result, dict):
                    result = {**result, 'taskEvidenceRef': evidence[-1]}
        return result

    def private(self, operation: str, payload: dict) -> dict:
        self.reconcile()
        if operation == 'rpc':
            return self.rpc(payload)
        with self.lock, self.s.table.atomic():
            if operation == 'register':
                executor = payload.get('executorId')
                if not isinstance(executor, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', executor):
                    fail('Choose a valid executor identity.', status=400)
                current = self.get('AI_EXECUTOR', 'primary')
                if current['leaseUntil'] > time.time() and current['executorId'] != executor:
                    fail('Another launcher executor owns this core.', 'AI_EXECUTOR_ACTIVE')
                if current['executorId'] and current['executorId'] != executor:
                    for parent in self.rows('AI_ORCHESTRATION'):
                        if parent['status'] == 'running':
                            self.interrupt(parent, 'Executor ownership changed. Review retained work and choose Continue.')
                self.update('AI_EXECUTOR', current, executorId=executor, leaseUntil=time.time() + 30)
                return {'ready': True, 'ownerId': self.owner}
            if operation == 'status':
                current = self.get('AI_EXECUTOR', 'primary')
                return {'ready': current['leaseUntil'] > time.time()}
            if operation == 'claim':
                registered = self.get('AI_EXECUTOR', 'primary')
                if registered['executorId'] != payload.get('executorId') or registered['leaseUntil'] < time.time():
                    fail('Register this launcher executor first.', 'AI_EXECUTOR_FENCED')
                return self.claim(payload)
            if operation == 'release':
                slot = self.get('AI_INFERENCE', str(payload.get('permit', '')))
                if (slot['parentId'] != payload.get('parentId') or slot['generation'] != payload.get('generation')
                        or slot['executorId'] != payload.get('executorId')):
                    fail('Invalid inference permit.', 'AI_EXECUTOR_FENCED')
                if slot['status'] == 'active':
                    self.update('AI_INFERENCE', slot, status='done', completedAt=time.time())
                return {'released': True}
            parent, run = self.fence(payload, allow_finished=operation in {'end', 'event', 'interrupt'})
            if operation == 'interrupt':
                return self.public(self.interrupt(parent, str(payload.get('reason', 'Executor interrupted. Review retained work and choose Continue.'))[:2000]))
            if operation == 'end':
                status = run['status'] if run['status'] != 'running' else 'failed'
                if status == 'awaiting_approval' and parent.get('continueRequested'):
                    status = 'queued'
                return self.public(self.update('AI_ORCHESTRATION', parent, status=status, leaseUntil=0, continueRequested=False,
                                   reason=bounded_text(str(payload.get('reason') or parent.get('reason') or ''), 2000),
                                   **self.freeze_clock(parent)))
            if operation == 'heartbeat':
                parent = self.update('AI_ORCHESTRATION', parent, leaseUntil=time.time() + 30)
                return self.public(parent)
            if operation == 'plan':
                return self.plan(parent, payload)
            if operation == 'inference':
                if run['status'] != 'running':
                    fail('Resolve the pending approval first.', 'AI_APPROVAL_REQUIRED')
                return self.inference(parent, payload)
            if operation == 'task_start':
                task = self.get('AI_AGENT_TASK', str(payload.get('taskId', '')))
                tasks = self.tasks(parent)
                if (task['parentId'] != parent['id'] or task['planRevision'] != parent['planRevision']
                        or task['status'] != 'queued' or any(tasks[index]['status'] not in TERMINAL for index in task['dependencies'])):
                    fail('This specialist is not ready.')
                return {'task': self.update('AI_AGENT_TASK', task, status='running', startedEpoch=None)}
            if operation == 'task_failure':
                task = self.task_fence(parent, payload)
                if not task:
                    fail('Choose a specialist.', status=400)
                self.result(parent, task, {'status': 'failed', 'failure': {'message': str(payload.get('error', 'Inference interrupted. Retry manually.'))[:2000]}})
                return self.public(parent)
            if operation == 'checkpoint':
                checkpoint = payload.get('checkpoint')
                if len(json.dumps(checkpoint).encode()) > 128000:
                    fail('Checkpoint exceeds its limit.', status=413)
                self.update('AI_ORCHESTRATION', parent, checkpoint=checkpoint)
                return {'saved': True}
            if operation == 'event':
                event = payload.get('event')
                if not isinstance(event, dict):
                    fail('Use a public event.', status=400)
                self.runtime.event(self.owner, self.get('AI_CONVERSATION', parent['conversationId']),
                                   {**event, 'schemaVersion': 2, 'parentId': parent['id']},
                                   parent['id'] + '_' + str(payload.get('eventId', '')))
                return {'saved': True}
            fail('Unsupported executor operation.', status=404)

    def public_request(self, conversation_id: str, operation: str, payload: dict) -> dict:
        self.reconcile()
        with self.lock, self.s.table.atomic():
            conversation = self.get('AI_CONVERSATION', conversation_id)
            self.ai.scope(self.owner, conversation.get('projectKey'))
            parent = json_safe(self.s.get_item(self.owner, 'AI_ORCHESTRATION', conversation.get('activeRunId') or 'none'))
            if not parent:
                if operation != 'status':
                    fail('There is no durable parent to control.', 'AI_NOT_FOUND', 404)
                return {'parent': None, 'tasks': [], 'teamQualified': self.qualified(conversation['modelId']), 'limits': LIMITS}
            if operation == 'status':
                return {**self.public(parent), 'teamQualified': self.qualified(conversation['modelId'])}
            if payload.get('parentId') and payload['parentId'] != parent['id']:
                fail('Another parent is active. Refresh Tasks.', 'AI_EXECUTOR_FENCED')
            if operation == 'continue':
                if parent['status'] == 'running':
                    run = self.get('AI_RUN', parent['id'])
                    if run['status'] == 'awaiting_approval' and not any(a.get('runId') == parent['id'] and a['status'] in {'pending', 'executing'} for a in self.rows('AI_ACTION')):
                        parent = self.update('AI_ORCHESTRATION', parent, continueRequested=True)
                    return self.public(parent)
                if parent['status'] not in {'interrupted', 'awaiting_approval', 'failed', 'completed'}:
                    fail('This parent does not need Continue.')
                if time.time() - parent['createdEpoch'] >= 3600 or parent['executionSeconds'] >= 900:
                    fail('Parent budget expired. Start a new request.', 'AI_PARENT_EXPIRED')
                actions = [a for a in self.rows('AI_ACTION') if a.get('runId') == parent['id']]
                if any(a['status'] in {'pending', 'executing'} or a['status'] == 'failed' and 'could not be confirmed' in a.get('error', '') for a in actions):
                    fail('Resolve approvals and reconcile uncertain submissions before Continue.', 'AI_APPROVAL_REQUIRED')
                if parent['providerCalls'] >= 30 or parent['toolCalls'] >= 40:
                    fail('No parent budget remains. Start a new request using retained results.', 'AI_PARENT_BUDGET')
                self.update('AI_CONVERSATION', conversation, queuePaused=False)
                return self.public(self.update('AI_ORCHESTRATION', parent, status='queued'))
            task = self.get('AI_AGENT_TASK', str(payload.get('taskId', '')))
            if task['parentId'] != parent['id'] or task['planRevision'] != parent['planRevision']:
                fail('This specialist belongs to another parent or plan.', status=404)
            if payload.get('taskGeneration') != task['generation']:
                fail('This specialist changed. Refresh Tasks.', 'AI_TASK_FENCED')
            if operation == 'stop':
                if task['status'] not in TERMINAL:
                    self.update('AI_AGENT_TASK', task, status='cancelled', generation=task['generation'] + 1, **self.task_clock(task))
            elif operation == 'retry':
                if time.time() - parent['createdEpoch'] >= 3600 or self.freeze_clock(parent)['executionSeconds'] >= 900:
                    fail('Parent budget expired. Start a new request.', 'AI_PARENT_EXPIRED')
                if task['status'] not in {'failed', 'interrupted'}:
                    fail('Only failed or interrupted specialists may Retry.')
                if (parent['providerCalls'] >= 24 or task['providerCalls'] >= 8
                        or parent['toolCalls'] >= 36 or task['toolCalls'] >= 12 or task.get('executionSeconds', 0) >= 300):
                    fail('No specialist budget remains.', 'AI_TASK_BUDGET')
                if isinstance(parent.get('checkpoint'), dict) and parent['checkpoint'].get('phase') == 'synthesis':
                    # A manual Retry after synthesis began invalidates that synthesis,
                    # while the previous completed specialist records stay intact.
                    if any(a.get('runId') == parent['id'] and a['status'] in {'pending', 'executing'} for a in self.rows('AI_ACTION')):
                        fail('Resolve the reviewed action before retrying a specialist.', 'AI_APPROVAL_REQUIRED')
                    parent = self.interrupt(parent, 'A specialist was retried; synthesis will use its new result.', 'stale')
                    parent = self.update('AI_ORCHESTRATION', parent, status='queued', checkpoint=None)
                elif parent['status'] != 'running':
                    self.public_request(conversation_id, 'continue', {'parentId': parent['id']})
                affected = {task['index']}
                tasks = self.tasks(parent)
                for dependent in tasks:
                    if any(index in affected for index in dependent['dependencies']):
                        affected.add(dependent['index'])
                for item in tasks:
                    if item['index'] not in affected:
                        continue
                    clock = self.task_clock(item)
                    available = item['providerCalls'] < 8 and item['toolCalls'] < 12 and clock['executionSeconds'] < 300
                    self.update('AI_AGENT_TASK', item, status='queued' if available else 'failed',
                                generation=item['generation'] + 1, messages=[], countedCalls=[],
                                error=None if available else 'Dependency changed but this task has no budget left. Start a new request.',
                                previousResult=item.get('result') or item.get('previousResult'), result=None, **clock)
            else:
                fail('Unsupported task action.', status=404)
            return self.public(self.get('AI_ORCHESTRATION', parent['id']))
