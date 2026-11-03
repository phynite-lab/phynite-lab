"""A scientific release gate must never turn absent/corrupt evidence into a pass."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.local_worker import recovery
from backend.local_api.qualification import (
    CHECKS as CORE_CHECKS, Qualification, lj_reference, main, md_input, numerical_measurement,
    sha256, source_snapshot, verify_result_artifacts, write_json,
)


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("scientific_release_harness", ROOT / "scripts/qualify-local-science.py")
HARNESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARNESS)


class ScientificReleaseQualificationTests(unittest.TestCase):
    def test_worker_provenance_resolves_extracted_module_directory_alias(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            backend = root / "extracted/backend"
            sources = {
                "local_worker/recovery.py": b"# immutable recovery source\n",
                "local_worker/worker.py": b"# immutable worker source\n",
                "compute/local_runner.py": b"# immutable scientific runner\n",
            }
            for name, content in sources.items():
                path = backend / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            alias = root / "extraction-alias"
            alias.symlink_to(backend.parent, target_is_directory=True)
            with patch.object(recovery, "__file__", str(alias / "backend/local_worker/recovery.py")), patch.dict(recovery.os.environ, {"PHYNITE_HPC_SCHEDULER": ""}):
                identity = recovery.runtime_identity("docker", None, "qe")
            self.assertEqual(identity["executionSources"], [
                {"path": name, "sha256": sha256(backend / name)} for name in sorted(sources)
            ])

    def test_application_executed_input_accepts_only_declared_io_formatting(self):
        submitted = "&control\n prefix='phynite',\n outdir='./tmp',\n pseudo_dir='./pseudo',\n/\n&system\n ecutwfc=12.0\n/\n"
        executed = submitted.replace("outdir='./tmp'", "outdir = './tmp'").replace("pseudo_dir='./pseudo'", "pseudo_dir = './pseudo'")
        self.assertEqual(HARNESS.qe_io_comparison(submitted), HARNESS.qe_io_comparison(executed))
        self.assertNotEqual(HARNESS.qe_io_comparison(submitted), HARNESS.qe_io_comparison(executed.replace("ecutwfc=12.0", "ecutwfc=13.0")))
        for changed in (executed.replace("./tmp", "/tmp/outside"), executed.replace("./pseudo", "another-model-path"), executed + "prefix='phynite'\n"):
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, "predeclared"):
                HARNESS.qe_io_comparison(changed)

    def test_application_transfers_require_actual_loopback_origin_and_reject_redirects(self):
        class Redirect(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", "https://example.invalid/never-receives-research-or-token")
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            for url in ("https://example.invalid/file", "http://127.0.0.1:1/file", origin + "#fragment", "http://user@" + origin[7:] + "/file"):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    HARNESS.local_url(origin, url)
            with self.assertRaisesRegex(ValueError, "must not redirect"):
                HARNESS.request_json(origin, "unit-test-local-session", "/redirect")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_application_artifact_download_rejects_corruption_and_unsafe_or_restricted_paths(self):
        class Artifact(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"corrupt unit-test artifact")

        server = ThreadingHTTPServer(("127.0.0.1", 0), Artifact)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                origin = f"http://127.0.0.1:{server.server_port}"
                app = HARNESS.ApplicationQualification(root, root, origin, "unit-session", 30)
                with self.assertRaisesRegex(ValueError, "checksum/size"):
                    app.download(origin + "/artifact", root / "download", {"sha256": "0" * 64, "sizeBytes": 26})
                for path in ("../outside", "/tmp/outside", "./result", "bad\\path", "nested//file", "Si.pz-vbc.UPF"):
                    with self.subTest(path=path), self.assertRaises(ValueError):
                        app.relative_artifact(path)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_application_restart_gate_refuses_replayed_cancelled_job(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = HARNESS.ApplicationQualification(root, root, "http://127.0.0.1:3000", "unit-session", 30)
            app.completed, app.cancelled = "completed", "cancelled"
            for state in ({"status": "RUNNING"}, {"status": "CANCELLED", "startedAt": "unexpected-worker-claim"}):
                with self.subTest(state=state), patch.object(app, "call", side_effect=[{"calculation": {"status": "COMPLETED"}}, {"calculation": state}]):
                    with self.assertRaisesRegex(ValueError, "lost or replayed"):
                        app.after_restart(app.origin, app.token)

    def test_lj_reference_is_analytical_and_fixed_before_candidate(self):
        reference = lj_reference()
        distance, sigma, epsilon = reference["separationAngstrom"], 3.4, 0.0103
        energy = 4 * epsilon * ((sigma / distance)**12 - (sigma / distance)**6)
        force = 24 * epsilon / distance * (2 * (sigma / distance)**12 - (sigma / distance)**6)
        self.assertAlmostEqual(energy, -epsilon, places=14)
        self.assertAlmostEqual(force, 0.0, places=14)
        self.assertEqual(reference["expectedPotentialEnergyEv"], -epsilon)
        frame = source_snapshot()["frame"]
        self.assertEqual(frame["properties"]["Mass"], [39.948, 39.948])
        self.assertEqual(frame["periodic"], [True, True, True])
        self.assertAlmostEqual(frame["positions"][3] - frame["positions"][0], distance)
        guided, manual = md_input("guided"), md_input("manual")
        self.assertEqual(guided["workflow"]["potential"], manual["workflow"]["potential"])
        self.assertEqual(guided["workflow"]["steps"][0]["params"]["totalSteps"], 5)
        self.assertIn("run 5", manual["workflow"]["manualBody"])

    def test_numerical_comparison_rejects_missing_nan_and_out_of_tolerance(self):
        for value in (None, True, float("nan"), float("inf"), 5.0):
            with self.subTest(value=value), self.assertRaises(ValueError):
                numerical_measurement("energy", "Ry", value, -15.79449593, 1e-5)
        for tolerance in (-1, float("inf"), float("nan")):
            with self.subTest(tolerance=tolerance), self.assertRaises(ValueError):
                numerical_measurement("energy", "Ry", -15.79449593, -15.79449593, tolerance)
        result = numerical_measurement("energy", "Ry", -15.79449592, -15.79449593, 1e-5)
        self.assertNotEqual(result["value"], result["expected"])

    def test_actual_artifact_bytes_and_path_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "output.dat"
            path.write_bytes(b"actual retained result\n")
            record = {"path": path.name, "sha256": sha256(path), "sizeBytes": path.stat().st_size}
            self.assertEqual(verify_result_artifacts(root, {"artifacts": [record]})[0]["sha256"], record["sha256"])
            path.write_bytes(b"corrupted result\n")
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_result_artifacts(root, {"artifacts": [record]})
            for name in ("../outside", "/tmp/outside", "bad\\path", "./output.dat"):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    verify_result_artifacts(root, {"artifacts": [{**record, "path": name}]})
            outside = root / "outside"
            outside.write_text("sentinel")
            (root / "linked").symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "unsafe"):
                verify_result_artifacts(root, {"artifacts": [{"path": "linked"}]})

    def test_upstream_qe_contract_is_pinned_and_not_candidate_observation(self):
        manifest = json.loads((ROOT / "distribution/qualification/qe/fixture.json").read_text())
        records = HARNESS.fixture_files(manifest)
        self.assertEqual(manifest["expectedEnergyRy"], -15.79449593)
        self.assertEqual(manifest["absoluteToleranceRy"], 1e-5)
        self.assertEqual({record["role"] for record in records}, {"input", "reference", "pseudopotential"})
        self.assertTrue(all(len(record["sha256"]) == 64 for record in records))
        self.assertTrue(all("770a0b2d12928a67048e2f3da8d10d057e52179e" in record["url"] for record in records if record["role"] != "pseudopotential"))
        self.assertEqual(list((ROOT / "distribution/qualification/qe").glob("*.UPF")), [])

    def test_fixture_download_requires_predeclared_checksums_and_safe_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "fixture"
            source.mkdir()
            records = []
            for name, role in (("input.in", "input"), ("golden.out", "reference"), ("model.UPF", "pseudopotential")):
                (source / name).write_bytes(role.encode())
                records.append({"name": name, "role": role, "sha256": sha256(source / name), "url": "https://provider.invalid/" + name})
            write_json(source / "fixture.json", {"schemaVersion": 1, "files": records})
            HARNESS.prepare_fixture(source, root / "verified")
            self.assertEqual((root / "verified/model.UPF").read_text(), "pseudopotential")
            (source / "model.UPF").write_text("incorrect downloaded model")
            with self.assertRaisesRegex(ValueError, "checksum"):
                HARNESS.prepare_fixture(source, root / "corrupt")
            for name in ("../outside", "/tmp/outside", "bad\\path"):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    HARNESS.fixture_files({"schemaVersion": 1, "files": [{**records[0], "name": name}, *records[1:]]})

    def test_setup_bundles_match_catalogue_and_preserve_real_analysis_gate(self):
        catalogue = json.loads((ROOT / "backend/local_api/runtime-manifest.json").read_text())["components"]
        self.assertEqual(set(HARNESS.INSTALL_COMPONENTS), set(catalogue))
        self.assertIn("analysis-reference", HARNESS.CHECKS)
        self.assertIn("analysis-reference", CORE_CHECKS)

    def test_analysis_uses_registered_md_interpreter_without_dft_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, job = root / "output", root / "job"
            output.mkdir()
            job.mkdir()
            qualification = Qualification(root / "data", output, root / "fixture", 30)
            python = qualification.manager.root / "md/env/bin/python"
            python.parent.mkdir(parents=True)
            python.write_text("Metadata selection fixture; never executed.")
            python.chmod(0o755)
            registered = {"PHYNITE_RUNTIME_PYTHON_MD": str(python)}
            with patch.object(qualification.manager, "environment", return_value=registered):
                selected, _ = qualification.environment("analysis", job)
                self.assertEqual(selected, str(python))
            with patch.object(qualification.manager, "environment", return_value={"PHYNITE_RUNTIME_PYTHON_DFT": str(python)}):
                with self.assertRaisesRegex(RuntimeError, "unavailable"):
                    qualification.environment("analysis", job)

    def test_no_global_python_fallback_for_missing_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, data, job = root / "output", root / "data", root / "job"
            output.mkdir()
            job.mkdir()
            qualification = Qualification(data, output, root / "fixture", 30)
            with patch.object(qualification.manager, "environment", return_value={"PATH": "/usr/bin", "PHYNITE_RUNTIME_PYTHON_MD": "/usr/bin/python3"}):
                with self.assertRaisesRegex(RuntimeError, "unavailable"):
                    qualification.environment("md", job)

    def test_unavailable_runtime_produces_failed_checks_with_hashed_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "output"
            output.mkdir()
            qualification = Qualification(root / "data", output, root / "no-fixture", 30)
            qualification.check("qe-reference", qualification.qe)
            qualification.check("md-guided-reference", lambda directory: qualification.md(directory, "guided"))
            qualification.check("analysis-reference", qualification.analysis)
            report = json.loads((output / "checks.json").read_text())
            self.assertFalse(report["passed"])
            self.assertEqual([check["status"] for check in report["checks"]], ["failed"] * 3)
            for check in report["checks"]:
                self.assertEqual(check["execution"]["returnCode"], 1)
                for attachment in check["attachments"]:
                    self.assertEqual(attachment["sha256"], sha256(output / attachment["path"]))

    def test_diagnostics_refuse_unmarked_user_workspace_and_existing_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "data"
            data.mkdir()
            output = root / "output"
            args = ["--data-dir", str(data), "--output", str(output), "--qe-fixture", str(root / "fixture"), "--timeout-seconds", "30"]
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                main(args)
            self.assertFalse(output.exists())
            (data / ".release-qualification").write_text("test workspace")
            output.mkdir()
            with self.assertRaises(FileExistsError):
                main(args)

    def test_reference_provenance_binds_actual_input_and_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            qualification = Qualification(root / "data", root, root / "fixture", 30)
            for name in ("input.json", "result.json", "execution.log", "reference.json"):
                (root / name).write_text("actual fixture " + name)
            record = qualification.reference_record(root, "explicit test fixture", root / "result.json", root / "input.json", root / "execution.log",
                                                    [numerical_measurement("known count", "atoms", 2, 2, 0)])
            attachments = {value["kind"]: value for value in record["attachments"]}
            provenance = json.loads((root / attachments["provenance"]["path"]).read_text())
            self.assertEqual(provenance["inputSha256"], attachments["input"]["sha256"])
            self.assertEqual(provenance["outputSha256"], attachments["output"]["sha256"])
            self.assertEqual(provenance["returnCode"], 0)

    def test_producer_emits_all_failed_gates_when_no_native_package_can_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "invalid-native.tgz"
            content = b'{"schemaVersion":2,"kind":"invalid"}'
            with tarfile.open(archive_path, "w:gz") as archive:
                item = tarfile.TarInfo("package/distribution.json")
                item.size = len(content)
                archive.addfile(item, io.BytesIO(content))
            # An absent fixture must also fail without downloading anything.
            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = HARNESS.qualify(SimpleNamespace(output=root / "new-evidence", launcher_tarball=archive_path,
                                                            runtime_tarball=archive_path, qe_fixture=root / "missing-fixture", timeout_seconds=30))
            report = json.loads((root / "new-evidence/report.json").read_text())
            self.assertEqual(exit_code, 1)
            self.assertFalse(report["passed"])
            self.assertEqual({value["id"] for value in report["checks"]}, set(HARNESS.CHECKS))
            self.assertTrue(all(value["status"] == "failed" for value in report["checks"]))
            for check in report["checks"]:
                for item in check["attachments"]:
                    self.assertEqual(item["sha256"], sha256(root / "new-evidence" / item["path"]))

    def test_metadata_extraction_executes_actual_schema2_native_package_verifier(self):
        node = shutil.which("node")
        distribution_source = ROOT / "packages/phynite-lab/lib/distribution.mjs"
        if not node or not distribution_source.is_file():
            self.skipTest("The public package source and Node.js are required for metadata integration.")
        environment = json.loads(subprocess.check_output([node, "-e", "console.log(JSON.stringify({platform:process.platform,arch:process.arch}))"], text=True))
        target = environment["platform"] + "-" + environment["arch"]
        # The public launcher ships only the targets listed here.  macOS Intel
        # remains supported by maintenance tooling, but is intentionally not
        # part of the npm distribution after release 0.1.8.
        targets = ("darwin-arm64", "linux-arm64", "linux-x64")
        if target not in targets:
            self.skipTest("Native distribution metadata is tested on macOS or Linux/WSL2.")
        with tempfile.TemporaryDirectory() as temporary:
            prefix = Path(temporary).resolve() / "node_modules"
            launcher = prefix / "phynite-lab"
            runtime = prefix / ("phynite-lab-runtime-" + target)
            (launcher / "lib").mkdir(parents=True)
            (runtime / "core" / target).mkdir(parents=True)
            (runtime / "app").mkdir()
            for module in sorted(distribution_source.parent.glob("*.mjs")):
                shutil.copyfile(module, launcher / "lib" / module.name)
            source = {"repository": "https://github.com/phynite-lab/phynite-lab", "commit": "a" * 40,
                      "url": "https://github.com/phynite-lab/phynite-lab/tree/" + "a" * 40,
                      "archiveUrl": "https://github.com/phynite-lab/phynite-lab/archive/" + "a" * 40 + ".tar.gz"}
            write_json(launcher / "package.json", {"name": "phynite-lab", "version": "0.1.0", "license": "AGPL-3.0-only",
                                                    "optionalDependencies": {"phynite-lab-runtime-" + value: "0.1.0" for value in targets}})
            write_json(launcher / "distribution.json", {"schemaVersion": 2, "kind": "launcher", "version": "0.1.0", "source": source,
                                                        "targets": {value: {"package": "phynite-lab-runtime-" + value, "version": "0.1.0"} for value in targets}})
            # Only metadata discovery is exercised here. These bytes are never
            # executed and cannot qualify as a real native core/scientific run.
            core = runtime / "core" / target / "phynite-core"
            core.write_bytes(b"Metadata integration fixture, never scientific execution.\n")
            core.chmod(0o755)
            (runtime / "app/server.js").write_text("// Metadata integration fixture only.\n")
            write_json(runtime / "package.json", {"name": "phynite-lab-runtime-" + target, "version": "0.1.0", "license": "AGPL-3.0-only",
                                                  "os": [environment["platform"]], "cpu": [environment["arch"]]})
            manifest = {"schemaVersion": 2, "kind": "runtime", "target": target, "version": "0.1.0", "source": source,
                        "targets": {target: {"executable": "core/" + target + "/phynite-core", "sha256": sha256(core)}}}
            if environment["platform"] == "linux":
                bootstrap = runtime / "bootstrap"
                bootstrap.mkdir()
                tool = bootstrap / "bwrap"
                tool.write_bytes(b"Metadata fixture only; never an isolation probe.\n")
                tool.chmod(0o755)
                write_json(bootstrap / "manifest.json", {"schemaVersion": 1, "target": target,
                                                         "tools": {"bwrap": {"executable": "bwrap", "sha256": sha256(tool), "libraries": []}}})
                manifest["bootstrap"] = {"directory": "bootstrap", "sha256": sha256(bootstrap / "manifest.json")}
            write_json(runtime / "distribution.json", manifest)
            result = subprocess.run([node, "--input-type=module", "-e", HARNESS.distribution_metadata_script(), str(launcher)],
                                    capture_output=True, text=True, check=True, timeout=30)
            metadata = json.loads(result.stdout)
            self.assertEqual(Path(metadata["executable"]).resolve(), core)
            self.assertEqual(Path(metadata["packageRoot"]).resolve(), runtime)
            # Calling with an omitted/incorrect target must really fail in the
            # distribution verifier; a stub would miss the original regression.
            missing_target = HARNESS.distribution_metadata_script().replace("root, process.platform+'-'+process.arch", "root")
            failed = subprocess.run([node, "--input-type=module", "-e", missing_target, str(launcher)], capture_output=True, text=True, timeout=30)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("Unsupported native runtime platform", failed.stderr)


if __name__ == "__main__":
    unittest.main()
