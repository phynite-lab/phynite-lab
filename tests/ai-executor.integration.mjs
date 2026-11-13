import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { executeParent } from '../scripts/ai-executor.ts';
import { AiError } from '../lib/ai-provider.ts';
import { buildAiExecutor } from '../scripts/build-ai-executor.mjs';

const python = process.env.PHYNITE_TEST_PYTHON ?? (existsSync('.local-backend/venv/bin/python') ? '.local-backend/venv/bin/python' : 'python3');
export function fixture({ unregistered = false } = {}) {
  const child = spawn(python, ['-m', 'backend.tests.ai_executor_fixture'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, PHYNITE_EXECUTOR_UNREGISTERED: unregistered ? '1' : '0' } });
  let sequence = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => {
    const reply = JSON.parse(line), request = pending.get(reply.id); pending.delete(reply.id);
    if (reply.error) request?.reject(new AiError(409, reply.code, reply.error)); else request?.resolve(reply.result);
  });
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('Core fixture exited.')); pending.clear(); });
  const core = (operation, data = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, operation, data }) + '\n');
  });
  return { core, close: () => child.stdin.end() };
}
const response = (text, calls = []) => ({ content: [...(text ? [{ type: 'text', text }] : []), ...calls], continuation: [...(text ? [{ type: 'text', text }] : []), ...calls], usage: { inputTokens: 7, outputTokens: 4 }, stopReason: calls.length ? 'tool_use' : 'end_turn' });
const config = { baseUrl: 'http://127.0.0.1:1', token: '', providerId: 'local', local: true, modelIds: ['codex/fixture'] };
const options = { pollMs: 10, heartbeatMs: 20 };
const status = (core, job) => core('public', { conversationId: job.parent.conversationId, action: 'status' });

export function syntheticInference({ failFirst = false, hold = false } = {}) {
  let active = 0, maximum = 0;
  const dispatches = [], tools = new Set();
  const infer = async request => {
    const specialist = request.system.includes('Specialist:');
    dispatches.push({ specialist, start: performance.now(), modelId: request.modelId });
    const record = dispatches.at(-1);
    if (request.system.startsWith('Choose Solo')) return response(JSON.stringify({ tasks: [{ goal: 'Review source A', dependencies: [] }, { goal: 'Review source B', dependencies: [] }] }));
    active++; maximum = Math.max(maximum, active);
    try {
      await delay(hold && specialist ? 3000 : 100, undefined, { signal: request.signal });
      const sourceA = JSON.stringify(request.messages[0]).includes('source A');
      if (specialist && sourceA && failFirst) throw new AiError(503, 'INFERENCE_FAILED', 'Synthetic provider disconnected; retry manually.');
      if (specialist && !tools.has(request.messages[0].content)) {
        tools.add(request.messages[0].content);
        return response('', [{ type: 'tool_use', id: sourceA ? 'read_A' : 'read_B', name: 'get_context', input: {} }]);
      }
      const text = specialist ? 'Source inspected; conclusions remain bounded by recorded evidence.' : 'Synthesis: evidence reviewed; failed or unverified parts remain explicit.';
      request.onText(text); return response(text);
    } finally { active--; record.end = performance.now(); }
  };
  return { infer, dispatches, get maximum() { return maximum; } };
}

if (process.argv[1]?.endsWith('ai-executor.integration.mjs')) {
  test('launcher executor overlaps two real-core tasks and retains checksummed evidence', async () => {
    const { core, close } = fixture();
    try {
      const job = await core('setup'), native = syntheticInference();
      await executeParent(job, core, config, new AbortController().signal, undefined, { ...options, infer: native.infer });
      const saved = await status(core, job);
      assert.equal(native.maximum, 2); assert.equal(saved.parent.status, 'completed');
      assert.ok(native.dispatches.every(call => call.modelId === 'codex/fixture'));
      assert.equal(saved.tasks.length, 2);
      for (const task of saved.tasks) { assert.equal(task.status, 'completed'); assert.match(task.resultSha256, /^[a-f0-9]{64}$/); assert.ok(task.result.evidenceRefs.some(ref => ref.operation === 'context' && /^[a-f0-9]{64}$/.test(ref.sha256))); }
      assert.equal(saved.parent.toolCalls, 2); assert.equal(saved.parent.providerCalls, native.dispatches.length);
    } finally { close(); }
  });
  test('one provider failure retains the other result without retry or model fallback', async () => {
    const { core, close } = fixture();
    try {
      const job = await core('setup'), native = syntheticInference({ failFirst: true });
      await executeParent(job, core, config, new AbortController().signal, undefined, { ...options, infer: native.infer });
      const saved = await status(core, job);
      assert.deepEqual(saved.tasks.map(task => task.status), ['failed', 'completed']);
      assert.equal(saved.tasks[0].providerCalls, 1); assert.equal(saved.parent.status, 'completed');
      assert.match(saved.tasks[0].error, /disconnected/); assert.ok(saved.tasks[1].result.text);
    } finally { close(); }
  });
  test('Stop rejects late inference and leaves no running children', async () => {
    const { core, close } = fixture();
    try {
      const job = await core('setup'), native = syntheticInference({ hold: true });
      const executing = executeParent(job, core, config, new AbortController().signal, undefined, { ...options, infer: native.infer });
      const rejected = assert.rejects(executing);
      for (let attempt = 0; native.maximum < 2 && attempt < 200; attempt++) await delay(10);
      assert.equal(native.maximum, 2);
      await core('stop', { conversationId: job.parent.conversationId, parentId: job.parent.id });
      await rejected;
      const saved = await status(core, job);
      assert.equal(saved.parent.status, 'stopped'); assert.ok(saved.tasks.every(task => task.status === 'stopped'));
      assert.ok(saved.tasks.every(task => task.messages.length <= 1));
    } finally { close(); }
  });
  test('account change interrupts the parent and never dispatches another inference', async () => {
    const { core, close } = fixture();
    try {
      const job = await core('setup'), native = syntheticInference({ hold: true });
      const verify = async () => { if (native.maximum === 2) throw new Error('Provider account changed. Continue explicitly.'); };
      await assert.rejects(executeParent(job, core, config, new AbortController().signal, verify, { ...options, infer: native.infer }));
      const saved = await status(core, job);
      assert.equal(saved.parent.status, 'interrupted'); assert.match(saved.parent.reason, /account changed/);
      assert.equal(native.dispatches.length, 3);
    } finally { close(); }
  });
  test('steering fences an old executor and preserves completed source identities', async () => {
    const { core, close } = fixture();
    try {
      const job = await core('setup'), native = syntheticInference({ hold: true });
      const executing = executeParent(job, core, config, new AbortController().signal, undefined, { ...options, infer: native.infer });
      const rejected = assert.rejects(executing);
      for (let attempt = 0; native.maximum < 2 && attempt < 200; attempt++) await delay(10);
      assert.equal(native.maximum, 2);
      await core('steer', { conversationId: job.parent.conversationId });
      await rejected;
      const revised = await core('claim');
      assert.equal(revised.parent.controlRevision, 1); assert.equal(revised.tasks.length, 0);
      assert.ok(revised.parent.generation > job.parent.generation);
    } finally { close(); }
  });
  test('slow heartbeats stay bounded while six large results retain every task and user goal', async () => {
    const { core: authority, close } = fixture();
    let heartbeats = 0, maximum = 0;
    const core = async (operation, data) => {
      if (operation !== 'heartbeat') return authority(operation, data);
      heartbeats++; maximum = Math.max(maximum, heartbeats);
      try { await delay(40); return await authority(operation, data); }
      finally { heartbeats--; }
    };
    try {
      const goal = 'Keep this exact user goal in the final synthesis.';
      const job = await core('setup', { goal });
      let synthesis;
      const infer = async request => {
        if (request.system.startsWith('Choose Solo')) return response(JSON.stringify({ tasks: Array.from({ length: 6 }, (_, index) => ({ goal: `Distinct specialist ${index}` })) }));
        if (request.system.includes('Specialist:')) return response('&<source>'.repeat(5000));
        synthesis = request.messages;
        return response('All six specialists are represented; long evidence remains in Tasks.');
      };
      await executeParent(job, core, config, AbortSignal.timeout(12000), undefined, { ...options, infer });
      assert.equal(maximum, 1, 'Slow heartbeat responses must not accumulate concurrent refreshes.');
      const rendered = JSON.stringify(synthesis);
      assert.ok(rendered.includes(goal));
      for (let index = 0; index < 6; index++) assert.ok(rendered.includes(`Distinct specialist ${index}`));
      assert.ok(rendered.includes('truncated'));
      assert.ok(rendered.length < 180000);
      const saved = await status(core, job);
      assert.equal(saved.tasks.length, 6);
      assert.ok(saved.tasks.every(task => task.result.text.length > 30000));
    } finally { close(); }
  });
  test('bundled launcher process completes queued work with no browser observer', { timeout: 20000 }, async () => {
    const { core, close } = fixture({ unregistered: true });
    const directory = await mkdtemp(join(tmpdir(), 'phynite-executor-process-'));
    const servers = [];
    let executor, exited, output = '', dispatches = 0, active = 0, maximum = 0;
    const listen = async handler => {
      const server = createServer(handler); servers.push(server);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    };
    const json = async request => { let text = ''; for await (const part of request) text += part; return JSON.parse(text || '{}'); };
    try {
      const api = await listen(async (request, reply) => {
        try {
          assert.equal(request.headers.authorization, 'Bearer fixture-core-token');
          const result = await core(request.url.split('/').at(-1), await json(request));
          reply.setHeader('Content-Type', 'application/json'); reply.end(JSON.stringify(result));
        } catch (error) { reply.statusCode = 409; reply.end(JSON.stringify({ error: error.message, code: error.code })); }
      });
      const bridge = await listen(async (request, reply) => {
        assert.equal(request.headers.authorization, 'Bearer fixture-bridge-token');
        if (request.url === '/status') {
          reply.setHeader('Content-Type', 'application/json');
          reply.end(JSON.stringify({ models: [{ id: 'codex/fixture', available: true }], providers: [{ id: 'codex', activeAccountId: 'fixture-account', status: 'connected' }], capabilities: { models: { 'codex/fixture': { efforts: ['auto'] } } } }));
          return;
        }
        const payload = await json(request); assert.equal(payload.model, 'codex/fixture'); dispatches++;
        // Simulate dispatch latency across a real HTTP/SSE boundary. No native provider is called.
        active++; maximum = Math.max(maximum, active);
        await delay(1200);
        reply.setHeader('Content-Type', 'text/event-stream');
        for (const event of [
          { type: 'message_start', message: { usage: { input_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Synthetic process result; no scientific claims.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
          { type: 'message_stop' },
        ]) reply.write(`data: ${JSON.stringify(event)}\n\n`);
        reply.end(); active--;
      });
      const entry = join(directory, 'executor.mjs'); await buildAiExecutor(entry);
      const queued = [];
      for (let index = 0; index < 3; index++) queued.push(await core('setup', { strategy: 'solo', qualified: false, enqueueOnly: true }));
      executor = spawn(process.execPath, [entry], { env: { ...process.env, PHYNITE_LOCAL_API_URL: api, PHYNITE_LOCAL_SERVICE_TOKEN: 'fixture-core-token', PHYNITE_LOCAL_AI_URL: bridge, PHYNITE_LOCAL_AI_TOKEN: 'fixture-bridge-token' }, stdio: ['ignore', 'pipe', 'pipe'] });
      exited = new Promise(resolve => executor.once('exit', resolve));
      executor.stderr.on('data', value => { output += value; }); executor.stdout.on('data', value => { output += value; });
      let saved, admittedAllWhileBusy = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        saved = await Promise.all(queued.map(item => core('public', { conversationId: item.conversationId, action: 'status' })));
        if (saved.every(item => item.parent) && saved.filter(item => item.parent?.status === 'running').length === 3) admittedAllWhileBusy = true;
        if (saved.every(item => item.parent?.status === 'completed') || executor.exitCode !== null) break;
        await delay(50);
      }
      assert.ok(saved.every(item => item.parent?.status === 'completed'), output);
      assert.ok(saved.every(item => item.parent.resolvedStrategy === 'solo'));
      assert.ok(admittedAllWhileBusy, 'A third conversation must enter core admission while the first two are running.');
      assert.equal(maximum, 2);
      assert.equal(saved.reduce((sum, item) => sum + item.parent.providerCalls, 0), dispatches);
      assert.equal((await core('metrics', { parentId: saved[0].parent.id })).inference.filter(slot => slot.status === 'active').length, 0);
    } finally {
      executor?.kill('SIGTERM'); if (exited) await exited;
      for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      close(); await rm(directory, { recursive: true, force: true });
    }
  });
}
