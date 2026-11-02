from __future__ import annotations

import argparse
import copy
import base64
import fcntl
import hashlib
import json
import mimetypes
import os
import platform
import re
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tarfile
import time
import math
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "compute"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from qe_model import parse_upf_header, validate_qe_models, strip_qe_comments
import recovery

try:
    import psutil
except ImportError:
    psutil = None


ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
DEFAULT_IMAGE = "phynite-qe:local"
DEFAULT_MD_IMAGE = "phynite-md:local"
MD_RUNNER_PROTOCOL = 1
MD_WORKFLOW_VERSIONS = (1, 2)
DEFAULT_WORK_ROOT = Path(__file__).resolve().parents[1] / ".artifacts" / "local-worker"
DEFAULT_PSEUDO_ROOT = Path(__file__).resolve().parents[1] / ".artifacts" / "pseudos"
LOCAL_ARTIFACT_RETENTION_SECONDS = 3 * 24 * 60 * 60
LEASE_HEARTBEAT_SECONDS = 15
EXPECTED_LOGS = {
    "Nudged elastic band": ["neb.out"],
    "Total energy": ("scf.out",),
    "Structural relaxation": ("relax.out",),
    "Band structure": ("scf.out", "bands-nscf.out", "bands-postprocess.out"),
    "Density of states": ("scf.out", "dos-nscf.out", "dos-postprocess.out"),
    "Phonon dispersion": ("scf.out", "phonon.out", "force-constants.out", "phonon-dispersion.out"),
    "Thermoelectric properties": (
        "scf.out",
        "nscf-transport.out",
        "boltztrap2-interpolate.out",
        "boltztrap2-integrate.out",
    ),
}


class WorkerError(RuntimeError):
    pass


def file_digest(path: Path, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def worker_ssl_context() -> ssl.SSLContext:
    if os.environ.get("PHYNITE_APP_MODE") == "local":
        from backend.local_api.tls import verified_ssl_context
        return verified_ssl_context()
    candidates: list[Path] = []
    configured = os.environ.get("SSL_CERT_FILE")
    if configured:
        candidates.append(Path(configured).expanduser())
    try:
        import certifi

        candidates.append(Path(certifi.where()))
    except ImportError:
        pass
    candidates.extend(
        (
            Path("/etc/ssl/cert.pem"),
            Path("/etc/ssl/certs/ca-certificates.crt"),
            Path("/opt/homebrew/etc/ca-certificates/cert.pem"),
        )
    )
    for candidate in candidates:
        if candidate.is_file():
            return ssl.create_default_context(cafile=str(candidate))
    return ssl.create_default_context()


class ApiClient:
    def __init__(self, base_url: str, token: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.ssl_context = worker_ssl_context()

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Phynite-Worker-Token": self.token,
            },
        )
        try:
            with urllib.request.urlopen(
                request, timeout=self.timeout, context=self.ssl_context
            ) as response:
                body = response.read(5_000_001)
        except urllib.error.HTTPError as exc:
            body = exc.read(1_000_001)
            try:
                message = json.loads(body).get("error")
            except (UnicodeDecodeError, json.JSONDecodeError):
                message = None
            raise WorkerError(message or f"Worker API returned HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise WorkerError(f"Worker API is unreachable: {exc.reason}") from exc
        except (TimeoutError, socket.timeout, ssl.SSLError) as exc:
            raise WorkerError("Worker API request timed out") from exc
        if len(body) > 5_000_000:
            raise WorkerError("Worker API response is unexpectedly large")
        try:
            parsed = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkerError("Worker API returned invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise WorkerError("Worker API returned an invalid response")
        return parsed

    def download(self, url: str, destination: Path, maximum_bytes: int = 2_000_000_000) -> None:
        desktop = os.environ.get("PHYNITE_APP_MODE") == "local"
        if desktop:
            desktop_artifact_url(url, self.base_url)
        destination.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={"Accept": "application/octet-stream"})
        try:
            transfer = urllib.request.build_opener(NoArtifactRedirect()).open(request, timeout=120) if desktop else urllib.request.urlopen(request, timeout=120, context=self.ssl_context)
            with transfer as response, destination.open("wb") as output:
                total = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > maximum_bytes:
                        raise WorkerError(f"Download exceeds the local worker limit: {destination.name}")
                    output.write(chunk)
        except Exception:
            destination.unlink(missing_ok=True)
            raise

    def upload(self, url: str, source: Path, content_type: str, retention_tag: str = "phynite-retention=calculation-output") -> None:
        signed_headers = presigned_url_headers(url, self.base_url == 'http://127.0.0.1:8792' and os.environ.get('PHYNITE_LOCAL_API') == 'true', local_origin=self.base_url if os.environ.get("PHYNITE_APP_MODE") == "local" else None)
        headers = ["Content-Type", content_type]
        if "x-amz-checksum-sha256" in signed_headers:
            headers.extend(["x-amz-checksum-sha256", base64.b64encode(bytes.fromhex(sha256_file(source))).decode()])
        if "x-amz-server-side-encryption" in signed_headers:
            headers.extend(["x-amz-server-side-encryption", "AES256"])
        if "x-amz-tagging" in signed_headers:
            if retention_tag not in {"phynite-retention=calculation-output", "phynite-retention=research-data"}:
                raise WorkerError("Backend returned an invalid retention policy")
            headers.extend(["x-amz-tagging", retention_tag])
        if shutil.which("curl") is not None:
            header_arguments = [
                argument
                for index in range(0, len(headers), 2)
                for argument in ("--header", f"{headers[index]}: {headers[index + 1]}")
            ]
            try:
                subprocess.run(
                    [
                        "curl",
                        "--fail",
                        "--silent",
                        "--show-error",
                        "--request",
                        "PUT",
                        *header_arguments,
                        "--upload-file",
                        str(source),
                        url,
                    ],
                    check=True,
                    timeout=1800,
                )
                return
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                raise WorkerError(f"Artifact upload failed: {source.name}") from exc
        if source.stat().st_size > 100_000_000:
            raise WorkerError("curl is required to stream artifacts larger than 100 MB")
        request = urllib.request.Request(
            url,
            data=source.read_bytes(),
            method="PUT",
            headers={headers[index]: headers[index + 1] for index in range(0, len(headers), 2)},
        )
        try:
            transfer = urllib.request.build_opener(NoArtifactRedirect()).open(request, timeout=300) if os.environ.get("PHYNITE_APP_MODE") == "local" else urllib.request.urlopen(request, timeout=300, context=self.ssl_context)
            with transfer as response:
                response.read(1024)
        except urllib.error.HTTPError as exc:
            raise WorkerError(f"Artifact upload failed with HTTP {exc.code}: {source.name}") from exc
        except (urllib.error.URLError, TimeoutError, socket.timeout, ssl.SSLError) as exc:
            raise WorkerError(f"Artifact upload connection failed: {source.name}") from exc


class CloudApiClient(ApiClient):
    def __init__(self, base_url: str, region: str, deadline: int, digest: str, paid_job_id: str = ""):
        super().__init__(base_url, "")
        import boto3
        self.session = boto3.Session(region_name=region)
        self.region = region
        self.deadline = deadline
        self.digest = digest
        self.paid_job_id = paid_job_id

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest
        if not path.startswith("/worker/v1/jobs/"):
            raise WorkerError("Cloud worker may only call its job broker")
        if not self.paid_job_id and time.time() >= self.deadline:
            raise WorkerError("Cloud host deadline reached")
        cloud_path = path.replace("/worker/v1/", "/cloud-worker/v1/", 1)
        if self.paid_job_id:
            cloud_path = path.replace("/worker/v1/", "/paid-worker/v1/", 1)
            payload = {**payload, "paidJobId": self.paid_job_id}
        if path.endswith("/claim"):
            payload = {**payload, "hostDeadlineAtEpoch": self.deadline, "runtimeImageDigest": self.digest}
        request = AWSRequest(method="POST", url=f"{self.base_url}{cloud_path}", data=json.dumps(payload, separators=(",", ":")).encode(), headers={"Accept":"application/json", "Content-Type":"application/json"})
        credentials = self.session.get_credentials()
        if credentials is None:
            raise WorkerError("Cloud IAM role credentials are unavailable")
        SigV4Auth(credentials.get_frozen_credentials(), "execute-api", self.region).add_auth(request)
        prepared = request.prepare()
        try:
            with urllib.request.urlopen(urllib.request.Request(prepared.url, data=prepared.body, headers=dict(prepared.headers), method="POST"), timeout=self.timeout, context=self.ssl_context) as reply:
                body = reply.read(5_000_001)
            if len(body) > 5_000_000:
                raise WorkerError("Cloud broker response is too large")
            parsed = json.loads(body)
            if not isinstance(parsed, dict):
                raise WorkerError("Cloud broker response is invalid")
            if self.paid_job_id and isinstance(parsed.get("hostDeadlineAtEpoch"), int):
                bound = parsed["hostDeadlineAtEpoch"]
                if not time.time() < bound <= time.time() + 1200:
                    raise WorkerError("Cloud funding returned an invalid host deadline")
                root = getattr(self, "work_root", None)
                if root:
                    (root / ".host-deadline").write_text(str(bound))
            return parsed
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise WorkerError("Cloud job broker request failed; execution must stop if its lease cannot renew") from exc


class NoArtifactRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise WorkerError("A local artifact transfer cannot redirect to another destination.")


def desktop_artifact_url(url: str, origin: str) -> None:
    try:
        parsed, base = urllib.parse.urlsplit(url), urllib.parse.urlsplit(origin)
        valid = base.scheme == "http" and base.hostname in {"127.0.0.1", "localhost", "::1"} and base.port and not base.username and not base.password and base.path in {"", "/"} and not base.query and not base.fragment
        query = urllib.parse.parse_qs(parsed.query)
        if not valid or (parsed.scheme, parsed.netloc) != (base.scheme, base.netloc) or parsed.path != "/__local/artifacts" or parsed.fragment or not query.get("ticket"):
            raise ValueError()
    except (TypeError, ValueError) as error:
        raise WorkerError("Local artifacts must use this desktop core's exact loopback origin and signed artifact endpoint.") from error


def presigned_url_headers(url: str, local_development: bool = False, *, local_origin: str | None = None) -> set[str]:
    """Return the exact headers covered by an AWS SigV4 presigned URL."""
    try:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    except ValueError as exc:
        raise WorkerError("Backend returned an invalid artifact upload URL") from exc
    parsed = urllib.parse.urlsplit(url)
    if local_origin is not None:
        desktop_artifact_url(url, local_origin)
        return set(query.get('Phynite-Signed-Headers', [''])[0].split(';')) - {''}
    if local_development and parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1','localhost','::1'} and parsed.path == '/__local/artifacts' and query.get('ticket'):
        return set(query.get('Phynite-Signed-Headers', [''])[0].split(';')) - {''}
    values = query.get("X-Amz-SignedHeaders") or query.get("x-amz-signedheaders")
    if not values:
        legacy_keys = {key.lower() for key in query}
        if {"awsaccesskeyid", "signature", "expires"}.issubset(legacy_keys):
            # The deployed control plane can still emit S3 Signature V2 URLs.
            # That version predates the retention tag and signs the content
            # type plus SSE header implicitly rather than declaring them in a
            # SignedHeaders query field.
            return {"content-type", "x-amz-server-side-encryption"}
        raise WorkerError("Artifact upload URL does not use a supported AWS signature")
    return {header.strip().lower() for header in values[0].split(";") if header.strip()}


def safe_name(value: Any, label: str = "identifier") -> str:
    text = str(value or "")
    if not ID_PATTERN.fullmatch(text):
        raise WorkerError(f"The claimed job contains an unsafe {label}")
    return text


def safe_filename(value: Any) -> str:
    text = str(value or "")
    if Path(text).name != text or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,139}", text):
        raise WorkerError("The claimed job contains an unsafe filename")
    return text


def safe_extract(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with tarfile.open(archive, "r:gz") as handle:
        for member in handle.getmembers():
            target = (destination / member.name).resolve()
            if root != target and root not in target.parents:
                raise WorkerError("Dependency archive contains an unsafe path")
        handle.extractall(destination, filter="data")


def docker_command(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *arguments],
        capture_output=True,
        text=True,
        check=check,
        timeout=60,
    )


def validate_runtime(image: str, *, packaged_job_image: bool = False) -> str:
    if shutil.which("docker") is None:
        raise WorkerError("Docker CLI is not installed")
    try:
        runtime = json.loads(docker_command("info", "--format", "{{json .}}").stdout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise WorkerError("Docker Desktop is not running") from exc
    try:
        image_info = json.loads(docker_command("image", "inspect", image).stdout)[0]
    except subprocess.CalledProcessError as exc:
        raise WorkerError(f"Docker image {image!r} is not available") from exc
    aliases = {"aarch64": "arm64", "x86_64": "amd64"}
    host_arch = aliases.get(runtime.get("Architecture"), runtime.get("Architecture"))
    if host_arch and image_info.get("Architecture") != host_arch:
        print(
            f"Warning: {image} uses {image_info.get('Architecture')} on {host_arch}; "
            "compute runs under emulation. Build a native image with "
            "backend/scripts/build-local-compute.sh for better local performance.",
            flush=True,
        )
    try:
        docker_command(
            "run",
            "--rm",
            "--network", "none",
            "--entrypoint",
            "sh",
            image,
            "-c",
            f"test -r {'/opt/phynite-app/backend/compute' if packaged_job_image else '/opt/phynite'}/local_runner.py && command -v pw.x >/dev/null && command -v btp2 >/dev/null",
        )
    except subprocess.CalledProcessError as exc:
        raise WorkerError(
            f"Docker image {image!r} is missing the local runner; rebuild backend/compute"
        ) from exc
    # Run the inspected content, even if the local tag is moved after validation.
    return str(image_info["Id"])


def validate_md_runtime(image: str, *, packaged_job_image: bool = False) -> str:
    """Validate the separate, architecture-native LAMMPS/OVITO image."""
    try:
        image_info = json.loads(docker_command("image", "inspect", image).stdout)[0]
        root = "/opt/phynite-app/backend/md_local" if packaged_job_image else "/opt/phynite/md_local"
        docker_command(
            "run", "--rm", "--network", "none", "--entrypoint", "sh", image, "-c",
            f"test -r {root}/runner.py && test -r {root}/analysis_runner.py && command -v lmp >/dev/null && python3 -c 'import ovito'",
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as exc:
        raise WorkerError(f"Docker image {image!r} is missing LAMMPS or OVITO") from exc
    return str(image_info["Id"])


def parse_lammps_help(output: str) -> tuple[str, list[str], dict[str, list[str]]]:
    """Parse only inventories that LAMMPS reports in ``lmp -h`` output."""
    lines = output.splitlines()
    version = next(
        (
            line.strip()[:160]
            for line in lines
            if line.strip().lower().startswith(
                "large-scale atomic/molecular massively parallel simulator"
            )
            or re.match(r"^\s*LAMMPS(?:\s|$)", line, re.IGNORECASE)
        ),
        "LAMMPS version unavailable",
    )

    packages: list[str] = []
    collecting_packages = False
    styles: dict[str, list[str]] = {}
    active_style: str | None = None
    style_header = re.compile(
        r"^\s*\*\s*([A-Za-z][A-Za-z0-9 /+-]*?)\s+styles?\s*:?\s*(.*)$",
        re.IGNORECASE,
    )
    style_token = re.compile(r"[A-Za-z0-9][A-Za-z0-9_+./-]{0,79}")

    for raw_line in lines:
        line = raw_line.strip()
        if line.lower().startswith("installed packages:"):
            collecting_packages = True
            active_style = None
            line = line.split(":", 1)[1].strip()
            if not line:
                continue
        elif line.lower().startswith("list of individual style options"):
            collecting_packages = False
            active_style = None
            continue

        header = style_header.match(raw_line)
        if header:
            collecting_packages = False
            category = re.sub(r"[^a-z0-9]+", "-", header.group(1).lower()).strip("-")
            if not category:
                active_style = None
                continue
            active_style = category
            styles.setdefault(category, [])
            line = header.group(2).strip()
        elif not line:
            if collecting_packages and not packages:
                continue
            if active_style is not None and not styles[active_style]:
                # LAMMPS may put a blank line between a style heading and its inventory.
                continue
            collecting_packages = False
            active_style = None
            continue
        elif line.startswith("*"):
            collecting_packages = False
            active_style = None
            continue

        if collecting_packages:
            for token in re.findall(r"\b[A-Z][A-Z0-9_-]{1,39}\b", line.upper()):
                if token not in packages:
                    packages.append(token)
        elif active_style is not None:
            for token in line.split():
                if style_token.fullmatch(token) and token.lower() not in styles[active_style]:
                    styles[active_style].append(token.lower())

    return (
        version,
        sorted(packages),
        {category: sorted(values) for category, values in sorted(styles.items())},
    )


def desktop_native_sandbox():
    """The local app verifies isolation; a packaging flag cannot grant it."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from backend.local_api.sandbox import NativeSandbox
    data_dir = Path(os.environ.get("PHYNITE_DATA_DIR", str(Path.home() / ".phynite-lab"))).expanduser().resolve()
    return NativeSandbox(data_dir, (Path(__file__).resolve().parents[1], data_dir / "runtimes"))


def md_runtime_manifest(runtime: str, image: str | None) -> dict[str, Any]:
    execution_mode = (
        "personal-container"
        if runtime == "native" and os.environ.get("PHYNITE_PACKAGED_COMPUTE") == "1"
        else runtime
    )
    if runtime == "native" and os.environ.get("PHYNITE_APP_MODE") == "local":
        execution_mode = "native-sandbox" if desktop_native_sandbox().probe()["available"] else "native"
    output = ""
    try:
        if runtime == "docker" and image:
            result = docker_command(
                "run", "--rm", "--network", "none", "--entrypoint", "lmp", image, "-h",
                check=False,
            )
        else:
            executable = shutil.which("lmp") or shutil.which("lammps")
            result = subprocess.run(
                [str(executable), "-h"], capture_output=True, text=True, check=False, timeout=60
            ) if executable else None
        if result is not None:
            output = (result.stdout or "") + "\n" + (result.stderr or "")
    except (OSError, subprocess.SubprocessError):
        output = ""
    version, packages, styles = parse_lammps_help(output)
    pair_styles = styles.get("pair", [])
    if not {
        "atom", "integrate", "minimize", "pair", "fix", "compute", "dump"
    }.issubset(styles):
        # Keep QE polling and old MD capability negotiation operational when an
        # older or vendor-patched LAMMPS help format cannot be parsed exactly.
        return {
            "schemaVersion": 1,
            "executionMode": execution_mode,
            "architecture": platform.machine()[:32] or "unknown",
            "lammpsVersion": version,
            "packages": packages[:256],
            "pairStyles": pair_styles[:1024],
            "manualInput": execution_mode in {"docker", "personal-container", "native-sandbox"},
        }
    return {
        "schemaVersion": 2,
        "executionMode": execution_mode,
        "architecture": platform.machine()[:32] or "unknown",
        "lammpsVersion": version,
        "packages": packages[:256],
        # Keep pairStyles as a stable compatibility alias for the v1 manifest.
        "pairStyles": pair_styles[:2048],
        "styles": {
            category: values[:2048]
            for category, values in list(styles.items())[:32]
        },
        "workflowVersions": list(MD_WORKFLOW_VERSIONS),
        "runnerProtocol": MD_RUNNER_PROTOCOL,
        "manualInput": execution_mode in {"docker", "personal-container", "native-sandbox"},
    }


def scientific_python(component: str) -> str | None:
    """Runtime interpreters come from the manager's verified active inventory."""
    specific = os.environ.get(f"PHYNITE_RUNTIME_PYTHON_{component.upper()}")
    sibling = os.environ.get("PHYNITE_RUNTIME_PYTHON_MD") if component == "analysis" else os.environ.get("PHYNITE_RUNTIME_PYTHON_ANALYSIS") if component == "md" else None
    selected = specific or sibling or os.environ.get("PHYNITE_RUNTIME_PYTHON")
    if selected:
        path = Path(selected)
        if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
            raise WorkerError("The selected scientific runtime Python is missing or is not executable.")
        return str(path)
    return None if getattr(sys, "frozen", False) else sys.executable


def native_md_analysis_available() -> bool:
    python = scientific_python("analysis")
    if not python:
        return False
    command = [python, "-c", "import ovito"]
    check = subprocess.run(command, capture_output=True, text=True, timeout=30)
    return check.returncode == 0


def native_md_runtime_available() -> bool:
    if shutil.which("lmp") is None and shutil.which("lammps") is None:
        return False
    return native_md_analysis_available()


def native_environment(job_dir: Path, calculation_id: str, vcpus: int, memory_mib: int, timeout_seconds: float = 86400) -> dict[str, str]:
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "TMPDIR", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH") if key in os.environ}
    env.update({
        "HOME": str(job_dir), "PHYNITE_WORK_DIR": str(job_dir),
        "PHYNITE_CALCULATION_ID": calculation_id, "PHYNITE_VCPUS": str(vcpus),
        "PHYNITE_MEMORY_MIB": str(memory_mib), "PHYNITE_HEADLESS_JOB": "1", "PHYNITE_MD_TIMEOUT_SECONDS": str(math.ceil(timeout_seconds) if math.isfinite(timeout_seconds) else 0), "PHYNITE_EXECUTION_MODE": "personal-container" if os.environ.get("PHYNITE_PACKAGED_COMPUTE") == "1" else "local-native",
        "PHYNITE_QE_PARALLEL_MODE": os.environ.get("PHYNITE_QE_PARALLEL_MODE", "auto"),
        "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1",
        "MPLCONFIGDIR": str(job_dir / ".matplotlib"),
        "PYTHONPATH": str(Path(__file__).resolve().parents[2]),
        "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1",
    })
    if os.environ.get("PHYNITE_APP_MODE") == "local":
        temporary = job_dir / ".tmp"
        temporary.mkdir(parents=True, exist_ok=True)
        env["TMPDIR"] = str(temporary)
        env["PHYNITE_EXECUTION_MODE"] = "local-native"
        loopback = "lo0" if platform.system() == "Darwin" else "lo"
        env.update(OMPI_MCA_btl="self,tcp", OMPI_MCA_btl_tcp_if_include=loopback)
    if os.environ.get("PHYNITE_HPC_SCHEDULER"):
        import hpc
        try:
            allocation = hpc.current_allocation(os.environ["PHYNITE_HPC_SCHEDULER"])
            hpc.validate_job_resources(allocation, vcpus, memory_mib)
        except hpc.HpcError as exc:
            raise WorkerError(str(exc)) from exc
        for key in ("PHYNITE_HPC_SCHEDULER", "PHYNITE_MPI_LAUNCHER", "PHYNITE_HPC_MAX_RANKS", "PHYNITE_HPC_PROFILE_SHA256"):
            if key in os.environ:
                env[key] = os.environ[key]
        for key in ("SLURM_JOB_ID", "SLURM_JOBID", "SLURM_CLUSTER_NAME", "SLURM_CONF", "SLURM_JOB_NODELIST", "SLURM_NODELIST", "SLURM_NTASKS", "SLURM_TASKS_PER_NODE", "SLURM_JOB_NUM_NODES", "SLURM_NNODES", "SLURM_CPUS_PER_TASK", "SLURM_CPUS_ON_NODE", "SLURM_MEM_PER_NODE", "PBS_JOBID", "PBS_NODEFILE", "PBS_NP"):
            if key in os.environ:
                env[key] = os.environ[key]
        env["PHYNITE_HPC_MAX_RANKS"] = str(allocation["ranks"])
    return env


def validate_native_runtime() -> None:
    if platform.system() not in {"Linux", "Darwin"}:
        raise WorkerError("Native compute requires Linux, macOS, or Linux inside Windows WSL2.")
    scheduler = os.environ.get("PHYNITE_HPC_SCHEDULER")
    launcher = "srun" if scheduler == "slurm" else "mpiexec" if scheduler == "pbs" else "mpirun"
    required = ("pw.x", "bands.x", "dos.x", "projwfc.x", "ph.x", "q2r.x", "matdyn.x", launcher)
    missing = [name for name in required if not shutil.which(name)]
    if missing:
        raise WorkerError("Native executables missing from PATH: " + ", ".join(missing))
    if scheduler is None:
        mpi = subprocess.run(["mpirun", "--version"], capture_output=True, text=True, timeout=15)
        if mpi.returncode or not any(name in mpi.stdout + mpi.stderr for name in ("Open MPI", "OpenRTE")):
            raise WorkerError("Use Quantum ESPRESSO and mpirun built against the same Open MPI installation.")
    if psutil is None:
        raise WorkerError("Native execution requires psutil for safe process identity and interruption recovery.")
    python = scientific_python("dft")
    if not python:
        raise WorkerError("The DFT runtime's scientific Python is not installed. Complete DFT setup in the web application.")
    command = [python, "-c", "import numpy, scipy, seekpath, matplotlib"]
    check = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if check.returncode:
        raise WorkerError("Native Python dependencies are missing. Install backend/local_worker/requirements-native.txt in your virtual environment.")
    if not shutil.which("neb.x"):
        print("NEB is unavailable: neb.x is missing. Rebuild with backend/local_worker/build_native_qe.py and add its install/bin directory to PATH.")
    if not shutil.which("btp2"):
        print("BoltzTraP2 is not installed; thermoelectric calculations require requirements-transport.txt.")


def stop_native_process(process: subprocess.Popen[str]) -> None:
    # QE launches MPI children; stopping only the Python parent leaves them running.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def reset_generated_workspace(job_dir: Path) -> None:
    if recovery.has_execution_evidence(job_dir):
        recovery.preserve(job_dir, "A fresh workspace was requested; prior scientific execution was preserved.")
    job_dir.mkdir(parents=True, exist_ok=True)
    for name in ("input.json", "pseudo", "potential", "source", "tmp", "results", ".compute-clock.json", recovery.JOURNAL, "worker-container.log"):
        target = job_dir / name
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink(missing_ok=True)
    for archive in job_dir.glob("dependency-*.tar.gz"):
        archive.unlink(missing_ok=True)


def _atomic_species(payload: dict[str, Any]) -> list[tuple[str, str]]:
    inputs = payload.get("inputFiles")
    contents = list(inputs.values()) if isinstance(inputs, dict) else []
    qe_input = payload.get("qeInput")
    if isinstance(qe_input, str):
        contents.append(qe_input)
    species: dict[str, str] = {}
    cards = {
        "ATOMIC_POSITIONS",
        "CELL_PARAMETERS",
        "K_POINTS",
        "OCCUPATIONS",
        "CONSTRAINTS",
        "ATOMIC_FORCES",
        "HUBBARD",
    }
    for content in contents:
        if not isinstance(content, str):
            continue
        in_card = False
        for raw_line in content.splitlines():
            line = raw_line.split("!", 1)[0].strip()
            if not line:
                continue
            if line.upper().startswith("ATOMIC_SPECIES"):
                in_card = True
                continue
            if not in_card:
                continue
            fields = line.split()
            if len(fields) < 3 or line.startswith("&") or fields[0].upper() in cards:
                break
            species.setdefault(fields[2], fields[0])
    return sorted(species.items())


def _element_for_label(label: str, metadata: dict[str, Any]) -> str | None:
    if label in metadata:
        return label
    match = re.match(r"^([A-Z][a-z]?)", label)
    if match and match.group(1) in metadata:
        return match.group(1)
    return None


def _load_sssp_metadata(pseudo_root: Path, family: str) -> tuple[dict[str, Any], Path, str]:
    if family == "sssp-precision":
        candidates = sorted(pseudo_root.glob("SSSP_*_PBE_precision.json"))
        library_dir = pseudo_root / "sssp-pbe-precision"
        library_name = "SSSP PBE Precision"
    else:
        candidates = sorted(pseudo_root.glob("SSSP_*_PBE_efficiency.json"))
        library_dir = pseudo_root / "sssp-pbe-efficiency"
        library_name = "SSSP PBE Efficiency"
    if not candidates or not library_dir.is_dir():
        raise WorkerError(
            f"{library_name} is not installed under {pseudo_root}; select an installed library or upload UPF files"
        )
    try:
        metadata = json.loads(candidates[-1].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkerError(f"Could not read {library_name} metadata") from exc
    if not isinstance(metadata, dict):
        raise WorkerError(f"{library_name} metadata is invalid")
    return metadata, library_dir, library_name


def _pseudopotential_type(filename: str, metadata_label: str = "") -> str:
    normalized = f"{filename} {metadata_label}".lower()
    if "paw" in normalized or "kjpaw" in normalized:
        return "PAW"
    if "rrkjus" in normalized or "uspp" in normalized or ".us." in normalized or "100us" in normalized:
        return "USPP"
    if "oncv" in normalized or "sg15" in normalized or ".nc." in normalized:
        return "NC"
    return "unknown"


def resolve_local_pseudopotentials(
    payload: dict[str, Any], pseudo_dir: Path, pseudo_root: Path
) -> list[dict[str, Any]]:
    requirements = _atomic_species(payload)
    if not requirements:
        raise WorkerError("No ATOMIC_SPECIES pseudopotentials were found in the QE input")
    provenance: list[dict[str, Any]] = []
    metadata_cache: dict[str, tuple[dict[str, Any], Path, str]] = {}
    for requested_filename, label in requirements:
        requested_filename = safe_filename(requested_filename)
        exact_matches = [
            path for path in pseudo_root.rglob("*")
            if path.is_file() and path.name == requested_filename
        ]
        expected_md5 = ""
        metadata_record: dict[str, Any] | None = None
        if exact_matches:
            source = exact_matches[0]
            library = source.parent.name
        else:
            lowered = requested_filename.lower()
            family = next(
                (
                    candidate
                    for candidate in ("sssp-precision", "sssp-efficiency")
                    if f".{candidate}." in lowered
                ),
                None,
            )
            if family:
                metadata, library_dir, library = metadata_cache.setdefault(
                    family, _load_sssp_metadata(pseudo_root, family)
                )
                element = _element_for_label(label, metadata)
                record = metadata.get(element) if element else None
                metadata_record = record if isinstance(record, dict) else None
                source = library_dir / str(record.get("filename")) if isinstance(record, dict) else Path()
                expected_md5 = str(record.get("md5") or "") if isinstance(record, dict) else ""
                if not source.is_file():
                    raise WorkerError(f"No {library} pseudopotential is available for atomic label {label}")
            elif ".pseudodojo." in lowered:
                dojo_dir = pseudo_root / "pseudo-dojo-fr-pbe"
                element = re.match(r"^([A-Z][a-z]?)", label)
                source = dojo_dir / f"{element.group(1)}.upf" if element else Path()
                library = "PseudoDojo PBE fully relativistic"
                if not source.is_file():
                    raise WorkerError(
                        f"No local PseudoDojo pseudopotential is available for atomic label {label}"
                    )
            else:
                raise WorkerError(
                    f"Required pseudopotential {requested_filename} is not installed locally and was not uploaded"
                )
        if expected_md5 and file_digest(source, "md5") != expected_md5:
            raise WorkerError(f"Checksum mismatch for local pseudopotential {source.name}")
        try:
            header = parse_upf_header(source)
        except ValueError as exc:
            raise WorkerError(str(exc)) from exc
        symbol = re.match(r"[A-Z][a-z]?", label)
        if symbol is None or symbol.group(0) != header["element"]:
            raise WorkerError(f"Species {label} does not match UPF element {header['element']}")
        shutil.copy2(source, pseudo_dir / requested_filename)
        record = {
            "atomicLabel": label,
            "requestedFilename": requested_filename,
            "sourceFilename": source.name,
            "library": library,
            "pseudopotentialType": {"US": "USPP"}.get(header["pseudopotentialType"], header["pseudopotentialType"]),
            "sha256": file_digest(source),
            "modelIdentity": header,
        }
        if metadata_record:
            if isinstance(metadata_record.get("cutoff_wfc"), (int, float)):
                record["recommendedEcutwfcRy"] = float(metadata_record["cutoff_wfc"])
            if isinstance(metadata_record.get("cutoff_rho"), (int, float)):
                record["recommendedEcutrhoRy"] = float(metadata_record["cutoff_rho"])
            record["metadataMd5"] = str(metadata_record.get("md5") or "")
        provenance.append(record)
    return provenance


def validate_adaptive_cutoff_resolution(
    payload: dict[str, Any], provenance: list[dict[str, Any]]
) -> None:
    settings = payload.get("settings")
    resolution = settings.get("qeParameterResolution") if isinstance(settings, dict) else None
    if not isinstance(resolution, dict) or resolution.get("mode") != "adaptive":
        return
    stages = resolution.get("stages")
    if not isinstance(stages, dict):
        return
    resolved_cutoffs = [
        stage.get("cutoff")
        for stage in stages.values()
        if isinstance(stage, dict) and isinstance(stage.get("cutoff"), dict)
    ]
    automatic = [cutoff for cutoff in resolved_cutoffs if cutoff.get("policy") == "auto"]
    if not automatic:
        return
    recommended_wfc = max(
        (float(item["recommendedEcutwfcRy"]) for item in provenance if isinstance(item.get("recommendedEcutwfcRy"), (int, float))),
        default=0.0,
    )
    recommended_rho = max(
        (float(item["recommendedEcutrhoRy"]) for item in provenance if isinstance(item.get("recommendedEcutrhoRy"), (int, float))),
        default=0.0,
    )
    if recommended_wfc <= 0 or recommended_rho <= 0:
        return
    for cutoff in automatic:
        submitted_wfc = float(cutoff.get("ecutwfc") or 0)
        submitted_rho = float(cutoff.get("ecutrho") or 0)
        if submitted_wfc + 1e-9 < recommended_wfc or submitted_rho + 1e-9 < recommended_rho:
            raise WorkerError(
                "The installed SSSP cutoff metadata is newer than the submitted adaptive configuration "
                f"({submitted_wfc:g}/{submitted_rho:g} Ry submitted; at least "
                f"{recommended_wfc:g}/{recommended_rho:g} Ry required). Refresh the calculation configuration and submit again."
            )
    input_files = payload.get("inputFiles")
    if not isinstance(input_files, dict):
        return
    for filename, content in input_files.items():
        if not isinstance(content, str) or not re.search(r"&SYSTEM\b", content, re.IGNORECASE):
            continue
        wfc_match = re.search(r"\becutwfc\s*=\s*([0-9.+Ee-]+)", content, re.IGNORECASE)
        rho_match = re.search(r"\becutrho\s*=\s*([0-9.+Ee-]+)", content, re.IGNORECASE)
        submitted_wfc = float(wfc_match.group(1)) if wfc_match else 0.0
        submitted_rho = float(rho_match.group(1)) if rho_match else 0.0
        if submitted_wfc + 1e-9 < recommended_wfc or submitted_rho + 1e-9 < recommended_rho:
            raise WorkerError(
                f"Adaptive input {filename} does not satisfy the installed SSSP recommendations "
                f"({submitted_wfc:g}/{submitted_rho:g} Ry; at least "
                f"{recommended_wfc:g}/{recommended_rho:g} Ry required)."
            )


def prepare_workspace(
    client: ApiClient,
    job: dict[str, Any],
    job_dir: Path,
    pseudo_root: Path,
) -> None:
    reset_generated_workspace(job_dir)
    calculation_id = safe_name(job.get("calculationId"), "calculation ID")
    payload = copy.deepcopy(job.get("input"))
    if not isinstance(payload, dict) or payload.get("calculationId") != calculation_id:
        raise WorkerError("The claimed input does not match the calculation")
    job_kind = str(job.get("kind") or "qe")
    if job_kind in {"md-analysis", "md-simulation"}:
        source = job.get("sourceDownload")
        if not isinstance(source, dict) or not isinstance(source.get("url"), str):
            raise WorkerError("The MD source download is missing")
        filename = safe_filename(source.get("filename"))
        destination = job_dir / "source" / filename
        client.download(source["url"], destination, 64 * 1024**3)
        digest = file_digest(destination)
        if digest != str(source.get("sha256") or "").lower():
            raise WorkerError("The MD source checksum does not match the cloud record")
        expected_size = int(source.get("sizeBytes") or 0)
        if expected_size <= 0 or destination.stat().st_size != expected_size:
            raise WorkerError("The MD source size does not match the cloud record")
        payload["localSourcePath"] = f"source/{filename}"
        potential_downloads = job.get("potentialDownloads") or []
        if not isinstance(potential_downloads, list) or len(potential_downloads) > 4:
            raise WorkerError("The MD potential download list is invalid")
        potential_dir = job_dir / "potential"
        local_potential_files: list[dict[str, Any]] = []
        seen_filenames: set[str] = set()
        for item in potential_downloads:
            if not isinstance(item, dict) or not isinstance(item.get("url"), str):
                raise WorkerError("An MD potential download is invalid")
            potential_filename = safe_filename(item.get("filename"))
            if potential_filename in seen_filenames:
                raise WorkerError("MD potential filenames must be unique")
            seen_filenames.add(potential_filename)
            expected_size = int(item.get("sizeBytes") or 0)
            expected_digest = str(item.get("sha256") or "").lower()
            if not 1 <= expected_size <= 20 * 1024 * 1024 or not re.fullmatch(r"[a-f0-9]{64}", expected_digest):
                raise WorkerError("MD potential metadata is invalid")
            destination = potential_dir / potential_filename
            client.download(item["url"], destination, 20 * 1024 * 1024)
            if destination.stat().st_size != expected_size or file_digest(destination) != expected_digest:
                raise WorkerError(f"MD potential {potential_filename} failed its integrity check")
            local_potential_files.append({
                "filename": potential_filename,
                "role": str(item.get("role") or "potential"),
                "sizeBytes": expected_size,
                "sha256": expected_digest,
                "path": f"potential/{potential_filename}",
            })
        payload["localPotentialFiles"] = local_potential_files
        (job_dir / "input.json").write_text(
            json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8"
        )
        return

    pseudo_dir = job_dir / "pseudo"
    pseudo_dir.mkdir(parents=True, exist_ok=True)
    downloads = job.get("pseudopotentialDownloads") or []
    if not isinstance(downloads, list):
        raise WorkerError("The pseudopotential download list is invalid")
    provenance: list[dict[str, Any]] = []
    for item in downloads:
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            raise WorkerError("The pseudopotential download list is invalid")
        filename = safe_filename(item.get("filename"))
        destination = pseudo_dir / filename
        client.download(item["url"], destination, 100_000_000)
        provenance.append(
            {
                "atomicLabel": "uploaded",
                "requestedFilename": filename,
                "sourceFilename": filename,
                "library": "user upload",
                "sha256": file_digest(destination),
            }
        )
    if not downloads:
        provenance = resolve_local_pseudopotentials(payload, pseudo_dir, pseudo_root)
    inputs = payload.get("inputFiles")
    if not isinstance(inputs, dict):
        inputs = {"qeInput": str(payload.get("qeInput") or "")}
    try:
        models = validate_qe_models(inputs, pseudo_dir)
    except ValueError as exc:
        raise WorkerError(str(exc)) from exc
    for record in provenance:
        record["modelIdentity"] = next((model for model in models if model["filename"] == record["requestedFilename"]), record.get("modelIdentity"))
    validate_adaptive_cutoff_resolution(payload, provenance)
    settings = payload.setdefault("settings", {})
    if isinstance(settings, dict):
        settings["resolvedPseudopotentials"] = provenance
    (job_dir / "input.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8"
    )

    dependencies = job.get("dependencyDownloads") or []
    if not isinstance(dependencies, list):
        raise WorkerError("The dependency download list is invalid")
    for index, item in enumerate(dependencies):
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            raise WorkerError("A dependency download is invalid")
        archive = job_dir / f"dependency-{index}.tar.gz"
        client.download(item["url"], archive)
        if item.get("sha256") and file_digest(archive) != item["sha256"]:
            raise WorkerError("SCF archive checksum verification failed")
        shared_scf = payload.get("settings", {}).get("sharedScf")
        if shared_scf:
            if index != 0 or len(dependencies) != 1 or sha256_file(archive) != shared_scf["bundleSha256"]:
                raise WorkerError("Shared SCF bundle identity failed verification")
            safe_extract(archive, job_dir / "dependencies/scf")
        else:
            safe_extract(archive, job_dir)


LOG_TAIL_BYTES = 64 * 1024


def bounded_log_text(path: Path) -> str:
    # Progress telemetry must not load complete multi-hour solver logs into memory.
    with path.open("rb") as source:
        source.seek(0, os.SEEK_END)
        size = source.tell()
        source.seek(max(0, size - LOG_TAIL_BYTES))
        return source.read(LOG_TAIL_BYTES).decode("utf-8", errors="replace")


def latest_log_tail(job_dir: Path, lines: int = 18, maximum: int = 3500) -> tuple[str, str]:
    logs = job_dir / "results" / "logs"
    candidates = sorted(
        (path for path in logs.glob("*.out") if path.is_file()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        return "Starting local calculation", ""
    path = candidates[0]
    content = bounded_log_text(path).splitlines()
    tail = "\n".join(content[-lines:])[-maximum:]
    stage = path.stem.replace("-", " ").title()
    return stage, tail


class ScfConvergenceReader:
    """Incremental reader: partial writes and ionic-cycle resets keep their identity."""
    number = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?"

    def __init__(self) -> None:
        self.path: Path | None = None
        self.offset = 0
        self.pending = ""
        self.points: list[dict[str, Any]] = []
        self.iteration: int | None = None
        self.cycle = 0
        self.energy: float | None = None
        self.truncated = False

    def read(self, job_dir: Path) -> dict[str, Any] | None:
        logs = job_dir / "results" / "logs"
        path = next((logs / name for name in ("relax.out", "scf.out") if (logs / name).is_file()), None)
        if path is None:
            return None
        if self.path != path or path.stat().st_size < self.offset:
            self.__init__()
            self.path = path
        with path.open("rb") as source:
            source.seek(self.offset)
            chunk = source.read(1024 * 1024)
            self.offset += len(chunk)
        lines = (self.pending + chunk.decode("utf-8", errors="replace")).split("\n")
        self.pending = lines.pop()[-8192:]
        for line in lines:
            iteration = re.search(r"iteration\s*#\s*(\d+)", line, re.I)
            if iteration:
                current = int(iteration.group(1))
                if self.iteration is not None and current <= self.iteration:
                    self.cycle += 1
                self.iteration, self.energy = current, None
            energy = re.search(r"total energy\s*=\s*(" + self.number + r")\s*Ry", line, re.I)
            if energy:
                self.energy = float(energy.group(1).replace("D", "e").replace("d", "e"))
            residual = re.search(r"estimated scf accuracy\s*[<=]\s*(" + self.number + r")\s*Ry", line, re.I)
            if residual and self.iteration is not None:
                error = float(residual.group(1).replace("D", "e").replace("d", "e"))
                if not math.isfinite(error) or error < 0:
                    continue
                point = {"cycle": self.cycle, "iteration": self.iteration, "errorRy": error}
                if self.energy is not None and math.isfinite(self.energy):
                    point["energyRy"] = self.energy
                if self.points and (self.points[-1]["cycle"], self.points[-1]["iteration"]) == (self.cycle, self.iteration):
                    self.points[-1] = point
                else:
                    self.points.append(point)
                self.truncated = self.truncated or len(self.points) > 256
                self.points = self.points[-256:]
        if not self.points:
            return None
        result = {"version": 1, "stage": path.stem, "points": list(self.points), "truncated": self.truncated}
        # Persisted executed input is authoritative, not the UI draft.
        inputs = job_dir / "results" / "inputs"
        names = ("vcrelax.in", "relax.in") if path.stem == "relax" else ("scf.in",)
        for name in names:
            source = inputs / name
            if source.is_file():
                text = re.sub(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"", "''", strip_qe_comments(source.read_text()))
                electrons = re.search(r"&ELECTRONS\b([^/]*)/", text, re.I)
                match = re.search(r"\bconv_thr\s*=\s*(" + self.number + ")", electrons.group(1), re.I) if electrons else None
                if match:
                    threshold = float(match.group(1).replace("D", "e").replace("d", "e"))
                    if math.isfinite(threshold) and threshold > 0:
                        result["thresholdRy"] = threshold
                break
        return result


def estimate_progress(job_dir: Path, calculation_type: str) -> int:
    expected = EXPECTED_LOGS.get(calculation_type, ("scf.out",))
    logs = job_dir / "results" / "logs"
    completed = 0
    active = 0
    for filename in expected:
        path = logs / filename
        if not path.is_file():
            continue
        active += 1
        text = bounded_log_text(path)[-10000:]
        if "JOB DONE." in text or filename.startswith("boltztrap2-") and len(text.strip()) > 0:
            completed += 1
    base = 15 + round(72 * completed / max(1, len(expected)))
    if active > completed:
        base += max(2, round(8 / max(1, len(expected))))
    return max(15, min(base, 92))


def fallback_result(job_dir: Path, job: dict[str, Any], status: str, message: str, execution_mode: str = "local-docker", *, platform_failure: bool = False) -> None:
    results = job_dir / "results"
    results.mkdir(parents=True, exist_ok=True)
    prepared_input = job_dir / "input.json"
    if prepared_input.is_file():
        (results / "inputs").mkdir(exist_ok=True)
        shutil.copyfile(prepared_input, results / "inputs" / "prepared-input.json")
    result = {
        "version": 1 if job.get("kind") == "md-analysis" else 2,
        "calculationId": job["calculationId"],
        **({"kind": job["kind"]} if job.get("kind") in {"md-analysis", "md-simulation"} else {}),
        **({"analysisId": job["calculationId"]} if job.get("kind") == "md-analysis" else {}),
        "calculationType": (job.get("input") or {}).get("calculationType"),
        "status": status,
        "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "error": message,
        "platformFailure": platform_failure,
        "syntheticData": False,
        "artifacts": [{"path": entry["path"], "sizeBytes": entry["sizeBytes"], "sha256": entry["sha256"],
                       "label": Path(entry["path"]).name, "kind": "raw"} for entry in artifact_inventory(results)
                      if entry["path"] != "result.json"] if any(path.is_file() for path in results.rglob("*")) else [],
        "provenance": {"executionMode": execution_mode, "operatingSystem": platform.system(), "syntheticData": False},
    }
    (results / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    retain_terminal_worker_log(job_dir, result)


def retain_terminal_worker_log(job_dir: Path, manifest: dict[str, Any]) -> None:
    """Keep startup/runner diagnostics separate from scientific result data."""
    if str(manifest.get("status") or "").lower() not in {"failed", "cancelled"}:
        return
    source = job_dir / "worker-container.log"
    if not source.is_file() or source.is_symlink():
        return
    destination = job_dir / "results" / "logs" / "worker-container.out"
    destination.parent.mkdir(exist_ok=True)
    if destination.is_symlink() or destination.parent.is_symlink():
        raise WorkerError("The terminal diagnostic log contains a symbolic link")
    maximum = 2 * 1024 * 1024
    with source.open("rb") as handle:
        handle.seek(max(0, source.stat().st_size - maximum))
        content = handle.read(maximum)
    if not content:
        return  # Do not hide a solver's nonempty diagnostic with an empty wrapper log.
    destination.write_bytes(content)
    entry = {"path": "logs/worker-container.out", "label": "Worker output", "role": "log",
             "contentType": "text/plain", "sizeBytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
    manifest["artifacts"] = [item for item in manifest.get("artifacts", []) if item.get("path") != entry["path"]] + [entry]
    (job_dir / "results" / "result.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def artifact_inventory(results: Path, maximum: int = 10_002) -> list[dict[str, Any]]:
    candidates = list(results.rglob("*"))
    if any(path.is_symlink() for path in candidates):
        raise WorkerError("The local result artifacts contain a symbolic link")
    files = sorted(path for path in candidates if path.is_file() and path.name != ".upload-part")
    if not files or len(files) > maximum:
        raise WorkerError("The local result artifact count is invalid")
    inventory = []
    for path in files:
        relative = path.relative_to(results).as_posix()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        inventory.append(
            {"path": relative, "sizeBytes": path.stat().st_size, "contentType": content_type, "sha256": sha256_file(path)}
        )
    return inventory


def completion_failure_reason(manifest: dict[str, Any], status: str) -> str | None:
    if status == "completed":
        return None
    reason = str(manifest.get("error") or "Local calculation failed.").strip()
    return (reason[:500] or "Local calculation failed.")


def has_recoverable_terminal_result(job_dir: Path, calculation_id: str) -> bool:
    """Return true when compute finished and only cloud finalization remains."""
    manifest_path = job_dir / "results" / "result.json"
    if not manifest_path.is_file() or (job_dir / ".retention-start").is_file():
        return False
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return (
        isinstance(manifest, dict)
        and manifest.get("calculationId") == calculation_id
        and str(manifest.get("status") or "").lower()
        in {"completed", "failed", "cancelled"}
    )


def retry_worker_operation(
    operation: Callable[[], Any],
    description: str,
    *,
    attempts: int = 4,
    initial_delay_seconds: float = 1.0,
) -> Any:
    """Retry transient worker-network operations without restarting compute."""
    last_error: WorkerError | None = None
    for attempt in range(1, max(1, attempts) + 1):
        try:
            return operation()
        except WorkerError as exc:
            last_error = exc
            if attempt >= attempts:
                break
            time.sleep(initial_delay_seconds * (2 ** (attempt - 1)))
    raise WorkerError(
        f"{description} failed after {max(1, attempts)} attempts: {last_error}"
    ) from last_error


def upload_multipart_artifact(client: ApiClient, worker_id: str, job: dict[str, Any], source: Path, plan: dict[str, Any]) -> None:
    part_bytes = int(plan.get("partBytes") or 0)
    if part_bytes != 16 * 1024**2:
        raise WorkerError("The artifact part size is invalid")
    endpoint = f"/worker/v1/jobs/{job['calculationId']}/uploads"
    common = {"workerId": worker_id, "ownerId": job["ownerId"], "kind": job.get("kind", "qe"), "path": plan["path"]}
    part_path = source.parent / ".upload-part"
    try:
        with source.open("rb") as handle:
            number = 0
            while block := handle.read(part_bytes):
                number += 1
                part_path.write_bytes(block)
                ticket = retry_worker_operation(lambda: client.post(endpoint, {**common, "artifactAction": "part", "partNumber": number,
                    "sizeBytes": len(block), "sha256": hashlib.sha256(block).hexdigest()}), "Preparing result part")
                retry_worker_operation(lambda: client.upload(ticket["url"], part_path, "application/octet-stream"), "Uploading result part")
        retry_worker_operation(lambda: client.post(endpoint, {**common, "artifactAction": "complete"}), "Completing result artifact")
    finally:
        part_path.unlink(missing_ok=True)


def recorded_execution_resources(job_dir: Path) -> dict[str, int]:
    """Use the launched execution's allocation, including after upload recovery."""
    journal = job_dir / recovery.JOURNAL
    if not journal.is_file():
        return {}
    resources = json.loads(journal.read_text()).get("effectiveResources")
    if resources is None:
        return {}  # Older journals do not establish an effective allocation.
    fields = {"effectiveVcpus", "effectiveMemoryMiB"}
    if (not isinstance(resources, dict) or set(resources) != fields
            or any(isinstance(value, bool) or not isinstance(value, int) or value < 1 for value in resources.values())):
        raise WorkerError("The recorded execution resource allocation is invalid.")
    return resources


def upload_results(client: ApiClient, worker_id: str, job: dict[str, Any], job_dir: Path) -> str:
    calculation_id = job["calculationId"]
    results = job_dir / "results"
    manifest_path = results / "result.json"
    if not manifest_path.is_file():
        raise WorkerError("The local container did not create result.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    status = str(manifest.get("status") or "failed").lower()
    if status not in {"completed", "failed", "cancelled"}:
        status = "failed"
    retain_terminal_worker_log(job_dir, manifest)
    inventory = artifact_inventory(results)
    fleet = job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"}
    inventory.sort(key=lambda entry: entry["path"] == "result.json")
    batch_size = 10 if fleet else 200
    for batch_start in range(0, len(inventory), batch_size):
        batch = inventory[batch_start:batch_start + batch_size]
        response = retry_worker_operation(
            lambda: client.post(
                f"/worker/v1/jobs/{calculation_id}/uploads",
                {"workerId": worker_id, "ownerId": job["ownerId"], "kind": job.get("kind", "qe"), "files": batch},
            ),
            "Requesting artifact upload URLs",
        )
        uploads = response.get("uploads")
        if not isinstance(uploads, list) or len(uploads) != len(batch):
            raise WorkerError("Backend returned an incomplete upload plan")
        by_path = {item["path"]: item for item in batch}
        seen: set[str] = set()
        for upload in uploads:
            if not isinstance(upload, dict) or upload.get("path") not in by_path or upload["path"] in seen:
                raise WorkerError("Backend returned an invalid upload target")
            seen.add(upload["path"])
            item = by_path[upload["path"]]
            if upload.get("alreadyUploaded") is True:
                continue  # Server verified this immutable artifact after a lost terminal reply.
            if upload.get("multipart"):
                upload_multipart_artifact(client, worker_id, job, results / item["path"], upload)
                continue
            retry_worker_operation(
                lambda upload=upload, item=item: client.upload(
                    str(upload.get("url") or ""),
                    results / item["path"],
                    item["contentType"],
                    str(upload.get("retentionTag") or "phynite-retention=calculation-output"),
                ),
                f"Uploading artifact {item['path']}",
            )
    retry_worker_operation(
        lambda: client.post(
            f"/worker/v1/jobs/{calculation_id}/complete",
            {
                "workerId": worker_id,
                "ownerId": job["ownerId"],
                "kind": job.get("kind", "qe"),
                "status": status,
                **recorded_execution_resources(job_dir),
                **({"computeSeconds": min(compute_seconds(job_dir), int(job["fundedComputeSeconds"])), "platformFailure": manifest.get("platformFailure") is True} if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} else {}),
                "failureReason": completion_failure_reason(manifest, status),
                "logTail": latest_log_tail(job_dir)[1],
            },
        ),
        "Finalizing the local calculation",
    )
    recovery.mark(job_dir, "finalized", status=status)
    (job_dir / ".retention-start").touch()
    return status


def cleanup_expired_workspaces(
    work_root: Path,
    *,
    now: float | None = None,
    retention_seconds: int = LOCAL_ARTIFACT_RETENTION_SECONDS,
) -> list[str]:
    """Remove local calculation copies after the same three-day cloud window."""
    if os.environ.get("PHYNITE_APP_MODE") == "local":
        return []  # Desktop data is primary storage, not an expiring cloud cache.
    cutoff = (time.time() if now is None else now) - retention_seconds
    removed: list[str] = []
    if not work_root.is_dir():
        return removed
    for job_dir in work_root.iterdir():
        if not job_dir.is_dir() or job_dir.is_symlink() or not ID_PATTERN.fullmatch(job_dir.name):
            continue
        marker = job_dir / ".retention-start"
        try:
            if (job_dir / ".recovery-hold").is_file():
                continue
            if not marker.is_file():
                # Interrupted runs and .recovery archives never expire implicitly.
                continue
            reference_mtime = marker.stat().st_mtime
            if reference_mtime > cutoff:
                continue
            shutil.rmtree(job_dir)
            removed.append(job_dir.name)
        except OSError:
            continue
    return removed


def container_name(calculation_id: str) -> str:
    return f"phynite-local-{calculation_id.lower()}"[:120]


def effective_local_vcpus(job: dict[str, Any]) -> int:
    """Scheduler grants span nodes; never clamp them to the controller's CPU count."""
    if os.environ.get("PHYNITE_HPC_SCHEDULER"):
        import hpc
        try:
            ranks = hpc.positive(job.get("vcpus"), "Requested MPI ranks")
            memory = hpc.positive(job.get("memoryMiB"), "Requested memory MiB", 1_073_741_824)
            allocation = hpc.current_allocation(os.environ["PHYNITE_HPC_SCHEDULER"])
            hpc.validate_job_resources(allocation, ranks, memory)
        except hpc.HpcError as exc:
            raise WorkerError(str(exc)) from exc
        return ranks
    return max(1, min(int(job.get("vcpus") or 1), os.cpu_count() or 1))


def local_resource_limit_reason(job: dict[str, Any]) -> str | None:
    if os.environ.get("PHYNITE_HPC_SCHEDULER"):
        return None  # Native allocation checks enforce the explicit ranks/memory grant.
    payload = job.get("input") if isinstance(job.get("input"), dict) else {}
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    try:
        k_grid = tuple(int(settings.get(name)) for name in ("kPoint", "kPointY", "kPointZ"))
    except (TypeError, ValueError):
        return None
    if len(k_grid) != 3 or not all(value > 0 for value in k_grid):
        return None
    limit = max(1, int(os.environ.get("MAX_LOCAL_KPOINT_PRODUCT", "4096")))
    product = k_grid[0] * k_grid[1] * k_grid[2]
    if product <= limit:
        return None
    formatted_grid = "×".join(str(value) for value in k_grid)
    return (
        f"Local compute resource check rejected the {formatted_grid} k-grid ({product:,} points); "
        f"this development worker is limited to {limit:,} before symmetry reduction. "
        "Reduce the grid. For a slab, set the non-periodic axis to 1."
    )


def stop_container(name: str) -> None:
    docker_command("stop", "--time", "10", name, check=False)
    docker_command("rm", "-f", name, check=False)


def ensure_previous_execution_stopped(job_dir: Path, runtime: str, name: str) -> None:
    """Never hash or move a workspace while a previous solver can still write it."""
    if runtime == "docker":
        stop_container(name)
        reply = docker_command("inspect", "--format", "{{.State.Running}}", name, check=False)
        if reply.returncode == 0:
            raise WorkerError("The previous Docker container still exists; stop/remove it before recovering its workspace.")
        if "No such" not in reply.stderr:
            raise WorkerError("Cannot confirm the previous Docker container is absent; recovery preserves the workspace in place.")
        return
    if not recovery.has_execution_evidence(job_dir):
        return
    if psutil is None:
        raise WorkerError("Install psutil and stop prior native execution before recovering its workspace.")
    journal_path = job_dir / recovery.JOURNAL
    try:
        journal = json.loads(journal_path.read_text()) if journal_path.is_file() else {}
        recorded = journal.get("nativeProcess", {})
        previous_runtime = journal.get("runtimeIdentity", {})
        previous_allocation = previous_runtime.get("schedulerAllocation")
        if previous_allocation:
            import hpc
            try:
                state = hpc.status(previous_allocation["scheduler"], previous_allocation["jobId"])["state"]
            except (hpc.HpcError, KeyError, TypeError) as exc:
                raise WorkerError("Cannot verify the prior HPC allocation stopped; inspect/cancel it before recovering shared checkpoints.") from exc
            terminal = {"COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "NODE_FAIL", "OUT_OF_MEMORY", "PREEMPTED", "BOOT_FAIL", "DEADLINE", "REVOKED", "F", "X"}
            if state not in terminal:
                raise WorkerError("The prior HPC allocation is active or unknown; stop/cancel it and confirm it is terminal before recovering shared checkpoints, including a retry inside the same allocation.")
        elif previous_runtime.get("scheduler") or os.environ.get("PHYNITE_HPC_SCHEDULER"):
            raise WorkerError("The old workspace has no scheduler allocation identity; inspect and stop remote ranks before manual recovery.")
        pid = recorded.get("pid")
        same_host = recorded.get("host", previous_runtime.get("host")) == socket.gethostname()
        if isinstance(pid, int) and pid > 1 and same_host:
            try:
                previous = psutil.Process(pid)
                matches = (previous.create_time() == recorded.get("createTimeEpoch")
                           and previous.cwd() == str(job_dir.resolve())
                           and previous.cmdline() == recorded.get("argv")
                           and os.getpgid(pid) == pid)
                if matches:
                    os.killpg(pid, signal.SIGTERM)
                    try:
                        previous.wait(timeout=10)
                    except psutil.TimeoutExpired:
                        # Recheck identity before sending a stronger signal.
                        if previous.create_time() == recorded["createTimeEpoch"]:
                            os.killpg(pid, signal.SIGKILL)
                            previous.wait(timeout=10)
            except (psutil.NoSuchProcess, ProcessLookupError):
                pass
        # An old worker can die in the interval before PID journaling, or an MPI
        # leader may exit while children survive. Such processes require an
        # explicit stop; a guessed/reused PID is never killed automatically.
        for process in psutil.process_iter():
            try:
                if process.pid != os.getpid() and Path(process.cwd()).resolve().is_relative_to(job_dir.resolve()) and process.status() != psutil.STATUS_ZOMBIE:
                    raise WorkerError("A native process still uses this workspace; stop it explicitly before recovering checkpoints.")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except (OSError, ValueError, TypeError, psutil.AccessDenied, psutil.TimeoutExpired) as exc:
        raise WorkerError("Cannot verify prior native process identity; preserve the workspace and inspect its processes.") from exc


def compute_seconds(job_dir: Path, *, freeze: bool = False) -> int:
    path = job_dir / ".compute-clock.json"
    if not path.is_file():
        return 0
    clock = json.loads(path.read_text(encoding="utf-8"))
    total = int(clock.get("totalNanoseconds") or 0)
    started = clock.get("startedMonotonicNs")
    if started is not None:
        total += max(0, time.monotonic_ns() - int(started))
    if freeze:
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"totalNanoseconds": total, "startedMonotonicNs": None}))
        temporary.replace(path)
    return math.ceil(total / 1_000_000_000)


def execution_compute_phase(job_dir: Path) -> str:
    if (job_dir / "results/result.json").is_file():
        return "FINALIZING"
    return "COMPUTING" if compute_seconds(job_dir) else "PREPARING"


def run_job(*args, **kwargs) -> str:
    client, worker_id, job, work_root = args[:4]
    paid = job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"}
    job_dir = work_root / safe_name(job.get("calculationId"), "calculation ID")
    lease_stop = threading.Event()
    lost = threading.Event()
    def maintain_lease():
        failures = 0
        while not lease_stop.wait(LEASE_HEARTBEAT_SECONDS):
            try:
                seconds = min(compute_seconds(job_dir), int(job["fundedComputeSeconds"])) if paid else 0
                finalizing = (job_dir / "results/result.json").is_file()
                reply = client.post(f"/worker/v1/jobs/{job['calculationId']}/heartbeat", {
                    "workerId": worker_id, "ownerId": job["ownerId"], "kind": job.get("kind", "qe"),
                    **job.get("_effectiveResources", {}),
                    "computePhase": execution_compute_phase(job_dir),
                    **({"computeSeconds": seconds} if paid else {}),
                    "progress": 95 if finalizing else 35,
                    "stage": "Finalizing result artifacts" if finalizing else "Preparing or computing"})
                if paid:
                    job["fundedComputeSeconds"] = max(int(job["fundedComputeSeconds"]), int(reply.get("fundedComputeSeconds", job["fundedComputeSeconds"]))) if job.get("cloudMode") == "paid" else int(reply.get("fundedComputeSeconds", job["fundedComputeSeconds"]))
                failures = 0
                if reply.get("cancelRequested"):
                    lost.set()
            except WorkerError:
                failures += 1
                if failures >= 4:
                    if paid:
                        job["fundingPlatformFailure"] = True
                    lost.set()
    thread = threading.Thread(target=maintain_lease, daemon=True)
    thread.start()
    original_stop = args[8] if len(args) > 8 else kwargs.get("should_stop", lambda: False)
    stopped = lambda: lost.is_set() or original_stop()
    class LeaseBoundClient:
        def __getattr__(self, name):
            value = getattr(client, name)
            if name not in {"post", "upload", "download"}:
                return value
            def guarded(*parameters, **options):
                if stopped():
                    raise WorkerError("Worker lease/cancellation stopped result transfer; terminal output and checkpoints remain available for verified recovery.")
                return value(*parameters, **options)
            return guarded
    args = (LeaseBoundClient(), *args[1:])
    if len(args) > 8:
        args = (*args[:8], stopped, *args[9:])
    else:
        kwargs["should_stop"] = stopped
    desktop = os.environ.get("PHYNITE_APP_MODE") == "local" and kwargs.get("runtime") == "native"
    reserved = False
    terminal = "interrupted"
    reason = "Local execution stopped before a terminal result was acknowledged. Scratch was retained."
    try:
        if desktop:
            resource_path = f"/__local/jobs/{job['calculationId']}"
            while not stopped():
                grant = client.post(resource_path + "/reserve", {"vcpus": int(job.get("vcpus") or 1), "memoryMiB": int(job.get("memoryMiB") or 2048)})
                if grant.get("reserved") is True:
                    reserved = True
                    break
                if grant.get("queued") is not True:
                    raise WorkerError("Local scheduler did not grant this job's resource reservation.")
                time.sleep(0.5)
            if not reserved:
                raise WorkerError("Local execution was stopped while waiting for resources.")
        terminal = _run_job(*args, **kwargs)
        reason = None
        return terminal
    finally:
        lease_stop.set()
        thread.join(timeout=5)
        if reserved:
            try:
                client.post(resource_path + "/release", {"status": terminal if terminal in {"completed", "failed", "cancelled"} else "interrupted", "reason": reason})
            except WorkerError as error:
                print(f"Local reservation could not be released: {error}", file=sys.stderr)


def _run_job(
    client: ApiClient,
    worker_id: str,
    job: dict[str, Any],
    work_root: Path,
    image: str,
    heartbeat_seconds: int,
    timeout_seconds: int,
    pseudo_root: Path,
    should_stop: Callable[[], bool] = lambda: False,
    runtime: str = "docker",
    md_image: str | None = None,
    packaged_job_image: bool = False,
) -> str:
    calculation_id = safe_name(job.get("calculationId"), "calculation ID")
    safe_name(job.get("ownerId"), "owner ID")
    job_dir = work_root / calculation_id
    job_kind = str(job.get("kind") or "qe")
    selected_image = md_image if job_kind in {"md-analysis", "md-simulation"} else image
    identity = recovery.claim_identity(job)
    name = container_name(calculation_id)
    ensure_previous_execution_stopped(job_dir, runtime, name)
    if has_recoverable_terminal_result(job_dir, calculation_id):
        journal_path = job_dir / recovery.JOURNAL
        if journal_path.is_file():
            recorded = json.loads(journal_path.read_text())
            issues = recovery.verify_claim(job_dir, identity, recorded.get("runtimeIdentity", {}))
            if issues:
                raise WorkerError("Terminal result identity verification failed: " + " ".join(issues))
        print(f"Resuming result upload for {calculation_id}; compute will not run again.")
        return upload_results(client, worker_id, job, job_dir)
    try:
        runtime_record = recovery.runtime_identity(runtime, selected_image, job_kind)
    except recovery.RecoveryError as exc:
        if not recovery.has_execution_evidence(job_dir):
            raise WorkerError(str(exc)) from exc
        runtime_record = {"mode": runtime, "identityUnavailable": True}
    if recovery.has_execution_evidence(job_dir) and not (job_dir / ".retention-start").is_file():
        try:
            mismatches = recovery.verify_claim(job_dir, identity, runtime_record)
        except recovery.RecoveryError as exc:
            mismatches = [str(exc)]
        attempt = recovery.preserve(job_dir, "Execution was interrupted before a terminal result was recorded.", mismatches)
        message = ("Interrupted execution was preserved as " + attempt["relativePath"] +
                   ". Use recovery.py inspect/restore to verify checkpoints and choose a solver-specific continuation; "
                   "automatic restart is disabled to preserve MD integrator and thermodynamic state.")
        fallback_result(job_dir, job, "failed", message, f"local-{runtime}", platform_failure=True)
        manifest_path = job_dir / "results" / "result.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["recovery"] = attempt
        manifest_path.write_text(json.dumps(manifest, indent=2))
        return upload_results(client, worker_id, job, job_dir)
    resource_limit_reason = None if job_kind != "qe" or job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} else local_resource_limit_reason(job)
    if resource_limit_reason:
        reset_generated_workspace(job_dir)
        fallback_result(job_dir, job, "failed", resource_limit_reason, f"local-{runtime}")
        return upload_results(client, worker_id, job, job_dir)
    try:
        prepare_workspace(client, job, job_dir, pseudo_root)
    except Exception as exc:
        reset_generated_workspace(job_dir)
        fallback_result(job_dir, job, "failed", f"Local worker could not prepare the job: {exc}", f"local-{runtime}", platform_failure=True)
        return upload_results(client, worker_id, job, job_dir)
    vcpus = effective_local_vcpus(job)
    memory_mib = (int(job["memoryMiB"]) if os.environ.get("PHYNITE_HPC_SCHEDULER") or os.environ.get("PHYNITE_APP_MODE") == "local" else
                  max(1024 if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} else 2048, int(job.get("memoryMiB") or 2048)))
    if not selected_image:
        reset_generated_workspace(job_dir)
        fallback_result(job_dir, job, "failed", "This worker has no MD runtime installed.", f"local-{runtime}", platform_failure=True)
        return upload_results(client, worker_id, job, job_dir)
    runner_path = {
        "md-analysis": "/opt/phynite/md_local/analysis_runner.py",
        "md-simulation": "/opt/phynite/md_local/runner.py",
    }.get(job_kind, "/opt/phynite/local_runner.py")
    command = [
        "docker",
        "run",
        "--rm",
        "--read-only",
        "--network", "none",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--pids-limit", str(max(512, vcpus * 8)),
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
        "--name",
        name,
        "--cpus",
        str(vcpus),
        "--memory",
        f"{memory_mib}m",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "-e",
        f"PHYNITE_CALCULATION_ID={calculation_id}",
        "-e",
        f"PHYNITE_VCPUS={vcpus}",
        "-e",
        f"PHYNITE_MEMORY_MIB={memory_mib}",
        "-e", "PHYNITE_HEADLESS_JOB=1",
        "-e", f"PHYNITE_MD_TIMEOUT_SECONDS={math.ceil(timeout_seconds) if math.isfinite(timeout_seconds) else 0}",
        "-e", f"PHYNITE_FUNDING_MODE={job.get('cloudMode', 'personal')}",
        "-e", "PHYNITE_EXECUTION_MODE=cloud-docker" if job.get("computeBackend") in {"CLOUD_EC2", "CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} else "PHYNITE_EXECUTION_MODE=local-docker",
        "-e",
        f"PHYNITE_QE_PARALLEL_MODE={os.environ.get('PHYNITE_QE_PARALLEL_MODE', 'auto')}",
        "-e",
        "HOME=/tmp",
        "-v",
        f"{job_dir.resolve()}:/work",
        "--entrypoint",
        "python3",
        selected_image,
        runner_path,
    ]
    if packaged_job_image:
        runner_path = {
            "md-analysis": "/opt/phynite-app/backend/md_local/analysis_runner.py",
            "md-simulation": "/opt/phynite-app/backend/md_local/runner.py",
        }.get(job_kind, "/opt/phynite-app/backend/compute/local_runner.py")
        command[-1] = runner_path
    environment = None
    if runtime == "native":
        runner = Path(__file__).resolve().parents[1] / {
            "md-analysis": "md_local/analysis_runner.py",
            "md-simulation": "md_local/runner.py",
        }.get(job_kind, "compute/local_runner.py")
        try:
            python = scientific_python("dft" if job_kind == "qe" else "md" if job_kind == "md-simulation" else "analysis")
            if not python:
                raise WorkerError("This job's scientific Python runtime is not installed. Complete runtime setup in Settings > Compute for this workspace.")
            command = [python, str(runner)]
            environment = native_environment(job_dir.resolve(), calculation_id, vcpus, memory_mib, timeout_seconds)
            if os.environ.get("PHYNITE_APP_MODE") == "local":
                command = desktop_native_sandbox().command(job_dir.resolve(), command)
                environment["PHYNITE_EXECUTION_MODE"] = "local-native-sandbox"
        except (WorkerError, RuntimeError, OSError) as exc:
            fallback_result(job_dir, job, "failed", str(exc), "local-native", platform_failure=True)
            return upload_results(client, worker_id, job, job_dir)
    recovery.begin(job_dir, identity, runtime_record)
    recovery.mark(job_dir, "running")
    worker_log = job_dir / "worker-container.log"
    started = time.monotonic()
    cancelled = False
    timed_out = False
    heartbeat_failures = 0
    scf_reader = ScfConvergenceReader()
    last_heartbeat_at = -heartbeat_seconds
    last_presence_report = time.monotonic()
    with worker_log.open("w", encoding="utf-8") as output:
        try:
            process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, text=True, cwd=job_dir, env=environment, start_new_session=runtime == "native")
        except OSError as exc:
            message = f"Could not start local compute: {exc}"
            output.write(message + "\n")
            output.flush()
            fallback_result(job_dir, job, "failed", message, f"local-{runtime}", platform_failure=True)
            return upload_results(client, worker_id, job, job_dir)
        if runtime == "native" and os.environ.get("PHYNITE_APP_MODE") == "local":
            try:
                client.post(f"/__local/jobs/{calculation_id}/attach", {"pid": process.pid})
            except WorkerError as exc:
                stop_native_process(process)
                message = f"Local compute could not register its process with the resource monitor: {exc}"
                output.write(message + "\n")
                output.flush()
                fallback_result(job_dir, job, "failed", message, "local-native", platform_failure=True)
                return upload_results(client, worker_id, job, job_dir)
        recovery.mark(job_dir, "running", effectiveResources={"effectiveVcpus": vcpus, "effectiveMemoryMiB": memory_mib})
        job["_effectiveResources"] = {"effectiveVcpus": vcpus, "effectiveMemoryMiB": memory_mib}
        if runtime == "native" and isinstance(process.pid, int):
            try:
                if psutil is None:
                    raise WorkerError("psutil is required to journal the native execution identity.")
                child = psutil.Process(process.pid)
                recovery.mark(job_dir, "running", nativeProcess={"pid": process.pid, "host": socket.gethostname(), "createTimeEpoch": child.create_time(), "argv": command})
            except psutil.NoSuchProcess:
                pass  # An immediately exited child cannot mutate recovery data.
        def stop_execution() -> None:
            if runtime == "native":
                stop_native_process(process)
            else:
                stop_container(name)
        try:
            while process.poll() is None:
                if should_stop():
                    stop_execution()
                    raise WorkerError(
                        "Local worker stopped; scratch/checkpoints are preserved. On reclaim the worker will require verified manual recovery."
                    )
                elapsed = time.monotonic() - started
                if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} and compute_seconds(job_dir) >= int(job["fundedComputeSeconds"]):
                    # A verified top-up can arrive after the periodic heartbeat.
                    # Check the same reservation before stopping this solver.
                    try:
                        funding = client.post(f"/worker/v1/jobs/{calculation_id}/heartbeat", {
                            "workerId": worker_id, "ownerId": job["ownerId"], "kind": job_kind,
                            "computeSeconds": int(job["fundedComputeSeconds"]), "computePhase": "COMPUTING"})
                        job["fundedComputeSeconds"] = max(int(job["fundedComputeSeconds"]), int(funding.get("fundedComputeSeconds", job["fundedComputeSeconds"]))) if job.get("cloudMode") == "paid" else int(funding.get("fundedComputeSeconds", job["fundedComputeSeconds"]))
                        if not funding.get("cancelRequested") and compute_seconds(job_dir) < int(job["fundedComputeSeconds"]):
                            continue
                    except WorkerError:
                        job["fundingPlatformFailure"] = True
                    cancelled = True
                    stop_execution()
                    compute_seconds(job_dir, freeze=True)
                    break
                if elapsed >= timeout_seconds:
                    timed_out = True
                    stop_execution()
                    break
                if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} and elapsed - last_heartbeat_at < heartbeat_seconds:
                    time.sleep(0.25)
                    continue
                last_heartbeat_at = elapsed
                progress = estimate_progress(job_dir, str((job.get("input") or {}).get("calculationType") or ""))
                stage, log_tail = latest_log_tail(job_dir)
                scf_convergence = scf_reader.read(job_dir) if job_kind == "qe" and not (job.get("input") or {}).get("scfSource") else None
                report_presence = time.monotonic() - last_presence_report >= 60
                try:
                    heartbeat = client.post(
                        f"/worker/v1/jobs/{calculation_id}/heartbeat",
                        {
                            "workerId": worker_id,
                            "ownerId": job["ownerId"],
                            "kind": job_kind,
                            "progress": progress,
                            "computePhase": execution_compute_phase(job_dir),
                            **recorded_execution_resources(job_dir),
                            **({"computeSeconds": min(compute_seconds(job_dir), int(job["fundedComputeSeconds"]))} if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} else {}),
                            "stage": stage,
                            "logTail": log_tail,
                            **({"scfConvergence": scf_convergence} if scf_convergence else {}),
                            "reportPresence": report_presence,
                            **({"telemetry": machine_telemetry(work_root, runtime, image, md_image)} if report_presence else {}),
                        },
                    )
                    if report_presence:
                        last_presence_report = time.monotonic()
                    heartbeat_failures = 0
                    if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"}:
                        job["fundedComputeSeconds"] = max(int(job["fundedComputeSeconds"]), int(heartbeat.get("fundedComputeSeconds", job["fundedComputeSeconds"]))) if job.get("cloudMode") == "paid" else int(heartbeat.get("fundedComputeSeconds", job["fundedComputeSeconds"]))
                    if heartbeat.get("cancelRequested"):
                        cancelled = True
                        stop_execution()
                        break
                except WorkerError:
                    heartbeat_failures += 1
                    if heartbeat_failures >= 4:
                        stop_execution()
                        raise
                time.sleep(min(heartbeat_seconds, 1) if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} else heartbeat_seconds)
        finally:
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                stop_execution()
                process.wait(timeout=20)

    if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"}:
        compute_seconds(job_dir, freeze=True)
    resource_failure = None
    if runtime == "native" and os.environ.get("PHYNITE_APP_MODE") == "local":
        reservation = client.post(f"/__local/jobs/{calculation_id}/status", {})
        reservation = reservation.get("reservation", reservation)
        if reservation.get("status") == "failed":
            resource_failure = str(reservation.get("reason") or "The local resource watchdog stopped this execution.")
    if resource_failure:
        fallback_result(job_dir, job, "failed", resource_failure, "local-native-sandbox")
    elif cancelled:
        fallback_result(job_dir, job, "cancelled", ("Compute funding ended; the job was stopped." if job.get("computeBackend") in {"CLOUD_PAID_EC2", "CLOUD_PILOT_EC2"} and compute_seconds(job_dir) >= int(job["fundedComputeSeconds"]) else "Calculation was cancelled by the user."), f"local-{runtime}", platform_failure=job.get("fundingPlatformFailure") is True)
    elif timed_out:
        fallback_result(job_dir, job, "failed", f"Local calculation exceeded its {timeout_seconds}-second runtime allowance. Scratch/checkpoints remain in the local workspace.", f"local-{runtime}")
    elif process.returncode != 0 and not (job_dir / "results" / "result.json").is_file():
        fallback_result(job_dir, job, "failed", f"Local compute process exited with code {process.returncode}.", f"local-{runtime}", platform_failure=process.returncode in {125, 126, 127})
    if resource_failure or cancelled or timed_out or process.returncode != 0:
        # Terminal diagnostics are uploadable, but solver scratch remains available
        # until the researcher deliberately archives/removes the workspace.
        (job_dir / ".recovery-hold").touch()
        recovery.mark(job_dir, "stopped", recoveryRequired=True)
    return upload_results(client, worker_id, job, job_dir)


def worker_id(work_dir: Path) -> str:
    identity_file = work_dir / ".worker-id"
    try:
        identity = identity_file.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        host = re.sub(r"[^A-Za-z0-9_-]+", "-", socket.gethostname()).strip("-")[:40] or "mac"
        identity = f"{host}-{uuid.uuid4().hex[:16]}"
        try:
            descriptor = os.open(identity_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return worker_id(work_dir)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(identity + "\n")
    except OSError as exc:
        raise WorkerError("Cannot read the local worker identity from the work directory.") from exc
    if not ID_PATTERN.fullmatch(identity):
        raise WorkerError("The local worker identity is invalid. Check the .worker-id file in the work directory.")
    return identity


def machine_telemetry(work_dir: Path, runtime: str, qe_image: str, md_image: str | None) -> dict[str, Any]:
    """Report observed host capacity; missing psutil values remain unknown."""
    disk = shutil.disk_usage(work_dir)
    return {
        "cpuPercent": round(psutil.cpu_percent(interval=0.1), 1) if psutil else None,
        "availableMemoryBytes": int(psutil.virtual_memory().available) if psutil else None,
        "diskFreeBytes": int(disk.free),
        "diskTotalBytes": int(disk.total),
        "runtime": runtime,
        "qeImageDigest": qe_image if runtime == "docker" else None,
        "mdImageDigest": md_image if runtime == "docker" else None,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Phynite calculation jobs on your computer.")
    parser.add_argument("--packaged-job-image", action="store_true", help="Use the paired QE/LAMMPS image as an isolated per-job runtime.")
    parser.add_argument("--paid-job-id", default="", help="Instance-bound paid job, with renewable compute funding.")
    parser.add_argument("--cloud", action="store_true", help="Use the dedicated IAM Cloud job broker, never personal authentication.")
    parser.add_argument("--region", default="ap-southeast-1")
    parser.add_argument("--host-deadline", type=int, default=0)
    parser.add_argument("--config", type=Path, help="Private JSON configuration downloaded from Account > Your computer.")
    parser.add_argument("--api-url", default=os.environ.get("PHYNITE_API_URL", ""))
    parser.add_argument("--token", default=os.environ.get("PHYNITE_LOCAL_WORKER_TOKEN", ""))
    parser.add_argument("--image", default=os.environ.get("PHYNITE_LOCAL_WORKER_IMAGE", DEFAULT_IMAGE))
    parser.add_argument("--md-image", default=os.environ.get("PHYNITE_LOCAL_MD_IMAGE", DEFAULT_MD_IMAGE))
    parser.add_argument("--runtime", choices=("docker", "native"), default="docker", help="Use an architecture-native Docker image or installed QE executables.")
    parser.add_argument("--work-dir", type=Path, default=Path(os.environ.get("PHYNITE_LOCAL_WORKER_DIR", DEFAULT_WORK_ROOT)))
    parser.add_argument("--pseudo-root", type=Path, default=Path(os.environ.get("PHYNITE_LOCAL_PSEUDO_ROOT", DEFAULT_PSEUDO_ROOT)))
    parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("PHYNITE_LOCAL_WORKER_POLL_SECONDS", "10")))
    parser.add_argument("--heartbeat-seconds", type=int, default=int(os.environ.get("PHYNITE_LOCAL_WORKER_HEARTBEAT_SECONDS", "15")))
    parser.add_argument("--timeout-seconds", type=int, default=int(os.environ.get("PHYNITE_LOCAL_WORKER_TIMEOUT_SECONDS", "86400")))
    parser.add_argument("--calculation-id", default="", help="Claim only this owned queued job (for scheduler allocations).")
    parser.add_argument("--once", action="store_true", help="Claim at most one job, then exit.")
    parser.add_argument("--check", action="store_true", help="Validate the selected runtime and configuration without claiming a job.")
    args = parser.parse_args(argv)
    if args.timeout_seconds < 0:
        raise WorkerError("Timeout must be positive seconds, or 0 for an explicitly unlimited personal run.")
    if args.calculation_id:
        safe_name(args.calculation_id, "calculation ID")
    if args.config:
        try:
            with args.config.expanduser().open(encoding="utf-8") as handle:
                config = json.loads(handle.read(16_001))
            if not isinstance(config, dict) or not isinstance(config.get("apiUrl"), str) or not isinstance(config.get("token"), str):
                raise ValueError("Missing apiUrl or token")
        except (OSError, ValueError) as exc:
            raise WorkerError("Computer configuration could not be read. Download a new configuration from Account.") from exc
        args.api_url = args.api_url or config["apiUrl"]
        args.token = args.token or config["token"]
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.api_url.startswith("https://") and not (urllib.parse.urlsplit(args.api_url).scheme == "http" and urllib.parse.urlsplit(args.api_url).hostname in {"localhost", "127.0.0.1", "::1"}):
        raise WorkerError("PHYNITE_API_URL must be HTTPS or localhost")
    if args.cloud and os.getuid() == 0:
        raise WorkerError("Run the Cloud broker as a non-root user")
    if args.cloud and (args.runtime != "docker" or args.config or args.token or (not args.paid_job_id and not time.time() < args.host_deadline <= time.time() + 10800)):
        raise WorkerError("Cloud requires Docker, IAM credentials and a host deadline within three hours; personal credentials are forbidden")
    if not args.cloud and len(args.token) < 32:
        raise WorkerError("PHYNITE_LOCAL_WORKER_TOKEN is missing or too short")
    args.work_dir = args.work_dir.expanduser().resolve()
    args.pseudo_root = args.pseudo_root.expanduser().resolve()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    lock_handle = (args.work_dir / ".worker.lock").open("w", encoding="utf-8")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        lock_handle.close()
        raise WorkerError("Another Phynite local worker is already using this work directory") from exc
    lock_handle.write(str(os.getpid()))
    lock_handle.flush()
    cloud_image_reference = args.image
    if args.cloud and (not re.fullmatch(r"public\.ecr\.aws/[A-Za-z0-9/_-]+@sha256:[a-f0-9]{64}", args.image) or args.md_image != args.image):
        raise WorkerError("Cloud jobs require one immutable paired runtime reference for QE and LAMMPS")
    capabilities = ["qe"]
    if os.environ.get("PHYNITE_HPC_SCHEDULER"):
        if args.runtime != "native" or args.cloud or not args.calculation_id:
            raise WorkerError("HPC allocations require native personal compute and --calculation-id.")
        import hpc
        try:
            hpc.current_allocation(os.environ["PHYNITE_HPC_SCHEDULER"])
        except hpc.HpcError as exc:
            raise WorkerError(str(exc)) from exc
    if args.runtime == "native":
        if os.environ.get("PHYNITE_APP_MODE") == "local":
            capabilities = []
            try:
                validate_native_runtime()
                capabilities.append("qe")
            except WorkerError as error:
                print(f"DFT compute unavailable: {error}", file=sys.stderr)
            if native_md_analysis_available():
                capabilities.append("md-analysis")
                if shutil.which("lmp") or shutil.which("lammps"):
                    capabilities.append("md-simulation")
            if not capabilities:
                raise WorkerError("No usable DFT or MD runtime is installed. Complete native runtime setup in the web application.")
            if "md-simulation" not in capabilities:
                args.md_image = None
        else:
            validate_native_runtime()
            if native_md_runtime_available():
                capabilities.extend(["md-analysis", "md-simulation"])
            else:
                args.md_image = None
    else:
        args.image = validate_runtime(args.image, packaged_job_image=args.packaged_job_image)
        try:
            args.md_image = validate_md_runtime(args.md_image, packaged_job_image=args.packaged_job_image)
            capabilities.extend(["md-analysis", "md-simulation"])
        except WorkerError as exc:
            args.md_image = None
            print(f"MD compute unavailable: {exc}. QE jobs remain available.", file=sys.stderr)
    if args.cloud and not args.paid_job_id:
        capabilities = [capability for capability in capabilities if capability in {"qe", "md-simulation"}]
    if args.check:
        print(
            f"Local compute is ready: {platform.machine()} · {args.runtime} · "
            f"{', '.join(capabilities)} · {args.work_dir}"
        )
        lock_handle.close()
        return 0

    client = CloudApiClient(args.api_url, args.region, args.host_deadline, cloud_image_reference, args.paid_job_id) if args.cloud else ApiClient(args.api_url, args.token)
    if args.paid_job_id:
        client.work_root = args.work_dir
    identity = worker_id(args.work_dir)
    workflow_version = 1 if args.runtime == "native" and (Path(__file__).resolve().parents[1] / "compute/workflow_scf.py").is_file() else 0
    if args.runtime == "docker":
        image_info = json.loads(docker_command("image", "inspect", args.image).stdout)[0]
        workflow_version = 1 if image_info.get("Config", {}).get("Labels", {}).get("com.phynite.workflow-protocol") == "1" else 0
    runtime_manifest = md_runtime_manifest(args.runtime, args.md_image) if "md-simulation" in capabilities else None
    stopping = False

    def request_stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    print(
        f"Phynite local compute worker {identity} is ready for "
        f"{', '.join(capabilities)}. One job will run at a time."
    )
    last_presence_report = 0.0
    last_cleanup = 0.0
    while not stopping:
        try:
            if time.monotonic() - last_cleanup >= 3600:
                removed = cleanup_expired_workspaces(args.work_dir)
                if removed:
                    print(f"Removed {len(removed)} expired local calculation workspace(s).")
                last_cleanup = time.monotonic()
            report_presence = time.monotonic() - last_presence_report >= 60
            payload = client.post(
                "/worker/v1/jobs/claim",
                {
                    "workerId": identity,
                    "reportPresence": report_presence,
                    "capabilities": capabilities,
                    "workflowVersion": workflow_version,
                    **({"executionAffinity": {"scheduler": os.environ["PHYNITE_HPC_SCHEDULER"], "profileSha256": os.environ["PHYNITE_HPC_PROFILE_SHA256"]}}
                       if os.environ.get("PHYNITE_HPC_SCHEDULER") else {}),
                    **({"requestedCalculationId": args.calculation_id} if args.calculation_id else {}),
                    **({"telemetry": machine_telemetry(args.work_dir, args.runtime, args.image, args.md_image)} if report_presence else {}),
                    **({"runtimeManifest": runtime_manifest} if runtime_manifest else {}),
                },
            )
            if report_presence:
                last_presence_report = time.monotonic()
            job = payload.get("job")
            if job is None:
                if args.once:
                    if args.calculation_id:
                        print("Targeted allocation found no claimable job; check dependencies, affinity, and lease state before resubmitting.", file=sys.stderr)
                        return 3
                    return 0
                time.sleep(max(2, args.poll_seconds))
                continue
            if not isinstance(job, dict):
                raise WorkerError("Worker API returned an invalid job")
            if args.calculation_id and job.get("calculationId") != args.calculation_id:
                raise WorkerError("Broker returned a different calculation than the requested HPC allocation.")
            if os.environ.get("PHYNITE_HPC_SCHEDULER") and job.get("executionAffinity") != {"scheduler": os.environ["PHYNITE_HPC_SCHEDULER"], "profileSha256": os.environ["PHYNITE_HPC_PROFILE_SHA256"]}:
                raise WorkerError("Claimed calculation does not match this scheduler allocation's immutable profile affinity.")
            print(f"Claimed {job.get('calculationId')} · {(job.get('input') or {}).get('calculationType')}")
            status = run_job(
                client,
                identity,
                job,
                args.work_dir,
                args.image,
                max(5, args.heartbeat_seconds),
                float("inf") if args.paid_job_id else min(900, max(1, int(job.get("deadlineAtEpoch") or args.host_deadline) - int(time.time()))) if args.cloud else (float("inf") if args.timeout_seconds == 0 else max(60, args.timeout_seconds)),
                args.pseudo_root,
                lambda: stopping or (args.cloud and not args.paid_job_id and time.time() >= args.host_deadline),
                runtime=args.runtime,
                md_image=args.md_image,
                packaged_job_image=args.packaged_job_image,
            )
            print(f"Finished {job.get('calculationId')} · {status}")
            if args.once or args.paid_job_id:
                return 0 if status == "completed" else 1
        except WorkerError as exc:
            print(f"Local worker error: {exc}", file=sys.stderr)
            if args.once:
                return 1
            time.sleep(max(5, args.poll_seconds))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except WorkerError as exc:
        print(f"Local worker configuration error: {exc}", file=sys.stderr)
        raise SystemExit(2)
