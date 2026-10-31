# Native npm release evidence

A push runs source CI. A `release/**` branch push also builds and qualifies a native candidate without publishing. Publication is an explicit `Local native release` workflow dispatch against the public repository, with a version already committed in both package manifests. The release scripts never deploy the hosted application.

The `0.1.0` release includes only macOS Apple Silicon (`darwin-arm64`). Intel,
Linux and WSL2 packages are postponed. The native workflow builds the exact public
commit, installs the two resulting npm tarballs in a clean prefix, and requires
all browser, persistence, scientific reference and sandbox checks to pass.
`verified-release` contains the source archive, tarballs and checksummed evidence.
Normal pushes never publish. A maintainer can publish this same verified bundle
using the official npm account or an explicitly configured trusted publisher.
Native packages are published before the launcher; a partial release can resume
only when registry tarballs have identical SHA-512 integrity.

## Offline verification

```bash
node scripts/verify-local-release.mjs prepare \
  --directory build/release --version 0.1.0 \
  --source-commit FULL_PUBLIC_COMMIT --source-archive source.tar.gz
node scripts/verify-local-release.mjs verify \
  --inventory build/release/release.json \
  --version 0.1.0 --source-commit FULL_PUBLIC_COMMIT
node scripts/publish-local-release.mjs \
  --inventory build/release/release.json --confirm-version 0.1.0
```

For a first publication, npm must already know each package before its settings can be configured with a trusted publisher. After all required gates pass, download the complete verified bundle and use the maintainer's official `npm login` session with the publisher locally. Then configure trusted publishing for both package names, the public repository and `local-release.yml`; later releases can use the workflow's OIDC identity. Do not create unqualified placeholder versions merely to configure npm. A two-factor authentication or publisher setup requirement remains an explicit account step; never embed a token in source or artifacts.

The publisher defaults to a verified dry run. `--publish` explicitly enables registry writes; `--provenance` additionally enables npm provenance in the trusted GitHub workflow.

The inventory format is `phynite-local-release-candidate`, schema version 1. It
identifies the release version, exact public source commit, SHA-256-bound
`git archive` source tarball, the launcher and macOS ARM64 runtime tarballs, and
the actual target's smoke/scientific reports. Missing macOS evidence, unshipped
targets and qualification deferrals are rejected. No scientific gate is waived.

Reports identify the exact source commit, version, launcher/runtime SHA-256 and actual platform, architecture, Node version, kernel release, WSL2 status and Linux glibc version. Every referenced artifact must be a nonempty regular file within its report directory and match its checksum. Missing, failed, mutated, mismatched or unsupported evidence blocks publication. Tests using synthetic evidence exercise these rules; synthetic test fixtures never qualify a release.

Smoke reports must cover clean installation, the native core, loopback security, a local workspace without login, desktop/mobile UI, persistence after restart, project import/export, the local AI gateway and optional Cloud without automatic upload. These checks do not claim a live provider login or scientific result.

Native application assembly retains every built server route and lazy chunk, while reducing Vinext to its reviewed production-server import graph. `runtime-closure.json` records the exact modules, hashes, dependency names and the two reviewed dynamic loaders. Unknown imports, a changed Vinext version or incomplete server externals fail assembly. Imported runtime packages retain their complete declared dependency graph and original license notices; unused image and Open Graph development engines are omitted. Local production images are served without the optional image optimizer.

Every new core must have `THIRD_PARTY_NATIVE.json` beside its actual notices. Assembly verifies the core SHA-256, full notice SHA-256, native member checksums and their installed providers. Both original files are retained under the platform's `core/` directory and the inventory is checksummed in the outer manifest. Publication streams the packaged executable again and checks source-backed native dependencies against the exact corresponding-source archive, including original archives and rebuild scripts. A license identifier or a successful inventory parse does not qualify a platform or prove its scientific results.

The local Vite build also records actual rendered dependency modules in `phynite-bundled-notices.json` for each client, RSC and SSR environment. Tree-shaken modules are excluded. Each retained package records its version, original source hashes, actual installed license/notice files, original legal comments and any reviewed upstream supplements. Missing full notices stop the production build. Reviewed KaTeX font notices bind the actual font bytes as well as the original copyright, reserved names and OFL text. The sole local attachment image preview uses its native blob image element, keeping CDN transformation packages out of the local build.

Assembly verifies every emitted chunk/asset checksum, merges the original text into `THIRD_PARTY_NOTICES.md`, and writes a checksummed `bundled-notices.json` index. The installed launcher and publication gate require those report and output bindings. Discovery-only incomplete reports cannot be packaged. Preserve `distribution/notices/web` and the build plugin when exporting source; changing a dependency version requires reviewed matching source notices.

The launcher uses the macOS system opener, a Linux desktop opener, or Windows browser interop when the actual Linux kernel identifies WSL2. A missing opener or nonzero exit falls back to another supported opener and ultimately prints the local address. WSL2 browser behavior still requires the native WSL2 acceptance run.

Scientific reports require runtime installation, a QE job submitted through the actual application queue/worker/artifact protocol, direct QE/Guided MD/manual MD/analysis reference runs, the sandbox probe and denials, cancel/resource/recovery and installation failure recovery. Each reference includes a successful process return code, exact input and output artifacts, provenance matching their hashes, and finite measured/expected values within an explicit tolerance. Reference contracts and licensed scientific fixtures are supplied separately by the producer; prohibited potential files are never bundled merely to satisfy a test.

Raw acceptance directories contain local test state and must remain private. Use `verify-local-release.mjs collect --report RAW/report.json --output NEW_PUBLIC_DIR` to retain only explicit checksummed screenshots, logs and scientific attachments. The collector rejects identity/credential files and test databases. GitHub release evidence contains those collected files, never a raw test data directory.

Every native executable must still pass the real acceptance producer on its target. A successful report parser, packaging test or build alone does not establish solver or sandbox qualification. No platform is supported for publication until its real gate passes.
