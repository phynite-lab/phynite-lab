"""Owner/project-gated access to the launcher-owned, opt-in local MCP bridge."""
from __future__ import annotations
import copy
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from backend.local_api.domain.ai_workspace import fail, clean


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None


def bridge(operation, payload=None):
    # This public distribution has no hosted MCP client or arbitrary URL input.
    if os.environ.get('PHYNITE_APP_MODE') != 'local': fail(404, 'Local MCP requires the installed application.', 'MCP_LOCAL_REQUIRED')
    origin, token = os.environ.get('PHYNITE_LOCAL_AI_URL', ''), os.environ.get('PHYNITE_LOCAL_AI_TOKEN', '')
    try:
        url = urllib.parse.urlsplit(origin)
        valid = url.scheme == 'http' and url.hostname == '127.0.0.1' and url.port and not url.username and not url.password and url.path in {'', '/'} and not url.query and not url.fragment
    except ValueError: valid = False
    if not valid or not token: fail(503, 'Restart the current launcher to use local MCP.', 'MCP_UNAVAILABLE')
    if operation not in {'tools', 'validate', 'call'}: fail(400, 'Unsupported MCP bridge operation.')
    request = urllib.request.Request(origin.rstrip('/') + '/mcp/' + operation, data=json.dumps(payload or {}).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=45) as reply:
            raw = reply.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024: fail(413, 'The local MCP response exceeds its limit.', 'MCP_RESPONSE_LIMIT')
            result = json.loads(raw)
            if not isinstance(result, dict): raise ValueError()
            return result
    except (urllib.error.URLError, OSError, ValueError):
        fail(422, 'The enabled local MCP tool is unavailable or changed. Refresh connections and prepare a fresh request.', 'MCP_UNAVAILABLE')


class AiMcp:
    def __init__(self, ai): self.ai = ai

    def tools(self, conversation, run):
        catalogue = bridge('tools').get('tools', [])
        if not isinstance(catalogue, list) or len(catalogue) > 48: fail(422, 'The local MCP catalogue is invalid.', 'MCP_CATALOG_INVALID')
        allowed = (run.get('skillSnapshot') or {}).get('allowedTools')
        work = run.get('taskMode', 'work') == 'work' and conversation['mode'] != 'chat' and conversation.get('projectKey')
        return [tool for tool in catalogue if isinstance(tool, dict) and isinstance(tool.get('name'), str) and re.fullmatch(r'mcp__[A-Za-z0-9_-]{1,59}', tool['name']) and (tool.get('readOnly') is True or work) and (allowed is None or tool['name'] in allowed)]

    def freeze(self, conversation, run, payload, mutating=False):
        if not isinstance(payload, dict) or set(payload) != {'name', 'arguments', 'toolHash', 'readOnly'} or not isinstance(payload.get('arguments'), dict) or not isinstance(payload.get('toolHash'), str) or not re.fullmatch('[a-f0-9]{64}', payload['toolHash']):
            fail(400, 'Supply the exact MCP tool identity and arguments.', 'MCP_ARGUMENTS_INVALID')
        tool = next((tool for tool in self.tools(conversation, run) if tool['name'] == payload['name']), None)
        if not tool or tool.get('toolHash') != payload['toolHash'] or type(payload.get('readOnly')) is not bool or tool.get('readOnly') is not payload['readOnly']:
            fail(409, 'The MCP tool changed or is not permitted by this task and skill.', 'MCP_TOOL_CHANGED')
        if not mutating and tool['readOnly'] is not True: fail(403, 'This MCP tool requires a reviewed action.', 'AI_PERMISSION_DENIED')
        bridge('validate', payload)
        return copy.deepcopy(payload)

    def read(self, conversation, run, payload):
        data = {key: payload[key] for key in ('name', 'arguments', 'toolHash', 'readOnly') if key in payload}
        return clean(bridge('call', self.freeze(conversation, run, data)))

    def validate_action(self, owner, conversation, data):
        # Re-resolve the frozen run and current catalogue before both prepare and execute.
        run = self.ai.row(owner, 'AI_RUN', conversation.get('activeRunId', ''))
        self.freeze(conversation, run, data, mutating=True)

    def perform(self, owner, conversation, action, data):
        run = self.ai.row(owner, 'AI_RUN', action['runId'])
        result = clean(bridge('call', self.freeze(conversation, run, data, mutating=True)))
        if result.get('isError') is True: fail(422, 'The local MCP server reported a tool failure. Inspect its state before preparing another action.', 'MCP_TOOL_FAILED')
        return result
