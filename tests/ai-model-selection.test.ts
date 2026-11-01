import test from 'node:test';
import assert from 'node:assert/strict';
import { aiModelChoices, aiModelFamily, aiModelLabel, isAiPickerModel } from '../lib/ai-model-selection.ts';
import { aiLiteratureEvidence } from '../lib/ai-evidence.ts';
import { streamClaude } from '../lib/ai-provider.ts';
import { aiModels, defaultAiModel, defaultAiProvider, type AiModelId } from '../lib/ai-contract.ts';

test('one model picker groups verified Gemini variants and retains exact source/effort mapping', () => {
  const choices = aiModelChoices([{ id: 'phynite', configured: true, models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', capabilities: { available: true, efforts: ['auto','high'] } }] }, { id: '9router', configured: true, models: ['ag/gemini-3.8-flash', 'ag/gemini-3.8-flash-low','ag/gemini-3.8-flash-medium','ag/gemini-3.8-flash-high','ag/claude-sonnet-5'].map(id => ({ id: id as AiModelId, label: id, capabilities: { available: !id.endsWith('-medium') } })) }]);
  assert.equal(choices.length, 2);
  const gemini = choices[1]; assert.equal(gemini.label, 'Gemini 3.8 Flash');
  assert.deepEqual(gemini.models, { auto: 'ag/gemini-3.8-flash', low: 'ag/gemini-3.8-flash-low', high: 'ag/gemini-3.8-flash-high' });
  assert.equal(choices[0].providerId, 'phynite');
  assert.equal(aiModelFamily('ag/gemini-3.8-flash-high'), 'ag/gemini-3.8-flash');
  assert.equal(aiModelLabel('cx/gpt-6-luna'), 'GPT 6 Luna');
});
test('arbitrary saved observations cannot crash the paper renderer or invent metadata', () => {
  for (const value of ['null', '{"papers":{}}', '{"papers":[{}]}', '{"papers":"notes"}', '{"papers":[],"warnings":[{}]}', 'not JSON']) assert.equal(aiLiteratureEvidence(value), null);
  const paper = { title: 'Evidence', url: 'https://example.test/paper', authors: ['A'], year: 2026, evidence: 'metadata', source: 'Crossref' };
  assert.deepEqual(aiLiteratureEvidence(JSON.stringify({ papers: [paper] })), { papers: [paper], warnings: [] });
});
test('router Gemini effort uses its exact variant ID without Claude reasoning parameters', async () => {
  await assert.rejects(streamClaude({ config: { providerId: '9router', baseUrl: 'https://router.example', token: 'fixture', modelIds: ['ag/gemini-3.8-flash-high'] }, modelId: 'ag/gemini-3.8-flash-high', effort: 'high', system: 'Synthetic', messages: [], tools: [], signal: new AbortController().signal, onText() {}, fetcher: async (_url, init) => {
    const body = JSON.parse(String(init!.body)); assert.equal(body.model, 'ag/gemini-3.8-flash-high'); assert.equal(body.thinking, undefined); assert.equal(body.output_config, undefined);
    return new Response('', { status: 429 });
  } }), { code: 'AI_PROVIDER_UNAVAILABLE' });
});

test('new chats default to Sonnet 5 and the picker omits GPT and retired Claude models', () => {
  assert.equal(defaultAiModel, 'claude-sonnet-5');
  assert.equal(defaultAiProvider, 'phynite');
  assert.deepEqual(aiModels.map(model => model.id), ['claude-opus-5-5', 'claude-sonnet-5']);
  const models: AiModelId[] = ['cx/gpt-6-luna', 'cx/gpt-6-astra', 'ag/gemini-3.8-pro', 'ag/gemini-3.8-flash', 'ag/gemini-3.8-flash-high'];
  const choices = aiModelChoices([{ id: '9router', configured: true, models: models.map(id => ({ id, label: id, capabilities: { available: true } })) }]);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].label, 'Gemini 3.8 Flash');
  assert.deepEqual(choices[0].models, { auto: 'ag/gemini-3.8-flash', high: 'ag/gemini-3.8-flash-high' });
  assert.equal(isAiPickerModel('phynite', 'claude-opus-4-6'), false);
  assert.equal(isAiPickerModel('phynite', 'claude-haiku-4-5-20251001'), false);
});
test('a local gateway keeps its discovered model identity without namespace restrictions', () => {
  const choices = aiModelChoices([{ id: '9router', local: true, configured: true, models: [{ id: 'my-model', label: 'my-model', capabilities: { available: true, efforts: ['auto'] } }, { id: 'provider/another-model', label: 'Another', capabilities: { available: true, efforts: ['auto'] } }] }]);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].models.auto, 'my-model');
  assert.equal(choices[1].models.auto, 'provider/another-model');
});
test('the local subscription bridge exposes detected Codex and Antigravity models', () => {
  const choices = aiModelChoices([{ id: 'local', local: true, configured: true, models: [
    { id: 'codex/gpt-6.1-sol', label: 'GPT 6.1 Sol', capabilities: { available: true, efforts: ['auto', 'high'] } },
    { id: 'agy/gemini-3.8-flash', label: 'Gemini 3.8 Flash', capabilities: { available: true, efforts: ['auto'] } },
  ] }]);
  assert.deepEqual(choices.map(choice => choice.label), ['GPT 6.1 Sol', 'Gemini 3.8 Flash']);
  assert.equal(choices[0].models.high, 'codex/gpt-6.1-sol');
});

test('Antigravity variants retain their distinct model identities in the picker', () => {
  const choices = aiModelChoices([{ id: 'local', local: true, configured: true, models: ['high', 'medium', 'low'].map(effort => ({ id: `agy/gemini-3.8-flash-${effort}` as AiModelId, label: 'Gemini 3.8 Flash', capabilities: { available: true, efforts: ['auto'] } })) }]);
  assert.deepEqual(choices.map(choice => choice.label), ['Gemini 3.8 Flash High', 'Gemini 3.8 Flash Medium', 'Gemini 3.8 Flash Low']);
  assert.equal(choices[2].models.auto, 'agy/gemini-3.8-flash-low');
});
