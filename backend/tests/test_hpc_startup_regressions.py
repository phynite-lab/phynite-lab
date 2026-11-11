"""Local shell regressions for remote HPC startup; no scheduler or SSH required."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from backend.local_worker.hpc_remote import HpcRemoteJobManager


class HpcStartupShellRegressions(unittest.TestCase):
    def executable(self, path: Path, body: str) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#!/bin/sh\n' + body, encoding='utf-8')
        path.chmod(0o755)
        return path

    def environment(self, home: Path, search_path: str) -> dict[str, str]:
        environment = dict(os.environ)
        for key in ('BASH_ENV', 'ENV', 'PHYNITE_PYTHON', 'PYTHONHOME', 'PYTHONPATH'):
            environment.pop(key, None)
        for key in list(environment):
            if key.startswith('BASH_FUNC_'):
                environment.pop(key)
        environment.update(HOME=str(home), PATH=search_path)
        return environment

    def python_wrapper(self, path: Path, invocations: Path) -> Path:
        return self.executable(path,
            'printf \'%s\\n\' "$*" >> ' + shlex.quote(str(invocations)) + '\n'
            'if [ "$1" = -c ]; then exit 0; fi\n'
            'exec ' + shlex.quote(sys.executable) + ' "$@"\n')

    def test_auto_python_preserves_module_solver_and_mpi_executables(self):
        with tempfile.TemporaryDirectory(prefix='phynite-hpc-startup-') as directory:
            root = Path(directory)
            module_bin, scientific_bin, runners = (root / item for item in ('module-bin', 'scientific-env/bin', 'runners'))
            runners.mkdir()
            # The login module's Python is inadequate; its QE and MPI are qualified.
            self.executable(module_bin / 'python3', 'exit 1\n')
            for name in ('mpirun', 'pw.x'):
                self.executable(module_bin / name, "printf '%s\\n' 'qualified " + name + "'\n")
                self.executable(scientific_bin / name, "printf '%s\\n' 'WRONG SCIENTIFIC ENVIRONMENT " + name + "'\nexit 42\n")
            invocations = root / 'python-invocations.txt'
            candidate = self.python_wrapper(scientific_bin / 'python3', invocations)
            observed = root / 'observed-executables.json'
            (runners / 'local_runner.py').write_text(
                'import json, os, shutil, subprocess\n'
                'from pathlib import Path\n'
                'executables = {name: shutil.which(name) for name in ("mpirun", "pw.x")}\n'
                'Path(' + repr(str(observed)) + ').write_text(json.dumps(executables))\n'
                'for name in executables:\n'
                '    subprocess.run([name], check=True)\n', encoding='utf-8')
            (runners / 'hpc_manifest.py').write_text('', encoding='utf-8')
            profile = {'scheduler': 'slurm', 'runtime': {'mpiLauncher': ['mpirun', '-np', '{ranks}']}}
            with patch('backend.local_worker.hpc_remote.PYTHON_CANDIDATE_GLOBS', (str(candidate),)):
                script = HpcRemoteJobManager(MagicMock(), profile).render_remote_script('calc-auto-python', str(root))
            completed = subprocess.run(['/bin/bash', '-c', script], cwd=root,
                env=self.environment(root, str(module_bin) + os.pathsep + os.defpath),
                capture_output=True, text=True, timeout=10)
            runner_output = (root / 'runner.out').read_text() if (root / 'runner.out').is_file() else ''
            self.assertEqual(completed.returncode, 0, completed.stderr + runner_output)
            self.assertEqual(json.loads(observed.read_text()), {name: str(module_bin / name) for name in ('mpirun', 'pw.x')})
            calls = invocations.read_text().splitlines()
            self.assertIn('runners/local_runner.py', calls)
            self.assertIn('runners/hpc_manifest.py', calls)
            self.assertIn('qualified mpirun', runner_output)
            self.assertIn('qualified pw.x', runner_output)

    def test_batch_initializes_login_only_module_function(self):
        with tempfile.TemporaryDirectory(prefix='phynite-hpc-login-') as directory:
            root = Path(directory)
            runners = root / 'runners'
            runners.mkdir()
            invocations, loaded, ran = (root / name for name in ('python-invocations.txt', 'module-loaded.txt', 'runner-started.txt'))
            python = self.python_wrapper(root / 'science/bin/python3', invocations)
            # The module function is defined by login initialization and is deliberately
            # not exported to child shells. This mirrors sites using profile.d/Lmod.
            (root / '.bash_profile').write_text(
                'module() {\n'
                '  if [ "$1" != load ] || [ "$2" != qe/fixture ]; then return 1; fi\n'
                '  printf \'%s\\n\' "$2" > ' + shlex.quote(str(loaded)) + '\n'
                '}\n', encoding='utf-8')
            (runners / 'local_runner.py').write_text('from pathlib import Path\nPath(' + repr(str(ran)) + ').write_text("ran")\n', encoding='utf-8')
            (runners / 'hpc_manifest.py').write_text('', encoding='utf-8')
            profile = {'scheduler': 'slurm', 'runtime': {'mpiLauncher': ['mpirun', '-np', '{ranks}'],
                'pythonExecutable': str(python), 'environmentModules': ['qe/fixture']}}
            script = HpcRemoteJobManager(MagicMock(), profile).render_remote_script('calc-login-modules', str(root))
            script_path = root / 'submit.sh'
            script_path.write_text(script, encoding='utf-8')
            script_path.chmod(0o755)
            # Execute through its shebang, as sbatch does, so login flags matter.
            completed = subprocess.run([str(script_path)], cwd=root,
                env=self.environment(root, os.defpath), capture_output=True, text=True, timeout=10)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(loaded.read_text().strip(), 'qe/fixture')
            self.assertEqual(ran.read_text(), 'ran')
            self.assertIn('runners/local_runner.py', invocations.read_text().splitlines())


from backend.local_api.hpc_profiles import ApiError, validate_profile
from backend.local_worker.hpc import HpcError, launcher_template

class LauncherContractTests(unittest.TestCase):
    def profile(self, launcher):
        return {'id': 'cluster-a', 'name': 'Cluster', 'scheduler': 'slurm',
                'connection': {'host': 'login.example', 'username': 'researcher', 'authKind': 'agent'},
                'storage': {'scratchRoot': '/scratch/researcher'},
                'runtime': {'mpiLauncher': launcher}}

    def test_rejects_before_remote_script_submission(self):
        for launcher in (['mpirun', '--np={ranks}'], ['mpiexec', '-n{ranks}'],
                         ['mpirun', '--oversubscribe', '-np', '{ranks}'],
                         ['mpirun', '--oversubscribe=yes', '-np', '{ranks}'],
                         ['srun', '--ntasks={ranks}', '\x7f']):
            with self.subTest(launcher=launcher):
                with self.assertRaises(ApiError):
                    validate_profile(self.profile(launcher), 'owner-a')
                with self.assertRaises(HpcError):
                    launcher_template(launcher)
                with self.assertRaises(HpcError):
                    HpcRemoteJobManager(MagicMock(), self.profile(launcher)).render_remote_script('calc-a', '/scratch/calc-a')

    def test_supported_launchers_keep_the_exact_user_arguments(self):
        for launcher in (['mpirun', '-np', '{ranks}'], ['mpiexec', '-n', '{ranks}'],
                         ['srun', '--mpi=pmi2', '--ntasks={ranks}'], ['/opt/site/bin/mpirun', '-np', '{ranks}']):
            with self.subTest(launcher=launcher):
                self.assertEqual(validate_profile(self.profile(launcher), 'owner-a')['runtime']['mpiLauncher'], launcher)
                self.assertEqual(launcher_template(launcher), launcher)
                self.assertIn('PHYNITE_MPI_LAUNCHER=', HpcRemoteJobManager(MagicMock(), self.profile(launcher)).render_remote_script('calc-a', '/scratch/calc-a'))

if __name__ == '__main__':
    unittest.main()
