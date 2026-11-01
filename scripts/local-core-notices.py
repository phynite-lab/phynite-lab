"""Collect actual installed core dependency notices; never synthesizes license grants."""
from __future__ import annotations

import argparse
import hashlib
import json
from importlib import metadata
from pathlib import Path
import re
import sys
import sysconfig

from core_native_notices import collect_native_notices
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


ROOT_PACKAGES = ('boto3', 'psutil', 'keyring', 'PyInstaller', 'pypdf',
                 'python-docx', 'openpyxl', 'Pillow')
QUICKJS_PACKAGES = ('python-quickjs-ng', 'quickjs')


def installed(name: str) -> bool:
    try:
        metadata.version(name)
    except metadata.PackageNotFoundError:
        return False
    return True


def installed_notices() -> str:
    pending = list(ROOT_PACKAGES)
    installed_quickjs = [name for name in QUICKJS_PACKAGES
                         if installed(name)]
    if len(installed_quickjs) != 1:
        raise RuntimeError('Exactly one reviewed QuickJS provider must be installed: python-quickjs-ng or quickjs.')
    pending.append(installed_quickjs[0])
    packages: dict[str, metadata.Distribution] = {}
    while pending:
        name = canonicalize_name(pending.pop())
        if name in packages:
            continue
        distribution = metadata.distribution(name)
        packages[name] = distribution
        for raw in distribution.requires or ():
            requirement = Requirement(raw)
            if requirement.marker is None or requirement.marker.evaluate({'extra': ''}):
                pending.append(requirement.name)
    python_license = Path(sysconfig.get_path('stdlib')) / 'LICENSE.txt'
    if not python_license.is_file():
        raise RuntimeError('The Python runtime LICENSE.txt is missing; obtain its actual license before distributing the frozen core.')
    sections = [f'# Frozen core dependency notices\n\nPython {sys.version.split()[0]}\n\n{python_license.read_text()}']
    for name, distribution in sorted(packages.items()):
        files = distribution.files or ()
        notices = []
        for file in files:
            if re.match(r'^(licenses?|licences?|copying|copyright|notices?|authors)(?:[._-]|$)', Path(str(file)).name, re.I):
                path = Path(distribution.locate_file(file))
                if path.is_file():
                    notices.append(f'### {Path(str(file)).name}\n\n{path.read_text(encoding="utf-8")}')
        if not notices:
            raise RuntimeError(f'No installed license/notice text found for {name}; release requires its actual notice.')
        license_name = distribution.metadata.get('License-Expression') or distribution.metadata.get('License') or 'See included license text'
        links = distribution.metadata.get_all('Project-URL') or []
        home = distribution.metadata.get('Home-page')
        if home:
            links.append(home)
        sections.append(f'## {distribution.metadata["Name"]} {distribution.version}\n\nLicense metadata: {license_name}\n\n' + '\n'.join(links) + '\n\n' + '\n\n'.join(notices))
    return '\n\n'.join(sections) + '\n'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--executable', type=Path, required=True, help='Actual just-built PyInstaller core')
    parser.add_argument('--pkg-toc', type=Path, required=True, help='Matching PyInstaller PKG-00.toc')
    args = parser.parse_args()
    native_content, inventory = collect_native_notices(args.executable, args.pkg_toc)
    content = installed_notices() + '\n' + native_content
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w', encoding='utf-8') as output:
        output.write(content)
    inventory['noticesSha256'] = hashlib.sha256(args.output.read_bytes()).hexdigest()
    inventory_path = args.output.with_name('THIRD_PARTY_NATIVE.json')
    inventory_path.write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
    print(f'Collected actual native inventory and dependency notices: {args.output}; {inventory_path}')


if __name__ == '__main__':
    main()
