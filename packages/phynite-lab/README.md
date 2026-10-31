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

Requires Node.js 22.13 or later and macOS Apple Silicon (M1 or later).
The 0.1.0 npm release does not include Intel Macs, Linux or Windows.
npm selects the exact-version `phynite-lab-runtime-darwin-arm64`
optional package containing the production app and frozen local core; it does not require
a global Python installation, AWS CLI, or Docker. Scientific solver runtimes are
installed separately from the application's setup page.

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

The first solver installation downloads the chosen runtime from the setup page.

Cloud and AI connections are optional and configured inside the application.
Local AI uses the official Codex or Antigravity CLI already installed on this
computer. Open **Settings → AI provider accounts** and sign in; models connect and
verify automatically. An existing CLI sign-in can be reused. Phynite never reads or copies CLI session files or
provider tokens. The bridge runs on loopback with shell, MCP, plugin, browser,
and network tools disabled; a model is unavailable until its text, streaming,
and host-validated tool-proposal probe succeeds. A loopback OpenAI-compatible
gateway such as 9Router can also be configured as an optional local connector.
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
