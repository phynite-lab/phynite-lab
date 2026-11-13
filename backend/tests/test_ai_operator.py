from __future__ import annotations

import sys
import unittest
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "local_worker"))

from ai_operator import (  # noqa: E402
    HUMAN_RUNTIME_MESSAGE,
    AiAgentBudget,
    OperatorError,
    RbfGaussianProcess,
    assert_no_terminal_install_instructions,
    candidate_within_contract,
    feature_flags,
    geometry_feasibility,
    human_budget_summary,
    human_error,
    budget_phase,
    reconcile_receipt,
    sparse_evidence_manifest,
    validate_campaign_contract,
    validate_repair,
)


class AiOperatorTests(unittest.TestCase):
    def test_budget_keeps_queue_and_solver_clocks_separate(self):
        budget = AiAgentBudget(3600, 7200, 900, 2, maxCandidates=5, maxNodeHours=10).validate()
        self.assertEqual(budget.maxQueueWaitSeconds, 7200)
        with self.assertRaises(OperatorError):
            AiAgentBudget(0, 10, 10, 1).validate()

    def test_campaign_contract_is_bounded_and_human_summary_hides_backend_names(self):
        contract = validate_campaign_contract({
            "maxCandidates": 5,
            "parameterRanges": {"kgrid": {"min": 40, "max": 80, "unit": "points"}},
            "evaluator": "total_energy",
            "allowedClusters": ["Mahameru"],
            "totalNodeHours": 10,
            "maxWallSecondsPerCandidate": 3600,
            "repairPolicy": ["lower_mixing_beta"],
            "expiresAtEpoch": 4_000_000_000,
        }, now_epoch=1_000)
        self.assertTrue(candidate_within_contract({"parameters": {"kgrid": 60}, "cluster": "Mahameru", "nodeHours": 1}, contract))
        self.assertFalse(candidate_within_contract({"parameters": {"kgrid": 90}, "cluster": "Mahameru", "nodeHours": 1}, contract))
        summary = human_budget_summary({**contract, "clusterLabel": "kluster Mahameru"})
        self.assertIn("Maksimal 5 kandidat", summary)
        self.assertNotIn("profileSha256", summary)
        with self.assertRaisesRegex(OperatorError, "maksimal 5"):
            validate_campaign_contract({**contract, "parameterRanges": {str(i): {"min": 0, "max": 1} for i in range(6)}})

    def test_gp_cholesky_predicts_and_limits_design_space(self):
        if importlib.util.find_spec("numpy") is None or importlib.util.find_spec("scipy") is None:
            self.skipTest("bundled scientific runtime is not installed in this host test interpreter")
        model = RbfGaussianProcess(seed=7).fit([[0.0], [1.0], [2.0]], [0.0, 1.0, 0.0])
        mean, uncertainty = model.predict([[1.0], [3.0]])
        self.assertEqual(len(mean), 2)
        self.assertEqual(len(uncertainty), 2)
        self.assertLess(uncertainty[0], uncertainty[1])
        self.assertTrue(model.jitter is not None)
        with self.assertRaisesRegex(OperatorError, "maksimal 5"):
            RbfGaussianProcess().fit([[1, 2, 3, 4, 5, 6]], [1])

    def test_geometry_checks_periodic_images_and_unknown_radius(self):
        if importlib.util.find_spec("numpy") is None:
            self.skipTest("bundled scientific runtime is not installed in this host test interpreter")
        atoms = [{"element": "H", "position": [0, 0, 0]}, {"element": "H", "position": [0.2, 0, 0]}]
        radii = {"H": {"covalent": 0.74, "source": "COD", "version": "2024"}}
        result = geometry_feasibility(atoms, [[10, 0, 0], [0, 10, 0], [0, 0, 10]], [True, True, True], radii)
        self.assertFalse(result["feasible"])
        self.assertIn("Tidak dikirim", result["message"])
        with self.assertRaises(OperatorError):
            geometry_feasibility(atoms, [[10, 0, 0], [0, 10, 0], [0, 0, 10]], [True, True, True], {})

    def test_repair_catalog_forbids_identity_changes(self):
        repair = validate_repair({"kind": "lower_mixing_beta", "value": 0.2}, current={"mixing_beta": 0.7}, allowed=["lower_mixing_beta"])
        self.assertFalse(repair["scientificIdentityChanged"])
        with self.assertRaises(OperatorError):
            validate_repair({"kind": "lower_mixing_beta", "value": 0.2, "cutoff": 20}, current={"mixing_beta": 0.7}, allowed=["lower_mixing_beta"])
        with self.assertRaisesRegex(OperatorError, "keputusan"):
            validate_repair({"kind": "metallic_smearing", "value": "mv"}, allowed=["metallic_smearing"], diagnostics={})

    def test_sparse_manifest_keeps_wavefunctions_as_references(self):
        manifest = sparse_evidence_manifest([
            {"path": "pw.out", "sizeBytes": 10, "sha256": "a" * 64},
            {"path": "wfc1.dat", "sizeBytes": 100, "sha256": "b" * 64, "remotePath": "/scratch/wfc1.dat"},
            {"path": "charge-density.dat", "sizeBytes": 100, "sha256": "c" * 64},
        ])
        self.assertEqual(manifest["files"][0]["status"], "downloaded")
        self.assertEqual(manifest["files"][1]["status"], "reference_only")
        self.assertIn("remotePath", manifest["files"][1])

    def test_receipt_reconciliation_never_resubmits(self):
        base = {"scheduler": "slurm", "schedulerJobId": "91", "remoteWorkDir": "/scratch/91", "profileSha256": "a" * 64, "submittedAtEpoch": 100}
        queued = reconcile_receipt(base, {"schedulerJobId": "91", "state": "PENDING"}, now_epoch=200)
        self.assertEqual(queued["state"], "observing")
        self.assertEqual(queued["queueWaitSeconds"], 100)
        invalid = reconcile_receipt(base, {"schedulerJobId": "different", "state": "RUNNING"})
        self.assertEqual(invalid["state"], "manual-resume-required")
        self.assertFalse(invalid["resubmit"])

    def test_queue_wait_does_not_trigger_solver_wall_timeout(self):
        budget = AiAgentBudget(60, 120, 30, 1)
        phase = budget_phase({"submittedAtEpoch": 0}, {"state": "PENDING"}, budget, now_epoch=100)
        self.assertEqual(phase["phase"], "queue")
        self.assertFalse(phase["wallExceeded"])
        self.assertFalse(phase["queueExceeded"])

    def test_human_messages_and_runtime_text_are_safe(self):
        self.assertEqual(human_error("SSH_DISCONNECTED")["action"], "Sambung Ulang")
        assert_no_terminal_install_instructions(HUMAN_RUNTIME_MESSAGE)
        self.assertEqual(feature_flags({"PHYNITE_AI_AGENT_DISCOVERY": "true"})["ai-agent-discovery"], True)


if __name__ == "__main__":
    unittest.main()
