import assert from 'node:assert/strict';
import test from 'node:test';
import { aiCommandMatches, aiModuleCommands, aiModuleKindForCommand, findAiCommandToken, replaceAiCommandToken } from '../lib/ai-composer-commands.ts';
import { workflowKinds } from '../lib/project-workflow.ts';

test('slash discovery follows the caret and only replaces the active token', () => {
  const text = 'Review /crystal_structure before SCF';
  const token = findAiCommandToken(text, 15)!;
  assert.deepEqual(token, { start: 7, end: 25, query: 'crystal_structure' });
  assert.deepEqual(replaceAiCommandToken(text, token), { text: 'Review  before SCF', caret: 7 });
  assert.deepEqual(findAiCommandToken('/', 1), { start: 0, end: 1, query: '' });
  assert.deepEqual(findAiCommandToken('line\n/plan', 10), { start: 5, end: 10, query: 'plan' });
});

test('URLs, filesystem paths, code and IME composition stay literal text', () => {
  for (const text of ['https://example.test/plan', '/tmp/input.in', 'folder/plan', '\\/plan', '`/plan', '```ts\n/plan', '~~~\n/plan', 'use ``/plan', '/plan/next']) assert.equal(findAiCommandToken(text, text.length), null, text);
  assert.equal(findAiCommandToken('/plan', 5, true), null);
  assert.equal(findAiCommandToken('/plan', -1), null);
  assert.equal(findAiCommandToken('/plan', 99), null);
  assert.deepEqual(findAiCommandToken('```\ncode\n```\n/plan', 18), { start: 13, end: 18, query: 'plan' });
  assert.deepEqual(findAiCommandToken('`code` /plan', 12), { start: 7, end: 12, query: 'plan' });
});

test('stale command selections cannot remove changed prompt text', () => {
  assert.deepEqual(replaceAiCommandToken('/research existing', { start: 0, end: 5, query: 'plan' }), { text: '/research existing', caret: 0 });
});

test('every workflow kind has a unique module alias and crystal alias preserves kind', () => {
  assert.equal(aiModuleCommands.length, workflowKinds.length);
  assert.equal(new Set(aiModuleCommands.map(item => item.command)).size, workflowKinds.length);
  for (const entry of aiModuleCommands) assert.equal(aiModuleKindForCommand(entry.command), entry.kind);
  assert.equal(aiModuleKindForCommand('CRYSTAL_STRUCTURE'), 'structure');
  assert.equal(aiModuleKindForCommand('structure'), 'structure');
  assert.equal(aiModuleKindForCommand('missing'), undefined);
  assert.equal(aiCommandMatches('crystal', 'Crystal structure'), true);
  assert.equal(aiCommandMatches('/md-analysis', 'md_analysis'), true);
  assert.equal(aiCommandMatches('absent', 'Crystal structure'), false);
});
