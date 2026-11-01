from __future__ import annotations

import hashlib
import io
import tempfile
import threading
import unittest
from decimal import Decimal
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from backend.local_api.sqlite_store import SQLiteTable, StorageError
from backend.local_api.filesystem_store import FilesystemObjects


class LocalPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name); self.table = SQLiteTable(self.root / "metadata.sqlite")
        self.objects = FilesystemObjects(self.root / "artifacts", self.table, "local", "http://127.0.0.1:9000", b"test-key")

    def test_records_survive_restart_without_precision_loss(self):
        value = {"PK": "owner", "SK": "project", "revision": Decimal("1.123456789123456789"), "raw": b"raw", "tags": {"a", "b"}}
        self.table.put_item(Item=value)
        reopened = SQLiteTable(self.root / "metadata.sqlite")
        self.assertEqual(reopened.get_item(Key=value)["Item"], value)

    def test_compare_and_swap_serializes_independent_connections(self):
        self.table.put_item(Item={"PK": "o", "SK": "job", "status": "QUEUED"})
        barrier = threading.Barrier(8)
        def claim(index):
            table = SQLiteTable(self.root / "metadata.sqlite"); barrier.wait()
            try:
                table.update_item(Key={"PK": "o", "SK": "job"}, ConditionExpression="#s = :queued", UpdateExpression="SET #s = :running, worker = :worker", ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":queued": "QUEUED", ":running": "RUNNING", ":worker": index})
                return True
            except StorageError:
                return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(claim, range(8))), 1)

    def test_transaction_rolls_back_all_previous_writes(self):
        self.table.put_item(Item={"PK": "o", "SK": "p", "revision": 2})
        with self.assertRaises(StorageError) as failed:
            self.table.meta.client.transact_write_items(TransactItems=[
                {"Put": {"TableName": self.table.name, "Item": {"PK": "o", "SK": "new"}}},
                {"ConditionCheck": {"TableName": self.table.name, "Key": {"PK": "o", "SK": "p"}, "ConditionExpression": "revision = :expected", "ExpressionAttributeValues": {":expected": 1}}},
            ])
        self.assertEqual(failed.exception.response["CancellationReasons"][1]["Code"], "ConditionalCheckFailed")
        self.assertNotIn("Item", self.table.get_item(Key={"PK": "o", "SK": "new"}))

    def test_queries_owner_indexes_pagination_and_filter(self):
        for i in range(4):
            self.table.put_item(Item={"PK": "owner-a" if i < 3 else "owner-b", "SK": f"PROJECT#{i}", "revision": i})
        request = {"KeyConditionExpression": "PK = :owner AND begins_with(SK, :prefix)", "ExpressionAttributeValues": {":owner": "owner-a", ":prefix": "PROJECT#"}, "Limit": 2}
        first = self.table.query(**request); second = self.table.query(**request, ExclusiveStartKey=first["LastEvaluatedKey"])
        self.assertEqual(len(first["Items"]), 2); self.assertEqual(len(second["Items"]), 1)
        self.assertTrue(all(item["PK"] == "owner-a" for item in first["Items"] + second["Items"]))

    def test_update_nested_conditions_and_missing_comparisons(self):
        self.table.put_item(Item={"PK": "o", "SK": "j", "status": "QUEUED"})
        self.table.update_item(Key={"PK": "o", "SK": "j"}, ConditionExpression="(attribute_not_exists(lease) OR lease < :now) AND #s IN (:queued, :running)", UpdateExpression="SET started = if_not_exists(started, :now) ADD attempts :one", ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":now": 10, ":queued": "QUEUED", ":running": "RUNNING", ":one": 1})
        self.assertEqual(self.table.get_item(Key={"PK": "o", "SK": "j"})["Item"]["attempts"], 1)
        with self.assertRaises(ValueError):
            self.table.update_item(Key={"PK": "o", "SK": "j"}, UpdateExpression="SET result = unsupported(:x)", ExpressionAttributeValues={":x": 1})

    def test_artifacts_stream_ranges_versioning_and_ticket_tamper(self):
        self.objects.put_object(Bucket="local", Key="projects/p/input", Body=io.BytesIO(b"abcdef"))
        version = hashlib.sha256(b"abcdef").hexdigest()
        self.objects.put_object(Bucket="local", Key="projects/p/input", Body=b"new")
        value = self.objects.get_object(Bucket="local", Key="projects/p/input", VersionId=version, Range="bytes=1-3")
        with value["Body"] as body:
            self.assertEqual(body.read(), b"bcd")
        url = self.objects.generate_presigned_url("get_object", Params={"Bucket": "local", "Key": "projects/p/input"})
        from urllib.parse import urlsplit, parse_qs
        token = parse_qs(urlsplit(url).query)["ticket"][0]
        self.assertEqual(self.objects.verify_ticket(token, "GET")["params"]["Key"], "projects/p/input")
        with self.assertRaises(StorageError):
            self.objects.verify_ticket(token + "x", "GET")
        with self.assertRaises(StorageError):
            self.objects.put_object(Bucket="local", Key="../../escape", Body=b"bad")

    def test_checksum_failure_keeps_previous_artifact(self):
        self.objects.put_object(Bucket="local", Key="input", Body=b"original")
        with self.assertRaises(StorageError):
            self.objects.put_object(Bucket="local", Key="input", Body=b"different", Metadata={"sha256": "0" * 64})
        with self.objects.get_object(Bucket="local", Key="input")["Body"] as body:
            self.assertEqual(body.read(), b"original")

    def test_newer_schema_is_not_downgraded(self):
        with self.table.connect() as connection:
            connection.execute("PRAGMA user_version=99")
        with self.assertRaisesRegex(RuntimeError, "newer Phynite"):
            SQLiteTable(self.root / "metadata.sqlite")


if __name__ == "__main__":
    unittest.main()
