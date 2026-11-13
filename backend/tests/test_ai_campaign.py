"""Fault-injected real local persistence/admission, with labelled synthetic QE evidence."""
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
from backend.local_api.domain.ai_campaign import CampaignSupervisor, healing_policy, repaired_qe_input
from backend.local_api.domain.phynite_core import ApiError

QE = """&CONTROL
 calculation = 'scf', prefix = 'fixture',
/
&SYSTEM
 ibrav=1, celldm(1)=10, nat=1, ntyp=1, ecutwfc=40,
/
&ELECTRONS
 conv_thr = 1.0d-8,
 mixing_beta = 0.7, mixing_mode = 'plain', diagonalization = 'david', electron_maxstep = 100,
/
ATOMIC_SPECIES
Si 28 Si.upf
ATOMIC_POSITIONS crystal
Si 0 0 0
K_POINTS automatic
1 1 1 0 0 0
"""


class CampaignTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.services = LocalServices(Path(directory.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.services.compute_enabled = True
        self.api = PhyniteApi(self.services); self.ai = AiWorkspace(self.api); self.owner = self.services.owner
        self.supervisor = CampaignSupervisor(self.api); self.workflow = self.supervisor.workflow
        self.project = body(self.api.create_project(self.owner, {'name': 'Synthetic campaign fixture'}))['project']['id']
        self.conversation = self.ai.put(self.owner, 'AI_CONVERSATION', 'aic_campaign', {'projectKey': 'project:' + self.project, 'mode': 'approval', 'activeRunId': 'air_campaign', 'title': 'Campaign fixture'})
        self.run = self.ai.put(self.owner, 'AI_RUN', 'air_campaign', {'conversationId': 'aic_campaign', 'status': 'running', 'expiresAt': int(time.time()) + 900, 'leaseHash': digest('fixture'), 'taskMode': 'work', 'modelId': 'fixture'})
        self.ai.put(self.owner, 'STRUCTURE', 'str_campaign', {'projectId': self.project, 'status': 'READY'})
        self.services.update_item(self.owner, 'PERSONAL_WORKER', 'primary', {'lastSeenAtEpoch': int(time.time()), 'capabilities': ['qe']})
        graph = {'version': 1, 'projectId': self.project, 'nodes': [
            {'id': 's', 'kind': 'structure', 'name': 'Fixture input', 'position': {'x': 0, 'y': 0}, 'configuration': {}, 'resources': [{'kind': 'structure', 'id': 'str_campaign'}]},
            {'id': 'scf', 'kind': 'scf', 'name': 'Fixture SCF', 'position': {'x': 300, 'y': 0}, 'configuration': {'execution': {'structureId': 'str_campaign', 'calculationType': 'Total energy', 'qeInput': QE, 'inputFiles': {'scf.in': QE}, 'settings': {}, 'vcpus': 1, 'memoryMiB': 1024, 'computeTarget': 'personal'}}, 'resources': []}],
            'edges': [{'id': 'e', 'source': 's', 'target': 'scf', 'port': 'structure'}], 'groups': []}
        self.workflow.save(self.owner, self.project, {'workflow': graph, 'baseRevision': 0})
        pseudo = patch('backend.local_api.pseudopotentials.execution_pseudopotential_error', return_value=None)
        pseudo.start(); self.addCleanup(pseudo.stop)
        self.definition = {'revision': 1, 'targets': ['scf'], 'repairs': [{'mixingBeta': .3}, {'electronMaxSteps': 200}],
            'budget': {'wallSecondsPerAttempt': 60, 'queueSecondsPerAttempt': 120, 'totalNodeHours': 1, 'expiresAtEpoch': int(time.time()) + 900}}

    def campaign(self):
        action = self.ai.prepare(self.owner, self.conversation, self.run, {'kind': 'start_campaign', 'stamp': self.ai.context(self.owner, self.conversation)['stamp'], 'payload': self.definition})
        result = self.ai.execute(self.owner, self.conversation, action, action['payloadHash'])
        self.assertEqual(result['status'], 'succeeded', result)
        return self.row(result['result']['campaignId'])

    def row(self, identifier):
        return self.ai.row(self.owner, 'AI_CAMPAIGN', identifier)

    def advance(self, row, **kwargs):
        self.supervisor.advance(self.row(row['id']), **kwargs)
        return self.row(row['id'])

    def jobs(self):
        return self.services.list_owner_items(self.owner, 'CALCULATION')

    def latest_job(self, row):
        attempt = row['attempts'][-1]
        identifier = attempt['expectedId'] if attempt['mode'] == 'calculation' else self.workflow.attempt(self.owner, attempt['expectedId'], 'scf')['jobId']
        return self.services.get_item(self.owner, 'CALCULATION', identifier)

    def finish(self, job, *, success=False, log=None):
        log = (log or ('Synthetic test fixture\nc_bands: 1 eigenvalues not converged\nconvergence has been achieved\nJOB DONE.\n' if success else 'Synthetic test fixture\nconvergence NOT achieved after 100 iterations\n')).encode()
        stage = {'stage': 'scf', 'calculationMode': 'scf', 'jobDone': True, 'solverError': False, 'electronicConvergence': 'converged' if success else 'not-converged', 'hybridConvergence': 'not-applicable',
            'scfAccuracy': {'status': 'verified', 'residualRy': 1e-10, 'residualUpperRy': 1.1e-10, 'thresholdRy': 1e-8, 'source': 'qe-log-bound'}}
        manifest = {'version': 2, 'calculationId': job['id'], 'calculationType': 'Total energy', 'status': 'completed' if success else 'failed',
            'summary': {'converged': success, 'jobDone': True, 'stageConvergence': [stage]},
            'artifacts': [{'path': 'logs/scf.out', 'sizeBytes': len(log), 'sha256': hashlib.sha256(log).hexdigest(), 'role': 'log', 'contentType': 'text/plain'}]}
        for path, data in [('logs/scf.out', log), ('result.json', json.dumps(manifest).encode())]:
            self.services.s3.put_object(Bucket=self.services.bucket, Key=job['outputPrefix'] + '/' + path, Body=data)
        self.services.update_item(self.owner, 'CALCULATION', job['id'], {'status': 'COMPLETED' if success else 'FAILED'})

    def test_browser_lease_expiry_and_restart_reconcile_one_existing_job(self):
        row = self.campaign(); row = self.advance(row)
        self.assertEqual(len(self.jobs()), 1)
        self.services.update_item(self.owner, 'AI_RUN', self.run['id'], {'status': 'stopped', 'expiresAt': 1})
        self.supervisor = CampaignSupervisor(self.api)
        row = self.advance(row); row = self.advance(row)
        self.assertEqual(len(self.jobs()), 1)
        self.finish(self.jobs()[0], success=True)
        row = self.advance(row); row = self.advance(row)
        self.assertEqual(row['status'], 'completed')
        public = self.supervisor.read(self.owner, self.conversation, row['id'])
        self.assertNotRegex(json.dumps(public), '_requestKey|_evidenceKey|users/|snapshotKey')
        self.assertEqual(self.supervisor.attempt_input(self.owner, self.conversation, row['id'], 0)['input']['qeInput'], QE)

    def test_crash_before_submission_stops_with_uncertain_intent_and_never_retries(self):
        row = self.campaign()
        with patch.object(self.workflow, 'start', side_effect=SystemExit('simulated crash before submission')):
            with self.assertRaises(SystemExit): self.advance(row)
        self.assertFalse(self.jobs())
        self.supervisor = CampaignSupervisor(self.api)
        row = self.advance(row)
        self.assertEqual(row['status'], 'manual resume required')
        self.assertFalse(self.jobs())

    def test_crash_after_submission_recovers_receipt_without_a_second_job(self):
        row = self.campaign(); start = self.workflow.start
        def crash(*args):
            start(*args)
            raise SystemExit('simulated crash after admission')
        with patch.object(self.workflow, 'start', side_effect=crash):
            with self.assertRaises(SystemExit): self.advance(row)
        self.assertEqual(len(self.jobs()), 1)
        self.supervisor = CampaignSupervisor(self.api)
        row = self.advance(row)
        self.assertEqual(row['attempts'][0]['phase'], 'observing')
        self.assertEqual(len(self.jobs()), 1)

    def test_two_repairs_preserve_thresholds_then_stop_on_final_failure(self):
        row = self.advance(self.campaign())
        for expected in (2, 3):
            job = self.latest_job(row); self.finish(job)
            row = self.advance(row)
            self.assertEqual(len(self.jobs()), expected, row)
        self.finish(self.latest_job(row)); row = self.advance(row)
        self.assertEqual(len(self.jobs()), 3)
        self.assertEqual(row['status'], 'manual resume required')
        inputs = [self.supervisor.attempt_input(self.owner, self.conversation, row['id'], index)['input']['qeInput'] for index in range(3)]
        self.assertIn('mixing_beta = 0.3', inputs[1]); self.assertIn('electron_maxstep = 200', inputs[2])
        for text in inputs: self.assertIn('conv_thr = 1.0d-8', text); self.assertIn('ecutwfc=40', text)

    def test_c_bands_warning_alone_does_not_trigger_repair_and_lost_atoms_proposes_review(self):
        for log in ('Synthetic fixture\nc_bands: 1 eigenvalues not converged\n', 'Synthetic fixture\nERROR: Lost atoms: original 64 current 63\n'):
            row = self.advance(self.campaign()); job = self.latest_job(row); self.finish(job, log=log)
            row = self.advance(row)
            self.assertEqual(len(row['attempts']), 1)
            self.assertEqual(row['status'], 'manual resume required')
            if 'Lost' in log:
                self.assertTrue(row['attempts'][0]['repairProposal']['preserveAllAtoms'])
                self.assertFalse(row['attempts'][0]['repairProposal']['automaticMinimization'])
            # Fresh explicit approval, no reuse of prior campaign authority.
            self.run = self.ai.update(self.owner, 'AI_RUN', self.ai.row(self.owner, 'AI_RUN', self.run['id']), {'status': 'running'})

    def test_expiry_budget_cancellation_conflict_and_scope(self):
        row = self.campaign()
        row = self.advance(row, now=self.definition['budget']['expiresAtEpoch'] + 1)
        self.assertEqual(row['status'], 'manual resume required'); self.assertFalse(self.jobs())
        self.run = self.ai.update(self.owner, 'AI_RUN', self.ai.row(self.owner, 'AI_RUN', self.run['id']), {'status': 'running'})
        row = self.advance(self.campaign()); row = self.advance(row)
        with self.assertRaises(ApiError): self.supervisor.cancel(self.owner, self.conversation, row['id'], row['revision'] - 1)
        with self.assertRaises(ApiError): self.supervisor.read('other-owner', self.conversation, row['id'])
        other = body(self.api.create_project(self.owner, {'name': 'Other project'}))['project']['id']
        with self.assertRaises(ApiError): self.supervisor.read(self.owner, {**self.conversation, 'projectKey': 'project:' + other}, row['id'])
        row = self.advance(row, now=time.time() + 121); row = self.advance(row, now=time.time() + 122)
        self.assertEqual(row['status'], 'manual resume required'); self.assertEqual(len(self.jobs()), 1)

    def test_physical_policy_full_mode_bad_budget_and_third_step_are_rejected(self):
        for step in ({'smearing': 'mv'}, {'occupations': 'smearing'}, {'spin': 2}, {'cutoff': 50}, {'kgrid': 8}, {'timestep': 1}, {'ensemble': 'nvt'}, {'preMinimization': True}, {'conv_thr': 1e-5}):
            with self.subTest(step=step), self.assertRaises(ApiError): healing_policy([step])
        with self.assertRaises(ApiError): healing_policy([{'mixingBeta': .3}] * 3)
        with self.assertRaises(ApiError): self.supervisor.prepare(self.owner, {**self.conversation, 'mode': 'full'}, self.definition)
        invalid = copy.deepcopy(self.definition); invalid['budget']['totalNodeHours'] = .001
        with self.assertRaises(ApiError): self.supervisor.prepare(self.owner, self.conversation, invalid)

    def test_input_patch_ignores_comments_strings_and_preserves_every_other_byte(self):
        original = "! mixing_beta=999 / &ELECTRONS\n" + QE + "! conv_thr remains unchanged\n"
        changed = repaired_qe_input(original, {'mixingBeta': .3, 'diagonalization': 'cg'})
        self.assertEqual(changed.replace('mixing_beta = 0.3', 'mixing_beta = 0.7').replace("diagonalization = 'cg'", "diagonalization = 'david'"), original)
        with self.assertRaises(ApiError): repaired_qe_input(QE.replace('mixing_beta = 0.7,', 'mixing_beta = 0.7, mixing_beta = .5,'), {'mixingBeta': .3})
        with self.assertRaises(ApiError): repaired_qe_input(QE, {'mixingBeta': .7})

    def test_diagnostic_tampering_wait_for_worker_and_legacy_records_have_no_authority(self):
        row = self.campaign(); self.services.compute_enabled = False
        row = self.advance(row); self.assertEqual(row['attempts'], []); self.assertFalse(self.jobs())
        self.services.compute_enabled = True
        row = self.advance(row); job = self.latest_job(row); self.finish(job)
        self.services.s3.put_object(Bucket=self.services.bucket, Key=job['outputPrefix'] + '/logs/scf.out', Body=b'tampered log')
        self.supervisor.tick()
        row = self.row(row['id']); self.assertEqual(row['status'], 'manual resume required'); self.assertEqual(len(self.jobs()), 1)
        self.ai.put(self.owner, 'AI_CAMPAIGN', 'legacy_campaign', {'schemaVersion': 0, 'status': 'executing'})
        self.supervisor.tick()
        self.assertEqual(self.row('legacy_campaign')['status'], 'executing'); self.assertEqual(len(self.jobs()), 1)

    def test_explicit_campaign_cancel_requires_current_revision_and_cancels_queued_job(self):
        row = self.advance(self.campaign()); row = self.advance(row)
        result = self.supervisor.cancel(self.owner, self.conversation, row['id'], row['revision'])
        self.assertTrue(result['cancelRequested'])
        row = self.advance(row)
        self.assertEqual(row['status'], 'cancelled')
        self.assertEqual(self.latest_job(row)['status'], 'CANCELLED')

    def test_running_budget_does_not_count_time_already_waited_in_queue(self):
        row = self.advance(self.campaign())
        job = self.latest_job(row)
        created = row['attempts'][0]['createdAtEpoch']
        self.services.update_item(self.owner, 'CALCULATION', job['id'], {'status': 'RUNNING'})
        row = self.advance(row, now=created + 100)
        self.assertEqual(self.latest_job(row)['status'], 'RUNNING')
        row = self.advance(row, now=created + 161)
        self.assertEqual(self.latest_job(row)['status'], 'CANCELLED')

    def test_crash_after_repair_submission_and_campaign_idempotency(self):
        row = self.advance(self.campaign())
        self.finish(self.latest_job(row))
        create = self.api.create_calculation
        def crash(*args):
            create(*args)
            raise SystemExit('simulated crash after repair admission')
        with patch.object(self.api, 'create_calculation', side_effect=crash):
            with self.assertRaises(SystemExit): self.advance(row)
        self.assertEqual(len(self.jobs()), 2)
        self.supervisor = CampaignSupervisor(self.api)
        row = self.advance(row)
        self.assertEqual(row['attempts'][-1]['phase'], 'observing')
        self.assertEqual(len(self.jobs()), 2)

    def test_canvas_revision_change_blocks_next_repair(self):
        row = self.advance(self.campaign())
        self.finish(self.latest_job(row))
        graph = self.workflow.load(self.owner, self.project)
        self.workflow.save(self.owner, self.project, {'workflow': graph['workflow'], 'baseRevision': graph['revision']})
        row = self.advance(row)
        self.assertEqual(row['status'], 'manual resume required')
        self.assertEqual(len(self.jobs()), 1)
