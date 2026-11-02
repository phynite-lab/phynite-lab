# Native npm release evidence

Release evidence is collected and reviewed manually. A push, branch name, or
repository event never publishes npm and never deploys the hosted application.
Build the exact public source commit, run the required package, browser, native,
scientific, sandbox, and license checks, then publish only the verified immutable
bundle from an official npm account.

The current release line includes macOS Apple Silicon (`darwin-arm64`), macOS Intel
(`darwin-x64`), Linux ARM64 (`linux-arm64`) and Linux x64 (`linux-x64`, glibc
>=2.39). Linux builders use Ubuntu 24.04 and its ARM64 hosted runner. Windows
WSL2 uses the Linux x64 package because it reports that platform to Node and npm;
direct testing on an Omarchy desktop or Windows host is not claimed. The release
process builds the exact public
commit, installs the launcher and matching platform tarball in a clean prefix, and requires
all browser, persistence, scientific reference and sandbox checks to pass.
`verified-release` contains the source archive, all four native tarballs and checksummed evidence.
Publish this same verified bundle using the official npm account after completing
the account's two-factor/passkey requirements. Never store an npm token in source,
logs, evidence, or release artifacts.
Native packages are published before the launcher; a partial release can resume
only when registry tarballs have identical SHA-512 integrity.

## Offline verification

```bash
node scripts/verify-local-release.mjs prepare \
  --directory build/release --version <VERSION> \
  --source-commit FULL_PUBLIC_COMMIT --source-archive source.tar.gz
node scripts/verify-local-release.mjs verify \
  --inventory build/release/release.json \
  --version <VERSION> --source-commit FULL_PUBLIC_COMMIT
node scripts/publish-local-release.mjs \
  --inventory build/release/release.json --confirm-version <VERSION>
```

Run the commands from a clean checkout or release workspace after the exact
version is committed in both package manifests. Complete `npm login` or the
official npm passkey flow on the publisher's machine, keep credentials outside
the repository, and confirm the registry package names and version before using
`--publish`.

The publisher defaults to a verified dry run. `--publish` explicitly enables
registry writes; `--provenance` adds npm provenance to the publication request.

The inventory format is `phynite-local-release-candidate`, schema version 1. It
identifies the release version, exact public source commit, SHA-256-bound
`git archive` source tarball, the launcher and all four platform runtime tarballs, and
each actual target's smoke/scientific reports. Missing platform evidence, unshipped
targets and qualification deferrals are rejected. No scientific gate is waived.

Reports identify the exact source commit, version, launcher/runtime SHA-256 and actual platform, architecture, Node version, kernel release, WSL2 status and Linux glibc version. Every referenced artifact must be a nonempty regular file within its report directory and match its checksum. Missing, failed, mutated, mismatched or unsupported evidence blocks publication. Tests using synthetic evidence exercise these rules; synthetic test fixtures never qualify a release.

Smoke reports must cover clean installation, the native core, loopback security, a local workspace without login, desktop/mobile UI, persistence after restart, project import/export, the local AI gateway and optional Cloud without automatic upload. These checks do not claim a live provider login or scientific result.

Native application assembly retains every built server route and lazy chunk, while reducing Vinext to its reviewed production-server import graph. `runtime-closure.json` records the exact modules, hashes, dependency names and the two reviewed dynamic loaders. Unknown imports, a changed Vinext version or incomplete server externals fail assembly. Imported runtime packages retain their complete declared dependency graph and original license notices; unused image and Open Graph development engines are omitted. Local production images are served without the optional image optimizer.

Every new core must have `THIRD_PARTY_NATIVE.json` beside its actual notices. Assembly verifies the core SHA-256, full notice SHA-256, native member checksums and their installed providers. Both original files are retained under the platform's `core/` directory and the inventory is checksummed in the outer manifest. Publication streams the packaged executable again and checks source-backed native dependencies against the exact corresponding-source archive, including original archives and rebuild scripts. A license identifier or a successful inventory parse does not qualify a platform or prove its scientific results.

The local Vite build also records actual rendered dependency modules in `phynite-bundled-notices.json` for each client, RSC and SSR environment. Tree-shaken modules are excluded. Each retained package records its version, original source hashes, actual installed license/notice files, original legal comments and any reviewed upstream supplements. Missing full notices stop the production build. Reviewed KaTeX font notices bind the actual font bytes as well as the original copyright, reserved names and OFL text. The sole local attachment image preview uses its native blob image element, keeping CDN transformation packages out of the local build.

Assembly verifies every emitted chunk/asset checksum, merges the original text into `THIRD_PARTY_NOTICES.md`, and writes a checksummed `bundled-notices.json` index. The installed launcher and publication gate require those report and output bindings. Discovery-only incomplete reports cannot be packaged. Preserve `distribution/notices/web` and the build plugin when exporting source; changing a dependency version requires reviewed matching source notices.

The launcher uses the macOS system opener, a Linux desktop opener, or Windows browser interop when the actual Linux kernel identifies WSL2. A missing opener or nonzero exit falls back to another supported opener and ultimately prints the local address. WSL2 consumes the Linux x64 package; direct WSL2 acceptance is a follow-up environment check rather than a separate npm package.

Scientific reports require runtime installation, a QE job submitted through the actual application queue/worker/artifact protocol, direct QE/Guided MD/manual MD/analysis reference runs, the sandbox probe and denials, cancel/resource/recovery and installation failure recovery. Each reference includes a successful process return code, exact input and output artifacts, provenance matching their hashes, and finite measured/expected values within an explicit tolerance. Reference contracts and licensed scientific fixtures are supplied separately by the producer; prohibited potential files are never bundled merely to satisfy a test.

Raw acceptance directories contain local test state and must remain private. Use
`verify-local-release.mjs collect --report RAW/report.json --output NEW_PUBLIC_DIR`
to retain only explicit checksummed screenshots, logs and scientific attachments.
The collector rejects identity/credential files and test databases. A release
archive contains those collected files, never a raw test data directory.

Every native executable must still pass the real acceptance producer on its target. A successful report parser, packaging test or build alone does not establish solver or sandbox qualification. No platform is supported for publication until its real gate passes.

## Registry acceptance after publication

After publishing, manually verify `npm view` for the launcher and every optional
runtime package, then install the exact version into a fresh prefix with a Node-only
PATH. Check native startup, `status`, `stop`, project creation, restart persistence,
loopback binding, and the installed launcher/runtime checksums on every target that
is advertised. Keep only sanitized reports and never upload a temporary database,
session, credential, or private process log. Stop when npm authentication,
propagation, integrity, or platform behavior differs from the reviewed bundle.
