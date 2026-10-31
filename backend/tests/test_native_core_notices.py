"""Native notice attribution uses actual archive contents and installed owners."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/core_native_notices.py'
spec = importlib.util.spec_from_file_location('core_native_notices', SCRIPT)
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


class NativeCoreNoticeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def test_plural_and_nested_license_names_are_preserved(self):
        for name in ('LICENSES.txt', 'LICENCES', 'COPYRIGHT.txt', 'NOTICE.md', 'AUTHORS.md'):
            self.assertIsNotNone(notices.NOTICE_NAME.match(name), name)
        self.assertIsNone(notices.NOTICE_NAME.match('licensing.py'))
        path = self.write('pkg.dist-info/licenses/LICENSES.txt', 'Upstream library notices\n')
        distribution = mock.Mock(files=[Path('pkg.dist-info/licenses/LICENSES.txt')])
        distribution.locate_file.side_effect = lambda file: self.root / file
        actual = notices.distribution_notices(distribution)
        self.assertEqual(actual[0]['name'], 'pkg.dist-info/licenses/LICENSES.txt')
        self.assertEqual(actual[0]['sha256'], notices.sha256(path.read_bytes()))

    def test_empty_or_missing_notice_fails(self):
        path = self.write('LICENSE', '\n')
        with self.assertRaisesRegex(ValueError, 'Empty notice'):
            notices.notice_file(path)
        distribution = mock.Mock(files=[], metadata={'Name': 'unlicensed-fixture'})
        with self.assertRaisesRegex(ValueError, 'Missing actual'):
            notices.distribution_notices(distribution)

    def test_toc_is_literal_and_names_must_be_safe(self):
        source = self.write('liboriginal.so', 'native fixture')
        toc = self.write('PKG.toc', repr(('archive', {}, [('lib/copied.so', str(source), 'BINARY'), ('alias.so', 'lib/copied.so', 'SYMLINK')])))
        self.assertEqual(notices.toc_native_sources(toc), {'lib/copied.so': source.resolve()})
        toc.write_text(repr(('archive', {}, [('../outside.so', str(source), 'BINARY')])))
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            notices.toc_native_sources(toc)
        toc.write_text("__import__('os').getcwd()")
        with self.assertRaises(ValueError):
            notices.toc_native_sources(toc)

    def test_archive_extras_and_missing_payloads_fail(self):
        source = {'lib.so': self.root / 'original.so'}
        notices.validate_archive_members(source, {'lib.so': (1, 2, 3, 1, 'b'), 'data': (1, 2, 3, 1, 'x')})
        with self.assertRaisesRegex(ValueError, 'unrecorded'):
            notices.validate_archive_members(source, {'lib.so': ('b',), 'unrecorded.so': ('b',)})
        with self.assertRaisesRegex(ValueError, 'absent'):
            notices.validate_archive_members(source, {})

    def keg(self, *, formula='example', notices_present=True):
        prefix = self.root / formula / '1.2.3'
        prefix.mkdir(parents=True)
        self.write(f'{formula}/1.2.3/INSTALL_RECEIPT.json', json.dumps({'source': {'versions': {'stable': '1.2.3'}}}))
        self.write(f'{formula}/1.2.3/.brew/{formula}.rb', 'class Example < Formula\n  url "https://example.invalid/source-1.2.3.tar.gz"\n  sha256 "' + 'a' * 64 + '"\nend\n')
        if notices_present:
            self.write(f'{formula}/1.2.3/COPYRIGHT.txt', 'Original upstream notice fixture\n')
        return prefix

    def test_homebrew_requires_receipt_recipe_and_real_license_bytes(self):
        prefix = self.keg()
        owner = notices.InstalledOwners.homebrew_owner(prefix)
        self.assertEqual(owner['id'], 'homebrew:example@1.2.3')
        self.assertEqual(owner['provenance']['upstreamSourceSha256'], 'a' * 64)
        self.assertEqual(owner['notices'][0]['text'], 'Original upstream notice fixture\n')
        (prefix / '.brew/example.rb').unlink()
        with self.assertRaisesRegex(ValueError, 'exact Homebrew recipe'):
            notices.InstalledOwners.homebrew_owner(prefix)

    def test_missing_homebrew_license_cannot_be_replaced_by_recipe_license_string(self):
        prefix = self.keg(notices_present=False)
        with self.assertRaisesRegex(ValueError, 'Missing original'):
            notices.InstalledOwners.homebrew_owner(prefix)

    def test_sqlite_uses_exact_installed_dedication_and_stops_if_missing(self):
        prefix = self.keg(formula='sqlite', notices_present=False)
        header = prefix / 'include/sqlite3.h'
        header.parent.mkdir()
        header.write_text('/*\n** The author disclaims copyright to this source code.\n** Fixture blessing\n*************************************************************************\n*/\n')
        owner = notices.InstalledOwners.homebrew_owner(prefix)
        self.assertIn('Fixture blessing', owner['notices'][0]['text'])
        header.write_text('not an upstream dedication')
        with self.assertRaisesRegex(ValueError, 'no recognized'):
            notices.InstalledOwners.homebrew_owner(prefix)

    def test_native_wheel_payload_must_match_installed_record(self):
        path = self.write("tampered.so", "modified native bytes")
        owner = object.__new__(notices.InstalledOwners)
        owner.wheels = {path: mock.Mock()}
        owner.wheel_hashes = {path: SimpleNamespace(mode="sha256", value="wrong-hash")}
        with self.assertRaisesRegex(ValueError, "differs from its installed wheel RECORD"):
            owner.owner(path)

    def test_unknown_native_file_does_not_get_a_license_based_on_its_name(self):
        path = self.write('libssl.3.dylib', 'fixture only')
        with mock.patch.object(notices.metadata, 'distributions', return_value=[]):
            owners = notices.InstalledOwners()
        with mock.patch.object(owners, 'debian_owner', return_value=None):
            with self.assertRaisesRegex(ValueError, 'No verified installed-package'):
                owners.owner(path)

    def test_written_notice_bytes_are_bound_to_the_native_inventory(self):
        collector_path = SCRIPT.with_name('local-core-notices.py')
        collector_spec = importlib.util.spec_from_file_location('local_core_notice_writer', collector_path)
        collector = importlib.util.module_from_spec(collector_spec)
        with mock.patch.dict(sys.modules, {'core_native_notices': notices}):
            collector_spec.loader.exec_module(collector)
        output = self.root / 'release/THIRD_PARTY_NOTICES.md'
        arguments = ['local-core-notices.py', '--output', str(output), '--executable', str(self.root / 'core'), '--pkg-toc', str(self.root / 'PKG.toc')]
        with mock.patch.object(sys, 'argv', arguments), \
                mock.patch.object(collector, 'installed_notices', return_value='Actual license text · source\n'), \
                mock.patch.object(collector, 'collect_native_notices', return_value=('Native copyright text\n', {'schemaVersion': 1, 'executableSha256': 'a' * 64})):
            collector.main()
        inventory = json.loads(output.with_name('THIRD_PARTY_NATIVE.json').read_text())
        self.assertEqual(output.read_text(), 'Actual license text · source\n\nNative copyright text\n')
        self.assertEqual(inventory['executableSha256'], 'a' * 64)
        self.assertEqual(inventory['noticesSha256'], notices.sha256(output.read_bytes()))


if __name__ == '__main__':
    unittest.main()
