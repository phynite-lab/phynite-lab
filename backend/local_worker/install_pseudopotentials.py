"""Install pinned SSSP PBE libraries from the official Materials Cloud record.

Only cutoff metadata is bundled. UPFs and their original upstream license are
explicit downloads; each family keeps its own license, attribution and source.
"""
from __future__ import annotations

import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile
import time
from typing import Callable
import urllib.error
import urllib.request
from urllib.parse import urlsplit

SOURCE = 'https://archive.materialscloud.org/api/records/rcyfm-68h65/files'
ARCHIVES = {
    'efficiency': ('a58f1b3373f330179fd0832c48bb9a52', 59_513_522),
    'precision': ('fde94756886f32ada7bf597547557eb5', 62_963_841),
}
ARCHIVE_SHA256 = {
    'efficiency': '7a85b71fa3d68df1b5ed33c55c7057681fbf10377ae3b3eac9392924d9189f12',
    'precision': 'd91db6b4b3788501d535a5b84ebabf3859ea3e3ac6ea154c4be3718da50f0c85',
}
LICENSE_SHA256 = '8028d9d7fcad7932bb5551dc0a60cff6c6b7f7aa2bd480f516a2faaa09d943a1'
LICENSE_MD5 = 'c0f9df05fb4cd4921f4caa25606815ef'
METADATA_ROOT = Path(__file__).resolve().parents[2] / 'data/sssp'


def digest(path: Path, algorithm: str = 'md5') -> str:
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, algorithm).hexdigest()


class _OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urlsplit(req.full_url), urlsplit(newurl)
        official_storage = new.hostname == 'rgw.cscs.ch' and new.path.startswith('/mc-archive/')
        if (new.scheme != 'https' or new.username or new.password or new.port not in {None, 443}
                or not (new.netloc == old.netloc or official_storage)):
            raise RuntimeError('SSSP download redirected outside its approved HTTPS origin')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(request):
    from backend.local_api.tls import verified_ssl_context
    opener = urllib.request.build_opener(_OfficialRedirect(), urllib.request.HTTPSHandler(context=verified_ssl_context()))
    return opener.open(request, timeout=30)


def download(name: str, destination: Path, checksum: str, limit: int, *, sha256: str | None = None, progress: Callable[[int], None] | None = None) -> None:
    if destination.is_symlink():
        raise RuntimeError('SSSP download destination cannot be a symbolic link')
    if destination.is_file() and digest(destination) == checksum and (not sha256 or digest(destination, 'sha256') == sha256):
        return
    request = urllib.request.Request(f'{SOURCE}/{name}/content', headers={'User-Agent': 'PhyniteLocalSetup/1.0'})
    temporary = destination.with_suffix(destination.suffix + '.part')
    deadline = time.monotonic() + 600
    try:
        for attempt in range(4):
            try:
                with _open(request) as source, temporary.open('wb') as target:
                    total = 0
                    while chunk := source.read(1024 * 1024):
                        total += len(chunk)
                        if total > limit or time.monotonic() > deadline:
                            raise RuntimeError(f'{name} exceeds its reviewed download size or time budget')
                        target.write(chunk)
                        if progress:
                            progress(total)
                    target.flush(); os.fsync(target.fileno())
                break
            except (urllib.error.URLError, TimeoutError) as exc:
                if isinstance(exc, urllib.error.HTTPError) and exc.code not in {429, 500, 502, 503, 504}:
                    raise
                if attempt == 3 or time.monotonic() > deadline:
                    raise
                time.sleep(2 ** (attempt + 1))
        if digest(temporary) != checksum or (sha256 and digest(temporary, 'sha256') != sha256):
            raise RuntimeError(f'Checksum mismatch for {name}; no library was installed')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def metadata(library: str) -> tuple[Path, dict]:
    if library not in ARCHIVES:
        raise ValueError('Choose the precision or efficiency SSSP PBE library')
    path = METADATA_ROOT / f'SSSP_1.3.0_PBE_{library}.json'
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or not value:
        raise RuntimeError('The bundled SSSP metadata is invalid')
    for record in value.values():
        filename = record.get('filename') if isinstance(record, dict) else None
        if not isinstance(filename, str) or PurePosixPath(filename).name != filename or '\\' in filename:
            raise RuntimeError('The bundled SSSP metadata contains an unsafe filename')
    return path, value


def library_status(root: Path, library: str) -> dict:
    source, records = metadata(library)
    destination = root / f'sssp-pbe-{library}'
    installed = 0
    error = None
    try:
        if root.is_symlink() or destination.is_symlink():
            raise RuntimeError('The pseudopotential directory cannot be a symbolic link')
        for record in records.values():
            path = destination / record['filename']
            if path.is_file() and not path.is_symlink() and digest(path) == record['md5']:
                installed += 1
        local_metadata, license_file = root / source.name, root / 'SSSP-LICENSE.txt'
        ready = installed == len(records) and not local_metadata.is_symlink() and local_metadata.is_file() and local_metadata.read_bytes() == source.read_bytes()
        ready = ready and license_file.is_file() and not license_file.is_symlink() and digest(license_file, 'sha256') == LICENSE_SHA256
        if not ready and installed:
            error = 'The SSSP library is incomplete or its metadata/license could not be verified. Reinstall this library.'
    except (OSError, RuntimeError) as exc:
        ready, error = False, str(exc)
    return {'installed': ready, 'elements': installed, 'totalElements': len(records), 'downloadBytes': ARCHIVES[library][1], **({'error': error} if error else {})}


def _activate_directory(staged: Path, destination: Path) -> None:
    if not destination.exists():
        staged.replace(destination)
        return
    # Exchange whole directories in one filesystem operation. A failed or
    # interrupted replacement leaves the prior verified library reachable.
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        result = libc.renamex_np(os.fsencode(staged), os.fsencode(destination), ctypes.c_uint(2))
    elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
        result = libc.renameat2(-100, os.fsencode(staged), -100, os.fsencode(destination), ctypes.c_uint(2))
    else:
        raise RuntimeError('This platform cannot atomically update an existing SSSP library; the current files were retained')
    if result:
        raise OSError(ctypes.get_errno(), 'Could not atomically activate the SSSP library; previous files were retained')


def install_library(root: Path, library: str, check: bool = False, *, progress: Callable[[dict], None] | None = None) -> int:
    source_metadata, records = metadata(library)
    if check:
        if not library_status(root, library)['installed']:
            raise RuntimeError(f'{library}: library is incomplete; run installation first')
        return len(records)
    root = root.expanduser()
    if root.is_symlink():
        raise RuntimeError('The pseudopotential directory cannot be a symbolic link')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = root / '.install.lock'
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(descriptor, 'a+b') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError('A pseudopotential installation is already running') from exc
        destination = root / f'sssp-pbe-{library}'
        if destination.is_symlink():
            raise RuntimeError('The installed SSSP library cannot be a symbolic link')
        if library_status(root, library)['installed']:
            return len(records)
        def report(state, **values):
            if progress:
                progress({'state': state, **values})
        with tempfile.TemporaryDirectory(prefix='.sssp-install-', dir=root) as temporary:
            staging = Path(temporary)
            archive_path = staging / 'library.tar.gz'
            checksum, size = ARCHIVES[library]
            report('downloading', downloadedBytes=0, totalBytes=size)
            download(f'SSSP_1.3.0_PBE_{library}.tar.gz', archive_path, checksum, size, sha256=ARCHIVE_SHA256[library], progress=lambda amount: report('downloading', downloadedBytes=amount, totalBytes=size))
            license_file = staging / 'SSSP-LICENSE.txt'
            download('LICENSE.txt', license_file, LICENSE_MD5, 10_000, sha256=LICENSE_SHA256)
            files = staging / 'library'; files.mkdir()
            expected = {record['filename']: record['md5'] for record in records.values()}
            seen = set(); total = 0; member_count = 0
            report('verifying', downloadedBytes=size, totalBytes=size)
            with tarfile.open(archive_path, 'r:gz') as archive:
                for member in archive:
                    member_count += 1
                    path = PurePosixPath(member.name)
                    if member_count > 1000 or path.is_absolute() or '..' in path.parts or member.issym() or member.islnk():
                        raise RuntimeError('SSSP archive contains unsafe or excessive entries')
                    name = path.name
                    if name not in expected:
                        continue
                    if not member.isfile() or name in seen or member.size > 30_000_000:
                        raise RuntimeError('SSSP archive contains an invalid or duplicate pseudopotential')
                    seen.add(name); total += member.size
                    if total > 256 * 1024 * 1024:
                        raise RuntimeError('SSSP extraction exceeds its reviewed size budget')
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise RuntimeError(f'Could not read {name}')
                    with extracted, (files / name).open('wb') as output:
                        shutil.copyfileobj(extracted, output)
            for name, checksum in expected.items():
                if not (files / name).is_file() or digest(files / name) != checksum:
                    raise RuntimeError(f'Pseudopotential verification failed for {name}')
            report('installing', downloadedBytes=size, totalBytes=size)
            # Metadata and notices have a pinned version independent of the active
            # directory. Publish these atomically before swapping verified files.
            for name, content in ((source_metadata.name, source_metadata.read_bytes()), ('SSSP-LICENSE.txt', license_file.read_bytes())):
                target = root / name
                if target.is_symlink():
                    raise RuntimeError('SSSP metadata or license cannot be a symbolic link')
                candidate = staging / name; candidate.write_bytes(content); candidate.replace(target)
            _activate_directory(files, destination)
        return len(records)


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
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    main()
