from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "local_worker"))

from ai_operator import HUMAN_RUNTIME_MESSAGE, assert_no_terminal_install_instructions, runtime_self_check  # noqa: E402


class AgentRuntimeReleaseTests(unittest.TestCase):
    def test_release_manifest_declares_complete_agent_runtime(self):
        manifest = json.loads((ROOT / "local_api/agent-runtime-manifest.json").read_text())
        self.assertEqual(manifest["component"], "agent")
        self.assertEqual(manifest["requiredImports"], ["numpy", "scipy", "scipy.linalg"])
        self.assertIn("gp-cholesky", manifest["acceptance"])
        assert_no_terminal_install_instructions(manifest["researcherMessageWhenUnavailable"])

    def test_self_check_is_actionable_when_host_runtime_is_missing(self):
        result = runtime_self_check()
        self.assertIn("available", result)
        if result["available"] is not True:
            self.assertEqual(result["message"], HUMAN_RUNTIME_MESSAGE)


if __name__ == "__main__":
    unittest.main()
