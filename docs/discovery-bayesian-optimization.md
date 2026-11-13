# Discovery v2 Bayesian Optimization

`start_discovery` is available in Ask for approval. It reviews a saved local
Canvas SCF or bands node, one directly connected immutable structure, a typed
objective, scientific conditions, explicit dimensions/units, seed and complete
budget. Full access and legacy Discovery records do not grant this authority.
Original geometry and Canvas configuration are preserved; candidate structures
are separately retained with their parent checksum.

The initial dimensions are lattice a/b/c (angstrom) and alpha/beta/gamma (degree),
continuous or integer. Composition, occupancy and periodicity remain fixed. Set
manual occupations and cutoffs before approval so geometry changes cannot trigger
an automatic method substitution. The exact draft, pseudopotentials and scientific
compiler are fingerprinted. Geometry never inherits a database gap or source claim.

The objective is DFT energy per atom (eV/atom, from retained QE Ry) or a converged,
validated DFT band gap (eV), with minimize, maximize or a finite target. Gap scope
is explicit: sampled-k-path or full-brillouin-zone. The existing bands engine
produces a sampled-path gap; it cannot satisfy a full-zone objective without
separately verified full-zone evidence. Neither a scheduler success nor an AI
assessment supplies an observation.

Inputs are normalized to [0,1]. The existing RBF GP uses Cholesky, bounded jitter,
and normalized targets. Expected Improvement is evaluated over a deterministic
seeded bounded pool, with maximize/target transformed to a minimization loss.
The default is five evaluations, at most 32, five dimensions and one active BO job.
Each candidate and observation persists before the next acquisition. Stable
idempotency keys plus intent-before-submit and receipt reconciliation prevent
replaying experiments after restart. Uncertain receipts, exhausted design space,
unstable/nonfinite GP output, changed Canvas, approval expiry or invalid evidence
stop with an inspectable reason; no random fallback or automatic resubmission.

The installed DFT Python runs numerical acquisition in the existing verified OS
sandbox with no external networking. Runtime GP self-checks precede acquisition.
The local application monitor supervises independently of the chat lease. It
reserves worst-case node-hours, tracks queue and running clocks separately, and
requests cancellation on budget overrun. Closing the local application stops
supervision; restart reconciles confirmed jobs. The action card shows candidates,
observations, source/method checksums, conditions and explicit campaign cancellation.

Control-plane fixtures are labelled synthetic. The GP tests execute actual NumPy/
SciPy numerics; they are not a scientific validation of a DFT method or material.
Real solver qualification remains the existing installed runtime's responsibility.
