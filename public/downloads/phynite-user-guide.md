# Phynite Lab User Guide

This guide describes the implemented interface. Use it alongside solver documentation and convergence studies. Images use public documentation assets; an internet connection is needed to load them in this Markdown file.

- [Start here: from installation to your first local result](#getting-started)
- [From structure to a paper figure](#workflow)
- [Install, update, and diagnose the npm app](#npm-local-app)
- [Local npm compute and hosted workers](#local-compute)
- [Projects, structures, and calculation records](#project)
- [Import and inspect a structure](#structure)
- [Edit atoms and cell geometry](#edit)
- [Periodic directions, vacuum, and dimensionality](#periodicity)
- [Procedure: prepare a two-dimensional slab](#slab-workflow)
- [Tutorial: a first silicon calculation](#quickstart-silicon)
- [Choose and connect calculations](#calculation)
- [Configure and validate Quantum ESPRESSO](#configure)
- [Procedure: design a convergence study](#convergence)
- [Execution, resources, and cancellation](#execution)
- [Tutorial: a first local MD simulation](#quickstart-md)
- [MD workflows: Simple, Advanced, and trajectory analysis](#md-workflows)
- [AI provider connections on your computer](#ai-providers)
- [Phynite Cloud, Cloud Sync, and online compute](#cloud-sync)
- [Settings, accounts, profile, and usage](#account)
- [Autosave, storage, and multiple devices](#saving)
- [Manage plans, billing, and resource usage](#billing)
- [Storage, export, backup, and large QE state](#storage-backup)
- [Settings, preferences, profile, and usage](#settings-reference)
- [Appearance, language, and accessibility](#language)
- [Open and interpret calculation results](#results)
- [Run history, research context, and evidence](#research-history)
- [Compose a figure](#figures)
- [Energy, k-path, DOS, and fair comparison](#alignment)
- [Workflows for material and parameter studies](#studies)
- [Templates, replacement, history, and archives](#reuse)
- [PDOS, unfolding, and insets](#advanced)
- [Export and preserve a reproducible figure](#export)
- [Procedure: prepare a publication figure](#publication)
- [Troubleshooting and recovery](#troubleshooting)
- [Local troubleshooting and recovery](#local-troubleshooting)
- [Troubleshooting: locate a failed workflow stage](#diagnostics)
- [Tool and icon reference](#tools-reference)
- [Keyboard and pointer shortcuts](#shortcuts)
- [Reference: calculation fields and units](#field-reference)
- [Availability and planned workflows](#roadmap)
- [Units, terms, and scientific references](#reference)

<a id="getting-started"></a>

## Start here: from installation to your first local result

Follow this checklist once before starting a large study. It separates the application, scientific runtimes, physical inputs, execution, and saved evidence so a missing prerequisite is easy to identify.

<a id="docs-getting-started-1"></a>

### 1. Install the application

Use Node.js >=22.13.0 and a currently supported native package. macOS Apple Silicon and Linux ARM64/x64 are available; Linux requires glibc >=2.39. On Windows, use the Linux x64 environment inside WSL2. Read the release evidence for actual platform testing.

Keep optional npm dependencies enabled. npm installs the app and matching native core; DFT and MD scientific solvers are installed in the next step. Docker, a global Python installation, a source checkout, and a Phynite login are not required for the published local app.

```text
node --version
npm install -g phynite-lab@latest
phynite-lab
```

> Keep this terminal running. The browser is the interface; the launcher owns the local services. Follow the actual loopback URL printed by the launcher when port 3000 is occupied.

- [Current npm package metadata](<https://www.npmjs.com/package/phynite-lab>)
- [Published release source and evidence](<https://github.com/phynite-lab/phynite-lab/releases>)

<a id="docs-getting-started-2"></a>

### 2. Recognize the workspace

![Anonymous local workspace](<https://phynitelab.com/docs/guide/onboarding-workspace-desktop-light.png>)

Real local demo workspace. Start with New project; Cloud login is optional.

1. Open Workspace and choose New project. Name the study by the question or material, such as Silicon ground state.
2. Open the project. Canvas connects scientific modules; opening a module shows its editor. Keep one coherent study in a project and name material variants clearly.
3. Use Settings to configure this computer. A missing profile in an unsigned local workspace is expected; AI provider login and Phynite Cloud login are separate optional connections.

- [Learn the tools and icons](<#tools-reference>)
- [Projects and calculation records](<#project>)

<a id="docs-getting-started-3"></a>

### 3. Prepare this computer for science

![Scientific runtime setup in Settings](<https://phynitelab.com/docs/guide/compute-runtime-setup-desktop-light.png>)

The current computer reports its own installed runtimes and isolation state. Your values may differ.

1. Open Settings → Compute. Confirm the detected operating system and architecture, available CPU/RAM, and the selected workspace location.
2. Install DFT for Quantum ESPRESSO, MD/analysis for LAMMPS and native analysis, or both. Wait for the actual installation status and capability checks; a download finishing alone does not prove the solver is ready.
3. Verify the isolation probe. If it is blocked, read the operating-system diagnostic and repair that prerequisite. Do not disable confinement or use an unverified runtime to bypass the message.
4. For DFT, install the explicitly selected SSSP Precision or Efficiency library in DFT pseudopotentials, or provide the exact UPF files required by the input. For MD, select a compatible force field and verify element mapping, license, and model source.
5. Set a modest CPU/RAM allocation and parallel-job count for the first exercise. Leave room for the operating system and temporary files. More cores do not guarantee faster execution.

> Runtimes belong to the selected --data-dir. Installing them in ~/.phynite-lab-dev does not install them in ~/.phynite-lab. Reopen the correct workspace instead of copying a native environment between paths.

<a id="docs-getting-started-4"></a>

### 4. Run one small, reviewable calculation

1. Import a known small structure, inspect species, atom count, cell vectors, coordinates, and units, and retain its original file. Use the silicon tutorial for DFT or the argon tutorial for MD.
2. Add the required module and connect its source. For a first DFT exercise, use SCF / Total energy; for MD, review one short Simple stage before adding a larger chain.
3. Inspect the exact generated input, method, pseudopotential or force field, sampling, and output settings. Presets are starting points, not evidence of scientific convergence.
4. Choose Your computer, then Run. In Review run, inspect the Compute plan and prerequisite list. Resolve blocked runtime, potential, isolation, input, or resource checks before Start run.
5. Follow Run history and open the module’s Execution result. Queued means waiting; Running means work has started; Completed means retained results are available. Open Execution log and inspect the numerical result before accepting it.

- [Silicon DFT tutorial](<#quickstart-silicon>)
- [Argon MD tutorial](<#quickstart-md>)
- [Run history and research evidence](<#research-history>)

<a id="docs-getting-started-5"></a>

### 5. Save, reopen, and protect the result

1. Retain the exact input, original structure, solver/runtime identity, potential checksums, provenance, and all artifacts needed by downstream calculations.
2. Wait for the app’s save status. Finish or cancel active jobs, stop the launcher, and reopen the same data directory to verify the project and execution record remain available.
3. Export a project archive and keep an independent backup for important work. A browser draft, a figure image, and optional Cloud Sync each serve different purposes; none proves all scientific intermediate files were retained.

| If this happens | Next action |
| --- | --- |
| Start is blocked or the attempt fails immediately | Read the first setup/preflight reason. No solver log is expected if no solver process started. |
| A running solver fails | Keep the input, log tail, error, and available artifacts. Check the first solver error, disk, memory, and physical model. |
| Project or runtime seems missing after restart | Check status, doctor, the actual port, and the original --data-dir before reinstalling or deleting anything. |

- [Storage and backups](<#storage-backup>)
- [Install, update, and diagnose](<#npm-local-app>)

<a id="docs-getting-started-6"></a>

### Related topics

- [From structure to a paper figure](<#workflow>)

<a id="workflow"></a>

## From structure to a paper figure

A project is the container for a material study. It connects structures, calculation setups, execution records, numerical datasets, and reusable figures. Start with the physical question, then choose the calculations and comparisons that answer it.

<a id="docs-workflow-1"></a>

### Your first complete workflow

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

1. Open the local application without login, or sign in when using the hosted website. Workspace contains projects and research tools; local identity is independent from optional Phynite Cloud login.
2. In Workspace, choose New project and enter a meaningful name such as Silicon convergence or MoS2 strain study. Open the project to continue in DFT Lab.
3. Add a structure by importing a file, building a cell, or using Materials Project. Check units, lattice vectors, species, and atom count before calculating.
4. Inspect the real-space structure. Choose periodic directions for the physical model; add vacuum explicitly where an isolated slab, wire, or molecule needs it.
5. Open Calculate and add a Total energy or Structural relaxation setup. Review the generated inputs, occupation policy, pseudopotentials, cutoffs, and k-point mesh.
6. Choose the compute destination. The npm app uses runtimes installed in Settings → Compute for Your computer; the hosted website uses a paired personal worker. Optional Phynite Cloud uses available paid Quanta or pilot grants and a supported CPU/RAM profile.
7. Run the setup and follow its execution log. A completed process is not automatically a converged or scientifically adequate result: inspect energy, convergence, forces, and messages.
8. Add band structure, DOS, phonon, or transport calculations as required. Use a completed compatible relaxation as a structure source when appropriate.
9. Choose Open in Figure Lab on a completed plottable run. Its existing figure reopens, or its numerical data creates a new figure automatically.
10. Compose comparisons, set scientific alignment, tune physical dimensions and typography, then export the figure and a Source package. Check the actual save status. A local save stays on this computer; another device needs an exported copy or explicitly enabled, confirmed Cloud Sync.

<a id="docs-workflow-2"></a>

### A useful division of work

| Place | What belongs here |
| --- | --- |
| Workspace | Choose a study, find recent projects, compare plans, open tools. |
| DFT Lab / Project | Organize projects and structures. |
| DFT Lab / Inspect | Prepare geometry and check the physical system. |
| DFT Lab / Calculate | Configure calculations, select dependencies, run, and inspect execution. |
| Figure Lab | Reuse numerical data, compare results, style and export publication figures. |
| Settings | Separate appearance, notifications, keyboard, compute, AI provider accounts, Account, Usage, and Storage pages. |
| Billing | Cloud purchases and invoices on the Phynite website; local mode opens the hosted site. |

<a id="docs-workflow-3"></a>

### Before calling a result final

- Record the source structure and computational cell used by every run.
- Converge the quantities you will report against relevant cutoffs, k/q meshes, vacuum, smearing, and solver thresholds.
- Check energy units and references before overlaying results.
- Keep the exact inputs and numerical source package alongside the exported figure.
- Describe the method, pseudopotential family, exchange-correlation functional, spin treatment, and normalization in the paper.

<a id="docs-workflow-4"></a>

### Related topics

- [Start here: from installation to your first local result](<#getting-started>)

<a id="npm-local-app"></a>

## Install, update, and diagnose the npm app

The published npm app is the local-first path for running the workspace, native DFT, MD, and analysis on your computer. It does not require a Phynite login, Docker, a source checkout, or global Python.

<a id="docs-npm-local-app-1"></a>

### Install and start

![Anonymous local workspace](<https://phynitelab.com/docs/guide/onboarding-workspace-desktop-light.png>)

Real local demo workspace. Start with New project; Cloud login is optional.

![Phynite Lab mark](<https://phynitelab.com/brand/phynite-mark-dark.png>)

The local launcher opens the workspace on your computer.

The current published package is phynite-lab@0.1.12. Node.js version >=22.13.0 is required. npm installs the launcher and the matching optional native application package for the host OS and CPU.

Keep npm optional dependencies enabled. If a package manager was configured with --omit=optional or the selected platform package was removed, the launcher reports a missing runtime instead of silently using a development fixture.

The launcher binds services to loopback, opens a browser, and stores the local workspace under ~/.phynite-lab. User projects and runtimes remain outside the npm installation directory.

```text
npm install -g phynite-lab@latest
phynite-lab
```

<a id="docs-npm-local-app-2"></a>

### Supported platforms

| Platform | Package/runtime | Notes |
| --- | --- | --- |
| macOS Apple Silicon | darwin-arm64 | Native arm64 package. |
| Linux ARM64 | linux-arm64 | Requires glibc >=2.39 and verified user namespaces. |
| Linux x64 | linux-x64 | Requires glibc >=2.39 (e.g. Ubuntu 24.04+, Arch Linux) and verified user namespaces. |
| Windows | WSL2 linux-x64 | Run npm and phynite-lab inside WSL2; a Windows-native solver is not installed. |

> The package declares darwin/linux and arm64/x64 targets. A platform is supported only when its native runtime, isolation probe, and scientific checks pass; package availability alone is not a qualification.

<a id="docs-npm-local-app-3"></a>

### Launcher commands and workspace identity

The default command starts the service in the foreground. --no-open prints the loopback URL without opening a browser. --port requests a port; if it is already used, the launcher selects an available loopback port and reports the actual origin. --data-dir gives each workspace its own database, projects, runtimes, and logs.

status reports the healthy instance for that data directory. stop asks the instance owned by that workspace to shut down cleanly. doctor checks distribution identity, service readiness, data paths, and startup diagnostics. Launching the same workspace again reuses its healthy instance instead of starting a duplicate.

```text
phynite-lab --no-open --port 3000 --data-dir /path/to/workspace
phynite-lab status --data-dir /path/to/workspace
phynite-lab doctor --data-dir /path/to/workspace
phynite-lab stop --data-dir /path/to/workspace
```

<a id="docs-npm-local-app-4"></a>

### Update without losing projects

The local app may show an update notice after checking https://registry.npmjs.org/phynite-lab/latest. A successful check is cached for up to six hours; an unavailable or invalid response is retried after about five minutes. The check sends no project data or credentials, does not install anything automatically, and never blocks local work while offline.

1. Finish or cancel active jobs and stop the current instance.
2. Run the npm update command from the same Node installation that owns the global package.
3. Start the app again and open Settings → Compute to confirm the runtime capabilities remain available.
4. If startup fails, run phynite-lab doctor and inspect the logs in the selected data directory; reinstalling the package does not remove ~/.phynite-lab.

```text
npm install -g phynite-lab@latest
phynite-lab --version
```

<a id="docs-npm-local-app-5"></a>

### Common npm startup fixes

| Symptom | Check |
| --- | --- |
| Node version rejected | Run node --version and install a Node.js version satisfying >=22.13.0. |
| Missing runtime package | Reinstall with optional dependencies enabled; check the package target reported by doctor. |
| Port already used | Use --no-open, follow the printed port, or choose --port with a free value. |
| Projects are missing | Use the original --data-dir; each directory is an independent workspace. |
| Startup service stopped | Run status and doctor, then read logs/<service>.log in the data directory. |
| Update is unavailable | Continue offline, check npm/network later, and retry; the notice is informational. |

- [Local distribution reference](<#local-compute>)
- [Troubleshooting and recovery](<#troubleshooting>)

<a id="docs-npm-local-app-6"></a>

### Related topics

- [Local npm compute and hosted workers](<#local-compute>)

<a id="local-compute"></a>

## Local npm compute and hosted workers

The local npm app runs DFT, MD, and analysis through installed native runtimes without Phynite login or Docker. Its setup lives in Settings → Compute. The hosted website uses a separate paired-worker flow, described later in this chapter; it is not a fallback runtime for the npm app.

<a id="docs-local-compute-1"></a>

### Choose the execution path

![Local workspace, project Cloud Sync, and cloud compute data boundaries](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-en-light.png>)

Concept diagram: login, project sync, and job transfer are separate choices.

| Path | Needs | Data behavior |
| --- | --- | --- |
| Your computer / npm app | Node.js, native runtime, potentials, and isolation probe. | Projects and results stay in the selected local data directory. |
| Hosted personal worker | Cloud login, paired worker, and the hosted worker requirements. | Submitted project/job artifacts follow the hosted account and retention rules. |
| Phynite Cloud compute | Cloud account, supported catalog, quota, and transfer review. | Only the reviewed job inputs are transferred; this does not enable Cloud Sync. |

<a id="docs-local-compute-2"></a>

### Native app: install and open

![Scientific runtime setup in Settings](<https://phynitelab.com/docs/guide/compute-runtime-setup-desktop-light.png>)

The current computer reports its own installed runtimes and isolation state. Your values may differ.

Use Node.js 22.13 or newer. The launcher opens a browser on loopback and stores the database, projects, artifacts, runtimes, and logs under ~/.phynite-lab. A complete published package includes the native core; no source checkout, global Python, Docker, AWS CLI, or Phynite account is required.

Open Settings → Compute. Inspect the detected platform, CPU/RAM, installed solver capabilities, and isolation probe. Choose DFT, MD/analysis, or both. Internet is needed for initial verified downloads; local scientific execution can work offline once its runtime and required potentials are present.

Downloads use pinned versions and checksums, staging, and atomic activation. A failed update retains the previous runtime. Select potential files according to their license, exact identity, checksum, and element mapping.

```text
npm install -g phynite-lab
phynite-lab
```

- [Open Compute](<https://phynitelab.com/account/compute>)

<a id="docs-local-compute-3"></a>

### Native app: resources, jobs, and recovery

1. Set default CPU, RAM budget, and parallel jobs in Compute. Defaults start at one job, approximately half the logical cores, and at most half physical RAM. New defaults affect future jobs; an explicit job override does not resize an active job.
2. Begin with a small reference calculation. Select Your computer and inspect Log through the final state. Verify actual solver success, convergence, inputs, provenance, and numerical output before interpreting the result.
3. Guided and manual LAMMPS preserve the chosen physical settings. Manual input also requires a successful native sandbox probe. If isolation is unavailable, follow the shown remediation; manual execution stays blocked.
4. Keep the CLI running and the computer awake. Cancel in the job log and wait for the final state. After a crash or restart, inspect interrupted jobs; they are not automatically rerun. A monitored RAM budget is not advertised as an operating-system hard limit.

```text
phynite-lab status
phynite-lab doctor
phynite-lab stop
```

<a id="docs-local-compute-4"></a>

### First local calculation: the shortest safe path

1. Install and start the app, then open Settings → Compute.
2. Install DFT or MD/analysis, or both. Wait for the pinned download, checksum verification, and atomic activation to finish.
3. Confirm the detected solver capability and a successful native isolation probe. Manual LAMMPS stays unavailable when the probe fails.
4. Install the pseudopotential or potential files required by the selected elements and record their exact identity and checksum.
5. In the run review choose Your computer, submit a small reference calculation, and wait for a final state.
6. Read the queue and execution status, the first solver error when one exists, the convergence markers, provenance, checksums, and numerical result before scaling up.

- [Compute setup](<https://phynitelab.com/account/compute>)
- [Calculation diagnostics](<#diagnostics>)

<a id="docs-local-compute-5"></a>

### Native app: data, preferences, and optional connections

SQLite and filesystem data are the primary local copy. Use Settings → Storage to export/import project archives, and keep independent backups. Browser storage holds recoverable drafts and device preferences, not the full native workspace.

Appearance, language, keyboard shortcuts, and local notification choices stay in this browser. AI provider connections use the official Codex or Antigravity CLI; each provider has one CLI-managed connection and the local app has no gateway setup. Account manages Phynite Cloud separately; login does not upload projects. Cloud Sync is enabled per project, and cloud compute reviews its own input transfer without enabling sync.

Billing opens the Phynite website. Finish or cancel jobs, stop the app, update with npm install -g phynite-lab@latest, then reopen. Updating the package preserves data outside its installation directory.

<a id="docs-local-compute-6"></a>

### Local storage and large Quantum ESPRESSO state

The default local workspace is ~/.phynite-lab; use phynite-lab --data-dir /path/to/workspace when another disk is appropriate. SQLite stores metadata and the filesystem stores project artifacts, runtime installations, and logs. The Storage page measures inventoried project artifacts only; database metadata, solver/runtime installations, logs, and unrelated files on the disk are outside that number.

Local mode has no fixed 10 GiB quota and no automatic seven-day cleanup. Its practical limit is the free space on the selected disk; runtime installers and logs consume that disk even when excluded from the inventory. Export/import project archives and an independent backup are required for important work.

Quantum ESPRESSO disk_io settings and intermediate state can be much larger than the final output. Wavefunction and tmp data may be required for bands, DOS, phonon, projected workflows, or external interoperability. Do not delete intermediate state until every downstream workflow is finished; keep the exact input, pseudopotential identity/checksum, provenance, and state artifacts together.

Wannier90 is an external/manual workflow unless a separately documented native integration is available. Export the required Quantum ESPRESSO state and follow the official Wannier90 documentation; Phynite does not claim to run that tool natively here.

| Counted by local Storage | Not counted by local Storage |
| --- | --- |
| Inventoried project inputs, structures, configurations, results, trajectories, and exported artifacts. | SQLite metadata, solver/runtime installation files, logs, browser cache, and unrelated files on the disk. |
| Completed artifacts retained in the project, including large QE state when it is recorded there. | Free space used by the operating system or by another application. |

- [Storage settings](<https://phynitelab.com/account/storage>)
- [Quantum ESPRESSO documentation](<https://www.quantum-espresso.org/documentation/>)
- [Wannier90 documentation](<https://wannier.org/documentation/>)

<a id="docs-local-compute-7"></a>

### Hosted website: connect a personal worker

The following connection-code, downloadable-helper, and Docker instructions apply when using the hosted Phynite website. They are not required by the native npm app. This worker receives hosted jobs and uploads their results to the signed-in account.

<a id="docs-local-compute-8"></a>

### Plan, review, monitor, compare

1. Open Resources from the workspace sidebar, the collapsed rail, or Workspace options on a small screen. Check available Quanta after reservations, storage measured at its last inventory, CPU/RAM, and the estimated affordable Cloud time. That time describes capacity for one new job at the selected paid profile rate, including its minimum billable duration; it is not a completion ETA. Pilot grants have separate job/time limits.
2. Review the run before starting. A run override takes precedence over the account default for that workload, then the existing service default. Make default explicitly saves choices for future runs. Estimated duration helps quote a budget; it does not change the enforced runtime timeout.
3. Monitor the selected active job: queued, preparation, computing, and saving results. Elapsed time starts at the recorded start, and each job has its own clock. Finish includes uploading results. Resource data refreshes every 15 seconds with active jobs or every 60 seconds while idle; refresh errors retain the last available values.
4. Compare short representative runs with several CPU allocations before a large campaign. Keep the same scientific inputs when comparing performance. More cores do not always improve speed: Quantum ESPRESSO scaling depends on the system and parallel work distribution, and LAMMPS recommends measuring your actual workload. Phynite does not automatically start a paid benchmark.

| Metric | Meaning |
| --- | --- |
| Run wall time | Recorded completion minus recorded start, including preparation and result upload; queue waiting before start is excluded. |
| Solver / analysis time | Measured compute duration reported to the Phynite ledger. Paid charges follow that ledger and profile rate, with the per-job minimum; external HPC charging policies do not determine Phynite charges. |
| CPU-hours | Recorded run wall hours multiplied by worker-reported vCPUs, or the Cloud grant when no worker report exists. Personal jobs without reported runtime allocation are excluded and marked partial, never assumed to use one core. |
| GPU / VRAM | GPU is unsupported by this runtime. Missing VRAM telemetry is unreported. Missing historical duration, allocation, or charges appear as unavailable, rather than zero. |

- [Compute defaults](<https://phynitelab.com/account/compute>)
- [Usage and run receipts](<https://phynitelab.com/account/usage>)
- [NERSC: resource accounting](<https://docs.nersc.gov/policies/resource-usage/>)
- [Quantum ESPRESSO: parallelization](<https://www.quantum-espresso.org/Doc/pw_user_guide/node18.html>)
- [LAMMPS: measure performance](<https://docs.lammps.org/stable/Speed_measure.html>)

<a id="docs-local-compute-9"></a>

### Hosted worker: before you start

Choose CPU and RAM per job in Compute settings or the workspace drawer, within the limits shown for DFT, MD simulation, or MD analysis. Allocation describes resources requested for the job. New workers also report the CPU/RAM allocation passed to the launched runtime; this is not hardware utilization. Required capacity depends on atoms, cutoffs, k-points, bands, and calculation type.

Keep several GB of disk space free for the verified runtime and scientific libraries, plus working space for results. Internet is needed to connect the account, receive calculations, and upload results.

| Computer | Download | Open |
| --- | --- | --- |
| macOS | Phynite Compute for macOS | Open Phynite Compute.command |
| Windows 10 / 11 | Phynite Compute for Windows | Open Phynite Compute.cmd |
| Linux | Phynite Compute for Linux | ./phynite-compute |

- [Download Phynite Compute](<https://phynitelab.com/account/compute#your-computer>)

<a id="docs-local-compute-10"></a>

### 1. Download and open

1. Open Your computer from the avatar menu. The website recommends the correct download for your operating system; links for other supported systems remain available.
2. Extract the ZIP and open its launcher. The helper checks the local engine and opens its official installer page only when that prerequisite is missing.
3. The first setup downloads a pinned, architecture-compatible scientific runtime. Later launches reuse it and preserve the private Phynite Compute volume.

- [Open Your computer](<https://phynitelab.com/account/compute#your-computer>)

<a id="docs-local-compute-11"></a>

### 2. Approve this computer

1. The launcher returns to Your computer with the 12-digit Connection code already filled in. Review the page and choose Connect computer.
2. Each code works once and expires after 10 minutes. Only approve a computer you control.
3. If another computer is linked, finish or cancel its active calculations before confirming replacement.
4. After approval, Phynite Compute downloads and verifies the scientific libraries. Wait until the web status changes to Connected. That single connection enables both DFT Lab and MD Lab.

> The short-lived code authorizes one computer without exposing its private credential.

<a id="docs-local-compute-12"></a>

### 3. Run your first calculation

1. Open DFT Lab and begin with a small silicon Total energy calculation. Select Your computer as the compute destination.
2. Watch the execution log. A queued job waits for your connected computer and earlier dependencies. One calculation runs at a time on this computer.
3. For a successful SCF result, check convergence, JOB DONE, and the final Completed state. Completion also requires result upload.
4. Open Figure Lab from the completed result. Its data remains linked to the project, source calculation, and numerical settings.
5. Open MD Lab and run a small Lennard-Jones equilibration. It uses the same connected computer and does not require a second pairing.

- [Silicon tutorial](<#quickstart-silicon>)
- [Read execution logs](<#execution>)

<a id="docs-local-compute-13"></a>

### Everyday use

The private Phynite Compute volume remembers the connection and downloaded libraries. Keep the computer awake and internet available while a calculation is active; the website may be closed.

Stopping the local engine or putting the computer to sleep can interrupt a calculation. Restore connectivity and inspect the job state before sending a duplicate. Local project artifacts remain on the selected data disk until you delete or export them; hosted worker retention and Trash rules are separate.

| Action | Location |
| --- | --- |
| Open or restart Phynite Compute | Open the downloaded launcher again |
| Check connection | Your computer in the account menu |
| View technical messages | Advanced manual setup → Show service logs |
| Cancel a calculation | Use Cancel in the execution log and wait for its final state |

<a id="docs-local-compute-14"></a>

### Update, disconnect, or move computers

1. Finish or cancel active calculations before an update, replacement, or disconnection.
2. For an update, download and open the current launcher. It asks before replacing a changed runtime and preserves the private volume.
3. To move computers, disconnect the old one in Your computer, download Phynite Compute on the new machine, and approve its new code.

> One active personal-computer credential is supported per account. Never copy or share the private runtime volume.

<a id="docs-local-compute-15"></a>

### Troubleshooting

| What you see | What to do |
| --- | --- |
| The local engine is missing | The launcher opens its official installer page. Install it, wait until ready, then reopen Phynite Compute. |
| No code appears | Allow the first runtime download to finish. Reopen the launcher, or use Show service logs under Advanced manual setup. |
| Code expired or was used | Reopen the launcher to request and open the latest code. |
| Approved, but still Offline | First-time library setup can take several minutes. Check service logs and refresh the connection afterward. |
| Job stays queued | Check Connected status, Your computer destination, and completed dependencies. Do not submit a duplicate. |
| Setup/preflight rejected before solver start | No solver log exists because the runtime did not start. Read the visible capability, isolation, potential, or input validation message, fix that prerequisite, then submit once. |
| Solver starts, then fails | Open the execution log and the first solver error, keep the failed provenance and artifacts, and check memory/disk/convergence before changing a scientific input. |
| OOMKilled / exit 137 | The calculation exceeded available memory. Reduce system size or bands only where scientifically appropriate. |

- [Contact support](<https://phynitelab.com/contact>)
- [Calculation diagnostics](<#diagnostics>)

<a id="docs-local-compute-16"></a>

### Hosted worker: advanced Docker diagnostics

Normal setup does not require Terminal or PowerShell. Support may ask you to run the pinned command or read recent service logs. These commands use the same read-only, non-root Docker runtime as the launcher.

```text
docker run -d --name phynite-compute --restart unless-stopped --init --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --cpus 4 --memory 8g --tmpfs /tmp:rw,size=512m -v phynite-compute:/state public.ecr.aws/p8i3a1t8/phynite/personal-compute@sha256:2e478dd301384eaa9ea754fcf6630de7fe7ad1ccb114fb5f5c5d8dba3d49a185
docker logs --tail 30 phynite-compute
```

> Do not change the image reference, share the private volume, or paste connection codes into support messages.

<a id="docs-local-compute-17"></a>

### Access, data, and scientific checks

The isolated service receives only calculations belonging to the account that approved its code. Disconnecting revokes access. No incoming port, Docker socket, or host home folder is shared.

The runtime uses a read-only image, dedicated storage volume, non-root user, and CPU, memory, and process limits. It requires outgoing internet access for Phynite and verified library downloads.

Local machine owners can modify their own software. Account binding protects access to other accounts; it does not certify a scientific result. Check convergence, numerical settings, solver versions, and pseudopotentials before publication.

- [Convergence studies](<#convergence>)
- [Prepare publication figures](<#publication>)

<a id="docs-local-compute-18"></a>

### Related topics

- [Install, update, and diagnose the npm app](<#npm-local-app>)

<a id="project"></a>

## Projects, structures, and calculation records

Use one project for a coherent study, then keep material variants as separate named structures within it. A calculation setup is editable; each execution is a historical record of a submitted input.

<a id="docs-project-1"></a>

### Organize a study

![Create a neutral demo project](<https://phynitelab.com/docs/guide/new-project-desktop-light.png>)

Use a name that identifies the study.

1. In Workspace, choose New project, enter a name (up to 100 characters) and optional description (up to 500 characters), then choose Create project. The Project panel in DFT Lab provides another creation route.
2. Name it by question or dataset: strain response, alloy comparison, or convergence study.
3. Add structures and give variants explicit names, such as MoS2 strain -2 percent, 0 percent, and +2 percent.
4. Add the relevant calculation stack under each structure. Duplicate a setup when the same method should be reused.
5. Use project or structure menus for rename and duplicate. Read the confirmation before deleting anything.

<a id="docs-project-2"></a>

### Understand the identities

A local structure, its uploaded cloud structure, and a submitted calculation are linked but distinct records. Editing the current structure does not rewrite a completed calculation.

A figure references immutable numerical datasets. Replacing data in a figure is an explicit action; changing a setup or source metadata does not silently alter existing published comparisons.

> The visual supercell repeat is a preview. Increasing the displayed repeats does not automatically submit a larger computational supercell.

<a id="docs-project-3"></a>

### Find and reopen work

- Workspace searches project names, descriptions, and the primary chemical formula.
- Click Name, Activity, or Last edited to sort the project list; click again to reverse the direction. Open a row to resume its DFT Lab workspace.
- The URL preserves project and Figure Lab view. Browser Back/Forward returns to that view after the account workspace loads.
- An unavailable project link does not open an unrelated project figure. Select an existing project or restore the intended data.

<a id="docs-project-4"></a>

### Open an older project

Older local project links are recognized and migrated into the current Canvas only when the destination has no saved revision. Exact legacy configurations and run history are retained; an existing Canvas revision is not overwritten.

If the workflow service or linked project is unavailable, a verified local copy can open in the original editor. Other opening failures keep their error and may offer Open original editor when a matching local copy exists. Do not clear browser data as a troubleshooting step; export a backup of important research before further recovery.

<a id="docs-project-5"></a>

### Related topics

- [Import and inspect a structure](<#structure>)
- [Edit atoms and cell geometry](<#edit>)
- [Periodic directions, vacuum, and dimensionality](<#periodicity>)

<a id="structure"></a>

## Import and inspect a structure

DFT Lab shows direct, real space: lattice vectors and atoms. Reciprocal-space k-points and band paths belong to calculation configuration and result interpretation.

<a id="docs-structure-1"></a>

### Choose an input route

| Route | What to check |
| --- | --- |
| New structure | Set the cell lengths and angles, species, and atom positions explicitly. |
| CIF | Check occupancies, disorder, fractional coordinates, and whether the intended cell is primitive or conventional. |
| POSCAR / VASP | Verify the scale factor, element ordering, and Direct versus Cartesian positions. |
| XSF / XYZ / PDB | Confirm that the file contains a usable simulation cell; isolated coordinates alone do not define periodicity. |
| Quantum ESPRESSO input/output | Check the imported cell and whether the positions correspond to the intended ionic step. |
| Materials Project | Inspect source identity, composition, cell convention, and the suitability of the database structure for your question. |

<a id="docs-structure-2"></a>

### Import a file

![Structure editor and cell inspection](<https://phynitelab.com/docs/guide/structure-editor-desktop-light.png>)

Inspect species, coordinates, and the simulation cell before running.

1. Select the destination project.
2. Use Add structure / Import, or drop one supported structure file into the workspace.
3. Inspect the structure record, formula, number of atoms, and cell.
4. Rotate and repeat the cell visually to find misplaced atoms or unexpected neighbors.
5. Resolve parser warnings or partial occupancies before using the model for an ordered QE calculation.

<a id="docs-structure-3"></a>

### Search a crystal database

Open or add a Crystal structure module, then choose Crystal database inside its editor to search public structure records. Crystallography Open Database (COD) works without an API key; Materials Project requires MP_API_KEY in the server environment. Search uses the provider shown in the browser, and a provider failure stays visible.

Select and import the intended record, then inspect its formula, lattice, atom count, occupancies, and source identity. Database structures are starting models, not proof that a phase, magnetic state, or calculation setup is appropriate. Unreported numerical properties remain unavailable.

1. Open the destination Crystal structure module and choose Crystal database from its editor toolbar.
2. Choose the database and enter a chemical formula, element list, material name, or supported source ID.
3. Review the results and import one selected structure into that module. The Canvas connections and module identity remain in place.
4. For an AI-assisted import, ask Phynite AI to search the database and use a specific record. Search is read-only; applying an import follows the conversation permission mode and its action review.
5. Read the imported source identity and checksum. Check the geometry and pseudopotentials before connecting the structure to a calculation.

> Database access needs an internet connection. Credentials for Materials Project stay in the server environment; never paste an API key into chat or include it in a project export.

- [Crystallography Open Database](<https://www.crystallography.net/cod/>)
- [Materials Project documentation](<https://docs.materialsproject.org/>)

<a id="docs-structure-4"></a>

### Fractional and Cartesian coordinates

Fractional coordinates locate an atom by a combination of the cell vectors: r = f1 a + f2 b + f3 c. Cartesian coordinates specify x, y, and z in a length unit. A value of 0.5 in a fractional field is half a lattice vector, not half an angstrom.

For tilted cells, cell length and perpendicular vacuum thickness are different. Check the full cell geometry instead of assuming the c vector points along the Cartesian z axis.

> Neighbor lines are distance-based coordination guides, not calculated chemical bond orders. Their cutoff and display cap can hide or include neighbors without changing the scientific structure.

<a id="docs-structure-5"></a>

### Related topics

- [Projects, structures, and calculation records](<#project>)
- [Edit atoms and cell geometry](<#edit>)
- [Periodic directions, vacuum, and dimensionality](<#periodicity>)

<a id="edit"></a>

## Edit atoms and cell geometry

Select, move, add, substitute, delete, and measure atoms in the viewport. Keep geometry changes deliberate and inspect the result before rerunning a calculation.

<a id="docs-edit-1"></a>

### Atom tools

![Atom editing tools in the structure editor](<https://phynitelab.com/docs/guide/structure-editor-desktop-light.png>)

Tool icons act on the selected structure; visual repeats do not change the simulation cell.

| Tool | Use |
| --- | --- |
| Select (V) | Select an atom and inspect its properties. |
| Move (G) | Move a selection; choose an axis or plane, then apply or cancel the move. |
| Add atom (A) | Open the element selection flow and place the intended species. |
| Measure (M) | Select the atoms required by the distance or angle mode. |
| Focus (F) | Center the viewport on the selected atom. |
| Delete / Backspace | Delete the selected atom when the viewport has focus. |

<a id="docs-edit-2"></a>

### Constrained movement

In Move mode, X, Y, or Z constrains motion to that Cartesian axis. Shift+X, Shift+Y, or Shift+Z uses the perpendicular YZ, XZ, or XY plane. Enter applies the move; Escape cancels it.

Use coordinate fields when you need an exact displacement. Numeric editors allow an intermediate draft such as a minus sign or exponent; commit with Enter or by leaving the field. Escape restores the previous value.

<a id="docs-edit-3"></a>

### Cell edits and visual appearance

- Cell metric edits change the actual lattice. Inspect whether the resulting geometry represents the strain or model you intend.
- The vacuum action increases separation normal to the a-b plane and preserves Cartesian atomic distances; it is not a general arbitrary-axis slab builder.
- Atom size, bond size, labels, neighbor cutoff, and displayed repeat count affect visualization.
- Undo/redo applies to supported editor actions in the current editing session. Keep explicit structure copies for scientific variants you want to retain permanently.

<a id="docs-edit-4"></a>

### Related topics

- [Projects, structures, and calculation records](<#project>)
- [Import and inspect a structure](<#structure>)
- [Periodic directions, vacuum, and dimensionality](<#periodicity>)

<a id="periodicity"></a>

## Periodic directions, vacuum, and dimensionality

Quantum ESPRESSO solves a periodically repeated three-dimensional simulation cell. Slabs and low-dimensional systems are configured via vacuum and k-point sampling in calculations.

<a id="docs-periodicity-1"></a>

### Supercells, slabs, and vacuum

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

Cell repetition in the viewer allows inspecting extended lattices without modifying the underlying unit cell. Slabs and low-dimensional structures are constructed by explicitly introducing vacuum along the desired non-periodic direction (typically c).

Quantum ESPRESSO always assumes periodic boundary conditions in 3D: for a slab or 2D material, maintain sufficient vacuum separation between periodic replicas, set a single k-point along the vacuum direction (e.g. N × M × 1), and configure appropriate dipole/electrostatic corrections.

> For a slab, keep a finite simulation-cell height, add and converge vacuum explicitly, use a single k-point in the nonperiodic direction, and choose a suitable electrostatic treatment in the actual QE input.

<a id="docs-periodicity-2"></a>

### Common systems

| System | Display repetition | Computational checks |
| --- | --- | --- |
| Bulk crystal | 2 × 2 × 2 | Converge a three-dimensional k mesh; use the intended primitive or conventional cell. |
| Slab / 2D sheet in a-b plane | 2 × 2 × 1 | Converge perpendicular vacuum and in-plane k mesh; usually one k-point along c. Review dipole or 2D isolation treatment when appropriate. |
| Wire along c | 1 × 1 × 2 | Converge vacuum in both transverse directions and sampling along the wire. The built-in c-vacuum action alone does not prepare this geometry. |
| Molecule / cluster | 1 × 1 × 1 | Use a sufficiently large 3D box; typically Gamma-only sampling. Check charged-system and dipole treatment as needed. |

<a id="docs-periodicity-3"></a>

### A reproducible slab check

1. Orient the slab so its surface lies in the a-b plane.
2. Add vacuum along c and inspect the actual cell and positions.
3. Set cell repetition to 2 × 2 × 1 to inspect the in-plane extended surface without repeating along the vacuum direction.
4. Set the k mesh to N by M by 1; choose N and M through convergence.
5. Inspect generated or expert input for the appropriate electrostatic setup.
6. Repeat with larger vacuum and denser in-plane sampling until the target quantity is stable.

> A rendering choice is not proof that a model is physically isolated. Verify the executed input and convergence results.

<a id="docs-periodicity-4"></a>

### Related topics

- [Projects, structures, and calculation records](<#project>)
- [Import and inspect a structure](<#structure>)
- [Edit atoms and cell geometry](<#edit>)

<a id="slab-workflow"></a>

## Procedure: prepare a two-dimensional slab

Use this procedure for a sheet or slab whose surface spans the a-b plane. Quantum ESPRESSO requires a finite three-dimensional cell with converged vacuum.

<a id="docs-slab-workflow-1"></a>

### Geometry prerequisites

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

- Start from a physically meaningful termination, composition, and surface orientation.
- Inspect fractional and Cartesian coordinates. A tilted cell needs vacuum measured normal to the surface, not merely the length of c.
- Check that the slab has the intended thickness and no unintended cross-boundary bonds.
- Duplicate the structure before changing the cell so the original bulk or slab remains available.

<a id="docs-slab-workflow-2"></a>

### Prepare the model

1. Orient the surface in the a-b plane. Verify the lattice-vector geometry instead of relying only on camera orientation.
2. Set cell repetition along c to 1 (e.g. 2 × 2 × 1) to inspect the in-plane extended surface without repeating along the vacuum direction.
3. Use the explicit vacuum action for the a-b surface. Inspect the updated cell and confirm interatomic Cartesian distances remain appropriate.
4. Choose an in-plane mesh N × M × 1, with N and M established by convergence.
5. Review the electrostatic treatment in the generated or expert QE input. Asymmetric, polar, and charged slabs need specific consideration.
6. Converge slab thickness, vacuum, and in-plane sampling against the quantity of interest.

<a id="docs-slab-workflow-3"></a>

### Understand a strained slab

Biaxial in-plane strain modifies the in-plane metric. Record the strain tensor, reference lattice, and whether atoms are relaxed at fixed in-plane cell.

Changing vacuum height changes the three-dimensional cell volume without changing the physical sheet thickness. A reported stress or conductivity normalized by this arbitrary volume may require a clearly defined two-dimensional conversion.

The c-vacuum helper does not construct every wire, arbitrary Miller-index slab, or isolated cluster. Import or prepare the appropriate geometry when the required operation is outside the builder tools.

<a id="docs-slab-workflow-4"></a>

### Validate before submission

| Check | Evidence to retain |
| --- | --- |
| Surface and orientation | Cell vectors, coordinates, termination, and original source. |
| Vacuum | Normal separation and at least two tested separations around the selected value. |
| Sampling | Executed k mesh and in-plane convergence results. |
| Electrostatics | Exact QE settings and their physical justification. |
| Relaxation | Fixed and free degrees of freedom, force threshold, and final geometry. |

<a id="docs-slab-workflow-5"></a>

### Related topics

- [Projects, structures, and calculation records](<#project>)
- [Import and inspect a structure](<#structure>)
- [Edit atoms and cell geometry](<#edit>)

<a id="quickstart-silicon"></a>

## Tutorial: a first silicon calculation

Complete a small ground-state calculation before attempting a large material study. This tutorial checks the structure-to-worker-to-result workflow; its numerical settings are starting values for an exercise, not a converged production method.

<a id="docs-quickstart-silicon-1"></a>

### Before you begin

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

- Open the local app without login, or sign in to the hosted website with the account that owns the project.
- In the npm app, install DFT in Settings → Compute and keep the CLI running. On the hosted website, connect Your computer through the paired worker and keep its Docker runtime active.
- Have a diamond-cubic silicon structure in CIF, POSCAR, or another supported format. Keep its source and lattice parameter with your notes.
- Use a primitive two-atom cell for this exercise. A conventional eight-atom cell is physically valid but has different total energy, reciprocal vectors, and computational cost.

<a id="docs-quickstart-silicon-2"></a>

### Create and inspect the project

1. In Workspace, choose New project. Enter Silicon ground state and an optional description, then choose Create project.
2. Open the new project from the confirmation or project list. Add your silicon structure.
3. Confirm Si is the only species and the intended primitive cell has two atoms. Inspect cell lengths, angles, units, and nearest neighbors.
4. Keep a, b, and c periodic for bulk silicon. The displayed repeated cells are a visualization, not extra atoms submitted to the solver.
5. Give the structure a source-specific name. Retain the original file before changing its lattice.

<a id="docs-quickstart-silicon-3"></a>

### Configure the exercise

| Choice | Starting point | Why to inspect it |
| --- | --- | --- |
| Workflow | Total energy / SCF | Produces the self-consistent ground state; it does not produce a band-path figure by itself. |
| Method | PBE with matching Si pseudopotential | Changing the functional or pseudopotential changes the physical model and energy zero. |
| Wavefunction cutoff | Use the resolved pseudopotential recommendation | A remembered cutoff from another potential is not transferable evidence of convergence. |
| Charge-density cutoff | Use the matching recommendation | The appropriate ratio depends on the pseudopotential type. |
| Integration mesh | 4 × 4 × 4 as an initial exercise | Repeat with denser meshes before interpreting small energy differences. |
| Occupations | Review the resolved insulating occupation policy | Do not infer metallic behavior from a numerical smearing choice. |
| Resources | A small allocation within the displayed account limits | Allocation controls available worker resources, not the accuracy of the method. |

<a id="docs-quickstart-silicon-4"></a>

### Run and inspect

1. Inspect the generated input and select the intended compute destination.
2. Run once. Open Log and follow Queued, Running, and the final state.
3. Look for a converged SCF result in the solver output. A finished process without self-consistency is not an acceptable ground state.
4. Record total energy, atom count, executed input, pseudopotential identity, and run ID.
5. If you need a dispersion plot, add Band structure and configure a reciprocal path for this cell. Complete it, then choose Open in Figure Lab from its result.

<a id="docs-quickstart-silicon-5"></a>

### Expected outcome

The project contains the original structure, an editable setup, and a historical execution record with output artifacts. A separate band or DOS run supplies plottable numerical data.

There is no universal target energy for this tutorial: the value depends on the potential, cell, cutoffs, and conventions. Verify internal convergence and consistent method identity instead of matching an unexplained number.

> If the job stays Queued, check the destination and worker connection before submitting duplicate runs. See Execution and the troubleshooting decision table.

<a id="docs-quickstart-silicon-6"></a>

### Failure and recovery

- If the worker is offline, reconnect it and wait for the queued job instead of submitting another.
- For Failed, inspect the saved input and first meaningful solver error in the log before changing a setting.
- For Cancelled, keep the partial log and submit a new run only after the prior job reaches a final state.

<a id="docs-quickstart-silicon-7"></a>

### Related topics

- [Choose and connect calculations](<#calculation>)
- [Configure and validate Quantum ESPRESSO](<#configure>)
- [Execution, resources, and cancellation](<#execution>)

<a id="calculation"></a>

## Choose and connect calculations

The Calculate panel separates DFT setups, the execution log, and reusable configurations. Select the scientific task first; the generated workflow then creates the required solver stages.

<a id="docs-calculation-1"></a>

### Available workflows

| Calculation | Purpose | Main tools |
| --- | --- | --- |
| Total energy | SCF electronic ground state and energy. | pw.x |
| Structural relaxation | Optimize ions; optionally optimize permitted cell degrees of freedom. | pw.x relax / vc-relax |
| Band structure | Sample eigenvalues along a specified reciprocal-space path. | pw.x + bands.x |
| Density of states | Sample a uniform mesh for a DOS and optional projections. | pw.x + dos.x / projection inputs |
| Phonon dispersion | DFPT and real-space force constants, then a phonon path. | ph.x + q2r.x + matdyn.x |
| Thermoelectric properties | Interpolated electronic bands and semiclassical transport. | QE + BoltzTraP2 |

<a id="docs-calculation-2"></a>

### Build a calculation stack

![Scientific modules connected on Canvas](<https://phynitelab.com/docs/guide/workflow-canvas-desktop-light.png>)

Connections describe dependencies. A draft module is not a completed run.

1. Select a structure and open Calculate / DFT.
2. Choose Add calculation and select the task.
3. Configure the setup and inspect its input files.
4. For a calculation that should use a relaxed structure, select the appropriate structure source.
5. Run one calculation, Run selected, or Run all. Required predecessors can be submitted first and reused when compatible.
6. Inspect each individual run in Log; a dependency may keep a downstream job queued.

<a id="docs-calculation-3"></a>

### Dependencies and reruns

A downstream job waits until its declared prerequisites have completed. Reuse is based on compatible execution records, not merely a similar display name.

Changing a structure, functional, charge, spin state, or cutoff may invalidate scientific reuse. If in doubt, create a new run and retain the old one as a comparison.

Save selected stores the calculation configurations for reuse. It does not execute a solver. Figure Lab has its own automatic save flow and does not require a Save revision button.

<a id="docs-calculation-4"></a>

### Related topics

- [Configure and validate Quantum ESPRESSO](<#configure>)
- [Execution, resources, and cancellation](<#execution>)
- [Tutorial: a first silicon calculation](<#quickstart-silicon>)

<a id="configure"></a>

## Configure and validate Quantum ESPRESSO

Smart defaults provide a starting point. They do not replace a convergence study or knowledge of the material. Generated inputs and expert raw input have different responsibilities.

<a id="docs-configure-1"></a>

### Core choices

![DFT configuration and input controls](<https://phynitelab.com/docs/guide/dft-configuration-desktop-light.png>)

This demo configuration illustrates the controls; converge settings for your own material.

| Setting | Meaning | Check before running |
| --- | --- | --- |
| Functional | Exchange-correlation approximation. | Use pseudopotentials and a solver workflow compatible with it; UI selection alone does not establish method support for every advanced case. |
| ecutwfc / ecutrho | Plane-wave wavefunction and charge-density cutoffs. | Converge the reported energy, forces, stress, or response; respect pseudopotential recommendations. |
| k-point mesh | Sampling for Brillouin-zone integration. | Use a uniform mesh for SCF/DOS; do not substitute a high-symmetry band path. |
| Occupations / smearing | How electronic states are filled and integrated. | Match metallic, insulating, spin, and temperature assumptions. |
| nbnd | Number of computed bands. | Include enough unoccupied states for the target energy window or transport analysis. |
| SCF thresholds / mixing | Self-consistency stopping and iteration behavior. | Inspect convergence; raising the iteration limit does not fix every physical or numerical instability. |
| Charge / magnetization / spin | Electronic state assumptions. | Use compatible pseudopotentials and a justified reference state. |

<a id="docs-configure-2"></a>

### Adaptive and expert modes

Adaptive mode resolves editable occupation and cutoff defaults from the workflow and material context. User overrides remain explicit.

Expert raw input is authoritative for the submitted text. Adaptive occupation and cutoff resolution does not silently rewrite it. You take responsibility for compatible cards, paths, species, units, and solver options.

Review the executed input from the result artifacts, not only an earlier editor preview. The worker may resolve required runtime data such as pseudopotential provenance.

<a id="docs-configure-3"></a>

### Convergence example

1. Fix one structure and method; create a baseline Total energy calculation.
2. Vary ecutwfc and the compatible ecutrho while keeping the k mesh fixed.
3. Track energy per atom and, when relevant, forces or stress instead of only total cell energy.
4. Choose a sufficient cutoff, then vary the k mesh.
5. For low-dimensional systems, repeat the vacuum check independently.
6. Record the tolerance used to call the reported quantity converged.

> Preset names such as Fast, Balanced, and High accuracy are setup conveniences. They are not certificates of publication accuracy.

<a id="docs-configure-4"></a>

### Related topics

- [Choose and connect calculations](<#calculation>)
- [Execution, resources, and cancellation](<#execution>)
- [Tutorial: a first silicon calculation](<#quickstart-silicon>)

<a id="convergence"></a>

## Procedure: design a convergence study

A convergence study establishes how numerical choices affect a reported physical quantity. Define the quantity and tolerance first, then vary a controlled parameter while preserving all other inputs.

<a id="docs-convergence-1"></a>

### Define a comparison that answers the paper

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

For a phase-energy comparison, converge the energy difference using comparable cells and normalization. For relaxation, inspect force and stress stability. For a band edge, transport coefficient, or phonon mode, converge that observable directly.

A stable total energy does not imply every response property has converged. Keep the target tolerance in your project description or method notes.

<a id="docs-convergence-2"></a>

### Run a controlled series

1. Duplicate a reference setup and give each variant a name containing the varied parameter and unit.
2. Vary ecutwfc with a compatible ecutrho. Keep geometry, pseudopotentials, k mesh, spin, occupations, and SCF threshold fixed.
3. At a sufficiently high cutoff, vary the uniform k mesh. Inspect smearing sensitivity independently for metals.
4. For low-dimensional systems, vary actual vacuum separation without changing the slab geometry or in-plane cell.
5. Run the necessary combinations near the chosen settings to check that separately converged choices remain sufficient together.
6. Retain every run and calculate the difference from the most resolved reference. Export the observations as a numerical table for plotting.

<a id="docs-convergence-3"></a>

### Record a minimal results table

Replace placeholders with observed values; the table is a recording template, not simulated data. For the same composition and cell, delta per atom = (E - E_reference) / atom_count. Convert Ry to the unit reported in the paper consistently.

Do not subtract raw total energies of unrelated compositions as if they were a formation energy. Such comparisons require defined reference chemical potentials and stoichiometry.

```text
cutoff_Ry,k_mesh,energy_Ry,atoms,delta_meV_per_atom,run_id
40,4x4x4,<measured>,2,<derived>,<run-id>
50,4x4x4,<measured>,2,<derived>,<run-id>
60,4x4x4,<measured>,2,<derived>,<run-id>
```

<a id="docs-convergence-4"></a>

### Choose a stopping rule

| Observable | Inspect | Frequent mistake |
| --- | --- | --- |
| Energy difference | Change between successively more resolved calculations | Choosing a universal threshold without regard to the effect being studied. |
| Forces and stress | Largest relevant component and equilibrium geometry | Relaxing at low cutoff, then assuming a high-cutoff single point fixes the geometry. |
| Band extrema | k sampling and the actual location of extrema | Assuming the band gap always lies on the plotted high-symmetry path. |
| Phonons | SCF/DFPT thresholds, k/q meshes, acoustic behavior | Removing negative modes cosmetically before understanding them. |
| Transport | Dense electronic sampling, interpolation, chemical potential and temperature | Treating an interpolated smooth curve as evidence of convergence. |

<a id="docs-convergence-5"></a>

### Related topics

- [Choose and connect calculations](<#calculation>)
- [Configure and validate Quantum ESPRESSO](<#configure>)
- [Execution, resources, and cancellation](<#execution>)

<a id="execution"></a>

## Execution, resources, and cancellation

A run moves through preparation, queueing, execution, result persistence, and completion. Native results are saved locally; hosted jobs also upload required artifacts. The log identifies the stage that needs attention.

<a id="docs-execution-1"></a>

### Read the run state

![Diagnose preflight, solver execution, and result persistence separately](<https://phynitelab.com/docs/guide/diagrams/failure-stages-en-light.png>)

Concept diagram: investigate the first failing stage before retrying.

| State | Meaning | Next action |
| --- | --- | --- |
| Draft / Ready | Configuration exists; no active solver is implied. | Review input and run when ready. |
| Queued | Waiting for a worker or a dependency. | Check the selected destination, its connection, and prerequisite jobs. |
| Running | The worker has claimed the job. | Inspect stage, log tail, and resource details; allow time for expensive stages. |
| Completed | The required result was saved and accepted locally or by the hosted service. | Inspect convergence and scientific validity, then open results. |
| Failed | Preparation, execution, local persistence, or hosted upload failed. | Read the reason and solver log before retrying. |
| Cancellation requested | A running job is being asked to stop. | Wait for the worker heartbeat and terminal status. |
| Cancelled | The run was stopped or removed from the queue. | Retain useful logs; start a new run if needed. |

<a id="docs-execution-2"></a>

### What cores and RAM mean

Recorded cores are allocated vCPUs or worker processes, and RAM is the configured job budget. These are different from actual utilization or installed physical memory. A native memory watchdog is a monitored budget, not an operating-system hard limit.

Expand resource details in the execution log to inspect reported backend allocation, elapsed time, MPI processes, and QE memory or timing estimates when available. Missing historical data is shown as not reported.

Native jobs follow the local scheduler capacity configured in Settings → Compute. Hosted personal workers also follow service-side job limits. Unsupported requests are rejected instead of silently changing scientific inputs.

<a id="docs-execution-3"></a>

### Cancel intentionally

- A queued local job can be removed from the queue.
- Cancellation is asynchronous. The local process supervisor or hosted worker acknowledges it before the job reaches a final state.
- Closing the browser does not cancel a submitted calculation. Keep the native CLI or hosted worker running; inspect interrupted jobs after a restart rather than resubmitting blindly.
- Disconnecting a personal credential revokes access and may interrupt upload; use the calculation cancellation action before replacing a credential during an active run.

<a id="docs-execution-4"></a>

### Related topics

- [Choose and connect calculations](<#calculation>)
- [Configure and validate Quantum ESPRESSO](<#configure>)
- [Tutorial: a first silicon calculation](<#quickstart-silicon>)

<a id="quickstart-md"></a>

## Tutorial: a first local MD simulation

Use a small argon system to learn the structure-to-settings-to-execution-to-result path in MD Lab. This is a workflow exercise, not a validated physical study.

<a id="docs-quickstart-md-1"></a>

### Prepare your computer and structure

1. In the npm app, install MD/analysis in Settings → Compute and keep the CLI running; no Phynite login is required. The hosted website instead needs a signed-in account and a connected personal worker.
2. Open MD Lab and create a project named Argon equilibration.
3. Import or build a small argon structure with a physically suitable periodic box. Check atom count, element identity, coordinates, box lengths, units, and atomic masses. An XYZ with Ar species or a LAMMPS data file with Masses works; a type-only dump has no mass for dynamics.
4. Retain the original structure file and record its source. A visual repeat does not add atoms to the simulation.

<a id="docs-quickstart-md-2"></a>

### Review the simulation

![Simple guided MD stage configuration](<https://phynitelab.com/docs/guide/md-guided-desktop-light.png>)

Review the physical model, stage duration, and output intervals.

1. Open the configuration drawer and choose Guided mode. Select the built-in Lennard-Jones model for Ar; do not use Generic parameters without recording their source.
2. Choose a short equilibration recipe. Inspect temperature, timestep, boundary conditions, random seed, unit system, potential parameters, and output interval.
3. Run browser preflight and read the generated LAMMPS input. Confirm it uses the intended structure and potential.

<a id="docs-quickstart-md-3"></a>

### Execute once and inspect

1. Select Your computer and submit one run. Follow Queued and Running in the job record and check the worker connection.
2. If the worker is offline, reconnect it and wait for the queued job; do not submit a duplicate.
3. After completion, open the log, thermo data, trajectory, and retained input from the project. Check for LAMMPS errors and inspect whether temperature and energy behavior support the intended equilibration.
4. Completed means the process finished; it does not validate the force field, timestep, equilibration, or scientific conclusion.

<a id="docs-quickstart-md-4"></a>

### Failure and recovery

- For Failed, inspect the first meaningful LAMMPS error and saved input before changing settings.
- For Cancelled, review the partial log and submit a new run only after the previous job reaches a final state.
- For a missing trajectory, check output settings and retained artifacts. An empty viewer is not a physical result.

> There is no universal target energy or temperature trace. Record the actual input, potential identity, run ID, and output before comparing systems.

<a id="docs-quickstart-md-5"></a>

### Related topics

- [MD workflows: Simple, Advanced, and trajectory analysis](<#md-workflows>)

<a id="md-workflows"></a>

## MD workflows: Simple, Advanced, and trajectory analysis

LAMMPS simulation changes the physical system; trajectory inspection and analysis measure retained frames. The current simulation editor labels Guided mode “Simple” and the manual/block editor “Advanced”. Keep the source, potential, units, and evidence explicit in both modes.

<a id="docs-md-workflows-1"></a>

### Prerequisites and source mapping

- Install MD/analysis in Settings → Compute and verify the required LAMMPS/analysis capabilities and native isolation. MD uses Your computer in the current workflow.
- Use a structure or trajectory with a valid simulation cell, known coordinates, particle identities, and masses. A type-only dump is not enough to infer chemical elements or masses.
- Map every particle type before choosing a force field. Check that uploaded potential assets support all elements, the selected atom style, and the expected unit system.
- Pause trajectory playback and finish frame analysis before submitting a simulation. Retain the original trajectory and model citation; a successful integrity/runtime check does not establish physical accuracy.

<a id="docs-md-workflows-2"></a>

### Build a Simple simulation stage

![Simple MD configuration](<https://phynitelab.com/docs/guide/md-guided-desktop-light.png>)

Simple is the guided workflow in the current interface.

1. Add an MD simulation module to the project and connect its structure, or open Simulation in MD Lab. Add stage chooses a recipe; keep the initial exercise short.
2. Open the stage configuration and select Simple. Review the recipe, potential, periodic boundary condition, ensemble, timestep, total steps, temperatures, pressure controls where relevant, and random seed.
3. Inspect Output & Trajectory. Thermo interval and Trajectory interval are step counts, so choose intervals that produce useful data within the planned duration without excessive disk use.
4. Choose Inspect in.lammps. Verify the complete generated input, source and potential mapping, fixed timestep, stage order, and output commands. Save to library stores a reusable setup; it does not execute the solver.
5. Choose Run step for one stage, or review Run selected/Run all for the intended ordered chain. Review the compute allocation and submit once.

| UI quantity | Displayed unit | Interpretation |
| --- | --- | --- |
| Timestep | fs | The generated metal-unit input converts this to ps. Retain the fixed timestep and stage durations. |
| Temperature / damping | K / ps | Temperature and thermostat relaxation time are different controls. |
| Pressure / damping | bar / ps | Check the ensemble and periodic directions before pressure coupling. |
| LJ epsilon / sigma / cutoff | eV / Å / Å | Model parameters must match the intended species and physical study. |
| Strain rate / safety limit | s⁻¹ / ratio | A rate and total duration imply a planned strain; the safety limit is not a target unit conversion. |

<a id="docs-md-workflows-3"></a>

### Advanced: Blocks and Expert input

![Advanced MD blocks and manual input](<https://phynitelab.com/docs/guide/md-manual-desktop-light.png>)

Advanced retains managed input validation and isolation requirements.

Advanced is a managed LAMMPS workflow, not an unrestricted shell or a full standalone input file. Phynite owns source loading, units, boundary, masses, force field, clock, and output paths. External execution, include/jump, arbitrary file paths, nested commands, and unmanaged output are rejected. Keep fixed timesteps per stage; adaptive timestep commands are not supported by the retained physical-time contract.

1. Switch to Advanced. Blocks opens a Command library and an ordered Simulation commands rack. Add a supported block, edit its values, and review its command preview.
2. Use the block On/Off control, arrows or drag handle to establish the execution order. Disabled blocks remain stored but are omitted from generated input.
3. Open Expert to inspect the compiled commands. Editing the raw text creates an override that controls that stage even if the block rack is later changed. Regenerate from Blocks removes that override explicitly.
4. Read browser validation before submission, then inspect in.lammps again. Manual commands must contain run or minimize and pass the native runtime validation and isolation probe.

> The npm app uses verified native isolation without Docker. Hosted personal workers have a separate runtime path. Follow Settings → Compute for the app you are actually running.

<a id="docs-md-workflows-4"></a>

### Analyze retained frames

![MD analysis controls for retained trajectory data](<https://phynitelab.com/docs/guide/md-analysis-desktop-light.png>)

Review source frames and analysis parameters before running.

1. Open the completed simulation’s Execution result and choose Inspect trajectory when a retained trajectory is available. Alternatively, import a known trajectory and preserve its original file.
2. In a project workflow, connect a trajectory to an MD analysis module. Choose Analysis: Radial distribution function, Common neighbor analysis, Polyhedral template matching, or Coordination number.
3. Set the cutoff in Å where applicable and choose Start frame and Frame stride. Review run includes the actual source and analysis settings. MD Lab also offers a modifier pipeline; preserve modifier order when comparing results.
4. Inspect the output table, distribution, structural classification, or retained analysis artifacts. Source time remains unknown if it was not declared; frame number alone is not elapsed physical time.
5. Export the original numerical data and configuration along with any figure. Keep units, frame selection, cutoff, and potential identity in the method notes.

- [LAMMPS documentation](<https://docs.lammps.org/>)
- [OVITO manual](<https://www.ovito.org/docs/>)
- [Scientific figures](<#figures>)

<a id="docs-md-workflows-5"></a>

### Read the result and recover safely

| Observation | What to check |
| --- | --- |
| Configuration ready | The current browser fields pass validation. Runtime, potential, and isolation still need successful execution checks. |
| Run remains queued | Worker readiness, earlier stages, resource capacity, and active jobs. Do not submit duplicates. |
| LAMMPS exits or reports lost atoms | Read the first meaningful log error; inspect geometry, boundary, force field, timestep, neighbor settings, and resources before changing a parameter. |
| No trajectory or metric is available | Check retained artifacts and output intervals. Missing data is not zero and an empty view is not a physical result. |
| Cancelled or interrupted | Wait for a final state, retain partial logs, and review the saved result before a new run. Recovery is offered only when verified saved output exists. |

> Completed confirms process/result handling, not equilibration, force-field validity, timestep convergence, or a publication-ready conclusion. No universal target energy is assumed for the demo.

<a id="docs-md-workflows-6"></a>

### Related topics

- [Tutorial: a first local MD simulation](<#quickstart-md>)

<a id="ai-providers"></a>

## AI provider connections on your computer

Local AI uses the provider CLI you choose. It is independent from Phynite Cloud login and does not use a hosted Phynite AI service.

<a id="docs-ai-providers-1"></a>

### Connect an account

![Local AI provider connection settings](<https://phynitelab.com/docs/guide/ai-provider-accounts-desktop-light.png>)

Signed-out demo: complete the official provider flow on your computer. No account or quota is simulated.

![Codex provider icon](<https://phynitelab.com/brand/ai/codex.png>)

Connect through the provider CLI you already use.

![Antigravity provider icon](<https://phynitelab.com/brand/ai/antigravity.png>)

Provider authentication stays with the official local CLI.

1. Install and authenticate the official provider CLI on this computer.
2. Open Settings → AI provider accounts and choose Codex or Antigravity.
3. Complete authentication through the provider’s own flow. An existing supported CLI login can be reused without importing its cookie or session files.
4. Keep the application open while model discovery and the capability probe run. The page selects only models that pass the supported text, streaming, and tool checks.

- [AI provider settings](<https://phynitelab.com/account/ai-providers>)

<a id="docs-ai-providers-2"></a>

### Provider, model, and limits

The local app uses the single signed-in profile managed by the official provider CLI. A failed or rate-limited request never silently changes provider or account.

Usage cards show only telemetry reported by the provider: model group, session or weekly percentage, window, and reset time when available. A missing report stays unavailable; the app never invents token counts, balances, or reset dates.

Model availability can change with the provider entitlement. Cloud model settings do not control local provider accounts.

<a id="docs-ai-providers-3"></a>

### Security and unsupported states

- Provider credentials stay in the provider-managed CLI or local credential store and are kept out of browser storage, logs, project archives, and Cloud Sync. The local app does not accept a gateway URL or gateway token.
- The local bridge runs on loopback with shell, MCP, plugin, browser, and unverified network actions disabled. Canvas changes still require the existing approval and validation flow.
- If authentication, discovery, streaming, or tool verification fails, the provider remains visibly disconnected or unavailable until you fix it. There is no automatic provider fallback.
- AI provider access is separate from scientific runtime installation and separate from Phynite Cloud login.

<a id="docs-ai-providers-4"></a>

### Related topics

- [Phynite Cloud, Cloud Sync, and online compute](<#cloud-sync>)

<a id="cloud-sync"></a>

## Phynite Cloud, Cloud Sync, and online compute

Cloud services are optional connections layered on top of a complete local workspace. Signing in does not upload a local project or replace its local identity.

<a id="docs-cloud-sync-1"></a>

### Local, Cloud Sync, and cloud compute

![Local workspace, project Cloud Sync, and cloud compute data boundaries](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-en-light.png>)

Concept diagram: login, project sync, and job transfer are separate choices.

| Choice | What happens |
| --- | --- |
| Local only | Project, inputs, results, and runtime data remain on the selected computer. No Cloud login is required. |
| Cloud login | Enables account features; local projects remain local until a project action enables sync. |
| Cloud Sync | Enabled per project after reviewing scope, size, and quota. Syncs approved project revisions and artifacts. |
| Run on cloud | Uploads only the reviewed job inputs/dependencies, creates a separate cloud execution, and downloads verified results. It does not enable project sync. |

<a id="docs-cloud-sync-2"></a>

### Sync lifecycle and conflicts

![Optional Phynite Cloud sign-in](<https://phynitelab.com/docs/guide/cloud-account-desktop-light.png>)

Signed-out demo. Login does not enable project sync.

1. Sign in from Settings → Account and keep the local workspace identity unchanged.
2. Open the project sync control, review the files, size, quota, and retention shown, then enable Cloud Sync explicitly.
3. Let the persistent outbox finish. Interrupted transfers resume with checksums; a cloud revision is published only after its snapshot artifacts are verified.
4. If another device changed the project, compare local and cloud revisions before choosing use local, use cloud, or save as a copy.
5. Use Trash for cloud deletion. A tombstone and retention window protect the cloud copy; disabling sync keeps local and cloud copies, and logout stops sync without deleting local data.

<a id="docs-cloud-sync-3"></a>

### Account boundaries and billing

Sync queues and account mappings belong to the signed-in Cloud account. Switching accounts does not continue uploads created by another account.

Cloud quota, artifact retention, Trash, and the hosted Free allowance are separate from local disk space. Billing and plan changes are available on the hosted website; a purchase does not start a job automatically.

MD Cloud is unavailable until a supported service is shown in the current catalog. Do not infer availability from a local MD runtime.

- [Cloud account settings](<https://phynitelab.com/account/account>)
- [Usage and quota](<https://phynitelab.com/account/usage>)
- [Hosted billing](<https://phynitelab.com/billing>)

<a id="docs-cloud-sync-4"></a>

### Related topics

- [Autosave, storage, and multiple devices](<#saving>)
- [Settings, accounts, profile, and usage](<#account>)
- [Manage plans, billing, and resource usage](<#billing>)

<a id="account"></a>

## Settings, accounts, profile, and usage

Settings separates browser preferences, scientific compute, AI provider accounts, and optional Phynite Cloud login. Usage is based on actual execution/provider records; missing measurements are never invented.

<a id="docs-account-1"></a>

### Find the right settings page

![Cloud account settings without a signed-in profile](<https://phynitelab.com/docs/guide/cloud-account-desktop-light.png>)

A profile appears only after Cloud authentication.

| Page | What it controls |
| --- | --- |
| Appearance & language | Theme, accent, density, interface/code text size, reduced motion, and language in this browser. |
| Keyboard shortcuts | Supported application bindings, stored in this browser. |
| Notifications | Local job/runtime alerts and desktop permission; hosted delivery preferences on the website. |
| Compute | Native runtime installation and local CPU/RAM/concurrency; hosted worker and compute defaults on the website. |
| AI provider accounts | Your own AI logins, active account, connection/model readiness, reported limits and reset windows. |
| Account | Optional Phynite Cloud login/logout and per-project sync; independent from AI login. |
| Usage / Storage | Recorded job measurements and provider usage / project archives and storage inventory. |
| Research profile / Privacy & session | Connected Phynite identity / mode-specific privacy and session controls. |

<a id="docs-account-2"></a>

### Navigate without duplicate menus

Settings has one category sidebar and search. Account follows AI provider accounts. On mobile, open the navigation drawer and use Escape, the close control, or backdrop to dismiss it. The account menu supports keyboard navigation. Legacy Local runtime & cloud bookmarks redirect to the appropriate category instead of opening another settings shell.

An unsigned local workspace shows settings and connection actions, without a fabricated user profile. Once a Phynite account is connected, Profile opens a dedicated profile page with an Edit profile action.

<a id="docs-account-3"></a>

### Edit a connected research profile

1. Connect your Phynite Cloud account before opening Profile; local projects remain available without that login.
2. Choose Edit profile and set display name, institution, role, and research area.
3. Choose a JPG, PNG, or WebP photo up to 20 MB. Crop, zoom, and rotate it; the browser saves a compressed 256-pixel image.
4. Review the preview and choose Save profile. Removing a photo applies after saving. Unsaved account drafts require a decision before navigation.
5. Use Appearance & language for device appearance. Those choices apply immediately and do not become cloud account defaults.

<a id="docs-account-4"></a>

### Set a cloud sign-in username

1. Create a Phynite Cloud account with email and confirm the email first, where registration is available.
2. Open the research-profile editor. Display name can include spaces and need not be unique.
3. In Username, enter 3–30 characters, starting with a letter or number. Letters, digits, periods, hyphens, and underscores are supported; reserved names cannot be claimed.
4. Choose Save username. This is separate from saving research identity; uniqueness is checked without case sensitivity.
5. Next time, use either username or email with the same password. After changing a username, the old name stops working and may become available to someone else. Recovery uses the verified email.

> A username does not create another account, share projects, or change email. Native local work does not require a sign-in username.

<a id="docs-account-5"></a>

### Configure compute where it runs

In the local npm app, Compute includes platform/capability detection, scientific-runtime installation, isolation status, and CPU/RAM/parallel-job defaults. Install the runtime before running. New defaults affect future jobs; workspace overrides apply only to the selected run. Native local compute needs neither Docker nor a cloud-paired worker.

On the hosted website, Compute retains account defaults for each workload, supported Cloud profiles and estimates, and personal-worker pairing. Save defaults is explicit; Cancel restores saved values. MD stays on personal compute until its Cloud service is available. More cores are not necessarily faster; compare short controlled runs.

<a id="docs-account-6"></a>

### Connect AI and read limits

AI provider connections use the official Codex or Antigravity CLI with your own account. They are independent from Phynite Cloud login. After authentication, model discovery and capability checks run automatically. Tools and attachments require verified support, and Canvas changes retain approval/validation rules. The local app keeps one CLI-managed connection per provider; it has no account switcher or local gateway setup.

The local app uses the profile managed by the selected official CLI. Usage and reset information comes from the provider: percentages, windows, and dates are shown only when reported. No remaining token balance is inferred. A disconnected, rate-limited, or unsupported provider shows its actual state without silent provider switching.

<a id="docs-account-7"></a>

### Notifications on this device

Choose completed-job, failed/cancelled-job, and runtime-installation alerts separately. Local alerts observe real state changes while the app is open. Desktop alerts are optional, require browser permission, and can be checked with Send test notification.

These local preferences stay in this browser. They do not schedule background cloud push or email when the app is closed. Hosted email and inbox delivery settings are separate.

<a id="docs-account-8"></a>

### Read usage correctly

| Metric | Interpretation |
| --- | --- |
| Recorded run time | Valid recorded start-to-completion intervals; failed/cancelled runs count when both timestamps exist. Setup and result persistence/upload may be included. |
| Allocated CPU-hours | Recorded seconds × allocated cores / 3600. This is allocation, not actual CPU activity or energy use. |
| Local files / cloud files | Different storage inventories. Cloud object measurement excludes the native disk; local storage is not a cloud subscription. |
| Unmeasured runs | Records with missing/invalid timing or allocation remain unavailable or partial, never assumed to be zero. |
| AI limits and reset | The selected provider account’s reported measurements; independent from scientific CPU-hours and Phynite billing. |

<a id="docs-account-9"></a>

### History and portable copies

Usage lists recorded jobs and receipts with their timestamp, status, destination, and available allocation. Pagination changes the visible rows; account-wide totals still describe all measured records. Refresh updates the measurement.

Storage contains native project archive export/import. Keep original structures, executed inputs, available results, provenance, checksums, and independent backups. Respect licenses on potential assets. Browser drafts are recoverable aids rather than the native database.

<a id="docs-account-10"></a>

### Optional Cloud and website billing

Account connects or disconnects Phynite Cloud. Login preserves local identity and does not upload projects. Enable Cloud Sync per project only after reviewing transfer scope; cloud compute has a separate input-transfer review and does not enable sync. Logout keeps local data and stops sync.

Billing in local mode opens https://phynitelab.com/billing. Cloud access, price, quota, and capacity come from the current hosted catalog and account. A purchase never starts a job automatically. MD Cloud remains unavailable until its service is supported.

> Local execution uses your hardware, electricity, and disk. Once runtimes and required potentials are installed, local science can run offline. Provider AI, optional Cloud, external data lookup, and new downloads require their respective connections.

<a id="docs-account-11"></a>

### Related topics

- [Autosave, storage, and multiple devices](<#saving>)
- [Manage plans, billing, and resource usage](<#billing>)
- [Phynite Cloud, Cloud Sync, and online compute](<#cloud-sync>)

<a id="saving"></a>

## Autosave, storage, and multiple devices

DFT Lab and Figure Lab show save status for the active context. The npm app stores projects in SQLite/filesystem; browser storage holds recoverable drafts. Local projects do not upload automatically and have no fixed 10 GiB quota. The cloud save states below apply to the hosted website or a project with explicitly enabled Cloud Sync.

<a id="docs-saving-1"></a>

### Save states

![Project inventory, files outside inventory, and independent backup](<https://phynitelab.com/docs/guide/diagrams/storage-layers-en-light.png>)

Concept diagram: project inventory is only part of disk usage.

| Label | Meaning | What to do |
| --- | --- | --- |
| Saving... | A local draft or cloud synchronization is in progress. | Keep working; allow a short pause before relying on another device. |
| Saved to cloud | The current figure and its required datasets, or workspace snapshot, are confirmed remotely. | You can reopen the saved work with the same account. |
| Saved on device / Offline | A browser copy exists; cloud upload has not completed. | Keep browser data intact and reconnect. |
| Sync pending | The local copy is retained while upload retries. | Check network access and storage limits. |
| Sync conflict | The remote revision differs from the one being edited. | Review the versions in History; avoid blindly overwriting another device. |

<a id="docs-saving-2"></a>

### Local storage and research archives

The local workspace defaults to ~/.phynite-lab and can be moved with phynite-lab --data-dir /path/to/workspace. SQLite stores metadata while the filesystem stores project artifacts. Settings → Storage measures inventoried project artifacts only; database metadata, solver/runtime installations, logs, browser cache, and unrelated files on the disk are excluded.

Local mode is limited by free disk space, not a hosted 10 GiB allowance, and local artifacts do not receive an automatic seven-day cleanup. Runtime installers and logs still consume disk. Export/import project archives and keep an independent backup for important work.

| Counted by local Storage | Not counted by local Storage |
| --- | --- |
| Inventoried structures, inputs, configurations, completed results, trajectories, and exported project artifacts. | SQLite metadata, solver/runtime installations, logs, browser cache, and unrelated disk files. |
| Large intermediate state when it is retained as a project artifact. | Operating-system free space or data owned by another application. |

- [Storage settings](<https://phynitelab.com/account/storage>)

<a id="docs-saving-3"></a>

### Quantum ESPRESSO intermediate data

QE disk_io choices and intermediate output can grow far beyond the final result. Wavefunction/tmp data may be needed for bands, DOS, phonon, projected workflows, or external interoperability; do not remove it until downstream workflows finish. Keep the exact input, pseudopotential identity and checksum, provenance, and state artifacts together.

Wannier90 is an external/manual workflow unless a separately documented native integration is available. Follow the official Quantum ESPRESSO and Wannier90 documentation; this guide does not claim a native Wannier90 runner.

- [Quantum ESPRESSO documentation](<https://www.quantum-espresso.org/documentation/>)
- [Wannier90 documentation](<https://wannier.org/documentation/>)

<a id="docs-saving-4"></a>

### Hosted Figure Lab autosave behavior

Figure Lab saves a local draft after approximately 350 ms without a new edit and starts cloud synchronization after approximately 1.2 seconds. Active uploads are serialized; an edit during upload is saved next.

Leaving Figure Lab flushes pending draft edits. Online and focus events help retry pending cloud saves. A failed save remains visible instead of being labeled successful.

There is no required Save revision button. Ctrl/Cmd+S is an optional explicit history checkpoint.

<a id="docs-saving-5"></a>

### Document limits and hosted storage history

| Resource | Current limit |
| --- | --- |
| Workspace snapshot | 4.5 MB per saved workspace snapshot. |
| Research document | 4 MB per dataset, figure, or template document. |
| Dataset samples | 250,000 points per dataset. |
| Figure composition | 64 panels; 32 layers per panel. |
| Figure checkpoints | 100 explicit revisions plus the current automatic working copy. |
| Figure Lab allowance | Shares the total cloud allowance: 10 GiB Free, or the active paid account capacity. Retained revisions and upload reservations count. |
| Data-file import | 20 MB input-file limit; resulting documents must still meet their own limits. |
| Source package | 200 MB package/selected expanded JSON limit, plus individual document limits. |

<a id="docs-saving-6"></a>

### Keep a portable copy

- Export a Source package for important figures and project archives for local studies.
- Retain original structure files, executed calculation inputs, pseudopotential identity/checksum, provenance, and any intermediate state needed by a downstream workflow.
- Browser storage has its own device quota and can be removed by clearing site data.
- An archive still occupies storage; it is intended for organization, not deletion.
- Account storage shows current cloud objects separately from the research-document allowance. Cloud login does not upload a local project; Cloud Sync is enabled per project.

<a id="docs-saving-7"></a>

### Related topics

- [Settings, accounts, profile, and usage](<#account>)
- [Manage plans, billing, and resource usage](<#billing>)
- [Phynite Cloud, Cloud Sync, and online compute](<#cloud-sync>)

<a id="billing"></a>

## Manage plans, billing, and resource usage

Billing manages Phynite Cloud purchases and invoices on the hosted website. The local app opens https://phynitelab.com/billing; local compute, AI accounts, and device preferences are managed separately in Settings.

<a id="docs-billing-1"></a>

### Review your account

![Local workspace, project Cloud Sync, and cloud compute data boundaries](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-en-light.png>)

Concept diagram: login, project sync, and job transfer are separate choices.

1. Open Billing on the Phynite website. From the local application, the link opens https://phynitelab.com/billing.
2. Read the active plan, subscription status, and per-run allocation. These values come from your account.
3. Open Recorded usage and choose Refresh after a calculation finishes or cloud files change.
4. Review Figure Lab retained bytes and current cloud files. Paid storage shares one total allowance across cloud files and pending uploads.
5. Choose Export usage to download a dated JSON record. The export contains resource measurements, not a payment receipt.

<a id="docs-billing-2"></a>

### Plan actions

| Plan | Action | Effect |
| --- | --- | --- |
| Free | Use Free | Includes local DFT and MD runs. The npm app uses native runtimes without login; the hosted website uses a connected personal worker. |
| Cloud | Top up Quanta | Early-access accounts use verified production credit; public visitors stay on the waitlist. Payment never starts a job. |
| Enterprise | Discuss requirements | Opens the contact route for institutional capacity and terms. |

<a id="docs-billing-3"></a>

### Interpret time and storage

Paid usage lists each resource profile, measured solver/analysis time, actual Quanta charge and refund, with total, reserved and available credit shown separately. Recorded run time sums valid worker-start-to-completion intervals. It can include setup and result upload, as well as failed or cancelled runs that have valid timing.

Allocated CPU-hours multiply recorded duration by allocated cores. They do not measure CPU utilization, electricity consumption, or a tariff.

Current cloud storage counts current object versions. Older versions, metadata records, and your local disk are outside that number. A plus sign means the inventory reached its object limit and the displayed size is a lower bound.

The Figure Lab allowance counts retained datasets, figure documents, templates, and revisions. Archiving a figure does not remove those records or free that allowance.

<a id="docs-billing-4"></a>

### Payments and invoices

Billing opens Phynite checkout at /billing/checkout after merchant activation. Choose Direct Virtual Account or QRIS when available; DOKU processes the payment. Virtual Account adds Rp4,000; QRIS has no surcharge. Quanta sells at Rp18,000 per Quanta, starting at 0.5 Quanta (Rp9,000 base, Rp13,000 via VA). /billing/payments/[id] shows instructions and verified status; /billing/history lists 20 purchases per page with status filters. Existing hosted invoices retain their original amounts. Order creation, verified fulfillment, failed attempts and confirmed expiry create inbox notifications; transactional emails are enabled only after SES verification, from and reply-to support@phynitelab.com. Email failures do not cancel payments. The page does not collect card numbers. Tax invoice issuing is not connected.

Early-access accounts can use the Cloud workflows available in the current catalog after a verified production top-up, according to balance and capacity. MD stays on personal compute until its Cloud service is supported. Pilot remains controlled by admin grants. Institution capacity follows agreed terms. Local compute is free, but your hardware, internet, storage, and electricity remain your responsibility.

> Usage exports can contain calculation names and identifiers. Share them only with the intended collaborator or support contact.

<a id="docs-billing-5"></a>

### Related topics

- [Autosave, storage, and multiple devices](<#saving>)
- [Settings, accounts, profile, and usage](<#account>)
- [Phynite Cloud, Cloud Sync, and online compute](<#cloud-sync>)

<a id="storage-backup"></a>

## Storage, export, backup, and large QE state

Local storage is the disk available to the selected workspace. Cloud storage is an account service with its own quota and retention policy.

<a id="docs-storage-backup-1"></a>

### What local Storage measures

![Project inventory, files outside inventory, and independent backup](<https://phynitelab.com/docs/guide/diagrams/storage-layers-en-light.png>)

Concept diagram: project inventory is only part of disk usage.

The default data directory is ~/.phynite-lab. Use --data-dir when a larger or separate disk is appropriate. Local mode has no fixed 10 GiB quota and does not automatically delete artifacts after seven days; free disk space is the practical limit.

| Counted | Outside the project inventory |
| --- | --- |
| Inventoried structures, inputs, configurations, completed results, trajectories, and project archives. | SQLite metadata, installed solver/runtime files, worker logs, browser cache, and unrelated files on the disk. |
| Intermediate state retained as a project artifact. | Operating-system free space and other applications’ data. |

<a id="docs-storage-backup-2"></a>

### QE intermediate files and wavefunctions

- disk_io settings and temporary state can be much larger than the final SCF summary.
- Wavefunction and tmp data may be required for bands, DOS, phonons, projected workflows, checkpoints, or external interoperability.
- Do not remove intermediate state until every downstream workflow finishes. Keep the exact input, pseudopotential identity and checksum, provenance, and state artifacts together.
- Wannier90 is an external/manual workflow unless a separately documented native integration is available; follow its official handoff requirements.

- [Quantum ESPRESSO documentation](<https://www.quantum-espresso.org/documentation/>)
- [Wannier90 documentation](<https://wannier.org/documentation/>)

<a id="docs-storage-backup-3"></a>

### Export, import, and backup

![Storage inventory and project archives](<https://phynitelab.com/docs/guide/storage-archives-desktop-light.png>)

Export important projects and verify a separate backup.

1. Export the project archive from Settings → Storage before moving a workspace or making a destructive change.
2. Keep a second backup outside ~/.phynite-lab, including exact inputs, potential identities/checksums, provenance, and intermediate state needed by downstream work.
3. Import into a new data directory first and verify structures, configurations, results, and checksums before replacing the working copy.
4. Use Source package export for figures; it does not replace the project archive or solver runtime backup.

- [Storage settings](<https://phynitelab.com/account/storage>)

<a id="docs-storage-backup-4"></a>

### Related topics



<a id="settings-reference"></a>

## Settings, preferences, profile, and usage

Settings separates device preferences, scientific compute, AI provider accounts, Cloud account state, usage, storage, and privacy.

<a id="docs-settings-reference-1"></a>

### Choose the right page

![Appearance and language preferences](<https://phynitelab.com/docs/guide/appearance-settings-desktop-light.png>)

Device preferences are separate from Cloud account settings.

| Page | Purpose | Where it is stored |
| --- | --- | --- |
| Appearance & language | Theme, accent, density, text size, reduced motion, and language. | This browser/device. |
| Keyboard shortcuts | Supported application bindings. | This browser/device. |
| Notifications | Job/runtime alerts and desktop permission. | This browser/device; hosted delivery follows account state. |
| Compute | Runtime installation, isolation probe, CPU/RAM/job defaults, and cloud transfer settings. | Local workspace or Cloud account, depending on control. |
| AI provider accounts | Provider login, model readiness, limits, and reset. | Provider CLI/local credential store. |
| Account | Optional Phynite Cloud login/logout and per-project sync. | Cloud account; local data remains local. |
| Profile | Research identity shown after Cloud login. | Cloud account. |
| Usage | Recorded scientific jobs and provider-reported AI usage. | Actual execution/provider records. |
| Storage / Privacy | Project inventory, archives, session, and local data boundaries. | Local workspace and browser. |

<a id="docs-settings-reference-2"></a>

### Theme, notifications, and shortcuts

Appearance changes apply immediately and remain device-only unless the page explicitly offers a Cloud account default. Light, dark, system, accent, density, code text size, reduced motion, and language can be customized independently.

Notification preferences control local job/runtime alerts and browser permission. They do not create a Cloud session or upload project data.

Keyboard changes apply only to supported application bindings in the current browser. Native browser and operating-system shortcuts may still take precedence.

<a id="docs-settings-reference-3"></a>

### Profile and login visibility

A local workspace without Cloud login has no user profile. Connect a Cloud account before opening Profile; logout removes the profile controls while preserving local projects and identity.

AI provider login is independent from Cloud login. A provider account can be connected while Phynite Cloud remains signed out.

<a id="docs-settings-reference-4"></a>

### Related topics

- [Appearance, language, and accessibility](<#language>)

<a id="language"></a>

## Appearance, language, and accessibility

Settings → Appearance & language controls this browser. Theme, accent, density, text size, motion, and language apply immediately without changing your Phynite account or scientific inputs.

<a id="docs-language-1"></a>

### Choose appearance

![Language control in Appearance settings](<https://phynitelab.com/docs/guide/appearance-settings-desktop-light.png>)

Interface language changes labels, not scientific data or units.

1. Choose System, Light, or Dark for this browser. System follows the OS color scheme; optional custom background/text colors require at least 4.5:1 contrast.
2. Select the available accent and comfortable/compact density, and adjust interface and code text sizes within the shown ranges.
3. Enable reduced motion when wanted. Restore defaults resets the device controls.
4. These values stay in this browser and site origin. Another device, browser, or local port can use different choices; clearing site data resets them.

> Interface text scaling and theme do not change exported figure dimensions, plot samples, units, or solver settings.

<a id="docs-language-2"></a>

### Choose language

1. Open Settings → Appearance & language.
2. Choose English, Bahasa Indonesia, or automatic detection from browser preferences.
3. Open another page or reload to confirm the choice. The preference stays in this browser rather than a cloud account default.

<a id="docs-language-3"></a>

### Automatic language detection

An explicit choice takes priority. Automatic mode reads supported browser/device languages in preference order. The initial server response can also use the language header and, on the hosted site, an edge country hint. English is the fallback when no supported language is found.

Phynite does not request GPS or use a separate IP-location service to select language. A suggestion does not override an explicit choice. Different browsers may use different languages.

<a id="docs-language-4"></a>

### Scientific text and data

Solver keywords, chemical symbols, keyboard labels, numerical data, and user publication text are not translated into a different scientific meaning. QE and CSV retain their parser syntax.

English documentation uses /guide/topic and Indonesian documentation /id/guide/topic. Switching language preserves the active topic; downloads use the selected language.

<a id="docs-language-5"></a>

### Keyboard, notifications, and readability

- Tab moves among controls; the visible focus ring identifies the active control. Enter/Space activates a control and Escape closes supported menus/dialogs.
- Customize only the listed working application actions in Settings → Keyboard shortcuts. Editor-specific shortcuts keep their documented context and text fields keep native editing.
- Use Settings → Notifications for local job/runtime alerts and optional desktop permission. The app must remain open; local settings do not enable cloud email delivery.
- Documentation search uses Primary+K or / outside text fields. On mobile, open the table of contents only when needed.
- The reduced-motion device choice and supported operating-system motion preference reduce decorative transitions.

<a id="docs-language-6"></a>

### Related topics

- [Settings, preferences, profile, and usage](<#settings-reference>)

<a id="results"></a>

## Open and interpret calculation results

Use the log for execution evidence and downloads. Use Figure Lab for plot editing, comparisons, layout, and publication export.

<a id="docs-results-1"></a>

### Open a result directly

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

1. Find the completed run in Log.
2. Inspect its convergence message and recorded numerical summary.
3. Choose Open in Figure Lab when the result contains plottable data.
4. The most recently edited active figure using that run reopens. If none exists, Figure Lab imports the numerical source and prepares a figure.
5. If a retained source cannot be loaded, use Retry, check source availability, or import your original numerical file.

<a id="docs-results-2"></a>

### Distinguish numerical data from a preview

A PNG preview is a rendered image. Numerical datasets preserve samples and metadata that allow future restyling, alignment, and export.

New supported calculation outputs retain a compact research dataset separately from temporary raw-artifact access. Older runs without retained data may require original CSV/text files or a new run.

Hosted temporary artifact links can expire; storage lifecycle cleanup is configured separately. An expired link does not prove that a retained research dataset is lost. Native project data stays in the configured workspace; export important inputs and results independently.

<a id="docs-results-3"></a>

### Read physical claims carefully

- A band gap estimate requires meaningful occupations or an energy reference. Unknown reference data must not be treated as zero Fermi energy.
- DOS normalization must refer to the actual computational cell, atoms, formula units, or volume.
- Phonon imaginary frequencies can reflect an instability or incomplete convergence; inspect the model and method.
- Transport results depend on interpolation, sampling, temperature, chemical-potential conventions, and the relaxation-time model. Conductivity divided by relaxation time is not an absolute conductivity unless a justified time is supplied.

<a id="docs-results-4"></a>

### Related topics

- [Compose a figure](<#figures>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)
- [Workflows for material and parameter studies](<#studies>)

<a id="research-history"></a>

## Run history, research context, and evidence

Use Run history for execution attempts and cancellation. Use Research context for the project timeline, compact run ledger, recent comparison, and read-only AI context. These panels report retained evidence; they do not replace solver logs or scientific validation.

<a id="docs-research-history-1"></a>

### Find the record for the current project

![Project run history and recorded attempts](<https://phynitelab.com/docs/guide/run-history-desktop-light.png>)

Inspect the selected project and first recorded cause; no solver output is invented.

1. Open a project’s Canvas. Choose the clock/history icon labeled Run history to see runs, their creation times, per-module attempt states, and recorded errors.
2. Inspect a specific module’s Execution result for numerical summaries, Execution log, artifact downloads, and trajectory preview when available. An old execution can be marked Outdated after its current setup changes.
3. Use Cancel branch for an active module branch or Cancel run for an active workflow. Wait for the terminal state before resubmitting; a cancellation request is not yet a completed stop.
4. Choose the activity-line icon labeled Research context. Refresh research context reloads recorded evidence for this project.

<a id="docs-research-history-2"></a>

### Read the ledger, timeline, and latest summary

Run ledger shows up to the latest eight records with their names or kinds, timestamps, status, recorded failure category/reason, and input checksum where available. Timeline shows up to the latest eight recorded project events. Empty lists mean no evidence was returned, not that an unrecorded calculation succeeded.

Summarize latest run displays the latest record’s status and available result summary, checksum, allocated CPU/RAM, and whether provenance was recorded. Missing values remain unavailable. The compact summary is assembled from saved records; it is not a new AI calculation.

Allocated CPU and memory describe the job’s requested or effective budget. They are not measured CPU utilization or peak RAM. Use the actual execution record and logs for recorded timings and resource failures.

<a id="docs-research-history-3"></a>

### Compare recent runs without overinterpreting them

1. Complete at least two runs in the project. Compare recent runs remains disabled until two completed records are available.
2. Choose Compare recent runs. The current compact comparison selects the two most recent completed runs and displays status, input checksum, and completion time.
3. Open the original input and result artifacts before comparing energies, convergence, trajectories, or runtimes. The panel does not automatically prove equal structures, force fields, pseudopotentials, normalization, or physical conditions.
4. For a scientific overlay or parameter series, prepare compatible numerical datasets in Figure Lab and record units and reference conventions. Use separate panels when the sources are not comparable.

> This is a recent-run metadata comparison, not an arbitrary multi-run plot or automatic convergence judgment. A different checksum signals different recorded input bytes; the same checksum alone is not proof of identical execution conditions.

- [Plan a convergence study](<#convergence>)
- [Align scientific data](<#alignment>)

<a id="docs-research-history-4"></a>

### Give local AI traceable research context

Local AI means the connection and credential handling run on your computer. The selected provider can process the submitted prompt and context under its own service terms. Keep confidential research out of a provider request unless you intend to share it with that provider.

1. Connect an available local provider in Settings → AI provider accounts. Cloud login is not required for this connection.
2. In Research context, choose Add context to local AI. The project context appears as a read-only source in the AI workspace.
3. Ask a bounded question, such as identifying the latest failure or explaining a recorded input difference. Ask the response to cite the run or artifact it uses, then inspect that evidence yourself.
4. Review any proposed scientific change through the existing approval flow. Adding read-only evidence does not grant permission to edit a structure, execute a solver, or change a potential.

- [Provider login and unavailable models](<#ai-providers>)

<a id="docs-research-history-5"></a>

### Failure evidence, notifications, and team visibility

Enable local job/runtime alerts in Settings → Notifications to be informed of actual state changes while the app is open. An alert is a pointer to the saved record; keep the log and provenance before retrying.

| Signal | Interpretation |
| --- | --- |
| Preflight or setup rejection | Fix runtime, isolation, source, potential, or validation prerequisites before a new run. No solver log exists if the solver never started. |
| Solver, resource, or artifact failure | Read the recorded first cause and relevant log. A failure while saving artifacts does not imply the numerical process never ran. |
| Recover saved result appears | The local app found recoverable output. The action verifies and imports saved results; it does not rerun the solver. |
| Local context only | No project sync is enabled. Signing in to Cloud alone does not publish this project. |
| Team visibility enabled | The project already has approved Cloud Sync scope and a reported revision. The panel does not create sharing permissions or upload additional files. |

- [Find the failing workflow stage](<#diagnostics>)
- [Cloud scope, conflicts, and account boundaries](<#cloud-sync>)

<a id="docs-research-history-6"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Compose a figure](<#figures>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)

<a id="figures"></a>

## Compose a figure

Figure Lab uses a results library on the left, the publication page in the center, and an inspector on the right. On smaller screens, Results and Inspector become drawers.

<a id="docs-figures-1"></a>

### Choose a layout

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

| Layout | Best use | Check |
| --- | --- | --- |
| Single plot | One result, one message. | Quantity, axes, units, and title. |
| Overlay | Several curves sharing a comparable physical coordinate. | Path compatibility, alignment, normalization, and readable legends. |
| One panel per result | Different materials or results needing independent panels. | Consistent dimensions and a fair common range where justified. |
| Band + DOS pairs | Dispersion beside corresponding density of states. | Matching geometry/electronic identity and energy convention. |
| Parameter series | Ordered strain, pressure, temperature, or other variants. | Matching parameter name and unit plus numerical values. |

<a id="docs-figures-2"></a>

### Build the page

1. Select completed results from the active project and import their numerical datasets.
2. Search the library and select the datasets you want to compare.
3. Choose a layout. A dataset can appear in multiple figures without changing its original samples.
4. Set figure width and height in millimeters. Choose a one-column or two-column size appropriate to the target journal.
5. Select a panel in the canvas or inspector. Adjust ranges, panel span, order, legend, and linked axes.
6. Use Data controls to name layers, choose channels, replace sources, and set colors and line styles.
7. Review scientific context notes, let the cloud save finish, then export.

<a id="docs-figures-3"></a>

### Canvas interaction

Use + and - to enlarge or reduce the page view; 0 or Fit returns it to the available canvas area. The zoom range is 25 to 400 percent relative to the fitted view.

Space+drag, Alt+drag, or middle-button drag pans an enlarged canvas. Ctrl/Cmd+wheel zooms. Clicking a plotted panel selects it for inspection.

Canvas zoom does not change the exported dimensions, axis limits, or numerical values. To change the plotted range, use panel minimum and maximum fields.

> Curve strokes and markers are clipped to the axis rectangle. A Γ label denotes the Brillouin-zone center; original source metadata is retained.

<a id="docs-figures-4"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)
- [Workflows for material and parameter studies](<#studies>)

<a id="alignment"></a>

## Energy, k-path, DOS, and fair comparison

A comparison can look tidy while mixing incompatible physical references. Establish the meaning of each axis before adjusting its appearance.

<a id="docs-alignment-1"></a>

### Energy alignment

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

| Mode | Meaning | Appropriate interpretation |
| --- | --- | --- |
| Source energy | Keep the numerical reference as imported. | Use only when source conventions are understood. |
| Each Fermi = 0 | Shift every dataset by its own recorded Fermi level. | Compare dispersion shapes relative to each electronic chemical potential; not absolute band offsets. |
| Each VBM = 0 | Shift by a recorded valence-band maximum. | Compare band-edge-relative features when the VBM is meaningful. |
| Vacuum alignment | Use a recorded vacuum reference. | A common-reference comparison when vacuum levels are physically justified. |
| Manual shift | Apply a stated explicit energy offset. | Use a documented alignment procedure and retain the chosen offset. |

<a id="docs-alignment-2"></a>

### Band + DOS

A verified pair requires matching recorded geometry and electronic source identity, along with compatible Fermi-relative data. A matching filename or material formula alone is insufficient.

The paired layout gives band and DOS panels a shared physical vertical energy axis, typically in a 2:1 width ratio. Adjusting a linked energy bound updates both panels.

Replacing one source with an unrelated calculation invalidates the verified-pair claim. Use ordinary comparison panels when sources are intentionally different.

<a id="docs-alignment-3"></a>

### K-path compatibility

The labels Γ, X, or K are not enough to establish the same reciprocal coordinate. Cell basis, path endpoints, and segment coordinates matter.

Physical path comparisons require compatible source geometry and coordinates. Segment normalization can align corresponding endpoints when the required metadata exists, but changes the displayed horizontal scale.

Disconnected branches must remain separated by gaps. Do not connect their endpoints into a fictitious continuous band.

<a id="docs-alignment-4"></a>

### DOS normalization and spin

- Per-cell DOS is the default meaning of many QE outputs. Do not silently label it per atom.
- Per-atom normalization needs a verified atom count; per-formula-unit normalization needs the formula-unit count; per-volume normalization needs a valid cell volume.
- Spin-down mirroring reflects a channel visually to distinguish it. It does not make physical DOS negative.
- Inspect whether a channel is total DOS, an orbital/atom projection, or an arbitrary imported column. Channel names should state the actual meaning.

<a id="docs-alignment-5"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Compose a figure](<#figures>)
- [Workflows for material and parameter studies](<#studies>)

<a id="studies"></a>

## Workflows for material and parameter studies

Choose a layout according to the scientific comparison, then reuse a stable style. Avoid forcing every result into one dense overlay.

<a id="docs-studies-1"></a>

### Several materials in one paper

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

1. Place the structures in one study project, with clear source names.
2. Use a method whose differences and approximations are documented consistently.
3. Run the appropriate band or DOS calculations for each material.
4. Use a grid for incompatible k-paths or very different energy scales. Use an overlay only when coordinates and references support it.
5. Name layers by material, use a small deliberate color set, and label energy references explicitly.
6. Save the layout as a template for subsequent materials.

<a id="docs-studies-2"></a>

### One material at several strains

1. Duplicate the baseline structure before applying each strain.
2. Record whether the strain is uniaxial, biaxial, volumetric, or another tensor deformation; a single percent label does not encode the full tensor.
3. Use consistent relaxation constraints and electronic settings across variants.
4. For each imported dataset, record the same condition parameter name and unit plus its numerical value.
5. Choose Parameter series to order panels numerically, including negative strain values.
6. Compare the relevant quantities using a justified energy reference and explain any path normalization.

<a id="docs-studies-3"></a>

### Band structure next to DOS

1. Use compatible geometry and electronic assumptions for the two calculations.
2. Load both numerical datasets in Figure Lab.
3. Choose Band + DOS pairs and inspect the compatibility notes.
4. Set a common vertical energy interval and verify the zero reference.
5. Tune line density and DOS horizontal range without distorting the shared energy scale.
6. Export a vector figure and retain its Source package.

<a id="docs-studies-4"></a>

### Convergence or temperature series

Use a generic numerical dataset for derived quantities such as energy per atom versus cutoff, or a quantity-specific transport dataset when available.

Record the parameter and unit explicitly. Keep error estimates and method assumptions in the caption or source metadata rather than implying precision from extra decimal places.

A figure template helps keep sizes and typography stable across the paper, while each dataset retains its own provenance.

<a id="docs-studies-5"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Compose a figure](<#figures>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)

<a id="reuse"></a>

## Templates, replacement, history, and archives

Reuse a visual method without losing the identity of the numerical sources. Templates describe a layout; figures bind that layout to concrete datasets.

<a id="docs-reuse-1"></a>

### Reuse a template

![Project inventory, files outside inventory, and independent backup](<https://phynitelab.com/docs/guide/diagrams/storage-layers-en-light.png>)

Concept diagram: project inventory is only part of disk usage.

1. Finish the layout, typography, panel arrangement, and layer style of an example figure.
2. Save it as a template. Source bindings become reusable slots.
3. Select replacement datasets in slot order and apply the template.
4. Inspect the rebound titles, quantities, and channel choices.
5. Edit custom captions explicitly; a template cannot know the new scientific conclusion.

<a id="docs-reuse-2"></a>

### Replace a dataset without starting over

Use Replace source on the selected layer. Color, line style, and compatible channel settings are preserved. Automatically generated titles follow the replacement; custom text remains editable.

Editing source metadata creates a new dataset identity. Existing figures retain their original source until you explicitly replace it.

An inset can reuse the same source slot with independent bounds. It does not require copying or resampling the raw data.

<a id="docs-reuse-3"></a>

### Undo, checkpoints, and cloud conflicts

- Undo/redo covers up to 50 editing steps in the current Figure Lab session.
- Routine edits save automatically; an optional Ctrl/Cmd+S keeps a deliberate checkpoint in History.
- Automatic edits replace a working copy instead of creating endless permanent revisions.
- History lets you inspect and restore saved versions. Restoration creates an editable current figure.
- If another tab or device changes the cloud revision, automatic overwrite stops. Review the local and cloud versions in History before choosing the intended one.

<a id="docs-reuse-4"></a>

### Archives and other projects

Archive hides a saved figure from the active list and allows Restore. Archiving is not deletion and does not free its retained history allowance.

Include other projects exposes your own datasets from other studies. It does not grant access to another account.

Importing a Source package copies the figure and its sources into the selected project, with source hashes checked where available.

<a id="docs-reuse-5"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Compose a figure](<#figures>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)

<a id="advanced"></a>

## PDOS, unfolding, and insets

Advanced imports expose the information actually present in the file. They do not infer a missing orbital identity, calculate unfolding from ordinary eigenvalues, or establish a physical reference automatically.

<a id="docs-advanced-1"></a>

### Projected DOS columns

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

Import a text or CSV file using Projected DOS columns. The first numerical column is energy and subsequent columns are projections. Name the channels by their true atom/orbital/spin identity.

Choose visible channels and style them in Data. Record the energy unit and reference, and use normalization only when the computational-cell basis is known.

```text
# energy_eV  site_1_s  site_1_p
-1.0  0.20  0.05
 0.0  0.00  0.00
 1.0  0.10  0.30
```

> These values illustrate the file shape; they are not scientific results.

<a id="docs-advanced-2"></a>

### Precomputed unfolded weights

Use an unfolded-data import for k coordinate, energy, and nonnegative spectral weight. The plot represents the supplied weights as weighted samples.

Ordinary band energies do not contain enough information to derive unfolding weights. Compute the spectral weights with an appropriate external method first.

```text
# k  energy_eV  weight
0.0 -1.0 0.10
0.0  1.0 0.95
1.0  0.5 0.40
```

<a id="docs-advanced-3"></a>

### Insets

1. Select a panel and enable an inset.
2. Choose the intended source and bounds for the magnified region.
3. Set its position and size so it does not cover important data or axis labels.
4. Check readability at final publication size, not only while zoomed in.
5. Keep the inset reference and units consistent with the main panel or explain the difference.

<a id="docs-advanced-4"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Compose a figure](<#figures>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)

<a id="export"></a>

## Export and preserve a reproducible figure

Set the intended physical size before exporting. A source package preserves numerical and visual provenance; a rendered image alone does not.

<a id="docs-export-1"></a>

### Choose an output

![Project inventory, files outside inventory, and independent backup](<https://phynitelab.com/docs/guide/diagrams/storage-layers-en-light.png>)

Concept diagram: project inventory is only part of disk usage.

| Format | Use | Properties |
| --- | --- | --- |
| SVG | Vector editing and web publication. | Vector paths; preserve the supplied font information. |
| PDF | Paper submission and document layout. | Vector output with selectable text and embedded publication fonts. |
| PNG | Raster workflows, slides, previews. | Pixel dimensions derive from physical millimeters and DPI; up to 40 megapixels. |
| Source package | Archive, handoff, and later re-editing. | Figure JSON, used datasets, SVG, font license, source identity, and checksums. |

<a id="docs-export-2"></a>

### Practical export checklist

1. Use the journal column width as the starting size; 85 mm and 180 mm are common examples, not universal requirements.
2. Set type in points and check axes, legends, and panel letters at final size.
3. Verify min/max bounds, clipping, units, Γ labels, and energy reference.
4. Choose SVG or PDF for line art when the target supports vector output.
5. For PNG, choose an appropriate DPI and inspect the resulting dimensions.
6. Download the Source package and retain it with executed inputs and method notes.

<a id="docs-export-3"></a>

### Fidelity and limitations

The renderer preserves all line vertices. Alignment, normalization, color, and mirrored spin display are transformations on the view, while original numerical samples remain in the dataset.

Publication fonts must be available from the frontend or browser cache. Export reports a failure when a required resource cannot be loaded; retry online.

A Source package can reproduce the figure. Rerunning a simulation also requires the computational environment, compatible pseudopotentials, complete inputs, and any required intermediate data.

<a id="docs-export-4"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Compose a figure](<#figures>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)

<a id="publication"></a>

## Procedure: prepare a publication figure

Prepare the scientific comparison first, then the page geometry, typography, and export. Keep the editable source with every figure you deliver.

<a id="docs-publication-1"></a>

### Check source compatibility

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

1. Open a completed result in Figure Lab or select retained datasets from the results library.
2. Read quantity, units, geometry identity, energy reference, and k-path metadata for each source.
3. Choose a grid for distinct k paths; use overlay only when coordinates and references are scientifically comparable.
4. For Band + DOS, confirm the pair describes compatible geometry and electronic assumptions. Review the linked energy range.
5. State the alignment convention. Each Fermi = 0 compares relative electronic structure and does not establish absolute band offsets.

<a id="docs-publication-2"></a>

### Set the page

| Control | Practical choice | Verification |
| --- | --- | --- |
| Width / height | Use the target journal dimensions | A column-width PDF viewed at 100% remains readable. |
| Typography | One publication font, restrained hierarchy | Axis labels, tick values, legends, and panel letters have distinct roles. |
| Line style | Use color plus dash or markers when needed | Curves remain distinguishable in grayscale and for common color-vision differences. |
| Bounds | Use explicit comparable bounds where justified | No data is hidden by an unexplained crop; curve strokes stay clipped inside the axes. |
| Legend | Material or condition names with units | Avoid run IDs as the sole scientific description. |
| Inset | A clearly located detail with explicit bounds | The reader can identify which source and region it represents. |

<a id="docs-publication-3"></a>

### Export and verify

1. Wait for Figure Lab to confirm the latest save. Native local work stays on this computer; another device needs a portable export or confirmed, explicitly enabled Cloud Sync.
2. Choose PDF or SVG for vector line art, or set physical size and DPI before exporting PNG.
3. Open the exported file in the application used for the manuscript. Inspect the final physical scale, Greek symbols, font rendering, panel labels, and clipped boundaries.
4. Export the Source package separately. Store it next to the figure and executed simulation inputs.
5. If you change a dataset or method, replace the source explicitly, review every legend and reference, and produce a new export.

<a id="docs-publication-4"></a>

### Caption recording template

This is a checklist for the author, not an automatically generated scientific claim. Include only information supported by the executed calculation and retained numerical sources.

```text
Quantity and material:
Structure source and cell:
Method, functional, pseudopotentials:
k/q sampling and numerical convergence:
Energy reference and normalization:
Parameter values and units:
Meaning of colors, lines, and panels:
Source package and run identifiers:
```

<a id="docs-publication-5"></a>

### Related topics

- [Open and interpret calculation results](<#results>)
- [Compose a figure](<#figures>)
- [Energy, k-path, DOS, and fair comparison](<#alignment>)

<a id="troubleshooting"></a>

## Troubleshooting and recovery

Start with the exact state and the most recent message. Repeatedly rerunning a failing input often wastes time without fixing its cause.

<a id="docs-troubleshooting-1"></a>

### Local npm run diagnosis

![Diagnose preflight, solver execution, and result persistence separately](<https://phynitelab.com/docs/guide/diagrams/failure-stages-en-light.png>)

Concept diagram: investigate the first failing stage before retrying.

A Completed status means the process and required persistence steps finished; it does not establish convergence or scientific validity. Preserve the exact input and failed log before retrying. A new attempt should use an explicit, reviewed change.

| Stage | What it means | Where to look |
| --- | --- | --- |
| Before solver start | Setup, runtime, potential, input validation, isolation, or worker readiness rejected the job. No solver output exists. | Run review, Settings → Compute, phynite-lab doctor, and the selected data directory logs. |
| Queued | The job is waiting for a dependency or available local worker. | Job status, dependency record, worker status, and notification history. |
| After solver start | The solver or analysis process returned an error or was interrupted. | Execution log, first meaningful solver error, saved input, provenance, and retained artifacts. |
| Persistence/upload | The calculation may have finished but saving or transfer failed. | Result state, checksum/provenance, storage inventory, network, and Cloud transfer status. |

<a id="docs-troubleshooting-2"></a>

### Launcher recovery sequence

1. Run phynite-lab status with the same --data-dir used to start the app.
2. Run phynite-lab doctor and record the displayed distribution, port, runtime, and data-path diagnostics.
3. Read the latest service and worker log in the selected data directory.
4. If the instance is healthy, open the printed loopback origin rather than starting another workspace.
5. If an update or runtime activation failed, keep the previous active runtime, fix the reported cause, and retry from Settings → Compute.
6. After a restart, inspect interrupted jobs; local jobs are not automatically rerun.

<a id="docs-troubleshooting-3"></a>

### Common problems

| Problem | What to do |
| --- | --- |
| Figure opens empty | Check that the project has completed plottable data. Open a specific run, retry source loading, or import an original numerical file. |
| Band + DOS is not verified | Check geometry/electronic source identity and energy metadata. Do not force unrelated calculations into a verified pair. |
| Lines or labels appear too dense | Set final dimensions, reduce unnecessary layers, use a grid, and inspect bounds and legend placement. |
| Cloud save stays pending | Check network, sign-in, document limits, and account allowance. Keep the local browser copy and export a Source package. |
| Cloud revision conflict | Open History and compare local and remote versions. Resolve deliberately before further automatic synchronization. |
| Outdated data after switching accounts | Wait for the current account workspace to load. If needed, reload and check the signed-in identity. |
| SCF does not converge | Inspect geometry, occupations, spin, pseudopotentials, mixing, cutoffs, and solver logs before adjusting iteration limits. |
| Resource check rejects a k mesh | Use a physically justified mesh within the deployment limits; set nonperiodic directions to one. Larger jobs need appropriate capacity. |
| Export fails | Check data validity, output size, font availability, and network; try again after the preview completes. |
| Old raw download expired | Open retained numerical data if available, import your original file, or run again. A preview image cannot recover missing numerical samples. |

<a id="docs-troubleshooting-4"></a>

### What to include in a support request

- The page, action, and exact visible error.
- Project and calculation names or IDs that you are comfortable sharing.
- Whether the failure happens before submission, in queue, during execution, during upload, or in Figure Lab.
- Relevant solver-log excerpts and the expected behavior.
- Never include passwords, browser cookies, access tokens, or the private computer configuration.

<a id="docs-troubleshooting-5"></a>

### Related topics

- [Troubleshooting: locate a failed workflow stage](<#diagnostics>)
- [Local troubleshooting and recovery](<#local-troubleshooting>)

<a id="local-troubleshooting"></a>

## Local troubleshooting and recovery

Use this short recovery path when the local launcher opens but a runtime, job, browser, or saved workspace does not behave as expected. Preserve the data directory and logs until the cause is clear.

<a id="docs-local-troubleshooting-1"></a>

### Startup and browser

![Diagnose preflight, solver execution, and result persistence separately](<https://phynitelab.com/docs/guide/diagrams/failure-stages-en-light.png>)

Concept diagram: investigate the first failing stage before retrying.

| Symptom | Recovery |
| --- | --- |
| A local service stopped during startup | Run status and doctor with the same --data-dir. Read the startup logs printed or stored in the data directory; do not create a second workspace by changing paths. |
| The browser did not open | Use --no-open and open the exact loopback URL printed by the launcher. Port 3000 may have been replaced with an available port. |
| A second command shows the existing instance | Reuse the reported URL or stop the instance cleanly before starting a different data directory. |
| Projects appear empty | Check the original --data-dir, status, and workspace identity. Reinstalling npm does not restore data from another directory. |

```text
phynite-lab status --data-dir ~/.phynite-lab
phynite-lab doctor --data-dir ~/.phynite-lab
phynite-lab --no-open --port 3000 --data-dir ~/.phynite-lab
```

<a id="docs-local-troubleshooting-2"></a>

### Runtime and isolation

1. Open Settings → Compute and verify that the requested DFT or MD/analysis runtime is installed, started, and capability-checked for this workspace.
2. If a sandbox probe is unavailable, follow the operating-system remediation shown by the app. Do not disable user namespaces, bypass bubblewrap, or switch to an unverified runtime.
3. For DFT, verify the selected pseudopotential library or exact UPF assets and their checksums. For MD, verify mapped elements, potential integrity, runtime validation, and the selected unit system.
4. Run a small reference job once the Compute plan is ready. Keep the failed attempt and its first cause if it still fails.

- [Local and hosted compute paths](<#local-compute>)
- [First local result checklist](<#getting-started>)

<a id="docs-local-troubleshooting-3"></a>

### Read the correct failure log

| First failing stage | Evidence | Next step |
| --- | --- | --- |
| Preflight / setup | Visible Compute plan or run-review reason; no solver log because the process never started. | Fix runtime, isolation, source, potential, resource, or input validation, then submit a new attempt. |
| Solver execution | Execution log, log tail, exit status, and retained input/artifacts. | Read the first meaningful solver error; inspect memory, disk, syntax, and physical settings. |
| Result persistence / artifact | Solver output may exist while result import or artifact verification fails. | Keep the attempt, check disk and checksums, and use Recover saved result only when offered. |
| AI provider | Provider settings status, capability probe, and safe connection error. | Fix the official CLI login or provider availability. There is no silent provider fallback. |

<a id="docs-local-troubleshooting-4"></a>

### Release identity, license, and update verification

The documentation release metadata currently resolves phynite-lab@0.1.12. The first command reports your installed launcher; the second reads npm registry metadata. A newer registry version does not update an already running process.

Open Source code and license in the app for its corresponding source. A published distribution records its exact public source commit and source archive; release assets provide package checksums and qualification evidence. Phynite-owned local code is AGPL-3.0-only; third-party solvers and potential files retain their own licenses.

Finish or cancel active work, stop the app, update with npm install -g phynite-lab@latest, and reopen the same data directory. Verify the launcher version and Compute capabilities. Background update notices do not install packages automatically and a registry outage does not prevent local work.

```text
phynite-lab --version
npm view phynite-lab version
```

- [Source code and license](<https://phynitelab.com/source>)
- [Update and startup recovery](<#npm-local-app>)

<a id="docs-local-troubleshooting-5"></a>

### Restart, cancel, and recover

1. Cancel an active run from Run history and wait until it becomes Cancelled or another terminal state. Do not submit a replacement while the original is still active.
2. After a launcher or computer restart, inspect the run state and saved log. Interrupted work requires review; the app does not silently rerun a scientific job.
3. Use Recover saved result only when the app reports verified saved output. Recovery imports that output; it does not claim the solver converged or rerun the job.
4. Before disk cleanup or migration, export the project archive and make an independent backup of inputs, provenance, checksums, and required QE tmp/wavefunction state.

> Completed is an application state, not a scientific conclusion. Recheck convergence, units, method identity, and downstream artifact completeness before using a result.

- [General troubleshooting](<#troubleshooting>)
- [Failure-stage diagnosis](<#diagnostics>)
- [Storage and backup](<#storage-backup>)

<a id="docs-local-troubleshooting-6"></a>

### Related topics

- [Troubleshooting and recovery](<#troubleshooting>)
- [Troubleshooting: locate a failed workflow stage](<#diagnostics>)

<a id="diagnostics"></a>

## Troubleshooting: locate a failed workflow stage

Identify the first stage that did not complete. Retrying a downstream action cannot repair an earlier missing structure, disconnected worker, or incompatible numerical source.

<a id="docs-diagnostics-1"></a>

### Decision table

![Diagnose preflight, solver execution, and result persistence separately](<https://phynitelab.com/docs/guide/diagrams/failure-stages-en-light.png>)

Concept diagram: investigate the first failing stage before retrying.

| What you see | Likely stage | Next check |
| --- | --- | --- |
| New project is unavailable | Account workspace initialization | Allow the workspace to load. On a cloud error, reload; do not clear browser data containing unsynchronized edits. |
| Structure will not import | Parsing or geometry | Check format, encoding, lattice, coordinates, and occupancies. Keep the source file for diagnosis. |
| Run is rejected immediately | Submission validation | Field messages, local runtime/isolation status, resource limits, and method; cloud authentication only for a cloud action. |
| Run remains Queued | Worker or dependency | Check destination, private worker heartbeat, shared availability, and predecessors. |
| Worker starts but QE exits | Runtime or scientific input | Read the first solver error. Check pseudopotential files, species names, syntax, memory, and disk. |
| SCF cycles do not settle | Electronic self-consistency | Inspect geometry, occupations, magnetism, mixing, thresholds, and near-degenerate states. |
| Solver finished but result unavailable | Persistence or upload | Inspect local disk/runtime and final status; hosted upload also depends on network and credentials. Keep the worker running. |
| Open in Figure Lab fails | Numerical source retrieval | Retry the source. Older runs may need their original numerical file when retained datasets are absent. |
| Overlay or pair warns about context | Scientific comparison | Read geometry, energy-reference, and path identity. Use independent panels when comparability is not established. |
| Export fails | Rendering or font resources | Reconnect, reduce an oversized raster, and retry. Keep the figure document and source package. |

<a id="docs-diagnostics-2"></a>

### Collect useful evidence

1. Record the page and exact action, time, project, and run identifier.
2. Copy the visible error and relevant solver-log lines around the first failure.
3. Note the destination, allocation, operating system, worker image, and whether the problem repeats.
4. For a plot issue, retain the numerical dataset, figure Source package, and expected axis convention.
5. Contact support with the smallest reproducible example. Remove private credentials, cookies, passwords, and unrelated project data.

<a id="docs-diagnostics-3"></a>

### Protect recoverable work

Keep the current browser session open when it contains an unsynchronized figure or project. Export source files before clearing site storage.

A retry creates or repeats work according to the active action. Inspect existing queued and running calculations before submitting duplicates.

Replacing a personal credential invalidates the old worker. Finish or cancel active work before rotating it so a completed solver can still upload its result.

<a id="docs-diagnostics-4"></a>

### Related topics

- [Troubleshooting and recovery](<#troubleshooting>)
- [Local troubleshooting and recovery](<#local-troubleshooting>)

<a id="tools-reference"></a>

## Tool and icon reference

Icons identify an action or workspace, not scientific validity. Hover an icon for its label, or focus it with the keyboard to use its accessible name. The same action can move into a menu on narrow screens.

<a id="docs-tools-reference-1"></a>

### Research workspaces

![Module tools and Canvas navigation](<https://phynitelab.com/docs/guide/workflow-canvas-desktop-light.png>)

Use tooltips and the tool reference to identify controls.

![Codex provider logo](<https://phynitelab.com/brand/ai/codex.png>)

Codex provider connection in Settings

![Antigravity provider logo](<https://phynitelab.com/brand/ai/antigravity.png>)

Antigravity provider connection in Settings

| Icon / label | Purpose | Keep in mind |
| --- | --- | --- |
| Flask — DFT Lab | Prepare structures and Quantum ESPRESSO calculation workflows. | A setup is editable; an execution record preserves the submitted attempt. |
| Three waves — MD Lab | Inspect trajectories, configure LAMMPS stages, and analyze frames. | Frame display and actual physical time are different quantities. |
| Axes and line — Figure Lab | Compose numerical datasets into scientific figures and export sources. | Figure styling never changes the executed scientific input. |
| Stepped spark — AI | Open the project AI workspace and review proposed actions. | The Phynite AI entry icon is distinct from provider logos in Settings. |

<a id="docs-tools-reference-2"></a>

### Canvas and execution controls

| Control | What it does |
| --- | --- |
| Plus — Add module | Opens the module catalogue. Add a source, scientific task, analysis, or Figure module and connect compatible ports. |
| Curved arrows — Undo / Redo | Moves through supported editing history; it does not undo an already executed solver job. |
| Play — Run / Run selected / Run all | Prepares Review run, includes prerequisites once, and reuses compatible retained results. Start run confirms the reviewed plan. |
| Clock — Run history | Shows workflow attempts, per-module status, errors, and available cancellation actions. |
| Activity line — Research context | Opens the project run ledger, timeline, recent comparison, and read-only AI context. |

> A disabled Run button needs its displayed validation or setup issue resolved. Adding a module does not install its solver or create a scientific result.

<a id="docs-tools-reference-3"></a>

### Geometry and trajectory tools

| Tool / key | Use | Scope |
| --- | --- | --- |
| Select / V | Select atoms or particles for inspection. | Active viewport. |
| Move / G | Move selected atoms; inspect the resulting coordinates before applying. | Structure editor. |
| Measure / M | Measure selected geometry using the current distance/angle mode. | Structure or trajectory viewport. |
| Slice cross-section / S | Inspect a cross-section of the displayed trajectory. | MD Lab |
| Fit structure / F | Frame the structure in the camera; it does not resize the cell. | MD Lab |
| View angle | Choose an orientation or supported multiple-view layout. | Viewport camera. |
| Display overlays | Change display aids without rewriting the scientific source. | MD Lab |
| Capture snapshot | Save a viewport image for illustration. | An image does not replace numerical export or provenance. |

> Keyboard shortcuts depend on focused context. Typing in a text field uses text editing; browser and operating-system shortcuts can take precedence. Check the Keyboard settings page for the actions that can actually be rebound.

- [Edit atoms and cell geometry](<#edit>)
- [Full keyboard reference](<#shortcuts>)

<a id="docs-tools-reference-4"></a>

### Read status and evidence icons

| Label | Meaning |
| --- | --- |
| Ready / Configuration ready | The relevant checks passed at that stage. Still inspect execution prerequisites and scientific choices. |
| Queued / Running | The job is waiting or executing. Wait for the final state and avoid duplicate submissions. |
| Completed | The app retained the result. Inspect convergence, warnings, units, and physical assumptions. |
| Failed / Cancelled | Open the recorded reason and logs. Preserve partial evidence before a retry. |
| Integrity / Elements / Runtime | MD potential indicators identify separate checks. They do not validate a force field for your study. |
| Not recorded / unavailable | The source did not provide that measurement. Do not interpret it as zero. |

- [Follow research evidence](<#research-history>)
- [Settings and preferences](<#settings-reference>)

<a id="docs-tools-reference-5"></a>

### Related topics

- [Keyboard and pointer shortcuts](<#shortcuts>)
- [Availability and planned workflows](<#roadmap>)
- [Units, terms, and scientific references](<#reference>)

<a id="shortcuts"></a>

## Keyboard and pointer shortcuts

Primary means Command on macOS and Control on Windows/Linux. Shortcuts are scoped to the active editor. Text fields keep their own editing behavior unless an action is explicitly listed.

<a id="docs-shortcuts-1"></a>

### Customize supported application shortcuts

![Customizable application shortcuts](<https://phynitelab.com/docs/guide/keyboard-settings-desktop-light.png>)

Supported bindings are stored on this device.

Open Settings → Keyboard shortcuts. Rebind opening Settings, toggling the sidebar, focusing an open AI chat, or sending a message using the supported combinations. Changes apply immediately and stay in this browser; restore defaults whenever needed.

The tables below describe editor-specific defaults and context. Custom application bindings do not replace native text editing, geometry operations, or browser accessibility keys.

<a id="docs-shortcuts-2"></a>

### DFT Lab

| Shortcut | Action | Context |
| --- | --- | --- |
| Primary + K | Open command menu | DFT Lab workspace |
| Space | Open command menu | Builder, outside editable controls |
| Primary + Z | Undo | Builder editing history |
| Primary + Shift + Z / Primary + Y | Redo | Builder editing history |
| V | Select tool | Viewport editing |
| G | Move tool | Viewport editing |
| A | Add atom | Viewport editing |
| M | Measure tool | Viewport editing |
| F | Focus selection | A selected atom |
| Delete / Backspace | Delete selection | Viewport; not a text input |
| X / Y / Z | Constrain move to an axis | Move mode |
| Shift + X / Y / Z | Constrain move to YZ / XZ / XY plane | Move mode |
| Enter | Apply move | Move mode |
| Escape | Cancel move or close the active tool/dialog | Depends on current interaction |
| Arrow Left / Right | Resize sidebar by 16 px | Focused resize separator |

<a id="docs-shortcuts-3"></a>

### Figure Lab

| Shortcut | Action | Context |
| --- | --- | --- |
| Primary + Z | Undo figure change | Outside editable controls |
| Primary + Shift + Z / Primary + Y | Redo figure change | Outside editable controls |
| Primary + S | Keep an explicit checkpoint | Commits a focused number draft first; automatic saving already runs |
| Primary + Shift + E | Export in the selected format | Ready figure outside editable controls |
| + or = | Zoom in | Canvas view |
| - | Zoom out | Canvas view |
| 0 | Fit figure | Canvas view |
| ? | Toggle shortcut help | Figure Lab |
| Space + drag / Alt + drag / middle drag | Pan the page | Figure Lab canvas |
| Primary + mouse wheel | Zoom the page | Figure Lab canvas |
| Escape | Close help or a drawer | Figure Lab |

<a id="docs-shortcuts-4"></a>

### Fields and custom menus

| Shortcut | Action |
| --- | --- |
| Tab / Shift + Tab | Move forward/backward through interactive controls. |
| Enter / Space | Activate a focused button or select a highlighted menu option. |
| Arrow Up / Down | Open or move through a custom select; navigate a command menu. |
| Home / End | Move to the first/last enabled option in a custom select. |
| Type letters | Find an option by label in an open custom select; type a command query in the command menu. |
| Escape | Dismiss the current menu; cancel an uncommitted numeric draft. |
| Enter / leave the field | Commit a numeric draft, including decimals or scientific notation where allowed. |
| Primary + Z in text | Undo text editing rather than changing the figure or crystal. |

<a id="docs-shortcuts-5"></a>

### Pointer and mobile interaction

Use the viewport camera controls to rotate, pan, and zoom the crystal. Atom tools operate on the selected atom; choose the appropriate tool before dragging.

On a small screen, open Results or Inspector from the Figure Lab toolbar, then close the drawer with its backdrop or Escape. The page remains scrollable when zoomed.

Dragging a sidebar separator adjusts its width on desktop. Keyboard users can focus the separator and use the horizontal arrow keys.

> Browser and operating-system shortcuts may intercept a key before the web page receives it. Buttons and menus provide the same primary actions.

<a id="docs-shortcuts-6"></a>

### Related topics

- [Availability and planned workflows](<#roadmap>)
- [Units, terms, and scientific references](<#reference>)
- [Reference: calculation fields and units](<#field-reference>)

<a id="field-reference"></a>

## Reference: calculation fields and units

Use the labels and units shown by the active calculation panel. These entries explain common QE inputs; the exact set of exposed controls depends on the workflow and whether generated or expert input is selected.

<a id="docs-field-reference-1"></a>

### Geometry and electronic setup

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

| Field or QE keyword | Unit / form | Interpretation |
| --- | --- | --- |
| CELL_PARAMETERS | Three lattice vectors; read the card unit | Defines the simulated cell, including vacuum. |
| ATOMIC_POSITIONS | crystal or a stated length unit | crystal means fractional coordinates in the supplied lattice basis. |
| ecutwfc | Ry | Maximum plane-wave kinetic energy for the wavefunctions. |
| ecutrho | Ry | Charge-density and potential cutoff; converge with the chosen potential. |
| K_POINTS automatic | N1 N2 N3 s1 s2 s3 | Mesh counts and offsets for reciprocal integration; offsets are not fractional atom shifts. |
| K_POINTS crystal_b | Reciprocal path vertices and weights | A line-mode path for band sampling; it is not the SCF integration mesh. |
| nbnd | Integer | Number of electronic states calculated at each k point. |
| tot_charge | Electron-charge convention used by QE | Positive values remove electrons; review periodic-charge treatment. |
| nspin / noncolin / lspinorb | Discrete settings | Spin model and spin-orbit coupling; compatible pseudopotentials are required. |

<a id="docs-field-reference-2"></a>

### Convergence and relaxation

| Keyword | Meaning | Interpretation |
| --- | --- | --- |
| conv_thr | SCF threshold in Ry | Controls the estimated electronic energy error; not a force threshold. |
| electron_maxstep | Maximum electronic iterations | A limit; reaching it does not establish convergence. |
| mixing_beta | Density-mixing parameter | Can affect convergence stability; no single value fits all systems. |
| degauss | Smearing width in Ry | An integration/occupation choice, not automatically a physical lattice temperature. |
| forc_conv_thr | Force threshold in Ry/bohr | Used with ionic relaxation; electronic convergence must be sufficiently tight. |
| press | Target pressure in kbar | Relevant to cell relaxation; distinguish applied pressure from residual stress. |
| cell_dofree | Allowed cell degrees of freedom | Defines which metric components can relax; inspect suitability for a slab or constrained strain. |

<a id="docs-field-reference-3"></a>

### Numerical entry and units

Numeric fields accept intermediate drafts while you type. Enter or leaving the field commits a valid value; Escape cancels a draft in supported controls. An empty axis bound means automatic, while a zero is an explicit physical bound.

Do not convert all scientific values to display-region formatting. QE inputs, CSV source files, and code use the syntax required by their parser. The interface language does not rewrite a solver input or change a numerical dataset.

> Refer to the installed QE version and its official INPUT_PW documentation for precise keyword semantics. This reference does not promise support for every QE module in the Phynite form.

<a id="docs-field-reference-4"></a>

### Related topics

- [Keyboard and pointer shortcuts](<#shortcuts>)
- [Availability and planned workflows](<#roadmap>)
- [Units, terms, and scientific references](<#reference>)

<a id="roadmap"></a>

## Availability and planned workflows

The workspace distinguishes available tools from promoted future features. A coming-soon card is informational and does not submit a job.

<a id="docs-roadmap-1"></a>

### Molecular dynamics

![Local workspace, project Cloud Sync, and cloud compute data boundaries](<https://phynitelab.com/docs/guide/diagrams/local-cloud-paths-en-light.png>)

Concept diagram: login, project sync, and job transfer are separate choices.

MD Lab supports Guided and validated manual LAMMPS simulations plus OVITO analysis on personal or funded Cloud compute.

Choose funding and resources in the lab drawer. Large source uploads use multipart; retained frame shards load on demand without changing the original data or browser safety limits.

<a id="docs-roadmap-2"></a>

### Managed plans

Free includes DFT Lab, MD Lab and Figure Lab, imports, templates, exports, 10 GiB total cloud storage, and DFT and MD runs on one connected personal computer per account. There is no Phynite activation or hourly local compute fee. Cloud compute uses Quanta as its primary unit; the Rupiah equivalent is the merchant credit purchase price, currently Rp18,000 per Quanta, rather than an exchange-rate conversion.

Paid Cloud uses verified production credit; sandbox payments cannot fund production. The rate is the selected AWS profile plus 10%, charged only for solver/analysis time with a 60-second minimum once per job. Setup, upload, cleanup, temporary disk and compute transfer are covered by Phynite. Duration estimates do not limit paid runtime. Funding renews within five minutes according to available balance; top up before its deadline to keep the same job running. Scientific failures bill actual compute; platform failures refund compute charges. Projects and results remain accessible after balance runs out. Total cloud storage offers replace the Free 10 GiB: 50 GiB Rp27,000, 100 GiB Rp55,000, 250 GiB Rp129,000, 500 GiB Rp259,000 and 1 TiB Rp519,000 per 30 days. More capacity and large transfers are quoted through support@phynitelab.com with no automatic transfer charge. Renewal is manual. The same tier adds 30 days; upgrades convert remaining paid base value into extra time without gateway fees; downgrades start after expiry. Expiry restores Free without deleting files. Accounts above quota may read, download and delete, while new writes are blocked. See /pricing for estimates and terms.

<a id="docs-roadmap-3"></a>

### Related topics

- [Keyboard and pointer shortcuts](<#shortcuts>)
- [Units, terms, and scientific references](<#reference>)
- [Reference: calculation fields and units](<#field-reference>)

<a id="reference"></a>

## Units, terms, and scientific references

The interface exposes a connected workflow, but the scientific meaning still comes from the selected model, solver method, and numerical data.

<a id="docs-reference-1"></a>

### Units and terms

![Structure, input, run, and evidence as separate research steps](<https://phynitelab.com/docs/guide/diagrams/research-lifecycle-en-light.png>)

Concept diagram: preserve each stage; a completed process still needs scientific review.

| Term | Meaning |
| --- | --- |
| Å / angstrom | Length unit for atomic-scale geometry; 1 Å = 10^-10 m. |
| Bohr | Atomic unit of length; approximately 0.529177 Å. |
| eV / Ry | Energy units; 1 Ry is approximately 13.605693 eV. Verify which unit each input field expects. |
| Fractional coordinates | Coefficients of the real-space cell vectors. |
| Reciprocal coordinates | Coordinates in the reciprocal lattice basis; interpretation depends on the declared convention. |
| Γ | The Brillouin-zone center, k = 0. |
| SCF / NSCF | Self-consistent / non-self-consistent electronic calculation. |
| DOS / PDOS | Density of states / projected density of states. |
| DFPT | Density-functional perturbation theory. |
| vCPU / core allocation | Requested execution parallelism; not measured utilization. |
| GiB / MB | GiB uses 1024^3 bytes; this guide labels decimal storage totals in MB and RAM allocations in GiB. |
| Provenance | Source identity, method, metadata, and processing history that explain where a result came from. |

<a id="docs-reference-2"></a>

### Read alongside the guide

Use the official Quantum ESPRESSO documentation for the exact semantics of pw.x, bands.x, dos.x, projwfc.x, ph.x, q2r.x, and matdyn.x options.

Use Materials Project documentation to understand database structure provenance and conventions; SeeK-path documentation for standardized paths; and BoltzTraP2 documentation for interpolation and transport assumptions.

This guide describes the implemented Phynite interface and its current behavior. It is not a substitute for a method-specific convergence study or validation against the scientific literature.

<a id="docs-reference-3"></a>

### Related topics

- [Keyboard and pointer shortcuts](<#shortcuts>)
- [Availability and planned workflows](<#roadmap>)
- [Reference: calculation fields and units](<#field-reference>)

## Scientific references

- https://www.quantum-espresso.org/documentation/
- https://docs.materialsproject.org/
- https://seekpath.readthedocs.io/
- https://www.boltztrap.org/
- https://docs.lammps.org/
- https://www.ovito.org/docs/
- https://wannier.org/documentation/
