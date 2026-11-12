"""Scoped evidence windows and approved scientific mutations, without live solvers/providers."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from backend.local_api.domain.ai_readers import AiReaders, grep_matcher, summary
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.ai_skills import catalogue, selected_skill
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.project_workflow import ProjectWorkflowApi
from backend.local_api.domain.research_documents import ResearchDocuments
from backend.local_api.services import LocalServices


class LocalAiDomainTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.owner = self.services.owner
        self.api = PhyniteApi(self.services)
        self.ai = AiWorkspace(self.api)
        self.readers = AiReaders(self.ai)
        self.workflow = ProjectWorkflowApi(self.api)
        self.project = body(self.api.create_project(self.owner, {'name': 'Domain fixture'}))['project']['id']
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_domain', {'projectKey': 'project:' + self.project, 'mode': 'approval', 'activeRunId': 'air_domain', 'title': 'Domain inspection'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_domain', {'conversationId': self.conversation['id'], 'status': 'running', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('fixture'), 'taskMode': 'work', 'modelId': 'fixture-model'})

    def put_bytes(self, key, raw):
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=raw)

    def job(self, kind='calculation', identifier='calc', paths=None, **extra):
        entity = {'calculation': 'CALCULATION', 'simulation': 'MD_SIMULATION', 'analysis': 'MD_ANALYSIS'}[kind]
        item = self.ai.put(self.owner, entity, identifier, {'projectId': self.project, 'name': 'Job fixture', 'structureId': 'structure', 'status': 'FAILED', 'outputPrefix': 'fixture/' + identifier, 'calculationType': 'Total energy', **extra})
        files = paths or {'logs/scf.out': b'Header\nconvergence achieved\nJOB DONE.\n'}
        manifest = {'calculationId': identifier, 'kind': 'md-simulation' if kind == 'simulation' else 'dft', 'status': 'failed', 'artifacts': []}
        for path, raw in files.items():
            self.put_bytes(item['outputPrefix'] + '/' + path, raw)
            manifest['artifacts'].append({'path': path, 'sha256': hashlib.sha256(raw).hexdigest(), 'sizeBytes': len(raw), 'contentType': 'text/plain', 'role': 'log', 'objectKey': 'must-never-be-returned', 'viewUrl': 'https://private.invalid'})
        self.put_bytes(item['outputPrefix'] + '/result.json', json.dumps(manifest).encode())
        return item, manifest

    def request(self, operation, payload):
        return body(self.ai.handle(self.owner, 'POST', '/v1/ai/conversations/aic_domain/' + operation,
                                   {**payload, 'runId': self.run['id'], 'lease': 'fixture'}, {}))

    def prepare(self, kind, data, **extra):
        run = self.ai.row(self.owner, 'AI_RUN', self.run['id'])
        return self.ai.prepare(self.owner, self.conversation, run, {'kind': kind, 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'payload': data, **extra})

    def test_scoped_input_and_log_windows_with_exact_lines_and_no_storage_links(self):
        item, _ = self.job(paths={'logs/scf.out': '\n'.join(f'line {i}' for i in range(1, 401)).encode()})
        self.services.update_item(self.owner, 'CALCULATION', item['id'], {'inputKey': 'fixture/input.json'})
        self.put_bytes('fixture/input.json', json.dumps({'qeInput': 'exact input', 'inputFiles': {'scf.in': '&CONTROL\n/\n'}}).encode())
        payload = {'resourceKind': 'calculation', 'resourceId': item['id']}
        inventory = self.request('job_artifacts', payload)
        self.assertTrue(any(file['path'] == 'input/scf.in' for file in inventory['files']))
        self.assertNotRegex(json.dumps(inventory), 'objectKey|viewUrl|downloadUrl|fixture/|private.invalid')
        head = self.request('job_file', {**payload, 'path': 'logs/scf.out', 'mode': 'head', 'lineCount': 2})
        self.assertEqual(head['lines'], ['line 1', 'line 2'])
        self.assertEqual(head['nextLine'], 3)
        page = self.request('job_file', {**payload, 'path': 'logs/scf.out', 'mode': 'lines', 'startLine': head['nextLine'], 'lineCount': 2})
        self.assertEqual(page['lineNumbers'], [3, 4])
        tail = self.request('job_file', {**payload, 'path': 'logs/scf.out', 'mode': 'tail', 'lineCount': 2})
        self.assertEqual(tail['lines'], ['line 399', 'line 400'])
        self.assertIsNone(tail['nextLine'])
        with self.assertRaises(ApiError):
            self.ai.handle(self.owner, 'POST', '/v1/ai/conversations/aic_domain/job_file', {**payload, 'path': 'logs/scf.out', 'mode': 'head', 'runId': self.run['id'], 'lease': 'wrong'}, {})

    def test_grep_is_bounded_paged_and_rejects_backtracking_syntax(self):
        item, _ = self.job(paths={'logs/scf.out': b'noise\nERROR first\ncontext\nmore\nERROR second\nend\n'})
        result = self.request('job_file', {'resourceKind': 'calculation', 'resourceId': item['id'], 'path': 'logs/scf.out', 'mode': 'grep', 'pattern': '^error.*second$', 'caseInsensitive': True})
        self.assertEqual(result['matches'], [{'line': 5, 'text': 'ERROR second'}])
        self.assertIn('context', result['lines'])
        self.assertFalse(grep_matcher('^foo$', False)('foofoo'))
        self.assertTrue(grep_matcher('^foo.*bar$', False)('foo bar bar'))
        for pattern in ['(a+)+$', '[ab]', 'x{99}', 'x?', 'a|' * 10, 'a' * 121]:
            with self.subTest(pattern=pattern), self.assertRaises(ApiError):
                grep_matcher(pattern, False)
        self.assertEqual(summary([[-1, None], [2, 3], [None, 5]]), {'pointCount': 3, 'finitePointCount': 1, 'gapPointCount': 2, 'minX': -1, 'maxX': 2, 'minY': 3, 'maxY': 5})

    def test_large_and_binary_logs_checksum_and_paths_fail_closed(self):
        item, _ = self.job(paths={'logs/scf.out': ('Δ' * 100 + '\n') .encode() * 400, 'raw.bin': b'\0\x01'})
        payload = {'resourceKind': 'calculation', 'resourceId': item['id'], 'mode': 'head'}
        result = self.request('job_file', {**payload, 'path': 'logs/scf.out', 'lineCount': 200})
        self.assertLess(len(json.dumps(result).encode()), 16000)
        self.assertTrue(result['truncated'])
        for path in ['../scf.out', '/etc/passwd', 'logs//scf.out', 'logs/./scf.out', 'missing.out', 'raw.bin']:
            with self.subTest(path=path), self.assertRaises(ApiError):
                self.request('job_file', {**payload, 'path': path})
        self.put_bytes(item['outputPrefix'] + '/logs/scf.out', b'tampered')
        with self.assertRaisesRegex(ApiError, 'checksum'):
            self.request('job_file', {**payload, 'path': 'logs/scf.out'})

    def test_log_credentials_are_redacted_and_manifest_paths_are_validated(self):
        item, manifest = self.job(paths={'logs/scf.out': b'api_key=fixture-only Bearer fixture-auth\n'})
        result = self.request('job_file', {'resourceKind': 'calculation', 'resourceId': item['id'], 'path': 'logs/scf.out', 'mode': 'head'})
        self.assertNotIn('fixture-only', json.dumps(result))
        self.assertNotIn('fixture-auth', json.dumps(result))
        for value in ['../private', '/absolute', 'logs/../../private']:
            manifest['artifacts'][0]['path'] = value
            self.put_bytes(item['outputPrefix'] + '/result.json', json.dumps(manifest).encode())
            with self.assertRaises(ApiError):
                self.request('job_artifacts', {'resourceKind': 'calculation', 'resourceId': item['id']})

    def test_manifest_pagination_changes_and_cross_project_or_owner_reads(self):
        item, manifest = self.job(paths={f'logs/{i}.out': b'data' for i in range(45)})
        payload = {'resourceKind': 'calculation', 'resourceId': item['id']}
        first = self.request('job_artifacts', payload)
        second = self.request('job_artifacts', {**payload, 'cursor': first['nextCursor']})
        self.assertEqual(len(first['files']), 20)
        self.assertEqual(len(second['files']), 20)
        self.assertFalse(set(file['path'] for file in first['files']) & set(file['path'] for file in second['files']))
        manifest['artifacts'][0]['sha256'] = 'a' * 64
        self.put_bytes(item['outputPrefix'] + '/result.json', json.dumps(manifest).encode())
        with self.assertRaises(ApiError):
            self.request('job_artifacts', {**payload, 'cursor': first['nextCursor']})
        self.services.update_item(self.owner, 'CALCULATION', item['id'], {'projectId': 'other'})
        with self.assertRaises(ApiError):
            self.request('job_artifacts', payload)
        with self.assertRaises(ApiError):
            self.readers.artifacts('another-owner', self.conversation, payload)

    def test_md_simulation_uses_its_real_manifest_and_on_demand_status(self):
        item, _ = self.job(kind='simulation', identifier='sim', paths={'log.lammps': b'ERROR lost atoms\n'})
        result = self.request('job_file', {'resourceKind': 'simulation', 'resourceId': item['id'], 'path': 'log.lammps', 'mode': 'tail'})
        self.assertEqual(result['lines'], ['ERROR lost atoms'])
        self.services.update_item(self.owner, 'MD_SIMULATION', item['id'], {'status': 'RUNNING'})
        self.assertEqual(self.request('jobs', {'kind': 'all'})['totalActiveJobs'], 1)
        self.assertEqual(self.request('job_status', {'kind': 'simulation', 'id': item['id']})['status'], 'RUNNING')
        self.assertNotRegex(json.dumps(self.request('worker_status', {})), 'tokenHash|privateKeyPath|outputPrefix')

    def dataset(self):
        text = 'source header in original units\n' + 'x' * 3_600_000
        points = [[i / 10, (10000 if i == 3456 else -9999 if i == 1234 else i % 50)] for i in range(10000)]
        document = {'schemaVersion': 1, 'id': 'dataset', 'projectId': self.project, 'name': 'Large dataset', 'createdAt': '2026-11-12T00:00:00Z', 'updatedAt': '2026-11-12T00:00:00Z',
                    'source': {'filename': 'observed.csv', 'parserVersion': 'fixture', 'sha256': hashlib.sha256(text.encode()).hexdigest(), 'text': text},
                    'metadata': {'energy': {'kind': 'fermi', 'fermiEv': 3.2, 'vbmEv': 2.1, 'vacuumEv': 5.7}, 'atomCount': 2, 'formulaUnits': 1, 'volumeAngstrom3': 50, 'dosBasis': 'cell', 'condition': {'parameter': 'T', 'unit': 'K', 'value': 300}},
                    'data': {'kind': 'generic', 'title': 'Observed response', 'xLabel': 'Time (ps)', 'quantities': [{'id': 'q', 'label': 'Energy', 'yLabel': 'Energy (eV)', 'series': [{'id': 's', 'label': 'exact source', 'points': points}]}]}}
        self.assertGreater(len(json.dumps(document).encode()), 3_700_000)
        ResearchDocuments(self.services).handle(self.owner, 'PUT', 'datasets', document['id'], {}, {'document': document, 'baseRevision': 0})
        return document

    def test_dataset_near_four_megabytes_is_sampled_with_exact_metadata_extrema_and_indices(self):
        document = self.dataset()
        result = self.request('dataset_query', {'datasetId': document['id'], 'maxPoints': 128, 'includeSourceHeader': True})
        self.assertLess(len(json.dumps(result).encode()), 16000)
        self.assertEqual(result['metadata'], document['metadata'])
        self.assertEqual(result['source']['sha256'], document['source']['sha256'])
        series = result['series'][0]
        self.assertLessEqual(len(series['points']), 128)
        self.assertEqual(series['summary']['maxY'], 10000)
        self.assertEqual(series['summary']['minY'], -9999)
        self.assertIn(3456, series['indices'])
        self.assertIn(1234, series['indices'])
        for index, point in zip(series['indices'], series['points']):
            self.assertEqual(point, document['data']['quantities'][0]['series'][0]['points'][index])
        window = self.request('dataset_query', {'datasetId': document['id'], 'seriesIds': ['q/s'], 'xMin': 300, 'xMax': 350})
        self.assertEqual(window['series'][0]['window']['pointCount'], 501)
        self.assertTrue(all(300 <= point[0] <= 350 for point in window['series'][0]['points']))
        for payload in [{'seriesIds': ['unknown']}, {'xMin': 5, 'xMax': 1}, {'maxPoints': True}, {'xMin': float('nan')}]:
            with self.subTest(payload=payload), self.assertRaises(ApiError):
                self.readers.dataset(self.owner, self.conversation, {'datasetId': document['id'], **payload})
        self.services.update_item(self.owner, 'DATASET', document['id'], {'projectId': 'other'})
        with self.assertRaises(ApiError):
            self.request('dataset_query', {'datasetId': document['id']})

    def saved_structure(self, count=1):
        document = {'name': 'Si', 'formula': 'Si', 'atoms': [{'id': f'Si{i}', 'species': 'Si', 'x': i / count, 'y': 0, 'z': 0} for i in range(count)], 'lattice': {'a': 5, 'b': 5, 'c': 5, 'alpha': 90, 'beta': 90, 'gamma': 90, 'periodic': [True, True, True]}}
        node = {'id': 'crystal', 'name': 'Si', 'kind': 'structure', 'position': {'x': 0, 'y': 0}, 'configuration': {'structure': document}, 'resources': []}
        graph = self.workflow.load(self.owner, self.project)['workflow']
        graph['nodes'].append(node)
        self.workflow.save(self.owner, self.project, {'workflow': graph, 'baseRevision': 0})
        return copy.deepcopy(self.workflow.load(self.owner, self.project)['workflow']['nodes'][0]['configuration']['structure'])

    def modify_payload(self):
        return {'target': {'kind': 'canvas_node', 'nodeId': 'crystal', 'baseRevision': 1}, 'name': 'Si variant', 'modifiers': [{'id': 'rep', 'enabled': True, 'kind': 'replicate', 'repeat': [2, 1, 1]}]}

    def test_canvas_modification_is_server_compiled_reviewed_and_revision_fenced(self):
        original = self.saved_structure()
        action = self.prepare('modify_structure', self.modify_payload())
        self.assertEqual(action['after']['structure']['atomCount'], 2)
        self.assertEqual(self.workflow.load(self.owner, self.project)['workflow']['nodes'][0]['configuration']['structure'], original)
        with self.assertRaises(ApiError):
            self.ai.execute(self.owner, self.conversation, action, 'wrong-hash')
        result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'succeeded', result)
        saved = self.workflow.load(self.owner, self.project)
        self.assertEqual(saved['revision'], 2)
        modified = saved['workflow']['nodes'][0]['configuration']['structure']
        self.assertEqual(len(modified['atoms']), 2)
        self.assertEqual(modified['parentStructureSha256'], digest(original))
        self.assertEqual(len(self.services.list_owner_items(self.owner, 'STRUCTURE')), 2)
        parent = self.ai.resource(self.owner, self.conversation, 'structure', result['result']['parentStructureId'])['document']
        self.assertEqual(parent['atoms'], original['atoms'])

    def test_modification_rejects_atom_overflow_forged_results_and_changed_revision(self):
        self.saved_structure(801)
        with self.assertRaisesRegex(ApiError, '1,600|1600'):
            self.prepare('modify_structure', self.modify_payload())
        data = self.modify_payload()
        data['result'] = {'atoms': []}
        with self.assertRaises(ApiError):
            self.prepare('modify_structure', data)
        data.pop('result')
        data['modifiers'] = [{'id': 'wrap', 'enabled': True, 'kind': 'wrap'}]
        action = self.prepare('modify_structure', data)
        envelope = self.workflow.load(self.owner, self.project)
        self.workflow.save(self.owner, self.project, {'workflow': envelope['workflow'], 'baseRevision': envelope['revision']})
        self.assertEqual(self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])['status'], 'expired')
        self.assertFalse(self.services.list_owner_items(self.owner, 'STRUCTURE'))

    def test_shared_modifier_compiler_works_without_es2022_object_helpers(self):
        import quickjs
        from backend.local_api.domain.workflow_compiler import compiler_source
        context = quickjs.Context()
        context.eval('globalThis.structuredClone = value => JSON.parse(JSON.stringify(value)); delete Object.hasOwn;')
        context.eval(compiler_source())
        context.set('sourceJson', json.dumps(self.saved_structure()))
        result = json.loads(context.eval('JSON.stringify(PhyniteWorkflowCompiler.modifyAiStructure(JSON.parse(sourceJson), [{id:"wrap", enabled:true, kind:"wrap"}]))'))
        self.assertEqual(len(result['atoms']), 1)

    def test_legacy_modification_creates_a_variant_and_preserves_the_original(self):
        original = self.saved_structure()
        snapshot = {'version': 1, 'projects': [{'id': 'legacy', 'name': 'Legacy'}], 'materials': [{**original, 'id': 'material', 'projectId': 'legacy', 'remoteId': 'old'}], 'jobs': []}
        self.api.put_workspace(self.owner, {'workspace': snapshot, 'baseRevision': 0})
        self.conversation = self.ai.update(self.owner, 'AI_CONVERSATION', self.conversation, {'projectKey': 'dft:legacy'})
        payload = self.modify_payload()
        payload['target'] = {'kind': 'material', 'materialId': 'material'}
        action = self.prepare('modify_structure', payload)
        result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'succeeded', result)
        materials = self.ai.workspace(self.owner)['workspace']['materials']
        self.assertEqual(materials[0], snapshot['materials'][0])
        self.assertEqual(len(materials[1]['atoms']), 2)
        self.assertNotIn('remoteId', materials[1])

    def test_canvas_failure_rolls_back_both_source_retention_and_new_resource(self):
        original = self.saved_structure()
        action = self.prepare('modify_structure', self.modify_payload())
        with patch.object(ProjectWorkflowApi, 'save', side_effect=ApiError(409, 'Concurrent edit', 'AI_CONTEXT_CHANGED')):
            result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(self.services.list_owner_items(self.owner, 'STRUCTURE'))
        self.assertEqual(self.workflow.load(self.owner, self.project)['workflow']['nodes'][0]['configuration']['structure'], original)

    @staticmethod
    def potential_fixture(*args):
        return ({'title': 'Published Si model', 'family': 'tersoff', 'elements': ['Si'], 'citation': 'Fixture citation', 'license': 'Fixture license', 'modelVersion': 'fixture-v1', 'validityDomain': 'Unassessed fixture'}, [('Si.tersoff', b'fixture potential bytes\n')], {'provider': 'nist', 'sourceUrl': 'https://www.ctcms.nist.gov/potentials/entry/fixture', 'modelVersion': 'fixture-v1'})

    def test_potential_import_stages_only_then_approves_exact_bytes_and_replays(self):
        with patch('backend.local_api.domain.potential_catalog.ingest_files', side_effect=self.potential_fixture) as ingest:
            action = self.prepare('import_md_potential', {'provider': 'nist', 'identifier': 'fixture-model', 'elements': ['Si']}, toolCallId='potential_import')
            self.assertEqual(action['status'], 'pending')
            self.assertFalse(self.services.list_owner_items(self.owner, 'MD_POTENTIAL'))
            self.assertEqual(action['after']['potential']['files'][0]['sha256'], hashlib.sha256(b'fixture potential bytes\n').hexdigest())
            self.assertNotRegex(json.dumps(self.ai.public_action(action)), 'objectKey|stagedFiles|payloadKey')
            result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
            self.assertEqual(result['status'], 'succeeded', result)
            self.assertEqual(result['result']['potential']['status'], 'READY')
            replay = self.ai.execute(self.owner, self.conversation, result, action['payloadHash'])
            self.assertEqual(replay['id'], action['id'])
            self.assertEqual(ingest.call_count, 1)
            self.assertEqual(len(self.services.list_owner_items(self.owner, 'MD_POTENTIAL')), 1)

    def test_potential_staged_checksum_and_permission_fences_prevent_attachment(self):
        with patch('backend.local_api.domain.potential_catalog.ingest_files', side_effect=self.potential_fixture) as ingest:
            for mode in ['chat']:
                with self.assertRaises(ApiError):
                    self.ai.prepare(self.owner, {**self.conversation, 'mode': mode}, self.run, {'kind': 'import_md_potential', 'payload': {'provider': 'nist', 'identifier': 'fixture', 'elements': ['Si']}})
            for task_mode in ['plan', 'research', 'summary']:
                with self.assertRaises(ApiError):
                    self.ai.prepare(self.owner, self.conversation, {**self.run, 'taskMode': task_mode}, {'kind': 'import_md_potential', 'payload': {}})
            self.assertEqual(ingest.call_count, 0)
            action = self.prepare('import_md_potential', {'provider': 'nist', 'identifier': 'fixture', 'elements': ['Si']})
            data = self.ai.action_payload(action)
            self.put_bytes(data['stagedFiles'][0]['objectKey'], b'corrupt')
            with self.assertRaisesRegex(ApiError, 'checksum'):
                self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
            self.assertFalse(self.services.list_owner_items(self.owner, 'MD_POTENTIAL'))

    def test_potential_completion_failure_leaves_no_attached_asset(self):
        with patch('backend.local_api.domain.potential_catalog.ingest_files', side_effect=self.potential_fixture):
            action = self.prepare('import_md_potential', {'provider': 'nist', 'identifier': 'fixture', 'elements': ['Si']})
        with patch.object(self.api, 'complete_md_potential', side_effect=ApiError(409, 'Checksum mismatch', 'MD_POTENTIAL_MISMATCH')):
            result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(self.services.list_owner_items(self.owner, 'MD_POTENTIAL'))

    def test_readonly_md_preview_rejects_dangerous_commands_and_unscoped_potentials(self):
        workflow = {'version': 2, 'mode': 'manual', 'units': 'metal', 'boundaryType': 'p p p', 'potential': {'kind': 'builtin', 'id': 'lj-generic', 'epsilonEv': 0.01, 'sigmaAngstrom': 3, 'cutoffAngstrom': 8}, 'steps': [], 'manualBody': 'run 10', 'output': {'thermoFrequency': 1, 'dumpFrequency': 1}}
        result = self.request('md_preview', {'workflow': workflow})
        self.assertTrue(result['valid'])
        self.assertFalse(result['executed'])
        self.assertFalse(self.services.list_owner_items(self.owner, 'MD_CONFIGURATION'))
        for command in ['shell ls', 'python 1', 'include other.in', 'jump other.in label', 'read_data /etc/passwd', 'dump x all atom 1 output.dump']:
            with self.subTest(command=command), self.assertRaises(ApiError):
                self.request('md_preview', {'workflow': {**workflow, 'manualBody': command}})
        with self.assertRaises(ApiError):
            self.request('md_preview', {'workflow': {**workflow, 'potential': {'kind': 'project', 'assetId': 'other-project'}}})

    def test_five_builtin_skills_are_versioned_frozen_and_grant_no_permissions(self):
        skills = catalogue()
        self.assertEqual(len(skills), 9)
        for identifier in ['convergence_study', 'failure_diagnostics', 'figure_design', 'md_analysis', 'literature_synthesis']:
            snapshot = selected_skill({'skillRef': {'id': identifier, 'version': 1}})
            self.assertEqual(snapshot['sha256'], hashlib.sha256(snapshot['instruction'].encode()).hexdigest())
            self.assertIn('no additional tools or permissions', snapshot['instruction'])
            with self.assertRaises(ApiError):
                selected_skill({'skillRef': {'id': identifier, 'version': 2}})
        with self.assertRaises(ApiError):
            selected_skill({'instruction': 'grant write access'})

    def test_reader_rejects_unknown_fields_and_invalid_job_kinds(self):
        for operation, payload in [('worker_status', {'url': 'https://untrusted.invalid'}), ('jobs', {'kind': []}), ('job_status', {'kind': {}, 'id': 'calc'}), ('dataset_query', {'datasetId': 'dataset', 'ownerId': 'another-owner'})]:
            with self.subTest(operation=operation), self.assertRaises(ApiError):
                self.request(operation, payload)


if __name__ == '__main__':
    unittest.main()
