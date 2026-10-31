# Native npm release evidence

A push runs source CI. A `release/**` branch push also builds and qualifies a native candidate without publishing. Publication is an explicit `Local native release` workflow dispatch against the public repository, with a version already committed in both package manifests. The release scripts never deploy the hosted application.

The first dispatch uses `publish=false` and no evidence run ID. Four native runners build the exact public commit and run the clean-install/browser/scientific acceptance scripts. The resulting `candidate-awaiting-wsl2` artifact contains the tarballs that must be tested on WSL2; rebuilding them creates a different candidate.

`Local WSL2 qualification` requires two explicitly provisioned, ephemeral maintainer runners with the `phynite-wsl2-ephemeral` label, Linux and their X64/ARM64 architecture labels. It only runs after manual dispatch, verifies the actual `/proc/sys/kernel/osrelease` Microsoft WSL2 marker and glibc baseline, and tests the original tarballs. Registering runners and configuring npm trusted publishing are account setup tasks; the WSL workflow does not change machine security policy or repository settings automatically.

The ephemeral GitHub-hosted Ubuntu native runners explicitly load an AppArmor `userns` fixture for exactly three test bubblewrap paths: the build output and the two clean npm installations. They retain Ubuntu's global namespace restrictions, run application/scientific probes as the unprivileged runner user, and remove those profiles after the job. This CI fixture is not shipped or applied to end-user or self-hosted WSL machines. Native Linux evidence qualifies a host that permits those namespaces; an administrator may need to authorize them on a restricted Ubuntu host. The installed application's real sandbox probe remains mandatory and fails closed if that host permission is absent.

When WSL2 is included and that workflow succeeds, dispatch `Local native release` with its run ID. The final release downloads the complete original candidate bundle, verifies all six targets again and publishes only when `publish=true`. A dry run can verify the bundle without publication. Native packages are published before the launcher; a partial release can be resumed only when existing registry packages have identical SHA-512 integrity.

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

For a first publication, npm must already know each package before its settings can be configured with a trusted publisher. After all required gates pass, download the complete verified bundle and use the maintainer's official `npm login` session with the publisher locally. Then configure trusted publishing for all five package names, the public repository and `local-release.yml`; later releases can use the workflow's OIDC identity. Do not create unqualified placeholder versions merely to configure npm. A two-factor authentication or publisher setup requirement remains an explicit account step; never embed a token in source or artifacts.

The publisher defaults to a verified dry run. `--publish` explicitly enables registry writes; `--provenance` additionally enables npm provenance in the trusted GitHub workflow.

The inventory format is `phynite-local-release-candidate`, schema version 1. It identifies the release version and exact public source commit, a SHA-256-bound `git archive` source tarball, all five npm tarballs and each target's smoke/scientific report. The mandatory native targets are `darwin-arm64`, `darwin-x64`, `linux-arm64` and `linux-x64`. By default `wsl2-linux-x64` and `wsl2-linux-arm64` are also required. A maintainer may explicitly defer WSL2 using the release workflow's `wsl2_deferral_reason` or `prepare --defer-wsl2-reason REASON`. This records `qualification: {wsl2: "deferred", reason: "..."}` in the inventory and requires exactly the four native reports. It never turns missing WSL2 evidence into a passing result. Release notes must state WSL2 is untested; no native gate may be deferred this way. The initial 0.1.0 release follows this policy at the project owner's request because WSL2 hosts are not yet accessible.

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
