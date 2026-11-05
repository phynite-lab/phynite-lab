"""Cell conversion boundaries; real spglib references are checked in the managed runtime."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from backend.local_api.crystal_cells import standardize_crystal, validate_cell_request
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.sandbox import SandboxError

SOURCE = {"atoms": [{"species": "Fe", "x": 0, "y": 0, "z": 0}, {"species": "Fe", "x": .5, "y": .5, "z": .5}], "vectors": [[2.86, 0, 0], [0, 2.86, 0], [0, 0, 2.86]], "periodic": [True, True, True], "cell": "primitive", "symprec": .01}
RESULT = {"vectors": [[-1.43, 1.43, 1.43], [1.43, -1.43, 1.43], [1.43, 1.43, -1.43]], "sites": [{"species": "Fe", "x": 0, "y": 0, "z": 0}], "version": "synthetic-runtime-fixture"}


class CrystalCellTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.runtime = SimpleNamespace(data_dir=Path(self.directory.name), environment=Mock(return_value={"PHYNITE_RUNTIME_PYTHON_DFT": "/managed/python", "PATH": "/managed/bin"}), sandbox=SimpleNamespace(command=Mock(side_effect=lambda directory, command: ["isolated", *command])))

    def test_valid_geometry_is_sent_to_the_managed_sandbox_without_native_core_dependencies(self):
        original = copy.deepcopy(SOURCE)
        with patch("backend.local_api.crystal_cells.subprocess.run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(RESULT))) as run:
            result = standardize_crystal(SOURCE, self.runtime)
        call = run.call_args
        self.assertEqual(call.args[0][:3], ["isolated", "/managed/python", "-I"])
        self.assertEqual(json.loads(call.kwargs["input"]), SOURCE)
        self.assertEqual(call.kwargs["timeout"], 30)
        self.assertNotIn("HOME", call.kwargs["env"])
        self.assertEqual(result["provenance"]["symprecAngstrom"], .01)
        self.assertTrue(result["provenance"]["noIdealize"])
        self.assertEqual(result["provenance"]["method"], "spglib.standardize_cell")
        self.assertEqual(SOURCE, original)
        self.assertEqual(list((self.runtime.data_dir / "work").iterdir()), [])

    def test_invalid_geometry_never_starts_a_runtime(self):
        for changed in [{"cell": []}, {"cell": "approximate"}, {"periodic": [True, True, False]}, {"periodic": [1, 1, 1]}, {"symprec": float("nan")}, {"symprec": 2}, {"vectors": [[0, 0, 0]] * 3}, {"atoms": []}, {"command": "injected"}, {"atoms": [{"species": "Fe", "x": 0, "y": 0, "z": 0, "occupancy": .5}]}]:
            with self.subTest(changed=changed), self.assertRaises(ApiError):
                standardize_crystal({**SOURCE, **changed}, self.runtime)
        self.runtime.environment.assert_not_called()

    def test_missing_runtime_and_failed_isolation_are_actionable_and_not_bypassed(self):
        with self.assertRaises(ApiError) as missing:
            standardize_crystal(SOURCE, None)
        self.assertEqual(missing.exception.code, "CRYSTAL_CELL_RUNTIME_REQUIRED")
        self.runtime.sandbox.command.side_effect = SandboxError("private diagnostic")
        with patch("backend.local_api.crystal_cells.subprocess.run") as run, self.assertRaises(ApiError) as failed:
            standardize_crystal(SOURCE, self.runtime)
        self.assertEqual(failed.exception.code, "CRYSTAL_CELL_ISOLATION")
        self.assertNotIn("private diagnostic", str(failed.exception))
        run.assert_not_called()

    def test_failed_or_invalid_runtime_output_preserves_the_source_and_hides_diagnostics(self):
        for output in [SimpleNamespace(returncode=1, stdout="private diagnostic"), SimpleNamespace(returncode=0, stdout="not json"), SimpleNamespace(returncode=0, stdout=json.dumps({**RESULT, "vectors": [[0, 0, 0]] * 3}))]:
            with patch("backend.local_api.crystal_cells.subprocess.run", return_value=output), self.assertRaises(ApiError) as failed:
                standardize_crystal(SOURCE, self.runtime)
            self.assertIn(failed.exception.code, {"CRYSTAL_CELL_INVALID", "CRYSTAL_CELL_FAILED"})
            self.assertNotIn("private diagnostic", str(failed.exception))
        with patch("backend.local_api.crystal_cells.subprocess.run", side_effect=subprocess.TimeoutExpired("private command", 30)), self.assertRaises(ApiError) as timeout:
            standardize_crystal(SOURCE, self.runtime)
        self.assertEqual(timeout.exception.code, "CRYSTAL_CELL_TIMEOUT")

    def test_request_validation_retains_unrounded_vectors_and_coordinates(self):
        self.assertIs(validate_cell_request(SOURCE), SOURCE)

    def test_native_endpoint_requires_the_local_service_session(self):
        from backend.local_api.desktop_server import DesktopApplication

        application = DesktopApplication(Path(self.directory.name), 49123, "http://127.0.0.1:3000")
        self.addCleanup(application.close)
        raw = json.dumps(SOURCE).encode()
        with patch("backend.local_api.crystal_cells.standardize_crystal", return_value=RESULT) as convert:
            with self.assertRaises(ApiError) as rejected:
                application.dispatch("POST", "/__local/crystals/standardize", raw, {}, {})
            self.assertEqual(rejected.exception.code, "LOCAL_SESSION_REQUIRED")
            convert.assert_not_called()
            response = application.dispatch("POST", "/__local/crystals/standardize", raw, {"Authorization": "Bearer " + application.token}, {})
            self.assertEqual(response["statusCode"], 200)
            self.assertEqual(json.loads(response["body"]), RESULT)
            convert.assert_called_once_with(SOURCE, application.runtime)


if __name__ == "__main__":
    unittest.main()
