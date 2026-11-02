"""Explicit, offline-by-default SSSP setup for a local workspace."""
from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any

from backend.local_worker.install_pseudopotentials import ARCHIVES, LICENSE_SHA256, digest, install_library, library_status, metadata


class PseudopotentialManager:
    def __init__(self, data_dir: Path):
        self.root = Path(data_dir) / 'pseudopotentials'
        self._mutex = threading.Lock()
        self._progress: dict[str, Any] = {'state': 'idle', 'library': None, 'downloadedBytes': 0}
        self._cache: dict[str, tuple[list, dict]] = {}

    def status(self) -> dict:
        libraries = {}
        for library in ARCHIVES:
            try:
                source, records = metadata(library)
            except (OSError, ValueError, RuntimeError):
                libraries[library] = {'installed': False, 'elements': 0, 'totalElements': 0, 'downloadBytes': ARCHIVES[library][1],
                                      'error': 'The installed application is missing its approved SSSP metadata. Reinstall Phynite Lab to restore setup.'}
                continue
            paths = [source, self.root, self.root / source.name, self.root / 'SSSP-LICENSE.txt', self.root / f'sssp-pbe-{library}']
            paths.extend(self.root / f'sssp-pbe-{library}' / record['filename'] for record in records.values())
            stamps = []
            for path in paths:
                try:
                    stat = path.lstat()
                    stamps.append((stat.st_mode, stat.st_size, stat.st_mtime_ns, stat.st_ino))
                except OSError:
                    stamps.append(None)
            cached = self._cache.get(library)
            if not cached or cached[0] != stamps:
                cached = (stamps, library_status(self.root, library))
                self._cache[library] = cached
            libraries[library] = cached[1]
        return {'version': '1.3.0', 'source': 'https://archive.materialscloud.org/records/rcyfm-68h65',
                'license': 'Mixed upstream licenses; see SSSP-LICENSE.txt', 'libraries': libraries, 'progress': dict(self._progress)}

    def begin(self, library: str) -> bool:
        if library not in ARCHIVES:
            raise ValueError('Choose the precision or efficiency SSSP PBE library')
        if not self._mutex.acquire(blocking=False):
            return False
        self._progress = {'state': 'downloading', 'library': library, 'downloadedBytes': 0, 'totalBytes': ARCHIVES[library][1]}
        def install():
            try:
                install_library(self.root, library, progress=lambda update: self._set_progress(library, update))
                self._set_progress(library, {'state': 'complete', 'downloadedBytes': ARCHIVES[library][1]})
            except Exception as exc:
                self._set_progress(library, {'state': 'failed', 'error': str(exc)[:1500]})
            finally:
                self._cache.clear()
                self._mutex.release()
        threading.Thread(target=install, daemon=True).start()
        return True

    def _set_progress(self, library: str, update: dict) -> None:
        self._progress = {**self._progress, **update, 'library': library}


def execution_pseudopotential_error(data_dir: Path, execution: dict) -> str | None:
    """Check only the model actually referenced by generated/manual QE input."""
    uploads = execution.get('pseudopotentials') or {}
    files = execution.get('inputFiles') or {}
    contents = [execution.get('qeInput', ''), *files.values()] if isinstance(files, dict) else [execution.get('qeInput', '')]
    requirements = set()
    for content in contents:
        if not isinstance(content, str):
            continue
        active = False
        for raw in content.splitlines():
            line = raw.split('!', 1)[0].strip()
            if line.upper().startswith('ATOMIC_SPECIES'):
                active = True
                continue
            if not active or not line:
                continue
            parts = line.split()
            if len(parts) < 3 or not re.fullmatch(r'[A-Z][a-z]?[A-Za-z0-9_]*', parts[0]):
                active = False
                continue
            requirements.add((parts[0], parts[2]))
    root = Path(data_dir) / 'pseudopotentials'
    cached = {}
    for label, requested in sorted(requirements):
        if isinstance(uploads, dict) and uploads.get(requested):
            continue  # Existing submission validation enforces owned uploaded keys.
        family = next((name for name in ARCHIVES if f'.sssp-{name}.' in requested.lower()), None)
        if not family:
            continue  # Custom/other libraries keep their existing explicit validation.
        if family not in cached:
            source, records = metadata(family)
            local_metadata, license_file = root / source.name, root / 'SSSP-LICENSE.txt'
            try:
                ready = (not root.is_symlink() and not local_metadata.is_symlink() and local_metadata.is_file()
                         and local_metadata.read_bytes() == source.read_bytes() and license_file.is_file() and not license_file.is_symlink()
                         and digest(license_file, 'sha256') == LICENSE_SHA256)
            except OSError:
                ready = False
            cached[family] = (ready, records)
        ready, records = cached[family]
        element = re.match(r'[A-Z][a-z]?', label)
        record = records.get(element.group() if element else '')
        if not record:
            return f'SSSP PBE {family.title()} has no pseudopotential for {label}. Choose an explicit compatible UPF for this species.'
        path = root / f'sssp-pbe-{family}' / record['filename']
        if not ready or path.parent.is_symlink() or path.is_symlink() or not path.is_file():
            return f'Install the selected SSSP PBE {family.title()} pseudopotentials for this workspace in Settings > Compute (/local#pseudopotentials), or upload the exact UPF files. The selected physical model is unchanged.'
        if digest(path) != record['md5']:
            return f'The selected SSSP PBE {family.title()} pseudopotential for {label} failed checksum verification. Reinstall this library in Settings > Compute (/local#pseudopotentials).'
    return None
