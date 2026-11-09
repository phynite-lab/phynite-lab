# Phynite Lab

An open-source local workspace for crystal structures, Quantum ESPRESSO DFT,
LAMMPS molecular dynamics, analysis and scientific figures.

## Install

```sh
npm install -g phynite-lab
phynite-lab
```

Requires Node.js 22.13 or later. The launcher opens a browser and keeps projects
in `~/.phynite-lab`; no Docker, global Python, source checkout or cloud account
is needed to use a complete published package. Install scientific runtimes once
from the web setup page. DFT and MD potentials are selected separately under
their respective licenses. AI requires a separately installed official provider
CLI and the user's own provider account.

Before the first calculation, open **Compute → local setup** and install **DFT**
and/or **MD & analysis**. Wait for the requested solver to be ready, then select
**Your computer** in the run review. The npm install prepares the application;
the separate setup installs the scientific solvers. The run review also offers
installation when a solver is missing and blocks execution until the worker has
validated it.

For a first local run, follow this order: verify the detected platform, solver
capability, and isolation probe; install the pseudopotential library or upload
the exact UPF files required by the input; run a small reference calculation;
then inspect the queued/running/final state, first solver error, execution log,
provenance, checksums, and numerical result. A failure before the solver starts
is a setup or preflight failure and has no solver output. A failure after start
has an execution log and retained artifacts; read the first solver error before
changing an input.

For SSSP inputs, install the selected **Precision** or **Efficiency** library in
the setup's **DFT pseudopotentials** section. Downloads come from the pinned
official Materials Cloud release, retain its license notices, and are checked
before activation. Library installation preserves your selected physical settings;
UPF files uploaded in the editor can also be used without installing a library.

If an execution fails, open the module's **Execution result** for its reason,
**Execution log**, and available downloadable artifacts. A failure before the
solver starts has no solver output; correct the displayed setup/input issue and
start a new run. Failed attempts remain in history.

```sh
phynite-lab --no-open --port 3000 --data-dir /path/to/workspace
phynite-lab status
phynite-lab stop
phynite-lab doctor
npm install -g phynite-lab@latest
```

The current published release is resolved from the package metadata and ships native packages for **macOS Apple Silicon** (`darwin-arm64`),
**Linux ARM64** (`linux-arm64`) and **Linux x64**
(`linux-x64`, glibc >=2.39), including current Omarchy/Arch Linux. Windows is
supported through WSL2, which uses the Linux x64 package and launcher. Linux
requires unprivileged user namespaces; the verified bubblewrap sandbox is included.
Each supported target is qualified with the matching native acceptance record;
the published evidence identifies which targets were exercised. Direct testing
on an arbitrary Omarchy desktop or Windows host is not implied by package
availability. See the distribution guide for setup and platform caveats.

The launcher checks the npm registry for a newer release in the background after
startup. A successful check is cached for up to six hours and a failed/offline
check for five minutes. The notice shows the installed and available versions and
never installs anything automatically. Local work continues when npm is offline;
update with `npm install -g phynite-lab@latest` after stopping the running app.

## Local work and optional Cloud

Projects, inputs and results are stored locally using SQLite and files. Login to
Phynite Cloud is optional. Login does not enable project sync; explicitly choose
Cloud Sync per project or submit a job to cloud compute after its transfer preview.
Local AI connections and cloud login are independent. The hosted backend and its
deployment infrastructure are maintained separately and are not needed to build
or run this application.

## Documentation

See [local HPC clusters](docs/hpc-clusters.md) for SSH setup, Slurm/OpenPBS QE
execution, scientific runtime requirements and manual recovery.

Read the complete bilingual guide at
[phynitelab.com/guide](https://phynitelab.com/guide). The most relevant topics
for the local package are [Install, update, and diagnose the npm app](https://phynitelab.com/guide/npm-local-app),
[AI provider accounts](https://phynitelab.com/guide/ai-providers),
[Cloud Sync](https://phynitelab.com/guide/cloud-sync),
[Storage and backup](https://phynitelab.com/guide/storage-backup), and
[Settings](https://phynitelab.com/guide/settings-reference). Downloadable English
and Indonesian Markdown guides are available from the documentation page.

See [crystal database imports](docs/crystal-database.md) for supported sources,
property filters, preview, primitive/conventional cells, supercells and retained
source evidence.

The guide follows task paths: **Start here**, **Install & update**, **Projects
& structures**, **QE & DFT**, **MD & analysis**, **AI providers**, **Phynite
Cloud**, **Storage & backups**, **Settings & preferences**, **Results &
figures**, and **Troubleshooting & recovery**. Major procedures include
annotated visuals captured from a clean demo workspace; screenshots contain no
account credentials or private research data.

### Local storage and large QE runs

The default data directory is `~/.phynite-lab`; use `--data-dir` to choose another
workspace. SQLite stores metadata and the filesystem stores project artifacts,
runtime installations, and logs. The Storage page measures only inventoried
project artifacts, so its number excludes database metadata, installed solvers,
logs, and unrelated files on the disk. Local mode has no fixed 10 GB allowance or
seven-day automatic cleanup: the practical limit is the user's available disk.
Export important projects and keep an independent backup before deleting or
replacing a workspace.

Quantum ESPRESSO `disk_io` and intermediate state can be much larger than the
final output. Wavefunctions and `tmp/` data may be required for bands, DOS,
phonons, projected workflows, or interoperability with another program. Keep
that state until every downstream workflow finishes, and preserve the exact
input, pseudopotential identity/checksum, provenance, and state artifacts with
the project. Wannier90 is an external/manual workflow unless a separately
documented integration is installed; see the [Quantum ESPRESSO documentation](https://www.quantum-espresso.org/documentation/)
and [Wannier90 documentation](https://wannier.org/documentation/).

| Counted by local Storage | Not counted by local Storage |
| --- | --- |
| Inventoried project inputs, results, trajectories, and archives | SQLite metadata, solver/runtime installations, worker logs, browser cache, and unrelated disk files |

Plan extra disk when a workflow retains wavefunctions, `tmp/`, checkpoints, or
multiple trajectories. Cloud storage is separate: it has account quota,
retention, and Trash rules. Cloud login never uploads a local project, and
Cloud Sync is enabled explicitly per project.

## Build from source

```sh
npm ci
npm run prepare:workflow
npm run build
python3 -m venv .local-backend/venv
.local-backend/venv/bin/python -m pip install -r scripts/local-core-requirements.txt
.local-backend/venv/bin/python scripts/build-local-core.py
```

Source development requires Python for the local backend; end users of the npm
package do not. For an isolated source preview, use `npm run dev:local` after
installing backend dependencies in that virtual environment.

`npm run dev:local` defaults to `~/.phynite-lab-dev`, separately from the npm
launcher's `~/.phynite-lab`. Each workspace has its own runtime installations.
Installing solvers in one does not install them in the other. Use `--data-dir`
explicitly to select another workspace, and stop its current instance first.

See [local distribution](docs/local-distribution.md) and
[native runtimes](docs/native-runtime-releases.md) for assembly and qualification.
Release preparation and publication are deliberate manual steps. Run the local
validation commands and retain the source, checksum, platform, scientific, and
license evidence before publishing a versioned npm package; no push or CI job
publishes a release automatically.

## License and source

Phynite Lab is licensed under **GNU Affero General Public License v3 only**
(`AGPL-3.0-only`); see [LICENSE](LICENSE). Commercial use is allowed under the
license. Modified versions offered over a network must provide the corresponding
source as required by AGPL. The app's **Source code and license** link and each
release identify the exact source commit and downloadable source archive.

Third-party components retain their own licenses and notices. Solver runtimes
are separate downloads. Preserve their notices and corresponding-source duties;
the Phynite license does not replace them.
