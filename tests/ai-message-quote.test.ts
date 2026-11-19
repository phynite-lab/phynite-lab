import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteAiMessage } from '../lib/ai-message-quote.ts';
import { aiContextKey, isAiContextItem } from '../lib/ai-workbench.ts';
import type { AiMessage } from '../lib/ai-contract.ts';

const message: AiMessage = { id: 'aim_quote', conversationId: 'aic_quote', runId: 'air_quote', role: 'assistant', modelId: 'fixture', createdAt: '', text: '🧪 At **80 Ry**, check convergence.\nCompare 80 Ry again.' };
test('quotes retain exact scientific source, Unicode offsets and immutable message identity', () => {
  const item = quoteAiMessage(message, '80 Ry, check convergence.');
  assert.ok(item && item.ref.kind === 'message');
  assert.equal(item.ref.quote, '80 Ry**, check convergence.');
  assert.equal(Array.from(message.text).slice(item.ref.start, item.ref.end).join(''), item.ref.quote);
  assert.equal(item.ref.conversationId, 'aic_quote'); assert.equal(item.ref.id, 'aim_quote');
  assert.ok(isAiContextItem(item));
});
test('repeated selections stay distinct and invalid selections never fabricate source text', () => {
  const first = quoteAiMessage(message, '80 Ry'), second = quoteAiMessage(message, '80 Ry', 1);
  assert.ok(first && second); assert.notEqual(aiContextKey(first.ref), aiContextKey(second.ref));
  assert.equal(quoteAiMessage(message, '4 eV'), null);
  assert.equal(quoteAiMessage(message, 'x'.repeat(4001)), null);
  assert.equal(quoteAiMessage({ ...message, role: 'user' }, '80 Ry'), null);
});
test('formatted occurrences precede plain duplicates and literal scientific operators remain in the source', () => {
  const text = '**80 Ry**, check convergence.\n80 Ry, check convergence.';
  const first = quoteAiMessage({ ...message, text }, '80 Ry, check convergence.');
  const second = quoteAiMessage({ ...message, text }, '80 Ry, check convergence.', 1);
  assert.ok(first?.ref.kind === 'message' && second?.ref.kind === 'message');
  assert.equal(first.ref.start, 2);
  assert.equal(second.ref.start, text.indexOf('\n') + 1);
  const formula = quoteAiMessage({ ...message, text: 'Use `a_b * 2` unchanged.' }, 'a_b * 2');
  assert.ok(formula?.ref.kind === 'message');
  assert.equal(formula.ref.quote, 'a_b * 2');
  assert.equal(quoteAiMessage(message, '80 Ry', -1), null);
});
