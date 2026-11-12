import { aiReasoningCapability, type AiReasoningCapability } from './ai-reasoning.ts';
/** Server-owned gateway evidence. Never infer a passed probe from a model name. */
import { aiCapabilities, aiModels, type AiProviderId, type AiEffort, type AiModelId } from './ai-contract.ts';
import { AiError, routerModelIds } from './ai-provider.ts';
export type AiGatewayModel = AiReasoningCapability & { available: boolean; text: boolean; streaming: boolean; tools: boolean; images: boolean; pdf: boolean; efforts: AiEffort[] };
export function gatewayCapabilities(env: Record<string, string | undefined>, providerId: AiProviderId = 'phynite'): Record<AiModelId, AiGatewayModel> {
  const local = providerId === 'local';
  const fixture = env.PHYNITE_APP_MODE !== 'local' && env.PHYNITE_AI_ALLOW_LOOPBACK_PROVIDER === 'true' && (providerId === '9router' ? env.PHYNITE_AI_9ROUTER_BASE_URL : env.PHYNITE_AI_BASE_URL)?.startsWith('http://127.0.0.1:');
  let models: Record<string, Partial<AiGatewayModel>> = {};
  const raw = local ? env.PHYNITE_LOCAL_AI_CAPABILITIES : providerId === '9router' ? env.PHYNITE_AI_9ROUTER_CAPABILITIES : env.PHYNITE_AI_GATEWAY_CAPABILITIES;
  if (raw) {
    try {
      const report = JSON.parse(raw) as { checkedAt?: string; models?: typeof models };
      if (!report.checkedAt || !Number.isFinite(Date.parse(report.checkedAt)) || !report.models || typeof report.models !== 'object') throw new Error();
      models = report.models;
    } catch { throw new AiError(503, 'AI_CAPABILITIES_INVALID', 'The gateway compatibility report needs attention.'); }
  }
  return Object.fromEntries((providerId === '9router' || local ? routerModelIds(env, local).map(id => ({ id })) : aiModels).map(model => {
    const source = fixture ? { ...aiCapabilities(model.id), available: true } : models[model.id];
    const reasoning = aiReasoningCapability(source, providerId);
    const efforts = reasoning.supportedEfforts;
    const capability: AiGatewayModel = { available: source?.available === true && source.text === true && source.streaming === true && source.tools === true, text: source?.text === true, streaming: source?.streaming === true, tools: source?.tools === true, images: source?.images === true, pdf: source?.pdf === true, ...reasoning, efforts };
    return [model.id, capability];
  })) as Record<AiModelId, AiGatewayModel>;
}
export function requireGatewayCapability(env: Record<string, string | undefined>, modelId: AiModelId, effort: AiEffort, mediaTypes: string[] = [], providerId: AiProviderId = 'phynite') {
  const model = gatewayCapabilities(env, providerId)[modelId];
  if (!model?.available) throw new AiError(503, 'AI_MODEL_UNVERIFIED', 'This model has not passed gateway text and tool checks. Choose another verified model or ask the operator to rerun compatibility checks.');
  if (!model.efforts.includes(effort)) throw new AiError(422, 'AI_EFFORT_UNSUPPORTED', 'The gateway has not verified this effort for the selected model. Choose Auto or another available level.');
  if (mediaTypes.some(type => type === 'application/pdf') && !model.pdf) throw new AiError(422, 'AI_PDF_UNSUPPORTED', 'PDF reading has not passed this model’s gateway check. Choose a verified model or attach extracted text.');
  if (mediaTypes.some(type => type.startsWith('image/')) && !model.images) throw new AiError(422, 'AI_IMAGE_UNSUPPORTED', 'Image reading has not passed this model’s gateway check. Choose another verified model.');
  return model;
}

/** Attachment types that need verified native model input before a turn starts. A PDF is not one:
 * without verified native PDF input the turn reads its extracted text and states that limit. */
export function nativeInputMediaTypes(mediaTypes: string[]): string[] {
  return mediaTypes.filter(type => type !== 'application/pdf');
}
