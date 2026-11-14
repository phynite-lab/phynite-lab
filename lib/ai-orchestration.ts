import type { AiStrategy } from './ai-contract.ts';
import type { AiContextManifest } from './ai-workbench.ts';

export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'stale' | 'stopped' | 'interrupted';
export type TaskEvidence = { id: string; operation: string; sha256: string; capturedAt: string };
export type AgentTask = {
  id: string; parentId: string; index: number; goal: string; dependencies: number[];
  modelId: string; scope: string; status: AgentTaskStatus; generation: number;
  providerCalls: number; toolCalls: number; sources: AiContextManifest[]; evidence: TaskEvidence[];
  result?: { schemaVersion: 2; taskId: string; text: string; evidenceRefs: TaskEvidence[]; proposals: unknown[]; uncertainties: string[] } | null;
  resultSha256?: string; error?: string; messages?: Array<{ role: string; text: string }>;
};
export type AiOrchestrationState = {
  parent: null | { id: string; status: string; strategy: AiStrategy; resolvedStrategy?: 'solo' | 'team';
    modelId: string; providerCalls: number; toolCalls: number; reason?: string; generation: number };
  tasks: AgentTask[]; teamQualified?: boolean; usage?: { cost: null; label: string };
};
export function aiTaskCounts(state: AiOrchestrationState | null, decisions: number) {
  return { active: state?.tasks.filter(task => task.status === 'running').length ?? 0,
    queued: state?.tasks.filter(task => task.status === 'queued').length ?? 0, decisions };
}
