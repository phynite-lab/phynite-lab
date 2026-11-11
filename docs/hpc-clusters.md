# Local HPC clusters

Open **Settings → Compute → HPC Clusters** in the local application. Add a Slurm
or OpenPBS profile, select SSH agent authentication or the absolute path to a
private key on this computer, and set an absolute remote scratch directory or
leave it blank to detect a writable scratch/home directory over SSH.
The hosted application cannot store SSH profiles or run probes.

The computer running Phynite needs OpenSSH (`ssh` and `sftp`). Establish and
verify the cluster's host key with your institution before probing. Profiles
use batch authentication and strict host-key checking. A probe checks the login
connection and discovered commands; it does not qualify a scientific job.

Compute nodes need Quantum ESPRESSO, the scheduler's MPI launcher, and Python 3.10+
with the scientific runner dependencies (`numpy`, `scipy`, `matplotlib`,
`seekpath`, and `spglib`). Transport calculations also need BoltzTraP2.
In **Environment Modules**, enter one module name per line, for example:

```text
intel/2024.0
impi/2021.11.0
mkl
materials/qe/7.2-impi
```

Phynite validates these as module names and loads them in login Bash shells for
the probe, scheduler submission/status commands, and remote job script. Do not
enter shell commands in this field. Match the site's MPI launcher and QE build.

The probe imports the required scientific packages, so an installed package with
broken native dependencies is reported as unavailable. Set **Python Executable**
to a compatible absolute path or load a scientific Python/Conda module, then probe
again. Automatic Python discovery invokes the chosen interpreter by absolute
path and preserves the module-selected MPI/QE search path. Both BoltzTraP2
stages and its reported package version use that same Python environment.
MPI ranks must use a separate `{ranks}` argument or `--ntasks={ranks}`; oversubscription is unsupported.
Login-node discovery does not establish compute-node availability.
Automatic band/phonon paths require working SeeK-path and spglib for the actual
structure; missing dependencies fail with an actionable error. An explicitly
selected manual path remains manual.

Choose **HPC Cluster** in a QE run configuration. Phynite freezes the profile
checksum, scheduler allocation, exact inputs and verified pseudopotentials;
the local worker stages the source-bound scientific runner over SSH. Keep the
local application running while the scheduler is queued or computing.
Native MD continues to use **Your computer**; remote LAMMPS is unavailable.

Results require a terminal scheduler status with a successful exit code, a
checksum-valid result inventory and positive scientific convergence evidence.
Harvest is limited to 64 MiB per file and 256 MiB per result set. Missing or
oversized required artifacts require manual reconciliation instead of partial
scientific success. Scratch and checkpoints remain on the cluster. Profile
updates retain workers for active jobs using older immutable snapshots.

After a local restart, a valid submitted receipt permits polling the existing
scheduler job after the old local lease expires, without submitting again.
A temporary heartbeat/status connection failure gets bounded read retries. If
monitoring is still unavailable, Phynite retains the active job and receipt and
resumes polling after reclaiming the local lease; it does not upload a failed
scientific result. SSH bootstrap, locks and transfers have finite deadlines.
Queue wait and monitoring slices do not consume the solver's scheduler walltime.
A valid saved HPC profile can queue work while its dispatcher starts, without
requiring the personal QE runtime to be ready.

Uncertain scheduler submission, invalid scientific results and cancellation
still require manual reconciliation. Inspect the
receipt in the local workspace's `work/hpc` directory, the scheduler job and
remote scratch before explicitly starting another run. Phynite never resubmits
an uncertain job or automatically restarts the solver.
