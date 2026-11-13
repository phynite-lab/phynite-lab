import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const system = platform() === 'linux' && /microsoft/i.test(release()) ? /wsl2/i.test(release()) ? 'linux-wsl2' : 'unsupported-wsl1' : platform();
const target = `${system}-${arch() === 'arm64' ? system === 'darwin' ? 'arm64' : 'aarch64' : 'x86_64'}`;
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'phynite-evidence-review-'));
  const evidence = join(directory, 'evidence.json'), review = join(directory, 'review.json'), qualification = join(directory, 'qualification.json');
  // Contract-only fixture. No provider is called, and no application loads this index.
  const raw = JSON.stringify({ schemaVersion: 1, kind: 'native-provider', modelId: 'codex/test-only', platform: target,
    safetyPassed: false, evidenceQualityReviewed: false, overlapObserved: true,
    runs: { solo: { status: 'completed', latencyMs: 1 }, team: { status: 'completed', latencyMs: 2 } } });
  writeFileSync(evidence, raw);
  writeFileSync(review, JSON.stringify({ modelId: 'codex/test-only', platform: target, evidenceSha256: sha(raw), safetyPassed: true, evidenceQualityReviewed: true }));
  const seal = (extra: string[] = []) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/benchmark-ai-orchestration.mjs',
    '--review-existing', evidence, '--review', review, '--qualification', qualification, ...extra], {
    encoding: 'utf8', env: { ...process.env, PHYNITE_LOCAL_AI_URL: 'invalid-no-inference-must-run', PHYNITE_LOCAL_AI_TOKEN: '' },
  });
  return { directory, evidence, qualification, raw, seal };
}

test('review seals the exact retained evidence without another inference or overwriting the original', () => {
  const f = fixture();
  try {
    const result = f.seal();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes('Starting native-provider'), false);
    assert.equal(readFileSync(f.evidence, 'utf8'), f.raw);
    const index = JSON.parse(readFileSync(f.qualification, 'utf8'));
    const sealed = readFileSync(join(f.directory, index.entries[0].evidenceFile), 'utf8');
    assert.equal(sha(sealed), index.entries[0].evidenceSha256);
    assert.equal(JSON.parse(sealed).reviewedSource.evidenceSha256, sha(f.raw));
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('changed evidence or a different selected model cannot inherit an earlier qualification review', () => {
  const f = fixture();
  try {
    writeFileSync(f.evidence, f.raw + '\n');
    const changed = f.seal();
    assert.equal(changed.status, 1); assert.match(changed.stderr, /changed after review/);
    assert.equal(existsSync(f.qualification), false);
    writeFileSync(f.evidence, f.raw);
    const other = f.seal(['--model', 'codex/another-model']);
    assert.equal(other.status, 1); assert.match(other.stderr, /exact selected model/);
    assert.equal(existsSync(f.qualification), false);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
