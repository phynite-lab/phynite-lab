# Durable local AI and specialist tasks

The launcher starts a bundled Node 22 executor after it validates the Python core
session and before it starts the web app. The executor registers with that core,
uses the existing restricted native AI bridge, and opens no listener. It has no
SQLite access. Closing a browser tab does not stop accepted work while the launcher
and core remain active. Closing the launcher interrupts AI work and retains results.
Scientific campaign/job supervision stays separate; **Stop AI** never cancels a
scientific job.

The companion panel has **Chat** and **Tasks** views. Chat contains the coordinator's
response, evidence and reviewed actions. Tasks shows each specialist's objective,
selected model, dependencies, sources/checksums, evidence, result and Stop/Retry
controls. Task details expand within this panel. Strategy appears in model settings
and in the composer summary. The input draft survives switching views and resizing.

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

Team has its own flag, independent of the Notes and Connected Files flags:
`PHYNITE_AI_TEAM=1` plus `PHYNITE_AI_TEAM_QUALIFICATION` pointing to an evidence index.
These explicit launcher settings reach the core. They do not activate Team unless
that index and its SHA-256 verified evidence match the exact model and platform.
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

No real provider, Linux/WSL2 or HPC qualification is implied by local mock/protocol
tests. The implementation leaves Team off until this evidence exists. Connected
Files filesystem replacement and real WSL2 `/home` versus `/mnt/c` tests have their
own independent qualification requirements.

## Scope and verification

The four workspace changes are separate PRs from the 0.1.29 baseline: visual/composer,
Notes, Files, then orchestration. Compose their UI/route extension points in that
order and repeat integration checks before a release. Existing conversations and
foreground operation remain readable on older launchers; a new executor manifest
activates durable local execution. Packaging checksums the bundled executor and
includes its corresponding source/build input manifest. This change does not deploy,
merge or publish an application or activate paid compute.
