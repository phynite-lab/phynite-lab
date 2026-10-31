"""Fail-closed matching of actual lxml native versions to corresponding sources."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/lxml_native_sources.py'
spec = importlib.util.spec_from_file_location('lxml_native_sources', SCRIPT)
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)


class LxmlNativeSourcesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.versions = {'lxml': '6.1.3', 'libiconv': '1.18', 'libxml2': '2.14.6', 'libxslt': '1.1.43', 'zlib': '1.3.2'}

    def manifest(self):
        entries = []
        for name, version in self.versions.items():
            relative = f'distribution/sources/native/{name}.fixture'
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            content = f'Synthetic {name} test fixture'.encode()
            path.write_bytes(content)
            entries.append({'name': name, 'version': version, 'path': relative, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        doc = {'schemaVersion': 1, 'component': 'lxml', 'version': '6.1.3', 'versions': self.versions, 'archives': entries}
        path = self.root / sources.MANIFEST
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc))
        return path, doc

    def test_archive_bytes_and_complete_dependency_set_are_required(self):
        path, doc = self.manifest()
        self.assertEqual(sources.verified_sources(self.root), doc)
        target = self.root / doc['archives'][0]['path']
        target.write_bytes(target.read_bytes() + b'corruption')
        with self.assertRaisesRegex(ValueError, 'checksum/size'):
            sources.verified_sources(self.root)
        path.write_text(json.dumps({**doc, 'archives': doc['archives'][1:]}))
        with self.assertRaisesRegex(ValueError, 'complete'):
            sources.verified_sources(self.root)

    def test_archive_paths_and_version_mismatches_are_rejected(self):
        path, doc = self.manifest()
        doc['archives'][0]['path'] = '../external.tar.gz'
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            sources.verified_sources(self.root)
        path, doc = self.manifest()
        doc['archives'][0]['version'] = 'unreviewed'
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, 'versions disagree'):
            sources.verified_sources(self.root)

    def test_native_probe_must_match_supplied_source_versions(self):
        extension = self.root / 'etree.so'
        etree = SimpleNamespace(__file__=str(extension), LIBXML_COMPILED_VERSION=(2, 14, 6), LIBXSLT_COMPILED_VERSION=(1, 1, 43))
        doc = {'versions': self.versions}
        version_probe = SimpleNamespace(in_dll=lambda *args: SimpleNamespace(value=0x111))
        with mock.patch.dict(sys.modules, {'lxml': SimpleNamespace(etree=etree)}), mock.patch.object(sources, 'verified_sources', return_value=doc), mock.patch.object(sources.ctypes, 'CDLL'), mock.patch.object(sources.ctypes, 'c_int', version_probe):
            with self.assertRaisesRegex(ValueError, 'do not match'):
                sources.lxml_source_evidence(self.root, extension, '6.1.3')

    def test_unverifiable_native_linkage_is_blocked(self):
        extension = self.root / 'etree.so'
        etree = SimpleNamespace(__file__=str(extension))
        version_probe = SimpleNamespace(in_dll=mock.Mock(side_effect=ValueError('missing symbol')))
        with mock.patch.dict(sys.modules, {'lxml': SimpleNamespace(etree=etree)}), mock.patch.object(sources, 'verified_sources', return_value={'versions': self.versions}), mock.patch.object(sources.ctypes, 'CDLL'), mock.patch.object(sources.ctypes, 'c_int', version_probe):
            with self.assertRaisesRegex(ValueError, 'Cannot establish'):
                sources.lxml_source_evidence(self.root, extension, '6.1.3')


if __name__ == '__main__':
    unittest.main()
