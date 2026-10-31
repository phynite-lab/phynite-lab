# Local application distribution

The public local application's source of truth is
https://github.com/phynite-lab/phynite-lab. Phynite-owned local code is GNU AGPL
v3 only (`AGPL-3.0-only`); third-party components keep their own licenses.
The hosted implementation remains in the separate private development repository.
The package templates are deliberately incomplete: npm prepack refuses a package
without its release manifest, corresponding-source metadata and required notices.
Commands below assemble reviewable artifacts; none publishes or deploys a service.

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

The 0.1.1 npm release targets `darwin-arm64` (macOS Apple Silicon) and `linux-x64` (glibc >=2.39, including current Omarchy/Arch Linux).
Intel Macs, Linux ARM64 and Windows/WSL2 are postponed. Portable source/build utilities
remain available but do not expand this release's supported platforms.
A target is supported only after actual native installation, isolation and
scientific reference tests pass. A cross-platform dependency solve is insufficient.

## Omarchy / Arch Linux x64

Use Node.js >=22.13 and npm from your preferred user-managed Node installation.
Install with `npm install -g phynite-lab`, then run `phynite-lab` in the normal
desktop session. Scientific runtime installation is available under Setup; choose
DFT, MD/analysis, or both. No solver, Docker, global Python or administrator
command runs during npm installation. Do not omit npm optional dependencies.

The Linux x64 package requires glibc >=2.39. It carries its own non-setuid
bubblewrap and libcap rather than depending on an Ubuntu package manager. Runtime
packages pin their full native library closure. Omarchy's Hyprland session opens
the local app through `xdg-open`; use `phynite-lab --no-open` and the printed URL
if no default browser is configured. Saved data stays in `~/.phynite-lab` across
updates.

Unprivileged user namespaces must be available in the running kernel and policy.
Setup's real write/network confinement probe determines availability; a disabled
namespace or security-policy restriction blocks manual MD and runtime setup with
its actual diagnostic. The application never disables those restrictions. Ubuntu
CI uses an exact-path, ephemeral AppArmor fixture rather than a global sysctl
change; this fixture is never installed on users' machines. Direct Omarchy desktop
testing is not part of this release's evidence; native qualification uses Ubuntu
24.04 x64.

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

No app or scientific runtime download runs from npm lifecycle scripts. Publish the qualified macOS platform package before the launcher. Installing with npm optional
dependencies disabled produces an explicit missing-runtime error.

The assembler's `--source-commit` must identify a full commit in the public source
repository. Manifests record that commit, browser source URL and source archive URL;
the launcher checks that its platform package matches both version and source.
The source archive must contain the complete corresponding source and build scripts
for the published binaries. Provide the source link in the UI and package README.
The release process must verify this correspondence, third-party license notices,
native libraries and any applicable source-distribution obligations; collecting
package license strings alone does not establish compliance.

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

```sh
node scripts/smoke-local-distribution.mjs \
  --tarball /path/to/tarballs/phynite-lab-0.1.1.tgz \
  --runtime-tarball /path/to/tarballs/phynite-lab-runtime-darwin-arm64-0.1.1.tgz \
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
Ordinary pushes validate source. An explicit versioned release builds, qualifies
and publishes; users update with `npm install -g phynite-lab@latest`.
