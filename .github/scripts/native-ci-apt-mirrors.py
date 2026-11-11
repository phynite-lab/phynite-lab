"""Add signed Ubuntu archive failover on ephemeral native-release runners.

Only archive locations and bounded transport retries change. Existing suites,
components, architecture restrictions and Ubuntu signing keys remain intact.
APT must authenticate every index/package; no application installer uses this.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess


X64_MIRROR = 'https://mirrors.edge.kernel.org/ubuntu/'
ARM_MIRROR = 'https://mirrors.mit.edu/ubuntu-ports/'
PORTS_LIST = 'phynite-ubuntu-ports-mirrors.txt'
PORTS_URI = f'mirror+file:/etc/apt/{PORTS_LIST}'
SIGNING_FIELD = 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg'
TRANSPORT_CONFIG = '''// Ephemeral native CI only. Keep APT authentication enabled.
Acquire::Retries "0";
Acquire::http::Timeout "15";
Acquire::https::Timeout "15";
APT::Update::Error-Mode "any";
'''


def require_signed(stanza: str) -> None:
    if SIGNING_FIELD not in stanza.splitlines():
        raise ValueError('Expected the existing Ubuntu archive signing key.')
    if re.search(r'^(Trusted|Allow-Insecure|Allow-Weak):\s*yes\s*$', stanza, re.I | re.M):
        raise ValueError('Refusing an unauthenticated Ubuntu source.')


def configure(apt_root: Path, target: str) -> None:
    sources = apt_root / 'sources.list.d/ubuntu.sources'
    original = sources.read_text(encoding='utf-8')
    writes: dict[Path, str] = {}
    if target == 'linux-x64':
        stanzas = [s for s in original.split('\n\n') if re.search(r'^URIs:\s*mirror\+file:/etc/apt/apt-mirrors\.txt\s*$', s, re.M)]
        if not stanzas:
            raise ValueError('Expected the GitHub x64 Ubuntu mirror list.')
        for stanza in stanzas:
            require_signed(stanza)
        mirrors = apt_root / 'apt-mirrors.txt'
        existing = mirrors.read_text(encoding='utf-8')
        if not re.search(r'^https?://azure\.archive\.ubuntu\.com/ubuntu/?\s+priority:1\s*$', existing, re.M):
            raise ValueError('Expected the existing GitHub Ubuntu mirror priorities.')
        if X64_MIRROR not in existing.split():
            writes[mirrors] = existing.rstrip() + f'\n{X64_MIRROR}\tpriority:4\n'
    elif target == 'linux-arm64':
        stanzas = original.split('\n\n')
        count = 0
        for index, stanza in enumerate(stanzas):
            match = re.search(r'^URIs:[ \t]+(.+)$', stanza, re.M)
            if not match:
                continue
            uris = match.group(1).split()
            if uris != [PORTS_URI] and not (uris and all(re.fullmatch(r'https?://ports\.ubuntu\.com/ubuntu-ports/?', uri) for uri in uris)):
                continue
            require_signed(stanza)
            stanzas[index] = stanza[:match.start(1)] + PORTS_URI + stanza[match.end(1):]
            count += 1
        if not count:
            raise ValueError('Expected the existing Ubuntu ports source.')
        writes[sources] = '\n\n'.join(stanzas)
        writes[apt_root / PORTS_LIST] = f'https://ports.ubuntu.com/ubuntu-ports/\tpriority:1\n{ARM_MIRROR}\tpriority:2\n'
    else:
        raise ValueError('Only the two qualified Linux CI targets are supported.')
    # Validate the entire plan before writing any file. Leave other repositories
    # and every signing field untouched; the subsequent apt update verifies them.
    writes[apt_root / 'apt.conf.d/zzzz-phynite-native-ci'] = TRANSPORT_CONFIG
    for path, content in writes.items():
        if path.is_symlink():
            raise ValueError(f'Refusing a symlink: {path}')
        if not path.parent.is_dir():
            raise ValueError(f'Missing APT directory: {path.parent}')
    for path, content in writes.items():
        path.write_text(content, encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apt-root', required=True, type=Path)
    parser.add_argument('--target', required=True, choices=['linux-x64', 'linux-arm64'])
    parser.add_argument('--verify-effective', action='store_true', help='Verify the actual runner APT settings after configuration.')
    args = parser.parse_args()
    if args.verify_effective and args.apt_root.resolve() != Path('/etc/apt'):
        parser.error('Effective verification requires the actual /etc/apt root.')
    configure(args.apt_root, args.target)
    if args.verify_effective:
        effective = subprocess.check_output(['apt-config', 'dump'], text=True)
        for key, value in [('Acquire::Retries', '0'), ('Acquire::http::Timeout', '15'), ('Acquire::https::Timeout', '15'), ('APT::Update::Error-Mode', 'any')]:
            if not re.search(rf'^{re.escape(key)} "{value}";$', effective, re.M | re.I):
                raise ValueError(f'The runner overrides the required APT option {key}.')
    print(f'Added signed Ubuntu mirror failover for {args.target}; authentication and qualification gates remain required.')


if __name__ == '__main__':
    main()
