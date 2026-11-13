"""Unit tests for remote HPC SSH connection, scheduler script generation, and sparse harvesting."""
import unittest
import tempfile
import json
import shutil
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.local_worker.hpc_ssh import HpcSshConnection, HpcSshError
from backend.local_worker.hpc_remote import (
    HpcError,
    HpcRemoteJobManager,
    HpcRemoteWorker,
    is_sparse_harvest_target,
    profile_sha256,
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

    def test_long_control_dir_falls_back_to_short_unix_socket_path(self):
        with tempfile.TemporaryDirectory() as folder:
            long_dir = Path(folder) / ("very_long_cluster_work_dir_" + "x" * 60) / "ssh-sockets"
            conn = HpcSshConnection(
                host="login2.hpc.brin.go.id",
                username="researcher",
                control_dir=long_dir,
            )
            self.assertLessEqual(len(str(conn.socket_path).encode("utf-8")), 86)
            self.assertEqual(conn.socket_path.suffix, ".sock")
            self.assertEqual(conn.lock_path, conn.socket_path.with_suffix(".lock"))
            self.assertEqual(conn.control_dir.stat().st_mode & 0o777, 0o700)

    def test_ssh_subprocess_strips_pyinstaller_meipass_loader_path(self):
        import sys
        import subprocess
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            meipass = Path(folder) / "_MEI123"
            meipass.mkdir()
            sock_dir = Path(folder) / "ssh"
            conn = HpcSshConnection(host="login.example", username="researcher", control_dir=sock_dir)
            seen_envs = []

            def fake_run(cmd, **kwargs):
                seen_envs.append(kwargs.get("env"))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(sys, "frozen", True, create=True), \
                 patch.object(sys, "_MEIPASS", str(meipass), create=True), \
                 patch.dict(os.environ, {"LD_LIBRARY_PATH": f"{meipass}:/opt/custom/lib"}, clear=False), \
                 patch.object(subprocess, "run", side_effect=fake_run):
                conn._run_ssh_tool(["ssh", "-V"])

            self.assertEqual(len(seen_envs), 1)
            self.assertEqual(seen_envs[0]["LD_LIBRARY_PATH"], "/opt/custom/lib")

    def test_sftp_uses_uppercase_port_and_control_path_option(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            local_file = root / "pw.in"
            local_file.write_text("&CONTROL /\n")
            conn = HpcSshConnection(host="login2.hpc.brin.go.id", username="researcher", port=2222, control_dir=root / "ssh")
            cmds = []
            with patch.object(conn, "ensure_master"), \
                 patch.object(conn, "_run_ssh_tool", side_effect=lambda cmd, **kw: cmds.append((cmd, kw)) or SimpleNamespace(returncode=0, stdout="", stderr="")):
                conn.sftp_upload(local_file, "/mgpfs/home/researcher/phynite-work/calc/pw.in")
                conn.sftp_download("/mgpfs/home/researcher/phynite-work/calc/result.json", root / "out" / "result.json")

            self.assertEqual(len(cmds), 2)
            for cmd, kw in cmds:
                self.assertEqual(cmd[0], "sftp")
                self.assertIn("-P", cmd)
                self.assertIn("2222", cmd)
                self.assertNotIn("-p", cmd)
                self.assertNotIn("-S", cmd)
                self.assertIn("-b", cmd)
                self.assertIn(f"ControlPath={conn.socket_path}", cmd)
                self.assertTrue(kw["input"].endswith("\n"))


class TestSparseHarvesting(unittest.TestCase):
    def test_scalar_and_log_files_are_harvested(self):
        self.assertTrue(is_sparse_harvest_target("relax.xml"))
        self.assertTrue(is_sparse_harvest_target("pw.out"))
        self.assertTrue(is_sparse_harvest_target("total-energy.dat"))
        self.assertTrue(is_sparse_harvest_target("results.json"))
        self.assertTrue(is_sparse_harvest_target("band_structure.png"))
        self.assertTrue(is_sparse_harvest_target("plots/band-structure.pdf"))
        self.assertTrue(is_sparse_harvest_target("inputs/scf.in"))
        self.assertTrue(is_sparse_harvest_target("data/graphene.bands.dat.gnu"))
        self.assertTrue(is_sparse_harvest_target("data/graphene.pdos_tot"))
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
        self.assertIn("\"$PHYNITE_PYTHON\" runners/local_runner.py", script)
        self.assertIn('export PHYNITE_MPI_LAUNCHER=\'["srun", "--mpi=pmix", "--ntasks={ranks}"]\'', script)
        self.assertIn("\"$PHYNITE_PYTHON\" runners/hpc_manifest.py", script)

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
        mgr = HpcRemoteJobManager(self.mock_conn, self.slurm_profile)
        mgr._scheduler_command = MagicMock(return_value=(0, "123456|COMPLETED|0:0\n", ""))
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
            manager._scheduler_command = MagicMock(return_value=(0, "123|COMPLETED|0:0\n", ""))
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
            connection.sftp_upload.return_value = None
            manager = HpcRemoteJobManager(connection, profile)
            manager._scheduler_command = MagicMock(return_value=(1, "", "scheduler unavailable"))
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

    def test_remote_scratch_retention_and_symlinking(self):
        with tempfile.TemporaryDirectory() as folder:
            profile = {
                "id": "cluster-a", "ownerId": "owner-a", "scheduler": "slurm",
                "connection": {}, "storage": {"scratchRoot": "/scratch/work", "purgeWavefunctions": False},
                "runtime": {"pythonExecutable": "/usr/bin/python3"},
                "defaults": {"nodes": 1, "ranksPerNode": 4, "wallSeconds": 300, "memoryMiBPerNode": 1024},
            }
            connection = MagicMock(spec=HpcSshConnection)
            connection.run_command.return_value = (0, "", "")
            uploaded_files = []
            connection.sftp_upload.side_effect = lambda local_p, remote_path: uploaded_files.append(remote_path)
            manager = HpcRemoteJobManager(connection, profile)
            manager._scheduler_command = MagicMock(return_value=(0, "45678", ""))

            input_files = {
                "input.json": json.dumps({"settings": {"scfSourceCalculationId": "scf-calc-1"}}),
                "nscf.in": "&CONTROL /",
                "dependencies/scf/scf-state.tar.gz": b"large-binary-archive-content-100mb",
            }
            receipt = manager.submit_job("bands-calc-2", input_files, Path(folder) / "receipts")
            self.assertTrue(receipt["remoteScratchRetained"])
            self.assertEqual(receipt["sourceCalculationId"], "scf-calc-1")
            uploaded_names = [Path(p).name for p in uploaded_files]
            self.assertNotIn("scf-state.tar.gz", uploaded_names)
            self.assertIn("input.json", uploaded_names)
            self.assertIn("nscf.in", uploaded_names)
            self.assertIn("submit.sh", uploaded_names)

    def test_pipeline_fusing_and_job_chaining(self):
        with tempfile.TemporaryDirectory() as folder:
            receipts_dir = Path(folder) / "receipts"
            receipts_dir.mkdir(parents=True)
            # Upstream active SCF job receipt
            (receipts_dir / "scf-calc-1.json").write_text(json.dumps({
                "scheduler": "slurm",
                "schedulerJobId": "112233",
                "state": "submitted",
            }))

            profile = {
                "id": "cluster-a", "ownerId": "owner-a", "scheduler": "slurm",
                "connection": {}, "storage": {"scratchRoot": "/scratch/work", "purgeWavefunctions": False},
                "runtime": {"pythonExecutable": "/usr/bin/python3"},
                "defaults": {"nodes": 1, "ranksPerNode": 4, "wallSeconds": 300, "memoryMiBPerNode": 1024},
            }
            connection = MagicMock(spec=HpcSshConnection)
            connection.run_command.return_value = (0, "", "")
            manager = HpcRemoteJobManager(connection, profile)
            manager.poll_job = MagicMock(return_value={"schedulerJobId": "112233", "state": "RUNNING", "terminal": False})
            manager._scheduler_command = MagicMock(return_value=(0, "45679", ""))

            input_files = {
                "input.json": json.dumps({"settings": {"fusedPipeline": True, "scfSourceCalculationId": "scf-calc-1"}}),
                "nscf.in": "&CONTROL /",
            }
            receipt = manager.submit_job("bands-calc-2", input_files, receipts_dir)
            self.assertTrue(receipt["fusedPipeline"])
            self.assertEqual(receipt["chainedToJobId"], "112233")
            # Verify Slurm sbatch was called with --dependency=afterok:112233
            manager._scheduler_command.assert_called_once_with([
                "sbatch", "--parsable", "--dependency=afterok:112233", "/scratch/work/owner-a/bands-calc-2/submit.sh"
            ])
            # Verify script content has fused pipeline marker
            rendered = manager.render_remote_script("bands-calc-2", "/scratch/work/owner-a/bands-calc-2")
            self.assertIn("# phynite:fused-pipeline=true", rendered)

            # Test PBS job chaining
            pbs_profile = {**profile, "scheduler": "pbs"}
            pbs_manager = HpcRemoteJobManager(connection, pbs_profile)
            pbs_manager.poll_job = MagicMock(return_value={"schedulerJobId": "112233", "state": "R", "terminal": False})
            pbs_manager._scheduler_command = MagicMock(return_value=(0, "45680", ""))
            (receipts_dir / "scf-calc-pbs.json").write_text(json.dumps({
                "scheduler": "pbs",
                "schedulerJobId": "112233",
                "state": "submitted",
            }))
            pbs_receipt = pbs_manager.submit_job("bands-calc-pbs", {
                "input.json": json.dumps({"settings": {"fusedPipeline": True, "scfSourceCalculationId": "scf-calc-pbs"}}),
                "nscf.in": "&CONTROL /",
            }, receipts_dir)
            self.assertTrue(pbs_receipt["fusedPipeline"])
            self.assertEqual(pbs_receipt["chainedToJobId"], "112233")
            pbs_manager._scheduler_command.assert_called_once_with([
                "qsub", "-W", "depend=afterok:112233", "/scratch/work/owner-a/bands-calc-pbs/submit.sh"
            ])

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

    def test_host_subprocess_env_and_local_loopback_upload_bypass_curl(self):
        import sys
        from types import SimpleNamespace
        from backend.local_worker import recovery, worker
        with tempfile.TemporaryDirectory() as folder:
            meipass = Path(folder) / "_MEIabc"
            meipass.mkdir()
            with patch.object(sys, "frozen", True, create=True), \
                 patch.object(sys, "_MEIPASS", str(meipass), create=True):
                cleaned = recovery.host_subprocess_env({"PATH": "/usr/bin", "LD_LIBRARY_PATH": str(meipass)})
                self.assertNotIn("LD_LIBRARY_PATH", cleaned)
                restored = recovery.host_subprocess_env({
                    "PATH": "/usr/bin",
                    "LD_LIBRARY_PATH": f"{meipass}:/other",
                    "LD_LIBRARY_PATH_ORIG": "/system/lib",
                })
                self.assertEqual(restored["LD_LIBRARY_PATH"], "/system/lib")

            payload = Path(folder) / "result.json"
            payload.write_text('{"ok": true}')
            client = worker.ApiClient("http://127.0.0.1:42839", "secret")
            fake_response = MagicMock()
            fake_response.__enter__.return_value = fake_response
            fake_response.read.return_value = b""
            fake_opener = MagicMock()
            fake_opener.open.return_value = fake_response
            with patch.dict(os.environ, {"PHYNITE_APP_MODE": "local"}, clear=False), \
                 patch.object(worker.shutil, "which", return_value="/usr/bin/curl"), \
                 patch.object(worker.subprocess, "run") as mock_curl, \
                 patch.object(worker.urllib.request, "build_opener", return_value=fake_opener):
                client.upload("http://127.0.0.1:42839/__local/artifacts?ticket=abc", payload, "application/json")
            mock_curl.assert_not_called()
            fake_opener.open.assert_called_once()

    def test_detect_scratch_root_and_check_writable_path(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            scratch_dir = root / "scratch"
            scratch_dir.mkdir()
            home_dir = root / "home"
            home_dir.mkdir()
            readonly_dir = root / "readonly"
            readonly_dir.mkdir()
            readonly_dir.chmod(0o555)
            ssh = HpcSshConnection(host="login.example", username="researcher", control_dir=root / "ssh")

            def exec_with_env(extra_env):
                def runner(argv, timeout=15):
                    shell = "/bin/bash" if argv[0] == "bash" else "/bin/sh"
                    env = {"PATH": os.defpath, **extra_env}
                    proc = subprocess.run([shell, "-c", argv[2]], env=env, capture_output=True, text=True)
                    return proc.returncode, "Welcome MOTD banner\n" + proc.stdout, proc.stderr
                return runner

            try:
                ssh.run_command = exec_with_env({"SCRATCH": str(scratch_dir), "HOME": str(home_dir)})
                self.assertEqual(ssh.detect_scratch_root(), f"{scratch_dir}/phynite-work")

                ssh.run_command = exec_with_env({"HOME": str(home_dir)})
                self.assertEqual(ssh.detect_scratch_root(), f"{home_dir}/phynite-work")

                self.assertTrue(ssh.check_writable_path(f"{home_dir}/phynite-work/sub"))
                self.assertFalse(ssh.check_writable_path(str(readonly_dir / "nested")))
                self.assertFalse(ssh.check_writable_path("/"))

                ssh.run_command = exec_with_env({"SCRATCH": "/nonexistent-root-dir", "HOME": str(readonly_dir)})
                with self.assertRaises(HpcSshError):
                    ssh.detect_scratch_root()
            finally:
                readonly_dir.chmod(0o755)

    def test_slurm_mpirun_and_python_executable_script_syntax(self):
        import subprocess
        profile_with_py = {
            "id": "cl-brin-test",
            "ownerId": "usr-123",
            "scheduler": "slurm",
            "storage": {"scratchRoot": "/mgpfs/home/user/phynite-work"},
            "runtime": {
                "environmentModules": ["intel/2024.0", "materials/qe/7.2-impi"],
                "mpiLauncher": ["mpirun", "-np", "{ranks}"],
                "pythonExecutable": "/opt/conda/envs/science/bin/python3",
            },
            "defaults": {"nodes": 1, "ranksPerNode": 32, "wallSeconds": 3600, "memoryMiBPerNode": 65536},
        }
        script_with_py = HpcRemoteJobManager(MagicMock(spec=HpcSshConnection), profile_with_py).render_remote_script(
            "calc-mpirun-1", "/mgpfs/home/user/phynite-work/usr-123/calc-mpirun-1"
        )
        self.assertIn('export PHYNITE_MPI_LAUNCHER=\'["mpirun", "-np", "{ranks}"]\'', script_with_py)
        self.assertIn('export PHYNITE_PYTHON=/opt/conda/envs/science/bin/python3', script_with_py)
        self.assertIn('runners/local_runner.py', script_with_py)
        self.assertIn('runners/hpc_manifest.py', script_with_py)
        subprocess.run(["bash", "-n"], input=script_with_py, text=True, check=True)

        profile_auto_py = {
            **profile_with_py,
            "runtime": {
                "environmentModules": ["intel/2024.0", "materials/qe/7.2-impi"],
                "mpiLauncher": ["mpirun", "-np", "{ranks}"],
            },
        }
        script_auto_py = HpcRemoteJobManager(MagicMock(spec=HpcSshConnection), profile_auto_py).render_remote_script(
            "calc-mpirun-2", "/mgpfs/home/user/phynite-work/usr-123/calc-mpirun-2"
        )
        self.assertIn('export PHYNITE_PYTHON="$(command -v python3 || :)"', script_auto_py)
        self.assertNotIn('export PATH=', script_auto_py)
        self.assertIn("\"$PHYNITE_PYTHON\" runners/local_runner.py", script_auto_py)
        self.assertIn("\"$PHYNITE_PYTHON\" runners/hpc_manifest.py", script_auto_py)
        self.assertLess(script_auto_py.index("/mgpfs/apps/*/apps/miniconda*/*/bin/python3"), script_auto_py.index('"${HOME:-}"/miniconda3/envs/*/bin/python3'))
        subprocess.run(["bash", "-n"], input=script_auto_py, text=True, check=True)

    def test_probe_connection_reports_mpi_and_python_diagnostics(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            binary = root / "bin"
            binary.mkdir()
            home_dir = root / "home"
            conda_bin = home_dir / "miniconda3" / "envs" / "science" / "bin"
            conda_bin.mkdir(parents=True)

            scripts = {
                binary / "uname": "#!/bin/sh\necho Linux x86_64\n",
                binary / "sbatch": "#!/bin/sh\nexit 0\n",
                binary / "mpirun": "#!/bin/sh\nexit 0\n",
                binary / "mpiexec": "#!/bin/sh\nexit 0\n",
                binary / "pw.x": "#!/bin/sh\nexit 0\n",
                binary / "ldd": "#!/bin/sh\necho 'libmpi.so.12 => /opt/impi/lib/libmpi.so.12'\n",
                binary / "srun": "#!/bin/sh\nprintf 'MPI plugin types are...\\n\\t%s\\n\\t%s\\n\\t%s\\n' cray_shasta none pmi2\n",
                binary / "python3": "#!/bin/sh\necho '3.6.8|numpy,scipy,matplotlib,seekpath'\n",
                conda_bin / "python3": "#!/bin/sh\necho '3.10.20|'\n",
            }
            for path, content in scripts.items():
                path.write_text(content, encoding="utf-8")
                path.chmod(0o755)

            ssh = HpcSshConnection(host="login.example", username="researcher", control_dir=root / "ssh")
            def runner(argv, timeout=15):
                if argv[:2] == ["echo", "PHYNITE_HPC_PROBE_OK"]:
                    return 0, "PHYNITE_HPC_PROBE_OK\n", ""
                env = {"PATH": f"{binary}:{os.defpath}", "HOME": str(home_dir)}
                shell = "/bin/bash" if argv[0] == "bash" else "/bin/sh"
                proc = subprocess.run([shell, "-c", argv[2]], env=env, capture_output=True, text=True)
                return proc.returncode, proc.stdout, proc.stderr

            ssh.run_command = runner
            result = ssh.probe_connection()
            self.assertTrue(result["ok"], result)
            self.assertEqual(result["mpi"]["mpirun"], str(binary / "mpirun"))
            self.assertEqual(result["mpi"]["srunPlugins"], ["cray_shasta", "none", "pmi2"])
            self.assertEqual(result["mpi"]["qeMpi"], "impi")
            self.assertEqual(result["python"]["executable"], str(binary / "python3"))
            self.assertEqual(result["python"]["version"], "3.6.8")
            self.assertFalse(result["python"]["versionOk"])
            self.assertFalse(result["python"]["packagesOk"])
            self.assertEqual(result["python"]["suggestedExecutable"], str(conda_bin / "python3"))
            self.assertEqual(result["python"]["suggestedVersion"], "3.10.20")

    def test_worker_run_once_resumes_submitted_receipt_and_rejects_uncertain(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            prof = {
                "id": "cluster-a",
                "ownerId": "owner-a",
                "name": "BRIN",
                "scheduler": "slurm",
                "isDefault": True,
                "connection": {"host": "login.example", "port": 22, "username": "researcher", "authKind": "key", "privateKeyPath": "/tmp/key"},
                "storage": {"scratchRoot": "/scratch/owner-a", "purgeWavefunctions": True},
                "runtime": {"environmentModules": ["qe/7.2"], "mpiLauncher": ["mpirun", "-np", "{ranks}"]},
                "defaults": {"nodes": 1, "ranksPerNode": 4, "wallSeconds": 3600, "memoryMiBPerNode": 4096},
            }
            checksum = profile_sha256(prof)
            prof_snapshot = {**prof, "profileSha256": checksum}

            job_payload = {
                "calculationId": "calc-resumed",
                "ownerId": "owner-a",
                "kind": "qe",
                "vcpus": 4,
                "memoryMiB": 4096,
                "input": {
                    "calculationType": "SCF / Total energy",
                    "settings": {"hpcAllocation": {"nodes": 1, "ranksPerNode": 4, "wallSeconds": 3600, "memoryMiBPerNode": 4096}},
                },
            }
            client = MagicMock()
            client.get.return_value = {"profile": prof_snapshot}
            client.post.side_effect = lambda path, *args, **kwargs: (
                {"job": job_payload} if path.endswith("/claim") else {"cancelRequested": False}
            )

            calc_dir = root / "calc-resumed"
            receipts_dir = calc_dir / "receipts"
            receipts_dir.mkdir(parents=True)
            submitted_receipt = {
                "state": "submitted",
                "calculationId": "calc-resumed",
                "profileSha256": checksum,
                "scheduler": "slurm",
                "schedulerJobId": "571084",
                "remoteWorkDir": "/scratch/owner-a/calc-resumed",
            }
            (receipts_dir / "calc-resumed.json").write_text(json.dumps(submitted_receipt), encoding="utf-8")

            manager = MagicMock()
            manager.poll_job.return_value = {"schedulerJobId": "571084", "state": "COMPLETED", "exitCode": "0", "terminal": True}
            manager.harvest_completed.return_value = {"state": "completed"}

            worker = HpcRemoteWorker(
                client,
                "worker-brin",
                "cluster-a",
                checksum,
                manager_factory=lambda *_: manager,
                workspace_builder=lambda *_: {"pw.in": "&CONTROL /"},
            )
            outcome = worker.run_once("calc-resumed", MagicMock(spec=HpcSshConnection), root, poll_seconds=0)
            self.assertEqual(outcome["state"], "completed")
            manager.submit_job.assert_not_called()
            manager.poll_job.assert_called_once_with("571084")
            manager.harvest_completed.assert_called_once_with("571084", "/scratch/owner-a/calc-resumed", calc_dir / "results")

            # A submission-uncertain receipt must STILL refuse both submission and polling.
            (receipts_dir / "calc-resumed.json").write_text(
                json.dumps({**submitted_receipt, "state": "submission-uncertain"}),
                encoding="utf-8",
            )
            manager.reset_mock()
            client.post.side_effect = lambda path, *args, **kwargs: (
                {"job": job_payload} if path.endswith("/claim") else {"cancelRequested": False}
            )
            blocked = worker.run_once("calc-resumed", MagicMock(spec=HpcSshConnection), root, poll_seconds=0)
            self.assertEqual(blocked["state"], "manual-resume-required")
            self.assertIn("Submission receipt already exists", blocked["reason"])
            manager.submit_job.assert_not_called()
            manager.poll_job.assert_not_called()

    @unittest.skipUnless(sys.platform.startswith("linux"), "requires GNU find/stat used on remote Linux HPC nodes")
    def test_sparse_harvest_argv_passes_ssh_validation_and_real_find(self):
        import hashlib, subprocess
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            remote = root / "remote"
            results = remote / "results"
            (results / "logs").mkdir(parents=True)
            log_file = results / "logs" / "scf.out"
            log_file.write_text("JOB DONE\n", encoding="utf-8")
            result_file = results / "result.json"
            result_file.write_text(json.dumps({"calculationId": "calc-1", "status": "completed"}), encoding="utf-8")
            digest_lines = [
                f"{hashlib.sha256(result_file.read_bytes()).hexdigest()}  result.json",
                f"{hashlib.sha256(log_file.read_bytes()).hexdigest()}  logs/scf.out",
            ]
            (results / "manifest.sha256").write_text("\n".join(digest_lines) + "\n", encoding="utf-8")

            ssh = HpcSshConnection(host="login.example", username="researcher", control_dir=root / "ssh")
            ssh.ensure_master = MagicMock()
            def fake_run_ssh_tool(ssh_cmd, timeout=60):
                remote_cmd = ssh_cmd[-1]
                proc = subprocess.run(["sh", "-c", remote_cmd], capture_output=True, text=True)
                return proc
            ssh._run_ssh_tool = fake_run_ssh_tool
            ssh.sftp_download = lambda source, destination: shutil.copyfile(source, destination)

            manager = HpcRemoteJobManager(ssh, {"scheduler": "slurm"})
            dest = root / "harvested"
            harvested = manager.sparse_harvest(str(remote), dest)
            self.assertIn("result.json", harvested)
            self.assertIn("logs/scf.out", harvested)
            self.assertTrue(manager.last_harvest_manifest_validated)


if __name__ == "__main__":
    unittest.main()


class TestHpcDeferredWorkerLoop(unittest.TestCase):
    def test_remote_worker_once_defers_without_writing_or_uploading_terminal_results(self):
        import importlib
        from backend.local_worker import worker as worker_module
        remote_module = importlib.import_module('hpc_remote')
        ssh_module = importlib.import_module('hpc_ssh')
        profile = {'connection': {'host': 'login.example', 'username': 'researcher', 'authKind': 'agent'}}
        for state in ('monitoring-deferred', 'lease-lost'):
            with self.subTest(state=state), tempfile.TemporaryDirectory() as folder:
                with patch.object(worker_module, 'ApiClient'), \
                        patch.object(remote_module, 'fetch_profile_snapshot', return_value=profile), \
                        patch.object(remote_module, 'HpcRemoteWorker') as remote, \
                        patch.object(ssh_module, 'HpcSshConnection'), \
                        patch.object(worker_module, 'remote_result') as write_terminal, \
                        patch.object(worker_module, 'upload_results') as upload, \
                        patch('builtins.print'):
                    remote.return_value.run_once.return_value = {
                        'state': state, 'reason': 'Transport unavailable; retained receipt',
                        'job': {'calculationId': 'calc-retained'},
                    }
                    exit_code = worker_module.main([
                        '--runtime', 'native', '--api-url', 'http://127.0.0.1:8792',
                        '--token', 'x' * 64, '--work-dir', folder,
                        '--pseudo-root', str(Path(folder) / 'pseudo'),
                        '--hpc-cluster-id', 'cluster-retained',
                        '--hpc-profile-sha256', 'a' * 64, '--once',
                    ])
                    self.assertEqual(exit_code, 3)
                    write_terminal.assert_not_called()
                    upload.assert_not_called()
                    remote.return_value.run_once.assert_called_once()
                    self.assertFalse(list(Path(folder).rglob('result.json')))

    def test_supervised_remote_worker_keeps_running_after_monitoring_is_deferred(self):
        import importlib
        from backend.local_worker import worker as worker_module
        remote_module = importlib.import_module('hpc_remote')
        ssh_module = importlib.import_module('hpc_ssh')
        profile = {'connection': {'host': 'login.example', 'username': 'researcher', 'authKind': 'agent'}}
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(worker_module, 'ApiClient'), \
                    patch.object(remote_module, 'fetch_profile_snapshot', return_value=profile), \
                    patch.object(remote_module, 'HpcRemoteWorker') as remote, \
                    patch.object(ssh_module, 'HpcSshConnection'), \
                    patch.object(worker_module, 'remote_result') as write_terminal, \
                    patch.object(worker_module, 'upload_results') as upload, \
                    patch.object(worker_module.time, 'sleep', side_effect=[None, KeyboardInterrupt]), \
                    patch('builtins.print'):
                remote.return_value.run_once.side_effect = [
                    {'state': 'monitoring-deferred', 'reason': 'Read temporarily unavailable'},
                    {'state': 'no-job'},
                ]
                with self.assertRaises(KeyboardInterrupt):
                    worker_module.main([
                        '--runtime', 'native', '--api-url', 'http://127.0.0.1:8792',
                        '--token', 'x' * 64, '--work-dir', folder,
                        '--pseudo-root', str(Path(folder) / 'pseudo'),
                        '--hpc-cluster-id', 'cluster-retained',
                        '--hpc-profile-sha256', 'a' * 64,
                    ])
                self.assertEqual(remote.return_value.run_once.call_count, 2)
                write_terminal.assert_not_called()
                upload.assert_not_called()
