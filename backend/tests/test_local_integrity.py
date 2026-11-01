"""Data-integrity regressions for the real local persistence adapters."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend.local_api.domain.phynite_core import ApiError, owner_partition, storage_owner
from backend.local_api.domain.project_workflow import validate_graph
from backend.local_api.domain.md_multipart import MdMultipart
from backend.local_api.archives import restore_snapshot
from backend.local_api.services import LocalServices
from backend.local_api.snapshots import build_project_snapshot
from backend.local_api.sqlite_store import SQLiteClient, StorageError


class LocalIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.services = LocalServices(self.root / 'workspace', 'http://127.0.0.1:49120', 'http://127.0.0.1:3000')
        self.owner = self.services.owner

    def put(self, kind: str, identifier: str, **values):
        item = {'PK': owner_partition(self.owner), 'SK': kind + '#' + identifier, 'id': identifier,
                'entityType': kind, 'ownerId': self.owner, **values}
        self.services.put_item(item)
        return item

    def project(self):
        return self.put('PROJECT', 'project', name='Silicon')

    def graph_snapshot(self):
        self.project()
        self.put('STRUCTURE', 'structure', projectId='project', status='READY')
        graph = {'version': 1, 'projectId': 'project', 'nodes': [
            {'id': 'structure', 'kind': 'structure', 'name': 'Si', 'position': {'x': 0, 'y': 0}, 'configuration': {}, 'resources': [{'kind': 'structure', 'id': 'structure'}]},
            {'id': 'scf-node', 'kind': 'scf', 'name': 'SCF', 'position': {'x': 100, 'y': 0}, 'configuration': {}, 'resources': []},
        ], 'edges': [{'id': 'edge', 'source': 'structure', 'target': 'scf-node', 'port': 'structure'}],
            'groups': [{'id': 'group', 'name': 'Electronic', 'nodeIds': ['structure', 'scf-node']}]}
        validate_graph(graph, 'project')
        raw = json.dumps(graph).encode()
        key = f'users/{storage_owner(self.owner)}/projects/project/workflow/revisions/current.json'
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=raw, ContentType='application/json')
        self.put('PROJECT_WORKFLOW', 'project', projectId='project', objectKey=key, sha256=hashlib.sha256(raw).hexdigest(), revision=1)
        return build_project_snapshot(self.services, self.owner, 'project', self.root / 'snapshot')

    def test_copy_keeps_workflow_connections_groups_and_resource_identity_valid(self):
        snapshot, sources = self.graph_snapshot()
        result = restore_snapshot(self.services, snapshot, sources, as_copy=True)
        item = self.services.get_item(self.owner, 'PROJECT_WORKFLOW', result['projectId'])
        with self.services.s3.get_object(Bucket=self.services.bucket, Key=item['objectKey'])['Body'] as body:
            graph = json.loads(body.read())
        validate_graph(graph, result['projectId'])
        self.assertEqual(graph['projectId'], result['projectId'])
        structure_ref = next(node for node in graph['nodes'] if node['kind'] == 'structure')['resources'][0]
        self.assertNotEqual(structure_ref['id'], 'structure')
        imported = self.services.get_item(self.owner, 'STRUCTURE', structure_ref['id'])
        self.assertEqual(imported['projectId'], result['projectId'])

    def test_snapshot_preserves_nested_scientific_metadata_and_omits_record_credentials(self):
        metadata = {'ownerId': 'atom-owner-label', 'PK': 'physical-property', 'GSI_species': 'Si',
                    'nested': {'accessToken': 'scientific-annotation', 'url': 'https://doi.org/example'}}
        self.put('PROJECT', 'project', name='Silicon', metadata=metadata, accessToken='private-session')
        snapshot, sources = build_project_snapshot(self.services, self.owner, 'project', self.root / 'snapshot')
        record = snapshot['document']['records'][0]
        self.assertEqual(record['metadata'], metadata)
        self.assertNotIn('accessToken', record)
        result = restore_snapshot(self.services, snapshot, sources, as_copy=True)
        self.assertEqual(self.services.get_item(self.owner, 'PROJECT', result['projectId'])['metadata'], metadata)

    def test_snapshot_includes_workflow_attempt_history(self):
        self.project()
        attempt = self.put('WORKFLOW_ATTEMPT', 'run_node', projectId='project', runId='run', nodeId='node', status='completed', fingerprint='scientific-fingerprint')
        snapshot, _ = build_project_snapshot(self.services, self.owner, 'project', self.root / 'snapshot')
        exported = next((record for record in snapshot['document']['records'] if record['entityType'] == 'WORKFLOW_ATTEMPT'), None)
        self.assertIsNotNone(exported, 'Export must retain the execution attempt history used by run results.')
        self.assertEqual(exported['fingerprint'], attempt['fingerprint'])

    def test_copy_import_cannot_overwrite_an_unrelated_project_artifact(self):
        key = f'users/{storage_owner(self.owner)}/projects/unrelated/input.json'
        self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=b'original')
        raw = b'replacement'; digest = hashlib.sha256(raw).hexdigest()
        source = self.root / 'chunk'; source.write_bytes(raw)
        chunk = {'path': 'objects/test/00000000', 'sha256': digest, 'sizeBytes': len(raw), 'contentType': 'application/octet-stream'}
        snapshot = {'schemaVersion': 1, 'projectId': 'project', 'document': {'format': 'phynite-project', 'version': 1,
            'records': [{'SK': 'PROJECT#project', 'entityType': 'PROJECT', 'id': 'project', 'name': 'Imported'}],
            'objects': [{'key': 'projects/unrelated/input.json', 'sha256': digest, 'sizeBytes': len(raw), 'contentType': 'application/json', 'chunks': [chunk]}], 'missingAssets': []},
            'artifacts': [chunk], 'deleted': False}
        with self.assertRaises(ApiError):
            restore_snapshot(self.services, snapshot, {digest: source}, as_copy=True)
        with self.services.s3.get_object(Bucket=self.services.bucket, Key=key)['Body'] as body:
            self.assertEqual(body.read(), b'original')

    def test_import_preserves_actual_compute_provenance(self):
        self.project()
        self.put('CALCULATION', 'calc', projectId='project', status='COMPLETED', computeBackend='AWS_BATCH', runtimeFingerprint='verified-original-runtime')
        snapshot, sources = build_project_snapshot(self.services, self.owner, 'project', self.root / 'snapshot')
        result = restore_snapshot(self.services, snapshot, sources, as_copy=True)
        imported = next(item for item in self.services.list_owner_items(self.owner, 'CALCULATION') if item.get('projectId') == result['projectId'])
        self.assertEqual(imported['computeBackend'], 'AWS_BATCH')
        self.assertEqual(imported['runtimeFingerprint'], 'verified-original-runtime')

    def test_failed_nested_transaction_cannot_commit_its_partial_writes(self):
        table = self.services.table
        with table.atomic():
            table.put_item(Item={'PK': 'test', 'SK': 'outer', 'value': 'keep'})
            with self.assertRaises(StorageError):
                SQLiteClient(table, native=True).transact_write_items(TransactItems=[
                    {'Put': {'TableName': table.name, 'Item': {'PK': 'test', 'SK': 'partial'}}},
                    {'ConditionCheck': {'TableName': table.name, 'Key': {'PK': 'test', 'SK': 'missing'}, 'ConditionExpression': 'attribute_exists(PK)'}},
                ])
        self.assertEqual(table.get_item(Key={'PK': 'test', 'SK': 'outer'})['Item']['value'], 'keep')
        self.assertNotIn('Item', table.get_item(Key={'PK': 'test', 'SK': 'partial'}))

    def test_reserved_codec_keys_remain_ordinary_user_json(self):
        value = {'nested': [{'__phynite_decimal__': '12.50'}, {'__phynite_bytes__': 'YWJj'}, {'__phynite_set__': ['Si', 'O']}]}
        self.services.table.put_item(Item={'PK': 'test', 'SK': 'codec', 'value': value})
        self.assertEqual(self.services.table.get_item(Key={'PK': 'test', 'SK': 'codec'})['Item']['value'], value)

    def test_correct_reupload_repairs_corrupt_digest_file(self):
        objects = self.services.s3
        objects.put_object(Bucket=objects.bucket, Key='input', Body=b'correct')
        digest = hashlib.sha256(b'correct').hexdigest()
        (objects.root / digest[:2] / digest).write_bytes(b'corrupt')
        objects.put_object(Bucket=objects.bucket, Key='input', Body=b'correct')
        with objects.get_object(Bucket=objects.bucket, Key='input')['Body'] as body:
            self.assertEqual(body.read(), b'correct')

    def test_truncated_stored_artifact_read_fails_explicitly(self):
        objects = self.services.s3
        objects.put_object(Bucket=objects.bucket, Key='input', Body=b'complete')
        digest = hashlib.sha256(b'complete').hexdigest()
        (objects.root / digest[:2] / digest).write_bytes(b'cut')
        with self.assertRaises(OSError):
            with objects.get_object(Bucket=objects.bucket, Key='input')['Body'] as body:
                body.read()

    def trajectory_upload(self):
        raw = b'LAMMPS trajectory data'
        key = f'users/{storage_owner(self.owner)}/projects/project/md/trajectories/trajectory/source.dump'
        self.put('MD_TRAJECTORY', 'trajectory', projectId='project', status='UPLOAD_PENDING', objectKey=key,
                 sizeBytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), contentType='text/plain')
        multipart = MdMultipart(self.services)
        multipart.ticket(self.services.get_item(self.owner, 'MD_TRAJECTORY', 'trajectory'))
        multipart.part(self.owner, 'trajectory', {'partNumber': 1, 'sizeBytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        record = multipart.record(self.owner, 'trajectory')
        self.services.s3.upload_part(Bucket=self.services.bucket, Key=key, UploadId=record['uploadId'], PartNumber=1,
            Body=raw, ContentLength=len(raw), ChecksumSHA256=base64.b64encode(hashlib.sha256(raw).digest()).decode())
        return multipart, key, raw

    def test_real_md_multipart_protocol_completes_and_recovers_actual_bytes(self):
        multipart, key, raw = self.trajectory_upload()
        completed = multipart.complete(self.owner, 'trajectory')
        self.assertTrue(completed['completedChecksum'])
        with self.services.s3.get_object(Bucket=self.services.bucket, Key=key)['Body'] as body:
            self.assertEqual(body.read(), raw)

    def test_real_md_multipart_abort_removes_its_part_records(self):
        multipart, _, _ = self.trajectory_upload()
        multipart.abort(self.owner, 'trajectory')
        self.assertEqual(multipart.record(self.owner, 'trajectory'), {})
        page = self.services.table.query(KeyConditionExpression='PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues={':pk': owner_partition(self.owner), ':prefix': 'MD_UPLOAD_PART#trajectory#'})
        self.assertEqual(page['Items'], [])

    def test_md_part_conflict_returns_actionable_error_through_storage_exception_contract(self):
        multipart, _, raw = self.trajectory_upload()
        with self.assertRaises(ApiError) as conflict:
            multipart.part(self.owner, 'trajectory', {'partNumber': 1, 'sizeBytes': len(raw), 'sha256': hashlib.sha256(b'different bytes').hexdigest()})
        self.assertEqual(conflict.exception.code, 'MD_UPLOAD_PART_CHANGED')

    def test_multipart_pages_and_abort_cover_more_than_one_thousand_parts(self):
        objects = self.services.s3
        upload = objects.create_multipart_upload(Bucket=objects.bucket, Key='many')['UploadId']
        objects.put_object(Bucket=objects.bucket, Key=f'__multipart/{upload}/00001', Body=b'a')
        template = objects.metadata(objects.bucket, f'__multipart/{upload}/00001')
        with self.services.table.atomic():
            for number in range(2, 1002):
                self.services.table.put_item(Item={**template, 'SK': f'__multipart/{upload}/{number:05d}'})
        parts = []
        request = {'Bucket': objects.bucket, 'Key': 'many', 'UploadId': upload}
        while True:
            page = objects.list_parts(**request)
            parts.extend(page['Parts'])
            if not page['IsTruncated']:
                break
            self.assertGreater(page['NextPartNumberMarker'], request.get('PartNumberMarker', 0))
            request['PartNumberMarker'] = page['NextPartNumberMarker']
        self.assertEqual(len(parts), 1001)
        self.assertTrue(all(part.get('ChecksumSHA256') for part in parts))
        objects.abort_multipart_upload(Bucket=objects.bucket, Key='many', UploadId=upload)
        self.assertEqual(objects.list_objects_v2(Bucket=objects.bucket, Prefix=f'__multipart/{upload}/')['Contents'], [])


if __name__ == '__main__':
    unittest.main()
