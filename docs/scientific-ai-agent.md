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

## Scientific inspection in Phynite AI

The conversation tools inspect saved project evidence. Unsaved editor changes are
not included. `read_guide` searches the actual English or Indonesian guide;
`inspect_dft_setup`, `diagnose_calculation`, and `diagnose_figure` reuse the QE and
Figure Lab validators. SSSP recommendations identify the published MD5 digest;
an unavailable SHA-256 is reported as unknown. Metadata inspection does not prove
that UPF files are installed or suitable. Expert QE input remains authoritative
over Guided reference settings.

Use `list_job_artifacts` to obtain exact input/output paths and checksums, then
`read_job_file` for UTF-8 files up to 6 MB. Head, tail and line windows return
source line numbers and continuation pointers. Grep accepts literal alternatives
with `|`, optional `^`/`$` anchors and up to three `.*` separators. Other regex
syntax is rejected to keep large-log searches bounded. Binary files, traversal,
unlisted paths and changed checksums are rejected. Private storage locations and
signed download links are never returned by these readers.

`query_dataset` reads saved datasets up to the existing 4 MB document limit and
returns metadata, full-series/window extrema, gap counts, and at most 256 sampled
points per selected series in a response below 16 KB. Sampling retains ordered
bucket extrema and original indices. Source axis labels, energy references,
normalization and orbital channel metadata remain explicit. The response marks
omitted series and per-point spectral weights/projections; x/y samples are partial
evidence and do not establish convergence or reconstruct a full spectral plot.
Choose fewer series if their metadata exceeds the window. Use `list_active_jobs`,
`get_job_status` and `get_worker_status` for on-demand status snapshots. These tools
do not poll automatically or retry uncertain HPC submissions.

Crystal database tools reuse the existing fixed-host adapters and checksum-based
Canvas imports. `search_crystal_db` and `import_structure` are aliases of the
existing crystal tools, with the same source IDs and review requirements.
`modify_structure` applies Crystal Builder modifiers or a supercell/slab operation
using the shared server-side scientific compiler. Builder steps and final geometry
are limited to 1,600 atoms. Legacy DFT projects receive a new material variant;
Canvas projects update the selected structure node at its reviewed revision and
retain the original resource plus parent identity/provenance. Project drift or a
changed source invalidates the proposed change.

`search_md_potentials` searches NIST or OpenKIM with public element/keyword queries.
`import_md_potential` stages the verified bytes, model version, license information,
element mapping and SHA-256 digests for normal action review. The project receives
the potential only after that action executes. MEAM requires the published library
element order. Imported potentials remain physically unqualified until assessed
for the intended study. `preview_md_input` performs scoped server preflight and
shows stage commands without saving or running; geometry, element coverage and
runtime readiness still require the normal run checks. MD stays on personal compute.

The built-in catalogue also offers **Convergence study**, **Failure diagnostics**,
**Figure design**, **MD analysis**, and **Literature synthesis**. These are versioned
workflow instructions. They grant no additional tools or permissions, preserve
task-mode restrictions, and cite only the evidence actually read. Literature tools distinguish verified metadata, abstracts and actually read OA text; uploaded papers expose the structural attachment index described below.

## Deep paper reading

PDF text extraction supports up to 150 pages, with a 12 MB extracted-text and
24 MB stored-index guard. Existing streamed source uploads remain available;
native model PDF input stays limited to 10 MiB and 40 pages. Longer PDFs use
text with explicit limits: figures, scanned pages and layout remain unread.
The original source checksum is retained and new extracted indexes have their
own verified checksum.

`read_attachment(includeIndex: true)` returns outline/heuristic section headings,
page coverage, captions and reference text. `search_attachment` finds literal
terms, then `read_attachment` jumps by section ID, page range or original section
index. Continue with `nextOffset` and pass `nextTextOffset` as `textOffset`; this
preserves long Unicode sections without dropping unread text. Structural indexes
are heuristics and do not establish citation validity or recover scanned text.

`lookup_paper` verifies exactly one DOI/arXiv ID with Crossref/arXiv. Optional
OpenAlex citation/reference directions contain at most 15 verified metadata
records each. OA reading uses verified arXiv HTML text only and does not fetch
arbitrary publisher URLs or execute HTML. Provider redirects, failures, missing
graph identities and bounded excerpt coverage are reported. `search_papers`
supports result limits, year windows and relevance/recent/citation sorting;
missing citation counts stay unknown. All queries must use public research
keywords/identifiers, never private project text or credentials.

## Versioned research artifacts

The agent can publish reports, plans, tables, input drafts, diffs and previews of
saved scientific datasets in every conversation mode. Each deliverable has one
card and an immutable version history. Open the card to read, compare versions,
copy or export it; the viewer splits beside the conversation on wide screens and
opens as a drawer on narrow screens. Tables export CSV with units, figures export
SVG/PNG, input drafts retain their exact text, and Markdown exports include the
recorded sources. Publication does not apply a plan, install an input or run a
solver. Input validation supplied by the model is explicitly an assessment.

Deliverables are limited to 2 MB of retained JSON. Larger than 32 KB uses local
artifact storage with checksum verification; the conversation stream carries only
metadata. Project figure previews require the exact saved project datasets and
use the existing deterministic renderer. Markdown, SVG, tables and input previews
never execute user HTML or JavaScript. Older saved reports remain readable.

## Custom skills and reasoning

Use **Add context → Manage custom skills** to create, edit or archive owner-local
workflow instructions. Skills have slash commands, task-mode restrictions and an
optional tool subset. They never grant new tools or bypass conversation approval,
project scope or scientific validators. The catalogue permits 50 active skills;
commands must be distinct from modes, modules and built-in skills. JSON
import/export copies editable preferences and requires Save before selection.

Every queued or active turn keeps its exact selected skill version, instruction
checksum and permission subset. Editing or archiving the skill does not change
that snapshot; a new turn must select the current version. User instructions are
escaped inside a guidance-only XML boundary. The host filters available tools and
rejects disallowed operations again in the local backend.

Reasoning effort and output length are independent. The connector uses the
verified model's output ceiling and declared adaptive, token-budget or effort
control. Unverified router controls remain Auto only. The native connector
forwards validated effort to the official CLI without enabling native tools.
Auto uses High for Plan/Research when the current capability report supports it;
explicit effort choices are preserved. Before proposing a scientific mutation,
the model records brief checks of units, species/potential mapping, periodicity
and convergence settings. Unknown checks block preparation. These assessments
are not convergence proof, solver output or a substitute for application validation.
