"""Owner-bound multipart source uploads. Each part is bounded and checksummed;
the scientific worker verifies the original whole-file SHA-256 before execution."""
from __future__ import annotations
import base64
import hashlib
import math
import re
import time
import uuid
from typing import Any

from backend.local_api.domain.phynite_core import ApiError, owner_partition, require_owner_item

PART_BYTES = 16 * 1024 ** 2
MAX_SOURCE_BYTES = 64 * 1024 ** 3


class MdMultipart:
    source_kind = "MD_TRAJECTORY"
    upload_kind = "MD_UPLOAD"
    part_kind = "MD_UPLOAD_PART"
    retention_tag = "phynite-retention=md-upload-pending"

    def __init__(self, services: Any):
        self.services, self.table = services, services.table

    def record(self, owner: str, identifier: str) -> dict[str, Any]:
        return self.table.get_item(Key={'PK': owner_partition(owner), 'SK': self.upload_kind + '#' + identifier}, ConsistentRead=True).get('Item') or {}

    def item(self, owner: str, identifier: str) -> dict[str, Any]:
        return require_owner_item(self.services, owner, self.source_kind, identifier, 'MD_TRAJECTORY_NOT_FOUND')

    def source(self, owner: str, identifier: str) -> dict[str, Any]:
        item = self.item(owner, identifier)
        if item['status'] != 'UPLOAD_PENDING':
            raise ApiError(409, 'This source upload is already finalized.', 'MD_UPLOAD_STATE')
        return item

    def ticket(self, item: dict[str, Any]) -> dict[str, Any]:
        owner, identifier = item['ownerId'], item['id']
        self.source(owner, identifier)
        record = self.record(owner, identifier)
        if not record.get('uploadId'):
            nonce = uuid.uuid4().hex
            now = int(time.time())
            try:
                self.table.update_item(Key={'PK': owner_partition(owner), 'SK': self.upload_kind + '#' + identifier},
                    UpdateExpression='SET lockToken = :nonce, lockUntil = :until',
                    ConditionExpression='attribute_not_exists(uploadId) AND (attribute_not_exists(lockUntil) OR lockUntil < :now)',
                    ExpressionAttributeValues={':nonce': nonce, ':until': now + 60, ':now': now})
            except self.table.meta.client.exceptions.ConditionalCheckFailedException:
                raise ApiError(409, 'Upload preparation is in progress. Retry the same source.', 'MD_UPLOAD_BUSY') from None
            upload_id = None
            try:
                if getattr(self.services.s3, 'enforces_cloud_quota', False):
                    self.services.s3.reserve(item['objectKey'], self.services.bucket, int(item['sizeBytes']), ticket_seconds=86400)
                created = self.services.s3.create_multipart_upload(Bucket=self.services.bucket, Key=item['objectKey'],
                    ContentType=item['contentType'], Metadata={'sha256': item['sha256']}, ServerSideEncryption='AES256',
                    ChecksumAlgorithm='SHA256', Tagging=item.get("retentionTag", self.retention_tag))
                upload_id = created['UploadId']
                self.table.update_item(Key={'PK': owner_partition(owner), 'SK': self.upload_kind + '#' + identifier},
                    UpdateExpression='SET uploadId = :id, expiresAtEpoch = :expiry REMOVE lockToken, lockUntil',
                    ConditionExpression='lockToken = :nonce',
                    ExpressionAttributeValues={':id': upload_id, ':expiry': now + 86400, ':nonce': nonce})
            except Exception:
                if upload_id: self.services.s3.abort_multipart_upload(Bucket=self.services.bucket, Key=item['objectKey'], UploadId=upload_id)
                raise
        elif int(record.get('expiresAtEpoch') or 0) <= time.time():
            raise ApiError(410, 'The source upload expired. Delete this pending source and create a new upload.', 'MD_UPLOAD_EXPIRED')
        return {'url': '/api/md-upload/' + identifier, 'method': 'POST', 'fields': {}, 'partBytes': PART_BYTES,
                'maxBytes': int(item['sizeBytes']), 'expiresIn': 86400, 'multipart': True}

    def part(self, owner: str, identifier: str, payload: dict[str, Any]) -> dict[str, Any]:
        item, record = self.source(owner, identifier), self.record(owner, identifier)
        if not record.get('uploadId') or int(record.get('expiresAtEpoch') or 0) <= time.time():
            raise ApiError(410, 'Upload expired. Reopen the source upload.', 'MD_UPLOAD_EXPIRED')
        number, size, digest = payload.get('partNumber'), payload.get('sizeBytes'), payload.get('sha256')
        count = math.ceil(int(item['sizeBytes']) / PART_BYTES)
        if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= count or size != min(PART_BYTES, int(item['sizeBytes']) - (number - 1) * PART_BYTES) or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ApiError(400, 'Upload part size, index or checksum is invalid.', 'INVALID_MD_UPLOAD_PART')
        key = {'PK': owner_partition(owner), 'SK': f'{self.part_kind}#{identifier}#{number:05d}'}
        checksum = base64.b64encode(bytes.fromhex(digest)).decode()
        try:
            self.table.put_item(Item={**key, 'partNumber': number, 'sizeBytes': size, 'checksum': checksum},
                ConditionExpression='attribute_not_exists(PK) OR checksum = :checksum',
                ExpressionAttributeValues={':checksum': checksum})
        except self.table.meta.client.exceptions.ConditionalCheckFailedException:
            raise ApiError(409, 'This upload part has different bytes. Reopen the original source.', 'MD_UPLOAD_PART_CHANGED') from None
        params = {'Bucket': self.services.bucket, 'Key': item['objectKey'], 'UploadId': record['uploadId'],
                  'PartNumber': number, 'ContentLength': size, 'ChecksumSHA256': checksum}
        return {'url': self.services.s3.generate_presigned_url('upload_part', Params=params, ExpiresIn=900),
                'headers': {'Content-Length': str(size), 'x-amz-checksum-sha256': checksum}}

    def complete(self, owner: str, identifier: str) -> dict[str, Any]:
        item = self.item(owner, identifier)
        record = self.record(owner, identifier)
        if record.get('completedChecksum'): return record
        self.source(owner, identifier)
        if int(record.get('expiresAtEpoch') or 0) <= time.time():
            raise ApiError(410, 'Source upload expired.', 'MD_UPLOAD_EXPIRED')
        parts, query = [], {'Bucket': self.services.bucket, 'Key': item['objectKey'], 'UploadId': record.get('uploadId')}
        if not query['UploadId']: raise ApiError(409, 'Source upload has not started.', 'MD_UPLOAD_MISSING')
        while True:
            page = self.services.s3.list_parts(**query)
            parts.extend(page.get('Parts', []))
            if not page.get('IsTruncated'): break
            query['PartNumberMarker'] = page['NextPartNumberMarker']
        expected = math.ceil(int(item['sizeBytes']) / PART_BYTES)
        if len(parts) != expected or sum(int(part['Size']) for part in parts) != int(item['sizeBytes']):
            raise ApiError(409, 'Source upload is incomplete. Retry the missing parts.', 'MD_UPLOAD_INCOMPLETE')
        checksums, completed = [], []
        records = {}
        part_query = {'KeyConditionExpression': 'PK = :owner AND begins_with(SK, :prefix)', 'ExpressionAttributeValues': {':owner': owner_partition(owner), ':prefix': f'{self.part_kind}#{identifier}#'}, 'ConsistentRead': True}
        while True:
            page = self.table.query(**part_query)
            records.update({int(value['partNumber']): value for value in page.get('Items', [])})
            if not page.get('LastEvaluatedKey'): break
            part_query['ExclusiveStartKey'] = page['LastEvaluatedKey']
        for number, part in enumerate(parts, 1):
            prior = records.get(number) or {}
            if part['PartNumber'] != number or part.get('ChecksumSHA256') != prior.get('checksum') or part['Size'] != prior.get('sizeBytes'):
                raise ApiError(409, 'Source upload checksum changed. Retry from the original file.', 'MD_UPLOAD_MISMATCH')
            checksums.append(base64.b64decode(prior['checksum']))
            completed.append({k: part[k] for k in ('PartNumber', 'ETag', 'ChecksumSHA256')})
        composite = base64.b64encode(hashlib.sha256(b''.join(checksums)).digest()).decode() + '-' + str(expected)
        try:
            self.services.s3.complete_multipart_upload(Bucket=self.services.bucket, Key=item['objectKey'], UploadId=record['uploadId'], MultipartUpload={'Parts': completed})
        except Exception:
            # A response can be lost after S3 completes; recover from its immutable checksum.
            head = self.services.s3.head_object(Bucket=self.services.bucket, Key=item['objectKey'], ChecksumMode='ENABLED')
            if head.get('ChecksumSHA256') != composite: raise
        self.table.update_item(Key={'PK': owner_partition(owner), 'SK': self.upload_kind + '#' + identifier},
            UpdateExpression='SET completedChecksum = :checksum', ExpressionAttributeValues={':checksum': composite})
        return {**record, 'completedChecksum': composite}

    def abort(self, owner: str, identifier: str) -> None:
        item = self.item(owner, identifier)
        record = self.record(owner, identifier)
        if record.get('uploadId') and not record.get('completedChecksum'):
            try:
                self.services.s3.abort_multipart_upload(Bucket=self.services.bucket, Key=item['objectKey'], UploadId=record['uploadId'])
            except self.services.s3.exceptions.NoSuchUpload:
                pass
        self.table.delete_item(Key={'PK': owner_partition(owner), 'SK': self.upload_kind + '#' + identifier})
        query = {'KeyConditionExpression': 'PK = :owner AND begins_with(SK, :prefix)', 'ExpressionAttributeValues': {':owner': owner_partition(owner), ':prefix': f'{self.part_kind}#{identifier}#'}, 'ConsistentRead': True}
        while True:
            page = self.table.query(**query)
            with self.table.batch_writer() as batch:
                for part in page.get('Items', []): batch.delete_item(Key={'PK': part['PK'], 'SK': part['SK']})
            if not page.get('LastEvaluatedKey'): break
            query['ExclusiveStartKey'] = page['LastEvaluatedKey']
