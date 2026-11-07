"""Readiness reviews use the same workspace worker as local dispatch."""
from __future__ import annotations

from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError, owner_partition
from backend.local_api.domain.project_workflow import DEFAULT_QE_DRAFT, ProjectWorkflowApi, encoded, fingerprints
from backend.local_api.services import LocalServices


def node(node_id, kind, resources=None):
    return {'id': node_id, 'kind': kind, 'name': node_id, 'position': {'x': 0, 'y': 0}, 'configuration': {}, 'resources': resources or []}


def graph():
    return {'version': 1, 'projectId': 'prj_1', 'nodes': [
        node('s', 'structure', [{'kind': 'structure', 'id': 'str_1'}]), node('scf', 'scf'), node('bands', 'bands')],
        'edges': [{'id': 'a', 'source': 's', 'target': 'scf', 'port': 'structure'},
                  {'id': 'b', 'source': 'scf', 'target': 'bands', 'port': 'electronic'}], 'groups': []}


def simulation_workflow(mode='guided'):
    return {'version': 2, 'mode': mode, 'units': 'metal', 'boundaryType': 'p p p',
            'potential': {'kind': 'builtin', 'id': 'lj-generic', 'epsilonEv': .0103, 'sigmaAngstrom': 3.4, 'cutoffAngstrom': 8.5},
            'steps': [{'id': 'nvt-stage', 'kind': 'nvt', 'name': 'NVT equilibration', 'enabled': True,
                       'params': {'timestepFs': 1, 'totalSteps': 20, 'tempStartK': 300, 'tempEndK': 300, 'tempDampingPs': .1}}],
            'output': {'thermoFrequency': 5, 'dumpFrequency': 5},
            **({'manualBody': 'fix integrator all nve\nrun 20\nunfix integrator\n'} if mode == 'manual' else {})}


class LocalWorkflowReadinessTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.api = PhyniteApi(self.services)
        self.workflow = ProjectWorkflowApi(self.api)
        for kind, item_id, values in [("PROJECT", "prj_1", {}), ("STRUCTURE", "str_1", {"projectId": "prj_1"})]:
            self.services.put_item({"PK": owner_partition("user-1"), "SK": f"{kind}#{item_id}", "id": item_id, "entityType": kind, **values})
        self.workflow.put_new('user-1', 'PERSONAL_WORKER', 'primary', {'tokenHash': 'paired', 'lastSeenAtEpoch': int(time.time()), 'capabilities': ['qe', 'md-simulation', 'md-analysis']})

    def call(self, method, suffix="", payload=None, owner="user-1"):
        if method == 'GET' and not suffix:
            return self.workflow.load(owner, 'prj_1')
        if method == 'PUT' and not suffix:
            return self.workflow.save(owner, 'prj_1', payload)
        if method == 'POST' and suffix == '/plan':
            return {'plan': self.workflow.plan(owner, 'prj_1', payload)[0]}
        if method == 'POST' and suffix == '/runs':
            return self.workflow.start(owner, 'prj_1', payload)
        raise AssertionError('Unexpected test API call')

    def test_missing_runtime_is_reported_before_creating_any_run_or_attempt(self):
        workflow = graph(); workflow['nodes'] = workflow['nodes'][:2]; workflow['edges'] = workflow['edges'][:1]
        workflow['nodes'][1]['configuration'] = {'execution': {'structureId': 'str_1'}}
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 0})
        self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'capabilities': []})
        payload = {'revision': 1, 'targets': ['scf'], 'idempotencyKey': 'runtime-missing-1'}
        with patch.object(self.api, 'create_calculation') as creation:
            plan = self.call('POST', '/plan', payload)['plan']
            self.assertEqual(len(plan['errors']), 1)
            self.assertEqual(plan['errors'][0]['nodeId'], 'scf')
            self.assertIn('Install the DFT', plan['errors'][0]['message'])
            self.assertIn('/local#runtime', plan['errors'][0]['message'])
            self.assertEqual(plan['nodes'][-1]['error'], plan['errors'][0]['message'])
            with self.assertRaises(ApiError) as rejected:
                self.call('POST', '/runs', payload)
            self.assertEqual(rejected.exception.code, 'WORKFLOW_NOT_READY')
            creation.assert_not_called()
        self.assertFalse(self.services.list_owner_items('user-1', 'PROJECT_RUN'))
        self.assertFalse(self.services.list_owner_items('user-1', 'WORKFLOW_ATTEMPT'))

    def test_offline_computer_is_distinct_from_missing_runtime_and_is_owner_scoped(self):
        workflow = graph(); workflow['nodes'] = workflow['nodes'][:2]; workflow['edges'] = workflow['edges'][:1]
        workflow['nodes'][1]['configuration'] = {'execution': {'structureId': 'str_1'}}
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 0})
        self.workflow.put_new('other-owner', 'PERSONAL_WORKER', 'primary', {'tokenHash': 'other-pairing', 'lastSeenAtEpoch': int(time.time()), 'capabilities': ['qe']})
        for updates in ({'lastSeenAtEpoch': int(time.time()) - 91, 'capabilities': ['qe']},
                        {'lastSeenAtEpoch': 0, 'capabilities': []}, {'lastSeenAtEpoch': int(time.time()), 'tokenHash': ''}):
            with self.subTest(updates=updates):
                self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', updates)
                message = self.call('POST', '/plan', {'revision': 1, 'targets': ['scf']})['plan']['errors'][0]['message']
                self.assertIn('offline', message)
                self.assertIn('phynite-lab', message)
                self.assertNotIn('Install the', message)
                if not updates.get('capabilities', []):
                    self.assertIn('/local#runtime', message)
                    self.assertIn('install it', message)

    def test_runtime_readiness_checks_only_new_execution_not_retained_results_or_inputs(self):
        workflow = graph(); workflow['nodes'] = workflow['nodes'][:2]; workflow['edges'] = workflow['edges'][:1]
        workflow['nodes'][1]['configuration'] = {'execution': {'structureId': 'str_1'}}
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 0})
        self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'lastSeenAtEpoch': 0, 'capabilities': []})
        with patch.object(self.workflow, 'find_reusable', side_effect=lambda owner, project, item, fingerprint: {'id': 'retained-attempt'} if item['kind'] == 'scf' else None):
            plan, _ = self.workflow.plan('user-1', 'prj_1', {'revision': 1, 'targets': ['scf']})
        self.assertEqual([item['action'] for item in plan['nodes']], ['input', 'reuse'])
        self.assertEqual(plan['errors'], [])

    def test_analysis_and_extraction_require_analysis_capability_not_just_qe(self):
        self.workflow.put_new('user-1', 'MD_TRAJECTORY', 'trajectory', {'projectId': 'prj_1'})
        for kind in ('md-analysis', 'extract-frame'):
            with self.subTest(kind=kind):
                source = node('trajectory', 'trajectory', [{'kind': 'trajectory', 'id': 'trajectory'}])
                target = node('analysis', kind)
                target['configuration'] = ({'execution': {'pipeline': {'version': 1, 'modifiers': [], 'typeMap': {}, 'periodic': [True, True, True]}}}
                                           if kind == 'md-analysis' else {'frame': 0, 'coordinateUnit': 'angstrom', 'periodic': [True, True, True]})
                workflow = {'version': 1, 'projectId': 'prj_1', 'nodes': [source, target], 'edges': [{'id': 'analysis-input', 'source': 'trajectory', 'target': 'analysis', 'port': 'trajectory'}], 'groups': []}
                current = self.call('GET')['revision']
                self.call('PUT', payload={'workflow': workflow, 'baseRevision': current})
                self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'capabilities': ['qe', 'md-simulation']})
                plan = self.call('POST', '/plan', {'revision': current + 1, 'targets': ['analysis']})['plan']
                self.assertEqual(len(plan['errors']), 1)
                self.assertIn('MD and analysis', plan['errors'][0]['message'])
                self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'capabilities': ['md-analysis']})
                self.assertFalse(self.call('POST', '/plan', {'revision': current + 1, 'targets': ['analysis']})['plan']['errors'])

    def test_md_requires_simulation_capability_and_preserves_manual_preflight_errors(self):
        workflow = graph(); workflow['nodes'] = workflow['nodes'][:1] + [node('md', 'md')]
        workflow['edges'] = [{'id': 'md-input', 'source': 's', 'target': 'md', 'port': 'structure'}]
        workflow['nodes'][1]['configuration'] = {'execution': {'workflow': simulation_workflow(), 'computeTarget': 'personal'}}
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 0})
        self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'capabilities': ['qe', 'md-analysis']})
        plan = self.call('POST', '/plan', {'revision': 1, 'targets': ['md']})['plan']
        self.assertEqual(len(plan['errors']), 1)
        self.assertIn('MD and analysis', plan['errors'][0]['message'])
        self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'capabilities': ['md-simulation']})
        self.assertFalse(self.call('POST', '/plan', {'revision': 1, 'targets': ['md']})['plan']['errors'])
        workflow['nodes'][1]['configuration']['execution']['workflow'] = simulation_workflow(mode='manual')
        workflow['nodes'][1]['configuration']['execution']['workflow']['manualBody'] = 'shell touch forbidden'
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 1})
        self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'lastSeenAtEpoch': 0, 'capabilities': []})
        plan = self.call('POST', '/plan', {'revision': 2, 'targets': ['md']})['plan']
        self.assertEqual(len(plan['errors']), 1)
        self.assertNotIn('offline', plan['errors'][0]['message'])
        self.assertIn('shell', plan['errors'][0]['message'])

    def test_local_figures_do_not_require_a_running_solver(self):
        workflow = graph(); workflow['nodes'] = workflow['nodes'][:3] + [node('figure', 'figure')]
        workflow['edges'] = workflow['edges'][:2] + [{'id': 'plot-input', 'source': 'bands', 'target': 'figure', 'port': 'dataset'}]
        for item in workflow['nodes'][1:3]:
            item['configuration'] = {'execution': {'structureId': 'str_1'}}
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 0})
        self.services.update_item('user-1', 'PERSONAL_WORKER', 'primary', {'lastSeenAtEpoch': 0, 'capabilities': []})
        with patch.object(self.workflow, 'find_reusable', side_effect=lambda owner, project, item, fingerprint: {'id': item['id']} if item['kind'] in {'scf', 'bands'} else None):
            plan, _ = self.workflow.plan('user-1', 'prj_1', {'revision': 1, 'targets': ['figure']})
        self.assertEqual(plan['nodes'][-1]['action'], 'prepare')
        self.assertEqual(plan['errors'], [])

    def test_missing_selected_pseudopotentials_are_reported_before_run_records(self):
        workflow = graph(); workflow['nodes'] = workflow['nodes'][:2]; workflow['edges'] = workflow['edges'][:1]
        exact_input = 'ATOMIC_SPECIES\nSi 28.085 Si.pbe.sssp-precision.upf\nATOMIC_POSITIONS crystal\nSi 0 0 0\nK_POINTS gamma\n'
        workflow['nodes'][1]['configuration'] = {'execution': {'structureId': 'str_1', 'qeInput': exact_input, 'pseudopotentials': {}}}
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 0})
        payload = {'revision': 1, 'targets': ['scf'], 'idempotencyKey': 'missing-pseudo-1'}
        plan = self.call('POST', '/plan', payload)['plan']
        self.assertEqual(len(plan['errors']), 1)
        self.assertIn('SSSP PBE Precision', plan['errors'][0]['message'])
        self.assertIn('/local#pseudopotentials', plan['errors'][0]['message'])
        with self.assertRaises(ApiError):
            self.call('POST', '/runs', payload)
        self.assertFalse(self.services.list_owner_items('user-1', 'PROJECT_RUN'))
        self.assertFalse(self.services.list_owner_items('user-1', 'WORKFLOW_ATTEMPT'))
        workflow['nodes'][1]['configuration']['execution']['pseudopotentials'] = {'Si.pbe.sssp-precision.upf': 'users/owned/pseudo'}
        self.call('PUT', payload={'workflow': workflow, 'baseRevision': 1})
        self.assertEqual(self.call('POST', '/plan', {'revision': 2, 'targets': ['scf']})['plan']['errors'], [])

    def test_canonical_fingerprints_and_legacy_snapshot_reconciliation(self):
        import copy
        import hashlib
        base = graph()
        structure = {
            'id': 'local-id', 'name': 'ZnNi2O4', 'formula': 'ZnNi2O4', 'source': 'cif', 'spaceGroup': 'Fd-3m',
            'externalId': 'mp-123', 'sourceUrl': 'https://example.org/mp-123', 'sourceUpdatedAt': '2026-01-01',
            'sourceData': {'energyAboveHull': 0}, 'geometryProvenance': 'relaxed', 'bandGap': 1.4,
            'provenance': {'importedAt': '2026-01-01'},
            'atoms': [{'id': 'atom-1', 'species': 'Zn', 'label': 'Zn', 'x': 0.0, 'y': 0.0, 'z': 0.0}],
            'lattice': {'a': 8.3, 'b': 8.3, 'c': 8.3, 'alpha': 90.0, 'beta': 90.0, 'gamma': 90.0, 'periodic': [True, True, True]},
        }
        base['nodes'][0]['configuration'] = {'structure': structure, 'formula': 'ZnNi2O4', 'missingInputs': []}
        base['nodes'][1]['configuration'] = {
            'draft': {**DEFAULT_QE_DRAFT, 'cutoffPolicy': 'manual', 'cutoff': 60, 'chargeDensityCutoff': 480, 'plotYMin': -10, 'plotYMax': 10},
            'execution': {'structureId': 'str_1', 'computeTarget': 'shared', 'vcpus': 4, 'memoryMiB': 8192},
            'computeTarget': 'personal', 'cloudMode': 'spot', 'computeProfileId': 'std', 'vcpus': 8, 'memoryMiB': 16384,
            'pseudopotentialChecksums': {'Zn': 'abc'}, 'parameterStudy': {'id': 'study_1'}, 'missingInputs': [],
        }
        base['nodes'][2]['configuration'] = {
            'compilerVersion': 1,
            'draft': {**DEFAULT_QE_DRAFT, 'cutoffPolicy': 'manual', 'cutoff': 60, 'chargeDensityCutoff': 480, 'projectedBands': True},
        }
        before = fingerprints(base)
        minimal = graph()
        minimal['nodes'][0]['resources'] = [{'kind': 'structure', 'id': 'str_1', 'sha256': 'a' * 64}]
        minimal_structure = {
            'atoms': [{'species': 'Zn', 'x': 0, 'y': 0, 'z': 0}],
            'lattice': {'a': 8.3, 'b': 8.3, 'c': 8.3, 'alpha': 90, 'beta': 90, 'gamma': 90},
            'periodic': [True, True, True],
        }
        minimal['nodes'][0]['configuration'] = {
            'structure': minimal_structure,
            'savedStructureSignature': encoded(minimal_structure).decode('utf-8'),
        }
        minimal['nodes'][1]['configuration'] = {'draft': {'cutoffPolicy': 'manual', 'cutoff': 60, 'chargeDensityCutoff': 480}}
        minimal['nodes'][2]['configuration'] = {'draft': {'projectedBands': True}}
        self.assertEqual(fingerprints(minimal), before)

        unhydrated_snapshot_wf = copy.deepcopy(minimal)
        unhydrated_snapshot_wf['nodes'][0]['configuration'] = {}
        self.call('PUT', payload={'workflow': minimal, 'baseRevision': 0})
        snapshot = {
            'id': 'run_legacy',
            'workflow': unhydrated_snapshot_wf,
            'plan': {'order': ['s', 'scf', 'bands'], 'nodes': [{'nodeId': 's', 'fingerprint': 'legacy_s_hash'}, {'nodeId': 'scf', 'fingerprint': 'legacy_scf_hash'}, {'nodeId': 'bands', 'fingerprint': 'legacy_bands_hash'}]},
        }
        key, sha = self.workflow.write_json('user-1', 'prj_1', 'runs', snapshot)
        self.workflow.put_new('user-1', 'PROJECT_RUN', 'run_legacy', {
            'projectId': 'prj_1', 'workflowRevision': 1, 'status': 'completed',
            'order': ['s', 'scf', 'bands'], 'targets': ['bands'], 'objectKey': key, 'sha256': sha,
        })
        self.workflow.put_new('user-1', 'WORKFLOW_ATTEMPT', 'run_legacy_s', {
            'projectId': 'prj_1', 'runId': 'run_legacy', 'nodeId': 's', 'status': 'completed', 'fingerprint': 'legacy_s_hash',
        })
        scf_attempt = self.workflow.put_new('user-1', 'WORKFLOW_ATTEMPT', 'run_legacy_scf', {
            'projectId': 'prj_1', 'runId': 'run_legacy', 'nodeId': 'scf', 'status': 'completed', 'fingerprint': 'legacy_scf_hash',
            'jobId': 'calc_ok', 'jobKind': 'CALCULATION',
        })
        loaded = self.workflow.get_run('user-1', 'prj_1', 'run_legacy')['run']
        self.assertFalse(loaded['attempts'][0]['outdated'])
        self.assertFalse(loaded['attempts'][1]['outdated'])
        current_hashes = fingerprints(minimal)
        self.assertTrue(self.workflow.attempt_matches_fingerprint('user-1', 'prj_1', scf_attempt, current_hashes['scf']))

        self.workflow.put_new('user-1', 'STRUCTURE', 'str_2', {'projectId': 'prj_1', 'status': 'READY'})
        raw_s3 = encoded(structure)
        self.services.s3.put_object(Bucket=self.services.bucket, Key='str-1-key', Body=raw_s3)
        self.services.update_item('user-1', 'STRUCTURE', 'str_1', {'objectKey': 'str-1-key', 'sha256': hashlib.sha256(raw_s3).hexdigest()})
        dup_wf = copy.deepcopy(minimal)
        dup_wf['nodes'][0]['resources'] = [{'kind': 'structure', 'id': 'str_2'}]
        self.call('PUT', payload={'workflow': dup_wf, 'baseRevision': 1})
        loaded_dup = self.workflow.get_run('user-1', 'prj_1', 'run_legacy')['run']
        self.assertFalse(loaded_dup['attempts'][0]['outdated'])
        self.assertFalse(loaded_dup['attempts'][1]['outdated'])
        dup_hashes = fingerprints(dup_wf)
        self.assertTrue(self.workflow.attempt_matches_fingerprint('user-1', 'prj_1', scf_attempt, dup_hashes['scf']))

        edited = copy.deepcopy(dup_wf)
        edited['nodes'][1]['configuration']['draft']['cutoff'] = 80
        self.call('PUT', payload={'workflow': edited, 'baseRevision': 2})
        loaded_after = self.workflow.get_run('user-1', 'prj_1', 'run_legacy')['run']
        self.assertFalse(loaded_after['attempts'][0]['outdated'])
        self.assertFalse(loaded_after['attempts'][1]['outdated'])
        edited_hashes = fingerprints(edited)
        self.assertFalse(self.workflow.attempt_matches_fingerprint('user-1', 'prj_1', scf_attempt, edited_hashes['scf']))


if __name__ == "__main__":
    unittest.main()
