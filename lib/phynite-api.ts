import { prepareComputeRequest, type ComputeSelection } from './compute-selection.ts';
import { coalescedBrowserRead } from './browser-poll.ts';
import { controlPlaneFetch, controlPlaneJson } from './control-plane-fetch.ts';
export type PhyniteProject = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  tags?: Array<"QE" | "LAMMPS" | "MD">;
  legacyId?: string;
  mdTrajectoryCount?: number;
};

export type PhyniteCalculation = {
  scfSourceCalculationId?: string;
  scfInputIdentity?: string;
  retainsScfBundle?: boolean;
  id: string;
  projectId: string;
  structureId: string;
  name: string;
  calculationType: string;
  status: string;
  progress: number;
  computeBackend?: "LOCAL_MAC" | string;
  cloudMode?: "paid" | "pilot";
  computeProfileId?: string;
  computeSeconds?: number;
  chargedQuanta?: number;
  refundedQuanta?: number;
  fundingExpiresAtEpoch?: number;
  computePhase?: string;
  effectiveVcpus?: number;
  effectiveMemoryMiB?: number;
  vcpus?: number;
  memoryMiB?: number;
  statusMessage?: string;
  failureReason?: string;
  logTail?: string;
  scfConvergence?: import('./qe-live-scf.ts').ScfConvergence;
  startedAt?: string;
  completedAt?: string;
  artifactsExpireAt?: string;
  artifactsExpireAtEpoch?: number;
  createdAt: string;
  updatedAt: string;
};

export type PhyniteStructure = {
  id: string;
  projectId: string;
  name: string;
  formula: string;
  atomCount: number;
  spaceGroup: string;
  source: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sha256?: string;
};

export type PhyniteResultArtifact = {
  path: string;
  label: string;
  role: "plot" | "data" | "raw-data" | "input" | "workspace" | "log" | string;
  contentType: string;
  sizeBytes?: number;
  sha256?: string;
  viewUrl?: string;
  downloadUrl: string;
};

export type PhyniteCalculationFile = {
  path: string;
  name: string;
  role: "input" | "runtime" | string;
  contentType: string;
  sizeBytes: number;
  content: string;
};

export type PhyniteCalculationDiagnosis = {
  diagnosis: string;
  modelId: string;
  generatedAt: string;
};

export type PhyniteResultManifest = {
  version: number;
  calculationId: string;
  calculationType?: string;
  status: "completed" | "failed" | string;
  startedAt?: string;
  completedAt?: string;
  elapsedSeconds?: number;
  steps?: Array<{ name: string; mpiRanks?: number; memoryEstimateMiB?: number; elapsedSeconds?: number }>;
  summary?: Record<string, string | number | boolean | null>;
  artifacts?: PhyniteResultArtifact[];
  artifactPagination?: { totalArtifacts: number; nextCursor: string | null; manifestSha256: string };
  provenance?: {
    calculationType?: string;
    source?: string;
    syntheticData?: boolean;
    plotDpi?: number;
    reciprocalPath?: Record<string, unknown>;
    structureSource?: Record<string, unknown>;
  };
  error?: string;
};

export type PhyniteDeveloperJob = {
  id: string;
  ownerId: string;
  projectId: string;
  structureId: string;
  name: string;
  calculationType: string;
  status: "QUEUED" | "RUNNING" | "CANCEL_REQUESTED" | string;
  jobKind?: 'qe' | 'md-analysis' | 'md-simulation';
  progress: number;
  statusMessage?: string;
  workerId?: string;
  preferredWorkerId?: string;
  vcpus: number;
  memoryMiB: number;
  queuePriority: number;
  position: number | null;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  leaseExpiresAtEpoch?: number | null;
  stale?: boolean;
  recoveryCount?: number;
};

export type PhyniteDeveloperQueue = {
  paused: boolean;
  backend: "LOCAL_MAC" | "DISABLED" | string;
  updatedAt?: string;
  updatedBy?: string;
};

export type PhyniteWaitlistStatus = "WAITING" | "INVITED" | "ONBOARDED" | "DECLINED";

export type PhyniteWaitlistEntry = {
  id: string;
  email: string;
  locale: "en" | "id";
  source: string;
  status: PhyniteWaitlistStatus;
  createdAt: string;
  updatedAt: string;
  confirmationEmailStatus: "PENDING" | "SENT" | "FAILED" | "UNKNOWN" | string;
  confirmationEmailSentAt?: string;
  priority?: 'NORMAL' | 'ACADEMIC';
  invitationEmailStatus?: 'NOT_SENT' | 'SENDING' | 'SENT' | 'FAILED' | 'REVOKED' | 'UNCERTAIN' | 'LINK_CREATED';
  invitationCreatedAt?: string;
  invitationSentAt?: string;
  invitationRevokedAt?: string;
  invitationReconciledAt?: string;
  invitationClaimExpiresAtEpoch?: number;
  invitationExpiresAtEpoch?: number;
};

export type PhyniteWaitlistPolicy = {
  autoInviteEnabled: boolean;
  academicDomains: string[];
  inviteSubject: string;
  inviteBody: string;
  inviteExpiryDays: number;
  emailConfigured: boolean;
};

export type PhyniteWaitlistSummary = {
  total: number;
  waiting: number;
  invited: number;
  onboarded: number;
  declined: number;
  emailFailed: number;
};

export type PhynitePilotMetrics = {
  linksCreated: number;
  accountsActivated: number;
  accountsWithLogin: number;
  workersConnectedNow: number;
  dftJobsCompleted: number;
  mdJobsCompleted: number;
  jobsFailed: number;
  researchersReturning: number;
};

export type PhyniteAdminUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  institution: string;
  role: string;
  createdAt: string | null;
  planId: string;
  billingStatus: string;
  quantaBalance: string;
  enabled: boolean;
  suspended: boolean;
  cognitoStatus: string;
  isAdmin?: boolean;
  computerPaired?: boolean;
  pilotGranted?: boolean;
  cloudGrant?: { version: number; expiresAtEpoch: number; jobLimit: number; jobsUsed: number; maxVcpus?: number; maxMemoryMiB?: number; timeoutSeconds?: number; budgetUsd?: number; spentUsd?: number; reservedUsd?: number };
  presenceStatus?: 'online' | 'idle' | 'offline' | 'unknown';
  lastSeenAt?: string | null;
  lastLoginAt?: string | null;
};

export type PhyniteUserPresence = Pick<PhyniteAdminUser, 'id' | 'presenceStatus' | 'lastSeenAt' | 'lastLoginAt'>;
export type PhynitePresenceSnapshot = { users: PhyniteUserPresence[]; onlineCount: number; idleCount: number; retrievedAt: string };

export type PhyniteAdminUserJob = {
  id: string;
  projectId?: string;
  kind: 'CALCULATION' | 'MD_ANALYSIS' | 'MD_SIMULATION';
  name: string;
  status: string;
  statusMessage?: string;
  failureReason?: string;
  workerId?: string;
  computeBackend?: string;
  computeTarget?: 'shared' | 'personal';
  stale?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PhyniteQuantaAdjustment = {
  id: string;
  delta: string;
  reason: string;
  actorId: string;
  createdAt: string;
};

export type PhyniteAdminAuditEvent = {
  id: string;
  actorId: string;
  action: string;
  targetKind: string;
  targetId: string;
  reason?: string;
  createdAt: string;
};

export type PhyniteDeveloperWorker = {
  id: string;
  online: boolean;
  lastSeenAt?: string;
  capabilities: Array<'qe' | 'md-analysis' | 'md-simulation'>;
  lammpsVersion?: string;
  telemetry?: {
    cpuPercent: number | null;
    availableMemoryBytes: number | null;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
    runtime: 'docker' | 'native';
    qeImageDigest: string | null;
    mdImageDigest: string | null;
  };
};

export type PhyniteWorkerAlert = {
  kind: 'LOW_DISK' | 'LOW_MEMORY' | 'HIGH_CPU_NO_REPORTED_OUTPUT' | 'LARGE_ARTIFACT_BATCH';
  workerId?: string;
  jobId?: string;
  availableBytes?: number;
  declaredBytes?: number;
  lastReportedOutputAt?: string;
  createdAt?: string;
};

export type PhyniteSystemAnnouncement = {
  message: string;
  enabled: boolean;
  updatedAt?: string;
};

export type PhyniteSentAnnouncement = {
  id: string;
  message: string;
  sentAt: string;
  sentBy?: string;
};

export type PhynitePublicSentAnnouncement = Pick<PhyniteSentAnnouncement, 'id' | 'message' | 'sentAt'>;

export type PhyniteInboxItem = {
  id: string;
  kind: 'message' | 'broadcast';
  title: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  legacy: boolean;
  paymentId?: string;
  titleId?: string;
  bodyId?: string;
};

export type PhyniteAdminMessage = {
  id: string;
  title: string;
  body: string;
  audienceType: 'broadcast' | 'users';
  recipientCount: number;
  readCount: number;
  sentAt: string;
  sentBy?: string;
};

export type PhyniteMessageAudience =
  | { type: 'broadcast' }
  | { type: 'users'; userIds: string[] };

export type PhyniteFailureDigest = {
  categories: Array<{ id: string; label: string; count: number }>;
  recent: Array<{ category: string; jobId: string; jobKind: string; createdAt: string }>;
  sampleSize: number;
  sampleLimit: number;
  coverage: string;
  retrievedAt: string;
};

export type PhyniteComputeStatus = {
  service: "online" | string;
  checkedAt: string;
  compute: {
    backend: "LOCAL_MAC" | "AWS_BATCH" | "DISABLED" | string;
    target?: "shared" | "personal";
    status: "connected" | "offline" | "available" | "disabled" | string;
    workerId?: string | null;
    lastSeenAt?: string | null;
    staleAfterSeconds?: number;
    capabilities?: LocalWorkerCapability[];
  };
  mdCompute?: PhyniteComputeStatus['compute'];
  paid?: (PhyniteComputeStatus['compute'] & { available: boolean; availableMicros: number; reservedMicros: number }) | null;
  cloud?: (PhyniteComputeStatus['compute'] & { available: boolean; remainingJobs?: number; sessionExpiresAtEpoch?: number }) | null;
};

export type LocalWorkerCapability = "qe" | "md-analysis" | "md-simulation";

export type MdSimulationArtifact = {
  path: string;
  label: string;
  role: "input" | "log" | "trajectory" | "data" | string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl?: string;
};

export type MdSimulationRun = {
  id: string;
  projectId: string;
  trajectoryId: string;
  resultTrajectoryId?: string;
  name: string;
  recipeId: import("./md-simulation-types").MdSimulationRecipeId | "manual";
  /** Present on legacy single-step runs. */
  config?: Record<string, unknown>;
  /** Canonical workflow used by current MD Lab runs. */
  workflow?: import("./md-simulation-types").MdSimulationWorkflowV2;
  workflowVersion?: 2;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCEL_REQUESTED" | "CANCELLED";
  progress: number;
  statusMessage?: string;
  failureReason?: string;
  logTail?: string;
  computeBackend: string;
  cloudMode?: "paid" | "pilot";
  computeProfileId?: string;
  computeSeconds?: number;
  chargedQuanta?: number;
  refundedQuanta?: number;
  fundingExpiresAtEpoch?: number;
  computePhase?: string;
  effectiveVcpus?: number;
  effectiveMemoryMiB?: number;
  computeTarget: "personal" | "shared";
  vcpus?: number;
  memoryMiB?: number;
  startedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type MdSimulationCreateBase = ComputeSelection & {
  trajectoryId: string;
  name: string;
  idempotencyKey: string;
  computeTarget?: "personal" | "shared";
  vcpus?: number;
  memoryMiB?: number;
};

export type MdSimulationCreateInput = MdSimulationCreateBase & (
  | { workflow: import("./md-simulation-types").MdSimulationWorkflowV2; config?: never }
  | { config: import("./md-simulation-types").MdSimulationConfig; workflow?: never }
);

export type MdRuntimeManifest = {
  schemaVersion: 2;
  limits?: { simulationAtoms: number; resultTrajectoryBytes: number; vcpus: number; memoryMiB: number };
  computeTargets: Array<{
    id: "personal" | "shared";
    label: string;
    available: boolean;
    status: "connected" | "offline" | "not-connected" | "not-available-for-md" | string;
  }>;
  workflowVersion: 2;
  stepKinds: import("./md-simulation-types").MdWorkflowStepKind[];
  potentialFamilies: import("./md-simulation-types").MdPotentialFamily[];
  builtInPotentials: string[];
  manualInputRequiresDocker: boolean;
  runtime: null | {
    schemaVersion: 1;
    executionMode: "docker" | "native" | "personal-container" | string;
    architecture: string;
    lammpsVersion: string;
    packages: string[];
    pairStyles: string[];
    manualInput: boolean;
  };
};

export type MdPotentialUploadTicket = {
  filename: string;
  role: string;
  url: string;
  method: "POST";
  fields: Record<string, string>;
  expiresIn: number;
};

export type MdPotentialCreateInput = {
  name: string;
  family: Exclude<import("./md-simulation-types").MdPotentialFamily, "lj" | "custom">;
  elements: string[];
  libraryElementOrder?: string[];
  units?: "metal";
  atomStyle?: "atomic";
  citation?: string;
  license?: string;
  modelVersion?: string;
  validityDomain?: string;
  validationEvidence?: string;
  files: Array<{
    filename: string;
    sizeBytes: number;
    sha256: string;
    role?: "potential" | "library" | "parameter";
  }>;
};

export class PhyniteApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "API_ERROR") {
    super(message);
    this.name = "PhyniteApiError";
    this.status = status;
    this.code = code;
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function phyniteApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await controlPlaneFetch(`/api/phynite${normalizedPath}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      // Workers can expose an empty DELETE as a readable stream. Keep every
      // JSON mutation typed even when it intentionally has no payload.
      ...(options.body === undefined && ['GET', 'HEAD'].includes((options.method ?? 'GET').toUpperCase()) ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await controlPlaneJson<{
    error?: string;
    code?: string;
  } & T>(response);
  if (!response.ok) {
    throw new PhyniteApiError(
      response.status,
      payload.error || "The Phynite backend rejected the request.",
      payload.code,
    );
  }
  return payload;
}

function projectInventoryChanged<T>(result: T, removedProjectId?: string): T {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('phynite:project-inventory-change', { detail: { removedProjectId } }));
  return result;
}

export const phyniteProjects = {
  list: () => phyniteApi<{ projects: PhyniteProject[] }>("/v1/projects"),
  create: (input: { name: string; description?: string; tags?: PhyniteProject["tags"] }) =>
    phyniteApi<{ project: PhyniteProject }>("/v1/projects", { method: "POST", body: input }).then(projectInventoryChanged),
  update: (projectId: string, input: Partial<Pick<PhyniteProject, "name" | "description" | "lastOpenedAt" | "tags">>) =>
    phyniteApi<{ project: PhyniteProject }>(`/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: input,
    }).then(projectInventoryChanged),
  delete: (projectId: string) =>
    phyniteApi<{ deleted: true; projectId: string }>(`/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }).then(result => projectInventoryChanged(result, projectId)),
};

export const phyniteStructures = {
  list: (projectId: string) =>
    phyniteApi<{ structures: PhyniteStructure[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/structures`,
    ),
  create: (
    projectId: string,
    input: {
      name: string;
      formula: string;
      spaceGroup?: string;
      source?: string;
      externalId?: string;
      sourceUrl?: string;
      sourceUpdatedAt?: string | null;
      sourceData?: import('./crystal-database').CrystalDatabaseMaterial['sourceData'];
      provenance?: import('./crystal-database').CrystalDatabaseMaterial['provenance'];
      geometryProvenance?: unknown[];
      lattice: import('./crystal-cell').LatticeParameters;
      periodic?: [boolean, boolean, boolean];
      atoms: Array<Record<string, unknown>>;
    },
  ) =>
    phyniteApi<{ structure: PhyniteStructure }>(
      `/v1/projects/${encodeURIComponent(projectId)}/structures`,
      { method: "POST", body: input },
    ),
};

export const phyniteCalculations = {
  list: (projectId: string) =>
    phyniteApi<{ calculations: PhyniteCalculation[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/calculations`,
    ),
  get: (calculationId: string) =>
    phyniteApi<{
      calculation: PhyniteCalculation;
      result?: PhyniteResultManifest;
      resultManifestUrl?: string;
      resultManifestExpiresIn?: number;
      artifactsAvailable?: boolean;
      artifactsExpired?: boolean;
    }>(
      `/v1/calculations/${encodeURIComponent(calculationId)}`,
      { cache: "no-store" },
    ),
  files: (calculationId: string) =>
    phyniteApi<{ calculation: PhyniteCalculation; files: PhyniteCalculationFile[] }>(
      `/v1/calculations/${encodeURIComponent(calculationId)}/files`,
      { cache: "no-store" },
    ),
  artifactPage: (calculationId: string, cursor?: string) => phyniteApi<{
    artifacts: PhyniteResultArtifact[]; totalArtifacts: number; nextCursor: string | null; manifestSha256: string;
  }>(`/v1/calculations/${encodeURIComponent(calculationId)}/artifacts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' }),
  create: (
    projectId: string,
    input: ComputeSelection & {
      structureId: string;
      name: string;
      calculationType: string;
      qeInput: string;
      inputFiles: Record<string, string>;
      settings: Record<string, unknown>;
      pseudopotentials?: Record<string, string>;
      dependsOnCalculationIds?: string[];
      scfSourceCalculationId?: string;
      idempotencyKey?: string;
      vcpus?: number;
      memoryMiB?: number;
      run?: boolean;
    },
  ) =>
    prepareComputeRequest(input, body => phyniteApi("/v1/compute/quote", { method: "POST", body })).then(body => phyniteApi<{ calculation: PhyniteCalculation }>(
      `/v1/projects/${encodeURIComponent(projectId)}/calculations`,
      { method: "POST", body },
    )),
  cancel: (calculationId: string) =>
    phyniteApi<{ calculation: PhyniteCalculation }>(
      `/v1/calculations/${encodeURIComponent(calculationId)}/cancel`,
      { method: "POST" },
    ),
  diagnose: (calculationId: string) =>
    phyniteApi<PhyniteCalculationDiagnosis>(
      `/v1/calculations/${encodeURIComponent(calculationId)}/diagnosis`,
      { method: "POST" },
    ),
};

export const phyniteCompute = {
  status: () => coalescedBrowserRead("compute-status", () => phyniteApi<PhyniteComputeStatus>("/v1/compute/status", { cache: "no-store" })),
};

export const phyniteMdRuntime = {
  manifest: () => phyniteApi<{ manifest: MdRuntimeManifest }>("/v1/md/runtime-manifest", { cache: "no-store" }),
};

export const phyniteMdSimulations = {
  list: (projectId: string) =>
    phyniteApi<{ simulations: MdSimulationRun[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/md/simulations`,
      { cache: "no-store" },
    ),
  create: (projectId: string, input: MdSimulationCreateInput) =>
    prepareComputeRequest(input, body => phyniteApi("/v1/compute/quote", { method: "POST", body }), 'md-simulation').then(body => phyniteApi<{ simulation: MdSimulationRun }>(
      `/v1/projects/${encodeURIComponent(projectId)}/md/simulations`,
      { method: "POST", body },
    )),
  get: (simulationId: string) =>
    phyniteApi<{ simulation: MdSimulationRun; result?: { artifacts?: MdSimulationArtifact[] } }>(
      `/v1/md/simulations/${encodeURIComponent(simulationId)}`,
      { cache: "no-store" },
    ),
  cancel: (simulationId: string) =>
    phyniteApi<{ simulation: MdSimulationRun }>(
      `/v1/md/simulations/${encodeURIComponent(simulationId)}/cancel`,
      { method: "POST" },
    ),
};

export const phyniteMdPotentials = {
  list: (projectId: string) =>
    phyniteApi<{ potentials: import("./md-simulation-types").MdPotentialAsset[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/md/potentials`,
      { cache: "no-store" },
    ),
  create: (projectId: string, input: MdPotentialCreateInput) =>
    phyniteApi<{
      potential: import("./md-simulation-types").MdPotentialAsset;
      uploads: MdPotentialUploadTicket[];
    }>(`/v1/projects/${encodeURIComponent(projectId)}/md/potentials`, {
      method: "POST",
      body: input,
    }),
  upload: async (ticket: MdPotentialUploadTicket, file: Blob) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
    form.append("file", file);
    const response = await fetch(ticket.url, { method: ticket.method, body: form });
    if (!response.ok) throw new Error(`Potential upload failed with status ${response.status}.`);
  },
  complete: (potentialId: string) =>
    phyniteApi<{ potential: import("./md-simulation-types").MdPotentialAsset }>(
      `/v1/md/potentials/${encodeURIComponent(potentialId)}/complete`,
      { method: "POST", body: {} },
    ),
  delete: (potentialId: string) =>
    phyniteApi<{ deleted: true; potentialId: string }>(
      `/v1/md/potentials/${encodeURIComponent(potentialId)}`,
      { method: "DELETE" },
    ),
};

export const phyniteMdConfigurations = {
  list: (projectId: string) =>
    phyniteApi<{ configurations: import("./md-simulation-types").MdSimulationConfiguration[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/md/configurations`,
      { cache: "no-store" },
    ),
  create: (projectId: string, input: { name: string; workflow: import("./md-simulation-types").MdSimulationWorkflowV2 }) =>
    phyniteApi<{ configuration: import("./md-simulation-types").MdSimulationConfiguration }>(
      `/v1/projects/${encodeURIComponent(projectId)}/md/configurations`,
      { method: "POST", body: input },
    ),
  update: (configurationId: string, input: { name?: string; workflow?: import("./md-simulation-types").MdSimulationWorkflowV2 }) =>
    phyniteApi<{ configuration: import("./md-simulation-types").MdSimulationConfiguration }>(
      `/v1/md/configurations/${encodeURIComponent(configurationId)}`,
      { method: "PATCH", body: input },
    ),
  delete: (configurationId: string) =>
    phyniteApi<{ deleted: true; configurationId: string }>(
      `/v1/md/configurations/${encodeURIComponent(configurationId)}`,
      { method: "DELETE" },
    ),
};

export const phyniteDeveloperQueue = {
  get: () =>
    phyniteApi<{ queue: PhyniteDeveloperQueue }>("/v1/developer/queue"),
  listJobs: () =>
    phyniteApi<{
      jobs: PhyniteDeveloperJob[];
      summary: { queued: number; running: number; cancelling: number };
      retrievedAt: string;
    }>("/v1/developer/jobs"),
  setPaused: (paused: boolean) =>
    phyniteApi<{ queue: PhyniteDeveloperQueue }>("/v1/developer/queue", {
      method: "PATCH",
      body: { paused },
    }),
  actOnJob: (calculationId: string, action: "move-first" | "move-last" | "cancel" | "requeue" | "fail-gracefully", reason = '') =>
    phyniteApi<{ job: PhyniteDeveloperJob }>(
      `/v1/developer/jobs/${encodeURIComponent(calculationId)}`,
      { method: "PATCH", body: { action, reason } },
    ),
};

export type PhyniteOverviewMetric<T> = {
  status: 'ready' | 'stale' | 'pending' | 'error';
  measuredAt: string | null;
  maxAgeSeconds: number;
  value: T | null;
  error: string | null;
};

export const phyniteDeveloperOverview = {
  get: () => phyniteApi<{ metrics: {
    waitlist: PhyniteOverviewMetric<number | PhyniteWaitlistSummary>;
    inquiries: PhyniteOverviewMetric<number>;
    storage: PhyniteOverviewMetric<PhyniteStorageInventory>;
  }; retrievedAt: string }>('/v1/developer/overview', { cache: 'no-store' }),
};

export type PhyniteAnalyticsRow = Record<string, string | number | null>;
export type PhyniteAnalyticsReport = {
  filters: { tab: string; from: string; to: string; country: string; device: string; area: string };
  retrievedAt: string;
  firstParty: { status: 'ready' | 'partial' | 'unavailable'; reason?: string; rows?: Record<string, PhyniteAnalyticsRow[]>; definition?: string; retentionDays?: number; missingDays?: string[]; retrievedAt?: string };
  ga4: { status: 'ready' | 'unavailable' | 'not_requested'; reason?: string; metrics?: Record<string, number>; definition?: string; retrievedAt?: string };
};

export const phyniteDeveloperAnalytics = {
  read: (query: URLSearchParams) => phyniteApi<{ report?: PhyniteAnalyticsReport; operationId?: string; status?: string; progress?: string; stale?: boolean; needsRefresh?: boolean; refreshError?: string }>(`/v1/developer/analytics?${query}`, { cache: 'no-store' }),
  operation: (id: string) => phyniteApi<{ report?: PhyniteAnalyticsReport; status: string; progress: string; error?: string; retryable?: boolean }>(`/v1/developer/analytics/operations/${encodeURIComponent(id)}`, { cache: 'no-store' }),
};

export const phyniteDeveloperWaitlist = {
  pilotMetrics: () => phyniteApi<{ metrics: PhynitePilotMetrics; coverage: string; retrievedAt: string }>(
    '/v1/developer/pilot/metrics', { cache: 'no-store' },
  ),
  list: (cursor = '', limit = 50) =>
    phyniteApi<{
      entries: PhyniteWaitlistEntry[];
      summary: PhyniteWaitlistSummary | null;
      summaryMeasuredAt?: string | null;
      nextCursor: string | null;
      retrievedAt: string;
    }>(`/v1/developer/waitlist?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`),
  setStatus: (entryId: string, status: PhyniteWaitlistStatus) =>
    phyniteApi<{ entry: PhyniteWaitlistEntry }>(
      `/v1/developer/waitlist/${encodeURIComponent(entryId)}`,
      { method: "PATCH", body: { status } },
    ),
  resendConfirmation: (entryId: string) =>
    phyniteApi<{ entry: PhyniteWaitlistEntry }>(
      `/v1/developer/waitlist/${encodeURIComponent(entryId)}/confirmation`,
      { method: "POST", body: {} },
    ),
  reconcileInvitation: (entryId: string, reason: string) =>
    phyniteApi<{ entry: PhyniteWaitlistEntry }>(
      `/v1/developer/waitlist/${encodeURIComponent(entryId)}/reconcile`,
      { method: "POST", body: { reason } },
    ),
  delete: (entryId: string) =>
    phyniteApi<{ deleted: true; entryId: string }>(
      `/v1/developer/waitlist/${encodeURIComponent(entryId)}`,
      { method: "DELETE" },
    ),
  policy: () => phyniteApi<{ policy: PhyniteWaitlistPolicy }>(
    '/v1/developer/waitlist/policy', { cache: 'no-store' },
  ),
  savePolicy: (policy: Omit<PhyniteWaitlistPolicy, 'emailConfigured'>) => phyniteApi<{ policy: PhyniteWaitlistPolicy }>(
    '/v1/developer/waitlist/policy', { method: 'PUT', body: policy },
  ),
  invite: (entryIds: string[]) => phyniteApi<{
    result: { id: string; status: 'LINK_CREATED'; url: string; expiresAtEpoch: number; emailStatus?: string };
  }>('/v1/developer/waitlist/invitations', { method: 'POST', body: { entryIds } }),
};

export type PhyniteContactInquiry = {
  id: string;
  name: string;
  email: string;
  organization: string;
  inquiryType: string;
  message: string;
  createdAt: string;
  status: 'NEW' | 'DONE';
  statusUpdatedAt: string | null;
  source?: 'form' | 'email';
  subject?: string;
  latestMessageAt?: string | null;
};

export const phyniteDeveloperInquiries = {
  list: (limit = 20, cursor = '', status: '' | 'NEW' | 'DONE' = '') => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    if (status) query.set('status', status);
    return phyniteApi<{ inquiries: PhyniteContactInquiry[]; nextCursor: string | null; newCount: number; retrievedAt: string }>(
      `/v1/developer/inquiries?${query}`, { cache: 'no-store' },
    );
  },
  setStatus: (id: string, status: 'NEW' | 'DONE') => phyniteApi<{ inquiry: PhyniteContactInquiry }>(
    `/v1/developer/inquiries/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } },
  ),
};

export const phyniteDeveloperUsers = {
  presence: (ids: string[] = []) => phyniteApi<PhynitePresenceSnapshot>(
    `/v1/developer/users/presence${ids.length ? `?${new URLSearchParams({ ids: ids.join(',') })}` : ''}`, { cache: 'no-store' },
  ),
  list: (search = '', cursor = '') => {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (cursor) query.set('cursor', cursor);
    return phyniteApi<{ users: PhyniteAdminUser[]; nextCursor: string | null; retrievedAt: string }>(
      `/v1/developer/users${query.size ? `?${query}` : ''}`,
      { cache: 'no-store' },
    );
  },
  get: (userId: string) => phyniteApi<{ user: PhyniteAdminUser }>(
    `/v1/developer/users/${encodeURIComponent(userId)}`, { cache: 'no-store' },
  ),
  jobs: (userId: string, cursor = '') => phyniteApi<{ jobs: PhyniteAdminUserJob[]; total: number; nextCursor: string | null; truncated: boolean }>(
    `/v1/developer/users/${encodeURIComponent(userId)}/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' },
  ),
  actOnJob: (userId: string, job: PhyniteAdminUserJob, action: 'cancel' | 'requeue' | 'fail-gracefully', reason: string) =>
    phyniteApi<{ job: { id: string; kind: string; status: string; updatedAt?: string; statusMessage?: string } }>(
      `/v1/developer/users/${encodeURIComponent(userId)}/jobs/${encodeURIComponent(job.kind)}/${encodeURIComponent(job.id)}`,
      { method: 'PATCH', body: { action, reason } },
    ),
  quanta: (userId: string) => phyniteApi<{ adjustments: PhyniteQuantaAdjustment[] }>(
    `/v1/developer/users/${encodeURIComponent(userId)}/quanta`, { cache: 'no-store' },
  ),
  adjustQuanta: (userId: string, delta: string, reason: string, idempotencyKey: string) =>
    phyniteApi<{ adjustment: PhyniteQuantaAdjustment; user: PhyniteAdminUser }>(
      `/v1/developer/users/${encodeURIComponent(userId)}/quanta`,
      { method: 'POST', body: { delta, reason, idempotencyKey } },
    ),
  action: (userId: string, action: 'suspend' | 'activate' | 'send-reset' | 'revoke-admin' | 'revoke-worker', reason = '') =>
    phyniteApi<{ user: PhyniteAdminUser; action: string }>(
      `/v1/developer/users/${encodeURIComponent(userId)}/actions`,
      { method: 'POST', body: { action, reason } },
    ),
  audit: () => phyniteApi<{ events: PhyniteAdminAuditEvent[]; retrievedAt: string }>(
    '/v1/developer/audit', { cache: 'no-store' },
  ),
};

export const phyniteDeveloperWorkers = {
  list: () => phyniteApi<{ workers: PhyniteDeveloperWorker[]; alerts: PhyniteWorkerAlert[]; retrievedAt: string }>(
    '/v1/developer/workers', { cache: 'no-store' },
  ),
  route: (jobId: string, workerId: string | null) =>
    phyniteApi<{ job: PhyniteDeveloperJob }>(
      `/v1/developer/jobs/${encodeURIComponent(jobId)}`,
      { method: 'PATCH', body: { action: 'route-worker', workerId } },
    ),
};

export type PhyniteOperationEvent = {
  id: string;
  at: string;
  source: string;
  type?: string;
  actorId?: string;
  targetKind?: string;
  targetId?: string;
  status?: string;
  stream?: string;
  message?: string;
};

export type PhyniteComputeOperation = {
  id: string;
  kind: 'dft' | 'md';
  action: 'enable' | 'disable';
  state: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  stackStatus?: string;
  cancelledJobs?: number;
};

export type PhyniteCloudState = {
  state: string;
  enabled: boolean;
  provisioned: boolean;
  imageReady: boolean;
  imageTag?: string;
  maxVcpus?: number;
  queueArn?: string | null;
  networkReady?: boolean;
  subnets?: string;
  securityGroups?: string;
  instanceTypes?: string;
  operatorRoleReady?: boolean;
};

export type PhyniteAdminExport = {
  id: string;
  dataset: 'server' | 'account' | 'worker' | 'audit' | 'analytics';
  format: 'csv' | 'jsonl';
  source?: string;
  from: string;
  to: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  createdAt: string;
  completedAt?: string;
  count?: number;
  error?: string;
  downloadUrl?: string;
};

export type PhyniteServerLogPage = { events: PhyniteOperationEvent[]; nextCursor: string | null; source: string; available: boolean; retentionDays: number; from: string; to: string; retrievedAt: string };

export type PhyniteCloudControl = {
  paid?: { configured: boolean; accepting: boolean; version: number };
  configured: boolean;
  state: 'OFF' | 'STARTING' | 'ON' | 'DRAINING' | 'STOPPING' | 'ERROR';
  version: number;
  enabled: boolean;
  region: string;
  hostPresent: boolean;
  hostDeadlineAtEpoch: number | null;
  workerOnline: boolean;
  limits: { vcpus: number; memoryMiB: number; timeoutSeconds: number; hostSeconds: number };
  runtimeImageDigest: string;
  fleetInstalled?: boolean;
  activeJobId: string | null;
  budget: { totalUsd: number; bufferUsd: number; availableUsd: number; spentUpperUsd: number; reservedUsd: number; billingSettled: boolean; version?: number };
  creditCheck: { checkedAt: string; remainingCreditsUsd: number; planType: string; planStatus: string } | null;
  error: string | null;
  operation: PhyniteCloudControlOperation | null;
  retrievedAt: string;
};
export type PhyniteCloudControlOperation = {
  id: string; action: 'enable' | 'disable'; state: string;
  createdAt: string; updatedAt: string; completedAt?: string; error?: string;
};
export const phyniteAdminCloud = {
  admission: (input: { accepting: boolean; password: string; idempotencyKey: string; expectedVersion: number }) => phyniteApi<{ cloud: PhyniteCloudControl }>('/v1/developer/compute/paid/admission', { method: 'PATCH', body: input }),
  budget: (input: { totalUsd: number; bufferUsd: number; password: string; idempotencyKey: string; expectedVersion: number }) => phyniteApi<{ cloud: PhyniteCloudControl }>('/v1/developer/compute/cloud/budget', { method: 'PATCH', body: input }),
  status: () => phyniteApi<{ cloud: PhyniteCloudControl }>('/v1/developer/compute/cloud', { cache: 'no-store' }),
  action: (input: { action: 'enable' | 'disable'; password: string; idempotencyKey: string; expectedVersion: number }) =>
    phyniteApi<{ operation: PhyniteCloudControlOperation }>('/v1/developer/compute/cloud/actions', { method: 'POST', body: input }),
  grant: (userId: string, input: { enabled: boolean; jobLimit: number; expiresAtEpoch: number; maxVcpus?: number; maxMemoryMiB?: number; timeoutSeconds?: number; budgetUsd?: number; password: string; idempotencyKey: string; expectedVersion: number }) =>
    phyniteApi<{ user: PhyniteAdminUser }>(`/v1/developer/users/${encodeURIComponent(userId)}/cloud-grant`, { method: 'PATCH', body: input }),
};

export const phyniteDeveloperOperations = {
  snapshot: () => phyniteApi<{ snapshot: PhyniteOverviewMetric<{ retrievedAt: string; stackStatus: string; localWorkerEnabled: boolean; sharedWorkerTokenRevoked: boolean; workers: PhyniteDeveloperWorker[]; cloud: Record<'dft' | 'md', PhyniteCloudState>; activeOperation: PhyniteComputeOperation | null }> }>('/v1/developer/operations/snapshot', { cache: 'no-store' }),
  sourcesSnapshot: () => phyniteApi<{ snapshot: PhyniteOverviewMetric<{ sources: Array<{ id: string; available: boolean; retentionDays: number; group: string | null; lastEventAt?: string | null }>; retrievedAt: string }> }>('/v1/developer/operations/sources-snapshot', { cache: 'no-store' }),
  status: () => phyniteApi<{ retrievedAt: string; stackStatus: string; localWorkerEnabled: boolean; sharedWorkerTokenRevoked: boolean; workers: PhyniteDeveloperWorker[]; cloud: Record<'dft' | 'md', PhyniteCloudState>; activeOperation: PhyniteComputeOperation | null }>(
    '/v1/developer/operations/status', { cache: 'no-store' },
  ),
  sources: () => phyniteApi<{ sources: Array<{ id: string; available: boolean; retentionDays: number; group: string | null }>; retrievedAt: string }>(
    '/v1/developer/operations/sources', { cache: 'no-store' },
  ),
  logs: (query: URLSearchParams) => phyniteApi<PhyniteServerLogPage | { operationId: string; status: 'pending'; progress: string }>(
    `/v1/developer/operations/logs?${query}`, { cache: 'no-store' },
  ),
  logOperation: (id: string) => phyniteApi<{ operationId: string; status: 'pending' | 'complete' | 'failed'; progress: string; error?: string; page?: PhyniteServerLogPage }>(
    `/v1/developer/operations/logs/operations/${encodeURIComponent(id)}`, { cache: 'no-store' },
  ),
  activity: (query: URLSearchParams) => phyniteApi<{ events: PhyniteOperationEvent[]; nextCursor: string | null; kind: string; retentionDays: number | null; from: string; to: string; recordingSince: string | null; retrievedAt: string }>(
    `/v1/developer/operations/activity?${query}`, { cache: 'no-store' },
  ),
  export: (input: { dataset: 'server' | 'account' | 'worker' | 'audit' | 'analytics'; format: 'csv' | 'jsonl'; source?: string; accountId?: string; type?: string; from: string; to: string; tab?: string; country?: string; device?: string; area?: string }) =>
    phyniteApi<{ export: PhyniteAdminExport }>('/v1/developer/exports', { method: 'POST', body: input }),
  exportStatus: (id: string) => phyniteApi<{ export: PhyniteAdminExport }>(
    `/v1/developer/exports/${encodeURIComponent(id)}`, { cache: 'no-store' },
  ),
  exportDownload: (id: string) => phyniteApi<{ export: PhyniteAdminExport }>(
    `/v1/developer/exports/${encodeURIComponent(id)}/download`, { method: 'POST', body: {} },
  ),
  computeAction: (kind: 'dft' | 'md', action: 'enable' | 'disable' | 'retry', reason: string, idempotencyKey: string, desired?: 'enable' | 'disable') =>
    phyniteApi<{ operation: PhyniteComputeOperation }>(
      `/v1/developer/compute/${kind}/actions`, { method: 'POST', body: { action, reason, idempotencyKey, ...(desired ? { desired } : {}) } },
    ),
  computeOperation: (kind: 'dft' | 'md', id: string) => phyniteApi<{ operation: PhyniteComputeOperation }>(
    `/v1/developer/compute/${kind}/operations/${encodeURIComponent(id)}`, { cache: 'no-store' },
  ),
  revokeSharedWorkerToken: (reason: string) => phyniteApi<{ revoked: boolean }>(
    '/v1/developer/workers/revoke-token', { method: 'POST', body: { reason } },
  ),
};

export const phyniteAnnouncement = {
  get: () => phyniteApi<{ announcement: PhyniteSystemAnnouncement; history: PhynitePublicSentAnnouncement[] }>(
    '/v1/announcement', { cache: 'no-store' },
  ),
  adminGet: () => phyniteApi<{ announcement: PhyniteSystemAnnouncement; history: PhyniteSentAnnouncement[] }>(
    '/v1/developer/announcement', { cache: 'no-store' },
  ),
  update: (message: string, enabled: boolean) => phyniteApi<{ announcement: PhyniteSystemAnnouncement; history: PhyniteSentAnnouncement[] }>(
    '/v1/developer/announcement', { method: 'PUT', body: { message, enabled } },
  ),
};

export const phyniteInbox = {
  list: (cursor = '', limit = 20) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return phyniteApi<{ items: PhyniteInboxItem[]; nextCursor: string | null; hasUnread: boolean; retrievedAt: string }>(
      `/v1/inbox?${query}`, { cache: 'no-store' },
    );
  },
  markRead: (messageId: string) => phyniteApi<{ messageId: string; readAt: string }>(
    `/v1/inbox/${encodeURIComponent(messageId)}/read`, { method: 'POST', body: {} },
  ),
  markAllRead: (cursor = '') => phyniteApi<{ marked: number; completed: boolean; nextCursor: string | null }>(
    '/v1/inbox/read-all', { method: 'POST', body: cursor ? { cursor } : {} },
  ),
};

export const phyniteDeveloperMessages = {
  list: (cursor = '', limit = 20) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return phyniteApi<{ messages: PhyniteAdminMessage[]; nextCursor: string | null; retrievedAt: string }>(
      `/v1/developer/messages?${query}`, { cache: 'no-store' },
    );
  },
  send: (payload: { idempotencyKey: string; title: string; body: string; audience: PhyniteMessageAudience }) =>
    phyniteApi<{ message: PhyniteAdminMessage }>(
      '/v1/developer/messages', { method: 'POST', body: payload },
    ),
};

export const phyniteDeveloperFailures = {
  digest: () => phyniteApi<PhyniteFailureDigest>('/v1/developer/failures', { cache: 'no-store' }),
};

export type PhynitePreflightEvent = {
  ownerId: string;
  operation: string;
  code: string;
  createdAt: string;
};

export const phyniteDeveloperSecurity = {
  preflight: () => phyniteApi<{ events: PhynitePreflightEvent[]; sampleLimit: number; coverage: string }>(
    '/v1/developer/preflight', { cache: 'no-store' },
  ),
};

export type PhyniteStorageInventory = {
  totalBytes: number;
  objectCount: number;
  categories: Record<string, { bytes: number; objects: number }>;
  complete: boolean;
  maxObjects: number;
  retrievedAt: string;
};

export type PhyniteCacheCleanup = {
  candidateObjects: number;
  candidateBytes: number;
  deletedObjects: number;
  examinedObjects: number;
  complete: boolean;
  minimumAgeDays: number;
  dryRun: boolean;
};

export const phyniteDeveloperStorage = {
  inventory: () => phyniteApi<{ snapshot: PhyniteOverviewMetric<PhyniteStorageInventory> }>(
    '/v1/developer/storage', { cache: 'no-store' },
  ),
  cleanupCache: (dryRun: boolean) => phyniteApi<{ cleanup: PhyniteCacheCleanup }>(
    '/v1/developer/storage/cache-cleanup', { method: 'POST', body: { dryRun } },
  ),
};

export type PhyniteResearchOrganization = {
  id: string;
  name: string;
  piId: string;
  quantaBalance: string | null;
  budgetVisible: boolean;
  createdAt: string;
  updatedAt: string;
  myRole: 'PI' | 'MEMBER' | null;
  dataAccess: 'OWNERS_ONLY';
  billingAvailable: false;
};

export type PhyniteOrganizationMember = {
  userId: string;
  role: 'PI' | 'MEMBER';
  createdAt: string;
};

const organizationBase = (admin: boolean) => admin ? '/v1/developer/orgs' : '/v1/orgs';

export const phyniteOrganizations = {
  list: (admin = false) => phyniteApi<{ organizations: PhyniteResearchOrganization[]; retrievedAt: string }>(
    organizationBase(admin), { cache: 'no-store' },
  ),
  detail: (orgId: string, admin = false) => phyniteApi<{ organization: PhyniteResearchOrganization; members: PhyniteOrganizationMember[] }>(
    `${organizationBase(admin)}/${encodeURIComponent(orgId)}`, { cache: 'no-store' },
  ),
  create: (name: string, piId: string) => phyniteApi<{ organization: PhyniteResearchOrganization }>(
    organizationBase(true), { method: 'POST', body: { name, piId } },
  ),
  addMember: (orgId: string, userId: string) => phyniteApi<{ member: PhyniteOrganizationMember }>(
    `${organizationBase(true)}/${encodeURIComponent(orgId)}/members`, { method: 'POST', body: { userId } },
  ),
  grant: (orgId: string, amount: string, reason: string, idempotencyKey: string) => phyniteApi<{ organization: PhyniteResearchOrganization }>(
    `${organizationBase(true)}/${encodeURIComponent(orgId)}/quanta`,
    { method: 'POST', body: { amount, reason, idempotencyKey } },
  ),
  allocate: (orgId: string, memberId: string, amount: string, reason: string, idempotencyKey: string, admin = false) => phyniteApi<{ organization: PhyniteResearchOrganization }>(
    `${organizationBase(admin)}/${encodeURIComponent(orgId)}/allocations`,
    { method: 'POST', body: { memberId, amount, reason, idempotencyKey } },
  ),
};

export type DftWorkflowRequest = {
  idempotencyKey: string;
  nodes: Array<{ id: string; dependsOnNodeIds: string[]; scfReuse?: import('./dft-workflow.ts').ScfReusePolicy; request: Parameters<typeof phyniteCalculations.create>[1] }>;
  targetNodeIds?: string[];
};
export type DftWorkflowRun = { id: string; status: string; submissionError?: string; nodes: Record<string, { calculationId: string; reused: boolean; owned: boolean }> };
export const phyniteWorkflowRuns = {
  submit: async (projectId: string, input: DftWorkflowRequest) => {
    // Quote each exact node through the same admission path as standalone jobs.
    const nodes = [];
    for (const node of input.nodes) nodes.push({ ...node, request: await prepareComputeRequest(node.request, body => phyniteApi('/v1/compute/quote', { method: 'POST', body })) });
    return phyniteApi<{ workflowRun: DftWorkflowRun; calculations: PhyniteCalculation[] }>(`/v1/projects/${encodeURIComponent(projectId)}/workflow-runs`, { method: 'POST', body: { ...input, nodes } });
  },
  get: (id: string) => phyniteApi<{ workflowRun: DftWorkflowRun; calculations: PhyniteCalculation[] }>(`/v1/workflow-runs/${encodeURIComponent(id)}`, { cache: 'no-store' }),
  cancel: (id: string) => phyniteApi<{ workflowRun: DftWorkflowRun }>(`/v1/workflow-runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
};
