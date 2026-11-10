"""Unit tests for remote HPC SSH connection, scheduler script generation, and sparse harvesting."""
import unittest
import tempfile
import json
import shutil
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.local_worker.hpc_ssh import HpcSshConnection, HpcSshError
from backend.local_worker.hpc_remote import (
    HpcRemoteJobManager,
    is_sparse_harvest_target,
)


class TestHpcSshConnection(unittest.TestCase):
    def test_valid_connection_initialization(self):
        conn = HpcSshConnection(
            host="login2.hpc.brin.go.id",
            username="user",
            port=22,
        )
        self.assertEqual(conn.host, "login2.hpc.brin.go.id")
        self.assertEqual(conn.username, "user")
        self.assertEqual(conn.port, 22)
        self.assertEqual(conn.target, "user@login2.hpc.brin.go.id")
        self.assertTrue(str(conn.socket_path).endswith(".sock"))

    def test_bastion_proxyjump_args(self):
        conn = HpcSshConnection(
            host="internal-node.cluster.local",
            username="user",
            port=22,
            bastion_host="bastion.univ.ac.id",
            bastion_port=2222,
            bastion_user="jump",
        )
        args = conn._base_ssh_args()
        self.assertIn("-o", args)
        self.assertIn("ProxyJump=jump@bastion.univ.ac.id:2222", args)

    def test_invalid_connection_inputs_rejected(self):
        with self.assertRaises(HpcSshError):
            HpcSshConnection(host="invalid host with spaces", username="user")
        with self.assertRaises(HpcSshError):
            HpcSshConnection(host="login.hpc", username="user\ninjection")
        with self.assertRaises(HpcSshError):
            HpcSshConnection(host="login.hpc", username="user", port=70000)


class TestSparseHarvesting(unittest.TestCase):
    def test_scalar_and_log_files_are_harvested(self):
        self.assertTrue(is_sparse_harvest_target("relax.xml"))
        self.assertTrue(is_sparse_harvest_target("pw.out"))
        self.assertTrue(is_sparse_harvest_target("total-energy.dat"))
        self.assertTrue(is_sparse_harvest_target("results.json"))
        self.assertTrue(is_sparse_harvest_target("band_structure.png"))
        self.assertTrue(is_sparse_harvest_target("data-file-schema.xml"))

    def test_large_wavefunction_files_skipped_by_default(self):
        self.assertFalse(is_sparse_harvest_target("wfc1.dat", retain_wavefunctions=False))
        self.assertFalse(is_sparse_harvest_target("wfc.dat", retain_wavefunctions=False))
        self.assertFalse(is_sparse_harvest_target("charge-density.dat", retain_wavefunctions=False))

    def test_wavefunctions_harvested_when_explicitly_retained(self):
        self.assertTrue(is_sparse_harvest_target("wfc1.dat", retain_wavefunctions=True))


class TestHpcRemoteJobManager(unittest.TestCase):
    def setUp(self):
        self.mock_conn = MagicMock(spec=HpcSshConnection)
        self.slurm_profile = {
            "id": "cl-slurm-test",
            "ownerId": "usr-123",
            "scheduler": "slurm",
            "storage": {"scratchRoot": "/scratch/users/user"},
            "runtime": {
                "environmentModules": ["module load qe/7.2"],
                "mpiLauncher": ["srun", "--mpi=pmix", "--ntasks={ranks}"],
            },
            "defaults": {
                "nodes": 2,
                "ranksPerNode": 16,
                "wallSeconds": 7200,
                "memoryMiBPerNode": 32768,
                "queue": "standard",
                "account": "proj_mat",
            },
        }

    def test_slurm_script_rendering(self):
        mgr = HpcRemoteJobManager(self.mock_conn, self.slurm_profile)
        script = mgr.render_remote_script("calc-abc-123", "/scratch/users/user/usr-123/calc-abc-123")
        self.assertIn("#SBATCH --nodes=2", script)
        self.assertIn("#SBATCH --ntasks=32", script)
        self.assertIn("#SBATCH --time=02:00:00", script)
        self.assertIn("#SBATCH --partition=standard", script)
        self.assertIn("#SBATCH --account=proj_mat", script)
        self.assertIn("module load qe/7.2", script)
        self.assertIn("python3 runners/local_runner.py", script)
        self.assertIn('export PHYNITE_MPI_LAUNCHER=\'["srun", "--mpi=pmix", "--ntasks={ranks}"]\'', script)
        self.assertIn("python3 runners/hpc_manifest.py", script)

    def test_pbs_script_rendering(self):
        pbs_profile = {
            **self.slurm_profile,
            "scheduler": "pbs",
            "runtime": {
                "environmentModules": ["module load intel-mpi"],
                "mpiLauncher": ["mpiexec", "-n", "{ranks}"],
            },
        }
        mgr = HpcRemoteJobManager(self.mock_conn, pbs_profile)
        script = mgr.render_remote_script("calc-pbs-456", "/scratch/work")
        self.assertIn("#PBS -l select=2:ncpus=16:mpiprocs=16:ompthreads=1:mem=32768mb", script)
        self.assertIn("#PBS -l walltime=02:00:00", script)
        self.assertIn("#PBS -q standard", script)
        self.assertIn('export PHYNITE_MPI_LAUNCHER=\'["mpiexec", "-n", "{ranks}"]\'', script)
        self.assertIn("export PHYNITE_HPC_SCHEDULER=pbs", script)

    def test_poll_job_slurm_parsing(self):
        self.mock_conn.run_command.return_value = (
            0,
            "123456|COMPLETED|0:0\n",
            "",
        )
        mgr = HpcRemoteJobManager(self.mock_conn, self.slurm_profile)
        status = mgr.poll_job("123456")
        self.assertEqual(status["schedulerJobId"], "123456")
        self.assertEqual(status["state"], "COMPLETED")
        self.assertEqual(status["exitCode"], "0")
        self.assertTrue(status["terminal"])


if __name__ == "__main__":
    unittest.main()

class TestHpcRemoteHardening(unittest.TestCase):
    def test_allocations_reach_scheduler_without_mutating_profile(self):
        profile = {"scheduler": "pbs", "defaults": {"nodes": 1, "ranksPerNode": 8, "wallSeconds": 300, "memoryMiBPerNode": 1024}}
        allocation = {"nodes": 3, "ranksPerNode": 4, "wallSeconds": 900, "memoryMiBPerNode": 4096}
        script = HpcRemoteJobManager(MagicMock(), profile, allocation).render_remote_script("calc-1", "/scratch/job")
        self.assertIn("select=3:ncpus=4:mpiprocs=4:ompthreads=1:mem=4096mb", script)
        self.assertIn("export PHYNITE_VCPUS=12", script)
        self.assertIn("export PHYNITE_MEMORY_MIB=12288", script)
        self.assertEqual(profile['defaults']['nodes'], 1)

    def test_scientific_manifest_and_nested_harvest_require_exact_bytes(self):
        # Protocol fixtures validate transport, not a real solver qualification.
        from backend.compute.hpc_manifest import main as create_manifest
        with tempfile.TemporaryDirectory() as folder:
            remote = Path(folder) / 'remote'; results = remote / 'results'
            (results / 'data').mkdir(parents=True)
            (results / 'data' / 'energy.dat').write_text('-1.0\n')
            manifest = {'status': 'completed', 'calculationId': 'calc-1', 'calculationType': 'Total energy', 'summary': {
                'converged': True, 'jobDone': True, 'stageConvergence': [{'stage': 'scf', 'calculationMode': 'scf', 'jobDone': True,
                'electronicConvergence': 'converged', 'hybridConvergence': 'not-applicable', 'scfAccuracy': {
                'status': 'verified', 'residualRy': 1e-9, 'residualUpperRy': 1.1e-9, 'thresholdRy': 1e-8, 'source': 'qe-log-bound'}}]}}
            (results / 'result.json').write_text(json.dumps(manifest))
            previous = Path.cwd()
            try:
                os.chdir(remote); create_manifest()
            finally:
                os.chdir(previous)
            connection = MagicMock(spec=HpcSshConnection)
            def command(argv):
                if argv[0] == 'sacct': return (0, '123|COMPLETED|0:0\n', '')
                if argv[0] == 'find': return (0, '\n'.join(p.relative_to(results).as_posix() for p in results.rglob('*') if p.is_file()), '')
                if argv[0] == 'stat': return (0, str(Path(argv[-1]).stat().st_size), '')
                raise AssertionError(argv)
            connection.run_command.side_effect = command
            connection.sftp_download.side_effect = lambda source, destination: shutil.copyfile(source, destination)
            manager = HpcRemoteJobManager(connection, {'scheduler': 'slurm'})
            destination = Path(folder) / 'harvest'
            outcome = manager.harvest_completed('123', str(remote), destination)
            self.assertEqual(outcome['state'], 'completed')
            self.assertEqual((destination / 'data' / 'energy.dat').read_bytes(), (results / 'data' / 'energy.dat').read_bytes())
            (results / 'data' / 'energy.dat').write_text('tampered')
            self.assertEqual(manager.harvest_completed('123', str(remote), Path(folder) / 'tampered')['state'], 'manual-resume-required')

    def test_environment_modules_are_names_and_submission_uncertainty_is_durable(self):
        with tempfile.TemporaryDirectory() as folder:
            profile = {
                "id": "cluster-a", "ownerId": "owner-a", "scheduler": "slurm",
                "connection": {}, "storage": {"scratchRoot": "/scratch/owner-a", "purgeWavefunctions": True},
                "runtime": {"environmentModules": ["qe/7.2"], "mpiLauncher": ["srun", "--ntasks={ranks}"]},
                "defaults": {"nodes": 1, "ranksPerNode": 4, "wallSeconds": 300, "memoryMiBPerNode": 1024},
            }
            connection = MagicMock(spec=HpcSshConnection)
            connection.run_command.return_value = (0, "", "")
            connection.run_command.side_effect = lambda argv: (1, "", "scheduler unavailable") if argv[0] == "sbatch" else (0, "", "")
            connection.sftp_upload.return_value = None
            manager = HpcRemoteJobManager(connection, profile)
            self.assertIn("module load qe/7.2", manager.render_remote_script("calc-1", "/scratch/owner-a/calc-1"))
            with self.assertRaisesRegex(Exception, "uncertain"):
                manager.submit_job("calc-1", {"pw.in": "&CONTROL /"}, Path(folder) / "receipts")
            receipt = json.loads((Path(folder) / "receipts" / "calc-1.json").read_text())
            self.assertEqual(receipt["state"], "submission-uncertain")
            with self.assertRaises(Exception): manager.render_remote_script("../escape", "/scratch/owner-a/calc-1")
            with self.assertRaises(Exception): manager.render_remote_script("calc-1", "/scratch/../escape")

    def test_manifest_checksum_controls_wavefunction_purge(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = root / "pw.out"; result.write_text("done")
            digest = __import__("hashlib").sha256(result.read_bytes()).hexdigest()
            (root / "manifest.sha256").write_text(f"{digest} pw.out\n")
            self.assertTrue(HpcRemoteJobManager.validate_manifest(root))
            connection = MagicMock(spec=HpcSshConnection)
            connection.run_command.return_value = (0, "", "")
            manager = HpcRemoteJobManager(connection, {"scheduler": "slurm", "storage": {"purgeWavefunctions": True}})
            self.assertTrue(manager.purge_wavefunctions_after_completion("/scratch/job", {"terminal": True, "state": "COMPLETED", "exitCode": "0"}, True))
            self.assertEqual(connection.run_command.call_args.args[0][0], "find")

    def probe_fixture(self, modules=None, *, module_body=":", capabilities=True, truncate=False, code_override=None):
        """Execute the generated probe body with synthetic tools and login noise."""
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            binary = root / "bin"
            binary.mkdir()
            for name in (["sbatch", "pw.x"] if capabilities else []) + ["uname"]:
                tool = binary / name
                tool.write_text("#!/bin/sh\necho 'Linux fixture-kernel x86_64'\n")
                tool.chmod(0o755)
            ssh = HpcSshConnection(host="login.example", username="researcher", control_dir=root / "control")
            calls = []
            def fake_run(argv, timeout=60):
                calls.append(argv)
                if argv[:2] == ["echo", "PHYNITE_HPC_PROBE_OK"]:
                    return 0, "PHYNITE_HPC_PROBE_OK\n", ""
                # Simulate a module function initialized by bash -lc, while
                # keeping the test independent of this machine's login files.
                process = subprocess.run(["/bin/bash" if argv[0] == "bash" else "/bin/sh", "-c",
                    "module() { " + module_body + "; }; " + argv[2]], env={"PATH": str(binary)}, capture_output=True, text=True)
                output = process.stdout
                if truncate:
                    output = output.rsplit("PHYNITE_HPC_", 1)[0]
                noise = "MOTD: sbatch qsub available?\nqe=/banner/pw.x\n"
                return (process.returncode if code_override is None else code_override,
                    noise + output + "Farewell sbatch qsub\nsystem=Banner after uname\n", process.stderr)
            ssh.run_command = fake_run
            result = ssh.probe_connection(modules=modules)
            return result, calls

    def test_probe_connection_loads_normalized_modules_via_login_shell(self):
        result, calls = self.probe_fixture(["module purge", "module load intel/2024.0", "materials/qe/7.2-impi", "intel/2024.0"],
            module_body="printf 'module diagnostic: sbatch qsub\\n'")
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["schedulers"], {"slurm": True, "pbs": False})
        self.assertTrue(result["solvers"]["qe"].endswith("/bin/pw.x"))
        self.assertIsNone(result["solvers"]["lammps"])
        self.assertEqual(result["system"], "Linux fixture-kernel x86_64")
        self.assertEqual(calls[1][:2], ["bash", "-lc"])
        self.assertEqual(calls[1][2].count("module load intel/2024.0"), 1)
        self.assertIn("module load materials/qe/7.2-impi", calls[1][2])
        self.assertNotIn("module purge", calls[1][2])
        self.assertIn("command -v sbatch", calls[1][2])
        manager = HpcRemoteJobManager(MagicMock(spec=HpcSshConnection), {
            'scheduler': 'slurm', 'runtime': {'environmentModules': ['module purge', 'module load intel/2024.0', 'materials/qe/7.2-impi', 'intel/2024.0']},
        })
        self.assertEqual(manager._modules(), ['intel/2024.0', 'materials/qe/7.2-impi'])

    def test_probe_without_modules_or_with_only_legacy_purge_uses_sh(self):
        for modules in (None, [], ["module purge"]):
            with self.subTest(modules=modules):
                result, calls = self.probe_fixture(modules, capabilities=False)
                self.assertTrue(result["ok"], result)
                self.assertEqual(calls[1][:2], ["sh", "-c"])
                self.assertEqual(result["schedulers"], {"slurm": False, "pbs": False})
                self.assertEqual(result["solvers"], {"qe": None, "lammps": None})
                self.assertEqual(result["system"], "Linux fixture-kernel x86_64")

    def test_probe_rejects_corrupt_module_lists_and_unsafe_names_before_ssh(self):
        for modules in ("qe/7.2", "", {}, 123, [None], [12], [""], ["qe; touch /tmp/pwned"], ["$(id)"], ["module load qe mpi"], ["qe\nother"]):
            with self.subTest(modules=modules), tempfile.TemporaryDirectory() as folder:
                ssh = HpcSshConnection(host="login.example", username="researcher", control_dir=Path(folder))
                ssh.run_command = MagicMock()
                with self.assertRaises(HpcSshError):
                    ssh.probe_connection(modules=modules)
                ssh.run_command.assert_not_called()

    def test_probe_reports_module_failure_and_missing_lmod_initialization(self):
        for module_body in ("printf '\\033[31mLmod: unknown module qe/typo\\033[0m\\n' >&2; return 1", "printf 'module: command not found\\n' >&2; return 127"):
            result, _ = self.probe_fixture(["qe/typo"], module_body=module_body)
            self.assertFalse(result["ok"])
            self.assertIn("Failed to load environment module qe/typo", result["error"])
            self.assertTrue("unknown module" in result["error"] or "command not found" in result["error"])
            self.assertNotIn("\x1b", result["error"])
            self.assertEqual(result["solvers"], {})
            self.assertEqual(result["schedulers"], {})
        result, _ = self.probe_fixture(["qe/typo"], module_body="printf '%3000s' x >&2; return 1")
        self.assertLess(len(result["error"]), 2100)

    def test_probe_rejects_truncated_output_and_nonzero_status(self):
        for options in ({"truncate": True}, {"code_override": 7}):
            with self.subTest(options=options):
                result, _ = self.probe_fixture(["qe/7.2"], **options)
                self.assertFalse(result["ok"])
                self.assertEqual(result["solvers"], {})


if __name__ == "__main__":
    unittest.main()
