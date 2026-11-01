import assert from 'node:assert/strict';
import test from 'node:test';
import { moveItemById, reorderItemsById } from '../lib/ordered-items.ts';

const items = [
  { id: 'a', materialId: 'one', sourceId: 'original' },
  { id: 'x', materialId: 'two', sourceId: 'original' },
  { id: 'b', materialId: 'one', sourceId: 'a' },
  { id: 'c', materialId: 'one', sourceId: 'b' },
];

test('reorder keeps item identity and scientific dependency fields attached', () => {
  const reordered = reorderItemsById(items, 'c', 'a');
  assert.deepEqual(reordered.map((item) => item.id), ['c', 'a', 'x', 'b']);
  assert.equal(reordered.find((item) => item.id === 'c')?.sourceId, 'b');
  assert.equal(reordered.find((item) => item.id === 'b')?.sourceId, 'a');
});

test('move uses adjacent items from the same material without disturbing other records', () => {
  const moved = moveItemById(items, 'b', -1, (item) => item.materialId === 'one');
  assert.deepEqual(moved.map((item) => item.id), ['b', 'a', 'x', 'c']);
  assert.equal(moved[2], items[1]);
});

test('invalid and boundary moves preserve the original collection', () => {
  assert.equal(reorderItemsById(items, 'missing', 'a'), items);
  assert.equal(moveItemById(items, 'a', -1, (item) => item.materialId === 'one'), items);
});
