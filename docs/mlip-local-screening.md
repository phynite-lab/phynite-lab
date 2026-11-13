# Local MACE screening

Settings → Compute → MLIP installs a separate isolated environment explicitly.
The initial exact package lock targets macOS ARM64 with CPython 3.12 from the
already approved DFT runtime. Other platforms remain unavailable until a reviewed
lock and actual target qualification exist. The MLIP environment does not replace
DFT/MD dependencies. Keep its base runtime available.

The package locks pin every dependency and SHA-256. Setup first downloads only
locked distributions, then installs offline inside the verified OS sandbox with
no dependency resolution or isolated-build downloads. The reviewed source-only
python-hostlist package builds offline with pinned setuptools/wheel. Its installed
metadata, dependency licenses, lock and diagnostic logs are retained locally.
Setup requires at least 4 GiB free before downloading. The official MIT model is
MACE-MP-0b3 medium (79,472,952 bytes), with SHA-256
`2f2be696351ac9e94fbe01cdfb6f017679acdbd2db7645209ef55fec9826b012`.
The adapter uses mace-torch 0.3.17, ASE, CPU, float64 and one numerical thread.
There is no model-selection URL and no automatic foundation-model download.

Activation requires the actual model to pass finite-difference force checks,
periodic-image invariance, fixed-cell relaxation and cancellation in the local
sandbox. A package solve or mocked control-plane test is not qualification.
**Current implementation qualification: not performed.** This development host
has less than the required 4 GiB free; real install preflight rejects it before
any model/package download. No supported scientific platform is claimed yet.
The runtime remains disabled until the real local qualification succeeds.

AI `read_mlip_runtime` reports readiness. `run_mlip` reviews an exact saved structure,
its checksum and periodicity, a single point or fixed-cell relaxation, force
criterion (eV/angstrom), maximum 500 steps and maximum one-hour wall budget. Its
normal action card requires the existing scientific checks and permission mode.
Original geometry stays immutable. There is at most one active MLIP process.
Cancellation/timeout cannot produce an accepted completed result. A restart with
an uncertain running attempt requires manual inspection and is never replayed.

`get_mlip_result` returns verified energies (eV, eV/atom), forces (eV/angstrom),
final fractional coordinates, exact fixed cell, model/protocol/request checksums
and the actual final force criterion. A finished single point can still fail the
force criterion. `propose_mlip_dft` compares only identical composition, model,
protocol and periodic axes, applies the reviewed energy window, and returns at
most three force-converged candidates. This is a proposal; DFT needs separately
reviewed inputs and approval. Approximate MLIP energies must not be mixed with
corrected Materials Project energies and do not predict a band gap.
