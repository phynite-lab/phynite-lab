# Native scientific runtime releases

The desktop core and scientific runtimes are separate distributions. The core
does not bundle NumPy, OVITO, Quantum ESPRESSO, or LAMMPS. A runtime must include
its own Python interpreter, Python dependencies, solver executables and native
libraries for one exact operating system and architecture. Installing the npm
launcher must not require a global Python installation or Docker.

## Install directly from a reviewed upstream package lock

`backend/local_api/runtime-manifest.json` can include a `conda-lock` entry rather
than a Phynite-hosted archive. Each entry declares an exact native micromamba
release and the complete successful upstream solve: package URL, platform,
name, version, build, license, SHA-256 and byte count. The installed application
never runs a dependency solver or fetches a changing package index. The catalogue
contains no user URLs or credentials. Only the setup action downloads packages.
Python OVITO and its named renderer dependencies come from
`https://conda.ovito.org`; other packages come from conda-forge. The conda-forge
`ovito` GUI package alone does not provide the Python analysis module.

The installer verifies **all** downloaded packages before starting micromamba,
then installs from local `@EXPLICIT` file URLs with `--offline`, `--no-deps`,
`--no-rc` and `--no-env`, inside the verified OS sandbox with an empty home.
The user needs neither Python nor a system package manager. No administrator
operation is involved. This upstream-download path does not publish or bundle
the solvers in npm.

The reviewed installed-size budget is target-specific. DFT and macOS MD locks
use 4 GiB; Linux MD/OVITO locks use 8 GiB because the Linux graphics and Qt
dependencies expand beyond the smaller DFT budget. The installer measures the
actual immutable prefix before activation and reports both measured and allowed
bytes on failure. A larger budget does not relax package, checksum, sandbox or
qualification checks.

Conda rewrites embedded prefixes while linking packages. Installation therefore
takes place at its final immutable versioned prefix; moving that prefix after
installation would break it. The active inventory is replaced atomically only
after exact installed-package comparison, Python/module-origin checks, real
scientific imports and solver/MPI startup checks. A failure keeps the previous
runtime active and retains the inactive prefix's diagnostic logs. Package
licenses, recipes/source references, exact lock, and conda metadata are retained;
download/extraction caches are removed after qualification. Pseudopotentials
remain a separate user-authorized workflow.

On macOS, conda's embedded-prefix rewrite can invalidate Mach-O ad-hoc
signatures. The installer verifies each installed native signature and repairs
only invalid signatures with the system `codesign --sign - --timestamp=none`,
inside the same write-confined sandbox. This local operation uses no developer
identity, administrator privileges or network. Scientific provenance uses the
actual installed executable hashes after relocation/signature repair.

Truncated or corrupt package transfers are retried up to three times and never
executed. An explicit retry of this same inactive lock rechecks completed
downloads' exact bytes/SHA-256 before reuse, recreates the environment at the
same immutable prefix, and preserves prior diagnostic logs. It cannot replace
an active prefix or reuse an unrecognized directory.

The catalogue's `qualificationStatus` describes target testing. A successful
cross-platform solve establishes package availability; it does not certify that
platform's solver execution or sandbox. Linux/WSL2 version-one package locks require glibc
2.39 or later (Ubuntu 24.04 or a compatible distribution). Package availability
is not actual installation/execution qualification on that platform.

For maintenance, run a clean micromamba dry-run against conda-forge for each
target and desired component. DFT uses `python=3.12 qe openmpi numpy scipy
seekpath matplotlib psutil`; MD uses `python=3.12 lammps=*=*openmpi* openmpi
ovito=3.16.1=py312* numpy psutil` with channels `https://conda.ovito.org` then
`conda-forge`. Quote wildcard specs in the shell. Use `--platform osx-arm64`,
`osx-64`, `linux-64` or `linux-aarch64`; cross-solving Linux requires the explicit
glibc baseline `CONDA_OVERRIDE_GLIBC=2.39`. Save the successful JSON
output and review its entire `LINK` inventory. `scripts/lock-native-runtime.py`
prepares a catalogue entry from that evidence and a separately verified native
installer record. It never overwrites an existing target, activates a runtime,
downloads packages or claims platform qualification. Review catalogue changes
and run actual confined reference calculations before marking a target tested.
The macOS runtime lock uses official OVITO 3.11.3 because the upstream
channel does not provide 3.16.1 for that target. Linux ARM64 uses the official PyPI wheel overlay described below because the
OVITO conda channel has no Python package for that target. Its lock is prepared
but remains `not-tested-on-target` until actual native execution passes. DFT and
MD/analysis now have exact download locks for all four targets; this does not
certify all four targets for a release.

## Reviewed Linux ARM64 wheel overlay

A `conda-lock` entry can include a separate `wheels` list. Wheels are not conda
packages. Each record pins the official `files.pythonhosted.org` URL, filename,
package/version, Python/ABI/platform tags, SHA-256, exact byte size, license and
upstream source metadata. The CPython 3.12 base includes locked pip/patchelf and
native GL/EGL/OpenGL/X11 dependencies. No resolver runs during user installation.

The current Linux ARM64 overlay pins OVITO 3.16.1, traits 7.3.0,
PySide6-Essentials 6.11.2 and shiboken6 6.11.2. OVITO and Qt require
`manylinux_2_39_aarch64`, so setup rejects older glibc before downloading anything.
`RuntimeManager.status()` reports per-component transfer bytes, installation
budget, minimum glibc and compatibility reason in `requirements`.

All conda packages and wheels are fully downloaded and SHA-256 verified before
any installer starts. Wheel archive paths and metadata must match the lock.
After micromamba links only the conda packages, the runtime's own Python runs pip
with `--isolated`, `--no-index`, `--no-deps`, `--require-hashes`, binary-only local
find-links and no compilation. The same OS sandbox blocks external networking.
Installed `.dist-info` identities must match and their license metadata is retained.
The pinned runtime patchelf removes absolute build-host ELF search paths while
preserving confined `$ORIGIN` paths and appending the same runtime's `lib` directory.
No global `LD_LIBRARY_PATH` is needed. `wheel-library-relocation.json` records
every modified ELF's installed SHA-256 and search paths; the original archive
hash remains in the wheel inventory. Real imports/solver startup qualification
must pass before activation.
Interrupted wheel setup is an inactive installation; explicit retry retains and
revalidates exact download bytes and preserves the previously active runtime.

OVITO's wheel declares MIT, traits declares BSD, and Qt/shiboken declare
LGPL-3.0/GPL alternatives. Keep the actual wheel license files and fulfill the
selected Qt distribution terms. The entire environment is not MIT-only.
Use `scripts/lock-native-runtime.py --wheels reviewed-wheels.json` only alongside
a successful native-package dry-run; the tool does not invent package records or
mark a target tested.

## Packaged Linux sandbox bootstrap

Linux installation needs isolation before the scientific runtime exists. Native
platform helpers therefore include a `bootstrap` directory with non-setuid
bubblewrap and required shared libraries. The reviewed upstream package inventory
is in `backend/local_api/native-bootstrap-lock.json`; both Linux targets pin
bubblewrap 0.13.1 plus its exact build dependencies. Bootstrap locks do not assert
native target qualification.

On each native Linux target with glibc >=2.39, prepare a prefix from the exact
reviewed lock and collect its actual upstream license/source notices, then run:

```sh
python scripts/build-native-bootstrap.py \
  --prefix /path/to/locked-bootstrap-prefix \
  --target linux-arm64 \
  --notices /path/to/reviewed-bootstrap-notices \
  --output /path/to/new-bootstrap-directory
```

For a clean native build machine, the same producer can prepare the prefix from
the reviewed lock without a resolver or a preinstalled micromamba:

```sh
python scripts/build-native-bootstrap.py \
  --prepare-prefix /path/to/new-bootstrap-prefix \
  --target linux-arm64 \
  --notices /path/to/reviewed-bootstrap-notices \
  --output /path/to/new-bootstrap-directory
```

This mode pins the native installer as well as packages, verifies every download
before executing it, and links local file URLs with micromamba's `--offline`,
`--no-rc`, `--no-env` and `--no-deps`. It preserves upstream package license/recipe
metadata alongside the reviewed source notices. Existing prefix, build or output
directories are never overwritten. A failed prefix preparation retains its
downloads and installation log in a sibling `PREFIX-build` directory for review;
use a new prefix for an explicit retry.

The prefix's conda inventory, upstream URLs and SHA-256 records must match the
lock; do not rewrite provenance to make it pass. The builder verifies ELF target
architecture, resolves only prefix-owned non-system libraries, flattens internal
links, checks the system ELF interpreter, and uses the locked build-time patchelf
to set relative `$ORIGIN` search paths. The existing-prefix mode never downloads
packages. Neither mode runs sudo, changes kernel policy or publishes an artifact.
A real OS confinement probe must pass before the producer reports a
qualified bootstrap. Missing notices, host-bound libraries or failed probes stop
the build; existing output directories are never overwritten.

The npm helper's distribution manifest authenticates `bootstrap/manifest.json`.
The launcher passes its resolved directory server-side as
`PHYNITE_NATIVE_TOOLS_DIR`, discarding an inherited override. NativeSandbox checks
its target and every declared executable/library hash and rejects symlinks or
setuid/setgid files before running it. A manifest alone is not proof of isolation:
the actual write/network probe remains mandatory, including in the frozen core.
An unconfigured developer checkout can use its system bubblewrap.

Ubuntu AppArmor or kernel policy can still deny user namespaces. Setup reports
the real failure and the required administrator-managed repair; it never disables
policy or treats an environment flag as isolation. Test native Linux x64/ARM64
and actual WSL2 before claiming those environments supported.

## Prepare a standalone archive for a separate release

`scripts/build-native-runtime.py` prepares an archive and a **prepared, unpublished**
manifest for review. It never uploads files, publishes npm packages, modifies the
application's active runtime catalogue, installs system software, or fetches
pseudopotentials. A successful assembler check is not scientific convergence or
cross-platform certification.

## Prepare a genuinely relocatable environment

Build and qualify separately on `darwin-arm64`, `linux-arm64`, and
`linux-x64`. Windows uses the Linux runtime inside WSL2; a Windows PE executable
is not a supported scientific runtime.

- Supply a self-contained CPython installation, such as an appropriately licensed
  [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
  distribution. Add the scientific dependencies inside that installation.
  Copying an ordinary virtualenv leaves its interpreter, `pyvenv.cfg`, or `.pth`
  files tied to the build host and is not a distributable runtime.
- Quantum ESPRESSO must include its matching Open MPI and redistributable BLAS,
  FFT, Fortran and other libraries. A locally built Homebrew-linked `pw.x` is not
  standalone. On macOS, repair install names and RPATH to `@loader_path`/`@rpath`;
  on Linux, use relative `$ORIGIN` paths and include dependencies beyond the
  explicitly supported glibc baseline. Set and test the minimum supported OS.
- A conda environment requires actual prefix relocation. A `conda-pack` archive
  can require `conda-unpack` after extraction; the desktop installer does not run
  arbitrary post-install scripts. Do not relabel that archive as ready-to-run.
  Prepare a runtime that works at a new prefix without such a step, or first
  implement and review a specific trusted relocation protocol.
- Package all applicable license notices, exact upstream sources or required
  source-offer instructions. Preserve license obligations of CPython, QE, MPI,
  LAMMPS, OVITO and native/Python dependencies. Review OVITO's applicable edition
  and distribution terms before publishing. Potential libraries and `.UPF`
  pseudopotentials are installed separately with their own provenance.

The assembler flattens symlinks that stay inside the prepared environment and
rejects external symlinks, link cycles, privileged modes, special files, credential
filenames, private-key markers and UPFs. It does not copy the source repository,
user project data, caches, or existing worker credentials into a release.

## Assemble, inspect, then publish separately

For an already prepared MD environment, using an HTTPS destination controlled by
the eventual publisher:

```sh
python3 scripts/build-native-runtime.py \
  --source /absolute/path/to/prepared-md-runtime \
  --output /absolute/path/to/review-output \
  --component md --version <VERSION> --platform darwin-arm64 \
  --release-base-url https://YOUR-RELEASE-HOST.example/native \
  --executable python=bin/python3 \
  --executable lmp=bin/lmp \
  --notice THIRD_PARTY_NOTICES.txt \
  --notice SOURCE-OFFERS.txt
```

The example host is deliberately a placeholder, never an available download.
Use your actual release destination; assembly does not make it available.

DFT additionally requires mappings for `pw.x`, `bands.x`, `dos.x`, `projwfc.x`,
`ph.x`, `q2r.x`, `matdyn.x`, and `mpirun`. Declare `neb.x` and `btp2` only when
present and qualified. Analysis requires Python with NumPy and OVITO.

Assembly copies the environment to a new prefix, runs isolated scientific
Python imports, checks interpreter/module origins and native library paths,
then creates a deterministic tar.gz with no symlinks. It records every file's
size and SHA-256 plus exact archive/extraction sizes. Failed qualification
does not generate an installable archive. Existing release artifacts are never
overwritten. There is no production `--skip-check` option.

Before publication, inspect the inventory and notices, run actual QE/MD/analysis
reference jobs through the sandboxed desktop worker on that platform, and test
installation on a clean machine without source checkout, Docker, compilers or
Python. Publish immutable bytes separately. Verify the uploaded archive's exact
size/SHA-256 and only then review activation of its entry in the application
catalogue. Never enable a prepared manifest whose URL is not serving those bytes.

## Upstream artifact availability

Upstream packages are ingredients, not complete Phynite runtime releases:

- The [QE download page](https://www.quantum-espresso.org/download-page/) and
  [QE releases](https://gitlab.com/QEF/q-e/-/releases) provide source/release
  material. This repository has no reviewed, complete QE+MPI+Python archive for
  all four desktop targets; local compiler output cannot establish portability.
- [LAMMPS Python installation](https://docs.lammps.org/Python_install.html) links
  the [LAMMPS PyPI distribution](https://pypi.org/project/lammps/). Release
  `2025.7.22.4.0` publishes macOS ARM64/x86-64 and Linux ARM64/x86-64 wheels.
  Pin the exact wheel filename and upstream SHA-256 before use. Wheels alone
  do not include a standalone Python/OVITO environment or qualify the Phynite
  runner, archive layout, license bundle or sandbox. A wheel is a ZIP and cannot
  be used directly as the installer's reviewed runtime tar archive.
- Python standalone releases supply the interpreter only; they do not establish
  solver capabilities or scientific correctness.

For components without a reviewed upstream package lock or a complete published
archive, the setup UI must report downloads unavailable. Detection of already
installed native executables can remain available, with capabilities determined
by their real dependencies and isolation checks.

## Frozen application native dependency inventory

`build-local-core.py` now matches the just-built executable's actual PyInstaller
native archive members against its `PKG-00.toc`. It writes
`THIRD_PARTY_NATIVE.json` next to the executable and `THIRD_PARTY_NOTICES.md`.
The inventory binds the executable SHA-256 to every copied native payload,
original input SHA-256, installed provider, and the original notice hashes. It
contains relative archive paths and provider provenance, without local absolute
build paths. Keep this file with the core in each platform package.

A library's filename never establishes its license. The collector accepts exact
installed wheel file records, CPython's interpreter/library configuration,
Homebrew keg receipts and their original license files, or Debian package file
ownership and installed copyright/common-license texts. A missing owner, missing
notice, or disagreement between archive and build TOC fails the build. System
libraries that were not copied into the executable are excluded. Linux provider
collection must still run and pass on its native release builders.

This inventory establishes which files need review; it does not prove that every
statically linked subcomponent has met its distribution obligations. Review the
full wheel notices, including plural `LICENSES.txt`. For example, the inspected
macOS lxml 6.1.3 wheel statically contains GNU libiconv 1.18, confirmed from the
exported `_libiconv_version` value `0x112`, not inferred from a package name.
Its LGPL obligations require matching corresponding source and a usable
relink/rebuild route before publishing that binary. A notice-only collection or
an unrelated upstream source archive does not qualify that gate. Scientific
runtime wheels and JS native dependencies require their own equivalent review.

The exact lxml/libiconv source bundle and offline rebuild instructions are in
[`distribution/notices/native/README.md`](../distribution/notices/native/README.md).
The collector verifies the actual native versions and archive hashes before
including their evidence; changed or unidentified versions block the build.
A modified-library relink was exercised on the current macOS ARM64 machine.
Other targets still require their own native qualification.
