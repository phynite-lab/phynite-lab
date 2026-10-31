"""The public local core must work with the hosted source physically absent."""
from __future__ import annotations

import ast
import importlib.util
import json
import os
from pathlib import Path
from unittest.mock import patch
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

from backend.local_api.domain.api import PhyniteApi, normalize_md_manual_body
from backend.local_api.domain.phynite_core import ApiError, owner_partition, utc_now
from backend.local_api.services import LocalServices


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "backend/local_api/public-core.json"


class PublicLocalCoreTests(unittest.TestCase):
    def test_explicit_builder_graph_excludes_hosted_implementation(self):
        spec = importlib.util.spec_from_file_location("public_core_builder", ROOT / "scripts/build-local-core.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        manifest = builder.source_manifest(ROOT)
        command = builder.build_command(ROOT, Path("/tmp/phynite-public-core"), "darwin-arm64", manifest)
        self.assertFalse(any("backend/functions" in entry for entry in command))
        self.assertNotIn("backend/compute/runner.py", manifest["pythonModules"])
        self.assertTrue(set(manifest["frozenModules"]) <= set(manifest["pythonModules"]))

    def test_clean_public_checkout_runs_local_regressions_without_private_imports(self):
        manifest = json.loads(MANIFEST.read_text())
        tests = [name for name in manifest["portableTests"] if Path(name).stem in {"test_local_desktop", "test_local_integrity", "test_local_persistence", "test_local_cloud_integrity", "test_local_draft_bundle", "test_local_regressions", "test_local_connections", "test_local_scientific_qualification"}]
        with tempfile.TemporaryDirectory(prefix="phynite-public-only-") as directory:
            target = Path(directory)
            # Shared SSE parser and the release producer are public source, not
            # frozen runtime dependencies. Their portable contract tests need
            # these explicit inputs even in this Python-only stripped tree.
            test_inputs = ["lib/ai-provider.ts", "lib/ai-contract.ts", "scripts/qualify-local-science.py", "distribution/qualification/qe/fixture.json"]
            for module in sorted((ROOT / "packages/phynite-lab/lib").glob("*.mjs")):
                test_inputs.append(module.relative_to(ROOT).as_posix())
            for name in manifest["pythonModules"] + manifest["dataFiles"] + tests + test_inputs:
                path = target / name
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, path)
            self.assertFalse((target / "backend/functions").exists())
            runner = target / "check_public.py"
            runner.write_text("""import importlib.abc, sys, unittest
class NoPrivate(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith('backend.functions') or fullname.split('.')[0] in {'api', 'phynite_core', 'paid_compute', 'pilot_compute', 'cloud_pilot', 'quanta_wallet', 'admin_control', 'account_identity', 'storage_quota'}:
            raise AssertionError('Public core attempted private import: ' + fullname)
sys.meta_path.insert(0, NoPrivate())
names = sys.argv[1:]
result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromNames(names))
raise SystemExit(not result.wasSuccessful())
""")
            environment = {key: value for key, value in os.environ.items() if not key.startswith(("PYTHONPATH", "AWS_", "PHYNITE_"))}
            environment["PYTHONPATH"] = str(target)
            result = subprocess.run([sys.executable, str(runner), *[name.removesuffix(".py").replace("/", ".") for name in tests]], cwd=target, env=environment, capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("OK", result.stderr)

    def test_owned_native_worker_claim_cancel_and_failure_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            services = LocalServices(Path(directory), "http://127.0.0.1:8792", "http://127.0.0.1:3000")
            api = PhyniteApi(services)
            owner = services.owner
            project = json.loads(api.create_project(owner, {"name": "Retained job protocol fixture"})["body"])["project"]["id"]
            key = "users/fixture/input.json"
            services.s3.put_object(Bucket=services.bucket, Key=key, Body=b'{"calculationType":"Total energy","qeInput":"exact fixture input"}')
            item = {"PK": owner_partition(owner), "SK": "CALCULATION#fixture", "id": "fixture", "ownerId": owner, "projectId": project, "entityType": "CALCULATION", "jobKind": "qe", "status": "QUEUED", "computeBackend": "LOCAL_MAC", "computeTarget": "personal", "inputKey": key, "outputPrefix": "users/fixture/results", "createdAt": utc_now(), "GSI1PK": "PROJECT#" + project, "GSI1SK": "CALCULATION#fixture"}
            services.put_item(item)
            with self.assertRaises(ApiError):
                api.require_local_worker({"headers": {"X-Phynite-Worker-Token": "incorrect"}})
            api.require_local_worker({"headers": {"X-Phynite-Worker-Token": services.worker_token}})
            claimed = json.loads(api.claim_local_job({"workerId": "native-fixture", "capabilities": ["qe"], "reportPresence": True})["body"])["job"]
            self.assertEqual(claimed["ownerId"], owner)
            self.assertEqual(claimed["input"]["qeInput"], "exact fixture input")
            self.assertIsNone(json.loads(api.claim_local_job({"workerId": "second-native-fixture", "capabilities": ["qe"]})["body"])["job"])
            api.cancel_calculation(owner, "fixture")
            heartbeat = json.loads(api.heartbeat_local_job("fixture", {"ownerId": owner, "workerId": "native-fixture", "progress": 20})["body"])
            self.assertTrue(heartbeat["cancelRequested"])
            services.s3.put_object(Bucket=services.bucket, Key="users/fixture/results/result.json", Body=b'{"calculationId":"fixture","status":"failed","error":"Fixture solver failed before producing scientific results"}')
            finished = json.loads(api.complete_local_job("fixture", {"ownerId": owner, "workerId": "native-fixture", "status": "failed"})["body"])
            self.assertEqual(finished["calculation"]["status"], "FAILED")
            self.assertIn("Fixture solver failed", finished["calculation"]["failureReason"])
            with self.assertRaises(ApiError):
                api.create_calculation(owner, project, {"computeTarget": "shared"})

    def test_local_ai_metadata_lease_and_cancel_need_no_hosted_secret(self):
        from backend.local_api.domain.ai_workspace import AiWorkspace, valid_selection
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"PHYNITE_AI_9ROUTER_MODELS": '["fixture/model"]'}):
            services = LocalServices(Path(directory), "http://127.0.0.1:8792", "http://127.0.0.1:3000")
            ai = AiWorkspace(PhyniteApi(services))
            owner = services.owner
            self.assertFalse(valid_selection("phynite", "claude-sonnet-4-6", "auto"))
            def call(method, path, payload):
                return json.loads(ai.handle(owner, method, path, payload, {})["body"])
            conversation = call("POST", "/v1/ai/conversations", {"providerId": "9router", "modelId": "fixture/model", "mode": "chat"})["conversation"]
            path = "/v1/ai/conversations/" + conversation["id"]
            started = call("POST", path + "/start", {"text": "Explain the retained project inputs"})
            self.assertTrue(started["lease"])
            self.assertEqual(started["run"]["providerId"], "9router")
            self.assertNotIn("leaseHash", json.dumps(started))
            call("POST", path + "/stop", {"runId": started["run"]["id"]})
            self.assertEqual(call("GET", path, {})["run"]["status"], "stopped")

    def test_no_manual_capability_without_verified_runtime_and_preflight_rejects_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            services = LocalServices(Path(directory), "http://127.0.0.1:8792", "http://127.0.0.1:3000")
            manifest = json.loads(PhyniteApi(services).get_md_runtime_manifest(services.owner)["body"])["manifest"]
            self.assertFalse(manifest["computeTargets"][0]["available"])
            self.assertNotIn("manual", manifest["stepKinds"])
            for text in ("shell touch outside", "python invoke", "include ../outside", "jump /tmp/external"):
                with self.assertRaises(ApiError):
                    normalize_md_manual_body(text)


if __name__ == "__main__":
    unittest.main()
