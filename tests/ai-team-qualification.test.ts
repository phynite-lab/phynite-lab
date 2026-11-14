import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { teamQualificationEnvironment } from '../packages/phynite-lab/lib/team-qualification.mjs';

test('launcher uses the bundled reviewed index with explicit opt-out and index override', () => {
  assert.deepEqual(teamQualificationEnvironment('/package', {}), { PHYNITE_AI_TEAM: '1', PHYNITE_AI_TEAM_QUALIFICATION: join('/package', 'lib', 'team-qualification', 'index.json') });
  assert.deepEqual(teamQualificationEnvironment('/package', { PHYNITE_AI_TEAM: '0' }), { PHYNITE_AI_TEAM: '0' });
  assert.deepEqual(teamQualificationEnvironment('/package', { PHYNITE_AI_TEAM_QUALIFICATION: '/local/reviewed.json' }), { PHYNITE_AI_TEAM: '1', PHYNITE_AI_TEAM_QUALIFICATION: '/local/reviewed.json' });
});

test('shipped Team index retains the exact native report, reviewed source and safety evidence', async () => {
  const directory = new URL('../packages/phynite-lab/lib/team-qualification/', import.meta.url);
  const index = JSON.parse(await readFile(new URL('index.json', directory), 'utf8'));
  assert.ok(index.entries.length > 0, 'The default launcher must ship its qualified target.');
  const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
  for (const entry of index.entries) {
    const raw = await readFile(new URL(entry.evidenceFile, directory), 'utf8'), report = JSON.parse(raw);
    assert.equal(entry.evidenceSha256, hash(raw));
    assert.equal(report.kind, 'native-provider');
    assert.equal(report.modelId, entry.modelId);
    assert.equal(report.platform, entry.platform);
    const source = await readFile(new URL(report.reviewedSource.evidenceFile, directory), 'utf8');
    assert.equal(report.reviewedSource.evidenceSha256, hash(source));
    assert.equal(report.review.evidenceSha256, hash(source));
    const safetyRaw = await readFile(new URL(report.review.safetyEvidenceFile, directory), 'utf8'), safety = JSON.parse(safetyRaw);
    assert.equal(report.review.safetyEvidenceSha256, hash(safetyRaw));
    assert.equal(safety.modelId, entry.modelId);
    assert.equal(safety.platform, entry.platform);
    assert.equal(safety.passed, true);
    for (const name of ['real_native_global_limit_queue_cancel_stream_cancel', 'actual_native_stop_fences_late_result', 'actual_native_restart_fences_late_result']) {
      assert.equal(safety.checks.find((check: { name: string }) => check.name === name)?.passed, true);
    }
  }
});
