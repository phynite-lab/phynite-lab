import { sha256 } from '@noble/hashes/sha2.js';
import { prepareComputeRequest, type ComputeSelection } from './compute-selection.ts';
import type { MdModifier, MdModifierKind, MdSettings } from './md-types.ts';
import type { MdSimulationWorkflowV2 } from './md-simulation-types.ts';
import { PhyniteApiError, phyniteApi } from './phynite-api.ts';

/**
 * Dormant contract for managed MD compute.
 *
 * Importing or constructing this module performs no I/O and reads no
 * environment variables. Network access requires an explicit feature gate,
 * a positive backend capability, and a transport chosen by the caller.
 */

export const MD_CLOUD_API_VERSION = 1 as const;
export const MD_CLOUD_STUDIO_SETTINGS_VERSION = 2 as const;
export const MD_CLOUD_PROVIDER = 'LOCAL_MAC' as const;

export type MdCloudTrajectoryFormat =
  | 'phynite-frame'
  | 'lammps-dump'
  | 'xyz'
  | 'extxyz'
  | 'lammps-data'
  | 'cif'
  | 'pdb'
  | 'xsf'
  | 'poscar'
  | 'text'
  | 'quantum-espresso';

export type MdCloudTrajectoryStatus = 'UPLOAD_PENDING' | 'READY';
export type MdCloudAnalysisStatus =
  | 'PREPARING'
  | 'QUEUED'
  | 'RUNNING'
  | 'FINALIZING'
  | 'CANCEL_REQUESTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type MdCloudFeatureGate = Readonly<{ enabled: boolean }>;

/** Shape exposed by the backend health response under `capabilities`. */
export type MdCloudCapabilities = Readonly<{ mdCompute: boolean; mdStorage?: boolean }>;

export const DEFAULT_MD_CLOUD_FEATURE_GATE: MdCloudFeatureGate = Object.freeze({
  enabled: false,
});

export const DEFAULT_MD_CLOUD_CAPABILITIES: MdCloudCapabilities = Object.freeze({
  mdCompute: false,
  mdStorage: false,
});

export type MdCloudAvailabilityReason = 'available' | 'feature_disabled' | 'service_disabled';
export type MdCloudAvailability = Readonly<{
  available: boolean;
  reason: MdCloudAvailabilityReason;
}>;

export function resolveMdCloudAvailability(
  feature: MdCloudFeatureGate = DEFAULT_MD_CLOUD_FEATURE_GATE,
  capabilities: MdCloudCapabilities = DEFAULT_MD_CLOUD_CAPABILITIES,
): MdCloudAvailability {
  if (feature.enabled !== true) return { available: false, reason: 'feature_disabled' };
  if (capabilities.mdCompute !== true) return { available: false, reason: 'service_disabled' };
  return { available: true, reason: 'available' };
}

export type MdCloudCreateTrajectoryInput = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  idempotencyKey: string;
  name?: string;
  studioSettings?: MdCloudStudioSettings;
};

export type MdCloudTrajectory = {
  id: string;
  projectId: string;
  filename: string;
  sizeBytes: number;
  format: MdCloudTrajectoryFormat;
  sha256: string;
  status: MdCloudTrajectoryStatus;
  name?: string;
  contentType?: string;
  uploadedAt?: string;
  eTag?: string;
  studioSettings?: MdCloudStudioSettings;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type MdCloudUploadTicket = {
  url: string;
  method: 'POST';
  fields: Readonly<Record<string, string>>;
  expiresIn: number;
  maxBytes: number;
  multipart?: boolean;
  partBytes?: number;
};

export type MdCloudCreateTrajectoryResponse = {
  trajectory: MdCloudTrajectory;
  /** Null when an idempotent replay finds a trajectory already finalized. */
  upload: MdCloudUploadTicket | null;
  idempotentReplay?: boolean;
};

export type MdCloudUploadBody = Blob | ArrayBuffer | ArrayBufferView;
export type MdCloudUploadProgress = Readonly<{
  uploadedBytes: number;
  totalBytes: number;
}>;
export type MdCloudUploadReceipt = { etag?: string };

export type MdCloudCompleteTrajectoryInput = {
  sizeBytes?: number;
  sha256?: string;
};

export type MdCloudCompleteTrajectoryResponse = {
  trajectory: MdCloudTrajectory;
  idempotentReplay?: boolean;
};

export type MdCloudTrajectoryResponse = { trajectory: MdCloudTrajectory };
export type MdCloudTrajectoryDownloadResponse = MdCloudTrajectoryResponse & {
  downloadUrl?: string;
  expiresIn?: number;
};
export type MdCloudTrajectoryListResponse = { trajectories: MdCloudTrajectory[] };
export type MdCloudDeleteTrajectoryResponse = { deleted: true; trajectoryId: string };
export type MdCloudUpdateTrajectoryInput = {
  name?: string;
  studioSettings?: MdCloudStudioSettings;
  baseRevision?: number;
  clientMutationId?: string;
};

export type MdCloudModifierParams = Record<string, number | string | boolean | number[]> & {
  rmsdCutoff?: number;
  crystalStructure?: string;
  numX?: number;
  numY?: number;
  numZ?: number;
};

/** Wire shape shared with the managed runner (`type`, not the UI's `kind`). */
export type MdCloudPipelineModifier = {
  id: string;
  type: MdModifierKind;
  enabled: boolean;
  params: MdCloudModifierParams;
};

export type MdCloudPipeline = {
  version: typeof MD_CLOUD_API_VERSION;
  modifiers: MdCloudPipelineModifier[];
  typeMap: Record<string, string>;
  periodic: [boolean, boolean, boolean];
  frameRange: {
    start: number;
    stop: number | null;
    stride: number;
  };
};

export type MdCloudStudioSettings = {
  version: typeof MD_CLOUD_API_VERSION | typeof MD_CLOUD_STUDIO_SETTINGS_VERSION;
  pipeline: MdCloudPipeline;
  display: Pick<MdSettings, 'colorBy' | 'palette' | 'atomScale' | 'showCell' | 'showBonds' | 'hideBulk' | 'timeStepPs' | 'fps' | 'loop'> & {
    periodicOverride: [boolean, boolean, boolean] | null;
  };
  /** Version 1 records omit this field and hydrate with an empty workflow. */
  simulation?: MdSimulationWorkflowV2;
};

/** Convert active MD Lab settings to the runner's upstream modifier names. */
export function toMdCloudPipelineModifier(modifier: MdModifier): MdCloudPipelineModifier {
  const params: MdCloudModifierParams = { ...modifier.params };
  if (modifier.kind === 'ptm' && typeof params.rmsd === 'number') {
    params.rmsdCutoff = params.rmsd;
    delete params.rmsd;
  }
  if (modifier.kind === 'dxa' && typeof params.lattice === 'string') {
    params.crystalStructure = params.lattice;
    delete params.lattice;
  }
  if (modifier.kind === 'replicate' && Array.isArray(params.repeat)) {
    const repeat = params.repeat;
    if (repeat.length === 3) {
      [params.numX, params.numY, params.numZ] = repeat;
      delete params.repeat;
    }
  }
  return { id: modifier.id, type: modifier.kind, enabled: modifier.enabled, params };
}

export function toMdCloudStudioSettings(settings: MdSettings, simulation?: MdSimulationWorkflowV2): MdCloudStudioSettings {
  return {
    version: simulation ? MD_CLOUD_STUDIO_SETTINGS_VERSION : MD_CLOUD_API_VERSION,
    pipeline: {
      version: MD_CLOUD_API_VERSION,
      modifiers: settings.modifiers.map(toMdCloudPipelineModifier),
      typeMap: { ...settings.typeMap },
      periodic: [...(settings.periodic ?? [true, true, true])] as [boolean, boolean, boolean],
      frameRange: { start: 0, stop: null, stride: 1 },
    },
    display: {
      colorBy: settings.colorBy,
      palette: settings.palette,
      atomScale: settings.atomScale,
      showCell: settings.showCell,
      showBonds: settings.showBonds,
      hideBulk: settings.hideBulk,
      timeStepPs: settings.timeStepPs,
      fps: settings.fps,
      loop: settings.loop,
      periodicOverride: settings.periodic ? [...settings.periodic] : null,
    },
    ...(simulation ? { simulation: structuredClone(simulation) } : {}),
  };
}

export function fromMdCloudSimulationWorkflow(value?: MdCloudStudioSettings): MdSimulationWorkflowV2 | undefined {
  return value?.version === MD_CLOUD_STUDIO_SETTINGS_VERSION && value.simulation?.version === 2
    ? structuredClone(value.simulation)
    : undefined;
}

export function fromMdCloudStudioSettings(value?: MdCloudStudioSettings): MdSettings {
  if (!value) return {
    modifiers: [],
    colorBy: 'Species',
    palette: 'viridis',
    atomScale: 1,
    showCell: true,
    showBonds: true,
    hideBulk: false,
    timeStepPs: null,
    fps: 15,
    loop: true,
    typeMap: {},
  };
  const { periodicOverride, ...display } = value.display;
  return {
    modifiers: value.pipeline.modifiers.map((modifier) => ({
      id: modifier.id,
      kind: modifier.type,
      enabled: modifier.enabled,
      params: { ...modifier.params },
    })),
    ...(periodicOverride ? { periodic: [...periodicOverride] as [boolean, boolean, boolean] } : {}),
    typeMap: { ...value.pipeline.typeMap },
    ...display,
  };
}

const MD_CLOUD_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'text/plain',
  'chemical/x-cif',
  'chemical/x-xyz',
  'chemical/x-pdb',
  'application/x-lammps',
]);

export function mdCloudContentType(filename: string, supplied = '') {
  const normalized = supplied.split(';', 1)[0].trim().toLowerCase();
  if (MD_CLOUD_CONTENT_TYPES.has(normalized)) return normalized;
  const extension = filename.toLowerCase().split('.').at(-1);
  if (extension === 'cif') return 'chemical/x-cif';
  if (extension === 'xyz' || extension === 'extxyz') return 'chemical/x-xyz';
  if (extension === 'pdb') return 'chemical/x-pdb';
  if (extension === 'dump' || extension === 'lammpstrj' || extension === 'data') return 'application/x-lammps';
  return 'application/octet-stream';
}

export async function mdCloudSha256(body: Blob | ArrayBuffer) {
  const hash = sha256.create();
  if (body instanceof Blob) {
    for (let offset = 0; offset < body.size; offset += 4 * 1024 ** 2) {
      hash.update(new Uint8Array(await body.slice(offset, offset + 4 * 1024 ** 2).arrayBuffer()));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } else hash.update(new Uint8Array(body));
  const digest = hash.digest();
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function mdCloudSaveKey(projectId: string, sha256: string, filename = '', scope = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${projectId}\0${sha256}\0${filename}\0${scope}`));
  return `md-save-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export type MdCloudCreateAnalysisInput = ComputeSelection & {
  trajectoryId: string;
  pipeline: MdCloudPipeline;
  idempotencyKey: string;
  name?: string;
  vcpus?: number;
  memoryMiB?: number;
  computeTarget?: 'personal' | 'shared';
  sourceImport?: boolean;
};

export type MdCloudResultArtifact = {
  path: MdCloudSignableArtifactPath;
  label: string;
  role: 'timeline' | 'frame' | 'frame-shard';
  contentType: 'application/json';
  contentEncoding: 'gzip';
  sizeBytes: number;
  sha256: string;
};

export type MdCloudFrameRange = {
  start: number;
  stop: number;
  stride: number;
};

export type MdCloudCompletedResultManifest = {
  version: typeof MD_CLOUD_API_VERSION;
  analysisId: string;
  projectId: string;
  sourceId: string;
  sourceSha256: string;
  status: 'completed';
  syntheticData: false;
  engine: {
    id: string;
    name: string;
    protocol: typeof MD_CLOUD_API_VERSION;
  };
  frameRange: MdCloudFrameRange;
  frameCount: number;
  atomFrames: number;
  pipelineFingerprint: string;
  artifacts: MdCloudResultArtifact[];
  startedAt?: string;
  completedAt?: string;
  elapsedSeconds?: number;
};

export type MdCloudFailedResultManifest = {
  version: typeof MD_CLOUD_API_VERSION;
  analysisId: string;
  status: 'failed';
  startedAt: string;
  completedAt: string;
  elapsedSeconds: number;
  error: string;
};

/** Manifest downloaded from `resultManifestUrl` after a terminal analysis. */
export type MdCloudResultManifest = MdCloudCompletedResultManifest | MdCloudFailedResultManifest;

export type MdCloudAnalysis = {
  id: string;
  projectId: string;
  trajectoryId: string;
  status: MdCloudAnalysisStatus;
  progress: number;
  statusMessage?: string;
  failureReason?: string;
  logTail?: string;
  name?: string;
  vcpus?: number;
  memoryMiB?: number;
  computeBackend?: string;
  cloudMode?: 'paid' | 'pilot';
  computeProfileId?: string;
  computePhase?: string;
  effectiveVcpus?: number;
  effectiveMemoryMiB?: number;
  computeSeconds?: number;
  chargedQuanta?: number;
  refundedQuanta?: number;
  fundingExpiresAtEpoch?: number;
  sourceImport?: boolean;
  sourceImportPeriodic?: [boolean, boolean, boolean];
  sourceSha256?: string;
  pipelineVersion?: typeof MD_CLOUD_API_VERSION;
  pipelineFingerprint?: string;
  resultSummary?: {
    engine: MdCloudCompletedResultManifest['engine'];
    frameRange: MdCloudFrameRange;
    frameCount: number;
    atomFrames: number;
    artifactCount: number;
    pipelineFingerprint: string;
    syntheticData: false;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type MdCloudAnalysisResponse = {
  analysis: MdCloudAnalysis;
  result?: { error?: string; artifacts: Array<{ path: string; label?: string; downloadUrl?: string }> };
  diagnosticsError?: string;
  resultManifestUrl?: string;
  resultManifestExpiresIn?: number;
  artifactsAvailable?: boolean;
  artifactsExpired?: boolean;
  idempotentReplay?: boolean;
};

export type MdCloudAnalysisListResponse = { analyses: MdCloudAnalysis[] };

export type MdCloudSignableArtifactPath = 'timeline.json.gz' | `frames/${string}.json.gz`;
export type MdCloudArtifactAccess = {
  url: string;
  path: MdCloudSignableArtifactPath;
  contentType: 'application/json';
  contentEncoding: 'gzip';
  sizeBytes: number;
  sha256: string;
  expiresIn: number;
};

export type MdCloudTransportRequest = Readonly<{
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}>;

export type MdCloudBinaryUploadRequest = Readonly<{
  ticket: MdCloudUploadTicket;
  body: MdCloudUploadBody;
  onProgress?: (progress: MdCloudUploadProgress) => void;
  signal?: AbortSignal;
}>;

export type MdCloudTransport = {
  request<T>(request: MdCloudTransportRequest): Promise<T>;
  upload?(request: MdCloudBinaryUploadRequest): Promise<MdCloudUploadReceipt>;
};

export type MdCloudUploadRuntime = {
  createFormData: () => FormData;
  createRequest: () => XMLHttpRequest;
};

function uploadBodyBlob(body: MdCloudUploadBody) {
  if (body instanceof Blob) return body;
  if (body instanceof ArrayBuffer) return new Blob([body]);
  const view = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return new Blob([copy]);
}

function uploadBodySize(body: MdCloudUploadBody) {
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return body.byteLength;
}

function uploadAbortError() {
  return new DOMException('MD cloud source upload was cancelled.', 'AbortError');
}

/** Perform the explicit S3 presigned POST step; constructing a client never calls this. */
export function uploadMdCloudPresignedPost(
  request: MdCloudBinaryUploadRequest,
  runtime: MdCloudUploadRuntime = {
    createFormData: () => new FormData(),
    createRequest: () => new XMLHttpRequest(),
  },
) {
  if (request.signal?.aborted) return Promise.reject(uploadAbortError());
  const bodySize = uploadBodySize(request.body);
  if (!Number.isSafeInteger(bodySize) || bodySize < 1 || bodySize > request.ticket.maxBytes) {
    return Promise.reject(new RangeError('MD cloud source exceeds the upload ticket limit.'));
  }
  if (request.ticket.multipart) return uploadMdMultipart(request);
  const form = runtime.createFormData();
  for (const [name, value] of Object.entries(request.ticket.fields)) form.append(name, value);
  form.append('file', uploadBodyBlob(request.body));

  return new Promise<MdCloudUploadReceipt>((resolve, reject) => {
    const xhr = runtime.createRequest();
    let settled = false;
    const onAbort = () => xhr.abort();
    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      request.signal?.removeEventListener('abort', onAbort);
      complete();
    };
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      request.onProgress?.({ uploadedBytes: event.loaded, totalBytes: event.total });
    };
    xhr.onload = () => settle(() => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('etag')?.replace(/^"|"$/g, '') || undefined });
      } else {
        reject(new Error(`MD cloud source upload failed with status ${xhr.status}.`));
      }
    });
    xhr.onerror = () => settle(() => reject(new Error('MD cloud source upload could not reach storage.')));
    xhr.onabort = () => settle(() => reject(uploadAbortError()));
    request.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.open(request.ticket.method, request.ticket.url, true);
    xhr.send(form);
  });
}

async function uploadMdMultipart(request: MdCloudBinaryUploadRequest): Promise<MdCloudUploadReceipt> {
  if (!/^\/api\/md-upload\/[A-Za-z0-9_-]+$/.test(request.ticket.url) || request.ticket.partBytes !== 16 * 1024 ** 2) throw new Error('Invalid multipart upload ticket.');
  const blob = uploadBodyBlob(request.body);
  let number = 0;
  for (let offset = 0; offset < blob.size; offset += request.ticket.partBytes) {
    if (request.signal?.aborted) throw uploadAbortError();
    const part = blob.slice(offset, offset + request.ticket.partBytes);
    const digest = await mdCloudSha256(part);
    const query = new URLSearchParams({ partNumber: String(++number), sizeBytes: String(part.size), sha256: digest });
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(request.ticket.url + '?' + query, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: part, signal: request.signal });
        if (response.ok || response.status < 500) break;
      } catch (error) { if (request.signal?.aborted || attempt === 2) throw error; }
    }
    if (!response?.ok) throw new Error('Source upload could not finish. Retry the original file; uploaded parts retain the same checksums.');
    request.onProgress?.({ uploadedBytes: offset + part.size, totalBytes: blob.size });
  }
  const complete = await fetch(request.ticket.url + '?complete=1', { method: 'POST', signal: request.signal });
  if (!complete.ok) throw new Error('Source upload could not be finalized. Retry the same original file.');
  return {};
}

export type MdCloudJsonRequester = <T>(
  path: string,
  options: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
) => Promise<T>;

export function createSameOriginMdCloudTransport(options: {
  request?: MdCloudJsonRequester;
  upload?: (request: MdCloudBinaryUploadRequest) => Promise<MdCloudUploadReceipt>;
} = {}): MdCloudTransport {
  const jsonRequest = options.request ?? phyniteApi;
  const upload = options.upload ?? uploadMdCloudPresignedPost;
  return {
    request: <T>(request: MdCloudTransportRequest) => jsonRequest<T>(request.path, {
      method: request.method,
      ...(request.body === undefined ? {} : { body: request.body }),
    }),
    upload,
  };
}

export class MdCloudComputeUnavailableError extends Error {
  reason: MdCloudAvailabilityReason | 'transport_unavailable';

  constructor(reason: MdCloudComputeUnavailableError['reason']) {
    super(`Managed MD compute is unavailable: ${reason}.`);
    this.name = 'MdCloudComputeUnavailableError';
    this.reason = reason;
  }
}

export class MdCloudStorageUnavailableError extends Error {
  constructor() {
    super('MD cloud storage transport is unavailable.');
    this.name = 'MdCloudStorageUnavailableError';
  }
}

export type MdCloudApiClientOptions = {
  feature?: MdCloudFeatureGate;
  capabilities?: MdCloudCapabilities;
  transport?: MdCloudTransport;
};

function encoded(value: string) {
  return encodeURIComponent(value);
}

function encodedArtifactPath(value: MdCloudSignableArtifactPath) {
  return value.split('/').map(encoded).join('/');
}

export const mdCloudPaths = {
  trajectories: (projectId: string) => `/v1/projects/${encoded(projectId)}/md/trajectories`,
  trajectory: (trajectoryId: string) => `/v1/md/trajectories/${encoded(trajectoryId)}`,
  completeTrajectory: (trajectoryId: string) => `/v1/md/trajectories/${encoded(trajectoryId)}/complete`,
  analyses: (projectId: string) => `/v1/projects/${encoded(projectId)}/md/analyses`,
  analysis: (analysisId: string) => `/v1/md/analyses/${encoded(analysisId)}`,
  analysisArtifact: (analysisId: string, path: MdCloudSignableArtifactPath) => (
    `/v1/md/analyses/${encoded(analysisId)}/artifacts/${encodedArtifactPath(path)}`
  ),
  cancelAnalysis: (analysisId: string) => `/v1/md/analyses/${encoded(analysisId)}/cancel`,
};

function createMdCloudTrajectoryUpdater(requireTransport: () => MdCloudTransport) {
  let legacyUpdateContract = false;
  const legacyInput = (input: MdCloudUpdateTrajectoryInput): MdCloudUpdateTrajectoryInput => ({
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.studioSettings === undefined ? {} : { studioSettings: input.studioSettings }),
  });
  const request = (trajectoryId: string, input: MdCloudUpdateTrajectoryInput) => (
    requireTransport().request<MdCloudTrajectoryResponse>({
      path: mdCloudPaths.trajectory(trajectoryId), method: 'PATCH', body: input,
    })
  );

  return async (trajectoryId: string, input: MdCloudUpdateTrajectoryInput) => {
    if (legacyUpdateContract) return request(trajectoryId, legacyInput(input));
    try {
      return await request(trajectoryId, input);
    } catch (error) {
      const usesRevisionContract = input.baseRevision !== undefined || input.clientMutationId !== undefined;
      if (!(error instanceof PhyniteApiError)
        || error.code !== 'INVALID_MD_TRAJECTORY_UPDATE'
        || !usesRevisionContract) throw error;
      // Older deployed APIs only accept name and studioSettings. Remember the
      // downgrade so later autosaves do not pay for another rejected request.
      legacyUpdateContract = true;
      return request(trajectoryId, legacyInput(input));
    }
  };
}

export function createMdCloudStorageClient(options: { transport?: MdCloudTransport } = {}) {
  const requireTransport = () => {
    if (!options.transport) throw new MdCloudStorageUnavailableError();
    return options.transport;
  };
  const updateTrajectory = createMdCloudTrajectoryUpdater(requireTransport);
  return {
    listTrajectories(projectId: string) {
      return requireTransport().request<MdCloudTrajectoryListResponse>({
        path: mdCloudPaths.trajectories(projectId), method: 'GET',
      });
    },
    createTrajectory(projectId: string, input: MdCloudCreateTrajectoryInput) {
      return requireTransport().request<MdCloudCreateTrajectoryResponse>({
        path: mdCloudPaths.trajectories(projectId), method: 'POST', body: input,
      });
    },
    getTrajectory(trajectoryId: string) {
      return requireTransport().request<MdCloudTrajectoryDownloadResponse>({
        path: mdCloudPaths.trajectory(trajectoryId), method: 'GET',
      });
    },
    updateTrajectory,
    deleteTrajectory(trajectoryId: string) {
      return requireTransport().request<MdCloudDeleteTrajectoryResponse>({
        path: mdCloudPaths.trajectory(trajectoryId), method: 'DELETE',
      });
    },
    uploadTrajectory(ticket: MdCloudUploadTicket, body: MdCloudUploadBody, uploadOptions?: {
      onProgress?: (progress: MdCloudUploadProgress) => void;
      signal?: AbortSignal;
    }) {
      const upload = requireTransport().upload;
      if (!upload) throw new MdCloudStorageUnavailableError();
      return upload({ ticket, body, ...uploadOptions });
    },
    completeTrajectory(trajectoryId: string, input: MdCloudCompleteTrajectoryInput = {}) {
      return requireTransport().request<MdCloudCompleteTrajectoryResponse>({
        path: mdCloudPaths.completeTrajectory(trajectoryId), method: 'POST', body: input,
      });
    },
    listAnalyses(projectId: string) {
      return requireTransport().request<MdCloudAnalysisListResponse>({
        path: mdCloudPaths.analyses(projectId), method: 'GET',
      });
    },
    async createAnalysis(projectId: string, input: MdCloudCreateAnalysisInput) {
      const body = await prepareComputeRequest(input, body => requireTransport().request({ path: '/v1/compute/quote', method: 'POST', body }), 'md-analysis');
      return requireTransport().request<MdCloudAnalysisResponse>({
        path: mdCloudPaths.analyses(projectId), method: 'POST', body,
      });
    },
    getAnalysis(analysisId: string) {
      return requireTransport().request<MdCloudAnalysisResponse>({
        path: mdCloudPaths.analysis(analysisId), method: 'GET',
      });
    },
    getAnalysisArtifact(analysisId: string, path: MdCloudSignableArtifactPath) {
      if (path !== 'timeline.json.gz' && !/^frames\/(?:[0-9]{6}|[0-9]{6}-[0-9]{6})\.json\.gz$/.test(path)) {
        throw new TypeError('MD analysis artifact path is invalid.');
      }
      return requireTransport().request<MdCloudArtifactAccess>({
        path: mdCloudPaths.analysisArtifact(analysisId, path), method: 'GET',
      });
    },
    cancelAnalysis(analysisId: string) {
      return requireTransport().request<MdCloudAnalysisResponse>({
        path: mdCloudPaths.cancelAnalysis(analysisId), method: 'POST',
      });
    },
  };
}

export function createMdCloudApiClient(options: MdCloudApiClientOptions = {}) {
  const availability = resolveMdCloudAvailability(
    options.feature ?? DEFAULT_MD_CLOUD_FEATURE_GATE,
    options.capabilities ?? DEFAULT_MD_CLOUD_CAPABILITIES,
  );

  const requireTransport = () => {
    if (!availability.available) throw new MdCloudComputeUnavailableError(availability.reason);
    if (!options.transport) throw new MdCloudComputeUnavailableError('transport_unavailable');
    return options.transport;
  };
  const updateTrajectory = createMdCloudTrajectoryUpdater(requireTransport);

  return {
    availability,
    listTrajectories(projectId: string) {
      return requireTransport().request<MdCloudTrajectoryListResponse>({
        path: mdCloudPaths.trajectories(projectId),
        method: 'GET',
      });
    },
    createTrajectory(projectId: string, input: MdCloudCreateTrajectoryInput) {
      return requireTransport().request<MdCloudCreateTrajectoryResponse>({
        path: mdCloudPaths.trajectories(projectId),
        method: 'POST',
        body: input,
      });
    },
    getTrajectory(trajectoryId: string) {
      return requireTransport().request<MdCloudTrajectoryDownloadResponse>({
        path: mdCloudPaths.trajectory(trajectoryId),
        method: 'GET',
      });
    },
    updateTrajectory,
    deleteTrajectory(trajectoryId: string) {
      return requireTransport().request<MdCloudDeleteTrajectoryResponse>({
        path: mdCloudPaths.trajectory(trajectoryId),
        method: 'DELETE',
      });
    },
    uploadTrajectory(ticket: MdCloudUploadTicket, body: MdCloudUploadBody, uploadOptions?: {
      onProgress?: (progress: MdCloudUploadProgress) => void;
      signal?: AbortSignal;
    }) {
      const upload = requireTransport().upload;
      if (!upload) throw new MdCloudComputeUnavailableError('transport_unavailable');
      return upload({ ticket, body, ...uploadOptions });
    },
    completeTrajectory(trajectoryId: string, input: MdCloudCompleteTrajectoryInput = {}) {
      return requireTransport().request<MdCloudCompleteTrajectoryResponse>({
        path: mdCloudPaths.completeTrajectory(trajectoryId),
        method: 'POST',
        body: input,
      });
    },
    async createAnalysis(projectId: string, input: MdCloudCreateAnalysisInput) {
      const body = await prepareComputeRequest(input, body => requireTransport().request({ path: '/v1/compute/quote', method: 'POST', body }), 'md-analysis');
      return requireTransport().request<MdCloudAnalysisResponse>({
        path: mdCloudPaths.analyses(projectId),
        method: 'POST',
        body,
      });
    },
    listAnalyses(projectId: string) {
      return requireTransport().request<MdCloudAnalysisListResponse>({
        path: mdCloudPaths.analyses(projectId),
        method: 'GET',
      });
    },
    getAnalysis(analysisId: string) {
      return requireTransport().request<MdCloudAnalysisResponse>({
        path: mdCloudPaths.analysis(analysisId),
        method: 'GET',
      });
    },
    getAnalysisArtifact(analysisId: string, path: MdCloudSignableArtifactPath) {
      if (path !== 'timeline.json.gz' && !/^frames\/(?:[0-9]{6}|[0-9]{6}-[0-9]{6})\.json\.gz$/.test(path)) {
        throw new TypeError('MD analysis artifact path is invalid.');
      }
      return requireTransport().request<MdCloudArtifactAccess>({
        path: mdCloudPaths.analysisArtifact(analysisId, path),
        method: 'GET',
      });
    },
    cancelAnalysis(analysisId: string) {
      return requireTransport().request<MdCloudAnalysisResponse>({
        path: mdCloudPaths.cancelAnalysis(analysisId),
        method: 'POST',
      });
    },
  };
}

export type MdCloudComputePhase =
  | 'idle'
  | 'preparing_source'
  | 'uploading_source'
  | 'finalizing_source'
  | 'submitting'
  | 'preparing'
  | 'queued'
  | 'running'
  | 'finalizing_analysis'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MdCloudComputeState = {
  phase: MdCloudComputePhase;
  operationId: string | null;
  trajectory: MdCloudTrajectory | null;
  analysis: MdCloudAnalysis | null;
  resultManifestUrl: string | null;
  resultExpiresIn: number | null;
  uploadProgress: number;
  pollAttempt: number;
  pollFailures: number;
  error: string | null;
};

export const initialMdCloudComputeState = (): MdCloudComputeState => ({
  phase: 'idle',
  operationId: null,
  trajectory: null,
  analysis: null,
  resultManifestUrl: null,
  resultExpiresIn: null,
  uploadProgress: 0,
  pollAttempt: 0,
  pollFailures: 0,
  error: null,
});

export type MdCloudComputeAction =
  | { type: 'prepare'; operationId: string }
  | { type: 'upload_ready'; operationId: string; trajectory: MdCloudTrajectory }
  | { type: 'upload_progress'; operationId: string; percent: number }
  | { type: 'finalize'; operationId: string }
  | { type: 'source_ready'; operationId: string; trajectory: MdCloudTrajectory }
  | { type: 'submit'; operationId: string }
  | { type: 'analysis_received'; operationId: string; response: MdCloudAnalysisResponse }
  | { type: 'poll_failed'; operationId: string; error: string }
  | { type: 'cancel_requested'; operationId: string }
  | { type: 'failed'; operationId: string; error: string }
  | { type: 'reset' };

const ANALYSIS_STATUS_RANK: Record<MdCloudAnalysisStatus, number> = {
  PREPARING: 0,
  QUEUED: 1,
  RUNNING: 2,
  FINALIZING: 3,
  CANCEL_REQUESTED: 4,
  COMPLETED: 5,
  FAILED: 5,
  CANCELLED: 5,
};

export function isTerminalMdCloudAnalysis(status: MdCloudAnalysisStatus) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

function phaseForAnalysis(status: MdCloudAnalysisStatus): MdCloudComputePhase {
  if (status === 'PREPARING') return 'preparing';
  if (status === 'QUEUED') return 'queued';
  if (status === 'RUNNING') return 'running';
  if (status === 'FINALIZING') return 'finalizing_analysis';
  if (status === 'CANCEL_REQUESTED') return 'cancelling';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'COMPLETED') return 'completed';
  return 'failed';
}

function boundedPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function mdCloudComputeReducer(
  state: MdCloudComputeState,
  action: MdCloudComputeAction,
): MdCloudComputeState {
  if (action.type === 'reset') return initialMdCloudComputeState();
  if (action.type === 'prepare') {
    return { ...initialMdCloudComputeState(), phase: 'preparing_source', operationId: action.operationId };
  }
  if (state.operationId !== action.operationId) return state;

  switch (action.type) {
    case 'upload_ready':
      return { ...state, phase: 'uploading_source', trajectory: action.trajectory, error: null };
    case 'upload_progress':
      return { ...state, uploadProgress: Math.max(state.uploadProgress, boundedPercent(action.percent)) };
    case 'finalize':
      return { ...state, phase: 'finalizing_source', uploadProgress: 100, error: null };
    case 'source_ready':
      return { ...state, phase: 'submitting', trajectory: action.trajectory, uploadProgress: 100, error: null };
    case 'submit':
      return { ...state, phase: 'submitting', error: null };
    case 'analysis_received': {
      const incoming = action.response.analysis;
      if (state.analysis && incoming.id !== state.analysis.id) return state;
      if (state.analysis && isTerminalMdCloudAnalysis(state.analysis.status)) return state;
      if (state.analysis && ANALYSIS_STATUS_RANK[incoming.status] < ANALYSIS_STATUS_RANK[state.analysis.status]) return state;
      const analysis = state.analysis && incoming.status === state.analysis.status
        ? { ...incoming, progress: Math.max(state.analysis.progress, incoming.progress) }
        : incoming;
      return {
        ...state,
        phase: phaseForAnalysis(analysis.status),
        analysis,
        resultManifestUrl: action.response.resultManifestUrl ?? state.resultManifestUrl,
        resultExpiresIn: action.response.resultManifestExpiresIn ?? state.resultExpiresIn,
        pollAttempt: state.pollAttempt + (isTerminalMdCloudAnalysis(analysis.status) ? 0 : 1),
        pollFailures: 0,
        error: analysis.failureReason ?? null,
      };
    }
    case 'poll_failed':
      return { ...state, pollAttempt: state.pollAttempt + 1, pollFailures: state.pollFailures + 1, error: action.error };
    case 'cancel_requested':
      return { ...state, phase: 'cancelling', error: null };
    case 'failed':
      return { ...state, phase: 'failed', error: action.error };
  }
}

export type MdCloudPollPolicy = Readonly<{
  initialDelayMs: number;
  maximumDelayMs: number;
  multiplier: number;
  jitterRatio: number;
}>;

export const DEFAULT_MD_CLOUD_POLL_POLICY: MdCloudPollPolicy = Object.freeze({
  initialDelayMs: 1_000,
  maximumDelayMs: 15_000,
  multiplier: 1.8,
  jitterRatio: 0.2,
});

export function mdCloudPollDelay(
  attempt: number,
  policy: MdCloudPollPolicy = DEFAULT_MD_CLOUD_POLL_POLICY,
  random: () => number = Math.random,
) {
  const normalizedAttempt = Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0));
  const initialDelay = Math.max(0, policy.initialDelayMs);
  const maximumDelay = Math.max(initialDelay, policy.maximumDelayMs);
  const multiplier = Math.max(1, policy.multiplier);
  const jitterRatio = Math.max(0, Math.min(1, policy.jitterRatio));
  const base = Math.min(maximumDelay, initialDelay * multiplier ** normalizedAttempt);
  const randomValue = Math.max(0, Math.min(1, random()));
  const jittered = base * (1 + (randomValue * 2 - 1) * jitterRatio);
  return Math.round(Math.max(0, Math.min(maximumDelay, jittered)));
}

export function nextMdCloudPollDelay(
  analysis: Pick<MdCloudAnalysis, 'status'> | null,
  attempt: number,
  policy: MdCloudPollPolicy = DEFAULT_MD_CLOUD_POLL_POLICY,
  random: () => number = Math.random,
) {
  if (analysis && isTerminalMdCloudAnalysis(analysis.status)) return null;
  return mdCloudPollDelay(attempt, policy, random);
}
