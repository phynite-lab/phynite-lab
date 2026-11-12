"""Scientific actions computed and verified server-side, then fenced by AI_ACTION."""
from __future__ import annotations

import base64
import copy
import hashlib
import re

from backend.local_api.domain.ai_workspace import body, digest, fail, valid_id
from backend.local_api.domain.phynite_core import ApiError, storage_owner, utc_now


def modification(ai, owner, conversation, data, *, preparing=False):
    fields = {'target', 'name', 'modifiers'}
    if not preparing:
        fields |= {'sourceSha256', 'result'}
    if set(data) != fields or not isinstance(data.get('name'), str) or not 1 <= len(data['name'].strip()) <= 140:
        fail(400, 'A structure modification needs a name, exact target and supported modifiers.', 'AI_STRUCTURE_INVALID')
    target = data.get('target')
    if not isinstance(target, dict):
        fail(400, 'Choose a saved material or Canvas structure node.', 'AI_STRUCTURE_INVALID')
    project = ai.scope(owner, conversation['projectKey'])
    if target.get('kind') == 'material' and set(target) == {'kind', 'materialId'} and project['kind'] == 'dft':
        source = ai.resource(owner, conversation, 'material', valid_id(target['materialId']))['item']
    elif target.get('kind') == 'canvas_node' and set(target) == {'kind', 'nodeId', 'baseRevision'} and project['kind'] == 'canvas':
        from backend.local_api.domain.project_workflow import ProjectWorkflowApi
        envelope = ProjectWorkflowApi(ai.api).load(owner, project['id'])
        if type(target['baseRevision']) is not int or target['baseRevision'] != envelope['revision']:
            fail(409, 'The Canvas changed. Read its current revision.', 'AI_CONTEXT_CHANGED')
        node = next((node for node in envelope['workflow']['nodes'] if node['id'] == target['nodeId'] and node['kind'] == 'structure'), None)
        if not node or not isinstance(node['configuration'].get('structure'), dict):
            fail(404, 'Choose a saved Canvas crystal structure node.', 'AI_NOT_FOUND')
        source = node['configuration']['structure']
    else:
        fail(400, 'Choose a material in this DFT project or a structure node in this Canvas.', 'AI_STRUCTURE_INVALID')
    from backend.local_api.domain.workflow_compiler import invoke
    result = invoke('modifyAiStructure', [source, data['modifiers']])
    result['parentStructureSha256'] = digest(source)
    if source.get('provenance'):
        result['parentProvenance'] = source['provenance']
    if preparing:
        data.update({'sourceSha256': digest(source), 'result': result})
    elif data['sourceSha256'] != digest(source) or data['result'] != result:
        fail(409, 'The source geometry or compiled modification changed. Prepare a fresh action.', 'AI_CONTEXT_CHANGED')
    return source


def perform_modification(ai, owner, conversation, action, data):
    project = ai.scope(owner, conversation['projectKey'])
    with ai.services.table.atomic():
        modification(ai, owner, conversation, data)
        if data['target']['kind'] == 'material':
            from backend.local_api.domain.workflow_structure import lattice_vectors
            workspace = ai.workspace(owner)
            if workspace['revision'] != action['workspaceRevision']:
                fail(409, 'The workspace changed. Prepare a fresh modification.', 'AI_CONTEXT_CHANGED')
            snapshot = copy.deepcopy(workspace['workspace'])
            source = next(item for item in snapshot['materials'] if item['id'] == data['target']['materialId'])
            material = {**source, **data['result'], 'id': action['id'], 'name': data['name'],
                        'cellVectors': lattice_vectors(data['result']['lattice']), 'createdAt': utc_now(), 'updatedAt': utc_now()}
            for key in ('remoteId', 'sourceData', 'externalId', 'sourceUrl', 'provenance'):
                material.pop(key, None)
            snapshot['materials'].append(material)
            snapshot['savedAt'] = utc_now()
            ai.api.put_workspace(owner, {'workspace': snapshot, 'baseRevision': workspace['revision']})
            return {'saved': True, 'materialId': material['id'], 'sourceSha256': data['sourceSha256']}
        from backend.local_api.domain.project_workflow import ProjectWorkflowApi
        service = ProjectWorkflowApi(ai.api)
        envelope = service.load(owner, project['id'])
        graph = copy.deepcopy(envelope['workflow'])
        node = next(node for node in graph['nodes'] if node['id'] == data['target']['nodeId'])
        parent_ref = next((ref for ref in node['resources'] if ref['kind'] == 'structure'), None)
        if parent_ref is None:
            # Inline saved crystals may not yet have an immutable resource.
            # Retain that source before replacing the node's geometry.
            parent = body(ai.api.create_structure(owner, project['id'], node['configuration']['structure']))['structure']
            parent_ref = {'id': parent['id'], 'sha256': parent['sha256']}
        # A derived structure retains its parent identity as provenance, never as
        # a claim that the new coordinates are the original database bytes.
        document = {**data['result'], 'name': data['name'], 'parentStructureSha256': data['sourceSha256'], 'parentStructureId': parent_ref['id'], 'parentResourceSha256': parent_ref.get('sha256')}
        created = body(ai.api.create_structure(owner, project['id'], document))['structure']
        node.update({'name': data['name'], 'configuration': {**node['configuration'], 'structure': document},
                     'resources': [{'kind': 'structure', 'id': created['id'], 'sha256': created['sha256']}]})
        saved = service.save(owner, project['id'], {'workflow': graph, 'baseRevision': data['target']['baseRevision']})
    return {'saved': True, 'revision': saved['revision'], 'nodeId': node['id'], 'structureId': created['id'], 'parentStructureId': parent_ref['id'], 'sourceSha256': data['sourceSha256']}


def potential_provenance_summary(provenance):
    result = {key: provenance[key] for key in ('provider', 'sourceUrl', 'modelVersion', 'packageSha256', 'files', 'runtimeInterpretation') if key in provenance}
    if provenance.get('licenseText'):
        result.update({'licenseTextSha256': hashlib.sha256(provenance['licenseText'].encode()).hexdigest(), 'licenseTextRetained': True})
    return result


def stage_potential(ai, owner, conversation, action_id, data):
    from backend.local_api.domain.potential_catalog import checked_elements, ingest_files
    project = ai.scope(owner, conversation['projectKey'])
    if not project.get('remoteId'):
        fail(409, 'Save a project before importing a potential.', 'AI_PROJECT_REQUIRED')
    if set(data) - {'provider', 'identifier', 'elements', 'libraryElementOrder', 'name'}:
        fail(400, 'Import a repository identifier, not a URL or file location.', 'AI_POTENTIAL_INVALID')
    if data.get('provider') not in {'nist', 'openkim'} or not isinstance(data.get('identifier'), str) or not 1 <= len(data['identifier']) <= 300:
        fail(400, 'Choose a versioned NIST or OpenKIM identifier.', 'AI_POTENTIAL_INVALID')
    try:
        checked_elements(data.get('elements'))
        if len(data['elements']) > 10:
            raise ValueError('Choose up to ten mapped elements.')
        model, files, provenance = ingest_files(data['provider'], data['identifier'], data['elements'], data.get('libraryElementOrder'))
    except (ValueError, TypeError, KeyError) as exc:
        raise ApiError(400, str(exc), 'AI_POTENTIAL_INVALID') from exc
    except Exception as exc:
        raise ApiError(502, 'The public potential repository is unavailable. Retry its search later.', 'AI_POTENTIAL_UNAVAILABLE') from exc
    if not set(data['elements']).issubset(model['elements']):
        fail(409, 'The selected model does not cover every mapped element.', 'AI_POTENTIAL_INVALID')
    metadata = {key: model[key] for key in ('family', 'elements', 'citation', 'license', 'modelVersion', 'validityDomain')}
    metadata['name'] = data.get('name', model['title'][:160])
    if not isinstance(metadata['name'], str) or not 1 <= len(metadata['name'].strip()) <= 160:
        fail(400, 'Choose a potential name of 1–160 characters.', 'AI_POTENTIAL_INVALID')
    if model['family'] == 'meam':
        metadata['libraryElementOrder'] = model['libraryElementOrder']
    staged = []
    for index, (filename, raw) in enumerate(files):
        sha = hashlib.sha256(raw).hexdigest()
        key = f'users/{storage_owner(owner)}/ai/potentials/{action_id}/{index}'
        ai.services.s3.put_object(Bucket=ai.services.bucket, Key=key, Body=raw, ContentType='application/octet-stream')
        staged.append({'filename': filename, 'sizeBytes': len(raw), 'sha256': sha, 'objectKey': key,
                       'role': ('library' if re.search(r'library|meam\.lib', filename, re.I) else 'parameter') if model['family'] == 'meam' else 'potential'})
    metadata['files'] = [{key: value for key, value in file.items() if key != 'objectKey'} for file in staged]
    from backend.local_api.domain.api import normalize_md_potential_files
    normalize_md_potential_files(metadata['files'], metadata['family'])
    return {'metadata': metadata, 'stagedFiles': staged, 'provenance': provenance, 'requestedElements': data['elements']}


def validate_staged_potential(ai, owner, conversation, data):
    project = ai.scope(owner, conversation['projectKey'])
    if not project.get('remoteId') or set(data) != {'metadata', 'stagedFiles', 'provenance', 'requestedElements'}:
        fail(400, 'The reviewed potential payload is invalid.', 'AI_POTENTIAL_INVALID')
    if not set(data['requestedElements']).issubset(data['metadata']['elements']):
        fail(409, 'Potential element mapping changed.', 'AI_POTENTIAL_INVALID')
    from backend.local_api.domain.api import normalize_md_potential_files
    normalize_md_potential_files(data['metadata']['files'], data['metadata']['family'])
    for file in data['stagedFiles']:
        if not file['objectKey'].startswith(f'users/{storage_owner(owner)}/ai/potentials/'):
            fail(403, 'This staged potential is unavailable.', 'AI_PERMISSION_DENIED')
        raw = ai.services.s3.get_object(Bucket=ai.services.bucket, Key=file['objectKey'])['Body'].read(20 * 1024 * 1024 + 1)
        if len(raw) != file['sizeBytes'] or hashlib.sha256(raw).hexdigest() != file['sha256']:
            fail(409, 'The staged potential checksum changed. Prepare a new import.', 'AI_POTENTIAL_CHECKSUM')


def perform_potential(ai, owner, conversation, data):
    from backend.local_api.domain.api import public_md_potential
    project = ai.scope(owner, conversation['projectKey'])
    with ai.services.table.atomic():
        validate_staged_potential(ai, owner, conversation, data)
        created = body(ai.api.create_md_potential_upload(owner, project['remoteId'], data['metadata']))['potential']
        item = ai.row(owner, 'MD_POTENTIAL', created['id'])
        for stored, staged in zip(item['files'], data['stagedFiles'], strict=True):
            if any(stored[key] != staged[key] for key in ('filename', 'sizeBytes', 'sha256', 'role')):
                fail(409, 'Potential file mapping changed.', 'AI_POTENTIAL_INVALID')
            raw = ai.services.s3.get_object(Bucket=ai.services.bucket, Key=staged['objectKey'])['Body'].read(staged['sizeBytes'] + 1)
            if len(raw) != stored['sizeBytes'] or hashlib.sha256(raw).hexdigest() != stored['sha256']:
                fail(409, 'Potential checksum changed during attachment.', 'AI_POTENTIAL_CHECKSUM')
            ai.services.s3.put_object(Bucket=ai.services.bucket, Key=stored['objectKey'], Body=raw, ContentType='application/octet-stream',
                                      Metadata={'sha256': stored['sha256']}, ChecksumSHA256=base64.b64encode(bytes.fromhex(stored['sha256'])).decode())
        ai.api.complete_md_potential(owner, item['id'], {})
        updated = ai.services.update_item(owner, 'MD_POTENTIAL', item['id'], {'repositoryProvenance': data['provenance']})
    potential = public_md_potential(updated)
    potential['repositoryProvenance'] = potential_provenance_summary(data['provenance'])
    return {'potential': potential}
