"""Real GP numerics and fault-injected control plane; QE evidence is labelled synthetic."""
from __future__ import annotations
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import time
import unittest
from unittest.mock import patch, Mock

from backend.local_worker.ai_discovery import contract, expected_improvement, next_candidate, parameters, sha, validate_observation
from backend.local_api.domain.ai_discovery import DiscoverySupervisor
from backend.local_api.domain.ai_workspace import AiWorkspace, body
from backend.local_api.domain.project_workflow import DEFAULT_QE_DRAFT
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.services import LocalServices


def definition():
    return {'version':2,'parameters':[{'name':'a','kind':'continuous','min':5.,'max':6.,'unit':'angstrom'}], 'objective':{'kind':'dft_energy_per_atom','direction':'minimize','unit':'eV/atom'},'conditions':{'label':'Synthetic control-plane fixture, fixed PBE protocol'},'seed':12,'budget':{'evaluations':2,'wallSeconds':60,'queueSeconds':120,'totalNodeHours':10,'expiresAtEpoch':int(time.time())+900}}


def approved():return {'contract':definition(),'methodSha256':'a'*64,'compositionSha256':'b'*64,'conditionsSha256':'c'*64}


def observed(a=5.5,value=-1.):return {'parameters':{'a':a},'value':value,'status':'completed','kind':'dft_energy_per_atom','unit':'eV/atom','methodSha256':'a'*64,'compositionSha256':'b'*64,'conditionsSha256':'c'*64,'manifestSha256':'d'*64}


class DiscoveryNumericsTests(unittest.TestCase):
    def test_contract_default_bounds_units_target_and_legacy_authority(self):
        value=definition();value['budget'].pop('evaluations');self.assertEqual(contract(value,now=time.time())['budget']['evaluations'],5)
        for changed in ({**value,'version':1},{**value,'seed':True},{**value,'parameters':value['parameters']*6},{**value,'objective':{'kind':'thermoelectric','direction':'maximize','unit':'K'}},{**value,'objective':{**value['objective'],'direction':'target'}}):
            with self.subTest(changed=changed),self.assertRaises(ValueError):contract(changed,now=time.time())
        for key,number in [('evaluations',33),('totalNodeHours',float('nan')),('expiresAtEpoch',0)]:
            changed=copy.deepcopy(value);changed['budget'][key]=number
            with self.assertRaises(ValueError):contract(changed,now=time.time())
        changed=copy.deepcopy(value);changed['parameters'][0]['kind']='integer'
        with self.assertRaises(ValueError):contract(changed,now=time.time())
        with self.assertRaises(ValueError):parameters({'a':4.},value['parameters'])
        self.assertEqual(parameters({'a':5.5},value['parameters']),[.5])

    def test_invalid_observations_rejected_before_gp(self):
        a=approved();self.assertEqual(validate_observation(a,observed()),observed())
        for key,value in [('value',float('nan')),('value',None),('status','failed'),('unit','Ry'),('methodSha256','e'*64),('compositionSha256','e'*64),('conditionsSha256','e'*64),('manifestSha256','invalid')]:
            with self.subTest(key=key),self.assertRaises(ValueError):validate_observation(a,{**observed(),key:value})

    def test_ei_stability_and_deterministic_integer_design_exhaustion(self):
        self.assertGreater(expected_improvement(-2.,.5,-1.),expected_improvement(2.,.5,-1.))
        with self.assertRaises(ValueError):expected_improvement(float('nan'),1.,0.)
        a=approved();a['contract']['parameters']=[{'name':'a','kind':'integer','min':5,'max':6,'unit':'angstrom'}]
        self.assertIsInstance(next_candidate(a,[],[])['a'],int)
        with self.assertRaisesRegex(ValueError,'exhausted'):next_candidate(a,[{'parameters':{'a':5}},{'parameters':{'a':6}}],[])

    @unittest.skipUnless(importlib.util.find_spec('scipy'), 'requires numerical runtime; exercised separately with the numerical test environment')
    def test_real_gp_normalization_ei_minimize_maximize_target_and_replay(self):
        a=approved();candidates=[{'parameters':{'a':5.}},{'parameters':{'a':6.}}]
        obs=[observed(5.,0.),observed(6.,10.)]
        minim=next_candidate(a,candidates,obs)
        self.assertEqual(minim,next_candidate(a,copy.deepcopy(candidates),copy.deepcopy(obs)))
        a['contract']['objective']['direction']='maximize';maxim=next_candidate(a,candidates,obs)
        self.assertLess(minim['a'],maxim['a'])
        a['contract']['objective'].update(direction='target',target=5.)
        target=next_candidate(a,candidates,obs);self.assertTrue(5.<target['a']<6.)
        with patch('backend.local_worker.ai_operator.RbfGaussianProcess.fit',side_effect=ValueError('unstable GP')),self.assertRaises(ValueError):next_candidate(a,candidates,obs)


class DiscoverySupervisorTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        self.services=LocalServices(Path(tmp.name),'http://127.0.0.1:8792','http://127.0.0.1:3000');self.services.compute_enabled=True
        self.services.discovery_runtime=Mock(environment=lambda:{'PHYNITE_RUNTIME_PYTHON_DFT':'/synthetic/runtime/python'})
        self.api=PhyniteApi(self.services);self.ai=AiWorkspace(self.api);self.owner=self.services.owner;self.s=DiscoverySupervisor(self.api)
        self.project=body(self.api.create_project(self.owner,{'name':'Synthetic BO fixture'}))['project']['id']
        self.conversation=self.ai.put(self.owner,'AI_CONVERSATION','aic_bo',{'projectKey':'project:'+self.project,'mode':'approval','activeRunId':'air_bo'})
        self.run=self.ai.put(self.owner,'AI_RUN','air_bo',{'conversationId':'aic_bo','status':'running','expiresAt':int(time.time())+900,'taskMode':'work','modelId':'fixture'})
        self.structure={'name':'Synthetic Si','formula':'Si','lattice':{'a':5.4,'b':5.4,'c':5.4,'alpha':90.,'beta':90.,'gamma':90.},'periodic':[True,True,True],'atoms':[{'species':'Si','x':0.,'y':0.,'z':0.}]}
        self.structure_id=body(self.api.create_structure(self.owner,self.project,self.structure))['structure']['id']
        self.services.update_item(self.owner,'PERSONAL_WORKER','primary',{'lastSeenAtEpoch':int(time.time()),'capabilities':['qe']})
        graph={'version':1,'projectId':self.project,'nodes':[{'id':'s','kind':'structure','name':'Si','position':{'x':0,'y':0},'configuration':{'structure':self.structure},'resources':[{'kind':'structure','id':self.structure_id}]},{'id':'scf','kind':'scf','name':'SCF','position':{'x':300,'y':0},'configuration':{'compilerVersion':1,'draft':{**DEFAULT_QE_DRAFT,'occupationPolicy':'manual','occupations':'fixed','cutoffPolicy':'manual'}},'resources':[]}],'edges':[{'id':'e','source':'s','target':'scf','port':'structure'}],'groups':[]}
        self.s.workflow.save(self.owner,self.project,{'workflow':graph,'baseRevision':0})
        pseudo=patch('backend.local_api.pseudopotentials.execution_pseudopotential_error',return_value=None);pseudo.start();self.addCleanup(pseudo.stop)
        self.data={'revision':1,'target':'scf','contract':definition()}
        self.s.numeric=lambda row,ap: {'a':5.5+len(row['candidates'])*.1}

    def create(self):
        self.run=self.ai.row(self.owner,'AI_RUN',self.run['id'])
        action=self.ai.prepare(self.owner,self.conversation,self.run,{'kind':'start_discovery','stamp':self.ai.context(self.owner,self.conversation)['stamp'],'payload':self.data})
        result=self.ai.execute(self.owner,self.conversation,action,action['payloadHash'])
        self.assertEqual(result['status'],'succeeded',result)
        return self.ai.row(self.owner,'AI_DISCOVERY',result['result']['discoveryId'])

    def advance(self,row,**values):self.s.advance(row,**values);return self.ai.row(self.owner,'AI_DISCOVERY',row['id'])
    def jobs(self):return self.services.list_owner_items(self.owner,'CALCULATION')

    def finish(self,row,success=True):
        job=self.services.get_item(self.owner,'CALCULATION',row['candidates'][-1]['expectedId'])
        log=b'Synthetic numerical fixture only\nconvergence has been achieved\nJOB DONE.\n'
        stage={'stage':'scf','calculationMode':'scf','jobDone':True,'solverError':False,'electronicConvergence':'converged','hybridConvergence':'not-applicable','scfAccuracy':{'status':'verified','residualRy':1e-10,'residualUpperRy':1.1e-10,'thresholdRy':1e-8,'source':'qe-log-bound'}}
        manifest={'version':2,'calculationId':job['id'],'calculationType':job['calculationType'],'status':'completed','summary':{'converged':True,'jobDone':True,'stageConvergence':[stage],'totalEnergyRy':-1.},'artifacts':[{'path':'logs/scf.out','sizeBytes':len(log),'sha256':hashlib.sha256(log).hexdigest(),'contentType':'text/plain','role':'log'}]}
        for path,raw in [('logs/scf.out',log),('result.json',json.dumps(manifest).encode())]:self.services.s3.put_object(Bucket=self.services.bucket,Key=job['outputPrefix']+'/'+path,Body=raw)
        self.services.update_item(self.owner,'CALCULATION',job['id'],{'status':'COMPLETED' if success else 'FAILED'})

    def test_end_to_end_two_immutable_candidates_numeric_observations_and_restart_no_duplicate(self):
        row=self.create();row=self.advance(row);self.assertEqual(len(self.jobs()),1)
        self.assertEqual(self.advance(row)['status'],'executing');self.assertEqual(len(self.jobs()),1)
        self.finish(row);row=self.advance(row);self.assertEqual(len(row['observations']),1)
        row=self.advance(row);self.assertEqual(len(self.jobs()),2)
        self.finish(row);row=self.advance(row);row=self.advance(row);self.assertEqual(row['status'],'completed')
        detail=self.s.read(self.owner,self.conversation,row['id']);self.assertNotRegex(json.dumps(detail),'_requestKey|users/|snapshotKey')
        self.assertAlmostEqual(detail['observations'][0]['value'],-13.605693122994)
        self.assertEqual(len(self.services.list_owner_items(self.owner,'STRUCTURE')),3)
        self.assertEqual(body(self.api.get_structure(self.owner,self.structure_id))['structure']['name'],'Synthetic Si')

    def test_crash_before_and_after_submission_never_duplicate(self):
        row=self.create()
        with patch.object(self.api,'create_calculation',side_effect=SystemExit('crash')):
            with self.assertRaises(SystemExit):self.advance(row)
        row=self.advance(row);self.assertEqual(row['status'],'manual resume required');self.assertFalse(self.jobs())
        row=self.create();create=self.api.create_calculation
        def crash(*args):create(*args);raise SystemExit('after admission')
        with patch.object(self.api,'create_calculation',side_effect=crash):
            with self.assertRaises(SystemExit):self.advance(row)
        self.assertEqual(len(self.jobs()),1);self.advance(row);self.assertEqual(len(self.jobs()),1)

    def test_expiry_scope_cancel_conflict_budget_and_invalid_result(self):
        row=self.create()
        with self.assertRaises(ApiError):self.s.read('other-owner',self.conversation,row['id'])
        with self.assertRaises(ApiError):self.s.cancel(self.owner,self.conversation,row['id'],1)
        row=self.advance(row);self.s.cancel(self.owner,self.conversation,row['id'],row['revision']);row=self.advance(row);row=self.advance(row);self.assertEqual(row['status'],'cancelled')
        row=self.create();row=self.advance(row,now=self.data['contract']['budget']['expiresAtEpoch']+1);self.assertEqual(row['status'],'manual resume required')
        row=self.create();row=self.advance(row);self.finish(row,False);row=self.advance(row);self.assertEqual(row['status'],'manual resume required');self.assertFalse(row['observations'])

    def test_gp_failure_and_canvas_revision_drift_stop_without_submission(self):
        row=self.create();self.s.numeric=Mock(side_effect=ValueError('unstable GP'))
        self.s.tick();self.assertEqual(self.ai.row(self.owner,'AI_DISCOVERY',row['id'])['status'],'manual resume required');self.assertFalse(self.jobs())
        row=self.create();envelope=self.s.workflow.load(self.owner,self.project);self.s.workflow.save(self.owner,self.project,{'workflow':envelope['workflow'],'baseRevision':envelope['revision']})
        self.s.tick();self.assertEqual(self.ai.row(self.owner,'AI_DISCOVERY',row['id'])['status'],'manual resume required');self.assertFalse(self.jobs())

    def test_fresh_approval_required_and_parallel_campaigns_denied(self):
        with self.assertRaises(ApiError):self.s.prepare(self.owner,{**self.conversation,'mode':'full'},self.data)
        row=self.create()
        with self.assertRaises(ApiError):self.s.create(self.owner,self.conversation,{'id':'different'},self.s.workflow.read_json(row['snapshotKey'],row['snapshotSha256']))

    def test_band_gap_scope_and_method_mismatch_are_explicit(self):
        row=self.advance(self.create());self.finish(row)
        ap=self.s.workflow.read_json(row['snapshotKey'],row['snapshotSha256'])
        ap['contract']['objective']={'kind':'dft_band_gap','unit':'eV','direction':'maximize'}
        ap['contract']['conditions']['gapScope']='sampled-k-path'
        job=self.services.get_item(self.owner,'CALCULATION',row['candidates'][-1]['expectedId'])
        key=job['outputPrefix']+'/result.json'
        manifest=json.loads(self.services.s3.get_object(Bucket=self.services.bucket,Key=key)['Body'].read())
        manifest['summary'].update(bandGapEv=1.2,bandGapScope='sampled-k-path',fullBrillouinZoneGapVerified=False)
        self.services.s3.put_object(Bucket=self.services.bucket,Key=key,Body=json.dumps(manifest).encode())
        result=self.s.observation(row,ap,row['candidates'][-1],job)
        self.assertEqual(result['value'],1.2);self.assertEqual(result['unit'],'eV')
        ap['contract']['conditions']['gapScope']='full-brillouin-zone'
        with self.assertRaisesRegex(ValueError,'scope'):self.s.observation(row,ap,row['candidates'][-1],job)
        self.services.s3.put_object(Bucket=self.services.bucket,Key=job['outputPrefix']+'/logs/scf.out',Body=b'tampered evidence')
        with self.assertRaises(ValueError):self.s.observation(row,ap,row['candidates'][-1],job)

    def test_restart_receipt_reconciliation_and_no_concurrent_second_job(self):
        row=self.advance(self.create())
        restarted=DiscoverySupervisor(self.api)
        restarted.numeric=Mock(side_effect=AssertionError('must not acquire while observing'))
        restarted.advance(row)
        self.assertEqual(len(self.jobs()),1)
        row=self.ai.row(self.owner,'AI_DISCOVERY',row['id'])
        future=float(row['candidates'][0]['createdAtEpoch'])+121
        restarted.advance(row,now=future)
        restarted.advance(row,now=future+1)
        self.assertEqual(len(self.jobs()),1)
        self.assertEqual(self.ai.row(self.owner,'AI_DISCOVERY',row['id'])['status'],'manual resume required')

    @unittest.skipUnless(importlib.util.find_spec('scipy'), 'requires the numerical test environment')
    def test_actual_isolated_numerical_acquisition_transport(self):
        from backend.local_api.sandbox import NativeSandbox
        self.services.discovery_runtime=Mock(environment=lambda:{'PHYNITE_RUNTIME_PYTHON_DFT':sys.executable})
        self.services.discovery_runtime.sandbox=NativeSandbox(self.services.data_dir,(Path(__file__).resolve().parents[2]/'backend',Path(sys.prefix)))
        row=self.create()
        ap=self.s.workflow.read_json(row['snapshotKey'],row['snapshotSha256'])
        value=DiscoverySupervisor(self.api).numeric(row,ap)
        self.assertEqual(value,{'a':5.5})
