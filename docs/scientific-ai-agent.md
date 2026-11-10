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
