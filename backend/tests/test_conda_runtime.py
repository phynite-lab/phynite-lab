from __future__ import annotations

import hashlib
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.local_api.runtime import RuntimeInstallError, RuntimeManager, runtime_platform
from backend.local_api.conda_runtime import _download_record, _wheel_record


class LockedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.target = runtime_platform()
        self.subdir = {"darwin-arm64": "osx-arm64", "darwin-x64": "osx-64", "linux-arm64": "linux-aarch64", "linux-x64": "linux-64"}[self.target]
        tool = io.BytesIO()
        with tarfile.open(fileobj=tool, mode="w:bz2") as archive:
            body = b"#!/bin/sh\nexit 0\n"
            member = tarfile.TarInfo("bin/micromamba")
            member.size, member.mode = len(body), 0o755
            archive.addfile(member, io.BytesIO(body))
        self.tool = tool.getvalue()
        self.package = b"Explicitly mocked conda package fixture, never scientific output."
        self.entry = {"format": "conda-lock", "version": "test-1", "maxInstalledBytes": 1024 * 1024,
            "installer": self.download("micromamba-2.3.3-0.tar.bz2", self.tool),
            "packages": [{**self.download("fixture-1-test_0.conda", self.package), "name": "fixture", "version": "1", "build": "test_0", "license": "BSD-3-Clause"}],
            "executables": {name: f"env/bin/{name}" for name in ("python", "lmp", "mpirun")}}

    def tearDown(self):
        self.temporary.cleanup()

    def download(self, filename, body):
        return {"url": f"https://conda.anaconda.org/conda-forge/{self.subdir}/{filename}", "sizeBytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}

    def manager(self, *, download=None):
        manifest = self.root / "manifest.json"
        manifest.write_text(json.dumps({"schemaVersion": 1, "components": {"md": {self.target: self.entry}}}))
        def fetch(url):
            return io.BytesIO(self.tool if "micromamba-" in url else self.package)
        manager = RuntimeManager(self.root / "data", manifest, downloader=download or fetch)
        manager.sandbox = mock.Mock()
        manager.sandbox.probe.return_value = {"available": True}
        manager.sandbox.command.side_effect = lambda _, command: command
        return manager

    def installer(self, command, **options):
        self.assertIn("--offline", command)
        self.assertIn("--no-deps", command)
        self.assertIn("--no-rc", command)
        self.assertIn("--no-env", command)
        explicit = Path(command[command.index("--file") + 1]).read_text().splitlines()
        self.assertEqual(explicit[0], "@EXPLICIT")
        self.assertTrue(all(value.startswith("file:///") for value in explicit[1:]))
        self.assertNotIn("https://", " ".join(command))
        prefix = Path(command[command.index("--prefix") + 1])
        self.prefix = prefix
        (prefix / "bin").mkdir(parents=True)
        for name in self.entry["executables"]:
            binary = prefix / "bin" / name
            binary.write_text("#!/bin/sh\nexit 0\n")
            binary.chmod(0o755)
        (prefix / "conda-meta").mkdir()
        (prefix / "conda-meta/fixture.json").write_text(json.dumps({"name": "fixture", "version": "1", "build": "test_0"}))
        metadata = prefix.parent / ".mamba/pkgs/fixture/info"
        (metadata / "licenses").mkdir(parents=True)
        (metadata / "licenses/LICENSE").write_text("fixture license")
        return subprocess.CompletedProcess(command, 0)

    def test_verified_lock_installs_offline_at_final_prefix_and_activates_after_qualification(self):
        manager = self.manager()
        with mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=self.installer), mock.patch("backend.local_api.conda_runtime._qualify", return_value={"passed": True}) as qualify:
            result = manager.install("md")
        release = manager.root / result["installed"]["directory"]
        self.assertEqual(self.prefix, release / "env")
        self.assertEqual(qualify.call_count, 1)
        self.assertEqual(json.loads((manager.root / "active.json").read_text())["md"], result["installed"])
        self.assertTrue((release / "notices/conda-packages/fixture/licenses/LICENSE").is_file())
        self.assertFalse((release / ".downloads").exists())
        self.assertFalse((release / ".mamba").exists())
        self.assertTrue(Path(manager.environment()["PHYNITE_RUNTIME_PYTHON_MD"]).is_file())

    def test_corrupt_package_never_executes_installer_or_replaces_active_runtime(self):
        manager = self.manager(download=lambda url: io.BytesIO(self.tool if "micromamba-" in url else b"corrupt"))
        active = manager.root / "active.json"
        active.write_text("{}")
        with mock.patch("backend.local_api.conda_runtime.subprocess.run") as run, self.assertRaisesRegex(RuntimeInstallError, "SHA-256"):
            manager.install("md")
        run.assert_not_called()
        self.assertEqual(active.read_text(), "{}")

    def test_unknown_origin_missing_hash_wrong_platform_and_duplicate_packages_fail_before_download(self):
        mutations = [
            lambda: self.entry["packages"][0].update(url="https://evil.test/fixture.conda"),
            lambda: self.entry["packages"][0].update(sha256=""),
            lambda: self.entry["packages"][0].update(url="https://conda.anaconda.org/conda-forge/win-64/fixture.conda"),
            lambda: self.entry["packages"].append(dict(self.entry["packages"][0])),
        ]
        original = json.loads(json.dumps(self.entry))
        for mutate in mutations:
            self.entry = json.loads(json.dumps(original))
            mutate()
            fetch = mock.Mock()
            with self.subTest(entry=self.entry), self.assertRaises(RuntimeInstallError):
                self.manager(download=fetch).install("md")
            fetch.assert_not_called()

    def test_sandbox_missing_or_failed_qualification_preserves_old_inventory(self):
        manager = self.manager()
        manager.sandbox.probe.return_value = {"available": False}
        with mock.patch.object(manager, "downloader") as fetch, self.assertRaisesRegex(RuntimeInstallError, "sandbox"):
            manager.install("md")
        fetch.assert_not_called()
        manager.sandbox.probe.return_value = {"available": True}
        active = manager.root / "active.json"
        active.write_text("{}")
        with mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=self.installer), mock.patch("backend.local_api.conda_runtime._qualify", side_effect=RuntimeInstallError("real qualification failed")), self.assertRaisesRegex(RuntimeInstallError, "qualification failed"):
            manager.install("md")
        self.assertEqual(active.read_text(), "{}")
        self.assertEqual(manager._progress["state"], "failed")
        with mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=self.installer), mock.patch("backend.local_api.conda_runtime._qualify", return_value={"passed": True}):
            manager.install("md")
        self.assertEqual(json.loads(active.read_text())["md"]["format"], "conda-lock")

    def test_installer_cannot_add_unlocked_dependencies(self):
        manager = self.manager()
        def extra(command, **options):
            result = self.installer(command, **options)
            (self.prefix / "conda-meta/extra.json").write_text(json.dumps({"name": "extra", "version": "1", "build": "test_0"}))
            return result
        with mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=extra), self.assertRaisesRegex(RuntimeInstallError, "inventory"):
            manager.install("md")
        self.assertFalse((manager.root / "active.json").exists())

    def test_encoded_epoch_is_decoded_for_explicit_local_package_name(self):
        record = self.entry["packages"][0]
        record["url"] = record["url"].replace("fixture-1-", "fixture-1%211-")
        manager = self.manager()
        def epoch(command, **options):
            explicit = Path(command[command.index("--file") + 1]).read_text()
            self.assertIn("fixture-1!1-", explicit)
            self.assertNotIn("%21", explicit)
            return self.installer(command, **options)
        with mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=epoch), mock.patch("backend.local_api.conda_runtime._qualify", return_value={"passed": True}):
            manager.install("md")

    def test_interrupted_download_retries_then_reuses_verified_cache_on_explicit_retry(self):
        attempts = []
        corrupt = True
        def fetch(url):
            attempts.append(url)
            return io.BytesIO(self.tool if "micromamba-" in url else b"truncated" if corrupt else self.package)
        manager = self.manager(download=fetch)
        with self.assertRaisesRegex(RuntimeInstallError, "SHA-256"):
            manager.install("md")
        self.assertEqual(sum("fixture-" in url for url in attempts), 3)
        self.assertFalse((manager.root / "active.json").exists())
        corrupt = False
        with mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=self.installer), mock.patch("backend.local_api.conda_runtime._qualify", return_value={"passed": True}):
            manager.install("md")
        self.assertEqual(sum("micromamba-" in url for url in attempts), 1)
        self.assertTrue((manager.root / "active.json").is_file())

    def test_shipped_catalogue_contains_complete_exact_locks_and_python_ovito(self):
        catalogue = json.loads((Path(__file__).resolve().parents[1] / "local_api/runtime-manifest.json").read_text())
        self.assertEqual(catalogue["schemaVersion"], 1)
        for component, builds in catalogue["components"].items():
            for target, entry in builds.items():
                with self.subTest(component=component, target=target):
                    self.assertEqual(entry["format"], "conda-lock")
                    _download_record(entry["installer"], target, tool=True)
                    self.assertGreater(len(entry["packages"]), 10)
                    for record in entry["packages"]:
                        _download_record(record, target)
                        self.assertTrue(record["license"])
                    self.assertEqual(len({record["name"] for record in entry["packages"]}), len(entry["packages"]))
                    self.assertIn("python", {record["name"] for record in entry["packages"]})
                    if component in {"md", "analysis"}:
                        if target == "linux-arm64":
                            self.assertEqual(entry["minimumGlibc"], "2.39")
                            self.assertEqual(entry["qualificationStatus"], "not-tested-on-target")
                            self.assertEqual({record["name"] for record in entry["wheels"]}, {"ovito", "traits", "pyside6_essentials", "shiboken6"})
                            for record in entry["wheels"]:
                                _wheel_record(record, target)
                        else:
                            ovito = next(record for record in entry["packages"] if record["name"] == "ovito")
                            self.assertTrue(ovito["url"].startswith("https://conda.ovito.org/"))
                            self.assertIn("py312", ovito["build"])


if __name__ == "__main__":
    unittest.main()
