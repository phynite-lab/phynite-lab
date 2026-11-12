"""Durable local AI inbox, approval fence and foreground provider events."""
from __future__ import annotations
import base64
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from backend.local_api.domain.ai_workspace import AiWorkspace, body, clean, digest, fail, valid_id
from backend.local_api.domain.phynite_core import ApiError, json_safe, parse_body, response, owner_partition, utc_now
from backend.local_api.domain.ai_skills import request_skill_ref, skill_identity, snapshot_ref

def request_selection(payload: dict) -> dict:
    return {'executionMode': payload.get('executionMode', 'foreground'), 'taskMode': payload.get('taskMode', 'work'), 'contextRefs': payload.get('contextRefs', []), 'sourceArtifactId': payload.get('sourceArtifactId'), 'skillRef': request_skill_ref(payload)}

class AiRuntime:

    def __init__(self, api):
        self.api, self.ai, self.services = (api, AiWorkspace(api), api.services)

    def queue(self, owner, conversation):
        return sorted([clean(row) for row in self.services.list_owner_items(owner, 'AI_QUEUE#' + conversation['id'])], key=lambda row: row['order'])

    def events(self, owner, conversation, after='', *, tail=False, limit=100):
        if hasattr(self.services, 'ai_event_page'):
            return self.services.ai_event_page(owner, conversation['id'], after, tail=tail, limit=limit)
        rows = sorted([row for row in self.services.list_owner_items(owner, 'AI_EVENT#' + conversation['id']) if row['order'] > after], key=lambda row: row['order'])
        return rows[-limit:] if tail else rows[:limit]

    def signal(self, owner, conversation):
        current = self.ai.row(owner, 'AI_CONVERSATION', conversation['id'])
        return self.ai.update(owner, 'AI_CONVERSATION', current, {'dispatchPending': True, 'dispatchGeneration': current.get('dispatchGeneration', 0) + (0 if current.get('dispatchPending') else 1), 'GSI1PK': 'AI_IDLE' if current.get('queuePaused') else 'AI_DISPATCH', 'GSI1SK': str(time.time_ns())})

    def event(self, owner, conversation, event, event_id=None):
        if not isinstance(event, dict) or event.get('type') not in {'text', 'response_start', 'activity', 'ledger', 'action', 'done', 'error', 'steering', 'queue'}:
            fail(400, 'Only public AI events may be recorded.')
        raw = json.dumps(event)
        if len(raw.encode()) > 100000:
            fail(413, 'AI event is too large.')
        order = str(time.time_ns())
        item_id = 'aie_' + (digest(valid_id(event_id))[:32] if event_id else order)
        existing = self.services.get_item(owner, 'AI_EVENT#' + conversation['id'], item_id)
        if existing:
            return existing
        row = self.ai.put(owner, 'AI_EVENT#' + conversation['id'], item_id, {'order': order, 'event': clean(event), 'expiresAtEpoch': int(time.time()) + 604800})
        if event['type'] == 'response_start':
            for _ in range(3):
                run = self.services.get_item(owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
                if not run:
                    break
                try:
                    self.ai.update(owner, 'AI_RUN', run, {'responseStart': order})
                    break
                except ApiError as error:
                    if error.code != 'AI_CONFLICT':
                        raise
        return row

    def attachment_ids(self, owner, conversation, payload):
        from backend.local_api.domain.ai_attachments import AiAttachments
        ids = payload.get('attachmentIds', [])
        if not isinstance(ids, list) or len(ids) > 5 or any((not isinstance(value, str) for value in ids)) or (len(set(ids)) != len(ids)):
            fail(400, 'Attach up to five distinct files.', 'AI_ATTACHMENT_INVALID')
        for item_id in ids:
            item = AiAttachments(self.api).get(owner, conversation, item_id)
            if item['status'] != 'ready':
                fail(409, 'Wait for each attachment to finish processing.', 'AI_ATTACHMENT_NOT_READY')
        return ids

    def handle(self, owner, conversation, method, operation, item_id, payload, params, *, retry_source=None):
        kind = 'AI_QUEUE#' + conversation['id']
        if operation == 'events' and method == 'GET':
            after = str(params.get('after', ''))
            rows = self.events(owner, conversation, after)
            return response(200, {'events': [{'id': r['order'], **r['event']} for r in rows], 'cursor': rows[-1]['order'] if rows else after})
        if operation == 'queue' and method == 'GET':
            return response(200, {'queue': self.queue(owner, conversation)})
        if operation == 'continue' and method == 'POST':
            if payload.get('retryRunId'):
                previous = self.ai.row(owner, 'AI_RUN', payload['retryRunId'])
                if previous.get('conversationId') != conversation['id'] or previous['id'] != conversation.get('activeRunId') or previous['status'] != 'failed' or (not conversation.get('queuePaused')) or (not previous.get('queueId')):
                    fail(409, 'Only the last failed turn in a paused queue can be retried.', 'AI_RUN_INACTIVE')
                source = self.ai.row(owner, kind, previous['queueId'])
                retried = body(self.handle(owner, conversation, 'POST', 'queue', None, {'text': source['text'], 'attachmentIds': source['attachmentIds'], 'taskMode': source.get('taskMode', 'work'), 'contextRefs': json_safe([ref['ref'] for ref in source.get('contextManifest', [])]), 'sourceArtifactId': source.get('sourceArtifactId'), 'skillRef': snapshot_ref(source.get('skillSnapshot')), 'clientMessageId': 'retry-' + previous['id']}, {}, retry_source=source))['message']
                self.ai.update(owner, kind, self.ai.row(owner, kind, retried['id']), {'order': source['order'] + 'r'})
                conversation = self.ai.row(owner, 'AI_CONVERSATION', conversation['id'])
            active = self.services.get_item(owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
            if not conversation.get('queuePaused') and active and (active['status'] in {'running', 'awaiting_approval'}):
                return response(200, {'continued': True})
            conversation = self.ai.update(owner, 'AI_CONVERSATION', conversation, {'queuePaused': False, 'dispatchPending': False})
            self.signal(owner, conversation)
            return response(200, {'continued': True})
        if operation == 'queue' and method == 'POST' and (not item_id):
            client_id = payload.get('clientMessageId')
            text = payload.get('text', '')
            if not isinstance(client_id, str) or not re.fullmatch('[A-Za-z0-9_-]{8,100}', client_id) or (not isinstance(text, str)) or (len(text) > 12000):
                fail(400, 'Send a message up to 12,000 characters with a unique message ID.')
            attachments = self.attachment_ids(owner, conversation, payload)
            from backend.local_api.domain.ai_workbench import AiWorkbench
            if not text.strip() and (not attachments):
                fail(400, 'Write a message or attach a file.')
            request_values = request_selection(payload)
            queue_id = 'aiq_' + digest(client_id)[:32]
            existing = self.services.get_item(owner, kind, queue_id)
            if existing:
                if existing['text'] != text.strip() or existing['attachmentIds'] != attachments or request_selection(json_safe(existing.get('requestSelection', {}))) != request_values:
                    fail(409, 'This message ID was already used for different content.', 'AI_MESSAGE_CONFLICT')
                return response(200, {'message': clean(existing)})
            selection = AiWorkbench(self.ai).selection(owner, conversation, payload, previous_skill=retry_source.get('skillSnapshot') if retry_source else None, preserve_skill=retry_source is not None)
            item = {'requestSelection': request_values, 'PK': owner_partition(owner), 'SK': kind + '#' + queue_id, 'entityType': kind, 'ownerId': owner, 'id': queue_id, 'revision': 0, 'createdAt': utc_now(), 'conversationId': conversation['id'], 'clientMessageId': client_id, 'text': text.strip(), 'attachmentIds': attachments, **selection, 'sourceStamp': self.ai.context(owner, conversation)['stamp'], 'status': 'queued', 'order': str(time.time_ns())}
            if hasattr(self.services, 'enqueue_ai_message'):
                for _ in range(5):
                    current = self.ai.row(owner, 'AI_CONVERSATION', conversation['id'])
                    signalled = {**current, 'revision': int(current['revision']) + 1, 'updatedAt': utc_now(), 'dispatchPending': True, 'dispatchGeneration': current.get('dispatchGeneration', 0) + (0 if current.get('dispatchPending') else 1), 'GSI1PK': 'AI_IDLE' if current.get('queuePaused') else 'AI_DISPATCH', 'GSI1SK': str(time.time_ns())}
                    if self.services.enqueue_ai_message(item, signalled, int(current['revision'])):
                        break
                    existing = self.services.get_item(owner, kind, queue_id)
                    if existing:
                        if existing['text'] != item['text'] or existing['attachmentIds'] != attachments or request_selection(json_safe(existing.get('requestSelection', {}))) != request_values:
                            fail(409, 'This message ID was already used for different content.', 'AI_MESSAGE_CONFLICT')
                        return response(200, {'message': clean(existing)})
                else:
                    fail(409, 'The conversation changed. Retry this message.', 'AI_CONFLICT')
            else:
                self.services.put_item(item, 'attribute_not_exists(PK)')
                self.signal(owner, conversation)
            return response(202, {'message': clean(item)})
        if operation in {'queue', 'steer'} and item_id:
            item = self.ai.row(owner, kind, item_id)
            if item['status'] != 'queued':
                fail(409, 'Only a waiting message can be edited, cancelled or steered.', 'AI_MESSAGE_ACTIVE')
            if operation == 'queue' and method == 'PATCH':
                if payload.get('baseRevision') != item['revision'] or not isinstance(payload.get('text'), str) or len(payload['text']) > 12000:
                    fail(409, 'Reload the waiting message before editing.', 'AI_MESSAGE_CONFLICT')
                attachments = self.attachment_ids(owner, conversation, payload)
                from backend.local_api.domain.ai_workbench import AiWorkbench
                selection = AiWorkbench(self.ai).selection(owner, conversation, payload, previous_skill=item.get('skillSnapshot'), preserve_skill=True)
                if not payload['text'].strip() and (not attachments):
                    fail(400, 'Write a message or attach a file.')
                item = self.ai.update(owner, kind, item, {'text': payload['text'].strip(), 'attachmentIds': attachments, **selection, 'requestSelection': request_selection({**payload, 'skillRef': snapshot_ref(selection.get('skillSnapshot'))}), 'sourceStamp': self.ai.context(owner, conversation)['stamp']})
            elif operation == 'queue' and method == 'DELETE':
                item = self.ai.update(owner, kind, item, {'status': 'cancelled'})
            elif operation == 'steer' and method == 'POST':
                run = self.ai.row(owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
                if run['status'] not in {'running', 'awaiting_approval'}:
                    fail(409, 'There is no active turn to steer.', 'AI_RUN_INACTIVE')
                if item.get('taskMode', 'work') != run.get('taskMode', 'work'):
                    fail(409, 'Task mode is frozen for this turn. Keep this message queued for its own turn.', 'AI_TASK_LOCKED')
                if skill_identity(item.get('skillSnapshot')) != skill_identity(run.get('skillSnapshot')):
                    fail(409, 'Skill is frozen for this turn. Keep this message queued for its own turn.', 'AI_SKILL_LOCKED')
                from backend.local_api.domain.ai_workbench import AiWorkbench
                direction_context = AiWorkbench(self.ai).resolve(owner, conversation, json_safe([entry['ref'] for entry in item.get('contextManifest', [])]))
                pending = [a for a in self.services.list_owner_items(owner, 'AI_ACTION') if a.get('runId') == run['id'] and a['status'] == 'pending']
                message = {'PK': owner_partition(owner), 'SK': 'AI_MESSAGE#' + conversation['id'] + '#aim_' + digest(item['id'])[:32], 'entityType': 'AI_MESSAGE', 'ownerId': owner, 'id': 'aim_' + digest(item['id'])[:32], 'revision': 0, 'createdAt': utc_now(), 'conversationId': conversation['id'], 'runId': run['id'], 'role': 'user', 'text': clean(item['text'] or 'Read the attached files.'), 'attachmentIds': item['attachmentIds'], 'taskMode': run.get('taskMode', 'work'), 'contextManifest': direction_context, 'skillSnapshot': copy.deepcopy(run.get('skillSnapshot')), 'modelId': run['modelId'], 'providerId': run.get('providerId', 'phynite'), 'effort': run.get('effort', 'auto'), 'steering': True, 'order': str(time.time_ns())}
                status = 'awaiting_approval' if run.get('foreground') and run['status'] == 'awaiting_approval' else 'running'
                changes = [('AI_RUN', run, {'controlRevision': run.get('controlRevision', 0) + 1, 'status': status}), (kind, item, {'status': 'steered', 'runId': run['id']}), ('AI_CONVERSATION', conversation, {'dispatchPending': True, 'GSI1PK': 'AI_DISPATCH', 'GSI1SK': str(time.time_ns())})]
                changes += [('AI_ACTION', action, {'status': 'superseded', 'error': 'Replaced by your new direction. Review the revised action.'}) for action in pending]
                if hasattr(self.services, 'commit_ai_records'):
                    records = [({**row, **values, 'revision': int(row['revision']) + 1, 'updatedAt': utc_now()}, int(row['revision'])) for _, row, values in changes]
                    if not self.services.commit_ai_records([*records, (message, None)]):
                        fail(409, 'The turn changed. Reload before steering it.', 'AI_CONFLICT')
                    item = records[1][0]
                else:
                    for record_kind, row, values in changes:
                        updated = self.ai.update(owner, record_kind, row, values)
                        if row['id'] == item['id']:
                            item = updated
                    self.services.put_item(message, 'attribute_not_exists(PK)')
            else:
                fail(405, 'This queue operation is not supported.')
            return response(200, {'message': clean(item)})
        fail(404, 'The AI runtime operation was not found.', 'AI_NOT_FOUND')

    def claim(self, owner, conversation, *, foreground=False, queue_id=None):
        if foreground is not True:
            fail(400, 'Local AI turns must be started by the local provider connection.', 'LOCAL_AI_FOREGROUND_REQUIRED')
        if foreground:
            self.ai.row(owner, 'AI_QUEUE#' + conversation['id'], queue_id)
        if conversation.get('queuePaused'):
            if foreground:
                fail(409, 'Continue the paused queue before starting another message.', 'AI_QUEUE_PAUSED')
            return {'idle': True}
        active = self.services.get_item(owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
        if active and active.get('conversationId') != conversation['id']:
            fail(409, 'The saved turn belongs to another conversation. Refresh before continuing.', 'AI_RUN_INACTIVE')
        if active and active['status'] in {'running', 'awaiting_approval'}:
            fail(409, 'Another turn is active. Wait for it or stop it before continuing.', 'AI_RUN_ACTIVE')
        waiting = [q for q in self.queue(owner, conversation) if q['status'] in {'queued', 'claimed'}]
        if not waiting:
            if foreground:
                fail(409, 'The waiting message changed. Refresh the conversation.', 'AI_CONFLICT')
            self.ai.update(owner, 'AI_CONVERSATION', conversation, {'dispatchPending': False, 'GSI1PK': 'AI_IDLE'})
            return {'idle': True}
        kind = 'AI_QUEUE#' + conversation['id']
        item = self.ai.row(owner, kind, waiting[0]['id'])
        legacy_id = 'air_' + digest(item['id'])[:32]
        legacy = self.services.get_item(owner, 'AI_RUN', legacy_id)
        run_id = item.get('runId') or (legacy_id if legacy and legacy.get('conversationId') == conversation['id'] and (legacy.get('queueId') == item['id']) else 'air_' + digest([conversation['id'], item['id']])[:32])
        existing = self.services.get_item(owner, 'AI_RUN', run_id)
        if existing and (existing.get('conversationId') != conversation['id'] or existing.get('queueId') != item['id']):
            fail(404, 'The saved turn does not belong to this conversation.', 'AI_NOT_FOUND')
        if existing and existing['status'] in {'completed', 'failed', 'stopped'}:
            if foreground and item['status'] != 'claimed':
                fail(409, 'This message was already processed. Refresh the conversation.', 'AI_CONFLICT')
            self.finish(owner, conversation, existing, existing['status'])
            return self.claim(owner, self.ai.row(owner, 'AI_CONVERSATION', conversation['id']), foreground=foreground, queue_id=queue_id)
        if foreground and (item['id'] != queue_id or item['status'] != 'queued'):
            fail(409, 'Start the first waiting message in this conversation.', 'AI_CONFLICT')
        if foreground and existing:
            fail(409, 'This message is already being processed.', 'AI_RUN_ACTIVE')
        lease = secrets.token_hex(32)
        values = {'activeRunId': run_id, 'title': (item['text'] or 'Attached research files')[:90] if conversation['title'] == 'New research conversation' else conversation['title']}
        run = {'PK': owner_partition(owner), 'SK': 'AI_RUN#' + run_id, 'entityType': 'AI_RUN', 'ownerId': owner, 'id': run_id, 'revision': 0, 'createdAt': utc_now(), 'conversationId': conversation['id'], 'queueId': item['id'], 'modelId': conversation['modelId'], 'providerId': conversation.get('providerId', 'phynite'), 'effort': conversation.get('effort', 'auto'), 'mode': conversation['mode'], 'executionMode': item.get('executionMode', 'foreground'), 'taskMode': item.get('taskMode', 'work'), 'contextManifest': item.get('contextManifest', []), 'skillSnapshot': copy.deepcopy(item.get('skillSnapshot')), 'sourceArtifactId': item.get('sourceArtifactId'), 'sourcePlan': item.get('sourcePlan'), 'sourceStamp': item.get('sourceStamp') or self.ai.context(owner, conversation)['stamp'], 'status': 'running', 'steps': 0, 'controlRevision': 0, 'leaseHash': digest(lease), 'expiresAt': int(time.time()) + 900}
        if foreground:
            run['foreground'] = True
        message_id = 'aim_' + digest(item['id'])[:32]
        message = {'PK': owner_partition(owner), 'SK': 'AI_MESSAGE#' + conversation['id'] + '#' + message_id, 'entityType': 'AI_MESSAGE', 'ownerId': owner, 'id': message_id, 'revision': 0, 'createdAt': utc_now(), 'conversationId': conversation['id'], 'runId': run_id, 'role': 'user', 'text': clean(item['text'] or 'Read the attached files.'), 'attachmentIds': item['attachmentIds'], 'taskMode': run.get('taskMode', 'work'), 'contextManifest': run.get('contextManifest', []), 'skillSnapshot': copy.deepcopy(run.get('skillSnapshot')), 'modelId': conversation['modelId'], 'providerId': conversation.get('providerId', 'phynite'), 'effort': conversation.get('effort', 'auto'), 'order': str(time.time_ns())}
        if hasattr(self.services, 'commit_ai_records') and (not existing):
            claimed = {**item, 'status': 'claimed', 'runId': run_id, 'revision': int(item['revision']) + 1, 'updatedAt': utc_now()}
            next_conversation = {**conversation, **values, 'revision': int(conversation['revision']) + 1, 'updatedAt': utc_now()}
            if not self.services.commit_ai_records([(claimed, int(item['revision'])), (next_conversation, int(conversation['revision'])), (run, None), (message, None)]):
                fail(409, 'The inbox changed. Claim its current next message.', 'AI_CONFLICT')
            conversation = next_conversation
        else:
            conversation = self.ai.update(owner, 'AI_CONVERSATION', conversation, values)
            if not existing:
                self.services.put_item(run, 'attribute_not_exists(PK)')
            if item['status'] == 'queued':
                self.ai.update(owner, kind, item, {'status': 'claimed', 'runId': run_id})
            if not self.services.get_item(owner, 'AI_MESSAGE#' + conversation['id'], message_id):
                self.services.put_item(message, 'attribute_not_exists(PK)')
        return {**self.ai.detail(owner, conversation), 'lease': lease}

    def finish(self, owner, conversation, run, status):
        if run.get('queueId'):
            item = self.ai.row(owner, 'AI_QUEUE#' + conversation['id'], run['queueId'])
            if item['status'] != 'completed':
                self.ai.update(owner, 'AI_QUEUE#' + conversation['id'], item, {'status': 'completed'})
            current = self.ai.row(owner, 'AI_CONVERSATION', conversation['id'])
            paused = status != 'completed' or current.get('queuePaused', False)
            self.ai.update(owner, 'AI_CONVERSATION', current, {'queuePaused': paused, 'dispatchPending': True, 'GSI1PK': 'AI_IDLE' if paused else 'AI_DISPATCH'})
