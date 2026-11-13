"""Portable project archives and atomic, owner-scoped snapshot restoration."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import secrets
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from backend.local_api.domain.phynite_core import ApiError, owner_partition, storage_owner, utc_now
from backend.local_api.domain.project_sync import canonical, validate_snapshot, MAX_MANIFEST_BYTES
from .snapshots import build_project_snapshot, PROJECT_KINDS, FILE_KINDS, TERMINAL

REFERENCE_FIELDS = {'rootId', 'transferId', 'imports', 'id', 'projectId', 'structureId', 'trajectoryId', 'calculationId', 'simulationId', 'analysisId', 'sourceId', 'sourceSimulationId', 'sourceCalculationId', 'scfSourceCalculationId', 'conversationId', 'runId', 'actionId', 'attachmentId', 'artifactId', 'figureId', 'datasetId', 'potentialAssetId', 'assetId', 'resourceId', 'dependsOnCalculationIds', 'nodeId', 'nodeIds', 'source', 'target', 'jobId'}
MAX_ARCHIVE_BYTES = 64 * 1024**3
PART_BYTES = 4 * 1024**2


def invalid(message: str):
    raise ApiError(400, message, 'INVALID_PROJECT_ARCHIVE')


def restore_snapshot(services, snapshot: dict, sources: dict[str, Path], *, as_copy: bool = False, local_archive: bool = False) -> dict:
    """Verify all bytes before publishing records in a single SQLite transaction.

    A normal restore can replace only this project's records and never an active
    execution. Copy imports allocate independent IDs. Scientific files remain
    byte-for-byte intact; only workflow/result control metadata has IDs remapped.
    """
    project_id = snapshot.get('projectId')
    validate_snapshot(snapshot, project_id)
    document = snapshot['document']
    if document.get('format') != 'phynite-project' or document.get('version') != 1 or not isinstance(document.get('records'), list) or not isinstance(document.get('objects'), list):
        invalid('Choose a Phynite project archive version 1.')
    if snapshot.get('deleted'):
        invalid('Restore this project from Trash before importing its contents.')
    allowed_kinds = PROJECT_KINDS | FILE_KINDS if local_archive else PROJECT_KINDS
    records = copy.deepcopy(document['records'])
    for record in records:
        if record.get('entityType') == 'CONNECTED_ROOT': record.update(active=False, write=False, capabilityRevision=int(record.get('capabilityRevision', 0)) + 1)
        if record.get('entityType') == 'FILE_TRANSFER' and record.get('status') in {'queued', 'running'}: record.update(status='interrupted', error='Reconnect the source and explicitly start a new transfer.')
        if record.get('entityType') == 'FILE_EDIT': record['status'] = 'restored-no-authority'
    identities = set()
    for record in records:
        kind, identifier = record.get('entityType'), record.get('id')
        expected_key = f'{kind}#{identifier}' if kind != 'AI_MESSAGE' else f'AI_MESSAGE#{record.get("conversationId")}#{identifier}'
        if kind not in allowed_kinds or not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', identifier) or record.get('SK') != expected_key or (kind, identifier) in identities:
            invalid('Project archive contains an invalid or duplicate record.')
        if record.get('projectId') not in {None, project_id}:
            invalid('A record belongs to another project.')
        if kind in {'CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS', 'AI_RUN'} and str(record.get('status', '')).lower() not in TERMINAL:
            invalid('An archive cannot resume an active execution.')
        identities.add((kind, identifier))
    if sum(kind == 'PROJECT' and identifier == project_id for kind, identifier in identities) != 1:
        invalid('Project archive is missing its project record.')
    wanted = {entry['sha256']: entry['sizeBytes'] for entry in snapshot['artifacts']}
    for digest, size in wanted.items():
        source = sources.get(digest)
        if source is None or source.stat().st_size != size:
            invalid('A required project chunk is missing or has the wrong size.')
        check = hashlib.sha256()
        with source.open('rb') as stream:
            while chunk := stream.read(1024**2):
                check.update(chunk)
        if check.hexdigest() != digest:
            invalid('Project chunk checksum verification failed.')
    id_map = {identifier: identifier for _, identifier in identities}
    if as_copy:
        id_map = {identifier: 'copy_' + secrets.token_hex(16) for _, identifier in identities}
    target_project = id_map[project_id]
    conversations = {identifier for kind, identifier in identities if kind == 'AI_CONVERSATION'}
    research_paths = {'DATASET': 'datasets', 'FIGURE': 'figures', 'FIGURE_TEMPLATE': 'templates'}
    allowed_prefixes = [f'projects/{project_id}/', *[f'research/{research_paths[kind]}/{identifier}/' for kind, identifier in identities if kind in research_paths], *[f'ai/{identifier}/' for identifier in conversations]]
    for record in records:
        if record.get('projectKey') is not None and record['projectKey'] not in {f'project:{project_id}', f'md:{project_id}', f'dft:{project_id}'}:
            invalid('An AI conversation belongs to another project.')
        if record.get('conversationId') is not None and record['conversationId'] not in conversations:
            invalid('An AI record belongs to an undeclared conversation.')
    prefix = f'users/{storage_owner(services.owner)}/'
    def object_key(relative: str):
        if not isinstance(relative, str) or relative.startswith('/') or '\\' in relative or '\x00' in relative or any(part in {'', '.', '..'} for part in relative.split('/')):
            invalid('An archive artifact path is invalid.')
        if not any(relative.startswith(candidate) for candidate in allowed_prefixes):
            invalid('An archive artifact belongs outside this project. Import its separately licensed dependency explicitly.')
        return prefix + '/'.join(id_map.get(part, part) for part in relative.split('/'))
    def remap(value, field=''):
        if isinstance(value, str):
            if value.startswith('phynite-object:///'):
                return object_key(value[len('phynite-object:///'):])
            if field in REFERENCE_FIELDS:
                return id_map.get(value, value)
            if field == 'projectKey' and ':' in value:
                scope, identifier = value.split(':', 1)
                return scope + ':' + id_map.get(identifier, identifier)
            return value
        if isinstance(value, list):
            return [remap(item, field) for item in value]
        if isinstance(value, dict):
            return {key: copy.deepcopy(item) if key in {'metadata', 'provenance', 'atoms', 'lattice', 'inputFiles'} else remap(item, key) for key, item in value.items()}
        return value
    objects = []
    seen = set()
    # Reassemble into temporary files outside the installation. This is bounded
    # by disk, and no project pointer is changed until every checksum passes.
    with tempfile.TemporaryDirectory(prefix='.restore-', dir=services.data_dir) as directory:
        for index, item in enumerate(document['objects']):
            if not isinstance(item, dict) or not re.fullmatch(r'[a-f0-9]{64}', str(item.get('sha256', ''))) or type(item.get('sizeBytes')) is not int or not 0 <= item['sizeBytes'] <= MAX_ARCHIVE_BYTES or not isinstance(item.get('chunks'), list):
                invalid('An archive object descriptor is invalid.')
            key = object_key(item.get('key'))
            if key in seen:
                invalid('An archive contains duplicate artifact paths.')
            seen.add(key)
            path = Path(directory) / str(index)
            digest = hashlib.sha256(); size = 0
            with path.open('wb') as output:
                for chunk in item['chunks']:
                    if wanted.get(chunk.get('sha256')) != chunk.get('sizeBytes'):
                        invalid('Object chunk is not declared in the snapshot manifest.')
                    with sources[chunk['sha256']].open('rb') as source:
                        while data := source.read(1024**2):
                            digest.update(data); size += len(data); output.write(data)
            if size != item['sizeBytes'] or digest.hexdigest() != item['sha256']:
                invalid('Reassembled project artifact failed its checksum.')
            # Workflow graphs and result manifests are application metadata.
            # Their original checksums remain in the import receipt below.
            is_control = item.get('contentType') == 'application/json' and (item['key'].startswith('research/') or any(part in item['key'].split('/') for part in ('workflow', 'workflows')) or item['key'].endswith(('/manifest.json', '/result.json')))
            if as_copy and is_control and size <= MAX_MANIFEST_BYTES:
                try:
                    path.write_bytes(canonical(remap(json.loads(path.read_bytes()))))
                except (ValueError, TypeError):
                    invalid('Project control metadata is invalid JSON.')
            objects.append((key, path, item))
        prepared = []
        for record in records:
            kind, original = record['entityType'], record['id']
            value = remap(record)
            value.update(PK=owner_partition(services.owner), SK='#'.join(id_map.get(part, part) for part in record['SK'].split('#')), ownerId=services.owner)
            if kind != 'PROJECT' and record.get('projectId') is not None:
                value['projectId'] = target_project
                value['GSI1PK'] = 'PROJECT#' + target_project
                value['GSI1SK'] = f'{kind}#{value.get("createdAt", "")}#{value["id"]}'
            elif kind == 'PROJECT':
                value['name'] = str(value.get('name', 'Imported project')) + (' (copy)' if as_copy else '')
            if kind in {'CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS'}:
                value['imported'] = True
            prepared.append(value)
        with services.table.atomic():
            for kind in ('CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS', 'AI_RUN'):
                if any(item.get('projectId') == target_project and str(item.get('status', '')).lower() not in TERMINAL for item in services.list_owner_items(services.owner, kind)):
                    invalid('Stop active project work before replacing it.')
            for record in prepared:
                prior = services.table.get_item(Key=record).get('Item')
                same_project = prior and (prior.get('projectId') == target_project or prior.get('projectKey') in {f'project:{target_project}', f'md:{target_project}', f'dft:{target_project}'} or prior.get('conversationId') in conversations or prior.get('entityType') == 'PROJECT' and prior.get('id') == target_project)
                if prior and (as_copy or not same_project):
                    invalid('An imported identity conflicts with another project. Import as a copy.')
            imported_keys = {record['SK'] for record in prepared}
            for kind in allowed_kinds:
                for prior in services.list_owner_items(services.owner, kind):
                    if prior.get('projectId') == target_project and prior['SK'] not in imported_keys:
                        services.table.delete_item(Key=prior)
            # Immutable bytes can be orphaned on disk failure; existing database
            # metadata and all previous artifact pointers roll back together.
            for key, path, item in objects:
                with path.open('rb') as body:
                    services.s3.put_object(Bucket=services.bucket, Key=key, Body=body, ContentType=item.get('contentType', 'application/octet-stream'))
            object_meta = {key: services.s3.metadata(services.bucket, key) for key, _, _ in objects}
            for record in prepared:
                if record.get('objectKey') in object_meta:
                    meta = object_meta[record['objectKey']]
                    record['sha256'] = meta['sha256']
                    if 'sizeBytes' in record:
                        record['sizeBytes'] = meta['size']
                services.put_item(record)
            services.table.put_item(Item={'PK': 'LOCAL_IMPORT_RECEIPT', 'SK': secrets.token_hex(16), 'projectId': target_project, 'sourceProjectId': project_id, 'sourceManifestSha256': hashlib.sha256(canonical(snapshot)).hexdigest(), 'importedAt': utc_now()})
    return {'projectId': target_project, 'missingAssets': document.get('missingAssets', []), 'asCopy': as_copy}


class ProjectArchives:
    def __init__(self, services):
        self.services = services
        self.root = services.data_dir / 'transfers'
        self.root.mkdir(mode=0o700, exist_ok=True)

    def export(self, project_id: str):
        identifier = secrets.token_hex(16)
        with tempfile.TemporaryDirectory(prefix='.export-', dir=self.root) as directory:
            with self.services.table.atomic():
                snapshot, sources = build_project_snapshot(self.services, self.services.owner, project_id, Path(directory), local_archive=True)
            path = self.root / (identifier + '.phynite')
            try:
                with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    archive.writestr('manifest.json', canonical(snapshot))
                    for digest, source in sources.items():
                        archive.write(source, 'chunks/' + digest)
                path.chmod(0o600)
            except BaseException:
                path.unlink(missing_ok=True); raise
        return {'exportId': identifier, 'downloadUrl': '/api/local/projects/exports/' + identifier, 'sizeBytes': path.stat().st_size, 'missingAssets': snapshot['document']['missingAssets']}

    def export_path(self, identifier: str):
        if not re.fullmatch(r'[a-f0-9]{32}', identifier):
            invalid('Choose a valid exported project.')
        path = self.root / (identifier + '.phynite')
        if not path.is_file():
            raise ApiError(404, 'The project export was not found.', 'EXPORT_NOT_FOUND')
        return path

    def begin(self, payload: dict):
        size = payload.get('sizeBytes')
        if type(size) is not int or not 1 <= size <= MAX_ARCHIVE_BYTES or type(payload.get('asCopy', True)) is not bool:
            invalid('Choose a project archive up to 64 GiB.')
        identifier = secrets.token_hex(16)
        root = self.root / identifier; root.mkdir(mode=0o700)
        (root / 'upload.json').write_text(json.dumps({'sizeBytes': size, 'asCopy': payload.get('asCopy', True)}))
        return {'importId': identifier, 'partBytes': PART_BYTES}

    def upload(self, identifier: str, part: int, raw: bytes):
        root, descriptor = self.import_info(identifier)
        count = (descriptor['sizeBytes'] + PART_BYTES - 1) // PART_BYTES
        if type(part) is not int or not 0 <= part < count or len(raw) != min(PART_BYTES, descriptor['sizeBytes'] - part * PART_BYTES):
            invalid('Archive part has the wrong offset or length.')
        temporary = root / ('.part-' + secrets.token_hex(8))
        try:
            with temporary.open('xb') as output:
                output.write(raw); output.flush(); os.fsync(output.fileno())
            os.replace(temporary, root / str(part))
        finally:
            temporary.unlink(missing_ok=True)
        return {'received': part}

    def import_info(self, identifier: str):
        if not re.fullmatch(r'[a-f0-9]{32}', identifier):
            invalid('Archive import identity is invalid.')
        root = self.root / identifier
        try:
            return root, json.loads((root / 'upload.json').read_text())
        except FileNotFoundError:
            raise ApiError(404, 'The archive upload was not found.', 'IMPORT_NOT_FOUND') from None

    def complete(self, identifier: str):
        root, descriptor = self.import_info(identifier)
        path = root / 'archive.phynite'
        with path.open('wb') as output:
            for index in range((descriptor['sizeBytes'] + PART_BYTES - 1) // PART_BYTES):
                part = root / str(index)
                if not part.is_file():
                    invalid('Archive upload is incomplete. Resume its missing parts.')
                with part.open('rb') as source:
                    while data := source.read(1024**2):
                        output.write(data)
        if path.stat().st_size != descriptor['sizeBytes']:
            invalid('Archive upload size verification failed.')
        try:
            with zipfile.ZipFile(path) as archive:
                infos = archive.infolist()
                if len(infos) > 10001 or len({item.filename for item in infos}) != len(infos) or sum(item.file_size for item in infos) > MAX_ARCHIVE_BYTES:
                    invalid('Project archive exceeds the supported transfer limits.')
                if any(item.filename != 'manifest.json' and not re.fullmatch(r'chunks/[a-f0-9]{64}', item.filename) for item in infos):
                    invalid('Project archive contains an unsupported path.')
                if archive.getinfo('manifest.json').file_size > MAX_MANIFEST_BYTES:
                    invalid('Archive manifest exceeds 4 MB.')
                snapshot = json.loads(archive.read('manifest.json'))
                validate_snapshot(snapshot, snapshot.get('projectId'))
                sources = {}
                for entry in snapshot['artifacts']:
                    digest = entry['sha256']
                    if digest in sources:
                        continue
                    info = archive.getinfo('chunks/' + digest)
                    if info.file_size != entry['sizeBytes']:
                        invalid('Archive chunk size verification failed.')
                    source = root / digest
                    with archive.open(info) as incoming, source.open('wb') as output:
                        while chunk := incoming.read(1024**2):
                            output.write(chunk)
                    sources[digest] = source
                return restore_snapshot(self.services, snapshot, sources, as_copy=descriptor['asCopy'], local_archive=True)
        except (zipfile.BadZipFile, KeyError, ValueError, TypeError) as error:
            raise ApiError(400, 'The project archive is incomplete or invalid.', 'INVALID_PROJECT_ARCHIVE') from error
