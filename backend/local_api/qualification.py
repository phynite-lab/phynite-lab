"""Fixed, opt-in scientific release checks executed by the installed native core.

These diagnostics operate only in a harness-marked disposable workspace. They
invoke installed scientific interpreters, the packaged unmodified runners, real
OS confinement and persistent admission. A JSON report supplied by a caller is
never accepted as execution evidence.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time
from typing import Any, Callable

from .runtime import RuntimeInstallError, RuntimeManager, runtime_platform
from .sandbox import NativeSandbox, SandboxError
from .scheduler import ResourceError, ResourceScheduler


ROOT = Path(__file__).resolve().parents[2]
CHECKS = ("qe-reference", "md-guided-reference", "md-manual-reference", "analysis-reference",
          "sandbox-probe", "sandbox-denials", "cancel-resource-recovery", "installer-failure-recovery")
ENERGY = re.compile(r"!\s+total energy\s+=\s+([-+0-9.EeDd]+)\s+Ry")
HASH = re.compile(r"[a-f0-9]{64}")


def sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def checked_number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a real finite number.")
    return float(value)


def numerical_measurement(name: str, unit: str, value: Any, expected: Any, tolerance: Any) -> dict:
    actual = checked_number(value, name)
    baseline = checked_number(expected, name + " reference")
    bound = checked_number(tolerance, name + " tolerance")
    if bound < 0 or abs(actual - baseline) > bound:
        raise ValueError(f"{name}: observed {actual:.17g} {unit}, expected {baseline:.17g} ± {bound:.17g} {unit}.")
    return {"name": name, "unit": unit, "value": actual, "expected": baseline, "tolerance": bound}


def lj_reference(epsilon_ev: float = 0.0103, sigma_angstrom: float = 3.4) -> dict:
    """Analytical two-particle, unshifted LJ minimum; no observed input is used."""
    epsilon = checked_number(epsilon_ev, "epsilon")
    sigma = checked_number(sigma_angstrom, "sigma")
    if min(epsilon, sigma) <= 0:
        raise ValueError("LJ reference parameters must be positive.")
    return {"source": "V(r)=4*epsilon*((sigma/r)^12-(sigma/r)^6), r=2^(1/6)*sigma; two stationary Ar particles in a 40 angstrom periodic box, cutoff 8.5 angstrom, no periodic image in cutoff",
            "epsilonEv": epsilon, "sigmaAngstrom": sigma, "separationAngstrom": 2**(1/6) * sigma,
            "expectedPotentialEnergyEv": -epsilon, "absoluteToleranceEv": 1e-10,
            "expectedKineticEnergyEv": 0.0, "expectedAtoms": 2}


def source_snapshot() -> dict:
    reference = lj_reference()
    return {"schemaVersion": 1, "kind": "phynite-md-frame", "units": {"length": "angstrom", "time": "ps"},
            "frame": {"hasCell": True, "ids": ["1", "2"], "species": ["Ar", "Ar"],
                      "positions": [10, 10, 10, 10 + reference["separationAngstrom"], 10, 10],
                      "vectors": [[40, 0, 0], [0, 40, 0], [0, 0, 40]], "origin": [0, 0, 0],
                      "periodic": [True, True, True], "sourceUnits": "metal",
                      "properties": {"Mass": [39.948, 39.948]}, "propertyUnits": {"mass": "amu"}}}


def md_input(mode: str) -> dict:
    workflow = {"version": 2, "mode": mode, "units": "metal", "boundaryType": "p p p",
                "potential": {"kind": "builtin", "id": "lj-generic", "epsilonEv": 0.0103,
                              "sigmaAngstrom": 3.4, "cutoffAngstrom": 8.5},
                "steps": [{"id": "stationary-nve", "kind": "nve", "name": "Stationary analytical LJ pair",
                           "enabled": True, "params": {"timestepFs": 1.0, "totalSteps": 5}}],
                "output": {"thermoFrequency": 1, "dumpFrequency": 1}}
    if mode == "manual":
        workflow["manualBody"] = "timestep 0.001\nfix pair_integrator all nve\nrun 5\nunfix pair_integrator\n"
    identity = "release-" + mode
    return {"kind": "md-simulation", "version": 2, "simulationId": identity, "calculationId": identity,
            "localSourcePath": "source.phynite-md.json", "workflow": workflow}


def verify_result_artifacts(root: Path, result: dict) -> list[dict]:
    """Verify the application's actual declared bytes, without trusting its status."""
    inventory = result.get("artifacts")
    if not isinstance(inventory, list) or not inventory:
        raise ValueError("A reference result has no retained artifact inventory.")
    verified = []
    for item in inventory:
        relative = item.get("path", "")
        if not isinstance(relative, str) or not relative or "\\" in relative or Path(relative).is_absolute() or any(part in {"..", "."} for part in relative.split("/")):
            raise ValueError("Unsafe scientific result artifact path.")
        path = root / relative
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("A scientific result artifact is absent or unsafe.")
        if item.get("sha256") != sha256(path) or item.get("sizeBytes") != path.stat().st_size:
            raise ValueError("A scientific result artifact differs from its application checksum/size.")
        verified.append({"path": relative, "sizeBytes": path.stat().st_size, "sha256": sha256(path)})
    return verified


class Qualification:
    def __init__(self, data: Path, output: Path, fixture: Path, timeout: int):
        self.data, self.output, self.fixture, self.timeout = data.resolve(), output.resolve(), fixture.resolve(), timeout
        self.manager = RuntimeManager(data, ROOT / "backend/local_api/runtime-manifest.json")
        self.sandbox = NativeSandbox(data, (ROOT, self.manager.root))
        self.checks: list[dict] = []

    def attach(self, path: Path, kind: str) -> dict:
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(self.output):
            raise ValueError("An evidence attachment must be a real regular file within the report directory.")
        return {"kind": kind, "path": path.resolve().relative_to(self.output).as_posix(), "sha256": sha256(path)}

    def check(self, check_id: str, function: Callable[[Path], dict]) -> None:
        directory = self.output / check_id
        directory.mkdir(mode=0o700)
        try:
            record = function(directory)
            record.update(id=check_id, status="passed")
            self.checks.append(record)
        except Exception as error:
            failure = directory / "failure.json"
            message = f"{type(error).__name__}: {error}"[:500]
            write_json(failure, {"passed": False, "error": message})
            attachments = [self.attach(failure, "log")]
            # Preserve actual failed job output as diagnostics too.
            result = directory / "job/results/result.json"
            if result.is_file():
                attachments.append(self.attach(result, "output"))
            self.checks.append({"id": check_id, "status": "failed", "error": message, "execution": {"returnCode": 1}, "attachments": attachments})
        write_json(self.output / "checks.json", {"passed": all(item["status"] == "passed" for item in self.checks), "checks": self.checks})

    def environment(self, component: str, job: Path) -> tuple[str, dict[str, str]]:
        # Use only the registered, immutable scientific Python; never python on PATH.
        installed = self.manager.environment()
        python = installed.get("PHYNITE_RUNTIME_PYTHON_" + component.upper())
        # The reviewed MD bundle supplies both LAMMPS and OVITO, as in the worker.
        if not python and component == "analysis":
            python = installed.get("PHYNITE_RUNTIME_PYTHON_MD")
        if not python or not Path(python).is_file() or not Path(python).resolve().is_relative_to(self.manager.root):
            raise RuntimeError(f"The installed {component} scientific runtime is unavailable.")
        from backend.local_worker.worker import native_environment
        with_env = dict(os.environ)
        try:
            os.environ.update(installed, PHYNITE_APP_MODE="local")
            environment = native_environment(job, job.name, 1, 2048, self.timeout)
        finally:
            os.environ.clear()
            os.environ.update(with_env)
        environment.update(QT_QPA_PLATFORM="offscreen", PHYNITE_EXECUTION_MODE="local-native-sandbox")
        return python, environment

    def execute(self, directory: Path, component: str, source: str, payload: dict, files: dict[str, Path | dict]) -> tuple[dict, Path, Path]:
        job = directory / "job"
        job.mkdir(mode=0o700)
        write_json(job / "input.json", payload)
        for name, contents in files.items():
            path = job / name
            path.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(contents, Path):
                shutil.copyfile(contents, path)
            else:
                write_json(path, contents)
        python, environment = self.environment(component, job)
        script = ROOT / "backend" / source
        if not script.is_file():
            raise RuntimeError("The installed package is missing its reviewed scientific runner source.")
        command = self.sandbox.command(job, [python, str(script)])
        log = directory / "execution.log"
        scheduler = ResourceScheduler(directory / "scheduler")
        process = None
        try:
            scheduler.configure({"vcpus": 1, "memoryMiB": min(2048, scheduler.capacity()["memoryCapacityMiB"]), "maxParallelJobs": 1})
            scheduler.reserve(job.name)
            with log.open("w") as output:
                output.write(json.dumps({"runner": source, "command": command, "runnerSourceSha256": sha256(script)}) + "\n")
                output.flush()
                process = subprocess.Popen(command, cwd=job, env=environment, stdin=subprocess.DEVNULL,
                                           stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            scheduler.attach(job.name, process.pid)
            deadline = time.monotonic() + self.timeout
            while process.poll() is None:
                scheduler.poll()
                if time.monotonic() > deadline:
                    scheduler.cancel(job.name)
                    raise RuntimeError("Scientific qualification exceeded its predeclared wall-clock limit.")
                time.sleep(0.1)
            if scheduler.job(job.name)["status"] == "failed":
                raise RuntimeError(scheduler.job(job.name)["reason"])
            scheduler.release(job.name, "completed" if process.returncode == 0 else "failed")
            write_json(directory / "execution.json", {"returnCode": process.returncode, "command": command, "runnerSourceSha256": sha256(script), "resource": scheduler.job(job.name)})
            if process.returncode != 0:
                raise RuntimeError(f"The real {component} runner exited {process.returncode}; inspect retained output and execution.log.")
            result_path = job / "results/result.json"
            result = json.loads(result_path.read_text())
            if result.get("status") != "completed" or result.get("syntheticData") is True or result.get("provenance", {}).get("syntheticData") is True:
                raise ValueError("The real scientific runner did not report completed non-synthetic output.")
            verify_result_artifacts(result_path.parent, result)
            return result, result_path, log
        finally:
            if process is not None and process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=10)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=10)
            scheduler.close()

    def reference_record(self, directory: Path, engine: str, output: Path, input_file: Path, log: Path, measurements: list[dict], extra: dict | None = None) -> dict:
        numeric, provenance = directory / "numeric.json", directory / "provenance.json"
        write_json(numeric, {"measurements": measurements})
        write_json(provenance, {"engine": engine, "returnCode": 0, "inputSha256": sha256(input_file),
                                "outputSha256": sha256(output), **(extra or {})})
        return {"execution": {"returnCode": 0}, "attachments": [self.attach(output, "output"), self.attach(input_file, "input"), self.attach(provenance, "provenance"), self.attach(numeric, "numeric"), self.attach(log, "log"), self.attach(directory / "reference.json", "reference")]}

    def qe(self, directory: Path) -> dict:
        fixture = json.loads((self.fixture / "fixture.json").read_text())
        expected = checked_number(fixture.get("expectedEnergyRy"), "independent QE reference")
        tolerance = checked_number(fixture.get("absoluteToleranceRy"), "QE tolerance")
        if fixture.get("schemaVersion") != 1 or tolerance <= 0 or not isinstance(fixture.get("referenceSource"), str) or not fixture["referenceSource"].startswith("https://"):
            raise ValueError("A pinned independent QE input/model/reference contract is required.")
        inputs, references, pseudos = [], [], []
        for item in fixture.get("files", []):
            name = item.get("name", "")
            if not name or Path(name).name != name or name in {".", ".."} or "\\" in name:
                raise ValueError("Unsafe QE fixture path.")
            source = self.fixture / name
            if source.is_symlink() or not HASH.fullmatch(item.get("sha256", "")) or sha256(source) != item["sha256"]:
                raise ValueError("The QE fixture differs from the predeclared checksum contract.")
            {"input": inputs, "reference": references, "pseudopotential": pseudos}[item["role"]].append(source)
        if len(inputs) != 1 or len(references) != 1 or not pseudos:
            raise ValueError("QE qualification needs one exact independent input/reference and all models.")
        reference_energy = ENERGY.findall(references[0].read_text())
        if not reference_energy or float(reference_energy[-1].replace("D", "E")) != expected:
            raise ValueError("The independent upstream output does not establish the declared expected energy.")
        contract = {**fixture, "frozenBeforeCandidate": True, "ioPathChangesOnly": {"pseudo_dir": "./pseudo", "outdir": "./tmp", "prefix": "phynite"}}
        write_json(directory / "reference.json", contract)
        text = inputs[0].read_text()
        # These are IO paths only; preserve every physical parameter and default.
        for name, value in (("pseudo_dir", "./pseudo"), ("outdir", "./tmp"), ("prefix", "phynite")):
            if re.search(rf"\b{name}\s*=", text, re.I):
                text = re.sub(rf"\b{name}\s*=\s*['\"][^'\"]*['\"]", f"{name}='{value}'", text, count=1, flags=re.I)
            else:
                text = re.sub(r"&control\b", f"&control\n {name}='{value}',", text, count=1, flags=re.I)
        payload = {"calculationId": "release-qe", "calculationType": "Total energy", "inputFiles": {"scf.in": text}, "settings": {}}
        result, output, log = self.execute(directory, "dft", "compute/local_runner.py", payload, {"pseudo/" + path.name: path for path in pseudos})
        actual = result.get("summary", {}).get("totalEnergyRy")
        if result.get("summary", {}).get("converged") is not True or result.get("summary", {}).get("jobDone") is not True:
            raise ValueError("QE did not produce actual convergence and positive stage completion evidence.")
        raw_log = output.parent / "logs/scf.out"
        independently_read = ENERGY.findall(raw_log.read_text())
        if not independently_read:
            raise ValueError("The retained QE log lacks a finite final energy.")
        measurements = [numerical_measurement("total energy vs upstream QE test-suite", "Ry", actual, expected, tolerance),
                        numerical_measurement("application energy vs independently parsed retained QE log", "Ry", actual, float(independently_read[-1].replace("D", "E")), 1e-10)]
        record = self.reference_record(directory, "Quantum ESPRESSO", output, directory / "job/input.json", raw_log, measurements,
                                       {"referenceSource": fixture["referenceSource"], "models": [{"filename": path.name, "sha256": sha256(path)} for path in pseudos], "solver": result.get("provenance", {}), "artifacts": verify_result_artifacts(output.parent, result)})
        record["attachments"].append(self.attach(output.parent / "inputs/scf.in", "executed-input"))
        return record

    def md(self, directory: Path, mode: str) -> dict:
        reference = lj_reference()
        write_json(directory / "reference.json", {**reference, "frozenBeforeCandidate": True, "mode": mode, "dynamicsSteps": 5, "timestepFs": 1})
        result, output, log = self.execute(directory, "md", "md_local/runner.py", md_input(mode), {"source.phynite-md.json": source_snapshot()})
        thermo = json.loads((output.parent / "thermo.json").read_text())
        if len(thermo) < 2 or int(thermo[-1]["step"]) != 5:
            raise ValueError("LAMMPS did not execute and retain the requested five real dynamics steps.")
        measurements = [numerical_measurement("particle count", "atoms", result.get("summary", {}).get("atoms"), 2, 0)]
        for index, row in enumerate(thermo):
            measurements.extend([numerical_measurement(f"potential energy sample {index}", "eV", row.get("potentialEnergyEv"), reference["expectedPotentialEnergyEv"], reference["absoluteToleranceEv"]),
                                 numerical_measurement(f"kinetic energy sample {index}", "eV", row.get("kineticEnergyEv"), 0, 1e-10)])
        measurements.append(numerical_measurement("elapsed physical time", "ps", thermo[-1].get("timePs"), 0.005, 1e-12))
        record = self.reference_record(directory, "LAMMPS", output, directory / "job/input.json", output.parent / "log.lammps", measurements,
                                       {"solver": result["provenance"], "sourceSha256": sha256(directory / "job/source.phynite-md.json"), "artifacts": verify_result_artifacts(output.parent, result)})
        record["attachments"].extend([self.attach(output.parent / "in.lammps", "executed-input"), self.attach(output.parent / "thermo.json", "thermo"), self.attach(directory / "job/source.phynite-md.json", "source")])
        return record

    def analysis(self, directory: Path) -> dict:
        source = directory / "source.phynite-md.json"
        write_json(source, source_snapshot())
        write_json(directory / "reference.json", {"source": "The known two-atom frame has one neighbour per atom within 4 angstrom; their analytical separation is 2^(1/6)*3.4 angstrom, all periodic images are outside 4 angstrom.", "frozenBeforeCandidate": True, "expectedCoordination": 1, "expectedAtomFrames": 2, "expectedFrames": 1})
        payload = {"version": 1, "analysisId": "release-analysis", "calculationId": "release-analysis", "projectId": "release-project",
                   "localSourcePath": source.name, "source": {"id": "release-source", "objectKey": "qualification/source", "filename": source.name, "sha256": sha256(source), "sizeBytes": source.stat().st_size},
                   "pipeline": {"version": 1, "modifiers": [{"kind": "coordination", "enabled": True, "params": {"cutoff": 4, "bins": 20}}]}}
        result, output, log = self.execute(directory, "analysis", "md_local/analysis_runner.py", payload, {source.name: source})
        measurements = [numerical_measurement("analysed frames", "frames", result.get("frameCount"), 1, 0), numerical_measurement("analysed particle frames", "atom frames", result.get("atomFrames"), 2, 0)]
        timeline_record = next(value for value in result["artifacts"] if value.get("role") == "timeline")
        with gzip.open(output.parent / timeline_record["path"], "rt") as handle:
            timeline = json.load(handle)
        # The pipeline retains computed per-frame statistics in its timeline.
        if not isinstance(timeline, dict) or not isinstance(timeline.get("frames"), list) or len(timeline["frames"]) != 1:
            raise ValueError("Analysis did not retain the exact single-frame numerical timeline.")
        measurements.append(numerical_measurement("mean coordination number", "neighbours/atom", timeline["frames"][0]["attributes"].get("mean coordination"), 1, 1e-12))
        record = self.reference_record(directory, "OVITO", output, directory / "job/input.json", log, measurements,
                                       {"engineIdentity": result.get("engine"), "sourceSha256": sha256(source), "artifacts": verify_result_artifacts(output.parent, result)})
        record["attachments"].extend([self.attach(source, "source"), self.attach(output.parent / timeline_record["path"], "timeline")])
        return record

    def sandbox_probe(self, directory: Path) -> dict:
        result = self.sandbox.probe(refresh=True)
        path = directory / "probe.json"
        write_json(path, result)
        if result.get("available") is not True:
            raise SandboxError(result.get("reason", "OS sandbox probe unavailable."))
        return {"execution": {"returnCode": 0}, "attachments": [self.attach(path, "output")]}

    def sandbox_denials(self, directory: Path) -> dict:
        job = directory / "job"
        job.mkdir()
        sentinel = directory / "outside.txt"
        sentinel.write_text("must remain unchanged")
        python, environment = self.environment("md", job)
        script = """import json,pathlib,socket,sys
job,outside,runtime=map(pathlib.Path,sys.argv[1:]); checks={}
(job/'allowed.txt').write_text('allowed')
for name,path in [('outsideWriteDenied',outside),('runtimeWriteDenied',runtime)]:
 try:path.write_text('forbidden');checks[name]=False
 except OSError:checks[name]=True
try:
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as connection:connection.connect(('198.51.100.1',9))
 checks['externalNetworkDenied']=False
except OSError:checks['externalNetworkDenied']=True
print(json.dumps(checks))
"""
        runtime_write = Path(python).parent / "qualification-must-not-write"
        if runtime_write.exists():
            raise RuntimeError("Unexpected existing runtime probe file; qualification refuses to overwrite it.")
        command = self.sandbox.command(job, [python, "-c", script, str(job), str(sentinel), str(runtime_write)])
        process = subprocess.run(command, cwd=job, env=environment, capture_output=True, text=True, timeout=30)
        write_json(directory / "confinement.json", {"returnCode": process.returncode, "stdout": process.stdout, "stderr": process.stderr})
        flags = json.loads(process.stdout) if process.returncode == 0 else {}
        if not all(flags.get(key) is True for key in ("outsideWriteDenied", "runtimeWriteDenied", "externalNetworkDenied")) or sentinel.read_text() != "must remain unchanged" or runtime_write.exists():
            raise SandboxError("Actual runtime process failed its confinement checks.")
        from .domain.api import normalize_md_manual_body
        from .domain.phynite_core import ApiError
        rejected = []
        attacks = ("shell touch outside", "python invoke", "include ../outside", "jump /tmp/outside", "variable x file ../outside", "dump evil all atom 1 log.lammps", "log /tmp/outside", "run 5 every 1 'shell touch outside'")
        for text in attacks:
            try:
                normalize_md_manual_body(text)
            except (ValueError, RuntimeError, ApiError):
                rejected.append(text)
            else:
                raise ValueError("A dangerous manual command passed the server preflight.")
        # Repeat the same payloads in the actual installed scientific runner;
        # denial must occur before any result or outside write is possible.
        runtime_rejections = []
        for index, text in enumerate(attacks):
            attempt = directory / f"preflight-{index}"
            attempt.mkdir()
            payload = md_input("manual")
            payload["workflow"]["manualBody"] = text
            write_json(attempt / "input.json", payload)
            write_json(attempt / "source.phynite-md.json", source_snapshot())
            _, env = self.environment("md", attempt)
            process = subprocess.run(self.sandbox.command(attempt, [python, str(ROOT / "backend/md_local/runner.py")]), cwd=attempt,
                                     env=env, capture_output=True, text=True, timeout=60)
            result = json.loads((attempt / "results/result.json").read_text())
            if process.returncode == 0 or result.get("status") != "failed" or (attempt / "results/in.lammps").exists():
                raise ValueError("The installed scientific runner did not reject unsafe manual input before execution.")
            runtime_rejections.append({"command": text, "returnCode": process.returncode, "error": result.get("error"), "resultSha256": sha256(attempt / "results/result.json")})
        path = directory / "denials.json"
        write_json(path, {"actualConfinement": flags, "apiRejected": rejected, "installedRunnerRejected": runtime_rejections})
        return {"execution": {"returnCode": 0}, "attachments": [self.attach(path, "output"), self.attach(directory / "confinement.json", "log")]}

    def resources(self, directory: Path) -> dict:
        job = directory / "job"
        job.mkdir()
        retained = job / "retained-input.txt"
        retained.write_text("This file must survive cancel and recovery.")
        python, environment = self.environment("md", job)
        scheduler = ResourceScheduler(directory / "scheduler")
        processes = []
        observations: dict[str, Any] = {}
        try:
            memory = min(512, scheduler.capacity()["memoryCapacityMiB"])
            scheduler.configure({"vcpus": 1, "memoryMiB": memory, "maxParallelJobs": 1})
            scheduler.reserve("cancel", 1, memory)
            process = subprocess.Popen([python, "-c", "import time;time.sleep(60)"], cwd=job, env=environment, start_new_session=True)
            processes.append(process)
            scheduler.attach("cancel", process.pid)
            try:
                scheduler.reserve("must-stay-queued", 1, memory)
            except ResourceError as error:
                if error.code != "RESOURCE_BUSY":
                    raise
                observations["parallelAdmissionDenied"] = True
            else:
                raise ValueError("A second job exceeded the active aggregate resource budget.")
            observations["cancel"] = scheduler.cancel("cancel")
            process.wait(timeout=15)
            if observations["cancel"]["status"] != "cancelled" or not retained.exists():
                raise ValueError("Cancel did not stop the real process and retain its input.")
            # A real process exceeds a deliberately tiny watchdog budget.
            scheduler.reserve("rss-watchdog", 1, 1)
            process = subprocess.Popen([python, "-c", "import time;x=bytearray(8*1024*1024);time.sleep(60)"], cwd=job, env=environment, start_new_session=True)
            processes.append(process)
            scheduler.attach("rss-watchdog", process.pid)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and scheduler.job("rss-watchdog")["status"] == "running":
                scheduler.poll()
                time.sleep(0.05)
            process.wait(timeout=15)
            observations["rssWatchdog"] = scheduler.job("rss-watchdog")
            if observations["rssWatchdog"]["status"] != "failed" or "RSS" not in observations["rssWatchdog"]["reason"]:
                raise ValueError("The actual process-tree RSS watchdog did not stop the over-budget process.")
            scheduler.reserve("recovery", 1, memory)
            process = subprocess.Popen([python, "-c", "import time;time.sleep(60)"], cwd=job, env=environment, start_new_session=True)
            processes.append(process)
            scheduler.attach("recovery", process.pid)
            scheduler.close()
            scheduler = ResourceScheduler(directory / "scheduler")
            observations["afterRestart"] = scheduler.job("recovery")
            if observations["afterRestart"]["status"] != "recovery-required" or observations["afterRestart"]["pid"] != process.pid:
                raise ValueError("Restart did not preserve the original process identity for explicit recovery.")
            scheduler.cancel("recovery")
            process.wait(timeout=15)
            scheduler.reserve("interrupted", 1, memory)
            scheduler.close()
            scheduler = ResourceScheduler(directory / "scheduler")
            observations["interrupted"] = scheduler.job("interrupted")
            if observations["interrupted"]["status"] != "interrupted" or not retained.exists():
                raise ValueError("An interrupted reservation was replayed or its retained input disappeared.")
            path = directory / "resources.json"
            write_json(path, observations)
            return {"execution": {"returnCode": 0}, "attachments": [self.attach(path, "output"), self.attach(retained, "input")]}
        finally:
            for process in processes:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=15)
            scheduler.close()

    def installer_failures(self, directory: Path) -> dict:
        """Real installer fault injection with a native executable, no fake solver.

        The production conda installer is forced to download corrupt/truncated
        bytes for an inactive lock. Then the actual locked MD packages are
        installed/qualified in a new prefix and final activation is denied.
        Every failure must retain the actual active scientific prefix.
        Fault injection is explicitly recorded and never treated as science.
        """
        active = self.manager.root / "active.json"
        if not active.is_file() or not self.manager._active():
            raise RuntimeError("Install a real scientific runtime before checking update preservation.")
        before = active.read_bytes()
        actual = self.manager._manifest()
        component = "md"
        target = runtime_platform()
        entry = json.loads(json.dumps(actual["components"][component][target]))
        if entry.get("format") != "conda-lock":
            raise RuntimeError("This release must qualify the locked scientific-runtime installer.")
        events = []
        original_downloader, original_manifest = self.manager.downloader, self.manager.manifest_path
        try:
            for label, body in (("wrong-checksum", b"corrupted"), ("interrupted-download", b"")):
                candidate = json.loads(json.dumps(entry))
                candidate["version"] = "qualification-" + label
                if label == "wrong-checksum":
                    # Keep the genuine pinned digests, but inject equal-size
                    # incorrect bytes with a small explicit test-only bound.
                    for record in [candidate["installer"], *candidate["packages"]]:
                        record["sizeBytes"] = len(body)
                manifest = directory / (label + ".json")
                write_json(manifest, {"schemaVersion": 1, "components": {component: {target: candidate}}})
                self.manager.manifest_path = manifest
                calls = []
                def broken_download(url: str):
                    calls.append(url)
                    if label == "interrupted-download":
                        raise OSError("Injected connection interruption before completion")
                    return io.BytesIO(body)
                self.manager.downloader = broken_download
                try:
                    self.manager.install(component)
                except (RuntimeInstallError, OSError) as error:
                    if not calls or active.read_bytes() != before:
                        raise ValueError("The installed conda runtime was changed by a failed update or no download fault was exercised.")
                    events.append({"fault": label, "error": str(error), "downloadCalls": len(calls), "activeUnchanged": True})
                else:
                    raise ValueError("A corrupt/interrupted conda runtime update was accepted.")
        finally:
            self.manager.downloader, self.manager.manifest_path = original_downloader, original_manifest
        # Reinstall the genuine pinned scientific packages in an inactive
        # prefix. Only the final inventory replace is denied; package checks,
        # scientific imports and executable qualification must really succeed.
        candidate = json.loads(json.dumps(entry))
        candidate["version"] = "qualification-atomic-activation"
        manifest = directory / "atomic-activation.json"
        write_json(manifest, {"schemaVersion": 1, "components": {component: {target: candidate}}})
        replace = os.replace
        activation_reached = False
        def deny_activation(source, destination):
            nonlocal activation_reached
            if Path(destination) == active:
                activation_reached = True
                raise OSError("Injected atomic activation failure after real scientific runtime qualification")
            return replace(source, destination)
        try:
            self.manager.manifest_path = manifest
            os.replace = deny_activation
            try:
                self.manager.install(component)
            except OSError as error:
                if not activation_reached or active.read_bytes() != before:
                    raise ValueError("The real scientific runtime did not reach final activation or its prior inventory changed.") from error
                inactive = self.manager.root / self.manager._progress["inactiveDirectory"]
                qualification = inactive / "qualification.log"
                if not qualification.is_file() or not (inactive / "runtime-lock.json").is_file():
                    raise ValueError("The inactive candidate lacks actual successful scientific import/lock evidence.")
                # Retain only diagnostic text as a release attachment; the
                # entire inactive runtime stays private in the raw test data.
                shutil.copyfile(qualification, directory / "activation-qualification.log")
                events.append({"fault": "atomic-activation", "error": str(error), "activeUnchanged": True,
                               "candidateRuntimeLockSha256": sha256(inactive / "runtime-lock.json"),
                               "qualificationLogSha256": sha256(qualification)})
            else:
                raise ValueError("The injected scientific runtime activation failure was not reached.")
        finally:
            os.replace = replace
            self.manager.manifest_path = original_manifest
        if active.read_bytes() != before:
            raise ValueError("Scientific runtime inventory changed during failure checks.")
        path = directory / "installer-failures.json"
        write_json(path, {"events": events, "activeSha256Before": hashlib.sha256(before).hexdigest(), "activeSha256After": sha256(active)})
        return {"execution": {"returnCode": 0}, "attachments": [self.attach(path, "output"), self.attach(directory / "activation-qualification.log", "log")]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--qe-fixture", type=Path, required=True)
    parser.add_argument("--timeout-seconds", type=int, default=3600)
    args = parser.parse_args(argv)
    data = args.data_dir.resolve(strict=True)
    marker = data / ".release-qualification"
    if not marker.is_file() or marker.is_symlink() or not 30 <= args.timeout_seconds <= 14400:
        parser.error("Scientific release diagnostics require a marked disposable harness workspace and bounded timeout.")
    output = args.output.resolve()
    output.mkdir(mode=0o700)  # An existing destination is never overwritten.
    qualification = Qualification(data, output, args.qe_fixture.resolve(), args.timeout_seconds)
    cases = {"qe-reference": qualification.qe, "md-guided-reference": lambda path: qualification.md(path, "guided"),
             "md-manual-reference": lambda path: qualification.md(path, "manual"), "analysis-reference": qualification.analysis,
             "sandbox-probe": qualification.sandbox_probe, "sandbox-denials": qualification.sandbox_denials,
             "cancel-resource-recovery": qualification.resources, "installer-failure-recovery": qualification.installer_failures}
    for check_id in CHECKS:
        qualification.check(check_id, cases[check_id])
    return 0 if all(item["status"] == "passed" for item in qualification.checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
