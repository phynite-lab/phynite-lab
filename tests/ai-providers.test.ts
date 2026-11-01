import test from 'node:test';
import assert from 'node:assert/strict';
import { aiCapabilities, isRouterModelId } from '../lib/ai-contract.ts';
import { aiProviderConfig, streamClaude } from '../lib/ai-provider.ts';
import { gatewayCapabilities, requireGatewayCapability } from '../lib/ai-gateway-capabilities.ts';

const report = JSON.stringify({ checkedAt: '2026-10-23T00:00:00Z', models: { 'cx/research-model[1m]': { available: true, text: true, streaming: true, tools: true, images: false, pdf: false, efforts: ['auto'] }, 'cx/unverified': {} } });
const env = { PHYNITE_AI_AUTH_TOKEN: 'native-fixture', PHYNITE_AI_BASE_URL: 'https://native.example', PHYNITE_AI_9ROUTER_AUTH_TOKEN: 'router-fixture', PHYNITE_AI_9ROUTER_BASE_URL: 'https://router.example/v1', PHYNITE_AI_9ROUTER_CAPABILITIES: report };

test('router tunnel failures and credential failures identify the repair without falling back', async () => {
  for (const [status, code] of [[530, 'AI_ROUTER_UNREACHABLE'], [401, 'AI_PROVIDER_AUTH_FAILED']] as const) {
    let calls = 0;
    await assert.rejects(streamClaude({ config: aiProviderConfig(env, '9router')!, modelId: 'cx/research-model[1m]', system: '', messages: [], tools: [], signal: new AbortController().signal, onText() {}, fetcher: async () => { calls++; return new Response('private upstream detail', { status }); } }), { code });
    assert.equal(calls, 1);
  }
});

test('AI sources have separate server-only origins, credentials and exact model catalogues', () => {
  assert.equal(aiProviderConfig(env)?.baseUrl, 'https://native.example');
  assert.equal(aiProviderConfig(env)?.token, 'native-fixture');
  const router = aiProviderConfig(env, '9router')!;
  assert.equal(router.baseUrl, 'https://router.example');
  assert.equal(router.token, 'router-fixture');
  assert.deepEqual(router.modelIds, ['cx/research-model[1m]', 'cx/unverified']);
  assert.equal(aiProviderConfig({ PHYNITE_AI_AUTH_TOKEN: 'native' }, '9router'), null);
  assert.equal(aiProviderConfig({ PHYNITE_AI_9ROUTER_AUTH_TOKEN: 'router' }, '9router'), null);
  assert.throws(() => aiProviderConfig({ ...env, PHYNITE_AI_9ROUTER_BASE_URL: 'https://router.example/v1?key=bad' }, '9router'));
  assert.throws(() => aiProviderConfig({ ...env, PHYNITE_AI_9ROUTER_BASE_URL: 'http://router.example' }, '9router'));
});

test('9Router model capabilities never inherit Claude effort or unchecked visual support', () => {
  assert.deepEqual(aiCapabilities('cx/research-model[1m]').efforts, ['auto']);
  assert.equal(isRouterModelId('cx/gpt-astra-xhigh(ultra)'), true);
  assert.equal(gatewayCapabilities(env, '9router')['cx/research-model[1m]'].available, true);
  assert.equal(gatewayCapabilities(env, '9router')['cx/unverified'].available, false);
  requireGatewayCapability(env, 'cx/research-model[1m]', 'auto', [], '9router');
  assert.throws(() => requireGatewayCapability(env, 'cx/unverified', 'auto', [], '9router'));
  assert.throws(() => requireGatewayCapability(env, 'cx/research-model[1m]', 'high', [], '9router'));
  assert.throws(() => requireGatewayCapability(env, 'cx/research-model[1m]', 'auto', ['image/png'], '9router'));
  assert.throws(() => requireGatewayCapability(env, 'cx/research-model[1m]', 'auto', ['application/pdf'], '9router'));
  for (const id of ['https://evil.test', 'cx/model?url=bad', 'cx/../../admin', 'cx/model\n', 'cx/model with space']) assert.equal(isRouterModelId(id), false);
});

test('router requests preserve model IDs and errors never call the paid source', async () => {
  let count = 0;
  await assert.rejects(streamClaude({ config: aiProviderConfig(env, '9router')!, modelId: 'cx/research-model[1m]', effort: 'auto', system: 'Synthetic', messages: [], tools: [], signal: new AbortController().signal, onText() {}, fetcher: async (url, init) => {
    count++;
    assert.equal(url, 'https://router.example/v1/messages');
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer router-fixture');
    const body = JSON.parse(String(init!.body));
    assert.equal(body.model, 'cx/research-model[1m]');
    assert.equal(body.output_config, undefined);
    return new Response('private failure from upstream', { status: 429 });
  } }), /provider status 429/);
  assert.equal(count, 1);
  await assert.rejects(streamClaude({ config: aiProviderConfig(env, '9router')!, modelId: 'cx/unknown', system: '', messages: [], tools: [], signal: new AbortController().signal, onText() {}, fetcher: async () => { count++; return new Response(); } }), /catalogue/);
  assert.equal(count, 1);
});
