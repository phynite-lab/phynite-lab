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

```sh
phynite-lab --no-open --port 3000 --data-dir /path/to/workspace
phynite-lab status
phynite-lab stop
phynite-lab doctor
npm install -g phynite-lab@latest
```

Targets are macOS ARM64/x64 and Ubuntu 24.04-compatible Linux ARM64/x64
(glibc 2.39 or later). Windows runs inside WSL2. Native isolation must pass
the actual OS probe. Linux policy restrictions may require an administrator's
configuration; Phynite never disables those restrictions automatically.
Source availability is not a claim that every target has completed qualification.
Only versioned releases with the published acceptance evidence are supported.

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

For the initial 0.1.0 release, WSL2 qualification is deferred by the maintainer.
Windows/WSL2 is experimental and has not been tested on a WSL2 host. The Linux
package and its isolation requirements still apply; see the release evidence
for the platforms that were actually verified.
