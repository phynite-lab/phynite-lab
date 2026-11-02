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
their respective licenses. AI requires a separately installed provider CLI or
local gateway and the user's own provider account.

Before the first calculation, open **Compute → local setup** and install **DFT**
and/or **MD & analysis**. Wait for the requested solver to be ready, then select
**Your computer** in the run review. The npm install prepares the application;
the separate setup installs the scientific solvers. The run review also offers
installation when a solver is missing and blocks execution until the worker has
validated it.

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

The 0.1.5 release ships native packages for **macOS Apple Silicon** (`darwin-arm64`),
**macOS Intel** (`darwin-x64`), **Linux ARM64** (`linux-arm64`) and **Linux x64**
(`linux-x64`, glibc >=2.39), including current Omarchy/Arch Linux. Windows is
supported through WSL2, which uses the Linux x64 package and launcher. Linux
requires unprivileged user namespaces; the verified bubblewrap sandbox is included.
The release is qualified on matching CI runners; direct testing on an Omarchy
desktop or Windows host is not claimed. See the distribution guide for setup.

## Local work and optional Cloud

Projects, inputs and results are stored locally using SQLite and files. Login to
Phynite Cloud is optional. Login does not enable project sync; explicitly choose
Cloud Sync per project or submit a job to cloud compute after its transfer preview.
Local AI connections and cloud login are independent. The hosted backend and its
deployment infrastructure are maintained separately and are not needed to build
or run this application.

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
Ordinary pushes run checks. An explicit release workflow publishes versioned npm
packages only after package, scientific and OS acceptance gates pass.

## License and source

Phynite Lab is licensed under **GNU Affero General Public License v3 only**
(`AGPL-3.0-only`); see [LICENSE](LICENSE). Commercial use is allowed under the
license. Modified versions offered over a network must provide the corresponding
source as required by AGPL. The app's **Source code and license** link and each
release identify the exact source commit and downloadable source archive.

Third-party components retain their own licenses and notices. Solver runtimes
are separate downloads. Preserve their notices and corresponding-source duties;
the Phynite license does not replace them.
