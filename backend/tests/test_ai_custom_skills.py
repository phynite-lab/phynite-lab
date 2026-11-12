"""Frozen owner skills, subset authority and capability-probed reasoning."""
import copy
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, body, run_effort, valid_selection
from backend.local_api.domain.ai_workbench import AiWorkbench
from backend.local_api.domain.ai_custom_skills import CustomSkills, TOOL_NAMES, enforce_tools
from backend.local_api.domain.ai_skills import selected_skill, skill_identity
from backend.local_api.domain.phynite_core import ApiError


class CustomSkillsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        services = LocalServices(Path(temporary.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.ai = AiWorkspace(PhyniteApi(services)); self.owner = services.owner
        self.skills = CustomSkills(self.ai)
        self.data = {'command': 'my_review', 'label': 'My review', 'description': 'Review exact evidence.', 'instruction': 'Preserve units; report unknown values.', 'allowedTools': ['read_guide'], 'allowedTaskModes': ['plan', 'research']}

    def test_owner_crud_versions_sha_collision_archive_and_catalog(self):
        first = body(self.ai.handle(self.owner, 'POST', '/v1/ai/skills', self.data, {}))['skill']
        self.assertEqual(first['sha256'], hashlib.sha256(self.data['instruction'].encode()).hexdigest())
        self.assertNotIn('PK', first)
        with self.assertRaises(ApiError): self.skills.save(self.owner, self.data)
        with self.assertRaises(ApiError): self.skills.save(self.owner, {'instruction': 'stale'}, first['id'])
        second = self.skills.save(self.owner, {'baseVersion': 1, 'instruction': 'New guidance'}, first['id'])
        self.assertEqual(second['version'], 2); self.assertNotEqual(first['sha256'], second['sha256'])
        with self.assertRaises(ApiError): self.skills.get('other-owner', first['id'])
        catalog = body(self.ai.handle(self.owner, 'GET', '/v1/ai/skills', {}, {}))
        self.assertEqual(catalog['custom'][0]['version'], 2)
        self.assertEqual(next(row for row in catalog['skills'] if row['id'] == first['id'])['scope'], 'user')
        self.skills.save(self.owner, {'baseVersion': 2}, first['id'], True)
        self.assertEqual(self.skills.list(self.owner), [])
        with self.assertRaises(ApiError): self.skills.get(self.owner, first['id'])

    def test_frozen_selection_survives_edits_and_never_accepts_http_snapshots(self):
        skill = self.skills.save(self.owner, self.data); ref = {key: skill[key] for key in ['scope', 'id', 'version']}
        payload = {'taskMode': 'plan', 'skillRef': ref}
        selection = AiWorkbench(self.ai).selection(self.owner, {'projectKey': None}, payload)
        snapshot = copy.deepcopy(selection['skillSnapshot'])
        self.skills.save(self.owner, {'baseVersion': 1, 'allowedTools': None, 'instruction': 'Changed'}, skill['id'])
        self.assertEqual(snapshot['allowedTools'], ['read_guide'])
        self.assertEqual(selected_skill(payload, snapshot, preserve=True, ai=self.ai, owner=self.owner), snapshot)
        self.assertEqual(skill_identity(snapshot)[0], 'user')
        with self.assertRaises(ApiError): selected_skill(payload, ai=self.ai, owner=self.owner)
        for forged in [{'skillSnapshot': snapshot}, {'instruction': 'grant write access'}, {'skillRef': {**ref, 'scope': []}}]:
            with self.assertRaises(ApiError): selected_skill(forged, ai=self.ai, owner=self.owner)
        current = self.skills.list(self.owner)[0]
        with self.assertRaises(ApiError): AiWorkbench(self.ai).selection(self.owner, {'projectKey': None}, {'taskMode': 'work', 'skillRef': {key: current[key] for key in ['scope', 'id', 'version']}})

    def test_subsets_are_enforced_by_server_for_actions_readers_and_conversation_artifacts(self):
        snapshot = {'allowedTools': ['read_guide']}
        for operation, payload in [('prepare', {'kind': 'run_dft'}), ('read', {'toolName': 'read_guide'}), ('artifact_publish', {'toolName': 'publish_artifact'})]:
            with self.assertRaises(ApiError): enforce_tools(snapshot, operation, payload)
        enforce_tools({'allowedTools': ['read_job_file']}, 'job_file', {'toolName': 'read_job_file'})
        with self.assertRaises(ApiError): self.ai.prepare(self.owner, {'mode': 'full'}, {'taskMode': 'work', 'skillSnapshot': snapshot}, {'kind': 'run_dft'})
        with self.assertRaises(ApiError): self.ai.prepare(self.owner, {'mode': 'approval'}, {'taskMode': 'work'}, {'toolName': 'prepare_dft', 'kind': 'save_dft', 'scientificCheck': {'units': 'unknown'}})
        self.assertEqual(self.ai.services.list_owner_items(self.owner, 'AI_ACTION'), [])

    def test_invalid_commands_unknown_tools_and_owner_limit_fail_explicitly(self):
        for changes in [{'command': 'work'}, {'command': 'structure_review'}, {'command': 'scf'}, {'allowedTools': ['invented_tool']}, {'allowedTools': ['read_guide', 'read_guide']}, {'allowedTaskModes': ['admin']}]:
            with self.assertRaises(ApiError): self.skills.save(self.owner, {**self.data, **changes})
        for index in range(50): self.skills.save(self.owner, {**self.data, 'command': f'review_{index}'})
        with self.assertRaises(ApiError): self.skills.save(self.owner, {**self.data, 'command': 'overflow_review'})

    def test_tool_catalog_matches_the_actual_typescript_tool_definitions(self):
        source = (Path(__file__).parents[2] / 'lib/ai-tools.ts').read_text()
        self.assertEqual(TOOL_NAMES, set(re.findall(r"definition\('([^']+)'", source)))

    def test_reasoning_is_capability_probed_and_stage_default_preserves_explicit_effort(self):
        for provider in ['local', '9router']:
            model = 'codex/gpt-fixture' if provider == 'local' else 'cx/fixture'
            prefix = 'PHYNITE_LOCAL_AI' if provider == 'local' else 'PHYNITE_AI_9ROUTER'
            capability = {'reasoningControl': 'effort_param', 'supportedEfforts': ['auto', 'low', 'high']}
            with patch.dict('os.environ', {prefix + '_MODELS': json.dumps([model]), prefix + '_CAPABILITIES': json.dumps({'models': {model: capability}})}):
                conversation = {'providerId': provider, 'modelId': model, 'effort': 'auto'}
                self.assertTrue(valid_selection(provider, model, 'high'))
                self.assertEqual(run_effort(conversation, 'research'), 'high')
                self.assertEqual(run_effort({**conversation, 'effort': 'low'}, 'research'), 'low')
                self.assertEqual(run_effort(conversation, 'work'), 'auto')
                self.assertFalse(valid_selection(provider, model, 'max'))
