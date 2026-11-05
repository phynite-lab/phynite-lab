import { aiCapabilities, aiModels, isGatewayModelId, type AiEffort, type AiModelId, type AiProviderId } from './ai-contract.ts';

export type AiCatalogModel = { id: AiModelId; label: string; capabilities: { available?: boolean; efforts?: AiEffort[] } };
export type AiCatalogProvider = { id: AiProviderId; configured: boolean; models: AiCatalogModel[]; local?: boolean };
export type AiModelChoice = { value: string; providerId: AiProviderId; label: string; models: Partial<Record<AiEffort, AiModelId>>; available: boolean };
export function aiModelLabel(id: AiModelId, fallback = id as string): string {
  if (!id.includes('/')) return fallback;
  const raw = id.slice(id.indexOf('/') + 1);
  // Claude Code aliases (sonnet, opus, ...) need the product name to be recognizable in the picker.
  if (id.startsWith('claude/')) return `Claude ${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;
  const label = id.startsWith('agy/') ? raw : raw.replace(/-(low|medium|high)$/, '');
  return label.split('-').map(word => ({ gpt: 'GPT', oss: 'OSS', gemini: 'Gemini', flash: 'Flash', pro: 'Pro', sol: 'Sol', luna: 'Luna', astra: 'Astra' })[word] ?? word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
export function routerEffort(id: string): AiEffort {
  return /^ag\/gemini-.*-(low|medium|high)$/.exec(id)?.[1] as AiEffort ?? 'auto';
}
export function aiModelFamily(id: AiModelId): AiModelId {
  return (routerEffort(id) === 'auto' ? id : id.replace(/-(low|medium|high)$/, '')) as AiModelId;
}
/** Keep retired and unrelated families out of the user-facing catalogue. */
export function isAiPickerModel(providerId: AiProviderId, id: AiModelId, local = false): boolean {
  if (local && (providerId === '9router' || providerId === 'local')) return isGatewayModelId(id);
  return providerId === 'phynite' ? aiModels.some(model => model.id === id)
    : /^ag\/gemini-3\.8-flash(?:-(low|medium|high))?$/.test(id);
}
/** One picker, with real router variants grouped under their model family. */
export function aiModelChoices(providers: AiCatalogProvider[]): AiModelChoice[] {
  const choices = new Map<string, AiModelChoice>();
  for (const provider of providers) for (const model of provider.models) {
    if (!isAiPickerModel(provider.id, model.id, provider.local)) continue;
    const family = provider.id === '9router' || provider.id === 'local' ? aiModelFamily(model.id) : model.id;
    const value = `${provider.id}:${family}`;
    const available = provider.configured && model.capabilities.available !== false;
    const choice = choices.get(value) ?? { value, providerId: provider.id, label: aiModelLabel(family, model.label), models: {}, available: false };
    if (provider.id === 'phynite') for (const effort of model.capabilities.efforts ?? aiCapabilities(model.id).efforts) choice.models[effort] = model.id;
    else if (available) {
      const efforts = provider.id === 'local' ? model.capabilities.efforts ?? ['auto'] : [routerEffort(model.id)];
      for (const effort of efforts) choice.models[effort] = model.id;
    }
    choice.available ||= available;
    choices.set(value, choice);
  }
  return [...choices.values()];
}
