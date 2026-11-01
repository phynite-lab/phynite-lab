import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSameOriginMdCloudTransport,
  createMdCloudApiClient,
  createMdCloudStorageClient,
  DEFAULT_MD_CLOUD_CAPABILITIES,
  fromMdCloudSimulationWorkflow,
  fromMdCloudStudioSettings,
  initialMdCloudComputeState,
  mdCloudComputeReducer,
  mdCloudContentType,
  mdCloudPollDelay,
  mdCloudSaveKey,
  mdCloudSha256,
  nextMdCloudPollDelay,
  resolveMdCloudAvailability,
  toMdCloudPipelineModifier,
  toMdCloudStudioSettings,
  uploadMdCloudPresignedPost,
  type MdCloudAnalysis,
  type MdCloudAnalysisResponse,
  type MdCloudTrajectory,
  type MdCloudTransport,
  type MdCloudTransportRequest,
} from '../lib/md-cloud-api.ts';
import type { MdSimulationWorkflowV2 } from '../lib/md-simulation-types.ts';
import { PhyniteApiError } from '../lib/phynite-api.ts';

const trajectory = (patch: Partial<MdCloudTrajectory> = {}): MdCloudTrajectory => ({
  id: 'trajectory-1',
  projectId: 'project-1',
  filename: 'copper.dump',
  sizeBytes: 12,
  format: 'lammps-dump',
  sha256: 'f'.repeat(64),
  status: 'UPLOAD_PENDING',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
  revision: 0,
  ...patch,
});

const analysis = (status: MdCloudAnalysis['status'], patch: Partial<MdCloudAnalysis> = {}): MdCloudAnalysis => ({
  id: 'analysis-1',
  projectId: 'project-1',
  trajectoryId: 'trajectory-1',
  status,
  progress: status === 'COMPLETED' ? 100 : 20,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:01:00.000Z',
  ...patch,
});

test('managed MD compute is unavailable by default and construction performs no I/O', () => {
  let requests = 0;
  const client = createMdCloudApiClient({
    transport: { request: async <T>() => { requests += 1; return {} as T; } },
  });
  assert.deepEqual(client.availability, { available: false, reason: 'feature_disabled' });
  assert.throws(() => client.getAnalysis('analysis-1'), /feature_disabled/);
  assert.equal(requests, 0);
  assert.deepEqual(resolveMdCloudAvailability({ enabled: true }, DEFAULT_MD_CLOUD_CAPABILITIES), {
    available: false,
    reason: 'service_disabled',
  });
});

test('MD cloud storage works independently from the dormant compute feature gate', async () => {
  const requests: MdCloudTransportRequest[] = [];
  const storage = createMdCloudStorageClient({
    transport: {
      request: async <T>(request: MdCloudTransportRequest) => {
        requests.push(request);
        if (request.method === 'PATCH') return { trajectory: trajectory({ status: 'READY' }) } as T;
        if (request.path.endsWith('/md/analyses')) {
          return { analyses: [analysis('COMPLETED')] } as T;
        }
        if (request.path.includes('/md/analyses/') && request.path.includes('/artifacts/')) {
          return {
            url: 'https://downloads.invalid/timeline',
            path: 'timeline.json.gz',
            contentType: 'application/json',
            contentEncoding: 'gzip',
            sizeBytes: 120,
            sha256: 'a'.repeat(64),
            expiresIn: 900,
          } as T;
        }
        if (request.path.includes('/md/analyses/')) {
          return { analysis: analysis('COMPLETED') } as T;
        }
        if (request.method === 'GET' && request.path.includes('/md/trajectories/')) {
          return { trajectory: trajectory({ status: 'READY' }), downloadUrl: 'https://downloads.invalid/source' } as T;
        }
        return { trajectories: [] } as T;
      },
    },
  });
  await storage.listTrajectories('project/one');
  const opened = await storage.getTrajectory('trajectory/one');
  await storage.updateTrajectory('trajectory/one', {
    name: 'Copper run',
    baseRevision: 3,
    clientMutationId: 'rename-copper-run',
  });
  await storage.listAnalyses('project/one');
  await storage.getAnalysis('analysis/one');
  const artifact = await storage.getAnalysisArtifact('analysis/one', 'timeline.json.gz');
  assert.equal(opened.downloadUrl, 'https://downloads.invalid/source');
  assert.equal(artifact.url, 'https://downloads.invalid/timeline');
  assert.deepEqual(requests, [
    { path: '/v1/projects/project%2Fone/md/trajectories', method: 'GET' },
    { path: '/v1/md/trajectories/trajectory%2Fone', method: 'GET' },
    {
      path: '/v1/md/trajectories/trajectory%2Fone',
      method: 'PATCH',
      body: { name: 'Copper run', baseRevision: 3, clientMutationId: 'rename-copper-run' },
    },
    { path: '/v1/projects/project%2Fone/md/analyses', method: 'GET' },
    { path: '/v1/md/analyses/analysis%2Fone', method: 'GET' },
    { path: '/v1/md/analyses/analysis%2Fone/artifacts/timeline.json.gz', method: 'GET' },
  ]);
  assert.throws(
    () => storage.getAnalysisArtifact('analysis-1', 'frames/../result.json.gz' as never),
    /artifact path is invalid/,
  );
  assert.throws(() => createMdCloudStorageClient().listTrajectories('project-1'), /storage transport is unavailable/);
});

test('MD cloud trajectory updates downgrade once for an older deployed API contract', async () => {
  const requests: MdCloudTransportRequest[] = [];
  const storage = createMdCloudStorageClient({
    transport: {
      request: async <T>(request: MdCloudTransportRequest) => {
        requests.push(request);
        if (requests.length === 1) {
          throw new PhyniteApiError(400, 'Trajectory update is invalid.', 'INVALID_MD_TRAJECTORY_UPDATE');
        }
        return { trajectory: trajectory({ status: 'READY', name: 'Copper run' }) } as T;
      },
    },
  });

  await storage.updateTrajectory('trajectory-1', {
    name: 'Copper run',
    baseRevision: 4,
    clientMutationId: 'save-copper-run',
  });
  await storage.updateTrajectory('trajectory-1', {
    name: 'Copper run 2',
    baseRevision: 5,
    clientMutationId: 'save-copper-run-2',
  });

  assert.deepEqual(requests.map(request => request.body), [
    { name: 'Copper run', baseRevision: 4, clientMutationId: 'save-copper-run' },
    { name: 'Copper run' },
    { name: 'Copper run 2' },
  ]);
});

test('MD Lab cloud settings and source identity round-trip without mutating the UI state', async () => {
  const settings = {
    modifiers: [{ id: 'repeat-1', kind: 'replicate' as const, enabled: true, params: { repeat: [2, 3, 1] } }],
    colorBy: 'Species',
    palette: 'turbo' as const,
    atomScale: 1.2,
    showCell: true,
    showBonds: false,
    hideBulk: false,
    periodic: [true, false, true] as [boolean, boolean, boolean],
    timeStepPs: 0.002,
    fps: 24,
    loop: true,
    typeMap: { '1': 'Cu' },
  };
  const wire = toMdCloudStudioSettings(settings);
  assert.deepEqual(wire.pipeline.modifiers[0].params, { numX: 2, numY: 3, numZ: 1 });
  const serverNormalized = structuredClone(wire);
  serverNormalized.pipeline.modifiers[0].params = { repeat: [2, 3, 1] };
  assert.deepEqual(fromMdCloudStudioSettings(serverNormalized), settings);
  assert.deepEqual(settings.modifiers[0].params, { repeat: [2, 3, 1] });

  const source = new Blob(['trajectory']);
  const sha256 = await mdCloudSha256(source);
  assert.match(sha256, /^[a-f0-9]{64}$/);
  const firstSaveKey = await mdCloudSaveKey('project-1', sha256, 'run.dump', 'device-record-1');
  assert.match(firstSaveKey, /^md-save-[a-f0-9]{64}$/);
  assert.notEqual(firstSaveKey, await mdCloudSaveKey('project-1', sha256, 'run.dump', 'device-record-2'));
  assert.equal(mdCloudContentType('run.dump', ''), 'application/x-lammps');
  assert.equal(mdCloudContentType('structure.cif', 'text/html'), 'chemical/x-cif');
});

test('MD Lab version 2 settings preserve an ordered simulation workflow', () => {
  const settings = {
    modifiers: [],
    colorBy: 'Species',
    palette: 'viridis' as const,
    atomScale: 1,
    showCell: true,
    showBonds: false,
    hideBulk: false,
    periodic: [true, true, true] as [boolean, boolean, boolean],
    timeStepPs: null,
    fps: 15,
    loop: true,
    typeMap: { '1': 'Ar' },
  };
  const workflow: MdSimulationWorkflowV2 = {
    version: 2,
    mode: 'guided',
    units: 'metal',
    boundaryType: 'p p p',
    potential: { kind: 'builtin', id: 'lj-generic', epsilonEv: 0.0103, sigmaAngstrom: 3.4, cutoffAngstrom: 8.5 },
    steps: [{ id: 'equilibrate', kind: 'nvt', name: 'NVT equilibration', enabled: true, params: { timestepFs: 1, totalSteps: 1000, tempStartK: 300, tempEndK: 300, tempDampingPs: 0.1 } }],
    output: { thermoFrequency: 100, dumpFrequency: 100 },
  };

  const wire = toMdCloudStudioSettings(settings, workflow);
  assert.equal(wire.version, 2);
  assert.deepEqual(fromMdCloudSimulationWorkflow(wire), workflow);
  assert.deepEqual(fromMdCloudStudioSettings(wire), settings);
});

test('the injected transport receives canonical encoded routes and idempotency in JSON bodies', async () => {
  const requests: MdCloudTransportRequest[] = [];
  const transport: MdCloudTransport = {
    request: async <T>(request: MdCloudTransportRequest) => {
      requests.push(request);
      return { analysis: analysis('QUEUED') } as T;
    },
  };
  const client = createMdCloudApiClient({
    feature: { enabled: true },
    capabilities: { mdCompute: true },
    transport,
  });

  await client.createAnalysis('project/one', {
    trajectoryId: 'trajectory-1',
    pipeline: {
      version: 1,
      modifiers: [],
      typeMap: {},
      periodic: [true, true, true],
      frameRange: { start: 0, stop: 4, stride: 1 },
    },
    idempotencyKey: 'analysis-create-key',
  });
  await client.getAnalysis('analysis/one');
  await client.getAnalysisArtifact('analysis/one', 'frames/000004.json.gz');
  await client.getAnalysisArtifact('analysis/one', 'frames/000000-000063.json.gz');
  await client.cancelAnalysis('analysis/one');

  assert.equal(requests[0].path, '/v1/projects/project%2Fone/md/analyses');
  assert.equal(requests[0].method, 'POST');
  assert.equal((requests[0].body as { idempotencyKey: string }).idempotencyKey, 'analysis-create-key');
  assert.deepEqual(requests.slice(1), [
    { path: '/v1/md/analyses/analysis%2Fone', method: 'GET' },
    { path: '/v1/md/analyses/analysis%2Fone/artifacts/frames/000004.json.gz', method: 'GET' },
    { path: '/v1/md/analyses/analysis%2Fone/artifacts/frames/000000-000063.json.gz', method: 'GET' },
    { path: '/v1/md/analyses/analysis%2Fone/cancel', method: 'POST' },
  ]);
  assert.throws(
    () => client.getAnalysisArtifact('analysis-1', 'frames/../result.json.gz' as never),
    /artifact path is invalid/,
  );
  assert.equal(requests.length, 5);
});

test('source creation, presigned POST upload, and finalization are separate explicit steps', async () => {
  const calls: string[] = [];
  const uploaded = new Uint8Array([1, 2, 3]);
  const ticket = {
    url: 'https://upload.invalid/signed',
    method: 'POST' as const,
    fields: { key: 'private/trajectory-1' },
    expiresIn: 300,
    maxBytes: 2_147_483_648,
  };
  const client = createMdCloudApiClient({
    feature: { enabled: true },
    capabilities: { mdCompute: true },
    transport: {
      request: async <T>(request: MdCloudTransportRequest) => {
        calls.push(`${request.method} ${request.path}`);
        if (request.path.endsWith('/complete')) return { trajectory: trajectory({ status: 'READY' }) } as T;
        return { trajectory: trajectory(), upload: ticket } as T;
      },
      upload: async (request) => {
        calls.push(`UPLOAD ${request.ticket.fields.key}`);
        assert.equal(request.body, uploaded);
        return {};
      },
    },
  });

  const created = await client.createTrajectory('project-1', {
    filename: 'copper.dump',
    contentType: 'text/plain',
    sizeBytes: uploaded.byteLength,
    sha256: 'f'.repeat(64),
    idempotencyKey: 'trajectory-create-key',
  });
  assert.deepEqual(calls, ['POST /v1/projects/project-1/md/trajectories']);
  assert.ok(created.upload);
  await client.uploadTrajectory(created.upload, uploaded);
  await client.completeTrajectory(created.trajectory.id, {
    sizeBytes: uploaded.byteLength,
    sha256: 'f'.repeat(64),
  });
  assert.deepEqual(calls, [
    'POST /v1/projects/project-1/md/trajectories',
    'UPLOAD private/trajectory-1',
    'POST /v1/md/trajectories/trajectory-1/complete',
  ]);
});

test('same-origin transport is opt-in and presigned POST appends all fields before the file', async () => {
  const jsonCalls: Array<{ path: string; method: string; body?: unknown }> = [];
  const sameOrigin = createSameOriginMdCloudTransport({
    request: async <T>(path: string, options: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) => {
      jsonCalls.push({ path, ...options });
      return { analysis: analysis('RUNNING') } as T;
    },
    upload: async () => ({}),
  });
  assert.deepEqual(jsonCalls, []);
  await sameOrigin.request<MdCloudAnalysisResponse>({ path: '/v1/md/analyses/analysis-1', method: 'GET' });
  assert.deepEqual(jsonCalls, [{ path: '/v1/md/analyses/analysis-1', method: 'GET' }]);

  const entries: Array<[string, string | Blob]> = [];
  const progress: Array<[number, number]> = [];
  const form = {
    append(name: string, value: string | Blob) { entries.push([name, value]); },
  } as unknown as FormData;
  const uploadTarget: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  const xhr = {
    status: 204,
    upload: uploadTarget,
    onload: null as ((event: ProgressEvent) => void) | null,
    onerror: null as ((event: ProgressEvent) => void) | null,
    onabort: null as ((event: ProgressEvent) => void) | null,
    open(method: string, url: string) {
      assert.equal(method, 'POST');
      assert.equal(url, 'https://upload.invalid/signed');
    },
    send(value: FormData) {
      assert.equal(value, form);
      uploadTarget.onprogress?.({ lengthComputable: true, loaded: 2, total: 3 } as ProgressEvent);
      xhr.onload?.({} as ProgressEvent);
    },
    abort() { xhr.onabort?.({} as ProgressEvent); },
    getResponseHeader(name: string) { return name === 'etag' ? '"etag-1"' : null; },
  } as unknown as XMLHttpRequest;
  const receipt = await uploadMdCloudPresignedPost({
    ticket: {
      url: 'https://upload.invalid/signed',
      method: 'POST',
      fields: { key: 'private/source', policy: 'signed-policy' },
      expiresIn: 900,
      maxBytes: 100,
    },
    body: new Uint8Array([1, 2, 3]),
    onProgress: (event) => progress.push([event.uploadedBytes, event.totalBytes]),
  }, {
    createFormData: () => form,
    createRequest: () => xhr,
  });
  assert.deepEqual(entries.slice(0, 2), [['key', 'private/source'], ['policy', 'signed-policy']]);
  assert.equal(entries[2][0], 'file');
  assert.ok(entries[2][1] instanceof Blob);
  assert.equal((entries[2][1] as Blob).size, 3);
  assert.deepEqual(progress, [[2, 3]]);
  assert.deepEqual(receipt, { etag: 'etag-1' });

  await assert.rejects(
    uploadMdCloudPresignedPost({
      ticket: {
        url: 'https://upload.invalid/signed',
        method: 'POST',
        fields: {},
        expiresIn: 900,
        maxBytes: 2,
      },
      body: new Uint8Array([1, 2, 3]),
    }, {
      createFormData: () => { throw new Error('oversized body must fail before allocation'); },
      createRequest: () => { throw new Error('oversized body must fail before I/O'); },
    }),
    /upload ticket limit/,
  );
});

test('active UI modifiers convert to the runner wire names without mutating settings', () => {
  const ptm = { id: 'ptm-1', kind: 'ptm' as const, enabled: true, params: { rmsd: 0.12 } };
  const dxa = { id: 'dxa-1', kind: 'dxa' as const, enabled: true, params: { lattice: 'FCC' } };
  const replicate = { id: 'replicate-1', kind: 'replicate' as const, enabled: true, params: { repeat: [2, 3, 1] } };

  assert.deepEqual(toMdCloudPipelineModifier(ptm), {
    id: 'ptm-1', type: 'ptm', enabled: true, params: { rmsdCutoff: 0.12 },
  });
  assert.deepEqual(toMdCloudPipelineModifier(dxa), {
    id: 'dxa-1', type: 'dxa', enabled: true, params: { crystalStructure: 'FCC' },
  });
  assert.deepEqual(toMdCloudPipelineModifier(replicate), {
    id: 'replicate-1', type: 'replicate', enabled: true, params: { numX: 2, numY: 3, numZ: 1 },
  });
  assert.deepEqual(replicate.params.repeat, [2, 3, 1]);
});

test('the reducer ignores stale operations, progress rollback, and delayed status regression', () => {
  let state = mdCloudComputeReducer(initialMdCloudComputeState(), { type: 'prepare', operationId: 'operation-1' });
  const stale = mdCloudComputeReducer(state, { type: 'upload_ready', operationId: 'old-operation', trajectory: trajectory() });
  assert.equal(stale, state);

  state = mdCloudComputeReducer(state, { type: 'upload_ready', operationId: 'operation-1', trajectory: trajectory() });
  state = mdCloudComputeReducer(state, { type: 'upload_progress', operationId: 'operation-1', percent: 62 });
  state = mdCloudComputeReducer(state, { type: 'upload_progress', operationId: 'operation-1', percent: 18 });
  assert.equal(state.uploadProgress, 62);

  state = mdCloudComputeReducer(state, { type: 'finalize', operationId: 'operation-1' });
  state = mdCloudComputeReducer(state, { type: 'source_ready', operationId: 'operation-1', trajectory: trajectory({ status: 'READY' }) });
  state = mdCloudComputeReducer(state, { type: 'analysis_received', operationId: 'operation-1', response: { analysis: analysis('QUEUED') } });
  state = mdCloudComputeReducer(state, { type: 'analysis_received', operationId: 'operation-1', response: { analysis: analysis('RUNNING') } });
  assert.equal(state.phase, 'running');
  assert.equal(state.uploadProgress, 100);

  const delayedQueueReply = mdCloudComputeReducer(state, {
    type: 'analysis_received',
    operationId: 'operation-1',
    response: { analysis: analysis('QUEUED') },
  });
  assert.equal(delayedQueueReply, state);

  state = mdCloudComputeReducer(state, { type: 'analysis_received', operationId: 'operation-1', response: { analysis: analysis('FINALIZING', { progress: 100 }) } });
  assert.equal(state.phase, 'finalizing_analysis');
  assert.equal(nextMdCloudPollDelay(state.analysis, state.pollAttempt, undefined, () => 0.5) !== null, true);
});

test('completed results preserve the signed manifest link and stop polling', () => {
  let state = mdCloudComputeReducer(initialMdCloudComputeState(), { type: 'prepare', operationId: 'operation-1' });
  state = mdCloudComputeReducer(state, { type: 'poll_failed', operationId: 'operation-1', error: 'temporary timeout' });
  assert.equal(state.phase, 'preparing_source');
  assert.equal(state.pollFailures, 1);

  const completed = analysis('COMPLETED');
  const response: MdCloudAnalysisResponse = {
    analysis: completed,
    resultManifestUrl: 'https://results.invalid/manifest.json',
    resultManifestExpiresIn: 900,
  };
  state = mdCloudComputeReducer(state, { type: 'analysis_received', operationId: 'operation-1', response });
  assert.equal(state.phase, 'completed');
  assert.equal(state.resultManifestUrl, response.resultManifestUrl);
  assert.equal(state.resultExpiresIn, 900);
  assert.equal(state.pollFailures, 0);
  assert.equal(nextMdCloudPollDelay(completed, 4, undefined, () => 0.5), null);
});

test('poll backoff grows exponentially, applies bounded jitter, and caps delays', () => {
  const policy = { initialDelayMs: 1_000, maximumDelayMs: 5_000, multiplier: 2, jitterRatio: 0.2 };
  assert.equal(mdCloudPollDelay(0, policy, () => 0.5), 1_000);
  assert.equal(mdCloudPollDelay(1, policy, () => 0), 1_600);
  assert.equal(mdCloudPollDelay(2, policy, () => 1), 4_800);
  assert.equal(mdCloudPollDelay(20, policy, () => 1), 5_000);
  assert.equal(nextMdCloudPollDelay(analysis('RUNNING'), 2, policy, () => 0.5), 4_000);
});
