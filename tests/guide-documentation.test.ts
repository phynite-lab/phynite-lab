import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { settingsSections } from '../app/account-navigation.ts';
import { getGuideSections } from '../lib/guide-library.ts';
import { materializeGuideSections } from '../lib/guide-release.ts';
import { bundledLocalRelease } from '../lib/local-release-metadata.ts';
import { GUIDE_TOPIC_IDS, guideRoute, legacyGuideDestination } from '../lib/guide-routing.ts';
import { PUBLIC_PATHS, publicSiteOrigin } from '../lib/site-metadata.ts';
import { guideMarkdownLink, verifyVisualAsset, visualMarkdown } from '../scripts/build-user-guide.mjs';

const locales = ['en', 'id'] as const;
const guides = locales.map(locale => materializeGuideSections(getGuideSections(locale), bundledLocalRelease));
const visualsFor = (sections: ReturnType<typeof getGuideSections>) => sections.flatMap(section => section.blocks.flatMap(block => block.visuals ?? []));

function validateGuideLinks(sections: ReturnType<typeof getGuideSections>) {
  const pages = new Set<string>([...PUBLIC_PATHS, ...settingsSections.map(section => section.href), '/profile', '/workspace', '/storage', '/login', '/register', '/source']);
  for (const section of sections) for (const block of section.blocks) for (const link of block.links ?? []) {
    const url = new URL(link.href, publicSiteOrigin());
    assert.ok(['http:', 'https:', 'mailto:'].includes(url.protocol), `Invalid link protocol: ${link.href}`);
    if (url.origin !== new URL(publicSiteOrigin()).origin) continue;
    const legacy = legacyGuideDestination(url.pathname, url.hash, url.search);
    const target = new URL(legacy ?? url.href, publicSiteOrigin());
    const route = guideRoute(target.pathname);
    if (!route) {
      assert.ok(pages.has(target.pathname), `Unknown internal documentation link: ${link.href}`);
      continue;
    }
    if (!route.topic) { assert.equal(target.hash, '', `Unknown guide overview anchor: ${link.href}`); continue; }
    const topic = sections.find(candidate => candidate.id === route.topic);
    assert.ok(topic, `Unknown guide topic: ${link.href}`);
    if (target.hash) {
      const anchors = new Set(topic.blocks.map((_block, index) => `#docs-${topic.id}-${index + 1}`));
      assert.ok(anchors.has(target.hash), `Unknown guide block anchor: ${link.href}`);
    }
  }
}

test('English and Indonesian documentation expose the same unique guide topics and valid links', () => {
  for (const sections of guides) {
    assert.deepEqual(sections.map(section => section.id), [...GUIDE_TOPIC_IDS]);
    assert.equal(new Set(sections.map(section => section.id)).size, sections.length);
    assert.doesNotMatch(JSON.stringify(sections), /\{\{(?:LOCAL_NPM_VERSION|NODE_REQUIREMENT)\}\}/);
    validateGuideLinks(sections);
  }
});

test('bilingual guides share visual assets with meaningful localized descriptions', () => {
  // Conceptual diagrams are rendered with translated labels, so their filenames
  // carry an `en`/`id` suffix even though both locales use the same visual role.
  // Normalize that suffix while comparing the structural visual identity.
  const normalizeVisualPath = (source: string | undefined) => source?.replace(/-(?:en|id)(?=-(?:light|dark)\.png$)/, '-locale');
  const visualIdentity = (sections: typeof guides[number]) => sections.map(section => ({ id: section.id, visuals: section.blocks.flatMap(block => block.visuals ?? []).map(visual => ({
    kind: visual.kind, src: normalizeVisualPath(visual.src), lightSrc: normalizeVisualPath(visual.lightSrc), darkSrc: normalizeVisualPath(visual.darkSrc),
    mobileSrc: visual.mobileSrc, width: visual.width, height: visual.height,
    mobileWidth: visual.mobileWidth, mobileHeight: visual.mobileHeight,
  })) }));
  assert.deepEqual(visualIdentity(guides[0]), visualIdentity(guides[1]));
  for (const sections of guides) for (const visual of visualsFor(sections)) {
    assert.ok(visual.alt.trim().split(/\s+/).length >= 3, `Describe the visual: ${visual.src}`);
    assert.ok(visual.caption && visual.caption.trim().split(/\s+/).length >= 4, `Explain the visual: ${visual.src}`);
    assert.notEqual(visual.alt, visual.src);
    assert.notEqual(visual.alt, visual.caption, `Caption should add context: ${visual.src}`);
    if (visual.width !== undefined || visual.height !== undefined) {
      assert.ok(Number.isSafeInteger(visual.width) && visual.width! > 0 && Number.isSafeInteger(visual.height) && visual.height! > 0, `Invalid intrinsic dimensions: ${visual.src}`);
    }
    if (visual.mobileSrc) assert.ok(Number.isSafeInteger(visual.mobileWidth) && visual.mobileWidth! > 0 && Number.isSafeInteger(visual.mobileHeight) && visual.mobileHeight! > 0, `Missing mobile dimensions: ${visual.mobileSrc}`);
  }
});

test('all localized visual variants resolve to committed public image files', async () => {
  const sources = new Set(guides.flatMap(visualsFor).flatMap(visual => [visual.src, visual.lightSrc, visual.darkSrc, visual.mobileSrc]).filter((source): source is string => Boolean(source)));
  assert.ok(sources.size > 0, 'The visual guide must contain images');
  for (const source of sources) await verifyVisualAsset(source);
  for (const sections of guides) for (const visual of visualsFor(sections)) {
    for (const [source, width, height] of [[visual.src, visual.width, visual.height], [visual.mobileSrc, visual.mobileWidth, visual.mobileHeight]] as const) {
      if (!source?.endsWith('.png') || width === undefined) continue;
      const bytes = await readFile(`public${source}`);
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16), width, `Wrong width for ${source}`);
      assert.equal(bytes.readUInt32BE(20), height, `Wrong height for ${source}`);
    }
  }
});

test('visual generation rejects external, traversing, and non-image paths', async () => {
  for (const source of ['https://untrusted.invalid/image.png', '//untrusted.invalid/image.png', '/../secret.png', '/docs/../secret.png', '/docs/%2e%2e/secret.png', '/docs/image.png?token=secret', '/docs/image.html']) {
    await assert.rejects(verifyVisualAsset(source), /committed public asset path/);
  }
});

test('Markdown images remain CommonMark and preserve captions without raw HTML', () => {
  const visual = { kind: 'screenshot', src: '/docs/guide/example.png', alt: 'Input [selected] <cell>', caption: 'Compare *this* input & output.', lightSrc: '/docs/guide/light.png' };
  const markdown = visualMarkdown(visual, 'https://phynitelab.com');
  assert.equal(markdown, '![Input \\[selected\\] \\<cell\\>](<https://phynitelab.com/docs/guide/example.png>)\n\nCompare \\*this\\* input &amp; output.\n\n');
  assert.doesNotMatch(markdown, /<(?:figure|picture|img|source)/);
  assert.equal(guideMarkdownLink('/guide/configure#docs-configure-2'), '#docs-configure-2');
  assert.equal(guideMarkdownLink('/id/guide/configure'), '#configure');
  assert.equal(guideMarkdownLink('/account/compute#your-computer'), `${publicSiteOrigin()}/account/compute#your-computer`);
  assert.equal(guideMarkdownLink('https://example.org/guide/configure#details'), 'https://example.org/guide/configure#details');
});

test('generated guides match their downloads, retain anchors, and include source visuals', async () => {
  for (const [index, locale] of locales.entries()) {
    const suffix = locale === 'id' ? '-id' : '';
    const path = `public/downloads/phynite-user-guide${suffix}.md`;
    const markdown = await readFile(path, 'utf8');
    // `docs/user-guide*.md` is an ignored generator output in the public
    // checkout. Compare it when a local prepare step produced it, while the
    // tracked public download remains the CI source of truth.
    try {
      await access(`docs/user-guide${suffix}.md`);
      assert.equal(markdown, await readFile(`docs/user-guide${suffix}.md`, 'utf8'));
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT');
    }
    const anchors = new Set([...markdown.matchAll(/<a id="([^"]+)"/g)].map(match => match[1]));
    for (const section of guides[index]) {
      assert.ok(anchors.has(section.id), `${path} is missing #${section.id}`);
      for (const [blockIndex] of section.blocks.entries()) assert.ok(anchors.has(`docs-${section.id}-${blockIndex + 1}`));
    }
    assert.doesNotMatch(markdown, /\{\{(?:LOCAL_NPM_VERSION|NODE_REQUIREMENT)\}\}/);
    for (const match of markdown.matchAll(/\]\(<?#([^)>]+)>?\)/g)) assert.ok(anchors.has(match[1]), `${path} has a broken #${match[1]} link`);
    for (const visual of visualsFor(guides[index])) assert.ok(markdown.includes(visualMarkdown(visual)), `${path} lacks ${visual.src}`);
    for (const match of markdown.matchAll(/!\[(?:\\.|[^\\\]])*\]\(<([^>]+)>\)/g)) {
      const url = new URL(match[1]);
      assert.equal(url.origin, new URL(publicSiteOrigin()).origin);
      await verifyVisualAsset(url.pathname);
    }
  }
});
