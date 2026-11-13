"""Explicit isolated MACE install; no imports of scientific libraries in the desktop core."""
from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import urllib.request

from .runtime import RuntimeInstallError, runtime_platform
from .sandbox import NativeSandbox
from .tls import verified_ssl_context
from backend.mlip.contract import MODEL, checksum, file_sha

SOURCES = Path(__file__).resolve().parents[1] / 'mlip'
MIN_FREE = 4 * 1024**3


class MlipRuntime:
    def __init__(self, data_dir: Path, base_runtime):
        self.root = Path(data_dir) / 'mlip'; self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.root.is_symlink(): raise RuntimeInstallError('MLIP runtime directory must not be a symlink.')
        self.base = base_runtime; self.lock = threading.Lock(); self.progress = {'state': 'idle'}
        self.sandbox = NativeSandbox(Path(data_dir), (SOURCES, self.root, Path(data_dir) / 'runtimes'))

    def binding(self) -> dict:
        target = runtime_platform()
        lock = SOURCES / f'requirements-{target}.lock'
        if not lock.is_file(): raise RuntimeInstallError('No reviewed MLIP package lock exists for this platform; it remains disabled.')
        build = SOURCES / 'build.lock'
        return {'platform': target, 'model': MODEL, 'requirementsSha256': file_sha(lock), 'buildLockSha256': file_sha(build), 'sourceSha256': checksum({name: file_sha(SOURCES / name) for name in ('contract.py', 'runner.py', 'qualify.py')})}

    def active(self) -> tuple[Path, dict]:
        binding = self.binding()
        pointer = json.loads((self.root / 'active.json').read_text())
        identifier = pointer['directory']
        if not isinstance(identifier, str) or not identifier.isalnum(): raise RuntimeInstallError('Invalid MLIP runtime identity.')
        release = self.root / identifier
        if release.is_symlink() or not release.resolve().is_relative_to(self.root.resolve()): raise RuntimeInstallError('Unsafe MLIP runtime path.')
        report = json.loads((release / 'qualification.json').read_text())
        if pointer['binding'] != binding or file_sha(release / 'model.model') != MODEL['sha256'] or file_sha(release / 'qualification.json') != pointer['qualificationSha256'] or report.get('passed') is not True or not all(report.get('checks', {}).get(key) is True for key in ('finiteDifference', 'periodicity', 'fixedCellRelaxation', 'cancellation')):
            raise RuntimeInstallError('MLIP qualification/model/lock changed; run the explicit installer again.')
        if file_sha(Path(pointer['basePython'])) != pointer['basePythonSha256']:
            raise RuntimeInstallError('The approved base Python changed; qualify MLIP again.')
        return release, pointer

    def approval_binding(self) -> dict:
        _, pointer = self.active()
        return {key: pointer[key] for key in ('binding', 'qualificationSha256', 'basePythonSha256')}

    def status(self) -> dict:
        result = {'model': MODEL, 'progress': self.progress, 'ready': False, 'requiredFreeBytes': MIN_FREE, 'freeBytes': shutil.disk_usage(self.root).free, 'supportedPlatform': (SOURCES / f'requirements-{runtime_platform()}.lock').is_file()}
        try:
            _, pointer = self.active()
            result.update(ready=True, qualificationSha256=pointer['qualificationSha256'], binding=pointer['binding'])
        except (ValueError, KeyError, OSError, RuntimeInstallError) as error:
            result['reason'] = str(error) if not isinstance(error, FileNotFoundError) else 'Install and qualify the separate MACE runtime explicitly.'
        return result

    def environment(self, job: Path) -> dict:
        return {'PATH': os.defpath, 'HOME': str(job), 'TMPDIR': str(job / '.tmp'), 'PYTHONNOUSERSITE': '1', 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1', 'MPLCONFIGDIR': str(job / '.mpl')}

    def run(self, release: Path, argv: list[str], *, timeout=300):
        command = self.sandbox.command(release, argv)
        with (release / 'installation.log').open('a') as log:
            subprocess.run(command, cwd=release, env=self.environment(release), stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, check=True, timeout=timeout)

    def install(self):
        if not self.lock.acquire(blocking=False): raise RuntimeInstallError('An MLIP installation is already active.')
        try:
            binding = self.binding()
            if shutil.disk_usage(self.root).free < MIN_FREE: raise RuntimeInstallError('MLIP installation needs at least 4 GiB free; no packages were downloaded.')
            base_python = (self.base.environment() if self.base else {}).get('PHYNITE_RUNTIME_PYTHON_DFT')
            if not base_python: raise RuntimeInstallError('Install the reviewed DFT Python runtime first; MLIP uses a separate isolated environment.')
            # Bootstrap uses only an already approved bundled Python, never a global interpreter.
            base_python = str(Path(base_python).resolve())
            self.progress = {'state': 'installing'}
            import secrets
            release = self.root / secrets.token_hex(16); release.mkdir(mode=0o700)
            self.run(release, [base_python, '-I', '-c', 'import sys; assert sys.version_info[:2] == (3, 12), "The MLIP lock requires CPython 3.12"'])
            self.run(release, [base_python, '-I', '-m', 'venv', '--copies', str(release / 'env')])
            python = release / 'env/bin/python'
            wheels = release / 'packages'; wheels.mkdir()
            # Downloads happen only in this explicit setup action. Every package is exact/hash locked.
            # No source builds during download; reviewed sdist metadata is obtained by pip from its locked source.
            for lock in (SOURCES / 'build.lock', SOURCES / f"requirements-{binding['platform']}.lock"):
                command = [str(python), '-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'download', '--no-cache-dir', '--no-deps', '--no-build-isolation', '--require-hashes', '-r', str(lock), '-d', str(wheels)]
                with (release / 'download.log').open('a') as log:
                    subprocess.run(command, cwd=release, env=self.environment(release), stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600)
                self.run(release, [str(python), '-I', '-m', 'pip', '--isolated', 'install', '--no-index', '--find-links', str(wheels), '--no-deps', '--no-build-isolation', '--require-hashes', '-r', str(lock)], timeout=600)
                shutil.copy(lock, release / lock.name)
            # Only fixed official asset URL, never a user-selected model or a foundation-model downloader.
            with urllib.request.urlopen(MODEL['url'], context=verified_ssl_context(), timeout=60) as source, (release / 'model.model').open('xb') as output:
                count = 0
                while block := source.read(1024*1024):
                    count += len(block)
                    if count > MODEL['sizeBytes']: raise RuntimeInstallError('Official model download exceeds its pinned size.')
                    output.write(block)
            if count != MODEL['sizeBytes'] or file_sha(release / 'model.model') != MODEL['sha256']: raise RuntimeInstallError('Official MACE model checksum failed; model was not loaded.')
            shutil.copy(SOURCES / 'MODEL-LICENSE.txt', release / 'MODEL-LICENSE.txt')
            self.run(release, [str(python), '-I', str(SOURCES / 'qualify.py'), str(release / 'model.model'), str(release / 'qualification.json')], timeout=600)
            report = json.loads((release / 'qualification.json').read_text())
            if report.get('passed') is not True: raise RuntimeInstallError('Real MLIP qualification did not pass.')
            self.run(release, [str(python), '-I', '-m', 'pip', 'check'])
            inventory = {'directory': release.name, 'binding': binding, 'basePython': base_python, 'basePythonSha256': file_sha(Path(base_python)), 'qualificationSha256': file_sha(release / 'qualification.json')}
            # Preserve every installed dependency's exact metadata and license files in its immutable environment.
            (release / 'inventory.json').write_text(json.dumps(inventory, sort_keys=True))
            pending = self.root / 'active.pending'; pending.write_text(json.dumps(inventory)); os.replace(pending, self.root / 'active.json')
            self.progress = {'state': 'qualified'}
        except Exception as error:
            self.progress = {'state': 'failed', 'error': f'{type(error).__name__}: {error}'}
            raise
        finally: self.lock.release()
