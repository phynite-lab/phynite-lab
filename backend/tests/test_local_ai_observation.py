"""Model evidence stays bounded, parseable and tied to the complete local source."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.local_api.domain.ai_observation import compact_observation
from backend.local_api.domain.ai_workbench import AiWorkbench
from backend.local_api.domain.ai_workspace import AiWorkspace, bounded, clean, digest
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.services import LocalServices


class LocalAiObservationTests(unittest.TestCase):
    def test_priority_fields_survive_large_logs_and_arrays_without_mutating_sources(self):
        value = {
            'log': 'SCF iteration ΔE = -0.001 Ry\n' * 12000,
            'points': [[index, -index / 1000] for index in range(4000)],
            'metadata': {'energy': {'kind': 'fermi', 'fermiEv': 5.4321}, 'unit': 'eV'},
            'error': 'Electronic convergence was not reached.', 'code': 'QE_NOT_CONVERGED', 'status': 'failed',
            'id': 'calc_fixture', 'name': 'Si SCF', 'sha256': 'a' * 64, 'revision': 7,
            'warnings': ['Read the final SCF residual.'], 'issues': ['Energy is not accepted.'],
            'nextLine': 201, 'nextOffset': 3, 'nextCursor': 'cursor-fixture',
            'objectKey': 'private-storage-location', 'workerToken': 'fixture-credential',
        }
        original = copy.deepcopy(value)
        for maximum in (2000, 24000):
            result = bounded(value, maximum)
            encoded = json.dumps(result)
            self.assertLessEqual(len(encoded.encode()), maximum)
            self.assertEqual(json.loads(encoded), result)
            for key in ('error', 'code', 'status', 'id', 'name', 'sha256', 'revision', 'warnings',
                        'issues', 'nextLine', 'nextOffset', 'nextCursor', 'metadata'):
                self.assertEqual(result[key], value[key], key)
            self.assertTrue(result['truncated'])
            self.assertTrue(result['points']['_compacted'])
            self.assertEqual(result['points']['totalItems'], 4000)
            self.assertEqual(result['points']['sampleHead'][0], value['points'][0])
            self.assertEqual(result['points']['sampleTail'][-1], value['points'][-1])
            self.assertRegex(result['log'], r'…\[truncated \d+ chars\]$')
            self.assertNotIn('private-storage-location', encoded)
            self.assertNotIn('fixture-credential', encoded)
            self.assertNotIn('excerpt', result)
        self.assertEqual(value, original)
        small = {'status': 'succeeded', 'value': 0, 'optional': None}
        self.assertEqual(bounded(small), small)

    def test_unicode_escaping_nested_arrays_and_omitted_fields_respect_byte_limits(self):
        text = 'Si "\\\n\t ΔE 🧪 & <source> ' * 1000
        fields = {**{'field_' + str(index): text for index in range(256)}, 'status': 'failed',
                  'error': 'Inspect the input.', 'sha256': 'b' * 64, 'nextLine': 0}
        for maximum in (128, 512, 2000):
            for value in (text, [text, text, text], {'nested': {'rows': [text, text]}}, fields):
                encoded = json.dumps(bounded(value, maximum))
                self.assertLessEqual(len(encoded.encode()), maximum)
                json.loads(encoded)
        result = bounded(fields, 2000)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['nextLine'], 0)
        self.assertEqual(result['sha256'], 'b' * 64)
        self.assertGreater(result['_omittedFields'], 0)
        for maximum in (127, 2000.5, True):
            with self.assertRaises(ValueError):
                compact_observation(fields, maximum)

    def test_sanitization_precedes_compaction_even_for_small_observations(self):
        value = {'status': 'failed', 'inputTokens': 12, 'outputTokens': 0, 'leaseHash': 'private-lease',
                 'metadata': {'objectKey': 'private-key', 'password': 'private-password'},
                 'log': 'Bearer fixture-private-value'}
        result = bounded(value)
        self.assertEqual(result, {'status': 'failed', 'inputTokens': 12, 'outputTokens': 0,
                                  'metadata': {}, 'log': '[redacted]'})


class LocalAiContextCompactionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.ai = AiWorkspace(PhyniteApi(self.services))
        self.workbench = AiWorkbench(self.ai)
        self.owner = self.services.owner
        project = json.loads(self.ai.api.create_project(self.owner, {'name': 'Compaction fixture'})['body'])['project']['id']
        self.conversation = {'id': 'aic_compaction', 'projectKey': 'project:' + project}
        self.node = {'id': 'scf', 'kind': 'qe_scf', 'name': 'Si SCF', 'status': 'failed',
                     'error': 'Electronic convergence was not reached.', 'nextLine': 201, 'sha256': 'a' * 64,
                     'configuration': {'draft': {'cutoff': 80, 'chargeDensityCutoff': 640},
                                       'log': 'ΔE = -0.001 Ry\n' * 12000,
                                       'points': [[index, index / 1000] for index in range(4000)],
                                       'objectKey': 'private-storage-location'}}
        self.graph = {'workflow': {'nodes': [self.node], 'edges': []}, 'revision': 7}

    def test_context_retains_scientific_fields_and_the_full_sanitized_source_checksum(self):
        original = copy.deepcopy(self.node)
        ref = {'kind': 'node', 'id': 'scf', 'revision': 7}
        with patch.object(self.workbench, 'graph', return_value=self.graph):
            source, = self.workbench.resolve(self.owner, self.conversation, [ref])
        self.assertEqual(source['sha256'], digest(clean(self.node)))
        self.assertEqual(source['ref'], ref)
        value = source['value']
        self.assertLessEqual(len(json.dumps(value).encode()), 16000)
        self.assertTrue(value['truncated'])
        self.assertIn('read_resource', value['note'])
        self.assertEqual(value['data']['sha256'], self.node['sha256'])
        self.assertEqual(value['data']['status'], 'failed')
        self.assertEqual(value['data']['error'], self.node['error'])
        self.assertEqual(value['data']['nextLine'], 201)
        self.assertEqual(value['data']['configuration']['draft'], self.node['configuration']['draft'])
        self.assertEqual(value['data']['configuration']['points']['totalItems'], 4000)
        self.assertNotIn('private-storage-location', json.dumps(source))
        self.assertNotIn('excerpt', value)
        self.assertEqual(self.node, original)

    def test_unicode_field_compaction_keeps_per_source_and_total_manifest_guards(self):
        self.node['configuration']['draft']['prefix'] = '🧪ΔE' * 10000
        ref = {'kind': 'field', 'id': 'scf', 'path': ['draft', 'prefix'], 'revision': 7}
        with patch.object(self.workbench, 'graph', return_value=self.graph):
            source, = self.workbench.resolve(self.owner, self.conversation, [ref])
            self.assertLessEqual(len(json.dumps(source['value']).encode()), 16000)
            self.assertEqual(source['sha256'], digest(self.node['configuration']['draft']['prefix']))
            self.assertTrue(source['value']['truncated'])
            with self.assertRaises(ApiError) as error:
                self.workbench.resolve(self.owner, self.conversation, [ref] * 5)
        self.assertEqual(error.exception.code, 'AI_CONTEXT_LIMIT')

    def test_revision_and_resource_owner_guards_still_reject_stale_or_foreign_sources(self):
        with patch.object(self.workbench, 'graph', return_value=self.graph):
            with self.assertRaises(ApiError) as error:
                self.workbench.resolve(self.owner, self.conversation, [{'kind': 'node', 'id': 'scf', 'revision': 6}])
        self.assertEqual(error.exception.code, 'AI_CONTEXT_CHANGED')
        self.ai.put('another-owner', 'STRUCTURE', 'foreign_structure', {'name': 'Foreign source'})
        with self.assertRaises(ApiError) as error:
            self.workbench.resolve(self.owner, self.conversation, [{'kind': 'resource', 'resourceKind': 'structure', 'id': 'foreign_structure'}])
        self.assertEqual(error.exception.status, 404)


if __name__ == '__main__':
    unittest.main()
