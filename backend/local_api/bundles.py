"""Development-only portable input import. Validate first, publish metadata atomically."""
from __future__ import annotations
import boto3
import base64
import copy
import hashlib
import json
import re
import uuid
from typing import Any
from boto3.dynamodb.types import TypeSerializer
from backend.local_api.domain.phynite_core import ApiError, dynamo_safe, owner_partition, storage_owner, utc_now
from backend.local_api.domain.project_workflow import ProjectWorkflowApi, validate_graph, encoded, RESOURCE_KINDS
from backend.local_api.domain.workflow_structure import lattice_vectors

def invalid(message: str):
    raise ApiError(400, message, 'INVALID_DRAFT_BUNDLE')

def prepare_bundle(payload: dict[str, Any], owner: str):
    if payload.get('format') != 'phynite-workflow-draft' or payload.get('version') != 1:
        invalid('Choose a Phynite workflow draft version 1.')
    name=payload.get('name')
    if not isinstance(name,str) or not 1<=len(name.strip())<=140:invalid('Project name must contain 1–140 characters.')
    graph=payload.get('workflow');source=graph.get('projectId') if isinstance(graph,dict) else None
    graph=validate_graph(graph,source)
    inputs=payload.get('inputs')
    if not isinstance(inputs,list) or len(inputs)>80:invalid('A bundle supports up to 80 input files.')
    resources={};total=0
    for item in inputs:
        if not isinstance(item,dict) or item.get('kind') not in {'structure','trajectory'} or not isinstance(item.get('id'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',item['id']):invalid('Invalid input identity.')
        key=(item['kind'],item['id'])
        if key in resources:invalid('Duplicate input identity.')
        try:raw=base64.b64decode(item['bytes'],validate=True)
        except (ValueError,TypeError,KeyError):invalid('Input data is not valid base64.')
        total+=len(raw)
        if total>48*1024**2 or hashlib.sha256(raw).hexdigest()!=item.get('sha256'):invalid('Input checksum failed or bundle exceeds 48 MiB.')
        filename=item.get('filename','input')
        if not isinstance(filename,str) or not re.fullmatch(r'[A-Za-z0-9_.+ -]{1,180}',filename) or '..' in filename:invalid('Invalid input filename.')
        if key[0]=='structure':
            try:
                doc=json.loads(raw);vectors=lattice_vectors(doc['lattice']);atoms=doc['atoms']
                if not isinstance(atoms,list) or not 1<=len(atoms)<=50000:invalid('A structure needs 1–50,000 atoms.')
                import math
                if any(not math.isfinite(float(v)) for row in vectors for v in row):invalid('Invalid cell.')
                a,b,c=vectors
                if abs(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))<1e-12:invalid('Singular cell.')
                if any(not isinstance(atom,dict) or not isinstance(atom.get('species'),str) or any(not math.isfinite(float(atom[axis])) for axis in ('x','y','z')) for atom in atoms):invalid('Invalid atom coordinates.')
                periodic=doc['lattice'].get('periodic')
                if periodic is not None and (len(periodic)!=3 or any(type(axis)is not bool for axis in periodic)):invalid('Invalid periodicity.')
            except (ValueError,KeyError,TypeError):invalid('Invalid structure input.')
        resources[key]=(item,raw)
    project='prj_'+uuid.uuid4().hex;mapping={node['id']:'node_'+uuid.uuid4().hex for node in graph['nodes']};mapping[source]=project
    resource_map={key:'str_'+uuid.uuid4().hex if key[0]=='structure' else 'mdt_'+uuid.uuid4().hex for key in resources}
    mapping.update({key[1]:value for key,value in resource_map.items()})
    groups={group['id']:'group_'+uuid.uuid4().hex for group in graph['groups']};mapping.update(groups)
    def remap_config(value,key=''):
        # Only explicit references change. Scientific labels/species/raw input are data,
        # even when a user happened to give a node the same textual ID.
        if isinstance(value,str) and key in {'nodeId','sourceId','structureId','trajectoryId','assetId','projectId','inputTrajectoryId','potentialAssetId'}:return mapping.get(value,value)
        if isinstance(value,list):return [remap_config(item,key) for item in value]
        if isinstance(value,dict):return {field:remap_config(item,field) for field,item in value.items()}
        return value
    missing=[]
    for node in graph['nodes']:
        refs=[];node_missing=[]
        for ref in node['resources']:
            key=(ref['kind'],ref['id'])
            if key in resources:
                item,raw=resources[key]
                if ref.get('sha256') and ref['sha256']!=item['sha256']:invalid('Resource checksum differs from input.')
                refs.append({'kind':key[0],'id':resource_map[key],'sha256':item['sha256']})
            else:node_missing.append({'kind':key[0],'id':key[1],'reason':'Reconnect or import this input in the new environment.'})
        config=node['configuration']
        for filename in config.get('pseudopotentials',{}):node_missing.append({'kind':'pseudopotential','id':filename,'reason':'Select a verified local pseudopotential.'})
        for field in ('legacySource','preservedHistory','savedStructureSignature','configurationError','pseudopotentials','pseudopotentialChecksums'):
            config.pop(field,None)
        if node['kind']=='md-analysis' and isinstance(config.get('execution'),dict):config['execution']={key:value for key,value in config['execution'].items() if key in {'pipeline','name','computeTarget'}}
        else:config.pop('execution',None)
        if node['kind']=='figure':node['configuration']={'style':config.get('style',{})}
        node['resources']=refs;node.pop('legacy',None)
        # A failed input remains visible but cannot silently become executable.
        old_missing=config.get('missingInputs',[])
        if not isinstance(old_missing,list) or len(old_missing)>100 or any(not isinstance(item,dict) or any(not isinstance(item.get(field),str) or len(item[field])>500 for field in ('id','kind','reason')) for item in old_missing):invalid('Invalid missing input descriptions.')
        node_missing.extend(copy.deepcopy(old_missing))
        if node_missing:node['configuration']['missingInputs']=node_missing;missing.extend({'nodeId':mapping[node['id']],**item} for item in node_missing)
    for node in graph['nodes']:
        node['id']=mapping[node['id']]
        node['configuration']=remap_config(node['configuration'])
        if node.get('groupId'):node['groupId']=groups[node['groupId']]
    for edge in graph['edges']:edge.update(id='edge_'+uuid.uuid4().hex,source=mapping[edge['source']],target=mapping[edge['target']])
    for group in graph['groups']:group.update(id=groups[group['id']],nodeIds=[mapping[item] for item in group['nodeIds']])
    graph['projectId']=project
    return name.strip(),graph,resources,resource_map,missing

def import_bundle(api:Any,owner:str,payload:dict[str,Any]):
    name,graph,resources,resource_map,missing=prepare_bundle(payload,owner)
    project=graph['projectId'];now=utc_now();staged=[];records=[]
    def record(kind,id,values):
        return {'PK':owner_partition(owner),'SK':kind+'#'+id,'id':id,'entityType':kind,'ownerId':owner,'createdAt':now,'updatedAt':now,**values}
    try:
        for key,(item,raw) in resources.items():
            resource=resource_map[key];path=f'users/{storage_owner(owner)}/projects/{project}/inputs/{resource}/{item["filename"]}'
            api.services.s3.put_object(Bucket=api.services.bucket,Key=path,Body=raw,ContentType='application/json' if key[0]=='structure' else 'application/octet-stream',ServerSideEncryption='AES256');staged.append(path)
            kind=RESOURCE_KINDS[key[0]]
            values={'projectId':project,'GSI1PK':'PROJECT#'+project,'GSI1SK':f'{kind}#{now}#{resource}','objectKey':path,'filename':item['filename'],'name':item['filename'],'sha256':item['sha256'],'sizeBytes':len(raw),'status':'READY','uploadedAt':now}
            if key[0]=='trajectory':values.update(format=item['filename'].rsplit('.',1)[-1],contentType='application/octet-stream')
            else:values['atomCount']=len(json.loads(raw)['atoms'])
            records.append(record(kind,resource,values))
        workflow=ProjectWorkflowApi(api);path,sha=workflow.write_json(owner,project,'revisions',graph);staged.append(path)
        records.extend([record('PROJECT',project,{'name':name,'description':'Imported local draft','tags':[]}),record('PROJECT_WORKFLOW',project,{'projectId':project,'objectKey':path,'sha256':sha,'revision':1})])
        serializer=TypeSerializer();writes=[{'Put':{'TableName':api.services.table.name,'Item':{key:serializer.serialize(dynamo_safe(value)) for key,value in item.items()},'ConditionExpression':'attribute_not_exists(PK)'}} for item in records]
        __import__("backend.local_api.domain.phynite_core", fromlist=["transaction_client"]).transaction_client(api.services).transact_write_items(TransactItems=writes)
    except Exception:
        for path in staged:
            try:api.services.s3.delete_object(Bucket=api.services.bucket,Key=path)
            except Exception:pass
        raise
    return {'project':{'id':project,'name':name},'workflow':graph,'revision':1,'missingInputs':missing}
