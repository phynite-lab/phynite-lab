import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSummary, buildDiscordPayload } from '../scripts/announce-release.mjs';

test('cleanSummary returns empty string when body is missing or empty', () => {
  assert.equal(cleanSummary(''), '');
  assert.equal(cleanSummary(null), '');
  assert.equal(cleanSummary(undefined), '');
});

test('cleanSummary strips markdown headers and extracts first paragraph', () => {
  const body = `## Release Highlights
First paragraph with important release details.

Second paragraph that should not be in the excerpt.`;
  assert.equal(cleanSummary(body), 'First paragraph with important release details.');
});

test('cleanSummary truncates long bodies gracefully without cutting words', () => {
  const longBody =
    'GNU AGPL v3 only. Native packages: macOS Apple Silicon, Linux ARM64 and Linux x64 (glibc >=2.39, including current Omarchy/Arch Linux). Windows WSL2 uses the Linux x64 package. Linux qualification runs on matching hosted runners; an Omarchy desktop or Windows host was not directly tested. Exact source, checksums and qualification evidence are attached.';
  const summary = cleanSummary(longBody, 150);
  assert.ok(summary.length <= 153); // maxChars + '...'
  assert.ok(summary.endsWith('...'));
  assert.ok(!summary.includes('(glibc >=2.39, including current Omarchy/Arch Linux). Windows WSL2 uses'));
});

test('buildDiscordPayload includes @everyone by default', () => {
  const payload = buildDiscordPayload({
    tagName: 'v0.1.10',
    releaseUrl: 'https://github.com/phynite-lab/phynite-lab/releases/tag/v0.1.10',
    summary: 'Updated native runtimes for macOS and Linux.',
    mentionEveryone: true,
  });

  assert.equal(payload.username, 'Phynite Lab');
  assert.equal(payload.avatar_url, 'https://avatars.githubusercontent.com/u/245534445?v=4');
  assert.deepEqual(payload.allowed_mentions, { parse: ['everyone'] });
  assert.equal(
    payload.content,
    '@everyone\nPhynite Lab v0.1.10 has been released!\n\nUpdated native runtimes for macOS and Linux.\n\nhttps://github.com/phynite-lab/phynite-lab/releases/tag/v0.1.10'
  );
});

test('buildDiscordPayload excludes @everyone when mentionEveryone is false', () => {
  const payload = buildDiscordPayload({
    tagName: 'v0.1.10',
    releaseUrl: 'https://github.com/phynite-lab/phynite-lab/releases/tag/v0.1.10',
    summary: 'Updated native runtimes for macOS and Linux.',
    mentionEveryone: false,
  });

  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.ok(!payload.content.includes('@everyone'));
  assert.equal(
    payload.content,
    'Phynite Lab v0.1.10 has been released!\n\nUpdated native runtimes for macOS and Linux.\n\nhttps://github.com/phynite-lab/phynite-lab/releases/tag/v0.1.10'
  );
});
