"""Exercise the shipped Node bundle during the full source/backend quality gate."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ExecutorProcessTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node') and (ROOT / 'node_modules/esbuild').exists(),
                         'Requires Node 22 and npm ci, as installed by the source CI gate.')
    def test_real_core_and_bundled_executor_without_browser_or_provider(self):
        environment = {**os.environ, 'PHYNITE_TEST_PYTHON': sys.executable}
        result = subprocess.run(
            ['node', '--experimental-strip-types', '--test', 'tests/ai-executor.integration.mjs'],
            cwd=ROOT, env=environment, capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
