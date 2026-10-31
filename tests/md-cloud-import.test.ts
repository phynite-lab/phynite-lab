import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mdCloudTimelineFrames,
  mdCloudPacketFromArtifact,
  mdParseResultFromCloudPackets,
  shouldUsePersonalTrajectoryImport,
} from '../lib/md-cloud-import.ts';
import type { MdAnalysis, MdFrame } from '../lib/md-types.ts';

const frame = (index: number): MdFrame => ({
  index,
  timestep: index * 10,
  time: null,
  ids: ['1', '2'],
  species: ['Ar', 'Ar'],
  positions: [0, 0, 0, 1, 1, 1],
  properties: { Energy: [-1, -1] },
  vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
  origin: [0, 0, 0],
  periodic: [true, true, true],
  hasCell: true,
});

const packet = (index: number) => ({
  version: 1,
  analysisId: 'analysis-1',
  result: {
    frame: frame(index),
    attributes: {},
    phases: [],
    rdf: [],
    bonds: [],
    dislocations: [],
    surface: null,
    warnings: index ? ['Imported by OVITO'] : [],
    engine: 'OVITO',
  } satisfies MdAnalysis,
});

test('personal-compute timeline and packets become a bounded OVITO parse result', () => {
  const timeline = mdCloudTimelineFrames({ frames: [
    { frame: 0, frameArtifact: 'frames/000000.json.gz' },
    { frame: 1, frameArtifact: 'frames/000001.json.gz' },
  ] });
  const result = mdParseResultFromCloudPackets('sample.dcd', timeline, [packet(0), packet(1)]);
  assert.equal(result.index.format, 'ovito');
  assert.equal(result.frames.length, 2);
  assert.deepEqual(result.warnings, ['Imported by OVITO']);
});

test('sharded OVITO results normalize to the same validated frame packets', () => {
  const timeline = mdCloudTimelineFrames({ frames: [
    { frame: 0, frameShardArtifact: 'frames/000000-000001.json.gz', frameShardIndex: 0 },
    { frame: 1, frameShardArtifact: 'frames/000000-000001.json.gz', frameShardIndex: 1 },
  ] });
  const shard = { version: 1, analysisId: 'analysis-1', frames: [packet(0), packet(1)] };
  const packets = timeline.map((item) => mdCloudPacketFromArtifact(shard, item));
  assert.equal(mdParseResultFromCloudPackets('sample.xtc', timeline, packets).frames.length, 2);
  assert.equal(timeline[0].artifact, 'frames/000000-000001.json.gz');
});

test('personal-compute trajectory packets reject unsafe paths and invalid frame order', () => {
  assert.throws(
    () => mdCloudTimelineFrames({ frames: [{ frame: 0, frameArtifact: 'frames/../secret.json.gz' }] }),
    /unsafe trajectory artifact path/,
  );
  const timeline = mdCloudTimelineFrames({ frames: [{ frame: 0, frameArtifact: 'frames/000000.json.gz' }] });
  assert.throws(() => mdParseResultFromCloudPackets('sample.dcd', timeline, [packet(1)]), /out of order/);
});

test('binary, compressed, OVITO-only, and oversized trajectories bypass the eager text parser', () => {
  assert.equal(shouldUsePersonalTrajectoryImport('run.dump', 1024), false);
  assert.equal(shouldUsePersonalTrajectoryImport('run.dump.gz', 1024), true);
  assert.equal(shouldUsePersonalTrajectoryImport('atoms.data', 1024), true);
  assert.equal(shouldUsePersonalTrajectoryImport('run.dump', 65 * 1024 * 1024), true);
});

test('personal-compute source labels retain their exact values and reject length mismatches', () => {
  const timeline = mdCloudTimelineFrames({ frames: [{ frame: 0, frameArtifact: 'frames/000000.json.gz' }] });
  const value = packet(0);
  value.result.frame.stringProperties = { 'Atom Name': ['Ar1', 'Ar2'] };
  assert.deepEqual(mdParseResultFromCloudPackets('labels.cif', timeline, [value]).frames[0].stringProperties, value.result.frame.stringProperties);
  value.result.frame.stringProperties['Atom Name'] = ['Ar1'];
  assert.throws(() => mdParseResultFromCloudPackets('labels.cif', timeline, [value]), /string particle properties/);
});
