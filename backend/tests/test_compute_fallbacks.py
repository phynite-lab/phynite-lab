"""Regression tests for headless compute fallbacks (precompiled crystal_b k-paths and MPI version probes)."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

COMPUTE_DIR = Path(__file__).resolve().parents[1] / "compute"


def _load_compute_modules():
    """Import sibling compute modules cleanly regardless of active venv packages."""
    inserted_path = False
    if str(COMPUTE_DIR) not in sys.path:
        sys.path.insert(0, str(COMPUTE_DIR))
        inserted_path = True

    injected_stubs: list[str] = []
    previous_entries: dict[str, object] = {}

    def ensure_stub(name: str, attrs: dict[str, object]) -> None:
        if importlib.util.find_spec(name) is None and name not in sys.modules:
            mod = types.ModuleType(name)
            for key, value in attrs.items():
                setattr(mod, key, value)
            sys.modules[name] = mod
            injected_stubs.append(name)

    try:
        ensure_stub("numpy", {"ndarray": object, "array": lambda x, **kw: x})
        if importlib.util.find_spec("matplotlib") is None and "results" not in sys.modules:
            results_stub = types.ModuleType("results")
            for fn_name in (
                "build_scientific_results",
                "parse_qe_output",
                "qe_stage_xml_path",
                "retain_qe_stage_xml",
                "write_result_manifest",
            ):
                setattr(results_stub, fn_name, lambda *a, **kw: None)
            sys.modules["results"] = results_stub
            injected_stubs.append("results")

        import kpath
        import qe_model
        import scientific_runner
        return kpath, qe_model, scientific_runner
    finally:
        if inserted_path and str(COMPUTE_DIR) in sys.path:
            sys.path.remove(str(COMPUTE_DIR))
        for name in injected_stubs:
            if name in previous_entries:
                sys.modules[name] = previous_entries[name]  # type: ignore[assignment]
            else:
                sys.modules.pop(name, None)


_CRYSTAL_B_INPUT = """&CONTROL
  calculation = 'bands'
/
K_POINTS crystal_b
5
0.000000 0.000000 0.000000 20 ! G
0.500000 0.000000 0.000000 10 ! M
0.333333 0.333333 0.000000 1 ! K
0.000000 0.000000 0.000000 15 ! G
0.500000 0.500000 0.000000 1 ! X
"""

_AUTO_INPUT = """&CONTROL
  calculation = 'bands'
/
K_POINTS automatic
6 6 1 0 0 0
"""

_SCF_INPUT = """&CONTROL
  calculation = 'scf'
/
"""


class ComputeFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kpath, cls.qe_model, cls.scientific_runner = _load_compute_modules()

    def test_crystal_b_path_metadata_parses_labels_counts_and_discontinuities(self):
        meta = self.kpath.crystal_b_path_metadata(_CRYSTAL_B_INPUT)
        self.assertIsNotNone(meta)
        self.assertEqual(meta["labels"], ["G", "M", "K", "G", "X"])
        self.assertEqual(meta["segments"], [["G", "M"], ["M", "K"], ["G", "X"]])
        self.assertEqual(meta["tickIndices"], [0, 20, 30, 31, 46])
        self.assertEqual(meta["breakIndices"], [31])
        self.assertEqual(meta["pointCoords"]["K"], [0.333333, 0.333333, 0.0])
        self.assertIsNone(self.kpath.crystal_b_path_metadata(_AUTO_INPUT))

    def test_prepare_automatic_k_path_falls_back_to_precompiled_crystal_b_without_seekpath(self):
        inputs = {"scf.in": _SCF_INPUT, "nscfbands.in": _CRYSTAL_B_INPUT}
        with patch.object(self.scientific_runner, "seek_path_for_qe", side_effect=ImportError("No module named 'seekpath'")):
            meta = self.scientific_runner.prepare_automatic_k_path("Band structure", inputs, {})
        self.assertIsNotNone(meta)
        self.assertEqual(meta["mode"], "precompiled-crystal-b")
        self.assertEqual(meta["labels"], ["G", "M", "K", "G", "X"])
        self.assertEqual(inputs["nscfbands.in"], _CRYSTAL_B_INPUT)

        missing_crystal_b = {"scf.in": _SCF_INPUT, "nscfbands.in": _AUTO_INPUT}
        with patch.object(self.scientific_runner, "seek_path_for_qe", side_effect=ImportError("No module named 'seekpath'")):
            with self.assertRaises(ImportError):
                self.scientific_runner.prepare_automatic_k_path("Band structure", missing_crystal_b, {})

    def test_software_version_uses_devnull_and_retries_once_with_single_rank_mpi_launcher(self):
        direct_ok = MagicMock(returncode=0, stdout="Program PWSCF v.7.2 starts on 11Nov2026\n", stderr="")
        with patch.object(self.qe_model.shutil, "which", return_value="/opt/qe/bin/pw.x"), \
             patch.object(self.qe_model.subprocess, "run", return_value=direct_ok) as mock_run:
            version = self.qe_model.software_version(["pw.x", "--version"])
        self.assertEqual(version, "Quantum ESPRESSO PWSCF 7.2")
        self.assertEqual(mock_run.call_count, 1)
        self.assertIs(mock_run.call_args.kwargs["stdin"], subprocess.DEVNULL)

        pmi_fail = MagicMock(returncode=1, stdout="", stderr="Fatal error in PMPI_Init: PMI server not found")
        mpi_ok = MagicMock(returncode=0, stdout="Program PWSCF v.7.2 starts on 11Nov2026\n", stderr="")
        with patch.dict(os.environ, {"PHYNITE_MPI_LAUNCHER": json.dumps(["mpirun", "-np", "{ranks}"])}, clear=False), \
             patch.object(self.qe_model.shutil, "which", return_value="/opt/qe/bin/pw.x"), \
             patch.object(self.qe_model.subprocess, "run", side_effect=[pmi_fail, mpi_ok]) as mock_run:
            version_via_mpi = self.qe_model.software_version(["pw.x", "--version"])
        self.assertEqual(version_via_mpi, "Quantum ESPRESSO PWSCF 7.2")
        self.assertEqual(mock_run.call_count, 2)
        self.assertEqual(mock_run.call_args_list[1].args[0], ["mpirun", "-np", "1", "pw.x", "--version"])
        self.assertIs(mock_run.call_args_list[1].kwargs["stdin"], subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()
