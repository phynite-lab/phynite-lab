import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewportRegistry } from '../lib/ai-viewport.ts';
import { millerPlane } from '../lib/miller-plane.ts';
import { aiTools, executeAiTool, type AiBackend } from '../lib/ai-tools.ts';

test('Miller planes use the reciprocal of an oblique lattice and physical spacing', () => {
  const result = millerPlane([[2,0,0],[1,3,0],[0.5,0.3,4]], [1,1,0], 1);
  assert.ok(result.vertices.length >= 3);
  for (const p of result.vertices) assert.ok(Math.abs(p[0] + p[1] - 1) < 1e-10);
  assert.ok(Math.abs(result.normal[0] * 1 + result.normal[1] * 3 - 2 * result.normal[0]) < 1e-10);
  assert.ok(Math.abs(result.spacingAngstrom - 1 / Math.hypot(0.5, 1/6, -0.075)) < 1e-10);
  assert.deepEqual(millerPlane([[1,0,0],[0,1,0],[0,0,1]], [-1,0,0], -0.4).vertices.map(p=>p[0]), [0.4,0.4,0.4,0.4]);
  assert.equal(millerPlane([[1,0,0],[0,1,0],[0,0,1]], [1,0,0], 5).vertices.length, 0);
  assert.throws(() => millerPlane([[1,0,0],[0,1,0],[0,0,1]], [0,0,0], 1));
  assert.throws(() => millerPlane([[1,0,0],[2,0,0],[0,0,1]], [1,0,0], 1));
});

test('registry fences owner, project, visibility, dirty sources and source changes mid-capture', async () => {
  const registry = new ViewportRegistry(), abort = new AbortController();
  const element = { isConnected: true, closest: () => null, getBoundingClientRect: () => ({ width: 10, height: 10 }) } as unknown as HTMLElement;
  const scope = { owner: 'researcher', projectKey: 'project:fixture', ref: { kind: 'node' as const, id: 'crystal' }, saved: true };
  let finish: ((value: { blob: Blob; metadata: Record<string, unknown> }) => void) | undefined;
  const remove = registry.register({ scope, element, capture: () => new Promise(resolve => { finish = resolve; }) });
  await assert.rejects(registry.capture('other', scope.projectKey, scope.ref, abort.signal), /UNAVAILABLE/);
  await assert.rejects(registry.capture(scope.owner, 'other', scope.ref, abort.signal), /UNAVAILABLE/);
  const pending = registry.capture(scope.owner, scope.projectKey, scope.ref, abort.signal);
  remove(); finish!({ blob: new Blob(['png'], { type: 'image/png' }), metadata: {} });
  await assert.rejects(pending, /CHANGED/);
  registry.register({ scope: { ...scope, saved: false }, element, capture: async () => { throw new Error('must not run'); } });
  await assert.rejects(registry.capture(scope.owner, scope.projectKey, scope.ref, abort.signal), /UNSAVED/);
  abort.abort(); await assert.rejects(registry.capture(scope.owner, scope.projectKey, scope.ref, abort.signal));
});

test('capture tool remains read-only, respects narrowed skills, and returns revocation explicitly', async () => {
  assert.ok(aiTools('chat', true).some(tool => tool.name === 'capture_viewport'));
  assert.ok(!aiTools('full', true, ['read_canvas']).some(tool => tool.name === 'capture_viewport'));
  const backend: AiBackend = async <T,>(operation: string) => ({ capture: { id: 'capture', status: operation === 'capture_request' ? 'pending' : 'cancelled', error: 'Permission revoked.' } }) as T;
  await assert.rejects(executeAiTool('capture_viewport', { sourceRef: { kind: 'node', id: 'node' } }, 'chat', backend, new AbortController().signal, 'call'), /revoked/);
});
