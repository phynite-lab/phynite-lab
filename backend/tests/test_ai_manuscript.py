"""Labelled synthetic control-plane fixtures; no new scientific qualification is claimed."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest
from backend.local_api.domain.ai_artifacts import AiArtifacts
from backend.local_api.domain.ai_manuscript import AiManuscripts, explicit_parameters, verify_reference
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.research_documents import ResearchDocuments
from backend.local_api.domain.workflow_compiler import invoke

INPUT = "&CONTROL calculation='scf', title='ecutwfc=999' /\n&SYSTEM ecutwfc=60, ecutrho=480, nat=1 / ! ecutwfc=999\n&ELECTRONS conv_thr=1.d-8, mixing_beta=0.3 /\nK_POINTS automatic\n4 4 4 0 0 0\n"
CSV = 'x,energy_eV\n0,1\n1,2\n'
STAGE = {'stage': 'scf', 'calculationMode': 'scf', 'jobDone': True, 'solverError': False, 'electronicConvergence': 'converged', 'hybridConvergence': 'not-applicable', 'scfAccuracy': {'status': 'verified', 'residualRy': 1e-10, 'residualUpperRy': 1.1e-10, 'thresholdRy': 1e-8, 'source': 'qe-log-bound'}}


class ManuscriptTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.api = PhyniteApi(self.services); self.ai = AiWorkspace(self.api); self.owner = self.services.owner
        self.project = body(self.api.create_project(self.owner, {'name': 'Synthetic manuscript fixture'}))['project']['id']
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_manuscript', {'projectKey': 'project:' + self.project, 'mode': 'chat', 'activeRunId': 'air_manuscript'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_manuscript', {'conversationId': self.conversation['id'], 'status': 'running', 'modelId': 'fixture', 'taskMode': 'research', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('fixture')})
        self.service = AiManuscripts(self.ai)
        self.job = self.ai.put(self.owner, 'CALCULATION', 'calc_manuscript', {'projectId': self.project, 'name': 'Synthetic fixture', 'status': 'COMPLETED', 'calculationType': 'Total energy', 'outputPrefix': 'fixture/result', 'structureId': 'fixture'})
        self.manifest = {'calculationId': self.job['id'], 'calculationType': 'Total energy', 'status': 'completed', 'summary': {'jobDone': True, 'converged': True, 'totalEnergyRy': -12.5, 'stageConvergence': [copy.deepcopy(STAGE)]}, 'provenance': {'qeVersion': 'synthetic fixture only'}, 'artifacts': []}
        for path, role, content in [('inputs/scf.in', 'input', INPUT), ('logs/scf.out', 'log', 'Synthetic fixture: convergence achieved\nJOB DONE.\n'), ('data/energy.csv', 'data', CSV)]:
            raw = content.encode(); self.put('fixture/result/' + path, raw)
            self.manifest['artifacts'].append({'path': path, 'role': role, 'sha256': hashlib.sha256(raw).hexdigest(), 'sizeBytes': len(raw)})
        self.save_manifest()

    def put(self, key, raw): self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=raw)
    def save_manifest(self): self.put('fixture/result/result.json', json.dumps(self.manifest).encode())
    def request(self, **changes):
        return {'runId': self.run['id'], 'lease': 'fixture', 'controlRevision': 0, 'title': 'Synthetic evidence draft', 'calculationIds': [self.job['id']], 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'toolCallId': 'manuscript-fixture', **changes}
    def create(self, **changes): return self.service.create(self.owner, self.conversation, self.run, self.request(**changes))

    def test_immutable_exact_numeric_input_binding_and_idempotent_replay(self):
        artifact = self.create(); data = artifact['structuredData']
        self.assertEqual(artifact['kind'], 'manuscript'); self.assertEqual(artifact['status'], 'draft')
        self.assertEqual(data['quantities'][0]['value'], -12.5); self.assertEqual(data['quantities'][0]['unit'], 'Ry')
        self.assertEqual(data['jobs'][0]['files'][0]['text'], INPUT)
        self.assertEqual([row['valueText'] for row in data['jobs'][0]['parameters']], ['60', '480', '1.d-8', '0.3'])
        self.assertTrue(data['missingInformation']); self.assertEqual(self.create()['id'], artifact['id'])
        with self.assertRaises(ApiError): self.create(title='Changed request')
        self.assertEqual(len(self.services.list_owner_items(self.owner, 'AI_ARTIFACT')), 1)
        self.assertEqual(self.services.list_owner_items(self.owner, 'AI_ACTION'), [])
        original = AiArtifacts(self.ai).get(self.owner, self.conversation, artifact['id'])
        self.assertEqual(original['structuredData']['quantities'][0]['value'], -12.5)

    def test_missing_authors_references_empty_study_and_unknown_provenance_remain_draft(self):
        artifact = self.create(calculationIds=[])
        self.assertEqual(artifact['status'], 'draft'); self.assertEqual(artifact['structuredData']['quantities'], [])
        self.assertTrue(any('No executed' in issue for issue in artifact['structuredData']['missingInformation']))
        with self.assertRaises(ApiError): AiArtifacts(self.ai).publish(self.owner, self.conversation, self.run, {'kind': 'manuscript', 'title': 'Forged', 'status': 'complete', 'structuredData': {}})
        with self.assertRaises(ApiError): AiArtifacts(self.ai).publish(self.owner, self.conversation, self.run, {'artifactId': artifact['id'], 'status': 'complete'}, True)

    def test_failed_unknown_nonfinite_or_unscoped_gap_results_rejected(self):
        for changes in [{'converged': False}, {'totalEnergyRy': float('nan')}, {'bandGapEv': 1.5}, {'bandGapEv': 1.5, 'bandGapScope': 'full-brillouin-zone', 'fullBrillouinZoneGapVerified': False}]:
            with self.subTest(changes=changes):
                previous = copy.deepcopy(self.manifest)
                self.manifest['summary'].update(changes); self.save_manifest()
                with self.assertRaises(ApiError): self.create()
                self.manifest = previous; self.save_manifest()
        self.manifest['summary'].update(bandGapEv=1.5, bandGapScope='sampled-k-path'); self.save_manifest()
        gap = next(q for q in self.create()['structuredData']['quantities'] if q['label'] == 'Band gap')
        self.assertEqual(gap['scope'], 'sampled-k-path')

    def test_source_checksum_paths_size_and_missing_executed_input_fail_closed(self):
        source = self.manifest['artifacts'][0]
        for change in [{'path': '../secret'}, {'sizeBytes': 9_000_000}, {'sha256': 'a'*64}]:
            previous = copy.deepcopy(source); source.update(change); self.save_manifest()
            with self.assertRaises(ApiError): self.create()
            source.clear(); source.update(previous)
        source['role'] = 'data'; self.save_manifest()
        with self.assertRaises(ApiError): self.create()

    def test_owner_project_conversation_scope_and_source_revision_conflict(self):
        with self.assertRaises(ApiError): self.service.create('other-owner', self.conversation, self.run, self.request())
        other = body(self.api.create_project(self.owner, {'name': 'Other'}))['project']['id']
        with self.assertRaises(ApiError): self.service.create(self.owner, {**self.conversation, 'projectKey': 'project:'+other}, self.run, self.request())
        with self.assertRaises(ApiError): self.create(stamp='stale')
        original = self.service.source; changed = False
        def drift(source):
            nonlocal changed
            result = original(source)
            if not changed:
                changed = True; self.ai.update(self.owner, 'CALCULATION', self.ai.row(self.owner, 'CALCULATION', self.job['id']), {'name': 'Concurrent edit'})
            return result
        with patch.object(self.service, 'source', side_effect=drift), self.assertRaises(ApiError): self.create()
        self.assertFalse(self.services.list_owner_items(self.owner, 'AI_ARTIFACT'))

    def test_route_obeys_lease_and_custom_skill_tool_subset(self):
        request = self.request() | {'runId': self.run['id'], 'lease': 'fixture', 'toolName': 'create_manuscript'}
        route = '/v1/ai/conversations/aic_manuscript/manuscript_create'
        with self.assertRaises(ApiError): self.ai.handle(self.owner, 'POST', route, {**request, 'lease': 'wrong'}, {})
        self.ai.update(self.owner, 'AI_RUN', self.run, {'skillSnapshot': {'allowedTools': ['read_artifact']}})
        with self.assertRaisesRegex(ApiError, 'does not allow'): self.ai.handle(self.owner, 'POST', route, request, {})
        self.ai.update(self.owner, 'AI_RUN', self.ai.row(self.owner, 'AI_RUN', self.run['id']), {'skillSnapshot': {'allowedTools': ['create_manuscript']}})
        self.assertEqual(body(self.ai.handle(self.owner, 'POST', route, request, {}))['artifact']['kind'], 'manuscript')

    def test_crossref_metadata_verifies_identity_and_never_invents_optional_fields(self):
        record = {'message': {'DOI': '10.1234/synthetic', 'title': ['Synthetic fixture & title'], 'author': [{'given': 'A', 'family': 'Fixture'}], 'published': {'date-parts': [[2024]]}, 'container-title': ['Fixture journal'], 'volume': '2', 'page': '7-9'}}
        with patch('backend.local_api.domain.ai_manuscript.retrieve', return_value=json.dumps(record).encode()):
            row = verify_reference({'doi': '10.1234/synthetic'})
            self.assertEqual(row['journal'], 'Fixture journal'); self.assertEqual(row['pages'], '7-9'); self.assertNotIn('issue', row)
            with self.assertRaises(ValueError): verify_reference({'doi': '10.1234/other'})
        with patch('backend.local_api.domain.ai_manuscript.retrieve', side_effect=OSError('offline')):
            data = self.create(references=[{'doi': '10.1234/synthetic'}])['structuredData']
            self.assertEqual(data['references'], []); self.assertTrue(any('no citation was invented' in issue for issue in data['missingInformation']))

    def test_arxiv_xml_identity_and_external_entities_rejected(self):
        atom = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2401.00001v2</id><title>Synthetic fixture</title><author><name>A Fixture</name></author><published>2024-01-01</published></entry></feed>'
        with patch('backend.local_api.domain.ai_manuscript.retrieve', return_value=atom):
            self.assertEqual(verify_reference({'arxivId': '2401.00001'})['arxivId'], '2401.00001v2')
            with self.assertRaises(ValueError): verify_reference({'arxivId': '2401.00002'})
            with self.assertRaises(ValueError): verify_reference({'arxivId': '2401.00001v1'})
        with patch('backend.local_api.domain.ai_manuscript.retrieve', return_value=b'<!DOCTYPE data [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed/>'), self.assertRaises(ValueError): verify_reference({'arxivId': '2401.00001'})

    def test_request_fields_reference_urls_and_bounds_are_closed(self):
        for changes in [{'arbitrary': True}, {'calculationIds': [self.job['id']]*2}, {'references': [{'doi': 'https://private.invalid'}]}, {'references': [{'doi': '10.1234/x', 'journal': 'fabricated'}]}, {'authors': [{'name': 'A', 'affiliation': 'B', 'tex': 'unsafe'}]}, {'toolCallId': None}]:
            with self.subTest(changes=changes), self.assertRaises(ApiError): self.create(**changes)

    def test_quote_aware_method_tokens_bind_to_exact_offsets(self):
        file = {'path': 'inputs/test.in', 'role': 'input', 'text': INPUT}
        params = explicit_parameters([file])
        self.assertNotIn('999', [value['valueText'] for value in params])
        for value in params: self.assertEqual(INPUT[value['start']:value['end']], value['valueText'])

    def test_materials_project_needs_original_dated_snapshot_and_keeps_missing_method_unknown(self):
        source = {'name': 'Synthetic MP reference', 'lattice': {'a': 4, 'b': 4, 'c': 4, 'alpha': 90, 'beta': 90, 'gamma': 90}, 'atoms': [{'species': 'Si', 'x': 0, 'y': 0, 'z': 0}], 'source': 'Materials Project', 'externalId': 'mp-1', 'sourceUpdatedAt': '2024-01-01T00:00:00Z', 'sourceData': {'format': 'materials-project-json', 'content': json.dumps({'material_id': 'mp-1', 'band_gap': 1.5, 'last_updated': '2024-01-01'})}, 'provenance': {'database': 'materials-project', 'id': 'mp-1', 'retrievedAt': '2026-01-01T00:00:00Z'}}
        original_sha = hashlib.sha256(source['sourceData']['content'].encode()).hexdigest()
        source['sourceData']['sha256'] = source['provenance']['sourceSha256'] = original_sha
        raw = json.dumps(source).encode(); self.put('fixture/mp', raw)
        row = self.ai.put(self.owner, 'STRUCTURE', 'str_mpfixture', {'projectId': self.project, 'objectKey': 'fixture/mp', 'sha256': hashlib.sha256(raw).hexdigest()})
        data = self.create(materialsProjectStructureIds=[row['id']])['structuredData']
        self.assertIsNone(data['materialsProject'][0]['method']); self.assertEqual(data['materialsProject'][0]['units']['band_gap'], 'eV')
        self.assertTrue(any('MP' in issue or 'mp-1' in issue for issue in data['missingInformation']))

    def figure(self, altered=False, foreign=False):
        dataset = {'schemaVersion': 1, 'id': 'dataset_fixture', 'projectId': self.project, 'name': 'Synthetic CSV fixture', 'createdAt': '2026-01-01T00:00:00Z', 'data': {'kind': 'generic', 'title': 'Total energy', 'xLabel': 'X', 'quantities': [{'id': 'result', 'label': 'Result', 'yLabel': 'Energy EV', 'series': [{'id': 'energy_eV', 'label': 'Energy EV', 'points': [[0, 999 if altered else 1], [1, 2]]}]}]}, 'source': {'filename': 'data/energy.csv', 'sha256': hashlib.sha256(CSV.encode()).hexdigest(), 'parserVersion': 'phynite-research-1', 'text': CSV, 'calculationId': 'foreign' if foreign else self.job['id']}, 'metadata': {'energy': {'kind': 'unknown'}}}
        figure = {'schemaVersion': 1, 'id': 'figure_fixture', 'projectId': self.project, 'name': 'Synthetic figure', 'createdAt': '2026-01-01T00:00:00Z', 'updatedAt': '2026-01-01T00:00:00Z', 'widthMm': 89, 'heightMm': 80, 'columns': 1, 'fontPt': 9, 'lineWidthPt': .7, 'fontFamily': 'sans', 'showGrid': False, 'panelLabels': False, 'caption': 'Synthetic figure fixture', 'panels': [{'id': 'panel_fixture', 'title': '', 'layers': [{'id': 'layer_fixture', 'datasetId': dataset['id'], 'quantityId': 'result', 'label': 'Synthetic fixture', 'color': '#0072b2', 'lineStyle': 'solid', 'visible': True, 'energy': 'source', 'shiftEv': 0, 'normalization': 'source', 'mirrorSpin': True, 'normalizedPath': False, 'seriesIds': None, 'energyVertical': False}], 'xMin': None, 'xMax': None, 'yMin': None, 'yMax': None, 'energyGroup': '', 'span': 1, 'showLegend': True}]}
        documents = ResearchDocuments(self.services)
        documents.handle(self.owner, 'PUT', 'datasets', dataset['id'], {}, {'document': dataset, 'baseRevision': 0})
        documents.handle(self.owner, 'PUT', 'figures', figure['id'], {}, {'document': figure, 'baseRevision': 0})
        return figure

    def test_real_bounded_compiler_renders_exact_saved_figure_with_retained_csv(self):
        figure = self.figure()
        artifact = self.create(figureIds=[figure['id']]); data = artifact['structuredData']
        self.assertTrue(data['figures'][0]['svg'].startswith('<svg'))
        self.assertEqual(data['figures'][0]['svgSha256'], hashlib.sha256(data['figures'][0]['svg'].encode()).hexdigest())
        self.assertTrue(any(file['text'] == CSV for file in data['jobs'][0]['files']))
        self.assertEqual(data['figures'][0]['revision'], 1)

    def test_fabricated_saved_curve_is_rejected_by_real_csv_reparse(self):
        figure = self.figure(altered=True)
        with self.assertRaisesRegex(ApiError, 'differ from the executed CSV'): self.create(figureIds=[figure['id']])

    def test_foreign_or_modified_original_figure_csv_cannot_be_exported(self):
        figure = self.figure(foreign=True)
        with self.assertRaisesRegex(ApiError, 'selected executed calculation'): self.create(figureIds=[figure['id']])

    def test_stop_or_new_user_direction_during_lookup_prevents_publication(self):
        for values in [{'status': 'stopped'}, {'controlRevision': 1}]:
            with self.subTest(values=values):
                self.ai.update(self.owner, 'AI_RUN', self.ai.row(self.owner, 'AI_RUN', self.run['id']), {'status': 'running', 'controlRevision': 0})
                def changed(_ref):
                    self.ai.update(self.owner, 'AI_RUN', self.ai.row(self.owner, 'AI_RUN', self.run['id']), values)
                    raise OSError('Synthetic interrupted lookup')
                with patch('backend.local_api.domain.ai_manuscript.verify_reference', side_effect=changed), self.assertRaises(ApiError): self.create(references=[{'doi': '10.1234/synthetic'}])
                self.assertEqual(self.services.list_owner_items(self.owner, 'AI_ARTIFACT'), [])

    def test_restricted_upf_files_are_excluded_without_changing_executed_inputs(self):
        raw = b'Synthetic restricted-model fixture; must not be exported'
        self.put('fixture/result/inputs/Si.UPF', raw)
        self.manifest['artifacts'].append({'path': 'inputs/Si.UPF', 'role': 'input', 'sha256': hashlib.sha256(raw).hexdigest(), 'sizeBytes': len(raw)})
        self.save_manifest()
        files = self.create()['structuredData']['jobs'][0]['files']
        self.assertTrue(any(file['text'] == INPUT for file in files)); self.assertFalse(any(file['path'].endswith('UPF') for file in files))
