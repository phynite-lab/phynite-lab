from __future__ import annotations

import hashlib
import io
import itertools
import json
import subprocess
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from backend.local_api.conda_runtime import _check_host, _repair_linux_wheel_libraries, _wheel_record
from backend.local_api.runtime import RuntimeInstallError, RuntimeManager


def wheel_bytes(name="reviewed_fixture", version="1.0", *, unsafe=False):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as package:
        root = f"{name}-{version}.dist-info"
        package.writestr(f"{root}/METADATA", f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n")
        package.writestr(f"{root}/WHEEL", "Wheel-Version: 1.0\nRoot-Is-Purelib: false\nTag: cp312-cp312-manylinux_2_39_aarch64\n")
        package.writestr("../outside.py" if unsafe else f"{name}/__init__.py", "# unit-test fixture, never scientific output\n")
    return payload.getvalue()


class WheelRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:bz2") as package:
            body = b"#!/bin/sh\nexit 0\n"
            item = tarfile.TarInfo("bin/micromamba")
            item.size, item.mode = len(body), 0o755
            package.addfile(item, io.BytesIO(body))
        self.tool = output.getvalue()
        self.conda = b"explicit conda fixture, not a scientific package"
        self.wheel = wheel_bytes()
        filename = "reviewed_fixture-1.0-cp312-cp312-manylinux_2_39_aarch64.whl"
        self.wheel_record = {"name": "reviewed_fixture", "version": "1.0", "filename": filename, "tags": ["cp312", "cp312", "manylinux_2_39_aarch64"], "url": f"https://files.pythonhosted.org/packages/ab/cd/reviewed/{filename}", "sha256": hashlib.sha256(self.wheel).hexdigest(), "sizeBytes": len(self.wheel), "license": "BSD-3-Clause"}
        package = {"url": "https://conda.anaconda.org/conda-forge/linux-aarch64/fixture-1-test_0.conda", "sha256": hashlib.sha256(self.conda).hexdigest(), "sizeBytes": len(self.conda), "build": "test_0", "license": "BSD-3-Clause"}
        self.entry = {"format": "conda-lock", "version": "wheel-test-1", "minimumGlibc": "2.39", "maxInstalledBytes": 1024 * 1024,
            "installer": {"url": "https://conda.anaconda.org/conda-forge/linux-aarch64/micromamba-2.3.3-0.tar.bz2", "sha256": hashlib.sha256(self.tool).hexdigest(), "sizeBytes": len(self.tool)},
            "packages": [{**package, "name": name, "version": version, "url": package["url"].replace("fixture-", name + "-")} for name, version in [("python", "3.12.1"), ("pip", "26.2"), ("patchelf", "0.19.2")]],
            "wheels": [self.wheel_record], "executables": {name: f"env/bin/{name}" for name in ["python", "lmp", "mpirun"]}}
        self.phases = []

    def tearDown(self):
        self.temporary.cleanup()

    def manager(self, downloader=None):
        path = self.root / "manifest.json"
        path.write_text(json.dumps({"schemaVersion": 1, "components": {"md": {"linux-arm64": self.entry}}}))
        def download(url):
            self.phases.append("download")
            return io.BytesIO(self.tool if "micromamba-" in url else self.wheel if url.endswith(".whl") else self.conda)
        manager = RuntimeManager(self.root / "data", path, downloader=downloader or download)
        manager.sandbox = mock.Mock()
        manager.sandbox.probe.return_value = {"available": True}
        manager.sandbox.command.side_effect = lambda _, command: command
        return manager

    def installer(self, argv, **options):
        if "--file" in argv:
            self.phases.append("conda")
            explicit = Path(argv[argv.index("--file") + 1]).read_text()
            self.assertNotIn(".whl", explicit)
            self.prefix = Path(argv[argv.index("--prefix") + 1])
            (self.prefix / "bin").mkdir(parents=True)
            for name in [*self.entry["executables"], "patchelf"]:
                binary = self.prefix / "bin" / name
                binary.write_text("#!/bin/sh\nexit 0\n")
                binary.chmod(0o755)
            (self.prefix / "conda-meta").mkdir()
            for record in self.entry["packages"]:
                (self.prefix / "conda-meta" / f"{record['name']}.json").write_text(json.dumps(record))
            (self.prefix.parent / ".mamba/pkgs").mkdir(parents=True)
        else:
            self.phases.append("wheel")
            for option in ["--isolated", "--no-index", "--no-deps", "--no-cache-dir", "--require-hashes", "--only-binary=:all:"]:
                self.assertIn(option, argv)
            self.assertEqual(argv[:5], [str(self.prefix / "bin/python"), "-I", "-m", "pip", "--isolated"])
            self.assertFalse(any(value.startswith("https://") for value in argv))
            requirements = Path(argv[argv.index("--requirement") + 1]).read_text()
            self.assertIn(f"--hash=sha256:{self.wheel_record['sha256']}", requirements)
            metadata = self.prefix / "lib/python3.12/site-packages/reviewed_fixture-1.0.dist-info"
            metadata.mkdir(parents=True)
            (metadata / "METADATA").write_text("Name: reviewed-fixture\nVersion: 1.0\n")
            (metadata / "LICENSE").write_text("unit-test fixture license")
            (metadata / "RECORD").write_text("reviewed_fixture-1.0.dist-info/METADATA,,\n")
        return subprocess.CompletedProcess(argv, 0)

    def install(self, manager, side_effect=None):
        with mock.patch("backend.local_api.runtime.runtime_platform", return_value="linux-arm64"), mock.patch("backend.local_api.conda_runtime.platform.libc_ver", return_value=("glibc", "2.39")), mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=side_effect or self.installer), mock.patch("backend.local_api.conda_runtime._qualify", return_value={"passed": True}):
            return manager.install("md")

    def test_verified_overlay_installs_offline_after_all_downloads_and_retains_inventory_notices(self):
        manager = self.manager()
        result = self.install(manager)
        self.assertEqual(self.phases, ["download"] * 5 + ["conda", "wheel"])
        record = result["installed"]
        self.assertEqual(record["wheels"][0]["sha256"], self.wheel_record["sha256"])
        release = manager.root / record["directory"]
        self.assertTrue((release / "notices/wheels/reviewed_fixture-1.0.dist-info/LICENSE").is_file())
        self.assertEqual(json.loads((release / "THIRD_PARTY_NOTICES.json").read_text())["wheels"], self.entry["wheels"])
        self.assertFalse((release / ".downloads").exists())
        self.assertEqual(record["wheelLibraryRelocation"], {"path": "wheel-library-relocation.json", "files": 0})

    def test_native_wheel_relocation_keeps_prefix_paths_and_records_actual_installed_hash(self):
        manager = self.manager()
        release = self.root / "relocation"
        prefix = release / "env"
        metadata = prefix / "lib/python3.12/site-packages/reviewed_fixture-1.0.dist-info"
        metadata.mkdir(parents=True)
        binary = metadata.parent / "reviewed_fixture/native.so"
        binary.parent.mkdir()
        binary.write_bytes(b"\x7fELFfixture before relocation")
        (metadata / "RECORD").write_text("reviewed_fixture/native.so,,\n")
        (prefix / "bin").mkdir()
        (prefix / "bin/patchelf").write_text("unit-test fixture")
        commands = []
        def patch(argv, **options):
            commands.append(argv)
            if "--print-rpath" in argv:
                return subprocess.CompletedProcess(argv, 0, "$ORIGIN/../:$ORIGIN/qt:/build/upstream-qt/lib\n")
            binary.write_bytes(b"\x7fELFfixture after relocation")
            return subprocess.CompletedProcess(argv, 0)
        with mock.patch("backend.local_api.conda_runtime.subprocess.run", side_effect=patch):
            count = _repair_linux_wheel_libraries(manager, release, [{"distInfo": metadata.relative_to(prefix).as_posix()}], {})
        self.assertEqual(count, 1)
        setting = commands[1][commands[1].index("--set-rpath") + 1]
        self.assertEqual(setting, "$ORIGIN/../:$ORIGIN/qt:$ORIGIN/../../..")
        audit = json.loads((release / "wheel-library-relocation.json").read_text())
        self.assertEqual(audit["files"][0]["sha256"], hashlib.sha256(binary.read_bytes()).hexdigest())
        self.assertNotIn("LD_LIBRARY_PATH", setting)
        for bad in ["$ORIGIN/../../../../../../outside", "$ORIGINevil", "relative/host-library"]:
            with self.subTest(rpath=bad), mock.patch("backend.local_api.conda_runtime.subprocess.run", return_value=subprocess.CompletedProcess([], 0, bad)), self.assertRaises(RuntimeInstallError):
                _repair_linux_wheel_libraries(manager, release, [{"distInfo": metadata.relative_to(prefix).as_posix()}], {})

    def test_wrong_origin_platform_or_identity_never_downloads(self):
        original = json.loads(json.dumps(self.wheel_record))
        for change in [{"url": self.wheel_record["url"].replace("files.pythonhosted.org", "evil.test")}, {"tags": ["cp313", "cp313", "manylinux_2_39_aarch64"]}, {"name": "unreviewed"}, {"sha256": "invalid"}]:
            self.entry["wheels"] = [{**original, **change}]
            download = mock.Mock()
            with self.subTest(change=change), self.assertRaises(RuntimeInstallError):
                self.install(self.manager(download))
            download.assert_not_called()

    def test_corruption_and_unsafe_wheel_paths_never_start_installer(self):
        for content in [b"corrupt", wheel_bytes(unsafe=True)]:
            self.wheel = content
            if content != b"corrupt":
                self.wheel_record.update(sizeBytes=len(content), sha256=hashlib.sha256(content).hexdigest())
            manager = self.manager()
            with mock.patch("backend.local_api.conda_runtime.subprocess.run") as run:
                with self.assertRaises(RuntimeInstallError):
                    self.install(manager, run)
                run.assert_not_called()
            self.assertFalse((manager.root / "active.json").exists())

    def test_wheel_failure_and_unexpected_inventory_never_replace_active_runtime(self):
        for broken_inventory in [False, True]:
            manager = self.manager()
            active = manager.root / "active.json"
            active.write_text("{}")
            def failing(argv, **options):
                result = self.installer(argv, **options)
                if "--file" not in argv:
                    if broken_inventory:
                        metadata = self.prefix / "lib/python3.12/site-packages/reviewed_fixture-1.0.dist-info/METADATA"
                        metadata.write_text("Name: reviewed-fixture\nVersion: unexpected\n")
                    else:
                        return subprocess.CompletedProcess(argv, 1)
                return result
            with self.subTest(broken_inventory=broken_inventory), self.assertRaises(RuntimeInstallError):
                self.install(manager, failing)
            self.assertEqual(active.read_text(), "{}")

    def test_incompatible_glibc_fails_before_download(self):
        for value in [("glibc", "2.28"), ("musl", "1.2.5"), ("", "")]:
            with self.subTest(value=value), mock.patch("backend.local_api.conda_runtime.platform.libc_ver", return_value=value), self.assertRaisesRegex(RuntimeInstallError, "Ubuntu 24.04"):
                _check_host(self.entry, "linux-arm64")
        with mock.patch("backend.local_api.conda_runtime.platform.libc_ver", return_value=("glibc", "2.40")):
            _check_host(self.entry, "linux-arm64")

    def test_duplicate_wheels_and_conda_identity_shadowing_are_rejected(self):
        self.entry["wheels"].append(dict(self.wheel_record))
        with self.assertRaisesRegex(RuntimeInstallError, "duplicate"):
            self.install(self.manager())
        self.entry["wheels"] = [self.wheel_record]
        self.entry["packages"].append({**self.entry["packages"][0], "name": "reviewed-fixture", "url": "https://conda.anaconda.org/conda-forge/linux-aarch64/reviewed-fixture-1-test_0.conda"})
        with self.assertRaisesRegex(RuntimeInstallError, "replace a conda"):
            self.install(self.manager())


if __name__ == "__main__":
    unittest.main()
