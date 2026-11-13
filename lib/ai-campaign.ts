/** Version-one approvals never acquire authority from a legacy campaign record. */
export type AiNumericalRepair = { mixingBeta?: number; mixingMode?: 'plain' | 'TF' | 'local-TF'; diagonalization?: 'david' | 'cg'; electronMaxSteps?: number };
export type AiCampaignBudget = { wallSecondsPerAttempt: number; queueSecondsPerAttempt: number; totalNodeHours: number; expiresAtEpoch: number };
export type AiCampaignAttempt = { candidateIndex: number; attempt: number; phase: string; mode: 'workflow' | 'calculation'; expectedId: string; requestSha256: string; inputSha256: string; sourceInputSha256?: string; resultManifestSha256?: string; jobId?: string; reason: string; outcome?: string; diagnosis?: string; nodeHours: number };
export type AiPersistentCampaign = { schemaVersion: 1; id: string; projectId: string; conversationId: string; revision: number; status: 'executing' | 'completed' | 'cancelled' | 'manual resume required'; candidateIndex: number; attempts: AiCampaignAttempt[]; usedNodeHours: number; cancelRequested: boolean; reason?: string };
export type AiCampaignStatus = { campaign: AiPersistentCampaign; budget: AiCampaignBudget; repairs: AiNumericalRepair[] };
