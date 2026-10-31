import assert from 'node:assert/strict';
import test from 'node:test';
import { collectResultArtifacts, type ResultArtifactPage } from '../lib/result-artifacts.ts';
const digest = 'a'.repeat(64);
const artifacts = Array.from({ length: 201 }, (_, index) => ({ path: `data/pdos-${index}.dat`, role: 'data', label: 'PDOS', contentType: 'text/plain', downloadUrl: 'https://download.invalid/file', sizeBytes: 1, sha256: digest }));

test('study inventory includes every artifact across pages, including the final workspace', async () => {
  artifacts[200].path = 'workspace.tar.gz';
  const all = await collectResultArtifacts(async cursor => {
    const start = Number(cursor ?? 0);
    return { artifacts: artifacts.slice(start, start + 100), totalArtifacts: 201, manifestSha256: digest, nextCursor: start < 200 ? String(start + 100) : null };
  });
  assert.equal(all.length, 201);
  assert.equal(all.at(-1)?.path, 'workspace.tar.gz');
});
test('changed, incomplete or cyclic inventories cannot become a study archive', async () => {
  const first: ResultArtifactPage = { artifacts: artifacts.slice(0, 100), totalArtifacts: 201, manifestSha256: digest, nextCursor: 'next' };
  await assert.rejects(() => collectResultArtifacts(async cursor => cursor ? { ...first, artifacts: artifacts.slice(100), manifestSha256: 'b'.repeat(64), nextCursor: null } : first), /changed/);
  await assert.rejects(() => collectResultArtifacts(async () => ({ ...first, nextCursor: null })), /incomplete/);
  await assert.rejects(() => collectResultArtifacts(async () => first), /duplicated|continuation/);
  await assert.rejects(() => collectResultArtifacts(async () => ({ ...first, artifacts: [] })), /continuation/);
});
