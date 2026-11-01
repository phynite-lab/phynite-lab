"""Write an exact-path user-namespace fixture for ephemeral GitHub Linux CI.

This script only writes a policy file. The release workflow explicitly loads
and removes it on GitHub-hosted runners; it is never an application installer.
No sysctl, setuid bit, namespace probe or end-user policy is changed here.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--target', required=True, choices=['linux-x64', 'linux-arm64'])
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    workspace = args.workspace.resolve(strict=True)
    if not re.fullmatch(r'/[A-Za-z0-9/_.-]+', str(workspace)) or workspace == Path('/') or not re.fullmatch(r'[0-9]+', args.run_id):
        parser.error('Use a literal GitHub workspace and numeric workflow run ID.')
    package = f'phynite-lab-runtime-{args.target}'
    paths = [workspace / 'build/bootstrap/bwrap']
    for folder in ('raw-smoke', 'raw-scientific'):
        paths.append(workspace / 'build' / folder / 'install/node_modules' / package / 'bootstrap/bwrap')
    # Ubuntu restricts capabilities inside user namespaces for unconfined
    # applications without an explicit userns rule. Keep that host restriction
    # enabled and grant only these three test executable paths permission to
    # construct namespaces. Bubblewrap still enforces filesystem/network/IPC
    # isolation, and its real probes must pass as the unprivileged runner user.
    lines = ['abi <abi/4.0>,']
    for index, path in enumerate(paths):
        lines.extend([f'profile phynite-ci-{args.run_id}-{args.target}-{index} "{path}" flags=(unconfined) {{', '  userns,', '}'])
    with args.output.open('x', encoding='utf-8') as output:
        output.write('\n'.join(lines) + '\n')
    print(f'Prepared {len(paths)} exact CI executable paths; no OS policy loaded by this script.')


if __name__ == '__main__':
    main()
