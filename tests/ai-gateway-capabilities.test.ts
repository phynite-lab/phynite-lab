import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayCapabilities, requireGatewayCapability } from '../lib/ai-gateway-capabilities.ts';
const model = 'claude-sonnet-5' as const;
test('unverified gateway capabilities cannot enable text, effort or multimodal features', () => {
  assert.equal(gatewayCapabilities({})[model].available, false);
  assert.throws(() => requireGatewayCapability({}, model, 'auto'), { code: 'AI_MODEL_UNVERIFIED' });
  const env = { PHYNITE_AI_GATEWAY_CAPABILITIES: JSON.stringify({ checkedAt: '2026-10-23T00:00:00Z', models: { [model]: { available: true, text: true, streaming: true, tools: true, images: false, pdf: true, efforts: ['auto', 'low', 'xhigh'] } } }) };
  assert.deepEqual(gatewayCapabilities(env)[model].efforts, ['auto', 'low', 'xhigh']);
  assert.throws(() => requireGatewayCapability(env, model, 'high'), { code: 'AI_EFFORT_UNSUPPORTED' });
  assert.throws(() => requireGatewayCapability(env, model, 'auto', ['image/png']), { code: 'AI_IMAGE_UNSUPPORTED' });
  assert.doesNotThrow(() => requireGatewayCapability(env, model, 'low', ['application/pdf']));
});
test('fixture capability bypass is restricted to a loopback model provider', () => {
  assert.equal(gatewayCapabilities({ PHYNITE_AI_ALLOW_LOOPBACK_PROVIDER: 'true', PHYNITE_AI_BASE_URL: 'https://gateway.example' })[model].available, false);
  assert.equal(gatewayCapabilities({ PHYNITE_AI_ALLOW_LOOPBACK_PROVIDER: 'true', PHYNITE_AI_BASE_URL: 'http://127.0.0.1:8791' })[model].available, true);
});
test('local gateways require tested tools even when the provider listens on loopback', () => {
  const base = { PHYNITE_APP_MODE: 'local', PHYNITE_AI_ALLOW_LOOPBACK_PROVIDER: 'true', PHYNITE_AI_9ROUTER_BASE_URL: 'http://127.0.0.1:8791' };
  const checked = { checkedAt: '2026-10-29T00:00:00Z', models: { 'my-model': { text: true, streaming: true, tools: false, available: false, efforts: ['auto'] } } };
  const environment = { ...base, PHYNITE_AI_9ROUTER_CAPABILITIES: JSON.stringify(checked) };
  assert.throws(() => requireGatewayCapability(environment, 'my-model', 'auto', [], '9router'), { code: 'AI_MODEL_UNVERIFIED' });
  checked.models['my-model'].tools = true; checked.models['my-model'].available = true;
  assert.doesNotThrow(() => requireGatewayCapability({ ...base, PHYNITE_AI_9ROUTER_CAPABILITIES: JSON.stringify(checked) }, 'my-model', 'auto', [], '9router'));
});
