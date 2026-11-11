"""Slurm/OpenPBS adapters for owner-scoped personal workers inside allocations."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    from .recovery import atomic_json, canonical_digest
except ImportError:
    from recovery import atomic_json, canonical_digest


class HpcError(RuntimeError):
    pass


def positive(value: Any, label: str, maximum: int = 1_000_000_000) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise HpcError(f"{label} must be an integer from 1 to {maximum}.")
    return value


def allowed_launchers(scheduler: str) -> set[str]:
    return {"srun", "mpiexec", "mpirun"} if scheduler == "slurm" else {"mpiexec", "mpirun"}


def launcher_template(value: Any) -> list[str]:
    if not isinstance(value, list) or not value or len(value) > 32 or any(not isinstance(item, str) or not item or "\x00" in item or "\n" in item for item in value):
        raise HpcError("MPI launcher must be a nonempty JSON argv list.")
    if sum(item.count("{ranks}") for item in value) != 1 or any("{" in item.replace("{ranks}", "") or "}" in item.replace("{ranks}", "") for item in value):
        raise HpcError("MPI launcher must contain exactly one {ranks} placeholder.")
    return value


def load_profile(path: Path) -> dict[str, Any]:
    try:
        profile = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise HpcError("HPC profile could not be read.") from exc
    if not isinstance(profile, dict) or profile.get("scheduler") not in {"slurm", "pbs"}:
        raise HpcError("Choose a Slurm or OpenPBS profile.")
    allowed = {"scheduler", "nodes", "ranksPerNode", "memoryMiBPerNode", "wallSeconds", "queue", "account", "workerConfig", "repository", "python", "workRoot", "pseudoRoot", "mpiLauncher", "environment", "gpusPerNode"}
    if set(profile) - allowed:
        raise HpcError("HPC profile contains unsupported fields: " + ", ".join(sorted(set(profile) - allowed)))
    for key, limit in (("nodes", 4096), ("ranksPerNode", 1024), ("memoryMiBPerNode", 16_777_216), ("wallSeconds", 5_184_000)):
        positive(profile.get(key), key, limit)
    positive(profile["nodes"] * profile["ranksPerNode"], "Total MPI ranks", 65_536)
    positive(profile["nodes"] * profile["memoryMiBPerNode"], "Total memory MiB", 1_073_741_824)
    if profile["wallSeconds"] < 300 or profile["memoryMiBPerNode"] < 1024:
        raise HpcError("Request at least 300 seconds and 1024 MiB per node, including finalization time.")
    if profile.get("gpusPerNode", 0) != 0:
        raise HpcError("GPU execution is not qualified by this adapter. Use CPU allocation or qualify an explicit accelerator binary and workflow first.")
    for key in ("workerConfig", "repository", "python", "workRoot", "pseudoRoot"):
        value = profile.get(key)
        if not isinstance(value, str) or not Path(value).is_absolute() or "\n" in value or "\x00" in value:
            raise HpcError(f"{key} must be an absolute path visible on every allocated node.")
    for key in ("queue", "account"):
        if profile.get(key) is not None and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}", str(profile[key])):
            raise HpcError(f"{key} contains unsupported characters.")
    environment = profile.get("environment", {})
    if not isinstance(environment, dict) or set(environment) - {"PATH", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"} or any(not isinstance(value, str) or "\x00" in value or "\n" in value for value in environment.values()):
        raise HpcError("Profile environment accepts only PATH and dynamic-library paths.")
    template = profile.get("mpiLauncher", ["srun", "--mpi=pmix", "--ntasks={ranks}"] if profile["scheduler"] == "slurm" else ["mpiexec", "-n", "{ranks}"])
    profile["mpiLauncher"] = launcher_template(template)
    allowed = allowed_launchers(profile["scheduler"])
    if Path(template[0]).name not in allowed:
        raise HpcError(f"This scheduler profile requires {', '.join(sorted(allowed))}; configure cluster MPI compatibility explicitly in its arguments.")
    return profile


def _integer_env(name: str, maximum: int = 1_000_000) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError as exc:
        raise HpcError(f"Active allocation must provide {name}.") from exc
    return positive(value, name, maximum)


def current_allocation(scheduler: str) -> dict[str, Any]:
    if scheduler == "slurm":
        if not re.fullmatch(r"[0-9]+(?:_[0-9]+)?", os.environ.get("SLURM_JOB_ID", "")):
            raise HpcError("Slurm execution requires an active SLURM_JOB_ID allocation.")
        ranks = _integer_env("SLURM_NTASKS")
        nodes = _integer_env("SLURM_JOB_NUM_NODES")
        if os.environ.get("SLURM_CPUS_PER_TASK", "1") != "1":
            raise HpcError("This MPI profile requires one CPU per rank (SLURM_CPUS_PER_TASK=1).")
        memory_per_node = _integer_env("SLURM_MEM_PER_NODE", 16_777_216)
        job_id = os.environ["SLURM_JOB_ID"]
    elif scheduler == "pbs":
        job_id = os.environ.get("PBS_JOBID", "")
        if not re.fullmatch(r"[0-9]+(?:\[[0-9]*\])?(?:\.[A-Za-z0-9_.-]+)?", job_id):
            raise HpcError("PBS execution requires an active PBS_JOBID allocation.")
        nodefile = Path(os.environ.get("PBS_NODEFILE", ""))
        if not nodefile.is_file():
            raise HpcError("PBS execution requires the allocation's PBS_NODEFILE.")
        hostnames = nodefile.read_text().splitlines()
        if not hostnames or any(not re.fullmatch(r"[A-Za-z0-9_.-]+", hostname) for hostname in hostnames):
            raise HpcError("PBS nodefile is invalid.")
        ranks, nodes = len(hostnames), len(set(hostnames))
        # PBS has no portable memory env; generated profiles record requested
        # per-node limits, verified against qstat's Resource_List.select.
        reply = command(["qstat", "-f", "-F", "json", job_id])
        try:
            job = json.loads(reply)["Jobs"][job_id]
            select = job["Resource_List"]["select"]
            chunks = str(select).split("+")
            total_nodes, total_ranks, total_memory = 0, 0, 0
            for chunk in chunks:
                fields = chunk.split(":")
                count = int(fields[0])
                resources = dict(field.split("=", 1) for field in fields[1:])
                mpiprocs = int(resources["mpiprocs"])
                if int(resources["ncpus"]) != mpiprocs or resources.get("ompthreads", "1") != "1":
                    raise ValueError("MPI/OpenMP allocation mismatch")
                memory = re.fullmatch(r"([0-9]+)(mb|gb)", resources["mem"].lower())
                if not memory:
                    raise ValueError("Unknown memory unit")
                total_nodes += count
                total_ranks += count * mpiprocs
                total_memory += count * int(memory[1]) * (1024 if memory[2] == "gb" else 1)
            if total_nodes != nodes or total_ranks != ranks:
                raise ValueError("PBS nodefile does not match allocation resources")
            memory_per_node = total_memory // nodes
        except (KeyError, TypeError, ValueError) as exc:
            raise HpcError("PBS allocation needs select=N:ncpus=R:mpiprocs=R:ompthreads=1:mem=Mmb matching its nodefile.") from exc
    else:
        raise HpcError("Scheduler must be slurm or pbs.")
    try:
        template = launcher_template(json.loads(os.environ.get("PHYNITE_MPI_LAUNCHER", "[]")))
    except ValueError as exc:
        raise HpcError("MPI launcher must be valid JSON.") from exc
    allowed = allowed_launchers(scheduler)
    if Path(template[0]).name not in allowed:
        raise HpcError("MPI launcher does not match the active scheduler.")
    declared = os.environ.get("PHYNITE_HPC_MAX_RANKS")
    if declared is not None:
        try:
            matches = int(declared) == ranks
        except ValueError:
            matches = False
        if not matches:
            raise HpcError("MPI rank grant does not match the active allocation.")
    if not re.fullmatch(r"[a-f0-9]{64}", os.environ.get("PHYNITE_HPC_PROFILE_SHA256", "")):
        raise HpcError("Active allocation must provide the exported HPC profile checksum.")
    return {"scheduler": scheduler, "jobId": job_id, "ranks": ranks, "nodes": nodes,
            "memoryMiB": memory_per_node * nodes, "profileSha256": os.environ["PHYNITE_HPC_PROFILE_SHA256"], "qualified": False}


def validate_job_resources(allocation: dict[str, Any], ranks: int, memory_mib: int) -> None:
    positive(ranks, "Requested MPI ranks")
    positive(memory_mib, "Requested memory MiB", 1_073_741_824)
    if ranks > allocation["ranks"] or memory_mib > allocation["memoryMiB"]:
        raise HpcError("Calculation requests more ranks or memory than this allocation; request a matching allocation or reduce the job resources.")


def command(argv: list[str]) -> str:
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HpcError(f"Scheduler command unavailable: {Path(argv[0]).name}") from exc
    if result.returncode:
        raise HpcError(f"Scheduler command failed: {Path(argv[0]).name}; {result.stderr.strip()[:300]}")
    return result.stdout.strip()


def job_id(value: str, scheduler: str) -> str:
    if scheduler not in {"pbs", "slurm"}:
        raise HpcError("Scheduler must be slurm or pbs.")
    pattern = r"[0-9]+(?:\.[A-Za-z0-9_.-]+)?" if scheduler == "pbs" else r"[0-9]+"
    if not re.fullmatch(pattern, value):
        raise HpcError("Scheduler returned an invalid job ID.")
    return value


def batch_script(profile: dict[str, Any], calculation_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", calculation_id):
        raise HpcError("Calculation ID is invalid.")
    scheduler = profile["scheduler"]
    ranks = profile["nodes"] * profile["ranksPerNode"]
    seconds = profile["wallSeconds"]
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds_remainder = divmod(remainder, 60)
    wall = f"{hours:02d}:{minutes:02d}:{seconds_remainder:02d}"
    name = "phynite-" + calculation_id[:40]
    if scheduler == "slurm":
        directives = [f"#SBATCH --job-name={name}", f"#SBATCH --nodes={profile['nodes']}", f"#SBATCH --ntasks-per-node={profile['ranksPerNode']}", "#SBATCH --cpus-per-task=1", f"#SBATCH --mem={profile['memoryMiBPerNode']}M", f"#SBATCH --time={wall}", "#SBATCH --signal=B:TERM@60", "#SBATCH --no-requeue"]
        if profile.get("queue"):
            directives.append(f"#SBATCH --partition={profile['queue']}")
        if profile.get("account"):
            directives.append(f"#SBATCH --account={profile['account']}")
    else:
        directives = [f"#PBS -N {name[:15]}", f"#PBS -l select={profile['nodes']}:ncpus={profile['ranksPerNode']}:mpiprocs={profile['ranksPerNode']}:ompthreads=1:mem={profile['memoryMiBPerNode']}mb", f"#PBS -l walltime={wall}", "#PBS -r n"]
        if profile.get("queue"):
            directives.append(f"#PBS -q {profile['queue']}")
        if profile.get("account"):
            directives.append(f"#PBS -A {profile['account']}")
    environment = {**profile.get("environment", {}), "PHYNITE_HPC_SCHEDULER": scheduler,
                   "PHYNITE_MPI_LAUNCHER": json.dumps(profile["mpiLauncher"], separators=(",", ":")),
                   "PHYNITE_HPC_MAX_RANKS": str(ranks), "PHYNITE_HPC_PROFILE_SHA256": canonical_digest(profile)}
    if profile.get("id"):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,95}", str(profile["id"])):
            raise HpcError("HPC profile ID is invalid.")
        environment["PHYNITE_HPC_PROFILE_ID"] = str(profile["id"])
    argv = [profile["python"], str(Path(profile["repository"]) / "backend/local_worker/worker.py"), "--runtime", "native", "--config", profile["workerConfig"], "--work-dir", str(Path(profile["workRoot"]) / calculation_id), "--pseudo-root", profile["pseudoRoot"], "--calculation-id", calculation_id, "--once", "--timeout-seconds", str(profile["wallSeconds"] - 90)]
    return "\n".join(["#!/bin/bash", *directives, "set -eu", "umask 077", *[f"export {key}={shlex.quote(value)}" for key, value in environment.items()], f"cd {shlex.quote(profile['repository'])}", "exec " + shlex.join(argv), ""])


def submit(profile: dict[str, Any], calculation_id: str, directory: Path) -> dict[str, Any]:
    directory.mkdir(parents=True, exist_ok=True)
    script = directory / f"{calculation_id}.sh"
    content = batch_script(profile, calculation_id)
    if script.exists():
        raise HpcError("Submission script already exists; inspect its receipt before retrying to avoid duplicate allocation.")
    descriptor = os.open(script, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(content)
    # An intent is durable before submitting. Uncertain replies must be reconciled
    # against the cluster, rather than issuing another allocation automatically.
    receipt = {"version": 1, "calculationId": calculation_id, "scheduler": profile["scheduler"], "profileSha256": canonical_digest(profile),
               "scriptSha256": hashlib.sha256(content.encode()).hexdigest(), "state": "submission-uncertain", "qualified": False}
    atomic_json(script.with_suffix(".json"), receipt)
    returned = command(["sbatch", "--parsable", str(script)] if profile["scheduler"] == "slurm" else ["qsub", str(script)])
    identifier = job_id(returned.split(";", 1)[0], profile["scheduler"])
    receipt.update({"schedulerJobId": identifier, "state": "submitted"})
    atomic_json(script.with_suffix(".json"), receipt)
    return receipt


def status(scheduler: str, identifier: str) -> dict[str, Any]:
    identifier = job_id(identifier, scheduler)
    if scheduler == "slurm":
        rows = command(["sacct", "--noheader", "--parsable2", "--allocations", "--jobs", identifier, "--format", "JobIDRaw,State,ExitCode"]).splitlines()
        entries = [row.split("|") for row in rows if row.split("|", 1)[0] == identifier]
        if not entries:
            return {"schedulerJobId": identifier, "state": "unknown", "qualified": False}
        if len(entries[-1]) < 3 or not entries[-1][1]:
            raise HpcError("Slurm returned an invalid status response.")
        raw_state, exit_code = entries[-1][1:3]
        state = raw_state.split()[0].rstrip("+")
    else:
        try:
            entry = json.loads(command(["qstat", "-x", "-f", "-F", "json", identifier]))["Jobs"][identifier]
            state, exit_code = entry["job_state"], str(entry.get("Exit_status", ""))
        except (ValueError, KeyError, TypeError) as exc:
            raise HpcError("PBS returned an invalid status response.") from exc
    return {"schedulerJobId": identifier, "state": state, "exitCode": exit_code, "qualified": False}


def cancel(scheduler: str, identifier: str) -> None:
    identifier = job_id(identifier, scheduler)
    command(["scancel" if scheduler == "slurm" else "qdel", identifier])


def capabilities() -> dict[str, Any]:
    result: dict[str, Any] = {"qualified": False, "mpiLaunchers": {name: bool(shutil.which(name)) for name in ("srun", "mpiexec")}, "solvers": {}, "gpuExecution": "unsupported"}
    for name in ("pw.x", "lmp", "lammps", "lmp_serial"):
        path = shutil.which(name)
        if path:
            from recovery import digest
            result["solvers"][name] = {"sha256": digest(Path(path).resolve())}
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export/submit owner-scoped Phynite jobs to your Slurm or OpenPBS cluster.")
    parser.add_argument("action", choices=("export", "submit", "status", "cancel", "capabilities"))
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--calculation-id")
    parser.add_argument("--directory", type=Path, default=Path("hpc-jobs"))
    parser.add_argument("--scheduler", choices=("slurm", "pbs"))
    parser.add_argument("--job-id")
    args = parser.parse_args(argv)
    if args.action == "capabilities":
        result = capabilities()
    elif args.action in {"export", "submit"}:
        if not args.profile or not args.calculation_id:
            raise HpcError("Export/submit requires --profile and --calculation-id.")
        profile = load_profile(args.profile)
        if args.action == "export":
            result = {"script": batch_script(profile, args.calculation_id), "qualified": False}
        else:
            result = submit(profile, args.calculation_id, args.directory)
    else:
        if not args.scheduler or not args.job_id:
            raise HpcError("Status/cancel requires --scheduler and --job-id.")
        if args.action == "cancel":
            cancel(args.scheduler, args.job_id)
            result = {"schedulerJobId": args.job_id, "state": "cancel-requested"}
        else:
            result = status(args.scheduler, args.job_id)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HpcError, OSError, ValueError) as exc:
        print(f"HPC adapter failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
