import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { aggregateStudyReplicas, assessRefinementSeries, buildStudyReplayPackage, fitMsdDiffusion, readMdThermoEvidence, type StudyEvidence } from '../lib/study-evidence.ts';

const study = (): StudyEvidence => ({ schemaVersion: 1, name: 'Controlled numerical fixture', observable: 'Energy per atom', unit: 'eV/atom', normalization: 'same composition, per atom', method: 'fixture', tolerance: .01, refinementParameter: 'cutoff', refinementDirection: 'increasing', physicalValidation: { status: 'unassessed' }, runs: [40, 60, 80].map((refinement, i) => ({ runId: `fixture-${i}`, inputSha256: String(i).repeat(64), invariantSettingsSha256: 'a'.repeat(64), modelIdentity: 'fixture-model', structureIdentity: 'fixture-composition', refinement, observable: [-3, -3.001, -3.003][i] })) });
test('refinement evidence measures observable spread and rejects mixed physical identities', () => {
  assert.equal(assessRefinementSeries(study()).status, 'within-tested-tolerance');
  const oscillating = study(); oscillating.runs[0].observable = -4;
  assert.equal(assessRefinementSeries(oscillating).status, 'outside-tested-tolerance');
  assert.equal(assessRefinementSeries({ ...study(), runs: study().runs.slice(1) }).status, 'insufficient-refinement');
  const wrongModel = study(); wrongModel.runs[1].modelIdentity = 'different potential';
  assert.throws(() => assessRefinementSeries(wrongModel), /same declared model/);
  const wrongSettings = study(); wrongSettings.runs[1].invariantSettingsSha256 = 'b'.repeat(64);
  assert.throws(() => assessRefinementSeries(wrongSettings), /invariant settings/);
  assert.throws(() => assessRefinementSeries({ ...study(), tolerance: 0 }), /positive study-specific/);
});
test('replica uncertainty uses independent run means rather than correlated frame count', () => {
  const replicas = study(); replicas.runs.forEach((run, i) => { run.refinement = 1; run.seed = i + 1; run.observable = i + 1; });
  const report = aggregateStudyReplicas(replicas);
  assert.equal(report.mean, 2); assert.equal(report.replicaCount, 3);
  assert.ok(Math.abs(report.standardError! - Math.sqrt(1 / 3)) < 1e-12);
  replicas.runs[1].seed = 1;
  assert.throws(() => aggregateStudyReplicas(replicas), /independent samples/);
});
test('MSD fitting obeys physical window, dimensional Einstein factor and SI conversion', () => {
  const points = [0, 1, 2, 3, 4].map(timePs => ({ timePs, msdAngstrom2: 6 * timePs + 2 }));
  const report = fitMsdDiffusion(points, { startPs: 1, endPs: 4 }, 3);
  assert.ok(Math.abs(report.diffusionM2PerSecond! - 1e-8) < 1e-22);
  assert.equal(report.interceptAngstrom2, 2); assert.equal(report.rSquared, 1);
  assert.equal(report.uncertainty, null);
  assert.throws(() => fitMsdDiffusion([...points].reverse(), { startPs: 1, endPs: 4 }, 3), /strictly increasing/);
});

test('scientific evidence rejects numeric overflow instead of serializing NaN or Infinity as null', () => {
  const replicas = study(); replicas.runs.forEach((run, i) => { run.refinement = 1; run.seed = i + 1; run.observable = i === 0 ? 1e308 : -1e308; });
  assert.throws(() => aggregateStudyReplicas(replicas), /overflow/);
  assert.throws(() => fitMsdDiffusion([0, 1e200, 2e200].map(timePs => ({ timePs, msdAngstrom2: timePs })), { startPs: 0, endPs: 3e200 }, 3), /overflows/);
});

test('thermo evidence retains physical time and rejects unknown or nonfinite samples', () => {
  const rows = [{ step: 0, timePs: 0, tempK: 300 }, { step: 200, timePs: .3, tempK: 301 }];
  assert.deepEqual(readMdThermoEvidence(rows), rows);
  assert.throws(() => readMdThermoEvidence([{ step: 200, tempK: 301 }]), /explicit physical time/);
  assert.throws(() => readMdThermoEvidence([{ step: 200, timePs: .3, tempK: NaN }]), /finite measured/);
});
test('study replay packages verify every supplied artifact and disclose missing dependencies', async () => {
  const archive = await buildStudyReplayPackage([{ path: 'input/qe.in', bytes: new TextEncoder().encode('actual input'), role: 'input' }], { domain: 'dft', name: 'fixture', runId: 'fixture', evidence: study() });
  const manifest = JSON.parse(strFromU8(unzipSync(archive)['study-manifest.json']));
  assert.equal(manifest.replayStatus, 'requires-dependencies-or-evidence');
  assert.deepEqual(manifest.missingRoles, ['log', 'runtime', 'data']);
  assert.equal(manifest.files[0].sha256.length, 64);
  assert.equal(manifest.files[1].path, 'study-evidence.json');
  assert.equal(manifest.files[1].sha256.length, 64);
  await assert.rejects(() => buildStudyReplayPackage([{ path: 'a', bytes: new Uint8Array([1]), role: 'data', sha256: 'f'.repeat(64) }], { domain: 'md', name: 'fixture', runId: 'fixture' }), /checksum mismatch/);
  await assert.rejects(() => buildStudyReplayPackage([{ path: '../secret', bytes: new Uint8Array([1]), role: 'data' }], { domain: 'md', name: 'fixture', runId: 'fixture' }), /safe relative paths/);
  await assert.rejects(() => buildStudyReplayPackage([{ path: 'study-evidence.json', bytes: new Uint8Array([1]), role: 'data' }], { domain: 'md', name: 'fixture', runId: 'fixture', evidence: study() }), /reserved package metadata/);
});
