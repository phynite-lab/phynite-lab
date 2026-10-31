import assert from 'node:assert/strict';
import test from 'node:test';
import { createMdWorkerClient } from '../lib/md-worker-client.ts';

class TestWorker extends EventTarget {
  sent: Array<Record<string, unknown>> = [];
  terminated = false;
  failPost = false;
  postMessage(message: Record<string, unknown>) {
    if (this.failPost) throw new Error('DataCloneError');
    this.sent.push(message);
  }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
  crash() { this.dispatchEvent(new Event('error', { cancelable: true })); }
}
function setup(startupTimeoutMs = 500, requestTimeoutMs = 500) {
  const port = new TestWorker();
  const client = createMdWorkerClient(() => port as unknown as Worker, { startupTimeoutMs, requestTimeoutMs });
  return { port, client };
}

test('requests wait until parser startup and match out-of-order replies to the right caller', async () => {
  const { port, client } = setup();
  const first = client.run({ operation: 'parse', name: 'first.xyz' });
  const second = client.run({ operation: 'parse', name: 'second.xyz' });
  assert.equal(port.sent.length, 0);
  port.reply({ type: 'ready' });
  await Promise.resolve();
  assert.equal(port.sent.length, 2);
  port.reply({ id: port.sent[1].id, result: 'second' });
  port.reply({ id: port.sent[0].id, result: 'first' });
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  client.dispose();
});

test('worker crash is recoverable on the next trajectory request', async () => {
  const ports: TestWorker[] = [];
  const client = createMdWorkerClient(() => {
    const port = new TestWorker();
    ports.push(port);
    return port as unknown as Worker;
  });
  ports[0].crash();
  const next = client.run({ operation: 'parse' });
  assert.equal(ports.length, 2);
  ports[1].reply({ type: 'ready' });
  await Promise.resolve();
  ports[1].reply({ id: ports[1].sent[0].id, result: 'recovered' });
  assert.equal(await next, 'recovered');
  assert.equal(ports[0].terminated, true);
  client.dispose();
});

test('blocked worker construction is reported without an uncaught effect error', async () => {
  const client = createMdWorkerClient(() => { throw new Error('SecurityError'); });
  await assert.rejects(client.run({ operation: 'parse' }), /could not start/);
  client.dispose();
});

test('worker startup timeout releases waiting imports', async () => {
  const { port, client } = setup(10);
  await assert.rejects(client.run({ operation: 'parse' }), /did not start/);
  assert.equal(port.terminated, true);
  client.dispose();
});

test('unresponsive worker times out one generation and later imports use a fresh worker', async () => {
  const ports: TestWorker[] = [];
  const client = createMdWorkerClient(() => {
    const port = new TestWorker();
    ports.push(port);
    return port as unknown as Worker;
  }, { startupTimeoutMs: 500, requestTimeoutMs: 10 });
  ports[0].reply({ type: 'ready' });
  await assert.rejects(client.run({ operation: 'parse' }), /processing timed out/);
  const recovered = client.run({ operation: 'parse' });
  assert.equal(ports.length, 2);
  ports[1].reply({ type: 'ready' });
  await Promise.resolve();
  ports[1].reply({ id: ports[1].sent[0].id, result: { frames: 1 } });
  assert.deepEqual(await recovered, { frames: 1 });
  assert.equal(ports[0].terminated, true);
  client.dispose();
});

test('malformed input rejects its own job while the reader remains available', async () => {
  const { port, client } = setup();
  port.reply({ type: 'ready' });
  const invalid = client.run({ operation: 'parse' });
  port.reply({ id: port.sent[0].id, error: 'Incomplete XYZ frame' });
  await assert.rejects(invalid, /Incomplete XYZ/);
  const next = client.run({ operation: 'parse' });
  port.reply({ id: port.sent[1].id, result: { frames: 25 } });
  assert.deepEqual(await next, { frames: 25 });
  assert.equal(port.terminated, false);
  client.dispose();
});

test('message deserialization failure settles pending imports', async () => {
  const { port, client } = setup();
  port.reply({ type: 'ready' });
  const request = client.run({ operation: 'parse' });
  port.dispatchEvent(new Event('messageerror'));
  await assert.rejects(request, /could not return/);
  client.dispose();
});

test('closing the workspace and failed postMessage both settle outstanding requests', async () => {
  const { port, client } = setup();
  port.reply({ type: 'ready' });
  port.failPost = true;
  await assert.rejects(client.run({ operation: 'parse' }), /Could not send/);
  port.failPost = false;
  const pending = client.run({ operation: 'parse' });
  client.dispose();
  await assert.rejects(pending, /closed/);
  assert.equal(port.terminated, true);
});
