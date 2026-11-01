"""Prepare/rebuild lxml with its LGPL library sources, without global installs.

Run --prepare WORK, modify WORK/libraries/libiconv-VERSION if desired, then run
--build WORK. The original upstream build logic links the supplied local sources.
All archive inputs are verified before extraction. No dependency is downloaded.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tarfile

from lxml_native_sources import verified_sources


def prepare(root: Path, work: Path) -> None:
    document = verified_sources(root)
    if work.exists():
        raise ValueError('Choose a new work directory; existing sources are never overwritten')
    work.mkdir(parents=True)
    for entry in document['archives']:
        destination = work if entry['name'] == 'lxml' else work / 'libraries'
        destination.mkdir(exist_ok=True)
        with tarfile.open(root / entry['path']) as archive:
            archive.extractall(destination, filter='data')
        if not (destination / entry['root']).is_dir():
            raise ValueError('The verified archive does not contain its expected source root')
    entries = {entry['name']: entry for entry in document['archives']}
    source = work / entries['lxml']['root']
    spec = importlib.util.spec_from_file_location('lxml_upstream_patch', source / 'patch_lxml_deplibs.py')
    patcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patcher)
    patcher.apply_patch_file(str(source / 'libxslt-1.1.43-backport1.patch'), str(work / 'libraries' / entries['libxslt']['root']))
    (work / 'source-manifest.json').write_text(json.dumps(document, indent=2) + '\n')
    print(f'Prepared sources in {work}. Modify the library sources if desired, then run --build with this directory.')


def build(root: Path, work: Path) -> None:
    document = verified_sources(root)
    prepared = json.loads((work / 'source-manifest.json').read_text())
    if prepared != document:
        raise ValueError('Prepared source version differs from this build script source set')
    entries = {entry['name']: entry for entry in document['archives']}
    source = work / entries['lxml']['root']
    libraries = {name: work / 'libraries' / entries[name]['root'] for name in ('zlib', 'libiconv', 'libxml2', 'libxslt')}
    if not source.is_dir() or any(not directory.is_dir() for directory in libraries.values()):
        raise ValueError('Prepare complete sources before building')
    # Use the original lxml build functions and patches. Replace its download
    # step with the prepared complete sources, preserving user modifications.
    spec = importlib.util.spec_from_file_location('buildlibxml', source / 'buildlibxml.py')
    upstream = importlib.util.module_from_spec(spec)
    sys.modules['buildlibxml'] = upstream
    spec.loader.exec_module(upstream)
    upstream.download_libs = lambda *args, **kwargs: tuple(str(libraries[name]) for name in ('zlib', 'libiconv', 'libxml2', 'libxslt'))
    # Upstream caches archives by their source-directory mtime. Mark prepared
    # sources current and force extension linking so edits inside a source file
    # cannot silently reuse a previous unmodified static library or extension.
    for directory in libraries.values():
        os.utime(directory, None)
    sys.path.insert(0, str(source))
    os.chdir(source)
    sys.argv = ['setup.py', 'build_ext', '--inplace', '--force', '--static-deps', '--without-cython']
    for name, version in document['versions'].items():
        if name != 'lxml':
            os.environ[name.upper() + '_VERSION'] = version
    runpy.run_path(str(source / 'setup.py'), run_name='__main__')
    environment = {key: value for key, value in os.environ.items() if key not in {'STATIC_DEPS', 'STATICBUILD'}}
    subprocess.run([sys.executable, 'setup.py', 'bdist_wheel', '--skip-build', '--dist-dir', str(work / 'wheels')],
                   cwd=source, env=environment, check=True)
    print(f'Rebuilt lxml wheel: {work / "wheels"}. Install into an isolated core build environment, then rebuild phynite-core.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare', type=Path)
    mode.add_argument('--build', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        if args.prepare:
            prepare(root, args.prepare.resolve())
        else:
            build(root, args.build.resolve())
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
