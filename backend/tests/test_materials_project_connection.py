"""Materials Project settings keep credentials local and out of public responses."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlsplit
import zipfile

from backend.local_api.desktop_server import DesktopApplication
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.materials_project import MaterialsProjectConnection
from backend.local_api.vault import CredentialVault


SETTINGS_KEY = "0123456789abcdef0123456789abcdef"
ENVIRONMENT_KEY = "fedcba9876543210fedcba9876543210"


class MemoryKeyring:
    def __init__(self):
        self.values = {}
        self.fail_read = False
        self.fail_write = False
        self.fail_delete = False

    def get_password(self, service, name):
        if self.fail_read:
            raise RuntimeError("Keychain locked")
        return self.values.get((service, name))

    def set_password(self, service, name, value):
        if self.fail_write:
            raise RuntimeError("Keychain locked")
        self.values[(service, name)] = value

    def delete_password(self, service, name):
        if self.fail_delete:
            raise RuntimeError("Keychain locked")
        self.values.pop((service, name), None)


class MaterialsProjectConnectionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.keyring = MemoryKeyring()
        self.vault = CredentialVault(self.root, backend=self.keyring)
        self.environment = {}
        self.requests = []

        def opener(request, timeout):
            self.requests.append(request)
            return io.BytesIO(b'{"data":[]}')

        self.connection = MaterialsProjectConnection(self.vault, environment=self.environment, opener=opener)

    def assert_no_key(self, value):
        encoded = json.dumps(value)
        self.assertNotIn(SETTINGS_KEY, encoded)
        self.assertNotIn(ENVIRONMENT_KEY, encoded)

    def test_save_status_remove_and_restart_never_return_the_credential(self):
        self.assertFalse(self.connection.status()["configured"])
        saved = self.connection.save({"apiKey": SETTINGS_KEY})
        self.assertTrue(saved["configured"])
        self.assertEqual(saved["source"], "settings")
        self.assertEqual(saved["credentialStorage"], "os-keychain")
        self.assertTrue(saved["persistent"])
        self.assertFalse(saved["verified"])
        self.assert_no_key(saved)
        self.assertEqual(self.requests, [])  # Saving does not claim a provider check succeeded.

        restarted = MaterialsProjectConnection(CredentialVault(self.root, backend=self.keyring), environment={})
        self.assertEqual(restarted.api_key(), SETTINGS_KEY)
        self.assert_no_key(restarted.status())
        self.assertFalse(restarted.remove()["configured"])
        self.assertFalse(MaterialsProjectConnection(CredentialVault(self.root, backend=self.keyring), environment={}).status()["configured"])
        self.assertEqual(list(self.root.rglob("*")), [])

    def test_settings_override_environment_and_removal_reports_environment_fallback(self):
        self.environment["MP_API_KEY"] = ENVIRONMENT_KEY
        initial = self.connection.status()
        self.assertTrue(initial["configured"])
        self.assertEqual(initial["source"], "environment")
        self.assertEqual(self.connection.api_key(), ENVIRONMENT_KEY)
        self.assert_no_key(initial)
        self.connection.save({"apiKey": SETTINGS_KEY})
        self.assertEqual(self.connection.api_key(), SETTINGS_KEY)
        removed = self.connection.remove()
        self.assertTrue(removed["configured"])
        self.assertEqual(removed["source"], "environment")
        self.assertEqual(removed["credentialStorage"], "environment")
        self.assertEqual(self.connection.api_key(), ENVIRONMENT_KEY)
        self.assert_no_key(removed)

    def test_absent_keychain_is_explicitly_session_only_with_no_plaintext_fallback(self):
        with patch("backend.local_api.vault._system_backend", return_value=None):
            connection = MaterialsProjectConnection(CredentialVault(self.root), environment={})
        saved = connection.save({"apiKey": SETTINGS_KEY})
        self.assertEqual(saved["credentialStorage"], "session-only")
        self.assertFalse(saved["persistent"])
        self.assertEqual(connection.api_key(), SETTINGS_KEY)
        self.assert_no_key(saved)
        with patch("backend.local_api.vault._system_backend", return_value=None):
            restarted = MaterialsProjectConnection(CredentialVault(self.root), environment={})
            self.assertFalse(restarted.status()["configured"])
        self.assertEqual(list(self.root.rglob("*")), [])

    def test_failed_keychain_overwrite_preserves_saved_key_without_switching_to_memory(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        self.keyring.fail_write = True
        with self.assertRaises(ApiError) as failure:
            self.connection.save({"apiKey": ENVIRONMENT_KEY})
        self.assertEqual(failure.exception.code, "MP_CREDENTIAL_SAVE_FAILED")
        self.assertNotIn(ENVIRONMENT_KEY, str(failure.exception))
        self.assertEqual(self.connection.api_key(), SETTINGS_KEY)
        self.assertTrue(self.connection.status()["persistent"])
        self.assertEqual(self.vault.memory, {})
        restarted = MaterialsProjectConnection(CredentialVault(self.root, backend=self.keyring), environment={})
        self.assertEqual(restarted.api_key(), SETTINGS_KEY)

    def test_locked_keychain_cannot_silently_select_a_different_environment_account(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        self.environment["MP_API_KEY"] = ENVIRONMENT_KEY
        self.keyring.fail_read = True
        for operation in (self.connection.api_key, self.connection.status, self.connection.test):
            with self.subTest(operation=operation.__name__), self.assertRaises(ApiError) as failure:
                operation()
            self.assertEqual(failure.exception.code, "MP_CREDENTIAL_UNAVAILABLE")
            self.assertNotIn(ENVIRONMENT_KEY, str(failure.exception))
        self.assertEqual(self.requests, [])
        self.keyring.fail_read = False
        self.assertEqual(self.connection.api_key(), SETTINGS_KEY)

    def test_separate_workspaces_do_not_share_saved_credentials(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        other = MaterialsProjectConnection(CredentialVault(self.root / "another-workspace", backend=self.keyring), environment={})
        self.assertFalse(other.status()["configured"])
        other.save({"apiKey": ENVIRONMENT_KEY})
        self.assertEqual(other.api_key(), ENVIRONMENT_KEY)
        self.connection.remove()
        self.assertEqual(other.api_key(), ENVIRONMENT_KEY)

    def test_failed_delete_is_visible_and_does_not_claim_to_remove_the_saved_key(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        self.keyring.fail_delete = True
        with self.assertRaises(ApiError) as failure:
            self.connection.remove()
        self.assertNotIn(SETTINGS_KEY, str(failure.exception))
        self.assertTrue(self.connection.status()["configured"])
        restarted = MaterialsProjectConnection(CredentialVault(self.root, backend=self.keyring), environment={})
        self.assertEqual(restarted.api_key(), SETTINGS_KEY)

    def test_invalid_save_preserves_the_existing_key_and_does_not_send_requests(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        for payload in ({}, {"apiKey": None}, {"apiKey": ""}, {"apiKey": "a\nb"}, {"apiKey": "a\x00b"}, {"apiKey": [SETTINGS_KEY]}):
            with self.subTest(payload=payload), self.assertRaises(ApiError):
                self.connection.save(payload)
            self.assertEqual(self.connection.api_key(), SETTINGS_KEY)
        self.assertEqual(self.requests, [])

    def test_connection_test_sends_key_only_to_official_provider_and_resets_when_replaced(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        checked = self.connection.test()
        self.assertTrue(checked["verified"])
        self.assertTrue(checked["checkedAt"])
        self.assertEqual(len(self.requests), 1)
        request = self.requests[0]
        target = urlsplit(request.full_url)
        self.assertEqual((target.scheme, target.hostname), ("https", "api.materialsproject.org"))
        self.assertNotIn(SETTINGS_KEY, request.full_url)
        self.assertEqual(dict((key.lower(), value) for key, value in request.header_items())["x-api-key"], SETTINGS_KEY)
        self.assert_no_key(checked)
        self.connection.save({"apiKey": ENVIRONMENT_KEY})
        self.assertFalse(self.connection.status()["verified"])

    def test_missing_key_fails_before_network_and_provider_failure_cannot_leak_key(self):
        with self.assertRaises(ApiError) as missing:
            self.connection.test()
        self.assertEqual(missing.exception.code, "MP_API_KEY_MISSING")
        self.assertEqual(self.requests, [])
        self.connection.save({"apiKey": SETTINGS_KEY})
        rejection_body = io.BytesIO(SETTINGS_KEY.encode())

        def denied(request, timeout):
            raise HTTPError(request.full_url, 401, "Denied " + SETTINGS_KEY, {}, rejection_body)

        connection = MaterialsProjectConnection(self.vault, environment={}, opener=denied)
        with self.assertRaises(ApiError) as rejected:
            connection.test()
        self.assertNotIn(SETTINGS_KEY, str(rejected.exception))
        self.assertTrue(rejection_body.closed)
        self.assertFalse(connection.status()["verified"])

    def test_invalid_search_and_unreadable_provider_response_remain_safe(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        for query, limit in (("https://other.example/", 1), ("bearer secret", 1), ("mp-149", 0), ("mp-149", 31), ("mp-149", True)):
            with self.subTest(query=query, limit=limit), self.assertRaises(ApiError):
                self.connection.search(query, limit)
        self.assertEqual(self.requests, [])
        for raw in (b"not JSON", b'[]', b'{"data":{}}', b'{"data":[null]}'):
            connection = MaterialsProjectConnection(self.vault, environment={}, opener=lambda request, timeout: io.BytesIO(raw))
            with self.subTest(raw=raw), self.assertRaises(ApiError) as failure:
                connection.search("mp-149", 1)
            self.assertEqual(failure.exception.code, "MP_RESPONSE_INVALID")
            self.assertNotIn(SETTINGS_KEY, str(failure.exception))
            self.assertFalse(connection.status()["verified"])

    def test_revoked_key_loses_previous_verified_status(self):
        self.connection.save({"apiKey": SETTINGS_KEY})
        self.assertTrue(self.connection.test()["verified"])
        rejection_body = io.BytesIO(b"Denied")

        def denied(request, timeout):
            raise HTTPError(request.full_url, 403, "Denied", {}, rejection_body)

        self.connection.opener = denied
        with self.assertRaises(ApiError) as failure:
            self.connection.search("mp-149", 1)
        self.assertEqual(failure.exception.code, "MP_API_ERROR")
        status = self.connection.status()
        self.assertTrue(status["configured"])
        self.assertFalse(status["verified"])
        self.assertIsNone(status["checkedAt"])
        self.assertTrue(rejection_body.closed)


class NativeMaterialsProjectTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.keyring = MemoryKeyring()
        backend = patch("backend.local_api.vault._system_backend", return_value=self.keyring)
        backend.start()
        self.addCleanup(backend.stop)
        environment = patch.dict(os.environ, {"MP_API_KEY": "", "PHYNITE_CLOUD_API_URL": "", "PHYNITE_CLOUD_AWS_REGION": "", "PHYNITE_CLOUD_COGNITO_CLIENT_ID": ""})
        environment.start()
        self.addCleanup(environment.stop)
        self.application = DesktopApplication(self.root, 49122, "http://127.0.0.1:3000")
        self.addCleanup(self.application.close)

    def call(self, method, path, payload=None, query=None):
        result = self.application.dispatch(method, path, json.dumps(payload or {}).encode(), {"Authorization": "Bearer " + self.application.token}, query or {})
        self.assertEqual(result["statusCode"], 200 if method != "POST" or path != "/v1/projects" else 201)
        body = json.loads(result["body"])
        self.assertNotIn(SETTINGS_KEY, json.dumps(body))
        return body

    def test_all_native_materials_endpoints_require_launcher_authorization(self):
        for method, path in (("GET", "/__local/materials-project"), ("PUT", "/__local/materials-project"), ("DELETE", "/__local/materials-project"), ("POST", "/__local/materials-project/test"), ("GET", "/__local/materials-project/search")):
            with self.subTest(method=method, path=path), self.assertRaises(ApiError) as failure:
                self.application.dispatch(method, path, json.dumps({"apiKey": SETTINGS_KEY}).encode(), {}, {"q": "mp-149"})
            self.assertEqual(failure.exception.code, "LOCAL_SESSION_REQUIRED")
        self.assertFalse(self.application.materials_project.status()["configured"])
        for suffix in ("key", "environment", "test/extra"):
            with self.subTest(suffix=suffix), self.assertRaises(ApiError) as failure:
                self.call("GET", "/__local/materials-project/" + suffix)
            self.assertEqual(failure.exception.status, 404)

    def test_saved_key_drives_native_and_legacy_search_and_is_excluded_from_project_exports(self):
        self.call("PUT", "/__local/materials-project", {"apiKey": SETTINGS_KEY})
        fixture = json.loads((Path(__file__).resolve().parents[2] / "tests/fixtures/crystal-database-imports.json").read_text())["materialsProject"]
        document = json.loads(fixture["sourceData"]["content"])
        seen = []

        def opener(request, timeout):
            seen.append(request)
            self.assertEqual(dict((key.lower(), value) for key, value in request.header_items())["x-api-key"], SETTINGS_KEY)
            return io.BytesIO(json.dumps({"data": [document]}).encode())

        self.application.materials_project.opener = opener
        native = self.call("GET", "/__local/materials-project/search", query={"q": "mp-149", "limit": "1"})
        self.assertEqual(native["data"][0]["material_id"], fixture["materialId"])
        legacy = self.call("GET", "/v1/materials", query={"q": "mp-149"})
        self.assertEqual(legacy["materials"][0]["materialId"], fixture["materialId"])
        self.assertEqual(len(seen), 2)
        project = self.call("POST", "/v1/projects", {"name": "Neutral materials reference"})["project"]["id"]
        export = self.call("POST", f"/__local/projects/{project}/export")
        with zipfile.ZipFile(self.application.archives.export_path(export["exportId"])) as archive:
            for name in archive.namelist():
                self.assertNotIn(SETTINGS_KEY.encode(), archive.read(name), name)
        for path in self.root.rglob("*"):
            if path.is_file():
                self.assertNotIn(SETTINGS_KEY.encode(), path.read_bytes(), str(path.relative_to(self.root)))
        self.assertFalse(self.call("DELETE", "/__local/materials-project")["configured"])


if __name__ == "__main__":
    unittest.main()
