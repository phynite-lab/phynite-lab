"""Build the pinned QE release for the current host, without root installation."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request

from worker import safe_extract, worker_ssl_context

VERSION = "7.5"
SHA256 = "7e1f7a9a21b63192f5135218bee20a5321b66582e4756536681b76e9c59b3cc8"
BINARIES = ("neb.x", "pw.x", "bands.x", "dos.x", "projwfc.x", "ph.x", "q2r.x", "matdyn.x")
ROOT = Path(__file__).resolve().parents[1] / ".artifacts" / "native-qe"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--prefix", type=Path, default=ROOT / "install")
    args = parser.parse_args()
    if platform.system() not in {"Linux", "Darwin"}:
        parser.error("Use Linux, macOS, or a WSL2 Linux terminal.")
    if args.jobs < 1:
        parser.error("--jobs must be positive")
    missing = [command for command in ("make", "mpifort", "mpicc", "gfortran") if not shutil.which(command)]
    if missing:
        parser.error("Install build dependencies first: " + ", ".join(missing))
    ROOT.mkdir(parents=True, exist_ok=True)
    archive = ROOT / f"qe-{VERSION}.tar.gz"
    def verified() -> bool:
        return archive.is_file() and hashlib.sha256(archive.read_bytes()).hexdigest() == SHA256
    if not verified():
        request = urllib.request.Request(f"https://github.com/QEF/q-e/archive/refs/tags/qe-{VERSION}.tar.gz", headers={"User-Agent": "PhyniteLocalSetup/1.0"})
        with urllib.request.urlopen(request, context=worker_ssl_context(), timeout=120) as response, archive.open("wb") as output:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 100_000_000:
                    raise RuntimeError("QE source exceeds the release size limit")
                output.write(chunk)
    if not verified():
        raise RuntimeError("QE source checksum mismatch; build stopped")
    source_root = ROOT / f"source-{platform.system().lower()}-{platform.machine()}"
    if not source_root.exists():
        safe_extract(archive, source_root)
    source = source_root / f"q-e-qe-{VERSION}"
    env = {**os.environ, "MPIF90": "mpifort", "F90": "gfortran", "CC": "mpicc"}
    blas = "-lopenblas"
    if platform.system() == "Darwin":
        if not shutil.which("brew"):
            parser.error("The macOS build uses Homebrew OpenBLAS and FFTW. See the platform guide.")
        def brew_prefix(package: str) -> str:
            return subprocess.check_output(["brew", "--prefix", package], text=True).strip()
        openblas, fftw = brew_prefix("openblas"), brew_prefix("fftw")
        gcc = Path(brew_prefix("gcc"))
        preprocessors = sorted((gcc / "bin").glob("cpp-*"))
        if not preprocessors:
            parser.error("Homebrew GCC C preprocessor was not found. Reinstall gcc.")
        blas = f"-L{openblas}/lib -lopenblas"
        env["LDFLAGS"] = f"-L{openblas}/lib -L{fftw}/lib"
    if (source / "make.inc").is_file():
        subprocess.run(["make", "clean"], cwd=source, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["./configure", "--enable-parallel", f"BLAS_LIBS={blas}", f"LAPACK_LIBS={blas}"], cwd=source, env=env, check=True)
    if platform.system() == "Darwin":
        # Preserve QE's generated MPI/preprocessor/include flags; Homebrew FFTW
        # lives outside configure's default library search directories.
        with (source / "make.inc").open("a") as config:
            config.write(f"\nDFLAGS += -D__FFTW3\nIFLAGS += -I{fftw}/include\nFFT_LIBS = -L{fftw}/lib -lfftw3\nCPP = {preprocessors[-1]}\n")
    subprocess.run(["make", f"-j{args.jobs}", "pw", "pp", "ph", "neb"], cwd=source, env=env, check=True)
    destination = args.prefix.expanduser().resolve() / "bin"
    destination.mkdir(parents=True, exist_ok=True)
    for binary in BINARIES:
        shutil.copy2(source / "bin" / binary, destination / binary)
    print(f"QE {VERSION} built for {platform.system()} / {platform.machine()}. Add {destination} to PATH.")


if __name__ == "__main__":
    main()
