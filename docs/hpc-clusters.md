# Local HPC clusters

Open **Settings → Compute → HPC Clusters** in the local application. Add a Slurm
or OpenPBS profile, select SSH agent authentication or the absolute path to a
private key on this computer, and set an absolute remote scratch directory.
The hosted application cannot store SSH profiles or run probes.

The computer running Phynite needs OpenSSH (`ssh` and `sftp`). Establish and
verify the cluster's host key with your institution before probing. Profiles
use batch authentication and strict host-key checking. A probe checks the login
connection and discovered commands; it does not qualify a scientific job.

Compute nodes need Quantum ESPRESSO, the scheduler's MPI launcher, and `python3`
with the scientific runner dependencies (`numpy`, `scipy`, `matplotlib`,
`seekpath`, and `spglib`). Transport calculations also need BoltzTraP2.
Enter module names such as `qe/7.2` and `python/3.12`; Phynite renders their
`module load` commands. Match the site's MPI launcher and QE build.

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

Lost connections, interrupted local sessions, uncertain scheduler submission,
timeouts and incomplete results require manual reconciliation. Inspect the
receipt in the local workspace's `work/hpc` directory, the scheduler job and
remote scratch before explicitly starting another run. Phynite never resubmits
an uncertain job or automatically restarts the solver.
