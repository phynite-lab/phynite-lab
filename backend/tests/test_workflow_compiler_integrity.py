"""Compiler hot reload must revalidate both source and checksum manifest."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.local_api.domain import workflow_compiler
from backend.local_api.domain.phynite_core import ApiError


class CompilerIntegrityTests(unittest.TestCase):
    def test_cached_compiler_revalidates_changed_manifest_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'workflow_compiler_bundle.js'
            manifest = source.with_suffix('.js.json')
            source.write_text('var version = 1;')
            correct_manifest = {'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
            manifest.write_text(json.dumps(correct_manifest))
            workflow_compiler._load_compiler_source.cache_clear()
            try:
                with patch.object(workflow_compiler, '__file__', str(Path(directory) / 'compiler.py')):
                    self.assertEqual(workflow_compiler.compiler_source(), source.read_text())
                    manifest.write_text(json.dumps({'sha256': 'invalid-checksum'}))
                    with self.assertRaises(ApiError):
                        workflow_compiler.compiler_source()
                    manifest.write_text(json.dumps(correct_manifest))
                    self.assertEqual(workflow_compiler.compiler_source(), source.read_text())
                    source.write_text('var version = 200;')
                    with self.assertRaises(ApiError):
                        workflow_compiler.compiler_source()
            finally:
                workflow_compiler._load_compiler_source.cache_clear()
