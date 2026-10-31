"""Bounded pages of the complete, owner-scoped result artifact inventory."""
from __future__ import annotations
import base64
import hashlib
import json
import re
from typing import Any
from backend.local_api.domain.phynite_core import ApiError, retained_locally
MAX_RESULT_MANIFEST_BYTES = 8000000
MAX_RESULT_ARTIFACTS = 10000
ARTIFACT_PAGE_SIZE = 100

def read_result_manifest(services: Any, item: dict[str, Any]) -> tuple[dict[str, Any], str]:
    raw = services.s3.get_object(Bucket=services.bucket, Key=f"{item['outputPrefix']}/result.json")['Body'].read(MAX_RESULT_MANIFEST_BYTES + 1)
    if len(raw) > MAX_RESULT_MANIFEST_BYTES:
        raise ApiError(422, 'The result manifest exceeds the supported size.', 'RESULT_MANIFEST_TOO_LARGE')
    manifest = json.loads(raw)
    if not isinstance(manifest, dict) or manifest.get('calculationId') != item['id']:
        raise ApiError(409, 'The retained result does not match this calculation.', 'RESULT_MISMATCH')
    return (manifest, hashlib.sha256(raw).hexdigest())

def artifact_page(services: Any, item: dict[str, Any], manifest: dict[str, Any], digest: str, cursor: str | None=None) -> dict[str, Any]:
    raw_artifacts = manifest.get('artifacts', [])
    if not isinstance(raw_artifacts, list) or len(raw_artifacts) > MAX_RESULT_ARTIFACTS:
        raise ApiError(409, 'The result artifact inventory is invalid.', 'RESULT_ARTIFACTS_INVALID')
    offset = 0
    if cursor is not None:
        try:
            if not isinstance(cursor, str) or len(cursor) > 300:
                raise ValueError()
            decoded = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
            offset = decoded['offset']
            if type(offset) is not int or not 0 <= offset < len(raw_artifacts) or offset % ARTIFACT_PAGE_SIZE or (decoded['manifestSha256'] != digest):
                raise ValueError()
        except Exception as exc:
            raise ApiError(409, 'The artifact page is invalid or its result changed. Reload the first page.', 'RESULT_PAGE_CHANGED') from exc
    paths: set[str] = set()
    for artifact in raw_artifacts:
        path = artifact.get('path') if isinstance(artifact, dict) else None
        if not isinstance(path, str) or not re.fullmatch('[A-Za-z0-9_.+\\-/]+', path) or path.startswith('/') or any((part in {'', '.', '..'} for part in path.split('/'))) or (path in paths):
            raise ApiError(409, 'The result artifact inventory has an unsafe or duplicated path.', 'RESULT_ARTIFACTS_INVALID')
        paths.add(path)
    artifacts = []
    for source in raw_artifacts[offset:offset + ARTIFACT_PAGE_SIZE]:
        artifact = {key: value for key, value in source.items() if key not in {'downloadUrl', 'viewUrl'}}
        path = artifact['path']
        params = {'Bucket': services.bucket, 'Key': f"{item['outputPrefix']}/{path}"}
        filename = re.sub('[^A-Za-z0-9._-]', '_', path.rsplit('/', 1)[-1])
        artifact['viewUrl'] = services.s3.generate_presigned_url('get_object', Params=params, ExpiresIn=900)
        artifact['downloadUrl'] = services.s3.generate_presigned_url('get_object', Params={**params, 'ResponseContentDisposition': f'attachment; filename="{filename}"', 'ResponseContentType': 'application/octet-stream'}, ExpiresIn=900)
        artifacts.append(artifact)
    next_offset = offset + len(artifacts)
    next_cursor = base64.urlsafe_b64encode(json.dumps({'offset': next_offset, 'manifestSha256': digest}, separators=(',', ':')).encode()).decode().rstrip('=') if next_offset < len(raw_artifacts) else None
    return {'artifacts': artifacts, 'totalArtifacts': len(raw_artifacts), 'nextCursor': next_cursor, 'manifestSha256': digest}
