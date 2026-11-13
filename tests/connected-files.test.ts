import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedImportIssue, type FileEntry } from '../lib/connected-files.ts';
const entry: FileEntry = { name: 'a', kind: 'file', identity: 'id', sizeBytes: 1024 };
test('selected transfers enforce regular files, count and total bytes', () => {
  assert.equal(selectedImportIssue([entry]), null);
  assert.ok(selectedImportIssue([]));
  assert.ok(selectedImportIssue(Array(21).fill(entry)));
  assert.ok(selectedImportIssue([{ ...entry, kind: 'symlink' }]));
  assert.ok(selectedImportIssue([{ ...entry, sizeBytes: 1024 ** 3 }, entry]));
});
