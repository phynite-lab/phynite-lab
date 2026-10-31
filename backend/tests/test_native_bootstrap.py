from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.local_api.sandbox import NativeSandbox, SandboxError

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/build-native-bootstrap.py"
SPEC = importlib.util.spec_from_file_location("native_bootstrap", SCRIPT)
producer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(producer)


def elf(machine=183):
    return b"\x7fELF\x02\x01" + b"\0" * 12 + struct.pack("<H", machine) + b"unit-test fixture, not a runtime"


class PackagedSandboxTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.bootstrap = self.root / "bootstrap"
        (self.bootstrap / "libraries").mkdir(parents=True)
        self.binary = self.bootstrap / "bwrap"
        self.binary.write_bytes(elf())
        self.binary.chmod(0o755)
        self.library = self.bootstrap / "libraries/libcap.so.2"
        self.library.write_bytes(elf())
        self.manifest = {"schemaVersion": 1, "target": "linux-arm64", "tools": {"bwrap": {"executable": "bwrap", "sha256": producer.digest(self.binary), "libraries": [{"path": "libraries/libcap.so.2", "sha256": producer.digest(self.library)}]}}}
        self.save()

    def tearDown(self):
        self.temporary.cleanup()

    def save(self):
        (self.bootstrap / "manifest.json").write_text(json.dumps(self.manifest))

    def tool(self):
        with mock.patch("backend.local_api.sandbox.platform.system", return_value="Linux"), mock.patch("backend.local_api.sandbox.platform.machine", return_value="aarch64"), mock.patch("backend.local_api.sandbox.shutil.which", return_value=None):
            return NativeSandbox(self.root / "data", bootstrap_dir=self.bootstrap)._tool()

    def test_mac_system_sandbox_is_selected_with_empty_path(self):
        with mock.patch("backend.local_api.sandbox.platform.system", return_value="Darwin"), mock.patch.dict(os.environ, {"PATH": ""}), mock.patch("backend.local_api.sandbox.Path.is_file", return_value=True), mock.patch("backend.local_api.sandbox.os.access", return_value=True), mock.patch("backend.local_api.sandbox.shutil.which", side_effect=AssertionError("PATH lookup is forbidden for the system sandbox")):
            self.assertEqual(NativeSandbox(self.root / "data")._tool(), ("Darwin", "/usr/bin/sandbox-exec"))

    def test_mac_missing_system_sandbox_cannot_fall_back_to_path(self):
        with mock.patch("backend.local_api.sandbox.platform.system", return_value="Darwin"), mock.patch("backend.local_api.sandbox.Path.is_file", return_value=False), mock.patch("backend.local_api.sandbox.shutil.which", return_value="/untrusted/sandbox-exec"):
            with self.assertRaises(SandboxError):
                NativeSandbox(self.root / "data")._tool()

    def test_frozen_probe_reuses_its_own_runtime_without_inheriting_loader_overrides(self):
        extraction = self.root / 'extracted-runtime'
        extraction.mkdir()
        sandbox = NativeSandbox(self.root / 'data')
        def probe(command, **options):
            environment = options['env']
            self.assertEqual(environment['_PYI_APPLICATION_HOME_DIR'], str(extraction))
            self.assertEqual(environment['_PYI_ARCHIVE_FILE'], str(Path(sys.executable).resolve()))
            self.assertEqual(environment['_PYI_PARENT_PROCESS_LEVEL'], '1')
            self.assertNotIn('PYINSTALLER_RESET_ENVIRONMENT', environment)
            self.assertNotIn('UNRELATED_PROVIDER_SECRET', environment)
            return subprocess.CompletedProcess(command, 0, json.dumps({'workspaceWrite': True, 'outsideWriteDenied': True, 'externalNetworkDenied': True}), '')
        with mock.patch.object(sys, 'frozen', True, create=True), mock.patch.object(sys, '_MEIPASS', str(extraction), create=True), mock.patch.dict(os.environ, {'_PYI_APPLICATION_HOME_DIR': '/untrusted', '_PYI_PARENT_PROCESS_LEVEL': '0', 'PYINSTALLER_RESET_ENVIRONMENT': '1', 'UNRELATED_PROVIDER_SECRET': 'synthetic-fixture'}), mock.patch.object(sandbox, '_tool', return_value=('Darwin', '/usr/bin/sandbox-exec')), mock.patch.object(sandbox, '_command', return_value=['fixed-probe']), mock.patch('backend.local_api.sandbox.subprocess.run', side_effect=probe):
            self.assertTrue(sandbox.probe()['available'])

    def test_frozen_probe_without_active_extraction_fails_closed(self):
        sandbox = NativeSandbox(self.root / 'data')
        with mock.patch.object(sys, 'frozen', True, create=True), mock.patch.object(sys, '_MEIPASS', None, create=True), mock.patch.object(sandbox, '_tool', return_value=('Darwin', '/usr/bin/sandbox-exec')), mock.patch('backend.local_api.sandbox.subprocess.run') as run:
            self.assertFalse(sandbox.probe()['available'])
            run.assert_not_called()

    def test_linux_rebinds_selected_temporary_runtime_read_only_after_hiding_tmp(self):
        with tempfile.TemporaryDirectory(dir='/tmp', prefix='phynite-bootstrap-runtime-') as folder:
            extraction = Path(folder) / 'runtime'
            extraction.mkdir()
            job = self.root / 'job'
            job.mkdir()
            # Keep Linux's literal /tmp spelling when testing on a macOS host.
            with mock.patch.object(Path, 'resolve', lambda path, **options: path), mock.patch.object(sys, 'prefix', str(extraction)), mock.patch.object(sys, 'base_prefix', str(extraction)):
                sandbox = NativeSandbox(self.root)
                with mock.patch.object(sandbox, '_tool', return_value=('Linux', '/verified/bwrap')):
                    command = sandbox._command(job, ['/usr/bin/true'])
            hidden = next(i for i in range(len(command)) if command[i:i+2] == ['--tmpfs', '/tmp'])
            runtime = next(i for i in range(len(command)) if command[i:i+3] == ['--ro-bind', str(extraction), str(extraction)])
            writable = command.index('--bind')
            self.assertLess(hidden, runtime)
            self.assertLess(runtime, writable)
            self.assertEqual(command[writable+1:writable+3], [str(job), str(job)])

    def test_verified_packaged_binary_is_selected_without_system_bubblewrap(self):
        self.assertEqual(self.tool(), ("Linux", str(self.binary)))

    def test_tampered_binary_library_wrong_target_and_setuid_modes_are_rejected(self):
        changes = [lambda: self.binary.write_bytes(b"tampered"), lambda: self.library.write_bytes(b"tampered"), lambda: self.manifest.update(target="linux-x64"), lambda: self.binary.chmod(0o4755)]
        for change in changes:
            self.binary.write_bytes(elf()); self.binary.chmod(0o755)
            self.library.write_bytes(elf()); self.manifest["target"] = "linux-arm64"
            change(); self.save()
            with self.subTest(change=change), self.assertRaisesRegex(SandboxError, "failed verification"):
                self.tool()

    def test_symlinked_or_traversing_tool_never_executes(self):
        self.binary.unlink()
        self.binary.symlink_to(self.library)
        with self.assertRaises(SandboxError):
            self.tool()
        self.manifest["tools"]["bwrap"]["executable"] = "../outside"
        self.save()
        with self.assertRaises(SandboxError):
            self.tool()

    def test_valid_tool_manifest_alone_does_not_advertise_verified_isolation(self):
        with mock.patch("backend.local_api.sandbox.platform.system", return_value="Linux"), mock.patch("backend.local_api.sandbox.platform.machine", return_value="aarch64"), mock.patch("backend.local_api.sandbox.subprocess.run", side_effect=OSError("kernel denied namespace")):
            result = NativeSandbox(self.root / "data", bootstrap_dir=self.bootstrap).probe()
        self.assertFalse(result["available"])
        self.assertIn("kernel denied", result["reason"])

    def test_failed_probe_exposes_bounded_native_diagnostic_without_advertising_isolation(self):
        sandbox = NativeSandbox(self.root / 'data', bootstrap_dir=self.bootstrap)
        reply = subprocess.CompletedProcess([], 1, stdout='', stderr='bwrap: Creating new namespace failed: Operation not permitted\n' + 'x' * 1000)
        with mock.patch('backend.local_api.sandbox.platform.system', return_value='Linux'), mock.patch('backend.local_api.sandbox.platform.machine', return_value='aarch64'), mock.patch('backend.local_api.sandbox.subprocess.run', return_value=reply):
            result = sandbox.probe()
        self.assertFalse(result['available'])
        self.assertIn('Operation not permitted', result['reason'])
        self.assertLess(len(result['reason']), 500)


class BootstrapProducerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.prefix = self.root / "prefix"
        for name in ["bin", "lib", "conda-meta"]:
            (self.prefix / name).mkdir(parents=True)
        for name in ["bin/bwrap", "bin/patchelf", "lib/libcap.so.2"]:
            path = self.prefix / name; path.write_bytes(elf()); path.chmod(0o755)
        record = {"name": "bubblewrap", "version": "0.13.1", "build": "test", "url": "https://conda.anaconda.org/conda-forge/linux-aarch64/bubblewrap-0.13.1-test.conda", "sha256": "a" * 64}
        self.lock = {"target": "linux-arm64", "minimumGlibc": "2.39", "packages": [record]}
        (self.prefix / "conda-meta/bubblewrap.json").write_text(json.dumps(record))
        self.notices = self.root / "notices"; self.notices.mkdir()
        (self.notices / "LICENSE").write_text("unit-test license fixture")
        self.commands = []

    def tearDown(self):
        self.temporary.cleanup()

    def inspect(self, command):
        self.commands.append(command)
        if "--print-interpreter" in command:
            return "/lib/ld-linux-aarch64.so.1"
        if "--print-needed" in command:
            return "libcap.so.2\nlibc.so.6" if command[-1].endswith("bwrap") else "libc.so.6"
        return ""

    def build(self, **options):
        return producer.assemble(self.prefix, self.root / "output", "linux-arm64", self.lock, self.notices, inspect=options.get("inspect", self.inspect), qualify=options.get("qualify", lambda _: {"available": True, "fixture": True}))

    def test_relocatable_bootstrap_flattens_libraries_hashes_actual_files_and_keeps_notices(self):
        result = self.build()
        output = Path(result["directory"])
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["tools"]["bwrap"]["libraries"], [{"path": "libraries/libcap.so.2", "sha256": producer.digest(output / "libraries/libcap.so.2")}])
        self.assertIn("$ORIGIN/libraries", [arg for command in self.commands for arg in command])
        self.assertIn("$ORIGIN", [arg for command in self.commands for arg in command])
        self.assertTrue((output / "notices/LICENSE").is_file())
        self.assertFalse((output / "libraries/libcap.so.2").is_symlink())

    def test_inventory_or_provenance_mismatch_is_rejected_before_output(self):
        self.lock["packages"][0]["sha256"] = "b" * 64
        with self.assertRaisesRegex(producer.BootstrapError, "provenance"):
            self.build()
        self.assertFalse((self.root / "output").exists())

    def test_offline_file_origin_requires_retained_exact_archive_without_relabeling_metadata(self):
        record = self.lock["packages"][0]
        archive = self.root / "bubblewrap.conda"
        archive.write_bytes(b"reviewed bootstrap package fixture")
        record.update(sha256=producer.digest(archive), sizeBytes=archive.stat().st_size)
        metadata = {**record, "url": archive.as_uri()}
        path = self.prefix / "conda-meta/bubblewrap.json"
        path.write_text(json.dumps(metadata))
        self.build()
        self.assertEqual(json.loads(path.read_text())["url"], archive.as_uri())
        import shutil
        shutil.rmtree(self.root / "output")
        archive.write_bytes(b"corrupted")
        with self.assertRaisesRegex(producer.BootstrapError, "provenance"):
            self.build()

    def test_external_library_wrong_architecture_and_failed_probe_block_release(self):
        for case in ["external", "architecture", "probe"]:
            output = self.root / "output"
            if output.exists():
                import shutil
                shutil.rmtree(output)
            library = self.prefix / "lib/libcap.so.2"
            library.unlink()
            library.write_bytes(elf())
            options = {}
            if case == "external":
                library.unlink(); library.symlink_to(self.notices / "LICENSE")
            elif case == "architecture":
                library.write_bytes(elf(62))
            else:
                options["qualify"] = lambda _: {"available": False}
            with self.subTest(case=case), self.assertRaises(producer.BootstrapError):
                self.build(**options)

    def test_host_bound_elf_interpreter_is_rejected_before_output(self):
        with self.assertRaisesRegex(producer.BootstrapError, "ELF interpreter"):
            self.build(inspect=lambda _: "/build/machine/loader")
        self.assertFalse((self.root / "output").exists())

    def test_output_may_not_recurse_into_prefix_or_notice_tree(self):
        for output in [self.prefix / "output", self.notices / "output"]:
            with self.subTest(output=output), self.assertRaisesRegex(producer.BootstrapError, "outside the source prefix"):
                producer.assemble(self.prefix, output, "linux-arm64", self.lock, self.notices, inspect=self.inspect)
            self.assertFalse(output.exists())

    def test_prefix_preparation_verifies_all_downloads_then_links_offline_and_preserves_notices(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:bz2") as package:
            body = elf()
            member = tarfile.TarInfo("bin/micromamba")
            member.size, member.mode = len(body), 0o755
            package.addfile(member, io.BytesIO(body))
        tool, conda = archive.getvalue(), b"reviewed conda fixture"
        record = self.lock["packages"][0]
        record.update(sha256=hashlib.sha256(conda).hexdigest(), sizeBytes=len(conda), license="LGPL-2.0-or-later")
        self.lock["installer"] = {"url": "https://conda.anaconda.org/conda-forge/linux-aarch64/micromamba-2.3.3-0.tar.bz2", "sha256": hashlib.sha256(tool).hexdigest(), "sizeBytes": len(tool)}
        events = []
        def download(url):
            events.append("download")
            return io.BytesIO(tool if "micromamba-" in url else conda)
        def link(command, **options):
            events.append("link")
            for option in ["--offline", "--no-rc", "--no-env", "--no-deps", "--always-copy"]:
                self.assertIn(option, command)
            self.assertNotIn("https://", " ".join(command))
            explicit = Path(command[command.index("--file") + 1]).read_text()
            self.assertTrue(explicit.startswith("@EXPLICIT\nfile:///"))
            prefix = Path(command[command.index("--prefix") + 1])
            (prefix / "conda-meta").mkdir(parents=True)
            (prefix / "conda-meta/bubblewrap.json").write_text(json.dumps(record))
            cache = Path(command[command.index("--root-prefix") + 1]) / "pkgs/bubblewrap-fixture/info/licenses"
            cache.mkdir(parents=True)
            (cache / "LICENSE").write_text("upstream test fixture license")
            self.assertEqual(set(options["env"]), {"PATH", "HOME", "TMPDIR", "PYTHONNOUSERSITE"})
            return subprocess.CompletedProcess(command, 0)
        prepared, notices = producer.prepare_prefix(self.root / "new-prefix", "linux-arm64", self.lock, self.notices, downloader=download, runner=link)
        self.assertEqual(events, ["download", "download", "link"])
        self.assertTrue((prepared / "conda-meta/bubblewrap.json").is_file())
        self.assertTrue((notices / "reviewed/LICENSE").is_file())
        self.assertTrue((notices / "conda-packages/bubblewrap-fixture/licenses/LICENSE").is_file())
        self.assertEqual(json.loads((notices / "source-lock.json").read_text()), self.lock)
        with self.assertRaisesRegex(producer.BootstrapError, "existing files"):
            producer.prepare_prefix(prepared, "linux-arm64", self.lock, self.notices, downloader=download, runner=link)

    def test_corrupt_bootstrap_download_never_runs_installer(self):
        self.lock["installer"] = {"url": "https://conda.anaconda.org/conda-forge/linux-aarch64/micromamba-2.3.3-0.tar.bz2", "sha256": "a" * 64, "sizeBytes": 10}
        self.lock["packages"][0].update(sizeBytes=10, license="LGPL-2.0-or-later")
        runner = mock.Mock()
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            producer.prepare_prefix(self.root / "new-prefix", "linux-arm64", self.lock, self.notices, downloader=lambda _: io.BytesIO(b"truncated"), runner=runner)
        runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
