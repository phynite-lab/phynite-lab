"""Real SQLite authority tests; no provider, solver or cloud calls."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from backend.local_api.ai_orchestration import AiOrchestration
from backend.local_api.domain.ai_runtime import AiRuntime
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.services import LocalServices


class OrchestrationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.s = LocalServices(self.root, 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.api = PhyniteApi(self.s)
        self.ai, self.runtime = AiWorkspace(self.api), AiRuntime(self.api)
        self.authority = AiOrchestration(self.api)
        self.s.ai_orchestration = self.authority
        self.owner = self.s.owner
        self.executor = 'executor_fixture'
        self.authority.private('register', {'executorId': self.executor})
        self.project = body(self.api.create_project(self.owner, {'name': 'Orchestration fixture'}))['project']['id']
        self.counter = 0

    def parent(self, *, strategy='auto', qualified=True, mode='approval'):
        self.counter += 1
        conversation = self.ai.put(self.owner, 'AI_CONVERSATION', f'aic_fixture{self.counter}', {
            'projectKey': 'project:' + self.project, 'mode': mode, 'activeRunId': None,
            'title': 'New research conversation', 'modelId': 'codex/gpt-5.4', 'providerId': 'local',
            'effort': 'auto', 'queuePaused': False})
        with patch.object(self.authority, 'qualified', return_value=qualified):
            self.runtime.handle(self.owner, conversation, 'POST', 'queue', None, {
                'text': 'Review two independent sources, then synthesize.', 'clientMessageId': f'message_{self.counter}',
                'strategy': strategy}, {})
            job = self.authority.private('claim', {'executorId': self.executor})
        self.assertNotIn('lease', job['parent'])
        self.assertEqual(job['detail']['run']['id'], job['parent']['id'])
        return job

    def call(self, job, action, **payload):
        return self.authority.private(action, {'executorId': self.executor,
            'parentId': job['parent']['id'], 'generation': job['parent']['generation'], **payload})

    def specialists(self, job, count=2):
        plan = self.call(job, 'plan', tasks=[{'goal': f'Independent review {index}', 'dependencies': []} for index in range(count)])
        return [self.call(job, 'task_start', taskId=task['id'])['task'] for task in plan['tasks']]

    def infer(self, job, task=None, request='inference1'):
        return self.call(job, 'inference', requestId=request,
                         **({'taskId': task['id'], 'taskGeneration': task['generation']} if task else {}))

    def rpc(self, job, operation, data=None, task=None):
        return self.call(job, 'rpc', operation=operation, data=data or {},
                         **({'taskId': task['id'], 'taskGeneration': task['generation']} if task else {}))

    def test_two_tasks_overlap_global_limit_and_other_parent_fairness(self):
        first = self.parent()
        tasks = self.specialists(first, 3)
        with ThreadPoolExecutor(3) as pool:
            permits = list(pool.map(lambda task: self.infer(first, task), tasks))
        self.assertEqual(sum('permit' in permit for permit in permits), 2)
        self.assertEqual(sum('waiting' in permit for permit in permits), 1)
        second = self.parent()
        self.call(second, 'plan', tasks=[])
        self.assertTrue(self.infer(second)['waiting'])
        active = next(permit['permit'] for permit in permits if 'permit' in permit)
        self.call(first, 'release', permit=active)
        waiting_task = tasks[next(index for index, permit in enumerate(permits) if 'waiting' in permit)]
        self.assertTrue(self.infer(first, waiting_task)['waiting'])
        self.assertIn('permit', self.infer(second))
        slots = self.authority.rows('AI_INFERENCE')
        self.assertEqual(sum(slot['status'] == 'active' for slot in slots), 2)

    def test_budget_reservation_and_dispatch_identity(self):
        job = self.parent()
        task = self.specialists(job, 1)[0]
        permit = self.infer(job, task)['permit']
        self.assertEqual(self.infer(job, task)['permit'], permit)
        parent = self.authority.get('AI_ORCHESTRATION', job['parent']['id'])
        self.assertEqual(parent['providerCalls'], 1)
        self.call(job, 'release', permit=permit)
        with self.assertRaises(ApiError) as error:
            self.infer(job, task)
        self.assertEqual(error.exception.code, 'AI_INFERENCE_DISPATCHED')
        self.s.update_item(self.owner, 'AI_ORCHESTRATION', parent['id'], {'providerCalls': 24, 'toolCalls': 36})
        with self.assertRaisesRegex(ApiError, 'Provider-call budget'):
            self.infer(job, task, 'next')
        self.assertIn('permit', self.infer(job, request='coordinator'))
        with self.assertRaisesRegex(ApiError, 'Tool budget'):
            self.rpc(job, 'step', {'toolCallId': 'child_tool'}, task)
        self.assertEqual(self.rpc(job, 'step', {'toolCallId': 'coordinator_tool'})['run']['steps'], 1)
        self.rpc(job, 'step', {'toolCallId': 'coordinator_tool'})
        self.assertEqual(self.authority.get('AI_ORCHESTRATION', parent['id'])['toolCalls'], 37)

    def test_specialist_per_task_limits_and_read_only_authority(self):
        job = self.parent()
        task = self.specialists(job, 1)[0]
        for index in range(8):
            permit = self.infer(job, task, str(index))['permit']
            self.call(job, 'release', permit=permit)
        with self.assertRaisesRegex(ApiError, 'Provider-call budget'):
            self.infer(job, task, 'ninth')
        for index in range(12):
            self.rpc(job, 'step', {'toolCallId': str(index)}, task)
        self.rpc(job, 'step', {'toolCallId': '0'}, task)
        with self.assertRaisesRegex(ApiError, 'Tool budget'):
            self.rpc(job, 'step', {'toolCallId': 'thirteenth'}, task)
        for operation in ('prepare', 'execute', 'ledger', 'artifact_publish', 'claim', 'task_start'):
            with self.assertRaises(ApiError) as error:
                self.rpc(job, operation, {}, task)
            self.assertEqual(error.exception.code, 'AI_SPECIALIST_READ_ONLY')
        with self.assertRaisesRegex(ApiError, 'explicit review'):
            self.rpc(job, 'execute', {})

    def test_native_guard_turns_consume_real_provider_budget_and_coordinator_reserve(self):
        job = self.parent()
        self.s.update_item(self.owner, 'AI_ORCHESTRATION', job['parent']['id'], {'modelId': 'agy/gemini-3.8-flash-medium'})
        task = self.specialists(job, 1)[0]
        for index in range(4):
            permit = self.infer(job, task, str(index))['permit']
            self.call(job, 'release', permit=permit)
        parent = self.authority.get('AI_ORCHESTRATION', job['parent']['id'])
        self.assertEqual(parent['providerCalls'], 8)
        self.assertEqual(self.authority.get('AI_AGENT_TASK', task['id'])['providerCalls'], 8)
        with self.assertRaisesRegex(ApiError, 'Provider-call budget'):
            self.infer(job, task, 'fifth')
        self.s.update_item(self.owner, 'AI_ORCHESTRATION', parent['id'], {'providerCalls': 29})
        with self.assertRaisesRegex(ApiError, 'Provider-call budget'):
            self.infer(job, request='guard_exceeds_parent')
        self.s.update_item(self.owner, 'AI_ORCHESTRATION', parent['id'], {'providerCalls': 24})
        for index in range(3):
            permit = self.infer(job, request='reserved_' + str(index))['permit']
            self.call(job, 'release', permit=permit)
        self.assertEqual(self.authority.get('AI_ORCHESTRATION', parent['id'])['providerCalls'], 30)
        with self.assertRaisesRegex(ApiError, 'Provider-call budget'):
            self.infer(job, request='reserved_exhausted')

    def test_stop_fences_late_results_and_does_not_cancel_scientific_jobs(self):
        job = self.parent()
        task = self.specialists(job, 1)[0]
        permit = self.infer(job, task)['permit']
        self.ai.put(self.owner, 'CALCULATION', 'science', {'status': 'RUNNING', 'projectId': self.project})
        self.authority.ai_request(job['parent']['conversationId'], 'stop', {'runId': job['parent']['id']})
        with self.assertRaises(ApiError) as error:
            self.rpc(job, 'message', {'role': 'assistant', 'text': 'late'}, task)
        self.assertEqual(error.exception.code, 'AI_EXECUTOR_FENCED')
        self.assertEqual(self.authority.get('CALCULATION', 'science')['status'], 'RUNNING')
        self.assertEqual(self.authority.get('AI_INFERENCE', permit)['status'], 'cancelled')
        self.call(job, 'release', permit=permit)  # Old permit cleanup cannot affect a new generation.

    def test_task_stop_is_scoped_and_late_failure_is_rejected(self):
        job, other = self.parent(), self.parent()
        task, other_task = self.specialists(job, 1)[0], self.specialists(other, 1)[0]
        with self.assertRaises(ApiError):
            self.authority.public_request(job['parent']['conversationId'], 'stop', {'taskId': other_task['id'], 'taskGeneration': 1})
        self.authority.public_request(job['parent']['conversationId'], 'stop', {'taskId': task['id'], 'taskGeneration': 1})
        with self.assertRaises(ApiError) as error:
            self.call(job, 'task_failure', taskId=task['id'], taskGeneration=1, error='late')
        self.assertEqual(error.exception.code, 'AI_TASK_FENCED')
        self.assertEqual(self.authority.get('AI_AGENT_TASK', other_task['id'])['status'], 'running')

    def test_restart_retains_evidence_and_requires_manual_continue_and_retry(self):
        job = self.parent()
        tasks = self.specialists(job)
        self.rpc(job, 'context', {}, tasks[0])
        self.rpc(job, 'message', {'role': 'assistant', 'text': 'Retained source analysis'}, tasks[0])
        self.rpc(job, 'finish', {'status': 'completed'}, tasks[0])
        self.infer(job, tasks[1])
        self.authority = AiOrchestration(self.api)
        self.s.ai_orchestration = self.authority
        self.authority.private('register', {'executorId': self.executor})
        self.assertTrue(self.authority.private('claim', {'executorId': self.executor})['idle'])
        state = self.authority.public_request(job['parent']['conversationId'], 'status', {})
        self.assertEqual(state['parent']['status'], 'interrupted')
        self.assertEqual(state['tasks'][0]['result']['text'], 'Retained source analysis')
        self.assertEqual(state['tasks'][1]['status'], 'interrupted')
        checksum = state['tasks'][0]['resultSha256']
        task = self.authority.get('AI_AGENT_TASK', tasks[0]['id'])
        raw = self.s.s3.get_object(Bucket=self.s.bucket, Key=task['resultKey'])['Body'].read()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), checksum)
        self.authority.public_request(job['parent']['conversationId'], 'continue', {})
        next_job = self.authority.private('claim', {'executorId': self.executor})
        self.assertGreater(next_job['parent']['generation'], job['parent']['generation'])
        self.assertEqual(next_job['parent']['providerCalls'], 1)
        self.assertEqual(next_job['tasks'][1]['status'], 'interrupted')
        self.authority.public_request(job['parent']['conversationId'], 'retry', {'taskId': tasks[1]['id'], 'taskGeneration': state['tasks'][1]['generation']})
        self.assertEqual(self.authority.get('AI_AGENT_TASK', tasks[1]['id'])['status'], 'queued')

    def test_steering_supersedes_proposals_and_replans_without_overwriting_evidence(self):
        job = self.parent()
        task = self.specialists(job, 1)[0]
        self.rpc(job, 'message', {'role': 'assistant', 'text': 'Old scope analysis'}, task)
        self.rpc(job, 'finish', {'status': 'completed'}, task)
        conversation = self.authority.get('AI_CONVERSATION', job['parent']['conversationId'])
        queued = body(self.runtime.handle(self.owner, conversation, 'POST', 'queue', None,
                        {'text': 'New direction', 'clientMessageId': 'steer_message'}, {}))['message']
        self.runtime.handle(self.owner, self.authority.get('AI_CONVERSATION', conversation['id']), 'POST', 'steer', queued['id'], {}, {})
        self.authority.reconcile()
        with self.assertRaises(ApiError):
            self.call(job, 'heartbeat')
        revised = self.authority.private('claim', {'executorId': self.executor})
        self.assertEqual(revised['parent']['controlRevision'], 1)
        self.assertEqual(revised['tasks'], [])
        self.assertEqual(self.authority.get('AI_AGENT_TASK', task['id'])['result']['text'], 'Old scope analysis')
        new_plan = self.call(revised, 'plan', tasks=[])
        self.assertEqual(new_plan['parent']['resolvedStrategy'], 'solo')

    def test_lease_task_capacity_and_parent_deadlines(self):
        job = self.parent()
        task = self.specialists(job, 1)[0]
        permit = self.infer(job, task)['permit']
        self.s.update_item(self.owner, 'AI_AGENT_TASK', task['id'], {'startedEpoch': time.time() - 301})
        self.authority.reconcile()
        self.assertEqual(self.authority.get('AI_AGENT_TASK', task['id'])['status'], 'failed')
        self.assertEqual(self.authority.get('AI_INFERENCE', permit)['status'], 'cancelled')
        self.s.update_item(self.owner, 'AI_ORCHESTRATION', job['parent']['id'], {'leaseUntil': time.time() - 1})
        self.authority.reconcile()
        self.assertEqual(self.authority.get('AI_ORCHESTRATION', job['parent']['id'])['status'], 'interrupted')
        self.s.update_item(self.owner, 'AI_ORCHESTRATION', job['parent']['id'], {'createdEpoch': time.time() - 3601})
        with self.assertRaises(ApiError) as error:
            self.authority.public_request(job['parent']['conversationId'], 'continue', {})
        self.assertEqual(error.exception.code, 'AI_PARENT_EXPIRED')

    def test_capacity_timeout_is_durable_and_cannot_dispatch_again(self):
        job = self.parent()
        tasks = self.specialists(job, 3)
        self.infer(job, tasks[0]); self.infer(job, tasks[1])
        self.infer(job, tasks[2])
        waiting = next(slot for slot in self.authority.rows('AI_INFERENCE') if slot['status'] == 'queued')
        self.s.update_item(self.owner, 'AI_INFERENCE', waiting['id'], {'queuedEpoch': time.time() - 601})
        with self.assertRaises(ApiError) as error:
            self.infer(job, tasks[2])
        self.assertEqual(error.exception.code, 'AI_QUEUE_TIMEOUT')
        self.assertEqual(self.authority.get('AI_INFERENCE', waiting['id'])['status'], 'expired')

    def test_plan_bounds_feature_gate_and_provider_identity(self):
        job = self.parent(qualified=False)
        with self.assertRaises(ApiError) as error:
            self.call(job, 'plan', tasks=[{'goal': 'review', 'dependencies': []}])
        self.assertEqual(error.exception.code, 'AI_TEAM_UNQUALIFIED')
        self.assertEqual(self.call(job, 'plan', tasks=[])['parent']['modelId'], 'codex/gpt-5.4')
        job = self.parent()
        for tasks in ([{'goal': 'x'}] * 7, [{'goal': 'x', 'dependencies': [0]}], [{'goal': 'x', 'children': []}]):
            with self.assertRaises(ApiError):
                self.call(job, 'plan', tasks=tasks)
        self.assertFalse(self.authority.qualified('codex/gpt-5.4'))

    def test_approval_pause_resumes_without_repeating_specialists(self):
        job = self.parent(mode='full')
        self.call(job, 'plan', tasks=[])
        graph = {'version': 1, 'projectId': self.project, 'nodes': [], 'edges': [], 'groups': []}
        context = self.rpc(job, 'context')
        action = self.rpc(job, 'prepare', {'kind': 'save_workflow', 'title': 'Reviewed change',
            'stamp': context['stamp'], 'payload': {'baseRevision': 0, 'workflow': graph}, 'toolCallId': 'proposal'})['action']
        self.assertEqual(self.authority.get('AI_RUN', job['parent']['id'])['status'], 'awaiting_approval')
        self.call(job, 'end')
        with self.assertRaises(ApiError) as error:
            self.authority.public_request(job['parent']['conversationId'], 'continue', {})
        self.assertEqual(error.exception.code, 'AI_APPROVAL_REQUIRED')
        # Even a conversation saved in legacy Full mode now requires an explicit human decision.
        reply = self.authority.ai_request(job['parent']['conversationId'], 'actions/' + action['id'], {'decision': 'approve', 'payloadHash': action['payloadHash']})
        self.assertEqual(reply['action']['status'], 'succeeded')
        self.authority.public_request(job['parent']['conversationId'], 'continue', {})
        next_job = self.authority.private('claim', {'executorId': self.executor})
        self.assertEqual(next_job['parent']['id'], job['parent']['id'])
        self.assertTrue(next_job['parent']['planReady'])
        self.rpc(next_job, 'finish', {'status': 'completed'})
        self.call(next_job, 'event', event={'type': 'done'}, eventId='final')
        self.assertEqual(self.call(next_job, 'end')['parent']['status'], 'completed')

    def test_stop_cancels_a_queued_continuation_and_a_paused_approval(self):
        for paused_approval in (False, True):
            with self.subTest(paused_approval=paused_approval):
                job = self.parent()
                self.call(job, 'plan', tasks=[])
                if paused_approval:
                    graph = {'version': 1, 'projectId': self.project, 'nodes': [], 'edges': [], 'groups': []}
                    self.rpc(job, 'prepare', {'kind': 'save_workflow', 'stamp': self.rpc(job, 'context')['stamp'],
                        'payload': {'baseRevision': 0, 'workflow': graph}, 'toolCallId': 'paused_proposal'})
                    self.call(job, 'end')
                else:
                    self.call(job, 'interrupt', reason='Fixture crash before manual Continue.')
                    self.authority.public_request(job['parent']['conversationId'], 'continue', {})
                self.authority.ai_request(job['parent']['conversationId'], 'stop', {'runId': job['parent']['id']})
                state = self.authority.public_request(job['parent']['conversationId'], 'status', {})
                self.assertEqual(state['parent']['status'], 'stopped')
                self.assertTrue(self.authority.private('claim', {'executorId': self.executor})['idle'])
                with self.assertRaises(ApiError):
                    self.authority.public_request(job['parent']['conversationId'], 'continue', {})

    def test_one_project_writer_revalidates_next_proposal(self):
        jobs = [self.parent(), self.parent()]
        graph = {'version': 1, 'projectId': self.project, 'nodes': [], 'edges': [], 'groups': []}
        actions = [self.rpc(job, 'prepare', {'kind': 'save_workflow', 'stamp': self.rpc(job, 'context')['stamp'],
            'payload': {'baseRevision': 0, 'workflow': graph}, 'toolCallId': 'proposal'})['action'] for job in jobs]
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda pair: self.authority.ai_request(pair[0]['parent']['conversationId'],
                'actions/' + pair[1]['id'], {'decision': 'approve', 'payloadHash': pair[1]['payloadHash']})['action']['status'], zip(jobs, actions)))
        self.assertEqual(sorted(results), ['expired', 'succeeded'])

    def test_no_executor_or_root_capability_from_public_route(self):
        with self.assertRaises(ApiError):
            self.authority.private('claim', {'executorId': 'unregistered'})
        job = self.parent()
        state = self.authority.public_request(job['parent']['conversationId'], 'status', {})
        self.assertNotIn('lease', state['parent'])
        self.assertNotIn('executorId', state['parent'])
        self.assertIsNone(state['usage']['cost'])

    def test_crash_after_preparing_approval_keeps_it_reviewable(self):
        job = self.parent()
        graph = {'version': 1, 'projectId': self.project, 'nodes': [], 'edges': [], 'groups': []}
        action = self.rpc(job, 'prepare', {'kind': 'save_workflow', 'stamp': self.rpc(job, 'context')['stamp'],
            'payload': {'baseRevision': 0, 'workflow': graph}, 'toolCallId': 'proposal'})['action']
        self.authority = AiOrchestration(self.api)
        self.s.ai_orchestration = self.authority
        self.authority.private('register', {'executorId': self.executor})
        self.assertEqual(self.authority.get('AI_RUN', job['parent']['id'])['status'], 'awaiting_approval')
        result = self.authority.ai_request(job['parent']['conversationId'], 'actions/' + action['id'], {'decision': 'reject'})
        self.assertEqual(result['action']['status'], 'rejected')
        self.authority.public_request(job['parent']['conversationId'], 'continue', {})
        self.assertEqual(self.authority.private('claim', {'executorId': self.executor})['parent']['id'], job['parent']['id'])

    def test_new_message_after_interruption_does_not_reclaim_old_inbox(self):
        job = self.parent()
        self.call(job, 'interrupt', reason='Provider account changed.')
        conversation = self.authority.get('AI_CONVERSATION', job['parent']['conversationId'])
        self.runtime.handle(self.owner, conversation, 'POST', 'queue', None,
                            {'text': 'Start a different request', 'clientMessageId': 'another_message'}, {})
        conversation = self.authority.get('AI_CONVERSATION', conversation['id'])
        self.runtime.handle(self.owner, conversation, 'POST', 'continue', None, {}, {})
        next_job = self.authority.private('claim', {'executorId': self.executor})
        self.assertNotEqual(next_job['parent']['id'], job['parent']['id'])
        self.assertEqual(self.authority.get('AI_ORCHESTRATION', job['parent']['id'])['status'], 'interrupted')

    def test_retry_consumes_remaining_budget_and_invalidates_dependent_evidence(self):
        job = self.parent()
        plan = self.call(job, 'plan', tasks=[{'goal': 'Source A'}, {'goal': 'Compare A', 'dependencies': [0]}])
        first = self.call(job, 'task_start', taskId=plan['tasks'][0]['id'])['task']
        self.rpc(job, 'step', {'toolCallId': 'same_id'}, first)
        self.rpc(job, 'finish', {'status': 'failed'}, first)
        second = self.call(job, 'task_start', taskId=plan['tasks'][1]['id'])['task']
        self.rpc(job, 'message', {'role': 'assistant', 'text': 'Old dependent result'}, second)
        self.rpc(job, 'finish', {'status': 'completed'}, second)
        self.call(job, 'checkpoint', checkpoint={'phase': 'synthesis'})
        self.authority.public_request(job['parent']['conversationId'], 'retry', {'taskId': first['id'], 'taskGeneration': first['generation']})
        with self.assertRaises(ApiError):
            self.call(job, 'heartbeat')
        revised = self.authority.private('claim', {'executorId': self.executor})
        first = self.call(revised, 'task_start', taskId=first['id'])['task']
        self.rpc(revised, 'step', {'toolCallId': 'same_id'}, first)
        self.assertEqual(self.authority.get('AI_AGENT_TASK', first['id'])['toolCalls'], 2)
        dependent = self.authority.get('AI_AGENT_TASK', second['id'])
        self.assertEqual(dependent['status'], 'queued')
        self.assertIsNone(dependent['result'])
        self.assertEqual(dependent['previousResult']['text'], 'Old dependent result')

    def test_partial_budget_result_is_retained_without_claiming_completion(self):
        job = self.parent()
        task = self.specialists(job, 1)[0]
        self.rpc(job, 'message', {'role': 'assistant', 'text': 'Partial source analysis'}, task)
        self.rpc(job, 'finish', {'status': 'completed', 'partial': True}, task)
        saved = self.authority.get('AI_AGENT_TASK', task['id'])
        self.assertEqual(saved['status'], 'failed')
        self.assertEqual(saved['result']['text'], 'Partial source analysis')
        self.assertIn('budget', saved['error'])
        self.rpc(job, 'finish', {'status': 'completed', 'partial': True})
        self.assertEqual(self.call(job, 'end')['parent']['status'], 'failed')

    def test_unselected_attachment_and_malformed_dependency_are_rejected(self):
        job = self.parent()
        with self.assertRaises(ApiError):
            self.call(job, 'plan', tasks=[{'goal': 'Invalid', 'dependencies': [{}]}])
        task = self.specialists(job, 1)[0]
        with self.assertRaises(ApiError) as error:
            self.rpc(job, 'attachment_read', {'id': 'not_selected'}, task)
        self.assertEqual(error.exception.code, 'AI_SPECIALIST_SCOPE')

    def test_team_qualification_rejects_synthetic_changed_and_other_platform_evidence(self):
        evidence_path = self.root / 'evidence.json'
        index_path = self.root / 'qualification.json'
        evidence = {'schemaVersion': 1, 'kind': 'synthetic', 'modelId': 'codex/gpt-5.4',
                    'platform': 'linux-x86_64', 'safetyPassed': True,
                    'evidenceQualityReviewed': True, 'overlapObserved': True,
                    'runs': {'solo': {'status': 'completed'}, 'team': {'status': 'completed',
                             'tasks': [{'status': 'completed'}, {'status': 'completed'}]}}}

        def save():
            raw = json.dumps(evidence).encode()
            evidence_path.write_bytes(raw)
            index_path.write_text(json.dumps({'schemaVersion': 1, 'entries': [{
                'modelId': evidence['modelId'], 'platform': evidence['platform'], 'passed': True,
                'evidenceFile': evidence_path.name, 'evidenceSha256': hashlib.sha256(raw).hexdigest()}]}))

        with patch.dict('os.environ', {'PHYNITE_AI_TEAM': '1', 'PHYNITE_AI_TEAM_QUALIFICATION': str(index_path)}):
            with patch('backend.local_api.ai_orchestration.platform_id', return_value='linux-x86_64'):
                save()
                self.assertFalse(self.authority.qualified(evidence['modelId']))
                evidence['kind'] = 'native-provider'
                save()
                self.assertTrue(self.authority.qualified(evidence['modelId']))
                self.assertFalse(self.authority.qualified('another/model'))
                for tasks in ([], [{'status': 'completed'}], [{'status': 'completed'}, {'status': 'failed'}],
                              [{'status': 'completed'}, {'status': 'interrupted'}]):
                    evidence['runs']['team']['tasks'] = tasks
                    save()
                    self.assertFalse(self.authority.qualified(evidence['modelId']))
                evidence['runs']['team']['tasks'] = [{'status': 'completed'}, {'status': 'completed'}]
                save()
                self.assertTrue(self.authority.qualified(evidence['modelId']))
                evidence_path.write_text('{}')
                self.assertFalse(self.authority.qualified(evidence['modelId']))
                save()
            for platform in ('linux-wsl2-x86_64', 'unsupported-wsl1-x86_64', 'windows-amd64'):
                with patch('backend.local_api.ai_orchestration.platform_id', return_value=platform):
                    self.assertFalse(self.authority.qualified(evidence['modelId']))
