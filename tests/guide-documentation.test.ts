import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
    for (const section of sections) for (const block of section.blocks) for (const visual of block.visuals ?? []) {
      assert.match(visual.src, /^(https?:\/\/|\/)/, `Visual source must be an absolute public path or URL: ${visual.src}`);
      if (visual.lightSrc) assert.match(visual.lightSrc, /^(https?:\/\/|\/)/);
      if (visual.darkSrc) assert.match(visual.darkSrc, /^(https?:\/\/|\/)/);
    }
    return sections.map(section => section.id);
  });
  assert.deepEqual(ids[0], ids[1]);
});

test('guide visual assets exist in the public asset tree', async () => {
  const sections = materializeGuideSections(getGuideSections('en'), bundledLocalRelease);
  const sources = new Set<string>();
  for (const section of sections) for (const block of section.blocks) for (const visual of block.visuals ?? []) {
    for (const source of [visual.src, visual.lightSrc, visual.darkSrc]) if (source && source.startsWith('/')) sources.add(source);
  }
  for (const source of sources) await access(resolve('public', `.${source}`));
});

test('generated guide downloads contain every topic anchor and no release tokens', async () => {
  for (const path of ['public/downloads/phynite-user-guide.md', 'public/downloads/phynite-user-guide-id.md']) {
    const markdown = await readFile(path, 'utf8');
    const anchors = new Set([...markdown.matchAll(/<a id="([^"]+)"/g)].map(match => match[1]));
    for (const topic of GUIDE_TOPIC_IDS) assert.equal(anchors.has(topic), true, `${path} is missing #${topic}`);
    assert.equal(markdown.includes('{{LOCAL_NPM_VERSION}}'), false);
    assert.equal(markdown.includes('{{NODE_REQUIREMENT}}'), false);
    for (const match of markdown.matchAll(/\]\(#([^\)]+)\)/g)) assert.equal(anchors.has(match[1]), true, `${path} has a missing #${match[1]} link`);
    for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) assert.match(match[1], /^(https?:\/\/|\/)/, `${path} has an invalid visual link`);
  }
});
