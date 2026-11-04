# Local application distribution

The public local application's source of truth is
https://github.com/phynite-lab/phynite-lab. Phynite-owned local code is GNU AGPL
v3 only (`AGPL-3.0-only`); third-party components keep their own licenses.
The hosted implementation remains in the separate private development repository.
The package templates are deliberately incomplete: npm prepack refuses a package
without its release manifest, corresponding-source metadata and required notices.
Commands below assemble reviewable artifacts; none publishes or deploys a service.

For the user-facing installation path, start with the bilingual guide at
https://phynitelab.com/guide/npm-local-app. It includes annotated screenshots
from a clean demo workspace, platform-specific launcher commands, update
notices, and recovery steps. The guide's **Compute paths** topic explains how
the local npm runtime differs from the optional hosted worker.

## Native builds

Build the standalone app and frozen core on each exact target, using the source
commit that will be published. See `docs/native-runtime-releases.md` for scientific
solver downloads and qualification. They are separate from npm installation.

```sh
npm ci
npm run build:local
python -m pip install -r scripts/local-core-requirements.txt
python scripts/build-local-core.py
```

The isolated core build environment needs pinned build dependencies. End users
need neither that environment nor Python, AWS CLI, Docker, a compiler, or a source
checkout. The frozen core may include only the reviewed local dependency graph.
Do not assemble a release using stale cores or application output from another
commit or platform. Solver scientific libraries belong in the optional runtime,
not the npm package. Do not include restricted pseudopotentials or potentials.

The published npm release ships `darwin-arm64` (macOS Apple Silicon), `linux-arm64`,
and `linux-x64` (glibc >=2.39, including modern Arch Linux and Ubuntu 24.04+).
Windows WSL2 uses the Linux x64 package because WSL2 reports that native platform
to Node and npm. Each native package is built and qualified on its matching runner.
A target is supported only after actual native installation, isolation and
scientific reference tests pass. A cross-platform dependency solve is insufficient.

## Arch Linux / Linux x64

Use Node.js >=22.13 and npm from your preferred user-managed Node installation.
Install with `npm install -g phynite-lab`, then run `phynite-lab` in the normal
desktop session. Scientific runtime installation is available in **Settings → Compute**; choose
DFT, MD/analysis, or both. No solver, Docker, global Python or administrator
command runs during npm installation. Do not omit npm optional dependencies.

The Linux x64 package requires glibc >=2.39. It carries its own non-setuid
bubblewrap and libcap rather than depending on an Ubuntu package manager. Runtime
packages pin their full native library closure. The desktop session opens
the local app through `xdg-open`; use `phynite-lab --no-open` and the printed URL
if no default browser is configured. Saved data stays in `~/.phynite-lab` across
updates.

Packaged local releases check npm for a newer version in the background (at most
once every six hours after a successful check). The web notice shows the installed
and available versions, release notes, and a copyable
`npm install -g phynite-lab@latest` command. Finish or cancel active jobs, stop the
app, update in the terminal, and reopen it. Updates are never installed
automatically. Offline checks do not block local work; the request sends no
project data or account credentials. Development checkouts do not check npm.

The check reads only the public `latest` package metadata, uses a short timeout,
and bounds the response. A registry failure is shown as unknown and cached only
briefly, so it never blocks local work. Verify the installed launcher with
`phynite-lab --version` and compare it with `npm view phynite-lab version` after an
update. The launcher does not silently downgrade or replace an active runtime.

Unprivileged user namespaces must be available in the running kernel and policy.
Compute setup's real write/network confinement probe determines availability; a disabled
namespace or security-policy restriction blocks manual MD and runtime setup with
its actual diagnostic. The application never disables those restrictions. The
qualification environment uses an exact-path, ephemeral AppArmor fixture rather
than a global sysctl change; this fixture is never installed on users' machines.
Direct testing across every Linux desktop environment is not part of this release's evidence; native qualification uses Ubuntu 24.04 x64.

## A run fails before the solver starts

The npm launcher uses `~/.phynite-lab`; `npm run dev:local` uses
`~/.phynite-lab-dev`. Runtime installations belong to the selected data directory,
just like its projects. Do not copy a scientific environment between directories:
its native library prefixes may refer to its installation location. Install the
required DFT or MD/analysis component through the active application's setup.
DFT also requires its selected pseudopotential inputs. Setup's DFT
pseudopotentials section downloads the explicitly chosen SSSP Precision or
Efficiency library from the official pinned archive and verifies its checksums
before activation. The files and their licenses remain in this data directory;
they are not redistributed in the npm package. Explicitly uploaded UPF files do
not require installing an SSSP library. Missing selected models block the run
review before creating an attempt.

The run review checks the requested capability against the live local worker.
Missing or offline solvers block Start before a run is created. Reusable results
and modules that need no compute remain usable. Wait for installation and worker
validation to finish, then start a new run. A saved Cloud target cannot execute
through the local workflow runner; choose Your computer, or use the separate
Cloud connection's submission flow.

Execution result retains the job's failure reason and log tail. Downloadable log
artifacts remain available when the worker produced them. A preflight rejection
has no solver log because the solver never started. Inspect the displayed reason
and the selected data directory's `logs/worker-*.log` for worker startup failures.

## Local storage and QE intermediate state

Each launcher workspace defaults to `~/.phynite-lab`; `--data-dir` selects another
directory. SQLite is used for metadata and the filesystem is used for project
artifacts. The Storage page reports only inventoried project artifacts. It does
not include SQLite metadata, solver/runtime installations, worker logs, browser
cache, or unrelated files on the disk. Local mode has no fixed 10 GB quota and
does not automatically delete artifacts after seven days. Available disk is the
practical limit; export important projects and keep a separate backup.

| Counted in local Storage | Outside local Storage measurement |
| --- | --- |
| Project inputs, results, trajectories, and export archives that are inventoried | SQLite database, solver/runtime installs, logs, browser cache, and other disk files |

QE `disk_io` and intermediate output can consume much more space than a final
SCF result. Wavefunction and `tmp/` files may be required for bands, DOS,
phonons, projected calculations, checkpoints, or external interoperability. Do
not remove them until downstream workflows finish. Preserve the exact input,
pseudopotential identity and checksum, provenance, and state artifacts together.
Wannier90 is an external/manual workflow unless a separately documented native
integration exists; consult the [official Quantum ESPRESSO documentation](https://www.quantum-espresso.org/documentation/)
and [official Wannier90 documentation](https://wannier.org/documentation/).

Cloud storage is a separate account-backed service with its own quota, hosted
retention, and Trash rules. Cloud login does not upload local projects; Cloud
Sync is explicitly enabled per project. Cloud compute has its own transfer
preview and does not turn on project sync.

## Assemble separate launcher and platform packages

```sh
npm run package:local -- \
  --core darwin-arm64=/build/mac-arm/phynite-core \
  --standalone darwin-arm64=/build/mac-arm/standalone \
  --notices darwin-arm64=/build/mac-arm/THIRD_PARTY_NOTICES.md \
  --source-commit FULL_PUBLIC_SOURCE_COMMIT \
  --output /path/to/new-release
```

Repeat `--core`, `--standalone` and `--notices` with explicit target names for a
multi-platform assembly. Each platform gets its own native app, bundled production
Node dependencies, frozen core, AGPL license, third-party notices and checksum
manifest. Native dependency trees must be built on that platform, not copied from
another operating system. The output directory must not already exist.

Linux also requires `--bootstrap linux-x64=/path/to/reviewed/bootstrap` (or
`linux-arm64`). The directory contains `manifest.json`, the non-setuid `bwrap`
executable and any private libraries, licenses and source references. Its manifest
identifies the exact target and each tool/library checksum. The assembler hashes
the manifest in the platform release; the launcher passes its verified directory
to the native core. Real isolation probes remain mandatory. Packaged bubblewrap
cannot override disabled user namespaces or AppArmor policy, and the app never
runs sudo or disables those protections automatically.

An assembly produces:

- `phynite-lab/`: universal launcher, license, source metadata and one exact-version
  optional dependencies named `phynite-lab-runtime-<target>`.
- `phynite-lab-runtime-<target>/`: each supplied platform package, marked with npm
  `os` and `cpu`, with production dependencies declared as bundled.
- `assembly.json`: version, public source metadata and produced package inventory.

No app or scientific runtime download runs from npm lifecycle scripts. Publish all
qualified platform packages for the version before the launcher. Installing with
npm optional dependencies disabled produces an explicit missing-runtime error.

The assembler's `--source-commit` must identify a full commit in the public source
repository. Manifests record that commit, browser source URL and source archive URL;
the launcher checks that its platform package matches both version and source.
The source archive must contain the complete corresponding source and build scripts
for the published binaries. Provide the source link in the UI and package README.
The release process must verify this correspondence, third-party license notices,
native libraries and any applicable source-distribution obligations; collecting
package license strings alone does not establish compliance.

## Settings navigation

Use the category sidebar in Settings instead of a second local-runtime navigation
bar. The shared UI hosts the mode-specific controls directly:

| Page | Local application |
| --- | --- |
| `/account/appearance` | Device system/light/dark theme, accent, custom colors, density, interface/code text size, reduced motion, language |
| `/account/keyboard` | Supported shortcut bindings in this browser |
| `/account/notifications` | Job/runtime alerts and optional desktop permission |
| `/account/compute` | Scientific runtime installation, isolation status, resource defaults, optional cloud-job transfer |
| `/account/ai-providers` | Own AI provider accounts, connection status, models, reported limits/reset |
| `/account/account` | Optional Phynite Cloud login/logout and per-project sync |
| `/account/usage` | Recorded scientific-job usage and provider-reported AI usage |
| `/account/storage` | Local project archives and storage inventory |
| `/account/privacy` | Local privacy and session information |

Profile links are available only for a connected Phynite account. Billing in local
mode opens `https://phynitelab.com/billing`. Appearance and keyboard are browser
preferences, independent from cloud account settings and workspace data. Legacy
`/local` bookmarks redirect: `#ai` to AI provider accounts, `#cloud` to Account,
`#storage` to Storage, and the other setup hashes to Compute.

See [settings and preferences](settings-preferences.md) for behavior and recovery.

## Optional Cloud configuration

By default the assembler embeds only the public metadata from
`config/phynite-cloud.public.json`: exactly `apiOrigin`, `region` and `clientId`.
Use `--offline-only` to omit Cloud, or `--cloud-config PUBLIC_JSON` to select another
reviewed public configuration. These options are mutually exclusive. The assembler
never reads development `.env` files, copies the configuration file, or accepts
credentials/client secrets. The launcher discards inherited Phynite/AWS settings
and supplies only verified release metadata server-side. Login does not enable
Cloud Sync or upload a local project automatically.

## Pack, inspect and accept

Pack each output package from inside its directory. This retains npm bundled
production dependencies reliably. Inspect `npm pack --dry-run` before packing.

```sh
cd /path/to/new-release/phynite-lab-runtime-darwin-arm64
npm pack --pack-destination /path/to/tarballs
cd /path/to/new-release/phynite-lab
npm pack --pack-destination /path/to/tarballs
```

The acceptance script installs the launcher and the host platform tarball offline
into a clean prefix, with no source checkout, user credentials, global Python or
Docker. It requires an already installed Chromium and a real frozen native core;
process fixtures are rejected by executable magic. It never downloads a browser.
Set `RELEASE_VERSION` from `packages/phynite-lab/package.json` and make sure the
same version is present in every optional runtime package before packing.

```sh
node scripts/smoke-local-distribution.mjs \
  --tarball /path/to/tarballs/phynite-lab-$RELEASE_VERSION.tgz \
  --runtime-tarball /path/to/tarballs/phynite-lab-runtime-darwin-arm64-$RELEASE_VERSION.tgz \
  --output /path/to/new-evidence
```

Use `--browser-executable PATH` for a reviewed system Chromium. Browser checks cover
workspace/setup without login, structure bytes, project/workflow persistence,
archive export/import, restart, desktop/mobile and same-origin/Host boundaries.
Solver references, actual Cloud behavior, AI providers and the other OS/WSL2 targets
remain separate required gates. Never mark those tests passed from this smoke alone.

## Launcher/core contract

The launcher invokes the verified core with `--data-dir`, `--port`, `--ui-origin`.
Readiness is `{"ready":true,"environment":"local"}` from `/__local/health`.
The core writes mode-0600 `core-service.json` in the user data directory with
`token`, `origin` and `uiOrigin`; only the Node child receives the token. Never put
it in a URL, package, log, browser storage or project archive.

`PHYNITE_NATIVE_TOOLS_DIR`, `PHYNITE_RELEASE_SOURCE_COMMIT` and
`PHYNITE_RELEASE_VERSION` are set from validated release metadata, not inherited
shell settings. The core/web monitor `PHYNITE_PARENT_PID` and stop if orphaned.
All listeners bind loopback; authenticated instance control never signals a PID
from an unverified stale file. Shutdown retains user data in `~/.phynite-lab`.
Release preparation is a deliberate manual operation: assemble the exact source
commit, run the package, browser, scientific, sandbox, and license checks, inspect
the manifests, then publish the immutable packages in platform order. No push or
CI job publishes a release. Users update with `npm install -g phynite-lab@latest`.
