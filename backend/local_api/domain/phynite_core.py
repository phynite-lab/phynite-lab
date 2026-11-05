"""Scientific records and atomic metadata operations shared with SQLite.

No hosted constructor, administrator API, billing or deployment implementation.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import html
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from functools import lru_cache
from typing import Any
CALCULATION_TYPES = {'Nudged elastic band', 'Total energy', 'Structural relaxation', 'Band structure', 'Density of states', 'Phonon dispersion', 'Thermoelectric properties'}
FINAL_JOB_STATES = {'COMPLETED', 'FAILED', 'CANCELLED'}
CALCULATION_ARTIFACT_RETENTION_DAYS = 3
ID_PATTERN = re.compile('^[A-Za-z0-9_-]{1,96}$')
SAFE_FILENAME_PATTERN = re.compile('[^A-Za-z0-9._+-]+')
MP_QUERY_PATTERN = re.compile('^[A-Za-z0-9*+\\-., ()]+$')

class ApiError(Exception):

    def __init__(self, status: int, message: str, code: str, *, retry_after: int=300, issues: list[dict[str, str]] | None=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.retry_after = retry_after
        self.issues = issues

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')

def calculation_artifact_expiry(completed_at: str) -> tuple[str, int]:
    """Return the public deadline and epoch for calculation result artifacts.

    The epoch is deliberately *not* stored in DynamoDB's ``expiresAtEpoch``
    attribute. Job metadata must remain available after S3 removes the heavier
    output files.
    """
    try:
        completed = datetime.fromisoformat(completed_at.replace('Z', '+00:00'))
    except (TypeError, ValueError):
        completed = datetime.now(timezone.utc)
    if completed.tzinfo is None:
        completed = completed.replace(tzinfo=timezone.utc)
    expires = completed.astimezone(timezone.utc) + timedelta(days=CALCULATION_ARTIFACT_RETENTION_DAYS)
    return (expires.isoformat(timespec='seconds').replace('+00:00', 'Z'), int(expires.timestamp()))

def new_id(prefix: str) -> str:
    return f'{prefix}_{uuid.uuid4().hex}'

def owner_partition(user_id: str) -> str:
    return f'USER#{user_id}'

def storage_owner(user_id: str) -> str:
    return hashlib.sha256(user_id.encode('utf-8')).hexdigest()[:32]

def require_id(value: str, label: str) -> str:
    if not ID_PATTERN.fullmatch(value):
        raise ApiError(400, f'Invalid {label}.', 'INVALID_ID')
    return value

def clean_text(value: Any, label: str, *, minimum: int=0, maximum: int=240) -> str:
    if not isinstance(value, str):
        raise ApiError(400, f'{label} must be text.', 'INVALID_FIELD')
    cleaned = ' '.join(value.strip().split())
    if len(cleaned) < minimum or len(cleaned) > maximum:
        raise ApiError(400, f'{label} must contain between {minimum} and {maximum} characters.', 'INVALID_FIELD')
    return cleaned

def safe_filename(value: Any) -> str:
    filename = os.path.basename(clean_text(value, 'Filename', minimum=1, maximum=180))
    filename = SAFE_FILENAME_PATTERN.sub('-', filename).strip('.-')
    if not filename:
        raise ApiError(400, 'Filename is invalid.', 'INVALID_FILENAME')
    return filename[:140]

def parse_body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get('body')
    if raw is None or raw == '':
        return {}
    if event.get('isBase64Encoded'):
        try:
            raw = base64.b64decode(raw).decode('utf-8')
        except (ValueError, UnicodeDecodeError) as exc:
            raise ApiError(400, 'Request body is not valid UTF-8.', 'INVALID_BODY') from exc
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ApiError(400, 'Request body must be valid JSON.', 'INVALID_JSON') from exc
    if not isinstance(payload, dict):
        raise ApiError(400, 'Request body must be a JSON object.', 'INVALID_BODY')
    return payload

def request_claims(event: dict[str, Any]) -> dict[str, Any]:
    claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
    user_id = claims.get('sub') if isinstance(claims, dict) else None
    if not isinstance(user_id, str) or not user_id:
        raise ApiError(401, 'A valid Phynite session is required.', 'UNAUTHORIZED')
    return claims

def json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value

def dynamo_safe(value: Any) -> Any:
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: dynamo_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [dynamo_safe(item) for item in value]
    return value

def response(status: int, payload: dict[str, Any], *, retry_after: int=300) -> dict[str, Any]:
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', **({'Retry-After': str(max(1, retry_after))} if status == 429 else {})}, 'body': json.dumps(json_safe(payload), separators=(',', ':'))}

def route_details(event: dict[str, Any]) -> tuple[str, str]:
    context = event.get('requestContext', {}).get('http', {})
    method = str(context.get('method') or event.get('httpMethod') or 'GET').upper()
    path = str(event.get('rawPath') or event.get('path') or '/')
    return (method, path.rstrip('/') or '/')

def retained_locally(services: Any, item: dict[str, Any]) -> bool:
    """Local execution and verified replicas keep artifacts until user removal."""
    return getattr(services, 'local_workspace', False) is True and (item.get('imported') is True or item.get('computeBackend') == 'LOCAL_MAC')

def transaction_client(services: Any):
    """Require the explicitly configured local atomic transaction boundary."""
    return services.persistence_client

class MetadataServices:
    """Persistence contract implemented by the owned SQLite adapter."""

    def get_item(self, user_id: str, kind: str, item_id: str) -> dict[str, Any] | None:
        result = self.table.get_item(Key={'PK': owner_partition(user_id), 'SK': f'{kind}#{item_id}'}, ConsistentRead=True)
        return result.get('Item')

    def record_scientific_failure(self, owner_id: str, kind: str, job_id: str, reason: str, timestamp: str) -> None:
        from backend.local_api.domain.failure_digest import classify_scientific_failure
        item = {'PK': 'SYSTEM#SCIENTIFIC_FAILURE', 'SK': f'FAILURE#{kind}#{job_id}', 'GSI1PK': 'SCIENTIFIC_FAILURE', 'GSI1SK': f'{timestamp}#{kind}#{job_id}', 'entityType': 'SCIENTIFIC_FAILURE', 'ownerId': owner_id, 'jobKind': kind, 'jobId': job_id, 'category': classify_scientific_failure(reason), 'createdAt': timestamp}
        try:
            self.table.put_item(Item=item, ConditionExpression='attribute_not_exists(PK)')
        except Exception as exc:
            if getattr(exc, 'response', {}).get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                raise

    def record_preflight_violation(self, owner_id: str, operation: str, code: str) -> None:
        hour = datetime.now(timezone.utc).strftime('%Y%m%d%H')
        item = {'PK': 'SYSTEM#PREFLIGHT', 'SK': f'EVENT#{hour}#{owner_id}#{operation}#{code}', 'GSI1PK': 'PREFLIGHT_VIOLATION', 'GSI1SK': f'{hour}#{owner_id}#{operation}#{code}', 'entityType': 'PREFLIGHT_VIOLATION', 'ownerId': owner_id, 'operation': operation, 'code': code, 'createdAt': utc_now(), 'expiresAtEpoch': Decimal(int(time.time()) + 90 * 86400)}
        try:
            self.table.put_item(Item=item, ConditionExpression='attribute_not_exists(PK)')
        except Exception as exc:
            if getattr(exc, 'response', {}).get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                raise

    def read_materials_cache(self, query: str, limit: int) -> list[dict[str, Any]] | None:
        cache_id = hashlib.sha256(f'summary-v1:{query}:{limit}'.encode()).hexdigest()
        item = self.table.get_item(Key={'PK': 'SYSTEM#MP_CACHE', 'SK': f'QUERY#{cache_id}'}, ConsistentRead=True).get('Item') or {}
        if int(item.get('expiresAtEpoch') or 0) <= int(time.time()):
            return None
        key = str(item.get('objectKey') or '')
        if not key.startswith(f'global/materials-project-cache/{cache_id}/'):
            return None
        try:
            raw = self.s3.get_object(Bucket=self.bucket, Key=key)['Body'].read(3000001)
            if len(raw) > 3000000 or hashlib.sha256(raw).hexdigest() != item.get('sha256'):
                return None
            payload = json.loads(raw)
            if not isinstance(payload, dict) or payload.get('query') != query or payload.get('limit') != limit or (not isinstance(payload.get('materials'), list)):
                return None
            return payload['materials']
        except Exception:
            return None

    def write_materials_cache(self, query: str, limit: int, materials: list[dict[str, Any]]) -> None:
        cache_id = hashlib.sha256(f'summary-v1:{query}:{limit}'.encode()).hexdigest()
        payload = {'query': query, 'limit': limit, 'materials': materials, 'fetchedAt': utc_now()}
        body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode()
        if len(body) > 3000000:
            return
        digest = hashlib.sha256(body).hexdigest()
        key = f'global/materials-project-cache/{cache_id}/{digest}.json'
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType='application/json', ServerSideEncryption='AES256', Tagging='phynite-retention=mp-cache')
        self.table.put_item(Item={'PK': 'SYSTEM#MP_CACHE', 'SK': f'QUERY#{cache_id}', 'entityType': 'MP_CACHE', 'query': query, 'limit': limit, 'resultCount': len(materials), 'sizeBytes': len(body), 'sha256': digest, 'objectKey': key, 'fetchedAt': payload['fetchedAt'], 'expiresAtEpoch': Decimal(int(time.time()) + 86400)})

    def record_materials_request(self, remaining: int | None) -> None:
        day = datetime.now(timezone.utc).strftime('%Y%m%d')
        assignments = 'SET lastRequestAt = :now'
        values: dict[str, Any] = {':now': utc_now(), ':one': Decimal(1)}
        if remaining is not None:
            assignments += ', lastRateLimitRemaining = :remaining'
            values[':remaining'] = Decimal(remaining)
        self.table.update_item(Key={'PK': 'SYSTEM#MP_USAGE', 'SK': f'DAY#{day}'}, UpdateExpression=f'{assignments} ADD successfulUpstreamRequests :one', ExpressionAttributeValues=values)

    def get_materials_usage(self) -> dict[str, Any]:
        day = datetime.now(timezone.utc).strftime('%Y%m%d')
        item = self.table.get_item(Key={'PK': 'SYSTEM#MP_USAGE', 'SK': f'DAY#{day}'}, ConsistentRead=True).get('Item') or {}
        return {'successfulUpstreamRequestsToday': int(item.get('successfulUpstreamRequests') or 0), 'rateLimitRemaining': int(item['lastRateLimitRemaining']) if 'lastRateLimitRemaining' in item else None, 'lastRequestAt': item.get('lastRequestAt')}

    def put_item(self, item: dict[str, Any], condition: str | None=None) -> None:
        kwargs: dict[str, Any] = {'Item': dynamo_safe(item)}
        if condition:
            kwargs['ConditionExpression'] = condition
        self.table.put_item(**kwargs)

    def commit_ai_records(self, records: list[tuple[dict[str, Any], int | None]]) -> bool:
        """Atomic inbox/claim/steering fence, using each record's expected revision."""
        from boto3.dynamodb.types import TypeSerializer
        serializer = TypeSerializer()

        def encode(values: dict[str, Any]) -> dict[str, Any]:
            return {key: serializer.serialize(dynamo_safe(value)) for key, value in values.items()}
        writes = []
        for item, expected in records:
            put = {'TableName': self.table.name, 'Item': encode(item), 'ConditionExpression': 'attribute_not_exists(PK)' if expected is None else '#revision = :expected'}
            if expected is not None:
                put.update({'ExpressionAttributeNames': {'#revision': 'revision'}, 'ExpressionAttributeValues': encode({':expected': expected})})
            writes.append({'Put': put})
        try:
            transaction_client(self).transact_write_items(TransactItems=writes)
            return True
        except Exception as exc:
            error = getattr(exc, 'response', {})
            if error.get('Error', {}).get('Code') == 'TransactionCanceledException' and any((reason.get('Code') == 'ConditionalCheckFailed' for reason in error.get('CancellationReasons', []))):
                return False
            raise

    def enqueue_ai_message(self, item: dict[str, Any], conversation: dict[str, Any], revision: int) -> bool:
        """Persist an inbox entry and its dispatch signal in one transaction."""
        from boto3.dynamodb.types import TypeSerializer
        serializer = TypeSerializer()

        def encode(values: dict[str, Any]) -> dict[str, Any]:
            return {key: serializer.serialize(dynamo_safe(value)) for key, value in values.items()}
        try:
            transaction_client(self).transact_write_items(TransactItems=[{'Put': {'TableName': self.table.name, 'Item': encode(item), 'ConditionExpression': 'attribute_not_exists(PK)'}}, {'Put': {'TableName': self.table.name, 'Item': encode(conversation), 'ConditionExpression': '#revision = :expected', 'ExpressionAttributeNames': {'#revision': 'revision'}, 'ExpressionAttributeValues': encode({':expected': revision})}}])
            return True
        except Exception as exc:
            error = getattr(exc, 'response', {})
            if error.get('Error', {}).get('Code') == 'TransactionCanceledException' and any((reason.get('Code') == 'ConditionalCheckFailed' for reason in error.get('CancellationReasons', []))):
                return False
            raise

    def reserve_scf_source(self, user_id: str, identity: str, calculation_id: str, previous: str | None) -> bool:
        """Compare-and-swap an owner/project-scoped source slot across submitters."""
        request: dict[str, Any] = {'Key': {'PK': owner_partition(user_id), 'SK': f'SCF_SOURCE#{identity}'}, 'UpdateExpression': 'SET calculationId = :id, updatedAtEpoch = :now', 'ExpressionAttributeValues': {':id': calculation_id, ':now': int(time.time())}, 'ConditionExpression': 'attribute_not_exists(PK)' if previous is None else 'calculationId = :previous'}
        if previous is not None:
            request['ExpressionAttributeValues'][':previous'] = previous
        try:
            self.table.update_item(**request)
            return True
        except Exception as exc:
            if getattr(exc, 'response', {}).get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
                return False
            raise

    def save_workspace_metadata(self, user_id: str, item: dict[str, Any], expected_revision: int) -> bool:
        kwargs: dict[str, Any] = {'Item': dynamo_safe(item)}
        if expected_revision == 0:
            kwargs['ConditionExpression'] = 'attribute_not_exists(PK)'
        else:
            kwargs['ConditionExpression'] = 'revision = :expected'
            kwargs['ExpressionAttributeValues'] = {':expected': Decimal(expected_revision)}
        try:
            self.table.put_item(**kwargs)
            return True
        except Exception as exc:
            error = getattr(exc, 'response', {}).get('Error', {})
            if error.get('Code') == 'ConditionalCheckFailedException':
                return False
            raise

    def save_research_metadata(self, user_id: str, item: dict[str, Any], expected_revision: int, byte_limit: int, *, added_bytes: int | None=None) -> bool:
        from boto3.dynamodb.types import TypeSerializer
        serializer = TypeSerializer()
        added_bytes = item['sizeBytes'] if added_bytes is None else added_bytes

        def encode(values: dict[str, Any]) -> dict[str, Any]:
            return {key: serializer.serialize(dynamo_safe(value)) for key, value in values.items()}
        document = {'TableName': self.table.name, 'Item': encode(item), 'ConditionExpression': 'attribute_not_exists(PK)' if expected_revision == 0 else 'revision = :expected'}
        if expected_revision:
            document['ExpressionAttributeValues'] = encode({':expected': expected_revision})
        usage = {'TableName': self.table.name, 'Key': encode({'PK': owner_partition(user_id), 'SK': 'RESEARCH_STORAGE#primary'}), 'UpdateExpression': 'ADD retainedBytes :bytes', 'ConditionExpression': 'attribute_not_exists(retainedBytes) OR retainedBytes <= :remaining', 'ExpressionAttributeValues': encode({':bytes': added_bytes, ':remaining': byte_limit - added_bytes})}
        try:
            transaction_client(self).transact_write_items(TransactItems=[{'Put': document}, {'Update': usage}])
            return True
        except Exception as exc:
            error = getattr(exc, 'response', {})
            if error.get('Error', {}).get('Code') != 'TransactionCanceledException':
                raise
            reasons = error.get('CancellationReasons', [])
            if len(reasons) > 1 and reasons[1].get('Code') == 'ConditionalCheckFailed':
                raise ApiError(413, 'Research document storage exceeds your account allowance.', 'RESEARCH_QUOTA') from exc
            if reasons and reasons[0].get('Code') == 'ConditionalCheckFailed':
                return False
            raise

    def delete_research_metadata(self, user_id: str, item: dict[str, Any]) -> bool:
        from boto3.dynamodb.types import TypeSerializer
        serializer = TypeSerializer()

        def encode(values: dict[str, Any]) -> dict[str, Any]:
            return {key: serializer.serialize(dynamo_safe(value)) for key, value in values.items()}
        retained_bytes = int(item.get('retainedBytes', item.get('sizeBytes', 0)))
        document = {'TableName': self.table.name, 'Key': encode({'PK': item['PK'], 'SK': item['SK']}), 'ConditionExpression': 'revision = :expected', 'ExpressionAttributeValues': encode({':expected': item['revision']})}
        usage = {'TableName': self.table.name, 'Key': encode({'PK': owner_partition(user_id), 'SK': 'RESEARCH_STORAGE#primary'}), 'UpdateExpression': 'ADD retainedBytes :released', 'ConditionExpression': 'retainedBytes >= :retained', 'ExpressionAttributeValues': encode({':released': -retained_bytes, ':retained': retained_bytes})}
        try:
            transaction_client(self).transact_write_items(TransactItems=[{'Delete': document}, {'Update': usage}])
            return True
        except Exception as exc:
            error = getattr(exc, 'response', {})
            if error.get('Error', {}).get('Code') == 'TransactionCanceledException':
                return False
            raise

    def update_item(self, user_id: str, kind: str, item_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        names: dict[str, str] = {}
        values: dict[str, Any] = {}
        assignments: list[str] = []
        for index, (key, value) in enumerate(updates.items()):
            name_key = f'#n{index}'
            value_key = f':v{index}'
            names[name_key] = key
            values[value_key] = dynamo_safe(value)
            assignments.append(f'{name_key} = {value_key}')
        result = self.table.update_item(Key={'PK': owner_partition(user_id), 'SK': f'{kind}#{item_id}'}, UpdateExpression='SET ' + ', '.join(assignments), ExpressionAttributeNames=names, ExpressionAttributeValues=values, ConditionExpression='attribute_exists(PK)', ReturnValues='ALL_NEW')
        return result['Attributes']

    def update_item_if_revision(self, user_id: str, kind: str, item_id: str, expected_revision: int, updates: dict[str, Any]) -> dict[str, Any] | None:
        names: dict[str, str] = {'#revision': 'revision'}
        values: dict[str, Any] = {':expected_revision': Decimal(expected_revision), ':zero': Decimal(0)}
        assignments: list[str] = []
        for index, (key, value) in enumerate(updates.items()):
            name_key = f'#n{index}'
            value_key = f':v{index}'
            names[name_key] = key
            values[value_key] = dynamo_safe(value)
            assignments.append(f'{name_key} = {value_key}')
        try:
            result = self.table.update_item(Key={'PK': owner_partition(user_id), 'SK': f'{kind}#{item_id}'}, UpdateExpression='SET ' + ', '.join(assignments), ExpressionAttributeNames=names, ExpressionAttributeValues=values, ConditionExpression='attribute_exists(PK) AND (attribute_not_exists(#revision) AND :expected_revision = :zero OR #revision = :expected_revision)', ReturnValues='ALL_NEW')
            return result['Attributes']
        except Exception as exc:
            error = getattr(exc, 'response', {}).get('Error', {})
            if error.get('Code') == 'ConditionalCheckFailedException':
                return None
            raise

    def save_workflow_import(self, owner: str, source: str, source_revision: int | None, destination: str, base_revision: int, metadata: dict[str, Any], resources: list[dict[str, Any]], receipt: dict[str, Any]) -> bool:
        """Publish copied resources, graph and idempotency receipt in one commit."""
        from boto3.dynamodb.types import TypeSerializer
        serializer = TypeSerializer()

        def encode(item: dict[str, Any]) -> dict[str, Any]:
            return {key: serializer.serialize(dynamo_safe(value)) for key, value in item.items()}
        condition = '#revision = :revision' if base_revision else 'attribute_not_exists(PK)'
        destination_put: dict[str, Any] = {'TableName': self.table.name, 'Item': encode(metadata), 'ConditionExpression': condition}
        if base_revision:
            destination_put.update(ExpressionAttributeNames={'#revision': 'revision'}, ExpressionAttributeValues=encode({':revision': base_revision}))
        source_condition: dict[str, Any] = {'TableName': self.table.name, 'Key': encode({'PK': owner_partition(owner), 'SK': 'PROJECT_WORKFLOW#' + source}), 'ConditionExpression': '#revision = :revision', 'ExpressionAttributeNames': {'#revision': 'revision'}, 'ExpressionAttributeValues': encode({':revision': source_revision})}
        writes = [{'Put': destination_put}]
        if source_revision is not None:
            writes.insert(0, {'ConditionCheck': source_condition})
        writes.extend(({'ConditionCheck': {'TableName': self.table.name, 'Key': encode({'PK': owner_partition(owner), 'SK': 'PROJECT#' + project_id}), 'ConditionExpression': 'attribute_exists(PK) AND attribute_not_exists(deleting)'}} for project_id in (source, destination)))
        writes.extend(({'Put': {'TableName': self.table.name, 'Item': encode(item), 'ConditionExpression': 'attribute_not_exists(PK)'}} for item in [*resources, receipt]))
        try:
            transaction_client(self).transact_write_items(TransactItems=writes)
            return True
        except Exception as exc:
            if getattr(exc, 'response', {}).get('Error', {}).get('Code') in {'TransactionCanceledException', 'ConditionalCheckFailedException'}:
                return False
            raise

    def update_item_if_status(self, user_id: str, kind: str, item_id: str, expected_statuses: set[str], updates: dict[str, Any]) -> dict[str, Any] | None:
        if not expected_statuses:
            raise ValueError('At least one expected status is required')
        names: dict[str, str] = {'#status': 'status'}
        values: dict[str, Any] = {}
        assignments: list[str] = []
        for index, (key, value) in enumerate(updates.items()):
            name_key = f'#n{index}'
            value_key = f':v{index}'
            names[name_key] = key
            values[value_key] = dynamo_safe(value)
            assignments.append(f'{name_key} = {value_key}')
        status_tokens: list[str] = []
        for index, status in enumerate(sorted(expected_statuses)):
            token = f':status{index}'
            values[token] = status
            status_tokens.append(token)
        try:
            result = self.table.update_item(Key={'PK': owner_partition(user_id), 'SK': f'{kind}#{item_id}'}, UpdateExpression='SET ' + ', '.join(assignments), ExpressionAttributeNames=names, ExpressionAttributeValues=values, ConditionExpression=f"attribute_exists(PK) AND #status IN ({', '.join(status_tokens)})", ReturnValues='ALL_NEW')
            return result['Attributes']
        except Exception as exc:
            error = getattr(exc, 'response', {}).get('Error', {})
            if error.get('Code') == 'ConditionalCheckFailedException':
                return None
            raise

    def ai_event_page(self, owner: str, conversation_id: str, after: str='', *, tail: bool=False, limit: int=100) -> list[dict[str, Any]]:
        prefix = f'AI_EVENT#{conversation_id}#aie_'
        query = {'KeyConditionExpression': 'PK = :pk AND SK BETWEEN :lo AND :hi', 'ExpressionAttributeValues': {':pk': owner_partition(owner), ':lo': prefix + after, ':hi': prefix + '~'}, 'ScanIndexForward': not tail, 'ConsistentRead': True, 'Limit': limit}
        rows: list[dict[str, Any]] = []
        while len(rows) < limit:
            page = self.table.query(**query)
            rows.extend((row for row in page.get('Items', []) if row['order'] > after))
            if not page.get('LastEvaluatedKey'):
                break
            query['ExclusiveStartKey'] = page['LastEvaluatedKey']
            query['Limit'] = max(1, limit - len(rows))
        return sorted(rows[:limit], key=lambda row: row['order'])

    def list_owner_items(self, user_id: str, kind: str) -> list[dict[str, Any]]:
        query = {'KeyConditionExpression': 'PK = :pk AND begins_with(SK, :prefix)', 'ExpressionAttributeValues': {':pk': owner_partition(user_id), ':prefix': f'{kind}#'}}
        items = []
        while True:
            result = self.table.query(**query)
            items.extend(result.get('Items', []))
            if not result.get('LastEvaluatedKey'):
                return items
            query['ExclusiveStartKey'] = result['LastEvaluatedKey']

    def list_project_items(self, project_id: str, kind: str | None=None) -> list[dict[str, Any]]:
        values = {':project': f'PROJECT#{project_id}'}
        expression = 'GSI1PK = :project'
        if kind:
            values[':prefix'] = f'{kind}#'
            expression += ' AND begins_with(GSI1SK, :prefix)'
        query: dict[str, Any] = {'IndexName': 'ProjectIndex', 'KeyConditionExpression': expression, 'ExpressionAttributeValues': values}
        items: list[dict[str, Any]] = []
        while True:
            result = self.table.query(**query)
            items.extend(result.get('Items', []))
            last_key = result.get('LastEvaluatedKey')
            if not last_key:
                return items
            query['ExclusiveStartKey'] = last_key

    def list_batch_items(self, batch_job_id: str) -> list[dict[str, Any]]:
        result = self.table.query(IndexName='BatchIndex', KeyConditionExpression='GSI2PK = :batch', ExpressionAttributeValues={':batch': f'BATCH#{batch_job_id}'})
        return result.get('Items', [])

    def list_local_queue_candidates(self, limit: int=100) -> list[dict[str, Any]]:
        query: dict[str, Any] = {'IndexName': 'BatchIndex', 'KeyConditionExpression': 'GSI2PK = :queue', 'ExpressionAttributeValues': {':queue': 'LOCAL_QUEUE#development'}, 'Limit': max(1, min(limit, 100))}
        items: list[dict[str, Any]] = []
        while True:
            result = self.table.query(**query)
            items.extend(result.get('Items', []))
            if not result.get('LastEvaluatedKey'):
                return items
            query['ExclusiveStartKey'] = result['LastEvaluatedKey']

    def get_local_queue_config(self) -> dict[str, Any]:
        result = self.table.get_item(Key={'PK': 'SYSTEM#LOCAL_QUEUE', 'SK': 'CONFIG#development'}, ConsistentRead=True)
        item = result.get('Item') or {}
        return {'paused': bool(item.get('paused', False)), 'updatedAt': item.get('updatedAt'), 'updatedBy': item.get('updatedBy')}

    def record_local_worker_presence(self, worker_id: str, timestamp: str, seen_at_epoch: int, capabilities: list[str] | None=None, runtime_manifest: dict[str, Any] | None=None, telemetry: dict[str, Any] | None=None) -> dict[str, Any]:
        item = {'PK': 'SYSTEM#LOCAL_WORKER', 'SK': 'PRESENCE#development', 'entityType': 'LOCAL_WORKER_PRESENCE', 'workerId': worker_id, 'lastSeenAt': timestamp, 'lastSeenAtEpoch': seen_at_epoch, 'expiresAtEpoch': seen_at_epoch + 7 * 24 * 60 * 60}
        self.table.put_item(Item=dynamo_safe(item))
        names: dict[str, str] = {'#kind': 'entityType', '#worker': 'workerId', '#seen': 'lastSeenAt', '#epoch': 'lastSeenAtEpoch', '#expires': 'expiresAtEpoch'}
        values: dict[str, Any] = {':kind': 'LOCAL_WORKER_PRESENCE', ':worker': worker_id, ':seen': timestamp, ':epoch': Decimal(seen_at_epoch), ':expires': Decimal(seen_at_epoch + 7 * 24 * 60 * 60)}
        updates = ['#kind = :kind', '#worker = :worker', '#seen = :seen', '#epoch = :epoch', '#expires = :expires']
        for field, value in (('capabilities', capabilities), ('runtimeManifest', runtime_manifest), ('telemetry', telemetry)):
            if value is not None:
                names[f'#{field}'] = field
                values[f':{field}'] = dynamo_safe(value)
                updates.append(f'#{field} = :{field}')
        result = self.table.update_item(Key={'PK': 'SYSTEM#LOCAL_WORKER', 'SK': f'PRESENCE#{worker_id}'}, UpdateExpression='SET ' + ', '.join(updates), ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues='ALL_NEW')
        return result['Attributes']

    def list_local_workers(self) -> list[dict[str, Any]]:
        query: dict[str, Any] = {'KeyConditionExpression': 'PK = :pk AND begins_with(SK, :prefix)', 'ExpressionAttributeValues': {':pk': 'SYSTEM#LOCAL_WORKER', ':prefix': 'PRESENCE#'}}
        items: list[dict[str, Any]] = []
        while True:
            result = self.table.query(**query)
            items.extend((item for item in result.get('Items', []) if item.get('SK') != 'PRESENCE#development'))
            if not result.get('LastEvaluatedKey'):
                return items
            query['ExclusiveStartKey'] = result['LastEvaluatedKey']

    def get_local_worker(self, worker_id: str) -> dict[str, Any] | None:
        result = self.table.get_item(Key={'PK': 'SYSTEM#LOCAL_WORKER', 'SK': f'PRESENCE#{worker_id}'}, ConsistentRead=True)
        return result.get('Item')

    def set_job_preferred_worker(self, item: dict[str, Any], worker_id: str | None, timestamp: str) -> dict[str, Any]:
        if worker_id:
            expression = 'SET #preferred = :worker, #updated = :timestamp'
            values = {':worker': worker_id, ':timestamp': timestamp, ':queued': 'QUEUED', ':local': 'LOCAL_MAC'}
        else:
            expression = 'SET #updated = :timestamp REMOVE #preferred'
            values = {':timestamp': timestamp, ':queued': 'QUEUED', ':local': 'LOCAL_MAC'}
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression=expression, ConditionExpression='#status = :queued AND #backend = :local', ExpressionAttributeNames={'#preferred': 'preferredWorkerId', '#updated': 'updatedAt', '#status': 'status', '#backend': 'computeBackend'}, ExpressionAttributeValues=values, ReturnValues='ALL_NEW')
        return result['Attributes']

    def get_local_worker_presence(self) -> dict[str, Any] | None:
        result = self.table.get_item(Key={'PK': 'SYSTEM#LOCAL_WORKER', 'SK': 'PRESENCE#development'}, ConsistentRead=True)
        return result.get('Item')

    def set_local_queue_paused(self, paused: bool, updated_by: str, timestamp: str) -> dict[str, Any]:
        item = {'PK': 'SYSTEM#LOCAL_QUEUE', 'SK': 'CONFIG#development', 'entityType': 'LOCAL_QUEUE_CONFIG', 'paused': paused, 'updatedBy': updated_by, 'updatedAt': timestamp}
        self.table.put_item(Item=dynamo_safe(item))
        return item

    def set_local_queue_priority(self, item: dict[str, Any], priority: int, timestamp: str) -> dict[str, Any]:
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression='SET #priority = :priority, #updated = :timestamp', ConditionExpression='#backend = :local AND #status = :queued', ExpressionAttributeNames={'#priority': 'queuePriority', '#updated': 'updatedAt', '#backend': 'computeBackend', '#status': 'status'}, ExpressionAttributeValues={':priority': Decimal(priority), ':timestamp': timestamp, ':local': 'LOCAL_MAC', ':queued': 'QUEUED'}, ReturnValues='ALL_NEW')
        return result['Attributes']

    def recover_expired_local_calculation(self, item: dict[str, Any], action: str, now_epoch: int, timestamp: str, reason: str) -> dict[str, Any]:
        """Only an expired lease may be recovered; a live worker cannot be displaced."""
        names = {'#backend': 'computeBackend', '#status': 'status', '#lease': 'leaseExpiresAtEpoch', '#worker': 'localWorkerId', '#progress': 'progress', '#message': 'statusMessage', '#updated': 'updatedAt', '#count': 'recoveryCount', '#reason': 'lastRecoveryReason'}
        values: dict[str, Any] = {':local': 'LOCAL_MAC', ':running': 'RUNNING', ':now_epoch': Decimal(now_epoch), ':timestamp': timestamp, ':zero': Decimal(0), ':one': Decimal(1), ':reason': reason}
        common = '#progress = :progress, #message = :message, #updated = :timestamp, #count = if_not_exists(#count, :zero) + :one, #reason = :reason'
        if action == 'requeue':
            names.update({'#started': 'startedAt', '#preferred': 'preferredWorkerId'})
            values.update({':next_status': 'QUEUED', ':progress': Decimal(0), ':message': 'Re-queued after the previous worker lease expired', ':queue_sort': f"QUEUED#{timestamp}#{item['id']}"})
            update = f'SET #status = :next_status, {common}, GSI2SK = :queue_sort REMOVE #lease, #worker, #started, #preferred'
            condition = '#backend = :local AND #status = :running AND #lease < :now_epoch'
        elif action == 'fail-gracefully':
            names.update({'#completed': 'completedAt', '#failure': 'failureReason'})
            values.update({':cancelling': 'CANCEL_REQUESTED', ':next_status': 'FAILED', ':progress': Decimal(100), ':message': 'The worker lease expired before a result was received', ':failure': f'Worker lease expired. Operator note: {reason}'[:1000]})
            update = f'SET #status = :next_status, {common}, #completed = :timestamp, #failure = :failure ' + ('REMOVE #lease, #worker' if item.get('computeBackend') in {'CLOUD_PAID_EC2', 'CLOUD_PILOT_EC2'} else 'REMOVE GSI2PK, GSI2SK, #lease, #worker')
            condition = '#backend = :local AND (#status = :running OR #status = :cancelling) AND #lease < :now_epoch'
        else:
            raise ValueError('Unsupported recovery action')
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression=update, ConditionExpression=condition, ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues='ALL_NEW')
        return result['Attributes']

    def claim_local_calculation(self, item: dict[str, Any], worker_id: str, lease_expires_at: int, now_epoch: int, timestamp: str) -> dict[str, Any] | None:
        try:
            result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression='SET #status = :running, #progress = :progress, #worker = :worker, #lease = :lease, #started = if_not_exists(#started, :timestamp), #updated = :timestamp, #message = :message, GSI2SK = :lease_sort', ConditionExpression='#backend = :local AND (attribute_not_exists(#preferred) OR #preferred = :worker) AND (#status = :queued OR (#status = :running AND #lease < :now))', ExpressionAttributeNames={'#status': 'status', '#progress': 'progress', '#worker': 'localWorkerId', '#lease': 'leaseExpiresAtEpoch', '#started': 'startedAt', '#updated': 'updatedAt', '#backend': 'computeBackend', '#message': 'statusMessage', '#preferred': 'preferredWorkerId'}, ExpressionAttributeValues={':running': 'RUNNING', ':queued': 'QUEUED', ':progress': Decimal(12), ':worker': worker_id, ':lease': Decimal(lease_expires_at), ':now': Decimal(now_epoch), ':timestamp': timestamp, ':local': 'LOCAL_MAC', ':message': 'Preparing the local compute workspace', ':lease_sort': f"LEASED#{lease_expires_at:012d}#{item['id']}"}, ReturnValues='ALL_NEW')
            return result['Attributes']
        except Exception as exc:
            error = getattr(exc, 'response', {}).get('Error', {})
            if error.get('Code') == 'ConditionalCheckFailedException':
                return None
            raise

    def heartbeat_local_calculation(self, item: dict[str, Any], worker_id: str, lease_expires_at: int, progress: int, stage: str | None, log_tail: str | None, timestamp: str, scf_convergence: dict[str, Any] | None=None, effective_resources: dict[str, int] | None=None, compute_phase: str | None=None) -> dict[str, Any]:
        update_expression = 'SET #progress = :progress, #lease = :lease, #updated = :timestamp, GSI2SK = :lease_sort'
        names = {'#status': 'status', '#progress': 'progress', '#worker': 'localWorkerId', '#lease': 'leaseExpiresAtEpoch', '#updated': 'updatedAt', '#backend': 'computeBackend'}
        values: dict[str, Any] = {':running': 'RUNNING', ':cancel_requested': 'CANCEL_REQUESTED', ':progress': Decimal(progress), ':worker': worker_id, ':lease': Decimal(lease_expires_at), ':timestamp': timestamp, ':local': item.get('computeBackend', 'LOCAL_MAC'), ':lease_sort': f"LEASED#{lease_expires_at:012d}#{item['id']}"}
        if scf_convergence is not None:
            names['#scf'] = 'scfConvergence'
            values[':scf'] = json.loads(json.dumps(scf_convergence), parse_float=Decimal)
            update_expression += ', #scf = :scf'
        for field, value in (effective_resources or {}).items():
            names[f'#{field}'] = field
            values[f':{field}'] = Decimal(value)
            update_expression += f', #{field} = :{field}'
        if compute_phase is not None:
            names['#phase'] = 'computePhase'
            values[':phase'] = compute_phase
            update_expression += ', #phase = :phase'
        if stage:
            names['#stage'] = 'statusMessage'
            values[':stage'] = stage
            update_expression += ', #stage = :stage'
        if log_tail is not None:
            names['#log_tail'] = 'logTail'
            values[':log_tail'] = log_tail
            update_expression += ', #log_tail = :log_tail'
            if log_tail and log_tail != item.get('logTail'):
                names['#last_output'] = 'lastReportedOutputAt'
                update_expression += ', #last_output = :timestamp'
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression=update_expression, ConditionExpression='#backend = :local AND #worker = :worker AND (#status = :running OR #status = :cancel_requested)', ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues='ALL_NEW')
        return result['Attributes']

    def finish_local_calculation(self, item: dict[str, Any], worker_id: str, status: str, failure_reason: str | None, timestamp: str, effective_resources: dict[str, int] | None=None, log_tail: str | None=None) -> dict[str, Any]:
        artifacts_expire_at, artifacts_expire_at_epoch = calculation_artifact_expiry(timestamp)
        names = {'#status': 'status', '#progress': 'progress', '#worker': 'localWorkerId', '#updated': 'updatedAt', '#completed': 'completedAt', '#backend': 'computeBackend', '#lease': 'leaseExpiresAtEpoch', '#log_tail': 'logTail', '#artifacts_expire_at': 'artifactsExpireAt', '#artifacts_expire_epoch': 'artifactsExpireAtEpoch', '#phase': 'computePhase'}
        values: dict[str, Any] = {':status': status, ':progress': Decimal(100), ':worker': worker_id, ':timestamp': timestamp, ':local': item.get('computeBackend', 'LOCAL_MAC'), ':running': 'RUNNING', ':cancel_requested': 'CANCEL_REQUESTED', ':artifacts_expire_at': artifacts_expire_at, ':artifacts_expire_epoch': Decimal(artifacts_expire_at_epoch), ':phase': 'FINISHED'}
        assignments = '#status = :status, #progress = :progress, #updated = :timestamp, #completed = :timestamp, #message = :message, #phase = :phase, #artifacts_expire_at = :artifacts_expire_at, #artifacts_expire_epoch = :artifacts_expire_epoch'
        names['#message'] = 'statusMessage'
        destination = 'paid cloud' if item.get('computeBackend') in {'CLOUD_PAID_EC2', 'CLOUD_PILOT_EC2'} else 'Cloud pilot' if item.get('computeBackend') == 'CLOUD_EC2' else 'your computer'
        values[':message'] = f'Completed on {destination}' if status == 'COMPLETED' else f'Cancelled on {destination}' if status == 'CANCELLED' else f'Calculation failed on {destination}'
        if failure_reason:
            names['#failure'] = 'failureReason'
            values[':failure'] = failure_reason
            assignments += ', #failure = :failure'
        # Retain bounded terminal diagnostics even when the solver exits before
        # its next heartbeat. Successful jobs keep their logs in artifacts only.
        terminal_log = log_tail or item.get('logTail')
        retain_log = status in {'FAILED', 'CANCELLED'} and isinstance(terminal_log, str) and bool(terminal_log)
        if retain_log:
            values[':log_tail'] = terminal_log.replace('\x00', '')[-4000:]
            assignments += ', #log_tail = :log_tail'
        for field, value in (effective_resources or {}).items():
            names[f'#{field}'] = field
            values[f':{field}'] = Decimal(value)
            assignments += f', #{field} = :{field}'
        removals = ['#lease'] if item.get('computeBackend') in {'CLOUD_PAID_EC2', 'CLOUD_PILOT_EC2'} else ['GSI2PK', 'GSI2SK', '#lease']
        if not retain_log:
            removals.append('#log_tail')
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression=f'SET {assignments} REMOVE ' + ', '.join(removals), ConditionExpression='#backend = :local AND #worker = :worker AND (#status = :running OR #status = :cancel_requested)', ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues='ALL_NEW')
        return result['Attributes']

    def cancel_queued_local_calculation(self, item: dict[str, Any], timestamp: str) -> dict[str, Any]:
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression='SET #status = :cancelled, #progress = :progress, #message = :message, #completed = :timestamp, #updated = :timestamp' + ('' if item.get('computeBackend') in {'CLOUD_PAID_EC2', 'CLOUD_PILOT_EC2'} else ' REMOVE GSI2PK, GSI2SK'), ConditionExpression='#backend = :local AND #status = :queued', ExpressionAttributeNames={'#status': 'status', '#progress': 'progress', '#message': 'statusMessage', '#completed': 'completedAt', '#updated': 'updatedAt', '#backend': 'computeBackend'}, ExpressionAttributeValues={':cancelled': 'CANCELLED', ':queued': 'QUEUED', ':progress': Decimal(100), ':message': 'Cancelled before local execution', ':timestamp': timestamp, ':local': item.get('computeBackend', 'LOCAL_MAC')}, ReturnValues='ALL_NEW')
        return result['Attributes']

    def request_running_local_calculation_cancel(self, item: dict[str, Any], message: str, timestamp: str) -> dict[str, Any]:
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression='SET #status = :cancel_requested, #message = :message, #updated = :timestamp', ConditionExpression='#backend = :local AND (#status = :running OR #status = :cancel_requested)', ExpressionAttributeNames={'#status': 'status', '#message': 'statusMessage', '#updated': 'updatedAt', '#backend': 'computeBackend'}, ExpressionAttributeValues={':cancel_requested': 'CANCEL_REQUESTED', ':running': 'RUNNING', ':local': item.get('computeBackend', 'LOCAL_MAC'), ':message': message, ':timestamp': timestamp}, ReturnValues='ALL_NEW')
        return result['Attributes']

    def cancel_expired_local_calculation(self, item: dict[str, Any], now_epoch: int, timestamp: str) -> dict[str, Any]:
        result = self.table.update_item(Key={'PK': item['PK'], 'SK': item['SK']}, UpdateExpression='SET #status = :cancelled, #progress = :progress, #message = :message, #completed = :timestamp, #updated = :timestamp ' + ('REMOVE #lease, #worker' if item.get('computeBackend') in {'CLOUD_PAID_EC2', 'CLOUD_PILOT_EC2'} else 'REMOVE GSI2PK, GSI2SK, #lease, #worker'), ConditionExpression='#backend = :local AND (#status = :running OR #status = :cancel_requested) AND (attribute_not_exists(#lease) OR #lease < :now)', ExpressionAttributeNames={'#status': 'status', '#progress': 'progress', '#message': 'statusMessage', '#completed': 'completedAt', '#updated': 'updatedAt', '#backend': 'computeBackend', '#lease': 'leaseExpiresAtEpoch', '#worker': 'localWorkerId'}, ExpressionAttributeValues={':cancelled': 'CANCELLED', ':running': 'RUNNING', ':cancel_requested': 'CANCEL_REQUESTED', ':progress': Decimal(100), ':message': 'Cancelled after the local worker lease expired', ':timestamp': timestamp, ':now': Decimal(now_epoch), ':local': item.get('computeBackend', 'LOCAL_MAC')}, ReturnValues='ALL_NEW')
        return result['Attributes']

    def delete_project(self, user_id: str, project_id: str, children: list[dict[str, Any]]) -> None:
        with self.table.batch_writer() as writer:
            for item in children:
                writer.delete_item(Key={'PK': item['PK'], 'SK': item['SK']})
            writer.delete_item(Key={'PK': owner_partition(user_id), 'SK': f'PROJECT#{project_id}'})

    def delete_s3_prefix(self, prefix: str) -> None:
        continuation: str | None = None
        while True:
            kwargs: dict[str, Any] = {'Bucket': self.bucket, 'Prefix': prefix}
            if continuation:
                kwargs['ContinuationToken'] = continuation
            result = self.s3.list_objects_v2(**kwargs)
            objects = [{'Key': item['Key']} for item in result.get('Contents', [])]
            if objects:
                deleted = self.s3.delete_objects(Bucket=self.bucket, Delete={'Objects': objects})
                if deleted.get('Errors'):
                    raise ApiError(503, 'Some files could not be deleted. Try again.', 'ARTIFACT_DELETE_INCOMPLETE')
            if not result.get('IsTruncated'):
                return
            continuation = result.get('NextContinuationToken')

def public_item(item: dict[str, Any]) -> dict[str, Any]:
    hidden = {'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'ownerId', 'objectKey', 'inputKey', 'uploadId', 'multipartUploadId', 'outputPrefix', 'localWorkerId', 'leaseExpiresAtEpoch', 'idempotencyKey', 'requestFingerprint', 'computeRequestFingerprint', 'workerTokenHash', 'lastClientMutationId'}
    return json_safe({key: value for key, value in item.items() if key not in hidden})

def require_project(services: MetadataServices, user_id: str, project_id: str, *, allow_deleting: bool=False) -> dict[str, Any]:
    require_id(project_id, 'project ID')
    project = services.get_item(user_id, 'PROJECT', project_id)
    if not project:
        raise ApiError(404, 'Project was not found.', 'PROJECT_NOT_FOUND')
    if project.get('deleting') and (not allow_deleting):
        raise ApiError(409, 'Project deletion is in progress. Retry after cleanup.', 'PROJECT_DELETING')
    return project

def require_owner_item(services: MetadataServices, user_id: str, kind: str, item_id: str, not_found_code: str) -> dict[str, Any]:
    require_id(item_id, f'{kind.lower()} ID')
    item = services.get_item(user_id, kind, item_id)
    if not item:
        raise ApiError(404, f'{kind.title()} was not found.', not_found_code)
    return item

def query_filter(query: str) -> tuple[str, str]:
    if re.fullmatch('mp-[a-z0-9]+', query, flags=re.IGNORECASE):
        return ('material_ids', query.lower())
    if re.fullmatch('[A-Z][a-z]?(?:-[A-Z][a-z]?)+', query):
        return ('chemsys', query)
    if re.fullmatch('[A-Z][a-z]?(?:[ ,]+[A-Z][a-z]?)+', query):
        return ('elements', ','.join(filter(None, re.split('[ ,]+', query))))
    return ('formula', query)

def finite(value: Any, fallback: float=0) -> float:
    if isinstance(value, (int, float)) and (not isinstance(value, bool)):
        return float(value)
    return fallback

def normalize_mp_document(document: dict[str, Any]) -> dict[str, Any] | None:
    structure = document.get('structure') or {}
    lattice = structure.get('lattice') or {}
    sites = structure.get('sites') or []
    material_id = document.get('material_id')
    formula = document.get('formula_pretty')
    if not material_id or not formula or (not lattice) or (not sites):
        return None
    symmetry = document.get('symmetry') or {}
    atoms = []
    for index, site in enumerate(sites):
        species = [{'element': entry.get('element') or 'X', 'species': entry.get('element') or 'X', 'occupancy': finite(entry.get('occu'), 1)} for entry in site.get('species') or [] if finite(entry.get('occu'), 1) > 0]
        selected = max(species, key=lambda entry: entry['occupancy'], default={})
        abc = site.get('abc') or [0, 0, 0]
        atoms.append({'id': f'{material_id}-site-{index + 1}', 'species': selected.get('element') or site.get('label') or 'X', 'label': site.get('label') or f'site-{index + 1}', 'x': finite(abc[0] if len(abc) > 0 else 0), 'y': finite(abc[1] if len(abc) > 1 else 0), 'z': finite(abc[2] if len(abc) > 2 else 0), 'occupancy': finite(selected.get('occupancy'), 1), 'siteSpecies': species})
    return {'materialId': material_id, 'formula': formula, 'spaceGroupSymbol': symmetry.get('symbol') or 'P1', 'spaceGroupNumber': int(finite(symmetry.get('number'), 1)), 'crystalSystem': symmetry.get('crystal_system') or 'unknown', 'numSites': int(finite(document.get('nsites'), len(sites))), 'bandGap': finite(document.get('band_gap')), 'energyAboveHull': finite(document.get('energy_above_hull')), 'isStable': bool(document.get('is_stable')), 'density': finite(document.get('density')), 'magneticOrdering': document.get('ordering') or 'Unknown', 'theoretical': bool(document.get('theoretical')), 'lastUpdated': document.get('last_updated'), 'lattice': {'a': finite(lattice.get('a'), 1), 'b': finite(lattice.get('b'), 1), 'c': finite(lattice.get('c'), 1), 'alpha': finite(lattice.get('alpha'), 90), 'beta': finite(lattice.get('beta'), 90), 'gamma': finite(lattice.get('gamma'), 90)}, 'atoms': atoms}

def fetch_materials_project(services: MetadataServices, query: str, limit: int) -> list[dict[str, Any]]:
    if not query or len(query) > 80 or (not MP_QUERY_PATTERN.fullmatch(query)):
        raise ApiError(400, 'Use a formula, element list, chemical system, or MP-ID.', 'INVALID_MATERIAL_QUERY')
    filter_key, filter_value = query_filter(query)
    normalized_limit = max(1, min(30, limit))
    cached = services.read_materials_cache(query, normalized_limit)
    if cached is not None:
        return cached
    local_search = getattr(services, 'materials_project_search', None)
    if callable(local_search):
        # The local service resolves Settings credentials in its OS vault. Keep
        # the legacy import path on that transport as well as the new browser.
        payload = local_search(query, normalized_limit)
        remaining_header = None
    else:
        fields = ','.join(['material_id', 'formula_pretty', 'structure', 'symmetry', 'nsites', 'band_gap', 'energy_above_hull', 'is_stable', 'density', 'ordering', 'theoretical', 'last_updated'])
        params = urllib.parse.urlencode({filter_key: filter_value, '_fields': fields, '_limit': str(normalized_limit), '_sort_fields': 'energy_above_hull'})
        request = urllib.request.Request(f'https://api.materialsproject.org/materials/summary/?{params}', headers={'X-API-KEY': materials_project_api_key(), 'Accept': 'application/json', 'User-Agent': 'phynite-lab/1.0'})
        try:
            from backend.local_api.tls import verified_ssl_context
            with urllib.request.urlopen(request, timeout=15, context=verified_ssl_context()) as upstream:
                payload = json.loads(upstream.read().decode('utf-8'))
                remaining_header = upstream.headers.get('X-RateLimit-Remaining')
        except urllib.error.HTTPError as exc:
            raise ApiError(exc.code, 'Materials Project rejected the request.', 'MP_API_ERROR') from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise ApiError(502, 'Materials Project is temporarily unavailable.', 'MP_NETWORK_ERROR') from exc
    normalized = [normalize_mp_document(item) for item in payload.get('data', [])]
    materials = [item for item in normalized if item is not None]
    try:
        remaining = int(remaining_header) if remaining_header is not None else None
        services.record_materials_request(remaining if remaining is not None and remaining >= 0 else None)
        services.write_materials_cache(query, normalized_limit, materials)
    except Exception:
        logging.getLogger(__name__).exception('Materials Project cache or usage recording failed')
    return materials

def materials_project_api_key(secret_arn: str='') -> str:
    value = os.environ.get('MP_API_KEY', '').strip()
    if not value:
        raise ApiError(503, 'Configure your Materials Project API key to search its catalogue.', 'MP_API_KEY_MISSING')
    return value
