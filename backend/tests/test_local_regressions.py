"""Regression coverage for local artifact transport and project snapshots."""
from __future__ import annotations

import base64
import hashlib
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from http.client import HTTPConnection

from backend.local_api.archives import restore_snapshot
from backend.local_api.desktop_server import DesktopApplication, handler_for
from backend.local_api.services import LocalServices
from backend.local_api.snapshots import build_project_snapshot
from backend.local_api.domain.ai_attachments import AiAttachments
from backend.local_api.domain.phynite_core import owner_partition, storage_owner
from backend.local_api.domain.api import PhyniteApi


class LocalArtifactTransportRegressionTests(unittest.TestCase):
    def test_signed_put_over_64_mib_streams_and_publishes_exact_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            reserve = ThreadingHTTPServer(("127.0.0.1", 0), handler_for)
            port = reserve.server_address[1]
            reserve.server_close()
            app = DesktopApplication(Path(directory), port, "http://127.0.0.1:3000")
            server = ThreadingHTTPServer(("127.0.0.1", port), handler_for(app))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                size = 65 * 1024**2
                block = b"P" * (1024**2)
                digest = hashlib.sha256()
                for _ in range(size // len(block)):
                    digest.update(block)
                checksum = base64.b64encode(digest.digest()).decode()
                key = "users/test/large-result.bin"
                target = urlsplit(app.services.s3.generate_presigned_url("put_object", Params={
                    "Bucket": app.services.bucket, "Key": key, "ContentLength": size,
                    "ContentType": "application/octet-stream", "ChecksumSHA256": checksum,
                }))
                connection = HTTPConnection("127.0.0.1", port, timeout=60)
                connection.putrequest("PUT", target.path + "?" + target.query)
                connection.putheader("Host", f"127.0.0.1:{port}")
                connection.putheader("Content-Length", str(size))
                connection.putheader("Content-Type", "application/octet-stream")
                connection.putheader("x-amz-checksum-sha256", checksum)
                connection.endheaders()
                for _ in range(size // len(block)):
                    connection.send(block)
                reply = connection.getresponse()
                self.assertEqual(reply.status, 200, reply.read())
                connection.close()
                self.assertEqual(app.services.s3.head_object(Bucket=app.services.bucket, Key=key)["ContentLength"], size)
            finally:
                server.shutdown()
                server.server_close()
                app.close()
                thread.join()


class LocalAttachmentSnapshotRegressionTests(unittest.TestCase):
    def test_ai_attachment_derived_artifacts_survive_project_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = LocalServices(root / "source", "http://127.0.0.1:49160", "http://127.0.0.1:3000")
            owner = source.owner
            project, conversation, attachment = "p", "aic_fixture", "aif_fixture"
            source.put_item({"PK": owner_partition(owner), "SK": "PROJECT#p", "entityType": "PROJECT", "id": project, "ownerId": owner, "name": "Fixture"})
            source.put_item({"PK": owner_partition(owner), "SK": "AI_CONVERSATION#" + conversation, "entityType": "AI_CONVERSATION", "id": conversation, "ownerId": owner, "projectKey": "project:p", "title": "Fixture"})
            prefix = f"users/{storage_owner(owner)}/ai/{conversation}/attachments/{attachment}/source"
            extracted = prefix + ".json"
            vision = prefix + ".vision.jpg"
            source.put_item({"PK": owner_partition(owner), "SK": "AI_ATTACHMENT#" + attachment, "entityType": "AI_ATTACHMENT", "id": attachment, "ownerId": owner, "conversationId": conversation, "projectKey": "project:p", "filename": "notes.txt", "mediaType": "text/plain", "status": "ready", "objectKey": prefix + "/" + "0" * 64, "extractedKey": extracted, "visionKey": vision})
            source.put_item({"PK": owner_partition(owner), "SK": f"AI_MESSAGE#{conversation}#message", "entityType": "AI_MESSAGE", "id": "message", "ownerId": owner, "conversationId": conversation, "attachmentIds": [attachment], "role": "user", "text": "read"})
            source.s3.put_object(Bucket=source.bucket, Key=prefix + "/" + "0" * 64, Body=b"notes", ContentType="text/plain")
            source.s3.put_object(Bucket=source.bucket, Key=extracted, Body=json.dumps({"sections": [{"reference": "line 1", "text": "notes"}], "warnings": []}).encode(), ContentType="application/json")
            source.s3.put_object(Bucket=source.bucket, Key=vision, Body=b"jpeg", ContentType="image/jpeg")
            snapshot, chunks = build_project_snapshot(source, owner, project, root / "staging")
            destination = LocalServices(root / "destination", "http://127.0.0.1:49161", "http://127.0.0.1:3001")
            restore_snapshot(destination, snapshot, chunks)
            restored = destination.get_item(destination.owner, "AI_ATTACHMENT", attachment)
            self.assertIsNotNone(destination.s3.metadata(destination.bucket, restored["extractedKey"]))
            self.assertIsNotNone(destination.s3.metadata(destination.bucket, restored["visionKey"]))
            conversation_record = destination.get_item(destination.owner, "AI_CONVERSATION", conversation)
            details = AiAttachments(PhyniteApi(destination)).read(destination.owner, conversation_record, {"id": attachment})
            self.assertEqual(details["sections"][0]["text"], "notes")


if __name__ == "__main__":
    unittest.main()
