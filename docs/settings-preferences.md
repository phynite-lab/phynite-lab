# Settings and preferences

Settings separates device choices, scientific resources, AI accounts, and the
optional Phynite Cloud account. Use the category sidebar or search for a setting. The workspace Home/Cloud icon rail is hidden here; Back to workspace returns to the app.
On smaller screens open the Settings navigation drawer; Escape or its close
control dismisses it. Returning to a project preserves the workspace layout.

## Find the right page

| Page | Purpose | Stored with |
| --- | --- | --- |
| Appearance & language | System/light/dark mode, theme presets, accent, custom colors, per-mode fonts/colors, contrast, diff markers, density, motion, language | This browser |
| Keyboard shortcuts | Customize supported application shortcuts; restore defaults | This browser |
| Notifications | Job/runtime alerts and optional desktop notifications in local mode; hosted notification choices on the website | Browser in local mode; account for hosted delivery settings |
| Compute | Native runtime installation, isolation availability, local CPU/RAM/concurrency; hosted worker/default controls on the website | Local workspace or signed-in hosted account |
| AI provider accounts | Own provider logins, account switching, model readiness, reported limits/reset | Provider CLI or server-side local credential store |
| Account | Optional Phynite Cloud connection and project sync | Local connection associated with the signed-in cloud account |
| Usage | Recorded job time/resources and available provider-reported AI limits | Actual execution/provider records |
| Storage | Measured local artifacts and project archives in local mode; measured cloud inventory on the website | Local workspace or cloud account, clearly labeled |
| Research profile | Phynite display identity and photo | Connected Phynite account |
| Privacy & session | Privacy choices and current connection/session | Mode-specific, labeled on the page |

Account follows AI provider accounts in the sidebar. A research profile is offered
only when a Phynite account is connected. The profile page is separate from the
profile editor. An unsigned local workspace has a stable local identity and
connection/settings actions; it does not pretend to be a signed-in user.

Local Billing opens [the Phynite website](https://phynitelab.com/billing), where
cloud purchases and invoices are managed. Installing the local application does
not create a paid subscription or start a billable job.

## Appearance and language

Choose System, Light, or Dark using the mode previews. System follows the operating-system color scheme. The Theme menu offers Phynite, Paper, Slate, and Custom. Background and Foreground are always available; an unreadable draft remains unapplied until both colors reach 4.5:1 text contrast. This lets you change a light pair to a dark pair without getting stuck between choices.

Advanced includes numeric UI/code font sizes, System/On/Off interface motion, separate light/dark appearance, interface contrast, AI approval diff markers, density, and language. Separate modes remembers independent themes, colors, contrast, and font sizes; turning it off shares the current mode's appearance. Contrast changes interface text/borders, never scientific figures, trajectories, or numerical values. Diff markers change the real before/after AI approval table without changing its exact input values. Download theme saves a device-preference JSON document; Copy theme copies the same settings without account credentials or research data.
Accent, comfortable/compact density, interface font size, code font size, and
reduced motion apply immediately. Restore defaults resets device controls. These
choices affect interface presentation, not structure units, plot samples,
publication figure dimensions, or executed solver settings.

Language supports English and Bahasa Indonesia, with automatic browser detection.
Scientific keywords, chemical symbols, and user-provided publication text keep
their original meaning and syntax. Documentation keeps the current topic when
switching language.

Preferences are local to the browser profile and site origin. Another computer,
another browser, or a different localhost port may have different choices.
Signing in or out of Phynite Cloud does not turn appearance into an account
preference. Clearing site data resets these choices; it does not remove the
native workspace stored in `~/.phynite-lab`. If browser storage is unavailable,
changes remain usable for the current visit but may not survive reopening.

## Keyboard shortcuts

The Keyboard page lists the actions that can actually be rebound. Select a
binding and type the supported key combination, disable it when offered, or
restore defaults. The current bindings apply immediately and stay in this
browser. Primary/Mod means Command on macOS and Control on Linux/Windows.

The configurable actions are opening Settings, toggling the workspace sidebar,
focusing an open AI chat, and sending an AI message. Editor-specific geometry,
figure, text-editing, and accessibility keys retain their documented contexts.
Typing in an input must not unexpectedly delete an atom or invoke a workspace
action. AI message submission supports its listed Enter combinations; multiline
text entry follows the active binding. The page rejects unsupported or conflicting
bindings rather than saving a shortcut that cannot work.

## Notifications

The local Notifications page independently enables completed jobs, failed or
cancelled jobs, and completed/failed scientific-runtime installations. These
alerts observe actual state changes while Phynite Lab is open; existing final
jobs are not new completions. In-app updates do not require desktop permission.

Desktop notifications are optional and require browser permission. Enable the
option to request permission, then use Send test notification to check delivery.
If permission is denied, change this site's browser permission before enabling it
again. Background desktop delivery depends on browser and operating-system
support. Closing the app does not schedule a cloud push or email. Hosted email
and inbox choices remain separate from local desktop alerts.

## Compute on this computer

In the npm application, open Settings → Compute. Inspect detected OS/architecture,
CPU and physical RAM, installed runtimes, and isolation status. Install DFT,
MD/analysis, or both through the web controls. Downloads use pinned manifests and
checksums with staging before activation; an interrupted or invalid update must
not replace a working runtime. Potential libraries remain subject to their own
licenses and input requirements.

Set CPU, RAM budget, and parallel jobs for future jobs. The default is one job,
about half the logical cores, and at most half the physical RAM. Each job may
request an explicit allocation within scheduler capacity. Allocated resources
are different from measured utilization; more cores do not guarantee a faster
solver. Where the platform uses memory monitoring, the RAM budget is a monitored
limit rather than an OS-enforced hard limit. Changing defaults does not resize
jobs already running.

Keep the CLI running and the computer awake. Follow the actual queued/running/
final state and first solver error in the job log. Cancel stops the owned job;
after a restart, interrupted jobs require review instead of automatically rerunning.
Manual LAMMPS input additionally requires a successful native isolation probe;
missing sandbox support blocks manual execution and shows the remediation.
Never lower scientific settings merely to hide a runtime or resource failure.

The hosted website uses a different personal-worker connection. Its download,
Connection code, and Docker pairing instructions are preserved in the
[personal-compute guide](https://phynitelab.com/guide/local-compute). Native npm jobs do not require that
pairing, Docker, a global Python installation, or a Phynite Cloud account.

## AI provider accounts

Open Settings → AI provider accounts. Connect the supported provider CLI or use an already configured local gateway with your own account. Complete provider authentication through
its official flow. Phynite Cloud login is independent and does not unlock an AI
subscription. Phynite does not import another application's cookies or session
files. Supported account controls show connection status; the obsolete gateway setup and unavailable-connector list are removed.

After login, the application discovers the provider's actual models and checks
supported capabilities. Choose an available model in the chat composer. Tools and
attachments require verified capabilities, and project-changing actions preserve
Canvas validation and approval rules. Model availability is not a fixed list and
can change with the active provider account. The app does not silently change
providers when a request fails.

Use the account switch control to choose among saved accounts. A rate-limited
account does not justify sending a request to another account without the user's
selection. Connection status and reported usage/reset windows stay visible in
provider settings and available usage views. If a provider reports only a
percentage or window, Phynite displays that measurement; it does not invent a
remaining token count, reset date, subscription limit, or successful login.
Credentials stay with the provider CLI or server-side local store, outside
browser storage, logs, project archives, and Cloud Sync.

See [local AI connections](local-ai.md) for provider-account behavior.

## Account, sync, usage, and storage

Account manages optional Phynite Cloud sign-in/out. Signing in preserves the local
workspace identity and does not upload a project. Enabling Cloud Sync is an
explicit per-project action with an upload-scope/size preview. Cloud compute is a
separate action with its own input-transfer review; it does not enable project
sync. Availability still depends on the service catalog, account, quota, and
billing. MD cloud execution remains unavailable until its service is supported.

Usage reads actual job history: recorded elapsed time, allocation, destination,
and charges where present. Allocated CPU-hours are duration times allocated
cores, not hardware utilization. Missing historical data is unavailable or
partial, never a zero reading. Provider AI limits are provider-reported and are
separate from scientific compute and Phynite cloud billing.

Storage shows the measured local artifact inventory and provides project archive export/import. The measurement excludes database metadata, solver installations, logs, and unrelated disk files; it is not a cloud quota or a measure of free disk space. Archives carry the
available project inputs, configuration, results, provenance, and checksums;
restricted potential assets retain license rules. Keep independent backups of
important projects. A browser draft is a recovery aid, not the native database.
Cloud logout stops sync and keeps local files. Account changes must not resume
another account's pending uploads. Review conflicts explicitly instead of
silently overwriting a local or cloud revision.

| Storage question | Local application | Cloud service |
| --- | --- | --- |
| Where data lives | `~/.phynite-lab` (or `--data-dir`), SQLite plus filesystem | Account-backed cloud project and artifact storage |
| What the Storage page measures | Inventoried project artifacts and archives | Cloud inventory and account quota |
| What is outside that measurement | Database metadata, solver/runtime installs, logs, browser cache, and other disk files | Provider-side service data and any unlisted account usage |
| Automatic cleanup | None for local artifacts; disk space is the practical limit | Hosted retention, tombstones, and Trash rules shown by the cloud service |

Local mode therefore has no fixed 10 GB allowance and no seven-day artifact
cleanup. QE `disk_io`, wavefunctions, and `tmp/` state can require many times
the size of a final output for bands, DOS, phonons, projected workflows, or
external interoperability. Keep intermediate state until downstream workflows
finish; retain the exact input, pseudopotential identity/checksum, provenance,
and state artifacts. Wannier90 is an external/manual workflow unless a native
integration is explicitly documented; see [Quantum ESPRESSO](https://www.quantum-espresso.org/documentation/)
and [Wannier90](https://wannier.org/documentation/). Export important projects
and keep an independent backup before cleanup or migration.

## Old bookmarks and troubleshooting

`/local#ai` opens AI provider accounts, `/local#cloud` opens Account,
`/local#storage` opens Storage, and other `/local` setup links open Compute.
The category sidebar is the single settings navigation.

If a control seems missing, confirm the app mode and current page. Native setup
belongs to the local npm app; hosted worker pairing belongs to the website. Use
`phynite-lab doctor` for installation checks, inspect the exact runtime/job error,
and keep the failed log. Empty provider telemetry means unavailable information;
it does not prove the account has no allowance. For notification failures, check
site permission and keep the app open. For a theme that resets, verify browser
storage and whether the URL's origin changed.
