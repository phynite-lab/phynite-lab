"""Project-scoped co-researcher state and capabilities. No model credentials live here."""
from __future__ import annotations
import copy
import hashlib
import json
import math
import os
import re
import secrets
import time
from typing import Any
from backend.local_api.domain.phynite_core import ApiError, json_safe, owner_partition, public_item, response, storage_owner, utc_now
MODES = {'chat', 'approval', 'full'}
RESOURCE_KINDS = {'structure': 'STRUCTURE', 'calculation': 'CALCULATION', 'trajectory': 'MD_TRAJECTORY', 'simulation': 'MD_SIMULATION', 'analysis': 'MD_ANALYSIS', 'md_configuration': 'MD_CONFIGURATION', 'potential': 'MD_POTENTIAL', 'dataset': 'DATASET', 'figure': 'FIGURE'}
ACTIONS = {'derive_structure', 'save_dft', 'run_dft', 'save_md', 'run_md', 'run_analysis', 'cancel_job', 'save_figure', 'export_figure', 'save_workflow', 'run_workflow', 'cancel_workflow'}
PATH = re.compile('^/v1/ai/conversations(?:/([a-z0-9_]+)(?:/(detail|settings|start|resume|renew|stop|context|read|canvas|step|message|finish|prepare|execute|actions|queue|steer|continue|events|control|attachment_read|attachment_provider|save_plan|complete_call|replay|references|artifacts|report)(?:/([a-z0-9_]+))?)?)?$')

def router_models(provider: str='9router') -> list[str]:
    try:
        models = json.loads(os.environ.get('PHYNITE_LOCAL_AI_MODELS' if provider == 'local' else 'PHYNITE_AI_9ROUTER_MODELS', '[]'))
        local = True
        valid = lambda value: isinstance(value, str) and 0 < len(value) <= 200 and (not any((ord(character) < 32 or ord(character) == 127 for character in value))) if local else isinstance(value, str) and bool(re.fullmatch('[a-z0-9_-]+/[A-Za-z0-9_.:()\\[\\]-]{1,120}', value))
        if not isinstance(models, list) or len(models) > (1000 if local else 100) or any((not valid(value) for value in models)):
            raise ValueError()
        return models
    except (ValueError, TypeError):
        fail(503, 'The local AI catalogue needs attention.' if provider == 'local' else 'The 9Router catalogue needs attention.', 'AI_CONFIGURATION_INVALID')

def valid_selection(provider, model, effort) -> bool:
    if not isinstance(model, str) or not isinstance(effort, str):
        return False
    if provider == 'phynite':
        return False
    if provider == '9router':
        variant = re.fullmatch('ag/gemini-.*-(low|medium|high)', model)
        return model in router_models() and (effort == 'auto' or (variant is not None and effort == variant[1]))
    if provider == 'local':
        if model not in router_models('local') or not re.fullmatch('(?:codex|agy)/[A-Za-z0-9_.:/+\\-]{1,200}', model):
            return False
        try:
            report = json.loads(os.environ.get('PHYNITE_LOCAL_AI_CAPABILITIES', '{}'))
            catalog = report.get('models', {}).get(model, {}) if isinstance(report, dict) else {}
            efforts = catalog.get('efforts', ['auto']) if isinstance(catalog, dict) else ['auto']
            return isinstance(efforts, list) and effort in efforts
        except (TypeError, ValueError):
            return effort == 'auto'
    return False
SECRET = re.compile('(?i)(?:bearer\\s+[\\w.\\-]+|sk-[a-z0-9_\\-]{16,}|(?:token|password|api[_-]?key|secret)\\s*[:=]\\s*[^\\s,;]+)')

def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(json_safe(value), sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def clean(value: Any) -> Any:
    """Strip storage locations, signed links and credentials before exposing model context."""
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items() if key not in {'PK', 'SK', 'history', 'objectKey', 'extractedKey', 'visionKey', 'inputKey', 'outputPrefix', 'tokenHash', 'leaseHash'} and (not key.startswith('GSI')) and (key in {'inputTokens', 'outputTokens'} or not re.search('(?i)(?:token|secret|password|credential|downloadurl|uploadurl|authorization)', key))}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, str):
        return SECRET.sub('[redacted]', re.sub('https?://\\S*(?:X-Amz-|X-Goog-)\\S*', '[private artifact]', value, flags=re.I))
    return json_safe(value)

def public_failure(value: Any) -> dict:
    if not isinstance(value, dict) or set(value) - {'code', 'message', 'requestId', 'issues'}:
        fail(400, 'AI failure details are invalid.')
    code, message = (value.get('code'), value.get('message'))
    if not isinstance(code, str) or not re.fullmatch('[A-Z][A-Z0-9_]{0,79}', code) or (not isinstance(message, str)) or (not 1 <= len(message) <= 2000):
        fail(400, 'AI failure details are invalid.')
    if 'requestId' in value and (not isinstance(value['requestId'], str) or not 1 <= len(value['requestId']) <= 200):
        fail(400, 'AI failure tracking ID is invalid.')
    issues = value.get('issues', [])
    if not isinstance(issues, list) or len(issues) > 20:
        fail(400, 'AI failure issues are invalid.')
    for issue in issues:
        if not isinstance(issue, dict) or set(issue) - {'nodeId', 'path', 'message'} or (not isinstance(issue.get('message'), str)) or (len(issue['message']) > 1000):
            fail(400, 'AI failure issues are invalid.')
        for key, maximum in (('nodeId', 200), ('path', 400)):
            if key in issue and (not isinstance(issue[key], str) or len(issue[key]) > maximum):
                fail(400, 'AI failure issues are invalid.')
    return clean(value)

def body(result: dict) -> dict:
    return json.loads(result['body'])

def fail(status: int, message: str, code: str='AI_INVALID_REQUEST') -> None:
    raise ApiError(status, message, code)

def bounded(value: Any, maximum: int=24000) -> Any:
    value = clean(value)
    encoded = json.dumps(value, sort_keys=True)
    if len(encoded.encode()) <= maximum:
        return value
    return {'truncated': True, 'sha256': digest(value), 'note': 'Read the referenced project resource for the complete source.', 'resources': {key: {field: record[field] for field in ('id', 'name', 'status') if field in record} for key, record in value.items() if isinstance(record, dict) and 'id' in record} if isinstance(value, dict) else {}}

def valid_id(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch('[A-Za-z0-9_-]{1,200}', value):
        fail(400, 'A valid resource identifier is required.')
    return value

class AiWorkspace:

    def __init__(self, api: Any):
        self.api, self.services = (api, api.services)

    def row(self, owner: str, kind: str, item_id: str) -> dict:
        item = self.services.get_item(owner, kind, valid_id(item_id))
        if not item or item.get('ownerId') != owner or (kind == 'AI_CONVERSATION' and item.get('deletedAt')):
            fail(404, 'The requested AI resource was not found.', 'AI_NOT_FOUND')
        return copy.deepcopy(item)

    def put(self, owner: str, kind: str, item_id: str, values: dict) -> dict:
        item = {'PK': owner_partition(owner), 'SK': f'{kind}#{item_id}', 'entityType': kind, 'ownerId': owner, 'id': item_id, 'revision': 0, 'createdAt': utc_now(), **values}
        self.services.put_item(item, 'attribute_not_exists(PK)')
        return item

    def update(self, owner: str, kind: str, item: dict, values: dict) -> dict:
        updated = self.services.update_item_if_revision(owner, kind, item['id'], int(item.get('revision', 0)), {**values, 'revision': int(item.get('revision', 0)) + 1, 'updatedAt': utc_now()})
        if updated is None:
            fail(409, 'This conversation or action changed elsewhere. Reload before continuing.', 'AI_CONFLICT')
        return updated

    def workspace(self, owner: str) -> dict:
        return body(self.api.get_workspace(owner))

    def scope(self, owner: str, key: str | None) -> dict | None:
        if key is None:
            return None
        if not isinstance(key, str) or not re.fullmatch('(?:dft|md|project):[A-Za-z0-9_-]{1,200}', key):
            fail(400, 'Choose a project from your workspace.', 'AI_PROJECT_INVALID')
        kind, item_id = key.split(':', 1)
        if kind == 'dft':
            snapshot = self.workspace(owner).get('workspace') or {}
            project = next((p for p in snapshot.get('projects', []) if p.get('id') == item_id), None)
            if not project:
                fail(404, 'Save this DFT project to your account before opening it in AI.', 'AI_PROJECT_NOT_SYNCED')
            remote_id = project.get('remoteId')
            if remote_id:
                self.row(owner, 'PROJECT', remote_id)
        else:
            project = self.row(owner, 'PROJECT', item_id)
            remote_id = item_id
        return {'key': key, 'id': item_id, 'kind': 'canvas' if kind == 'project' else kind, 'name': project['name'], 'remoteId': remote_id}

    def projects(self, owner: str) -> list[dict]:
        snapshot = self.workspace(owner).get('workspace') or {}
        projects = [{'key': f"dft:{p['id']}", 'kind': 'dft', 'name': p['name'], 'href': f"/calculation?project={p['id']}"} for p in snapshot.get('projects', [])]
        linked = {p.get('remoteId') for p in snapshot.get('projects', [])}
        projects += [{'key': f"md:{p['id']}", 'kind': 'md', 'name': p['name'], 'href': f"/md?project={p['id']}"} for p in self.services.list_owner_items(owner, 'PROJECT') if p['id'] not in linked and ('MD' in p.get('tags', []) or p.get('description') == 'Molecular dynamics trajectories')]
        listed = {p['key'] for p in projects}
        projects += [{'key': f"project:{p['id']}", 'kind': 'canvas', 'name': p['name'], 'href': f"/projects/{p['id']}"} for p in self.services.list_owner_items(owner, 'PROJECT') if f"project:{p['id']}" not in listed]
        return projects

    def context(self, owner: str, conversation: dict) -> dict:
        project = self.scope(owner, conversation.get('projectKey'))
        if not project:
            return {'project': None, 'stamp': digest(None), 'resources': {}, 'workspace': None}
        workspace = self.workspace(owner) if project['kind'] == 'dft' else {'revision': 0, 'workspace': None}
        snapshot = workspace.get('workspace') or {}
        materials = [m for m in snapshot.get('materials', []) if m.get('projectId') == project['id']]
        material_ids = {m['id'] for m in materials}
        configs = [c for collection in ('calculationConfigurations', 'calculationComponents') for c in snapshot.get(collection, []) if c.get('materialId') in material_ids]
        resources = {name: [clean(item) for item in self.services.list_owner_items(owner, kind) if (name in {'dataset', 'figure'} or project.get('remoteId')) and item.get('projectId') == (project['id'] if name in {'dataset', 'figure'} else project.get('remoteId'))] for name, kind in RESOURCE_KINDS.items()}
        if project['kind'] == 'canvas':
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi
            envelope = ProjectWorkflowApi(self.api).load(owner, project['id'])
            resources['workflow'] = [{'id': project['id'], 'revision': envelope['revision'], 'sha256': digest(envelope['workflow']), 'nodes': [{'id': n['id'], 'kind': n['kind'], 'name': n['name']} for n in envelope['workflow']['nodes']]}]
            resources['workflow_run'] = [clean(r) for r in self.services.list_owner_items(owner, 'PROJECT_RUN') if r.get('projectId') == project['id']]
        stable_sources = {kind: [{k: item[k] for k in ('id', 'revision', 'sha256') if k in item} for item in entries] for kind, entries in resources.items() if kind in {'structure', 'md_configuration', 'potential', 'dataset', 'figure', 'workflow'}}
        stamp = digest({'project': project, 'workspaceRevision': workspace['revision'], 'sources': stable_sources})
        return {'project': project, 'stamp': stamp, 'workspaceRevision': workspace['revision'], 'workspace': {'materials': materials, 'configurations': configs}, 'resources': resources}

    def resource(self, owner: str, conversation: dict, kind: str, item_id: str) -> dict:
        context = self.context(owner, conversation)
        project = context['project']
        if not project:
            fail(409, 'Select a project before accessing research data.', 'AI_PROJECT_REQUIRED')
        if kind in {'workflow', 'workflow_run'}:
            if project['kind'] != 'canvas':
                fail(400, 'Select a Canvas project to read its workflow.')
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi
            service = ProjectWorkflowApi(self.api)
            if kind == 'workflow':
                if item_id != project['id']:
                    fail(404, 'This workflow is not in the selected project.', 'AI_NOT_FOUND')
                return clean(service.load(owner, project['id']))
            return clean(service.get_run(owner, project['id'], item_id))
        if kind in {'material', 'configuration'}:
            collection = context['workspace']['materials' if kind == 'material' else 'configurations']
            item = next((item for item in collection if item['id'] == item_id), None)
            if item is None:
                fail(404, 'This resource is not in the selected project.', 'AI_NOT_FOUND')
            return {'item': clean(item)}
        if kind not in RESOURCE_KINDS:
            fail(400, 'This resource type is not available to AI.')
        item = self.row(owner, RESOURCE_KINDS[kind], item_id)
        expected = project['id'] if kind in {'dataset', 'figure'} else project.get('remoteId')
        if not expected or item.get('projectId') != expected:
            fail(404, 'This resource is not in the selected project.', 'AI_NOT_FOUND')
        if kind in {'dataset', 'figure'}:
            from backend.local_api.domain.research_documents import ResearchDocuments
            return clean(body(ResearchDocuments(self.services).handle(owner, 'GET', 'datasets' if kind == 'dataset' else 'figures', item_id, {}, {})))
        result = {'item': clean(item)}
        if kind == 'structure':
            raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=item['objectKey'])['Body'].read(5000001)
            if len(raw) > 5000000:
                fail(413, 'The structure exceeds the AI read limit.')
            result['document'] = clean(json.loads(raw))
        if kind == 'calculation':
            result['details'] = clean(body(self.api.get_calculation(owner, item_id)))
        if kind == 'simulation':
            result['details'] = clean(body(self.api.get_md_simulation(owner, item_id)))
        if kind == 'analysis':
            result['details'] = clean(body(self.api.get_md_analysis(owner, item_id)))
        return result

    def run(self, owner: str, conversation: dict, payload: dict, lease: bool=True, allow_waiting: bool=False) -> dict:
        run = self.row(owner, 'AI_RUN', payload.get('runId', ''))
        if run.get('conversationId') != conversation['id'] or conversation.get('activeRunId') != run['id']:
            fail(409, 'This AI turn is no longer active.', 'AI_RUN_INACTIVE')
        if run['status'] not in {'running', 'awaiting_approval'} or int(run['expiresAt']) <= time.time():
            fail(409, 'This AI turn expired or stopped. Start a new message.', 'AI_RUN_EXPIRED')
        if lease and (run['status'] != 'running' and (not (allow_waiting and run['status'] == 'awaiting_approval')) or not secrets.compare_digest(run['leaseHash'], digest(payload.get('lease', '')))):
            fail(409, 'This AI turn has another active connection.', 'AI_RUN_INACTIVE')
        return run

    def message(self, owner: str, conversation: dict, run: dict, role: str, text: str, attachment_ids: list[str] | None=None, evidence: dict | None=None) -> dict:
        if role not in {'user', 'assistant', 'tool'} or not isinstance(text, str) or (not text.strip()) or (len(text) > 100000):
            fail(400, 'AI messages need text within the supported context size.')
        if evidence is not None and (not isinstance(evidence, dict) or set(evidence) - {'tool', 'arguments', 'readAt'} or len(json.dumps(evidence).encode()) > 16000):
            fail(400, 'Evidence metadata exceeds the supported size.', 'AI_EVIDENCE_INVALID')
        return self.put(owner, f"AI_MESSAGE#{conversation['id']}", 'aim_' + secrets.token_hex(16), {'entityType': 'AI_MESSAGE', 'conversationId': conversation['id'], 'runId': run['id'], 'role': role, 'text': clean(text), **({'evidence': clean(evidence)} if role == 'tool' and evidence else {}), 'modelId': run['modelId'], 'providerId': run.get('providerId', 'phynite'), 'effort': run.get('effort', 'auto'), 'attachmentIds': attachment_ids or [], 'order': str(time.time_ns()), 'taskMode': run.get('taskMode', 'work'), **({'contextManifest': run.get('contextManifest', []), 'skillSnapshot': copy.deepcopy(run.get('skillSnapshot'))} if role == 'user' else {})})

    def detail(self, owner: str, conversation: dict, before: str | None=None) -> dict:
        messages = sorted([clean(row) for row in self.services.list_owner_items(owner, f"AI_MESSAGE#{conversation['id']}")], key=lambda row: row['order'])
        if before:
            messages = [row for row in messages if row['order'] < before]
        selected = messages[-100:]
        selected_runs = {message['runId'] for message in selected} | {conversation.get('activeRunId')}
        actions = [self.public_action(row) for row in self.services.list_owner_items(owner, 'AI_ACTION') if row.get('conversationId') == conversation['id'] and row.get('runId') in selected_runs]
        active = self.services.get_item(owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
        from backend.local_api.domain.ai_runtime import AiRuntime
        runtime = AiRuntime(self.api)
        events = runtime.events(owner, conversation, tail=True)
        start = (active or {}).get('responseStart', '')
        last_assistant = max((m['order'] for m in messages if m['role'] == 'assistant'), default='')
        partial = ''.join((e['event']['text'] for e in runtime.events(owner, conversation, start, limit=200) if e['event']['type'] == 'text')) if start > last_assistant and active and (active['status'] == 'running') else ''
        return {'conversation': {'providerId': 'phynite', 'effort': 'auto', 'queuePaused': False, **clean(conversation)}, 'messages': selected, 'actions': sorted(actions, key=lambda row: row['createdAt']), 'turns': self.turn_summaries(owner, conversation['id'], selected_runs), 'run': clean(active) if active else None, 'hasOlderMessages': len(messages) > 100, 'before': selected[0]['order'] if selected else None, 'queue': AiRuntime(self.api).queue(owner, conversation), 'attachments': [clean(a) for a in self.services.list_owner_items(owner, 'AI_ATTACHMENT') if a['conversationId'] == conversation['id']], 'streamText': partial, 'eventCursor': events[-1]['order'] if events else ''}

    def turn_summaries(self, owner: str, conversation_id: str, run_ids: set[str | None]) -> dict:
        ids = sorted((run_id for run_id in run_ids if isinstance(run_id, str)))[:101]
        rows = []
        table = getattr(self.services, 'table', None)
        if table is not None and hasattr(table, 'name') and hasattr(table, 'meta'):
            for offset in range(0, len(ids), 100):
                request = {table.name: {'Keys': [{'PK': owner_partition(owner), 'SK': 'AI_RUN#' + run_id} for run_id in ids[offset:offset + 100]], 'ConsistentRead': True, 'ProjectionExpression': '#id, #conversation, #status, #failure', 'ExpressionAttributeNames': {'#id': 'id', '#conversation': 'conversationId', '#status': 'status', '#failure': 'failure'}}}
                for _ in range(3):
                    result = table.meta.client.batch_get_item(RequestItems=request)
                    rows.extend(result.get('Responses', {}).get(table.name, []))
                    request = result.get('UnprocessedKeys', {})
                    if not request:
                        break
        else:
            rows = [row for run_id in ids if (row := self.services.get_item(owner, 'AI_RUN', run_id))]
        return {row['id']: {'status': row['status'], **({'failure': clean(row['failure'])} if row.get('status') == 'failed' and isinstance(row.get('failure'), dict) else {})} for row in rows if row.get('id') in ids and row.get('conversationId') == conversation_id and (row.get('status') in {'running', 'awaiting_approval', 'completed', 'failed', 'stopped'})}

    def public_action(self, action: dict) -> dict:
        view = clean({key: value for key, value in action.items() if key not in {'payloadKey', 'resultKey', 'stamp'}})
        if view['status'] == 'pending' and view['expiresAt'] <= time.time():
            view.update({'status': 'expired', 'error': 'Approval expired. Ask AI to prepare a new action.'})
        return view

    def action_payload(self, action: dict) -> dict:
        raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=action['payloadKey'])['Body'].read(4000001)
        if len(raw) > 4000000:
            fail(413, 'The proposed action exceeds the supported size.')
        payload = json.loads(raw)
        if digest(payload) != action['payloadHash']:
            fail(409, 'The proposed action checksum no longer matches.', 'AI_ACTION_CHANGED')
        return payload

    def prepare(self, owner: str, conversation: dict, run: dict, payload: dict) -> dict:
        from backend.local_api.domain.ai_workbench import assert_work
        assert_work(run)
        if conversation['mode'] == 'chat':
            fail(403, 'Chat only mode cannot prepare changes. Choose an execution mode first.', 'AI_PERMISSION_DENIED')
        call_id = payload.get('toolCallId')
        if call_id is not None and (not isinstance(call_id, str) or not re.fullmatch('[A-Za-z0-9_-]{1,200}', call_id)):
            fail(400, 'The tool call identity is invalid.')
        action_id = 'aia_' + digest([run['id'], call_id])[:32] if call_id else 'aia_' + secrets.token_hex(16)
        existing = self.services.get_item(owner, 'AI_ACTION', action_id)
        if existing:
            return self.row(owner, 'AI_ACTION', action_id)
        context = self.context(owner, conversation)
        if not context['project']:
            fail(409, 'Select a project before preparing an action.', 'AI_PROJECT_REQUIRED')
        if payload.get('stamp') != context['stamp']:
            fail(409, 'The project changed while preparing this action. Read it again.', 'AI_CONTEXT_CHANGED')
        kind, data = (payload.get('kind'), payload.get('payload'))
        if kind not in ACTIONS or not isinstance(data, dict):
            fail(400, 'This action is not available to AI.')
        data = copy.deepcopy(data)
        self.validate_action(owner, conversation, kind, data)
        if kind == 'run_md':
            configuration = self.resource(owner, conversation, 'md_configuration', valid_id(data.get('configurationId')))['item']
            data['workflow'] = configuration['workflow']
        if kind == 'run_workflow':
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi
            plan, graph = ProjectWorkflowApi(self.api).plan(owner, project=context['project']['id'], payload=data)
            data = {'revision': plan['revision'], 'targets': plan['targets'], 'compilerSha256': plan['compilerSha256'], 'reviewedPlan': plan, 'reviewedWorkflow': graph}
        encoded = json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        if len(encoded) > 4000000:
            fail(413, 'The proposed action exceeds the supported size.')
        key = f'users/{storage_owner(owner)}/ai/actions/{action_id}.json'
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=encoded, ContentType='application/json', ServerSideEncryption='AES256')
        title = str(payload.get('title') or kind)[:180]
        before = self.summary(context)
        after = {'operation': kind, 'name': data.get('name'), 'computeTarget': 'personal' if kind.startswith('run_') else None}
        if kind == 'save_workflow':
            after['changes'] = [{'nodeId': c['nodeId'], 'name': (c.get('after') or c.get('before') or {}).get('name'), 'operation': 'add' if c.get('before') is None else 'remove' if c.get('after') is None else 'update', 'before': c.get('before'), 'after': c.get('after')} for c in data.get('changes', [])]
        elif kind in {'save_dft', 'run_dft'}:
            current = next((c for c in context['workspace']['configurations'] if c.get('id') == data.get('configurationId')), None)
            before['settings'] = current.get('draft') if current else None
            after['settings'] = data['draft']
            after['applicationDefaultsUsed'] = data.get('defaultsUsed', False)
        elif kind == 'derive_structure':
            current = next((m for m in context['workspace']['materials'] if m['id'] == data['materialId']))
            before['structure'] = {'name': current['name'], 'atomCount': len(current['atoms']), 'lattice': current['lattice']}
            after['structure'] = {'name': data.get('name'), 'atomCount': len(data['material']['atoms']), 'lattice': data['material']['lattice'], 'operation': data.get('operation')}
        elif kind in {'save_md', 'run_md'}:
            current = next((c for c in context['resources'].get('md_configuration', []) if c.get('id') == data.get('configurationId')), None)
            before['workflow'] = current.get('workflow') if current else None
            after['workflow'] = data['workflow']
        action = self.put(owner, 'AI_ACTION', action_id, {'conversationId': conversation['id'], 'runId': run['id'], 'kind': kind, 'title': title, 'status': 'pending', 'stamp': context['stamp'], 'workspaceRevision': context['workspaceRevision'], 'payloadKey': key, 'payloadHash': digest(data), 'before': bounded(before), 'after': bounded(after), 'expiresAt': run['expiresAt'], 'controlRevision': run.get('controlRevision', 0)})
        if conversation['mode'] == 'approval':
            self.update(owner, 'AI_RUN', run, {'status': 'awaiting_approval'})
        return action

    @staticmethod
    def summary(context: dict) -> dict:
        return {'project': context['project']['name'], 'workspaceRevision': context['workspaceRevision'], 'sourceFingerprint': context['stamp']}

    @staticmethod
    def personal_workflow(graph: dict) -> None:
        for node in graph['nodes']:
            config = node['configuration']
            if config.get('computeTarget', 'personal') != 'personal' or config.get('execution', {}).get('computeTarget', 'personal') != 'personal' or config.get('cloudMode'):
                fail(403, 'AI Canvas actions support personal compute only.', 'AI_PERMISSION_DENIED')

    def validate_action(self, owner: str, conversation: dict, kind: str, data: dict) -> None:
        project = self.scope(owner, conversation['projectKey'])
        if any((key in data for key in ('computeTarget', 'cloudMode', 'quoteId', 'url', 'path', 'ownerId'))):
            fail(400, 'AI actions cannot override ownership, network destinations or compute targets.')
        if kind in {'save_workflow', 'run_workflow', 'cancel_workflow'}:
            if project['kind'] != 'canvas':
                fail(400, 'Select a Canvas project for this action.')
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi, validate_graph
            service = ProjectWorkflowApi(self.api)
            envelope = service.load(owner, project['id'])
            if kind == 'save_workflow':
                graph = validate_graph(data.get('workflow'), project['id'])
                service.resources(owner, graph)
                if type(data.get('baseRevision')) is not int or data['baseRevision'] != envelope['revision']:
                    fail(409, 'The Canvas workflow changed. Read its current revision.', 'AI_CONTEXT_CHANGED')
                old_nodes = {n['id']: n for n in envelope['workflow']['nodes']}
                changed_compute = [n for n in graph['nodes'] if n['id'] not in old_nodes or any((n['configuration'].get(k) != old_nodes[n['id']]['configuration'].get(k) for k in ('computeTarget', 'cloudMode')))]
                self.personal_workflow({'nodes': changed_compute})
                from backend.local_api.domain.api import normalize_md_pipeline
                for node in graph['nodes']:
                    old = old_nodes.get(node['id'], {})
                    if node['configuration'] == old.get('configuration'):
                        continue
                    execution = node['configuration'].get('execution', {})
                    if node['kind'] == 'md-analysis' and execution.get('pipeline') is not None:
                        normalize_md_pipeline(execution['pipeline'])
                        if execution.get('computeTarget', 'personal') != 'personal':
                            fail(422, 'AI analysis uses personal compute only.', 'INVALID_COMPUTE_TARGET')
            elif kind == 'run_workflow':
                graph = envelope['workflow']
                plan, _ = service.plan(owner, project['id'], data)
                selected = set(plan['order'])
                self.personal_workflow({'nodes': [n for n in graph['nodes'] if n['id'] in selected]})
                if plan['errors']:
                    raise ApiError(422, 'Fix the Canvas workflow inputs before running.', 'WORKFLOW_NOT_READY', issues=[{'nodeId': e['nodeId'], 'path': 'configuration', 'message': e['message']} for e in plan['errors']])
                if data.get('reviewedPlan') is not None and (data['reviewedPlan'] != plan or data.get('reviewedWorkflow') != service.plan(owner, project['id'], data)[1]):
                    fail(409, 'The reviewed Canvas plan changed. Prepare a fresh action.', 'AI_CONTEXT_CHANGED')
            else:
                run = self.row(owner, 'PROJECT_RUN', valid_id(data.get('runId')))
                if run.get('projectId') != project['id']:
                    fail(404, 'This run is not in the selected project.', 'AI_NOT_FOUND')
                graph = service.read_json(run['objectKey'], run['sha256'])['workflow']
                self.personal_workflow(graph)
        if kind in {'save_dft', 'run_dft', 'derive_structure'}:
            if project['kind'] != 'dft':
                fail(400, 'This action requires a DFT project.')
            self.resource(owner, conversation, 'material', valid_id(data.get('materialId')))
        if kind in {'save_dft', 'run_dft'}:
            if not isinstance(data.get('draft'), dict) or not isinstance(data.get('submission'), dict):
                fail(400, 'A compiled calculation draft and exact input files are required.')
            if data.get('configurationId'):
                configuration = self.resource(owner, conversation, 'configuration', valid_id(data['configurationId']))['item']
                if configuration.get('materialId') != data['materialId']:
                    fail(409, 'The configuration belongs to another structure.', 'AI_PROJECT_MISMATCH')
            submission = data['submission']
            if set(submission) - {'calculationType', 'qeInput', 'inputFiles', 'settings', 'vcpus', 'memoryMiB'}:
                fail(400, 'Calculation submission fields are invalid.')
            if not isinstance(submission.get('qeInput'), str) or not isinstance(submission.get('inputFiles'), dict):
                fail(400, 'Exact Quantum ESPRESSO input is required.')
        if kind == 'derive_structure':
            material = data.get('material') or {}
            atoms, vectors = (material.get('atoms'), material.get('cellVectors'))
            if not isinstance(atoms, list) or not 1 <= len(atoms) <= 50000 or (not isinstance(vectors, list)) or (len(vectors) != 3):
                fail(400, 'A derived structure needs valid atoms and a cell.')
            if any((not isinstance(v, list) or len(v) != 3 or any((type(n) not in {int, float} or not math.isfinite(n) for n in v)) for v in vectors)):
                fail(400, 'The structure cell must be finite.')
            for atom in atoms:
                if not isinstance(atom, dict) or not isinstance(atom.get('species'), str) or any((type(atom.get(axis)) not in {int, float} or not math.isfinite(atom[axis]) for axis in ('x', 'y', 'z'))):
                    fail(400, 'Derived coordinates must be finite and preserve element identities.')
        if kind == 'save_md':
            workflow = self.api.normalize_md_workflow_for_user(owner, 'ai-save-configuration', data.get('workflow'))
            self.api.require_md_potential_scope(owner, project.get('remoteId') or '', workflow)
            if data.get('configurationId'):
                saved = self.resource(owner, conversation, 'md_configuration', valid_id(data['configurationId']))['item']
                if saved['workflow']['mode'] == 'guided' and workflow['mode'] == 'manual' and (workflow['steps'] != saved['workflow']['steps']):
                    fail(409, 'Keep the saved Guided steps when creating a manual override. Edit the manual body separately.', 'AI_GUIDED_STATE_CHANGED')
        if kind in {'run_md', 'run_analysis'}:
            self.resource(owner, conversation, 'trajectory', valid_id(data.get('trajectoryId')))
            if kind == 'run_md':
                self.resource(owner, conversation, 'md_configuration', valid_id(data.get('configurationId')))
            elif not isinstance(data.get('pipeline'), dict):
                fail(400, 'A supported MD analysis pipeline is required.')
        if kind == 'cancel_job':
            if data.get('resourceKind') not in {'calculation', 'simulation', 'analysis'}:
                fail(400, 'Choose a supported personal job.')
            item = self.resource(owner, conversation, data['resourceKind'], valid_id(data.get('resourceId')))['item']
            if item.get('computeTarget') != 'personal' and item.get('computeBackend') != 'LOCAL_MAC':
                fail(403, 'AI can only cancel personal compute jobs.', 'AI_PERMISSION_DENIED')
        if kind == 'save_figure':
            from backend.local_api.domain.research_documents import validate_document
            document = data.get('document')
            validate_document('figures', document, valid_id((document or {}).get('id')))
            if document['projectId'] != project['id']:
                fail(403, 'The figure belongs to another project.', 'AI_PERMISSION_DENIED')
            for panel in document['panels']:
                for layer in panel['layers']:
                    self.resource(owner, conversation, 'dataset', layer['datasetId'])
            current = self.services.get_item(owner, 'FIGURE', document['id'])
            if current and current.get('projectId') != project['id']:
                fail(403, 'The figure belongs to another project.', 'AI_PERMISSION_DENIED')
        if kind == 'export_figure':
            self.resource(owner, conversation, 'figure', valid_id(data.get('figureId')))
            if data.get('format') not in {'svg', 'png', 'pdf', 'zip'}:
                fail(400, 'Choose SVG, PNG, PDF, or ZIP.')

    def execute(self, owner: str, conversation: dict, action: dict, expected_hash: Any) -> dict:
        if action['conversationId'] != conversation['id']:
            fail(404, 'The action was not found.', 'AI_NOT_FOUND')
        if action['status'] == 'succeeded':
            return action
        if action['status'] != 'pending' or conversation['mode'] == 'chat':
            fail(409, 'This action cannot be executed again.', 'AI_ACTION_INACTIVE')
        run = self.run(owner, conversation, {'runId': action['runId']}, lease=False)
        from backend.local_api.domain.ai_workbench import assert_work
        assert_work(run)
        if action.get('controlRevision', 0) != run.get('controlRevision', 0):
            return self.update(owner, 'AI_ACTION', action, {'status': 'superseded', 'error': 'Your new direction replaced this action.'})
        if not isinstance(expected_hash, str) or not secrets.compare_digest(expected_hash, action['payloadHash']):
            fail(409, 'Review the exact action payload before approving.', 'AI_ACTION_CHANGED')
        if action['expiresAt'] <= time.time() or self.context(owner, conversation)['stamp'] != action['stamp']:
            return self.update(owner, 'AI_ACTION', action, {'status': 'expired', 'error': 'The project changed or approval expired. Ask AI to prepare a fresh action.'})
        payload = self.action_payload(action)
        self.validate_action(owner, conversation, action['kind'], payload)
        action = self.update(owner, 'AI_ACTION', action, {'status': 'executing'})
        try:
            result = self.perform(owner, conversation, action, payload)
        except ApiError as exc:
            return self.update(owner, 'AI_ACTION', action, {'status': 'failed', 'error': str(exc), 'code': exc.code, 'issues': exc.issues or []})
        except Exception:
            return self.update(owner, 'AI_ACTION', action, {'status': 'failed', 'error': 'The action could not be confirmed. Inspect the project/job state before preparing another action.'})
        result = clean(result)
        result_key = f"users/{storage_owner(owner)}/ai/actions/{action['id']}-result.json"
        self.services.s3.put_object(Bucket=self.services.bucket, Key=result_key, Body=json.dumps(result).encode(), ContentType='application/json', ServerSideEncryption='AES256')
        return self.update(owner, 'AI_ACTION', action, {'status': 'succeeded', 'result': bounded(result, 48000), 'resultKey': result_key})

    def perform(self, owner: str, conversation: dict, action: dict, data: dict) -> dict:
        kind = action['kind']
        project = self.scope(owner, conversation['projectKey'])
        now = utc_now()
        if kind in {'save_workflow', 'run_workflow', 'cancel_workflow'}:
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi
            service = ProjectWorkflowApi(self.api)
            if kind == 'save_workflow':
                saved = service.save(owner, project['id'], {'workflow': data['workflow'], 'baseRevision': data['baseRevision']})
                return {'saved': True, 'revision': saved['revision'], 'nodeIds': data.get('nodeIds', [])}
            if kind == 'run_workflow':
                return service.start(owner, project['id'], {'revision': data['revision'], 'targets': data['targets'], 'compilerSha256': data['compilerSha256'], 'idempotencyKey': action['id']})
            return service.cancel(owner, project['id'], data['runId'], {})
        if kind in {'save_dft', 'derive_structure'}:
            workspace = self.workspace(owner)
            if workspace['revision'] != action['workspaceRevision']:
                fail(409, 'The workspace changed after approval. Prepare the action again.', 'AI_CONTEXT_CHANGED')
            snapshot = copy.deepcopy(workspace['workspace'])
            source = next((m for m in snapshot['materials'] if m['id'] == data['materialId']))
            if kind == 'derive_structure':
                material = {**source, **data['material'], 'id': action['id'], 'projectId': project['id'], 'name': str(data.get('name') or 'Derived structure')[:140], 'createdAt': now, 'updatedAt': now}
                material.pop('remoteId', None)
                snapshot['materials'].append(material)
                result = {'materialId': material['id'], 'href': f"/calculation?project={project['id']}", 'provenance': data.get('operation')}
            else:
                configuration_id = data.get('configurationId') or action['id']
                configuration = {'id': configuration_id, 'name': str(data.get('name') or 'AI research draft')[:160], 'calculation': data['submission']['calculationType'], 'materialId': source['id'], 'materialName': source['name'], 'databaseId': source.get('databaseId', 'db-workspace'), 'databaseName': source.get('database', 'Workspace'), 'updated': now, 'draft': data['draft']}
                component = next((c for c in snapshot.get('calculationComponents', []) if c.get('id') == configuration_id), None)
                if component:
                    snapshot['calculationComponents'] = [{**c, 'draft': data['draft'], 'name': configuration['name'], 'calculation': configuration['calculation'], 'updatedAt': now} if c['id'] == configuration_id else c for c in snapshot['calculationComponents']]
                else:
                    snapshot['calculationConfigurations'] = [c for c in snapshot.get('calculationConfigurations', []) if c['id'] != configuration_id] + [configuration]
                result = {'configurationId': configuration_id, 'href': f"/calculation?project={project['id']}", 'saved': True}
            snapshot['savedAt'] = now
            self.api.put_workspace(owner, {'workspace': snapshot, 'baseRevision': workspace['revision']})
            return result
        if kind == 'run_dft':
            workspace = self.workspace(owner)
            if workspace['revision'] != action['workspaceRevision']:
                fail(409, 'The workspace changed after approval. Prepare the action again.', 'AI_CONTEXT_CHANGED')
            snapshot = copy.deepcopy(workspace['workspace'])
            material = next((m for m in snapshot['materials'] if m['id'] == data['materialId']))
            remote_id = project.get('remoteId')
            if not remote_id:
                local_project = next((p for p in snapshot['projects'] if p['id'] == project['id']))
                remote_id = body(self.api.create_project(owner, {'name': local_project['name'], 'description': local_project.get('description', ''), 'tags': ['QE']}))['project']['id']
                local_project['remoteId'] = remote_id
            structure_id = material.get('remoteId')
            if not structure_id:
                structure_id = body(self.api.create_structure(owner, remote_id, {'name': material['name'], 'formula': material['formula'], 'spaceGroup': material.get('spaceGroup', 'P1'), 'source': material.get('source', 'Phynite'), 'lattice': material['lattice'], 'atoms': material['atoms']}))['structure']['id']
                material['remoteId'] = structure_id
            self.row(owner, 'PROJECT', remote_id)
            structure = self.row(owner, 'STRUCTURE', structure_id)
            if structure['projectId'] != remote_id:
                fail(403, 'The structure is not part of this project.', 'AI_PERMISSION_DENIED')
            snapshot['savedAt'] = now
            saved = body(self.api.put_workspace(owner, {'workspace': snapshot, 'baseRevision': workspace['revision']}))
            result = body(self.api.create_calculation(owner, remote_id, {**data['submission'], 'name': str(data.get('name') or 'AI calculation')[:160], 'structureId': structure_id, 'computeTarget': 'personal', 'run': True, 'idempotencyKey': action['id']}))
            calculation = result['calculation']
            snapshot.setdefault('jobs', []).append({'id': action['id'], 'backendCalculationId': calculation['id'], 'materialId': material['id'], 'material': material['name'], 'name': calculation['name'], 'calculationType': calculation['calculationType'], 'databaseId': material.get('databaseId', 'db-workspace'), 'database': material.get('database', 'Workspace'), 'engine': 'Quantum ESPRESSO', 'status': {'QUEUED': 'Queued', 'RUNNING': 'Running', 'FAILED': 'Failed', 'COMPLETED': 'Completed'}.get(calculation['status'], calculation['status']), 'progress': calculation.get('progress', 0), 'settings': 'Exact AI action input retained', 'updated': now, 'startedAt': now})
            try:
                self.api.put_workspace(owner, {'workspace': snapshot, 'baseRevision': saved['revision']})
            except ApiError:
                result['workspaceNotice'] = 'The job was submitted, but the workspace changed. Inspect the recorded calculation ID; do not resubmit.'
            return result
        if kind == 'save_md':
            values = {'name': data.get('name') or 'AI MD configuration', 'workflow': data['workflow']}
            if data.get('configurationId'):
                current = self.row(owner, 'MD_CONFIGURATION', data['configurationId'])
                if self.context(owner, conversation)['stamp'] != action['stamp']:
                    fail(409, 'The configuration changed after approval.', 'AI_CONTEXT_CHANGED')
                return body(self.api.update_md_configuration(owner, data['configurationId'], {**values, 'baseRevision': int(current.get('revision', 0))}))
            return body(self.api.create_md_configuration(owner, project['remoteId'], values))
        if kind == 'run_md':
            return body(self.api.create_md_simulation(owner, project['remoteId'], {'trajectoryId': data['trajectoryId'], 'name': data.get('name') or 'AI MD simulation', 'workflow': data['workflow'], 'computeTarget': 'personal', 'idempotencyKey': action['id']}))
        if kind == 'run_analysis':
            return body(self.api.create_md_analysis(owner, project['remoteId'], {'trajectoryId': data['trajectoryId'], 'name': data.get('name') or 'AI MD analysis', 'pipeline': data['pipeline'], 'computeTarget': 'personal', 'idempotencyKey': action['id']}))
        if kind == 'cancel_job':
            method = {'calculation': self.api.cancel_calculation, 'simulation': self.api.cancel_md_simulation, 'analysis': self.api.cancel_md_analysis}[data['resourceKind']]
            return body(method(owner, data['resourceId']))
        if kind == 'save_figure':
            from backend.local_api.domain.research_documents import ResearchDocuments
            return body(ResearchDocuments(self.services).handle(owner, 'PUT', 'figures', data['document']['id'], {}, {'document': data['document'], 'baseRevision': data['baseRevision']}))
        if kind == 'export_figure':
            figure = self.resource(owner, conversation, 'figure', data['figureId'])
            return {'exportReady': True, 'figureId': data['figureId'], 'format': data['format'], 'revision': figure['revision'], 'href': f"/calculation?project={project['id']}&view=figures"}
        fail(400, 'This action is not supported.')

    def handle(self, owner: str, method: str, path: str, payload: dict, params: dict) -> dict:
        if path == '/v1/ai/skills' and method == 'GET':
            from backend.local_api.domain.ai_skills import catalogue
            return response(200, {'skills': catalogue()})
        if path == '/v1/ai/projects' and method == 'GET':
            return response(200, {'projects': self.projects(owner)})
        attachment = re.fullmatch('/v1/ai/conversations/([a-z0-9_]+)/attachments(?:/([a-z0-9_]+)(?:/(upload|content|complete))?)?', path)
        if attachment:
            from backend.local_api.domain.ai_attachments import AiAttachments
            conversation = self.row(owner, 'AI_CONVERSATION', attachment[1])
            self.scope(owner, conversation['projectKey'])
            return AiAttachments(self.api).handle(owner, conversation, method, attachment[2], attachment[3], payload)
        match = PATH.fullmatch(path)
        if not match:
            fail(404, 'The AI route was not found.', 'AI_NOT_FOUND')
        conversation_id, operation, action_id = match.groups()
        if conversation_id is None:
            if method == 'GET':
                rows = [clean(row) for row in self.services.list_owner_items(owner, 'AI_CONVERSATION') if not row.get('deletedAt')]
                return response(200, {'conversations': sorted(rows, key=lambda row: row.get('updatedAt', row['createdAt']), reverse=True)})
            if method != 'POST':
                fail(405, 'This method is not supported.')
            model, mode, key = (payload.get('modelId'), payload.get('mode', 'approval'), payload.get('projectKey'))
            effort = payload.get('effort', 'auto')
            provider = payload.get('providerId', 'local')
            if not isinstance(mode, str) or mode not in MODES or (not valid_selection(provider, model, effort)):
                fail(400, 'Choose a supported model and permission mode.')
            self.scope(owner, key)
            row = self.put(owner, 'AI_CONVERSATION', 'aic_' + secrets.token_hex(16), {'title': 'New research conversation', 'projectKey': key, 'modelId': model, 'providerId': provider, 'mode': mode, 'effort': effort, 'queuePaused': False, 'activeRunId': None, 'updatedAt': utc_now()})
            return response(201, {'conversation': clean(row)})
        conversation = self.row(owner, 'AI_CONVERSATION', conversation_id)
        if method == 'DELETE' and operation is None:
            active_id = conversation.get('activeRunId')
            run = self.services.get_item(owner, 'AI_RUN', active_id) if active_id else None
            if run and (run.get('ownerId') != owner or run.get('conversationId') != conversation_id):
                fail(404, 'The turn was not found. Refresh this chat before trying again.', 'AI_RUN_NOT_FOUND')
            if run and run.get('status') in {'running', 'awaiting_approval'}:
                fail(409, 'Stop the AI response before deleting this chat.', 'AI_RUN_ACTIVE')
            if any((action.get('conversationId') == conversation_id and action.get('status') == 'executing' for action in self.services.list_owner_items(owner, 'AI_ACTION'))):
                fail(409, 'Wait for the current action to finish before deleting this chat.', 'AI_ACTION_EXECUTING')
            self.update(owner, 'AI_CONVERSATION', conversation, {'deletedAt': utc_now(), 'title': 'Deleted chat', 'queuePaused': True, 'dispatchPending': False, 'GSI1PK': 'AI_IDLE', 'activeRunId': None})
            return response(200, {'deleted': True})
        from backend.local_api.domain.ai_workbench import AiWorkbench
        workbench = AiWorkbench(self)
        if operation == 'references':
            self.scope(owner, conversation['projectKey'])
            if method == 'GET':
                return response(200, workbench.catalogue(owner, conversation, str(params.get('q', ''))[:200], params.get('nodeId')))
            if method == 'POST':
                return response(200, {'contextManifest': workbench.resolve(owner, conversation, payload.get('contextRefs', []))})
        if operation == 'artifacts' and method == 'GET':
            self.scope(owner, conversation['projectKey'])
            return response(200, {'artifacts': workbench.artifacts(owner, conversation)})
        if operation in {'queue', 'steer', 'continue', 'events'}:
            from backend.local_api.domain.ai_runtime import AiRuntime
            self.scope(owner, conversation['projectKey'])
            return AiRuntime(self.api).handle(owner, conversation, method, operation, action_id, payload, params)
        if method == 'GET' and operation in {None, 'detail'}:
            return response(200, self.detail(owner, conversation, params.get('before')))
        if method == 'GET' and operation == 'context':
            return response(200, clean(self.context(owner, conversation)))
        if method == 'GET' and operation == 'actions' and action_id:
            action = self.row(owner, 'AI_ACTION', action_id)
            if action['conversationId'] != conversation_id:
                fail(404, 'The action was not found.', 'AI_NOT_FOUND')
            data = self.action_payload(action)
            if params.get('export') == '1':
                if action['kind'] != 'export_figure' or action['status'] != 'succeeded':
                    fail(409, 'A completed export action is required.')
                from backend.local_api.domain.research_documents import ResearchDocuments
                documents = ResearchDocuments(self.services)
                project = self.scope(owner, conversation['projectKey'])
                self.resource(owner, conversation, 'figure', data['figureId'])
                saved = body(documents.handle(owner, 'GET', 'figures', data['figureId'], {'revision': action['result']['revision']}, {}))
                datasets = []
                for dataset_id in dict.fromkeys((layer['datasetId'] for panel in saved['document']['panels'] for layer in panel['layers'])):
                    dataset = self.resource(owner, conversation, 'dataset', dataset_id)['document']
                    if dataset['projectId'] != project['id']:
                        fail(403, 'The figure source belongs to another project.', 'AI_PERMISSION_DENIED')
                    datasets.append(dataset)
                return response(200, {'exportDocument': {'figure': saved['document'], 'datasets': datasets, 'revision': saved['revision'], 'format': data['format']}})
            return response(200, {'action': self.public_action(action), 'preview': clean(data)})
        if method == 'PATCH' and operation == 'settings':
            if set(payload) - {'baseRevision', 'modelId', 'providerId', 'mode', 'effort'} or type(payload.get('baseRevision')) is not int or payload['baseRevision'] != conversation['revision']:
                fail(409, 'Reload this conversation before changing settings.', 'AI_CONFLICT')
            active = self.services.get_item(owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
            if active and active['status'] in {'running', 'awaiting_approval'} and (active['expiresAt'] > time.time()):
                fail(409, 'Finish or stop the current turn before changing model or permissions.', 'AI_RUN_ACTIVE')
            effort = payload.get('effort', conversation.get('effort', 'auto'))
            provider = payload.get('providerId', conversation.get('providerId', 'phynite'))
            if not isinstance(payload.get('mode'), str) or payload['mode'] not in MODES or (not valid_selection(provider, payload.get('modelId'), effort)):
                fail(400, 'Choose a supported model and permission mode.')
            return response(200, {'conversation': clean(self.update(owner, 'AI_CONVERSATION', conversation, {'modelId': payload['modelId'], 'providerId': provider, 'mode': payload['mode'], 'effort': effort, 'activeRunId': None}))})
        if method == 'POST' and operation in {'start', 'resume'}:
            if 'settingsRevision' in payload and payload['settingsRevision'] != conversation['revision']:
                fail(409, 'The AI source or model changed. Refresh before sending again.', 'AI_CONFLICT')
            if operation == 'start' and 'queueId' in payload:
                if not isinstance(payload['queueId'], str) or not re.fullmatch('aiq_[a-z0-9]+', payload['queueId']):
                    fail(400, 'Choose a saved waiting message.', 'AI_MESSAGE_INVALID')
                self.scope(owner, conversation['projectKey'])
                from backend.local_api.domain.ai_runtime import AiRuntime
                return response(200, AiRuntime(self.api).claim(owner, conversation, foreground=True, queue_id=payload['queueId']))
            lease = secrets.token_hex(32)
            if operation == 'resume':
                run = self.run(owner, conversation, payload, lease=False)
                pending = [a for a in self.services.list_owner_items(owner, 'AI_ACTION') if a.get('runId') == run['id'] and a['status'] in {'pending', 'executing'}]
                if run['status'] != 'awaiting_approval' or pending:
                    fail(409, 'Resolve the pending action before continuing.', 'AI_APPROVAL_REQUIRED')
                run = self.update(owner, 'AI_RUN', run, {'status': 'running', 'leaseHash': digest(lease), 'expiresAt': int(time.time()) + 900})
            else:
                from backend.local_api.domain.ai_runtime import AiRuntime
                attachment_ids = AiRuntime(self.api).attachment_ids(owner, conversation, payload)
                text = payload.get('text', '')
                if not isinstance(text, str) or len(text.strip()) > 12000 or (not text.strip() and (not attachment_ids)):
                    fail(400, 'Write a message of up to 12,000 characters.')
                active = self.services.get_item(owner, 'AI_RUN', conversation.get('activeRunId') or 'none')
                if active and active['status'] in {'running', 'awaiting_approval'} and (active['expiresAt'] > time.time()):
                    fail(409, 'Finish or stop the current turn before sending another message.', 'AI_RUN_ACTIVE')
                selection = workbench.selection(owner, conversation, payload)
                text = text.strip() or 'Read the attached files.'
                run_id = 'air_' + secrets.token_hex(16)
                conversation = self.update(owner, 'AI_CONVERSATION', conversation, {'activeRunId': run_id, 'title': text.strip()[:90] if conversation['title'] == 'New research conversation' else conversation['title']})
                run = self.put(owner, 'AI_RUN', run_id, {'conversationId': conversation_id, 'modelId': conversation['modelId'], 'providerId': conversation.get('providerId', 'phynite'), 'effort': conversation.get('effort', 'auto'), 'mode': conversation['mode'], **selection, 'sourceStamp': self.context(owner, conversation)['stamp'], 'status': 'running', 'steps': 0, 'leaseHash': digest(lease), 'expiresAt': int(time.time()) + 900})
                self.message(owner, conversation, run, 'user', text, attachment_ids)
            return response(200, {**self.detail(owner, conversation), 'lease': lease})
        if method == 'POST' and operation == 'stop':
            run_id = payload.get('runId') or conversation.get('activeRunId')
            if payload.get('runId') and payload['runId'] != conversation.get('activeRunId'):
                fail(409, 'Another turn is now active. Refresh before stopping it.', 'AI_RUN_INACTIVE')
            run = self.services.get_item(owner, 'AI_RUN', run_id) if run_id else None
            if run and (run.get('ownerId') != owner or run.get('conversationId') != conversation_id):
                fail(404, 'The turn was not found. Refresh this chat before trying again.', 'AI_RUN_NOT_FOUND')
            self.update(owner, 'AI_CONVERSATION', conversation, {'queuePaused': True, 'GSI1PK': 'AI_IDLE', **({'activeRunId': None, 'dispatchPending': False} if not run else {})})
            if not run:
                return response(200, {'stopped': True})
            if run['status'] in {'running', 'awaiting_approval'}:
                self.update(owner, 'AI_RUN', run, {'status': 'stopped'})
                from backend.local_api.domain.ai_runtime import AiRuntime
                AiRuntime(self.api).finish(owner, conversation, run, 'stopped')
            for action in self.services.list_owner_items(owner, 'AI_ACTION'):
                if action.get('runId') == run['id'] and action['status'] == 'pending':
                    self.update(owner, 'AI_ACTION', action, {'status': 'rejected', 'error': 'The user stopped this turn.'})
            return response(200, {'stopped': True})
        if method == 'POST' and operation == 'actions' and action_id:
            action = self.row(owner, 'AI_ACTION', action_id)
            if action['conversationId'] != conversation_id:
                fail(404, 'The action was not found.', 'AI_NOT_FOUND')
            if payload.get('decision') == 'reject':
                if action['status'] != 'pending':
                    fail(409, 'This action is no longer pending.')
                action = self.update(owner, 'AI_ACTION', action, {'status': 'rejected'})
            elif payload.get('decision') == 'approve':
                if conversation['mode'] != 'approval':
                    fail(403, 'This action does not use approval mode.', 'AI_PERMISSION_DENIED')
                action = self.execute(owner, conversation, action, payload.get('payloadHash'))
            else:
                fail(400, 'Approve or reject the action.')
            run = self.row(owner, 'AI_RUN', action['runId'])
            self.message(owner, conversation, run, 'tool', json.dumps(self.public_action(action)))
            return response(200, {'action': self.public_action(action)})
        if method != 'POST':
            fail(405, 'This method is not supported.')
        run = self.run(owner, conversation, payload, allow_waiting=operation == 'complete_call')
        if operation == 'renew':
            renewed = self.update(owner, 'AI_RUN', run, {'expiresAt': int(time.time()) + 900})
            return response(200, {'expiresAt': renewed['expiresAt']})
        if operation == 'context':
            return response(200, clean(self.context(owner, conversation)))
        if operation == 'replay':
            call_id = payload.get('toolCallId')
            if not isinstance(call_id, str) or not re.fullmatch('[A-Za-z0-9_-]{1,200}', call_id):
                fail(400, 'Provide a valid tool call ID.')
            action = self.services.get_item(owner, 'AI_ACTION', 'aia_' + digest([run['id'], call_id])[:32])
            return response(200, {'action': self.public_action(action) if action else None})
        if operation == 'save_plan':
            calls = payload.get('calls')
            if not isinstance(calls, list) or len(calls) > 12 or len(json.dumps(calls).encode()) > 250000 or any((not isinstance(c, dict) or c.get('type') != 'tool_use' for c in calls)):
                fail(422, 'The tool plan exceeds supported limits.', 'AI_TOOL_INPUT_INVALID')
            if run.get('pendingCalls'):
                if run['pendingCalls'] == calls:
                    return response(200, {'saved': True})
                fail(409, 'Finish the recorded tool plan first.', 'AI_PLAN_ACTIVE')
            self.update(owner, 'AI_RUN', run, {'pendingCalls': calls, 'planControlRevision': run.get('controlRevision', 0)})
            return response(200, {'saved': True})
        if operation == 'complete_call':
            call_id, text = (payload.get('toolCallId'), payload.get('text'))
            pending = run.get('pendingCalls', [])
            message_id = 'aim_' + digest([run['id'], call_id])[:32]
            if not any((c['id'] == call_id for c in pending)) and self.services.get_item(owner, 'AI_MESSAGE#' + conversation_id, message_id):
                return response(200, {'saved': True})
            if not isinstance(text, str) or not 0 < len(text) <= 100000 or (not any((c['id'] == call_id for c in pending))):
                fail(409, 'This tool call is no longer pending.', 'AI_PLAN_CHANGED')
            message_id = 'aim_' + digest([run['id'], call_id])[:32]
            if not self.services.get_item(owner, 'AI_MESSAGE#' + conversation_id, message_id):
                self.put(owner, 'AI_MESSAGE#' + conversation_id, message_id, {'entityType': 'AI_MESSAGE', 'conversationId': conversation_id, 'runId': run['id'], 'role': 'tool', 'text': clean(text), **({'evidence': clean(payload['evidence'])} if payload.get('evidence') else {}), 'modelId': run['modelId'], 'providerId': run.get('providerId', 'phynite'), 'effort': run.get('effort', 'auto'), 'order': str(time.time_ns())})
            self.update(owner, 'AI_RUN', run, {'pendingCalls': [] if payload.get('discardRest') else [c for c in pending if c['id'] != call_id]})
            return response(200, {'saved': True})
        if operation == 'control':
            steering = [m for m in self.detail(owner, conversation)['messages'] if m.get('steering') and m['runId'] == run['id'] and (m['id'] not in payload.get('seen', []))]
            return response(200, {'controlRevision': run.get('controlRevision', 0), 'messages': steering})
        if operation in {'prepare', 'execute', 'finish'} and run.get('queueId') and (payload.get('controlRevision', 0) != run.get('controlRevision', 0)):
            fail(409, 'New user direction is waiting. Read it before taking another action.', 'AI_STEER_PENDING')
        if operation in {'attachment_read', 'attachment_provider'}:
            from backend.local_api.domain.ai_attachments import AiAttachments
            return response(200, AiAttachments(self.api).read(owner, conversation, payload, operation == 'attachment_provider'))
        if operation == 'canvas':
            project = self.scope(owner, conversation['projectKey'])
            if project['kind'] != 'canvas':
                fail(400, 'Open a Canvas project for module editing.', 'AI_PROJECT_INVALID')
            from backend.local_api.domain.project_workflow import ProjectWorkflowApi
            saved = ProjectWorkflowApi(self.api).load(owner, project['id'])
            if payload.get('public'):
                ids = payload.get('nodeIds', [])
                if not isinstance(ids, list) or len(ids) > 10:
                    fail(400, 'Read at most ten exact module configurations at a time.')
                saved = {'revision': saved['revision'], 'projectId': project['id'], 'nodes': [{'id': n['id'], 'name': n['name'], 'kind': n['kind'], **({'configuration': n['configuration'], 'resources': n['resources']} if n['id'] in ids else {})} for n in saved['workflow']['nodes']], 'edges': saved['workflow']['edges'], 'groups': saved['workflow']['groups']}
                return response(200, clean(saved))
            return response(200, saved)
        if operation == 'report':
            item = self.row(owner, 'AI_ARTIFACT', valid_id(payload.get('id')))
            if item.get('conversationId') != conversation_id:
                fail(404, 'This report is not in this conversation.', 'AI_NOT_FOUND')
            return response(200, {'artifact': clean(item)})
        if operation == 'read':
            return response(200, self.resource(owner, conversation, str(payload.get('kind')), valid_id(payload.get('id'))))
        if operation == 'step':
            called = run.get('countedCalls', [])
            call_id = payload.get('toolCallId')
            if call_id and call_id in called:
                return response(200, {'run': clean(run)})
            if run['steps'] >= 12:
                fail(409, 'This turn reached 12 tool calls. Continue with a new message.', 'AI_STEP_LIMIT')
            return response(200, {'run': clean(self.update(owner, 'AI_RUN', run, {'steps': run['steps'] + 1, 'countedCalls': called + ([call_id] if call_id else [])}))})
        if operation == 'message':
            self.message(owner, conversation, run, payload.get('role'), payload.get('text'), evidence=payload.get('evidence'))
            return response(200, {'saved': True})
        if operation == 'prepare':
            return response(201, {'action': self.public_action(self.prepare(owner, conversation, run, payload))})
        if operation == 'execute':
            if conversation['mode'] != 'full':
                fail(403, 'Full access is required for automatic execution.', 'AI_PERMISSION_DENIED')
            return response(200, {'action': self.public_action(self.execute(owner, conversation, self.row(owner, 'AI_ACTION', payload.get('actionId', '')), payload.get('payloadHash')))})
        if operation == 'finish':
            status = payload.get('status')
            if status not in {'completed', 'failed'}:
                fail(400, 'The turn status is invalid.')
            failure = public_failure(payload['failure']) if 'failure' in payload else None
            if failure is not None and status != 'failed':
                fail(400, 'Only a failed turn may include failure details.')
            usage = payload.get('usage') or {}
            if not isinstance(usage, dict) or any((type(value) is not int or value < 0 for value in usage.values())):
                fail(400, 'Token usage is invalid.')
            workbench.complete(owner, conversation, run, status)
            updated = self.update(owner, 'AI_RUN', run, {'status': status, 'usage': usage, 'latencyMs': max(0, min(int(payload.get('latencyMs', 0)), 604800000)), **({'failure': failure} if failure is not None else {})})
            from backend.local_api.domain.ai_runtime import AiRuntime
            AiRuntime(self.api).finish(owner, conversation, run, status)
            return response(200, {'run': clean(updated)})
        fail(404, 'The AI operation was not found.', 'AI_NOT_FOUND')
