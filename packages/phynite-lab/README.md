# Phynite Lab

A local computational materials-science workspace, released under GNU AGPL v3
only (`AGPL-3.0-only`). Source and build instructions are available at
https://github.com/phynite-lab/phynite-lab. Commercial use is permitted under the
license. Users interacting with a modified version over a network must be offered
its corresponding source, as required by AGPL section 13.

```sh
npm install -g phynite-lab
phynite-lab
```

Requires Node.js 22.13 or later. Each published version ships matching native
packages for macOS
Apple Silicon (`darwin-arm64`), Linux ARM64
(`linux-arm64`) and Linux x64 (`linux-x64`, glibc >=2.39), including current
Omarchy/Arch Linux. Windows is supported through WSL2, which uses the Linux x64
package and launcher. Linux qualification runs on matching release builders;
direct testing on an arbitrary Omarchy desktop or Windows host is not claimed;
consult the release evidence for the targets exercised for the installed version.
npm selects the exact-version native platform optional package containing
the production app, frozen local core and Linux sandbox; it does not require
a global Python installation, AWS CLI, or Docker. Scientific solver runtimes are
installed separately from the application's setup page.

On Omarchy, run the launcher as your normal desktop user. Its bundled bubblewrap
needs unprivileged user namespaces; Setup verifies actual filesystem/network
isolation before enabling scientific execution. A blocked probe displays the
repair needed instead of weakening OS policy. Browser opening uses `xdg-open`;
`--no-open` also prints the local URL for manual opening.

The application binds to `127.0.0.1`, opens a browser, and keeps user data in
`~/.phynite-lab`. A busy default port is replaced with an available local port.
Press Ctrl+C to stop the application without removing saved data.

```sh
phynite-lab --no-open --port 3000 --data-dir /path/to/workspace
phynite-lab status
phynite-lab stop
phynite-lab doctor
```

Use the same `--data-dir` for status, stop, and doctor when using a custom location.
Repeating the launch command opens the existing instance for that data directory.
No installer runs during npm installation. Keep npm optional dependencies enabled.
Incomplete or mismatched distributions fail with an actionable error rather than
falling back to development fixtures. `distribution.json` identifies the exact
public source commit and source archive for each installed release. The application
also provides a source link. Updated packages do not remove saved data:

```sh
npm install -g phynite-lab@latest
```

The launcher checks `https://registry.npmjs.org/phynite-lab/latest` without
credentials. Successful metadata is cached for up to six hours and an unavailable
registry response for five minutes. The update notice is informational only and
never runs npm for you. Offline use remains available; stop the current instance,
run the update command, and start it again. To verify the published metadata from
a terminal, run `npm view phynite-lab version` and inspect the installed launcher
with `phynite-lab --version`.

The first solver installation downloads the chosen runtime from the setup page.

Complete English and Indonesian user documentation is available at
https://phynitelab.com/guide, including the npm install/update path, local AI
provider accounts, Cloud Sync, storage and QE intermediate-state guidance,
Settings, and troubleshooting. The guide links to the matching source and
downloadable Markdown copies.

Use the visual task paths in the guide to move from first launch to a verified
QE or MD run. Screenshots use a clean demo workspace and are reused in the
English and Indonesian guides with translated captions.

First run checklist: open **Settings → Compute**, verify the platform, solver
capability, and isolation probe, install DFT or MD/analysis, install the required
pseudopotentials (or provide exact UPF inputs), choose **Your computer** in the
run review, and run a small reference calculation. Inspect the actual queued,
running, and final state, the first solver error, execution log, provenance,
checksums, and numerical output. A preflight failure occurs before the solver
starts and therefore has no solver output; a runtime failure has a solver log
and any artifacts that were retained.

The default workspace is `~/.phynite-lab`; pass `--data-dir` to use another
location. SQLite is the metadata store and the filesystem holds project
artifacts, runtime installations, and logs. The local Storage page measures only
inventoried project artifacts. It excludes SQLite metadata, installed solvers,
logs, and unrelated files, and local mode has no fixed 10 GB quota or automatic
seven-day cleanup. Available disk is the practical limit, so export important
projects and keep a separate backup.

QE intermediate state can dwarf the final output. `disk_io`, wavefunctions, and
`tmp/` files may be needed for bands, DOS, phonons, projected workflows, or
external interoperability. Keep them until downstream workflows finish and
retain the exact input, pseudopotential identity/checksum, provenance, and state
artifacts. Wannier90 remains an external/manual workflow unless an explicit
integration is documented: [QE documentation](https://www.quantum-espresso.org/documentation/),
[Wannier90 documentation](https://wannier.org/documentation/).

Cloud storage is separate from this disk-backed workspace. Cloud accounts have
their own quota, retention, and Trash behavior; signing in does not upload local
projects, and Cloud Sync is enabled per project. Cloud compute uses a separate
input-transfer review.

Cloud and AI connections are optional and configured inside the application.
Local AI uses the official Codex or Antigravity CLI already installed on this
computer. Open **Settings → AI provider accounts** and sign in; models connect and
verify automatically. An existing CLI sign-in can be reused. Phynite never reads or copies CLI session files or
provider tokens. The bridge runs on loopback with shell, MCP, plugin, browser,
and network tools disabled; a model is unavailable until its text, streaming,
and host-validated tool-proposal probe succeeds. A loopback OpenAI-compatible
Antigravity uses a restricted profile, explicit permission denials and a native
tool denial hook. A synthetic startup turn verifies the loaded guard before any
project context is sent. Unsupported guard or protocol versions fail closed.
Hosted Phynite AI is not used by the local application. Cloud sign-in requires a
release assembled with public cloud connection metadata; an unconfigured release
remains available for local work. Signing in does not enable Cloud Sync for a
project. The launcher ignores inherited cloud settings.
Provider usage refreshes automatically while the settings page is visible. Codex
reports session and weekly percentages through its app-server; Antigravity 1.4.11
reports model-group limits through the read-only `/usage` command. Each window
shows the provider's reset time and a countdown. These percentages are subscription
limits, not token counts. Failed refreshes retain the last report with its timestamp;
unsupported or missing reports are shown as unavailable.
Third-party components retain their own licenses; see THIRD_PARTY_NOTICES.md in
the assembled release.
