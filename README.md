# Phynite Lab

**Phynite Lab** is an open-source, local-first computational materials-science workspace. It provides an intuitive, modern interface for crystal structure editing, **Quantum ESPRESSO (DFT)**, **LAMMPS (Molecular Dynamics)**, automated analysis, and publication-ready scientific figures—with zero complex compiler or environment setup required.

All your calculations, research projects, and data stay **100% private on your local machine**.

---

## Key Features

- **Crystal & Molecular Modeling**: Build unit cells, supercells, slabs, and vacuum regions. Import or export CIF and POSCAR formats, or search structures directly via Materials Project.
- **Quantum ESPRESSO (DFT)**: Run SCF, structural relaxations, electronic band structures, Density of States (DOS), and phonon workflows with automatic high-symmetry $k$-paths (via Seekpath) and one-click SSSP pseudopotential integration.
- **LAMMPS (Molecular Dynamics)**: Set up thermal equilibrations (NVE, NVT, NPT) and mechanical deformation simulations with integrated 3D trajectory visualization and OVITO analysis.
- **Local-First & Private by Default**: Projects, inputs, and outputs are stored locally in SQLite and filesystem storage (`~/.phynite-lab`). No mandatory accounts, telemetry, or third-party cloud lock-in.
- **Zero-Config Solvers**: No need to manually compile Fortran binaries, configure OpenMPI, or manage conflicting Python virtual environments. Verified native solver runtimes are installed and sandboxed on demand.
- **Publication-Ready Figures**: Generate interactive band diagrams, DOS spectra, and convergence graphs ready for SVG/PDF export.
- **Local AI Co-Scientist (Optional)**: Connect your local AI CLI tools (e.g., Codex or Antigravity) via loopback for intelligent parameter recommendations and automated workflow generation without exposing private research data.

---

## Quick Start

### Installation

Requires [Node.js](https://nodejs.org/) 22.13 or later.

```sh
# Install globally
npm install -g phynite-lab

# Launch Phynite Lab
phynite-lab
```

When started, Phynite Lab automatically spins up the native local core, starts the web interface at `http://127.0.0.1:3000`, and opens your default browser.

---

## First Calculation in 3 Steps

1. **Enable Scientific Solvers:**
   Open **Settings → Local runtime & cloud** (or Compute setup) and click **Install runtime** for **Quantum ESPRESSO (DFT)** and/or **LAMMPS (MD)**. The app will download and verify the sandboxed solver environment.
2. **Set Up Pseudopotentials (for DFT):**
   In the **DFT pseudopotentials** section, install the official SSSP (Standard Solid-State Pseudopotentials) library (**Precision** or **Efficiency**) with one click, or upload your own `.upf` files.
3. **Build & Run:**
   Create or import a crystal structure in the workspace, add calculation steps (e.g., SCF or Band Structure), choose **Your computer** in the run review, and click **Run**. View live solver logs, convergence curves, and scientific results in real time.

---

## CLI Reference

```sh
phynite-lab [command] [options]
```

### Commands

| Command | Description |
| :--- | :--- |
| `phynite-lab` *(default)* | Starts the local server and opens the browser interface. |
| `phynite-lab status` | Checks if a local Phynite Lab instance is currently running. |
| `phynite-lab stop` | Gracefully shuts down the running instance. |
| `phynite-lab doctor` | Verifies the integrity of the application, local core, sandboxing, and data directory. |

### Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--port <number>` | Custom port for the web interface. | `3000` *(auto-increments if busy)* |
| `--data-dir <path>` | Custom directory for workspace databases, runtimes, and projects. | `~/.phynite-lab` |
| `--no-open` | Start the local server without automatically launching the browser. | `false` |
| `-v, --version` | Display the installed version. | — |
| `-h, --help` | Show command-line help. | — |

To update Phynite Lab to the latest version:
```sh
npm install -g phynite-lab@latest
```

---

## Platform Support

Phynite Lab ships self-contained native packages for:

- **macOS** (Apple Silicon `arm64`, macOS 12+)
- **Linux x64** (glibc $\ge$ 2.39, including Ubuntu 24.04+, Arch Linux, Fedora 40+, Debian 13+)
- **Linux ARM64** (`linux-arm64`)
- **Windows** supported via **WSL2** (running the Linux x64 package)

### Sandboxing & Security
On Linux, solver runtimes execute inside an unprivileged [Bubblewrap](https://github.com/containers/bubblewrap) sandbox with strict filesystem and loopback-only network isolation. Ensure your Linux kernel has unprivileged user namespaces enabled (the default on modern distributions).

---

## Local Storage & Large Calculations

- **Workspace Location:** By default, all project files, calculation logs, and runtime environments reside in `~/.phynite-lab`.
- **Disk Space Considerations:** Quantum ESPRESSO intermediate files (`tmp/`, wavefunctions, charge density) can require several gigabytes for large systems. Ensure adequate disk space when calculating dense $k$-point grids or phonon dispersions.
- **Storage Accounting:** The in-app Storage page tracks inventoried project inputs and outputs. It excludes raw solver binaries, worker logs, and database indexes.
- **Optional Cloud Sync:** Signing in to Phynite Cloud is strictly optional. Cloud Sync is never activated automatically; you explicitly choose whether to sync a project or submit compute jobs to the cloud.

---

## Build From Source

To develop or build Phynite Lab from source:

```sh
# Clone repository
git clone https://github.com/phynite-lab/phynite-lab.git
cd phynite-lab

# Install dependencies and build frontend
npm ci
npm run prepare:workflow
npm run build

# Setup local Python core environment
python3 -m venv .local-backend/venv
.local-backend/venv/bin/python -m pip install -r scripts/local-core-requirements.txt
.local-backend/venv/bin/python scripts/build-local-core.py

# Launch development instance
npm run dev:local
```

*Note: Source development requires Python 3.10+ to compile the local core; end users installing via npm do not need Python.*

---

## Documentation

Comprehensive guides and tutorials are available at [phynitelab.com/guide](https://phynitelab.com/guide)

---

## License & Provenance

Phynite Lab is licensed under the **GNU Affero General Public License v3 only** (`AGPL-3.0-only`); see [LICENSE](LICENSE). Commercial use is permitted under the terms of the AGPL. If you modify Phynite Lab and run it as a network service, you must make the corresponding source code available under the AGPL (Section 13).

Third-party scientific packages (Quantum ESPRESSO, LAMMPS, OpenMPI, Seekpath, OVITO) retain their respective open-source licenses and notices; see [NOTICE.md](NOTICE.md).
