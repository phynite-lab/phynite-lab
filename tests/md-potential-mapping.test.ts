import assert from 'node:assert/strict';
import test from 'node:test';
import { meamLibraryOrder } from '../lib/md-potential-mapping.ts';

test('MEAM model order is explicit and independent of source appearance or subset', () => {
  assert.deepEqual(meamLibraryOrder('Ni Al', ['Al', 'Ni']), ['Ni', 'Al']);
  assert.deepEqual(meamLibraryOrder('Ni,Al', ['Ni']), ['Ni', 'Al']);
  assert.deepEqual(meamLibraryOrder('Al Ni', ['Ni', 'Al']), ['Al', 'Ni']);
  for (const value of ['', 'Ni Ni Al', 'Ni', 'Ni Mystery']) assert.throws(() => meamLibraryOrder(value, ['Al', 'Ni']), /MEAM/);
});
