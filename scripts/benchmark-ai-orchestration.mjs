/** Compare the same bounded goal, using a temporary core and an explicit provider. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { platform, arch, release } from 'node:os';
import { createHash } from 'node:crypto';
import { fixture, syntheticInference } from '../tests/ai-executor.integration.mjs';
import { executeParent } from './ai-executor.ts';

const args = process.argv.slice(2), flag = name => args.includes(name);
const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const native = flag('--native'), modelId = value('--model') ?? 'codex/fixture';
const output = resolve(value('--output') ?? '.agent-state/ai-orchestration-benchmark.json');
const system = platform() === 'linux' && /microsoft/i.test(release()) ? /wsl2/i.test(release()) ? 'linux-wsl2' : 'unsupported-wsl1' : platform();
const target = `${system}-${arch() === 'arm64' ? 'arm64' : 'x86_64'}`;
// Python platform.machine() uses arm64 on Darwin and aarch64 on Linux ARM64.
const qualificationTarget = target.replace(/^(linux(?:-wsl2)?)-arm64$/, '$1-aarch64');
let config = { baseUrl: 'http://127.0.0.1:1', token: '', providerId: 'local', local: true, modelIds: [modelId] };
let nativeStatus;
if (native) {
  const url = new URL(process.env.PHYNITE_LOCAL_AI_URL ?? '');
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use the validated launcher-owned loopback bridge.');
  const token = process.env.PHYNITE_LOCAL_AI_TOKEN;
  if (!token || modelId === 'codex/fixture') throw new Error('Native benchmark requires an explicitly selected model and private bridge session.');
  nativeStatus = async () => {
    const reply = await fetch(url.origin + '/status', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
    if (!reply.ok) throw new Error('Native bridge status is unavailable.'); return reply.json();
  };
  const status = await nativeStatus();
  if (!status.models.some(model => model.id === modelId && model.available)) throw new Error('The exact selected model has not passed native inference checks.');
  config = { ...config, baseUrl: url.origin, token, modelCapabilities: status.capabilities.models };
}
const protocol = value('--case') ? JSON.parse(await readFile(value('--case'), 'utf8')) : {
  goal: 'Independently inspect the saved project inventory and Canvas, then compare the evidence, source identity and verification limits. Do not change project data or run scientific jobs.',
  expectedEvidence: ['saved project inventory', 'saved Canvas revision'],
};
if (typeof protocol.goal !== 'string' || !protocol.goal.trim() || protocol.goal.length > 12000) throw new Error('Provide a bounded benchmark goal.');
const report = { schemaVersion: 1, kind: native ? 'native-provider' : 'synthetic', modelId,
  platform: qualificationTarget, createdAt: new Date().toISOString(), protocol,
  safetyPassed: false, evidenceQualityReviewed: false, overlapObserved: false, runs: {},
  limits: 'Synthetic inference measures scheduling only. Native qualification also needs reviewed safety and evidence quality. CPU/RSS below cover this Node executor; provider/core resource totals and cost are not measured.' };
for (const strategy of ['solo', 'team']) {
  const { core, close } = fixture(), synthetic = syntheticInference();
  const start = performance.now(), wallStart = Date.now(), cpu = process.cpuUsage();
  try {
    const job = await core('setup', { modelId, strategy, goal: protocol.goal });
    await executeParent(job, core, config, new AbortController().signal, undefined,
      { pollMs: 20, ...(native ? {} : { infer: synthetic.infer }) });
    const state = await core('public', { conversationId: job.parent.conversationId, action: 'status' });
    const metrics = await core('metrics', { parentId: job.parent.id });
    const cpuUsed = process.cpuUsage(cpu);
    const dispatch = native ? (await nativeStatus()).inference?.recent.filter(record => record.modelId === modelId && record.startedAt >= wallStart) ?? [] : synthetic.dispatches.filter(record => record.specialist).map(record => ({ startedAt: record.start, endedAt: record.end }));
    const overlap = dispatch.some((a, index) => dispatch.slice(index + 1).some(b => a.endedAt && b.endedAt && Math.max(a.startedAt, b.startedAt) < Math.min(a.endedAt, b.endedAt)));
    report.runs[strategy] = { status: state.parent.status, latencyMs: performance.now() - start,
      providerCalls: state.parent.providerCalls, toolCalls: state.parent.toolCalls,
      executorCpuMicros: cpuUsed.user + cpuUsed.system, executorMaxRssBytes: process.resourceUsage().maxRSS * 1024,
      totalResourceUsage: null, cost: null, usage: metrics.usage && Object.values(metrics.usage).some(value => value > 0) ? metrics.usage : null,
      evidenceRefs: state.tasks.flatMap(task => task.evidence),
      transcript: metrics.messages.filter(message => message.role === 'assistant').map(message => message.text),
      tasks: state.tasks.map(task => ({ goal: task.goal, status: task.status, evidence: task.evidence, result: task.result })),
      dispatch, overlapObserved: overlap, evidenceQuality: { score: null, review: 'Required; compare citations, uncertainty and expected evidence with source records.' } };
    if (strategy === 'team') report.overlapObserved = overlap;
  } finally { close(); }
}
if (value('--review')) {
  const review = JSON.parse(await readFile(value('--review'), 'utf8'));
  if (review.modelId !== modelId || review.platform !== qualificationTarget) throw new Error('Review must identify the same provider/model/platform.');
  report.safetyPassed = review.safetyPassed === true;
  report.evidenceQualityReviewed = review.evidenceQualityReviewed === true;
  report.review = review;
}
const encoded = JSON.stringify(report, null, 2) + '\n';
await mkdir(dirname(output), { recursive: true }); await writeFile(output, encoded);
if (value('--qualification')) {
  if (!native || !report.safetyPassed || !report.evidenceQualityReviewed || !report.overlapObserved || Object.values(report.runs).some(run => run.status !== 'completed')) throw new Error('Benchmark saved; qualification requires actual native overlap, successful runs and explicit reviewed evidence/safety.');
  const qualification = resolve(value('--qualification'));
  await mkdir(dirname(qualification), { recursive: true });
  await writeFile(qualification, JSON.stringify({ schemaVersion: 1, entries: [{ modelId, platform: qualificationTarget, passed: true,
    evidenceFile: relative(dirname(qualification), output), evidenceSha256: createHash('sha256').update(encoded).digest('hex') }] }, null, 2) + '\n');
}
console.log(JSON.stringify({ output, kind: report.kind, qualified: Boolean(value('--qualification')), latencyMs: Object.fromEntries(Object.entries(report.runs).map(([key, run]) => [key, Math.round(run.latencyMs)])), cost: 'Belum tersedia' }));
