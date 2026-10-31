import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAiMath, aiMarkdownUrl } from '../lib/ai-markdown.ts';
import { aiConversationInProject, projectAiHref } from '../lib/project-ai.ts';

test('LaTeX dollar and backslash delimiters work without changing numerical source text', () => {
  assert.equal(normalizeAiMath(String.raw`Energy $E_0 = -12.34$ Ry.`), String.raw`Energy $E_0 = -12.34$ Ry.`);
  assert.equal(normalizeAiMath(String.raw`Mesh \(8\times 8\times 8\) at 90 Ry.`), String.raw`Mesh $8\times 8\times 8$ at 90 Ry.`);
  assert.equal(normalizeAiMath(String.raw`\[E = \sum_i E_i\]`), '\n\n$$\nE = \\sum_i E_i\n$$\n\n');
  assert.equal(normalizeAiMath('\\[\n\\frac{a}{b}\n\\]'), '\n\n$$\n\\frac{a}{b}\n$$\n\n');
  assert.equal(normalizeAiMath('Partial \\(E_0'), 'Partial \\(E_0');
});

test('math normalization preserves code fences, inline code, escaped backslashes and partial streams', () => {
  const samples = [String.raw`Code: \`\(a\)\``, '```latex\n\\[E=1\\]\n```', '~~~\n\\(x\\)\n~~~', '```latex\n\\[partial', String.raw`\\(literal\\)`, '    \\(code\\)'];
  for (const sample of samples) assert.equal(normalizeAiMath(sample), sample);
});

test('Markdown links allow only explicit HTTPS links and app paths', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '//elsewhere.test', 'https://user:pass@example.com', 'http://example.com']) assert.equal(aiMarkdownUrl(value), undefined);
  assert.equal(aiMarkdownUrl('https://doi.org/10.123/test'), 'https://doi.org/10.123/test');
  assert.equal(aiMarkdownUrl('/guide/local-compute'), '/guide/local-compute');
});

test('project history includes canonical and migrated aliases, never another project or general chat', () => {
  for (const key of ['project:p1', 'md:p1', 'dft:old-p1']) assert.equal(aiConversationInProject({ projectKey: key }, 'p1', 'old-p1'), true);
  for (const key of ['project:p2', 'dft:p2', 'md:p2', null]) assert.equal(aiConversationInProject({ projectKey: key }, 'p1', 'old-p1'), false);
  assert.equal(projectAiHref('project:p1', 'aic_ab12'), '/projects/p1?tab=tool%3Aai%3Aaic_ab12&chat=aic_ab12');
  assert.equal(projectAiHref('dft:old-p1'), '/projects/legacy-old-p1?tab=tool%3Aai');
  for (const key of [null, 'project:../other', 'https://elsewhere.test', 'unknown:p1']) assert.equal(projectAiHref(key), null);
});

test('approval review summaries retain numerical fields and omit internal execution records', async () => {
  const { aiFieldChanges, aiFieldLabel } = await import('../lib/ai-action-summary.ts');
  assert.deepEqual(aiFieldChanges({configuration:{draft:{cutoff:80,kPoint:6},execution:{result:'old'}}}, {configuration:{draft:{cutoff:90,kPoint:6}}}), [{path:'configuration.draft.cutoff',before:80,after:90}]);
  assert.equal(aiFieldLabel('configuration.draft.cutoff'), 'Wavefunction cutoff (Ry)');
});
