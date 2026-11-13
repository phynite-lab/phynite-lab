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

## Local MCP connections

The first MCP release ships Tier 1 for the installed application. Tier 2 remains
out of scope until a hosted scientific registry has verified endpoints. The
public app never accepts a remote MCP URL or executable from a browser/model.

Register servers in `<data-directory>/mcp/servers.json` (default
`~/.phynite-lab/mcp/servers.json`). Keep the directory mode `700` and the JSON
file mode `600`; symlinks and public-readable configuration are rejected. For
example, using an actual executable and script you have installed and trust:

```json
{
  "version": 1,
  "servers": [{
    "id": "science",
    "label": "My scientific tools",
    "transport": "stdio",
    "command": "/absolute/path/to/node",
    "args": ["/absolute/path/to/your-mcp-server.mjs"],
    "env": {}
  }]
}
```

Alternatively use `transport: "http"`, `url: "http://127.0.0.1:PORT/mcp"` and an
optional `headers` object instead of `command`, `args`, and `env`. No redirects,
remote hosts, URL credentials or query parameters are accepted. Credentials
belong in private `env`/`headers`, never in tool arguments. Phynite/AWS/Cognito
credentials and process-injection environment variables cannot be forwarded.
Server IDs use lowercase letters, digits, `_` or `-`, start with a letter, have
at most 32 characters, and cannot contain `__`.

Open the chat menu → **Local MCP connections** to enable a configured server or
refresh its tools. Servers start disabled. Trusted MCP programs have their own
local filesystem/network access; enabling one is an explicit local choice.
Phynite's CLI model sessions retain their separate tool isolation. The browser
uses only same-origin `/api/ai/mcp/servers`; private bridge credentials,
executable arguments, connection addresses and server environment never return
to the browser or model.

Discovered names use `mcp__<server>__<tool>` with deterministic SHA-256 shortening
when necessary. Only `annotations.readOnlyHint: true` tools are available in
Chat, Plan, Research and Summary; every other tool requires Work, a project and
execution permission. Approval mode creates an ordinary action card with exact
arguments and payload checksum. Full mode uses that same validated action
lifecycle. Editing/disabling a server or changing its tool schema invalidates a
previously reviewed capability. Custom skills can only narrow this tool set.

The bridge negotiates MCP `2025-03-26` (or `2024-11-05`), supports newline JSON-RPC
stdio and Streamable HTTP JSON/SSE responses, and validates a bounded JSON Schema
subset: types, properties/required/additionalProperties, items, enum/const,
anyOf/oneOf/allOf, numeric bounds and string/array lengths. Unsupported schema
keywords (including remote `$ref` and regular-expression constraints) reject
that server's discovery rather than silently bypassing validation. Limits are
eight servers, 48 discovered tools, 16 KB per schema, 32 KB arguments and 1 MiB
per response; discovery has a 10-second deadline and calls have a 30-second
deadline. Local MCP/action API requests allow up to 150 seconds for discovery,
capability revalidation and execution together; timed-out mutations are never
automatically retried. Abort/disable/shutdown terminates outstanding child sessions.

Only text and structured tool results reach the model, after credential and
private-artifact sanitization and structure-aware compaction. Omitted image or
resource blocks are counted explicitly. All outputs remain untrusted evidence;
MCP claims alone do not establish scientific validity. Errors are never recorded
as successful mutating actions. A failed or interrupted mutation must be
inspected before a new action is prepared.

## Collaborative artifact editing

Open a report, plan, input file or diff card and choose **Edit** on its latest
version. The CodeMirror 6 editor supports selection, undo/redo, Markdown, Python,
LaTeX and scientific input text. Preview renders inert Markdown or escaped code;
Phynite does not execute Python, compile user TeX or insert user HTML. Unsaved
changes block version switching and closing the viewer; discard explicitly or
export a draft to retain it before resolving a conflict. The browser also warns
before leaving a page with an unsaved editor.

**Save new version** creates an immutable draft attributed to the local researcher,
retains the parent ID/checksum and scientific sources, and removes any old
model-supplied input validation assessment. It never installs inputs or applies
project settings. Two editors cannot overwrite the same base version. A retry
uses the same request ID and returns the saved version instead of duplicating it.
Legacy artifacts remain readable and exportable; publish a typed copy to edit one.

AI text edits use `propose_artifact_patch`, with the exact source artifact ID and
SHA-256 returned by `read_artifact`. Each hunk includes unique exact source text,
a replacement and a reason; hunks cannot overlap. The researcher accepts or rejects
each independently. Acceptance creates a new immutable draft with the proposer
and decision provenance. Subsequent decisions on that proposal include prior
accepted hunks without shifting original offsets. An intervening editor save or
a different proposal's acceptance makes pending proposals stale; they cannot apply
to a changed base. Proposals expire after 24 hours. Review requires the current
proposal revision and an idempotent request ID. A decision and its artifact/group
update commit in one local transaction, including across a crash.

The model can propose hunks in any task mode but cannot call human Save or hunk
review endpoints. Existing custom-skill tool subsets do not gain the new tool
automatically. Table and figure updates retain their typed validators. Applying
an artifact to a project or executing a scientific input still requires the
separate validated action flow and its approval rules.
