import { aiEfforts, type AiEffort, type AiProviderId } from './ai-contract.ts';
export type AiReasoningControl = 'adaptive' | 'budget_tokens' | 'effort_param' | 'none';
export type AiReasoningCapability = { reasoningControl: AiReasoningControl; supportedEfforts: AiEffort[]; maxOutputTokens: number };
export function aiReasoningCapability(source: Omit<Partial<AiReasoningCapability>, 'supportedEfforts'> & { supportedEfforts?: readonly AiEffort[]; efforts?: readonly AiEffort[] } | undefined, provider: AiProviderId = 'phynite'): AiReasoningCapability {
  const control = source?.reasoningControl ?? (provider === 'local' ? 'effort_param' : provider === 'phynite' ? 'adaptive' : 'none');
  const reasoningControl = ['adaptive', 'budget_tokens', 'effort_param', 'none'].includes(control) ? control : 'none';
  const levels = source?.supportedEfforts ?? source?.efforts ?? ['auto'];
  const supportedEfforts = Array.isArray(levels) ? levels.filter((value): value is AiEffort => aiEfforts.includes(value) && (reasoningControl !== 'none' || value === 'auto')) : [];
  const tokens = source?.maxOutputTokens;
  return { reasoningControl, supportedEfforts, maxOutputTokens: Number.isInteger(tokens) && tokens! >= (reasoningControl === 'budget_tokens' ? 2048 : 1024) && tokens! <= 65536 ? tokens! : provider === 'phynite' ? 65536 : 16384 };
}
export function aiReasoningParameters(capability: AiReasoningCapability, effort: AiEffort): Record<string, unknown> {
  if (!capability.supportedEfforts.includes(effort)) throw new Error('Unsupported reasoning effort.');
  if (effort === 'auto') return {};
  if (capability.reasoningControl === 'adaptive') return { output_config: { effort }, thinking: { type: 'adaptive' } };
  if (capability.reasoningControl === 'effort_param') return { output_config: { effort } };
  if (capability.reasoningControl === 'budget_tokens') {
    const budget = { low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 32768 }[effort];
    return { thinking: { type: 'enabled', budget_tokens: Math.min(budget, capability.maxOutputTokens - 1) } };
  }
  return {};
}
export function aiStageEffort(requested: AiEffort, task: string | undefined, capability: AiReasoningCapability): AiEffort {
  return requested === 'auto' && (task === 'plan' || task === 'research') && capability.supportedEfforts.includes('high') ? 'high' : requested;
}
