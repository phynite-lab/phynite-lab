import type { AiAgentBudget, AiAgentState, AiCampaignContract, AiVisionEvidence } from './ai-contract.ts';

export const AI_AGENT_RUNTIME_MESSAGE = 'Versi aplikasi ini belum memiliki modul Discovery. Perbarui Phynite Lab untuk mengaktifkannya.';
export const aiAgentFeatureNames = ['ai-agent-operator', 'ai-agent-vision', 'ai-agent-healing', 'ai-agent-discovery'] as const;
export type AiAgentFeature = typeof aiAgentFeatureNames[number];
export type AiAgentFeatureFlags = Record<AiAgentFeature, boolean>;
export const defaultAiAgentFeatureFlags: AiAgentFeatureFlags = { 'ai-agent-operator': true, 'ai-agent-vision': false, 'ai-agent-healing': false, 'ai-agent-discovery': false };

export function aiAgentFeatureFlags(source: Record<string, string | undefined> = {}): AiAgentFeatureFlags {
  return Object.fromEntries(aiAgentFeatureNames.map(name => {
    const key = `PHYNITE_${name.toUpperCase().replaceAll('-', '_')}`;
    const raw = source[key];
    return [name, raw === undefined ? defaultAiAgentFeatureFlags[name] : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())];
  })) as AiAgentFeatureFlags;
}

export function aiAgentFeatureEnabled(name: AiAgentFeature, source: Record<string, string | undefined> = {}): boolean {
  return aiAgentFeatureFlags(source)[name];
}

export function validateAiVisionEvidence(value: AiVisionEvidence): AiVisionEvidence {
  if (!value.attachmentId || !/^[a-f0-9]{64}$/.test(value.attachmentSha256) || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 || !value.label || value.approximate !== true) throw new Error('Vision evidence is incomplete or unverified.');
  if (value.page !== undefined && (!Number.isSafeInteger(value.page) || value.page < 1)) throw new Error('Vision evidence page is invalid.');
  if (value.region && (!Number.isFinite(value.region.x) || !Number.isFinite(value.region.y) || !Number.isFinite(value.region.width) || !Number.isFinite(value.region.height) || value.region.width <= 0 || value.region.height <= 0)) throw new Error('Vision evidence region is invalid.');
  return value;
}

export const aiAgentStates: readonly AiAgentState[] = ['planning', 'awaiting approval', 'executing', 'observing', 'validating', 'completed', 'repair proposed', 'manual resume required'];
const transitions: Record<AiAgentState, readonly AiAgentState[]> = {
  planning: ['awaiting approval', 'executing', 'manual resume required'],
  'awaiting approval': ['executing', 'manual resume required'],
  executing: ['observing', 'repair proposed', 'manual resume required', 'completed'],
  observing: ['validating', 'repair proposed', 'manual resume required'],
  validating: ['completed', 'repair proposed', 'manual resume required'],
  completed: [],
  'repair proposed': ['awaiting approval', 'executing', 'manual resume required'],
  'manual resume required': ['observing', 'validating', 'awaiting approval'],
};
export function canAdvanceAiAgentState(from: AiAgentState, to: AiAgentState): boolean { return from === to || transitions[from].includes(to); }

export function validateAiAgentBudget(value: AiAgentBudget): AiAgentBudget {
  const integerKeys: Array<keyof AiAgentBudget> = ['maxWallSeconds', 'maxQueueWaitSeconds', 'agentLeaseTimeoutSeconds', 'maxRepairs', 'maxSparseHarvestBytes'];
  for (const key of integerKeys) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) throw new Error(`${key} must be a non-negative integer.`);
  if (value.maxRepairs > 2) throw new Error('At most two numerical repairs are supported per candidate.');
  if (value.maxWallSeconds < 1 || value.maxQueueWaitSeconds < 1 || value.agentLeaseTimeoutSeconds < 1) throw new Error('Agent time budgets must be positive.');
  if (value.maxCandidates !== undefined && (!Number.isSafeInteger(value.maxCandidates) || value.maxCandidates < 1 || value.maxCandidates > 5)) throw new Error('Ruang desain ini terlalu besar untuk mode Discovery saat ini. Kurangi menjadi maksimal 5 kandidat.');
  if (value.maxNodeHours !== undefined && (!Number.isFinite(value.maxNodeHours) || value.maxNodeHours <= 0)) throw new Error('maxNodeHours must be positive and finite.');
  if (value.maxSparseHarvestBytes < 1 || value.maxSparseHarvestBytes > 256 * 1024 * 1024) throw new Error('Sparse evidence exceeds the 256 MiB safety limit.');
  return value;
}

export type AiPreset = { id: 'quick-convergence-sweep' | 'overnight-discovery' | 'self-healing-relax'; label: string; description: string; contract: Partial<AiCampaignContract> };
export const aiAgentPresets: readonly AiPreset[] = [
  { id: 'quick-convergence-sweep', label: 'Quick Convergence Sweep', description: '3 kandidat cutoff, standar tervalidasi tetap dijaga, dan maksimal 1 jam komputasi.', contract: { maxCandidates: 3, totalNodeHours: 1, repairPolicy: ['lower_mixing_beta', 'switch_solver', 'raise_electron_maxstep'] } },
  { id: 'overnight-discovery', label: 'Overnight Discovery', description: 'Hingga 5 kandidat variasi kisi dengan validasi geometry dan provenance lengkap.', contract: { maxCandidates: 5, totalNodeHours: 6, repairPolicy: ['lower_mixing_beta', 'switch_solver', 'raise_electron_maxstep'] } },
  { id: 'self-healing-relax', label: 'Self-Healing Relax', description: 'Cell relaxation dengan repair yang diizinkan dan checkpoint yang dipertahankan.', contract: { maxCandidates: 1, repairPolicy: ['lower_mixing_beta', 'switch_solver', 'raise_electron_maxstep'] } },
];

export function aiCampaignSummary(contract: Partial<AiCampaignContract> & { clusterLabel?: string }): string {
  const count = typeof contract.maxCandidates === 'number' ? `Maksimal ${contract.maxCandidates} kandidat` : 'Kandidat terbatas';
  const range = Object.entries(contract.parameterRanges ?? {}).map(([name, value]) => `${name} ${value.min}–${value.max}${value.unit ? ` ${value.unit}` : ''}`).join(', ');
  const budget = typeof contract.totalNodeHours === 'number' ? `hingga ${contract.totalNodeHours} jam node` : '';
  const cluster = contract.clusterLabel ? `pada kluster ${contract.clusterLabel}` : '';
  return [count, range && `rentang ${range}`, budget, cluster].filter(Boolean).join(', ') + '.';
}

export function aiCampaignCandidateWithinContract(candidate: Record<string, unknown>, contract: AiCampaignContract, usedNodeHours = 0): boolean {
  const parameters = candidate.parameters && typeof candidate.parameters === 'object' ? candidate.parameters as Record<string, unknown> : candidate;
  for (const [name, bounds] of Object.entries(contract.parameterRanges)) {
    const value = parameters[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < bounds.min || value > bounds.max) return false;
  }
  if (candidate.cluster !== undefined && !contract.allowedClusters.includes(String(candidate.cluster))) return false;
  if (typeof candidate.wallSeconds === 'number' && candidate.wallSeconds > contract.maxWallSecondsPerCandidate) return false;
  return usedNodeHours + (typeof candidate.nodeHours === 'number' ? candidate.nodeHours : 0) <= contract.totalNodeHours;
}

export type AiHumanError = { title: string; message: string; action: 'Sambung Ulang' | 'Lihat status job' | 'Tinjau perubahan' | 'Lanjutkan manual' | 'Unduh evidence' };
export const aiAgentHumanErrors: Record<string, AiHumanError> = {
  SSH_DISCONNECTED: { title: 'Koneksi ke kluster terputus', message: 'WiFi atau VPN kampus mungkin sedang offline. Job remote tetap dipantau dan tidak dibatalkan. Sambungkan kembali internet Anda, lalu tekan Sambung Ulang.', action: 'Sambung Ulang' },
  JOB_QUEUED: { title: 'Job masih menunggu antrean', message: 'Kluster belum menempatkan job ke node komputasi. Ini belum dianggap gagal. Agent akan memantau sampai batas tunggu antrean yang Anda pilih.', action: 'Lihat status job' },
  OUTPUT_INCOMPLETE: { title: 'Output belum lengkap', message: 'File hasil belum cukup untuk memastikan kalkulasi berhasil. Checkpoint dan scratch dipertahankan.', action: 'Lanjutkan manual' },
  REPAIR_APPROVAL: { title: 'Perlu keputusan tentang perubahan metode', message: 'Perhitungan mengalami masalah konvergensi. Agent menyiapkan perubahan yang aman untuk ditinjau sebelum mencoba lagi.', action: 'Tinjau perubahan' },
};
export function aiAgentHumanError(code: string): AiHumanError { return aiAgentHumanErrors[code] ?? { title: 'Pekerjaan belum selesai', message: 'Agent menyimpan bukti yang tersedia dan menunggu tindakan Anda.', action: 'Unduh evidence' }; }
