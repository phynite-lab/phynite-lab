"""Inventory actual PyInstaller payloads and collect notices from their owners.

No library is attributed from its filename. Ownership must come from installed
wheel records, the interpreter, Homebrew receipts, or Debian package records.
Unknown ownership or missing real notice text stops the build.
"""
from __future__ import annotations

import ast
import base64
import hashlib
from importlib import metadata
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import sysconfig
from typing import Any


NOTICE_NAME = re.compile(r'^(?:licen[cs]es?|copying|copyright|notices?|authors)(?:[._-]|$)', re.I)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def notice_file(path: Path, *, label: str | None = None) -> dict[str, str]:
    content = path.read_bytes()
    text = content.decode('utf-8')
    if not text.strip():
        raise ValueError(f'Empty notice text: {path}')
    return {'name': label or path.name, 'sha256': sha256(content), 'text': text}


def distribution_notices(distribution: metadata.Distribution) -> list[dict[str, str]]:
    result = []
    for file in distribution.files or ():
        if NOTICE_NAME.match(Path(str(file)).name):
            path = Path(distribution.locate_file(file))
            if path.is_file():
                result.append(notice_file(path, label=str(file)))
    if not result:
        raise ValueError(f'Missing actual installed notices for {distribution.metadata["Name"]}')
    return result


def toc_native_sources(toc_path: Path) -> dict[str, Path]:
    """Read the build-generated literal, never execute a spec or TOC as code."""
    document = ast.literal_eval(toc_path.read_text(encoding='utf-8'))
    if not isinstance(document, tuple) or len(document) < 3 or not isinstance(document[2], list):
        raise ValueError('Unsupported PyInstaller PKG TOC format')
    result: dict[str, Path] = {}
    for record in document[2]:
        if not isinstance(record, tuple) or len(record) != 3:
            raise ValueError('Invalid PyInstaller TOC entry')
        name, source, kind = record
        if kind not in ('BINARY', 'EXTENSION'):
            continue
        if not isinstance(name, str) or not isinstance(source, str):
            raise ValueError('Invalid native source entry')
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or name in result:
            raise ValueError(f'Unsafe or duplicate native archive path: {name}')
        original = Path(source).resolve(strict=True)
        if not original.is_file():
            raise ValueError(f'Native source is not a regular file: {name}')
        result[name] = original
    if not result:
        raise ValueError('The frozen core contains no inventoried native files')
    return result


def validate_archive_members(toc_sources: dict[str, Path], archive_toc: dict) -> None:
    actual = {name for name, record in archive_toc.items() if record[-1] == 'b'}
    if actual != set(toc_sources):
        raise ValueError('Native payload disagrees with its build TOC: '
                         f'unrecorded={sorted(actual - set(toc_sources))}, absent={sorted(set(toc_sources) - actual)}')


class InstalledOwners:
    def __init__(self) -> None:
        self.wheels: dict[Path, metadata.Distribution] = {}
        self.wheel_hashes: dict[Path, Any] = {}
        for distribution in metadata.distributions():
            for record in distribution.files or ():
                # Resolve only real native files; ordinary metadata files can be
                # very numerous in scientific build environments.
                if not re.search(r'(?:\.so(?:\.[0-9.]+)?|\.dylib|\.pyd|\.dll)$', str(record)):
                    continue
                path = Path(distribution.locate_file(record)).resolve()
                if path in self.wheels and self.wheels[path].metadata['Name'] != distribution.metadata['Name']:
                    raise ValueError(f'Two installed wheels claim {path.name}')
                self.wheels[path] = distribution
                self.wheel_hashes[path] = record.hash
        self.stdlib = Path(sysconfig.get_path('stdlib')).resolve()
        self.python_library: set[Path] = set()
        library = sysconfig.get_config_var('LDLIBRARY')
        for base in (sysconfig.get_config_var('LIBDIR'), sysconfig.get_config_var('PYTHONFRAMEWORKPREFIX')):
            if library and base:
                self.python_library.add((Path(base) / library).resolve())
        self.cache: dict[Path, dict] = {}

    def owner(self, path: Path) -> dict[str, Any]:
        if path in self.wheels:
            distribution = self.wheels[path]
            recorded_hash = self.wheel_hashes[path]
            actual_hash = base64.urlsafe_b64encode(hashlib.sha256(path.read_bytes()).digest()).decode().rstrip('=')
            if recorded_hash is None or recorded_hash.mode != 'sha256' or recorded_hash.value != actual_hash:
                raise ValueError(f'Native file {path.name} differs from its installed wheel RECORD; rebuild/reinstall the reviewed wheel before distribution')
            return {'id': f'wheel:{distribution.metadata["Name"]}@{distribution.version}', 'kind': 'wheel',
                    'name': distribution.metadata['Name'], 'version': distribution.version,
                    'provenance': {'ownership': 'Installed distribution RECORD path',
                                   'projectUrls': distribution.metadata.get_all('Project-URL') or []},
                    'notices': distribution_notices(distribution)}
        # Only the actual interpreter library and extension directory belong to
        # CPython. Third-party libraries elsewhere in its prefix need an owner.
        if path in self.python_library or path.is_relative_to(self.stdlib / 'lib-dynload'):
            license_path = self.stdlib / 'LICENSE.txt'
            return {'id': f'python:{sys.version.split()[0]}', 'kind': 'python', 'name': 'CPython',
                    'version': sys.version.split()[0], 'provenance': {'ownership': 'Running interpreter sysconfig'},
                    'notices': [notice_file(license_path)]}
        for parent in path.parents:
            if (parent / 'INSTALL_RECEIPT.json').is_file() and (parent / '.brew').is_dir():
                if parent not in self.cache:
                    self.cache[parent] = self.homebrew_owner(parent)
                return self.cache[parent]
        owner = self.debian_owner(path)
        if owner:
            return owner
        raise ValueError(f'No verified installed-package ownership and notices for native file {path.name}. '
                         'Build from a package-managed prefix with its original license files; do not infer a license from the filename.')

    @staticmethod
    def homebrew_owner(prefix: Path) -> dict[str, Any]:
        receipt = json.loads((prefix / 'INSTALL_RECEIPT.json').read_text())
        formulae = list((prefix / '.brew').glob('*.rb'))
        if len(formulae) != 1:
            raise ValueError(f'Cannot identify exact Homebrew recipe for {prefix.name}')
        recipe = formulae[0].read_text()
        source_url = re.search(r'^  url "([^"\n]+)"', recipe, re.M)
        source_sha = re.search(r'^  sha256 "([a-f0-9]{64})"', recipe, re.M)
        version = receipt.get('source', {}).get('versions', {}).get('stable')
        if not source_url or not source_sha or not version:
            raise ValueError(f'Homebrew source provenance is incomplete for {formulae[0].stem}')
        notices = [notice_file(file) for file in sorted(prefix.iterdir()) if file.is_file() and NOTICE_NAME.match(file.name)]
        # SQLite deliberately distributes a public-domain dedication in its
        # installed source header instead of an invented LICENSE file.
        if not notices:
            header = prefix / 'include/sqlite3.h'
            if formulae[0].stem != 'sqlite' or not header.is_file():
                raise ValueError(f'Missing original installed license/notice files for {formulae[0].stem}')
            raw = header.read_bytes()
            end = raw.find(b'*************************************************************************')
            if not raw.startswith(b'/*\n') or end < 0 or b'The author disclaims copyright to this source code.' not in raw[:end]:
                raise ValueError('The installed SQLite header has no recognized upstream dedication')
            dedication = raw[:end].decode('utf-8')
            notices = [{'name': 'include/sqlite3.h (original dedication)', 'sha256': sha256(raw[:end]), 'text': dedication}]
        if formulae[0].stem == 'zstd':
            # The installed root BSD license omits the MIT notice in its
            # compiled divsufsort dictionary builder. Bind reviewed additions
            # to the actual upstream source hash, never just the library name.
            root = Path(__file__).resolve().parents[1]
            supplement = json.loads((root / 'distribution/notices/native/supplemental-notices.json').read_text())
            matches = [entry for entry in supplement.get('components', []) if entry.get('name') == 'zstd' and entry.get('upstreamSourceSha256') == source_sha.group(1)]
            if supplement.get('schemaVersion') != 1 or len(matches) != 1:
                raise ValueError('Missing reviewed nested-code copyright notices for this zstd source version')
            entry = matches[0]
            archive = root / entry['sourceArchive']
            if not archive.resolve().is_relative_to(root) or sha256(archive.read_bytes()) != source_sha.group(1):
                raise ValueError('Supplemental native source archive checksum failed')
            for record in entry['notices']:
                path = root / record['path']
                if not path.resolve().is_relative_to(root):
                    raise ValueError('Supplemental notice escaped the source tree')
                actual = notice_file(path, label=record['sourcePath'])
                if actual['sha256'] != record['sha256']:
                    raise ValueError('Supplemental native copyright notice checksum failed')
                notices.append(actual)
        return {'id': f'homebrew:{formulae[0].stem}@{prefix.name}', 'kind': 'homebrew',
                'name': formulae[0].stem, 'version': version,
                'provenance': {'ownership': 'Resolved path in Homebrew keg with INSTALL_RECEIPT.json',
                               'recipeSha256': sha256(formulae[0].read_bytes()),
                               'upstreamSource': source_url.group(1), 'upstreamSourceSha256': source_sha.group(1)},
                'notices': notices}

    @staticmethod
    def debian_owner(path: Path) -> dict[str, Any] | None:
        try:
            found = subprocess.run(['dpkg-query', '-S', str(path)], capture_output=True, text=True, check=False)
        except FileNotFoundError:
            return None
        matches = [line.split(': ', 1)[0] for line in found.stdout.splitlines() if ': ' in line and line.split(': ', 1)[1] == str(path)]
        if found.returncode or len(set(matches)) != 1:
            return None
        package = matches[0]
        info = subprocess.run(['dpkg-query', '-W', '-f=${Version}\n${source:Package}\n${source:Version}', package],
                              capture_output=True, text=True, check=True).stdout.splitlines()
        copyright_path = Path('/usr/share/doc') / package.split(':')[0] / 'copyright'
        if not copyright_path.is_file():
            raise ValueError(f'Debian package {package} has no installed copyright file')
        notices = [notice_file(copyright_path, label=f'{package}/copyright')]
        for common in sorted(set(re.findall(r'/usr/share/common-licenses/([A-Za-z0-9.+_-]+)', notices[0]['text']))):
            common = common.rstrip('.,')
            notices.append(notice_file(Path('/usr/share/common-licenses') / common, label=f'common-licenses/{common}'))
        return {'id': f'debian:{package}@{info[0]}', 'kind': 'debian', 'name': package, 'version': info[0],
                'provenance': {'ownership': 'dpkg-query exact file owner', 'sourcePackage': info[1:3]}, 'notices': notices}


def collect_native_notices(executable: Path, toc: Path) -> tuple[str, dict[str, Any]]:
    from PyInstaller.archive.readers import CArchiveReader
    import PyInstaller

    sources = toc_native_sources(toc)
    archive = CArchiveReader(str(executable))
    validate_archive_members(sources, archive.toc)
    owners = InstalledOwners()
    components: dict[str, dict] = {}
    entries = []
    for name, original in sorted(sources.items()):
        owner = owners.owner(original)
        components[owner['id']] = owner
        content = archive.extract(name)
        if not isinstance(content, bytes) or not content:
            raise ValueError(f'Native payload cannot be extracted: {name}')
        entries.append({'path': name, 'sha256': sha256(content), 'sourceSha256': sha256(original.read_bytes()),
                        'bytes': len(content), 'provider': owner['id']})
    for component in components.values():
        if component['kind'] == 'wheel' and component['name'].lower() == 'lxml':
            from lxml_native_sources import lxml_source_evidence
            extension = next((source for name, source in sources.items() if name.startswith('lxml/etree.') and name.endswith(('.so', '.pyd'))), None)
            if extension is None:
                raise ValueError('Cannot establish lxml static source provenance without its actual etree extension')
            evidence, extra_notices = lxml_source_evidence(Path(__file__).resolve().parents[1], extension, component['version'])
            component['staticSourceEvidence'] = evidence
            component['notices'].extend(extra_notices)
    sections = ['## Native files copied into the frozen core\n\n'
                'This inventory was read from the built executable and matched against its build TOC. '
                'System libraries that remain on the target operating system are not claimed as bundled. '
                'License metadata is not a substitute for the original texts below.']
    for identifier, component in sorted(components.items()):
        sections.append(f'### {component["name"]} {component["version"]}\n\nProvider: `{identifier}`\n\n'
                        + '\n\n'.join(f'#### {notice["name"]}\n\n{notice["text"]}' for notice in component['notices']))
    public_components = [{**{key: value for key, value in component.items() if key != 'notices'},
                          'notices': [{key: value for key, value in notice.items() if key != 'text'} for notice in component['notices']]}
                         for _, component in sorted(components.items())]
    inventory = {'schemaVersion': 1, 'executableSha256': sha256(executable.read_bytes()),
                 'builder': {'name': 'PyInstaller', 'version': PyInstaller.__version__},
                 'nativeFiles': entries, 'components': public_components}
    return '\n\n'.join(sections) + '\n', inventory
