"""Install the pinned SSSP PBE libraries from the official Materials Cloud record."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
import tempfile
import urllib.request
import urllib.error
import time
from pathlib import Path
from worker import worker_ssl_context

SOURCE = 'https://archive.materialscloud.org/api/records/rcyfm-68h65/files'
ARCHIVES = {
    'efficiency': ('a58f1b3373f330179fd0832c48bb9a52', 59_513_522),
    'precision': ('fde94756886f32ada7bf597547557eb5', 62_963_841),
}


def digest(path: Path) -> str:
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'md5').hexdigest()


def download(name: str, destination: Path, checksum: str, limit: int) -> None:
    if destination.is_file() and digest(destination) == checksum:
        return
    request = urllib.request.Request(f'{SOURCE}/{name}/content', headers={'User-Agent': 'PhyniteLocalSetup/1.0'})
    temporary = destination.with_suffix(destination.suffix + '.part')
    try:
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, context=worker_ssl_context(), timeout=120) as source, temporary.open('wb') as target:
                    total = 0
                    while chunk := source.read(1024 * 1024):
                        total += len(chunk)
                        if total > limit:
                            raise RuntimeError(f'{name} exceeds the verified release size')
                        target.write(chunk)
                break
            except (urllib.error.URLError, TimeoutError) as exc:
                if isinstance(exc, urllib.error.HTTPError) and exc.code not in {429, 500, 502, 503, 504}:
                    raise
                if attempt == 3:
                    raise
                time.sleep(2 ** (attempt + 1))
        if digest(temporary) != checksum:
            raise RuntimeError(f'Checksum mismatch for {name}; no library was installed')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def install_library(root: Path, library: str, check: bool = False) -> int:
    metadata_name = f'SSSP_1.3.0_PBE_{library}.json'
    metadata_file = Path(__file__).resolve().parents[2] / 'data/sssp' / metadata_name
    metadata = json.loads(metadata_file.read_text())
    destination = root / f'sssp-pbe-{library}'
    missing = [record for record in metadata.values() if not (destination / record['filename']).is_file()
               or digest(destination / record['filename']) != record['md5']]
    if check:
        if missing or not (root / metadata_name).is_file():
            raise RuntimeError(f'{library}: library is incomplete; run installation first')
        return len(metadata)
    root.mkdir(parents=True, exist_ok=True)
    if missing:
        name = f'SSSP_1.3.0_PBE_{library}.tar.gz'
        checksum, size = ARCHIVES[library]
        archive_path = root / name
        print(f'Installing SSSP 1.3.0 PBE {library} ({size / 1_000_000:.1f} MB download if not cached)...')
        download(name, archive_path, checksum, size)
        expected = {record['filename']: record['md5'] for record in metadata.values()}
        with tempfile.TemporaryDirectory(dir=root) as temporary:
            staging = Path(temporary)
            with tarfile.open(archive_path, 'r:gz') as archive:
                for member in archive:
                    name = Path(member.name).name
                    if name not in expected or not member.isfile():
                        continue
                    if member.size > 30_000_000:
                        raise RuntimeError('Unexpectedly large pseudopotential file')
                    source = archive.extractfile(member)
                    if source is None:
                        raise RuntimeError(f'Could not read {name}')
                    with source, (staging / name).open('wb') as target:
                        shutil.copyfileobj(source, target)
            for name, checksum in expected.items():
                if not (staging / name).is_file() or digest(staging / name) != checksum:
                    raise RuntimeError(f'Pseudopotential verification failed for {name}')
            destination.mkdir(exist_ok=True)
            for path in staging.iterdir():
                path.replace(destination / path.name)
        archive_path.unlink()
    shutil.copyfile(metadata_file, root / metadata_name)
    download('LICENSE.txt', root / 'SSSP-LICENSE.txt', 'c0f9df05fb4cd4921f4caa25606815ef', 10_000)
    return len(metadata)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', choices=['efficiency', 'precision', 'both'], default='both')
    parser.add_argument('--pseudo-root', type=Path, default=Path(__file__).resolve().parents[1] / '.artifacts/pseudos')
    parser.add_argument('--check', action='store_true', help='Verify installed files without downloading or writing')
    args = parser.parse_args()
    try:
        for library in ARCHIVES if args.library == 'both' else [args.library]:
            count = install_library(args.pseudo_root.expanduser(), library, args.check)
            print(f'{library}: {count} elements verified.')
    except (OSError, ValueError, RuntimeError, tarfile.TarError) as error:
        parser.exit(1, f'SSSP setup failed: {error}\n')


if __name__ == '__main__':
    main()
