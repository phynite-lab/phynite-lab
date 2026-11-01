"""Immutable, checksummed result transfers for a trusted, owner-bound compute job.

Large results use the same bounded multipart verification as source uploads.
Only trusted workers can register whole-file hashes; S3 verifies every part.
The control plane verifies the aggregate checksum without re-reading gigabytes.
"""
from __future__ import annotations
import base64
import hashlib
import re
import time
import uuid
from pathlib import PurePosixPath
from typing import Any
from backend.local_api.domain.md_multipart import MdMultipart, PART_BYTES, MAX_SOURCE_BYTES
from backend.local_api.domain.phynite_core import ApiError, owner_partition, require_id


class WorkerArtifacts(MdMultipart):
    source_kind = 'WORKER_ARTIFACT'
    upload_kind = 'WORKER_UPLOAD'
    part_kind = 'WORKER_UPLOAD_PART'
    retention_tag = 'phynite-retention=calculation-output'

    def identifier(self, job: dict[str, Any], path: str) -> str:
        if not isinstance(path, str) or not path or len(path) > 500 or path.startswith('/') or '\\' in path or '..' in PurePosixPath(path).parts:
            raise ApiError(400, 'Artifact path is unsafe.', 'INVALID_ARTIFACTS')
        return require_id(job['id'], 'job ID') + '_' + hashlib.sha256(path.encode()).hexdigest()

    def item(self, owner: str, identifier: str) -> dict[str, Any]:
        # These internal keys append a full SHA256 to a normal job ID, so they
        # intentionally exceed the public resource ID limit. Retain existing keys.
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,96}_[a-f0-9]{64}', identifier):
            raise ApiError(400, 'Invalid result transfer ID.', 'INVALID_ID')
        item = self.services.get_item(owner, self.source_kind, identifier)
        if not item:
            raise ApiError(404, 'Result artifact was not found.', 'ARTIFACT_NOT_FOUND')
        return item

    def source(self, owner: str, identifier: str) -> dict[str, Any]:
        item = self.item(owner, identifier)
        if item['status'] != 'UPLOAD_PENDING':
            raise ApiError(409, 'This result transfer is already finalized.', 'MD_UPLOAD_STATE')
        return item

    def plan(self, job: dict[str, Any], file: dict[str, Any]) -> dict[str, Any]:
        path, size, digest = file.get('path'), file.get('sizeBytes'), file.get('sha256')
        identifier = self.identifier(job, path)
        if type(size) is not int or not 0 <= size <= MAX_SOURCE_BYTES or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ApiError(400, 'Artifact size or checksum is invalid.', 'INVALID_ARTIFACTS')
        item = {'PK': owner_partition(job['ownerId']), 'SK': self.source_kind + '#' + identifier,
                'entityType': self.source_kind, 'id': identifier, 'ownerId': job['ownerId'], 'jobId': job['id'],
                'status': 'UPLOAD_PENDING', 'objectKey': job['outputPrefix'] + '/' + path,
                'retentionTag': 'phynite-retention=research-data' if path == 'research/dataset.json' else self.retention_tag,
                'sizeBytes': size, 'sha256': digest, 'contentType': str(file.get('contentType') or 'application/octet-stream')[:160]}
        try:
            self.table.put_item(Item=item, ConditionExpression='attribute_not_exists(PK) OR (sha256 = :sha AND sizeBytes = :size)',
                                ExpressionAttributeValues={':sha': digest, ':size': size})
        except self.table.meta.client.exceptions.ConditionalCheckFailedException:
            raise ApiError(409, 'Artifact bytes changed during finalization.', 'ARTIFACT_CHANGED') from None
        if size > 128 * 1024**2:
            record = self.record(job['ownerId'], identifier)
            if record.get('completedChecksum'):
                self.verify(job, path, size, digest)
                return {'path': path, 'alreadyUploaded': True}
            if record.get('uploadId') and int(record.get('expiresAtEpoch') or 0) <= time.time():
                self.reopen_expired(item, record)
            self.ticket(item)
            return {'path': path, 'multipart': True, 'partBytes': PART_BYTES}
        tag = 'phynite-retention=research-data' if path == 'research/dataset.json' else self.retention_tag
        params = {'Bucket': self.services.bucket, 'Key': item['objectKey'], 'ContentLength': size,
                  'ContentType': item['contentType'], 'ServerSideEncryption': 'AES256', 'Tagging': tag,
                  'ChecksumSHA256': base64.b64encode(bytes.fromhex(digest)).decode()}
        return {'path': path, 'contentType': item['contentType'], 'retentionTag': tag,
                'url': self.services.s3.generate_presigned_url('put_object', Params=params, ExpiresIn=900)}

    def reopen_expired(self, item: dict[str, Any], record: dict[str, Any]) -> None:
        """Renew a retained result's expired session without changing its bytes.

        Part identities remain immutable because the file SHA/size cannot change.
        The lock prevents concurrent retries from replacing one another's session.
        """
        owner, identifier = item['ownerId'], item['id']
        key = {'PK': owner_partition(owner), 'SK': self.upload_kind + '#' + identifier}
        nonce, now = uuid.uuid4().hex, int(time.time())
        try:
            self.table.update_item(Key=key,
                UpdateExpression='SET lockToken = :nonce, lockUntil = :until',
                ConditionExpression='uploadId = :old AND expiresAtEpoch <= :now AND attribute_not_exists(completedChecksum) AND (attribute_not_exists(lockUntil) OR lockUntil < :now)',
                ExpressionAttributeValues={':nonce': nonce, ':until': now + 60, ':now': now, ':old': record['uploadId']})
        except self.table.meta.client.exceptions.ConditionalCheckFailedException:
            raise ApiError(409, 'Artifact recovery is in progress. Retry the same retained bytes.', 'MD_UPLOAD_BUSY') from None
        upload_id = None
        try:
            try:
                self.services.s3.abort_multipart_upload(Bucket=self.services.bucket, Key=item['objectKey'], UploadId=record['uploadId'])
            except Exception as exc:
                if getattr(exc, 'response', {}).get('Error', {}).get('Code') != 'NoSuchUpload':
                    raise
            if getattr(self.services.s3, 'enforces_cloud_quota', False):
                self.services.s3.reserve(item['objectKey'], self.services.bucket, int(item['sizeBytes']), ticket_seconds=86400)
            created = self.services.s3.create_multipart_upload(Bucket=self.services.bucket, Key=item['objectKey'],
                ContentType=item['contentType'], Metadata={'sha256': item['sha256']}, ServerSideEncryption='AES256',
                ChecksumAlgorithm='SHA256', Tagging=item.get('retentionTag', self.retention_tag))
            upload_id = created['UploadId']
            self.table.update_item(Key=key,
                UpdateExpression='SET uploadId = :id, expiresAtEpoch = :expiry REMOVE lockToken, lockUntil',
                ConditionExpression='lockToken = :nonce AND attribute_not_exists(completedChecksum)',
                ExpressionAttributeValues={':id': upload_id, ':expiry': now + 86400, ':nonce': nonce})
        except Exception:
            if upload_id:
                self.services.s3.abort_multipart_upload(Bucket=self.services.bucket, Key=item['objectKey'], UploadId=upload_id)
            raise

    def action(self, job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        identifier = self.identifier(job, payload.get('path'))
        item = self.item(job['ownerId'], identifier)
        if item['jobId'] != job['id']:
            raise ApiError(403, 'Artifact belongs to another job.', 'WORKER_SCOPE_MISMATCH')
        if payload.get('artifactAction') == 'part':
            return self.part(job['ownerId'], identifier, payload)
        if payload.get('artifactAction') == 'complete':
            self.complete(job['ownerId'], identifier)
            return {'complete': True}
        raise ApiError(400, 'Artifact transfer action is invalid.', 'INVALID_ARTIFACTS')

    def verify(self, job: dict[str, Any], path: str, size: int, digest: str) -> None:
        identifier = self.identifier(job, path)
        item = self.item(job['ownerId'], identifier)
        record = self.record(job['ownerId'], identifier)
        expected = record.get('completedChecksum') if size > 128 * 1024**2 else base64.b64encode(bytes.fromhex(digest)).decode()
        head = self.services.s3.head_object(Bucket=self.services.bucket, Key=item['objectKey'], ChecksumMode='ENABLED')
        if not expected or item['sizeBytes'] != size or item['sha256'] != digest or head.get('ContentLength') != size or head.get('ChecksumSHA256') != expected:
            raise ApiError(409, 'Result artifact bytes could not be verified.', 'MD_RESULT_INCOMPLETE')
