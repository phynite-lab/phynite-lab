# Durable local AI and specialist tasks

The launcher starts a bundled Node 22 executor after it validates the Python core
session and before it starts the web app. The executor registers with that core,
uses the existing restricted native AI bridge, and opens no listener. It has no
SQLite access. Closing a browser tab does not stop accepted work while the launcher
and core remain active. Closing the launcher interrupts AI work and retains results.
Scientific campaign/job supervision stays separate; **Stop AI** never cancels a
scientific job.

The companion panel keeps one conversation with the coordinator's response, evidence
and reviewed actions. A live status describes thinking, source reading, specialist
work, synthesis or an approval wait. Specialist details expand in the conversation,
with objectives, model, dependencies, evidence and Stop/Retry. Resource counters are
in optional technical details. Idle conversations show no zero-task counter or extra
Chat/Tasks navigation. Use **+ → AI options** for strategy and permissions;
**+ → View activity** reopens retained task details. Drafts survive these controls.

**Auto** is the default. After qualification it asks the selected model to use Solo
for a simple request or a bounded set of independent specialists. **Solo** skips that
planning call. **Team** requires qualification. No provider or model fallback occurs.
Without qualification, Auto explicitly uses Solo on the selected model; Team is
unavailable. Context documents never supply permissions. Specialists receive bounded
selected snapshots and explicitly selected attachment metadata, use a restricted read
only tool set, and cannot create agents, execute actions, edit Notes or write files.
They return evidence and proposed changes to the coordinator.

All coordinator project changes require the existing action review, including chats
saved in legacy Full mode. One writer per project applies approved actions in order.
The next action rechecks its source stamp, revision, owner and exact payload after the
previous writer. An uncertain submission must be reconciled before Continue.

| Limit | Parent including all specialists | Each specialist |
| --- | --- | --- |
| Provider dispatches | 30, reserving 6 for coordinator | 8 |
| Tool calls | 40, reserving 4 for coordinator | 12 |
| Execution | 15 minutes across continuations | 5 minutes across retries |
| Capacity waiting | 10 minutes per admission | Same |
| Parent age | 1 hour | Within parent |

There are at most six specialists, without nested delegation, and at most two native
inference processes across the application's bridge, including model probes. Core
admission gives a waiting parent a turn before another specialist from an active
parent. The bridge independently enforces two slots and FIFO cancellation/expiry.
Provider dispatches and tool identities consume their saved budget once.
Antigravity's restricted startup and content turns each consume a provider call,
so one bridge request reserves two calls before dispatch. Codex retry notifications
stop the native turn instead of being silently ignored. Inference
is never automatically retried after dispatch. Manual Retry consumes remaining
budget, invalidates affected dependent results and replaces an in-progress synthesis.
A failure retains other task results. Budget exhaustion retains partial text and is
reported as a limit, rather than successful completion. Native token usage and cost
that are not measured are shown as **Not available / Belum tersedia**.

The core persists parent/task state, evidence, cancellation generations, checkpoints
and content-addressed result JSON. It issues a 30-second executor lease; the executor
heartbeats every five seconds. Stop, steering, project scope checks and generation
fences reject late reads, messages, inference and proposals. Steering retains earlier
records and starts a new plan at the new control revision. A crash marks in-flight
work interrupted and keeps completed results. **Continue retained work** reclaims the
same parent budget; interrupted specialists require a separate manual Retry. Pending
approvals remain reviewable after a crash. A newly sent message can start a new parent
without silently replaying the interrupted inbox item.

## Qualification and benchmark

Team has its own flag, independent of the Notes and Connected Files flags. The
launcher and source development runner supply the bundled reviewed evidence index
by default. `PHYNITE_AI_TEAM=0` explicitly disables it;
`PHYNITE_AI_TEAM_QUALIFICATION` can select another locally reviewed index. The core
still requires that index and its SHA-256 verified native evidence to match the exact
model and platform. Enabling the flag alone cannot qualify a target.
Native Windows and WSL1 cannot qualify. WSL2 has a separate platform identity, so a
Linux CI result never qualifies WSL2. Qualification is local, explicit and fails
closed on missing, changed, synthetic or unreviewed evidence.

Run reproducible scheduler checks without a provider:

```sh
npm run prepare:executor
npm run test:ai-executor
node --test tests/inference-admission.test.mjs
python -m unittest backend.tests.test_ai_orchestration -v
node --experimental-strip-types scripts/benchmark-ai-orchestration.mjs
```

The last command writes a **synthetic** report under ignored `.agent-state/`. It
compares Solo/Team scheduling, retained evidence, wall time and executor CPU/RSS.
Simulated latency is not a claim about real models, research quality or speedup and
cannot produce qualification. The protocol's expected evidence and output citations
need an independent quality review.

For actual native qualification, run the same benchmark with `--native --model ID`
in an explicitly configured, validated private bridge environment
(`PHYNITE_LOCAL_AI_URL` and `PHYNITE_LOCAL_AI_TOKEN`). Do not print credentials or
commit reports containing private research. `--case path.json` selects a JSON goal
and expectedEvidence list. The harness uses an ephemeral core/project and the exact
selected model. It records native dispatch intervals, actual provider/tool call
counts, latency, returned usage if measured, citations/results, and Node executor
CPU/RSS. Total core/provider resource usage and cost remain unavailable unless
measured separately. It retains no provider account identity or prompt credentials.

Review the report and safety tests on the real platform. Create a review JSON with
the same `modelId`, `platform`, SHA-256 of the exact saved report as `evidenceSha256`,
and explicit `safetyPassed: true` and `evidenceQualityReviewed: true` only after
that review. Seal those existing results without dispatching new inference:

```sh
node --experimental-strip-types scripts/benchmark-ai-orchestration.mjs \
  --review-existing .agent-state/native-benchmark.json \
  --review .agent-state/native-review.json \
  --qualification .agent-state/native-qualification.json
```

Changed evidence is rejected. A separate `.reviewed.json` keeps the original report
intact. Partial/failed results are saved before another benchmark case starts.
`--qualification` writes a checksummed index only for successful native Solo and
Team runs with observed overlap and review of those exact results. It writes
one model entry; use separate files or deliberately combine reviewed entries to
qualify additional models. A fake-provider test or machine label is insufficient.
Every specialist must complete, with at least two specialists in the Team case.
A completed synthesis that reports failed specialists cannot qualify a provider.

No real provider, Linux/WSL2 or HPC qualification is implied by local mock/protocol
tests. The core leaves each target off until this evidence exists. Connected
Files filesystem replacement and real WSL2 `/home` versus `/mnt/c` tests have their
own independent qualification requirements.

## Current qualification (2026-11-14)

The bundled index enables Team for **`agy/gemini-3.8-flash-high` on macOS ARM64**.
The actual run used Antigravity CLI 1.5.9 and Node 22.23.5. Both independent
specialists completed with overlapping native dispatches. Their project/Canvas
identities, exact revision, evidence references, checksums and counts match the saved
tool observations and the coordinator's synthesis. The native safety checks passed
two global slots, cancellation before queued dispatch and during streaming,
Stop/restart and rejection of late results. The raw benchmark, review and safety
record are included under `packages/phynite-lab/lib/team-qualification/`; the core
checks the evidence hash before enabling the matching model/platform.

Solo took 157,586 ms and 4 provider calls; Team took 369,794 ms and 12 calls. Both
read the same two kinds of saved source, using 2 tools. Team was slower on this
bounded empty-project case. This qualification establishes source-reading and
orchestration behavior, not scientific accuracy or a general speedup. Token usage,
cost and total provider/core resources were not measured. Other models and platforms
remain unqualified, including Flash Medium, Linux and WSL2. No HPC target was tested.

## Actual qualification observations (2026-11-13)

Actual Antigravity CLI 1.5.8 inference with `agy/gemini-3.8-flash-medium` on
macOS ARM64 overlapped independent source readers in an isolated empty project.
An initial case completed in 308,336 ms (Solo) and 706,488 ms (Team); Team was
slower. Actual native checks also exercised two global slots, cancellation of a
queued request before dispatch, cancellation during text, Stop/restart and refusal
of late results. These checks do not measure scientific accuracy.

A repeat with Node 22.23.5 and corrected startup/content call accounting completed
Solo in 713,544 ms and the Team synthesis in 735,081 ms. Both specialists failed:
one reached its five-minute limit, the other failed native protocol validation.
The synthesis disclosed these failures. This repeat fails evidence qualification
despite the parent status being `completed`; Team remains off. The initial result
does not establish reliable speedup or override this later failed qualification.
Usage, provider/core resource totals and cost were not measured.

Codex CLI 0.162.1 with `codex/gpt-6-luna` also did not qualify: trials stopped at
MCP catalogue validation (`UNSAFE_TOOLS`) or a native stream error. No safety check
was relaxed. The installed newer Codex CLI was outside the supported version range.
No WSL2 or HPC target was available; neither platform was qualified.

## Scope and verification

The four workspace changes are separate PRs from the 0.1.29 baseline: visual/composer,
Notes, Files, then orchestration. Compose their UI/route extension points in that
order and repeat integration checks before a release. Existing conversations and
foreground operation remain readable on older launchers; a new executor manifest
activates durable local execution. Packaging checksums the bundled executor and
includes its corresponding source/build input manifest. This change does not deploy,
merge or publish an application or activate paid compute.
