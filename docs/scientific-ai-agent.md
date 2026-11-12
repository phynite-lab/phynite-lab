# Scientific AI Agent operator contract

The local operator keeps the researcher workflow bounded and restartable.  Its
durable state is separate from the browser session:

```text
planning → awaiting approval → executing → observing → validating → completed
                                      ↘ repair proposed
                                      ↘ manual resume required
```

Queue waiting, solver wall time, and the browser agent lease are independent
clocks.  `backend/local_worker/ai_operator.py` validates the campaign contract,
performs the periodic geometry gate, fits the v1 RBF Gaussian Process with
NumPy and `scipy.linalg` Cholesky, and creates a sparse evidence manifest.  A
receipt can be reconciled after a restart; reconciliation never submits a
second scheduler job.

The closed repair catalogue preserves scientific identity.  Composition,
functional, pseudopotential, charge/spin, cutoff, k-point resolution, lattice,
coordinates, periodicity, evaluator, and objective changes are blocked.  Large
wavefunction and scratch files stay on the cluster as checksum/path references.

`backend/local_api/agent-runtime-manifest.json` is the release acceptance
contract for the bundled runtime.  A missing or broken scientific runtime uses
the researcher-facing message specified by the product contract and never
suggests a terminal installation command.

## Pinned memory and long local turns

Short turns retain the six-tool foreground budget and twelve-step hard ceiling.
The explicit **Multistage** composer option permits up to 40 tools and 30 model
rounds. This public application runs through the active local connection: keep
the tab open. It does not deploy a hosted worker or poll scientific jobs in the
background. Pending approval still stops execution before subsequent tools.

Pinned memory retains exact user requirements with source message IDs, selected
source values/checksums, recorded action outcomes and gaps. Model assessments are
labelled as assessments; they never constitute scientific proof. Long ledgers
overflow to owner/conversation-scoped, checksum-verified local artifact storage.
Every ten tools saves a stage checkpoint. Older tool results replay compact
evidence digests; complete sanitized observations remain in stored messages.
An oversized history also stores a deterministic index, with explicit coverage
limits. Initial requirements remain pinned independently of that history window.

Before a multi-step turn finishes, an audit compares dispositions and actual
action states. One corrective model round can resolve uncertainty; remaining
unknown/unmet requirements or pending/failed actions are explicitly appended to
the answer and retained in the run verification record. Near the tool/round
ceiling the assistant records a partial checkpoint rather than executing excess
calls. Continue from that checkpoint and inspect uncertain submissions manually.
