import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getGuideSections } from '../lib/guide-library.ts';
import { materializeGuideSections } from '../lib/guide-release.ts';
import { bundledLocalRelease } from '../lib/local-release-metadata.ts';
import { GUIDE_TOPIC_IDS } from '../lib/guide-routing.ts';

test('English and Indonesian documentation expose the same guide topics', () => {
  const ids = (['en', 'id'] as const).map(locale => {
    const sections = materializeGuideSections(getGuideSections(locale), bundledLocalRelease);
    assert.deepEqual(sections.map(section => section.id), [...GUIDE_TOPIC_IDS]);
    const content = JSON.stringify(sections);
    assert.equal(content.includes('{{LOCAL_NPM_VERSION}}'), false);
    assert.equal(content.includes('{{NODE_REQUIREMENT}}'), false);
    return sections.map(section => section.id);
  });
  assert.deepEqual(ids[0], ids[1]);
});

test('generated guide downloads contain every topic anchor and no release tokens', async () => {
  for (const path of ['public/downloads/phynite-user-guide.md', 'public/downloads/phynite-user-guide-id.md']) {
    const markdown = await readFile(path, 'utf8');
    const anchors = new Set([...markdown.matchAll(/<a id="([^"]+)"/g)].map(match => match[1]));
    for (const topic of GUIDE_TOPIC_IDS) assert.equal(anchors.has(topic), true, `${path} is missing #${topic}`);
    assert.equal(markdown.includes('{{LOCAL_NPM_VERSION}}'), false);
    assert.equal(markdown.includes('{{NODE_REQUIREMENT}}'), false);
    for (const match of markdown.matchAll(/\]\(#([^\)]+)\)/g)) assert.equal(anchors.has(match[1]), true, `${path} has a missing #${match[1]} link`);
  }
});
