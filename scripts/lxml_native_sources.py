"""Verify source evidence for the exact lxml static dependency versions in a core."""
from __future__ import annotations

import ctypes
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile
from typing import Any


MANIFEST = 'distribution/notices/native/lxml-static-sources.json'


def verified_sources(root: Path) -> dict[str, Any]:
    document = json.loads((root / MANIFEST).read_text())
    if document.get('schemaVersion') != 1 or document.get('component') != 'lxml':
        raise ValueError('Unsupported lxml native source evidence manifest')
    archives = document.get('archives')
    if not isinstance(archives, list) or {entry.get('name') for entry in archives} != {'lxml', 'libiconv', 'libxml2', 'libxslt', 'zlib'} or len(archives) != 5:
        raise ValueError('The complete lxml static dependency source set is required')
    for entry in archives:
        relative = PurePosixPath(entry['path'])
        if relative.is_absolute() or '..' in relative.parts or not str(relative).startswith('distribution/sources/native/'):
            raise ValueError('Unsafe native source archive path')
        path = root / relative
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or path.stat().st_size != entry['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError(f'Native corresponding source checksum/size failed for {entry["name"]}')
        if entry['version'] != document.get('versions', {}).get(entry['name']):
            raise ValueError('Native source versions disagree')
    if document.get('version') != document['versions'].get('lxml'):
        raise ValueError('lxml source version is inconsistent')
    return document


def lxml_source_evidence(root: Path, extension: Path, installed_version: str) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Probe installed native code; a generic wheel license claim is insufficient."""
    from lxml import etree

    if Path(etree.__file__).resolve() != extension.resolve():
        raise ValueError('lxml runtime probe does not match the native payload source')
    document = verified_sources(root)
    library = ctypes.CDLL(str(extension))
    try:
        iconv_number = ctypes.c_int.in_dll(library, '_libiconv_version').value
    except ValueError as error:
        raise ValueError('Cannot establish GNU libiconv linkage/version in this lxml native build. '
                         'Review its real native dependency route and provide matching source evidence before distribution.') from error
    versions = {'lxml': installed_version, 'libiconv': f'{iconv_number >> 8}.{iconv_number & 255}',
                'libxml2': '.'.join(map(str, etree.LIBXML_COMPILED_VERSION)),
                'libxslt': '.'.join(map(str, etree.LIBXSLT_COMPILED_VERSION))}
    if any(document['versions'].get(name) != version for name, version in versions.items()):
        raise ValueError(f'Actual lxml native versions {versions} do not match the supplied corresponding source. '
                         'Review and supply the exact new sources before distribution.')
    # The zlib version is pinned by the original wheel recipe and its source
    # hash; unlike iconv/libxml/libxslt, lxml does not expose a compiled-zlib
    # runtime attribute. Do not describe that recipe value as a runtime probe.
    iconv = next(entry for entry in document['archives'] if entry['name'] == 'libiconv')
    texts = []
    with tarfile.open(root / iconv['path']) as archive:
        for name in ('COPYING.LIB', 'AUTHORS', 'libcharset/COPYING.LIB', 'libcharset/AUTHORS'):
            member_name = f'{iconv["root"]}/{name}'
            source = archive.extractfile(member_name)
            if source is None:
                raise ValueError(f'Missing native upstream license source: {member_name}')
            content = source.read()
            texts.append({'name': member_name, 'sha256': hashlib.sha256(content).hexdigest(), 'text': content.decode('utf-8')})
    evidence = {'manifest': MANIFEST, 'manifestSha256': hashlib.sha256((root / MANIFEST).read_bytes()).hexdigest(),
                'probedVersions': versions, 'recipeVersions': document['versions'],
                'archives': [{key: entry[key] for key in ('name', 'version', 'path', 'sha256', 'bytes')} for entry in document['archives']],
                'rebuildScript': 'scripts/rebuild-lxml-native.py',
                'qualification': 'Matching sources and original build scripts supplied; native relink testing remains a separate release gate.'}
    return evidence, texts
