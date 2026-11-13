"""Persistent v2 BO supervisor. Numerical acquisition runs only in isolated scientific Python."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import threading
import time

from backend.local_worker.ai_discovery import contract, parameters, sha, validate_observation
from backend.local_api.domain.ai_workspace import AiWorkspace, fail
from backend.local_api.domain.project_workflow import ProjectWorkflowApi
from backend.local_api.domain.workflow_compiler import invoke, compiler_source
from backend.local_api.domain.workflow_structure import lattice_vectors
from backend.local_api.domain.result_artifacts import read_result_manifest
from backend.local_api.domain.dft_validation import dft_result_error
from backend.local_api.domain.phynite_core import json_safe
from backend.local_api.domain.elements import ELEMENT_SYMBOLS

RY_TO_EV = 13.605693122994
TERMINAL = {'completed', 'cancelled', 'manual resume required'}


class DiscoverySupervisor:
    def __init__(self, api):
        self.api=api; self.services=api.services; self.ai=AiWorkspace(api); self.workflow=ProjectWorkflowApi(api); self.lock=threading.Lock()

    def prepare(self, owner, conversation, data):
        if conversation['mode']!='approval': fail(403,'Discovery v2 needs Ask for approval for its complete bounded design space.','DISCOVERY_APPROVAL_REQUIRED')
        project=self.ai.scope(owner,conversation['projectKey'])
        if not project or project['kind']!='canvas' or not getattr(self.services,'local_workspace',False): fail(422,'Save a local Canvas project before starting Discovery.','DISCOVERY_PROJECT_REQUIRED')
        runtime=getattr(self.services,'discovery_runtime',None)
        if not runtime or not runtime.environment().get('PHYNITE_RUNTIME_PYTHON_DFT'): fail(422,'Install the reviewed scientific DFT runtime before Discovery.','DISCOVERY_RUNTIME_REQUIRED')
        try: c=contract(data.get('contract'),now=time.time())
        except (ValueError,KeyError,TypeError) as error: fail(422,str(error),'DISCOVERY_CONTRACT_INVALID')
        plan,graph=self.workflow.plan(owner,project['id'],{'revision':data.get('revision'),'targets':[data.get('target')],'rerun':[data.get('target')]})
        node=next((node for node in graph['nodes'] if node['id']==data['target']),None)
        kind='scf' if c['objective']['kind']=='dft_energy_per_atom' else 'bands'
        if plan['errors'] or not node or node['kind']!=kind or node['configuration'].get('compilerVersion')!=1 or node['configuration'].get('computeTarget','personal')!='personal': fail(422,'Choose a validated compiled personal-compute SCF/bands node matching the objective.','DISCOVERY_TARGET_INVALID')
        incoming=[edge for edge in graph['edges'] if edge['target']==node['id']]
        source=next((item for item in graph['nodes'] if len(incoming)==1 and incoming[0]['port']=='structure' and item['id']==incoming[0]['source'] and item['kind']=='structure'),None)
        refs=source.get('resources',[]) if source else []
        ref=next((item for item in refs if item['kind']=='structure'),None)
        if not ref: fail(422,'Discovery needs one direct immutable saved structure; review prerequisite calculations separately.','DISCOVERY_TARGET_INVALID')
        item=self.ai.row(owner,'STRUCTURE',ref['id'])
        if item['projectId']!=project['id']: fail(404,'Source structure is outside this project.','AI_NOT_FOUND')
        raw=self.services.s3.get_object(Bucket=self.services.bucket,Key=item['objectKey'])['Body'].read(5_000_001)
        if len(raw)>5_000_000 or hashlib.sha256(raw).hexdigest()!=item.get('sha256') or ref.get('sha256',item['sha256'])!=item['sha256']: fail(409,'Source structure checksum changed.','DISCOVERY_SOURCE_CHANGED')
        structure=json.loads(raw)
        if not 1 <= len(structure.get('atoms',[])) <= 256 or any(atom.get('species') not in ELEMENT_SYMBOLS or atom.get('occupancy',1)!=1 or atom.get('siteSpecies') and (len(atom['siteSpecies'])!=1 or atom['siteSpecies'][0].get('element')!=atom['species'] or atom['siteSpecies'][0].get('occupancy')!=1) for atom in structure['atoms']): fail(422,'Discovery needs at most 256 fully occupied explicit atoms at fixed composition.','DISCOVERY_STRUCTURE_INVALID')
        if any(field not in structure['lattice'] for field in ('a','b','c','alpha','beta','gamma')) or structure.get('periodic',structure['lattice'].get('periodic')) != [True,True,True]: fail(422,'The first Discovery evaluator requires explicit full periodicity and lattice metrics.','DISCOVERY_STRUCTURE_INVALID')
        draft=node['configuration']['draft']
        if draft.get('occupationPolicy')!='manual' or draft.get('cutoffPolicy')!='manual': fail(422,'Set explicit manual occupations and cutoffs before BO so the numerical method cannot change with candidate geometry.','DISCOVERY_METHOD_INVALID')
        compiler={'source':compiler_source(),'sha256':hashlib.sha256(compiler_source().encode()).hexdigest()}
        example=invoke('compileBoundDft',[graph,node['id'],structure,item['id']],compiler)
        if example.get('executionAffinity') or example.get('computeTarget','personal')!='personal': fail(422,'Discovery uses the reviewed personal allocation.','DISCOVERY_METHOD_INVALID')
        allocation={'vcpus':example.get('vcpus',1),'memoryMiB':example.get('memoryMiB',2048)}
        cost=c['budget']['evaluations']*c['budget']['wallSeconds']*allocation['vcpus']/3600
        if cost>c['budget']['totalNodeHours']+1e-12: fail(422,'The budget must cover the worst-case allocation for all approved evaluations.','DISCOVERY_BUDGET_INVALID')
        return {'schemaVersion':2,'projectId':project['id'],'revision':data['revision'],'target':data['target'],'contract':c,'workflow':graph,'structure':structure,'sourceId':item['id'],'sourceSha256':item['sha256'],'compiler':compiler,'allocation':allocation,'methodSha256':sha([draft,example.get('pseudopotentials'),compiler['sha256']]),'compositionSha256':sha(sorted(atom['species'] for atom in structure['atoms'])),'conditionsSha256':sha(c['conditions'])}

    def create(self, owner, conversation, action, approved):
        identifier='aibo_'+sha([owner,action['id']])[:32]
        existing=self.services.get_item(owner,'AI_DISCOVERY',identifier)
        if existing:
            if existing['approvalHash']!=sha(approved): fail(409,'Discovery approval changed.','DISCOVERY_CONFLICT')
            return {'discoveryId':identifier,'status':existing['status']}
        with self.services.table.atomic():
            if any(row.get('status')=='executing' for row in self.services.list_owner_items(owner,'AI_DISCOVERY')): fail(409,'Finish or cancel the active BO campaign before starting another.','DISCOVERY_ACTIVE')
            key,checksum=self.workflow.write_json(owner,approved['projectId'],'discovery',approved)
            self.ai.put(owner,'AI_DISCOVERY',identifier,{'GSI1PK':'PROJECT#'+approved['projectId'],'GSI1SK':'AI_DISCOVERY#'+identifier,'schemaVersion':2,'projectId':approved['projectId'],'conversationId':conversation['id'],'approvalHash':sha(approved),'snapshotKey':key,'snapshotSha256':checksum,'status':'executing','leaseUntil':0,'candidates':[],'observations':[],'usedNodeHours':0.,'cancelRequested':False})
        return {'discoveryId':identifier,'status':'executing'}

    def scoped(self,owner,conversation,identifier):
        row=json_safe(self.ai.row(owner,'AI_DISCOVERY',identifier)); project=self.ai.scope(owner,conversation['projectKey'])
        if not project or row['projectId']!=project['id'] or row['conversationId']!=conversation['id']: fail(404,'Discovery is outside this conversation/project.','AI_NOT_FOUND')
        return row

    def read(self,owner,conversation,identifier):
        row=self.scoped(owner,conversation,identifier)
        approved=self.workflow.read_json(row['snapshotKey'],row['snapshotSha256'])
        if sha(approved)!=row['approvalHash']: fail(409,'Discovery approval checksum changed.','DISCOVERY_CONFLICT')
        result={key:row[key] for key in ('id','schemaVersion','status','revision','usedNodeHours','reason','cancelRequested','observations') if key in row}
        result.update(contract=approved['contract'],methodSha256=approved['methodSha256'],sourceSha256=approved['sourceSha256'],candidates=[{key:value for key,value in item.items() if not key.startswith('_')} for item in row['candidates']])
        return result

    def cancel(self,owner,conversation,identifier,revision):
        row=self.scoped(owner,conversation,identifier)
        if type(revision) is not int or revision!=row['revision']: fail(409,'Read the latest Discovery revision before cancelling.','DISCOVERY_CONFLICT')
        if row['status'] not in TERMINAL:self.update(row,cancelRequested=True)
        return {'discoveryId':identifier,'cancelRequested':True}

    def update(self,row,**values): return json_safe(self.ai.update(row['ownerId'],'AI_DISCOVERY',row,values))

    def numeric(self,row,approved):
        runtime=getattr(self.services,'discovery_runtime',None)
        python=(runtime.environment() if runtime else {}).get('PHYNITE_RUNTIME_PYTHON_DFT')
        if not python: raise ValueError('The approved numerical runtime is unavailable.')
        directory=self.services.data_dir/'work/discovery'/row['id']/str(len(row['candidates']));directory.mkdir(parents=True,exist_ok=True)
        source=Path(__file__).resolve().parents[2]/'local_worker/ai_discovery.py'
        runtime.sandbox.read_roots+=(source.parent,)
        state=directory/'state.json';result=directory/'next.json'
        state.write_text(json.dumps({'approved':approved,'candidates':row['candidates'],'observations':row['observations']},allow_nan=False))
        command=runtime.sandbox.command(directory,[python,'-I',str(source),str(state),str(result)])
        with (directory/'numerical.log').open('w') as output:
            subprocess.run(command,cwd=directory,env={'PATH':'/usr/bin:/bin','HOME':str(directory),'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'},stdout=output,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,timeout=30,check=True)
        value=json.loads(result.read_text())['parameters'];parameters(value,approved['contract']['parameters']);return value

    def candidate_request(self,row,approved,values):
        parameters(values,approved['contract']['parameters'])
        structure=copy.deepcopy(approved['structure']);structure['lattice'].update(values);structure['lattice'].pop('vectors',None)
        lattice_vectors(structure['lattice'])  # actual nonorthogonal cell validation
        for key in ('provenance','sourceData','bandGap','electronicReference','externalId','sourceUrl','spaceGroup'):structure.pop(key,None)
        structure.update(name='Discovery candidate '+str(len(row['candidates'])+1),source='Phynite Discovery',spaceGroup='P1',parentStructureId=approved['sourceId'],parentStructureSha256=approved['sourceSha256'])
        identifier='str_'+sha([row['id'],values])[:32]
        key,checksum=self.workflow.write_json(row['ownerId'],row['projectId'],'discovery-structures',structure)
        existing=self.services.get_item(row['ownerId'],'STRUCTURE',identifier)
        if existing and existing.get('sha256')!=checksum: raise ValueError('Candidate structure identity changed.')
        if not existing:self.workflow.put_new(row['ownerId'],'STRUCTURE',identifier,{'projectId':row['projectId'],'name':structure['name'],'formula':structure.get('formula',''),'objectKey':key,'sha256':checksum,'atomCount':len(structure['atoms']),'status':'READY'})
        request=invoke('compileBoundDft',[approved['workflow'],approved['target'],structure,identifier],approved['compiler'])
        request.update(approved['allocation']);request.update(computeTarget='personal',run=True,idempotencyKey='bo_'+sha([row['id'],len(row['candidates'])])[:48])
        return request

    def observation(self,row,approved,candidate,job):
        if job['status']!='COMPLETED': raise ValueError('Failed/cancelled calculations are not observations.')
        manifest,manifest_sha=read_result_manifest(self.services,job)
        error=dft_result_error(manifest,job['calculationType'])
        if error: raise ValueError(error)
        request=self.workflow.read_json(candidate['_requestKey'],candidate['_requestSha256'])
        raw=self.services.s3.get_object(Bucket=self.services.bucket,Key=job['inputKey'])['Body'].read(4_500_001)
        source=json.loads(raw)
        if len(raw)>4_500_000 or source.get('calculationId')!=job['id'] or source.get('projectId')!=row['projectId'] or any(sha(source.get(key))!=sha(request.get(key)) for key in ('qeInput','inputFiles','structureId','calculationType','settings')): raise ValueError('The retained job input differs from the reviewed candidate method.')
        from backend.local_api.domain.ai_readers import AiReaders
        _,files=AiReaders(self.ai).inventory(row['ownerId'],{'projectKey':'project:'+row['projectId']},{'resourceKind':'calculation','resourceId':job['id']})
        evidence=[]
        for file in files:
            if '_key' not in file or not file['path'].endswith(('.out','.xml','.dat','.json')): continue
            if file['sizeBytes']>8_000_000: raise ValueError('Numerical source exceeds the verified observation budget.')
            data=self.services.s3.get_object(Bucket=self.services.bucket,Key=file['_key'])['Body'].read(8_000_001)
            if len(data)!=file['sizeBytes'] or hashlib.sha256(data).hexdigest()!=file['sha256']: raise ValueError('Numerical source checksum changed.')
            evidence.append({key:file[key] for key in ('path','sha256')})
        if not any(file['path'].endswith('.out') for file in evidence):raise ValueError('Retained solver evidence is missing.')
        summary=manifest['summary'];objective=approved['contract']['objective']
        if objective['kind']=='dft_energy_per_atom':
            energy=summary.get('totalEnergyRy')
            if type(energy) not in {int,float}:raise ValueError('Finite total energy in Ry is missing.')
            value=energy*RY_TO_EV/len(approved['structure']['atoms'])
        else:
            scope=approved['contract']['conditions']['gapScope']
            if summary.get('bandGapScope')!=scope or scope=='full-brillouin-zone' and summary.get('fullBrillouinZoneGapVerified') is not True:raise ValueError('Band-gap sampling scope is not numerically verified; a sampled path does not establish a full-zone gap.')
            value=summary.get('bandGapEv')
        observation={'status':'completed','parameters':candidate['parameters'],'jobId':job['id'],'candidateIndex':len(row['candidates'])-1,'kind':objective['kind'],'unit':objective['unit'],'value':value,'manifestSha256':manifest_sha,'inputSha256':hashlib.sha256(raw).hexdigest(),'evidence':evidence,**{key:approved[key] for key in ('methodSha256','compositionSha256','conditionsSha256')}}
        return validate_observation(approved,observation)

    def advance(self,supplied,*,now=None):
        now=time.time() if now is None else float(now);row=json_safe(self.ai.row(supplied['ownerId'],'AI_DISCOVERY',supplied['id']))
        if row['status'] in TERMINAL or row.get('leaseUntil',0)>now:return
        row=self.update(row,leaseUntil=now+90)
        approved=self.workflow.read_json(row['snapshotKey'],row['snapshotSha256']);c=approved['contract']
        if sha(approved)!=row['approvalHash']:raise ValueError('Discovery approval changed.')
        active=row['candidates'][-1] if len(row['candidates'])>len(row['observations']) else None
        if active:
            job=self.services.get_item(row['ownerId'],'CALCULATION',active['expectedId'])
            if not job:self.update(row,status='manual resume required',reason='Submission receipt is uncertain; no automatic resubmission.',leaseUntil=0);return
            if job.get('projectId')!=row['projectId'] or job.get('ownerId')!=row['ownerId']:raise ValueError('Candidate receipt scope changed.')
            if job['status'] not in {'COMPLETED','FAILED','CANCELLED'}:
                running=job['status'] in {'RUNNING','CANCEL_REQUESTED'};clock='runningSinceEpoch' if running else 'queuedSinceEpoch';active.setdefault(clock,now if running else active['createdAtEpoch'])
                if row['cancelRequested'] or now-active[clock]>=c['budget']['wallSeconds' if running else 'queueSeconds']:
                    active['budgetStopped']=not row['cancelRequested'];self.api.cancel_calculation(row['ownerId'],job['id'])
                self.update(row,candidates=row['candidates'],leaseUntil=0);return
            if row['cancelRequested'] or active.get('budgetStopped') or job['status']!='COMPLETED':self.update(row,status='cancelled' if row['cancelRequested'] else 'manual resume required',reason='Candidate failed, was cancelled or exhausted its reviewed budget; no observation accepted.',leaseUntil=0);return
            observation=self.observation(row,approved,active,job);active['phase']='validated'
            self.update(row,candidates=row['candidates'],observations=[*row['observations'],observation],leaseUntil=0);return
        if row['cancelRequested'] or now>=c['budget']['expiresAtEpoch']:
            self.update(row,status='cancelled' if row['cancelRequested'] else 'manual resume required',reason='Cancelled or approval expired; no new candidate submitted.',leaseUntil=0);return
        if len(row['candidates'])>=c['budget']['evaluations']:self.update(row,status='completed',leaseUntil=0);return
        cost=c['budget']['wallSeconds']*approved['allocation']['vcpus']/3600
        if row['usedNodeHours']+cost>c['budget']['totalNodeHours']+1e-12:raise ValueError('Node-hour budget exhausted.')
        if self.workflow.load(row['ownerId'],row['projectId'])['revision']!=approved['revision']:raise ValueError('Canvas changed; review a new Discovery campaign.')
        if not getattr(self.services,'compute_enabled',False):self.update(row,reason='Waiting for the approved personal worker.',leaseUntil=0);return
        values=self.numeric(row,approved)
        if any(sha(values)==sha(item['parameters']) for item in row['candidates']):raise ValueError('The acquisition repeated a candidate; no duplicate was submitted.')
        request=self.candidate_request(row,approved,values);key,checksum=self.workflow.write_json(row['ownerId'],row['projectId'],'discovery',request)
        expected='calc_'+hashlib.sha256(f"{row['ownerId']}:{request['idempotencyKey']}".encode()).hexdigest()[:32]
        candidate={'parameters':values,'phase':'submission-intent','expectedId':expected,'requestSha256':sha(request),'createdAtEpoch':now,'_requestKey':key,'_requestSha256':checksum}
        row=self.update(row,candidates=[*row['candidates'],candidate],usedNodeHours=row['usedNodeHours']+cost,leaseUntil=0)
        current=json_safe(self.ai.row(row['ownerId'],'AI_DISCOVERY',row['id']))
        if current['cancelRequested']:self.update(current,status='cancelled',leaseUntil=0);return
        if current['revision']!=row['revision']:raise ValueError('Discovery changed before submission.')
        self.api.create_calculation(row['ownerId'],row['projectId'],request)
        candidate['phase']='submitted';self.update(row,candidates=[*row['candidates'][:-1],candidate])

    def tick(self):
        if not self.lock.acquire(blocking=False):return
        try:
            for row in self.services.list_owner_items(self.services.owner,'AI_DISCOVERY'):
                if row.get('schemaVersion')!=2 or row.get('status') in TERMINAL:continue
                try:self.advance(row)
                except Exception as error:
                    current=self.ai.row(self.services.owner,'AI_DISCOVERY',row['id'])
                    self.update(current,status='manual resume required',reason=(str(error) if isinstance(error, ValueError) else 'GP, scientific evidence or submission could not be verified. Inspect retained candidates, observations and local numerical logs; no fallback or retry was submitted.'),leaseUntil=0)
        finally:self.lock.release()
