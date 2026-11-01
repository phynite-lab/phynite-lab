"""Checksummed filesystem objects implementing the storage contract, without S3."""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import secrets
import tempfile
import time
from pathlib import Path
from typing import Any

from .sqlite_store import SQLiteTable, StorageError


class ObjectBody:
    def __init__(self, path: Path, offset: int, size: int):
        self.file = path.open("rb"); self.file.seek(offset); self.remaining = size

    def read(self, amt: int | None = None):
        if self.remaining == 0:
            self.file.close()
            return b""
        wanted = self.remaining if amt is None or amt < 0 else min(amt, self.remaining)
        result = self.file.read(wanted)
        if len(result) != wanted:
            self.file.close()
            raise OSError('Stored artifact was truncated')
        self.remaining -= len(result)
        if self.remaining == 0:
            self.file.close()
        return result

    def iter_chunks(self, chunk_size: int = 1024 * 1024):
        while self.remaining:
            value = self.read(chunk_size)
            if not value:
                raise OSError("Stored artifact was truncated")
            yield value

    def close(self):
        self.file.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class FilesystemObjects:
    def __init__(self, root: Path, table: SQLiteTable, bucket: str, origin: str, signing_key: bytes):
        self.root = root.resolve(); self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.table, self.bucket, self.origin, self.signing_key = table, bucket, origin, signing_key
        self.exceptions = type("Exceptions", (), {"ClientError": StorageError, "NoSuchKey": StorageError, "NoSuchUpload": StorageError})

    def key(self, bucket: str, key: str) -> dict:
        if bucket != self.bucket or not isinstance(key, str) or not key or "\x00" in key or key.startswith("/") or ".." in key.split("/"):
            raise StorageError("AccessDenied", "Invalid local artifact identity")
        return {"PK": f"OBJECT#{bucket}", "SK": key}

    def metadata(self, bucket: str, key: str, version: str | None = None) -> dict:
        lookup = self.key(bucket, key)
        if version:
            lookup = {"PK": f"OBJECT_VERSION#{bucket}#{key}", "SK": version}
        item = self.table.get_item(Key=lookup).get("Item")
        if not item:
            raise StorageError("NoSuchKey", "The local artifact does not exist")
        return item

    def put_object(self, *, Bucket: str, Key: str, Body: Any, **options) -> dict:
        identity = self.key(Bucket, Key)
        source = io.BytesIO(Body.encode() if isinstance(Body, str) else Body) if isinstance(Body, (str, bytes, bytearray)) else Body
        if not hasattr(source, "read"):
            raise ValueError("Artifact body must be a readable stream")
        digest = hashlib.sha256(); size = 0
        descriptor, name = tempfile.mkstemp(prefix=".upload-", dir=self.root)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk); digest.update(chunk); output.write(chunk)
                output.flush(); os.fsync(output.fileno())
            encoded = base64.b64encode(digest.digest()).decode(); sha = digest.hexdigest()
            if options.get("ContentLength") is not None and size != options["ContentLength"]:
                raise StorageError("BadDigest", "Artifact size differs from the declared size")
            expected = options.get("ChecksumSHA256")
            expected_hex = options.get("Metadata", {}).get("sha256")
            if expected and not hmac.compare_digest(expected, encoded) or expected_hex and not hmac.compare_digest(expected_hex, sha):
                raise StorageError("BadDigest", "Artifact checksum verification failed")
            destination = self.root / sha[:2] / sha
            destination.parent.mkdir(mode=0o700, exist_ok=True)
            # A prior file bearing this digest might have been damaged. Replace
            # it with the freshly hashed bytes, rather than trusting its name.
            os.replace(temporary, destination); destination.chmod(0o600)
            metadata = {"size": size, "sha256": sha, "contentType": options.get("ContentType", "application/octet-stream"), "metadata": options.get("Metadata", {}), "modified": int(time.time())}
            with self.table.atomic():
                self.table.put_item(Item={**identity, **metadata})
                self.table.put_item(Item={"PK": f"OBJECT_VERSION#{Bucket}#{Key}", "SK": sha, **metadata})
            return {"ETag": f'"{sha}"', "VersionId": sha, "ChecksumSHA256": encoded}
        finally:
            temporary.unlink(missing_ok=True)

    def head_object(self, *, Bucket: str, Key: str, VersionId: str | None = None, **_) -> dict:
        item = self.metadata(Bucket, Key, VersionId)
        return {"ContentLength": item["size"], "ContentType": item["contentType"], "Metadata": item["metadata"], "VersionId": item["sha256"], "ETag": f'"{item["sha256"]}"', "ChecksumSHA256": item.get('checksumSHA256', base64.b64encode(bytes.fromhex(item["sha256"])).decode()), 'ChecksumType': item.get('checksumType', 'FULL_OBJECT')}

    def get_object(self, *, Bucket: str, Key: str, VersionId: str | None = None, Range: str | None = None, IfMatch: str | None = None, **_) -> dict:
        item = self.metadata(Bucket, Key, VersionId)
        result = self.head_object(Bucket=Bucket, Key=Key, VersionId=item['sha256'])
        if IfMatch is not None and result['ETag'] != IfMatch:
            raise StorageError('PreconditionFailed', 'The artifact changed before the transfer. Retry from the saved version.')
        start, end = 0, item["size"] - 1
        if Range:
            import re
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", Range)
            if not match or not any(match.groups()):
                raise StorageError("InvalidRange", "Unsupported byte range")
            if match[1]:
                start = int(match[1]); end = min(end, int(match[2])) if match[2] else end
            else:
                start = max(0, item["size"] - int(match[2]))
            if start > end or start >= item["size"]:
                raise StorageError("InvalidRange", "Byte range exceeds the artifact")
            result["ContentRange"] = f"bytes {start}-{end}/{item['size']}"
        result["ContentLength"] = max(0, end - start + 1)
        result["Body"] = ObjectBody(self.root / item["sha256"][:2] / item["sha256"], start, result["ContentLength"])
        return result

    def delete_object(self, *, Bucket: str, Key: str, **_) -> dict:
        self.table.delete_item(Key=self.key(Bucket, Key))
        # Immutable bytes remain available to versioned snapshots and recovery.
        return {}

    def delete_objects(self, *, Bucket: str, Delete: dict, **_) -> dict:
        with self.table.atomic():
            for item in Delete["Objects"]:
                self.delete_object(Bucket=Bucket, Key=item["Key"])
        return {"Deleted": Delete["Objects"]}

    def list_objects_v2(self, *, Bucket: str, Prefix: str = "", ContinuationToken: str | None = None, MaxKeys: int = 1000, **_) -> dict:
        self.key(Bucket, Prefix or "_")
        items = self.table.query(KeyConditionExpression="PK = :pk AND begins_with(SK, :prefix)", ExpressionAttributeValues={":pk": f"OBJECT#{Bucket}", ":prefix": Prefix})["Items"]
        items = [item for item in items if ContinuationToken is None or item["SK"] > ContinuationToken]
        page = items[:MaxKeys]
        return {"Contents": [{"Key": item["SK"], "Size": item["size"], "ETag": f'"{item["sha256"]}"'} for item in page], "IsTruncated": len(items) > len(page), **({"NextContinuationToken": page[-1]["SK"]} if len(items) > len(page) and page else {})}

    def ticket(self, operation: str, params: dict, expires: int = 900) -> str:
        if operation not in {"get_object", "put_object", "post_object", "upload_part"}:
            raise ValueError("Unsupported artifact operation")
        self.key(params["Bucket"], params["Key"])
        payload = base64.urlsafe_b64encode(json.dumps({"operation": operation, "params": params, "expires": int(time.time()) + min(3600, expires)}, separators=(",", ":")).encode()).decode().rstrip("=")
        signature = hmac.new(self.signing_key, payload.encode(), "sha256").hexdigest()
        headers = ["content-type"] if operation == "put_object" else []
        if params.get("ChecksumSHA256"):
            headers.append("x-amz-checksum-sha256")
        return f"{self.origin}/__local/artifacts?ticket={payload}.{signature}&Phynite-Signed-Headers={';'.join(headers)}"

    def verify_ticket(self, raw: str, method: str) -> dict:
        payload, _, signature = raw.partition(".")
        if not hmac.compare_digest(signature, hmac.new(self.signing_key, payload.encode(), "sha256").hexdigest()):
            raise StorageError("AccessDenied", "Artifact ticket is invalid")
        ticket = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        expected = {"get_object": "GET", "put_object": "PUT", "post_object": "POST", "upload_part": "PUT"}
        if expected.get(ticket["operation"]) != method or ticket["expires"] <= time.time():
            raise StorageError("AccessDenied", "Artifact ticket expired or has the wrong operation")
        self.key(ticket["params"]["Bucket"], ticket["params"]["Key"])
        return ticket

    def generate_presigned_url(self, operation, Params, ExpiresIn=900, **_):
        return self.ticket(operation, Params, ExpiresIn)

    def generate_presigned_post(self, Bucket, Key, Fields=None, Conditions=None, ExpiresIn=900):
        return {"url": self.ticket("post_object", {"Bucket": Bucket, "Key": Key, "Fields": Fields or {}, "Conditions": Conditions or []}, ExpiresIn), "fields": {"key": Key, **(Fields or {})}}

    def create_multipart_upload(self, *, Bucket: str, Key: str, **options) -> dict:
        self.key(Bucket, Key); upload = secrets.token_hex(24)
        self.table.put_item(Item={"PK": "MULTIPART", "SK": upload, "bucket": Bucket, "key": Key, "options": options})
        return {"UploadId": upload}

    def upload_part(self, *, Bucket: str, Key: str, UploadId: str, PartNumber: int, Body: Any, **options) -> dict:
        upload = self.table.get_item(Key={"PK": "MULTIPART", "SK": UploadId}).get("Item", {})
        if upload.get("bucket") != Bucket or upload.get("key") != Key or not 1 <= PartNumber <= 10000:
            raise StorageError("NoSuchUpload", "Multipart upload does not belong to this artifact")
        part_key = f"__multipart/{UploadId}/{PartNumber:05d}"
        result = self.put_object(Bucket=Bucket, Key=part_key, Body=Body, **options)
        return result

    def complete_multipart_upload(self, *, Bucket: str, Key: str, UploadId: str, MultipartUpload: dict, **_) -> dict:
        upload = self.table.get_item(Key={"PK": "MULTIPART", "SK": UploadId}).get("Item", {})
        if upload.get("bucket") != Bucket or upload.get("key") != Key:
            raise StorageError("NoSuchUpload", "Unknown multipart upload")
        with tempfile.TemporaryFile() as output:
            previous = 0; part_hashes = []
            for part in MultipartUpload["Parts"]:
                number = part["PartNumber"]
                if number <= previous:
                    raise ValueError("Multipart parts must be unique and ordered")
                item = self.get_object(Bucket=Bucket, Key=f"__multipart/{UploadId}/{number:05d}")
                if item["ETag"] != part["ETag"]:
                    item["Body"].close(); raise StorageError("InvalidPart", "Multipart part checksum changed")
                if part.get('ChecksumSHA256') and part['ChecksumSHA256'] != item['ChecksumSHA256']:
                    item['Body'].close(); raise StorageError('InvalidPart', 'Multipart part checksum changed')
                part_hashes.append(base64.b64decode(item['ChecksumSHA256']))
                with item["Body"] as source:
                    for chunk in source.iter_chunks():
                        output.write(chunk)
                previous = number
            output.seek(0); result = self.put_object(Bucket=Bucket, Key=Key, Body=output, **upload["options"])
        composite = base64.b64encode(hashlib.sha256(b''.join(part_hashes)).digest()).decode() + '-' + str(len(part_hashes))
        with self.table.atomic():
            meta = self.metadata(Bucket, Key)
            updates = {**meta, 'checksumSHA256': composite, 'checksumType': 'COMPOSITE'}
            self.table.put_item(Item=updates)
            self.table.put_item(Item={**updates, 'PK': f'OBJECT_VERSION#{Bucket}#{Key}', 'SK': meta['sha256']})
        result.update(ChecksumSHA256=composite, ChecksumType='COMPOSITE')
        self.abort_multipart_upload(Bucket=Bucket, Key=Key, UploadId=UploadId)
        return result

    def abort_multipart_upload(self, *, Bucket: str, Key: str, UploadId: str, **_) -> dict:
        upload = self.table.get_item(Key={"PK": "MULTIPART", "SK": UploadId}).get("Item", {})
        if upload and (upload.get("bucket") != Bucket or upload.get("key") != Key):
            raise StorageError("AccessDenied", "Multipart upload belongs to another artifact")
        self.table.delete_item(Key={"PK": "MULTIPART", "SK": UploadId})
        for part in self.list_objects_v2(Bucket=Bucket, Prefix=f"__multipart/{UploadId}/", MaxKeys=10000)["Contents"]:
            self.delete_object(Bucket=Bucket, Key=part["Key"])
        return {}

    def list_parts(self, *, Bucket: str, Key: str, UploadId: str, PartNumberMarker: int = 0, MaxParts: int = 1000, **_) -> dict:
        upload = self.table.get_item(Key={'PK': 'MULTIPART', 'SK': UploadId}).get('Item', {})
        if upload.get('bucket') != Bucket or upload.get('key') != Key:
            raise StorageError('NoSuchUpload', 'Unknown multipart upload')
        if type(MaxParts) is not int or not 1 <= MaxParts <= 1000 or type(PartNumberMarker) is not int or PartNumberMarker < 0:
            raise ValueError('Invalid multipart pagination')
        items = self.list_objects_v2(Bucket=Bucket, Prefix=f'__multipart/{UploadId}/', MaxKeys=10000)['Contents']
        parts = [{'PartNumber': int(item['Key'].rsplit('/', 1)[-1]), 'Size': item['Size'], 'ETag': item['ETag'], 'ChecksumSHA256': self.head_object(Bucket=Bucket, Key=item['Key'])['ChecksumSHA256']} for item in items if int(item['Key'].rsplit('/', 1)[-1]) > PartNumberMarker]
        selected = parts[:MaxParts]; truncated = len(parts) > len(selected)
        return {'Parts': selected, 'IsTruncated': truncated, **({'NextPartNumberMarker': selected[-1]['PartNumber']} if truncated else {})}

    def put_object_tagging(self, *, Bucket: str, Key: str, Tagging: dict, **_) -> dict:
        with self.table.atomic():
            item = self.metadata(Bucket, Key)
            self.table.put_item(Item={**item, 'tags': Tagging})
        return {}
