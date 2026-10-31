from __future__ import annotations

import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path

from backend.local_api.runtime import RuntimeManager

PATH = Path(__file__).resolve().parents[2] / "scripts/build-native-runtime.py"
SPEC = importlib.util.spec_from_file_location("native_release", PATH)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class RuntimeReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "curated"
        (self.source / "bin").mkdir(parents=True)
        (self.source / "bin/python").write_text("#!/bin/sh\nprintf 'unit-test fixture; not scientific runtime'\n")
        (self.source / "bin/python").chmod(0o755)
        (self.source / "NOTICE").write_text("Unit test fixture, not a published runtime.")

    def tearDown(self):
        self.temporary.cleanup()

    def build(self, output="release", **overrides):
        # Unit fixtures explicitly substitute qualification; production CLI has
        # no bypass flag and always runs relocated real science imports.
        kwargs = {"source": self.source, "output": self.root / output, "component": "analysis", "version": "0.1-test", "target": "darwin-arm64", "release_base_url": "https://releases.example.test/runtimes", "executables": {"python": "bin/python"}, "notices": ["NOTICE"], "check": lambda *_: {"passed": True, "fixture": True}}
        kwargs.update(overrides)
        return release.assemble(**kwargs)

    def test_prepared_manifest_and_archive_match_installer_contract(self):
        built = self.build()
        self.assertFalse(built["published"])
        archive = Path(built["archive"])
        manifest = json.loads(Path(built["preparedManifest"]).read_text())
        entry = manifest["components"]["analysis"]["darwin-arm64"]
        self.assertEqual(entry["sizeBytes"], archive.stat().st_size)
        self.assertEqual(entry["sha256"], release.sha256(archive))
        with tarfile.open(archive) as package:
            self.assertTrue(all(member.isfile() and not member.issym() for member in package.getmembers()))
        from unittest import mock
        with mock.patch("backend.local_api.runtime.runtime_platform", return_value="darwin-arm64"):
            manager = RuntimeManager(self.root / "workspace", Path(built["preparedManifest"]), downloader=lambda _: io.BytesIO(archive.read_bytes()))
            installed = manager.install("analysis")
        self.assertEqual(installed["installed"]["sha256"], built["sha256"])

    def test_output_is_reproducible_and_never_overwritten(self):
        first, second = self.build("first"), self.build("second")
        self.assertEqual(first["sha256"], second["sha256"])
        with self.assertRaisesRegex(release.ReleaseError, "never overwrite"):
            self.build("first")

    def test_internal_symlink_is_flattened_and_external_symlink_rejected(self):
        (self.source / "bin/python3").symlink_to("python")
        built = self.build()
        with tarfile.open(built["archive"]) as package:
            member = package.getmember("bin/python3")
            self.assertTrue(member.isfile())
            self.assertEqual(package.extractfile(member).read(), (self.source / "bin/python").read_bytes())
        (self.source / "outside").symlink_to(self.root)
        with self.assertRaisesRegex(release.ReleaseError, "host-bound symlink"):
            self.build("external")

    def test_credentials_and_upf_are_rejected_without_creating_release(self):
        for filename, body in [(".env", "SECRET=do-not-distribute"), ("model.UPF", "private model fixture"), ("certificate.txt", "-----BEGIN PRIVATE KEY-----\nfixture")]:
            candidate = self.source / filename
            candidate.write_text(body)
            with self.subTest(filename=filename), self.assertRaises(release.ReleaseError):
                self.build(filename.replace(".", "-"))
            candidate.unlink()

    def test_runtime_link_cycles_and_host_bound_script_interpreters_fail(self):
        (self.source / "cycle").symlink_to(self.source)
        with self.assertRaisesRegex(release.ReleaseError, "cycle"):
            self.build()
        (self.source / "cycle").unlink()
        (self.source / "bin/host-script").write_text("#!/unavailable/build-host/bin/python\nprint('invalid')\n")
        (self.source / "bin/host-script").chmod(0o755)
        with self.assertRaisesRegex(release.ReleaseError, "host-bound interpreter"):
            self.build()

    def test_qualification_and_missing_notices_or_executables_fail(self):
        for options in ({"check": lambda *_: {"passed": False}}, {"notices": []}, {"executables": {"python": "bin/missing"}}, {"notices": ["missing"]}):
            with self.subTest(options=options), self.assertRaises(release.ReleaseError):
                self.build(**options)

    def test_no_implicit_release_destination_or_component_downgrade(self):
        for options in ({"release_base_url": "http://unapproved.test"}, {"release_base_url": "https://user:secret@releases.test"}, {"component": "dft"}, {"output": self.source / "output"}):
            with self.subTest(options=options), self.assertRaises(release.ReleaseError):
                self.build(**options)

    def test_qualification_cannot_mutate_reviewed_bytes(self):
        def changing(root, *_):
            (root / "NOTICE").write_text("mutated during check")
            return {"passed": True}
        with self.assertRaisesRegex(release.ReleaseError, "modified a release file"):
            self.build(check=changing)


if __name__ == "__main__":
    unittest.main()
