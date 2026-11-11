import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('mirrors', Path(__file__).with_name('native-ci-apt-mirrors.py'))
mirrors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirrors)
SIGNED = 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'sources.list.d').mkdir()
        (self.root / 'apt.conf.d').mkdir()
        self.sources = self.root / 'sources.list.d/ubuntu.sources'
        self.third_party = self.root / 'sources.list.d/microsoft-prod.list'
        self.third_party.write_text('deb [signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/repos/code stable main\n')

    def source(self, uri):
        return f'Types: deb\nURIs: {uri}\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nArchitectures: arm64\n{SIGNED}'

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def setup_x64(self):
        self.sources.write_text(self.source('mirror+file:/etc/apt/apt-mirrors.txt').replace('arm64', 'amd64'))
        path = self.root / 'apt-mirrors.txt'
        path.write_text('http://azure.archive.ubuntu.com/ubuntu\tpriority:1\nhttps://archive.ubuntu.com/ubuntu\tpriority:2\nhttps://security.ubuntu.com/ubuntu\tpriority:3\n')
        return path

    def test_x64_retains_official_priorities_and_signing(self):
        path = self.setup_x64()
        before = self.snapshot()
        mirrors.configure(self.root, 'linux-x64')
        self.assertEqual(self.sources.read_bytes(), before['sources.list.d/ubuntu.sources'])
        self.assertEqual(self.third_party.read_bytes(), before['sources.list.d/microsoft-prod.list'])
        self.assertEqual(path.read_text(), before['apt-mirrors.txt'].decode() + mirrors.X64_MIRROR + '\tpriority:4\n')
        for line in path.read_text().splitlines():
            uri, tags = line.split('\t')
            self.assertNotIn(' ', uri)
            self.assertRegex(tags, r'^priority:[1-4]$')
        after = self.snapshot()
        mirrors.configure(self.root, 'linux-x64')
        self.assertEqual(self.snapshot(), after)

    def test_arm_preserves_all_fields_and_non_ubuntu_sources(self):
        original = self.source('http://ports.ubuntu.com/ubuntu-ports/')
        extra = '\nTypes: deb\nURIs: https://packages.microsoft.com/ubuntu/24.04/prod\nSuites: noble\nComponents: main\nSigned-By: /usr/share/keyrings/microsoft-prod.gpg\n'
        self.sources.write_text(original + extra)
        third_party = self.third_party.read_bytes()
        mirrors.configure(self.root, 'linux-arm64')
        self.assertEqual(self.sources.read_text(), original.replace('http://ports.ubuntu.com/ubuntu-ports/', mirrors.PORTS_URI) + extra)
        self.assertEqual(self.third_party.read_bytes(), third_party)
        self.assertEqual((self.root / mirrors.PORTS_LIST).read_text(), 'https://ports.ubuntu.com/ubuntu-ports/\tpriority:1\nhttps://mirrors.mit.edu/ubuntu-ports/\tpriority:2\n')
        after = self.snapshot()
        mirrors.configure(self.root, 'linux-arm64')
        self.assertEqual(self.snapshot(), after)

    def test_missing_signing_key_fails_without_writes(self):
        for target, uri in [('linux-arm64', 'http://ports.ubuntu.com/ubuntu-ports/'), ('linux-x64', 'mirror+file:/etc/apt/apt-mirrors.txt')]:
            self.sources.write_text(self.source(uri).replace(SIGNED, ''))
            before = self.snapshot()
            with self.assertRaisesRegex(ValueError, 'signing key'):
                mirrors.configure(self.root, target)
            self.assertEqual(self.snapshot(), before)

    def test_unauthenticated_sources_fail_without_writes(self):
        self.sources.write_text(self.source('https://ports.ubuntu.com/ubuntu-ports/') + 'Trusted: yes\n')
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'unauthenticated'):
            mirrors.configure(self.root, 'linux-arm64')
        self.assertEqual(self.snapshot(), before)

    def test_unknown_layout_and_target_fail_without_writes(self):
        self.sources.write_text(self.source('https://example.invalid/ubuntu'))
        before = self.snapshot()
        for target in ['linux-arm64', 'linux-x64', 'darwin-arm64']:
            with self.assertRaises(ValueError):
                mirrors.configure(self.root, target)
            self.assertEqual(self.snapshot(), before)

    def test_symlink_destination_fails_before_changing_mirrors(self):
        self.setup_x64()
        outside = self.root / 'preserved.txt'
        outside.write_text('preserve this file\n')
        (self.root / 'apt.conf.d/zzzz-phynite-native-ci').symlink_to(outside)
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'symlink'):
            mirrors.configure(self.root, 'linux-x64')
        self.assertEqual(self.snapshot(), before)

    def test_runner_retry_file_is_retained_with_later_override(self):
        self.setup_x64()
        retries = self.root / 'apt.conf.d/zz-retries'
        retries.write_text('Acquire::Retries "3";\nAcquire::http::Timeout "30";\n')
        mirrors.configure(self.root, 'linux-x64')
        self.assertEqual(retries.read_text(), 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\n')
        self.assertEqual(sorted(p.name for p in retries.parent.iterdir())[-1], 'zzzz-phynite-native-ci')


if __name__ == '__main__':
    unittest.main(verbosity=2)
