import assert from 'node:assert/strict';
import test from 'node:test';
import { MdParseResultCache, estimateMdParseResultBytes } from '../lib/md-parse-cache.ts';
import type { MdParseResult } from '../lib/md-parser.ts';

function parsed(name: string, atoms: number): MdParseResult {
  return {
    index: { format: 'structure', offsets: [0], name, warnings: [] },
    frames: [{
      index: 0,
      timestep: 0,
      time: null,
      ids: Array.from({ length: atoms }, (_, index) => String(index + 1)),
      species: Array.from({ length: atoms }, () => name),
      positions: Array.from({ length: atoms * 3 }, () => 0),
      properties: {},
      vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      origin: [0, 0, 0],
      periodic: [true, true, true],
      hasCell: true,
    }],
    warnings: [],
  };
}

test('parse-result cache evicts least-recently-used trajectories by byte budget', () => {
  const first = parsed('Ar', 10);
  const bytes = estimateMdParseResultBytes(first);
  const cache = new MdParseResultCache(bytes * 2 + 64);
  assert.equal(cache.set('first', first), true);
  assert.equal(cache.set('second', parsed('Kr', 10)), true);
  assert.ok(cache.get('first'));
  assert.equal(cache.set('third', parsed('Xe', 10)), true);
  assert.ok(cache.get('first'));
  assert.equal(cache.get('second'), undefined);
  assert.ok(cache.get('third'));
});

test('oversized parse results are not duplicated in cache', () => {
  const cache = new MdParseResultCache(128);
  assert.equal(cache.set('large', parsed('Ar', 20)), false);
  assert.equal(cache.get('large'), undefined);
  assert.equal(cache.sizeBytes, 0);
});

test('source-label storage contributes to the parse cache memory budget', () => {
  const value = parsed('Ar', 1);
  const before = estimateMdParseResultBytes(value);
  value.frames[0].stringProperties = { Label: ['x'.repeat(2048)] };
  assert.ok(estimateMdParseResultBytes(value) >= before + 4096);
  assert.equal(new MdParseResultCache(before + 1024).set('labels', value), false);
});
