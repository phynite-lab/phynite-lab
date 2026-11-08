"""Public local Cloud/AI connection contracts, independent of hosted implementation."""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from contextlib import nullcontext
from types import SimpleNamespace
import unittest
from unittest import mock
from urllib.error import HTTPError

from backend.local_api.cloud_client import CloudClient, CloudError
from backend.local_api.cloud_compute import CloudCompute
from backend.local_api.connections import DesktopConnections
from backend.local_api.domain.phynite_core import ApiError, owner_partition, storage_owner
from backend.local_api.domain.project_sync import canonical
from backend.local_api.gateway import GatewayRegistry, gateway_url
from backend.local_api.services import LocalServices
from backend.local_api.snapshots import build_project_snapshot
from backend.local_api.vault import CredentialVault


class MemoryObjects:
    def __init__(self):
        self.objects = {}
        self.metadata = {}

    def put_object(self, *, Key, Body, **kwargs):
        self.objects[Key] = Body
        self.metadata[Key] = kwargs

    def get_object(self, *, Key, **kwargs):
        return {"Body": io.BytesIO(self.objects[Key]), "ContentLength": len(self.objects[Key]), "ContentType": self.metadata.get(Key, {}).get("ContentType", "application/octet-stream")}

    def generate_presigned_url(self, operation, *, Params, ExpiresIn):
        return "https://test.s3.amazonaws.com/" + Params["Key"]

    def list_objects_v2(self, *, Prefix, **kwargs):
        return {"Contents": [{"Key": key, "Size": len(value)} for key, value in self.objects.items() if key.startswith(Prefix)], "IsTruncated": False}

class MemoryServices:
    def __init__(self):
        self.items = {}
        self.s3 = MemoryObjects()
        self.bucket = "test"
        self.table = SimpleNamespace(query=lambda **kwargs: {"Items": [copy.deepcopy(item) for item in self.items.values() if item["PK"] == kwargs["ExpressionAttributeValues"][":pk"]]})

    def get_item(self, owner, kind, item_id):
        return copy.deepcopy(self.items.get((owner_partition(owner), kind + "#" + item_id)))

    def put_item(self, item, condition=None):
        key = (item["PK"], item["SK"])
        if condition and key in self.items:
            raise AssertionError("duplicate record")
        self.items[key] = copy.deepcopy(item)

    def update_item(self, owner, kind, identifier, values):
        key = (owner_partition(owner), kind + "#" + identifier)
        self.items[key].update(values)
        return copy.deepcopy(self.items[key])

    def list_owner_items(self, owner, kind):
        return [copy.deepcopy(item) for (partition, sk), item in self.items.items() if partition == owner_partition(owner) and sk.startswith(kind + "#")]


def snapshot(data=b"Si structure", *, project="p1", deleted=False):
    digest = hashlib.sha256(data).hexdigest()
    return {"schemaVersion": 1, "projectId": project, "document": {"name": "Silicon"}, "artifacts": [{"path": "structure/0", "sha256": digest, "sizeBytes": len(data), "contentType": "application/json"}], "deleted": deleted}

def gateway_events(nonce, *, tool=False):
    block = {"type": "tool_use", "id": "probe", "name": "phynite_probe", "input": {}} if tool else {"type": "text", "text": ""}
    delta = {"type": "input_json_delta", "partial_json": json.dumps({"nonce": nonce})} if tool else {"type": "text_delta", "text": nonce}
    return [{"type": "message_start", "message": {"id": "message_probe", "role": "assistant", "usage": {"input_tokens": 1, "output_tokens": 0}}}, {"type": "content_block_start", "index": 0, "content_block": block}, {"type": "content_block_delta", "index": 0, "delta": delta}, {"type": "content_block_stop", "index": 0}, {"type": "message_delta", "delta": {"stop_reason": "tool_use" if tool else "end_turn"}, "usage": {"output_tokens": 1}}, {"type": "message_stop"}]

def gateway_stream(events):
    return "".join("data: " + json.dumps(event) + "\n\n" for event in events).encode()

class ProbeGateway:
    def __init__(self, mutate=None):
        self.streams = []
        self.failure = None
        self.mutate = mutate

    def open(self, request, timeout):
        if request.full_url.endswith("/models"):
            return io.BytesIO(b'{"data":[{"id":"provider/model"}]}')
        if self.failure:
            raise self.failure
        body = json.loads(request.data)
        tool = "tools" in body
        nonce = re.search(r"nonce ([a-f0-9]+)", body["messages"][0]["content"])[1] if tool else body["messages"][0]["content"].rsplit(" ", 1)[1]
        events = gateway_events(nonce, tool=tool)
        if self.mutate:
            events = self.mutate(events, tool)
        data = gateway_stream(events)
        self.streams.append(data.decode())
        return io.BytesIO(data)

class ConnectionsFacadeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.services = SimpleNamespace(owner="local-owner", table=SimpleNamespace(atomic=nullcontext))
        patcher = mock.patch("backend.local_api.vault._system_backend", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.facade = DesktopConnections(self.root, self.services, cloud_config={"apiOrigin": "", "region": "", "clientId": ""})
        self.cloud = mock.Mock(account="user1")
        self.cloud.status.return_value = {"connected": True, "accountId": "user1"}
        self.facade.cloud = self.cloud
        self.facade.sync = mock.Mock()
        self.source = self.root / "input.json"
        self.source.write_bytes(b"Si structure")
        self.sources = {hashlib.sha256(self.source.read_bytes()).hexdigest(): self.source}
        self.facade.build = mock.Mock(return_value=(snapshot(), self.sources))

    def call(self, path, payload=None, method="POST", *, internal=False):
        return json.loads(self.facade.handle(method, path, payload or {}, internal=internal)["body"])

    def test_gateway_command_transport_keeps_credentials_on_internal_endpoint(self):
        status = self.call("/__local/gateway", {"baseUrl": "http://127.0.0.1:20128", "token": "gateway-secret"}, method="PUT")
        self.assertTrue(status["configured"])
        self.assertNotIn("gateway-secret", json.dumps(status))
        with self.assertRaises(ApiError) as error:
            self.call("/__local/gateway/environment", method="GET")
        self.assertEqual(error.exception.status, 404)
        environment = self.call("/__local/gateway/environment", method="GET", internal=True)
        self.assertEqual(environment["PHYNITE_AI_9ROUTER_AUTH_TOKEN"], "gateway-secret")
        self.assertEqual(json.loads(environment["PHYNITE_AI_9ROUTER_MODELS"]), [])
        self.assertNotIn("PHYNITE_AI_9ROUTER_CAPABILITIES", environment)
        self.call("/__local/gateway", method="DELETE")
        self.assertEqual(self.call("/__local/gateway/environment", method="GET", internal=True), {})
        self.cloud.request.assert_not_called()

    def test_enabling_requires_confirmation_of_actual_snapshot(self):
        with self.assertRaises(ApiError) as error:
            self.call("/__local/sync/p1/enable", {"confirmSha256": "0" * 64})
        self.assertEqual(error.exception.code, "SYNC_CONFIRMATION_REQUIRED")
        self.assertFalse(self.facade.store.status("user1", "p1")["enabled"])
        result = self.call("/__local/sync/p1/enable", {"confirmSha256": hashlib.sha256(canonical(snapshot())).hexdigest()})
        self.assertTrue(result["enabled"])
        self.assertEqual(result["state"], "pending")
        self.cloud.request.assert_not_called()

    def test_gateway_routes_discover_then_activate_only_actual_verified_models(self):
        self.facade.gateway.opener = ProbeGateway()
        saved = self.call('/__local/gateway', {'baseUrl': 'http://127.0.0.1:20128'}, method='PUT')
        self.assertEqual(saved['connectionStatus'], 'not_checked')
        discovered = self.call('/__local/gateway/discover')
        self.assertEqual(discovered['models'], [{'id': 'provider/model', 'available': False}])
        checked = self.call('/__local/gateway/probe', {'modelId': 'provider/model'})
        self.assertEqual(checked['connectionStatus'], 'connected')
        self.assertEqual(checked['models'][0]['id'], 'provider/model')
        self.assertTrue(checked['models'][0]['available'])
        self.assertTrue(checked['models'][0]['tools'])
        self.cloud.request.assert_not_called()

    def test_download_preserves_dirty_project_before_outbox_was_created(self):
        with self.assertRaises(ApiError) as error:
            self.call("/__local/sync/p1/download")
        self.assertEqual(error.exception.code, "SYNC_CONFLICT")
        self.assertEqual(self.facade.store.status("user1", "p1")["state"], "conflict")
        with self.facade.store.connection() as db:
            outbox = db.execute("SELECT snapshot FROM outbox WHERE account='user1' AND project='p1'").fetchone()
        self.assertEqual(json.loads(outbox["snapshot"]), snapshot())
        self.facade.sync.pull.assert_not_called()
        self.cloud.request.assert_not_called()

    def test_download_rechecks_local_changes_after_network_transfer(self):
        self.facade.store.enable("user1", "p1")
        self.facade.store.acknowledge("user1", "p1", "unused", 1, hashlib.sha256(canonical(snapshot())).hexdigest())
        changed = snapshot()
        changed["document"]["name"] = "Edit during download"
        self.facade.build.side_effect = [(snapshot(), self.sources), (changed, self.sources)]
        self.facade._apply = mock.Mock()
        self.facade.sync.pull.side_effect = lambda account, project, apply: apply(snapshot(), self.sources)
        with self.assertRaises(ApiError) as error:
            self.call("/__local/sync/p1/download")
        self.assertEqual(error.exception.code, "SYNC_CONFLICT")
        self.facade._apply.assert_not_called()
        self.assertEqual(self.facade.store.status("user1", "p1")["state"], "conflict")

    def test_download_of_new_project_allows_atomic_import(self):
        self.facade.build.side_effect = CloudError(404, "LOCAL_PROJECT_NOT_FOUND", "No project yet")
        self.facade._apply = mock.Mock(return_value={"projectId": "p1"})
        self.facade.sync.pull.side_effect = lambda account, project, apply: apply(snapshot(), self.sources)
        self.assertEqual(self.call("/__local/sync/p1/download"), {"projectId": "p1"})
        self.facade._apply.assert_called_once()

class VaultAndGatewayTests(unittest.TestCase):
    def test_unauthenticated_gateway_never_creates_an_empty_keychain_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            backend = mock.Mock()
            backend.get_password.return_value = None
            vault = CredentialVault(Path(directory), backend=backend)
            registry = GatewayRegistry(Path(directory), vault)
            for token in (None, ""):
                status = registry.configure("http://127.0.0.1:20128", token)
                self.assertTrue(status["configured"])
                self.assertFalse(status["hasCredential"])
            backend.set_password.assert_not_called()
            backend.delete_password.assert_not_called()
            self.assertTrue(registry.path.is_file())
            registry.disconnect()
            registry.disconnect()
            backend.delete_password.assert_not_called()

    def test_unconfigured_gateway_status_never_reads_keychain_vault(self):
        with tempfile.TemporaryDirectory() as directory:
            backend = mock.Mock()
            vault = CredentialVault(Path(directory), backend=backend)
            registry = GatewayRegistry(Path(directory), vault)
            status = registry.status()
            self.assertFalse(status["configured"])
            self.assertFalse(status["hasCredential"])
            self.assertIsNone(status["baseUrl"])
            self.assertEqual(status["connectionStatus"], "not_configured")
            self.assertEqual(registry.environment(), {})
            backend.get_password.assert_not_called()

    def test_clearing_gateway_token_removes_existing_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            values = {}
            backend = mock.Mock()
            backend.get_password.side_effect = lambda service, name: values.get((service, name))
            backend.set_password.side_effect = lambda service, name, value: values.__setitem__((service, name), value)
            backend.delete_password.side_effect = lambda service, name: values.pop((service, name))
            registry = GatewayRegistry(Path(directory), CredentialVault(Path(directory), backend=backend))
            self.assertTrue(registry.configure("http://127.0.0.1:20128", "unit-test-credential")["hasCredential"])
            self.assertFalse(registry.configure("http://127.0.0.1:20128", "")["hasCredential"])
            self.assertEqual(values, {})
            backend.delete_password.assert_called_once()

    def test_keychain_read_or_delete_failure_cannot_claim_gateway_disconnection(self):
        with tempfile.TemporaryDirectory() as directory:
            backend = mock.Mock()
            backend.get_password.return_value = '{"token":"unit-test-credential"}'
            vault = CredentialVault(Path(directory), backend=backend)
            registry = GatewayRegistry(Path(directory), vault)
            registry.configure("http://127.0.0.1:20128", "unit-test-credential")
            before = registry.path.read_bytes()
            for operation in ("get_password", "delete_password"):
                with self.subTest(operation=operation):
                    getattr(backend, operation).side_effect = RuntimeError("locked keychain unit fixture")
                    with self.assertRaisesRegex(RuntimeError, "could not disconnect"):
                        registry.configure("http://127.0.0.1:20129", "")
                    self.assertEqual(registry.path.read_bytes(), before)
                    getattr(backend, operation).side_effect = None

    def test_memory_fallback_never_writes_credential_to_disk(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            root = Path(directory)
            vault = CredentialVault(root)
            vault.write("provider", {"token": "private-credential"})
            self.assertFalse(vault.persistent)
            self.assertEqual(vault.read("provider")["token"], "private-credential")
            self.assertEqual(list(root.iterdir()), [])

    def test_gateway_rejects_unsafe_origins_and_no_capability_without_real_probe(self):
        for value in ["http://example.com", "http://127.0.0.1.evil.test", "https://user:password@example.com", "https://example.com/path", "https://example.com?token=secret"]:
            with self.assertRaises(ValueError):
                gateway_url(value)
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            registry = GatewayRegistry(Path(directory), CredentialVault(Path(directory)))
            status = registry.configure("http://127.0.0.1:20128", "private-credential")
            self.assertEqual(status["capabilities"]["models"], {})
            self.assertTrue(all(not entry["available"] for entry in status["connectors"]))
            self.assertNotIn("private-credential", registry.path.read_text())
            self.assertNotIn("private-credential", json.dumps(registry.status()))
            self.assertEqual(registry.environment()["PHYNITE_AI_9ROUTER_AUTH_TOKEN"], "private-credential")

    def test_cloud_logout_pauses_local_connection_when_revocation_is_offline(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            vault = CredentialVault(Path(directory))
            client = CloudClient(vault, "https://api.example.com", region="ap-southeast-1", client_id="test")
            client.account = "user1"
            vault.write("cloud:https://api.example.com:user1", {"accessToken": "secret", "refreshToken": "refresh", "expiresAt": 9999999999})
            with mock.patch.object(client, "_identity", side_effect=CloudError(502, "CLOUD_UNAVAILABLE", "offline")):
                result = client.logout()
            self.assertIsNone(client.account)
            self.assertFalse(result["remoteRevocationConfirmed"])
            self.assertIsNone(vault.read("cloud:https://api.example.com:user1"))

    def test_gateway_probes_actual_stream_and_tool_arguments_before_advertising(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            registry = GatewayRegistry(Path(directory), CredentialVault(Path(directory)), opener=ProbeGateway())
            registry.configure("http://127.0.0.1:20128")
            registry.discover()
            self.assertEqual(registry.status()['connectionStatus'], 'connected')
            self.assertIsNotNone(registry.status()['checkedAt'])
            capability = registry.probe("provider/model")["capabilities"]["models"]["provider/model"]
            self.assertTrue(capability["available"])
            self.assertTrue(capability["tools"])
            self.assertFalse(capability["images"])
            self.assertFalse(capability["pdf"])
            environment = registry.environment()
            self.assertEqual(json.loads(environment["PHYNITE_AI_9ROUTER_MODELS"]), ["provider/model"])
            self.assertTrue(json.loads(environment["PHYNITE_AI_9ROUTER_CAPABILITIES"])["models"]["provider/model"]["tools"])

    def test_gateway_rejects_incomplete_contract_and_truncated_tool_response(self):
        nonce = "synthetic-nonce"
        cases = {
            "missing_start": gateway_events(nonce)[1:],
            "missing_delta": [event for event in gateway_events(nonce) if event["type"] != "message_delta"],
            "missing_stop": gateway_events(nonce)[:-1],
            "open_block": [event for event in gateway_events(nonce) if event["type"] != "content_block_stop"],
            "unknown_index": [{**event, "index": 8} if event["type"] == "content_block_delta" else event for event in gateway_events(nonce)],
            "invalid_tool_json": [{**event, "delta": {"type": "input_json_delta", "partial_json": "{"}} if event["type"] == "content_block_delta" else event for event in gateway_events(nonce, tool=True)],
            "truncated_tools": [{**event, "delta": {"stop_reason": "max_tokens"}} if event["type"] == "message_delta" else event for event in gateway_events(nonce, tool=True)],
            "stop_without_tool_reason": [{**event, "delta": {"stop_reason": "invalid"}} if event["type"] == "message_delta" else event for event in gateway_events(nonce)],
        }
        for label, events in cases.items():
            with self.subTest(label=label), self.assertRaises(CloudError) as error:
                GatewayRegistry._response(io.BytesIO(gateway_stream(events)))
            self.assertEqual(error.exception.code, "AI_STREAM_INVALID")
        with self.assertRaises(CloudError):
            GatewayRegistry._response(io.BytesIO(gateway_stream(gateway_events(nonce)).rstrip(b"\n")))

    def test_failed_reprobe_revokes_previous_capability_before_auth_or_network_request(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            opener = ProbeGateway()
            registry = GatewayRegistry(Path(directory), CredentialVault(Path(directory)), opener=opener)
            registry.configure("http://127.0.0.1:20128", "private-credential")
            registry.discover()
            for failure in (HTTPError("http://127.0.0.1:20128/v1/messages", 401, "Denied", {}, None), OSError("offline")):
                opener.failure = None
                self.assertTrue(registry.probe("provider/model")["capabilities"]["models"]["provider/model"]["available"])
                opener.failure = failure
                with self.assertRaises(CloudError):
                    registry.probe("provider/model")
                self.assertFalse(registry.status()["capabilities"]["models"]["provider/model"]["available"])
                saved = json.loads(registry.environment()["PHYNITE_AI_9ROUTER_CAPABILITIES"])
                self.assertFalse(saved["models"]["provider/model"]["tools"])

    def test_probed_stream_fixture_passes_real_node_parser_and_cancellation(self):
        if not shutil.which("node"):
            self.skipTest("Node.js is required for the shared gateway protocol check")
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            opener = ProbeGateway()
            registry = GatewayRegistry(Path(directory), CredentialVault(Path(directory)), opener=opener)
            registry.configure("http://127.0.0.1:20128")
            registry.discover(); registry.probe("provider/model")
            script = """
import {readFileSync} from 'node:fs';
import {streamClaude} from './lib/ai-provider.ts';
const samples = JSON.parse(readFileSync(0, 'utf8'));
const config = {baseUrl:'http://127.0.0.1:20128',token:'',providerId:'9router',modelIds:['provider/model'],local:true};
const options = {config,modelId:'provider/model',system:'synthetic test',messages:[],tools:[],signal:new AbortController().signal,onText:()=>{}};
const parsed=[];
for(const sample of samples) parsed.push(await streamClaude({...options,fetcher:async()=>new Response(sample,{headers:{'Content-Type':'text/event-stream'}})}));
const abort = new AbortController();
let providerAborted=false;
const cancelled=streamClaude({...options,signal:abort.signal,fetcher:async(_url,init)=>new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>{providerAborted=true;controller.error(new DOMException('Cancelled','AbortError'));});}}))});
setTimeout(()=>abort.abort(),5);
let code='';try{await cancelled;}catch(error){code=error.code;}
process.stdout.write(JSON.stringify({blocks:parsed.map(result=>result.content[0].type),reasons:parsed.map(result=>result.stopReason),providerAborted,code}));
"""
            completed = subprocess.run([shutil.which("node"), "--experimental-strip-types", "--input-type=module", "-e", script], input=json.dumps(opener.streams), text=True, cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=15, check=True)
            result = json.loads(completed.stdout)
            self.assertEqual(result["blocks"], ["text", "tool_use"])
            self.assertEqual(result["reasons"], ["end_turn", "tool_use"])
            self.assertTrue(result["providerAborted"])
            self.assertEqual(result["code"], "AI_CONNECTION_CLOSED")

    def test_gateway_auth_failure_does_not_contact_another_provider(self):
        opener = mock.Mock()
        opener.open.side_effect = HTTPError("http://127.0.0.1:20128/v1/models", 401, "Denied", {}, None)
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            registry = GatewayRegistry(Path(directory), CredentialVault(Path(directory)), opener=opener)
            registry.configure("http://127.0.0.1:20128", "private-credential")
            with self.assertRaises(CloudError) as error:
                registry.discover()
            self.assertEqual(error.exception.code, "AI_GATEWAY_AUTH_FAILED")
            self.assertEqual(opener.open.call_count, 1)
            self.assertEqual(opener.open.call_args.args[0].full_url, "http://127.0.0.1:20128/v1/models")
            self.assertFalse(registry.status()["capabilities"]["models"])
            self.assertEqual(registry.status()['connectionStatus'], 'auth_required')

    def test_failed_gateway_recheck_cannot_retain_connected_badge_or_capabilities(self):
        opener = ProbeGateway()
        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            registry = GatewayRegistry(Path(directory), CredentialVault(Path(directory)), opener=opener)
            registry.configure("http://127.0.0.1:20128")
            registry.discover()
            registry.probe('provider/model')
            with mock.patch.object(opener, 'open', side_effect=OSError('offline')):
                with self.assertRaises(CloudError):
                    registry.discover()
            self.assertEqual(registry.status()['connectionStatus'], 'unavailable')
            self.assertFalse(registry.status()['capabilities']['models']['provider/model']['available'])

class CloudLocalDomainTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.services = LocalServices(self.root, "http://127.0.0.1:3001", "http://127.0.0.1:3000")
        self.services.put_item({"PK": owner_partition(self.services.owner), "SK": "PROJECT#p1", "entityType": "PROJECT", "id": "p1", "ownerId": self.services.owner, "name": "Local project"})
        self.client = mock.Mock(account="user1")
        self.compute = CloudCompute(self.root, self.client)
        self.structure = {"name": "Si", "formula": "Si", "atoms": [{"species": "Si", "x": 0, "y": 0, "z": 0}], "lattice": {"a": 5.4, "b": 5.4, "c": 5.4}, "periodic": [True, True, True]}
        self.calculation = {"calculationType": "Total energy", "qeInput": "&CONTROL\n/\nATOMIC_POSITIONS", "settings": {"ecutwfc": 60}}
        self.preview = self.compute.preview("p1", self.structure, self.calculation)
        self.data = b"scientific energy = -10.12345 Ry\n"
        self.artifact = self.root / "verified-result.dat"; self.artifact.write_bytes(self.data)
        digest = hashlib.sha256(self.data).hexdigest()
        self.download = {"executionId": self.preview["executionId"], "localProjectId": "p1", "calculation": {"id": "remote_calc", "entityType": "CALCULATION", "structureId": "remote_str", "projectId": "remote_project", "name": "SCF", "calculationType": "Total energy", "status": "COMPLETED", "computeBackend": "CLOUD_PAID_EC2", "artifactsExpireAtEpoch": 100, "createdAt": "2026-01-01T00:00:00Z"}, "result": {"calculationId": "remote_calc", "status": "completed", "syntheticData": False, "energy": -10.12345, "energyUnit": "Ry", "artifacts": [{"path": "raw/pw.out", "sha256": digest, "sizeBytes": len(self.data), "contentType": "text/plain"}], "artifactPagination": {"manifestSha256": "a" * 64}}, "files": [{"path": "raw/pw.out", "file": str(self.artifact), "sha256": digest, "sizeBytes": len(self.data), "contentType": "text/plain"}], "cloudSyncEnabled": False}

    def import_result(self):
        with mock.patch.object(self.compute, "download_results", return_value=self.download):
            return self.compute.import_results(self.services, self.preview["executionId"])

    def test_verified_cloud_result_is_readable_local_domain_and_idempotent(self):
        result = self.import_result()
        self.assertTrue(result["imported"])
        self.assertFalse(result["cloudSyncEnabled"])
        self.assertNotIn(str(self.root), json.dumps(result))
        record = self.services.get_item(self.services.owner, "CALCULATION", result["calculation"]["id"])
        self.assertEqual(record["computeBackend"], "CLOUD_PAID_EC2")
        self.assertTrue(record["imported"])
        self.assertNotIn("artifactsExpireAtEpoch", record)
        self.assertEqual(record["sourceCloudExecution"]["remoteArtifactsExpireAtEpoch"], 100)
        body = self.services.s3.get_object(Bucket=self.services.bucket, Key=record["outputPrefix"] + "/raw/pw.out")["Body"]
        self.assertEqual(body.read(), self.data)
        manifest = json.loads(self.services.s3.get_object(Bucket=self.services.bucket, Key=record["outputPrefix"] + "/result.json")["Body"].read())
        self.assertEqual(manifest["energy"], -10.12345)
        self.assertEqual(manifest["energyUnit"], "Ry")
        self.assertEqual(manifest["calculationId"], record["id"])
        self.assertEqual(len(self.services.list_project_items("p1", "CALCULATION")), 1)
        again = self.import_result()
        self.assertTrue(again["idempotentReplay"])
        self.assertEqual(again["calculation"]["id"], result["calculation"]["id"])
        self.client.request.assert_not_called()

    def test_artifact_corruption_or_disk_failure_rolls_back_all_domain_records(self):
        self.artifact.write_bytes(b"corrupt")
        with self.assertRaises(Exception):
            self.import_result()
        self.assertEqual(self.services.list_owner_items(self.services.owner, "CALCULATION"), [])
        self.assertEqual(self.services.list_owner_items(self.services.owner, "STRUCTURE"), [])
        prefix = f"users/{storage_owner(self.services.owner)}/projects/p1/"
        self.assertEqual(self.services.s3.list_objects_v2(Bucket=self.services.bucket, Prefix=prefix)["Contents"], [])
        self.artifact.write_bytes(self.data)
        original = self.services.s3.put_object
        count = 0
        def fail_after_partial_bytes(**kwargs):
            nonlocal count
            count += 1
            if count == 3:
                raise OSError("Disk full")
            return original(**kwargs)
        with mock.patch.object(self.services.s3, "put_object", side_effect=fail_after_partial_bytes), self.assertRaises(OSError):
            self.import_result()
        self.assertEqual(self.services.list_owner_items(self.services.owner, "STRUCTURE"), [])
        self.assertEqual(self.services.s3.list_objects_v2(Bucket=self.services.bucket, Prefix=prefix)["Contents"], [])

    def test_preview_derives_owned_saved_inputs_and_exact_private_dependencies(self):
        prefix = f"users/{storage_owner(self.services.owner)}/projects/p1/"
        self.services.s3.put_object(Bucket=self.services.bucket, Key=prefix + "structure.json", Body=canonical(self.structure))
        pseudo = b"private UPF bytes"
        self.services.s3.put_object(Bucket=self.services.bucket, Key=prefix + "Si.upf", Body=pseudo)
        self.services.put_item({"PK": owner_partition(self.services.owner), "SK": "STRUCTURE#str1", "entityType": "STRUCTURE", "id": "str1", "projectId": "p1", "objectKey": prefix + "structure.json"})
        payload = {**self.calculation, "calculationId": "calc1", "projectId": "p1", "structureId": "str1", "pseudopotentials": {"Si.upf": prefix + "Si.upf"}}
        self.services.s3.put_object(Bucket=self.services.bucket, Key=prefix + "input.json", Body=canonical(payload))
        self.services.put_item({"PK": owner_partition(self.services.owner), "SK": "CALCULATION#calc1", "entityType": "CALCULATION", "id": "calc1", "projectId": "p1", "structureId": "str1", "inputKey": prefix + "input.json", "name": "Saved SCF", "vcpus": 2, "memoryMiB": 4096})
        preview = self.compute.preview_calculation(self.services, "calc1", {"cloudMode": "paid", "computeProfileId": "cpu-small"})
        self.assertEqual(preview["inputs"]["dependencies"], [{"filename": "Si.upf", "sizeBytes": len(pseudo), "sha256": hashlib.sha256(pseudo).hexdigest()}])
        saved = json.loads(self.compute._execution(preview["executionId"])["payload"])
        self.assertEqual(saved["calculation"]["qeInput"], self.calculation["qeInput"])
        self.assertEqual(base64.b64decode(saved["dependencies"][0]["contentBase64"]), pseudo)
        self.assertNotIn(prefix, json.dumps(saved))
        self.client.request.assert_not_called()
        required = {**payload, "qeInput": "&SYSTEM\n/\nATOMIC_SPECIES\nSi 28.085 missing.upf\nATOMIC_POSITIONS crystal\nSi 0 0 0"}
        self.services.s3.put_object(Bucket=self.services.bucket, Key=prefix + "input.json", Body=canonical(required))
        with self.assertRaises(CloudError) as missing:
            self.compute.preview_calculation(self.services, "calc1")
        self.assertEqual(missing.exception.code, "CLOUD_PSEUDOPOTENTIAL_REQUIRED")
        self.services.update_item(self.services.owner, "CALCULATION", "calc1", {"dependsOnCalculationIds": ["prior_scf"]})
        with self.assertRaises(CloudError) as error:
            self.compute.preview_calculation(self.services, "calc1")
        self.assertEqual(error.exception.code, "CLOUD_LOCAL_DEPENDENCY_REQUIRED")
        with self.assertRaises(CloudError):
            self.compute.preview_calculation(self.services, "another_owner_calculation")

class SnapshotCollectorTests(unittest.TestCase):
    def test_saved_draft_configuration_is_exportable_without_computation(self):
        services = MemoryServices()
        services.put_item({"PK": owner_partition("user1"), "SK": "PROJECT#p1", "entityType": "PROJECT", "id": "p1"})
        services.put_item({"PK": owner_partition("user1"), "SK": "CALCULATION#draft1", "entityType": "CALCULATION", "id": "draft1", "projectId": "p1", "status": "DRAFT", "calculationType": "Total energy"})
        with tempfile.TemporaryDirectory() as directory:
            value, _ = build_project_snapshot(services, "user1", "p1", Path(directory))
        self.assertEqual({item["id"] for item in value["document"]["records"]}, {"p1", "draft1"})

    def test_collects_completed_science_with_provenance_without_other_project_or_credentials(self):
        services = MemoryServices()
        owner = "user1"
        prefix = f"users/{storage_owner(owner)}/projects/p1/"
        records = [
            {"SK": "PROJECT#p1", "entityType": "PROJECT", "id": "p1", "name": "Si"},
            {"SK": "PROJECT#p2", "entityType": "PROJECT", "id": "p2", "name": "Other"},
            {"SK": "CALCULATION#c1", "entityType": "CALCULATION", "id": "c1", "projectId": "p1", "status": "COMPLETED", "outputPrefix": prefix + "outputs", "provenance": {"units": "eV"}, "workerToken": "private-worker-token"},
            {"SK": "AI_CONVERSATION#chat1", "entityType": "AI_CONVERSATION", "id": "chat1", "projectKey": "project:p1"},
            {"SK": "AI_MESSAGE#chat1#m1", "entityType": "AI_MESSAGE", "id": "m1", "conversationId": "chat1", "text": "research"},
        ]
        for item in records:
            services.put_item({"PK": owner_partition(owner), "ownerId": owner, **item})
        services.s3.put_object(Key=prefix + "outputs/result.json", Body=b'{"energy":-1,"syntheticData":false}', ContentType="application/json")
        services.s3.put_object(Key=prefix + "outputs/restricted.upf", Body=b"restricted")
        with tempfile.TemporaryDirectory() as directory:
            value, sources = build_project_snapshot(services, owner, "p1", Path(directory))
            self.assertEqual({record["id"] for record in value["document"]["records"]}, {"p1", "c1", "chat1", "m1"})
            self.assertNotIn("private-worker-token", json.dumps(value))
            self.assertEqual(len(value["document"]["objects"]), 1)
            self.assertEqual(len(value["document"]["missingAssets"]), 1)
            self.assertEqual(next(iter(sources.values())).read_bytes(), b'{"energy":-1,"syntheticData":false}')

    def test_running_output_is_never_snapshotted(self):
        services = MemoryServices()
        for item in [{"SK": "PROJECT#p1", "entityType": "PROJECT", "id": "p1"}, {"SK": "CALCULATION#c1", "entityType": "CALCULATION", "id": "c1", "projectId": "p1", "status": "RUNNING"}]:
            services.put_item({"PK": owner_partition("user1"), **item})
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(CloudError) as error:
            build_project_snapshot(services, "user1", "p1", Path(directory))
        self.assertEqual(error.exception.code, "SYNC_PROJECT_BUSY")


if __name__ == "__main__":
    unittest.main()
