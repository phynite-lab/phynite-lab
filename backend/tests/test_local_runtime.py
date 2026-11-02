from __future__ import annotations

import hashlib
import io
import json
import os
import platform
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import HTTPSHandler
from unittest import mock

from backend.local_api.runtime import RuntimeInstallError, RuntimeManager, _PinnedRedirect, runtime_platform, runtime_ssl_context
from backend.local_api.sandbox import NativeSandbox, SandboxError
from backend.local_api.scheduler import ResourceError, ResourceScheduler
from backend.local_api.cloud_client import CloudClient, CloudError
from backend.local_api.gateway import GatewayRegistry
from backend.local_api.vault import CredentialVault
from backend.local_api.runtime import _open

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local_worker"))
import worker


def archive(entries: list[tuple[str, bytes, int | None]]) -> bytes:
    content = io.BytesIO()
    with tarfile.open(fileobj=content, mode="w:gz") as package:
        for name, value, mode in entries:
            member = tarfile.TarInfo(name)
            member.size = len(value)
            member.mode = mode if mode is not None else 0o644
            package.addfile(member, io.BytesIO(value))
    return content.getvalue()


class RuntimeInstallTests(unittest.TestCase):
    def test_download_trust_survives_absent_build_machine_ca_paths(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"SSL_CERT_FILE": str(Path(directory) / "absent.pem"), "SSL_CERT_DIR": directory}):
            self.assertEqual(ssl.create_default_context().cert_store_stats()["x509_ca"], 0)
            context = runtime_ssl_context()
            self.assertGreater(context.cert_store_stats()["x509_ca"], 0)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)

    def test_cloud_gateway_and_worker_keep_bundled_verified_https_trust(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"SSL_CERT_FILE": str(Path(directory) / "absent.pem"), "SSL_CERT_DIR": directory, "PHYNITE_APP_MODE": "local"}), mock.patch("backend.local_api.vault._system_backend", return_value=None):
            vault = CredentialVault(Path(directory))
            cloud = CloudClient(vault, "https://api.example.test", region="ap-southeast-1", client_id="unit-client")
            gateway = GatewayRegistry(Path(directory), vault)
            contexts = [runtime_ssl_context(), worker.worker_ssl_context()]
            contexts.extend(handler._context for opener in (cloud.opener, gateway.opener) for handler in opener.handlers if isinstance(handler, HTTPSHandler))
            self.assertEqual(len(contexts), 4)
            for context in contexts:
                self.assertGreater(context.cert_store_stats()["x509_ca"], 0)
                self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
                self.assertTrue(context.check_hostname)

    def test_actual_https_rejects_untrusted_certificate_for_download_cloud_and_gateway(self):
        import shutil
        openssl = shutil.which("openssl")
        if not openssl:
            self.skipTest("OpenSSL is needed only to create the disposable untrusted TLS fixture.")

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')

        with tempfile.TemporaryDirectory() as directory, mock.patch("backend.local_api.vault._system_backend", return_value=None):
            root = Path(directory)
            subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-days", "1", "-nodes", "-keyout", str(root / "key.pem"), "-out", str(root / "cert.pem"), "-subj", "/CN=localhost"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=15)
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(str(root / "cert.pem"), str(root / "key.pem"))
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                origin = f"https://127.0.0.1:{server.server_port}"
                with self.assertRaises(URLError) as rejected:
                    _open(origin + "/download")
                self.assertIsInstance(rejected.exception.reason, ssl.SSLCertVerificationError)
                vault = CredentialVault(root)
                cloud = CloudClient(vault, origin, region="ap-southeast-1", client_id="unit-client")
                with self.assertRaises(CloudError) as rejected:
                    cloud._json(origin + "/v1/me", "GET")
                self.assertEqual(rejected.exception.code, "CLOUD_UNAVAILABLE")
                gateway = GatewayRegistry(root, vault)
                gateway.configure(origin)
                with self.assertRaises(CloudError) as rejected:
                    gateway._open("/v1/models")
                self.assertEqual(rejected.exception.code, "AI_GATEWAY_UNAVAILABLE")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.manifest = self.root / "manifest.json"
        self.body = b"#!/bin/sh\nprintf 'test runtime fixture'\n"
        self.notice = b"Test fixture only; not scientific output."
        self.content = archive([("bin/pw.x", self.body, 0o755), ("NOTICE.txt", self.notice, None)])

    def tearDown(self):
        self.temporary.cleanup()

    def manager(self, *, data: bytes | None = None, **overrides):
        entry = {"version": "1.0", "sha256": hashlib.sha256(self.content).hexdigest(), "url": "https://runtime.example.test/dft.tar.gz", "sizeBytes": len(self.content), "unpackedBytes": len(self.body) + len(self.notice), "executables": {"pw.x": "bin/pw.x"}, "notices": ["NOTICE.txt"], **overrides}
        self.manifest.write_text(json.dumps({"schemaVersion": 1, "components": {"dft": {runtime_platform(): entry}}}))
        return RuntimeManager(self.root / "data", self.manifest, downloader=lambda _: io.BytesIO(self.content if data is None else data))

    def test_verified_archive_installs_atomically_and_environment_finds_executable(self):
        manager = self.manager()
        result = manager.install("dft")
        self.assertEqual(result["installed"]["sha256"], hashlib.sha256(self.content).hexdigest())
        executable = Path(manager.environment()["PATH"].split(os.pathsep)[0]) / "pw.x"
        self.assertEqual(executable.read_bytes(), self.body)
        self.assertTrue(os.access(executable, os.X_OK))
        self.assertEqual(manager._progress["state"], "complete")
        self.assertEqual(list(manager.root.glob(".staging-*")), [])

    def test_declared_scientific_python_is_selected_without_global_python(self):
        manager = self.manager(executables={"python": "bin/pw.x"})
        manager.install("dft")
        environment = manager.environment()
        self.assertEqual(environment["PHYNITE_RUNTIME_PYTHON"], environment["PHYNITE_RUNTIME_PYTHON_DFT"])
        self.assertTrue(Path(environment["PHYNITE_RUNTIME_PYTHON"]).is_file())

    def test_corrupt_archive_preserves_active_runtime_and_removes_staging(self):
        manager = self.manager()
        manager.install("dft")
        original = (manager.root / "active.json").read_bytes()
        damaged = self.manager(data=b"corrupted", version="2.0")
        with self.assertRaisesRegex(RuntimeInstallError, "size or SHA-256"):
            damaged.install("dft")
        self.assertEqual((manager.root / "active.json").read_bytes(), original)
        self.assertEqual(list(manager.root.glob(".staging-*")), [])

    def test_download_overrun_is_bounded(self):
        manager = self.manager(data=self.content + b"overflow")
        with self.assertRaisesRegex(RuntimeInstallError, "download size"):
            manager.install("dft")
        self.assertFalse((manager.root / "active.json").exists())

    def test_archive_path_traversal_and_symlinks_are_rejected(self):
        malicious = archive([("../outside", b"forbidden", 0o644)])
        manager = self.manager(data=malicious, sha256=hashlib.sha256(malicious).hexdigest(), sizeBytes=len(malicious))
        with self.assertRaisesRegex(RuntimeInstallError, "unsafe path"):
            manager.install("dft")
        self.assertFalse((manager.root / "outside").exists())
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as package:
            member = tarfile.TarInfo("bin/pw.x")
            member.type = tarfile.SYMTYPE
            member.linkname = "/usr/bin/true"
            package.addfile(member)
        content = output.getvalue()
        manager = self.manager(data=content, sha256=hashlib.sha256(content).hexdigest(), sizeBytes=len(content))
        with self.assertRaisesRegex(RuntimeInstallError, "links"):
            manager.install("dft")

    def test_expansion_limit_notices_and_missing_executable_fail_closed(self):
        for overrides, expected in [({"unpackedBytes": 1}, "expands"), ({"notices": ["missing-notice"]}, "notice"), ({"executables": {"pw.x": "bin/missing"}}, "executable")]:
            with self.subTest(overrides=overrides):
                manager = self.manager(**overrides)
                with self.assertRaisesRegex(RuntimeInstallError, expected):
                    manager.install("dft")
                self.assertFalse((manager.root / "active.json").exists())

    def test_absent_manifest_reports_no_download_instead_of_fabricating_release(self):
        manager = RuntimeManager(self.root / "data")
        with mock.patch.object(manager.sandbox, "probe", return_value={"available": False}):
            status = manager.status()
        self.assertFalse(status["downloadAvailable"])
        self.assertEqual(status["availableComponents"], [])
        with self.assertRaisesRegex(RuntimeInstallError, "No reviewed runtime"):
            manager.install("md")

    def test_invalid_urls_and_unknown_components_never_download(self):
        for url in ("http://runtime.example.test/file", "file:///etc/passwd", "https://user:secret@example.test/a"):
            manager = self.manager(url=url)
            with self.subTest(url=url), mock.patch.object(manager, "downloader") as download:
                with self.assertRaises(RuntimeInstallError):
                    manager.install("dft")
                download.assert_not_called()
        with self.assertRaises(RuntimeInstallError):
            self.manager().install("https://injected.test/archive")

    def test_redirect_to_an_unreviewed_origin_is_rejected(self):
        import urllib.request
        request = urllib.request.Request("https://runtime.example.test/file")
        with self.assertRaisesRegex(RuntimeInstallError, "approved origin"):
            _PinnedRedirect().redirect_request(request, None, 302, "redirect", {}, "https://other.test/file")

    def test_low_disk_space_keeps_existing_installation(self):
        manager = self.manager()
        with mock.patch("backend.local_api.runtime.shutil.disk_usage", return_value=mock.Mock(free=1)):
            with self.assertRaisesRegex(RuntimeInstallError, "disk space"):
                manager.install("dft")
        self.assertFalse((manager.root / "active.json").exists())


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.capacity = mock.patch.object(ResourceScheduler, "capacity", return_value={"cpuCapacity": 8, "memoryCapacityMiB": 8192, "memoryEnforcement": "rss-watchdog"})
        self.capacity.start()
        self.scheduler = ResourceScheduler(self.root)

    def tearDown(self):
        self.scheduler.close()
        self.capacity.stop()
        self.temporary.cleanup()

    def test_defaults_and_persistent_settings_leave_existing_grants_unchanged(self):
        self.assertEqual(self.scheduler.settings()["vcpus"], 4)
        self.assertEqual(self.scheduler.settings()["memoryMiB"], 4096)
        first = self.scheduler.reserve("first", 2, 2048)
        self.scheduler.configure({"vcpus": 1, "memoryMiB": 1024})
        self.assertEqual(self.scheduler.job("first")["vcpus"], first["vcpus"])
        self.assertEqual(self.scheduler.job("first")["memoryMiB"], 2048)
        with self.assertRaises(ResourceError):
            self.scheduler.reserve("second", 1, 1024)
        self.scheduler.release("first", "completed")
        self.assertEqual(self.scheduler.reserve("second")["vcpus"], 1)

    def test_parallel_admission_is_atomic_and_totals_are_not_oversubscribed(self):
        self.scheduler.configure({"maxParallelJobs": 4})
        def admit(index):
            try:
                self.scheduler.reserve(f"job-{index}", 2, 2048)
                return True
            except ResourceError:
                return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            accepted = list(pool.map(admit, range(8)))
        self.assertEqual(sum(accepted), 2)

    def test_duplicate_job_id_and_invalid_resources_are_rejected(self):
        self.scheduler.reserve("same", 1, 1024)
        self.scheduler.release("same", "failed")
        with self.assertRaisesRegex(ResourceError, "Recovery"):
            self.scheduler.reserve("same")
        for configuration in ({"vcpus": True}, {"memoryMiB": 0}, {"maxParallelJobs": 9}, {"anything": 1}):
            with self.subTest(configuration=configuration), self.assertRaises(ResourceError):
                self.scheduler.configure(configuration)

    def test_restart_does_not_relaunch_jobs_and_second_owner_is_rejected(self):
        self.scheduler.reserve("interrupted")
        with self.assertRaisesRegex(ResourceError, r"already owns.*PID"):
            ResourceScheduler(self.root)
        self.scheduler.close()
        self.scheduler = ResourceScheduler(self.root)
        self.assertEqual(self.scheduler.job("interrupted")["status"], "interrupted")
        self.scheduler.reserve("new")

    def test_lock_metadata_is_diagnostic_only_and_refreshes_after_restart(self):
        lock = self.root / ".scheduler.lock"
        owner = json.loads(lock.read_text())
        self.assertEqual(owner["pid"], os.getpid())
        self.assertIsInstance(owner["created"], (int, float))
        self.scheduler.close()
        self.scheduler = ResourceScheduler(self.root)
        refreshed = json.loads(lock.read_text())
        self.assertEqual(refreshed["pid"], os.getpid())
        self.assertGreaterEqual(refreshed["startedAt"], owner["startedAt"])

    def test_watchdog_terminates_actual_child_with_truthful_memory_reason(self):
        process = subprocess.Popen([sys.executable, "-c", "import time;data=bytearray(20*1024*1024);time.sleep(60)"])
        try:
            self.scheduler.reserve("memory", 1, 1)
            self.scheduler.attach("memory", process.pid)
            # Even the interpreter alone exceeds the 1 MiB grant.
            import time
            time.sleep(0.1)
            stopped = self.scheduler.poll()
            process.wait(timeout=10)
            self.assertEqual(stopped[0]["status"], "failed")
            self.assertIn("RSS", stopped[0]["reason"])
            self.assertIn("not an OS hard limit", stopped[0]["reason"])
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

    def test_cancel_only_controls_attached_child_and_pid_reuse_is_fenced(self):
        self.scheduler.reserve("invalid", 1, 1024)
        with self.assertRaises(ResourceError):
            self.scheduler.attach("invalid", os.getpid())
        process = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"])
        try:
            self.scheduler.attach("invalid", process.pid)
            with self.scheduler._db() as db:
                db.execute("UPDATE jobs SET created=created-100 WHERE id='invalid'")
            self.scheduler.cancel("invalid")
            self.assertIsNone(process.poll())
            self.assertEqual(self.scheduler.job("invalid")["status"], "cancelled")
        finally:
            process.kill()
            process.wait()

    def test_live_orphan_keeps_resource_reservation_until_explicit_cancel(self):
        process = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"])
        try:
            self.scheduler.reserve("orphan")
            self.scheduler.attach("orphan", process.pid)
            self.scheduler.close()
            self.scheduler = ResourceScheduler(self.root)
            self.assertEqual(self.scheduler.job("orphan")["status"], "recovery-required")
            with self.assertRaises(ResourceError):
                self.scheduler.reserve("new")
            self.scheduler.cancel("orphan")
            process.wait(timeout=10)
            self.scheduler.reserve("new")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

    def test_watchdog_waits_for_runner_acknowledgment_after_child_exits(self):
        process = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(.1)"])
        self.scheduler.reserve("exit", 1, 1024)
        self.scheduler.attach("exit", process.pid)
        process.wait(timeout=10)
        self.assertEqual(self.scheduler.poll(), [])
        self.assertEqual(self.scheduler.job("exit")["status"], "running")
        self.scheduler.release("exit", "completed")
        self.assertEqual(self.scheduler.job("exit")["status"], "completed")


class SandboxTests(unittest.TestCase):
    def test_missing_sandbox_is_not_a_manual_capability(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch("backend.local_api.sandbox.shutil.which", return_value=None), mock.patch("backend.local_api.sandbox.os.access", return_value=False):
            sandbox = NativeSandbox(Path(folder))
            self.assertFalse(sandbox.probe()["available"])
            with self.assertRaises(SandboxError):
                sandbox.command(Path(folder), [sys.executable, "-c", "pass"])

    @unittest.skipUnless(platform.system() == "Darwin" and Path("/usr/bin/sandbox-exec").is_file(), "actual macOS sandbox-exec is unavailable")
    def test_actual_macos_job_can_write_workspace_but_not_outside_or_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sandbox = NativeSandbox(root)
            self.assertTrue(sandbox.probe(refresh=True)["available"])
            job = root / "job"
            job.mkdir()
            outside = root / "outside"
            script = "import pathlib,sys;pathlib.Path(sys.argv[1]).write_text('forbidden')"
            command = sandbox.command(job, [sys.executable, "-c", script, str(outside)])
            process = subprocess.run(command, cwd=job, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse(outside.exists())
            shell = sandbox.command(job, ["/bin/sh", "-c", "printf system-shell-readable"])
            process = subprocess.run(shell, cwd=job, capture_output=True, text=True, timeout=10)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(process.stdout, "system-shell-readable")

    @unittest.skipUnless(platform.system() == "Darwin" and Path("/usr/bin/sandbox-exec").is_file(), "actual macOS sandbox-exec is unavailable")
    def test_actual_macos_can_import_selected_namespace_without_reading_siblings(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            packages = root / "packages"
            module = packages / "fixture_namespace" / "backend"
            module.mkdir(parents=True)
            (module / "science.py").write_text("value = 42\n")
            secret = packages / "private.txt"
            secret.write_text("private fixture")
            job = root / "job"
            job.mkdir()
            sandbox = NativeSandbox(root / "probe", (module,))
            script = "import pathlib,sys;sys.path.insert(0,sys.argv[1]);from fixture_namespace.backend.science import value;assert value==42\ntry:\n pathlib.Path(sys.argv[2]).read_text()\nexcept PermissionError:\n pass\nelse:\n raise AssertionError('sibling contents were exposed')"
            command = sandbox.command(job, [sys.executable, "-c", script, str(packages), str(secret)])
            process = subprocess.run(command, cwd=job, capture_output=True, text=True, timeout=10)
            self.assertEqual(process.returncode, 0, process.stderr)


class DesktopWorkerTests(unittest.TestCase):
    def test_desktop_artifacts_are_pinned_to_actual_dynamic_core_origin(self):
        origin = "http://127.0.0.1:39217"
        allowed = origin + "/__local/artifacts?ticket=signed&Phynite-Signed-Headers=content-type;x-amz-checksum-sha256"
        self.assertEqual(worker.presigned_url_headers(allowed, local_origin=origin), {"content-type", "x-amz-checksum-sha256"})
        for url in ("http://127.0.0.1:8792/__local/artifacts?ticket=x", "https://evil.test/__local/artifacts?ticket=x", origin + "/__local/session?ticket=x", origin + "/__local/artifacts", "http://user@127.0.0.1:39217/__local/artifacts?ticket=x"):
            with self.subTest(url=url), self.assertRaises(worker.WorkerError):
                worker.presigned_url_headers(url, local_origin=origin)

    def test_local_capabilities_require_probe_even_with_packaged_flag(self):
        process = subprocess.CompletedProcess([], 0, stdout="LAMMPS fixture", stderr="")
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, {"PHYNITE_APP_MODE": "local", "PHYNITE_PACKAGED_COMPUTE": "1", "PHYNITE_DATA_DIR": folder}), mock.patch.object(worker.shutil, "which", return_value="/bin/lmp"), mock.patch.object(worker.subprocess, "run", return_value=process), mock.patch.object(worker, "desktop_native_sandbox") as sandbox:
            sandbox.return_value.probe.return_value = {"available": False}
            unconfined = worker.md_runtime_manifest("native", None)
            self.assertEqual(unconfined["executionMode"], "native")
            self.assertFalse(unconfined["manualInput"])
            sandbox.return_value.probe.return_value = {"available": True}
            confined = worker.md_runtime_manifest("native", None)
            self.assertEqual(confined["executionMode"], "native-sandbox")
            self.assertTrue(confined["manualInput"])

    def test_local_primary_workspaces_do_not_expire_as_cloud_caches(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, {"PHYNITE_APP_MODE": "local"}):
            root = Path(folder)
            calculation = root / "calculation"
            calculation.mkdir()
            marker = calculation / ".retention-start"
            marker.touch()
            os.utime(marker, (1, 1))
            self.assertEqual(worker.cleanup_expired_workspaces(root), [])
            self.assertTrue(calculation.exists())

    def test_resource_reservation_is_released_when_native_runner_raises(self):
        client = mock.Mock()
        client.post.return_value = {"reserved": True}
        job = {"calculationId": "test-job", "ownerId": "owner", "vcpus": 2, "memoryMiB": 1024}
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, {"PHYNITE_APP_MODE": "local"}), mock.patch.object(worker, "_run_job", side_effect=worker.WorkerError("runner failed")):
            with self.assertRaisesRegex(worker.WorkerError, "runner failed"):
                worker.run_job(client, "worker", job, Path(folder), "unused", 5, 60, Path(folder), runtime="native")
        self.assertEqual(client.post.call_args_list[0].args[0], "/__local/jobs/test-job/reserve")
        self.assertEqual(client.post.call_args_list[-1].args[0], "/__local/jobs/test-job/release")
        self.assertEqual(client.post.call_args_list[-1].args[1]["status"], "interrupted")

    def test_md_only_local_install_does_not_advertise_qe(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, {"PHYNITE_APP_MODE": "local"}), mock.patch.object(worker, "validate_native_runtime", side_effect=worker.WorkerError("pw.x missing")), mock.patch.object(worker, "native_md_analysis_available", return_value=True), mock.patch.object(worker.shutil, "which", side_effect=lambda name: "/bin/lmp" if name == "lmp" else None), mock.patch("sys.stdout", new_callable=io.StringIO) as output:
            result = worker.main(["--api-url", "http://127.0.0.1:39217", "--token", "test-only-token-with-32-characters-or-more", "--runtime", "native", "--work-dir", folder, "--check"])
        self.assertEqual(result, 0)
        self.assertIn("md-analysis, md-simulation", output.getvalue())
        self.assertNotIn("qe,", output.getvalue())

    def test_frozen_core_does_not_assume_it_is_scientific_python(self):
        clean = {key: value for key, value in os.environ.items() if not key.startswith("PHYNITE_RUNTIME_PYTHON")}
        with mock.patch.dict(os.environ, clean, clear=True), mock.patch.object(sys, "frozen", True, create=True):
            self.assertIsNone(worker.scientific_python("dft"))
            self.assertFalse(worker.native_md_analysis_available())


if __name__ == "__main__":
    unittest.main()
