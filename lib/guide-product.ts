import type { GuideSection } from './guide-content.ts';

export const productGuideSections: GuideSection[] = [
  {
    id: 'npm-local-app', group: 'Install & update', title: 'Install, update, and diagnose the npm app',
    intro: 'The published npm app is the local-first path for running the workspace, native DFT, MD, and analysis on your computer. It does not require a Phynite login, Docker, a source checkout, or global Python.',
    blocks: [
      { title: 'Install and start', visuals: [{ kind: 'screenshot', src: '/docs/guide/onboarding-workspace-desktop-dark.png', alt: 'Phynite Lab local workspace on first launch', caption: 'The local workspace opens without a Cloud login.' }, { kind: 'icon', src: '/brand/phynite-mark-dark.png', alt: 'Phynite Lab mark', caption: 'The local launcher opens the workspace on your computer.' }], code: 'npm install -g phynite-lab@latest\nphynite-lab', paragraphs: [
        'The current published package is phynite-lab@{{LOCAL_NPM_VERSION}}. Node.js version {{NODE_REQUIREMENT}} is required. npm installs the launcher and the matching optional native application package for the host OS and CPU.',
        'Keep npm optional dependencies enabled. If a package manager was configured with --omit=optional or the selected platform package was removed, the launcher reports a missing runtime instead of silently using a development fixture.',
        'The launcher binds services to loopback, opens a browser, and stores the local workspace under ~/.phynite-lab. User projects and runtimes remain outside the npm installation directory.',
      ] },
      { title: 'Supported platforms', table: { headings: ['Platform', 'Package/runtime', 'Notes'], rows: [
        ['macOS Apple Silicon', 'darwin-arm64', 'Native arm64 package.'],
        ['Linux ARM64', 'linux-arm64', 'Requires glibc >=2.39 and verified user namespaces.'],
        ['Linux x64', 'linux-x64', 'Requires glibc >=2.39 (e.g. Ubuntu 24.04+, Arch Linux) and verified user namespaces.'],
        ['Windows', 'WSL2 linux-x64', 'Run npm and phynite-lab inside WSL2; a Windows-native solver is not installed.'],
      ] }, note: 'The package declares darwin/linux and arm64/x64 targets. A platform is supported only when its native runtime, isolation probe, and scientific checks pass; package availability alone is not a qualification.' },
      { title: 'Launcher commands and workspace identity', code: 'phynite-lab --no-open --port 3000 --data-dir /path/to/workspace\nphynite-lab status --data-dir /path/to/workspace\nphynite-lab doctor --data-dir /path/to/workspace\nphynite-lab stop --data-dir /path/to/workspace', paragraphs: [
        'The default command starts the service in the foreground. --no-open prints the loopback URL without opening a browser. --port requests a port; if it is already used, the launcher selects an available loopback port and reports the actual origin. --data-dir gives each workspace its own database, projects, runtimes, and logs.',
        'status reports the healthy instance for that data directory. stop asks the instance owned by that workspace to shut down cleanly. doctor checks distribution identity, service readiness, data paths, and startup diagnostics. Launching the same workspace again reuses its healthy instance instead of starting a duplicate.',
      ] },
      { title: 'Update without losing projects', code: 'npm install -g phynite-lab@latest\nphynite-lab --version', steps: [
        'Finish or cancel active jobs and stop the current instance.',
        'Run the npm update command from the same Node installation that owns the global package.',
        'Start the app again and open Settings → Compute to confirm the runtime capabilities remain available.',
        'If startup fails, run phynite-lab doctor and inspect the logs in the selected data directory; reinstalling the package does not remove ~/.phynite-lab.',
      ], paragraphs: [
        'The local app may show an update notice after checking https://registry.npmjs.org/phynite-lab/latest. A successful check is cached for up to six hours; an unavailable or invalid response is retried after about five minutes. The check sends no project data or credentials, does not install anything automatically, and never blocks local work while offline.',
      ] },
      { title: 'Common npm startup fixes', table: { headings: ['Symptom', 'Check'], rows: [
        ['Node version rejected', 'Run node --version and install a Node.js version satisfying {{NODE_REQUIREMENT}}.'],
        ['Missing runtime package', 'Reinstall with optional dependencies enabled; check the package target reported by doctor.'],
        ['Port already used', 'Use --no-open, follow the printed port, or choose --port with a free value.'],
        ['Projects are missing', 'Use the original --data-dir; each directory is an independent workspace.'],
        ['Startup service stopped', 'Run status and doctor, then read logs/<service>.log in the data directory.'],
        ['Update is unavailable', 'Continue offline, check npm/network later, and retry; the notice is informational.'],
      ] }, links: [{ label: 'Local distribution reference', href: '/guide/local-compute' }, { label: 'Troubleshooting and recovery', href: '/guide/troubleshooting' }] },
    ],
  },
  {
    id: 'ai-providers', group: 'AI providers', title: 'AI provider connections on your computer',
    intro: 'Local AI uses the provider CLI you choose. It is independent from Phynite Cloud login and does not use a hosted Phynite AI service.',
    blocks: [
      { title: 'Connect an account', visuals: [{ kind: 'screenshot', src: '/docs/guide/ai-provider-accounts-desktop-dark.png', alt: 'AI provider accounts settings page', caption: 'Provider status and login actions appear in Settings.' },
        { kind: 'icon', src: '/brand/ai/codex.png', alt: 'Codex provider icon', caption: 'Connect through the provider CLI you already use.' },
        { kind: 'icon', src: '/brand/ai/antigravity.png', alt: 'Antigravity provider icon', caption: 'Provider authentication stays with the official local CLI.' },
      ], steps: [
        'Install and authenticate the official provider CLI on this computer.',
        'Open Settings → AI provider accounts and choose Codex or Antigravity.',
        'Complete authentication through the provider’s own flow. An existing supported CLI login can be reused without importing its cookie or session files.',
        'Keep the application open while model discovery and the capability probe run. The page selects only models that pass the supported text, streaming, and tool checks.',
      ], links: [{ label: 'AI provider settings', href: '/account/ai-providers' }] },
      { title: 'Provider, model, and limits', paragraphs: [
        'The local app uses the single signed-in profile managed by the official provider CLI. A failed or rate-limited request never silently changes provider or account.',
        'Usage cards show only telemetry reported by the provider: model group, session or weekly percentage, window, and reset time when available. A missing report stays unavailable; the app never invents token counts, balances, or reset dates.',
        'Model availability can change with the provider entitlement. Cloud model settings do not control local provider accounts.',
      ] },
      { title: 'Security and unsupported states', bullets: [
        'Provider credentials stay in the provider-managed CLI or local credential store and are kept out of browser storage, logs, project archives, and Cloud Sync. The local app does not accept a gateway URL or gateway token.',
        'The local bridge runs on loopback with shell, MCP, plugin, browser, and unverified network actions disabled. Canvas changes still require the existing approval and validation flow.',
        'If authentication, discovery, streaming, or tool verification fails, the provider remains visibly disconnected or unavailable until you fix it. There is no automatic provider fallback.',
        'AI provider access is separate from scientific runtime installation and separate from Phynite Cloud login.',
      ] },
    ],
  },
  {
    id: 'cloud-sync', group: 'Phynite Cloud', title: 'Phynite Cloud, Cloud Sync, and online compute',
    intro: 'Cloud services are optional connections layered on top of a complete local workspace. Signing in does not upload a local project or replace its local identity.',
    blocks: [
      { title: 'Local, Cloud Sync, and cloud compute', visuals: [{ kind: 'screenshot', src: '/docs/guide/cloud-account-desktop-dark.png', alt: 'Phynite Cloud account settings page', caption: 'Cloud login remains separate from local compute and AI.' }, { kind: 'diagram', src: '/brand/phynite-mark-light.png', alt: 'Phynite Cloud connection mark', caption: 'Cloud services are optional connections layered over local work.' }], table: { headings: ['Choice', 'What happens'], rows: [
        ['Local only', 'Project, inputs, results, and runtime data remain on the selected computer. No Cloud login is required.'],
        ['Cloud login', 'Enables account features; local projects remain local until a project action enables sync.'],
        ['Cloud Sync', 'Enabled per project after reviewing scope, size, and quota. Syncs approved project revisions and artifacts.'],
        ['Run on cloud', 'Uploads only the reviewed job inputs/dependencies, creates a separate cloud execution, and downloads verified results. It does not enable project sync.'],
      ] } },
      { title: 'Sync lifecycle and conflicts', steps: [
        'Sign in from Settings → Account and keep the local workspace identity unchanged.',
        'Open the project sync control, review the files, size, quota, and retention shown, then enable Cloud Sync explicitly.',
        'Let the persistent outbox finish. Interrupted transfers resume with checksums; a cloud revision is published only after its snapshot artifacts are verified.',
        'If another device changed the project, compare local and cloud revisions before choosing use local, use cloud, or save as a copy.',
        'Use Trash for cloud deletion. A tombstone and retention window protect the cloud copy; disabling sync keeps local and cloud copies, and logout stops sync without deleting local data.',
      ] },
      { title: 'Account boundaries and billing', paragraphs: [
        'Sync queues and account mappings belong to the signed-in Cloud account. Switching accounts does not continue uploads created by another account.',
        'Cloud quota, artifact retention, Trash, and the hosted Free allowance are separate from local disk space. Billing and plan changes are available on the hosted website; a purchase does not start a job automatically.',
        'MD Cloud is unavailable until a supported service is shown in the current catalog. Do not infer availability from a local MD runtime.',
      ], links: [{ label: 'Cloud account settings', href: '/account/account' }, { label: 'Usage and quota', href: '/account/usage' }, { label: 'Hosted billing', href: '/billing' }] },
    ],
  },
  {
    id: 'storage-backup', group: 'Storage & backups', title: 'Storage, export, backup, and large QE state',
    intro: 'Local storage is the disk available to the selected workspace. Cloud storage is an account service with its own quota and retention policy.',
    blocks: [
      { title: 'What local Storage measures', visuals: [{ kind: 'screenshot', src: '/docs/guide/storage-archives-desktop-dark.png', alt: 'Storage and project archive settings page', caption: 'Storage inventory and archive actions are shown separately from disk capacity.' }], table: { headings: ['Counted', 'Outside the project inventory'], rows: [
        ['Inventoried structures, inputs, configurations, completed results, trajectories, and project archives.', 'SQLite metadata, installed solver/runtime files, worker logs, browser cache, and unrelated files on the disk.'],
        ['Intermediate state retained as a project artifact.', 'Operating-system free space and other applications’ data.'],
      ] }, paragraphs: ['The default data directory is ~/.phynite-lab. Use --data-dir when a larger or separate disk is appropriate. Local mode has no fixed 10 GiB quota and does not automatically delete artifacts after seven days; free disk space is the practical limit.'] },
      { title: 'QE intermediate files and wavefunctions', bullets: [
        'disk_io settings and temporary state can be much larger than the final SCF summary.',
        'Wavefunction and tmp data may be required for bands, DOS, phonons, projected workflows, checkpoints, or external interoperability.',
        'Do not remove intermediate state until every downstream workflow finishes. Keep the exact input, pseudopotential identity and checksum, provenance, and state artifacts together.',
        'Wannier90 is an external/manual workflow unless a separately documented native integration is available; follow its official handoff requirements.',
      ], links: [{ label: 'Quantum ESPRESSO documentation', href: 'https://www.quantum-espresso.org/documentation/' }, { label: 'Wannier90 documentation', href: 'https://wannier.org/documentation/' }] },
      { title: 'Export, import, and backup', steps: [
        'Export the project archive from Settings → Storage before moving a workspace or making a destructive change.',
        'Keep a second backup outside ~/.phynite-lab, including exact inputs, potential identities/checksums, provenance, and intermediate state needed by downstream work.',
        'Import into a new data directory first and verify structures, configurations, results, and checksums before replacing the working copy.',
        'Use Source package export for figures; it does not replace the project archive or solver runtime backup.',
      ], links: [{ label: 'Storage settings', href: '/account/storage' }] },
    ],
  },
  {
    id: 'settings-reference', group: 'Settings & preferences', title: 'Settings, preferences, profile, and usage',
    intro: 'Settings separates device preferences, scientific compute, AI provider accounts, Cloud account state, usage, storage, and privacy.',
    blocks: [
      { title: 'Choose the right page', visuals: [{ kind: 'screenshot', src: '/docs/guide/appearance-settings-desktop-dark.png', alt: 'Appearance settings page', caption: 'Settings are separated into focused pages for device and account controls.' }], table: { headings: ['Page', 'Purpose', 'Where it is stored'], rows: [
        ['Appearance & language', 'Theme, accent, density, text size, reduced motion, and language.', 'This browser/device.'],
        ['Keyboard shortcuts', 'Supported application bindings.', 'This browser/device.'],
        ['Notifications', 'Job/runtime alerts and desktop permission.', 'This browser/device; hosted delivery follows account state.'],
        ['Compute', 'Runtime installation, isolation probe, CPU/RAM/job defaults, and cloud transfer settings.', 'Local workspace or Cloud account, depending on control.'],
        ['AI provider accounts', 'Provider login, model readiness, limits, and reset.', 'Provider CLI/local credential store.'],
        ['Account', 'Optional Phynite Cloud login/logout and per-project sync.', 'Cloud account; local data remains local.'],
        ['Profile', 'Research identity shown after Cloud login.', 'Cloud account.'],
        ['Usage', 'Recorded scientific jobs and provider-reported AI usage.', 'Actual execution/provider records.'],
        ['Storage / Privacy', 'Project inventory, archives, session, and local data boundaries.', 'Local workspace and browser.'],
      ] } },
      { title: 'Theme, notifications, and shortcuts', paragraphs: [
        'Appearance changes apply immediately and remain device-only unless the page explicitly offers a Cloud account default. Light, dark, system, accent, density, code text size, reduced motion, and language can be customized independently.',
        'Notification preferences control local job/runtime alerts and browser permission. They do not create a Cloud session or upload project data.',
        'Keyboard changes apply only to supported application bindings in the current browser. Native browser and operating-system shortcuts may still take precedence.',
      ] },
      { title: 'Profile and login visibility', paragraphs: [
        'A local workspace without Cloud login has no user profile. Connect a Cloud account before opening Profile; logout removes the profile controls while preserving local projects and identity.',
        'AI provider login is independent from Cloud login. A provider account can be connected while Phynite Cloud remains signed out.',
      ] },
    ],
  },
];
