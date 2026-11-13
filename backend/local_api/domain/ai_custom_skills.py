"""Owner-local workflow preferences; a frozen skill can only narrow host authority."""
from __future__ import annotations
import copy
import hashlib
import re
import secrets
from backend.local_api.domain.ai_skills import catalogue, invalid, manifest
from backend.local_api.domain.phynite_core import ApiError, json_safe

TASKS = {'work', 'plan', 'research', 'summary'}
ACTION_TOOLS = {
    'modify_structure': {'modify_structure'}, 'derive_structure': {'derive_structure'},
    'import_structure': {'import_structure', 'import_crystal_structure'}, 'import_md_potential': {'import_md_potential'},
    'save_workflow': {'edit_canvas', 'configure_qe_compute'}, 'run_workflow': {'run_workflow'}, 'cancel_workflow': {'cancel_workflow'},
    'save_dft': {'prepare_dft'}, 'run_dft': {'prepare_dft'}, 'save_md': {'save_md'},
    'run_md': {'run_md'}, 'run_analysis': {'run_analysis'}, 'cancel_job': {'cancel_job'},
    'save_figure': {'create_figure', 'edit_figure'}, 'export_figure': {'export_figure'},
}
READ_OPERATIONS = {
    'record_progress': {'ledger'}, 'read_compute': {'compute'}, 'list_job_artifacts': {'job_artifacts'},
    'read_job_file': {'job_file'}, 'query_dataset': {'dataset_query'}, 'search_md_potentials': {'potential_search'},
    'list_active_jobs': {'jobs'}, 'get_job_status': {'job_status'}, 'get_worker_status': {'worker_status'},
    'diagnose_calculation': {'calculation_diagnosis'}, 'preview_md_input': {'md_preview'},
    'read_report': {'report'}, 'read_artifact': {'artifact_get'}, 'publish_artifact': {'artifact_publish'},
    'update_artifact': {'artifact_update'}, 'propose_artifact_patch': {'artifact_propose'}, 'read_attachment': {'attachment_read'}, 'search_attachment': {'attachment_search'},
    'read_resource': {'read'}, 'read_canvas': {'canvas'},
}
TOOL_NAMES = set(READ_OPERATIONS) | set().union(*ACTION_TOOLS.values()) | {
    'get_context', 'read_guide', 'diagnose_figure', 'inspect_dft_setup', 'search_papers', 'lookup_paper',
    'search_crystal_structures', 'search_crystal_db',
}
RESERVED = TASKS | {'files', 'skills', 'mode', 'context', 'help', 'settings', 'mcp'}

RESERVED |= {'bands', 'crystal_structure', 'md', 'trajectory', 'extract_frame', 'figure', 'scf', 'dos', 'relax', 'md_analysis', 'phonon', 'legacy', 'btp2'}


def public(row):
    return json_safe({key: copy.deepcopy(row[key]) for key in ('id', 'scope', 'version', 'command', 'label', 'description', 'instruction', 'sha256', 'allowedTaskModes', 'allowedTools', 'archived', 'createdAt', 'updatedAt') if key in row})


def enforce_tools(snapshot, operation, payload):
    allowed = (snapshot or {}).get('allowedTools')
    if allowed is None or operation in {'context', 'ledger'} and not payload.get('toolName') and not payload.get('assessments'): return
    if operation == 'mcp_call' or operation == 'prepare' and payload.get('kind') == 'mcp_call':
        name = payload.get('toolName')
        if not isinstance(name, str) or not name.startswith('mcp__') or name not in allowed: invalid('The selected skill does not allow this MCP tool.', 'AI_SKILL_TOOL_DENIED', 403)
        return
    if operation == 'prepare':
        candidates = ACTION_TOOLS.get(payload.get('kind'), set())
    else:
        candidates = {name for name, operations in READ_OPERATIONS.items() if operation in operations}
        if operation == 'context': candidates = {name for name in allowed if name.startswith('mcp__')} | TOOL_NAMES - {'read_guide', 'search_papers', 'lookup_paper', 'search_crystal_structures', 'search_crystal_db'}
        if operation == 'read': candidates |= {'diagnose_figure', 'create_figure', 'edit_figure', 'export_figure'}
        if operation == 'canvas': candidates |= {'edit_canvas', 'configure_qe_compute', 'import_structure', 'import_crystal_structure', 'inspect_dft_setup', 'modify_structure'}
    if not candidates: return  # Lifecycle/control operations do not grant tools.
    name = payload.get('toolName')
    if not isinstance(name, str) or name not in candidates or name not in allowed:
        invalid('The selected skill does not allow this tool.', 'AI_SKILL_TOOL_DENIED', 403)


def available_tools():
    try:
        from backend.local_api.domain.ai_mcp import bridge
        return TOOL_NAMES | {tool['name'] for tool in bridge('tools').get('tools', []) if isinstance(tool, dict) and isinstance(tool.get('name'), str) and re.fullmatch(r'mcp__[A-Za-z0-9_-]{1,59}', tool['name'])}
    except (ApiError, AttributeError, KeyError, TypeError, ValueError):
        return TOOL_NAMES


class CustomSkills:
    def __init__(self, ai): self.ai, self.services = ai, ai.services

    def list(self, owner):
        return sorted([public(row) for row in self.services.list_owner_items(owner, 'AI_CUSTOM_SKILL') if not row.get('archived')], key=lambda row: row['command'])

    def catalog(self, owner):
        builtin, custom = catalogue(), self.list(owner)
        summaries = [{**{key: row[key] for key in ('id', 'scope', 'version', 'command', 'allowedTaskModes', 'allowedTools')}, 'label': {'en': row['label'], 'id': row['label']}, 'description': {'en': row['description'], 'id': row['description']}} for row in custom]
        return {'skills': builtin + summaries, 'builtin': builtin, 'custom': custom, 'toolNames': sorted(available_tools())}

    def get(self, owner, identifier):
        if not isinstance(identifier, str) or not re.fullmatch('usr_[a-f0-9]{16}', identifier): invalid()
        row = self.ai.row(owner, 'AI_CUSTOM_SKILL', identifier)
        if row.get('archived'): invalid('This skill is archived. Select a current skill.', 'AI_SKILL_CHANGED', 409)
        return row

    def save(self, owner, payload, identifier=None, archive=False):
        fields = {'command', 'label', 'description', 'instruction', 'allowedTaskModes', 'allowedTools', 'baseVersion'}
        if not isinstance(payload, dict) or set(payload) - fields: invalid('Skill contains unsupported fields.')
        known_tools = available_tools()
        # Local SQLite serialization covers command uniqueness and the owner limit.
        with self.services.table.atomic():
            current = self.get(owner, identifier) if identifier else None
            if current and (type(payload.get('baseVersion')) is not int or payload['baseVersion'] != current['version']):
                invalid('This skill changed. Reload before saving.', 'AI_SKILL_CHANGED', 409)
            if archive:
                return public(self.ai.update(owner, 'AI_CUSTOM_SKILL', current, {'archived': True, 'version': int(current['version']) + 1}))
            data = {key: copy.deepcopy(payload.get(key, (current or {}).get(key))) for key in fields - {'baseVersion'}}
            for key, maximum in [('command', 48), ('label', 80), ('description', 300), ('instruction', 6000)]:
                if not isinstance(data[key], str) or not 1 <= len(data[key].strip()) <= maximum: invalid(f'{key} must contain 1–{maximum} characters.')
                data[key] = data[key].strip()
            if not re.fullmatch('[a-z][a-z0-9_]{1,47}', data['command']) or data['command'] in RESERVED or any(item['command'] == data['command'] for item in manifest()): invalid('Choose a distinct command using lowercase letters, digits and underscores.')
            active = self.list(owner)
            if any(item['command'] == data['command'] and item['id'] != identifier for item in active): invalid('That command is already used by another skill.', 'AI_SKILL_CONFLICT', 409)
            if not current and len(active) >= 50: invalid('Archive a skill before creating another; the limit is 50 active skills.', 'AI_SKILL_LIMIT', 413)
            for key, known in [('allowedTaskModes', TASKS), ('allowedTools', known_tools)]:
                values = data[key]
                if values is not None and (not isinstance(values, list) or len(values) > len(known) or any(not isinstance(value, str) or value not in known for value in values) or len(values) != len(set(values))): invalid(f'{key} must be a distinct subset of the current catalogue or null.')
            data.update({'scope': 'user', 'version': int(current['version']) + 1 if current else 1, 'sha256': hashlib.sha256(data['instruction'].encode()).hexdigest(), 'archived': False})
            return public(self.ai.update(owner, 'AI_CUSTOM_SKILL', current, data) if current else self.ai.put(owner, 'AI_CUSTOM_SKILL', 'usr_' + secrets.token_hex(8), data))
